/* ============================================================================
   ui-accueil.js — Écran d'accueil (§25.1 du redesign) et, depuis le lot 7, la
   fin de mois guidée (§6.7).

   LE GESTE DU JOUR D'ABORD. Deux blocs, et deux seulement :

     « Aujourd'hui » — ce qui est attendu aujourd'hui, une carte par geste, un
     appui pour le faire : des heures de familiarisation à déclarer, un mois à
     clôturer, un empêchement à lever. Rien à faire ? Une carte le dit.

     « Mes contrats » — une carte par contrat : avatar, prénom, un sous-texte,
     une pastille d'état. Ni statistiques à trois colonnes, ni barre de
     progression du mois : elles mesuraient le temps qui passe, pas ce qu'il y
     a à faire.

   POURQUOI LA FIN DE MOIS GUIDÉE VIT DANS CE FICHIER. La spécification du
   lot 7 réservait une liste de fichiers close, et `ui-fin-de-mois.js` n'en
   faisait pas partie. L'écran est donc rendu ici, sous la vue `finDeMois`.
   Signalé depuis, et toujours vrai : ce fichier en est long.

   Aucun calcul ici. Les chiffres viennent tous de la chaîne des mois
   (chaine-mois.js -> Engine.calculerMois).
   ========================================================================= */
