/* ============================================================================
   ui-periode.js — Récapitulatif sur une période (§2.8 des specs).

   Écran validé au lot 5, repris ici dans l'habillage de la maquette. Le fond
   ne bouge pas ; c'est la présentation qui change, en deux blocs.

   INTERDIT ABSOLU, ET C'EST LE CŒUR DE CE FICHIER : aucun second moteur de
   calcul. Une période n'est rien d'autre qu'une AGRÉGATION de résultats
   mensuels produits par Engine.calculerMois() et enchaînés par chaine-mois.js.
   Toute formule qui calculerait directement sur la période créerait une
   seconde source de vérité, qui divergerait des récapitulatifs mensuels déjà
   remis aux parents.

   Les deux blocs, et pourquoi ils sont séparés :

   - COMPTÉ AU JOUR PRÈS — présence, entretien, heures supplémentaires, congés.
     Ces grandeurs se comptent jour par jour, donc une période qui commence le
     12 mars les compte à partir du 12 mars. Pour obtenir ce décompte sans
     toucher au moteur, on lui donne une COPIE du contrat bornée à la période :
     calculerMois ignore déjà tout jour hors [date_debut, date_fin]. Aucune
     règle nouvelle, aucun prorata inventé.

   - SUR LES MOIS ENTIERS — salaire et congés payés acquis. Ces grandeurs
     s'acquièrent au MOIS : sur un mois entamé, aucun prorata officiel
     n'existe. On ne compte donc que les mois entièrement contenus dans la
     période, et on dit lesquels sont laissés de côté.

   Les COMPTEURS (soldes) ne s'additionnent jamais : ils ne sont affichés que
   pour une période faite de mois entiers, où ils ont un sens. Sur une période
   à dates libres, le solde d'un mois entamé n'existe pas — on le dit plutôt
   que d'afficher un chiffre crédible et faux.

   Ce récapitulatif est une CONSULTATION PERSONNELLE : il ne se fige pas, il ne
   se copie pas, il ne se transmet pas. Seuls les documents mensuels font foi.
   ========================================================================= */
