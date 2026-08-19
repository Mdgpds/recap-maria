/* ============================================================================
   lot17-temps.test.js — Les règles NOUVELLES du lot 17.

   Le différentiel (`lot17-differentiel.test.js`) prouve que rien n'a bougé.
   Ce fichier prouve ce qui a bougé exprès, et il suit les critères
   d'acceptation de la spécification, un par un :

     §17.5 — les écarts d'horaire au jour (A1 à A5)
     §17.6 — les congés à l'heure (A1 à A3)
     §17.7 — le prorata du premier et du dernier mois
     §17.8 — l'indemnité de rupture
   ========================================================================= */
'use strict';

var Engine = require('../js/engine.js');

var cas = [];
function definir(nom, fn) { cas.push({ nom: nom, fn: fn }); }
function egal(obtenu, attendu, libelle) {
  if (obtenu !== attendu) {
    throw new Error(libelle + ' : attendu ' + JSON.stringify(attendu) +
      ', obtenu ' + JSON.stringify(obtenu));
  }
}
function vrai(cond, libelle) { if (!cond) throw new Error(libelle); }

/* Conditions de référence : accueil 8h30 → 17h30, 30 minutes après. La
   référence d'une journée est donc 18h00 (§17.5). */
var CONDITIONS = {
  date_effet: '2020-01-01', numero: 1, reconstitue: true,
  jours_planning: [1, 2, 3, 4, 5],
  heure_arrivee: '08:30', heure_depart: '17:30',
  minutes_contractuelles: 540,
  minutes_sup_jour: 30,
  minutes_par_jour_conge: 540,
  entretien_centimes_jour: 500,
  sup_dues_si_enfant_absent: true,
  ordre_imputation: 'cp_puis_sup',
  brut_mensuel_centimes: 137289,
  net_mensuel_centimes: 107200
};
var CONTRAT = { id: 'c1', date_debut: '2024-09-01', date_fin: null };

function conditions(surcharges) {
  var c = {}, k;
  for (k in CONDITIONS) c[k] = CONDITIONS[k];
  for (k in (surcharges || {})) c[k] = surcharges[k];
  return c;
}

/* Septembre 2025 : 22 jours du lundi au vendredi, aucun férié. */
function moisNu(journees, compteurEntree, surchargesConditions, contrat) {
  return Engine.calculerMois({
    contrat: contrat || CONTRAT,
    conditions: conditions(surchargesConditions),
    journees: journees || [],
    compteurEntree: compteurEntree || {},
    annee: 2025, mois: 9
  });
}

/* ------------------------------------------------------------------ */
/* §17.5 — les écarts d'horaire au jour                                */
/* ------------------------------------------------------------------ */

definir('§17.5 A1 — un départ à 18h01 ajoute 1 minute aux 30 du jour', function () {
  var journee = { jour: '2025-09-02', type: 'presence', ecart_minutes: 1 };
  egal(Engine.minutesSupDuJour(journee, conditions()), 31, 'A1.minutes du jour');

  var r = moisNu([journee]);
  /* 22 jours × 30 minutes, plus la minute de retard. */
  egal(r.minutesSupBase, 22 * 30, 'A1.base du mois');
  egal(r.minutesEcartRecuperation, 1, 'A1.écart du mois');
  egal(r.minutesSupAcquises, 22 * 30 + 1, 'A1.acquises du mois');
});

definir('§17.5 A2 — une libération à 17h retire 30 minutes du cumul du mois', function () {
  /* Référence 18h00, départ réel 17h00 : écart − 60. La journée vaut donc
     30 − 60 = − 30 minutes, et le cumul du mois perd 30 minutes. */
  var journee = { jour: '2025-09-02', type: 'presence', ecart_minutes: -60 };
  egal(Engine.minutesSupDuJour(journee, conditions()), -30, 'A2.minutes du jour');

  var r = moisNu([journee]);
  egal(r.minutesSupAcquises, 22 * 30 - 60, 'A2.acquises du mois');
  var sansEcart = moisNu([]);
  egal(sansEcart.minutesSupAcquises - r.minutesSupAcquises, 60,
    'A2.la libération retire bien 60 minutes au cumul');
});

