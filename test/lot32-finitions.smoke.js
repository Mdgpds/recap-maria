/* ============================================================================
   Test de fumée — LOT 32 : LES FINITIONS DU REDESIGN 2A.

   Ce fichier monte le vrai `index.html`, le vrai moteur, la vraie couche
   `db.js` — branchée sur le MÊME décor fictif que la mesure en vrai
   navigateur (`test/fixtures/faux-supabase-390.js`). Les deux suites voient
   donc les mêmes écrans : ce que jsdom lit ici en structure, Playwright le
   mesure là-bas en valeur calculée.

   Ce que jsdom SAIT faire : lire l'arbre, les classes, les attributs, les
   textes, cliquer. Ce qu'il NE SAIT PAS faire : mettre en page ni appliquer
   la cascade avec sa spécificité. Chaque section ci-dessous s'en tient au
   premier ; le second est dans `test/mesures-390.js`.

   Décor : deux enfants (Alouette, Aigrette), août 2026, horloge au 21 août.

   Lancement : node test/lot32-finitions.smoke.js
   ========================================================================= */
'use strict';

var fs = require('fs');
var path = require('path');
var JSDOM = require('jsdom').JSDOM;

var racine = path.join(__dirname, '..');
var SOURCE_INDEX = fs.readFileSync(path.join(racine, 'index.html'), 'utf8');
var FAUX = fs.readFileSync(path.join(__dirname, 'fixtures', 'faux-supabase-390.js'), 'utf8');
var dom = new JSDOM(SOURCE_INDEX, { url: 'https://exemple.test/', runScripts: 'outside-only' });

global.window = dom.window;
global.document = dom.window.document;
global.URL = dom.window.URL;
global.Blob = dom.window.Blob;

var echecs = 0;
function assert(cond, msg) {
  if (!cond) { echecs++; console.error('FAIL ' + msg); } else { console.log('ok   ' + msg); }
}
function egal(obtenu, attendu, msg) {
  assert(obtenu === attendu, msg + ' (attendu ' + JSON.stringify(attendu) +
    ', obtenu ' + JSON.stringify(obtenu) + ')');
}
function pause(ms) { return new Promise(function (r) { setTimeout(r, ms || 80); }); }
function txt(el) { return el ? String(el.textContent).replace(/[  ]/g, ' ') : ''; }
function contient(el, morceau, msg) {
  if (txt(el).indexOf(morceau) !== -1) { assert(true, msg); return; }
  assert(false, msg + ' — « ' + morceau + ' » introuvable dans : ' + txt(el).slice(0, 360));
}
function absent(el, morceau, msg) {
  assert(txt(el).indexOf(morceau) === -1, msg + ' — « ' + morceau + ' » ne devrait pas y être');
}
function boutonExact(racineEl, libelle) {
  return Array.prototype.filter.call(racineEl.querySelectorAll('button'), function (e) {
    return txt(e).trim() === libelle;
  })[0] || null;
}

/* Le décor : le faux client Supabase, évalué DANS la fenêtre jsdom, puis la
   vraie configuration et la vraie couche de données par-dessus. */
dom.window.eval(FAUX);
require('../config.js');
/* config.js écrit sur `window` de Node ; on le reporte sur la fenêtre jsdom. */
dom.window.RECAP_MARIA_CONFIG = global.window.RECAP_MARIA_CONFIG || window.RECAP_MARIA_CONFIG;

var Feries = require('../js/feries.js');
var Format = require('../js/format.js');
var Engine = require('../js/engine.js');
var Messages = require('../js/messages.js');
global.Feries = Feries; window.Feries = Feries;
global.Format = Format; window.Format = Format;
global.Engine = Engine; window.Engine = Engine;
global.Messages = Messages; window.Messages = Messages;
global.supabase = window.supabase;
global.RECAP_MARIA_CONFIG = window.RECAP_MARIA_CONFIG;
require('../js/db.js');
global.DB = window.DB;
var Chaine = require('../js/chaine-mois.js');
global.ChaineMois = Chaine; window.ChaineMois = Chaine;

require('../js/ui-kit.js');
require('../js/ui-reouverture.js');
require('../js/ui-accueil.js');
require('../js/ui-enfant.js');
require('../js/ui-document.js');
require('../js/ui-conges.js');
require('../js/ui-historique.js');
require('../js/ui-contrat.js');
require('../js/ui-familiarisation.js');
require('../js/ui-menu.js');
require('../js/ui-periode.js');
require('../js/app.js');

