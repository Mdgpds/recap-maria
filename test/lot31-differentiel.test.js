/* ============================================================================
   lot31-differentiel.test.js — LE DIFFÉRENTIEL DU LOT 31, POSTE À POSTE.

   « Aucun montant ne change. Le différentiel poste à poste est OBLIGATOIRE
     dans la restitution : mêmes salaires, mêmes entretiens, mêmes compteurs
     qu'avant, sur au moins un mois qui porte une orpheline et un mois qui
     n'en porte pas. » (brief du 28 août 2026, §4)

   Ce lot ne change AUCUNE règle de calcul : le moteur produit une information
   de plus (`imputationsOrphelines`), il ne décide rien de nouveau. La preuve
   est donc la plus stricte qui soit — l'ÉGALITÉ EXACTE, champ par champ,
   entre le moteur figé d'avant le lot (`test/fixtures/engine-avant-lot31.js`,
   copie exacte de `js/engine.js` au commit `a2add41`) et le moteur courant,
   le seul champ ajouté mis à part.

   Aucune règle nouvelle à reconstruire ici, contrairement au différentiel du
   lot 28 : c'est ce qui rend ce fichier court, et c'est exactement ce qu'il
   doit prouver.

   Valeurs FICTIVES (dépôt public).
   ========================================================================= */
'use strict';

var Avant = require('./fixtures/engine-avant-lot31.js');
var Apres = require('../js/engine.js');

var cas = [];
function test(nom, fn) { cas.push({ nom: nom, fn: fn }); }
function assert(cond, message) { if (!cond) throw new Error(message); }
function copie(o) { return JSON.parse(JSON.stringify(o)); }

/* ------------------------------------------------------------------ */
/* Le décor                                                            */
/* ------------------------------------------------------------------ */

function conditions(v) {
  return {
    date_effet: '2020-01-01', numero: 1,
    jours_planning: v.planning || [1, 2, 3, 4, 5],
    heure_arrivee: '08:30', heure_depart: '17:30',
    minutes_contractuelles: 540,
    minutes_sup_jour: 30,
    minutes_par_jour_conge: v.mpjc || 540,
    entretien_centimes_jour: 550,
    sup_dues_si_enfant_absent: true,
    ordre_imputation: v.ordre || 'cp_puis_sup',
    brut_mensuel_centimes: 137289,
    net_mensuel_centimes: 105000
  };
}

function contrat() { return { id: 'c1', date_debut: '2000-01-01', date_fin: null }; }

/* Le mois entier de mai 2026, journées ordinaires sauf celles fournies. */
function entrees(v) {
  return {
    contrat: contrat(),
    conditions: conditions(v),
    journees: v.journees || [],
    compteurEntree: v.compteurEntree ||
      { minutesSup: 600, minutesCpAcquis: 10800, minutesCpPris: 0 },
    annee: v.annee || 2026, mois: v.mois || 5,
    imputations: v.imputations || [],
    samedisComptes: v.samedisComptes || [],
    minutesCpAcquisesExercice: v.exercice || 0
  };
}

/* Le seul champ que le lot ajoute. Tout le reste doit être identique au
   caractère près — c'est la définition même de « aucun montant ne change ». */
function sansLeChampAjoute(r) {
  var c = copie(r);
  delete c.imputationsOrphelines;
  /* LA RÉCUPÉRATION SE GAGNE JOUR APRÈS JOUR — les deux relevés ajoutés par
     le lot suivant sortent de la comparaison du lot 31, exactement comme
     `imputationsOrphelines` sort de celle du lot 28. Leur propre différentiel
     est dans `test/recuperation-differentiel.test.js`. */
  delete c.minutesSupParJour;
  delete c.recuperationConsommeeParPeriode;
  return c;
}

/* Le cas du brief, §1 : une imputation d'un jour, aucune journée
   `conge_maria` en face — la journée du 15 mai est un `sans_solde` écrit
   directement en base. */
var CAS_ORPHELINE = {
  journees: [{ jour: '2026-05-15', type: 'sans_solde' }],
  imputations: [{ id: 'i-orpheline', date_debut: '2026-05-15', date_fin: '2026-05-15',
                  jours_ouvrables: 1, jours_sur_cp: 0, jours_sur_sup: 0,
                  jours_sans_solde: 1 }]
};

/* Le même mois, une période de congé RÉELLEMENT posée et correctement
   imputée : rien d'orphelin, et l'imputation s'applique. */
var CAS_SAIN = {
  journees: [
    { jour: '2026-05-11', type: 'conge_maria' },
    { jour: '2026-05-12', type: 'conge_maria' },
    { jour: '2026-05-13', type: 'conge_maria' },
    { jour: '2026-05-15', type: 'conge_maria' }
  ],
  /* Le jeudi 14 mai 2026 est l'Ascension : un férié n'est jamais posé en
     congé et ne se décompte pas (RG-06). Le décompte réel de la période est
     donc 4, pas 5 — la ventilation le suit, sinon le moteur refuse à juste
     titre (`IMPUTATION_INCOMPLETE`). */
  imputations: [{ id: 'i-saine', date_debut: '2026-05-11', date_fin: '2026-05-15',
                  jours_ouvrables: 4, jours_sur_cp: 4, jours_sur_sup: 0,
                  jours_sans_solde: 0 }]
};