definir('§17.5 A3 — un départ anticipé NON déclaré ne change rien', function () {
  /* Maria était disponible : ses 30 minutes restent dues. L'application ne
     devine rien, et l'absence de déclaration n'est pas un événement. */
  var r = moisNu([{ jour: '2025-09-02', type: 'presence' }]);
  var temoin = moisNu([]);
  egal(r.minutesSupAcquises, temoin.minutesSupAcquises, 'A3.cumul inchangé');
  egal(r.ecartsDeclares.length, 0, 'A3.aucun écart déclaré');
});

definir('§17.5 A4 — le compteur peut devenir négatif, et le moteur le dit', function () {
  /* Un mois presque entièrement rendu : cinq libérations d'une heure et demie
     sur un compteur d'entrée vide. */
  var journees = [];
  for (var k = 1; k <= 5; k++) {
    journees.push({ jour: '2025-09-0' + k, type: 'presence', ecart_minutes: -600 });
  }
  var r = moisNu(journees, { minutesSup: 0, minutesCpAcquis: 0, minutesCpPris: 0 });
  vrai(r.compteurSortie.minutesSup < 0,
    '§17.5 A4 : le compteur reste positif (' + r.compteurSortie.minutesSup + ')');
  egal(r.minutesEcartRecuperation, -3000, 'A4.écart cumulé');
  egal(r.compteurSortie.minutesSup, 22 * 30 - 3000, 'A4.compteur de sortie');
});

definir('§17.5 — un compteur négatif interdit de poser un congé dessus', function () {
  /* Le même garde-fou qu'au §16.1 : `imputerConges` borne le disponible à 0,
     et refuse une ventilation imposée qui dépasse. */
  var libre = Engine.imputerConges(2, { minutesSup: -540, minutesCp: 0 }, conditions());
  egal(libre.joursSurSup, 0, 'aucun jour pris sur un compteur négatif');
  egal(libre.joursSansSolde, 2, 'les deux jours partent en sans solde');

  var refus = null;
  try {
    Engine.imputerConges(1, { minutesSup: -540, minutesCp: 0 }, conditions(),
      { joursSurCp: 0, joursSurSup: 1, joursSansSolde: 0 });
  } catch (e) { refus = e.code; }
  egal(refus, 'IMPUTATION_DEPASSE_RESERVES', 'la ventilation imposée est refusée');
});

definir('§17.5 A5 — le document reçoit le net ET la ligne qui l’explique', function () {
  var r = moisNu([
    { jour: '2025-09-02', type: 'presence', ecart_minutes: -90 },
    { jour: '2025-09-04', type: 'presence', ecart_minutes: 15 }
  ]);
  egal(r.minutesSupAcquises, 22 * 30 - 90 + 15, 'A5.total net');
  egal(r.ecartsDeclares.length, 2, 'A5.deux lignes d’explication');
  egal(r.ecartsDeclares[0].jour, '2025-09-02', 'A5.la ligne nomme la journée');
  egal(r.ecartsDeclares[0].minutes, -90, 'A5.la ligne porte les minutes');
  egal(r.ecartsDeclares[0].imputeSur, 'recuperation', 'A5.la ligne dit la destination');
  egal(r.ecartsDeclares[1].minutes, 15, 'A5.un retard est aussi une ligne');
});

definir('§17.5 — RG-04 prime : une journée sans travail n’a pas d’écart', function () {
  ['ferie', 'conge_maria', 'sans_solde', 'familiarisation', 'hors_planning']
    .forEach(function (type) {
      var d = Engine.detailSupDuJour(
        { jour: '2025-09-02', type: type, ecart_minutes: -120 }, conditions());
      egal(d.ecart, 0, 'RG-04 ' + type + ' : écart ignoré');
      egal(d.ecartSurRecuperation, 0, 'RG-04 ' + type + ' : rien au compteur');
      egal(d.minutesSurCp, 0, 'RG-04 ' + type + ' : rien sur les congés payés');
    });
});

