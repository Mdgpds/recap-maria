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
    var tranches = joursOuvrablesParMois(debutStr, finStr, joursPlanning);
    var n = 0;
    for (var i = 0; i < tranches.length; i++) n += tranches[i].jours;
    return n;
  }

  /* Même décompte que ci-dessus, mais VENTILÉ par mois calendaire, dans
     l'ordre chronologique : [{ cle: 'YYYY-MM', jours: n }, …].
     La somme des tranches vaut exactement decompterJoursOuvrables — c'est la
     même boucle. Sert au lot 9 pour répartir l'imputation d'une période à
     cheval sur deux mois, sans jamais recalculer le décompte RG-06 mois par
     mois (ce qui donnerait un résultat faux : une semaine coupée par un
     changement de mois ne se redécompte pas).

     Un jour compté APRÈS le dernier jour d'absence posé — l'extension RG-06
     jusqu'à la veille de la reprise, typiquement le samedi — est rattaché au
     mois du DERNIER JOUR POSÉ, et non à son propre mois. Sans cela, une
     semaine de congé du lundi 27 au vendredi 31 juillet laisserait son
     sixième jour (samedi 1er août) dans un mois d'août où aucune journée de
     congé n'est posée : ce jour ne serait imputé nulle part, et la semaine
     de Maria ne compterait plus que 5 jours au lieu de 6. C'est exactement
     le litige historique avec les familles. */
  function joursOuvrablesParMois(debutStr, finStr, joursPlanning) {
    var planning = joursPlanning || PLANNING_DEFAUT;
    if (finStr < debutStr) throw new Error('decompterJoursOuvrables : fin < debut');

    var reprise = Feries.ajouterJours(finStr, 1);
    while (planning.indexOf(jourSemaine(reprise)) === -1 || Feries.estJourFerie(reprise)) {
      reprise = Feries.ajouterJours(reprise, 1);
    }
    var moisDeFin = finStr.slice(0, 7);

    var tranches = [];
    for (var d = debutStr; d < reprise; d = Feries.ajouterJours(d, 1)) {
      if (jourSemaine(d) === 7) continue;      // dimanche exclu
      if (Feries.estJourFerie(d)) continue;    // férié exclu
      var cle = (d <= finStr) ? d.slice(0, 7) : moisDeFin;   // samedi inclus
      var derniere = tranches[tranches.length - 1];
      if (derniere && derniere.cle === cle) derniere.jours++;
      else tranches.push({ cle: cle, jours: 1 });
    }
    return tranches;
  }

  /* Erreur porteuse d'un CODE, jamais d'une phrase : la traduction en
     français appartient à js/messages.js. Le moteur ne produit jamais de
     texte destiné à l'écran (§5.2 de la spec du lot 9). */
  function erreurCode(code) {
    var e = new Error(code);
    e.code = code;
    return e;
  }

  /* RG-05 / RG-07 — Impute `nbJours` de congé sur les compteurs.
     `compteur` : { minutesSup, dixiemesCp } — quantités DISPONIBLES.
     Un jour de congé consomme `contrat.minutes_par_jour_conge` minutes
     entières ; un reliquat strictement inférieur RESTE au compteur, il ne
     couvre jamais un jour partiel. Même principe pour les congés payés :
     un jour consomme 10 dixièmes, un reliquat < 10 dixièmes reste acquis.
     L'ordre suit contrat.ordre_imputation ('cp_puis_sup' par défaut, RG-07).
     Le débordement final part en sans solde.

     LOT 9 — `imputationImposee` (4e paramètre, OPTIONNEL) :
       - absent ou null : comportement ci-dessus, strictement inchangé. RG-07
         reste la valeur par défaut PROPOSÉE.
       - présent : { joursSurCp, joursSurSup, joursSansSolde }. Le moteur
         APPLIQUE cette répartition sans la recalculer, après trois
         vérifications qui lèvent un CODE d'erreur et n'écrivent rien. */
  function imputerConges(nbJours, compteur, contrat, imputationImposee) {
    var minutesParJour = contrat.minutes_par_jour_conge;
    var restant = nbJours;

    if (imputationImposee != null) {
      var impCp = imputationImposee.joursSurCp || 0;
      var impSup = imputationImposee.joursSurSup || 0;
      var impSansSolde = imputationImposee.joursSansSolde || 0;

      /* 1. La ventilation couvre exactement le décompte de la période. */
      if (impCp + impSup + impSansSolde !== nbJours) {
        throw erreurCode('IMPUTATION_INCOMPLETE');
      }
      /* 2. Aucune valeur négative. */
      if (impCp < 0 || impSup < 0 || impSansSolde < 0) {
        throw erreurCode('IMPUTATION_NEGATIVE');
      }
      /* 3. La répartition ne consomme pas plus que le disponible. Le
         disponible peut être négatif (compteur incohérent, reprise manuelle
         erronée) : dans ce cas toute consommation est refusée. */
      var dispoCp = (compteur && compteur.dixiemesCp) || 0;
      var dispoSup = (compteur && compteur.minutesSup) || 0;
      if (impCp * 10 > dispoCp || impSup * minutesParJour > dispoSup) {
        throw erreurCode('IMPUTATION_DEPASSE_RESERVES');
      }

      return {
        joursSurSup: impSup, minutesSupConsommees: impSup * minutesParJour,
        joursSurCp: impCp, dixiemesCpConsommes: impCp * 10,
        joursSansSolde: impSansSolde
      };
    }

    var resultat = {
      joursSurSup: 0, minutesSupConsommees: 0,
      joursSurCp: 0, dixiemesCpConsommes: 0,
      joursSansSolde: 0
    };

    function prendreSurCp() {
      /* Correction B1 (relecture lot 1) : on ne consomme que du disponible.
         Un compteur incohérent (pris > acquis, saisie d'initialisation
         erronée) donne un disponible négatif : il est borné à 0 et ne
         « rend » jamais des jours. */
      var joursDispo = Math.max(0, Math.floor(((compteur && compteur.dixiemesCp) || 0) / 10));
      var pris = Math.min(restant, joursDispo);
      resultat.joursSurCp = pris;
      resultat.dixiemesCpConsommes = pris * 10;
      restant -= pris;
    }

    function prendreSurSup() {
      /* Correction B1 : même borne à 0 qu'au-dessus (RG-05/RG-07). */
      var joursDispo = Math.max(0, Math.floor(((compteur && compteur.minutesSup) || 0) / minutesParJour));
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

  /* ------------------------------------------------------------------ */
  /* Minutes supplémentaires d'une journée (lot 9 — V8-18, V8-19)        */
  /* ------------------------------------------------------------------ */

  /* Types de journée qui ne génèrent JAMAIS de minutes supplémentaires
     (RG-04). Une journée sans travail ne génère rien, y compris si des
     minutes exceptionnelles y ont été saisies par erreur. */
  var TYPES_SANS_MINUTES = ['ferie', 'conge_maria', 'sans_solde',
                            'familiarisation', 'hors_planning'];

  function entierPositif(v) {
    return (typeof v === 'number' && isFinite(v)) ? Math.max(0, Math.trunc(v)) : 0;
  }

  /* Détail des minutes supplémentaires d'UNE journée, dans l'ordre exact du
     §5.1 de la spec du lot 9. Retourne les trois composantes séparément :
     c'est ce détail que le récapitulatif du mois affiche, et c'est lui qui garantit
     l'invariant acquises = base + ajoutées − renoncées. */
  function detailSupDuJour(journee, contrat) {
    var type = journee && journee.type;

    /* 1. RG-04 — rien, quoi qu'il ait été saisi. */
    if (TYPES_SANS_MINUTES.indexOf(type) !== -1) {
      return { base: 0, ajoutees: 0, renoncees: 0 };
    }

    /* 2. Ce que le contrat prévoit. */
    var base = contrat.minutes_sup_jour;

    /* 3. RG-09, surchargeable au jour le jour (V8-19). `sup_dues_override`
       vaut null quand la journée dit « suivre le réglage du contrat » : null
       et false sont DEUX valeurs différentes, d'où le test `!= null` et non
       un test de vérité. Le réglage du contrat n'est jamais modifié.
       NB : on ne neutralise la base que sur un `false` explicite, exactement
       comme avant le lot 9 (`sup_dues_si_enfant_absent !== false`), pour
       qu'un contrat dont le paramètre n'est pas renseigné continue de devoir
       les minutes. */
    if (type === 'absence_enfant') {
      var dues = (journee.sup_dues_override != null)
        ? journee.sup_dues_override
        : contrat.sup_dues_si_enfant_absent;
      if (dues === false) base = 0;
    }

    /* 4. Minutes travaillées au-delà du contrat ce jour-là (V8-18). */
    var ajoutees = entierPositif(journee && journee.minutes_sup_exceptionnelles);

    /* 5. Renoncement explicite (V8-18), BORNÉ : on ne peut pas renoncer à
       plus que ce qui est dû. Sans ce plancher, un renoncement ferait
       AUGMENTER le compteur — le Math.min n'est pas une élégance, c'est la
       garde. Le surplus est ignoré, jamais négatif. */
    var renoncees = Math.min(
      entierPositif(journee && journee.minutes_sup_renoncees),
      base + ajoutees
    );

    return { base: base, ajoutees: ajoutees, renoncees: renoncees };
  }

  /* Minutes supplémentaires nettes d'une journée (§5.1). */
  function minutesSupDuJour(journee, contrat) {
    var d = detailSupDuJour(journee, contrat);
    return d.base + d.ajoutees - d.renoncees;
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

  /* ------------------------------------------------------------------ */
  /* Imputation imposée : répartition d'une période sur ses mois (lot 9)  */
  /* ------------------------------------------------------------------ */

  /* Répartit `n` jours entre les trois destinations (congés payés,
     récupération, sans solde) au prorata de ce qui RESTE à répartir dans
     chacune. Arithmétique entière de bout en bout : on prend la part entière,
     puis on attribue le reliquat aux destinations dont la fraction perdue est
     la plus grande. Aucun jour n'est ni perdu ni inventé.
     `restants` : [cp, sup, sansSolde] — modifié par l'appelant, pas ici. */
  function repartirEntreDestinations(n, restants) {
    var part = [0, 0, 0];
    var restePool = restants[0] + restants[1] + restants[2];
    if (n <= 0 || restePool <= 0) return part;

    var fractions = [];
    var somme = 0;
    for (var c = 0; c < 3; c++) {
      var ideal = restants[c] * n / restePool;
      var entier = Math.min(restants[c], Math.floor(ideal));
      part[c] = entier;
      somme += entier;
      fractions.push({ destination: c, reste: ideal - Math.floor(ideal) });
    }
    /* Ordre déterministe : plus grande fraction perdue d'abord, puis l'ordre
       congés payés -> récupération -> sans solde (RG-07). */
    fractions.sort(function (a, b) {
      return (b.reste - a.reste) || (a.destination - b.destination);
    });
    var i = 0;
    while (somme < n && i < 3 * (n + 3)) {
      var d = fractions[i % 3].destination;
      if (part[d] < restants[d]) { part[d]++; somme++; }
      i++;
    }
    return part;
  }

  /* Découpe une imputation posée sur une période en une part par mois
     calendaire touché, au prorata des jours ouvrables de la période tombant
     dans chaque mois (§5.3 et piège n° 4 de la spec du lot 9).
     La SOMME des parts égale EXACTEMENT l'imputation posée : aucune perte
     d'arrondi, quel que soit le nombre de mois. */
  function repartirImputationParMois(imputation, planning) {
    var tranches = joursOuvrablesParMois(imputation.date_debut, imputation.date_fin, planning);
    var poidsTotal = 0;
    for (var t = 0; t < tranches.length; t++) poidsTotal += tranches[t].jours;

    var restants = [
      imputation.jours_sur_cp || 0,
      imputation.jours_sur_sup || 0,
      imputation.jours_sans_solde || 0
    ];
    var poolTotal = restants[0] + restants[1] + restants[2];
    var parts = [];
    if (poidsTotal === 0) return parts;

    var cumulPoids = 0;
    var cumulJours = 0;
    for (var k = 0; k < tranches.length; k++) {
      cumulPoids += tranches[k].jours;
      var cible = (k === tranches.length - 1)
        ? poolTotal
        : Math.floor(poolTotal * cumulPoids / poidsTotal);
      var n = cible - cumulJours;
      cumulJours = cible;

      var part = repartirEntreDestinations(n, restants);
      restants[0] -= part[0];
      restants[1] -= part[1];
      restants[2] -= part[2];

      parts.push({
        cle: tranches[k].cle,
        nbJours: part[0] + part[1] + part[2],
        joursSurCp: part[0], joursSurSup: part[1], joursSansSolde: part[2]
      });
    }
    return parts;
  }

  /* L'imputation qui COUVRE une période de congé du mois, s'il en existe une :
     la période observée dans le mois est entièrement contenue dans la période
     imputée. Sinon null — l'ordre par défaut (RG-07) s'applique. */
  function imputationCouvrante(imputations, periode) {
    for (var i = 0; i < (imputations || []).length; i++) {
      var imp = imputations[i];
      if (imp && imp.date_debut <= periode.debut && imp.date_fin >= periode.fin) return imp;
    }
    return null;
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

    /* Lot 9 : imputations posées dont la période recoupe le mois (forme de
       db.js). Absent ou vide -> comportement d'avant le lot 9. */
    var imputations = entrees.imputations || [];

    var joursPresence = 0;
    var entretienCentimes = 0;
    /* RG-03 / RG-04, détaillé depuis le lot 9 : base contractuelle, minutes
       exceptionnelles ajoutées, minutes auxquelles Maria a renoncé. */
    var minutesSupBase = 0;
    var minutesSupAjoutees = 0;
    var minutesSupRenoncees = 0;
    var joursConge = [];             // jours 'conge_maria' posés dans le mois
    var joursSansSoldeSaisis = 0;    // lignes 'sans_solde' saisies explicitement
    var joursFamiliarisation = 0;

    var jours = joursDuMois(annee, mois);
    for (var j = 0; j < jours.length; j++) {
      var d = jours[j];
      if (planning.indexOf(jourSemaine(d)) === -1) continue;   // hors planning

      /* Correction A1 (relecture lot 1) : la présomption de présence — et
         tout traitement d'une journée — est bornée aux dates du contrat.
         Hors [date_debut, date_fin], le jour est neutre : ni présence, ni
         entretien, ni minutes sup, même si une ligne a été saisie (une
         saisie hors bornes est une erreur ; la couche de saisie du lot 3
         devra l'empêcher ou la signaler).
         TODO RÈGLE ABSENTE : le cahier ne dit pas si le salaire mensualisé
         d'un premier ou dernier mois partiel est dû en entier ou au
         prorata ; ici il reste dû en entier (question n° 2 de la
         relecture, à trancher avec Maria). */
      if (contrat.date_debut && d < contrat.date_debut) continue;
      if (contrat.date_fin && d > contrat.date_fin) continue;

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
          break;

        case 'absence_enfant':
          /* RG-09 : salaire dû, pas d'indemnité d'entretien ; les minutes
             supplémentaires restent dues, sauf si le paramètre du contrat
             dit le contraire (règle en réflexion chez Maria, §8 specs) ou si
             la journée le surcharge (V8-19). Traité par detailSupDuJour,
             juste après ce switch. */
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

      /* RG-03 / RG-04 : minutes supplémentaires de la journée, détaillées.
         `minutes_sup_jour` est un paramètre du contrat (30 aujourd'hui,
         peut-être 0 demain) : aucun code à changer. Une journée sans ligne
         saisie ne porte aucune flexibilité — d'où le littéral { type }. */
      var detailSup = detailSupDuJour(ligne || { type: type }, contrat);
      minutesSupBase += detailSup.base;
      minutesSupAjoutees += detailSup.ajoutees;
      minutesSupRenoncees += detailSup.renoncees;
    }

    /* Invariant testé (A9) : le net acquis est toujours la base, plus les
       minutes exceptionnelles, moins les minutes auxquelles Maria a renoncé. */
    var minutesSupAcquises = minutesSupBase + minutesSupAjoutees - minutesSupRenoncees;

    /* RG-06 : décompte des congés en jours ouvrables, période par période.
       Lot 9 : si une imputation posée COUVRE la période, c'est SA part du
       mois qui est retenue — décomptée sur la période entière, jamais
       redécoupée mois par mois. Sinon, décompte local comme avant. */
    var joursCongesDecomptes = 0;
    var periodes = grouperPeriodesConge(joursConge, planning);
    var cleMois = annee + '-' + String(mois).padStart(2, '0');
    var plan = [];
    var dejaImputees = [];
    var auMoinsUneImposee = false;

    for (var pIdx = 0; pIdx < periodes.length; pIdx++) {
      var periode = periodes[pIdx];
      var impCouvrante = imputationCouvrante(imputations, periode);
      /* Une même imputation ne peut être consommée qu'une fois par mois : sa
         part du mois vaut pour toutes les journées de la période qu'elle
         couvre. Le cas ne devrait pas se présenter (deux périodes séparées
         par un jour travaillé donnent deux imputations distinctes), mais un
         double décompte de congés serait invisible et introuvable. */
      if (impCouvrante && dejaImputees.indexOf(impCouvrante) !== -1) continue;
      if (impCouvrante) {
        dejaImputees.push(impCouvrante);
        var parts = repartirImputationParMois(impCouvrante, planning);
        var partMois = null;
        for (var q = 0; q < parts.length; q++) {
          if (parts[q].cle === cleMois) partMois = parts[q];
        }
        partMois = partMois || { nbJours: 0, joursSurCp: 0, joursSurSup: 0, joursSansSolde: 0 };
        plan.push({
          nbJours: partMois.nbJours,
          imposee: {
            joursSurCp: partMois.joursSurCp,
            joursSurSup: partMois.joursSurSup,
            joursSansSolde: partMois.joursSansSolde
          },
          date_debut: impCouvrante.date_debut,
          date_fin: impCouvrante.date_fin,
          source: 'imposee'
        });
        auMoinsUneImposee = true;
      } else {
        plan.push({
          nbJours: decompterJoursOuvrables(periode.debut, periode.fin, planning),
          imposee: null,
          date_debut: periode.debut,
          date_fin: periode.fin,
          source: 'defaut'
        });
      }
    }

    /* RG-05 / RG-07 : imputation sur les compteurs disponibles.
       Sans aucune imputation imposée, on garde EXACTEMENT le chemin d'avant
       le lot 9 : un seul appel, sur le total du mois. C'est ce qui garantit
       la non-régression des 10 cas de référence. */
    var imputation;
    if (!auMoinsUneImposee) {
      for (var s = 0; s < plan.length; s++) joursCongesDecomptes += plan[s].nbJours;
      imputation = imputerConges(joursCongesDecomptes, {
        minutesSup: entreeMinutesSup,
        dixiemesCp: entreeCpAcquis - entreeCpPris
      }, contrat);
    } else {
      /* Au moins une période imposée : on impute période par période, dans
         l'ordre chronologique, en décrémentant le disponible au fur et à
         mesure — deux périodes ne peuvent pas consommer deux fois le même
         jour de congé payé. */
      var dispoSup = entreeMinutesSup;
      var dispoCp = entreeCpAcquis - entreeCpPris;
      imputation = {
        joursSurSup: 0, minutesSupConsommees: 0,
        joursSurCp: 0, dixiemesCpConsommes: 0,
        joursSansSolde: 0
      };
      for (var v = 0; v < plan.length; v++) {
        joursCongesDecomptes += plan[v].nbJours;
        var r = imputerConges(plan[v].nbJours,
          { minutesSup: dispoSup, dixiemesCp: dispoCp }, contrat, plan[v].imposee);
        imputation.joursSurSup += r.joursSurSup;
        imputation.minutesSupConsommees += r.minutesSupConsommees;
        imputation.joursSurCp += r.joursSurCp;
        imputation.dixiemesCpConsommes += r.dixiemesCpConsommes;
        imputation.joursSansSolde += r.joursSansSolde;
        dispoSup -= r.minutesSupConsommees;
        dispoCp -= r.dixiemesCpConsommes;
      }
    }

    var imputationsAppliquees = plan.map(function (item) {
      return { date_debut: item.date_debut, date_fin: item.date_fin, source: item.source };
    });

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
      /* Détail du mois (lot 9) : ce que le contrat prévoit, ce qui a été
         travaillé en plus, ce à quoi Maria a renoncé. Le récapitulatif du mois les
         affiche ; la somme algébrique vaut toujours minutesSupAcquises. */
      minutesSupBase: minutesSupBase,
      minutesSupAjoutees: minutesSupAjoutees,
      minutesSupRenoncees: minutesSupRenoncees,
      joursCongesDecomptes: joursCongesDecomptes,
      imputation: imputation,
      /* Pour chaque période de congé du mois : la période retenue et
         l'origine de sa ventilation ('imposee' = choisie par Maria,
         'defaut' = ordre d'imputation du contrat, RG-07). */
      imputationsAppliquees: imputationsAppliquees,
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
    minutesSupDuJour: minutesSupDuJour,
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
