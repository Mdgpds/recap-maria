/* ============================================================================
   recuperation-differentiel.test.js — LE DIFFÉRENTIEL, POSTE À POSTE.

   Brief du 28 août 2026 :
     §4.1 « Le compteur de sortie du mois ne change pas d'un centime : ce sont
            les mêmes minutes, acquises et consommées dans le même total.
            Seul l'ordre d'évaluation change. »
     §5   « Les totaux du mois : salaire, entretien, retenues, compteur de
            sortie. Le différentiel poste à poste est obligatoire. »
     §6.5 « Sur au moins trois mois réels de forme différente (un sans congé,
            un avec récupération en début de mois, un avec récupération en fin
            de mois), montre poste à poste que rien ne change hors ce que ce
            brief demande. »

   Deux preuves, et il faut les deux :

   A. SANS `aujourdhui` — égalité EXACTE, champ par champ, avec le moteur figé
      d'avant le lot (`test/fixtures/engine-avant-recuperation.js`, copie
      exacte de `js/engine.js` au commit `155d00a`), les deux relevés ajoutés
      mis à part. C'est la promesse « absente, le moteur se comporte comme
      aujourd'hui » (§4.1).

   B. AVEC `aujourdhui` — sur tout mois que le moteur d'avant SAVAIT calculer,
      égalité poste à poste des onze postes nommés au §5. Un mois qu'il
      REFUSAIT peut désormais être accepté : c'est tout l'objet du lot, et
      c'est le seul écart autorisé.

   Valeurs FICTIVES (dépôt public).
   ========================================================================= */
'use strict';

var Avant = require('./fixtures/engine-avant-recuperation.js');
var Apres = require('../js/engine.js');

var cas = [];
function test(nom, fn) { cas.push({ nom: nom, fn: fn }); }
function assert(cond, message) { if (!cond) throw new Error(message); }
function copie(o) { return JSON.parse(JSON.stringify(o)); }

/* Les deux relevés que ce lot AJOUTE au résultat. Ils ne portent aucun
   montant : ils détaillent ce que le moteur crédite déjà, jour par jour. */
function sansLesRelevesAjoutes(r) {
  var c = copie(r);
  delete c.minutesSupParJour;
  delete c.recuperationConsommeeParPeriode;
  return c;
}

/* LES POSTES DU §5, NOMMÉS UN PAR UN. Une liste écrite en dur, pas déduite :
   une liste déduite du résultat ne contrôlerait rien — elle suivrait
   docilement le champ qu'on aurait cassé. */
var POSTES = [
  'joursPresence', 'entretienCentimes', 'joursSansEntretien',
  'minutesSupAcquises', 'joursCongesDecomptes', 'retenueSansSoldeCentimes',
  'minutesCpAcquis', 'salaireBrutCentimes', 'salaireNetCentimes',
  'salaireBrutProrataCentimes', 'salaireNetProrataCentimes',
  'brutDuCentimes', 'totalAVerserCentimes'
];
var POSTES_COMPTEUR = ['minutesSup', 'minutesCpAcquis', 'minutesCpPris'];

function conditions(v) {
  return {
    date_effet: '2020-01-01', numero: 1,
    jours_planning: v.planning || [1, 2, 3, 4, 5],
    heure_arrivee: '08:30', heure_depart: '17:30',
    minutes_contractuelles: 540,
    minutes_sup_jour: v.minutesSupJour == null ? 30 : v.minutesSupJour,
    minutes_par_jour_conge: v.mpjc || 540,
    entretien_centimes_jour: 550,
    sup_dues_si_enfant_absent: v.supSiAbsent !== false,
    ordre_imputation: v.ordre || 'cp_puis_sup',
    brut_mensuel_centimes: 137289, net_mensuel_centimes: 105000
  };
}

