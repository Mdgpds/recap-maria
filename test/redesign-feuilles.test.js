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
/* §5 — LA FEUILLE SE VOIT QUAND ELLE EST OUVERTE                            */
/* ------------------------------------------------------------------------ */

/* Le 2 septembre, en production : « le bouton Poser des congés ne
   fonctionne pas ». Il fonctionnait — la feuille s'ouvrait, `hidden` passait
   à false, la suite de fumée la lisait et cliquait dedans. Mais la feuille
   était INVISIBLE : `.sh` de la maquette est `display:none`, montrée par une
   classe `.open` que `Kit.ouvrirFeuille` ne pose jamais. Toutes les feuilles
   de l'application — déclarer une journée, poser un congé, tout — sont
   restées invisibles pendant une matinée. jsdom ne met pas en page, et aucun
   test ne regardait ce que la feuille de style FAIT de `#sheetwrap` une fois
   `hidden` retiré. Celui-ci le regarde. */

console.log('\n--- §5 : une feuille ouverte est VISIBLE, pas seulement « non cachée » ---');

var JSDOM = require('jsdom').JSDOM;
function displayDuVoile(css, hidden) {
  var dom = new JSDOM('<!doctype html><html><head><style>' + css + '</style></head>' +
    '<body><div id="sheetwrap" class="sh"' + (hidden ? ' hidden' : '') +
    '><div id="sheet" class="shb"></div></div></body></html>');
  var w = dom.window;
  return w.getComputedStyle(w.document.getElementById('sheetwrap')).display;
}
assert(displayDuVoile(CSS, false) !== 'none',
  '§5 : `#sheetwrap` sans `hidden` est affiché par la feuille de style (obtenu ' +
  displayDuVoile(CSS, false) + ')');
assert(displayDuVoile(CSS, true) === 'none',
  '§5 : et avec `hidden`, il est caché (obtenu ' + displayDuVoile(CSS, true) + ')');
/* La mutation qui remet le défaut de la maquette : `.sh` en `display:none`
   au repos. La mesure doit crier. */
var cssDefautMaquette = CSS.replace(/(\.sh \{[^}]*?)display:\s*flex/, '$1display: none');
assert(cssDefautMaquette !== CSS, '§5 : la mutation a bien remis `display:none` sur `.sh`');
assert(displayDuVoile(cssDefautMaquette, false) === 'none',
  '§5 : avec le défaut de la maquette, la feuille ouverte serait invisible — et le test le voit');

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
/* Chaque `.catch(` est suivi jusqu'a SA parenthese fermante par un comptage
   de parentheses et d'accolades — pas par une expression reguliere bornee a
   400 caracteres et dix espaces d'indentation, qui laissait passer 3 blocs
   sur 31 et que la relecture du 1er septembre a fait mentir en injectant une
   fermeture indentee de quatorze espaces (reserve R3). Les chaines et les
   commentaires de ligne sont sautes pour qu'une accolade dans un message ne
   fausse pas le compte. Le nombre de blocs inspectes est rendu, et controle :
   un filet qui n'attrape rien ne prouve rien. */
function blocsCatch(src) {
  var s = sansCommentaires(src);
  var out = [], i = 0;
  while ((i = s.indexOf('.catch(', i)) !== -1) {
    var debut = i + '.catch'.length;      // sur la parenthese ouvrante
    var prof = 0, j = debut, dansChaine = null;
    for (; j < s.length; j++) {
      var c = s.charAt(j);
      if (dansChaine) {
        if (c === '\\') { j++; continue; }
        if (c === dansChaine) dansChaine = null;
        continue;
      }
      if (c === '\'' || c === '"' || c === '`') { dansChaine = c; continue; }
      if (c === '/' && s.charAt(j + 1) === '/') { j = s.indexOf('\n', j); if (j === -1) j = s.length; continue; }
      if (c === '(' || c === '{') prof++;
      else if (c === ')' || c === '}') { prof--; if (prof === 0) break; }
    }
    out.push(s.slice(debut, j + 1));
    i = j;
  }
  return out;
}
function fermeSurEchec(src, nom) {
  var blocs = blocsCatch(src);
  var coupables = blocs.filter(function (b) { return /fermerFeuille\s*\(/.test(b); }).length;
  assert(blocs.length > 0,
    '§5 : ' + nom + ' — le filet trouve bien des branches d’échec à inspecter (' + blocs.length + ')');
  assert(coupables === 0,
    '§5 : ' + nom + ' ne referme jamais la feuille dans une branche d’échec ' +
    '(' + coupables + ' sur ' + blocs.length + ' inspectée(s))');
  return blocs.length;
}
var ECRANS_A_FEUILLES = ['ui-enfant.js', 'ui-conges.js', 'ui-menu.js', 'ui-accueil.js', 'ui-historique.js'];
var totalCatch = 0;
ECRANS_A_FEUILLES.forEach(function (f) {
  totalCatch += fermeSurEchec(fs.readFileSync(path.join(racine, 'js', f), 'utf8'), f);
});

/* La preuve que le filet mord, y compris la ou l'ancien passait a cote : une
   fermeture injectee dans un `.catch` a QUATORZE espaces d'indentation, avec
   un corps long, doit etre denoncee. */
var piege = ENFANT.replace(/\.catch\(function\s*\(([^)]*)\)\s*\{/, function (m, arg) {
  return '.catch(function (' + arg + ') {\n' +
    '              var explication = "' + new Array(60).join('x') + '";\n' +
    '              console.log(explication, explication, explication, explication, explication, explication, explication);\n' +
    '              fermerFeuille();\n' +
    '              ';
});
assert(piege !== ENFANT, '§5 : la mutation a bien injecté une fermeture dans une branche d’échec');
var denonces = blocsCatch(piege).filter(function (b) { return /fermerFeuille\s*\(/.test(b); }).length;
assert(denonces === 1,
  '§5 : une fermeture indentée de quatorze espaces dans un corps long est DÉNONCÉE (' + denonces + ')');

/* ------------------------------------------------------------------------ */

console.log('');
if (echecs) { console.error(echecs + ' échec(s)'); process.exit(1); }
console.log('Tout est conforme.');
