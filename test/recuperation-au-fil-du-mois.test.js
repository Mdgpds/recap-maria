/* ============================================================================
   recuperation-au-fil-du-mois.test.js — LA RÉCUPÉRATION SE GAGNE JOUR APRÈS
   JOUR.

   Brief du 28 août 2026 : « Chaque journée travaillée rapporte 30 minutes qui
   alimentent la réserve de récupération. Cette réserve monte au fil du mois :
   elle n'est pas figée au 1er. Un jour de récupération que Maria ne peut pas
   prendre le 5 mai devient possible le 28, parce qu'entre-temps elle a
   travaillé. »

   Les trois arbitrages, tranchés le 28 août et vérifiés ici un par un :
     1. seules les journées DÉJÀ PASSÉES comptent ;
     2. les congés payés ne changent pas ;
     3. le jour posé ne se finance pas lui-même.

   La preuve qu'aucun montant ne bouge sur les mois qui se calculaient déjà
   vit dans `test/recuperation-differentiel.test.js`.

   Valeurs FICTIVES (dépôt public).
   ========================================================================= */
'use strict';

var Engine = require('../js/engine.js');

var cas = [];
function test(nom, fn) { cas.push({ nom: nom, fn: fn }); }
function assert(cond, message) { if (!cond) throw new Error(message); }
function egal(obtenu, attendu, libelle) {
  if (obtenu !== attendu) {
    throw new Error(libelle + ' : attendu ' + JSON.stringify(attendu) +
      ', obtenu ' + JSON.stringify(obtenu));
  }
}

/* Le contrat du décor. `minutes_par_jour_conge` et `minutes_sup_jour` sont
   des PARAMÈTRES : les faire varier d'un cas à l'autre est le seul moyen
   d'écrire des cas lisibles sans dépendre du nombre de fériés d'un mois. */
function conditions(v) {
  return {
    date_effet: '2020-01-01', numero: 1,
    jours_planning: v.planning || [1, 2, 3, 4, 5],
    heure_arrivee: '08:30', heure_depart: '17:30',
    minutes_contractuelles: 540,
    minutes_sup_jour: v.minutesSupJour == null ? 30 : v.minutesSupJour,
    minutes_par_jour_conge: v.mpjc || 540,
    entretien_centimes_jour: 550,
    sup_dues_si_enfant_absent: true,
    ordre_imputation: v.ordre || 'cp_puis_sup',
    brut_mensuel_centimes: 137289, net_mensuel_centimes: 105000
  };
}

function calculer(v) {
  return Engine.calculerMois({
    contrat: { id: 'c1', date_debut: '2000-01-01', date_fin: null },
    conditions: conditions(v),
    journees: v.journees || [],
    compteurEntree: v.compteurEntree ||
      { minutesSup: 0, minutesCpAcquis: 0, minutesCpPris: 0 },
    annee: v.annee || 2025, mois: v.mois || 5,
    imputations: v.imputations || [],
    samedisComptes: v.samedisComptes || [],
    aujourdhui: v.aujourdhui
  });
}

function refus(v) {
  try {
    calculer(v);
    return null;
  } catch (e) {
    return e.code || e.message;
  }
}

/* Un jour de récupération posé, ventilé entièrement sur la récupération. */
function recuperation(jour) {
  return {
    date_debut: jour, date_fin: jour, jours_ouvrables: 1,
    jours_sur_cp: 0, jours_sur_sup: 1, jours_sans_solde: 0
  };
}
function jourDeConge(jour) { return { jour: jour, type: 'conge_maria' }; }

/* ------------------------------------------------------------------ */
/* LE CAS DU BRIEF (§2)                                                */
/* ------------------------------------------------------------------ */

/* Mai 2025, compteur d'entrée 540 min — un jour de récupération —, deux jours
   posés : le 6 et le 28.

   Le planning inclut le samedi. Ce n'est pas un artifice : avec deux fériés
   (le 1er et le 8) et un samedi non travaillé, mai 2025 ne finance PAS un
   second jour de 9 h avant le 28 — le moteur le refuse alors, et il a raison
   (cas « le mois ne finance vraiment pas » plus bas). C'est la règle qu'on
   teste, pas l'arithmétique d'un mois particulier. */
