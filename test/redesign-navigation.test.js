/* ============================================================================
   REDESIGN 2A §2 — LA NAVIGATION.

   Quatre onglets, dans un ordre qui n'est pas négociable, et une règle simple :
   CHAQUE ÉCRAN SAIT DE QUEL ONGLET IL DÉPEND. Sur un téléphone en mode
   installé, sans barre de navigateur, l'onglet allumé est le seul repère qui
   répond à « où suis-je ». Un écran qui allume le mauvais onglet ment.

   Ce fichier lit la structure — `index.html` et `js/app.js` — plutôt que de
   monter un DOM : la table de correspondance du §2.2 est une DONNÉE, et c'est
   elle qu'on vérifie, ligne à ligne, dans les deux sens. Le rendu, lui, est
   couvert par `lot22-mes-enfants.smoke.js`, qui navigue pour de vrai.

   Lancement : node test/redesign-navigation.test.js
   ========================================================================= */
'use strict';

var fs = require('fs');
var path = require('path');
var racine = path.join(__dirname, '..');
var INDEX = fs.readFileSync(path.join(racine, 'index.html'), 'utf8');
var APP = fs.readFileSync(path.join(racine, 'js', 'app.js'), 'utf8');

var echecs = 0;
function assert(cond, msg) {
  if (!cond) { echecs++; console.error('FAIL ' + msg); } else { console.log('ok   ' + msg); }
}
function egal(obtenu, attendu, msg) {
  assert(obtenu === attendu, msg + ' (attendu ' + JSON.stringify(attendu) +
    ', obtenu ' + JSON.stringify(obtenu) + ')');
}
function sansCommentaires(s) { return s.replace(/\/\*[\s\S]*?\*\//g, ' '); }

/* ------------------------------------------------------------------------ */
/* §2.1 — quatre onglets, dans cet ordre                                     */
/* ------------------------------------------------------------------------ */

console.log('\n--- §2.1 : quatre onglets, dans cet ordre ---');

var ATTENDUS = [
  { cle: 'accueil', libelle: 'Mes enfants' },
  { cle: 'conges',  libelle: 'Congés' },
  { cle: 'docs',    libelle: 'Documents' },
  { cle: 'menu',    libelle: 'Menu' }
];

var nav = INDEX.slice(INDEX.indexOf('<nav id="tabbar"'), INDEX.indexOf('</nav>'));
var boutons = nav.match(/<button[\s\S]*?<\/button>/g) || [];
egal(boutons.length, 4, '§2.1 : la barre porte quatre onglets');

ATTENDUS.forEach(function (a, i) {
  var b = boutons[i] || '';
  assert(b.indexOf('data-onglet="' + a.cle + '"') !== -1,
    '§2.1 : l’onglet ' + (i + 1) + ' est « ' + a.cle + ' »');
  assert(b.replace(/<[^>]*>/g, '').trim() === a.libelle,
    '§2.1 : il s’appelle « ' + a.libelle + ' »');
});

/* L'onglet « Historique » a disparu — c'est « Documents » qui prend sa place,
   et il ne classe plus par date mais par ce qu'on vient y chercher. */
assert(nav.indexOf('data-onglet="historique"') === -1,
  '§2.1 : plus aucun onglet « Historique »');
assert(nav.replace(/<[^>]*>/g, '').indexOf('Historique') === -1,
  '§2.1 : et le mot n’apparaît nulle part dans la barre');

/* Les icônes restent des SVG embarqués : la maquette les dessine avec des
   caractères Unicode (◍ ☾ ▤ •••) qui ne s’affichent pas pareil d’un téléphone
   à l’autre. C’est le défaut corrigé au lot 22 ; le reprendre serait une
   régression, et ce contrôle est là pour l’empêcher. */
boutons.forEach(function (b, i) {
  assert(/<span class="ic"[\s\S]*?<svg[\s\S]*?<\/svg>[\s\S]*?<\/span>/.test(b),
    '§2.1 : l’onglet ' + (i + 1) + ' porte un SVG embarqué, pas un caractère');
});

/* ------------------------------------------------------------------------ */
/* §2.2 — chaque écran connaît son onglet                                    */
/* ------------------------------------------------------------------------ */

console.log('\n--- §2.2 : chaque écran connaît son onglet ---');

/* La table du §2.2, recopiée mot pour mot depuis la spécification. */
var TABLE_SPEC = {
  accueil: 'accueil', enfant: 'accueil', compteurs: 'accueil', fiche: 'accueil',
  familiarisation: 'accueil', fin: 'accueil',
  conges: 'conges',
  docs: 'docs', document: 'docs', histoContrat: 'docs', bilan: 'docs',
  periode: 'docs', cloture: 'docs', moisPasse: 'docs',
  menu: 'menu', enfants: 'menu', familles: 'menu', regles: 'menu',
  rappels: 'menu', compte: 'menu'
};

/* Ce que `js/app.js` déclare réellement. */
var bloc = sansCommentaires(APP);
bloc = bloc.slice(bloc.indexOf('var ONGLET_PARENT = {'));
bloc = bloc.slice(0, bloc.indexOf('};'));
var TABLE_CODE = {};
(bloc.match(/([A-Za-z]\w*)\s*:\s*'([a-z]+)'/g) || []).forEach(function (p) {
  var m = /([A-Za-z]\w*)\s*:\s*'([a-z]+)'/.exec(p);
  TABLE_CODE[m[1]] = m[2];
});

Object.keys(TABLE_SPEC).forEach(function (ecran) {
  egal(TABLE_CODE[ecran], TABLE_SPEC[ecran],
    '§2.2 : « ' + ecran + ' » allume « ' + TABLE_SPEC[ecran] + ' »');
});

/* LE SENS INVERSE, ET IL COMPTE AUTANT. Un écran routé mais absent de la table
   laisse la barre d'onglets MASQUÉE : Maria s'y retrouve sans repère et sans
   moyen de revenir autrement qu'en remontant la pile à l'aveugle. */
var registre = sansCommentaires(APP);
registre = registre.slice(registre.indexOf('var ECRANS = {'));
registre = registre.slice(0, registre.indexOf('\n  };'));
var ROUTES = (registre.match(/^\s*(\w+)\s*:\s*'Ui\w+'/gm) || []).map(function (l) {
  return /(\w+)\s*:/.exec(l.trim())[1];
});
assert(ROUTES.length > 0, '§2.2 : le registre des écrans est lisible (' + ROUTES.length + ' routes)');
ROUTES.forEach(function (r) {
  assert(!!TABLE_CODE[r],
    '§2.2 : l’écran routé « ' + r + ' » a bien un onglet parent — sans quoi la ' +
    'barre reste masquée et Maria perd son repère');
});

/* ------------------------------------------------------------------------ */
/* §2.3 — le retour, et l'onglet déjà actif                                  */
/* ------------------------------------------------------------------------ */

console.log('\n--- §2.3 : le retour revient à l’écran précédent ---');

var fnRetour = APP.slice(APP.indexOf('function retour()'));
fnRetour = fnRetour.slice(0, fnRetour.indexOf('\n  }') + 4);
assert(fnRetour.indexOf('etat.pile.pop()') !== -1,
  '§2.3 : la flèche DÉPILE — elle revient à l’écran précédent…');
assert(fnRetour.indexOf('etat.pile.length > 1') !== -1,
  '§2.3 : …et ne retombe sur l’accueil que si la pile est vide');
var avantPop = fnRetour.slice(0, fnRetour.indexOf('etat.pile.pop()'));
assert(avantPop.indexOf("aller('accueil'") === -1,
  '§2.3 : elle ne court-circuite JAMAIS la pile pour filer à l’accueil');

var cabl = APP.slice(APP.indexOf('function cablerOnglets()'));
cabl = cabl.slice(0, cabl.indexOf('\n  }') + 4);
assert(/aller\(b\.getAttribute\('data-onglet'\),\s*\{\},\s*true\)/.test(cabl),
  '§2.3 : toucher un onglet le ramène à SA RACINE (pile neuve)');

/* ------------------------------------------------------------------------ */
/* §2.3 — « Familles » ne réapparaît pas                                     */
/* ------------------------------------------------------------------------ */

console.log('\n--- §2.3 : « Familles » reste hors du Menu ---');

/* Décision du 23 août, déjà restaurée à tort une fois par une relecture.
   L'ÉCRAN existe et reste routé — c'est le lieu où le nom d'une famille se
   modifie — mais on n'y arrive que par « Voir par famille », en bas de
   « Mes enfants ». */
assert(TABLE_CODE.familles === 'menu',
  '§2.3 : l’écran Familles existe toujours et dépend du Menu');
var menuJs = fs.readFileSync(path.join(racine, 'js', 'ui-menu.js'), 'utf8');
var listeMenu = sansCommentaires(menuJs);
assert(!/carte\(\s*'Familles'/.test(listeMenu) && !/menuItem\(\s*'Familles'/.test(listeMenu),
  '§2.3 : aucune entrée « Familles » n’est fabriquée dans la liste du Menu');

/* ------------------------------------------------------------------------ */

console.log('');
if (echecs) { console.error(echecs + ' échec(s)'); process.exit(1); }
console.log('Tout est conforme.');
