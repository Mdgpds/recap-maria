/* ============================================================================
   recuperation-negative-differentiel.test.js — LE DIFFÉRENTIEL DE
   L'ARBITRAGE 4, POSTE À POSTE.

   Brief du 28 août 2026, §1 arbitrage 4 : « LA RÉCUPÉRATION PEUT PASSER EN
   NÉGATIF, ET LA POSE N'EST JAMAIS REFUSÉE. Maria a pris par le passé des
   journées de récupération que son solde ne couvrait pas ; l'application doit
   pouvoir enregistrer ces journées telles qu'elles ont eu lieu. Elle avertit,
   elle ne bloque pas. »

   §5 : « Les totaux du mois : salaire, entretien, retenues, compteur de
   sortie. Le différentiel poste à poste est obligatoire. »

   Le moteur figé de référence est `test/fixtures/engine-avant-recuperation-
   negative.js`, copie exacte de `js/engine.js` au commit `b83eadd` — la
   production d'avant ce lot, réserve à la date comprise.

   CE QUE CE FICHIER PROUVE, ET C'EST TOUT CE QU'IL A LE DROIT DE PROUVER :

   A. Sur tout mois que le moteur d'avant SAVAIT calculer, aucun poste ne
      bouge — pas un centime, pas une minute, pas un jour. L'arbitrage 4 ne
      change RIEN à un mois dont la ventilation tenait.
   B. Un mois qu'il REFUSAIT parce qu'une ventilation dépassait la
      RÉCUPÉRATION est désormais accepté, sans écrêtage : la ventilation est
      appliquée telle quelle et le compteur de sortie descend sous zéro.
   C. Un mois qu'il refusait parce qu'une ventilation dépassait les CONGÉS
      PAYÉS est TOUJOURS refusé. C'est la seconde moitié de l'arbitrage, et
      c'est celle qu'un différentiel doit surveiller le plus : elle protège
      un compteur qui ne se remet jamais à zéro (RG-12).

   Valeurs FICTIVES (dépôt public).
   ========================================================================= */
'use strict';

var Avant = require('./fixtures/engine-avant-recuperation-negative.js');
var Apres = require('../js/engine.js');

var cas = [];
function test(nom, fn) { cas.push({ nom: nom, fn: fn }); }
function assert(cond, message) { if (!cond) throw new Error(message); }
function copie(o) { return JSON.parse(JSON.stringify(o)); }

/* Les deux champs que CE lot ajoute au résultat. Ils ne portent aucun montant
   nouveau : ils lisent le compteur de sortie et le nomment. Le troisième
   ajout est le `minutesEnDepassement` de chaque ligne de
   `recuperationConsommeeParPeriode` — ce relevé sort donc aussi de la
   comparaison exacte, comme il en sortait déjà au lot précédent. */
function sansLesChampsAjoutes(r) {
  var c = copie(r);
  delete c.recuperationNegative;
  delete c.minutesRecuperationNegative;
  delete c.recuperationConsommeeParPeriode;
  return c;
}

/* Les postes du §5, nommés un par un — jamais déduits du résultat. */
var POSTES = [
  'joursPresence', 'entretienCentimes', 'joursSansEntretien',
  'minutesSupAcquises', 'minutesSupBase', 'minutesSupAjoutees',
  'minutesSupRenoncees', 'minutesEcartRecuperation', 'minutesEcartSurCp',
  'minutesEcartSansSolde', 'joursCongesDecomptes', 'retenueSansSoldeCentimes',
  'minutesCpAcquis', 'salaireBrutCentimes', 'salaireNetCentimes',
  'salaireBrutProrataCentimes', 'salaireNetProrataCentimes',
  'brutDuCentimes', 'totalAVerserCentimes'
];
var POSTES_COMPTEUR = ['minutesSup', 'minutesCpAcquis', 'minutesCpPris'];

function conditions(v) {
  return {
    date_effet: '2020-01-01', numero: 1,
    jours_planning: v.planning || [1, 2, 3, 4, 5],
    heure_arrivee: '08:30', heure_depart: '17:30',
    minutes_contractuelles: 540,
    minutes_sup_jour: v.minutesSupJour == null ? 30 : v.minutesSupJour,
    minutes_par_jour_conge: v.mpjc || 540,
    entretien_centimes_jour: 550,
    sup_dues_si_enfant_absent: true,
    ordre_imputation: v.ordre || 'cp_puis_sup',
    brut_mensuel_centimes: 137289, net_mensuel_centimes: 105000
  };
}

