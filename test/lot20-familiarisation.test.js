/* ============================================================================
   lot20-familiarisation.test.js — LES CRITÈRES A2 À A7 DU §20.5,
   et les trois critères du §20.6 (l'entretien retirable).

   Le critère A1 — « hors familiarisation, rien ne bouge » — est prouvé
   ailleurs, par différentiel exhaustif : `test/lot20-differentiel.test.js`.

   Ici on prouve ce que le lot AJOUTE, et on le prouve sur des chiffres qui se
   recalculent à la main. Septembre 2026 sert de mois de référence partout :
   22 jours ouvrés du lundi au vendredi, le 20 est un dimanche, aucun férié.
   ========================================================================= */
'use strict';

var Engine = require('../js/engine.js');

var cas = [];
function test(nom, fn) { cas.push({ nom: nom, fn: fn }); }
function assert(cond, message) { if (!cond) throw new Error(message); }
function egal(obtenu, attendu, quoi) {
  assert(obtenu === attendu, quoi + ' : obtenu ' + obtenu + ', attendu ' + attendu);
}

var BRUT = 140400;   // 1 404,00 € : 195 h à 7,20 € brut de l'heure, pile
var NET = 107100;

function conditions(sur) {
  var c = {
    date_effet: '2020-01-01', numero: 1,
    jours_planning: [1, 2, 3, 4, 5],
    heure_arrivee: '08:30', heure_depart: '17:30',
    minutes_contractuelles: 540,
    minutes_sup_jour: 30,
    minutes_par_jour_conge: 540,
    entretien_centimes_jour: 550,
    sup_dues_si_enfant_absent: true,
    ordre_imputation: 'cp_puis_sup',
    brut_mensuel_centimes: BRUT,
    net_mensuel_centimes: NET
  };
  for (var k in (sur || {})) c[k] = sur[k];
  return c;
}

var CONTRAT = { id: 'c1', date_debut: '2020-01-01', date_fin: null };

function calculer(sur) {
  var e = {
    contrat: CONTRAT, conditions: conditions(sur && sur.conditions),
    journees: (sur && sur.journees) || [],
    compteurEntree: { minutesSup: 0, minutesCpAcquis: 0, minutesCpPris: 0 },
    annee: (sur && sur.annee) || 2026, mois: (sur && sur.mois) || 9,
    periodesFamiliarisation: (sur && sur.periodes) || []
  };
  return Engine.calculerMois(e);
}

/* La période du 1er au 19 septembre 2026. Le 1er est un mardi : 1→4 font
   quatre jours ouvrés, 7→11 cinq, 14→18 cinq — soit QUATORZE jours du
   planning lundi-vendredi. Le 19 est un samedi, hors planning. Il reste donc
   HUIT jours de garde mensualisée sur les 22 du mois : c'est exactement le
   « 8 jours travaillés sur 22 » que montre la maquette. */
var PERIODE_1_19 = [{ date_debut: '2026-09-01', date_fin: '2026-09-19' }];

/* ------------------------------------------------------------------ */
/* A2 — la rémunération d'un jour                                      */
/* ------------------------------------------------------------------ */

test('A2 — un jour à 2 h 30 déclarées paie exactement montantCentimes(brut, 150)', function () {
  var r = calculer({
    periodes: PERIODE_1_19,
    journees: [{ jour: '2026-09-01', type: 'familiarisation', minutes_reelles: 150 }]
  });
  egal(r.familiarisation.minutesDeclarees, 150, 'minutes déclarées');
  egal(r.familiarisation.brutCentimes, Engine.montantCentimes(BRUT, 150), 'brut du jour');
  egal(r.familiarisation.brutCentimes, 1800, 'brut du jour en centimes (2,5 h × 7,20 €)');
  egal(r.familiarisation.netCentimes, Engine.montantCentimes(NET, 150), 'net du jour');
});

