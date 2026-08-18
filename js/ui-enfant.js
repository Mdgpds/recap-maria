/* ============================================================================
   ui-enfant.js — Espace enfant : calendrier et saisie d'une journée
   (§2.2 et §2.3 des specs).

   C'est l'écran central de la refonte. Un enfant, un calendrier, quatre
   panneaux :
     1. le calendrier du mois de CET enfant (un seul enfant par calendrier) ;
     2. le mois : présence, salaire, entretien, heures sup, total à verser ;
     3. les compteurs de CE contrat (jamais de compteur global) ;
     4. depuis le début du contrat, avec le lien vers l'historique.

   Trois points de vigilance, tenus ici et nulle part ailleurs :

   - UN MOIS CLÔTURÉ NE SE MODIFIE PLUS (correction B1 de la relecture). Le
     verrou ne portait que sur le rangement du contrat : un mois clôturé
     restait entièrement saisissable, et un congé posé depuis ce mois partait
     en plus sur les trois autres contrats. L'application écrivait donc à
     l'écran une promesse — « après clôture, plus aucune modification » —
     qu'elle ne tenait pas. Désormais : aucune cellule touchable, un bandeau
     qui le dit, un refus explicite si l'écriture est tentée quand même, et
     surtout AUCUN contrat dont le mois est clôturé ne reçoit une écriture
     groupée venue d'un autre.

   - AUCUN CALCUL DANS L'INTERFACE (§4). Les effets annoncés dans la feuille de
     saisie — « Pas d'entretien ce jour (−5,00 €) », « Congé posé pour les 3
     enfants, −1 jour » — ne sont pas des textes recopiés de la maquette : ils
     sont obtenus en REJOUANT le mois avec Engine.calculerMois() tel qu'il
     serait après le geste, et en comparant au mois actuel. Si un paramètre du
     contrat change (indemnité, minutes supplémentaires, ordre d'imputation),
     la phrase change toute seule.

   - « JE NE TRAVAILLAIS PAS » ÉCRIT SUR TOUS LES CONTRATS SERVIS (§2.3), en
     une seule écriture, chaque contrat ne recevant que SES propres jours
     (planning, bornes, fériés exclus, mois non clôturé). Le libellé compte
     les contrats RÉELLEMENT servis, jamais « les 4 enfants » par principe
     (correction A2).
   ========================================================================= */
