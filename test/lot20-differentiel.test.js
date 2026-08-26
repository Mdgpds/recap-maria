/* ============================================================================
   lot20-differentiel.test.js — LA PREUVE DU CRITÈRE A1 DU §20.5.

     « Un mois entièrement hors familiarisation se calcule à l'identique de
       l'avant-lot (différentiel exhaustif). »

   Le lot 20 ouvre le moteur. C'est le seul lot du cycle à le faire, et c'est
   là qu'est tout le risque : une ligne déplacée dans `calculerMois` change un
   chiffre remis à une famille, sur un mois qui n'a rien à voir avec la
   familiarisation. Ce fichier confronte le moteur d'aujourd'hui au moteur
   FIGÉ d'avant le lot 20 (`test/fixtures/engine-avant-lot20.js`, copie exacte
   de `js/engine.js` au commit `7433800`) sur un produit croisé de mois, de
   plannings, de motifs de journées, d'imputations et de bornes de contrat.

   LA COMPARAISON EST EXHAUSTIVE PAR CONSTRUCTION : on ne liste pas les champs
   à vérifier — on sérialise les DEUX résultats entiers et on exige l'égalité
   stricte, après avoir retiré du nouveau les champs que le lot 20 AJOUTE.
   Lister les champs, c'est oublier celui qu'on vient d'écrire ; c'est
   exactement comme ça qu'une anomalie a échappé à 719 assertions en août.

   DEUX DIFFÉRENCES SONT ATTENDUES, et elles sont vérifiées positivement :

     1. les champs neufs du §20 — `familiarisation`, `joursSansEntretien`, et
        `prorata.joursFamiliarisation` — qui doivent valoir exactement leur
        valeur neutre sur un mois sans familiarisation ;
     2. §20.3, l'acquisition des congés payés : un mois contenant une journée
        `familiarisation` en acquiert désormais. Ces scénarios-là sont donc
        EXCLUS du différentiel strict et traités par leur propre assertion,
        plutôt qu'ignorés.

   Aucune journée du différentiel ne porte `entretien_du` : l'ancien moteur ne
   connaît pas la colonne. Le §20.6 a ses propres cas, dans
   `test/lot20-familiarisation.test.js`.
   ========================================================================= */
'use strict';

var Avant = require('./fixtures/engine-avant-lot20.js');
/* LOT 28 — CE DIFFÉRENTIEL DEVIENT UNE PREUVE HISTORIQUE, FIGÉE. Il
   confrontait le moteur d'avant ce lot-ci au moteur COURANT. Le lot 28 change
   des règles (acquisition des congés payés, minutes quand l'enfant est absent,
   renoncement borné, congés payés jamais négatifs) : le moteur courant ne
   rend plus ces chiffres-là, et c'est voulu. La preuve reste vraie entre les
   deux moteurs qu'elle comparait : `engine-avant-lot28.js` est la copie
   exacte de `js/engine.js` au commit `f2f9ac7`, celui que ce fichier testait.
   La preuve du lot 28 lui-même, contre le moteur courant, est
   `lot28-differentiel.test.js`. Aucune assertion n'est affaiblie : elle
   change de référence, pas de contenu. */
var Apres = require('./fixtures/engine-avant-lot28.js');
var FeriesSamedis = require('../js/feries.js');

var cas = [];
function test(nom, fn) { cas.push({ nom: nom, fn: fn }); }
function assert(cond, message) { if (!cond) throw new Error(message); }

function deux(n) { return String(n).padStart(2, '0'); }
function cle(a, m) { return a + '-' + deux(m); }

/* ------------------------------------------------------------------ */
/* Le décor                                                            */
/* ------------------------------------------------------------------ */

