/* ============================================================================
   Test de fumée — LOT 33 : LE RÉCAP ENVOYÉ DÈS LE 25, LE TOTAL DU MOIS,
   L'ÉCRAN PLEIN.

   Monte le vrai `index.html`, le vrai moteur, la vraie couche `db.js`, sur le
   décor fictif partagé avec la mesure en vrai navigateur
   (`test/fixtures/faux-supabase-390.js`). Ce que jsdom lit ici en structure,
   `test/mesures-390.js` le mesure là-bas en valeur calculée.

   Chaque section garde une correction ou un ajout du lot ; celles qui gardent
   une correction prouvent qu'elles MORDENT : le défaut est remis dans une
   copie, et la mesure doit s'effondrer.

   Lancement : node test/lot33.smoke.js
   ========================================================================= */
'use strict';

var fs = require('fs');
var path = require('path');
var JSDOM = require('jsdom').JSDOM;

var racine = path.join(__dirname, '..');
var SOURCE_INDEX = fs.readFileSync(path.join(racine, 'index.html'), 'utf8');
var SOURCE_CSS = fs.readFileSync(path.join(racine, 'css', 'style.css'), 'utf8');
var SOURCE_APP = fs.readFileSync(path.join(racine, 'js', 'app.js'), 'utf8');
var FAUX = fs.readFileSync(path.join(__dirname, 'fixtures', 'faux-supabase-390.js'), 'utf8');
var dom = new JSDOM(SOURCE_INDEX, { url: 'https://exemple.test/', runScripts: 'outside-only' });

global.window = dom.window;
global.document = dom.window.document;
global.URL = dom.window.URL;
global.Blob = dom.window.Blob;

var echecs = 0, reussis = 0;
function assert(cond, msg) {
  if (!cond) { echecs++; console.error('FAIL ' + msg); } else { reussis++; console.log('ok   ' + msg); }
}
function egal(obtenu, attendu, msg) {
  assert(obtenu === attendu, msg + ' (attendu ' + JSON.stringify(attendu) +
    ', obtenu ' + JSON.stringify(obtenu) + ')');
}
function pause(ms) { return new Promise(function (r) { setTimeout(r, ms || 80); }); }
function txt(el) { return el ? String(el.textContent).replace(/[  ]/g, ' ') : ''; }
function contient(el, morceau, msg) {
  if (txt(el).indexOf(morceau) !== -1) { assert(true, msg); return; }
  assert(false, msg + ' — « ' + morceau + ' » introuvable dans : ' + txt(el).slice(0, 400));
}
function absent(el, morceau, msg) {
  assert(txt(el).indexOf(morceau) === -1, msg + ' — « ' + morceau + ' » ne devrait pas y être');
}
function boutonExact(racineEl, libelle) {
  return Array.prototype.filter.call(racineEl.querySelectorAll('button'), function (e) {
    return txt(e).trim() === libelle;
  })[0] || null;
}

dom.window.eval(FAUX);
require('../config.js');
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

/* Les modules d'écran, dans l'ordre de index.html : la liste est LUE dans la
   page, pour qu'un fichier ajouté au lot entre ici sans qu'on y pense. */
(SOURCE_INDEX.match(/<script src="js\/ui-[^"?]+/g) || []).forEach(function (m) {
  require('../' + m.replace('<script src="', ''));
});
require('../js/app.js');

var JOUR = { iso: '2026-08-21', annee: 2026, mois: 8 };
window.App.moisCourant = function () { return { annee: JOUR.annee, mois: JOUR.mois }; };
window.App.aujourdhui = function () { return JOUR.iso; };

var barre = document.getElementById('barre');
var corps = document.getElementById('corps');

function aller(ecran, params) {
  window.Kit.fermerFeuille();
  window.App.aller(ecran, params || {}, true);
  return pause(350);
}

/* ------------------------------------------------------------------ */
/* §1 — outils hors DOM                                                */
/* ------------------------------------------------------------------ */

