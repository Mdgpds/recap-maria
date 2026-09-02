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
/* LOT 25 §25.1 — LES DEUX BLOCS DE L'ACCUEIL, lus par leur SECTION et non
   par une classe de composant. `aFaire()` rend les cartes du bloc
   « Aujourd'hui » (ce qui remplace les tuiles `.todo`), `carteContrat(rang)`
   rend une carte du bloc « Mes contrats » (ce qui remplace `.big`). Passer par
   le titre de section plutôt que par la classe évite qu'un futur changement de
   composant recasse quinze assertions qui ne parlent pas de composants. */
function cartesDeSection(titre) {
  var sec = Array.prototype.filter.call(corps.querySelectorAll('.sec'), function (e) {
    return e.textContent.indexOf(titre) !== -1;
  })[0];
  if (!sec) return [];
  var out = [];
  for (var n = sec.nextSibling; n; n = n.nextSibling) {
    if (n.nodeType !== 1) continue;
    if (n.className.indexOf('sec') !== -1) break;
    if (n.className.indexOf('cd') !== -1) out.push(n);
  }
  return out;
}
/* REDESIGN 2A §3 — L'ACCUEIL N'A PLUS DE SECTIONS TITREES.

   Les deux blocs « Aujourd'hui » et « Mes contrats » sont fusionnes en une
   seule liste : une carte par enfant, a trois etages. Ce qui EMPECHE de
   cloturer — salaire manquant, periode de conge sans journee, mois a
   cloturer — remonte au-dessus, en cartes d'ALERTE (`.card.warn`).

   Les deux reperes du fichier suivent : `aFaire()` rend les alertes,
   `carteContrat()` rend les cartes d'enfant. Rien d'autre ne change ici. */