(function (global) {
  'use strict';

  var Kit = global.Kit;
  var Chaine = global.ChaineMois;

  /* Borne explicite (jamais de troncature silencieuse) : au-delà, le nombre de
     mois rejoués devient déraisonnable sur un téléphone. */
  var MAX_MOIS_PERIODE = 60;

  var etat = { contrats: [], corps: null };

  function afficher(ctx) {
    global.App.barreRetour(ctx.barre, 'Sur une période');
    etat.corps = ctx.corps;
    ctx.corps.appendChild(Kit.ce('div', 'attente', 'Chargement…'));

    return global.App.tousLesContrats().then(function (liste) {
      etat.contrats = liste || [];
      Kit.vider(ctx.corps);
      rendreFormulaire(ctx.corps);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Formulaire                                                          */
  /* ------------------------------------------------------------------ */

  function rendreFormulaire(corps) {
    var m = global.App.moisCourant();

    corps.appendChild(Kit.section('Sur quel contrat'));
    var options = [['', 'Tous les contrats']].concat(etat.contrats.map(function (c) {
      return [c.id, c.prenom_enfant + (c.archive ? ' (ancien)' : '')];
    }));
    var selContrat = Kit.champSelect('Contrat', options, '');
    corps.appendChild(selContrat.bloc);

    corps.appendChild(Kit.section('Raccourcis'));
    raccourci(corps, 'Ce mois-ci', function () {
      lancer(selContrat, {
        debut: Chaine.premierJour(m.annee, m.mois),
        fin: Chaine.dernierJour(m.annee, m.mois),
        titre: Kit.moisCapitale(m.annee, m.mois),
        entier: true
      });
    });
    var anneeBilan = m.mois >= 9 ? m.annee : m.annee - 1;
    raccourci(corps, 'Cette année de bilan', function () {
      var fin = { annee: anneeBilan + 1, mois: 8 };
      if (Chaine.cmpMois(fin.annee, fin.mois, m.annee, m.mois) > 0) fin = m;
      lancer(selContrat, {
        debut: Chaine.premierJour(anneeBilan, 9),
        fin: Chaine.dernierJour(fin.annee, fin.mois),
        titre: 'Année ' + anneeBilan + '-' + (anneeBilan + 1),
        entier: true
      });
    });
    raccourci(corps, 'Toute la durée d’un contrat', function () {
      var c = contratChoisi(selContrat);
      if (!c) { Kit.toast('Choisissez d’abord un contrat précis ci-dessus.', true); return; }
      var f = c.date_fin ? Chaine.moisDeDate(c.date_fin) : m;
      if (Chaine.cmpMois(f.annee, f.mois, m.annee, m.mois) > 0) f = m;
      lancer(selContrat, {
        debut: c.date_debut,
        fin: Chaine.dernierJour(f.annee, f.mois),
        titre: 'Contrat de ' + c.prenom_enfant,
        entier: true
      });
    });

    corps.appendChild(Kit.section('Ou choisir deux dates'));
    var du = Kit.champDate('Du', Chaine.premierJour(m.annee, m.mois),
      { anneeMin: m.annee - 5, anneeMax: m.annee + 1 });
    var au = Kit.champDate('Au', Chaine.dernierJour(m.annee, m.mois),
      { anneeMin: m.annee - 5, anneeMax: m.annee + 1 });
    corps.appendChild(du.bloc);
    corps.appendChild(au.bloc);

    var bVoir = Kit.bouton('btn', function () {
      var d = du.valeur(), f = au.valeur();
      if (f < d) { Kit.toast('La fin de la période précède son début.', true); return; }
      lancer(selContrat, {
        debut: d, fin: f,
        titre: Kit.dateLongue(d) + ' → ' + Kit.dateLongue(f),
        entier: false
      });
    });
    bVoir.textContent = 'Voir le récapitulatif';
    corps.appendChild(bVoir);

    var resultats = Kit.ce('div');
    resultats.id = 'resultats-periode';
    corps.appendChild(resultats);
  }

  function raccourci(corps, texte, onclick) {
    var b = Kit.bouton('btn nt', onclick);
    b.textContent = texte;
    corps.appendChild(b);
    return b;
  }

  function contratChoisi(sel) {
    var id = sel.select.value;
    if (!id) return null;
    return etat.contrats.filter(function (c) { return c.id === id; })[0] || null;
  }

  /* ------------------------------------------------------------------ */
  /* Calcul                                                              */
  /* ------------------------------------------------------------------ */

  function lancer(selContrat, p) {
    var cible = document.getElementById('resultats-periode');
    Kit.vider(cible);

    /* Un mois à venir n'a pas de récapitulatif : il n'a pas encore été
       travaillé. Compter son salaire gonflerait le total d'un montant
       parfaitement crédible. On ramène la fin au mois courant, et on le dit. */
    var maintenant = global.App.moisCourant();
    var finMaxi = Chaine.dernierJour(maintenant.annee, maintenant.mois);
    var ramenee = false;
    if (p.fin > finMaxi) { p = { debut: p.debut, fin: finMaxi, titre: p.titre, entier: p.entier }; ramenee = true; }
    if (p.fin < p.debut) {
      cible.appendChild(Kit.ce('p', 'vide',
        'Cette période est entièrement à venir : aucun mois n’a encore été travaillé.'));
      return;
    }

    var mDebut = Chaine.moisDeDate(p.debut);
    var mFin = Chaine.moisDeDate(p.fin);
    var nbMois = Chaine.nbMoisEntre(mDebut.annee, mDebut.mois, mFin.annee, mFin.mois);
    if (nbMois > MAX_MOIS_PERIODE) {
      cible.appendChild(Kit.warnbox('Période trop longue',
        'Limitée à ' + MAX_MOIS_PERIODE + ' mois (' + nbMois + ' demandés). ' +
        'Choisissez une période plus courte — rien n’est tronqué en silence.'));
      return;
    }

    cible.appendChild(Kit.ce('div', 'attente', 'Calcul en cours…'));

    var un = contratChoisi(selContrat);
    var pContrats = un ? Promise.resolve([un]) : global.DB.listContratsPourPeriode(p.debut, p.fin);

    pContrats.then(function (contrats) {
      contrats = contrats || [];
      if (!contrats.length) {
        Kit.vider(cible);
        cible.appendChild(Kit.ce('p', 'vide', 'Aucun contrat actif sur cette période.'));
        return null;
      }
      return Promise.all(contrats.map(function (c) { return calculerContrat(c, p); }));
    }).then(function (resultats) {
      if (!resultats) return;
      Kit.vider(cible);
      rendreResultats(cible, p, resultats.filter(Boolean), ramenee);
    }).catch(function (e) {
      Kit.vider(cible);
      cible.appendChild(Kit.warnbox('Calcul impossible', Kit.messageErreur(e)));
    });
  }

  function nbMoisEntre(p) {
    var d = Chaine.moisDeDate(p.debut), f = Chaine.moisDeDate(p.fin);
    return Chaine.nbMoisEntre(d.annee, d.mois, f.annee, f.mois);
  }

  /* Le calcul d'un contrat sur la période. Deux agrégats, une seule chaîne. */
  function calculerContrat(contrat, p) {
    var debut = contrat.date_debut > p.debut ? contrat.date_debut : p.debut;
    var fin = (contrat.date_fin && contrat.date_fin < p.fin) ? contrat.date_fin : p.fin;
    if (fin < debut) return Promise.resolve({ contrat: contrat, vide: true });

    /* Copie bornée à la période : c'est elle qui donne le décompte au jour
       près sur les mois entamés. Le moteur ignore déjà tout jour hors des
       bornes du contrat — on ne lui apprend rien de neuf. */
    var borne = {};
    Object.keys(contrat).forEach(function (k) { borne[k] = contrat[k]; });
    borne.date_debut = debut;
    borne.date_fin = fin;

    var mDebut = Chaine.moisDeDate(debut);
    var mFin = Chaine.moisDeDate(fin);

    /* Les compteurs n'ont de sens que sur une période de mois entiers : sinon
       la chaîne bornée ne « voit » pas l'historique et repartirait de zéro.
       On ne rejoue donc la chaîne NON bornée que dans ce cas. */
    var pSoldes = p.entier
      ? global.App.serie(contrat, mFin)
      : Promise.resolve(null);

    return Promise.all([
      Chaine.serie(borne, mFin, { depuis: mDebut }),
      pSoldes
    ]).then(function (r) {
      var fenetre = Chaine.fenetre(r[0], mDebut, mFin);
      var agr = Chaine.agregerPeriode(fenetre);

      /* CORRECTION RELECTURE LOT 16 (C1) — LE RÉCAPITULATIF DE PÉRIODE DOIT LE
         DIRE AUSSI. C'est l'écran qui agrège le plus, donc celui où un mois
         retombé sur l'ordre par défaut du contrat disparaît le mieux dans la
         masse — et le seul qui n'ouvre aucun document où la marque figurerait.
         Le §16.1 a) cite les cinq écrans ; la marque n'en couvrait que trois. */
      var moisEcartes = fenetre.filter(function (e) {
        return !e.horsContrat && (e.imputationsEcartees || []).length;
      });

      /* Mois ENTIÈREMENT contenus dans la période demandée. */
      var entiers = fenetre.filter(function (e) {
        return Chaine.premierJour(e.annee, e.mois) >= p.debut &&
               Chaine.dernierJour(e.annee, e.mois) <= p.fin &&
               !e.horsContrat;
      });
      var partiels = fenetre.filter(function (e) {
        return !e.horsContrat && entiers.indexOf(e) === -1;
      });
      var agrEntiers = Chaine.agregerPeriode(entiers);

      /* Correction A1 (relecture lot 6). La copie du contrat bornée à la
         période ne s'applique qu'aux mois REJOUÉS : un mois CLÔTURÉ reprend son
         instantané tel quel, mois entier compris, et le bloc « compté au jour
         près » comptait donc 22 jours de mars là où la période n'en demandait
         que 14. Proratiser un mois clôturé serait pire : ce serait recalculer
         un document immuable et faire diverger cet écran de la pièce remise
         aux parents. On compte donc le mois entier — c'est ce que dit le
         document — et on NOMME les mois concernés au lieu de laisser passer un
         chiffre faux sous une étiquette qui promet le jour près. */
      var partielsClos = partiels.filter(function (e) { return e.fige; });

      var soldes = null;
      if (r[1]) {
        var dernier = global.App.moisDe(r[1], mFin.annee, mFin.mois);
        var premier = global.App.moisDe(r[1], mDebut.annee, mDebut.mois);
        if (dernier) {
          soldes = {
            entree: premier ? premier.compteurEntree : null,
            sortie: dernier.compteurSortie
          };
        }
      }

      return {
        contrat: contrat, vide: false,
        debut: debut, fin: fin,
        agr: agr, agrEntiers: agrEntiers,
        partiels: partiels, partielsClos: partielsClos,
        moisDemandes: nbMoisEntre(p),
        tronquee: r[0].tronquee,
        soldes: soldes,
        /* C1 — les mois de la période dont une répartition a été écartée. */
        moisEcartes: moisEcartes
      };
    });
  }

  /* ------------------------------------------------------------------ */
  /* Rendu                                                               */
  /* ------------------------------------------------------------------ */

  function rendreResultats(cible, p, resultats, ramenee) {
    cible.appendChild(Kit.section(p.titre));
    if (ramenee) {
      cible.appendChild(Kit.ce('p', 'sb q',
        'Période ramenée au mois en cours : les mois à venir n’ont pas encore de récapitulatif.'));
    }

    var utiles = resultats.filter(function (r) { return !r.vide && r.agr.nbMois > 0; });
    resultats.filter(function (r) { return r.vide || r.agr.nbMois === 0; }).forEach(function (r) {
      cible.appendChild(Kit.warnbox(r.contrat.prenom_enfant + ' n’était pas sous contrat sur cette période',
        'Contrat du ' + Kit.dateLongue(r.contrat.date_debut) +
        (r.contrat.date_fin ? ' au ' + Kit.dateLongue(r.contrat.date_fin) : ', toujours en cours') + '.'));
    });

    /* C1 — UNE LIGNE, EN TÊTE DES RÉSULTATS. Elle ne propose pas de corriger :
       la correction se fait depuis l'espace enfant, où la période est connue.
       Elle dit seulement que certains chiffres de ce récapitulatif ne sont pas
       ceux que Maria avait choisis — sans quoi ils passeraient pour tels. */
    var ecartes = utiles.reduce(function (n, r) { return n + (r.moisEcartes || []).length; }, 0);
    if (ecartes) {
      cible.appendChild(Kit.warnbox(
        ecartes > 1
          ? 'Des répartitions de congé ont été écartées sur cette période'
          : 'Une répartition de congé a été écartée sur cette période',
        ' ' + (ecartes > 1 ? ecartes + ' mois sont calculés' : 'Un mois est calculé') +
        ' dans l’ordre habituel du contrat, et non selon la répartition ' +
        'enregistrée. Ouvrez l’espace de l’enfant concerné pour la corriger.'));
    }

    if (!utiles.length) {
      cible.appendChild(Kit.ce('p', 'vide', 'Aucun mois calculable sur cette période.'));
      return;
    }

    /* Restauration R7 : la vue d'ensemble tous contrats confondus. Sans elle,
       Maria devait additionner quatre blocs à la main pour connaître son année.
       Seuls les FLUX sont totalisés — jamais un compteur : un solde d'heures
       supplémentaires global n'a aucun sens. La règle vit dans
       ChaineMois.totaliserAgregats, testée sous Node, et n'est pas réécrite. */
    if (utiles.length > 1) cible.appendChild(vueEnsemble(utiles));

    utiles.forEach(function (r) { cible.appendChild(blocContrat(p, r)); });

    cible.appendChild(Kit.warnbox('Pourquoi cette séparation',
      'Les jours de présence se comptent au jour près. Le salaire et les congés payés ' +
      's’acquièrent au mois : sur un mois entamé, aucun prorata officiel n’existe.'));
    cible.appendChild(Kit.ce('p', 'sb q',
      'Consultation personnelle. Ce récapitulatif ne se clôture pas et ne se transmet pas : ' +
      'seuls les documents mensuels font foi.'));
  }

  function vueEnsemble(utiles) {
    var t = Chaine.totaliserAgregats(utiles.map(function (r) { return r.agr; }));
    var pane = Kit.pane('Vue d’ensemble — ' + t.nbContrats + ' contrats');
    var l = Kit.lines(pane);
    Kit.ligne(l, 'Jours de présence', Kit.jours(t.joursPresence));
    Kit.ligne(l, 'Indemnités d’entretien', Kit.eur(t.entretienCentimes));
    Kit.ligne(l, 'Heures sup acquises', Kit.heures(t.minutesSupAcquises));
    Kit.ligne(l, 'Congés décomptés', Kit.jours(t.joursCongesDecomptes));
    if (t.retenueSansSoldeCentimes > 0) {
      Kit.ligne(l, 'Retenues sans solde', '−' + Kit.eur(t.retenueSansSoldeCentimes), { alerte: true });
    }
    Kit.ligne(l, 'Salaires nets', Kit.eur(t.salaireNetCentimes));
    Kit.ligne(l, 'Total versé', Kit.eur(t.totalAVerserCentimes), { total: true });
    pane.appendChild(Kit.ce('div', 'sb q',
      'Les soldes d’heures et de congés payés ne figurent pas ici : ils ne s’additionnent ' +
      'jamais entre contrats. Ils sont contrat par contrat, ci-dessous.'));
    if (t.nbMoisProvisoires > 0) {
      pane.appendChild(Kit.ce('div', 'sb q',
        t.nbMoisProvisoires + ' mois encore provisoires dans ce total.'));
    }
    return pane;
  }

  function blocContrat(p, r) {
    var bloc = Kit.ce('div');
    var a = r.agr, ae = r.agrEntiers;

    bloc.appendChild(Kit.ce('div', 'sb q',
      r.contrat.prenom_enfant + (r.contrat.archive ? ' (ancien contrat)' : '') +
      ' · ' + Kit.dateLongue(r.debut) + ' → ' + Kit.dateLongue(r.fin) +
      ' · consultation personnelle'));

    if (r.tronquee) {
      bloc.appendChild(Kit.warnbox('Historique trop long',
        'Chaîne tronquée à ' + Chaine.MAX_MOIS + ' mois : vérifiez la date de début du contrat.'));
    }

    /* Restauration R2 : l'avertissement « ce contrat ne couvre qu'une partie de
       la période » — correction A1 du lot 5 — avait disparu de la refonte. */
    if (r.moisDemandes && a.nbMois < r.moisDemandes) {
      bloc.appendChild(Kit.warnbox('Ce contrat ne couvre pas toute la période demandée',
        r.contrat.prenom_enfant + ' n’est présent que sur ' + a.nbMois + ' des ' +
        r.moisDemandes + ' mois demandés (contrat du ' + Kit.dateLongue(r.contrat.date_debut) +
        (r.contrat.date_fin ? ' au ' + Kit.dateLongue(r.contrat.date_fin) : ', toujours en cours') +
        ') : les totaux ci-dessous ne portent que sur ces mois.'));
    }

    if (r.partielsClos && r.partielsClos.length) {
      bloc.appendChild(Kit.warnbox('Mois clôturé compté en entier',
        r.partielsClos.map(function (e) { return Kit.libelleMoisAnnee(e.annee, e.mois); }).join(', ') +
        ' n’est couvert qu’en partie par la période, mais son récapitulatif est déjà clôturé : ' +
        'il est repris tel quel, mois complet, et non recalculé au jour près. C’est le document ' +
        'remis aux parents qui fait foi.'));
    }

    var p1 = Kit.pane('Compté au jour près');
    var l1 = Kit.lines(p1);
    Kit.ligne(l1, 'Jours de présence', Kit.jours(a.joursPresence));
    Kit.ligne(l1, 'Indemnité d’entretien', Kit.eur(a.entretienCentimes));
    Kit.ligne(l1, 'Heures supplémentaires', Kit.heures(a.minutesSupAcquises));
    Kit.ligne(l1, 'Congés posés', Kit.jours(a.joursCongesDecomptes));
    if (a.retenueSansSoldeCentimes > 0) {
      Kit.ligne(l1, 'Retenues sans solde', '−' + Kit.eur(a.retenueSansSoldeCentimes), { alerte: true });
    }
    bloc.appendChild(p1);

    var p2 = Kit.pane('Sur les mois entiers');
    var l2 = Kit.lines(p2);
    if (ae.nbMois === 0) {
      Kit.ligne(l2, 'Aucun mois entier dans cette période', '—', { discret: true });
    } else {
      Kit.ligne(l2, 'Mois entiers', String(ae.nbMois));
      Kit.ligne(l2, 'Salaires nets', Kit.eur(ae.salaireNetCentimes));
      Kit.ligne(l2, 'Congés payés acquis',
        Kit.joursCp(ae.minutesCpAcquis, ae.minutesParJourConge));
      Kit.ligne(l2, 'Total versé sur ces mois', Kit.eur(ae.totalAVerserCentimes), { total: true });
    }
    if (r.partiels.length) {
      Kit.ligne(l2, 'Hors mois complets',
        r.partiels.map(function (e) { return Kit.libelleMois(e.mois); }).join(' · '),
        { discret: true });
    }
    bloc.appendChild(p2);

    if (r.soldes && r.soldes.sortie) {
      var p3 = Kit.pane('Compteurs (jamais additionnés)');
      var l3 = Kit.lines(p3);
      var e0 = r.soldes.entree || { minutesSup: 0, minutesCpAcquis: 0, minutesCpPris: 0 };
      var s = r.soldes.sortie;
      Kit.ligne(l3, 'Récupération au début', Kit.heures(e0.minutesSup || 0), { discret: true });
      Kit.ligne(l3, 'Récupération à la fin', Kit.heures(s.minutesSup || 0));
      Kit.ligne(l3, 'Congés payés au début',
        Kit.joursCp(Kit.cpDisponible(e0), ae.minutesParJourConge), { discret: true });
      Kit.ligne(l3, 'Congés payés à la fin',
        Kit.joursCp(Kit.cpDisponible(s), ae.minutesParJourConge));
      bloc.appendChild(p3);
    } else if (!p.entier) {
      bloc.appendChild(Kit.ce('p', 'sb q',
        'Les soldes d’heures et de congés payés ne sont pas affichés sur une période à dates ' +
        'libres : un mois entamé n’a pas de solde officiel. Ils figurent sur le document du mois.'));
    }

    if (a.moisProvisoires.length) {
      bloc.appendChild(Kit.warnbox('Mois pas encore clôturés',
        a.moisProvisoires.map(function (m) { return Kit.libelleMoisAnnee(m.annee, m.mois); }).join(', ') +
        '. Ces montants peuvent encore changer.'));
    }
    if (a.moisAvantInitialisation.length) {
      bloc.appendChild(Kit.warnbox('Mois antérieurs à la reprise de vos compteurs',
        a.moisAvantInitialisation.map(function (m) { return Kit.libelleMoisAnnee(m.annee, m.mois); }).join(', ') +
        '. Jours et montants exacts, soldes non significatifs.'));
    }
    if (a.moisHorsContratFiges && a.moisHorsContratFiges.length) {
      bloc.appendChild(Kit.warnbox('Attention — mois clôturé hors des dates du contrat',
        a.moisHorsContratFiges.map(function (m) { return Kit.libelleMoisAnnee(m.annee, m.mois); }).join(', ') +
        ' porte un document déjà remis aux parents alors que ce mois est hors du contrat. ' +
        'Il n’entre pas dans les totaux ci-dessus : vérifiez la date de fin du contrat.'));
    }
    return bloc;
  }

  global.UiPeriode = { afficher: afficher, MAX_MOIS_PERIODE: MAX_MOIS_PERIODE };
})(window);
