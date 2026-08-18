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

  /* LOT 17 §17.6 — les congés payés sont stockés en MINUTES, et continuent
     de s'AFFICHER en jours. « Elle continue de voir 10 j. »

     La conversion est exacte : `minutes × 10 / minutes_par_jour_conge` donne
     les dixièmes d'autrefois. Quand le compte tombe juste sur un dixième —
     c'est le cas de TOUTES les quantités d'avant le lot 17, et de la très
     grande majorité de celles d'après — on rend exactement ce que rendait
     `dixiemesEnJours`, au caractère près : rien ne change à l'écran.

     Quand il ne tombe pas juste, c'est qu'un congé à l'heure est passé par là
     (15 min, 1 h 45). On rend alors les jours entiers PLUS le reliquat en
     heures — « 3 j 1h45 » — au lieu d'arrondir. Arrondir ici recréerait
     exactement le défaut que le passage aux minutes existe pour supprimer :
     des minutes perdues ou gagnées que personne ne voit passer.

     `minutesParJour` est un DIVISEUR : une valeur absente ou nulle rendrait
     un infini, affiché tel quel à Maria. On refuse plutôt de convertir. */
  function minutesEnJoursCp(minutes, minutesParJour) {
    var m = minutes || 0;
    if (!minutesParJour || minutesParJour <= 0) return minutesEnHeures(m);

    var signe = m < 0 ? '-' : '';
    var abs = m < 0 ? -m : m;

    /* Le compte tombe-t-il sur un dixième de jour entier ? */
    if ((abs * 10) % minutesParJour === 0) {
      return signe + dixiemesEnJours(abs * 10 / minutesParJour);
    }
    var joursEntiers = Math.floor(abs / minutesParJour);
    var reste = abs - joursEntiers * minutesParJour;
    if (joursEntiers === 0) return signe + minutesEnHeures(reste);
    return signe + joursEntiers + NBSP + 'j' + NBSP + minutesEnHeures(reste);
  }

  var api = {
    minutesEnHeures: minutesEnHeures,
    centimesEnEuros: centimesEnEuros,
    /* Conservée : les EXPORTS et les documents figés d'avant le lot 17
       portent des dixièmes, et se relisent tels quels. */
    dixiemesEnJours: dixiemesEnJours,
    minutesEnJoursCp: minutesEnJoursCp
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.Format = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