/* ------------------------------------------------------------------ */

test('§4 — un mois QUI PORTE une orpheline : pas un centime ne bouge', function () {
  var e = entrees(CAS_ORPHELINE);
  var av = Avant.calculerMois(e);
  var ap = Apres.calculerMois(e);

  assert(ap.imputationsOrphelines.length === 1,
    'le décor doit bien porter une orpheline, sinon le différentiel ne prouve rien');

  assert(JSON.stringify(sansLeChampAjoute(ap)) === JSON.stringify(av),
    'un mois porteur d’une orpheline doit être identique au champ ajouté près :' +
    '\n  avant ' + JSON.stringify(av) +
    '\n  après ' + JSON.stringify(sansLeChampAjoute(ap)));
});

test('§4 — un mois SANS orpheline : pas un centime ne bouge', function () {
  var e = entrees(CAS_SAIN);
  var av = Avant.calculerMois(e);
  var ap = Apres.calculerMois(e);

  assert(ap.imputationsOrphelines.length === 0,
    'le décor sain ne doit rien porter d’orphelin');
  assert(ap.imputationsAppliquees.length === 1 &&
         ap.imputationsAppliquees[0].source === 'imposee',
    'le décor sain doit bien APPLIQUER son imputation, sinon il ne prouve rien');

  assert(JSON.stringify(sansLeChampAjoute(ap)) === JSON.stringify(av),
    'un mois sain doit être identique au champ ajouté près :' +
    '\n  avant ' + JSON.stringify(av) +
    '\n  après ' + JSON.stringify(sansLeChampAjoute(ap)));
});

test('§4 — poste à poste, les postes nommés du brief', function () {
  [CAS_ORPHELINE, CAS_SAIN].forEach(function (v, i) {
    var e = entrees(v);
    var av = Avant.calculerMois(e);
    var ap = Apres.calculerMois(e);
    var etiquette = i === 0 ? 'mois avec orpheline' : 'mois sain';

    [
      'salaireBrutCentimes', 'salaireNetCentimes',
      'salaireBrutProrataCentimes', 'salaireNetProrataCentimes',
      'brutDuCentimes', 'totalAVerserCentimes',
      'entretienCentimes', 'retenueSansSoldeCentimes',
      'joursPresence', 'joursSansEntretien',
      'minutesSupAcquises', 'minutesCpAcquis',
      'joursCongesDecomptes', 'minutesCpRestantesApresConsommation'
    ].forEach(function (poste) {
      assert(av[poste] === ap[poste],
        etiquette + ' — ' + poste + ' : avant ' + JSON.stringify(av[poste]) +
        ', après ' + JSON.stringify(ap[poste]));
    });

    assert(JSON.stringify(av.compteurSortie) === JSON.stringify(ap.compteurSortie),
      etiquette + ' — compteurSortie : avant ' + JSON.stringify(av.compteurSortie) +
      ', après ' + JSON.stringify(ap.compteurSortie));
    assert(JSON.stringify(av.imputation) === JSON.stringify(ap.imputation),
      etiquette + ' — imputation : avant ' + JSON.stringify(av.imputation) +
      ', après ' + JSON.stringify(ap.imputation));
    assert(JSON.stringify(av.imputationsAppliquees) ===
           JSON.stringify(ap.imputationsAppliquees),
      etiquette + ' — imputationsAppliquees a bougé');
  });
});

/* ------------------------------------------------------------------ */
/* Le différentiel LARGE : le produit croisé des décors plausibles.     */
/* Une égalité prouvée sur deux mois choisis prouve deux mois ; le lot   */
/* touche une boucle qui s'exécute sur TOUS les mois.                    */
/* ------------------------------------------------------------------ */