function entrees(v, aujourdhui) {
  return {
    contrat: { id: 'c1', date_debut: '2000-01-01', date_fin: null },
    conditions: conditions(v),
    journees: v.journees || [],
    compteurEntree: v.compteurEntree ||
      { minutesSup: 5400, minutesCpAcquis: 16200, minutesCpPris: 0 },
    annee: v.annee, mois: v.mois,
    imputations: v.imputations || [],
    samedisComptes: v.samedisComptes || [],
    minutesCpAcquisesExercice: v.minutesCpAcquisesExercice || 0,
    aujourdhui: aujourdhui
  };
}

function conge(jour) { return { jour: jour, type: 'conge_maria' }; }
function surSup(debut, fin, jours) {
  return { id: 'i-' + debut, date_debut: debut, date_fin: fin,
           jours_ouvrables: jours, jours_sur_cp: 0, jours_sur_sup: jours,
           jours_sans_solde: 0 };
}
function surCp(debut, fin, jours) {
  return { id: 'i-' + debut, date_debut: debut, date_fin: fin,
           jours_ouvrables: jours, jours_sur_cp: jours, jours_sur_sup: 0,
           jours_sans_solde: 0 };
}

/* ------------------------------------------------------------------ */
/* LES TROIS MOIS DE FORME DIFFÉRENTE EXIGÉS PAR LE §6.5              */
/* ------------------------------------------------------------------ */

/* 1. Un mois SANS congé — celui que le lot ne concerne en rien. Il porte
      quand même de la matière : une journée à minutes exceptionnelles, une
      absence de l'enfant, un écart d'horaire, une journée sans entretien. */
var MOIS_SANS_CONGE = {
  annee: 2026, mois: 3,
  journees: [
    { jour: '2026-03-03', type: 'presence', minutes_sup_exceptionnelles: 45 },
    { jour: '2026-03-10', type: 'absence_enfant' },
    { jour: '2026-03-17', type: 'presence', ecart_minutes: -90,
      ecart_impute_sur: 'recuperation', ecart_evenement: 'liberation_anticipee' },
    { jour: '2026-03-24', type: 'presence', entretien_du: false }
  ]
};

/* 2. Un mois avec une RÉCUPÉRATION EN DÉBUT DE MOIS — celle que la réserve
      d'entrée couvre déjà, et qui doit donc rendre exactement les mêmes
      chiffres qu'avant. */
var MOIS_RECUP_DEBUT = {
  annee: 2026, mois: 3,
  journees: [conge('2026-03-03'), conge('2026-03-04')],
  imputations: [surSup('2026-03-03', '2026-03-04', 2)]
};

/* 3. Un mois avec une RÉCUPÉRATION EN FIN DE MOIS — le cas du brief, celui
      que le mois finance en cours de route. Sa réserve d'entrée ne couvre
      qu'un seul des deux jours. */
var MOIS_RECUP_FIN = {
  annee: 2026, mois: 3,
  compteurEntree: { minutesSup: 540, minutesCpAcquis: 16200, minutesCpPris: 0 },
  journees: [conge('2026-03-03'), conge('2026-03-30')],
  imputations: [surSup('2026-03-03', '2026-03-03', 1),
                surSup('2026-03-30', '2026-03-30', 1)]
};

/* 4. Un mois avec des CONGÉS PAYÉS, pour l'arbitrage n° 2 : leur
      disponibilité ne bouge pas d'un iota. */
var MOIS_CONGES_PAYES = {
  annee: 2026, mois: 3,
  journees: [conge('2026-03-25'), conge('2026-03-26'), conge('2026-03-27')],
  imputations: [surCp('2026-03-25', '2026-03-27', 3)]
};

var LES_MOIS = [
  { nom: 'un mois sans congé', v: MOIS_SANS_CONGE },
  { nom: 'un mois avec récupération en DÉBUT de mois', v: MOIS_RECUP_DEBUT },
  { nom: 'un mois avec récupération en FIN de mois', v: MOIS_RECUP_FIN },
  { nom: 'un mois avec des congés payés', v: MOIS_CONGES_PAYES }
];

