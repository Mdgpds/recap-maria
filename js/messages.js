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
    /* LOT 20 — LA MÊME CONTRAINTE POSTGRES, DEUX PÉRIODES DIFFÉRENTES.
       `periode_familiarisation` et `imputation_conge` lèvent toutes les deux
       un 23P01. La règle générique ci-dessous parle d'une « période de congé »
       — elle enverrait Maria chercher un congé qui n'existe pas. La règle
       NOMMÉE passe donc en premier ; le repli générique reste derrière, pour
       toute contrainte d'exclusion future. */
    [/periode_familiarisation_sans_chevauchement/,
      'cette période de familiarisation en chevauche une autre, déjà ' +
      'enregistrée pour cet enfant. Corrigez celle qui existe plutôt que d’en ' +
      'poser une seconde.'],
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
    /* --- LOT 17 : les refus du temps et des conditions datées ----------
       Cinq codes nouveaux. Aucun ne doit tomber dans le repli « une erreur
       inattendue s'est produite » : chacun a une cause connue, et chacun se
       corrige par un geste précis. Une phrase qui ne dit pas quoi faire est
       une phrase qui laisse Maria dehors. */
    [/CONDITIONS_ABSENTES/,
      'aucune condition n’est enregistrée pour ce mois : ni jours de garde, ni ' +
      'horaires, ni rémunération. Ouvrez la fiche du contrat et posez ses ' +
      'conditions — sans elles, ce mois ne peut pas être calculé.'],
    [/ECART_EVENEMENT_INCONNU/,
      'cet événement n’est pas reconnu. Choisissez ce qui s’est passé dans la ' +
      'liste : un parent en retard, une libération anticipée, ou une arrivée ' +
      'que vous avez décalée.'],
    [/ECART_DESTINATION_INCONNUE/,
      'ces minutes doivent se déduire de votre récupération, de vos congés ' +
      'payés, ou passer en sans solde. Choisissez l’une des trois.'],
    [/HEURE_INVALIDE/,
      'cette heure n’est pas lisible. Choisissez-la dans la liste plutôt que ' +
      'de la taper.'],
    /* LOT 20 (§20.4) — les trois refus de la familiarisation. Chacun nomme le
       geste qui corrige : une phrase qui ne dit pas quoi faire laisse Maria
       dehors, la feuille ouverte et la journée non déclarée. */
    [/DUREE_NON_POSITIVE/,
      'le départ doit être après l’arrivée. Corrigez l’une des deux heures, ou ' +
      'choisissez une durée toute faite.'],
    [/periode_familiarisation_periode_valide/,
      'la fin de la familiarisation doit être après son début. Reprenez les ' +
      'deux dates.'],
    /* Le refus d'un écran retiré au lot 17 (§17.9). Il ne devrait jamais
       s'afficher — plus rien n'y mène — mais un message technique sur un
       chemin oublié serait pire que rien. */
    [/ECRAN_RETIRE_LOT17/,
      'cet écran a été retiré de l’application. Pour changer les conditions ' +
      'd’un contrat, ouvrez sa fiche et faites un avenant : les mois d’avant ' +
      'ne bougeront pas.'],
    /* Les contraintes de la migration 014, dites en français. */
    [/avenant_date_effet_premier_du_mois/,
      'un avenant prend toujours effet un 1er de mois : un mois porte un seul ' +
      'jeu de conditions.'],
    /* CORRECTION C3 DE LA RELECTURE — DEUX CONTRAINTES TRÈS DIFFÉRENTES
       PARTAGEAIENT UNE PHRASE. Une collision de numérotation envoyait Maria
       chercher un doublon de date qui n'existait pas. Elles sont désormais
       séparées, et chacune dit sa propre cause. */
    [/avenant_contrat_contrat_id_date_effet_key/,
      'un avenant prend déjà effet à cette date pour ce contrat. Corrigez-le ' +
      'plutôt que d’en poser un second.'],
    [/avenant_contrat_numero_unique/,
      'deux avenants de ce contrat portent le même numéro. Ce n’est pas une ' +
      'erreur de votre part : signalez-le, rien n’a été enregistré.'],
    [/avenant_numero_immuable/,
      'le numéro d’un avenant ne se change pas : c’est la référence que vous ' +
      'donnez à la famille. La date, elle, se corrige.'],
    [/journee_ecart_signe_coherent|journee_ecart_coherent/,
      'ce que vous avez déclaré et les minutes ne concordent pas. Reprenez ' +
      'l’événement et l’heure réelle.'],
    [/avenant_minutes_par_jour_conge_decimal/,
      'la durée d’un jour de congé doit être un multiple de 10 minutes : ' +
      'c’est ce qui garantit que vos compteurs se convertissent sans perdre ' +
      'de minute. Par exemple 540 (9 h) ou 480 (8 h).'],
    [/avenant_minutes_par_jour_conge_positif/,
      'la durée d’un jour de congé doit être supérieure à zéro : c’est elle ' +
      'qui convertit vos compteurs en jours.'],
    [/compteur_initial_coherent/,
      'vous ne pouvez pas avoir pris plus de congés payés que vous n’en avez ' +
      'acquis. Vérifiez les deux chiffres de départ.'],
    [/MINUTES_INVALIDES/,
      'les minutes saisies ne sont pas un nombre de minutes valable : ' +
      'entrez un nombre entier, sans virgule.'],

    /* --- Lot 14 : mise en service et suppression franche ---------------
       Ces deux refus viennent de la BASE et sont parfaitement explicables :
       les laisser tomber sur « une erreur inattendue » serait leur faire dire
       le contraire de ce qu'ils disent. */
    [/CONTRAT_NON_VIERGE|proteger_suppression_contrat/,
      'ce contrat porte déjà quelque chose — des journées, des mois enregistrés, ' +
      'des congés ou une note : il ne peut plus être supprimé. Choisissez ' +
      '« Ce contrat est terminé » pour le ranger en conservant son historique.'],
    /* CORRECTIF B7 (relecture PR9) — le refus posé par la migration 012. Sans
       cette ligne, Maria lirait « une erreur inattendue s'est produite » là où
       la cause est parfaitement explicable, et où il n'y a d'ailleurs rien à
       corriger de son côté. */
    [/COMPTEUR_INITIAL_VERROUILLE/,
      'vous ne pouvez plus modifier votre point de départ : des mois sont déjà ' +
      'clôturés pour cet enfant, et ces chiffres sont ce sur quoi ils reposent. ' +
      'Si un chiffre de départ est faux, il faut d’abord rouvrir les mois ' +
      'concernés.'],
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
    /* CORRECTIF PR9 (B6, B8) — UNE PHRASE DÉJÀ ÉCRITE POUR MARIA PASSE INTACTE.

       Cette table traduit ce qui vient de la BASE : codes Postgres, noms de
       contraintes, messages du moteur. Une erreur que l'APPLICATION fabrique
       elle-même porte parfois déjà la phrase exacte à afficher — « mois déjà
       clôturé(s) : juillet 2026 », « les notifications ne sont pas encore
       configurées sur ce compte ». Faute de la reconnaître, la table la
       remplaçait par le message générique « une erreur inattendue s'est
       produite. Réessayez… » : un message faux, qui invitait à réessayer une
       action qui ne pouvait structurellement pas aboutir, et qui effaçait la
       seule information utile.

       Le marquage est EXPLICITE et porté par une propriété dédiée : rien ne
       peut fuir par accident, seul ce que nous avons rédigé nous-mêmes passe. */
    if (e && typeof e.messageFrancais === 'string' && e.messageFrancais) {
      return e.messageFrancais;
    }
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
