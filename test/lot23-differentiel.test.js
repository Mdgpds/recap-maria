/* ============================================================================
   lot23-differentiel.test.js — LA PREUVE DU CRITÈRE A1 DU §4.2 ET DU §9.

     « Avec tous les samedis éligibles passés en entrée, le décompte doit être
       rigoureusement identique à celui d'avant le lot. »

   La règle des cinq samedis rouvre `js/engine.js`, et elle touche RG-06 —
   c'est-à-dire le chiffre que les familles contestent depuis toujours, et
   celui qui a déjà été remis sur des documents. Une ligne déplacée dans
   `joursOuvrablesParMois` change un décompte, donc une imputation, donc des
   congés payés consommés, donc un total à verser.

   Ce fichier confronte le moteur d'aujourd'hui au moteur FIGÉ d'avant le lot
   (`test/fixtures/engine-avant-cinq-samedis.js`, copie exacte de
   `js/engine.js` au commit `53d4030`) sur un produit croisé de mois, de
   plannings, de motifs de journées, d'imputations et de bornes de contrat —
   EN LUI PASSANT TOUS LES SAMEDIS. Puisque l'ancien moteur comptait tous les
   samedis d'office, les deux doivent alors rendre exactement la même chose.

   LA COMPARAISON EST EXHAUSTIVE PAR CONSTRUCTION : on ne liste pas les champs
   à vérifier — on sérialise les DEUX résultats entiers et on exige l'égalité
   stricte. Lister les champs, c'est oublier celui qu'on vient d'écrire.

   AUCUN CHAMP N'EST RETIRÉ AVANT COMPARAISON, contrairement aux différentiels
   des lots 17 et 20 : ce lot n'ajoute aucun champ au résultat. Il change la
   valeur d'un décompte, et cette valeur doit être identique. Le moindre écart
   est bloquant.

   Le second cas de ce fichier prouve l'autre moitié : SANS les samedis, le
   décompte baisse bien — sinon le différentiel serait vert parce que rien
   n'aurait changé du tout.
   ========================================================================= */
'use strict';

var Avant = require('./fixtures/engine-avant-cinq-samedis.js');
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
var Feries = require('../js/feries.js');

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

