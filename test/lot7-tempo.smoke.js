/* ============================================================================
   Test de fumée — lot 7 : tempo du mois, document auto-portant, garde-fous.
   Cas P1 à P10 de la spécification.

   POURQUOI CES SCÉNARIOS SONT JOUÉS ET PAS SEULEMENT RELUS.

   Ce lot est le seul du projet qui supprime un risque IRRÉVERSIBLE : clôturer
   un mois inachevé en croyant ses chiffres définitifs. Tout ce qui l'empêche
   vit dans l'interface — la tuile qui n'apparaît qu'à partir du 25, le mot
   « provisoire » à côté d'un total, l'avertissement avant de figer un mois qui
   n'est pas fini, les jours à venir qu'on ne peut pas toucher. Une relecture
   dit que le code a l'air juste ; seul un parcours dit que Maria voit ce qu'il
   faut, le bon jour.

   Chaque scénario est joué contre le VRAI index.html, le VRAI moteur et la
   VRAIE chaîne des mois ; seul l'accès aux données est simulé. La DATE DU JOUR
   est simulée elle aussi, ce qui n'est possible que parce que le lot 7 la fait
   circuler en paramètre au lieu de la lire à l'intérieur : sans cela, le
   comportement du 25 serait invérifiable jusqu'au 25.

   Lancement : node test/lot7-tempo.smoke.js
   ========================================================================= */
'use strict';
/* LOT 17 §17.2 — les conditions du contrat sont datées : le décor expose
   `getAvenants`, pas `getSalaires`. La traduction est faite par
   `test/decor-avenants.js`, qui assemble l'avenant à partir du contrat et du
   barème déjà écrits ici. Aucune valeur n'est inventée. */
var Decor = require('./decor-avenants.js');


var fs = require('fs');
var path = require('path');
var JSDOM = require('jsdom').JSDOM;

var racine = path.join(__dirname, '..');
var dom = new JSDOM(fs.readFileSync(path.join(racine, 'index.html'), 'utf8'),
  { url: 'https://exemple.test/' });

global.window = dom.window;
global.document = dom.window.document;
global.URL = dom.window.URL;

var echecs = 0;
function assert(cond, msg) {
  if (!cond) { echecs++; console.error('FAIL ' + msg); } else { console.log('ok   ' + msg); }
}
function pause(ms) { return new Promise(function (r) { setTimeout(r, ms || 30); }); }
function txt(el) { return el ? el.textContent : ''; }
function sansInsecable(t) { return String(t).replace(/\u00a0/g, ' '); }
function parTexte(racineEl, selecteur, morceau) {
  return Array.prototype.filter.call(racineEl.querySelectorAll(selecteur), function (e) {
    return e.textContent.indexOf(morceau) !== -1;
  })[0] || null;
}
function boutonExact(racineEl, libelle) {
  return Array.prototype.filter.call(racineEl.querySelectorAll('button'), function (e) {
    return e.textContent.trim() === libelle;
  })[0] || null;
}

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

/* --- Données simulées ---------------------------------------------------
   Valeurs FICTIVES et volontairement rondes : le dépôt est public, et aucun
   salaire réel ne doit s'y trouver, pas même dans un test. */
function contrat(id, prenom, familleNom) {
  return {
    id: id, prenom_enfant: prenom, famille_id: 'f-' + id,
    famille: { id: 'f-' + id, nom: familleNom }, date_debut: '2026-01-01', date_fin: null,
    minutes_contractuelles: 540, minutes_sup_jour: 30, minutes_par_jour_conge: 540,
    entretien_centimes_jour: 500, jours_planning: [1, 2, 3, 4, 5],
    heure_arrivee: '08:30:00', heure_depart: '18:00:00', statut: 'actif',
    sup_dues_si_enfant_absent: true, ordre_imputation: 'cp_puis_sup', archive: false
  };
}
var A = contrat('c-a', 'Alix', 'Alpha');
var B = contrat('c-b', 'Basile', 'Bravo');
var C = contrat('c-c', 'Camille', 'Charlie');
var D = contrat('c-d', 'Dominique', 'Delta');

