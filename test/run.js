/* ============================================================================
   run.js — Runner de tests maison, sans aucune dépendance.
   Usage : node test/run.js
   Code de sortie : 0 si tout passe, 1 sinon (exploité par la CI).
   ========================================================================= */
'use strict';

var suites = [
  { titre: 'Moteur de calcul (lot 1)', suite: require('./engine.test.js') },
  { titre: 'Chaîne des mois et agrégation de période (lot 5)', suite: require('./chaine.test.js') },
  { titre: 'Messages d’échec en français (lot 5)', suite: require('./messages.test.js') },
  { titre: 'Couche données : aucune colonne lue sans être demandée', suite: require('./couche-donnees.test.js') },
  /* Placé en dernier : ce fichier pose un décor global (window, document) pour
     charger ui-kit.js sous Node. Il ne doit pas polluer les suites pures. */
  { titre: 'État d’avancement d’un mois (lot 7)', suite: require('./etat-mois.test.js') }
];

var reussis = 0;
var echoues = 0;

console.log('Récap Maria — tests\n');

suites.forEach(function (s) {
  console.log(s.titre);
  for (var i = 0; i < s.suite.cas.length; i++) {
    var t = s.suite.cas[i];
    try {
      t.fn();
      console.log('  ✓ ' + t.nom);
      reussis++;
    } catch (e) {
      console.error('  ✗ ' + t.nom);
      console.error('      ' + e.message);
      echoues++;
    }
  }
  console.log('');
});

console.log(reussis + ' réussi(s), ' + echoues + ' échec(s)');
process.exit(echoues === 0 ? 0 : 1);
