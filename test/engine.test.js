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
  egal(Format.centimesEnEuros(137289), '1\u00a0372,89\u00a0€', 'format centimes 137289');
  egal(Format.centimesEnEuros(500), '5,00\u00a0€', 'format centimes 500');
  egal(Format.dixiemesEnJours(25), '2,5\u00a0j', 'format dixièmes 25');
  egal(Format.dixiemesEnJours(30), '3\u00a0j', 'format dixièmes 30');
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

definir('A1 — Bornes du contrat (correction relecture lot 1)', function () {
  /* Contrat démarrant le lundi 15/09/2025 : seuls les 12 jours du planning
     entre le 15 et le 30 comptent. Rien n'est présumé avant date_debut. */
  var demarrage = Engine.calculerMois({
    contrat: contrat({ date_debut: '2025-09-15' }), salaire: SALAIRE_REF, journees: [],
    compteurEntree: { minutesSup: 0, dixiemesCpAcquis: 0, dixiemesCpPris: 0 },
    annee: 2025, mois: 9
  });
  egalObjet(demarrage, {
    joursPresence: 12,
    entretienCentimes: 6000,
    minutesSupAcquises: 360,
    dixiemesCpAcquis: 0        // RG-11 : mois non couvert en entier
  }, 'A1.debut');

  /* Contrat finissant le vendredi 12/09/2025 : 10 jours (1er -> 12), et le
     compteur de sortie — base du solde majoré RG-13 — vaut bien 300. */
  var fin = Engine.calculerMois({
    contrat: contrat({ date_fin: '2025-09-12' }), salaire: SALAIRE_REF, journees: [],
    compteurEntree: { minutesSup: 0, dixiemesCpAcquis: 0, dixiemesCpPris: 0 },
    annee: 2025, mois: 9
  });
  egalObjet(fin, {
    joursPresence: 10,
    entretienCentimes: 5000,
    minutesSupAcquises: 300
  }, 'A1.fin');
  egal(fin.compteurSortie.minutesSup, 300, 'A1.fin.compteurSortie.minutesSup');

  /* Une ligne saisie hors bornes est neutre elle aussi. */
  var horsBornes = Engine.calculerMois({
    contrat: contrat({ date_debut: '2025-09-15' }), salaire: SALAIRE_REF,
    journees: [{ jour: '2025-09-03', type: 'presence' }],
    compteurEntree: { minutesSup: 0, dixiemesCpAcquis: 0, dixiemesCpPris: 0 },
    annee: 2025, mois: 9
  });
  egal(horsBornes.joursPresence, 12, 'A1.ligne hors bornes ignorée');
});

definir('B1 — Disponible négatif borné à 0 (correction relecture lot 1)', function () {
  /* Compteur incohérent (pris > acquis) : rien n'est consommé en négatif,
     rien n'est « rendu », tout part en sans solde. */
  var imp = Engine.imputerConges(3, { minutesSup: 0, dixiemesCp: -20 }, contrat());
  egalObjet(imp, {
    joursSurCp: 0, dixiemesCpConsommes: 0,
    joursSurSup: 0, minutesSupConsommees: 0,
    joursSansSolde: 3
  }, 'B1.cp négatif');

  var imp2 = Engine.imputerConges(2, { minutesSup: -100, dixiemesCp: 0 }, contrat());
  egalObjet(imp2, {
    joursSurSup: 0, minutesSupConsommees: 0,
    joursSurCp: 0, dixiemesCpConsommes: 0,
    joursSansSolde: 2
  }, 'B1.sup négatif');

  /* Et dans calculerMois : la retenue RG-08 reste calculée sur les vrais
     jours sans solde, le compteur de CP pris n'est jamais décrémenté. */
  var r = Engine.calculerMois({
    contrat: contrat(), salaire: SALAIRE_REF,
    journees: JOURNEES_AVRIL_CONGE,
    compteurEntree: { minutesSup: 0, dixiemesCpAcquis: 0, dixiemesCpPris: 20 },
    annee: 2025, mois: 4
  });
  egal(r.imputation.joursSansSolde, 6, 'B1.calculerMois.joursSansSolde');
  egal(r.retenueSansSoldeCentimes, Engine.montantCentimes(137289, 6 * 540), 'B1.calculerMois.retenue');
  egal(r.compteurSortie.dixiemesCpPris, 20, 'B1.calculerMois.cpPris inchangé');
});

