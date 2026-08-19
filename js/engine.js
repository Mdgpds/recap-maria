/* ============================================================================
   engine.js — Moteur de calcul de l'application « Récap Maria ».

   Module PUR (§1 des specs) : aucun accès au DOM, aucun appel réseau,
   aucune lecture d'horloge système. Entrées -> sorties, exécutable sous Node.

   Unités (§1) : temps en minutes entières, argent en centimes entiers.
   LOT 17 — les congés payés passent des dixièmes de jour aux MINUTES (§17.6) :
   Maria pose des congés de 15 min, 1 h 30, 1 h 45, et le dixième de jour
   obligeait à arrondir à chaque fois. Le facteur de conversion est
   `minutes_par_jour_conge`, et l'affichage continue de dire « 10 j ».
   Aucun float dans les calculs — seule exception sanctionnée par les specs :
   le paramètre `coefficient` de montantCentimes (majoration 1.5 de RG-13),
   avec UN SEUL arrondi final.

   LOT 17 — LES CONDITIONS SONT DATÉES (§17.0 à §17.3). Le moteur ne lit plus
   aucun réglage sur `contrat` : il reçoit les `conditions` du mois, c'est-à-
   dire l'avenant en vigueur, sélectionné par `conditionsApplicables`. De
   `contrat` ne subsistent que `date_debut` et `date_fin`, qui bornent le
   contrat et ne sont pas des réglages. À conditions constantes, le résultat
   est rigoureusement identique à celui d'avant le lot 17 : c'est ce que
   prouve `test/lot17-differentiel.test.js`, sur le moteur figé en
   `test/fixtures/engine-avant-lot17.js`.

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

  /* Acquisition de congés payés : 2,5 jours ouvrables par mois entièrement
     travaillé (RG-11), soit 25 dixièmes avant le lot 17. */
  var DIXIEMES_CP_PAR_MOIS = 25;

  /* §17.6 — la même acquisition, exprimée dans la nouvelle unité. Un jour de
     congé vaut `minutes_par_jour_conge` minutes ; 2,5 jours en valent deux
     fois et demie autant. L'arrondi n'existe que si `minutes_par_jour_conge`
     est impair — 540 donne 1350 minutes exactement. Il est fait ICI, une
     seule fois par mois, et jamais sur un cumul.

     CORRECTION C2 DE LA RELECTURE DU LOT 17. Le commentaire d'origine ajoutait
     « c'est la même arithmétique que la conversion de la migration 014 ».
     C'était FAUX : `Math.round` en JavaScript arrondit, la division entière
     SQL tronque. Pour 545 minutes et 25 dixièmes, le moteur retient 1363 et la
     migration écrivait 1362 — une demi-minute par mois, cumulative, invisible,
     et en faveur de Maria.

     La divergence est désormais impossible, non par une règle d'arrondi
     harmonisée mais par une CONTRAINTE : la migration `015` impose
     `minutes_par_jour_conge` multiple de 10. Le produit est alors toujours
     entier, et les deux arithmétiques coïncident au bit près. Tous les
     contrats réels sont à 540 : la contrainte ne change rien à l'existant. */
  function minutesCpParMois(conditions) {
    return Math.round(DIXIEMES_CP_PAR_MOIS * conditions.minutes_par_jour_conge / 10);
  }

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
    if (finStr < debutStr) throw new Error('joursOuvrablesParMois : fin < debut');

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
     `compteur` : { minutesSup, minutesCp } — quantités DISPONIBLES.
     Un jour de congé consomme `conditions.minutes_par_jour_conge` minutes
     entières ; un reliquat strictement inférieur RESTE au compteur, il ne
     couvre jamais un jour partiel. LOT 17 (§17.6) : les congés payés suivent
     désormais exactement la même règle et la même unité que la récupération
     — un jour en consomme `minutes_par_jour_conge`, un reliquat inférieur
     reste acquis. Avant le lot 17 ils étaient comptés en dixièmes, et un jour
     en consommait 10 : le comportement est le même à un facteur près.
     L'ordre suit conditions.ordre_imputation ('cp_puis_sup' par défaut,
     RG-07).
     Le débordement final part en sans solde.

     LOT 9 — `imputationImposee` (4e paramètre, OPTIONNEL) :
       - absent ou null : comportement ci-dessus, strictement inchangé. RG-07
         reste la valeur par défaut PROPOSÉE.
       - présent : { joursSurCp, joursSurSup, joursSansSolde }. Le moteur
         APPLIQUE cette répartition sans la recalculer, après trois
         vérifications qui lèvent un CODE d'erreur et n'écrivent rien. */
  function imputerConges(nbJours, compteur, conditions, imputationImposee) {
    var minutesParJour = conditions.minutes_par_jour_conge;
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
      var dispoCp = (compteur && compteur.minutesCp) || 0;
      var dispoSup = (compteur && compteur.minutesSup) || 0;
      if (impCp * minutesParJour > dispoCp || impSup * minutesParJour > dispoSup) {
        throw erreurCode('IMPUTATION_DEPASSE_RESERVES');
      }

      return {
        joursSurSup: impSup, minutesSupConsommees: impSup * minutesParJour,
        joursSurCp: impCp, minutesCpConsommees: impCp * minutesParJour,
        joursSansSolde: impSansSolde
      };
    }

    var resultat = {
      joursSurSup: 0, minutesSupConsommees: 0,
      joursSurCp: 0, minutesCpConsommees: 0,
      joursSansSolde: 0
    };

    function prendreSurCp() {
      /* Correction B1 (relecture lot 1) : on ne consomme que du disponible.
         Un compteur incohérent (pris > acquis, saisie d'initialisation
         erronée) donne un disponible négatif : il est borné à 0 et ne
         « rend » jamais des jours. */
      var joursDispo = Math.max(0, Math.floor(((compteur && compteur.minutesCp) || 0) / minutesParJour));
      var pris = Math.min(restant, joursDispo);
      resultat.joursSurCp = pris;
      resultat.minutesCpConsommees = pris * minutesParJour;
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

    if (conditions.ordre_imputation === 'sup_puis_cp') {
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

  /* Lecture d'un nombre de minutes saisi sur une journée.

     CORRECTION RELECTURE LOT 9 (A3) : ce lecteur repliait toute valeur non
     numérique sur 0. Un renoncement transmis en chaîne — la valeur naturelle
     d'un champ de saisie — était donc silencieusement ignoré, et les minutes
     restaient acquises : un chiffre faux, en faveur de Maria, contestable par
     les familles. Un repli muet sur une valeur exprimée est toujours pire
     qu'un refus. On lève désormais un CODE.

     Absent, `null` ou `undefined` = « rien de saisi » et vaut 0 : c'est le
     cas ordinaire de toutes les journées d'avant le lot 9. */
  function minutesSaisies(valeur, champ) {
    if (valeur == null) return 0;
    if (typeof valeur !== 'number' || !isFinite(valeur) ||
        !Number.isInteger(valeur) || valeur < 0) {
      var e = erreurCode('MINUTES_INVALIDES');
      e.champ = champ;
      throw e;
    }
    return valeur;
  }

  /* LOT 17 (§17.5) — lecture de l'écart d'horaire DÉCLARÉ sur une journée.
     Contrairement à `minutesSaisies`, il accepte le négatif : c'est tout
     l'objet du champ. Un écart positif est un parent en retard, un écart
     négatif est un temps que Maria a rendu de son propre fait — libération
     anticipée ou arrivée décalée qu'elle a demandée.

     `null` ou absent = « rien de déclaré », et vaut 0. C'est le cas de toutes
     les journées d'avant le lot 17, et c'est aussi le cas d'un parent qui
     vient chercher son enfant plus tôt SANS que Maria déclare quoi que ce
     soit (§17.5, A3) : elle était disponible, ses minutes restent dues. */
  function ecartSaisi(valeur) {
    if (valeur == null) return 0;
    if (typeof valeur !== 'number' || !isFinite(valeur) || !Number.isInteger(valeur)) {
      var e = erreurCode('MINUTES_INVALIDES');
      e.champ = 'ecart_minutes';
      throw e;
    }
    return valeur;
  }

  /* Destinations possibles d'un écart NÉGATIF (§17.6). Un écart positif va
     toujours à la récupération : un parent en retard fait du temps de travail
     en plus, il n'y a rien à choisir. */
  var DESTINATIONS_ECART = ['recuperation', 'conges_payes', 'sans_solde'];

  /* Détail des minutes supplémentaires d'UNE journée, dans l'ordre exact du
     §5.1 de la spec du lot 9, étendu au lot 17 (§17.5).
     Retourne les composantes séparément : c'est ce détail que le
     récapitulatif du mois affiche, et c'est lui qui garantit l'invariant
     acquises = base + ajoutées − renoncées + écart imputé à la récupération.

     Le second paramètre est désormais les CONDITIONS du mois (l'avenant en
     vigueur), plus le contrat : un avenant qui déplace les horaires déplace
     la référence de la journée, sans toucher aux mois d'avant. */
  function detailSupDuJour(journee, conditions) {
    var type = journee && journee.type;

    /* 1. RG-04 — rien, quoi qu'il ait été saisi. Y compris un écart
       d'horaire : une journée sans travail n'a pas d'horaire de référence,
       donc pas d'écart possible. */
    if (TYPES_SANS_MINUTES.indexOf(type) !== -1) {
      return { base: 0, ajoutees: 0, renoncees: 0,
               ecart: 0, ecartImputeSur: null,
               ecartSurRecuperation: 0, minutesSurCp: 0, minutesSansSolde: 0 };
    }

    /* 2. Ce que le contrat prévoit. */
    var base = conditions.minutes_sup_jour;

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
        : conditions.sup_dues_si_enfant_absent;
      if (dues === false) base = 0;
    }

    /* 4. Minutes travaillées au-delà du contrat ce jour-là (V8-18). */
    var ajoutees = minutesSaisies(journee && journee.minutes_sup_exceptionnelles,
                                  'minutes_sup_exceptionnelles');

    /* 5. Renoncement explicite (V8-18), BORNÉ : on ne peut pas renoncer à
       plus que ce qui est dû. Sans ce plancher, un renoncement ferait
       AUGMENTER le compteur — le Math.min n'est pas une élégance, c'est la
       garde. Le surplus est ignoré, jamais négatif. */
    var renoncees = Math.min(
      minutesSaisies(journee && journee.minutes_sup_renoncees, 'minutes_sup_renoncees'),
      base + ajoutees
    );

    /* 6. LOT 17 (§17.5) — l'écart d'horaire déclaré.

         Minutes du jour = minutes supplémentaires du contrat
                           + (heure réelle − heure de référence)

       La référence est la fin d'accueil plus les minutes supplémentaires du
       contrat — 17h30 + 30 min = 18h00 — et elle vient des CONDITIONS, donc
       d'un avenant. Le moteur ne la recalcule pas ici : l'écart lui arrive
       déjà en minutes signées, parce que c'est Maria qui DÉCLARE l'événement
       et que l'application ne devine rien. La conversion « départ 18h01 →
       + 1 min » appartient à l'écran de saisie, qui dispose des horaires.

       Un écart négatif est du temps rendu, et Maria choisit où il se déduit :
         - `recuperation` (défaut) — il entre dans le compteur signé, qui peut
           passer sous zéro. C'est ça, « je le devrai ».
         - `conges_payes`  — il se déduit des congés payés, en minutes, sans
           aucun arrondi (§17.6, A1).
         - `sans_solde`    — il ne touche aucun compteur et devient une retenue
           en euros, calculée par le moteur.
       Un écart POSITIF va toujours à la récupération : il n'y a rien à
       choisir, c'est du temps travaillé en plus. */
    var ecart = ecartSaisi(journee && journee.ecart_minutes);
    var destination = 'recuperation';
    if (ecart < 0 && journee && journee.ecart_impute_sur != null) {
      if (DESTINATIONS_ECART.indexOf(journee.ecart_impute_sur) === -1) {
        throw erreurCode('ECART_DESTINATION_INCONNUE');
      }
      destination = journee.ecart_impute_sur;
    }

    return {
      base: base, ajoutees: ajoutees, renoncees: renoncees,
      ecart: ecart,
      ecartImputeSur: ecart === 0 ? null : (ecart > 0 ? 'recuperation' : destination),
      /* Ce que l'écart fait au compteur de récupération : tout le positif,
         et le négatif seulement s'il lui est imputé. */
      ecartSurRecuperation: (ecart > 0 || destination === 'recuperation') ? ecart : 0,
      /* Minutes de congés payés consommées par l'écart, toujours positives. */
      minutesSurCp: (ecart < 0 && destination === 'conges_payes') ? -ecart : 0,
      /* Minutes retenues sans solde, toujours positives. */
      minutesSansSolde: (ecart < 0 && destination === 'sans_solde') ? -ecart : 0
    };
  }

  /* Minutes supplémentaires nettes d'une journée (§5.1, §17.5). Peut être
     NÉGATIVE depuis le lot 17 : une libération anticipée d'une heure sur une
     journée à 30 minutes de base donne − 30 minutes. */
  function minutesSupDuJour(journee, conditions) {
    var d = detailSupDuJour(journee, conditions);
    return d.base + d.ajoutees - d.renoncees + d.ecartSurRecuperation;
  }

  /* Montant en centimes correspondant à `minutes` de travail au taux du
     contrat : brut mensuel / (195 h × 60). UN SEUL arrondi, appliqué à la
     toute fin — ne jamais arrondir un résultat intermédiaire (§4.2). */
  function montantCentimes(brutMensuelCentimes, minutes, coefficient) {
    if (coefficient === undefined) coefficient = 1;
    return Math.round(brutMensuelCentimes * minutes * coefficient / MINUTES_BASE_MENSUELLE);
  }

  /* RG-15 / §17.3 — CONDITIONS applicables à un mois : l'avenant dont la
     date d'effet est la plus récente ANTÉRIEURE OU ÉGALE au premier jour du
     mois. Retourne null si aucun n'est applicable.

     LOT 17 : cette fonction s'appelait `salaireApplicable` et ne servait qu'au
     brut et au net. La règle de sélection ne change pas d'un iota — c'est le
     PÉRIMÈTRE qui s'élargit : l'avenant porte désormais les onze réglages, et
     c'est lui, pas `contrat`, que `calculerMois` lit. Deux tables datées côte
     à côte auraient été exactement le désordre qu'on voulait éviter.

     Comme `date_effet` est toujours un 1er de mois (contrainte de la
     migration `014`), un mois porte UN seul jeu de conditions : il n'existe
     aucun mois à cheval sur deux avenants, et le moteur n'a jamais à
     mélanger deux réglages dans un même calcul.

     La sélection est faite par l'appelant (chaine-mois.js) avant
     calculerMois ; un récap figé n'est jamais recalculé (protection assurée
     en base par le trigger du lot 2). */
  function conditionsApplicables(avenants, annee, mois) {
    var premierJour = annee + '-' + String(mois).padStart(2, '0') + '-01';
    var retenu = null;
    for (var i = 0; i < (avenants || []).length; i++) {
      var a = avenants[i];
      if (a.date_effet <= premierJour && (retenu === null || a.date_effet > retenu.date_effet)) {
        retenu = a;
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

  /* §17.7 — part du mois réellement couverte par le contrat, comptée en
     JOURS DU PLANNING. C'est l'assiette du prorata du premier et du dernier
     mois : le moteur borne déjà les journées aux dates du contrat
     (`date_debut`, `date_fin`), mais le salaire mensualisé, lui, restait dû
     en entier — un contrat ouvert le 16 mars retenait le mois de mars complet.

     Les jours fériés du planning comptent comme couverts : ils sont chômés et
     PAYÉS (RG-10), ils font partie du mois dû. Ce qui est proratisé, c'est la
     part du mois pendant laquelle le contrat existait, pas le travail fourni.

     Retourne { joursCouverts, joursDuMois }. Quand les deux sont égaux, le
     prorata vaut 1 et aucun arrondi n'a lieu : c'est ce qui garantit qu'un
     mois entier donne EXACTEMENT le montant d'avant le lot 17. */
  function partCouverteDuMois(contrat, planning, annee, mois) {
    var jours = joursDuMois(annee, mois);
    var total = 0;
    var couverts = 0;
    for (var i = 0; i < jours.length; i++) {
      var d = jours[i];
      if (planning.indexOf(jourSemaine(d)) === -1) continue;
      total++;
      if (contrat.date_debut && d < contrat.date_debut) continue;
      if (contrat.date_fin && d > contrat.date_fin) continue;
      couverts++;
    }
    return { joursCouverts: couverts, joursDuMois: total };
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

    /* CORRECTION RELECTURE LOT 9 (A1) — LE POINT CRITIQUE DU LOT.

       Le décompte RG-06 d'une période est une donnée CALCULÉE, jamais une
       donnée d'entrée. Le moteur le calcule ici (`poidsTotal`) : il doit
       donc vérifier que la ventilation transmise le couvre, au lieu de
       répartir aveuglément la valeur reçue.

       Sans cette garde, une ligne d'imputation portant `jours_ouvrables: 5`
       sur une semaine du lundi au vendredi — ligne parfaitement valide pour
       la contrainte SQL, qui ne contrôle que la cohérence interne de la
       ligne — faisait afficher « 5 jours de congés » là où RG-06 en compte
       6, samedi inclus, avec l'encart explicatif du récapitulatif juste à côté.
       C'est mot pour mot le litige historique avec les familles
       (référentiel A.2). Le cas symétrique (7 au lieu de 6) faisait perdre
       un jour de congés payés à Maria, sans aucun signal.

       Cette garde rend aussi `IMPUTATION_INCOMPLETE` réellement atteignable
       depuis `calculerMois` : sans elle, le contrôle n° 1 d'`imputerConges`
       comparait une somme à elle-même. */
    if (poolTotal !== poidsTotal) {
      var eDecompte = erreurCode('IMPUTATION_INCOMPLETE');
      eDecompte.attendu = poidsTotal;      // décompte RG-06 réel de la période
      eDecompte.recu = poolTotal;          // somme de la ventilation transmise
      throw eDecompte;
    }
    /* `jours_ouvrables` est censé égaler la ventilation (contrainte SQL
       `imputation_complete`). S'il en diverge — ligne modifiée à la main —,
       on refuse plutôt que de choisir silencieusement une des deux valeurs. */
    if (imputation.jours_ouvrables != null && imputation.jours_ouvrables !== poolTotal) {
      var eLigne = erreurCode('IMPUTATION_INCOMPLETE');
      eLigne.attendu = poolTotal;
      eLigne.recu = imputation.jours_ouvrables;
      throw eLigne;
    }

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

  /* Cherche l'imputation applicable à une période de congé du mois.

     `couvrante` : la période observée dans le mois est entièrement contenue
     dans la période imputée — la ventilation choisie par Maria s'applique.

     `ecartee` : une imputation existe et recoupe la période, mais ne la
     couvre pas (une journée de congé a été ajoutée après coup, et rien ne l'a
     resynchronisée). L'ordre par défaut du contrat s'applique alors.

     CORRECTION RELECTURE LOT 9 (A2) : ce second cas était auparavant
     indistinguable d'une absence de choix — la sortie disait `'defaut'` dans
     les deux cas. Or RG-07 dit « à défaut de choix explicite » : ici le choix
     n'est pas absent, il est devenu inapplicable. Le moteur doit le dire,
     pour que le lot 10 puisse le dire à Maria — une journée ajoutée peut
     faire basculer onze jours de récupération en douze jours de congés
     payés, sur deux compteurs qui se propagent sur des années. */
  /* CORRECTION RELECTURE LOT 9, 2ᵉ PASSE (B1).

     Encadrer n'est pas correspondre. `imputationApplicable` se contentait de
     vérifier que l'imputation ENCADRE la période observée dans le mois : une
     imputation restée plus LARGE que les journées réellement posées était donc
     acceptée telle quelle, et sa ventilation entière appliquée en silence.

     Le cas se produit dès que Maria raccourcit un congé sans que l'imputation
     soit refaite : elle pose la semaine du 27 au 31 juillet, puis retravaille
     le mercredi, le jeudi et le vendredi. Le moteur comptait alors ces trois
     journées DEUX FOIS — payées en présence, avec entretien et minutes
     supplémentaires, et débitées comme congé. Vingt-six journées dans un mois
     qui n'en compte que vingt-deux, et quatre jours de congés payés perdus
     pour des jours travaillés. Aucun compteur ne se remet à zéro (RG-12) :
     l'écart se serait propagé sur toutes les années suivantes.

     Le contrôle ci-dessous ne décide rien de métier : il constate que le choix
     de Maria ne décrit plus ses journées, et laisse l'appelant le SIGNALER —
     exactement comme le correctif A2 le fait pour l'écart inverse.

     Un jour n'est comparé que s'il a été traité par la boucle du mois (jour du
     planning, dans les bornes du contrat) ; un férié à l'intérieur d'une
     période de congé n'est jamais posé en congé et ne compte donc pas. */
  function imputationCorrespondAuxJournees(imputation, typeDuJourTraite, joursDuMoisCourant) {
    for (var i = 0; i < joursDuMoisCourant.length; i++) {
      var d = joursDuMoisCourant[i];
      if (d < imputation.date_debut || d > imputation.date_fin) continue;
      var t = typeDuJourTraite[d];
      if (t === undefined) continue;          // jour non traité : neutre
      if (t === 'ferie') continue;            // jamais posé en congé
      if (t !== 'conge_maria') return false;  // journée travaillée dans la période imputée
    }
    return true;
  }

  function imputationApplicable(imputations, periode) {
    var ecartee = null;
    for (var i = 0; i < (imputations || []).length; i++) {
      var imp = imputations[i];
      if (!imp) continue;
      if (imp.date_debut <= periode.debut && imp.date_fin >= periode.fin) {
        return { couvrante: imp, ecartee: null };
      }
      if (!ecartee && imp.date_debut <= periode.fin && imp.date_fin >= periode.debut) {
        ecartee = imp;
      }
    }
    return { couvrante: null, ecartee: ecartee };
  }

  /* Calcule le récapitulatif d'un mois pour un contrat.

     Entrées :
       contrat        : ligne de la table contrat. LOT 17 : le moteur n'y lit
                        plus que `date_debut` et `date_fin`, qui bornent le
                        contrat et ne sont pas des réglages. Aucun autre champ.
       conditions     : l'avenant en vigueur ce mois-là (§17.3), déjà
                        sélectionné par `conditionsApplicables`. Il porte les
                        onze réglages, brut et net compris.
       journees       : lignes de la table journee du mois (les EXCEPTIONS ;
                        tout jour du planning sans ligne est présumé
                        'presence', ou 'ferie' si le calendrier le dit)
       compteurEntree : { minutesSup, minutesCpAcquis, minutesCpPris }
                        — LOT 17 : les congés payés sont en MINUTES (§17.6).
       annee, mois    : mois calculé

     Sortie : ResultatMois (§4.3 des specs). */
  function calculerMois(entrees) {
    var contrat = entrees.contrat;
    var conditions = entrees.conditions;
    if (!conditions) throw erreurCode('CONDITIONS_ABSENTES');
    /* Le brut et le net vivent sur l'avenant depuis le lot 17 : `conditions`
       EST le barème du mois. On garde un nom court pour les lignes qui les
       utilisent, mais il n'y a plus qu'une seule source. */
    var salaire = conditions;
    var journees = entrees.journees || [];
    var annee = entrees.annee;
    var mois = entrees.mois;
    var planning = conditions.jours_planning || PLANNING_DEFAUT;

    var compteurEntree = entrees.compteurEntree || {};
    var entreeMinutesSup = compteurEntree.minutesSup || 0;
    var entreeCpAcquis = compteurEntree.minutesCpAcquis || 0;
    var entreeCpPris = compteurEntree.minutesCpPris || 0;

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
    /* LOT 17 (§17.5) — les écarts d'horaire déclarés. Le total imputé à la
       récupération est SIGNÉ ; les deux autres destinations sont positives. */
    var minutesEcartRecuperation = 0;
    var minutesEcartSurCp = 0;
    var minutesEcartSansSolde = 0;
    var ecartsDeclares = [];
    var joursConge = [];             // jours 'conge_maria' posés dans le mois
    var joursSansSoldeSaisis = 0;    // lignes 'sans_solde' saisies explicitement
    var joursFamiliarisation = 0;
    /* Type retenu pour chaque journée effectivement traitée du mois — jour du
       planning, dans les bornes du contrat. Sert au contrôle de correspondance
       B1 plus bas : une imputation doit correspondre aux journées RÉELLEMENT
       posées, pas seulement les encadrer. */
    var typeDuJourTraite = {};

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
         LOT 17 (§17.7) — LA RÈGLE MANQUANTE EST TRANCHÉE. Les journées
         étaient déjà bornées ici ; c'est le SALAIRE qui ne l'était pas, et un
         contrat ouvert le 16 mars retenait le mois de mars entier. Le prorata
         est appliqué en fin de calcul, sur le brut et le net, à partir de
         `partCouverteDuMois`. Un mois entier ne change pas d'un centime. */
      if (contrat.date_debut && d < contrat.date_debut) continue;
      if (contrat.date_fin && d > contrat.date_fin) continue;

      var ligne = parJour[d];
      /* Saisie par exception (§5) : sans ligne, un jour du planning est
         présumé 'presence' — sauf s'il est férié (RG-10 : Maria ne
         travaille jamais un jour férié). Une ligne explicite prime. */
      var type = ligne ? ligne.type : (Feries.estJourFerie(d) ? 'ferie' : 'presence');
      typeDuJourTraite[d] = type;

      switch (type) {
        case 'presence':
          /* RG-01 : jour de présence acquis dès 1 h de garde, pas de
             demi-journée. RG-02 : indemnité par jour de présence (surcharge
             manuelle possible via journee.entretien_centimes, cf. RG-14). */
          joursPresence++;
          entretienCentimes += (ligne && Number.isInteger(ligne.entretien_centimes))
            ? ligne.entretien_centimes
            : conditions.entretien_centimes_jour;
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
      var detailSup = detailSupDuJour(ligne || { type: type }, conditions);
      minutesSupBase += detailSup.base;
      minutesSupAjoutees += detailSup.ajoutees;
      minutesSupRenoncees += detailSup.renoncees;
      minutesEcartRecuperation += detailSup.ecartSurRecuperation;
      minutesEcartSurCp += detailSup.minutesSurCp;
      minutesEcartSansSolde += detailSup.minutesSansSolde;
      if (detailSup.ecart !== 0) {
        /* Le détail que le document doit annoncer (§17.5, A5) : le total des
           heures supplémentaires est NET, et la ligne qui l'explique nomme la
           journée. Une somme sans son détail est incontestable et
           inexplicable à la fois — c'est exactement ce qu'on refuse. */
        /* CORRECTION DE LA REMARQUE 4 DE LA RELECTURE DU LOT 17 —
           L'ÉVÉNEMENT, PAS SEULEMENT LA DESTINATION.

           La spécification écrit « dont 1 h 30 déduite — LIBÉRATION ANTICIPÉE
           du 17 novembre » ; le document écrivait « déduite de ma
           récupération ». Une libération anticipée et une arrivée décalée à la
           demande de Maria produisaient la même phrase, alors que ce sont deux
           gestes différents — et c'est le geste, pas la poche, qui explique au
           parent pourquoi le temps a bougé. */
        ecartsDeclares.push({
          jour: d,
          minutes: detailSup.ecart,
          evenement: (ligne && ligne.ecart_evenement) || null,
          imputeSur: detailSup.ecartImputeSur
        });
      }
    }

    /* Invariant testé (A9) : le net acquis est toujours la base, plus les
       minutes exceptionnelles, moins les minutes auxquelles Maria a renoncé.
       LOT 17 : plus l'écart d'horaire imputé à la récupération, qui est signé
       — le total du mois peut donc être négatif, et l'écran le dit (§17.5). */
    var minutesSupAcquises = minutesSupBase + minutesSupAjoutees
                           - minutesSupRenoncees + minutesEcartRecuperation;

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
      var applicable = imputationApplicable(imputations, periode);
      var impCouvrante = applicable.couvrante;
      /* B1 : une imputation qui encadre la période mais ne correspond plus aux
         journées posées est ÉCARTÉE, pas appliquée. On la traite alors comme
         le correctif A2 traite l'écart inverse : l'ordre du contrat reprend la
         main, et le moteur dit que le choix de Maria a été écarté. */
      var ecarteeB1 = null;
      if (impCouvrante &&
          !imputationCorrespondAuxJournees(impCouvrante, typeDuJourTraite, jours)) {
        ecarteeB1 = impCouvrante;
        impCouvrante = null;
      }
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
          source: 'imposee',
          /* CORRECTION RELECTURE LOT 9, 2ᵉ PASSE (C1). Le contrôle des
             réserves portait sur la part du MOIS, jamais sur la période. Une
             ventilation hors réserves sur l'ensemble d'une période à cheval
             passait donc pour le premier mois — qui devenait présentable et
             clôturable — et n'était refusée qu'au second. §5.3 : le décompte
             et la ventilation d'une période sont insécables ; un refus qui ne
             porte que sur une moitié laisse le premier mois calculé sur une
             ventilation qui ne pourra jamais être honorée.
             La période entière est donc vérifiée AU MOIS OÙ ELLE COMMENCE,
             contre les réserves de ce mois-là. La date à laquelle les réserves
             font foi n'est écrite nulle part : c'est une question remontée à
             Adrien, et le choix retenu ici est le prudent — refuser tôt. */
          imposeeTotale: (parts.length && parts[0].cle === cleMois) ? {
            joursSurCp: impCouvrante.jours_sur_cp || 0,
            joursSurSup: impCouvrante.jours_sur_sup || 0,
            joursSansSolde: impCouvrante.jours_sans_solde || 0
          } : null
        });
        auMoinsUneImposee = true;
      } else {
        /* Correction relecture A2 : « aucun choix » et « choix écarté » sont
           deux situations différentes, et l'écran doit pouvoir les
           distinguer. `choixEcarte` porte la période choisie par Maria qui
           n'a pas pu s'appliquer. */
        plan.push({
          nbJours: decompterJoursOuvrables(periode.debut, periode.fin, planning),
          imposee: null,
          date_debut: periode.debut,
          date_fin: periode.fin,
          source: (ecarteeB1 || applicable.ecartee) ? 'defaut_choix_ecarte' : 'defaut',
          choixEcarte: (ecarteeB1 || applicable.ecartee)
            ? { date_debut: (ecarteeB1 || applicable.ecartee).date_debut,
                date_fin: (ecarteeB1 || applicable.ecartee).date_fin }
            : null
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
        minutesCp: entreeCpAcquis - entreeCpPris
      }, conditions);
    } else {
      /* Au moins une période imposée : on impute période par période, dans
         l'ordre chronologique, en décrémentant le disponible au fur et à
         mesure — deux périodes ne peuvent pas consommer deux fois le même
         jour de congé payé. */
      var dispoSup = entreeMinutesSup;
      var dispoCp = entreeCpAcquis - entreeCpPris;
      imputation = {
        joursSurSup: 0, minutesSupConsommees: 0,
        joursSurCp: 0, minutesCpConsommees: 0,
        joursSansSolde: 0
      };
      for (var v = 0; v < plan.length; v++) {
        joursCongesDecomptes += plan[v].nbJours;
        /* C1 — au mois où la période COMMENCE, la ventilation est confrontée
           aux réserves pour la période ENTIÈRE, pas seulement pour la part du
           mois. Un mois clôturable sur une ventilation impossible à honorer
           est pire qu'un refus franc. */
        var tot = plan[v].imposeeTotale;
        if (tot && (tot.joursSurCp * conditions.minutes_par_jour_conge > dispoCp ||
                    tot.joursSurSup * conditions.minutes_par_jour_conge > dispoSup)) {
          throw erreurCode('IMPUTATION_DEPASSE_RESERVES');
        }
        var r = imputerConges(plan[v].nbJours,
          { minutesSup: dispoSup, minutesCp: dispoCp }, conditions, plan[v].imposee);
        imputation.joursSurSup += r.joursSurSup;
        imputation.minutesSupConsommees += r.minutesSupConsommees;
        imputation.joursSurCp += r.joursSurCp;
        imputation.minutesCpConsommees += r.minutesCpConsommees;
        imputation.joursSansSolde += r.joursSansSolde;
        dispoSup -= r.minutesSupConsommees;
        dispoCp -= r.minutesCpConsommees;
      }
    }

    var imputationsAppliquees = plan.map(function (item) {
      var sortie = { date_debut: item.date_debut, date_fin: item.date_fin, source: item.source };
      if (item.choixEcarte) sortie.choixEcarte = item.choixEcarte;
      return sortie;
    });

    /* RG-08 : retenue = minutes_par_jour_conge × taux horaire brut par jour
       sans solde. Un seul arrondi sur le total (§4.2).
       LOT 17 (§17.6) : les minutes d'un congé à l'heure passé en sans solde
       s'ajoutent à cette assiette AVANT l'arrondi — deux arrondis séparés
       feraient dériver le total d'un centime au hasard des mois. */
    var joursSansSoldeTotal = imputation.joursSansSolde + joursSansSoldeSaisis;
    var minutesSansSoldeTotal =
      joursSansSoldeTotal * conditions.minutes_par_jour_conge + minutesEcartSansSolde;
    var retenueSansSoldeCentimes = minutesSansSoldeTotal === 0 ? 0 :
      montantCentimes(salaire.brut_mensuel_centimes, minutesSansSoldeTotal);

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
    var minutesCpAcquises = moisEntierementTravaille ? minutesCpParMois(conditions) : 0;

    /* RG-12 / RG-12bis : aucun compteur ne se remet à zéro — les compteurs
       de sortie sont de simples cumuls, sans aucune clôture au 31 août. */
    var compteurSortie = {
      minutesSup: entreeMinutesSup + minutesSupAcquises - imputation.minutesSupConsommees,
      minutesCpAcquis: entreeCpAcquis + minutesCpAcquises,
      /* Les congés payés pris comprennent les jours pleins imputés ET les
         minutes d'un congé à l'heure déduit des congés payés (§17.6). */
      minutesCpPris: entreeCpPris + imputation.minutesCpConsommees + minutesEcartSurCp
    };

    /* §17.7 — le prorata du premier et du dernier mois. UN SEUL arrondi, sur
       le montant final, et aucun arrondi du tout quand le mois est entier. */
    var part = partCouverteDuMois(contrat, planning, annee, mois);
    var moisEntier = part.joursCouverts === part.joursDuMois;
    var brutProrata = moisEntier || part.joursDuMois === 0
      ? salaire.brut_mensuel_centimes
      : Math.round(salaire.brut_mensuel_centimes * part.joursCouverts / part.joursDuMois);
    var netProrata = moisEntier || part.joursDuMois === 0
      ? salaire.net_mensuel_centimes
      : Math.round(salaire.net_mensuel_centimes * part.joursCouverts / part.joursDuMois);

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
      /* LOT 17 (§17.5) — les écarts d'horaire déclarés. `minutesSupAcquises`
         est déjà NET de `minutesEcartRecuperation` : le document annonce le
         net, et `ecartsDeclares` porte la ligne qui l'explique, journée par
         journée. Sans ce détail, un total amputé serait incontestable et
         inexplicable en même temps. */
      minutesEcartRecuperation: minutesEcartRecuperation,
      minutesEcartSurCp: minutesEcartSurCp,
      minutesEcartSansSolde: minutesEcartSansSolde,
      ecartsDeclares: ecartsDeclares,
      joursCongesDecomptes: joursCongesDecomptes,
      imputation: imputation,
      /* Pour chaque période de congé du mois : la période retenue et
         l'origine de sa ventilation.
           'imposee'             — la ventilation choisie par Maria s'applique
           'defaut'              — aucun choix : ordre du contrat (RG-07)
           'defaut_choix_ecarte' — un choix existe mais ne couvre plus la
                                   période ; l'ordre du contrat s'applique et
                                   `choixEcarte` porte la période concernée.
                                   À signaler à l'écran (lot 10). */
      imputationsAppliquees: imputationsAppliquees,
      retenueSansSoldeCentimes: retenueSansSoldeCentimes,
      minutesCpAcquis: minutesCpAcquises,
      /* §17.6 — LE MARQUEUR D'UNITÉ. Un instantané de mois clôturé n'est
         JAMAIS réécrit : ceux d'avant le lot 17 portent des dixièmes de jour
         et continueront de les porter pour toujours. Ce champ est ce qui
         permet à `js/chaine-mois.js` de reconnaître les uns des autres et de
         convertir à la LECTURE, sans jamais toucher au document. Sans lui, il
         faudrait deviner l'unité d'un nombre — et un compteur de congés payés
         lu dans la mauvaise unité se propage sur toutes les années suivantes
         sans que rien ne le signale. */
      uniteCp: 'minutes',
      compteurSortie: compteurSortie,
      /* Le brut et le net CONTRACTUELS du mois, non proratisés. C'est d'eux
         que dérive le taux horaire (`montantCentimes`) : un taux proratisé
         ferait payer une heure supplémentaire moins cher au premier mois d'un
         contrat qu'au deuxième. Ils restent donc bruts de tout prorata. */
      salaireBrutCentimes: salaire.brut_mensuel_centimes,
      salaireNetCentimes: salaire.net_mensuel_centimes,
      /* §17.7 — le prorata du premier et du dernier mois. Sur un mois entier,
         `joursCouverts === joursDuMois` et les montants sont identiques aux
         contractuels, au centime près et sans aucun arrondi. */
      prorata: {
        joursCouverts: part.joursCouverts,
        joursDuMois: part.joursDuMois,
        applique: !moisEntier && part.joursDuMois > 0
      },
      salaireBrutProrataCentimes: brutProrata,
      salaireNetProrataCentimes: netProrata,
      /* §17.8 — LE BRUT RÉELLEMENT DÛ DU MOIS, celui qui entre dans l'assiette
         du 1/80ᵉ de l'indemnité de rupture. C'est le brut du mois après
         prorata, moins la retenue de sans solde (déjà exprimée en brut,
         RG-08). L'instantané ne portait jusqu'ici que le brut CONTRACTUEL :
         une indemnité calculée dessus aurait ignoré les mois sans solde et
         les mois partiels, et surpayé la famille sur un chiffre invérifiable.
         Jamais négatif : une retenue supérieure au brut du mois signale une
         donnée incohérente, pas une dette de Maria envers la famille. */
      brutDuCentimes: Math.max(0, brutProrata - retenueSansSoldeCentimes),
      /* §5.8 du cahier : net du mois + entretien − retenue. NB : la retenue
         RG-08 est exprimée en brut (« convention à valider » dans le cahier),
         soustraite ici d'un total à base nette — hétérogénéité signalée. */
      totalAVerserCentimes: netProrata + entretienCentimes - retenueSansSoldeCentimes
    };
  }

  /* ------------------------------------------------------------------ */
  /* §17.5 — La référence d'une journée, et l'écart déclaré               */
  /* ------------------------------------------------------------------ */

  /* Une heure 'HH:MM' en minutes depuis minuit. Refuse tout le reste : une
     heure illisible déplacerait la référence de toutes les journées du mois. */
  function heureEnMinutes(hhmm) {
    var t = String(hhmm == null ? '' : hhmm).slice(0, 5);
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) throw erreurCode('HEURE_INVALIDE');
    return Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  }

  /* LA RÉFÉRENCE D'UNE JOURNÉE (§17.5) : la fin d'accueil PLUS les minutes
     supplémentaires du contrat. 17h30 + 30 min = 18h00.

     Elle vient des CONDITIONS, donc d'un avenant : un avenant qui déplace les
     horaires déplace la référence, sans toucher aux mois d'avant. C'est
     exactement pour ça qu'elle est calculée ici et nulle part ailleurs — un
     écran qui la recomposerait à partir de `contrat` la figerait sur les
     horaires d'aujourd'hui. */
  function heureDeReference(conditions) {
    return heureEnMinutes(conditions.heure_depart) + (conditions.minutes_sup_jour || 0);
  }

  /* L'écart en minutes SIGNÉES que produit un événement déclaré par Maria.

       Minutes du jour = minutes supplémentaires du contrat
                         + (heure réelle − heure de référence)

     Trois événements, et trois seulement — parce que chacun dit QUI a décidé,
     et que c'est ça qui décide si le temps est dû :

       `retard_parent`        un parent est venu après la référence. Écart
                              POSITIF : du travail en plus.
       `liberation_anticipee` Maria a rendu l'enfant avant la référence, de son
                              fait. Écart NÉGATIF : du temps qu'elle rend.
       `arrivee_decalee`      Maria a demandé qu'on lui amène l'enfant plus
                              tard. Écart NÉGATIF, compté sur le MATIN : la
                              référence est alors le début d'accueil.

     Un parent qui vient chercher son enfant plus tôt DE LUI-MÊME n'est aucun
     de ces trois cas : Maria était disponible, ses minutes restent dues, et
     elle ne déclare rien (§17.5, A3). L'application ne devine pas.

     Le signe est CALCULÉ, jamais saisi : c'est lui qui décide si le compteur
     de Maria monte ou descend, et une erreur de signe se propage sur toutes
     les années suivantes (RG-12). */
  function ecartDepuisHeureReelle(conditions, evenement, heureReelle) {
    var reelle = heureEnMinutes(heureReelle);
    if (evenement === 'arrivee_decalee') {
      return heureEnMinutes(conditions.heure_arrivee) - reelle;
    }
    if (evenement === 'retard_parent' || evenement === 'liberation_anticipee') {
      return reelle - heureDeReference(conditions);
    }
    throw erreurCode('ECART_EVENEMENT_INCONNU');
  }

  /* ------------------------------------------------------------------ */
  /* §17.8 — L'indemnité de rupture                                      */
  /* ------------------------------------------------------------------ */

  /* Ancienneté en mois entiers révolus entre deux dates pures. Un contrat
     ouvert le 4 septembre et clos le 3 juin n'a pas neuf mois révolus ; clos
     le 4 juin, il les a. Le seuil des neuf mois se joue au jour près. */
  function ancienneteEnMois(debutStr, finStr) {
    var d = debutStr.split('-');
    var f = finStr.split('-');
    var mois = (Number(f[0]) - Number(d[0])) * 12 + (Number(f[1]) - Number(d[1]));
    if (Number(f[2]) < Number(d[2])) mois--;
    return mois;
  }

  /* Indemnité de rupture (§17.8).

       due à partir de NEUF MOIS d'ancienneté
       = 1/80ᵉ du TOTAL DES SALAIRES BRUTS depuis le début du contrat
       indemnités d'entretien EXCLUES

     `moisBruts` : [{ cle: 'YYYY-MM', brutDuCentimes: n }, …] — le brut
     RÉELLEMENT DÛ de chaque mois, produit par `calculerMois` (ou lu dans
     l'instantané d'un mois clôturé). L'appelant les rassemble ; le moteur ne
     va rien chercher.

     Le moteur ne décide pas de l'assiette : il additionne ce qu'on lui donne.
     Le point non tranché — les indemnités de congés payés versées entrent-
     elles dans le total ? — se règle donc en amont, en les incluant ou non
     dans `moisBruts`. Tant que Maria n'a pas répondu, elles n'y entrent pas,
     et l'écran le mentionne (§17.8).

     UN SEUL arrondi, sur la division finale (§4.2). */
  function indemniteRupture(entrees) {
    var debut = entrees.date_debut;
    var fin = entrees.date_fin;
    var moisBruts = entrees.moisBruts || [];

    var totalBrutCentimes = 0;
    for (var i = 0; i < moisBruts.length; i++) {
      totalBrutCentimes += moisBruts[i].brutDuCentimes || 0;
    }

    if (!debut || !fin) {
      return { due: false, motif: 'DATES_INCOMPLETES', ancienneteMois: null,
               totalBrutCentimes: totalBrutCentimes, indemniteCentimes: 0,
               moisRetenus: moisBruts.length };
    }

    var anciennete = ancienneteEnMois(debut, fin);
    if (anciennete < 9) {
      /* En dessous de neuf mois, l'écran doit dire qu'aucune indemnité n'est
         due ET pourquoi : un zéro sans motif se lit comme une panne. */
      return { due: false, motif: 'ANCIENNETE_INSUFFISANTE',
               ancienneteMois: anciennete, totalBrutCentimes: totalBrutCentimes,
               indemniteCentimes: 0, moisRetenus: moisBruts.length };
    }

    return {
      due: true, motif: null, ancienneteMois: anciennete,
      totalBrutCentimes: totalBrutCentimes,
      indemniteCentimes: Math.round(totalBrutCentimes / 80),
      moisRetenus: moisBruts.length
    };
  }

  /* ------------------------------------------------------------------ */
  /* Le solde de fin de contrat (§17.8) — CORRECTION C1 DE LA RELECTURE  */
  /* ------------------------------------------------------------------ */

  /* « À régler en plus du dernier mois » est LE chiffre que Maria annonce aux
     parents. Il était additionné dans `ui-contrat.js`, poste par poste, à
     quatre endroits — c'est le contrôle B.0-5 mis en défaut sur le montant le
     plus sensible de l'application.

     Cette fonction ne fait rien de neuf : elle assemble RG-13 (les heures
     supplémentaires restantes, majorées) et le §17.8 (l'indemnité de rupture)
     en un seul total, au seul endroit qui a le droit de calculer.

     LE SOLDE D'HEURES NÉGATIF N'EST PAS DÉDUIT. Depuis le §17.5, ce solde peut
     légitimement être négatif ; ce qu'on en fait en fin de contrat est une
     question ouverte pour Maria. Déduire d'office trancherait à sa place, sur
     un chiffre qui part chez une famille. On borne à zéro, et on rend
     `minutesDues` pour que l'écran le DISE.

     `brutMensuelCentimes` à null = rémunération inconnue : rien n'est
     chiffrable, et le dire vaut mieux qu'un zéro crédible. */
  function soldeFinContrat(entrees) {
    var brut = entrees.brutMensuelCentimes;
    var minutesSup = entrees.minutesSupSolde || 0;
    var coefficient = entrees.coefficient === undefined ? 1 : entrees.coefficient;
    var indemnite = entrees.indemnite || { due: false, indemniteCentimes: 0 };

    var chiffrable = brut != null;
    var minutesPayees = Math.max(0, minutesSup);
    var montantSupCentimes = chiffrable
      ? montantCentimes(brut, minutesPayees, coefficient)
      : null;
    var indemniteCentimes = indemnite.due ? (indemnite.indemniteCentimes || 0) : 0;

    return {
      chiffrable: chiffrable,
      minutesSupPayees: minutesPayees,
      /* Positif quand Maria DOIT du temps. Zéro sinon. */
      minutesDues: minutesSup < 0 ? -minutesSup : 0,
      montantSupCentimes: montantSupCentimes,
      indemniteCentimes: indemniteCentimes,
      totalARegler: chiffrable ? (montantSupCentimes + indemniteCentimes) : null
    };
  }

  /* ------------------------------------------------------------------ */
  /* Jours fériés décomptés dans une période de congé (§16.8)            */
  /* ------------------------------------------------------------------ */

  /* Les jours fériés qui tombent dans une période de congé et que RG-06 ne
     décompte donc PAS. La phrase « le samedi 15 août ne compte pas » vient de
     là, et de nulle part ailleurs.

     La période court, comme le décompte lui-même, du premier jour d'absence
     à la veille de la reprise — sans quoi un férié tombant sur le samedi de
     prolongation serait manqué. Les dimanches sont ignorés : ils ne comptent
     jamais, fériés ou non, et les annoncer comme une exception serait faux.

     LOT 17 — cette fonction vivait dans `js/chaine-mois.js` depuis le lot 16
     (`feriesDecomptes`), faute de pouvoir rouvrir le moteur. Elle redit la
     règle RG-06 : sa place est ici, à côté de la boucle qu'elle imite. */
  function feriesDeLaPeriode(debutStr, finStr, joursPlanning) {
    var planning = joursPlanning || PLANNING_DEFAUT;
    if (finStr < debutStr) throw new Error('feriesDeLaPeriode : fin < debut');

    var reprise = Feries.ajouterJours(finStr, 1);
    while (planning.indexOf(jourSemaine(reprise)) === -1 || Feries.estJourFerie(reprise)) {
      reprise = Feries.ajouterJours(reprise, 1);
    }
    var feries = [];
    for (var d = debutStr; d < reprise; d = Feries.ajouterJours(d, 1)) {
      if (jourSemaine(d) === 7) continue;              // un dimanche ne compte jamais
      if (Feries.estJourFerie(d)) feries.push(d);
    }
    return feries;
  }

  /* ------------------------------------------------------------------ */

  var api = {
    joursFeriesFrance: joursFeriesFrance,
    /* §17.8 / correction C1 — le total de fin de contrat, calculé ici et
       nulle part ailleurs. */
    soldeFinContrat: soldeFinContrat,
    estJourFerie: estJourFerie,
    decompterJoursOuvrables: decompterJoursOuvrables,
    imputerConges: imputerConges,
    minutesSupDuJour: minutesSupDuJour,
    montantCentimes: montantCentimes,
    /* LOT 17 — `salaireApplicable` s'appelle désormais `conditionsApplicables`
       et retourne l'avenant entier (§17.3). Aucun alias n'est laissé derrière :
       un nom qui dit « salaire » sur un objet qui porte onze réglages est une
       invitation à ne lire que deux d'entre eux. */
    conditionsApplicables: conditionsApplicables,
    calculerMois: calculerMois,
    /* §17.8 — l'indemnité de rupture, pure comme le reste du moteur. */
    indemniteRupture: indemniteRupture,
    ancienneteEnMois: ancienneteEnMois,
    /* LOT 17 — retrait de deux dettes du lot 16, qui redisaient dans
       `js/chaine-mois.js` une règle appartenant au moteur (RG-06) faute de
       pouvoir l'ouvrir. `joursOuvrablesParMois` existait déjà et n'était pas
       exposée ; `feriesDeLaPeriode` est le déménagement de `feriesDecomptes`. */
    joursOuvrablesParMois: joursOuvrablesParMois,
    feriesDeLaPeriode: feriesDeLaPeriode,
    /* §17.6 — la conversion entre l'unité de stockage (les minutes) et
       l'affichage (les jours) doit se faire au même facteur partout. */
    minutesCpParMois: minutesCpParMois,
    /* §17.5 — la référence d'une journée et la conversion d'une heure réelle
       déclarée en minutes signées. C'est une RÈGLE, pas de l'affichage : elle
       décide du signe, donc du sens du compteur. */
    heureEnMinutes: heureEnMinutes,
    heureDeReference: heureDeReference,
    ecartDepuisHeureReelle: ecartDepuisHeureReelle,
    /* §17.7 — l'assiette du prorata, exposée pour que l'écran puisse dire
       « 12 jours de garde sur 22 » sans la recalculer. */
    partCouverteDuMois: partCouverteDuMois,
    /* utilitaires exposés pour les tests et l'interface */
    jourSemaine: jourSemaine,
    joursDuMois: joursDuMois,
    /* LOT 12 — `detailSupDuJour` était déjà là, calculée et utilisée par
       `minutesSupDuJour` et par `calculerMois` ; elle n'était simplement pas
       exposée. L'écran d'ajustement des heures en a besoin pour montrer
       l'effet d'un choix AVANT de l'enregistrer — et il ne doit surtout pas
       le recalculer lui-même : RG-04 (une journée de congé ne porte aucune
       minute) et RG-09 (les minutes dues quand l'enfant est absent) vivraient
       alors à deux endroits.
       AUCUN CHANGEMENT DE COMPORTEMENT : une ligne ajoutée à la table
       d'export, rien d'autre. Le différentiel exhaustif le vérifie. */
    detailSupDuJour: detailSupDuJour
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.Engine = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
