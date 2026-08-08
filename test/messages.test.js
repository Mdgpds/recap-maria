/* ============================================================================
   messages.test.js — Lot 5, correctif A2 : aucun texte technique ni anglais
   sous les yeux de Maria.

   Les erreurs arrivent en anglais, avec des codes SQL, depuis Supabase. Ce
   qu'elle doit lire, c'est une phrase française qui lui dit quoi faire.
   Le détail technique part en console, pas à l'écran.

   Aucune dépendance : exécuté par test/run.js sous Node.
   ========================================================================= */
'use strict';

var Messages = require('../js/messages.js');

/* La console est réduite au silence pendant les tests : messages.js y écrit
   volontairement le détail technique. */
var vraiErreur = console.error;
function silence(fn) {
  console.error = function () {};
  try { return fn(); } finally { console.error = vraiErreur; }
}

function egal(obtenu, attendu, libelle) {
  if (obtenu !== attendu) {
    throw new Error(libelle + ' : attendu ' + JSON.stringify(attendu) +
      ', obtenu ' + JSON.stringify(obtenu));
  }
}
/* Deux contrôles distincts : les sigles techniques (majuscules, sensibles à
   la casse) et le vocabulaire anglais. Attention au drapeau `i`, qui rendrait
   [A-Z] équivalent à « n'importe quelle lettre ». */
var SIGLES = /\b[A-Z]{2,}\b/;
var ANGLAIS = /\b(invalid|error|failed|constraint|violates|null|key|row|jwt|policy|relation|duplicate|fetch)\b/i;

function sansAnglaisNiCode(txt, libelle) {
  if (SIGLES.test(txt)) {
    throw new Error(libelle + ' : le message contient un sigle technique — ' + txt);
  }
  if (ANGLAIS.test(txt)) {
    throw new Error(libelle + ' : le message contient un mot anglais — ' + txt);
  }
}

var cas = [];

cas.push({
  nom: 'A2 — un mot de passe erroné ne montre jamais « Invalid login credentials »',
  fn: function () {
    var m = silence(function () {
      return Messages.lisible({ message: 'Invalid login credentials' });
    });
    egal(m, 'e-mail ou mot de passe incorrect.', 'traduction de l’échec de connexion');
    sansAnglaisNiCode(m, 'message de connexion');
  }
});

cas.push({
  nom: 'A2 — les erreurs Postgres sont traduites, jamais recopiées',
  fn: function () {
    var duplicata = silence(function () {
      return Messages.lisible({ code: '23505', message: 'duplicate key value violates unique constraint "salaire_contrat_contrat_id_date_effet_key"' });
    });
    egal(duplicata, 'cette valeur existe déjà.', 'doublon');
    sansAnglaisNiCode(duplicata, 'doublon');

    var contrainte = silence(function () {
      return Messages.lisible({ message: 'new row for relation "contrat" violates check constraint "contrat_minutes_par_jour_conge_positif"' });
    });
    egal(contrainte, 'une valeur saisie est hors des limites autorisées.', 'contrainte');
    sansAnglaisNiCode(contrainte, 'contrainte');

    var rls = silence(function () {
      return Messages.lisible({ code: '42501', message: 'new row violates row-level security policy' });
    });
    egal(rls, 'votre session a expiré : reconnectez-vous.', 'RLS');
    sansAnglaisNiCode(rls, 'RLS');
  }
});

cas.push({
  nom: 'A2 — l’immuabilité d’un récap figé est expliquée en français',
  fn: function () {
    var m = silence(function () {
      return Messages.lisible({ message: 'recap_mensuel abc (contrat def, 3/2026) est figé : seul le champ d\'audit est modifiable (immuabilité)' });
    });
    egal(m, 'ce mois est clôturé : il ne peut plus être modifié.', 'immuabilité');
  }
});

cas.push({
  nom: 'A2 — la perte de réseau est dite en français',
  fn: function () {
    var m = silence(function () { return Messages.lisible(new Error('Failed to fetch')); });
    egal(m, 'connexion indisponible : vérifiez votre réseau, puis réessayez.', 'réseau');
    sansAnglaisNiCode(m, 'réseau');
  }
});

cas.push({
  nom: 'A2 — une erreur inconnue tombe sur une phrase française, pas sur le message brut',
  fn: function () {
    var m = silence(function () {
      return Messages.lisible({ message: 'PGRST301: JWSError JWSInvalidSignature' });
    });
    if (m.indexOf('JWS') !== -1 || m.indexOf('PGRST') !== -1) {
      throw new Error('le message technique a fui à l’écran : ' + m);
    }
    sansAnglaisNiCode(m, 'repli');
  }
});

cas.push({
  nom: 'A2 — un écran peut proposer sa propre phrase de repli',
  fn: function () {
    var m = silence(function () {
      return Messages.lisible({ message: 'quelque chose d’inattendu' }, 'le barème n’a pas pu être enregistré.');
    });
    egal(m, 'le barème n’a pas pu être enregistré.', 'repli personnalisé');
  }
});

module.exports = { cas: cas };
