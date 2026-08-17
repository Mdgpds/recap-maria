/* ============================================================================
   Test de fumée — lot 11 : contrats types et modification groupée.
   Cas P1 à P8 de la spécification.

   POURQUOI CE FICHIER EXISTE.

   Ce lot introduit un objet qui ressemble à un gabarit et n'en est pas un. Un
   logiciel ordinaire, quand on met à jour un modèle, met à jour ce qui en
   dépend. Ici c'est l'inverse exact, et c'est délibéré (V8-14) : créer une
   nouvelle version des conditions ne touche AUCUN contrat. L'alignement se
   propose, contrat par contrat.

   Parce qu'un contrat qui reste en arrière n'a rien d'anormal. Tom garde son
   ancienne rémunération parce que ses parents ne l'ont pas revalorisée : c'est
   un fait négocié, pas un oubli. Une application qui « corrigerait » cet écart
   ferait perdre de l'argent à une famille sans que personne l'ait décidé.

   Trois garanties se vérifient ici, et toutes les trois sont des ABSENCES —
   ce qui est le plus difficile à tenir dans le temps :
     - créer une version n'écrit rien sur aucun contrat (A1) ;
     - aucune case d'alignement n'est cochée par défaut (V8-14) ;
     - une rémunération ne s'écrit JAMAIS directement sur un contrat, mais par
       une ligne `salaire_contrat` datée (A4) — sinon les mois déjà clôturés,
       dont le document est parti chez une famille, changeraient.

   Lancement : node test/lot11-modeles.smoke.js
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
function sansInsecable(t) { return String(t).replace(/ /g, ' '); }
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
var MODELE_2026 = {
  id: 'm-2026', nom: 'Conditions 2026', date_effet: '2026-01-01',
  jours_planning: [1, 2, 3, 4, 5], heure_arrivee: '08:30:00', heure_depart: '18:00:00',
  minutes_contractuelles: 540, minutes_sup_jour: 30, minutes_par_jour_conge: 540,
  entretien_centimes_jour: 500, brut_mensuel_centimes: 200000, net_mensuel_centimes: 150000,
  sup_dues_si_enfant_absent: true, ordre_imputation: 'cp_puis_sup', cree_le: '2026-01-01T00:00:00Z'
};
var MODELE_2025 = {
  id: 'm-2025', nom: 'Conditions 2025', date_effet: '2025-09-01',
  jours_planning: [1, 2, 3, 4, 5], heure_arrivee: '08:30:00', heure_depart: '18:00:00',
  minutes_contractuelles: 540, minutes_sup_jour: 30, minutes_par_jour_conge: 540,
  entretien_centimes_jour: 450, brut_mensuel_centimes: 190000, net_mensuel_centimes: 140000,
  sup_dues_si_enfant_absent: true, ordre_imputation: 'cp_puis_sup', cree_le: '2025-09-01T00:00:00Z'
};

function contrat(id, prenom, extra) {
  var c = {
    id: id, prenom_enfant: prenom, famille_id: 'f-' + id,
    famille: { id: 'f-' + id, nom: 'Foyer-' + prenom }, date_debut: '2026-01-01', date_fin: null,
    minutes_contractuelles: 540, minutes_sup_jour: 30, minutes_par_jour_conge: 540,
    entretien_centimes_jour: 500, jours_planning: [1, 2, 3, 4, 5],
    heure_arrivee: '08:30:00', heure_depart: '18:00:00', statut: 'actif',
    sup_dues_si_enfant_absent: true, ordre_imputation: 'cp_puis_sup', archive: false,
    nom: null, genre: null, couleur: null, photo: null, modele_id: 'm-2026'
  };
  Object.keys(extra || {}).forEach(function (k) { c[k] = extra[k]; });
  return c;
}
/* Léa est alignée. Tom s'en écarte SUR DEUX POINTS : sa rémunération n'a pas
   été revalorisée, et son entretien est resté à l'ancien montant. */