function conditions(v) {
  return {
    date_effet: '2020-01-01', numero: 1,
    jours_planning: v.planning,
    heure_arrivee: '08:30', heure_depart: '17:30',
    minutes_contractuelles: 540,
    minutes_sup_jour: v.minutesSupJour,
    minutes_par_jour_conge: v.mpjc,
    entretien_centimes_jour: v.entretien,
    sup_dues_si_enfant_absent: v.supDuesSiAbsent,
    ordre_imputation: v.ordre,
    brut_mensuel_centimes: v.brut,
    net_mensuel_centimes: v.net
  };
}

function contrat(v) {
  return { id: 'c1', date_debut: v.dateDebut || null, date_fin: v.dateFin || null };
}

/* ------------------------------------------------------------------ */
/* La matrice                                                          */
/* ------------------------------------------------------------------ */

var PLANNINGS = [[1, 2, 3, 4, 5], [1, 2, 3, 4], [1, 2, 3, 4, 5, 6], [2, 4]];

var MOIS = [
  [2026, 1], [2026, 2], [2026, 4], [2026, 5], [2026, 6],
  [2026, 7], [2026, 8], [2026, 9], [2026, 11], [2026, 12],
  [2025, 3], [2025, 4], [2025, 5], [2025, 8], [2024, 2]
];

var MPJC = [540, 480, 600];
var MINUTES_SUP_JOUR = [30, 0, 45];
var ORDRES = ['cp_puis_sup', 'sup_puis_cp'];
var ENTRETIENS = [550, 500, 0];
var SUP_DUES = [true, false];

var COMPTEURS = [
  { minutesSup: 0, minutesCpAcquis: 0, minutesCpPris: 0 },
  { minutesSup: 540, minutesCpAcquis: 5400, minutesCpPris: 0 },
  { minutesSup: 2700, minutesCpAcquis: 29700, minutesCpPris: 6480 },
  { minutesSup: -100, minutesCpAcquis: 10800, minutesCpPris: 48600 },
  { minutesSup: 100000, minutesCpAcquis: 540000, minutesCpPris: 540 }
];

var BORNES = [
  function () { return { dateDebut: '2000-01-01', dateFin: null }; },
  function (a, m) { return { dateDebut: cle(a, m) + '-16', dateFin: null }; },
  function (a, m) { return { dateDebut: '2000-01-01', dateFin: cle(a, m) + '-12' }; },
  function (a, m) { return { dateDebut: cle(a, m) + '-05', dateFin: cle(a, m) + '-22' }; },
  function (a, m) { return { dateDebut: cle(a, m) + '-01', dateFin: null }; }
];

/* Le motif n° 5 pose une journée `familiarisation` : c'est le seul que le
   §20.3 fait diverger, et il est traité à part plus bas. */
var MOTIF_FAMILIARISATION = 5;

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
    return [{ jour: j(6), type: 'conge_maria' }, { jour: j(7), type: 'conge_maria' },
            { jour: j(8), type: 'conge_maria' },
            { jour: j(14), type: 'absence_enfant' },
            { jour: j(20), type: 'presence', minutes_sup_exceptionnelles: 15 }];
  },
  /* §17.5 — les écarts d'horaire déclarés : eux, les DEUX moteurs les
     connaissent. Rien n'oblige à les exclure, et tout oblige à les couvrir :
     c'est sur ces journées-là que le §20.6 vient poser son interrupteur. */
  function (j) {
    return [{ jour: j(17), type: 'presence', ecart_minutes: -90,
              ecart_evenement: 'liberation_anticipee', ecart_impute_sur: 'recuperation' },
            { jour: j(18), type: 'presence', ecart_minutes: 12,
              ecart_evenement: 'retard_parent' },
            { jour: j(19), type: 'presence', ecart_minutes: -45,
              ecart_evenement: 'arrivee_decalee', ecart_impute_sur: 'conges_payes' }];
  }
];

/* Les samedis du scénario en cours : les constructeurs d'imputation en ont
   besoin pour que `jours_ouvrables` corresponde au décompte du moteur neuf. */
var samedisDuScenario = [];

