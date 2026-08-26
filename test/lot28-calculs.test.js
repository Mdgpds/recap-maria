/* ============================================================================
   lot28-calculs.test.js — LES CALCULS RENDUS JUSTES (lot 28, §28.1 à §28.9).

   Chaque cas porte le numéro du critère des specs du 25 août 2026 qu'il
   vérifie. Écrits AVANT le code, ils échouaient tous sur le moteur figé
   `test/fixtures/engine-avant-lot28.js` — c'est vérifié positivement en bas de
   ce fichier, pour qu'un critère ne puisse pas être vert par accident.

   Valeurs FICTIVES (dépôt public) : aucun prénom, aucun salaire réel.
   ========================================================================= */
'use strict';

var Engine = require('../js/engine.js');
var Avant = require('./fixtures/engine-avant-lot28.js');
var Chaine = require('../js/chaine-mois.js');
var Feries = require('../js/feries.js');

var cas = [];
function test(nom, fn) { cas.push({ nom: nom, fn: fn }); }
function egal(obtenu, attendu, libelle) {
  if (obtenu !== attendu) {
    throw new Error(libelle + ' : attendu ' + JSON.stringify(attendu) +
      ', obtenu ' + JSON.stringify(obtenu));
  }
}
function leve(fn, code, libelle) {
  try { fn(); } catch (e) {
    egal(e.code, code, libelle + ' (code)');
    return;
  }
  throw new Error(libelle + ' : aucune erreur levée, ' + code + ' attendu');
}

/* ------------------------------------------------------------------ */
/* Le décor                                                            */
/* ------------------------------------------------------------------ */

var BRUT = 140400;   // 1 404,00 € : 195 h à 7,20 €
var NET = 110000;

function conditions(extra) {
  var c = {
    date_effet: '2025-01-01', numero: 1,
    jours_planning: [1, 2, 3, 4, 5],
    heure_arrivee: '08:30', heure_depart: '17:30',
    minutes_contractuelles: 540, minutes_sup_jour: 30,
    minutes_par_jour_conge: 540, entretien_centimes_jour: 550,
    sup_dues_si_enfant_absent: true, ordre_imputation: 'cp_puis_sup',
    brut_mensuel_centimes: BRUT, net_mensuel_centimes: NET
  };
  for (var k in (extra || {})) c[k] = extra[k];
  return c;
}

var CONTRAT = { id: 'c1', date_debut: '2025-01-01', date_fin: null };
var ZERO = { minutesSup: 0, minutesCpAcquis: 0, minutesCpPris: 0 };

/* Septembre 2025 : 22 jours du lundi au vendredi, aucun férié. */
function septembre(journees, compteur, extra) {
  var e = {
    contrat: CONTRAT, conditions: conditions(), journees: journees || [],
    compteurEntree: compteur || ZERO, annee: 2025, mois: 9
  };
  for (var k in (extra || {})) e[k] = extra[k];
  return e;
}
function calc(e) { return Engine.calculerMois(e); }

/* Tous les jours du planning d'un mois, avec un type. */
function tousLesJours(annee, mois, type) {
  return Engine.joursDuMois(annee, mois).filter(function (d) {
    return [1, 2, 3, 4, 5].indexOf(Engine.jourSemaine(d)) !== -1 && !Feries.estJourFerie(d);
  }).map(function (d) { return { jour: d, type: type }; });
}

function liberation(jour, minutes, destination) {
  return { jour: jour, type: 'presence', ecart_minutes: -minutes,
           ecart_evenement: 'liberation_anticipee', ecart_impute_sur: destination };
}

/* ------------------------------------------------------------------ */
/* §28.1 — l'acquisition des congés payés                              */
/* ------------------------------------------------------------------ */

test('§28.1 A1 — un mois de 22 jours avec 1 jour de congé acquiert 1 350 min (contre 0 avant)', function () {
  var e = septembre([{ jour: '2025-09-02', type: 'conge_maria' }]);
  egal(calc(e).minutesCpAcquis, 1350, 'après');
  egal(Avant.calculerMois(e).minutesCpAcquis, 0, 'avant — c’était « le plus grave »');
});

test('§28.1 A2 — un mois entièrement en congés payés acquiert 1 350 min', function () {
  var e = septembre(tousLesJours(2025, 9, 'conge_maria'),
    { minutesSup: 0, minutesCpAcquis: 30 * 540, minutesCpPris: 0 });
  var r = calc(e);
  egal(r.imputation.joursSurCp, 22, 'les 22 jours sont bien pris sur les congés payés');
  egal(r.minutesCpAcquis, 1350, 'et le mois acquiert quand même (L3141-5, premier alinéa)');
  egal(r.acquisitionCp.toutLeMoisSansSolde, false, 'ce n’est pas un mois sans solde');
});

