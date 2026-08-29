/* ============================================================================
   lot31-orphelines.test.js — L'IMPUTATION QUI NE RECOUVRE RIEN EST NOMMÉE.

   Brief du 28 août 2026 : « je ne veux pas que tu corriges seulement pour ce
   cas-là, je veux que le problème ne se représente plus. »

   Une période de congé vit dans DEUX endroits — des journées `conge_maria` et
   une ligne `imputation_conge`. Quand l'imputation ne recouvre AUCUNE période
   regroupée, le moteur ne disait rien : la ventilation choisie par Maria était
   perdue en silence et les jours étaient recomptés comme travaillés.

   Ce fichier vérifie ce que le §3.1 demande, et RIEN de plus : le moteur
   constate, il ne lève pas, il ne change aucun montant. La preuve qu'aucun
   montant ne bouge vit dans `test/lot31-differentiel.test.js`.

   Valeurs FICTIVES (dépôt public).
   ========================================================================= */
'use strict';

var Engine = require('../js/engine.js');

var cas = [];
function test(nom, fn) { cas.push({ nom: nom, fn: fn }); }
function assert(cond, message) { if (!cond) throw new Error(message); }
function egal(obtenu, attendu, libelle) {
  if (obtenu !== attendu) {
    throw new Error(libelle + ' : attendu ' + JSON.stringify(attendu) +
      ', obtenu ' + JSON.stringify(obtenu));
  }
}

function conditions(planning) {
  return {
    date_effet: '2020-01-01', numero: 1,
    jours_planning: planning || [1, 2, 3, 4, 5],
    heure_arrivee: '08:30', heure_depart: '17:30',
    minutes_contractuelles: 540, minutes_sup_jour: 30,
    minutes_par_jour_conge: 540, entretien_centimes_jour: 550,
    sup_dues_si_enfant_absent: true, ordre_imputation: 'cp_puis_sup',
    brut_mensuel_centimes: 137289, net_mensuel_centimes: 105000
  };
}

function calculer(v) {
  return Engine.calculerMois({
    contrat: { id: 'c1', date_debut: '2000-01-01', date_fin: null },
    conditions: conditions(v.planning),
    journees: v.journees || [],
    compteurEntree: v.compteurEntree ||
      { minutesSup: 3000, minutesCpAcquis: 16200, minutesCpPris: 0 },
    annee: v.annee || 2026, mois: v.mois || 5,
    imputations: v.imputations || [],
    samedisComptes: v.samedisComptes || []
  });
}

/* ------------------------------------------------------------------ */

test('§3.1 — le cas du brief : une imputation sans aucune journée SORT dans imputationsOrphelines',
  function () {
    var r = calculer({
      journees: [{ jour: '2026-05-15', type: 'sans_solde' }],
      imputations: [{ date_debut: '2026-05-15', date_fin: '2026-05-15',
        jours_ouvrables: 1, jours_sur_cp: 0, jours_sur_sup: 0, jours_sans_solde: 1 }]
    });
    egal(r.imputationsOrphelines.length, 1, 'une orpheline nommée');
    egal(r.imputationsOrphelines[0].date_debut, '2026-05-15', 'date_debut');
    egal(r.imputationsOrphelines[0].date_fin, '2026-05-15', 'date_fin');
    egal(r.imputationsOrphelines[0].joursSansSolde, 1,
      'la ventilation qu’elle demandait est restituée');
    /* Elle n'a rien appliqué : c'est précisément le défaut qu'on nomme. */
    egal(r.imputationsAppliquees.length, 0, 'aucune imputation appliquée');
  });

test('§3.1 — la ventilation demandée est restituée ENTIÈRE, panachée comprise',
  function () {
    var r = calculer({
      imputations: [{ date_debut: '2026-05-04', date_fin: '2026-05-07',
        jours_ouvrables: 4, jours_sur_cp: 2, jours_sur_sup: 1, jours_sans_solde: 1 }]
    });
    egal(r.imputationsOrphelines.length, 1, 'une orpheline');
    var o = r.imputationsOrphelines[0];
    egal(o.joursSurCp, 2, 'joursSurCp');
    egal(o.joursSurSup, 1, 'joursSurSup');
    egal(o.joursSansSolde, 1, 'joursSansSolde');
    egal(o.joursOuvrables, 4, 'le décompte de la part du mois');
  });

test('§3.1 — une imputation qui recouvre correctement N’Y FIGURE PAS', function () {
  var r = calculer({
    journees: [
      { jour: '2026-05-11', type: 'conge_maria' },
      { jour: '2026-05-12', type: 'conge_maria' },
      { jour: '2026-05-13', type: 'conge_maria' },
      { jour: '2026-05-15', type: 'conge_maria' }
    ],
    imputations: [{ date_debut: '2026-05-11', date_fin: '2026-05-15',
      jours_ouvrables: 4, jours_sur_cp: 4, jours_sur_sup: 0, jours_sans_solde: 0 }]
  });
  egal(r.imputationsOrphelines.length, 0, 'aucune orpheline');
  egal(r.imputationsAppliquees.length, 1, 'la période est appliquée');
  egal(r.imputationsAppliquees[0].source, 'imposee', 'la ventilation de Maria s’applique');
});

