/* ============================================================================
   parcours-anticipation.test.js — LOT 31 §6 : LES CONGÉS PAYÉS PAR
   ANTICIPATION, SUR LE MOIS EN COURS SEULEMENT.

   La règle, donnée par Adrien : Maria peut poser des congés payés qu'elle n'a
   pas encore acquis — mais UNIQUEMENT pour des jours du mois en cours. Ce sont
   les 2,5 jours qu'elle est en train d'acquérir. Pour un mois à venir, seuls
   les jours déjà acquis sont posables.

   Ce que ce fichier prouve, dans l'ordre du §9.2 :
     - anticipation ACCEPTÉE sur le mois en cours ;
     - REFUSÉE sur le mois suivant ;
     - JAMAIS au-delà de deux jours ;
   et trois choses de plus, que le §6 promet et qu'un test doit tenir :
     - sans `aujourdhui`, le moteur ne change pas d'un iota (il reste pur) ;
     - la récupération garde son droit au négatif (lot précédent) ;
     - les congés payés ne descendent pas au-delà de la borne, jamais.

   Valeurs FICTIVES : ce dépôt est public.

   Lancement : node test/parcours-anticipation.test.js  (ou via test/run.js)
   ========================================================================= */
'use strict';

var Engine = require('../js/engine.js');

var MPJ = 540;                       // une journée de congé, en minutes
var DEUX_JOURS = 2 * MPJ;

function conditions(v) {
  return {
    date_effet: '2020-01-01', numero: 1,
    jours_planning: (v && v.planning) || [1, 2, 3, 4, 5],
    heure_arrivee: '08:30', heure_depart: '17:30',
    minutes_contractuelles: 540,
    minutes_sup_jour: 30,
    minutes_par_jour_conge: MPJ,
    entretien_centimes_jour: 550,
    sup_dues_si_enfant_absent: true,
    ordre_imputation: 'cp_puis_sup',
    brut_mensuel_centimes: 137289, net_mensuel_centimes: 105000
  };
}

/* Un décor volontairement nu : un mois de septembre 2026, des congés posés du
   mardi 1er au jour demandé, ventilés ENTIÈREMENT sur les congés payés — c'est
   la ventilation qui déclenchait le refus. Le compteur d'entrée porte
   exactement `cpJours` jours acquis : tout ce qui dépasse est de
   l'anticipation, et rien d'autre. */
function decor(v) {
  var jours = [];
  for (var i = 0; i < v.nbJours; i++) {
    jours.push({ jour: v.premierJour(i), type: 'conge_maria' });
  }
  return {
    contrat: { id: 'c1', date_debut: '2000-01-01', date_fin: null },
    conditions: conditions(v),
    journees: jours,
    compteurEntree: {
      minutesSup: v.minutesSup == null ? 0 : v.minutesSup,
      minutesCpAcquis: v.cpJours * MPJ,
      minutesCpPris: 0
    },
    annee: v.annee, mois: v.mois,
    imputations: [{
      id: 'i1', date_debut: v.debut, date_fin: v.fin,
      jours_ouvrables: v.nbJours,
      jours_sur_cp: v.surCp, jours_sur_sup: v.surSup || 0,
      jours_sans_solde: v.nbJours - v.surCp - (v.surSup || 0)
    }],
    samedisComptes: [],
    minutesCpAcquisesExercice: 0,
    aujourdhui: v.aujourdhui
  };
}

/* Septembre 2026 : mardi 1er, et les jours ouvrés qui suivent. */
var OUVRES_SEPT = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04',
                   '2026-09-07', '2026-09-08'];
var OUVRES_OCT = ['2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06'];

function moisDe(liste, n, opts) {
  var o = opts || {};
  var v = {
    annee: Number(liste[0].slice(0, 4)), mois: Number(liste[0].slice(5, 7)),
    nbJours: n, debut: liste[0], fin: liste[n - 1],
    premierJour: function (i) { return liste[i]; },
    surCp: o.surCp == null ? n : o.surCp,
    surSup: o.surSup || 0,
    cpJours: o.cpJours == null ? 0 : o.cpJours,
    minutesSup: o.minutesSup,
    aujourdhui: o.aujourdhui
  };
  return decor(v);
}

function calcule(entrees) {
  try { return { r: Engine.calculerMois(entrees), e: null }; }
  catch (x) { return { r: null, e: x }; }
}