/* ================================================================== */
/* LOT 9 — Imputation imposée et flexibilité au jour (T11 à T20)      */
/*                                                                    */
/* Les 10 cas ci-dessus sont la garantie que les comptes de Maria sont */
/* justes : ils ne bougent pas d'un caractère. Ce qui suit s'ajoute.   */
/* ================================================================== */

/* Vérifie qu'un appel lève bien le CODE attendu — jamais une phrase :
   la traduction en français appartient à js/messages.js. */
function leveCode(fn, code, libelle) {
  try {
    fn();
  } catch (e) {
    egal(e.code, code, libelle + '.code');
    return e;
  }
  throw new Error(libelle + ' : aucune erreur levée, « ' + code + ' » attendu');
}

/* Semaine de congé d'avril 2025 (7 -> 11), telle que posée par Maria :
   6 jours ouvrables au sens RG-06, samedi 12 inclus. */
var IMPUTATION_AVRIL = {
  date_debut: '2025-04-07', date_fin: '2025-04-11',
  jours_ouvrables: 6, jours_sur_cp: 2, jours_sur_sup: 3, jours_sans_solde: 1
};

definir('T11 — Imputation imposée appliquée telle quelle', function () {
  /* Appel direct : la répartition est appliquée sans être recalculée. */
  var imp = Engine.imputerConges(6, { minutesSup: 5400, dixiemesCp: 100 }, contrat(),
    { joursSurCp: 2, joursSurSup: 3, joursSansSolde: 1 });
  egalObjet(imp, {
    joursSurCp: 2, dixiemesCpConsommes: 20,
    joursSurSup: 3, minutesSupConsommees: 1620,
    joursSansSolde: 1
  }, 'T11.imputerConges');

  /* Et dans le mois : les compteurs sont décrémentés de 20 dixièmes et de
     3 × minutes_par_jour_conge, alors que l'ordre par défaut (cp_puis_sup)
     aurait pris 6 jours de congés payés — le choix de Maria prime. */
  var r = Engine.calculerMois({
    contrat: contrat(), salaire: SALAIRE_REF,
    journees: JOURNEES_AVRIL_CONGE,
    imputations: [IMPUTATION_AVRIL],
    compteurEntree: { minutesSup: 5400, dixiemesCpAcquis: 100, dixiemesCpPris: 0 },
    annee: 2025, mois: 4
  });
  egal(r.joursCongesDecomptes, 6, 'T11.joursCongesDecomptes');
  egalObjet(r.imputation, {
    joursSurCp: 2, dixiemesCpConsommes: 20,
    joursSurSup: 3, minutesSupConsommees: 1620,
    joursSansSolde: 1
  }, 'T11.mois.imputation');
  egal(r.compteurSortie.dixiemesCpPris, 20, 'T11.compteurSortie.dixiemesCpPris');
  egal(r.compteurSortie.minutesSup, 5400 - 1620 + 480, 'T11.compteurSortie.minutesSup');
  egal(r.imputationsAppliquees.length, 1, 'T11.imputationsAppliquees.length');
  egal(r.imputationsAppliquees[0].source, 'imposee', 'T11.imputationsAppliquees.source');
});

definir('T12 — Imputation incomplète : erreur, aucun compteur modifié', function () {
  var compteur = { minutesSup: 5400, dixiemesCp: 100 };
  leveCode(function () {
    Engine.imputerConges(6, compteur, contrat(),
      { joursSurCp: 2, joursSurSup: 2, joursSansSolde: 1 });   // 5 ≠ 6
  }, 'IMPUTATION_INCOMPLETE', 'T12');
  egal(compteur.minutesSup, 5400, 'T12.compteur.minutesSup intact');
  egal(compteur.dixiemesCp, 100, 'T12.compteur.dixiemesCp intact');

  /* Une valeur négative est refusée séparément, même si la somme tombe juste. */
  leveCode(function () {
    Engine.imputerConges(6, compteur, contrat(),
      { joursSurCp: 7, joursSurSup: -1, joursSansSolde: 0 });
  }, 'IMPUTATION_NEGATIVE', 'T12.negative');
});

