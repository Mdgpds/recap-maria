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

   LOT 20 — LA FAMILIARISATION DEVIENT UNE PÉRIODE (§20.1 à §20.3). Elle
   n'est plus un simple type de journée : c'est une PÉRIODE de premier rang,
   qui entre dans le moteur COMME DONNÉE (`periodesFamiliarisation`), jamais
   lue par lui depuis la base ni depuis l'horloge. Pendant cette période, la
   rémunération est HORAIRE — seules les minutes déclarées sont payées — et
   la part mensualisée du mois est proratisée sur les jours qui restent.

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

  /* LOT 28 (§28.1) — le plafond de l'article L3141-3 : 30 jours ouvrables
     par exercice de référence. Il n'existait nulle part. Le moteur ne voit
     pas l'exercice : il reçoit le cumul déjà acquis et borne ce mois-ci. */
  var PLAFOND_CP_JOURS_PAR_EXERCICE = 30;

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
     les dimanches et les jours fériés.

     LA RÈGLE DES CINQ SAMEDIS (specs du 24 août 2026, §2.2). Les samedis ne
     sont plus inclus systématiquement. Un samedi que Maria NE TRAVAILLE PAS
     n'est décompté que s'il figure dans `samedisComptes`. Un samedi qui est
     dans le planning du contrat reste décompté d'office — c'est une vraie
     journée de garde manquée —, et un samedi férié n'est jamais décompté.

     `samedisComptes` : liste (ou objet indexé) de dates ISO. Le moteur ne va
     jamais les chercher : elles lui ARRIVENT en donnée, comme les journées et
     les avenants. Il ne connaît pas l'année de référence ni le quota de cinq —
     ce sont des affaires de base et d'écran, pas de calcul.

     Semaine complète lundi -> vendredi, reprise le lundi : 5 sans le samedi,
     6 avec. Lundi -> mercredi, reprise le jeudi = 3. Un jour isolé = 1. */
  function decompterJoursOuvrables(debutStr, finStr, joursPlanning, samedisComptes) {
    var tranches = joursOuvrablesParMois(debutStr, finStr, joursPlanning, samedisComptes);
    var n = 0;
    for (var i = 0; i < tranches.length; i++) n += tranches[i].jours;
    return n;
  }

  /* `samedisComptes` peut arriver en tableau ou en objet indexé : on rend un
     test d'appartenance, et `null`/absent vaut « aucun samedi compté ». */
  function ensembleDeSamedis(samedisComptes) {
    var vus = {};
    if (!samedisComptes) return vus;
    if (Object.prototype.toString.call(samedisComptes) === '[object Array]') {
      for (var i = 0; i < samedisComptes.length; i++) {
        if (samedisComptes[i]) vus[String(samedisComptes[i]).slice(0, 10)] = true;
      }
      return vus;
    }
    for (var k in samedisComptes) {
      if (Object.prototype.hasOwnProperty.call(samedisComptes, k) && samedisComptes[k]) {
        vus[String(k).slice(0, 10)] = true;
      }
    }
    return vus;
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
  function joursOuvrablesParMois(debutStr, finStr, joursPlanning, samedisComptes) {
    var planning = joursPlanning || PLANNING_DEFAUT;
    if (finStr < debutStr) throw new Error('joursOuvrablesParMois : fin < debut');
    var comptes = ensembleDeSamedis(samedisComptes);
    var samediTravaille = planning.indexOf(6) !== -1;

    var reprise = Feries.ajouterJours(finStr, 1);
    while (planning.indexOf(jourSemaine(reprise)) === -1 || Feries.estJourFerie(reprise)) {
      reprise = Feries.ajouterJours(reprise, 1);
    }
    var moisDeFin = finStr.slice(0, 7);

    var tranches = [];
    for (var d = debutStr; d < reprise; d = Feries.ajouterJours(d, 1)) {
      if (jourSemaine(d) === 7) continue;      // dimanche exclu
      if (Feries.estJourFerie(d)) continue;    // férié exclu
      /* LA RÈGLE DES CINQ SAMEDIS, et sa limite exacte. Un samedi du planning
         se décompte d'office (§2.5) ; un samedi non travaillé ne se décompte
         que s'il a été choisi. Le quota de cinq n'est PAS vérifié ici : le
         moteur compte ce qu'on lui donne, l'écran et la base tiennent le
         quota. */
      if (jourSemaine(d) === 6 && !samediTravaille && !comptes[d]) continue;
      var cle = (d <= finStr) ? d.slice(0, 7) : moisDeFin;
      var derniere = tranches[tranches.length - 1];
      if (derniere && derniere.cle === cle) derniere.jours++;
      else tranches.push({ cle: cle, jours: 1 });
    }
    return tranches;
  }

  /* LES SAMEDIS QU'UNE PÉRIODE PROPOSE AU CHOIX (§5.2).

     Ce sont les samedis de la période — bornes du décompte comprises, donc
     jusqu'à la veille de la reprise — qui ne sont NI dans le planning du
     contrat, NI fériés. Les autres ne sont pas des choix : le premier se
     décompte d'office, le second ne se décompte jamais.

     Cette liste vit dans le moteur, à côté de la boucle qu'elle imite, pour
     la même raison que `feriesDeLaPeriode` (lot 17) : un écran qui la
     recalculerait redirait la règle RG-06 une deuxième fois, et les deux
     divergeraient. */
  function samedisEligibles(debutStr, finStr, joursPlanning) {
    var planning = joursPlanning || PLANNING_DEFAUT;
    if (finStr < debutStr) throw new Error('samedisEligibles : fin < debut');
    if (planning.indexOf(6) !== -1) return [];   // samedi travaillé : aucun choix

    var reprise = Feries.ajouterJours(finStr, 1);
    while (planning.indexOf(jourSemaine(reprise)) === -1 || Feries.estJourFerie(reprise)) {
      reprise = Feries.ajouterJours(reprise, 1);
    }
    var out = [];
    for (var d = debutStr; d < reprise; d = Feries.ajouterJours(d, 1)) {
      if (jourSemaine(d) !== 6) continue;
      if (Feries.estJourFerie(d)) continue;
      out.push(d);
    }
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* LA RÉCUPÉRATION SE GAGNE JOUR APRÈS JOUR                            */
  /* (brief du 28 août 2026 — règle et trois arbitrages d'Adrien)        */
  /*                                                                      */
  /* La réserve de récupération n'est plus figée au 1er du mois : chaque  */
  /* journée travaillée l'alimente, et un jour de récupération impossible */
  /* le 5 mai devient possible le 28 parce qu'entre-temps Maria a         */
  /* travaillé. Trois arbitrages fermes :                                 */
  /*   1. seules les journées DÉJÀ PASSÉES comptent — jamais une journée  */
  /*      à venir, même prévue au planning ;                              */
  /*   2. les congés payés ne changent pas : réserve d'ENTRÉE du mois ;   */
  /*   3. le jour posé ne se finance pas lui-même — il n'est pas          */
  /*      travaillé, il ne rapporte aucune minute.                        */
  /*                                                                      */
  /* LE MOTEUR RESTE PUR : « aujourd'hui » n'est pas lu à l'horloge, il   */
  /* ENTRE PAR LES PARAMÈTRES (`entrees.aujourdhui`), comme les journées  */
  /* et les imputations. Absent, tout ce mécanisme est neutre et le       */
  /* moteur se comporte exactement comme avant ce lot.                    */
  /* ------------------------------------------------------------------ */

  /* Ajoute `minutes` au crédit de récupération du jour `jour`. Les jours
     sont crédités dans l'ordre du calendrier : la liste sort triée sans
     qu'on ait à la trier. */
  function crediterJour(liste, jour, minutes) {
    if (!minutes) return;
    for (var i = 0; i < liste.length; i++) {
      if (liste[i].jour === jour) { liste[i].minutes += minutes; return; }
    }
    liste.push({ jour: jour, minutes: minutes });
  }

  /* Même chose pour la consommation d'une période, rattachée à sa date de
     début. Deux périodes ne peuvent pas commencer le même jour (contrainte
     d'exclusion), mais on additionne plutôt que d'écraser : perdre une
     consommation en silence serait une réserve annoncée trop grande. */
  function crediterConsommation(liste, dateDebut, minutes, enDepassement) {
    if (!minutes && !enDepassement) return;
    for (var i = 0; i < liste.length; i++) {
      if (liste[i].date_debut === dateDebut) {
        liste[i].minutes += minutes;
        liste[i].minutesEnDepassement += (enDepassement || 0);
        return;
      }
    }
    liste.push({ date_debut: dateDebut, minutes: minutes,
                 minutesEnDepassement: enDepassement || 0 });
  }

  /* Minutes de récupération ACQUISES dans le mois avant `jour`, en ne
     comptant que les journées déjà passées au regard d'`aujourdhui`.
     `aujourdhui` nul = aucun filtre de date du jour : c'est ce qui sert à
     distinguer « pas encore acquis » de « jamais finançable » (§4.3). */
  function recuperationAcquiseAvant(minutesSupParJour, jour, aujourdhui) {
    var liste = minutesSupParJour || [];
    var total = 0;
    for (var i = 0; i < liste.length; i++) {
      var d = liste[i].jour;
      if (jour && d >= jour) continue;              // arbitrage 3 : le jour posé ne se finance pas
      if (aujourdhui && d >= aujourdhui) continue;  // arbitrage 1 : jamais une journée à venir
      total += liste[i].minutes;
    }
    return total;
  }

  /* Minutes de récupération DÉJÀ CONSOMMÉES dans le mois avant `jour` :
     les périodes de congé ventilées sur la récupération plus tôt dans le
     mois. Les écarts d'horaire imputés sur la récupération, eux, sont déjà
     dans `minutesSupParJour` — ils y entrent en négatif, jour par jour. */
  function recuperationConsommeeAvant(consommeeParPeriode, jour) {
    var liste = consommeeParPeriode || [];
    var total = 0;
    for (var i = 0; i < liste.length; i++) {
      if (jour && liste[i].date_debut >= jour) continue;
      total += liste[i].minutes;
    }
    return total;
  }

  /* La formule du §1 du brief, énoncée une fois et lue partout — moteur
     comme écrans :

       récupération disponible en J
         = minutesSup du compteur d'ENTRÉE du mois
         + 30 min × journées travaillées du 1er à la VEILLE de J, déjà passées
         − minutes de récupération déjà consommées dans le mois avant J

     `aujourdhui` absent : on rend le compteur d'entrée, c'est-à-dire le
     comportement d'avant ce lot. Aucun appelant sans horloge ne change de
     réponse. */
  function recuperationALaDate(resultat, minutesSupEntree, jour, aujourdhui) {
    var base = minutesSupEntree || 0;
    if (!resultat || !aujourdhui || !jour) return base;
    return base
      + recuperationAcquiseAvant(resultat.minutesSupParJour, jour, aujourdhui)
      - recuperationConsommeeAvant(resultat.recuperationConsommeeParPeriode, jour);
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
  /* LOT 31 §6 — `minutesAnticipationCp` (5e paramètre, OPTIONNEL).

     Maria peut poser des congés payés qu'elle n'a pas encore acquis, mais
     UNIQUEMENT pour des jours du mois en cours : ce sont les 2,5 jours
     qu'elle est en train d'acquérir. Pour un mois à venir, seuls les jours
     déjà acquis sont posables.

     LE MOTEUR NE SAIT PAS QUEL MOIS ON EST, et il ne doit pas l'apprendre.
     Il reçoit un NOMBRE DE MINUTES d'anticipation, déjà décidé par l'appelant
     qui, lui, connaît le mois de référence. Absent ou zéro, le comportement
     est celui d'avant ce lot, au caractère près.

     Ce paramètre n'ouvre RIEN d'autre : il ne desserre que le contrôle n° 3,
     celui qui refusait un dépassement des congés payés. Le sans solde, la
     récupération et les deux premiers contrôles sont intacts. */
  function imputerConges(nbJours, compteur, conditions, imputationImposee,
                         minutesAnticipationCp) {
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
      /* 3. LES CONGÉS PAYÉS, ET EUX SEULS, NE PEUVENT PAS ÊTRE DÉPASSÉS.

         ARBITRAGE 4 DU 28 AOÛT 2026 — « la récupération peut passer en
         négatif, et la pose n'est JAMAIS refusée ». Maria a pris par le passé
         des journées de récupération que son solde ne couvrait pas ;
         l'application doit pouvoir les enregistrer telles qu'elles ont eu
         lieu. Elle AVERTIT, elle ne bloque pas — l'avertissement vit dans les
         écrans (§4.3), le refus a disparu d'ici.

         Aucun écrêtage non plus, et c'est aussi important que le refus levé :
         la ventilation est appliquée TELLE QUE MARIA L'A CHOISIE, sans qu'un
         jour bascule en silence vers le sans solde. Un jour déplacé sans
         qu'elle le sache serait une retenue sur son salaire qu'elle n'a pas
         décidée.

         Les congés payés gardent leur garde-fou (§28.3, tranché le 25 août) :
         ils ne descendent jamais sous zéro, par aucun chemin. Le disponible
         peut être négatif (compteur incohérent, reprise manuelle erronée) :
         dans ce cas toute consommation de congés payés est refusée. */
      /* LOT 31 §6 — LE DÉPASSEMENT BORNÉ, ET RIEN AU-DELÀ.

         Le plafond monte de `minutesAnticipationCp`, jamais d'un pas de plus.
         Ce que ce paramètre NE change pas : les congés payés ne descendent
         toujours pas librement sous zéro (§28.3, tranché le 25 août) — ils
         descendent d'un montant DÉCIDÉ, et pas d'une minute au-delà. Un
         disponible négatif (compteur incohérent, reprise erronée) ne devient
         pas posable pour autant : l'anticipation s'ajoute à ce qu'il est,
         elle ne le remet pas à zéro. */
      var dispoCp = (compteur && compteur.minutesCp) || 0;
      var plafondCp = dispoCp + Math.max(0, minutesAnticipationCp || 0);
      if (impCp * minutesParJour > plafondCp) {
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
  /* LOT 28 (§28.2) ET LOT 29 (§29.2) — L'ABSENCE DE L'ENFANT N'EN PRODUIT
     PLUS AUCUNE. Décision d'Adrien du 25 août 2026, confirmée le 26 :
     « si l'enfant est absent, pas de 30 min ni de frais d'entretien ».
     L'entretien sautait déjà (RG-09) ; les minutes du contrat restaient dues
     par défaut, et un écart d'horaire déclaré par erreur sur une absence
     retirait de la récupération un temps que Maria n'avait pas à rendre.

     Le réglage `sup_dues_si_enfant_absent` et la surcharge `sup_dues_override`
     RESTENT en base (aucune migration) mais n'ont plus d'effet sur le calcul :
     une journée sans enfant n'a pas d'horaire de référence, donc ni base, ni
     minutes ajoutées, ni écart possible — exactement comme un jour férié. */
  var TYPES_SANS_MINUTES = ['ferie', 'conge_maria', 'sans_solde',
                            'familiarisation', 'hors_planning', 'absence_enfant'];

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

    /* 3. LOT 28 — LA BRANCHE RG-09 A DISPARU D'ICI. `absence_enfant` est
       entré dans `TYPES_SANS_MINUTES` : la journée est sortie au point 1, sans
       base, sans écart, quel que soit le réglage du contrat ou la surcharge
       de la journée. Voir le commentaire de la liste. */

    /* 4. Minutes travaillées au-delà du contrat ce jour-là (V8-18). */
    var ajoutees = minutesSaisies(journee && journee.minutes_sup_exceptionnelles,
                                  'minutes_sup_exceptionnelles');

    /* 5. LOT 28 (§28.6) — L'ÉCART D'ABORD, LE RENONCEMENT ENSUITE.

       L'heure de référence contient déjà les minutes du contrat : un écart
       négatif mesuré contre elle les a donc DÉJÀ retirées. Le renoncement était
       borné à `base + ajoutées` sans regarder l'écart, et les retirait une
       seconde fois : « −60 » seul donnait 600 min sur le mois, « −60 » plus un
       renoncement de 30 en donnait 570. Le plancher devient ce qui reste
       réellement dû APRÈS l'écart imputé à la récupération —
       max(0, base + ajoutées + écart) — et le renoncement ne peut plus rendre
       la journée négative deux fois. Un écart déduit des congés payés ou en
       sans solde ne réduit pas les minutes du jour : il ne réduit donc pas non
       plus ce à quoi Maria peut renoncer. */
    var ecartAvant = lireEcart(journee);

    /* 6. Renoncement explicite (V8-18), BORNÉ : on ne peut pas renoncer à
       plus que ce qui est dû. Sans ce plancher, un renoncement ferait
       AUGMENTER le compteur — le Math.min n'est pas une élégance, c'est la
       garde. Le surplus est ignoré, jamais négatif. */
    var renoncees = Math.min(
      minutesSaisies(journee && journee.minutes_sup_renoncees, 'minutes_sup_renoncees'),
      Math.max(0, base + ajoutees + ecartAvant.ecartSurRecuperation)
    );

    var ecart = ecartAvant.ecart;
    var destination = ecartAvant.destination;

    return {
      base: base, ajoutees: ajoutees, renoncees: renoncees,
      ecart: ecart,
      ecartImputeSur: ecart === 0 ? null : (ecart > 0 ? 'recuperation' : destination),
      /* Ce que l'écart fait au compteur de récupération : tout le positif,
         et le négatif seulement s'il lui est imputé. */
      ecartSurRecuperation: ecartAvant.ecartSurRecuperation,
      /* Minutes de congés payés consommées par l'écart, toujours positives.
         LOT 28 (§28.3) — c'est ce que la journée DEMANDE ; `calculerMois`
         borne au disponible du mois et bascule le surplus sur la
         récupération. Une journée seule ne connaît pas le compteur. */
      minutesSurCp: (ecart < 0 && destination === 'conges_payes') ? -ecart : 0,
      /* Minutes retenues sans solde, toujours positives. */
      minutesSansSolde: (ecart < 0 && destination === 'sans_solde') ? -ecart : 0
    };
  }

  /* L'écart d'une journée et sa destination, lus une fois pour deux usages :
     le plancher du renoncement (point 5) et le détail rendu (point 6). */
  function lireEcart(journee) {
    /* LOT 17 (§17.5) — l'écart d'horaire déclaré.

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
      ecart: ecart,
      destination: destination,
      ecartSurRecuperation: (ecart > 0 || destination === 'recuperation') ? ecart : 0
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
  /* LOT 20 (§20.3) — LA PÉRIODE DE FAMILIARISATION EST UNE TROISIÈME BORNE.

     Le prorata du lot 17 excluait les jours hors des dates du contrat. Un mois
     mêlé — familiarisation du 1er au 19, garde ensuite — se calcule « en deux
     parts » : la première aux heures déclarées, « le reste mensualisé au
     prorata des jours couverts ». Les jours de familiarisation sortent donc du
     numérateur, exactement comme les jours hors contrat, et pour la même
     raison : ils sont payés autrement.

     Le DÉNOMINATEUR ne bouge pas. C'est le mois entier au planning, et c'est
     lui qui rend la phrase « 8 jours travaillés sur 22 » lisible pour une
     famille. Le retrancher aussi ferait payer un mois plein pour huit jours.

     Sans période, `joursFamiliarisation` vaut 0 et la fonction rend le même
     couple qu'avant le lot 20, au jour près. */
  function partCouverteDuMois(contrat, planning, annee, mois, periodesFam, parJour) {
    var jours = joursDuMois(annee, mois);
    var total = 0;
    var couverts = 0;
    var enFamiliarisation = 0;
    for (var i = 0; i < jours.length; i++) {
      var d = jours[i];
      if (planning.indexOf(jourSemaine(d)) === -1) continue;
      total++;
      if (contrat.date_debut && d < contrat.date_debut) continue;
      if (contrat.date_fin && d > contrat.date_fin) continue;
      /* CORRECTION B1 — AUCUN JOUR N'EST DÉDUIT DEUX FOIS.

         Un jour qui échappe à la période suit son chemin ordinaire : il est
         décompté en jours ouvrables, ou il porte une retenue de sans solde.
         Cette retenue (RG-08) existe précisément pour ANNULER la part
         mensualisée de la journée. Si le jour était en plus retranché du
         prorata, la même journée serait déduite deux fois — 63,36 € de retenue
         ET 1/22 du mois en moins. Il revient donc dans les jours couverts,
         exactement comme dans un mois sans familiarisation.

         `parJour` est optionnel : sans lui, la fonction se comporte comme
         avant la correction. Les écrans qui l'appellent pour afficher « 8 jours
         sur 22 » doivent le fournir, sinon leur quotient diverge de celui du
         moteur. */
      if (estEnFamiliarisation(d, periodesFam) &&
          !echappeALaPeriode(parJour && parJour[d])) {
        enFamiliarisation++;
        continue;
      }
      couverts++;
    }
    return {
      joursCouverts: couverts,
      joursDuMois: total,
      joursFamiliarisation: enFamiliarisation
    };
  }

  /* ------------------------------------------------------------------ */
  /* §20.1 — Les périodes de familiarisation                             */
  /* ------------------------------------------------------------------ */

  /* Une période est une paire de dates pures, bornes INCLUSES, telle que la
     table `periode_familiarisation` la porte. Le moteur ne la lit jamais
     lui-même : elle lui arrive en entrée, comme les journées et les
     imputations. Deux périodes d'un même contrat ne peuvent pas se chevaucher
     (contrainte d'exclusion de la migration 016), mais le moteur ne s'y fie
     pas : il répond « oui » dès la première qui contient le jour. */
  function periodeFamiliarisationDuJour(dateStr, periodes) {
    for (var i = 0; i < (periodes || []).length; i++) {
      var p = periodes[i];
      if (!p || !p.date_debut || !p.date_fin) continue;
      if (dateStr >= p.date_debut && dateStr <= p.date_fin) return p;
    }
    return null;
  }

  function estEnFamiliarisation(dateStr, periodes) {
    return periodeFamiliarisationDuJour(dateStr, periodes) !== null;
  }

  /* CORRECTION B1 DE LA RELECTURE DU LOT 20 — CE QUE LA PÉRIODE NE DOIT PAS
     AVALER.

     La priorité de la période sur la ligne de journée reste la bonne décision :
     sans elle, un jour non déclaré serait payé une journée mensualisée pleine.
     C'est son ÉTENDUE qui était trop large.

     Deux types de journée TOUCHENT UN COMPTEUR, et les compteurs ne se
     remettent jamais à zéro (RG-12) : un congé de Maria consomme des congés
     payés ou de la récupération et pèse sur l'acquisition du mois ; un jour
     sans solde déclenche une retenue (RG-08). Les avaler faussait, en silence,
     des soldes qui se propagent sur des années. Ces deux-là gardent donc leur
     type et suivent leur chemin ordinaire, même à l'intérieur d'une période.

     Tout le reste reste avalé, et c'est exactement ce que la priorité de la
     période existe pour couvrir : l'ABSENCE de ligne, `presence`,
     `absence_enfant`, `ferie`, `hors_planning`. Aucun de ces cas ne touche un
     compteur, et aucun ne doit payer une journée mensualisée que la
     familiarisation remplace.

     DÉCISION D'ADRIEN, 23 août 2026 : le cas n'est pas censé se produire — une
     familiarisation est en début de contrat, avant tout compteur. S'il se
     produit, « Maria prendra du sans solde, ou surtout sera amenée à modifier
     la plage de dates de la familiarisation ». Le sans solde doit donc être
     honoré, pas escamoté. */
  var TYPES_QUI_ECHAPPENT_A_LA_PERIODE = ['conge_maria', 'sans_solde'];

  function echappeALaPeriode(ligne) {
    return !!(ligne && TYPES_QUI_ECHAPPENT_A_LA_PERIODE.indexOf(ligne.type) !== -1);
  }

  /* §20.4 d — LES JOURS OUVRÉS D'UNE PÉRIODE, dans l'ordre.

     L'écran de la période liste « chaque jour ouvré de la période avec son
     état ». Savoir quels jours du calendrier sont au planning est une règle du
     moteur (c'est la même que celle du prorata) : un écran qui la referait la
     ferait vivre à deux endroits, et le jour où un contrat passe au mercredi
     l'un des deux resterait en arrière.

     Les bornes du contrat ne sont pas appliquées ici : la période est bornée
     par elle-même, et un écran qui affiche une période veut la voir en entier,
     y compris la partie qu'un contrat raccourci ne couvrirait plus. */
  function joursOuvresDePeriode(debutStr, finStr, joursPlanning) {
    var planning = joursPlanning || PLANNING_DEFAUT;
    var out = [];
    if (!debutStr || !finStr || finStr < debutStr) return out;
    var d = debutStr;
    /* Borne dure : une période aberrante ne doit pas faire tourner l'écran
       indéfiniment. Dix ans de jours, c'est déjà mille fois trop pour une
       familiarisation de cinq à dix jours (RG-14). */
    for (var garde = 0; garde < 3700 && d <= finStr; garde++) {
      if (planning.indexOf(jourSemaine(d)) !== -1) out.push(d);
      d = Feries.ajouterJours(d, 1);
    }
    return out;
  }

  /* `contratCouvreLeMois` A DISPARU AU LOT 28 : l'acquisition des congés payés
     ne dépend plus du tout-ou-rien de la couverture du mois, mais du prorata
     de `partCouverteDuMois`, comme le salaire (§28.1). */

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
  function repartirImputationParMois(imputation, planning, samedisComptes) {
    var tranches = joursOuvrablesParMois(imputation.date_debut, imputation.date_fin,
      planning, samedisComptes);
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
       periodesFamiliarisation
                      : LOT 20 (§20.1) — les lignes de
                        `periode_familiarisation` du contrat qui RECOUPENT le
                        mois, bornes incluses. Absent ou vide = comportement
                        d'avant le lot 20, au centime près.
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
    /* LOT 28 (§28.9) — UN PLANNING VIDE EST REFUSÉ. `[]` est vrai en
       JavaScript : il passait le `||`, aucun jour n'était au planning, le
       prorata lisait 0 jour sur 0 et payait un mois entier pour zéro jour de
       garde. L'écran de saisie refuse déjà un planning vide ; un `[]` en base
       est une donnée fausse, et une donnée fausse se refuse — elle ne se
       remplace pas en silence par le lundi-vendredi. */
    if (Array.isArray(conditions.jours_planning) && conditions.jours_planning.length === 0) {
      throw erreurCode('PLANNING_VIDE');
    }
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

    /* LOT 20 (§20.1) — les périodes de familiarisation, en DONNÉE. Le moteur
       ne les lit ni en base ni à l'horloge : c'est la couche d'appel qui les
       charge et les lui passe, comme les journées et les imputations. */
    var periodesFam = entrees.periodesFamiliarisation || [];

    /* LA RÈGLE DES CINQ SAMEDIS (§4.1 des specs du 24 août 2026) — LES SAMEDIS
       COMPTÉS, EN DONNÉE. Comme les journées, les imputations et les périodes
       de familiarisation : le moteur ne va jamais les chercher. Ce sont les
       samedis que Maria a cochés pour CE contrat ; leur année de référence et
       leur quota de cinq ne le regardent pas.

       Un même samedi n'appartient qu'à une seule période — deux périodes d'un
       même contrat ne peuvent pas se chevaucher (contrainte
       `imputation_sans_chevauchement`) — donc un ensemble plat suffit et ne
       peut pas être ambigu. */
    var samedisComptes = entrees.samedisComptes || [];

    /* LA RÉCUPÉRATION SE GAGNE JOUR APRÈS JOUR — LA DATE DU JOUR, EN DONNÉE.
       Le moteur n'a pas d'horloge et n'en aura pas : c'est la chaîne qui lui
       passe `aujourdhui` (`YYYY-MM-DD`). ABSENTE, le moteur se comporte
       exactement comme avant ce lot — aucun appelant n'est cassé, et les
       tests écrits sans elle ne changent pas de sens. */
    var aujourdhui = entrees.aujourdhui || null;

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
    /* LOT 28 (§28.3) — les minutes qu'un écart demande aux CONGÉS PAYÉS ne
       sont pas retirées au fil des jours : elles sont rassemblées ici, dans
       l'ordre des jours, et servies APRÈS les périodes de congé, chacune
       bornée à ce qui reste. Voir plus bas, « les congés payés ne passent
       jamais sous zéro ». */
    var ecartsSurCpAImputer = [];
    var nbJoursTraites = 0;
    var joursConge = [];             // jours 'conge_maria' posés dans le mois
    var joursSansSoldeSaisis = 0;    // lignes 'sans_solde' saisies explicitement
    var joursFamiliarisation = 0;    // lignes 'familiarisation' HORS période (legacy)
    /* §20.6 — journées dont Maria a retiré l'indemnité d'entretien.
       Le document doit pouvoir écrire « 19 jours × 5,50 € + 1 jour sans
       indemnité » : sans ce compte, le détail ne reconstitue pas le total et
       la règle existante l'efface — on perdrait l'explication, pas le chiffre.

       CORRECTION C1 DE LA RELECTURE — UN COMPTE PAR PART, comme les montants.
       Un seul compteur additionnait les deux parts du mois. `libelleEntretien-
       Detaille` confrontait alors `(joursPresence − joursSansEntretien) × tarif`
       au seul entretien de la GARDE : les deux ne tombaient plus juste, et le
       détail disparaissait — sur un document dont c'est justement le détail
       qui éteint la contestation.

       Le champ de premier niveau reste celui de la GARDE, et ce n'est pas un
       détail de nommage : les instantanés d'avant le lot 20 ne le portent pas,
       `ui-document.js` le lit avec `|| 0`, et un mois clôturé doit continuer de
       se lire exactement pareil pour toujours (RG-15). */
    var joursSansEntretien = 0;          // part mensualisée
    var famJoursSansEntretien = 0;       // part familiarisation
    /* §20.1 à §20.3 — la période de familiarisation, jour par jour. */
    var famJoursDeLaPeriode = 0;     // jours du planning du mois dans une période
    var famJoursDeclares = 0;        // ceux où des minutes ont été déclarées
    var famMinutes = 0;              // total des minutes déclarées du mois
    var famJoursAvecEntretien = 0;
    var famEntretienCentimes = 0;
    /* Les jours de la période qui portaient une AUTRE saisie (un congé posé
       en groupe, un férié, une absence). Ils sont traités en familiarisation
       comme tous les autres jours de la période — mais on ne l'avale pas :
       l'écran doit pouvoir le dire (B.0-9). */
    var famJoursIgnores = [];
    /* Le détail jour par jour du mois : l'écran de la période et la carte de
       l'Accueil en ont besoin, et aucun des deux ne doit le reconstituer —
       « seules les minutes déclarées comptent » est une règle, pas un
       affichage. Le moteur n'a pas d'horloge : c'est l'écran qui distingue
       « à déclarer » (jour passé) de « à venir », lui seul sait quel jour on
       est. Ici, on dit seulement ce qui EST déclaré. */
    var famJours = [];
    /* Type retenu pour chaque journée effectivement traitée du mois — jour du
       planning, dans les bornes du contrat. Sert au contrôle de correspondance
       B1 plus bas : une imputation doit correspondre aux journées RÉELLEMENT
       posées, pas seulement les encadrer. */
    var typeDuJourTraite = {};
    /* Ce que CHAQUE jour du mois apporte à la récupération, dans l'ordre du
       calendrier. C'est le relevé sur lequel se lit la réserve à une date —
       et il n'ajoute aucune règle : ce sont les minutes que le moteur crédite
       déjà, journée par journée, selon les règles en vigueur (ni congé payé,
       ni récupération, ni sans solde, ni familiarisation, et l'absence de
       l'enfant seulement si l'avenant le dit). */
    var minutesSupParJour = [];
    /* Ce que chaque période de congé du mois CONSOMME sur la récupération,
       rattaché à sa date de début. L'autre moitié de la formule du §1. */
    var recuperationConsommeeParPeriode = [];

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

      /* LOT 20 (§20.4) — LA PÉRIODE PRIME SUR LA LIGNE.

         Sans cette priorité, un jour de la période sans déclaration serait
         présumé 'presence' (saisie par exception) : il paierait une journée
         mensualisée pleine, son entretien et ses 30 minutes — l'exact
         contraire de « seules les minutes déclarées sont payées ». La période
         est de premier rang : à l'intérieur de ses bornes, le jour est de la
         familiarisation, quoi que porte la ligne.

         Un jour de la période qui portait une AUTRE saisie (un congé posé sur
         les quatre contrats, un férié, une absence d'enfant) est donc traité
         en familiarisation lui aussi — et il est NOMMÉ dans `joursIgnores`,
         pour que l'écran puisse le dire au lieu de l'avaler. */
      /* CORRECTION B1 — un congé de Maria et un jour sans solde gardent leur
         type et suivent leur chemin ordinaire, même dans la période. Voir
         `echappeALaPeriode` pour le raisonnement. */
      if (estEnFamiliarisation(d, periodesFam) && !echappeALaPeriode(ligne)) {
        typeDuJourTraite[d] = 'familiarisation';
        famJoursDeLaPeriode++;
        /* §28.1 — un jour de familiarisation est un jour travaillé pour
           l'acquisition des congés payés (décision du lot 20, confirmée). */
        nbJoursTraites++;
        if (ligne && ligne.type && ligne.type !== 'familiarisation') {
          famJoursIgnores.push(d);
        }

        /* Les minutes réellement faites, déclarées à la main. Rien de déclaré
           = rien de payé : ni salaire, ni entretien. Un jour à zéro minute
           déclarée n'est pas un jour déclaré — sinon l'entretien serait dû
           sur un jour où l'enfant n'est pas venu. */
        var minutesJour = minutesSaisies(ligne && ligne.minutes_reelles,
                                         'minutes_reelles');
        if (minutesJour > 0) {
          famJoursDeclares++;
          famMinutes += minutesJour;
          /* §20.3 — l'entretien du jour est un CHOIX, et il paie le montant
             PLEIN, jamais un prorata des heures. `entretien_du` vaut `true`
             par défaut en base (migration 016) : retirer est un geste, pas un
             automatisme (§20.6). `entretien_centimes` reste, comme partout
             ailleurs, la surcharge du MONTANT quand l'indemnité est due. */
          if (ligne && ligne.entretien_du === false) {
            famJoursSansEntretien++;
          } else {
            famJoursAvecEntretien++;
            famEntretienCentimes += (ligne && Number.isInteger(ligne.entretien_centimes))
              ? ligne.entretien_centimes
              : conditions.entretien_centimes_jour;
          }
        }

        famJours.push({
          jour: d,
          minutes: minutesJour,
          declare: minutesJour > 0,
          entretien: minutesJour > 0 && !(ligne && ligne.entretien_du === false),
          ecarte: !!(ligne && ligne.type && ligne.type !== 'familiarisation')
        });

        /* §20.3 — aucune minute supplémentaire n'est acquise ni due pendant
           la période. On saute donc `detailSupDuJour` entièrement : il n'y a
           ni base, ni écart possible sur une journée sans horaire de
           référence. */

        /* LOT 28 (§28.5) — UN CONGÉ POSÉ À L'HEURE N'EST PLUS AVALÉ.

           La période prime sur la ligne, et c'est toujours vrai pour la paie :
           la journée reste payée aux heures déclarées, sans minutes du contrat
           (décision d'Adrien du 26 août : « Maria doit pouvoir poser des
           congés sur une familiarisation », « elle est payée en fonction du
           nombre d'heures travaillées »). Mais le congé lui-même TOUCHE UN
           COMPTEUR, comme un congé de journée entière : ses minutes sortent des
           congés payés ou de la récupération. Elles étaient perdues — le congé
           restait en base, s'affichait dans « Mes congés », et n'existait ni
           pour le récapitulatif ni pour le document.

           Le sans solde n'y produit aucune retenue : les heures non travaillées
           ne sont simplement pas déclarées, donc pas payées. Une retenue en
           plus les déduirait deux fois. */
        if (ligne && ligne.ecart_evenement === 'conge_horaire') {
          var congeFam = lireEcart(ligne);
          if (congeFam.ecart < 0) {
            if (congeFam.destination === 'conges_payes') {
              ecartsSurCpAImputer.push({ jour: d, minutes: -congeFam.ecart });
            } else if (congeFam.destination === 'recuperation') {
              minutesEcartRecuperation += congeFam.ecart;
              /* Un congé posé à l'heure sur la récupération est une
                 consommation datée : elle entre au relevé du jour, en
                 négatif, comme n'importe quel écart imputé à la récupération. */
              crediterJour(minutesSupParJour, d, congeFam.ecart);
            }
            ecartsDeclares.push({
              jour: d, minutes: congeFam.ecart, evenement: 'conge_horaire',
              imputeSur: congeFam.destination, enFamiliarisation: true,
              minutesSurCp: congeFam.destination === 'conges_payes' ? -congeFam.ecart : 0,
              minutesSurRecuperation: congeFam.destination === 'recuperation' ? -congeFam.ecart : 0,
              minutesSansSolde: 0
            });
          }
        }
        continue;
      }

      /* Saisie par exception (§5) : sans ligne, un jour du planning est
         présumé 'presence' — sauf s'il est férié (RG-10 : Maria ne
         travaille jamais un jour férié). Une ligne explicite prime. */
      var type = ligne ? ligne.type : (Feries.estJourFerie(d) ? 'ferie' : 'presence');
      typeDuJourTraite[d] = type;
      nbJoursTraites++;

      switch (type) {
        case 'presence':
          /* RG-01 : jour de présence acquis dès 1 h de garde, pas de
             demi-journée. RG-02 : indemnité par jour de présence (surcharge
             manuelle possible via journee.entretien_centimes, cf. RG-14). */
          joursPresence++;
          /* §20.6 — L'ENTRETIEN RETIRABLE, ET SEULEMENT HORS DU CADRE.

             La journée reste comptée présente pour tout le reste : le salaire
             ne bouge pas, les minutes non plus. Seule l'indemnité saute. Le
             moteur, lui, ne vérifie pas que la journée « sort du cadre » —
             c'est l'écran qui n'offre l'interrupteur que là où il a un sens
             (§20.6), et le moteur qui obéit à ce qui est écrit. */
          if (ligne && ligne.entretien_du === false) {
            joursSansEntretien++;
          } else {
            entretienCentimes += (ligne && Number.isInteger(ligne.entretien_centimes))
              ? ligne.entretien_centimes
              : conditions.entretien_centimes_jour;
          }
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
          if (ligne && ligne.entretien_du === false) {
            joursSansEntretien++;
          } else if (ligne && Number.isInteger(ligne.entretien_centimes)) {
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
      minutesEcartSansSolde += detailSup.minutesSansSolde;
      /* LE RELEVÉ DU JOUR — exactement les minutes nettes que ce jour apporte
         au compteur de récupération (`minutesSupDuJour`), pas une seconde
         règle écrite à côté. Un jour de congé, de récupération, de sans
         solde ou de familiarisation passe par `detailSupDuJour` et n'apporte
         rien : il n'a rien à faire de plus ici.
         Ce qu'on ne compte PAS ici : le surplus d'un écart que les congés
         payés ne couvrent pas et qui bascule sur la récupération (§28.3). Il
         est servi APRÈS les périodes de congé, délibérément — les périodes
         ont priorité sur les écarts, et la réserve à la date suit le même
         ordre de service que le moteur. */
      crediterJour(minutesSupParJour, d,
        detailSup.base + detailSup.ajoutees - detailSup.renoncees
          + detailSup.ecartSurRecuperation);
      if (detailSup.minutesSurCp > 0) {
        ecartsSurCpAImputer.push({ jour: d, minutes: detailSup.minutesSurCp });
      }
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
          imputeSur: detailSup.ecartImputeSur,
          /* LOT 28 (§28.3) — CE QUE L'ÉCART FAIT RÉELLEMENT À CHAQUE POCHE.
             `minutesSurCp` est complété plus bas, une fois le disponible
             connu ; `minutesSurRecuperation` reçoit alors le surplus. */
          minutesSurCp: 0,
          minutesSurRecuperation: detailSup.ecartSurRecuperation < 0
            ? -detailSup.ecartSurRecuperation : 0,
          minutesSansSolde: detailSup.minutesSansSolde
        });
      }
    }

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
        var parts = repartirImputationParMois(impCouvrante, planning, samedisComptes);
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
          /* Une période SANS ventilation enregistrée n'a pas d'imputation, donc
             pas de samedi coché rattaché : l'ensemble du contrat est passé
             quand même, pour que le décompte d'une période dont la
             ventilation a été ÉCARTÉE reste celui de ses samedis choisis. */
          nbJours: decompterJoursOuvrables(periode.debut, periode.fin, planning,
            samedisComptes),
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

    /* LOT 31 §6 — LES MINUTES DE CONGÉS PAYÉS ANTICIPABLES SUR UNE PÉRIODE.

       Zéro, sauf si la période COMMENCE dans le mois de référence. Le mois de
       référence est celui de `aujourdhui`, qui entre par les paramètres : le
       moteur ne lit aucune horloge, et sans `aujourdhui` il se comporte
       exactement comme avant ce lot.

       Le montant est l'ACQUISITION MENSUELLE de ce contrat — 2,5 jours au
       nominal, moins si un prorata s'applique. Ce n'est pas le disponible :
       c'est ce qu'on autorise EN PLUS de lui. Et ce n'est pas la borne de
       l'écran non plus : le stepper offre deux jours entiers parce qu'il ne
       pose pas de demi-jour, mais cette limite-là appartient au geste, pas au
       calcul (voir le commentaire de `imputerConges`). */
    function anticipationCpPour(dateDebut) {
      if (!aujourdhui || !dateDebut) return 0;
      if (dateDebut.slice(0, 7) !== String(aujourdhui).slice(0, 7)) return 0;
      return minutesCpParMois(conditions);
    }

    /* RG-05 / RG-07 : imputation sur les compteurs disponibles.
       Sans aucune imputation imposée, on garde EXACTEMENT le chemin d'avant
       le lot 9 : un seul appel, sur le total du mois. C'est ce qui garantit
       la non-régression des 10 cas de référence.

       LOT 31 §6 — L'ANTICIPATION N'ENTRE PAS SUR CE CHEMIN, ET C'EST VOULU.
       Sans ventilation choisie, `imputerConges` ne refuse rien : il PREND ce
       que la réserve couvre et met le reste en sans solde. Lui donner une
       réserve plus grande déplacerait des jours du sans solde vers les congés
       payés — c'est-à-dire annulerait une retenue sur le salaire que personne
       n'a demandé d'annuler. Le §6 décrit un REFUS qui devient un plafond ;
       le refus n'existe que sur le chemin de la ventilation imposée, et c'est
       là, et là seulement, que le plafond monte. Signalé en restitution. */
    var imputation;
    if (!auMoinsUneImposee) {
      for (var s = 0; s < plan.length; s++) joursCongesDecomptes += plan[s].nbJours;
      imputation = imputerConges(joursCongesDecomptes, {
        minutesSup: entreeMinutesSup,
        minutesCp: entreeCpAcquis - entreeCpPris
      }, conditions);
      /* AUCUNE PROGRESSION SUR CE CHEMIN, ET C'EST VOULU. Sans ventilation
         choisie, `imputerConges` prend TOUT ce que la réserve couvre : lui
         donner une réserve plus grande déplacerait des jours du sans solde
         vers la récupération et changerait la retenue, le compteur de sortie
         et le total versé. Or « le compteur de sortie du mois ne change pas
         d'un centime » (§4.1) — seul l'ordre d'ÉVALUATION change. Une
         ventilation imposée, elle, dicte ses montants : y confronter une
         réserve à la date ne change que le OUI ou le NON, jamais un chiffre.
         C'est la seule lecture qui tienne les deux promesses du brief à la
         fois ; elle est signalée à Adrien dans la restitution. */
      if (plan.length) {
        recuperationConsommeeParPeriode.push({
          /* Toute la consommation est rattachée à la période la PLUS TÔT du
             mois : le moteur n'a fait qu'un appel, il ne sait pas la
             répartir. Rattacher au plus tôt est le choix prudent — une pose
             ultérieure dans le mois voit cette consommation déduite. */
          date_debut: plan[0].date_debut,
          minutes: imputation.minutesSupConsommees,
          /* Sans ventilation choisie, `imputerConges` ne prend jamais plus que
             le disponible : il n'y a rien à dépasser. */
          minutesEnDepassement: 0
        });
      }
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
      var mpj = conditions.minutes_par_jour_conge;
      for (var v = 0; v < plan.length; v++) {
        joursCongesDecomptes += plan[v].nbJours;

        /* LA RÉSERVE À LA DATE DE LA PÉRIODE (§4.1 du brief du 28 août).

           `dispoSup` porte le compteur d'entrée diminué de ce que les
           périodes précédentes ont consommé — les périodes sont parcourues
           dans l'ordre chronologique. On y ajoute ce que le mois a RÉELLEMENT
           rapporté avant le premier jour de cette période, journées déjà
           passées seulement. C'est la formule du §1, sans un terme de plus.

           DEPUIS L'ARBITRAGE 4, CETTE CONFRONTATION NE REFUSE PLUS RIEN : elle
           produit une DONNÉE. Ce que la période prend au-delà de la réserve à
           sa date est mesuré et rendu (`minutesEnDepassement`), pour que les
           écrans puissent le dire — « votre récupération passera à − 4 h 30 ».
           Un refus fermait la porte ; une donnée l'ouvre en disant ce qu'il y
           a derrière.

           Rien de tout cela ne touche les congés payés : `dispoCp` reste la
           réserve d'ENTRÉE du mois (arbitrage n° 2), et le refus y reste
           entier (arbitrage n° 4, seconde moitié). */
        var supEnPlus = 0;
        if (aujourdhui && plan[v].imposee) {
          supEnPlus = recuperationAcquiseAvant(minutesSupParJour, plan[v].date_debut, aujourdhui);
        }
        var dispoSupDate = dispoSup + supEnPlus;

        /* C1 — au mois où la période COMMENCE, la ventilation est confrontée
           aux réserves pour la période ENTIÈRE, pas seulement pour la part du
           mois. Un mois clôturable sur une ventilation impossible à honorer
           est pire qu'un refus franc. Ne vaut plus que pour les congés
           payés : la récupération ne refuse plus. */
        /* LOT 31 §6 — L'ANTICIPATION DE CETTE PÉRIODE.

           Elle n'est offerte que si la période COMMENCE dans le mois de
           référence — celui de `aujourdhui`, passé en entrée. Le moteur ne
           lit aucune horloge : sans `aujourdhui`, l'anticipation vaut zéro et
           le comportement est exactement celui d'avant ce lot.

           LE MONTANT : L'ACQUISITION DU MOIS, ni plus ni moins.

           J'avais d'abord serré cette borne à deux jours, croyant que le §6 se
           contredisait — « au plus l'acquisition du mois » d'un côté, « deux
           jours entiers, pas 2,5 » de l'autre. Adrien a tranché le
           1er septembre : les deux phrases ne parlaient pas de la même chose.

             · LE MOTEUR borne à l'acquisition du mois. C'est la règle de
               fond : on n'anticipe pas plus que ce qu'on est en train de
               gagner.
             · L'ÉCRAN offre deux jours ENTIERS, parce qu'un stepper en jours
               ne pose pas de demi-jour. C'est une limite du geste, pas de la
               règle.

           Serrer le moteur à la limite du geste aurait figé dans le calcul une
           contrainte d'interface — et le jour où un autre chemin consommerait
           un demi-jour de congés payés, il aurait été refusé sans raison. */
        var anticipationCp = anticipationCpPour(plan[v].date_debut);
        var tot = plan[v].imposeeTotale;
        if (tot && tot.joursSurCp * mpj > dispoCp + anticipationCp) {
          throw erreurCode('IMPUTATION_DEPASSE_RESERVES');
        }
        var r = imputerConges(plan[v].nbJours,
          { minutesSup: dispoSupDate, minutesCp: dispoCp }, conditions, plan[v].imposee,
          anticipationCp);
        crediterConsommation(recuperationConsommeeParPeriode,
          plan[v].date_debut, r.minutesSupConsommees,
          /* Ce que CETTE période a pris au-delà de la réserve à SA date. Zéro
             quand elle est financée — le cas de très loin le plus fréquent. */
          Math.max(0, r.minutesSupConsommees - dispoSupDate));
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

    /* LOT 31 (§3.1) — L'IMPUTATION QUI NE RECOUVRE RIEN EST NOMMÉE.

       Le moteur regroupe les périodes de congé À PARTIR des journées
       `conge_maria`. Une imputation qui ne recoupe AUCUNE de ces périodes
       n'est donc confrontée à rien : elle n'est ni appliquée, ni écartée —
       elle est ignorée, sans un mot. La ventilation choisie par Maria
       disparaît et les jours concernés sont recomptés comme travaillés.

       `IMPUTATION_INCOMPLETE` protège le cas où l'imputation RECOUVRE une
       période avec un décompte faux ; il ne protège pas celui-ci. Deux
       chemins y mènent : une écriture directe en base qui ne respecte pas la
       forme de l'application, et la pose elle-même, qui écrit l'imputation
       avant les journées et n'a pas de transaction — si la compensation
       échoue, l'imputation reste seule.

       Le moteur NE LÈVE PAS : une exception ferait tomber le mois entier, et
       un mois qu'on ne peut plus lire est pire qu'un mois qui signale un
       défaut. Il constate, il nomme, et les écrans décident (§3.2).

       Aucun montant ne change : une orpheline n'a jamais rien appliqué —
       elle n'entre dans aucun `plan`, dans aucun décompte, dans aucune
       imputation de compteur. La nommer est une information de plus, pas une
       décision de plus. C'est ce que le différentiel poste à poste prouve.

       Deux gardes pour n'accuser personne à tort :
       - une imputation qui RECOUPE une période, même sans la couvrir, n'est
         pas orpheline : ce cas-là est déjà dit (`choixEcarte`, source
         `defaut_choix_ecarte`) ou refusé (`IMPUTATION_INCOMPLETE`) ;
       - une imputation à cheval sur deux mois dont la part de CE mois ne
         porte aucun jour ouvrable ne concerne pas ce mois : elle sera
         examinée — et signalée — au mois qui la porte réellement. Sans cette
         garde, une période du 31 mai au 5 juin serait déclarée orpheline en
         mai, où elle n'a rien à faire.

       Le décompte se lit ici avec `joursOuvrablesParMois`, jamais avec
       `repartirImputationParMois` : cette dernière LÈVE `IMPUTATION_INCOMPLETE`
       quand la ventilation ne couvre pas le décompte, et une orpheline au
       décompte faux ferait alors tomber le mois — exactement ce que le §3.1
       interdit. */
    var imputationsOrphelines = [];
    for (var o = 0; o < imputations.length; o++) {
      var impO = imputations[o];
      if (!impO || !impO.date_debut || !impO.date_fin) continue;
      if (impO.date_fin < impO.date_debut) continue;
      var recoupe = false;
      for (var po = 0; po < periodes.length; po++) {
        if (impO.date_debut <= periodes[po].fin && impO.date_fin >= periodes[po].debut) {
          recoupe = true;
          break;
        }
      }
      if (recoupe) continue;
      var tranchesO = joursOuvrablesParMois(impO.date_debut, impO.date_fin,
        planning, samedisComptes);
      var joursDeCeMois = 0;
      for (var to = 0; to < tranchesO.length; to++) {
        if (tranchesO[to].cle === cleMois) joursDeCeMois = tranchesO[to].jours;
      }
      if (joursDeCeMois === 0) continue;
      imputationsOrphelines.push({
        date_debut: impO.date_debut,
        date_fin: impO.date_fin,
        joursOuvrables: joursDeCeMois,
        /* La ventilation qu'elle demandait — celle qui a été perdue. Elle est
           reprise telle qu'elle est POSÉE (période entière), pas redécoupée :
           c'est le choix de Maria qu'on restitue, pas une part calculée. */
        joursSurCp: impO.jours_sur_cp || 0,
        joursSurSup: impO.jours_sur_sup || 0,
        joursSansSolde: impO.jours_sans_solde || 0
      });
    }

    /* LOT 28 (§28.3) — LES CONGÉS PAYÉS NE PASSENT JAMAIS SOUS ZÉRO.

       Un écart d'horaire imputé sur les congés payés ne passait par aucun
       contrôle de couverture : compteur à 0, deux libérations de 5 h sur les
       congés payés → solde à −600 minutes, sans erreur ni signal. Et le
       disponible lu par l'écran était celui du compteur d'ENTRÉE : une même
       réserve pouvait être dépensée deux fois dans le mois.

       L'ordre de service est celui du calendrier tel que Maria le voit :
       d'abord les PÉRIODES de congé (leur ventilation est la sienne, déjà
       vérifiée contre les réserves ci-dessus), puis les écarts d'horaire dans
       l'ordre des jours, chacun borné à ce qui reste. Le surplus bascule sur la
       récupération — qui, elle, a le droit d'être négative (§17.5). Rien n'est
       refusé, rien n'est perdu, et le détail par jour dit où chaque minute est
       allée : c'est ce que l'écran annonce AVANT la validation (« il vous reste
       X »), et ce que le document explique après. */
    var cpRestant = Math.max(0,
      entreeCpAcquis - entreeCpPris - imputation.minutesCpConsommees);
    for (var ec = 0; ec < ecartsSurCpAImputer.length; ec++) {
      var demande = ecartsSurCpAImputer[ec];
      var surCp = Math.min(demande.minutes, cpRestant);
      var surRecup = demande.minutes - surCp;
      cpRestant -= surCp;
      minutesEcartSurCp += surCp;
      minutesEcartRecuperation -= surRecup;
      for (var ed = 0; ed < ecartsDeclares.length; ed++) {
        if (ecartsDeclares[ed].jour === demande.jour) {
          ecartsDeclares[ed].minutesSurCp = surCp;
          ecartsDeclares[ed].minutesSurRecuperation += surRecup;
          /* Le document nomme la poche réellement touchée : une déduction
             entièrement reportée sur la récupération n'est plus « sur les
             congés payés ». Un partage garde le nom des congés payés et porte
             son détail. */
          if (surCp === 0) ecartsDeclares[ed].imputeSur = 'recuperation';
          break;
        }
      }
    }

    /* Invariant testé (A9) : le net acquis est toujours la base, plus les
       minutes exceptionnelles, moins les minutes auxquelles Maria a renoncé.
       LOT 17 : plus l'écart d'horaire imputé à la récupération, qui est signé
       — le total du mois peut donc être négatif, et l'écran le dit (§17.5).
       LOT 28 : le surplus d'un écart que les congés payés ne couvrent pas
       en fait partie — d'où le calcul ICI, après le service des congés payés. */
    var minutesSupAcquises = minutesSupBase + minutesSupAjoutees
                           - minutesSupRenoncees + minutesEcartRecuperation;

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
       couche d'appel.

       LOT 20 (§20.3) — LA FAMILIARISATION NE PRIVE PLUS DE RIEN. Le terme
       `joursFamiliarisation === 0` figurait ici : un seul jour de
       familiarisation privait Maria de ses 2,5 jours du mois. Il est retiré,
       et LUI SEUL — congés, sans solde et couverture du contrat restent.

       Conséquence assumée : un mois ENTIÈREMENT en familiarisation acquiert
       aussi ses 2,5 jours. Et conséquence à connaître dans l'autre sens : une
       familiarisation est presque toujours en début de contrat, donc sur un
       mois que le contrat ne couvre pas en entier — `contratCouvreLeMois` y
       reste faux, et ce mois-là n'acquiert toujours rien, pour cette
       autre raison. Le critère A6 ne se vérifie donc que sur un contrat déjà
       ouvert le 1er du mois. */
    /* LOT 28 (§28.1) — L'ACQUISITION DES CONGÉS PAYÉS, COMME POUR UNE SALARIÉE.

       `moisEntierementTravaille` exigeait qu'AUCUN congé et AUCUN jour sans
       solde n'ait été posé dans le mois : poser un jour par mois toute l'année
       faisait acquérir zéro congé payé sur l'exercice. Décision d'Adrien du
       25 août 2026 : 2,5 jours ouvrables par mois travaillé (L3141-3), et
       comptent comme travaillés — L3141-5 — la présence, le congé payé, la
       récupération, la familiarisation, l'absence de l'enfant et les fériés.
       Seul le sans solde ne compte pas.

       Trois règles, et trois seulement :
         1. un mois INTÉGRALEMENT en sans solde n'acquiert rien ; un mois
            partiellement en sans solde acquiert ses 2,5 jours entiers
            (L3141-4 interdit de réduire plus que proportionnellement) ;
         2. un mois que le contrat ne couvre pas en entier acquiert AU PRORATA
            des jours du planning couverts — « comme tous les salariés »
            (Adrien, 26 août) — avec le même quotient que le salaire (§17.7),
            les jours de familiarisation comptés couverts puisque travaillés ;
         3. le plafond annuel de 30 jours ouvrables (L3141-3) s'applique sur
            l'exercice de référence : le moteur ne le connaît pas, la chaîne
            lui passe le cumul déjà acquis (`minutesCpAcquisesExercice`), et
            le solde non pris se cumule sans jamais être remis à zéro (RG-12).

       Le partage entre mois du prorata reste ENTIER : un seul arrondi, ici. */
    var joursSansSoldeParConge =
      (joursConge.length > 0 && imputation.joursSurCp + imputation.joursSurSup === 0)
        ? joursConge.length : 0;
    var joursAssimilesTravail = nbJoursTraites - joursSansSoldeSaisis - joursSansSoldeParConge;
    var toutLeMoisSansSolde = nbJoursTraites > 0 && joursAssimilesTravail <= 0;

    var partCp = partCouverteDuMois(contrat, planning, annee, mois, periodesFam, parJour);
    var joursCouvertsCp = partCp.joursCouverts + partCp.joursFamiliarisation;
    var cpProrataApplique = partCp.joursDuMois > 0 && joursCouvertsCp < partCp.joursDuMois;
    var minutesCpAcquises = 0;
    if (nbJoursTraites > 0 && !toutLeMoisSansSolde) {
      minutesCpAcquises = cpProrataApplique
        ? Math.round(minutesCpParMois(conditions) * joursCouvertsCp / partCp.joursDuMois)
        : minutesCpParMois(conditions);
    }
    var plafondExercice = PLAFOND_CP_JOURS_PAR_EXERCICE * conditions.minutes_par_jour_conge;
    var dejaAcquisExercice = entrees.minutesCpAcquisesExercice || 0;
    var cpPlafonne = false;
    if (minutesCpAcquises > 0 && dejaAcquisExercice + minutesCpAcquises > plafondExercice) {
      minutesCpAcquises = Math.max(0, plafondExercice - dejaAcquisExercice);
      cpPlafonne = true;
    }

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
    var part = partCp;
    var moisEntier = part.joursCouverts === part.joursDuMois;

    /* §20.3 — LA PART HORAIRE DU MOIS. Rémunération au taux du contrat :
       `montantCentimes` divise le brut mensuel par 195 h, en un seul arrondi
       — c'est le même taux que celui d'une heure supplémentaire, et c'est
       exactement ce qu'on veut. Le net suit « au même prorata », par la même
       fonction sur le net mensuel : le net n'est jamais dérivé du brut
       (A.6 du référentiel), il est saisi à la main et proratisé, pas calculé.
       Aucune minute déclarée = aucun centime, sans arrondi d'aucune sorte. */
    var famBrutCentimes = famMinutes === 0 ? 0
      : montantCentimes(salaire.brut_mensuel_centimes, famMinutes);
    var famNetCentimes = famMinutes === 0 ? 0
      : montantCentimes(salaire.net_mensuel_centimes, famMinutes);
    var brutProrata = moisEntier || part.joursDuMois === 0
      ? salaire.brut_mensuel_centimes
      : Math.round(salaire.brut_mensuel_centimes * part.joursCouverts / part.joursDuMois);
    var netProrata = moisEntier || part.joursDuMois === 0
      ? salaire.net_mensuel_centimes
      : Math.round(salaire.net_mensuel_centimes * part.joursCouverts / part.joursDuMois);

    return {
      joursPresence: joursPresence,
      /* L'entretien de la GARDE mensualisée, et lui seul. Celui de la
         familiarisation vit dans `familiarisation.entretienCentimes` : les
         deux se lisent sur deux lignes différentes du document, avec deux
         comptes de jours différents, et les mêler rendrait chaque détail
         incapable de reconstituer son total (règle existante du §20.6). */
      entretienCentimes: entretienCentimes,
      /* §20.6 — le nombre de journées dont l'indemnité a été retirée, pour que
         le document puisse écrire « + 1 jour sans indemnité » et que le détail
         reconstitue. */
      joursSansEntretien: joursSansEntretien,
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
      /* LOT 28 (§28.3) — CE QU'IL RESTE DE CONGÉS PAYÉS UNE FOIS LE MOIS
         SERVI : l'entrée, moins les périodes posées, moins les écarts — avant
         l'acquisition du mois. C'est le disponible qu'un écran de pose doit
         annoncer pour une NOUVELLE consommation dans ce mois ; lire le
         compteur d'entrée permettait de dépenser deux fois la même réserve. */
      minutesCpRestantesApresConsommation: cpRestant,
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
      /* LOT 31 (§3.1) — les imputations reçues pour ce mois qui ne recouvrent
         aucune période de congé regroupée. Vide dans l'immense majorité des
         cas : c'est la forme attendue. Le mois reste calculé, au centime
         près ; la chaîne la transporte et les écrans la disent (§3.2). */
      imputationsOrphelines: imputationsOrphelines,
      /* LA RÉCUPÉRATION SE GAGNE JOUR APRÈS JOUR — LE RELEVÉ, EXPOSÉ.
         L'écran de pose doit annoncer la réserve À LA DATE choisie, et il ne
         doit pas la recalculer : il lit ces deux relevés et appelle
         `Engine.recuperationALaDate`. Une règle, un seul endroit. */
      minutesSupParJour: minutesSupParJour,
      recuperationConsommeeParPeriode: recuperationConsommeeParPeriode,
      /* ARBITRAGE 4 (§4.1) — LE NÉGATIF SE DIT, IL NE SE CACHE PAS.

         La pose n'est plus refusée : le solde descend sous zéro et le moteur
         le porte tel quel. Encore faut-il que les écrans puissent le DIRE —
         le récapitulatif du mois, l'accueil, l'espace enfant. C'est le rôle de
         ces deux champs : ils ne décident rien, ils nomment un état.

         Ils portent le SOLDE DE SORTIE du mois, celui que le récapitulatif
         affiche. Ce qu'une période donnée a pris au-delà de la réserve à sa
         date se lit, lui, dans `recuperationConsommeeParPeriode`.

         Un solde négatif n'est pas nouveau — un écart d'horaire pouvait déjà
         l'y mettre depuis le §17.5. Ce qui est nouveau, c'est qu'une pose de
         congé le peut aussi, et que le moteur le nomme. */
      recuperationNegative: compteurSortie.minutesSup < 0,
      minutesRecuperationNegative: Math.max(0, -compteurSortie.minutesSup),
      retenueSansSoldeCentimes: retenueSansSoldeCentimes,
      minutesCpAcquis: minutesCpAcquises,
      /* LOT 28 (§28.1) — POURQUOI CE MOIS ACQUIERT CE QU'IL ACQUIERT. L'écran
         doit pouvoir écrire « 12 jours sur 22 » ou « aucun : mois entièrement
         sans solde » sans refaire la règle. */
      acquisitionCp: {
        joursCouverts: joursCouvertsCp,
        joursDuMois: partCp.joursDuMois,
        prorata: cpProrataApplique,
        toutLeMoisSansSolde: toutLeMoisSansSolde,
        plafonne: cpPlafonne
      },
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
        /* §20.3 — la troisième borne, exposée : c'est elle qui explique
           pourquoi « 8 jours sur 22 » et non « 22 sur 22 » sur un mois mêlé.
           Un écran qui la recalculerait redirait la règle. */
        joursFamiliarisation: part.joursFamiliarisation,
        applique: !moisEntier && part.joursDuMois > 0
      },
      salaireBrutProrataCentimes: brutProrata,
      /* §20.1 à §20.3 — LA PART DE FAMILIARISATION DU MOIS.

         `actif` dit qu'au moins un jour du planning du mois tombe dans une
         période — c'est lui qui décide si le document montre deux blocs ou
         un. Tout le reste est du compte, jamais une phrase : les libellés
         appartiennent aux écrans. */
      familiarisation: {
        actif: famJoursDeLaPeriode > 0,
        joursDeLaPeriode: famJoursDeLaPeriode,
        joursDeclares: famJoursDeclares,
        minutesDeclarees: famMinutes,
        joursAvecEntretien: famJoursAvecEntretien,
        entretienCentimes: famEntretienCentimes,
        brutCentimes: famBrutCentimes,
        netCentimes: famNetCentimes,
        joursIgnores: famJoursIgnores,
        /* §20.6 — les jours déclarés dont l'indemnité a été retirée, comptés
           SÉPARÉMENT de ceux de la garde : c'est ce qui permet aux deux blocs
           du document de reconstituer chacun son total. */
        joursSansEntretien: famJoursSansEntretien,
        jours: famJours
      },
      salaireNetProrataCentimes: netProrata,
      /* §17.8 — LE BRUT RÉELLEMENT DÛ DU MOIS, celui qui entre dans l'assiette
         du 1/80ᵉ de l'indemnité de rupture. C'est le brut du mois après
         prorata, moins la retenue de sans solde (déjà exprimée en brut,
         RG-08). L'instantané ne portait jusqu'ici que le brut CONTRACTUEL :
         une indemnité calculée dessus aurait ignoré les mois sans solde et
         les mois partiels, et surpayé la famille sur un chiffre invérifiable.
         Jamais négatif : une retenue supérieure au brut du mois signale une
         donnée incohérente, pas une dette de Maria envers la famille. */
      /* LOT 20 — la rémunération horaire de familiarisation ENTRE dans
         l'assiette. C'est du brut réellement dû au titre du mois ; l'en
         exclure sous-paierait l'indemnité de rupture d'un contrat court, sur
         un chiffre que personne ne pourrait vérifier. Question posée à Adrien
         avant le lot, recommandation retenue faute de réponse contraire. */
      brutDuCentimes: Math.max(0, brutProrata + famBrutCentimes - retenueSansSoldeCentimes),
      /* §5.8 du cahier : net du mois + entretien − retenue. NB : la retenue
         RG-08 est exprimée en brut (« convention à valider » dans le cahier),
         soustraite ici d'un total à base nette — hétérogénéité signalée. */
      totalAVerserCentimes: netProrata + famNetCentimes
                          + entretienCentimes + famEntretienCentimes
                          - retenueSansSoldeCentimes
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

  /* LOT 20 (§20.4 c) — LA DURÉE ENTRE UNE ARRIVÉE ET UN DÉPART, à la minute.

     « 9 h 05 → 11 h 47 donne exactement 2 h 42 » : c'est de l'arithmétique sur
     des heures, donc une règle, donc le moteur. Un écran qui la referait
     réintroduirait un calcul métier dans l'interface (B.0-5) — et le premier
     jour où quelqu'un y ajouterait une tolérance ou un arrondi, personne ne
     saurait où le chercher.

     Un départ AVANT l'arrivée est refusé, pas ramené à zéro : c'est une saisie
     à corriger, et la feuille doit rester ouverte pour que Maria la corrige
     (B.0-9). Une durée nulle l'est aussi — déclarer zéro minute et déclarer
     rien sont la même chose, et le §20.3 dit qu'un jour sans déclaration ne
     paie rien. */
  function dureeEntreHeures(arrivee, depart) {
    var d = heureEnMinutes(depart) - heureEnMinutes(arrivee);
    if (d <= 0) throw erreurCode('DUREE_NON_POSITIVE');
    return d;
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
  /* LOT 28 (§28.8) — LA VEILLE DE LA REPRISE, exposée.

     Le décompte RG-06 court jusqu'à la veille de la reprise, et un samedi
     compté peut donc tomber le mois SUIVANT celui de la période. La chaîne
     doit charger les samedis jusque-là — pas jusqu'à la fin du mois affiché,
     sinon l'écran mensuel et l'historique ne lisent pas les mêmes samedis et
     divergent sur le même mois. La règle « quand reprend-on ? » vit ici, à
     côté de la boucle qui l'applique ; l'écran ne la redit pas. */
  function veilleDeLaReprise(finStr, joursPlanning) {
    var planning = joursPlanning || PLANNING_DEFAUT;
    var reprise = Feries.ajouterJours(finStr, 1);
    for (var garde = 0; garde < 60 &&
         (planning.indexOf(jourSemaine(reprise)) === -1 || Feries.estJourFerie(reprise)); garde++) {
      reprise = Feries.ajouterJours(reprise, 1);
    }
    return Feries.ajouterJours(reprise, -1);
  }

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
    /* §5.2 — les samedis d'une période qui sont un CHOIX, et non une règle. */
    samedisEligibles: samedisEligibles,
    imputerConges: imputerConges,
    minutesSupDuJour: minutesSupDuJour,
    /* LA RÉCUPÉRATION SE GAGNE JOUR APRÈS JOUR — la formule du §1, lue par
       les écrans comme par le moteur. */
    recuperationALaDate: recuperationALaDate,
    recuperationAcquiseAvant: recuperationAcquiseAvant,
    recuperationConsommeeAvant: recuperationConsommeeAvant,
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
    /* LOT 28 (§28.8) — jusqu'où une période compte ses samedis. */
    veilleDeLaReprise: veilleDeLaReprise,
    /* LOT 28 (§28.1) — le plafond annuel, pour que l'écran puisse le nommer. */
    PLAFOND_CP_JOURS_PAR_EXERCICE: PLAFOND_CP_JOURS_PAR_EXERCICE,
    /* LOT 29 (§29.2) — les types qui ne portent jamais de minute, écart
       compris ; l'écran s'y réfère au lieu de tenir sa propre liste. */
    TYPES_SANS_MINUTES: TYPES_SANS_MINUTES,
    /* §17.6 — la conversion entre l'unité de stockage (les minutes) et
       l'affichage (les jours) doit se faire au même facteur partout. */
    minutesCpParMois: minutesCpParMois,
    /* §17.5 — la référence d'une journée et la conversion d'une heure réelle
       déclarée en minutes signées. C'est une RÈGLE, pas de l'affichage : elle
       décide du signe, donc du sens du compteur. */
    heureEnMinutes: heureEnMinutes,
    heureDeReference: heureDeReference,
    /* §20.4 c — la durée d'une journée de familiarisation saisie en
       arrivée → départ. Règle, pas affichage : le moteur, et lui seul. */
    dureeEntreHeures: dureeEntreHeures,
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
    detailSupDuJour: detailSupDuJour,
    /* LOT 20 (§20.4) — l'écran de la période doit dire, pour CHAQUE jour
       ouvré, s'il tombe dans la familiarisation. Il ne doit pas redire la
       règle : la borne « bornes incluses » vit ici et nulle part ailleurs. */
    estEnFamiliarisation: estEnFamiliarisation,
    periodeFamiliarisationDuJour: periodeFamiliarisationDuJour,
    joursOuvresDePeriode: joursOuvresDePeriode
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.Engine = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
