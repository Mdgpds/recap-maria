/* ============================================================================
   Test de fumée — lot 13 : rouvrir un mois clôturé (cas P1 à P7).

   C'est le seul lot du projet qui affaiblit délibérément une garantie. Ce qui
   protège Maria n'est plus l'impossibilité de modifier, mais la TRACE de
   chaque modification et l'affichage des écarts. Ces deux garanties-là sont
   dans l'interface : elles méritent donc d'être jouées, pas seulement relues.

   Chaque scénario est joué contre le VRAI index.html, le VRAI moteur et la
   VRAIE chaîne des mois ; seul l'accès aux données est simulé.

   Lancement : node test/lot13-reouverture.smoke.js
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

/* --- Données simulées (valeurs FICTIVES : le dépôt est public) ----------- */
var LEA = {
  id: 'c-lea', prenom_enfant: 'Léa', famille_id: 'f1',
  famille: { id: 'f1', nom: 'Papillon' }, date_debut: '2025-09-01', date_fin: null,
  minutes_contractuelles: 540, minutes_sup_jour: 30, minutes_par_jour_conge: 540,
  entretien_centimes_jour: 500, jours_planning: [1, 2, 3, 4, 5],
  heure_arrivee: '08:30:00', heure_depart: '18:00:00', statut: 'actif',
  sup_dues_si_enfant_absent: true, ordre_imputation: 'cp_puis_sup', archive: false
};
var SALAIRE = { id: 's1', contrat_id: 'c-lea', date_effet: '2025-09-01',
  brut_mensuel_centimes: 137289, net_mensuel_centimes: 107250 };

/* L'instantané DÉJÀ ÉTABLI de mai 2026. Ses valeurs sont volontairement
   différentes de ce que le moteur recalculerait : c'est ainsi qu'on simule
   « une journée a été corrigée » et « le barème a changé » (P4 et P5). */
/* LOT 17 — les congés payés sont en MINUTES (§17.6). L'instantané porte donc
   `uniteCp: 'minutes'`, le marqueur que pose le moteur et que
   `ChaineMois.instantaneEnMinutes` cherche pour reconnaître un instantané
   ancien. Les quantités ne changent pas : 25 dixièmes = 1350 minutes,
   225 dixièmes = 12 150 minutes, au facteur `minutes_par_jour_conge / 10`. */
var SNAPSHOT_ORIGINE = {
  joursPresence: 20, entretienCentimes: 10000,
  salaireNetCentimes: 107250, totalAVerserCentimes: 117250,
  minutesSupAcquises: 600, joursCongesDecomptes: 0,
  minutesCpAcquis: 1350, retenueSansSoldeCentimes: 0,
  salaireBrutCentimes: 137289, brutDuCentimes: 137289,
  uniteCp: 'minutes',
  compteurSortie: { minutesSup: 600, minutesCpAcquis: 12150, minutesCpPris: 0 },
  imputation: { joursSurCp: 0, minutesCpConsommees: 0, joursSurSup: 0, minutesSupConsommees: 0, joursSansSolde: 0 },
  prenomEnfant: 'Léa', nomFamille: 'Papillon',
  salaireDateEffet: '2025-09-01', joursConge: []
};

var EVENEMENTS = [
  { id: 'e1', type: 'cloture',      survenu_le: '2026-05-31T18:42:00Z', motif: null },
  { id: 'e2', type: 'transmission', survenu_le: '2026-05-31T18:45:00Z', motif: null },
  { id: 'e3', type: 'reouverture',  survenu_le: '2026-06-04T09:12:00Z', motif: 'Oubli d’une absence' },
  { id: 'e4', type: 'cloture',      survenu_le: '2026-06-04T09:20:00Z', motif: null }
];

var RECAP = null;
function recapFige(transmisLe) {
  return { id: 'r-lea', contrat_id: 'c-lea', annee: 2026, mois: 5, statut: 'fige',
    donnees: SNAPSHOT_ORIGINE, fige_le: '2026-05-31T18:42:00Z',
    transmis_le: transmisLe || null };
}
function recapRouvert(transmisLe) {
  return { id: 'r-lea', contrat_id: 'c-lea', annee: 2026, mois: 5, statut: 'brouillon',
    donnees: SNAPSHOT_ORIGINE, fige_le: null, transmis_le: transmisLe || null };
}