definir('§17.5 — un écart illisible est refusé, jamais replié sur zéro', function () {
  ['30', 30.5, NaN, {}, true].forEach(function (v) {
    var code = null;
    try {
      Engine.minutesSupDuJour({ type: 'presence', ecart_minutes: v }, conditions());
    } catch (e) { code = e.code; }
    egal(code, 'MINUTES_INVALIDES', 'écart illisible « ' + String(v) + ' »');
  });
  var inconnue = null;
  try {
    Engine.minutesSupDuJour({ type: 'presence', ecart_minutes: -30,
      ecart_impute_sur: 'ailleurs' }, conditions());
  } catch (e) { inconnue = e.code; }
  egal(inconnue, 'ECART_DESTINATION_INCONNUE', 'destination inconnue refusée');
});

definir('§17.5 — la référence d’une journée est la fin d’accueil PLUS les minutes sup', function () {
  egal(Engine.heureDeReference(conditions()), 18 * 60, '17h30 + 30 min = 18h00');
  /* Un avenant qui déplace les horaires déplace la référence — et rien
     d'autre : les mois d'avant gardent la leur. */
  egal(Engine.heureDeReference(conditions({ heure_depart: '17:00' })), 17 * 60 + 30,
    'fin d’accueil à 17h00');
  egal(Engine.heureDeReference(conditions({ minutes_sup_jour: 0 })), 17 * 60 + 30,
    'aucune minute supplémentaire');
});

definir('§17.5 — les trois lignes du tableau de la spécification', function () {
  var c = conditions();
  /* « Un parent est venu en retard | départ 18h01 | 30 + 1 = + 31 min » */
  egal(Engine.ecartDepuisHeureReelle(c, 'retard_parent', '18:01'), 1, 'retard : écart');
  egal(Engine.minutesSupDuJour({ type: 'presence', ecart_minutes: 1 }, c), 31,
    'retard : minutes du jour');

  /* « J’ai libéré plus tôt | départ 17h00 | 30 − 60 = − 30 min » */
  egal(Engine.ecartDepuisHeureReelle(c, 'liberation_anticipee', '17:00'), -60,
    'libération : écart');
  egal(Engine.minutesSupDuJour({ type: 'presence', ecart_minutes: -60 }, c), -30,
    'libération : minutes du jour');

  /* « J’ai demandé qu’on m’amène l’enfant plus tard | arrivée 9h00 | 30 − 30 = 0 » */
  egal(Engine.ecartDepuisHeureReelle(c, 'arrivee_decalee', '09:00'), -30,
    'arrivée décalée : écart');
  egal(Engine.minutesSupDuJour({ type: 'presence', ecart_minutes: -30 }, c), 0,
    'arrivée décalée : minutes du jour');
});

definir('§17.5 — le signe est calculé, jamais saisi', function () {
  var c = conditions();
  vrai(Engine.ecartDepuisHeureReelle(c, 'liberation_anticipee', '17:00') < 0,
    'une libération anticipée ne peut pas être positive');
  vrai(Engine.ecartDepuisHeureReelle(c, 'retard_parent', '18:30') > 0,
    'un retard ne peut pas être négatif');
  vrai(Engine.ecartDepuisHeureReelle(c, 'arrivee_decalee', '09:30') < 0,
    'une arrivée décalée ne peut pas être positive');

  ['08:60', '25:00', '8:30', '', null, 'midi'].forEach(function (h) {
    var code = null;
    try { Engine.ecartDepuisHeureReelle(c, 'retard_parent', h); } catch (e) { code = e.code; }
    egal(code, 'HEURE_INVALIDE', 'heure illisible « ' + String(h) + ' »');
  });
  var inconnu = null;
  try { Engine.ecartDepuisHeureReelle(c, 'depart_anticipe_du_parent', '17:00'); }
  catch (e) { inconnu = e.code; }
  egal(inconnu, 'ECART_EVENEMENT_INCONNU',
    'un départ anticipé du parent n’est pas un événement déclarable');
});

/* ------------------------------------------------------------------ */
/* §17.6 — les congés à l'heure                                        */
/* ------------------------------------------------------------------ */