test('§4 — différentiel large : sur tous les décors croisés, rien ne bouge', function () {
  var MOIS = [[2026, 5], [2026, 6], [2025, 12], [2026, 2]];
  var PLANNINGS = [[1, 2, 3, 4, 5], [1, 2, 3, 4], [1, 2, 3, 4, 5, 6]];
  var ORDRES = ['cp_puis_sup', 'sup_puis_cp'];
  var COMPTEURS = [
    { minutesSup: 0, minutesCpAcquis: 0, minutesCpPris: 0 },
    { minutesSup: 600, minutesCpAcquis: 10800, minutesCpPris: 0 },
    { minutesSup: 2400, minutesCpAcquis: 5400, minutesCpPris: 2700 }
  ];
  /* Les six formes d'imputation qui comptent : rien, une saine, une
     orpheline, une orpheline à ventilation panachée, une orpheline au
     décompte FAUX (elle ne doit toujours faire tomber personne), et une qui
     recoupe la période sans la couvrir (déjà dite par `choixEcarte`). */
  var FORMES = ['aucune', 'saine', 'orpheline', 'orpheline_panachee',
                'orpheline_decompte_faux', 'recoupante'];

  var compares = 0;
  var refusIdentiques = 0;
  var avecOrpheline = 0;
  var sansOrpheline = 0;

  MOIS.forEach(function (am) {
    PLANNINGS.forEach(function (planning) {
      ORDRES.forEach(function (ordre) {
        COMPTEURS.forEach(function (compteur) {
          FORMES.forEach(function (forme) {
            var annee = am[0], mois = am[1];
            var d = function (j) {
              return annee + '-' + String(mois).padStart(2, '0') + '-' +
                String(j).padStart(2, '0');
            };
            var v = {
              annee: annee, mois: mois, planning: planning, ordre: ordre,
              compteurEntree: compteur, journees: [], imputations: []
            };
            if (forme === 'saine') {
              v.journees = [{ jour: d(11), type: 'conge_maria' },
                            { jour: d(12), type: 'conge_maria' }];
              v.imputations = [{ id: 'i', date_debut: d(11), date_fin: d(12),
                jours_ouvrables: null, jours_sur_cp: 0, jours_sur_sup: 0,
                jours_sans_solde: 0 }];
            } else if (forme === 'orpheline') {
              v.journees = [{ jour: d(15), type: 'sans_solde' }];
              v.imputations = [{ id: 'i', date_debut: d(15), date_fin: d(15),
                jours_ouvrables: 1, jours_sur_cp: 0, jours_sur_sup: 0,
                jours_sans_solde: 1 }];
            } else if (forme === 'orpheline_panachee') {
              v.imputations = [{ id: 'i', date_debut: d(4), date_fin: d(7),
                jours_ouvrables: 4, jours_sur_cp: 2, jours_sur_sup: 1,
                jours_sans_solde: 1 }];
            } else if (forme === 'orpheline_decompte_faux') {
              v.imputations = [{ id: 'i', date_debut: d(4), date_fin: d(7),
                jours_ouvrables: 99, jours_sur_cp: 99, jours_sur_sup: 0,
                jours_sans_solde: 0 }];
            } else if (forme === 'recoupante') {
              v.journees = [{ jour: d(11), type: 'conge_maria' },
                            { jour: d(12), type: 'conge_maria' }];
              v.imputations = [{ id: 'i', date_debut: d(12), date_fin: d(13),
                jours_ouvrables: null, jours_sur_cp: 0, jours_sur_sup: 0,
                jours_sans_solde: 0 }];
            }
            /* La ventilation d'une imputation saine doit couvrir le décompte
               RG-06 réel, sinon le moteur refuse — des deux côtés. On la
               demande au moteur d'AVANT : c'est lui la référence. */
            if (forme === 'saine' || forme === 'recoupante') {
              var imp = v.imputations[0];
              var n = Avant.decompterJoursOuvrables(imp.date_debut, imp.date_fin,
                planning, []);
              imp.jours_ouvrables = n;
              imp.jours_sur_cp = n;
            }

            var e = entrees(v);
            var etiquette = '[' + annee + '-' + mois + ' planning=' +
              planning.join('') + ' ordre=' + ordre + ' forme=' + forme +
              ' compteur=' + JSON.stringify(compteur) + ']';

            var av = null, ap = null, eAv = null, eAp = null;
            try { av = Avant.calculerMois(e); } catch (x) { eAv = x; }
            try { ap = Apres.calculerMois(e); } catch (x) { eAp = x; }

            if (eAv || eAp) {
              assert(eAv && eAp, etiquette + ' — un seul des deux moteurs refuse : ' +
                'avant=' + (eAv ? eAv.code || eAv.message : 'ok') +
                ' après=' + (eAp ? eAp.code || eAp.message : 'ok'));
              assert(eAv.code === eAp.code, etiquette +
                ' — codes différents : ' + eAv.code + ' / ' + eAp.code);
              refusIdentiques++;
              return;
            }

            assert(JSON.stringify(sansLeChampAjoute(ap)) === JSON.stringify(av),
              etiquette + ' — le mois a bougé :\n  avant ' + JSON.stringify(av) +
              '\n  après ' + JSON.stringify(sansLeChampAjoute(ap)));

            if (ap.imputationsOrphelines.length) avecOrpheline++;
            else sansOrpheline++;
            compares++;
          });
        });
      });
    });
  });

  assert(compares > 150, 'trop peu de mois calculés : ' + compares);
  /* Les deux populations que le §4 exige doivent être TOUTES DEUX peuplées :
     un différentiel vert où aucune orpheline n'apparaît ne prouverait rien. */
  assert(avecOrpheline > 50, 'trop peu de mois porteurs d’une orpheline : ' + avecOrpheline);
  assert(sansOrpheline > 50, 'trop peu de mois sans orpheline : ' + sansOrpheline);
});

module.exports = { cas: cas };
