/* ============================================================================
   REDESIGN 2A §0.2 et §10.3 — LE DIFFÉRENTIEL, ET IL DOIT ÊTRE VIDE.

   « Aucun montant ne change. Aucune règle de calcul ne change. Aucune
     migration. »
   « Si une modification de ce lot fait bouger un centime, c'est une anomalie,
     pas une amélioration. Le différentiel poste à poste sur juin, juillet et
     août 2026 doit être STRICTEMENT NUL. C'est la preuve principale de ce
     lot. »

   CE FICHIER LE PROUVE DEUX FOIS, PAR DEUX CHEMINS QUI NE SE RECOUVRENT PAS.

   1. PAR LA SOURCE. Les quatre fichiers de calcul — `engine.js`, `feries.js`,
      `format.js`, `chaine-mois.js` — ne sont pas touchés par ce lot. On le
      vérifie par leur EMPREINTE, gelée ici. Une empreinte tient en une ligne
      là où une copie du moteur pèse 130 ko, et elle dit la même chose : si
      l'un d'eux change, ce test le nomme.

      C'est la preuve la plus forte qu'on puisse donner du §0.2 : un fichier
      qui n'a pas changé d'un octet ne peut pas rendre un centime différent.

   2. PAR LES NOMBRES. Une empreinte ne dit rien du jour où quelqu'un modifiera
      le moteur EXPRÈS et mettra l'empreinte à jour dans la foulée. On rejoue
      donc juin, juillet et août 2026 sur un décor qui exerce ce que le lot
      touche — un congé de trois jours, une absence, des heures
      supplémentaires ajoutées, un départ avant l'heure imputé sur la
      récupération, une journée non travaillée — et on compare VINGT-TROIS
      POSTES à une table figée. Un centime qui bouge est nommé, avec son mois
      et son poste.

   Décor FICTIF et rond : le dépôt est public.

   Lancement : node test/redesign-differentiel.test.js
   ========================================================================= */
'use strict';

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

var racine = path.join(__dirname, '..');

var echecs = 0;
function assert(cond, msg) {
  if (!cond) { echecs++; console.error('FAIL ' + msg); } else { console.log('ok   ' + msg); }
}

/* ------------------------------------------------------------------------ */
/* 1. PAR LA SOURCE — les quatre fichiers de calcul n'ont pas bougé          */
/* ------------------------------------------------------------------------ */

console.log('\n--- §0.2 : les quatre fichiers de calcul ne sont pas touchés ---');

/* Empreintes prises sur `main` au moment d'ouvrir la branche
   `feat/redesign-2a` (commit `c82302d`). */
var EMPREINTES = {
  'js/engine.js': '63ba76b0476569a2c9c46d2a6e6e1f4af0c908198500cfece46137051f53a444',
  'js/feries.js': '561add743b6c054110756e786121d91b33d1c7ea0c3fe8b44a3d84e9510e81d8',
  'js/format.js': 'a56b675943143734ef9f4f24970a10cb2ab1c6f6e0e8d7a5f4abdd6bfcc04f89',
  'js/chaine-mois.js': 'cc43f84e5b5ed46863de007bbdb54bc312ac0d8cca25be15f8109284f46f0eba'
};

function empreinte(rel) {
  return crypto.createHash('sha256')
    .update(fs.readFileSync(path.join(racine, rel)))
    .digest('hex');
}

Object.keys(EMPREINTES).forEach(function (rel) {
  var attendue = EMPREINTES[rel];
  var reelle = empreinte(rel);
  assert(reelle === attendue,
    '§0.2 : ' + rel + ' est inchangé' + (reelle === attendue ? '' :
      '\n       attendu ' + attendue + '\n       obtenu  ' + reelle +
      '\n       >>> Si ce fichier a été modifié VOLONTAIREMENT, ce lot n’est ' +
      'plus « le redesign » : il rouvre le moteur, et il lui faut son propre ' +
      'différentiel contre le moteur d’avant, comme les lots 17, 20, 23, 28 ' +
      'et 31. Mettre l’empreinte à jour sans ce différentiel, c’est retirer ' +
      'le garde-fou au lieu de répondre à la question qu’il pose.'));
});

/* ------------------------------------------------------------------------ */
/* 2. PAR LES NOMBRES — vingt-trois postes, trois mois, aucun écart          */
/* ------------------------------------------------------------------------ */