/* ------------------------------------------------------------------ */
/* A. SANS `aujourdhui` — ÉGALITÉ EXACTE                               */
/* ------------------------------------------------------------------ */

test('§4.1 — sans `aujourdhui`, le moteur rend EXACTEMENT ce qu’il rendait',
  function () {
    LES_MOIS.forEach(function (m) {
      var e = entrees(m.v, undefined);
      var av = null, ap = null, eAv = null, eAp = null;
      try { av = Avant.calculerMois(e); } catch (x) { eAv = x; }
      try { ap = Apres.calculerMois(e); } catch (x) { eAp = x; }

      if (eAv || eAp) {
        assert(eAv && eAp, m.nom + ' — un seul des deux moteurs refuse : avant=' +
          (eAv ? eAv.code : 'ok') + ' après=' + (eAp ? eAp.code : 'ok'));
        assert(eAv.code === eAp.code,
          m.nom + ' — codes différents : ' + eAv.code + ' / ' + eAp.code);
        return;
      }
      assert(JSON.stringify(sansLesRelevesAjoutes(ap)) === JSON.stringify(av),
        m.nom + ' — doit être identique aux relevés ajoutés près :' +
        '\n  avant ' + JSON.stringify(av) +
        '\n  après ' + JSON.stringify(sansLesRelevesAjoutes(ap)));
    });
  });

/* ------------------------------------------------------------------ */
/* B. AVEC `aujourdhui` — POSTE À POSTE                                */
/* ------------------------------------------------------------------ */

test('§5 — avec `aujourdhui`, poste à poste : aucun mois calculable ne bouge',
  function () {
    var compares = 0;
    var debloques = 0;

    LES_MOIS.forEach(function (m) {
      /* Trois positions de la date du jour : avant le mois, au milieu, après
         le mois. La réserve à la date change à chaque fois — les montants,
         eux, ne doivent pas. */
      ['2026-02-15', '2026-03-16', '2026-04-15'].forEach(function (auj) {
        var av = null, ap = null, eAv = null, eAp = null;
        try { av = Avant.calculerMois(entrees(m.v, undefined)); } catch (x) { eAv = x; }
        try { ap = Apres.calculerMois(entrees(m.v, auj)); } catch (x) { eAp = x; }

        var etiquette = m.nom + ' [aujourd’hui = ' + auj + ']';

        if (eAv) {
          /* Le moteur d'avant refusait. C'est le SEUL écart autorisé : ou
             bien le nouveau refuse aussi, ou bien il accepte — et alors c'est
             exactement ce que le brief demande. */
          if (eAp) {
            assert(eAp.code === 'IMPUTATION_DEPASSE_RESERVES' ||
                   eAp.code === 'RESERVES_PAS_ENCORE_ACQUISES',
              etiquette + ' — refus d’une autre nature : ' + eAp.code);
          } else {
            debloques++;
          }
          return;
        }

        assert(!eAp, etiquette + ' — le moteur refuse un mois qu’il calculait : ' +
          (eAp && eAp.code));

        POSTES.forEach(function (k) {
          assert(JSON.stringify(av[k]) === JSON.stringify(ap[k]),
            etiquette + ' — le poste `' + k + '` a bougé : ' +
            JSON.stringify(av[k]) + ' → ' + JSON.stringify(ap[k]));
        });
        POSTES_COMPTEUR.forEach(function (k) {
          assert(av.compteurSortie[k] === ap.compteurSortie[k],
            etiquette + ' — le compteur de sortie `' + k + '` a bougé : ' +
            av.compteurSortie[k] + ' → ' + ap.compteurSortie[k]);
        });
        assert(JSON.stringify(av.imputation) === JSON.stringify(ap.imputation),
          etiquette + ' — la ventilation a bougé : ' +
          JSON.stringify(av.imputation) + ' → ' + JSON.stringify(ap.imputation));
        compares++;
      });
    });

    assert(compares >= 9, 'trop peu de mois comparés : ' + compares);
    /* Et le lot doit SERVIR à quelque chose : au moins un mois que le moteur
       d'avant refusait est désormais accepté. Un différentiel tout vert où
       rien ne se débloque prouverait que la règle n'est pas branchée. */
    assert(debloques >= 1,
      'aucun mois débloqué : la règle du brief n’est pas branchée');
  });

