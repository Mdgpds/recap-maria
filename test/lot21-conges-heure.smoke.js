/* ============================================================================
   Test de fumée — LOT 21, LES CONGÉS EN DURÉE LIBRE, FAMILLE PAR FAMILLE.

   La règle du lot 16, sans exception : TOUT ÉCRAN LIVRÉ DOIT ÊTRE RENDU PAR UN
   TEST QUI CLIQUE. Les huit critères du §21.4 sont des critères d'ÉCRAN — une
   phrase de refus, un bouton inactif, un pré-choix, un montant annoncé avant
   validation. Aucune recherche de chaîne dans un `.js` ne peut les voir.

   Ce fichier monte le vrai `index.html`, le vrai moteur, la vraie chaîne, et
   lit ce qui s'affiche. Il couvre :

     §21.1  les trois formats, la borne des 4 h 30, les deux phrases de refus ;
     §21.2  la pose famille par famille, le pré-choix, les trois issues ;
     §21.3  la trace dans « Mes congés », et le retrait qui rend tout ;
     §21.4  les critères A1 à A7 (A8 est prouvé par `node test/run.js`).

   Décor : octobre 2026, trois enfants aux réserves DIFFÉRENTES — c'est tout
   l'objet du lot, et un décor où elles se ressemblent ne prouverait rien.

     Léa   récup 12 h 00 · CP 10 j · brut 1 404,00 € (7,20 € de l'heure)
     Tom   récup  1 h 30 · CP  0 j · brut 1 326,00 € (6,80 € de l'heure)
     Noah  récup  0 h 00 · CP  0 j · brut 1 404,00 €

   Le jour de pose est le jeudi 8 octobre 2026.

   Lancement : node test/lot21-conges-heure.smoke.js
   ========================================================================= */
'use strict';

var fs = require('fs');
var path = require('path');
var JSDOM = require('jsdom').JSDOM;
var Decor = require('./decor-avenants.js');

var racine = path.join(__dirname, '..');
var dom = new JSDOM(fs.readFileSync(path.join(racine, 'index.html'), 'utf8'),
  { url: 'https://exemple.test/' });

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
/* Les espaces INSÉCABLES sont normalisés — la typographie française en
   sème partout (« 10 j », « 5,50 € »), et un test qui cherche un espace
   ordinaire ne trouverait jamais rien. L'échappement est explicite :
   écrit littéralement, ce caractère est invisible dans le fichier et la
   normalisation devient un remplacement d'espace par lui-même. */
function txt(el) { return el ? String(el.textContent).replace(/\u00a0/g, ' ') : ''; }
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
var JOUR = '2026-10-08';          // un jeudi

function enfant(id, prenom, brut, net) {
  return {
    id: id, prenom_enfant: prenom, famille_id: 'f-' + id,
    famille: { id: 'f-' + id, nom: 'Famille ' + prenom },
    date_debut: '2026-10-01', date_fin: null,
    minutes_contractuelles: 540, minutes_sup_jour: 30, minutes_par_jour_conge: 540,
    entretien_centimes_jour: 550, jours_planning: PLANNING,
    heure_arrivee: '08:30:00', heure_depart: '17:30:00', statut: 'actif',
    sup_dues_si_enfant_absent: true, ordre_imputation: 'cp_puis_sup', archive: false,
    nom: null, genre: prenom === 'Léa' ? 'f' : 'm', couleur: null, photo: null,
    brut: brut, net: net
  };
}

var LEA = enfant('c-lea', 'Léa', 140400, 107100);
var TOM = enfant('c-tom', 'Tom', 132600, 101000);
var NOAH = enfant('c-noah', 'Noah', 140400, 107100);
var CONTRATS = [LEA, TOM, NOAH];

var AVENANTS = {};
CONTRATS.forEach(function (c) {
  var a = Decor.avenantDe(c, { id: 'a-' + c.id, date_effet: '2026-10-01',
    brut_mensuel_centimes: c.brut, net_mensuel_centimes: c.net });
  a.numero = 1;
  AVENANTS[c.id] = [a];
});

/* Les compteurs de départ, posés à la mise en service au 1er octobre : aucun
   mois n'est rejoué avant, donc ce sont exactement les réserves d'octobre. */
