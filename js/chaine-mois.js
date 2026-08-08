/* ============================================================================
   chaine-mois.js — Chaîne des mois d'un contrat (lot 5).

   AUCUNE RÈGLE MÉTIER ICI. Ce module ne fait qu'ORCHESTRER : il charge les
   données via DB, enchaîne les mois (compteurSortie du mois N -> compteurEntree
   du mois N+1) et délègue chaque mois à Engine.calculerMois(). Il n'existe et
   n'existera qu'UN SEUL moteur de calcul (js/engine.js) : le récapitulatif de
   période (C6) agrège des résultats mensuels, il n'en recalcule aucun
   autrement.

   Pourquoi ce module : la chaîne des mois était écrite dans ui-recap.js et
   n'était donc utilisable que par l'écran mensuel. Le récap de période (C6),
   l'historique par famille (C4) et le solde de fin de contrat (C3) ont besoin
   exactement de la même chaîne. On l'extrait telle quelle plutôt que de la
   réécrire trois fois — une seule source de vérité.

   Deux principes non négociables :
   - Un mois FIGÉ n'est jamais recalculé : on lit son instantané (RG-15 et
     immuabilité). Son compteurSortie alimente le mois suivant : c'est le
     chiffre parti chez les parents qui fait foi, pas un recalcul.
   - Chargement MUTUALISÉ : les journées de toute la période sont lues en un
     seul aller-retour, les récaps aussi. Sur une année et quatre contrats,
     l'écart se voit à l'œil nu.

   Dates : chaînes 'YYYY-MM-DD' (dates pures), jamais d'objet Date avec heure.
   ========================================================================= */
