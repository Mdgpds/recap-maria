/* ============================================================================
   messages.js — Traduction des échecs en français simple.

   Un seul endroit, pour une seule raison : Maria ne doit jamais voir de texte
   technique ni d'anglais. Les erreurs viennent de Supabase (PostgREST, GoTrue)
   ou du réseau, et elles arrivent en anglais, avec des codes SQL. Avant ce
   module, chaque écran avait sa propre traduction partielle et retombait sur
   le message brut : « Connexion refusée : Invalid login credentials ».

   Le message technique n'est pas perdu — il part dans la console, où il reste
   consultable pour diagnostiquer, mais où Maria ne le lit pas.

   Aucune dépendance, aucun accès réseau, aucun DOM.
   ========================================================================= */
(function (global) {
  'use strict';

  /* Ordre significatif : la première expression qui reconnaît le message
     gagne. Les cas précis viennent avant les cas généraux. */
  var TRADUCTIONS = [
    [/invalid login credentials|invalid_credentials|invalid grant/i,
      'e-mail ou mot de passe incorrect.'],
    [/email not confirmed/i,
      'cette adresse e-mail n’a pas encore été confirmée.'],
    [/user not found|no user found/i,
      'aucun compte ne correspond à cette adresse e-mail.'],
    [/rate limit|too many requests|\b429\b/i,
      'trop de tentatives : patientez une minute avant de réessayer.'],
    /* Vocabulaire à l'écran (§2.4 des specs) : le mot est TOUJOURS « clôturé ».
       « figé » est le terme de la base, il ne sort jamais du code. */
    [/immuab|est figé|recap_mensuel .* fig/i,
      'ce mois est clôturé : il ne peut plus être modifié.'],
    [/duplicate key|23505|unique constraint|unique violation/i,
      'cette valeur existe déjà.'],
    [/violates check constraint|23514/i,
      'une valeur saisie est hors des limites autorisées.'],
    [/violates foreign key|23503/i,
      'cet élément est rattaché à d’autres données : il ne peut pas être retiré.'],
    [/row-level security|permission denied|42501|jwt|not authenticated|session/i,
      'votre session a expiré : reconnectez-vous.'],
    [/failed to fetch|networkerror|network ?error|econnrefused|timeout|offline/i,
      'connexion indisponible : vérifiez votre réseau, puis réessayez.']
  ];

  var DEFAUT = 'une erreur inattendue s’est produite. Réessayez ; si cela recommence, ' +
               'notez ce que vous étiez en train de faire.';

  /* Traduit une erreur en une phrase française, sans vocabulaire technique.
     `defaut` permet à un écran de proposer sa propre phrase de repli. */
  function lisible(e, defaut) {
    var brut = '';
    if (e) {
      brut = [e.message, e.details, e.hint, e.code, (typeof e === 'string' ? e : '')]
        .filter(Boolean).join(' | ');
    }
    if (!brut) brut = String(e);

    /* Le détail technique reste disponible pour le diagnostic, hors écran. */
    if (global.console && typeof global.console.error === 'function') {
      global.console.error('[Récap Maria] échec :', e);
    }

    for (var i = 0; i < TRADUCTIONS.length; i++) {
      if (TRADUCTIONS[i][0].test(brut)) return TRADUCTIONS[i][1];
    }
    return defaut || DEFAUT;
  }

  var api = { lisible: lisible, DEFAUT: DEFAUT };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.Messages = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