definir('§17.6 A1 — 15 min, 1 h 30 et 1 h 45 se déduisent sans aucun arrondi', function () {
  [15, 90, 105].forEach(function (m) {
    /* Sur la récupération. */
    var surRecup = moisNu([{ jour: '2025-09-02', type: 'presence', ecart_minutes: -m }],
      { minutesSup: 10000, minutesCpAcquis: 0, minutesCpPris: 0 });
    egal(surRecup.minutesEcartRecuperation, -m, m + ' min sur la récupération');

    /* Sur les congés payés. */
    var surCp = moisNu([{ jour: '2025-09-02', type: 'presence',
      ecart_minutes: -m, ecart_impute_sur: 'conges_payes' }],
      { minutesSup: 0, minutesCpAcquis: 10 * 540, minutesCpPris: 0 });
    egal(surCp.minutesEcartSurCp, m, m + ' min sur les congés payés');
    egal(surCp.compteurSortie.minutesCpPris, m, m + ' min au compteur, exactes');
    /* Et la récupération n'a rien perdu. */
    egal(surCp.minutesEcartRecuperation, 0, m + ' min : la récupération est intacte');

    /* Sans solde : une retenue, aucun compteur touché. */
    var sansSolde = moisNu([{ jour: '2025-09-02', type: 'presence',
      ecart_minutes: -m, ecart_impute_sur: 'sans_solde' }]);
    egal(sansSolde.minutesEcartSansSolde, m, m + ' min sans solde');
    egal(sansSolde.retenueSansSoldeCentimes,
      Engine.montantCentimes(137289, m), m + ' min : retenue au taux du contrat');
    egal(sansSolde.minutesEcartSurCp, 0, m + ' min : les congés payés sont intacts');
  });
});

definir('§17.6 — la récupération vide passe en négatif, ce n’est pas un cas à part', function () {
  var r = moisNu([{ jour: '2025-09-02', type: 'presence', ecart_minutes: -90 }],
    { minutesSup: 0, minutesCpAcquis: 0, minutesCpPris: 0 });
  /* Le mois acquiert 22 × 30 = 660 minutes ; l'écart en retire 90. */
  egal(r.compteurSortie.minutesSup, 660 - 90, 'compteur de sortie');
  /* Sans aucune journée de garde le compteur passerait sous zéro : c'est le
     cas d'un mois entièrement en congé, vérifié ici sur le mois d'un contrat
     dont le planning ne compte qu'un jour. */
  var creux = Engine.calculerMois({
    contrat: CONTRAT, conditions: conditions({ jours_planning: [1], minutes_sup_jour: 0 }),
    journees: [{ jour: '2025-09-01', type: 'presence', ecart_minutes: -90 }],
    compteurEntree: { minutesSup: 0, minutesCpAcquis: 0, minutesCpPris: 0 },
    annee: 2025, mois: 9
  });
  egal(creux.compteurSortie.minutesSup, -90, '« je le devrai » : le compteur est négatif');
});

definir('§17.6 A3 — RG-06 produit les mêmes décomptes qu’avant', function () {
  /* La règle des jours ouvrables n'est pas touchée par le changement d'unité :
     une semaine complète vaut toujours 6 jours, soit 6 × 540 minutes. */
  egal(Engine.decompterJoursOuvrables('2025-09-01', '2025-09-05'), 6, 'semaine complète');
  egal(Engine.decompterJoursOuvrables('2025-09-01', '2025-09-03'), 3, 'lundi → mercredi');
  egal(Engine.decompterJoursOuvrables('2025-05-26', '2025-05-30'), 5, 'semaine avec férié');

  var r = Engine.imputerConges(6, { minutesSup: 0, minutesCp: 10 * 540 }, conditions());
  egal(r.joursSurCp, 6, 'six jours pris');
  egal(r.minutesCpConsommees, 6 * 540, 'six jours × 540 minutes');
});

definir('§17.6 — un reliquat inférieur à un jour reste acquis', function () {
  /* Même règle qu'en dixièmes : un jour de congé consomme un jour entier, un
     reliquat plus petit ne couvre jamais un jour partiel. */
  var r = Engine.imputerConges(3, { minutesSup: 0, minutesCp: 2 * 540 + 90 }, conditions());
  egal(r.joursSurCp, 2, 'deux jours seulement');
  egal(r.minutesCpConsommees, 2 * 540, 'le reliquat de 90 minutes reste acquis');
  egal(r.joursSansSolde, 1, 'le troisième jour part en sans solde');
});