var COMPTEURS = {
  'c-lea':  { minutes_sup: 720, minutes_cp_acquis: 5400, minutes_cp_pris: 0 },
  'c-tom':  { minutes_sup: 90,  minutes_cp_acquis: 0,    minutes_cp_pris: 0 },
  'c-noah': { minutes_sup: 0,   minutes_cp_acquis: 0,    minutes_cp_pris: 0 }
};

var journees = {};                 // contratId -> { 'YYYY-MM-DD': ligne }
var ecritures = [];

function journeesDe(id) { return journees[id] || (journees[id] = {}); }

var DB = {
  getSession: function () {
    return Promise.resolve({ user: { id: 'u1', email: 'maria@exemple.test' } });
  },
  onAuthChange: function () {},
  signOut: function () { return Promise.resolve(true); },
  getEmettrice: function () { return Promise.resolve({ nom: 'Maria' }); },
  enregistrerEmettrice: function (nom) { return Promise.resolve({ nom: nom }); },
  getPreferenceRappel: function () { return Promise.resolve(null); },
  listContratsActifs: function () { return Promise.resolve(CONTRATS.slice()); },
  listContratsTous: function () { return Promise.resolve(CONTRATS.slice()); },
  listContratsPourMois: function () { return Promise.resolve(CONTRATS.slice()); },
  listContratsPourPeriode: function () { return Promise.resolve(CONTRATS.slice()); },
  listFamilles: function () { return Promise.resolve(CONTRATS.map(function (c) { return c.famille; })); },
  listFamillesToutes: function () { return Promise.resolve(CONTRATS.map(function (c) { return c.famille; })); },
  listFamillesAvecContrats: function () {
    return Promise.resolve(CONTRATS.map(function (c) {
      return { id: c.famille.id, nom: c.famille.nom, archive: false, contrats: [c] };
    }));
  },
  contratEstVierge: function () { return Promise.resolve(false); },
  getAvenants: function (id) { return Promise.resolve((AVENANTS[id] || []).slice()); },
  ajouterAvenant: function (id, champs) { return Promise.resolve(champs); },
  majAvenant: function (id, champs) { return Promise.resolve(champs); },
  supprimerAvenant: function () { return Promise.resolve(true); },
  getCompteurInitial: function (id) {
    var c = COMPTEURS[id];
    return Promise.resolve({ contrat_id: id, date_reference: '2026-10-01',
      minutes_sup: c.minutes_sup, minutes_cp_acquis: c.minutes_cp_acquis,
      minutes_cp_pris: c.minutes_cp_pris });
  },
  getJourneesMois: function (id, a, m) {
    var prefixe = a + '-' + String(m).padStart(2, '0');
    var out = {};
    var src = journeesDe(id);
    Object.keys(src).forEach(function (j) { if (j.slice(0, 7) === prefixe) out[j] = src[j]; });
    return Promise.resolve(out);
  },
  getJourneesPeriode: function (id, d, f) {
    var parMois = {};
    var src = journeesDe(id);
    Object.keys(src).forEach(function (j) {
      if (j < d || j > f) return;
      var cle = j.slice(0, 7);
      if (!parMois[cle]) parMois[cle] = {};
      parMois[cle][j] = src[j];
    });
    return Promise.resolve(parMois);
  },
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
  enregistrerJournee: function (l) {
    ecritures.push(l);
    var ligne = { id: 'j-' + l.contrat_id + '-' + l.jour, contrat_id: l.contrat_id,
                  jour: l.jour, type: l.type };
    ['minutes_reelles', 'entretien_centimes', 'commentaire', 'entretien_du',
     'minutes_sup_exceptionnelles', 'minutes_sup_renoncees', 'sup_dues_override',
     'ecart_minutes', 'ecart_evenement', 'ecart_heure_reelle', 'ecart_impute_sur']
      .forEach(function (k) {
        ligne[k] = Object.prototype.hasOwnProperty.call(l, k) ? l[k] : null;
      });
    if (ligne.entretien_du == null) ligne.entretien_du = true;
    /* Une ligne sans écart et sans rien d'autre n'existe pas en base : la
       saisie par exception la supprime. C'est ce que fait le retrait. */
    if (ligne.ecart_minutes == null && ligne.type === 'presence' &&
        ligne.minutes_reelles == null && ligne.entretien_centimes == null &&
        ligne.commentaire == null) {
      delete journeesDe(l.contrat_id)[l.jour];
    } else {
      journeesDe(l.contrat_id)[l.jour] = ligne;
    }
    return Promise.resolve(ligne);
  },
  supprimerJournee: function (id, j) { delete journeesDe(id)[j]; return Promise.resolve(true); },
  poserAbsenceMaria: function () { return Promise.resolve([]); },
  retirerAbsenceMaria: function () { return Promise.resolve(true); },
  recloturerRecap: function () { return Promise.resolve({ id: 'x', statut: 'fige' }); }
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

window.App.moisCourant = function () { return { annee: 2026, mois: 10 }; };
window.App.aujourdhui = function () { return '2026-10-08'; };

var corps = document.getElementById('corps');
var sheet = document.getElementById('sheet');

/* Ouvre « Mes congés », puis le parcours, puis le format demandé. */
async function ouvrirFormat(format) {
  window.App.invalider();
  window.App.aller('conges', { annee: 2026, mois: 10 }, true);
  await pause(500);
  boutonExact(corps, 'Poser des congés').click();
  await pause(200);
  parTexte(sheet, 'button', format).click();
  await pause(400);
}

/* La durée libre, saisie dans le champ heure natif. */
function saisirDuree(hhmm) {
  var input = sheet.querySelector('input[type="time"]');
  input.value = hhmm;
  input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
}

/* Le bloc d'issue d'un enfant : les trois boutons et l'effet chiffré vivent
   dans le `.issue` qui suit son choix. */
function issueDe(prenom) {
  var choix = Array.prototype.filter.call(sheet.querySelectorAll('.choice'), function (e) {
    return txt(e).indexOf(prenom) !== -1;
  })[0];
  return choix ? choix.nextElementSibling : null;
}
function boutonIssue(prenom, libelle) {
  var bloc = issueDe(prenom);
  return bloc ? boutonExact(bloc, libelle) : null;
}

(async function () {
  document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  await pause(500);

  /* ==================================================================== */
  /* §21.1 — LES TROIS FORMATS, ET LA BORNE DES 4 H 30 (A1)               */
  /* ==================================================================== */
  console.log('\n--- §21.1 : les trois formats ---');

  window.App.aller('conges', { annee: 2026, mois: 10 }, true);
  await pause(500);
  boutonExact(corps, 'Poser des congés').click();
  await pause(200);
  contient(sheet, 'Une ou plusieurs journées', 'le format en journées est proposé');
  contient(sheet, 'Une demi-journée', 'la demi-journée aussi');
  contient(sheet, 'Une durée libre', 'et la durée libre');

  console.log('\n--- A1 : la borne des 4 h 30 ---');
  parTexte(sheet, 'button', 'Une durée libre').click();
  await pause(400);

  saisirDuree('00:23');
  await pause(150);
  var bPoser = parTexte(sheet, 'button', 'Poser 0h23');
  assert(!!(bPoser && !bPoser.disabled), 'A1 : 23 minutes se posent');

  saisirDuree('01:34');
  await pause(150);
  assert(!!parTexte(sheet, 'button', 'Poser 1h34'), 'A1 : 1 h 34 aussi');

  saisirDuree('04:29');
  await pause(150);
  var b429 = parTexte(sheet, 'button', 'Poser 4h29');
  assert(!!(b429 && !b429.disabled), 'A1 : 4 h 29 se pose — la borne est STRICTE');

  saisirDuree('04:30');
  await pause(150);
  contient(sheet, '4h30 : c’est une demi-journée ou plus',
    'A1 : 4 h 30 est refusé, avec sa phrase');
  contient(sheet, 'choisissez « une demi-journée » ou « une ou plusieurs journées »',
    'A1 : et la phrase dit quoi faire à la place');
  var bRefus = parTexte(sheet, 'button', 'Poser 0h00');
  assert(!!(bRefus && bRefus.disabled), 'A1 : et le bouton de pose est inactif');

  saisirDuree('00:00');
  await pause(150);
  contient(sheet, 'Saisissez une durée', 'A1 : zéro est refusé, avec sa phrase');
  contient(sheet, '1 h, 23 min, 1 h 34', 'A1 : et la phrase donne des exemples');

  /* ==================================================================== */
  /* §21.2 — LE PRÉ-CHOIX, PAR ENFANT (A3)                                */
  /* ==================================================================== */
  console.log('\n--- A3 : le pré-choix est intelligent, et par enfant ---');

  saisirDuree('01:00');
  await pause(200);
  contient(sheet, 'Pour qui, et sur quoi ?', 'le bloc famille par famille est là');
  contient(sheet, 'Chaque famille se règle individuellement', 'et il le dit');
  contient(sheet, 'récup 12h00 · CP 10 j', 'les réserves de Léa sont affichées');
  contient(sheet, 'récup 1h30 · CP 0 j', 'et celles de Tom');

  /* Une heure : la récup de Tom (1 h 30) couvre. */
  contient(issueDe('Tom'), '→ récupération : 0h30',
    'A3 : Tom à 0 CP et 1 h 30 de récup, pour 1 h → récupération');
  contient(issueDe('Léa'), '→ récupération : 11h00', 'A3 : Léa aussi, sa récup couvre');
  contient(issueDe('Noah'), '→ sans solde',
    'A3 : Noah sans aucune réserve → sans solde');

  /* Deux heures : la récup de Tom ne couvre plus, ses CP non plus. */
  saisirDuree('02:00');
  await pause(200);
  contient(issueDe('Tom'), '→ sans solde',
    'A3 : pour 2 h, Tom bascule en sans solde — récup ET CP insuffisants');
  contient(issueDe('Léa'), '→ récupération : 10h00',
    'A3 : et Léa ne bouge pas — le pré-choix est PAR ENFANT');

  /* ==================================================================== */
  /* A4 — LES CONGÉS PAYÉS NE PASSENT JAMAIS EN NÉGATIF                   */
  /* ==================================================================== */
  console.log('\n--- A4 : les congés payés, jamais sous zéro ---');

  var bCpTom = boutonIssue('Tom', 'Congés payés');
  assert(!!(bCpTom && bCpTom.disabled),
    'A4 : le bouton « Congés payés » est INACTIF quand le compteur ne couvre pas');
  contient(issueDe('Tom'), 'plus assez — reste 0 j',
    'A4 : et l’écran dit ce qui reste');
  var bCpLea = boutonIssue('Léa', 'Congés payés');
  assert(!!(bCpLea && !bCpLea.disabled),
    'A4 : celui de Léa, dont les CP couvrent, reste actif');

  /* ==================================================================== */
  /* A5 — LA RÉCUPÉRATION FORCÉE EN NÉGATIF, ANNONCÉE AVANT               */
  /* ==================================================================== */
  console.log('\n--- A5 : « vous devrez X à cette famille », AVANT validation ---');

  boutonIssue('Tom', 'Récupération').click();
  await pause(200);
  contient(issueDe('Tom'), 'Vous devrez 0h30 à cette famille',
    'A5 : la dette est annoncée avant validation');
  contient(issueDe('Tom'), 'du temps que vous rendrez',
    'A5 : et l’écran dit ce que ça veut dire');

  /* ==================================================================== */
  /* A6 — LE SANS SOLDE VIENT DU MOTEUR, SUR LE BRUT DU CONTRAT           */
  /* ==================================================================== */
  console.log('\n--- A6 : le montant du sans solde, contrat par contrat ---');

  saisirDuree('01:34');
  await pause(200);
  /* 94 minutes. Noah : 1 404,00 € sur 195 h → 11,28 €. Tom : 1 326,00 € → 10,65 €.
     Deux bruts, deux montants : on ne calcule pas tout sur le premier. */
  egal(Engine.montantCentimes(140400, 94), 1128, 'témoin : le montant de Noah');
  egal(Engine.montantCentimes(132600, 94), 1065, 'témoin : celui de Tom');
  contient(issueDe('Noah'), '− 11,28 € sur son mois',
    'A6 : le montant de Noah vient du moteur, sur SON brut');
  boutonIssue('Tom', 'Sans solde').click();
  await pause(200);
  contient(issueDe('Tom'), '− 10,65 € sur son mois',
    'A6 : et celui de Tom est différent — pas le brut du premier contrat');

  /* ==================================================================== */
  /* A2 — UNE POSE POUR UN SEUL ENFANT NE TOUCHE AUCUN AUTRE COMPTEUR     */
  /* ==================================================================== */
  console.log('\n--- A2 : une pose pour Tom seul ---');

  /* On décoche Léa et Noah. */
  parTexte(sheet, '.choice', 'Léa').click();
  await pause(150);
  parTexte(sheet, '.choice', 'Noah').click();
  await pause(150);
  contient(sheet, 'Poser 1h34 pour Tom',
    'le bouton récapitule : un seul enfant, nommé');

  boutonIssue('Tom', 'Récupération').click();
  await pause(200);
  ecritures.length = 0;
  parTexte(sheet, 'button', 'Poser 1h34 pour Tom').click();
  await pause(600);

  egal(ecritures.length, 1, 'A2 : une seule journée écrite');
  egal(ecritures[0].contrat_id, 'c-tom', 'A2 : et c’est bien celle de Tom');
  egal(ecritures[0].ecart_minutes, -94, 'les minutes sont négatives : du temps retiré');
  egal(ecritures[0].ecart_evenement, 'conge_horaire',
    'l’événement dit CONGÉ, pas « libération anticipée » — c’est l’objet de la migration 017');
  egal(ecritures[0].ecart_impute_sur, 'recuperation', 'et l’issue choisie est écrite');
  egal(ecritures[0].type, 'presence',
    'la journée reste une journée de PRÉSENCE : l’entretien reste dû');
  assert(!journees['c-lea'][JOUR] && !journees['c-noah'][JOUR],
    'A2 : aucun autre contrat n’a été touché');

  /* ==================================================================== */
  /* §21.3 — LA TRACE, ET L'EFFET SUR LES COMPTEURS (A5, suite)           */
  /* ==================================================================== */
  console.log('\n--- §21.3 : la trace dans « Mes congés » ---');

  window.App.invalider();
  window.App.aller('conges', { annee: 2026, mois: 10 }, true);
  await pause(600);
  contient(corps, '1h34 le jeudi 8 octobre', 'la ligne porte la durée et le jour');
  contient(corps, 'Tom : récupération', 'et l’issue de chaque enfant');

  /* L'EFFET RÉEL SUR LE COMPTEUR, dans l'espace de Tom. Il n'y devient pas
     négatif — octobre lui rapporte 22 × 30 min — mais les 94 minutes en sont
     bien sorties : 1 h 30 d'entrée + 11 h 00 acquises − 1 h 34 = 10 h 56.
     C'est ça, la preuve que la pose a mordu sur le bon compteur. */
  window.App.aller('enfant', { contratId: 'c-tom', annee: 2026, mois: 10 });
  await pause(600);
  contient(corps, '10h56',
    'les 1 h 34 sont sorties de la récupération de Tom, au compteur près');

  /* ==================================================================== */
  /* A7 — LE RETRAIT REND EXACTEMENT CE QUI AVAIT ÉTÉ DÉDUIT              */
  /* ==================================================================== */
  console.log('\n--- A7 : le retrait, enfant par enfant ---');

  /* Une pose mixte : Léa sur sa récupération, Noah en sans solde. */
  await ouvrirFormat('Une demi-journée');
  contient(sheet, '4h30 — la moitié d’une journée de congé',
    '§21.1 : la demi-journée est pré-remplie et non modifiable');
  /* Tom porte déjà un congé ce jour-là : l'écran le dit et l'écarte, plutôt
     que de réécrire par-dessus en silence. */
  contient(sheet, 'un congé est déjà posé sur cette journée',
    'un congé existant est nommé, pas écrasé');
  boutonIssue('Léa', 'Récupération').click();
  await pause(150);
  boutonIssue('Noah', 'Sans solde').click();
  await pause(200);
  contient(sheet, 'Poser 4h30 sur 2 contrats', 'le bouton récapitule les deux contrats');
  parTexte(sheet, 'button', 'Poser 4h30 sur 2 contrats').click();
  await pause(600);

  window.App.invalider();
  window.App.aller('enfant', { contratId: 'c-lea', annee: 2026, mois: 10 });
  await pause(600);
  /* 12 h 00 d'entrée + 11 h 00 acquises en octobre − 4 h 30 posées = 18 h 30. */
  contient(corps, '18h30', 'Léa : la demi-journée est sortie de sa récupération');

  /* On retire. */
  window.App.aller('conges', { annee: 2026, mois: 10 }, true);
  await pause(600);
  boutonExact(corps, 'Retirer des congés').click();
  await pause(500);
  parTexte(sheet, 'button', '½ journée le jeudi 8 octobre').click();
  await pause(300);
  contient(sheet, 'reviennent au compteur qui les avait fournies',
    'A7 : le retrait dit ce qu’il rend');
  contient(sheet, 'Une retenue de sans solde disparaît',
    'A7 : et il dit que le sans solde n’est pas un compteur');
  boutonExact(sheet, 'Retirer ce congé').click();
  await pause(700);

  window.App.invalider();
  window.App.aller('enfant', { contratId: 'c-lea', annee: 2026, mois: 10 });
  await pause(600);
  contient(corps, '23h00',
    'A7 : Léa retrouve EXACTEMENT ses 4 h 30 — 12 h 00 + 11 h 00 acquises');
  window.App.aller('enfant', { contratId: 'c-noah', annee: 2026, mois: 10 });
  await pause(600);
  contient(corps, '11h00',
    'A7 : Noah, qui était en sans solde, n’a rien reçu en retour — ce n’est pas un compteur');
  window.App.aller('enfant', { contratId: 'c-tom', annee: 2026, mois: 10 });
  await pause(600);
  contient(corps, '10h56', 'A7 : et la pose de Tom, elle, n’a pas bougé');

  /* ==================================================================== */
  /* CORRECTION B1 — LE GARDE-FOU SUIT LA DATE CHOISIE, PAS LE MOIS AFFICHÉ */
  /* ==================================================================== */
  console.log('\n--- B1 : les compteurs suivent la date, pas l’écran ---');

  /* Le défaut : `cpDe` lisait le compteur d'entrée du MOIS AFFICHÉ, alors que
     la feuille offre un champ de date libre sur quatre ans. Maria consultait
     juillet et posait en octobre : l'écran annonçait les réserves de juillet,
     et l'écriture consommait un compteur d'octobre qui pouvait être vide.
     Les congés payés passaient en négatif — et `cpDisponible` bornant à zéro,
     le solde négatif n'apparaissait NULLE PART, pour toujours (RG-12).

     Tom entre octobre avec 0 j de congés payés. En décembre, il en a acquis
     deux mois : 5 j. Le même écran, la même feuille, deux dates — et deux
     réponses différentes. C'est exactement ce que le garde-fou doit faire. */
  window.App.invalider();
  await ouvrirFormat('Une durée libre');
  saisirDuree('01:00');
  await pause(300);

  /* On se place sur le VENDREDI 9 — un jour de planning libre de tout congé.
     Le 8 en porte déjà un pour Tom, et la correction B2 refuse d'écrire
     par-dessus : Tom y serait écarté, et ce n'est pas ce qu'on mesure ici. */
  var champsDate = sheet.querySelectorAll('.fld .dates select');
  champsDate[0].value = '9';
  champsDate[0].dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await pause(700);
  absent(sheet, 'un congé est déjà posé sur cette journée',
    'B1 : le 9 octobre est libre — Tom est bien dans le parcours');

  contient(sheet, 'CP 0 j', 'B1 : en octobre, Tom n’a aucun congé payé');
  var cpTomOct = boutonIssue('Tom', 'Congés payés');
  assert(!!(cpTomOct && cpTomOct.disabled),
    'B1 : et le bouton « Congés payés » est inactif');

  /* On déplace la date en décembre 2026, sans rien changer d'autre. */
  champsDate[1].value = '12';                      // le mois
  champsDate[1].dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await pause(700);

  contient(sheet, 'CP 5 j',
    'B1 : à la date de DÉCEMBRE, Tom a bien ses 5 jours acquis');
  var cpTomDec = boutonIssue('Tom', 'Congés payés');
  assert(!!(cpTomDec && !cpTomDec.disabled),
    'B1 : et le bouton devient actif — le garde-fou a suivi la date');

  /* Et dans l'autre sens, celui qui creusait le trou : on revient en octobre,
     le bouton doit se refermer. */
  champsDate[1].value = '10';
  champsDate[1].dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await pause(700);
  var cpTomRetour = boutonIssue('Tom', 'Congés payés');
  assert(!!(cpTomRetour && cpTomRetour.disabled),
    'B1 : et il se referme quand on revient sur un mois sans réserve');
  contient(issueDe('Tom'), 'plus assez — reste 0 j',
    'B1 : avec la phrase du §21.2');

  /* ==================================================================== */
  /* CORRECTION C3 — LE SOLDE NÉGATIF S'AFFICHE (A5, seconde moitié)      */
  /* ==================================================================== */
  console.log('\n--- C3 : la récupération négative se voit ---');

  /* Tom porte déjà un congé le 8 octobre. On regarde une autre journée : sa
     récupération d'entrée d'octobre est de 1 h 30, et une pose de 2 h la
     ferait passer en négatif. `supDisponible` bornait l'affichage à zéro. */
  saisirDuree('02:00');
  await pause(300);
  boutonIssue('Tom', 'Récupération').click();
  await pause(250);
  contient(issueDe('Tom'), 'Vous devrez 0h30 à cette famille',
    'C3 : la dette est annoncée avant validation');
  contient(sheet, 'récup 1h30',
    'C3 : et le solde affiché est le solde SIGNÉ, pas un zéro borné');

  /* ==================================================================== */
  /* CORRECTION C2 — « − 0,00 € » NE S'AFFICHE PLUS                       */
  /* ==================================================================== */
  console.log('\n--- C2 : une retenue inconnue se dit, elle ne vaut pas zéro ---');

  /* Noah perd sa rémunération : son avenant n'en porte plus (§17.2 point 3,
     brut et net sont nullables). Le sans solde ne peut alors pas être chiffré,
     et l'écran doit le DIRE — pas annoncer « − 0,00 € ». */
  AVENANTS['c-noah'][0].brut_mensuel_centimes = null;
  AVENANTS['c-noah'][0].net_mensuel_centimes = null;
  window.App.invalider();
  await ouvrirFormat('Une durée libre');
  saisirDuree('01:00');
  await pause(400);
  boutonIssue('Noah', 'Sans solde').click();
  await pause(250);
  contient(issueDe('Noah'), 'la retenue ne peut pas être chiffrée',
    'C2 : la phrase existe enfin — elle était structurellement inatteignable');
  absent(issueDe('Noah'), '− 0,00 €', 'C2 : et le zéro crédible et faux a disparu');
  AVENANTS['c-noah'][0].brut_mensuel_centimes = 140400;
  AVENANTS['c-noah'][0].net_mensuel_centimes = 107100;

  /* ==================================================================== */
  /* CORRECTION B2 — LE CONGÉ POSÉ EXISTE DANS L'ESPACE ENFANT            */
  /* ==================================================================== */
  console.log('\n--- B2 : le congé posé se voit, et ne s’écrase pas ---');

  window.App.invalider();
  window.App.aller('enfant', { contratId: 'c-tom', annee: 2026, mois: 10 });
  await pause(700);

  var case8 = Array.prototype.filter.call(
    corps.querySelectorAll('table.cal td'), function (td) {
      return txt(td.querySelector('.num')) === '8';
    })[0];
  assert(!!case8 && !!case8.querySelector('.rp.conge'),
    'B2 : le calendrier porte un repère sur la journée du congé');
  assert(String(case8.getAttribute('aria-description') || '')
    .indexOf('congé posé') !== -1,
    'B2 : et il est annoncé aux lecteurs d’écran');

  case8.click();
  await pause(300);
  contient(sheet, 'Un congé de 1h34 est posé ce jour-là',
    'B2 : la feuille du jour NOMME le congé');
  contient(sheet, 'Déduit de votre récupération', 'B2 : et dit d’où il sort');
  contient(sheet, 'La journée reste travaillée',
    'B2 : elle rappelle que l’entretien reste dû');
  absent(sheet, 'Que s’est-il passé ce jour-là ?',
    'B2 : aucune déclaration d’horaire n’est proposée — elle écraserait le congé');
  absent(sheet, 'Retirer ce que j’avais déclaré',
    'B2 : et le bouton qui l’effaçait sans un mot a disparu');
  assert(!!parTexte(sheet, 'button', 'Ouvrir « Mes congés »'),
    'B2 : la feuille renvoie là où le congé se retire');

  console.log('\n' + (echecs ? echecs + ' échec(s).' : 'Tout est conforme.'));
  process.exit(echecs ? 1 : 0);
})().catch(function (e) {
  console.error('Erreur pendant le parcours : ' + (e && e.stack || e));
  process.exit(1);
});
