/* ============================================================================
   engine.js — Moteur de calcul de l'application « Récap Maria ».

   Module PUR (§1 des specs) : aucun accès au DOM, aucun appel réseau,
   aucune lecture d'horloge système. Entrées -> sorties, exécutable sous Node.

   Unités (§1) : temps en minutes entières, argent en centimes entiers,
   congés payés en dixièmes de jour entiers. Aucun float dans les calculs —
   seule exception sanctionnée par les specs : le paramètre `coefficient`
   de montantCentimes (majoration 1.5 de RG-13), avec UN SEUL arrondi final.

   Dates : chaînes 'YYYY-MM-DD' (date pure), arithmétique via Date.UTC
   uniquement, jamais de fuseau.

   Règles métier : cahier des charges consolidé, RG-01 à RG-15.
   ========================================================================= */
(function (global) {
  'use strict';

  var Feries = (typeof module !== 'undefined' && module.exports)
    ? require('./feries.js')
    : global.Feries;

  /* Base mensualisée : 195 h/mois = 11700 minutes (§3 du cahier des charges). */
  var MINUTES_BASE_MENSUELLE = 195 * 60;

  /* Planning par défaut : lundi -> vendredi (1 = lundi … 7 = dimanche). */
  var PLANNING_DEFAUT = [1, 2, 3, 4, 5];

  /* Acquisition de congés payés : 2,5 jours ouvrables = 25 dixièmes par mois
     entièrement travaillé (RG-11). */
  var DIXIEMES_CP_PAR_MOIS = 25;

  /* ------------------------------------------------------------------ */
  /* Utilitaires de calendrier (purs, sans fuseau)                       */
  /* ------------------------------------------------------------------ */

  /* Jour de la semaine d'une date pure : 1 = lundi … 7 = dimanche. */
  function jourSemaine(dateStr) {
    var p = dateStr.split('-');
    var dow = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]))).getUTCDay();
    return dow === 0 ? 7 : dow;
  }

  function estBissextile(annee) {
    return (annee % 4 === 0 && annee % 100 !== 0) || annee % 400 === 0;
  }

  function nbJoursDansMois(annee, mois) {
    var longueurs = [31, estBissextile(annee) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return longueurs[mois - 1];
  }

  /* Toutes les dates d'un mois, triées, au format YYYY-MM-DD. */
  function joursDuMois(annee, mois) {
    var n = nbJoursDansMois(annee, mois);
    var prefixe = annee + '-' + String(mois).padStart(2, '0') + '-';
    var jours = [];
    for (var j = 1; j <= n; j++) jours.push(prefixe + String(j).padStart(2, '0'));
    return jours;
  }

  /* ------------------------------------------------------------------ */
  /* Fonctions exposées (§4.2 des specs)                                 */
  /* ------------------------------------------------------------------ */

  function joursFeriesFrance(annee) { return Feries.joursFeriesFrance(annee); }
  function estJourFerie(dateStr) { return Feries.estJourFerie(dateStr); }

  /* RG-06 — Décompte d'une période de congé en jours ouvrables.
     `debutStr` : premier jour d'absence posé ; `finStr` : dernier jour
     d'absence posé. Le décompte court du premier jour d'absence au dernier
     jour ouvrable précédant la reprise (reprise = premier jour travaillé —
     jour du planning, non férié — strictement après `finStr`), en EXCLUANT
     les dimanches et les jours fériés, en INCLUANT les samedis.
     Une semaine complète lundi -> vendredi, reprise le lundi = 6.
     Lundi -> mercredi, reprise le jeudi = 3. Un jour isolé = 1. */
  function decompterJoursOuvrables(debutStr, finStr, joursPlanning) {
    var planning = joursPlanning || PLANNING_DEFAUT;
    if (finStr < debutStr) throw new Error('decompterJoursOuvrables : fin < debut');

    var reprise = Feries.ajouterJours(finStr, 1);
    while (planning.indexOf(jourSemaine(reprise)) === -1 || Feries.estJourFerie(reprise)) {
      reprise = Feries.ajouterJours(reprise, 1);
    }

    var n = 0;
    for (var d = debutStr; d < reprise; d = Feries.ajouterJours(d, 1)) {
      if (jourSemaine(d) === 7) continue;      // dimanche exclu
      if (Feries.estJourFerie(d)) continue;    // férié exclu
      n++;                                     // samedi inclus
    }
    return n;
  }

  /* RG-05 / RG-07 — Impute `nbJours` de congé sur les compteurs.
     `compteur` : { minutesSup, dixiemesCp } — quantités DISPONIBLES.
     Un jour de congé consomme `contrat.minutes_par_jour_conge` minutes
     entières ; un reliquat strictement inférieur RESTE au compteur, il ne
     couvre jamais un jour partiel. Même principe pour les congés payés :
     un jour consomme 10 dixièmes, un reliquat < 10 dixièmes reste acquis.
     L'ordre suit contrat.ordre_imputation ('cp_puis_sup' par défaut, RG-07).
     Le débordement final part en sans solde. */
  function imputerConges(nbJours, compteur, contrat) {
    var minutesParJour = contrat.minutes_par_jour_conge;
    var restant = nbJours;
    var resultat = {
      joursSurSup: 0, minutesSupConsommees: 0,
      joursSurCp: 0, dixiemesCpConsommes: 0,
      joursSansSolde: 0
    };

    function prendreSurCp() {
      var joursDispo = Math.floor(((compteur && compteur.dixiemesCp) || 0) / 10);
      var pris = Math.min(restant, joursDispo);
      resultat.joursSurCp = pris;
      resultat.dixiemesCpConsommes = pris * 10;
      restant -= pris;
    }

    function prendreSurSup() {
      var joursDispo = Math.floor(((compteur && compteur.minutesSup) || 0) / minutesParJour);
      var pris = Math.min(restant, joursDispo);
      resultat.joursSurSup = pris;
      resultat.minutesSupConsommees = pris * minutesParJour;
      restant -= pris;
    }

    if (contrat.ordre_imputation === 'sup_puis_cp') {
      prendreSurSup();
      prendreSurCp();
    } else {                       // 'cp_puis_sup' — défaut RG-07
      prendreSurCp();
      prendreSurSup();
    }

    resultat.joursSansSolde = restant;
    return resultat;
  }

  /* Montant en centimes correspondant à `minutes` de travail au taux du
     contrat : brut mensuel / (195 h × 60). UN SEUL arrondi, appliqué à la
     toute fin — ne jamais arrondir un résultat intermédiaire (§4.2). */
  function montantCentimes(brutMensuelCentimes, minutes, coefficient) {
    if (coefficient === undefined) coefficient = 1;
    return Math.round(brutMensuelCentimes * minutes * coefficient / MINUTES_BASE_MENSUELLE);
  }

  /* RG-15 — Salaire applicable à un mois : l'entrée d'historique dont la
     date_effet est la plus récente ANTÉRIEURE OU ÉGALE au premier jour du
     mois. Retourne null si aucune n'est applicable. NB : cette sélection est
     faite par l'appelant (db.js) avant calculerMois ; un récap figé n'est
     jamais recalculé (protection assurée en base par le trigger du lot 2). */
  function salaireApplicable(historique, annee, mois) {
    var premierJour = annee + '-' + String(mois).padStart(2, '0') + '-01';
    var retenu = null;
    for (var i = 0; i < (historique || []).length; i++) {
      var s = historique[i];
      if (s.date_effet <= premierJour && (retenu === null || s.date_effet > retenu.date_effet)) {
        retenu = s;
      }
    }
    return retenu;
  }

  /* ------------------------------------------------------------------ */
  /* Calcul d'un mois complet                                            */
  /* ------------------------------------------------------------------ */

  /* Regroupe des jours de congé (triés) en périodes continues : deux jours
     appartiennent à la même période s'il n'existe aucun jour travaillé
     (jour du planning, non férié) strictement entre les deux — un week-end
     ou un férié n'interrompt pas une période. */
  function grouperPeriodesConge(joursConge, planning) {
    var tries = joursConge.slice().sort();
    var periodes = [];
    for (var i = 0; i < tries.length; i++) {
      var d = tries[i];
      var derniere = periodes[periodes.length - 1];
      if (derniere && !jourTravailleEntre(derniere.fin, d, planning)) {
        derniere.fin = d;
      } else {
        periodes.push({ debut: d, fin: d });
      }
    }
    return periodes;
  }

  function jourTravailleEntre(aStr, bStr, planning) {
    for (var d = Feries.ajouterJours(aStr, 1); d < bStr; d = Feries.ajouterJours(d, 1)) {
      if (planning.indexOf(jourSemaine(d)) !== -1 && !Feries.estJourFerie(d)) return true;
    }
    return false;
  }

  /* Le contrat couvre-t-il le mois entier ? (utile pour RG-11) */
  function contratCouvreLeMois(contrat, annee, mois) {
    var premier = annee + '-' + String(mois).padStart(2, '0') + '-01';
    var dernier = annee + '-' + String(mois).padStart(2, '0') + '-' +
      String(nbJoursDansMois(annee, mois)).padStart(2, '0');
    if (contrat.date_debut && contrat.date_debut > premier) return false;
    if (contrat.date_fin && contrat.date_fin < dernier) return false;
    return true;
  }

  /* Calcule le récapitulatif d'un mois pour un contrat.

     Entrées :
       contrat        : ligne de la table contrat (noms de colonnes SQL)
       salaire        : { brut_mensuel_centimes, net_mensuel_centimes }
                        — déjà sélectionné selon RG-15 (cf. salaireApplicable)
       journees       : lignes de la table journee du mois (les EXCEPTIONS ;
                        tout jour du planning sans ligne est présumé
                        'presence', ou 'ferie' si le calendrier le dit)
       compteurEntree : { minutesSup, dixiemesCpAcquis, dixiemesCpPris }
       annee, mois    : mois calculé

     Sortie : ResultatMois (§4.3 des specs). */
  function calculerMois(entrees) {
    var contrat = entrees.contrat;
    var salaire = entrees.salaire;
    var journees = entrees.journees || [];
    var annee = entrees.annee;
    var mois = entrees.mois;
    var planning = contrat.jours_planning || PLANNING_DEFAUT;

    var compteurEntree = entrees.compteurEntree || {};
    var entreeMinutesSup = compteurEntree.minutesSup || 0;
    var entreeCpAcquis = compteurEntree.dixiemesCpAcquis || 0;
    var entreeCpPris = compteurEntree.dixiemesCpPris || 0;

    var parJour = {};
    for (var i = 0; i < journees.length; i++) parJour[journees[i].jour] = journees[i];

    var joursPresence = 0;
    var entretienCentimes = 0;
    var joursGenerantSup = 0;        // RG-03 : jours du planning où Maria travaille
    var joursConge = [];             // jours 'conge_maria' posés dans le mois
    var joursSansSoldeSaisis = 0;    // lignes 'sans_solde' saisies explicitement
    var joursFamiliarisation = 0;

    var jours = joursDuMois(annee, mois);
    for (var j = 0; j < jours.length; j++) {
      var d = jours[j];
      if (planning.indexOf(jourSemaine(d)) === -1) continue;   // hors planning

      var ligne = parJour[d];
      /* Saisie par exception (§5) : sans ligne, un jour du planning est
         présumé 'presence' — sauf s'il est férié (RG-10 : Maria ne
         travaille jamais un jour férié). Une ligne explicite prime. */
      var type = ligne ? ligne.type : (Feries.estJourFerie(d) ? 'ferie' : 'presence');

      switch (type) {
        case 'presence':
          /* RG-01 : jour de présence acquis dès 1 h de garde, pas de
             demi-journée. RG-02 : indemnité par jour de présence (surcharge
             manuelle possible via journee.entretien_centimes, cf. RG-14). */
          joursPresence++;
          entretienCentimes += (ligne && Number.isInteger(ligne.entretien_centimes))
            ? ligne.entretien_centimes
            : contrat.entretien_centimes_jour;
          joursGenerantSup++;
          break;

        case 'absence_enfant':
          /* RG-09 : salaire dû, pas d'indemnité d'entretien ; les minutes
             supplémentaires restent dues, sauf si le paramètre du contrat
             dit le contraire (règle en réflexion chez Maria, §8 specs). */
          if (contrat.sup_dues_si_enfant_absent !== false) joursGenerantSup++;
          break;

        case 'ferie':
          /* RG-10 : chômé et payé, ni minutes sup ni entretien. */
          break;

        case 'conge_maria':
          /* Décompte RG-06 et imputation RG-07 traités plus bas, par période. */
          joursConge.push(d);
          break;

        case 'sans_solde':
          /* Jour sans solde saisi directement (hors imputation de congé).
             TODO RÈGLE ABSENTE : le cahier des charges ne dit pas si un jour
             'sans_solde' saisi à la main doit être étendu en jours ouvrables
             comme un congé (RG-06). Comportement prudent retenu : il compte
             pour exactement 1 jour de retenue, tel que saisi. */
          joursSansSoldeSaisis++;
          break;

        case 'familiarisation':
          /* RG-14 : rémunération au réel, à l'heure, hors mensualisation ;
             pas de minutes sup automatiques ; entretien saisi manuellement.
             TODO RÈGLE ABSENTE : la rémunération des heures réelles de
             familiarisation (minutes_reelles × taux horaire) n'est PAS
             intégrée à ResultatMois — le cahier des charges (§6) la range
             en saisie manuelle, hors mensualisation, et ResultatMois n'a
             pas de champ pour la porter. À trancher avant le lot 4. */
          joursFamiliarisation++;
          if (ligne && Number.isInteger(ligne.entretien_centimes)) {
            entretienCentimes += ligne.entretien_centimes;
          }
          break;

        case 'hors_planning':
          /* Jour marqué hors planning : neutre. */
          break;

        default:
          throw new Error('calculerMois : type de journée inconnu « ' + type + ' » le ' + d);
      }
    }

    /* RG-03 / RG-04 : minutes supplémentaires du mois. `minutes_sup_jour`
       est un paramètre du contrat (30 aujourd'hui, peut-être 0 demain —
       question ouverte du §7 du cahier des charges) : aucun code à changer. */
    var minutesSupAcquises = joursGenerantSup * contrat.minutes_sup_jour;

    /* RG-06 : décompte des congés en jours ouvrables, période par période.
       NB : une période à cheval sur deux mois est décomptée mois par mois
       sur les jours visibles de chaque mois (limitation signalée dans la
       restitution du lot 1). */
    var joursCongesDecomptes = 0;
    var periodes = grouperPeriodesConge(joursConge, planning);
    for (var pIdx = 0; pIdx < periodes.length; pIdx++) {
      joursCongesDecomptes += decompterJoursOuvrables(periodes[pIdx].debut, periodes[pIdx].fin, planning);
    }

    /* RG-05 / RG-07 : imputation sur les compteurs disponibles. */
    var imputation = imputerConges(joursCongesDecomptes, {
      minutesSup: entreeMinutesSup,
      dixiemesCp: entreeCpAcquis - entreeCpPris
    }, contrat);

    /* RG-08 : retenue = minutes_par_jour_conge × taux horaire brut par jour
       sans solde. Un seul arrondi sur le total (§4.2). */
    var joursSansSoldeTotal = imputation.joursSansSolde + joursSansSoldeSaisis;
    var retenueSansSoldeCentimes = joursSansSoldeTotal === 0 ? 0 :
      montantCentimes(salaire.brut_mensuel_centimes, joursSansSoldeTotal * contrat.minutes_par_jour_conge);

    /* RG-11 : 25 dixièmes par mois ENTIÈREMENT travaillé. Lecture retenue,
       alignée sur les cas T4 et T5 du cahier des charges (compteur CP à 0
       en sortie malgré l'acquisition théorique) : un mois contenant un
       congé de Maria, un jour sans solde ou de la familiarisation, ou que
       le contrat ne couvre pas en entier, n'acquiert rien.
       TODO RÈGLE ABSENTE : le cahier ne définit pas « mois entièrement
       travaillé » ; en droit, les congés payés sont normalement assimilés à
       du travail effectif pour l'acquisition. Divergence signalée dans la
       restitution. Le plafond de 30 jours par exercice (RG-11) n'est pas
       contrôlable ici (le moteur ne voit pas l'exercice) : à porter par la
       couche d'appel. */
    var moisEntierementTravaille =
      joursConge.length === 0 &&
      joursSansSoldeTotal === 0 &&
      joursFamiliarisation === 0 &&
      contratCouvreLeMois(contrat, annee, mois);
    var dixiemesCpAcquis = moisEntierementTravaille ? DIXIEMES_CP_PAR_MOIS : 0;

    /* RG-12 / RG-12bis : aucun compteur ne se remet à zéro — les compteurs
       de sortie sont de simples cumuls, sans aucune clôture au 31 août. */
    var compteurSortie = {
      minutesSup: entreeMinutesSup + minutesSupAcquises - imputation.minutesSupConsommees,
      dixiemesCpAcquis: entreeCpAcquis + dixiemesCpAcquis,
      dixiemesCpPris: entreeCpPris + imputation.dixiemesCpConsommes
    };

    return {
      joursPresence: joursPresence,
      entretienCentimes: entretienCentimes,
      minutesSupAcquises: minutesSupAcquises,
      joursCongesDecomptes: joursCongesDecomptes,
      imputation: imputation,
      retenueSansSoldeCentimes: retenueSansSoldeCentimes,
      dixiemesCpAcquis: dixiemesCpAcquis,
      compteurSortie: compteurSortie,
      salaireBrutCentimes: salaire.brut_mensuel_centimes,
      salaireNetCentimes: salaire.net_mensuel_centimes,
      /* §5.8 du cahier : net du mois + entretien − retenue. NB : la retenue
         RG-08 est exprimée en brut (« convention à valider » dans le cahier),
         soustraite ici d'un total à base nette — hétérogénéité signalée. */
      totalAVerserCentimes: salaire.net_mensuel_centimes + entretienCentimes - retenueSansSoldeCentimes
    };
  }

  /* ------------------------------------------------------------------ */

  var api = {
    joursFeriesFrance: joursFeriesFrance,
    estJourFerie: estJourFerie,
    decompterJoursOuvrables: decompterJoursOuvrables,
    imputerConges: imputerConges,
    montantCentimes: montantCentimes,
    salaireApplicable: salaireApplicable,
    calculerMois: calculerMois,
    /* utilitaires exposés pour les tests et l'interface */
    jourSemaine: jourSemaine,
    joursDuMois: joursDuMois
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.Engine = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