function entrees(v, aujourdhui) {
  return {
    contrat: { id: 'c1', date_debut: '2000-01-01', date_fin: null },
    conditions: conditions(v),
    journees: v.journees || [],
    compteurEntree: v.compteurEntree ||
      { minutesSup: 5400, minutesCpAcquis: 16200, minutesCpPris: 0 },
    annee: v.annee, mois: v.mois,
    imputations: v.imputations || [],
    samedisComptes: [],
    minutesCpAcquisesExercice: 0,
    aujourdhui: aujourdhui
  };
}

function conge(jour) { return { jour: jour, type: 'conge_maria' }; }
function ventilation(debut, fin, jours, surCp, surSup) {
  return { id: 'i-' + debut, date_debut: debut, date_fin: fin,
           jours_ouvrables: jours, jours_sur_cp: surCp, jours_sur_sup: surSup,
           jours_sans_solde: jours - surCp - surSup };
}

/* ------------------------------------------------------------------ */
/* LES MOIS DE FORME DIFFÉRENTE EXIGÉS PAR LE §6.5                     */
/* ------------------------------------------------------------------ */

var GROS = { minutesSup: 5400, minutesCpAcquis: 16200, minutesCpPris: 0 };
var VIDE = { minutesSup: 0, minutesCpAcquis: 0, minutesCpPris: 0 };
var UN_JOUR = { minutesSup: 540, minutesCpAcquis: 540, minutesCpPris: 0 };
var DETTE = { minutesSup: -900, minutesCpAcquis: 16200, minutesCpPris: 0 };

/* 1. Un mois SANS congé — celui que le lot ne concerne en rien, mais qui
      porte de la matière : minutes exceptionnelles, absence de l'enfant,
      écart d'horaire déduit de la récupération, journée sans entretien. */
var MOIS_SANS_CONGE = {
  annee: 2026, mois: 3, compteurEntree: GROS,
  journees: [
    { jour: '2026-03-03', type: 'presence', minutes_sup_exceptionnelles: 45 },
    { jour: '2026-03-10', type: 'absence_enfant' },
    { jour: '2026-03-17', type: 'presence', ecart_minutes: -90,
      ecart_impute_sur: 'recuperation', ecart_evenement: 'liberation_anticipee' },
    { jour: '2026-03-24', type: 'presence', entretien_du: false }
  ]
};

/* 2. Récupération EN DÉBUT de mois, largement financée par le compteur
      d'entrée. Le cas le plus banal, et celui qui ne doit pas bouger. */
var MOIS_RECUP_DEBUT = {
  annee: 2026, mois: 3, compteurEntree: GROS,
  journees: [conge('2026-03-03'), conge('2026-03-04')],
  imputations: [ventilation('2026-03-03', '2026-03-04', 2, 0, 2)]
};

/* 3. Récupération EN FIN de mois, financée par le mois lui-même — le cas du
      lot précédent, qui doit continuer de passer à l'identique. */
var MOIS_RECUP_FIN = {
  annee: 2026, mois: 3, compteurEntree: UN_JOUR,
  journees: [conge('2026-03-03'), conge('2026-03-30')],
  imputations: [ventilation('2026-03-03', '2026-03-03', 1, 0, 1),
                ventilation('2026-03-30', '2026-03-30', 1, 0, 1)]
};

/* 4. Congés payés — l'arbitrage 2 et la seconde moitié de l'arbitrage 4. */
var MOIS_CONGES_PAYES = {
  annee: 2026, mois: 3, compteurEntree: GROS,
  journees: [conge('2026-03-25'), conge('2026-03-26'), conge('2026-03-27')],
  imputations: [ventilation('2026-03-25', '2026-03-27', 3, 3, 0)]
};

/* 5. Un mois dont la ventilation DÉPASSE la récupération : c'est celui que le
      moteur d'avant refusait et que celui-ci accepte. */
var MOIS_RECUP_DEPASSEE = {
  annee: 2026, mois: 3, compteurEntree: VIDE,
  journees: [conge('2026-03-03'), conge('2026-03-04'), conge('2026-03-05')],
  imputations: [ventilation('2026-03-03', '2026-03-05', 3, 0, 3)]
};

