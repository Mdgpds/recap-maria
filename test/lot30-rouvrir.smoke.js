/* ============================================================================
   Test de fumée — LOT 30, ROUVRIR SANS FRICTION.

   « J'aimerais facilement pouvoir rouvrir un mois qui a été clôturé, je
   trouve que l'app manque de souplesse dans la saisie. » (Adrien)

   Ce fichier monte le vrai `index.html` et rejoue les sept critères du §30.7
   et les cas du §30.8 :

     A1  toucher un jour d'un mois clôturé ouvre la feuille courte ; un appui
         rouvre le mois ET ouvre la feuille du jour ;
     A2  aucun refus sec : avenant, familiarisation et fin de contrat
         proposent la réouverture et poursuivent le geste ;
     A3  un mois rouvert porte son bandeau et apparaît dans « Aujourd'hui »,
         la pastille le compte ;
     A4  la reclôture affiche les écarts avec l'instantané précédent, et le
         rappel de transmission ;
     A5  chaque réouverture écrit son événement, motif ou non (la base le
         fait ; le décor le simule, et l'écran ne demande plus de motif) ;
     A6  si la lecture des mois clôturés échoue, tout est refusé et dit ;
     A7  aucun mois clôturé ne change sans réouverture explicite.

   Décor : Léa, contrat en cours ; avril 2026 clôturé et transmis ; on est le
   25 mai 2026. Valeurs FICTIVES (dépôt public).

   Lancement : node test/lot30-rouvrir.smoke.js
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
function txt(el) { return el ? String(el.textContent).replace(/[\u00a0\u202f]/g, ' ') : ''; }
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
function boutonContenant(racineEl, morceau) {
  return Array.prototype.filter.call(racineEl.querySelectorAll('button'), function (e) {
    return txt(e).indexOf(morceau) !== -1;
  })[0] || null;
}
function contient(el, morceau, msg) {
  var ok = txt(el).indexOf(morceau) !== -1;
  assert(ok, ok ? msg : msg + ' — « ' + morceau + ' » introuvable dans : ' + txt(el).slice(0, 300));
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

/* L'instantané REMIS d'avril 2026 : 21 jours de présence (les 21 jours ouvrés
   d'avril, lundi de Pâques exclu), tel que la famille l'a reçu — AVANT que
   Maria n'y corrige une absence. */
var SNAPSHOT_AVRIL = {
  joursPresence: 21, entretienCentimes: 10500, joursSansEntretien: 0,
  salaireNetCentimes: 107250, salaireNetProrataCentimes: 107250,
  salaireBrutCentimes: 137289, salaireBrutProrataCentimes: 137289,
  brutDuCentimes: 137289, totalAVerserCentimes: 117750,
  minutesSupAcquises: 630, minutesSupBase: 630, minutesSupAjoutees: 0, minutesSupRenoncees: 0,
  minutesEcartRecuperation: 0, minutesEcartSurCp: 0, minutesEcartSansSolde: 0, ecartsDeclares: [],
  joursCongesDecomptes: 0, minutesCpAcquis: 1350, retenueSansSoldeCentimes: 0,
  uniteCp: 'minutes',
  compteurSortie: { minutesSup: 630, minutesCpAcquis: 12150, minutesCpPris: 0 },
  imputation: { joursSurCp: 0, minutesCpConsommees: 0, joursSurSup: 0, minutesSupConsommees: 0, joursSansSolde: 0 },
  imputationsAppliquees: [], prorata: { joursCouverts: 22, joursDuMois: 22, applique: false },
  familiarisation: { actif: false, joursDeLaPeriode: 0, joursDeclares: 0, minutesDeclarees: 0,
    joursAvecEntretien: 0, entretienCentimes: 0, brutCentimes: 0, netCentimes: 0,
    joursIgnores: [], joursSansEntretien: 0, jours: [] },
  prenomEnfant: 'Léa', nomFamille: 'Papillon', salaireDateEffet: '2025-09-01', joursConge: []
};