test('A2 bis — UN SEUL arrondi : deux jours valent le calcul sur leur somme', function () {
  /* 137 puis 89 minutes. Arrondir chaque jour puis additionner donnerait un
     centime de plus ou de moins selon les mois — invisible, cumulatif, et du
     mauvais côté une fois sur deux. */
  var r = calculer({
    periodes: PERIODE_1_19,
    journees: [
      { jour: '2026-09-01', type: 'familiarisation', minutes_reelles: 137 },
      { jour: '2026-09-02', type: 'familiarisation', minutes_reelles: 89 }
    ]
  });
  egal(r.familiarisation.brutCentimes, Engine.montantCentimes(BRUT, 226),
    'le brut est calculé sur le total des minutes');
  var deuxArrondis = Engine.montantCentimes(BRUT, 137) + Engine.montantCentimes(BRUT, 89);
  assert(r.familiarisation.brutCentimes !== deuxArrondis || true,
    'témoin : deux arrondis valent ' + deuxArrondis);
});

/* ------------------------------------------------------------------ */
/* A3 — l'arrivée et le départ, à la minute près                       */
/* ------------------------------------------------------------------ */

test('A3 — 9 h 05 → 11 h 47 fait 162 minutes, sans arrondi', function () {
  egal(Engine.dureeEntreHeures('09:05', '11:47'), 162, 'durée');
  egal(Engine.dureeEntreHeures('08:30', '17:30'), 540, 'une journée entière');
  egal(Engine.dureeEntreHeures('09:00', '09:01'), 1, 'une minute');
});

test('A3 bis — un départ avant l’arrivée est refusé, jamais ramené à zéro', function () {
  var codes = [];
  [['11:47', '09:05'], ['09:05', '09:05']].forEach(function (p) {
    try { Engine.dureeEntreHeures(p[0], p[1]); codes.push('accepté'); }
    catch (e) { codes.push(e.code); }
  });
  egal(codes.join(','), 'DUREE_NON_POSITIVE,DUREE_NON_POSITIVE', 'les deux refus');
  try { Engine.dureeEntreHeures('9h05', '11:47'); assert(false, 'heure illisible acceptée'); }
  catch (e) { egal(e.code, 'HEURE_INVALIDE', 'heure illisible'); }
});

/* ------------------------------------------------------------------ */
/* A4 — le mois mêlé vaut la somme exacte de ses deux parts            */
/* ------------------------------------------------------------------ */

test('A4 — familiarisation du 1er au 19, garde ensuite : la somme est exacte', function () {
  var journees = [
    { jour: '2026-09-01', type: 'familiarisation', minutes_reelles: 150 },
    { jour: '2026-09-02', type: 'familiarisation', minutes_reelles: 180 },
    { jour: '2026-09-03', type: 'familiarisation', minutes_reelles: 270 },
    { jour: '2026-09-04', type: 'familiarisation', minutes_reelles: 300 },
    { jour: '2026-09-07', type: 'familiarisation', minutes_reelles: 450 }
  ];
  var r = calculer({ periodes: PERIODE_1_19, journees: journees });

  /* Les deux parts du mois, comptées séparément et sans recouvrement. */
  egal(r.prorata.joursDuMois, 22, 'jours ouvrés de septembre 2026');
  egal(r.prorata.joursFamiliarisation, 14, 'jours du planning dans la période');
  egal(r.prorata.joursCouverts, 8, 'jours de garde mensualisée restants');
  egal(r.prorata.joursFamiliarisation + r.prorata.joursCouverts, r.prorata.joursDuMois,
    'aucun jour compté deux fois ni oublié');

  egal(r.familiarisation.minutesDeclarees, 1350, 'total des minutes déclarées');
  egal(r.familiarisation.joursDeclares, 5, 'jours déclarés');
  egal(r.familiarisation.brutCentimes, Engine.montantCentimes(BRUT, 1350), 'brut horaire');
  egal(r.salaireNetProrataCentimes, Math.round(NET * 8 / 22), 'net mensualisé proratisé');

  /* Les jours de garde : 8 jours de présence, leur entretien, leurs 30 min. */
  egal(r.joursPresence, 8, 'jours de présence de la part mensualisée');
  egal(r.entretienCentimes, 8 * 550, 'entretien de la part mensualisée');
  egal(r.minutesSupAcquises, 8 * 30, 'minutes supplémentaires, part mensualisée seule');

  /* Et le total à verser est la somme des deux parts, sans rien d'autre. */
  egal(r.totalAVerserCentimes,
    Math.round(NET * 8 / 22) + Engine.montantCentimes(NET, 1350) +
    8 * 550 + r.familiarisation.entretienCentimes,
    'total à verser');
});

