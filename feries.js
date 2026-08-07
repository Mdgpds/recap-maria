/* ============================================================================
   feries.js — Jours fériés de France métropolitaine.

   Module pur : aucune dépendance, aucun accès DOM, réseau ou horloge système.
   Toutes les dates sont des chaînes 'YYYY-MM-DD' (date pure, sans fuseau).
   L'arithmétique de dates passe exclusivement par Date.UTC : jamais de
   new Date('YYYY-MM-DD') ni de fuseau local (contrainte §1 des specs).

   Chargement : balise <script> dans le navigateur (global `Feries`),
   ou require('./feries.js') sous Node.
   ========================================================================= */
(function (global) {
  'use strict';

  var MS_PAR_JOUR = 86400000;

  function versMs(dateStr) {
    var p = dateStr.split('-');
    return Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }

  function versDateStr(ms) {
    var d = new Date(ms);
    return d.getUTCFullYear() + '-' +
      String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
      String(d.getUTCDate()).padStart(2, '0');
  }

  /* Ajoute n jours (entier, possiblement négatif) à une date pure. */
  function ajouterJours(dateStr, n) {
    return versDateStr(versMs(dateStr) + n * MS_PAR_JOUR);
  }

  /* Dimanche de Pâques — algorithme de Meeus/Jones/Butcher (grégorien).
     Reproduit exactement les valeurs de contrôle du §4.1 des specs. */
  function paques(annee) {
    var a = annee % 19;
    var b = Math.floor(annee / 100);
    var c = annee % 100;
    var d = Math.floor(b / 4);
    var e = b % 4;
    var f = Math.floor((b + 8) / 25);
    var g = Math.floor((b - f + 1) / 3);
    var h = (19 * a + b - d - g + 15) % 30;
    var i = Math.floor(c / 4);
    var k = c % 4;
    var l = (32 + 2 * e + 2 * i - h - k) % 7;
    var m = Math.floor((a + 11 * h + 22 * l) / 451);
    var mois = Math.floor((h + l - 7 * m + 114) / 31);
    var jour = ((h + l - 7 * m + 114) % 31) + 1;
    return annee + '-' + String(mois).padStart(2, '0') + '-' + String(jour).padStart(2, '0');
  }

  var cache = {};

  /* Les 11 jours fériés de France métropolitaine, triés, format YYYY-MM-DD. */
  function joursFeriesFrance(annee) {
    if (cache[annee]) return cache[annee];
    var p = paques(annee);
    var liste = [
      annee + '-01-01',      // jour de l'an
      ajouterJours(p, 1),    // lundi de Pâques
      annee + '-05-01',      // fête du Travail
      annee + '-05-08',      // victoire 1945
      ajouterJours(p, 39),   // Ascension
      ajouterJours(p, 50),   // lundi de Pentecôte
      annee + '-07-14',      // fête nationale
      annee + '-08-15',      // Assomption
      annee + '-11-01',      // Toussaint
      annee + '-11-11',      // armistice 1918
      annee + '-12-25'       // Noël
    ].sort();
    cache[annee] = liste;
    return liste;
  }

  function estJourFerie(dateStr) {
    return joursFeriesFrance(Number(dateStr.slice(0, 4))).indexOf(dateStr) !== -1;
  }

  var api = {
    paques: paques,
    joursFeriesFrance: joursFeriesFrance,
    estJourFerie: estJourFerie,
    ajouterJours: ajouterJours
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.Feries = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
