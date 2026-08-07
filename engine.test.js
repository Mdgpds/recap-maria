/* ============================================================================
   engine.test.js — Les 8 cas de test du §7 des specs (T1 à T8, T5bis inclus),
   précédés des valeurs de contrôle des jours fériés (§4.1) et de contrôles
   de format. Aucune dépendance : exécuté par test/run.js sous Node.

   Mois réels utilisés (le moteur travaille sur le calendrier réel) :
   - septembre 2025 : 22 jours ouvrés lundi-vendredi, aucun férié  (T1, T2)
   - avril 2025     : 22 jours ouvrés dont 1 férié, le lundi de Pâques
                      21/04 (T3, T4, T5, T5bis). Le §7 des specs illustre T4
                      avec « 1 férié un mardi » ; aucun mois proche ne
                      combine 22 jours ouvrés, un férié un mardi et une
                      semaine complète sans férié — le lundi 21/04/2025 est
                      arithmétiquement équivalent (signalé en restitution).
   ========================================================================= */
'use strict';

var Engine = require('../js/engine.js');
var Feries = require('../js/feries.js');
var Format = require('../js/format.js');

/* ---------------------------------------------------------------- */
/* Mini-assertions maison                                           */
/* ---------------------------------------------------------------- */

function egal(obtenu, attendu, libelle) {
  if (obtenu !== attendu) {
    throw new Error(libelle + ' : attendu ' + JSON.stringify(attendu) +
      ', obtenu ' + JSON.stringify(obtenu));
  }
}

function egalObjet(obtenu, attendu, libelle) {
  var cles = Object.keys(attendu);
  for (var i = 0; i < cles.length; i++) {
    egal(obtenu[cles[i]], attendu[cles[i]], libelle + '.' + cles[i]);
  }
}

/* ---------------------------------------------------------------- */
/* Fixtures — valeurs FICTIVES du §7 des specs (dépôt public)        */
/* ---------------------------------------------------------------- */

var CONTRAT_REF = {
  jours_planning: [1, 2, 3, 4, 5],
  date_debut: '2024-09-01',
  date_fin: null,
  minutes_contractuelles: 540,
  minutes_sup_jour: 30,
  minutes_par_jour_conge: 540,
  entretien_centimes_jour: 500,
  sup_dues_si_enfant_absent: true,
  ordre_imputation: 'cp_puis_sup'
};

var SALAIRE_REF = { brut_mensuel_centimes: 137289, net_mensuel_centimes: 107200 };

function contrat(surcharges) {
  var c = {};
  var k;
  for (k in CONTRAT_REF) c[k] = CONTRAT_REF[k];
  for (k in (surcharges || {})) c[k] = surcharges[k];
  return c;
}

/* Avril 2025 : férié le lundi 21 (lundi de Pâques), congé de Maria la
   semaine du 7 au 11 (lundi -> vendredi), enfant absent le jeudi 3. */
var JOURNEES_AVRIL_CONGE = [
  { jour: '2025-04-03', type: 'absence_enfant' },
  { jour: '2025-04-07', type: 'conge_maria' },
  { jour: '2025-04-08', type: 'conge_maria' },
  { jour: '2025-04-09', type: 'conge_maria' },
  { jour: '2025-04-10', type: 'conge_maria' },
  { jour: '2025-04-11', type: 'conge_maria' }
];

/* ---------------------------------------------------------------- */
/* Les cas                                                          */
/* ---------------------------------------------------------------- */

var cas = [];
function definir(nom, fn) { cas.push({ nom: nom, fn: fn }); }

definir('Contrôles — fériés (valeurs du §4.1) et format', function () {
  egal(Feries.paques(2025), '2025-04-20', 'Pâques 2025');
  egal(Feries.paques(2026), '2026-04-05', 'Pâques 2026');
  egal(Feries.paques(2027), '2027-03-28', 'Pâques 2027');

  var f2025 = Engine.joursFeriesFrance(2025);
  var f2026 = Engine.joursFeriesFrance(2026);
  var f2027 = Engine.joursFeriesFrance(2027);
  egal(f2025.indexOf('2025-04-21') !== -1, true, 'lundi de Pâques 2025');
  egal(f2025.indexOf('2025-05-29') !== -1, true, 'Ascension 2025');
  egal(f2025.indexOf('2025-06-09') !== -1, true, 'lundi de Pentecôte 2025');
  egal(f2026.indexOf('2026-04-06') !== -1, true, 'lundi de Pâques 2026');
  egal(f2026.indexOf('2026-05-14') !== -1, true, 'Ascension 2026');
  egal(f2026.indexOf('2026-05-25') !== -1, true, 'lundi de Pentecôte 2026');
  egal(f2027.indexOf('2027-03-29') !== -1, true, 'lundi de Pâques 2027');
  egal(f2027.indexOf('2027-05-06') !== -1, true, 'Ascension 2027');
  egal(f2027.indexOf('2027-05-17') !== -1, true, 'lundi de Pentecôte 2027');
  egal(f2025.length, 11, 'onze fériés en 2025');
  egal(Engine.estJourFerie('2025-07-14'), true, '14 juillet');
  egal(Engine.estJourFerie('2025-07-15'), false, '15 juillet');

  egal(Format.minutesEnHeures(570), '9h30', 'format minutes 570');
  egal(Format.minutesEnHeures(660), '11h00', 'format minutes 660');
  egal(Format.centimesEnEuros(137289), '1 372,89 €', 'format centimes 137289');
  egal(Format.centimesEnEuros(500), '5,00 €', 'format centimes 500');
  egal(Format.dixiemesEnJours(25), '2,5 j', 'format dixièmes 25');
  egal(Format.dixiemesEnJours(30), '3 j', 'format dixièmes 30');
});