var CAS_DU_BRIEF = {
  planning: [1, 2, 3, 4, 5, 6],
  compteurEntree: { minutesSup: 540, minutesCpAcquis: 0, minutesCpPris: 0 },
  journees: [jourDeConge('2025-05-06'), jourDeConge('2025-05-28')],
  imputations: [recuperation('2025-05-06'), recuperation('2025-05-28')]
};

test('§2 — mai, entrée 540 min, récupération posée le 6 ET le 28 : ACCEPTÉ',
  function () {
    var v = {};
    for (var k in CAS_DU_BRIEF) v[k] = CAS_DU_BRIEF[k];
    v.aujourdhui = '2025-06-01';        // le mois est passé en entier
    var r = calculer(v);
    egal(r.imputation.joursSurSup, 2,
      'les deux jours sont pris sur la récupération');
    egal(r.imputation.joursSansSolde, 0,
      'aucun jour ne bascule en sans solde : le mois les a financés');
    /* Le compteur de sortie ne se devine pas : entrée + acquis − consommé. */
    egal(r.compteurSortie.minutesSup,
      540 + r.minutesSupAcquises - r.imputation.minutesSupConsommees,
      'compteur de sortie = entrée + acquises − consommées');
    egal(r.imputation.minutesSupConsommees, 1080, 'deux jours à 540 min');
  });

test('§2 — le même mois SANS `aujourdhui` : le moteur refuse, exactement comme avant',
  function () {
    egal(refus(CAS_DU_BRIEF), 'IMPUTATION_DEPASSE_RESERVES',
      'sans la date du jour, la réserve reste celle du 1er');
  });

test('§4.1 — la même paire posée DEUX FOIS EN DÉBUT DE MOIS reste refusée',
  function () {
    /* Le 2 et le 5 mai : le mois n'a rien eu le temps de financer. */
    var code = refus({
      planning: [1, 2, 3, 4, 5, 6],
      compteurEntree: { minutesSup: 540, minutesCpAcquis: 0, minutesCpPris: 0 },
      journees: [jourDeConge('2025-05-02'), jourDeConge('2025-05-05')],
      imputations: [recuperation('2025-05-02'), recuperation('2025-05-05')],
      aujourdhui: '2025-06-01'
    });
    assert(code === 'IMPUTATION_DEPASSE_RESERVES' ||
           code === 'RESERVES_PAS_ENCORE_ACQUISES',
      'deux jours en début de mois doivent être refusés, obtenu : ' + code);
  });

test('§4.1 — un mois qui ne finance vraiment pas le second jour est TOUJOURS refusé',
  function () {
    /* Même cas du brief, planning lundi-vendredi : 16 journées travaillées
       avant le 28 (deux fériés, un congé), soit 480 min — il en faut 540. Le
       refus est franc, et c'est le bon : la période n'est pas financée, même
       à la fin du mois. */
    egal(refus({
      planning: [1, 2, 3, 4, 5],
      compteurEntree: { minutesSup: 540, minutesCpAcquis: 0, minutesCpPris: 0 },
      journees: [jourDeConge('2025-05-06'), jourDeConge('2025-05-28')],
      imputations: [recuperation('2025-05-06'), recuperation('2025-05-28')],
      aujourdhui: '2025-06-01'
    }), 'IMPUTATION_DEPASSE_RESERVES',
      'une période réellement non financée est toujours refusée');
  });

/* ------------------------------------------------------------------ */
/* LES TROIS ARBITRAGES                                                */
/* ------------------------------------------------------------------ */

/* Décor à l'échelle de la journée : une journée travaillée rapporte 30 min,
   et un jour de congé en coûte 30. Une journée travaillée finance donc
   exactement un jour de récupération — les cas se lisent sans arithmétique. */
var UN_JOUR_FINANCE_UN_JOUR = { mpjc: 30, minutesSupJour: 30 };

function unJourPose(jour, aujourdhui) {
  return {
    mpjc: 30, minutesSupJour: 30,
    journees: [jourDeConge(jour)],
    imputations: [recuperation(jour)],
    aujourdhui: aujourdhui
  };
}