function salaire(id) {
  return { id: 's-' + id, contrat_id: id, date_effet: '2026-01-01',
    brut_mensuel_centimes: 200000, net_mensuel_centimes: 150000 };
}

/* Le contrat par son identifiant : `getAvenants` en a besoin pour reprendre
   les réglages du décor dans l'avenant (§17.2). */
function contratDe(id) {
  var dans = (scene.contrats || []).filter(function (c) { return c.id === id; })[0];
  return dans || [A, B, C, D].filter(function (c) { return c.id === id; })[0] || A;
}

/* --- Décor mutable ------------------------------------------------------ */
var scene = {
  contrats: [A],
  aujourdhui: '2026-08-11',
  moisCourant: { annee: 2026, mois: 8 },
  recaps: {},                 // 'contratId|annee-mois' -> recap
  contratsEnPanne: false,
  transmisLe: null
};
var appels = { recloturer: [], transmis: [] };

function cle(id, a, m) { return id + '|' + a + '-' + m; }
function figer(id, a, m) {
  scene.recaps[cle(id, a, m)] = {
    id: 'r-' + id + '-' + a + '-' + m, contrat_id: id, annee: a, mois: m,
    statut: 'fige', fige_le: a + '-' + String(m).padStart(2, '0') + '-28T18:00:00Z',
    transmis_le: null,
    donnees: {
      joursPresence: 20, entretienCentimes: 10000, salaireNetCentimes: 150000,
      totalAVerserCentimes: 160000, minutesSupAcquises: 600, joursCongesDecomptes: 0,
      dixiemesCpAcquis: 25, retenueSansSoldeCentimes: 0, salaireBrutCentimes: 200000,
      compteurSortie: { minutesSup: 600, dixiemesCpAcquis: 225, dixiemesCpPris: 0 },
      imputation: { joursSurCp: 0, dixiemesCpConsommes: 0, joursSurSup: 0,
                    minutesSupConsommees: 0, joursSansSolde: 0 },
      prenomEnfant: 'Alix', nomFamille: 'Alpha', salaireDateEffet: '2026-01-01', joursConge: []
    }
  };
}