/* ------------------------------------------------------------------ */
/* LE DIFFÉRENTIEL LARGE — TOUS LES DÉCORS CROISÉS                     */
/* ------------------------------------------------------------------ */

test('§5 — différentiel large : 1 500 décors croisés, aucun montant ne bouge',
  function () {
    var PLANNINGS = [[1, 2, 3, 4, 5], [1, 2, 3, 4, 5, 6], [1, 3, 5]];
    var ORDRES = ['cp_puis_sup', 'sup_puis_cp'];
    var MOIS = [{ annee: 2026, mois: 3 }, { annee: 2026, mois: 5 },
                { annee: 2025, mois: 5 }, { annee: 2025, mois: 12 }];
    var COMPTEURS = [
      { minutesSup: 0, minutesCpAcquis: 0, minutesCpPris: 0 },
      { minutesSup: 540, minutesCpAcquis: 16200, minutesCpPris: 0 },
      { minutesSup: 5400, minutesCpAcquis: 5400, minutesCpPris: 5400 },
      { minutesSup: -900, minutesCpAcquis: 16200, minutesCpPris: 0 }
    ];
    var AUJOURDHUI = [undefined, '2025-01-01', '2026-03-16', '2027-01-01'];
    var FORMES = ['aucune', 'recup-debut', 'recup-fin', 'cp-milieu', 'panache'];

    var compares = 0, debloques = 0, refusIdentiques = 0;

    PLANNINGS.forEach(function (planning) {
      ORDRES.forEach(function (ordre) {
        MOIS.forEach(function (mm) {
          COMPTEURS.forEach(function (compteur) {
            FORMES.forEach(function (forme) {
              var v = formeDuMois(forme, mm, planning, ordre, compteur);
              var av = null, eAv = null;
              try { av = Avant.calculerMois(entrees(v, undefined)); } catch (x) { eAv = x; }

              AUJOURDHUI.forEach(function (auj) {
                var ap = null, eAp = null;
                try { ap = Apres.calculerMois(entrees(v, auj)); } catch (x) { eAp = x; }
                var etiquette = '[' + mm.annee + '-' + mm.mois + ' planning=' +
                  planning.join('') + ' ordre=' + ordre + ' forme=' + forme +
                  ' compteur=' + JSON.stringify(compteur) + ' auj=' + auj + ']';

                if (eAv) {
                  if (eAp) { refusIdentiques++; return; }
                  assert(auj, etiquette +
                    ' — sans `aujourdhui`, un mois refusé ne doit JAMAIS être accepté');
                  debloques++;
                  return;
                }
                assert(!eAp, etiquette + ' — un mois calculable est refusé : ' +
                  (eAp && eAp.code));

                POSTES.forEach(function (k) {
                  assert(JSON.stringify(av[k]) === JSON.stringify(ap[k]),
                    etiquette + ' — poste `' + k + '` : ' +
                    JSON.stringify(av[k]) + ' → ' + JSON.stringify(ap[k]));
                });
                POSTES_COMPTEUR.forEach(function (k) {
                  assert(av.compteurSortie[k] === ap.compteurSortie[k],
                    etiquette + ' — compteur `' + k + '` : ' +
                    av.compteurSortie[k] + ' → ' + ap.compteurSortie[k]);
                });
                assert(JSON.stringify(av.imputation) === JSON.stringify(ap.imputation),
                  etiquette + ' — ventilation : ' + JSON.stringify(av.imputation) +
                  ' → ' + JSON.stringify(ap.imputation));
                /* Sans date du jour, l'égalité doit être TOTALE, pas seulement
                   poste à poste. */
                if (!auj) {
                  assert(JSON.stringify(sansLesRelevesAjoutes(ap)) === JSON.stringify(av),
                    etiquette + ' — égalité exacte attendue sans `aujourdhui`');
                }
                compares++;
              });
            });
          });
        });
      });
    });

    assert(compares > 1000, 'trop peu de comparaisons : ' + compares);
    assert(debloques > 0, 'aucun mois débloqué sur tout le croisement');
    assert(refusIdentiques > 0, "aucun refus rencontré : le décor est trop sage");
    if (process.env.DIFF_VERBEUX) console.log("      comparés=" + compares + " débloqués=" + debloques + " refus=" + refusIdentiques);
  });