definir('§17.6 — l’acquisition mensuelle suit le facteur de conversion', function () {
  egal(Engine.minutesCpParMois({ minutes_par_jour_conge: 540 }), 1350, '2,5 j × 540 min');
  egal(Engine.minutesCpParMois({ minutes_par_jour_conge: 480 }), 1200, '2,5 j × 480 min');
  var r = moisNu([]);
  egal(r.minutesCpAcquis, 1350, 'un mois entièrement travaillé acquiert 2,5 jours');
  egal(r.compteurSortie.minutesCpAcquis, 1350, 'et le compteur de sortie le porte');
});

/* ------------------------------------------------------------------ */
/* §17.7 — le prorata                                                  */
/* ------------------------------------------------------------------ */

definir('§17.7 — les journées ne changent pas, seul le salaire est proratisé', function () {
  var partiel = Engine.calculerMois({
    contrat: { id: 'c1', date_debut: '2025-09-15', date_fin: null },
    conditions: conditions(), journees: [],
    compteurEntree: {}, annee: 2025, mois: 9
  });
  /* Septembre 2025 : 22 jours du lundi au vendredi, dont 12 à partir du 15. */
  egal(partiel.prorata.joursDuMois, 22, 'jours du mois');
  egal(partiel.prorata.joursCouverts, 12, 'jours couverts');
  egal(partiel.joursPresence, 12, 'les journées étaient DÉJÀ bornées');
  egal(partiel.salaireBrutCentimes, 137289, 'le brut contractuel ne change pas');
  egal(partiel.salaireBrutProrataCentimes, Math.round(137289 * 12 / 22), 'brut proratisé');
  egal(partiel.salaireNetProrataCentimes, Math.round(107200 * 12 / 22), 'net proratisé');
  egal(partiel.totalAVerserCentimes,
    Math.round(107200 * 12 / 22) + partiel.entretienCentimes, 'total à verser');
});

definir('§17.7 — le taux horaire n’est JAMAIS proratisé', function () {
  /* Sinon une heure supplémentaire vaudrait moins cher au premier mois d'un
     contrat qu'au deuxième, sur la même journée de travail. */
  var partiel = Engine.calculerMois({
    contrat: { id: 'c1', date_debut: '2025-09-15', date_fin: null },
    conditions: conditions(),
    journees: [{ jour: '2025-09-16', type: 'sans_solde' }],
    compteurEntree: {}, annee: 2025, mois: 9
  });
  egal(partiel.retenueSansSoldeCentimes, Engine.montantCentimes(137289, 540),
    'la retenue d’un jour sans solde est au taux plein');
});

definir('§17.7 — un férié couvert compte comme couvert', function () {
  /* Le 1er mai 2025 est un jeudi férié. Un contrat ouvert le 1er mai couvre
     22 − 2 = 20 des 22 jours du planning de mai (les jeudis 1er et vendredi 2
     inclus ; seuls les 2 jours antérieurs manquent). Un férié est chômé ET
     PAYÉ : il fait partie du mois dû. */
  var part = Engine.partCouverteDuMois(
    { date_debut: '2025-05-01', date_fin: null }, [1, 2, 3, 4, 5], 2025, 5);
  egal(part.joursDuMois, 22, 'jours du planning en mai 2025');
  egal(part.joursCouverts, 22, 'le mois entier est couvert dès le 1er');
});

/* ------------------------------------------------------------------ */
/* §17.8 — l'indemnité de rupture                                      */
/* ------------------------------------------------------------------ */

definir('§17.8 — le brut réellement dû du mois entre dans l’instantané', function () {
  var plein = moisNu([]);
  egal(plein.brutDuCentimes, 137289, 'mois plein : le brut contractuel');

  var avecSansSolde = moisNu([{ jour: '2025-09-02', type: 'sans_solde' }]);
  egal(avecSansSolde.brutDuCentimes,
    137289 - Engine.montantCentimes(137289, 540),
    'le sans solde est retiré du brut dû');

  var partiel = Engine.calculerMois({
    contrat: { id: 'c1', date_debut: '2025-09-15', date_fin: null },
    conditions: conditions(), journees: [], compteurEntree: {}, annee: 2025, mois: 9
  });
  egal(partiel.brutDuCentimes, Math.round(137289 * 12 / 22),
    'le prorata est retiré du brut dû');
});