test('§28.1 A3 — un mois entièrement en sans solde n’acquiert rien', function () {
  var r = calc(septembre(tousLesJours(2025, 9, 'sans_solde')));
  egal(r.minutesCpAcquis, 0, 'journées de type sans solde');
  egal(r.acquisitionCp.toutLeMoisSansSolde, true, 'et le moteur dit pourquoi');
  /* Même chose quand le sans solde vient d'un congé sans aucune réserve. */
  var r2 = calc(septembre(tousLesJours(2025, 9, 'conge_maria')));
  egal(r2.imputation.joursSansSolde, 22, 'tout le congé est parti en sans solde');
  egal(r2.minutesCpAcquis, 0, 'un congé intégralement sans solde n’acquiert rien');
});

test('§28.1 A4 — 3 jours sans solde et 19 travaillés : 1 350 min entières, jamais un prorata', function () {
  var r = calc(septembre([
    { jour: '2025-09-01', type: 'sans_solde' },
    { jour: '2025-09-02', type: 'sans_solde' },
    { jour: '2025-09-03', type: 'sans_solde' }
  ]));
  egal(r.minutesCpAcquis, 1350, 'L3141-4 : jamais « plus que proportionnel »');
  egal(r.retenueSansSoldeCentimes, Engine.montantCentimes(BRUT, 3 * 540), 'la retenue, elle, reste');
});

test('§28.1 A5 — le plafond annuel de 30 jours ouvrables s’applique', function () {
  var plafond = 30 * 540;
  egal(calc(septembre([], ZERO, { minutesCpAcquisesExercice: plafond - 1350 })).minutesCpAcquis,
    1350, 'le douzième mois passe entier');
  var r = calc(septembre([], ZERO, { minutesCpAcquisesExercice: plafond - 100 }));
  egal(r.minutesCpAcquis, 100, 'ce qui dépasse le plafond n’est pas acquis');
  egal(r.acquisitionCp.plafonne, true, 'et le moteur le dit');
  egal(calc(septembre([], ZERO, { minutesCpAcquisesExercice: plafond })).minutesCpAcquis,
    0, 'au plafond : plus rien');
  egal(Engine.PLAFOND_CP_JOURS_PAR_EXERCICE, 30, 'L3141-3');
});

test('§28.1 — le mois où le contrat commence acquiert au prorata, comme le salaire', function () {
  /* Contrat ouvert le mardi 16 septembre 2025 : 11 jours du planning sur 22. */
  var r = calc({
    contrat: { id: 'c1', date_debut: '2025-09-16', date_fin: null },
    conditions: conditions(), journees: [], compteurEntree: ZERO, annee: 2025, mois: 9
  });
  egal(r.acquisitionCp.joursCouverts, 11, '11 jours couverts');
  egal(r.acquisitionCp.joursDuMois, 22, 'sur 22');
  egal(r.minutesCpAcquis, 675, '1350 × 11 / 22, un seul arrondi');
  egal(r.prorata.joursCouverts, 11, 'le même quotient que le salaire (§17.7)');
  /* Le dernier mois, symétriquement : contrat clos le vendredi 12. */
  var fin = calc({
    contrat: { id: 'c1', date_debut: '2025-01-01', date_fin: '2025-09-12' },
    conditions: conditions(), journees: [], compteurEntree: ZERO, annee: 2025, mois: 9
  });
  egal(fin.minutesCpAcquis, Math.round(1350 * 10 / 22), '10 jours sur 22');
});

test('§28.1 — la familiarisation compte comme travaillée, un mois entier en période acquiert tout', function () {
  var r = calc(septembre([], ZERO, {
    periodesFamiliarisation: [{ date_debut: '2025-09-01', date_fin: '2025-09-30' }]
  }));
  egal(r.familiarisation.joursDeLaPeriode, 22, 'tout le mois est en période');
  egal(r.minutesCpAcquis, 1350, 'et il acquiert ses 2,5 jours');
  /* Ouvert le 8 avec une période : le prorata compte les jours de période. */
  var tard = calc({
    contrat: { id: 'c1', date_debut: '2025-09-08', date_fin: null },
    conditions: conditions(), journees: [], compteurEntree: ZERO, annee: 2025, mois: 9,
    periodesFamiliarisation: [{ date_debut: '2025-09-08', date_fin: '2025-09-19' }]
  });
  egal(tard.acquisitionCp.joursCouverts, 17, '17 jours couverts, familiarisation comprise');
  egal(tard.minutesCpAcquis, Math.round(1350 * 17 / 22), 'au prorata');
});

/* ------------------------------------------------------------------ */
/* §28.2 — les minutes quand l'enfant est absent                       */
/* ------------------------------------------------------------------ */