(function (global) {
  'use strict';

  var Kit = global.Kit;
  /* CORRECTION B4 — la chaîne, pour lire le montant DÛ d'un mois. Aucun calcul
     n'entre ici : `netDuMois` choisit un champ, elle n'en produit pas. */
  var Chaine = global.ChaineMois;

  /* `Kit.bouton(classe, onclick)` ne pose pas de libellé : ce raccourci évite
     de répéter trois lignes à chaque bouton de cet écran. */
  function boutonTexte(classe, libelle, onclick) {
    var b = Kit.bouton(classe, onclick);
    b.textContent = libelle;
    return b;
  }

  /* Au-delà de ce nombre de mois à clôturer, l'accueil propose le parcours
     guidé plutôt que de laisser Maria ouvrir chaque enfant à la main. C'est
     aussi le seuil du §25.1 : « la carte "N mois à clôturer" l'ouvre quand il
     y a plus d'un mois en retard ». */
  var SEUIL_PARCOURS_GUIDE = 2;

  function afficher(ctx) {
    if (ctx.vue === 'finDeMois') return afficherFinDeMois(ctx);
    return afficherAccueil(ctx);
  }

  /* LOT 17 §17.2 — LE PLANNING D'UN MOIS vient des conditions que la chaîne a
     résolues pour ce mois-là, jamais de `contrat`. Les jours de garde sont
     datés : un avenant peut les changer au 1er d'un mois, et compter les jours
     travaillés d'un mois passé sur le planning d'aujourd'hui afficherait
     « 20 j sur 22 » là où le contrat n'en prévoyait que 18. */
  function planningDe(entree) {
    return (entree && entree.conditions && entree.conditions.jours_planning) || null;
  }

  /* ------------------------------------------------------------------ */
  /* 1. L'ACCUEIL — LE GESTE DU JOUR D'ABORD (§25.1)                     */
  /*                                                                     */
  /* CE QUE LE LOT 25 CHANGE ICI, ET POURQUOI.                           */
  /*                                                                     */
  /* L'accueil montrait, pour chaque contrat, une carte à trois colonnes  */
  /* de statistiques (présence, total à verser, congés payés), une barre  */
  /* de progression du mois dans l'en-tête, et une rubrique « À faire »   */
  /* qui mêlait six sortes de choses — retards, empêchements, clôtures,   */
  /* compteurs bas, parcours guidé. Beaucoup de chiffres, et aucun geste. */
  /*                                                                     */
  /* Il y a maintenant DEUX blocs, et deux seulement :                    */
  /*                                                                     */
  /*   « Aujourd'hui » — ce qui est attendu AUJOURD'HUI, une carte par    */
  /*   geste, UN APPUI POUR LE FAIRE. Rien à faire : une carte le dit.    */
  /*                                                                     */
  /*   « Mes contrats » — une carte par contrat : avatar, prénom, un      */
  /*   sous-texte, une pastille d'état. Rien d'autre.                     */
  /*                                                                     */
  /* CE QUI NE SE PERD PAS (A.2). Les tuiles d'empêchement — rémunération */
  /* manquante, net manquant, erreur de calcul — deviennent des cartes du */
  /* bloc « Aujourd'hui », même ton orange, même destination (la fiche).  */
  /* Le parcours guidé de fin de mois reste, ouvert par la carte « N mois */
  /* à clôturer ». La pastille de l'onglet Accueil garde le compte réel.  */
  /* Seul le compteur bas quitte cet écran : il vit désormais dans le     */
  /* repli « Réserves » de l'espace enfant, et se lit aussi dans « Vos    */
  /* réserves » de Mes congés et sur l'écran de pose, chiffré             */
  /* (décision d'Adrien du 24 août 2026).                                 */
  /* ------------------------------------------------------------------ */

  function afficherAccueil(ctx) {
    var m = global.App.moisCourant();
    var contrats = global.App.contrats();

    enTete(ctx.barre, m);

    if (!contrats.length) {
      etatVide(ctx.corps);
      return Promise.resolve();
    }

    ctx.corps.appendChild(Kit.ce('div', 'attente', 'Calcul de vos mois…'));

    return Promise.all(contrats.map(function (c) { return charger(c, m); }))
      .then(function (fiches) {
        Kit.vider(ctx.corps);

        /* V8-29 : UN SEUL message de panne, jamais un par contrat. Si tout a
           échoué, la cause est commune — le réseau, la session — et répéter
           quatre fois la même phrase ne fait qu'affoler. */
        var enEchec = fiches.filter(function (f) { return f.erreur; });
        if (enEchec.length === fiches.length) {
          /* Rien n'a pu être lu : la pastille est retirée plutôt que laissée
             à une valeur périmée. Un chiffre faux vaut moins que pas de
             chiffre — et l'écran des rappels ne promet plus l'inverse. */
          global.App.majPastilleAccueil(0);
          etatDePanne(ctx.corps, enEchec[0].erreur, function () { global.App.rafraichir(); });
          return;
        }

        rendreAujourdhui(ctx.corps, fiches, m);
        rendreContrats(ctx.corps, fiches, m);

        /* LOT 15 (A5) — la pastille est posée à partir de ce que l'accueil
           VIENT DE CALCULER : les mois en retard, plus le mois courant s'il
           est à clôturer. Aucun appel supplémentaire, aucune permission,
           aucun serveur. C'est le filet qui fonctionne quand les
           notifications ne fonctionnent pas. */
        global.App.majPastilleAccueil(compterAClôturer(fiches));
      });
  }

  /* Une fiche = tout ce que l'accueil doit savoir d'un contrat pour ce mois.
     Un contrat qui échoue n'efface pas les autres : il porte son erreur. */
  function charger(contrat, m) {
    var auj = global.App.aujourdhui();
    return Promise.all([
      global.App.serie(contrat, m),
      global.App.journees(contrat.id, m.annee, m.mois)
    ]).then(function (r) {
      var chaine = r[0];
      var journees = r[1];
      var entree = global.App.moisDe(chaine, m.annee, m.mois);
      return {
        contrat: contrat,
        entree: entree,
        journees: journees,
        travailles: Kit.joursTravailles(contrat, planningDe(entree), m.annee, m.mois, journees),
        etat: entree ? Kit.etatDuMois(m.annee, m.mois, entree.recap, auj) : null,
        restants: Kit.joursTravaillesRestants(contrat, planningDe(entree), m.annee, m.mois, auj, journees),
        retards: moisEnRetard(chaine, m, auj),
        /* §25.1 — LA FAMILIARISATION DU JOUR. Le moteur ne connaît pas la
           date du jour (module pur) : c'est ici, et ici seulement, qu'on
           croise son détail jour par jour avec l'horloge, lue une fois par
           `App.aujourdhui()`. */
        famDuJour: famDuJour(entree, m, auj),
        erreur: null
      };
    }).catch(function (e) {
      return {
        contrat: contrat, entree: null, journees: {}, travailles: [],
        etat: null, restants: 0, retards: [], famDuJour: null, erreur: e
      };
    });
  }

  /* Ce que la période de familiarisation attend AUJOURD'HUI, ou `null` :
     `{ jour, declare, minutes, rang, total }`. `rang` est la position du jour
     dans les jours ouvrés de la période — « jour 6 sur 10 » : c'est ce qui
     dit à Maria où elle en est de l'adaptation. */
  function famDuJour(entree, m, auj) {
    var fam = entree && entree.resultat && entree.resultat.familiarisation;
    if (!fam || !fam.actif) return null;
    if (!auj || auj.slice(0, 7) !== m.annee + '-' + String(m.mois).padStart(2, '0')) return null;

    var jours = fam.jours || [];
    var rang = 0;
    var trouve = null;
    for (var i = 0; i < jours.length; i++) {
      if (jours[i].jour === auj) { trouve = jours[i]; rang = i + 1; break; }
    }
    if (!trouve) return null;
    return {
      jour: auj,
      declare: !!trouve.declare,
      minutes: trouve.minutes || 0,
      entretien: !!trouve.entretien,
      rang: rang,
      total: jours.length,
      joursDeclares: fam.joursDeclares,
      minutesDeclarees: fam.minutesDeclarees
    };
  }

  /* Les mois ANTÉRIEURS au mois affiché qui ne sont pas clôturés, du plus
     ancien au plus récent. Un mois « avant initialisation » n'en est pas :
     il précède la reprise des comptes, il n'a jamais eu à être clôturé. */
  function moisEnRetard(chaine, m, auj) {
    var rangCourant = m.annee * 12 + m.mois;
    return (chaine.mois || []).filter(function (e) {
      if (e.annee * 12 + e.mois >= rangCourant) return false;
      if (e.avantInitialisation) return false;
      return Kit.etatDuMois(e.annee, e.mois, e.recap, auj) !== 'cloture';
    }).sort(function (a, b) {
      return (a.annee * 12 + a.mois) - (b.annee * 12 + b.mois);
    });
  }

  /* ------------------------------------------------------------------ */
  /* En-tête                                                             */
  /* ------------------------------------------------------------------ */

  /* §25.1 — « Bonjour Maria », puis LE MOIS EN TITRE D'ÉCRAN. La barre de
     progression du mois disparaît : elle mesurait le temps qui passe, pas ce
     qu'il y a à faire — et l'accueil ne parle plus que de ça.

     Le prénom vient du nom qui signe les documents (§16.2), jamais d'une
     constante : c'est le seul endroit où Maria l'a écrit. Sans lui, la barre
     dit simplement « Bonjour ». */
  function enTete(barre, m) {
    Kit.vider(barre);
    barre.className = 'hero';
    var nom = (global.App.nomEmettrice && global.App.nomEmettrice()) || null;
    barre.appendChild(Kit.ce('div', 'hi', nom ? 'Bonjour ' + nom : 'Bonjour'));
    barre.appendChild(Kit.ce('div', 'mo', Kit.moisCapitale(m.annee, m.mois)));
  }

  /* ------------------------------------------------------------------ */
  /* « Aujourd'hui » — une carte par geste, un appui pour le faire       */
  /* ------------------------------------------------------------------ */

  function rendreAujourdhui(corps, fiches, m) {
    corps.appendChild(Kit.section('Aujourd’hui'));
    var nb = 0;

    /* --- 1. LA FAMILIARISATION DU JOUR -------------------------------
       Elle passe en premier : c'est le seul geste qui ne peut pas être fait
       demain. Une journée non déclarée n'est payée par rien.

       §25.1 — la carte OUVRE LA FEUILLE DE DÉCLARATION DIRECTEMENT, sans
       passer par l'espace enfant. Une déclaration se corrige aussi : la
       carte reste tant qu'on est dans la période, en ton neutre une fois les
       heures posées. (ÉCART ASSUMÉ AU TEXTE du §25.1, conforme à la
       maquette : « présent seulement quand un geste est attendu » ferait
       disparaître la carte à la seconde où Maria a déclaré, et corriger une
       durée saisie de travers redemanderait quatre appuis.) */
    fiches.forEach(function (f) {
      if (f.erreur || !f.famDuJour) return;
      nb++;
      var fd = f.famDuJour;
      var c = f.contrat;
      corps.appendChild(Kit.carteTap(
        fd.declare
          ? c.prenom_enfant + ' — ' + Kit.heures(fd.minutes) + ' déclarées'
          : c.prenom_enfant + ' — heures à déclarer',
        'Familiarisation · jour ' + fd.rang + ' sur ' + fd.total,
        function () { global.UiEnfant.declarerFamiliarisation(c, fd.jour); },
        { avatar: Kit.avatar(c), classe: fd.declare ? '' : 'w' }));
    });

    /* --- 2. LES EMPÊCHEMENTS -----------------------------------------
       Ils passent avant toute proposition de clôture : proposer de clôturer
       un mois dont le salaire est inconnu, c'est proposer de figer un total
       amputé. Même ton orange qu'hier, même destination — la fiche. */
    fiches.forEach(function (f) {
      var c = f.contrat;
      if (f.erreur) {
        nb++;
        corps.appendChild(carteAujourdhui('!',
          'Le mois de ' + c.prenom_enfant + ' n’a pas pu être calculé',
          Kit.messageErreur(f.erreur), null));
        return;
      }
      if (!f.entree) return;                 // contrat hors de ce mois
      if (f.entree.salaireManquant) {
        nb++;
        corps.appendChild(carteAujourdhui('!',
          'Aucune rémunération connue pour ' + c.prenom_enfant,
          'Sans elle, le mois ne peut pas être clôturé.',
          function () { ouvrirFiche(c); }));
        return;
      }
      /* Un barème sans net n'est pas un barème manquant, et le mois se
         clôturerait avec un total amputé du salaire entier, définitivement. */
      if (!f.entree.resultat.salaireNetCentimes) {
        nb++;
        corps.appendChild(carteAujourdhui('!',
          'Le net de ' + c.prenom_enfant + ' n’est pas renseigné',
          'Son récapitulatif est incomplet tant qu’il manque.',
          function () { ouvrirFiche(c); }));
      }
    });

    /* --- 3. LES MOIS À CLÔTURER --------------------------------------
       Les mois échus non clôturés, puis le mois courant à partir du 25
       (V8-03 : avant, proposer la clôture reviendrait à inviter Maria à
       figer un mois dont elle ignore encore un tiers).

       AU-DELÀ D'UN SEUL MOIS, UNE SEULE CARTE : « N mois à clôturer »,
       qui ouvre le parcours guidé. Quatre contrats en retard de trois mois
       feraient douze cartes ; le §25.1 demande le parcours guidé dès qu'il y
       a plus d'un mois en retard, et c'est exactement pour ça. */
    var aCloturer = [];
    fiches.forEach(function (f) {
      if (f.erreur) return;
      f.retards.forEach(function (e) {
        aCloturer.push({ contrat: f.contrat, annee: e.annee, mois: e.mois, echu: true,
          /* LOT 30 (§30.4) — un mois rouvert rejoint « Aujourd'hui » au
             même titre qu'un mois échu, et la carte le dit. */
          rouvert: Kit.moisRouvert(e.recap) });
      });
    });
    fiches.forEach(function (f) {
      if (f.erreur || !f.entree) return;
      if (f.entree.salaireManquant || !f.entree.resultat.salaireNetCentimes) return;
      if (f.etat !== 'a_cloturer') return;
      aCloturer.push({ contrat: f.contrat, annee: m.annee, mois: m.mois, echu: false,
        rouvert: Kit.moisRouvert(f.entree.recap) });
    });
    aCloturer.sort(function (a, b) {
      return (a.annee * 12 + a.mois) - (b.annee * 12 + b.mois);
    });

    if (aCloturer.length >= SEUIL_PARCOURS_GUIDE) {
      nb++;
      corps.appendChild(carteAujourdhui('→',
        aCloturer.length + ' mois à clôturer',
        'Les passer en revue un par un, sans en oublier.',
        function () { global.App.aller('finDeMois', { liste: aCloturer }); }));
    } else if (aCloturer.length === 1) {
      nb++;
      var x = aCloturer[0];
      /* §25.1 — la carte OUVRE LE DOCUMENT : c'est là que la clôture se
         fait, et le document est ce qu'il faut relire avant de figer. */
      corps.appendChild(carteAujourdhui('!',
        Kit.moisCapitale(x.annee, x.mois).split(' ')[0] +
          ' à clôturer pour ' + x.contrat.prenom_enfant,
        x.rouvert
          ? 'Rouvert pour correction : à clôturer à nouveau.'
          : (x.echu
            ? 'Terminé depuis le ' + Kit.dateLongue(dernierJourDuMois(x.annee, x.mois)) + '.'
            : 'Vérifiez les journées, puis clôturez le mois.'),
        function () {
          global.App.aller('document', {
            contratId: x.contrat.id, annee: x.annee, mois: x.mois
          });
        }));
    }

    /* --- 4. RIEN À FAIRE --------------------------------------------- */
    if (nb === 0) {
      var r = Kit.ce('div', 'cd tap inerte');
      r.appendChild(Kit.ce('span', 'ic', '✓'));
      var g = Kit.ce('span', 'gr');
      g.appendChild(Kit.ce('span', 'n', 'Rien à clôturer'));
      g.appendChild(Kit.ce('span', 'd', 'Les mois terminés sont tous clôturés.'));
      r.appendChild(g);
      corps.appendChild(r);
    }
  }

  /* Une carte du bloc « Aujourd'hui » : une pastille de ton, un titre, un
     sous-texte, un chevron. Le ton orange dit qu'il y a quelque chose à
     faire ; le mot du titre le dit aussi, jamais la couleur seule (V8-01). */
  function carteAujourdhui(icone, titre, sous, onclick) {
    var classe = 'cd tap w' + (onclick ? '' : ' inerte');
    var b = onclick ? Kit.bouton(classe, onclick) : Kit.ce('div', classe);
    b.appendChild(Kit.ce('span', 'ic', icone));
    var g = Kit.ce('span', 'gr');
    g.appendChild(Kit.ce('span', 'n', titre));
    if (sous) g.appendChild(Kit.ce('span', 'd', sous));
    b.appendChild(g);
    if (onclick) b.appendChild(Kit.ce('span', 'ch', '›'));
    return b;
  }

  /* Le nombre de mois à clôturer, tous contrats confondus : les retards, plus
     le mois courant quand il a basculé (à partir du 25, lot 7). C'est
     exactement ce que compte la fonction serveur du lot 15 — et ce que dit la
     pastille. */
  function compterAClôturer(fiches) {
    var n = 0;
    fiches.forEach(function (f) {
      if (f.erreur) return;
      n += (f.retards || []).length;
      if (f.entree && f.etat === 'a_cloturer') n++;
    });
    return n;
  }

  function dernierJourDuMois(annee, mois) {
    return Kit.iso(annee, mois, Kit.nbJoursDansMois(annee, mois));
  }

  /* ------------------------------------------------------------------ */
  /* « Mes contrats » — une carte par contrat, RIEN D'AUTRE              */
  /* ------------------------------------------------------------------ */

  function rendreContrats(corps, fiches, m) {
    corps.appendChild(Kit.section('Mes contrats'));
    fiches.forEach(function (f) { corps.appendChild(carteContrat(f, m)); });
  }

  function carteContrat(f, m) {
    var c = f.contrat;
    return Kit.carteTap(c.prenom_enfant, sousTexte(f, m),
      function () { ouvrirEnfant(c, m); },
      { avatar: Kit.avatar(c), droite: pastilleContrat(f) });
  }

  /* Le sous-texte : « 14 j · 1 142,00 € » en garde ordinaire,
     « familiarisation · 8 h 30 déclarées » pendant l'adaptation. */
  function sousTexte(f, m) {
    if (f.erreur) return 'Chiffres indisponibles : ' + Kit.messageErreur(f.erreur);
    if (!f.entree) {
      return 'Ce contrat ne couvre pas ' + Kit.libelleMoisAnnee(m.annee, m.mois) + '.';
    }
    var r = f.entree.resultat;
    var fam = r.familiarisation;
    if (fam && fam.actif) {
      return 'familiarisation · ' + Kit.heures(fam.minutesDeclarees) + ' déclarées';
    }
    return Kit.jours(r.joursPresence) + ' · ' + Kit.eur(r.totalAVerserCentimes);
  }

  /* LA PASTILLE D'ÉTAT. Quatre états au lieu de trois : le §25.1 ajoute
     « à déclarer » (une journée de familiarisation attend) et « N mois en
     retard » (des mois échus ne sont pas clôturés) aux trois mots
     historiques — en cours, à clôturer, clôturé (V8-01).

     L'ordre est celui de l'urgence : un retard prime sur tout, une
     déclaration du jour prime sur l'état du mois courant. Le MOT est toujours
     écrit : la couleur ne porte jamais le sens toute seule (V8-05). */
  function pastilleContrat(f) {
    if (f.erreur) return Kit.pill('g', 'indisponible');
    if (!f.entree) return Kit.pill('g', 'hors contrat');
    if (f.retards.length) {
      return Kit.pill('w', f.retards.length === 1
        ? '1 mois en retard'
        : f.retards.length + ' mois en retard');
    }
    if (f.famDuJour && !f.famDuJour.declare) return Kit.pill('w', 'à déclarer');
    if (f.etat === 'cloture') return Kit.pill('', 'clôturé');
    if (f.etat === 'a_cloturer') return Kit.pill('w', 'à clôturer');
    return Kit.pill('', 'en cours');
  }

  /* ------------------------------------------------------------------ */
  /* État vide (V8-29)                                                   */
  /* ------------------------------------------------------------------ */

  function etatVide(corps) {
    var b = Kit.ce('div', 'vide-accueil');
    b.appendChild(Kit.ce('h2', null, 'Bienvenue'));
    b.appendChild(Kit.ce('p', null,
      'Cette application tient vos comptes mois par mois : jours de présence, ' +
      'indemnités d’entretien, heures supplémentaires et congés, pour chaque ' +
      'enfant que vous gardez.'));
    b.appendChild(Kit.ce('p', null,
      'À la fin de chaque mois, elle prépare le récapitulatif à remettre aux familles.'));
    b.appendChild(boutonTexte('btn', 'Ajouter mon premier enfant', function () {
      /* B5 : la feuille de création, pas la fiche d'un contrat qui n'existe
         pas encore. `aller('fiche', {})` menait à « contrat introuvable ». */
      global.UiMenu.nouvelEnfant();
    }));
    corps.appendChild(b);
  }

  /* ------------------------------------------------------------------ */
  /* État de panne (V8-29) — UN message, jamais un par contrat           */
  /* ------------------------------------------------------------------ */

  function etatDePanne(corps, erreur, reessayer) {
    var b = Kit.ce('div', 'panne');
    b.appendChild(Kit.ce('h2', null, 'Impossible de charger vos contrats.'));
    b.appendChild(Kit.ce('p', null, 'Vérifiez votre connexion, puis réessayez.'));
    /* La cause technique reste lisible pour qui la cherche, en petit, sous la
       phrase simple. On ne la cache pas : « ne jamais avaler une erreur ». */
    b.appendChild(Kit.ce('p', 'q', Kit.messageErreur(erreur)));
    b.appendChild(boutonTexte('btn', 'Réessayer', reessayer));
    corps.appendChild(b);
  }

  /* ------------------------------------------------------------------ */
  /* 2. Fin de mois guidée (§6.7, V8-32) — inchangée par le lot 25                                 */
  /*                                                                     */
  /* Les clôtures s'enchaînent, UNE PAR ÉCRAN, avec une décision          */
  /* unitaire à chaque fois. Aucune clôture en lot, aucune case « tout    */
  /* clôturer » : quatre mois clôturés d'un geste, c'est quatre           */
  /* documents figés que personne n'a lus.                                */
  /* ------------------------------------------------------------------ */

  var parcours = null;   // { liste, index, faits: [], passes: [] }

  function afficherFinDeMois(ctx) {
    var liste = (ctx.params && ctx.params.liste) || [];
    if (!parcours || parcours.liste !== liste) {
      parcours = { liste: liste, index: 0, faits: [], passes: [] };
    }
    if (!liste.length) {
      global.App.aller('accueil', {}, true);
      return Promise.resolve();
    }
    return rendreEtape(ctx);
  }

  function rendreEtape(ctx) {
    Kit.vider(ctx.corps);
    Kit.vider(ctx.barre);
    ctx.barre.className = '';
    ctx.barre.appendChild(Kit.ce('div', 'ti', 'Fin de mois'));

    if (parcours.index >= parcours.liste.length) {
      barreEtapes(ctx.corps);
      rendreFin(ctx.corps);
      return Promise.resolve();
    }

    var cible = parcours.liste[parcours.index];
    barreEtapes(ctx.corps);
    ctx.corps.appendChild(Kit.ce('div', 'attente', 'Calcul du mois…'));

    return Promise.all([
      global.App.serie(cible.contrat, { annee: cible.annee, mois: cible.mois }),
      /* A3 : les journées du mois, pour que l'avertissement V8-04 ne compte pas
         comme « encore à venir » des jours déjà posés en congé. */
      global.App.journees(cible.contrat.id, cible.annee, cible.mois)
        .catch(function () { return null; })
    ])
      .then(function (r) {
        var chaine = r[0];
        var journeesDuMois = r[1];
        var entree = global.App.moisDe(chaine, cible.annee, cible.mois);
        if (entree) entree.journees = journeesDuMois;
        Kit.vider(ctx.corps);
        barreEtapes(ctx.corps);
        rendreRecapEnLecture(ctx, cible, entree);
      })
      .catch(function (e) {
        Kit.vider(ctx.corps);
        barreEtapes(ctx.corps);
        ctx.corps.appendChild(Kit.warnbox(
          'Le mois de ' + cible.contrat.prenom_enfant + ' n’a pas pu être calculé',
          Kit.messageErreur(e) + ' Rien n’a été clôturé.'));
        boutonsEtape(ctx, cible, null);
      });
  }

  /* « Léa · Noah · Jade · Tom », l'étape courante en évidence, les faites
     cochées. Maria voit où elle en est sans compter.

     Le prénom NE SUFFIT PAS toujours : quand plusieurs mois sont en retard, le
     même enfant revient plusieurs fois et deux pastilles « Léa » ne se
     distinguent plus. Dans ce cas seulement, le mois est ajouté. On ne
     l'ajoute pas systématiquement : « Léa · Noah · Jade · Tom » se lit d'un
     coup d'œil, « Léa juil. · Léa août · Noah juil. » non. */
  function barreEtapes(corps) {
    var b = Kit.ce('div', 'etapes');
    var plusieursMois = parcours.liste.some(function (x) {
      return x.annee !== parcours.liste[0].annee || x.mois !== parcours.liste[0].mois;
    });
    parcours.liste.forEach(function (x, i) {
      var classe = 'et';
      if (i < parcours.index) classe += parcours.passes.indexOf(i) !== -1 ? ' passe' : ' fait';
      if (i === parcours.index) classe += ' on';
      var e = Kit.ce('span', classe);
      if (i < parcours.index && parcours.passes.indexOf(i) === -1) {
        e.appendChild(Kit.ce('span', 'ck', '✓'));
      }
      e.appendChild(Kit.avatar(x.contrat, 'pt'));
      e.appendChild(Kit.ce('span', null, x.contrat.prenom_enfant +
        (plusieursMois ? ' ' + Kit.MOIS_COURT[x.mois] : '')));
      b.appendChild(e);
    });
    corps.appendChild(b);
  }

  function rendreRecapEnLecture(ctx, cible, entree) {
    var c = cible.contrat;
    corpsTitre(ctx.corps,
      Kit.moisCapitale(cible.annee, cible.mois) + ' — ' + c.prenom_enfant,
      'Famille ' + ((c.famille && c.famille.nom) || '—'));

    if (!entree) {
      ctx.corps.appendChild(Kit.warnbox('Rien à clôturer ici',
        'Ce contrat ne couvre pas ' + Kit.libelleMoisAnnee(cible.annee, cible.mois) + '.'));
      boutonsEtape(ctx, cible, null);
      return;
    }

    var r = entree.resultat;
    var p = Kit.pane('Le mois de ' + c.prenom_enfant);
    var lignes = Kit.lines(p);
    Kit.ligne(lignes, 'Jours de présence', Kit.jours(r.joursPresence));
    Kit.ligne(lignes, 'Indemnité d’entretien', Kit.eur(r.entretienCentimes));
    /* CORRECTION B4 — le net dû, pas le net contractuel. C'est l'écran qui
       précède immédiatement la clôture : y annoncer un montant que le document
       contredira dix secondes plus tard est le pire endroit pour le faire. */
    Kit.ligne(lignes, 'Salaire net', Kit.eur(Chaine.netDuMois(r)));
    var partiel = Chaine.proratOuNull(r);
    if (partiel) {
      Kit.ligne(lignes, 'Mois partiel — ' + partiel.joursCouverts + ' jours de garde sur ' +
        partiel.joursDuMois + ' au contrat', '', { discret: true });
    }
    /* LOT 28 (§28.4) — LA PART DE FAMILIARISATION, SUR L'ÉCRAN QUI PRÉCÈDE
       LA CLÔTURE. Le net et l'entretien ci-dessus sont ceux de la garde
       mensualisée ; le total ajoute la familiarisation. Sans ces deux lignes,
       les lignes ne reconstituaient pas le total — 164,70 € invisibles. */
    var fam = Chaine.partFamiliarisation(r);
    if (fam.actif) {
      Kit.ligne(lignes, 'Familiarisation — heures déclarées', Kit.eur(fam.netCentimes));
      Kit.ligne(lignes, 'Familiarisation — indemnité d’entretien', Kit.eur(fam.entretienCentimes));
    }
    if (r.retenueSansSoldeCentimes > 0) {
      Kit.ligne(lignes, 'Retenue pour jour(s) sans solde', '− ' + Kit.eur(r.retenueSansSoldeCentimes));
    }
    Kit.ligne(lignes, 'Heures supplémentaires du mois', Kit.heures(r.minutesSupAcquises));
    Kit.ligne(lignes, 'Total à verser', Kit.eur(r.totalAVerserCentimes), { total: true });
    ctx.corps.appendChild(p);

    /* A3 : les journées du mois, pour ne pas compter comme « à venir » des
       jours déjà posés en congé. Le chiffre sert à mesurer ce qu'on perd en
       clôturant tôt : faux, il dit le contraire de ce qu'il doit dire. */
    var restants = Kit.joursTravaillesRestants(c, planningDe(entree && entree.entree),
      cible.annee, cible.mois,
      global.App.aujourdhui(), (entree && entree.journees) || null);
    if (restants > 0) {
      ctx.corps.appendChild(Kit.warnbox(
        restants + (restants > 1 ? ' jours travaillés sont encore à venir' : ' jour travaillé est encore à venir') +
          ' en ' + Kit.libelleMois(cible.mois) + '.',
        ' Si vous clôturez maintenant, ' +
        (restants > 1 ? 'ces journées ne seront pas comptées.' : 'cette journée ne sera pas comptée.')));
    }
    boutonsEtape(ctx, cible, entree);
  }

  function corpsTitre(corps, titre, sous) {
    var t = Kit.ce('div', 'etape-tt');
    t.appendChild(Kit.ce('div', 'tt', titre));
    if (sous) t.appendChild(Kit.ce('div', 'ss', sous));
    corps.appendChild(t);
  }

  function boutonsEtape(ctx, cible, entree) {
    var actions = Kit.ce('div', 'actions');


    /* LOT 16 §16.1 c) — DANS LA FIN DE MOIS GUIDÉE AUSSI. Un mois dont une
       répartition ne tient plus ne se clôture pas : son étape ne propose que
       « Passer pour l'instant », et le chemin pour corriger. Sans ce garde, le
       parcours guidé restait la porte par laquelle un document que Maria n'a
       pas choisi pouvait être figé — et un mois figé ne se recalcule jamais. */
    var bloque = !!(entree && (entree.imputationsEcartees || []).length);
    if (bloque) {
      var e0 = entree.imputationsEcartees[0];
      ctx.corps.appendChild(Kit.warnbox(
        'Corrigez d’abord la répartition du congé de ' + cible.contrat.prenom_enfant,
        ' Du ' + Kit.dateLongue(e0.date_debut) + ' au ' + Kit.dateLongue(e0.date_fin) +
        ', les jours ne sont pas répartis sur des réserves suffisantes. Ce mois ne ' +
        'peut pas être clôturé tant que ce n’est pas corrigé.'));
      actions.appendChild(boutonTexte('btn', 'Corriger la répartition', function () {
        parcours = null;
        global.App.aller('conges', {
          annee: cible.annee, mois: cible.mois, corrigerImputation: e0.id
        }, true);
      }));
    }

    if (!bloque && entree && !entree.salaireManquant && entree.resultat.salaireNetCentimes) {
      actions.appendChild(boutonTexte('btn pr', 'Clôturer et continuer', function (ev) {
        cloturerEtape(ctx, cible, entree, ev && ev.currentTarget);
      }));
    }

    /* LOT 18 §18.2 — RELIRE AVANT DE CLÔTURER.

       L'étape guidée montre cinq lignes de chiffres ; le document remis à la
       famille en porte bien davantage — les congés du mois, les compteurs du
       contrat, l'encart qui explique le décompte en jours ouvrables. On ne
       fige pas un document qu'on n'a pas pu relire, et la clôture est le seul
       geste de l'application qu'on ne défait pas sans laisser de trace.

       La navigation EMPILE l'écran du document : le retour ramène à cette
       étape, au même rang, parce que la pile conserve les paramètres du
       parcours. Rien n'est perdu, rien n'est clôturé au passage. */
    if (entree) {
      actions.appendChild(boutonTexte('btn nt', 'Voir le récapitulatif complet', function () {
        global.App.aller('document', {
          contratId: cible.contrat.id, annee: cible.annee, mois: cible.mois
        });
      }));
    }

    actions.appendChild(boutonTexte('btn', 'Passer pour l’instant', function () {
      parcours.passes.push(parcours.index);
      parcours.index++;
      rendreEtape(ctx);
    }));

    actions.appendChild(boutonTexte('btn nt', 'Arrêter ici', function () {
      /* « Arrêter ici » CONSERVE ce qui a déjà été clôturé. Rien n'est
         défait : une clôture faite est une clôture faite. */
      parcours = null;
      global.App.aller('accueil', {}, true);
    }));

    ctx.corps.appendChild(actions);
  }

  /* CORRECTIF B4 DE LA RELECTURE PR9.

     Ce chemin envoyait `entree.resultat` BRUT — le résultat du moteur, sans
     rien de ce que le moteur ne connaît pas. L'écran document, lui, enrichit :
     prénom et nom de famille figés, date d'effet du barème, jours de congé
     datés. Deux chemins de clôture, deux instantanés différents.

     Un mois clôturé ici perdait donc son identité figée : renommer l'enfant ou
     le foyer réécrivait un document déjà remis aux parents. Le constructeur
     est désormais unique et partagé (`UiDocument.construireInstantane`), et il
     lui faut les journées du mois — d'où la lecture ci-dessous, servie par le
     cache de `App.journees`. */
  function cloturerEtape(ctx, cible, entree, bouton) {
    if (bouton) { bouton.disabled = true; bouton.textContent = 'Clôture…'; }
    return global.App.journees(cible.contrat.id, cible.annee, cible.mois)
      .then(function (journees) {
        return global.UiDocument.construireInstantane({
          entree: entree, contrat: cible.contrat, journees: journees || {},
          annee: cible.annee, mois: cible.mois
        });
      })
      .then(function (donnees) {
        /* LOT 30 (§30.5) — LA RECLÔTURE MONTRE CE QUI A CHANGÉ, PAR CE CHEMIN
           AUSSI. Le document le faisait ; la fin de mois guidée écrivait
           directement. Un mois rouvert reclôturé ici sans voir ses écarts,
           c'est un document déjà remis qui change en silence. La comparaison
           est celle de `chaine-mois.js`, pure et testée. */
        var ecarts = global.UiReouverture
          ? global.UiReouverture.ecarts(entree.recap, donnees) : [];
        if (!ecarts.length) return donnees;
        return new Promise(function (resoudre, rejeter) {
          global.UiReouverture.feuilleEcarts({
            contrat: cible.contrat, annee: cible.annee, mois: cible.mois,
            recap: entree.recap, ecarts: ecarts,
            minutesParJourConge: (entree.conditions && entree.conditions.minutes_par_jour_conge) || 0,
            confirmer: function (b) { if (b) b.disabled = true; Kit.fermerFeuille(); resoudre(donnees); }
          });
          /* La feuille se ferme sans confirmer (« Annuler », ou un appui à
             côté) : on ne clôture pas, et le bouton de l'étape redevient
             utilisable. La fermeture se voit sur l'attribut `hidden` du
             conteneur — c'est le seul signal que la feuille émet. */
          var wrap = document.getElementById('sheetwrap');
          if (!wrap || typeof MutationObserver === 'undefined') return;
          var obs = new MutationObserver(function () {
            if (wrap.hidden) { obs.disconnect(); rejeter({ annule: true }); }
          });
          obs.observe(wrap, { attributes: true, attributeFilter: ['hidden'] });
        });
      })
      .then(function (donnees) {
        return global.DB.recloturerRecap(cible.contrat.id, cible.annee, cible.mois, donnees);
      })
      .then(function (r) {
        global.App.invalider();
        if (r === null) {
          /* Déjà clôturé ailleurs, depuis un autre appareil. Ce n'est pas un
             échec : l'objectif est atteint. On le dit et on continue. */
          Kit.toast(Kit.moisCapitale(cible.annee, cible.mois) +
            ' était déjà clôturé pour ' + cible.contrat.prenom_enfant + '.');
        } else {
          Kit.toast(Kit.moisCapitale(cible.annee, cible.mois) +
            ' est clôturé pour ' + cible.contrat.prenom_enfant + '.');
        }
        parcours.faits.push(parcours.index);
        parcours.index++;
        return rendreEtape(ctx);
      })
      .catch(function (e) {
        /* B.0-9 : l'échec est visible, et il dit ce qui reste vrai. */
        if (bouton) { bouton.disabled = false; bouton.textContent = 'Clôturer et continuer'; }
        if (e && e.annule) {
          Kit.toast('Clôture annulée : le mois reste ouvert.');
          return;
        }
        Kit.toast('Ce mois n’a pas été clôturé. ' + Kit.messageErreur(e) +
          ' Vous pouvez réessayer.', true);
      });
  }

  function rendreFin(corps) {
    var faits = parcours.faits.length;
    var total = parcours.liste.length;
    corpsTitre(corps, faits + ' mois clôturé' + (faits > 1 ? 's' : '') + ' sur ' + total, null);

    if (parcours.passes.length) {
      var noms = parcours.passes.map(function (i) {
        return parcours.liste[i].contrat.prenom_enfant;
      });
      corps.appendChild(Kit.ce('p', null,
        'Vous avez passé le mois de ' + liste(noms) + '. ' +
        'Vous pourrez ' + (noms.length > 1 ? 'les' : 'le') +
        ' clôturer plus tard depuis l’accueil.'));
    }

    var actions = Kit.ce('div', 'actions');
    actions.appendChild(boutonTexte('btn pr', 'Revenir à l’accueil', function () {
      parcours = null;
      global.App.aller('accueil', {}, true);
    }));
    corps.appendChild(actions);
  }

  function liste(noms) {
    if (noms.length === 1) return noms[0];
    return noms.slice(0, -1).join(', ') + ' et ' + noms[noms.length - 1];
  }

  function ouvrirEnfant(contrat, m) {
    global.App.aller('enfant', { contratId: contrat.id, annee: m.annee, mois: m.mois });
  }
  function ouvrirFiche(contrat) {
    global.App.aller('fiche', contrat ? { contratId: contrat.id } : {});
  }

  global.UiAccueil = { afficher: afficher };
})(window);
