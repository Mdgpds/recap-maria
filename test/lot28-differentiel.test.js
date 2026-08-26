/* ============================================================================
   lot28-differentiel.test.js — LE DIFFÉRENTIEL DU LOT 28, POSTE À POSTE.

   Le lot 28 CHANGE des chiffres. La preuve n'est donc pas « rien ne bouge » :
   c'est « rien ne bouge EN DEHORS de ce que les specs demandent » (§B.1).

   Ce fichier confronte le moteur figé d'avant le lot
   (`test/fixtures/engine-avant-lot28.js`, copie exacte de `js/engine.js` au
   commit `f2f9ac7`) au moteur courant, sur un produit croisé de scénarios.
   Pour chaque scénario, le résultat d'AVANT est RECONSTRUIT par les quatre
   règles nouvelles — écrites ici une seconde fois, indépendamment du moteur —
   et le résultat d'APRÈS doit lui être identique, champ par champ :

     R1  §28.2  une absence de l'enfant ne porte plus aucune minute ;
     R2  §28.6  le renoncement est borné à ce qui reste dû après l'écart ;
     R3  §28.3  les congés payés consommés par les écarts sont bornés au
                disponible, le surplus va à la récupération ;
     R4  §28.1  l'acquisition : 2,5 jours par mois travaillé, prorata du
                premier et du dernier mois, rien si tout le mois est sans
                solde.

   Et le lot compte ce qui bouge : chaque règle doit avoir mordu sur un nombre
   significatif de scénarios, sinon la matrice ne prouverait rien.

   Valeurs FICTIVES (dépôt public).
   ========================================================================= */
'use strict';

var Avant = require('./fixtures/engine-avant-lot28.js');
var Apres = require('../js/engine.js');
var Feries = require('../js/feries.js');

var cas = [];
function test(nom, fn) { cas.push({ nom: nom, fn: fn }); }
function assert(cond, message) { if (!cond) throw new Error(message); }

function deux(n) { return String(n).padStart(2, '0'); }
function cle(a, m) { return a + '-' + deux(m); }

/* ------------------------------------------------------------------ */
/* Le décor                                                            */
/* ------------------------------------------------------------------ */

function conditions(v) {
  return {
    date_effet: '2020-01-01', numero: 1,
    jours_planning: v.planning,
    heure_arrivee: '08:30', heure_depart: '17:30',
    minutes_contractuelles: 540,
    minutes_sup_jour: v.minutesSupJour,
    minutes_par_jour_conge: v.mpjc,
    entretien_centimes_jour: v.entretien,
    sup_dues_si_enfant_absent: v.supDuesSiAbsent,
    ordre_imputation: v.ordre,
    brut_mensuel_centimes: v.brut,
    net_mensuel_centimes: v.net
  };
}

function contrat(v) {
  return { id: 'c1', date_debut: v.dateDebut || null, date_fin: v.dateFin || null };
}

/* ------------------------------------------------------------------ */
/* La matrice                                                          */
/* ------------------------------------------------------------------ */

var PLANNINGS = [[1, 2, 3, 4, 5], [1, 2, 3, 4], [1, 2, 3, 4, 5, 6], [2, 4]];

var MOIS = [
  [2026, 1], [2026, 2], [2026, 4], [2026, 5], [2026, 6],
  [2026, 7], [2026, 8], [2026, 9], [2026, 11], [2026, 12],
  [2025, 3], [2025, 4], [2025, 5], [2025, 8], [2024, 2]
];

var MPJC = [540, 480, 600];
var MINUTES_SUP_JOUR = [30, 0, 45];
var ORDRES = ['cp_puis_sup', 'sup_puis_cp'];
var ENTRETIENS = [550, 500, 0];
var SUP_DUES = [true, false];

var COMPTEURS = [
  { minutesSup: 0, minutesCpAcquis: 0, minutesCpPris: 0 },
  { minutesSup: 540, minutesCpAcquis: 5400, minutesCpPris: 0 },
  { minutesSup: 2700, minutesCpAcquis: 29700, minutesCpPris: 6480 },
  { minutesSup: -100, minutesCpAcquis: 10800, minutesCpPris: 48600 },
  { minutesSup: 100000, minutesCpAcquis: 540000, minutesCpPris: 540 },
  /* §28.3 — un compteur presque vide, pour que les écarts sur les congés
     payés dépassent le disponible et que la règle R3 morde. */
  { minutesSup: 0, minutesCpAcquis: 100, minutesCpPris: 0 }
];

