/* ============================================================================
   Test de bout en bout — de la ligne écrite en base jusqu'au chiffre du mois.
   Correctifs B1 et B2 de la relecture de la PR #9.

   POURQUOI CE FICHIER EXISTE, ET POURQUOI IL N'EXISTAIT PAS.

   La relecture de la PR #9 a trouvé que **la ventilation choisie par Maria
   n'atteignait jamais le moteur**. L'écran du lot 10 fonctionnait, la ligne
   `imputation_conge` était écrite, et `chaine-mois.js` — seul appelant du
   moteur pour tous les écrans — ne la transmettait pas. Maria pouvait choisir
   « ces six jours, 0 sur mes congés payés et 6 sans solde » : le récapitulatif
   remis à la famille en consommait deux quand même.

   Onze suites de fumée et 719 assertions n'ont rien vu. La raison est simple
   et vaut d'être écrite : **toutes simulaient la couche de données**. Elles
   vérifiaient qu'un écran appelle `enregistrerImputation` avec les bonnes
   valeurs — jamais que quelqu'un, ensuite, RELIT cette ligne. Une donnée
   écrite et jamais relue est invisible à un test qui ne regarde que
   l'écriture.

   Ce fichier prend l'autre bout. Il part d'une base simulée qui contient déjà
   les lignes, appelle la vraie chaîne avec le vrai moteur, et regarde le
   CHIFFRE qui en sort. Aucun DOM, aucun écran : si ce fichier passe, la
   ventilation a un effet ; s'il échoue, le lot 10 est de nouveau décoratif.

   Lancement : node test/pr9-bout-en-bout.smoke.js
   ========================================================================= */
'use strict';

var Engine = require('../js/engine.js');
global.Engine = Engine;

var echecs = 0;
function assert(cond, msg) {
  if (!cond) { echecs++; console.error('FAIL ' + msg); } else { console.log('ok   ' + msg); }
}
function egal(obtenu, attendu, msg) {
  assert(obtenu === attendu, msg + ' (attendu ' + JSON.stringify(attendu) +
    ', obtenu ' + JSON.stringify(obtenu) + ')');
}

/* --- Décor. Valeurs FICTIVES et rondes : le dépôt est public. ----------- */
function contrat(planning) {
  return {
    id: 'c-test', prenom_enfant: 'Test', famille_id: 'f-test',
    date_debut: '2026-01-01', date_fin: null,
    minutes_contractuelles: 540, minutes_sup_jour: 30, minutes_par_jour_conge: 540,
    entretien_centimes_jour: 500, jours_planning: planning || [1, 2, 3, 4, 5],
    heure_arrivee: '08:30:00', heure_depart: '18:00:00', statut: 'actif',
    sup_dues_si_enfant_absent: true, ordre_imputation: 'cp_puis_sup', archive: false
  };
}

/* La base simulée. `imputations` est la seule chose qui change d'un cas à
   l'autre : c'est exactement la variable dont on veut prouver l'effet. */
function baseSimulee(opts) {
  var journees = opts.journees || {};
  var imputations = opts.imputations || [];
  return {
    getSalaires: function () {
      return Promise.resolve([{ id: 's1', contrat_id: 'c-test', date_effet: '2026-01-01',
        brut_mensuel_centimes: 200000, net_mensuel_centimes: 150000 }]);
    },
    getCompteurInitial: function () {
      return Promise.resolve({ contrat_id: 'c-test', date_reference: '2026-06-01',
        minutes_sup: opts.minutesSup != null ? opts.minutesSup : 0,
        dixiemes_cp_acquis: opts.cpAcquis != null ? opts.cpAcquis : 20,
        dixiemes_cp_pris: 0 });
    },
    getJourneesPeriode: function () {
      var parMois = {};
      Object.keys(journees).forEach(function (d) {
        var cle = d.slice(0, 7);
        if (!parMois[cle]) parMois[cle] = {};
        parMois[cle][d] = journees[d];
      });
      return Promise.resolve(parMois);
    },
    listRecapsPeriode: function () { return Promise.resolve([]); },
    getRecap: function () { return Promise.resolve(null); },
    listImputations: function (id, debut, fin) {
      return Promise.resolve(imputations.filter(function (i) {
        return i.date_debut <= fin && i.date_fin >= debut;
      }));
    }
  };
}

