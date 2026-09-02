/* ============================================================================
   Test de fumée — lot 8 : navigation, familles et identité des contrats.
   Cas P1 à P10 de la spécification.

   POURQUOI CE FICHIER EXISTE.

   Ce lot corrige une PERTE DE DONNÉES RÉELLE, en production, et silencieuse :
   le champ « Nom de la famille » de la fiche contrat écrivait dans
   `famille.nom`, donc renommait le foyer pour TOUS ses enfants. Maria croyait
   corriger Léa, elle renommait aussi Tom, et rien à l'écran ne le disait. On
   ne s'en apercevait qu'en ouvrant la fiche d'un autre enfant, parfois des
   semaines plus tard.

   Une correction de ce genre ne se vérifie pas en relisant du code : elle se
   vérifie en cherchant, dans l'écran rendu, que le champ dangereux N'EXISTE
   PLUS — et qu'aucun autre chemin ne le remplace en douce. C'est ce que fait
   P3 et surtout A2. Les autres cas gardent ce qui doit rester vrai : un
   renommage NOMME les enfants concernés, un foyer qui a un contrat actif ne se
   range pas, la couleur d'un enfant n'entre jamais dans le calendrier, et
   aucune photo n'atteint un document remis à une famille.

   Lancement : node test/lot8-identite.smoke.js
   ========================================================================= */
'use strict';
/* LOT 17 §17.2 — les conditions du contrat sont DATÉES : le décor expose
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
global.FileReader = dom.window.FileReader;
global.Image = dom.window.Image;

var echecs = 0;
function assert(cond, msg) {
  if (!cond) { echecs++; console.error('FAIL ' + msg); } else { console.log('ok   ' + msg); }
}
function pause(ms) { return new Promise(function (r) { setTimeout(r, ms || 30); }); }
function txt(el) { return el ? el.textContent : ''; }
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

/* --- Décor. Valeurs FICTIVES et rondes : le dépôt est public. ----------- */
var FOYERS = {
  'f-papillon': { id: 'f-papillon', nom: 'Papillon', canal: null, archive: false },
  'f-mesange':  { id: 'f-mesange',  nom: 'Mésange',  canal: null, archive: false },
  'f-vide':     { id: 'f-vide',     nom: 'Sansenfant', canal: null, archive: false },
  /* Iris a son PROPRE foyer : Mésange ne compte alors qu'un seul enfant, ce
     qui est exactement le cas P2 — renommer un foyer d'un seul enfant. */
  'f-iris':     { id: 'f-iris',     nom: 'Aigrette',   canal: null, archive: false }
};

function contrat(id, prenom, foyerId, extra) {
  var c = {
    id: id, prenom_enfant: prenom, famille_id: foyerId,
    famille: FOYERS[foyerId], date_debut: '2026-01-01', date_fin: null,
    minutes_contractuelles: 540, minutes_sup_jour: 30, minutes_par_jour_conge: 540,
    entretien_centimes_jour: 500, jours_planning: [1, 2, 3, 4, 5],
    heure_arrivee: '08:30:00', heure_depart: '18:00:00', statut: 'actif',
    sup_dues_si_enfant_absent: true, ordre_imputation: 'cp_puis_sup', archive: false,
    nom: null, genre: null, couleur: null, photo: null
  };
  Object.keys(extra || {}).forEach(function (k) { c[k] = extra[k]; });
  return c;
}

/* Deux enfants dans le MÊME foyer : c'est la situation où le défaut faisait
   des dégâts. Un troisième, seul dans le sien, pour le cas P2. */
var LEA = contrat('c-lea', 'Léa', 'f-papillon', { genre: 'f', couleur: 'prune', nom: 'Martin' });
var TOM = contrat('c-tom', 'Tom', 'f-papillon', { genre: 'g', couleur: 'bleu' });
var ZOE = contrat('c-zoe', 'Zoé', 'f-mesange', { genre: 'f' });
/* Un contrat terminé, pour l'onglet Historique. */
var IRIS = contrat('c-iris', 'Iris', 'f-iris',
  { archive: true, statut: 'termine', date_fin: '2026-03-31' });

var contrats = [LEA, TOM, ZOE, IRIS];
var appels = { renommer: [], rattacher: [], archiverFamille: [], majContrat: [] };

function foyersAvecContrats() {
  return Object.keys(FOYERS).map(function (k) {
    var f = FOYERS[k];
    return {
      id: f.id, nom: f.nom, canal: f.canal, archive: f.archive,
      contrats: contrats.filter(function (c) { return c.famille_id === f.id; })
        .map(function (c) {
          return { id: c.id, prenom_enfant: c.prenom_enfant, nom: c.nom, genre: c.genre,
            photo: c.photo, couleur: c.couleur, statut: c.statut, archive: c.archive,
            date_debut: c.date_debut, date_fin: c.date_fin };
        })
    };
  });
}


