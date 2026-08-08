/* ============================================================================
   chaine.test.js — Lot 5, correctif C6 : ce qui s'additionne sur une période
   et, surtout, ce qui ne s'additionne PAS.

   Ces cas verrouillent la règle centrale du récapitulatif de période : les
   compteurs (solde d'heures supplémentaires, solde de congés payés) ne se
   somment jamais. Additionner douze soldes de fin de mois produirait un
   nombre dépourvu de sens, et malheureusement crédible.

   ChaineMois.agregerPeriode est une fonction pure : aucun réseau, aucun DOM.
   Aucune dépendance : exécuté par test/run.js sous Node.
   ========================================================================= */
'use strict';

var Chaine = require('../js/chaine-mois.js');

function egal(obtenu, attendu, libelle) {
  if (obtenu !== attendu) {
    throw new Error(libelle + ' : attendu ' + JSON.stringify(attendu) +
      ', obtenu ' + JSON.stringify(obtenu));
  }
}

/* Fabrique un mois de la chaîne. Valeurs FICTIVES (dépôt public). */
function mois(annee, m, opts) {
  opts = opts || {};
  var entree = opts.compteurEntree || { minutesSup: 0, dixiemesCpAcquis: 0, dixiemesCpPris: 0 };
  var sortie = opts.compteurSortie || entree;
  return {
    annee: annee, mois: m, cle: annee + '-' + String(m).padStart(2, '0'),
    fige: !!opts.fige,
    salaire: opts.salaire || { date_effet: '2026-01-01' },
    salaireManquant: false,
    compteurEntree: entree,
    compteurSortie: sortie,
    resultat: {
      joursPresence: opts.presence || 0,
      entretienCentimes: opts.entretien || 0,
      minutesSupAcquises: opts.supAcquises || 0,
      joursCongesDecomptes: opts.conges || 0,
      imputation: opts.imputation ||
        { joursSurCp: 0, joursSurSup: 0, joursSansSolde: 0, minutesSupConsommees: 0, dixiemesCpConsommes: 0 },
      retenueSansSoldeCentimes: opts.retenue || 0,
      dixiemesCpAcquis: opts.cpAcquis || 0,
      salaireBrutCentimes: opts.brut || 0,
      salaireNetCentimes: opts.net || 0,
      salaireDateEffet: opts.dateEffet || '2026-01-01',
      totalAVerserCentimes: opts.total || 0,
      compteurSortie: sortie
    }
  };
}

var cas = [];

cas.push({
  nom: 'C6 — les flux s’additionnent sur la période',
  fn: function () {
    var a = Chaine.agregerPeriode([
      mois(2026, 1, { presence: 20, entretien: 10000, supAcquises: 600, net: 150000, brut: 195000, total: 160000 }),
      mois(2026, 2, { presence: 18, entretien: 9000, supAcquises: 540, net: 150000, brut: 195000, total: 159000 })
    ]);
    egal(a.nbMois, 2, 'nbMois');
    egal(a.joursPresence, 38, 'joursPresence');
    egal(a.entretienCentimes, 19000, 'entretienCentimes');
    egal(a.minutesSupAcquises, 1140, 'minutesSupAcquises');
    egal(a.salaireNetCentimes, 300000, 'salaireNetCentimes');
    egal(a.totalAVerserCentimes, 319000, 'totalAVerserCentimes');
  }
});