var DB = {
  getSession: function () {
    return Promise.resolve({ user: { id: 'u1', email: 'maria@exemple.test' } });
  },
  onAuthChange: function () {},
  signOut: function () { return Promise.resolve(true); },
  /* LOT 16 §16.2 — le nom qui signe les documents. Décor : non renseigné,
     le document dira « votre assistante maternelle ». */
  getEmettrice: function () { return Promise.resolve(null); },
  enregistrerEmettrice: function (nom) { return Promise.resolve({ nom: nom }); },
  /* LOT 16 §16.4 — la ligne des rappels affiche désormais son VRAI réglage.
     Décor : rappels inactifs, la ligne dira « Vous ne recevez aucun rappel ». */
  getPreferenceRappel: function () { return Promise.resolve(null); },
  listContratsActifs: function () {
    if (scene.contratsEnPanne) return Promise.reject(new Error('Failed to fetch'));
    return Promise.resolve(scene.contrats);
  },
  listContratsTous: function () { return Promise.resolve(scene.contrats); },
  listContratsPourMois: function () { return Promise.resolve(scene.contrats); },
  listContratsPourPeriode: function () { return Promise.resolve(scene.contrats); },
  listFamillesToutes: function () { return Promise.resolve([]); },
    /* Lot 8 — identité et familles. */
    majContratIdentite: function (id, champs) { return Promise.resolve(champs); },
    rattacherContratAFamille: function () { return Promise.resolve(true); },
    renommerFamille: function () { return Promise.resolve(true); },
    archiverFamille: function () { return Promise.resolve(true); },
    desarchiverFamille: function () { return Promise.resolve(true); },
    listFamillesAvecContrats: function () { return Promise.resolve([]); },
  /* Lot 14 — la fiche contrat demande si le contrat est vierge pour décider
     d'AFFICHER ou non la suppression franche. Décor mis à jour ici : sans
     cette fonction, l'écran lève avant même de se rendre. */
  contratEstVierge: function () { return Promise.resolve(false); },
  getAvenants: function (id) {
    if (scene.contratsEnPanne) return Promise.reject(new Error('Failed to fetch'));
    return Promise.resolve(Decor.avenantsDe(contratDe(id), [salaire(id)]));
  },
  getCompteurInitial: function (id) {
    return Promise.resolve(Decor.compteurEnMinutes({ contrat_id: id,
      date_reference: '2026-01-01',
      minutes_sup: 0, dixiemes_cp_acquis: 200, dixiemes_cp_pris: 0 }));
  },
  getJourneesMois: function () { return Promise.resolve({}); },
  getJourneesPeriode: function () { return Promise.resolve({}); },
  listImputationsPourMois: function () { return Promise.resolve([]); },
  getNoteMensuelle: function () { return Promise.resolve(null); },
    enregistrerNoteMensuelle: function (c, a, m, t) { return Promise.resolve({ texte: t }); },
  listImputations: function () { return Promise.resolve([]); },
  listRecapsPeriode: function (id) {
    return Promise.resolve(Object.keys(scene.recaps)
      .filter(function (k) { return k.indexOf(id + '|') === 0; })
      .map(function (k) { return scene.recaps[k]; }));
  },
  listRecapsContrat: function (id) { return DB.listRecapsPeriode(id); },
  getRecap: function (id, a, m) { return Promise.resolve(scene.recaps[cle(id, a, m)] || null); },
  enregistrerJournee: function (l) { return Promise.resolve(l); },
  supprimerJournee: function () { return Promise.resolve(true); },
  poserAbsenceMaria: function () { return Promise.resolve([]); },
  retirerAbsenceMaria: function () { return Promise.resolve(true); },
  rouvrirRecap: function () { return Promise.resolve(null); },
  recloturerRecap: function (id, a, m, donnees) {
    appels.recloturer.push({ contratId: id, annee: a, mois: m, donnees: donnees });
    figer(id, a, m);
    return Promise.resolve(scene.recaps[cle(id, a, m)]);
  },
  listEvenementsRecap: function () { return Promise.resolve([]); },
  marquerTransmis: function (id, a, m) {
    appels.transmis.push({ contratId: id, annee: a, mois: m });
    var r = scene.recaps[cle(id, a, m)];
    if (r) r.transmis_le = '2026-08-31T18:42:00Z';
    return Promise.resolve(r);
  },
  estMoisCloture: function (id, a, m) {
    return Promise.resolve(!!scene.recaps[cle(id, a, m)]);
  }
};
global.DB = DB; window.DB = DB;

require('../js/ui-kit.js');
require('../js/ui-reouverture.js');
require('../js/ui-accueil.js');
require('../js/ui-enfant.js');
require('../js/ui-document.js');
require('../js/ui-conges.js');
require('../js/ui-historique.js');
require('../js/ui-contrat.js');
require('../js/ui-menu.js');
require('../js/ui-periode.js');
require('../js/app.js');

window.App.moisCourant = function () { return scene.moisCourant; };
window.App.aujourdhui = function () { return scene.aujourdhui; };

var corps = document.getElementById('corps');
var sheet = document.getElementById('sheet');
var toast = document.getElementById('toast');

async function ouvrirAccueil() {
  window.App.invalider();
  window.App.aller('accueil', {}, true);
  await pause(220);
}

