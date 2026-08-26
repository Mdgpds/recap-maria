/* ============================================================================
   Test de fumée — LOT 29, LA JOURNÉE QUI SE CORRIGE VRAIMENT.

   « Si j'ai mis absent je ne peux pas vraiment corriger et dire que l'enfant
   est parti plus tôt, et inversement. » (Adrien). La règle du §29.2 : une
   journée porte un seul état ; changer cet état efface ce qui n'a plus de
   sens — et l'application le dit avant de le faire.

   Ce fichier monte le vrai `index.html` et rejoue les cinq cas du §29.4 :

     A1  absence, puis départ à 17h00 : la journée devient une présence avec
         son écart, l'écran l'a annoncé, l'absence a disparu ;
     A2  départ à 17h00, puis absence : l'écart est effacé, l'entretien est
         rendu, l'écran l'a annoncé avant ;
     A3  aucune écriture ne porte à la fois `absence_enfant` et un écart ;
     A4  (moteur) une ligne ancienne portant les deux ne produit rien ;
     A5  la note survit aux deux gestes ;
     A6  « Annuler » rend l'état exact d'avant, écart et indemnité compris ;
     +   un jour de congé posé : ni écart ni absence, le renvoi reste.

   Décor : Léa, juin 2026, journée 8h30 → 17h30 + 30 min (référence 18h00).
   Valeurs FICTIVES (dépôt public).

   Lancement : node test/lot29-journee.smoke.js
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
var PLANNING = [1, 2, 3, 4, 5];
var LEA = {
  id: 'c-lea', prenom_enfant: 'Léa', famille_id: 'f1',
  famille: { id: 'f1', nom: 'Papillon' },
  date_debut: '2024-09-01', date_fin: null,
  minutes_contractuelles: 540, minutes_sup_jour: 30, minutes_par_jour_conge: 540,
  entretien_centimes_jour: 500, jours_planning: PLANNING,
  heure_arrivee: '08:30:00', heure_depart: '17:30:00', statut: 'actif',
  sup_dues_si_enfant_absent: true, ordre_imputation: 'cp_puis_sup', archive: false,
  nom: null, genre: 'f', couleur: null, photo: null
};
var AVENANTS = [Decor.avenantDe(LEA, { id: 's1', date_effet: '2024-09-01',
  brut_mensuel_centimes: 150000, net_mensuel_centimes: 115000 })];
AVENANTS[0].numero = 1;

/* La base simulée : un vrai upsert, colonne par colonne, comme `db.js` le
   décrit — une colonne absente de la charge utile est conservée. C'est
   précisément le mécanisme qui laissait survivre l'écart (§29.1, sens 2). */
var journees = {};
var ecritures = [];
var supprimees = [];
function upsert(l) {
  ecritures.push(JSON.parse(JSON.stringify(l)));
  var garde = journees[l.jour] || {};
  var ligne = { id: 'j-' + l.jour, contrat_id: l.contrat_id, jour: l.jour, type: l.type };
  ['minutes_reelles', 'entretien_centimes', 'commentaire', 'entretien_du',
   'minutes_sup_exceptionnelles', 'minutes_sup_renoncees', 'sup_dues_override',
   'ecart_minutes', 'ecart_evenement', 'ecart_heure_reelle', 'ecart_impute_sur']
    .forEach(function (k) {
      ligne[k] = Object.prototype.hasOwnProperty.call(l, k) && l[k] !== undefined ? l[k] : garde[k];
      if (ligne[k] === undefined) ligne[k] = null;
    });
  if (ligne.entretien_du == null) ligne.entretien_du = true;
  if (ligne.minutes_sup_exceptionnelles == null) ligne.minutes_sup_exceptionnelles = 0;
  if (ligne.minutes_sup_renoncees == null) ligne.minutes_sup_renoncees = 0;
  journees[l.jour] = ligne;
  return Promise.resolve(ligne);
}
function copie(o) { var r = {}; Object.keys(o).forEach(function (k) { r[k] = o[k]; }); return r; }

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
  getCompteurInitial: function (id) {
    return Promise.resolve({ contrat_id: id, date_reference: '2024-09-01',
      minutes_sup: 600, minutes_cp_acquis: 5400, minutes_cp_pris: 0 });
  },
  getJourneesMois: function () { return Promise.resolve(copie(journees)); },
  getJourneesPeriode: function () { return Promise.resolve({ '2026-06': copie(journees) }); },
  listImputations: function () { return Promise.resolve([]); },
  listImputationsPourMois: function () { return Promise.resolve([]); },
  listSamedisConge: function () { return Promise.resolve([]); },
  compterSamedisAnnee: function () { return Promise.resolve(0); },
  getNoteMensuelle: function () { return Promise.resolve(null); },
  listRecapsPeriode: function () { return Promise.resolve([]); },
  listPeriodesFamiliarisation: function () { return Promise.resolve([]); },
  listPeriodesFamiliarisationContrat: function () { return Promise.resolve([]); },
  listRecapsContrat: function () { return Promise.resolve([]); },
  getRecap: function () { return Promise.resolve(null); },
  enregistrerJournee: upsert,
  supprimerJournee: function (c, j) { supprimees.push(j); delete journees[j]; return Promise.resolve(true); },
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

