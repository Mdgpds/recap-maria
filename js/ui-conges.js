/* ============================================================================
   ui-conges.js — Onglet « Mes congés ». Refondu au LOT 10.

   C'est la SEULE chose globale de l'application. Tout le reste est rangé par
   famille. Et pourtant, même ici, AUCUN COMPTEUR GLOBAL : les réserves sont
   affichées contrat par contrat, avec la phrase qui explique pourquoi elles
   diffèrent.

   CE QUE LE LOT 10 CHANGE, ET POURQUOI.

   Jusqu'ici, poser un congé était un geste unique : Maria choisissait des
   dates, et l'application décidait seule comment les payer — congés payés
   d'abord, puis récupération, puis sans solde, dans l'ordre du contrat. Le
   même arbitrage pour les quatre enfants.

   Or les réserves ne sont PAS les mêmes d'un contrat à l'autre. Tom a 6 jours
   de congés payés quand Léa en a 19, parce que les contrats n'ont pas commencé
   en même temps. La même semaine d'août se paie donc confortablement chez Léa
   et passe en partie sans solde chez Tom — c'est-à-dire en retenue sur salaire.
   Aucun choix global ne peut convenir. C'est la demande centrale de Maria.

   Le parcours passe donc en trois temps :
     1. les DATES, avec le décompte en jours ouvrables (RG-06) en direct ;
     2. la VENTILATION, une page par contrat, ses réserves sous les yeux ;
     3. un RÉCAPITULATIF, avant d'écrire quoi que ce soit.

   CE QUI DISPARAÎT (V8-08, V8-09) : le mode « une semaine entière », le faux
   raccourci « poser une seule journée » — qui ne posait rien, il expliquait
   comment faire ailleurs —, et le pinceau « Mon congé » du mode
   multi-sélection du calendrier.

   AUCUN CALCUL MÉTIER DANS CE FICHIER (B.0-5, A9). Le décompte en jours
   ouvrables vient de `Engine.decompterJoursOuvrables`, la répartition par
   défaut de `Engine.imputerConges`, la retenue de sans-solde de
   `Engine.montantCentimes`. Deux sources de vérité, c'est une source de vérité
   de moins.
   ========================================================================= */
