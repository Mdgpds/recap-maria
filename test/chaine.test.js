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
  var entree = opts.compteurEntree || { minutesSup: 0, minutesCpAcquis: 0, minutesCpPris: 0 };
  var sortie = opts.compteurSortie || entree;
  return {
    annee: annee, mois: m, cle: annee + '-' + String(m).padStart(2, '0'),
    fige: !!opts.fige,
    horsContrat: !!opts.horsContrat,
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
        { joursSurCp: 0, joursSurSup: 0, joursSansSolde: 0, minutesSupConsommees: 0, minutesCpConsommees: 0 },
      retenueSansSoldeCentimes: opts.retenue || 0,
      minutesCpAcquis: opts.cpAcquis || 0,
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
        compteurEntree: { minutesSup: 600, minutesCpAcquis: 100, minutesCpPris: 0 },
        compteurSortie: { minutesSup: 1200, minutesCpAcquis: 125, minutesCpPris: 0 }
      }),
      mois(2026, 2, {
        compteurEntree: { minutesSup: 1200, minutesCpAcquis: 125, minutesCpPris: 0 },
        compteurSortie: { minutesSup: 1800, minutesCpAcquis: 150, minutesCpPris: 0 }
      }),
      mois(2026, 3, {
        compteurEntree: { minutesSup: 1800, minutesCpAcquis: 150, minutesCpPris: 0 },
        compteurSortie: { minutesSup: 2400, minutesCpAcquis: 175, minutesCpPris: 100 }
      })
    ]);
    // La somme naïve des soldes de sortie vaudrait 1200+1800+2400 = 5400 : c'est
    // exactement le nombre qu'il ne faut PAS produire.
    egal(a.compteurEntree.minutesSup, 600, 'solde sup à l’entrée de la période');
    egal(a.compteurSortie.minutesSup, 2400, 'solde sup à la sortie de la période');
    egal(a.compteurSortie.minutesCpAcquis, 175, 'CP acquis cumulés (compteur du dernier mois)');
    egal(a.compteurSortie.minutesCpPris, 100, 'CP pris cumulés (compteur du dernier mois)');
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
  nom: 'B1 — les mois hors de la période du contrat n’entrent JAMAIS dans les totaux',
  fn: function () {
    /* Contrat terminé fin mars : les mois d'avril à août sont rejoués pour la
       continuité des compteurs, mais ils ne sont pas des résultats mensuels —
       aucun récapitulatif n'existe pour eux. Sans ce filtre, le moteur y
       renvoie quand même le net du barème et le total gonfle d'autant. */
    var a = Chaine.agregerPeriode([
      mois(2026, 2, { presence: 20, net: 107200, total: 118200 }),
      mois(2026, 3, { presence: 22, net: 107200, total: 118200 }),
      mois(2026, 4, { presence: 0, net: 107200, total: 107200, horsContrat: true }),
      mois(2026, 5, { presence: 0, net: 107200, total: 107200, horsContrat: true })
    ]);
    egal(a.nbMois, 2, 'seuls les mois couverts par le contrat sont comptés');
    egal(a.joursPresence, 42, 'joursPresence');
    egal(a.salaireNetCentimes, 214400, 'deux mois de net, pas quatre');
    egal(a.totalAVerserCentimes, 236400, 'total versé sans les mois hors contrat');
    egal(a.moisHorsContrat.length, 2, 'les mois hors contrat sont recensés, pas comptés');
  }
});

cas.push({
  nom: 'B1 — fenetreContrat : intersection de la période demandée et du contrat',
  fn: function () {
    var contrat = { date_debut: '2025-09-01', date_fin: '2026-03-31' };
    var f = Chaine.fenetreContrat(contrat, { annee: 2025, mois: 9 }, { annee: 2026, mois: 8 });
    egal(f.debut.mois, 9, 'début : septembre 2025');
    egal(f.debut.annee, 2025, 'début : année');
    egal(f.fin.mois, 3, 'fin ramenée à mars 2026');
    egal(f.fin.annee, 2026, 'fin : année');

    var enCours = Chaine.fenetreContrat({ date_debut: '2026-01-01', date_fin: null },
      { annee: 2025, mois: 9 }, { annee: 2026, mois: 8 });
    egal(enCours.debut.mois, 1, 'contrat en cours : début ramené à janvier 2026');
    egal(enCours.fin.mois, 8, 'contrat en cours : fin inchangée');

    egal(Chaine.fenetreContrat({ date_debut: '2027-01-01', date_fin: null },
      { annee: 2025, mois: 9 }, { annee: 2026, mois: 8 }), null,
      'contrat entièrement hors période : aucune fenêtre');
    egal(Chaine.fenetreContrat({ date_debut: '2020-01-01', date_fin: '2021-06-30' },
      { annee: 2025, mois: 9 }, { annee: 2026, mois: 8 }), null,
      'contrat terminé avant la période : aucune fenêtre');
  }
});