(function (global) {
  'use strict';

  var Kit = global.Kit;
  var Chaine = global.ChaineMois;
  var Engine = global.Engine;
  var Feries = global.Feries;

  /* Types posés par une absence de Maria. Le retrait ne cible que ceux-là :
     une absence d'enfant saisie le même jour ne doit pas disparaître. */
  var TYPES_ABSENCE_MARIA = ['conge_maria', 'sans_solde', 'hors_planning'];

  /* Échelles des barres de progression des compteurs (§2.2 : « en barres de
     progression avec équivalence en jours »). Une barre a besoin d'un maximum,
     et le cahier des charges n'en définit aucun pour la récupération : on
     affiche donc l'équivalent de 10 jours de congé. Pour les congés payés, le
     maximum est celui de RG-11 : 30 jours ouvrables acquis par exercice.
     Ces deux valeurs ne servent QU'À la longueur de la barre. */
  var BARRE_RECUP_EN_JOURS = 10;
  var BARRE_CP_DIXIEMES = 300;

  /* Jusqu'où la navigation du calendrier peut aller au-delà du mois courant.
     Correction A13 : « Mes congés » propose de poser jusqu'à vingt semaines en
     avant ; sans cette borne, un congé d'été posé en mai devenait invisible et
     impossible à retirer avant le 1er juillet. */
  var MOIS_A_VENIR_VISIBLES = 12;

  var vue = null;   // état de l'écran affiché

  /* ------------------------------------------------------------------ */
  /* Affichage                                                           */
  /* ------------------------------------------------------------------ */

  function afficher(ctx) {
    var contrat = global.App.contratParId(ctx.params.contratId);
    if (!contrat) {
      return global.App.tousLesContrats().then(function () {
        var c = global.App.contratParId(ctx.params.contratId);
        if (!c) throw new Error('contrat introuvable');
        return afficherContrat(ctx, c);
      });
    }
    return afficherContrat(ctx, contrat);
  }

  function afficherContrat(ctx, contrat) {
    var m = { annee: ctx.params.annee, mois: ctx.params.mois };
    if (!m.annee || !m.mois) m = global.App.moisCourant();

    barre(ctx.barre, contrat, m);
    ctx.corps.appendChild(Kit.ce('div', 'attente', 'Calcul du mois…'));

    /* Les journées des AUTRES contrats et l'état clôturé de chacun sont
       chargés ici, pas au moment du geste : une écriture groupée doit savoir
       ce qu'elle va écraser (A5) et qui elle n'a pas le droit de toucher (B1)
       avant que Maria ne touche quoi que ce soit. Tout est en cache. */
    var autres = global.App.contrats();
    return Promise.all([
      global.App.serie(contrat, m),
      global.App.journees(contrat.id, m.annee, m.mois),
      global.App.recapsDuMois(m.annee, m.mois),
      Promise.all(autres.map(function (c) {
        return global.App.journees(c.id, m.annee, m.mois)
          .then(function (j) { return { id: c.id, jours: j }; })
          .catch(function () { return { id: c.id, jours: null }; });
      })),
      /* Lot 10 — un échec de lecture ici ne doit pas vider l'écran : sans les
         imputations on perd un AVERTISSEMENT, pas une donnée. */
      global.DB.listImputationsPourMois(contrat.id, m.annee, m.mois).catch(function () { return []; }),
      /* Lot 12 — la note du mois. Un échec ici ne vide pas l'écran : on perd
         un espace d'écriture, pas un chiffre. */
      global.DB.getNoteMensuelle(contrat.id, m.annee, m.mois).catch(function () { return null; })
    ]).then(function (r) {
      var chaine = r[0];
      var entree = global.App.moisDe(chaine, m.annee, m.mois);
      var journeesAutres = {};
      r[3].forEach(function (x) { journeesAutres[x.id] = x.jours; });

      var maintenant = global.App.moisCourant();
      var auj = global.App.aujourdhui();
      vue = {
        contrat: contrat,
        annee: m.annee,
        mois: m.mois,
        chaine: chaine,
        journees: r[1],
        recaps: r[2],
        journeesAutres: journeesAutres,
        entree: entree,
        clos: !!(entree && entree.fige),
        aVenir: Chaine.cmpMois(m.annee, m.mois, maintenant.annee, maintenant.mois) > 0,
        range: !!contrat.archive,
        /* Lot 7 : la date du jour est lue UNE fois, ici, et circule ensuite en
           paramètre. Aucune fonction d'état ne relit l'horloge — sans quoi le
           comportement du 25 deviendrait invérifiable. */
        aujourdhui: auj,
        etat: Kit.etatDuMois(m.annee, m.mois, entree && entree.recap, auj),
        restants: Kit.joursTravaillesRestants(contrat, m.annee, m.mois, auj, r[1]),
        /* Lot 10 — les périodes de congé ventilées qui touchent ce mois. */
        imputations: r[4] || [],
        note: r[5] || null
      };
      vue.lectureSeule = vue.range || vue.clos;
      Kit.vider(ctx.corps);
      rendre(ctx.corps);
    });
  }

  function barre(barreEl, contrat, m) {
    Kit.vider(barreEl);
    barreEl.className = 'bar';
    var bk = Kit.bouton('bk', function () { global.App.retour(); });
    bk.textContent = '‹';
    bk.setAttribute('aria-label', 'Retour');
    barreEl.appendChild(bk);
    /* Lot 8 — la photo dans l'en-tête. Maria passe d'un enfant à l'autre
       plusieurs fois par jour ; un titre en texte seul ne dit pas assez vite
       chez qui on est.
       PÉRIMÈTRE : `ui-enfant.js` ne figure pas dans les fichiers réservés au
       lot 8, alors que le §8.5 demande la photo « en-tête de l'espace
       enfant ». Défaut de la spécification, même nature que le §4.2 du lot 9 ;
       tranché de la même façon, et signalé en restitution. */
    barreEl.appendChild(Kit.avatar(contrat, 'pt'));
    barreEl.appendChild(Kit.ce('span', 'ti',
      contrat.prenom_enfant + ' — ' + Kit.libelleMoisAnnee(m.annee, m.mois)));

    var nav = Kit.ce('div', 'nav');
    var prec = Kit.bouton(null, function () { changerMois(-1); });
    prec.textContent = '‹';
    prec.setAttribute('aria-label', 'Mois précédent');
    var suiv = Kit.bouton(null, function () { changerMois(1); });
    suiv.textContent = '›';
    suiv.setAttribute('aria-label', 'Mois suivant');

    /* Bornes : jamais avant le début du contrat, jamais après sa fin. Au-delà
       du mois courant, la navigation reste ouverte jusqu'à MOIS_A_VENIR_VISIBLES
       — c'est ce qui rend consultable et retirable un congé posé d'avance
       (A13). Un bouton qui ne mène nulle part est désactivé, pas silencieux. */
    var debut = Chaine.moisDeDate(contrat.date_debut);
    var maintenant = global.App.moisCourant();
    var limite = { annee: maintenant.annee, mois: maintenant.mois };
    for (var i = 0; i < MOIS_A_VENIR_VISIBLES; i++) limite = Chaine.moisSuivant(limite.annee, limite.mois);
    if (contrat.date_fin) {
      var f = Chaine.moisDeDate(contrat.date_fin);
      if (Chaine.cmpMois(f.annee, f.mois, limite.annee, limite.mois) < 0) limite = f;
    }
    var p = Chaine.moisPrecedent(m.annee, m.mois);
    var s = Chaine.moisSuivant(m.annee, m.mois);
    prec.disabled = Chaine.cmpMois(p.annee, p.mois, debut.annee, debut.mois) < 0;
    suiv.disabled = Chaine.cmpMois(s.annee, s.mois, limite.annee, limite.mois) > 0;

    nav.appendChild(prec);
    nav.appendChild(suiv);
    barreEl.appendChild(nav);
  }

  function changerMois(delta) {
    if (!vue) return;
    var m = delta < 0
      ? Chaine.moisPrecedent(vue.annee, vue.mois)
      : Chaine.moisSuivant(vue.annee, vue.mois);
    global.App.remplacer('enfant', { contratId: vue.contrat.id, annee: m.annee, mois: m.mois });
  }

  /* ------------------------------------------------------------------ */
  /* Les quatre panneaux                                                 */
  /* ------------------------------------------------------------------ */

  function rendre(corps) {
    var c = vue.contrat;

    if (vue.range) {
      corps.appendChild(Kit.note('Ancien contrat — lecture seule',
        'Ce contrat est terminé et rangé. Tout son historique reste consultable, ' +
        'mais aucune journée ne peut plus être modifiée.'));
    } else if (vue.clos) {
      /* Lot 13 : un mois clôturé peut désormais être rouvert. Le bandeau ne
         promet donc plus l'impossibilité de modifier — il promet la stabilité
         des chiffres tant que le mois reste clôturé, et il ouvre la porte,
         explicitement. Ce qui protège Maria n'est plus le verrou, c'est la
         trace : d'où le lien vers l'historique, à côté de la réouverture. */
      var recapClos = vue.entree && vue.entree.recap;
      corps.appendChild(Kit.note(
        'Mois clôturé' + (recapClos && recapClos.fige_le ? ' le ' + Kit.dateLongue(recapClos.fige_le) : ''),
        'Les chiffres de ce mois ne bougeront plus, même si un salaire change plus tard. ' +
        'Les journées de ' + c.prenom_enfant + ' ne se modifient pas tant qu’il est clôturé.'));
      if (global.UiReouverture && recapClos) {
        global.UiReouverture.actionsMoisCloture(corps, {
          contrat: c, annee: vue.annee, mois: vue.mois, recap: recapClos
        });
      }
    } else if (vue.aVenir) {
      corps.appendChild(Kit.note('Mois à venir',
        'Vous pouvez y consulter et retirer les congés déjà posés. Le mois ne se clôture ' +
        'qu’une fois passé.'));
    } else {
      corps.appendChild(bandeauEtat());
    }

    /* LOT 16 §16.1 b) — EN TÊTE DE L'ÉCRAN. C'est le premier chose que Maria
       doit lire quand une répartition ne tient plus : avant, l'écran entier
       ne s'affichait pas. */
    var reserves = panneauReservesInsuffisantes();
    if (reserves) corps.appendChild(reserves);

    var ecartes = panneauChoixEcartes();
    if (ecartes) corps.appendChild(ecartes);

    corps.appendChild(panneauCalendrier());

    if (!vue.entree) {
      corps.appendChild(Kit.ce('p', 'vide',
        'Le contrat de ' + c.prenom_enfant + ' ne couvre pas ' +
        Kit.libelleMoisAnnee(vue.annee, vue.mois) + '.'));
      corps.appendChild(boutonFiche());
      return;
    }

    corps.appendChild(panneauMois());
    /* V8-17 — la note vient AVANT les compteurs. Retour de Maria : c'est ce
       qu'elle relit le plus souvent, et le chercher sous trois panneaux de
       chiffres revenait à ne pas l'écrire. */
    corps.appendChild(panneauNote());
    corps.appendChild(panneauCompteurs());
    corps.appendChild(panneauDepuisDebut());
    corps.appendChild(boutonFiche());
  }

  /* Bandeau d'état du mois (§6.3, V8-02). Jusqu'ici l'espace enfant se taisait
     sur un mois en cours : les chiffres s'affichaient tels quels, et rien ne
     disait qu'ils allaient encore bouger. Maria lisait « 1 142,50 € à verser »
     le 11 août comme elle l'aurait lu le 31.

     Un mois clôturé a déjà son bandeau plus haut (lot 13) : celui-ci ne traite
     donc que les deux autres états. */
  function bandeauEtat() {
    if (vue.etat === 'en_cours') {
      return Kit.note('Chiffres provisoires',
        vue.restants > 0
          ? 'Il reste ' + phraseJoursRestants(vue.restants) + ' en ' +
            Kit.libelleMois(vue.mois) + '.'
          : 'Ce mois n’est pas terminé.');
    }
    return Kit.warnbox('Ce mois est terminé',
      'Vérifiez les journées, puis clôturez-le.');
  }

  function phraseJoursRestants(n) {
    return n + (n > 1 ? ' jours travaillés' : ' jour travaillé');
  }

  function boutonFiche() {
    var b = Kit.bouton('btn nt', function () {
      global.App.aller('fiche', { contratId: vue.contrat.id });
    });
    b.textContent = 'Contrat, horaires et rémunération';
    return b;
  }

  /* --- 1. Calendrier ------------------------------------------------- */

  function panneauCalendrier() {
    var c = vue.contrat;
    var p = Kit.pane('Le calendrier de ' + c.prenom_enfant);
    var table = Kit.ce('table', 'cal');

    var thead = Kit.ce('tr');
    ['L', 'M', 'M', 'J', 'V', 'S', 'D'].forEach(function (j, i) {
      var th = Kit.ce('th', null, j);
      th.setAttribute('aria-label', Kit.JOURS_SEMAINE[i + 1]);
      thead.appendChild(th);
    });
    table.appendChild(thead);

    var jours = Engine.joursDuMois(vue.annee, vue.mois);
    var planning = c.jours_planning || [1, 2, 3, 4, 5];
    var tr = Kit.ce('tr');
    var col = Engine.jourSemaine(jours[0]);
    for (var v = 1; v < col; v++) tr.appendChild(cellVide());

    jours.forEach(function (d, index) {
      tr.appendChild(cellule(d, planning));
      col++;
      if (col > 7 && index < jours.length - 1) {
        table.appendChild(tr);
        tr = Kit.ce('tr');
        col = 1;
      }
    });
    while (col <= 7) { tr.appendChild(cellVide()); col++; }
    table.appendChild(tr);

    p.appendChild(table);

    var lg = Kit.ce('div', 'lg');
    /* Lot 8 — la légende s'accorde elle aussi. C'est là que le point médian
       sautait le plus aux yeux : il figurait DEUX FOIS sous chaque calendrier,
       tous les jours, pour un enfant dont le genre est parfaitement connu. */
    legende(lg, 'g1', majuscule(Kit.accordDe(c, 'présent')));
    legende(lg, 'g2', majuscule(Kit.accordDe(c, 'absent')));
    legende(lg, 'g5', 'Mon congé');
    legende(lg, 'g3', 'Férié');
    legende(lg, 'g6', 'À venir');
    var lgN = Kit.ce('span');
    lgN.appendChild(Kit.ce('i', 'gnote', '•'));
    lgN.appendChild(document.createTextNode('Note'));
    lg.appendChild(lgN);
    var lgH = Kit.ce('span');
    lgH.appendChild(Kit.ce('i', 'gheures', '◆'));
    lgH.appendChild(document.createTextNode('Heures ajustées'));
    lg.appendChild(lgH);
    p.appendChild(lg);

    /* V8-06 — La phrase permanente sous le calendrier. Elle dit la règle qui
       fait tout tenir : la saisie par exception. Sans elle, Maria croit devoir
       marquer chaque jour présent, et ce qu'elle NE fait pas lui paraît un
       oubli plutôt qu'une réponse.

       Les minutes viennent du CONTRAT, jamais d'une valeur en dur. Un contrat
       qui prévoit 45 minutes le dira — et une constante « 30 » serait fausse
       ce jour-là, sans que rien ne le signale. */
    p.appendChild(phrasePermanente());
    return p;
  }

  function phrasePermanente() {
    var c = vue.contrat;
    var minutes = c.minutes_sup_jour || 0;
    var n = Kit.note('Rien à faire les jours normaux',
      'Tant que vous ne touchez pas un jour, ' + c.prenom_enfant + ' est ' +
      Kit.accordDe(c, 'compté') + ' ' + Kit.accordDe(c, 'présent') +
      (minutes > 0 ? ' et vos ' + Kit.duree(minutes) + ' sont dues' : '') + '.');
    n.classList.add('permanente');
    return n;
  }

  function majuscule(t) { return String(t).charAt(0).toUpperCase() + String(t).slice(1); }

  function legende(parent, classe, texte) {
    var s = Kit.ce('span');
    s.appendChild(Kit.ce('i', classe));
    s.appendChild(document.createTextNode(texte));
    parent.appendChild(s);
  }

  function cellVide() { return Kit.ce('td', 'we no'); }

  function cellule(d, planning) {
    var c = vue.contrat;
    var jour = Number(d.slice(8, 10));
    var horsPlanning = planning.indexOf(Engine.jourSemaine(d)) === -1;
    var horsBornes = (c.date_debut && d < c.date_debut) || (c.date_fin && d > c.date_fin);
    var type = Kit.typeDuJour(vue.journees, d);

    /* Lot 7 — on ne saisit pas l'avenir (V8-05, piège n° 7). Un jour à venir
       touchable permettait de noter une absence qui n'a pas encore eu lieu, ce
       qui rendait le décompte des jours restants faux et la projection
       incohérente. Les congés se posent depuis « Mes congés », pas ici. */
    var aVenir = d > vue.aujourdhui;

    var classe, mini = null, touchable = false;
    if (horsBornes) { classe = 'we no'; }
    else if (type === 'ferie') { classe = 'fe no'; mini = 'férié'; }
    else if (horsPlanning) { classe = 'we no'; }
    else if (type === 'conge_maria') { classe = 'cg'; mini = 'congé'; touchable = true; }
    else if (type === 'sans_solde') { classe = 'cg'; mini = 'ss solde'; touchable = true; }
    else if (type === 'hors_planning') { classe = 'nt'; mini = 'non trav.'; touchable = true; }
    else if (type === 'familiarisation') { classe = 'ok'; mini = 'familia.'; touchable = true; }
    else if (type === 'absence_enfant') { classe = 'ab'; mini = 'abs.'; touchable = true; }
    else { classe = 'ok'; touchable = true; }

    /* Un congé DÉJÀ POSÉ dans le futur reste touchable : Maria doit pouvoir le
       retirer (correction A13 du lot 6). C'est la journée ORDINAIRE à venir
       qu'on gèle, pas la journée déjà décidée. */
    var dejaSaisi = !!(vue.journees || {})[d];
    if (aVenir && !dejaSaisi) touchable = false;

    /* LOT 12 (A3) — une journée annotée porte un repère. C'est une FORME —
       un point —, jamais une couleur seule : le calendrier a déjà quatre
       états codés par la couleur, et une cinquième teinte n'y serait plus
       lisible. Le repère est aussi annoncé aux lecteurs d'écran. */
    var ligneJour = (vue.journees || {})[d];
    var annotee = !!(ligneJour && ligneJour.commentaire);
    var ajustee = !!(ligneJour && ((ligneJour.minutes_sup_exceptionnelles || 0) > 0 ||
                                   (ligneJour.minutes_sup_renoncees || 0) > 0));

    var td = Kit.ce('td', classe +
      (aVenir ? ' futur' : '') +
      (d === vue.aujourdhui ? ' auj' : '') +
      (touchable && vue.lectureSeule ? ' no' : ''));
    td.appendChild(Kit.ce('div', 'num', String(jour)));
    if (mini) td.appendChild(Kit.ce('div', 'mini', mini));
    if (annotee || ajustee) {
      var reperes = Kit.ce('div', 'reperes');
      if (annotee) reperes.appendChild(Kit.ce('span', 'rp note', '•'));
      if (ajustee) reperes.appendChild(Kit.ce('span', 'rp heures', '◆'));
      td.appendChild(reperes);
      td.setAttribute('aria-description',
        (annotee ? 'journée annotée' : '') +
        (annotee && ajustee ? ', ' : '') +
        (ajustee ? 'heures ajustées' : ''));
    }
    if (d === vue.aujourdhui) td.setAttribute('aria-current', 'date');

    if (touchable && !vue.lectureSeule) {
      td.setAttribute('role', 'button');
      td.setAttribute('tabindex', '0');
      td.setAttribute('aria-label', Kit.jourLong(d));
      td.addEventListener('click', function () { ouvrirJour(d); });
      td.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ouvrirJour(d); }
      });
    }
    return td;
  }

  /* --- 2. Le mois ---------------------------------------------------- */

  function panneauMois() {
    var c = vue.contrat;
    var e = vue.entree;
    var r = e.resultat;
    var p = Kit.pane('Le mois de ' + c.prenom_enfant);

    if (e.salaireManquant) {
      p.appendChild(Kit.warnbox('Aucune rémunération connue pour ce mois',
        'Renseignez un barème dans la fiche contrat : les jours sont exacts, mais les montants ' +
        'resteront à zéro tant qu’aucun barème n’est enregistré.'));
    } else if (!r.salaireNetCentimes) {
      /* Correction B2 : un barème SANS NET est un barème présent — le moteur
         ne signale rien, et le total affiché est amputé du salaire entier. */
      p.appendChild(Kit.warnbox('Le net de votre barème n’est pas renseigné',
        'Ce récapitulatif est incomplet : le total ci-dessous ne contient que l’indemnité ' +
        'd’entretien. Le net figure sur la fiche de paie ; complétez-le dans la fiche contrat ' +
        'avant de clôturer.'));
    }
    if (e.avantInitialisation) {
      p.appendChild(Kit.warnbox('Mois antérieur à la reprise de vos compteurs',
        'Les jours et les montants sont exacts, mais les soldes d’heures et de congés payés ' +
        'y repartent de zéro : ils ne veulent rien dire. Ce mois se consulte, il ne se clôture pas.'));
    }

    var l = Kit.lines(p);
    /* Correction A6 : sur un mois clôturé, le numérateur vient de l'instantané
       et le dénominateur d'un comptage fait en direct sur les bornes COURANTES
       du contrat. Un archivage postérieur faisait passer « 20 j sur 20 » à
       « 20 j sur 14 » sur un document censé ne plus bouger. Sur un mois
       clôturé, on n'affiche donc que le chiffre figé. */
    if (vue.clos) {
      Kit.ligne(l, 'Jours de présence', Kit.jours(r.joursPresence));
    } else {
      var travailles = Kit.joursTravailles(c, vue.annee, vue.mois, vue.journees).length;
      Kit.ligne(l, 'Jours de présence', r.joursPresence + ' j sur ' + travailles);
    }
    Kit.ligne(l, 'Salaire net', Kit.eur(r.salaireNetCentimes));
    Kit.ligne(l, libelleEntretien(r), Kit.eur(r.entretienCentimes));

    if (r.joursCongesDecomptes > 0) {
      var imp = r.imputation || {};
      Kit.ligne(l, 'Congés posés ce mois-ci', r.joursCongesDecomptes + ' j ouvrables');
      Kit.ligne(l, '— sur vos congés payés', Kit.jours(imp.joursSurCp || 0), { discret: true });
      Kit.ligne(l, '— sur votre récupération', Kit.jours(imp.joursSurSup || 0), { discret: true });
      if ((imp.joursSansSolde || 0) > 0) {
        Kit.ligne(l, '— sans solde', Kit.jours(imp.joursSansSolde), { alerte: true });
      }
    }
    if (r.retenueSansSoldeCentimes > 0) {
      Kit.ligne(l, 'Retenue pour jour(s) sans solde', '−' + Kit.eur(r.retenueSansSoldeCentimes), { alerte: true });
    }
    Kit.ligne(l, 'Heures sup du mois', Kit.heures(r.minutesSupAcquises), { discret: true });
    /* LOT 12 — le détail, quand ces cas existent. Un total de 8 h qui cache
       1 h 15 ajoutées et 1 h 30 auxquelles Maria a renoncé ne dit pas la même
       chose qu'un total de 8 h ordinaire. */
    if (r.minutesSupAjoutees > 0) {
      Kit.ligne(l, '— dont ajoutées', Kit.heures(r.minutesSupAjoutees), { discret: true });
    }
    if (r.minutesSupRenoncees > 0) {
      Kit.ligne(l, '— dont non réclamées, votre choix',
        Kit.heures(r.minutesSupRenoncees), { discret: true });
    }
    Kit.ligne(l, 'Total à verser', Kit.eur(r.totalAVerserCentimes), { total: true });

    var b = Kit.bouton(e.fige ? 'btn nt' : 'btn', function () {
      global.App.aller('document', { contratId: c.id, annee: vue.annee, mois: vue.mois });
    });
    b.textContent = e.fige ? 'Revoir le mois clôturé' : 'Vérifier et clôturer le mois';
    b.style.marginBottom = '0';
    p.appendChild(b);
    return p;
  }

  function libelleEntretien(r) {
    var attendu = r.joursPresence * (vue.contrat.entretien_centimes_jour || 0);
    if (attendu === r.entretienCentimes) {
      return 'Entretien — ' + r.joursPresence + ' j × ' + Kit.eur(vue.contrat.entretien_centimes_jour);
    }
    return 'Indemnité d’entretien';
  }

  /* --- LOT 12 : la note du mois --------------------------------------
     POUR MARIA SEULE. C'est écrit sous le titre, et c'est vrai : cette note
     n'entre dans aucun instantané de récapitulatif (migration 009), donc dans
     aucun document transmis.

     Elle reste MODIFIABLE APRÈS CLÔTURE, contrairement à tout le reste de cet
     écran. Un mois clôturé fige des montants, pas des souvenirs — et c'est
     souvent après coup qu'on se rappelle pourquoi une semaine avait été
     compliquée. */
  function panneauNote() {
    var c = vue.contrat;
    var p = Kit.pane('Mes notes sur ce mois');
    p.appendChild(Kit.ce('p', 'sb q',
      'Pour vous seule — n’apparaît pas sur le document remis à la famille.'));

    var zone = document.createElement('textarea');
    zone.className = 'note-mois';
    zone.rows = 3;
    zone.value = (vue.note && vue.note.texte) || '';
    zone.setAttribute('aria-label', 'Note sur ' + Kit.libelleMoisAnnee(vue.annee, vue.mois) +
      ' pour ' + c.prenom_enfant);
    zone.placeholder = 'Un mot pour vous — ce qui s’est passé, ce qu’il faudra penser à faire…';

    var etat = Kit.ce('div', 'sb q');
    p.appendChild(zone);
    p.appendChild(etat);

    /* Enregistrement à la SORTIE du champ, pas à chaque frappe : une note
       s'écrit en plusieurs phrases, et un enregistrement par lettre ferait
       autant d'allers-retours réseau. */
    var dernierEnregistre = zone.value;
    zone.addEventListener('blur', function () {
      var texte = zone.value;
      if (texte === dernierEnregistre) return;
      etat.textContent = 'Enregistrement…';
      global.DB.enregistrerNoteMensuelle(c.id, vue.annee, vue.mois, texte)
        .then(function (n) {
          dernierEnregistre = texte;
          vue.note = n;
          etat.textContent = 'Note enregistrée.';
        })
        .catch(function (e) {
          /* B.0-9 : l'échec est visible, et il dit ce qui reste vrai. Le texte
             est toujours à l'écran : Maria peut le recopier ailleurs. */
          etat.textContent = 'La note n’a pas été enregistrée : ' + Kit.messageErreur(e) +
            ' Votre texte est toujours là.';
          etat.className = 'sb wa';
        });
    });

    if (vue.clos) {
      p.appendChild(Kit.ce('p', 'sb q',
        'Ce mois est clôturé, mais cette note reste modifiable : elle ne fait pas ' +
        'partie des chiffres.'));
    }
    return p;
  }

  /* --- 3. Compteurs de ce contrat ------------------------------------ */

  function panneauCompteurs() {
    var c = vue.contrat;
    var cs = vue.entree.resultat.compteurSortie || {};
    var p = Kit.pane('Compteurs de ' + c.prenom_enfant);

    var minutes = Kit.supDisponible(cs);
    var parJour = c.minutes_par_jour_conge || 540;
    var joursRecup = Math.floor(minutes / parJour);
    compteur(p, {
      titre: 'Récupération',
      valeur: Kit.heures(minutes),
      pct: pourcent(minutes, BARRE_RECUP_EN_JOURS * parJour),
      note: joursRecup + ' jour' + (joursRecup > 1 ? 's' : '') + ' de congé — ' +
            Kit.duree(parJour) + ' accumulées = 1 jour',
      bas: false
    });

    var cp = Kit.cpDisponible(cs);
    var bas = cp < Kit.SEUIL_CP_BAS_DIXIEMES;
    compteur(p, {
      titre: 'Congés payés',
      valeur: Kit.joursCp(cp),
      pct: pourcent(cp, BARRE_CP_DIXIEMES),
      note: bas
        ? 'Compteur bas — un congé d’été passerait en partie sans solde'
        : 'sur 30 jours ouvrables acquis par an',
      bas: bas
    });
    return p;
  }

  function pourcent(valeur, max) {
    if (!max) return 0;
    return Math.max(0, Math.min(100, Math.round(valeur * 100 / max)));
  }

  function compteur(parent, o) {
    var bloc = Kit.ce('div', 'cptr' + (o.bas ? ' low' : ''));
    var cl = Kit.ce('div', 'cl');
    cl.appendChild(Kit.ce('b', null, o.titre));
    cl.appendChild(Kit.ce('span', null, o.valeur));
    bloc.appendChild(cl);
    var cb = Kit.ce('div', 'cb');
    var i = Kit.ce('i');
    i.style.width = o.pct + '%';
    cb.appendChild(i);
    bloc.appendChild(cb);
    bloc.appendChild(Kit.ce('div', 'cn', o.note));
    parent.appendChild(bloc);
  }

  /* --- 4. Depuis le début du contrat --------------------------------- */

  function panneauDepuisDebut() {
    var c = vue.contrat;
    var jusquIci = (vue.chaine.mois || []).filter(function (e) {
      return Chaine.cmpMois(e.annee, e.mois, vue.annee, vue.mois) <= 0;
    });
    var a = Chaine.agregerPeriode(jusquIci);

    var p = Kit.pane('Depuis le début du contrat', {
      texte: 'Historique',
      onclick: function () {
        global.App.aller('historique', { contratId: c.id, annee: vue.annee, mois: vue.mois });
      }
    });
    var l = Kit.lines(p);
    Kit.ligne(l, 'Contrat démarré le', Kit.dateLongue(c.date_debut), { discret: true });
    Kit.ligne(l, 'Mois de garde', String(a.nbMois));
    Kit.ligne(l, 'Jours de présence', Kit.jours(a.joursPresence));
    Kit.ligne(l, 'Entretien versé', Kit.eur(a.entretienCentimes));
    if (vue.chaine.tronquee) {
      p.appendChild(Kit.warnbox('Historique trop long',
        'Seuls les ' + Chaine.MAX_MOIS + ' derniers mois ont été rejoués. ' +
        'Vérifiez la date de début du contrat dans sa fiche.'));
    }
    return p;
  }

  /* ------------------------------------------------------------------ */
  /* Feuille de saisie d'une journée (§2.3)                              */
  /* ------------------------------------------------------------------ */

  function ouvrirJour(d) {
    if (vue.lectureSeule) return;
    var c = vue.contrat;
    var type = Kit.typeDuJour(vue.journees, d);
    var servis = contratsServis(d);

    Kit.ouvrirFeuille(Kit.jourLong(d), c.prenom_enfant + ' — famille ' + ((c.famille && c.famille.nom) || '—'),
      function (corps) {
        if (TYPES_ABSENCE_MARIA.indexOf(type) !== -1) {
          Kit.choix(corps, 'c1', '✓', 'Finalement, je travaillais',
            'Le jour redevient normal pour ' + libelleServis(servis),
            function (ev) { retirerAbsence(d, servis, ev.currentTarget); });
          avertirVentilation(corps, d);
          avertirClos(corps, d);
          return;
        }

        if (type === 'familiarisation') {
          corps.appendChild(Kit.ce('p', 'sb q',
            'Journée de familiarisation, saisie à la main (heures réelles et indemnité). ' +
            'La modifier ci-dessous effacera ces valeurs.'));
        }

        var apercus = apercuDesChoix(d, servis);

        Kit.choix(corps, 'c1', '✓', c.prenom_enfant + ' était là',
          apercus.presence, function (ev) { poserPresence(d, ev.currentTarget); });

        Kit.choix(corps, 'c2', '−', c.prenom_enfant + ' était ' + Kit.accordDe(c, 'absent'),
          apercus.absence, function (ev) { poserAbsenceEnfant(d, ev.currentTarget); });

        /* LOT 10 (V8-09) — LE CHOIX « JE NE TRAVAILLAIS PAS » A ÉTÉ RETIRÉ.
           Il posait un `conge_maria` sur la journée, et seulement cela : la
           VENTILATION — combien sur les congés payés, combien sur la
           récupération, combien sans solde — restait décidée par le moteur,
           la même pour les quatre enfants. Or les réserves diffèrent d'un
           contrat à l'autre, et c'est justement l'arbitrage que Maria
           réclame. Un congé posé d'un doigt depuis un calendrier ne peut pas
           le lui rendre.
           Il reste deux marquages ici — présence et absence de l'enfant —, et
           les congés passent par l'onglet « Mes congés », qui les décompte
           (RG-06) et les ventile contrat par contrat. */
        corps.appendChild(Kit.ce('p', 'sb q',
          'Pour vos congés, passez par l’onglet « Mes congés » : ils valent pour ' +
          'tous vos contrats, et vous choisissez pour chacun comment ils sont décomptés.'));

        /* LOT 12 — l'ajustement des heures et la note de la journée. Repliés
           par défaut : ce sont des cas particuliers, et l'écran d'une journée
           ordinaire ne doit pas ressembler à un formulaire. */
        corps.appendChild(blocAjusterHeures(d));
        corps.appendChild(blocNoteJournee(d));

        /* Familiarisation, jour non travaillé et sans solde : rangés derrière
           une entrée discrète plutôt que supprimés. Le moteur les traite tous
           les trois (RG-14, RG-04, RG-08) et ils existent en base ; les retirer
           de l'interface obligeait à poser un congé — donc à consommer des
           congés payés — pour une journée où Maria n'était simplement pas
           demandée (relecture lot 6, R5). */
        var autre = Kit.bouton('btn nt', function () { feuilleAutresCas(d, servis); });
        autre.textContent = 'Autre cas — familiarisation, jour non travaillé…';
        corps.appendChild(autre);

        avertirClos(corps, d);
        avertirEcrasement(corps, d, servis);
      });
  }

  /* LOT 10 — retirer une journée qui appartient à une PÉRIODE VENTILÉE.

     DÉCISION D'ADRIEN, 10 août 2026 : « elle le fait elle-même à la main ».
     L'application ne recalcule JAMAIS une ventilation d'office quand une
     journée change — elle ne devine pas l'intention. Mais elle ne peut pas se
     taire non plus : le moteur écartera silencieusement la ventilation devenue
     incohérente (correctif B1 de la 2ᵉ passe du lot 9) et reprendra l'ordre du
     contrat. Maria lirait « votre choix a été écarté » sans savoir quoi faire.

     Alors on le dit AVANT le geste, et on dit quoi faire après. */
  function avertirVentilation(corps, d) {
    var periodes = (vue.imputations || []).filter(function (i) {
      return d >= i.date_debut && d <= i.date_fin;
    });
    if (!periodes.length) return;
    var i = periodes[0];
    corps.appendChild(Kit.warnbox(
      'Ce jour fait partie d’une période de congé déjà répartie',
      ' du ' + Kit.dateLongue(i.date_debut) + ' au ' + Kit.dateLongue(i.date_fin) +
      ', ' + Kit.jours(i.jours_ouvrables) + ' décomptés. En retirant ce jour, votre ' +
      'répartition ne correspondra plus à la période : elle sera écartée et l’ordre ' +
      'du contrat reprendra la main. Refaites-la depuis « Mes congés ».'));
  }

  /* Le moteur signale les périodes dont le choix de Maria a été écarté. Sans
     cet affichage, l'écart resterait invisible jusqu'au document du mois. */
  /* LOT 16 §16.1 b) — L'ENCART QUI REMPLACE L'ÉCRAN VIDE.

     Quand une répartition dépasse les réserves, la chaîne l'écarte, rejoue le
     mois dans l'ordre par défaut du contrat et porte le détail sur le maillon.
     L'encart nomme la période, ce que Maria avait choisi et ce dont elle
     dispose — trois nombres qui viennent tous du moteur — puis ouvre la
     ventilation DE CETTE PÉRIODE.

     C'est distinct du panneau ci-dessous : là, le choix a été écarté parce que
     les JOURNÉES ont changé ; ici, parce que les RÉSERVES ne suffisent pas.
     Les deux causes appellent deux phrases et deux gestes différents. */
  function panneauReservesInsuffisantes() {
    var ecartees = (vue.entree && vue.entree.imputationsEcartees) || [];
    if (!ecartees.length) return null;

    var b = Kit.warnbox(
      ecartees.length > 1
        ? 'Des répartitions de congé ne correspondent plus à vos réserves'
        : 'Une répartition de congé ne correspond plus à vos réserves',
      ' ' + ecartees.map(phraseEcartee).join(' ') +
      ' En attendant, ces congés sont décomptés dans l’ordre habituel de ce contrat.');

    var bt = Kit.bouton('btn nt', function () {
      global.App.aller('conges', {
        annee: vue.annee, mois: vue.mois, corrigerImputation: ecartees[0].id
      }, true);
    });
    bt.textContent = 'Corriger la répartition';
    b.appendChild(bt);
    return b;
  }

  /* « Du 3 au 21 août, vous aviez choisi 6 jours de récupération. Vous n'en
     avez que 5. » Les trois codes du moteur ne disent pas la même chose : on
     ne sert pas la phrase des réserves quand le problème est ailleurs. */
  function phraseEcartee(e) {
    var plage = 'Du ' + Kit.dateLongue(e.date_debut) + ' au ' + Kit.dateLongue(e.date_fin) + ', ';
    if (e.code === 'IMPUTATION_DEPASSE_RESERVES') {
      var manques = [];
      if (e.choisi.joursSurSup > e.disponible.joursSup) {
        manques.push('vous aviez choisi ' + Kit.jours(e.choisi.joursSurSup) +
          ' de récupération. Vous n’en avez que ' + Kit.jours(e.disponible.joursSup) + '.');
      }
      if (e.choisi.joursSurCp > e.disponible.joursCp) {
        manques.push('vous aviez choisi ' + Kit.jours(e.choisi.joursSurCp) +
          ' de congés payés. Vous n’en avez que ' + Kit.jours(e.disponible.joursCp) + '.');
      }
      if (manques.length) return plage + manques.join(' Et ');
      return plage + 'votre répartition dépasse ce que vos réserves couvrent.';
    }
    if (e.code === 'IMPUTATION_INCOMPLETE') {
      /* CORRECTION RELECTURE LOT 16 (B1) — LA PHRASE DISAIT QUE 5 NE COUVRE
         PAS 5. Elle affichait la SOMME de ce que Maria avait réparti, et le
         nombre qui manque — le décompte RG-06 réel de la période — n'était
         nulle part. Le moteur le pose pourtant sur l'erreur ; la chaîne le
         reprend désormais dans `attendu`. */
      var couvre = e.recu != null ? e.recu
        : e.choisi.joursSurCp + e.choisi.joursSurSup + e.choisi.joursSansSolde;
      if (e.attendu != null) {
        return plage + 'votre répartition couvre ' + Kit.jours(couvre) +
          ', alors que la période en compte ' + Kit.jours(e.attendu) +
          ' — samedis inclus.';
      }
      return plage + 'votre répartition ne correspond pas au décompte de la période.';
    }
    return plage + 'votre répartition n’est pas utilisable telle quelle.';
  }

  function panneauChoixEcartes() {
    var appliquees = (vue.entree && vue.entree.resultat &&
                      vue.entree.resultat.imputationsAppliquees) || [];
    /* Les périodes déjà traitées par l'encart des réserves ne sont pas
       redites ici : elles portent la même marque `defaut_choix_ecarte`, posée
       par la chaîne, mais leur cause et leur remède sont différents. */
    var vues = {};
    ((vue.entree && vue.entree.imputationsEcartees) || []).forEach(function (e) {
      vues[e.date_debut + '|' + e.date_fin] = true;
    });
    var ecartees = appliquees.filter(function (i) {
      if (i.source !== 'defaut_choix_ecarte') return false;
      var c = i.choixEcarte;
      return !(c && vues[c.date_debut + '|' + c.date_fin]);
    });
    if (!ecartees.length) return null;

    var b = Kit.warnbox(
      ecartees.length > 1 ? 'Deux répartitions de congés ne correspondent plus'
                          : 'Une répartition de congés ne correspond plus',
      ' ' + ecartees.map(function (i) {
        return 'du ' + Kit.dateLongue(i.date_debut) + ' au ' + Kit.dateLongue(i.date_fin);
      }).join(', ') + '. Les journées posées ont changé depuis. L’ordre du contrat ' +
      's’applique en attendant : refaites la répartition depuis « Mes congés ».');
    var lien = Kit.bouton('btn nt', function () {
      global.App.aller('conges', { annee: vue.annee, mois: vue.mois }, true);
    });
    lien.textContent = 'Ouvrir « Mes congés »';
    b.appendChild(lien);
    return b;
  }

  /* --- LOT 12 : ajuster ses heures un jour donné (V8-18) --------------

     Trois gestes, tous réversibles :
       - AJOUTER des minutes travaillées au-delà du contrat ;
       - RENONCER à des minutes dues — un geste assumé, pas un oubli ;
       - décider au cas par cas si les minutes restent dues quand l'enfant est
         absent, sans toucher au réglage du contrat (A8).

     AUCUNE VALEUR N'EST ÉCRITE EN DUR (A6, risque n° 2). Les « 30 min »
     viennent de `contrat.minutes_sup_jour` : un contrat qui en prévoit 45 le
     dira, et une constante serait fausse ce jour-là sans que rien ne le
     signale. */
  var PAS_MINUTES = 15;

  function blocAjusterHeures(d) {
    var c = vue.contrat;
    var ligne = (vue.journees || {})[d] || {};
    var type = Kit.typeDuJour(vue.journees, d);

    var etat = {
      ajoutees: ligne.minutes_sup_exceptionnelles || 0,
      renonce: (ligne.minutes_sup_renoncees || 0) > 0,
      override: ligne.sup_dues_override === undefined ? null : ligne.sup_dues_override
    };

    var det = Kit.ce('details', 'ajuster');
    var som = Kit.ce('summary', null, 'Ajuster mes heures ce jour-là');
    det.appendChild(som);
    if (etat.ajoutees > 0 || etat.renonce || etat.override !== null) det.open = true;

    var corps = Kit.ce('div', 'ajuster-corps');
    det.appendChild(corps);

    var effet = Kit.ce('div', 'effet-heures');

    /* Ce que le contrat prévoit ce jour-là, AVANT ajustement. On le demande au
       moteur plutôt que de le recalculer : c'est lui qui connaît RG-04 (une
       journée de congé ne porte aucune minute) et RG-09. */
    function base() {
      var simule = { type: type, sup_dues_override: etat.override };
      return Engine.detailSupDuJour
        ? Engine.detailSupDuJour(simule, c).base
        : (type === 'absence_enfant' && c.sup_dues_si_enfant_absent === false ? 0 : c.minutes_sup_jour);
    }

    function majEffet() {
      var b = base();
      var renoncees = etat.renonce ? b + etat.ajoutees : 0;
      var total = b + etat.ajoutees - renoncees;
      Kit.vider(effet);
      effet.appendChild(Kit.ce('b', null, 'Ce jour : ' + Kit.duree(total)));
      if (total !== c.minutes_sup_jour) {
        effet.appendChild(document.createTextNode(
          ' au lieu de ' + Kit.duree(c.minutes_sup_jour) + '.'));
      } else {
        effet.appendChild(document.createTextNode(' — comme prévu au contrat.'));
      }
    }

    corps.appendChild(compteurMinutes('Heures supplémentaires en plus',
      'Au-delà des ' + Kit.duree(c.minutes_sup_jour) + ' prévues au contrat.',
      etat, 'ajoutees', function () { majEffet(); }));

    var caseRenonce = Kit.ce('label', 'coche-ligne');
    var boxR = document.createElement('input');
    boxR.type = 'checkbox';
    boxR.checked = etat.renonce;
    boxR.addEventListener('change', function () { etat.renonce = boxR.checked; majEffet(); });
    caseRenonce.appendChild(boxR);
    var txR = Kit.ce('span', 'tx');
    txR.appendChild(Kit.ce('b', null, 'Je renonce à mes minutes'));
    txR.appendChild(Kit.ce('span', 'd',
      Kit.duree(c.minutes_sup_jour) + ' non ' + Kit.accordDe(c, 'réclamé') +
      ' ce jour-là. Vous pouvez revenir dessus à tout moment.'));
    caseRenonce.appendChild(txR);
    corps.appendChild(caseRenonce);

    /* A8 — la surcharge de RG-09 au jour, qui ne touche PAS le contrat. */
    if (type === 'absence_enfant') {
      var sel = Kit.champSelect('Quand ' + c.prenom_enfant + ' est ' + Kit.accordDe(c, 'absent') +
        ', ce jour-là', [
        ['', 'suivre le réglage du contrat'],
        ['true', 'mes minutes restent dues'],
        ['false', 'je ne les compte pas']
      ], etat.override === null ? '' : String(etat.override));
      sel.select.addEventListener('change', function () {
        etat.override = sel.select.value === '' ? null : (sel.select.value === 'true');
        majEffet();
      });
      corps.appendChild(sel.bloc);
      corps.appendChild(Kit.ce('p', 'sb q',
        'Ce choix ne vaut que pour cette journée : le réglage de la fiche contrat ' +
        'ne change pas.'));
    }

    corps.appendChild(effet);

    var b = Kit.bouton('btn nt', function () { enregistrerAjustement(d, etat, b); });
    b.textContent = 'Enregistrer cet ajustement';
    corps.appendChild(b);

    majEffet();
    return det;
  }

  /* Un compteur « − n + » au pas de 15 minutes. Le pas n'est pas cosmétique :
     au pas d'une minute, poser 1 h 15 demanderait 75 appuis. */
  function compteurMinutes(libelle, aide, cible, champ, apres) {
    var f = Kit.ce('div', 'compteur-jours');
    var lb = Kit.ce('span', 'lb');
    lb.appendChild(Kit.ce('b', null, libelle));
    if (aide) lb.appendChild(Kit.ce('span', 'd', aide));
    f.appendChild(lb);

    var grp = Kit.ce('div', 'grp');
    var val = Kit.ce('b', 'val', Kit.duree(cible[champ]));

    function poser(delta) {
      var v = cible[champ] + delta;
      if (v < 0) v = 0;
      cible[champ] = v;
      val.textContent = Kit.duree(v);
      moins.disabled = v <= 0;
      if (apres) apres();
    }
    var moins = Kit.bouton('pas', function () { poser(-PAS_MINUTES); });
    moins.textContent = '−';
    moins.setAttribute('aria-label', 'Retirer ' + PAS_MINUTES + ' minutes');
    var plus = Kit.bouton('pas', function () { poser(PAS_MINUTES); });
    plus.textContent = '+';
    plus.setAttribute('aria-label', 'Ajouter ' + PAS_MINUTES + ' minutes');
    grp.appendChild(moins);
    grp.appendChild(val);
    grp.appendChild(plus);
    f.appendChild(grp);
    moins.disabled = cible[champ] <= 0;
    return f;
  }

  function enregistrerAjustement(d, etat, bouton) {
    var c = vue.contrat;
    var ligne = (vue.journees || {})[d] || {};
    var type = Kit.typeDuJour(vue.journees, d);

    /* A7 — on n'écrit JAMAIS un renoncement supérieur au dû. Le moteur borne
       déjà (Math.min), mais laisser passer une valeur incohérente en base,
       c'est laisser un chiffre faux visible dans les données. */
    var simule = { type: type, sup_dues_override: etat.override,
                   minutes_sup_exceptionnelles: etat.ajoutees };
    var det = Engine.detailSupDuJour(simule, c);
    var renoncees = etat.renonce ? det.base + det.ajoutees : 0;

    ecrire(global.DB.enregistrerJournee({
      contrat_id: c.id, jour: d,
      type: type === 'presence' && !ligne.type ? 'presence' : (ligne.type || 'presence'),
      minutes_reelles: ligne.minutes_reelles == null ? null : ligne.minutes_reelles,
      entretien_centimes: ligne.entretien_centimes == null ? null : ligne.entretien_centimes,
      commentaire: ligne.commentaire == null ? null : ligne.commentaire,
      minutes_sup_exceptionnelles: etat.ajoutees,
      minutes_sup_renoncees: renoncees,
      sup_dues_override: etat.override
    }), bouton, 'Heures ajustées pour cette journée',
      { contrats: [c.id], jours: [d] });
  }

  /* --- LOT 12 : la note d'une journée --------------------------------- */

  function blocNoteJournee(d) {
    var c = vue.contrat;
    var ligne = (vue.journees || {})[d] || {};
    var det = Kit.ce('details', 'ajuster');
    det.appendChild(Kit.ce('summary', null, 'Un mot sur cette journée ?'));
    if (ligne.commentaire) det.open = true;

    var corps = Kit.ce('div', 'ajuster-corps');
    corps.appendChild(Kit.ce('p', 'sb q', 'Facultatif, pour vous seule.'));

    var champ = Kit.champ('Note', ligne.commentaire || '',
      { placeholder: 'Retard des parents, sortie au parc…' });
    corps.appendChild(champ.bloc);

    var b = Kit.bouton('btn nt', function () {
      var type = Kit.typeDuJour(vue.journees, d);
      ecrire(global.DB.enregistrerJournee({
        contrat_id: c.id, jour: d,
        type: ligne.type || 'presence',
        minutes_reelles: ligne.minutes_reelles == null ? null : ligne.minutes_reelles,
        entretien_centimes: ligne.entretien_centimes == null ? null : ligne.entretien_centimes,
        commentaire: String(champ.input.value || '').trim() || null,
        minutes_sup_exceptionnelles: ligne.minutes_sup_exceptionnelles || 0,
        minutes_sup_renoncees: ligne.minutes_sup_renoncees || 0,
        sup_dues_override: ligne.sup_dues_override === undefined ? null : ligne.sup_dues_override
      }), b, 'Note enregistrée', { contrats: [c.id], jours: [d] });
    });
    b.textContent = 'Enregistrer la note';
    corps.appendChild(b);

    det.appendChild(corps);
    return det;
  }

  /* Contrats qui recevront réellement une absence de Maria posée ce jour-là :
     jour de leur planning, dans leurs bornes, non férié, et — correction B1 —
     mois NON clôturé pour eux. */
  function contratsServis(d) {
    if (Feries.estJourFerie(d)) return [];
    return global.App.contrats().filter(function (c) {
      var planning = c.jours_planning || [1, 2, 3, 4, 5];
      if (planning.indexOf(Engine.jourSemaine(d)) === -1) return false;
      if (c.date_debut && d < c.date_debut) return false;
      if (c.date_fin && d > c.date_fin) return false;
      if (global.App.estClos(vue.recaps, c.id)) return false;
      return true;
    });
  }

  /* Contrats écartés parce que LEUR mois est clôturé : on le dit, on ne le
     tait pas — sans quoi Maria croirait le congé posé partout. */
  function contratsClos(d) {
    if (Feries.estJourFerie(d)) return [];
    return global.App.contrats().filter(function (c) {
      var planning = c.jours_planning || [1, 2, 3, 4, 5];
      if (planning.indexOf(Engine.jourSemaine(d)) === -1) return false;
      if (c.date_debut && d < c.date_debut) return false;
      if (c.date_fin && d > c.date_fin) return false;
      return global.App.estClos(vue.recaps, c.id);
    });
  }

  function avertirClos(corps, d) {
    var clos = contratsClos(d);
    if (!clos.length) return;
    corps.appendChild(Kit.warnbox(
      'Mois déjà clôturé pour ' + clos.map(function (c) { return c.prenom_enfant; }).join(', '),
      'Ce ' + (clos.length > 1 ? 'ces contrats ne seront pas modifiés' : 'contrat ne sera pas modifié') +
      ' : leur récapitulatif ' + Kit.deMoisAnnee(vue.annee, vue.mois) + ' est verrouillé.'));
  }

  /* Correction A5 : la pose groupée passe par un upsert qui REMPLACE la ligne
     du jour sur chaque contrat, en remettant heures réelles et entretien à
     null. Une journée de familiarisation d'un autre contrat serait donc
     effacée sans retour possible. On le dit avant, contrat par contrat. */
  function journeesEcrasees(d, servis) {
    var perdues = [];
    servis.forEach(function (c) {
      if (c.id === vue.contrat.id) return;
      var j = vue.journeesAutres[c.id];
      if (!j) return;
      var ligne = j[d];
      if (!ligne) return;
      if (ligne.type === 'familiarisation' ||
          ligne.minutes_reelles != null || ligne.entretien_centimes != null) {
        perdues.push(c);
      }
    });
    return perdues;
  }

  function avertirEcrasement(corps, d, servis) {
    var perdues = journeesEcrasees(d, servis);
    if (!perdues.length) return;
    corps.appendChild(Kit.warnbox(
      'Une saisie manuelle sera remplacée chez ' +
      perdues.map(function (c) { return c.prenom_enfant; }).join(', '),
      'Cette journée y porte des heures réelles ou une indemnité saisies à la main ' +
      '(familiarisation). Poser un congé les efface sans possibilité de les retrouver.'));
  }

  function libelleServis(servis) {
    if (!servis.length) return 'aucun contrat';
    if (servis.length === 1) return servis[0].prenom_enfant;
    return 'les ' + servis.length + ' enfants';
  }
  /* « appliqué à les 3 enfants » ne se dit pas. */
  function libelleServisA(servis) {
    if (!servis.length) return 'aucun contrat';
    if (servis.length === 1) return servis[0].prenom_enfant;
    return 'aux ' + servis.length + ' enfants';
  }

  /* Les effets annoncés sont CALCULÉS PAR LE MOTEUR (§4 des specs). */
  function apercuDesChoix(d, servis) {
    var actuel = vue.entree.resultat;
    var typeActuel = Kit.typeDuJour(vue.journees, d);

    var presence = typeActuel === 'presence'
      ? 'C’est déjà le cas — rien à faire'
      : phraseEcart(simuler(d, 'presence'), actuel);

    var absence = phraseAbsence(simuler(d, 'absence_enfant'), actuel);

    /* Correction A2 : le décompte d'un même jour n'est PAS le même pour tous
       les contrats — un contrat du lundi au jeudi voit un jeudi compter 3 jours
       ouvrables (jeudi, vendredi, samedi ; reprise le lundi, RG-06) là où un
       contrat du lundi au vendredi n'en compte qu'un. On interroge le moteur
       pour chacun et on annonce l'étendue réelle plutôt qu'un chiffre unique. */
    var decomptes = servis.map(function (c) {
      return Engine.decompterJoursOuvrables(d, d, c.jours_planning || [1, 2, 3, 4, 5]);
    });
    var mini = decomptes.length ? Math.min.apply(null, decomptes) : 0;
    var maxi = decomptes.length ? Math.max.apply(null, decomptes) : 0;
    var conge = servis.length
      ? 'Congé posé pour ' + libelleServis(servis) + ', ' +
        (mini === maxi ? '−' + mini + ' jour' + (mini > 1 ? 's' : '')
                       : 'de −' + mini + ' à −' + maxi + ' jours selon les plannings')
      : 'Aucun contrat ne peut recevoir ce congé';

    return { presence: presence, absence: absence, conge: conge };
  }

  /* Rejoue le mois avec la journée `d` forcée au type `type`. Fonction pure. */
  function simuler(d, type, extra) {
    var lignes = [];
    Object.keys(vue.journees).forEach(function (k) {
      if (k !== d) lignes.push(vue.journees[k]);
    });
    if (type !== 'presence') {
      lignes.push({
        contrat_id: vue.contrat.id, jour: d, type: type,
        minutes_reelles: extra ? extra.minutes_reelles : null,
        entretien_centimes: extra ? extra.entretien_centimes : null
      });
    }
    var salaire = vue.entree.salaire || { brut_mensuel_centimes: 0, net_mensuel_centimes: 0 };
    /* LOT 16 §16.1 — MÊME REPLI QUE LA CHAÎNE. Sans lui, un mois dont la
       ventilation ne tient plus s'affichait bien (la chaîne se replie) mais
       toucher un jour faisait retomber cet aperçu sur l'exception : la feuille
       du jour devenait inutilisable sur le mois précisément à corriger.
       Une seule règle de repli, définie dans chaine-mois.js, appelée ici. */
    return Chaine.calculerMoisAvecRepli({
      contrat: vue.contrat,
      salaire: { brut_mensuel_centimes: salaire.brut_mensuel_centimes,
                 net_mensuel_centimes: salaire.net_mensuel_centimes },
      journees: lignes,
      compteurEntree: vue.entree.compteurEntree,
      annee: vue.annee,
      mois: vue.mois,
      /* Correctif B1 de la relecture PR9 — ce rejeu doit voir EXACTEMENT ce que
         voit la chaîne, imputations comprises. Sans elles, l'aperçu « voilà ce
         que ce geste change » comparait un mois ventilé selon le choix de Maria
         à un mois ventilé selon l'ordre par défaut : l'écart affiché n'était pas
         celui du geste, mais celui de l'oubli. */
      imputations: vue.imputations || []
    }).resultat;
  }

  function phraseEcart(apres, avant) {
    var delta = (apres.entretienCentimes || 0) - (avant.entretienCentimes || 0);
    if (delta > 0) return 'Entretien de la journée rétabli (+' + Kit.eur(delta) + ')';
    if (delta < 0) return 'Entretien de la journée retiré (−' + Kit.eur(-delta) + ')';
    return 'Journée comptée comme travaillée';
  }

  function phraseAbsence(apres, avant) {
    var deltaEntretien = (apres.entretienCentimes || 0) - (avant.entretienCentimes || 0);
    var deltaSup = (apres.minutesSupAcquises || 0) - (avant.minutesSupAcquises || 0);
    var phrase = deltaEntretien < 0
      ? 'Pas d’entretien ce jour (−' + Kit.eur(-deltaEntretien) + ').'
      : 'Pas d’entretien ce jour.';
    /* RG-09 : les minutes restent dues, sauf si le paramètre du contrat dit le
       contraire. La phrase suit le paramètre, elle ne le devine pas. */
    if (deltaSup === 0) {
      phrase += ' Vos ' + Kit.duree(vue.contrat.minutes_sup_jour) + ' restent dues';
    } else if (deltaSup < 0) {
      phrase += ' Vos ' + Kit.duree(deltaSup) + ' ne sont pas dues sur ce contrat';
    } else {
      phrase += ' Cette journée vous rend ' + Kit.duree(deltaSup) + ' de récupération';
    }
    return phrase;
  }

  /* ------------------------------------------------------------------ */
  /* Autres cas : familiarisation, jour non travaillé, sans solde        */
  /* ------------------------------------------------------------------ */

  function feuilleAutresCas(d, servis) {
    var c = vue.contrat;
    Kit.ouvrirFeuille(Kit.jourLong(d), 'Cas particuliers — ' + c.prenom_enfant,
      function (corps) {
        Kit.choix(corps, 'c1', '⏱', 'Journée de familiarisation',
          'Rémunérée au réel, à l’heure (RG-14). Heures et indemnité saisies à la main. ' +
          'Ne concerne que ' + c.prenom_enfant + '.',
          function () { feuilleFamiliarisation(d); });

        Kit.choix(corps, 'c3', '⊘', 'Je n’étais pas demandée, sans poser de congé',
          'La famille était fermée. Journée neutre : ni entretien, ni heures sup, ' +
          'et AUCUN congé payé consommé. S’applique ' + libelleServisA(servis) + '.',
          function (ev) { poserTypeGroupe(d, servis, 'hors_planning', ev.currentTarget,
            'Journée notée non travaillée'); });

        Kit.choix(corps, 'c2', '−', 'Congé sans solde',
          'Retenue sur le salaire (RG-08), aucun compteur consommé. ' +
          'S’applique ' + libelleServisA(servis) + '.',
          function (ev) { poserTypeGroupe(d, servis, 'sans_solde', ev.currentTarget,
            'Journée notée sans solde'); });

        avertirClos(corps, d);
        avertirEcrasement(corps, d, servis);
      });
  }

  /* Durée saisie -> minutes entières. « 3h30 », « 3h », « 3 », « 3,5 ». Un
     nombre nu se lit en HEURES, conformément au libellé du champ. */
  function parseHeures(txt) {
    if (!txt) return null;
    var t = String(txt).trim().toLowerCase().replace(',', '.');
    var m = t.match(/^(\d+)\s*h\s*(\d{0,2})$/);
    if (m) return parseInt(m[1], 10) * 60 + (m[2] ? parseInt(m[2], 10) : 0);
    if (/^\d+(\.\d+)?$/.test(t)) return Math.round(parseFloat(t) * 60);
    return null;
  }

  function feuilleFamiliarisation(d) {
    var ligne = vue.journees[d] || {};
    Kit.ouvrirFeuille('Familiarisation — ' + Kit.jourLong(d),
      'Rémunération au réel, hors mensualisation (RG-14).',
      function (corps) {
        var h = Kit.champ('Heures réelles',
          ligne.minutes_reelles != null ? Kit.heures(ligne.minutes_reelles) : '',
          { placeholder: '3h30' });
        corps.appendChild(h.bloc);
        var e = Kit.champ('Indemnité d’entretien du jour',
          ligne.entretien_centimes != null
            ? (ligne.entretien_centimes / 100).toFixed(2).replace('.', ',') : '',
          { placeholder: '5,00', inputmode: 'decimal' });
        corps.appendChild(e.bloc);

        var msg = Kit.ce('div', 'msg');
        corps.appendChild(msg);
        var b = Kit.bouton('btn', function () {
          var minutes = parseHeures(h.input.value);
          if (minutes == null || minutes <= 0) {
            msg.className = 'msg ko';
            msg.textContent = 'Saisissez les heures réelles (exemple : 3h30).';
            return;
          }
          var centimes = Kit.parseEuros(e.input.value);
          ecrire(global.DB.enregistrerJournee({
            contrat_id: vue.contrat.id, jour: d, type: 'familiarisation',
            minutes_reelles: minutes,
            entretien_centimes: centimes == null ? null : centimes,
            commentaire: null
          }), b, 'Journée de familiarisation enregistrée',
            { contrats: [vue.contrat.id], jours: [d] });
        });
        b.textContent = 'Enregistrer';
        corps.appendChild(b);
      });
  }

  /* ------------------------------------------------------------------ */
  /* Écritures                                                           */
  /* ------------------------------------------------------------------ */

  /* Un échec d'écriture doit se VOIR, et la feuille RESTE ouverte : la saisie
     en cours ne disparaît pas sous les doigts de Maria (§3 des specs). */
  /* LOT 7 — « ANNULER » APRÈS ÉCRITURE (§6.8, V8-21).

     Toute écriture de journée est désormais rétractable tant que le message de
     confirmation est affiché. C'est le geste groupé qui le justifie : « 5
     journées notées » posé d'un doigt sur quatre contrats à la fois est
     exactement le genre de chose qu'on fait par erreur, et défaire cinq
     journées à la main, une par une, sur quatre enfants, personne ne le fait.

     CE QUE « ANNULER » NE COUVRE PAS : la clôture d'un mois.
     La spécification demandait de pouvoir annuler une clôture SANS écrire
     d'événement de réouverture. Ce n'est plus possible : depuis le correctif
     B1 du lot 13, la base écrit elle-même l'événement dès qu'un statut change,
     quel que soit le chemin — c'était tout l'objet de la correction, et une
     réouverture sans trace ne doit plus pouvoir exister. Entre le confort d'une
     annulation et la garantie que l'historique dit vrai, on garde la garantie.
     Maria qui s'est trompée rouvre le mois normalement, avec un motif : le
     chemin existe depuis le lot 13.
     // DÉCISION EN ATTENTE : arbitrage signalé à Adrien, réponse par défaut.

     `retour` = { contrats: [id…], jours: ['YYYY-MM-DD'…] } — l'empreinte de ce
     qui va changer, prise AVANT l'écriture. */
  function ecrire(promesse, bouton, messageOk, retour) {
    if (vue.lectureSeule) {
      Kit.toast('Ce mois est clôturé : il ne peut plus être modifié.', true);
      return Promise.resolve();
    }
    var avant = retour ? empreinte(retour.contrats, retour.jours) : null;
    if (bouton) bouton.disabled = true;
    return promesse
      .then(function () {
        global.App.invalider();
        Kit.fermerFeuille();
        Kit.toast(messageOk, false, avant ? {
          libelle: 'Annuler',
          delai: 5000,
          onclick: function () { restaurer(avant); }
        } : null);
        return global.App.rafraichir();
      })
      .catch(function (e) {
        if (bouton) bouton.disabled = false;
        Kit.toast('Enregistrement impossible : ' + Kit.messageErreur(e) + ' Rien n’a été modifié.', true);
      });
  }

  /* L'état ANTÉRIEUR des journées visées, lu dans ce que l'écran a déjà en
     mémoire — aucun aller-retour réseau avant l'écriture, sans quoi le geste
     de Maria attendrait deux fois. */
  function empreinte(contratIds, jours) {
    var lignes = [];
    (contratIds || []).forEach(function (id) {
      var source = id === vue.contrat.id ? vue.journees : vue.journeesAutres[id];
      if (!source) return;                      // journées non chargées : on ne devine pas
      (jours || []).forEach(function (d) {
        lignes.push({ contratId: id, jour: d, ligne: source[d] || null });
      });
    });
    return lignes.length ? lignes : null;
  }

  /* Remet chaque journée dans son état antérieur, EN UNE FOIS. Une ligne qui
     existait est réécrite telle quelle ; une ligne qui n'existait pas est
     supprimée — c'est la saisie par exception : l'absence de ligne est un état,
     pas un vide. */
  function restaurer(avant) {
    var gestes = avant.map(function (x) {
      if (!x.ligne) return global.DB.supprimerJournee(x.contratId, x.jour);
      var l = x.ligne;
      return global.DB.enregistrerJournee({
        contrat_id: x.contratId, jour: x.jour, type: l.type,
        minutes_reelles: l.minutes_reelles, entretien_centimes: l.entretien_centimes,
        commentaire: l.commentaire,
        minutes_sup_exceptionnelles: l.minutes_sup_exceptionnelles,
        minutes_sup_renoncees: l.minutes_sup_renoncees,
        sup_dues_override: l.sup_dues_override
      });
    });
    return Promise.all(gestes)
      .then(function () {
        global.App.invalider();
        Kit.toast(avant.length > 1 ? 'C’est annulé — ' + avant.length + ' journées remises comme avant.'
                                   : 'C’est annulé.');
        return global.App.rafraichir();
      })
      .catch(function (e) {
        /* B.0-9 : ne jamais laisser croire qu'une annulation a marché. */
        Kit.toast('L’annulation n’a pas abouti : ' + Kit.messageErreur(e) +
          ' Votre modification est toujours enregistrée.', true);
        return global.App.rafraichir();
      });
  }

  function poserPresence(d, bouton) {
    if (Kit.typeDuJour(vue.journees, d) === 'presence') { Kit.fermerFeuille(); return; }
    ecrire(global.DB.supprimerJournee(vue.contrat.id, d), bouton, 'Journée enregistrée',
      { contrats: [vue.contrat.id], jours: [d] });
  }

  function poserAbsenceEnfant(d, bouton) {
    ecrire(global.DB.enregistrerJournee({
      contrat_id: vue.contrat.id, jour: d, type: 'absence_enfant',
      minutes_reelles: null, entretien_centimes: null, commentaire: null
    }), bouton, vue.contrat.prenom_enfant + ' ' + Kit.accordDe(vue.contrat, 'noté') +
      ' ' + Kit.accordDe(vue.contrat, 'absent'),
      { contrats: [vue.contrat.id], jours: [d] });
  }

  /* `poserConge` A ÉTÉ SUPPRIMÉE ICI (lot 10, V8-09). C'était le seul appelant
     du choix « Je ne travaillais pas » de la feuille de journée. Un congé posé
     depuis le calendrier écrivait la journée mais laissait la VENTILATION au
     moteur, identique pour les quatre enfants — exactement ce que le lot 10
     rend à Maria. Le chemin des congés est désormais unique : l'onglet
     « Mes congés ». `poserTypeGroupe` reste : le sans-solde et le jour non
     travaillé de « Autre cas » l'utilisent encore. */

  /* Écrit une absence de Maria sur TOUS les contrats servis, en une seule
     écriture, chacun avec SON propre jour. */
  function poserTypeGroupe(d, servis, type, bouton, messageOk) {
    if (!servis.length) {
      Kit.toast('Aucun contrat ne peut recevoir cette journée : ' +
        'elle est hors planning, fériée, ou son mois est déjà clôturé.', true);
      return;
    }
    var affectations = servis.map(function (c) { return { contratId: c.id, jours: [d] }; });
    ecrire(global.DB.poserAbsenceMaria(affectations, type, null), bouton, messageOk,
      { contrats: servis.map(function (c) { return c.id; }), jours: [d] });
  }

  function retirerAbsence(d, servis, bouton) {
    var ids = servis.map(function (c) { return c.id; });
    if (ids.indexOf(vue.contrat.id) === -1 && !global.App.estClos(vue.recaps, vue.contrat.id)) {
      ids.push(vue.contrat.id);
    }
    if (!ids.length) {
      Kit.toast('Aucun contrat modifiable pour ce jour.', true);
      return;
    }
    ecrire(global.DB.retirerAbsenceMaria(ids, [d], TYPES_ABSENCE_MARIA), bouton,
      'Congé retiré ' + libelleServisA(servis),
      { contrats: ids, jours: [d] });
  }

  global.UiEnfant = {
    afficher: afficher,
    TYPES_ABSENCE_MARIA: TYPES_ABSENCE_MARIA,
    MOIS_A_VENIR_VISIBLES: MOIS_A_VENIR_VISIBLES
  };
})(window);