test('§28.2 A1 — journée d’absence de l’enfant, réglage non renseigné : 0 minute', function () {
  var c = conditions({ sup_dues_si_enfant_absent: null });
  egal(Engine.minutesSupDuJour({ type: 'absence_enfant' }, c), 0, 'rien');
  var d = Engine.detailSupDuJour({ type: 'absence_enfant' }, c);
  egal(d.base, 0, 'ni base');
  egal(d.ecart, 0, 'ni écart');
});

test('§28.2 A2 (exigence changée le 26 août) — même à « true », l’absence ne porte plus de minute', function () {
  /* Les specs du 25 août laissaient le réglage explicite à `true` faire les
     minutes dues. Décision d'Adrien du 26 août, en réponse à la question
     posée avant le développement : « si l'enfant est absent, pas de 30 min
     ni de frais d'entretien ». Le réglage reste en base, sans effet. */
  var c = conditions({ sup_dues_si_enfant_absent: true });
  egal(Engine.minutesSupDuJour({ type: 'absence_enfant' }, c), 0, 'réglage true : 0');
  egal(Engine.minutesSupDuJour({ type: 'absence_enfant', sup_dues_override: true }, c), 0,
    'surcharge true : 0');
  var r = calc(septembre([{ jour: '2025-09-03', type: 'absence_enfant' }]));
  egal(r.minutesSupBase, 21 * 30, '21 journées à 30 minutes, pas 22');
  egal(r.entretienCentimes, 21 * 550, 'et pas d’entretien ce jour-là (RG-09, inchangé)');
  egal(r.joursPresence, 21, 'la journée n’est pas une présence');
});

/* ------------------------------------------------------------------ */
/* §28.3 — les congés payés ne passent jamais sous zéro                */
/* ------------------------------------------------------------------ */

test('§28.3 A1 — un écart de 5 h sur un compteur de 2 h : 2 h sur les congés payés, 3 h sur la récupération', function () {
  var r = calc(septembre([liberation('2025-09-02', 300, 'conges_payes')],
    { minutesSup: 0, minutesCpAcquis: 120, minutesCpPris: 0 }));
  egal(r.minutesEcartSurCp, 120, '2 h prises sur les congés payés');
  egal(r.minutesEcartRecuperation, -180, '3 h rendues sur la récupération');
  egal(r.compteurSortie.minutesCpPris, 120, 'le compteur de congés payés s’arrête à zéro');
  egal(r.compteurSortie.minutesCpAcquis - r.compteurSortie.minutesCpPris, 1350,
    'solde de sortie : les 1 350 acquises ce mois, rien de négatif');
  egal(r.minutesSupAcquises, 22 * 30 - 180, 'les 3 h pèsent sur le mois');
  var e = r.ecartsDeclares[0];
  egal(e.minutesSurCp, 120, 'le détail du jour : 120 sur les congés payés');
  egal(e.minutesSurRecuperation, 180, 'et 180 sur la récupération');
  egal(e.imputeSur, 'conges_payes', 'la poche demandée reste nommée');
});

test('§28.3 A2 — les congés payés ne descendent sous zéro par aucun chemin', function () {
  /* Chemin 1 : l'écart. Compteur à 0, deux libérations de 5 h sur les CP. */
  var ecart = calc(septembre([
    liberation('2025-09-02', 300, 'conges_payes'), liberation('2025-09-03', 300, 'conges_payes')
  ], ZERO));
  egal(ecart.minutesEcartSurCp, 0, 'rien n’est pris sur des congés payés vides');
  egal(ecart.compteurSortie.minutesCpPris, 0, 'compteur : 0 pris');
  egal(ecart.minutesEcartRecuperation, -600, 'les 10 h vont à la récupération, qui peut être négative');
  egal(ecart.compteurSortie.minutesSup, 22 * 30 - 600, 'récupération : 60 min ce mois');
  /* Avant : − 600 minutes de congés payés, sans erreur ni signal. */
  var av = Avant.calculerMois(septembre([
    liberation('2025-09-02', 300, 'conges_payes'), liberation('2025-09-03', 300, 'conges_payes')
  ], ZERO));
  egal(av.compteurSortie.minutesCpPris - av.compteurSortie.minutesCpAcquis, 600 - 1350,
    'avant : 600 minutes prises sur zéro');
  egal(av.minutesEcartSurCp, 600, 'avant : les 10 h « sur les congés payés »');

  /* Chemin 2 : la pose. Une ventilation qui demande plus que le disponible
     est refusée — c'était déjà vrai, et ça le reste. */
  leve(function () {
    Engine.imputerConges(3, { minutesSup: 0, minutesCp: 540 }, conditions(),
      { joursSurCp: 3, joursSurSup: 0, joursSansSolde: 0 });
  }, 'IMPUTATION_DEPASSE_RESERVES', 'pose ventilée au-delà des réserves');
  var defaut = Engine.imputerConges(3, { minutesSup: 0, minutesCp: 540 }, conditions());
  egal(defaut.joursSurCp, 1, 'ordre par défaut : un seul jour couvert');
  egal(defaut.joursSansSolde, 2, 'le reste part en sans solde, jamais en négatif');
  var negatif = Engine.imputerConges(3, { minutesSup: 0, minutesCp: -500 }, conditions());
  egal(negatif.joursSurCp, 0, 'un compteur déjà négatif ne « rend » rien');
});

