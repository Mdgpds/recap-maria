/* ============================================================================
   Test de fumée — lot 12 : notes et flexibilité de la journée.
   Cas P1 à P9 de la spécification.

   POURQUOI CE FICHIER EXISTE.

   Ce lot met en place deux choses qui se ressemblent et n'ont pas du tout le
   même destinataire.

   LA NOTE est pour Maria seule. Si elle atteignait un document remis à une
   famille, le dégât serait immédiat et irréparable : « les parents sont encore
   arrivés en retard » n'est pas une phrase qu'on récupère. La migration 009
   garantit qu'elle n'entre dans aucun instantané ; ce fichier vérifie qu'aucun
   chemin d'écran ne l'y amène non plus.

   LE RENONCEMENT, lui, est pour la famille — décision d'Adrien du 10 août : le
   parent voit que Maria a renoncé à des heures qui lui étaient dues. Et la
   FORMULATION compte autant que le chiffre. « Dont 1 h 30 auxquelles j'ai
   choisi de renoncer ce mois-ci » énonce un geste assumé ; « non facturées »,
   « offertes » ou « dues » énonceraient une créance en attente — c'est-à-dire
   une dette que le parent pourrait croire devoir régler, ou une faveur à
   rappeler. Ce document existe pour éteindre les désaccords, pas pour en
   ouvrir un nouveau.

   Lancement : node test/lot12-notes.smoke.js
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

/* --- Décor. Valeurs FICTIVES et rondes : le dépôt est public. ----------- */
function contrat(id, prenom, minutesSup) {
  return {
    id: id, prenom_enfant: prenom, famille_id: 'f-' + id,
    famille: { id: 'f-' + id, nom: 'Foyer-' + prenom }, date_debut: '2026-01-01', date_fin: null,
    minutes_contractuelles: 540, minutes_sup_jour: minutesSup, minutes_par_jour_conge: 540,
    entretien_centimes_jour: 500, jours_planning: [1, 2, 3, 4, 5],
    heure_arrivee: '08:30:00', heure_depart: '18:00:00', statut: 'actif',
    sup_dues_si_enfant_absent: true, ordre_imputation: 'cp_puis_sup', archive: false,
    nom: null, genre: 'f', couleur: null, photo: null, modele_id: null
  };
}
var LEA = contrat('c-lea', 'Léa', 30);
/* P9 — un contrat à 45 minutes : aucune valeur ne doit être écrite en dur. */
var ZOE = contrat('c-zoe', 'Zoé', 45);

var scene = {
  contrats: [LEA, ZOE],
  journees: {},              // contratId -> { 'YYYY-MM-DD': ligne }
  notes: {},                 // 'contratId|annee-mois' -> note
  recaps: {},
  moisCourant: { annee: 2026, mois: 7 },
  aujourdhui: '2026-07-31',
  noteCassee: false
};
var appels = { note: [], journee: [], recloturer: [] };

function cleN(id, a, m) { return id + '|' + a + '-' + m; }


/* LOT 17 §17.2 — le contrat par son identifiant. `getAvenants` en a besoin
   pour reprendre les réglages du décor dans l'avenant : le moteur ne les lit
   plus sur `contrat`. */