var LEA = contrat('c-lea', 'Léa', { genre: 'f' });
var TOM = contrat('c-tom', 'Tom', { genre: 'g', entretien_centimes_jour: 450 });

var scene = {
  contrats: [LEA, TOM],
  modeles: [MODELE_2026, MODELE_2025],
  salaires: {
    'c-lea': [{ id: 's1', contrat_id: 'c-lea', date_effet: '2026-01-01',
      brut_mensuel_centimes: 200000, net_mensuel_centimes: 150000 }],
    'c-tom': [{ id: 's2', contrat_id: 'c-tom', date_effet: '2025-09-01',
      brut_mensuel_centimes: 190000, net_mensuel_centimes: 140000 }]
  },
  /* Les récapitulatifs sont désormais pilotables : le cas B6 a besoin d'un
     mois CLÔTURÉ pour vérifier que l'alignement le refuse. */
  recaps: { 'c-lea': [], 'c-tom': [] },
  moisCourant: { annee: 2026, mois: 8 },
  aujourdhui: '2026-08-11'
};
var appels = { creerModele: [], majContrat: [], ajouterSalaire: [], creerContrat: [] };

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
    return Promise.resolve(scene.contrats.filter(function (c) { return !c.archive; }));
  },
  listContratsTous: function () { return Promise.resolve(scene.contrats); },
  listContratsPourMois: function () { return Promise.resolve(scene.contrats); },
  listContratsPourPeriode: function () { return Promise.resolve(scene.contrats); },
  listFamilles: function () { return Promise.resolve([]); },
  listFamillesToutes: function () { return Promise.resolve([{ id: 'f-c-lea', nom: 'Foyer-Léa', archive: false }]); },
  listFamillesAvecContrats: function () { return Promise.resolve([]); },
  listModeles: function () { return Promise.resolve(scene.modeles.slice()); },
  modeleEnVigueur: function (d) {
    var r = null;
    scene.modeles.forEach(function (m) {
      if (m.date_effet <= d && (!r || m.date_effet > r.date_effet)) r = m;
    });
    return Promise.resolve(r);
  },
  creerModele: function (m) {
    appels.creerModele.push(m);
    var pose = { id: 'm-neuf' };
    Object.keys(m).forEach(function (k) { pose[k] = m[k]; });
    scene.modeles.unshift(pose);
    return Promise.resolve(pose);
  },
  rattacherContratAModele: function (id, mid) { return DB.majContrat(id, { modele_id: mid }); },
  ecartsContratModele: null,          // remplacé par le vrai db.js ci-dessous
  majContratsEnLot: null,
  /* Lot 14 — la fiche contrat demande si le contrat est vierge pour décider
  d'AFFICHER ou non la suppression franche. Décor mis à jour ici : sans
  cette fonction, l'écran lève avant même de se rendre. */
  contratEstVierge: function () { return Promise.resolve(false); },
  majContrat: function (id, champs) {
    appels.majContrat.push({ id: id, champs: champs });
    scene.contrats.forEach(function (c) {
      if (c.id === id) Object.keys(champs).forEach(function (k) { c[k] = champs[k]; });
    });
    return Promise.resolve(scene.contrats.filter(function (c) { return c.id === id; })[0]);
  },
  creerContrat: function (c) { appels.creerContrat.push(c); return Promise.resolve(
    { id: 'c-neuf', prenom_enfant: c.prenom_enfant }); },
  creerFamille: function (f) { return Promise.resolve({ id: 'f-neuf', nom: f.nom }); },
  majFamille: function (id, f) { return Promise.resolve(f); },
  archiverContrat: function () { return Promise.resolve(true); },
  desarchiverContrat: function () { return Promise.resolve(true); },
  getSalaires: function (id) { return Promise.resolve((scene.salaires[id] || []).slice()); },
  ajouterSalaire: function (id, s) {
    appels.ajouterSalaire.push({ contratId: id, salaire: s });
    if (!scene.salaires[id]) scene.salaires[id] = [];
    var pose = { id: 's-' + appels.ajouterSalaire.length, contrat_id: id };
    Object.keys(s).forEach(function (k) { pose[k] = s[k]; });
    scene.salaires[id].push(pose);
    return Promise.resolve(pose);
  },
  majSalaire: function (id, s) { return Promise.resolve(s); },
  supprimerSalaire: function () { return Promise.resolve(true); },
  getCompteurInitial: function (id) {
    return Promise.resolve({ contrat_id: id, date_reference: '2026-01-01',
      minutes_sup: 0, dixiemes_cp_acquis: 200, dixiemes_cp_pris: 0 });
  },
  getJourneesMois: function () { return Promise.resolve({}); },
  getJourneesPeriode: function () { return Promise.resolve({}); },
  listImputations: function () { return Promise.resolve([]); },
  listImputationsPourMois: function () { return Promise.resolve([]); },
  getNoteMensuelle: function () { return Promise.resolve(null); },
    enregistrerNoteMensuelle: function (c, a, m, t) { return Promise.resolve({ texte: t }); },
  enregistrerImputation: function (i) { return Promise.resolve(i); },
  supprimerImputation: function () { return Promise.resolve(true); },
  listRecapsPeriode: function (id) { return Promise.resolve(scene.recaps[id] || []); },
  listRecapsContrat: function (id) { return Promise.resolve(scene.recaps[id] || []); },
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
  majContratIdentite: function (id, c) { return DB.majContrat(id, c); },
  rattacherContratAFamille: function (id, f) { return DB.majContrat(id, { famille_id: f }); },
  renommerFamille: function () { return Promise.resolve(true); },
  archiverFamille: function () { return Promise.resolve(true); },
  desarchiverFamille: function () { return Promise.resolve(true); }
};

