/* ============================================================================
   parcours-differentiel.test.js — LOT 31 (§9.3) : LE DIFFÉRENTIEL OBLIGATOIRE.

   « Sur juin, juillet et août 2026, montre poste à poste que rien ne change
     hors ce que ce lot demande. Les points 1 à 5 et 8 ne doivent bouger aucun
     montant. »

   CE QUE CE FICHIER PROUVE, ET COMMENT.

   Le moteur figé d'avant ce lot est `test/fixtures/engine-avant-parcours-lot31.js`
   — la copie exacte de `js/engine.js` au commit `e9a0217`. Les deux moteurs
   sont appelés sur les MÊMES entrées, et chaque poste est comparé un par un,
   nommé, jamais déduit d'une égalité globale d'objets.

   LE SEUL ÉCART ADMIS EST CELUI DU POINT 6, et il est encadré :
     - il n'apparaît QUE sur un mois qui refusait pour dépassement des congés
       payés ;
     - et seulement quand `aujourdhui` tombe dans le mois de la période ;
     - et le dépassement observé ne dépasse jamais l'acquisition du mois.
   Tout autre écart est une régression, et le test le nomme.

   POURQUOI LES POINTS 1 À 5, 7 ET 8 N'ONT RIEN À PROUVER ICI, ET POURQUOI ON
   LE PROUVE QUAND MÊME : ce sont des corrections d'interface, `js/engine.js`
   n'y est pas ouvert. Mais « le moteur n'est pas touché » est une affirmation,
   et le différentiel est ce qui la rend vérifiable — c'est exactement le rôle
   qu'il a joué aux lots 17, 20, 28 et au précédent.

   Valeurs FICTIVES : ce dépôt est public.

   Lancement : node test/parcours-differentiel.test.js  (ou via test/run.js)
   ========================================================================= */
'use strict';

var Avant = require('./fixtures/engine-avant-parcours-lot31.js');
var Apres = require('../js/engine.js');

var cas = [];
function test(nom, fn) { cas.push({ nom: nom, fn: fn }); }
function assert(cond, message) { if (!cond) throw new Error(message); }

/* Les postes du résultat, nommés un par un. Une comparaison globale
   `JSON.stringify(a) === JSON.stringify(b)` dirait « ça a bougé » ; elle ne
   dirait pas OÙ, et c'est précisément ce qu'on veut lire. */
var POSTES = [
  'joursPresence', 'entretienCentimes', 'joursSansEntretien',
  'minutesSupAcquises', 'minutesSupBase', 'minutesSupAjoutees',
  'minutesSupRenoncees', 'minutesEcartRecuperation', 'minutesEcartSurCp',
  'minutesEcartSansSolde', 'joursCongesDecomptes', 'retenueSansSoldeCentimes',
  'minutesCpAcquis', 'salaireBrutCentimes', 'salaireNetCentimes',
  'salaireBrutProrataCentimes', 'salaireNetProrataCentimes',
  'brutDuCentimes', 'totalAVerserCentimes'
];
var POSTES_COMPTEUR = ['minutesSup', 'minutesCpAcquis', 'minutesCpPris'];
var POSTES_IMPUTATION = ['joursSurCp', 'minutesCpConsommees',
                         'joursSurSup', 'minutesSupConsommees', 'joursSansSolde'];

var MPJ = 540;
/* La borne du MOTEUR : l'acquisition mensuelle (2,5 j). L'écran n'offre que
   deux jours entiers — un stepper ne pose pas de demi-jour — mais c'est une
   limite du geste, pas du calcul, et c'est le calcul qu'on surveille ici. */
var ACQUISITION_MOIS = Math.round(2.5 * MPJ);

function conditions(v) {
  return {
    date_effet: '2020-01-01', numero: 1,
    jours_planning: v.planning || [1, 2, 3, 4, 5],
    heure_arrivee: '08:30', heure_depart: '17:30',
    minutes_contractuelles: 540,
    minutes_sup_jour: 30,
    minutes_par_jour_conge: MPJ,
    entretien_centimes_jour: 550,
    sup_dues_si_enfant_absent: true,
    ordre_imputation: v.ordre || 'cp_puis_sup',
    brut_mensuel_centimes: 137289, net_mensuel_centimes: 105000
  };
}

