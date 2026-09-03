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
  /* §4 — LA PÉRIODE (« Sur une période », onglet Documents)              */
  /* ==================================================================== */
  console.log('\n--- §4 : la période ---');
  await aller('periode', {});
  await pause(500);
  barreSlim('Sur une période');
  aucunHerite(corps, 'la période');
  egal(corps.querySelectorAll('select').length - corps.querySelectorAll('.dates select').length, 0,
    '§4 : hors les dates, plus aucune liste déroulante — le choix du contrat est cochable');
  var chContrats = corps.querySelectorAll('.ch');
  egal(chContrats.length, 3, '§4 : un choix cochable par contrat, plus « Tous les contrats »');
  assert(chContrats[0].classList.contains('on') && txt(chContrats[0]).indexOf('Tous les contrats') !== -1,
    '§4 : « Tous les contrats » est le choix par défaut');
  assert(!!boutonExact(corps, 'Ce mois-ci') && !!boutonExact(corps, 'Cette année de bilan') &&
    !!boutonExact(corps, 'Toute la durée d’un contrat'), '§4 : les trois raccourcis restent');
  egal(corps.querySelectorAll('.fld .dates').length, 2, '§4 : les deux dates restent');
  boutonExact(corps, 'Ce mois-ci').click();
  await pause(900);
  var cartes = corps.querySelectorAll('#resultats-periode .cd');
  assert(cartes.length >= 2, '§4 : les résultats sont des cartes du socle (' + cartes.length + ')');
  assert(corps.querySelectorAll('#resultats-periode .ln').length >= 6, '§4 : et leurs valeurs des lignes `ln`');
  assert(!!corps.querySelector('#resultats-periode .ln.tot'), '§4 : le total est une `ln.tot`');
  var totalAffiche = txt(corps.querySelector('#resultats-periode .ln.tot b'));
  /* Le montant est rejoué par le moteur : la vue d'ensemble additionne les
     agrégats de la chaîne (`Chaine.totaliserAgregats`), jamais un chiffre
     écrit en dur. */
  var PER = fs.readFileSync(path.join(racine, 'js', 'ui-periode.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
  assert(/totaliserAgregats/.test(PER) && !/\d{3,}\s*\*\s*\d/.test(PER),
    '§4 : les montants viennent de la chaîne et du moteur (total affiché « ' + totalAffiche + ' »)');
  aucunHerite(corps, 'les résultats de la période');
  /* §5 — LA PÉRIODE DE FAMILIARISATION                                   */
  /* ==================================================================== */
  console.log('\n--- §5 : la familiarisation ---');
  await aller('familiarisation', { contratId: 'c2' });
  await pause(500);
  barreSlim('La familiarisation');
  aucunHerite(corps, 'la familiarisation');
  var encRegle = corps.querySelector('.enc.i');
  assert(!!encRegle && txt(encRegle).indexOf('Seules les heures déclarées sont payées') !== -1,
    '§5 : l’encart `.enc.i` rappelle que seules les heures déclarées sont payées');
  assert(corps.querySelectorAll('.fld').length >= 2, '§5 : les bornes de la période sont des `.fld`');
  var lignesJours = corps.querySelectorAll('.cd .ln:not(.tot)');
  egal(lignesJours.length, 5, '§5 : une ligne `ln` par jour de garde de la période (5)');
  var declare = Array.prototype.filter.call(lignesJours, function (l) { return txt(l).indexOf('2h00') !== -1; })[0];
  assert(!!declare, '§5 : le jour déclaré montre ses heures');
  /* L'arrivée seule du 20 août : gardée en base, RIEN n'est payé. */
  var arriveeSeule = Array.prototype.filter.call(lignesJours, function (l) { return txt(l).indexOf('20 août') !== -1; })[0];
  assert(!!arriveeSeule && txt(arriveeSeule).indexOf('à déclarer') !== -1,
    '§5 : une arrivée sans départ reste « à déclarer » — rien n’est payé');
  var tot = corps.querySelector('.ln.tot');
  assert(!!tot && txt(tot).indexOf('2h00') !== -1 && txt(tot).indexOf('brut') !== -1,
    '§5 : le total en `ln.tot` ne compte que le jour déclaré, avec son brut (' + txt(tot) + ')');
  var cliquables = corps.querySelectorAll('button.ln.tap');
  assert(cliquables.length >= 2, '§5 : les jours passés sont des lignes cliquables (' + cliquables.length + ')');
  assert(Array.prototype.every.call(lignesJours, function (l) {
    return !(txt(l).indexOf('à venir') !== -1 && l.tagName === 'BUTTON');
  }), '§5 : un jour à venir ne se touche pas');
  /* Pas de raccourcis de durée, ni ici ni dans la feuille du jour. */
  absent(corps, 'Raccourci', '§5 : aucun raccourci de durée sur l’écran');
  egal(corps.querySelectorAll('.raccourcis, .rac').length, 0, '§5 : aucune rangée de raccourcis');
  cliquables[0].click();
  await pause(500);
  var sheetFam = document.getElementById('sheet');
  contient(sheetFam, 'Familiarisation', '§5 : le jour ouvre la feuille du jour de familiarisation');
  egal(sheetFam.querySelectorAll('.raccourcis, .rac').length, 0, '§5 : aucun raccourci de durée dans la feuille du jour');
  absent(sheetFam, '30 min', '§5 : et aucun bouton « 30 min »');
  var champsHeure = sheetFam.querySelectorAll('input[type="time"]');
  assert(champsHeure.length >= 1, '§5 : la feuille demande une heure d’arrivée (puis un départ)');
  window.Kit.fermerFeuille();

  /* ==================================================================== */
  /* §6 — LA RÉOUVERTURE D'UN MOIS                                        */
  /* ==================================================================== */
  console.log('\n--- §6 : la réouverture ---');
  await aller('document', { contratId: 'c1', annee: 2026, mois: 7 });
  await pause(600);
  var bRouvrir = boutonExact(corps, 'Rouvrir pour corriger');
  assert(!!bRouvrir, '§6 : un mois clôturé propose « Rouvrir pour corriger »');
  bRouvrir.click();
  await pause(400);
  var wrap = document.getElementById('sheetwrap');
  var sheetR = document.getElementById('sheet');
  egal(wrap.hidden, false, '§6 : la réouverture est une FEUILLE, montrée en retirant `hidden`');
  contient(sheetR.querySelector('.h'), 'Rouvrir juillet 2026', '§6 : titre « Rouvrir <mois> »');
  contient(sheetR.querySelector('.s'), 'les journées redeviennent modifiables', '§6 : le sous-titre dit ce que ça implique');
  contient(sheetR.querySelector('.s'), 'le document devient provisoire', '§6 : … et que le document devient provisoire');
  aucunHerite(sheetR, 'la feuille de réouverture');
  var champMotif = sheetR.querySelector('input');
  assert(!!champMotif, '§6 : le motif se saisit dans un champ');
  contient(sheetR, 'facultatif', '§6 : il reste facultatif, comme aujourd’hui — rien ne devient obligatoire');
  var bR = boutonExact(sheetR, 'Rouvrir');
  assert(!!bR && bR.className === 'btn', '§6 : bouton plein « Rouvrir »');
  /* Le geste : la base écrit l'événement elle-même, l'écran ne fait que
     demander la réouverture. On vérifie que l'appel part sans aucun événement
     écrit par l'écran. */
  var appels = [];
  var vraiRouvrir = window.DB.rouvrirRecap;
  window.DB.rouvrirRecap = function (id, a, m, motif) {
    appels.push({ id: id, annee: a, mois: m, motif: motif });
    return Promise.resolve({ id: 'r1', statut: 'brouillon' });
  };
  champMotif.value = 'Oubli d’une absence';
  bR.click();
  await pause(500);
  egal(appels.length, 1, '§6 : un seul appel de réouverture');
  egal(appels[0] && appels[0].motif, 'Oubli d’une absence', '§6 : avec le motif saisi');
  egal(wrap.hidden, true, '§6 : la feuille se referme');
  window.DB.rouvrirRecap = vraiRouvrir;
  var ECR = fs.readFileSync(path.join(racine, 'js', 'ui-reouverture.js'), 'utf8');
  assert(/rouvrirRecap\(/.test(ECR) && !/type:\s*'reouverture'/.test(ECR),
    '§6 : l’écran n’écrit AUCUN événement « reouverture » lui-même — c’est la base');

  /* ==================================================================== */
  /* §7 — LA CONNEXION                                                    */
  /* ==================================================================== */
  console.log('\n--- §7 : la connexion ---');
  var login = document.getElementById('vue-login');
  assert(!!login.querySelector('.cd'), '§7 : un bloc `.cd` centré');
  assert(!!login.querySelector('h1') && txt(login.querySelector('h1')).trim() === 'Récap', '§7 : le nom de l’application');
  assert(!!login.querySelector('p'), '§7 : une phrase');
  egal(login.querySelectorAll('.fld.col').length, 2, '§7 : les deux champs sont des `.fld`');
  egal(login.querySelectorAll('.fld.col label.lb[for]').length, 2, '§7 : chaque champ garde un libellé relié à son champ');
  assert(!!login.querySelector('button.btn[type="submit"]'), '§7 : le bouton plein');
  egal(login.querySelectorAll('.tabs, .back, .bk').length, 0, '§7 : ni barre d’onglets ni flèche');
  aucunHerite(login, 'la connexion');
  var champs = login.querySelectorAll('input');
  assert(Array.prototype.every.call(champs, function (i) { return !i.getAttribute('value') && !i.value; }),
    '§7 : aucune valeur par défaut dans les champs');
  var HTML = fs.readFileSync(path.join(racine, 'index.html'), 'utf8');
  assert(!/value="[^"]+"/.test(HTML.slice(HTML.indexOf('vue-login'), HTML.indexOf('vue-app'))),
    '§7 : aucun identifiant ni mot de passe en dur dans la page');
  var APP2 = fs.readFileSync(path.join(racine, 'js', 'app.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
  var cabler = APP2.slice(APP2.indexOf('function cablerLogin'), APP2.indexOf('function messageLogin'));
  assert(/Kit\.messageErreur\(/.test(cabler) && !/\.message\b/.test(cabler),
    '§7 : les erreurs de connexion passent par js/messages.js, jamais le message brut');
  assert(!/[a-z]+@[a-z]+\.[a-z]+/i.test(cabler) && !/password\s*[:=]\s*'[^']+'/i.test(cabler),
    '§7 : aucune adresse ni mot de passe dans le code de connexion');

  /* ==================================================================== */
  /* §8 — LA POSE D'UN CONGÉ SE FAIT AU CALENDRIER                        */
  /* ==================================================================== */
  console.log('\n--- §8 : la pose au calendrier ---');
  await aller('conges', {});
  await pause(500);
  boutonExact(corps, 'Poser des congés').click();
  await pause(400);
  var sheetP = document.getElementById('sheet');
  var bPoser = sheetP.querySelector('.stick button');
  function bornes() { return Array.prototype.map.call(sheetP.querySelectorAll('.cal-pose td.selb'), function (t) { return t.getAttribute('data-jour'); }); }
  function dans() { return Array.prototype.map.call(sheetP.querySelectorAll('.cal-pose td.dans'), function (t) { return t.getAttribute('data-jour'); }); }
  async function toucher(iso) {
    for (var i = 0; i < 60; i++) {
      var td = sheetP.querySelector('.cal-pose td[data-jour="' + iso + '"]');
      if (td) { td.click(); await pause(60); return; }
      var aff = txt(sheetP.querySelector('.navl')).trim().toLowerCase().split(' ');
      var cle = Number(aff[1]) * 12 + window.Kit.MOIS.indexOf(aff[0]);
      var cible = Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7));
      sheetP.querySelector(cible > cle ? 'button[aria-label="Mois suivant"]' : 'button[aria-label="Mois précédent"]').click();
      await pause(30);
    }
  }
  assert(!!sheetP.querySelector('.cal-pose table.cal'), '§8 : le chemin « journées » montre un calendrier du mois');
  egal(sheetP.querySelectorAll('.fld .dates').length, 0, '§8 : les deux champs « Du » / « Au » ont disparu');
  assert(!!sheetP.querySelector('button[aria-label="Mois précédent"]') && !!sheetP.querySelector('button[aria-label="Mois suivant"]'),
    '§8 : avec sa navigation ‹ mois ›');
  contient(sheetP, 'Touchez le premier jour de votre congé', '§8 : la phrase demande le premier jour');
  egal(bPoser.disabled, true, '§8 : le bouton est inactif tant qu’aucune borne n’est posée');
  /* Le décor porte déjà un congé les 14 et 15 septembre : la plage de ce
     contrôle est prise plus loin dans le mois, sur des jours libres. */
  await toucher('2026-09-21');
  egal(bornes().join(','), '2026-09-21', '§8 : premier appui — le 21 septembre devient une borne (`selb`)');
  contient(sheetP, 'Touchez maintenant le dernier jour', '§8 : la phrase demande maintenant le dernier jour');
  egal(bPoser.disabled, true, '§8 : le bouton reste inactif avec une seule borne');
  await toucher('2026-09-24');
  await pause(700);
  egal(bornes().join(','), '2026-09-21,2026-09-24', '§8 : deuxième appui — la seconde borne se pose');
  egal(dans().join(','), '2026-09-22,2026-09-23', '§8 : les jours entre les deux prennent `dans`');
  var attendu = window.Engine.decompterJoursOuvrables('2026-09-21', '2026-09-24', [1, 2, 3, 4, 5], []);
  var gros = txt(sheetP.querySelector('.res .big2'));
  contient(sheetP.querySelector('.res'), attendu + ' j ouvrables', '§8 : le décompte affiché est celui du moteur (' + attendu + ') — obtenu « ' + gros + ' »');
  contient(sheetP.querySelector('.res .sub'), '21 septembre', '§8 : les bornes sont écrites en toutes lettres');
  egal(bPoser.disabled, false, '§8 : les deux bornes posées, le bouton s’active');
  /* Un appui avant la première borne retourne la plage. */
  await toucher('2026-09-28');
  egal(bornes().join(','), '2026-09-28', '§8 : un troisième appui recommence une sélection depuis ce jour');
  await toucher('2026-09-25');
  egal(bornes().join(','), '2026-09-25,2026-09-28', '§8 : un appui AVANT la borne retourne la plage — le jour touché devient le début');
  /* Le même jour deux fois : une seule journée. */
  await toucher('2026-09-29');
  await toucher('2026-09-29');
  await pause(700);
  egal(bornes().join(','), '2026-09-29', '§8 : le même jour deux fois pose une période d’une seule journée');
  egal(dans().length, 0, '§8 : … sans aucun jour intermédiaire');
  egal(bPoser.disabled, false, '§8 : et le bouton est actif');
  contient(sheetP.querySelector('.res'), '1 j ouvrable', '§8 : le décompte dit une journée');
  /* Le décompte vient du moteur, jamais d'un comptage refait à l'écran :
     le code de la pose ne recompte pas les jours entre les bornes. */
  var CONGES = fs.readFileSync(path.join(racine, 'js', 'ui-conges.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
  var blocPose = CONGES.slice(CONGES.indexOf('function dessinerJournees'), CONGES.indexOf('function preparerPlans'));
  assert(!/decompterJoursOuvrables|getDay\(|jourSemaine\([^)]*\)\s*!==?\s*[07]/.test(blocPose),
    '§8 : la sélection ne compte aucun jour elle-même — le décompte reste celui de preparerVentilations (moteur)');
  /* Les fériés gardent `fe`. */
  await toucher('2026-11-11');
  assert(!!sheetP.querySelector('.cal-pose td[data-jour="2026-11-11"].fe'), '§8 : le 11 novembre garde son état `fe` (férié)');
  await toucher('2026-11-11');
  await pause(700);
  contient(sheetP, 'Aucun jour ouvrable', '§8 : un férié seul ne décompte rien (RG-06) — l’écran le dit');
  egal(bPoser.disabled, true, '§8 : et rien ne se pose sur un férié seul');
  /* Le chemin « durée libre » garde le sien, sans raccourci. */
  var segLibre = Array.prototype.filter.call(sheetP.querySelectorAll('.seg button'), function (b) { return txt(b).trim() === 'Durée libre'; })[0];
  segLibre.click();
  await pause(400);
  egal(sheetP.querySelectorAll('.cal-pose').length, 0, '§8 : « Durée libre » garde son propre parcours, sans calendrier de bornes');
  absent(sheetP, '30 min', '§8 : et sans raccourci de durée (lot 31, point 4)');
  window.Kit.fermerFeuille();

  /* ==================================================================== */
  /* §9 — LES RAPPELS, CÔTÉ APPLICATION                                   */
  /* ==================================================================== */
  console.log('\n--- §9 : les rappels ---');
  /* La configuration RÉELLE du dépôt : la clé publique est vide. */
  egal(window.RECAP_MARIA_CONFIG.VAPID_PUBLIC_KEY, '', '§9 : config.js livre une clé publique VIDE');
  var demandes = 0;
  window.Notification = { permission: 'default', requestPermission: function () { demandes++; return Promise.resolve('granted'); } };
  await aller('rappels', {});
  await pause(500);
  barreSlim('Me rappeler de clôturer');
  aucunHerite(corps, 'les rappels');
  var encW = corps.querySelector('.cd .enc.w');
  assert(!!encW && txt(encW).indexOf('Les rappels ne sont pas encore activés sur ce compte.') !== -1,
    '§9.1 : clé vide — état « non configuré », `.enc.w` avec la phrase de la spécification');
  egal(corps.querySelectorAll('.cd .enc.i, .cd .enc.o').length, 0, '§9.1 : aucun autre état affiché en même temps');
  var reg = corps.querySelector('.reglages-rappel');
  assert(!!reg && reg.classList.contains('inactifs') &&
    Array.prototype.every.call(reg.querySelectorAll('button'), function (b) { return b.disabled; }),
    '§9.1 : les réglages sont visibles mais INACTIFS — rien ne s’active quand la clé est vide');
  egal(boutonExact(corps, 'Autoriser les rappels'), null, '§9.1 : et aucun bouton d’autorisation');
  egal(demandes, 0, '§9.2 : aucune permission demandée au chargement');
  egal(corps.querySelectorAll('.reglages-rappel select').length, 0, '§9.3 : jamais une liste déroulante');
  egal(corps.querySelectorAll('.reglages-rappel .ch').length, 3, '§9.3 : « quoi rappeler » en trois choix cochables');
  assert(!!corps.querySelector('.reglages-rappel .seg'), '§9.3 : la répétition en segmenté');
  var ap = txt(corps.querySelector('.apercu-rappel'));
  assert(ap.indexOf('Août est terminé') !== -1 && !/Alouette|Aigrette|Aubépine/.test(ap),
    '§9.4 : l’aperçu ne nomme ni enfant ni famille');
  var MENU = fs.readFileSync(path.join(racine, 'js', 'ui-menu.js'), 'utf8');
  assert(!/VAPID_PRIVATE|RAPPELS_SECRET/.test(MENU), '§9.2 : aucune clé privée ni secret côté navigateur');
  delete window.Notification;

  /* ==================================================================== */
  console.log('\n' + (echecs ? echecs + ' échec(s)' : 'lot 32 : tout est vert'));
  process.exit(echecs ? 1 : 0);
}());