definir('T1 — Mois nominal (septembre 2025)', function () {
  var r = Engine.calculerMois({
    contrat: contrat(), salaire: SALAIRE_REF, journees: [],
    compteurEntree: { minutesSup: 0, dixiemesCpAcquis: 0, dixiemesCpPris: 0 },
    annee: 2025, mois: 9
  });
  egalObjet(r, {
    joursPresence: 22,
    entretienCentimes: 11000,
    minutesSupAcquises: 660,
    dixiemesCpAcquis: 25
  }, 'T1');
  egal(r.totalAVerserCentimes, 107200 + 11000, 'T1.totalAVerserCentimes');
});

definir('T2 — Absences de l\'enfant (septembre 2025)', function () {
  var r = Engine.calculerMois({
    contrat: contrat(), salaire: SALAIRE_REF,
    journees: [
      { jour: '2025-09-03', type: 'absence_enfant' },
      { jour: '2025-09-10', type: 'absence_enfant' },
      { jour: '2025-09-17', type: 'absence_enfant' }
    ],
    compteurEntree: { minutesSup: 0, dixiemesCpAcquis: 0, dixiemesCpPris: 0 },
    annee: 2025, mois: 9
  });
  egalObjet(r, {
    joursPresence: 19,
    entretienCentimes: 9500,
    minutesSupAcquises: 660   // inchangé, RG-09
  }, 'T2');
});

definir('T3 — Jour férié (avril 2025, lundi de Pâques le 21)', function () {
  var r = Engine.calculerMois({
    contrat: contrat(), salaire: SALAIRE_REF, journees: [],
    compteurEntree: { minutesSup: 0, dixiemesCpAcquis: 0, dixiemesCpPris: 0 },
    annee: 2025, mois: 4
  });
  egalObjet(r, {
    joursPresence: 21,
    entretienCentimes: 10500,
    minutesSupAcquises: 630   // RG-10 : pas de minutes sup un férié
  }, 'T3');
});

definir('T4 — Semaine de congé avec reliquat (avril 2025)', function () {
  var r = Engine.calculerMois({
    contrat: contrat(), salaire: SALAIRE_REF,
    journees: JOURNEES_AVRIL_CONGE,
    compteurEntree: { minutesSup: 2400, dixiemesCpAcquis: 20, dixiemesCpPris: 0 },
    annee: 2025, mois: 4
  });
  egalObjet(r, {
    minutesSupAcquises: 480,    // 16 jours travaillés (15 présences + 1 absence enfant)
    joursPresence: 15,
    entretienCentimes: 7500,
    joursCongesDecomptes: 6     // RG-06 : samedi inclus
  }, 'T4');
  egalObjet(r.imputation, {
    joursSurCp: 2, dixiemesCpConsommes: 20,
    joursSurSup: 4, minutesSupConsommees: 2160,
    joursSansSolde: 0
  }, 'T4.imputation');
  /* Règle du reliquat : 2400 minutes couvrent 4 jours entiers, les 240
     restantes ne couvrent pas un cinquième et restent au compteur. */
  egal(r.compteurSortie.minutesSup, 720, 'T4.compteurSortie.minutesSup'); // 2400 − 2160 + 480
});

definir('T5 — Contrat en déficit (avril 2025)', function () {
  var r = Engine.calculerMois({
    contrat: contrat(), salaire: SALAIRE_REF,
    journees: JOURNEES_AVRIL_CONGE,
    compteurEntree: { minutesSup: 1080, dixiemesCpAcquis: 30, dixiemesCpPris: 0 },
    annee: 2025, mois: 4
  });
  egalObjet(r.imputation, {
    joursSurCp: 3, dixiemesCpConsommes: 30,
    joursSurSup: 2, minutesSupConsommees: 1080,
    joursSansSolde: 1
  }, 'T5.imputation');
  egal(r.retenueSansSoldeCentimes, 6336, 'T5.retenueSansSoldeCentimes'); // RG-08
  egal(r.totalAVerserCentimes, 107200 + 7500 - 6336, 'T5.totalAVerserCentimes');
});