test('A4 bis — un mois ENTIÈREMENT en familiarisation ne verse aucun mensualisé', function () {
  var r = calculer({
    periodes: [{ date_debut: '2026-09-01', date_fin: '2026-09-30' }],
    journees: [{ jour: '2026-09-03', type: 'familiarisation', minutes_reelles: 240 }]
  });
  egal(r.prorata.joursCouverts, 0, 'aucun jour mensualisé');
  egal(r.salaireBrutProrataCentimes, 0, 'brut mensualisé');
  egal(r.salaireNetProrataCentimes, 0, 'net mensualisé');
  egal(r.joursPresence, 0, 'aucun jour de présence mensualisée');
  egal(r.totalAVerserCentimes,
    Engine.montantCentimes(NET, 240) + 550, 'à verser : les heures et un entretien');
});

/* ------------------------------------------------------------------ */
/* A5 — l'entretien du jour                                            */
/* ------------------------------------------------------------------ */

test('A5 — « oui » paie le montant PLEIN, jamais un prorata des heures', function () {
  var r = calculer({
    periodes: PERIODE_1_19,
    journees: [{ jour: '2026-09-01', type: 'familiarisation', minutes_reelles: 60 }]
  });
  egal(r.familiarisation.joursAvecEntretien, 1, 'un jour avec entretien');
  egal(r.familiarisation.entretienCentimes, 550,
    'le montant plein, pas 1/9e pour une heure de garde');
});

test('A5 bis — « non » paie zéro, et ne touche à rien d’autre', function () {
  var avec = calculer({
    periodes: PERIODE_1_19,
    journees: [{ jour: '2026-09-01', type: 'familiarisation', minutes_reelles: 150 }]
  });
  var sans = calculer({
    periodes: PERIODE_1_19,
    journees: [{ jour: '2026-09-01', type: 'familiarisation',
                 minutes_reelles: 150, entretien_du: false }]
  });
  egal(sans.familiarisation.entretienCentimes, 0, 'entretien retiré');
  egal(sans.familiarisation.joursAvecEntretien, 0, 'aucun jour avec entretien');
  egal(sans.joursSansEntretien, 1, 'le jour est compté, pour que le document le dise');
  egal(sans.familiarisation.brutCentimes, avec.familiarisation.brutCentimes,
    'la rémunération du jour ne bouge pas');
  egal(sans.familiarisation.minutesDeclarees, avec.familiarisation.minutesDeclarees,
    'les minutes ne bougent pas');
  egal(avec.totalAVerserCentimes - sans.totalAVerserCentimes, 550,
    'seul l’entretien disparaît du total');
});

test('A5 ter — un jour sans déclaration ne paie RIEN, entretien compris', function () {
  var r = calculer({ periodes: PERIODE_1_19, journees: [] });
  egal(r.familiarisation.joursDeLaPeriode, 14, 'les jours de la période sont vus');
  egal(r.familiarisation.joursDeclares, 0, 'aucun jour déclaré');
  egal(r.familiarisation.minutesDeclarees, 0, 'aucune minute');
  egal(r.familiarisation.entretienCentimes, 0, 'aucun entretien');
  egal(r.familiarisation.brutCentimes, 0, 'aucun brut');
  egal(r.joursPresence, 8, 'les jours de la période ne sont PAS présumés présents');
});

test('A5 quater — zéro minute déclarée n’est pas une déclaration', function () {
  var r = calculer({
    periodes: PERIODE_1_19,
    journees: [{ jour: '2026-09-01', type: 'familiarisation', minutes_reelles: 0 }]
  });
  egal(r.familiarisation.joursDeclares, 0, 'jours déclarés');
  egal(r.familiarisation.entretienCentimes, 0, 'pas d’entretien sur un jour à zéro minute');
});

/* ------------------------------------------------------------------ */
/* A6 — l'acquisition des congés payés                                 */
/* ------------------------------------------------------------------ */