var BORNES = [
  function () { return { dateDebut: '2000-01-01', dateFin: null }; },
  function (a, m) { return { dateDebut: cle(a, m) + '-16', dateFin: null }; },
  function (a, m) { return { dateDebut: '2000-01-01', dateFin: cle(a, m) + '-12' }; },
  function (a, m) { return { dateDebut: cle(a, m) + '-05', dateFin: cle(a, m) + '-22' }; },
  function (a, m) { return { dateDebut: cle(a, m) + '-01', dateFin: null }; }
];

var MOTIFS = [
  function () { return []; },
  function (j) { return [{ jour: j(3), type: 'absence_enfant' }]; },
  function (j) {
    return [{ jour: j(6), type: 'conge_maria' }, { jour: j(7), type: 'conge_maria' },
            { jour: j(8), type: 'conge_maria' }, { jour: j(9), type: 'conge_maria' },
            { jour: j(10), type: 'conge_maria' }];
  },
  function (j) {
    var out = [];
    for (var k = 3; k <= 21; k++) out.push({ jour: j(k), type: 'conge_maria' });
    return out;
  },
  function (j) { return [{ jour: j(4), type: 'sans_solde' }, { jour: j(5), type: 'sans_solde' }]; },
  function (j) { return [{ jour: j(2), type: 'familiarisation', entretien_centimes: 300 }]; },
  function (j) { return [{ jour: j(12), type: 'hors_planning' }, { jour: j(13), type: 'ferie' }]; },
  function (j) {
    return [{ jour: j(15), type: 'presence', minutes_sup_exceptionnelles: 45 },
            { jour: j(16), type: 'presence', minutes_sup_renoncees: 20 },
            { jour: j(17), type: 'presence', minutes_sup_renoncees: 500 },
            { jour: j(18), type: 'presence', entretien_centimes: 999 }];
  },
  function (j) {
    return [{ jour: j(9), type: 'absence_enfant', sup_dues_override: false },
            { jour: j(10), type: 'absence_enfant', sup_dues_override: true },
            { jour: j(11), type: 'absence_enfant' }];
  },
  function (j) {
    return [{ jour: j(6), type: 'conge_maria' }, { jour: j(7), type: 'conge_maria' },
            { jour: j(8), type: 'conge_maria' },
            { jour: j(14), type: 'absence_enfant' },
            { jour: j(20), type: 'presence', minutes_sup_exceptionnelles: 15 }];
  },
  function (j) {
    return [{ jour: j(17), type: 'presence', ecart_minutes: -90,
              ecart_evenement: 'liberation_anticipee', ecart_impute_sur: 'recuperation' },
            { jour: j(18), type: 'presence', ecart_minutes: 12,
              ecart_evenement: 'retard_parent' },
            { jour: j(19), type: 'presence', ecart_minutes: -45,
              ecart_evenement: 'arrivee_decalee', ecart_impute_sur: 'conges_payes' }];
  },
  /* §28.6 — un écart ET un renoncement sur la même journée, dans les deux
     sens ; §28.3 — deux écarts sur les congés payés dans le mois ; §28.2 —
     une absence portant un écart (ligne ancienne). */
  function (j) {
    return [{ jour: j(3), type: 'presence', ecart_minutes: -60,
              ecart_evenement: 'liberation_anticipee', minutes_sup_renoncees: 30 },
            { jour: j(4), type: 'presence', ecart_minutes: 20,
              ecart_evenement: 'retard_parent', minutes_sup_renoncees: 50 },
            { jour: j(10), type: 'presence', ecart_minutes: -300,
              ecart_evenement: 'liberation_anticipee', ecart_impute_sur: 'conges_payes' },
            { jour: j(11), type: 'presence', ecart_minutes: -300,
              ecart_evenement: 'liberation_anticipee', ecart_impute_sur: 'conges_payes' },
            { jour: j(16), type: 'absence_enfant', ecart_minutes: -60,
              ecart_evenement: 'liberation_anticipee', minutes_sup_exceptionnelles: 15 },
            { jour: j(17), type: 'presence', ecart_minutes: -120,
              ecart_evenement: 'liberation_anticipee', ecart_impute_sur: 'sans_solde',
              minutes_sup_renoncees: 30 }];
  }
];