window.App.moisCourant = function () { return { annee: 2026, mois: 6 }; };
window.App.aujourdhui = function () { return '2026-06-30'; };

var corps = document.getElementById('corps');
var sheet = document.getElementById('sheet');
var toast = document.getElementById('toast');

async function ouvrirEnfant() {
  window.App.invalider();
  window.App.aller('enfant', { contratId: 'c-lea', annee: 2026, mois: 6 });
  await pause(320);
}
async function ouvrirJour(numero) {
  var td = Array.prototype.filter.call(
    corps.querySelectorAll('table.cal td[role="button"]'), function (x) {
      return txt(x.querySelector('.num')) === String(numero);
    })[0];
  if (!td) return null;
  td.click();
  await pause(220);
  return td;
}
function choixParLibelle(morceau) { return parTexte(sheet, '.choice', morceau); }
function champHeure() { return sheet.querySelector('.detail-choix input[type="time"]'); }
function poserHeure(valeur) {
  var i = champHeure();
  i.value = valeur;
  i.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  i.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
}
function boutonEnregistrer() { return boutonExact(sheet, 'Enregistrer'); }
function derniere() { return ecritures[ecritures.length - 1]; }
function porteLesDeux(l) {
  return l.type === 'absence_enfant' && !!(l.ecart_evenement || l.ecart_minutes);
}

