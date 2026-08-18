/* ============================================================================
   lot17-differentiel.test.js — LA PREUVE DU §17.3.

     « Aucune règle métier ne change dans ce lot au titre des conditions
       datées : à conditions constantes, le résultat doit être rigoureusement
       identique. C'est vérifiable par différentiel exhaustif, et ça doit
       l'être. »

   Ce fichier confronte le moteur du lot 17 au moteur FIGÉ d'avant le lot 17
   (`test/fixtures/engine-avant-lot17.js`, copie exacte de `js/engine.js` au
   commit `b0394ba`), sur un produit croisé de scénarios. Les deux moteurs
   reçoivent LES MÊMES faits, exprimés chacun dans sa forme :

     - avant : les réglages sur `contrat`, les congés payés en dixièmes ;
     - après : les réglages sur `conditions` (l'avenant), les congés payés en
       minutes, au facteur `minutes_par_jour_conge / 10`.

   ET LE RÉSULTAT DOIT ÊTRE LE MÊME, champ par champ. Trois différences sont
   attendues, et elles sont vérifiées POSITIVEMENT plutôt qu'ignorées :

     1. les champs de congés payés changent d'unité — on vérifie la conversion
        exacte, pas seulement qu'ils existent ;
     2. §17.7, le prorata du premier et du dernier mois — on vérifie que le
        montant vaut exactement la formule, et surtout qu'un mois ENTIER ne
        bouge pas d'un centime ;
     3. §17.5, l'écart d'horaire — il n'existe pas dans l'ancien moteur, donc
        aucune journée du différentiel n'en porte. Il a ses propres cas.

   POURQUOI UN FACTEUR MULTIPLE DE 10. Avec `minutes_par_jour_conge` multiple
   de 10, la conversion dixièmes → minutes est une bijection entière : les
   deux moteurs font rigoureusement la même arithmétique à un facteur près.
   Un facteur non multiple de 10 introduirait un demi-arrondi à l'acquisition,
   et le différentiel ne pourrait plus être strict. Ce cas a donc son propre
   test, à part, qui borne l'écart au lieu de le nier.
   ========================================================================= */
'use strict';

var Avant = require('./fixtures/engine-avant-lot17.js');
var Apres = require('../js/engine.js');

var cas = [];
function test(nom, fn) { cas.push({ nom: nom, fn: fn }); }

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

/* ------------------------------------------------------------------ */
/* Le décor : un contrat, ses conditions, et la même chose des deux    */
/* côtés de la bascule.                                                */
/* ------------------------------------------------------------------ */

/* Onze réglages. `contrat` les porte pour l'ancien moteur, `conditions` pour
   le nouveau — mêmes valeurs, aux mêmes clés SQL. C'est tout le sujet du
   lot 17 : le lieu change, pas la valeur. */
function reglages(v) {
  return {
    jours_planning: v.planning,
    heure_arrivee: '08:30',
    heure_depart: '17:30',
    minutes_contractuelles: 540,
    minutes_sup_jour: v.minutesSupJour,
    minutes_par_jour_conge: v.mpjc,
    entretien_centimes_jour: v.entretien,
    sup_dues_si_enfant_absent: v.supDuesSiAbsent,
    ordre_imputation: v.ordre
  };
}

function contratAvant(v) {
  var c = reglages(v);
  c.id = 'c1';
  c.date_debut = v.dateDebut || null;
  c.date_fin = v.dateFin || null;
  return c;
}

/* Le nouveau moteur ne lit plus que les bornes sur `contrat` : on ne lui
   donne QUE ça. Si une ligne du moteur relisait un réglage sur `contrat`,
   elle lèverait ici plutôt que de produire un chiffre faux en silence. */
function contratApres(v) {
  return { id: 'c1', date_debut: v.dateDebut || null, date_fin: v.dateFin || null };
}

function conditionsApres(v) {
  var c = reglages(v);
  c.date_effet = '2020-01-01';
  c.numero = 1;
  c.reconstitue = true;
  c.brut_mensuel_centimes = v.brut;
  c.net_mensuel_centimes = v.net;
  return c;
}