var IMPUTATIONS = [
  function () { return []; },
  function (joursConge, planning, mpjc, samedis) {
    if (!joursConge.length) return [];
    var n = Apres.decompterJoursOuvrables(joursConge[0], joursConge[joursConge.length - 1],
      planning, samedis);
    return [{ date_debut: joursConge[0], date_fin: joursConge[joursConge.length - 1],
              jours_ouvrables: n, jours_sur_cp: 0, jours_sur_sup: 0, jours_sans_solde: n }];
  },
  function (joursConge, planning, mpjc, samedis) {
    if (!joursConge.length) return [];
    var n = Apres.decompterJoursOuvrables(joursConge[0], joursConge[joursConge.length - 1],
      planning, samedis);
    return [{ date_debut: joursConge[0], date_fin: joursConge[joursConge.length - 1],
              jours_ouvrables: n, jours_sur_cp: n, jours_sur_sup: 0, jours_sans_solde: 0 }];
  },
  function (joursConge) {
    if (!joursConge.length) return [];
    return [{ date_debut: joursConge[0], date_fin: joursConge[0],
              jours_ouvrables: 1, jours_sur_cp: 1, jours_sur_sup: 0, jours_sans_solde: 0 }];
  }
];

function scenarios() {
  var out = [];
  var n = 0;
  for (var im = 0; im < MOIS.length; im++) {
    for (var ip = 0; ip < PLANNINGS.length; ip++) {
      for (var imo = 0; imo < MOTIFS.length; imo++) {
        for (var iimp = 0; iimp < IMPUTATIONS.length; iimp++) {
          for (var ib = 0; ib < BORNES.length; ib++) {
            var annee = MOIS[im][0], mois = MOIS[im][1];
            var b = BORNES[ib](annee, mois);
            out.push({
              annee: annee, mois: mois,
              planning: PLANNINGS[ip],
              motif: imo, imputation: iimp,
              mpjc: MPJC[n % MPJC.length],
              minutesSupJour: MINUTES_SUP_JOUR[(n + 1) % MINUTES_SUP_JOUR.length],
              ordre: ORDRES[(n + 2) % ORDRES.length],
              entretien: ENTRETIENS[(n + 1) % ENTRETIENS.length],
              supDuesSiAbsent: SUP_DUES[n % SUP_DUES.length],
              compteur: COMPTEURS[(n + 3) % COMPTEURS.length],
              brut: [137289, 132745, 140000, 0][n % 4],
              net: [105000, 107100, 0, 98765][(n + 1) % 4],
              dateDebut: b.dateDebut, dateFin: b.dateFin
            });
            n++;
          }
        }
      }
    }
  }
  return out;
}

function tousLesSamedis(annee, mois) {
  var out = [];
  var d = Feries.ajouterJours(cle(annee, mois) + '-01', -20);
  var fin = Feries.ajouterJours(cle(annee, mois) + '-01', 62);
  for (; d <= fin; d = Feries.ajouterJours(d, 1)) {
    if (Apres.jourSemaine(d) === 6) out.push(d);
  }
  return out;
}

function journeesDe(v) {
  var prefixe = cle(v.annee, v.mois) + '-';
  var derniers = Apres.joursDuMois(v.annee, v.mois).length;
  function j(k) { return prefixe + deux(Math.min(k, derniers)); }
  return MOTIFS[v.motif](j);
}

function copie(o) { return JSON.parse(JSON.stringify(o)); }

/* ------------------------------------------------------------------ */
/* LES QUATRE RÈGLES, RÉÉCRITES ICI INDÉPENDAMMENT DU MOTEUR           */
/* ------------------------------------------------------------------ */

/* Les journées que le moteur a réellement traitées : jour du planning, dans
   les bornes du contrat. C'est la même règle de bornes que la sienne — elle
   n'a pas changé — et elle est redite ici pour ne pas la lui demander. */
function joursTraites(v) {
  return Apres.joursDuMois(v.annee, v.mois).filter(function (d) {
    if (v.planning.indexOf(Apres.jourSemaine(d)) === -1) return false;
    if (v.dateDebut && d < v.dateDebut) return false;
    if (v.dateFin && d > v.dateFin) return false;
    return true;
  });
}

/* R1 + R2 + R3 : reconstruit les minutes du mois à partir du résultat
   d'avant, journée par journée, et rend aussi les compteurs de suivi. */
