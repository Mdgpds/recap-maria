/* ============================================================================
   etat-mois.test.js — Lot 7. Les deux fonctions qui décident de l'état d'un
   mois et de ce qu'il lui reste à vivre.

   Ces deux fonctions vivent dans `ui-kit.js`, donc dans l'interface, mais elles
   ne dessinent rien : elles décident. Et ce qu'elles décident est trop
   important pour n'être vérifié qu'à l'œil — c'est d'elles que dépend le fait
   de proposer, ou non, de clôturer un mois. Une clôture prématurée est le seul
   geste IRRÉVERSIBLE de l'application.

   Elles reçoivent la date du jour EN PARAMÈTRE. C'est exactement ce qui rend ce
   fichier possible : une fonction qui lirait `new Date()` à l'intérieur ne
   pourrait pas être testée le 25, ni le 26, ni un 31 décembre — il faudrait
   attendre le bon jour. Le piège n° 1 de la spécification n'est pas un détail
   de style, c'est la condition de toute vérification.

   Ce fichier charge ui-kit.js dans un décor minimal : pas de jsdom, juste ce
   que les deux fonctions touchent réellement.
   ========================================================================= */
'use strict';

var path = require('path');

/* --- Décor : le strict nécessaire pour charger ui-kit.js ----------------- */
global.window = global;
global.document = {
  createElement: function () {
    return { className: '', textContent: '', appendChild: function () {}, style: {} };
  }
};

/* Ces trois modules détectent CommonJS et s'exportent par `module.exports`
   plutôt que sur `global` : sous Node, ils ne se posent donc pas tout seuls là
   où ui-kit.js va les chercher. On les y met à la main. */
global.Format = require('../js/format.js');
global.Feries = require('../js/feries.js');
global.Engine = require('../js/engine.js');
require('../js/ui-kit.js');

var Kit = global.Kit;

function egal(obtenu, attendu, libelle) {
  if (obtenu !== attendu) {
    throw new Error(libelle + ' : attendu ' + JSON.stringify(attendu) +
      ', obtenu ' + JSON.stringify(obtenu));
  }
}

/* Contrat FICTIF (dépôt public) : planning du lundi au vendredi, sans borne
   de fin. Aucun salaire, aucun prénom réel. */
function contratLunVen(extra) {
  var c = { jours_planning: [1, 2, 3, 4, 5], date_debut: '2020-01-01' };
  Object.keys(extra || {}).forEach(function (k) { c[k] = extra[k]; });
  return c;
}

var cas = [];

/* ====================================================================== */
/* etatDuMois — les trois états                                           */
/* ====================================================================== */

cas.push({
  nom: 'U1 — mois courant, le 11 : en cours',
  fn: function () {
    egal(Kit.etatDuMois(2026, 8, null, '2026-08-11'), 'en_cours', 'U1');
    /* Un récap existant mais encore en brouillon ne change rien : c'est le
       statut « figé » qui fait la clôture, pas la simple existence d'une
       ligne. Maria peut avoir un brouillon enregistré depuis le 2. */
    egal(Kit.etatDuMois(2026, 8, { statut: 'brouillon' }, '2026-08-11'), 'en_cours',
      'U1.brouillon');
  }
});

cas.push({
  nom: 'U2 — mois courant, le 25 : à clôturer (le jour de bascule est inclus)',
  fn: function () {
    egal(Kit.etatDuMois(2026, 8, null, '2026-08-25'), 'a_cloturer', 'U2');
    /* La veille, non. C'est cette frontière-là qui compte : elle décide du
       jour où la tuile de clôture apparaît sur l'accueil. */
    egal(Kit.etatDuMois(2026, 8, null, '2026-08-24'), 'en_cours', 'U2.la veille');
    egal(Kit.JOUR_BASCULE_CLOTURE, 25, 'U2.le jour de bascule est bien 25');
  }
});

cas.push({
  nom: 'U3 — mois courant, le 26 : à clôturer',
  fn: function () {
    egal(Kit.etatDuMois(2026, 8, null, '2026-08-26'), 'a_cloturer', 'U3');
    egal(Kit.etatDuMois(2026, 8, null, '2026-08-31'), 'a_cloturer', 'U3.dernier jour');
  }
});