/* ------------------------------------------------------------------ */
/* La matrice                                                          */
/* ------------------------------------------------------------------ */

var PLANNINGS = [
  [1, 2, 3, 4, 5],
  [1, 2, 3, 4],
  [1, 2, 3, 4, 5, 6],
  [2, 4]
];

/* Des mois choisis pour leurs fériés : mai (trois fériés mobiles), avril
   (Pâques), août (le 15, samedi en 2026), novembre (1er et 11), décembre
   (Noël), plus des mois nus. Deux années pour que Pâques bouge. */
var MOIS = [
  [2026, 1], [2026, 2], [2026, 4], [2026, 5], [2026, 6],
  [2026, 7], [2026, 8], [2026, 11], [2026, 12],
  [2025, 3], [2025, 4], [2025, 5], [2025, 8], [2024, 2]
];

/* Multiples de 10 : voir l'en-tête. */
var MPJC = [540, 480, 600];
var MINUTES_SUP_JOUR = [30, 0, 45];
var ORDRES = ['cp_puis_sup', 'sup_puis_cp'];
var ENTRETIENS = [550, 0, 327];
var SUP_DUES = [true, false, undefined];

var COMPTEURS = [
  { minutesSup: 0, dixiemesCpAcquis: 0, dixiemesCpPris: 0 },
  { minutesSup: 5400, dixiemesCpAcquis: 300, dixiemesCpPris: 0 },
  { minutesSup: 2700, dixiemesCpAcquis: 55, dixiemesCpPris: 12 },
  /* Compteurs incohérents : disponible négatif des deux côtés. La borne à 0
     de `prendreSurCp` / `prendreSurSup` doit se comporter pareil. */
  { minutesSup: -100, dixiemesCpAcquis: 20, dixiemesCpPris: 90 },
  { minutesSup: 100000, dixiemesCpAcquis: 1000, dixiemesCpPris: 1 }
];

/* Motifs de journées, exprimés en NUMÉROS DE JOUR pour rester lisibles ; les
   dates sont fabriquées au moment du scénario. Aucun motif ne porte
   `ecart_minutes` : l'ancien moteur ne connaît pas ce champ, et le
   différentiel ne compare que ce que les deux savent faire. */
var MOTIFS = [
  function () { return []; },
  function (j) { return [{ jour: j(3), type: 'absence_enfant' }]; },
  function (j) {
    return [{ jour: j(6), type: 'conge_maria' }, { jour: j(7), type: 'conge_maria' },
            { jour: j(8), type: 'conge_maria' }, { jour: j(9), type: 'conge_maria' },
            { jour: j(10), type: 'conge_maria' }];
  },
  function (j) {
    var out = [];
    for (var k = 3; k <= 21; k++) out.push({ jour: j(k), type: 'conge_maria' });
    return out;
  },
  function (j) { return [{ jour: j(4), type: 'sans_solde' }, { jour: j(5), type: 'sans_solde' }]; },
  function (j) { return [{ jour: j(2), type: 'familiarisation', entretien_centimes: 300 }]; },
  function (j) { return [{ jour: j(12), type: 'hors_planning' }, { jour: j(13), type: 'ferie' }]; },
  function (j) {
    return [{ jour: j(15), type: 'presence', minutes_sup_exceptionnelles: 45 },
            { jour: j(16), type: 'presence', minutes_sup_renoncees: 20 },
            { jour: j(17), type: 'presence', minutes_sup_renoncees: 500 },
            { jour: j(18), type: 'presence', entretien_centimes: 999 }];
  },
  function (j) {
    return [{ jour: j(9), type: 'absence_enfant', sup_dues_override: false },
            { jour: j(10), type: 'absence_enfant', sup_dues_override: true },
            { jour: j(11), type: 'absence_enfant' }];
  },
  function (j) {
    /* Congés + présence + absence dans le même mois : le cas qui fait
       travailler `imputationCorrespondAuxJournees`. */
    return [{ jour: j(6), type: 'conge_maria' }, { jour: j(7), type: 'conge_maria' },
            { jour: j(8), type: 'conge_maria' },
            { jour: j(14), type: 'absence_enfant' },
            { jour: j(20), type: 'presence', minutes_sup_exceptionnelles: 15 }];
  }
];