cas.push({
  nom: 'C6 — les COMPTEURS ne s’additionnent jamais : entrée du premier mois, sortie du dernier',
  fn: function () {
    var a = Chaine.agregerPeriode([
      mois(2026, 1, {
        compteurEntree: { minutesSup: 600, dixiemesCpAcquis: 100, dixiemesCpPris: 0 },
        compteurSortie: { minutesSup: 1200, dixiemesCpAcquis: 125, dixiemesCpPris: 0 }
      }),
      mois(2026, 2, {
        compteurEntree: { minutesSup: 1200, dixiemesCpAcquis: 125, dixiemesCpPris: 0 },
        compteurSortie: { minutesSup: 1800, dixiemesCpAcquis: 150, dixiemesCpPris: 0 }
      }),
      mois(2026, 3, {
        compteurEntree: { minutesSup: 1800, dixiemesCpAcquis: 150, dixiemesCpPris: 0 },
        compteurSortie: { minutesSup: 2400, dixiemesCpAcquis: 175, dixiemesCpPris: 100 }
      })
    ]);
    // La somme naïve des soldes de sortie vaudrait 1200+1800+2400 = 5400 : c'est
    // exactement le nombre qu'il ne faut PAS produire.
    egal(a.compteurEntree.minutesSup, 600, 'solde sup à l’entrée de la période');
    egal(a.compteurSortie.minutesSup, 2400, 'solde sup à la sortie de la période');
    egal(a.compteurSortie.dixiemesCpAcquis, 175, 'CP acquis cumulés (compteur du dernier mois)');
    egal(a.compteurSortie.dixiemesCpPris, 100, 'CP pris cumulés (compteur du dernier mois)');
  }
});

cas.push({
  nom: 'C6 — mois figés et mois provisoires sont distingués',
  fn: function () {
    var a = Chaine.agregerPeriode([
      mois(2026, 1, { fige: true }),
      mois(2026, 2, { fige: true }),
      mois(2026, 3, { fige: false })
    ]);
    egal(a.moisFiges.length, 2, 'nombre de mois figés');
    egal(a.moisProvisoires.length, 1, 'nombre de mois provisoires');
    egal(a.moisProvisoires[0].mois, 3, 'mois provisoire identifié');
  }
});

cas.push({
  nom: 'C6 — les barèmes multiples sont listés avec leurs mois (RG-15)',
  fn: function () {
    var a = Chaine.agregerPeriode([
      mois(2026, 7, { dateEffet: '2026-01-01', brut: 195000, net: 150000 }),
      mois(2026, 8, { dateEffet: '2026-01-01', brut: 195000, net: 150000 }),
      mois(2026, 9, { dateEffet: '2026-09-01', brut: 210000, net: 162000 })
    ]);
    egal(a.baremes.length, 2, 'deux barèmes sur la période');
    egal(a.baremes[0].dateEffet, '2026-01-01', 'premier barème');
    egal(a.baremes[0].mois.length, 2, 'mois du premier barème');
    egal(a.baremes[1].dateEffet, '2026-09-01', 'second barème');
    egal(a.baremes[1].mois.length, 1, 'mois du second barème');
  }
});

cas.push({
  nom: 'C6 — période vide : agrégat neutre, aucun compteur inventé',
  fn: function () {
    var a = Chaine.agregerPeriode([]);
    egal(a.nbMois, 0, 'nbMois');
    egal(a.totalAVerserCentimes, 0, 'totalAVerserCentimes');
    egal(a.compteurEntree, null, 'compteurEntree');
    egal(a.compteurSortie, null, 'compteurSortie');
  }
});

cas.push({
  nom: 'C4 — utilitaires de calendrier : comparaison, mois suivant/précédent, nombre de mois',
  fn: function () {
    egal(Chaine.cmpMois(2025, 12, 2026, 1) < 0, true, 'décembre 2025 précède janvier 2026');
    egal(Chaine.moisSuivant(2025, 12).annee, 2026, 'mois suivant : année');
    egal(Chaine.moisSuivant(2025, 12).mois, 1, 'mois suivant : mois');
    egal(Chaine.moisPrecedent(2026, 1).mois, 12, 'mois précédent : mois');
    egal(Chaine.nbMoisEntre(2025, 9, 2026, 8), 12, 'année de bilan = 12 mois');
    egal(Chaine.premierJour(2026, 2), '2026-02-01', 'premier jour de février');
    egal(Chaine.dernierJour(2028, 2), '2028-02-29', 'dernier jour de février bissextile');
    egal(Chaine.dernierJour(2026, 2), '2026-02-28', 'dernier jour de février non bissextile');
  }
});

module.exports = { cas: cas };