definir('T13 — Imputation au-delà des réserves : erreur', function () {
  /* 5 jours sur les congés payés = 50 dixièmes, alors que 30 sont acquis. */
  leveCode(function () {
    Engine.imputerConges(6, { minutesSup: 5400, dixiemesCp: 30 }, contrat(),
      { joursSurCp: 5, joursSurSup: 1, joursSansSolde: 0 });
  }, 'IMPUTATION_DEPASSE_RESERVES', 'T13.cp');

  /* Même refus côté récupération. */
  leveCode(function () {
    Engine.imputerConges(3, { minutesSup: 540, dixiemesCp: 100 }, contrat(),
      { joursSurCp: 0, joursSurSup: 3, joursSansSolde: 0 });
  }, 'IMPUTATION_DEPASSE_RESERVES', 'T13.sup');
});

definir('T14 — Minutes exceptionnelles d\'une journée (V8-18)', function () {
  var journee = { jour: '2025-09-02', type: 'presence', minutes_sup_exceptionnelles: 45 };
  egal(Engine.minutesSupDuJour(journee, contrat()), 75, 'T14.minutesSupDuJour');

  var r = Engine.calculerMois({
    contrat: contrat(), salaire: SALAIRE_REF, journees: [journee],
    compteurEntree: { minutesSup: 0, dixiemesCpAcquis: 0, dixiemesCpPris: 0 },
    annee: 2025, mois: 9
  });
  egalObjet(r, {
    minutesSupBase: 660,
    minutesSupAjoutees: 45,
    minutesSupRenoncees: 0,
    minutesSupAcquises: 705
  }, 'T14.mois');
  egal(r.compteurSortie.minutesSup, 705, 'T14.compteurSortie.minutesSup');
});

definir('T15 — Renoncement explicite (V8-18)', function () {
  var journee = { jour: '2025-09-02', type: 'presence', minutes_sup_renoncees: 30 };
  egal(Engine.minutesSupDuJour(journee, contrat()), 0, 'T15.minutesSupDuJour');

  var r = Engine.calculerMois({
    contrat: contrat(), salaire: SALAIRE_REF, journees: [journee],
    compteurEntree: { minutesSup: 0, dixiemesCpAcquis: 0, dixiemesCpPris: 0 },
    annee: 2025, mois: 9
  });
  egalObjet(r, {
    minutesSupBase: 660,
    minutesSupRenoncees: 30,
    minutesSupAcquises: 630     // 660 − 30
  }, 'T15.mois');
});

definir('T16 — Renoncement borné : jamais de minutes négatives', function () {
  /* On ne peut pas renoncer à plus que ce qui est dû. Sans cette borne, le
     compteur AUGMENTERAIT quand Maria renonce. */
  var journee = { jour: '2025-09-02', type: 'presence', minutes_sup_renoncees: 60 };
  egal(Engine.minutesSupDuJour(journee, contrat()), 0, 'T16.minutesSupDuJour');

  var r = Engine.calculerMois({
    contrat: contrat(), salaire: SALAIRE_REF, journees: [journee],
    compteurEntree: { minutesSup: 0, dixiemesCpAcquis: 0, dixiemesCpPris: 0 },
    annee: 2025, mois: 9
  });
  egal(r.minutesSupRenoncees, 30, 'T16.minutesSupRenoncees plafonné');
  egal(r.minutesSupAcquises, 630, 'T16.minutesSupAcquises');
  egal(r.compteurSortie.minutesSup >= 0, true, 'T16.compteur jamais négatif');
});

