/* ============================================================================
   Test de fumée — LOT 28, LES ÉCRANS QUI AFFICHENT LES CALCULS.

   Ce fichier monte le vrai `index.html`, le vrai moteur, la vraie chaîne, et
   lit ce qui s'affiche. Il couvre les critères d'ÉCRAN du lot 28 :

     §28.4 A1  sur un mois de familiarisation, somme des lignes = total, sur
               les CINQ écrans : espace enfant, fin de mois guidée, période,
               historique, document ;
     §28.4 A2  sur un mois sans familiarisation, aucune ligne en plus ;
     §28.7 A1  le panneau « Ajuster mes heures » annonce les mêmes minutes que
               le moteur, écart déclaré compris ;
     §28.3 A1  la déclaration d'un écart sur les congés payés annonce, AVANT
               validation, ce que les congés payés couvrent et ce qui bascule
               sur la récupération ;
     §28.2     l'espace enfant dit qu'une absence ne porte aucune minute.

   Décor : septembre 2026, familiarisation du 1er au 11, on est le 25. Le 14
   porte un retard de 20 minutes ; les congés payés du contrat sont à 2 h.
   Valeurs FICTIVES et rondes : le dépôt est PUBLIC.

   Lancement : node test/lot28-calculs.smoke.js
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
function pause(ms) { return new Promise(function (r) { setTimeout(r, ms || 60); }); }
function txt(el) { return el ? norm(el.textContent) : ''; }
function norm(s) { return String(s).replace(/[\u00a0\u202f]/g, ' '); }
function contient(el, morceau, msg) {
  if (txt(el).indexOf(morceau) !== -1) { assert(true, msg); return; }
  assert(false, msg + ' — « ' + morceau + ' » introuvable dans : ' + txt(el).slice(0, 400));
}
function absent(el, morceau, msg) {
  assert(txt(el).indexOf(morceau) === -1, msg + ' — « ' + morceau + ' » ne devrait pas y être');
}
function parTexte(racineEl, selecteur, morceau) {
  return Array.prototype.filter.call(racineEl.querySelectorAll(selecteur), function (e) {
    return txt(e).indexOf(morceau) !== -1;
  })[0] || null;
}
function paneParTitre(racineEl, titre) {
  return Array.prototype.filter.call(racineEl.querySelectorAll('.pane'), function (p) {
    var t = p.querySelector('.pt');
    return t && txt(t).indexOf(titre) !== -1;
  })[0] || null;
}
/* La valeur d'une ligne libellé/valeur, dans un `.lines` ou un `.fold`. */
function valeurLigne(racineEl, libelle) {
  var l = Array.prototype.filter.call(racineEl.querySelectorAll('.l, .ln'), function (e) {
    return e.firstChild && txt(e.firstChild).indexOf(libelle) !== -1;
  })[0];
  return l ? txt(l.lastChild).trim() : null;
}
/* « 1 142,00 € » → 114200. */
function centimes(s) {
  if (s == null) return null;
  var m = String(s).replace(/\s/g, '').match(/(-|−)?(\d+),(\d{2})€/);
  if (!m) return null;
  var v = Number(m[2]) * 100 + Number(m[3]);
  return m[1] ? -v : v;
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

/* --- Décor ------------------------------------------------------------ */
var PLANNING = [1, 2, 3, 4, 5];
var NOAH = {
  id: 'c-noah', prenom_enfant: 'Noah', famille_id: 'f1',
  famille: { id: 'f1', nom: 'Aubépine' },
  date_debut: '2026-08-01', date_fin: null,
  minutes_contractuelles: 540, minutes_sup_jour: 30, minutes_par_jour_conge: 540,
  entretien_centimes_jour: 550, jours_planning: PLANNING,
  heure_arrivee: '08:30:00', heure_depart: '17:30:00', statut: 'actif',
  sup_dues_si_enfant_absent: true, ordre_imputation: 'cp_puis_sup', archive: false,
  nom: null, genre: 'm', couleur: null, photo: null
};
var AVENANTS = [Decor.avenantDe(NOAH, {
  id: 'a1', date_effet: '2026-08-01',
  brut_mensuel_centimes: 140400, net_mensuel_centimes: 107100
})];
AVENANTS[0].numero = 1;

var PERIODE = { id: 'p1', contrat_id: 'c-noah', date_debut: '2026-09-01', date_fin: '2026-09-11' };

var journees = {
  /* Trois jours déclarés dans la période : 4 h, 5 h, 3 h — le second sans
     entretien. */
  '2026-09-01': { jour: '2026-09-01', type: 'familiarisation', minutes_reelles: 240, entretien_du: true },
  '2026-09-02': { jour: '2026-09-02', type: 'familiarisation', minutes_reelles: 300, entretien_du: false },
  '2026-09-03': { jour: '2026-09-03', type: 'familiarisation', minutes_reelles: 180, entretien_du: true },
  /* §28.7 — un retard de 20 minutes le lundi 14. */
  '2026-09-14': { jour: '2026-09-14', type: 'presence', ecart_minutes: 20,
    ecart_evenement: 'retard_parent', ecart_heure_reelle: '18:20', entretien_du: true },
  /* §28.2 — l'enfant absent le mardi 15. */
  '2026-09-15': { jour: '2026-09-15', type: 'absence_enfant', entretien_du: true }
};
var recaps = [];
var periodes = [PERIODE];
var ecritures = { journees: [] };

function journeesEntre(debut, fin) {
  var parMois = {};
  Object.keys(journees).forEach(function (j) {
    if (j < debut || j > fin) return;
    var cle = j.slice(0, 7);
    if (!parMois[cle]) parMois[cle] = {};
    parMois[cle][j] = journees[j];
  });
  return parMois;
}

var DB = {
  getSession: function () {
    return Promise.resolve({ user: { id: 'u1', email: 'maria@exemple.test' } });
  },
  onAuthChange: function () {},
  signOut: function () { return Promise.resolve(true); },
  getEmettrice: function () { return Promise.resolve({ nom: 'Maria' }); },
  enregistrerEmettrice: function (nom) { return Promise.resolve({ nom: nom }); },
  getPreferenceRappel: function () { return Promise.resolve(null); },
  listContratsActifs: function () { return Promise.resolve([NOAH]); },
  listContratsTous: function () { return Promise.resolve([NOAH]); },
  listContratsPourMois: function () { return Promise.resolve([NOAH]); },
  listContratsPourPeriode: function () { return Promise.resolve([NOAH]); },
  listFamilles: function () { return Promise.resolve([NOAH.famille]); },
  listFamillesToutes: function () { return Promise.resolve([NOAH.famille]); },
  listFamillesAvecContrats: function () {
    return Promise.resolve([{ id: 'f1', nom: 'Aubépine', archive: false, contrats: [NOAH] }]);
  },
  contratEstVierge: function () { return Promise.resolve(false); },
  getAvenants: function () { return Promise.resolve(AVENANTS.slice()); },
  getCompteurInitial: function (id) {
    /* §28.3 — 2 h de congés payés seulement à l'entrée de septembre. Août acquiert ses 2,5 jours (1 350) : pour qu'il n'en reste que 2 h
       à l'entrée de septembre, 1 350 sont déjà pris. */
    return Promise.resolve({ contrat_id: id, date_reference: '2026-08-01',
      minutes_sup: 0, minutes_cp_acquis: 120, minutes_cp_pris: 1350 });
  },
  getJourneesMois: function (id, a, m) {
    var cle = a + '-' + String(m).padStart(2, '0');
    return Promise.resolve(journeesEntre(cle + '-01', cle + '-31')[cle] || {});
  },
  getJourneesPeriode: function (id, d, f) { return Promise.resolve(journeesEntre(d, f)); },
  listImputations: function () { return Promise.resolve([]); },
  listImputationsPourMois: function () { return Promise.resolve([]); },
  listSamedisConge: function () { return Promise.resolve([]); },
  compterSamedisAnnee: function () { return Promise.resolve(0); },
  listPeriodesFamiliarisation: function () { return Promise.resolve(periodes.slice()); },
  listPeriodesFamiliarisationContrat: function () { return Promise.resolve(periodes.slice()); },
  getNoteMensuelle: function () { return Promise.resolve(null); },
  listRecapsPeriode: function () { return Promise.resolve(recaps.slice()); },
  listRecapsContrat: function () { return Promise.resolve(recaps.slice()); },
  getRecap: function () { return Promise.resolve(null); },
  listEvenementsRecap: function () { return Promise.resolve([]); },
  enregistrerJournee: function (l) {
    ecritures.journees.push(l);
    var garde = journees[l.jour] || {};
    var ligne = { id: 'j-' + l.jour, contrat_id: l.contrat_id, jour: l.jour, type: l.type };
    ['minutes_reelles', 'entretien_centimes', 'commentaire', 'entretien_du',
     'minutes_sup_exceptionnelles', 'minutes_sup_renoncees', 'sup_dues_override',
     'ecart_minutes', 'ecart_evenement', 'ecart_heure_reelle', 'ecart_impute_sur']
      .forEach(function (k) {
        ligne[k] = Object.prototype.hasOwnProperty.call(l, k) ? l[k] : garde[k];
      });
    if (ligne.entretien_du == null) ligne.entretien_du = true;
    journees[l.jour] = ligne;
    return Promise.resolve(ligne);
  },
  supprimerJournee: function (id, j) { delete journees[j]; return Promise.resolve(true); },
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

window.App.moisCourant = function () { return { annee: 2026, mois: 9 }; };
window.App.aujourdhui = function () { return '2026-09-25'; };

var corps = document.getElementById('corps');
var sheet = document.getElementById('sheet');

function celluleDu(numero) {
  return Array.prototype.filter.call(
    corps.querySelectorAll('table.cal td'), function (td) {
      return txt(td.querySelector('.num')) === String(numero);
    })[0] || null;
}
async function ouvrirJour(numero) {
  var td = celluleDu(numero);
  if (!td) return null;
  td.click();
  await pause(200);
  return td;
}
function choixParLibelle(morceau) {
  return parTexte(sheet, '.liste-choix .choice, .liste-choix button', morceau);
}

/* Le mois de référence, calculé HORS écran par le moteur : c'est lui que
   chaque écran doit reconstituer. */
var Kit = window.Kit;

(async function () {
  document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  await pause(400);

  var serie = await window.App.serie(NOAH, { annee: 2026, mois: 9 });
  var r = window.App.moisDe(serie, 2026, 9).resultat;
  var fam = Chaine.partFamiliarisation(r);
  assert(fam.actif && fam.netCentimes > 0 && fam.entretienCentimes === 2 * 550,
    'décor : septembre porte une part de familiarisation (' + Kit.eur(fam.netCentimes) +
    ' + ' + Kit.eur(fam.entretienCentimes) + ')');
  var attenduTotal = Chaine.netDuMois(r) + r.entretienCentimes + fam.netCentimes +
    fam.entretienCentimes - r.retenueSansSoldeCentimes;
  egal(attenduTotal, r.totalAVerserCentimes,
    'décor : net + entretien + familiarisation − retenue = total (moteur)');

  /* ==================================================================== */
  /* §28.4 A1 — ÉCRAN 1 : L'ESPACE ENFANT                                 */
  /* ==================================================================== */
  console.log('\n--- §28.4 : l’espace enfant ---');
  window.App.aller('enfant', { contratId: 'c-noah', annee: 2026, mois: 9 });
  await pause(500);
  var fold = parTexte(corps, '.fold', 'Le mois');
  assert(!!fold, 'le repli « Le mois » est là');
  var netE = centimes(valeurLigne(fold, 'Salaire net'));
  var entE = centimes(valeurLigne(fold, 'Entretien')) ;
  var famNetE = centimes(valeurLigne(fold, 'Familiarisation — heures déclarées'));
  var famEntE = centimes(valeurLigne(fold, 'Familiarisation — entretien'));
  var totalE = centimes(valeurLigne(fold, 'Total à verser'));
  assert(famNetE === fam.netCentimes, 'la ligne « Familiarisation — heures déclarées » est là, juste (obtenu ' + famNetE + ')');
  assert(famEntE === fam.entretienCentimes, 'la ligne « Familiarisation — entretien » aussi (obtenu ' + famEntE + ')');
  egal(netE + entE + famNetE + famEntE, totalE,
    'A1 : la somme des lignes affichées fait le total affiché');
  egal(totalE, r.totalAVerserCentimes, 'et ce total est celui du moteur');

  /* §28.2 — l'absence du 15 ne porte aucune minute : 30 min de moins. */
  contient(fold, 'Heures sup du mois', 'la ligne des heures sup');
  var supAffiche = valeurLigne(fold, 'Heures sup du mois');
  assert(supAffiche.indexOf(Kit.heures(r.minutesSupAcquises)) !== -1,
    '§28.2 : les heures sup affichées sont celles du moteur (' + supAffiche + ')');
  /* 22 jours ouvrés, 9 en période, 1 absence, 1 retard de 20 : 12 × 30 − 30 + 20. */
  egal(r.minutesSupAcquises, 12 * 30 - 30 + 20 + 30, '§28.2 : 13 journées mensualisées, dont une absente à 0, et le retard');

  /* ==================================================================== */
  /* §28.7 A1 — LE PANNEAU « AJUSTER MES HEURES »                         */
  /* ==================================================================== */
  console.log('\n--- §28.7 : le panneau dit la vérité ---');
  await ouvrirJour(14);
  var autre = parTexte(sheet, 'button', 'Autre cas');
  assert(!!autre, 'la feuille du 14 offre « Autre cas… »');
  autre.click();
  await pause(200);
  var det = parTexte(sheet, 'details', 'Ajuster mes heures');
  assert(!!det, 'le panneau est là');
  det.open = true;
  await pause(60);
  var effet = det.querySelector('.effet-heures');
  contient(effet, 'Ce jour : 50 min',
    'A1 : le panneau annonce 50 min — les 30 du contrat plus le retard de 20, comme le moteur');
  absent(effet, 'comme prévu au contrat', 'et ne dit plus « comme prévu au contrat »');
  contient(effet, 'Écart déclaré ce jour-là compris', 'et il dit d’où viennent les 20 minutes');
  egal(Engine.minutesSupDuJour(journees['2026-09-14'], AVENANTS[0]), 50,
    'le moteur compte bien 50 sur cette journée');
  /* Le renoncement se borne au moteur : 50 renonçables. */
  var boxR = det.querySelector('input[type="checkbox"]');
  boxR.checked = true;
  boxR.dispatchEvent(new dom.window.Event('change'));
  await pause(60);
  contient(det.querySelector('.effet-heures'), 'Ce jour : 0 min',
    'renoncer retire tout ce qui est dû, retard compris');
  window.Kit.fermerFeuille();
  await pause(150);

  /* §28.2 — sur l'absence du 15, le panneau dit qu'il n'y a rien à ajuster. */
  await ouvrirJour(15);
  parTexte(sheet, 'button', 'Autre cas').click();
  await pause(200);
  var det15 = parTexte(sheet, 'details', 'Ajuster mes heures');
  det15.open = true;
  await pause(60);
  contient(det15, 'aucune minute n’est due ce jour-là',
    '§28.2 : sur une absence, le panneau dit la règle');
  assert(!det15.querySelector('input[type="checkbox"]'), 'et n’offre aucun compteur');
  window.Kit.fermerFeuille();
  await pause(150);

  /* ==================================================================== */
  /* §28.3 A1 — L'ÉCART SUR LES CONGÉS PAYÉS, ANNONCÉ AVANT               */
  /* ==================================================================== */
  console.log('\n--- §28.3 : « il vous reste X », avant validation ---');
  await ouvrirJour(16);
  var liberation = choixParLibelle('libéré plus tôt');
  assert(!!liberation, 'le choix « j’ai libéré plus tôt » est proposé le 16');
  liberation.click();
  await pause(150);
  /* Départ à 13h00 : référence 18h00, écart −300. */
  var champHeure = sheet.querySelector('.detail-choix input, .detail-choix select');
  assert(!!champHeure, 'le champ d’heure est là');
  var champs = sheet.querySelectorAll('.detail-choix select');
  /* `champHeureMinute` : deux listes, heures puis minutes. */
  if (champs.length >= 2) {
    champs[0].value = '13'; champs[0].dispatchEvent(new dom.window.Event('change'));
    champs[1].value = '00'; champs[1].dispatchEvent(new dom.window.Event('change'));
  } else {
    champHeure.value = '13:00';
    champHeure.dispatchEvent(new dom.window.Event('input'));
    champHeure.dispatchEvent(new dom.window.Event('change'));
  }
  await pause(150);
  var selDest = parTexte(sheet, '.fld', 'se déduisent de');
  assert(!!selDest, 'la destination est proposée sur un écart négatif');
  selDest.querySelector('select').value = 'conges_payes';
  selDest.querySelector('select').dispatchEvent(new dom.window.Event('change'));
  await pause(200);
  var detail = sheet.querySelector('.detail-choix');
  contient(detail, 'ne couvrent que ' + norm(Kit.duree(120)),
    'A1 : l’écran annonce que les congés payés ne couvrent que 2 h');
  contient(detail, norm(Kit.duree(180)) + ' de votre récupération',
    'A1 : et que 3 h basculent sur la récupération');
  contient(detail, 'Il ne vous en reste plus pour ce mois', 'A1 : « il vous reste X » (lot 21)');
  var bEnr = parTexte(sheet, 'button', 'Enregistrer');
  assert(bEnr && !bEnr.disabled, 'le bouton reste actif : Maria choisit, l’application ne refuse pas');
  window.Kit.fermerFeuille();
  await pause(150);

  /* ==================================================================== */
  /* §28.4 A1 — ÉCRAN 2 : LA FIN DE MOIS GUIDÉE                           */
  /* ==================================================================== */
  console.log('\n--- §28.4 : la fin de mois guidée ---');
  window.App.aller('finDeMois', { liste: [{ contrat: NOAH, annee: 2026, mois: 9 }] }, true);
  await pause(500);
  var paneG = paneParTitre(corps, 'Le mois de Noah');
  assert(!!paneG, 'l’étape guidée montre le mois');
  var netG = centimes(valeurLigne(paneG, 'Salaire net'));
  var entG = centimes(valeurLigne(paneG, 'Indemnité d’entretien'));
  var famNetG = centimes(valeurLigne(paneG, 'Familiarisation — heures déclarées'));
  var famEntG = centimes(valeurLigne(paneG, 'Familiarisation — indemnité'));
  var totalG = centimes(valeurLigne(paneG, 'Total à verser'));
  assert(famNetG === fam.netCentimes && famEntG === fam.entretienCentimes,
    'les deux lignes de familiarisation sont là (' + famNetG + ', ' + famEntG + ')');
  egal(netG + entG + famNetG + famEntG, totalG,
    'A1 : sur l’écran qui précède la clôture, la somme des lignes fait le total');

  /* ==================================================================== */
  /* §28.4 A1 — ÉCRAN 3 : LE DOCUMENT                                     */
  /* ==================================================================== */
  console.log('\n--- §28.4 : le document ---');
  window.App.aller('document', { contratId: 'c-noah', annee: 2026, mois: 9 });
  await pause(500);
  var doc = corps.querySelector('.doc');
  assert(!!doc, 'le document est rendu');
  contient(doc, 'Familiarisation', 'le bloc « Familiarisation »');
  contient(doc, 'Garde mensualisée', 'et le bloc « Garde mensualisée »');
  contient(doc, norm(Kit.eur(r.totalAVerserCentimes)), 'le total du moteur y figure');

  /* ==================================================================== */
  /* §28.4 A1 — ÉCRAN 4 : L'HISTORIQUE (bilan de l'année)                 */
  /* ==================================================================== */
  console.log('\n--- §28.4 : l’historique ---');
  window.App.aller('historique', { contratId: 'c-noah', annee: 2026, mois: 9 });
  await pause(600);
  var bBilan = parTexte(corps, 'button', 'Bilan de l’année');
  assert(!!bBilan, 'l’historique propose le bilan de l’année');
  bBilan.click();
  await pause(600);
  var paneH = paneParTitre(corps, 'Totaux de l’année');
  assert(!!paneH, 'le bilan de l’année est rendu');
  var netH = centimes(valeurLigne(paneH, 'Salaires nets'));
  var entH = centimes(valeurLigne(paneH, 'Indemnité d’entretien'));
  var famNetH = centimes(valeurLigne(paneH, 'Familiarisation — heures déclarées'));
  var famEntH = centimes(valeurLigne(paneH, 'Familiarisation — entretien'));
  var totalH = centimes(valeurLigne(paneH, 'Total versé sur l’année'));
  assert(famNetH === fam.netCentimes && famEntH === fam.entretienCentimes,
    'les deux lignes de familiarisation sont là (' + famNetH + ', ' + famEntH + ')');
  egal(netH + entH + famNetH + famEntH, totalH,
    'A1 : sur l’historique, la somme des lignes fait le total');

  /* ==================================================================== */
  /* §28.4 A1 — ÉCRAN 5 : LA PÉRIODE                                      */
  /* ==================================================================== */
  console.log('\n--- §28.4 : la période ---');
  window.App.aller('periode', {});
  await pause(300);
  parTexte(corps, 'button', 'Ce mois-ci').click();
  await pause(600);
  var resultats = document.getElementById('resultats-periode');
  var entiers = paneParTitre(resultats, 'Sur les mois entiers');
  assert(!!entiers, 'le bloc des mois entiers');
  var netP = centimes(valeurLigne(entiers, 'Salaires nets'));
  var famNetP = centimes(valeurLigne(entiers, 'Familiarisation — heures déclarées'));
  var famEntP = centimes(valeurLigne(entiers, 'Familiarisation — entretien'));
  assert(famNetP === fam.netCentimes && famEntP === fam.entretienCentimes,
    'les deux lignes de familiarisation sont là (' + famNetP + ', ' + famEntP + ')');
  var jourP = paneParTitre(resultats, 'Compté au jour près');
  var entP = centimes(valeurLigne(jourP, 'Indemnité d’entretien'));
  var famEntJour = centimes(valeurLigne(jourP, 'Familiarisation — entretien'));
  var totalP = centimes(valeurLigne(entiers, 'Total versé sur ces mois'));
  egal(netP + entP + famNetP + famEntP, totalP,
    'A1 : nets + entretien + familiarisation = total versé sur ces mois');
  egal(famEntJour, fam.entretienCentimes, 'et l’entretien de familiarisation figure aussi au jour près');

  /* ==================================================================== */
  /* §28.4 A2 — SANS FAMILIARISATION, RIEN NE CHANGE                      */
  /* ==================================================================== */
  console.log('\n--- §28.4 A2 : août, sans familiarisation ---');
  window.App.aller('enfant', { contratId: 'c-noah', annee: 2026, mois: 8 });
  await pause(500);
  var foldAout = parTexte(corps, '.fold', 'Le mois');
  absent(foldAout, 'Familiarisation', 'A2 : aucune ligne de familiarisation en août');
  var netA = centimes(valeurLigne(foldAout, 'Salaire net'));
  var entA = centimes(valeurLigne(foldAout, 'Entretien'));
  var totalA = centimes(valeurLigne(foldAout, 'Total à verser'));
  egal(netA + entA, totalA, 'A2 : et la somme des lignes fait toujours le total');

  console.log('');
  if (echecs) { console.error(echecs + ' échec(s).'); process.exit(1); }
  console.log('Tout est conforme.');
  process.exit(0);
})().catch(function (e) {
  console.error('Erreur pendant le parcours : ' + (e && e.stack || e));
  process.exit(1);
});
