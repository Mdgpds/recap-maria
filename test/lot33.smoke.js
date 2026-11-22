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

  /* §SUITE — les sections des commits suivants s'ajoutent ici. */

  console.log('\n' + reussis + ' réussi(s), ' + echecs + ' échec(s)');
  if (echecs) { console.log('lot 33 : ÉCHEC'); process.exit(1); }
  console.log('lot 33 : tout est vert');
  process.exit(0);
})().catch(function (e) { console.error(e); process.exit(1); });