/* Les règles CSS qui portent `100lvh`, avec leur sélecteur. */
function reglesLvh(css) {
  var out = [];
  var sansCommentaires = css.replace(/\/\*[\s\S]*?\*\//g, '');
  var re = /([^{}]+)\{([^{}]*)\}/g, m;
  while ((m = re.exec(sansCommentaires))) {
    if (m[2].indexOf('100lvh') !== -1) out.push({ selecteur: m[1].trim(), corps: m[2] });
  }
  return out;
}
function controleRegleHauteur(css) {
  var r = reglesLvh(css);
  return r.length === 1 && r[0].selecteur === 'html.installee' &&
    /min-height:\s*min\(100lvh,\s*calc\(100%\s*\+\s*env\(safe-area-inset-top/.test(r[0].corps) &&
    !/\b(59|47)(px|pt)?\b/.test(r[0].corps);
}

/* Évalue app.js dans une fenêtre neuve, avec un navigateur décrit, et rend
   la classe posée sur <html> au chargement. */
function classeAuChargement(sourceApp, opts) {
  var d = new JSDOM('<!DOCTYPE html><html><body></body></html>', { runScripts: 'outside-only' });
  var w = d.window;
  if (opts.standalone !== undefined) {
    Object.defineProperty(w.navigator, 'standalone', { get: function () { return opts.standalone; } });
  }
  w.matchMedia = function (q) { return { matches: !!opts.modeStandalone && q === '(display-mode: standalone)' }; };
  w.Kit = {}; w.ChaineMois = {};
  /* Seul le chargement nous intéresse : le démarrage de l'application, lui,
     n'a pas de page à remplir dans cette fenêtre nue. */
  w.document.addEventListener = function () {};
  w.eval(sourceApp);
  return w.document.documentElement.classList.contains('installee');
}

(async function () {
  document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  await pause(600);

  /* ==================================================================== */
  /* §1 — L'APPLICATION VA JUSQU'EN BAS DE L'ÉCRAN                        */
  /* ==================================================================== */
  console.log('\n--- §1 : l’écran plein, dans l’application installée seulement ---');

  assert(controleRegleHauteur(SOURCE_CSS),
    '§1.3 : une seule règle porte 100lvh, sur `html.installee`, avec la marge réelle et sans valeur propre à un modèle');
  /* La mesure mord : la même règle sans la classe s'appliquerait partout. */
  var cssMute = SOURCE_CSS.replace('html.installee {', 'html {');
  assert(cssMute !== SOURCE_CSS && !controleRegleHauteur(cssMute),
    '§1.3 : la mesure mord — la règle posée sur `html` (hors installation) est refusée');
  var cssMute2 = SOURCE_CSS.replace('calc(100% + env(safe-area-inset-top, 0px))', 'calc(100% + 59px)');
  assert(cssMute2 !== SOURCE_CSS && !controleRegleHauteur(cssMute2),
    '§1.3 : la mesure mord — une valeur propre à l’iPhone 14 Pro (59) est refusée');

  assert(/apple-mobile-web-app-status-bar-style" content="black-translucent"/.test(SOURCE_INDEX),
    '§1.3 : la barre d’état reste translucide (pas de passage à `black`)');
  assert(/\.appli\s*\{\s*position:\s*fixed;\s*inset:\s*0;/.test(SOURCE_CSS),
    '§1.3 : `.appli` reste fixée sur tout l’écran ; `.bd` reste la zone qui défile');

  egal(classeAuChargement(SOURCE_APP, { standalone: true }), true,
    '§1.3 : navigator.standalone → la classe `installee` est posée au chargement');
  egal(classeAuChargement(SOURCE_APP, { modeStandalone: true }), true,
    '§1.3 : mode d’affichage standalone seul → la classe est posée');
  egal(classeAuChargement(SOURCE_APP, { standalone: false }), false,
    '§1.3 : ni l’un ni l’autre (Safari, ordinateur) → pas de classe');
  var appMute = SOURCE_APP.replace('if (nav.standalone === true) return true;', '');
  assert(appMute !== SOURCE_APP && classeAuChargement(appMute, { standalone: true }) === false,
    '§1.3 : la mesure mord — sans la lecture de navigator.standalone, l’iPhone installé n’est pas reconnu');
  assert(!document.documentElement.classList.contains('installee'),
    '§1.3 : dans ce navigateur de test (non installé), le document ne porte pas la classe');

  console.log('\n--- §1.4 : l’écran « Affichage de cet appareil » ---');
  var V = window.UiMenu.verdictAffichage;
  var base = { installee: true, ecranLargeur: 393, ecranHauteur: 852, fenetreLargeur: 393, fenetreHauteur: 793 };
  egal(V(Object.assign({}, base, { ongletsBas: 793 })).phrase, 'Il manque 59 points en bas.',
    '§1.4 : iPhone 14 Pro installé, barre à 793 pt → « Il manque 59 points en bas »');
  egal(V(Object.assign({}, base, { fenetreHauteur: 852, ongletsBas: 852 })).phrase,
    'La barre d’onglets touche le bas de l’écran.', '§1.4 : barre à 852 pt → « touche le bas de l’écran »');
  egal(V(Object.assign({}, base, { fenetreHauteur: 852, ongletsBas: 851.4 })).touche, true,
    '§1.4 : à 1 pt près, la barre touche');
  egal(V(Object.assign({}, base, { installee: false, fenetreHauteur: 700, ongletsBas: 700 })).touche, true,
    '§1.4 : dans Safari, la référence est la fenêtre (les barres du navigateur ne sont pas un manque)');
  egal(V(Object.assign({}, base, { fenetreLargeur: 852, fenetreHauteur: 393, ongletsBas: 393 })).touche, true,
    '§1.4 : en paysage, la référence est la petite dimension de l’écran');
  egal(V(Object.assign({}, base, { ongletsBas: 851 - 46 })).phrase, 'Il manque 47 points en bas.',
    '§1.4 : iPhone 12 Pro (47 pt) — aucune valeur propre à un modèle, le chiffre est mesuré');

  await aller('compte');
  await pause(200);
  var lienDiag = boutonExact(corps, 'Affichage de cet appareil');
  assert(!!lienDiag, '§1.4 : « Mon compte » porte la ligne « Affichage de cet appareil »');
  assert(lienDiag && lienDiag === corps.lastElementChild, '§1.4 : … en bas de l’écran, discrète (dernier élément)');
  var menuTxt = '';
  await aller('menu'); menuTxt = txt(corps);
  assert(menuTxt.indexOf('Affichage de cet appareil') === -1, '§1.4 : … et pas une entrée du Menu');
  await aller('compte'); await pause(200);
  boutonExact(corps, 'Affichage de cet appareil').click();
  await pause(300);
  contient(barre, 'Affichage de cet appareil', '§1.4 : l’écran s’ouvre, titre dans l’en-tête');
  ['Application installée', 'Hauteur de l’écran', 'Hauteur de la fenêtre', 'Hauteur visible', '100lvh', '100dvh',
    '100vh', 'Marge du haut', 'Marge du bas', 'Hauteur de l’application', 'Bas de l’application',
    'Bas de la barre d’onglets'].forEach(function (l) { contient(corps, l, '§1.4 : la mesure « ' + l + ' » est affichée'); });
  assert(!!corps.querySelector('[data-verdict]'), '§1.4 : une phrase de verdict est affichée');
  assert(!document.getElementById('tabbar').hidden, '§1.4 : la barre d’onglets reste visible (c’est elle qu’on mesure)');
  absent(corps, 'a@b.test', '§1.4 : aucune donnée personnelle (pas d’adresse e-mail)');
  absent(corps, 'Alouette', '§1.4 : aucune donnée personnelle (pas de prénom)');

  /* §SUITE — les sections des commits suivants s'ajoutent ici. */

  console.log('\n' + reussis + ' réussi(s), ' + echecs + ' échec(s)');
  if (echecs) { console.log('lot 33 : ÉCHEC'); process.exit(1); }
  console.log('lot 33 : tout est vert');
  process.exit(0);
})().catch(function (e) { console.error(e); process.exit(1); });