definir('T17 — RG-09 surchargé pour une seule journée (V8-19)', function () {
  var c = contrat();   // sup_dues_si_enfant_absent = true
  egal(Engine.minutesSupDuJour(
    { type: 'absence_enfant', sup_dues_override: false }, c), 0, 'T17.journée surchargée');
  egal(Engine.minutesSupDuJour(
    { type: 'absence_enfant', sup_dues_override: null }, c), 30, 'T17.null suit le contrat');
  egal(Engine.minutesSupDuJour(
    { type: 'absence_enfant' }, c), 30, 'T17.absent suit le contrat');
  egal(Engine.minutesSupDuJour(
    { type: 'absence_enfant', sup_dues_override: true },
    contrat({ sup_dues_si_enfant_absent: false })), 30, 'T17.override true prime');

  var r = Engine.calculerMois({
    contrat: c, salaire: SALAIRE_REF,
    journees: [
      { jour: '2025-09-03', type: 'absence_enfant', sup_dues_override: false },
      { jour: '2025-09-10', type: 'absence_enfant' },
      { jour: '2025-09-17', type: 'absence_enfant' }
    ],
    compteurEntree: { minutesSup: 0, dixiemesCpAcquis: 0, dixiemesCpPris: 0 },
    annee: 2025, mois: 9
  });
  egal(r.joursPresence, 19, 'T17.joursPresence');
  /* 19 présences + 2 absences encore dues = 21 journées à 30 minutes. */
  egal(r.minutesSupAcquises, 630, 'T17.minutesSupAcquises');
  /* Le réglage du contrat n'a pas été modifié au passage. */
  egal(c.sup_dues_si_enfant_absent, true, 'T17.contrat inchangé');
});

definir('T18 — Période à cheval sur deux mois (28 juillet -> 4 août 2026)', function () {
  /* RG-06 sur la période ENTIÈRE : 28, 29, 30, 31 juillet, samedi 1er,
     lundi 3 et mardi 4 août — dimanche 2 exclu = 7 jours ouvrables.
     Le décompte n'est JAMAIS refait mois par mois : c'est l'imputation
     posée sur la période qui est répartie, au prorata des jours ouvrables
     tombant dans chaque mois (4 en juillet, 3 en août). */
  egal(Engine.decompterJoursOuvrables('2026-07-28', '2026-08-04'), 7, 'T18.décompte RG-06');

  var imputation = {
    date_debut: '2026-07-28', date_fin: '2026-08-04',
    jours_ouvrables: 7, jours_sur_cp: 4, jours_sur_sup: 2, jours_sans_solde: 1
  };
  var c = contrat();
  var entree = { minutesSup: 5400, dixiemesCpAcquis: 100, dixiemesCpPris: 0 };

  var juillet = Engine.calculerMois({
    contrat: c, salaire: SALAIRE_REF,
    journees: [
      { jour: '2026-07-28', type: 'conge_maria' },
      { jour: '2026-07-29', type: 'conge_maria' },
      { jour: '2026-07-30', type: 'conge_maria' },
      { jour: '2026-07-31', type: 'conge_maria' }
    ],
    imputations: [imputation], compteurEntree: entree, annee: 2026, mois: 7
  });

  /* Le mois d'août enchaîne sur les compteurs de sortie de juillet. */
  var aout = Engine.calculerMois({
    contrat: c, salaire: SALAIRE_REF,
    journees: [
      { jour: '2026-08-03', type: 'conge_maria' },
      { jour: '2026-08-04', type: 'conge_maria' }
    ],
    imputations: [imputation],
    compteurEntree: {
      minutesSup: juillet.compteurSortie.minutesSup,
      dixiemesCpAcquis: juillet.compteurSortie.dixiemesCpAcquis,
      dixiemesCpPris: juillet.compteurSortie.dixiemesCpPris
    },
    annee: 2026, mois: 8
  });

  /* Chaque mois consomme SA part… */
  egal(juillet.joursCongesDecomptes, 4, 'T18.juillet.joursCongesDecomptes');
  egal(aout.joursCongesDecomptes, 3, 'T18.août.joursCongesDecomptes');

  /* …et la somme des deux mois égale EXACTEMENT l'imputation posée :
     aucun jour perdu, aucun jour inventé par un arrondi. */
  egal(juillet.joursCongesDecomptes + aout.joursCongesDecomptes,
    imputation.jours_ouvrables, 'T18.somme des décomptes');
  egal(juillet.imputation.joursSurCp + aout.imputation.joursSurCp,
    imputation.jours_sur_cp, 'T18.somme cp');
  egal(juillet.imputation.joursSurSup + aout.imputation.joursSurSup,
    imputation.jours_sur_sup, 'T18.somme sup');
  egal(juillet.imputation.joursSansSolde + aout.imputation.joursSansSolde,
    imputation.jours_sans_solde, 'T18.somme sans solde');

  /* Chaque mois reste cohérent : sa ventilation couvre son propre décompte. */
  [['juillet', juillet], ['août', aout]].forEach(function (paire) {
    var m = paire[1];
    egal(m.imputation.joursSurCp + m.imputation.joursSurSup + m.imputation.joursSansSolde,
      m.joursCongesDecomptes, 'T18.' + paire[0] + '.ventilation couvre le décompte');
    egal(m.imputationsAppliquees[0].source, 'imposee', 'T18.' + paire[0] + '.source');
  });

  /* Les compteurs de sortie d'août portent bien les 4 jours de congés payés
     et les 2 jours de récupération de la période entière. */
  egal(aout.compteurSortie.dixiemesCpPris, 40, 'T18.cp pris sur la période');
});