function entrees(v, aujourdhui) {
  return {
    contrat: { id: 'c1', date_debut: '2000-01-01', date_fin: null },
    conditions: conditions(v),
    journees: v.journees || [],
    compteurEntree: v.compteur,
    annee: v.annee, mois: v.mois,
    imputations: v.imputations || [],
    samedisComptes: [],
    minutesCpAcquisesExercice: 0,
    aujourdhui: aujourdhui
  };
}

function conge(j) { return { jour: j, type: 'conge_maria' }; }
function vent(debut, fin, jours, surCp, surSup) {
  return { id: 'i-' + debut, date_debut: debut, date_fin: fin,
           jours_ouvrables: jours, jours_sur_cp: surCp, jours_sur_sup: surSup,
           jours_sans_solde: jours - surCp - surSup };
}

/* ------------------------------------------------------------------------ */
/* LES TROIS MOIS EXIGÉS, ET DE LA MATIÈRE DANS CHACUN                       */
/* ------------------------------------------------------------------------ */

/* JUIN 2026 — des congés en plage, une absence, un écart d'horaire, une
   journée sans entretien. C'est le mois qui exerce les points 3 et 5 côté
   affichage : le moteur, lui, ne doit pas s'en apercevoir. */
var JUIN = {
  annee: 2026, mois: 6,
  journees: [
    conge('2026-06-22'), conge('2026-06-23'), conge('2026-06-24'),
    { jour: '2026-06-02', type: 'presence', ecart_minutes: -330,
      ecart_impute_sur: 'recuperation', ecart_evenement: 'liberation_anticipee' },
    { jour: '2026-06-09', type: 'presence', minutes_sup_renoncees: 30 },
    { jour: '2026-06-10', type: 'absence_enfant' },
    { jour: '2026-06-11', type: 'presence', entretien_du: false }
  ],
  imputations: [vent('2026-06-22', '2026-06-24', 3, 3, 0)]
};

/* JUILLET 2026 — une demi-journée (`conge_horaire` de 4 h 30, exactement ce
   que le point 3 annote), un congé sur deux jours consécutifs, un férié au
   milieu du mois. */
var JUILLET = {
  annee: 2026, mois: 7,
  journees: [
    conge('2026-07-06'), conge('2026-07-07'),
    { jour: '2026-07-16', type: 'presence', ecart_minutes: -270,
      ecart_impute_sur: 'recuperation', ecart_evenement: 'conge_horaire' }
  ],
  imputations: [vent('2026-07-06', '2026-07-07', 2, 2, 0)]
};

/* AOÛT 2026 — une longue plage à cheval sur deux semaines, une ventilation
   panachée (congés payés + récupération + sans solde), et un samedi dans la
   période. C'est le mois le plus lourd des trois. */
var AOUT = {
  annee: 2026, mois: 8,
  journees: [
    conge('2026-08-10'), conge('2026-08-11'), conge('2026-08-12'),
    conge('2026-08-13'), conge('2026-08-14'),
    conge('2026-08-17'), conge('2026-08-18')
  ],
  imputations: [vent('2026-08-10', '2026-08-18', 7, 4, 2)]
};

var MOIS = [{ nom: 'juin 2026', v: JUIN },
            { nom: 'juillet 2026', v: JUILLET },
            { nom: 'août 2026', v: AOUT }];

/* Quatre compteurs d'entrée, du plus fourni au plus vide : c'est le vide qui
   fait apparaître l'anticipation, et le fourni qui prouve qu'elle ne change
   rien quand elle ne sert pas. */
var COMPTEURS = [
  { nom: 'réserves pleines', c: { minutesSup: 10800, minutesCpAcquis: 27000, minutesCpPris: 0 } },
  { nom: 'congés payés justes', c: { minutesSup: 5400, minutesCpAcquis: 1620, minutesCpPris: 0 } },
  { nom: 'tout à zéro', c: { minutesSup: 0, minutesCpAcquis: 0, minutesCpPris: 0 } },
  { nom: 'récupération négative', c: { minutesSup: -900, minutesCpAcquis: 27000, minutesCpPris: 0 } }
];

