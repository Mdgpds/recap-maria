/* ============================================================================
   ui-enfant.js — Espace enfant : calendrier et saisie d'une journée
   (§2.2 et §2.3 des specs).

   C'est l'écran central de la refonte. Un enfant, un calendrier, quatre
   panneaux :
     1. le calendrier du mois de CET enfant (un seul enfant par calendrier) ;
     2. le mois : présence, salaire, entretien, heures sup, total à verser ;
     3. les compteurs de CE contrat (jamais de compteur global) ;
     4. depuis le début du contrat, avec le lien vers l'historique.

   Trois points de vigilance, tenus ici et nulle part ailleurs :

   - UN MOIS CLÔTURÉ NE SE MODIFIE PLUS (correction B1 de la relecture). Le
     verrou ne portait que sur le rangement du contrat : un mois clôturé
     restait entièrement saisissable, et un congé posé depuis ce mois partait
     en plus sur les trois autres contrats. L'application écrivait donc à
     l'écran une promesse — « après clôture, plus aucune modification » —
     qu'elle ne tenait pas. Désormais : aucune cellule touchable, un bandeau
     qui le dit, un refus explicite si l'écriture est tentée quand même, et
     surtout AUCUN contrat dont le mois est clôturé ne reçoit une écriture
     groupée venue d'un autre.

   - AUCUN CALCUL DANS L'INTERFACE (§4). Les effets annoncés dans la feuille de
     saisie — « Pas d'entretien ce jour (−5,00 €) », « Congé posé pour les 3
     enfants, −1 jour » — ne sont pas des textes recopiés de la maquette : ils
     sont obtenus en REJOUANT le mois avec Engine.calculerMois() tel qu'il
     serait après le geste, et en comparant au mois actuel. Si un paramètre du
     contrat change (indemnité, minutes supplémentaires, ordre d'imputation),
     la phrase change toute seule.

   - « JE NE TRAVAILLAIS PAS » ÉCRIT SUR TOUS LES CONTRATS SERVIS (§2.3), en
     une seule écriture, chaque contrat ne recevant que SES propres jours
     (planning, bornes, fériés exclus, mois non clôturé). Le libellé compte
     les contrats RÉELLEMENT servis, jamais « les 4 enfants » par principe
     (correction A2).
   ========================================================================= */