definir('T18bis — Le 6e jour d\'une semaine à cheval n\'est jamais perdu', function () {
  /* Semaine du lundi 27 au vendredi 31 juillet 2026, reprise le lundi 3 août :
     RG-06 compte 6 jours, samedi 1er août INCLUS. Ce samedi tombe en août,
     mois où AUCUNE journée de congé n'est posée. Il doit rester imputé sur
     juillet — sinon la semaine de Maria ne compterait plus que 5 jours, ce
     qui est très exactement le litige historique avec les familles. */
  egal(Engine.decompterJoursOuvrables('2026-07-27', '2026-07-31'), 6, 'T18bis.décompte RG-06');

  var imputation = {
    date_debut: '2026-07-27', date_fin: '2026-07-31',
    jours_ouvrables: 6, jours_sur_cp: 3, jours_sur_sup: 2, jours_sans_solde: 1
  };
  var juillet = Engine.calculerMois({
    contrat: contrat(), salaire: SALAIRE_REF,
    journees: [
      { jour: '2026-07-27', type: 'conge_maria' },
      { jour: '2026-07-28', type: 'conge_maria' },
      { jour: '2026-07-29', type: 'conge_maria' },
      { jour: '2026-07-30', type: 'conge_maria' },
      { jour: '2026-07-31', type: 'conge_maria' }
    ],
    imputations: [imputation],
    compteurEntree: { minutesSup: 5400, dixiemesCpAcquis: 100, dixiemesCpPris: 0 },
    annee: 2026, mois: 7
  });
  egal(juillet.joursCongesDecomptes, 6, 'T18bis.juillet décompte 6 jours');
  egalObjet(juillet.imputation, {
    joursSurCp: 3, dixiemesCpConsommes: 30,
    joursSurSup: 2, minutesSupConsommees: 1080,
    joursSansSolde: 1
  }, 'T18bis.juillet.imputation');

  /* Août, qui ne porte aucune journée de congé, ne consomme rien du tout. */
  var aout = Engine.calculerMois({
    contrat: contrat(), salaire: SALAIRE_REF, journees: [],
    imputations: [imputation],
    compteurEntree: {
      minutesSup: juillet.compteurSortie.minutesSup,
      dixiemesCpAcquis: juillet.compteurSortie.dixiemesCpAcquis,
      dixiemesCpPris: juillet.compteurSortie.dixiemesCpPris
    },
    annee: 2026, mois: 8
  });
  egal(aout.joursCongesDecomptes, 0, 'T18bis.août ne décompte rien');
  egal(aout.imputation.joursSurCp, 0, 'T18bis.août ne consomme aucun congé payé');
  egal(aout.compteurSortie.dixiemesCpPris, 30, 'T18bis.total des CP pris');
});

definir('T19 — RG-04 prime sur toute flexibilité', function () {
  /* Lundi de Pâques 21/04/2025, portant par erreur 60 minutes
     exceptionnelles : une journée sans travail ne génère rien. */
  var ferie = { jour: '2025-04-21', type: 'ferie', minutes_sup_exceptionnelles: 60 };
  egal(Engine.minutesSupDuJour(ferie, contrat()), 0, 'T19.minutesSupDuJour');

  var r = Engine.calculerMois({
    contrat: contrat(), salaire: SALAIRE_REF, journees: [ferie],
    compteurEntree: { minutesSup: 0, dixiemesCpAcquis: 0, dixiemesCpPris: 0 },
    annee: 2025, mois: 4
  });
  egalObjet(r, {
    minutesSupBase: 630,
    minutesSupAjoutees: 0,      // jamais comptées un jour férié
    minutesSupRenoncees: 0,
    minutesSupAcquises: 630     // identique à T3
  }, 'T19.mois');

  /* Même verrou sur les autres types sans travail. */
  ['conge_maria', 'sans_solde', 'familiarisation', 'hors_planning'].forEach(function (t) {
    egal(Engine.minutesSupDuJour(
      { type: t, minutes_sup_exceptionnelles: 120 }, contrat()), 0, 'T19.' + t);
  });
});