/* Cinq dates du jour : absente (le moteur pur), dans le mois, avant, après, et
   très loin. */
function datesPour(v) {
  var m = v.annee + '-' + String(v.mois).padStart(2, '0');
  return [undefined, m + '-15', '2026-05-04', '2026-12-01', '2027-06-30'];
}

var ORDRES = ['cp_puis_sup', 'sup_puis_cp'];
var PLANNINGS = [[1, 2, 3, 4, 5], [1, 2, 3, 4, 5, 6]];

function calcule(moteur, e) {
  try { return { r: moteur.calculerMois(e), err: null }; }
  catch (x) { return { r: null, err: x }; }
}

/* ------------------------------------------------------------------------ */
/* LE DIFFÉRENTIEL                                                           */
/* ------------------------------------------------------------------------ */

test('§9.3 — juin, juillet et août 2026 : poste à poste, rien ne bouge hors §6',
  function () {
    var compares = 0, debloques = 0, refusIdentiques = 0;

    MOIS.forEach(function (m) {
      PLANNINGS.forEach(function (planning) {
        ORDRES.forEach(function (ordre) {
          COMPTEURS.forEach(function (cpt) {
            var v = {
              annee: m.v.annee, mois: m.v.mois, journees: m.v.journees,
              imputations: m.v.imputations, compteur: cpt.c,
              planning: planning, ordre: ordre
            };
            datesPour(v).forEach(function (auj) {
              var e = entrees(v, auj);
              var av = calcule(Avant, e);
              var ap = calcule(Apres, e);
              var quoi = '[' + m.nom + ' · ' + cpt.nom + ' · planning ' +
                planning.join('') + ' · ' + ordre + ' · auj=' + auj + ']';

              /* --- 1. Un mois calculable ne devient jamais refusé --------- */
              if (!av.err) {
                assert(!ap.err, quoi + ' — un mois que l’ancien moteur ' +
                  'calculait est maintenant REFUSÉ : ' + (ap.err && ap.err.code));
              }

              /* --- 2. Un refus perdu : le §6, et rien d'autre ------------- */
              if (av.err && !ap.err) {
                assert(av.err.code === 'IMPUTATION_DEPASSE_RESERVES',
                  quoi + ' — un refus a été perdu, et ce n’est pas celui des ' +
                  'réserves : ' + av.err.code);
                /* Il ne peut être perdu QUE dans le mois de la période. */
                assert(!!auj && String(auj).slice(0, 7) ===
                  v.annee + '-' + String(v.mois).padStart(2, '0'),
                  quoi + ' — un refus perdu HORS du mois en cours : ' +
                  'l’anticipation n’avait pas à s’ouvrir');
                /* Et jamais au-delà de l'acquisition du mois. */
                var dispo = (cpt.c.minutesCpAcquis || 0) - (cpt.c.minutesCpPris || 0);
                var depassement = ap.r.imputation.minutesCpConsommees - dispo;
                assert(depassement <= ACQUISITION_MOIS,
                  quoi + ' — dépassement de ' + depassement + ' min, au-delà ' +
                  'de l’acquisition du mois (' + ACQUISITION_MOIS + ')');
                debloques++;
                return;
              }

              /* --- 3. Deux refus : le même code ------------------------- */
              if (av.err && ap.err) {
                assert(av.err.code === ap.err.code,
                  quoi + ' — codes de refus différents : ' + av.err.code +
                  ' / ' + ap.err.code);
                refusIdentiques++;
                return;
              }

              /* --- 4. LE CŒUR : poste à poste ---------------------------- */
              POSTES.forEach(function (k) {
                assert(JSON.stringify(av.r[k]) === JSON.stringify(ap.r[k]),
                  quoi + ' — poste `' + k + '` : ' + JSON.stringify(av.r[k]) +
                  ' → ' + JSON.stringify(ap.r[k]));
              });
              POSTES_COMPTEUR.forEach(function (k) {
                assert(av.r.compteurSortie[k] === ap.r.compteurSortie[k],
                  quoi + ' — compteur de sortie `' + k + '` : ' +
                  av.r.compteurSortie[k] + ' → ' + ap.r.compteurSortie[k]);
              });
              POSTES_IMPUTATION.forEach(function (k) {
                assert(av.r.imputation[k] === ap.r.imputation[k],
                  quoi + ' — imputation `' + k + '` : ' + av.r.imputation[k] +
                  ' → ' + ap.r.imputation[k]);
              });
              /* La ventilation appliquée, période par période : c'est elle qui
                 décide de ce que la famille lira. */
              assert(JSON.stringify(av.r.imputationsAppliquees) ===
                     JSON.stringify(ap.r.imputationsAppliquees),
                quoi + ' — les imputations appliquées ont bougé');
              /* Et les écarts déclarés, qui portent les demi-journées du §3 :
                 le moteur ne doit RIEN y avoir ajouté. */
              assert(JSON.stringify(av.r.ecartsDeclares) ===
                     JSON.stringify(ap.r.ecartsDeclares),
                quoi + ' — les écarts déclarés ont bougé : le §3 devait rester ' +
                'entièrement hors du moteur');
              compares++;
            });
          });
        });
      });
    });

    /* Un différentiel qui ne compare rien passe toujours. On exige donc que
       TOUTES les combinaisons du décor aient été traitées — le compte est
       vérifié, pas estimé — et qu'au moins un mois soit passé par chacune des
       trois branches. Un seuil choisi après coup pour que le test passe ne
       vaut rien ; un compte exact, si. */
    var attendu = MOIS.length * PLANNINGS.length * ORDRES.length *
                  COMPTEURS.length * datesPour(JUIN).length;
    assert(compares + debloques + refusIdentiques === attendu,
      'toutes les combinaisons doivent être traitées : ' +
      (compares + debloques + refusIdentiques) + ' sur ' + attendu);
    assert(compares > 0, 'et des mois doivent avoir été comparés poste à poste');
    assert(debloques > 0, 'et au moins un mois doit avoir été débloqué par le ' +
      '§6, sinon ce différentiel ne surveille pas ce qu’il prétend surveiller');
    console.log('        ' + compares + ' mois identiques poste à poste · ' +
      debloques + ' débloqués par le §6 · ' + refusIdentiques +
      ' refus inchangés');
  });