/* 6. Le même mois, mais sur les CONGÉS PAYÉS : toujours refusé. */
var MOIS_CP_DEPASSES = {
  annee: 2026, mois: 3, compteurEntree: VIDE,
  journees: [conge('2026-03-03'), conge('2026-03-04'), conge('2026-03-05')],
  imputations: [ventilation('2026-03-03', '2026-03-05', 3, 3, 0)]
};

/* 7. Une dette de récupération déjà là, et une ventilation entièrement sur
      les congés payés — le cas que le croisement a trouvé au lot précédent :
      le moteur d'avant la refusait, parce que `0 > −900` est vrai. */
var MOIS_DETTE_ET_CP = {
  annee: 2026, mois: 3, compteurEntree: DETTE,
  journees: [conge('2026-03-16')],
  imputations: [ventilation('2026-03-16', '2026-03-16', 1, 1, 0)]
};

var LES_MOIS = [
  { nom: 'un mois sans congé', v: MOIS_SANS_CONGE, attendu: 'inchange' },
  { nom: 'récupération en DÉBUT de mois', v: MOIS_RECUP_DEBUT, attendu: 'inchange' },
  { nom: 'récupération en FIN de mois', v: MOIS_RECUP_FIN, attendu: 'inchange' },
  { nom: 'un mois de congés payés', v: MOIS_CONGES_PAYES, attendu: 'inchange' },
  { nom: 'une récupération DÉPASSÉE', v: MOIS_RECUP_DEPASSEE, attendu: 'debloque' },
  { nom: 'des congés payés DÉPASSÉS', v: MOIS_CP_DEPASSES, attendu: 'refuse' },
  { nom: 'une dette de récupération, ventilation sur les congés payés',
    v: MOIS_DETTE_ET_CP, attendu: 'debloque' }
];

var DATES_DU_JOUR = [undefined, '2026-02-15', '2026-03-16', '2026-04-15'];

/* ------------------------------------------------------------------ */

test('§5 — A : aucun mois calculable ne bouge, poste à poste',
  function () {
    var compares = 0;
    LES_MOIS.forEach(function (m) {
      DATES_DU_JOUR.forEach(function (auj) {
        var av = null, ap = null, eAv = null, eAp = null;
        try { av = Avant.calculerMois(entrees(m.v, auj)); } catch (x) { eAv = x; }
        try { ap = Apres.calculerMois(entrees(m.v, auj)); } catch (x) { eAp = x; }
        if (eAv) return;                       // traité par les cas B et C
        var etiquette = m.nom + ' [aujourd’hui = ' + auj + ']';
        assert(!eAp, etiquette + ' — le nouveau moteur refuse un mois que ' +
          'l’ancien calculait : ' + (eAp && eAp.code));
        POSTES.forEach(function (k) {
          assert(JSON.stringify(av[k]) === JSON.stringify(ap[k]),
            etiquette + ' — poste `' + k + '` : ' + JSON.stringify(av[k]) +
            ' → ' + JSON.stringify(ap[k]));
        });
        POSTES_COMPTEUR.forEach(function (k) {
          assert(av.compteurSortie[k] === ap.compteurSortie[k],
            etiquette + ' — compteur de sortie `' + k + '` : ' +
            av.compteurSortie[k] + ' → ' + ap.compteurSortie[k]);
        });
        assert(JSON.stringify(av.imputation) === JSON.stringify(ap.imputation),
          etiquette + ' — la ventilation a bougé');
        /* Et l'égalité EXACTE, les champs ajoutés mis à part : pas un champ
           du résultat n'a changé de forme. */
        assert(JSON.stringify(sansLesChampsAjoutes(ap)) ===
               JSON.stringify(sansLesChampsAjoutes(av)),
          etiquette + ' — égalité exacte attendue');
        compares++;
      });
    });
    /* Douze au moins : les mois que le moteur d'avant REFUSAIT (récupération
       dépassée, congés payés dépassés, et la récupération de fin de mois aux
       dates où elle n'était pas encore financée) sortent de ce comptage —
       ils sont la matière des cas B et C. */
    assert(compares >= 12, 'trop peu de mois comparés : ' + compares);
  });