test('§28.3 A3 — deux écarts dans le même mois ne consomment pas deux fois le même disponible', function () {
  var r = calc(septembre([
    liberation('2025-09-02', 90, 'conges_payes'), liberation('2025-09-16', 90, 'conges_payes')
  ], { minutesSup: 0, minutesCpAcquis: 120, minutesCpPris: 0 }));
  egal(r.ecartsDeclares[0].minutesSurCp, 90, 'le premier prend 90');
  egal(r.ecartsDeclares[1].minutesSurCp, 30, 'le second n’a plus que 30');
  egal(r.ecartsDeclares[1].minutesSurRecuperation, 60, 'et rend 60 sur la récupération');
  egal(r.minutesEcartSurCp, 120, 'total sur les congés payés = le disponible, pas 180');
  /* Et un congé posé DANS le même mois se sert d'abord : la ventilation de
     Maria est validée contre les réserves avant les écarts. */
  var avecConge = calc(septembre([
    { jour: '2025-09-08', type: 'conge_maria' }, liberation('2025-09-16', 90, 'conges_payes')
  ], { minutesSup: 0, minutesCpAcquis: 600, minutesCpPris: 0 }));
  egal(avecConge.imputation.minutesCpConsommees, 540, 'le jour posé prend ses 540 minutes');
  egal(avecConge.minutesEcartSurCp, 60, 'l’écart n’a plus que 60');
  egal(avecConge.minutesEcartRecuperation, -30, 'et rend 30 sur la récupération');
});

/* ------------------------------------------------------------------ */
/* §28.4 — la part de familiarisation, lue au bon endroit              */
/* ------------------------------------------------------------------ */

test('§28.4 — somme des lignes = total : la part de familiarisation est exposée et agrégée', function () {
  var r = calc({
    contrat: CONTRAT, conditions: conditions(),
    journees: [{ jour: '2025-09-01', type: 'familiarisation', minutes_reelles: 120 },
               { jour: '2025-09-02', type: 'familiarisation', minutes_reelles: 180 }],
    compteurEntree: ZERO, annee: 2025, mois: 9,
    periodesFamiliarisation: [{ date_debut: '2025-09-01', date_fin: '2025-09-05' }]
  });
  var fam = Chaine.partFamiliarisation(r);
  egal(fam.actif, true, 'part active');
  egal(fam.netCentimes, r.familiarisation.netCentimes, 'le net de la familiarisation');
  egal(fam.entretienCentimes, 2 * 550, 'deux jours déclarés avec entretien');
  egal(Chaine.netDuMois(r) + r.entretienCentimes + fam.netCentimes + fam.entretienCentimes
       - r.retenueSansSoldeCentimes, r.totalAVerserCentimes,
    'les lignes affichées reconstituent le total');
  /* Sans familiarisation : part nulle, rien ne change (A2). */
  var sans = Chaine.partFamiliarisation(calc(septembre([])));
  egal(sans.actif, false, 'inactive');
  egal(sans.totalCentimes, 0, 'et nulle');
  egal(Chaine.partFamiliarisation({}).totalCentimes, 0, 'un instantané d’avant le lot 20 aussi');

  /* L'agrégat de période porte la part, pour l'écran de période et l'historique. */
  var a = Chaine.agregerPeriode([
    { annee: 2025, mois: 9, cle: '2025-09', resultat: r, compteurEntree: ZERO, compteurSortie: r.compteurSortie },
    { annee: 2025, mois: 10, cle: '2025-10', resultat: calc({ contrat: CONTRAT, conditions: conditions(),
      journees: [], compteurEntree: ZERO, annee: 2025, mois: 10 }), compteurEntree: ZERO, compteurSortie: ZERO }
  ]);
  egal(a.familiarisationNetCentimes, fam.netCentimes, 'net de familiarisation agrégé');
  egal(a.familiarisationEntretienCentimes, fam.entretienCentimes, 'entretien agrégé');
  egal(a.salaireNetCentimes + a.entretienCentimes + a.familiarisationNetCentimes +
       a.familiarisationEntretienCentimes - a.retenueSansSoldeCentimes, a.totalAVerserCentimes,
    'sur la période aussi, somme des lignes = total');
});