test('arbitrage 3 — le jour posé ne se finance pas LUI-MÊME',
  function () {
    /* Le 2 mai 2025 est la PREMIÈRE journée travaillée du mois (le 1er est
       férié). Rien ne la précède : la réserve y est nulle. Si la journée
       posée se comptait elle-même, ses 30 minutes couvriraient le jour et le
       moteur accepterait. */
    egal(refus(unJourPose('2025-05-02', '2025-06-01')),
      'IMPUTATION_DEPASSE_RESERVES',
      'le premier jour travaillé du mois ne peut pas se payer lui-même');
    /* La journée suivante, elle, est financée par celle d'avant. */
    var r = calculer(unJourPose('2025-05-05', '2025-06-01'));
    egal(r.imputation.joursSurSup, 1,
      'le 5 mai est financé par la journée du 2');
  });

test('arbitrage 1 — une journée À VENIR ne finance rien, et le refus le DIT',
  function () {
    /* Posé le 30 mai, alors qu'on est le 2 : le mois financera ce jour, mais
       les heures ne sont pas faites. Refus — et refus NOMMÉ. */
    egal(refus(unJourPose('2025-05-30', '2025-05-02')),
      'RESERVES_PAS_ENCORE_ACQUISES',
      'les heures ne sont pas encore acquises');
    /* Le même jour, une fois le mois passé : accepté. Rien d'autre n'a
       changé que la date du jour. */
    egal(calculer(unJourPose('2025-05-30', '2025-06-01')).imputation.joursSurSup, 1,
      'le même jour, les heures faites, est accepté');
  });

test('arbitrage 1 — « déjà passée » est STRICTEMENT antérieur à la date du jour',
  function () {
    /* Posé le 5 mai. La seule journée qui pourrait le financer est le 2.
       Au 5 mai, elle est passée : accepté. Au 2 mai, elle ne l'est pas
       encore — le 2 n'est pas antérieur au 2. */
    egal(calculer(unJourPose('2025-05-05', '2025-05-05')).imputation.joursSurSup, 1,
      'au 5 mai, la journée du 2 est acquise');
    egal(refus(unJourPose('2025-05-05', '2025-05-02')),
      'RESERVES_PAS_ENCORE_ACQUISES',
      'au 2 mai, la journée du 2 n’est pas encore acquise');
  });

test('arbitrage 2 — les CONGÉS PAYÉS gardent la réserve d’entrée du mois',
  function () {
    /* Un jour de congé payé posé le 30 mai, sans un centime de congés payés
       au 1er : la réserve de congés payés ne monte pas au fil du mois, et le
       moteur refuse — même avec `aujourdhui` bien après le mois. */
    egal(refus({
      mpjc: 30, minutesSupJour: 30,
      journees: [jourDeConge('2025-05-30')],
      imputations: [{ date_debut: '2025-05-30', date_fin: '2025-05-30',
        jours_ouvrables: 1, jours_sur_cp: 1, jours_sur_sup: 0, jours_sans_solde: 0 }],
      aujourdhui: '2025-06-01'
    }), 'IMPUTATION_DEPASSE_RESERVES',
      'les congés payés ne se gagnent pas au fil du mois');
  });

/* ------------------------------------------------------------------ */
/* LA FORMULE, TERME PAR TERME (§1)                                    */
/* ------------------------------------------------------------------ */