(function (global) {
  'use strict';

  var Kit = global.Kit;
  var Chaine = global.ChaineMois;
  var Engine = global.Engine;
  var Feries = global.Feries;

  /* Types posés par une absence de Maria. Le retrait ne cible que ceux-là :
     une absence d'enfant saisie le même jour ne doit pas disparaître. */
  var TYPES_ABSENCE_MARIA = ['conge_maria', 'sans_solde', 'hors_planning'];

  /* Jusqu'où la navigation du calendrier peut aller au-delà du mois courant.
     Correction A13 : « Mes congés » propose de poser jusqu'à vingt semaines en
     avant ; sans cette borne, un congé d'été posé en mai devenait invisible et
     impossible à retirer avant le 1er juillet. */
  var MOIS_A_VENIR_VISIBLES = 12;

  var vue = null;   // état de l'écran affiché

  /* ------------------------------------------------------------------ */
  /* Affichage                                                           */
  /* ------------------------------------------------------------------ */

  /* LOT 17 §17.3 — LES CONDITIONS DU MOIS AFFICHÉ.

     Tous les réglages que cet écran montre — le planning du calendrier, les
     minutes supplémentaires d'une journée, l'indemnité d'entretien — sont
     ceux de l'AVENANT en vigueur ce mois-là, jamais ceux de `contrat`. Un
     écran qui lirait `contrat` afficherait les conditions d'aujourd'hui sur un
     mois d'il y a deux ans, et un document déjà remis à une famille changerait
     sous les yeux de Maria. Un mois figé porte les conditions de son époque :
     la chaîne les a résolues et les transporte sur le maillon. */
  function cond() {
    return (vue && vue.entree && vue.entree.conditions) || null;
  }

  /* Un réglage, avec un repli EXPLICITE quand les conditions manquent — un
     mois antérieur au contrat, ou une chaîne en échec. Le repli ne prétend
     jamais être une valeur du contrat. */
  function reg(champ, defaut) {
    var c = cond();
    return (c && c[champ] != null) ? c[champ] : defaut;
  }

  function planningDuMois() { return reg('jours_planning', [1, 2, 3, 4, 5]); }
  function mpjc() { return reg('minutes_par_jour_conge', 0); }

  function afficher(ctx) {
    var contrat = global.App.contratParId(ctx.params.contratId);
    if (!contrat) {
      return global.App.tousLesContrats().then(function () {
        var c = global.App.contratParId(ctx.params.contratId);
        if (!c) throw new Error('contrat introuvable');
        return afficherContrat(ctx, c);
      });
    }
    return afficherContrat(ctx, contrat);
  }

  function afficherContrat(ctx, contrat) {
    var m = { annee: ctx.params.annee, mois: ctx.params.mois };
    if (!m.annee || !m.mois) m = global.App.moisCourant();

    barre(ctx.barre, contrat, m);
    ctx.corps.appendChild(Kit.ce('div', 'attente', 'Calcul du mois…'));

    return chargerVue(contrat, m, ctx.corps).then(function () {
      /* LA BARRE EST REDESSINÉE ICI, ET C'EST NÉCESSAIRE : le ⋯ ne doit pas
         apparaître sur un mois clôturé, un mois à venir ou un contrat rangé,
         et rien de tout cela n'est connu avant que le mois soit chargé. La
         première `barre()` ci-dessus n'existe que pour ne pas laisser un
         en-tête vide pendant le calcul. Un bouton qui refuse est pire qu'un
         bouton absent : il laisse croire à une panne. */
      barre(ctx.barre, contrat, m);
      Kit.vider(ctx.corps);
      rendre(ctx.corps);

      /* LOT 20 (§20.4 d) — ARRIVÉE DEPUIS L'ÉCRAN DE LA PÉRIODE. Toucher un
         jour là-bas ouvre sa feuille ICI, dans le mois du jour : la feuille de
         saisie vit à un seul endroit, et Maria voit l'effet de sa déclaration
         sur le mois au moment où elle la fait. Le paramètre est ignoré si le
         jour n'est pas (ou plus) dans une période. */
      if (ctx.params.jour && !vue.lectureSeule && enFamiliarisation(ctx.params.jour)) {
        feuilleFamiliarisation(ctx.params.jour);
      }
    });
  }

  /* LOT 25 (§25.1) — LE CHARGEMENT EST SÉPARÉ DU RENDU.

     L'Accueil ouvre la feuille de déclaration de familiarisation SANS passer
     par l'espace enfant : « un appui pour le faire ». Cette feuille a besoin
     de tout ce que l'écran sait — les conditions du mois, les journées, les
     périodes, l'état clôturé des autres contrats — sinon son aperçu chiffré
     et ses garde-fous seraient faux.

     Plutôt que d'en écrire une seconde, plus pauvre, l'Accueil monte le MÊME
     contexte et ouvre la MÊME feuille. `corps` vaut `null` dans ce cas :
     l'écran n'est pas redessiné ici, et `App.rafraichir()` remet l'Accueil à
     jour après l'écriture — « la carte se met à jour sans quitter
     l'Accueil » (§25.3, cas 1). */
  function chargerVue(contrat, m, corps) {
    /* Les journées des AUTRES contrats et l'état clôturé de chacun sont
       chargés ici, pas au moment du geste : une écriture groupée doit savoir
       ce qu'elle va écraser (A5) et qui elle n'a pas le droit de toucher (B1)
       avant que Maria ne touche quoi que ce soit. Tout est en cache. */
    var autres = global.App.contrats();
    return Promise.all([
      global.App.serie(contrat, m),
      global.App.journees(contrat.id, m.annee, m.mois),
      global.App.recapsDuMois(m.annee, m.mois),
      Promise.all(autres.map(function (c) {
        return global.App.journees(c.id, m.annee, m.mois)
          .then(function (j) { return { id: c.id, jours: j }; })
          .catch(function () { return { id: c.id, jours: null }; });
      })),
      /* Lot 10 — un échec de lecture ici ne doit pas vider l'écran : sans les
         imputations on perd un AVERTISSEMENT, pas une donnée. */
      global.DB.listImputationsPourMois(contrat.id, m.annee, m.mois).catch(function () { return []; }),
      /* CORRECTION B3 DE LA RELECTURE DU LOT 20 — LES PÉRIODES ENTRENT DANS
         `vue`, comme les imputations, et pour exactement la même raison.

         `simulerLignes` rejoue le mois pour montrer l'effet d'un geste AVANT
         qu'il soit enregistré. Il ne recevait pas les périodes : le moteur
         voyait une liste vide, chaque jour non déclaré redevenait une présence
         mensualisée, et le résultat était soustrait d'un `vue.entree.resultat`
         qui, lui, connaissait la période. On soustrayait deux mois différents,
         et l'écran annonçait « + 82,50 € » là où le geste en vaut 5,50.

         C'est mot pour mot le défaut que le correctif B1 de la PR9 avait éteint
         pour les imputations, dans ce même appel. Contrairement à elles, un
         échec de lecture ici n'est PAS rattrapable : sans les périodes le rejeu
         est faux, pas incomplet. L'erreur remonte donc et l'écran la dit. */
      global.DB.listPeriodesFamiliarisation(
        contrat.id,
        Kit.iso(m.annee, m.mois, 1),
        Kit.iso(m.annee, m.mois, Kit.nbJoursDansMois(m.annee, m.mois))),
      /* Lot 12 — la note du mois. Un échec ici ne vide pas l'écran : on perd
         un espace d'écriture, pas un chiffre. */
      global.DB.getNoteMensuelle(contrat.id, m.annee, m.mois).catch(function () { return null; }),
      /* §25.2 — le compte des samedis déjà décomptés sur l'année de référence
         du mois affiché. Contrôle de CAPACITÉ, pas rattrapage d'erreur : un
         décor de test ancien n'expose pas la fonction et n'a aucun samedi
         compté. Une erreur RÉELLE rend `null`, et la ligne dit « non lus ». */
      (function () {
        if (typeof global.DB.compterSamedisAnnee !== 'function') return Promise.resolve(0);
        var ref = Kit.anneeDeReferenceConges(
          m.annee + '-' + String(m.mois).padStart(2, '0') + '-15');
        return global.DB.compterSamedisAnnee(contrat.id, ref.debut, ref.fin)
          .catch(function () { return null; });
      })(),
      /* LOT 28 (§28.8) — LES SAMEDIS COCHÉS DU CONTRAT, POUR LE REJEU. Le
         rejeu « voilà ce que ce geste change » doit voir EXACTEMENT ce que
         voit la chaîne (correctifs B1 de la PR9, B3 du lot 20) — et il ne
         recevait pas les samedis cochés : sur un mois portant une semaine à
         six jours, l'aperçu la comptait à cinq. La fenêtre déborde d'un mois
         de chaque côté, comme sur le document : un samedi qui prolonge une
         semaine de fin de mois appartient au mois suivant. Une erreur ici est
         une erreur : sans les samedis le rejeu est faux, pas incomplet. */
      (typeof global.DB.listSamedisConge === 'function'
        ? global.DB.listSamedisConge(contrat.id,
            fenetreSamedisDuMois(m).debut, fenetreSamedisDuMois(m).fin)
        : Promise.resolve([]))
    ]).then(function (r) {
      /* L'ordre des résultats suit celui du tableau ci-dessus. Une insertion au
         milieu décalerait tout : les index sont donc nommés une fois, ici. */
      var chaine = r[0];
      var entree = global.App.moisDe(chaine, m.annee, m.mois);
      var journeesAutres = {};
      r[3].forEach(function (x) { journeesAutres[x.id] = x.jours; });

      var maintenant = global.App.moisCourant();
      var auj = global.App.aujourdhui();
      vue = {
        contrat: contrat,
        annee: m.annee,
        mois: m.mois,
        chaine: chaine,
        journees: r[1],
        recaps: r[2],
        journeesAutres: journeesAutres,
        entree: entree,
        clos: !!(entree && entree.fige),
        aVenir: Chaine.cmpMois(m.annee, m.mois, maintenant.annee, maintenant.mois) > 0,
        range: !!contrat.archive,
        /* Lot 7 : la date du jour est lue UNE fois, ici, et circule ensuite en
           paramètre. Aucune fonction d'état ne relit l'horloge — sans quoi le
           comportement du 25 deviendrait invérifiable. */
        aujourdhui: auj,
        etat: Kit.etatDuMois(m.annee, m.mois, entree && entree.recap, auj),
        restants: Kit.joursTravaillesRestants(
          contrat, (entree && entree.conditions && entree.conditions.jours_planning) || null,
          m.annee, m.mois, auj, r[1]),
        /* Lot 10 — les périodes de congé ventilées qui touchent ce mois. */
        imputations: r[4] || [],
        /* Lot 20, correction B3 — les périodes de familiarisation du mois. */
        periodesFamiliarisation: r[5] || [],
        note: r[6] || null,
        /* LOT 20 (§20.4) — LA FAMILIARISATION DU MOIS, TELLE QUE LE MOTEUR LA
           VOIT. On ne la recalcule pas ici : `resultat.familiarisation.jours`
           porte, pour chaque jour du planning compris dans une période, ce qui
           est déclaré et si l'indemnité est comptée. L'écran n'ajoute qu'une
           chose, la seule que le moteur ne peut pas savoir : quel jour on est.
           `null` quand aucune période ne touche ce mois. */
        famJours: famJoursDe(entree),
        /* LOT 18 §18.1 — le mode « marquer plusieurs jours ». `null` = mode
           ordinaire. L'écran se redessine sans repasser par le réseau : entrer
           et sortir du mode ne doit rien recharger. */
        selection: null,
        /* §25.2 — LES SAMEDIS COMPTÉS, pour le repli « Réserves ». `null`
           veut dire « pas pu lire » : l'écran le dit, il ne le remplace
           jamais par zéro (§8) — un quota faux et crédible sur le chiffre
           que les familles contestent est le pire résultat possible. */
        samedis: r[7],
        /* §28.8 — les samedis cochés, dates ISO, pour le rejeu. */
        samedisComptes: (r[8] || []).map(function (x) {
          return typeof x === 'string' ? x : x.date_samedi;
        }).filter(Boolean),
        corps: corps || null
      };
      vue.lectureSeule = vue.range || vue.clos;
      /* LOT 30 (§30.2) — UN MOIS CLÔTURÉ N'EST PLUS UN ÉCRAN MORT : ses
         cases s'ouvrent sur la feuille « Ce mois est clôturé — le rouvrir
         pour corriger ce jour ? ». Seul un contrat rangé reste en lecture
         seule. */
      vue.rouvrable = vue.clos && !vue.range;
      /* §30.4 — un mois rouvert porte son bandeau, daté par l'historique. */
      vue.rouvert = !!(entree && global.Kit.moisRouvert(entree.recap));
      vue.reouvertureLe = null;
      if (vue.rouvert && global.UiReouverture) {
        return global.UiReouverture.dateReouverture(entree.recap).then(function (quand) {
          vue.reouvertureLe = quand;
          return vue;
        });
      }
      return vue;
    });
  }

  /* §28.8 — le mois, débordé d'un mois de chaque côté (même fenêtre que le
     document et que « Mes congés »). */
  function fenetreSamedisDuMois(m) {
    var d = new Date(Date.UTC(m.annee, m.mois - 2, 1));
    var f = new Date(Date.UTC(m.annee, m.mois + 1, 0));
    return { debut: d.toISOString().slice(0, 10), fin: f.toISOString().slice(0, 10) };
  }

  /* Le détail jour par jour de la familiarisation du mois, indexé par date.
     Rendu `null` — et non un objet vide — quand aucune période ne touche le
     mois : `null` dit « il n'y a pas de familiarisation ici », un objet vide
     dirait « il y en a une, et elle est vide ». Les deux ne s'affichent pas
     pareil. */
  function famJoursDe(entree) {
    var f = entree && entree.resultat && entree.resultat.familiarisation;
    if (!f || !f.actif) return null;
    var parJour = {};
    (f.jours || []).forEach(function (x) { parJour[x.jour] = x; });
    return parJour;
  }

  /* Ce jour tombe-t-il dans une période de familiarisation ? */
  function enFamiliarisation(d) {
    return !!(vue && vue.famJours && vue.famJours[d]);
  }

  /* ARRIVÉE PUIS DÉPART (migration 019) — l'heure d'arrivée enregistrée sur
     ce jour, « HH:MM », ou `''`. C'est une lecture de la ligne, pas du
     moteur : le moteur ne connaît pas les deux heures, et n'a pas à les
     connaître — `declare` reste son seul mot sur ce qui est payé. */
  function arriveeSeule(d) {
    var l = vue && vue.journees && vue.journees[d];
    return (l && l.fam_heure_arrivee) ? String(l.fam_heure_arrivee).slice(0, 5) : '';
  }

  /* Redessine l'écran à partir de ce qui est DÉJÀ en mémoire. Aucun appel
     réseau : c'est ce qui rend l'entrée et la sortie du mode sélection
     instantanées, et ce qui garantit que les chiffres affichés sont les mêmes
     avant et après (§18.1 A2 — ils viennent du même `vue`). */
  function redessiner() {
    if (!vue || !vue.corps) return;
    /* La BARRE change avec le mode : le ⋯ disparaît en sélection, et le
       retour quitte le mode au lieu de l'écran. La redessiner ici évite un
       aller-retour réseau — c'est tout l'intérêt du redessin local. */
    var barreEl = document.getElementById('barre');
    if (barreEl) {
      if (vue.selection) barreSelection(barreEl, vue.contrat, { annee: vue.annee, mois: vue.mois });
      else barre(barreEl, vue.contrat, { annee: vue.annee, mois: vue.mois });
    }
    Kit.vider(vue.corps);
    rendre(vue.corps);
  }

  function barre(barreEl, contrat, m) {
    Kit.vider(barreEl);
    barreEl.className = 'bar';
    var bk = Kit.bouton('bk', function () { global.App.retour(); });
    bk.textContent = '‹';
    bk.setAttribute('aria-label', 'Retour');
    barreEl.appendChild(bk);
    /* Lot 8 — la photo dans l'en-tête. Maria passe d'un enfant à l'autre
       plusieurs fois par jour ; un titre en texte seul ne dit pas assez vite
       chez qui on est.
       PÉRIMÈTRE : `ui-enfant.js` ne figure pas dans les fichiers réservés au
       lot 8, alors que le §8.5 demande la photo « en-tête de l'espace
       enfant ». Défaut de la spécification, même nature que le §4.2 du lot 9 ;
       tranché de la même façon, et signalé en restitution. */
    barreEl.appendChild(Kit.avatar(contrat, 'pt'));
    /* §25.2 — « Léa · août 2026 ». Le point médian remplace le tiret cadratin
       de la maquette : à 320 px, le tiret et ses deux espaces coûtaient trois
       caractères au prénom. L'ANNÉE reste, elle : la maquette ne montrait que
       deux mois, l'application en montre douze en arrière et douze en avant,
       et « Léa · août » sur un août de l'an dernier serait un piège. */
    barreEl.appendChild(Kit.ce('span', 'ti',
      contrat.prenom_enfant + ' · ' + Kit.libelleMoisAnnee(m.annee, m.mois)));

    var nav = Kit.ce('div', 'nav');
    var prec = Kit.bouton(null, function () { changerMois(-1); });
    prec.textContent = '‹';
    prec.setAttribute('aria-label', 'Mois précédent');
    var suiv = Kit.bouton(null, function () { changerMois(1); });
    suiv.textContent = '›';
    suiv.setAttribute('aria-label', 'Mois suivant');

    /* Bornes : jamais avant le début du contrat, jamais après sa fin. Au-delà
       du mois courant, la navigation reste ouverte jusqu'à MOIS_A_VENIR_VISIBLES
       — c'est ce qui rend consultable et retirable un congé posé d'avance
       (A13). Un bouton qui ne mène nulle part est désactivé, pas silencieux. */
    var debut = Chaine.moisDeDate(contrat.date_debut);
    var maintenant = global.App.moisCourant();
    var limite = { annee: maintenant.annee, mois: maintenant.mois };
    for (var i = 0; i < MOIS_A_VENIR_VISIBLES; i++) limite = Chaine.moisSuivant(limite.annee, limite.mois);
    if (contrat.date_fin) {
      var f = Chaine.moisDeDate(contrat.date_fin);
      if (Chaine.cmpMois(f.annee, f.mois, limite.annee, limite.mois) < 0) limite = f;
    }
    var p = Chaine.moisPrecedent(m.annee, m.mois);
    var s = Chaine.moisSuivant(m.annee, m.mois);
    prec.disabled = Chaine.cmpMois(p.annee, p.mois, debut.annee, debut.mois) < 0;
    suiv.disabled = Chaine.cmpMois(s.annee, s.mois, limite.annee, limite.mois) > 0;

    nav.appendChild(prec);
    nav.appendChild(suiv);

    /* §25.2 — LE ⋯ OUVRE LA MULTI-SÉLECTION. Elle vivait dans une barre
       « Marquer plusieurs jours d'un coup » posée SOUS le calendrier, avec
       son titre, son sous-titre et son bouton : quatre lignes pour un
       raccourci. Le geste ne change pas d'un caractère — il change de porte.

       Le bouton n'apparaît pas sur un mois clôturé, un contrat rangé ou un
       mois à venir : un bouton qui refuse est pire qu'un bouton absent, il
       laisse croire à une panne. */
    /* LOT 30 (§30.2) — sur un mois CLÔTURÉ d'un contrat en cours, le ⋯
       reste : la multi-sélection propose la réouverture au moment de
       valider, comme la feuille du jour. */
    if (!vue || ((!vue.lectureSeule || vue.rouvrable) && !vue.aVenir && vue.entree)) {
      var plus = Kit.bouton(null, function () { entrerSelection(); });
      plus.textContent = '⋯';
      plus.setAttribute('aria-label', 'Marquer plusieurs jours');
      nav.appendChild(plus);
    }
    barreEl.appendChild(nav);
  }

  /* La barre du mode sélection : le retour QUITTE le mode plutôt que l'écran,
     et le ⋯ n'y a plus de sens. */
  function barreSelection(barreEl, contrat, m) {
    Kit.vider(barreEl);
    barreEl.className = 'bar';
    var bk = Kit.bouton('bk', function () { quitterSelection(); });
    bk.textContent = '✕';
    bk.setAttribute('aria-label', 'Quitter la sélection');
    barreEl.appendChild(bk);
    barreEl.appendChild(Kit.avatar(contrat, 'pt'));
    barreEl.appendChild(Kit.ce('span', 'ti',
      contrat.prenom_enfant + ' · sélection'));
  }

  function changerMois(delta) {
    if (!vue) return;
    var m = delta < 0
      ? Chaine.moisPrecedent(vue.annee, vue.mois)
      : Chaine.moisSuivant(vue.annee, vue.mois);
    global.App.remplacer('enfant', { contratId: vue.contrat.id, annee: m.annee, mois: m.mois });
  }

  /* ------------------------------------------------------------------ */
  /* L'ÉCRAN (§25.2) — dans cet ordre, et pas un autre                   */
  /*                                                                     */
  /*   1. la barre : retour, avatar, « Léa · août 2026 », ‹ ›, ⋯         */
  /*   2. UN ENCART AU MAXIMUM, les autres repliés derrière une ligne     */
  /*   3. le calendrier, directement                                      */
  /*   4. la ligne de synthèse chiffrée                                   */
  /*   5. les replis : Le mois · Journées à part · Réserves · Mes notes · */
  /*      Depuis le début  (« Journées à part » n'apparaît que si le mois */
  /*      en compte au moins une — lot 28)                                */
  /*   6. la barre fixe : vérifier et clôturer                            */
  /*                                                                     */
  /* CE QUI DISPARAÎT, ET OÙ IL VIT MAINTENANT (A.2) :                    */
  /*                                                                     */
  /*   · l'encart d'état du mois (« chiffres provisoires ») — la pastille */
  /*     de la carte d'accueil et le bandeau du document le disent déjà ; */
  /*   · la légende permanente de sept entrées et la phrase « Rien à      */
  /*     faire les jours normaux » — la ligne de synthèse chiffrée les    */
  /*     remplace, et elle dit la même chose avec les vrais nombres ;     */
  /*   · les quatre panneaux blancs — ils deviennent des replis, « Le     */
  /*     mois » ouvert par défaut ;                                        */
  /*   · les barres de progression des compteurs — des lignes chiffrées ; */
  /*   · la barre « Marquer plusieurs jours d'un coup » sous le           */
  /*     calendrier — le ⋯ de la barre haute ouvre la multi-sélection.    */
  /*                                                                     */
  /* AUCUN AVERTISSEMENT NE SE PERD : tous entrent dans la file de        */
  /* l'encart unique (`pointsAvertissement`), le plus urgent visible, les */
  /* autres derrière « N autres points à voir › ».                        */
  /* ------------------------------------------------------------------ */

  function rendre(corps) {
    /* EN MODE SÉLECTION, L'ÉCRAN CHANGE DE MÉTIER : le calendrier et le pied
       de sélection, rien d'autre. Les replis et la barre fixe n'y ont pas
       leur place — on ne consulte pas ses compteurs pendant qu'on coche des
       journées, et les faire cohabiter obligerait à faire défiler pour
       atteindre « Valider ». */
    if (vue.selection) {
      corps.appendChild(panneauCalendrier());
      corps.appendChild(piedSelection());
      return;
    }

    rendreEncarts(corps);
    corps.appendChild(panneauCalendrier());

    if (!vue.entree) {
      corps.appendChild(Kit.ce('p', 'vide',
        'Le contrat de ' + vue.contrat.prenom_enfant + ' ne couvre pas ' +
        Kit.libelleMoisAnnee(vue.annee, vue.mois) + '.'));
      corps.appendChild(replisDepuisDebut().bloc);
      return;
    }

    corps.appendChild(ligneSynthese());

    /* Noah : le repli « Familiarisation », OUVERT, avec son jour-par-jour
       cliquable et son total. Il passe avant « Le mois » : pendant
       l'adaptation, c'est lui le mois. */
    var fam = vue.entree.resultat.familiarisation;
    if (fam && fam.actif) corps.appendChild(replisFamiliarisation(fam).bloc);

    corps.appendChild(replisLeMois().bloc);

    /* LOT 28 — « Journées à part », JUSTE APRÈS « Le mois » et avant les
       réserves : c'est le repli qui explique les chiffres du précédent, il se
       lit dans la foulée. `null` quand le mois n'a rien à part — un repli vide
       serait une case de plus à ouvrir pour lire « rien ». */
    var aPart = replisJourneesAPart();
    if (aPart) corps.appendChild(aPart.bloc);

    corps.appendChild(replisReserves().bloc);
    corps.appendChild(replisNotes().bloc);
    corps.appendChild(replisDepuisDebut().bloc);

    /* LA BARRE FIXE, EN DERNIER : plus besoin de défiler pour la trouver. */
    var pied = Kit.stick(corps);
    var b = Kit.bouton(vue.clos ? 'btn nt' : 'btn', function () {
      global.App.aller('document', {
        contratId: vue.contrat.id, annee: vue.annee, mois: vue.mois
      });
    });
    b.textContent = vue.clos ? 'Revoir le mois clôturé' : 'Vérifier et clôturer le mois';
    pied.appendChild(b);
  }

  /* ------------------------------------------------------------------ */
  /* 2. UN ENCART AU MAXIMUM — et la file derrière lui (§25.2)           */
  /*                                                                     */
  /* L'écran empilait jusqu'à six boîtes : bandeau d'état, encart du jour */
  /* de familiarisation, réserves insuffisantes, choix écarté, mois       */
  /* clôturé, mois à venir. Six boîtes en tête d'écran, c'est un écran    */
  /* qu'on ne lit plus.                                                   */
  /*                                                                     */
  /* Un seul est visible — LE PLUS URGENT. Les autres se déroulent d'un   */
  /* appui sur « N autres points à voir › ». Rien n'est perdu : c'est     */
  /* l'ORDRE et le NOMBRE qui changent, jamais l'existence.               */
  /*                                                                     */
  /* Priorité, du plus urgent au moins : blocage > ventilation écartée >  */
  /* heures à déclarer > état du mois.                                    */
  /* ------------------------------------------------------------------ */

  function rendreEncarts(corps) {
    var points = pointsAvertissement();
    if (!points.length) return;

    corps.appendChild(encartDe(points[0]));
    if (points.length === 1) return;

    var reste = points.slice(1);
    var zone = Kit.ce('div');
    var plus = Kit.bouton('lien', function () {
      plus.hidden = true;
      reste.forEach(function (p) { zone.appendChild(encartDe(p)); });
    });
    plus.textContent = reste.length === 1
      ? '1 autre point à voir ›'
      : reste.length + ' autres points à voir ›';
    plus.style.marginLeft = '0';
    plus.style.marginBottom = '9px';
    corps.appendChild(plus);
    corps.appendChild(zone);
  }

  function encartDe(p) {
    if (!p.action) {
      var e = Kit.enc(p.ton, p.titre, null);
      return e;
    }
    return Kit.encOne(p.ton, p.titre, p.action);
  }

  /* La file, dans l'ordre de priorité. Chaque point : { ton, titre, action }.
     Un point sans action reste une boîte d'information, pas un bouton. */
  function pointsAvertissement() {
    var c = vue.contrat;
    var e = vue.entree;
    var points = [];

    /* --- 1. LES BLOCAGES ---------------------------------------------- */

    /* LE CONTRAT RANGÉ EST LE PREMIER DES BLOCAGES : il verrouille TOUS ses
       mois, et il explique pourquoi rien ne s'ouvre. Sans lui, Maria appuie
       sur des journées inertes sans qu'un mot lui dise pourquoi — c'est le
       défaut que le §18.6 a corrigé, et il ne doit pas revenir.

       LE LIBELLÉ REPREND CELUI DU BANDEAU RETIRÉ AU LOT 25, mot pour mot, et
       l'encart devient une PORTE : le texte complet (« ses mois ne se
       clôturent plus ; le document reste disponible ») vit sur le document,
       qui est aussi le seul écran encore utile sur un contrat rangé. */
    if (vue.range) {
      points.push({
        ton: '',
        titre: 'Ancien contrat — lecture seule',
        action: function () {
          global.App.aller('document', {
            contratId: c.id, annee: vue.annee, mois: vue.mois
          });
        }
      });
    }

    if (e && e.salaireManquant) {
      points.push({
        ton: 'w',
        titre: 'Aucune rémunération connue pour ce mois',
        action: function () { global.App.aller('fiche', { contratId: c.id }); }
      });
    } else if (e && !e.resultat.salaireNetCentimes) {
      /* Un barème SANS NET est un barème présent : le moteur ne signale
         rien, et le total affiché est amputé du salaire entier. */
      points.push({
        ton: 'w',
        titre: 'Le net de votre barème n’est pas renseigné',
        action: function () { global.App.aller('fiche', { contratId: c.id }); }
      });
    }

    if (e && e.avantInitialisation) {
      points.push({
        ton: 'w',
        titre: 'Mois antérieur à la reprise de vos compteurs',
        action: function () { feuilleAvantInitialisation(); }
      });
    }

    if (vue.chaine && vue.chaine.tronquee) {
      points.push({
        ton: 'w',
        titre: 'Historique trop long — seuls les ' + Chaine.MAX_MOIS + ' derniers mois sont rejoués',
        action: function () { global.App.aller('fiche', { contratId: c.id }); }
      });
    }

    /* --- 2. LA VENTILATION ÉCARTÉE ------------------------------------
       Le texte complet des deux avertissements (43 et 33 mots) vit sur la
       FEUILLE qu'ouvre l'encart, avec le bouton « Corriger la répartition ».
       C'est le déplacement exact demandé par le §25.2 : la phrase ne
       disparaît pas, elle arrive au moment où Maria peut agir dessus. */
    var ecartees = (e && e.imputationsEcartees) || [];
    if (ecartees.length) {
      points.push({
        ton: 'w',
        titre: ecartees.length > 1
          ? 'Des répartitions ne correspondent plus à vos réserves'
          : 'Une répartition ne correspond plus à vos réserves',
        action: function () { feuilleReservesInsuffisantes(ecartees); }
      });
    }

    var changees = imputationsChoixEcarte();
    if (changees.length) {
      points.push({
        ton: 'w',
        titre: changees.length > 1
          ? 'Deux répartitions de congés ne correspondent plus'
          : 'Une répartition de congés ne correspond plus',
        action: function () { feuilleChoixEcartes(changees); }
      });
    }

    /* --- 3. LES HEURES À DÉCLARER -------------------------------------- */
    var fj = famDuJourVue();
    if (fj && !vue.lectureSeule) {
      points.push({
        ton: fj.declare ? '' : 'w',
        titre: fj.declare
          ? 'Aujourd’hui — ' + Kit.heures(fj.minutes) + ' déclarées'
          /* ARRIVÉE PUIS DÉPART — l'arrivée est enregistrée : l'encart ne
             réclame plus que le départ, sinon Maria croirait que son geste
             du matin n'a pas été pris. */
          : fj.arrivee
            ? 'Aujourd’hui : arrivée à ' + heureEnTexte(fj.arrivee) + ' — départ à déclarer'
            : 'Aujourd’hui : heures à déclarer',
        action: function () { feuilleFamiliarisation(fj.jour); }
      });
    }

    /* --- 4. L'ÉTAT DU MOIS ---------------------------------------------
       « Chiffres provisoires » DISPARAÎT (§25.2) : la pastille de la carte
       d'accueil et le bandeau du document le disent déjà, et le répéter ici
       occupait la place du seul encart visible.

       Restent les deux états qui portent un GESTE ou un verrou : le mois
       clôturé (vers son document, avec la porte de réouverture) et le mois à
       venir, qui explique pourquoi les cases ne s'ouvrent pas. */
    if (vue.clos) {
      var recapClos = e && e.recap;
      points.push({
        ton: '',
        titre: 'Mois clôturé' +
          (recapClos && recapClos.fige_le ? ' le ' + Kit.dateLongue(recapClos.fige_le) : '') +
          (vue.rouvrable ? ' — touchez un jour pour le rouvrir' : ''),
        action: function () {
          global.App.aller('document', {
            contratId: c.id, annee: vue.annee, mois: vue.mois
          });
        }
      });
    } else if (vue.rouvert) {
      /* LOT 30 (§30.4) — UN MOIS ROUVERT NE S'OUBLIE PAS. Le point mène au
         document, où le bandeau complet et le bouton « Reclôturer » vivent. */
      points.push({
        ton: 'w',
        titre: 'Mois rouvert' +
          (vue.reouvertureLe ? ' le ' + Kit.dateLongue(vue.reouvertureLe) : '') +
          ' — à clôturer à nouveau',
        action: function () {
          global.App.aller('document', {
            contratId: c.id, annee: vue.annee, mois: vue.mois
          });
        }
      });
    } else if (vue.aVenir) {
      points.push({
        ton: '',
        titre: 'Mois à venir — il ne se clôture qu’une fois passé',
        action: null
      });
    }

    return points;
  }

  /* Les périodes dont le choix a été écarté parce que les JOURNÉES ont
     changé — distinct des réserves insuffisantes, qui ont leur propre point
     et leur propre remède. */
  function imputationsChoixEcarte() {
    var appliquees = (vue.entree && vue.entree.resultat &&
                      vue.entree.resultat.imputationsAppliquees) || [];
    var vues = {};
    ((vue.entree && vue.entree.imputationsEcartees) || []).forEach(function (x) {
      vues[x.date_debut + '|' + x.date_fin] = true;
    });
    return appliquees.filter(function (i) {
      if (i.source !== 'defaut_choix_ecarte') return false;
      var ch = i.choixEcarte;
      return !(ch && vues[ch.date_debut + '|' + ch.date_fin]);
    });
  }

  /* LA FEUILLE DES RÉSERVES INSUFFISANTES — le texte complet, et le geste.

     C'est ici que vivent désormais les 43 mots de l'avertissement : nommer la
     période, dire ce que Maria avait choisi et ce dont elle dispose, puis
     ouvrir la ventilation DE CETTE PÉRIODE. Trois nombres qui viennent tous
     du moteur, et un bouton. */
  function feuilleReservesInsuffisantes(ecartees) {
    var c = vue.contrat;
    Kit.ouvrirFeuille(
      ecartees.length > 1
        ? 'Des répartitions ne correspondent plus'
        : 'Une répartition ne correspond plus',
      c.prenom_enfant + ' — ' + Kit.libelleMoisAnnee(vue.annee, vue.mois),
      function (corps) {
        corps.appendChild(Kit.enc('w', null,
          ecartees.map(phraseEcartee).join(' ') +
          ' En attendant, ces congés sont décomptés dans l’ordre habituel de ce contrat.'));
        var b = Kit.bouton('btn', function () {
          Kit.fermerFeuille();
          global.App.aller('conges', {
            annee: vue.annee, mois: vue.mois, corrigerImputation: ecartees[0].id
          }, true);
        });
        b.textContent = 'Corriger la répartition';
        corps.appendChild(b);
      });
  }

  /* La même chose pour l'autre cause : les journées posées ont changé depuis
     la répartition. Deux causes, deux phrases, deux gestes. */
  function feuilleChoixEcartes(ecartees) {
    var c = vue.contrat;
    Kit.ouvrirFeuille(
      ecartees.length > 1
        ? 'Deux répartitions ne correspondent plus'
        : 'Une répartition ne correspond plus',
      c.prenom_enfant, function (corps) {
        corps.appendChild(Kit.enc('w', null,
          ecartees.map(function (i) {
            return 'Du ' + Kit.dateLongue(i.date_debut) + ' au ' + Kit.dateLongue(i.date_fin);
          }).join(', ') + '. Les journées posées ont changé depuis. L’ordre du ' +
          'contrat s’applique en attendant : refaites la répartition depuis ' +
          '« Mes congés ».'));
        var b = Kit.bouton('btn', function () {
          Kit.fermerFeuille();
          global.App.aller('conges', { annee: vue.annee, mois: vue.mois }, true);
        });
        b.textContent = 'Ouvrir « Mes congés »';
        corps.appendChild(b);
      });
  }

  function feuilleAvantInitialisation() {
    Kit.ouvrirFeuille('Mois antérieur à la reprise de vos compteurs', null,
      function (corps) {
        corps.appendChild(Kit.enc('w', null,
          'Les jours et les montants de ce mois sont exacts, mais les soldes ' +
          'd’heures et de congés payés y repartent de zéro : ils ne veulent rien ' +
          'dire. Ce mois se consulte, il ne se clôture pas.'));
      });
  }

  /* Ce que la familiarisation attend AUJOURD'HUI sur le mois affiché, ou
     `null`. Le moteur ne connaît pas la date du jour : c'est la seule chose
     que cet écran sait et que lui ignore. */
  function famDuJourVue() {
    var d = vue.aujourdhui;
    if (!d || d.slice(0, 7) !== vue.annee + '-' + String(vue.mois).padStart(2, '0')) return null;
    var etat = vue.famJours && vue.famJours[d];
    if (!etat) return null;
    return { jour: d, declare: !!etat.declare, minutes: etat.minutes || 0,
             /* ARRIVÉE PUIS DÉPART — l'arrivée déjà enregistrée, s'il y en a
                une : l'encart dit alors qu'il ne manque que le départ. */
             arrivee: etat.declare ? '' : arriveeSeule(d) };
  }

  /* ------------------------------------------------------------------ */
  /* 4. LA LIGNE DE SYNTHÈSE CHIFFRÉE (§25.2)                            */
  /*                                                                     */
  /* « 14 présents · 1 absence · 5 congés · 1 férié ». Elle REMPLACE la   */
  /* légende permanente de sept entrées et la phrase « Rien à faire les   */
  /* jours normaux » : au lieu d'expliquer le codage des couleurs, elle    */
  /* donne les nombres — et le codage s'explique tout seul en regardant   */
  /* le calendrier juste au-dessus.                                       */
  /*                                                                     */
  /* AUCUN CALCUL : les présences viennent du moteur (`joursPresence`),   */
  /* le reste est un COMPTAGE des journées saisies et des fériés du       */
  /* planning — la même lecture d'almanach que `Kit.joursTravailles`.     */
  /* ------------------------------------------------------------------ */

  function ligneSynthese() {
    var r = vue.entree.resultat;
    var bloc = Kit.ce('div', 'synth');
    var journees = vue.journees || {};
    var planning = planningDuMois();

    function compter(type) {
      return Object.keys(journees).filter(function (d) {
        return journees[d].type === type;
      }).length;
    }

    var fam = r.familiarisation;
    if (fam && fam.actif) {
      bloc.appendChild(Kit.pill('', fam.joursDeclares +
        (fam.joursDeclares > 1 ? ' j déclarés' : ' j déclaré')));
      var restants = fam.joursDeLaPeriode - fam.joursDeclares;
      if (restants > 0) {
        bloc.appendChild(Kit.pill('w', restants +
          (restants > 1 ? ' à déclarer' : ' à déclarer')));
      }
    }

    bloc.appendChild(Kit.pill('g', r.joursPresence +
      (r.joursPresence > 1 ? ' présents' : ' présent')));

    var abs = compter('absence_enfant');
    if (abs) bloc.appendChild(Kit.pill('w', abs + (abs > 1 ? ' absences' : ' absence')));

    var cg = compter('conge_maria');
    if (cg) bloc.appendChild(Kit.pill('b', cg + (cg > 1 ? ' congés' : ' congé')));

    var ss = compter('sans_solde');
    if (ss) bloc.appendChild(Kit.pill('b', ss + (ss > 1 ? ' sans solde' : ' sans solde')));

    var nt = compter('hors_planning');
    if (nt) bloc.appendChild(Kit.pill('g', nt + (nt > 1 ? ' non travaillés' : ' non travaillé')));

    var feries = Kit.joursPlanning(vue.contrat, planning, vue.annee, vue.mois)
      .filter(function (d) { return !journees[d] && Feries.estJourFerie(d); }).length;
    if (feries) bloc.appendChild(Kit.pill('g', feries + (feries > 1 ? ' fériés' : ' férié')));

    return bloc;
  }

  /* ------------------------------------------------------------------ */
  /* 5. LES REPLIS                                                       */
  /* ------------------------------------------------------------------ */

  /* « Le mois » — ouvert par défaut, ses lignes actuelles, le total en `tot`.
     Ce sont EXACTEMENT les lignes du panneau d'hier : aucune n'est retirée,
     elles changent seulement de contenant. */
  function replisLeMois() {
    var c = vue.contrat;
    var r = vue.entree.resultat;
    var f = Kit.fold('Le mois', Kit.eur(r.totalAVerserCentimes), { ouvert: true });
    var l = f.corps;

    /* Correction A6 : sur un mois clôturé, le dénominateur d'hier venait d'un
       comptage fait en direct sur les bornes COURANTES du contrat — un
       archivage postérieur faisait passer « 20 j sur 20 » à « 20 j sur 14 »
       sur un document censé ne plus bouger. */
    if (vue.clos) {
      Kit.ligneLn(l, 'Jours de présence', Kit.jours(r.joursPresence));
    } else {
      var travailles = Kit.joursTravailles(c, planningDuMois(), vue.annee, vue.mois,
        vue.journees).length;
      Kit.ligneLn(l, 'Jours de présence', r.joursPresence + ' j sur ' + travailles);
    }

    /* Le net DÛ, jamais le net contractuel (correction B4 du lot 17). */
    var partiel = Chaine.proratOuNull(r);
    Kit.ligneLn(l, 'Salaire net', Kit.eur(Chaine.netDuMois(r)), {
      sous: partiel
        ? 'mois partiel — ' + partiel.joursCouverts + ' jours de garde sur ' +
          partiel.joursDuMois + ' au contrat'
        : null
    });

    Kit.ligneLn(l, libelleEntretien(r), Kit.eur(r.entretienCentimes));

    /* LOT 28 (§28.4) — LA PART DE FAMILIARISATION, EN DEUX LIGNES, comme sur
       le document. Le net et l'entretien ci-dessus sont ceux de la garde
       mensualisée ; le total du repli ajoute la familiarisation. Un total est
       toujours la somme des lignes affichées au-dessus. */
    var fam = Chaine.partFamiliarisation(r);
    if (fam.actif) {
      Kit.ligneLn(l, 'Familiarisation — heures déclarées', Kit.eur(fam.netCentimes), {
        sous: Kit.heures(r.familiarisation.minutesDeclarees || 0) + ' déclarées, au taux du contrat'
      });
      Kit.ligneLn(l, 'Familiarisation — entretien', Kit.eur(fam.entretienCentimes), {
        sous: (r.familiarisation.joursAvecEntretien || 0) + ' jour' +
          ((r.familiarisation.joursAvecEntretien || 0) > 1 ? 's' : '') + ' avec indemnité'
      });
    }

    if (r.joursCongesDecomptes > 0) {
      var imp = r.imputation || {};
      var bouts = [];
      if (imp.joursSurCp) bouts.push(imp.joursSurCp + ' j payés');
      if (imp.joursSurSup) bouts.push(imp.joursSurSup + ' j récup');
      if (imp.joursSansSolde) bouts.push(imp.joursSansSolde + ' j sans solde');
      Kit.ligneLn(l, 'Congés posés', r.joursCongesDecomptes + ' j ouvrables', {
        sous: bouts.join(' · ') || null,
        alerte: (imp.joursSansSolde || 0) > 0
      });
    }
    if (r.retenueSansSoldeCentimes > 0) {
      Kit.ligneLn(l, 'Retenue pour jour(s) sans solde',
        '− ' + Kit.eur(r.retenueSansSoldeCentimes), { alerte: true });
    }

    var sousSup = [];
    if (r.minutesSupAjoutees > 0) sousSup.push('dont ' + Kit.heures(r.minutesSupAjoutees) + ' ajoutées');
    if (r.minutesSupRenoncees > 0) {
      sousSup.push('dont ' + Kit.heures(r.minutesSupRenoncees) + ' non réclamées, votre choix');
    }
    Kit.ligneLn(l, 'Heures sup du mois', Kit.heures(r.minutesSupAcquises), {
      sous: sousSup.join(' · ') || null
    });

    Kit.ligneLn(l, 'Total à verser', Kit.eur(r.totalAVerserCentimes), { total: true });
    return f;
  }

  /* ------------------------------------------------------------------ */
  /* LOT 28 — « JOURNÉES À PART »                                        */
  /*                                                                     */
  /* LE DÉFAUT, SIGNALÉ PAR ADRIEN LE 24 AOÛT 2026 :                     */
  /* « Maria a terminé à 12h30 et le temps restant a été déduit des      */
  /*   heures supplémentaires, mais on ne voit rien dans le récap du     */
  /*   mois. »                                                            */
  /*                                                                     */
  /* Il avait raison, et le chiffre, lui, était juste. Le 2 décembre     */
  /* 2025 porte une libération anticipée déclarée à 12h30 : la référence */
  /* du contrat étant 17h30 + 30 min = 18h00, l'écart vaut − 5 h 30, et  */
  /* décembre affiche « Heures sup du mois — 5 h 00 » au lieu de         */
  /* 10 h 30. Le total est NET, et il est exact.                          */
  /*                                                                     */
  /* Mais rien à l'écran ne disait d'où venait la différence. Le moteur  */
  /* produit pourtant `ecartsDeclares` — la liste jour par jour, avec le */
  /* geste déclaré — depuis le lot 17, et UN SEUL fichier la lisait :    */
  /* `js/ui-document.js`, le document remis à la famille. Autrement dit  */
  /* le parent voyait l'explication et Maria ne la voyait pas. C'est     */
  /* l'exact inverse de ce que cette application existe pour faire.      */
  /*                                                                     */
  /* CE REPLI EST LA RÉCIPROQUE DE LA LOI « RIEN NE SE PERD » (A.2) :    */
  /* un total amputé sans son détail est incontestable et inexplicable   */
  /* en même temps.                                                      */
  /*                                                                     */
  /* CE QU'IL NE FAIT PAS : aucun calcul. Chaque chiffre affiché ici est */
  /* une sortie du moteur — `ecartsDeclares`, `minutesSupBase`,          */
  /* `minutesSupAjoutees`, `minutesSupRenoncees`,                        */
  /* `minutesEcartRecuperation`, `minutesSupAcquises` — jamais une somme */
  /* recomposée à l'écran (§4, B.0-5). La ligne de bas de repli se       */
  /* CONTENTE de les mettre côte à côte, ce qui est précisément ce qui   */
  /* la rend vérifiable : si elle ne se reconstitue pas, c'est le moteur */
  /* qu'il faut regarder, pas cet écran.                                  */
  /*                                                                     */
  /* DEUX GRANULARITÉS, ET C'EST VOULU :                                 */
  /*   · une LIGNE PAR JOUR pour ce que Maria a déclaré — un écart       */
  /*     d'horaire, des minutes ajoutées, un renoncement, une reprise en */
  /*     main de l'entretien ou des heures. C'est rare, daté, et ça       */
  /*     touche un chiffre : ça mérite son jour et sa phrase.             */
  /*   · une LIGNE PAR TYPE, avec les quantièmes, pour les journées sans */
  /*     travail — congés, sans solde, absences de l'enfant, jours non   */
  /*     travaillés. Trois semaines de congés d'été feraient sinon       */
  /*     dix-huit lignes qui enterreraient la seule qui explique un       */
  /*     chiffre. Le détail de ces journées-là vit déjà dans « Mes       */
  /*     congés » et sur le calendrier : il n'est pas perdu, il n'est    */
  /*     pas redit.                                                       */
  /* ------------------------------------------------------------------ */

  /* Les types de journée sans travail, dans l'ordre où le repli les cite, et
     la phrase que chacun mérite. RG-04 (« aucune minute supplémentaire ») est
     énoncée pour les deux types où elle est INCONDITIONNELLE — un congé et un
     sans solde sont dans `TYPES_SANS_MINUTES` du moteur, toujours.

     L'absence de l'enfant N'EN EST PAS : ses 30 minutes dépendent du réglage
     du contrat (RG-09) et de la surcharge du jour, et son indemnité
     d'entretien peut être rétablie à la main (§20.6). Écrire ici une phrase
     générale sur son effet serait fausse un jour sur deux — la ligne se
     contente donc de dater, et la journée s'ouvre d'un appui. */
  var GROUPES_SANS_TRAVAIL = [
    { type: 'conge_maria', titre: 'Mon congé', regle: 'Pas d’heures sup ces jours-là' },
    { type: 'sans_solde', titre: 'Sans solde',
      regle: 'Pas d’heures sup · retenue sur le salaire', alerte: true },
    { type: 'absence_enfant', titre: 'L’enfant était absent', regle: null },
    { type: 'hors_planning', titre: 'Journée non travaillée', regle: null }
  ];

  /* Une journée porte-t-elle une DÉCLARATION de Maria ? C'est le prédicat qui
     décide d'une ligne à elle. Il couvre les mêmes colonnes que
     `journeesManuellesEcrasees` (corrections C1 et C2 du lot 18) : les trois
     de l'ajustement du lot 12, les quatre de l'écart du lot 17, la reprise en
     main des heures réelles et de l'indemnité. La NOTE n'y est pas — elle a
     son propre repli, et elle ne touche aucun chiffre. */
  function porteUneDeclaration(ligne) {
    if (!ligne) return false;
    return (ligne.ecart_minutes != null && ligne.ecart_minutes !== 0) ||
           (ligne.minutes_sup_exceptionnelles || 0) > 0 ||
           (ligne.minutes_sup_renoncees || 0) > 0 ||
           ligne.sup_dues_override != null ||
           ligne.minutes_reelles != null ||
           ligne.entretien_centimes != null;
  }

  /* La phrase d'une journée déclarée. Elle nomme le GESTE avant la poche : le
     geste explique pourquoi le temps a bougé, la poche dit seulement où il est
     allé (correction de la remarque 4 de la relecture du lot 17). Les libellés
     viennent de `Kit`, en un seul exemplaire partagé avec le document remis à
     la famille — pour que Maria et la famille lisent le même mot. */
  function phraseDeclaration(d, ligne, detailSup) {
    var bouts = [];

    if (ligne.ecart_minutes != null && ligne.ecart_minutes !== 0) {
      var geste = Kit.LIBELLE_EVENEMENT_ECART[ligne.ecart_evenement];
      var heure = String(ligne.ecart_heure_reelle || '').slice(0, 5);
      var phrase = geste
        ? geste.charAt(0).toUpperCase() + geste.slice(1)
        : 'Écart d’horaire déclaré';
      if (heure) phrase += ' — ' + heure.replace(':', 'h');
      /* La poche n'est nommée que lorsqu'elle change quelque chose : un écart
         POSITIF n'en a pas à choisir, il va toujours à la récupération. */
      if (detailSup.ecart < 0) {
        var poche = Kit.LIBELLE_DESTINATION_ECART[detailSup.ecartImputeSur];
        if (poche) phrase += ', ' + poche;
      }
      bouts.push(phrase);
    }

    if (detailSup.ajoutees > 0) {
      bouts.push(Kit.duree(detailSup.ajoutees) + ' travaillées en plus');
    }
    if (detailSup.renoncees > 0) {
      bouts.push(Kit.duree(detailSup.renoncees) + ' non réclamées, votre choix');
    }
    /* RG-09 au jour le jour (V8-19) : `null` veut dire « suivre le contrat »,
       `false` et `true` sont deux décisions explicites de Maria. */
    if (ligne.sup_dues_override === false) {
      bouts.push('Vos ' + Kit.duree(reg('minutes_sup_jour', 0)) + ' non réclamées ce jour-là');
    } else if (ligne.sup_dues_override === true) {
      bouts.push('Vos ' + Kit.duree(reg('minutes_sup_jour', 0)) + ' réclamées malgré l’absence');
    }
    if (ligne.minutes_reelles != null) bouts.push('Heures saisies à la main');
    if (ligne.entretien_centimes != null) bouts.push('Entretien saisi à la main');

    return bouts.join(' · ');
  }

  /* La valeur chiffrée d'une journée déclarée : ce que le moteur retient POUR
     CETTE JOURNÉE, signé. « − 5 h 00 » sur le 2 décembre, ce sont les 30 min
     du contrat moins les 5 h 30 rendues — le nombre qui entre réellement dans
     le total du mois, pas l'écart brut. C'est `Engine.minutesSupDuJour` qui le
     dit, à travers `detailSupDuJour` : l'écran ne l'additionne pas. */
  function valeurJourneeDeclaree(detailSup) {
    var m = detailSup.base + detailSup.ajoutees - detailSup.renoncees +
            detailSup.ecartSurRecuperation;
    if (m === 0) return '0';
    return (m > 0 ? '+ ' : '− ') + Kit.duree(m);
  }

  /* Le repli. Rend `null` quand le mois n'a AUCUNE journée à part et qu'il n'y
     a donc rien à expliquer — un repli vide serait une case de plus à ouvrir
     pour lire « rien ». */
  function replisJourneesAPart() {
    var r = vue.entree.resultat;
    var c = vue.contrat;
    var planning = planningDuMois();
    var journees = vue.journees || {};

    var declarees = [];
    var groupes = {};
    var nb = 0;

    Engine.joursDuMois(vue.annee, vue.mois).forEach(function (d) {
      /* Hors contrat : la journée n'existe pas pour ce mois. */
      if ((c.date_debut && d < c.date_debut) || (c.date_fin && d > c.date_fin)) return;
      /* §20.4 — la familiarisation a son propre repli, jour par jour. */
      if (enFamiliarisation(d)) return;

      var ligne = journees[d];
      var type = Kit.typeDuJour(journees, d);

      if (porteUneDeclaration(ligne)) {
        declarees.push({ jour: d, ligne: ligne, type: type });
        nb++;
        return;
      }

      /* Un férié et un jour hors planning SANS ligne saisie ne sont pas des
         journées « à part » : c'est le calendrier, pas une décision. */
      if (type === 'ferie') return;
      if (!ligne && planning.indexOf(Engine.jourSemaine(d)) === -1) return;
      if (type === 'presence') return;

      if (!groupes[type]) groupes[type] = [];
      groupes[type].push(d);
      nb++;
    });

    if (!nb) return null;

    /* OUVERT D'OFFICE QUAND UN ÉCART D'HORAIRE A BOUGÉ LE TOTAL. C'est le cas
       du 2 décembre, celui qui a fait remonter le défaut : un repli fermé
       aurait laissé « 5 h 00 » sans explication à l'écran, ce qui est le
       problème qu'on corrige. Les mois qui n'ont que des congés restent
       fermés — il n'y a alors pas de chiffre surprenant à justifier. */
    var f = Kit.fold('Journées à part', String(nb),
      { ouvert: (r.ecartsDeclares || []).length > 0 });
    var l = f.corps;

    declarees.forEach(function (x) {
      var conditions = cond();
      var detailSup = conditions
        ? Engine.detailSupDuJour(x.ligne, conditions)
        : null;
      /* Sans conditions, on ne prétend RIEN chiffrer : la journée est nommée,
         sa valeur est dite illisible. Un repli silencieux sur zéro afficherait
         un chiffre faux et crédible. */
      Kit.ligneLn(l, Kit.jourLong(x.jour),
        detailSup ? valeurJourneeDeclaree(detailSup) : '—', {
          sous: detailSup ? phraseDeclaration(x.jour, x.ligne, detailSup) : null,
          onclick: vue.lectureSeule ? null : function () { ouvrirJour(x.jour); }
        });
    });

    GROUPES_SANS_TRAVAIL.forEach(function (g) {
      var jours = groupes[g.type];
      if (!jours || !jours.length) return;
      var dates = jours.map(function (d) { return Kit.quantieme(d); }).join(', ') +
        ' ' + Kit.libelleMois(vue.mois);
      Kit.ligneLn(l, g.titre, jours.length + ' j', {
        sous: g.regle ? dates + ' — ' + g.regle.toLowerCase() : dates,
        alerte: !!g.alerte
      });
    });

    /* LA RÉCONCILIATION. Quatre sorties du moteur mises côte à côte, et le
       net qu'elles composent. C'est la ligne qui répond à « pourquoi 5 h 00
       et pas 10 h 30 » sans qu'on ait à faire la soustraction de tête. */
    var parts = [];
    if (r.minutesSupBase > 0) parts.push(Kit.duree(r.minutesSupBase) + ' au contrat');
    if (r.minutesSupAjoutees > 0) parts.push('+ ' + Kit.duree(r.minutesSupAjoutees) + ' en plus');
    if (r.minutesSupRenoncees > 0) {
      parts.push('− ' + Kit.duree(r.minutesSupRenoncees) + ' non réclamées');
    }
    if (r.minutesEcartRecuperation !== 0) {
      parts.push((r.minutesEcartRecuperation > 0 ? '+ ' : '− ') +
        Kit.duree(r.minutesEcartRecuperation) + ' déclarées');
    }
    Kit.ligneLn(l, 'Heures sup du mois', Kit.heures(r.minutesSupAcquises), {
      sous: parts.length > 1 ? parts.join(' · ') : null,
      total: true
    });

    /* Les minutes rendues qui ne sont PAS allées à la récupération ne se lisent
       nulle part ailleurs dans cet écran : le total ci-dessus est déjà net
       d'elles par construction, puisqu'elles n'y sont jamais entrées. Les
       taire ferait disparaître un congé payé consommé ou une retenue. */
    if (r.minutesEcartSurCp > 0) {
      Kit.ligneLn(l, 'Déduit de vos congés payés', Kit.heures(r.minutesEcartSurCp));
    }
    if (r.minutesEcartSansSolde > 0) {
      Kit.ligneLn(l, 'Passé en sans solde', Kit.heures(r.minutesEcartSansSolde),
        { alerte: true });
    }

    return f;
  }

  /* « Réserves » — congés payés, récupération, et LES SAMEDIS COMPTÉS.
     Les barres de progression disparaissent : une barre demande un maximum,
     et le cahier des charges n'en définit aucun pour la récupération — celle
     d'hier était graduée sur dix jours choisis à la main. Les nombres, eux,
     sont vrais.

     LE COMPTEUR BAS ARRIVE ICI (décision d'Adrien du 24 août) : il quitte
     l'Accueil, où il occupait une carte du bloc « Aujourd'hui » sans porter
     aucun geste du jour. */
  function replisReserves() {
    var cs = vue.entree.resultat.compteurSortie || {};
    var parJour = mpjc();
    var cp = Kit.cpSolde(cs);
    var sup = Kit.supSolde(cs);
    var enJours = Chaine.reservesEnJours(cond(), cs);

    var f = Kit.fold('Réserves',
      (cp < 0 ? '− ' + Kit.joursCp(-cp, parJour) : Kit.joursCp(cp, parJour)) +
      ' · ' + (sup < 0 ? '− ' + Kit.heures(-sup) : Kit.heures(sup)));
    var l = f.corps;

    var bas = cp >= 0 && Kit.cpEstBas(cp, cond());
    Kit.ligneLn(l, 'Congés payés',
      cp < 0 ? '− ' + Kit.joursCp(-cp, parJour) : Kit.joursCp(cp, parJour), {
        sous: cp < 0
          ? 'Solde négatif — signalez-le : des congés ont été décomptés au-delà de vos droits'
          : (bas ? 'Réserve basse — un congé d’été passerait en partie sans solde' : null),
        alerte: bas || cp < 0
      });

    Kit.ligneLn(l, 'Récupération',
      sup < 0 ? '− ' + Kit.heures(-sup) : Kit.heures(sup), {
        sous: sup < 0
          ? 'Vous devez ce temps : il se rattrapera sur vos prochaines heures supplémentaires'
          : enJours.joursSup + ' jour' + (enJours.joursSup > 1 ? 's' : '') + ' de congé — ' +
            Kit.duree(parJour) + ' accumulées = 1 jour',
        alerte: sup < 0
      });

    /* §7 — LES SAMEDIS COMPTÉS, contrat par contrat, sur l'année de
       référence du mois affiché. `null` veut dire « pas pu lire » : on le
       dit, on ne le remplace pas par zéro. */
    Kit.ligneLn(l, 'Samedis comptés',
      vue.samedis == null
        ? 'non lus'
        : vue.samedis + ' sur ' + Kit.QUOTA_SAMEDIS,
      { sous: vue.samedis == null ? null : Kit.anneeDeReferenceConges(
          vue.annee + '-' + String(vue.mois).padStart(2, '0') + '-15').libelle });

    /* §18.6 — devant deux réserves, laquelle sera consommée ? La réponse vient
       du réglage daté (RG-07), jamais d'un ordre supposé. */
    Kit.ligneLn(l, 'Déduits d’abord sur', premiereReserve());
    return f;
  }

  /* « Mes notes » — le textarea, et sa mention « pour vous seule » EN
     PLACEHOLDER : c'est la phrase qui doit être là au moment d'écrire, pas
     une ligne de plus à lire avant. */
  function replisNotes() {
    var c = vue.contrat;
    var texte = (vue.note && vue.note.texte) || '';
    var f = Kit.fold('Mes notes', texte ? '1' : '—');

    var zone = document.createElement('textarea');
    /* `note-mois` est le REPÈRE STABLE de ce champ — la feuille de style et
       les tests le désignent par lui depuis le lot 12. Il survit au changement
       de composant : `inp` dit comment il est peint, `note-mois` dit ce qu'il
       est. */
    zone.className = 'inp note-mois';
    zone.rows = 3;
    zone.value = texte;
    zone.setAttribute('aria-label', 'Note sur ' + Kit.libelleMoisAnnee(vue.annee, vue.mois) +
      ' pour ' + c.prenom_enfant);
    zone.placeholder = 'Pour vous seule — jamais sur le document remis à la famille.';

    var etat = Kit.ce('div', 'msg');
    f.corps.appendChild(zone);
    f.corps.appendChild(etat);

    /* Enregistrement à la SORTIE du champ, pas à chaque frappe. */
    var dernierEnregistre = zone.value;
    zone.addEventListener('blur', function () {
      var t = zone.value;
      if (t === dernierEnregistre) return;
      etat.className = 'msg';
      etat.textContent = 'Enregistrement…';
      global.DB.enregistrerNoteMensuelle(c.id, vue.annee, vue.mois, t)
        .then(function (n) {
          dernierEnregistre = t;
          vue.note = n;
          etat.className = 'msg ok';
          etat.textContent = 'Note enregistrée.';
          f.majValeur(t ? '1' : '—');
        })
        .catch(function (e) {
          /* B.0-9 : l'échec est visible, et il dit ce qui reste vrai. Le
             texte est toujours à l'écran : Maria peut le recopier ailleurs. */
          etat.className = 'msg ko';
          etat.textContent = 'La note n’a pas été enregistrée : ' + Kit.messageErreur(e) +
            ' Votre texte est toujours là.';
        });
    });

    if (vue.clos) {
      f.corps.appendChild(Kit.ce('p', 'sb q',
        'Ce mois est clôturé, mais cette note reste modifiable : elle ne fait pas ' +
        'partie des chiffres.'));
    }
    return f;
  }

  /* « Depuis le début » — dont LA LIGNE VERS LA FICHE. Le bouton pleine
     largeur « Contrat, horaires et rémunération » qui fermait l'écran devient
     une ligne de ce repli : on y va rarement, et la barre fixe a pris sa
     place en bas. */
  function replisDepuisDebut() {
    var c = vue.contrat;
    var jusquIci = (vue.chaine.mois || []).filter(function (e) {
      return Chaine.cmpMois(e.annee, e.mois, vue.annee, vue.mois) <= 0;
    });
    var a = Chaine.agregerPeriode(jusquIci);

    var f = Kit.fold('Depuis le début',
      a.nbMois + (a.nbMois > 1 ? ' mois' : ' mois'));
    var l = f.corps;
    Kit.ligneLn(l, 'Contrat démarré le', Kit.dateLongue(c.date_debut));
    Kit.ligneLn(l, 'Jours de présence', Kit.jours(a.joursPresence));
    Kit.ligneLn(l, 'Entretien versé', Kit.eur(a.entretienCentimes));
    Kit.ligneLn(l, 'Voir tous ses mois', '›', {
      onclick: function () {
        global.App.aller('historique', {
          contratId: c.id, annee: vue.annee, mois: vue.mois
        });
      }
    });
    Kit.ligneLn(l, 'Contrat, horaires et rémunération', '›', {
      onclick: function () { global.App.aller('fiche', { contratId: c.id }); }
    });
    return f;
  }

  /* « Familiarisation » — ouvert, le jour-par-jour CLIQUABLE et le total.
     C'est le même détail que l'écran de la période, ramené là où Maria
     travaille : pendant l'adaptation, l'espace enfant EST l'écran du jour. */
  function replisFamiliarisation(fam) {
    var f = Kit.fold('Familiarisation',
      Kit.heures(fam.minutesDeclarees) + ' déclarées', { ouvert: true });
    var l = f.corps;

    (fam.jours || []).forEach(function (x) {
      var etat;
      if (x.declare) {
        etat = Kit.heures(x.minutes) + (x.entretien ? ' · entretien' : ' · sans entretien');
      } else if (x.jour > vue.aujourdhui) {
        etat = 'à venir';
      } else {
        etat = 'à déclarer';
      }
      var ouvrable = !vue.lectureSeule && x.jour <= vue.aujourdhui;
      Kit.ligneLn(l, Kit.jourLong(x.jour), etat, {
        alerte: !x.declare && x.jour <= vue.aujourdhui,
        onclick: ouvrable ? function () { feuilleFamiliarisation(x.jour); } : null
      });
    });

    Kit.ligneLn(l, 'Total déclaré',
      Kit.heures(fam.minutesDeclarees) + ' — ' + Kit.eur(fam.brutCentimes || 0),
      { total: true });
    f.corps.appendChild(Kit.ce('p', 'sb q',
      fam.joursDeclares + ' jour' + (fam.joursDeclares > 1 ? 's' : '') +
      ' déclaré' + (fam.joursDeclares > 1 ? 's' : '') + ' sur ' + fam.joursDeLaPeriode +
      '. Seules les heures déclarées sont payées.'));
    return f;
  }

  /* --- 1. Calendrier ------------------------------------------------- */

  function panneauCalendrier() {
    var table = Kit.ce('table', 'cal');

    var thead = Kit.ce('tr');
    ['L', 'M', 'M', 'J', 'V', 'S', 'D'].forEach(function (j, i) {
      var th = Kit.ce('th', null, j);
      th.setAttribute('aria-label', Kit.JOURS_SEMAINE[i + 1]);
      thead.appendChild(th);
    });
    table.appendChild(thead);

    var jours = Engine.joursDuMois(vue.annee, vue.mois);
    var planning = planningDuMois();
    var tr = Kit.ce('tr');
    var col = Engine.jourSemaine(jours[0]);
    for (var v = 1; v < col; v++) tr.appendChild(cellVide());

    jours.forEach(function (d, index) {
      tr.appendChild(cellule(d, planning));
      col++;
      if (col > 7 && index < jours.length - 1) {
        table.appendChild(tr);
        tr = Kit.ce('tr');
        col = 1;
      }
    });
    while (col <= 7) { tr.appendChild(cellVide()); col++; }
    table.appendChild(tr);
    return table;
  }

  /* ------------------------------------------------------------------ */
  /* LOT 18 §18.1 — MARQUER PLUSIEURS JOURS D'UN COUP (décision V8-10)   */
  /*                                                                     */
  /* La décision existait depuis la maquette v8 et n'avait jamais reçu de */
  /* paragraphe de spécification : ce n'est pas un oubli du développeur   */
  /* précédent, il n'a jamais reçu l'exigence.                            */
  /*                                                                     */
  /* DEUX MARQUAGES, PAS TROIS. « Mon congé » n'entre pas ici : un congé  */
  /* de Maria vaut pour ses quatre contrats et porte une ventilation      */
  /* entre congés payés, récupération et sans solde. Le poser depuis le   */
  /* calendrier d'un seul enfant reviendrait à écrire les journées en     */
  /* laissant la ventilation au moteur — exactement ce que le lot 10 a    */
  /* rendu à Maria.                                                       */
  /*                                                                     */
  /* L'EFFET CHIFFRÉ EST REJOUÉ PAR LE MOTEUR (B.0-5). Aucun « 5 × 5,50 » */
  /* n'est écrit ici : le mois entier est recalculé avec les journées     */
  /* sélectionnées, et l'écart affiché est la différence entre deux       */
  /* résultats du moteur. C'est ce qui rend l'annonce et le résultat      */
  /* identiques par construction (A2).                                    */
  /* ------------------------------------------------------------------ */

  /* Une journée qui porte une absence de MARIA n'est pas sélectionnable : son
     chemin est l'onglet des congés. Tout le reste l'est — y compris une
     familiarisation, qui déclenchera son avertissement avant d'être écrasée
     (§18.1 A3). */
  function selectionnable(d, type) {
    return TYPES_ABSENCE_MARIA.indexOf(type) === -1;
  }

  function entrerSelection() {
    vue.selection = { jours: {}, marque: 'absence_enfant' };
    redessiner();
  }

  function quitterSelection() {
    vue.selection = null;
    redessiner();
  }

  /* COCHER UN JOUR NE REDESSINE PAS L'ÉCRAN.

     Un redessin complet à chaque appui perdrait la position de défilement :
     Maria coche le 8, l'écran remonte en haut, elle redescend, coche le 9, et
     ainsi de suite. Sur le geste dont tout ce paragraphe existe pour réduire
     le nombre d'appuis, ce serait l'exact contraire du but.

     Seuls la case touchée et le pied changent. Le pied est reconstruit — il
     porte le compte et l'effet rejoué par le moteur, qui changent à chaque
     appui — mais il fait vingt lignes, pas un écran. */
  function basculerJour(d, td) {
    if (!vue.selection) return;
    if (vue.selection.jours[d]) delete vue.selection.jours[d];
    else vue.selection.jours[d] = true;

    if (td) {
      var choisi = !!vue.selection.jours[d];
      td.className = td.className.replace(/ ?\bsel\b/, '') + (choisi ? ' sel' : '');
      td.setAttribute('aria-checked', choisi ? 'true' : 'false');
    }
    majPied();
  }

  function majPied() {
    if (!vue || !vue.corps) return;
    var ancien = vue.corps.querySelector('.selbar');
    if (!vue.selection) { if (ancien) ancien.parentNode.removeChild(ancien); return; }
    var neuf = piedSelection();
    if (ancien) ancien.parentNode.replaceChild(neuf, ancien);
    else vue.corps.appendChild(neuf);
  }

  function joursSelectionnes() {
    if (!vue.selection) return [];
    return Object.keys(vue.selection.jours).sort();
  }

  /* Le pied fixe : le compte, le marquage, l'effet, et les deux boutons. */
  function piedSelection() {
    var c = vue.contrat;
    var jours = joursSelectionnes();
    var pied = Kit.ce('div', 'selbar');

    var haut = Kit.ce('div', 'sb-n');
    haut.textContent = jours.length === 0
      ? 'Touchez les jours à marquer'
      : jours.length + (jours.length > 1 ? ' jours choisis' : ' jour choisi');
    pied.appendChild(haut);

    var choix = Kit.ce('div', 'sb-ch');
    [['absence_enfant', 'Absence de ' + c.prenom_enfant],
     ['presence', 'Présence']].forEach(function (o) {
      var b = Kit.bouton('pas' + (vue.selection.marque === o[0] ? ' on' : ''), function () {
        vue.selection.marque = o[0];
        majPied();
      });
      b.textContent = o[1];
      b.setAttribute('aria-pressed', vue.selection.marque === o[0] ? 'true' : 'false');
      choix.appendChild(b);
    });
    pied.appendChild(choix);

    if (jours.length) {
      pied.appendChild(Kit.ce('div', 'sb-ef', effetSelection(jours, vue.selection.marque)));
      /* CORRECTION C1/C2 DU LOT 18 — l'avertissement couvre désormais les
         sept colonnes qu'un marquage détruit, pas trois. La note, elle,
         survit : elle n'a plus à être annoncée. */
      var perdues = journeesManuellesEcrasees(jours);
      if (perdues.length) {
        pied.appendChild(Kit.ce('div', 'sb-wa',
          'Une saisie manuelle sera effacée : ' + libelleJours(perdues) +
          '. Ces journées portent des heures, une indemnité ou un écart d’horaire ' +
          'saisis à la main. Vos notes, elles, sont conservées.'));
      }
    }

    var actions = Kit.ce('div', 'sb-ac');
    var bOk = Kit.bouton('btn pr', function () { validerSelection(bOk); });
    bOk.textContent = 'Valider';
    bOk.disabled = jours.length === 0;
    actions.appendChild(bOk);
    var bNon = Kit.bouton('btn nt', function () { quitterSelection(); });
    bNon.textContent = 'Annuler';
    actions.appendChild(bNon);
    pied.appendChild(actions);
    return pied;
  }

  /* Les journées de CE contrat que le marquage va écraser : une
     familiarisation, des heures réelles ou une indemnité saisies à la main.
     Même prédicat que `journeesEcrasees`, appliqué au contrat courant. */
  /* CORRECTION C1 ET C2 DE LA RELECTURE DU LOT 18 — LE PRÉDICAT COUVRE TOUT
     CE QU'UN MARQUAGE GROUPÉ DÉTRUIT, pas trois colonnes sur sept.

     Il ne regardait que la familiarisation, les heures réelles et l'indemnité
     saisies à la main. Il ignorait les trois colonnes d'ajustement du lot 12
     et les quatre de l'écart d'horaire du lot 17 — c'est-à-dire précisément ce
     que la correction de B1 efface désormais. Maria n'était prévenue de rien.

     La NOTE n'y figure pas, et c'est voulu : depuis la correction de B1 elle
     survit au marquage. Avertir de la perte d'une donnée qui ne se perd plus
     serait aussi faux que de se taire sur celles qui se perdent. */
  function journeesManuellesEcrasees(jours) {
    var out = [];
    jours.forEach(function (d) {
      var l = (vue.journees || {})[d];
      if (!l) return;
      if (l.type === 'familiarisation' ||
          l.minutes_reelles != null || l.entretien_centimes != null ||
          (l.minutes_sup_exceptionnelles || 0) > 0 ||
          (l.minutes_sup_renoncees || 0) > 0 ||
          l.sup_dues_override != null ||
          l.ecart_minutes != null) out.push(d);
    });
    return out;
  }

  /* Les journées d'une sélection qui portent une NOTE. Elles ne peuvent pas
     passer par la suppression, qui détruirait la ligne entière — donc la note
     avec (correction C2). */
  function journeesAvecNote(jours) {
    return jours.filter(function (d) {
      var l = (vue.journees || {})[d];
      return !!(l && l.commentaire);
    });
  }

  function libelleJours(jours) {
    return jours.map(function (d) { return String(Number(d.slice(8, 10))); }).join(', ') +
      ' ' + Kit.libelleMois(vue.mois);
  }

  /* L'EFFET, REJOUÉ PAR LE MOTEUR. Deux résultats, une soustraction : rien
     d'autre. Le libellé des minutes suit RG-09 tel que le contrat le règle,
     il ne le devine pas. */
  function effetSelection(jours, marque) {
    var avant = vue.entree.resultat;
    var apres = simulerJours(jours, marque === 'presence' ? null : marque);

    var dEntretien = (apres.entretienCentimes || 0) - (avant.entretienCentimes || 0);
    var dSup = (apres.minutesSupAcquises || 0) - (avant.minutesSupAcquises || 0);
    var dTotal = (apres.totalAVerserCentimes || 0) - (avant.totalAVerserCentimes || 0);

    if (dEntretien === 0 && dSup === 0 && dTotal === 0) {
      return 'Aucun changement sur le mois : ces journées sont déjà ainsi.';
    }

    var phrase = '';
    if (dEntretien !== 0) {
      phrase += 'Entretien : ' + (dEntretien < 0 ? '− ' : '+ ') +
        Kit.eur(Math.abs(dEntretien)) + ' sur le mois. ';
    }
    var minutesJour = reg('minutes_sup_jour', 0);
    if (dSup === 0 && minutesJour > 0) {
      phrase += 'Vos ' + Kit.duree(minutesJour) + ' par jour restent dues.';
    } else if (dSup < 0 && marque === 'absence_enfant') {
      /* §28.2 — quand l'enfant est absent, les minutes ne sont pas dues. Les
         minutes ajoutées à la main y passent aussi (lot 18, B1) : on le dit,
         par différence de deux résultats du moteur. */
      var dAjoutees = (apres.minutesSupAjoutees || 0) - (avant.minutesSupAjoutees || 0);
      phrase += Kit.duree(-dSup) + ' non dues : aucune minute quand l’enfant est absent' +
        (dAjoutees < 0 ? ', dont ' + Kit.duree(-dAjoutees) + ' ajoutées à la main' : '') + '.';
    } else if (dSup < 0) {
      phrase += Kit.duree(-dSup) + ' de récupération en moins.';
    } else if (dSup > 0) {
      phrase += Kit.duree(dSup) + ' de récupération en plus.';
    }
    if (!phrase) {
      phrase = 'Total à verser : ' + (dTotal < 0 ? '− ' : '+ ') + Kit.eur(Math.abs(dTotal)) + '.';
    }
    return phrase.trim();
  }

  function validerSelection(bouton) {
    var jours = joursSelectionnes();
    if (!jours.length) return;
    var c = vue.contrat;
    var marque = vue.selection.marque;
    var retour = { contrats: [c.id], jours: jours };

    /* LOT 30 (§30.2) — LA MULTI-SÉLECTION SUR UN MOIS CLÔTURÉ propose la
       réouverture, puis reprend la sélection telle quelle et l'écrit. */
    if (vue.rouvrable) {
      var sauvegarde = { jours: jours.slice(), marque: marque };
      return proposerReouverture(null, function () {
        if (!vue || vue.rouvrable) return;
        entrerSelection();
        vue.selection.marque = sauvegarde.marque;
        sauvegarde.jours.forEach(function (j) { vue.selection.jours[j] = true; });
        redessiner();
        return validerSelection(null);
      });
    }

    if (marque === 'presence') {
      /* CORRECTION C2 DE LA RELECTURE DU LOT 18 — LA NOTE SURVIT AU RETOUR À
         LA PRÉSENCE.

         La suppression détruit la ligne entière : la note avec. Les journées
         annotées passent donc par une écriture qui pose `type = 'presence'`
         et remet les ajustements à plat SANS toucher au commentaire. Pour le
         moteur, une journée de présence sans ajustement et une journée sans
         ligne se calculent à l'identique : l'effet annoncé reste celui obtenu
         (§18.1 A2). */
      var annotees = journeesAvecNote(jours);
      var ordinaires = jours.filter(function (d) { return annotees.indexOf(d) === -1; });
      var gestes = [];
      if (ordinaires.length) gestes.push(global.DB.supprimerJournees(c.id, ordinaires));
      if (annotees.length) gestes.push(global.DB.marquerJournees(c.id, annotees, 'presence'));
      ecrire(Promise.all(gestes), bouton,
        jours.length > 1 ? jours.length + ' journées enregistrées' : 'Journée enregistrée',
        retour);
      return;
    }
    ecrire(global.DB.marquerJournees(c.id, jours, 'absence_enfant'), bouton,
      jours.length > 1
        ? jours.length + ' journées notées en absence'
        : c.prenom_enfant + ' ' + Kit.accordDe(c, 'noté') + ' ' + Kit.accordDe(c, 'absent'),
      retour);
  }

  function majuscule(t) { return String(t).charAt(0).toUpperCase() + String(t).slice(1); }

  function cellVide() { return Kit.ce('td', 'we no'); }

  /* LOT 20 (§20.4) — la case d'un jour de familiarisation. Elle ne passe pas
     par le mode sélection : « marquer plusieurs jours » sert à poser des
     absences d'enfant, et une journée de familiarisation se déclare heure par
     heure, jamais en lot. Un jour passé non déclaré porte l'orange — c'est le
     seul endroit du calendrier où l'application RÉCLAME quelque chose. */
  function celluleFamiliarisation(d, jour, classe, mini, aDeclarer) {
    var td = Kit.ce('td', classe +
      (aDeclarer ? ' warn' : '') +
      (d > vue.aujourdhui ? ' futur' : '') +
      (d === vue.aujourdhui ? ' auj' : '') +
      (vue.lectureSeule && !vue.rouvrable ? ' no' : ''));
    td.appendChild(Kit.ce('div', 'num', String(jour)));
    td.appendChild(Kit.ce('div', 'mini', mini));
    if (d === vue.aujourdhui) td.setAttribute('aria-current', 'date');
    /* §30.2 — un mois clôturé reste touchable : le toucher propose de le
       rouvrir. */
    if (vue.selection || (vue.lectureSeule && !vue.rouvrable)) {
      if (vue.selection) td.className += ' hors-sel';
      return td;
    }
    td.setAttribute('role', 'button');
    td.setAttribute('tabindex', '0');
    td.setAttribute('aria-label', Kit.jourLong(d) + ' — familiarisation, ' +
      (mini === 'en cours' ? 'arrivée enregistrée, départ à déclarer'
        : aDeclarer ? 'heures à déclarer' : mini));
    td.addEventListener('click', function () { feuilleFamiliarisation(d); });
    td.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); feuilleFamiliarisation(d); }
    });
    return td;
  }

  function cellule(d, planning) {
    var c = vue.contrat;
    var jour = Number(d.slice(8, 10));
    var horsPlanning = planning.indexOf(Engine.jourSemaine(d)) === -1;
    var horsBornes = (c.date_debut && d < c.date_debut) || (c.date_fin && d > c.date_fin);
    var type = Kit.typeDuJour(vue.journees, d);

    /* Lot 7 — on ne saisit pas l'avenir (V8-05, piège n° 7). Un jour à venir
       touchable permettait de noter une absence qui n'a pas encore eu lieu, ce
       qui rendait le décompte des jours restants faux et la projection
       incohérente. Les congés se posent depuis « Mes congés », pas ici. */
    var aVenir = d > vue.aujourdhui;

    var classe, mini = null, touchable = false;
    /* LOT 20 (§20.4) — LA PÉRIODE PRIME, ICI AUSSI. Le moteur traite un jour
       de la période en familiarisation quoi que porte sa ligne : le calendrier
       doit montrer la même chose, sinon Maria lit un « férié » sur une case
       que le récapitulatif compte autrement. Les bornes du contrat et le
       planning restent au-dessus — un jour hors contrat n'existe pas. */
    var fam = enFamiliarisation(d);
    if (fam && !horsBornes && !horsPlanning) {
      var etatFam = vue.famJours[d];
      classe = 'ok';
      /* ARRIVÉE PUIS DÉPART — une arrivée enregistrée sans départ est une
         journée « en cours » : elle GARDE l'orange, il manque le départ et
         l'application a toujours quelque chose à réclamer. Rien n'est payé :
         le moteur ne voit que `minutes_reelles`, restée `null`. */
      var enCours = !etatFam.declare && !!arriveeSeule(d);
      mini = etatFam.declare ? Kit.heures(etatFam.minutes)
           : enCours ? 'en cours'
           : (d > vue.aujourdhui ? 'à venir' : 'à décl.');
      var td0 = celluleFamiliarisation(d, jour, classe, mini,
        !etatFam.declare && (d <= vue.aujourdhui || enCours));
      return td0;
    }
    if (horsBornes) { classe = 'we no'; }
    else if (type === 'ferie') { classe = 'fe no'; mini = 'férié'; }
    else if (horsPlanning) { classe = 'we no'; }
    else if (type === 'conge_maria') { classe = 'cg'; mini = 'congé'; touchable = true; }
    else if (type === 'sans_solde') { classe = 'cg'; mini = 'ss solde'; touchable = true; }
    else if (type === 'hors_planning') { classe = 'nt'; mini = 'non trav.'; touchable = true; }
    else if (type === 'familiarisation') { classe = 'ok'; mini = 'familia.'; touchable = true; }
    else if (type === 'absence_enfant') { classe = 'ab'; mini = 'abs.'; touchable = true; }
    else { classe = 'ok'; touchable = true; }

    /* Un congé DÉJÀ POSÉ dans le futur reste touchable : Maria doit pouvoir le
       retirer (correction A13 du lot 6). C'est la journée ORDINAIRE à venir
       qu'on gèle, pas la journée déjà décidée. */
    var dejaSaisi = !!(vue.journees || {})[d];
    if (aVenir && !dejaSaisi) touchable = false;

    /* LOT 12 (A3) — une journée annotée porte un repère. C'est une FORME —
       un point —, jamais une couleur seule : le calendrier a déjà quatre
       états codés par la couleur, et une cinquième teinte n'y serait plus
       lisible. Le repère est aussi annoncé aux lecteurs d'écran. */
    var ligneJour = (vue.journees || {})[d];
    var annotee = !!(ligneJour && ligneJour.commentaire);
    var ajustee = !!(ligneJour && ((ligneJour.minutes_sup_exceptionnelles || 0) > 0 ||
                                   (ligneJour.minutes_sup_renoncees || 0) > 0));
    /* CORRECTION B2 — un congé posé à l'heure SE VOIT sur le calendrier. Il ne
       change pas l'état de la journée — elle reste présente — donc il porte un
       repère, comme la note et l'ajustement, jamais une couleur de plus. */
    var congePose = !!(ligneJour && ligneJour.ecart_evenement === 'conge_horaire');

    var td = Kit.ce('td', classe +
      (aVenir ? ' futur' : '') +
      (d === vue.aujourdhui ? ' auj' : '') +
      (touchable && vue.lectureSeule && !vue.rouvrable ? ' no' : ''));
    td.appendChild(Kit.ce('div', 'num', String(jour)));
    if (mini) td.appendChild(Kit.ce('div', 'mini', mini));
    if (annotee || ajustee || congePose) {
      var reperes = Kit.ce('div', 'reperes');
      if (annotee) reperes.appendChild(Kit.ce('span', 'rp note', '•'));
      if (ajustee) reperes.appendChild(Kit.ce('span', 'rp heures', '◆'));
      if (congePose) reperes.appendChild(Kit.ce('span', 'rp conge', '▾'));
      td.appendChild(reperes);
      var dits = [];
      if (annotee) dits.push('journée annotée');
      if (ajustee) dits.push('heures ajustées');
      if (congePose) dits.push('congé posé sur cette journée');
      td.setAttribute('aria-description', dits.join(', '));
    }
    if (d === vue.aujourdhui) td.setAttribute('aria-current', 'date');

    /* LOT 18 §18.1 — EN MODE SÉLECTION, LA CASE CHANGE DE MÉTIER. Elle ne
       s'ouvre plus, elle se coche. Les journées qui portent une absence de
       MARIA restent hors d'atteinte : un congé vaut pour les quatre contrats
       et se retire depuis « Mes congés », jamais depuis le calendrier d'un
       seul enfant (décision V8-09). */
    if (vue.selection) {
      if (touchable && (!vue.lectureSeule || vue.rouvrable) && selectionnable(d, type)) {
        var choisi = !!vue.selection.jours[d];
        if (choisi) td.className += ' sel';
        td.setAttribute('role', 'checkbox');
        td.setAttribute('aria-checked', choisi ? 'true' : 'false');
        td.setAttribute('tabindex', '0');
        td.setAttribute('aria-label', Kit.jourLong(d));
        td.addEventListener('click', function () { basculerJour(d, td); });
        td.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); basculerJour(d, td); }
        });
      } else {
        td.className += ' hors-sel';
      }
      return td;
    }

    if (touchable && (!vue.lectureSeule || vue.rouvrable)) {
      td.setAttribute('role', 'button');
      td.setAttribute('tabindex', '0');
      td.setAttribute('aria-label', Kit.jourLong(d) +
        (vue.rouvrable ? ' — mois clôturé, toucher pour rouvrir' : ''));
      td.addEventListener('click', function () { ouvrirJour(d); });
      td.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ouvrirJour(d); }
      });
    }
    return td;
  }

  function libelleEntretien(r) {
    var parJour = reg('entretien_centimes_jour', 0);
    var attendu = r.joursPresence * parJour;
    if (attendu === r.entretienCentimes) {
      return 'Entretien — ' + r.joursPresence + ' j × ' + Kit.eur(parJour);
    }
    return 'Indemnité d’entretien';
  }

  /* §18.6 — DEVANT DEUX RÉSERVES, LAQUELLE SERA CONSOMMÉE ? La question se
     pose à chaque congé posé, et la réponse était introuvable sans ouvrir la
     fiche du contrat. Elle vient du réglage daté (RG-07), jamais d'un ordre
     supposé. */
  function premiereReserve() {
    return reg('ordre_imputation', 'cp_puis_sup') === 'sup_puis_cp'
      ? 'votre récupération' : 'les congés payés';
  }

  /* ------------------------------------------------------------------ */
  /* Feuille de saisie d'une journée (§2.3)                              */
  /* ------------------------------------------------------------------ */

  /* ------------------------------------------------------------------ */
  /* LA FEUILLE DU JOUR — UNE SEULE LISTE DE CHOIX                       */
  /*                                                                     */
  /* RETOUR D'ADRIEN, 23 AOÛT 2026 : « TROP DE TRUCS, C'EST LE BAZAR ».  */
  /*                                                                     */
  /* Cette feuille avait empilé les couches de quatre lots : deux grosses */
  /* cartes « était là / était absente », un paragraphe permanent sur les */
  /* congés, trois `<details>` repliés, puis un bouton « Autre cas… ».    */
  /* Quatre styles de présentation pour des choix de même nature, dans    */
  /* une seule feuille.                                                   */
  /*                                                                     */
  /* La cible est la maquette : UNE liste, tous les choix du même style,  */
  /* ce qui se déplie apparaît sous la liste, UN bouton « Enregistrer ».  */
  /*                                                                     */
  /* C'EST UNE RÉORGANISATION, PAS UN RETRAIT. Tout ce que la feuille     */
  /* savait faire se fait encore : la déclaration d'horaire du lot 17 et  */
  /* sa destination (§17.6), l'interrupteur d'entretien du lot 20         */
  /* (§20.6), l'absence de l'enfant, la note du lot 12, l'ajustement      */
  /* manuel des heures (rangé dans « Autre cas… »), et tous les           */
  /* avertissements conditionnels. Les aperçus chiffrés restent REJOUÉS   */
  /* PAR LE MOTEUR — aucun n'est recomposé ici (§4, B.0-5).              */
  /* ------------------------------------------------------------------ */

  /* Les trois déclarations d'horaire, dans l'ordre et avec les libellés de la
     maquette. Le SENS de chacune — quelle heure est demandée, quel signe est
     attendu — reste celui du lot 17, `SIGNE_ATTENDU` fait foi. */
  var CHOIX_ECART = [
    { cle: 'retard_parent', libelle: 'Un parent est venu en retard' },
    { cle: 'liberation_anticipee', libelle: 'J’ai libéré plus tôt' },
    { cle: 'arrivee_decalee', libelle: 'J’ai demandé une arrivée plus tardive' }
  ];

  /* §25.2 — la feuille courte d'un jour de congé. Elle NOMME ce qui est posé
     et renvoie là où il se retire. Trois lignes, un bouton. */
  function feuilleJourEnConge(d) {
    Kit.ouvrirFeuille(Kit.jourLong(d),
      vue.contrat.prenom_enfant + ' — famille ' +
        ((vue.contrat.famille && vue.contrat.famille.nom) || '—'),
      function (corps) {
        corps.appendChild(Kit.enc('', 'Congé posé sur ce jour',
          'Il se retire depuis « Mes congés » — c’est là que les compteurs de ' +
          'chaque enfant sont rendus en même temps que la journée.'));
        var b = Kit.bouton('btn nt', function () {
          Kit.fermerFeuille();
          global.App.aller('conges', { annee: vue.annee, mois: vue.mois }, true);
        });
        b.textContent = 'Ouvrir « Mes congés »';
        corps.appendChild(b);
      });
  }

  /* LOT 30 (§30.2) — la feuille courte, puis le geste qui continue. Après la
     réouverture, l'écran est rechargé (le mois a changé d'état) et la feuille
     du jour s'ouvre d'elle-même sur le même jour. */
  function proposerReouverture(d, apresReouverture) {
    var c = vue.contrat;
    var m = { annee: vue.annee, mois: vue.mois };
    if (!vue.entree || !vue.entree.recap) {
      Kit.toast('Impossible de vérifier l’état de ce mois : rien n’a été modifié.', true);
      return;
    }
    return global.UiReouverture.feuilleRouvrirEtContinuer({
      mois: [{ contrat: c, annee: m.annee, mois: m.mois, recap: vue.entree.recap }],
      titre: 'Ce mois est clôturé',
      question: d
        ? 'Le rouvrir pour corriger le ' + Kit.jourLong(d).toLowerCase() + ' ?'
        : 'Le rouvrir pour marquer ces journées ?',
      bouton: d ? 'Rouvrir et corriger ce jour' : 'Rouvrir et marquer ces journées',
      motif: null,
      continuer: function () {
        return global.App.rafraichir().then(function () {
          if (typeof apresReouverture === 'function') return apresReouverture();
          if (d && vue && !vue.rouvrable) return ouvrirJour(d);
        });
      }
    });
  }

  function ouvrirJour(d) {
    /* LOT 30 (§30.2) — TOUCHER UN JOUR D'UN MOIS CLÔTURÉ OUVRE UNE FEUILLE
       COURTE, au lieu de ne rien faire : « Ce mois est clôturé. Le rouvrir
       pour corriger le mardi 14 avril ? ». Un appui : le mois est rouvert ET
       la feuille du jour s'ouvre, prête. Maria n'a pas quitté son calendrier.
       Le motif n'est pas demandé : il se saisit après coup, depuis le
       bandeau. */
    if (vue.rouvrable) return proposerReouverture(d);
    if (vue.lectureSeule) return;
    /* §20.4 — un jour de la période n'a qu'un seul geste : déclarer ses
       heures. Lui proposer la liste ci-dessous offrirait des choix que le
       moteur ignore à l'intérieur de la période. */
    if (enFamiliarisation(d)) return feuilleFamiliarisation(d);

    var c = vue.contrat;
    var conditions = cond();
    var ligne = (vue.journees || {})[d] || {};
    var type = Kit.typeDuJour(vue.journees, d);
    var servis = contratsServis(d);

    /* §25.2 — UN JOUR COUVERT PAR UN CONGÉ POSÉ OUVRE UNE FEUILLE COURTE.

       La liste des sept choix n'a rien à y faire : elle proposait « Finalement,
       je travaillais », qui retirait la journée de congé sur les contrats
       servis MAIS LAISSAIT L'IMPUTATION EN PLACE. Le moteur l'écartait alors,
       et Maria lisait « une répartition ne correspond plus » sans avoir rien
       demandé — c'est le défaut que l'encart du haut signale.

       Le retrait se fait donc là où il rend AUSSI les compteurs : « Mes congés
       → Retirer des congés », qui supprime la période et remet les journées
       en présence, ensemble. Le geste ne disparaît pas, il change de porte. */
    if (TYPES_ABSENCE_MARIA.indexOf(type) !== -1 && type === 'conge_maria') {
      return feuilleJourEnConge(d);
    }

    /* CORRECTION B2 DE LA RELECTURE DES LOTS 20 À 22, CONSERVÉE. Le lot 21
       écrit un congé posé à l'heure sur les colonnes `ecart_*`. Les deux ne
       peuvent pas coexister : ce sont les mêmes colonnes. La feuille nomme
       donc le congé et renvoie là où il se retire, au lieu d'offrir une
       déclaration qui le ferait disparaître sans un mot. */
    var congeHoraire = ligne.ecart_evenement === 'conge_horaire';
    var absenceMaria = TYPES_ABSENCE_MARIA.indexOf(type) !== -1;
    /* RG-04 : ces journées ne portent aucune minute, écart compris. Proposer
       la déclaration dessus laisserait croire à un effet qui n'existe pas. */
    /* LOT 29 (§29.2, 1) — SUR UNE ABSENCE, LA DÉCLARATION EST OFFERTE QUAND
       MÊME : « si j'ai mis absent je ne peux pas vraiment corriger et dire
       que l'enfant est parti plus tôt » (Adrien). Elle ne pose pas l'écart
       sur l'absence — elle remet la journée en présence, et l'écran l'annonce
       avant. `TYPES_SANS_ECART` dit ce qu'une journée peut PORTER ; ici on
       décide ce que Maria peut DÉCLARER. */
    var ecartsPossibles = !!conditions && !congeHoraire &&
      (type === 'absence_enfant' || TYPES_SANS_ECART.indexOf(type) === -1);

    var etat = {
      choix: null,
      heure: null,
      minutes: null,
      destination: ligne.ecart_impute_sur || 'recuperation',
      /* §20.6 — l'indemnité du jour. Due par défaut : retirer est un choix. */
      entretien: ligne.entretien_du !== false,
      texte: ligne.commentaire == null ? '' : String(ligne.commentaire),
      pret: false
    };
    /* UNE JOURNÉE QUI PORTE DÉJÀ UNE DÉCLARATION S'OUVRE DESSUS.
       « Il faut qu'elle puisse corriger » (Adrien, 23 août) : Maria retrouve
       son choix coché et son heure dans le champ, elle change l'heure, elle
       enregistre. Sans cela, corriger un retard demanderait de le retirer
       d'abord, puis de le redéclarer. */
    if (ecartsPossibles && SIGNE_ATTENDU[ligne.ecart_evenement]) {
      etat.choix = ligne.ecart_evenement;
      etat.heure = String(ligne.ecart_heure_reelle || '').slice(0, 5) || null;
    } else if (type === 'absence_enfant') {
      etat.choix = 'absence_enfant';
    }

    Kit.ouvrirFeuille(Kit.jourLong(d),
      c.prenom_enfant + ' — famille ' + ((c.famille && c.famille.nom) || '—'),
      function (corps) {
        /* LES AVERTISSEMENTS CONDITIONNELS D'ABORD. Ils ne s'affichent que
           quand leur condition est vraie — c'est pour ça que la feuille peut
           être courte — et ils disent ce que le geste va coûter AVANT qu'il
           soit fait, pas après. */
        avertirVentilation(corps, d);
        avertirClos(corps, d);
        avertirEcrasement(corps, d, servis);

        if (congeHoraire) corps.appendChild(blocCongeHorairePose(d, ligne));

        if (type === 'familiarisation') {
          corps.appendChild(Kit.ce('p', 'sb q',
            'Journée de familiarisation, saisie à la main (heures réelles et ' +
            'indemnité). La modifier ci-dessous effacera ces valeurs.'));
        }

        /* LE PARAGRAPHE PERMANENT SUR LES CONGÉS A DISPARU (décision d'Adrien
           du 23 août). La règle V8-09, elle, ne change pas : il n'y a toujours
           AUCUN choix « congé » dans cette liste, et un jour couvert par un
           congé posé garde son encart d'information (correction B2 ci-dessus).
           Le paragraphe expliquait où poser un congé sur une feuille où Maria
           n'était pas venue en poser un. */
        corps.appendChild(Kit.ce('p', 'sb amorce', 'Ce jour-là…'));

        var liste = Kit.ce('div', 'liste-choix');
        liste.setAttribute('role', 'radiogroup');
        corps.appendChild(liste);

        var detail = Kit.ce('div', 'detail-choix');
        corps.appendChild(detail);

        /* UN SEUL BOUTON, inactif tant que le choix n'est pas complet. */
        var bouton = Kit.bouton('btn', function () { enregistrer(bouton); });
        bouton.textContent = 'Enregistrer';
        corps.appendChild(bouton);

        dessinerListe();

        /* ---------------------------------------------------------- */

        function poser(cle, libelle, sous) {
          poserOption(liste, etat.choix === cle, libelle, sous || null, function () {
            if (etat.choix === cle) return;
            etat.choix = cle;
            etat.minutes = null;
            /* L'heure ne se traîne pas d'un événement à l'autre : une heure de
               départ recopiée dans « arrivée plus tardive » afficherait un
               refus de signe que Maria n'a pas provoqué. */
            etat.heure = (cle === ligne.ecart_evenement)
              ? (String(ligne.ecart_heure_reelle || '').slice(0, 5) || null) : null;
            dessinerListe();
          });
        }

        function dessinerListe() {
          Kit.vider(liste);
          if (absenceMaria) {
            /* Un jour où Maria ne travaillait pas : les trois déclarations
               d'horaire et l'absence de l'enfant n'y produiraient rien
               (RG-04). Le geste de retour garde le libellé qui le nomme le
               mieux ici, dans le style de la liste et non plus en carte. */
            poser('retour', 'Finalement, je travaillais');
          } else {
            if (ecartsPossibles) {
              CHOIX_ECART.forEach(function (x) { poser(x.cle, x.libelle); });
            }
            /* LOT 29 — marquer une absence EFFACE l'écart de la journée
               (§29.2, 2). Un congé posé à l'heure vit sur les mêmes colonnes
               et ne se retire que depuis « Mes congés » (garde-fou B2) : on
               n'offre donc pas l'absence par-dessus, sinon elle l'effacerait
               en silence. L'encart au-dessus dit où le retirer. */
            if (!congeHoraire) poser('absence_enfant', 'Absence de ' + c.prenom_enfant);
          }
          poser('note', 'Une note sur la journée');
          if (!absenceMaria && !congeHoraire) {
            /* « Présence (annuler les écarts) » de la maquette a été renommé :
               un enfant peut être présent ET un parent en retard, les deux ne
               s'opposent pas (remarque d'Adrien, 23 août). Ce choix ne sert
               qu'à défaire. */
            poser('retour', 'Finalement, rien de particulier ce jour-là');
          }
          /* « Autre cas… » ENTRE DANS LA LISTE, EN DERNIER (décision d'Adrien
             du 23 août) — même style que les autres choix, plus un bouton à
             part. Il ouvre une feuille au lieu de déplier : il ne se coche
             jamais, et il n'est donc PAS annoncé comme une pastille radio.
             Un lecteur d'écran qui lirait « case non cochée » sur un geste qui
             ouvre un autre écran dirait faux (V8-01, V8-05) : le chevron et le
             rôle de bouton disent ce qu'il fait. La ligne, elle, est la même. */
          Kit.choix(liste, 'c1 autre', '›', 'Autre cas…',
            'Jour non travaillé, sans solde, ajustement de vos heures',
            function () { feuilleAutresCas(d, servis); });
          dessinerDetail();
        }

        function dessinerDetail() {
          Kit.vider(detail);
          etat.pret = false;
          if (SIGNE_ATTENDU[etat.choix]) dessinerEcart(etat.choix);
          else if (etat.choix === 'absence_enfant') dessinerAbsence();
          else if (etat.choix === 'note') dessinerNote();
          else if (etat.choix === 'retour') dessinerRetour();
          else if (ecartsPossibles) {
            /* §17.5 A3 — SANS DÉCLARATION, RIEN NE CHANGE. C'est la règle la
               plus facile à perdre, parce qu'elle est une ABSENCE : un parent
               qui vient chercher son enfant plus tôt DE LUI-MÊME n'est aucun
               des trois événements, Maria était disponible, et elle ne déclare
               rien. Une ligne, sous la liste, tant que rien n'est choisi. */
            detail.appendChild(Kit.ce('p', 'sb q',
              'Sans rien déclarer, vos ' + Kit.duree(conditions.minutes_sup_jour) +
              ' restent dues. Un parent qui vient chercher son enfant plus tôt ' +
              'de lui-même n’est pas un événement : vous étiez disponible.'));
          }
          majBouton();
        }

        function majBouton() { bouton.disabled = !etat.pret; }

        /* --- 1 à 3 : les déclarations d'horaire --------------------- */

        function dessinerEcart(evt) {
          var matin = evt === 'arrivee_decalee';
          var reference = Engine.heureDeReference(conditions);
          var arrivee = Engine.heureEnMinutes(conditions.heure_arrivee);

          /* LOT 29 (§29.2, 1 et 3) — L'ÉCRAN ANNONCE CE QUI SERA EFFACÉ, AVANT.
             Sur une journée d'absence, déclarer un écart remet la journée en
             présence : l'absence disparaît, l'enfant était là. Une ligne le
             dit, sur le modèle de l'avertissement du marquage groupé. */
          if (type === 'absence_enfant') {
            detail.appendChild(Kit.warnbox(
              'L’absence de ' + c.prenom_enfant + ' sera retirée',
              ' Déclarer ce qui s’est passé, c’est dire que ' + c.prenom_enfant +
              ' était là : la journée redevient une présence, avec son entretien ' +
              'et ses minutes, moins ce que vous déclarez ici. Votre note, elle, reste.'));
          }

          /* DÉCISION D'ADRIEN, 23 AOÛT : PAS DE RACCOURCIS D'HEURE.
             La maquette en proposait trois (18 h 01 · 18 h 15 · 18 h 30), et
             le brief les demandait. « Les raccourcis ne servent à rien si
             l'heure de fin habituelle est à 18 h, mais Maria doit pouvoir
             modifier à la minute l'heure et la minute de fin de la journée. »
             Ils auraient de toute façon été faux ailleurs : ces heures ne
             valent que pour un contrat dont la journée finit à 18 h 00.

             Le champ est celui du lot 20 (`champHeureMinute`, molette native
             du téléphone, pas de saisie au clavier — B.0-3), et non plus le
             sélecteur au quart d'heure : un départ à 18 h 01 ne s'y saisit
             pas. */
          var champ = Kit.champHeureMinute(
            (matin ? 'L’enfant est arrivé à' : 'L’enfant est parti à') +
            ' — à la minute près',
            etat.heure || heureIso(matin ? arrivee : reference));
          detail.appendChild(champ.bloc);

          /* La journée de référence vient du MOTEUR : fin d'accueil plus les
             minutes supplémentaires du contrat. Un écran qui l'écrirait en dur
             serait faux le jour où un avenant déplace les horaires (A6). */
          detail.appendChild(Kit.ce('p', 'sb q',
            'La journée de ' + c.prenom_enfant + ' va de ' + heureLisible(arrivee) +
            ' à ' + heureLisible(reference) + ' — la fin d’accueil plus vos ' +
            Kit.duree(conditions.minutes_sup_jour) + '.'));

          var effet = Kit.ce('div', 'effet-heures');
          detail.appendChild(effet);

          /* §17.6 — LE SÉLECTEUR DE DESTINATION EST CONSTRUIT UNE SEULE FOIS,
             puis montré ou caché. Le reconstruire à chaque changement d'heure
             ferait perdre le choix de Maria sans rien dire. */
          var blocDest = Kit.ce('div');
          detail.appendChild(blocDest);
          var selDest = Kit.champSelect('Ces minutes se déduisent de',
            DESTINATIONS_ECART, etat.destination);
          selDest.select.addEventListener('change', function () {
            etat.destination = selDest.select.value;
            majEffet();
          });
          blocDest.appendChild(selDest.bloc);
          blocDest.appendChild(Kit.ce('p', 'sb q',
            'Votre récupération peut passer sous zéro : c’est du temps que vous rendrez.'));
          blocDest.hidden = true;

          var blocEntretien = Kit.ce('div');
          detail.appendChild(blocEntretien);

          champ.input.addEventListener('change', majEffet);
          champ.input.addEventListener('input', majEffet);
          majEffet();

          function lireHeure() {
            var v = champ.valeur();
            return /^\d{1,2}:\d{2}$/.test(v) ? v : null;
          }

          function majEntretien(visible) {
            Kit.vider(blocEntretien);
            if (!visible) return;
            /* §20.6 — L'INTERRUPTEUR D'ENTRETIEN, ET SEULEMENT HORS DU CADRE.
               Il n'apparaît que lorsqu'un écart est effectivement déclaré :
               « Maria ne retire jamais l'entretien d'une journée complète ». */
            blocEntretien.appendChild(Kit.section('Indemnité d’entretien du jour'));
            blocEntretien.appendChild(Kit.ce('p', 'sb q',
              'La journée sort du cadre. Elle reste comptée présente : votre salaire ' +
              'et vos minutes ne bougent pas.'));
            var plein = (conditions.entretien_centimes_jour != null)
              ? Kit.eur(conditions.entretien_centimes_jour) : '—';
            poserOption(blocEntretien, etat.entretien, 'Comptée', plein,
              function () { etat.entretien = true; majEntretien(true); });
            poserOption(blocEntretien, !etat.entretien, 'Non comptée', '0,00 €',
              function () { etat.entretien = false; majEntretien(true); });
          }

          function majEffet() {
            Kit.vider(effet);
            blocDest.hidden = true;
            etat.minutes = null;
            etat.pret = false;

            var heure = lireHeure();
            etat.heure = heure;
            var minutes = null;
            if (heure) {
              try {
                minutes = Engine.ecartDepuisHeureReelle(conditions, evt, heure);
              } catch (e) { minutes = null; }
            }

            if (minutes === null) {
              effet.appendChild(Kit.note('Heure illisible',
                ' Choisissez une heure pour que cette journée puisse être enregistrée.'));
              majEntretien(false);
              majBouton();
              return;
            }

            /* « RIEN À ENREGISTRER » — LES DEUX CAS RÉUNIS.
               Une heure égale à la référence n'est pas un événement ; et un
               signe qui ne correspond pas à ce que Maria déclare est refusé
               ici, en français, avant que la contrainte
               `journee_ecart_signe_coherent` ne le refuse en fin de course
               (remarque 5 de la relecture du lot 17). Les deux produisent la
               même chose à l'écran : un encart qui dit quoi faire, et un
               bouton inactif. */
            var attendu = SIGNE_ATTENDU[evt];
            if (minutes === 0 ||
                (attendu > 0 && minutes < 0) || (attendu < 0 && minutes > 0)) {
              effet.appendChild(Kit.note('Rien à enregistrer',
                ' ' + phraseRienADeclarer(evt, reference, arrivee)));
              majEntretien(false);
              majBouton();
              return;
            }

            if (minutes < 0) {
              blocDest.hidden = false;
              var lb = selDest.bloc.querySelector('.lb');
              if (lb) lb.textContent = 'Ces ' + Kit.duree(minutes) + ' se déduisent de';
            }

            /* L'EFFET CHIFFRÉ, REJOUÉ PAR LE MOTEUR — jamais recomposé ici
               (B.0-5). On lui donne la journée telle qu'elle sera enregistrée.
               CORRECTION C1 DE LA RELECTURE DU LOT 17 conservée :
               `minutesSupDuJour` vient du moteur, elle n'est pas recopiée. */
            /* §29.2 — la journée telle qu'elle sera ÉCRITE : une absence
               redevient une présence. */
            var typeEcrit = type === 'absence_enfant' ? 'presence' : type;
            var simule = {
              type: typeEcrit,
              minutes_sup_exceptionnelles: ligne.minutes_sup_exceptionnelles || 0,
              minutes_sup_renoncees: ligne.minutes_sup_renoncees || 0,
              sup_dues_override: null,
              ecart_minutes: minutes,
              ecart_impute_sur: etat.destination
            };
            var detailSup = Engine.detailSupDuJour(simule, conditions);
            var totalJour = Engine.minutesSupDuJour(simule, conditions);

            var titre = minutes > 0
              ? '+ ' + Kit.heures(totalJour) + ' ce jour-là'
              : Kit.heures(totalJour) + ' sur votre cumul du mois';
            var explication = minutes > 0
              ? ' Vos ' + Kit.duree(conditions.minutes_sup_jour) + ' habituelles, ' +
                'plus le retard — départ à ' + heureLisible(Engine.heureEnMinutes(heure)) +
                ' au lieu de ' + heureLisible(reference) + '.'
              : ' Vos ' + Kit.duree(conditions.minutes_sup_jour) + ' du jour, ' +
                'moins le temps rendu — ' +
                (matin
                  ? 'arrivée à ' + heureLisible(Engine.heureEnMinutes(heure)) +
                    ' au lieu de ' + heureLisible(arrivee)
                  : 'départ à ' + heureLisible(Engine.heureEnMinutes(heure)) +
                    ' au lieu de ' + heureLisible(reference)) + '.';
            effet.appendChild(minutes > 0 ? Kit.note(titre, explication)
                                          : Kit.warnbox(titre, explication));
            effet.appendChild(Kit.ce('div', 'sb',
              'Ce jour : ' + Kit.heures(totalJour) + ' au lieu de ' +
              Kit.duree(conditions.minutes_sup_jour) + '.'));

            if (detailSup.minutesSurCp > 0) {
              /* LOT 28 (§28.3) — CE QUE LE MOTEUR FERA VRAIMENT DE CES MINUTES.
                 Les congés payés ne passent plus sous zéro : la consommation
                 est bornée au disponible du mois — après les congés posés et
                 les autres écarts du même mois — et le surplus bascule sur la
                 récupération. L'écran le dit AVANT validation, en rejouant le
                 mois avec la journée telle qu'elle sera écrite, et lit où
                 chaque minute est allée (« il vous reste X », lot 21). Rien
                 n'est soustrait ici : c'est `ecartsDeclares` du moteur. */
              var rejoue = null;
              try {
                rejoue = simulerAvecLigne(d, {
                  contrat_id: c.id, jour: d, type: typeEcrit,
                  minutes_reelles: ligne.minutes_reelles == null ? null : ligne.minutes_reelles,
                  entretien_centimes: ligne.entretien_centimes == null ? null : ligne.entretien_centimes,
                  entretien_du: etat.entretien !== false,
                  minutes_sup_exceptionnelles: ligne.minutes_sup_exceptionnelles || 0,
                  minutes_sup_renoncees: ligne.minutes_sup_renoncees || 0,
                  sup_dues_override: null,
                  ecart_minutes: minutes, ecart_evenement: evt,
                  ecart_heure_reelle: heure, ecart_impute_sur: etat.destination
                });
              } catch (e) { rejoue = null; }
              var part = null;
              ((rejoue && rejoue.ecartsDeclares) || []).forEach(function (x) {
                if (x.jour === d) part = x;
              });
              if (!part) {
                effet.appendChild(Kit.warnbox('Impossible de vérifier vos congés payés',
                  ' Le mois n’a pas pu être rejoué avec cette journée. Choisissez votre ' +
                  'récupération ou le sans solde, ou réessayez.'));
                etat.pret = false;
                majBouton();
                return;
              }
              /* Ce qu'il reste POUR CE MOIS : l'entrée moins tout ce que le mois
                 consomme, telle que le moteur le rend. Les 2,5 jours du mois
                 s'acquièrent à sa fin et n'entrent pas dans ce reste. */
              var reste = rejoue.minutesCpRestantesApresConsommation || 0;
              var phraseReste = reste > 0
                ? 'Il vous reste ' + Kit.duree(reste) + ' de congés payés pour ce mois.'
                : 'Il ne vous en reste plus pour ce mois.';
              if (part.minutesSurRecuperation > 0) {
                effet.appendChild(Kit.warnbox(
                  'Vos congés payés ne couvrent que ' + Kit.duree(part.minutesSurCp),
                  ' ' + Kit.duree(part.minutesSurCp) + ' seront retirées de vos congés payés et ' +
                  Kit.duree(part.minutesSurRecuperation) + ' de votre récupération, qui peut ' +
                  'passer sous zéro. ' + phraseReste + ' Choisissez plutôt votre ' +
                  'récupération ou le sans solde si ce n’est pas ce que vous voulez.'));
              } else {
                effet.appendChild(Kit.ce('div', 'sb',
                  Kit.duree(part.minutesSurCp) + ' seront retirées de vos congés payés. ' +
                  phraseReste));
              }
            }
            if (detailSup.minutesSansSolde > 0) {
              var retenue = (conditions.brut_mensuel_centimes != null)
                ? Engine.montantCentimes(conditions.brut_mensuel_centimes,
                    detailSup.minutesSansSolde)
                : null;
              effet.appendChild(Kit.ce('div', 'sb',
                retenue != null
                  ? 'Retenue sur le salaire : ' + Kit.eur(retenue) + '.'
                  : 'La retenue ne peut pas être chiffrée, la rémunération de ce mois ' +
                    'n’est pas renseignée.'));
            }
            if (detailSup.ecartSurRecuperation < 0) {
              /* CORRECTION B5 — la dette annoncée part du solde RÉEL, jamais
                 d'un solde borné à zéro. */
              var apres = Kit.supSolde(vue.entree.resultat.compteurSortie) +
                detailSup.ecartSurRecuperation;
              if (apres < 0) {
                effet.appendChild(Kit.ce('div', 'sb',
                  'Votre récupération passera en négatif : vous devrez ' +
                  Kit.heures(-apres) + '.'));
              }
            }

            /* L'écart est réel et cohérent : c'est LÀ que la journée sort du
               cadre, et donc là que l'interrupteur apparaît. */
            majEntretien(true);
            etat.minutes = minutes;
            etat.pret = true;
            majBouton();
          }
        }

        /* --- 4 : l'absence de l'enfant ------------------------------ */

        function dessinerAbsence() {
          /* LOT 29 (§29.2, 2 et 3) — MARQUER UNE ABSENCE EFFACE L'ÉCART, ET
             L'ÉCRAN LE DIT AVANT. « La déclaration de 17h00 sera retirée. »
             — sur le modèle de l'avertissement du marquage groupé. L'entretien
             retiré avec cette déclaration revient (RG-09 le retire à son
             tour, pour l'absence, mais la colonne repart à vrai). */
          if (SIGNE_ATTENDU[ligne.ecart_evenement]) {
            var heureDecl = String(ligne.ecart_heure_reelle || '').slice(0, 5);
            detail.appendChild(Kit.warnbox(
              'La déclaration ' + (heureDecl ? 'de ' + heureDecl.replace(':', 'h') : 'd’horaire') +
              ' sera retirée',
              ' Une journée d’absence ne porte pas d’écart d’horaire : ' +
              (Kit.LIBELLE_EVENEMENT_ECART[ligne.ecart_evenement] || 'la déclaration') +
              ' du jour est effacée avec ce geste. Votre note, elle, reste.'));
          }
          /* §25.2 — UNE LIGNE DE RÉSULTAT CHIFFRÉE, plus un paragraphe.
             « entretien − 5,00 € · 30 min toujours dues » au lieu de deux
             phrases. Le contenu est le MÊME et vient du même rejeu par le
             moteur : c'est la forme qui change — un encart d'une ligne, lu
             d'un coup d'œil au moment d'appuyer. */
          detail.appendChild(Kit.enc('w', apercuAbsence(d), null));
          etat.pret = true;
        }

        /* --- 5 : la note de la journée ------------------------------ */

        function dessinerNote() {
          var champ = Kit.champ('Note', etat.texte,
            { placeholder: 'Retard des parents, sortie au parc…' });
          champ.input.addEventListener('input', function () {
            etat.texte = champ.input.value;
          });
          detail.appendChild(champ.bloc);
          detail.appendChild(Kit.ce('p', 'sb q',
            'Facultatif, pour vous seule. Jamais sur le document remis à la famille.'));
          etat.pret = true;
        }

        /* --- 6 : défaire ------------------------------------------- */

        function dessinerRetour() {
          var aDefaire = absenceMaria || type === 'absence_enfant' ||
            !!ligne.ecart_evenement;
          if (!aDefaire) {
            detail.appendChild(Kit.ce('p', 'sb q',
              'Cette journée est déjà une journée ordinaire : il n’y a rien à annuler.'));
            etat.pret = false;
            return;
          }
          if (absenceMaria) {
            detail.appendChild(Kit.enc('', 'Le jour redevient normal pour ' +
              libelleServis(servis) + ' · minutes et entretien reprennent leur cours',
              null));
            etat.pret = true;
            return;
          }
          /* L'aperçu vient du MOTEUR : on rejoue le mois avec cette journée
             remise en présence et on annonce l'écart du GESTE (correction B3
             de la relecture du lot 20). */
          /* §25.2 — ligne de résultat chiffrée, ici aussi. */
          detail.appendChild(Kit.enc('',
            phraseEcart(simuler(d, 'presence'), vue.entree.resultat), null));
          var restent = [];
          if (ligne.commentaire) restent.push('votre note sur cette journée');
          if ((ligne.minutes_sup_exceptionnelles || 0) > 0 ||
              (ligne.minutes_sup_renoncees || 0) > 0 ||
              (ligne.sup_dues_override !== undefined && ligne.sup_dues_override !== null)) {
            restent.push('l’ajustement de vos heures');
          }
          if (restent.length) {
            /* DÉCISION D'ADRIEN, 23 août : « chaque choix ne touche que son
               domaine ». Ce geste défait ce que cette liste a posé — la
               déclaration d'horaire et l'absence. Ce qui se retire ailleurs
               reste, et l'écran le dit plutôt que de le faire disparaître. */
            detail.appendChild(Kit.ce('p', 'sb q',
              'Ce qui reste : ' + restent.join(' et ') + '. Cela se retire depuis ' +
              (restent.length > 1 ? 'ses propres écrans.' : 'son propre écran.')));
          }
          etat.pret = true;
        }

        /* ---------------------------------------------------------- */

        function enregistrer(bt) {
          if (!etat.pret) return;
          if (SIGNE_ATTENDU[etat.choix]) {
            return enregistrerEcart(d, etat.choix, etat.heure, etat.minutes,
              etat.destination, bt, etat.entretien);
          }
          if (etat.choix === 'absence_enfant') return poserAbsenceEnfant(d, bt);
          if (etat.choix === 'note') return enregistrerNote(d, etat.texte, bt);
          if (etat.choix === 'retour') return remettreEnJourneeOrdinaire(d, servis, bt);
        }
      });
  }

  /* Les phrases de refus de la maquette, mais avec les heures DU CONTRAT :
     « à 18 h 00 » n'est vrai que d'un contrat dont la journée finit à 18 h 00. */
  function phraseRienADeclarer(evt, reference, arrivee) {
    if (evt === 'retard_parent') {
      return 'À ' + heureLisible(reference) + ' ou avant, il n’y a rien à ' +
        'déclarer : vos ' + Kit.duree(reg('minutes_sup_jour', 0)) + ' restent dues.';
    }
    if (evt === 'liberation_anticipee') {
      return 'À ' + heureLisible(reference) + ' ou après, ce n’est pas une ' +
        'libération anticipée. Pour un parent qui vient plus tard que prévu, ' +
        'choisissez « Un parent est venu en retard ».';
    }
    return 'À ' + heureLisible(arrivee) + ' ou avant, rien ne change : la ' +
      'journée commence à son heure habituelle.';
  }

  /* LOT 10 — retirer une journée qui appartient à une PÉRIODE VENTILÉE.

     DÉCISION D'ADRIEN, 10 août 2026 : « elle le fait elle-même à la main ».
     L'application ne recalcule JAMAIS une ventilation d'office quand une
     journée change — elle ne devine pas l'intention. Mais elle ne peut pas se
     taire non plus : le moteur écartera silencieusement la ventilation devenue
     incohérente (correctif B1 de la 2ᵉ passe du lot 9) et reprendra l'ordre du
     contrat. Maria lirait « votre choix a été écarté » sans savoir quoi faire.

     Alors on le dit AVANT le geste, et on dit quoi faire après. */
  function avertirVentilation(corps, d) {
    var periodes = (vue.imputations || []).filter(function (i) {
      return d >= i.date_debut && d <= i.date_fin;
    });
    if (!periodes.length) return;
    var i = periodes[0];
    corps.appendChild(Kit.warnbox(
      'Ce jour fait partie d’une période de congé déjà répartie',
      ' du ' + Kit.dateLongue(i.date_debut) + ' au ' + Kit.dateLongue(i.date_fin) +
      ', ' + Kit.jours(i.jours_ouvrables) + ' décomptés. En retirant ce jour, votre ' +
      'répartition ne correspondra plus à la période : elle sera écartée et l’ordre ' +
      'du contrat reprendra la main. Refaites-la depuis « Mes congés ».'));
  }

  /* « Du 3 au 21 août, vous aviez choisi 6 jours de récupération. Vous n'en
     avez que 5. » Les trois codes du moteur ne disent pas la même chose : on
     ne sert pas la phrase des réserves quand le problème est ailleurs. */
  function phraseEcartee(e) {
    var plage = 'Du ' + Kit.dateLongue(e.date_debut) + ' au ' + Kit.dateLongue(e.date_fin) + ', ';
    if (e.code === 'IMPUTATION_DEPASSE_RESERVES') {
      var manques = [];
      if (e.choisi.joursSurSup > e.disponible.joursSup) {
        manques.push('vous aviez choisi ' + Kit.jours(e.choisi.joursSurSup) +
          ' de récupération. Vous n’en avez que ' + Kit.jours(e.disponible.joursSup) + '.');
      }
      if (e.choisi.joursSurCp > e.disponible.joursCp) {
        manques.push('vous aviez choisi ' + Kit.jours(e.choisi.joursSurCp) +
          ' de congés payés. Vous n’en avez que ' + Kit.jours(e.disponible.joursCp) + '.');
      }
      if (manques.length) return plage + manques.join(' Et ');
      return plage + 'votre répartition dépasse ce que vos réserves couvrent.';
    }
    /* LA RÉCUPÉRATION SE GAGNE JOUR APRÈS JOUR (§4.3) — LE REFUS QUI N'EN
       EST PAS UN. La réserve n'est pas insuffisante : elle n'est PAS ENCORE
       GAGNÉE. Maria n'a rien à corriger, elle a à attendre — ou à déplacer.
       Servir ici la phrase des réserves l'enverrait chercher une erreur qui
       n'existe pas. */
    if (e.code === 'RESERVES_PAS_ENCORE_ACQUISES') {
      return plage + 'vous aviez choisi ' + Kit.jours(e.choisi.joursSurSup) +
        ' de récupération, financés par des journées que vous n’avez pas ' +
        'encore travaillées. Ces heures ne sont pas encore acquises : ' +
        'refaites cette répartition une fois ces journées faites.';
    }
    if (e.code === 'IMPUTATION_INCOMPLETE') {
      /* CORRECTION RELECTURE LOT 16 (B1) — LA PHRASE DISAIT QUE 5 NE COUVRE
         PAS 5. Elle affichait la SOMME de ce que Maria avait réparti, et le
         nombre qui manque — le décompte RG-06 réel de la période — n'était
         nulle part. Le moteur le pose pourtant sur l'erreur ; la chaîne le
         reprend désormais dans `attendu`. */
      var couvre = e.recu != null ? e.recu
        : e.choisi.joursSurCp + e.choisi.joursSurSup + e.choisi.joursSansSolde;
      if (e.attendu != null) {
        return plage + 'votre répartition couvre ' + Kit.jours(couvre) +
          ', alors que la période en compte ' + Kit.jours(e.attendu) +
          /* §6.3 — plus de « samedis inclus » : ils ne le sont plus d'office. */
          ', samedis comptés compris.';
      }
      return plage + 'votre répartition ne correspond pas au décompte de la période.';
    }
    return plage + 'votre répartition n’est pas utilisable telle quelle.';
  }

  /* --- LOT 12 : ajuster ses heures un jour donné (V8-18) --------------

     Trois gestes, tous réversibles :
       - AJOUTER des minutes travaillées au-delà du contrat ;
       - RENONCER à des minutes dues — un geste assumé, pas un oubli ;
       - décider au cas par cas si les minutes restent dues quand l'enfant est
         absent, sans toucher au réglage du contrat (A8).

     AUCUNE VALEUR N'EST ÉCRITE EN DUR (A6, risque n° 2). Les « 30 min »
     viennent de `contrat.minutes_sup_jour` : un contrat qui en prévoit 45 le
     dira, et une constante serait fausse ce jour-là sans que rien ne le
     signale. */
  var PAS_MINUTES = 15;
  /* « Je renonce à mes minutes » = à tout ce qui reste dû ce jour-là. On
     demande au moteur de borner une journée entière (24 h) : c'est lui qui
     connaît le dû, écart compris (§28.6) — l'écran ne l'additionne pas. */
  var RENONCER_A_TOUT = 24 * 60;

  function blocAjusterHeures(d) {
    var c = vue.contrat;
    var ligne = (vue.journees || {})[d] || {};
    var type = Kit.typeDuJour(vue.journees, d);
    var conditions = cond();

    var etat = {
      ajoutees: ligne.minutes_sup_exceptionnelles || 0,
      renonce: (ligne.minutes_sup_renoncees || 0) > 0
    };

    var det = Kit.ce('details', 'ajuster');
    var som = Kit.ce('summary', null, 'Ajuster mes heures ce jour-là');
    det.appendChild(som);
    if (etat.ajoutees > 0 || etat.renonce) det.open = true;

    var corps = Kit.ce('div', 'ajuster-corps');
    det.appendChild(corps);

    /* LOT 28 (§28.7) — SANS CONDITIONS, LE PANNEAU REFUSE AU LIEU D'AFFICHER
       `NaN`. Un mois sans avenant applicable n'a pas d'heures de référence :
       il n'y a rien à ajuster, et le dire vaut mieux qu'un nombre illisible. */
    if (!conditions) {
      corps.appendChild(Kit.warnbox('Aucune condition connue pour ce mois',
        'Les heures de ce jour ne peuvent pas être ajustées tant que la fiche du ' +
        'contrat n’a pas d’avenant en vigueur pour ce mois.'));
      return det;
    }
    /* §28.2 / §29.2 — une journée qui ne porte aucune minute (absence de
       l'enfant, congé, férié…) n'a rien à ajuster non plus : le dire, plutôt
       que d'offrir un compteur sans effet. */
    if (Engine.TYPES_SANS_MINUTES.indexOf(type) !== -1) {
      corps.appendChild(Kit.ce('p', 'sb q',
        type === 'absence_enfant'
          ? 'Quand ' + c.prenom_enfant + ' est ' + Kit.accordDe(c, 'absent') +
            ', aucune minute n’est due ce jour-là, ni indemnité d’entretien : il n’y a ' +
            'rien à ajuster.'
          : 'Cette journée ne porte aucune minute : il n’y a rien à ajuster.'));
      return det;
    }

    var effet = Kit.ce('div', 'effet-heures');

    /* LOT 28 (§28.7) — LE PANNEAU DIT LA VÉRITÉ : il demande au moteur les
       minutes de la journée COMPLÈTE, écart d'horaire compris, exactement
       comme l'écran de déclaration. Il affichait `base + ajoutées − renoncées`
       et ignorait l'écart déclaré : sur un retard de 20 minutes, « Ce jour :
       30 min — comme prévu au contrat », là où le moteur et le document
       comptaient 50. Rien n'est additionné ici (B.0-5). */
    function ligneSimulee() {
      var simule = {
        type: type,
        minutes_sup_exceptionnelles: etat.ajoutees,
        /* Le renoncement est écrit BORNÉ (A7) : ce à quoi Maria renonce,
           c'est tout ce qui reste dû — le moteur le calcule, lui seul. */
        minutes_sup_renoncees: 0,
        ecart_minutes: ligne.ecart_minutes == null ? null : ligne.ecart_minutes,
        ecart_evenement: ligne.ecart_evenement == null ? null : ligne.ecart_evenement,
        ecart_impute_sur: ligne.ecart_impute_sur == null ? null : ligne.ecart_impute_sur
      };
      if (etat.renonce) {
        /* « Tout ce qui reste dû » : on demande une journée entière et le
           moteur borne lui-même à ce qui est dû (§28.6). Aucune addition ici. */
        simule.minutes_sup_renoncees = RENONCER_A_TOUT;
        simule.minutes_sup_renoncees = Engine.detailSupDuJour(simule, conditions).renoncees;
      }
      return simule;
    }

    function majEffet() {
      var total = Engine.minutesSupDuJour(ligneSimulee(), conditions);
      Kit.vider(effet);
      effet.appendChild(Kit.ce('b', null, 'Ce jour : ' + Kit.duree(total)));
      if (total !== reg('minutes_sup_jour', 0)) {
        effet.appendChild(document.createTextNode(
          ' au lieu de ' + Kit.duree(reg('minutes_sup_jour', 0)) + '.'));
      } else {
        effet.appendChild(document.createTextNode(' — comme prévu au contrat.'));
      }
      if (ligne.ecart_evenement && ligne.ecart_minutes) {
        effet.appendChild(Kit.ce('div', 'sb q',
          'Écart déclaré ce jour-là compris : ' +
          (ligne.ecart_minutes > 0 ? '+ ' : '− ') + Kit.duree(Math.abs(ligne.ecart_minutes)) + '.'));
      }
    }

    corps.appendChild(compteurMinutes('Heures supplémentaires en plus',
      'Au-delà des ' + Kit.duree(reg('minutes_sup_jour', 0)) + ' prévues au contrat.',
      etat, 'ajoutees', function () { majEffet(); }));

    var caseRenonce = Kit.ce('label', 'coche-ligne');
    var boxR = document.createElement('input');
    boxR.type = 'checkbox';
    boxR.checked = etat.renonce;
    boxR.addEventListener('change', function () { etat.renonce = boxR.checked; majEffet(); });
    caseRenonce.appendChild(boxR);
    var txR = Kit.ce('span', 'tx');
    txR.appendChild(Kit.ce('b', null, 'Je renonce à mes minutes'));
    txR.appendChild(Kit.ce('span', 'd',
      Kit.duree(reg('minutes_sup_jour', 0)) + ' non ' + Kit.accordDe(c, 'réclamé') +
      ' ce jour-là. Vous pouvez revenir dessus à tout moment.'));
    caseRenonce.appendChild(txR);
    corps.appendChild(caseRenonce);

    /* A8 — LA SURCHARGE DE RG-09 AU JOUR A DISPARU (§28.2) : une absence de
       l'enfant ne porte plus aucune minute, quel que soit le réglage. La
       colonne `sup_dues_override` reste en base, sans effet, et n'est plus
       écrite. */

    corps.appendChild(effet);

    var b = Kit.bouton('btn nt', function () { enregistrerAjustement(d, etat, b); });
    b.textContent = 'Enregistrer cet ajustement';
    corps.appendChild(b);

    majEffet();
    return det;
  }

  /* Un compteur « − n + » au pas de 15 minutes. Le pas n'est pas cosmétique :
     au pas d'une minute, poser 1 h 15 demanderait 75 appuis. */
  function compteurMinutes(libelle, aide, cible, champ, apres) {
    var f = Kit.ce('div', 'compteur-jours');
    var lb = Kit.ce('span', 'lb');
    lb.appendChild(Kit.ce('b', null, libelle));
    if (aide) lb.appendChild(Kit.ce('span', 'd', aide));
    f.appendChild(lb);

    var grp = Kit.ce('div', 'grp');
    var val = Kit.ce('b', 'val', Kit.duree(cible[champ]));

    function poser(delta) {
      var v = cible[champ] + delta;
      if (v < 0) v = 0;
      cible[champ] = v;
      val.textContent = Kit.duree(v);
      moins.disabled = v <= 0;
      if (apres) apres();
    }
    var moins = Kit.bouton('pas', function () { poser(-PAS_MINUTES); });
    moins.textContent = '−';
    moins.setAttribute('aria-label', 'Retirer ' + PAS_MINUTES + ' minutes');
    var plus = Kit.bouton('pas', function () { poser(PAS_MINUTES); });
    plus.textContent = '+';
    plus.setAttribute('aria-label', 'Ajouter ' + PAS_MINUTES + ' minutes');
    grp.appendChild(moins);
    grp.appendChild(val);
    grp.appendChild(plus);
    f.appendChild(grp);
    moins.disabled = cible[champ] <= 0;
    return f;
  }

  function enregistrerAjustement(d, etat, bouton) {
    var c = vue.contrat;
    var ligne = (vue.journees || {})[d] || {};
    var type = Kit.typeDuJour(vue.journees, d);
    var conditions = cond();
    if (!conditions) {
      Kit.toast('Aucune condition connue pour ce mois : rien n’a été modifié.', true);
      return;
    }

    /* A7 — on n'écrit JAMAIS un renoncement supérieur au dû. Le moteur borne
       déjà (Math.min), mais laisser passer une valeur incohérente en base,
       c'est laisser un chiffre faux visible dans les données.
       §28.6 — le dû se mesure APRÈS l'écart déclaré : la ligne simulée le
       porte, comme celle du panneau. */
    var simule = {
      type: type, minutes_sup_exceptionnelles: etat.ajoutees,
      ecart_minutes: ligne.ecart_minutes == null ? null : ligne.ecart_minutes,
      ecart_evenement: ligne.ecart_evenement == null ? null : ligne.ecart_evenement,
      ecart_impute_sur: ligne.ecart_impute_sur == null ? null : ligne.ecart_impute_sur
    };
    var renoncees = 0;
    if (etat.renonce) {
      simule.minutes_sup_renoncees = RENONCER_A_TOUT;
      renoncees = Engine.detailSupDuJour(simule, conditions).renoncees;
    }

    ecrire(global.DB.enregistrerJournee({
      contrat_id: c.id, jour: d,
      type: type === 'presence' && !ligne.type ? 'presence' : (ligne.type || 'presence'),
      minutes_reelles: ligne.minutes_reelles == null ? null : ligne.minutes_reelles,
      entretien_centimes: ligne.entretien_centimes == null ? null : ligne.entretien_centimes,
      commentaire: ligne.commentaire == null ? null : ligne.commentaire,
      minutes_sup_exceptionnelles: etat.ajoutees,
      minutes_sup_renoncees: renoncees,
      /* §28.2 — la surcharge n'a plus d'effet ; on la remet à « suivre le
         contrat » pour ne pas laisser une valeur morte derrière soi. */
      sup_dues_override: null
    }), bouton, 'Heures ajustées pour cette journée',
      { contrats: [c.id], jours: [d] });
  }


  /* --- LOT 17 §17.5 et §17.6 : ce qui s'est passé ce jour-là ----------

     « MARIA DÉCLARE L'ÉVÉNEMENT. L'APPLICATION NE DEVINE RIEN. »

     C'est la phrase qui tient tout cet écran. Il ne demande pas « à quelle
     heure l'enfant est-il parti ? » — il demande CE QUI S'EST PASSÉ, et
     chaque réponse dit déjà qui a décidé :

       un parent est venu en retard        → du temps de travail en plus
       j'ai libéré plus tôt                → du temps que Maria rend
       j'ai demandé qu'on l'amène plus tard → idem, sur le matin

     Un parent qui vient chercher son enfant plus tôt DE LUI-MÊME n'est aucun
     de ces trois cas : Maria était disponible, ses minutes restent dues, et
     elle ne déclare rien. C'est pour ça qu'il n'y a pas de quatrième choix —
     l'absence de choix EST la règle (A3).

     AUCUN CALCUL ICI. L'écran collecte un événement et une heure ; c'est
     `Engine.ecartDepuisHeureReelle` qui en fait des minutes signées, et lui
     seul qui connaît la référence d'une journée (fin d'accueil + minutes
     supplémentaires du contrat). Un écran qui soustrairait deux heures
     lui-même referait la règle une deuxième fois, sur des horaires qui
     changent d'un avenant à l'autre. */

  /* Le signe que chaque événement DOIT produire. C'est la même règle que la
     contrainte `journee_ecart_signe_coherent` de la migration `014` : sans
     elle, « j'ai libéré plus tôt » pourrait AJOUTER des minutes au compteur de
     Maria, et le document serait indéfendable. */
  var SIGNE_ATTENDU = {
    retard_parent: 1,
    liberation_anticipee: -1,
    arrivee_decalee: -1
  };

  /* `EVENEMENTS_ECART` — le sélecteur déroulant « Ce qui s'est passé » — a
     disparu : les trois événements sont devenus les trois premiers choix de la
     liste (`CHOIX_ECART`, plus haut). « Rien à signaler » n'a plus besoin
     d'être une option : ne rien choisir, c'est déjà lui. */

  var DESTINATIONS_ECART = [
    ['recuperation', 'Ma récupération'],
    ['conges_payes', 'Mes congés payés'],
    ['sans_solde', 'Sans solde']
  ];

  /* Les types de journée qui n'ont pas d'horaire de référence : RG-04 leur
     retire toute minute, écart compris. Proposer la déclaration dessus
     laisserait croire à un effet qui n'existe pas. */
  /* LOT 29 (§29.2, 5) — `absence_enfant` REJOINT LA LISTE : une absence ne
     PORTE jamais d'écart. Déclarer un écart sur une journée d'absence reste
     possible — c'est même le geste de correction du §29.1 —, mais il REMET
     la journée en présence : l'écart n'est jamais posé sur l'absence. C'est
     `Engine.TYPES_SANS_MINUTES` côté moteur, la même liste. */
  var TYPES_SANS_ECART = ['ferie', 'conge_maria', 'sans_solde',
                          'familiarisation', 'hors_planning', 'absence_enfant'];


  /* §21.3 — CE QUE LA JOURNÉE PORTE, ET OÙ IL SE RETIRE. Une note, pas un
     formulaire : un congé se pose et se retire depuis « Mes congés », parce
     qu'il vaut pour plusieurs contrats à la fois et que le retirer d'un seul
     ici laisserait les autres derrière. */
  function blocCongeHorairePose(d, ligne) {
    var minutes = -(ligne.ecart_minutes || 0);
    var destination = LIBELLE_DESTINATION_CONGE[ligne.ecart_impute_sur] ||
      'vos compteurs';
    var bloc = Kit.ce('div');
    bloc.appendChild(Kit.note('Un congé de ' + Kit.heures(minutes) + ' est posé ce jour-là',
      'Déduit de ' + destination + '. La journée reste travaillée : ' +
      'l’indemnité d’entretien reste due, et vos minutes du contrat aussi. ' +
      'Ce congé se retire depuis « Mes congés », où il vaut peut-être pour ' +
      'd’autres enfants.'));
    var b = Kit.bouton('btn nt', function () {
      var m = d.split('-');
      global.App.aller('conges', { annee: Number(m[0]), mois: Number(m[1]) });
    });
    b.textContent = 'Ouvrir « Mes congés »';
    bloc.appendChild(b);
    bloc.appendChild(Kit.ce('p', 'sb q',
      'Tant que ce congé est posé, aucune déclaration d’horaire ne peut être ' +
      'saisie sur cette journée : les deux se disputeraient les mêmes minutes.'));
    return bloc;
  }

  var LIBELLE_DESTINATION_CONGE = {
    recuperation: 'votre récupération',
    conges_payes: 'vos congés payés',
    sans_solde: 'votre salaire, en sans solde'
  };

  function heureLisible(minutes) {
    return Math.floor(minutes / 60) + 'h' + String(minutes % 60).padStart(2, '0');
  }
  function heureIso(minutes) {
    return String(Math.floor(minutes / 60)).padStart(2, '0') + ':' +
           String(minutes % 60).padStart(2, '0');
  }

  function enregistrerEcart(d, evenement, heure, minutes, destination, bouton, entretienDu) {
    var c = vue.contrat;
    var ligne = (vue.journees || {})[d] || {};
    var type = Kit.typeDuJour(vue.journees, d);

    /* Retirer une déclaration : les quatre colonnes repartent à `null`
       ENSEMBLE. Une ligne à demi effacée — un événement sans minutes — serait
       refusée par la contrainte `journee_ecart_coherent`, et surtout elle se
       relirait de travers. */
    /* LOT 29 (§29.2, 1) — DÉCLARER UN ÉCART SUR UNE ABSENCE REMET LA JOURNÉE
       EN PRÉSENCE. `type: ligne.type || 'presence'` laissait la journée en
       `absence_enfant` avec un écart par-dessus : l'écran continuait de dire
       « absent », et le moteur comptait l'écart — une libération d'une heure
       sur une journée où l'enfant n'était pas là retirait 60 minutes de
       récupération. La déclaration dit que l'enfant était là. */
    var typeEcrit = ligne.type === 'absence_enfant' ? 'presence' : (ligne.type || 'presence');
    var champs = {
      contrat_id: c.id, jour: d,
      type: typeEcrit,
      minutes_reelles: ligne.minutes_reelles == null ? null : ligne.minutes_reelles,
      entretien_centimes: ligne.entretien_centimes == null ? null : ligne.entretien_centimes,
      commentaire: ligne.commentaire == null ? null : ligne.commentaire,
      ecart_minutes: evenement ? minutes : null,
      ecart_evenement: evenement || null,
      ecart_heure_reelle: evenement ? heure : null,
      ecart_impute_sur: (evenement && minutes < 0) ? destination : null,
      /* §20.6 — retirer une déclaration REND l'indemnité. Une journée sans
         écart est une journée dans le cadre, et l'interrupteur n'y existe
         plus : laisser `false` derrière soi retirerait une indemnité sans
         aucun écran pour la remettre. */
      entretien_du: evenement ? (entretienDu !== false) : true
    };
    ecrire(global.DB.enregistrerJournee(champs), bouton,
      evenement ? 'Journée enregistrée' : 'Déclaration retirée',
      { contrats: [c.id], jours: [d] });
  }

  /* --- LOT 12 : la note d'une journée --------------------------------- */

  /* --- LOT 12 : la note d'une journée ---------------------------------

     Le `<details>` « Un mot sur cette journée ? » a disparu : la note est
     devenue un choix de la liste (le cinquième), au même style que les autres.
     L'écriture, elle, n'a pas bougé — et elle ne touche toujours QUE le
     commentaire : les colonnes de l'écart d'horaire et de l'ajustement des
     heures ne sont pas transmises, donc la base les conserve. */
  function enregistrerNote(d, texte, bouton) {
    var c = vue.contrat;
    var ligne = (vue.journees || {})[d] || {};
    ecrire(global.DB.enregistrerJournee({
      contrat_id: c.id, jour: d,
      type: ligne.type || 'presence',
      minutes_reelles: ligne.minutes_reelles == null ? null : ligne.minutes_reelles,
      entretien_centimes: ligne.entretien_centimes == null ? null : ligne.entretien_centimes,
      commentaire: String(texte || '').trim() || null,
      minutes_sup_exceptionnelles: ligne.minutes_sup_exceptionnelles || 0,
      minutes_sup_renoncees: ligne.minutes_sup_renoncees || 0,
      sup_dues_override: ligne.sup_dues_override === undefined ? null : ligne.sup_dues_override
    }), bouton, 'Note enregistrée', { contrats: [c.id], jours: [d] });
  }

  /* Contrats qui recevront réellement une absence de Maria posée ce jour-là :
     jour de leur planning, dans leurs bornes, non férié, et — correction B1 —
     mois NON clôturé pour eux. */
  function contratsServis(d) {
    if (Feries.estJourFerie(d)) return [];
    return global.App.contrats().filter(function (c) {
      var planning = planningDuMois();
      if (planning.indexOf(Engine.jourSemaine(d)) === -1) return false;
      if (c.date_debut && d < c.date_debut) return false;
      if (c.date_fin && d > c.date_fin) return false;
      if (global.App.estClos(vue.recaps, c.id)) return false;
      return true;
    });
  }

  /* Contrats écartés parce que LEUR mois est clôturé : on le dit, on ne le
     tait pas — sans quoi Maria croirait le congé posé partout. */
  function contratsClos(d) {
    if (Feries.estJourFerie(d)) return [];
    return global.App.contrats().filter(function (c) {
      var planning = planningDuMois();
      if (planning.indexOf(Engine.jourSemaine(d)) === -1) return false;
      if (c.date_debut && d < c.date_debut) return false;
      if (c.date_fin && d > c.date_fin) return false;
      return global.App.estClos(vue.recaps, c.id);
    });
  }

  function avertirClos(corps, d) {
    var clos = contratsClos(d);
    if (!clos.length) return;
    corps.appendChild(Kit.warnbox(
      'Mois déjà clôturé pour ' + clos.map(function (c) { return c.prenom_enfant; }).join(', '),
      'Ce ' + (clos.length > 1 ? 'ces contrats ne seront pas modifiés' : 'contrat ne sera pas modifié') +
      ' : leur récapitulatif ' + Kit.deMoisAnnee(vue.annee, vue.mois) + ' est verrouillé.'));
  }

  /* Correction A5 : la pose groupée passe par un upsert qui REMPLACE la ligne
     du jour sur chaque contrat, en remettant heures réelles et entretien à
     null. Une journée de familiarisation d'un autre contrat serait donc
     effacée sans retour possible. On le dit avant, contrat par contrat. */
  function journeesEcrasees(d, servis) {
    var perdues = [];
    servis.forEach(function (c) {
      if (c.id === vue.contrat.id) return;
      var j = vue.journeesAutres[c.id];
      if (!j) return;
      var ligne = j[d];
      if (!ligne) return;
      if (ligne.type === 'familiarisation' ||
          ligne.minutes_reelles != null || ligne.entretien_centimes != null) {
        perdues.push(c);
      }
    });
    return perdues;
  }

  function avertirEcrasement(corps, d, servis) {
    var perdues = journeesEcrasees(d, servis);
    if (!perdues.length) return;
    corps.appendChild(Kit.warnbox(
      'Une saisie manuelle sera remplacée chez ' +
      perdues.map(function (c) { return c.prenom_enfant; }).join(', '),
      'Cette journée y porte des heures réelles ou une indemnité saisies à la main ' +
      '(familiarisation). Poser un congé les efface sans possibilité de les retrouver.'));
  }

  function libelleServis(servis) {
    if (!servis.length) return 'aucun contrat';
    if (servis.length === 1) return servis[0].prenom_enfant;
    return 'les ' + servis.length + ' enfants';
  }
  /* « appliqué à les 3 enfants » ne se dit pas. */
  function libelleServisA(servis) {
    if (!servis.length) return 'aucun contrat';
    if (servis.length === 1) return servis[0].prenom_enfant;
    return 'aux ' + servis.length + ' enfants';
  }

  /* Les effets annoncés sont CALCULÉS PAR LE MOTEUR (§4 des specs). */
  /* L'effet annoncé d'une absence est CALCULÉ PAR LE MOTEUR (§4 des specs) :
     on rejoue le mois avec la journée forcée en absence et on compare. */
  function apercuAbsence(d) {
    return phraseAbsence(simuler(d, 'absence_enfant'), vue.entree.resultat);
  }

  /* Rejoue le mois avec la journée `d` forcée au type `type`. Fonction pure. */
  function simuler(d, type, extra) {
    return simulerLignes([{ jour: d, type: type === 'presence' ? null : type, extra: extra }]);
  }

  /* LOT 18 §18.1 — LE MÊME REJEU, POUR PLUSIEURS JOURS. Un seul chemin de
     simulation dans cet écran : celui du geste unitaire et celui du geste
     groupé doivent voir exactement la même chose, sinon l'aperçu de l'un
     contredirait l'aperçu de l'autre sur les mêmes journées.
     `type` à `null` = retour à la présence (la ligne disparaît, saisie par
     exception, B.0-2). */
  function simulerJours(jours, type) {
    return simulerLignes(jours.map(function (d) {
      return { jour: d, type: type, extra: null };
    }));
  }

  /* §28.3 — le mois rejoué avec, ce jour-là, exactement la ligne que la
     feuille s'apprête à écrire. */
  function simulerAvecLigne(d, ligne) {
    return simulerLignes([{ jour: d, ligne: ligne }]);
  }

  /* `forcees` = [{ jour, type|null, extra }] ou [{ jour, ligne }]. Fonction pure. */
  function simulerLignes(forcees) {
    var vises = {};
    forcees.forEach(function (f) { vises[f.jour] = f; });

    var lignes = [];
    Object.keys(vue.journees).forEach(function (k) {
      if (!vises[k]) lignes.push(vue.journees[k]);
    });
    /* La ligne simulée est EXACTEMENT celle que `marquerJournees` écrira :
       type changé, ajustements remis à plat. C'est ce qui rend l'aperçu et le
       résultat identiques par construction (§18.1 A2). Le commentaire n'entre
       dans aucun calcul : son sort ne change rien ici. */
    forcees.forEach(function (f) {
      /* LOT 28 (§28.3) — une ligne COMPLÈTE peut être imposée telle quelle :
         c'est ce que fait l'aperçu d'une déclaration d'horaire pour savoir où
         le moteur mettra chaque minute. */
      if (f.ligne) { lignes.push(f.ligne); return; }
      if (f.type == null) return;            // présence : aucune ligne
      lignes.push({
        contrat_id: vue.contrat.id, jour: f.jour, type: f.type,
        minutes_reelles: f.extra ? f.extra.minutes_reelles : null,
        entretien_centimes: f.extra ? f.extra.entretien_centimes : null,
        /* CORRECTION B3 — LA PROMESSE DU COMMENTAIRE CI-DESSUS EST TENUE.
           `marquerJournees` remet `entretien_du` à `true` (l'interrupteur du
           §20.6 n'existe que sur une journée qui sort du cadre) ; la ligne
           simulée l'omettait, et l'aperçu comptait une indemnité que
           l'enregistrement allait rétablir — ou l'inverse. */
        entretien_du: true,
        minutes_sup_exceptionnelles: 0,
        minutes_sup_renoncees: 0,
        sup_dues_override: null,
        ecart_minutes: null,
        ecart_evenement: null,
        ecart_heure_reelle: null,
        ecart_impute_sur: null
      });
    });
    /* LOT 17 §17.3 — LES CONDITIONS DU MOIS, telles que la chaîne les a
       résolues. Ce rejeu doit voir EXACTEMENT ce que voit la chaîne : lui
       passer les réglages de `contrat` ferait diverger l'aperçu « voilà ce que
       ce geste change » du chiffre réellement enregistré, sur un écran dont
       c'est tout l'objet. Le brut et le net peuvent manquer (§17.2 point 3) ;
       comme dans la chaîne, ils valent alors zéro et l'écran le signale. */
    var condMois = cond() || {};
    var conditions = {};
    for (var kc in condMois) conditions[kc] = condMois[kc];
    conditions.brut_mensuel_centimes = condMois.brut_mensuel_centimes || 0;
    conditions.net_mensuel_centimes = condMois.net_mensuel_centimes || 0;
    /* LOT 16 §16.1 — MÊME REPLI QUE LA CHAÎNE. Sans lui, un mois dont la
       ventilation ne tient plus s'affichait bien (la chaîne se replie) mais
       toucher un jour faisait retomber cet aperçu sur l'exception : la feuille
       du jour devenait inutilisable sur le mois précisément à corriger.
       Une seule règle de repli, définie dans chaine-mois.js, appelée ici. */
    var params = {
      contrat: vue.contrat,
      conditions: conditions,
      journees: lignes,
      compteurEntree: vue.entree.compteurEntree,
      annee: vue.annee,
      mois: vue.mois,
      /* Correctif B1 de la relecture PR9 — ce rejeu doit voir EXACTEMENT ce que
         voit la chaîne, imputations comprises. Sans elles, l'aperçu « voilà ce
         que ce geste change » comparait un mois ventilé selon le choix de Maria
         à un mois ventilé selon l'ordre par défaut : l'écart affiché n'était pas
         celui du geste, mais celui de l'oubli. */
      imputations: vue.imputations || [],
      /* CORRECTION B3 — LES PÉRIODES DE FAMILIARISATION, par le même chemin et
         pour la même raison que les imputations juste au-dessus. Sans elles, le
         rejeu voit un mois entièrement mensualisé et l'écart annoncé n'est pas
         celui du geste, mais celui de l'oubli. */
      periodesFamiliarisation: vue.periodesFamiliarisation || [],
      /* LOT 28 — les deux entrées que la chaîne passe aussi : les samedis
         cochés (§28.8) et le cumul de l'exercice pour le plafond des congés
         payés (§28.1). Le cumul est celui que la chaîne a posé sur le maillon
         du mois — jamais recalculé ici. */
      samedisComptes: vue.samedisComptes || [],
      minutesCpAcquisesExercice: (vue.entree && vue.entree.minutesCpAcquisesExercice) || 0,
      /* LA RÉCUPÉRATION SE GAGNE JOUR APRÈS JOUR — la date du jour, que la
         chaîne passe aussi. Sans elle, l'aperçu « voilà ce que ce geste
         change » évaluerait les réserves au 1er du mois là où le mois
         enregistré les évalue à la date : l'écart affiché ne serait pas celui
         du geste, mais celui de l'oubli. Quatrième occurrence du même défaut,
         et le garde-fou juste en dessous la refuse. */
      aujourdhui: vue.aujourdhui || global.App.aujourdhui()
    };
    /* C'EST LA TROISIÈME FOIS QUE CET APPEL OUBLIE UN ARGUMENT — les
       imputations au lot 10, les conditions au lot 17, les périodes au lot 20.
       Le garde-fou ne vérifie donc plus un argument en particulier : il vérifie
       que le rejeu et la chaîne reçoivent LE MÊME JEU DE CLÉS. Une entrée
       ajoutée à `calculerMois` sans être ajoutée ici fait échouer un test au
       lieu de fausser un chiffre à l'écran. */
    verifierMemesEntreesQueLaChaine(params);
    return Chaine.calculerMoisAvecRepli(params).resultat;
  }

  /* Les clés que `Chaine.serie` passe à `calculerMoisAvecRepli`. Elles sont
     écrites ici, en dur, plutôt que déduites : une liste déduite du même code
     que celui qu'elle contrôle ne contrôle rien. */
  var ENTREES_DU_REJEU = ['contrat', 'conditions', 'journees', 'compteurEntree',
                          'annee', 'mois', 'imputations', 'periodesFamiliarisation',
                          'samedisComptes', 'minutesCpAcquisesExercice',
                          'aujourdhui'];

  function verifierMemesEntreesQueLaChaine(params) {
    var manquantes = ENTREES_DU_REJEU.filter(function (k) {
      return !Object.prototype.hasOwnProperty.call(params, k);
    });
    if (manquantes.length) {
      /* Une erreur, pas un avertissement en console : un rejeu incomplet
         affiche un chiffre faux et crédible, ce qui est le pire résultat
         possible (B.0-9). */
      throw new Error('rejeu incomplet — entrées manquantes : ' + manquantes.join(', '));
    }
  }

  function phraseEcart(apres, avant) {
    var delta = (apres.entretienCentimes || 0) - (avant.entretienCentimes || 0);
    if (delta > 0) return 'entretien + ' + Kit.eur(delta) + ' · déclaration retirée';
    if (delta < 0) return 'entretien − ' + Kit.eur(-delta) + ' · déclaration retirée';
    return 'journée comptée comme travaillée · déclaration retirée';
  }

  /* §25.2 — LA LIGNE DE RÉSULTAT D'UNE ABSENCE, chiffrée et courte :
     « entretien − 5,00 € · vos 30 min restent dues ».

     Les deux termes viennent du REJEU par le moteur, comme avant : on lui
     donne le mois avec la journée forcée en absence, et on annonce l'écart.
     Aucun montant n'est recomposé ici (B.0-5), et RG-09 continue de décider
     du sort des minutes — la phrase suit le paramètre, elle ne le devine
     pas. Seule la mise en mots a changé. */
  function phraseAbsence(apres, avant) {
    var deltaEntretien = (apres.entretienCentimes || 0) - (avant.entretienCentimes || 0);
    var deltaSup = (apres.minutesSupAcquises || 0) - (avant.minutesSupAcquises || 0);
    var bouts = [];
    bouts.push(deltaEntretien < 0
      ? 'entretien − ' + Kit.eur(-deltaEntretien)
      : 'entretien inchangé');
    if (deltaSup === 0) {
      /* RG-09 — la formulation de la feuille du jour, en production depuis
         le lot 6. Depuis le lot 28 (§28.2) elle ne s'affiche plus que lorsque
         les minutes sont déjà nulles (contrat à 0 minute, journée déjà
         absente) : quand l'enfant est absent, rien n'est dû. */
      bouts.push('vos ' + Kit.duree(reg('minutes_sup_jour', 0)) + ' restent dues');
    } else if (deltaSup < 0) {
      /* LOT 28 (§28.2) — décision d'Adrien du 25 août : quand l'enfant est
         absent, ni indemnité d'entretien, ni minute supplémentaire. Le chiffre
         vient du rejeu par le moteur, jamais d'ici. */
      bouts.push('vos ' + Kit.duree(-deltaSup) + ' ne sont pas dues');
    } else {
      bouts.push('+ ' + Kit.duree(deltaSup) + ' de récupération');
    }
    return bouts.join(' · ');
  }

  /* ------------------------------------------------------------------ */
  /* Autres cas : familiarisation, jour non travaillé, sans solde        */
  /* ------------------------------------------------------------------ */

  function feuilleAutresCas(d, servis) {
    var c = vue.contrat;
    Kit.ouvrirFeuille(Kit.jourLong(d), 'Cas particuliers — ' + c.prenom_enfant,
      function (corps) {
        /* LOT 20 (§20.1) — « JOURNÉE DE FAMILIARISATION » DISPARAÎT D'ICI.

           Elle ouvrait une saisie libre — des heures, un montant d'indemnité —
           sur une journée isolée, sans période. Depuis ce lot, la
           familiarisation est une PÉRIODE : c'est elle qui décide du sort d'un
           jour, elle qui borne le prorata du mois, et elle qui rend les heures
           déclarées payables. Une journée de familiarisation posée hors de
           toute période ne serait payée par rien.
           On ne supprime pas la possibilité : on dit où elle vit maintenant. */
        corps.appendChild(Kit.ce('p', 'sb q',
          'La familiarisation se règle par période, sur la fiche de ' +
          c.prenom_enfant + ' : deux dates, puis les heures déclarées jour par ' +
          'jour. Une journée isolée ne serait payée par rien.'));

        Kit.choix(corps, 'c3', '⊘', 'Je n’étais pas demandée, sans poser de congé',
          'La famille était fermée. Journée neutre : ni entretien, ni heures sup, ' +
          'et AUCUN congé payé consommé. S’applique ' + libelleServisA(servis) + '.',
          function (ev) { poserTypeGroupe(d, servis, 'hors_planning', ev.currentTarget,
            'Journée notée non travaillée'); });

        Kit.choix(corps, 'c2', '−', 'Congé sans solde',
          'Retenue sur le salaire (RG-08), aucun compteur consommé. ' +
          'S’applique ' + libelleServisA(servis) + '.',
          function (ev) { poserTypeGroupe(d, servis, 'sans_solde', ev.currentTarget,
            'Journée notée sans solde'); });

        /* L'AJUSTEMENT MANUEL DES HEURES (LOT 12, V8-18) A ÉTÉ DÉPLACÉ ICI.

           Il occupait un `<details>` permanent sur la feuille du jour, à côté
           de la déclaration d'horaire qui couvre les mêmes minutes par un
           chemin plus sûr — Maria déclarait un événement, ou bien elle
           bricolait un compteur, sans savoir lequel des deux faisait foi.

           IL N'EST PAS SUPPRIMÉ (brief du 23 août, §4) : il se range dans les
           cas particuliers, avec la phrase qui dit quand s'en servir. Les trois
           gestes du lot 12 sont intacts : ajouter des minutes, renoncer aux
           siennes, et décider au cas par cas si elles restent dues quand
           l'enfant est absent (A8). */
        corps.appendChild(Kit.section('Ajuster mes heures ce jour-là'));
        corps.appendChild(Kit.ce('p', 'sb q',
          'Pour les cas que la déclaration d’horaire ne couvre pas : ajouter des ' +
          'minutes travaillées au-delà du contrat, ou renoncer à celles qui vous ' +
          'sont dues.'));
        corps.appendChild(blocAjusterHeures(d));

        avertirClos(corps, d);
        avertirEcrasement(corps, d, servis);
      });
  }

  /* ------------------------------------------------------------------ */
  /* LOT 20 (§20.4 c) — LA FEUILLE DU JOUR DE FAMILIARISATION            */
  /*                                                                     */
  /* Deux gestes, et deux seulement : les heures faites, et si           */
  /* l'indemnité d'entretien est comptée. Le montant du jour s'affiche   */
  /* au fur et à mesure, REJOUÉ PAR LE MOTEUR — jamais recomposé ici :   */
  /* si le taux change par un avenant, la phrase change toute seule.     */
  /*                                                                     */
  /* ARRIVÉE PUIS DÉPART (retour d'Adrien du 26 août 2026). Les heures   */
  /* faites ne se déclarent plus que d'UNE façon : l'arrivée et le       */
  /* départ, à la minute. Les trois raccourcis de durée ont disparu —    */
  /* une durée de familiarisation n'est pas usuelle (RG-14, horaires     */
  /* variables), et trois durées proposées d'avance invitaient à cocher  */
  /* au lieu de relever. Et l'enregistrement se fait EN DEUX TEMPS : le  */
  /* matin l'arrivée seule, le soir le départ. Une arrivée seule est     */
  /* gardée en base (`fam_heure_arrivee`, migration 019) ; la journée    */
  /* est alors « en cours » : rien n'est payé, `minutes_reelles` reste   */
  /* `null`, exactement l'état d'une journée à déclarer. Le moteur ne    */
  /* lit jamais les deux heures — `declare: minutesJour > 0` reste le    */
  /* seul juge de ce qui est payé.                                       */
  /* ------------------------------------------------------------------ */

  /* « 08:45 » → « 8h45 », pour une phrase. */
  function heureEnTexte(hhmm) {
    var t = String(hhmm || '').slice(0, 5);
    if (!t) return '';
    return Number(t.slice(0, 2)) + 'h' + t.slice(3, 5);
  }

  function feuilleFamiliarisation(d) {
    var c = vue.contrat;
    var conditions = cond();
    var ligne = (vue.journees || {})[d] || {};
    var etatJour = (vue.famJours && vue.famJours[d]) || null;

    /* Ce que la base porte déjà. `minutesBase` est la durée déclarée AVANT
       cette feuille ; elle n'est jamais recalculée toute seule depuis une
       arrivée pré-remplie — une journée déclarée avant la migration 019 (une
       durée, aucune heure) garde sa durée tant que les deux heures ne sont
       pas saisies. */
    var minutesBase = (ligne.minutes_reelles != null && ligne.minutes_reelles > 0)
      ? ligne.minutes_reelles : null;
    var arriveeBase = ligne.fam_heure_arrivee ? String(ligne.fam_heure_arrivee).slice(0, 5) : '';
    var departBase = ligne.fam_heure_depart ? String(ligne.fam_heure_depart).slice(0, 5) : '';

    /* État local de la feuille. `entretien` suit le défaut de la base : dû,
       sauf si Maria l'a explicitement retiré (§20.6 — retirer est un choix).
       `arrivee` : celle enregistrée, sinon l'heure d'arrivée des conditions
       du mois, `09:00` à défaut. `depart` : celui enregistré, sinon vide.
       `minutes` : ce qui SERA ÉCRIT dans `minutes_reelles` — la durée du
       moteur quand les deux heures sont là, la durée de la base sinon. */
    var etat = {
      minutes: minutesBase,
      entretien: ligne.entretien_du !== false,
      arrivee: arriveeBase ||
        (conditions && String(conditions.heure_arrivee || '').slice(0, 5)) || '09:00',
      depart: departBase,
      /* Le départ saisi est-il refusé par le moteur ? Il n'est alors pas
         écrit : l'arrivée, elle, reste enregistrable (§3.4). */
      departRefuse: false
    };

    Kit.ouvrirFeuille('Familiarisation — ' + Kit.jourLong(d),
      c.prenom_enfant + ' — seules les heures déclarées sont payées.',
      function (corps) {
        corps.appendChild(Kit.ce('p', 'sb q',
          'Rémunération à l’heure, au taux du contrat. Pas de minutes ' +
          'supplémentaires. Vos congés s’acquièrent normalement.'));

        /* --- les heures faites : arrivée et départ, rien d'autre --------- */
        corps.appendChild(Kit.section('Les heures faites'));
        corps.appendChild(Kit.ce('p', 'sb q', 'Arrivée et départ, à la minute près.'));

        var arr = Kit.champHeureMinute('Arrivée', etat.arrivee);
        var dep = Kit.champHeureMinute('Départ', etat.depart);
        /* CORRECTIF 26 août — les deux champs sont EMPILÉS, jamais côte à
           côte. Dans une `.row` de 390 px chaque cadre tombait à 173 px, le
           libellé en prenait 46 %, et il ne restait pas de quoi afficher une
           heure : le Départ était rogné hors de son cadre. Empilés, ils font
           166 px de champ à 390 px, et 128 px sur le plus petit iPhone. */
        corps.appendChild(arr.bloc);
        corps.appendChild(dep.bloc);

        var msgHeures = Kit.ce('div', 'msg');
        corps.appendChild(msgHeures);

        /* Relit les deux champs et en tire ce qui sera écrit. La durée n'est
           calculée QUE si les deux heures sont là : une arrivée seule laisse
           la durée telle que la base la porte (`null` sur un jour vierge). */
        function lireLesDeuxHeures() {
          var a = arr.valeur();
          var b2 = dep.valeur();
          etat.departRefuse = false;
          msgHeures.className = 'msg';
          msgHeures.textContent = '';
          if (!a && b2) {
            /* Départ saisi sans arrivée : rien ne s'enregistre, et on le dit. */
            etat.minutes = minutesBase;
            msgHeures.className = 'msg ko';
            msgHeures.textContent = 'Enregistrez d’abord l’heure d’arrivée.';
            return;
          }
          if (!a || !b2) { etat.minutes = minutesBase; return; }
          try {
            /* La durée est une RÈGLE : le moteur, et lui seul (B.0-5). */
            etat.minutes = Engine.dureeEntreHeures(a, b2);
          } catch (e) {
            /* Départ antérieur ou égal à l'arrivée : message du moteur, le
               départ n'est pas écrit, la durée retombe sur celle de la base. */
            etat.minutes = minutesBase;
            etat.departRefuse = true;
            msgHeures.className = 'msg ko';
            msgHeures.textContent = Kit.messageErreur(e);
          }
        }
        arr.input.addEventListener('change', function () {
          etat.arrivee = arr.valeur(); lireLesDeuxHeures(); majTout();
        });
        dep.input.addEventListener('change', function () {
          etat.depart = dep.valeur(); lireLesDeuxHeures(); majTout();
        });

        /* --- le montant du jour, rejoué par le moteur ------------------ */
        var effet = Kit.ce('div', 'effet-heures');
        corps.appendChild(effet);

        /* --- l'indemnité d'entretien ---------------------------------- */
        corps.appendChild(Kit.section('Indemnité d’entretien du jour'));
        var choixEntretien = Kit.ce('div');
        corps.appendChild(choixEntretien);

        var msg = Kit.ce('div', 'msg');
        corps.appendChild(msg);

        var bEnr = Kit.bouton('btn', function () { enregistrer(); });
        corps.appendChild(bEnr);

        /* Retirer une déclaration faite par erreur. Sans ce bouton, une
           journée déclarée à 4 h au lieu de 40 min ne pourrait que se
           corriger, jamais s'effacer — et un jour non venu resterait payé.
           Une arrivée seule se retire aussi : « en cours » n'est pas payé,
           mais la case du calendrier réclame un départ tant qu'elle est là. */
        if ((etatJour && etatJour.declare) || arriveeBase) {
          var bRetirer = Kit.bouton('btn nt', function () { retirer(bRetirer); });
          bRetirer.textContent = 'Retirer cette déclaration';
          corps.appendChild(bRetirer);
          corps.appendChild(Kit.ce('p', 'sb q',
            'La journée redevient « à déclarer » : rien ne sera payé pour ce jour.'));
        }

        avertirClos(corps, d);

        /* Le départ que la feuille porte, prêt à être écrit : celui des deux
           champs s'il est là et accepté par le moteur, `null` sinon. */
        function departAEcrire() {
          return (etat.depart && !etat.departRefuse) ? etat.depart : null;
        }

        function majTout() {
          Kit.vider(effet);
          if (etat.minutes && conditions && conditions.brut_mensuel_centimes != null) {
            var brut = Engine.montantCentimes(conditions.brut_mensuel_centimes, etat.minutes);
            var p = Kit.ce('div');
            p.appendChild(Kit.ce('b', null, 'Rémunération du jour : ' + Kit.eur(brut)));
            p.appendChild(document.createTextNode(' — ' + Kit.heures(etat.minutes) + ' déclarées.'));
            effet.appendChild(p);
          } else if (etat.minutes) {
            effet.appendChild(Kit.ce('div', 'sb q',
              'La rémunération ne peut pas être chiffrée : les conditions de ce ' +
              'mois ne portent pas de salaire.'));
          } else if (arriveeBase) {
            /* L'arrivée est enregistrée, le départ manque : la journée est
               « en cours », et rien n'est payé tant que le départ n'est pas là. */
            effet.appendChild(Kit.ce('div', 'sb q',
              'Arrivée enregistrée à ' + heureEnTexte(arriveeBase) + '. Ce jour sera ' +
              'payé quand vous aurez enregistré le départ.'));
          } else {
            effet.appendChild(Kit.ce('div', 'sb q',
              'Tant que rien n’est déclaré, ce jour ne paie rien.'));
          }

          Kit.vider(choixEntretien);
          var plein = (conditions && conditions.entretien_centimes_jour != null)
            ? Kit.eur(conditions.entretien_centimes_jour) : '—';
          poserOption(choixEntretien, etat.entretien, 'Comptée',
            'Montant plein du jour, jamais un prorata des heures — ' + plein,
            function () { etat.entretien = true; majTout(); });
          poserOption(choixEntretien, !etat.entretien, 'Non comptée', '0,00 €',
            function () { etat.entretien = false; majTout(); });

          /* UN SEUL BOUTON, dont le libellé nomme le geste qu'il va faire, et
             qui s'active dès qu'UNE heure est saisie :
               rien                        → « Enregistrer », inactif ;
               arrivée seule               → « Enregistrer l'arrivée » ;
               arrivée + départ valides    → « Enregistrer la journée — 4h15 » ;
               départ seul, sans arrivée   → « Enregistrer », inactif + message ;
               départ refusé par le moteur → « Enregistrer l'arrivée » : le
                                             message est affiché, l'arrivée
                                             reste enregistrable. */
          if (!etat.arrivee) {
            bEnr.textContent = 'Enregistrer';
            bEnr.disabled = true;
          } else if (etat.minutes) {
            bEnr.textContent = 'Enregistrer la journée — ' + Kit.heures(etat.minutes);
            bEnr.disabled = false;
          } else {
            bEnr.textContent = 'Enregistrer l’arrivée';
            bEnr.disabled = false;
          }
        }

        /* Un enregistrement écrit TOUJOURS la ligne entière telle que la
           feuille la porte : l'arrivée, le départ s'il est là, la durée si
           elle est calculable, et l'indemnité d'entretien. Il n'y a pas deux
           écritures à maintenir — le second appui complète la même ligne. */
        function enregistrer() {
          if (!etat.arrivee) {
            msg.className = 'msg ko';
            msg.textContent = etat.depart
              ? 'Enregistrez d’abord l’heure d’arrivée.'
              : 'Saisissez l’heure d’arrivée, puis l’heure de départ quand vous la connaîtrez.';
            return;
          }
          var depart = departAEcrire();
          ecrire(global.DB.enregistrerJournee({
            contrat_id: c.id, jour: d, type: 'familiarisation',
            minutes_reelles: etat.minutes == null ? null : etat.minutes,
            /* Le MONTANT de l'indemnité n'est pas surchargé ici : c'est
               l'avenant qui le porte (§7 des instructions). `entretien_du`
               répond à l'autre question — est-elle due. */
            entretien_centimes: null,
            entretien_du: etat.entretien,
            commentaire: ligne.commentaire == null ? null : ligne.commentaire,
            /* La trace de la saisie, jamais une donnée de calcul. */
            fam_heure_arrivee: etat.arrivee,
            fam_heure_depart: depart,
            /* Une journée de la période ne porte aucun écart d'horaire :
               le moteur les ignore, les laisser en base les rendrait
               visibles le jour où la période serait raccourcie. */
            ecart_minutes: null, ecart_evenement: null,
            ecart_heure_reelle: null, ecart_impute_sur: null
          }), bEnr, etat.minutes ? 'Journée déclarée' : 'Arrivée enregistrée',
          { contrats: [c.id], jours: [d] });
        }

        /* Retirer remet la durée ET les deux heures à `null` : une
           déclaration retirée ne laisse pas d'heure orpheline. */
        function retirer(bouton) {
          ecrire(global.DB.enregistrerJournee({
            contrat_id: c.id, jour: d, type: 'familiarisation',
            minutes_reelles: null,
            entretien_centimes: null,
            entretien_du: true,
            commentaire: ligne.commentaire == null ? null : ligne.commentaire,
            fam_heure_arrivee: null,
            fam_heure_depart: null
          }), bouton, 'Déclaration retirée', { contrats: [c.id], jours: [d] });
        }

        majTout();
      });
  }

  /* Une option à cocher, sur le modèle des trois choix de la feuille du jour.
     Un bouton radio dessiné, pas une case à cocher : le §20.6 parle d'un
     interrupteur « coché par défaut », et la maquette montre deux lignes
     « Comptée / Non comptée ». Le comportement est le même, la lecture est
     plus simple debout, entre deux enfants. */
  function poserOption(parent, actif, titre, sous, onClic) {
    /* Le choix coché porte la PASTILLE PLEINE en plus de sa teinte : une
       couleur seule ne dit rien à qui ne la voit pas, et l'état est aussi
       annoncé aux lecteurs d'écran (V8-01, V8-05). */
    var b = Kit.choix(parent, 'c1', actif ? '●' : '○', titre, sous, onClic);
    if (actif) b.className += ' on';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', actif ? 'true' : 'false');
    return b;
  }

  /* ------------------------------------------------------------------ */
  /* Écritures                                                           */
  /* ------------------------------------------------------------------ */

  /* Un échec d'écriture doit se VOIR, et la feuille RESTE ouverte : la saisie
     en cours ne disparaît pas sous les doigts de Maria (§3 des specs). */
  /* LOT 7 — « ANNULER » APRÈS ÉCRITURE (§6.8, V8-21).

     Toute écriture de journée est désormais rétractable tant que le message de
     confirmation est affiché. C'est le geste groupé qui le justifie : « 5
     journées notées » posé d'un doigt sur quatre contrats à la fois est
     exactement le genre de chose qu'on fait par erreur, et défaire cinq
     journées à la main, une par une, sur quatre enfants, personne ne le fait.

     CE QUE « ANNULER » NE COUVRE PAS : la clôture d'un mois.
     La spécification demandait de pouvoir annuler une clôture SANS écrire
     d'événement de réouverture. Ce n'est plus possible : depuis le correctif
     B1 du lot 13, la base écrit elle-même l'événement dès qu'un statut change,
     quel que soit le chemin — c'était tout l'objet de la correction, et une
     réouverture sans trace ne doit plus pouvoir exister. Entre le confort d'une
     annulation et la garantie que l'historique dit vrai, on garde la garantie.
     Maria qui s'est trompée rouvre le mois normalement, avec un motif : le
     chemin existe depuis le lot 13.
     // DÉCISION EN ATTENTE : arbitrage signalé à Adrien, réponse par défaut.

     `retour` = { contrats: [id…], jours: ['YYYY-MM-DD'…] } — l'empreinte de ce
     qui va changer, prise AVANT l'écriture. */
  function ecrire(promesse, bouton, messageOk, retour) {
    if (vue.lectureSeule) {
      Kit.toast('Ce mois est clôturé : il ne peut plus être modifié.', true);
      return Promise.resolve();
    }
    var avant = retour ? empreinte(retour.contrats, retour.jours) : null;
    if (bouton) bouton.disabled = true;
    return promesse
      .then(function () {
        global.App.invalider();
        Kit.fermerFeuille();
        Kit.toast(messageOk, false, avant ? {
          libelle: 'Annuler',
          delai: 5000,
          onclick: function () { restaurer(avant); }
        } : null);
        return global.App.rafraichir();
      })
      .catch(function (e) {
        if (bouton) bouton.disabled = false;
        Kit.toast('Enregistrement impossible : ' + Kit.messageErreur(e) + ' Rien n’a été modifié.', true);
      });
  }

  /* L'état ANTÉRIEUR des journées visées, lu dans ce que l'écran a déjà en
     mémoire — aucun aller-retour réseau avant l'écriture, sans quoi le geste
     de Maria attendrait deux fois. */
  function empreinte(contratIds, jours) {
    var lignes = [];
    (contratIds || []).forEach(function (id) {
      var source = id === vue.contrat.id ? vue.journees : vue.journeesAutres[id];
      if (!source) return;                      // journées non chargées : on ne devine pas
      (jours || []).forEach(function (d) {
        lignes.push({ contratId: id, jour: d, ligne: source[d] || null });
      });
    });
    return lignes.length ? lignes : null;
  }

  /* Remet chaque journée dans son état antérieur, EN UNE FOIS. Une ligne qui
     existait est réécrite telle quelle ; une ligne qui n'existait pas est
     supprimée — c'est la saisie par exception : l'absence de ligne est un état,
     pas un vide. */
  function restaurer(avant) {
    var gestes = avant.map(function (x) {
      if (!x.ligne) return global.DB.supprimerJournee(x.contratId, x.jour);
      var l = x.ligne;
      /* CORRECTION C1 DE LA RELECTURE DU LOT 18 — « ANNULER » REND TOUT.
         Les quatre colonnes de l'écart d'horaire (lot 17) manquaient : une
         déclaration « j'ai libéré plus tôt », effacée par un marquage groupé,
         ne revenait pas. Un bouton d'annulation qui ne rend qu'une partie de
         ce qu'il a défait est pire qu'aucun bouton : il fait croire que
         l'affaire est réglée. */
      return global.DB.enregistrerJournee({
        contrat_id: x.contratId, jour: x.jour, type: l.type,
        minutes_reelles: l.minutes_reelles, entretien_centimes: l.entretien_centimes,
        commentaire: l.commentaire == null ? null : l.commentaire,
        minutes_sup_exceptionnelles: l.minutes_sup_exceptionnelles,
        minutes_sup_renoncees: l.minutes_sup_renoncees,
        sup_dues_override: l.sup_dues_override,
        ecart_minutes: l.ecart_minutes == null ? null : l.ecart_minutes,
        ecart_evenement: l.ecart_evenement == null ? null : l.ecart_evenement,
        ecart_heure_reelle: l.ecart_heure_reelle == null ? null : l.ecart_heure_reelle,
        ecart_impute_sur: l.ecart_impute_sur == null ? null : l.ecart_impute_sur,
        /* LOT 29 (A6) — « Annuler » rend l'état EXACT d'avant, l'indemnité
           comprise : une absence remet `entretien_du` à vrai, l'annulation
           doit pouvoir le remettre à faux. La colonne est `not null` en base :
           on ne la transmet que si l'ancienne ligne la portait. */
        entretien_du: l.entretien_du == null ? undefined : l.entretien_du,
        /* ARRIVÉE PUIS DÉPART (migration 019) — les deux heures reviennent
           aussi, et à `null` si l'ancienne ligne n'en portait pas : une
           annulation rend l'état EXACT d'avant, heures comprises. */
        fam_heure_arrivee: l.fam_heure_arrivee == null ? null : l.fam_heure_arrivee,
        fam_heure_depart: l.fam_heure_depart == null ? null : l.fam_heure_depart
      });
    });
    return Promise.all(gestes)
      .then(function () {
        global.App.invalider();
        Kit.toast(avant.length > 1 ? 'C’est annulé — ' + avant.length + ' journées remises comme avant.'
                                   : 'C’est annulé.');
        return global.App.rafraichir();
      })
      .catch(function (e) {
        /* B.0-9 : ne jamais laisser croire qu'une annulation a marché. */
        Kit.toast('L’annulation n’a pas abouti : ' + Kit.messageErreur(e) +
          ' Votre modification est toujours enregistrée.', true);
        return global.App.rafraichir();
      });
  }

  function poserPresence(d, bouton) {
    if (Kit.typeDuJour(vue.journees, d) === 'presence') { Kit.fermerFeuille(); return; }
    ecrire(global.DB.supprimerJournee(vue.contrat.id, d), bouton, 'Journée enregistrée',
      { contrats: [vue.contrat.id], jours: [d] });
  }

  /* LE SIXIÈME CHOIX : DÉFAIRE.

     « Il faut qu'elle puisse corriger » (Adrien, 23 août). Ce geste retire ce
     que la liste a posé — une déclaration d'horaire, une absence — et rend la
     journée ordinaire. Il ne touche pas à ce qui se retire ailleurs : la note
     de la journée et l'ajustement manuel des heures ont chacun leur écran, et
     les effacer ici les ferait disparaître sans que Maria l'ait demandé
     (décision d'Adrien du 23 août : « chaque choix ne touche que son domaine »).

     Quand la journée ne porte QUE ce qui est retiré, on supprime la ligne :
     l'absence de ligne est l'état « journée ordinaire » (saisie par exception,
     B.0-2). Sinon on la réécrit, ce qui reste et ce qui part explicitement. */
  function remettreEnJourneeOrdinaire(d, servis, bouton) {
    var c = vue.contrat;
    var type = Kit.typeDuJour(vue.journees, d);
    if (TYPES_ABSENCE_MARIA.indexOf(type) !== -1) {
      return retirerAbsence(d, servis, bouton);
    }
    var ligne = (vue.journees || {})[d] || {};
    /* GARDE-FOU B2 : un congé posé à l'heure vit sur les mêmes colonnes que
       l'écart. Il ne se retire que depuis « Mes congés », où il vaut peut-être
       pour d'autres enfants. Ce choix n'est pas offert sur une telle journée ;
       le refus est répété ici pour que le chemin n'existe nulle part. */
    if (ligne.ecart_evenement === 'conge_horaire') {
      Kit.toast('Un congé est posé sur cette journée : il se retire depuis ' +
        '« Mes congés ».', true);
      return;
    }
    var garde = (ligne.commentaire != null && String(ligne.commentaire) !== '') ||
      (ligne.minutes_sup_exceptionnelles || 0) > 0 ||
      (ligne.minutes_sup_renoncees || 0) > 0 ||
      (ligne.sup_dues_override !== undefined && ligne.sup_dues_override !== null) ||
      ligne.minutes_reelles != null || ligne.entretien_centimes != null;

    if (!garde) return poserPresence(d, bouton);

    ecrire(global.DB.enregistrerJournee({
      contrat_id: c.id, jour: d, type: 'presence',
      minutes_reelles: ligne.minutes_reelles == null ? null : ligne.minutes_reelles,
      entretien_centimes: ligne.entretien_centimes == null ? null : ligne.entretien_centimes,
      commentaire: ligne.commentaire == null ? null : ligne.commentaire,
      minutes_sup_exceptionnelles: ligne.minutes_sup_exceptionnelles || 0,
      minutes_sup_renoncees: ligne.minutes_sup_renoncees || 0,
      sup_dues_override: ligne.sup_dues_override === undefined
        ? null : ligne.sup_dues_override,
      /* Les quatre colonnes de l'écart repartent à `null` ENSEMBLE : une ligne
         à demi effacée serait refusée par `journee_ecart_coherent`, et surtout
         elle se relirait de travers. */
      ecart_minutes: null, ecart_evenement: null,
      ecart_heure_reelle: null, ecart_impute_sur: null,
      /* §20.6 — retirer une déclaration REND l'indemnité. */
      entretien_du: true
    }), bouton, 'Journée remise comme les autres',
      { contrats: [c.id], jours: [d] });
  }

  function poserAbsenceEnfant(d, bouton) {
    var ligne = (vue.journees || {})[d] || {};
    /* DÉCISION D'ADRIEN, 23 AOÛT : « CHAQUE CHOIX NE TOUCHE QUE SON DOMAINE ».
       Cette écriture transmettait `commentaire: null` : marquer une absence
       EFFAÇAIT la note que Maria avait écrite sur la journée, sans un mot,
       alors que poser une note, elle, préservait l'écart déclaré. Une absence
       d'enfant ne dit rien de ce que Maria avait noté : la note reste. */
    /* LOT 29 (§29.2, 2) — L'ABSENCE EFFACE LES QUATRE COLONNES DE L'ÉCART et
       rend l'indemnité (`entretien_du: true`), comme le fait déjà le retrait
       d'une déclaration. `enregistrerJournee` ne touche pas aux colonnes
       absentes : l'écart SURVIVAIT au marquage, et la journée restait
       incohérente par l'autre bout. La note reste (décision du 23 août). */
    ecrire(global.DB.enregistrerJournee({
      contrat_id: vue.contrat.id, jour: d, type: 'absence_enfant',
      minutes_reelles: null, entretien_centimes: null,
      commentaire: ligne.commentaire == null ? null : ligne.commentaire,
      ecart_minutes: null, ecart_evenement: null,
      ecart_heure_reelle: null, ecart_impute_sur: null,
      entretien_du: true
    }), bouton, vue.contrat.prenom_enfant + ' ' + Kit.accordDe(vue.contrat, 'noté') +
      ' ' + Kit.accordDe(vue.contrat, 'absent'),
      { contrats: [vue.contrat.id], jours: [d] });
  }

  /* `poserConge` A ÉTÉ SUPPRIMÉE ICI (lot 10, V8-09). C'était le seul appelant
     du choix « Je ne travaillais pas » de la feuille de journée. Un congé posé
     depuis le calendrier écrivait la journée mais laissait la VENTILATION au
     moteur, identique pour les quatre enfants — exactement ce que le lot 10
     rend à Maria. Le chemin des congés est désormais unique : l'onglet
     « Mes congés ». `poserTypeGroupe` reste : le sans-solde et le jour non
     travaillé de « Autre cas » l'utilisent encore. */

  /* Écrit une absence de Maria sur TOUS les contrats servis, en une seule
     écriture, chacun avec SON propre jour. */
  function poserTypeGroupe(d, servis, type, bouton, messageOk) {
    if (!servis.length) {
      Kit.toast('Aucun contrat ne peut recevoir cette journée : ' +
        'elle est hors planning, fériée, ou son mois est déjà clôturé.', true);
      return;
    }
    var affectations = servis.map(function (c) { return { contratId: c.id, jours: [d] }; });
    ecrire(global.DB.poserAbsenceMaria(affectations, type, null), bouton, messageOk,
      { contrats: servis.map(function (c) { return c.id; }), jours: [d] });
  }

  function retirerAbsence(d, servis, bouton) {
    var ids = servis.map(function (c) { return c.id; });
    if (ids.indexOf(vue.contrat.id) === -1 && !global.App.estClos(vue.recaps, vue.contrat.id)) {
      ids.push(vue.contrat.id);
    }
    if (!ids.length) {
      Kit.toast('Aucun contrat modifiable pour ce jour.', true);
      return;
    }
    ecrire(global.DB.retirerAbsenceMaria(ids, [d], TYPES_ABSENCE_MARIA), bouton,
      'Congé retiré ' + libelleServisA(servis),
      { contrats: ids, jours: [d] });
  }

  /* ------------------------------------------------------------------ */
  /* §25.1 — DÉCLARER LES HEURES DU JOUR DEPUIS L'ACCUEIL                */
  /*                                                                     */
  /* « Un appui pour le faire » : la carte du bloc « Aujourd'hui » ouvre  */
  /* CETTE feuille, la même que dans l'espace enfant, avec le même        */
  /* aperçu chiffré rejoué par le moteur et les mêmes garde-fous.         */
  /*                                                                     */
  /* On monte donc le contexte complet du mois (conditions, journées,     */
  /* périodes, mois clôturés des autres contrats) avant d'ouvrir — une    */
  /* feuille plus pauvre annoncerait des montants faux. `corps` vaut      */
  /* `null` : rien n'est redessiné ici, et `App.rafraichir()` remet       */
  /* l'Accueil à jour après l'écriture.                                   */
  /* ------------------------------------------------------------------ */
  function declarerFamiliarisation(contrat, jour) {
    var m = { annee: Number(jour.slice(0, 4)), mois: Number(jour.slice(5, 7)) };
    return chargerVue(contrat, m, null).then(function () {
      if (!enFamiliarisation(jour)) {
        /* Le jour est sorti de la période entre-temps : on n'ouvre pas une
           feuille qui ne correspond plus à rien, et on le dit. */
        Kit.toast('Ce jour n’est plus dans une période de familiarisation.', true);
        return;
      }
      if (vue.lectureSeule) {
        Kit.toast('Ce mois est clôturé : il ne peut plus être modifié.', true);
        return;
      }
      feuilleFamiliarisation(jour);
    }).catch(function (e) {
      Kit.toast('Impossible d’ouvrir la déclaration : ' + Kit.messageErreur(e), true);
    });
  }

  global.UiEnfant = {
    afficher: afficher,
    /* §25.1 — l'Accueil ouvre la feuille de déclaration sans passer par cet
       écran. Exportée plutôt que recopiée : deux feuilles de saisie pour un
       même geste divergeraient à la première correction. */
    declarerFamiliarisation: declarerFamiliarisation,
    TYPES_ABSENCE_MARIA: TYPES_ABSENCE_MARIA,
    MOIS_A_VENIR_VISIBLES: MOIS_A_VENIR_VISIBLES
  };
})(window);
