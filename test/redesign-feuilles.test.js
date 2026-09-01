/* ============================================================================
   REDESIGN 2A §5 — LES FEUILLES DU JOUR.

   Toutes les saisies de l'application passent par une feuille qui monte du
   bas. Le §5 fixe six règles, et ce fichier les garde. Il lit la STRUCTURE —
   `index.html`, `js/ui-kit.js`, `css/style.css` — parce que ce sont des
   règles de composant, vraies pour toutes les feuilles à la fois : les
   vérifier feuille par feuille dans un DOM en laisserait passer une.

   Les feuilles elles-mêmes sont ouvertes et cliquées par les tests de fumée
   des lots 20, 21, 29, 30, 31 et du parcours — une quinzaine de fichiers.

   Lancement : node test/redesign-feuilles.test.js
   ========================================================================= */
'use strict';

var fs = require('fs');
var path = require('path');
var racine = path.join(__dirname, '..');
var INDEX = fs.readFileSync(path.join(racine, 'index.html'), 'utf8');
var KIT = fs.readFileSync(path.join(racine, 'js', 'ui-kit.js'), 'utf8');
var CSS = fs.readFileSync(path.join(racine, 'css', 'style.css'), 'utf8');
var ENFANT = fs.readFileSync(path.join(racine, 'js', 'ui-enfant.js'), 'utf8');
var CONGES = fs.readFileSync(path.join(racine, 'js', 'ui-conges.js'), 'utf8');

