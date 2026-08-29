/* ============================================================================
   Test de fumée — LOT 31, UNE PÉRIODE DE CONGÉ NE PEUT PLUS DISPARAÎTRE EN
   SILENCE.

   « Je ne veux pas que tu corriges seulement pour ce cas-là, je veux que le
     problème ne se représente plus. » (Adrien, 28 août 2026)

   Ce fichier monte le vrai `index.html` et rejoue les quatre gestes du §5.2 :

     A1  le récapitulatif du mois AFFICHE l'encart : la période, ce qu'elle
         demandait, et le fait qu'aucune journée de congé n'existe sur ces
         dates ;
     A2  la CLÔTURE EST REFUSÉE tant qu'elle subsiste — le bouton n'est pas là ;
     A3  l'ACCUEIL compte le mois dans « Aujourd'hui », et la carte mène au
         récapitulatif ;
     A4  « Retirer cette période » supprime l'imputation, ET RIEN D'AUTRE
         (aucune journée écrite, aucune journée retirée), puis la clôture se
         débloque.

   Décor : Léa, contrat en cours ; mai 2026 ouvert ; on est le 1er juin 2026.
   Une ligne `imputation_conge` du 4 au 7 mai, 4 jours sur les congés payés —
   et AUCUNE journée `conge_maria` en face. Valeurs FICTIVES (dépôt public).

   Lancement : node test/lot31-ecrans.smoke.js
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
global.MutationObserver = dom.window.MutationObserver;

var echecs = 0;
function assert(cond, msg) {
  if (!cond) { echecs++; console.error('FAIL ' + msg); } else { console.log('ok   ' + msg); }
}
function egal(obtenu, attendu, msg) {
  assert(obtenu === attendu, msg + ' (attendu ' + JSON.stringify(attendu) +
    ', obtenu ' + JSON.stringify(obtenu) + ')');
}
function pause(ms) { return new Promise(function (r) { setTimeout(r, ms || 40); }); }
function txt(el) { return el ? String(el.textContent).replace(/[  ]/g, ' ') : ''; }
function boutonExact(racineEl, libelle) {
  return Array.prototype.filter.call(racineEl.querySelectorAll('button'), function (e) {
    return txt(e).trim() === libelle;
  })[0] || null;
}
function boutonContenant(racineEl, morceau) {
  return Array.prototype.filter.call(racineEl.querySelectorAll('button'), function (e) {
    return txt(e).indexOf(morceau) !== -1;
  })[0] || null;
}
function contient(el, morceau, msg) {
  var ok = txt(el).indexOf(morceau) !== -1;
  assert(ok, ok ? msg : msg + ' — « ' + morceau + ' » introuvable dans : ' +
    txt(el).slice(0, 400));
}
function absent(el, morceau, msg) {
  var ok = txt(el).indexOf(morceau) === -1;
  assert(ok, ok ? msg : msg + ' — « ' + morceau + ' » ne devrait pas être là');
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

/* --- Décor -------------------------------------------------------------- */
var LEA = {
  id: 'c-lea', prenom_enfant: 'Léa', famille_id: 'f1',
  famille: { id: 'f1', nom: 'Papillon' }, date_debut: '2025-09-01', date_fin: null,
  minutes_contractuelles: 540, minutes_sup_jour: 30, minutes_par_jour_conge: 540,
  entretien_centimes_jour: 500, jours_planning: [1, 2, 3, 4, 5],
  heure_arrivee: '08:30:00', heure_depart: '17:30:00', statut: 'actif',
  sup_dues_si_enfant_absent: true, ordre_imputation: 'cp_puis_sup', archive: false,
  nom: null, genre: 'f', couleur: null, photo: null
};
var AVENANTS = [Decor.avenantDe(LEA, { id: 's1', date_effet: '2025-09-01',
  brut_mensuel_centimes: 137289, net_mensuel_centimes: 107250 })];
AVENANTS[0].numero = 1;

