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

    /* --- Congés : les refus du moteur et de la base (lot 9) --------------
       Ces phrases manquaient : les quatre codes du moteur et la violation de
       la contrainte d'exclusion tombaient tous sur le repli « une erreur
       inattendue s'est produite », alors que la cause est connue et
       explicable. Elles précèdent les règles générales sur les contraintes,
       qui sont moins précises.
       Aucun code, aucun nom de table, aucun mot d'anglais ne sort d'ici. */
    [/exclusion constraint|23P01/i,
      'cette période chevauche une période de congé déjà enregistrée. ' +
      'Vérifiez vos dates, ou modifiez la période existante.'],
    [/IMPUTATION_INCOMPLETE/,
      function (e) {
        var chiffres = (typeof e.attendu === 'number' && typeof e.recu === 'number')
          ? ' Cette période compte ' + e.attendu + ' jour' + (e.attendu > 1 ? 's' : '') +
            ', la répartition en couvre ' + e.recu + '.'
          : '';
        return 'la répartition ne couvre pas exactement les jours de cette période.' +
               chiffres + ' Reprenez la répartition pour qu’il ne reste rien à placer.';
      }],
    [/IMPUTATION_NEGATIVE/,
      'une des valeurs de la répartition est négative : reprenez la répartition.'],
    [/IMPUTATION_DEPASSE_RESERVES/,
      'vous n’avez pas assez de congés payés ou de récupération pour cette ' +
      'répartition. Placez une partie des jours en sans solde, ou choisissez ' +
      'des dates plus courtes.'],
    [/MINUTES_INVALIDES/,
      'les minutes saisies ne sont pas un nombre de minutes valable : ' +
      'entrez un nombre entier, sans virgule.'],

    /* --- Lot 14 : mise en service et suppression franche ---------------
       Ces deux refus viennent de la BASE et sont parfaitement explicables :
       les laisser tomber sur « une erreur inattendue » serait leur faire dire
       le contraire de ce qu'ils disent. */
    [/CONTRAT_NON_VIERGE|proteger_suppression_contrat/,
      'ce contrat porte déjà des journées ou des mois enregistrés : il ne peut ' +
      'plus être supprimé. Choisissez « Ce contrat est terminé » pour le ranger ' +
      'en conservant son historique.'],
    [/compteur_initial_coherent/,
      'ces chiffres de départ ne sont pas cohérents : vous ne pouvez pas avoir ' +
      'pris plus de congés payés que vous n’en avez acquis, et aucune valeur ne ' +
      'peut être négative.'],

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
      if (TRADUCTIONS[i][0].test(brut)) {
        var phrase = TRADUCTIONS[i][1];
        /* Une traduction peut être une fonction quand l'erreur porte des
           chiffres utiles à Maria — « cette période compte 6 jours, la
           répartition en couvre 5 » vaut mieux que la même phrase sans
           repères. La fonction reçoit l'erreur ; si elle échoue, on retombe
           sur le repli plutôt que de laisser fuir quoi que ce soit. */
        if (typeof phrase === 'function') {
          try { return phrase(e || {}); } catch (err) { return defaut || DEFAUT; }
        }
        return phrase;
      }
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