cas.push({
  nom: 'U4 — mois échu non clôturé : à clôturer, quel que soit le jour',
  fn: function () {
    egal(Kit.etatDuMois(2026, 7, null, '2026-08-01'), 'a_cloturer', 'U4.le 1er');
    egal(Kit.etatDuMois(2026, 7, null, '2026-08-11'), 'a_cloturer', 'U4.le 11');
    /* Un mois d'une ANNÉE antérieure aussi : le rang se calcule en mois
       absolus, pas en comparant les nombres de mois entre eux. Sans cela,
       décembre 2025 vu depuis janvier 2026 (12 > 1) passerait pour futur. */
    egal(Kit.etatDuMois(2025, 12, null, '2026-01-05'), 'a_cloturer',
      'U4.décembre vu depuis janvier');
  }
});

cas.push({
  nom: 'U5 — récapitulatif figé : clôturé, même un mois futur',
  fn: function () {
    egal(Kit.etatDuMois(2026, 7, { statut: 'fige' }, '2026-08-11'), 'cloture', 'U5');
    egal(Kit.etatDuMois(2026, 8, { statut: 'fige' }, '2026-08-11'), 'cloture', 'U5.mois courant');
    egal(Kit.etatDuMois(2026, 12, { statut: 'fige' }, '2026-08-11'), 'cloture', 'U5.mois futur');
  }
});

cas.push({
  nom: 'U6 — mois futur : en cours, jamais proposé à la clôture',
  fn: function () {
    egal(Kit.etatDuMois(2026, 9, null, '2026-08-26'), 'en_cours', 'U6.mois suivant');
    /* Le 26 août, août est à clôturer MAIS septembre reste en cours : la
       bascule du 25 ne concerne que le mois courant. Sans cela, l'accueil
       proposerait de clôturer un mois qui n'a pas commencé. */
    egal(Kit.etatDuMois(2026, 8, null, '2026-08-26'), 'a_cloturer', 'U6.août, lui, bascule');
    egal(Kit.etatDuMois(2027, 1, null, '2026-12-31'), 'en_cours', 'U6.janvier vu de décembre');
  }
});

cas.push({
  nom: 'Lot 7 — date du jour illisible : le mois est dit à clôturer, jamais caché',
  fn: function () {
    /* Un mois oublié coûte plus cher qu'une tuile de trop. En cas de doute on
       montre, on ne masque pas. */
    egal(Kit.etatDuMois(2026, 8, null, ''), 'a_cloturer', 'chaîne vide');
    egal(Kit.etatDuMois(2026, 8, null, null), 'a_cloturer', 'nul');
    egal(Kit.etatDuMois(2026, 8, null, 'n’importe quoi'), 'a_cloturer', 'texte');
    /* Mais un mois figé reste clôturé : là il n'y a aucun doute à avoir. */
    egal(Kit.etatDuMois(2026, 8, { statut: 'fige' }, ''), 'cloture', 'figé malgré tout');
  }
});

cas.push({
  nom: 'Lot 7 — les trois mots affichés sont les seuls autorisés (V8-01)',
  fn: function () {
    egal(Kit.LIBELLE_ETAT.en_cours, 'en cours', 'en cours');
    egal(Kit.LIBELLE_ETAT.a_cloturer, 'à clôturer', 'à clôturer');
    egal(Kit.LIBELLE_ETAT.cloture, 'clôturé', 'clôturé');
    egal(Object.keys(Kit.LIBELLE_ETAT).length, 3, 'trois états, pas quatre');
    /* Les mots bannis ne doivent apparaître nulle part dans la table. */
    var tous = Object.keys(Kit.LIBELLE_ETAT).map(function (k) { return Kit.LIBELLE_ETAT[k]; }).join(' ');
    ['en attente', 'terminé', 'validé', 'figé', 'envoyé'].forEach(function (interdit) {
      egal(tous.indexOf(interdit), -1, 'mot interdit : ' + interdit);
    });
  }
});

/* LOT 17 §17.2 — LE PLANNING EST DÉSORMAIS UN PARAMÈTRE.

   Les jours de garde sont datés : ils vivent sur l'avenant, pas sur `contrat`,
   et `Kit.joursTravaillesRestants` ne va donc plus les chercher toute seule.
   Ces cas continuent de vérifier exactement la même règle — le planning leur
   arrive juste par la porte au lieu de la fenêtre. */
function planningDe(contrat) {
  return contrat ? contrat.jours_planning : null;
}

/* ====================================================================== */
/* joursTravaillesRestants                                                */
/* ====================================================================== */