/* L'ORPHELINE. Du lundi 4 au jeudi 7 mai 2026 : quatre jours ouvrables,
   quatre jours posés sur les congés payés — et pas une journée `conge_maria`
   dans le calendrier. C'est exactement la forme du 4-7 mai de Gabrielle. */
var ORPHELINE = {
  id: 'imp-orpheline', contrat_id: 'c-lea',
  date_debut: '2026-05-04', date_fin: '2026-05-07',
  jours_ouvrables: 4, jours_sur_cp: 4, jours_sur_sup: 0, jours_sans_solde: 0
};

var imputations = [ORPHELINE];
var journees = {};
var appels = { supprimees: [], journeesEcrites: [], journeesSupprimees: [], cloture: [] };
var echecSuppression = false;

function cle(a, m) { return a + '-' + String(m).padStart(2, '0'); }

var DB = {
  getSession: function () { return Promise.resolve({ user: { id: 'u1', email: 'maria@exemple.test' } }); },
  onAuthChange: function () {},
  signOut: function () { return Promise.resolve(true); },
  getEmettrice: function () { return Promise.resolve({ nom: 'Maria' }); },
  enregistrerEmettrice: function (nom) { return Promise.resolve({ nom: nom }); },
  getPreferenceRappel: function () { return Promise.resolve(null); },
  listContratsActifs: function () { return Promise.resolve([LEA]); },
  listContratsTous: function () { return Promise.resolve([LEA]); },
  listContratsPourMois: function () { return Promise.resolve([LEA]); },
  listContratsPourPeriode: function () { return Promise.resolve([LEA]); },
  listFamilles: function () { return Promise.resolve([LEA.famille]); },
  listFamillesToutes: function () { return Promise.resolve([LEA.famille]); },
  listFamillesAvecContrats: function () {
    return Promise.resolve([{ id: 'f1', nom: 'Papillon', archive: false, contrats: [LEA] }]);
  },
  contratEstVierge: function () { return Promise.resolve(false); },
  getAvenants: function () { return Promise.resolve(AVENANTS.slice()); },
  ajouterAvenant: function () { return Promise.resolve(AVENANTS[0]); },
  majAvenant: function (id, champs) { return Promise.resolve(champs); },
  supprimerAvenant: function () { return Promise.resolve(true); },
  getCompteurInitial: function (id) {
    return Promise.resolve({ contrat_id: id, date_reference: '2025-09-01',
      minutes_sup: 0, minutes_cp_acquis: 16200, minutes_cp_pris: 0 });
  },
  getJourneesMois: function (id, a, m) {
    var out = {};
    Object.keys(journees).forEach(function (j) { if (j.slice(0, 7) === cle(a, m)) out[j] = journees[j]; });
    return Promise.resolve(out);
  },
  getJourneesPeriode: function (id, d, f) {
    var parMois = {};
    Object.keys(journees).forEach(function (j) {
      if (j < d || j > f) return;
      var k = j.slice(0, 7);
      if (!parMois[k]) parMois[k] = {};
      parMois[k][j] = journees[j];
    });
    return Promise.resolve(parMois);
  },
  listImputations: function () { return Promise.resolve(imputations.slice()); },
  listImputationsPourMois: function () { return Promise.resolve(imputations.slice()); },
  supprimerImputation: function (id) {
    if (echecSuppression) return Promise.reject(new Error('Failed to fetch'));
    appels.supprimees.push(id);
    imputations = imputations.filter(function (i) { return i.id !== id; });
    return Promise.resolve(true);
  },
  majVentilationImputation: function (id, v) { return Promise.resolve(v); },
  listSamedisConge: function () { return Promise.resolve([]); },
  compterSamedisAnnee: function () { return Promise.resolve(0); },
  getNoteMensuelle: function () { return Promise.resolve(null); },
  enregistrerNoteMensuelle: function (c, a, m, t) { return Promise.resolve({ texte: t }); },
  listPeriodesFamiliarisation: function () { return Promise.resolve([]); },
  listPeriodesFamiliarisationContrat: function () { return Promise.resolve([]); },
  listRecapsPeriode: function () { return Promise.resolve([]); },
  listRecapsContrat: function () { return Promise.resolve([]); },
  getRecap: function () { return Promise.resolve(null); },
  enregistrerJournee: function (l) {
    appels.journeesEcrites.push(l); journees[l.jour] = l; return Promise.resolve(l);
  },
  supprimerJournee: function (id, j) {
    appels.journeesSupprimees.push(j); delete journees[j]; return Promise.resolve(true);
  },
  supprimerJournees: function (id, jours) {
    jours.forEach(function (j) { appels.journeesSupprimees.push(j); delete journees[j]; });
    return Promise.resolve(true);
  },
  marquerJournees: function (id, jours, type) {
    jours.forEach(function (j) { appels.journeesEcrites.push({ jour: j, type: type }); journees[j] = { jour: j, type: type }; });
    return Promise.resolve([]);
  },
  poserAbsenceMaria: function () { return Promise.resolve([]); },
  retirerAbsenceMaria: function () { return Promise.resolve(true); },
  archiverContrat: function () { return Promise.resolve(true); },
  desarchiverContrat: function () { return Promise.resolve(true); },
  cloturerRecap: function (id, a, m, d) { appels.cloture.push({ annee: a, mois: m }); return Promise.resolve({ id: 'r1', statut: 'fige' }); },
  rouvrirRecap: function () { return Promise.resolve(null); },
  recloturerRecap: function () { return Promise.resolve(null); },
  noterMotifRecap: function () { return Promise.resolve(null); },
  listEvenementsRecap: function () { return Promise.resolve([]); },
  marquerTransmis: function () { return Promise.resolve(null); }
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

window.App.moisCourant = function () { return { annee: 2026, mois: 6 }; };
window.App.aujourdhui = function () { return '2026-06-01'; };

var corps = document.getElementById('corps');
var sheet = document.getElementById('sheet');

async function ouvrirDocument(a, m) {
  window.App.invalider();
  window.App.aller('document', { contratId: 'c-lea', annee: a, mois: m });
  await pause(400);
}
async function ouvrirAccueil() {
  window.App.invalider();
  window.App.aller('accueil', {});
  await pause(500);
}

(async function () {
  document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  await pause(400);

  /* ==================================================================== */
  /* Le moteur, d'abord : le maillon du mois PORTE l'orpheline.           */
  /* ==================================================================== */
  console.log('\n--- La chaîne transporte (§3.2) ---');
  var serie = await window.App.serie(LEA, { annee: 2026, mois: 5 });
  var mai = window.App.moisDe(serie, 2026, 5);
  egal((mai.imputationsOrphelines || []).length, 1,
    'le maillon de mai porte l’orpheline, comme il porte les écartées');
  egal(mai.imputationsOrphelines[0].id, 'imp-orpheline',
    'et son identifiant, rattaché par la chaîne — sans lui, rien à retirer');
  egal(mai.imputationsOrphelines[0].joursSurCp, 4,
    'avec la ventilation qu’elle demandait');
  var avril = window.App.moisDe(serie, 2026, 4);
  assert(!!avril, 'le décor doit bien rejouer avril');
  egal((avril.imputationsOrphelines || []).length, 0,
    'et un mois qui n’en porte pas a bien une liste VIDE');

  /* ==================================================================== */
  /* A1 — LE RÉCAPITULATIF DU MOIS LE DIT                                 */
  /* ==================================================================== */
  console.log('\n--- A1 : l’encart du récapitulatif ---');
  await ouvrirDocument(2026, 5);
  contient(corps, 'Une période de congé n’a plus aucune journée',
    'A1 : l’encart est là');
  contient(corps, 'Du 4 au 7 mai', 'A1 : et il NOMME la période');
  contient(corps, 'vous aviez réparti 4 jours sur vos congés payés',
    'A1 : et ce qu’elle demandait');
  contient(corps, 'aucune journée de congé n’existe sur ces dates',
    'A1 : et pourquoi elle ne s’applique pas');

  /* ==================================================================== */
  /* A2 — LA CLÔTURE EST REFUSÉE                                          */
  /* ==================================================================== */
  console.log('\n--- A2 : la clôture est bloquée ---');
  assert(!boutonExact(corps, 'Clôturer le mois'),
    'A2 : le bouton « Clôturer le mois » n’est pas offert');
  contient(corps, 'ne peut pas être clôturé tant qu’elle subsiste',
    'A2 : et l’écran dit pourquoi');
  egal(appels.cloture.length, 0, 'A2 : rien n’a été figé');

  /* ==================================================================== */
  /* A3 — L'ACCUEIL COMPTE LE MOIS                                        */
  /* ==================================================================== */
  console.log('\n--- A3 : l’accueil, « Aujourd’hui » ---');
  await ouvrirAccueil();
  contient(corps, 'une période de congé n’a plus aucune journée',
    'A3 : une entrée pour le mois concerné');
  contient(corps, 'Mai —', 'A3 : et elle nomme le mois');
  contient(corps, 'Chez Léa', 'A3 : et l’enfant');
  var carte = boutonContenant(corps, 'plus aucune journée');
  assert(!!carte, 'A3 : la carte est touchable');
  carte.click();
  await pause(450);
  contient(corps, 'Une période de congé n’a plus aucune journée',
    'A3 : et elle mène AU RÉCAPITULATIF, là où le geste se fait');

  /* ==================================================================== */
  /* A4 — LE RETRAIT, ET RIEN D'AUTRE                                     */
  /* ==================================================================== */
  console.log('\n--- A4 : « Retirer cette période » ---');
  var bRetirer = boutonExact(corps, 'Retirer cette période');
  assert(!!bRetirer, 'A4 : le bouton est là');
  bRetirer.click();
  await pause(200);
  contient(sheet, 'Retirer cette période ?', 'A4 : une confirmation s’ouvre');
  contient(sheet, 'Seule cette répartition est supprimée',
    'A4 : et elle dit que RIEN d’autre ne bouge');
  contient(sheet, 'Mes congés', 'A4 : et où reposer le congé ensuite');
  egal(appels.supprimees.length, 0,
    'A4 : rien n’est supprimé tant que Maria n’a pas confirmé');

  boutonExact(sheet, 'Retirer cette période').click();
  await pause(600);
  egal(appels.supprimees.length, 1, 'A4 : un appui, une suppression');
  egal(appels.supprimees[0], 'imp-orpheline', 'A4 : celle-là, et pas une autre');
  egal(appels.journeesEcrites.length, 0,
    'A4 : AUCUNE journée n’est devinée — on ne décide pas à la place de Maria');
  egal(appels.journeesSupprimees.length, 0, 'A4 : et aucune journée n’est retirée');

  /* --- et la clôture se débloque --- */
  await ouvrirDocument(2026, 5);
  absent(corps, 'n’a plus aucune journée', 'A4 : l’encart a disparu');
  assert(!!boutonExact(corps, 'Clôturer le mois'),
    'A4 : et la clôture est de nouveau offerte');

  /* ==================================================================== */
  /* L'ÉCHEC SE DIT — et rien n'est perdu                                 */
  /* ==================================================================== */
  console.log('\n--- L’échec du retrait se dit ---');
  imputations = [ORPHELINE];
  echecSuppression = true;
  await ouvrirDocument(2026, 5);
  boutonExact(corps, 'Retirer cette période').click();
  await pause(200);
  boutonExact(sheet, 'Retirer cette période').click();
  await pause(400);
  contient(document.getElementById('toast'), 'Le retrait n’a pas abouti',
    'l’échec est dit, il n’est pas avalé');
  egal(imputations.length, 1, 'et la période est toujours là');

  console.log(echecs ? '\n' + echecs + ' échec(s).' : '\nTout est conforme.');
  process.exit(echecs ? 1 : 0);
})().catch(function (e) {
  console.error(e && e.stack || e);
  process.exit(1);
});