/* Imputations posées, fabriquées à partir des journées de congé du mois. */
var IMPUTATIONS = [
  /* Aucune : l'ordre par défaut du contrat (RG-07). */
  function () { return []; },
  /* Couvrante et cohérente : la ventilation de Maria s'applique. */
  function (jours, planning, mpjc) {
    if (!jours.length) return [];
    var n = Apres.decompterJoursOuvrables(jours[0], jours[jours.length - 1], planning);
    return [{ id: 'i1', date_debut: jours[0], date_fin: jours[jours.length - 1],
              jours_ouvrables: n,
              jours_sur_cp: n, jours_sur_sup: 0, jours_sans_solde: 0 }];
  },
  /* Couvrante, ventilée sur la récupération : le cas qui bute sur les
     réserves quand le compteur est vide — `IMPUTATION_DEPASSE_RESERVES`. */
  function (jours, planning) {
    if (!jours.length) return [];
    var n = Apres.decompterJoursOuvrables(jours[0], jours[jours.length - 1], planning);
    return [{ id: 'i2', date_debut: jours[0], date_fin: jours[jours.length - 1],
              jours_ouvrables: n,
              jours_sur_cp: 0, jours_sur_sup: n, jours_sans_solde: 0 }];
  },
  /* Ventilation qui ne couvre pas le décompte : `IMPUTATION_INCOMPLETE`. */
  function (jours, planning) {
    if (!jours.length) return [];
    var n = Apres.decompterJoursOuvrables(jours[0], jours[jours.length - 1], planning);
    return [{ id: 'i3', date_debut: jours[0], date_fin: jours[jours.length - 1],
              jours_ouvrables: n - 1,
              jours_sur_cp: n - 1, jours_sur_sup: 0, jours_sans_solde: 0 }];
  },
  /* Recoupante sans couvrir : le choix est ÉCARTÉ, l'ordre du contrat
     reprend la main (`source: 'defaut_choix_ecarte'`). */
  function (jours, planning) {
    if (jours.length < 2) return [];
    return [{ id: 'i4', date_debut: jours[1], date_fin: jours[jours.length - 1],
              jours_ouvrables: 1, jours_sur_cp: 1, jours_sur_sup: 0, jours_sans_solde: 0 }];
  },
  /* Mixte, avec du sans solde : celle qui fait travailler RG-08. */
  function (jours, planning) {
    if (!jours.length) return [];
    var n = Apres.decompterJoursOuvrables(jours[0], jours[jours.length - 1], planning);
    if (n < 3) return [];
    return [{ id: 'i5', date_debut: jours[0], date_fin: jours[jours.length - 1],
              jours_ouvrables: n,
              jours_sur_cp: 1, jours_sur_sup: 1, jours_sans_solde: n - 2 }];
  }
];

/* Bornes du contrat : mois entier, premier mois partiel, dernier mois
   partiel, et les deux à la fois. Le §17.7 ne joue que sur les trois
   derniers ; le premier prouve qu'il ne joue PAS ailleurs. */
var BORNES = [
  function () { return { dateDebut: '2000-01-01', dateFin: null }; },
  function (a, m) { return { dateDebut: cle(a, m) + '-16', dateFin: null }; },
  function (a, m) { return { dateDebut: '2000-01-01', dateFin: cle(a, m) + '-11' }; },
  function (a, m) { return { dateDebut: cle(a, m) + '-05', dateFin: cle(a, m) + '-24' }; }
];

function cle(a, m) { return a + '-' + String(m).padStart(2, '0'); }

/* ------------------------------------------------------------------ */
/* La comparaison                                                      */
/* ------------------------------------------------------------------ */

/* Les champs qui doivent être STRICTEMENT identiques, quelle que soit la
   situation. Toute divergence ici est une régression. */