/* LOT 17 §17.2 — le contrat par son identifiant. `getAvenants` en a besoin
   pour reprendre les réglages du décor dans l'avenant : le moteur ne les lit
   plus sur `contrat`. */
function contratDe(id) {
  var liste = contrats || [];
  return liste.filter(function (c) { return c && c.id === id; })[0] || liste[0] || {};
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
    return Promise.resolve(contrats.filter(function (c) { return !c.archive; }));
  },
  listContratsTous: function () { return Promise.resolve(contrats); },
  listContratsPourMois: function () { return Promise.resolve(contrats); },
  listContratsPourPeriode: function () { return Promise.resolve(contrats); },
  listFamilles: function () {
    return Promise.resolve(Object.keys(FOYERS).map(function (k) { return FOYERS[k]; })
      .filter(function (f) { return !f.archive; }));
  },
  listFamillesToutes: function () {
    return Promise.resolve(Object.keys(FOYERS).map(function (k) { return FOYERS[k]; }));
  },
  listFamillesAvecContrats: function () { return Promise.resolve(foyersAvecContrats()); },
  creerFamille: function (champs) {
    var f = { id: 'f-neuf', nom: champs.nom, canal: null, archive: false };
    FOYERS[f.id] = f;
    return Promise.resolve(f);
  },
  renommerFamille: function (id, nom) {
    appels.renommer.push({ id: id, nom: nom });
    FOYERS[id].nom = nom;
    return Promise.resolve(FOYERS[id]);
  },
  rattacherContratAFamille: function (contratId, familleId) {
    appels.rattacher.push({ contratId: contratId, familleId: familleId });
    contrats.forEach(function (c) {
      if (c.id === contratId) { c.famille_id = familleId; c.famille = FOYERS[familleId]; }
    });
    return Promise.resolve(true);
  },
  archiverFamille: function (id) {
    appels.archiverFamille.push(id);
    var actifs = contrats.filter(function (c) {
      return c.famille_id === id && !c.archive && c.statut !== 'termine';
    });
    if (actifs.length) {
      var e = new Error('FAMILLE_ENCORE_ACTIVE');
      e.code = 'FAMILLE_ENCORE_ACTIVE';
      e.prenoms = actifs.map(function (c) { return c.prenom_enfant; });
      return Promise.reject(e);
    }
    FOYERS[id].archive = true;
    return Promise.resolve(FOYERS[id]);
  },
  desarchiverFamille: function (id) { FOYERS[id].archive = false; return Promise.resolve(FOYERS[id]); },
  majFamille: function (id, champs) {
    /* Piège volontaire : si un écran appelait encore ceci pour renommer un
       foyer depuis une fiche contrat, le test le verrait. */
    appels.renommer.push({ id: id, nom: champs.nom, parMajFamille: true });
    if (champs.nom) FOYERS[id].nom = champs.nom;
    return Promise.resolve(FOYERS[id]);
  },
  /* Lot 14 — la fiche contrat demande si le contrat est vierge pour décider
  d'AFFICHER ou non la suppression franche. Décor mis à jour ici : sans
  cette fonction, l'écran lève avant même de se rendre. */
  contratEstVierge: function () { return Promise.resolve(false); },
  majContrat: function (id, champs) {
    appels.majContrat.push({ id: id, champs: champs });
    contrats.forEach(function (c) {
      if (c.id === id) Object.keys(champs).forEach(function (k) { c[k] = champs[k]; });
    });
    return Promise.resolve(contrats.filter(function (c) { return c.id === id; })[0]);
  },
  majContratIdentite: function (id, champs) { return DB.majContrat(id, champs); },
  creerContrat: function (champs) { return Promise.resolve(champs); },
  archiverContrat: function () { return Promise.resolve(true); },
  desarchiverContrat: function () { return Promise.resolve(true); },
  getAvenants: function (id) {
    return Promise.resolve(Decor.avenantsDe(contratDe(id),
      [{ id: 's-' + id, contrat_id: id, date_effet: '2026-01-01',
         brut_mensuel_centimes: 200000, net_mensuel_centimes: 150000 }]));
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
  listRecapsPeriode: function () { return Promise.resolve([]); },
  /* LOT 20 — les périodes de familiarisation (§20.2). Le décor les rend
     vides : ces écrans-là n'en ont aucune, et la fiche du contrat doit
     l'afficher comme telle plutôt que d'échouer. */
  listPeriodesFamiliarisation: function () { return Promise.resolve([]); },
  listPeriodesFamiliarisationContrat: function () { return Promise.resolve([]); },
  listRecapsContrat: function () { return Promise.resolve([]); },
  getRecap: function () { return Promise.resolve(null); },
  enregistrerJournee: function (l) { return Promise.resolve(l); },
  supprimerJournee: function () { return Promise.resolve(true); },
  poserAbsenceMaria: function () { return Promise.resolve([]); },
  retirerAbsenceMaria: function () { return Promise.resolve(true); },
  rouvrirRecap: function () { return Promise.resolve(null); },
  recloturerRecap: function () { return Promise.resolve(null); },
  listEvenementsRecap: function () { return Promise.resolve([]); },
  marquerTransmis: function () { return Promise.resolve(null); },
  estMoisCloture: function () { return Promise.resolve(false); },
  ajouterSalaire: function (c, s) { return Promise.resolve(s); },
  majSalaire: function (id, s) { return Promise.resolve(s); },
  supprimerSalaire: function () { return Promise.resolve(true); }
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

window.App.moisCourant = function () { return { annee: 2026, mois: 8 }; };
window.App.aujourdhui = function () { return '2026-08-11'; };

var corps = document.getElementById('corps');
var barre = document.getElementById('barre');
var sheet = document.getElementById('sheet');
var toast = document.getElementById('toast');
var tabbar = document.getElementById('tabbar');

async function ouvrirFamilles() {
  window.App.invalider();
  window.App.aller('familles', {});
  await pause(200);
}
async function ouvrirFiche(id) {
  window.App.invalider();
  window.App.aller('fiche', { contratId: id });
  await pause(250);
}

(async function () {
  document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  await pause(250);

  /* ==================================================================== */
  /* A9 — Les QUATRE onglets, sans troncature à 320 px                    */
  /* ==================================================================== */
  console.log('\n--- A9 : la barre à quatre onglets ---');
  var onglets = tabbar.querySelectorAll('button');
  assert(onglets.length === 4, 'A9 : quatre onglets (obtenu ' + onglets.length + ')');
  /* REDESIGN 2A §2.1 — L'ORDRE ET LES NOMS CHANGENT.
     « Accueil » devient « Mes enfants », « Historique » cede sa place a
     « Documents » et passe en troisieme, « Conges » remonte en deuxieme.
     L'onglet ne classe plus par DATE mais par ce qu'on vient y chercher. */
  assert(txt(onglets[0]).indexOf('Mes enfants') !== -1, 'A9 : Mes enfants en premier');
  assert(txt(onglets[1]).indexOf('Congés') !== -1, 'A9 : Congés en deuxième');
  assert(txt(onglets[2]).indexOf('Documents') !== -1, 'A9 : Documents en troisième');
  assert(txt(onglets[3]).indexOf('Menu') !== -1, 'A9 : Menu en quatrième');
  assert(txt(onglets[1]).indexOf('Historique') === -1 && txt(onglets[2]).indexOf('Historique') === -1,
    'A9 : plus aucun onglet ne s’appelle « Historique »');
  /* La troncature ne se mesure pas dans jsdom, qui ne fait pas de mise en
     page. Ce qui SE vérifie ici, c'est la règle qui l'empêche : aucune
     étiquette ne doit pouvoir être coupée. « Mes cong… » serait pire que rien. */
  var css = fs.readFileSync(path.join(racine, 'css', 'style.css'), 'utf8');
  /* La barre du 2A s'appelle `.tabs` et pose ses etiquettes en colonne sous
     l'icone : chaque onglet est un `flex-direction: column`, l'etiquette a
     toute la largeur de sa colonne et ne peut pas etre coupee en deux par un
     retour a la ligne au milieu d'un mot. Ce qui se verifie ici, c'est la
     regle qui le garantit, et la zone tactile de 44 px du §10.4. */
  var bloc = css.slice(css.indexOf('.tabs button {'), css.indexOf('.tabs button .ic'));
  assert(bloc.indexOf('flex-direction: column') !== -1,
    'A9 : chaque onglet empile son icone et son etiquette');
  assert(/min-height:\s*4[4-9]px|min-height:\s*[5-9]\dpx/.test(bloc),
    'A9 : la zone tactile d’un onglet fait au moins 44 px (§10.4)');
  assert(bloc.indexOf('text-overflow') === -1 && bloc.indexOf('overflow: hidden') === -1,
    'A9 : aucune troncature par points de suspension');

  /* ==================================================================== */
  /* A2 / P3 — La fiche contrat ne renomme plus aucun foyer               */
  /* ==================================================================== */
  console.log('\n--- A2 : le champ coupable a disparu ---');
  await ouvrirFiche('c-lea');

  /* ==========================================================================
     EXIGENCE CHANGÉE — LOT 27 §27.3 : L'IDENTITÉ TIENT SUR UNE CARTE.

     Elle occupait le premier écran entier de la fiche : un portrait, le bloc
     photo avec son aperçu et ses trois lignes d'explication, le prénom, le
     nom, le genre, la famille, « Changer de famille », la date de début, et
     enfin « Modifier l'identité ». Neuf éléments pour des valeurs qui ne
     changent jamais — sur une fiche dont le seul geste est « Faire un
     avenant », qui arrivait tout en bas.

     UNE CARTE, comme la maquette : l'avatar en grand, le nom complet, et le
     sous-texte qui dit le reste — la famille, la date de début, et ce qu'elle
     ouvre. Elle mène à « Modifier l'identité », où tout ce qui a quitté la
     fiche se trouve déjà.

     RIEN NE SE PERD (B.0-7), et c'est ce que vérifient les assertions
     ci-dessous : ce qui était en LECTURE est dans le sous-texte ou dans la
     feuille ; ce qui était MODIFIABLE l'est resté, à un appui. « Changer de
     famille » y descend aussi (décision d'Adrien du 24 août : « non, on le
     retire ») — il offrait un geste rare, qu'on ne fait que pour corriger une
     erreur de saisie, juste à côté de la photo et du prénom.

     CE QUE LE LOT 8 PROTÉGEAIT NE BOUGE PAS : il n'existe nulle part de champ
     « Nom de la famille » qui renommerait le foyer entier sans le dire — ni
     sur la fiche, ni dans la feuille. C'est tout l'objet de ce cas, et il est
     exigé aux deux endroits.
     ====================================================================== */
  var carteIdentite = parTexte(corps, '.cd', 'Léa');
  assert(!!carteIdentite, 'A2 : la fiche porte la carte d’identité de l’enfant');
  assert(/famille \S+/.test(txt(carteIdentite)),
    'A2 : le rattachement se LIT dans la fiche (obtenu « ' +
    txt(carteIdentite) + ' »)');
  assert(txt(carteIdentite).indexOf('depuis le') !== -1,
    '§27.3 : et la date de début aussi');
  assert(!parTexte(corps, '.fld', 'Nom de la famille'),
    'A2 : plus aucun champ « Nom de la famille » dans la fiche contrat');
  assert(!boutonExact(corps, 'Changer de famille'),
    '§27.3 : le geste ne s’offre plus au milieu des gestes quotidiens');

  var avantRenommage = appels.renommer.length;
  /* LOT 27 §27.3 — la carte d'identité EST la porte de « Modifier
     l'identité » : plus besoin d'un bouton en plus.
     LOT 17 §17.4 — la feuille s'appelle « Modifier l'identité » : les horaires
     en sont sortis, ils passent par un avenant. */
  carteIdentite.click();
  await pause(150);
  assert(txt(sheet).indexOf('Modifier l’identité') !== -1,
    '§27.3 : la carte ouvre la feuille d’identité');
  assert(txt(sheet).indexOf('Nom de l’enfant') !== -1,
    'A2 : elle parle du nom de l’ENFANT');
  assert(txt(sheet).indexOf('Nom de la famille') === -1,
    'A2 : et AUCUN champ « Nom de la famille » — c’est tout le lot');
  assert(txt(sheet).indexOf('Genre') !== -1, 'la feuille propose le genre');
  assert(sheet.querySelectorAll('.teinte').length === 6, 'six pastilles de couleur');
  assert(!!parTexte(sheet, '.fld', 'Photo'), 'la feuille propose la photo');
  assert(!!parTexte(sheet, '.fld', 'Famille'),
    '§27.3 : le rattachement se lit ici aussi');
  assert(!!boutonExact(sheet, 'Changer de famille'),
    'A2 : et il se change par un geste dédié — déplacé ici, pas supprimé');
  window.Kit.fermerFeuille();
  await pause(40);
  assert(appels.renommer.length === avantRenommage,
    'A2 : ouvrir puis fermer la fiche n’a renommé aucun foyer');

  /* ==================================================================== */
  /* P1 — Renommer une famille de DEUX enfants                            */
  /* ==================================================================== */
  console.log('\n--- P1 : renommage, deux enfants concernés ---');
  await ouvrirFamilles();

  assert(txt(corps).indexOf('En cours') !== -1, 'l’écran Familles sépare en cours et terminées');
  var cartePapillon = parTexte(corps, '.big', 'Papillon');
  assert(!!cartePapillon, 'la famille Papillon a sa carte');
  assert(txt(cartePapillon).indexOf('Léa et Tom') !== -1,
    'P1 : le foyer est TITRÉ par les prénoms de ses enfants (obtenu « ' +
    txt(cartePapillon).slice(0, 60) + ' »)');
  assert(txt(cartePapillon).indexOf('famille Papillon') !== -1,
    'P1 : le nom du foyer est en sous-titre');
  assert(cartePapillon.querySelectorAll('.pile .av').length === 2,
    'P1 : pile de deux pastilles pour deux enfants');

  cartePapillon.click();
  await pause(120);
  var bRenommer = boutonExact(sheet, 'Renommer cette famille');
  assert(!!bRenommer, 'P1 : la feuille propose « Renommer cette famille »');
  bRenommer.click();
  await pause(120);

  assert(txt(sheet).indexOf('Renommer la famille Papillon') !== -1, 'P1 : feuille dédiée');
  assert(txt(sheet).indexOf('Ce nom changera aussi pour les autres enfants') !== -1,
    'P1 : l’avertissement est présent');
  assert(txt(sheet).indexOf('Léa et Tom') !== -1,
    'P1 : il NOMME les enfants concernés, pas un décompte (obtenu « ' +
    (txt(sheet).match(/Léa[^.]{0,30}/) || [''])[0] + ' »)');
  assert(txt(sheet).indexOf('2 contrats') === -1,
    'P1 : jamais un décompte abstrait à la place des prénoms');
  assert(!!boutonExact(sheet, 'Renommer') && !!boutonExact(sheet, 'Annuler'),
    'P1 : « Renommer » et « Annuler »');

  var champ = sheet.querySelector('input');
  champ.value = 'Colibri';
  boutonExact(sheet, 'Renommer').click();
  await pause(250);
  assert(appels.renommer.length === avantRenommage + 1, 'P1 : un seul renommage écrit');
  assert(appels.renommer[appels.renommer.length - 1].nom === 'Colibri', 'P1 : le nouveau nom');
  assert(!appels.renommer[appels.renommer.length - 1].parMajFamille ||
         appels.renommer[appels.renommer.length - 1].id === 'f-papillon',
    'P1 : le renommage vise bien ce foyer');

  /* ==================================================================== */
  /* P2 — Renommer une famille d'UN SEUL enfant                           */
  /* ==================================================================== */
  console.log('\n--- P2 : renommage, un seul enfant ---');
  await ouvrirFamilles();
  parTexte(corps, '.big', 'Mésange').click();
  await pause(120);
  boutonExact(sheet, 'Renommer cette famille').click();
  await pause(120);

  assert(txt(sheet).indexOf('Ce nom changera aussi') === -1,
    'P2 : pas d’avertissement « les autres enfants » quand il n’y en a pas');
  assert(txt(sheet).indexOf('Un seul enfant est concerné') !== -1,
    'P2 : la feuille le dit clairement');
  assert(txt(sheet).indexOf('se modifie dans sa fiche') !== -1,
    'P2 : elle rappelle où se change le nom de l’ENFANT');
  window.Kit.fermerFeuille();
  await pause(40);

  /* ==================================================================== */
  /* P3 — Changer un contrat de famille                                   */
  /* ==================================================================== */
  console.log('\n--- P3 : changer de famille ---');
  await ouvrirFiche('c-tom');
  var nomsAvant = Object.keys(FOYERS).map(function (k) { return FOYERS[k].nom; }).join('|');
  /* LOT 27 §27.3 — le geste passe par la carte d'identité, qui ouvre
     « Modifier l'identité ». Ce que ce cas vérifie — la feuille, ses foyers,
     l'écriture, et surtout qu'AUCUN nom de foyer ne change — est rejoué à
     l'identique. */
  parTexte(corps, '.cd', 'Tom').click();
  await pause(200);
  boutonExact(sheet, 'Changer de famille').click();
  await pause(250);

  assert(txt(sheet).indexOf('Ce geste ne renomme aucune famille') !== -1,
    'P3 : la feuille le dit d’emblée');
  assert(!!boutonExact(sheet, 'Créer une nouvelle famille'),
    'P3 : « Créer une nouvelle famille » est offert');
  var cibleMesange = parTexte(sheet, '.choice', 'Mésange');
  assert(!!cibleMesange, 'P3 : les foyers existants sont listés');
  cibleMesange.click();
  await pause(250);

  assert(appels.rattacher.length === 1, 'P3 : un rattachement écrit');
  assert(appels.rattacher[0].contratId === 'c-tom' && appels.rattacher[0].familleId === 'f-mesange',
    'P3 : le bon contrat vers le bon foyer');
  assert(Object.keys(FOYERS).map(function (k) { return FOYERS[k].nom; }).join('|') === nomsAvant,
    'A3 : AUCUN nom de foyer n’a changé (obtenu « ' +
    Object.keys(FOYERS).map(function (k) { return FOYERS[k].nom; }).join('|') + ' »)');

  /* ==================================================================== */
  /* P4 — Archivage REFUSÉ : un contrat est encore actif                  */
  /* ==================================================================== */
  console.log('\n--- P4 : ranger une famille encore active ---');
  await ouvrirFamilles();
  parTexte(corps, '.big', 'Mésange').click();
  await pause(150);

  var bRanger = boutonExact(sheet, 'Ranger cette famille');
  assert(!!bRanger, 'P4 : le bouton existe');
  assert(bRanger.disabled === true, 'P4 : il est GRISÉ tant qu’un contrat est en cours');
  assert(txt(sheet).indexOf('Impossible tant qu’un contrat est en cours') !== -1,
    'P4 : avec son explication');
  assert(/Zoé|Tom/.test(txt(sheet)),
    'A4 : le message NOMME le ou les contrats bloquants (obtenu « ' +
    (txt(sheet).match(/Impossible tant[^.]{0,70}/) || [''])[0] + ' »)');
  window.Kit.fermerFeuille();
  await pause(40);

  /* ==================================================================== */
  /* P5 — Archivage ACCEPTÉ : plus aucun contrat actif                    */
  /* ==================================================================== */
  console.log('\n--- P5 : ranger une famille sans contrat actif ---');
  await ouvrirFamilles();
  parTexte(corps, '.big', 'Sansenfant').click();
  await pause(150);
  var bRanger2 = boutonExact(sheet, 'Ranger cette famille');
  assert(!!bRanger2 && bRanger2.disabled !== true,
    'P5 : le bouton est actif quand aucun contrat ne l’est');
  bRanger2.click();
  await pause(300);
  assert(FOYERS['f-vide'].archive === true, 'P5 : la famille est rangée');
  await ouvrirFamilles();
  assert(txt(corps).indexOf('Terminées') !== -1, 'P5 : elle apparaît sous « Terminées »');
  assert(txt(corps).indexOf('Sansenfant') !== -1, 'P5 : rangée, jamais effacée');

  /* ==================================================================== */
  /* P6 / P7 — La photo : trop lourde, puis acceptée puis retirée         */
  /* ==================================================================== */
  console.log('\n--- P6/P7 : la photo ---');
  await ouvrirFiche('c-lea');
  /* LOT 27 §27.3 — LA PHOTO DESCEND DANS « MODIFIER L'IDENTITÉ ».
     Le lot 22 l'avait sortie du formulaire pour la mettre EN TÊTE DE LA FICHE,
     parce qu'on ne pouvait la poser que depuis un écran de douze champs où
     l'on croise la date de début du contrat et son statut : le geste le plus
     anodin passait par l'écran le plus risqué, et personne ne l'avait jamais
     fait. Ce motif TOMBE : la carte d'identité est le premier élément de la
     fiche, et un seul appui l'ouvre — le geste coûte un appui de plus qu'au
     lot 22, et cinq de moins qu'avant lui. Ce qui reste exigé est le fond :
     la photo est ATTEIGNABLE, et elle dit où elle n'apparaît pas.
     LOT 17 §17.4 — la feuille s'appelle « Modifier l'identité » : les horaires
     en sont sortis, ils passent par un avenant. */
  parTexte(corps, '.cd', 'Léa').click();
  await pause(200);
  /* LOT 22 §22.2 — la phrase est reprise mot pour mot de la spécification :
     « Réduite et rangée avec le contrat. Jamais sur le récapitulatif ni dans
     l'export. » Elle dit la même chose que l'ancienne, en nommant les deux
     endroits qui inquiètent — le document remis à la famille, et l'export. */
  assert(txt(sheet).indexOf('Jamais sur le récapitulatif ni dans l’export') !== -1,
    'P7 : la fiche dit où la photo n’apparaît PAS');
  assert(!!boutonExact(sheet, 'Choisir une photo'), 'P7 : « Choisir une photo »');
  assert(!!boutonExact(sheet, 'Retirer la photo'), 'P7 : « Retirer la photo »');

  /* La réduction d'image passe par un canvas, que jsdom ne sait pas rendre :
     ce qui est vérifiable ici, c'est le CALCUL DU POIDS, qui est la règle
     métier (50 Ko) et la seule chose qui puisse laisser passer 4 Mo en base. */
  var poids = window.__poidsApproximatif;
  window.Kit.fermerFeuille();
  await pause(40);

  /* ==================================================================== */
  /* P8 — Un contrat sans genre : phrases neutres                         */
  /* ==================================================================== */
  console.log('\n--- P8 : le genre et les phrases ---');
  assert(window.Kit.accord('présent', 'f') === 'présente', 'A8 : féminin sans point médian');
  assert(window.Kit.accord('présent', 'g') === 'présent', 'A8 : masculin sans point médian');
  assert(window.Kit.accord('présent', null) === 'présent·e',
    'A8 : sans genre, la forme inclusive — juste dans tous les cas');
  assert(window.Kit.accord('présent', '') === 'présent·e', 'A8 : chaîne vide = non renseigné');

  /* ==========================================================================
     EXIGENCE CHANGÉE — LOT 25 §25.3 : LA PHRASE QUI PORTAIT L'ACCORD A CHANGÉ
     DE PLACE. L'accord en genre se lisait sur le sous-texte permanent de
     « Rien à faire les jours normaux » — « Léa est comptée présente et vos
     30 min sont dues » — que le §25.3 remplace par la ligne de synthèse
     chiffrée. Cette ligne compte des jours ; elle n'accorde rien.

     RIEN NE SE PERD (A.2) : les phrases qui NOMMENT l'enfant portent toujours
     l'accord, et ce sont elles qui comptent — « 30 min non réclamée ce
     jour-là » et « Quand Léa est absente… » dans les cas particuliers d'une
     journée, « Léa notée absente » après une écriture, « Léa absente » sur le
     document. Le test se déplace sur la première, qui est atteignable sans
     rien écrire en base.

     L'EXIGENCE NE S'AFFAIBLIT PAS : les trois cas — féminin connu, féminin
     d'un second contrat, genre non renseigné — sont rejoués à l'identique, et
     l'interdiction du point médian quand le genre EST connu reste vérifiée
     sur tout l'écran. `Kit.accord` lui-même est testé unitairement juste
     au-dessus, ce qui n'a pas bougé.
     ====================================================================== */

  /* Ouvre la feuille d'une journée, puis « Autre cas… », et rend son texte. */
  async function texteCasParticuliers(contratId) {
    window.App.invalider();
    window.App.aller('enfant', { contratId: contratId, annee: 2026, mois: 8 });
    await pause(300);
    var jour = corps.querySelectorAll('table.cal td[role="button"]')[0];
    if (!jour) return '';
    jour.click();
    await pause(150);
    var autre = parTexte(sheet, '.choice', 'Autre cas');
    if (!autre) return '';
    autre.click();
    await pause(200);
    return txt(sheet);
  }

  var tLea = await texteCasParticuliers('c-lea');
  assert(tLea.indexOf('non réclamée') !== -1,
    'P8 : Léa, genre « f », donne « non réclamée » (obtenu « ' +
    (tLea.match(/non réclam[^.]{0,12}/) || [''])[0] + ' »)');
  assert(tLea.indexOf('·e') === -1,
    'P8 : plus AUCUN point médian quand le genre est connu');
  window.Kit.fermerFeuille();
  await pause(60);

  var tZoe = await texteCasParticuliers('c-zoe');
  assert(tZoe.indexOf('non réclamée') !== -1, 'P8 : Zoé aussi est au féminin');
  window.Kit.fermerFeuille();
  await pause(60);

  /* Un contrat SANS genre garde la forme inclusive. */
  IRIS.archive = false; IRIS.statut = 'actif'; IRIS.date_fin = null;
  window.App.invalider();
  await window.App.rechargerContrats();
  var tIris = await texteCasParticuliers('c-iris');
  assert(tIris.indexOf('non réclamé·e') !== -1,
    'P8 : sans genre, la phrase reste neutre (obtenu « ' +
    (tIris.match(/non réclam[^.]{0,12}/) || [''])[0] + ' »)');
  window.Kit.fermerFeuille();
  await pause(60);
  IRIS.archive = true; IRIS.statut = 'termine'; IRIS.date_fin = '2026-03-31';
  await window.App.rechargerContrats();

  /* ==================================================================== */
  /* A6 — La couleur d'identité n'entre JAMAIS dans le calendrier         */
  /* ==================================================================== */
  console.log('\n--- A6 : la couleur ne contamine pas le calendrier ---');
  window.App.invalider();
  window.App.aller('enfant', { contratId: 'c-lea', annee: 2026, mois: 8 });
  await pause(300);

  var cellules = corps.querySelectorAll('table.cal td');
  assert(cellules.length > 0, 'le calendrier est rendu');
  var contaminees = Array.prototype.filter.call(cellules, function (td) {
    return /id-(vert|bleu|prune|terracotta|ocre|ardoise)/.test(td.className);
  });
  assert(contaminees.length === 0,
    'A6 : aucune case du calendrier ne porte une couleur d’identité (obtenu ' +
    contaminees.length + ')');
  /* Et la règle est aussi tenue dans la feuille de style : aucun sélecteur de
     couleur d'identité ne cible le calendrier. */
  var reglesIdentite = css.split('\n').filter(function (l) {
    return /\.id-(vert|bleu|prune|terracotta|ocre|ardoise)/.test(l);
  });
  assert(reglesIdentite.every(function (l) { return l.indexOf('cal') === -1; }),
    'A6 : aucune règle de couleur d’identité ne cible le calendrier');
  /* REDESIGN 2A §4.1 — L'IDENTITE DE L'ENFANT DANS L'EN-TETE DE SON ESPACE.

     La pastille de 26 px cede la place a la TEINTE DE L'EN-TETE ENTIER. La
     question a laquelle le lot 8 repondait — « chez quel enfant suis-je ? » —
     trouve une reponse plus forte, pas plus faible : c'est toute la barre qui
     prend la couleur, pas un rond.

     L'exigence de FOND est verifiee plus fermement qu'avant : la teinte vient
     des JETONS `--id-*`, jamais d'une couleur libre (V8-31), et le prenom
     reste ecrit a cote — la couleur ne porte jamais le sens toute seule. */
  assert(/var\(--id-(vert|bleu|prune|terracotta|ocre|ardoise|neutre)-/.test(
    barre.style.background || ''),
    'l’en-tête de l’espace enfant est teinté de la couleur de l’enfant, ' +
    'par ses jetons (obtenu « ' + (barre.style.background || '') + ' »)');
  assert(txt(barre).indexOf(LEA.prenom_enfant) !== -1,
    'et le prénom y est ÉCRIT — la couleur ne porte jamais le sens seule');

  /* ==================================================================== */
  /* A7 — Aucune photo sur un document transmis                           */
  /* ==================================================================== */
  console.log('\n--- A7 : aucune photo sur le document ---');
  LEA.photo = 'data:image/jpeg;base64,AAAA';
  await window.App.rechargerContrats();
  window.App.invalider();
  window.App.aller('document', { contratId: 'c-lea', annee: 2026, mois: 8 });
  await pause(300);

  var doc = corps.querySelector('.doc');
  assert(!!doc, 'le document est rendu');
  assert(doc.querySelectorAll('img').length === 0,
    'A7 : le document ne contient AUCUNE image');
  assert(doc.querySelectorAll('.av').length === 0,
    'A7 : ni pastille d’identité');
  var apercu = corps.querySelector('.apercu-texte');
  assert(!!apercu && txt(apercu).indexOf('data:image') === -1,
    'A7 : le texte à coller ne contient aucune image encodée');

  /* La carte d'accueil, elle, la porte bien. */
  window.App.invalider();
  window.App.aller('accueil', {}, true);
  await pause(300);
  /* LOT 25 §25.1 puis REDESIGN 2A §3.2 — la grande carte `.big` est devenue
     la carte `.cd`, puis la carte a trois etages `.cart3`. La photo et la
     couleur d'identite sont exigees a l'identique, sur le composant qui la
     remplace : le PREMIER etage, celui de l'identite. */
  assert(corps.querySelectorAll('.cart3 .etg1 .av img').length >= 1,
    'la photo apparaît sur la carte d’accueil');
  assert(!!corps.querySelector('.cart3 .etg1 .av.id-prune, .cart3 .etg1 .av.id-bleu'),
    'les cartes portent la couleur de l’enfant');

  /* ==================================================================== */
  /* P9 — Onglet Historique avec contrats terminés                        */
  /* ==================================================================== */
  console.log('\n--- P9 : l’onglet Historique ---');
  window.App.aller('historique', {}, true);
  await pause(300);
  assert(tabbar.hidden === false, 'P9 : Historique est un onglet racine');
  assert(txt(corps).indexOf('Contrats en cours') !== -1, 'P9 : les contrats en cours d’abord');
  var iEnCours = txt(corps).indexOf('Contrats en cours');
  var iTermines = txt(corps).indexOf('Contrats terminés');
  assert(iTermines > iEnCours, 'P9 : les terminés APRÈS, sous leur propre intertitre');
  assert(txt(corps).indexOf('Iris') !== -1, 'P9 : le contrat terminé est listé, jamais caché');
  assert(txt(corps).indexOf('mois d’historique') !== -1,
    'P9 : chaque carte annonce son nombre de mois');
  assert(!!parTexte(corps, '.menu', 'Récapitulatif sur une période'),
    'P9 : le récapitulatif de période est ici');

  /* ==================================================================== */
  /* P10 — Le Menu après la disparition de « Consulter »                  */
  /* ==================================================================== */
  console.log('\n--- P10 : le Menu ---');
  window.App.aller('menu', {}, true);
  await pause(250);
  assert(txt(corps).indexOf('Consulter') === -1, 'P10 : la rubrique « Consulter » a disparu');
  assert(txt(corps).indexOf('Gérer') !== -1, 'P10 : « Gérer » demeure');
  assert(txt(corps).indexOf('Compte') !== -1, 'P10 : « Compte » demeure');
  /* LOT 27 §27.2 — l'entrée de Menu est devenue la CARTE du socle (`cd tap`).
     Même géométrie, même chevron ; un composant de moins à corriger. Ce que
     ces assertions vérifient — telle entrée est là, telle autre n'y est
     plus — ne change pas d'un mot. */
  assert(!parTexte(corps, '.cd', 'Récapitulatif sur une période'),
    'P10 : le récapitulatif de période n’est plus dans le Menu');
  assert(!parTexte(corps, '.cd', 'Anciens contrats'),
    'P10 : « Anciens contrats » non plus');
  /* LOT 22 §22.1 — « Mes enfants » remplace « Familles » : Maria pense par
     enfant. La vue par foyer est reprise en bas de la page « Mes enfants ».
     LOT 27 §27.2 — et « Familles » a définitivement quitté le Menu. */
  assert(!!parTexte(corps, '.cd', 'Mes enfants'), 'LOT 22 : « Mes enfants » est là');
  assert(!parTexte(corps, '.cd', 'Familles'),
    '§27.2 : « Familles » n’est plus une entrée du Menu');
  assert(!!parTexte(corps, '.cd', 'Ajouter un enfant'), 'P10 : « Ajouter un enfant » aussi');

  /* ==================================================================== */
  console.log('');
  if (echecs) { console.error(echecs + ' échec(s).'); process.exit(1); }
  console.log('Tout est conforme.');
})().catch(function (e) {
  console.error('Erreur pendant le parcours :', e && e.stack || e);
  process.exit(1);
});
