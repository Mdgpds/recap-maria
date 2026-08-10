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
          global.App.journees(c.id, m.annee, m.mois)
        ]).then(function (r) {
          return {
            contrat: c,
            entree: global.App.moisDe(r[0], m.annee, m.mois),
            journees: r[1],
            erreur: null
          };
        }).catch(function (e) {
          return { contrat: c, entree: null, journees: {}, erreur: e };
        });
      })),
      global.App.recapsDuMois(m.annee, m.mois).catch(function () { return null; })
    ]).then(function (r) {
      vue = { annee: m.annee, mois: m.mois, fiches: r[0], recaps: r[1] };
      Kit.vider(ctx.corps);
      rendre(ctx.corps);
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

  function panneauPoses() {
    var p = Kit.pane('Posés en ' + Kit.libelleMois(vue.mois));
    var set = {};
    vue.fiches.forEach(function (f) {
      Object.keys(f.journees).forEach(function (d) {
        if (f.journees[d].type === 'conge_maria') set[d] = true;
      });
    });
    var jours = Object.keys(set).sort();
    if (!jours.length) {
      p.appendChild(Kit.ce('div', 'sb q', 'Aucun congé posé ce mois-ci.'));
      return p;
    }
    var l = Kit.lines(p);
    jours.forEach(function (d) { Kit.ligne(l, Kit.jourLong(d), '1 jour'); });

    /* Le décompte officiel (RG-06) n'est pas le nombre de cases cochées : une
       semaine posée du lundi au vendredi compte 6 jours. On affiche le chiffre
       du moteur, celui qui figure sur les documents. */
    var decompte = vue.fiches.reduce(function (max, f) {
      return f.entree ? Math.max(max, f.entree.resultat.joursCongesDecomptes || 0) : max;
    }, 0);
    if (decompte) {
      Kit.ligne(l, 'Décompte en jours ouvrables', Kit.jours(decompte), { discret: true });
    }
    return p;
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

  function cpDe(fiche) {
    return Kit.cpDisponible(fiche.entree && fiche.entree.resultat && fiche.entree.resultat.compteurSortie);
  }
  function supDe(fiche) {
    return Kit.supDisponible(fiche.entree && fiche.entree.resultat && fiche.entree.resultat.compteurSortie);
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
             Le planning passé est celui de la RÈGLE (lundi-samedi), pas celui
             d'un contrat : une semaine complète compte 6 jours même si Maria
             ne travaille pas le samedi. */
          var n = Engine.decompterJoursOuvrables(parcours.debut, parcours.fin);
          parcours.jours = n;
          var b = Kit.ce('div', 'decompte');
          b.appendChild(Kit.ce('div', 'gros', Kit.jours(n) + ' ouvrables décomptés'));
          b.appendChild(Kit.ce('div', 'q', 'samedi inclus · ' +
            libellePlage(parcours.debut, parcours.fin).replace(/^./, function (c) {
              return c.toUpperCase();
            }) + '.'));
          zone.appendChild(b);
          bSuite.disabled = n === 0;
          if (n === 0) {
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

  function feuilleMoisClos(clos) {
    var premier = clos[0];
    var prenoms = premier.fiches.map(function (f) { return f.contrat.prenom_enfant; });
    Kit.ouvrirFeuille(Kit.moisCapitale(premier.annee, premier.mois) + ' est clôturé',
      liste(prenoms), function (corps) {
        corps.appendChild(Kit.warnbox(
          Kit.moisCapitale(premier.annee, premier.mois) + ' est clôturé pour ' +
            liste(prenoms) + '.',
          ' Pour poser ces congés, il faut rouvrir ce mois. Il sera à clôturer à nouveau ' +
          'ensuite, et vous devrez renvoyer les récapitulatifs déjà transmis.'));

        var bRouvrir = Kit.bouton('btn', function () { rouvrirPuisVentiler(clos, bRouvrir); });
        bRouvrir.textContent = 'Rouvrir ' + Kit.libelleMois(premier.mois) + ' et continuer';
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
  function preparerVentilations() {
    var plage = { debut: parcours.debut, fin: parcours.fin };

    parcours.plans = vue.fiches.filter(function (f) { return !f.erreur; }).map(function (f) {
      var c = f.contrat;
      var joursPoses = joursDuContrat(c, plage);
      var cp = cpDe(f);
      var sup = supDe(f);

      /* Le décompte en jours ouvrables est celui de la RÈGLE, identique pour
         tous les contrats. Ce qui diffère d'un contrat à l'autre, ce sont les
         RÉSERVES — et donc la façon de le payer. */
      var n = joursPoses.length ? Engine.decompterJoursOuvrables(plage.debut, plage.fin) : 0;

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

        corps.appendChild(compteur('Congés payés', p.choix, 'joursSurCp', p.maxCp, majAffichage));
        corps.appendChild(compteur('Récupération', p.choix, 'joursSurSup', p.maxSup, majAffichage));
        /* A3 — le sans-solde n'a pas de borne haute : c'est le seul moyen de
           poser un congé quand les réserves sont épuisées. Il est borné par le
           nombre de jours de la période, pas par une réserve. */
        corps.appendChild(compteur('Sans solde', p.choix, 'joursSansSolde', p.jours, majAffichage));

        corps.appendChild(reste);
        corps.appendChild(effet);

        if (p.maxCp + p.maxSup < p.jours) {
          corps.appendChild(Kit.note('Les réserves de ' + c.prenom_enfant + ' ne suffisent pas',
            c.prenom_enfant + ' a ' + Kit.joursCp(p.cp) + ' de congés payés et ' +
            joursDeRecup(c, p.sup) + ' de récupération, pour ' + Kit.jours(p.jours) +
            ' à couvrir. Le reste passera en sans solde.'));
        }

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
  function compteur(libelle, cible, champ, maximum, apres) {
    var f = Kit.ce('div', 'compteur-jours');
    f.appendChild(Kit.ce('span', 'lb', libelle));

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
  function poser(bouton) {
    bouton.disabled = true;
    var plans = parcours.plans;
    var affectations = plans.map(function (p) {
      return { contratId: p.contrat.id, jours: p.joursPoses };
    });

    global.DB.poserAbsenceMaria(affectations, 'conge_maria', null)
      .then(function () {
        return Promise.all(plans.map(function (p) {
          return global.DB.enregistrerImputation({
            contrat_id: p.contrat.id,
            date_debut: parcours.debut,
            date_fin: parcours.fin,
            jours_ouvrables: p.jours,
            jours_sur_cp: p.choix.joursSurCp,
            jours_sur_sup: p.choix.joursSurSup,
            jours_sans_solde: p.choix.joursSansSolde
          });
        }));
      })
      .then(function (imputations) {
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
        Kit.toast('Enregistrement impossible : ' + Kit.messageErreur(e) +
          ' Vérifiez vos congés avant de recommencer.', true);
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