var IDENTIQUES = [
  'joursPresence', 'entretienCentimes', 'minutesSupAcquises',
  'minutesSupBase', 'minutesSupAjoutees', 'minutesSupRenoncees',
  'joursCongesDecomptes', 'retenueSansSoldeCentimes',
  'salaireBrutCentimes', 'salaireNetCentimes'
];

function comparer(av, ap, facteur, etiquette, moisEntier, v, part) {
  var i;
  for (i = 0; i < IDENTIQUES.length; i++) {
    var k = IDENTIQUES[i];
    assert(av[k] === ap[k],
      etiquette + ' — ' + k + ' : avant ' + av[k] + ', après ' + ap[k]);
  }

  /* L'imputation, jours et minutes. */
  assert(av.imputation.joursSurCp === ap.imputation.joursSurCp,
    etiquette + ' — imputation.joursSurCp');
  assert(av.imputation.joursSurSup === ap.imputation.joursSurSup,
    etiquette + ' — imputation.joursSurSup');
  assert(av.imputation.joursSansSolde === ap.imputation.joursSansSolde,
    etiquette + ' — imputation.joursSansSolde');
  assert(av.imputation.minutesSupConsommees === ap.imputation.minutesSupConsommees,
    etiquette + ' — imputation.minutesSupConsommees');
  /* §17.6 — LE CHANGEMENT D'UNITÉ, vérifié comme une égalité, pas comme une
     absence. Les dixièmes d'hier valent les minutes d'aujourd'hui au facteur
     `minutes_par_jour_conge / 10`, et à rien d'autre. */
  assert(av.imputation.dixiemesCpConsommes * facteur === ap.imputation.minutesCpConsommees,
    etiquette + ' — CP consommés : ' + av.imputation.dixiemesCpConsommes +
    ' dixièmes × ' + facteur + ' ≠ ' + ap.imputation.minutesCpConsommees + ' min');
  assert(av.dixiemesCpAcquis * facteur === ap.minutesCpAcquis,
    etiquette + ' — CP acquis du mois : ' + av.dixiemesCpAcquis + ' × ' + facteur +
    ' ≠ ' + ap.minutesCpAcquis);

  /* Les compteurs de sortie — ceux qui se propagent sur des années. */
  assert(av.compteurSortie.minutesSup === ap.compteurSortie.minutesSup,
    etiquette + ' — compteurSortie.minutesSup');
  assert(av.compteurSortie.dixiemesCpAcquis * facteur === ap.compteurSortie.minutesCpAcquis,
    etiquette + ' — compteurSortie CP acquis');
  assert(av.compteurSortie.dixiemesCpPris * facteur === ap.compteurSortie.minutesCpPris,
    etiquette + ' — compteurSortie CP pris');

  /* Les périodes retenues et l'origine de leur ventilation : c'est ce dont
     dépend l'encart du §16.1. */
  assert(JSON.stringify(av.imputationsAppliquees) === JSON.stringify(ap.imputationsAppliquees),
    etiquette + ' — imputationsAppliquees :\n  avant ' +
    JSON.stringify(av.imputationsAppliquees) + '\n  après ' +
    JSON.stringify(ap.imputationsAppliquees));

  /* §17.7 — le prorata. */
  if (moisEntier) {
    assert(ap.prorata.applique === false,
      etiquette + ' — prorata appliqué sur un mois entier');
    assert(ap.salaireBrutProrataCentimes === av.salaireBrutCentimes,
      etiquette + ' — brut proratisé sur un mois entier');
    assert(ap.totalAVerserCentimes === av.totalAVerserCentimes,
      etiquette + ' — total à verser : avant ' + av.totalAVerserCentimes +
      ', après ' + ap.totalAVerserCentimes);
  } else {
    /* Le mois est partiel : le total CHANGE, et c'est l'objet du §17.7. On
       vérifie la formule, pas seulement l'inégalité. */
    var attenduBrut = Math.round(v.brut * part.joursCouverts / part.joursDuMois);
    var attenduNet = Math.round(v.net * part.joursCouverts / part.joursDuMois);
    assert(ap.salaireBrutProrataCentimes === attenduBrut,
      etiquette + ' — brut proratisé : ' + ap.salaireBrutProrataCentimes +
      ' ≠ ' + attenduBrut);
    assert(ap.totalAVerserCentimes === attenduNet + ap.entretienCentimes - ap.retenueSansSoldeCentimes,
      etiquette + ' — total à verser proratisé');
    assert(ap.prorata.applique === true, etiquette + ' — prorata non signalé');
  }
}