function aFaire() {
  return Array.prototype.slice.call(corps.querySelectorAll('.card.warn'));
}
function aFaireParTexte(morceau) {
  return aFaire().filter(function (e) {
    return e.textContent.indexOf(morceau) !== -1;
  })[0] || null;
}
function carteContrat(rang) {
  return corps.querySelectorAll('.card.cart3')[rang || 0];
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
  /* LOT 20 — les périodes de familiarisation (§20.2). Le décor les rend
     vides : ces écrans-là n'en ont aucune, et la fiche du contrat doit
     l'afficher comme telle plutôt que d'échouer. */
  listPeriodesFamiliarisation: function () { return Promise.resolve([]); },
  listPeriodesFamiliarisationContrat: function () { return Promise.resolve([]); },
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
require('../js/ui-familiarisation.js');
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

  /* ==========================================================================
     EXIGENCE CHANGÉE — LOT 25 §25.1 : L'ACCUEIL EST REFAIT EN DEUX BLOCS.
     Les tuiles `.todo` de la liste « À faire » deviennent les cartes du bloc
     « Aujourd'hui » (`.cd.tap`), et les grandes cartes `.big` deviennent les
     lignes du bloc « Mes contrats », avec une PASTILLE d'état.

     CE QUI CHANGE, ASSERTION PAR ASSERTION, ET POURQUOI :

     - `.todo` -> `.cd.tap.w` : même rôle, composant du socle (lot 24). Un
       helper `aFaire()` remplace la requête, pour que la suite du fichier ne
       dépende pas d'un nom de classe.
     - « Juillet … n'est pas clôturé » -> « Juillet à clôturer pour Alix ».
       L'ancienne tuile CONSTATAIT un état ; la nouvelle carte NOMME LE GESTE
       et l'enfant concerné. C'est la formulation de la maquette. Le fond ne
       bouge pas : le mois en retard est en tête, avec son alerte.
     - « Le mois est terminé depuis le 31 juil. 2026 » -> « Terminé depuis le
       31 juil. 2026 » : le sujet est déjà le titre de la carte, la phrase se
       débarrasse de sa répétition. LA DATE, elle, est exigée telle quelle.
     - `.big` -> carte de contrat du bloc « Mes contrats ». Un helper
       `carteContrat()` la repère par sa section, pour ne pas confondre avec
       les cartes d'action.
     - « provisoire » sur la carte : RETIRÉ (§25.2). Le caractère provisoire
       d'un mois en cours est porté par la PASTILLE (« en cours ») et par le
       bandeau du document. L'assertion « un mois à clôturer n'annonce plus un
       total provisoire » devient donc une assertion sur la pastille, qui dit
       « à clôturer » — plus précise que l'absence d'un adjectif.
     - « Juillet 2026 n'est pas clôturé » sur la carte du contrat -> pastille
       « 1 mois en retard ». Le retard reste visible depuis la carte, chiffré,
       et l'exigence V8-01 (le MOT, jamais la couleur seule) est vérifiée.

     AUCUNE ASSERTION DE COMPORTEMENT N'EST AFFAIBLIE : la garde V8-03 (août
     n'est pas proposé avant le 25), la bascule exacte au 25, et l'état de
     chaque mois sont tous exigés à l'identique.
     ====================================================================== */
  var tuiles = aFaire();
  assert(tuiles.length > 0, 'P1 : le bloc « Aujourd’hui » n’est pas vide');
  assert(txt(tuiles[0]).indexOf('Juillet') !== -1 &&
         txt(tuiles[0]).indexOf('à clôturer') !== -1,
    'P1 : juillet est EN TÊTE du bloc « Aujourd’hui » (obtenu « ' +
    txt(tuiles[0]).slice(0, 60) + ' »)');
  assert(txt(tuiles[0]).indexOf('Alix') !== -1,
    'P1 : et la carte nomme l’enfant concerné');
  assert(txt(tuiles[0].querySelector('.ico')) === '!',
    'P1 : la carte porte l’icône d’alerte');
  assert(txt(tuiles[0]).indexOf('Terminé depuis le 31 juil. 2026') !== -1,
    'P1 : la carte dit depuis quand le mois est terminé');
  /* §18.4 (7·A5) — UN MOIS ÉCHU N'EST PAS UN MOIS EN COURS QU'ON PEUT DÉJÀ
     CLÔTURER. Le lot 18 avait corrigé la phrase d'un bandeau qui affirmait
     « ce mois est terminé » du 25 au 31 d'un mois qui courait encore ; le lot
     25 a retiré ce bandeau et la distinction vit ICI, sur la carte du bloc
     « Aujourd'hui » — c'est là que Maria décide de clôturer. Les deux
     formulations sont exigées, chacune sur son cas : celle-ci pour le mois
     échu, celle du cas P2 pour le mois en cours. */
  assert(txt(tuiles[0]).indexOf('Vérifiez les journées') === -1,
    '7·A5 : pour un mois ÉCHU, la carte ne dit pas la phrase du mois en cours');
  assert(!aFaireParTexte('Août à clôturer'),
    'P1 : août n’est PAS proposé à la clôture le 11 (V8-03)');

  /* REDESIGN 2A §3.2 — LA PASTILLE D'ETAT QUITTE LA CARTE DE L'ENFANT.
     La carte du 2A porte l'identite, la journee DU JOUR et les compteurs :
     l'etat de CLOTURE du mois n'y figure plus. Il n'a pas disparu pour
     autant, il a change d'endroit — et l'exigence V8-01 (l'etat est ECRIT,
     jamais peint seulement) se verifie la ou il est ecrit : sur l'alerte,
     qui le nomme, le chiffre, et dit quoi faire. */
  var carte = carteContrat();
  assert(!!carte, 'P1 : la carte de l’enfant est là');
  assert(txt(tuiles[0]).indexOf('à clôturer') !== -1,
    'P1 : le retard est ÉCRIT en toutes lettres, pas peint (obtenu « ' +
    txt(tuiles[0]).slice(0, 60) + ' »)');
  assert(aFaire().length === 1,
    'P1 : un seul mois en retard, une seule alerte (obtenu ' + aFaire().length + ')');
  /* ARBITRAGE DU 2 SEPTEMBRE — un mois échu non clôturé rend le bouton du
     pied ACTIF, même le 11. */
  var boutonCloreP1 = Array.prototype.filter.call(document.querySelectorAll('button'), function (b) {
    return /^Clôturer le mois d/.test(b.textContent.trim());
  })[0];
  assert(boutonCloreP1 && !boutonCloreP1.disabled,
    'A1 : le 11, avec juillet en retard, le bouton du pied est ACTIF');

  /* ==================================================================== */
  /* P2 — Le 26, tout à jour sauf août                                    */
  /* ==================================================================== */
  console.log('\n--- P2 : le 26 août, aucun retard ---');
  scene.aujourdhui = '2026-08-26';
  figer(A.id, 2026, 7);
  await ouvrirAccueil();

  var carteAout = aFaireParTexte('Août à clôturer pour Alix');
  assert(!!carteAout, 'P2 : le 26, août est proposé à la clôture');
  /* §18.4 (7·A5), l'autre moitié : le 26, août COURT ENCORE. La carte propose
     de le clôturer sans jamais affirmer qu'il est terminé — c'est exactement
     le défaut que le lot 18 avait corrigé sur le bandeau disparu. */
  assert(txt(carteAout).indexOf('Vérifiez les journées, puis clôturez le mois.') !== -1,
    '7·A5 : au 26, la carte propose de vérifier puis clôturer (obtenu « ' +
    txt(carteAout) + ' »)');
  assert(txt(carteAout).indexOf('Terminé depuis') === -1 &&
         txt(carteAout).indexOf('est terminé') === -1,
    '7·A5 : et elle n’affirme PAS qu’un mois qui court encore est terminé');
  assert(!aFaireParTexte('en retard'),
    'P2 : aucun mois en retard n’est signalé');
  assert(txt(carteAout).indexOf('à clôturer') !== -1,
    'P2 : l’alerte nomme l’état, en toutes lettres');

  /* Le 25 est la frontière : la veille, rien. */
  scene.aujourdhui = '2026-08-24';
  await ouvrirAccueil();
  assert(!aFaireParTexte('Août à clôturer'),
    'P2bis : le 24, août n’est pas encore proposé');
  assert(aFaire().length === 0,
    'P2bis : et AUCUNE alerte ne l’évoque — un mois en cours n’a rien à ' +
    'réclamer (obtenu ' + aFaire().length + ')');
  /* ARBITRAGE DU 2 SEPTEMBRE — le bouton du pied suit la MÊME frontière :
     gris tant qu'il n'y a rien à clôturer, avec une phrase qui dit pourquoi ;
     actif à partir du 25, ou dès qu'un mois échu n'est pas clôturé. */
  var boutonClore = Array.prototype.filter.call(document.querySelectorAll('button'), function (b) {
    return /^Clôturer le mois d/.test(b.textContent.trim());
  })[0];
  assert(!!boutonClore, 'A1 : le bouton « Clôturer le mois de … » est en pied d’accueil');
  assert(boutonClore && boutonClore.disabled,
    'A1 : le 24, sans retard, le bouton est GRIS');
  assert(document.body.textContent.indexOf('Rien à clôturer pour l’instant') !== -1,
    'A1 : et une phrase dit pourquoi');
  scene.aujourdhui = '2026-08-25';
  await ouvrirAccueil();
  assert(!!aFaireParTexte('Août à clôturer pour Alix'),
    'P2bis : le 25, il l’est — la bascule est bien au 25');
  boutonClore = Array.prototype.filter.call(document.querySelectorAll('button'), function (b) {
    return /^Clôturer le mois d/.test(b.textContent.trim());
  })[0];
  assert(boutonClore && !boutonClore.disabled,
    'A1 : le 25, le bouton redevient ACTIF');
  assert(document.body.textContent.indexOf('Rien à clôturer pour l’instant') === -1,
    'A1 : et la phrase disparaît');

  /* ==================================================================== */
  /* P3 — Tout est clôturé                                                */
  /* ==================================================================== */
  console.log('\n--- P3 : tout est clôturé ---');
  scene.aujourdhui = '2026-08-11';
  figer(A.id, 2026, 8);
  await ouvrirAccueil();

  /* REDESIGN 2A — « Rien a cloturer » disparait, et c'est le principe du
     2A : l'accueil montre CE QU'IL Y A A FAIRE. Quand il n'y a rien, il
     n'affiche pas une carte pour le dire — c'est la ligne de contexte de
     l'en-tete qui le porte, et l'absence d'alerte qui le prouve. */
  assert(aFaire().length === 0,
    'P3 : tout est clôturé, donc AUCUNE alerte (obtenu ' + aFaire().length + ')');
  assert(!!carteContrat(),
    'P3 : et les cartes des enfants sont toujours là — l’accueil n’est pas vide');

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
  /* DÉCISION D'ADRIEN (19 août 2026) — l'exigence a changé : l'encart RG-06
     accompagne les congés, il ne les précède plus. Sur un mois sans congé, il
     n'explique rien et alourdit le document. Le cas AVEC congés est vérifié
     dans `lot17-correctifs.smoke.js`. */
  assert(txt(doc).indexOf('Décompte des congés') === -1,
    'P7 : l’encart RG-06 est absent d’un mois sans congé');
  /* EXIGENCE CHANGÉE — LA RÈGLE DES CINQ SAMEDIS (specs du 24 août 2026, §6).

     « Une semaine complète compte donc 6 jours, même si je ne travaille pas le
     samedi » DEVIENT FAUX le jour du déploiement : une semaine ne compte plus
     6 jours d'office. La laisser sur le document ferait mentir la pièce remise
     aux familles — exactement ce que l'application existe pour empêcher.

     L'assertion ne disparaît pas et ne s'affaiblit pas : elle exige toujours
     que l'encart ÉNONCE la règle du décompte mot pour mot, et c'est désormais
     la règle des cinq samedis. Elle exige en plus, ce qu'elle ne faisait pas,
     que la phrase vienne de la constante PARTAGÉE (§6.3, critère A12) : le
     document à l'écran, le texte à copier et l'image sortent tous de
     l'application et arrivent chez la famille. */
  assert(window.UiDocument.ENCART_RG06.indexOf(
    'n’est décompté que lorsque je le choisis') !== -1,
    'P7 : la phrase de l’encart énonce la règle des cinq samedis, mot pour mot');
  assert(window.UiDocument.ENCART_RG06.indexOf('1er juin – 31 mai') !== -1,
    'P7 : et elle nomme l’année de référence');
  assert(window.UiDocument.ENCART_RG06.indexOf('6 jours') === -1,
    'P7 : et elle n’affirme plus qu’une semaine complète en compte 6 d’office');
  assert(window.UiDocument.ENCART_RG06 === window.Kit.ENCART_RG06,
    'A12 : la phrase vient de la constante partagée, en un seul exemplaire');

  var apercu = corps.querySelector('.apercu-texte');
  assert(!!apercu, 'P8 : le texte à coller est AFFICHÉ, pas seulement copiable');
  assert(txt(corps).indexOf('Le message que vous allez coller') !== -1,
    'P8 : il est annoncé par son titre');
  assert(txt(apercu).indexOf('Récapitulatif mensuel') !== -1,
    'P8 : l’aperçu contient bien le texte intégral');
  /* Correction A11, sous sa forme courte : le texte qui SORT de l’application
     doit rester distinguable d’un définitif. */
  assert(txt(apercu).indexOf('Document provisoire') !== -1,
    'A11 : le texte à coller dit qu’il est provisoire');
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

  /* EXIGENCE CHANGÉE — LOT 25 §25.1 : la carte du parcours guidé.
     Ancien libellé : « N mois sont à clôturer ». Nouveau : « N mois à
     clôturer », comme les autres cartes du bloc « Aujourd'hui » — un titre
     nomme le geste, il ne conjugue pas. Le SEUIL ne bouge pas : le parcours
     guidé apparaît dès qu'il y a plus d'un mois à clôturer, et c'est ce que
     ce cas vérifie. */
  var guide = aFaireParTexte('mois à clôturer');
  assert(!!guide, 'P5 : le parcours guidé est proposé quand plusieurs mois attendent');
  assert(txt(guide).indexOf('4 mois à clôturer') !== -1,
    'P5 : et il annonce le NOMBRE de mois (obtenu « ' + txt(guide).slice(0, 60) + ' »)');
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

  /* ==========================================================================
     EXIGENCE CHANGÉE — LOT 25 §25.2 et §25.3 : DEUX BANDEAUX PERMANENTS
     QUITTENT L'ESPACE ENFANT. L'écran n'a plus qu'UN encart, celui du point le
     plus urgent ; deux textes qui s'affichaient à chaque ouverture, quoi qu'il
     arrive, n'y ont plus leur place.

     RIEN NE SE PERD (A.2) — voici où chacun vit désormais, et l'assertion
     suit :

     1. « Chiffres provisoires » : le caractère provisoire est dit par la
        PASTILLE de la carte d'accueil (« en cours ») et par le bandeau
        « Document provisoire » du document — deux endroits où Maria regarde
        un TOTAL, c'est-à-dire là où l'information sert. Vérifié ci-dessous
        sur le document.
     2. « Il reste 14 jours travaillés en août » : le compte exact des jours
        restants vit dans l'avertissement de CLÔTURE ANTICIPÉE (V8-04), au
        moment où il décide de quelque chose — juste avant de figer. Il y
        était déjà, et le cas P4 de ce fichier le vérifie mot pour mot, avec
        le nombre exact. On le re-vérifie ici pour que le lien soit explicite.
     3. « vos 30 min sont dues » (sous-texte de « Rien à faire les jours
        normaux », retiré par le §25.3) : la règle vit dans LA FICHE DU
        CONTRAT, où elle est dite AVEC LA VALEUR DE CE CONTRAT — « Minutes
        supplémentaires par jour : 30 min », puis « L'enfant repart vers
        18h30 : les 30 min s'ajoutent à l'accueil ». La fiche est à un appui
        de l'espace enfant, dans le repli « Depuis le début ». Le lot 27 y
        ajoutera l'énoncé général, dans « Comment l'application compte ».
        L'EXIGENCE A5 — la phrase prend les minutes DU CONTRAT, jamais 30 en
        dur — est vérifiée là, et elle en sort renforcée : l'ancienne phrase
        disait la durée, la fiche la dit ET la rattache à l'heure de départ.
     ====================================================================== */
  assert(!parTexte(corps, '.enc', 'Chiffres provisoires'),
    '§25.2 : l’encart permanent « Chiffres provisoires » a quitté l’espace enfant');
  window.App.aller('document', { contratId: A.id, annee: 2026, mois: 8 });
  await pause(300);
  assert(txt(corps).indexOf('Document provisoire') !== -1,
    'A1 : le document dit que les chiffres ne sont pas définitifs');
  window.App.aller('enfant', { contratId: A.id, annee: 2026, mois: 8 });
  await pause(300);

  /* Le NOMBRE de jours restants, au moment où il décide : la clôture. */
  window.App.aller('document', { contratId: A.id, annee: 2026, mois: 8 });
  await pause(300);
  boutonExact(corps, 'Clôturer le mois').click();
  await pause(200);
  assert(/14 jours travaillés sont encore à venir/.test(txt(sheet)),
    'A1 : le NOMBRE exact de jours restants est dit avant de figer (obtenu « ' +
    (txt(sheet).match(/\d+ jours travaillés[^.]{0,40}/) || [''])[0] + ' »)');
  boutonExact(sheet, 'Annuler').click();
  await pause(150);
  window.App.aller('enfant', { contratId: A.id, annee: 2026, mois: 8 });
  await pause(300);

  var jour10 = Array.prototype.filter.call(
    corps.querySelectorAll('table.cal td[role="button"]'), function (td) {
      return txt(td.querySelector('.num')) === '10';
    })[0];
  assert(!!jour10, 'P6 : le lundi 10 août est touchable');
  jour10.click();
  await pause(120);
  /* EXIGENCE CHANGÉE — la feuille du jour est refaite comme la maquette
     (23 août) : « Léa était absente » est devenu « Absence de Léa » dans la
     liste (l'accord en genre passe par la tournure, jamais par un point
     médian), et l'enregistrement passe par le bouton unique. Ce que ce cas
     vérifie — « Annuler » après une écriture — ne change pas. */
  var choixAbsence = parTexte(sheet, '.choice', 'Absence de');
  assert(!!choixAbsence, 'P6 : le choix « Absence de… » est offert');
  choixAbsence.click();
  await pause(150);
  var bEnr = parTexte(sheet, 'button', 'Enregistrer');
  if (bEnr) { bEnr.click(); await pause(250); }

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
  /* Kit.duree pose une espace INSÉCABLE entre le nombre et l'unité : un
     nombre ne doit pas se retrouver seul en fin de ligne. On normalise avant
     de comparer, sinon le test échoue sur une règle typographique voulue. */
  parTexte(corps, '.ln.tap', 'Contrat, horaires et rémunération').click();
  await pause(350);
  var tFiche = sansInsecable(txt(corps));
  assert(tFiche.indexOf('45 min') !== -1 && tFiche.indexOf('30 min') === -1,
    'A5 : « 45 min » — les minutes viennent DU CONTRAT, jamais 30 en dur ' +
    '(obtenu « ' + (tFiche.match(/[^.]{0,30}min[^.]{0,30}/) || [''])[0] + ' »)');
  assert(tFiche.indexOf('s’ajoutent à l’accueil') !== -1,
    'A5 : et la fiche dit ce que ces minutes FONT, pas seulement leur durée');

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
