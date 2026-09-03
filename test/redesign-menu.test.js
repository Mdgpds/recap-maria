/* ============================================================================
   REDESIGN 2A §8 — LE MENU, ET CE QUI NE DOIT PAS Y REVENIR.

   Ce fichier garde une liste courte et une règle. La liste : ce que le Menu
   doit porter. La règle : deux entrées en sont sorties sur décision d'Adrien,
   et une relecture les a déjà rétablies une fois « le temps qu'il tranche ».
   Il a tranché. Ce test est là pour que la question ne se repose pas.

   Il garde aussi le point 7 du lot 31, que le §8 reprend mot pour mot :
   « l'écran DIT qu'ils ne fonctionnent pas tant que la clé n'est pas
   renseignée. Aucune case à cocher ne doit laisser croire qu'un rappel
   partira. »

   Lancement : node test/redesign-menu.test.js
   ========================================================================= */
'use strict';

var fs = require('fs');
var path = require('path');
var racine = path.join(__dirname, '..');
var MENU = fs.readFileSync(path.join(racine, 'js', 'ui-menu.js'), 'utf8');
var APP = fs.readFileSync(path.join(racine, 'js', 'app.js'), 'utf8');
var CONFIG = fs.readFileSync(path.join(racine, 'config.js'), 'utf8');

var echecs = 0;
function assert(cond, msg) {
  if (!cond) { echecs++; console.error('FAIL ' + msg); } else { console.log('ok   ' + msg); }
}
function sansCommentaires(s) { return s.replace(/\/\*[\s\S]*?\*\//g, ' '); }

/* La liste des entrées telle que le code la FABRIQUE — pas telle qu'on
   l'espère : on lit les appels à `entree(...)` du corps du Menu. */
var corpsMenu = sansCommentaires(MENU);
corpsMenu = corpsMenu.slice(corpsMenu.indexOf('function afficherMenu('));
corpsMenu = corpsMenu.slice(0, corpsMenu.indexOf('\n  function '));
var entrees = (corpsMenu.match(/entree\(\s*'([^']+)'/g) || []).map(function (m) {
  return /entree\(\s*'([^']+)'/.exec(m)[1];
});

/* ------------------------------------------------------------------------ */
/* §8 — ce qui DOIT y être                                                   */
/* ------------------------------------------------------------------------ */

console.log('\n--- §8 : ce que le Menu porte ---');

assert(entrees.length > 0, '§8 : les entrées du Menu sont lisibles (' + entrees.length + ')');

[
  ['Mes enfants', 'la liste, l’ajout, l’archivage'],
  ['Comment l’application compte', 'les règles de calcul'],
  ['Me rappeler de clôturer mes mois', 'les rappels'],
  ['Mon nom sur les documents', 'le compte']
].forEach(function (x) {
  assert(entrees.indexOf(x[0]) !== -1,
    '§8 : « ' + x[0] + ' » — ' + x[1] + ' (entrées : ' + entrees.join(' · ') + ')');
});

assert(/ctx\.barre\.className = 'top'/.test(MENU),
  '§8 : le Menu est une racine — en-tête plein, pas de flèche de retour');

/* ------------------------------------------------------------------------ */
/* §8 — ce qui ne doit PAS y revenir                                         */
/* ------------------------------------------------------------------------ */

console.log('\n--- §8 : les deux entrées qui n’y reviennent pas ---');

/* « FAMILLES » — décision du 23 août, déjà rétablie à tort une fois.
   L'ÉCRAN existe toujours et reste routé : on y arrive par « Voir par
   famille », en bas de « Mes enfants », et par là seulement. */
assert(entrees.indexOf('Familles') === -1,
  '§8 : « Familles » n’est PAS une entrée du Menu (décision du 23 août)');
assert(/familles:\s*'menu'/.test(sansCommentaires(APP)),
  '§8 : mais l’écran Familles existe toujours et reste atteignable');