var cas = [];
function test(nom, fn) { cas.push({ nom: nom, fn: fn }); }
function assert(cond, msg) { if (!cond) throw new Error(msg); }

/* ------------------------------------------------------------------------ */
/* 1. ACCEPTÉE SUR LE MOIS EN COURS                                          */
/* ------------------------------------------------------------------------ */

test('§6 — deux jours par anticipation sont ACCEPTÉS sur le mois en cours',
  function () {
    /* Zéro jour acquis, deux jours posés sur les congés payés, on est le
       8 septembre : les deux jours sont ceux que Maria est en train
       d'acquérir. */
    var out = calcule(moisDe(OUVRES_SEPT, 2,
      { cpJours: 0, aujourdhui: '2026-09-08' }));
    assert(!out.e, 'la pose doit être acceptée, obtenu : ' + (out.e && out.e.code));
    assert(out.r.imputation.joursSurCp === 2,
      'les deux jours sont bien imputés sur les congés payés, pas basculés en ' +
      'sans solde en silence (obtenu ' + out.r.imputation.joursSurCp + ')');
    assert(out.r.imputation.joursSansSolde === 0,
      'et AUCUN jour ne part en sans solde — une retenue sur salaire que ' +
      'Maria n’a pas décidée serait pire qu’un refus');
  });

test('§6 — un seul jour anticipé passe aussi, évidemment', function () {
  var out = calcule(moisDe(OUVRES_SEPT, 1, { cpJours: 0, aujourdhui: '2026-09-08' }));
  assert(!out.e, 'un jour anticipé est accepté');
  assert(out.r.imputation.joursSurCp === 1, 'et il est sur les congés payés');
});

test('§6 — l’anticipation s’AJOUTE au disponible, elle ne le remplace pas',
  function () {
    /* Trois jours acquis, cinq posés : trois financés + deux anticipés. */
    var out = calcule(moisDe(OUVRES_SEPT, 5, { cpJours: 3, aujourdhui: '2026-09-08' }));
    assert(!out.e, 'trois acquis plus deux anticipés : accepté (obtenu ' +
      (out.e && out.e.code) + ')');
    assert(out.r.imputation.joursSurCp === 5, 'les cinq jours sont sur les congés payés');
  });

/* ------------------------------------------------------------------------ */
/* 2. JAMAIS AU-DELÀ DE DEUX JOURS                                           */
/* ------------------------------------------------------------------------ */

test('§9.2 — JAMAIS au-delà de deux jours, même sur le mois en cours',
  function () {
    var out = calcule(moisDe(OUVRES_SEPT, 3, { cpJours: 0, aujourdhui: '2026-09-08' }));
    assert(out.e, 'trois jours anticipés doivent être REFUSÉS');
    assert(out.e.code === 'IMPUTATION_DEPASSE_RESERVES',
      'et le refus garde son code : ' + out.e.code);
  });

test('§9.2 — la borne se compte en jours de congé, pas en jours calendaires',
  function () {
    /* Quatre acquis, sept posés : trois de trop, un de plus que la borne. */
    var out = calcule(moisDe(OUVRES_SEPT, 6,
      { cpJours: 3, aujourdhui: '2026-09-08' }));
    assert(out.e && out.e.code === 'IMPUTATION_DEPASSE_RESERVES',
      'trois jours au-delà du disponible sont refusés, même avec du disponible');
  });

/* ------------------------------------------------------------------------ */
/* 3. REFUSÉE SUR LE MOIS SUIVANT                                            */
/* ------------------------------------------------------------------------ */

test('§6 — REFUSÉE sur un mois à venir : seuls les jours acquis sont posables',
  function () {
    /* Le même décor, à un mois près : la période est en octobre, on est le
       8 septembre. Rien n'est acquis, donc rien n'est posable. */
    var out = calcule(moisDe(OUVRES_OCT, 2, { cpJours: 0, aujourdhui: '2026-09-08' }));
    assert(out.e, 'la pose sur le mois suivant doit être refusée');
    assert(out.e.code === 'IMPUTATION_DEPASSE_RESERVES',
      'avec le code des réserves : ' + out.e.code);
  });