(async function () {
  document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  await pause(300);

  /* ==================================================================== */
  /* A1 — ABSENCE, PUIS « J'AI LIBÉRÉ PLUS TÔT » À 17H00                  */
  /* ==================================================================== */
  console.log('\n--- A1 : absence, puis départ à 17h00 ---');
  journees['2026-06-08'] = { id: 'j8', contrat_id: 'c-lea', jour: '2026-06-08',
    type: 'absence_enfant', commentaire: 'rendez-vous chez le médecin', entretien_du: true };
  await ouvrirEnfant();
  await ouvrirJour(8);
  var libere = choixParLibelle('libéré plus tôt');
  assert(!!libere, 'A1 : sur une absence, « j’ai libéré plus tôt » est proposé — on peut corriger');
  libere.click();
  await pause(150);
  contient(sheet, 'L’absence de Léa sera retirée',
    'A1 : l’écran annonce, AVANT validation, que l’absence sera retirée');
  contient(sheet, 'la journée redevient une présence', 'A1 : et ce que la journée devient');
  poserHeure('17:00');
  await pause(150);
  contient(sheet, 'sur votre cumul du mois',
    'A1 : l’effet est rejoué sur une PRÉSENCE — le temps rendu pèse sur le cumul');
  boutonEnregistrer().click();
  await pause(300);
  var e1 = derniere();
  egal(e1.type, 'presence', 'A1 : la journée est écrite en présence');
  egal(e1.ecart_minutes, -60, 'A1 : avec son écart de −60');
  egal(e1.ecart_evenement, 'liberation_anticipee', 'A1 : nommé');
  egal(e1.commentaire, 'rendez-vous chez le médecin', 'A5 : la note survit');
  egal(journees['2026-06-08'].type, 'presence', 'A1 : en base, l’absence a disparu');
  assert(!porteLesDeux(journees['2026-06-08']), 'A3 : la ligne ne porte pas les deux');
  await pause(120);
  assert(txt(corps).indexOf('absent') === -1 || !parTexte(corps, 'table.cal td', 'absent'),
    'A1 : le calendrier ne dit plus « absent » le 8');

  /* --- A6 : « Annuler » rend l'absence, sans écart --- */
  var bAnnuler = toast.querySelector('button');
  assert(!!bAnnuler && txt(bAnnuler).indexOf('Annuler') !== -1, 'A6 : « Annuler » est proposé');
  bAnnuler.click();
  await pause(300);
  var r1 = journees['2026-06-08'];
  egal(r1.type, 'absence_enfant', 'A6 : l’absence est de retour');
  egal(r1.ecart_evenement, null, 'A6 : sans écart');
  egal(r1.ecart_minutes, null, 'A6 : sans minutes d’écart');
  egal(r1.commentaire, 'rendez-vous chez le médecin', 'A6 : la note aussi');

  /* ==================================================================== */
  /* A2 — DÉPART À 17H00, PUIS ABSENCE                                    */
  /* ==================================================================== */
  console.log('\n--- A2 : départ à 17h00, puis absence ---');
  journees['2026-06-09'] = { id: 'j9', contrat_id: 'c-lea', jour: '2026-06-09',
    type: 'presence', ecart_minutes: -60, ecart_evenement: 'liberation_anticipee',
    ecart_heure_reelle: '17:00:00', ecart_impute_sur: 'recuperation',
    entretien_du: false, commentaire: 'parti tôt' };
  await ouvrirEnfant();
  await ouvrirJour(9);
  var absence = choixParLibelle('Absence de Léa');
  assert(!!absence, 'A2 : l’absence est proposée sur une journée qui porte un écart');
  absence.click();
  await pause(150);
  contient(sheet, 'La déclaration de 17h00 sera retirée',
    'A2 : l’écran annonce, AVANT, que la déclaration de 17h00 sera retirée');
  boutonEnregistrer().click();
  await pause(300);
  var e2 = derniere();
  egal(e2.type, 'absence_enfant', 'A2 : la journée est écrite absente');
  egal(e2.ecart_minutes, null, 'A2 : l’écart est effacé — minutes');
  egal(e2.ecart_evenement, null, 'A2 : — événement');
  egal(e2.ecart_heure_reelle, null, 'A2 : — heure');
  egal(e2.ecart_impute_sur, null, 'A2 : — destination');
  egal(e2.entretien_du, true, 'A2 : l’indemnité est rendue (entretien_du = true)');
  egal(e2.commentaire, 'parti tôt', 'A5 : la note survit');
  assert(!porteLesDeux(journees['2026-06-09']), 'A3 : la ligne en base ne porte pas les deux');

  /* --- A6 : « Annuler » rend l'écart ET l'indemnité retirée --- */
  var bAnnuler2 = toast.querySelector('button');
  assert(!!bAnnuler2, 'A6 : « Annuler » est proposé');
  bAnnuler2.click();
  await pause(300);
  var r2 = journees['2026-06-09'];
  egal(r2.type, 'presence', 'A6 : la présence est de retour');
  egal(r2.ecart_minutes, -60, 'A6 : avec son écart de −60');
  egal(r2.ecart_evenement, 'liberation_anticipee', 'A6 : nommé');
  egal(r2.entretien_du, false, 'A6 : et l’indemnité retirée est de nouveau retirée — l’état EXACT d’avant');
  egal(r2.commentaire, 'parti tôt', 'A6 : la note aussi');

  /* ==================================================================== */
  /* A3 — AUCUNE ÉCRITURE NE PORTE LES DEUX                               */
  /* ==================================================================== */
  console.log('\n--- A3 : aucune écriture ne porte les deux ---');
  var fautives = ecritures.filter(porteLesDeux);
  egal(fautives.length, 0, 'A3 : sur ' + ecritures.length + ' écritures, aucune n’envoie absence + écart');
  var fautivesBase = Object.keys(journees).filter(function (k) { return porteLesDeux(journees[k]); });
  egal(fautivesBase.length, 0, 'A3 : et aucune ligne en base ne porte les deux');

  /* ==================================================================== */
  /* A4 — UNE LIGNE ANCIENNE PORTANT LES DEUX NE PRODUIT RIEN            */
  /* ==================================================================== */
  console.log('\n--- A4 : le moteur ignore une ligne ancienne ---');
  var ancienne = { jour: '2026-06-10', type: 'absence_enfant', ecart_minutes: -60,
    ecart_evenement: 'liberation_anticipee', ecart_impute_sur: 'conges_payes',
    minutes_sup_exceptionnelles: 45 };
  egal(Engine.minutesSupDuJour(ancienne, AVENANTS[0]), 0, 'A4 : zéro minute');
  var det = Engine.detailSupDuJour(ancienne, AVENANTS[0]);
  egal(det.ecart, 0, 'A4 : l’écart est ignoré');
  egal(det.minutesSurCp, 0, 'A4 : rien sur les congés payés');
  egal(det.ajoutees, 0, 'A4 : rien d’ajouté non plus');
  var sansRien = Engine.calculerMois({ contrat: LEA, conditions: AVENANTS[0],
    journees: [{ jour: '2026-06-10', type: 'absence_enfant' }],
    compteurEntree: { minutesSup: 0, minutesCpAcquis: 5400, minutesCpPris: 0 }, annee: 2026, mois: 6 });
  var avecLesDeux = Engine.calculerMois({ contrat: LEA, conditions: AVENANTS[0],
    journees: [ancienne],
    compteurEntree: { minutesSup: 0, minutesCpAcquis: 5400, minutesCpPris: 0 }, annee: 2026, mois: 6 });
  egal(JSON.stringify(avecLesDeux.compteurSortie), JSON.stringify(sansRien.compteurSortie),
    'A4 : le mois est identique à une absence nue — compteurs compris');
  egal(avecLesDeux.ecartsDeclares.length, 0, 'A4 : et le document n’en dit rien');

  /* ==================================================================== */
  /* + — UN JOUR DE CONGÉ POSÉ : NI ÉCART NI ABSENCE, LE RENVOI RESTE     */
  /* ==================================================================== */
  console.log('\n--- congé posé : ni écart ni absence ---');
  journees['2026-06-11'] = { id: 'j11', contrat_id: 'c-lea', jour: '2026-06-11',
    type: 'conge_maria', entretien_du: true };
  await ouvrirEnfant();
  await ouvrirJour(11);
  assert(!choixParLibelle('libéré plus tôt'), 'congé : aucune déclaration d’horaire proposée');
  assert(!choixParLibelle('Absence de Léa'), 'congé : aucune absence proposée');
  contient(sheet, 'Mes congés', 'congé : le renvoi vers « Mes congés » reste');
  window.Kit.fermerFeuille();
  await pause(100);

  /* Et sur un congé posé À L'HEURE, l'absence n'est plus offerte : elle
     effacerait le congé, qui ne se retire que depuis « Mes congés ». */
  journees['2026-06-12'] = { id: 'j12', contrat_id: 'c-lea', jour: '2026-06-12',
    type: 'presence', ecart_minutes: -94, ecart_evenement: 'conge_horaire',
    ecart_impute_sur: 'conges_payes', entretien_du: true };
  await ouvrirEnfant();
  await ouvrirJour(12);
  assert(!choixParLibelle('Absence de Léa'),
    'congé à l’heure : l’absence n’est pas offerte, elle effacerait le congé');
  contient(sheet, 'Mes congés', 'congé à l’heure : le renvoi vers « Mes congés » reste');
  window.Kit.fermerFeuille();

  console.log('');
  if (echecs) { console.error(echecs + ' échec(s).'); process.exit(1); }
  console.log('Tout est conforme.');
  process.exit(0);
})().catch(function (e) {
  console.error('Erreur pendant le parcours : ' + (e && e.stack || e));
  process.exit(1);
});
