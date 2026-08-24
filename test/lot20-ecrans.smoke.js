/* ============================================================================
   Test de fumée — LOT 20, LES ÉCRANS DE LA FAMILIARISATION.

   La règle du lot 16, sans exception : TOUT ÉCRAN LIVRÉ DOIT ÊTRE RENDU PAR UN
   TEST QUI CLIQUE. Les critères A8 et A9 du §20.5 sont des critères d'ÉCRAN —
   « la carte d'Accueil dit l'état du jour et se met à jour dès la déclaration »,
   « l'écran de période liste chaque jour ouvré avec son état, y compris à
   déclarer sur un jour passé ». Aucune recherche de chaîne dans un `.js` ne
   peut les voir.

   Ce fichier monte le vrai `index.html`, le vrai moteur, la vraie chaîne, et
   lit ce qui s'affiche. Il couvre :

     §20.4 a  la carte de l'Accueil, avant et après la déclaration (A8) ;
     §20.4 b  l'encart « Déclarez les heures d'aujourd'hui » ;
     §20.4 c  la feuille du jour : raccourcis, arrivée → départ, entretien ;
     §20.4 d  l'écran de la période, jour par jour (A9), et son verrou ;
     §20.3    le document en deux blocs ;
     §20.6    l'interrupteur d'entretien, absent hors du cadre.

   Décor : septembre 2026, familiarisation du 1er au 19, on est le 10.
   Le 1er est un mardi ; les jours ouvrés de la période sont donc les 1-4,
   7-11 et 14-18, soit quatorze, et il reste huit jours de garde sur 22.

   Lancement : node test/lot20-ecrans.smoke.js
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
/* Les espaces INSÉCABLES sont normalisés — la typographie française en
   sème partout (« 10 j », « 5,50 € »), et un test qui cherche un espace
   ordinaire ne trouverait jamais rien. L'échappement est explicite :
   écrit littéralement, ce caractère est invisible dans le fichier et la
   normalisation devient un remplacement d'espace par lui-même. */