test('§1 — la récupération DÉJÀ CONSOMMÉE dans le mois est déduite',
  function () {
    /* Un jour de congé coûte ici DEUX journées travaillées (60 min contre
       30 par jour). Deux jours posés, le 6 et le 9 mai 2025 — deux périodes
       distinctes, séparées par une journée travaillée et un férié.

       Le 6 est financé par le 2 et le 5 : 60 min, exactement. Avant le 9, le
       mois a rapporté 90 min (le 2, le 5, le 7 — le 6 est en congé, le 8 est
       férié). Sans la déduction des 60 min que le 6 a consommées, le 9
       passerait ; avec, il en reste 30 pour un jour qui en coûte 60. */
    var code = refus({
      mpjc: 60, minutesSupJour: 30,
      journees: [jourDeConge('2025-05-06'), jourDeConge('2025-05-09')],
      imputations: [recuperation('2025-05-06'), recuperation('2025-05-09')],
      aujourdhui: '2025-06-01'
    });
    assert(code === 'IMPUTATION_DEPASSE_RESERVES' ||
           code === 'RESERVES_PAS_ENCORE_ACQUISES',
      'la même journée ne peut pas financer deux jours, obtenu : ' + code);
    /* Et la preuve que c'est bien la DÉDUCTION qui refuse, pas le décor :
       le 9 seul, sans le 6, est accepté. */
    egal(calculer({
      mpjc: 60, minutesSupJour: 30,
      journees: [jourDeConge('2025-05-09')],
      imputations: [recuperation('2025-05-09')],
      aujourdhui: '2025-06-01'
    }).imputation.joursSurSup, 1, 'le 9 seul est financé');
  });

test('§1 — une journée qui n’est PAS travaillée n’alimente rien',
  function () {
    /* Le 2 mai en absence de l'enfant : depuis le lot 28, une absence ne
       porte aucune minute. Le 5 n'est donc plus financé. La liste des types
       qui rapportent n'est pas réécrite ici — c'est le moteur qui la connaît,
       et c'est bien lui qu'on interroge. */
    egal(refus({
      mpjc: 30, minutesSupJour: 30,
      journees: [{ jour: '2025-05-02', type: 'absence_enfant' },
                 jourDeConge('2025-05-05')],
      imputations: [recuperation('2025-05-05')],
      aujourdhui: '2025-06-01'
    }), 'IMPUTATION_DEPASSE_RESERVES',
      'une absence de l’enfant sans minutes ne finance rien');
  });

test('§1 — le relevé exposé est bien celui des minutes du jour',
  function () {
    var r = calculer({
      journees: [{ jour: '2025-05-02', type: 'presence',
                   minutes_sup_exceptionnelles: 15 }],
      aujourdhui: '2025-06-01'
    });
    var jour2 = r.minutesSupParJour.filter(function (x) {
      return x.jour === '2025-05-02';
    })[0];
    egal(jour2 && jour2.minutes, 45,
      'la journée du 2 mai porte ses 30 min de base plus 15 exceptionnelles');
    /* Le relevé est trié : c'est ce qui rend la lecture « avant une date »
       lisible, et les écrans n'ont rien à trier. */
    var trie = r.minutesSupParJour.map(function (x) { return x.jour; });
    var copie = trie.slice().sort();
    egal(JSON.stringify(trie), JSON.stringify(copie),
      'le relevé sort dans l’ordre du calendrier');
    /* Et la somme du relevé vaut les minutes acquises du mois : le relevé
       n'invente rien, il détaille. */
    var somme = r.minutesSupParJour.reduce(function (t, x) { return t + x.minutes; }, 0);
    egal(somme, r.minutesSupAcquises,
      'la somme du relevé vaut les minutes acquises du mois');
  });

test('§1 — un écart d’horaire imputé à la récupération entre au relevé, en négatif',
  function () {
    var r = calculer({
      journees: [{ jour: '2025-05-02', type: 'presence',
                   ecart_minutes: -60, ecart_impute_sur: 'recuperation' }],
      aujourdhui: '2025-06-01'
    });
    var jour2 = r.minutesSupParJour.filter(function (x) {
      return x.jour === '2025-05-02';
    })[0];
    egal(jour2 && jour2.minutes, -30,
      '30 min de base moins une heure rendue');
  });

/* ------------------------------------------------------------------ */
/* LA RÉSERVE À LA DATE, LUE PAR LES ÉCRANS                            */
/* ------------------------------------------------------------------ */