function journeesConge(dates) {
  var out = {};
  dates.forEach(function (d) {
    out[d] = { id: 'j-' + d, contrat_id: 'c-test', jour: d, type: 'conge_maria',
      minutes_reelles: null, entretien_centimes: null, commentaire: null,
      minutes_sup_exceptionnelles: 0, minutes_sup_renoncees: 0, sup_dues_override: null };
  });
  return out;
}

function moisDe(chaine, annee, mois) {
  var cle = annee + '-' + String(mois).padStart(2, '0');
  return (chaine.mois || []).filter(function (e) { return e.cle === cle; })[0] || null;
}

/* On recharge la chaîne à chaque cas : elle lit `global.DB` à l'appel, pas au
   chargement, mais on évite tout état résiduel. */
function chaine(opts, cible) {
  global.DB = baseSimulee(opts);
  delete require.cache[require.resolve('../js/chaine-mois.js')];
  var Chaine = require('../js/chaine-mois.js');
  return Chaine.serie(opts.contrat || contrat(), cible || { annee: 2026, mois: 6 },
    { depuis: { annee: 2026, mois: 6 } });
}

(async function () {

  /* ==================================================================== */
  /* B1 — La ventilation choisie change le résultat du mois               */
  /* ==================================================================== */
  console.log('\n--- B1 : la ventilation atteint le moteur ---');

  /* Une semaine du lundi 8 au vendredi 12 juin 2026, posée en congé.
     RG-06 : elle compte SIX jours ouvrables, samedi compris. */
  var semaine = ['2026-06-08', '2026-06-09', '2026-06-10', '2026-06-11', '2026-06-12'];
  var periode = { date_debut: '2026-06-08', date_fin: '2026-06-12' };

  egal(Engine.decompterJoursOuvrables(periode.date_debut, periode.date_fin, [1, 2, 3, 4, 5]), 6,
    'RG-06 : la semaine complète compte bien 6 jours ouvrables, samedi compris');

  /* Cas 1 — aucune imputation : l'ordre du contrat s'applique (RG-07).
     Le contrat a 2 jours de congés payés au compteur : il les consomme. */
  var sansChoix = await chaine({ journees: journeesConge(semaine), cpAcquis: 20, imputations: [] });
  var m1 = moisDe(sansChoix, 2026, 6).resultat;
  egal(m1.joursCongesDecomptes, 6, 'sans choix : 6 jours décomptés');
  egal(m1.imputation.joursSurCp, 2, 'sans choix : l’ordre par défaut consomme les 2 jours de congés payés');
  egal(m1.imputation.joursSansSolde, 4, 'sans choix : et met 4 jours sans solde');

  /* Cas 2 — LE CAS QUI NE PASSAIT PAS. Maria choisit de tout mettre sans
     solde pour préserver ses deux jours de congés payés. */
  var avecChoix = await chaine({
    journees: journeesConge(semaine), cpAcquis: 20,
    imputations: [{ id: 'i1', contrat_id: 'c-test',
      date_debut: periode.date_debut, date_fin: periode.date_fin,
      jours_ouvrables: 6, jours_sur_cp: 0, jours_sur_sup: 0, jours_sans_solde: 6 }]
  });
  var m2 = moisDe(avecChoix, 2026, 6).resultat;
  egal(m2.joursCongesDecomptes, 6, 'avec choix : toujours 6 jours décomptés');
  egal(m2.imputation.joursSurCp, 0,
    'B1 : AUCUN jour de congé payé consommé — c’est le choix de Maria, et il ' +
    'atteint enfin le moteur');
  egal(m2.imputation.joursSansSolde, 6, 'B1 : les 6 jours sont sans solde');
  assert(m2.retenueSansSoldeCentimes > m1.retenueSansSoldeCentimes,
    'B1 : la retenue sur salaire est plus forte — le choix a un effet MONÉTAIRE, ' +
    'pas seulement un affichage');
  egal(m2.compteurSortie.dixiemesCpPris, 0,
    'B1 : et le compteur de congés payés de Maria est préservé');

  /* Cas 3 — le choix inverse : tout sur les congés payés. */
  var toutCp = await chaine({
    journees: journeesConge(semaine), cpAcquis: 100,
    imputations: [{ id: 'i1', contrat_id: 'c-test',
      date_debut: periode.date_debut, date_fin: periode.date_fin,
      jours_ouvrables: 6, jours_sur_cp: 6, jours_sur_sup: 0, jours_sans_solde: 0 }]
  });
  var m3 = moisDe(toutCp, 2026, 6).resultat;
  egal(m3.imputation.joursSurCp, 6, 'B1 : le choix inverse produit l’effet inverse');
  egal(m3.retenueSansSoldeCentimes, 0, 'B1 : et aucune retenue');

  /* La preuve tient en une phrase : la MÊME semaine, les MÊMES journées, et
     trois résultats différents selon la seule ligne d'imputation. */
  assert(m1.imputation.joursSurCp !== m2.imputation.joursSurCp &&
         m2.imputation.joursSurCp !== m3.imputation.joursSurCp,
    'B1 : trois ventilations, trois résultats — la ligne écrite en base pilote ' +
    'réellement le calcul');

  /* ==================================================================== */
  /* B2 — Ce que l'écran écrit doit être ce que le moteur compte           */
  /* ==================================================================== */
  console.log('\n--- B2 : le décompte dépend du planning ---');

  var lundiJeudi = contrat([1, 2, 3, 4]);
  var joursLJ = ['2026-06-08', '2026-06-09', '2026-06-10', '2026-06-11'];

  var attendu = Engine.decompterJoursOuvrables('2026-06-08', '2026-06-11', [1, 2, 3, 4]);
  egal(attendu, 6,
    'B2 : du lundi au jeudi, un contrat qui ne garde pas le vendredi décompte ' +
    '6 jours ouvrables — la reprise n’a lieu que le lundi suivant');
  egal(Engine.decompterJoursOuvrables('2026-06-08', '2026-06-11'), 4,
    'B2 : sans planning, le moteur en compte 4 — c’est ce que l’écran annonçait');

  /* Une imputation portant le BON décompte : elle s'applique. */
  var bonne = await chaine({
    contrat: lundiJeudi, journees: journeesConge(joursLJ), cpAcquis: 100,
    imputations: [{ id: 'i1', contrat_id: 'c-test',
      date_debut: '2026-06-08', date_fin: '2026-06-11',
      jours_ouvrables: 6, jours_sur_cp: 0, jours_sur_sup: 0, jours_sans_solde: 6 }]
  });
  var mb = moisDe(bonne, 2026, 6).resultat;
  egal(mb.joursCongesDecomptes, 6, 'B2 : le mois décompte 6 jours');
  egal(mb.imputation.joursSansSolde, 6, 'B2 : et la ventilation choisie s’applique');

  /* Une imputation portant le décompte de l'ANCIEN écran (4) : LE MOTEUR LA
     REFUSE TOUJOURS. C'est la démonstration que B1 et B2 devaient être
     corrigés ensemble — corriger B1 seul aurait branché les imputations sur le
     moteur alors que l'écran écrivait encore 4.

     MISE À JOUR LOT 16 §16.1. La question laissée ouverte ici — « faut-il que
     le mois devienne incalculable, ou qu'il retombe sur l'ordre par défaut en
     le disant ? » — est désormais tranchée par la spécification : il retombe.
     Un refus qui remonte fait tomber la chaîne entière du contrat, donc tous
     ses écrans, y compris celui qui permettrait de corriger. C'est arrivé en
     production sur un contrat réel.

     L'assertion vérifie donc les DEUX moitiés de la règle, et c'est important
     qu'elle vérifie les deux :
       - le MOTEUR reste strict et refuse (il n'a pas été assoupli) ;
       - la CHAÎNE écarte la ligne fautive, calcule quand même, et le DIT. */
  var refusMoteur = null;
  try {
    Engine.calculerMois({
      contrat: lundiJeudi,
      salaire: { brut_mensuel_centimes: 0, net_mensuel_centimes: 0 },
      journees: Object.keys(journeesConge(joursLJ)).map(function (k) {
        return journeesConge(joursLJ)[k];
      }),
      compteurEntree: { minutesSup: 0, dixiemesCpAcquis: 100, dixiemesCpPris: 0 },
      annee: 2026, mois: 6,
      imputations: [{ id: 'i1', contrat_id: 'c-test',
        date_debut: '2026-06-08', date_fin: '2026-06-11',
        jours_ouvrables: 4, jours_sur_cp: 0, jours_sur_sup: 0, jours_sans_solde: 4 }]
    });
  } catch (e) { refusMoteur = e; }
  assert(!!refusMoteur && refusMoteur.code === 'IMPUTATION_INCOMPLETE',
    'B2 / §16.1 : le MOTEUR refuse toujours une imputation portant le décompte ' +
    'de l’ancien écran (4 au lieu de 6) — il n’a pas été assoupli');

  var repli = null;
  var erreurRepli = null;
  try {
    repli = await chaine({
      contrat: lundiJeudi, journees: journeesConge(joursLJ), cpAcquis: 100,
      imputations: [{ id: 'i1', contrat_id: 'c-test',
        date_debut: '2026-06-08', date_fin: '2026-06-11',
        jours_ouvrables: 4, jours_sur_cp: 0, jours_sur_sup: 0, jours_sans_solde: 4 }]
    });
  } catch (e) { erreurRepli = e; }
  assert(!erreurRepli,
    '§16.1 A1 : la CHAÎNE ne rejette plus — l’écran de Maria s’affiche au lieu ' +
    'de tomber, y compris celui qui lui permet de corriger');

  var mRepli = repli && moisDe(repli, 2026, 6);
  egal(mRepli && mRepli.resultat.joursCongesDecomptes, 6,
    '§16.1 A2 : le mois est calculé avec le décompte réel du moteur');
  egal(mRepli && mRepli.resultat.imputation.joursSansSolde, 0,
    '§16.1 A2 : et dans l’ordre par défaut du contrat — les congés payés ' +
    'd’abord, pas le sans-solde qu’une ligne fautive demandait');
  egal(mRepli && (mRepli.imputationsEcartees || []).length, 1,
    '§16.1 A3 : le maillon PORTE la période écartée — l’écart n’est jamais avalé');
  egal(mRepli && mRepli.imputationsEcartees[0].code, 'IMPUTATION_INCOMPLETE',
    '§16.1 : avec le code du moteur, pour que l’écran dise la bonne phrase');
  assert(mRepli && (mRepli.resultat.imputationsAppliquees || []).some(function (i) {
    return i.source === 'defaut_choix_ecarte' && i.choixEcarte &&
           i.choixEcarte.date_debut === '2026-06-08';
  }), '§16.1 : et la période reprend la forme que le moteur produit déjà ' +
      '(defaut_choix_ecarte + choixEcarte) — un seul cas à connaître pour les écrans');

  /* A6 — SEULE L'IMPUTATION FAUTIVE EST ÉCARTÉE. Deux périodes dans le même
     mois, l'une valide et l'autre impossible : la valide doit survivre.
     Sans cette garantie, une seule ligne abîmée effacerait tous les choix du
     mois, en silence. */
  var deuxPeriodes = ['2026-06-08', '2026-06-09', '2026-06-22', '2026-06-23'];
  var mixte = await chaine({
    contrat: lundiJeudi, journees: journeesConge(deuxPeriodes), cpAcquis: 100,
    imputations: [
      { id: 'bonne', contrat_id: 'c-test',
        date_debut: '2026-06-08', date_fin: '2026-06-09',
        jours_ouvrables: Engine.decompterJoursOuvrables('2026-06-08', '2026-06-09', [1, 2, 3, 4]),
        jours_sur_cp: 0, jours_sur_sup: 0,
        jours_sans_solde: Engine.decompterJoursOuvrables('2026-06-08', '2026-06-09', [1, 2, 3, 4]) },
      { id: 'fautive', contrat_id: 'c-test',
        date_debut: '2026-06-22', date_fin: '2026-06-23',
        jours_ouvrables: 1, jours_sur_cp: 1, jours_sur_sup: 0, jours_sans_solde: 0 }
    ]
  });
  var mMixte = moisDe(mixte, 2026, 6);
  egal((mMixte.imputationsEcartees || []).length, 1,
    '§16.1 A6 : une seule des deux périodes est écartée');
  egal(mMixte.imputationsEcartees[0].date_debut, '2026-06-22',
    '§16.1 A6 : et c’est bien la fautive, pas l’autre');
  assert(mMixte.resultat.imputation.joursSansSolde > 0,
    '§16.1 A6 : le choix « sans solde » de la période VALIDE est toujours appliqué');

  /* ==================================================================== */
  /* Période à cheval : la ventilation se conserve d'un mois sur l'autre   */
  /* ==================================================================== */
  console.log('\n--- La période à cheval sur deux mois ---');

  var aCheval = ['2026-07-29', '2026-07-30', '2026-07-31',
                 '2026-08-03', '2026-08-04'];
  var chevalChaine = await chaine({
    journees: journeesConge(aCheval), cpAcquis: 200,
    imputations: [{ id: 'i1', contrat_id: 'c-test',
      date_debut: '2026-07-29', date_fin: '2026-08-04',
      jours_ouvrables: Engine.decompterJoursOuvrables('2026-07-29', '2026-08-04', [1, 2, 3, 4, 5]),
      jours_sur_cp: 0, jours_sur_sup: 0,
      jours_sans_solde: Engine.decompterJoursOuvrables('2026-07-29', '2026-08-04', [1, 2, 3, 4, 5]) }]
  }, { annee: 2026, mois: 8 });

  var juillet = moisDe(chevalChaine, 2026, 7);
  var aout = moisDe(chevalChaine, 2026, 8);
  assert(!!juillet && !!aout, 'les deux mois sont dans la chaîne');
  var totalDecompte = juillet.resultat.joursCongesDecomptes + aout.resultat.joursCongesDecomptes;
  egal(totalDecompte, Engine.decompterJoursOuvrables('2026-07-29', '2026-08-04', [1, 2, 3, 4, 5]),
    'la somme des deux mois vaut le décompte de la période entière — RG-06 ne ' +
    'se redécoupe pas mois par mois');
  egal(juillet.resultat.imputation.joursSurCp + aout.resultat.imputation.joursSurCp, 0,
    'B1 : et le choix « sans solde » vaut pour les DEUX mois, pas seulement ' +
    'celui où la période commence');

  /* ==================================================================== */
  console.log('');
  if (echecs) { console.error(echecs + ' échec(s).'); process.exit(1); }
  console.log('Tout est conforme.');
})().catch(function (e) {
  console.error('Erreur pendant le parcours :', e && e.stack || e);
  process.exit(1);
});