definir('T20 — Non-régression : mois sans imputation ni flexibilité', function () {
  /* Sortie capturée sur le moteur d'AVANT le lot 9, pour le cas T4.
     Toute valeur différente est un défaut, jamais une amélioration. */
  var r = Engine.calculerMois({
    contrat: contrat(), salaire: SALAIRE_REF,
    journees: JOURNEES_AVRIL_CONGE,
    compteurEntree: { minutesSup: 2400, dixiemesCpAcquis: 20, dixiemesCpPris: 0 },
    annee: 2025, mois: 4
  });
  egalObjet(r, {
    joursPresence: 15,
    entretienCentimes: 7500,
    minutesSupAcquises: 480,
    joursCongesDecomptes: 6,
    retenueSansSoldeCentimes: 0,
    dixiemesCpAcquis: 0,
    salaireBrutCentimes: 137289,
    salaireNetCentimes: 107200,
    totalAVerserCentimes: 114700
  }, 'T20.avant-lot');
  egalObjet(r.imputation, {
    joursSurSup: 4, minutesSupConsommees: 2160,
    joursSurCp: 2, dixiemesCpConsommes: 20,
    joursSansSolde: 0
  }, 'T20.avant-lot.imputation');
  egalObjet(r.compteurSortie, {
    minutesSup: 720, dixiemesCpAcquis: 20, dixiemesCpPris: 20
  }, 'T20.avant-lot.compteurSortie');

  /* Les sorties ajoutées par le lot 9 sont neutres sur ce mois. */
  egalObjet(r, {
    minutesSupBase: 480, minutesSupAjoutees: 0, minutesSupRenoncees: 0
  }, 'T20.détail neutre');
  egal(r.imputationsAppliquees.length, 1, 'T20.une période');
  egal(r.imputationsAppliquees[0].source, 'defaut', 'T20.source par défaut');

  /* Une entrée `imputations` vide ne change rien non plus. */
  var vide = Engine.calculerMois({
    contrat: contrat(), salaire: SALAIRE_REF,
    journees: JOURNEES_AVRIL_CONGE, imputations: [],
    compteurEntree: { minutesSup: 2400, dixiemesCpAcquis: 20, dixiemesCpPris: 0 },
    annee: 2025, mois: 4
  });
  egal(JSON.stringify(vide), JSON.stringify(r), 'T20.imputations vides');
});

/* ================================================================== */
/* CORRECTIONS DE RELECTURE DU LOT 9 (T21 à T23)                      */
/* ================================================================== */