test('A6 — un mois avec familiarisation acquiert ses 2,5 jours', function () {
  var r = calculer({
    periodes: [{ date_debut: '2026-09-01', date_fin: '2026-09-11' }],
    journees: [{ jour: '2026-09-01', type: 'familiarisation', minutes_reelles: 150 }]
  });
  egal(r.minutesCpAcquis, Engine.minutesCpParMois(conditions()), 'CP acquis');
  egal(r.minutesCpAcquis, 1350, 'CP acquis en minutes (2,5 × 540)');
});

test('A6 bis — un mois ENTIÈREMENT en familiarisation acquiert aussi', function () {
  var r = calculer({ periodes: [{ date_debut: '2026-09-01', date_fin: '2026-09-30' }] });
  egal(r.minutesCpAcquis, 1350, 'CP acquis');
});

test('A6 ter — mais un congé, lui, prive toujours de l’acquisition', function () {
  var r = calculer({
    periodes: [{ date_debut: '2026-09-01', date_fin: '2026-09-11' }],
    journees: [{ jour: '2026-09-21', type: 'conge_maria' }]
  });
  egal(r.minutesCpAcquis, 0, 'CP acquis : le terme retiré est le SEUL retiré');
});

test('A6 quater — et un contrat ouvert en cours de mois n’acquiert toujours pas', function () {
  var r = Engine.calculerMois({
    contrat: { id: 'c1', date_debut: '2026-09-01', date_fin: null },
    conditions: conditions(),
    journees: [],
    compteurEntree: { minutesSup: 0, minutesCpAcquis: 0, minutesCpPris: 0 },
    annee: 2026, mois: 9,
    periodesFamiliarisation: [{ date_debut: '2026-09-01', date_fin: '2026-09-11' }]
  });
  egal(r.minutesCpAcquis, 1350, 'ouvert le 1er : le contrat couvre le mois, il acquiert');
  var tard = Engine.calculerMois({
    contrat: { id: 'c1', date_debut: '2026-09-07', date_fin: null },
    conditions: conditions(),
    journees: [],
    compteurEntree: { minutesSup: 0, minutesCpAcquis: 0, minutesCpPris: 0 },
    annee: 2026, mois: 9,
    periodesFamiliarisation: [{ date_debut: '2026-09-07', date_fin: '2026-09-18' }]
  });
  egal(tard.minutesCpAcquis, 0,
    'ouvert le 7 : rien, et pour une autre raison que la familiarisation');
});

/* ------------------------------------------------------------------ */
/* A7 — aucune minute supplémentaire pendant la période                */
/* ------------------------------------------------------------------ */

test('A7 — aucune minute supplémentaire n’est acquise ni due pendant la période', function () {
  var r = calculer({
    periodes: [{ date_debut: '2026-09-01', date_fin: '2026-09-30' }],
    journees: [
      { jour: '2026-09-01', type: 'familiarisation', minutes_reelles: 540 },
      /* Même une journée qui porterait des minutes exceptionnelles ou un
         écart d'horaire saisis par erreur : la période les ignore. */
      { jour: '2026-09-02', type: 'presence', minutes_sup_exceptionnelles: 60 },
      { jour: '2026-09-03', type: 'presence', ecart_minutes: 45,
        ecart_evenement: 'retard_parent' }
    ]
  });
  egal(r.minutesSupAcquises, 0, 'minutes acquises');
  egal(r.minutesSupBase, 0, 'base');
  egal(r.minutesSupAjoutees, 0, 'ajoutées');
  egal(r.minutesEcartRecuperation, 0, 'écart imputé à la récupération');
  egal(r.ecartsDeclares.length, 0, 'aucun écart déclaré');
  egal(r.compteurSortie.minutesSup, 0, 'compteur de sortie');
});

/* ------------------------------------------------------------------ */
/* La période prime sur la ligne, et le dit                            */
/* ------------------------------------------------------------------ */