test('§4.1 B — une récupération dépassée est ACCEPTÉE, sans un jour écrêté',
  function () {
    var v = MOIS_RECUP_DEPASSEE;
    var eAv = null;
    try { Avant.calculerMois(entrees(v, '2026-04-15')); } catch (x) { eAv = x; }
    assert(eAv && eAv.code === 'IMPUTATION_DEPASSE_RESERVES',
      'le décor doit bien être refusé par le moteur d’avant, sinon rien n’est prouvé');

    var ap = Apres.calculerMois(entrees(v, '2026-04-15'));
    assert(ap.imputation.joursSurSup === 3,
      'les trois jours sont pris sur la récupération (obtenu ' +
      ap.imputation.joursSurSup + ')');
    assert(ap.imputation.joursSansSolde === 0,
      'AUCUN ÉCRÊTAGE : rien ne bascule en sans solde');
    assert(ap.retenueSansSoldeCentimes === 0,
      'et donc aucune retenue que Maria n’a pas décidée');
    assert(ap.compteurSortie.minutesSup < 0,
      'le compteur de sortie descend sous zéro (' + ap.compteurSortie.minutesSup + ')');
    assert(ap.recuperationNegative === true, '`recuperationNegative` le dit');
    assert(ap.minutesRecuperationNegative === -ap.compteurSortie.minutesSup,
      'et le nombre de minutes en dépassement est celui du compteur');
    /* Les congés payés du mois, eux, n'ont pas bougé d'une minute. */
    assert(ap.imputation.minutesCpConsommees === 0,
      'rien n’a été pris sur les congés payés');
  });

test('§4.1 C — des congés payés dépassés restent REFUSÉS, à toute date',
  function () {
    DATES_DU_JOUR.forEach(function (auj) {
      var eAp = null;
      try { Apres.calculerMois(entrees(MOIS_CP_DEPASSES, auj)); } catch (x) { eAp = x; }
      assert(eAp && eAp.code === 'IMPUTATION_DEPASSE_RESERVES',
        'congés payés dépassés [aujourd’hui = ' + auj + '] : le refus doit rester ' +
        '(obtenu ' + (eAp ? eAp.code : 'accepté') + ')');
    });
  });

/* ------------------------------------------------------------------ */
/* LE DIFFÉRENTIEL LARGE                                               */
/* ------------------------------------------------------------------ */

test('§5 — différentiel large : les congés payés ne sont JAMAIS débloqués',
  function () {
    var PLANNINGS = [[1, 2, 3, 4, 5], [1, 2, 3, 4, 5, 6], [1, 3, 5]];
    var ORDRES = ['cp_puis_sup', 'sup_puis_cp'];
    var MOIS = [{ annee: 2026, mois: 3 }, { annee: 2026, mois: 5 },
                { annee: 2025, mois: 5 }, { annee: 2025, mois: 12 }];
    var COMPTEURS = [VIDE, UN_JOUR, GROS, DETTE];
    /* Les six façons de ventiler UNE période de trois jours : sur les congés
       payés, sur la récupération, panachée, et chacune au-delà. */
    var VENTILATIONS = [[3, 0], [0, 3], [1, 2], [2, 1], [3, 0], [0, 3]];

    var compares = 0, debloques = 0, refusIdentiques = 0, negatifs = 0;

    PLANNINGS.forEach(function (planning) {
      ORDRES.forEach(function (ordre) {
        MOIS.forEach(function (mm) {
          COMPTEURS.forEach(function (compteur) {
            VENTILATIONS.forEach(function (vent, idx) {
              var v = troisJours(mm, planning, ordre, compteur, vent, idx);
              if (!v) return;
              DATES_DU_JOUR.forEach(function (auj) {
                var av = null, ap = null, eAv = null, eAp = null;
                try { av = Avant.calculerMois(entrees(v, auj)); } catch (x) { eAv = x; }
                try { ap = Apres.calculerMois(entrees(v, auj)); } catch (x) { eAp = x; }
                var etiquette = '[' + mm.annee + '-' + mm.mois + ' planning=' +
                  planning.join('') + ' ordre=' + ordre + ' vent=' + vent.join('/') +
                  ' compteur=' + JSON.stringify(compteur) + ' auj=' + auj + ']';

                if (eAv) {
                  if (eAp) { refusIdentiques++; return; }
                  /* Un refus perdu, et une seule raison acceptable : il portait
                     sur la récupération. Les congés payés consommés doivent
                     rester dans la réserve d'entrée — sinon c'est le §28.3 qui
                     tombe, sur un compteur qui ne se remet jamais à zéro. */
                  assert(ap.imputation.minutesCpConsommees <=
                    (compteur.minutesCpAcquis || 0) - (compteur.minutesCpPris || 0),
                    etiquette + ' — un refus de CONGÉS PAYÉS a été perdu : régression');
                  debloques++;
                  if (ap.recuperationNegative) negatifs++;
                  return;
                }
                assert(!eAp, etiquette + ' — un mois calculable est refusé : ' +
                  (eAp && eAp.code));
                POSTES.forEach(function (k) {
                  assert(JSON.stringify(av[k]) === JSON.stringify(ap[k]),
                    etiquette + ' — poste `' + k + '` : ' + JSON.stringify(av[k]) +
                    ' → ' + JSON.stringify(ap[k]));
                });
                POSTES_COMPTEUR.forEach(function (k) {
                  assert(av.compteurSortie[k] === ap.compteurSortie[k],
                    etiquette + ' — compteur `' + k + '` : ' +
                    av.compteurSortie[k] + ' → ' + ap.compteurSortie[k]);
                });
                assert(JSON.stringify(sansLesChampsAjoutes(ap)) ===
                       JSON.stringify(sansLesChampsAjoutes(av)),
                  etiquette + ' — égalité exacte attendue');
                compares++;
              });
            });
          });
        });
      });
    });

    assert(compares > 200, 'trop peu de comparaisons : ' + compares);
    assert(debloques > 20, 'trop peu de mois débloqués : ' + debloques);
    assert(negatifs > 10, 'aucun solde négatif rencontré : ' + negatifs);
    assert(refusIdentiques > 20, 'trop peu de refus conservés : ' + refusIdentiques);
  });