var IMPUTATIONS = [
  function () { return []; },
  function (joursConge, planning, mpjc, samedis) {
    if (!joursConge.length) return [];
    var n = Apres.decompterJoursOuvrables(joursConge[0], joursConge[joursConge.length - 1],
      planning, samedis);
    return [{ date_debut: joursConge[0], date_fin: joursConge[joursConge.length - 1],
              jours_ouvrables: n, jours_sur_cp: 0, jours_sur_sup: 0, jours_sans_solde: n }];
  },
  function (joursConge, planning, mpjc, samedis) {
    if (!joursConge.length) return [];
    var n = Apres.decompterJoursOuvrables(joursConge[0], joursConge[joursConge.length - 1],
      planning, samedis);
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

/* TOUS LES SAMEDIS d'une fenêtre large autour du mois. Le §4.2 demande « tous
   les samedis éligibles » ; on en passe davantage, ce qui est plus sévère et
   jamais plus permissif : un samedi hors période n'entre dans aucun décompte,
   et un samedi du planning ou férié suit sa propre règle quoi qu'il arrive. */
function tousLesSamedis(annee, mois) {
  var out = [];
  var d = Feries.ajouterJours(cle(annee, mois) + '-01', -20);
  var fin = Feries.ajouterJours(cle(annee, mois) + '-01', 62);
  for (; d <= fin; d = Feries.ajouterJours(d, 1)) {
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

test('A1 — différentiel exhaustif : tous les samedis passés, rien ne bouge', function () {
  var liste = scenarios();
  assert(liste.length > 3000,
    'le différentiel doit être exhaustif : ' + liste.length + ' scénarios seulement');

  var compares = 0;
  var refusIdentiques = 0;

  for (var i = 0; i < liste.length; i++) {
    var v = liste[i];
    var journees = journeesDe(v);
    var joursConge = journees.filter(function (x) { return x.type === 'conge_maria'; })
                             .map(function (x) { return x.jour; }).sort();
    var samedis = tousLesSamedis(v.annee, v.mois);
    var imputations = IMPUTATIONS[v.imputation](joursConge, v.planning, v.mpjc, samedis);

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
      annee: v.annee, mois: v.mois, imputations: imputations
    };
    /* Les MÊMES entrées pour les deux moteurs, à une clé près : l'ancien
       ignore `samedisComptes` (il comptait tous les samedis d'office), le
       neuf la lit. C'est tout l'objet du critère A1. */
    var entreesApres = {};
    for (var k in entrees) if (Object.prototype.hasOwnProperty.call(entrees, k)) {
      entreesApres[k] = entrees[k];
    }
    entreesApres.samedisComptes = samedis;

    var av = null, ap = null, eAv = null, eAp = null;
    try { av = Avant.calculerMois(entrees); } catch (e) { eAv = e; }
    try { ap = Apres.calculerMois(entreesApres); } catch (e) { eAp = e; }

    if (eAv || eAp) {
      assert(eAv && eAp, etiquette + ' — un seul des deux moteurs refuse : avant=' +
        (eAv ? eAv.code || eAv.message : 'ok') + ' après=' +
        (eAp ? eAp.code || eAp.message : 'ok'));
      assert(eAv.code === eAp.code,
        etiquette + ' — codes d’erreur différents : ' + eAv.code + ' / ' + eAp.code);
      refusIdentiques++;
      continue;
    }

    /* AUCUN CHAMP N'EST RETIRÉ : ce lot n'en ajoute pas au résultat. Il change
       la valeur d'un décompte, et cette valeur doit être identique dès lors
       que tous les samedis sont passés. */
    assert(JSON.stringify(av) === JSON.stringify(ap),
      etiquette + ' — résultat différent :\n  avant ' + JSON.stringify(av) +
      '\n  après ' + JSON.stringify(ap));
    compares++;
  }

  assert(compares > 2000, 'trop peu de mois calculés : ' + compares);
  assert(refusIdentiques > 20,
    'trop peu de refus rencontrés (' + refusIdentiques +
    ') : la matrice ne teste pas les gardes du moteur');
});

/* SANS CE SECOND CAS, LE PREMIER NE PROUVERAIT RIEN. Un différentiel vert
   peut vouloir dire « rien n'a changé » — y compris parce que le code neuf
   ignore son nouveau paramètre. On exige donc que le décompte BAISSE quand
   les samedis ne sont pas passés, sur les mêmes scénarios. */
test('A1 bis — sans les samedis, le décompte baisse : la règle mord vraiment',
  function () {
    var liste = scenarios();
    var baisses = 0;
    var identiques = 0;

    for (var i = 0; i < liste.length; i++) {
      var v = liste[i];
      var journees = journeesDe(v);
      var joursConge = journees.filter(function (x) { return x.type === 'conge_maria'; })
                               .map(function (x) { return x.jour; }).sort();
      if (!joursConge.length) continue;
      var samedis = tousLesSamedis(v.annee, v.mois);

      var avecTout = Apres.decompterJoursOuvrables(
        joursConge[0], joursConge[joursConge.length - 1], v.planning, samedis);
      var sansRien = Apres.decompterJoursOuvrables(
        joursConge[0], joursConge[joursConge.length - 1], v.planning);
      var eligibles = Apres.samedisEligibles(
        joursConge[0], joursConge[joursConge.length - 1], v.planning);

      assert(sansRien === avecTout - eligibles.length,
        'scénario #' + i + ' — l’écart doit valoir exactement le nombre de ' +
        'samedis éligibles : ' + avecTout + ' → ' + sansRien + ' pour ' +
        eligibles.length + ' samedi(s) éligible(s)');
      if (eligibles.length) baisses++; else identiques++;
    }

    assert(baisses > 200, 'trop peu de périodes portant un samedi éligible : ' + baisses);
    assert(identiques > 0,
      'aucune période sans samedi éligible : la matrice ne couvre pas le ' +
      'contrat qui travaille le samedi');
  });

test('A2 — une semaine posée du lundi au vendredi compte 5 jours, 6 avec le samedi',
  function () {
    var planning = [1, 2, 3, 4, 5];
    assert(Apres.decompterJoursOuvrables('2026-10-19', '2026-10-23', planning) === 5,
      'A2 : sans samedi coché, la semaine compte 5 jours');
    assert(Apres.decompterJoursOuvrables('2026-10-19', '2026-10-23', planning,
      ['2026-10-24']) === 6, 'A3 : avec le samedi coché, elle en compte 6');
    assert(Avant.decompterJoursOuvrables('2026-10-19', '2026-10-23', planning) === 6,
      'et l’ancien moteur en comptait 6 d’office — c’est bien la règle qui change');
  });

test('A4 — trois semaines proposent trois samedis, séparément', function () {
  var s = Apres.samedisEligibles('2026-10-05', '2026-10-23', [1, 2, 3, 4, 5]);
  assert(s.length === 3 && s[0] === '2026-10-10' && s[1] === '2026-10-17' &&
         s[2] === '2026-10-24',
    'A4 : trois samedis distincts, dont celui qui prolonge la dernière semaine : ' +
    JSON.stringify(s));
  assert(Apres.decompterJoursOuvrables('2026-10-05', '2026-10-23', [1, 2, 3, 4, 5],
    ['2026-10-17']) === 16, 'A4 : cocher le deuxième seulement ajoute un jour, pas trois');
});

test('A8 — un samedi du planning se décompte d’office et n’est jamais proposé',
  function () {
    var planning = [1, 2, 3, 4, 5, 6];
    assert(Apres.samedisEligibles('2026-10-19', '2026-10-24', planning).length === 0,
      'A8 : aucun choix sur un contrat qui garde le samedi');
    assert(Apres.decompterJoursOuvrables('2026-10-19', '2026-10-24', planning) === 6,
      'A8 : et le samedi posé se décompte sans qu’aucun samedi ne soit coché');
  });

test('A9 — un samedi férié n’est jamais décompté et n’est jamais proposé', function () {
  var planning = [1, 2, 3, 4, 5];
  /* Le samedi 15 août 2026 est férié. */
  assert(Apres.samedisEligibles('2026-08-10', '2026-08-14', planning).length === 0,
    'A9 : le samedi férié n’est pas un choix');
  assert(Apres.decompterJoursOuvrables('2026-08-10', '2026-08-14', planning) === 5,
    'A9 : et il n’est pas décompté');
  assert(Apres.decompterJoursOuvrables('2026-08-10', '2026-08-14', planning,
    ['2026-08-15']) === 5,
    'A9 : le passer en entrée ne le fait pas décompter pour autant');
});

test('A13 — une période à cheval sur le 31 mai propose ses samedis des deux années',
  function () {
    /* Du lundi 25 mai au samedi 6 juin 2026 : samedis le 30 mai et le 6 juin. */
    var s = Apres.samedisEligibles('2026-05-25', '2026-06-05', [1, 2, 3, 4, 5]);
    assert(s.length === 2 && s[0] === '2026-05-30' && s[1] === '2026-06-06',
      'A13 : les deux samedis sont proposés, chacun dans son année de référence : ' +
      JSON.stringify(s));
    /* Le décompte de la période, lui, n'est PAS scindé. */
    assert(Apres.decompterJoursOuvrables('2026-05-25', '2026-06-05', [1, 2, 3, 4, 5],
      s) === Avant.decompterJoursOuvrables('2026-05-25', '2026-06-05', [1, 2, 3, 4, 5]),
      'A13 : avec les deux samedis, le décompte reste celui d’avant le lot');
  });

module.exports = { cas: cas };