/* `ecartsContratModele` et `majContratsEnLot` sont des fonctions PURES de
   db.js : on veut les vraies, pas des simulacres — c'est justement leur
   comportement qui est vérifié. On les recopie depuis le fichier réel. */
(function chargerVraiesFonctions() {
  var src = fs.readFileSync(path.join(racine, 'js', 'db.js'), 'utf8');
  var debut = src.indexOf('var CHAMPS_COMPARES_MODELE = [');
  var fin = src.indexOf('/* Applique UN SEUL champ');
  var bloc = src.slice(debut, fin);
  /* eslint-disable no-new-func */
  var fabrique = new Function('Kit', bloc +
    '\nreturn { ecartsContratModele: ecartsContratModele, CHAMPS_COMPARES_MODELE: CHAMPS_COMPARES_MODELE };');
  var vrai = fabrique(null);
  DB.ecartsContratModele = vrai.ecartsContratModele;
  DB.CHAMPS_COMPARES_MODELE = vrai.CHAMPS_COMPARES_MODELE;
})();

DB.majContratsEnLot = function (ids, champ, valeur, dateEffet) {
  if (champ === 'remuneration') {
    if (!dateEffet) return Promise.reject(new Error('DATE_EFFET_REQUISE'));
    return Promise.all((ids || []).map(function (id) {
      return DB.ajouterSalaire(id, {
        date_effet: dateEffet,
        brut_mensuel_centimes: valeur.brut_mensuel_centimes,
        net_mensuel_centimes: valeur.net_mensuel_centimes
      });
    }));
  }
  var champs = {};
  champs[champ] = valeur;
  return Promise.all((ids || []).map(function (id) { return DB.majContrat(id, champs); }));
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

async function ouvrir(ecran, params) {
  window.App.invalider();
  window.App.aller(ecran, params || {});
  await pause(300);
}
function poserDate(bloc, iso) {
  var p = iso.split('-');
  var sels = bloc.querySelectorAll('select');
  if (sels.length === 3) { sels[0].value = String(Number(p[2])); sels[1].value = String(Number(p[1])); sels[2].value = p[0]; }
  else { sels[0].value = String(Number(p[1])); sels[1].value = p[0]; }
  Array.prototype.forEach.call(sels, function (s) {
    s.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  });
}

(async function () {
  document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  await pause(300);

  /* ==================================================================== */
  /* L'écran : les versions, la plus récente en tête                      */
  /* A6 — les anciennes restent lisibles et ne se suppriment pas          */
  /* ==================================================================== */
  console.log('\n--- Mes contrats types ---');
  await ouvrir('modeles');

  var cartes = corps.querySelectorAll('.big');
  assert(cartes.length === 2, 'les deux versions sont listées (obtenu ' + cartes.length + ')');
  assert(txt(cartes[0]).indexOf('Conditions 2026') !== -1,
    'la plus récente est en tête');
  assert(txt(cartes[0]).indexOf('en vigueur depuis le') !== -1,
    'la version courante annonce depuis quand');
  assert(txt(cartes[1]).indexOf('Conditions 2025') !== -1, 'l’ancienne suit');
  assert(txt(cartes[1]).indexOf('du ') !== -1 && txt(cartes[1]).indexOf(' au ') !== -1,
    'A6 : l’ancienne version reste lisible, avec ses bornes');
  assert(txt(cartes[0]).indexOf('2 contrats rattachés') !== -1,
    'le nombre de contrats rattachés est dit');
  assert(txt(cartes[0]).indexOf('écart') !== -1,
    'les écarts sont comptés (Tom en a)');
  assert(txt(corps).indexOf('ne se suppriment pas') !== -1,
    'A6 : l’écran dit POURQUOI on ne supprime pas une version');
  assert(!parTexte(corps, 'button', 'Supprimer'),
    'A6 : aucun bouton de suppression nulle part');

  /* ==================================================================== */
  /* P1 — Créer une version SANS aligner : aucun contrat modifié          */
  /* ==================================================================== */
  console.log('\n--- P1 : créer une version, n’aligner personne ---');
  var majAvant = appels.majContrat.length;
  var salAvant = appels.ajouterSalaire.length;

  boutonExact(corps, 'Créer une nouvelle version').click();
  await pause(200);

  assert(txt(sheet).indexOf('Pré-remplie depuis') !== -1,
    'P1 : la nouvelle version est pré-remplie depuis la version en vigueur');
  assert(txt(sheet).indexOf('Créer cette version ne modifie aucun contrat') !== -1,
    'A1 : c’est DIT avant même de créer');

  sheet.querySelectorAll('input')[0].value = 'Conditions 2027';
  boutonExact(sheet, 'Créer cette version').click();
  await pause(300);

  assert(appels.creerModele.length === 1, 'P1 : la version est créée');
  assert(appels.majContrat.length === majAvant,
    'A1 : AUCUN contrat n’a été modifié par la création (obtenu ' +
    (appels.majContrat.length - majAvant) + ' écriture(s))');
  assert(appels.ajouterSalaire.length === salAvant,
    'A1 : aucune rémunération non plus');

  assert(txt(sheet).indexOf('Quels contrats passent à cette version ?') !== -1,
    'V8-14 : l’alignement est PROPOSÉ, pas appliqué');
  assert(txt(sheet).indexOf('Rien ne changera pour ceux que vous ne cochez pas') !== -1,
    'V8-14 : et la phrase le dit');

  var boites = sheet.querySelectorAll('input[type="checkbox"]');
  assert(boites.length === 2, 'V8-14 : une case par contrat actif');
  assert(Array.prototype.every.call(boites, function (b) { return b.checked === false; }),
    'V8-14 : AUCUNE case n’est cochée par défaut — une case pré-cochée est une ' +
    'décision prise à la place de Maria');

  var lignes = sheet.querySelectorAll('.aligne');
  assert(txt(lignes[0]).indexOf('→') !== -1,
    'A2 : chaque ligne montre la valeur actuelle ET la valeur cible (obtenu « ' +
    txt(lignes[0]).slice(0, 70) + ' »)');
  assert(txt(sheet).indexOf('Les mois déjà clôturés ne changeront pas') !== -1,
    'RG-15 est rappelé là où le geste se pose');

  /* On applique SANS cocher : rien ne doit bouger. */
  boutonExact(sheet, 'Appliquer').click();
  await pause(300);
  assert(appels.majContrat.length === majAvant,
    'P1 : appliquer sans cocher ne modifie rien');
  assert(txt(toast).indexOf('Aucun contrat n’a changé') !== -1,
    'P1 : et le message le dit clairement (obtenu « ' + txt(toast).slice(0, 60) + ' »)');

  /* ==================================================================== */
  /* P2 — Alignement PARTIEL                                              */
  /* A4 — la rémunération passe par une ligne datée                       */
  /* ==================================================================== */
  console.log('\n--- P2 : aligner un contrat sur deux ---');
  await ouvrir('modeles');
  boutonExact(corps, 'Créer une nouvelle version').click();
  await pause(200);
  sheet.querySelectorAll('input')[0].value = 'Conditions 2028';
  boutonExact(sheet, 'Créer cette version').click();
  await pause(300);

  var salAvant2 = appels.ajouterSalaire.length;
  var boites2 = sheet.querySelectorAll('input[type="checkbox"]');
  boites2[0].checked = true;                      // Léa seulement
  var dateEffet = parTexte(sheet, '.fld', 'À partir du');
  poserDate(dateEffet, '2026-09-01');
  boutonExact(sheet, 'Appliquer').click();
  await pause(350);

  var nouvellesLignes = appels.ajouterSalaire.slice(salAvant2);
  assert(nouvellesLignes.length === 1,
    'P2 : UNE seule rémunération posée — celle du contrat coché (obtenu ' +
    nouvellesLignes.length + ')');
  assert(nouvellesLignes[0].contratId === 'c-lea', 'P2 : et c’est bien Léa');
  /* A4 — LE POINT LE PLUS COÛTEUX DU LOT s'il était manqué. */
  assert(!!nouvellesLignes[0].salaire.date_effet,
    'A4 : la rémunération est posée par une ligne DATÉE, jamais en écriture directe');
  assert(nouvellesLignes[0].salaire.date_effet === '2026-09-01',
    'A4 : à la date choisie (obtenu ' + nouvellesLignes[0].salaire.date_effet + ')');
  var ecritDirect = appels.majContrat.filter(function (m) {
    return m.champs.brut_mensuel_centimes !== undefined ||
           m.champs.net_mensuel_centimes !== undefined;
  });
  assert(ecritDirect.length === 0,
    'A4 (risque n° 2) : AUCUN montant n’est écrit directement sur un contrat — ' +
    'les mois passés changeraient');

  /* ==================================================================== */
  /* P3 — L'écart s'affiche sur la fiche, SANS langage d'erreur           */
  /* ==================================================================== */
  console.log('\n--- P3 : l’écart de Tom sur sa fiche ---');
  await ouvrir('fiche', { contratId: 'c-tom' });

  assert(txt(corps).indexOf('Contrat type') !== -1, 'P3 : le rattachement est affiché');
  assert(txt(corps).indexOf('écart') !== -1, 'P3 : l’écart est signalé');
  assert(txt(corps).indexOf('rémunération') !== -1,
    'P3 : la rémunération est nommée dans l’écart');
  assert(!!boutonExact(corps, 'Aligner sur la version'), 'P3 : « Aligner sur la version »');
  assert(!!boutonExact(corps, 'Garder cet écart'), 'P3 : « Garder cet écart »');

  /* A3 — pas de langage d'erreur. Un écart est un fait négocié. */
  var bloc = corps.querySelector('.note.ecart');
  assert(!!bloc, 'A3 : l’écart est présenté comme une NOTE, pas comme une alerte');
  assert(!corps.querySelector('.warnbox.ecart'), 'A3 : jamais une boîte d’avertissement');
  var t = txt(bloc);
  ['erreur', 'incorrect', 'anomalie', 'problème', 'invalide', 'corriger'].forEach(function (mot) {
    assert(t.toLowerCase().indexOf(mot) === -1,
      'A3 : le mot « ' + mot + ' » n’apparaît pas — un écart n’est pas une faute');
  });

  /* « Garder cet écart » ne fait RIEN d'autre que refermer. */
  var majAvantGarder = appels.majContrat.length;
  var salAvantGarder = appels.ajouterSalaire.length;
  boutonExact(corps, 'Garder cet écart').click();
  await pause(120);
  assert(appels.majContrat.length === majAvantGarder &&
         appels.ajouterSalaire.length === salAvantGarder,
    'V8-13 : « Garder cet écart » n’écrit RIEN');
  assert(!corps.querySelector('.note.ecart'),
    'V8-13 : la mention se referme — un écart n’est pas une alerte permanente');
  /* Mais refermer n'est pas fermer la porte : une ligne discrète permet d'y
     revenir. Sans elle, Maria n'aurait plus aucun moyen d'aligner ce contrat
     depuis sa fiche — on aurait remplacé une alerte trop insistante par une
     impasse. */
  assert(!!corps.querySelector('.ecart-referme'),
    'V8-13 : une ligne discrète permet de rouvrir la mention');
  assert(!!parTexte(corps, 'button', 'Voir'), 'V8-13 : et un lien « Voir »');
  parTexte(corps, 'button', 'Voir').click();
  await pause(250);
  assert(!!corps.querySelector('.note.ecart'), 'V8-13 : la mention revient');

  /* ==================================================================== */
  /* P4 — Aligner un contrat en écart                                     */
  /* ==================================================================== */
  console.log('\n--- P4 : aligner Tom ---');
  await ouvrir('fiche', { contratId: 'c-tom' });
  var salAvant4 = appels.ajouterSalaire.length;
  boutonExact(corps, 'Aligner sur la version').click();
  await pause(250);

  assert(txt(sheet).indexOf('Aligner Tom sur') !== -1, 'P4 : la feuille nomme le contrat');
  assert(txt(sheet).indexOf('→') !== -1, 'P4 : chaque écart montre actuel → cible');
  assert(txt(sheet).indexOf('Rémunération à partir du') !== -1,
    'P4 : une date d’effet est demandée pour la rémunération');
  assert(txt(sheet).indexOf('Les mois déjà clôturés ne changeront pas') !== -1,
    'P4 : RG-15 rappelé');

  var d4 = parTexte(sheet, '.fld', 'Rémunération à partir du');
  poserDate(d4, '2026-09-01');
  boutonExact(sheet, 'Aligner').click();
  await pause(350);

  assert(appels.ajouterSalaire.length === salAvant4 + 1,
    'P4 : une ligne de rémunération datée est posée');
  var majEntretien = appels.majContrat.filter(function (m) {
    return m.champs.entretien_centimes_jour !== undefined;
  });
  assert(majEntretien.length >= 1,
    'P4 : l’écart d’entretien est corrigé sur le contrat, lui');
  assert(TOM.entretien_centimes_jour === 500,
    'P4 : Tom est passé à 5,00 € d’entretien (obtenu ' + TOM.entretien_centimes_jour + ')');

  /* ==================================================================== */
  /* P6 — Modification groupée : UNE chose à la fois                      */
  /* A8                                                                    */
  /* ==================================================================== */
  console.log('\n--- P6 : modification groupée de l’entretien ---');
  await ouvrir('modifGroupee');

  assert(txt(corps).indexOf('Que voulez-vous modifier ?') !== -1,
    'V8-25 : on choisit D’ABORD ce qu’on change');
  var choses = corps.querySelectorAll('.choice');
  assert(choses.length >= 4, 'plusieurs choses modifiables');
  assert(!!parTexte(corps, '.choice', 'Rémunération'), 'la rémunération en fait partie');
  assert(!!parTexte(corps, '.choice', 'Indemnité d’entretien'), 'l’entretien aussi');
  /* A8 — une SEULE chose : l'écran ne propose aucun formulaire multi-champs. */
  assert(corps.querySelectorAll('input').length === 0,
    'A8 : aucun champ de saisie à cette étape — une chose à la fois');

  parTexte(corps, '.choice', 'Indemnité d’entretien').click();
  await pause(200);
  assert(txt(sheet).indexOf('La nouvelle valeur d’abord') !== -1,
    'V8-25 : la nouvelle valeur AVANT le choix des contrats');
  assert(sheet.querySelectorAll('input[type="checkbox"]').length === 0,
    'V8-25 : aucun contrat n’est encore proposé');

  sheet.querySelector('input').value = '6,00';
  boutonExact(sheet, 'Continuer').click();
  await pause(300);

  assert(txt(sheet).indexOf('Quels contrats ?') !== -1, 'V8-25 : PUIS les contrats');
  var lignes6 = sheet.querySelectorAll('.aligne');
  assert(lignes6.length === 2, 'un contrat par ligne');
  assert(txt(lignes6[0]).indexOf('actuellement') !== -1,
    'chaque contrat affiche SA valeur actuelle (obtenu « ' + txt(lignes6[0]).slice(0, 70) + ' »)');
  assert(sansInsecable(txt(lignes6[0])).indexOf(sansInsecable(Format.centimesEnEuros(600))) !== -1,
    'et la valeur cible — 6,00 € (obtenu « ' + txt(lignes6[0]).slice(0, 80) + ' »)');

  var majAvant6 = appels.majContrat.length;
  sheet.querySelectorAll('input[type="checkbox"]')[0].checked = true;
  boutonExact(sheet, 'Appliquer').click();
  await pause(350);

  var nouvelles6 = appels.majContrat.slice(majAvant6);
  assert(nouvelles6.length === 1, 'P6 : un seul contrat modifié — celui coché');
  assert(nouvelles6[0].champs.entretien_centimes_jour === 600,
    'P6 : à 6,00 € (obtenu ' + nouvelles6[0].champs.entretien_centimes_jour + ')');
  assert(Object.keys(nouvelles6[0].champs).length === 1,
    'A8 : UN SEUL champ écrit, pas un lot de réglages (obtenu ' +
    Object.keys(nouvelles6[0].champs).join(', ') + ')');

  /* ==================================================================== */
  /* P7 — Ajouter un enfant : pré-remplissage, et il le DIT               */
  /* ==================================================================== */
  console.log('\n--- P7 : créer un enfant ---');
  await ouvrir('menu');
  parTexte(corps, '.menu', 'Ajouter un enfant').click();
  await pause(300);

  assert(txt(sheet).indexOf('Réglages repris de') !== -1,
    'A7 : la provenance des valeurs pré-remplies est DITE (obtenu « ' +
    (txt(sheet).match(/Réglages repris de [^.]{0,30}/) || [''])[0] + ' »)');

  var champsSheet = sheet.querySelectorAll('input');
  var champBrut = parTexte(sheet, '.fld', 'Salaire brut');
  assert(!!champBrut && champBrut.querySelector('input').value !== '',
    'A7 : le salaire est pré-rempli depuis la version en vigueur');

  /* P8 — la date de début décide de la version, pas la date du jour. */
  var champDebut = parTexte(sheet, '.fld', 'Début du contrat');
  poserDate(champDebut, '2025-10-01');
  await pause(120);
  assert(txt(sheet).indexOf('Conditions 2025') !== -1,
    'P8 : une date de début en 2025 reprend « Conditions 2025 » — ce qui vaut à ' +
    'une date ne dépend pas de ce qui a été décidé après (obtenu « ' +
    (txt(sheet).match(/Réglages repris de [^.]{0,30}/) || [''])[0] + ' »)');

  poserDate(champDebut, '2026-03-01');
  await pause(120);
  assert(txt(sheet).indexOf('Conditions 2026') !== -1,
    'P8 : et une date en 2026 reprend « Conditions 2026 »');

  var prenom = parTexte(sheet, '.fld', 'Prénom de l’enfant');
  prenom.querySelector('input').value = 'Neuf';
  boutonExact(sheet, 'Créer le contrat').click();
  await pause(350);

  assert(appels.creerContrat.length === 1, 'P7 : le contrat est créé');
  var cree = appels.creerContrat[0];
  assert(cree.modele_id === 'm-2026',
    'P7 : rattaché à la version en vigueur à sa date de début');
  assert(cree.entretien_centimes_jour === 500,
    'P7 : et ses réglages en sont repris (obtenu ' + cree.entretien_centimes_jour + ')');

  /* ==================================================================== */
  /* B6 — Aligner sur un mois CLÔTURÉ : refusé, et rien n'est écrit        */
  /* ==================================================================== */
  console.log('\n--- B6 : la date d’effet ne peut pas tomber sur un mois clôturé ---');

  /* Le garde-fou existait depuis le lot 5 sur la feuille de barème, et les
     TROIS chemins d'alignement du lot 11 le contournaient : aucun ne lisait les
     récapitulatifs. Le mois figé ne changeait pas de montant, mais le barème
     que RG-15 retient POUR CE MOIS devenait un barème jamais validé pour lui —
     et toute réouverture l'aurait reclôturé dessus, en silence. */
  scene.recaps['c-tom'] = [{ id: 'r-tom-7', contrat_id: 'c-tom', annee: 2026, mois: 7,
    statut: 'fige', donnees: {}, fige_le: '2026-08-01T09:00:00Z', transmis_le: null }];

  await ouvrir('fiche', { contratId: 'c-tom' });
  var salAvantB6 = appels.ajouterSalaire.length;
  var majAvantB6 = appels.majContrat.length;
  var bAlign = boutonExact(corps, 'Aligner sur la version');
  if (bAlign) {
    bAlign.click();
    await pause(250);
    var dB6 = parTexte(sheet, '.fld', 'Rémunération à partir du');
    if (dB6) {
      poserDate(dB6, '2026-07-01');
      boutonExact(sheet, 'Aligner').click();
      await pause(350);
      assert(appels.ajouterSalaire.length === salAvantB6,
        'B6 : AUCUNE ligne de rémunération n’est posée sur un mois clôturé');
      assert(appels.majContrat.length === majAvantB6,
        'B6 : et aucun réglage n’a bougé non plus — le refus est total');
      var koB6 = sheet.querySelector('.msg.ko');
      assert(!!koB6 && txt(koB6).indexOf('clôturé') !== -1,
        'B6 : le refus nomme ce qui bloque');
      assert(!!koB6 && txt(koB6).indexOf('juillet 2026') !== -1,
        'B6 : et DIT quel mois — pas « impossible » tout seul');
    } else {
      assert(false, 'B6 : la feuille d’alignement propose une date d’effet');
    }
  } else {
    assert(false, 'B6 : le bouton d’alignement est présent');
  }
  window.Kit.fermerFeuille();
  await pause(50);
  scene.recaps['c-tom'] = [];

  /* ==================================================================== */
  /* A9 — les 10 cas de référence du moteur                               */
  /* ==================================================================== */
  console.log('\n--- A9 : le moteur n’a pas bougé ---');
  var engineSrc = fs.readFileSync(path.join(racine, 'js', 'engine.js'), 'utf8');
  assert(engineSrc.indexOf('modele_contrat') === -1 && engineSrc.indexOf('modele_id') === -1,
    'A9 : le moteur ignore complètement les contrats types — ils ne sont pas ' +
    'du calcul, ils sont du confort de saisie');

  /* ==================================================================== */
  console.log('');
  if (echecs) { console.error(echecs + ' échec(s).'); process.exit(1); }
  console.log('Tout est conforme.');
})().catch(function (e) {
  console.error('Erreur pendant le parcours :', e && e.stack || e);
  process.exit(1);
});