cas.push({
  nom: 'B1 — contratToucheLeMois : mêmes bornes que listContratsPourMois',
  fn: function () {
    var c = { date_debut: '2026-03-16', date_fin: '2026-03-15' };
    egal(Chaine.contratToucheLeMois({ date_debut: '2025-09-01', date_fin: '2026-03-15' }, 2026, 3), true,
      'archivé le 15 du mois : le mois est couvert');
    egal(Chaine.contratToucheLeMois({ date_debut: '2025-09-01', date_fin: '2026-03-15' }, 2026, 4), false,
      'mois suivant la fin : non couvert');
    egal(Chaine.contratToucheLeMois({ date_debut: '2026-03-31', date_fin: null }, 2026, 3), true,
      'commencé le dernier jour du mois : couvert');
    egal(Chaine.contratToucheLeMois({ date_debut: '2026-04-01', date_fin: null }, 2026, 3), false,
      'commencé le mois suivant : non couvert');
    egal(typeof c, 'object', 'garde-fou de lecture');
  }
});

cas.push({
  nom: 'C6 — totaliserAgregats : les flux se somment entre contrats, aucun compteur',
  fn: function () {
    var a1 = Chaine.agregerPeriode([mois(2026, 1, { presence: 20, entretien: 10000, net: 150000, total: 160000,
      compteurSortie: { minutesSup: 600, minutesCpAcquis: 25, minutesCpPris: 0 } })]);
    var a2 = Chaine.agregerPeriode([mois(2026, 1, { presence: 18, entretien: 9000, net: 140000, total: 149000,
      compteurSortie: { minutesSup: 540, minutesCpAcquis: 25, minutesCpPris: 0 } })]);
    var t = Chaine.totaliserAgregats([a1, a2]);
    egal(t.nbContrats, 2, 'nbContrats');
    egal(t.joursPresence, 38, 'joursPresence');
    egal(t.entretienCentimes, 19000, 'entretienCentimes');
    egal(t.totalAVerserCentimes, 309000, 'totalAVerserCentimes');
    egal(t.minutesSup, undefined, 'aucun solde d’heures sup global n’est produit');
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

/* ================================================================== */
/* LOT 13 — Écarts entre deux instantanés d'un même mois              */
/*                                                                    */
/* Un mois rouvert puis reclôturé peut changer de valeurs pour deux   */
/* raisons : une journée corrigée, ou un barème modifié entre-temps.  */
/* Sans cette comparaison, le second cas passerait inaperçu — y       */
/* compris pour le parent qui a déjà l'ancien document entre les      */
/* mains.                                                             */
/* ================================================================== */

/* Instantané minimal, valeurs FICTIVES (dépôt public).

   Depuis la correction C2 (relecture lot 13), un instantané ne se compare plus
   seulement sur ses montants : il porte aussi `imputation` et `compteurSortie`,
   deux blocs IMBRIQUÉS. D'où les options `cpMois`, `supMois`, `cpPris`,
   `supRestante` — les compteurs que RG-12 interdit de remettre à zéro. */
function instantane(opts) {
  opts = opts || {};
  return {
    joursPresence:        opts.presence  === undefined ? 20     : opts.presence,
    entretienCentimes:    opts.entretien === undefined ? 10000  : opts.entretien,
    salaireNetCentimes:   opts.net       === undefined ? 107200 : opts.net,
    totalAVerserCentimes: opts.total     === undefined ? 117200 : opts.total,
    minutesSupAcquises:   opts.sup       === undefined ? 600    : opts.sup,
    joursCongesDecomptes: opts.conges    === undefined ? 0      : opts.conges,
    imputation: {
      minutesCpConsommees:  opts.cpMois === undefined ? 0 : opts.cpMois,
      minutesSupConsommees: opts.supMois === undefined ? 0 : opts.supMois
    },
    compteurSortie: {
      minutesCpPris: opts.cpPris     === undefined ? 50   : opts.cpPris,
      minutesSup:     opts.supRestante === undefined ? 600 : opts.supRestante
    }
  };
}

cas.push({
  nom: 'A4 — aucun changement : aucun écart, donc aucun écran intermédiaire',
  fn: function () {
    egal(Chaine.ecartsInstantanes(instantane(), instantane()).length, 0, 'A4.aucun écart');
    /* Deux objets distincts de même contenu ne produisent pas d'écart : on
       compare les valeurs, jamais les références. */
    egal(Chaine.ecartsInstantanes(instantane(), JSON.parse(JSON.stringify(instantane()))).length,
      0, 'A4.copie profonde');
  }
});

cas.push({
  nom: 'P4 — une journée corrigée : écart sur la présence et l’entretien',
  fn: function () {
    var avant = instantane({ presence: 20, entretien: 10000, total: 117200 });
    var apres = instantane({ presence: 19, entretien: 9500, total: 116700 });
    var e = Chaine.ecartsInstantanes(avant, apres);
    egal(e.length, 3, 'P4.trois postes touchés');
    egal(e[0].cle, 'joursPresence', 'P4.ordre du document : la présence d’abord');
    egal(e[0].ancien, 20, 'P4.ancienne présence');
    egal(e[0].nouveau, 19, 'P4.nouvelle présence');
    egal(e[1].cle, 'entretienCentimes', 'P4.puis l’entretien');
    egal(e[1].format, 'euros', 'P4.format de l’entretien');
    egal(e[2].cle, 'totalAVerserCentimes', 'P4.puis le total');
    /* Un poste identique ne figure JAMAIS dans le tableau. */
    egal(e.filter(function (x) { return x.cle === 'salaireNetProrataCentimes'; }).length, 0,
      'P4.le salaire net inchangé est absent');
  }
});

cas.push({
  nom: 'P5 — barème modifié entre-temps : écart sur le salaire et le total',
  fn: function () {
    /* Aucune journée n'a bougé, seule la rémunération a été revalorisée.
       C'est le cas que la comparaison existe pour attraper : sans elle, un
       document déjà transmis à la famille changerait en silence. */
    var e = Chaine.ecartsInstantanes(
      instantane({ net: 107200, total: 117200 }),
      instantane({ net: 110000, total: 120000 })
    );
    egal(e.length, 2, 'P5.deux postes touchés');
    /* CORRECTION B4 DU LOT 17 : le poste comparé est le net RÉELLEMENT DÛ.
       Ces deux instantanés n'ont pas de champ proratisé — ils datent d'avant
       le lot 17 — et le repli sur `salaireNetCentimes` les rend comparables :
       c'est exactement ce que la correction doit garantir. */
    egal(e[0].cle, 'salaireNetProrataCentimes', 'P5.salaire net');
    egal(e[1].cle, 'totalAVerserCentimes', 'P5.total à verser');
    egal(e[0].ancien, 107200, 'P5.ancien net');
    egal(e[0].nouveau, 110000, 'P5.nouveau net');
  }
});

cas.push({
  nom: 'Lot 13 (C2) — les six postes du document PLUS les compteurs, et eux seuls (lot 30 : l’acquisition aussi)',
  fn: function () {
    /* Le §5.4 de la spécification énumérait six postes : ceux qui figurent sur
       le document remis à la famille. La relecture (C2) a montré ce qu'ils
       laissaient passer : une reclôture peut ne changer AUCUN montant et
       déplacer durablement des compteurs — quatre jours pris sur les congés
       payés au lieu de la récupération. Le mois se lit pareil, et deux
       compteurs que RG-12 interdit de remettre à zéro ont changé de poche en
       silence. Ajout délibéré, hors lettre de la spécification. */
    /* LOT 30 (§30.5) — DOUZE POSTES : l'acquisition des congés payés du mois et
       le cumul acquis rejoignent la liste. Le lot 28 rend aux mois leurs 2,5
       jours ; les mois clôturés qui les ont perdus se rattrapent en rouvrant
       puis reclôturant — et cette reclôture-là aurait eu « aucun écart ». */
    egal(Chaine.POSTES_COMPARES.length, 12, 'douze postes');
    egal(Chaine.POSTES_COMPARES.map(function (p) { return p.cle; }).join(','),
      'joursPresence,entretienCentimes,salaireNetProrataCentimes,totalAVerserCentimes,' +
      'minutesSupAcquises,joursCongesDecomptes,' +
      'imputation.minutesCpConsommees,imputation.minutesSupConsommees,' +
      'compteurSortie.minutesCpPris,compteurSortie.minutesSup,' +
      'minutesCpAcquis,compteurSortie.minutesCpAcquis',
      'ordre et contenu des postes');

    /* Les six premiers restent en tête, et dans l'ordre du document : l'écran
       des écarts se lit comme le document lui-même. */
    egal(Chaine.POSTES_COMPARES.slice(0, 6).map(function (p) { return p.cle; }).join(','),
      'joursPresence,entretienCentimes,salaireNetProrataCentimes,totalAVerserCentimes,' +
      'minutesSupAcquises,joursCongesDecomptes',
      'les six postes du document restent en tête, dans l’ordre');

    /* CORRECTION B4 — le poste du salaire porte son repli. Sans lui, la
       première comparaison d'un mois clôturé avant le lot 17 annoncerait
       « 0 € → 1 072 € » et ferait croire à une correction qui n'a pas eu
       lieu. */
    var posteNet = Chaine.POSTES_COMPARES.filter(function (p) {
      return p.cle === 'salaireNetProrataCentimes';
    })[0];
    egal(posteNet.repli, 'salaireNetCentimes',
      'le salaire net comparé se replie sur le net contractuel des vieux instantanés');

    /* Chaque poste sait comment il se présente : l'écran met en forme, il ne
       décide pas de ce qui est comparé. `cp` = dixièmes de jour. */
    Chaine.POSTES_COMPARES.forEach(function (p) {
      egal(['jours', 'euros', 'minutes', 'cp'].indexOf(p.format) !== -1, true,
        'format connu : ' + p.cle);
      egal(typeof p.libelle === 'string' && p.libelle.length > 0, true, 'libellé : ' + p.cle);
    });

    /* Un poste hors liste n'est pas comparé, même s'il diffère.
       LOT 30 — `minutesCpAcquis` est ENTRÉ dans la liste : l'exemple change
       de poste (le brut contractuel n'y est pas, et n'a pas à y être : c'est
       le net dû qui est comparé), et l'ancien exemple devient un écart VU. */
    var a = instantane(); a.salaireBrutCentimes = 137289;
    var b = instantane(); b.salaireBrutCentimes = 140000;
    egal(Chaine.ecartsInstantanes(a, b).length, 0, 'un poste hors liste est ignoré');
    var a2 = instantane(); a2.minutesCpAcquis = 0;
    var b2 = instantane(); b2.minutesCpAcquis = 1350;
    egal(Chaine.ecartsInstantanes(a2, b2).length, 1,
      'lot 30 : les congés payés récupérés par une reclôture sont un écart vu');
  }
});

cas.push({
  nom: 'Lot 13 (C2) — reclôture à montants identiques : le déplacement de compteurs est vu',
  fn: function () {
    /* LE cas que la correction C2 existe pour attraper. Maria rouvre un mois
       et remplace une imputation « 4 jours sur la récupération » par « 4 jours
       sur les congés payés ». Le salaire, l'entretien, le total, la présence :
       rien ne bouge. Avant C2, l'écran annonçait « rien ne change » et la
       reclôture se faisait sans écran intermédiaire. Quatre jours de congés
       payés partaient définitivement, sur un compteur qui ne se remet jamais à
       zéro (RG-12), et c'est exactement la matière du litige avec les
       familles. */
    var avant = instantane({ cpMois: 0,  supMois: 1680, cpPris: 50, supRestante: 600 });
    var apres = instantane({ cpMois: 40, supMois: 0,    cpPris: 90, supRestante: 2280 });

    var e = Chaine.ecartsInstantanes(avant, apres);
    egal(e.length, 4, 'quatre compteurs touchés, aucun montant');

    egal(e[0].cle, 'imputation.minutesCpConsommees', 'CP décomptés ce mois');
    egal(e[0].ancien, 0, 'ancien : rien sur les CP');
    egal(e[0].nouveau, 40, 'nouveau : 4 jours sur les CP');
    egal(e[0].format, 'cp', 'format en dixièmes de jour');

    egal(e[1].cle, 'imputation.minutesSupConsommees', 'récupération utilisée ce mois');
    egal(e[1].ancien, 1680, 'ancien : 28 h de récupération');
    egal(e[1].nouveau, 0, 'nouveau : plus rien');

    egal(e[2].cle, 'compteurSortie.minutesCpPris', 'CP pris en tout');
    egal(e[2].ancien, 50, 'ancien cumul');
    egal(e[2].nouveau, 90, 'nouveau cumul');

    egal(e[3].cle, 'compteurSortie.minutesSup', 'récupération restante');
    egal(e[3].nouveau, 2280, 'la récupération revient au compteur');

    /* Et aucun poste de montant n'est signalé à tort. */
    egal(e.filter(function (x) { return x.cle.indexOf('.') === -1; }).length, 0,
      'aucun poste du document ne figure dans ce tableau');
  }
});

cas.push({
  nom: 'Lot 13 (C2) — lecture imbriquée : jamais d’exception, jamais de faux écart',
  fn: function () {
    /* Un instantané écrit par une version antérieure de l'application n'a ni
       `imputation` ni `compteurSortie`. La lecture d'un chemin pointé doit
       alors rendre 0 — pas lever, pas inventer un écart. C'est le cas réel :
       tous les mois déjà clôturés en production sont dans cet état. */
    var ancien = {
      joursPresence: 20, entretienCentimes: 10000, salaireNetCentimes: 107200,
      totalAVerserCentimes: 117200, minutesSupAcquises: 600, joursCongesDecomptes: 0
    };
    var nouveau = JSON.parse(JSON.stringify(ancien));
    nouveau.imputation = { minutesCpConsommees: 0, minutesSupConsommees: 0 };
    nouveau.compteurSortie = { minutesCpPris: 0, minutesSup: 0 };

    egal(Chaine.ecartsInstantanes(ancien, nouveau).length, 0,
      'bloc absent d’un côté, valeurs nulles de l’autre : aucun écart');

    /* Bloc présent mais vide, valeur non nulle en face : l'écart est réel et
       doit être dit. */
    var avecValeur = JSON.parse(JSON.stringify(nouveau));
    avecValeur.compteurSortie.minutesCpPris = 30;
    var e = Chaine.ecartsInstantanes(ancien, avecValeur);
    egal(e.length, 1, 'un seul écart');
    egal(e[0].cle, 'compteurSortie.minutesCpPris', 'le bon poste');
    egal(e[0].ancien, 0, 'bloc absent lu comme 0');

    /* Le bloc intermédiaire vaut explicitement null : ce cas existe, un
       instantané sérialisé peut le porter. */
    var avecNull = JSON.parse(JSON.stringify(nouveau));
    avecNull.compteurSortie = null;
    egal(Chaine.ecartsInstantanes(avecNull, nouveau).length, 0,
      'bloc null : lu comme 0, pas d’exception');
  }
});

cas.push({
  nom: 'Lot 13 — instantané absent ou incomplet : jamais de faux écart',
  fn: function () {
    /* Mois jamais clôturé : il n'y a pas de document antérieur. */
    egal(Chaine.ecartsInstantanes(null, instantane()).length, 0, 'ancien absent');
    egal(Chaine.ecartsInstantanes(instantane(), null).length, 0, 'nouveau absent');

    /* Instantané produit par une version antérieure de l'application : le
       poste manquant vaut 0 et n'invente pas un écart. */
    var ancienPartiel = { joursPresence: 20, entretienCentimes: 10000 };
    var nouveauPartiel = { joursPresence: 20, entretienCentimes: 10000 };
    egal(Chaine.ecartsInstantanes(ancienPartiel, nouveauPartiel).length, 0,
      'postes manquants des deux côtés');

    /* En revanche, un poste manquant d'un côté et non nul de l'autre EST un
       écart : on ne masque pas une différence réelle. */
    var e = Chaine.ecartsInstantanes(ancienPartiel, instantane());
    egal(e.length > 0, true, 'écart réel signalé malgré le poste manquant');
    egal(e[0].ancien, 0, 'poste manquant lu comme 0');
  }
});

/* ------------------------------------------------------------------ */
/* CORRECTIONS DE LA RELECTURE DU LOT 17                                */
/* ------------------------------------------------------------------ */

cas.push({
  nom: 'C6 — le compteur d’entrée d’un mois figé retranche les congés à l’heure',
  fn: function () {
    /* Depuis le §17.6, la sortie vaut `entrée + minutesCpConsommees +
       minutesEcartSurCp`. Le dernier terme n'était jamais défait : un mois
       clôturé portant une libération d'1h30 imputée sur les congés payés
       affichait « 9 j 5h30 » au 1er du mois au lieu de « 10 j ». */
    var mpjc = 540;
    var entree = Chaine.compteurEntreeDe({
      minutesSupAcquises: 0,
      minutesCpAcquis: 0,
      minutesEcartSurCp: 90,                       // 1h30 de congé à l'heure
      imputation: { minutesSupConsommees: 0, minutesCpConsommees: 0 },
      compteurSortie: { minutesSup: 0, minutesCpAcquis: 10 * mpjc, minutesCpPris: 90 }
    }, null);
    egal(entree.minutesCpPris, 0, 'aucun congé payé pris à l’entrée du mois');
    egal(entree.minutesCpAcquis - entree.minutesCpPris, 10 * mpjc,
      'le disponible d’entrée vaut bien 10 jours pleins');
  }
});

cas.push({
  nom: 'C6 — un instantané d’avant le lot 17 n’est pas modifié par la correction',
  fn: function () {
    /* Ces instantanés ne portent pas `minutesEcartSurCp` : le terme vaut zéro
       et le calcul est exactement celui d'avant. */
    var entree = Chaine.compteurEntreeDe({
      minutesSupAcquises: 600,
      minutesCpAcquis: 1350,
      imputation: { minutesSupConsommees: 0, minutesCpConsommees: 540 },
      compteurSortie: { minutesSup: 600, minutesCpAcquis: 1350, minutesCpPris: 540 }
    }, null);
    egal(entree.minutesSup, 0, 'récupération d’entrée');
    egal(entree.minutesCpAcquis, 0, 'congés acquis d’entrée');
    egal(entree.minutesCpPris, 0, 'congés pris d’entrée');
  }
});

cas.push({
  nom: 'B4 — le net et le brut du mois sont ceux qui sont DUS',
  fn: function () {
    egal(Chaine.netDuMois({ salaireNetCentimes: 78000, salaireNetProrataCentimes: 42545 }),
      42545, 'un mois partiel rend le net proratisé');
    egal(Chaine.netDuMois({ salaireNetCentimes: 78000 }), 78000,
      'un instantané d’avant le lot 17 rend son net contractuel');
    egal(Chaine.brutDuMois({ salaireBrutCentimes: 100000, salaireBrutProrataCentimes: 54545 }),
      54545, 'même règle pour le brut');
    egal(Chaine.proratOuNull({ prorata: { applique: false } }), null,
      'un mois entier n’a rien à dire');
    egal(Chaine.proratOuNull({ prorata: { applique: true, joursCouverts: 12, joursDuMois: 22 } })
      .joursCouverts, 12, 'un mois partiel porte son quotient');
  }
});

cas.push({
  nom: 'C1 — le brut réellement dû se lit à un seul endroit',
  fn: function () {
    egal(Chaine.brutDuCentimes({ brutDuCentimes: 4242 }), 4242, 'valeur portée telle quelle');
    egal(Chaine.brutDuCentimes({ salaireBrutCentimes: 100000, retenueSansSoldeCentimes: 6336 }),
      93664, 'instantané d’avant le lot 17 : le repli reconstitue exactement');
    egal(Chaine.brutDuCentimes({ salaireBrutCentimes: 1000, retenueSansSoldeCentimes: 9000 }),
      0, 'jamais négatif');
  }
});

module.exports = { cas: cas };
