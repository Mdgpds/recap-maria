/* ============================================================================
   Test de fumée — lot 14 : mise en service, export, suppression franche.
   Cas P1 à P8 de la spécification.

   POURQUOI CE FICHIER EXISTE.

   Ce lot rassemble trois gestes rares, et chacun est rare pour une raison
   différente — ce qui rend l'erreur d'autant plus coûteuse quand elle arrive.

   LA REPRISE DES COMPTEURS se fait UNE FOIS, au tout début. Ces chiffres sont
   le point de départ de tout l'historique : une erreur ici se propage à tous
   les mois suivants, sans jamais se signaler. Et une fois qu'un mois est
   clôturé, les corriger rendrait faux des documents déjà partis chez des
   familles. D'où le garde-fou central, vérifié ici : DÈS QU'UN MOIS EST
   CLÔTURÉ, LA SAISIE EST REFUSÉE — avec l'explication, pas un champ grisé.

   LA SUPPRESSION FRANCHE est la SEULE du projet. Elle existe pour la faute de
   frappe : un enfant créé deux fois, un prénom mal saisi. Le danger est qu'elle
   déborde : les six clés étrangères qui pointent vers `contrat` sont en
   « on delete cascade », et sans le trigger de la migration 010 un `delete`
   emporterait silencieusement des mois clôturés. Ce fichier vérifie le versant
   écran de la règle — on ne MONTRE jamais l'action quand elle est illégitime —
   la garantie, elle, est en base et vérifiée par rejeu SQL.

   L'EXPORT est le filet. S'il partait avec les photos des enfants, le fichier
   serait déjà écrit sur le disque de Maria avant que quiconque s'en aperçoive.
   A5 est donc contrôlé sur le contenu produit, pas sur l'intention.

   Lancement : node test/lot14-mise-en-service.smoke.js
   ========================================================================= */