(function (global) {
  'use strict';

  /* Garde-fou : une chaîne de plus de 600 mois (50 ans) est forcément une
     donnée aberrante (date_debut fantaisiste). On borne et on le dit. */
  var MAX_MOIS = 600;

  function resoudreEngine() {
    if (global.Engine) return global.Engine;
    if (typeof module !== 'undefined' && module.exports) return require('./engine.js');
    throw new Error('chaine-mois : Engine (js/engine.js) non chargé.');
  }
  function resoudreDb() {
    if (global.DB) return global.DB;
    throw new Error('chaine-mois : DB (js/db.js) non chargé.');
  }

  /* ------------------------------------------------------------------ */
  /* Calendrier (pur, sans fuseau)                                       */
  /* ------------------------------------------------------------------ */

  function estBissextile(a) { return (a % 4 === 0 && a % 100 !== 0) || a % 400 === 0; }
  function nbJoursDansMois(annee, mois) {
    return [31, estBissextile(annee) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mois - 1];
  }
  function deuxChiffres(n) { return String(n).padStart(2, '0'); }
  function premierJour(annee, mois) { return annee + '-' + deuxChiffres(mois) + '-01'; }
  function dernierJour(annee, mois) {
    return annee + '-' + deuxChiffres(mois) + '-' + deuxChiffres(nbJoursDansMois(annee, mois));
  }
  function moisSuivant(a, m) { m++; if (m > 12) { m = 1; a++; } return { annee: a, mois: m }; }
  function moisPrecedent(a, m) { m--; if (m < 1) { m = 12; a--; } return { annee: a, mois: m }; }
  function cmpMois(a1, m1, a2, m2) { return a1 !== a2 ? a1 - a2 : m1 - m2; }
  function moisDeDate(dateStr) { var p = String(dateStr).split('-'); return { annee: +p[0], mois: +p[1] }; }
  function cleMois(annee, mois) { return annee + '-' + deuxChiffres(mois); }
  function nbMoisEntre(a1, m1, a2, m2) { return (a2 - a1) * 12 + (m2 - m1) + 1; }

  var LIBELLES_MOIS = ['', 'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
    'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  function libelleMois(mois) { return LIBELLES_MOIS[mois]; }
  function libelleMoisAnnee(annee, mois) { return LIBELLES_MOIS[mois] + ' ' + annee; }

  /* ------------------------------------------------------------------ */
  /* Chargement mutualisé                                                */
  /* ------------------------------------------------------------------ */

  function chargerJournees(DB, contratId, debut, fin) {
    if (typeof DB.getJourneesPeriode === 'function') {
      return DB.getJourneesPeriode(contratId, debut, fin);
    }
    /* Repli (DB ancien ou simulé) : lecture mois par mois. */
    var d = moisDeDate(debut), f = moisDeDate(fin);
    var cur = { annee: d.annee, mois: d.mois };
    var parMois = {};
    var seq = Promise.resolve();
    var garde = 0;
    while (cmpMois(cur.annee, cur.mois, f.annee, f.mois) <= 0 && garde < MAX_MOIS) {
      (function (mm) {
        seq = seq.then(function () {
          return DB.getJourneesMois(contratId, mm.annee, mm.mois).then(function (parJour) {
            parMois[cleMois(mm.annee, mm.mois)] = parJour || {};
          });
        });
      })(cur);
      cur = moisSuivant(cur.annee, cur.mois);
      garde++;
    }
    return seq.then(function () { return parMois; });
  }

  function chargerRecaps(DB, contratId, anneeMin, anneeMax) {
    if (typeof DB.listRecapsPeriode === 'function') {
      return DB.listRecapsPeriode(contratId, anneeMin, anneeMax).then(function (lignes) {
        var parMois = {};
        (lignes || []).forEach(function (r) { parMois[cleMois(r.annee, r.mois)] = r; });
        return parMois;
      });
    }
    return Promise.resolve(null);   // repli : lecture unitaire dans la boucle
  }

  /* ------------------------------------------------------------------ */
  /* Chaîne des mois                                                     */
  /* ------------------------------------------------------------------ */

  /* Compteur d'ENTRÉE d'un mois figé, relu depuis son instantané.
     ResultatMois ne porte que le compteur de SORTIE ; l'entrée s'en déduit
     exactement, en défaisant l'enchaînement que ce module a lui-même posé :
       entrée.minutesSup = sortie − acquises + consommées
       entrée.cpAcquis   = sortie − acquis du mois
       entrée.cpPris     = sortie − consommés du mois
     Aucune règle nouvelle : c'est l'inverse littéral du chaînage. Sert à ce
     qu'un récapitulatif de période démarrant sur un mois figé affiche le
     solde d'entrée du DOCUMENT, et non celui d'un rejeu. Repli sur `defaut`
     si l'instantané est incomplet (récaps figés d'avant le lot 5). */
  function compteurEntreeDe(donnees, defaut) {
    if (!donnees || !donnees.compteurSortie) return defaut;
    var s = donnees.compteurSortie;
    var imp = donnees.imputation || {};
    if (typeof s.minutesSup !== 'number') return defaut;
    return {
      minutesSup: s.minutesSup - (donnees.minutesSupAcquises || 0) + (imp.minutesSupConsommees || 0),
      dixiemesCpAcquis: (s.dixiemesCpAcquis || 0) - (donnees.dixiemesCpAcquis || 0),
      dixiemesCpPris: (s.dixiemesCpPris || 0) - (imp.dixiemesCpConsommes || 0)
    };
  }

  /* Rejoue tous les mois du contrat depuis son point de départ (compteur
     d'initialisation, sinon date de début) jusqu'au mois `cible` inclus.

     contrat : ligne de la table contrat
     cible   : { annee, mois } — dernier mois calculé
     opts    : { onProgress: function (fait, total),
                 depuis: { annee, mois } }   // premier mois voulu par l'appelant

     `opts.depuis` sert quand la fenêtre demandée commence AVANT le point de
     départ des compteurs : sans lui, la chaîne ne remonterait pas assez loin
     et le récapitulatif de période serait tronqué en silence.

     Résout :
       { mois: [ entree… ], depart, debutChaine, tronquee, avantInitialisation }
     avec entree = {
       annee, mois, cle,
       resultat,             // ResultatMois (instantané figé, ou calcul courant)
       fige,                 // true si le mois porte un récap figé
       recap,                // la ligne recap_mensuel s'il en existe une
       salaire,              // barème RG-15 applicable au mois (ou null)
       salaireManquant,      // aucun barème applicable et mois non figé
       avantInitialisation,  // mois antérieur à la reprise manuelle des compteurs
       compteurEntree, compteurSortie
     }

     Un mois figé n'est JAMAIS recalculé : son instantané est repris tel quel
     et son compteurSortie alimente le mois suivant. */
  function serie(contrat, cible, opts) {
    opts = opts || {};
    var Engine = resoudreEngine();
    var DB = resoudreDb();

    return Promise.all([
      DB.getSalaires(contrat.id),
      DB.getCompteurInitial(contrat.id)
    ]).then(function (res) {
      var salaires = res[0] || [];
      var init = res[1];

      /* Point de départ « officiel » de la chaîne : la reprise manuelle des
         compteurs si elle existe (cahier §7, « ne pas repartir de zéro »),
         sinon le début du contrat. */
      var depart = init ? moisDeDate(init.date_reference) : moisDeDate(contrat.date_debut);
      var compteurInitial = init
        ? { minutesSup: init.minutes_sup, dixiemesCpAcquis: init.dixiemes_cp_acquis, dixiemesCpPris: init.dixiemes_cp_pris }
        : { minutesSup: 0, dixiemesCpAcquis: 0, dixiemesCpPris: 0 };
      var zero = { minutesSup: 0, dixiemesCpAcquis: 0, dixiemesCpPris: 0 };

      /* La chaîne peut devoir commencer AVANT ce point de départ : c'est le
         cas quand on remonte à une famille de l'année précédente (C4) ou
         qu'une période libre couvre des mois antérieurs à la mise en service
         de l'application (C6). Ces mois existent — ils ont des journées et un
         barème — mais aucun compteur ne peut en être déduit : la reprise
         manuelle est le point zéro. On les calcule avec des compteurs à zéro
         et on les MARQUE (`avantInitialisation`), pour que les écrans disent
         la vérité au lieu de faire croire à des soldes significatifs.
         Au mois de la reprise, le compteur est remis à sa valeur saisie :
         c'est elle qui fait foi, pas le cumul des mois d'avant. */
      var debutChaine = { annee: depart.annee, mois: depart.mois };
      if (opts.depuis && cmpMois(opts.depuis.annee, opts.depuis.mois, debutChaine.annee, debutChaine.mois) < 0) {
        debutChaine = { annee: opts.depuis.annee, mois: opts.depuis.mois };
      }
      if (cmpMois(cible.annee, cible.mois, debutChaine.annee, debutChaine.mois) < 0) {
        debutChaine = { annee: cible.annee, mois: cible.mois };
      }

      var total = nbMoisEntre(debutChaine.annee, debutChaine.mois, cible.annee, cible.mois);
      var tronquee = false;
      if (total > MAX_MOIS) { total = MAX_MOIS; tronquee = true; }

      var avantDepart = cmpMois(debutChaine.annee, debutChaine.mois, depart.annee, depart.mois) < 0;
      var compteur = avantDepart ? zero : compteurInitial;

      return Promise.all([
        chargerJournees(DB, contrat.id, premierJour(debutChaine.annee, debutChaine.mois), dernierJour(cible.annee, cible.mois)),
        chargerRecaps(DB, contrat.id, debutChaine.annee, cible.annee)
      ]).then(function (charge) {
        var journeesParMois = charge[0] || {};
        var recapsParMois = charge[1];

        var entrees = [];
        var cur = { annee: debutChaine.annee, mois: debutChaine.mois };
        var seq = Promise.resolve();

        for (var i = 0; i < total; i++) {
          (function (mm, rang) {
            seq = seq.then(function () {
              var cle = cleMois(mm.annee, mm.mois);
              var lireRecap = recapsParMois
                ? Promise.resolve(recapsParMois[cle] || null)
                : DB.getRecap(contrat.id, mm.annee, mm.mois);

              return lireRecap.then(function (recap) {
                /* Au mois de la reprise manuelle, le compteur saisi reprend
                   la main sur tout cumul antérieur. */
                if (cmpMois(mm.annee, mm.mois, depart.annee, depart.mois) === 0) {
                  compteur = compteurInitial;
                }
                var avant = cmpMois(mm.annee, mm.mois, depart.annee, depart.mois) < 0;
                var compteurEntree = compteur;
                var salaire = Engine.salaireApplicable(salaires, mm.annee, mm.mois);
                var entree;

                if (recap && recap.statut === 'fige' && recap.donnees) {
                  /* Mois figé : instantané tel quel, aucun recalcul. Son
                     compteur d'entrée est celui du document lui-même. */
                  var d = recap.donnees;
                  compteur = d.compteurSortie || compteur;
                  entree = {
                    annee: mm.annee, mois: mm.mois, cle: cle,
                    resultat: d, fige: true, recap: recap,
                    salaire: salaire, salaireManquant: false,
                    avantInitialisation: avant,
                    compteurEntree: compteurEntreeDe(d, compteurEntree),
                    compteurSortie: compteur
                  };
                } else {
                  /* Correction B1 du lot 4, conservée : un mois sans barème
                     connu n'est PAS sauté — les heures sup, les congés et les
                     CP s'y accumulent quand même. On calcule avec un barème
                     nul (seule la retenue monétaire en dépend) et on signale
                     l'absence à l'écran. */
                  var salaireCalcul = salaire || { brut_mensuel_centimes: 0, net_mensuel_centimes: 0 };
                  var parJour = journeesParMois[cle] || {};
                  var journees = Object.keys(parJour).map(function (k) { return parJour[k]; });
                  var r = Engine.calculerMois({
                    contrat: contrat, salaire: salaireCalcul, journees: journees,
                    compteurEntree: compteurEntree, annee: mm.annee, mois: mm.mois
                  });
                  compteur = r.compteurSortie;
                  entree = {
                    annee: mm.annee, mois: mm.mois, cle: cle,
                    resultat: r, fige: false, recap: recap || null,
                    salaire: salaire, salaireManquant: !salaire,
                    avantInitialisation: avant,
                    compteurEntree: compteurEntree, compteurSortie: compteur
                  };
                }

                entrees.push(entree);
                if (typeof opts.onProgress === 'function') opts.onProgress(rang + 1, total);
              });
            });
          })(cur, i);
          cur = moisSuivant(cur.annee, cur.mois);
        }

        return seq.then(function () {
          return {
            mois: entrees,
            depart: depart,
            debutChaine: debutChaine,
            tronquee: tronquee,
            avantInitialisation: avantDepart
          };
        });
      });
    });
  }

  /* Un seul mois : la chaîne complète, dont on ne garde que le dernier
     maillon. C'est ce que fait l'écran mensuel. */
  function mois1(contrat, annee, moisNum, opts) {
    return serie(contrat, { annee: annee, mois: moisNum }, opts).then(function (s) {
      var dernier = s.mois[s.mois.length - 1];
      if (!dernier || dernier.annee !== annee || dernier.mois !== moisNum) return null;
      return dernier;
    });
  }

  /* Extrait la fenêtre [debut..fin] d'une chaîne complète. */
  function fenetre(s, debut, fin) {
    return (s.mois || []).filter(function (e) {
      return cmpMois(e.annee, e.mois, debut.annee, debut.mois) >= 0 &&
             cmpMois(e.annee, e.mois, fin.annee, fin.mois) <= 0;
    });
  }

  /* ------------------------------------------------------------------ */
  /* Agrégation d'une période (lot 5 C6)                                 */
  /* ------------------------------------------------------------------ */

  /* Somme des GRANDEURS DE FLUX d'une liste de mois, et RIEN d'autre.

     Ce qui s'additionne : jours de présence, entretien, heures sup acquises,
     congés décomptés et leur répartition, retenues sans solde, salaires,
     total versé, congés payés acquis.

     Ce qui ne s'additionne JAMAIS : les COMPTEURS. Le solde d'heures sup et
     de congés payés à la fin de la période est celui du DERNIER mois, pas la
     somme des soldes mensuels — additionner douze soldes de fin de mois
     produirait un nombre dépourvu de sens, et crédible. On expose donc le
     compteur d'ENTRÉE du premier mois et le compteur de SORTIE du dernier.

     Fonction pure : aucun accès réseau, aucun DOM. Testable sous Node. */
  function agregerPeriode(entrees) {
    var liste = (entrees || []).filter(function (e) { return e && e.resultat; });
    var somme = {
      nbMois: liste.length,
      joursPresence: 0,
      entretienCentimes: 0,
      minutesSupAcquises: 0,
      joursCongesDecomptes: 0,
      imputation: {
        joursSurCp: 0, joursSurSup: 0, joursSansSolde: 0,
        minutesSupConsommees: 0, dixiemesCpConsommes: 0
      },
      retenueSansSoldeCentimes: 0,
      dixiemesCpAcquis: 0,
      salaireBrutCentimes: 0,
      salaireNetCentimes: 0,
      totalAVerserCentimes: 0,
      compteurEntree: null,
      compteurSortie: null,
      moisProvisoires: [],
      moisFiges: [],
      moisAvantInitialisation: [],
      baremes: []
    };
    if (!liste.length) return somme;

    var baremesParCle = {};

    liste.forEach(function (e) {
      var r = e.resultat;
      var imp = r.imputation || {};
      somme.joursPresence += r.joursPresence || 0;
      somme.entretienCentimes += r.entretienCentimes || 0;
      somme.minutesSupAcquises += r.minutesSupAcquises || 0;
      somme.joursCongesDecomptes += r.joursCongesDecomptes || 0;
      somme.imputation.joursSurCp += imp.joursSurCp || 0;
      somme.imputation.joursSurSup += imp.joursSurSup || 0;
      somme.imputation.joursSansSolde += imp.joursSansSolde || 0;
      somme.imputation.minutesSupConsommees += imp.minutesSupConsommees || 0;
      somme.imputation.dixiemesCpConsommes += imp.dixiemesCpConsommes || 0;
      somme.retenueSansSoldeCentimes += r.retenueSansSoldeCentimes || 0;
      somme.dixiemesCpAcquis += r.dixiemesCpAcquis || 0;
      somme.salaireBrutCentimes += r.salaireBrutCentimes || 0;
      somme.salaireNetCentimes += r.salaireNetCentimes || 0;
      somme.totalAVerserCentimes += r.totalAVerserCentimes || 0;

      if (e.fige) somme.moisFiges.push({ annee: e.annee, mois: e.mois });
      else somme.moisProvisoires.push({ annee: e.annee, mois: e.mois });
      if (e.avantInitialisation) somme.moisAvantInitialisation.push({ annee: e.annee, mois: e.mois });

      /* Barèmes appliqués sur la période. Pour un mois figé, on lit d'abord la
         date d'effet inscrite dans l'instantané (ajoutée au lot 5) ; à défaut
         — instantanés d'avant le lot 5 — on retombe sur le barème applicable
         calculé par le moteur. */
      var dateEffet = (r.salaireDateEffet != null)
        ? r.salaireDateEffet
        : (e.salaire ? e.salaire.date_effet : null);
      var cle = dateEffet + '|' + (r.salaireBrutCentimes || 0) + '|' + (r.salaireNetCentimes || 0);
      if (!baremesParCle[cle]) {
        baremesParCle[cle] = {
          dateEffet: dateEffet,
          brutMensuelCentimes: r.salaireBrutCentimes || 0,
          netMensuelCentimes: r.salaireNetCentimes || 0,
          mois: []
        };
        somme.baremes.push(baremesParCle[cle]);
      }
      baremesParCle[cle].mois.push({ annee: e.annee, mois: e.mois });
    });

    somme.compteurEntree = liste[0].compteurEntree || null;
    somme.compteurSortie = liste[liste.length - 1].compteurSortie || null;
    return somme;
  }

  /* ------------------------------------------------------------------ */

  var api = {
    serie: serie,
    mois1: mois1,
    fenetre: fenetre,
    agregerPeriode: agregerPeriode,
    /* calendrier, partagé par les écrans */
    nbJoursDansMois: nbJoursDansMois,
    premierJour: premierJour,
    dernierJour: dernierJour,
    moisSuivant: moisSuivant,
    moisPrecedent: moisPrecedent,
    cmpMois: cmpMois,
    moisDeDate: moisDeDate,
    cleMois: cleMois,
    nbMoisEntre: nbMoisEntre,
    libelleMois: libelleMois,
    libelleMoisAnnee: libelleMoisAnnee,
    MAX_MOIS: MAX_MOIS
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.ChaineMois = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
