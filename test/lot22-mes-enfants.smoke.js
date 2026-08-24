/* ============================================================================
   Test de fumée — LOT 22 : MES ENFANTS, LA PHOTO, LA BARRE D'ONGLETS.

   La règle du lot 16, sans exception : TOUT ÉCRAN LIVRÉ DOIT ÊTRE RENDU PAR UN
   TEST QUI CLIQUE. Ce lot est de l'interface pure — il n'y a RIEN d'autre à
   vérifier qu'un écran rendu. Un contrôle par recherche de chaîne dans un
   `.js` ne prouverait ici strictement rien.

   Ce fichier monte le vrai `index.html`, le vrai moteur, la vraie chaîne, et
   lit ce qui s'affiche. Il couvre :

     §22.1  la page « Mes enfants », ses deux sections, ses comptes calculés,
            et le contrat terminé qui s'ouvre en lecture seule ;
     §22.2  la photo accessible depuis la fiche et dès la création, et le
            fait qu'elle ne fuit NULLE PART (A2) ;
     §22.3  les icônes SVG, la pastille pleine, le badge, et la barre qui suit
            les écrans intérieurs.

   Décor : deux enfants gardés, un contrat terminé. Septembre 2026.

   Lancement : node test/lot22-mes-enfants.smoke.js
   ========================================================================= */
'use strict';

var fs = require('fs');
var path = require('path');
var JSDOM = require('jsdom').JSDOM;
var Decor = require('./decor-avenants.js');

var racine = path.join(__dirname, '..');
var SOURCE_INDEX = fs.readFileSync(path.join(racine, 'index.html'), 'utf8');
var dom = new JSDOM(SOURCE_INDEX, { url: 'https://exemple.test/' });

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
/* Les espaces INSÉCABLES sont normalisés — la typographie française en sème
   partout. L'échappement est explicite : écrit littéralement, ce caractère est
   invisible dans le fichier. */