definir('§17.8 — l’ancienneté se compte au jour près', function () {
  egal(Engine.ancienneteEnMois('2023-09-04', '2026-12-31'), 39, '3 ans 3 mois');
  egal(Engine.ancienneteEnMois('2026-01-04', '2026-10-03'), 8, 'huit mois révolus');
  egal(Engine.ancienneteEnMois('2026-01-04', '2026-10-04'), 9, 'neuf mois révolus');
});

definir('§17.8 — en dessous de neuf mois, aucune indemnité, et le motif est dit', function () {
  var r = Engine.indemniteRupture({
    date_debut: '2026-01-04', date_fin: '2026-10-03',
    moisBruts: [{ cle: '2026-01', brutDuCentimes: 200000 }]
  });
  egal(r.due, false, 'aucune indemnité');
  egal(r.motif, 'ANCIENNETE_INSUFFISANTE', 'le motif est nommé');
  egal(r.ancienneteMois, 8, 'l’ancienneté est dite');
  egal(r.indemniteCentimes, 0, 'zéro');
});

definir('§17.8 — 1/80ᵉ du total des bruts, entretien exclu', function () {
  /* Le total est celui de l'exemple de la spécification : 54 016,80 €. */
  var moisBruts = [];
  for (var k = 0; k < 39; k++) {
    moisBruts.push({ cle: 'm' + k, brutDuCentimes: 138504 });
  }
  var total = 39 * 138504;
  var r = Engine.indemniteRupture({
    date_debut: '2023-09-04', date_fin: '2026-12-31', moisBruts: moisBruts
  });
  egal(r.due, true, 'indemnité due');
  egal(r.ancienneteMois, 39, 'ancienneté');
  egal(r.totalBrutCentimes, total, 'total des bruts');
  egal(r.indemniteCentimes, Math.round(total / 80), '1/80ᵉ');
  egal(r.moisRetenus, 39, 'le nombre de mois retenus est dit');
});

definir('§17.8 — le moteur n’invente aucune assiette : il additionne ce qu’on lui donne', function () {
  /* Le point d'assiette non tranché — les indemnités de congés payés versées
     entrent-elles dans le total ? — se règle en amont. Le moteur ne doit pas
     le trancher tout seul, sinon changer d'avis obligerait à rouvrir le
     moteur, le seul fichier fermé du projet. */
  var sans = Engine.indemniteRupture({
    date_debut: '2023-09-04', date_fin: '2026-12-31',
    moisBruts: [{ brutDuCentimes: 100000 }]
  });
  var avec = Engine.indemniteRupture({
    date_debut: '2023-09-04', date_fin: '2026-12-31',
    moisBruts: [{ brutDuCentimes: 100000 }, { brutDuCentimes: 50000 }]
  });
  egal(sans.indemniteCentimes, 1250, 'assiette sans les indemnités');
  egal(avec.indemniteCentimes, 1875, 'assiette avec');
});

definir('§17.8 — sans dates, l’écran doit pouvoir dire pourquoi', function () {
  var r = Engine.indemniteRupture({ date_debut: '2023-09-04', date_fin: null, moisBruts: [] });
  egal(r.due, false, 'aucune indemnité');
  egal(r.motif, 'DATES_INCOMPLETES', 'le motif est nommé, pas un zéro muet');
});

/* ------------------------------------------------------------------ */
/* §17.3 — les conditions datées, côté sélection                       */
/* ------------------------------------------------------------------ */

definir('§17.3 — conditionsApplicables retient le dernier avenant en vigueur', function () {
  var avenants = [
    { numero: 1, date_effet: '2024-09-01', entretien_centimes_jour: 500 },
    { numero: 3, date_effet: '2026-11-01', entretien_centimes_jour: 600 },
    { numero: 2, date_effet: '2025-04-01', entretien_centimes_jour: 550 }
  ];
  egal(Engine.conditionsApplicables(avenants, 2024, 8), null, 'avant tout avenant');
  egal(Engine.conditionsApplicables(avenants, 2024, 9).numero, 1, 'le mois même');
  egal(Engine.conditionsApplicables(avenants, 2025, 3).numero, 1, 'octobre inchangé');
  egal(Engine.conditionsApplicables(avenants, 2025, 4).numero, 2, 'le mois d’effet');
  egal(Engine.conditionsApplicables(avenants, 2026, 10).numero, 2, 'octobre avant l’avenant 3');
  egal(Engine.conditionsApplicables(avenants, 2026, 11).numero, 3, 'novembre au nouveau tarif');
  egal(Engine.conditionsApplicables(avenants, 2030, 1).numero, 3, 'et ensuite');
});

