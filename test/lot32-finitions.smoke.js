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
  var resets = (APP.match(/\.className = 'bar'/g) || []).length;
  var retraits = (APP.match(/\.removeAttribute\('style'\)/g) || []).length;
  assert(resets >= 3, '§1 : la barre est réinitialisée à au moins trois endroits (' + resets + ')');
  egal(retraits, resets, '§1 : chaque réinitialisation de la barre retire le style en ligne');

  /* ==================================================================== */
  console.log('\n' + (echecs ? echecs + ' échec(s)' : 'lot 32 : tout est vert'));
  process.exit(echecs ? 1 : 0);
}());
