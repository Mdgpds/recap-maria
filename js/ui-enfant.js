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
      }))
    ]).then(function (r) {
      var chaine = r[0];
      var entree = global.App.moisDe(chaine, m.annee, m.mois);
      var journeesAutres = {};
      r[3].forEach(function (x) { journeesAutres[x.id] = x.jours; });

      var maintenant = global.App.moisCourant();
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
        range: !!contrat.archive
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
    }

    corps.appendChild(panneauCalendrier());

    if (!vue.entree) {
      corps.appendChild(Kit.ce('p', 'vide',
        'Le contrat de ' + c.prenom_enfant + ' ne couvre pas ' +
        Kit.libelleMoisAnnee(vue.annee, vue.mois) + '.'));
      corps.appendChild(boutonFiche());
      return;
    }

    corps.appendChild(panneauMois());
    corps.appendChild(panneauCompteurs());
    corps.appendChild(panneauDepuisDebut());
    corps.appendChild(boutonFiche());
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
    legende(lg, 'g1', 'Présent·e');
    legende(lg, 'g2', 'Absent·e');
    legende(lg, 'g5', 'Mon congé');
    legende(lg, 'g3', 'Férié');
    p.appendChild(lg);
    return p;
  }

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

    var classe, mini = null, touchable = false;
    if (horsBornes) { classe = 'we no'; }
    else if (type === 'ferie') { classe = 'fe no'; mini = 'férié'; }
    else if (horsPlanning) { classe = 'we no'; }
    else if (type === 'conge_maria') { classe = 'cg'; mini = 'congé'; touchable = true; }
    else if (type === 'sans_solde') { classe = 'cg'; mini = 'ss solde'; touchable = true; }
    else if (type === 'hors_planning') { classe = 'we'; mini = 'non trav.'; touchable = true; }
    else if (type === 'familiarisation') { classe = 'ok'; mini = 'familia.'; touchable = true; }
    else if (type === 'absence_enfant') { classe = 'ab'; mini = 'abs.'; touchable = true; }
    else { classe = 'ok'; touchable = true; }

    var td = Kit.ce('td', classe + (touchable && vue.lectureSeule ? ' no' : ''));
    td.appendChild(Kit.ce('div', 'num', String(jour)));
    if (mini) td.appendChild(Kit.ce('div', 'mini', mini));

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

        Kit.choix(corps, 'c2', '−', c.prenom_enfant + ' était ' + Kit.accord('absent'),
          apercus.absence, function (ev) { poserAbsenceEnfant(d, ev.currentTarget); });

        Kit.choix(corps, 'c3', '☾', 'Je ne travaillais pas',
          apercus.conge, function (ev) { poserConge(d, servis, ev.currentTarget); });

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
      ' : leur récapitulatif de ' + Kit.libelleMoisAnnee(vue.annee, vue.mois) + ' est verrouillé.'));
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
    return Engine.calculerMois({
      contrat: vue.contrat,
      salaire: { brut_mensuel_centimes: salaire.brut_mensuel_centimes,
                 net_mensuel_centimes: salaire.net_mensuel_centimes },
      journees: lignes,
      compteurEntree: vue.entree.compteurEntree,
      annee: vue.annee,
      mois: vue.mois
    });
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
          }), b, 'Journée de familiarisation enregistrée');
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
  function ecrire(promesse, bouton, messageOk) {
    if (vue.lectureSeule) {
      Kit.toast('Ce mois est clôturé : il ne peut plus être modifié.', true);
      return Promise.resolve();
    }
    if (bouton) bouton.disabled = true;
    return promesse
      .then(function () {
        global.App.invalider();
        Kit.fermerFeuille();
        Kit.toast(messageOk);
        return global.App.rafraichir();
      })
      .catch(function (e) {
        if (bouton) bouton.disabled = false;
        Kit.toast('Enregistrement impossible : ' + Kit.messageErreur(e) + ' Rien n’a été modifié.', true);
      });
  }

  function poserPresence(d, bouton) {
    if (Kit.typeDuJour(vue.journees, d) === 'presence') { Kit.fermerFeuille(); return; }
    ecrire(global.DB.supprimerJournee(vue.contrat.id, d), bouton, 'Journée enregistrée');
  }

  function poserAbsenceEnfant(d, bouton) {
    ecrire(global.DB.enregistrerJournee({
      contrat_id: vue.contrat.id, jour: d, type: 'absence_enfant',
      minutes_reelles: null, entretien_centimes: null, commentaire: null
    }), bouton, vue.contrat.prenom_enfant + ' ' + Kit.accord('noté') + ' ' + Kit.accord('absent'));
  }

  function poserConge(d, servis, bouton) {
    poserTypeGroupe(d, servis, 'conge_maria', bouton,
      'Congé posé — appliqué ' + libelleServisA(servis));
  }

  /* Écrit une absence de Maria sur TOUS les contrats servis, en une seule
     écriture, chacun avec SON propre jour. */
  function poserTypeGroupe(d, servis, type, bouton, messageOk) {
    if (!servis.length) {
      Kit.toast('Aucun contrat ne peut recevoir cette journée : ' +
        'elle est hors planning, fériée, ou son mois est déjà clôturé.', true);
      return;
    }
    var affectations = servis.map(function (c) { return { contratId: c.id, jours: [d] }; });
    ecrire(global.DB.poserAbsenceMaria(affectations, type, null), bouton, messageOk);
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
      'Congé retiré ' + libelleServisA(servis));
  }

  global.UiEnfant = {
    afficher: afficher,
    TYPES_ABSENCE_MARIA: TYPES_ABSENCE_MARIA,
    MOIS_A_VENIR_VISIBLES: MOIS_A_VENIR_VISIBLES
  };
})(window);