var IMPUTATIONS = [
  function () { return []; },
  function (joursConge, planning) {
    if (!joursConge.length) return [];
    var n = Apres.decompterJoursOuvrables(joursConge[0], joursConge[joursConge.length - 1], planning,
      samedisDuScenario);
    return [{ date_debut: joursConge[0], date_fin: joursConge[joursConge.length - 1],
              jours_ouvrables: n, jours_sur_cp: 0, jours_sur_sup: 0, jours_sans_solde: n }];
  },
  function (joursConge, planning) {
    if (!joursConge.length) return [];
    var n = Apres.decompterJoursOuvrables(joursConge[0], joursConge[joursConge.length - 1], planning,
      samedisDuScenario);
    return [{ date_debut: joursConge[0], date_fin: joursConge[joursConge.length - 1],
              jours_ouvrables: n, jours_sur_cp: n, jours_sur_sup: 0, jours_sans_solde: 0 }];
  },
  /* Une imputation qui n'encadre PLUS les journées posées : c'est le chemin
     `defaut_choix_ecarte`, qu'un déplacement de ligne casserait en silence. */
  function (joursConge) {
    if (!joursConge.length) return [];
    return [{ date_debut: joursConge[0], date_fin: joursConge[0],
              jours_ouvrables: 1, jours_sur_cp: 1, jours_sur_sup: 0, jours_sans_solde: 0 }];
  }
];

function scenarios() {
  var out = [];
  var n = 0;
  for (var im = 0; im < MOIS.length; im++) {
    for (var ip = 0; ip < PLANNINGS.length; ip++) {
      for (var imo = 0; imo < MOTIFS.length; imo++) {
        for (var iimp = 0; iimp < IMPUTATIONS.length; iimp++) {
          for (var ib = 0; ib < BORNES.length; ib++) {
            var annee = MOIS[im][0], mois = MOIS[im][1];
            var b = BORNES[ib](annee, mois);
            out.push({
              annee: annee, mois: mois,
              planning: PLANNINGS[ip],
              motif: imo, imputation: iimp,
              mpjc: MPJC[n % MPJC.length],
              minutesSupJour: MINUTES_SUP_JOUR[(n + 1) % MINUTES_SUP_JOUR.length],
              ordre: ORDRES[(n + 2) % ORDRES.length],
              entretien: ENTRETIENS[(n + 1) % ENTRETIENS.length],
              supDuesSiAbsent: SUP_DUES[n % SUP_DUES.length],
              compteur: COMPTEURS[(n + 3) % COMPTEURS.length],
              brut: [137289, 132745, 140000, 0][n % 4],
              net: [105000, 107100, 0, 98765][(n + 1) % 4],
              dateDebut: b.dateDebut, dateFin: b.dateFin
            });
            n++;
          }
        }
      }
    }
  }
  return out;
}

/* LA RÈGLE DES CINQ SAMEDIS (specs du 24 août 2026) — POURQUOI CE FICHIER
   PASSE DÉSORMAIS DES SAMEDIS AU MOTEUR NEUF.

   Ce différentiel prouve qu'un lot antérieur n'a rien changé au calcul. Le
   moteur de référence, lui, comptait TOUS les samedis d'office. Pour que la
   comparaison porte encore sur ce qu'elle prouve, on passe au moteur neuf
   tous les samedis — c'est exactement la convention du §4.2 du lot des cinq
   samedis : « avec tous les samedis éligibles passés en entrée, le décompte
   doit être rigoureusement identique à celui d'avant ».

   AUCUNE ASSERTION N'EST AFFAIBLIE : la comparaison reste stricte, champ par
   champ. Seule l'entrée du moteur neuf gagne une clé que l'ancien n'a pas.
   La preuve que la règle mord vraiment est ailleurs, dans
   `lot23-differentiel.test.js`. */