definir('T21 — A1 : le décompte RG-06 n\'est jamais écrasé par la ligne posée', function () {
  /* Semaine du lundi 27 au vendredi 31 juillet 2026 : RG-06 en compte 6,
     samedi 1er août inclus. Une imputation posée à 5 jours passe pourtant la
     contrainte SQL (5 + 0 + 0 = 5) : c'est au moteur de la refuser, sans quoi
     le récapitulatif afficherait « 5 jours de congés » à côté de l'encart qui
     explique qu'une semaine en compte 6 — le litige historique avec les
     familles, imprimé sur le document. */
  egal(Engine.decompterJoursOuvrables('2026-07-27', '2026-07-31'), 6, 'T21.décompte réel');

  var journees = [
    { jour: '2026-07-27', type: 'conge_maria' },
    { jour: '2026-07-28', type: 'conge_maria' },
    { jour: '2026-07-29', type: 'conge_maria' },
    { jour: '2026-07-30', type: 'conge_maria' },
    { jour: '2026-07-31', type: 'conge_maria' }
  ];
  var compteurEntree = { minutesSup: 5400, dixiemesCpAcquis: 100, dixiemesCpPris: 0 };

  function calculerAvec(imputation) {
    return Engine.calculerMois({
      contrat: contrat(), salaire: SALAIRE_REF, journees: journees,
      imputations: [imputation], compteurEntree: compteurEntree,
      annee: 2026, mois: 7
    });
  }

  /* Décompte sous-évalué : Maria perdrait un jour de congé au décompte. */
  var e1 = leveCode(function () {
    calculerAvec({
      date_debut: '2026-07-27', date_fin: '2026-07-31',
      jours_ouvrables: 5, jours_sur_cp: 5, jours_sur_sup: 0, jours_sans_solde: 0
    });
  }, 'IMPUTATION_INCOMPLETE', 'T21.décompte à 5');
  egal(e1.attendu, 6, 'T21.attendu = décompte RG-06 réel');
  egal(e1.recu, 5, 'T21.reçu = ventilation transmise');

  /* Décompte sur-évalué : Maria perdrait un jour de congés payés. */
  leveCode(function () {
    calculerAvec({
      date_debut: '2026-07-27', date_fin: '2026-07-31',
      jours_ouvrables: 7, jours_sur_cp: 7, jours_sur_sup: 0, jours_sans_solde: 0
    });
  }, 'IMPUTATION_INCOMPLETE', 'T21.décompte à 7');

  /* Ligne incohérente avec elle-même (modifiée à la main hors contrainte). */
  leveCode(function () {
    calculerAvec({
      date_debut: '2026-07-27', date_fin: '2026-07-31',
      jours_ouvrables: 5, jours_sur_cp: 3, jours_sur_sup: 3, jours_sans_solde: 0
    });
  }, 'IMPUTATION_INCOMPLETE', 'T21.ligne incohérente');

  /* Et le décompte juste passe, lui, sans rien changer d'autre. */
  var ok = calculerAvec({
    date_debut: '2026-07-27', date_fin: '2026-07-31',
    jours_ouvrables: 6, jours_sur_cp: 6, jours_sur_sup: 0, jours_sans_solde: 0
  });
  egal(ok.joursCongesDecomptes, 6, 'T21.décompte juste accepté');
  egal(ok.compteurSortie.dixiemesCpPris, 60, 'T21.60 dixièmes consommés');
});

definir('T22 — A2 : un choix écarté ne se confond pas avec une absence de choix', function () {
  /* Imputation posée du lundi 6 au vendredi 17 juillet 2026 (14 juillet
     férié), RG-06 = 11, choix de Maria : tout sur la récupération. */
  var imputation = {
    date_debut: '2026-07-06', date_fin: '2026-07-17',
    jours_ouvrables: 11, jours_sur_cp: 0, jours_sur_sup: 11, jours_sans_solde: 0
  };
  egal(Engine.decompterJoursOuvrables('2026-07-06', '2026-07-17'), 11, 'T22.décompte RG-06');

  var joursConformes = ['2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10',
                        '2026-07-13', '2026-07-15', '2026-07-16', '2026-07-17'];
  function journees(liste) {
    return liste.map(function (j) { return { jour: j, type: 'conge_maria' }; });
  }
  function calculer(liste) {
    return Engine.calculerMois({
      contrat: contrat(), salaire: SALAIRE_REF, journees: journees(liste),
      imputations: [imputation],
      compteurEntree: { minutesSup: 5940, dixiemesCpAcquis: 300, dixiemesCpPris: 0 },
      annee: 2026, mois: 7
    });
  }

  /* Cas conforme : le choix s'applique. */
  var conforme = calculer(joursConformes);
  egal(conforme.imputationsAppliquees[0].source, 'imposee', 'T22.conforme.source');
  egal(conforme.imputation.joursSurSup, 11, 'T22.conforme.joursSurSup');
  egal(conforme.imputation.joursSurCp, 0, 'T22.conforme.joursSurCp');

  /* Cas dégradé : une journée ajoutée le lundi 20, imputation non remise à
     jour. L'ordre du contrat reprend la main — mais le moteur DIT que le
     choix de Maria a été écarté, et quelle période était concernée. */
  var degrade = calculer(joursConformes.concat(['2026-07-20']));
  egal(degrade.imputationsAppliquees[0].source, 'defaut_choix_ecarte', 'T22.dégradé.source');
  egalObjet(degrade.imputationsAppliquees[0].choixEcarte, {
    date_debut: '2026-07-06', date_fin: '2026-07-17'
  }, 'T22.dégradé.choixEcarte');

  /* Sans aucune imputation posée, la source reste « defaut » tout court. */
  var sansChoix = Engine.calculerMois({
    contrat: contrat(), salaire: SALAIRE_REF, journees: journees(joursConformes),
    compteurEntree: { minutesSup: 5940, dixiemesCpAcquis: 300, dixiemesCpPris: 0 },
    annee: 2026, mois: 7
  });
  egal(sansChoix.imputationsAppliquees[0].source, 'defaut', 'T22.sans choix.source');
  egal(sansChoix.imputationsAppliquees[0].choixEcarte, undefined, 'T22.sans choix.aucun écarté');
});