function txt(el) { return el ? String(el.textContent).replace(/[\u00a0\u202f]/g, ' ') : ''; }
function contient(el, morceau, msg) {
  /* Le détail n'est composé QU'EN CAS D'ÉCHEC : une ligne « ok » suivie de
     « introuvable dans… » se relit de travers, et c'est le genre de sortie qui
     fait passer un échec pour un succès à la lecture rapide. */
  if (txt(el).indexOf(morceau) !== -1) { assert(true, msg); return; }
  assert(false, msg + ' — « ' + morceau + ' » introuvable dans : ' + txt(el).slice(0, 320));
}
function absent(el, morceau, msg) {
  assert(txt(el).indexOf(morceau) === -1, msg + ' — « ' + morceau + ' » ne devrait pas y être');
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
var NOAH = {
  id: 'c-noah', prenom_enfant: 'Noah', famille_id: 'f1',
  famille: { id: 'f1', nom: 'Aubépine' },
  /* Le contrat commence en AOÛT, un mois entier et sans familiarisation :
     c'est là que se joue le §20.6, qui a besoin d'une journée de garde
     ordinaire et PASSÉE. En septembre, la période couvre tout le passé du
     mois — il n'y resterait aucune journée ordinaire à tester. */
  date_debut: '2026-08-01', date_fin: null,
  minutes_contractuelles: 540, minutes_sup_jour: 30, minutes_par_jour_conge: 540,
  entretien_centimes_jour: 550, jours_planning: PLANNING,
  heure_arrivee: '08:30:00', heure_depart: '17:30:00', statut: 'actif',
  sup_dues_si_enfant_absent: true, ordre_imputation: 'cp_puis_sup', archive: false,
  nom: null, genre: 'm', couleur: null, photo: null
};

/* 1 404,00 € brut sur 195 h : exactement 7,20 € de l'heure. Un taux rond rend
   les montants du test lisibles à la main. */
var AVENANTS = [Decor.avenantDe(NOAH, {
  id: 'a1', date_effet: '2026-08-01',
  brut_mensuel_centimes: 140400, net_mensuel_centimes: 107100
})];
AVENANTS[0].numero = 1;

var PERIODE = { id: 'p1', contrat_id: 'c-noah',
  date_debut: '2026-09-01', date_fin: '2026-09-19' };

/* Les journées, mutables : le test en écrit, puis relit ce que l'écran
   affiche. C'est ce qui prouve A8 — « la carte se met à jour ». */
var journees = {};
var recaps = [];
var periodes = [PERIODE];
var ecritures = { journees: [], periodes: [] };

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
  ajouterAvenant: function (id, champs) { return Promise.resolve(Decor.avenantDe(NOAH, champs)); },
  majAvenant: function (id, champs) { return Promise.resolve(champs); },
  supprimerAvenant: function () { return Promise.resolve(true); },
  getCompteurInitial: function (id) {
    return Promise.resolve({ contrat_id: id, date_reference: '2026-08-01',
      minutes_sup: 0, minutes_cp_acquis: 0, minutes_cp_pris: 0 });
  },
  getJourneesMois: function (id, a, m) {
    var cle = a + '-' + String(m).padStart(2, '0');
    return Promise.resolve(journeesEntre(cle + '-01', cle + '-31')[cle] || {});
  },
  getJourneesPeriode: function (id, d, f) { return Promise.resolve(journeesEntre(d, f)); },
  listImputations: function () { return Promise.resolve([]); },
  listImputationsPourMois: function () { return Promise.resolve([]); },
  supprimerImputation: function () { return Promise.resolve(true); },
  listPeriodesFamiliarisation: function () { return Promise.resolve(periodes.slice()); },
  listPeriodesFamiliarisationContrat: function () { return Promise.resolve(periodes.slice()); },
  enregistrerPeriodeFamiliarisation: function (p) {
    ecritures.periodes.push(p); return Promise.resolve(p);
  },
  majPeriodeFamiliarisation: function (id, b) {
    ecritures.periodes.push(b); return Promise.resolve(b);
  },
  supprimerPeriodeFamiliarisation: function () { return Promise.resolve(true); },
  getNoteMensuelle: function () { return Promise.resolve(null); },
  enregistrerNoteMensuelle: function (c, a, m, t) { return Promise.resolve({ texte: t }); },
  listRecapsPeriode: function () { return Promise.resolve(recaps.slice()); },
  listRecapsContrat: function () { return Promise.resolve(recaps.slice()); },
  getRecap: function () { return Promise.resolve(null); },
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
  enregistrerImputation: function (i) { return Promise.resolve(i); },
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
window.App.aujourdhui = function () { return '2026-09-10'; };

var corps = document.getElementById('corps');
var sheet = document.getElementById('sheet');

function celluleDu(numero) {
  return Array.prototype.filter.call(
    corps.querySelectorAll('table.cal td'), function (td) {
      return txt(td.querySelector('.num')) === String(numero);
    })[0] || null;
}

(async function () {
  document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  await pause(400);

  /* ==================================================================== */
  /* §20.4 a — LA CARTE DE L'ACCUEIL, AVANT DÉCLARATION (A8)              */
  /* ==================================================================== */
  console.log('\n--- §20.4 a : la carte dit l’état du jour ---');

  window.App.aller('accueil', {});
  await pause(400);
  contient(corps, 'Aujourd’hui : heures à déclarer',
    'A8 : la carte réclame la déclaration du jour');

  /* ==================================================================== */
  /* §20.4 b — L'ENCART DE L'ESPACE ENFANT                                */
  /* ==================================================================== */
  console.log('\n--- §20.4 b : l’encart en tête de l’espace enfant ---');

  window.App.aller('enfant', { contratId: 'c-noah', annee: 2026, mois: 9 });
  await pause(400);
  contient(corps, 'Déclarez les heures d’aujourd’hui', 'l’encart est là');
  contient(corps, 'seules les heures déclarées sont payées', 'et il dit la règle');

  /* Le calendrier montre la période, pas des présences présumées. */
  assert(txt(celluleDu(10)).indexOf('à décl.') !== -1,
    'le 10 (aujourd’hui, non déclaré) est marqué « à décl. »');
  assert(txt(celluleDu(2)).indexOf('à décl.') !== -1,
    'le 2 (passé, non déclaré) aussi');
  assert(txt(celluleDu(15)).indexOf('à venir') !== -1,
    'le 15 (à venir, dans la période) dit « à venir »');
  assert(txt(celluleDu(22)).indexOf('à décl.') === -1 &&
         txt(celluleDu(22)).indexOf('à venir') === -1,
    'le 22 est hors période : il reste une journée de garde ordinaire');

  /* ==================================================================== */
  /* §20.4 c — LA FEUILLE DU JOUR                                         */
  /* ==================================================================== */
  console.log('\n--- §20.4 c : déclarer 2 h 30, entretien compté ---');

  boutonExact(corps, 'Déclarer maintenant').click();
  await pause(200);
  contient(sheet, 'Familiarisation — ', 'la feuille du jour s’ouvre');
  contient(sheet, 'Rémunération à l’heure', 'elle rappelle la règle');
  contient(sheet, 'Arrivée', 'le champ d’arrivée est là');
  contient(sheet, 'Départ', 'et celui de départ');
  contient(sheet, 'Indemnité d’entretien du jour', 'l’entretien se choisit');
  contient(sheet, 'Montant plein du jour', 'et le montant est PLEIN, jamais au prorata');

  var b230 = boutonExact(sheet, '2h30');
  assert(!!b230, 'le raccourci 2 h 30 existe');
  b230.click();
  await pause(120);
  contient(sheet, 'Rémunération du jour : 18,00 €',
    'A2 : 150 minutes à 7,20 € de l’heure, rejoué par le moteur');

  boutonExact(sheet, 'Enregistrer').click();
  await pause(500);

  var ecrit = ecritures.journees[ecritures.journees.length - 1];
  egal(ecrit.type, 'familiarisation', 'la journée est écrite en familiarisation');
  egal(ecrit.minutes_reelles, 150, 'avec ses 150 minutes');
  egal(ecrit.entretien_du, true, 'et l’indemnité comptée par défaut');
  egal(ecrit.entretien_centimes, null,
    'le MONTANT de l’indemnité vient de l’avenant, jamais surchargé ici');

  /* ==================================================================== */
  /* A8 — LA CARTE SE MET À JOUR                                          */
  /* ==================================================================== */
  console.log('\n--- A8 : la carte d’Accueil se met à jour ---');

  window.App.aller('accueil', {});
  await pause(400);
  contient(corps, '2h30 déclarées aujourd’hui', 'A8 : la carte a changé');
  contient(corps, 'entretien compté', 'et elle dit l’entretien');
  absent(corps, 'heures à déclarer', 'A8 : elle ne réclame plus rien');

  /* L'espace enfant aussi. */
  window.App.aller('enfant', { contratId: 'c-noah', annee: 2026, mois: 9 });
  await pause(400);
  contient(corps, 'Aujourd’hui — 2h30 déclarées', 'l’encart devient vert');
  assert(!!boutonExact(corps, 'Corriger'), 'et propose de corriger');
  contient(corps, '2h30', 'le calendrier porte les heures du jour');

  /* ==================================================================== */
  /* §20.3 — LE MOIS EN DEUX PARTS, DANS L'ÉCRAN ET SUR LE DOCUMENT       */
  /* ==================================================================== */
  console.log('\n--- §20.3 : le mois mêlé, en deux parts ---');

  window.App.aller('document', { contratId: 'c-noah', annee: 2026, mois: 9 });
  await pause(500);
  contient(corps, 'Familiarisation', 'le document porte le bloc de familiarisation');
  contient(corps, 'Heures déclarées', 'avec les heures');
  /* CORRECTION C2 — le détail ne s'affiche que s'il reconstitue son total.
     Le brut de ce décor est rond (1 404,00 € sur 195 h = 7,20 € pile) : la
     multiplication tombe juste, et le document la montre pour que la famille
     refasse le calcul de tête. */
  contient(corps, '2h30 × 7,20 € de l’heure',
    'C2 : la multiplication est affichée, et elle reconstitue le total');
  contient(corps, '18,00 €', 'C2 : et 2,5 h × 7,20 € font bien 18,00 €');
  absent(corps, 'ne redonne pas exactement ce total',
    'C2 : aucune excuse affichée quand le détail tombe juste');
  contient(corps, 'Garde mensualisée', 'puis le bloc de garde');
  contient(corps, '8 jours travaillés sur 22',
    'et le quotient du prorata, hors familiarisation');
  /* L'encart RG-06 n'est PAS attendu ici : depuis le lot 7, il ne figure que
     sur les documents qui portent un congé — décision documentée dans
     `ui-document.js`. Ce mois n'en a aucun. Ne pas l'exiger ici, c'est
     respecter cette décision plutôt que de la contredire depuis un test neuf. */

  /* ==================================================================== */
  /* §20.4 d — L'ÉCRAN DE LA PÉRIODE (A9)                                 */
  /* ==================================================================== */
  console.log('\n--- §20.4 d : l’écran de la période, jour par jour ---');

  window.App.aller('familiarisation', { contratId: 'c-noah' });
  await pause(400);
  contient(corps, 'Seules les heures déclarées sont payées', 'la règle est dite');
  contient(corps, '7,20 € brut de l’heure', 'avec le taux, rejoué par le moteur');
  contient(corps, 'Jour par jour', 'le jour par jour est là');
  contient(corps, 'à déclarer', 'A9 : un jour passé sans saisie dit « à déclarer »');
  contient(corps, 'à venir', 'A9 : et un jour futur dit « à venir »');
  contient(corps, 'Total déclaré', 'le total est affiché');
  contient(corps, '2h30 — 18,00 € brut', 'et son montant vient du moteur');
  contient(corps, '1 jour déclaré sur 14',
    'le compte des jours ouvrés de la période est exact');

  /* Toucher un jour passé ouvre sa feuille, dans l'espace de l'enfant. */
  var ligneJour = Array.prototype.filter.call(
    corps.querySelectorAll('.fld[role="button"]'), function (f) {
      return txt(f).indexOf('à déclarer') !== -1;
    })[0];
  assert(!!ligneJour, 'A9 : le jour « à déclarer » est touchable');
  ligneJour.click();
  await pause(500);
  contient(sheet, 'Familiarisation — ', 'et il ouvre bien la feuille du jour');
  window.Kit.fermerFeuille();
  await pause(120);

  /* ==================================================================== */
  /* §20.4 — LA PÉRIODE SE VERROUILLE SUR UN MOIS CLÔTURÉ, ET LE NOMME    */
  /* ==================================================================== */
  console.log('\n--- §20.4 : le refus nomme les mois clôturés ---');

  recaps = [{ id: 'r1', contrat_id: 'c-noah', annee: 2026, mois: 9, statut: 'fige',
              fige_le: '2026-10-01T09:00:00Z', donnees: {} }];
  window.App.invalider();
  window.App.aller('familiarisation', { contratId: 'c-noah' });
  await pause(400);
  contient(corps, 'Période non modifiable', 'la période est verrouillée');
  contient(corps, 'septembre 2026', 'et le refus NOMME le mois clôturé');
  assert(!boutonExact(corps, 'Corriger les dates'),
    'aucune action de correction n’est proposée');
  recaps = [];
  window.App.invalider();

  /* ==================================================================== */
  /* §20.6 — L'INTERRUPTEUR D'ENTRETIEN, SEULEMENT HORS DU CADRE          */
  /* ==================================================================== */
  console.log('\n--- §20.6 : l’entretien ne se retire pas d’une journée complète ---');

  /* Le jeudi 20 août : hors de toute période, journée de garde ordinaire, et
     PASSÉE — on ne saisit pas l'avenir (V8-05). */
  window.App.aller('enfant', { contratId: 'c-noah', annee: 2026, mois: 8 });
  await pause(400);
  var cell20 = celluleDu(20);
  assert(!!(cell20 && cell20.getAttribute('role') === 'button'),
    'le 20 août est une journée de garde ordinaire, touchable');
  cell20.click();
  await pause(250);
  absent(sheet, 'Indemnité d’entretien du jour',
    '§20.6 A1 : aucun interrupteur sur une journée sans écart déclaré');

  /* EXIGENCE CHANGÉE — la feuille du jour est refaite comme la maquette
     (23 août) : le volet replié `details.ajuster` a disparu, l'événement se
     choisit dans la liste et l'heure se saisit à la minute. Le COMPORTEMENT
     vérifié ci-dessous — l'interrupteur d'entretien n'existe que hors du
     cadre, « Comptée » par défaut, le retrait écrit en base — ne change pas
     d'un mot. */
  var choixLib = Array.prototype.filter.call(sheet.querySelectorAll('.choice'),
    function (x) { return txt(x).indexOf('J’ai libéré plus tôt') !== -1; })[0];
  assert(!!choixLib, 'le choix « j’ai libéré plus tôt » est dans la liste');
  choixLib.click();
  await pause(200);
  var champH = sheet.querySelector('.detail-choix input[type="time"]');
  assert(!!champH, 'l’heure de départ se saisit à la minute près');
  champH.value = '17:00';
  champH.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  champH.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await pause(200);
  contient(sheet, 'Indemnité d’entretien du jour',
    '§20.6 : l’interrupteur apparaît dès que la journée sort du cadre');
  contient(sheet, 'La journée sort du cadre',
    'et il dit pourquoi il est là');
  contient(sheet, 'salaire et vos minutes ne bougent pas',
    '§20.6 A2 : il dit ce qu’il ne change pas');

  /* « Comptée » est présélectionné : retirer est un choix, jamais un
     automatisme. */
  var comptee = boutonContenant(sheet, 'Comptée');
  assert(comptee && comptee.className.indexOf('on') !== -1,
    '§20.6 : « Comptée » est coché par défaut');

  boutonContenant(sheet, 'Non comptée').click();
  await pause(150);
  boutonExact(sheet, 'Enregistrer').click();
  await pause(500);
  var ecart = ecritures.journees[ecritures.journees.length - 1];
  egal(ecart.entretien_du, false, '§20.6 : le retrait est bien écrit');
  egal(ecart.ecart_evenement, 'liberation_anticipee', 'avec son événement');

  /* Et le document le DIT, avec un détail qui reconstitue le total. */
  window.App.aller('document', { contratId: 'c-noah', annee: 2026, mois: 8 });
  await pause(500);
  contient(corps, '+ 1 jour sans indemnité',
    '§20.6 A3 : le document nomme la journée sans indemnité');
  contient(corps, '20 jours × 5,50 €',
    '§20.6 A3 : et le détail reconstitue le total — 21 jours de présence, ' +
    'moins celui dont l’indemnité a été retirée');

  /* ==================================================================== */
  /* CORRECTION B3 — LE REJEU DE L'ESPACE ENFANT VOIT LA PÉRIODE          */
  /* ==================================================================== */
  console.log('\n--- B3 : l’aperçu d’un geste annonce l’écart du GESTE ---');

  /* On se place à la fin du mois pour que le 22 septembre soit une journée
     passée, donc touchable — on ne saisit pas l'avenir (V8-05). */
  window.App.aujourdhui = function () { return '2026-09-30'; };
  journees['2026-09-22'] = {
    id: 'j-2026-09-22', contrat_id: 'c-noah', jour: '2026-09-22',
    type: 'absence_enfant', minutes_reelles: null, entretien_centimes: null,
    commentaire: null, entretien_du: true,
    minutes_sup_exceptionnelles: 0, minutes_sup_renoncees: 0, sup_dues_override: null,
    ecart_minutes: null, ecart_evenement: null, ecart_heure_reelle: null,
    ecart_impute_sur: null
  };
  window.App.invalider();
  window.App.aller('enfant', { contratId: 'c-noah', annee: 2026, mois: 9 });
  await pause(500);

  var cell22 = celluleDu(22);
  assert(!!(cell22 && cell22.getAttribute('role') === 'button'),
    'le 22 septembre est touchable');
  cell22.click();
  await pause(250);

  /* AVANT LA CORRECTION : « + 82,50 € ». Le rejeu ne recevait pas la période,
     voyait quinze journées mensualisées de plus que la réalité, et l'écart
     annoncé était celui de l'oubli, pas celui du geste. */
  /* EXIGENCE DÉPLACÉE, PAS AFFAIBLIE — l'aperçu du retour en présence était
     porté par la carte « Noah était là », retirée le 23 août. Il est
     maintenant sous le choix qui fait ce geste. Le chiffre exigé est le même,
     et il vient du même rejeu. */
  var choixRetour = Array.prototype.filter.call(sheet.querySelectorAll('.choice'),
    function (x) { return txt(x).indexOf('Finalement, rien de particulier') !== -1; })[0];
  assert(!!choixRetour, 'B3 : le geste de retour en journée ordinaire est offert');
  choixRetour.click();
  await pause(200);
  contient(sheet, 'Entretien de la journée rétabli (+5,50 €)',
    'B3 : l’aperçu annonce l’entretien d’UNE journée, pas celui de quinze');
  absent(sheet, '82,50 €', 'B3 : et surtout pas le montant de l’oubli');
  window.Kit.fermerFeuille();
  await pause(120);

  /* Le garde-fou : `simulerLignes` et la chaîne doivent voir le même jeu de
     clés. C'est la troisième fois que cet appel oublie un argument. */
  console.log('\n--- B3 : le garde-fou du rejeu ---');
  var ancien = window.ChaineMois.calculerMoisAvecRepli;
  var vues = null;
  window.ChaineMois.calculerMoisAvecRepli = function (params) {
    vues = Object.keys(params).sort();
    return ancien(params);
  };
  window.App.aller('enfant', { contratId: 'c-noah', annee: 2026, mois: 9 });
  await pause(500);
  celluleDu(22).click();
  await pause(250);
  window.ChaineMois.calculerMoisAvecRepli = ancien;
  egal((vues || []).join(','),
    'annee,compteurEntree,conditions,contrat,imputations,journees,mois,periodesFamiliarisation',
    'B3 : le rejeu passe exactement les mêmes entrées que la chaîne');
  window.Kit.fermerFeuille();
  await pause(120);

  /* ==================================================================== */
  /* CORRECTION C4 — UNE PÉRIODE À CHEVAL SE TOTALISE MOIS PAR MOIS       */
  /* ==================================================================== */
  console.log('\n--- C4 : chaque mois est payé au taux de SON avenant ---');

  /* Un second avenant au 1er septembre : 1 560,00 € brut sur 195 h, soit
     8,00 € de l'heure pile. Août reste à 7,20 €. */
  AVENANTS.push(Decor.avenantDe(NOAH, {
    id: 'a2', date_effet: '2026-09-01',
    brut_mensuel_centimes: 156000, net_mensuel_centimes: 119000
  }));
  AVENANTS[1].numero = 2;

  periodes = [{ id: 'p2', contrat_id: 'c-noah',
                date_debut: '2026-08-24', date_fin: '2026-09-04' }];
  journees['2026-08-25'] = {
    id: 'j1', contrat_id: 'c-noah', jour: '2026-08-25', type: 'familiarisation',
    minutes_reelles: 120, entretien_centimes: null, commentaire: null, entretien_du: true
  };
  journees['2026-09-02'] = {
    id: 'j2', contrat_id: 'c-noah', jour: '2026-09-02', type: 'familiarisation',
    minutes_reelles: 120, entretien_centimes: null, commentaire: null, entretien_du: true
  };
  window.App.invalider();
  window.App.aller('familiarisation', { contratId: 'c-noah' });
  await pause(500);

  contient(corps, 'traverse un changement de conditions',
    'C4 : l’écran DIT que la période traverse un avenant, au lieu de le taire');
  contient(corps, 'Août 2026', 'C4 : le détail est découpé par mois');
  contient(corps, 'Septembre 2026', 'C4 : les deux mois sont nommés');

  /* 2 h à 7,20 € = 14,40 € en août, 2 h à 8,00 € = 16,00 € en septembre.
     AVANT LA CORRECTION : tout au taux d'août, soit 4 h × 7,20 € = 28,80 €. */
  contient(corps, '4h00 — 30,40 € brut',
    'C4 : le total additionne deux mois calculés chacun à SON taux');
  absent(corps, '28,80 €', 'C4 : et surtout pas tout au taux du premier mois');
  contient(corps, '2 jours déclarés sur 10', 'C4 : le compte des jours ouvrés couvre les deux mois');

  console.log('\n' + (echecs ? echecs + ' échec(s).' : 'Tout est conforme.'));
  process.exit(echecs ? 1 : 0);
})().catch(function (e) {
  console.error('Erreur pendant le parcours : ' + (e && e.stack || e));
  process.exit(1);
});