function txt(el) { return el ? String(el.textContent).replace(/[\u00a0\u202f]/g, ' ') : ''; }
function contient(el, morceau, msg) {
  if (txt(el).indexOf(morceau) !== -1) { assert(true, msg); return; }
  assert(false, msg + ' — « ' + morceau + ' » introuvable dans : ' + txt(el).slice(0, 360));
}
function absent(el, morceau, msg) {
  assert(txt(el).indexOf(morceau) === -1, msg + ' — « ' + morceau + ' » ne devrait pas y être');
}
function parTexte(racineEl, selecteur, morceau) {
  return Array.prototype.filter.call(racineEl.querySelectorAll(selecteur), function (e) {
    return txt(e).indexOf(morceau) !== -1;
  })[0] || null;
}
function boutonExact(racineEl, libelle) {
  return Array.prototype.filter.call(racineEl.querySelectorAll('button'), function (e) {
    return txt(e).trim() === libelle;
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

/* --- Décor. Valeurs FICTIVES et rondes : le dépôt est PUBLIC. ----------- */
var PLANNING = [1, 2, 3, 4, 5];
/* Une photo minuscule et neutre — un pixel transparent. Le lot interdit
   qu'elle sorte de l'application ; le test vérifie qu'elle n'en sort pas. */
var PHOTO = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

function enfant(id, prenom, opts) {
  opts = opts || {};
  return {
    id: id, prenom_enfant: prenom, famille_id: 'f1',
    famille: { id: 'f1', nom: 'Aubépine' },
    date_debut: '2026-01-01', date_fin: opts.fin || null,
    minutes_contractuelles: 540, minutes_sup_jour: 30, minutes_par_jour_conge: 540,
    entretien_centimes_jour: 550, jours_planning: PLANNING,
    heure_arrivee: '08:30:00', heure_depart: '17:30:00',
    statut: opts.statut || 'actif',
    sup_dues_si_enfant_absent: true, ordre_imputation: 'cp_puis_sup',
    archive: !!opts.archive,
    nom: null, genre: prenom === 'Léa' ? 'f' : 'm', couleur: null,
    photo: opts.photo || null
  };
}

var LEA = enfant('c-lea', 'Léa');
var TOM = enfant('c-tom', 'Tom');
var JADE = enfant('c-jade', 'Jade',
  { archive: true, statut: 'termine', fin: '2026-06-30' });
var TOUS = [LEA, TOM, JADE];
var ACTIFS = [LEA, TOM];

var AVENANTS = {};
TOUS.forEach(function (c) {
  var a = Decor.avenantDe(c, { id: 'a-' + c.id, date_effet: '2026-01-01',
    brut_mensuel_centimes: 140400, net_mensuel_centimes: 107100 });
  a.numero = 1;
  AVENANTS[c.id] = [a];
});

var ecritures = [];

var DB = {
  getSession: function () {
    return Promise.resolve({ user: { id: 'u1', email: 'maria@exemple.test' } });
  },
  onAuthChange: function () {},
  signOut: function () { return Promise.resolve(true); },
  getEmettrice: function () { return Promise.resolve({ nom: 'Maria' }); },
  enregistrerEmettrice: function (nom) { return Promise.resolve({ nom: nom }); },
  getPreferenceRappel: function () { return Promise.resolve(null); },
  listContratsActifs: function () { return Promise.resolve(ACTIFS.slice()); },
  listContratsTous: function () { return Promise.resolve(TOUS.slice()); },
  listContratsPourMois: function () { return Promise.resolve(ACTIFS.slice()); },
  listContratsPourPeriode: function () { return Promise.resolve(ACTIFS.slice()); },
  listFamilles: function () { return Promise.resolve([LEA.famille]); },
  listFamillesToutes: function () { return Promise.resolve([LEA.famille]); },
  listFamillesAvecContrats: function () {
    return Promise.resolve([{ id: 'f1', nom: 'Aubépine', archive: false, contrats: TOUS.slice() }]);
  },
  contratEstVierge: function () { return Promise.resolve(false); },
  getAvenants: function (id) { return Promise.resolve((AVENANTS[id] || []).slice()); },
  ajouterAvenant: function (id, champs) { return Promise.resolve(champs); },
  majAvenant: function (id, champs) { return Promise.resolve(champs); },
  supprimerAvenant: function () { return Promise.resolve(true); },
  creerFamille: function (f) { return Promise.resolve({ id: 'f1', nom: f.nom }); },
  creerContrat: function (champs) {
    ecritures.push({ geste: 'creerContrat', champs: champs });
    return Promise.resolve(enfant('c-neuf', champs.prenom_enfant, { photo: champs.photo }));
  },
  majContrat: function (id, champs) {
    ecritures.push({ geste: 'majContrat', id: id, champs: champs });
    TOUS.forEach(function (c) { if (c.id === id) { for (var k in champs) c[k] = champs[k]; } });
    return Promise.resolve(true);
  },
  archiverContrat: function () { return Promise.resolve(true); },
  desarchiverContrat: function (id) {
    ecritures.push({ geste: 'desarchiverContrat', id: id });
    TOUS.forEach(function (c) { if (c.id === id) { c.archive = false; c.statut = 'actif'; } });
    return Promise.resolve(true);
  },
  getCompteurInitial: function (id) {
    return Promise.resolve({ contrat_id: id, date_reference: '2026-09-01',
      minutes_sup: 0, minutes_cp_acquis: 0, minutes_cp_pris: 0 });
  },
  getJourneesMois: function () { return Promise.resolve({}); },
  getJourneesPeriode: function () { return Promise.resolve({}); },
  listImputations: function () { return Promise.resolve([]); },
  listImputationsPourMois: function () { return Promise.resolve([]); },
  enregistrerImputation: function (i) { return Promise.resolve(i); },
  supprimerImputation: function () { return Promise.resolve(true); },
  listPeriodesFamiliarisation: function () { return Promise.resolve([]); },
  listPeriodesFamiliarisationContrat: function () { return Promise.resolve([]); },
  getNoteMensuelle: function () { return Promise.resolve(null); },
  enregistrerNoteMensuelle: function (c, a, m, t) { return Promise.resolve({ texte: t }); },
  listRecapsPeriode: function () { return Promise.resolve([]); },
  listRecapsContrat: function () { return Promise.resolve([]); },
  getRecap: function () { return Promise.resolve(null); },
  enregistrerJournee: function (l) { return Promise.resolve(l); },
  supprimerJournee: function () { return Promise.resolve(true); },
  poserAbsenceMaria: function () { return Promise.resolve([]); },
  retirerAbsenceMaria: function () { return Promise.resolve(true); },
  recloturerRecap: function () { return Promise.resolve({ id: 'x', statut: 'fige' }); },
  /* Lot 14 — l'export. C'est LUI qui doit être vérifié : une photo qui
     partirait dans un fichier posé sur le bureau serait la fuite la plus
     grave du lot. */
  exporterTout: function () {
    return Promise.resolve({ contrats: TOUS.map(function (c) {
      var copie = {};
      Object.keys(c).forEach(function (k) { if (k !== 'photo') copie[k] = c[k]; });
      return copie;
    }) });
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

window.App.moisCourant = function () { return { annee: 2026, mois: 9 }; };
window.App.aujourdhui = function () { return '2026-09-15'; };

var corps = document.getElementById('corps');
var sheet = document.getElementById('sheet');
var tabbar = document.getElementById('tabbar');

function ongletActif() {
  var b = tabbar.querySelector('button.on');
  return b ? b.getAttribute('data-onglet') : null;
}

(async function () {
  document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  await pause(500);

  /* ==================================================================== */
  /* §22.3 — LES ICÔNES SONT DES SVG, ET RIEN D'AUTRE (A1)                */
  /* ==================================================================== */
  console.log('\n--- §22.3 A1 : quatre vraies icônes SVG ---');

  var icones = tabbar.querySelectorAll('button .i');
  egal(icones.length, 4, 'quatre onglets');
  var tousSvg = Array.prototype.every.call(icones, function (i) {
    return i.querySelector('svg') !== null;
  });
  assert(tousSvg, 'A1 : chaque onglet porte un SVG embarqué');

  /* Aucun caractère Unicode décoratif ne doit subsister dans la barre. On les
     cherche NOMMÉMENT, ceux qui y étaient : ⌂ ◷ ☾ ⋯. */
  var texteBarre = txt(tabbar);
  ['⌂', '◷', '☾', '⋯'].forEach(function (c) {
    assert(texteBarre.indexOf(c) === -1,
      'A1 : le caractère décoratif « ' + c + ' » a disparu de la barre');
  });
  assert(SOURCE_INDEX.indexOf('<svg') !== -1,
    'A1 : les SVG sont dans la page, pas chargés depuis ailleurs');

  /* ==================================================================== */
  /* §22.3 — LA BARRE SUIT LES ÉCRANS INTÉRIEURS                          */
  /* ==================================================================== */
  console.log('\n--- §22.3 : la barre suit les écrans intérieurs ---');

  window.App.aller('accueil', {}, true);
  await pause(400);
  egal(tabbar.hidden, false, 'la barre est là sur l’Accueil');
  egal(ongletActif(), 'accueil', 'et « Accueil » est actif');
  var pastille = tabbar.querySelector('button.on');
  assert(pastille.className.indexOf('on') !== -1,
    'l’onglet actif porte la classe qui le remplit — pas qu’une couleur de texte');

  window.App.aller('enfant', { contratId: 'c-lea', annee: 2026, mois: 9 });
  await pause(500);
  egal(tabbar.hidden, false, 'elle reste là sur l’espace d’un enfant');
  egal(ongletActif(), 'accueil', '« Accueil » reste actif sur un espace enfant');

  window.App.aller('fiche', { contratId: 'c-lea' });
  await pause(500);
  egal(tabbar.hidden, false, 'et sur une fiche de contrat');
  egal(ongletActif(), 'menu', '« Menu » est actif sur une fiche');

  /* ==================================================================== */
  /* §22.3 A2 — LE BADGE                                                  */
  /* ==================================================================== */
  console.log('\n--- §22.3 A2 : le badge disparaît à zéro ---');

  window.App.majPastilleAccueil(3);
  var bdg = tabbar.querySelector('.pastille-onglet');
  assert(!!bdg && txt(bdg) === '3', 'A2 : le badge affiche le compte réel');
  var bouton = tabbar.querySelector('button[data-onglet="accueil"]');
  egal(bouton.getAttribute('aria-description'), '3 mois à clôturer',
    'A2 : et il est annoncé aux lecteurs d’écran, pas seulement peint');
  window.App.majPastilleAccueil(0);
  assert(!tabbar.querySelector('.pastille-onglet'),
    'A2 : à zéro, le badge DISPARAÎT — il n’affiche pas « 0 »');

  /* ==================================================================== */
  /* §22.1 — LA PAGE « MES ENFANTS »                                      */
  /* ==================================================================== */
  console.log('\n--- §22.1 : la page Mes enfants ---');

  window.App.aller('menu', {}, true);
  await pause(500);
  var ligne = parTexte(corps, '.cd', 'Mes enfants');
  assert(!!ligne, 'le Menu porte une entrée unique « Mes enfants »');
  contient(ligne, '2 en garde · 1 contrat terminé',
    '§22.1 : les deux comptes sont CALCULÉS, pas écrits en dur');
  absent(corps, 'Léa · Tom', '§22.1 : le Menu n’affiche plus la liste des enfants en ligne');
  /* EXIGENCE CHANGÉE — LOT 27 §27.2 : « FAMILLES » QUITTE LE MENU.
     Le lot 22 l'avait remplacée par « Mes enfants » (Maria pense par enfant),
     puis la correction C5 de la relecture l'avait rétablie en signalant la
     question à Adrien : « s'il préfère l'entrée unique, c'est cette ligne-ci
     qui repart. » Il a tranché le 23 août, et le §27.2 le reprend.
     RIEN NE SE PERD (B.0-7) : l'écran des familles existe toujours, et il
     s'atteint par « Voir par famille » en bas de « Mes enfants » — le même
     nombre d'appuis, depuis l'endroit où la question « qui vit ensemble ? »
     se pose vraiment. Le chemin est vérifié plus bas dans ce fichier. */
  assert(!parTexte(corps, '.cd', 'Familles'),
    '§27.2 : l’entrée unique est « Mes enfants » — « Familles » a quitté le Menu');

  ligne.click();
  await pause(500);
  contient(corps, 'En garde', '§22.1 : la section « En garde »');
  contient(corps, 'Contrats terminés', '§22.1 : et la section « Contrats terminés »');
  contient(corps, 'Léa', 'Léa y est');
  contient(corps, 'Tom', 'Tom aussi');
  contient(corps, 'Jade', 'et Jade, terminée');
  contient(corps, 'historique conservé', 'la carte d’un contrat terminé le dit');
  assert(!!boutonExact(corps, 'Ajouter un enfant'),
    '§22.1 : « Ajouter un enfant » est dans la première section');
  assert(!!boutonExact(corps, 'Voir par famille'),
    '§22.1 : la vue par famille n’est pas perdue, elle change de porte');

  /* ==================================================================== */
  /* §22.1 — LE CONTRAT TERMINÉ S'OUVRE EN LECTURE SEULE                  */
  /* ==================================================================== */
  console.log('\n--- §22.1 : un contrat terminé, en lecture seule ---');

  parTexte(corps, 'button', 'Jade').click();
  await pause(500);
  /* La période est écrite avec `Kit.dateLongue`, la même mise en forme que
     partout ailleurs dans l'application — « 1 janv. 2026 ». */
  contient(corps, 'Contrat terminé — du 1 janv. 2026 au 30 juin 2026',
    '§22.1 : le bandeau nomme la période');
  contient(corps, 'Aucune journée n’est modifiable',
    '§22.1 : et il dit ce qui est verrouillé');
  assert(!!boutonExact(corps, 'Voir tous ses mois'),
    '§22.1 : ses mois restent consultables');
  assert(!!boutonExact(corps, 'Ses soldes de fin de contrat'),
    '§22.1 : ses soldes de fin de contrat aussi');
  assert(!!boutonExact(corps, 'Remettre en cours'),
    '§22.1 : et « Remettre en cours » est là');
  assert(!boutonExact(corps, 'Modifier l’identité'),
    '§22.1 : mais rien ne se modifie — pas de formulaire d’identité');
  assert(!parTexte(corps, '.fld', 'Photo'),
    '§22.1 : ni de bloc photo : un contrat terminé ne se modifie plus');
  /* LOT 27 §27.3 — sa carte d'identité est INERTE : elle n'ouvre rien, parce
     qu'il n'y a rien à modifier. */
  var carteJade = parTexte(corps, '.cd', 'Jade');
  assert(!!carteJade && carteJade.tagName !== 'BUTTON',
    '§22.1 : sa carte d’identité ne s’ouvre pas non plus');

  boutonExact(corps, 'Remettre en cours').click();
  await pause(600);
  assert(ecritures.some(function (e) {
    return e.geste === 'desarchiverContrat' && e.id === 'c-jade';
  }), '§22.1 : « Remettre en cours » fonctionne');
  JADE.archive = true; JADE.statut = 'termine';   // on rétablit le décor

  /* ==================================================================== */
  /* §22.2 — LA PHOTO, ACCESSIBLE DEPUIS LA FICHE                         */
  /* ==================================================================== */
  console.log('\n--- §22.2 : la photo depuis la fiche ---');

  window.App.invalider();
  window.App.aller('fiche', { contratId: 'c-lea' });
  await pause(500);
  /* ==========================================================================
     EXIGENCE CHANGÉE — LOT 27 §27.3 : LA PHOTO DESCEND D'UN CRAN.

     Le §22.2 l'avait mise EN TÊTE DE LA FICHE, et c'était la bonne correction
     à ce moment-là : on ne pouvait la poser que depuis « Modifier l'identité »,
     un bouton en BAS d'une fiche longue, ouvrant un formulaire de douze champs
     où l'on croise la date de début du contrat et son statut. Le geste le plus
     anodin passait par l'écran le plus risqué, et personne ne l'avait jamais
     fait : l'application avait une photo que personne ne pouvait mettre.

     CE MOTIF TOMBE. La carte d'identité est le PREMIER élément de la fiche, et
     elle ouvre cette feuille d'un appui. Le geste coûte un appui de plus qu'au
     lot 22 — et cinq de moins qu'avant lui. En échange, la fiche rend le
     premier écran à ce qu'elle sert : les conditions du contrat, et le seul
     geste qu'on y fait, « Faire un avenant ».

     CE QUI RESTE EXIGÉ, mot pour mot : la photo est ATTEIGNABLE, elle dit où
     elle n'apparaîtra jamais, et « Retirer » reste masqué tant qu'il n'y a
     rien à retirer — un bouton qui ne peut rien faire fait douter. Tout est
     vérifié ci-dessous, sur la feuille où la photo vit.
     ====================================================================== */
  var carteId = parTexte(corps, '.cd', 'Léa');
  assert(!!carteId, '§27.3 : la carte d’identité est en tête de la fiche');
  assert(txt(carteId).indexOf('photo, identité') !== -1,
    '§27.3 : et son sous-texte dit ce qu’elle ouvre');
  assert(!parTexte(corps, '.fld', 'Photo'),
    '§27.3 : le bloc photo n’occupe plus le premier écran de la fiche');
  carteId.click();
  await pause(300);

  var blocPhoto = parTexte(sheet, '.fld', 'Photo');
  assert(!!blocPhoto, '§22.2 : la photo est atteignable en UN appui depuis la fiche');
  contient(blocPhoto, 'Choisir une photo', 'il propose de choisir une photo');
  contient(blocPhoto, 'Jamais sur le récapitulatif ni dans l’export',
    '§22.2 : et il dit où elle n’apparaîtra jamais');
  var bRetirer = boutonExact(blocPhoto, 'Retirer la photo');
  assert(!!bRetirer && bRetirer.hidden === true,
    '§22.2 : « Retirer » est masqué quand il n’y a pas de photo — un bouton ' +
    'qui ne peut rien faire fait douter');
  window.Kit.fermerFeuille();
  await pause(80);

  /* On pose une photo comme le ferait le sélecteur de fichier du téléphone :
     par le chemin d'enregistrement du bloc, celui que la fiche lui donne. */
  ecritures.length = 0;
  await window.UiContrat.blocPhoto && Promise.resolve();
  LEA.photo = PHOTO;
  await DB.majContrat('c-lea', { photo: PHOTO });
  await window.App.rechargerContrats();
  window.App.invalider();

  window.App.aller('accueil', {}, true);
  await pause(500);
  var avatar = corps.querySelector('.av img, .avphoto img, img');
  assert(!!avatar, '§22.2 A1 : la photo apparaît sur l’Accueil');

  window.App.aller('fiche', { contratId: 'c-lea' });
  await pause(500);
  parTexte(corps, '.cd', 'Léa').click();
  await pause(300);
  var bRetirer2 = boutonExact(parTexte(sheet, '.fld', 'Photo'), 'Retirer la photo');
  assert(!!bRetirer2 && bRetirer2.hidden === false,
    '§22.2 : « Retirer la photo » apparaît quand il y en a une');
  window.Kit.fermerFeuille();
  await pause(80);

  /* ==================================================================== */
  /* §22.2 A2 — LA PHOTO NE FUIT NULLE PART                               */
  /* ==================================================================== */
  console.log('\n--- §22.2 A2 : aucune photo sur aucun document ---');

  window.App.aller('document', { contratId: 'c-lea', annee: 2026, mois: 9 });
  await pause(600);
  assert(!corps.querySelector('.doc img'),
    'A2 : aucune image dans le document remis à la famille');
  assert(txt(corps).indexOf('data:image') === -1,
    'A2 : et aucune donnée d’image dans son texte');

  /* L'export : le contrôle le plus important du lot. Une photo d'enfant dans
     un fichier posé sur un bureau est exactement ce que le projet s'interdit
     depuis le lot 8. */
  var exporte = await DB.exporterTout();
  var brut = JSON.stringify(exporte);
  assert(brut.indexOf('data:image') === -1,
    'A2 : aucune photo dans l’export');
  assert(brut.indexOf('"photo"') === -1,
    'A2 : la colonne elle-même est retirée à la source, pas vidée');

  /* ==================================================================== */
  /* §22.2 — LA PHOTO DÈS LA CRÉATION                                     */
  /* ==================================================================== */
  console.log('\n--- §22.2 : la photo dès la création ---');

  window.App.aller('menu', {}, true);
  await pause(500);
  parTexte(corps, '.cd', 'Ajouter un enfant').click();
  await pause(400);
  var blocs = sheet.querySelectorAll('.fld');
  assert(blocs.length > 0 && txt(blocs[0]).indexOf('Photo') !== -1,
    '§22.2 : l’écran « Ajouter un enfant » COMMENCE par la photo');
  contient(sheet, 'Jamais sur le récapitulatif ni dans l’export',
    '§22.2 : avec la même promesse qu’ailleurs');

  console.log('\n' + (echecs ? echecs + ' échec(s).' : 'Tout est conforme.'));
  process.exit(echecs ? 1 : 0);
})().catch(function (e) {
  console.error('Erreur pendant le parcours : ' + (e && e.stack || e));
  process.exit(1);
});