cas.push({
  nom: 'U7 — jours restants le 11 août 2026, planning lundi-vendredi',
  fn: function () {
    /* Août 2026 : le 1er est un samedi. Jours ouvrés du 12 au 31 inclus —
       12, 13, 14, 17, 18, 19, 20, 21, 24, 25, 26, 27, 28, 31 = 14 jours.
       Le 15 août est un samedi cette année-là, donc il ne retranche rien du
       planning lundi-vendredi : le férié tombe hors planning. */
    var n = Kit.joursTravaillesRestants(contratLunVen(), planningDe(contratLunVen()), 2026, 8, '2026-08-11');
    egal(n, 14, 'U7');

    /* Le 11 lui-même est exclu : « strictement postérieurs ». La journée du
       jour est déjà connue, elle n'est pas « à venir ». */
    var n12 = Kit.joursTravaillesRestants(contratLunVen(), planningDe(contratLunVen()), 2026, 8, '2026-08-12');
    egal(n12, 13, 'U7.le lendemain, un de moins');
  }
});

cas.push({
  nom: 'U7bis — un férié qui tombe DANS le planning est bien retranché',
  fn: function () {
    /* Le 11 novembre 2026 est un mercredi : férié ET dans le planning.
       Jours ouvrés du 2 au 30 novembre 2026 : 21. Moins le 11 = 20. */
    var avecFerie = Kit.joursTravaillesRestants(contratLunVen(), planningDe(contratLunVen()), 2026, 11, '2026-11-01');
    egal(avecFerie, 20, 'U7bis.novembre, 11 novembre retranché');

    /* Preuve que le retranchement vient bien du férié : la veille du 11, le
       compte tombe de 6 (du 12 au 30) et non de 7. */
    egal(Kit.joursTravaillesRestants(contratLunVen(), planningDe(contratLunVen()), 2026, 11, '2026-11-11'), 13,
      'U7bis.après le 11');
  }
});

cas.push({
  nom: 'U8 — mois échu : zéro jour restant',
  fn: function () {
    egal(Kit.joursTravaillesRestants(contratLunVen(), planningDe(contratLunVen()), 2026, 7, '2026-08-11'), 0, 'U8');
    egal(Kit.joursTravaillesRestants(contratLunVen(), planningDe(contratLunVen()), 2025, 12, '2026-08-11'), 0, 'U8.année passée');
    /* Le dernier jour du mois : plus rien après lui. */
    egal(Kit.joursTravaillesRestants(contratLunVen(), planningDe(contratLunVen()), 2026, 8, '2026-08-31'), 0, 'U8.le 31');
  }
});

cas.push({
  nom: 'Lot 7 — le planning du contrat est respecté, pas un planning supposé',
  fn: function () {
    /* Un contrat à trois jours (lundi, mardi, jeudi) ne compte pas cinq jours
       par semaine. Une valeur en dur serait fausse ici, et invisible jusqu'au
       jour où Maria signe un contrat à temps partiel. */
    var troisJours = contratLunVen({ jours_planning: [1, 2, 4] });
    var n = Kit.joursTravaillesRestants(troisJours, planningDe(troisJours), 2026, 8, '2026-08-11');
    /* Du 12 au 31 août : les lundis 17, 24, 31 ; mardis 18, 25 ; jeudis 13,
       20, 27. Soit 8. */
    egal(n, 8, 'trois jours par semaine');
  }
});

cas.push({
  nom: 'Lot 7 — les bornes du contrat comptent : rien après le dernier jour de garde',
  fn: function () {
    /* Un contrat qui s'arrête le 20 août n'a plus de jours à venir après le
       20, même si le mois continue. Sans cela, l'application annoncerait des
       journées que Maria ne gardera jamais. */
    var borne = contratLunVen({ date_fin: '2026-08-20' });
    egal(Kit.joursTravaillesRestants(borne, planningDe(borne), 2026, 8, '2026-08-11'), 7,
      'du 12 au 20 : 12,13,14,17,18,19,20');

    /* Et un contrat qui commence plus tard ne compte pas les jours d'avant. */
    var tardif = contratLunVen({ date_debut: '2026-08-24' });
    egal(Kit.joursTravaillesRestants(tardif, planningDe(tardif), 2026, 8, '2026-08-11'), 6,
      'du 24 au 31 : 24,25,26,27,28,31');
  }
});

cas.push({
  nom: 'Lot 7 — entrées absentes : zéro, jamais une exception',
  fn: function () {
    /* Cet appel a lieu pendant le dessin de l'accueil, à chaque carte. Une
       exception ici viderait l'écran de Maria. */
    egal(Kit.joursTravaillesRestants(null, planningDe(null), 2026, 8, '2026-08-11'), 0, 'contrat absent');
    egal(Kit.joursTravaillesRestants(contratLunVen(), planningDe(contratLunVen()), 2026, 8, null), 0, 'date absente');
  }
});

module.exports = { cas: cas };