function appliquerReglesMinutes(av, v, journees, compteur, cpDejaPrisParConges) {
  var attendu = copie(av);
  var parJour = {};
  journees.forEach(function (l) { parJour[l.jour] = l; });
  var jours = joursTraites(v);
  var cd = conditions(v);
  var mord = { R1: false, R2: false, R3: false };

  /* R1 — l'absence de l'enfant : on retire ce que l'ancien moteur comptait
     pour elle (base selon RG-09, ajoutées, renoncées, écart). */
  jours.forEach(function (d) {
    var l = parJour[d];
    if (!l || l.type !== 'absence_enfant') return;
    var det = Avant.detailSupDuJour(l, cd);
    if (det.base || det.ajoutees || det.renoncees || det.ecart) mord.R1 = true;
    attendu.minutesSupBase -= det.base;
    attendu.minutesSupAjoutees -= det.ajoutees;
    attendu.minutesSupRenoncees -= det.renoncees;
    attendu.minutesEcartRecuperation -= det.ecartSurRecuperation;
    attendu.minutesEcartSurCp -= det.minutesSurCp;
    attendu.minutesEcartSansSolde -= det.minutesSansSolde;
    attendu.ecartsDeclares = attendu.ecartsDeclares.filter(function (e) { return e.jour !== d; });
  });

  /* R2 — le renoncement, borné à max(0, base + ajoutées + écart sur la
     récupération) au lieu de base + ajoutées. */
  jours.forEach(function (d) {
    var l = parJour[d];
    if (!l || l.type !== 'presence' || !(l.minutes_sup_renoncees > 0)) return;
    var det = Avant.detailSupDuJour(l, cd);
    var plancher = Math.max(0, det.base + det.ajoutees + det.ecartSurRecuperation);
    var neuf = Math.min(l.minutes_sup_renoncees, plancher);
    if (neuf !== det.renoncees) {
      mord.R2 = true;
      attendu.minutesSupRenoncees += neuf - det.renoncees;
    }
  });

  /* R3 — les écarts sur les congés payés, servis dans l'ordre des jours
     après les périodes, bornés au disponible. */
  var dispo = Math.max(0, compteur.minutesCpAcquis - compteur.minutesCpPris - cpDejaPrisParConges);
  var surCpTotal = 0;
  var surplusTotal = 0;
  attendu.ecartsDeclares.forEach(function (e) {
    var l = parJour[e.jour];
    var det = Avant.detailSupDuJour(l, cd);
    e.minutesSurCp = 0;
    e.minutesSurRecuperation = det.ecartSurRecuperation < 0 ? -det.ecartSurRecuperation : 0;
    e.minutesSansSolde = det.minutesSansSolde;
    if (det.minutesSurCp > 0) {
      var pris = Math.min(det.minutesSurCp, dispo);
      dispo -= pris;
      surCpTotal += pris;
      surplusTotal += det.minutesSurCp - pris;
      e.minutesSurCp = pris;
      e.minutesSurRecuperation += det.minutesSurCp - pris;
      if (pris === 0) e.imputeSur = 'recuperation';
      if (pris !== det.minutesSurCp) mord.R3 = true;
    }
  });
  attendu.minutesEcartSurCp = surCpTotal;
  attendu.minutesEcartRecuperation -= surplusTotal;
  attendu.minutesCpRestantesApresConsommation = dispo;

  attendu.minutesSupAcquises = attendu.minutesSupBase + attendu.minutesSupAjoutees
    - attendu.minutesSupRenoncees + attendu.minutesEcartRecuperation;
  attendu.compteurSortie.minutesSup = compteur.minutesSup + attendu.minutesSupAcquises
    - av.imputation.minutesSupConsommees;
  attendu.compteurSortie.minutesCpPris = compteur.minutesCpPris
    + av.imputation.minutesCpConsommees + attendu.minutesEcartSurCp;
  /* Le sans solde d'un écart sur une absence n'existe plus : la retenue le suit. */
  var minutesSansSoldeTotal = (av.imputation.joursSansSolde +
    journees.filter(function (l) { return l.type === 'sans_solde' && jours.indexOf(l.jour) !== -1; }).length)
    * v.mpjc + attendu.minutesEcartSansSolde;
  attendu.retenueSansSoldeCentimes = minutesSansSoldeTotal === 0 ? 0
    : Apres.montantCentimes(v.brut, minutesSansSoldeTotal);
  attendu.brutDuCentimes = Math.max(0, av.salaireBrutProrataCentimes + av.familiarisation.brutCentimes
    - attendu.retenueSansSoldeCentimes);
  attendu.totalAVerserCentimes = av.totalAVerserCentimes + av.retenueSansSoldeCentimes
    - attendu.retenueSansSoldeCentimes;
  return { attendu: attendu, mord: mord };
}