/* La base simulée des récapitulatifs : un état par mois, et l'historique
   que la base écrit elle-même (trigger de la migration 006). */
var recaps = {};
var evenements = {};
var appels = { rouvrir: [], recloturer: [], journees: [], groupes: [], avenants: [], periodes: [],
  archiver: [], motifs: [] };
var panne = { recaps: false };
function cle(a, m) { return a + '-' + String(m).padStart(2, '0'); }
function poserFige(a, m, transmisLe) {
  var id = 'r-' + cle(a, m);
  recaps[cle(a, m)] = { id: id, contrat_id: 'c-lea', annee: a, mois: m, statut: 'fige',
    donnees: SNAPSHOT_AVRIL, fige_le: '2026-05-02T18:42:00Z', transmis_le: transmisLe || null,
    audit_note: null };
  evenements[id] = [{ id: 'e1', type: 'cloture', survenu_le: '2026-05-02T18:42:00Z', motif: null }];
  if (transmisLe) evenements[id].push({ id: 'e2', type: 'transmission', survenu_le: transmisLe, motif: null });
}
function listeRecaps() {
  if (panne.recaps) return Promise.reject(new Error('Failed to fetch'));
  return Promise.resolve(Object.keys(recaps).map(function (k) { return recaps[k]; }));
}

var journees = {};
var periodes = [];
var contratCourant = LEA;

