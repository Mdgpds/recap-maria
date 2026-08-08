/* Test de fumée de l'écran de récap (lot 4), hors réseau.
   Branche le VRAI moteur (engine.js) sur un DB simulé, vérifie le calcul
   d'un mois, le rendu, le texte WhatsApp, et le figement.
   Lancement : node test/ui-recap.smoke.js  (nécessite jsdom en dev). */
'use strict';

var JSDOM = require('jsdom').JSDOM;
var dom = new JSDOM('<!DOCTYPE html><body><main id="recap"></main></body>', { url: 'https://exemple.test/' });
global.window = dom.window;
global.document = dom.window.document;
global.window.confirm = function () { return true; };

var echecs = 0;
function assert(cond, msg) { if (!cond) { echecs++; console.error('FAIL ' + msg); } else console.log('ok   ' + msg); }

// --- Dépendances réelles (lot 1) attachées à window (ui-recap lit window.*) --
window.Feries = require('../js/feries.js');
window.Format = require('../js/format.js');
window.Engine = require('../js/engine.js');

// --- DB simulé --------------------------------------------------------------
var appels = { fige: [], brouillon: [] };
window.DB = {
  getSalaires: function () {
    return Promise.resolve([{ date_effet: '2024-01-01', brut_mensuel_centimes: 195000, net_mensuel_centimes: 150000 }]);
  },
  getCompteurInitial: function () {
    return Promise.resolve({ contrat_id: 'c1', date_reference: '2025-04-01', minutes_sup: 0, dixiemes_cp_acquis: 0, dixiemes_cp_pris: 0 });
  },
  getJourneesMois: function () { return Promise.resolve({}); },   // avril : aucune exception -> tout présence
  getRecap: function () { return Promise.resolve(null); },        // rien de figé
  enregistrerRecapBrouillon: function (cid, a, m, d) { appels.brouillon.push({ cid: cid, a: a, m: m, d: d }); return Promise.resolve({}); },
  figerRecap: function (cid, a, m, d) { appels.fige.push({ cid: cid, a: a, m: m, d: d }); return Promise.resolve({ statut: 'fige' }); }
};

require('../js/ui-recap.js');
var UiRecap = window.UiRecap;

var contrats = [
  {
    id: 'c1', prenom_enfant: 'Alpha', famille: { nom: 'Papillon' },
    jours_planning: [1, 2, 3, 4, 5], date_debut: '2024-09-01', date_fin: null,
    minutes_sup_jour: 30, minutes_par_jour_conge: 540, entretien_centimes_jour: 500,
    ordre_imputation: 'cp_puis_sup', sup_dues_si_enfant_absent: true
  }
];

// Avril 2025 : 22 jours lun-ven, dont le 21 (lundi de Pâques) férié -> 21 présences.
UiRecap.init({ conteneur: document.getElementById('recap'), contrats: contrats });
UiRecap.afficherRecapMois(2025, 4).then(function () {
  var doc = document;
  var carte = doc.querySelector('.carte-contrat');
  assert(!!carte, 'une carte de récap rendue');

  var texte = carte.textContent;
  assert(texte.indexOf('21') !== -1, 'présence = 21 affichée (avril 2025, férié 21/04 exclu)');

  var wa = doc.querySelector('.wa-texte');
  assert(!!wa, 'bloc WhatsApp présent');
  assert(wa.value.indexOf('Présence : 21 jour(s)') !== -1, 'texte WhatsApp : présence 21 (obtenu extrait ' + JSON.stringify(wa.value.split('\n')[1]) + ')');
  assert(wa.value.indexOf('Heures sup du mois : 10h30') !== -1, 'texte WhatsApp : heures sup 10h30 (21×30 = 630 min)');
  assert(wa.value.indexOf('605,00') !== -1, 'texte WhatsApp : net à verser 1 605,00 € (150000+10500)');

  // Figement : bouton « Figer le mois » -> DB.figerRecap avec le résultat calculé.
  var boutons = carte.querySelectorAll('.form-actions .btn');
  var btnFiger = Array.prototype.filter.call(boutons, function (b) { return b.textContent.indexOf('Figer') !== -1; })[0];
  assert(!!btnFiger, 'bouton « Figer le mois » présent');
  btnFiger.click();

  setTimeout(function () {
    assert(appels.fige.length === 1, 'figerRecap appelé une fois');
    if (appels.fige.length) {
      var f = appels.fige[0];
      assert(f.cid === 'c1' && f.a === 2025 && f.m === 4, 'figerRecap avec le bon contrat/mois');
      assert(f.d && f.d.joursPresence === 21, 'figerRecap reçoit l’instantané (joursPresence = 21)');
      assert(f.d.totalAVerserCentimes === 160500, 'figerRecap : total à verser = 160500 centimes');
    }
    console.log('\n' + (echecs === 0 ? 'Tout est conforme.' : echecs + ' échec(s).'));
    process.exit(echecs === 0 ? 0 : 1);
  }, 40);
}).catch(function (e) { console.error('Erreur de rendu :', e); process.exit(1); });
