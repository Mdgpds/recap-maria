/* ============================================================================
   lot5-periode-contrat.smoke.js — Non-régression de l'anomalie B1.

   « Le récapitulatif de période compte un mois de salaire complet pour chaque
     mois où le contrat n'existait plus. »

   Contrat du 01/09/2025 au 31/03/2026, année de bilan 2025 (sept. 2025 →
   août 2026). Le moteur ne compte aucune journée après le 31 mars — mais il
   renvoie quand même le net du barème applicable, parce que salaireApplicable
   ne connaît pas la date de fin du contrat. Additionné cinq fois de plus, cela
   donnait 13 609,00 € au lieu de 8 249,00 € sur le document même qui sert de
   pièce justificative après le départ d'une famille.

   Attendu : 7 mois, 7 504,00 € de salaires nets, 8 249,00 € versés, et la
   période affichée est celle réellement couverte.

   Lancement : node test/lot5-periode-contrat.smoke.js  (nécessite jsdom).
   ========================================================================= */
'use strict';

var JSDOM = require('jsdom').JSDOM;
var dom = new JSDOM('<!DOCTYPE html><body><main id="periode"></main></body>', { url: 'https://exemple.test/' });
global.window = dom.window;
global.document = dom.window.document;
window.confirm = function () { return true; };

var echecs = 0;
function assert(cond, msg) { if (!cond) { echecs++; console.error('FAIL ' + msg); } else console.log('ok   ' + msg); }

window.Feries = require('../js/feries.js');
window.Format = require('../js/format.js');
window.Engine = require('../js/engine.js');
window.Messages = require('../js/messages.js');

/* Montants FICTIFS (dépôt public). */
var BRUT = 137289, NET = 107200;

var termine = {
  id: 'c1', prenom_enfant: 'Alpha', famille_id: 'f1', famille: { id: 'f1', nom: 'Papillon' },
  jours_planning: [1, 2, 3, 4, 5], date_debut: '2025-09-01', date_fin: '2026-03-31', archive: true,
  minutes_sup_jour: 30, minutes_par_jour_conge: 540, entretien_centimes_jour: 500,
  ordre_imputation: 'cp_puis_sup', sup_dues_si_enfant_absent: true
};
/* Contrat commencé APRÈS le début de la période : l'autre moitié du même
   défaut (mois antérieurs au contrat comptés eux aussi). */
var tardif = {
  id: 'c2', prenom_enfant: 'Bravo', famille_id: 'f2', famille: { id: 'f2', nom: 'Libellule' },
  jours_planning: [1, 2, 3, 4, 5], date_debut: '2026-01-01', date_fin: null, archive: false,
  minutes_sup_jour: 30, minutes_par_jour_conge: 540, entretien_centimes_jour: 500,
  ordre_imputation: 'cp_puis_sup', sup_dues_si_enfant_absent: true
};
/* Contrat entièrement hors de la période demandée. */
var ailleurs = {
  id: 'c3', prenom_enfant: 'Charlie', famille_id: 'f3', famille: { id: 'f3', nom: 'Hirondelle' },
  jours_planning: [1, 2, 3, 4, 5], date_debut: '2020-01-01', date_fin: '2021-06-30', archive: true,
  minutes_sup_jour: 30, minutes_par_jour_conge: 540, entretien_centimes_jour: 500,
  ordre_imputation: 'cp_puis_sup', sup_dues_si_enfant_absent: true
};

var DB = {
  listContratsTous: function () { return Promise.resolve([termine, tardif, ailleurs]); },
  listContratsPourPeriode: function () { return Promise.resolve([termine, tardif]); },
  getSalaires: function () {
    return Promise.resolve([{ id: 's1', date_effet: '2025-09-01', brut_mensuel_centimes: BRUT, net_mensuel_centimes: NET }]);
  },
  getCompteurInitial: function () { return Promise.resolve(null); },
  getJourneesPeriode: function () { return Promise.resolve({}); },
  listRecapsPeriode: function () { return Promise.resolve([]); }
};
window.DB = DB;
global.DB = DB;
window.ChaineMois = require('../js/chaine-mois.js');
/* Mois courant simulé : août 2026, comme dans le scénario du rapport. */
window.App = { moisCourant: function () { return { annee: 2026, mois: 8 }; } };

require('../js/ui-periode.js');
var UiPeriode = window.UiPeriode;
var conteneur = document.getElementById('periode');

