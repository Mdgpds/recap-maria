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
  /* Même place, même rôle : la règle des cinq samedis rouvre le moteur sur
     RG-06 — le décompte que les familles contestent. La première chose à
     prouver est qu'avec tous les samedis passés, rien ne bouge (§4.2, A1). */
  { titre: 'Différentiel moteur avant/après la règle des cinq samedis (§4.2, A1)', suite: require('./lot23-differentiel.test.js') },
  { titre: 'Chaîne des mois et agrégation de période (lot 5)', suite: require('./chaine.test.js') },
  { titre: 'Messages d’échec en français (lot 5)', suite: require('./messages.test.js') },
  { titre: 'Couche données : aucune colonne lue sans être demandée', suite: require('./couche-donnees.test.js') },
  /* Le sens inverse : une colonne que la BASE exige doit être fournie par
     l'écriture. C'est le contrôle qui manquait quand « faire un avenant » a
     été livré en production sans pouvoir aboutir une seule fois. */
  { titre: 'Écriture contre schéma : la base ne refusera pas ce que l’écran envoie', suite: require('./ecriture-vs-schema.test.js') },
  /* Placé en dernier : ce fichier pose un décor global (window, document) pour
     charger ui-kit.js sous Node. Il ne doit pas polluer les suites pures. */
  { titre: 'État d’avancement d’un mois (lot 7)', suite: require('./etat-mois.test.js') },
  /* Même décor global que le précédent, mêmes précautions : en dernier. */
  { titre: 'Le socle du redesign : quatre tailles, deux rayons, zéro couleur en dur (lot 24)', suite: require('./lot24-socle.test.js') },
  /* LOT 28 — les calculs rendus justes, et leur différentiel contre le
     moteur figé d'avant le lot. En dernier : les cas de chaîne posent un
     décor `DB` global. */
  { titre: 'Les calculs rendus justes (lot 28, §28.1 à §28.9)', suite: require('./lot28-calculs.test.js') },
  { titre: 'Différentiel moteur avant/après le lot 28 — chaque écart nommé', suite: require('./lot28-differentiel.test.js') },
  /* LOT 31 — l'imputation qui ne recouvre aucune journée est NOMMÉE, et le
     différentiel prouve qu'elle ne change pas un centime. Le différentiel
     d'abord, comme pour tous les lots qui rouvrent le moteur : si l'égalité
     tombe, tout ce qui suit est suspect. */
  { titre: 'Différentiel moteur avant/après le lot 31 (§4) — aucun montant ne bouge', suite: require('./lot31-differentiel.test.js') },
  { titre: 'Les imputations orphelines nommées (lot 31, §3.1)', suite: require('./lot31-orphelines.test.js') },
  /* LA RÉCUPÉRATION SE GAGNE JOUR APRÈS JOUR — le différentiel d'abord,
     comme pour tous les lots qui rouvrent le moteur : si l'égalité tombe,
     tout ce qui suit est suspect. */
  { titre: 'Différentiel — la réserve à la date ne déplace aucun montant', suite: require('./recuperation-differentiel.test.js') },
  { titre: 'La récupération se gagne jour après jour (brief du 28 août 2026)', suite: require('./recuperation-au-fil-du-mois.test.js') },
  /* ARBITRAGE 4 — la récupération passe en négatif, la pose ne se refuse
     plus. Différentiel d'abord, contre la production d'avant (`b83eadd`). */
  { titre: 'Différentiel — le négatif accepté ne déplace aucun montant', suite: require('./recuperation-negative-differentiel.test.js') }
];

var reussis = 0;
var echoues = 0;

console.log('Récap Maria — tests\n');

/* LOT 28 — UN CAS PEUT RENDRE UNE PROMESSE. La chaîne des mois est
   asynchrone (elle lit un décor de base), et ses règles nouvelles — le
   plafond sur l'exercice, la fenêtre des samedis, la troncature — se
   vérifient en l'appelant. Un cas synchrone ne change pas d'un iota : sa
   valeur de retour est ignorée, comme avant. Les cas restent joués UN PAR UN,
   dans l'ordre : deux cas asynchrones qui partageraient un décor global ne
   doivent jamais se chevaucher. */
(async function () {
  for (var si = 0; si < suites.length; si++) {
    var s = suites[si];
    console.log(s.titre);
    for (var i = 0; i < s.suite.cas.length; i++) {
      var t = s.suite.cas[i];
      try {
        await t.fn();
        console.log('  ✓ ' + t.nom);
        reussis++;
      } catch (e) {
        console.error('  ✗ ' + t.nom);
        console.error('      ' + e.message);
        echoues++;
      }
    }
    console.log('');
  }

  console.log(reussis + ' réussi(s), ' + echoues + ' échec(s)');
  process.exit(echoues === 0 ? 0 : 1);
})();