definir('T5bis — Ordre inverse sup_puis_cp (avril 2025)', function () {
  var r = Engine.calculerMois({
    contrat: contrat({ ordre_imputation: 'sup_puis_cp' }), salaire: SALAIRE_REF,
    journees: JOURNEES_AVRIL_CONGE,
    compteurEntree: { minutesSup: 1080, dixiemesCpAcquis: 30, dixiemesCpPris: 0 },
    annee: 2025, mois: 4
  });
  egalObjet(r.imputation, {
    joursSurSup: 2, minutesSupConsommees: 1080,
    joursSurCp: 3, dixiemesCpConsommes: 30,
    joursSansSolde: 1
  }, 'T5bis.imputation');

  /* Le résultat chiffré est identique à T5 ; on vérifie donc en plus que le
     paramètre est réellement lu, sur un cas où l'ordre change le résultat :
     1 jour à imputer, les deux compteurs largement disponibles. */
  var cpDabord = Engine.imputerConges(1, { minutesSup: 5400, dixiemesCp: 100 },
    contrat({ ordre_imputation: 'cp_puis_sup' }));
  egalObjet(cpDabord, { joursSurCp: 1, dixiemesCpConsommes: 10, joursSurSup: 0, minutesSupConsommees: 0, joursSansSolde: 0 },
    'T5bis.ordre cp_puis_sup');
  var supDabord = Engine.imputerConges(1, { minutesSup: 5400, dixiemesCp: 100 },
    contrat({ ordre_imputation: 'sup_puis_cp' }));
  egalObjet(supDabord, { joursSurSup: 1, minutesSupConsommees: 540, joursSurCp: 0, dixiemesCpConsommes: 0, joursSansSolde: 0 },
    'T5bis.ordre sup_puis_cp');
});

definir('T6 — Solde de fin de contrat, majoration 50 % (RG-13)', function () {
  egal(Engine.montantCentimes(137289, 2700, 1.5), 47523, 'T6.montantCentimes');
});

definir('T7 — Immuabilité et RG-15 (changement de salaire au 1er avril)', function () {
  var historique = [
    { date_effet: '2025-01-01', brut_mensuel_centimes: 132745, net_mensuel_centimes: 103500 },
    { date_effet: '2025-04-01', brut_mensuel_centimes: 137289, net_mensuel_centimes: 107200 }
  ];

  /* RG-15 : le salaire de mars est celui dont la date d'effet est la plus
     récente antérieure ou égale au 1er mars. */
  egal(Engine.salaireApplicable(historique, 2025, 3).brut_mensuel_centimes, 132745, 'T7.salaire mars');
  egal(Engine.salaireApplicable(historique, 2025, 4).brut_mensuel_centimes, 137289, 'T7.salaire avril');

  /* Récap de mars calculé puis figé (instantané jsonb) AVANT le changement. */
  var recapMarsFige = Engine.calculerMois({
    contrat: contrat(), salaire: Engine.salaireApplicable(historique, 2025, 3),
    journees: [], compteurEntree: { minutesSup: 0, dixiemesCpAcquis: 0, dixiemesCpPris: 0 },
    annee: 2025, mois: 3
  });
  var instantane = JSON.parse(JSON.stringify(recapMarsFige)); // le jsonb stocké

  /* Le salaire passe à 137289 au 1er avril : relire le récap figé de mars
     ne déclenche AUCUN recalcul — on relit l'instantané, inchangé. */
  egal(instantane.salaireBrutCentimes, 132745, 'T7.recap figé inchangé');
  /* Et même un recalcul accidentel de mars retomberait sur l'ancien salaire
     grâce à RG-15 : */
  egal(Engine.salaireApplicable(historique, 2025, 3).brut_mensuel_centimes, 132745, 'T7.RG-15 stable');
});

definir('T8 — Décompte des jours ouvrables (RG-06)', function () {
  /* lundi -> vendredi, reprise le lundi suivant : 6 (samedi inclus) */
  egal(Engine.decompterJoursOuvrables('2025-09-01', '2025-09-05'), 6, 'T8.semaine complète');
  /* lundi -> mercredi, reprise le jeudi : 3 */
  egal(Engine.decompterJoursOuvrables('2025-09-01', '2025-09-03'), 3, 'T8.lundi-mercredi');
  /* semaine contenant un férié en milieu de semaine (Ascension jeudi
     29/05/2025) : 5 */
  egal(Engine.decompterJoursOuvrables('2025-05-26', '2025-05-30'), 5, 'T8.semaine avec férié');
  /* un jour isolé : 1 */
  egal(Engine.decompterJoursOuvrables('2025-09-02', '2025-09-02'), 1, 'T8.jour isolé');
});

module.exports = { cas: cas };