/* ------------------------------------------------------------------ */
/* §28.5 — un congé à l'heure pendant une familiarisation              */
/* ------------------------------------------------------------------ */

test('§28.5 A1 — un congé de 1 h 34 posé dans une période est décompté, jamais oublié', function () {
  var periode = [{ date_debut: '2025-09-01', date_fin: '2025-09-12' }];
  function mois(destination, compteur) {
    return calc({
      contrat: CONTRAT, conditions: conditions(),
      journees: [{ jour: '2025-09-03', type: 'presence', minutes_reelles: 300,
                   ecart_minutes: -94, ecart_evenement: 'conge_horaire',
                   ecart_impute_sur: destination }],
      compteurEntree: compteur || { minutesSup: 600, minutesCpAcquis: 5400, minutesCpPris: 0 },
      annee: 2025, mois: 9, periodesFamiliarisation: periode
    });
  }
  var cp = mois('conges_payes');
  egal(cp.minutesEcartSurCp, 94, 'les 94 minutes sortent des congés payés');
  egal(cp.compteurSortie.minutesCpPris, 94, 'le compteur le porte');
  egal(cp.ecartsDeclares.length, 1, 'le document a sa ligne');
  egal(cp.ecartsDeclares[0].evenement, 'conge_horaire', 'nommée congé');
  egal(cp.ecartsDeclares[0].enFamiliarisation, true, 'et située dans la période');
  /* La journée RESTE payée à l'heure : 300 minutes déclarées, ni base ni
     journée mensualisée (Adrien, 26 août). */
  egal(cp.familiarisation.minutesDeclarees, 300, 'les heures déclarées sont payées');
  egal(cp.familiarisation.joursDeLaPeriode, 10, 'les 10 jours de la période restent en période');
  egal(cp.joursPresence, 12, 'seuls les 12 jours d’après la période sont mensualisés');
  egal(cp.minutesSupBase, 12 * 30, 'aucune minute du contrat sur le jour du congé');
  egal(Avant.calculerMois({
    contrat: CONTRAT, conditions: conditions(),
    journees: [{ jour: '2025-09-03', type: 'presence', minutes_reelles: 300,
                 ecart_minutes: -94, ecart_evenement: 'conge_horaire', ecart_impute_sur: 'conges_payes' }],
    compteurEntree: { minutesSup: 600, minutesCpAcquis: 5400, minutesCpPris: 0 },
    annee: 2025, mois: 9, periodesFamiliarisation: periode
  }).minutesEcartSurCp, 0, 'avant : le congé était avalé par la période');

  var recup = mois('recuperation');
  egal(recup.minutesEcartRecuperation, -94, 'sur la récupération : 94 minutes rendues');
  egal(recup.compteurSortie.minutesSup, 600 + 12 * 30 - 94,
    'le compteur : l’entrée, plus les 12 jours mensualisés, moins les 94 rendues');

  /* Bornée au disponible, comme partout (§28.3). */
  var court = mois('conges_payes', { minutesSup: 0, minutesCpAcquis: 30, minutesCpPris: 0 });
  egal(court.minutesEcartSurCp, 30, '30 seulement sur les congés payés');
  egal(court.minutesEcartRecuperation, -64, 'le reste sur la récupération');
});

test('§28.5 A2 — en sans solde dans la période : aucune retenue en plus, la ligne est dite', function () {
  /* Les heures non travaillées ne sont pas déclarées, donc pas payées : une
     retenue en plus les déduirait deux fois. Hors période, la retenue reste
     exactement ce qu'elle était. */
  var dans = calc({
    contrat: CONTRAT, conditions: conditions(),
    journees: [{ jour: '2025-09-03', type: 'presence', minutes_reelles: 300,
                 ecart_minutes: -94, ecart_evenement: 'conge_horaire', ecart_impute_sur: 'sans_solde' }],
    compteurEntree: ZERO, annee: 2025, mois: 9,
    periodesFamiliarisation: [{ date_debut: '2025-09-01', date_fin: '2025-09-12' }]
  });
  egal(dans.retenueSansSoldeCentimes, 0, 'pas de retenue sur des heures non payées');
  egal(dans.ecartsDeclares[0].imputeSur, 'sans_solde', 'mais le congé est nommé');
  var hors = calc(septembre([{ jour: '2025-09-16', type: 'presence', ecart_minutes: -94,
    ecart_evenement: 'conge_horaire', ecart_impute_sur: 'sans_solde' }]));
  egal(hors.minutesEcartSansSolde, 94, 'hors période : la retenue est là');
  egal(hors.retenueSansSoldeCentimes, Engine.montantCentimes(BRUT, 94), 'et chiffrée');
});

