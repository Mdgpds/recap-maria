/* Test de fumée de l'écran de saisie (lot 3), hors réseau.
   Simule le DOM (jsdom), Feries, Format et DB, puis vérifie :
   - le rendu de la grille (jours de planning, férié pré-rempli),
   - l'action groupée « Absence de Maria » : appel unique, fériés exclus,
     et surtout — régression A1 — chaque contrat ne reçoit QUE ses propres
     jours dans SES bornes (jamais les jours d'un autre contrat),
   - régression A2 — « Retirer » ne cible que les types d'absence de Maria.
   Lancement : node test/ui-saisie.smoke.js  (nécessite jsdom en dev). */
'use strict';

var JSDOM = require('jsdom').JSDOM;
var dom = new JSDOM('<!DOCTYPE html><body><main id="saisie"></main></body>', { url: 'https://exemple.test/' });
global.window = dom.window;
global.document = dom.window.document;
global.window.confirm = function () { return true; }; // auto-confirme le « Retirer »

var echecs = 0;
function assert(cond, msg) { if (!cond) { echecs++; console.error('FAIL ' + msg); } else console.log('ok   ' + msg); }

// --- Stubs -----------------------------------------------------------------
var Feries = require('../js/feries.js');
window.Feries = Feries;
window.Format = require('../js/format.js');

var appels = { poser: [], retire: [], enregistre: [], supprime: [] };
window.DB = {
  getJourneesMois: function () { return Promise.resolve({}); },   // aucune exception au départ
  enregistrerJournee: function (l) { appels.enregistre.push(l); return Promise.resolve(l); },
  supprimerJournee: function (c, j) { appels.supprime.push([c, j]); return Promise.resolve(true); },
  poserAbsenceMaria: function (affectations, type) { appels.poser.push({ affectations: affectations, type: type }); return Promise.resolve([]); },
  retirerAbsenceMaria: function (ids, jours, types) { appels.retire.push({ ids: ids, jours: jours, types: types }); return Promise.resolve(true); }
};

// charge le module (s'attache à window.UiSaisie)
require('../js/ui-saisie.js');
var UiSaisie = window.UiSaisie;

// --- Données de test : 2 contrats lun-ven, avril 2025 (férié lundi 21) -----
//   Alpha : contrat terminé le 15/04/2025 (date_fin).
//   Bravo : contrat ouvert (date_fin null).
var contrats = [
  { id: 'c1', prenom_enfant: 'Alpha', famille: { nom: 'Papillon' }, jours_planning: [1, 2, 3, 4, 5], date_debut: '2024-09-01', date_fin: '2025-04-15' },
  { id: 'c2', prenom_enfant: 'Bravo', famille: { nom: 'Libellule' }, jours_planning: [1, 2, 3, 4, 5], date_debut: '2024-09-01', date_fin: null }
];

UiSaisie.init({ conteneur: document.getElementById('saisie'), contrats: contrats });

UiSaisie.afficherMois(2025, 4).then(function () {
  var doc = document;

  // 1. Deux cartes de contrat rendues
  var cartes = doc.querySelectorAll('.carte-contrat');
  assert(cartes.length === 2, 'deux cartes de contrat rendues (obtenu ' + cartes.length + ')');

  // 2. Bravo (ouvert) : avril 2025 = 22 jours ouvrés lun-ven -> 22 chips
  var chipsBravo = cartes[1].querySelectorAll('.chip');
  assert(chipsBravo.length === 22, '22 jours de planning affichés pour Bravo (obtenu ' + chipsBravo.length + ')');

  // 2b. Alpha (terminé le 15/04) : seuls les jours <= 15/04 sont affichés
  var chipsAlpha = cartes[0].querySelectorAll('.chip');
  assert(chipsAlpha.length === 11, 'Alpha borné au 15/04 : 11 jours affichés (obtenu ' + chipsAlpha.length + ')');

  // 3. Le lundi 21/04 (férié) est pré-rempli « Férié » chez Bravo
  var aFerie = Array.prototype.some.call(chipsBravo, function (ch) {
    return ch.className.indexOf('j-ferie') !== -1 && ch.textContent.indexOf('21') !== -1;
  });
  assert(aFerie, 'le 21/04 est pré-rempli comme férié');

  // 4. Bloc absence Maria présent
  assert(!!doc.querySelector('.bloc-absence-maria'), 'bloc « Absence de Maria » présent');

  // 5. Action groupée : congé du 14 au 25 avril.
  //    - Alpha (fin 15/04) ne doit recevoir QUE 14 et 15 (régression A1).
  //    - Bravo doit recevoir 14,15,16,17,18,22,23,24,25 (21 férié exclu).
  doc.querySelectorAll('.in-date')[0].value = '2025-04-14';
  doc.querySelectorAll('.in-date')[1].value = '2025-04-25';
  var boutons = doc.querySelectorAll('.bloc-absence-maria .btn');
  boutons[0].click(); // « Poser sur tous les contrats »

  setTimeout(function () {
    assert(appels.poser.length === 1, 'poserAbsenceMaria appelé une fois');
    if (appels.poser.length) {
      var a = appels.poser[0];
      assert(a.type === 'conge_maria', 'type par défaut = conge_maria');
      assert(a.affectations.length === 2, 'affectations sur les 2 contrats');

      var alpha = a.affectations.filter(function (x) { return x.contratId === 'c1'; })[0];
      var bravo = a.affectations.filter(function (x) { return x.contratId === 'c2'; })[0];

      assert(alpha && alpha.jours.join(',') === '2025-04-14,2025-04-15',
        'A1 : Alpha borné au 15/04, aucun jour hors contrat (obtenu ' + (alpha ? JSON.stringify(alpha.jours) : 'rien') + ')');

      assert(bravo && bravo.jours.join(',') === '2025-04-14,2025-04-15,2025-04-16,2025-04-17,2025-04-18,2025-04-22,2025-04-23,2025-04-24,2025-04-25',
        'Bravo : 9 jours, férié 21/04 exclu (obtenu ' + (bravo ? JSON.stringify(bravo.jours) : 'rien') + ')');
    }

    // 6. « Retirer » : ne cible que les types d'absence de Maria (régression A2).
    var boutons2 = doc.querySelectorAll('.bloc-absence-maria .btn');
    boutons2[1].click(); // « Retirer »

    setTimeout(function () {
      assert(appels.retire.length === 1, 'retirerAbsenceMaria appelé une fois');
      if (appels.retire.length) {
        var r = appels.retire[0];
        assert(JSON.stringify(r.types) === JSON.stringify(['conge_maria', 'sans_solde', 'hors_planning']),
          'A2 : « Retirer » filtre sur les types d’absence de Maria (obtenu ' + JSON.stringify(r.types) + ')');
        assert(r.types.indexOf('absence_enfant') === -1 && r.types.indexOf('familiarisation') === -1,
          'A2 : absence enfant et familiarisation NE sont PAS supprimées');
      }

      console.log('\n' + (echecs === 0 ? 'Tout est conforme.' : echecs + ' échec(s).'));
      process.exit(echecs === 0 ? 0 : 1);
    }, 30);
  }, 30);
}).catch(function (e) { console.error('Erreur de rendu :', e); process.exit(1); });