/* R4 — l'acquisition. */
function appliquerRegleAcquisition(attendu, av, v, journees, compteur) {
  var jours = joursTraites(v);
  var parJour = {};
  journees.forEach(function (l) { parJour[l.jour] = l; });
  var nbSansSolde = jours.filter(function (d) { return parJour[d] && parJour[d].type === 'sans_solde'; }).length;
  var nbConge = jours.filter(function (d) { return parJour[d] && parJour[d].type === 'conge_maria'; }).length;
  var congeToutSansSolde = nbConge > 0 && av.imputation.joursSurCp + av.imputation.joursSurSup === 0;
  var assimiles = jours.length - nbSansSolde - (congeToutSansSolde ? nbConge : 0);
  var toutSansSolde = jours.length > 0 && assimiles <= 0;

  var joursDuMois = Apres.joursDuMois(v.annee, v.mois).filter(function (d) {
    return v.planning.indexOf(Apres.jourSemaine(d)) !== -1;
  }).length;
  var couverts = jours.length;   // sans période de familiarisation, couverts = traités
  var parMois = Math.round(25 * v.mpjc / 10);
  var acquis = 0;
  if (jours.length > 0 && !toutSansSolde) {
    acquis = couverts < joursDuMois ? Math.round(parMois * couverts / joursDuMois) : parMois;
  }
  attendu.minutesCpAcquis = acquis;
  attendu.acquisitionCp = {
    joursCouverts: couverts, joursDuMois: joursDuMois,
    prorata: joursDuMois > 0 && couverts < joursDuMois,
    toutLeMoisSansSolde: toutSansSolde, plafonne: false
  };
  attendu.compteurSortie.minutesCpAcquis = compteur.minutesCpAcquis + acquis;
  return acquis !== av.minutesCpAcquis;
}

/* Remet les clés de `attendu` dans l'ordre de celles d'`apres`, pour que la
   comparaison en JSON ne dépende pas de l'ordre d'insertion. */
function memeOrdre(attendu, modele) {
  if (Array.isArray(modele)) {
    return modele.map(function (x, i) { return memeOrdre(attendu[i], x); });
  }
  if (modele && typeof modele === 'object') {
    var out = {};
    Object.keys(modele).forEach(function (k) { out[k] = memeOrdre(attendu[k], modele[k]); });
    return out;
  }
  return attendu;
}

/* ------------------------------------------------------------------ */