(async function () {
  document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  await pause(220);

  /* ==================================================================== */
  /* P1 — Le 11, avec juillet non clôturé                                 */
  /* Juillet en tête avec alerte, août ABSENT de « À faire »              */
  /* ==================================================================== */
  console.log('\n--- P1 : le 11 août, juillet non clôturé ---');
  scene.aujourdhui = '2026-08-11';
  scene.moisCourant = { annee: 2026, mois: 8 };
  scene.recaps = {};
  figer(A.id, 2026, 1); figer(A.id, 2026, 2); figer(A.id, 2026, 3);
  figer(A.id, 2026, 4); figer(A.id, 2026, 5); figer(A.id, 2026, 6);
  /* juillet : volontairement laissé ouvert */
  await ouvrirAccueil();

  var tuiles = corps.querySelectorAll('.todo');
  assert(tuiles.length > 0, 'P1 : « À faire » n’est pas vide');
  assert(txt(tuiles[0]).indexOf('Juillet') !== -1 &&
         txt(tuiles[0]).indexOf('n’est pas clôturé') !== -1,
    'P1 : juillet est EN TÊTE de « À faire » (obtenu « ' + txt(tuiles[0]).slice(0, 60) + ' »)');
  assert(txt(tuiles[0]).indexOf('!') !== -1, 'P1 : la tuile porte l’icône d’alerte');
  assert(txt(tuiles[0]).indexOf('Le mois est terminé depuis le 31 juil. 2026') !== -1,
    'P1 : la tuile dit depuis quand le mois est terminé');
  assert(!parTexte(corps, '.todo', 'Clôturer août'),
    'P1 : août n’est PAS proposé à la clôture le 11 (V8-03)');

  var carte = corps.querySelector('.big');
  assert(txt(carte).indexOf('en cours') !== -1, 'P1 : la carte d’août dit « en cours »');
  assert(txt(carte).indexOf('provisoire') !== -1,
    'P1 : le total d’un mois en cours est annoncé provisoire');
  assert(txt(carte).indexOf('Juillet 2026 n’est pas clôturé') !== -1,
    'P1 : le retard se voit aussi depuis la carte du contrat');

  /* ==================================================================== */
  /* P2 — Le 26, tout à jour sauf août                                    */
  /* ==================================================================== */
  console.log('\n--- P2 : le 26 août, aucun retard ---');
  scene.aujourdhui = '2026-08-26';
  figer(A.id, 2026, 7);
  await ouvrirAccueil();

  assert(!!parTexte(corps, '.todo', 'Clôturer août pour Alix'),
    'P2 : le 26, août est proposé à la clôture');
  assert(!parTexte(corps, '.todo', 'n’est pas clôturé'),
    'P2 : aucun mois en retard n’est signalé');
  assert(txt(corps.querySelector('.big')).indexOf('à clôturer') !== -1,
    'P2 : la carte passe à « à clôturer »');
  assert(txt(corps.querySelector('.big')).indexOf('provisoire') === -1,
    'P2 : un mois à clôturer n’annonce plus un total provisoire');

  /* Le 25 est la frontière : la veille, rien. */
  scene.aujourdhui = '2026-08-24';
  await ouvrirAccueil();
  assert(!parTexte(corps, '.todo', 'Clôturer août'),
    'P2bis : le 24, août n’est pas encore proposé');
  scene.aujourdhui = '2026-08-25';
  await ouvrirAccueil();
  assert(!!parTexte(corps, '.todo', 'Clôturer août pour Alix'),
    'P2bis : le 25, il l’est — la bascule est bien au 25');

  /* ==================================================================== */
  /* P3 — Tout est clôturé                                                */
  /* ==================================================================== */
  console.log('\n--- P3 : tout est clôturé ---');
  scene.aujourdhui = '2026-08-11';
  figer(A.id, 2026, 8);
  await ouvrirAccueil();

  assert(!!parTexte(corps, '.todo', 'Rien à clôturer pour l’instant'),
    'P3 : « Rien à clôturer pour l’instant »');
  assert(txt(corps).indexOf('Les mois terminés sont tous clôturés.') !== -1,
    'P3 : la phrase exacte de la spécification');
  assert(txt(corps.querySelector('.big')).indexOf('clôturé') !== -1,
    'P3 : la carte porte l’état clôturé');

  /* ==================================================================== */
  /* P4 — Clôture le 20 : avertissement avec le décompte des jours         */
  /* ==================================================================== */
  console.log('\n--- P4 : clôture d’un mois non échu ---');
  scene.aujourdhui = '2026-08-20';
  delete scene.recaps[cle(A.id, 2026, 8)];
  window.App.invalider();
  window.App.aller('document', { contratId: A.id, annee: 2026, mois: 8 });
  await pause(250);

  var bCloturer = boutonExact(corps, 'Clôturer le mois');
  assert(!!bCloturer, 'P4 : la clôture reste POSSIBLE avant la fin du mois');
  bCloturer.click();
  await pause(120);

  var t = txt(sheet);
  assert(t.indexOf('jours travaillés sont encore à venir') !== -1,
    'P4 : l’avertissement annonce des jours restants (obtenu « ' + t.slice(0, 120) + ' »)');
  assert(/7 jours travaillés sont encore à venir en août/.test(t),
    'P4 : le NOMBRE est exact — 21, 24, 25, 26, 27, 28, 31 = 7 jours');
  assert(t.indexOf('ces journées ne seront pas comptées') !== -1,
    'P4 : la conséquence est dite');
  assert(!!boutonExact(sheet, 'Clôturer quand même'), 'P4 : bouton « Clôturer quand même »');
  assert(!!boutonExact(sheet, 'Annuler'), 'P4 : bouton « Annuler »');

  /* Sur un mois ÉCHU, cet avertissement n'a pas lieu d'être. */
  Kit_fermer();
  scene.aujourdhui = '2026-09-03';
  scene.moisCourant = { annee: 2026, mois: 9 };
  window.App.invalider();
  window.App.aller('document', { contratId: A.id, annee: 2026, mois: 8 });
  await pause(250);
  boutonExact(corps, 'Clôturer le mois').click();
  await pause(120);
  assert(txt(sheet).indexOf('encore à venir') === -1,
    'P4 : sur un mois échu, aucun avertissement de jours restants');
  Kit_fermer();

  /* ==================================================================== */
  /* P7 — Document d'un mois SANS congé : l'encart RG-06 est présent       */
  /* P8 — Le texte à coller est affiché en clair                           */
  /* A8 — entretien détaillé, journées particulières datées                */
  /* ==================================================================== */
  console.log('\n--- P7/P8 : le document auto-portant ---');
  scene.aujourdhui = '2026-08-20';
  scene.moisCourant = { annee: 2026, mois: 8 };
  window.App.invalider();
  window.App.aller('document', { contratId: A.id, annee: 2026, mois: 8 });
  await pause(250);

  var doc = corps.querySelector('.doc');
  assert(!!doc, 'le document est rendu');
  assert(txt(doc).indexOf('Récapitulatif d’Alix — août 2026') !== -1 ||
         txt(doc).indexOf('Récapitulatif de Alix — août 2026') !== -1,
    'A8 : l’en-tête nomme le récapitulatif, l’enfant et le mois');
  assert(txt(doc).indexOf('assistante maternelle') !== -1,
    'A8 : le document dit par qui il est établi');
  assert(txt(doc).indexOf('Période du 1er au 31 août 2026') !== -1,
    'A8 : la période exacte figure sur le document');
  assert(txt(doc).indexOf('famille Alpha') !== -1, 'A8 : la famille est nommée');
  assert(txt(doc).indexOf('Document provisoire') !== -1,
    'A8 : un mois non clôturé porte le bandeau « Document provisoire »');
  assert(/Indemnité d’entretien — \d+ jours × 5,00/.test(txt(doc)),
    'A8 : l’entretien est DÉTAILLÉ en n × montant (obtenu « ' +
    (txt(doc).match(/Indemnité d’entretien[^\n]{0,40}/) || [''])[0] + ' »)');
  assert(txt(doc).indexOf('Décompte des congés') !== -1,
    'P7 : l’encart sur le décompte des congés est présent MÊME sans congé');
  assert(txt(doc).indexOf('Une semaine complète compte donc 6 jours') !== -1,
    'P7 : l’encart énonce bien RG-06');

  var apercu = corps.querySelector('.apercu-texte');
  assert(!!apercu, 'P8 : le texte à coller est AFFICHÉ, pas seulement copiable');
  assert(txt(corps).indexOf('Le message que vous allez coller') !== -1,
    'P8 : il est annoncé par son titre');
  assert(txt(apercu).indexOf('Décompte des congés') !== -1,
    'P8 : l’aperçu contient bien le texte intégral');
  assert(txt(apercu).indexOf('Total à verser') !== -1, 'P8 : et les chiffres du mois');

  /* ==================================================================== */
  /* A9 — Transmis à la famille : cocher NE CLÔTURE PAS                    */
  /* ==================================================================== */
  console.log('\n--- A9 : la case « Transmis à la famille » ---');
  figer(A.id, 2026, 8);
  window.App.invalider();
  window.App.aller('document', { contratId: A.id, annee: 2026, mois: 8 });
  await pause(250);

  var avantRecloture = appels.recloturer.length;
  var caseT = corps.querySelector('button.coche');
  assert(!!caseT, 'A9 : la case de transmission est proposée sur un mois enregistré');
  assert(txt(caseT).indexOf('Transmis à la famille Alpha') !== -1,
    'A9 : la case nomme la famille');
  caseT.click();
  await pause(150);

  assert(appels.transmis.length === 1, 'A9 : la transmission est enregistrée');
  assert(appels.recloturer.length === avantRecloture,
    'A9 : cocher la case NE CLÔTURE PAS le mois');
  assert(!!corps.querySelector('.coche.on'), 'A9 : la case devient cochée');
  assert(txt(corps.querySelector('.coche.on')).indexOf('31 août 2026 à') !== -1,
    'A9 : la transmission est horodatée');
  assert(!corps.querySelector('button.coche'),
    'A9 : elle ne se décoche pas — ce n’est plus un bouton');

  /* Et l'inverse : clôturer ne coche pas. */
  scene.recaps[cle(A.id, 2026, 8)].transmis_le = null;
  delete scene.recaps[cle(A.id, 2026, 8)];
  scene.aujourdhui = '2026-09-03';
  scene.moisCourant = { annee: 2026, mois: 9 };
  window.App.invalider();
  window.App.aller('document', { contratId: A.id, annee: 2026, mois: 8 });
  await pause(250);
  boutonExact(corps, 'Clôturer le mois').click();
  await pause(120);
  var confirmer = boutonExact(sheet, 'Clôturer quand même') || boutonExact(sheet, 'Clôturer le mois');
  if (confirmer) { confirmer.click(); await pause(250); }
  assert(!scene.recaps[cle(A.id, 2026, 8)] || !scene.recaps[cle(A.id, 2026, 8)].transmis_le,
    'A9 : clôturer NE COCHE PAS la transmission');

  /* ==================================================================== */
  /* P9 — Compte sans contrat : l'écran vide                              */
  /* ==================================================================== */
  console.log('\n--- P9 : aucun contrat ---');
  scene.contrats = [];
  await window.App.rechargerContrats();
  await ouvrirAccueil();

  assert(txt(corps).indexOf('Bienvenue') !== -1, 'P9 : l’écran vide accueille');
  assert(txt(corps).indexOf('jours de présence, indemnités d’entretien') !== -1,
    'P9 : il explique ce que fait l’application');
  assert(txt(corps).indexOf('elle prépare le récapitulatif à remettre aux familles') !== -1,
    'P9 : il dit à quoi sert la fin de mois');
  assert(!!boutonExact(corps, 'Ajouter mon premier enfant'),
    'P9 : un bouton unique, plein');
  assert(corps.querySelectorAll('.vide-accueil button').length === 1,
    'P9 : UN seul bouton, pas un menu');

  /* ==================================================================== */
  /* P10 — Chargement en panne : UN message, un bouton « Réessayer »       */
  /* ==================================================================== */
  console.log('\n--- P10 : panne au chargement ---');
  scene.contrats = [A, B];
  await window.App.rechargerContrats();
  /* La panne frappe la LECTURE des données de chaque contrat, pas la liste
     elle-même : c'est le cas réel — la session expire, le réseau tombe — et
     c'est celui où l'ancien écran affichait un message PAR CONTRAT. */
  scene.contratsEnPanne = true;
  window.App.invalider();
  window.App.aller('accueil', {}, true);
  await pause(300);

  var pannes = corps.querySelectorAll('.panne');
  assert(pannes.length === 1,
    'P10 : UN SEUL message de panne, jamais un par contrat (obtenu ' + pannes.length + ')');
  assert(txt(corps).indexOf('Impossible de charger vos contrats.') !== -1,
    'P10 : la phrase exacte de la spécification');
  assert(txt(corps).indexOf('Vérifiez votre connexion, puis réessayez.') !== -1,
    'P10 : la conduite à tenir');
  assert(!!boutonExact(corps, 'Réessayer'), 'P10 : un bouton « Réessayer »');
  scene.contratsEnPanne = false;

  /* ==================================================================== */
  /* P5 — Fin de mois guidée : 4 contrats, un passé                        */
  /* ==================================================================== */
  console.log('\n--- P5 : fin de mois guidée ---');
  scene.contrats = [A, B, C, D];
  scene.aujourdhui = '2026-09-03';
  scene.moisCourant = { annee: 2026, mois: 9 };
  scene.recaps = {};
  /* Un seul mois en retard — août — pour chacun des quatre contrats : le cas
     de la spécification, « 4 contrats, un passé ». Les mois antérieurs sont
     clôturés, sinon la liste compterait huit mois par enfant. */
  [A, B, C, D].forEach(function (c) {
    for (var mm = 1; mm <= 7; mm++) figer(c.id, 2026, mm);
  });
  await window.App.rechargerContrats();
  await ouvrirAccueil();

  var guide = parTexte(corps, '.todo', 'mois sont à clôturer');
  assert(!!guide, 'P5 : le parcours guidé est proposé quand plusieurs mois attendent');
  guide.click();
  await pause(300);

  var etapes = corps.querySelectorAll('.etapes .et');
  assert(etapes.length >= 4, 'P5 : la barre d’étapes liste les contrats (obtenu ' + etapes.length + ')');
  assert(txt(corps.querySelector('.etapes')).indexOf('Alix') !== -1 &&
         txt(corps.querySelector('.etapes')).indexOf('Dominique') !== -1,
    'P5 : les quatre prénoms figurent dans la barre d’étapes');
  assert(corps.querySelectorAll('.etapes .et.on').length === 1,
    'P5 : une seule étape est en évidence');

  var avant = appels.recloturer.length;
  /* Trois clôtures, puis on PASSE le quatrième. */
  for (var i = 0; i < 3; i++) {
    var bc = boutonExact(corps, 'Clôturer et continuer');
    assert(!!bc, 'P5 : « Clôturer et continuer » à l’étape ' + (i + 1));
    if (!bc) break;
    bc.click();
    await pause(300);
  }
  assert(appels.recloturer.length === avant + 3,
    'P5 : trois clôtures écrites, une par écran (obtenu ' +
    (appels.recloturer.length - avant) + ')');
  assert(!corps.querySelector('input[type="checkbox"]'),
    'P5 : aucune case « tout clôturer » — chaque mois est une décision');

  /* CORRECTIF B4 DE LA RELECTURE PR9 — LE CONTRÔLE QUI MANQUAIT.

     Ce parcours écrivait `entree.resultat` BRUT, là où l'écran document
     enrichit l'instantané. Un mois clôturé ici perdait son prénom figé, son
     nom de famille, la date d'effet de son barème et ses jours de congé
     datés : renommer l'enfant plus tard réécrivait un document déjà remis aux
     parents. Le test ne comptait que le NOMBRE de clôtures, jamais leur
     contenu — c'est pour cela qu'il n'a rien vu. */
  var snapGuide = appels.recloturer[appels.recloturer.length - 1].donnees;
  ['prenomEnfant', 'nomFamille', 'salaireDateEffet', 'joursConge',
   'journeesParticulieres'].forEach(function (cle) {
    assert(Object.prototype.hasOwnProperty.call(snapGuide, cle),
      'B4 : l’instantané du parcours guidé porte « ' + cle +' »');
  });
  assert(typeof snapGuide.prenomEnfant === 'string' && snapGuide.prenomEnfant.length > 0,
    'B4 : le prénom est FIGÉ dans l’instantané, pas relu vivant plus tard');
  assert(Array.isArray(snapGuide.joursConge),
    'B4 : la liste datée des jours de congé y est');
  assert(Array.isArray(snapGuide.journeesParticulieres),
    'A15 : et la liste des journées particulières aussi — sinon un changement ' +
    'de planning après clôture réécrit un document déjà remis');
  assert(typeof snapGuide.totalAVerserCentimes === 'number',
    'B4 : les chiffres du moteur sont toujours là — on ENRICHIT, on ne remplace pas');

  var bPasser = boutonExact(corps, 'Passer pour l’instant');
  assert(!!bPasser, 'P5 : « Passer pour l’instant » est offert');
  bPasser.click();
  await pause(250);

  assert(txt(corps).indexOf('3 mois clôturés sur 4') !== -1,
    'P5 : l’écran final compte juste (obtenu « ' + txt(corps).slice(0, 80) + ' »)');
  assert(/Vous avez passé le mois de \S+/.test(txt(corps)),
    'P5 : il nomme le contrat passé');
  assert(txt(corps).indexOf('Vous pourrez le clôturer plus tard depuis l’accueil') !== -1,
    'P5 : il dit ce qu’il reste à faire');

  /* ==================================================================== */
  /* P6 — « Annuler » après une écriture de journée                        */
  /* ==================================================================== */
  console.log('\n--- P6 : annuler après écriture ---');
  scene.contrats = [A];
  scene.recaps = {};
  scene.aujourdhui = '2026-08-11';
  scene.moisCourant = { annee: 2026, mois: 8 };
  await window.App.rechargerContrats();
  window.App.invalider();
  window.App.aller('enfant', { contratId: A.id, annee: 2026, mois: 8 });
  await pause(300);

  assert(txt(corps).indexOf('Chiffres provisoires') !== -1,
    'A1 : le bandeau annonce des chiffres provisoires');
  assert(txt(corps).indexOf('Il reste 14 jours travaillés en août') !== -1,
    'A1 : et le NOMBRE exact de jours restants (obtenu « ' +
    (txt(corps).match(/Il reste[^.]{0,40}/) || [''])[0] + ' »)');
  /* Kit.duree pose une espace INSÉCABLE entre le nombre et l'unité : un
     nombre ne doit pas se retrouver seul en fin de ligne. On normalise avant
     de comparer, sinon le test échoue sur une règle typographique voulue. */
  assert(sansInsecable(txt(corps)).indexOf('vos 30 min sont dues') !== -1,
    'A5 : la phrase permanente prend les minutes DU CONTRAT');

  var jour10 = Array.prototype.filter.call(
    corps.querySelectorAll('table.cal td[role="button"]'), function (td) {
      return txt(td.querySelector('.num')) === '10';
    })[0];
  assert(!!jour10, 'P6 : le lundi 10 août est touchable');
  jour10.click();
  await pause(120);
  var choixAbsence = parTexte(sheet, '.choice', 'absent');
  if (choixAbsence) { choixAbsence.click(); await pause(250); }

  assert(txt(toast).indexOf('Annuler') !== -1,
    'P6 : un « Annuler » est proposé après l’écriture (V8-21)');
  assert(!!toast.querySelector('button.tact'), 'P6 : c’est un vrai bouton');

  /* ==================================================================== */
  /* A5 — un contrat à 45 minutes le dit                                   */
  /* ==================================================================== */
  console.log('\n--- A5 : les minutes viennent du contrat ---');
  var E = contrat('c-e', 'Éliott', 'Echo');
  E.minutes_sup_jour = 45;
  scene.contrats = [E];
  await window.App.rechargerContrats();
  window.App.invalider();
  window.App.aller('enfant', { contratId: E.id, annee: 2026, mois: 8 });
  await pause(300);
  assert(sansInsecable(txt(corps)).indexOf('vos 45 min sont dues') !== -1,
    'A5 : « vos 45 min sont dues » — jamais 30 en dur');

  /* ==================================================================== */
  console.log('');
  if (echecs) { console.error(echecs + ' échec(s).'); process.exit(1); }
  console.log('Tout est conforme.');
})().catch(function (e) {
  console.error('Erreur pendant le parcours :', e && e.stack || e);
  process.exit(1);
});

function Kit_fermer() {
  if (window.Kit && window.Kit.fermerFeuille) window.Kit.fermerFeuille();
}
