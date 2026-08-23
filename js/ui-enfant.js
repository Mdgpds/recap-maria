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
  /* LOT 17 §17.6 — la barre des congés payés est graduée en JOURS, plus en
     dixièmes : 30 jours ouvrables, c'est l'acquisition d'une année pleine
     (RG-11). Sa conversion en minutes demande le facteur du contrat, qui vient
     des conditions du mois. */
  var BARRE_CP_EN_JOURS = 30;

  /* Jusqu'où la navigation du calendrier peut aller au-delà du mois courant.
     Correction A13 : « Mes congés » propose de poser jusqu'à vingt semaines en
     avant ; sans cette borne, un congé d'été posé en mai devenait invisible et
     impossible à retirer avant le 1er juillet. */
  var MOIS_A_VENIR_VISIBLES = 12;

  var vue = null;   // état de l'écran affiché

  /* ------------------------------------------------------------------ */
  /* Affichage                                                           */
  /* ------------------------------------------------------------------ */

  /* LOT 17 §17.3 — LES CONDITIONS DU MOIS AFFICHÉ.

     Tous les réglages que cet écran montre — le planning du calendrier, les
     minutes supplémentaires d'une journée, l'indemnité d'entretien — sont
     ceux de l'AVENANT en vigueur ce mois-là, jamais ceux de `contrat`. Un
     écran qui lirait `contrat` afficherait les conditions d'aujourd'hui sur un
     mois d'il y a deux ans, et un document déjà remis à une famille changerait
     sous les yeux de Maria. Un mois figé porte les conditions de son époque :
     la chaîne les a résolues et les transporte sur le maillon. */
  function cond() {
    return (vue && vue.entree && vue.entree.conditions) || null;
  }

  /* Un réglage, avec un repli EXPLICITE quand les conditions manquent — un
     mois antérieur au contrat, ou une chaîne en échec. Le repli ne prétend
     jamais être une valeur du contrat. */
  function reg(champ, defaut) {
    var c = cond();
    return (c && c[champ] != null) ? c[champ] : defaut;
  }

  function planningDuMois() { return reg('jours_planning', [1, 2, 3, 4, 5]); }
  function mpjc() { return reg('minutes_par_jour_conge', 0); }

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
      /* CORRECTION B3 DE LA RELECTURE DU LOT 20 — LES PÉRIODES ENTRENT DANS
         `vue`, comme les imputations, et pour exactement la même raison.

         `simulerLignes` rejoue le mois pour montrer l'effet d'un geste AVANT
         qu'il soit enregistré. Il ne recevait pas les périodes : le moteur
         voyait une liste vide, chaque jour non déclaré redevenait une présence
         mensualisée, et le résultat était soustrait d'un `vue.entree.resultat`
         qui, lui, connaissait la période. On soustrayait deux mois différents,
         et l'écran annonçait « + 82,50 € » là où le geste en vaut 5,50.

         C'est mot pour mot le défaut que le correctif B1 de la PR9 avait éteint
         pour les imputations, dans ce même appel. Contrairement à elles, un
         échec de lecture ici n'est PAS rattrapable : sans les périodes le rejeu
         est faux, pas incomplet. L'erreur remonte donc et l'écran la dit. */
      global.DB.listPeriodesFamiliarisation(
        contrat.id,
        Kit.iso(m.annee, m.mois, 1),
        Kit.iso(m.annee, m.mois, Kit.nbJoursDansMois(m.annee, m.mois))),
      /* Lot 12 — la note du mois. Un échec ici ne vide pas l'écran : on perd
         un espace d'écriture, pas un chiffre. */
      global.DB.getNoteMensuelle(contrat.id, m.annee, m.mois).catch(function () { return null; })
    ]).then(function (r) {
      /* L'ordre des résultats suit celui du tableau ci-dessus. Une insertion au
         milieu décalerait tout : les index sont donc nommés une fois, ici. */
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
        restants: Kit.joursTravaillesRestants(
          contrat, (entree && entree.conditions && entree.conditions.jours_planning) || null,
          m.annee, m.mois, auj, r[1]),
        /* Lot 10 — les périodes de congé ventilées qui touchent ce mois. */
        imputations: r[4] || [],
        /* Lot 20, correction B3 — les périodes de familiarisation du mois. */
        periodesFamiliarisation: r[5] || [],
        note: r[6] || null,
        /* LOT 20 (§20.4) — LA FAMILIARISATION DU MOIS, TELLE QUE LE MOTEUR LA
           VOIT. On ne la recalcule pas ici : `resultat.familiarisation.jours`
           porte, pour chaque jour du planning compris dans une période, ce qui
           est déclaré et si l'indemnité est comptée. L'écran n'ajoute qu'une
           chose, la seule que le moteur ne peut pas savoir : quel jour on est.
           `null` quand aucune période ne touche ce mois. */
        famJours: famJoursDe(entree),
        /* LOT 18 §18.1 — le mode « marquer plusieurs jours ». `null` = mode
           ordinaire. L'écran se redessine sans repasser par le réseau : entrer
           et sortir du mode ne doit rien recharger. */
        selection: null,
        corps: ctx.corps
      };
      vue.lectureSeule = vue.range || vue.clos;
      Kit.vider(ctx.corps);
      rendre(ctx.corps);

      /* LOT 20 (§20.4 d) — ARRIVÉE DEPUIS L'ÉCRAN DE LA PÉRIODE. Toucher un
         jour là-bas ouvre sa feuille ICI, dans le mois du jour : la feuille de
         saisie vit à un seul endroit, et Maria voit l'effet de sa déclaration
         sur le mois au moment où elle la fait. Le paramètre est ignoré si le
         jour n'est pas (ou plus) dans une période : un jour qu'on aurait sorti
         de la période entre-temps ne doit pas ouvrir une feuille qui ne
         correspond plus à rien. */
      if (ctx.params.jour && !vue.lectureSeule && enFamiliarisation(ctx.params.jour)) {
        feuilleFamiliarisation(ctx.params.jour);
      }
    });
  }

  /* LOT 20 (§20.4 b) — « DÉCLAREZ LES HEURES D'AUJOURD'HUI ».

     Ne s'affiche que si AUJOURD'HUI tombe dans la période et que le mois
     affiché est bien celui d'aujourd'hui : sur un mois passé, l'encart
     réclamerait une déclaration pour un jour qui n'est pas dans l'écran, et le
     bouton ouvrirait une feuille sur une case invisible. */
  function encartFamiliarisationDuJour() {
    if (!vue || vue.lectureSeule) return null;
    var d = vue.aujourdhui;
    if (!d || d.slice(0, 7) !== vue.annee + '-' + String(vue.mois).padStart(2, '0')) return null;
    var etat = vue.famJours && vue.famJours[d];
    if (!etat) return null;

    /* `note` pour l'état paisible, `warnbox` pour l'orange qui réclame : ce
       sont les deux boîtes de l'application, et l'orange n'apparaît que là où
       Maria a quelque chose à faire. */
    var boite = Kit.ce('div', etat.declare ? 'note' : 'warnbox');
    if (etat.declare) {
      boite.appendChild(Kit.ce('b', null, 'Aujourd’hui — ' + Kit.heures(etat.minutes) +
        ' déclarées' + (etat.entretien ? ' · entretien compté' : ' · sans entretien')));
      var bc = Kit.bouton('btn sm nt', function () { feuilleFamiliarisation(d); });
      bc.textContent = 'Corriger';
      boite.appendChild(bc);
      return boite;
    }
    boite.appendChild(Kit.ce('b', null, 'Déclarez les heures d’aujourd’hui'));
    boite.appendChild(Kit.ce('div', null,
      'Pendant la familiarisation, seules les heures déclarées sont payées.'));
    var b = Kit.bouton('btn sm', function () { feuilleFamiliarisation(d); });
    b.textContent = 'Déclarer maintenant';
    boite.appendChild(b);
    return boite;
  }

  /* Le détail jour par jour de la familiarisation du mois, indexé par date.
     Rendu `null` — et non un objet vide — quand aucune période ne touche le
     mois : `null` dit « il n'y a pas de familiarisation ici », un objet vide
     dirait « il y en a une, et elle est vide ». Les deux ne s'affichent pas
     pareil. */
  function famJoursDe(entree) {
    var f = entree && entree.resultat && entree.resultat.familiarisation;
    if (!f || !f.actif) return null;
    var parJour = {};
    (f.jours || []).forEach(function (x) { parJour[x.jour] = x; });
    return parJour;
  }

  /* Ce jour tombe-t-il dans une période de familiarisation ? */
  function enFamiliarisation(d) {
    return !!(vue && vue.famJours && vue.famJours[d]);
  }

  /* Redessine l'écran à partir de ce qui est DÉJÀ en mémoire. Aucun appel
     réseau : c'est ce qui rend l'entrée et la sortie du mode sélection
     instantanées, et ce qui garantit que les chiffres affichés sont les mêmes
     avant et après (§18.1 A2 — ils viennent du même `vue`). */
  function redessiner() {
    if (!vue || !vue.corps) return;
    Kit.vider(vue.corps);
    rendre(vue.corps);
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

    /* LOT 20 (§20.4 b) — L'ENCART DU JOUR, TOUT EN HAUT.
       Pendant la familiarisation, la seule chose qui compte est de déclarer
       les heures du jour : elle est donc au-dessus des chiffres. */
    var encartFam = encartFamiliarisationDuJour();
    if (encartFam) corps.appendChild(encartFam);

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

    /* Le pied de sélection vient EN DERNIER et se fixe en bas de l'écran : il
       doit rester visible pendant que Maria fait défiler le calendrier, sans
       quoi le compte et l'effet chiffré ne servent à rien. */
    if (vue.selection) corps.appendChild(piedSelection());
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

    /* LOT 18 §18.4 (7·A5) — LE BANDEAU DU 25.

       L'état « à clôturer » est juste : dès le 25, Maria connaît l'essentiel
       de son mois et la tuile doit apparaître à l'accueil. Mais la PHRASE ne
       l'était pas : du 25 au 31, l'espace enfant affirmait « Ce mois est
       terminé » d'un mois qui court encore, et la mention « Chiffres
       provisoires » disparaissait le jour même où elle devient la plus utile —
       il reste des journées à venir, et le total affiché va encore bouger.

       Un mois ÉCHU garde le bandeau d'origine : là, il est vrai. */
    if (moisEnCours()) {
      return Kit.note('Chiffres provisoires — le mois n’est pas fini',
        (vue.restants > 0
          ? 'Il reste ' + phraseJoursRestants(vue.restants) + ' en ' +
            Kit.libelleMois(vue.mois) + '. '
          : '') +
        'Vous pouvez déjà vérifier les journées ; la clôture attendra la fin du mois.');
    }

    return Kit.warnbox('Ce mois est terminé',
      'Vérifiez les journées, puis clôturez-le.');
  }

  /* Le mois affiché est-il le mois COURANT ? Comparé à `vue.aujourdhui`, lue
     une seule fois à l'ouverture de l'écran : aucune fonction ne relit
     l'horloge, sans quoi le comportement du 25 redeviendrait invérifiable. */
  function moisEnCours() {
    var auj = String(vue.aujourdhui || '');
    if (auj.length < 7) return false;
    return Number(auj.slice(0, 4)) === vue.annee && Number(auj.slice(5, 7)) === vue.mois;
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
    var planning = planningDuMois();
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
    p.appendChild(barreMultiSelection());
    return p;
  }

  /* ------------------------------------------------------------------ */
  /* LOT 18 §18.1 — MARQUER PLUSIEURS JOURS D'UN COUP (décision V8-10)   */
  /*                                                                     */
  /* La décision existait depuis la maquette v8 et n'avait jamais reçu de */
  /* paragraphe de spécification : ce n'est pas un oubli du développeur   */
  /* précédent, il n'a jamais reçu l'exigence.                            */
  /*                                                                     */
  /* DEUX MARQUAGES, PAS TROIS. « Mon congé » n'entre pas ici : un congé  */
  /* de Maria vaut pour ses quatre contrats et porte une ventilation      */
  /* entre congés payés, récupération et sans solde. Le poser depuis le   */
  /* calendrier d'un seul enfant reviendrait à écrire les journées en     */
  /* laissant la ventilation au moteur — exactement ce que le lot 10 a    */
  /* rendu à Maria.                                                       */
  /*                                                                     */
  /* L'EFFET CHIFFRÉ EST REJOUÉ PAR LE MOTEUR (B.0-5). Aucun « 5 × 5,50 » */
  /* n'est écrit ici : le mois entier est recalculé avec les journées     */
  /* sélectionnées, et l'écart affiché est la différence entre deux       */
  /* résultats du moteur. C'est ce qui rend l'annonce et le résultat      */
  /* identiques par construction (A2).                                    */
  /* ------------------------------------------------------------------ */

  function barreMultiSelection() {
    var c = vue.contrat;
    var bloc = Kit.ce('div', 'multi');

    /* Un mois clôturé ou un contrat rangé n'entre pas en mode sélection : le
       bouton n'apparaît pas du tout. Un bouton qui refuse est pire qu'un
       bouton absent — il laisse croire à une panne. Un mois à venir non plus :
       on ne saisit pas l'avenir (V8-05). */
    if (vue.lectureSeule || vue.aVenir || !vue.entree) return bloc;

    if (vue.selection) {
      var bStop = Kit.bouton('btn nt', function () { quitterSelection(); });
      bStop.textContent = 'Quitter la sélection';
      bloc.appendChild(bStop);
      return bloc;
    }

    var t = Kit.ce('div', 'multi-tt');
    t.appendChild(Kit.ce('b', null, 'Marquer plusieurs jours d’un coup'));
    t.appendChild(Kit.ce('span', null,
      'Absences de ' + c.prenom_enfant + ', ou retour à la présence. ' +
      'Pour vos congés, passez par l’onglet Mes congés.'));
    bloc.appendChild(t);

    var b = Kit.bouton('btn nt', function () { entrerSelection(); });
    b.textContent = 'Choisir plusieurs jours';
    bloc.appendChild(b);
    return bloc;
  }

  /* Une journée qui porte une absence de MARIA n'est pas sélectionnable : son
     chemin est l'onglet des congés. Tout le reste l'est — y compris une
     familiarisation, qui déclenchera son avertissement avant d'être écrasée
     (§18.1 A3). */
  function selectionnable(d, type) {
    return TYPES_ABSENCE_MARIA.indexOf(type) === -1;
  }

  function entrerSelection() {
    vue.selection = { jours: {}, marque: 'absence_enfant' };
    redessiner();
  }

  function quitterSelection() {
    vue.selection = null;
    redessiner();
  }

  /* COCHER UN JOUR NE REDESSINE PAS L'ÉCRAN.

     Un redessin complet à chaque appui perdrait la position de défilement :
     Maria coche le 8, l'écran remonte en haut, elle redescend, coche le 9, et
     ainsi de suite. Sur le geste dont tout ce paragraphe existe pour réduire
     le nombre d'appuis, ce serait l'exact contraire du but.

     Seuls la case touchée et le pied changent. Le pied est reconstruit — il
     porte le compte et l'effet rejoué par le moteur, qui changent à chaque
     appui — mais il fait vingt lignes, pas un écran. */
  function basculerJour(d, td) {
    if (!vue.selection) return;
    if (vue.selection.jours[d]) delete vue.selection.jours[d];
    else vue.selection.jours[d] = true;

    if (td) {
      var choisi = !!vue.selection.jours[d];
      td.className = td.className.replace(/ ?\bsel\b/, '') + (choisi ? ' sel' : '');
      td.setAttribute('aria-checked', choisi ? 'true' : 'false');
    }
    majPied();
  }

  function majPied() {
    if (!vue || !vue.corps) return;
    var ancien = vue.corps.querySelector('.selbar');
    if (!vue.selection) { if (ancien) ancien.parentNode.removeChild(ancien); return; }
    var neuf = piedSelection();
    if (ancien) ancien.parentNode.replaceChild(neuf, ancien);
    else vue.corps.appendChild(neuf);
  }

  function joursSelectionnes() {
    if (!vue.selection) return [];
    return Object.keys(vue.selection.jours).sort();
  }

  /* Le pied fixe : le compte, le marquage, l'effet, et les deux boutons. */
  function piedSelection() {
    var c = vue.contrat;
    var jours = joursSelectionnes();
    var pied = Kit.ce('div', 'selbar');

    var haut = Kit.ce('div', 'sb-n');
    haut.textContent = jours.length === 0
      ? 'Touchez les jours à marquer'
      : jours.length + (jours.length > 1 ? ' jours choisis' : ' jour choisi');
    pied.appendChild(haut);

    var choix = Kit.ce('div', 'sb-ch');
    [['absence_enfant', 'Absence de ' + c.prenom_enfant],
     ['presence', 'Présence']].forEach(function (o) {
      var b = Kit.bouton('pas' + (vue.selection.marque === o[0] ? ' on' : ''), function () {
        vue.selection.marque = o[0];
        majPied();
      });
      b.textContent = o[1];
      b.setAttribute('aria-pressed', vue.selection.marque === o[0] ? 'true' : 'false');
      choix.appendChild(b);
    });
    pied.appendChild(choix);

    if (jours.length) {
      pied.appendChild(Kit.ce('div', 'sb-ef', effetSelection(jours, vue.selection.marque)));
      /* CORRECTION C1/C2 DU LOT 18 — l'avertissement couvre désormais les
         sept colonnes qu'un marquage détruit, pas trois. La note, elle,
         survit : elle n'a plus à être annoncée. */
      var perdues = journeesManuellesEcrasees(jours);
      if (perdues.length) {
        pied.appendChild(Kit.ce('div', 'sb-wa',
          'Une saisie manuelle sera effacée : ' + libelleJours(perdues) +
          '. Ces journées portent des heures, une indemnité ou un écart d’horaire ' +
          'saisis à la main. Vos notes, elles, sont conservées.'));
      }
    }

    var actions = Kit.ce('div', 'sb-ac');
    var bOk = Kit.bouton('btn pr', function () { validerSelection(bOk); });
    bOk.textContent = 'Valider';
    bOk.disabled = jours.length === 0;
    actions.appendChild(bOk);
    var bNon = Kit.bouton('btn nt', function () { quitterSelection(); });
    bNon.textContent = 'Annuler';
    actions.appendChild(bNon);
    pied.appendChild(actions);
    return pied;
  }

  /* Les journées de CE contrat que le marquage va écraser : une
     familiarisation, des heures réelles ou une indemnité saisies à la main.
     Même prédicat que `journeesEcrasees`, appliqué au contrat courant. */
  /* CORRECTION C1 ET C2 DE LA RELECTURE DU LOT 18 — LE PRÉDICAT COUVRE TOUT
     CE QU'UN MARQUAGE GROUPÉ DÉTRUIT, pas trois colonnes sur sept.

     Il ne regardait que la familiarisation, les heures réelles et l'indemnité
     saisies à la main. Il ignorait les trois colonnes d'ajustement du lot 12
     et les quatre de l'écart d'horaire du lot 17 — c'est-à-dire précisément ce
     que la correction de B1 efface désormais. Maria n'était prévenue de rien.

     La NOTE n'y figure pas, et c'est voulu : depuis la correction de B1 elle
     survit au marquage. Avertir de la perte d'une donnée qui ne se perd plus
     serait aussi faux que de se taire sur celles qui se perdent. */
  function journeesManuellesEcrasees(jours) {
    var out = [];
    jours.forEach(function (d) {
      var l = (vue.journees || {})[d];
      if (!l) return;
      if (l.type === 'familiarisation' ||
          l.minutes_reelles != null || l.entretien_centimes != null ||
          (l.minutes_sup_exceptionnelles || 0) > 0 ||
          (l.minutes_sup_renoncees || 0) > 0 ||
          l.sup_dues_override != null ||
          l.ecart_minutes != null) out.push(d);
    });
    return out;
  }

  /* Les journées d'une sélection qui portent une NOTE. Elles ne peuvent pas
     passer par la suppression, qui détruirait la ligne entière — donc la note
     avec (correction C2). */
  function journeesAvecNote(jours) {
    return jours.filter(function (d) {
      var l = (vue.journees || {})[d];
      return !!(l && l.commentaire);
    });
  }

  function libelleJours(jours) {
    return jours.map(function (d) { return String(Number(d.slice(8, 10))); }).join(', ') +
      ' ' + Kit.libelleMois(vue.mois);
  }

  /* L'EFFET, REJOUÉ PAR LE MOTEUR. Deux résultats, une soustraction : rien
     d'autre. Le libellé des minutes suit RG-09 tel que le contrat le règle,
     il ne le devine pas. */
  function effetSelection(jours, marque) {
    var avant = vue.entree.resultat;
    var apres = simulerJours(jours, marque === 'presence' ? null : marque);

    var dEntretien = (apres.entretienCentimes || 0) - (avant.entretienCentimes || 0);
    var dSup = (apres.minutesSupAcquises || 0) - (avant.minutesSupAcquises || 0);
    var dTotal = (apres.totalAVerserCentimes || 0) - (avant.totalAVerserCentimes || 0);

    if (dEntretien === 0 && dSup === 0 && dTotal === 0) {
      return 'Aucun changement sur le mois : ces journées sont déjà ainsi.';
    }

    var phrase = '';
    if (dEntretien !== 0) {
      phrase += 'Entretien : ' + (dEntretien < 0 ? '− ' : '+ ') +
        Kit.eur(Math.abs(dEntretien)) + ' sur le mois. ';
    }
    var minutesJour = reg('minutes_sup_jour', 0);
    if (dSup === 0 && minutesJour > 0) {
      phrase += 'Vos ' + Kit.duree(minutesJour) + ' par jour restent dues.';
    } else if (dSup < 0) {
      phrase += Kit.duree(-dSup) + ' de récupération en moins.';
    } else if (dSup > 0) {
      phrase += Kit.duree(dSup) + ' de récupération en plus.';
    }
    if (!phrase) {
      phrase = 'Total à verser : ' + (dTotal < 0 ? '− ' : '+ ') + Kit.eur(Math.abs(dTotal)) + '.';
    }
    return phrase.trim();
  }

  function validerSelection(bouton) {
    var jours = joursSelectionnes();
    if (!jours.length) return;
    var c = vue.contrat;
    var marque = vue.selection.marque;
    var retour = { contrats: [c.id], jours: jours };

    if (marque === 'presence') {
      /* CORRECTION C2 DE LA RELECTURE DU LOT 18 — LA NOTE SURVIT AU RETOUR À
         LA PRÉSENCE.

         La suppression détruit la ligne entière : la note avec. Les journées
         annotées passent donc par une écriture qui pose `type = 'presence'`
         et remet les ajustements à plat SANS toucher au commentaire. Pour le
         moteur, une journée de présence sans ajustement et une journée sans
         ligne se calculent à l'identique : l'effet annoncé reste celui obtenu
         (§18.1 A2). */
      var annotees = journeesAvecNote(jours);
      var ordinaires = jours.filter(function (d) { return annotees.indexOf(d) === -1; });
      var gestes = [];
      if (ordinaires.length) gestes.push(global.DB.supprimerJournees(c.id, ordinaires));
      if (annotees.length) gestes.push(global.DB.marquerJournees(c.id, annotees, 'presence'));
      ecrire(Promise.all(gestes), bouton,
        jours.length > 1 ? jours.length + ' journées enregistrées' : 'Journée enregistrée',
        retour);
      return;
    }
    ecrire(global.DB.marquerJournees(c.id, jours, 'absence_enfant'), bouton,
      jours.length > 1
        ? jours.length + ' journées notées en absence'
        : c.prenom_enfant + ' ' + Kit.accordDe(c, 'noté') + ' ' + Kit.accordDe(c, 'absent'),
      retour);
  }

  function phrasePermanente() {
    var c = vue.contrat;

    /* LOT 18 §18.6 — SUR UN MOIS CLÔTURÉ, « Rien à faire les jours normaux »
       INVITE À TOUCHER DES JOURS INERTES. La phrase est juste sur un mois
       ouvert et trompeuse sur un mois verrouillé : Maria appuie, rien ne se
       passe, et rien ne lui dit pourquoi. On la remplace par ce qui est vrai
       ici — et par le chemin pour rouvrir. */
    if (vue.clos) {
      var recap = vue.entree && vue.entree.recap;
      var nc = Kit.note('Ce mois est clôturé',
        'Vous pouvez le rouvrir depuis le bandeau ci-dessus si vous devez corriger.' +
        (recap && !recap.transmis_le
          ? ' Il n’a pas encore été transmis.'
          : ''));
      nc.classList.add('permanente');
      return nc;
    }

    var minutes = reg('minutes_sup_jour', 0);
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

  /* LOT 20 (§20.4) — la case d'un jour de familiarisation. Elle ne passe pas
     par le mode sélection : « marquer plusieurs jours » sert à poser des
     absences d'enfant, et une journée de familiarisation se déclare heure par
     heure, jamais en lot. Un jour passé non déclaré porte l'orange — c'est le
     seul endroit du calendrier où l'application RÉCLAME quelque chose. */
  function celluleFamiliarisation(d, jour, classe, mini, aDeclarer) {
    var td = Kit.ce('td', classe +
      (aDeclarer ? ' warn' : '') +
      (d > vue.aujourdhui ? ' futur' : '') +
      (d === vue.aujourdhui ? ' auj' : '') +
      (vue.lectureSeule ? ' no' : ''));
    td.appendChild(Kit.ce('div', 'num', String(jour)));
    td.appendChild(Kit.ce('div', 'mini', mini));
    if (d === vue.aujourdhui) td.setAttribute('aria-current', 'date');
    if (vue.selection || vue.lectureSeule) {
      if (vue.selection) td.className += ' hors-sel';
      return td;
    }
    td.setAttribute('role', 'button');
    td.setAttribute('tabindex', '0');
    td.setAttribute('aria-label', Kit.jourLong(d) + ' — familiarisation, ' +
      (aDeclarer ? 'heures à déclarer' : mini));
    td.addEventListener('click', function () { feuilleFamiliarisation(d); });
    td.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); feuilleFamiliarisation(d); }
    });
    return td;
  }

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
    /* LOT 20 (§20.4) — LA PÉRIODE PRIME, ICI AUSSI. Le moteur traite un jour
       de la période en familiarisation quoi que porte sa ligne : le calendrier
       doit montrer la même chose, sinon Maria lit un « férié » sur une case
       que le récapitulatif compte autrement. Les bornes du contrat et le
       planning restent au-dessus — un jour hors contrat n'existe pas. */
    var fam = enFamiliarisation(d);
    if (fam && !horsBornes && !horsPlanning) {
      var etatFam = vue.famJours[d];
      classe = 'ok';
      mini = etatFam.declare ? Kit.heures(etatFam.minutes)
           : (d > vue.aujourdhui ? 'à venir' : 'à décl.');
      var td0 = celluleFamiliarisation(d, jour, classe, mini,
        !etatFam.declare && d <= vue.aujourdhui);
      return td0;
    }
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

    /* LOT 18 §18.1 — EN MODE SÉLECTION, LA CASE CHANGE DE MÉTIER. Elle ne
       s'ouvre plus, elle se coche. Les journées qui portent une absence de
       MARIA restent hors d'atteinte : un congé vaut pour les quatre contrats
       et se retire depuis « Mes congés », jamais depuis le calendrier d'un
       seul enfant (décision V8-09). */
    if (vue.selection) {
      if (touchable && !vue.lectureSeule && selectionnable(d, type)) {
        var choisi = !!vue.selection.jours[d];
        if (choisi) td.className += ' sel';
        td.setAttribute('role', 'checkbox');
        td.setAttribute('aria-checked', choisi ? 'true' : 'false');
        td.setAttribute('tabindex', '0');
        td.setAttribute('aria-label', Kit.jourLong(d));
        td.addEventListener('click', function () { basculerJour(d, td); });
        td.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); basculerJour(d, td); }
        });
      } else {
        td.className += ' hors-sel';
      }
      return td;
    }

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
      var travailles = Kit.joursTravailles(c, planningDuMois(), vue.annee, vue.mois,
        vue.journees).length;
      Kit.ligne(l, 'Jours de présence', r.joursPresence + ' j sur ' + travailles);
    }
    /* CORRECTION B4 DE LA RELECTURE DU LOT 17 — LE NET AFFICHÉ EST LE NET DÛ.
       Cet écran montrait le net CONTRACTUEL au-dessus d'un total qui, lui,
       était proratisé : 780,00 € de salaire net et 485,45 € à verser sur le
       même mois, sans un mot pour expliquer l'écart. Et le document remis à la
       famille annonçait 425,45 €. Deux écrans du même mois se contredisaient
       de 354,55 €. */
    Kit.ligne(l, 'Salaire net', Kit.eur(Chaine.netDuMois(r)));
    var partiel = Chaine.proratOuNull(r);
    if (partiel) {
      /* La même phrase que sur le document : un montant proratisé sans son
         quotient est indéfendable. */
      Kit.ligne(l, 'Mois partiel — ' + partiel.joursCouverts + ' jours de garde sur ' +
        partiel.joursDuMois + ' au contrat', '', { discret: true });
    }
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
    var parJour = reg('entretien_centimes_jour', 0);
    var attendu = r.joursPresence * parJour;
    if (attendu === r.entretienCentimes) {
      return 'Entretien — ' + r.joursPresence + ' j × ' + Kit.eur(parJour);
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

  /* --- 3. Réserves de ce contrat (§18.5) ----------------------------- */

  /* LOT 18 §18.5 — « RÉSERVES », ET LES CONGÉS PAYÉS EN PREMIER.

     Deux corrections de vocabulaire et d'ordre, qui disent la même chose :
     ce panneau répond à « qu'est-ce qu'il me reste ? », pas à « où en est
     l'instrument ? ». Une réserve est ce qui reste ; un compteur est un
     appareil. Et les congés payés passent devant, parce que c'est sur eux que
     les congés se prennent d'abord — l'ordre à l'écran doit être celui de la
     consommation, sinon il enseigne l'inverse de la règle.

     LE NOMBRE DE JOURS VIENT DU MOTEUR. `Math.floor(minutes / parJour)` était
     RG-05 réécrite ici, dans un écran — exactement ce que le contrôle B.0-5
     interdit. `Chaine.reservesEnJours` fait déjà ce calcul pour l'écran des
     congés ; il n'y a aucune raison qu'il existe deux fois. */
  function panneauCompteurs() {
    var c = vue.contrat;
    var cs = vue.entree.resultat.compteurSortie || {};
    var p = Kit.pane('Réserves de ' + c.prenom_enfant);

    var parJour = mpjc();
    var enJours = Chaine.reservesEnJours(cond(), cs);

    /* CORRECTION B5 — LE SOLDE AFFICHÉ EST LE SOLDE RÉEL, SIGNE COMPRIS.
       Ce panneau lisait les valeurs bornées à zéro : un compteur à −9 h
       s'affichait « 0h00 », pendant que le document remis à la famille
       montrait le vrai solde. §17.5 A4 : « le compteur peut être négatif, et
       l'écran le dit ». */
    var cp = Kit.cpSolde(cs);
    var bas = cp >= 0 && Kit.cpEstBas(cp, cond());
    compteur(p, {
      titre: 'Congés payés',
      valeur: cp < 0 ? '− ' + Kit.joursCp(-cp, parJour) : Kit.joursCp(cp, parJour),
      pct: pourcent(Math.max(0, cp), BARRE_CP_EN_JOURS * parJour),
      note: cp < 0
        ? 'Solde négatif — signalez-le : des congés ont été décomptés au-delà de vos droits'
        : (bas
          ? 'Réserve basse — un congé d’été passerait en partie sans solde'
          : 'sur 30 jours ouvrables acquis par an'),
      bas: bas || cp < 0
    });

    var minutes = Kit.supSolde(cs);
    compteur(p, {
      titre: 'Récupération',
      valeur: minutes < 0 ? '− ' + Kit.heures(-minutes) : Kit.heures(minutes),
      pct: pourcent(Math.max(0, minutes), BARRE_RECUP_EN_JOURS * parJour),
      note: minutes < 0
        ? 'Vous devez ce temps : il se rattrapera sur vos prochaines heures supplémentaires'
        : enJours.joursSup + ' jour' + (enJours.joursSup > 1 ? 's' : '') + ' de congé — ' +
          Kit.duree(parJour) + ' accumulées = 1 jour',
      bas: minutes < 0
    });

    /* LOT 18 §18.6 — DEVANT DEUX RÉSERVES, LAQUELLE SERA CONSOMMÉE ?
       La question se pose à chaque congé posé, et la réponse était introuvable
       sans ouvrir la fiche du contrat. Elle vient du réglage daté (RG-07),
       jamais d'un ordre supposé. */
    p.appendChild(Kit.note('Vos congés se prennent d’abord sur ' + premiereReserve(),
      'Modifiable dans le contrat de ' + c.prenom_enfant + '.'));
    return p;
  }

  function premiereReserve() {
    return reg('ordre_imputation', 'cp_puis_sup') === 'sup_puis_cp'
      ? 'votre récupération' : 'les congés payés';
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
    /* §20.4 — un jour de la période n'a qu'un seul geste : déclarer ses
       heures. Lui proposer « était là / était absent / écart d'horaire »
       offrirait des choix que le moteur ignore à l'intérieur de la période. */
    if (enFamiliarisation(d)) return feuilleFamiliarisation(d);
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
        /* LOT 17 §17.5 — ce que Maria DÉCLARE, avant l'ajustement manuel des
           minutes : c'est le geste le plus fréquent, et celui qui porte le
           sens. L'ajustement du lot 12 reste dessous, pour les cas que la
           déclaration ne couvre pas. */
        corps.appendChild(blocEcartHoraire(d));
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
      return Engine.detailSupDuJour(simule, cond() || {}).base;
    }

    function majEffet() {
      var b = base();
      var renoncees = etat.renonce ? b + etat.ajoutees : 0;
      var total = b + etat.ajoutees - renoncees;
      Kit.vider(effet);
      effet.appendChild(Kit.ce('b', null, 'Ce jour : ' + Kit.duree(total)));
      if (total !== reg('minutes_sup_jour', 0)) {
        effet.appendChild(document.createTextNode(
          ' au lieu de ' + Kit.duree(reg('minutes_sup_jour', 0)) + '.'));
      } else {
        effet.appendChild(document.createTextNode(' — comme prévu au contrat.'));
      }
    }

    corps.appendChild(compteurMinutes('Heures supplémentaires en plus',
      'Au-delà des ' + Kit.duree(reg('minutes_sup_jour', 0)) + ' prévues au contrat.',
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
      Kit.duree(reg('minutes_sup_jour', 0)) + ' non ' + Kit.accordDe(c, 'réclamé') +
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
    var det = Engine.detailSupDuJour(simule, cond() || {});
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


  /* --- LOT 17 §17.5 et §17.6 : ce qui s'est passé ce jour-là ----------

     « MARIA DÉCLARE L'ÉVÉNEMENT. L'APPLICATION NE DEVINE RIEN. »

     C'est la phrase qui tient tout cet écran. Il ne demande pas « à quelle
     heure l'enfant est-il parti ? » — il demande CE QUI S'EST PASSÉ, et
     chaque réponse dit déjà qui a décidé :

       un parent est venu en retard        → du temps de travail en plus
       j'ai libéré plus tôt                → du temps que Maria rend
       j'ai demandé qu'on l'amène plus tard → idem, sur le matin

     Un parent qui vient chercher son enfant plus tôt DE LUI-MÊME n'est aucun
     de ces trois cas : Maria était disponible, ses minutes restent dues, et
     elle ne déclare rien. C'est pour ça qu'il n'y a pas de quatrième choix —
     l'absence de choix EST la règle (A3).

     AUCUN CALCUL ICI. L'écran collecte un événement et une heure ; c'est
     `Engine.ecartDepuisHeureReelle` qui en fait des minutes signées, et lui
     seul qui connaît la référence d'une journée (fin d'accueil + minutes
     supplémentaires du contrat). Un écran qui soustrairait deux heures
     lui-même referait la règle une deuxième fois, sur des horaires qui
     changent d'un avenant à l'autre. */

  /* Le signe que chaque événement DOIT produire. C'est la même règle que la
     contrainte `journee_ecart_signe_coherent` de la migration `014` : sans
     elle, « j'ai libéré plus tôt » pourrait AJOUTER des minutes au compteur de
     Maria, et le document serait indéfendable. */
  var SIGNE_ATTENDU = {
    retard_parent: 1,
    liberation_anticipee: -1,
    arrivee_decalee: -1
  };

  var EVENEMENTS_ECART = [
    ['', 'Rien à signaler'],
    ['retard_parent', 'Un parent est venu en retard'],
    ['liberation_anticipee', 'J’ai libéré plus tôt'],
    ['arrivee_decalee', 'J’ai demandé qu’on me l’amène plus tard']
  ];

  var DESTINATIONS_ECART = [
    ['recuperation', 'Ma récupération'],
    ['conges_payes', 'Mes congés payés'],
    ['sans_solde', 'Sans solde']
  ];

  /* Les types de journée qui n'ont pas d'horaire de référence : RG-04 leur
     retire toute minute, écart compris. Proposer la déclaration dessus
     laisserait croire à un effet qui n'existe pas. */
  var TYPES_SANS_ECART = ['ferie', 'conge_maria', 'sans_solde',
                          'familiarisation', 'hors_planning'];

  function blocEcartHoraire(d) {
    var c = vue.contrat;
    var ligne = (vue.journees || {})[d] || {};
    var type = Kit.typeDuJour(vue.journees, d);
    var conditions = cond();

    if (TYPES_SANS_ECART.indexOf(type) !== -1) return Kit.ce('div');
    if (!conditions) return Kit.ce('div');

    var etat = {
      evenement: ligne.ecart_evenement || '',
      heure: String(ligne.ecart_heure_reelle || '').slice(0, 5) || null,
      destination: ligne.ecart_impute_sur || 'recuperation',
      /* §20.6 — l'indemnité du jour. Due par défaut : retirer est un choix. */
      entretien: ligne.entretien_du !== false
    };

    var det = Kit.ce('details', 'ajuster');
    det.appendChild(Kit.ce('summary', null, 'Que s’est-il passé ce jour-là ?'));
    if (etat.evenement) det.open = true;

    var corps = Kit.ce('div', 'ajuster-corps');
    det.appendChild(corps);

    var reference = Engine.heureDeReference(conditions);
    corps.appendChild(Kit.ce('p', 'sb q',
      'La journée de ' + c.prenom_enfant + ' va de ' +
      heureLisible(Engine.heureEnMinutes(conditions.heure_arrivee)) + ' à ' +
      heureLisible(reference) + ' — la fin d’accueil plus vos ' +
      Kit.duree(conditions.minutes_sup_jour) + '.'));

    var selEvt = Kit.champSelect('Ce qui s’est passé', EVENEMENTS_ECART, etat.evenement);
    corps.appendChild(selEvt.bloc);

    var blocHeure = Kit.ce('div');
    corps.appendChild(blocHeure);
    var blocDest = Kit.ce('div');
    corps.appendChild(blocDest);
    var effet = Kit.ce('div', 'effet-heures');
    corps.appendChild(effet);
    /* §20.6 — L'INTERRUPTEUR D'ENTRETIEN, ET SEULEMENT HORS DU CADRE.
       Il vit ici, sous l'effet chiffré, et n'apparaît que lorsqu'un écart est
       effectivement déclaré : « Maria ne retire jamais l'entretien d'une
       journée complète ». Sur une journée ordinaire, ce bloc reste vide. */
    var blocEntretien = Kit.ce('div');
    corps.appendChild(blocEntretien);

    var champHeure = null;
    var selDest = null;

    function majEntretien(visible) {
      Kit.vider(blocEntretien);
      if (!visible) return;
      blocEntretien.appendChild(Kit.section('Indemnité d’entretien du jour'));
      blocEntretien.appendChild(Kit.ce('p', 'sb q',
        'La journée sort du cadre. Elle reste comptée présente : votre salaire ' +
        'et vos minutes ne bougent pas.'));
      var plein = (conditions.entretien_centimes_jour != null)
        ? Kit.eur(conditions.entretien_centimes_jour) : '—';
      poserOption(blocEntretien, etat.entretien, 'Comptée', plein,
        function () { etat.entretien = true; majEntretien(true); });
      poserOption(blocEntretien, !etat.entretien, 'Non comptée', '0,00 €',
        function () { etat.entretien = false; majEntretien(true); });
    }

    function evenementChoisi() { return selEvt.select.value; }

    function minutesDeclarees() {
      var evt = evenementChoisi();
      if (!evt || !champHeure) return null;
      try {
        return Engine.ecartDepuisHeureReelle(conditions, evt, champHeure.valeur());
      } catch (e) {
        return null;
      }
    }

    function redessiner() {
      var evt = evenementChoisi();
      Kit.vider(blocHeure);
      Kit.vider(blocDest);
      Kit.vider(effet);
      champHeure = null;
      selDest = null;
      blocDest.hidden = true;

      if (!evt) {
        effet.appendChild(Kit.ce('div', 'sb q',
          'Vos ' + Kit.duree(conditions.minutes_sup_jour) + ' restent dues. ' +
          'Un parent qui vient chercher son enfant plus tôt de lui-même n’est pas ' +
          'un événement : vous étiez disponible.'));
        majEntretien(false);
        majBouton();
        return;
      }

      /* L'heure demandée dépend de l'événement : celle du MATIN pour une
         arrivée décalée, celle du SOIR pour les deux autres. Demander « heure
         de départ » sur une arrivée décalée ferait saisir n'importe quoi. */
      var matin = evt === 'arrivee_decalee';
      var defaut = etat.heure ||
        heureIso(matin ? Engine.heureEnMinutes(conditions.heure_arrivee) : reference);
      champHeure = Kit.champHeure(matin ? 'Heure d’arrivée réelle' : 'Heure de départ réelle',
        defaut);
      blocHeure.appendChild(champHeure.bloc);
      champHeure.select.addEventListener('change', function () { majEffet(); });

      poserDestination();
      majEffet();
    }

    /* LE SÉLECTEUR DE DESTINATION EST CONSTRUIT UNE SEULE FOIS, puis montré ou
       caché. Le reconstruire à chaque changement d'heure ferait perdre le
       choix de Maria — elle prend ses congés payés, elle change l'heure, et
       l'écran est revenu à la récupération sans rien dire. C'est le genre de
       remise à zéro silencieuse qu'on ne voit qu'en cliquant. */
    function poserDestination() {
      selDest = Kit.champSelect('Ces minutes se déduisent de',
        DESTINATIONS_ECART, etat.destination);
      selDest.select.addEventListener('change', function () {
        etat.destination = selDest.select.value;
        majEffet();
      });
      blocDest.appendChild(selDest.bloc);
      blocDest.appendChild(Kit.ce('p', 'sb q',
        'Votre récupération peut passer sous zéro : c’est du temps que vous rendrez.'));
      blocDest.hidden = true;
    }

    function majEffet() {
      var minutes = minutesDeclarees();
      Kit.vider(effet);
      blocDest.hidden = true;

      if (minutes === null) {
        effet.appendChild(Kit.ce('div', 'sb q', 'Heure illisible.'));
        majEntretien(false);
        majBouton();
        return;
      }
      if (minutes === 0) {
        /* Une heure réelle égale à la référence n'est pas un événement. On le
           dit plutôt que d'enregistrer une déclaration sans effet, que la
           contrainte `journee_ecart_coherent` refuserait de toute façon. */
        effet.appendChild(Kit.ce('div', 'sb q',
          'Cette heure est exactement celle prévue : il n’y a rien à déclarer.'));
        majEntretien(false);
        majBouton();
        return;
      }

      /* CORRECTION DE LA REMARQUE 5 DE LA RELECTURE DU LOT 17 — UN ÉVÉNEMENT
         DONT LE SIGNE NE CORRESPOND PAS EST REFUSÉ ICI, EN FRANÇAIS.

         Le sélecteur propose tous les quarts d'heure de 5h00 à 22h00. Une
         « arrivée décalée » saisie AVANT le début d'accueil produit un écart
         POSITIF, qui alimenterait la récupération sous le libellé « j'ai
         demandé qu'on me l'amène plus tard » — l'inverse de ce que Maria
         déclare. Le cas est atteignable par simple erreur de saisie.

         La base le refuse déjà (`journee_ecart_signe_coherent`), mais elle le
         refuse en fin de course, avec un message de contrainte. L'écran doit
         le dire AVANT, et dire quoi corriger. */
      var attendu = SIGNE_ATTENDU[evenementChoisi()];
      if (attendu && ((attendu > 0 && minutes < 0) || (attendu < 0 && minutes > 0))) {
        effet.appendChild(Kit.warnbox('Cette heure ne correspond pas à ce que vous déclarez',
          attendu < 0
            ? ' Une arrivée décalée à votre demande se saisit APRÈS l’heure d’arrivée ' +
              'habituelle, et une libération anticipée AVANT l’heure de fin. Vérifiez ' +
              'l’heure, ou changez ce que vous déclarez.'
            : ' Un retard à la reprise se saisit APRÈS l’heure de fin habituelle. ' +
              'Vérifiez l’heure, ou changez ce que vous déclarez.'));
        majEntretien(false);
        majBouton(true);
        return;
      }

      /* §17.6 — LA DESTINATION, seulement pour un écart NÉGATIF. Un retard de
         parent va toujours à la récupération : il n'y a rien à choisir. */
      if (minutes < 0) {
        blocDest.hidden = false;
        var lb = selDest.bloc.querySelector('.lb');
        if (lb) lb.textContent = 'Ces ' + Kit.duree(minutes) + ' se déduisent de';
      }

      /* L'effet CHIFFRÉ, rejoué par le moteur — jamais recomposé ici (B.0-5).
         On lui donne la journée telle qu'elle sera enregistrée. */
      var simule = {
        type: type,
        minutes_sup_exceptionnelles: ligne.minutes_sup_exceptionnelles || 0,
        minutes_sup_renoncees: ligne.minutes_sup_renoncees || 0,
        sup_dues_override: ligne.sup_dues_override === undefined ? null : ligne.sup_dues_override,
        ecart_minutes: minutes,
        ecart_impute_sur: etat.destination
      };
      var detail = Engine.detailSupDuJour(simule, conditions);
      /* CORRECTION C1 DE LA RELECTURE — c'était `minutesSupDuJour` recopiée
         mot pour mot dans un écran, alors que le moteur l'exporte. Une règle
         écrite deux fois est une règle qui divergera. */
      var totalJour = Engine.minutesSupDuJour(simule, conditions);

      var phrase = Kit.ce('div');
      phrase.appendChild(Kit.ce('b', null, 'Ce jour : ' + Kit.heures(totalJour)));
      phrase.appendChild(document.createTextNode(
        ' au lieu de ' + Kit.duree(conditions.minutes_sup_jour) + '.'));
      effet.appendChild(phrase);

      if (detail.minutesSurCp > 0) {
        effet.appendChild(Kit.ce('div', 'sb',
          Kit.duree(detail.minutesSurCp) + ' seront retirées de vos congés payés.'));
        /* CORRECTION C5 DE LA RELECTURE DU LOT 17 — CE QUI EST RETIRÉ PEUT NE
           PAS EXISTER.

           `minutesEcartSurCp` s'ajoute inconditionnellement à `minutesCpPris` :
           rien, ni dans le moteur ni ici, ne le confronte au disponible. Le
           solde passait sous zéro, et le bornage d'affichage le rendait
           indétectable — « 0 j » là où il manquait 1h45.

           LE §17.6 NE TRANCHE PAS ce qui doit arriver dans ce cas : refuser,
           basculer le surplus en sans solde, ou l'autoriser en négatif comme
           la récupération. La question est remontée à Maria. En attendant,
           l'application ne décide pas à sa place — mais elle ne se tait pas
           non plus : elle DIT ce qui va se passer, avant qu'elle n'appuie. */
        var dispoCp = Kit.cpSolde(vue.entree.resultat.compteurSortie);
        if (detail.minutesSurCp > dispoCp) {
          effet.appendChild(Kit.warnbox('Vos congés payés ne couvrent pas ces minutes',
            ' Il vous en reste ' + Kit.duree(Math.max(0, dispoCp)) + ' sur ce contrat, ' +
            'et ' + Kit.duree(detail.minutesSurCp) + ' seraient retirées. Le solde ' +
            'passerait en négatif. Choisissez plutôt votre récupération ou le sans ' +
            'solde si ce n’est pas ce que vous voulez.'));
        }
      }
      if (detail.minutesSansSolde > 0) {
        var retenue = (conditions.brut_mensuel_centimes != null)
          ? Engine.montantCentimes(conditions.brut_mensuel_centimes, detail.minutesSansSolde)
          : null;
        effet.appendChild(Kit.ce('div', 'sb',
          retenue != null
            ? 'Retenue sur le salaire : ' + Kit.eur(retenue) + '.'
            : 'La retenue ne peut pas être chiffrée, la rémunération de ce mois ' +
              'n’est pas renseignée.'));
      }
      /* L'écart est réel et cohérent : c'est LÀ que la journée sort du
         cadre, et donc là que l'interrupteur apparaît. */
      majEntretien(true);

      if (detail.ecartSurRecuperation < 0) {
        /* CORRECTION B5 — la dette annoncée partait d'un solde BORNÉ à zéro :
           sur un compteur déjà à −9 h, l'écran annonçait « vous devrez 1h00 »
           au lieu de 10h00. L'erreur valait exactement la dette déjà
           accumulée, et elle n'était pas bornée. */
        var apres = Kit.supSolde(vue.entree.resultat.compteurSortie) + detail.ecartSurRecuperation;
        if (apres < 0) {
          effet.appendChild(Kit.ce('div', 'sb',
            'Votre récupération passera en négatif : vous devrez ' +
            Kit.heures(-apres) + '.'));
        }
      }
      majBouton();
    }

    var b = Kit.bouton('btn nt', function () {
      enregistrerEcart(d, evenementChoisi(),
        champHeure ? champHeure.valeur() : null,
        minutesDeclarees(), etat.destination, b, etat.entretien);
    });
    corps.appendChild(b);

    /* `incoherent` : le signe déclaré ne correspond pas à l'événement
       (remarque 5). L'enregistrement est refusé, et la phrase au-dessus dit
       quoi corriger — un bouton mort sans explication ferait croire à une
       panne. */
    function majBouton(incoherent) {
      var evt = evenementChoisi();
      var minutes = minutesDeclarees();
      if (!evt) {
        b.textContent = etat.evenement ? 'Retirer ce que j’avais déclaré' : 'Rien à enregistrer';
        b.disabled = !etat.evenement;
        return;
      }
      b.textContent = 'Enregistrer';
      b.disabled = (minutes === null || minutes === 0 || incoherent === true);
    }

    selEvt.select.addEventListener('change', redessiner);
    redessiner();
    return det;
  }

  function heureLisible(minutes) {
    return Math.floor(minutes / 60) + 'h' + String(minutes % 60).padStart(2, '0');
  }
  function heureIso(minutes) {
    return String(Math.floor(minutes / 60)).padStart(2, '0') + ':' +
           String(minutes % 60).padStart(2, '0');
  }

  function enregistrerEcart(d, evenement, heure, minutes, destination, bouton, entretienDu) {
    var c = vue.contrat;
    var ligne = (vue.journees || {})[d] || {};
    var type = Kit.typeDuJour(vue.journees, d);

    /* Retirer une déclaration : les quatre colonnes repartent à `null`
       ENSEMBLE. Une ligne à demi effacée — un événement sans minutes — serait
       refusée par la contrainte `journee_ecart_coherent`, et surtout elle se
       relirait de travers. */
    var champs = {
      contrat_id: c.id, jour: d,
      type: ligne.type || 'presence',
      minutes_reelles: ligne.minutes_reelles == null ? null : ligne.minutes_reelles,
      entretien_centimes: ligne.entretien_centimes == null ? null : ligne.entretien_centimes,
      commentaire: ligne.commentaire == null ? null : ligne.commentaire,
      ecart_minutes: evenement ? minutes : null,
      ecart_evenement: evenement || null,
      ecart_heure_reelle: evenement ? heure : null,
      ecart_impute_sur: (evenement && minutes < 0) ? destination : null,
      /* §20.6 — retirer une déclaration REND l'indemnité. Une journée sans
         écart est une journée dans le cadre, et l'interrupteur n'y existe
         plus : laisser `false` derrière soi retirerait une indemnité sans
         aucun écran pour la remettre. */
      entretien_du: evenement ? (entretienDu !== false) : true
    };
    ecrire(global.DB.enregistrerJournee(champs), bouton,
      evenement ? 'Journée enregistrée' : 'Déclaration retirée',
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
      var planning = planningDuMois();
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
      var planning = planningDuMois();
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
      return Engine.decompterJoursOuvrables(d, d, planningDuMois());
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
    return simulerLignes([{ jour: d, type: type === 'presence' ? null : type, extra: extra }]);
  }

  /* LOT 18 §18.1 — LE MÊME REJEU, POUR PLUSIEURS JOURS. Un seul chemin de
     simulation dans cet écran : celui du geste unitaire et celui du geste
     groupé doivent voir exactement la même chose, sinon l'aperçu de l'un
     contredirait l'aperçu de l'autre sur les mêmes journées.
     `type` à `null` = retour à la présence (la ligne disparaît, saisie par
     exception, B.0-2). */
  function simulerJours(jours, type) {
    return simulerLignes(jours.map(function (d) {
      return { jour: d, type: type, extra: null };
    }));
  }

  /* `forcees` = [{ jour, type|null, extra }]. Fonction pure. */
  function simulerLignes(forcees) {
    var vises = {};
    forcees.forEach(function (f) { vises[f.jour] = f; });

    var lignes = [];
    Object.keys(vue.journees).forEach(function (k) {
      if (!vises[k]) lignes.push(vue.journees[k]);
    });
    /* La ligne simulée est EXACTEMENT celle que `marquerJournees` écrira :
       type changé, ajustements remis à plat. C'est ce qui rend l'aperçu et le
       résultat identiques par construction (§18.1 A2). Le commentaire n'entre
       dans aucun calcul : son sort ne change rien ici. */
    forcees.forEach(function (f) {
      if (f.type == null) return;            // présence : aucune ligne
      lignes.push({
        contrat_id: vue.contrat.id, jour: f.jour, type: f.type,
        minutes_reelles: f.extra ? f.extra.minutes_reelles : null,
        entretien_centimes: f.extra ? f.extra.entretien_centimes : null,
        /* CORRECTION B3 — LA PROMESSE DU COMMENTAIRE CI-DESSUS EST TENUE.
           `marquerJournees` remet `entretien_du` à `true` (l'interrupteur du
           §20.6 n'existe que sur une journée qui sort du cadre) ; la ligne
           simulée l'omettait, et l'aperçu comptait une indemnité que
           l'enregistrement allait rétablir — ou l'inverse. */
        entretien_du: true,
        minutes_sup_exceptionnelles: 0,
        minutes_sup_renoncees: 0,
        sup_dues_override: null,
        ecart_minutes: null,
        ecart_evenement: null,
        ecart_heure_reelle: null,
        ecart_impute_sur: null
      });
    });
    /* LOT 17 §17.3 — LES CONDITIONS DU MOIS, telles que la chaîne les a
       résolues. Ce rejeu doit voir EXACTEMENT ce que voit la chaîne : lui
       passer les réglages de `contrat` ferait diverger l'aperçu « voilà ce que
       ce geste change » du chiffre réellement enregistré, sur un écran dont
       c'est tout l'objet. Le brut et le net peuvent manquer (§17.2 point 3) ;
       comme dans la chaîne, ils valent alors zéro et l'écran le signale. */
    var condMois = cond() || {};
    var conditions = {};
    for (var kc in condMois) conditions[kc] = condMois[kc];
    conditions.brut_mensuel_centimes = condMois.brut_mensuel_centimes || 0;
    conditions.net_mensuel_centimes = condMois.net_mensuel_centimes || 0;
    /* LOT 16 §16.1 — MÊME REPLI QUE LA CHAÎNE. Sans lui, un mois dont la
       ventilation ne tient plus s'affichait bien (la chaîne se replie) mais
       toucher un jour faisait retomber cet aperçu sur l'exception : la feuille
       du jour devenait inutilisable sur le mois précisément à corriger.
       Une seule règle de repli, définie dans chaine-mois.js, appelée ici. */
    var params = {
      contrat: vue.contrat,
      conditions: conditions,
      journees: lignes,
      compteurEntree: vue.entree.compteurEntree,
      annee: vue.annee,
      mois: vue.mois,
      /* Correctif B1 de la relecture PR9 — ce rejeu doit voir EXACTEMENT ce que
         voit la chaîne, imputations comprises. Sans elles, l'aperçu « voilà ce
         que ce geste change » comparait un mois ventilé selon le choix de Maria
         à un mois ventilé selon l'ordre par défaut : l'écart affiché n'était pas
         celui du geste, mais celui de l'oubli. */
      imputations: vue.imputations || [],
      /* CORRECTION B3 — LES PÉRIODES DE FAMILIARISATION, par le même chemin et
         pour la même raison que les imputations juste au-dessus. Sans elles, le
         rejeu voit un mois entièrement mensualisé et l'écart annoncé n'est pas
         celui du geste, mais celui de l'oubli. */
      periodesFamiliarisation: vue.periodesFamiliarisation || []
    };
    /* C'EST LA TROISIÈME FOIS QUE CET APPEL OUBLIE UN ARGUMENT — les
       imputations au lot 10, les conditions au lot 17, les périodes au lot 20.
       Le garde-fou ne vérifie donc plus un argument en particulier : il vérifie
       que le rejeu et la chaîne reçoivent LE MÊME JEU DE CLÉS. Une entrée
       ajoutée à `calculerMois` sans être ajoutée ici fait échouer un test au
       lieu de fausser un chiffre à l'écran. */
    verifierMemesEntreesQueLaChaine(params);
    return Chaine.calculerMoisAvecRepli(params).resultat;
  }

  /* Les clés que `Chaine.serie` passe à `calculerMoisAvecRepli`. Elles sont
     écrites ici, en dur, plutôt que déduites : une liste déduite du même code
     que celui qu'elle contrôle ne contrôle rien. */
  var ENTREES_DU_REJEU = ['contrat', 'conditions', 'journees', 'compteurEntree',
                          'annee', 'mois', 'imputations', 'periodesFamiliarisation'];

  function verifierMemesEntreesQueLaChaine(params) {
    var manquantes = ENTREES_DU_REJEU.filter(function (k) {
      return !Object.prototype.hasOwnProperty.call(params, k);
    });
    if (manquantes.length) {
      /* Une erreur, pas un avertissement en console : un rejeu incomplet
         affiche un chiffre faux et crédible, ce qui est le pire résultat
         possible (B.0-9). */
      throw new Error('rejeu incomplet — entrées manquantes : ' + manquantes.join(', '));
    }
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
      phrase += ' Vos ' + Kit.duree(reg('minutes_sup_jour', 0)) + ' restent dues';
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
        /* LOT 20 (§20.1) — « JOURNÉE DE FAMILIARISATION » DISPARAÎT D'ICI.

           Elle ouvrait une saisie libre — des heures, un montant d'indemnité —
           sur une journée isolée, sans période. Depuis ce lot, la
           familiarisation est une PÉRIODE : c'est elle qui décide du sort d'un
           jour, elle qui borne le prorata du mois, et elle qui rend les heures
           déclarées payables. Une journée de familiarisation posée hors de
           toute période ne serait payée par rien.
           On ne supprime pas la possibilité : on dit où elle vit maintenant. */
        corps.appendChild(Kit.ce('p', 'sb q',
          'La familiarisation se règle par période, sur la fiche de ' +
          c.prenom_enfant + ' : deux dates, puis les heures déclarées jour par ' +
          'jour. Une journée isolée ne serait payée par rien.'));

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

  /* ------------------------------------------------------------------ */
  /* LOT 20 (§20.4 c) — LA FEUILLE DU JOUR DE FAMILIARISATION            */
  /*                                                                     */
  /* Deux gestes, et deux seulement : les heures faites, et si           */
  /* l'indemnité d'entretien est comptée. Le montant du jour s'affiche   */
  /* au fur et à mesure, REJOUÉ PAR LE MOTEUR — jamais recomposé ici :   */
  /* si le taux change par un avenant, la phrase change toute seule.     */
  /* ------------------------------------------------------------------ */

  /* Les raccourcis de la maquette. Ce sont des durées de familiarisation
     usuelles (RG-14 : 5 à 10 jours, horaires variables), pas une règle : Maria
     peut toujours saisir l'arrivée et le départ à la minute. */
  var RACCOURCIS_FAMILIARISATION = [150, 180, 270];

  function feuilleFamiliarisation(d) {
    var c = vue.contrat;
    var conditions = cond();
    var ligne = (vue.journees || {})[d] || {};
    var etatJour = (vue.famJours && vue.famJours[d]) || null;

    /* État local de la feuille. `entretien` suit le défaut de la base : dû,
       sauf si Maria l'a explicitement retiré (§20.6 — retirer est un choix). */
    var etat = {
      minutes: (ligne.minutes_reelles != null && ligne.minutes_reelles > 0)
        ? ligne.minutes_reelles : null,
      entretien: ligne.entretien_du !== false,
      arrivee: (conditions && String(conditions.heure_arrivee || '').slice(0, 5)) || '09:00',
      depart: ''
    };

    Kit.ouvrirFeuille('Familiarisation — ' + Kit.jourLong(d),
      c.prenom_enfant + ' — seules les heures déclarées sont payées.',
      function (corps) {
        corps.appendChild(Kit.ce('p', 'sb q',
          'Rémunération à l’heure, au taux du contrat. Pas de minutes ' +
          'supplémentaires. Vos congés s’acquièrent normalement.'));

        /* --- les heures faites ---------------------------------------- */
        var blocRaccourcis = Kit.ce('div', 'fld');
        blocRaccourcis.appendChild(Kit.ce('span', 'lb', 'Heures faites'));
        var rangee = Kit.ce('div', 'row');
        var boutons = [];
        RACCOURCIS_FAMILIARISATION.forEach(function (m) {
          var bt = Kit.bouton('btn sm nt', function () {
            etat.minutes = m;
            etat.depart = '';
            majTout();
          });
          bt.textContent = Kit.heures(m);
          boutons.push({ el: bt, minutes: m });
          rangee.appendChild(bt);
        });
        blocRaccourcis.appendChild(rangee);
        corps.appendChild(blocRaccourcis);

        var arr = Kit.champHeureMinute('Arrivée', etat.arrivee);
        var dep = Kit.champHeureMinute('Départ', etat.depart);
        var paire = Kit.ce('div', 'row');
        paire.appendChild(arr.bloc);
        paire.appendChild(dep.bloc);
        corps.appendChild(paire);
        corps.appendChild(Kit.ce('p', 'sb q',
          'Ou saisissez l’arrivée et le départ, à la minute près.'));

        var msgHeures = Kit.ce('div', 'msg');
        corps.appendChild(msgHeures);

        function lireLesDeuxHeures() {
          var a = arr.valeur();
          var b2 = dep.valeur();
          if (!a || !b2) return;
          try {
            /* La durée est une RÈGLE : le moteur, et lui seul (B.0-5). */
            etat.minutes = Engine.dureeEntreHeures(a, b2);
            msgHeures.className = 'msg';
            msgHeures.textContent = '';
          } catch (e) {
            etat.minutes = null;
            msgHeures.className = 'msg ko';
            msgHeures.textContent = Kit.messageErreur(e);
          }
        }
        arr.input.addEventListener('change', function () {
          etat.arrivee = arr.valeur(); lireLesDeuxHeures(); majTout();
        });
        dep.input.addEventListener('change', function () {
          etat.depart = dep.valeur(); lireLesDeuxHeures(); majTout();
        });

        /* --- le montant du jour, rejoué par le moteur ------------------ */
        var effet = Kit.ce('div', 'effet-heures');
        corps.appendChild(effet);

        /* --- l'indemnité d'entretien ---------------------------------- */
        corps.appendChild(Kit.section('Indemnité d’entretien du jour'));
        var choixEntretien = Kit.ce('div');
        corps.appendChild(choixEntretien);

        var msg = Kit.ce('div', 'msg');
        corps.appendChild(msg);

        var bEnr = Kit.bouton('btn', function () { enregistrer(); });
        corps.appendChild(bEnr);

        /* Retirer une déclaration faite par erreur. Sans ce bouton, une
           journée déclarée à 4 h au lieu de 40 min ne pourrait que se
           corriger, jamais s'effacer — et un jour non venu resterait payé. */
        if (etatJour && etatJour.declare) {
          var bRetirer = Kit.bouton('btn nt', function () { retirer(bRetirer); });
          bRetirer.textContent = 'Retirer cette déclaration';
          corps.appendChild(bRetirer);
          corps.appendChild(Kit.ce('p', 'sb q',
            'La journée redevient « à déclarer » : rien ne sera payé pour ce jour.'));
        }

        avertirClos(corps, d);

        function majTout() {
          boutons.forEach(function (x) {
            x.el.className = 'btn sm' + (etat.minutes === x.minutes ? '' : ' nt');
          });

          Kit.vider(effet);
          if (etat.minutes && conditions && conditions.brut_mensuel_centimes != null) {
            var brut = Engine.montantCentimes(conditions.brut_mensuel_centimes, etat.minutes);
            var p = Kit.ce('div');
            p.appendChild(Kit.ce('b', null, 'Rémunération du jour : ' + Kit.eur(brut)));
            p.appendChild(document.createTextNode(' — ' + Kit.heures(etat.minutes) + ' déclarées.'));
            effet.appendChild(p);
          } else if (etat.minutes) {
            effet.appendChild(Kit.ce('div', 'sb q',
              'La rémunération ne peut pas être chiffrée : les conditions de ce ' +
              'mois ne portent pas de salaire.'));
          } else {
            effet.appendChild(Kit.ce('div', 'sb q',
              'Tant que rien n’est déclaré, ce jour ne paie rien.'));
          }

          Kit.vider(choixEntretien);
          var plein = (conditions && conditions.entretien_centimes_jour != null)
            ? Kit.eur(conditions.entretien_centimes_jour) : '—';
          poserOption(choixEntretien, etat.entretien, 'Comptée',
            'Montant plein du jour, jamais un prorata des heures — ' + plein,
            function () { etat.entretien = true; majTout(); });
          poserOption(choixEntretien, !etat.entretien, 'Non comptée', '0,00 €',
            function () { etat.entretien = false; majTout(); });

          bEnr.textContent = 'Enregistrer';
          bEnr.disabled = !etat.minutes;
        }

        function enregistrer() {
          if (!etat.minutes) {
            msg.className = 'msg ko';
            msg.textContent = 'Déclarez les heures faites : choisissez une durée, ' +
              'ou saisissez l’arrivée et le départ.';
            return;
          }
          ecrire(global.DB.enregistrerJournee({
            contrat_id: c.id, jour: d, type: 'familiarisation',
            minutes_reelles: etat.minutes,
            /* Le MONTANT de l'indemnité n'est pas surchargé ici : c'est
               l'avenant qui le porte (§7 des instructions). `entretien_du`
               répond à l'autre question — est-elle due. */
            entretien_centimes: null,
            entretien_du: etat.entretien,
            commentaire: ligne.commentaire == null ? null : ligne.commentaire,
            /* Une journée de la période ne porte aucun écart d'horaire :
               le moteur les ignore, les laisser en base les rendrait
               visibles le jour où la période serait raccourcie. */
            ecart_minutes: null, ecart_evenement: null,
            ecart_heure_reelle: null, ecart_impute_sur: null
          }), bEnr, 'Journée déclarée', { contrats: [c.id], jours: [d] });
        }

        function retirer(bouton) {
          ecrire(global.DB.enregistrerJournee({
            contrat_id: c.id, jour: d, type: 'familiarisation',
            minutes_reelles: null,
            entretien_centimes: null,
            entretien_du: true,
            commentaire: ligne.commentaire == null ? null : ligne.commentaire
          }), bouton, 'Déclaration retirée', { contrats: [c.id], jours: [d] });
        }

        majTout();
      });
  }

  /* Une option à cocher, sur le modèle des trois choix de la feuille du jour.
     Un bouton radio dessiné, pas une case à cocher : le §20.6 parle d'un
     interrupteur « coché par défaut », et la maquette montre deux lignes
     « Comptée / Non comptée ». Le comportement est le même, la lecture est
     plus simple debout, entre deux enfants. */
  function poserOption(parent, actif, titre, sous, onClic) {
    /* Le choix coché porte la PASTILLE PLEINE en plus de sa teinte : une
       couleur seule ne dit rien à qui ne la voit pas, et l'état est aussi
       annoncé aux lecteurs d'écran (V8-01, V8-05). */
    var b = Kit.choix(parent, 'c1', actif ? '●' : '○', titre, sous, onClic);
    if (actif) b.className += ' on';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', actif ? 'true' : 'false');
    return b;
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
      /* CORRECTION C1 DE LA RELECTURE DU LOT 18 — « ANNULER » REND TOUT.
         Les quatre colonnes de l'écart d'horaire (lot 17) manquaient : une
         déclaration « j'ai libéré plus tôt », effacée par un marquage groupé,
         ne revenait pas. Un bouton d'annulation qui ne rend qu'une partie de
         ce qu'il a défait est pire qu'aucun bouton : il fait croire que
         l'affaire est réglée. */
      return global.DB.enregistrerJournee({
        contrat_id: x.contratId, jour: x.jour, type: l.type,
        minutes_reelles: l.minutes_reelles, entretien_centimes: l.entretien_centimes,
        commentaire: l.commentaire == null ? null : l.commentaire,
        minutes_sup_exceptionnelles: l.minutes_sup_exceptionnelles,
        minutes_sup_renoncees: l.minutes_sup_renoncees,
        sup_dues_override: l.sup_dues_override,
        ecart_minutes: l.ecart_minutes == null ? null : l.ecart_minutes,
        ecart_evenement: l.ecart_evenement == null ? null : l.ecart_evenement,
        ecart_heure_reelle: l.ecart_heure_reelle == null ? null : l.ecart_heure_reelle,
        ecart_impute_sur: l.ecart_impute_sur == null ? null : l.ecart_impute_sur
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