function contratDe(id) {
  var liste = scene.contrats || [];
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
  listContratsActifs: function () { return Promise.resolve(scene.contrats); },
  listContratsTous: function () { return Promise.resolve(scene.contrats); },
  listContratsPourMois: function () { return Promise.resolve(scene.contrats); },
  listContratsPourPeriode: function () { return Promise.resolve(scene.contrats); },
  listFamilles: function () { return Promise.resolve([]); },
  listFamillesToutes: function () { return Promise.resolve([]); },
  listFamillesAvecContrats: function () { return Promise.resolve([]); },
  listModeles: function () { return Promise.resolve([]); },
  modeleEnVigueur: function () { return Promise.resolve(null); },
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
  getJourneesMois: function (id) { return Promise.resolve(scene.journees[id] || {}); },
  /* La CHAÎNE des mois lit les journées par PÉRIODE, groupées par mois — pas
     par `getJourneesMois`. Une simulation qui rend {} ici laisse le moteur
     aveugle : c'est ce qui a fait échouer P7 au premier passage, et le défaut
     était dans le décor, pas dans le code. */
  getJourneesPeriode: function (id) {
    var parMois = {};
    Object.keys(scene.journees[id] || {}).forEach(function (d) {
      var cle = d.slice(0, 7);
      if (!parMois[cle]) parMois[cle] = {};
      parMois[cle][d] = scene.journees[id][d];
    });
    return Promise.resolve(parMois);
  },
  listImputations: function () { return Promise.resolve([]); },
  listImputationsPourMois: function () { return Promise.resolve([]); },
  enregistrerImputation: function (i) { return Promise.resolve(i); },
  supprimerImputation: function () { return Promise.resolve(true); },
  getNoteMensuelle: function (id, a, m) {
    return Promise.resolve(scene.notes[cleN(id, a, m)] || null);
  },
  enregistrerNoteMensuelle: function (id, a, m, texte) {
    if (scene.noteCassee) return Promise.reject(new Error('Failed to fetch'));
    appels.note.push({ contratId: id, annee: a, mois: m, texte: texte });
    var n = { id: 'n1', contrat_id: id, annee: a, mois: m, texte: texte,
      maj_le: '2026-07-31T18:42:00Z' };
    scene.notes[cleN(id, a, m)] = n;
    return Promise.resolve(n);
  },
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
  getRecap: function (id, a, m) { return Promise.resolve(scene.recaps[cleN(id, a, m)] || null); },
  enregistrerJournee: function (l) {
    appels.journee.push(l);
    if (!scene.journees[l.contrat_id]) scene.journees[l.contrat_id] = {};
    scene.journees[l.contrat_id][l.jour] = l;
    return Promise.resolve(l);
  },
  supprimerJournee: function (id, d) {
    if (scene.journees[id]) delete scene.journees[id][d];
    return Promise.resolve(true);
  },
  poserAbsenceMaria: function () { return Promise.resolve([]); },
  retirerAbsenceMaria: function () { return Promise.resolve(true); },
  rouvrirRecap: function () { return Promise.resolve(null); },
  recloturerRecap: function (id, a, m, donnees) {
    appels.recloturer.push({ contratId: id, annee: a, mois: m, donnees: donnees });
    scene.recaps[cleN(id, a, m)] = { id: 'r1', contrat_id: id, annee: a, mois: m,
      statut: 'fige', donnees: donnees, fige_le: '2026-07-31T18:00:00Z', transmis_le: null };
    return Promise.resolve(scene.recaps[cleN(id, a, m)]);
  },
  listEvenementsRecap: function () { return Promise.resolve([]); },
  marquerTransmis: function () { return Promise.resolve(null); },
  estMoisCloture: function (id, a, m) { return Promise.resolve(!!scene.recaps[cleN(id, a, m)]); },
  /* Lot 14 — la fiche contrat demande si le contrat est vierge pour décider
  d'AFFICHER ou non la suppression franche. Décor mis à jour ici : sans
  cette fonction, l'écran lève avant même de se rendre. */
  contratEstVierge: function () { return Promise.resolve(false); },
  majContrat: function (id, c) { return Promise.resolve(c); },
  majContratIdentite: function (id, c) { return Promise.resolve(c); },
  creerFamille: function (f) { return Promise.resolve(f); },
  majFamille: function (id, f) { return Promise.resolve(f); },
  rattacherContratAFamille: function () { return Promise.resolve(true); },
  renommerFamille: function () { return Promise.resolve(true); },
  archiverFamille: function () { return Promise.resolve(true); },
  desarchiverFamille: function () { return Promise.resolve(true); },
  ajouterSalaire: function (id, s) { return Promise.resolve(s); },
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

window.App.moisCourant = function () { return scene.moisCourant; };
window.App.aujourdhui = function () { return scene.aujourdhui; };

var corps = document.getElementById('corps');
var sheet = document.getElementById('sheet');

async function ouvrirEnfant(id, a, m) {
  window.App.invalider();
  window.App.aller('enfant', { contratId: id || 'c-lea', annee: a || 2026, mois: m || 7 });
  await pause(350);
}
async function ouvrirJour(numero) {
  var td = Array.prototype.filter.call(
    corps.querySelectorAll('table.cal td[role="button"]'), function (x) {
      return txt(x.querySelector('.num')) === String(numero);
    })[0];
  if (!td) return null;
  td.click();
  await pause(150);
  return td;
}
function zoneNote() { return corps.querySelector('textarea.note-mois'); }
/* FEUILLE DU JOUR REFAITE (23 août) — L'AJUSTEMENT MANUEL DES HEURES A
   DÉMÉNAGÉ. Il n'est plus un `<details>` permanent de la feuille du jour : il
   se range dans « Autre cas… », comme le demande le brief. Il n'est pas
   supprimé — c'est tout l'objet de cette aide, qui va le chercher là où il
   vit maintenant. */
async function ouvrirAutresCas() {
  var b = parTexte(sheet, 'button', 'Autre cas');
  if (!b) return null;
  b.click();
  await pause(150);
  return b;
}
/* Le choix d'une liste, désigné par son libellé. */
function choixParLibelle(morceau) {
  return parTexte(sheet, '.choice', morceau);
}

(async function () {
  document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  await pause(300);

  /* ==================================================================== */
  /* P1 — La note du mois, écrite puis le mois clôturé                    */
  /* A1 — elle n'apparaît sur aucun document                              */
  /* A2 — elle reste modifiable après clôture                             */
  /* ==================================================================== */
  console.log('\n--- P1 : la note du mois ---');
  await ouvrirEnfant();

  /* ==========================================================================
     EXIGENCE CHANGÉE — LOT 25 §25.3 : LE PANNEAU DE NOTE DEVIENT UN REPLI.
     Les cinq `.pane` de l'espace enfant deviennent quatre `.fold` (composant
     du socle, lot 24). Trois conséquences pour ce fichier, et pourquoi :

     - le TITRE raccourcit : « Mes notes sur ce mois » -> « Mes notes ». La
       barre haute dit déjà l'enfant et le mois ; « sur ce mois » répétait.
     - la mention « Pour vous seule — jamais sur le document remis à la
       famille » quitte le corps du panneau pour devenir LE PLACEHOLDER du
       champ. Elle est désormais à l'endroit exact où Maria écrit, au moment
       où elle écrit — c'est A1, dit plus près du geste, pas dit moins fort.
       Le mot « jamais » remplace « n'apparaît pas » : plus court, plus net.
     - « la note AVANT les réserves » (V8-17) : l'ordre des spécifications du
       lot 25 est « Le mois, Réserves, Mes notes, Depuis le début ». Le motif
       de V8-17 — « la chercher sous trois panneaux de chiffres revient à ne
       pas l'écrire » — tombe avec les replis : les quatre têtes tiennent sur
       un écran, « Mes notes » est visible sans rien dérouler. CE QUI RESTE
       EXIGÉ, et c'est le fond : la note ne se mérite pas.

     AUCUNE ASSERTION DE COMPORTEMENT N'EST AFFAIBLIE : l'enregistrement à la
     sortie du champ, l'absence d'écriture inutile, la note modifiable après
     clôture, son absence de tout document, et le comportement en échec sont
     tous rejoués à l'identique par la suite de ce fichier.
     ====================================================================== */
  var pNote = parTexte(corps, '.fold', 'Mes notes');
  assert(!!pNote, 'P1 : le repli de note est présent');
  assert(!!zoneNote(), 'P1 : la zone de texte est là');
  assert(zoneNote().getAttribute('placeholder').indexOf('Pour vous seule') !== -1,
    'P1 : il dit à qui la note est destinée');
  assert(zoneNote().getAttribute('placeholder')
           .indexOf('jamais sur le document remis à la famille') !== -1,
    'A1 : et à qui elle NE l’est pas');

  var replis = corps.querySelectorAll('.fold');
  var iNote = Array.prototype.indexOf.call(replis, pNote);
  assert(iNote >= 0 && iNote <= 2,
    'V8-17 : la tête « Mes notes » reste dans le premier écran, sans qu’il ' +
    'faille dérouler un autre repli (rang ' + iNote + ')');

  var z = zoneNote();
  z.value = 'Les parents sont arrivés en retard le 6.';
  z.dispatchEvent(new dom.window.Event('blur'));
  await pause(200);

  assert(appels.note.length === 1, 'P1 : la note est enregistrée à la sortie du champ');
  assert(appels.note[0].texte.indexOf('en retard') !== -1, 'P1 : avec son texte');
  assert(txt(pNote).indexOf('Note enregistrée') !== -1,
    'P1 : la confirmation est discrète mais présente');

  /* Réécrire la MÊME valeur ne redéclenche rien : une note s'écrit en
     plusieurs fois, on ne va pas au réseau pour rien. */
  z.dispatchEvent(new dom.window.Event('blur'));
  await pause(150);
  assert(appels.note.length === 1, 'P1 : aucune écriture inutile si rien n’a changé');

  /* --- On clôture le mois --- */
  window.App.invalider();
  window.App.aller('document', { contratId: 'c-lea', annee: 2026, mois: 7 });
  await pause(300);

  /* A1 — LE CONTRÔLE LE PLUS IMPORTANT DU LOT. */
  var doc = corps.querySelector('.doc');
  assert(!!doc, 'le document est rendu');
  assert(txt(doc).indexOf('en retard') === -1,
    'A1 : la note N’APPARAÎT PAS sur le document — « les parents sont arrivés ' +
    'en retard » n’est pas une phrase qu’on récupère');
  var apercu = corps.querySelector('.apercu-texte');
  assert(!!apercu && txt(apercu).indexOf('en retard') === -1,
    'A1 : ni dans le texte à coller');

  var bCloture = boutonExact(corps, 'Clôturer le mois');
  if (bCloture) {
    bCloture.click();
    await pause(150);
    var bConf = boutonExact(sheet, 'Clôturer quand même') || boutonExact(sheet, 'Oui, clôturer le mois');
    if (bConf) { bConf.click(); await pause(300); }
  }
  assert(appels.recloturer.length === 1, 'P1 : le mois est clôturé');
  var instantane = appels.recloturer[0].donnees;
  assert(JSON.stringify(instantane).indexOf('en retard') === -1,
    'A1 (risque n° 1) : la note n’entre PAS dans l’instantané du récapitulatif — ' +
    'sinon elle serait figée ET transmissible');

  /* A2 — modifiable après clôture. */
  await ouvrirEnfant();
  var pNote2 = parTexte(corps, '.fold', 'Mes notes');
  assert(!!pNote2, 'A2 : le panneau de note est toujours là sur un mois clôturé');
  assert(!!zoneNote() && zoneNote().disabled !== true,
    'A2 : la note reste MODIFIABLE après clôture — un mois clôturé fige des ' +
    'montants, pas des souvenirs');
  assert(txt(pNote2).indexOf('elle ne fait pas partie des chiffres') !== -1,
    'A2 : et l’écran explique pourquoi');

  var z2 = zoneNote();
  z2.value = 'Texte modifié APRÈS la clôture.';
  z2.dispatchEvent(new dom.window.Event('blur'));
  await pause(200);
  assert(appels.note.length === 2, 'A2 : et l’écriture passe');

  /* ==================================================================== */
  /* P2 — La note d'une journée, et son repère au calendrier              */
  /* A3 — un repère NON CHROMATIQUE                                       */
  /* ==================================================================== */
  console.log('\n--- P2 : la note d’une journée ---');
  scene.recaps = {};
  await ouvrirEnfant();
  await ouvrirJour(6);

  /* EXIGENCE CHANGÉE (brief du 23 août) — le `<details>` « Un mot sur cette
     journée ? » n'existe plus : la note est le CINQUIÈME CHOIX de la liste
     unique, au même style que les autres. Le comportement, lui, ne bouge pas :
     le champ, la phrase qui dit à qui la note appartient, et l'écriture. */
  assert(!parTexte(sheet, 'details', 'Un mot sur cette journée'),
    'P2 : l’ancien volet repliable a disparu — la note est un choix de la liste');
  var choixNote = choixParLibelle('Une note sur la journée');
  assert(!!choixNote, 'P2 : la feuille propose une note de journée, dans la liste');
  choixNote.click();
  await pause(120);
  assert(txt(sheet).indexOf('pour vous seule') !== -1 || txt(sheet).indexOf('Pour vous seule') !== -1,
    'P2 : facultative, et pour Maria seule');
  assert(txt(sheet).indexOf('Jamais sur le document remis à la famille') !== -1,
    'P2 : et jamais sur le document remis à la famille');

  var champNote = parTexte(sheet, '.fld', 'Note');
  assert(!!champNote, 'P2 : le champ est là');
  var inputNote = champNote.querySelector('input');
  inputNote.value = 'Sortie au parc';
  inputNote.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await pause(60);
  boutonExact(sheet, 'Enregistrer').click();
  await pause(350);

  var ecrite = appels.journee.filter(function (j) { return j.commentaire === 'Sortie au parc'; })[0];
  assert(!!ecrite, 'P2 : la note est écrite sur la journée');
  assert(ecrite.jour === '2026-07-06', 'P2 : sur le bon jour');

  await ouvrirEnfant();
  var cellule6 = Array.prototype.filter.call(corps.querySelectorAll('table.cal td'), function (x) {
    return txt(x.querySelector('.num')) === '6';
  })[0];
  assert(!!cellule6.querySelector('.rp.note'),
    'A3 : la journée annotée porte un repère dans le calendrier');
  /* A3 — le repère est une FORME, pas une couleur. Le calendrier code déjà
     quatre états par la couleur ; une cinquième teinte n'y serait plus
     lisible. */
  assert(txt(cellule6.querySelector('.rp.note')).length > 0,
    'A3 : et ce repère est un CARACTÈRE — une forme, jamais une couleur seule');
  assert((cellule6.getAttribute('aria-description') || '').indexOf('annotée') !== -1,
    'A3 : il est aussi annoncé aux lecteurs d’écran');
  /* EXIGENCE CHANGÉE — LOT 25 §25.3 : LA LÉGENDE DE SEPT ENTRÉES DISPARAÎT,
     remplacée par la ligne de synthèse chiffrée. L'ancienne assertion
     vérifiait que le mot « Note » figurait dans cette légende.

     RIEN NE SE PERD (A.2) : le repère `•` est nommé aux DEUX endroits où on
     le lit vraiment — dans la description de la cellule pour un lecteur
     d'écran (assertion juste au-dessus, inchangée), et dans la FEUILLE DU
     JOUR, qui affiche la note elle-même dès qu'on touche la journée. Une
     légende en bas d'écran demandait à Maria de mémoriser une correspondance ;
     l'appui la lui donne.

     L'ASSERTION SE RENFORCE : au lieu de chercher un mot dans une légende, on
     ouvre la journée annotée et on exige que LA NOTE soit là. */
  cellule6.click();
  await pause(200);
  var choixNote = parTexte(sheet, '.choice', 'Une note sur la journée');
  assert(!!choixNote, 'A3 : la journée touchée offre le choix « Une note sur la journée »');
  choixNote.click();
  await pause(200);
  var valeursSaisies = Array.prototype.map.call(
    sheet.querySelectorAll('input, textarea'), function (e) { return e.value; }).join(' | ');
  assert(valeursSaisies.indexOf('Sortie au parc') !== -1,
    'A3 : et la note DE CETTE JOURNÉE y est, en toutes lettres (obtenu « ' +
    valeursSaisies + ' »)');
  window.Kit.fermerFeuille();
  await pause(80);

  /* ==================================================================== */
  /* P3 — Heures ajoutées                                                 */
  /* A6 — les valeurs viennent du contrat                                 */
  /* ==================================================================== */
  console.log('\n--- P3 : ajouter des heures ---');
  await ouvrirEnfant();
  await ouvrirJour(7);

  /* EXIGENCE CHANGÉE (brief du 23 août) — l'ajustement manuel n'est plus un
     volet permanent de la feuille du jour : il se range dans « Autre cas… ».
     Il n'est PAS supprimé, et ses trois gestes ne changent pas. */
  assert(!parTexte(sheet, 'details', 'Ajuster mes heures'),
    'P3 : la feuille du jour ne porte plus le volet d’ajustement');
  await ouvrirAutresCas();
  assert(txt(sheet).indexOf('Ajuster mes heures ce jour-là') !== -1,
    'P3 : la section d’ajustement est proposée dans « Autre cas… »');
  assert(txt(sheet).indexOf('que la déclaration d’horaire ne couvre pas') !== -1,
    'P3 : et la phrase dit quand s’en servir');
  var det = parTexte(sheet, 'details', 'Ajuster mes heures');
  assert(!!det && det.open === false,
    'P3 : repliée par défaut — une journée ordinaire n’est pas un formulaire');
  det.open = true;
  await pause(60);

  assert(sansInsecable(txt(sheet)).indexOf('Au-delà des 30 min prévues au contrat') !== -1,
    'A6 : la valeur vient du CONTRAT (obtenu « ' +
    (sansInsecable(txt(sheet)).match(/Au-delà des [^.]{0,20}/) || [''])[0] + ' »)');

  var compteurAjout = parTexte(sheet, '.compteur-jours', 'Heures supplémentaires en plus');
  assert(!!compteurAjout, 'P3 : le compteur est là');
  var plus = Array.prototype.filter.call(compteurAjout.querySelectorAll('.pas'), function (b) {
    return b.textContent === '+';
  })[0];
  plus.click(); plus.click(); plus.click();      // 3 × 15 min = 45 min
  await pause(60);
  assert(sansInsecable(txt(compteurAjout.querySelector('.val'))) === '45 min',
    'P3 : le pas est de 15 minutes (obtenu ' + txt(compteurAjout.querySelector('.val')) + ')');
  assert(sansInsecable(txt(sheet)).indexOf('Ce jour : 1h15') !== -1,
    'P3 : l’effet est affiché immédiatement — 30 min + 45 min (obtenu « ' +
    (sansInsecable(txt(sheet)).match(/Ce jour : [^.]{0,24}/) || [''])[0] + ' »)');
  assert(sansInsecable(txt(sheet)).indexOf('au lieu de 30 min') !== -1,
    'P3 : et comparé à ce que le contrat prévoit');

  var avantJ = appels.journee.length;
  boutonExact(sheet, 'Enregistrer cet ajustement').click();
  await pause(350);
  var ajout = appels.journee[appels.journee.length - 1];
  assert(appels.journee.length === avantJ + 1, 'P3 : une écriture');
  assert(ajout.minutes_sup_exceptionnelles === 45,
    'P3 : 45 minutes ajoutées enregistrées (obtenu ' + ajout.minutes_sup_exceptionnelles + ')');
  assert(ajout.minutes_sup_renoncees === 0, 'P3 : aucun renoncement');

  await ouvrirEnfant();
  var cellule7 = Array.prototype.filter.call(corps.querySelectorAll('table.cal td'), function (x) {
    return txt(x.querySelector('.num')) === '7';
  })[0];
  assert(!!cellule7.querySelector('.rp.heures'),
    'A3 : une journée aux heures ajustées porte son propre repère');

  /* ==================================================================== */
  /* P4 / P5 — Renoncement, puis annulation                               */
  /* A4 — réversible à tout moment                                        */
  /* A7 — jamais de négatif                                               */
  /* ==================================================================== */
  console.log('\n--- P4/P5 : renoncer, puis revenir dessus ---');
  await ouvrirEnfant();
  await ouvrirJour(8);
  await ouvrirAutresCas();
  var det4 = parTexte(sheet, 'details', 'Ajuster mes heures');
  det4.open = true;
  await pause(60);

  var caseR = parTexte(sheet, '.coche-ligne', 'Je renonce à mes minutes');
  assert(!!caseR, 'P4 : la case de renoncement est là');
  assert(txt(caseR).indexOf('Vous pouvez revenir dessus à tout moment') !== -1,
    'A4 : et elle dit qu’on peut revenir dessus — un geste qu’on croit ' +
    'définitif ne se fait pas');
  assert(sansInsecable(txt(caseR)).indexOf('30 min') !== -1,
    'A6 : la valeur vient du contrat');

  var box = caseR.querySelector('input[type="checkbox"]');
  box.checked = true;
  box.dispatchEvent(new dom.window.Event('change'));
  await pause(60);
  assert(sansInsecable(txt(sheet)).indexOf('Ce jour : 0 min') !== -1,
    'P4 : l’effet est immédiat — plus aucune minute due (obtenu « ' +
    (sansInsecable(txt(sheet)).match(/Ce jour : [^.]{0,24}/) || [''])[0] + ' »)');

  var avantJ4 = appels.journee.length;
  boutonExact(sheet, 'Enregistrer cet ajustement').click();
  await pause(350);
  var ren = appels.journee[appels.journee.length - 1];
  assert(ren.minutes_sup_renoncees === 30,
    'P4 : 30 minutes renoncées (obtenu ' + ren.minutes_sup_renoncees + ')');
  /* A7 — jamais plus que le dû. */
  assert(ren.minutes_sup_renoncees <= 30 + (ren.minutes_sup_exceptionnelles || 0),
    'A7 : on ne renonce jamais à plus que ce qui est dû');

  /* P5 — on décoche : le renoncement est annulé. */
  await ouvrirEnfant();
  await ouvrirJour(8);
  await ouvrirAutresCas();
  var det5 = parTexte(sheet, 'details', 'Ajuster mes heures');
  assert(det5.open === true,
    'P5 : la section s’ouvre d’elle-même quand un ajustement existe — sinon ' +
    'Maria ne saurait pas qu’il est là');
  var caseR5 = parTexte(sheet, '.coche-ligne', 'Je renonce');
  var box5 = caseR5.querySelector('input[type="checkbox"]');
  assert(box5.checked === true, 'P5 : la case est bien cochée à la réouverture');
  box5.checked = false;
  box5.dispatchEvent(new dom.window.Event('change'));
  await pause(60);
  boutonExact(sheet, 'Enregistrer cet ajustement').click();
  await pause(350);
  var annule = appels.journee[appels.journee.length - 1];
  assert(annule.minutes_sup_renoncees === 0,
    'A4 : le renoncement est ANNULÉ (obtenu ' + annule.minutes_sup_renoncees + ')');

  /* ==================================================================== */
  /* P6 — Surcharge de RG-09 au jour                                      */
  /* A8 — sans toucher au contrat                                         */
  /* ==================================================================== */
  console.log('\n--- P6 : décider au cas par cas ---');
  scene.journees['c-lea'] = scene.journees['c-lea'] || {};
  scene.journees['c-lea']['2026-07-09'] = { jour: '2026-07-09', type: 'absence_enfant' };
  await ouvrirEnfant();
  await ouvrirJour(9);
  await ouvrirAutresCas();
  var det6 = parTexte(sheet, 'details', 'Ajuster mes heures');
  det6.open = true;
  await pause(60);

  var selOverride = parTexte(sheet, '.fld', 'ce jour-là');
  assert(!!selOverride, 'P6 : le choix au cas par cas est proposé sur une absence');
  assert(txt(sheet).indexOf('le réglage de la fiche contrat ne change pas') !== -1,
    'A8 : et l’écran dit que le contrat n’est pas touché');

  var sel = selOverride.querySelector('select');
  sel.value = 'false';
  sel.dispatchEvent(new dom.window.Event('change'));
  await pause(60);
  assert(sansInsecable(txt(sheet)).indexOf('Ce jour : 0 min') !== -1,
    'P6 : l’effet est immédiat');

  boutonExact(sheet, 'Enregistrer cet ajustement').click();
  await pause(350);
  var surcharge = appels.journee[appels.journee.length - 1];
  assert(surcharge.sup_dues_override === false,
    'P6 : la surcharge est écrite sur la JOURNÉE (obtenu ' + surcharge.sup_dues_override + ')');
  assert(LEA.sup_dues_si_enfant_absent === true,
    'A8 : et le réglage du CONTRAT n’a pas bougé');

  /* ==================================================================== */
  /* P7 — Le document AVEC renoncement                                    */
  /* A5 — la formulation exacte                                           */
  /* ==================================================================== */
  console.log('\n--- P7 : le renoncement sur le document ---');
  scene.journees['c-lea'] = {
    '2026-07-06': { jour: '2026-07-06', type: 'presence', minutes_sup_renoncees: 30 },
    '2026-07-07': { jour: '2026-07-07', type: 'presence', minutes_sup_renoncees: 30 },
    '2026-07-08': { jour: '2026-07-08', type: 'presence', minutes_sup_renoncees: 30 }
  };
  window.App.invalider();
  window.App.aller('document', { contratId: 'c-lea', annee: 2026, mois: 7 });
  await pause(350);

  var doc7 = corps.querySelector('.doc');
  var t7 = sansInsecable(txt(doc7));
  assert(t7.indexOf('auxquelles j’ai choisi de renoncer ce mois-ci') !== -1,
    'A5 : la formulation EXACTE de la spécification figure sur le document ' +
    '(obtenu « ' + (t7.match(/Dont [^.]{0,60}/) || [''])[0] + ' »)');
  assert(t7.indexOf('1h30') !== -1,
    'A5 : avec le total renoncé — 3 × 30 min');

  /* Risque n° 4 — LE RENONCEMENT EST UN GESTE, PAS UNE FACTURE EN ATTENTE.
     Ces mots-là transformeraient une phrase apaisante en créance : le parent
     croirait devoir quelque chose, ou se sentirait redevable. */
  ['non facturées', 'non facturé', 'offertes', 'offert', 'gratuit',
   'à ma charge', 'cadeau'].forEach(function (mot) {
    assert(t7.toLowerCase().indexOf(mot) === -1,
      'A5 (risque n° 4) : le mot « ' + mot + ' » n’apparaît pas — un geste ' +
      'assumé, pas une créance');
  });

  var apercu7 = corps.querySelector('.apercu-texte');
  assert(!!apercu7 && sansInsecable(txt(apercu7)).indexOf('choisi de renoncer') !== -1,
    'A5 : et le texte à coller le porte aussi');

  /* Le détail figure aussi dans « Le mois de … ». */
  await ouvrirEnfant();
  var pMois = parTexte(corps, '.fold', 'Le mois');
  assert(sansInsecable(txt(pMois)).indexOf('non réclamées') !== -1,
    'le bloc du mois détaille les heures non réclamées');

  /* ==================================================================== */
  /* P8 — Le document SANS renoncement : aucune mention                   */
  /* ==================================================================== */
  console.log('\n--- P8 : sans renoncement, rien n’est dit ---');
  scene.journees['c-lea'] = {};
  window.App.invalider();
  window.App.aller('document', { contratId: 'c-lea', annee: 2026, mois: 7 });
  await pause(350);

  var t8 = sansInsecable(txt(corps.querySelector('.doc')));
  assert(t8.indexOf('renoncer') === -1,
    'P8 : AUCUNE mention de renoncement quand il n’y en a pas eu — une phrase ' +
    'à zéro attirerait l’attention sur un sujet inexistant');

  /* ==================================================================== */
  /* P9 — Un contrat à 45 minutes                                         */
  /* A6 — aucune valeur écrite en dur                                     */
  /* ==================================================================== */
  console.log('\n--- P9 : un contrat à 45 minutes ---');
  await ouvrirEnfant('c-zoe');
  await ouvrirJour(10);
  await ouvrirAutresCas();
  var det9 = parTexte(sheet, 'details', 'Ajuster mes heures');
  det9.open = true;
  await pause(60);

  var t9 = sansInsecable(txt(sheet));
  assert(t9.indexOf('Au-delà des 45 min prévues au contrat') !== -1,
    'A6 : « 45 min », pas « 30 min » — la valeur vient du contrat (obtenu « ' +
    (t9.match(/Au-delà des [^.]{0,20}/) || [''])[0] + ' »)');
  assert(t9.indexOf('Ce jour : 45 min') !== -1, 'A6 : et l’effet aussi');
  var caseR9 = parTexte(sheet, '.coche-ligne', 'Je renonce');
  assert(sansInsecable(txt(caseR9)).indexOf('45 min') !== -1,
    'A6 : la case de renoncement également');
  assert(t9.indexOf('30 min') === -1,
    'A6 (risque n° 2) : « 30 min » n’apparaît NULLE PART sur un contrat à 45');

  /* A6 — et dans le code : aucune constante de minutes dans les libellés. */
  var src = fs.readFileSync(path.join(racine, 'js', 'ui-enfant.js'), 'utf8');
  var sansCommentaires = src.replace(/\/\*[\s\S]*?\*\//g, '');
  assert(!/'\s*30\s*min|30 min'/.test(sansCommentaires),
    'A6 : aucune valeur de minutes écrite en dur dans les libellés de l’écran');

  /* ==================================================================== */
  /* La panne d'enregistrement d'une note                                 */
  /* ==================================================================== */
  console.log('\n--- Panne : la note ne s’enregistre pas ---');
  await ouvrirEnfant();
  scene.noteCassee = true;
  var zp = zoneNote();
  zp.value = 'Un texte qui ne partira pas.';
  zp.dispatchEvent(new dom.window.Event('blur'));
  await pause(250);
  var pNoteP = parTexte(corps, '.fold', 'Mes notes');
  assert(txt(pNoteP).indexOf('n’a pas été enregistrée') !== -1,
    'B.0-9 : l’échec est dit');
  assert(txt(pNoteP).indexOf('Votre texte est toujours là') !== -1,
    'B.0-9 : et il dit ce qui reste vrai');
  assert(zoneNote().value.indexOf('ne partira pas') !== -1,
    'B.0-9 : le texte est effectivement toujours à l’écran');
  scene.noteCassee = false;

  /* ==================================================================== */
  console.log('');
  if (echecs) { console.error(echecs + ' échec(s).'); process.exit(1); }
  console.log('Tout est conforme.');
})().catch(function (e) {
  console.error('Erreur pendant le parcours :', e && e.stack || e);
  process.exit(1);
});