/* Les cinq formes de mois du croisement. Les journées de congé sont posées
   sur des jours du planning ET non fériés — sinon le décompte RG-06 et la
   ventilation divergent, et le différentiel mesurerait `IMPUTATION_INCOMPLETE`
   au lieu des réserves. */
function formeDuMois(forme, mm, planning, ordre, compteur) {
  var base = {
    annee: mm.annee, mois: mm.mois, planning: planning, ordre: ordre,
    compteurEntree: compteur, journees: [], imputations: []
  };
  if (forme === 'aucune') {
    base.journees = [{ jour: iso(mm, 10), type: 'presence',
                       minutes_sup_exceptionnelles: 15 }];
    return base;
  }
  var jours = joursPosablesDuMois(mm, planning);
  if (jours.length < 6) return base;

  function periode(jour, ventilation) {
    var n = Apres.decompterJoursOuvrables(jour, jour, planning, []);
    if (n !== 1) return;
    base.journees.push(conge(jour));
    base.imputations.push(ventilation === 'cp'
      ? surCp(jour, jour, 1) : surSup(jour, jour, 1));
  }

  if (forme === 'recup-debut') { periode(jours[0], 'sup'); periode(jours[1], 'sup'); }
  if (forme === 'recup-fin') {
    periode(jours[jours.length - 2], 'sup');
    periode(jours[jours.length - 1], 'sup');
  }
  if (forme === 'cp-milieu') {
    periode(jours[Math.floor(jours.length / 2)], 'cp');
  }
  if (forme === 'panache') {
    periode(jours[1], 'sup');
    periode(jours[Math.floor(jours.length / 2)], 'cp');
    periode(jours[jours.length - 1], 'sup');
  }
  return base;
}

function iso(mm, q) {
  return mm.annee + '-' + (mm.mois < 10 ? '0' + mm.mois : mm.mois) +
    '-' + (q < 10 ? '0' + q : q);
}

/* Les jours du mois qu'on peut poser en congé : au planning, non fériés, et
   isolés — deux jours consécutifs formeraient UNE période, et chacune de nos
   imputations d'un jour n'en couvrirait plus la totalité. */
function joursPosablesDuMois(mm, planning) {
  var out = [];
  var tous = Apres.joursDuMois(mm.annee, mm.mois);
  for (var i = 0; i < tous.length; i++) {
    var d = tous[i];
    if (planning.indexOf(Apres.jourSemaine(d)) === -1) continue;
    if (Apres.decompterJoursOuvrables(d, d, planning, []) !== 1) continue;
    /* Isolé : le jour du planning qui précède et celui qui suit ne sont pas
       eux-mêmes retenus. On garde donc un jour sur deux. */
    if (out.length && voisinDePlanning(out[out.length - 1], d, planning)) continue;
    out.push(d);
  }
  return out;
}

/* Deux jours du planning sont voisins s'il n'existe entre eux aucun autre
   jour du planning. */
function voisinDePlanning(a, b, planning) {
  for (var d = suivant(a); d < b; d = suivant(d)) {
    if (planning.indexOf(Apres.jourSemaine(d)) !== -1) return false;
  }
  return true;
}
function suivant(d) {
  var t = new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1,
    Number(d.slice(8, 10)) + 1));
  return t.toISOString().slice(0, 10);
}

module.exports = { cas: cas };