(function (global) {
  'use strict';

  var Kit = global.Kit;
  var Chaine = global.ChaineMois;
  var Engine = global.Engine;
  var Feries = global.Feries;

  /* Types posés par une absence de Maria. Le retrait ne cible que ceux-là :
     une absence d'enfant ou une familiarisation saisie le même jour ne doit
     jamais disparaître. */
  var TYPES_ABSENCE_MARIA = ['conge_maria', 'sans_solde', 'hors_planning'];

  var vue = null;        // état de l'onglet
  var parcours = null;   // état du parcours de pose, quand il est ouvert

  /* ------------------------------------------------------------------ */
  /* 1. L'onglet                                                         */
  /* ------------------------------------------------------------------ */

  /* La fenêtre de lecture des samedis comptés d'un mois affiché : le mois,
     débordé d'un mois de chaque côté. Un samedi qui prolonge une semaine de
     fin de mois appartient au mois suivant, et il doit quand même être nommé
     sur la période à laquelle il se rattache. */
  function fenetreSamedis(m) {
    var d = new Date(Date.UTC(m.annee, m.mois - 2, 1));
    var f = new Date(Date.UTC(m.annee, m.mois + 1, 0));
    return { debut: d.toISOString().slice(0, 10), fin: f.toISOString().slice(0, 10) };
  }

  function afficher(ctx) {
    var m = { annee: ctx.params.annee, mois: ctx.params.mois };
    if (!m.annee || !m.mois) m = global.App.moisCourant();
    var contrats = global.App.contrats();

    barre(ctx.barre, m);

    if (!contrats.length) {
      ctx.corps.appendChild(Kit.ce('p', 'vide', 'Aucun contrat actif : rien à poser.'));
      return Promise.resolve();
    }

    ctx.corps.appendChild(Kit.ce('div', 'attente', 'Lecture de vos compteurs…'));

    return Promise.all([
      Promise.all(contrats.map(function (c) {
        return Promise.all([
          global.App.serie(c, m),
          global.App.journees(c.id, m.annee, m.mois),
          /* LOT 16 §16.8 — LES PÉRIODES, pas les journées. La liste des congés
             posés se construit désormais à partir des imputations, seule
             donnée qui porte les vraies bornes et le décompte RG-06. La
             fonction existait déjà et n'était appelée par aucun écran. */
          global.DB.listImputationsPourMois(c.id, m.annee, m.mois)
            .catch(function () { return null; }),
          /* LOT 17 §17.2 — les conditions du contrat, datées. L'écran des
             congés lit trois réglages : le planning (quelles journées écrire),
             les minutes d'un jour de congé (la retenue de sans solde) et le
             barème (son montant). Aucun ne se lit plus sur `contrat`. */
          global.App.avenants(c.id),
          /* LA RÈGLE DES CINQ SAMEDIS (§7) — les samedis comptés du mois, pour
             que chaque période affichée NOMME les siens. La fenêtre déborde
             d'un mois de chaque côté : le samedi qui prolonge une semaine
             appartient parfois au mois suivant.

             `null` — et non `[]` — quand la lecture échoue : l'écran doit
             pouvoir dire qu'il n'a pas pu lire plutôt que d'afficher « aucun
             samedi compté », ce qui serait un chiffre faux et crédible. */
          /* Contrôle de CAPACITÉ, pas rattrapage d'erreur — même règle que la
             chaîne pour les imputations : un décor de test ancien n'expose pas
             cette fonction, et n'a aucun samedi compté. Une erreur RÉELLE,
             elle, rend `null` : l'écran dit alors qu'il n'a pas pu lire, au
             lieu d'afficher un zéro faux et crédible (§8). */
          (typeof global.DB.listSamedisConge === 'function'
            ? global.DB.listSamedisConge(c.id, fenetreSamedis(m).debut,
                fenetreSamedis(m).fin).catch(function () { return null; })
            : Promise.resolve([]))
        ]).then(function (r) {
          return {
            contrat: c,
            avenants: r[3],
            samedis: r[4],
            entree: global.App.moisDe(r[0], m.annee, m.mois),
            journees: r[1],
            /* `null` — et non `[]` — quand la lecture échoue : l'écran doit
               pouvoir dire « je n'ai pas pu lire vos périodes » au lieu de
               laisser croire qu'il n'y en a aucune. */
            imputations: r[2],
            erreur: null
          };
        }).catch(function (e) {
          return { contrat: c, avenants: [], entree: null, journees: {},
                   imputations: null, erreur: e };
        });
      })),
      global.App.recapsDuMois(m.annee, m.mois).catch(function () { return null; })
    ]).then(function (r) {
      vue = { annee: m.annee, mois: m.mois, fiches: r[0], recaps: r[1] };
      Kit.vider(ctx.corps);
      rendre(ctx.corps);
      /* LOT 16 §16.1 b) — arrivée depuis l'encart « corriger la répartition ».
         L'écran se rend d'abord, la feuille s'ouvre ensuite : si la période
         n'est plus là, Maria voit quand même son mois. */
      if (ctx.params && ctx.params.corrigerImputation) {
        ouvrirCorrection(ctx.params.corrigerImputation);
      }
    });
  }

  /* LOT 16 §16.1 b) — corriger la répartition d'UNE période précise.

     Le parcours de pose ne convient pas ici : il part de dates, écrit des
     journées et INSÈRE une imputation — or la période existe déjà, ses
     journées aussi, et la contrainte d'exclusion refuserait l'insertion.
     Seule la répartition est en cause, et elle seule est modifiée. */
  function ouvrirCorrection(imputationId) {
    var trouve = null;
    (vue.fiches || []).forEach(function (f) {
      (f.imputations || []).forEach(function (i) {
        if (i.id === imputationId) trouve = { fiche: f, imputation: i };
      });
    });
    if (!trouve) {
      Kit.toast('Cette période de congé n’est plus enregistrée sur ce mois.', true);
      return;
    }

    /* CORRECTION RELECTURE LOT 16 (remarque 2) — LES RÉSERVES SE LISENT AU
       MOIS OÙ LA PÉRIODE COMMENCE, pas au mois affiché.

       C'est ce mois-là que le moteur confronte à la ventilation d'une période
       entière (`imposeeTotale`), et c'est ce que fait déjà le chemin de POSE
       (`preparerVentilations`). La correction s'alignait sur le mois à
       l'écran : sur une période à cheval ouverte depuis le second mois, elle
       aurait proposé des bornes qui ne sont pas celles que le moteur applique. */
    var moisDebut = Chaine.moisDeDate(trouve.imputation.date_debut);
    if (moisDebut.annee === vue.annee && moisDebut.mois === vue.mois) {
      feuilleCorrection(trouve.fiche, trouve.imputation);
      return;
    }
    global.App.serie(trouve.fiche.contrat, moisDebut).then(function (chaine) {
      var e = global.App.moisDe(chaine, moisDebut.annee, moisDebut.mois);
      feuilleCorrection(e
        ? { contrat: trouve.fiche.contrat, entree: e, journees: trouve.fiche.journees,
            imputations: trouve.fiche.imputations, samedis: trouve.fiche.samedis,
            erreur: null }
        : trouve.fiche, trouve.imputation);
    }).catch(function (err) {
      /* Rien n'est ouvert sur des chiffres dont on n'est pas sûr. */
      Kit.toast('Impossible de lire vos compteurs au mois où cette période commence : ' +
        Kit.messageErreur(err) + ' Rien n’a été modifié.', true);
    });
  }

  function feuilleCorrection(fiche, imputation) {
    var c = fiche.contrat;
    var cond = condDe(fiche);
    var planning = (cond && cond.jours_planning) || [1, 2, 3, 4, 5];

    /* CORRECTION RELECTURE LOT 16 (B1) — LE NOMBRE DE JOURS VIENT DU MOTEUR,
       JAMAIS DU CHAMP ENREGISTRÉ.

       La feuille lisait `imputation.jours_ouvrables`. Or `IMPUTATION_INCOMPLETE`
       est levée précisément quand cette valeur ne correspond PAS au décompte
       RG-06 que le moteur calcule lui-même. Répartir sur la valeur enregistrée
       reproduisait donc exactement l'état refusé : Maria corrigeait, la période
       restait écartée, la clôture restait bloquée, indéfiniment.

       Le décompte est une donnée CALCULÉE — le moteur le dit lui-même : « le
       décompte RG-06 d'une période est une donnée calculée, jamais une donnée
       d'entrée ». La réécrire n'écrase donc aucun choix de Maria, elle rétablit
       la vérité. Mais on ne la réécrit pas en silence : l'écart lui est annoncé
       AVANT qu'elle ne réparte, et le « reste à répartir » démarre au nombre de
       jours qu'elle a en plus. Rien n'est écrit en base tant qu'elle n'a pas
       validé. */
    /* Le décompte de CETTE période, avec LES SAMEDIS QU'ELLE PORTE — pas ceux
       qu'elle pourrait porter. Corriger une répartition ne change pas les
       samedis comptés : c'est la ventilation qui est en cause, pas RG-06. */
    var samedisDeLaPeriode = ((fiche && fiche.samedis) || []).filter(function (sm) {
      return sm.imputation_id === imputation.id;
    }).map(function (sm) { return String(sm.date_samedi).slice(0, 10); });
    var jours = Engine.decompterJoursOuvrables(imputation.date_debut, imputation.date_fin,
      planning, samedisDeLaPeriode);
    var enregistres = imputation.jours_ouvrables == null ? jours : imputation.jours_ouvrables;
    var ecartDecompte = jours - enregistres;

    var cp = cpDe(fiche);
    var sup = supDe(fiche);
    var plafonds = plafondsDe(fiche);
    var maxCp = plafonds.maxCp;
    var maxSup = plafonds.maxSup;

    /* On repart de CE QUE MARIA AVAIT CHOISI, borné à ce que les réserves
       couvrent — et non d'une proposition qui déciderait à sa place. Ce qui
       reste à placer se voit alors dans « reste à répartir », et c'est
       exactement ce qu'elle doit trancher. */
    var choix = {
      joursSurCp: Math.min(imputation.jours_sur_cp || 0, maxCp),
      joursSurSup: Math.min(imputation.jours_sur_sup || 0, maxSup),
      joursSansSolde: Math.min(imputation.jours_sans_solde || 0, jours)
    };

    var p = {
      fiche: fiche, contrat: c, cond: cond, jours: jours, cp: cp, sup: sup,
      maxCp: maxCp, maxSup: maxSup, choix: choix
    };

    Kit.ouvrirFeuille(c.prenom_enfant + ' — ' + Kit.jours(jours) + ' à répartir',
      libellePlage(imputation.date_debut, imputation.date_fin),
      function (corps) {
        /* L'écart de décompte, dit avant tout le reste. Sans cette phrase,
           Maria verrait un jour de plus à placer sans comprendre d'où il sort. */
        if (ecartDecompte !== 0) {
          corps.appendChild(Kit.note(
            'Cette période compte ' + Kit.jours(jours) + ' ouvrables, pas ' +
            Kit.jours(enregistres) + ' comme enregistré',
            /* §6.3 — une seule source pour la règle du décompte. */
            Kit.RESUME_RG06 + ' Vous avez ' +
            (ecartDecompte > 0
              ? Kit.jours(ecartDecompte) + ' de plus à répartir.'
              : Kit.jours(-ecartDecompte) + ' de moins à répartir.')));
        }

        var res = Kit.pane('Vos réserves pour ce contrat');
        var lr = Kit.lines(res);
        Kit.ligne(lr, 'Congés payés', Kit.joursCp(cp, mpjc(cond)));
        Kit.ligne(lr, 'Récupération', joursDeRecup(cond, sup));
        corps.appendChild(res);

        corps.appendChild(Kit.section('Comment les prendre ?'));

        var reste = Kit.ce('div', 'reste');
        var effet = Kit.ce('div', 'effet-sans-solde');
        var bValider = Kit.bouton('btn', function () {
          validerCorrection(bValider, imputation, p);
        });
        bValider.textContent = 'Enregistrer la répartition';

        function majAffichage() {
          var somme = p.choix.joursSurCp + p.choix.joursSurSup + p.choix.joursSansSolde;
          var manque = p.jours - somme;
          Kit.vider(reste);
          reste.className = 'reste' + (manque === 0 ? ' ok' : ' ko');
          reste.appendChild(Kit.ce('span', null, 'Reste à répartir'));
          reste.appendChild(Kit.ce('b', null, String(manque)));
          bValider.disabled = manque !== 0;

          Kit.vider(effet);
          if (p.choix.joursSansSolde > 0) {
            var brut = brutDe(fiche);
            var minutes = p.choix.joursSansSolde * mpjc(cond);
            var retenue = brut ? Engine.montantCentimes(brut, minutes) : null;
            effet.appendChild(Kit.warnbox(
              Kit.jours(p.choix.joursSansSolde) + ' sans solde',
              retenue != null
                ? ' : retenue de ' + Kit.eur(retenue) + ' sur le salaire de ' +
                  c.prenom_enfant + '.'
                : ' : la retenue ne peut pas être chiffrée, le barème de ce contrat ' +
                  'n’est pas renseigné.'));
          }
        }

        corps.appendChild(compteur('Congés payés', p.choix, 'joursSurCp', maxCp, majAffichage,
          'reste ' + Kit.joursCp(cp, mpjc(cond)) + ' au compteur'));
        corps.appendChild(compteur('Récupération', p.choix, 'joursSurSup', maxSup, majAffichage,
          'reste ' + joursDeRecup(cond, sup) + ' convertibles'));
        corps.appendChild(compteur('Sans solde', p.choix, 'joursSansSolde', jours, majAffichage));

        corps.appendChild(reste);
        corps.appendChild(bascule(p));
        corps.appendChild(effet);
        corps.appendChild(bValider);

        majAffichage();
      });
  }

  function validerCorrection(bouton, imputation, p) {
    bouton.disabled = true;
    global.DB.majVentilationImputation(imputation.id, {
      /* B1 — `jours_ouvrables` part AVEC la ventilation. La contrainte SQL
         `imputation_complete` exige que les deux restent égaux ; ne pas
         l'écrire laissait la ligne dans l'état même que le moteur refuse. */
      jours_ouvrables: p.jours,
      jours_sur_cp: p.choix.joursSurCp,
      jours_sur_sup: p.choix.joursSurSup,
      jours_sans_solde: p.choix.joursSansSolde
    }).then(function () {
      global.App.invalider();
      Kit.fermerFeuille();
      Kit.toast('Répartition enregistrée ' +
        libellePlage(imputation.date_debut, imputation.date_fin) + '.');
      return global.App.rafraichir();
    }).catch(function (e) {
      /* La feuille RESTE OUVERTE : la saisie en cours n'est jamais perdue en
         silence (qualité n° 3). */
      bouton.disabled = false;
      Kit.toast('La répartition n’a pas pu être enregistrée : ' +
        Kit.messageErreur(e) + ' Vos chiffres sont toujours à l’écran.', true);
    });
  }

  /* Navigation par mois : sans elle, un congé posé d'avance était écrit en base
     puis n'apparaissait sur aucun écran et ne pouvait plus être retiré. */
  function barre(barreEl, m) {
    Kit.vider(barreEl);
    barreEl.className = 'bar';
    barreEl.appendChild(Kit.ce('span', 'ti', 'Mes congés'));

    var nav = Kit.ce('div', 'nav');
    var prec = Kit.bouton(null, function () { changerMois(-1); });
    prec.textContent = '‹';
    prec.setAttribute('aria-label', 'Mois précédent');
    var etiquette = Kit.ce('span', 'r', Kit.libelleMoisAnnee(m.annee, m.mois));
    var suiv = Kit.bouton(null, function () { changerMois(1); });
    suiv.textContent = '›';
    suiv.setAttribute('aria-label', 'Mois suivant');

    var maintenant = global.App.moisCourant();
    var limite = maintenant;
    for (var i = 0; i < 12; i++) limite = Chaine.moisSuivant(limite.annee, limite.mois);
    var debut = maintenant;
    global.App.contrats().forEach(function (c) {
      var d = Chaine.moisDeDate(c.date_debut);
      if (Chaine.cmpMois(d.annee, d.mois, debut.annee, debut.mois) < 0) debut = d;
    });
    var p = Chaine.moisPrecedent(m.annee, m.mois);
    var s = Chaine.moisSuivant(m.annee, m.mois);
    prec.disabled = Chaine.cmpMois(p.annee, p.mois, debut.annee, debut.mois) < 0;
    suiv.disabled = Chaine.cmpMois(s.annee, s.mois, limite.annee, limite.mois) > 0;

    nav.appendChild(prec);
    nav.appendChild(suiv);
    barreEl.appendChild(etiquette);
    barreEl.appendChild(nav);
  }

  function changerMois(delta) {
    if (!vue) return;
    var m = delta < 0
      ? Chaine.moisPrecedent(vue.annee, vue.mois)
      : Chaine.moisSuivant(vue.annee, vue.mois);
    global.App.remplacer('conges', { annee: m.annee, mois: m.mois });
  }

  function rendre(corps) {
    var fiches = vue.fiches;
    var enErreur = fiches.filter(function (f) { return f.erreur; });

    if (enErreur.length) {
      /* Correction B5 (relecture lot 6) : l'échec de lecture d'un contrat
         n'est pas un détail gris, c'est un état incohérent. Il se voit, et il
         BLOQUE la pose — poser maintenant laisserait ce contrat en dehors, et
         ses compteurs divergeraient des autres pour toujours. */
      corps.appendChild(Kit.warnbox(
        'Compteurs indisponibles pour ' +
        enErreur.map(function (f) { return f.contrat.prenom_enfant; }).join(', '),
        'Impossible de savoir ce qu’un congé coûterait sur ' +
        (enErreur.length > 1 ? 'ces contrats' : 'ce contrat') + '. ' +
        'Poser un congé maintenant le laisserait en dehors, et ses compteurs divergeraient ' +
        'des autres. Revenez sur cet écran une fois le réseau revenu.'));
    }

    corps.appendChild(panneauPoses());
    corps.appendChild(panneauReserves());

    /* V8-08 — UN SEUL bouton. « Poser une semaine entière » et « Poser une
       seule journée » ont disparu : le premier était un cas particulier du
       second geste, et le second ne posait rien du tout — il expliquait
       comment faire ailleurs. Trois boutons pour un geste, dont un qui ne fait
       rien, c'est trois occasions de se tromper. */
    /* LOT 18 §18.6 — CETTE PHRASE PASSE DEVANT LES BOUTONS.
       Elle dit ce que le geste va faire — un congé posé une fois vaut pour
       tous les contrats. Placée APRÈS les boutons, elle arrivait quand Maria
       avait déjà appuyé : une explication lue trop tard n'évite aucune
       erreur. */
    corps.appendChild(Kit.note('Un congé vaut pour ' + libelleContrats(fiches.length),
      'Vous le posez une fois, il s’applique partout — mais vous choisissez, pour chaque ' +
      'enfant, comment il est décompté. ' + Kit.RESUME_RG06));

    var bPoser = Kit.bouton('btn', function () { ouvrirParcours(); });
    bPoser.textContent = 'Poser des congés';
    bPoser.disabled = enErreur.length > 0;
    corps.appendChild(bPoser);

    var bRetrait = Kit.bouton('btn nt', function () { feuilleRetrait(); });
    bRetrait.textContent = 'Retirer des congés';
    corps.appendChild(bRetrait);
  }

  function libelleContrats(n) {
    return n <= 1 ? 'votre contrat' : 'vos ' + n + ' contrats';
  }

  /* LOT 16 §16.8 — UNE LIGNE PAR PÉRIODE, PAS PAR JOURNÉE.

     Ce panneau listait les congés jour par jour, à partir des journées du
     planning. Trois semaines produisaient quinze lignes « 1 jour », puis un
     total « 17 j » — et les deux ne se rejoignaient pas. L'écart venait des
     samedis, comptés par RG-06, et du 15 août, samedi férié donc non compté.
     La liste jour par jour ne POUVAIT PAS les montrer : le samedi n'est pas
     dans le planning, il n'a donc aucune journée. L'écran censé rendre le
     décompte limpide le rendait incompréhensible — sur le point précis qui
     fait litige avec les familles.

     La période est une DONNÉE, jamais une déduction : `imputation_conge`
     porte ses vraies bornes, son décompte RG-06 et sa ventilation. On ne
     regroupe surtout pas les journées consécutives à l'affichage, ce qui
     serait faux dès qu'un férié tombe au milieu. */
  function panneauPoses() {
    var p = Kit.pane('Posés en ' + Kit.libelleMois(vue.mois));

    var illisible = vue.fiches.some(function (f) { return !f.erreur && f.imputations === null; });
    if (illisible) {
      p.appendChild(Kit.warnbox('Vos périodes de congé n’ont pas pu être lues',
        ' Les journées restent posées et les compteurs restent justes ; c’est ' +
        'seulement cette liste qui manque. Réessayez plus tard.'));
      return p;
    }

    var groupes = grouperPeriodes();
    var horaires = congesHoraires();

    if (!groupes.length && !horaires.length) {
      p.appendChild(Kit.ce('div', 'sb q', 'Aucun congé posé ce mois-ci.'));
      return p;
    }

    var l = Kit.lines(p);
    groupes.forEach(function (g) { ligneperiode(l, g); });
    /* §21.3 — LA TRACE D'UN CONGÉ POSÉ À L'HEURE.
       « ½ journée le 8 octobre — Léa : récupération · Noah : sans solde ». Une
       ligne par JOUR, pas par contrat : Maria a posé un seul congé, elle doit
       en lire un seul — mais l'issue de chaque enfant est nommée, parce
       qu'elle diffère et que c'est tout l'objet du §21.2. */
    horaires.forEach(function (h) { ligneHoraire(l, h); });
    if (groupes.length) p.appendChild(phraseDecompte(groupes));
    return p;
  }

  /* Les congés à l'heure du mois affiché, regroupés par jour. Ils vivent sur
     les journées (`ecart_evenement = 'conge_horaire'`), pas dans
     `imputation_conge` qui ne connaît que les jours entiers : c'est ce que la
     migration `017` rend possible, et c'est ce qui permet au document du mois
     de dire la vérité sur ce qui a été déduit. */
  var LIBELLE_ISSUE = {
    recuperation: 'récupération',
    conges_payes: 'congés payés',
    sans_solde: 'sans solde'
  };

  function congesHoraires() {
    /* GROUPÉ PAR JOUR **ET PAR DURÉE**, pas par jour seul.

       Une pose vaut la même durée sur tous les contrats retenus — c'est la
       même absence — et les additionner ferait lire « 6 h 08 » pour une
       demi-journée posée sur quatre enfants. Mais deux poses différentes
       peuvent tomber le même jour : 1 h 34 sur un contrat le matin, une
       demi-journée sur deux autres l'après-midi. Les fondre en une ligne
       ferait retirer les trois d'un seul geste, et rendrait aux compteurs des
       minutes que personne n'y avait prises. La durée fait donc partie de la
       clé. */
    var par = {};
    var ordre = [];
    (vue.fiches || []).forEach(function (f) {
      if (f.erreur) return;
      Object.keys(f.journees || {}).forEach(function (d) {
        var ligne = f.journees[d];
        if (!ligne || ligne.ecart_evenement !== 'conge_horaire') return;
        var minutes = -(ligne.ecart_minutes || 0);
        var cle = d + '|' + minutes;
        if (!par[cle]) {
          par[cle] = { jour: d, minutes: minutes, parts: [] };
          ordre.push(cle);
        }
        par[cle].parts.push({
          contratId: f.contrat.id,
          prenom: f.contrat.prenom_enfant,
          issue: ligne.ecart_impute_sur || 'recuperation'
        });
      });
    });
    ordre.sort();
    return ordre.map(function (k) { return par[k]; });
  }

  function ligneHoraire(l, h) {
    var demi = demiJournee();
    var titre = (demi.minutes > 0 && h.minutes === demi.minutes)
      ? '½ journée' : Kit.heures(h.minutes);
    var detail = h.parts.map(function (x) {
      return x.prenom + ' : ' + (LIBELLE_ISSUE[x.issue] || x.issue);
    }).join(' · ');

    /* Ligne construite à la main, comme celle d'une période : `Kit.ligne` ne
       prend qu'un libellé, et il faut ici un titre en gras suivi du sort de
       chaque enfant. */
    var ligne = Kit.ce('div', 'l');
    var gauche = Kit.ce('span');
    gauche.appendChild(Kit.ce('b', null, titre + ' ' + libellePlage(h.jour, h.jour)));
    if (detail) gauche.appendChild(Kit.ce('div', 'sb', detail));
    ligne.appendChild(gauche);
    ligne.appendChild(Kit.ce('span', null, Kit.heures(h.minutes)));
    l.appendChild(ligne);
  }

  /* Les périodes du mois, regroupées par bornes identiques. Maria pose ses
     congés sur les quatre contrats à la fois : la même période produit quatre
     imputations. Une seule ligne les représente — sauf quand la ventilation
     diffère d'un contrat à l'autre, auquel cas la ligne le dit et le détail
     s'ouvre au toucher. Les bornes peuvent légitimement différer : un contrat
     qui démarre au milieu de la période n'en porte que la fin. */
  function grouperPeriodes() {
    var par = {};
    var ordre = [];
    function groupe(debut, fin) {
      var cle = debut + '|' + fin;
      if (!par[cle]) { par[cle] = { debut: debut, fin: fin, lignes: [] }; ordre.push(cle); }
      return par[cle];
    }

    vue.fiches.forEach(function (f) {
      if (f.erreur) return;
      var couvertes = {};
      (f.imputations || []).forEach(function (i) {
        couvertes[i.date_debut + '|' + i.date_fin] = true;
        groupe(i.date_debut, i.date_fin).lignes.push({ contrat: f.contrat, imputation: i });
      });

      /* LES CONGÉS SANS RÉPARTITION ENREGISTRÉE ne doivent pas disparaître de
         la liste. Un congé posé avant que la ventilation n'existe, ou dont la
         ligne a été retirée, n'a pas d'imputation — mais il est bel et bien
         décompté, et il figure sur le document du mois. L'écran qui dirait
         « aucun congé posé » alors que le calendrier en montre serait pire que
         celui qu'on corrige.

         Leurs bornes viennent du MOTEUR, qui regroupe lui-même les journées de
         congé en périodes continues (`imputationsAppliquees`). On ne devine
         donc aucune période à partir de dates consécutives : la période reste
         une donnée, produite par celui qui connaît RG-06 et les fériés. */
      var appliquees = (f.entree && f.entree.resultat &&
                        f.entree.resultat.imputationsAppliquees) || [];
      appliquees.forEach(function (a) {
        if (a.source === 'imposee') return;
        if (couvertes[a.date_debut + '|' + a.date_fin]) return;
        var planning = planningA(f, a.date_debut);
        groupe(a.date_debut, a.date_fin).lignes.push({
          contrat: f.contrat, fiche: f,
          /* Forme d'imputation reconstituée pour l'affichage seul : elle n'est
             jamais écrite, et son décompte est celui du moteur. */
          imputation: {
            id: null, date_debut: a.date_debut, date_fin: a.date_fin,
            jours_ouvrables: Engine.decompterJoursOuvrables(a.date_debut, a.date_fin, planning),
            jours_sur_cp: null, jours_sur_sup: null, jours_sans_solde: null
          },
          sansRepartition: true
        });
      });
    });

    return ordre.map(function (c) { return par[c]; }).sort(function (a, b) {
      if (a.debut === b.debut) return a.fin < b.fin ? -1 : 1;
      return a.debut < b.debut ? -1 : 1;
    });
  }

  function memeVentilation(groupe) {
    var ref = groupe.lignes[0].imputation;
    var refSans = !!groupe.lignes[0].sansRepartition;
    return groupe.lignes.every(function (x) {
      if (!!x.sansRepartition !== refSans) return false;
      return x.imputation.jours_sur_cp === ref.jours_sur_cp &&
             x.imputation.jours_sur_sup === ref.jours_sur_sup &&
             x.imputation.jours_sans_solde === ref.jours_sans_solde &&
             x.imputation.jours_ouvrables === ref.jours_ouvrables;
    });
  }

  /* « dont 10 sur vos congés payés, 5 en récupération, 2 sans solde ».
     Les postes à zéro ne sont pas mentionnés : une ligne « 0 sans solde »
     ferait douter d'une retenue qui n'existe pas. */
  function detailVentilation(i) {
    if (i.jours_sur_cp === null) {
      return 'répartis dans l’ordre habituel de ce contrat';
    }
    var bouts = [];
    if (i.jours_sur_cp > 0) bouts.push(i.jours_sur_cp + ' sur vos congés payés');
    if (i.jours_sur_sup > 0) bouts.push(i.jours_sur_sup + ' en récupération');
    if (i.jours_sans_solde > 0) bouts.push(i.jours_sans_solde + ' sans solde');
    if (!bouts.length) return null;
    return 'dont ' + bouts.join(', ');
  }


  function ligneperiode(l, groupe) {
    var ref = groupe.lignes[0].imputation;
    var uniforme = memeVentilation(groupe);

    /* Une période à cheval garde ses bornes RÉELLES et annonce sa part : la
       découper au 1er du mois donnerait un décompte faux. La part vient de la
       chaîne, qui la demande au moteur. */
    var planning = planningA(groupe.lignes[0].fiche, groupe.debut);
    /* La part d'un mois se calcule avec LES MÊMES samedis que le décompte
       total : deux règles différentes donneraient « 6 jours, dont 3 en août »
       sur une période qui en compte 5. */
    var part = Chaine.partDuMois(Engine, ref, planning, vue.annee, vue.mois,
      samedisDuGroupe(groupe));

    var textes = [];
    if (part !== ref.jours_ouvrables) {
      textes.push('dont ' + Kit.jours(part) + ' en ' + Kit.libelleMois(vue.mois));
    }
    /* §7 — UNE PÉRIODE AFFICHÉE NOMME SES SAMEDIS COMPTÉS, comme sur le
       document. Une période sans samedi compté ne dit rien de plus : le
       décompte parle seul. */
    var samedis = samedisDuGroupe(groupe);
    if (samedis.length) {
      textes.push('dont ' + (samedis.length > 1 ? 'les samedis ' : 'le ') +
        samedis.map(function (d) {
          return samedis.length > 1 ? Kit.jourLong(d).toLowerCase().replace('samedi ', '')
                                    : Kit.jourLong(d).toLowerCase();
        }).join(', '));
    }
    var sous = uniforme ? detailVentilation(ref) : 'la répartition diffère d’un contrat à l’autre';
    if (sous) textes.push(sous);

    /* Ligne construite à la main : `Kit.ligne` ne prend qu'un libellé texte,
       et il faut ici un titre en gras suivi d'un sous-texte. */
    var ligne = Kit.ce('div', 'l');
    var gauche = Kit.ce('span');
    gauche.appendChild(Kit.ce('b', null, Kit.libellePeriode(groupe.debut, groupe.fin)));
    if (textes.length) gauche.appendChild(Kit.ce('div', 'sb', textes.join(' · ')));
    ligne.appendChild(gauche);
    ligne.appendChild(Kit.ce('span', null, Kit.jours(ref.jours_ouvrables) + ' ouvrables'));
    l.appendChild(ligne);

    if (!uniforme) {
      var det = Kit.ce('details', 'ventil-detail');
      det.appendChild(Kit.ce('summary', null, 'Voir la répartition par enfant'));
      groupe.lignes.forEach(function (x) {
        det.appendChild(Kit.ce('div', 'sb', x.contrat.prenom_enfant + ' — ' +
          (detailVentilation(x.imputation) || 'aucune répartition enregistrée')));
      });
      l.appendChild(det);
    }
  }


  /* LA PHRASE QUI ÉTEINT LE LITIGE. Elle figure sous la liste, toujours, et
     la mention des fériés n'apparaît que s'il y en a un dans une période —
     information demandée au moteur, jamais écrite en dur : `Engine` connaît
     les fériés, l'écran non. */
  function phraseDecompte(groupes) {
    var texte = Kit.RESUME_RG06;
    var feries = feriesDesPeriodes(groupes);
    if (feries.length) {
      texte += ' Les jours fériés ne sont pas décomptés : ' +
        feries.map(function (d) { return 'le ' + Kit.jourLong(d); }).join(', ') +
        (feries.length > 1 ? ' ne comptent pas.' : ' ne compte pas.');
    }
    return Kit.ce('div', 'sb q', texte);
  }

  /* CORRECTION RELECTURE LOT 16 (B2). Cette fonction parcourait `debut` →
     `fin` et nommait tout férié trouvé. Deux erreurs, symétriques :

     - elle MANQUAIT le férié tombant après le dernier jour posé — typiquement
       le samedi qui prolonge une semaine jusqu'à la veille de la reprise. Le
       15 août 2026 est un samedi férié : une semaine posée du 10 au 14 compte
       5 jours et non 6, et l'écran ne le disait pas. C'est mot pour mot
       l'exemple de la spécification, et le seul cas que la phrase existe pour
       expliquer ;
     - elle NOMMAIT un férié tombant un dimanche, qui n'a jamais rien retiré.

     Les deux sont réglés dans `chaine-mois.js`, qui applique la règle de
     reprise de RG-06 au lieu de s'arrêter à `date_fin`. */
  function feriesDesPeriodes(groupes) {
    var vus = {};
    groupes.forEach(function (g) {
      var planning = planningA(g.lignes[0].fiche, g.debut);
      /* LOT 17 — la règle est rendue au moteur, seul autorisé à la porter :
         `Chaine.feriesDecomptes` n'existe plus. */
      Engine.feriesDeLaPeriode(g.debut, g.fin, planning).forEach(function (d) {
        vus[d] = true;
      });
    });
    return Object.keys(vus).sort();
  }

  /* Les réserves, CONTRAT PAR CONTRAT, congés payés ET récupération. La
     version précédente n'affichait que les congés payés : Maria ne pouvait
     donc pas savoir, avant de poser, si sa récupération suffirait à éviter le
     sans-solde. Or c'est exactement l'arbitrage que le lot 10 lui rend. */
  function panneauReserves() {
    var p = Kit.pane('Vos réserves');
    var l = Kit.lines(p);
    vue.fiches.forEach(function (f) {
      if (f.erreur) {
        Kit.ligne(l, f.contrat.prenom_enfant, 'indisponible', { alerte: true });
        return;
      }
      var cp = cpDe(f);
      var sup = supDe(f);
      var cond = condDe(f);
      /* §7 — LE RESTE DU QUOTA EST VISIBLE HORS DE LA POSE. Sans cela, Maria
         ne découvrirait combien il lui reste de samedis qu'au moment de poser
         un congé, c'est-à-dire trop tard pour arbitrer. */
      Kit.ligne(l, f.contrat.prenom_enfant,
        Kit.joursCp(cp, mpjc(cond)) + ' de congés payés · ' +
        joursDeRecup(cond, sup) + ' de récupération · ' + phraseQuotaSamedis(f),
        /* `phrase` : cette valeur est une phrase, pas un montant. Sans elle,
           elle sortait de l'encadré et faisait glisser tout l'écran de côté. */
        { alerte: Kit.cpEstBas(cp, cond), phrase: true });
    });
    p.appendChild(Kit.ce('div', 'sb q',
      'Les compteurs diffèrent car les contrats n’ont pas commencé en même temps.'));
    return p;
  }

  /* §7 — « samedis comptés : 2 sur 5 cette année ». Le compte porte sur
     l'année de référence du MOIS AFFICHÉ, et il se lit dans les samedis
     chargés avec la fiche. `null` veut dire « pas pu lire » : on le dit, on
     ne le remplace pas par zéro (§8). */
  function phraseQuotaSamedis(f) {
    if (f.samedis == null) return 'samedis comptés : non lus';
    var annee = Kit.anneeDeReferenceConges(
      vue.annee + '-' + String(vue.mois).padStart(2, '0') + '-15');
    var n = f.samedis.filter(function (x) {
      var d = String(x.date_samedi || x).slice(0, 10);
      return d >= annee.debut && d <= annee.fin;
    }).length;
    return 'samedis comptés : ' + n + ' sur ' + Kit.QUOTA_SAMEDIS + ' cette année';
  }

  /* §7 — les samedis comptés d'UNE période, pour qu'elle les NOMME. */
  function samedisDuGroupe(groupe) {
    var vus = {};
    groupe.lignes.forEach(function (x) {
      var f = x.fiche || trouverFiche(x.contrat);
      var id = x.imputation && x.imputation.id;
      if (!f || !f.samedis || !id) return;
      f.samedis.forEach(function (sm) {
        if (sm.imputation_id === id) vus[String(sm.date_samedi).slice(0, 10)] = true;
      });
    });
    return Object.keys(vus).sort();
  }

  function trouverFiche(contrat) {
    return (vue.fiches || []).filter(function (f) {
      return f.contrat && contrat && f.contrat.id === contrat.id;
    })[0] || null;
  }

  /* La récupération se lit en MINUTES en base, et se dépense en JOURNÉES de
     congé. « 36 h » ne dit pas à Maria combien de jours elle peut prendre ;
     « 4 jours (36 h) » le dit. La conversion utilise les minutes d'une journée
     de congé DU CONTRAT — jamais 7 h, jamais 8 h en dur. */
  /* Le facteur de conversion des congés payés, `minutes_par_jour_conge`, lu
     UNE FOIS ici. Zéro plutôt qu'un défaut à 540 : un diviseur inventé
     afficherait un nombre de jours faux et crédible, et les appelants savent
     déjà dire « je ne peux pas convertir ». */
  function mpjc(conditions) {
    return (conditions && conditions.minutes_par_jour_conge) || 0;
  }

  /* CORRECTION C1 DE LA RELECTURE — RG-05 NE SE RÉÉCRIT PAS ICI.
     `Math.floor(minutes / parJour)` est la règle de conversion du moteur,
     recopiée dans un écran. `Chaine.reservesEnJours` a précisément été créée
     au lot 16 pour la porter — elle interroge `Engine.imputerConges`, la seule
     fonction qui a le droit de dire combien de jours une réserve couvre. */
  function joursDeRecup(conditions, minutes) {
    var parJour = mpjc(conditions);
    if (!parJour) return Kit.heures(minutes);
    var n = Chaine.reservesEnJours(conditions, { minutesSup: minutes }).joursSup;
    return Kit.jours(n) + ' (' + Kit.heures(minutes) + ')';
  }

  /* LOT 16 §16.1 d) — LE COMPTEUR D'ENTRÉE, PAS CELUI DE SORTIE.

     Ces deux fonctions lisaient `resultat.compteurSortie`, c'est-à-dire le
     solde APRÈS le mois où la période commence. Le moteur, lui, confronte la
     ventilation au compteur d'ENTRÉE de ce mois (`js/engine.js`, contrôle 3
     d'`imputerConges`), et un mois contenant un congé n'acquiert rien.

     L'écart n'était pas théorique : c'est lui qui a laissé écrire 6 jours de
     récupération sur un contrat là où le moteur n'en accepte que 5, puis rendu
     tous ses mois incalculables. L'écran proposait plus que le moteur
     n'accepte ; il propose désormais exactement ce qu'il accepte. */
  /* LOT 17 §17.3 — LES CONDITIONS DU MOIS OÙ LA PÉRIODE COMMENCE.

     Un écran qui lit un réglage sur `contrat` lit la valeur d'AUJOURD'HUI et
     l'applique à un mois d'hier. C'est précisément ce que les avenants
     existent pour empêcher : passer l'entretien de 5,00 € à 5,50 € ne doit
     pas changer un juillet qui traîne.

     La chaîne a déjà résolu les conditions de chaque mois : on les lui
     demande, on ne les recalcule pas. Le repli sur `avenants` sert au chemin
     de POSE, qui travaille sur des mois futurs dont aucune chaîne n'existe
     encore. */
  function condDe(fiche, annee, mois) {
    var e = fiche && fiche.entree;
    if (e && e.conditions && annee == null) return e.conditions;
    if (annee != null && fiche && fiche.avenants) {
      return global.App.conditionsDuMois(fiche.avenants, annee, mois);
    }
    return (e && e.conditions) || null;
  }

  /* Le planning d'un contrat à une date donnée. Un avenant peut le changer :
     une période à cheval sur un avenant n'a pas le même planning au début et à
     la fin, et deviner l'un ou l'autre écrirait des journées les mauvais jours. */
  function planningA(fiche, jour) {
    var c = condDe(fiche, Number(jour.slice(0, 4)), Number(jour.slice(5, 7)));
    return (c && c.jours_planning) || [1, 2, 3, 4, 5];
  }

  function cpDe(fiche) {
    return Kit.cpDisponible(fiche.entree && fiche.entree.compteurEntree);
  }
  function supDe(fiche) {
    return Kit.supDisponible(fiche.entree && fiche.entree.compteurEntree);
  }

  /* CORRECTION RELECTURE LOT 16 (C3) — CE QUE LES RÉSERVES COUVRENT, EN JOURS,
     VIENT DU MOTEUR.

     L'écran écrivait `Math.floor(cp / 10)` et
     `Math.floor(sup / minutes_par_jour_conge)` : c'est RG-05 réécrite dans
     l'interface, aux deux endroits où l'on ventile. Le lot 16 avait corrigé la
     SOURCE (compteur d'entrée au lieu de compteur de sortie) mais gardé la
     conversion sur place.

     Et elle ne serait pas restée juste : le §17.6 fait passer les congés payés
     des dixièmes de jour aux MINUTES. Le jour où `cp` porte des minutes,
     `Math.floor(cp / 10)` ne lève aucune erreur — il annonce simplement 54
     jours disponibles au lieu de 10. Deux divisions par 10 dans un écran sont
     exactement ce qu'on oublie. */
  function plafondsDe(fiche) {
    var r = Chaine.reservesEnJours(condDe(fiche), fiche.entree && fiche.entree.compteurEntree);
    return { maxCp: r.joursCp, maxSup: r.joursSup };
  }

  /* ------------------------------------------------------------------ */
  /* Outils de période                                                   */
  /* ------------------------------------------------------------------ */

  /* Les jours du planning d'un contrat dans une période, fériés et bornes du
     contrat exclus. Ce sont les journées qui seront réellement ÉCRITES ;
     le DÉCOMPTE en jours ouvrables, lui, est tout autre chose (RG-06 compte le
     samedi, que Maria travaille ou non) et vient du moteur. */
  /* LOT 17 — LE PLANNING EST RÉSOLU JOUR PAR JOUR. Un avenant peut le changer
     au 1er d'un mois ; une période à cheval sur cet avenant n'a donc pas le
     même planning au début et à la fin, et retenir l'un ou l'autre écrirait
     des journées les mauvais jours — sur un mois qui sera peut-être clôturé
     avant que quiconque ne s'en aperçoive. */
  function joursDuContrat(fiche, plage) {
    var contrat = fiche.contrat || fiche;
    var out = [];
    for (var d = plage.debut; d <= plage.fin; d = Feries.ajouterJours(d, 1)) {
      var planning = fiche.contrat ? planningA(fiche, d)
                                   : (fiche.jours_planning || [1, 2, 3, 4, 5]);
      if (planning.indexOf(Engine.jourSemaine(d)) === -1) continue;
      if (Feries.estJourFerie(d)) continue;
      if (contrat.date_debut && d < contrat.date_debut) continue;
      if (contrat.date_fin && d > contrat.date_fin) continue;
      out.push(d);
    }
    return out;
  }

  function moisDeJours(jours) {
    var vus = {}, out = [];
    jours.forEach(function (d) {
      var k = d.slice(0, 7);
      if (!vus[k]) { vus[k] = true; out.push({ annee: Number(d.slice(0, 4)), mois: Number(d.slice(5, 7)) }); }
    });
    out.sort(function (a, b) { return Chaine.cmpMois(a.annee, a.mois, b.annee, b.mois); });
    return out;
  }

  function moisDePeriode(plage) {
    return moisDeJours(joursDuContrat({ jours_planning: [1, 2, 3, 4, 5, 6, 7] }, plage));
  }

  function libellePlage(a, b) {
    if (a === b) return 'le ' + Kit.jourLong(a).toLowerCase();
    return 'du ' + Kit.jourLong(a).toLowerCase() + ' au ' + Kit.jourLong(b).toLowerCase();
  }

  /* ------------------------------------------------------------------ */
  /* 2. Le parcours de pose — trois étapes                               */
  /* ------------------------------------------------------------------ */

  /* ================================================================== */
  /* LOT 21 (§21.1) — TROIS FORMATS DE POSE                             */
  /*                                                                     */
  /* Maria ne pose plus seulement des journées. Elle pose aussi une      */
  /* demi-journée, ou une durée libre — 23 min, 1 h, 1 h 34 — sur une    */
  /* journée qu'elle travaille par ailleurs.                             */
  /*                                                                     */
  /* Le parcours en journées ne bouge pas d'une ligne : il a ses dates,  */
  /* son décompte RG-06, sa ventilation entre trois compteurs et son     */
  /* `imputation_conge`. Les deux formats à l'heure prennent un chemin   */
  /* entièrement distinct — une seule date, une durée en minutes, et UNE */
  /* issue par enfant. Les mélanger aurait fait de la ventilation en     */
  /* jours un cas particulier d'un mécanisme en minutes, ou l'inverse :  */
  /* deux règles d'imputation dans le même écran, et la garantie qu'une  */
  /* correction dans l'une casserait l'autre.                            */
  /* ================================================================== */

  var FORMATS = [
    { cle: 'journees', titre: 'Une ou plusieurs journées',
      sous: 'Des dates, puis la répartition famille par famille.' },
    { cle: 'demi', titre: 'Une demi-journée',
      sous: 'Une date, et la moitié d’une journée de congé.' },
    { cle: 'libre', titre: 'Une durée libre',
      sous: 'Une date, et la durée que vous voulez — 23 min, 1 h, 1 h 34…' }
  ];

  function ouvrirParcours() {
    Kit.ouvrirFeuille('Je pose…', 'Trois façons de poser un congé.',
      function (corps) {
        FORMATS.forEach(function (f, i) {
          Kit.choix(corps, 'c' + (i + 1), ['⬛', '◧', '⏱'][i], f.titre, f.sous,
            function () { demarrerFormat(f.cle); });
        });
      });
  }

  function demarrerFormat(format) {
    var auj = global.App.aujourdhui();
    if (format === 'journees') {
      parcours = { debut: auj, fin: auj, etape: 1, index: 0, plans: [] };
      return etapeDates();
    }
    parcours = {
      format: format,
      jour: auj,
      cptExplicite: {},
      /* La demi-journée est pré-remplie et non modifiable ; la durée libre
         part d'une valeur ronde que Maria remplace. */
      minutes: format === 'demi' ? demiJournee().minutes : 90,
      qui: {},
      /* Les contrats décochés PAR UN OBSTACLE, et non par Maria. */
      exclu: {},
      cpt: {}
    };
    etapeHeure();
  }

  /* §21.1 — LA DEMI-JOURNÉE, ET LE SEUIL DE LA DURÉE LIBRE.

     La spécification écrit « 4 h 30 (270 minutes) ». Ce n'est pas un nombre
     magique : c'est la moitié d'une journée de congé, et la journée de congé
     vient de l'avenant (`minutes_par_jour_conge`, 540 aujourd'hui). Figer 270
     rendrait la demi-journée fausse le jour où un avenant change la journée de
     référence — exactement le défaut que le lot 17 a passé un cycle à éteindre.

     Les quatre contrats peuvent en théorie porter des journées de référence
     différentes. On retient alors la plus COURTE : c'est celle qui rend le
     seuil de la durée libre valable pour tous, et la divergence est dite. */
  function demiJournee() {
    var valeurs = [];
    (vue.fiches || []).forEach(function (f) {
      if (f.erreur) return;
      var m = mpjc(condDe(f));
      if (m > 0 && valeurs.indexOf(m) === -1) valeurs.push(m);
    });
    if (!valeurs.length) return { minutes: 0, divergent: false };
    var mini = Math.min.apply(null, valeurs);
    return { minutes: Math.floor(mini / 2), divergent: valeurs.length > 1 };
  }

  /* ------------------------------------------------------------------ */
  /* LOT 21 — LA POSE À L'HEURE : une date, une durée, une issue par      */
  /* enfant. Tout tient dans une seule feuille : le geste est court, et   */
  /* un parcours en trois étapes pour poser 23 minutes serait absurde.    */
  /* ------------------------------------------------------------------ */

  /* Les fiches qui peuvent recevoir une pose ce jour-là : contrat lisible,
     jour au planning, dans les bornes du contrat, hors férié. Un enfant rangé
     n'est pas dans `vue.fiches` — l'écran ne liste que les contrats actifs. */
  function fichesDuJour(jour) {
    return (vue.fiches || []).filter(function (f) {
      return !f.erreur && joursDuContrat(f, { debut: jour, fin: jour }).length === 1;
    });
  }

  /* Ce qui EMPÊCHE de poser sur cette journée, pour ce contrat. `null` = rien
     n'empêche. On refuse plutôt que d'écraser : chacun de ces trois cas
     détruirait une donnée que personne ne peut recalculer. */
  function obstacleDuJour(f, jour) {
    /* CORRECTION C1 — L'ÉCHEC DE LECTURE DIT SON VRAI MOTIF.

       Le repli posait une ligne factice `{ ecart_evenement: 'illisible' }`, et
       `obstacleDuJour` tombait sur la branche suivante : Maria lisait « une
       déclaration d'horaire est déjà posée ce jour-là » sur une journée où il
       n'y a rien, et allait la chercher dans l'espace enfant. Le comportement
       — échouer fermé — était le bon ; c'est la phrase qui mentait. */
    if (f.contexteIllisible) {
      return 'impossible de vérifier cette journée pour l’instant';
    }
    var l = (f.journeesPose || {})[jour];
    if (l && l.ecart_evenement === 'conge_horaire') {
      /* Reposer par-dessus remplacerait la déclaration existante sans un mot,
         et le compteur rendrait puis reprendrait des minutes différentes. On
         demande de retirer d'abord : c'est un geste de plus, et c'est le seul
         qui laisse une trace lisible de ce qui s'est passé. */
      return 'un congé est déjà posé sur cette journée — retirez-le d’abord';
    }
    if (l && l.ecart_evenement) {
      return 'une déclaration d’horaire est déjà posée ce jour-là';
    }
    if (l && l.type === 'familiarisation') {
      return 'cette journée est en familiarisation, payée à l’heure';
    }
    if (l && TYPES_ABSENCE_MARIA.indexOf(l.type) !== -1) {
      return 'vous êtes déjà absente toute la journée';
    }
    return null;
  }

  function etapeHeure() {
    var libre = parcours.format === 'libre';
    var demi = demiJournee();

    Kit.ouvrirFeuille(libre ? 'Une durée libre' : 'Une demi-journée',
      'La journée reste travaillée : seules les minutes posées sortent de vos compteurs.',
      function (corps) {
        var maintenant = global.App.moisCourant();
        var chJour = Kit.champDate('Le jour', parcours.jour,
          { anneeMin: maintenant.annee - 2, anneeMax: maintenant.annee + 2 });
        corps.appendChild(chJour.bloc);

        var chDuree = null;
        if (libre) {
          chDuree = Kit.champHeureMinute('Durée', minutesEnIso(parcours.minutes));
          corps.appendChild(chDuree.bloc);
          corps.appendChild(Kit.ce('p', 'sb q',
            'Ce que vous voulez, à la minute près, en dessous de ' +
            Kit.heures(demi.minutes) + '.'));
          var raccourcis = Kit.ce('div', 'row');
          [23, 60, 94].forEach(function (m) {
            var b = Kit.bouton('btn sm nt', function () {
              parcours.minutes = m;
              chDuree.input.value = minutesEnIso(m);
              majTout();
            });
            b.textContent = Kit.heures(m);
            raccourcis.appendChild(b);
          });
          corps.appendChild(raccourcis);
        } else {
          corps.appendChild(Kit.fld('Durée', Kit.heures(demi.minutes) +
            ' — la moitié d’une journée de congé'));
          if (demi.divergent) {
            corps.appendChild(Kit.ce('p', 'sb q',
              'Vos contrats n’ont pas tous la même journée de référence : ' +
              'la plus courte fait foi, pour qu’aucun compteur ne soit dépassé.'));
          }
        }

        var alerte = Kit.ce('div');
        corps.appendChild(alerte);
        corps.appendChild(Kit.section('Pour qui, et sur quoi ?'));
        corps.appendChild(Kit.ce('p', 'sb q',
          'Chaque famille se règle individuellement.'));
        var zoneQui = Kit.ce('div');
        corps.appendChild(zoneQui);

        var msg = Kit.ce('div', 'msg');
        corps.appendChild(msg);
        var bPoser = Kit.bouton('btn', function () { poserHoraire(bPoser, msg); });
        corps.appendChild(bPoser);

        chJour.bloc.addEventListener('change', function () {
          parcours.jour = chJour.valeur();
          chargerContexteDuJour().then(majTout);
        });
        if (chDuree) {
          chDuree.input.addEventListener('change', function () {
            parcours.minutes = isoEnMinutes(chDuree.valeur());
            majTout();
          });
        }

        function majTout() {
          Kit.vider(alerte);
          Kit.vider(zoneQui);
          msg.className = 'msg';
          msg.textContent = '';

          /* §21.1 — LES DEUX REFUS, ET LEUR PHRASE EXACTE. Le bouton reste
             inactif tant que la durée n'est pas posable ; sans la phrase, un
             bouton mort passerait pour une panne. */
          var dureeOk = true;
          if (libre) {
            if (parcours.minutes >= demi.minutes && demi.minutes > 0) {
              alerte.appendChild(Kit.warnbox(
                Kit.heures(parcours.minutes) + ' : c’est une demi-journée ou plus',
                /* REMARQUE 4 — « au-delà de » excluait 4 h 30, qui est
                   pourtant déjà refusé. La borne est stricte : on le dit. */
                ' À partir de ' + Kit.heures(demi.minutes) + ', choisissez « une ' +
                'demi-journée » ou « une ou plusieurs journées ».'));
              dureeOk = false;
            } else if (parcours.minutes <= 0) {
              alerte.appendChild(Kit.note('Saisissez une durée',
                '1 h, 23 min, 1 h 34 — ce que vous voulez, en dessous de ' +
                Kit.heures(demi.minutes) + '.'));
              dureeOk = false;
            }
          } else if (demi.minutes <= 0) {
            alerte.appendChild(Kit.warnbox('Journée de congé inconnue',
              ' Aucun de vos contrats ne porte de conditions pour ce mois : ' +
              'impossible de savoir ce que vaut une demi-journée.'));
            dureeOk = false;
          }

          var minutes = libre ? parcours.minutes : demi.minutes;
          var fiches = fichesDuJour(parcours.jour);
          var retenus = [];

          if (!fiches.length) {
            zoneQui.appendChild(Kit.ce('p', 'vide',
              'Aucun de vos contrats n’est gardé ce jour-là : il n’y a rien à poser.'));
          }

          fiches.forEach(function (f) {
            var id = f.contrat.id;
            var obstacle = obstacleDuJour(f, parcours.jour);

            /* UN DÉCOCHAGE IMPOSÉ N'EST PAS UN CHOIX DE MARIA.

               L'obstacle décoche le contrat pour empêcher l'écriture. Mais la
               date se change dans la même feuille : si Maria déplace la pose
               sur une journée libre, le contrat doit REVENIR de lui-même. Sans
               cette mémoire, il resterait exclu en silence — la feuille dirait
               « Poser 1h00 sur 2 contrats » là où trois sont gardés, sans que
               rien à l'écran n'explique le troisième absent. */
            if (obstacle) {
              parcours.exclu[id] = true;
              parcours.qui[id] = false;
            } else if (parcours.exclu[id]) {
              delete parcours.exclu[id];
              delete parcours.qui[id];
            }
            var coche = parcours.qui[id] !== false && !obstacle;

            var b = Kit.choix(zoneQui, 'c1', coche ? '●' : '○',
              f.contrat.prenom_enfant,
              obstacle ? 'Impossible : ' + obstacle + '.' : reservesLisibles(f),
              function () {
                if (obstacle) return;
                parcours.qui[id] = !coche;
                majTout();
              });
            if (coche) b.className += ' on';
            if (obstacle) b.className += ' off';
            b.setAttribute('role', 'checkbox');
            b.setAttribute('aria-checked', coche ? 'true' : 'false');
            if (!coche || !dureeOk || minutes <= 0) return;

            retenus.push(f);
            zoneQui.appendChild(blocIssue(f, minutes, majTout));
          });

          bPoser.disabled = !dureeOk || !retenus.length;
          bPoser.textContent = 'Poser ' + Kit.heures(dureeOk ? minutes : 0) +
            (retenus.length === 1
              ? ' pour ' + retenus[0].contrat.prenom_enfant
              : (retenus.length > 1 ? ' sur ' + retenus.length + ' contrats' : ''));
        }

        chargerContexteDuJour().then(majTout);
      });
  }

  /* Les journées déjà saisies ce jour-là, pour chaque contrat : c'est ce qui
     dit si la pose est possible. Un échec de lecture ne laisse pas croire que
     la voie est libre — il coche l'obstacle « impossible de vérifier ». */
  /* CORRECTION B1 DE LA RELECTURE DES LOTS 20 À 22 — LE GARDE-FOU VÉRIFIAIT
     LE SOLDE D'UN MOIS, ET L'ÉCRITURE ATTERRISSAIT SUR UN AUTRE.

     `cpDe(f)` lit le compteur d'entrée de `f.entree`, construit UNE FOIS à
     l'ouverture de l'écran, pour le MOIS AFFICHÉ. Or la feuille de pose offre
     un champ de date libre sur quatre ans. Maria consulte juillet, pose une
     demi-journée au 15 octobre : l'écran annonce les réserves de juillet, le
     bouton « Congés payés » est actif, et l'écriture consomme un compteur
     d'octobre qui peut être vide. Le moteur n'écrête pas, `cpDisponible` borne
     l'affichage à zéro — et le solde négatif n'apparaît nulle part, pour
     toujours (RG-12, aucune remise à zéro).

     Changer de date recharge donc AUSSI les compteurs, pour le mois de la date
     choisie. Chaque fiche porte `entreeDuJour` ; `cpDuJour` et `supDuJour` la
     lisent, et c'est elle — pas le mois affiché — qui décide de ce que les
     congés payés couvrent.

     ÉCHOUE FERMÉ. Si la chaîne du mois visé ne peut pas être calculée, la
     fiche est marquée illisible et la pose lui est refusée : proposer un
     compteur qu'on n'a pas pu lire est exactement ce qui a produit ce
     défaut. */
  function chargerContexteDuJour() {
    var m = Chaine.moisDeDate(parcours.jour);
    return Promise.all((vue.fiches || []).map(function (f) {
      if (f.erreur) return null;
      return Promise.all([
        global.App.journees(f.contrat.id, m.annee, m.mois)
          .then(function (j) { return { ok: true, journees: j || {} }; })
          .catch(function () { return { ok: false, journees: {} }; }),   // C1 : dit fermé, et dit vrai
        global.App.serie(f.contrat, m)
          .then(function (chaine) {
            return { ok: true, entree: global.App.moisDe(chaine, m.annee, m.mois) };
          })
          .catch(function () { return { ok: false, entree: null }; })
      ]).then(function (r) {
        f.journeesPose = r[0].journees;
        f.entreeDuJour = r[1].entree;
        /* `null` sans erreur = le contrat ne couvre pas ce mois. Ce n'est pas
           un échec : `fichesDuJour` l'écarte déjà par ses bornes. */
        f.contexteIllisible = !r[0].ok || !r[1].ok;
      });
    })).then(function () { return true; });
  }

  /* Les réserves du MOIS DE LA DATE CHOISIE. Le repli sur `f.entree` ne sert
     qu'aux écrans qui n'ouvrent pas la feuille de pose. */
  function entreeDuJour(f) {
    return f.entreeDuJour || f.entree || null;
  }
  function cpDuJour(f) {
    var e = entreeDuJour(f);
    return Kit.cpDisponible(e && e.compteurEntree);
  }
  function supDuJour(f) {
    var e = entreeDuJour(f);
    return Kit.supDisponible(e && e.compteurEntree);
  }
  /* Le solde SIGNÉ, pour l'affichage. Voir la correction C3. */
  function supSoldeDuJour(f) {
    var e = entreeDuJour(f);
    return Kit.supSolde(e && e.compteurEntree);
  }
  function condDuJour(f) {
    var m = Chaine.moisDeDate(parcours.jour);
    return condDe(f, m.annee, m.mois);
  }

  /* CORRECTION C3 — LE SOLDE AFFICHÉ EST LE SOLDE SIGNÉ.

     `supDisponible` borne à zéro : c'est ce qu'une ventilation a le droit de
     CONSOMMER, et ça doit le rester. Mais l'écran l'utilisait aussi pour
     AFFICHER, et annonçait « 0h00 » sur un compteur à − 1 h 30 — juste après
     avoir prévenu « vous devrez 1 h 30 à cette famille ». C'est la correction
     B5 du lot 17, portée à l'espace enfant et pas ici. Les deux lectures sont
     désormais distinctes, comme `js/ui-kit.js` le demande. */
  function reservesLisibles(f) {
    var cond = condDuJour(f) || condDe(f);
    var signe = supSoldeDuJour(f);
    return 'récup ' + (signe < 0 ? '− ' + Kit.heures(-signe) : Kit.heures(signe)) +
      ' · CP ' + Kit.joursCp(cpDuJour(f), mpjc(cond));
  }

  /* §21.2 — L'ISSUE, POUR CET ENFANT ET LUI SEUL.

     Trois issues, et le PRÉ-CHOIX est intelligent : récupération si elle
     couvre, sinon congés payés s'ils couvrent, sinon sans solde. Maria peut
     changer chaque choix — y compris forcer une récupération insuffisante, en
     connaissance de cause. Les congés payés, eux, ne sont jamais
     sélectionnables quand ils ne couvrent pas : ils ne passent JAMAIS en
     négatif, par aucun chemin. */
  function blocIssue(f, minutes, apres) {
    var id = f.contrat.id;
    /* CORRECTION B1 — tout ce bloc lit le mois de la DATE CHOISIE, pas le mois
       affiché : c'est lui que l'écriture va toucher. */
    var cond = condDuJour(f) || condDe(f);
    var cp = cpDuJour(f);
    var sup = supDuJour(f);
    var soldeSup = supSoldeDuJour(f);
    var cpCouvre = cp >= minutes;

    /* LE PRÉ-CHOIX SE RECALCULE TANT QUE MARIA N'A RIEN CHOISI.

       Il dépend de la DURÉE, pas seulement de l'enfant : 1 h tient sur la
       récupération de Tom, 2 h non. Figer le pré-choix à la première durée
       saisie laisserait « → récupération » sur un compteur qui ne couvre plus
       — et le §21.2 dit que le pré-choix est intelligent, pas qu'il est posé
       une fois pour toutes.

       Dès que Maria touche un des trois boutons, son choix devient EXPLICITE
       et plus rien ne le déplace : elle a le droit de forcer une récupération
       insuffisante, en connaissance de cause. */
    if (!parcours.cptExplicite) parcours.cptExplicite = {};
    if (!parcours.cptExplicite[id]) {
      parcours.cpt[id] = sup >= minutes ? 'recuperation'
                       : (cpCouvre ? 'conges_payes' : 'sans_solde');
    } else if (parcours.cpt[id] === 'conges_payes' && !cpCouvre) {
      /* Même un choix explicite ne peut pas faire passer les congés payés en
         négatif : ils ne le font JAMAIS, par aucun chemin (A4). */
      parcours.cpt[id] = 'sans_solde';
    }
    var choisi = parcours.cpt[id];

    var bloc = Kit.ce('div', 'issue');
    var rangee = Kit.ce('div', 'row');
    [['recuperation', 'Récupération'], ['conges_payes', 'Congés payés'],
     ['sans_solde', 'Sans solde']].forEach(function (x) {
      var inactif = x[0] === 'conges_payes' && !cpCouvre;
      var b = Kit.bouton('btn sm' + (choisi === x[0] ? '' : ' nt') + (inactif ? ' off' : ''),
        inactif ? null : function () {
          parcours.cpt[id] = x[0];
          parcours.cptExplicite[id] = true;
          apres();
        });
      b.textContent = x[1];
      b.disabled = inactif;
      rangee.appendChild(b);
    });
    bloc.appendChild(rangee);

    /* L'EFFET CHIFFRÉ, rejoué par le moteur — jamais écrit en dur (B.0-4). */
    if (choisi === 'recuperation') {
      /* La dette annoncée part du solde SIGNÉ : sur un compteur déjà à
         − 3 h 00, annoncer « vous devrez 1 h 30 » au lieu de 4 h 30 serait
         faux de toute la dette déjà accumulée (même défaut que B5 du lot 17). */
      var apresRecup = soldeSup - minutes;
      bloc.appendChild(apresRecup >= 0
        ? Kit.ce('div', 'sb', '→ récupération : ' + Kit.heures(apresRecup))
        : Kit.warnbox('Vous devrez ' + Kit.heures(-apresRecup) + ' à cette famille',
            ' Votre récupération passera en négatif sur ce contrat. C’est possible, ' +
            'et c’est du temps que vous rendrez.'));
    } else if (choisi === 'conges_payes') {
      bloc.appendChild(Kit.ce('div', 'sb',
        '→ congés payés : ' + Kit.joursCp(cp - minutes, mpjc(cond))));
    } else {
      var brut = brutDe(f);
      bloc.appendChild(Kit.ce('div', 'sb', brut != null
        ? '→ sans solde : − ' + Kit.eur(Engine.montantCentimes(brut, minutes)) +
          ' sur son mois'
        : '→ sans solde : la retenue ne peut pas être chiffrée, la rémunération ' +
          'de ce mois n’est pas renseignée'));
    }
    if (!cpCouvre) {
      bloc.appendChild(Kit.ce('div', 'sb q',
        'Congés payés : plus assez — reste ' + Kit.joursCp(cp, mpjc(cond)) + '.'));
    }
    return bloc;
  }

  /* §21.2 — L'ÉCRITURE. Une journée par contrat retenu, et rien d'autre.

     La journée GARDE SON TYPE : elle reste travaillée, l'indemnité d'entretien
     reste due, les minutes du contrat restent dues (RG-01, RG-02). Seules les
     minutes posées sortent du compteur choisi — c'est exactement la mécanique
     d'un écart d'horaire déclaré (§17.5), et c'est pourquoi le congé à l'heure
     l'emprunte plutôt que d'en inventer une seconde.

     DÉCISION D'ADRIEN, 23 août 2026 : le jour reste un jour de présence, en
     durée libre comme en demi-journée. */
  function poserHoraire(bouton, msg) {
    var minutes = parcours.format === 'demi' ? demiJournee().minutes : parcours.minutes;
    var jour = parcours.jour;
    var retenus = fichesDuJour(jour).filter(function (f) {
      return parcours.qui[f.contrat.id] !== false && !obstacleDuJour(f, jour);
    });
    if (!retenus.length || minutes <= 0) return;

    function echec(texte) {
      bouton.disabled = false;
      msg.className = 'msg ko';
      msg.textContent = texte;
    }

    bouton.disabled = true;
    msg.className = 'msg';
    msg.textContent = 'Enregistrement…';

    var m = Chaine.moisDeDate(jour);
    /* LE MOIS CLÔTURÉ EST REFUSÉ, ET LE REFUS LE NOMME. Contrairement au
       parcours en journées, on ne propose pas de rouvrir : poser vingt-trois
       minutes ne justifie pas de faire diverger un document déjà remis à une
       famille. Le chemin de réouverture existe, il est ailleurs, et il est
       tracé. Le contrôle ÉCHOUE FERMÉ : sans les récapitulatifs, on refuse. */
    global.App.recapsDuMois(m.annee, m.mois).then(function (parId) {
      var clos = retenus.filter(function (f) {
        return global.App.estClos(parId, f.contrat.id);
      });
      if (clos.length) {
        return echec(Kit.moisCapitale(m.annee, m.mois) + ' est déjà clôturé pour ' +
          liste(clos.map(function (f) { return f.contrat.prenom_enfant; })) +
          '. Un mois clôturé ne se recalcule pas : rouvrez-le depuis son ' +
          'récapitulatif si vous devez vraiment y poser ce congé. Rien n’a été enregistré.');
      }

      return Promise.all(retenus.map(function (f) {
        var l = (f.journeesPose || {})[jour] || {};
        return global.DB.enregistrerJournee({
          contrat_id: f.contrat.id,
          jour: jour,
          /* Le type ne change pas : la journée reste ce qu'elle était. */
          type: l.type || 'presence',
          minutes_reelles: l.minutes_reelles == null ? null : l.minutes_reelles,
          entretien_centimes: l.entretien_centimes == null ? null : l.entretien_centimes,
          commentaire: l.commentaire == null ? null : l.commentaire,
          ecart_minutes: -minutes,
          ecart_evenement: 'conge_horaire',
          ecart_heure_reelle: null,
          ecart_impute_sur: parcours.cpt[f.contrat.id] || 'recuperation'
        });
      })).then(function () {
        global.App.invalider();
        Kit.fermerFeuille();
        Kit.toast(Kit.heures(minutes) + ' posées sur ' +
          liste(retenus.map(function (f) { return f.contrat.prenom_enfant; })));
        global.App.remplacer('conges', { annee: vue.annee, mois: vue.mois });
      });
    }).catch(function (e) {
      /* La feuille RESTE ouverte : la saisie en cours ne disparaît jamais en
         silence (B.0-9). */
      echec('Rien n’a été enregistré — ' + Kit.messageErreur(e));
    });
  }

  function minutesEnIso(m) {
    var n = Math.max(0, m || 0);
    return String(Math.floor(n / 60)).padStart(2, '0') + ':' +
           String(n % 60).padStart(2, '0');
  }
  function isoEnMinutes(t) {
    var p = String(t || '').split(':');
    var h = Number(p[0]), mn = Number(p[1]);
    if (!isFinite(h) || !isFinite(mn)) return 0;
    return h * 60 + mn;
  }

  /* --- Étape 1 : les dates ------------------------------------------- */

  function etapeDates() {
    var maintenant = global.App.moisCourant();
    Kit.ouvrirFeuille('Quand serez-vous absente ?',
      'Pour une seule journée, mettez la même date dans les deux champs.',
      function (corps) {
        var bornes = { anneeMin: maintenant.annee - 2, anneeMax: maintenant.annee + 2 };
        var du = Kit.champDate('Du', parcours.debut, bornes);
        var au = Kit.champDate('Au', parcours.fin, bornes);
        corps.appendChild(du.bloc);
        corps.appendChild(au.bloc);

        var zone = Kit.ce('div');
        corps.appendChild(zone);

        var bSuite = Kit.bouton('btn', function () { verifierPuisVentiler(bSuite); });
        bSuite.textContent = 'Continuer';
        corps.appendChild(bSuite);

        /* Le décompte se met à jour EN DIRECT. Sans cela, Maria découvre après
           coup qu'une semaine du lundi au vendredi compte 6 jours — c'est
           précisément le désaccord historique avec les familles, et il ne doit
           surprendre personne. */
        function rafraichirDecompte() {
          parcours.debut = du.valeur();
          parcours.fin = au.valeur();
          Kit.vider(zone);

          if (parcours.fin < parcours.debut) {
            zone.appendChild(Kit.warnbox('La fin précède le début',
              ' Choisissez une date de fin postérieure ou égale à la date de début.'));
            bSuite.disabled = true;
            return;
          }

          /* RG-06 — le décompte vient du MOTEUR, jamais recalculé ici.

             CORRECTIF B2 DE LA RELECTURE PR9. Le commentaire qui tenait cette
             place affirmait : « Le planning passé est celui de la RÈGLE
             (lundi-samedi) ». C'était faux deux fois. Aucun planning n'était
             passé, et le défaut du moteur est lundi-VENDREDI, pas
             lundi-samedi. L'écran annonçait donc 4 jours là où le moteur en
             compte 6 pour un contrat du lundi au jeudi — et écrivait ce 4
             dans l'imputation, que le moteur aurait refusée.

             Le décompte DÉPEND du planning : un jeudi d'absence coûte 3 jours
             ouvrables à un contrat du lundi au jeudi (jeudi, vendredi,
             samedi ; reprise le lundi) et 1 seul à un contrat du lundi au
             vendredi. Il n'y a donc pas UN chiffre à annoncer ici, mais autant
             que de plannings. On interroge le moteur pour chacun et on annonce
             l'étendue réelle — exactement ce que fait déjà l'espace enfant. */
          var servis = (vue.fiches || []).filter(function (f) {
            return !f.erreur && joursDuContrat(f, parcours).length > 0;
          });
          var decomptes = servis.map(function (f) {
            return Engine.decompterJoursOuvrables(parcours.debut, parcours.fin,
              planningA(f, parcours.debut));
          });
          var mini = decomptes.length ? Math.min.apply(null, decomptes) : 0;
          var maxi = decomptes.length ? Math.max.apply(null, decomptes) : 0;
          parcours.jours = maxi;

          var b = Kit.ce('div', 'decompte');
          b.appendChild(Kit.ce('div', 'gros', mini === maxi
            ? Kit.jours(maxi) + ' ouvrables décomptés'
            : 'de ' + mini + ' à ' + Kit.jours(maxi) + ' ouvrables décomptés'));
          b.appendChild(Kit.ce('div', 'q',
            libellePlage(parcours.debut, parcours.fin).replace(/^./, function (c) {
              return c.toUpperCase();
            }) + '.'));
          /* §6.3 — LA RÈGLE DU DÉCOMPTE EST DITE, PAS SOUS-ENTENDUE, et elle
             vient de la constante partagée. Elle disait « samedi inclus »
             jusqu'ici ; ce n'est plus vrai, et un chiffre qui baisse sans
             explication est pire qu'un chiffre qu'on conteste. */
          b.appendChild(Kit.ce('div', 'q', Kit.RESUME_RG06));
          if (mini !== maxi) {
            b.appendChild(Kit.ce('div', 'q',
              'Le nombre dépend des jours de garde de chaque contrat. Le détail ' +
              'vous sera donné enfant par enfant à l’étape suivante.'));
          }
          zone.appendChild(b);
          bSuite.disabled = maxi === 0;
          if (maxi === 0) {
            zone.appendChild(Kit.ce('p', 'sb q',
              'Cette période ne contient aucun jour ouvrable : rien ne serait décompté.'));
          }
        }

        du.bloc.addEventListener('change', rafraichirDecompte);
        au.bloc.addEventListener('change', rafraichirDecompte);
        rafraichirDecompte();
      });
  }

  /* Avant de ventiler : la période recouvre-t-elle un mois DÉJÀ CLÔTURÉ ?
     Depuis le lot 13 un mois clôturé peut être rouvert, mais jamais en
     silence : rouvrir, c'est faire diverger un document déjà remis à une
     famille. On le dit, on le trace, et on ne pose rien avant. */
  function verifierPuisVentiler(bouton) {
    bouton.disabled = true;
    var plage = { debut: parcours.debut, fin: parcours.fin };
    var moisConcernes = moisDePeriode(plage);

    Promise.all(moisConcernes.map(function (mm) {
      return global.App.recapsDuMois(mm.annee, mm.mois).then(function (r) {
        return { annee: mm.annee, mois: mm.mois, cle: Chaine.cleMois(mm.annee, mm.mois), recaps: r };
      });
    })).then(function (liste) {
      var clos = [];
      liste.forEach(function (x) {
        var contrats = vue.fiches.filter(function (f) {
          return joursDuContrat(f, plage).some(function (d) {
            return d.slice(0, 7) === x.cle;
          }) && global.App.estClos(x.recaps, f.contrat.id);
        });
        if (contrats.length) clos.push({ annee: x.annee, mois: x.mois, fiches: contrats });
      });

      bouton.disabled = false;
      if (clos.length) return feuilleMoisClos(clos);
      return preparerVentilations();
    }).catch(function (e) {
      bouton.disabled = false;
      Kit.toast('Impossible de vérifier l’état des mois : ' + Kit.messageErreur(e) +
        ' Rien n’a été posé.', true);
    });
  }

  /* CORRECTIF A4 (lot 10) DE LA RELECTURE PR9 — LA FEUILLE ANNONÇAIT UN MOIS
     ET LE BOUTON EN ROUVRAIT PLUSIEURS.

     Elle affichait « Juillet 2026 est clôturé » et « Rouvrir juillet et
     continuer » ; `rouvrirPuisVentiler` bouclait sur TOUT `clos` — juillet ET
     août, pour les quatre contrats, soit huit réouvertures réelles en base. Et
     si Maria refermait ensuite la feuille de ventilation, deux mois fois
     quatre contrats restaient dé-clôturés, aucun congé n'était posé, et rien
     ne le signalait. La réouverture, elle, n'est pas réversible : elle laisse
     une trace indélébile dans l'historique du mois (lot 13).

     La feuille énumère donc TOUS les mois concernés, et le bouton dit combien
     de réouvertures il déclenche. On ne change pas ce que fait le geste : on
     cesse de le sous-annoncer. */
  function feuilleMoisClos(clos) {
    var premier = clos[0];
    var prenoms = premier.fiches.map(function (f) { return f.contrat.prenom_enfant; });
    var tousLesMois = clos.map(function (x) {
      return Kit.libelleMoisAnnee(x.annee, x.mois);
    });
    var nbReouvertures = clos.reduce(function (n, x) { return n + x.fiches.length; }, 0);
    var titre = clos.length > 1
      ? tousLesMois.length + ' mois sont clôturés'
      : Kit.moisCapitale(premier.annee, premier.mois) + ' est clôturé';

    Kit.ouvrirFeuille(titre, liste(prenoms), function (corps) {
        corps.appendChild(Kit.warnbox(
          (clos.length > 1
            ? 'Ces mois sont clôturés : ' + liste(tousLesMois) + '.'
            : Kit.moisCapitale(premier.annee, premier.mois) + ' est clôturé pour ' +
              liste(prenoms) + '.'),
          ' Pour poser ces congés, il faut ' +
          (nbReouvertures > 1
            ? 'rouvrir ' + nbReouvertures + ' récapitulatifs — ' +
              liste(tousLesMois) + ', pour ' + liste(prenoms) + '. Chaque ' +
              'réouverture laisse une trace définitive dans l’historique du mois.'
            : 'rouvrir ce mois.') +
          ' Ils seront à clôturer à nouveau ensuite, et vous devrez renvoyer les ' +
          'récapitulatifs déjà transmis.'));

        var bRouvrir = Kit.bouton('btn', function () { rouvrirPuisVentiler(clos, bRouvrir); });
        bRouvrir.textContent = nbReouvertures > 1
          ? 'Rouvrir ces ' + nbReouvertures + ' récapitulatifs et continuer'
          : 'Rouvrir ' + Kit.libelleMois(premier.mois) + ' et continuer';
        corps.appendChild(bRouvrir);

        var bAutres = Kit.bouton('btn nt', function () { etapeDates(); });
        bAutres.textContent = 'Choisir d’autres dates';
        corps.appendChild(bAutres);
      });
  }

  function rouvrirPuisVentiler(clos, bouton) {
    bouton.disabled = true;
    var gestes = [];
    clos.forEach(function (x) {
      x.fiches.forEach(function (f) {
        /* Le motif part avec la réouverture : c'est lui qui rendra
           l'historique du mois lisible dans six mois. La base écrit
           l'événement elle-même (migration 006), quel que soit le chemin. */
        gestes.push(global.DB.rouvrirRecap(f.contrat.id, x.annee, x.mois,
          'Congés posés après clôture'));
      });
    });
    Promise.all(gestes).then(function () {
      global.App.invalider();
      return preparerVentilations();
    }).catch(function (e) {
      bouton.disabled = false;
      Kit.toast('La réouverture n’a pas abouti : ' + Kit.messageErreur(e) +
        ' Aucun congé n’a été posé.', true);
    });
  }

  /* --- Étape 2 : la ventilation, une page par contrat ----------------- */

  /* Pour chaque contrat : ses réserves, le nombre de jours à répartir, et la
     répartition PROPOSÉE PAR LE MOTEUR selon l'ordre du contrat (RG-07).
     Proposée, pas imposée : Maria la modifie librement. */
  /* CORRECTIF A7 (lot 10) DE LA RELECTURE PR9 — LES RÉSERVES VENAIENT DU
     MAUVAIS MOIS.

     Le panneau « Vos réserves » et les bornes des compteurs étaient ceux du
     compteur de sortie du mois OUVERT DANS L'ONGLET, pas du mois où la période
     commence. Maria pouvait donc poser un congé de décembre depuis l'écran de
     juillet et arbitrer sur des chiffres faux (B.0-4 : ne jamais présenter un
     chiffre qui n'est pas celui de la situation décrite).

     On lit donc la chaîne au mois de DÉBUT DE LA PÉRIODE. C'est un aller-retour
     de plus, mis en cache par `App.serie`, et il n'a lieu que lorsque le mois
     diffère. */
  function preparerVentilations() {
    var plage = { debut: parcours.debut, fin: parcours.fin };
    var moisPeriode = Chaine.moisDeDate(plage.debut);
    var memeMois = moisPeriode.annee === vue.annee && moisPeriode.mois === vue.mois;

    var prepare = memeMois
      ? Promise.resolve(vue.fiches)
      : Promise.all(vue.fiches.map(function (f) {
          if (f.erreur) return f;
          return global.App.serie(f.contrat, moisPeriode).then(function (chaine) {
            var e = global.App.moisDe(chaine, moisPeriode.annee, moisPeriode.mois);
            /* Pas d'entrée pour ce mois : le contrat ne le couvre pas. On
               garde la fiche telle quelle ; `joursDuContrat` l'écartera. */
            return e ? { contrat: f.contrat, entree: e, journees: f.journees, erreur: null } : f;
          }).catch(function (err) {
            return { contrat: f.contrat, entree: null, journees: {}, erreur: err };
          });
        }));

    return prepare
      .then(function (fiches) { return avecJourneesDeLaPeriode(fiches, plage); })
      .then(function (fiches) {
      return preparerVentilationsAvec(fiches, plage);
    }).catch(function (e) {
      Kit.fermerFeuille();
      Kit.toast('Impossible de lire vos compteurs pour cette période : ' +
        Kit.messageErreur(e) + ' Rien n’a été posé.', true);
    });
  }

  /* LOT 18 §18.4 (10·A5) — DE QUOI RÉTABLIR L'AVERTISSEMENT DE SAISIE
     MANUELLE.

     La garde existait avant la réécriture de cet écran au lot 10, et n'a
     jamais été rétablie. Poser un congé passe par un `upsert` qui REMPLACE la
     ligne du jour et remet heures réelles et indemnité à `null` : une journée
     de familiarisation, saisie à la main heure par heure, disparaît sans
     retour possible et sans un mot.

     Ce n'est pas une phrase de confort, c'est une garde : elle protège la
     seule donnée de l'application que personne ne peut recalculer.

     Les journées du mois affiché sont déjà en mémoire, mais une période peut
     tomber sur un AUTRE mois — c'est même le cas le plus fréquent, un congé
     se pose d'avance. On charge donc les journées de tous les mois que la
     période touche. Un échec de lecture n'est pas tu : l'écran dira qu'il n'a
     pas pu vérifier, plutôt que de laisser croire qu'il n'y a rien à
     écraser. */
  function avecJourneesDeLaPeriode(fiches, plage) {
    var mois = moisDePeriode(plage);
    return Promise.all(fiches.map(function (f) {
      if (f.erreur) return f;
      return Promise.all(mois.map(function (m) {
        return global.App.journees(f.contrat.id, m.annee, m.mois)
          .then(function (j) { return j || {}; })
          .catch(function () { return null; });
      })).then(function (paquets) {
        var toutes = {}, incomplet = false;
        paquets.forEach(function (j) {
          if (!j) { incomplet = true; return; }
          Object.keys(j).forEach(function (k) { toutes[k] = j[k]; });
        });
        var copie = {};
        for (var k in f) copie[k] = f[k];
        copie.journeesPeriode = toutes;
        copie.journeesPeriodeIncomplete = incomplet;
        return copie;
      });
    }));
  }

  /* Les journées de CE contrat, dans la période, que la pose va effacer :
     une familiarisation, des heures réelles ou une indemnité saisies à la
     main. Même prédicat que dans l'espace enfant — une seule définition de
     « saisie manuelle » dans l'application. */
  function journeesManuelles(p) {
    var source = (p.fiche && p.fiche.journeesPeriode) || {};
    var out = [];
    (p.joursPoses || []).forEach(function (d) {
      var l = source[d];
      if (!l) return;
      if (l.type === 'familiarisation' ||
          l.minutes_reelles != null || l.entretien_centimes != null) out.push(d);
    });
    return out;
  }

  function preparerVentilationsAvec(fiches, plage) {
    parcours.plans = fiches.filter(function (f) { return !f.erreur; }).map(function (f) {
      var c = f.contrat;
      var joursPoses = joursDuContrat(f, plage);
      var cp = cpDe(f);
      var sup = supDe(f);
      var plafonds = plafondsDe(f);

      /* CORRECTIFS B2 ET A6 DE LA RELECTURE PR9 — deux erreurs au même
         endroit, sur la même ligne.

         B2 : le décompte dépend du PLANNING du contrat. Sans lui, l'écran
         annonçait un chiffre et le moteur en comptait un autre ; une fois les
         imputations branchées (B1), le moteur aurait refusé le mois entier
         avec IMPUTATION_INCOMPLETE.

         A6 : les BORNES sont celles du contrat, pas celles de la période
         saisie. Un contrat qui démarre le 3 août, sur une période posée du
         27 juillet au 7 août, n'a de congé qu'à partir du 3 : décompter du 27
         lui facturait douze jours ouvrables pour cinq journées d'absence.

         Les bornes retenues sont donc le premier et le dernier jour RÉELLEMENT
         posés pour ce contrat — ce sont aussi celles que le moteur regroupera
         à partir des journées, et l'imputation doit les recouvrir exactement,
         sinon elle est écartée. */
      var bornes = joursPoses.length
        ? { debut: joursPoses[0], fin: joursPoses[joursPoses.length - 1] }
        : null;
      /* LOT 17 — les conditions du mois où la période COMMENCE. C'est celui
         que le moteur confronte aux réserves (`imposeeTotale`), et c'est donc
         le seul qui puisse servir de référence à la ventilation entière. */
      var cond = bornes
        ? condDe(f, Number(bornes.debut.slice(0, 4)), Number(bornes.debut.slice(5, 7)))
        : condDe(f);
      var planning = (cond && cond.jours_planning) || [1, 2, 3, 4, 5];
      /* LA RÈGLE DES CINQ SAMEDIS — les samedis que CE contrat peut compter
         sur CETTE période. Ils viennent du moteur : un écran qui les
         déduirait lui-même redirait RG-06 une deuxième fois. */
      var eligibles = bornes
        ? Engine.samedisEligibles(bornes.debut, bornes.fin, planning) : [];
      /* Rien n'est coché au départ (décision d'Adrien du 24 août 2026 : « rien
         n'est coché par défaut, c'est Maria qui arbitre »). */
      var choisis = {};
      var n = bornes
        ? Engine.decompterJoursOuvrables(bornes.debut, bornes.fin, planning, []) : 0;

      var propose = { joursSurCp: 0, joursSurSup: 0, joursSansSolde: 0 };
      if (n > 0) {
        /* Répartition par défaut : celle du moteur, dans l'ordre du contrat.
           Aucune règle d'imputation n'est réécrite ici. */
        var r = Engine.imputerConges(n, { minutesCp: cp, minutesSup: sup }, cond);
        propose = {
          joursSurCp: r.joursSurCp,
          joursSurSup: r.joursSurSup,
          joursSansSolde: r.joursSansSolde
        };
      }

      return {
        fiche: f, contrat: c, cond: cond, joursPoses: joursPoses, jours: n,
        planning: planning,
        samedisEligibles: eligibles,
        samedisChoisis: choisis,
        /* Le reste du quota, lu en base à l'étape des samedis. `null` tant
           qu'il n'a pas été lu : l'écran refuse alors le choix, il ne suppose
           jamais un quota plein (§8). */
        quota: null,
        /* Les bornes de CE contrat, portées jusqu'à l'écriture : c'est ce
           couple qui part dans `imputation_conge`, pas la plage saisie. */
        bornes: bornes,
        cp: cp, sup: sup,
        maxCp: plafonds.maxCp,
        maxSup: plafonds.maxSup,
        choix: propose
      };
    }).filter(function (p) { return p.jours > 0 && p.joursPoses.length > 0; });

    if (!parcours.plans.length) {
      Kit.fermerFeuille();
      Kit.toast('Aucun de vos contrats n’est concerné par ces dates.', true);
      return;
    }
    parcours.index = 0;
    /* §5.1 — LE CHOIX DES SAMEDIS VIENT APRÈS LES DATES ET AVANT LA
       VENTILATION, et seulement s'il y a au moins un samedi éligible. Sinon,
       rien : l'écran ne s'alourdit pas d'une section vide. */
    var aChoisir = parcours.plans.some(function (p) {
      return p.samedisEligibles.length > 0;
    });
    if (aChoisir) return etapeSamedis();
    etapeVentilation();
  }

  /* ------------------------------------------------------------------ */
  /* §5 — LES SAMEDIS DE CETTE PÉRIODE                                   */
  /*                                                                     */
  /* Un samedi que Maria ne travaille pas ne compte que si elle le       */
  /* choisit, dans la limite de cinq par année de référence et par       */
  /* famille. Le défaut est NON COCHÉ : si le défaut était « compté »,   */
  /* les cinq premiers samedis de l'année seraient consommés tout seuls  */
  /* et elle n'aurait plus le choix DESQUELS (§2.6).                     */
  /* ------------------------------------------------------------------ */

  function recalculerPlan(p) {
    if (!p.bornes) { p.jours = 0; return; }
    var choisis = Object.keys(p.samedisChoisis).filter(function (d) {
      return p.samedisChoisis[d];
    });
    /* LE DÉCOMPTE VIENT DU MOTEUR, rejoué à chaque case cochée (§5.2). */
    p.jours = Engine.decompterJoursOuvrables(p.bornes.debut, p.bornes.fin,
      p.planning, choisis);
    var r = Engine.imputerConges(p.jours, { minutesCp: p.cp, minutesSup: p.sup }, p.cond);
    p.choix = { joursSurCp: r.joursSurCp, joursSurSup: r.joursSurSup,
                joursSansSolde: r.joursSansSolde };
  }

  /* LE RESTE DU QUOTA EST RÉEL, lu en base sur l'année de référence de CHAQUE
     samedi, contrat par contrat (§5.2). Une période à cheval sur le 31 mai
     interroge donc deux années.

     LA LECTURE ÉCHOUE FERMÉ (§8) : si le compte ne peut pas être lu, l'écran
     refuse le choix et le dit, plutôt que de supposer un quota plein. Un
     garde-fou qui échoue ouvert n'est pas un garde-fou. */
  function lireQuotas() {
    var demandes = [];
    parcours.plans.forEach(function (p) {
      var annees = {};
      p.samedisEligibles.forEach(function (d) {
        var a = Kit.anneeDeReferenceConges(d);
        annees[a.debut] = a;
      });
      Object.keys(annees).forEach(function (k) {
        demandes.push({ plan: p, annee: annees[k] });
      });
    });
    /* Contrôle de CAPACITÉ, pas rattrapage d'erreur — même distinction que
       partout ailleurs : un décor de test ancien n'expose pas la fonction et
       n'a aucun samedi compté. Une erreur RÉELLE, elle, rejette et l'écran
       refuse le choix : le quota ne se suppose jamais plein (§8). */
    if (typeof global.DB.compterSamedisAnnee !== 'function') {
      parcours.plans.forEach(function (p) { p.quota = {}; });
      return Promise.resolve(true);
    }
    return Promise.all(demandes.map(function (d) {
      return global.DB.compterSamedisAnnee(d.plan.contrat.id, d.annee.debut, d.annee.fin)
        .then(function (n) { return { d: d, n: n }; });
    })).then(function (res) {
      parcours.plans.forEach(function (p) { p.quota = {}; });
      res.forEach(function (x) { x.d.plan.quota[x.d.annee.debut] = x.n; });
      return true;
    });
  }

  function etapeSamedis() {
    /* La barre d'étapes de la ventilation est « une étape par enfant » : elle
       n'a pas de sens ici, où l'on voit tous les enfants d'un coup. */
    Kit.ouvrirFeuille('Les samedis de cette période',
      libellePlage(parcours.debut, parcours.fin), function (corps) {
        corps.appendChild(Kit.ce('div', 'attente', 'Lecture de vos samedis déjà comptés…'));

        lireQuotas().then(function () {
          Kit.vider(corps);
          dessinerSamedis(corps);
        }).catch(function (e) {
          Kit.vider(corps);
          corps.appendChild(Kit.warnbox(
            'Impossible de lire vos samedis déjà comptés',
            ' ' + Kit.messageErreur(e) + ' Sans ce compte, l’application ne peut ' +
            'pas vous dire combien il vous en reste — et elle ne va pas le ' +
            'deviner. Rien n’a été posé : réessayez, ou revenez aux dates.'));
          var bReessayer = Kit.bouton('btn', function () { etapeSamedis(); });
          bReessayer.textContent = 'Réessayer';
          corps.appendChild(bReessayer);
          var bDates = Kit.bouton('btn nt', function () { etapeDates(); });
          bDates.textContent = 'Revenir aux dates';
          corps.appendChild(bDates);
        });
      });
  }

  function dessinerSamedis(corps) {
    corps.appendChild(Kit.note('Les samedis de cette période',
      ' Un samedi que vous ne travaillez pas ne compte que si vous le ' +
      'choisissez, dans la limite de ' + Kit.QUOTA_SAMEDIS + ' par an et par famille.'));

    /* §5.2 — un samedi FÉRIÉ n'est pas un choix, et une phrase discrète le
       dit plutôt que de le laisser inexpliqué. La liste vient du moteur. */
    var ferisSamedis = {};
    parcours.plans.forEach(function (p) {
      if (!p.bornes) return;
      Engine.feriesDeLaPeriode(p.bornes.debut, p.bornes.fin, p.planning)
        .forEach(function (d) {
          if (Engine.jourSemaine(d) === 6) ferisSamedis[d] = true;
        });
    });
    var listeFeries = Object.keys(ferisSamedis).sort();
    if (listeFeries.length) {
      corps.appendChild(Kit.ce('p', 'sb q',
        listeFeries.length > 1
          ? 'Les samedis ' + listeFeries.map(function (d) {
              return Kit.jourLong(d).toLowerCase();
            }).join(' et ') + ' sont fériés : ils ne sont jamais décomptés.'
          : 'Le ' + Kit.jourLong(listeFeries[0]).toLowerCase() +
            ' est férié : il n’est jamais décompté.'));
    }

    parcours.plans.forEach(function (p) {
      if (!p.samedisEligibles.length) return;
      corps.appendChild(blocSamedisDuContrat(p));
    });

    var bSuite = Kit.bouton('btn', function () {
      parcours.index = 0;
      etapeVentilation();
    });
    bSuite.textContent = 'Continuer';
    corps.appendChild(bSuite);

    var bDates = Kit.bouton('btn nt', function () { etapeDates(); });
    bDates.textContent = 'Revenir aux dates';
    corps.appendChild(bDates);
  }

  function blocSamedisDuContrat(p) {
    var bloc = Kit.pane(p.contrat.prenom_enfant);
    var entete = Kit.ce('p', 'sb q');
    bloc.appendChild(entete);
    var cases = Kit.ce('div', 'samedis');
    bloc.appendChild(cases);
    var effet = Kit.ce('div', 'sb decompte-samedis');
    bloc.appendChild(effet);
    var alerte = Kit.ce('div');
    bloc.appendChild(alerte);

    /* Combien de samedis Maria a déjà comptés cette année-là, hors la période
       en cours de pose, plus ceux qu'elle coche à l'instant. */
    function comptePourAnnee(cleAnnee) {
      var n = p.quota[cleAnnee] || 0;
      Object.keys(p.samedisChoisis).forEach(function (d) {
        if (!p.samedisChoisis[d]) return;
        if (Kit.anneeDeReferenceConges(d).debut === cleAnnee) n++;
      });
      return n;
    }

    function majEntete() {
      var annees = {};
      p.samedisEligibles.forEach(function (d) {
        var a = Kit.anneeDeReferenceConges(d);
        annees[a.debut] = a;
      });
      var textes = Object.keys(annees).sort().map(function (k) {
        var a = annees[k];
        var utilises = comptePourAnnee(k);
        var reste = Kit.QUOTA_SAMEDIS - utilises;
        return (reste > 0
          ? 'il vous reste ' + reste + (reste > 1 ? ' samedis' : ' samedi')
          : (reste === 0 ? 'vous avez utilisé vos ' + Kit.QUOTA_SAMEDIS + ' samedis'
                         : 'vous dépassez de ' + (-reste) +
                           (-reste > 1 ? ' samedis' : ' samedi'))) +
          ' (' + a.libelle + ')';
      });
      Kit.vider(entete);
      entete.appendChild(document.createTextNode(textes.join(' · ')));
    }

    function majEffet() {
      recalculerPlan(p);
      Kit.vider(effet);
      /* §5.2 — LE DÉCOMPTE AFFICHÉ EST REJOUÉ PAR LE MOTEUR. Cocher un samedi
         change la phrase toute seule. */
      effet.appendChild(Kit.ce('b', null, 'Décompte : ' + Kit.jours(p.jours)));

      Kit.vider(alerte);
      var annees = {};
      Object.keys(p.samedisChoisis).forEach(function (d) {
        if (p.samedisChoisis[d]) annees[Kit.anneeDeReferenceConges(d).debut] = true;
      });
      Object.keys(annees).sort().forEach(function (k) {
        var utilises = comptePourAnnee(k);
        if (utilises <= Kit.QUOTA_SAMEDIS) return;
        /* §5.3 — LE DÉPASSEMENT EST PERMIS, MAIS DIT. Même logique que la
           récupération négative du lot 21 : l'application ne décide pas à sa
           place, elle s'assure qu'elle sait. */
        alerte.appendChild(Kit.warnbox(
          'C’est le ' + utilises + 'ᵉ samedi compté pour ' +
          p.contrat.prenom_enfant + ' cette année.',
          ' La règle habituelle en prévoit ' + Kit.QUOTA_SAMEDIS +
          ' par année de référence (' + Kit.anneeDeReferenceConges(k).libelle +
          '). Vous pouvez le compter quand même.'));
      });
      majEntete();
    }

    p.samedisEligibles.forEach(function (d) {
      var lab = Kit.ce('label', 'coche-ligne');
      var box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = !!p.samedisChoisis[d];
      box.addEventListener('change', function () {
        p.samedisChoisis[d] = box.checked;
        majEffet();
      });
      lab.appendChild(box);
      var tx = Kit.ce('span', 'tx');
      tx.appendChild(Kit.ce('b', null, Kit.jourLong(d).toLowerCase()));
      lab.appendChild(tx);
      cases.appendChild(lab);
    });

    majEffet();
    return bloc;
  }

  function etapeVentilation() {
    var p = parcours.plans[parcours.index];
    var c = p.contrat;
    var cond = p.cond;

    Kit.ouvrirFeuille(c.prenom_enfant + ' — ' + Kit.jours(p.jours) + ' à répartir',
      etiquetteEtapes(), function (corps) {
        corps.appendChild(barreEtapes());

        var res = Kit.pane('Vos réserves pour ce contrat');
        var lr = Kit.lines(res);
        Kit.ligne(lr, 'Congés payés', Kit.joursCp(p.cp, mpjc(cond)));
        Kit.ligne(lr, 'Récupération', joursDeRecup(cond, p.sup));
        corps.appendChild(res);

        corps.appendChild(Kit.section('Comment les prendre ?'));

        var reste = Kit.ce('div', 'reste');
        var effet = Kit.ce('div', 'effet-sans-solde');
        /* LOT 18 §18.3 — LES DEUX RACCOURCIS.
           Une semaine de congé sur quatre contrats demandait jusqu'à
           vingt-quatre appuis sur les « + » : six jours, quatre enfants, un
           appui par jour. Ces deux boutons font le geste courant en un seul.

           LA RÉPARTITION VIENT DU MOTEUR (B.0-5). Le raccourci ne calcule
           rien : il rappelle `Engine.imputerConges` avec l'ordre demandé, la
           même fonction qui a produit la proposition initiale. C'est ce qui
           garantit qu'il ne dépasse JAMAIS le disponible — la borne est celle
           du moteur, pas une borne réécrite ici. Ce qui ne tient pas dans la
           réserve choisie suit l'ordre habituel, puis le sans solde, et
           l'encart de bascule le dit déjà, avec son montant. */
        corps.appendChild(raccourcis(p, function () { etapeVentilation(); }));

        var bSuite = Kit.bouton('btn', function () { validerEtape(); });
        bSuite.textContent = parcours.index === parcours.plans.length - 1
          ? 'Voir le récapitulatif' : 'Continuer';

        function majAffichage() {
          var somme = p.choix.joursSurCp + p.choix.joursSurSup + p.choix.joursSansSolde;
          var manque = p.jours - somme;
          Kit.vider(reste);
          reste.className = 'reste' + (manque === 0 ? ' ok' : ' ko');
          reste.appendChild(Kit.ce('span', null, 'Reste à répartir'));
          reste.appendChild(Kit.ce('b', null, String(manque)));

          /* A2 — « Continuer » reste INACTIF tant que le reste n'est pas nul.
             Une ventilation incomplète serait refusée par le moteur avec un
             code d'erreur ; mieux vaut ne jamais la laisser partir. */
          bSuite.disabled = manque !== 0;

          Kit.vider(effet);
          if (p.choix.joursSansSolde > 0) {
            /* V8-11 — l'effet en euros, IMMÉDIATEMENT. Le sans-solde est une
               retenue sur salaire : Maria doit le voir avant de choisir, pas
               le découvrir sur le document du mois. Le montant vient du
               moteur (A4). */
            var brut = brutDe(p.fiche);
            var minutes = p.choix.joursSansSolde * mpjc(cond);
            var retenue = brut ? Engine.montantCentimes(brut, minutes) : null;
            effet.appendChild(Kit.warnbox(
              Kit.jours(p.choix.joursSansSolde) + ' sans solde',
              retenue != null
                ? ' : retenue de ' + Kit.eur(retenue) + ' sur le salaire de ' +
                  c.prenom_enfant + '.'
                : ' : la retenue ne peut pas être chiffrée, le barème de ce contrat ' +
                  'n’est pas renseigné.'));
          }
        }

        corps.appendChild(compteur('Congés payés', p.choix, 'joursSurCp', p.maxCp, majAffichage,
          'reste ' + Kit.joursCp(p.cp, mpjc(cond)) + ' au compteur'));
        corps.appendChild(compteur('Récupération', p.choix, 'joursSurSup', p.maxSup, majAffichage,
          'reste ' + joursDeRecup(cond, p.sup) + ' convertibles'));
        /* A3 — le sans-solde n'a pas de borne haute : c'est le seul moyen de
           poser un congé quand les réserves sont épuisées. Il est borné par le
           nombre de jours de la période, pas par une réserve. */
        /* LOT 18 §18.6 — LE PRIX D'UN JOUR, SOUS SON PROPRE COMPTEUR.
           Le total de la retenue s'affichait déjà, mais seulement APRÈS avoir
           appuyé sur « + ». Le coût unitaire doit se voir AVANT : c'est lui
           qui fait hésiter, et c'est la seule ligne de cet écran qui retire de
           l'argent à Maria. Le montant vient du moteur (RG-08), aucun taux
           horaire n'est écrit ici. */
        var brutJour = brutDe(p.fiche);
        var prixJour = brutJour ? Engine.montantCentimes(brutJour, mpjc(cond)) : null;
        corps.appendChild(compteur('Sans solde', p.choix, 'joursSansSolde', p.jours, majAffichage,
          prixJour != null
            ? 'retenue de ' + Kit.eur(prixJour) + ' par jour'
            : 'retenue non chiffrable, le barème de ce contrat n’est pas renseigné'));

        corps.appendChild(reste);

        /* LOT 16 §16.1 d) — LE BASCULEMENT EN SANS SOLDE EST ANNONCÉ AVANT
           VALIDATION, avec son coût. La répartition proposée vient déjà du
           moteur, qui fait déborder le solde en sans solde ; ce qui manquait,
           c'est la phrase qui le dit. Maria peut modifier ensuite : rien n'est
           imposé, tout est annoncé. */
        corps.appendChild(bascule(p));
        corps.appendChild(effet);

        corps.appendChild(bSuite);

        if (parcours.index > 0) {
          var bRetour = Kit.bouton('btn nt', function () {
            parcours.index--;
            etapeVentilation();
          });
          bRetour.textContent = 'Revenir à ' + parcours.plans[parcours.index - 1].contrat.prenom_enfant;
          corps.appendChild(bRetour);
        }

        majAffichage();
      });
  }

  /* Les deux raccourcis de répartition (§18.3). Rien n'est écrit ici : la
     ventilation est celle que le moteur produit pour l'ordre demandé. */
  function raccourcis(p, apres) {
    var bloc = Kit.ce('div', 'raccourcis');
    [['cp_puis_sup', 'Tout sur mes congés payés'],
     ['sup_puis_cp', 'Tout sur ma récupération']].forEach(function (o) {
      var b = Kit.bouton('btn nt', function () {
        var r = Engine.imputerConges(p.jours,
          { minutesCp: p.cp, minutesSup: p.sup }, condAvecOrdre(p.cond, o[0]));
        p.choix = {
          joursSurCp: r.joursSurCp,
          joursSurSup: r.joursSurSup,
          joursSansSolde: r.joursSansSolde
        };
        apres();
      });
      b.textContent = o[1];
      bloc.appendChild(b);
    });
    return bloc;
  }

  /* Une COPIE des conditions, avec l'ordre demandé. On ne touche jamais aux
     conditions du contrat : un raccourci d'écran ne modifie pas un réglage
     daté (RG-07), il ne fait que poser une question différente au moteur. */
  function condAvecOrdre(cond, ordre) {
    var copie = {};
    for (var k in (cond || {})) copie[k] = cond[k];
    copie.ordre_imputation = ordre;
    return copie;
  }

  /* Un compteur « − n + », borné. La borne haute est passée en paramètre
     parce qu'elle n'est pas la même pour les trois lignes : les réserves pour
     les deux premières, la durée de la période pour le sans-solde.
     Piège n° 5 de la spécification : un « reste à répartir » NÉGATIF signifie
     que les bornes sont mal posées. La borne basse est zéro, toujours. */
  function compteur(libelle, cible, champ, maximum, apres, sousTitre) {
    var f = Kit.ce('div', 'compteur-jours');
    var lb = Kit.ce('span', 'lb', libelle);
    /* LOT 16 §16.1 d) — ce que la réserve couvre, sous son propre compteur :
       le « + » qui s'éteint doit dire pourquoi il s'éteint. */
    if (sousTitre) lb.appendChild(Kit.ce('span', 'sslb', sousTitre));
    f.appendChild(lb);

    var groupe = Kit.ce('div', 'grp');
    var valeur = Kit.ce('b', 'val', String(cible[champ]));

    function poser(delta) {
      var v = cible[champ] + delta;
      if (v < 0) v = 0;
      if (v > maximum) v = maximum;
      cible[champ] = v;
      valeur.textContent = String(v);
      moins.disabled = v <= 0;
      plus.disabled = v >= maximum;
      if (apres) apres();
    }

    var moins = Kit.bouton('pas', function () { poser(-1); });
    moins.textContent = '−';
    moins.setAttribute('aria-label', 'Retirer un jour de ' + libelle.toLowerCase());
    var plus = Kit.bouton('pas', function () { poser(1); });
    plus.textContent = '+';
    plus.setAttribute('aria-label', 'Ajouter un jour de ' + libelle.toLowerCase());

    groupe.appendChild(moins);
    groupe.appendChild(valeur);
    groupe.appendChild(plus);
    f.appendChild(groupe);

    moins.disabled = cible[champ] <= 0;
    plus.disabled = cible[champ] >= maximum;
    return f;
  }

  /* CORRECTION C2 DE LA RELECTURE — `brutDe` NE RENDAIT JAMAIS `null`.

     `(r && r.salaireBrutCentimes) || 0` rendait zéro dans les deux cas : brut
     inconnu, et brut réellement nul. Les trois garde-fous qui testent
     `brut != null` étaient donc STRUCTURELLEMENT INATTEIGNABLES, et l'écran
     annonçait « − 0,00 € sur son mois » sur un mois dont la rémunération n'est
     pas renseignée (§17.2 point 3). Un zéro crédible et faux est exactement ce
     que ce projet refuse.

     `null` désigne maintenant « inconnu », et lui seul. Les appelants qui
     testaient la valeur en booléen continuent de fonctionner : `null` est
     faux, comme `0` l'était.

     OÙ LIRE « INCONNU ». Pas dans le résultat du moteur : `js/chaine-mois.js`
     calcule un mois sans barème AVEC UN BARÈME NUL — c'est voulu, les heures
     sup et les congés doivent continuer de s'accumuler — et le résultat porte
     donc `salaireBrutCentimes = 0`, indiscernable d'un brut réellement nul.
     Le maillon, lui, porte `salaireManquant` : c'est le seul endroit où
     l'information survit. C'est lui qu'on lit. */
  function brutDe(fiche) {
    var e = entreeDuJour(fiche) || fiche.entree;
    if (!e || e.salaireManquant) return null;
    var r = e.resultat;
    if (!r || r.salaireBrutCentimes == null) return null;
    return r.salaireBrutCentimes;
  }

  /* LOT 16 §16.1 d) — « Vos réserves ne couvrent pas toute la période ».

     Le basculement lui-même n'est pas nouveau : la répartition proposée vient
     d'`Engine.imputerConges`, qui fait déjà déborder le reliquat en sans
     solde. Ce qui manquait, c'est de le DIRE, et de le chiffrer, avant que
     Maria n'appuie. Le montant vient de `Engine.montantCentimes` (A4) : aucun
     taux horaire n'est écrit ici.

     Rend un nœud vide quand les réserves couvrent la période : le cas normal
     ne doit rien afficher du tout. */
  function bascule(p) {
    var c = p.contrat;
    var manquant = p.jours - p.maxCp - p.maxSup;
    if (manquant <= 0) return Kit.ce('div');

    var brut = brutDe(p.fiche);
    var minutes = manquant * mpjc(p.cond);
    var retenue = brut ? Engine.montantCentimes(brut, minutes) : null;

    return Kit.note('Vos réserves ne couvrent pas toute la période',
      c.prenom_enfant + ' a ' + Kit.joursCp(p.cp, mpjc(p.cond)) + ' de congés payés et ' +
      joursDeRecup(p.cond, p.sup) + ' de récupération, pour ' + Kit.jours(p.jours) +
      ' à couvrir. ' + Kit.jours(manquant) + ' passent en sans solde' +
      (retenue != null ? ' : − ' + Kit.eur(retenue) + '.' :
        ' ; la retenue ne peut pas être chiffrée, le barème de ce contrat n’est pas renseigné.') +
      ' Vous pouvez changer avant de valider.');
  }

  function etiquetteEtapes() {
    return 'Étape ' + (parcours.index + 1) + ' sur ' + parcours.plans.length +
      ' · ' + libellePlage(parcours.debut, parcours.fin);
  }

  function barreEtapes() {
    var b = Kit.ce('div', 'etapes');
    parcours.plans.forEach(function (p, i) {
      var classe = 'et' + (i < parcours.index ? ' fait' : '') + (i === parcours.index ? ' on' : '');
      var e = Kit.ce('span', classe);
      if (i < parcours.index) e.appendChild(Kit.ce('span', 'ck', '✓'));
      e.appendChild(Kit.avatar(p.contrat, 'pt'));
      e.appendChild(Kit.ce('span', null, p.contrat.prenom_enfant));
      b.appendChild(e);
    });
    return b;
  }

  function validerEtape() {
    if (parcours.index < parcours.plans.length - 1) {
      parcours.index++;
      etapeVentilation();
      return;
    }
    etapeRecapitulatif();
  }

  /* --- Étape 3 : le récapitulatif, avant d'écrire quoi que ce soit ---- */

  function etapeRecapitulatif() {
    Kit.ouvrirFeuille('Vérifiez avant de poser',
      libellePlage(parcours.debut, parcours.fin), function (corps) {
        var totalSansSolde = 0;
        var retenueTotale = 0;
        var chiffrable = true;

        parcours.plans.forEach(function (p) {
          var c = p.contrat;
          var pane = Kit.pane(c.prenom_enfant);
          var l = Kit.lines(pane);
          if (p.choix.joursSurCp) Kit.ligne(l, 'Congés payés', Kit.jours(p.choix.joursSurCp));
          if (p.choix.joursSurSup) Kit.ligne(l, 'Récupération', Kit.jours(p.choix.joursSurSup));
          if (p.choix.joursSansSolde) {
            Kit.ligne(l, 'Sans solde', Kit.jours(p.choix.joursSansSolde), { alerte: true });
            totalSansSolde += p.choix.joursSansSolde;
            var brut = brutDe(p.fiche);
            if (brut) {
              retenueTotale += Engine.montantCentimes(brut,
                p.choix.joursSansSolde * mpjc(p.cond));
            } else {
              chiffrable = false;
            }
          }
          Kit.ligne(l, 'Total décompté', Kit.jours(p.jours), { total: true });
          corps.appendChild(pane);
        });

        if (totalSansSolde > 0) {
          corps.appendChild(Kit.warnbox(
            Kit.jours(totalSansSolde) + ' sans solde en tout',
            chiffrable ? ' : ' + Kit.eur(retenueTotale) + ' de retenue sur vos salaires.'
                       : ' : la retenue ne peut pas être entièrement chiffrée, un barème manque.'));
        }

        /* LOT 18 §18.4 (10·A5) — L'AVERTISSEMENT, AVANT LE BOUTON QUI ÉCRIT. */
        parcours.plans.forEach(function (p) {
          if (p.fiche && p.fiche.journeesPeriodeIncomplete) {
            corps.appendChild(Kit.warnbox(
              'Impossible de vérifier les journées déjà saisies pour ' + p.contrat.prenom_enfant,
              ' Une partie de ses journées n’a pas pu être lue. Si l’une d’elles porte des ' +
              'heures saisies à la main, poser ce congé les effacera sans qu’on puisse ' +
              'vous le signaler.'));
            return;
          }
          var manuelles = journeesManuelles(p);
          if (!manuelles.length) return;
          corps.appendChild(Kit.warnbox(
            'Une saisie manuelle sera remplacée chez ' + p.contrat.prenom_enfant,
            ' ' + manuelles.map(function (d) { return Kit.jourLong(d).toLowerCase(); }).join(', ') +
            ' : ces journées portent des heures réelles ou une indemnité saisies à la main ' +
            '(familiarisation). Poser un congé les efface sans possibilité de les retrouver.'));
        });

        var b = Kit.bouton('btn', function () { poser(b); });
        b.textContent = 'Poser ces congés';
        corps.appendChild(b);

        var bRetour = Kit.bouton('btn nt', function () {
          parcours.index = parcours.plans.length - 1;
          etapeVentilation();
        });
        bRetour.textContent = 'Revenir à la répartition';
        corps.appendChild(bRetour);
      });
  }

  /* L'écriture : les journées, puis l'imputation de chaque contrat.

     L'IMPUTATION PORTE LA PÉRIODE ENTIÈRE, pas chaque journée (piège n° 2).
     RG-06 se compte sur une période continue : la découper journée par journée
     ferait perdre le samedi, et une semaine complète cesserait de valoir
     6 jours. C'est le décompte que les familles contestent depuis toujours. */
  /* CORRECTIF B3 DE LA RELECTURE PR9 — L'ORDRE DES DEUX ÉCRITURES EST INVERSÉ.

     Avant : les journées partaient d'abord, les imputations ensuite. Quand la
     contrainte d'exclusion refusait la seconde — Maria repose une période qui
     en chevauche une déjà enregistrée, ce qui arrive dès qu'elle rallonge un
     congé — sept journées fois quatre contrats étaient DÉJÀ ÉCRITES, sans
     ventilation, et consommaient des congés payés selon l'ordre par défaut.
     Le message disait « Enregistrement impossible ». Il était faux.

     Maintenant : les imputations d'abord. C'est elles qui portent le refus le
     plus probable, et une imputation seule ne change RIEN aux compteurs tant
     qu'aucune journée de congé n'existe — le moteur l'écarte. Si l'écriture
     des journées échoue ensuite, les imputations déjà posées sont retirées.

     Et le lot d'imputations lui-même est repris : sans cela, un refus sur le
     deuxième contrat laissait le premier ventilé et les autres non. */
  function poser(bouton) {
    bouton.disabled = true;
    var plans = parcours.plans;
    var affectations = plans.map(function (p) {
      return { contratId: p.contrat.id, jours: p.joursPoses };
    });
    var posees = [];

    function retirerImputations() {
      return Promise.all(posees.filter(Boolean).map(function (i) {
        return global.DB.supprimerImputation(i.id).catch(function () { return null; });
      }));
    }

    /* Une par une, et non en parallèle : deux insertions simultanées sur des
       périodes qui se chevauchent laisseraient la base arbitrer, et la liste
       de ce qui a réellement été écrit deviendrait incertaine. */
    var chaine = Promise.resolve();
    plans.forEach(function (p) {
      chaine = chaine.then(function () {
        return global.DB.enregistrerImputation({
          contrat_id: p.contrat.id,
          /* A6 : les bornes de CE contrat, pas la plage saisie. */
          date_debut: p.bornes.debut,
          date_fin: p.bornes.fin,
          jours_ouvrables: p.jours,
          jours_sur_cp: p.choix.joursSurCp,
          jours_sur_sup: p.choix.joursSurSup,
          jours_sans_solde: p.choix.joursSansSolde
        }).then(function (i) {
          posees.push(i);
          /* §4.3 — LA PÉRIODE ET SES SAMEDIS ABOUTISSENT ENSEMBLE OU ÉCHOUENT
             ENSEMBLE. Une période enregistrée sans ses samedis porterait un
             décompte faux, et le moteur écarterait la ventilation — Maria
             lirait « votre choix a été écarté » sans savoir pourquoi.

             Il n'y a pas de transaction côté client : l'atomicité est obtenue
             par COMPENSATION, comme pour les journées depuis le correctif B3.
             Si l'écriture des samedis échoue, la chaîne rejette, et
             `retirerImputations` supprime les imputations déjà posées — la
             CASCADE de `samedi_conge` emporte les samedis avec elles. */
          var choisis = Object.keys(p.samedisChoisis || {}).filter(function (d) {
            return p.samedisChoisis[d];
          }).sort();
          if (!choisis.length) return null;
          return global.DB.enregistrerSamedis(i.id, choisis);
        });
      });
    });

    chaine
      .catch(function (e) {
        /* Rien n'a encore été posé côté journées : on retire ce qui l'a été
           côté imputations et on s'arrête là. */
        return retirerImputations().then(function () { throw e; });
      })
      .then(function () {
        return global.DB.poserAbsenceMaria(affectations, 'conge_maria', null)
          .catch(function (e) {
            return retirerImputations().then(function () { throw e; });
          });
      })
      .then(function () {
        var imputations = posees;
        global.App.invalider();
        Kit.fermerFeuille();
        /* V8-21 — un « Annuler » de 5 secondes. Poser des congés touche
           quatre contrats, leurs journées ET leurs compteurs : c'est
           exactement le genre de geste qu'on ne veut pas défaire à la main. */
        Kit.toast('Congés posés ' + libellePlage(parcours.debut, parcours.fin) +
          ' sur ' + libelleContrats(plans.length) + '.', false, {
            libelle: 'Annuler',
            delai: 5000,
            onclick: function () { annulerPose(plans, imputations); }
          });
        parcours = null;
        return global.App.rafraichir();
      })
      .catch(function (e) {
        bouton.disabled = false;
        /* La phrase peut désormais dire ce qui est vrai : rien n'a été écrit.
           Elle affirmait le contraire avant le correctif B3, alors que sept
           journées par contrat étaient déjà posées. */
        Kit.toast('Rien n’a été enregistré : ' + Kit.messageErreur(e) +
          ' Vos congés sont restés comme ils étaient.', true);
        global.App.invalider();
      });
  }

  function annulerPose(plans, imputations) {
    var gestes = (imputations || []).filter(Boolean).map(function (i) {
      return global.DB.supprimerImputation(i.id);
    });
    gestes.push(global.DB.retirerAbsenceMaria(
      plans.map(function (p) { return p.contrat.id; }),
      plans.reduce(function (acc, p) { return acc.concat(p.joursPoses); }, []),
      TYPES_ABSENCE_MARIA));

    Promise.all(gestes).then(function () {
      global.App.invalider();
      Kit.toast('C’est annulé — vos compteurs sont rendus.');
      return global.App.rafraichir();
    }).catch(function (e) {
      Kit.toast('L’annulation n’a pas abouti : ' + Kit.messageErreur(e) +
        ' Vos congés sont toujours posés.', true);
      global.App.invalider();
      return global.App.rafraichir();
    });
  }

  function liste(noms) {
    if (!noms.length) return '';
    if (noms.length === 1) return noms[0];
    return noms.slice(0, -1).join(', ') + ' et ' + noms[noms.length - 1];
  }

  /* ------------------------------------------------------------------ */
  /* 3. Retirer des congés                                               */
  /*                                                                     */
  /* Retirer une PÉRIODE, pas des journées éparses : c'est la période qui */
  /* porte le décompte RG-06 et sa ventilation. Retirer l'imputation sans */
  /* remettre les journées en présence rendrait les compteurs mais        */
  /* laisserait le calendrier faux (piège n° 4) — et inversement.        */
  /* ------------------------------------------------------------------ */

  function feuilleRetrait() {
    Kit.ouvrirFeuille('Retirer des congés',
      'Choisissez une période déjà posée.', function (corps) {
        var attente = Kit.ce('div', 'attente', 'Lecture de vos périodes…');
        corps.appendChild(attente);

        /* `listImputations` prend des bornes : sans elles, PostgREST reçoit
           « undefined » et ne rend rien. La fenêtre part du début du contrat
           le plus ancien et va un an après le mois affiché — une période de
           congé posée d'avance doit rester retirable, c'est la correction A13
           du lot 6. */
        var fenetre = fenetreDesPeriodes();
        Promise.all(vue.fiches.map(function (f) {
          return global.DB.listImputations(f.contrat.id, fenetre.debut, fenetre.fin)
            .then(function (l) { return { fiche: f, imputations: l || [] }; })
            .catch(function () { return { fiche: f, imputations: [] }; });
        })).then(function (parContrat) {
          corps.removeChild(attente);
          var periodes = regrouperParPeriode(parContrat);

          var horaires = congesHoraires();
          if (!periodes.length && !horaires.length) {
            corps.appendChild(Kit.ce('p', 'vide',
              'Aucune période de congé enregistrée. Les congés posés avant la refonte ' +
              'se retirent depuis le calendrier d’un enfant.'));
            return;
          }

          periodes.forEach(function (p) {
            Kit.choix(corps, 'c1', '−', libellePlage(p.debut, p.fin).replace(/^./, function (c) {
              return c.toUpperCase();
            }), Kit.jours(p.jours) + ' décomptés · ' +
              liste(p.entrees.map(function (e) { return e.fiche.contrat.prenom_enfant; })),
              function () { confirmerRetrait(p); });
          });

          /* §21.3 — LES CONGÉS À L'HEURE SE RETIRENT ICI AUSSI. Ils ne sont pas
             des périodes : ils vivent sur les journées, et se retirent en
             effaçant la déclaration. Le retrait rend EXACTEMENT ce qui avait
             été déduit, enfant par enfant — le sans solde, lui, ne rend rien,
             parce que ce n'est pas un compteur mais une retenue qui disparaît
             avec la déclaration. */
          horaires.forEach(function (h) {
            var demi = demiJournee();
            var titre = (demi.minutes > 0 && h.minutes === demi.minutes)
              ? '½ journée' : Kit.heures(h.minutes);
            Kit.choix(corps, 'c1', '−',
              (titre + ' ' + libellePlage(h.jour, h.jour)).replace(/^./, function (c) {
                return c.toUpperCase();
              }),
              h.parts.map(function (x) {
                return x.prenom + ' : ' + (LIBELLE_ISSUE[x.issue] || x.issue);
              }).join(' · '),
              function () { confirmerRetraitHoraire(h); });
          });
        }).catch(function (e) {
          if (attente.parentNode) corps.removeChild(attente);
          corps.appendChild(Kit.warnbox('Périodes indisponibles',
            ' ' + Kit.messageErreur(e) + ' Rien n’a été retiré.'));
        });
      });
  }

  function fenetreDesPeriodes() {
    var debut = vue.annee + '-' + String(vue.mois).padStart(2, '0') + '-01';
    vue.fiches.forEach(function (f) {
      if (f.contrat.date_debut && f.contrat.date_debut < debut) debut = f.contrat.date_debut;
    });
    return { debut: debut, fin: (vue.annee + 1) + '-12-31' };
  }

  /* Une même période posée sur quatre contrats fait QUATRE imputations. Maria
     n'en a posé qu'une : on les regroupe pour qu'elle en retire une. */
  function regrouperParPeriode(parContrat) {
    var index = {};
    parContrat.forEach(function (x) {
      x.imputations.forEach(function (i) {
        var cle = i.date_debut + '|' + i.date_fin;
        if (!index[cle]) {
          index[cle] = { debut: i.date_debut, fin: i.date_fin, jours: i.jours_ouvrables, entrees: [] };
        }
        index[cle].entrees.push({ fiche: x.fiche, imputation: i });
      });
    });
    return Object.keys(index).map(function (k) { return index[k]; })
      .sort(function (a, b) { return a.debut < b.debut ? 1 : -1; });
  }

  function confirmerRetraitHoraire(h) {
    Kit.ouvrirFeuille('Retirer ce congé ?', libellePlage(h.jour, h.jour),
      function (corps) {
        corps.appendChild(Kit.note('Ce que ce retrait rend',
          'Les ' + Kit.heures(h.minutes) + ' posées reviennent au compteur qui les ' +
          'avait fournies, enfant par enfant. Une retenue de sans solde disparaît ' +
          'avec la déclaration : ce n’est pas un compteur, il n’y a rien à rendre. ' +
          'La journée, elle, n’a jamais cessé d’être travaillée.'));
        corps.appendChild(Kit.ce('div', 'sb q', h.parts.map(function (x) {
          return x.prenom + ' : ' + (LIBELLE_ISSUE[x.issue] || x.issue);
        }).join(' · ')));

        var msg = Kit.ce('div', 'msg');
        corps.appendChild(msg);
        var b = Kit.bouton('btn dg', function () { retirerHoraire(h, b, msg); });
        b.textContent = 'Retirer ce congé';
        corps.appendChild(b);
      });
  }

  function retirerHoraire(h, bouton, msg) {
    bouton.disabled = true;
    msg.className = 'msg';
    msg.textContent = 'Retrait…';

    var m = Chaine.moisDeDate(h.jour);
    /* Les contrats de CETTE pose, et d'elle seule : même jour ET même durée.
       Une autre pose du même jour ne doit pas partir avec. */
    var concernes = (vue.fiches || []).filter(function (f) {
      var l = !f.erreur && (f.journees || {})[h.jour];
      return !!(l && l.ecart_evenement === 'conge_horaire' &&
                -(l.ecart_minutes || 0) === h.minutes);
    });

    /* MÊME GARDE QU'À LA POSE, et pour la même raison : retirer un congé d'un
       mois clôturé le ferait diverger d'un document déjà remis. Échoue fermé. */
    global.App.recapsDuMois(m.annee, m.mois).then(function (parId) {
      var clos = concernes.filter(function (f) {
        return global.App.estClos(parId, f.contrat.id);
      });
      if (clos.length) {
        bouton.disabled = false;
        msg.className = 'msg ko';
        msg.textContent = Kit.moisCapitale(m.annee, m.mois) + ' est déjà clôturé pour ' +
          liste(clos.map(function (f) { return f.contrat.prenom_enfant; })) +
          '. Rien n’a été retiré.';
        return;
      }
      return Promise.all(concernes.map(function (f) {
        var l = f.journees[h.jour];
        /* Les quatre colonnes de la déclaration repartent à `null` ENSEMBLE :
           une ligne à demi effacée serait refusée par la contrainte
           `journee_ecart_coherent`, et surtout elle se relirait de travers. */
        return global.DB.enregistrerJournee({
          contrat_id: f.contrat.id,
          jour: h.jour,
          type: l.type || 'presence',
          minutes_reelles: l.minutes_reelles == null ? null : l.minutes_reelles,
          entretien_centimes: l.entretien_centimes == null ? null : l.entretien_centimes,
          commentaire: l.commentaire == null ? null : l.commentaire,
          ecart_minutes: null,
          ecart_evenement: null,
          ecart_heure_reelle: null,
          ecart_impute_sur: null
        });
      })).then(function () {
        global.App.invalider();
        Kit.fermerFeuille();
        Kit.toast('Congé retiré — les minutes sont rendues à vos compteurs');
        global.App.remplacer('conges', { annee: vue.annee, mois: vue.mois });
      });
    }).catch(function (e) {
      bouton.disabled = false;
      msg.className = 'msg ko';
      msg.textContent = 'Rien n’a été retiré — ' + Kit.messageErreur(e);
    });
  }

  function confirmerRetrait(p) {
    var prenoms = p.entrees.map(function (e) { return e.fiche.contrat.prenom_enfant; });
    Kit.ouvrirFeuille('Retirer les congés ' + libellePlage(p.debut, p.fin) + ' ?',
      null, function (corps) {
        corps.appendChild(Kit.note('Ce qui sera rendu',
          Kit.jours(p.jours) + ' décomptés seront rendus à vos compteurs, sur ' +
          (prenoms.length > 1 ? 'les ' + prenoms.length + ' contrats' : 'le contrat') +
          ' de ' + liste(prenoms) + '. Les journées redeviendront normales.'));

        var b = Kit.bouton('btn dg', function () { retirer(p, b); });
        b.textContent = 'Retirer ces congés';
        corps.appendChild(b);

        var bNon = Kit.bouton('btn nt', function () { Kit.fermerFeuille(); });
        bNon.textContent = 'Annuler';
        corps.appendChild(bNon);
      });
  }

  function retirer(p, bouton) {
    bouton.disabled = true;
    var plage = { debut: p.debut, fin: p.fin };
    var ids = p.entrees.map(function (e) { return e.fiche.contrat.id; });
    var jours = [];
    p.entrees.forEach(function (e) {
      joursDuContrat(e.fiche, plage).forEach(function (d) {
        if (jours.indexOf(d) === -1) jours.push(d);
      });
    });

    /* Les deux gestes vont ensemble : l'imputation ET les journées. L'un sans
       l'autre laisse l'application incohérente — compteurs rendus mais
       calendrier faux, ou l'inverse. */
    Promise.all(p.entrees.map(function (e) {
      return global.DB.supprimerImputation(e.imputation.id);
    })).then(function () {
      return global.DB.retirerAbsenceMaria(ids, jours, TYPES_ABSENCE_MARIA);
    }).then(function () {
      global.App.invalider();
      Kit.fermerFeuille();
      Kit.toast('Congés retirés ' + libellePlage(p.debut, p.fin) + '.');
      return global.App.rafraichir();
    }).catch(function (e) {
      bouton.disabled = false;
      Kit.toast('Le retrait n’a pas abouti : ' + Kit.messageErreur(e) +
        ' Vérifiez vos congés.', true);
      global.App.invalider();
    });
  }

  global.UiConges = { afficher: afficher, TYPES_ABSENCE_MARIA: TYPES_ABSENCE_MARIA };
})(window);