console.log('\n--- §10.3 : juin, juillet et août 2026, poste à poste ---');

global.window = global;
var Feries = require(path.join(racine, 'js/feries.js'));
require(path.join(racine, 'js/format.js'));
var Engine = require(path.join(racine, 'js/engine.js'));

var CONDITIONS = {
  minutes_contractuelles: 540,
  minutes_sup_jour: 30,
  minutes_par_jour_conge: 540,
  entretien_centimes_jour: 550,
  jours_planning: [1, 2, 3, 4, 5],
  heure_arrivee: '08:30:00',
  heure_depart: '17:30:00',
  brut_mensuel_centimes: 140400,
  net_mensuel_centimes: 107100,
  sup_dues_si_enfant_absent: true,
  ordre_imputation: 'cp_puis_sup',
  samedis_comptes: true
};
var CONTRAT = { id: 'c1', date_debut: '2025-09-01', date_fin: null };

/* Le décor exerce EXACTEMENT ce que le lot touche à l'écran : un congé de
   trois jours collés (§4.4, la période colorée en entier), une absence
   (§3.2, l'étage 2), des heures ajoutées (§4.6, le repli qui s'ouvre), un
   départ avant l'heure imputé sur la récupération (§4.4, l'état `ec` neuf),
   et une journée non travaillée. */
var JOURNEES = {
  '2026-06-22': { jour: '2026-06-22', type: 'conge_maria' },
  '2026-06-23': { jour: '2026-06-23', type: 'conge_maria' },
  '2026-06-24': { jour: '2026-06-24', type: 'conge_maria' },
  '2026-07-08': { jour: '2026-07-08', type: 'absence_enfant' },
  '2026-07-15': { jour: '2026-07-15', type: 'presence', minutes_sup_exceptionnelles: 45 },
  '2026-08-05': { jour: '2026-08-05', type: 'presence',
    ecart_minutes: -60, ecart_evenement: 'liberation_anticipee',
    ecart_heure_reelle: '16:30:00', ecart_impute_sur: 'recuperation' },
  '2026-08-12': { jour: '2026-08-12', type: 'hors_planning' }
};

var POSTES = ['joursPresence', 'entretienCentimes', 'joursSansEntretien',
  'minutesSupAcquises', 'minutesSupBase', 'minutesSupAjoutees', 'minutesSupRenoncees',
  'minutesEcartRecuperation', 'minutesEcartSurCp', 'minutesEcartSansSolde',
  'minutesCpRestantesApresConsommation', 'joursCongesDecomptes',
  'recuperationNegative', 'minutesRecuperationNegative', 'retenueSansSoldeCentimes',
  'minutesCpAcquis', 'uniteCp', 'salaireBrutCentimes', 'salaireNetCentimes',
  'salaireBrutProrataCentimes', 'salaireNetProrataCentimes', 'brutDuCentimes',
  'totalAVerserCentimes'];

/* La table de référence, figée AVANT le redesign. */
var REFERENCE = [
  { mois: 6, postes: 'joursPresence=19 entretienCentimes=10450 joursSansEntretien=0 minutesSupAcquises=570 minutesSupBase=570 minutesSupAjoutees=0 minutesSupRenoncees=0 minutesEcartRecuperation=0 minutesEcartSurCp=0 minutesEcartSansSolde=0 minutesCpRestantesApresConsommation=0 joursCongesDecomptes=3 recuperationNegative=false minutesRecuperationNegative=0 retenueSansSoldeCentimes=12960 minutesCpAcquis=1350 uniteCp=minutes salaireBrutCentimes=140400 salaireNetCentimes=107100 salaireBrutProrataCentimes=140400 salaireNetProrataCentimes=107100 brutDuCentimes=127440 totalAVerserCentimes=104590' },
  { mois: 7, postes: 'joursPresence=21 entretienCentimes=11550 joursSansEntretien=0 minutesSupAcquises=675 minutesSupBase=630 minutesSupAjoutees=45 minutesSupRenoncees=0 minutesEcartRecuperation=0 minutesEcartSurCp=0 minutesEcartSansSolde=0 minutesCpRestantesApresConsommation=0 joursCongesDecomptes=0 recuperationNegative=false minutesRecuperationNegative=0 retenueSansSoldeCentimes=0 minutesCpAcquis=1350 uniteCp=minutes salaireBrutCentimes=140400 salaireNetCentimes=107100 salaireBrutProrataCentimes=140400 salaireNetProrataCentimes=107100 brutDuCentimes=140400 totalAVerserCentimes=118650' },
  { mois: 8, postes: 'joursPresence=20 entretienCentimes=11000 joursSansEntretien=0 minutesSupAcquises=540 minutesSupBase=600 minutesSupAjoutees=0 minutesSupRenoncees=0 minutesEcartRecuperation=-60 minutesEcartSurCp=0 minutesEcartSansSolde=0 minutesCpRestantesApresConsommation=0 joursCongesDecomptes=0 recuperationNegative=false minutesRecuperationNegative=0 retenueSansSoldeCentimes=0 minutesCpAcquis=1350 uniteCp=minutes salaireBrutCentimes=140400 salaireNetCentimes=107100 salaireBrutProrataCentimes=140400 salaireNetProrataCentimes=107100 brutDuCentimes=140400 totalAVerserCentimes=118100' }
];

