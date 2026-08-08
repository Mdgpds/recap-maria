/* ============================================================================
   Test de fumée de la refonte d'interface (lot 6), hors réseau.

   Charge le VRAI index.html dans jsdom, branche le vrai moteur (engine.js),
   la vraie chaîne des mois et un DB simulé, puis parcourt l'application comme
   Maria le ferait : accueil -> espace enfant -> feuille d'une journée ->
   document et clôture -> onglet Mes congés -> menu.

   Ce qu'il vérifie, et pourquoi :
   - la barre d'onglets n'apparaît QUE sur les trois écrans racine (§1) ;
   - le calendrier n'ouvre pas les jours fériés et les week-ends (§2.3) ;
   - les effets annoncés dans la feuille sont CALCULÉS par le moteur : le
     montant d'entretien vient du contrat, pas d'un texte en dur (§4) ;
   - « Je ne travaillais pas » écrit sur TOUS les contrats en un seul appel,
     chaque contrat ne recevant que SES propres jours (§2.3) ;
   - la clôture enregistre un instantané portant le prénom, le nom de famille
     et les jours de congé du mois (§2.4) ;
   - l'onglet Mes congés n'affiche AUCUN compteur global et montre l'aperçu
     d'une semaine avant confirmation (§2.5).

   Lancement : NODE_PATH=... node test/lot6-ui.smoke.js   (nécessite jsdom).
   ========================================================================= */
'use strict';

var fs = require('fs');
var path = require('path');
var JSDOM = require('jsdom').JSDOM;

var racine = path.join(__dirname, '..');
var html = fs.readFileSync(path.join(racine, 'index.html'), 'utf8');
var dom = new JSDOM(html, { url: 'https://exemple.test/' });

global.window = dom.window;
global.document = dom.window.document;
/* `navigator` est en lecture seule sur le global de Node : on ne le remplace
   pas, les modules passent de toute façon par window.navigator. */
global.URL = dom.window.URL;

var echecs = 0;
function assert(cond, msg) {
  if (!cond) { echecs++; console.error('FAIL ' + msg); } else { console.log('ok   ' + msg); }
}
function pause(ms) { return new Promise(function (r) { setTimeout(r, ms || 20); }); }
function txt(el) { return el ? el.textContent : ''; }
function parTexte(racineEl, selecteur, morceau) {
  return Array.prototype.filter.call(racineEl.querySelectorAll(selecteur), function (e) {
    return e.textContent.indexOf(morceau) !== -1;
  })[0] || null;
}

/* --- Modules purs --------------------------------------------------------- */
var Feries = require('../js/feries.js');
var Format = require('../js/format.js');
var Engine = require('../js/engine.js');
var Messages = require('../js/messages.js');
var Chaine = require('../js/chaine-mois.js');

global.Feries = Feries; window.Feries = Feries;
global.Format = Format; window.Format = Format;
global.Engine = Engine; window.Engine = Engine;
global.Messages = Messages; window.Messages = Messages;
global.ChaineMois = Chaine; window.ChaineMois = Chaine;

/* --- Données simulées ----------------------------------------------------- */
var BASE = {
  minutes_contractuelles: 540, minutes_sup_jour: 30, minutes_par_jour_conge: 540,
  entretien_centimes_jour: 500, jours_planning: [1, 2, 3, 4, 5],
  heure_arrivee: '08:30:00', heure_depart: '18:00:00',
  statut: 'actif', sup_dues_si_enfant_absent: true, ordre_imputation: 'cp_puis_sup',
  archive: false, date_fin: null
};
function contrat(o) {
  var c = {};
  Object.keys(BASE).forEach(function (k) { c[k] = BASE[k]; });
  Object.keys(o).forEach(function (k) { c[k] = o[k]; });
  return c;
}
var LEA = contrat({ id: 'c-lea', prenom_enfant: 'Léa', famille_id: 'f1',
  famille: { id: 'f1', nom: 'Papillon' }, date_debut: '2025-09-01' });
var TOM = contrat({ id: 'c-tom', prenom_enfant: 'Tom', famille_id: 'f2',
  famille: { id: 'f2', nom: 'Mésange' }, date_debut: '2026-02-02' });
var MANON = contrat({ id: 'c-man', prenom_enfant: 'Manon', famille_id: 'f3',
  famille: { id: 'f3', nom: 'Alouette' }, date_debut: '2024-09-02',
  date_fin: '2026-01-30', archive: true, statut: 'termine' });

var appels = { poser: [], retirer: [], journee: [], suppression: [], fige: [] };
var SALAIRE = { id: 's1', date_effet: '2025-09-01',
  brut_mensuel_centimes: 137289, net_mensuel_centimes: 107250 };