test('§4.2 — `recuperationALaDate` rend la formule du §1, et rien d’autre',
  function () {
    var r = calculer({
      mpjc: 30, minutesSupJour: 30,
      journees: [jourDeConge('2025-05-05')],
      imputations: [recuperation('2025-05-05')],
      aujourdhui: '2025-06-01'
    });
    /* Avant le 5 : la seule journée passée est le 2, et rien n'est encore
       consommé. */
    egal(Engine.recuperationALaDate(r, 0, '2025-05-05', '2025-06-01'), 30,
      'au 5 mai : une journée acquise, rien de consommé');
    /* Après le 5 : le 2, le 6 et le 7 sont acquis, et le 5 a consommé 30. */
    egal(Engine.recuperationALaDate(r, 0, '2025-05-08', '2025-06-01'), 60,
      'au 8 mai : trois journées acquises moins le jour posé le 5');
    /* Sans date du jour, on rend le compteur d'entrée, un point c'est tout —
       c'est ce qui garantit qu'un appelant sans horloge ne change pas de
       réponse. */
    egal(Engine.recuperationALaDate(r, 540, '2025-05-28', null), 540,
      'sans `aujourdhui`, la réserve reste celle du 1er');
  });

test('§4.2 — la réserve à la date NE DÉPASSE JAMAIS ce que le moteur accepte',
  function () {
    /* Le contrôle qui compte : sur trente dates du mois, ce que
       `recuperationALaDate` annonce et ce que le moteur accepte sont le même
       nombre. C'est le défaut du lot 16 — « l'écran propose plus que le
       moteur n'accepte » — vérifié dans l'autre sens, à chaque date. */
    var base = { mpjc: 30, minutesSupJour: 30, aujourdhui: '2025-06-01' };
    var reference = calculer(base);
    for (var q = 1; q <= 31; q++) {
      var jour = '2025-05-' + (q < 10 ? '0' + q : q);
      var annonce = Engine.recuperationALaDate(reference, 0, jour, '2025-06-01');
      var joursAnnonces = Math.floor(annonce / 30);
      if (joursAnnonces < 1) continue;                    // rien à poser ce jour-là
      /* RG-06 : un jour qui ne se décompte pas — férié, hors planning — ne
         se pose pas non plus. Le refus qu'il produirait n'aurait rien à voir
         avec les réserves. */
      if (Engine.decompterJoursOuvrables(jour, jour, [1, 2, 3, 4, 5], []) !== 1) continue;
      var accepte = null;
      try {
        accepte = calculer({
          mpjc: 30, minutesSupJour: 30,
          journees: [jourDeConge(jour)],
          imputations: [recuperation(jour)],
          aujourdhui: '2025-06-01'
        });
      } catch (e) { accepte = null; }
      assert(accepte !== null,
        'le ' + jour + ' : l’écran annonce ' + joursAnnonces +
        ' jour(s) mobilisable(s) et le moteur refuse');
    }
  });

/* ------------------------------------------------------------------ */
/* LE MOTEUR RESTE PUR                                                 */
/* ------------------------------------------------------------------ */

test('§3 — le moteur n’a toujours pas d’horloge : la date entre par les paramètres',
  function () {
    var source = require('fs').readFileSync(require('path')
      .join(__dirname, '..', 'js', 'engine.js'), 'utf8');
    /* `new Date`, `Date.now`, `document`, `fetch` : aucun des quatre. Les
       chaînes de commentaire contenant le mot « Date » sont sans effet — on
       cherche des APPELS. */
    /* `new Date(Date.UTC(...))` reste permis : c'est de l'ARITHMÉTIQUE de
       calendrier sur une date donnée, pas une lecture d'horloge. Ce qu'on
       interdit, c'est de demander l'heure au système. */
    assert(source.indexOf('new Date()') === -1, 'aucune horloge dans le moteur');
    assert(source.indexOf('Date.now') === -1, 'aucun `Date.now` dans le moteur');
    /* « document » apparaît en toutes lettres dans les commentaires du
       moteur (le document remis à la famille) : on cherche un APPEL au DOM,
       pas le mot. */
    assert(!/document\.(getElement|querySelector|createElement|body)/.test(source),
      'aucun DOM dans le moteur');
    assert(source.indexOf('fetch(') === -1, 'aucun réseau dans le moteur');
    /* Et la date du jour est bien LUE dans les entrées. */
    assert(source.indexOf('entrees.aujourdhui') !== -1,
      '`aujourdhui` doit entrer par les paramètres de `calculerMois`');
  });

module.exports = { cas: cas };