/* ------------------------------------------------------------------ */
/* Le différentiel                                                     */
/* ------------------------------------------------------------------ */

/* Produit croisé déterministe : chaque dimension avance à son propre pas,
   premier entre eux avec les autres autant que possible, de sorte que la
   boucle balaie toutes les combinaisons deux à deux sans en fabriquer des
   centaines de milliers. Aucune horloge, aucun hasard : le même parcours à
   chaque exécution, sinon un échec ne serait pas reproductible. */
function scenarios() {
  var out = [];
  var n = 0;
  for (var im = 0; im < MOIS.length; im++) {
    for (var ip = 0; ip < PLANNINGS.length; ip++) {
      for (var imo = 0; imo < MOTIFS.length; imo++) {
        for (var iimp = 0; iimp < IMPUTATIONS.length; iimp++) {
          for (var ib = 0; ib < BORNES.length; ib++) {
            var annee = MOIS[im][0], mois = MOIS[im][1];
            var bornes = BORNES[ib](annee, mois);
            out.push({
              annee: annee, mois: mois,
              planning: PLANNINGS[ip],
              motif: imo, imputation: iimp,
              mpjc: MPJC[n % MPJC.length],
              minutesSupJour: MINUTES_SUP_JOUR[(n + 1) % MINUTES_SUP_JOUR.length],
              ordre: ORDRES[(n + 2) % ORDRES.length],
              entretien: ENTRETIENS[(n + 1) % ENTRETIENS.length],
              supDuesSiAbsent: SUP_DUES[(n + 2) % SUP_DUES.length],
              compteur: COMPTEURS[(n + 3) % COMPTEURS.length],
              brut: [200000, 137289, 0, 98765][(n + 1) % 4],
              net: [155000, 105432, 0, 76543][(n + 1) % 4],
              dateDebut: bornes.dateDebut, dateFin: bornes.dateFin
            });
            n++;
          }
        }
      }
    }
  }
  return out;
}

function journeesDe(v) {
  var prefixe = cle(v.annee, v.mois) + '-';
  var derniers = Apres.joursDuMois(v.annee, v.mois).length;
  function j(k) { return prefixe + String(Math.min(k, derniers)).padStart(2, '0'); }
  return MOTIFS[v.motif](j);
}