var appels = { rouvrir: [], recloturer: [], evenements: 0 };
var etatTest = { reouvertureCassee: false };


var TOUS_CONTRATS = [LEA];

/* LOT 17 §17.2 — le contrat par son identifiant. `getAvenants` en a besoin
   pour reprendre les réglages du décor dans l'avenant : le moteur ne les lit
   plus sur `contrat`. */
function contratDe(id) {
  return TOUS_CONTRATS.filter(function (c) { return c.id === id; })[0] || TOUS_CONTRATS[0];
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
  listContratsActifs: function () { return Promise.resolve([LEA]); },
  listContratsTous: function () { return Promise.resolve([LEA]); },
  listContratsPourMois: function () { return Promise.resolve([LEA]); },
  listContratsPourPeriode: function () { return Promise.resolve([LEA]); },
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
    return Promise.resolve(Decor.avenantsDe(contratDe(id), [SALAIRE]));
  },
  getCompteurInitial: function (id) {
    return Promise.resolve(Decor.compteurEnMinutes({ contrat_id: id,
      date_reference: '2026-05-01',
      minutes_sup: 0, dixiemes_cp_acquis: 200, dixiemes_cp_pris: 0 }));
  },
  getJourneesMois: function () { return Promise.resolve({}); },
  listImputationsPourMois: function () { return Promise.resolve([]); },
  getNoteMensuelle: function () { return Promise.resolve(null); },
    enregistrerNoteMensuelle: function (c, a, m, t) { return Promise.resolve({ texte: t }); },
  getJourneesPeriode: function () { return Promise.resolve({ '2026-05': {} }); },
  listRecapsPeriode: function () { return Promise.resolve(RECAP ? [RECAP] : []); },
  listRecapsContrat: function () { return Promise.resolve(RECAP ? [RECAP] : []); },
  getRecap: function (id, a, m) {
    return Promise.resolve((id === 'c-lea' && a === 2026 && m === 5) ? RECAP : null);
  },
  enregistrerJournee: function (l) { return Promise.resolve(l); },
  supprimerJournee: function () { return Promise.resolve(true); },
  poserAbsenceMaria: function () { return Promise.resolve([]); },
  retirerAbsenceMaria: function () { return Promise.resolve(true); },

  rouvrirRecap: function (id, a, m, motif) {
    if (etatTest.reouvertureCassee) return Promise.reject(new Error('Failed to fetch'));
    appels.rouvrir.push({ contratId: id, annee: a, mois: m, motif: motif });
    var transmis = RECAP ? RECAP.transmis_le : null;
    RECAP = recapRouvert(transmis);
    return Promise.resolve(RECAP);
  },
  recloturerRecap: function (id, a, m, donnees) {
    appels.recloturer.push({ contratId: id, annee: a, mois: m, donnees: donnees });
    var transmis = RECAP ? RECAP.transmis_le : null;
    RECAP = recapFige(transmis);
    RECAP.donnees = donnees;
    return Promise.resolve(RECAP);
  },
  listEvenementsRecap: function () {
    appels.evenements++;
    return Promise.resolve(EVENEMENTS);
  },
  marquerTransmis: function () { return Promise.resolve(RECAP); },
  estMoisCloture: function () { return Promise.resolve(!!(RECAP && RECAP.statut === 'fige')); }
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

window.App.moisCourant = function () { return { annee: 2026, mois: 6 }; };
window.App.aujourdhui = function () { return '2026-06-04'; };

var corps = document.getElementById('corps');
var sheet = document.getElementById('sheet');
var toast = document.getElementById('toast');

async function ouvrirDocumentDeMai() {
  window.App.invalider();
  window.App.aller('document', { contratId: 'c-lea', annee: 2026, mois: 5 });
  await pause(200);
}

