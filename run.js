/* ============================================================================
   run.js — Runner de tests maison, sans aucune dépendance.
   Usage : node test/run.js
   Code de sortie : 0 si tout passe, 1 sinon (exploité par la CI du lot 5).
   ========================================================================= */
'use strict';

var suite = require('./engine.test.js');

var reussis = 0;
var echoues = 0;

console.log('Récap Maria — tests du moteur de calcul\n');

for (var i = 0; i < suite.cas.length; i++) {
  var t = suite.cas[i];
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

console.log('\n' + reussis + ' réussi(s), ' + echoues + ' échec(s)');
process.exit(echoues === 0 ? 0 : 1);