var DB = {
  getSession: function () {
    return Promise.resolve({ user: { id: 'u1', email: 'maria@exemple.test' } });
  },
  onAuthChange: function () { /* pas de rejeu d'authentification dans ce test */ },
  signOut: function () { return Promise.resolve(true); },
  listContratsActifs: function () { return Promise.resolve([LEA, TOM]); },
  listContratsTous: function () { return Promise.resolve([LEA, TOM, MANON]); },
  listContratsPourMois: function () { return Promise.resolve([LEA, TOM]); },
  listContratsPourPeriode: function () { return Promise.resolve([LEA, TOM]); },
  listFamillesToutes: function () { return Promise.resolve([]); },
  getSalaires: function (id) {
    var s = {}; Object.keys(SALAIRE).forEach(function (k) { s[k] = SALAIRE[k]; });
    s.contrat_id = id;
    return Promise.resolve([s]);
  },
  getCompteurInitial: function () { return Promise.resolve(null); },
  getJourneesMois: function () { return Promise.resolve({}); },
  getJourneesPeriode: function () { return Promise.resolve({}); },
  listRecapsPeriode: function () { return Promise.resolve([]); },
  listRecapsContrat: function () { return Promise.resolve([]); },
  getRecap: function () { return Promise.resolve(null); },
  enregistrerJournee: function (l) { appels.journee.push(l); return Promise.resolve(l); },
  supprimerJournee: function (c, j) { appels.suppression.push([c, j]); return Promise.resolve(true); },
  poserAbsenceMaria: function (a, t) { appels.poser.push({ affectations: a, type: t }); return Promise.resolve([]); },
  retirerAbsenceMaria: function (ids, jours, types) {
    appels.retirer.push({ ids: ids, jours: jours, types: types });
    return Promise.resolve(true);
  },
  figerRecap: function (id, a, m, donnees) {
    appels.fige.push({ contratId: id, annee: a, mois: m, donnees: donnees });
    return Promise.resolve({ id: 'r1', statut: 'fige' });
  }
};
global.DB = DB; window.DB = DB;

/* --- Écrans --------------------------------------------------------------- */
require('../js/ui-kit.js');
require('../js/ui-accueil.js');
require('../js/ui-enfant.js');
require('../js/ui-document.js');
require('../js/ui-conges.js');
require('../js/ui-historique.js');
require('../js/ui-contrat.js');
require('../js/ui-menu.js');
require('../js/ui-periode.js');
require('../js/app.js');

/* Horloge figée : mai 2026, le 24. Le moteur, lui, ne lit jamais l'heure. */
window.App.moisCourant = function () { return { annee: 2026, mois: 5 }; };
window.App.aujourdhui = function () { return '2026-05-24'; };

var corps = document.getElementById('corps');
var barre = document.getElementById('barre');
var tabbar = document.getElementById('tabbar');
var sheet = document.getElementById('sheet');