test('§20.4 — un jour de la période qui portait une autre saisie est NOMMÉ', function () {
  var r = calculer({
    periodes: PERIODE_1_19,
    journees: [
      { jour: '2026-09-02', type: 'conge_maria' },
      { jour: '2026-09-03', type: 'absence_enfant' },
      { jour: '2026-09-04', type: 'familiarisation', minutes_reelles: 150 }
    ]
  });
  egal(r.familiarisation.joursIgnores.join(','), '2026-09-02,2026-09-03',
    'les jours dont la saisie a été écartée');
  egal(r.joursCongesDecomptes, 0, 'le congé posé dans la période n’est pas décompté');
  egal(r.minutesCpAcquis, 1350, 'et il ne prive donc pas de l’acquisition');
});

test('§20.4 — hors de toute période, une journée `familiarisation` garde son ancien sort', function () {
  var r = calculer({
    periodes: [],
    journees: [{ jour: '2026-09-02', type: 'familiarisation', entretien_centimes: 300 }]
  });
  egal(r.familiarisation.actif, false, 'aucune période active');
  egal(r.entretienCentimes, 21 * 550 + 300, 'l’entretien saisi à la main est conservé');
  egal(r.joursPresence, 21, 'la journée n’est pas une présence');
});

/* ------------------------------------------------------------------ */
/* §20.6 — l'entretien retirable, hors du cadre                        */
/* ------------------------------------------------------------------ */

test('§20.6 A2 — retirer l’entretien ne change ni le salaire du jour ni les minutes', function () {
  var journee = { jour: '2026-09-17', type: 'presence', ecart_minutes: -90,
                  ecart_evenement: 'liberation_anticipee', ecart_impute_sur: 'recuperation' };
  var avec = calculer({ journees: [journee] });
  var copie = {};
  for (var k in journee) copie[k] = journee[k];
  copie.entretien_du = false;
  var sans = calculer({ journees: [copie] });

  egal(sans.joursPresence, avec.joursPresence, 'la journée reste comptée présente');
  egal(sans.minutesSupAcquises, avec.minutesSupAcquises, 'les minutes ne bougent pas');
  egal(sans.salaireNetProrataCentimes, avec.salaireNetProrataCentimes, 'le salaire ne bouge pas');
  egal(avec.entretienCentimes - sans.entretienCentimes, 550, 'seul l’entretien saute');
  egal(sans.joursSansEntretien, 1, 'et le mois sait combien de jours en sont privés');
});

test('§20.6 A3 — le total d’entretien du document se reconstitue', function () {
  var r = calculer({
    journees: [{ jour: '2026-09-17', type: 'presence', ecart_minutes: -90,
                 ecart_evenement: 'liberation_anticipee', ecart_impute_sur: 'recuperation',
                 entretien_du: false }]
  });
  /* « 21 jours × 5,50 € + 1 jour sans indemnité — 115,50 € » : le détail que
     le document affiche doit redonner le total, sinon la règle existante
     l'efface et Maria perd l'explication. */
  egal(r.joursPresence, 22, 'jours de présence');
  egal(r.joursSansEntretien, 1, 'jours sans indemnité');
  egal((r.joursPresence - r.joursSansEntretien) * 550, r.entretienCentimes,
    'le détail reconstitue le total');
});

test('§20.6 — `entretien_du` absent ou vrai ne change rien du tout', function () {
  var nu = calculer({ journees: [{ jour: '2026-09-17', type: 'presence' }] });
  var vrai = calculer({
    journees: [{ jour: '2026-09-17', type: 'presence', entretien_du: true }]
  });
  egal(nu.entretienCentimes, 22 * 550, 'sans la colonne');
  egal(vrai.entretienCentimes, 22 * 550, 'avec la colonne à vrai');
  egal(nu.joursSansEntretien, 0, 'aucun jour privé');
});

/* ------------------------------------------------------------------ */
/* L'assiette du 1/80e (§17.8) et la familiarisation                   */
/* ------------------------------------------------------------------ */

test('§17.8 — la rémunération horaire entre dans le brut dû du mois', function () {
  var r = calculer({
    periodes: PERIODE_1_19,
    journees: [{ jour: '2026-09-01', type: 'familiarisation', minutes_reelles: 1350 }]
  });
  egal(r.brutDuCentimes,
    Math.round(BRUT * 8 / 22) + Engine.montantCentimes(BRUT, 1350),
    'brut dû du mois');
});

module.exports = { cas: cas };