test('différentiel exhaustif — à conditions constantes, résultat identique', function () {
  var liste = scenarios();
  assert(liste.length > 3000,
    'le différentiel doit être exhaustif : ' + liste.length + ' scénarios seulement');

  var compares = 0;
  var erreursIdentiques = 0;

  for (var i = 0; i < liste.length; i++) {
    var v = liste[i];
    var journees = journeesDe(v);
    var joursConge = journees.filter(function (x) { return x.type === 'conge_maria'; })
                             .map(function (x) { return x.jour; }).sort();
    var imputations = IMPUTATIONS[v.imputation](joursConge, v.planning, v.mpjc);
    var facteur = v.mpjc / 10;

    var etiquette = 'scénario #' + i + ' [' + cle(v.annee, v.mois) +
      ' planning=' + v.planning.join('') + ' motif=' + v.motif +
      ' imputation=' + v.imputation + ' mpjc=' + v.mpjc +
      ' bornes=' + v.dateDebut + '→' + (v.dateFin || '∞') + ']';

    var entreesAvant = {
      contrat: contratAvant(v),
      salaire: { brut_mensuel_centimes: v.brut, net_mensuel_centimes: v.net },
      journees: journees,
      compteurEntree: {
        minutesSup: v.compteur.minutesSup,
        dixiemesCpAcquis: v.compteur.dixiemesCpAcquis,
        dixiemesCpPris: v.compteur.dixiemesCpPris
      },
      annee: v.annee, mois: v.mois, imputations: imputations
    };
    var entreesApres = {
      contrat: contratApres(v),
      conditions: conditionsApres(v),
      journees: journees,
      compteurEntree: {
        minutesSup: v.compteur.minutesSup,
        minutesCpAcquis: v.compteur.dixiemesCpAcquis * facteur,
        minutesCpPris: v.compteur.dixiemesCpPris * facteur
      },
      annee: v.annee, mois: v.mois, imputations: imputations
    };

    var av = null, ap = null, eAv = null, eAp = null;
    try { av = Avant.calculerMois(entreesAvant); } catch (e) { eAv = e; }
    try { ap = Apres.calculerMois(entreesApres); } catch (e) { eAp = e; }

    /* Un refus doit rester un refus, avec LE MÊME code. Un moteur qui
       accepterait aujourd'hui ce qu'il refusait hier laisserait passer une
       ventilation impossible ; l'inverse enfermerait Maria dehors. */
    if (eAv || eAp) {
      assert(eAv && eAp, etiquette + ' — un seul des deux moteurs refuse : avant=' +
        (eAv ? eAv.code || eAv.message : 'ok') + ' après=' +
        (eAp ? eAp.code || eAp.message : 'ok'));
      assert(eAv.code === eAp.code, etiquette + ' — codes d’erreur différents : ' +
        eAv.code + ' / ' + eAp.code);
      erreursIdentiques++;
      continue;
    }

    var part = Apres.partCouverteDuMois(contratApres(v), v.planning, v.annee, v.mois);
    var moisEntier = part.joursCouverts === part.joursDuMois;
    comparer(av, ap, facteur, etiquette, moisEntier, v, part);
    compares++;
  }

  /* Le différentiel ne prouve rien s'il ne rencontre ni succès ni refus :
     une matrice qui ne toucherait que des cas triviaux passerait toujours. */
  assert(compares > 2000, 'trop peu de mois calculés : ' + compares);
  assert(erreursIdentiques > 50,
    'trop peu de refus rencontrés (' + erreursIdentiques +
    ') : la matrice ne teste pas les gardes du moteur');
});

/* ------------------------------------------------------------------ */
/* Ce que le différentiel ne peut pas couvrir, testé à part            */
/* ------------------------------------------------------------------ */

test('§17.7 — un mois entier ne bouge pas d’un centime', function () {
  var v = { planning: [1, 2, 3, 4, 5], mpjc: 540, minutesSupJour: 30,
            entretien: 550, supDuesSiAbsent: true, ordre: 'cp_puis_sup',
            brut: 137289, net: 105432, dateDebut: '2020-01-01', dateFin: null };
  var r = Apres.calculerMois({
    contrat: contratApres(v), conditions: conditionsApres(v),
    journees: [], compteurEntree: {}, annee: 2026, mois: 6
  });
  assert(r.prorata.applique === false, 'prorata appliqué à tort');
  assert(r.salaireBrutProrataCentimes === 137289, 'brut modifié sur un mois entier');
  assert(r.totalAVerserCentimes === 105432 + r.entretienCentimes,
    'total modifié sur un mois entier');
});