(async function () {
  document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  await pause(120);

  /* ---------- 1. Accueil ---------- */
  assert(document.getElementById('vue-app').hidden === false, 'l’application est affichée après reconnexion automatique');
  assert(document.getElementById('vue-login').hidden === true, 'aucun passage par l’écran de connexion');
  assert(barre.className === 'hero', 'l’accueil porte l’en-tête vert, pas une barre de retour');
  assert(txt(barre).indexOf('Bonjour Maria') !== -1, 'en-tête : « Bonjour Maria »');
  assert(txt(barre).indexOf('Mai 2026') !== -1, 'en-tête : mois en cours');
  assert(!!barre.querySelector('.pbar i'), 'barre de progression du mois présente');
  assert(tabbar.hidden === false, 'barre d’onglets visible sur l’accueil');

  var cartes = corps.querySelectorAll('.big');
  assert(cartes.length === 2, 'une carte par contrat actif (obtenu ' + cartes.length + ')');
  assert(txt(cartes[0]).indexOf('Léa') !== -1 && txt(cartes[0]).indexOf('Papillon') !== -1,
    'la carte porte le prénom et la famille');
  assert(txt(cartes[0]).indexOf('à verser') !== -1, 'mini-chiffre « à verser » présent');
  assert(txt(corps).indexOf('entretien') === -1,
    '§2.1 : aucun montant d’entretien isolé sur l’accueil');
  assert(!!parTexte(corps, '.todo', 'Clôturer le mois de Léa'), '« À faire » : le mois de Léa à clôturer');
  assert(txt(cartes[0]).indexOf('à clôturer') !== -1, 'la carte annonce « Mai à clôturer »');

  /* ---------- 2. Espace enfant ---------- */
  cartes[0].click();
  await pause(80);

  assert(tabbar.hidden === true, '§1 : pas de barre d’onglets hors des écrans racine');
  assert(!!barre.querySelector('.bk'), 'l’espace enfant a un bouton retour');
  assert(txt(barre).indexOf('Léa — mai 2026') !== -1, 'titre de la barre : enfant et mois');
  assert(!!corps.querySelector('table.cal'), 'calendrier présent');

  var panneaux = corps.querySelectorAll('.pane');
  assert(panneaux.length === 4, '§2.2 : quatre panneaux (obtenu ' + panneaux.length + ')');
  assert(txt(panneaux[1]).indexOf('Total à verser') !== -1, 'le panneau du mois porte le total à verser');
  assert(txt(panneaux[1]).indexOf('× 5,00') !== -1, 'entretien détaillé « n j × 5,00 € »');
  assert(txt(panneaux[2]).indexOf('Récupération') !== -1 && txt(panneaux[2]).indexOf('Congés payés') !== -1,
    'compteurs du contrat en barres');
  assert(panneaux[2].querySelectorAll('.cptr .cb i').length === 2, 'deux barres de progression');
  assert(txt(panneaux[3]).indexOf('Depuis le début du contrat') !== -1, 'panneau « depuis le début »');

  /* Mai 2026 : 21 jours du lundi au vendredi, dont 4 fériés (1, 8, 14, 25). */
  var touchables = corps.querySelectorAll('table.cal td[role="button"]');
  assert(touchables.length === 17,
    '17 journées touchables : ni week-end ni férié (obtenu ' + touchables.length + ')');
  var feries = Array.prototype.filter.call(corps.querySelectorAll('table.cal td.fe'), function (td) {
    return td.getAttribute('role') === 'button';
  });
  assert(feries.length === 0, '§2.3 : aucun jour férié n’est touchable');

  /* ---------- 3. Feuille de saisie d'une journée ---------- */
  var mardi19 = Array.prototype.filter.call(touchables, function (td) {
    return txt(td.querySelector('.num')) === '19';
  })[0];
  assert(!!mardi19, 'le mardi 19 mai est touchable');
  mardi19.click();
  await pause(20);

  assert(document.getElementById('sheetwrap').hidden === false, 'la feuille s’ouvre');
  assert(txt(sheet).indexOf('Mardi 19 mai') !== -1, 'la feuille annonce le jour');
  var choix = sheet.querySelectorAll('.choice');
  assert(choix.length === 3, '§2.3 : trois choix (obtenu ' + choix.length + ')');
  assert(txt(choix[0]).indexOf('Léa était là') !== -1, 'choix 1 : « Léa était là »');
  var pourquoiAbsence = txt(choix[1].querySelector('.why'));
  assert(pourquoiAbsence.indexOf('5,00') !== -1,
    'effet de l’absence calculé par le moteur : −5,00 € (obtenu « ' + pourquoiAbsence + ' »)');
  /* L'espace est INSÉCABLE (format.js) : c'est voulu, une durée ne doit jamais
     se couper en fin de ligne. Le test le vérifie tel quel. */
  assert(pourquoiAbsence.indexOf('30 min') !== -1 && pourquoiAbsence.indexOf('restent dues') !== -1,
    'RG-09 : « vos 30 min restent dues »');
  var pourquoiConge = txt(choix[2].querySelector('.why'));
  assert(pourquoiConge.indexOf('−1 jour') !== -1,
    'décompte du congé calculé par le moteur : −1 jour (obtenu « ' + pourquoiConge + ' »)');
  assert(pourquoiConge.indexOf('2 enfants') !== -1, 'le congé annonce les contrats réellement servis');

  /* ---------- 4. « Je ne travaillais pas » écrit sur tous les contrats ---------- */
  choix[2].click();
  await pause(80);

  assert(appels.poser.length === 1, 'une seule écriture pour tous les contrats');
  var a = appels.poser[0];
  assert(a.type === 'conge_maria', 'type écrit : conge_maria');
  assert(a.affectations.length === 2, 'les deux contrats reçoivent le jour');
  assert(a.affectations.every(function (x) { return x.jours.join(',') === '2026-05-19'; }),
    'chaque contrat ne reçoit que SON propre jour');
  assert(document.getElementById('sheetwrap').hidden === true, 'la feuille se referme après un enregistrement réussi');

  /* ---------- 5. Document et clôture ---------- */
  window.App.aller('document', { contratId: 'c-lea', annee: 2026, mois: 5 });
  await pause(80);

  assert(!!corps.querySelector('.doc'), 'le document garde son identité papier');
  assert(txt(corps).indexOf('jours ouvrables') !== -1, 'encart permanent du décompte des congés (RG-06)');
  assert(txt(corps).indexOf('Salaire brut correspondant') !== -1, 'brut et net affichés séparément');
  assert(txt(corps).indexOf('L’envoi aux parents est facultatif') !== -1,
    '§2.4 : le partage est facultatif et l’écrit');
  assert(!!parTexte(corps, 'button', 'Copier le texte') && !!parTexte(corps, 'button', 'Enregistrer en image'),
    'les deux formats de partage sont proposés');
  assert(txt(corps).indexOf('figé') === -1 && txt(corps).indexOf('envoyé') === -1,
    'vocabulaire : jamais « figé » ni « envoyé » à l’écran');

  var bCloture = parTexte(corps, 'button', 'Clôturer le mois');
  assert(!!bCloture, 'bouton « Clôturer le mois »');
  bCloture.click();
  await pause(20);
  assert(txt(sheet).indexOf('verrouille le mois') !== -1, 'avertissement avant clôture');
  parTexte(sheet, 'button', 'Oui, clôturer le mois').click();
  await pause(80);

  assert(appels.fige.length === 1, 'la clôture appelle figerRecap une fois');
  var snap = appels.fige[0].donnees;
  assert(snap.prenomEnfant === 'Léa' && snap.nomFamille === 'Papillon',
    'l’instantané embarque le prénom et le nom de famille');
  assert(Array.isArray(snap.joursConge), 'l’instantané embarque les jours de congé du mois');
  assert(typeof snap.totalAVerserCentimes === 'number', 'l’instantané est bien le résultat du moteur');

  /* ---------- 6. Mes congés ---------- */
  window.App.aller('conges', {}, true);
  await pause(80);

  assert(tabbar.hidden === false, 'barre d’onglets visible sur Mes congés');
  assert(txt(corps).indexOf('Congés payés restants par contrat') !== -1,
    '§2.5 : congés payés contrat par contrat');
  assert(txt(corps).indexOf('Les compteurs diffèrent') !== -1, 'la phrase d’explication est présente');
  assert(txt(corps).indexOf('Total des congés payés') === -1, '§2.5 : jamais de compteur global');

  parTexte(corps, 'button', 'Poser une semaine entière').click();
  await pause(200);
  assert(txt(sheet).indexOf('Jours décomptés') !== -1, 'aperçu avant confirmation');
  assert(txt(sheet).indexOf('6 j') !== -1, 'RG-06 : une semaine complète compte 6 jours');
  assert(txt(sheet).indexOf('Samedi inclus') !== -1, 'le samedi inclus est expliqué');
  assert(!!parTexte(sheet, 'button', 'Confirmer cette période'), 'rien n’est posé avant confirmation');

  var avant = appels.poser.length;
  parTexte(sheet, 'button', 'Confirmer cette période').click();
  await pause(120);
  assert(appels.poser.length === avant + 1, 'la semaine est posée en une seule écriture');
  var semaine = appels.poser[appels.poser.length - 1];
  assert(semaine.affectations.length === 2, 'la semaine est posée sur les deux contrats');
  assert(semaine.affectations[0].jours.length >= 4 && semaine.affectations[0].jours.length <= 5,
    'les jours posés sont ceux du planning (fériés exclus) — obtenu ' +
    semaine.affectations[0].jours.length);

  /* ---------- 7. Menu et anciens contrats ---------- */
  window.App.aller('menu', {}, true);
  await pause(80);
  assert(tabbar.hidden === false, 'barre d’onglets visible sur le Menu');
  assert(txt(corps).indexOf('maria@exemple.test') !== -1, 'le compte connecté est affiché');
  assert(!!parTexte(corps, '.menu', 'Anciens contrats'), 'entrée « Anciens contrats »');
  assert(txt(parTexte(corps, '.menu', 'Anciens contrats')).indexOf('Manon') !== -1,
    'les contrats rangés sont nommés');

  parTexte(corps, '.menu', 'Anciens contrats').click();
  await pause(30);
  parTexte(sheet, '.choice', 'Manon').click();
  await pause(80);
  assert(txt(corps).indexOf('lecture seule') !== -1, '§2.6 : un ancien contrat s’ouvre en lecture seule');
  assert(corps.querySelectorAll('table.cal td[role="button"]').length === 0,
    'aucune journée n’est modifiable sur un ancien contrat');

  console.log('\n' + (echecs === 0 ? 'Tout est conforme.' : echecs + ' échec(s).'));
  process.exit(echecs === 0 ? 0 : 1);
})().catch(function (e) {
  console.error('Erreur pendant le parcours :', e);
  process.exit(1);
});