(async function () {
  document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  await pause(200);

  /* ============ P1 — mois clôturé NON transmis : réouverture ============ */
  RECAP = recapFige(null);
  await ouvrirDocumentDeMai();

  assert(txt(corps).indexOf('Mois clôturé') !== -1, 'P1 : le document porte le bandeau « Mois clôturé »');
  assert(txt(corps).indexOf('ne bougeront plus') !== -1,
    'P1 : le bandeau promet la stabilité des chiffres, pas l’impossibilité de modifier');
  assert(txt(corps).indexOf('transmis à la famille') === -1,
    'P1 : aucune mention de transmission sur un mois non transmis');

  var bRouvrir = parTexte(corps, 'button', 'Rouvrir pour corriger');
  assert(bRouvrir !== null, 'P1 : le bandeau propose « Rouvrir pour corriger »');
  assert(parTexte(corps, 'button', 'Voir l’historique de ce mois') !== null,
    'P1 : le bandeau propose l’historique du mois');

  bRouvrir.click();
  await pause(60);
  assert(txt(sheet).indexOf('Rouvrir mai 2026 ?') !== -1, 'P1 : la feuille demande confirmation');
  assert(txt(sheet).indexOf('inscrite dans l’historique') !== -1,
    'P1 : la feuille annonce que la réouverture sera inscrite');
  assert(txt(sheet).indexOf('Si vous modifiez ce mois') === -1,
    'P1 : AUCUN avertissement de transmission sur un mois non transmis');
  assert(txt(sheet).indexOf('Pourquoi ? (facultatif)') !== -1,
    'P1 : le motif est proposé, jamais imposé');

  var champ = sheet.querySelector('input[type="text"]');
  assert(champ !== null, 'P1 : le champ de motif est bien un champ libre');
  champ.value = 'Oubli d’une absence';
  boutonExact(sheet, 'Rouvrir le mois').click();
  await pause(150);

  assert(appels.rouvrir.length === 1, 'P1 : la réouverture appelle rouvrirRecap une fois');
  assert(appels.rouvrir[0].motif === 'Oubli d’une absence', 'P1 : le motif saisi est transmis');
  assert(norme(txt(toast)).indexOf('est rouvert') !== -1, 'P1 : Maria est prévenue que le mois est rouvert');

  /* ============ P3 — « Annuler » juste après la réouverture ============= */
  var bAnnuler = boutonExact(toast, 'Annuler');
  assert(bAnnuler !== null, 'P3 : le message propose « Annuler » (V8-21)');
  bAnnuler.click();
  await pause(150);

  assert(appels.recloturer.length === 1, 'P3 : « Annuler » reclôture le mois');
  assert(appels.recloturer[0].donnees === SNAPSHOT_ORIGINE,
    'P3 : « Annuler » reclôture avec l’instantané D’ORIGINE, sans recalcul');

  /* ============ P2 — mois clôturé ET transmis ============================ */
  RECAP = recapFige('2026-05-31T18:45:00Z');
  await ouvrirDocumentDeMai();

  assert(txt(corps).indexOf('Récapitulatif transmis à la famille le 31 mai 2026') !== -1,
    'P2 : la date de transmission est rappelée sous le bandeau');
  parTexte(corps, 'button', 'Rouvrir pour corriger').click();
  await pause(60);

  assert(txt(sheet).indexOf('Vous avez transmis ce récapitulatif') !== -1,
    'P2 : l’avertissement de transmission s’affiche');
  assert(txt(sheet).indexOf('famille Papillon') !== -1, 'P2 : la famille est nommée');
  assert(txt(sheet).indexOf('31 mai 2026') !== -1, 'P2 : la date de transmission est donnée');
  assert(boutonExact(sheet, 'Rouvrir le mois') !== null,
    'P2 : la réouverture reste POSSIBLE malgré la transmission');

  /* ============ P7 — panne réseau pendant la réouverture ================ */
  etatTest.reouvertureCassee = true;
  var avantRouvrir = appels.rouvrir.length;
  boutonExact(sheet, 'Rouvrir le mois').click();
  await pause(150);

  assert(appels.rouvrir.length === avantRouvrir, 'P7 : rien n’a été écrit');
  assert(norme(txt(toast)).indexOf('Réouverture impossible') !== -1, 'P7 : l’échec est dit');
  assert(norme(txt(toast)).indexOf('vérifiez votre réseau') !== -1,
    'P7 : le message est en français simple, sans texte technique');
  assert(norme(txt(toast)).indexOf('reste clôturé') !== -1, 'P7 : Maria sait où elle en est');
  assert(document.getElementById('sheetwrap').hidden === false,
    'P7 : la feuille reste ouverte, la saisie n’est pas perdue');
  assert(norme(txt(toast)).indexOf('Failed to fetch') === -1,
    'P7 : aucun texte technique n’atteint l’écran');
  etatTest.reouvertureCassee = false;
  window.Kit.fermerFeuille();

  /* ============ P6 — historique d’un mois rouvert deux fois ============= */
  RECAP = recapFige('2026-05-31T18:45:00Z');
  await ouvrirDocumentDeMai();
  parTexte(corps, 'button', 'Voir l’historique de ce mois').click();
  await pause(150);

  assert(appels.evenements > 0, 'P6 : l’historique est lu en base');
  var t = txt(sheet);
  assert(t.indexOf('Clôturé à nouveau') !== -1, 'P6 : la seconde clôture est « Clôturé à nouveau »');
  assert(t.indexOf('Rouvert') !== -1, 'P6 : la réouverture est nommée « Rouvert »');
  assert(t.indexOf('Transmis à la famille') !== -1, 'P6 : la transmission figure dans l’historique');
  assert(t.indexOf('Oubli d’une absence') !== -1, 'P6 : le motif saisi est conservé et affiché');
  assert(t.indexOf('ne peut pas être effacé') !== -1, 'P6 : la phrase permanente figure en bas');
  /* L'ordre d'affichage va du plus récent au plus ancien — et on n'inverse
     qu'une fois : la dernière clôture apparaît AVANT la réouverture. */
  assert(t.indexOf('Clôturé à nouveau') < t.indexOf('Rouvert'),
    'P6 : l’historique se lit du plus récent au plus ancien');
  window.Kit.fermerFeuille();

  /* ==== P4 et P5 — reclôture : les écarts sont montrés avant d’écrire === */
  RECAP = recapRouvert('2026-05-31T18:45:00Z');
  await ouvrirDocumentDeMai();

  var bCloture = parTexte(corps, 'button', 'Clôturer le mois');
  assert(bCloture !== null, 'P4 : un mois rouvert se reclôture depuis le document');
  bCloture.click();
  await pause(60);
  boutonExact(sheet, 'Oui, clôturer le mois').click();
  await pause(120);

  var avantRecloture = appels.recloturer.length;
  assert(txt(sheet).indexOf('Ce qui change par rapport au document déjà établi') !== -1,
    'P4/P5 : l’écran de comparaison s’affiche');
  assert(appels.recloturer.length === avantRecloture,
    'P4/P5 : RIEN n’est écrit avant confirmation');
  assert(txt(sheet).indexOf('Jours de présence') !== -1, 'P4 : l’écart de présence est listé');
  assert(txt(sheet).indexOf('Total à verser') !== -1, 'P5 : l’écart de total est listé');
  assert(txt(sheet).indexOf('reçu l’ancienne version') !== -1,
    'P4/P5 : le rappel de renvoyer le document transmis est présent');
  assert(txt(sheet).indexOf('renvoyer le récapitulatif corrigé') !== -1,
    'P4/P5 : Maria sait quoi faire ensuite');

  boutonExact(sheet, 'Clôturer avec ces valeurs').click();
  await pause(150);
  assert(appels.recloturer.length === avantRecloture + 1,
    'P4/P5 : la reclôture n’écrit qu’APRÈS confirmation');
  assert(appels.recloturer[appels.recloturer.length - 1].donnees.prenomEnfant === 'Léa',
    'P4/P5 : l’instantané réécrit est bien le nouveau calcul');

  /* ==== A4 — reclôture sans aucun écart : aucun écran intermédiaire ===== */
  var dernier = appels.recloturer[appels.recloturer.length - 1].donnees;
  RECAP = recapRouvert(null);
  RECAP.donnees = dernier;            // l'instantané établi = ce qu'on recalcule
  await ouvrirDocumentDeMai();
  var avant2 = appels.recloturer.length;
  parTexte(corps, 'button', 'Clôturer le mois').click();
  await pause(60);
  boutonExact(sheet, 'Oui, clôturer le mois').click();
  await pause(150);
  assert(appels.recloturer.length === avant2 + 1, 'A4 : la reclôture a bien eu lieu');
  assert(txt(sheet).indexOf('Ce qui change') === -1,
    'A4 : aucun écran de comparaison quand rien ne change');

  console.log('');
  if (echecs) { console.error(echecs + ' échec(s).'); process.exit(1); }
  console.log('Tout est conforme.');
})().catch(function (e) {
  console.error('Erreur pendant le parcours : ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});

/* Les quantités portent une espace INSÉCABLE (format.js) : on normalise pour
   pouvoir chercher du texte simple. */
function norme(t) { return t == null ? t : String(t).replace(/ /g, ' '); }
