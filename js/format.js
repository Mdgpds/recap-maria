/* ============================================================================
   format.js — Conversions d'affichage.

   Module pur, aucune dépendance. Le stockage et les calculs sont en entiers
   (minutes, centimes, dixièmes de jour) ; la mise en forme lisible ne se fait
   qu'ici, à l'affichage, par arithmétique entière exclusivement (§1 specs :
   aucun nombre à virgule flottante dans un calcul).

   Espaces : séparateur de milliers et espace avant € = espace insécable
   (U+00A0), pour éviter les retours à la ligne malheureux dans WhatsApp.
   ========================================================================= */
(function (global) {
  'use strict';

  var NBSP = '\u00a0';

  /* 570 -> "9h30" ; 660 -> "11h00" ; -150 -> "-2h30" ; 0 -> "0h00" */
  function minutesEnHeures(minutes) {
    var signe = minutes < 0 ? '-' : '';
    var abs = minutes < 0 ? -minutes : minutes;
    var h = Math.floor(abs / 60);
    var m = abs % 60;
    return signe + h + 'h' + String(m).padStart(2, '0');
  }

  /* 137289 -> "1 372,89 €" ; 500 -> "5,00 €" ; -6336 -> "-63,36 €" */
  function centimesEnEuros(centimes) {
    var signe = centimes < 0 ? '-' : '';
    var abs = centimes < 0 ? -centimes : centimes;
    var euros = Math.floor(abs / 100);
    var cts = abs % 100;
    var eurosStr = String(euros).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
    return signe + eurosStr + ',' + String(cts).padStart(2, '0') + NBSP + '€';
  }

  /* 25 -> "2,5 j" ; 30 -> "3 j" ; 0 -> "0 j" */
  function dixiemesEnJours(dixiemes) {
    var signe = dixiemes < 0 ? '-' : '';
    var abs = dixiemes < 0 ? -dixiemes : dixiemes;
    var entiers = Math.floor(abs / 10);
    var reste = abs % 10;
    return signe + (reste === 0 ? String(entiers) : entiers + ',' + reste) + NBSP + 'j';
  }

  var api = {
    minutesEnHeures: minutesEnHeures,
    centimesEnEuros: centimesEnEuros,
    dixiemesEnJours: dixiemesEnJours
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.Format = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