/* Une période de trois jours ouvrables consécutifs dans le mois, ventilée
   comme demandé. Les journées sont posées sur des jours du planning non
   fériés, et l'imputation recouvre exactement la période — sinon le moteur
   l'écarterait (B1) et le différentiel mesurerait autre chose. */
function troisJours(mm, planning, ordre, compteur, vent, idx) {
  var jours = [];
  var tous = Apres.joursDuMois(mm.annee, mm.mois);
  for (var i = 0; i < tous.length && jours.length < 3; i++) {
    var d = tous[i];
    if (planning.indexOf(Apres.jourSemaine(d)) === -1) { jours = []; continue; }
    if (Apres.decompterJoursOuvrables(d, d, planning, []) !== 1) { jours = []; continue; }
    if (jours.length && !consecutifsDuPlanning(jours[jours.length - 1], d, planning)) {
      jours = [];
    }
    jours.push(d);
  }
  if (jours.length < 3) return null;
  /* Les deux dernières ventilations de la liste sont posées PLUS TARD dans le
     mois, pour que la réserve à la date ait le temps de monter. */
  if (idx >= 4) {
    var tard = [];
    for (var j = tous.length - 1; j >= 0 && tard.length < 3; j--) {
      var e = tous[j];
      if (planning.indexOf(Apres.jourSemaine(e)) === -1) { tard = []; continue; }
      if (Apres.decompterJoursOuvrables(e, e, planning, []) !== 1) { tard = []; continue; }
      if (tard.length && !consecutifsDuPlanning(e, tard[0], planning)) { tard = []; }
      tard.unshift(e);
    }
    if (tard.length === 3) jours = tard;
  }
  var decompte = Apres.decompterJoursOuvrables(jours[0], jours[2], planning, []);
  if (decompte !== 3) return null;
  return {
    annee: mm.annee, mois: mm.mois, planning: planning, ordre: ordre,
    compteurEntree: compteur,
    journees: jours.map(conge),
    imputations: [ventilation(jours[0], jours[2], 3, vent[0], vent[1])]
  };
}

/* Deux jours du planning sont consécutifs s'il n'existe entre eux aucun autre
   jour du planning — c'est ce qui fait UNE période au regard du moteur. */
function consecutifsDuPlanning(a, b, planning) {
  for (var d = lendemain(a); d < b; d = lendemain(d)) {
    if (planning.indexOf(Apres.jourSemaine(d)) !== -1) return false;
  }
  return true;
}
function lendemain(d) {
  var t = new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1,
    Number(d.slice(8, 10)) + 1));
  return t.toISOString().slice(0, 10);
}

module.exports = { cas: cas };
