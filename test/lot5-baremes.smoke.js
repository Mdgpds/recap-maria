/* ============================================================================
   lot5-baremes.smoke.js — Scénario de test demandé au correctif C5.

   « Barème A à 50 € avec effet au 1er janvier, récapitulatifs de janvier à
     août figés. Créer un barème B à 60 € avec effet au 1er septembre.
     Vérifier : août affiche toujours 50 €, septembre affiche 60 €, et rouvrir
     un mois figé ne déclenche aucun recalcul. »

   Exécuté sur la VRAIE chaîne des mois et le VRAI moteur, avec un DB simulé.
   Aucun réseau, aucun DOM. Lancement : node test/lot5-baremes.smoke.js
   ========================================================================= */
'use strict';

var Engine = require('../js/engine.js');

var echecs = 0;
function assert(cond, msg) { if (!cond) { echecs++; console.error('FAIL ' + msg); } else console.log('ok   ' + msg); }

/* Montants FICTIFS (dépôt public) : 50 € et 60 € nets, en centimes. */
var NET_A = 5000, BRUT_A = 6500;
var NET_B = 6000, BRUT_B = 7800;

var contrat = {
  id: 'c1', prenom_enfant: 'Alpha', famille_id: 'f1', famille: { id: 'f1', nom: 'Papillon' },
  jours_planning: [1, 2, 3, 4, 5], date_debut: '2026-01-01', date_fin: null, archive: false,
  minutes_sup_jour: 30, minutes_par_jour_conge: 540, entretien_centimes_jour: 500,
  ordre_imputation: 'cp_puis_sup', sup_dues_si_enfant_absent: true
};

var salaires = [
  /* Barème plus ancien, antérieur à la reprise des compteurs : sert au cas C4
     « remonter à une famille de l'année précédente ». */
  { id: 'Z', contrat_id: 'c1', date_effet: '2025-01-01', brut_mensuel_centimes: 6000, net_mensuel_centimes: 4500 },
  { id: 'A', contrat_id: 'c1', date_effet: '2026-01-01', brut_mensuel_centimes: BRUT_A, net_mensuel_centimes: NET_A },
  { id: 'B', contrat_id: 'c1', date_effet: '2026-09-01', brut_mensuel_centimes: BRUT_B, net_mensuel_centimes: NET_B }
];

/* Janvier à août 2026 figés, au barème A. Chaque instantané porte un marqueur :
   s'il ressort tel quel de la chaîne, c'est qu'aucun recalcul n'a eu lieu. */
var recapsFiges = [];
for (var m = 1; m <= 8; m++) {
  recapsFiges.push({
    id: 'r' + m, contrat_id: 'c1', annee: 2026, mois: m, statut: 'fige',
    fige_le: '2026-0' + m + '-28T10:00:00Z',
    donnees: {
      marqueurInstantane: 'figé-' + m,
      joursPresence: 20, entretienCentimes: 10000, minutesSupAcquises: 600,
      joursCongesDecomptes: 0,
      imputation: { joursSurCp: 0, joursSurSup: 0, joursSansSolde: 0, minutesSupConsommees: 0, dixiemesCpConsommes: 0 },
      retenueSansSoldeCentimes: 0, dixiemesCpAcquis: 25,
      salaireBrutCentimes: BRUT_A, salaireNetCentimes: NET_A,
      salaireDateEffet: '2026-01-01',
      prenomEnfant: 'Alpha', nomFamille: 'Papillon',
      totalAVerserCentimes: NET_A + 10000,
      compteurSortie: { minutesSup: 600 * m, dixiemesCpAcquis: 25 * m, dixiemesCpPris: 0 }
    }
  });
}

var ecritures = 0;
global.DB = {
  getSalaires: function () { return Promise.resolve(salaires); },
  getCompteurInitial: function () {
    /* Reprise manuelle des compteurs au 1er janvier 2026, avec un solde
       d'heures sup non nul : c'est lui qui doit reprendre la main sur tout
       cumul des mois antérieurs. */
    return Promise.resolve({ contrat_id: 'c1', date_reference: '2026-01-01', minutes_sup: 100, dixiemes_cp_acquis: 0, dixiemes_cp_pris: 0 });
  },
  getJourneesPeriode: function () { return Promise.resolve({}); },
  listRecapsPeriode: function (contratId) {
    return Promise.resolve(contratId === 'c1' ? recapsFiges : []);
  },
  enregistrerRecapBrouillon: function () { ecritures++; return Promise.resolve({}); },
  figerRecap: function () { ecritures++; return Promise.resolve({}); }
};

var Chaine = require('../js/chaine-mois.js');

/* Contrôle préalable de RG-15, sans passer par la chaîne. */
assert(Engine.salaireApplicable(salaires, 2026, 8).id === 'A', 'RG-15 : août relève du barème A');
assert(Engine.salaireApplicable(salaires, 2026, 9).id === 'B', 'RG-15 : septembre relève du barème B');
assert(Engine.salaireApplicable(salaires, 2026, 1).id === 'A', 'RG-15 : janvier relève du barème A');