var echecs = 0;
function assert(cond, msg) {
  if (!cond) { echecs++; console.error('FAIL ' + msg); } else { console.log('ok   ' + msg); }
}
function sansCommentaires(s) { return s.replace(/\/\*[\s\S]*?\*\//g, ' '); }

/* ------------------------------------------------------------------------ */
/* §5 — la feuille est le composant du socle                                 */
/* ------------------------------------------------------------------------ */

console.log('\n--- §5 : toutes les saisies passent par la feuille du socle ---');

assert(/id="sheetwrap" class="sh"/.test(INDEX),
  '§5 : le voile de la feuille porte la classe `sh` du socle');
assert(/id="sheet" class="shb"/.test(INDEX),
  '§5 : et la feuille elle-même la classe `shb`');
assert(/id="sheet"[^>]*role="dialog"[^>]*aria-modal="true"/.test(INDEX),
  '§5 : elle est annoncée comme un dialogue modal');

/* ------------------------------------------------------------------------ */
/* §5 — trois façons de fermer, et les trois marchent                        */
/* ------------------------------------------------------------------------ */

console.log('\n--- §5 : fermer par la poignée, par le fond, ou par la flèche ---');

var ouvrir = KIT.slice(KIT.indexOf('function ouvrirFeuille('));
ouvrir = ouvrir.slice(0, ouvrir.indexOf('\n  }') + 4);

assert(/bouton\('poignee',\s*fermerFeuille\)/.test(ouvrir),
  '§5 : LA POIGNÉE est un vrai bouton qui ferme — pas un `::before` décoratif');
assert(/aria-label',\s*'Fermer'/.test(ouvrir),
  '§5 : et elle est nommée pour les lecteurs d’écran');
assert(/wrap\.onclick[\s\S]*e\.target === wrap[\s\S]*fermerFeuille\(\)/.test(ouvrir),
  '§5 : LE FOND ferme aussi — et seulement le fond, pas un appui dans la feuille');
assert(/annuler\.textContent = 'Annuler'/.test(ouvrir),
  '§5 : et le bouton d’annulation est toujours là');

/* La zone tactile de la poignée : 44 px, la règle du §10.4. Le trait, lui,
   n'en fait que quatre — c'est la zone qui compte, pas le dessin. */
var blocPoignee = sansCommentaires(CSS);
blocPoignee = blocPoignee.slice(blocPoignee.indexOf('.poignee {'));
blocPoignee = blocPoignee.slice(0, blocPoignee.indexOf('}') + 1);
assert(/height:\s*44px/.test(blocPoignee),
  '§10.4 : sa zone tactile fait 44 px (obtenu ' + blocPoignee.replace(/\s+/g, ' ') + ')');

/* ------------------------------------------------------------------------ */
/* §5 — le choix se fait par des choix cochables, jamais par une liste        */
/* ------------------------------------------------------------------------ */

console.log('\n--- §5 : des choix cochables, pas une liste déroulante ---');

var choix = KIT.slice(KIT.indexOf('function choix('));
choix = choix.slice(0, choix.indexOf('\n  }') + 4);
assert(/bouton\('choice /.test(choix),
  '§5 : un choix est un BOUTON cochable');
assert(choix.indexOf('<select') === -1 && choix.indexOf("ce('select'") === -1,
  '§5 : et jamais un `select`');

/* Le type d'une journée ne se choisit nulle part dans une liste déroulante. */
[['ui-enfant.js', ENFANT], ['ui-conges.js', CONGES]].forEach(function (f) {
  var src = sansCommentaires(f[1]);
  var selects = (src.match(/ce\('select'/g) || []).length;
  var champsSelect = (src.match(/Kit\.champSelect|champListe/g) || []).length;
  assert(selects === 0 || champsSelect >= selects,
    '§5 : ' + f[0] + ' ne fabrique aucune liste déroulante à la main pour un ' +
    'type de journée (' + selects + ' `select` bruts)');
});

/* ------------------------------------------------------------------------ */
/* §5 — pas de raccourcis de durée, ni en familiarisation ni en durée libre   */
/* ------------------------------------------------------------------------ */

console.log('\n--- §5 : aucun raccourci de durée ne revient ---');

/* Décision du 26 août pour la familiarisation, point 4 du lot 31 pour la
   durée libre. Les deux ont été gagnées contre une maquette qui les
   proposait ; les réintroduire en refaisant la feuille serait la régression
   que le §9 interdit. */
var srcEnfant = sansCommentaires(ENFANT);
assert(srcEnfant.indexOf('rrow') === -1,
  '§5 : la rangée de raccourcis de durée n’est pas revenue dans ui-enfant.js');
assert(sansCommentaires(CSS).indexOf('.rrow') === -1,
  '§5 : ni sa règle de style');
[/2\s*h\s*30['"]/, /4\s*h\s*30['"]/, /1\s*h\s*34/].forEach(function (re, i) {
  assert(!re.test(srcEnfant) || srcEnfant.indexOf('Kit.heures') !== -1,
    '§5 : aucune durée n’est écrite en dur comme raccourci (motif ' + (i + 1) + ')');
});

/* ------------------------------------------------------------------------ */
/* §5 — la saisie n'est jamais perdue                                        */
/* ------------------------------------------------------------------------ */

console.log('\n--- §5 : la feuille reste ouverte si l’écriture échoue ---');

/* `fermerFeuille` ne doit jamais être appelée dans une branche d'ERREUR :
   une feuille qui se referme sur un échec emporte ce que Maria venait de
   saisir, et elle doit tout retaper sans savoir ce qui a échoué. */
function fermeSurEchec(src, nom) {
  var s = sansCommentaires(src);
  var re = /\.catch\(function\s*\([^)]*\)\s*\{([\s\S]{0,400}?)\n\s{0,10}\}\)/g;
  var m, coupables = 0;
  while ((m = re.exec(s))) {
    if (/fermerFeuille\(\)/.test(m[1])) coupables++;
  }
  assert(coupables === 0,
    '§5 : ' + nom + ' ne referme jamais la feuille dans une branche d’échec ' +
    '(' + coupables + ' trouvée(s))');
}
fermeSurEchec(ENFANT, 'ui-enfant.js');
fermeSurEchec(CONGES, 'ui-conges.js');

/* ------------------------------------------------------------------------ */

console.log('');
if (echecs) { console.error(echecs + ' échec(s)'); process.exit(1); }
console.log('Tout est conforme.');