/* L'horloge, la même que la mesure à 390 px. */
window.App.moisCourant = function () { return { annee: 2026, mois: 8 }; };
window.App.aujourdhui = function () { return '2026-08-21'; };

var barre = document.getElementById('barre');
var corps = document.getElementById('corps');
var tabbar = document.getElementById('tabbar');

function aller(ecran, params) {
  window.Kit.fermerFeuille();
  window.App.aller(ecran, params || {}, true);
  return pause(350);
}

(async function () {
  document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  await pause(600);

  /* ==================================================================== */
  /* §1 — L'EN-TÊTE REPREND SA COULEUR EN QUITTANT UN ENFANT              */
  /* ==================================================================== */
  console.log('\n--- §1 : l’en-tête ne garde pas la teinte du dernier enfant ---');

  await aller('enfant', { contratId: 'c1', annee: 2026, mois: 8 });
  assert(!!barre.getAttribute('style') && /linear-gradient/.test(barre.getAttribute('style')),
    '§1 : l’espace enfant teinte l’en-tête par un style en ligne (§4.1 du redesign)');

  /* Retour par la flèche. */
  var fleche = barre.querySelector('.back, .bk');
  assert(!!fleche, '§1 : la flèche de retour est dans la barre');
  fleche.click();
  await pause(350);
  egal(barre.getAttribute('style'), null,
    '§1 : après la flèche, plus AUCUN style en ligne sur l’en-tête');

  /* Retour par chacun des quatre onglets. */
  var onglets = ['conges', 'docs', 'menu', 'accueil'];
  for (var i = 0; i < onglets.length; i++) {
    await aller('enfant', { contratId: 'c1', annee: 2026, mois: 8 });
    tabbar.querySelector('button[data-onglet="' + onglets[i] + '"]').click();
    await pause(350);
    egal(barre.getAttribute('style'), null,
      '§1 : après l’onglet « ' + onglets[i] + ' », plus aucun style en ligne');
  }

  /* PARTOUT où la barre est réinitialisée, pas seulement dans `rendre()` :
     l'écran d'attente et la barre de retour la remettent aussi à zéro, et
     chacun de ces endroits doit retirer le style en ligne. On compte les
     réinitialisations (`className = 'bar'`) et les retraits : ils sont égaux. */
  var APP = fs.readFileSync(path.join(racine, 'js', 'app.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
  var resets = (APP.match(/\.className = '(bar|top slim)'/g) || []).length;
  var retraits = (APP.match(/\.removeAttribute\('style'\)/g) || []).length;
  assert(resets >= 3, '§1 : la barre est réinitialisée à au moins trois endroits (' + resets + ')');
  egal(retraits, resets, '§1 : chaque réinitialisation de la barre retire le style en ligne');

  /* ==================================================================== */
  /* A.0 — PLUS AUCUN COMPOSANT HÉRITÉ SUR LES ÉCRANS DU LOT               */
  /* ==================================================================== */
  var HERITES = '.pane, .pt, .lines, .note, .warnbox, .sec, .menu, .card, .todo, .big, .pastille';
  function aucunHerite(racineEl, nom) {
    var trouves = racineEl.querySelectorAll(HERITES);
    egal(trouves.length, 0, 'A.0 : ' + nom + ' n’utilise plus aucun composant hérité' +
      (trouves.length ? ' (' + Array.prototype.map.call(trouves, function (e) {
        return e.tagName + '.' + e.className; }).slice(0, 5).join(', ') + ')' : ''));
  }
  function barreSlim(titre) {
    egal(barre.className, 'top slim', 'A.0 : l’en-tête est `.top.slim`');
    assert(!!barre.querySelector('.back'), 'A.0 : avec sa flèche de retour');
    egal(txt(barre.querySelector('h1')), titre, 'A.0 : et le titre « ' + titre + ' »');
  }

  /* La feuille de style : aucune couleur en dur hors des jetons. Hors du
     bloc `:root`, une valeur hexadécimale n'est tolérée QUE comme définition
     d'un jeton (`--x: #…`, la palette propre du document) — jamais dans une
     propriété. Et jamais de `-webkit-appearance:none` sur `input[type=time]`
     (piège n° 1), la règle de largeur des champs couvrant `input[type=time]`. */
  var CSS = fs.readFileSync(path.join(racine, 'css', 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  var iRoot = CSS.indexOf(':root'), jRoot = CSS.indexOf('}', iRoot);
  var horsRoot = CSS.slice(0, iRoot) + CSS.slice(jRoot + 1);
  var hexEnDur = horsRoot.split('\n').filter(function (l) {
    return /#[0-9a-fA-F]{3,8}\b/.test(l) && !/^\s*--[\w-]+\s*:/.test(l);
  });
  egal(hexEnDur.length, 0, 'A.0 : aucune valeur hexadécimale hors `:root` (' + hexEnDur.slice(0, 3).join(' | ') + ')');
  var regleTime = CSS.split('\n').filter(function (l) { return /input\[type="?time"?\]/.test(l); });
  assert(!regleTime.some(function (l) { return /-webkit-appearance\s*:\s*none/.test(l); }) &&
    !/input\[type="?time"?\][^{]*\{[^}]*-webkit-appearance\s*:\s*none/.test(CSS),
    'A.0 : aucun `-webkit-appearance:none` sur `input[type=time]`');
  assert(/\.fld input, \.fld select, \.fld input\[type="time"\]/.test(CSS),
    'A.0 : la règle de largeur des champs couvre `input[type=time]`');

  /* ==================================================================== */
  /* §3 — LA FICHE DE CONTRAT                                             */
  /* ==================================================================== */
  console.log('\n--- §3 : la fiche de contrat ---');
  await aller('fiche', { contratId: 'c1' });
  await pause(400);
  barreSlim('Contrat, horaires et rémunération');
  aucunHerite(corps, 'la fiche');
  var titres = Array.prototype.map.call(corps.querySelectorAll('.ttl'), txt);
  ['L’enfant', 'Les horaires', 'La rémunération', 'Les avenants'].forEach(function (t) {
    assert(titres.indexOf(t) !== -1, '§3 : la section « ' + t + ' » est là (' + titres.join(' · ') + ')');
  });
  assert(titres.indexOf('Les horaires') < titres.indexOf('La rémunération') &&
    titres.indexOf('La rémunération') < titres.indexOf('Les avenants'),
    '§3 : les sections viennent dans l’ordre de la spécification');
  assert(corps.querySelectorAll('.ln').length >= 6, '§3 : les conditions sont des lignes `ln`');
  assert(!!boutonExact(corps, 'Ce contrat est terminé'), '§3 : « Ce contrat est terminé » reste');
  assert(!!corps.querySelector('.cd.tap'), '§3 : la porte de la familiarisation est une carte cliquable');
  /* Le contrat du décor porte des journées : il n'est PAS vierge. */
  egal(boutonExact(corps, 'Supprimer ce contrat'), null,
    '§3 : « Supprimer ce contrat » n’apparaît pas sur un contrat qui a des journées');
  /* Le même écran sur un contrat vierge : le bouton apparaît. */
  var vraiVierge = window.DB.contratEstVierge;
  window.DB.contratEstVierge = function () { return Promise.resolve(true); };
  await aller('fiche', { contratId: 'c1' });
  await pause(400);
  assert(!!boutonExact(corps, 'Supprimer ce contrat'),
    '§3 : et il apparaît sur un contrat vierge — aucune journée, aucun récapitulatif');
  window.DB.contratEstVierge = vraiVierge;

  /* La frise : une carte par avenant, triée par date d'effet, le numéro
     n'étant qu'une identité (§11.7). */
  await aller('fiche', { contratId: 'c1' });
  await pause(400);
  var bFrise = boutonExact(corps, 'Voir l’historique des conditions');
  assert(!!bFrise, '§3 : la frise s’ouvre depuis « Les avenants »');
  bFrise.click();
  await pause(300);
  var sheet = document.getElementById('sheet');
  assert(sheet.querySelectorAll('.cd').length >= 1, '§3 : la frise est une liste de cartes du socle');
  aucunHerite(sheet, 'la frise des avenants');
  contient(sheet, 'Avenant n°', '§3 : chaque carte porte le numéro de l’avenant');
  assert(!!sheet.querySelector('.pill'), '§3 : l’état de l’avenant est une pastille du socle');
  window.Kit.fermerFeuille();

  /* Le parcours de fin de contrat reste, sur le socle lui aussi. */
  await aller('fiche', { contratId: 'c1', section: 'fin' });
  await pause(400);
  egal(barre.className, 'top slim', '§3 : la fin de contrat porte l’en-tête du socle');
  aucunHerite(corps, 'la fin de contrat');
  assert(!!boutonExact(corps, 'Calculer les soldes de fin de contrat'), '§3 : le calcul des soldes reste');
  assert(!!boutonExact(corps, 'Ranger ce contrat'), '§3 : « Ranger ce contrat » reste');

  /* ==================================================================== */
  console.log('\n' + (echecs ? echecs + ' échec(s)' : 'lot 32 : tout est vert'));
  process.exit(echecs ? 1 : 0);
}());