definir('T23 — A3 : un renoncement exprimé n\'est jamais ignoré en silence', function () {
  /* Une valeur non entière — la valeur naturelle d'un champ de saisie —
     était silencieusement repliée sur 0 : les minutes restaient acquises,
     donc un chiffre faux EN FAVEUR de Maria, contestable par les familles.
     On refuse désormais, avec un code. */
  ['30', 30.5, -30, NaN, {}, true].forEach(function (v) {
    leveCode(function () {
      Engine.minutesSupDuJour({ type: 'presence', minutes_sup_renoncees: v }, contrat());
    }, 'MINUTES_INVALIDES', 'T23.renoncees ' + String(v));
    leveCode(function () {
      Engine.minutesSupDuJour({ type: 'presence', minutes_sup_exceptionnelles: v }, contrat());
    }, 'MINUTES_INVALIDES', 'T23.exceptionnelles ' + String(v));
  });

  /* Absent, null et undefined restent « rien de saisi » : aucune erreur,
     valeur 0. C'est le cas de toutes les journées d'avant le lot 9. */
  egal(Engine.minutesSupDuJour({ type: 'presence' }, contrat()), 30, 'T23.absent');
  egal(Engine.minutesSupDuJour(
    { type: 'presence', minutes_sup_renoncees: null, minutes_sup_exceptionnelles: null },
    contrat()), 30, 'T23.null');
  egal(Engine.minutesSupDuJour(
    { type: 'presence', minutes_sup_renoncees: undefined }, contrat()), 30, 'T23.undefined');

  /* Et une journée fautive fait échouer le mois entier plutôt que de
     produire un compteur faux. */
  leveCode(function () {
    Engine.calculerMois({
      contrat: contrat(), salaire: SALAIRE_REF,
      journees: [{ jour: '2025-09-02', type: 'presence', minutes_sup_renoncees: '30' }],
      compteurEntree: { minutesSup: 0, dixiemesCpAcquis: 0, dixiemesCpPris: 0 },
      annee: 2025, mois: 9
    });
  }, 'MINUTES_INVALIDES', 'T23.calculerMois');
});

definir('A9 — Invariant : acquises = base + ajoutées − renoncées', function () {
  /* Vérifié sur un éventail de mois, avec et sans flexibilité. */
  var mois = [
    { annee: 2025, mois: 9, journees: [] },
    { annee: 2025, mois: 4, journees: JOURNEES_AVRIL_CONGE },
    { annee: 2025, mois: 9, journees: [
      { jour: '2025-09-02', type: 'presence', minutes_sup_exceptionnelles: 45 },
      { jour: '2025-09-03', type: 'absence_enfant', sup_dues_override: false },
      { jour: '2025-09-04', type: 'presence', minutes_sup_renoncees: 90 },
      { jour: '2025-09-05', type: 'presence', minutes_sup_exceptionnelles: 60, minutes_sup_renoncees: 15 }
    ] }
  ];
  mois.forEach(function (m, i) {
    var r = Engine.calculerMois({
      contrat: contrat(), salaire: SALAIRE_REF, journees: m.journees,
      compteurEntree: { minutesSup: 0, dixiemesCpAcquis: 0, dixiemesCpPris: 0 },
      annee: m.annee, mois: m.mois
    });
    egal(r.minutesSupAcquises,
      r.minutesSupBase + r.minutesSupAjoutees - r.minutesSupRenoncees,
      'A9.mois ' + i);
    egal(r.minutesSupAcquises >= 0, true, 'A9.jamais négatif ' + i);
  });
});

module.exports = { cas: cas };
