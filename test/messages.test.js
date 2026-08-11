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

/* ================================================================== */
/* LOT 9 — les refus liés aux congés ont enfin une phrase française   */
/* ================================================================== */

cas.push({
  nom: 'A2 — les quatre codes du moteur ne tombent plus sur le repli',
  fn: function () {
    function code(c, extra) {
      var e = new Error(c); e.code = c;
      if (extra) Object.keys(extra).forEach(function (k) { e[k] = extra[k]; });
      return e;
    }
    var m = silence(function () { return Messages.lisible(code('IMPUTATION_NEGATIVE')); });
    egal(m, 'une des valeurs de la répartition est négative : reprenez la répartition.',
      'IMPUTATION_NEGATIVE');
    egal(m === Messages.DEFAUT, false, 'ce n’est plus le repli');

    var d = silence(function () { return Messages.lisible(code('IMPUTATION_DEPASSE_RESERVES')); });
    egal(d.indexOf('pas assez de congés payés') !== -1, true, 'IMPUTATION_DEPASSE_RESERVES');
    egal(d === Messages.DEFAUT, false, 'ce n’est plus le repli');

    var mi = silence(function () { return Messages.lisible(code('MINUTES_INVALIDES')); });
    egal(mi.indexOf('nombre entier') !== -1, true, 'MINUTES_INVALIDES');
    egal(mi === Messages.DEFAUT, false, 'ce n’est plus le repli');

    /* Aucun sigle technique, aucun mot d'anglais, aucun code d'erreur. */
    [m, d, mi].forEach(function (phrase) {
      egal(/IMPUTATION|MINUTES_|23P01|constraint|null|undefined/.test(phrase), false,
        'aucun terme technique dans « ' + phrase.slice(0, 30) + '… »');
    });
  }
});

cas.push({
  nom: 'A2 — un décompte incomplet dit les chiffres, pas le code',
  fn: function () {
    var e = new Error('IMPUTATION_INCOMPLETE');
    e.code = 'IMPUTATION_INCOMPLETE'; e.attendu = 6; e.recu = 5;
    var m = silence(function () { return Messages.lisible(e); });
    egal(m.indexOf('compte 6 jours') !== -1, true, 'le décompte réel est donné');
    egal(m.indexOf('en couvre 5') !== -1, true, 'ce qui a été réparti est donné');
    egal(/IMPUTATION|_/.test(m), false, 'aucun code à l’écran');

    /* Sans chiffres, la phrase reste correcte et utile. */
    var nu = new Error('IMPUTATION_INCOMPLETE'); nu.code = 'IMPUTATION_INCOMPLETE';
    var m2 = silence(function () { return Messages.lisible(nu); });
    egal(m2.indexOf('ne couvre pas exactement') !== -1, true, 'phrase sans chiffres');
    egal(m2.indexOf('undefined') === -1, true, 'jamais « undefined » à l’écran');
  }
});

cas.push({
  nom: 'A2 — le chevauchement de deux périodes de congé est nommé',
  fn: function () {
    /* L'erreur réelle de Postgres, telle que PostgREST la renvoie. */
    var e = {
      code: '23P01',
      message: 'conflicting key value violates exclusion constraint ' +
               '"imputation_sans_chevauchement"'
    };
    var m = silence(function () { return Messages.lisible(e); });
    egal(m.indexOf('chevauche une période de congé') !== -1, true, 'le chevauchement est dit');
    egal(m === Messages.DEFAUT, false, 'ce n’est plus le repli');
    egal(/constraint|imputation_sans|23P01/.test(m), false,
      'ni nom de contrainte ni code ne fuient à l’écran');
  }
});

cas.push({
  nom: 'A2 — les deux refus du lot 14 sont expliqués, pas affichés bruts',
  fn: function () {
    /* Un contrat qui a déjà servi : le message doit dire QUOI FAIRE, pas
       seulement que c'est refusé. */
    var t1 = Messages.lisible(new Error(
      'contrat 33 : suppression impossible, 1 journée(s) et 0 récapitulatif(s) existent (CONTRAT_NON_VIERGE)'));
    egal(t1.indexOf('journées') !== -1 || t1.indexOf('journée') !== -1, true,
      'le refus de suppression nomme la cause');
    egal(t1.indexOf('Ce contrat est terminé') !== -1, true,
      'et il dit quoi faire à la place');
    egal(/CONTRAT_NON_VIERGE|contrat 33|récapitulatif\(s\)/.test(t1), false,
      'aucun code ni message technique ne sort (obtenu « ' + t1 + ' »)');

    /* Des compteurs de départ incohérents. */
    var t2 = Messages.lisible(new Error(
      'new row for relation "compteur_initial" violates check constraint "compteur_initial_coherent"'));
    egal(t2.indexOf('plus de congés payés que vous n’en avez acquis') !== -1, true,
      'la contrainte de cohérence est expliquée en français');
    egal(/constraint|relation|check/.test(t2), false,
      'sans vocabulaire de base de données (obtenu « ' + t2 + ' »)');
  }
});

cas.push({
  nom: 'PR9 — une phrase déjà écrite pour Maria n’est pas remplacée par le générique',
  fn: function () {
    /* Correctifs B6 et B8 de la relecture. Les refus que l'APPLICATION rédige
       elle-même tombaient tous sur « une erreur inattendue s'est produite.
       Réessayez… », parce que cette table ne traduit que ce qui vient de la
       base. Un message faux, qui invitait à réessayer une action qui ne
       pouvait structurellement pas aboutir. */
    var e = new Error('date d’effet sur un mois clôturé');
    e.messageFrancais = 'mois déjà clôturé(s) — Tom : juillet 2026.';
    egal(Messages.lisible(e), 'mois déjà clôturé(s) — Tom : juillet 2026.',
      'la phrase française traverse intacte');

    /* Et le contraire, qui compte autant : un message technique NON marqué ne
       doit jamais atteindre l'écran tel quel. */
    egal(Messages.lisible(new Error('relation "x" does not exist')) ===
         'relation "x" does not exist', false,
      'un message non marqué reste traduit ou remplacé');

    var g = new Error('x');
    g.messageFrancais = '';
    egal(Messages.lisible(g), Messages.DEFAUT,
      'une marque vide retombe sur le repli, jamais sur du vide');
  }
});

module.exports = { cas: cas };