assert(MENU.indexOf('Voir par famille') !== -1,
  '§8 : par « Voir par famille », en bas de « Mes enfants »');

/* « REPRENDRE MES COMPTES » — retiré au lot 31. L'écran reste atteignable, la
   table `compteur_initial` existe toujours, et le code qui la lit ne doit pas
   être cassé : un compteur de reprise existant continuerait de compter. */
assert(entrees.indexOf('Reprendre mes comptes') === -1,
  '§8 : « Reprendre mes comptes » n’est plus une entrée du Menu (lot 31)');
assert(/reprise:\s*'menu'/.test(sansCommentaires(APP)),
  '§8 : mais la route `reprise` existe toujours');
assert(/reprise:\s*'UiMenu'/.test(sansCommentaires(APP)),
  '§8 : et l’écran est toujours rendu');
assert(MENU.indexOf('compteur_initial') !== -1 || MENU.indexOf('getCompteurInitial') !== -1 ||
       MENU.indexOf('afficherReprise') !== -1,
  '§8 : et le code qui lit la reprise n’est pas cassé');

/* ------------------------------------------------------------------------ */
/* §8 — les rappels DISENT qu'ils ne fonctionnent pas                        */
/* ------------------------------------------------------------------------ */

console.log('\n--- §8 : les rappels ne promettent rien qu’ils ne tiennent ---');

assert(/VAPID_PUBLIC_KEY:\s*''/.test(CONFIG),
  'décor : la clé publique VAPID est bien VIDE aujourd’hui — c’est ce qui ' +
  'rend ce contrôle utile');

var srcMenu = sansCommentaires(MENU);
/* LOT 32 §9.1 — l'état « non configuré » DÉCOULE de la clé vide, et c'est
   lui qui porte la phrase, en `.enc.w`. */
assert(/if\s*\(!clePubliqueVapid\(\)\)\s*return[\s\S]{0,80}non_configure/.test(srcMenu) &&
       /mode === 'non_configure'\)\s*\{[\s\S]{0,200}Les rappels ne sont pas encore activés/.test(srcMenu),
  '§8 : l’écran DIT que les rappels ne sont pas activés tant que la clé manque');

/* LA CASE À COCHER NE PROMET RIEN. Elle disait « Même application fermée, si
   votre téléphone l'autorise » — vrai le jour où la clé sera posée, faux
   aujourd'hui. Et c'est la phrase que Maria lit au moment où elle coche, pas
   celle du haut de l'écran. */
/* LOT 32 §9.1 — plus de case à cocher : la phrase « Même application
   fermée » n'est dite que dans l'état ACTIF, et l'état non configuré dit
   qu'aucun rappel ne partira. */
var iActif = srcMenu.indexOf("Les rappels sont actifs sur cet appareil");
var iFerme = srcMenu.indexOf("Même application fermée");
assert(iActif !== -1 && iFerme > iActif && iFerme - iActif < 200 &&
       /mode === 'non_configure'[\s\S]{0,600}Aucun rappel[\s'+]*ne partira/.test(srcMenu),
  '§8 : et AUCUN réglage ne laisse croire qu’un rappel partira — la ' +
  'promesse n’est dite que dans l’état actif');

/* Le sous-titre du Menu ne promet rien non plus. */
assert(srcMenu.indexOf('Réglages enregistrés — pas encore activés') !== -1,
  '§8 : le sous-titre du Menu dit la même chose, et rien de plus');
assert(!/return\s+'Le\s*'\s*\+\s*\(jour === 1[\s\S]{0,80}\}\s*\n\s*if\s*\(!clePubliqueVapid/.test(srcMenu),
  '§8 : la phrase « le 25, puis chaque jour… » n’est jamais dite sans clé');

/* ------------------------------------------------------------------------ */

console.log('');
if (echecs) { console.error(echecs + ' échec(s)'); process.exit(1); }
console.log('Tout est conforme.');