test('§6 — et acceptée sur ce même mois d’octobre une fois qu’on y est',
  function () {
    var out = calcule(moisDe(OUVRES_OCT, 2, { cpJours: 0, aujourdhui: '2026-10-05' }));
    assert(!out.e,
      'le mois d’octobre devenu le mois en cours, l’anticipation est ouverte ' +
      '(obtenu ' + (out.e && out.e.code) + ')');
  });

test('§6 — un mois PASSÉ n’ouvre aucune anticipation non plus', function () {
  var out = calcule(moisDe(OUVRES_SEPT, 2, { cpJours: 0, aujourdhui: '2026-10-05' }));
  assert(out.e && out.e.code === 'IMPUTATION_DEPASSE_RESERVES',
    'septembre relu en octobre ne rouvre pas l’anticipation — sinon un mois ' +
    'refusé deviendrait posable en changeant de page de calendrier');
});

/* ------------------------------------------------------------------------ */
/* 4. LE MOTEUR RESTE PUR                                                    */
/* ------------------------------------------------------------------------ */

test('§6 — sans `aujourdhui`, le moteur se comporte comme avant ce lot',
  function () {
    var out = calcule(moisDe(OUVRES_SEPT, 2, { cpJours: 0 }));
    assert(out.e && out.e.code === 'IMPUTATION_DEPASSE_RESERVES',
      'aucune anticipation sans mois de référence : le moteur ne lit pas ' +
      'l’horloge, il reçoit la date');
  });

test('§6 — aucune horloge n’est entrée dans le moteur par ce lot', function () {
  var source = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'js', 'engine.js'), 'utf8');
  assert(source.indexOf('new Date()') === -1, 'aucun `new Date()` dans le moteur');
  assert(source.indexOf('Date.now') === -1, 'aucun `Date.now` dans le moteur');
});

/* ------------------------------------------------------------------------ */
/* 5. CE QUI NE BOUGE PAS                                                    */
/* ------------------------------------------------------------------------ */

test('§6 — la RÉCUPÉRATION garde son droit au négatif (lot précédent)',
  function () {
    /* Aucune récupération disponible, deux jours posés dessus : accepté, et
       le compteur descend. Ce lot n'y touche pas. */
    var out = calcule(moisDe(OUVRES_SEPT, 2,
      { surCp: 0, surSup: 2, cpJours: 0, minutesSup: 0, aujourdhui: '2026-09-08' }));
    assert(!out.e, 'une récupération dépassée reste acceptée (obtenu ' +
      (out.e && out.e.code) + ')');
    assert(out.r.compteurSortie.minutesSup < 0,
      'et le compteur de récupération passe bien en négatif (obtenu ' +
      out.r.compteurSortie.minutesSup + ')');
  });

test('§6 — les congés payés ne descendent QUE de ce qui a été autorisé',
  function () {
    var out = calcule(moisDe(OUVRES_SEPT, 2, { cpJours: 0, aujourdhui: '2026-09-08' }));
    var cs = out.r.compteurSortie;
    var solde = cs.minutesCpAcquis - cs.minutesCpPris;
    assert(solde >= -DEUX_JOURS,
      'le solde de congés payés ne descend pas au-delà de deux jours (obtenu ' +
      solde + ' min, borne ' + (-DEUX_JOURS) + ')');
    /* Et il descend VRAIMENT : l'anticipation est une consommation, pas un
       cadeau. Ce sont les mêmes minutes, prises un peu plus tôt. */
    assert(cs.minutesCpPris === DEUX_JOURS,
      'les deux jours anticipés sont bien COMPTÉS comme pris (obtenu ' +
      cs.minutesCpPris + ')');
  });

test('§6 — le total versé ne cache aucune retenue : rien en sans solde',
  function () {
    var out = calcule(moisDe(OUVRES_SEPT, 2, { cpJours: 0, aujourdhui: '2026-09-08' }));
    assert(out.r.retenueSansSoldeCentimes === 0,
      'aucune retenue de sans solde sur une pose entièrement anticipée');
  });

module.exports = { cas: cas };

/* Lancement direct, hors du runner. */
if (require.main === module) {
  var echecs = 0;
  cas.forEach(function (c) {
    try { c.fn(); console.log('  ✓ ' + c.nom); }
    catch (e) { echecs++; console.error('  ✗ ' + c.nom + '\n      ' + e.message); }
  });
  console.log('');
  if (echecs) { console.error(echecs + ' échec(s)'); process.exit(1); }
  console.log('Tout est conforme.');
}
