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
var SOURCE_RECAP = fs.readFileSync(path.join(racine, 'js', 'ui-recap.js'), 'utf8');
var SOURCE_ENFANT = fs.readFileSync(path.join(racine, 'js', 'ui-enfant.js'), 'utf8');
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
/* Les espaces insécables (fines ou non) deviennent des espaces : on compare
   des mots, pas des typographies. */
function txt(el) { return el ? String(el.textContent).replace(/[\u00a0\u202f\u2009]/g, ' ') : ''; }
function blanc(t) { return String(t).replace(/[\u00a0\u202f\u2009]/g, ' '); }
function contient(el, morceau, msg) {
  morceau = blanc(morceau);
  if (txt(el).indexOf(morceau) !== -1) { assert(true, msg); return; }
  assert(false, msg + ' — « ' + morceau + ' » introuvable dans : ' + txt(el).slice(0, 400));
}
function absent(el, morceau, msg) {
  morceau = blanc(morceau);
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

function poserJour(iso) {
  JOUR.iso = iso; JOUR.annee = +iso.slice(0, 4); JOUR.mois = +iso.slice(5, 7);
  window.App.invalider();
}

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

  /* ==================================================================== */
  /* §2 — LA PHRASE DE CLÔTURE QUI CONTREDIT LE MOTEUR                    */
  /* ==================================================================== */
  console.log('\n--- §2 : les journées à venir sont comptées, et l’écran le dit ---');

  /* Les phrases cherchées sont assemblées : ce fichier ne doit pas se
     trouver lui-même. */
  var ANCIENNES = ['ne seront ' + 'pas comptées', 'ne sera ' + 'pas comptée', 'jours travaillés sont ' + 'encore à venir'];
  function fichiersServisEtTests() {
    var out = [];
    (function parcourir(dir) {
      fs.readdirSync(dir).forEach(function (n) {
        if (n === 'node_modules' || n === '.git') return;
        var f = path.join(dir, n);
        if (fs.statSync(f).isDirectory()) return parcourir(f);
        if (/\.(js|html|md|css|sql|ts)$/.test(n)) out.push(f);
      });
    }(racine));
    return out;
  }
  function occurrencesAnciennes(lire) {
    var trouve = [];
    fichiersServisEtTests().forEach(function (f) {
      var t = lire(f);
      ANCIENNES.forEach(function (a) { if (t.indexOf(a) !== -1) trouve.push(path.relative(racine, f) + ' : « ' + a + ' »'); });
    });
    return trouve;
  }
  var occ = occurrencesAnciennes(function (f) { return fs.readFileSync(f, 'utf8'); });
  assert(occ.length === 0, '§2 : plus aucune occurrence de l’ancienne phrase dans l’arbre' + (occ.length ? ' — ' + occ.join(', ') : ''));
  var occMute = occurrencesAnciennes(function (f) {
    var t = fs.readFileSync(f, 'utf8');
    return /ui-document\.js$/.test(f) ? t + '\n// ces journées ' + ANCIENNES[0] + '.' : t;
  });
  assert(occMute.length === 1, '§2 : la mesure mord — l’ancienne phrase remise dans une copie de ui-document.js est trouvée');

  var e3 = window.Kit.encartJoursAVenir(3, 11);
  egal(txt(e3).replace(/\s+/g, ' ').trim(),
    '3 journées sont encore à venir en novembre. Elles sont comptées comme des journées normales. ' +
    'Si l’une d’elles se passe autrement, il faudra rouvrir le mois pour la corriger.',
    '§2 : la nouvelle phrase, mot pour mot (pluriel)');
  egal(e3.querySelector('b') && txt(e3.querySelector('b')), '3 journées sont encore à venir en novembre.',
    '§2 : le nombre de journées est en gras');
  egal(txt(window.Kit.encartJoursAVenir(1, 11)).replace(/\s+/g, ' ').trim(),
    '1 journée est encore à venir en novembre. Elle est comptée comme une journée normale. ' +
    'Si elle se passe autrement, il faudra rouvrir le mois pour la corriger.',
    '§2 : la nouvelle phrase, au singulier');

  /* Le 20 novembre, la clôture du document d'Aigrette avertit — par la
     phrase unique — et garde « Clôturer quand même ». (Alouette, en août, a
     un congé à répartir : sa clôture est bloquée pour une autre raison.) */
  poserJour('2026-11-20');
  await aller('document', { contratId: 'c2', annee: 2026, mois: 11 });
  await pause(300);
  var bClot = boutonExact(corps, 'Clôturer le mois');
  assert(!!bClot, '§2 : le document du mois en cours propose « Clôturer le mois »');
  if (bClot) { bClot.click(); await pause(250); }
  var feuille = document.getElementById('sheet');
  contient(feuille, 'journées sont encore à venir en novembre.', '§2 : la feuille de clôture annonce les journées à venir');
  contient(feuille, 'Elles sont comptées comme des journées normales.', '§2 : … et dit qu’elles sont comptées');
  contient(feuille, 'il faudra rouvrir le mois pour la corriger', '§2 : … et ce qui est vrai : la correction demandera de rouvrir');
  assert(!!boutonExact(feuille, 'Clôturer quand même'), '§2 : le bouton garde « Clôturer quand même »');
  window.Kit.fermerFeuille();
  poserJour('2026-08-21');

  /* ==================================================================== */
  /* §3 — LE TOTAL DU MOIS, EN BAS DE « MES ENFANTS »                     */
  /* ==================================================================== */
  console.log('\n--- §3 : le total du mois ---');
  var F = window.__FAUX__;

  /* Le montant attendu, rejoué à la source : la série du contrat, le mois,
     son `totalAVerserCentimes`. Jamais le texte de la carte. */
  async function montantsSource(m) {
    var out = {};
    for (var i = 0; i < window.App.contrats().length; i++) {
      var c = window.App.contrats()[i];
      var ch = await window.App.serie(c, m);
      var e = window.App.moisDe(ch, m.annee, m.mois);
      out[c.prenom_enfant] = e && e.resultat ? e.resultat.totalAVerserCentimes : null;
    }
    return out;
  }
  function carteTotal() { return corps.querySelector('.totmois'); }
  function ligneTotal(prenom) {
    return Array.prototype.filter.call(corps.querySelectorAll('.totmois .tm-l'), function (l) {
      return txt(l.firstChild) === prenom;
    })[0] || null;
  }

  await aller('accueil'); await pause(300);
  var src = await montantsSource({ annee: 2026, mois: 8 });
  var t = carteTotal();
  assert(!!t, '§3 : la carte du total est affichée');
  assert(t && t === corps.lastElementChild, '§3 : c’est le DERNIER élément de la page (après les boutons)');
  assert(t && t.tagName !== 'BUTTON' && !t.querySelector('button') && !t.onclick, '§3 : la carte n’est pas un bouton');
  egal(t && +t.getAttribute('data-total-centimes'), src.Alouette + src.Aigrette,
    '§3 : le total égale la somme des montants des cartes, au centime');
  contient(t, window.Kit.eur(src.Alouette + src.Aigrette), '§3 : … et il est affiché en euros');
  contient(t, 'Août 2026 · à ce jour', '§3 : l’étiquette dit le mois, « à ce jour »');
  contient(t, 'ce que vous allez gagner ce mois-ci', '§3 : la phrase sous le montant');
  contient(t, 'Salaires nets et indemnités d’entretien compris.', '§3 : un seul montant, net et entretien compris (D7)');
  contient(t, 'Si les journées qui restent se passent comme d’habitude.', '§3 : le 21 août, des journées restent : la phrase est là');
  contient(ligneTotal('Alouette'), window.Kit.eur(src.Alouette), '§3 : la ligne d’Alouette porte son montant');
  /* Aigrette est en familiarisation en août : sa carte montre des HEURES. */
  var carteAig = Array.prototype.filter.call(corps.querySelectorAll('.cart3'), function (c) { return txt(c).indexOf('Aigrette') !== -1; })[0];
  assert(carteAig && /août \d+h\d\d/.test(txt(carteAig.querySelector('.etg3'))), '§3 : la carte d’Aigrette (familiarisation) affiche des heures');
  contient(ligneTotal('Aigrette'), window.Kit.eur(src.Aigrette), '§3 : … mais dans le total, c’est son MONTANT qui entre');

  /* Une journée déclarée : le total bouge. */
  F.JOURNEES.push({ id: 'jt33', contrat_id: 'c1', jour: '2026-08-27', type: 'absence_enfant' });
  window.App.invalider();
  await aller('accueil'); await pause(300);
  var src2 = await montantsSource({ annee: 2026, mois: 8 });
  assert(src2.Alouette !== src.Alouette, '§3 : (décor) l’absence du 27 change le montant d’Alouette');
  egal(+carteTotal().getAttribute('data-total-centimes'), src2.Alouette + src2.Aigrette,
    '§3 : une journée déclarée → le total suit, au centime');
  F.JOURNEES.pop(); window.App.invalider();

  /* Un contrat sans salaire : NOMMÉ, et exclu. */
  var av2 = F.AVENANTS.filter(function (a) { return a.contrat_id === 'c2'; })[0];
  var sauveNet = av2.net_mensuel_centimes, sauveBrut = av2.brut_mensuel_centimes;
  av2.net_mensuel_centimes = null; av2.brut_mensuel_centimes = null;
  window.App.invalider();
  await aller('accueil'); await pause(300);
  t = carteTotal();
  contient(t, 'ce que vous allez gagner ce mois-ci, hors Aigrette', '§3 : sans salaire, le libellé du total devient « hors Aigrette »');
  contient(ligneTotal('Aigrette'), 'salaire non renseigné', '§3 : … et sa ligne dit « salaire non renseigné »');
  egal(+t.getAttribute('data-total-centimes'), src.Alouette, '§3 : … et le total ne compte qu’Alouette');
  av2.net_mensuel_centimes = sauveNet; av2.brut_mensuel_centimes = sauveBrut;
  window.App.invalider();

  /* Un seul contrat : la carte, sans la liste. Aucun contrat : pas de carte. */
  var c2 = F.CONTRATS.splice(1, 1)[0];
  await window.App.rechargerContrats();
  await aller('accueil'); await pause(300);
  t = carteTotal();
  assert(!!t, '§3 : un seul contrat — la carte s’affiche quand même');
  assert(t && !t.querySelector('.tm-liste'), '§3 : … sans la liste par enfant');
  var c1 = F.CONTRATS.splice(0, 1)[0];
  await window.App.rechargerContrats();
  await aller('accueil'); await pause(300);
  assert(!carteTotal(), '§3 : aucun contrat — pas de carte');
  F.CONTRATS.push(c1, c2);
  await window.App.rechargerContrats();

  /* Un mois clôturé entre par son instantané ; plus aucune journée à venir :
     la phrase « Si les journées qui restent… » disparaît. */
  poserJour('2026-07-31');
  await aller('accueil'); await pause(300);
  t = carteTotal();
  egal(t && +t.getAttribute('data-total-centimes'), 118650 * 2, '§3 : juillet clôturé — chaque contrat entre avec le montant de son instantané');
  absent(t, 'Si les journées qui restent', '§3 : aucune journée à venir — la phrase disparaît');
  poserJour('2026-08-21');

  var blocCss = (SOURCE_CSS.match(/\.totmois[^{]*\{[^}]*\}/g) || []).join('\n');
  assert(blocCss.length > 0 && !/#[0-9a-f]{3,6}\b|rgba?\(/i.test(blocCss),
    '§3 : la carte du total n’a aucune couleur écrite en dur (jetons seulement)');

  /* ==================================================================== */
  /* §4 — LE RÉCAP COURT : L'IMAGE À ENVOYER AUX PARENTS                  */
  /* ==================================================================== */
  console.log('\n--- §4 : le récap court ---');

  /* jsdom ne dessine pas. Un contexte 2D ENREGISTREUR le remplace : il mesure
     grossièrement (0,55 em par caractère) et garde chaque texte posé. La
     largeur réelle et le débordement se mesurent dans le vrai navigateur
     (test/mesures-390.js). */
  dom.window.HTMLCanvasElement.prototype.getContext = function () {
    var g = { font: '12px x', fillStyle: '', strokeStyle: '', lineWidth: 1, textAlign: 'left', textes: [] };
    g.measureText = function (t) { var px = parseFloat((/(\d+(\.\d+)?)px/.exec(g.font) || [0, 12])[1]); return { width: String(t).length * px * 0.55 }; };
    ['fillRect', 'beginPath', 'rect', 'roundRect', 'fill', 'stroke', 'moveTo', 'lineTo', 'scale'].forEach(function (k) { g[k] = function () {}; });
    g.fillText = function (t) { g.textes.push(t); };
    return g;
  };
  dom.window.HTMLCanvasElement.prototype.toBlob = function (cb) { cb(new dom.window.Blob(['x'], { type: 'image/png' })); };

  function norm(t) { return String(t).replace(/[\s  ]+/g, ' ').trim(); }
  /* Chaque morceau de `contenu`, DANS L'ORDRE, dans le texte donné. */
  function dansLOrdre(morceaux, texteRendu) {
    var t = norm(texteRendu), pos = 0, manque = [];
    morceaux.forEach(function (mc) {
      var i = t.indexOf(norm(mc), pos);
      if (i === -1) manque.push(mc); else pos = i + norm(mc).length;
    });
    return manque;
  }

  async function ctxRecap(contratId, annee, mois) {
    var c = window.App.contratParId(contratId);
    var ch = await window.App.serie(c, { annee: annee, mois: mois });
    var e = window.App.moisDe(ch, annee, mois);
    var j = await window.App.journees(contratId, annee, mois);
    return { contrat: c, entree: e, journees: j, annee: annee, mois: mois,
      aujourdhui: JOUR.iso, nomEmettrice: null };
  }

  /* Le décor ne joint pas la famille aux contrats (la vraie base le fait) :
     on la pose, pour lire « famille Aubépine » comme en production. */
  F.CONTRATS.forEach(function (c) { c.famille = { id: 'f1', nom: 'Aubépine' }; });
  await window.App.rechargerContrats();
  poserJour('2026-11-25');
  var R = window.UiRecap;
  var cx = await ctxRecap('c1', 2026, 11);
  var spy = 0, vraiCalc = window.Engine.calculerMois;
  window.Engine.calculerMois = function () { spy++; return vraiCalc.apply(this, arguments); };
  var M = R.modele(cx);
  var ap = R.apercu(M), tx = R.texte(M), cv = R.dessiner(M);
  window.Engine.calculerMois = vraiCalc;
  egal(spy, 0, '§4 : construire le récap (modèle, aperçu, texte, image) n’appelle jamais calculerMois');

  egal(M.libelleEtat, 'Prévisionnel', '§4.2 : le 25, mois ouvert — état « Prévisionnel »');
  egal(M.titre, 'Alouette · novembre 2026', '§4.2 : en tête, le prénom, le mois et l’année');
  egal(M.sousTitre, 'famille Aubépine', '§4.2 : … et « famille X »');
  egal(norm(M.lignes.map(function (l) { return l.libelle; }).join(' | ')),
    'Jours de présence | Salaire net | Entretien — 20 j × 5,50 € | Heures sup du mois | Total à verser',
    '§4.1 : les lignes du bloc « Le mois », dans le même ordre, avec les mêmes libellés');
  egal(M.lignes[0].valeur, '20 j sur 20', '§4.1 : « 20 j sur 20 »');
  egal(M.lignes[0].sous, '17 faits · 3 à venir', '§4.2 : sous « Jours de présence », « 17 faits · 3 à venir »');
  egal(M.reserves.map(function (l) { return l.libelle; }).join(' | '), 'Congés payés | Heures de récupération',
    '§4.2 : sous le total, les réserves à la fin du mois');
  egal(M.pied && (M.pied.gras + M.pied.suite),
    '3 journées à venir (du 26 au 30 novembre), comptées comme d’habitude. Je vous préviens si l’une d’elles change.',
    '§4.4 : la phrase du prévisionnel, dates selon la règle des plages (26, 27, 30 se suivent : « du 26 au 30 »)');
  egal(M.signature, 'votre assistante maternelle · le mercredi 25 novembre', '§4.2 : en pied, « émettrice · le <date> »');

  /* Une seule source : le bloc « Le mois » de l'espace enfant rend les mêmes
     lignes que le récap court. */
  await aller('enfant', { contratId: 'c1', annee: 2026, mois: 11 });
  await pause(300);
  var fold = Array.prototype.filter.call(corps.querySelectorAll('.fold'), function (f) { return txt(f.querySelector('.fh')).indexOf('Le mois') === 0; })[0];
  var lignesBloc = fold ? Array.prototype.map.call(fold.querySelectorAll('.ln'), function (l) {
    return norm(txt(l.firstChild.firstChild)) + ' = ' + norm(txt(l.lastChild));
  }) : [];
  var lignesRecap = M.lignes.map(function (l) { return norm(l.libelle) + ' = ' + norm(l.valeur); });
  egal(lignesBloc.join(' | '), lignesRecap.join(' | '), '§4.1 : le bloc « Le mois » et le récap court rendent les mêmes lignes, dans le même ordre');
  assert(/Kit\.lignesPour\(/.test(SOURCE_ENFANT) && /Kit\.lignesPour\(ctx\)/.test(SOURCE_RECAP) &&
    !/libelleEntretien\(/.test(SOURCE_ENFANT),
    '§4.1 : … depuis la même fonction (Kit.lignesPour), sans copie dans ui-enfant.js');

  /* Les trois formes, le même contenu. */
  var morceaux = R.contenu(M);
  var mAp = dansLOrdre(morceaux, txt(ap));
  assert(mAp.length === 0, '§4.3 : l’aperçu porte tout le contenu, dans l’ordre' + (mAp.length ? ' — manque : ' + mAp.join(' / ') : ''));
  var mTx = dansLOrdre(morceaux, tx);
  assert(mTx.length === 0, '§4.3 : le texte porte tout le contenu, dans l’ordre' + (mTx.length ? ' — manque : ' + mTx.join(' / ') : ''));
  var textesImage = cv.plan.ops.filter(function (o) { return o.t === 'texte'; }).map(function (o) { return o.texte; }).join(' ');
  /* L'image écrit l'état et le titre des réserves en capitales. */
  var mIm = dansLOrdre(morceaux.map(function (x) { return x.toLowerCase(); }), textesImage.toLowerCase());
  assert(mIm.length === 0, '§4.3 : l’image porte tout le contenu, dans l’ordre' + (mIm.length ? ' — manque : ' + mIm.join(' / ') : ''));
  /* La mesure mord : une ligne retirée de l'aperçu seul est vue. */
  var apMute = R.apercu(M); apMute.querySelector('[data-cle="entretien"]').remove();
  assert(dansLOrdre(morceaux, txt(apMute)).length > 0, '§4.3 : la mesure mord — une ligne manquante dans une seule forme est vue');
  assert(tx.split('\n').length <= 14, '§4.3 : le texte tient en une dizaine de lignes (' + tx.split('\n').length + ')');
  egal(cv.width, 1080, '§4.3 : l’image fait 360 points à l’échelle 3 (1080 px)');
  var minTaille = Math.min.apply(null, cv.plan.ops.filter(function (o) { return o.t === 'texte'; }).map(function (o) { return o.taille; }));
  assert(minTaille >= 11, '§4.3 : aucun texte sous 11 points (plus petit : ' + minTaille + ')');

  /* Aucune couleur écrite en dur dans le module de l'image. */
  var codeRecap = SOURCE_RECAP.replace(/\/\*[\s\S]*?\*\//g, '');
  var COULEUR = /#[0-9a-fA-F]{3,8}\b|rgba?\s*\(|hsla?\s*\(|['"](white|black)['"]/;
  assert(!COULEUR.test(codeRecap), '§4.3 : aucune couleur écrite en dur dans js/ui-recap.js (jetons de :root)');
  assert(COULEUR.test(codeRecap.replace("fond: j('--bg2')", "fond: '#ffffff'")), '§4.3 : la mesure mord — une couleur en dur remise est vue');

  /* Récupération négative : le signe reste. */
  var resNeg = window.Kit.reservesFinDeMois({ resultat: { compteurSortie: { minutesSup: -270, minutesCpAcquis: 0, minutesCpPris: 0 } }, parJourConge: 540 });
  assert(/^[-−]\s?4h30$/.test(norm(resNeg[1].valeur)), '§4.2 : une récupération négative garde son signe (obtenu « ' + resNeg[1].valeur + ' »)');
  egal(window.Kit.reservesFinDeMois({ resultat: {} }).length, 0, '§4.5 : un instantané sans compteur de sortie ne rend aucune réserve — rien d’inventé');

  /* « faits · à venir » : seulement s'il reste des journées ET que le mois est ouvert. */
  poserJour('2026-11-30');
  var M30 = R.modele(await ctxRecap('c1', 2026, 11));
  assert(!M30.lignes[0].sous && !M30.avancement, '§4.2 : le 30, plus aucune journée à venir — pas de « faits · à venir »');
  assert(!M30.pied, '§4.4 : … et pas de phrase de journées à venir');
  poserJour('2026-08-21');
  var MJ = R.modele(await ctxRecap('c1', 2026, 7));
  egal(MJ.libelleEtat, 'Définitif', '§4.2 : juillet clôturé — état « Définitif »');
  assert(!MJ.lignes[0].sous, '§4.2 : mois clôturé — pas de « faits · à venir »');
  assert(!MJ.pied, '§4.4 : définitif sans envoi avant — pas de phrase');
  egal(MJ.lignes[MJ.lignes.length - 1].valeur, window.Kit.eur(118650), '§4.5 : mois clôturé — le récap lit l’instantané');

  /* L'instantané garde le dénominateur. */
  var cxN = await ctxRecap('c1', 2026, 11);
  var snap = window.UiDocument.construireInstantane(cxN);
  egal(snap.joursTravaillesPlanning, 20, '§4.5 : l’instantané garde le nombre de jours travaillés du planning (« sur 20 »)');

  /* Où il vit : le document du mois, à partir du 25 (D2). */
  poserJour('2026-11-24');
  await aller('document', { contratId: 'c1', annee: 2026, mois: 11 }); await pause(300);
  absent(corps, 'L’image à envoyer', '§4.5 / D2 : le 24, le récap court n’est pas proposé');
  assert(!!boutonExact(corps, 'Enregistrer en image'), 'D1 : le document détaillé reste consultable avant le 25');
  poserJour('2026-11-25');
  await aller('document', { contratId: 'c1', annee: 2026, mois: 11 }); await pause(300);
  var blocRc = corps.querySelector('.rc-bloc');
  assert(!!blocRc, '§4.5 : le 25, le bloc « L’image à envoyer » est là');
  contient(blocRc, 'L’image à envoyer', '§4.5 : … avec son titre');
  assert(blocRc && !!boutonExact(blocRc, 'Envoyer aux parents') && !!boutonExact(blocRc, 'Copier le texte'),
    '§4.5 : … « Envoyer aux parents » et « Copier le texte »');
  assert(blocRc && !!boutonExact(blocRc, 'Voir le récapitulatif détaillé'), 'D1 : … et le lien « Voir le récapitulatif détaillé »');
  var titreDet = Array.prototype.filter.call(corps.querySelectorAll('.ttl'), function (t) { return txt(t) === 'Le récapitulatif détaillé'; })[0];
  assert(!!titreDet && (blocRc.compareDocumentPosition(titreDet) & 4), '§4.5 : « Le récapitulatif détaillé » vient en dessous');
  assert(!!boutonExact(corps, 'Enregistrer en image') && corps.querySelectorAll('button').length > 3,
    'D1 : le document détaillé et ses deux boutons restent, inchangés');
  contient(blocRc, '17 faits · 3 à venir', '§4.5 : l’aperçu à l’écran est celui du modèle');
  poserJour('2026-08-21');

  /* ==================================================================== */
  /* §5 — L'ENVOI DÈS LE 25, AVEC LES JOURNÉES À VENIR                    */
  /* ==================================================================== */
  console.log('\n--- §5.1 : la ligne de la carte, état par état ---');
  var LC = R.ligneCarte;
  var ouvert = { resultat: { salaireNetCentimes: 107100 }, fige: false };
  var clos = { resultat: { salaireNetCentimes: 107100 }, fige: true };
  var NOV = { annee: 2026, mois: 11 };
  function env(nature, ts, a, m) { return { contrat_id: 'c1', annee: a || 2026, mois: m || 11, nature: nature, envoye_le: ts, donnees: {} }; }
  var P25 = env('previsionnel', '2026-11-25T17:12:00');
  function etat(l) { return l ? [l.titre + ' — ' + l.sous, l.bouton, l.ton].join(' | ') : null; }

  egal(LC({ m: NOV, aujourdhui: '2026-11-24', entree: ouvert, restants: 4, envois: [] }), null,
    '§5.1 : le 24, rien d’envoyé — aucune ligne');
  egal(etat(LC({ m: NOV, aujourdhui: '2026-11-25', entree: ouvert, restants: 3, envois: [] })),
    'Récap de novembre — prêt à envoyer aux parents | Préparer | ac', '§5.1 : le 25, rien d’envoyé — « prêt à envoyer », Préparer, accent');
  egal(etat(LC({ m: NOV, aujourdhui: '2026-11-25', entree: ouvert, restants: 3, envois: [P25] })),
    'Récap envoyé le 25 — le mois reste ouvert | Voir | ', '§5.1 : prévisionnel envoyé, des journées restent — Voir, neutre');
  egal(etat(LC({ m: NOV, aujourdhui: '2026-11-30', entree: ouvert, restants: 0, envois: [P25] })),
    'Récap envoyé le 25 — à confirmer avant de clôturer | Confirmer | w', '§5.1 : prévisionnel envoyé, plus aucune journée — Confirmer, ambre');
  egal(etat(LC({ m: NOV, aujourdhui: '2026-11-30', entree: clos, restants: 0, envois: [P25] })),
    'Novembre est clôturé — récap définitif à envoyer | Envoyer | ac', '§5.1 : clôturé, définitif pas encore envoyé — Envoyer, accent');
  egal(LC({ m: NOV, aujourdhui: '2026-11-30', entree: clos, restants: 0, envois: [P25, env('definitif', '2026-11-30T18:07:00')] }), null,
    '§5.1 : clôturé et définitif envoyé — aucune ligne');
  egal(LC({ m: NOV, aujourdhui: '2026-11-30', entree: clos, restants: 0, envois: [] }), null,
    '§5.1 : clôturé sans prévisionnel — aucune ligne (rien à confirmer)');
  egal(etat(LC({ m: { annee: 2026, mois: 12 }, aujourdhui: '2026-12-01', entree: ouvert, restants: 20, precedent: ouvert, envois: [P25] })),
    'Récap envoyé le 25 — à confirmer avant de clôturer | Confirmer | w', '§5.1 : novembre passé, non clôturé, avec un prévisionnel — « à confirmer »');
  egal(LC({ m: { annee: 2026, mois: 12 }, aujourdhui: '2026-12-01', entree: ouvert, restants: 20, precedent: ouvert, envois: [] }), null,
    '§5.1 : mois passé non clôturé sans prévisionnel — le traitement d’aujourd’hui (aucune ligne ici)');
  egal(etat(LC({ m: { annee: 2026, mois: 12 }, aujourdhui: '2026-12-02', entree: ouvert, restants: 19, precedent: clos, envois: [P25] })),
    'Novembre est clôturé — récap définitif à envoyer | Envoyer | ac', '§5.1 : clôturé le 30, pas encore envoyé le 2 — la carte le rappelle (D4)');
  egal(LC({ m: NOV, aujourdhui: '2026-11-25', entree: ouvert, restants: 3, envois: null }), null,
    '§5.1 : envois illisibles — la carte se tait plutôt que de dire faux');
  egal(etat(LC({ m: NOV, aujourdhui: '2026-11-30', entree: ouvert, restants: 0,
      envois: [P25, env('previsionnel', '2026-11-27T08:00:00')] })),
    'Récap envoyé le 27 — à confirmer avant de clôturer | Confirmer | w', '§5.5 : plusieurs prévisionnels — la référence est le DERNIER');

  console.log('\n--- §5.1 : la carte de l’accueil, une requête pour tous les contrats ---');
  F.ENVOIS.length = 0;
  var appelsEnvois = [], vraiList = window.DB.listEnvois;
  window.DB.listEnvois = function (ids, ms) { appelsEnvois.push({ ids: ids, ms: ms }); return vraiList.apply(this, arguments); };
  poserJour('2026-11-24');
  await aller('accueil'); await pause(300);
  egal(corps.querySelectorAll('.etg-rc').length, 0, '§5.1 : le 24 novembre, aucune carte ne porte la ligne');
  appelsEnvois.length = 0;
  poserJour('2026-11-25');
  await aller('accueil'); await pause(300);
  egal(appelsEnvois.length, 1, '§5.1 : l’accueil lit les envois en UNE requête');
  egal(appelsEnvois[0] && appelsEnvois[0].ids.length, 2, '§5.1 : … pour les deux contrats à la fois');
  window.DB.listEnvois = vraiList;
  var cartesN = corps.querySelectorAll('.cart3');
  var ligneAl = cartesN[0] && cartesN[0].querySelector('.etg-rc');
  assert(!!ligneAl, '§5.1 : le 25 novembre, la carte porte la ligne');
  contient(ligneAl, 'Récap de novembre — prêt à envoyer aux parents', '§5.1 : « Récap de novembre — prêt à envoyer aux parents »');
  assert(ligneAl && ligneAl.previousElementSibling.classList.contains('etg2') && ligneAl.nextElementSibling.classList.contains('etg3'),
    '§5.1 : entre l’étage de la journée et celui des compteurs');
  assert(ligneAl && !!boutonExact(ligneAl, 'Préparer'), '§5.1 : bouton « Préparer »');

  console.log('\n--- §5.2 : l’écran « Préparer le récap » ---');
  boutonExact(ligneAl, 'Préparer').click(); await pause(400);
  contient(barre, 'Récap de novembre', '§5.2 : en-tête « Récap de novembre »');
  contient(barre, 'Alouette', '§5.2 : … le prénom à droite');
  assert(barre.classList.contains('slim'), '§5.2 : en-tête `.top.slim`');
  contient(corps, 'Vous pouvez envoyer le récap dès aujourd’hui. Les journées qui restent sont comptées comme d’habitude.', '§5.2 : l’encart');
  contient(corps, 'Les 3 journées qui restent', '§5.2 : « Les 3 journées qui restent »');
  var lignesJ = corps.querySelectorAll('.rc-j');
  egal(Array.prototype.map.call(lignesJ, function (l) { return l.getAttribute('data-jour'); }).join(','),
    '2026-11-26,2026-11-27,2026-11-30', '§5.2 : une ligne par journée du planning à venir, hors férié');
  contient(lignesJ[0], 'Jeudi 26 novembre', '§5.2 : la journée, en clair');
  contient(lignesJ[0], 'Comme d’habitude · 8 h 30 – 17 h 30 · entretien dû', '§5.2 : son état, avec les heures de l’avenant');
  egal(Array.prototype.filter.call(lignesJ, function (l) { return !!boutonExact(l, 'Modifier'); }).length, 3, '§5.2 : chacune porte « Modifier »');
  contient(corps, 'Total prévu du mois', '§5.2 : « Total prévu du mois »');
  assert(!!boutonExact(corps, 'Voir l’image à envoyer'), '§5.2 : « Voir l’image à envoyer »');
  contient(corps, 'Le mois reste ouvert : vous confirmerez le lundi 30 novembre.', '§5.2 : « Le mois reste ouvert : vous confirmerez le … »');
  var sansHeures = R.etatJourneeTexte({ contrat: { prenom_enfant: 'A' }, entree: { conditions: {} }, journees: {} }, '2026-11-26');
  egal(sansHeures, 'Comme d’habitude', '§5.2 : heures inconnues — seulement « Comme d’habitude »');

  console.log('\n--- §5.3 : déclarer une journée à venir, une exception étroite ---');
  var ecrites = [], supprimees = [];
  var vraiEcrire = window.DB.enregistrerJournee, vraiSuppr = window.DB.supprimerJournee;
  window.DB.enregistrerJournee = function (l) { ecrites.push(l); return Promise.resolve(Object.assign({ id: 'jx' }, l)); };
  window.DB.supprimerJournee = function (c, j) { supprimees.push(c + '|' + j); return Promise.resolve(null); };
  boutonExact(corps.querySelector('.rc-j[data-jour="2026-11-27"]'), 'Modifier').click(); await pause(400);
  var sh = document.getElementById('sheet');
  contient(sh, 'Vendredi 27 novembre', '§5.3 : « Modifier » ouvre la feuille du jour habituelle, sur le 27');
  var optAbs = Array.prototype.filter.call(sh.querySelectorAll('button'), function (b) { return txt(b).indexOf('Absence de Alouette') !== -1; })[0];
  assert(!!optAbs, '§5.3 : … avec ses choix ordinaires (« Absence de Alouette »)');
  if (optAbs) { optAbs.click(); await pause(100); }
  var bEnr = boutonExact(sh, 'Enregistrer'); if (bEnr) { bEnr.click(); await pause(400); }
  egal(ecrites.length, 1, '§5.3 : une écriture');
  egal(ecrites[0] && [ecrites[0].contrat_id, ecrites[0].jour, ecrites[0].type].join('|'), 'c1|2026-11-27|absence_enfant',
    '§5.3 : … une ligne `journee` ordinaire, sur la journée à venir');
  /* Revenir à « comme d'habitude » SUPPRIME la ligne. */
  F.JOURNEES.push({ id: 'j27', contrat_id: 'c1', jour: '2026-11-27', type: 'absence_enfant' });
  window.App.invalider();
  await aller('preparer', { contratId: 'c1', annee: 2026, mois: 11 }); await pause(300);
  contient(corps.querySelector('.rc-j[data-jour="2026-11-27"]'), 'Alouette absente · pas d’entretien', '§5.2 : la journée déclarée dit son état');
  boutonExact(corps.querySelector('.rc-j[data-jour="2026-11-27"]'), 'Modifier').click(); await pause(400);
  var optRet = Array.prototype.filter.call(sh.querySelectorAll('button'), function (b) { return txt(b).indexOf('Finalement, rien de particulier') !== -1; })[0];
  if (optRet) { optRet.click(); await pause(100); }
  bEnr = boutonExact(sh, 'Enregistrer'); if (bEnr) { bEnr.click(); await pause(400); }
  egal(supprimees.join(','), 'c1|2026-11-27', '§5.3 : revenir à « comme d’habitude » SUPPRIME la ligne');
  egal(ecrites.filter(function (l) { return l.type === 'presence'; }).length, 0, '§5.3 : … jamais une ligne qui dit « présence »');
  window.DB.enregistrerJournee = vraiEcrire; window.DB.supprimerJournee = vraiSuppr;
  window.Kit.fermerFeuille();

  /* Le décompte des jours restants écarte la journée saisie (motif du gel). */
  var jx = await window.App.journees('c1', 2026, 11);
  egal(window.Kit.joursTravaillesRestants(window.App.contratParId('c1'), [1, 2, 3, 4, 5], 2026, 11, '2026-11-25', jx), 2,
    '§5.3 : avec une absence le 27, il reste 2 journées (le décompte n’est pas faussé)');

  /* Le calendrier de l'espace enfant GARDE son gel. */
  F.JOURNEES.pop(); window.App.invalider();
  await aller('enfant', { contratId: 'c1', annee: 2026, mois: 11 }); await pause(300);
  var td27 = Array.prototype.filter.call(corps.querySelectorAll('table.cal td'), function (t) {
    return t.querySelector('.num') && txt(t.querySelector('.num')).trim() === '27';
  })[0];
  assert(td27 && td27.getAttribute('role') !== 'button', '§5.3 : le calendrier refuse toujours la même journée à venir');
  /* … et le point d'entrée lui-même refuse hors de son périmètre. */
  poserJour('2026-11-24');
  egal(await window.UiEnfant.modifierJourAVenir(window.App.contratParId('c1'), '2026-11-27'), false,
    '§5.3 : le 24, la journée à venir ne s’ouvre pas');
  poserJour('2026-11-25');
  egal(await window.UiEnfant.modifierJourAVenir(window.App.contratParId('c1'), '2026-12-02'), false,
    '§5.3 : une journée du mois suivant ne s’ouvre pas');
  egal(await window.UiEnfant.modifierJourAVenir(window.App.contratParId('c1'), '2026-11-28'), false,
    '§5.3 : un samedi hors planning ne s’ouvre pas');
  window.Kit.fermerFeuille();

  console.log('\n--- §5.4 : envoyer, et le noter ---');
  var ecrituresRecap = 0;
  Object.keys(window.DB).forEach(function (k) {
    if (/recloturer|figer|Recap|Transmis|cloturer/i.test(k) && typeof window.DB[k] === 'function' && !/^(list|get|est)/.test(k)) {
      var f0 = window.DB[k];
      window.DB[k] = function () { ecrituresRecap++; return f0.apply(this, arguments); };
      window.DB[k].__vrai = f0;
    }
  });
  function partage(mode) {
    dom.window.navigator.canShare = mode === 'aucun' ? undefined : function () { return true; };
    dom.window.navigator.share = mode === 'aucun' ? undefined : function () {
      if (mode === 'annule') { var e = new Error('annulé'); e.name = 'AbortError'; return Promise.reject(e); }
      return Promise.resolve();
    };
  }
  dom.window.URL.createObjectURL = function () { return 'blob:x'; };
  dom.window.URL.revokeObjectURL = function () {};
  global.URL = dom.window.URL;
  async function ouvrirDocNov() {
    await aller('document', { contratId: 'c1', annee: 2026, mois: 11 }); await pause(300);
    return corps.querySelector('.rc-bloc');
  }
  F.ENVOIS.length = 0;
  partage('annule');
  var bl = await ouvrirDocNov();
  boutonExact(bl, 'Envoyer aux parents').click(); await pause(300);
  egal(F.ENVOIS.length, 0, '§5.4 : partage refermé — rien n’est noté');
  assert(!boutonExact(bl, 'J’ai envoyé le récap'), '§5.4 : … et rien n’est reproché (pas de bouton, pas d’alerte)');
  partage('ok');
  boutonExact(bl, 'Envoyer aux parents').click(); await pause(300);
  egal(F.ENVOIS.length, 1, '§5.4 : partage abouti — l’envoi est noté');
  var E1 = F.ENVOIS[0] || {};
  egal(E1.nature, 'previsionnel', '§5.5 : nature « previsionnel » (mois ouvert)');
  assert(E1.donnees && E1.donnees.lignes.every(function (l) { return Number.isInteger(l.n); }),
    '§5.5 : chaque ligne gardée en centimes / minutes ENTIERS');
  egal(E1.donnees && E1.donnees.lignes.map(function (l) { return l.cle; }).join(','), 'presence,net,entretien,sup,total',
    '§5.5 : les lignes affichées, telles qu’elles sont parties');
  egal(E1.donnees && Object.keys(E1.donnees.jours).length, 21, '§5.5 : l’état de CHAQUE journée du planning du mois (21, férié compris)');
  egal(E1.donnees && E1.donnees.jours['2026-11-11'].t, 'ferie', '§5.5 : … le férié est dit tel');
  contient(bl, 'Envoyé à la famille Aubépine le', '§5.4 : « Envoyé à la famille X le … à … » s’affiche');
  assert(/Envoyé à la famille Aubépine le \d+(er)? [a-zéû]+ à \d+ h \d\d/.test(txt(bl).replace(/ /g, ' ')), '§5.4 : … avec la date et l’heure');
  egal(ecrituresRecap, 0, '§5.4 : envoyer ne clôture pas et n’écrit RIEN dans recap_mensuel');
  var serieApres = await window.App.serie(window.App.contratParId('c1'), NOV);
  assert(!window.App.moisDe(serieApres, 2026, 11).fige, '§5.4 : le mois reste ouvert');

  partage('aucun');
  bl = await ouvrirDocNov();
  boutonExact(bl, 'Envoyer aux parents').click(); await pause(300);
  egal(F.ENVOIS.length, 1, '§5.4 : repli par téléchargement — rien n’est noté d’office');
  var bJai = boutonExact(bl, 'J’ai envoyé le récap');
  assert(!!bJai, '§5.4 : … un bouton « J’ai envoyé le récap » le propose');
  if (bJai) { bJai.click(); await pause(300); }
  egal(F.ENVOIS.length, 2, '§5.4 : « J’ai envoyé le récap » note l’envoi');
  bl = await ouvrirDocNov();
  var vraiCopier = window.Kit.copierTexte;
  window.Kit.copierTexte = function () { return Promise.resolve(); };
  boutonExact(bl, 'Copier le texte').click(); await pause(200);
  assert(!!boutonExact(bl, 'J’ai envoyé le récap'), '§5.4 : après « Copier le texte », le bouton est proposé aussi');
  window.Kit.copierTexte = vraiCopier;

  /* Un définitif, sur un mois clôturé, coche aussi « Transmis » — par la
     fonction existante. */
  var transmis = 0, vraiT = window.DB.marquerTransmis.__vrai || window.DB.marquerTransmis;
  window.DB.marquerTransmis = function () { transmis++; return Promise.resolve(null); };
  partage('ok');
  poserJour('2026-08-21');
  await aller('document', { contratId: 'c1', annee: 2026, mois: 7 }); await pause(300);
  var blJ = corps.querySelector('.rc-bloc');
  assert(!!blJ, '§4.5 : un mois clôturé propose son image (définitive)');
  boutonExact(blJ, 'Envoyer aux parents').click(); await pause(300);
  egal(F.ENVOIS[F.ENVOIS.length - 1].nature, 'definitif', '§5.5 : nature « definitif » sur un mois clôturé');
  egal(transmis, 1, '§5.5 : l’envoi d’un définitif coche aussi « Transmis à la famille » (fonction existante)');
  window.DB.marquerTransmis = vraiT;
  Object.keys(window.DB).forEach(function (k) { if (window.DB[k] && window.DB[k].__vrai) window.DB[k] = window.DB[k].__vrai; });

  console.log('\n--- §5.5 : la migration 022 ---');
  var DOSSIER_M = path.join(racine, 'supabase', 'migrations');
  var mig = fs.readdirSync(DOSSIER_M).filter(function (f) { return /\.sql$/.test(f); }).sort();
  var nums = mig.map(function (f) { return Number(f.slice(0, 3)); });
  egal(mig[mig.length - 1], '022_recap_envoi.sql', '§5.5 : 022 est la dernière migration');
  assert(nums.every(function (n, i) { return n === i + 1; }), '§5.5 : elle suit 021 sans trou ni doublon');
  var M22 = fs.readFileSync(path.join(DOSSIER_M, '022_recap_envoi.sql'), 'utf8');
  var M22c = M22.replace(/--[^\n]*/g, '');
  assert(/alter table public\.recap_envoi enable row level security/.test(M22c), '§5.5 : RLS activée');
  assert(/revoke all on public\.recap_envoi from anon, authenticated, public/.test(M22c), '§5.5 : `revoke all`');
  assert(/create policy recap_envoi_select[\s\S]*for select[\s\S]*owner = \(select auth\.uid\(\)\)/.test(M22c) &&
    /create policy recap_envoi_insert[\s\S]*for insert[\s\S]*with check/.test(M22c), '§5.5 : une policy explicite par opération (select, insert)');
  assert(!/using\s*\(\s*true\s*\)/i.test(M22c), '§5.5 : jamais `using (true)`');
  assert(!/for (update|delete)/i.test(M22c) && !/grant[^;]*(update|delete)/i.test(M22c), '§5.5 : ni policy ni droit de modification ou de suppression');
  assert(/owner\s+uuid not null default auth\.uid\(\)/.test(M22c), '§5.5 : `owner` par défaut `auth.uid()`');
  assert(!/recap_mensuel|preference_rappel|abonnement_push/.test(M22c), '§5.5 : elle ne dépend ni de recap_mensuel ni de 021');
  assert(/nature\s+text not null check \(nature in \('previsionnel', 'definitif'\)\)/.test(M22c), '§5.5 : la nature, previsionnel ou definitif');
  assert(/donnees\s+jsonb not null/.test(M22c), '§5.5 : les données de l’image, en jsonb');
  /* La mesure mord : une policy permissive remise est vue. */
  assert(/using\s*\(\s*true\s*\)/i.test(M22c.replace('using (owner = (select auth.uid()))', 'using (true)')), '§5.5 : la mesure mord — `using (true)` remis est vu');

  /* §SUITE — les sections des commits suivants s'ajoutent ici. */

  console.log('\n' + reussis + ' réussi(s), ' + echecs + ' échec(s)');
  if (echecs) { console.log('lot 33 : ÉCHEC'); process.exit(1); }
  console.log('lot 33 : tout est vert');
  process.exit(0);
})().catch(function (e) { console.error(e); process.exit(1); });
