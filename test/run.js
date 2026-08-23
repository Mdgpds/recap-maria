/* ============================================================================
   run.js — Runner de tests maison, sans aucune dépendance.
   Usage : node test/run.js
   Code de sortie : 0 si tout passe, 1 sinon (exploité par la CI).
   ========================================================================= */
'use strict';

var suites = [
  { titre: 'Moteur de calcul (lot 1)', suite: require('./engine.test.js') },
  /* Placé juste après le moteur : si le différentiel du lot 17 échoue, tout
     ce qui suit est suspect. C'est la preuve du §17.3 — à conditions
     constantes, le moteur du lot 17 rend exactement les chiffres de celui
     d'avant, sur 13 440 scénarios. */
  { titre: 'Différentiel moteur avant/après le lot 17 (§17.3)', suite: require('./lot17-differentiel.test.js') },
  { titre: 'Le temps : écarts d’horaire, congés à l’heure, prorata, rupture (lot 17)', suite: require('./lot17-temps.test.js') },
  /* Même place, même rôle, un lot plus tard : le lot 20 rouvre le moteur, et
     la première chose à prouver est que les mois SANS familiarisation n'ont
     pas bougé d'un centime (§20.5, A1). Ce qu'il ajoute vient juste après. */
  { titre: 'Différentiel moteur avant/après le lot 20 (§20.5, A1)', suite: require('./lot20-differentiel.test.js') },
  { titre: 'La familiarisation en période, et l’entretien retirable (lot 20)', suite: require('./lot20-familiarisation.test.js') },
  { titre: 'Chaîne des mois et agrégation de période (lot 5)', suite: require('./chaine.test.js') },
  { titre: 'Messages d’échec en français (lot 5)', suite: require('./messages.test.js') },
  { titre: 'Couche données : aucune colonne lue sans être demandée', suite: require('./couche-donnees.test.js') },
  /* Le sens inverse : une colonne que la BASE exige doit être fournie par
     l'écriture. C'est le contrôle qui manquait quand « faire un avenant » a
     été livré en production sans pouvoir aboutir une seule fois. */
  { titre: 'Écriture contre schéma : la base ne refusera pas ce que l’écran envoie', suite: require('./ecriture-vs-schema.test.js') },
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