definir('§17.10 cas 2 — un avenant au 1er novembre laisse octobre intact', function () {
  var avenants = [
    { date_effet: '2024-09-01', numero: 1, jours_planning: [1, 2, 3, 4, 5],
      minutes_sup_jour: 30, minutes_par_jour_conge: 540, entretien_centimes_jour: 500,
      sup_dues_si_enfant_absent: true, ordre_imputation: 'cp_puis_sup',
      heure_arrivee: '08:30', heure_depart: '17:30', minutes_contractuelles: 540,
      brut_mensuel_centimes: 137289, net_mensuel_centimes: 107200 },
    { date_effet: '2026-11-01', numero: 2, jours_planning: [1, 2, 3, 4, 5],
      minutes_sup_jour: 30, minutes_par_jour_conge: 540, entretien_centimes_jour: 600,
      sup_dues_si_enfant_absent: true, ordre_imputation: 'cp_puis_sup',
      heure_arrivee: '08:30', heure_depart: '17:30', minutes_contractuelles: 540,
      brut_mensuel_centimes: 150000, net_mensuel_centimes: 118000 }
  ];
  function mois(a, m) {
    return Engine.calculerMois({
      contrat: CONTRAT, conditions: Engine.conditionsApplicables(avenants, a, m),
      journees: [], compteurEntree: {}, annee: a, mois: m
    });
  }
  var octobre = mois(2026, 10);
  var novembre = mois(2026, 11);
  egal(octobre.salaireBrutCentimes, 137289, 'octobre à l’ancien tarif');
  egal(novembre.salaireBrutCentimes, 150000, 'novembre au nouveau');
  /* Octobre 2026 : 22 jours du lundi au vendredi. */
  egal(octobre.entretienCentimes, 22 * 500, 'entretien d’octobre');
  /* Novembre 2026 : 21 jours du lundi au vendredi, dont le 11 férié. */
  egal(novembre.entretienCentimes, 20 * 600, 'entretien de novembre');
});

/* ------------------------------------------------------------------ */
/* Les dettes du lot 16 rendues au moteur                              */
/* ------------------------------------------------------------------ */

definir('§16.8 — feriesDeLaPeriode nomme le 15 août, samedi férié', function () {
  var f = Engine.feriesDeLaPeriode('2026-08-03', '2026-08-21', [1, 2, 3, 4, 5]);
  egal(f.length, 1, 'un seul férié dans la période');
  egal(f[0], '2026-08-15', 'le samedi 15 août');
  /* Un dimanche férié ne compte jamais : il n'est pas décompté de toute
     façon, et l'annoncer comme une exception serait faux. */
  egal(Engine.feriesDeLaPeriode('2026-11-30', '2026-12-04', [1, 2, 3, 4, 5]).length, 0,
    'aucun férié début décembre');
  /* Le férié qui tombe sur le samedi de prolongation est vu, parce que la
     période court jusqu'à la veille de la reprise. */
  var prolonge = Engine.feriesDeLaPeriode('2026-08-10', '2026-08-14', [1, 2, 3, 4, 5]);
  egal(prolonge.length, 1, 'le samedi 15 est dans la prolongation');
  egal(prolonge[0], '2026-08-15', 'et c’est bien lui');
});

definir('§16.8 — joursOuvrablesParMois donne la part d’une période à cheval', function () {
  var t = Engine.joursOuvrablesParMois('2026-07-27', '2026-08-07', [1, 2, 3, 4, 5]);
  var total = t.reduce(function (n, x) { return n + x.jours; }, 0);
  egal(total, Engine.decompterJoursOuvrables('2026-07-27', '2026-08-07', [1, 2, 3, 4, 5]),
    'la somme des tranches vaut le décompte');
  egal(t.length, 2, 'deux mois touchés');
  egal(t[0].cle, '2026-07', 'juillet d’abord');
  egal(t[1].cle, '2026-08', 'puis août');
});