/* ------------------------------------------------------------------ */
/* §28.6 — le renoncement ne se déduit plus deux fois                  */
/* ------------------------------------------------------------------ */

test('§28.6 A1 — écart −60 seul et écart −60 avec renoncement de 30 donnent le même résultat', function () {
  var seul = calc(septembre([{ jour: '2025-09-02', type: 'presence', ecart_minutes: -60,
    ecart_evenement: 'liberation_anticipee' }]));
  var avec = calc(septembre([{ jour: '2025-09-02', type: 'presence', ecart_minutes: -60,
    ecart_evenement: 'liberation_anticipee', minutes_sup_renoncees: 30 }]));
  egal(seul.minutesSupAcquises, 600, '−60 seul : 660 − 60');
  egal(avec.minutesSupAcquises, 600, 'avec renoncement : les 30 ne se retirent pas deux fois');
  egal(avec.minutesSupRenoncees, 0, 'le renoncement est borné à ce qui reste dû : rien');
  egal(Avant.calculerMois(septembre([{ jour: '2025-09-02', type: 'presence', ecart_minutes: -60,
    ecart_evenement: 'liberation_anticipee', minutes_sup_renoncees: 30 }])).minutesSupAcquises,
    570, 'avant : 570, les 30 minutes retirées deux fois');
  /* Un écart de −20 laisse 10 dues : on peut renoncer à 10, pas à 30. */
  var partiel = Engine.detailSupDuJour({ type: 'presence', ecart_minutes: -20,
    ecart_evenement: 'liberation_anticipee', minutes_sup_renoncees: 30 }, conditions());
  egal(partiel.renoncees, 10, 'borné à max(0, 30 − 20)');
  egal(Engine.minutesSupDuJour({ type: 'presence', ecart_minutes: -20,
    ecart_evenement: 'liberation_anticipee', minutes_sup_renoncees: 30 }, conditions()), 0,
    'la journée tombe à zéro, jamais en dessous');
  /* Un retard AUGMENTE ce à quoi on peut renoncer : +20 → 50 dues. */
  egal(Engine.detailSupDuJour({ type: 'presence', ecart_minutes: 20,
    ecart_evenement: 'retard_parent', minutes_sup_renoncees: 50 }, conditions()).renoncees, 50,
    'un retard de 20 rend 50 minutes renonçables');
  /* Un écart déduit des congés payés ne réduit pas les minutes du jour. */
  egal(Engine.detailSupDuJour({ type: 'presence', ecart_minutes: -60,
    ecart_evenement: 'liberation_anticipee', ecart_impute_sur: 'conges_payes',
    minutes_sup_renoncees: 30 }, conditions()).renoncees, 30,
    'sur les congés payés, les 30 restent dues, donc renonçables');
});

test('§28.6 A2 — un renoncement sans écart fonctionne à l’identique', function () {
  egal(Engine.minutesSupDuJour({ type: 'presence', minutes_sup_renoncees: 30 }, conditions()), 0,
    'renoncer aux 30 : 0');
  egal(Engine.minutesSupDuJour({ type: 'presence', minutes_sup_renoncees: 60 }, conditions()), 0,
    'renoncer à plus que dû : borné, jamais négatif');
  egal(Engine.minutesSupDuJour({ type: 'presence', minutes_sup_exceptionnelles: 45,
    minutes_sup_renoncees: 75 }, conditions()), 0, 'base + ajoutées, borné');
  egal(Engine.minutesSupDuJour({ type: 'presence', minutes_sup_exceptionnelles: 45,
    minutes_sup_renoncees: 30 }, conditions()), 45, 'renoncer à une partie');
});

/* ------------------------------------------------------------------ */
/* §28.9 — deux petites vérités                                        */
/* ------------------------------------------------------------------ */

test('§28.9 — un planning vide est refusé, jamais payé', function () {
  leve(function () {
    calc({ contrat: CONTRAT, conditions: conditions({ jours_planning: [] }),
           journees: [], compteurEntree: ZERO, annee: 2025, mois: 9 });
  }, 'PLANNING_VIDE', 'planning vide');
  var av = Avant.calculerMois({ contrat: CONTRAT, conditions: conditions({ jours_planning: [] }),
    journees: [], compteurEntree: ZERO, annee: 2025, mois: 9 });
  egal(av.totalAVerserCentimes, NET, 'avant : un mois entier payé pour zéro jour de garde');
  egal(av.joursPresence, 0, 'avant : zéro jour');
  /* `null` reste le planning par défaut, comme avant. */
  egal(calc({ contrat: CONTRAT, conditions: conditions({ jours_planning: null }),
    journees: [], compteurEntree: ZERO, annee: 2025, mois: 9 }).joursPresence, 22,
    'absent : lundi → vendredi');
});

