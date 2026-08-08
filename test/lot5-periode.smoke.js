/* ============================================================================
   lot5-periode.smoke.js — Test de fumée du récapitulatif de période (C6).

   Vérifie sur le VRAI moteur et la VRAIE chaîne des mois que :
   - une période produit une vue d'ensemble + un document par contrat ;
   - les compteurs sont présentés en solde d'entrée et solde de sortie, jamais
     additionnés ;
   - le récapitulatif de période ne propose AUCUN figement (il est dérivé des
     mois, seuls ceux-ci font foi) ;
   - les mois provisoires sont signalés.

   Lancement : node test/lot5-periode.smoke.js  (nécessite jsdom en dev).
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

function contrat(id, prenom) {
  return {
    id: id, prenom_enfant: prenom, famille_id: 'f1', famille: { id: 'f1', nom: 'Papillon' },
    jours_planning: [1, 2, 3, 4, 5], date_debut: '2026-01-01', date_fin: null, archive: false,
    minutes_sup_jour: 30, minutes_par_jour_conge: 540, entretien_centimes_jour: 500,
    ordre_imputation: 'cp_puis_sup', sup_dues_si_enfant_absent: true
  };
}
var contrats = [contrat('c1', 'Alpha'), contrat('c2', 'Beta')];

/* Janvier 2026 figé, le reste provisoire. */
var recapJanvier = {
  id: 'r1', contrat_id: 'c1', annee: 2026, mois: 1, statut: 'fige', fige_le: '2026-02-01T09:00:00Z',
  donnees: {
    joursPresence: 22, entretienCentimes: 11000, minutesSupAcquises: 660, joursCongesDecomptes: 0,
    imputation: { joursSurCp: 0, joursSurSup: 0, joursSansSolde: 0, minutesSupConsommees: 0, dixiemesCpConsommes: 0 },
    retenueSansSoldeCentimes: 0, dixiemesCpAcquis: 25,
    salaireBrutCentimes: 195000, salaireNetCentimes: 150000, salaireDateEffet: '2026-01-01',
    prenomEnfant: 'Alpha', nomFamille: 'Papillon', totalAVerserCentimes: 161000,
    compteurSortie: { minutesSup: 660, dixiemesCpAcquis: 25, dixiemesCpPris: 0 }
  }
};

var DB = {
  listContratsTous: function () { return Promise.resolve(contrats); },
  listContratsPourPeriode: function () { return Promise.resolve(contrats); },
  getSalaires: function () {
    return Promise.resolve([{ id: 's1', date_effet: '2026-01-01', brut_mensuel_centimes: 195000, net_mensuel_centimes: 150000 }]);
  },
  getCompteurInitial: function () { return Promise.resolve(null); },
  getJourneesPeriode: function () { return Promise.resolve({}); },
  listRecapsPeriode: function (id) { return Promise.resolve(id === 'c1' ? [recapJanvier] : []); }
};
window.DB = DB;
global.DB = DB;
window.ChaineMois = require('../js/chaine-mois.js');
window.App = {
  moisCourant: function () { return { annee: 2026, mois: 8 }; }
};

require('../js/ui-periode.js');
var UiPeriode = window.UiPeriode;
var conteneur = document.getElementById('periode');

function parTexte(racine, selecteur, texte) {
  return Array.prototype.filter.call(racine.querySelectorAll(selecteur), function (e) {
    return e.textContent.indexOf(texte) !== -1;
  })[0];
}
function attendre(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

UiPeriode.init({ conteneur: conteneur });
UiPeriode.afficher().then(function () {
  var selects = conteneur.querySelectorAll('select');
  assert(selects.length >= 2, 'C6 : sélecteurs de période et de contrat présents');
  var optionsType = Array.prototype.map.call(selects[0].options, function (o) { return o.value; });
  assert(optionsType.join(',') === 'bilan,civile,contrat,libre',
    'C6 : les quatre périodes proposées (bilan, civile, durée du contrat, libre)');

  selects[0].value = 'civile';
  selects[0].onchange();
  return attendre(10);
}).then(function () {
  parTexte(conteneur, 'button', 'Calculer').click();
  return attendre(200);
}).then(function () {
  var cible = document.getElementById('resultats-periode');
  var cartes = cible.querySelectorAll('.carte-contrat');
  assert(cartes.length === 3, 'C6 : une vue d’ensemble + un document par contrat');
  assert(cible.textContent.indexOf('Vue d’ensemble') !== -1, 'C6 : vue d’ensemble tous contrats confondus');

  var texte = cible.textContent;
  assert(texte.indexOf('Solde heures sup à l’entrée') !== -1, 'C6 : solde d’entrée affiché');
  assert(texte.indexOf('Solde heures sup à la sortie') !== -1, 'C6 : solde de sortie affiché');
  assert(texte.indexOf('jamais additionnés') !== -1, 'C6 : la règle des compteurs est rappelée à l’écran');
  assert(texte.indexOf('provisoire') !== -1, 'C6 : les mois provisoires sont signalés');

  var figer = parTexte(cible, 'button', 'Figer');
  assert(!figer, 'C6 : aucun figement possible sur un récapitulatif de période');

  var wa = cible.querySelector('.wa-texte');
  assert(!!wa, 'C6 : document transmissible aux parents, prêt à copier');
  assert(wa.value.indexOf('au début →') !== -1 && wa.value.indexOf('à la fin') !== -1,
    'C6 : le document porte les soldes d’entrée et de sortie');
  assert(wa.value.indexOf('les soldes ne s’additionnent pas') !== -1,
    'C6 : le document rappelle que les soldes ne s’additionnent pas');
  assert(wa.value.indexOf('Total versé sur la période') !== -1, 'C6 : les flux sont bien totalisés');

  console.log('\n' + (echecs === 0 ? 'Tout est conforme.' : echecs + ' échec(s).'));
  process.exit(echecs === 0 ? 0 : 1);
}).catch(function (e) { console.error('Erreur :', e); process.exit(1); });