/* ------------------------------------------------------------------ */
/* CORRECTION C1 DE LA RELECTURE — LE TOTAL DE FIN DE CONTRAT           */
/* ------------------------------------------------------------------ */

definir('C1 — « À régler en plus du dernier mois » est calculé par le moteur', function () {
  var s = Engine.soldeFinContrat({
    brutMensuelCentimes: 137289,
    minutesSupSolde: 600,
    coefficient: 1.5,
    indemnite: { due: true, indemniteCentimes: 67521 }
  });
  egal(s.chiffrable, true, 'chiffrable');
  egal(s.minutesSupPayees, 600, 'les 600 minutes sont payées');
  egal(s.minutesDues, 0, 'rien n’est dû par Maria');
  egal(s.montantSupCentimes, Engine.montantCentimes(137289, 600, 1.5),
    'exactement RG-13, la formule du cas T6');
  egal(s.totalARegler, s.montantSupCentimes + 67521,
    'le total est la somme des deux postes, faite une seule fois');
});

definir('C1 — un solde d’heures négatif n’est pas déduit, il est signalé', function () {
  /* §17.5 laisse le compteur passer sous zéro ; ce qu'on en fait en fin de
     contrat est une question ouverte pour Maria. Déduire d'office
     trancherait à sa place, sur un chiffre qui part chez une famille. */
  var s = Engine.soldeFinContrat({
    brutMensuelCentimes: 137289,
    minutesSupSolde: -540,
    coefficient: 1.5,
    indemnite: { due: true, indemniteCentimes: 10000 }
  });
  egal(s.minutesSupPayees, 0, 'aucune heure payée');
  egal(s.montantSupCentimes, 0, 'aucun montant d’heures');
  egal(s.minutesDues, 540, 'la dette est rendue, pour que l’écran la DISE');
  egal(s.totalARegler, 10000, 'le total ne retranche rien');
});

definir('C1 — sans rémunération connue, rien n’est chiffré (et le zéro n’est pas rendu)', function () {
  var s = Engine.soldeFinContrat({
    brutMensuelCentimes: null, minutesSupSolde: 600, coefficient: 1.5,
    indemnite: { due: false, indemniteCentimes: 0 }
  });
  egal(s.chiffrable, false, 'non chiffrable');
  egal(s.montantSupCentimes, null, 'aucun montant inventé');
  egal(s.totalARegler, null, 'aucun total inventé — un zéro crédible serait pire');
});

definir('C1 — une indemnité non due n’entre pas dans le total', function () {
  var s = Engine.soldeFinContrat({
    brutMensuelCentimes: 137289, minutesSupSolde: 0, coefficient: 1.5,
    indemnite: { due: false, motif: 'ANCIENNETE_INSUFFISANTE', indemniteCentimes: 0 }
  });
  egal(s.indemniteCentimes, 0, 'aucune indemnité');
  egal(s.totalARegler, 0, 'total nul, et chiffrable');
});

definir('Remarque 4 — l’écart déclaré porte son ÉVÉNEMENT, pas seulement sa destination',
  function () {
    var r = Engine.calculerMois({
      contrat: { date_debut: '2026-01-01' },
      conditions: CONDITIONS,
      annee: 2026, mois: 6,
      journees: [{ jour: '2026-06-17', type: 'presence', ecart_minutes: -90,
                   ecart_evenement: 'liberation_anticipee',
                   ecart_impute_sur: 'recuperation' }],
      compteurEntree: { minutesSup: 0, minutesCpAcquis: 0, minutesCpPris: 0 }
    });
    egal(r.ecartsDeclares.length, 1, 'un écart déclaré');
    egal(r.ecartsDeclares[0].evenement, 'liberation_anticipee',
      'l’événement remonte jusqu’au document — une libération anticipée et une ' +
      'arrivée décalée ne doivent plus produire la même phrase');
    egal(r.ecartsDeclares[0].imputeSur, 'recuperation', 'la destination reste, elle aussi');
  });

module.exports = { cas: cas };