Chaine.serie(contrat, { annee: 2026, mois: 9 }).then(function (s) {
  var parMois = {};
  s.mois.forEach(function (e) { parMois[e.mois] = e; });

  assert(s.mois.length === 9, 'chaîne de janvier à septembre : 9 mois');

  var aout = parMois[8];
  assert(!!aout && aout.fige === true, 'août est figé');
  assert(aout.resultat.salaireNetCentimes === NET_A, 'août affiche toujours 50 € (barème A)');
  assert(aout.resultat.marqueurInstantane === 'figé-8',
    'août ressort de l’instantané figé, sans recalcul');

  var septembre = parMois[9];
  assert(!!septembre && septembre.fige === false, 'septembre n’est pas figé');
  assert(septembre.resultat.salaireNetCentimes === NET_B, 'septembre affiche 60 € (barème B)');
  assert(septembre.salaire && septembre.salaire.id === 'B', 'septembre applique bien le barème B');
  assert(septembre.resultat.marqueurInstantane === undefined,
    'septembre est bien un calcul courant, pas un instantané');

  var moisFigesRecalcules = s.mois.filter(function (e) {
    return e.fige && e.resultat.marqueurInstantane === undefined;
  });
  assert(moisFigesRecalcules.length === 0,
    'aucun des 8 mois figés n’a été recalculé — la création du barème B ne les touche pas');

  assert(septembre.compteurEntree.minutesSup === 600 * 8,
    'le compteur d’entrée de septembre vient du dernier instantané figé (août)');
  assert(aout.compteurEntree.minutesSup === 600 * 7,
    'le compteur d’entrée d’un mois figé se relit dans son propre instantané');

  assert(ecritures === 0, 'aucune écriture déclenchée par la simple consultation');

  /* La période septembre 2025 → août 2026 mélange mois figés et non figés :
     l'agrégat doit signaler les provisoires et lister les deux barèmes. */
  var agregat = Chaine.agregerPeriode(s.mois);
  assert(agregat.moisFiges.length === 8, 'agrégat : 8 mois figés');
  assert(agregat.moisProvisoires.length === 1, 'agrégat : 1 mois provisoire (septembre)');
  assert(agregat.baremes.length === 2, 'agrégat : deux barèmes appliqués sur la période');
  assert(agregat.compteurSortie.minutesSup === septembre.compteurSortie.minutesSup,
    'agrégat : le solde de sortie est celui du dernier mois, pas une somme');

  /* C4 — un mois ANTÉRIEUR à la reprise manuelle des compteurs reste
     consultable : c'est tout l'objet de « remonter à une famille de l'année
     précédente ». Il est calculé, mais signalé comme non significatif côté
     compteurs. */
  var contratAncien = {};
  Object.keys(contrat).forEach(function (k) { contratAncien[k] = contrat[k]; });
  contratAncien.id = 'c1-ancien';
  contratAncien.date_debut = '2025-01-01';   // commencé AVANT la reprise des compteurs

  return Chaine.serie(contratAncien, { annee: 2025, mois: 11 }).then(function (avant) {
    assert(avant.mois.length === 1, 'C4 : un mois antérieur à l’initialisation reste calculé');
    var e = avant.mois[0];
    assert(e.avantInitialisation === true, 'C4 : ce mois est signalé comme antérieur à la reprise');
    assert(e.salaireManquant === false, 'C4 : le barème applicable est bien trouvé (message honnête)');
    assert(e.compteurEntree.minutesSup === 0, 'C4 : ses compteurs repartent de zéro');
    assert(e.resultat.joursPresence > 0, 'C4 : ses jours de présence sont calculés');

    /* C6 — une période qui COMMENCE avant la reprise des compteurs doit être
       couverte en entier, sans troncature silencieuse, et le compteur saisi
       doit reprendre la main au mois de la reprise. */
    return Chaine.serie(contratAncien, { annee: 2026, mois: 2 },
      { depuis: { annee: 2025, mois: 11 } });
  }).then(function (s2) {
    assert(s2.mois.length === 4,
      'C6 : la chaîne couvre toute la fenêtre demandée (nov. 2025 → févr. 2026)');
    assert(s2.mois[0].annee === 2025 && s2.mois[0].mois === 11,
      'C6 : elle commence bien au mois demandé');
    assert(s2.mois[0].avantInitialisation === true && s2.mois[1].avantInitialisation === true,
      'C6 : les mois d’avant la reprise sont marqués');
    assert(s2.mois[0].compteurEntree.minutesSup === 0,
      'C6 : ces mois partent de zéro');
    assert(s2.mois[2].avantInitialisation === false,
      'C6 : le mois de la reprise n’est plus marqué');
    assert(s2.mois[2].compteurEntree.minutesSup === 100,
      'C6 : au mois de la reprise, le compteur SAISI reprend la main sur le cumul antérieur');
  });
}).then(function () {
  console.log('\n' + (echecs === 0 ? 'Tout est conforme.' : echecs + ' échec(s).'));
  process.exit(echecs === 0 ? 0 : 1);
}).catch(function (e) {
  console.error('Erreur :', e);
  process.exit(1);
});