function tousLesSamedis(annee, mois) {
  var out = [];
  var d = FeriesSamedis.ajouterJours(cle(annee, mois) + '-01', -20);
  var fin = FeriesSamedis.ajouterJours(cle(annee, mois) + '-01', 62);
  for (; d <= fin; d = FeriesSamedis.ajouterJours(d, 1)) {
    if (Apres.jourSemaine(d) === 6) out.push(d);
  }
  return out;
}

function journeesDe(v) {
  var prefixe = cle(v.annee, v.mois) + '-';
  var derniers = Apres.joursDuMois(v.annee, v.mois).length;
  function j(k) { return prefixe + deux(Math.min(k, derniers)); }
  return MOTIFS[v.motif](j);
}

/* Les champs que le lot 20 AJOUTE. On les retire du résultat neuf avant de
   comparer, APRÈS avoir vérifié qu'ils valent leur valeur neutre : ce qui
   reste doit alors être rigoureusement l'ancien objet. */
function detacherLesChampsDuLot20(ap, etiquette) {
  var copie = {};
  for (var k in ap) if (Object.prototype.hasOwnProperty.call(ap, k)) copie[k] = ap[k];

  assert(copie.joursSansEntretien === 0,
    etiquette + ' — joursSansEntretien devrait être nul : ' + copie.joursSansEntretien);
  var f = copie.familiarisation;
  assert(f && f.actif === false && f.joursDeLaPeriode === 0 && f.joursDeclares === 0 &&
         f.minutesDeclarees === 0 && f.joursAvecEntretien === 0 &&
         f.entretienCentimes === 0 && f.brutCentimes === 0 && f.netCentimes === 0 &&
         f.joursIgnores.length === 0 && f.jours.length === 0,
    etiquette + ' — le bloc familiarisation devrait être entièrement neutre : ' +
    JSON.stringify(f));
  delete copie.joursSansEntretien;
  delete copie.familiarisation;

  var prorata = {};
  for (var p in copie.prorata) if (Object.prototype.hasOwnProperty.call(copie.prorata, p)) {
    prorata[p] = copie.prorata[p];
  }
  assert(prorata.joursFamiliarisation === 0,
    etiquette + ' — prorata.joursFamiliarisation devrait être nul');
  delete prorata.joursFamiliarisation;
  copie.prorata = prorata;
  return copie;
}

/* ------------------------------------------------------------------ */