test('§17.7 — un contrat ouvert le 16 mars ne retient plus le mois entier', function () {
  var v = { planning: [1, 2, 3, 4, 5], mpjc: 540, minutesSupJour: 30,
            entretien: 550, supDuesSiAbsent: true, ordre: 'cp_puis_sup',
            brut: 200000, net: 155000, dateDebut: '2026-03-16', dateFin: null };
  var r = Apres.calculerMois({
    contrat: contratApres(v), conditions: conditionsApres(v),
    journees: [], compteurEntree: {}, annee: 2026, mois: 3
  });
  /* Mars 2026 : 22 jours du lundi au vendredi, dont 12 à partir du 16. */
  assert(r.prorata.joursDuMois === 22, 'jours du mois : ' + r.prorata.joursDuMois);
  assert(r.prorata.joursCouverts === 12, 'jours couverts : ' + r.prorata.joursCouverts);
  assert(r.prorata.applique === true, 'prorata non signalé');
  assert(r.salaireBrutProrataCentimes === Math.round(200000 * 12 / 22),
    'brut proratisé : ' + r.salaireBrutProrataCentimes);
  /* Les journées, elles, ne changent pas : elles étaient déjà bornées. */
  assert(r.joursPresence === 12, 'jours de présence : ' + r.joursPresence);
});

test('§17.6 — un facteur non multiple de 10 borne l’arrondi à une minute', function () {
  /* Le seul endroit où l'unité en minutes peut arrondir est l'acquisition
     mensuelle : 2,5 jours × un nombre impair de minutes. On ne le nie pas,
     on le BORNE — et on vérifie qu'il ne s'accumule pas ailleurs. */
  var mpjc = 537;
  var attendu = Math.round(25 * mpjc / 10);
  assert(Math.abs(attendu - 25 * mpjc / 10) <= 0.5,
    'l’acquisition dérive de plus d’une demi-minute');
  assert(Apres.minutesCpParMois({ minutes_par_jour_conge: mpjc }) === attendu,
    'minutesCpParMois ne suit pas la formule');
  /* Et la consommation, elle, est exacte quel que soit le facteur : un jour
     consomme `minutes_par_jour_conge`, pas un arrondi de quelque chose. */
  var r = Apres.imputerConges(2, { minutesSup: 0, minutesCp: 10 * mpjc },
    { minutes_par_jour_conge: mpjc, ordre_imputation: 'cp_puis_sup' });
  assert(r.minutesCpConsommees === 2 * mpjc,
    'consommation arrondie : ' + r.minutesCpConsommees);
});

test('le moteur ne lit plus AUCUN réglage sur `contrat`', function () {
  /* La garde qui empêche une rechute. On donne au moteur un `contrat` qui
     porte des réglages VOLONTAIREMENT différents de ceux des conditions : si
     une seule ligne les relisait, le résultat divergerait. */
  var v = { planning: [1, 2, 3, 4, 5], mpjc: 540, minutesSupJour: 30,
            entretien: 550, supDuesSiAbsent: true, ordre: 'cp_puis_sup',
            brut: 200000, net: 155000, dateDebut: '2020-01-01', dateFin: null };
  var piege = {
    id: 'c1', date_debut: '2020-01-01', date_fin: null,
    jours_planning: [1], minutes_sup_jour: 999, minutes_par_jour_conge: 1,
    entretien_centimes_jour: 99999, ordre_imputation: 'sup_puis_cp',
    sup_dues_si_enfant_absent: false, brut_mensuel_centimes: 1,
    net_mensuel_centimes: 1
  };
  var sain = Apres.calculerMois({
    contrat: contratApres(v), conditions: conditionsApres(v),
    journees: [], compteurEntree: {}, annee: 2026, mois: 6
  });
  var avecPiege = Apres.calculerMois({
    contrat: piege, conditions: conditionsApres(v),
    journees: [], compteurEntree: {}, annee: 2026, mois: 6
  });
  assert(JSON.stringify(sain) === JSON.stringify(avecPiege),
    'le moteur lit encore un réglage sur `contrat` :\n  sain  ' +
    JSON.stringify(sain) + '\n  piégé ' + JSON.stringify(avecPiege));
});

test('§17.3 — sans conditions, le moteur refuse au lieu de deviner', function () {
  var leve = false;
  try {
    Apres.calculerMois({ contrat: { id: 'c1' }, journees: [], annee: 2026, mois: 6 });
  } catch (e) { leve = e.code === 'CONDITIONS_ABSENTES'; }
  assert(leve, 'le moteur accepte de calculer un mois sans conditions');
});

module.exports = { cas: cas };