'use strict';

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
function sansInsecable(t) { return String(t).replace(/ /g, ' '); }
function parTexte(racineEl, selecteur, morceau) {
  return Array.prototype.filter.call(racineEl.querySelectorAll(selecteur), function (e) {
    return e.textContent.indexOf(morceau) !== -1;
  })[0] || null;
}
function boutonQuiContient(racineEl, morceau) {
  return Array.prototype.filter.call(racineEl.querySelectorAll('button'), function (e) {
    return e.textContent.indexOf(morceau) !== -1;
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

/* --- Décor. Valeurs FICTIVES et rondes : le dépôt est public. -----------
   Deux contrats, et toute la démonstration tient dans leur différence :
   LÉA a vécu (des journées, un mois clôturé), TOM vient d'être créé. */
function contrat(id, prenom) {
  return {
    id: id, prenom_enfant: prenom, famille_id: 'f-' + id,
    famille: { id: 'f-' + id, nom: 'Foyer-' + prenom },
    date_debut: '2026-01-01', date_fin: null,
    minutes_contractuelles: 540, minutes_sup_jour: 30, minutes_par_jour_conge: 540,
    entretien_centimes_jour: 500, jours_planning: [1, 2, 3, 4, 5],
    heure_arrivee: '08:30:00', heure_depart: '18:00:00', statut: 'actif',
    sup_dues_si_enfant_absent: true, ordre_imputation: 'cp_puis_sup', archive: false,
    nom: null, genre: 'f', couleur: 'bleu',
    /* A5 — une photo EXISTE en base. C'est ce qui rend le contrôle d'export
       intéressant : s'il ne restait rien à retirer, il ne prouverait rien. */
    photo: 'data:image/jpeg;base64,PHOTO-FICTIVE-DE-LEA',
    modele_id: null
  };
}
var LEA = contrat('c-lea', 'Léa');
var TOM = contrat('c-tom', 'Tom');
TOM.photo = null;
TOM.date_debut = '2026-07-01';

var scene = {
  contrats: [LEA, TOM],
  journees: {
    'c-lea': {
      '2026-06-01': { id: 'j1', contrat_id: 'c-lea', jour: '2026-06-01', type: 'presence',
        minutes_reelles: 540, entretien_centimes: 500, commentaire: null,
        minutes_sup_exceptionnelles: 0, minutes_sup_renoncees: 0, sup_dues_override: null }
    },
    'c-tom': {}
  },
  compteurs: {
    'c-lea': { contrat_id: 'c-lea', date_reference: '2026-01-01',
      minutes_sup: 0, dixiemes_cp_acquis: 200, dixiemes_cp_pris: 0 },
    'c-tom': null
  },
  recaps: {
    'c-lea|2026-6': { id: 'r-lea-6', contrat_id: 'c-lea', annee: 2026, mois: 6,
      statut: 'fige',
      donnees: { joursPresence: 20, entretienCentimes: 10000, salaireNetCentimes: 150000,
        totalAVerserCentimes: 160000, minutesSupAcquises: 90, joursCongesDecomptes: 0 },
      fige_le: '2026-07-01T09:00:00Z', transmis_le: null }
  },
  moisCourant: { annee: 2026, mois: 7 },
  aujourdhui: '2026-07-31',
  compteurCasse: false,
  suppressionCassee: false,
  exportCasse: false,
  reinitReseauCasse: false
};

var appels = {
  compteur: [], suppression: [], export: 0, reinit: [], telechargements: []
};

function cleR(id, a, m) { return id + '|' + a + '-' + m; }
function recapsDe(id) {
  return Object.keys(scene.recaps)
    .filter(function (k) { return k.indexOf(id + '|') === 0; })
    .map(function (k) { return scene.recaps[k]; });
}

var DB = {
  getSession: function () {
    return Promise.resolve({ user: { id: 'u1', email: 'maria@exemple.test' } });
  },
  onAuthChange: function () {},
  signIn: function () { return Promise.resolve(true); },
  signOut: function () { return Promise.resolve(true); },

  /* P8 — la réinitialisation. La couche de données AVALE volontairement
     « adresse inconnue » et ne remonte que le réseau : c'est elle qui porte la
     règle, l'écran ne fait que l'afficher. On reproduit ce contrat ici. */
  demanderReinitialisation: function (email) {
    appels.reinit.push(email);
    if (scene.reinitReseauCasse) return Promise.reject(new Error('Failed to fetch'));
    return Promise.resolve(true);
  },

  listContratsActifs: function () { return Promise.resolve(scene.contrats); },
  listContratsTous: function () { return Promise.resolve(scene.contrats); },
  listContratsPourMois: function () { return Promise.resolve(scene.contrats); },
  listContratsPourPeriode: function () { return Promise.resolve(scene.contrats); },
  listFamilles: function () { return Promise.resolve([LEA.famille, TOM.famille]); },
  listFamillesToutes: function () { return Promise.resolve([LEA.famille, TOM.famille]); },
  listFamillesAvecContrats: function () { return Promise.resolve([]); },
  listModeles: function () { return Promise.resolve([]); },
  modeleEnVigueur: function () { return Promise.resolve(null); },
  getSalaires: function (id) {
    return Promise.resolve([{ id: 's-' + id, contrat_id: id, date_effet: '2026-01-01',
      brut_mensuel_centimes: 200000, net_mensuel_centimes: 150000 }]);
  },
  getCompteurInitial: function (id) {
    return Promise.resolve(scene.compteurs[id] || null);
  },
  getJourneesMois: function (id) { return Promise.resolve(scene.journees[id] || {}); },
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
  getNoteMensuelle: function () { return Promise.resolve(null); },
  enregistrerNoteMensuelle: function (id, a, m, t) { return Promise.resolve({ texte: t }); },
  listRecapsPeriode: function (id) { return Promise.resolve(recapsDe(id)); },
  listRecapsContrat: function (id) { return Promise.resolve(recapsDe(id)); },
  getRecap: function (id, a, m) { return Promise.resolve(scene.recaps[cleR(id, a, m)] || null); },
  estMoisCloture: function (id, a, m) {
    var r = scene.recaps[cleR(id, a, m)];
    return Promise.resolve(!!r && r.statut === 'fige');
  },
  enregistrerJournee: function (l) { return Promise.resolve(l); },
  supprimerJournee: function () { return Promise.resolve(true); },
  poserAbsenceMaria: function () { return Promise.resolve([]); },
  retirerAbsenceMaria: function () { return Promise.resolve(true); },
  rouvrirRecap: function () { return Promise.resolve(null); },
  recloturerRecap: function () { return Promise.resolve(null); },
  listEvenementsRecap: function () { return Promise.resolve([]); },
  marquerTransmis: function () { return Promise.resolve(null); },
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
  supprimerSalaire: function () { return Promise.resolve(true); },

  /* --- Lot 14 ------------------------------------------------------- */
  enregistrerCompteurInitial: function (id, champs) {
    appels.compteur.push({ contratId: id, champs: champs });
    if (scene.compteurCasse) return Promise.reject(new Error('Failed to fetch'));
    scene.compteurs[id] = {
      contrat_id: id, date_reference: champs.date_reference,
      minutes_sup: champs.minutes_sup,
      dixiemes_cp_acquis: champs.dixiemes_cp_acquis,
      dixiemes_cp_pris: champs.dixiemes_cp_pris
    };
    return Promise.resolve(scene.compteurs[id]);
  },
  /* La vraie fonction ne fait qu'un `delete` : c'est le TRIGGER en base qui
     refuse. On reproduit ce partage des rôles — la simulation refuse comme la
     base refuserait, avec le même code d'erreur. */
  supprimerContrat: function (id) {
    appels.suppression.push(id);
    if (scene.suppressionCassee) return Promise.reject(new Error('Failed to fetch'));
    var aDesJournees = Object.keys(scene.journees[id] || {}).length > 0;
    if (aDesJournees || recapsDe(id).length) {
      var e = new Error('contrat ' + id + ' : suppression impossible (CONTRAT_NON_VIERGE)');
      e.code = '23001';
      return Promise.reject(e);
    }
    scene.contrats = scene.contrats.filter(function (c) { return c.id !== id; });
    return Promise.resolve(true);
  },
  contratEstVierge: function (id) {
    return Promise.resolve(Object.keys(scene.journees[id] || {}).length === 0 &&
      recapsDe(id).length === 0);
  },
  exporterHistorique: function () {
    appels.export++;
    if (scene.exportCasse) return Promise.reject(new Error('Failed to fetch'));
    /* On rend ce que rend la VRAIE fonction : elle a déjà retiré la photo.
       A5 est donc vérifié à sa place — dans test/couche-donnees.test.js, sur
       le code source de db.js — et ici sur le FICHIER PRODUIT, où l'on
       contrôle qu'aucun autre chemin ne la réintroduit. */
    return Promise.resolve({
      exporte_le: null,
      familles: [LEA.famille, TOM.famille],
      contrats: scene.contrats.map(function (c) {
        var copie = {};
        Object.keys(c).forEach(function (k) { if (k !== 'photo') copie[k] = c[k]; });
        return copie;
      }),
      salaires: [{ id: 's1', contrat_id: 'c-lea', date_effet: '2026-01-01',
        brut_mensuel_centimes: 200000, net_mensuel_centimes: 150000 }],
      compteurs_initiaux: [scene.compteurs['c-lea']].filter(Boolean),
      journees: [scene.journees['c-lea']['2026-06-01'],
        { id: 'j2', contrat_id: 'c-lea', jour: '2026-06-15', type: 'conge_maria',
          minutes_reelles: null, entretien_centimes: null, commentaire: null,
          minutes_sup_exceptionnelles: 0, minutes_sup_renoncees: 0, sup_dues_override: null }],
      recapitulatifs: recapsDe('c-lea'),
      imputations: [{ id: 'i1', contrat_id: 'c-lea', date_debut: '2026-06-15',
        date_fin: '2026-06-19', jours_ouvrables: 6, jours_sur_cp: 6,
        jours_sur_sup: 0, jours_sans_solde: 0 }],
      evenements: [{ id: 'e1', recap_id: 'r-lea-6', type: 'reouverture',
        survenu_le: '2026-07-05T10:00:00Z', motif: 'Correction d’une journée' }],
      modeles: []
    });
  }
};
global.DB = DB; window.DB = DB;

/* Le téléchargement : on intercepte au plus près du navigateur. `a.click()`
   déclencherait une navigation que jsdom ne sait pas faire, et le contenu du
   fichier nous échapperait — or c'est précisément lui qu'on veut lire.

   Le Blob de jsdom ne rend pas son contenu de façon synchrone ; on le remplace
   par un porte-texte minimal, ce qui permet de LIRE le fichier produit — c'est
   lui, et non l'intention du code, que ce test contrôle. */
function FauxBlob(parties, opts) {
  this.texte = (parties || []).join('');
  this.type = (opts && opts.type) || '';
  this.size = this.texte.length;
}
dom.window.Blob = FauxBlob;

dom.window.URL.createObjectURL = function (blob) {
  appels.telechargements.push({ blob: blob, type: blob && blob.type, nom: null });
  return 'blob:factice';
};
dom.window.URL.revokeObjectURL = function () {};
dom.window.HTMLAnchorElement.prototype.click = function () {
  var dernier = appels.telechargements[appels.telechargements.length - 1];
  if (dernier) dernier.nom = this.download;
};

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

async function ouvrir(ecran, params) {
  window.App.invalider();
  window.App.aller(ecran, params || {});
  await pause(400);
}
function carteDe(prenom) {
  return parTexte(corps, '.pane', prenom);
}
async function lireDernierFichier() {
  var d = appels.telechargements[appels.telechargements.length - 1];
  if (!d) return null;
  return { nom: d.nom, type: d.type, texte: d.blob.texte };
}

(async function () {
  /* PAS de `dispatchEvent('DOMContentLoaded')` ici, contrairement aux tests de
     fumée précédents : jsdom émet lui-même cet événement, de façon différée,
     APRÈS l'exécution de ce fichier. Le dispatcher à la main câblait donc
     l'écran de connexion DEUX FOIS, et un clic sur « Mot de passe oublié »
     partait en double. Les autres tests ne comptent pas les appels et ne s'en
     apercevaient pas ; celui-ci les compte, et c'est justement l'objet de A6.
     Signalé en restitution. */
  await pause(400);

  /* ==================================================================== */
  /* P1 — Reprendre ses comptes sur un contrat qui n'a rien clôturé       */
  /* ==================================================================== */
  console.log('\n--- P1 : la reprise des comptes ---');
  await ouvrir('reprise');

  assert(txt(corps).indexOf('teniez déjà vos comptes sur papier') !== -1,
    'P1 : l’écran pose la question que Maria se pose, pas « reprise des compteurs »');

  var avert = parTexte(corps, '.warnbox', 'À ne saisir qu’une fois');
  assert(!!avert, 'P1 : l’avertissement est PERMANENT, pas un message qui passe');
  assert(txt(avert).indexOf('tous les mois suivants') !== -1,
    'P1 : et il dit la conséquence, pas seulement la consigne');

  var cTom = carteDe('Tom');
  assert(!!cTom, 'P1 : le contrat sans clôture a bien sa carte');
  var champs = cTom.querySelectorAll('.fld input');
  assert(champs.length >= 4, 'P1 : quatre chiffres à saisir, plus la date');
  assert(txt(cTom).indexOf('Récupération accumulée — heures') !== -1,
    'P1 : la récupération se saisit en heures et minutes, pas en minutes brutes');
  assert(txt(cTom).indexOf('Congés payés acquis (en jours)') !== -1,
    'P1 : et les congés en jours — « 125 dixièmes » ne veut rien dire pour personne');

  function champDe(carte, libelle) {
    var f = parTexte(carte, '.fld', libelle);
    return f ? f.querySelector('input') : null;
  }
  champDe(cTom, 'Récupération accumulée — heures').value = '12';
  champDe(cTom, '… et minutes').value = '30';
  champDe(cTom, 'Congés payés acquis (en jours)').value = '12,5';
  champDe(cTom, 'Congés payés déjà pris (en jours)').value = '3';

  var bTom = boutonQuiContient(cTom, 'Enregistrer le point de départ');
  assert(!!bTom, 'P1 : le bouton nomme l’enfant');
  bTom.click();
  await pause(250);

  assert(appels.compteur.length === 1, 'P1 : l’enregistrement part');
  var env = appels.compteur[0].champs;
  assert(env.minutes_sup === 12 * 60 + 30,
    'P1 : « 12 h 30 » devient 750 minutes — la conversion est faite par l’écran');
  assert(env.dixiemes_cp_acquis === 125,
    'P1 : « 12,5 jours » devient 125 dixièmes');
  assert(env.dixiemes_cp_pris === 30, 'P1 : « 3 jours » devient 30 dixièmes');
  assert(txt(cTom).indexOf('Point de départ enregistré pour Tom') !== -1,
    'P1 : la confirmation nomme l’enfant');

  /* ==================================================================== */
  /* P2 — Un contrat dont un mois est clôturé : la saisie est REFUSÉE     */
  /* A1 — le refus est expliqué, pas un champ grisé                       */
  /* ==================================================================== */
  console.log('\n--- P2 : un mois clôturé ferme la reprise ---');
  var cLea = carteDe('Léa');
  assert(!!cLea, 'P2 : le contrat clôturé a bien sa carte — il n’est pas escamoté');
  assert(!cLea.querySelector('input'),
    'P2 (risque n° 1) : AUCUN champ de saisie — modifier le point de départ ' +
    'rendrait faux des mois dont les documents sont partis chez des familles');
  assert(!boutonQuiContient(cLea, 'Enregistrer'),
    'P2 : et aucun bouton d’enregistrement');

  var refus = parTexte(cLea, '.warnbox', 'Impossible de modifier le point de départ');
  assert(!!refus, 'A1 : le refus est écrit');
  assert(txt(refus).indexOf('Léa') !== -1, 'A1 : il nomme l’enfant concerné');
  assert(txt(refus).indexOf('Des mois sont déjà clôturés') !== -1,
    'A1 : il dit CE QUI bloque');
  assert(txt(refus).indexOf('rendrait ces mois faux') !== -1,
    'A1 : et POURQUOI — un champ grisé sans raison n’apprend rien');

  /* Les chiffres actuels restent LISIBLES : Maria doit pouvoir les vérifier
     même quand elle ne peut plus les changer. */
  assert(sansInsecable(txt(cLea)).indexOf('Congés payés acquis') !== -1,
    'A1 : les chiffres existants restent affichés, en lecture');

  /* ==================================================================== */
  /* P3 — Une saisie incohérente : plus de congés pris qu'acquis          */
  /* A2 — dit en français AVANT l'aller-retour, la base restant la garantie */
  /* ==================================================================== */
  console.log('\n--- P3 : la saisie incohérente ---');
  var avant = appels.compteur.length;
  var cTom3 = carteDe('Tom');
  champDe(cTom3, 'Congés payés acquis (en jours)').value = '5';
  champDe(cTom3, 'Congés payés déjà pris (en jours)').value = '8';
  boutonQuiContient(cTom3, 'Enregistrer le point de départ').click();
  await pause(200);

  assert(appels.compteur.length === avant,
    'P3 : RIEN n’est parti — le contrôle a lieu avant le réseau');
  var msgKo = cTom3.querySelector('.msg.ko');
  assert(!!msgKo, 'A2 : un message d’erreur est affiché');
  assert(txt(msgKo).indexOf('pris plus de congés que vous n’en avez acquis') !== -1,
    'A2 : en français, sans nom de contrainte SQL');
  assert(sansInsecable(txt(msgKo)).indexOf('8 j') !== -1 &&
         sansInsecable(txt(msgKo)).indexOf('5 j') !== -1,
    'A2 : et il redonne les deux chiffres en cause');

  /* Un chiffre illisible : même exigence. */
  champDe(cTom3, 'Congés payés acquis (en jours)').value = 'douze';
  boutonQuiContient(cTom3, 'Enregistrer le point de départ').click();
  await pause(200);
  assert(appels.compteur.length === avant, 'P3 : toujours rien de parti');
  assert(txt(cTom3.querySelector('.msg.ko')).indexOf('illisible') !== -1,
    'P3 : et le message donne un EXEMPLE de ce qui est attendu');
  assert(txt(cTom3.querySelector('.msg.ko')).indexOf('12,5') !== -1,
    'P3 : un exemple concret, pas « format invalide »');

  /* La panne d'enregistrement : B.0-9 — l'échec est dit, et ce qui reste
     vrai est dit aussi. */
  champDe(cTom3, 'Congés payés acquis (en jours)').value = '10';
  champDe(cTom3, 'Congés payés déjà pris (en jours)').value = '2';
  scene.compteurCasse = true;
  boutonQuiContient(cTom3, 'Enregistrer le point de départ').click();
  await pause(250);
  assert(txt(cTom3.querySelector('.msg.ko')).indexOf('Vos chiffres sont toujours là') !== -1,
    'B.0-9 : la panne est dite, et ce qui reste vrai aussi');
  scene.compteurCasse = false;

  /* ==================================================================== */
  /* P4 — Supprimer un contrat vierge                                     */
  /* ==================================================================== */
  console.log('\n--- P4 : la suppression franche ---');
  await ouvrir('fiche', { contratId: 'c-tom' });

  var bSuppr = boutonQuiContient(corps, 'Supprimer ce contrat');
  assert(!!bSuppr, 'P4 : le bouton est proposé sur un contrat vierge');
  assert(txt(corps).indexOf('Possible car aucune journée n’a encore été saisie') !== -1,
    'P4 : et l’écran dit à quelle condition');

  bSuppr.click();
  await pause(200);
  assert(txt(sheet).indexOf('Supprimer le contrat de Tom ?') !== -1,
    'P4 : la confirmation nomme l’enfant');
  assert(txt(sheet).indexOf('Cette action est définitive') !== -1,
    'P4 : et dit que c’est définitif');
  assert(txt(sheet).indexOf('Ce contrat est terminé') !== -1,
    'P4 : elle rappelle l’ALTERNATIVE — archiver plutôt que supprimer');

  var bDef = boutonQuiContient(sheet, 'Supprimer définitivement');
  assert(!!bDef, 'P4 : le bouton final est explicite');
  bDef.click();
  await pause(350);
  assert(appels.suppression.length === 1 && appels.suppression[0] === 'c-tom',
    'P4 : la suppression part, sur le bon contrat');
  assert(!scene.contrats.some(function (c) { return c.id === 'c-tom'; }),
    'P4 : et le contrat a disparu');

  /* ==================================================================== */
  /* P5 — Le bouton N'EXISTE PAS sur un contrat qui porte des journées    */
  /* ==================================================================== */
  console.log('\n--- P5 : aucune action impossible affichée ---');
  await ouvrir('fiche', { contratId: 'c-lea' });

  assert(!boutonQuiContient(corps, 'Supprimer ce contrat'),
    'P5 (V8-20) : sur un contrat qui a servi, le bouton N’APPARAÎT PAS');
  assert(txt(corps).indexOf('suppression impossible') === -1 &&
         txt(corps).indexOf('Suppression impossible') === -1,
    'P5 : et AUCUN message n’explique son absence — un « impossible car… » ' +
    'grisé ferait croire à Maria qu’elle a raté quelque chose');
  assert(!!boutonQuiContient(corps, 'terminé') || txt(corps).indexOf('terminé') !== -1,
    'P5 : l’archivage, lui, reste proposé');

  /* ==================================================================== */
  /* P6 — L'export en document lisible                                    */
  /* A5 — aucune photo dans le fichier produit                            */
  /* ==================================================================== */
  console.log('\n--- P6 : l’export lisible ---');
  await ouvrir('menu');

  var entreeExport = parTexte(corps, '.menu', 'Exporter tout mon historique');
  assert(!!entreeExport, 'P6 : l’export est dans le Menu, rubrique Compte');
  entreeExport.click();
  await pause(200);
  assert(txt(sheet).indexOf('Le fichier ne contient aucune photo') !== -1,
    'P6 : la feuille dit ce que le fichier contient — et ce qu’il ne contient pas');
  assert(txt(sheet).indexOf('contrats terminés y figurent') !== -1,
    'P6 : les contrats archivés sont inclus — ce sont eux qu’on vient chercher');

  boutonQuiContient(sheet, 'Document unique').click();
  await pause(300);
  assert(appels.export === 1, 'P6 : l’export est demandé');
  var doc = await lireDernierFichier();
  assert(!!doc, 'P6 : un fichier est produit');
  assert(doc.nom === 'recap-maria-2026-07-31.txt',
    'P6 : le nom porte la date d’export — ' + doc.nom);
  assert(doc.type.indexOf('text/plain') === 0, 'P6 : et le bon type');

  assert(doc.texte.indexOf('RÉCAP MARIA — HISTORIQUE COMPLET') === 0,
    'P6 : le document s’annonce dès la première ligne');
  assert(doc.texte.indexOf('Léa') !== -1, 'P6 : l’enfant y est');
  assert(doc.texte.indexOf('Foyer-Léa') !== -1, 'P6 : sa famille aussi');
  assert(doc.texte.indexOf('Juin 2026 — clôturé') !== -1,
    'P6 : le mois est écrit EN FRANÇAIS, avec son état');
  assert(sansInsecable(doc.texte).indexOf('1 600,00 €') !== -1,
    'P6 : les montants sont lisibles, pas en centimes');
  assert(sansInsecable(doc.texte).indexOf('1h30') !== -1,
    'P6 : les heures aussi');
  assert(doc.texte.indexOf('ouvrables, du lundi au samedi') !== -1 &&
         doc.texte.indexOf('compte 6 jours') !== -1,
    'RG-06 : le document rappelle la règle qui fâche — c’est elle qu’on ' +
    'ressort des années après');

  /* CORRECTIF A3 (lot 14) — L'EXPORT ANNONÇAIT « TOUS VOS COMPTES » ET NE
     LIVRAIT QUE LES TOTAUX MENSUELS. `exporterHistorique` remplit neuf clés ;
     le document n'en lisait que deux. Or c'est le détail des journées et
     l'historique des réouvertures qu'on vient chercher des années après. */
  assert(doc.texte.indexOf('Rémunérations successives') !== -1,
    'A3 : les barèmes successifs figurent dans le document');
  assert(doc.texte.indexOf('Congés posés et leur répartition') !== -1 &&
         doc.texte.indexOf('sur congés payés') !== -1,
    'A3 : les congés et leur ventilation aussi');
  assert(doc.texte.indexOf('Journées qui s’écartent de la normale') !== -1,
    'A3 : et les journées particulières, datées');
  assert(doc.texte.indexOf('RÉOUVERTURES ET CLÔTURES') !== -1 &&
         doc.texte.indexOf('Correction d’une journée') !== -1,
    'A3 : l’historique des réouvertures y est, motif compris — c’est la pièce ' +
    'qu’on sort quand un désaccord remonte à plusieurs années');

  /* A5 — LE CONTRÔLE LE PLUS IMPORTANT DE L'EXPORT. */
  assert(doc.texte.indexOf('PHOTO-FICTIVE') === -1 && doc.texte.indexOf('base64') === -1,
    'A5 (risque n° 3) : AUCUNE photo dans le fichier produit');

  /* ==================================================================== */
  /* P7 — L'export en tableau                                             */
  /* ==================================================================== */
  console.log('\n--- P7 : l’export tableau ---');
  await ouvrir('menu');
  parTexte(corps, '.menu', 'Exporter tout mon historique').click();
  await pause(200);
  boutonQuiContient(sheet, 'Tableau').click();
  await pause(300);

  var tab = await lireDernierFichier();
  assert(tab.nom === 'recap-maria-2026-07-31.csv', 'P7 : extension csv');
  assert(tab.type.indexOf('text/csv') === 0, 'P7 : et type csv');

  var lignes = tab.texte.split('\n');
  assert(lignes[0].indexOf(';') !== -1 && lignes[0].indexOf(',') === -1,
    'P7 : séparateur POINT-VIRGULE — un tableur francophone l’attend, et les ' +
    'montants français portent une virgule décimale');
  assert(lignes[0].split(';')[0] === 'enfant', 'P7 : une ligne d’en-têtes nommés');
  assert(lignes.length >= 2, 'P7 : au moins un mois exporté');

  var cols = lignes[1].split(';');
  var iTotal = lignes[0].split(';').indexOf('total_a_verser_centimes');
  assert(cols[iTotal] === '160000',
    'P7 : les montants sortent en CENTIMES ENTIERS — un tableur qui relirait ' +
    '« 1 600,00 » selon ses propres réglages introduirait un arrondi');
  assert(tab.texte.indexOf('PHOTO-FICTIVE') === -1,
    'A5 : pas de photo dans le tableau non plus');

  /* La panne d'export : rien n'est écrit, et on le dit. */
  await ouvrir('menu');
  parTexte(corps, '.menu', 'Exporter tout mon historique').click();
  await pause(200);
  scene.exportCasse = true;
  var nbFichiers = appels.telechargements.length;
  boutonQuiContient(sheet, 'Document unique').click();
  await pause(300);
  assert(appels.telechargements.length === nbFichiers,
    'B.0-9 : aucun fichier tronqué n’est produit');
  assert(txt(sheet.querySelector('.msg.ko')).indexOf('Rien n’a été écrit') !== -1,
    'B.0-9 : et l’échec dit ce qui reste vrai');
  scene.exportCasse = false;

  /* ==================================================================== */
  /* P8 — Mot de passe oublié                                             */
  /* A6 — le message NE RÉVÈLE JAMAIS si l'adresse existe                 */
  /* ==================================================================== */
  console.log('\n--- P8 : mot de passe oublié ---');
  var champEmail = document.getElementById('login-email');
  var bOubli = document.getElementById('btn-oubli');
  var msgLogin = document.getElementById('msg-login');
  assert(!!bOubli, 'P8 : le lien existe sur l’écran de connexion');

  /* Sans adresse : on demande l'adresse, on n'envoie rien. */
  champEmail.value = '';
  bOubli.click();
  await pause(150);
  assert(appels.reinit.length === 0, 'P8 : sans adresse, rien ne part');
  assert(txt(msgLogin).indexOf('Renseignez votre adresse') !== -1,
    'P8 : et on dit quoi faire');

  /* Adresse connue. */
  champEmail.value = 'maria@exemple.test';
  bOubli.click();
  await pause(250);
  assert(appels.reinit.length === 1, 'P8 : la demande part');
  var messageConnue = txt(msgLogin);
  assert(messageConnue.indexOf('Si un compte existe pour cette adresse') !== -1,
    'A6 : le message est au CONDITIONNEL');

  /* Adresse inconnue — la couche de données avale « user not found ». */
  champEmail.value = 'inconnue@exemple.test';
  bOubli.click();
  await pause(250);
  assert(appels.reinit.length === 2, 'P8 : la demande part aussi');
  assert(txt(msgLogin) === messageConnue,
    'A6 (risque n° 4) : le message est EXACTEMENT le même — sinon ce formulaire ' +
    'deviendrait un outil pour savoir qui possède un compte ici, et derrière il ' +
    'y a les revenus d’une personne et les prénoms de quatre enfants');

  /* Le RÉSEAU, lui, se distingue : Maria doit savoir que rien n'est parti. */
  scene.reinitReseauCasse = true;
  bOubli.click();
  await pause(250);
  assert(txt(msgLogin).indexOf('n’a pas abouti') !== -1,
    'P8 : un échec de réseau, lui, est dit — c’est la seule distinction qui compte');
  scene.reinitReseauCasse = false;

  /* --- Et dans le code : aucun message qui trahirait l'existence. ------ */
  var srcApp = fs.readFileSync(path.join(racine, 'js', 'app.js'), 'utf8');
  var srcDb = fs.readFileSync(path.join(racine, 'js', 'db.js'), 'utf8');
  var sansCom = (srcApp + srcDb).replace(/\/\*[\s\S]*?\*\//g, '');
  assert(!/aucun compte|adresse inconnue|utilisateur introuvable/i.test(sansCom),
    'A6 : aucune formulation révélatrice dans le code');

  /* ==================================================================== */
  console.log('');
  if (echecs) { console.error(echecs + ' échec(s).'); process.exit(1); }
  console.log('Tout est conforme.');
})().catch(function (e) {
  console.error('Erreur pendant le parcours :', e && e.stack || e);
  process.exit(1);
});