test('A1 — différentiel exhaustif : hors familiarisation, rien ne bouge', function () {
  var liste = scenarios();
  assert(liste.length > 3000,
    'le différentiel doit être exhaustif : ' + liste.length + ' scénarios seulement');

  var compares = 0;
  var refusIdentiques = 0;
  var acquisitionsChangees = 0;

  for (var i = 0; i < liste.length; i++) {
    var v = liste[i];
    var journees = journeesDe(v);
    var joursConge = journees.filter(function (x) { return x.type === 'conge_maria'; })
                             .map(function (x) { return x.jour; }).sort();
    samedisDuScenario = tousLesSamedis(v.annee, v.mois);
    var imputations = IMPUTATIONS[v.imputation](joursConge, v.planning, v.mpjc);

    var etiquette = 'scénario #' + i + ' [' + cle(v.annee, v.mois) +
      ' planning=' + v.planning.join('') + ' motif=' + v.motif +
      ' imputation=' + v.imputation + ' mpjc=' + v.mpjc +
      ' bornes=' + v.dateDebut + '→' + (v.dateFin || '∞') + ']';

    /* LES MÊMES ENTRÉES, au sens strict : le même objet passé aux deux
       moteurs. Rien ne distingue les appels, sauf `periodesFamiliarisation`,
       absent — c'est tout l'objet du critère A1. */
    var entrees = {
      contrat: contrat(v),
      conditions: conditions(v),
      journees: journees,
      compteurEntree: {
        minutesSup: v.compteur.minutesSup,
        minutesCpAcquis: v.compteur.minutesCpAcquis,
        minutesCpPris: v.compteur.minutesCpPris
      },
      annee: v.annee, mois: v.mois, imputations: imputations,
      samedisComptes: samedisDuScenario
    };

    var av = null, ap = null, eAv = null, eAp = null;
    try { av = Avant.calculerMois(entrees); } catch (e) { eAv = e; }
    try { ap = Apres.calculerMois(entrees); } catch (e) { eAp = e; }

    if (eAv || eAp) {
      assert(eAv && eAp, etiquette + ' — un seul des deux moteurs refuse : avant=' +
        (eAv ? eAv.code || eAv.message : 'ok') + ' après=' +
        (eAp ? eAp.code || eAp.message : 'ok'));
      assert(eAv.code === eAp.code,
        etiquette + ' — codes d’erreur différents : ' + eAv.code + ' / ' + eAp.code);
      refusIdentiques++;
      continue;
    }

    var apNu = detacherLesChampsDuLot20(ap, etiquette);

    if (v.motif === MOTIF_FAMILIARISATION) {
      /* §20.3 — la seule divergence voulue. On la vérifie sur les DEUX
         bornes : l'acquisition, qui change ; et tout le reste, qui ne change
         pas d'un centime. */
      if (av.minutesCpAcquis !== apNu.minutesCpAcquis) {
        assert(av.minutesCpAcquis === 0,
          etiquette + ' — l’ancien moteur devrait n’acquérir aucun CP : ' + av.minutesCpAcquis);
        assert(apNu.minutesCpAcquis === Apres.minutesCpParMois(conditions(v)),
          etiquette + ' — le nouveau devrait acquérir un mois plein : ' + apNu.minutesCpAcquis);
        acquisitionsChangees++;
      }
      var avSansCp = JSON.parse(JSON.stringify(av));
      var apSansCp = JSON.parse(JSON.stringify(apNu));
      avSansCp.minutesCpAcquis = apSansCp.minutesCpAcquis = 0;
      avSansCp.compteurSortie.minutesCpAcquis = apSansCp.compteurSortie.minutesCpAcquis = 0;
      assert(JSON.stringify(avSansCp) === JSON.stringify(apSansCp),
        etiquette + ' — hors acquisition, le mois devrait être identique :\n  avant ' +
        JSON.stringify(avSansCp) + '\n  après ' + JSON.stringify(apSansCp));
      compares++;
      continue;
    }

    assert(JSON.stringify(av) === JSON.stringify(apNu),
      etiquette + ' — résultat différent :\n  avant ' + JSON.stringify(av) +
      '\n  après ' + JSON.stringify(apNu));
    compares++;
  }

  assert(compares > 2000, 'trop peu de mois calculés : ' + compares);
  assert(refusIdentiques > 20,
    'trop peu de refus rencontrés (' + refusIdentiques +
    ') : la matrice ne teste pas les gardes du moteur');
  assert(acquisitionsChangees > 20,
    'la divergence voulue du §20.3 n’a presque pas été rencontrée (' +
    acquisitionsChangees + ') : le différentiel ne prouve pas grand-chose');
});

test('A1 bis — sans période, `partCouverteDuMois` rend le même couple qu’avant', function () {
  var v = { planning: [1, 2, 3, 4, 5], dateDebut: '2026-09-16', dateFin: null };
  var av = Avant.partCouverteDuMois(contrat(v), v.planning, 2026, 9);
  var ap = Apres.partCouverteDuMois(contrat(v), v.planning, 2026, 9);
  assert(av.joursCouverts === ap.joursCouverts && av.joursDuMois === ap.joursDuMois,
    'le prorata a bougé sans période : ' + JSON.stringify(av) + ' / ' + JSON.stringify(ap));
  assert(ap.joursFamiliarisation === 0, 'joursFamiliarisation devrait être nul');
  var vide = Apres.partCouverteDuMois(contrat(v), v.planning, 2026, 9, []);
  assert(vide.joursCouverts === ap.joursCouverts,
    'une liste de périodes VIDE ne doit rien changer non plus');
});

module.exports = { cas: cas };