test('différentiel exhaustif — chaque écart est reconstruit par une règle nommée', function () {
  var liste = scenarios();
  assert(liste.length > 4000, 'le différentiel doit être exhaustif : ' + liste.length + ' scénarios');

  var compares = 0;
  var refusIdentiques = 0;
  var mordu = { R1: 0, R2: 0, R3: 0, R4: 0 };
  var identiques = 0;

  for (var i = 0; i < liste.length; i++) {
    var v = liste[i];
    var journees = journeesDe(v);
    var joursConge = journees.filter(function (x) { return x.type === 'conge_maria'; })
                             .map(function (x) { return x.jour; }).sort();
    var samedis = tousLesSamedis(v.annee, v.mois);
    var imputations = IMPUTATIONS[v.imputation](joursConge, v.planning, v.mpjc, samedis);

    var etiquette = 'scénario #' + i + ' [' + cle(v.annee, v.mois) +
      ' planning=' + v.planning.join('') + ' motif=' + v.motif +
      ' imputation=' + v.imputation + ' mpjc=' + v.mpjc +
      ' compteur=' + JSON.stringify(v.compteur) +
      ' bornes=' + v.dateDebut + '→' + (v.dateFin || '∞') + ']';

    var entrees = {
      contrat: contrat(v), conditions: conditions(v), journees: journees,
      compteurEntree: {
        minutesSup: v.compteur.minutesSup,
        minutesCpAcquis: v.compteur.minutesCpAcquis,
        minutesCpPris: v.compteur.minutesCpPris
      },
      annee: v.annee, mois: v.mois, imputations: imputations, samedisComptes: samedis
    };

    var av = null, ap = null, eAv = null, eAp = null;
    try { av = Avant.calculerMois(entrees); } catch (e) { eAv = e; }
    try { ap = Apres.calculerMois(entrees); } catch (e) { eAp = e; }

    if (eAv || eAp) {
      assert(eAv && eAp, etiquette + ' — un seul des deux moteurs refuse : avant=' +
        (eAv ? eAv.code || eAv.message : 'ok') + ' après=' +
        (eAp ? eAp.code || eAp.message : 'ok'));
      assert(eAv.code === eAp.code,
        etiquette + ' — codes d’erreur différents : ' + eAv.code + ' / ' + eAp.code);
      refusIdentiques++;
      continue;
    }

    var rec = appliquerReglesMinutes(av, v, journees, entrees.compteurEntree,
      av.imputation.minutesCpConsommees);
    var attendu = rec.attendu;
    var r4 = appliquerRegleAcquisition(attendu, av, v, journees, entrees.compteurEntree);

    var jsonAttendu = JSON.stringify(memeOrdre(attendu, ap));
    var jsonApres = JSON.stringify(ap);
    assert(jsonAttendu === jsonApres,
      etiquette + ' — le moteur d’après ne se déduit pas de celui d’avant par les règles du lot :' +
      '\n  attendu ' + jsonAttendu + '\n  obtenu  ' + jsonApres);

    if (rec.mord.R1) mordu.R1++;
    if (rec.mord.R2) mordu.R2++;
    if (rec.mord.R3) mordu.R3++;
    if (r4) mordu.R4++;
    if (JSON.stringify(av) === JSON.stringify(ap)) identiques++;
    compares++;
  }

  assert(compares > 3000, 'trop peu de mois calculés : ' + compares);
  assert(refusIdentiques > 20, 'trop peu de refus rencontrés (' + refusIdentiques + ')');
  /* Chaque règle doit avoir mordu : un différentiel vert où une règle ne
     change rien prouverait qu'elle n'est pas testée. */
  assert(mordu.R1 > 300, 'R1 (§28.2) a mordu sur trop peu de scénarios : ' + mordu.R1);
  assert(mordu.R2 > 100, 'R2 (§28.6) a mordu sur trop peu de scénarios : ' + mordu.R2);
  assert(mordu.R3 > 100, 'R3 (§28.3) a mordu sur trop peu de scénarios : ' + mordu.R3);
  assert(mordu.R4 > 500, 'R4 (§28.1) a mordu sur trop peu de scénarios : ' + mordu.R4);
  /* Et sur les mois que rien ne concerne, RIEN ne bouge — hormis les deux
     champs que le lot ajoute, absents de l'ancien objet (cas suivant). */
  assert(identiques === 0,
    'l’ancien objet ne porte pas `acquisitionCp` : aucune égalité stricte n’est possible');
});

test('sur un mois que le lot ne concerne pas, seuls les deux champs ajoutés diffèrent', function () {
  var v = {
    annee: 2026, mois: 3, planning: [1, 2, 3, 4, 5], mpjc: 540, minutesSupJour: 30,
    ordre: 'cp_puis_sup', entretien: 550, supDuesSiAbsent: true,
    brut: 137289, net: 105000, dateDebut: '2000-01-01', dateFin: null
  };
  var entrees = {
    contrat: contrat(v), conditions: conditions(v),
    journees: [{ jour: '2026-03-10', type: 'presence', minutes_sup_exceptionnelles: 15 }],
    compteurEntree: { minutesSup: 600, minutesCpAcquis: 5400, minutesCpPris: 540 },
    annee: 2026, mois: 3, imputations: [], samedisComptes: []
  };
  var av = Avant.calculerMois(entrees);
  var ap = Apres.calculerMois(entrees);
  var sansAjout = copie(ap);
  delete sansAjout.acquisitionCp;
  delete sansAjout.minutesCpRestantesApresConsommation;
  assert(JSON.stringify(sansAjout) === JSON.stringify(av),
    'un mois ordinaire est identique au champ ajouté près :\n  avant ' +
    JSON.stringify(av) + '\n  après ' + JSON.stringify(sansAjout));
});

module.exports = { cas: cas };