REFERENCE.forEach(function (attendu) {
  var journees = Object.keys(JOURNEES)
    .filter(function (d) { return Number(d.slice(5, 7)) === attendu.mois; })
    .map(function (d) { return JOURNEES[d]; });
  var r = Engine.calculerMois({
    contrat: CONTRAT, conditions: CONDITIONS, annee: 2026, mois: attendu.mois,
    journees: journees, compteurEntree: { minutesSup: 900, minutesCp: 5400 },
    feries: Feries
  });
  var obtenu = POSTES.map(function (p) {
    return p + '=' + (r[p] == null ? 'null' : r[p]);
  }).join(' ');

  if (obtenu === attendu.postes) {
    assert(true, '2026-' + attendu.mois + ' : les ' + POSTES.length +
      ' postes sont identiques');
    return;
  }
  /* On NOMME l'écart, poste par poste : « le différentiel n'est pas vide » ne
     dit pas où chercher. */
  var a = attendu.postes.split(' ');
  var o = obtenu.split(' ');
  a.forEach(function (x, i) {
    if (x !== o[i]) {
      assert(false, '2026-' + attendu.mois + ' : ÉCART sur ' + x.split('=')[0] +
        ' — attendu ' + x.split('=')[1] + ', obtenu ' + (o[i] || '').split('=')[1]);
    }
  });
});

/* ------------------------------------------------------------------------ */
/* 3. LA PREUVE QUE LE DIFFÉRENTIEL MORD                                     */
/* ------------------------------------------------------------------------ */

/* Un différentiel qui ne sait pas dénoncer un écart ne prouve rien — et
   celui-ci est la preuve PRINCIPALE du lot. On perturbe donc un poste d'un
   centime et on vérifie qu'il est nommé, avec son mois et son poste. */

console.log('\n--- la preuve que le différentiel mord ---');

(function () {
  var attendu = REFERENCE[0];
  var faux = attendu.postes.replace(/totalAVerserCentimes=(\d+)/, function (_, v) {
    return 'totalAVerserCentimes=' + (Number(v) + 1);
  });
  assert(faux !== attendu.postes, 'la perturbation a bien changé un centime');

  var journees = Object.keys(JOURNEES)
    .filter(function (d) { return Number(d.slice(5, 7)) === attendu.mois; })
    .map(function (d) { return JOURNEES[d]; });
  var r = Engine.calculerMois({
    contrat: CONTRAT, conditions: CONDITIONS, annee: 2026, mois: attendu.mois,
    journees: journees, compteurEntree: { minutesSup: 900, minutesCp: 5400 },
    feries: Feries
  });
  var obtenu = POSTES.map(function (p) {
    return p + '=' + (r[p] == null ? 'null' : r[p]);
  }).join(' ');

  var a = faux.split(' ');
  var o = obtenu.split(' ');
  var denonces = a.filter(function (x, i) { return x !== o[i]; });
  assert(denonces.length === 1 && denonces[0].indexOf('totalAVerserCentimes') === 0,
    'un centime de plus est DÉNONCÉ, et le poste est nommé (' +
    (denonces.join(', ') || 'aucun') + ')');
}());

/* ------------------------------------------------------------------------ */

console.log('');
if (echecs) { console.error(echecs + ' échec(s)'); process.exit(1); }
console.log('Tout est conforme.');