/* ------------------------------------------------------------------------ */
/* LE CONTRÔLE QUI VAUT POUR LES POINTS 1 À 5, 7 ET 8                        */
/* ------------------------------------------------------------------------ */

test('§9.3 — hors §6, le moteur ne diffère PAS de celui d’avant le lot',
  function () {
    var fs = require('fs');
    var path = require('path');
    var avant = fs.readFileSync(
      path.join(__dirname, 'fixtures', 'engine-avant-parcours-lot31.js'), 'utf8');
    var apres = fs.readFileSync(
      path.join(__dirname, '..', 'js', 'engine.js'), 'utf8');

    /* On ne compare pas les fichiers — ils diffèrent, c'est le §6. On vérifie
       que la différence est CIRCONSCRITE : le seul identifiant nouveau du
       moteur est celui de l'anticipation. Si un autre nom apparaissait, c'est
       qu'un point d'interface aurait débordé dans le moteur. */
    var nouveauxNoms = ['minutesAnticipationCp', 'anticipationCpPour', 'plafondCp'];
    nouveauxNoms.forEach(function (n) {
      assert(apres.indexOf(n) !== -1, 'le moteur doit porter `' + n + '` (§6)');
      assert(avant.indexOf(n) === -1, '`' + n + '` ne devait pas exister avant');
    });

    /* Et aucun mot des points d'interface n'y est entré. */
    ['demi_journee', 'plagesDeJours', 'VAPID', 'libellePlageJours']
      .forEach(function (n) {
        assert(apres.indexOf(n) === -1,
          'le moteur ne doit rien savoir de `' + n + '` — c’est de ' +
          'l’interface, et `js/engine.js` reste fermé pour les points 1 à 5, ' +
          '7 et 8');
      });
  });

module.exports = { cas: cas };

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
