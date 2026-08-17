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
            .catch(function () { return null; })
        ]).then(function (r) {
          return {
            contrat: c,
            entree: global.App.moisDe(r[0], m.annee, m.mois),
            journees: r[1],
            /* `null` — et non `[]` — quand la lecture échoue : l'écran doit
               pouvoir dire « je n'ai pas pu lire vos périodes » au lieu de
               laisser croire qu'il n'y en a aucune. */
            imputations: r[2],
            erreur: null
          };
        }).catch(function (e) {
          return { contrat: c, entree: null, journees: {}, imputations: null, erreur: e };
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
    feuilleCorrection(trouve.fiche, trouve.imputation);
  }

  function feuilleCorrection(fiche, imputation) {
    var c = fiche.contrat;
    var jours = imputation.jours_ouvrables;
    var cp = cpDe(fiche);
    var sup = supDe(fiche);
    var maxCp = Math.floor(cp / 10);
    var maxSup = c.minutes_par_jour_conge ? Math.floor(sup / c.minutes_par_jour_conge) : 0;

    /* La proposition de départ est celle du MOTEUR, dans l'ordre du contrat —
       exactement celle sur laquelle le mois est actuellement calculé depuis
       que la ventilation enregistrée a été écartée. Maria voit donc d'abord
       les chiffres qu'elle a sous les yeux, et corrige à partir de là. */
    var choix = { joursSurCp: 0, joursSurSup: 0, joursSansSolde: 0 };
    if (jours > 0) {
      var r = Engine.imputerConges(jours, { dixiemesCp: cp, minutesSup: sup }, c);
      choix = { joursSurCp: r.joursSurCp, joursSurSup: r.joursSurSup, joursSansSolde: r.joursSansSolde };
    }

    var p = {
      fiche: fiche, contrat: c, jours: jours, cp: cp, sup: sup,
      maxCp: maxCp, maxSup: maxSup, choix: choix
    };

    Kit.ouvrirFeuille(c.prenom_enfant + ' — ' + Kit.jours(jours) + ' à répartir',
      libellePlage(imputation.date_debut, imputation.date_fin),
      function (corps) {
        var res = Kit.pane('Vos réserves pour ce contrat');
        var lr = Kit.lines(res);
        Kit.ligne(lr, 'Congés payés', Kit.joursCp(cp));
        Kit.ligne(lr, 'Récupération', joursDeRecup(c, sup));
        corps.appendChild(res);

        corps.appendChild(Kit.section('Comment les prendre ?'));

        var reste = Kit.ce('div', 'reste');
        var effet = Kit.ce('div', 'effet-sans-solde');
        var bValider = Kit.bouton('btn', function () { validerCorrection(bValider, imputation, p); });
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
            var minutes = p.choix.joursSansSolde * (c.minutes_par_jour_conge || 0);
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
          'reste ' + Kit.joursCp(cp) + ' au compteur'));
        corps.appendChild(compteur('Récupération', p.choix, 'joursSurSup', maxSup, majAffichage,
          'reste ' + joursDeRecup(c, sup) + ' convertibles'));
        corps.appendChild(compteur('Sans solde', p.choix, 'joursSansSolde', jours, majAffichage));

        corps.appendChild(reste);
        corps.appendChild(bascule(p, c));
        corps.appendChild(effet);
        corps.appendChild(bValider);

        majAffichage();
      });
  }

  function validerCorrection(bouton, imputation, p) {
    bouton.disabled = true;
    global.DB.majVentilationImputation(imputation.id, {
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
    var bPoser = Kit.bouton('btn', function () { ouvrirParcours(); });
    bPoser.textContent = 'Poser des congés';
    bPoser.disabled = enErreur.length > 0;
    corps.appendChild(bPoser);

    var bRetrait = Kit.bouton('btn nt', function () { feuilleRetrait(); });
    bRetrait.textContent = 'Retirer des congés';
    corps.appendChild(bRetrait);

    corps.appendChild(Kit.note('Un congé vaut pour ' + libelleContrats(fiches.length),
      'Vous le posez une fois, il s’applique partout — mais vous choisissez, pour chaque ' +
      'enfant, comment il est décompté. Une semaine complète compte 6 jours, samedi inclus.'));
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
    if (!groupes.length) {
      p.appendChild(Kit.ce('div', 'sb q', 'Aucun congé posé ce mois-ci.'));
      return p;
    }

    var l = Kit.lines(p);
    groupes.forEach(function (g) { ligneperiode(l, g); });
    p.appendChild(phraseDecompte(groupes));
    return p;
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
        var planning = f.contrat.jours_planning || [1, 2, 3, 4, 5];
        groupe(a.date_debut, a.date_fin).lignes.push({
          contrat: f.contrat,
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
    var planning = groupe.lignes[0].contrat.jours_planning || [1, 2, 3, 4, 5];
    var part = Chaine.partDuMois(Engine, ref, planning, vue.annee, vue.mois);

    var textes = [];
    if (part !== ref.jours_ouvrables) {
      textes.push('dont ' + Kit.jours(part) + ' en ' + Kit.libelleMois(vue.mois));
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
    var texte = 'Le décompte se fait en jours ouvrables, samedis inclus. ' +
      'Une semaine complète compte 6 jours.';
    var feries = feriesDesPeriodes(groupes);
    if (feries.length) {
      texte += ' Les jours fériés ne sont pas décomptés : ' +
        feries.map(function (d) { return 'le ' + Kit.jourLong(d); }).join(', ') +
        (feries.length > 1 ? ' ne comptent pas.' : ' ne compte pas.');
    }
    return Kit.ce('div', 'sb q', texte);
  }

  function feriesDesPeriodes(groupes) {
    var vus = {};
    groupes.forEach(function (g) {
      for (var d = g.debut; d <= g.fin; d = Feries.ajouterJours(d, 1)) {
        if (Engine.estJourFerie(d)) vus[d] = true;
      }
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
      Kit.ligne(l, f.contrat.prenom_enfant,
        Kit.joursCp(cp) + ' de congés payés · ' + joursDeRecup(f.contrat, sup) + ' de récupération',
        { alerte: cp < Kit.SEUIL_CP_BAS_DIXIEMES });
    });
    p.appendChild(Kit.ce('div', 'sb q',
      'Les compteurs diffèrent car les contrats n’ont pas commencé en même temps.'));
    return p;
  }

  /* La récupération se lit en MINUTES en base, et se dépense en JOURNÉES de
     congé. « 36 h » ne dit pas à Maria combien de jours elle peut prendre ;
     « 4 jours (36 h) » le dit. La conversion utilise les minutes d'une journée
     de congé DU CONTRAT — jamais 7 h, jamais 8 h en dur. */
  function joursDeRecup(contrat, minutes) {
    var parJour = contrat.minutes_par_jour_conge || 0;
    if (!parJour) return Kit.heures(minutes);
    var n = Math.floor(minutes / parJour);
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
  function cpDe(fiche) {
    return Kit.cpDisponible(fiche.entree && fiche.entree.compteurEntree);
  }
  function supDe(fiche) {
    return Kit.supDisponible(fiche.entree && fiche.entree.compteurEntree);
  }

  /* ------------------------------------------------------------------ */
  /* Outils de période                                                   */
  /* ------------------------------------------------------------------ */

  /* Les jours du planning d'un contrat dans une période, fériés et bornes du
     contrat exclus. Ce sont les journées qui seront réellement ÉCRITES ;
     le DÉCOMPTE en jours ouvrables, lui, est tout autre chose (RG-06 compte le
     samedi, que Maria travaille ou non) et vient du moteur. */
  function joursDuContrat(contrat, plage) {
    var planning = contrat.jours_planning || [1, 2, 3, 4, 5];
    var out = [];
    for (var d = plage.debut; d <= plage.fin; d = Feries.ajouterJours(d, 1)) {
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

  function ouvrirParcours() {
    var auj = global.App.aujourdhui();
    parcours = { debut: auj, fin: auj, etape: 1, index: 0, plans: [] };
    etapeDates();
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
            return !f.erreur && joursDuContrat(f.contrat, parcours).length > 0;
          });
          var decomptes = servis.map(function (f) {
            return Engine.decompterJoursOuvrables(parcours.debut, parcours.fin,
              f.contrat.jours_planning || [1, 2, 3, 4, 5]);
          });
          var mini = decomptes.length ? Math.min.apply(null, decomptes) : 0;
          var maxi = decomptes.length ? Math.max.apply(null, decomptes) : 0;
          parcours.jours = maxi;

          var b = Kit.ce('div', 'decompte');
          b.appendChild(Kit.ce('div', 'gros', mini === maxi
            ? Kit.jours(maxi) + ' ouvrables décomptés'
            : 'de ' + mini + ' à ' + Kit.jours(maxi) + ' ouvrables décomptés'));
          b.appendChild(Kit.ce('div', 'q', 'samedi inclus · ' +
            libellePlage(parcours.debut, parcours.fin).replace(/^./, function (c) {
              return c.toUpperCase();
            }) + '.'));
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
          return joursDuContrat(f.contrat, plage).some(function (d) {
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

    return prepare.then(function (fiches) {
      return preparerVentilationsAvec(fiches, plage);
    }).catch(function (e) {
      Kit.fermerFeuille();
      Kit.toast('Impossible de lire vos compteurs pour cette période : ' +
        Kit.messageErreur(e) + ' Rien n’a été posé.', true);
    });
  }

  function preparerVentilationsAvec(fiches, plage) {
    parcours.plans = fiches.filter(function (f) { return !f.erreur; }).map(function (f) {
      var c = f.contrat;
      var joursPoses = joursDuContrat(c, plage);
      var cp = cpDe(f);
      var sup = supDe(f);

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
      var planning = c.jours_planning || [1, 2, 3, 4, 5];
      var n = bornes ? Engine.decompterJoursOuvrables(bornes.debut, bornes.fin, planning) : 0;

      var propose = { joursSurCp: 0, joursSurSup: 0, joursSansSolde: 0 };
      if (n > 0) {
        /* Répartition par défaut : celle du moteur, dans l'ordre du contrat.
           Aucune règle d'imputation n'est réécrite ici. */
        var r = Engine.imputerConges(n, { dixiemesCp: cp, minutesSup: sup }, c);
        propose = {
          joursSurCp: r.joursSurCp,
          joursSurSup: r.joursSurSup,
          joursSansSolde: r.joursSansSolde
        };
      }

      return {
        fiche: f, contrat: c, joursPoses: joursPoses, jours: n,
        /* Les bornes de CE contrat, portées jusqu'à l'écriture : c'est ce
           couple qui part dans `imputation_conge`, pas la plage saisie. */
        bornes: bornes,
        cp: cp, sup: sup,
        maxCp: Math.floor(cp / 10),
        maxSup: c.minutes_par_jour_conge ? Math.floor(sup / c.minutes_par_jour_conge) : 0,
        choix: propose
      };
    }).filter(function (p) { return p.jours > 0 && p.joursPoses.length > 0; });

    if (!parcours.plans.length) {
      Kit.fermerFeuille();
      Kit.toast('Aucun de vos contrats n’est concerné par ces dates.', true);
      return;
    }
    parcours.index = 0;
    etapeVentilation();
  }

  function etapeVentilation() {
    var p = parcours.plans[parcours.index];
    var c = p.contrat;

    Kit.ouvrirFeuille(c.prenom_enfant + ' — ' + Kit.jours(p.jours) + ' à répartir',
      etiquetteEtapes(), function (corps) {
        corps.appendChild(barreEtapes());

        var res = Kit.pane('Vos réserves pour ce contrat');
        var lr = Kit.lines(res);
        Kit.ligne(lr, 'Congés payés', Kit.joursCp(p.cp));
        Kit.ligne(lr, 'Récupération', joursDeRecup(c, p.sup));
        corps.appendChild(res);

        corps.appendChild(Kit.section('Comment les prendre ?'));

        var reste = Kit.ce('div', 'reste');
        var effet = Kit.ce('div', 'effet-sans-solde');
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
            var minutes = p.choix.joursSansSolde * (c.minutes_par_jour_conge || 0);
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
          'reste ' + Kit.joursCp(p.cp) + ' au compteur'));
        corps.appendChild(compteur('Récupération', p.choix, 'joursSurSup', p.maxSup, majAffichage,
          'reste ' + joursDeRecup(c, p.sup) + ' convertibles'));
        /* A3 — le sans-solde n'a pas de borne haute : c'est le seul moyen de
           poser un congé quand les réserves sont épuisées. Il est borné par le
           nombre de jours de la période, pas par une réserve. */
        corps.appendChild(compteur('Sans solde', p.choix, 'joursSansSolde', p.jours, majAffichage));

        corps.appendChild(reste);

        /* LOT 16 §16.1 d) — LE BASCULEMENT EN SANS SOLDE EST ANNONCÉ AVANT
           VALIDATION, avec son coût. La répartition proposée vient déjà du
           moteur, qui fait déborder le solde en sans solde ; ce qui manquait,
           c'est la phrase qui le dit. Maria peut modifier ensuite : rien n'est
           imposé, tout est annoncé. */
        corps.appendChild(bascule(p, c));
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

  function brutDe(fiche) {
    var r = fiche.entree && fiche.entree.resultat;
    return (r && r.salaireBrutCentimes) || 0;
  }

  /* LOT 16 §16.1 d) — « Vos réserves ne couvrent pas toute la période ».

     Le basculement lui-même n'est pas nouveau : la répartition proposée vient
     d'`Engine.imputerConges`, qui fait déjà déborder le reliquat en sans
     solde. Ce qui manquait, c'est de le DIRE, et de le chiffrer, avant que
     Maria n'appuie. Le montant vient de `Engine.montantCentimes` (A4) : aucun
     taux horaire n'est écrit ici.

     Rend un nœud vide quand les réserves couvrent la période : le cas normal
     ne doit rien afficher du tout. */
  function bascule(p, c) {
    var manquant = p.jours - p.maxCp - p.maxSup;
    if (manquant <= 0) return Kit.ce('div');

    var brut = brutDe(p.fiche);
    var minutes = manquant * (c.minutes_par_jour_conge || 0);
    var retenue = brut ? Engine.montantCentimes(brut, minutes) : null;

    return Kit.note('Vos réserves ne couvrent pas toute la période',
      c.prenom_enfant + ' a ' + Kit.joursCp(p.cp) + ' de congés payés et ' +
      joursDeRecup(c, p.sup) + ' de récupération, pour ' + Kit.jours(p.jours) +
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
                p.choix.joursSansSolde * (c.minutes_par_jour_conge || 0));
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
        }).then(function (i) { posees.push(i); });
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

          if (!periodes.length) {
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
      joursDuContrat(e.fiche.contrat, plage).forEach(function (d) {
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