test('§28.8 — la veille de la reprise, règle du moteur', function () {
  egal(Engine.veilleDeLaReprise('2026-07-31', [1, 2, 3, 4, 5]), '2026-08-02',
    'vendredi 31 juillet → reprise lundi 3 août, veille le 2');
  egal(Engine.veilleDeLaReprise('2026-05-07', [1, 2, 3, 4, 5]), '2026-05-10',
    'jeudi 7 mai → le 8 est férié, reprise lundi 11');
  egal(Engine.veilleDeLaReprise('2026-09-30', [1, 2, 3, 4, 5]), '2026-09-30',
    'mercredi 30 septembre → reprise le jeudi 1er : la veille est le 30');
});

/* ------------------------------------------------------------------ */
/* La chaîne : cumul d'exercice, fenêtre des samedis, troncature       */
/* ------------------------------------------------------------------ */

/* Un décor de base minimal pour `Chaine.serie` sous Node : tout est en
   mémoire, rien ne sort. `samedisDemandes` enregistre les fenêtres lues. */
function decor(opts) {
  opts = opts || {};
  var journal = { samedis: [] };
  globalThis.DB = {
    getAvenants: function () { return Promise.resolve([conditions(opts.conditions)]); },
    getCompteurInitial: function () { return Promise.resolve(opts.init || null); },
    getJourneesPeriode: function () { return Promise.resolve(opts.journees || {}); },
    listRecapsPeriode: function () { return Promise.resolve(opts.recaps || []); },
    listImputations: function () { return Promise.resolve(opts.imputations || []); },
    listPeriodesFamiliarisation: function () { return Promise.resolve([]); },
    listSamedisConge: function (id, debut, fin) {
      journal.samedis.push({ debut: debut, fin: fin });
      return Promise.resolve((opts.samedis || []).filter(function (s) {
        return s >= debut && s <= fin;
      }));
    }
  };
  return journal;
}

/* Les cas de chaîne rendent une promesse : `test/run.js` l'attend. */
function asynchrone(nom, fabrique) { test(nom, fabrique); }

asynchrone('§28.8 A1 — la chaîne charge les samedis jusqu’à la veille de la reprise', function () {
  var journal = decor({
    journees: { '2026-07': {
      '2026-07-27': { jour: '2026-07-27', type: 'conge_maria' },
      '2026-07-28': { jour: '2026-07-28', type: 'conge_maria' },
      '2026-07-29': { jour: '2026-07-29', type: 'conge_maria' },
      '2026-07-30': { jour: '2026-07-30', type: 'conge_maria' },
      '2026-07-31': { jour: '2026-07-31', type: 'conge_maria' }
    } },
    imputations: [{ id: 'i1', date_debut: '2026-07-27', date_fin: '2026-07-31',
      jours_ouvrables: 6, jours_sur_cp: 6, jours_sur_sup: 0, jours_sans_solde: 0 }],
    samedis: ['2026-08-01'],
    init: { date_reference: '2026-07-01', minutes_sup: 0, minutes_cp_acquis: 10 * 540, minutes_cp_pris: 0 }
  });
  var contrat = { id: 'c1', date_debut: '2026-01-05', date_fin: null };
  return Chaine.serie(contrat, { annee: 2026, mois: 7 }).then(function (s) {
    var m = s.mois[s.mois.length - 1];
    egal(journal.samedis.length, 1, 'une lecture des samedis');
    egal(journal.samedis[0].fin, '2026-08-02', 'jusqu’à la veille de la reprise, pas au 31 juillet');
    egal(m.resultat.joursCongesDecomptes, 6, 'l’écran mensuel compte 6 jours, samedi compris');
    egal(m.resultat.imputation.joursSurCp, 6, 'et la ventilation de Maria s’applique');
    egal(m.imputationsEcartees.length, 0, 'rien n’est écarté');
    return Chaine.serie(contrat, { annee: 2026, mois: 8 }).then(function (s2) {
      var juillet = s2.mois[s2.mois.length - 2];
      egal(juillet.resultat.joursCongesDecomptes, 6, 'l’historique dit la même chose');
    });
  });
});