var DB = {
  getSession: function () { return Promise.resolve({ user: { id: 'u1', email: 'maria@exemple.test' } }); },
  onAuthChange: function () {},
  signOut: function () { return Promise.resolve(true); },
  getEmettrice: function () { return Promise.resolve({ nom: 'Maria' }); },
  enregistrerEmettrice: function (nom) { return Promise.resolve({ nom: nom }); },
  getPreferenceRappel: function () { return Promise.resolve(null); },
  listContratsActifs: function () { return Promise.resolve(contratCourant.archive ? [] : [contratCourant]); },
  listContratsTous: function () { return Promise.resolve([contratCourant]); },
  listContratsPourMois: function () { return Promise.resolve([contratCourant]); },
  listContratsPourPeriode: function () { return Promise.resolve([contratCourant]); },
  listFamilles: function () { return Promise.resolve([LEA.famille]); },
  listFamillesToutes: function () { return Promise.resolve([LEA.famille]); },
  listFamillesAvecContrats: function () {
    return Promise.resolve([{ id: 'f1', nom: 'Papillon', archive: false, contrats: [contratCourant] }]);
  },
  contratEstVierge: function () { return Promise.resolve(false); },
  getAvenants: function () { return Promise.resolve(AVENANTS.slice()); },
  ajouterAvenant: function (id, champs) {
    appels.avenants.push(champs);
    var a = Decor.avenantDe(LEA, champs); a.id = 'a-neuf'; a.numero = AVENANTS.length + 1;
    AVENANTS.push(a);
    return Promise.resolve(a);
  },
  majAvenant: function (id, champs) { appels.avenants.push(champs); return Promise.resolve(champs); },
  supprimerAvenant: function () { return Promise.resolve(true); },
  getCompteurInitial: function (id) {
    return Promise.resolve({ contrat_id: id, date_reference: '2026-04-01',
      minutes_sup: 0, minutes_cp_acquis: 10800, minutes_cp_pris: 0 });
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
  listImputations: function () { return Promise.resolve([]); },
  listImputationsPourMois: function () { return Promise.resolve([]); },
  listSamedisConge: function () { return Promise.resolve([]); },
  compterSamedisAnnee: function () { return Promise.resolve(0); },
  getNoteMensuelle: function () { return Promise.resolve(null); },
  enregistrerNoteMensuelle: function (c, a, m, t) { return Promise.resolve({ texte: t }); },
  listPeriodesFamiliarisation: function () { return Promise.resolve(periodes.slice()); },
  listPeriodesFamiliarisationContrat: function () { return Promise.resolve(periodes.slice()); },
  enregistrerPeriodeFamiliarisation: function (p) {
    appels.periodes.push(p); p.id = 'p1'; periodes.push(p); return Promise.resolve(p);
  },
  majPeriodeFamiliarisation: function (id, b) {
    appels.periodes.push(b); periodes[0].date_debut = b.date_debut; periodes[0].date_fin = b.date_fin;
    return Promise.resolve(b);
  },
  supprimerPeriodeFamiliarisation: function () { periodes = []; return Promise.resolve(true); },
  listRecapsPeriode: listeRecaps,
  listRecapsContrat: listeRecaps,
  getRecap: function (id, a, m) {
    if (panne.recaps) return Promise.reject(new Error('Failed to fetch'));
    return Promise.resolve(recaps[cle(a, m)] || null);
  },
  enregistrerJournee: function (l) {
    appels.journees.push(l);
    journees[l.jour] = l;
    return Promise.resolve(l);
  },
  supprimerJournee: function (id, j) { delete journees[j]; return Promise.resolve(true); },
  supprimerJournees: function (id, jours) { jours.forEach(function (j) { delete journees[j]; }); return Promise.resolve(true); },
  marquerJournees: function (id, jours, type) {
    appels.groupes.push({ jours: jours, type: type });
    jours.forEach(function (j) { journees[j] = { jour: j, type: type }; });
    return Promise.resolve([]);
  },
  poserAbsenceMaria: function () { return Promise.resolve([]); },
  retirerAbsenceMaria: function () { return Promise.resolve(true); },
  archiverContrat: function (id, dateFin) {
    appels.archiver.push({ id: id, dateFin: dateFin });
    contratCourant = JSON.parse(JSON.stringify(LEA));
    contratCourant.archive = true; contratCourant.date_fin = dateFin;
    return Promise.resolve(true);
  },
  desarchiverContrat: function () { return Promise.resolve(true); },
  rouvrirRecap: function (id, a, m, motif) {
    var r = recaps[cle(a, m)];
    if (!r || r.statut !== 'fige') return Promise.resolve(null);
    appels.rouvrir.push({ annee: a, mois: m, motif: motif });
    r.statut = 'brouillon'; r.fige_le = null;
    evenements[r.id].push({ id: 'e' + evenements[r.id].length, type: 'reouverture',
      survenu_le: '2026-05-25T10:00:00Z', motif: motif || null });
    return Promise.resolve(r);
  },
  recloturerRecap: function (id, a, m, donnees) {
    appels.recloturer.push({ annee: a, mois: m, donnees: donnees });
    var r = recaps[cle(a, m)] || { id: 'r-' + cle(a, m), contrat_id: id, annee: a, mois: m, transmis_le: null, audit_note: null };
    r.statut = 'fige'; r.fige_le = '2026-05-25T11:00:00Z'; r.donnees = donnees;
    recaps[cle(a, m)] = r;
    evenements[r.id] = evenements[r.id] || [];
    evenements[r.id].push({ id: 'ec', type: 'cloture', survenu_le: r.fige_le, motif: null });
    return Promise.resolve(r);
  },
  noterMotifRecap: function (id, a, m, motif) {
    appels.motifs.push(motif);
    recaps[cle(a, m)].audit_note = motif;
    return Promise.resolve(recaps[cle(a, m)]);
  },
  listEvenementsRecap: function (id) { return Promise.resolve(evenements[id] || []); },
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

window.App.moisCourant = function () { return { annee: 2026, mois: 5 }; };
window.App.aujourdhui = function () { return '2026-05-25'; };

var corps = document.getElementById('corps');
var sheet = document.getElementById('sheet');
var sheetwrap = document.getElementById('sheetwrap');
var toast = document.getElementById('toast');

function celluleDu(numero) {
  return Array.prototype.filter.call(corps.querySelectorAll('table.cal td'), function (td) {
    return txt(td.querySelector('.num')) === String(numero);
  })[0] || null;
}
async function ouvrirEnfant(a, m) {
  window.App.invalider();
  window.App.aller('enfant', { contratId: 'c-lea', annee: a, mois: m });
  await pause(350);
}

(async function () {
  document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  await pause(300);

  /* ==================================================================== */
  /* A1 — TOUCHER UN JOUR D'UN MOIS CLÔTURÉ                               */
  /* ==================================================================== */
  console.log('\n--- A1 : rouvrir depuis le calendrier ---');
  poserFige(2026, 4, '2026-05-03T09:00:00Z');
  await ouvrirEnfant(2026, 4);
  contient(corps, 'Mois clôturé', 'avril est clôturé');
  var td14 = celluleDu(14);
  assert(!!td14 && td14.getAttribute('role') === 'button', 'A1 : la case du 14 est touchable');
  td14.click();
  await pause(200);
  contient(sheet, 'Ce mois est clôturé', 'A1 : la feuille courte s’ouvre');
  contient(sheet, 'Le rouvrir pour corriger le mardi 14 avril ?', 'A1 : et nomme le jour');
  contient(sheet, 'trace définitive dans l’historique', 'A1 : la trace est annoncée');
  contient(sheet, 'déjà été transmis', 'A1 : et la transmission à la famille aussi');
  assert(!sheet.querySelector('input'), 'A1 : aucun motif n’est demandé (§30.2)');
  egal(appels.rouvrir.length, 0, 'A7 : rien n’est rouvert tant que Maria n’a pas appuyé');
  var bRouvrir = boutonExact(sheet, 'Rouvrir et corriger ce jour');
  assert(!!bRouvrir, 'A1 : le bouton « Rouvrir et corriger ce jour »');
  bRouvrir.click();
  await pause(600);
  egal(appels.rouvrir.length, 1, 'A1 : un appui, une réouverture');
  egal(appels.rouvrir[0].motif, null, 'A5 : l’événement est écrit sans motif — la base le trace quand même');
  egal(recaps['2026-04'].statut, 'brouillon', 'A1 : le mois est rouvert en base');
  assert(!sheetwrap.hidden, 'A1 : ET la feuille du jour est ouverte');
  contient(sheet, 'Mardi 14 avril', 'A1 : sur le 14 avril, prête');
  assert(!!parTexte(sheet, '.choice', 'Absence de Léa'), 'A1 : avec ses choix de saisie');
  /* Corriger : marquer l'absence, ce qui écrit la journée. */
  parTexte(sheet, '.choice', 'Absence de Léa').click();
  await pause(120);
  boutonExact(sheet, 'Enregistrer').click();
  await pause(400);
  egal(appels.journees.length, 1, 'A1 : la correction est écrite');
  egal(appels.journees[0].jour, '2026-04-14', 'A1 : sur le 14 avril');

  /* --- A3 : le bandeau du mois rouvert, sur l'espace enfant --- */
  console.log('\n--- A3 : le mois rouvert ne s’oublie pas ---');
  await ouvrirEnfant(2026, 4);
  contient(corps, 'Mois rouvert le 25 mai 2026', 'A3 : l’espace enfant dit que le mois est rouvert, et quand');
  contient(corps, 'à clôturer à nouveau', 'A3 : et qu’il attend sa reclôture');

  /* REDESIGN 2A §4.3 — LE BANDEAU D'ETAT, VARIANTE « MOIS ROUVERT ».
     Le §4.3 fixe trois variantes, et une seule est vraie a la fois. Celle-ci
     est la variante AMBRE : il reste quelque chose a finir. Elle porte ses
     deux gestes — reclôturer, et ajouter un motif apres coup. */
  var bandeauR = parTexte(corps, '.warnbox', 'Mois rouvert') ||
                 parTexte(corps, '.enc', 'Mois rouvert');
  assert(!!bandeauR, '§4.3 : le bandeau du mois rouvert est là');
  assert(!!boutonContenant(bandeauR, 'Reclôturer'),
    '§4.3 : et il porte « Reclôturer <mois> »');
  assert(!!boutonContenant(bandeauR, 'motif'),
    '§4.3 : et « Ajouter un motif »');
  /* Les deux AUTRES variantes ne s'affichent pas en meme temps : un ecran qui
     dirait a la fois « clôturé » et « rouvert » ne dirait rien. */
  absent(corps, 'Les journées ne se modifient pas',
    '§4.3 : la variante « mois clôturé » ne s’affiche pas en même temps');
  absent(corps, 'Touchez un jour pour déclarer ce qui sort de l’ordinaire',
    '§4.3 : ni celle du mois ouvert');
  assert(!!celluleDu(15) && celluleDu(15).getAttribute('role') === 'button',
    'A3 : ses journées se corrigent librement, sans nouvelle réouverture');
  celluleDu(15).click();
  await pause(150);
  absent(sheet, 'Ce mois est clôturé', 'A3 : plus de feuille de réouverture sur un mois rouvert');
  window.Kit.fermerFeuille();

  /* --- A3 : le document porte le bandeau complet et le bouton --- */
  window.App.invalider();
  window.App.aller('document', { contratId: 'c-lea', annee: 2026, mois: 4 });
  await pause(400);
  contient(corps, 'Mois rouvert le 25 mai 2026 — à clôturer à nouveau', 'A3 : le bandeau du document');
  contient(corps, 'transmis à la famille le 3 mai 2026', 'A3 : il rappelle la transmission');
  assert(!!boutonExact(corps, 'Reclôturer avril'), 'A3 : et porte « Reclôturer avril »');
  assert(!!boutonExact(corps, 'Ajouter un motif'), '§30.2 : le motif se saisit après coup, depuis le bandeau');
  boutonExact(corps, 'Ajouter un motif').click();
  await pause(150);
  var champMotif = sheet.querySelector('input');
  champMotif.value = 'Absence du 14 oubliée';
  boutonExact(sheet, 'Enregistrer le motif').click();
  await pause(400);
  egal(appels.motifs[0], 'Absence du 14 oubliée', '§30.2 : le motif est écrit après coup');
  contient(corps, 'Motif : Absence du 14 oubliée', '§30.2 : et le bandeau le montre');

  /* --- A3 : l'accueil le compte --- */
  window.App.invalider();
  window.App.aller('accueil', {});
  await pause(500);
  /* Avril rouvert + mai (on est le 25) : deux mois, donc la carte du
     parcours guidé et une pastille à 2. Avant ce lot, avril rouvert était un
     brouillon ordinaire : il comptait déjà comme « en retard » sur un mois
     passé, mais un mois COURANT rouvert avant le 25 ne comptait pas. */
  contient(corps, '2 mois à clôturer', 'A3 : « Aujourd’hui » compte le mois rouvert avec le mois courant');
  var pastille = document.querySelector('.pastille-onglet');
  assert(!!pastille && txt(pastille).indexOf('2') !== -1,
    'A3 : la pastille de l’onglet le compte (obtenu « ' + txt(pastille) + ' »)');
  /* Le mois COURANT rouvert compte lui aussi, même avant le 25 : c'est le
     cas que `Kit.etatDuMois` tranche désormais. */
  egal(window.Kit.etatDuMois(2026, 5, { statut: 'brouillon', donnees: {} }, '2026-05-10'), 'a_cloturer',
    'A3 : un mois courant rouvert est « à clôturer », même le 10 du mois');
  egal(window.Kit.etatDuMois(2026, 5, { statut: 'brouillon', donnees: null }, '2026-05-10'), 'en_cours',
    'A3 : un brouillon sans instantané reste « en cours »');

  /* ==================================================================== */
  /* A4 — LA RECLÔTURE MONTRE LES ÉCARTS, ET LE RAPPEL DE TRANSMISSION    */
  /* ==================================================================== */
  console.log('\n--- A4 : reclôturer montre ce qui a changé ---');
  window.App.aller('document', { contratId: 'c-lea', annee: 2026, mois: 4 });
  await pause(500);
  boutonExact(corps, 'Reclôturer avril').click();
  await pause(150);
  boutonExact(sheet, 'Oui, clôturer le mois').click();
  await pause(300);
  contient(sheet, 'avec le document remis le 3 mai 2026', 'A4 : le titre compte les écarts et date le document remis');
  contient(sheet, 'Jours de présence', 'A4 : les postes qui changent sont listés');
  contient(sheet, '21 j → 20 j', 'A4 : 21 → 20 jours de présence — l’absence du 14 corrigée après la remise');
  contient(sheet, '117,50 €'.replace('117,50', '1 177,50') , 'A4 : l’ancien total à verser');
  contient(sheet, '1 172,50 €', 'A4 : et le nouveau : 5,00 € d’entretien en moins');
  contient(sheet, 'Total à verser', 'A4 : le total à verser');
  contient(sheet, 'a reçu l’ancienne version le 3 mai 2026', 'A4 : le rappel de transmission');
  egal(appels.recloturer.length, 0, 'A7 : rien n’est écrit avant confirmation');
  boutonExact(sheet, 'Clôturer avec ces valeurs').click();
  await pause(400);
  egal(appels.recloturer.length, 1, 'A4 : la reclôture est écrite après confirmation');
  egal(recaps['2026-04'].statut, 'fige', 'A4 : avril est de nouveau clôturé');

  /* La fin de mois guidée montre les écarts elle aussi (§30.5). */
  console.log('\n--- A4 bis : par la fin de mois guidée aussi ---');
  DB.rouvrirRecap('c-lea', 2026, 4, null);
  journees['2026-04-15'] = { jour: '2026-04-15', type: 'absence_enfant' };
  window.App.invalider();
  window.App.aller('finDeMois', { liste: [{ contrat: LEA, annee: 2026, mois: 4, echu: true, rouvert: true }] }, true);
  await pause(500);
  boutonExact(corps, 'Clôturer et continuer').click();
  await pause(400);
  contient(sheet, 'avec le document', 'A4 bis : la fin de mois guidée montre les écarts avant d’écrire');
  egal(appels.recloturer.length, 1, 'A7 : et n’a rien écrit');
  boutonExact(sheet, 'Clôturer avec ces valeurs').click();
  await pause(400);
  egal(appels.recloturer.length, 2, 'A4 bis : écrit après confirmation');

  /* ==================================================================== */
  /* §30.2 — LA MULTI-SÉLECTION PROPOSE AUSSI LA RÉOUVERTURE              */
  /* ==================================================================== */
  console.log('\n--- §30.2 : la multi-sélection ---');
  await ouvrirEnfant(2026, 4);
  var plus = document.getElementById('barre').querySelector('button[aria-label="Marquer plusieurs jours"]');
  assert(!!plus, '§30.2 : le ⋯ reste sur un mois clôturé');
  plus.click();
  await pause(150);
  celluleDu(20).click(); celluleDu(21).click();
  await pause(150);
  boutonExact(corps, 'Valider').click();
  await pause(200);
  contient(sheet, 'Le rouvrir pour marquer ces journées ?', '§30.2 : la feuille propose de rouvrir pour marquer');
  var nbAvant = appels.rouvrir.length;
  boutonExact(sheet, 'Rouvrir et marquer ces journées').click();
  await pause(800);
  egal(appels.rouvrir.length, nbAvant + 1, '§30.2 : une réouverture');
  egal(appels.groupes.length, 1, '§30.2 : et les journées sont marquées ensuite, sans repartir de zéro');
  egal(appels.groupes[0].jours.join(','), '2026-04-20,2026-04-21', '§30.2 : les deux jours choisis');

  /* ==================================================================== */
  /* A2 — L'AVENANT                                                        */
  /* ==================================================================== */
  console.log('\n--- A2 : l’avenant sur un mois clôturé ---');
  DB.recloturerRecap('c-lea', 2026, 4, SNAPSHOT_AVRIL);
  poserFige(2026, 3, null);
  window.App.invalider();
  window.App.aller('fiche', { contratId: 'c-lea' });
  await pause(400);
  boutonExact(corps, 'Faire un avenant').click();
  await pause(150);
  var selMois = sheet.querySelector('select');
  var optAvril = Array.prototype.filter.call(selMois.querySelectorAll('option'), function (o) {
    return txt(o).indexOf('avril 2026') !== -1;
  })[0];
  assert(!!optAvril && !optAvril.disabled, 'A2 : avril, clôturé, est choisissable');
  contient(optAvril, 'clôturé', 'A2 : et nommé comme tel');
  selMois.value = optAvril.value;
  selMois.dispatchEvent(new dom.window.Event('change'));
  await pause(150);
  var bFaire = boutonContenant(sheet, 'avenant au 1er avril');
  assert(!!bFaire, 'A2 : « Faire l’avenant au 1er avril 2026 »');
  bFaire.click();
  await pause(200);
  contient(sheet, 'Un mois clôturé est concerné', 'A2 : pas de refus sec — la réouverture est proposée');
  contient(sheet, 'avril 2026', 'A2 : le mois est nommé');
  absent(sheet, 'mars 2026', 'A2 : mars, antérieur à l’avenant, n’est pas concerné');
  egal(appels.avenants.length, 0, 'A7 : rien n’est écrit avant');
  nbAvant = appels.rouvrir.length;
  boutonContenant(sheet, 'Rouvrir avril et enregistrer l’avenant').click();
  await pause(600);
  egal(appels.rouvrir.length, nbAvant + 1, 'A2 : avril est rouvert');
  egal(appels.avenants.length, 1, 'A2 : et l’avenant est enregistré ensuite, sans repartir de zéro');
  egal(appels.avenants[0].date_effet, '2026-04-01', 'A2 : au 1er avril');

  /* ==================================================================== */
  /* A2 — LA FAMILIARISATION                                               */
  /* ==================================================================== */
  console.log('\n--- A2 : la période de familiarisation ---');
  window.App.invalider();
  window.App.aller('familiarisation', { contratId: 'c-lea' });
  await pause(400);
  boutonExact(corps, 'Poser une période de familiarisation').click();
  await pause(150);
  var dates = sheet.querySelectorAll('.fld .dates');
  function poserDate(bloc, jour, mois, annee) {
    var s = bloc.querySelectorAll('select');
    s[1].value = String(mois); s[1].dispatchEvent(new dom.window.Event('change'));
    s[2].value = String(annee); s[2].dispatchEvent(new dom.window.Event('change'));
    s[0].value = String(jour); s[0].dispatchEvent(new dom.window.Event('change'));
  }
  poserDate(dates[0], 23, 3, 2026);
  poserDate(dates[1], 3, 4, 2026);
  boutonExact(sheet, 'Enregistrer la période').click();
  await pause(200);
  contient(sheet, 'mars 2026', 'A2 : mars, clôturé et recouvert, est nommé');
  /* Avril, rouvert par l'avenant et pas encore reclôturé, n'est PAS rouvert
     une seconde fois : les deux mécaniques cohabitent sans double
     réouverture (§30.8, cas 5). */
  absent(sheet, 'avril 2026', 'A2 : avril, déjà rouvert, n’est pas proposé une seconde fois');
  assert(!!boutonExact(sheet, 'Rouvrir mars et enregistrer la période'),
    'A2 : « Rouvrir mars et enregistrer la période »');
  egal(appels.periodes.length, 0, 'A7 : rien n’est écrit avant');
  nbAvant = appels.rouvrir.length;
  boutonExact(sheet, 'Rouvrir mars et enregistrer la période').click();
  await pause(600);
  egal(appels.rouvrir.length, nbAvant + 1, 'A2 : une seule réouverture, mars');
  egal(appels.periodes.length, 1, 'A2 : et la période est enregistrée ensuite');

  /* ==================================================================== */
  /* A6 — LA LECTURE DES MOIS CLÔTURÉS ÉCHOUE : TOUT EST REFUSÉ           */
  /* ==================================================================== */
  console.log('\n--- A6 : quand la lecture échoue, on refuse ---');
  panne.recaps = true;
  window.App.invalider();
  window.App.aller('familiarisation', { contratId: 'c-lea' });
  await pause(400);
  contient(corps, 'Impossible de vérifier vos mois clôturés', 'A6 : la familiarisation refuse et le dit');
  window.App.invalider();
  window.App.aller('fiche', { contratId: 'c-lea' });
  await pause(400);
  contient(corps, 'Impossible de vérifier les mois déjà clôturés', 'A6 : l’avenant refuse et le dit');
  assert(!boutonExact(corps, 'Faire un avenant'), 'A6 : aucun avenant ne peut être posé');
  panne.recaps = false;

  /* ==================================================================== */
  /* A2 — LA FIN DE CONTRAT                                                */
  /* ==================================================================== */
  console.log('\n--- A2 : la fin de contrat ---');
  DB.recloturerRecap('c-lea', 2026, 3, SNAPSHOT_AVRIL);
  DB.recloturerRecap('c-lea', 2026, 4, SNAPSHOT_AVRIL);
  window.App.invalider();
  window.App.aller('fiche', { contratId: 'c-lea', section: 'fin' });
  await pause(400);
  var champDateFin = corps.querySelector('.fld .dates');
  assert(!!champDateFin, 'l’écran de fin de contrat et son champ de date');
  poserDate(champDateFin, 17, 4, 2026);
  await pause(200);
  var bRanger = boutonExact(corps, 'Ranger ce contrat');
  assert(!!bRanger, '« Ranger ce contrat »');
  bRanger.click();
  await pause(300);
  contient(sheet, 'est déjà clôturé', 'A2 : le dernier mois clôturé est nommé');
  var bRouvrirRanger = boutonExact(sheet, 'Rouvrir avril et ranger le contrat');
  assert(!!bRouvrirRanger, 'A2 : « Rouvrir avril et ranger le contrat » est proposé — plus de refus sec');
  bRouvrirRanger.click();
  await pause(200);
  contient(sheet, 'pour que la date de fin y entre', 'A2 : la feuille dit pourquoi');
  nbAvant = appels.rouvrir.length;
  boutonExact(sheet, 'Rouvrir avril et ranger le contrat').click();
  await pause(800);
  egal(appels.rouvrir.length, nbAvant + 1, 'A2 : avril est rouvert');
  egal(appels.archiver.length, 1, 'A2 : le contrat est rangé ensuite');
  egal(appels.archiver[0].dateFin, '2026-04-17', 'A2 : au 17 avril');
  contient(corps, 'Récapitulatif', 'A2 : et l’application ouvre le document d’avril');
  contient(corps, 'Mois rouvert', 'A2 : rouvert');
  assert(!!boutonExact(corps, 'Reclôturer avril'),
    'A2 : un contrat rangé peut reclôturer son mois rouvert (décision du 26 août)');

  /* Et le mois de mars, clôturé, sur ce contrat rangé, reste en lecture seule. */
  window.App.invalider();
  window.App.aller('enfant', { contratId: 'c-lea', annee: 2026, mois: 3 });
  await pause(400);
  assert(!celluleDu(10) || celluleDu(10).getAttribute('role') !== 'button',
    'A7 : sur un contrat rangé, un mois clôturé ne se rouvre pas depuis le calendrier');

  console.log('');
  if (echecs) { console.error(echecs + ' échec(s).'); process.exit(1); }
  console.log('Tout est conforme.');
  process.exit(0);
})().catch(function (e) {
  console.error('Erreur pendant le parcours : ' + (e && e.stack || e));
  process.exit(1);
});