test('§3.1 — une imputation au décompte FAUX lève toujours IMPUTATION_INCOMPLETE et n’est PAS orpheline',
  function () {
    var v = {
      journees: [
        { jour: '2026-05-11', type: 'conge_maria' },
        { jour: '2026-05-12', type: 'conge_maria' },
        { jour: '2026-05-13', type: 'conge_maria' },
        { jour: '2026-05-15', type: 'conge_maria' }
      ],
      /* Le décompte RG-06 réel est 4 (le jeudi 14 est l'Ascension) : 5 est
         faux, et le moteur doit continuer de le refuser franchement. */
      imputations: [{ date_debut: '2026-05-11', date_fin: '2026-05-15',
        jours_ouvrables: 5, jours_sur_cp: 5, jours_sur_sup: 0, jours_sans_solde: 0 }]
    };
    var leve = null;
    try { calculer(v); } catch (e) { leve = e; }
    assert(leve, 'le moteur doit refuser un décompte faux');
    egal(leve.code, 'IMPUTATION_INCOMPLETE', 'le code de refus est inchangé');
    egal(leve.attendu, 4, 'le décompte RG-06 réel est toujours porté par l’erreur');
    egal(leve.recu, 5, 'la somme reçue est toujours portée par l’erreur');
  });

test('§3.1 — LE MOTEUR NE LÈVE JAMAIS pour une orpheline, même au décompte absurde',
  function () {
    /* Une orpheline au décompte faux ne doit pas faire tomber le mois : un
       mois qu'on ne peut plus lire est pire qu'un mois qui signale un défaut.
       C'est pour ça que le constat n'appelle pas `repartirImputationParMois`. */
    var r = calculer({
      imputations: [{ date_debut: '2026-05-04', date_fin: '2026-05-07',
        jours_ouvrables: 99, jours_sur_cp: 99, jours_sur_sup: 0, jours_sans_solde: 0 }]
    });
    egal(r.imputationsOrphelines.length, 1, 'elle est nommée');
    assert(typeof r.totalAVerserCentimes === 'number', 'et le mois reste calculé');
  });

test('§3.1 — la liste est VIDE dans le cas ordinaire, comme imputationsEcartees',
  function () {
    var r = calculer({ journees: [{ jour: '2026-05-12', type: 'presence' }] });
    assert(Array.isArray(r.imputationsOrphelines), 'la clé existe toujours');
    egal(r.imputationsOrphelines.length, 0, 'et elle est vide');
  });

test('§3.1 — une imputation qui RECOUPE une période sans la couvrir n’est pas orpheline',
  function () {
    /* Ce cas-là est déjà dit, autrement : le moteur reprend l'ordre par
       défaut du contrat et marque `choixEcarte`. Le classer orphelin ferait
       dire deux fois la même chose, avec deux remèdes contradictoires. */
    var r = calculer({
      journees: [
        { jour: '2026-05-11', type: 'conge_maria' },
        { jour: '2026-05-12', type: 'conge_maria' }
      ],
      imputations: [{ date_debut: '2026-05-12', date_fin: '2026-05-13',
        jours_ouvrables: 2, jours_sur_cp: 2, jours_sur_sup: 0, jours_sans_solde: 0 }]
    });
    egal(r.imputationsOrphelines.length, 0, 'aucune orpheline');
    egal(r.imputationsAppliquees[0].source, 'defaut_choix_ecarte',
      'le choix écarté reste dit comme avant');
  });

test('§3.1 — une imputation à cheval n’est déclarée orpheline QUE dans le mois qu’elle porte',
  function () {
    /* Du dimanche 31 mai au vendredi 5 juin : mai n'en porte aucun jour
       ouvrable. La déclarer orpheline en mai enverrait Maria chercher une
       période qui n'a rien à y faire. */
    var imp = [{ date_debut: '2026-05-31', date_fin: '2026-06-05',
      jours_ouvrables: 5, jours_sur_cp: 5, jours_sur_sup: 0, jours_sans_solde: 0 }];
    var mai = calculer({ annee: 2026, mois: 5, imputations: imp });
    var juin = calculer({ annee: 2026, mois: 6, imputations: imp });
    egal(mai.imputationsOrphelines.length, 0, 'mai n’en porte aucun jour ouvrable');
    egal(juin.imputationsOrphelines.length, 1, 'juin la porte, et la nomme');
    egal(juin.imputationsOrphelines[0].joursOuvrables, 5, 'la part de juin');
  });

test('§3.1 — deux orphelines dans le même mois sont TOUTES DEUX nommées', function () {
  var r = calculer({
    imputations: [
      { date_debut: '2026-05-04', date_fin: '2026-05-07',
        jours_ouvrables: 4, jours_sur_cp: 4, jours_sur_sup: 0, jours_sans_solde: 0 },
      { date_debut: '2026-05-18', date_fin: '2026-05-19',
        jours_ouvrables: 2, jours_sur_cp: 0, jours_sur_sup: 2, jours_sans_solde: 0 }
    ]
  });
  egal(r.imputationsOrphelines.length, 2, 'les deux sont nommées');
  egal(r.imputationsOrphelines[0].date_debut, '2026-05-04', 'la première');
  egal(r.imputationsOrphelines[1].date_debut, '2026-05-18', 'la seconde');
});

test('§4 — le moteur reste PUR : ni réseau, ni DOM, ni horloge', function () {
  var source = require('fs').readFileSync(require('path')
    .join(__dirname, '..', 'js', 'engine.js'), 'utf8');
  var bloc = source.slice(source.indexOf('var imputationsOrphelines = []'),
    source.indexOf('var imputationsOrphelines = []') + 2000);
  assert(bloc.indexOf('Date') === -1, 'aucune horloge dans le constat');
  assert(bloc.indexOf('document') === -1, 'aucun DOM dans le constat');
  assert(bloc.indexOf('fetch') === -1, 'aucun réseau dans le constat');
});

module.exports = { cas: cas };