asynchrone('§28.1 A5 / A6 — le plafond suit l’exercice (1er juin) et un mois clôturé ne change pas', function () {
  /* Onze mois clôturés, chacun à 2,5 jours, de juin 2025 à avril 2026, puis
     mai 2026 calculé : il passe entier (12 × 2,5 = 30). Juin 2026 repart de
     zéro. Un mois clôturé garde sa valeur d'instantané — ici un août 2025
     figé à 0 minute acquise (perdue à tort), qui ne bouge pas. */
  var recaps = [];
  for (var k = 0; k < 11; k++) {
    var mm = 6 + k; var aa = 2025;
    if (mm > 12) { mm -= 12; aa = 2026; }
    var acquis = (aa === 2025 && mm === 8) ? 0 : 1350;
    recaps.push({ contrat_id: 'c1', annee: aa, mois: mm, statut: 'fige', donnees: {
      uniteCp: 'minutes', minutesCpAcquis: acquis, minutesSupAcquises: 0,
      imputation: { minutesSupConsommees: 0, minutesCpConsommees: 0 },
      compteurSortie: { minutesSup: 0, minutesCpAcquis: 1350 * (k + 1) - (aa === 2025 && mm >= 8 || aa === 2026 ? 1350 : 0), minutesCpPris: 0 }
    } });
  }
  decor({ recaps: recaps });
  var contrat = { id: 'c1', date_debut: '2025-06-01', date_fin: null };
  return Chaine.serie(contrat, { annee: 2026, mois: 6 }).then(function (s) {
    var aout = s.mois.filter(function (e) { return e.cle === '2025-08'; })[0];
    egal(aout.fige, true, 'août 2025 est clôturé');
    egal(aout.resultat.minutesCpAcquis, 0, 'A6 : sa valeur d’instantané ne change pas');
    var mai = s.mois.filter(function (e) { return e.cle === '2026-05'; })[0];
    egal(mai.fige, false, 'mai est calculé');
    egal(mai.resultat.minutesCpAcquis, 1350, 'douzième mois : 27,5 + 2,5 = 30, entier');
    egal(mai.resultat.acquisitionCp.plafonne, false, 'pas plafonné');
    var juin = s.mois[s.mois.length - 1];
    egal(juin.resultat.minutesCpAcquis, 1350, 'juin ouvre un nouvel exercice');
  });
});

asynchrone('§28.1 A5 — le plafond mord quand le cumul de l’exercice dépasserait 30 jours', function () {
  /* Un instantané aberrant à 29 jours en avril : mai n'acquiert que le
     complément, juin repart. */
  decor({ recaps: [{ contrat_id: 'c1', annee: 2026, mois: 4, statut: 'fige', donnees: {
    uniteCp: 'minutes', minutesCpAcquis: 29 * 540, minutesSupAcquises: 0,
    imputation: { minutesSupConsommees: 0, minutesCpConsommees: 0 },
    compteurSortie: { minutesSup: 0, minutesCpAcquis: 29 * 540, minutesCpPris: 0 }
  } }] });
  var contrat = { id: 'c1', date_debut: '2026-04-01', date_fin: null };
  return Chaine.serie(contrat, { annee: 2026, mois: 6 }).then(function (s) {
    var mai = s.mois.filter(function (e) { return e.cle === '2026-05'; })[0];
    egal(mai.resultat.minutesCpAcquis, 540, 'mai : 1 jour, le complément à 30');
    egal(mai.resultat.acquisitionCp.plafonne, true, 'plafonné');
    egal(s.mois[s.mois.length - 1].resultat.minutesCpAcquis, 1350, 'juin : nouvel exercice');
  });
});

asynchrone('§28.9 — la troncature garde les mois les plus récents : le mois demandé est calculé', function () {
  decor({});
  var contrat = { id: 'c1', date_debut: '1960-01-01', date_fin: null };
  return Chaine.serie(contrat, { annee: 2026, mois: 3 }).then(function (s) {
    egal(s.tronquee, true, 'tronquée');
    egal(s.mois.length, Chaine.MAX_MOIS, '600 mois');
    var dernier = s.mois[s.mois.length - 1];
    egal(dernier.cle, '2026-03', 'le dernier est le mois demandé');
    egal(s.debutChaine.annee, 1976, 'la chaîne commence 600 mois avant');
    egal(s.debutChaine.mois, 4, '… en avril 1976');
  });
});

/* ------------------------------------------------------------------ */
/* Ces cas échouaient sur le moteur d'avant : vérifié, pas supposé     */
/* ------------------------------------------------------------------ */

test('les critères du lot 28 échouaient sur le moteur figé d’avant le lot', function () {
  var e1 = septembre([{ jour: '2025-09-02', type: 'conge_maria' }]);
  egal(Avant.calculerMois(e1).minutesCpAcquis === 1350, false, '§28.1 A1 était faux');
  egal(Avant.minutesSupDuJour({ type: 'absence_enfant' }, conditions()) === 0, false, '§28.2 était faux');
  egal(Avant.calculerMois(septembre([liberation('2025-09-02', 300, 'conges_payes')],
    { minutesSup: 0, minutesCpAcquis: 120, minutesCpPris: 0 })).minutesEcartSurCp === 120, false,
    '§28.3 était faux');
  egal(typeof Avant.veilleDeLaReprise, 'undefined', '§28.8 : la règle n’existait pas');
});

module.exports = { cas: cas };