function parTexte(racine, selecteur, texte) {
  return Array.prototype.filter.call(racine.querySelectorAll(selecteur), function (e) {
    return e.textContent.indexOf(texte) !== -1;
  })[0];
}
function attendre(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
/* Format.centimesEnEuros sépare les milliers par une espace INSÉCABLE (pour
   ne pas couper un montant dans WhatsApp) : on la normalise avant comparaison. */
function normal(txt) { return String(txt).replace(/\u00a0/g, ' '); }

UiPeriode.init({ conteneur: conteneur });
UiPeriode.afficher().then(function () {
  var selects = conteneur.querySelectorAll('select');
  selects[0].value = 'bilan';            // année de bilan
  selects[0].onchange();
  return attendre(10);
}).then(function () {
  var anneeBilan = conteneur.querySelectorAll('#bornes-periode select')[0];
  anneeBilan.value = '2025';             // sept. 2025 → août 2026
  parTexte(conteneur, 'button', 'Calculer').click();
  return attendre(400);
}).then(function () {
  var cible = document.getElementById('resultats-periode');
  var cartes = cible.querySelectorAll('.carte-contrat');
  /* La première carte est la vue d'ensemble ; les documents par contrat sont
     ceux qui portent un texte transmissible. */
  var documents = Array.prototype.filter.call(cartes, function (c) {
    return !!c.querySelector('.wa-texte');
  });
  var docAlpha = documents.filter(function (c) {
    return c.textContent.indexOf('Alpha') !== -1;
  })[0];
  assert(!!docAlpha, 'un document est produit pour le contrat terminé');

  var t = normal(docAlpha.textContent);
  assert(t.indexOf('septembre 2025 → mars 2026') !== -1,
    'B1 : la période affichée est celle RÉELLEMENT couverte, pas celle demandée');
  assert(t.indexOf('7 mois') !== -1, 'B1 : 7 mois retenus, pas 12');
  assert(t.indexOf('7 504,00') !== -1, 'B1 : salaires nets = 7 × 1 072,00 € = 7 504,00 €');
  assert(t.indexOf('8 249,00') !== -1, 'B1 : total versé = 8 249,00 € (et non 13 609,00 €)');
  assert(t.indexOf('13 609,00') === -1, 'B1 : les cinq mois post-contrat n’apparaissent nulle part');

  assert(t.indexOf('ne couvre que 7 des 12 mois') !== -1,
    'A1 : l’avertissement de couverture partielle s’affiche vraiment');
  assert(t.indexOf('31/03/2026') !== -1, 'A1 : l’avertissement rappelle les dates du contrat');

  var wa = docAlpha.querySelector('.wa-texte');
  assert(!!wa && normal(wa.value).indexOf('septembre 2025 → mars 2026') !== -1,
    'B1 : le document remis aux parents porte lui aussi la période couverte');
  assert(normal(wa.value).indexOf('8 249,00') !== -1, 'B1 : le document parents porte le bon total');

  var docBravo = documents.filter(function (c) {
    return c.textContent.indexOf('Bravo') !== -1;
  })[0];
  assert(!!docBravo, 'un document est produit pour le contrat commencé en cours de période');
  assert(docBravo.textContent.indexOf('janvier 2026 → août 2026') !== -1,
    'B1 : les mois antérieurs au contrat sont écartés eux aussi');
  assert(docBravo.textContent.indexOf('ne couvre que 8 des 12 mois') !== -1,
    'A1 : couverture partielle signalée pour le contrat tardif');

  var ensemble = cartes[0].textContent;
  assert(ensemble.indexOf('Vue d’ensemble') !== -1, 'la vue d’ensemble est en tête');
  assert(ensemble.indexOf('septembre 2025 → mars 2026') !== -1,
    'la vue d’ensemble indique la période couverte par chaque contrat');

  return null;
}).then(function () {
  /* Contrat entièrement hors période, choisi nommément : il contourne
     listContratsPourPeriode, donc c'est le dernier endroit où le défaut
     pouvait subsister. */
  var selects = conteneur.querySelectorAll('select');
  selects[1].value = 'c3';
  parTexte(conteneur, 'button', 'Calculer').click();
  return attendre(300);
}).then(function () {
  var cible = document.getElementById('resultats-periode');
  var t = cible.textContent;
  assert(t.indexOf('n’était pas sous contrat sur cette période') !== -1,
    'B1 : un contrat hors période choisi nommément est refusé, avec explication');
  assert(cible.querySelectorAll('.wa-texte').length === 0,
    'B1 : aucun document transmissible n’est produit pour un contrat hors période');

  console.log('\n' + (echecs === 0 ? 'Tout est conforme.' : echecs + ' échec(s).'));
  process.exit(echecs === 0 ? 0 : 1);
}).catch(function (e) { console.error('Erreur :', e); process.exit(1); });
