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

    enTete(ctx.barre, m, null);

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

        /* L'en-tête est REDESSINÉ ici : sa ligne de contexte annonce ce qui
           reste à déclarer aujourd'hui, et ce décompte n'est connu qu'une fois
           les mois calculés. Le premier appel, plus haut, n'existe que pour ne
           pas laisser un bandeau vide pendant le calcul. */
        enTete(ctx.barre, m, fiches);
        rendreAlertes(ctx.corps, fiches, m);
        rendreCartes(ctx.corps, fiches, m);
        rendrePied(ctx.corps, fiches, m);

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
        /* LOT 31 (§3.2) — LES MOIS OÙ UNE PÉRIODE DE CONGÉ A DISPARU.
           Même portée que les retards : toute la chaîne rejouée, pas
           seulement le mois affiché. Une décision perdue en mai ne doit pas
           attendre que Maria rouvre mai pour se voir. */
        orphelines: moisAvecOrphelines(chaine),
        erreur: null
      };
    }).catch(function (e) {
      return {
        contrat: contrat, entree: null, journees: {}, travailles: [],
        etat: null, restants: 0, retards: [], famDuJour: null, orphelines: [],
        erreur: e
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

  /* LOT 31 (§3.2) — les mois de la chaîne qui portent au moins une
     imputation ne recouvrant aucune journée de congé, du plus ancien au plus
     récent. Vide dans l'immense majorité des cas. */
  function moisAvecOrphelines(chaine) {
    return (chaine.mois || []).filter(function (e) {
      return (e.imputationsOrphelines || []).length > 0;
    }).sort(function (a, b) {
      return (a.annee * 12 + a.mois) - (b.annee * 12 + b.mois);
    });
  }

  /* ------------------------------------------------------------------ */
  /* REDESIGN 2A §3 — L'ACCUEIL « MES ENFANTS »                          */
  /* ------------------------------------------------------------------ */

  /* CE QUI CHANGE, ET POURQUOI.

     L'accueil du lot 25 était fait de DEUX listes : « Aujourd'hui », une carte
     par geste attendu, puis « Mes contrats », une carte par enfant. Maria
     devait donc lire deux fois la même liste d'enfants, et le geste le plus
     fréquent de sa journée — déclarer ce qui sort de l'ordinaire — se trouvait
     tantôt en haut, tantôt en bas.

     Le 2A n'a plus qu'UNE liste : une carte par enfant, à TROIS ÉTAGES, dont
     chacun mène ailleurs.

       étage 1 — l'identité   → l'espace de l'enfant, sur le mois en cours
       étage 2 — la journée   → la feuille du jour, pour AUJOURD'HUI
       étage 3 — les compteurs → le détail de ses soldes

     L'étage 2 est le cœur du redesign : « un seul appui depuis l'ouverture de
     l'application » (§3.2).

     CE QUI NE DISPARAÎT PAS. Les cartes d'ALERTE du bloc « Aujourd'hui » —
     salaire manquant, période de congé sans journée, mois à clôturer —
     remontent AU-DESSUS des cartes. La maquette n'en montre aucune parce que
     son jeu de données n'en contient pas ; le §9.4 de la spécification, lui,
     est formel : « une imputation devenue incohérente est écartée, pas
     recalculée — mais l'interface doit LE DIRE ». Les faire disparaître au nom
     de la fidélité à la maquette serait la régression que le §9 interdit.

     Ce qui disparaît, en revanche : la carte « familiarisation du jour » (elle
     EST l'étage 2, désormais) et la carte « Rien à clôturer » (c'est la ligne
     de contexte de l'en-tête qui le dit). */

  /* ------------------------------------------------------------------ */
  /* En-tête (§3.1)                                                      */
  /* ------------------------------------------------------------------ */

  /* Trois lignes : la salutation, le titre de l'écran, et CE QUI RESTE À
     FAIRE aujourd'hui. Le décompte est calculé — jamais écrit en dur — et
     quand il n'y a rien, la ligne le dit plutôt que de se taire.

     Le prénom vient du nom qui signe les documents (§16.2), jamais d'une
     constante : c'est le seul endroit où Maria l'a écrit. Sans lui, la barre
     dit simplement « Bonjour ». */
  function enTete(barre, m, fiches) {
    Kit.vider(barre);
    barre.className = 'top';
    var nom = (global.App.nomEmettrice && global.App.nomEmettrice()) || null;
    barre.appendChild(Kit.ce('div', 'hi', nom ? 'Bonjour ' + nom : 'Bonjour'));
    barre.appendChild(Kit.ce('h1', null, 'Mes enfants'));
    barre.appendChild(Kit.ce('div', 'sub', ligneDeContexte(m, fiches)));
  }

  /* « Vendredi 28 août — 1 journée à déclarer ». */
  function ligneDeContexte(m, fiches) {
    var auj = global.App.aujourdhui();
    var date = auj ? Kit.jourLong(auj) : Kit.moisCapitale(m.annee, m.mois);
    if (!fiches) return date;
    var n = aDeclarerAujourdhui(fiches);
    if (!n) return date + ' — rien à déclarer';
    return date + ' — ' + n + ' journée' + (n > 1 ? 's' : '') + ' à déclarer';
  }

  /* Ce qui attend une SAISIE aujourd'hui, et rien d'autre. Une journée de
     familiarisation non déclarée n'est payée par rien : c'est le seul geste
     qui ne peut pas être fait demain. */
  function aDeclarerAujourdhui(fiches) {
    var n = 0;
    fiches.forEach(function (f) {
      if (f.erreur) return;
      if (f.famDuJour && !f.famDuJour.declare) n++;
    });
    return n;
  }

  /* ------------------------------------------------------------------ */
  /* Les alertes — ce qui empêche de clôturer, et le dit                 */
  /* ------------------------------------------------------------------ */

  function rendreAlertes(corps, fiches, m) {
    /* --- 1. LES EMPÊCHEMENTS -----------------------------------------
       Ils passent avant toute proposition de clôture : proposer de clôturer
       un mois dont le salaire est inconnu, c'est proposer de figer un total
       amputé. */
    fiches.forEach(function (f) {
      var c = f.contrat;
      if (f.erreur) {
        corps.appendChild(carteAlerte(
          'Le mois de ' + c.prenom_enfant + ' n’a pas pu être calculé',
          Kit.messageErreur(f.erreur), null));
        return;
      }
      if (!f.entree) return;                 // contrat hors de ce mois
      if (f.entree.salaireManquant) {
        corps.appendChild(carteAlerte(
          'Aucune rémunération connue pour ' + c.prenom_enfant,
          'Sans elle, le mois ne peut pas être clôturé.',
          function () { ouvrirFiche(c); }));
        return;
      }
      /* Un barème sans net n'est pas un barème manquant, et le mois se
         clôturerait avec un total amputé du salaire entier, définitivement. */
      if (!f.entree.resultat.salaireNetCentimes) {
        corps.appendChild(carteAlerte(
          'Le net de ' + c.prenom_enfant + ' n’est pas renseigné',
          'Son récapitulatif est incomplet tant qu’il manque.',
          function () { ouvrirFiche(c); }));
      }
    });

    /* --- 2. LES PÉRIODES DE CONGÉ SANS AUCUNE JOURNÉE -----------------
       LOT 31 (§3.2), protégé par le §9.4 du redesign. Une entrée PAR MOIS
       concerné, qui mène au récapitulatif — là où la période est nommée et
       où le retrait se fait. */
    fiches.forEach(function (f) {
      if (f.erreur) return;
      (f.orphelines || []).forEach(function (e) {
        var n = (e.imputationsOrphelines || []).length;
        corps.appendChild(carteAlerte(
          Kit.moisCapitale(e.annee, e.mois).split(' ')[0] + ' — ' +
            (n > 1 ? n + ' périodes de congé n’ont' : 'une période de congé n’a') +
            ' plus aucune journée',
          'Chez ' + f.contrat.prenom_enfant + ' : la répartition existe, les ' +
          'journées non. À retirer ou à reposer avant de clôturer.',
          function () {
            global.App.aller('document', {
              contratId: f.contrat.id, annee: e.annee, mois: e.mois
            });
          }));
      });
    });

    /* --- 3. LES MOIS À CLÔTURER --------------------------------------
       Les mois ÉCHUS non clôturés, PUIS le mois courant à partir du 25
       (V8-03 : avant, proposer la clôture reviendrait à inviter Maria à
       figer un mois dont elle ignore encore un tiers).

       POURQUOI CETTE CARTE RESTE, alors que le §3.4 donne au pied un bouton
       « Clôturer le mois de <mois> » : les deux ne disent pas la même chose.
       Le bouton du pied est un GESTE que Maria décide ; la carte est un
       SIGNAL qui nomme l'enfant et le mois, et qui distingue un mois ÉCHU
       (« Terminé depuis le 31 juil. ») d'un mois qui COURT ENCORE
       (« Vérifiez les journées, puis clôturez »). Cette distinction a été
       gagnée au lot 18 contre un bandeau qui affirmait « ce mois est
       terminé » du 25 au 31 d'un mois en cours. La perdre au nom de la
       fidélité à une maquette dont le jeu de données ne montre pas le cas
       serait la régression que le §9 interdit.

       AU-DELÀ D'UN SEUL MOIS, UNE SEULE CARTE : quatre contrats en retard de
       trois mois feraient douze cartes. Le §25.1 demande le parcours guidé
       dès qu'il y a plus d'un mois en retard, et c'est exactement pour ça. */
    var aCloturer = [];
    fiches.forEach(function (f) {
      if (f.erreur) return;
      f.retards.forEach(function (e) {
        aCloturer.push({ contrat: f.contrat, annee: e.annee, mois: e.mois, echu: true,
          /* LOT 30 (§30.4) — un mois rouvert rejoint les retards au même
             titre qu'un mois échu, et la carte le dit. */
          rouvert: Kit.moisRouvert(e.recap) });
      });
    });
    fiches.forEach(function (f) {
      if (f.erreur || !f.entree) return;
      if (f.entree.salaireManquant || !f.entree.resultat.salaireNetCentimes) return;
      if (f.etat !== 'a_cloturer') return;      // garde V8-03
      aCloturer.push({ contrat: f.contrat, annee: m.annee, mois: m.mois, echu: false,
        rouvert: Kit.moisRouvert(f.entree.recap) });
    });
    aCloturer.sort(function (a, b) {
      return (a.annee * 12 + a.mois) - (b.annee * 12 + b.mois);
    });

    if (aCloturer.length >= SEUIL_PARCOURS_GUIDE) {
      corps.appendChild(carteAlerte(
        aCloturer.length + ' mois à clôturer',
        'Les passer en revue un par un, sans en oublier.',
        function () { global.App.aller('finDeMois', { liste: aCloturer }); }));
    } else if (aCloturer.length === 1) {
      var x = aCloturer[0];
      corps.appendChild(carteAlerte(
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
  }

  /* Une carte d'alerte : ton ambre, un titre qui DIT le problème, un
     sous-texte qui dit quoi faire. Le mot porte le sens, jamais la couleur
     seule (V8-01). */
  function carteAlerte(titre, sous, onclick) {
    var b = onclick ? Kit.bouton('card tap warn', onclick) : Kit.ce('div', 'card warn');
    b.appendChild(Kit.ce('span', 'ico', '!'));
    var g = Kit.ce('span', 'gro');
    g.appendChild(Kit.ce('span', 'nm', titre));
    if (sous) g.appendChild(Kit.ce('span', 'dt', sous));
    b.appendChild(g);
    if (onclick) b.appendChild(Kit.ce('span', 'chev', '›'));
    return b;
  }

  /* Le nombre de mois à clôturer, tous contrats confondus : les retards, plus
     le mois courant quand il a basculé (à partir du 25, lot 7). C'est
     exactement ce que compte la fonction serveur du lot 15 — et ce que dit la
     pastille de l'onglet, le filet qui fonctionne quand les notifications ne
     fonctionnent pas. */
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
  /* Les cartes à trois étages (§3.2)                                    */
  /* ------------------------------------------------------------------ */

  function rendreCartes(corps, fiches, m) {
    fiches.forEach(function (f) {
      corps.appendChild(carteEnfant(f, m));
    });
  }

  function carteEnfant(f, m) {
    var c = f.contrat;
    var carte = Kit.ce('div', 'card cart3');
    carte.appendChild(etageIdentite(c, m));
    carte.appendChild(etageJournee(f));
    carte.appendChild(etageCompteurs(f, m));
    return carte;
  }

  /* ÉTAGE 1 — l'identité. Pastille, prénom, « famille X », chevron. */
  function etageIdentite(c, m) {
    var b = Kit.bouton('card tap etg1', function () { ouvrirEnfant(c, m); });
    b.appendChild(Kit.avatar(c));
    var g = Kit.ce('span', 'gro');
    g.appendChild(Kit.ce('span', 'nm', c.prenom_enfant));
    g.appendChild(Kit.ce('span', 'dt', 'famille ' + nomFamille(c)));
    b.appendChild(g);
    b.appendChild(Kit.ce('span', 'chev', '›'));
    return b;
  }

  function nomFamille(c) {
    return (c.famille && c.famille.nom) || '—';
  }

  /* ÉTAGE 2 — LA JOURNÉE DU JOUR, ET SON GESTE.

     C'est le cœur du redesign : le geste le plus fréquent de la journée doit
     coûter UN SEUL APPUI depuis l'ouverture de l'application. Le bouton ouvre
     la feuille du jour de cet enfant, pour aujourd'hui — via l'espace enfant,
     qui la porte déjà et qui sait aiguiller vers la bonne feuille (période de
     familiarisation, jour en congé, mois clôturé à rouvrir).

     La phrase et le ton suivent le tableau du §3.2, situation par situation.
     Le ton ambre ne dit jamais rien tout seul : le mot le dit aussi. */
  function etageJournee(f) {
    var etat = etatDuJour(f);
    var e2 = Kit.ce('div', 'etg2' + (etat.ton ? ' w' : ''));
    e2.appendChild(Kit.ce('span', 'e2t', etat.phrase));
    var b = Kit.bouton('btn sm nt', function () { ouvrirJourDuJour(f); });
    b.textContent = etat.bouton;
    e2.appendChild(b);
    return e2;
  }

  /* Les six situations du §3.2, dans l'ordre où elles priment. */
  function etatDuJour(f) {
    var c = f.contrat;
    var auj = global.App.aujourdhui();

    if (f.famDuJour) {
      return f.famDuJour.declare
        ? { phrase: 'Familiarisation — ' + Kit.heures(f.famDuJour.minutes) + ' déclarées',
            bouton: 'Corriger', ton: '' }
        : { phrase: 'Familiarisation — à déclarer', bouton: 'Corriger', ton: 'w' };
    }

    var ligne = (f.journees || {})[auj];
    if (!ligne) return { phrase: 'Aujourd’hui : rien à faire', bouton: 'Déclarer', ton: '' };

    var type = ligne.type;
    if (type === 'absence_enfant') {
      return { phrase: 'Aujourd’hui : ' + Kit.accordDe(c, 'absent'),
               bouton: 'Corriger', ton: 'w' };
    }
    if (type === 'conge_maria' || type === 'sans_solde') {
      return { phrase: 'Aujourd’hui : vous êtes en congé', bouton: 'Corriger', ton: '' };
    }
    if (type === 'hors_planning') {
      return { phrase: 'Aujourd’hui : journée non travaillée', bouton: 'Corriger', ton: '' };
    }
    /* « Aujourd'hui : parti à 17 h 30 » du §3.2. L'application ne stocke pas
       une « heure de départ » : elle stocke un ÉCART D'HORAIRE nommé
       (`ecart_evenement`) et l'heure réelle qui l'accompagne. Les trois
       événements du schéma sont dits dans les mots de Maria. */
    var heure = heureDuJour(ligne.ecart_heure_reelle);
    if (ligne.ecart_evenement === 'liberation_anticipee' && heure) {
      return { phrase: 'Aujourd’hui : ' + Kit.accordDe(c, 'parti') + ' à ' + heure,
               bouton: 'Corriger', ton: '' };
    }
    if (ligne.ecart_evenement === 'retard_parent' && heure) {
      return { phrase: 'Aujourd’hui : ' + Kit.accordDe(c, 'parti') + ' à ' + heure +
                       ' — parent en retard', bouton: 'Corriger', ton: '' };
    }
    if (ligne.ecart_evenement === 'arrivee_decalee' && heure) {
      return { phrase: 'Aujourd’hui : ' + Kit.accordDe(c, 'arrivé') + ' à ' + heure,
               bouton: 'Corriger', ton: '' };
    }
    /* Une journée qui porte une ligne sans être aucun des cas ci-dessus a été
       ajustée d'une façon ou d'une autre — heures saisies, note, congé à
       l'heure. On ne devine pas laquelle : on dit qu'il y a quelque chose
       plutôt que d'affirmer ce qu'on ne sait pas. */
    return { phrase: 'Aujourd’hui : journée déclarée', bouton: 'Corriger', ton: '' };
  }

  /* '17:30:00' -> '17 h 30'. Vide si l'heure n'est pas renseignée : la phrase
     retombe alors sur un libellé qui n'invente aucun chiffre. */
  function heureDuJour(v) {
    var s = String(v || '').slice(0, 5);
    if (!/^\d{2}:\d{2}$/.test(s)) return '';
    return Number(s.slice(0, 2)) + '\u202fh\u202f' + s.slice(3, 5);
  }

  /* Un seul appui : on va sur l'espace de l'enfant, dans le mois du jour, et
     la feuille s'ouvre par-dessus. `ouvrirJour` de `ui-enfant.js` fait
     l'aiguillage — il n'y a pas deux feuilles de saisie dans l'application. */
  function ouvrirJourDuJour(f) {
    var auj = global.App.aujourdhui();
    var m = auj
      ? { annee: Number(auj.slice(0, 4)), mois: Number(auj.slice(5, 7)) }
      : global.App.moisCourant();
    global.App.aller('enfant', {
      contratId: f.contrat.id, annee: m.annee, mois: m.mois, jour: auj
    });
  }

  /* ÉTAGE 3 — LES COMPTEURS. Congés payés, récupération, et le montant du
     mois. Les trois valeurs viennent du moteur ; aucune n'est recalculée ici.
     En familiarisation, la troisième est un TOTAL D'HEURES, pas un montant :
     rien n'est payé tant que les heures ne sont pas déclarées. */
  function etageCompteurs(f, m) {
    var b = Kit.bouton('etg3', function () { ouvrirCompteurs(f.contrat); });
    if (f.erreur || !f.entree) {
      b.appendChild(Kit.ce('span', null, 'Compteurs indisponibles'));
      return b;
    }
    var r = f.entree.resultat;
    var cs = r.compteurSortie || {};
    var cp = Kit.cpSolde(cs);
    var sup = Kit.supSolde(cs);
    /* Le facteur « minutes = un jour de congé » vient des CONDITIONS du mois
       — l'avenant en vigueur —, jamais du contrat : c'est l'avenant qui fait
       foi depuis le lot 17, et deux avenants peuvent ne pas s'accorder. */
    var parJour = (f.entree.conditions && f.entree.conditions.minutes_par_jour_conge) ||
                  f.contrat.minutes_par_jour_conge || 0;

    b.appendChild(valeur('congés',
      cp < 0 ? '− ' + Kit.joursCp(-cp, parJour) : Kit.joursCp(cp, parJour)));
    b.appendChild(valeur('récup',
      sup < 0 ? '− ' + Kit.heures(-sup) : Kit.heures(sup)));

    var fam = r.familiarisation;
    var mois = Kit.moisCapitale(m.annee, m.mois).split(' ')[0].toLowerCase();
    var droite = valeur(mois, fam && fam.actif
      ? Kit.heures(fam.minutesDeclarees)
      : Kit.eur(r.totalAVerserCentimes));
    droite.className = 'dr';
    b.appendChild(droite);
    return b;
  }

  function valeur(libelle, v) {
    var s = Kit.ce('span', null, libelle + ' ');
    s.appendChild(Kit.ce('b', null, v));
    return s;
  }

  /* ------------------------------------------------------------------ */
  /* Le pied (§3.4)                                                      */
  /* ------------------------------------------------------------------ */

  function rendrePied(corps, fiches, m) {
    corps.appendChild(Kit.ce('p', 'pfin',
      'Touchez la ligne des compteurs pour voir le détail de vos soldes.'));

    var poser = Kit.bouton('btn', function () { global.App.aller('conges', {}, true); });
    poser.textContent = 'Poser des congés';
    corps.appendChild(poser);

    /* « Clôturer le mois de <mois> » mène au PARCOURS GUIDÉ, et pas à l'écran
       de clôture du §7.2 : l'écran du §7.2 ne connaît que le mois en cours,
       le parcours guidé passe en revue les mois EN RETARD de chaque contrat,
       un par un, avec une décision par écran.

       ARBITRAGE D'ADRIEN DU 2 SEPTEMBRE — LE BOUTON EST GRISÉ TANT QU'IL N'Y A
       RIEN À CLÔTURER. Il redevient actif « à partir du 25 du mois, et le
       temps qu'un mois arrivé à son terme n'a pas été clôturé ». C'est
       exactement ce que `moisACloturer` sait déjà : la garde V8-03 fait
       entrer le mois courant à partir du 25, et `retards` porte les mois
       échus non clôturés. Le bouton ne se met donc pas à juger — il regarde
       si la liste est vide. Une phrase dit pourquoi il est gris : un bouton
       inactif et muet est une impasse (§7.2). */
    var aCloturer = moisACloturer(fiches, m);
    var clore = Kit.bouton('btn nt', function () {
      global.App.aller('finDeMois', { liste: aCloturer });
    });
    clore.textContent = 'Clôturer le mois de ' +
      Kit.moisCapitale(m.annee, m.mois).split(' ')[0].toLowerCase();
    if (!aCloturer.length) {
      clore.disabled = true;
      clore.setAttribute('aria-disabled', 'true');
    }
    corps.appendChild(clore);
    if (!aCloturer.length) {
      corps.appendChild(Kit.ce('p', 'pfin',
        'Rien à clôturer pour l’instant : un mois se clôture à partir du 25, ' +
        'ou dès qu’il est terminé.'));
    }
  }

  /* Les mois que la clôture doit passer en revue : les retards de chaque
     contrat, puis le mois courant quand il est prêt à être figé. Un mois dont
     le salaire manque n'y entre pas — le figer amputerait le total. */
  function moisACloturer(fiches, m) {
    var liste = [];
    fiches.forEach(function (f) {
      if (f.erreur) return;
      f.retards.forEach(function (e) {
        liste.push({ contrat: f.contrat, annee: e.annee, mois: e.mois, echu: true,
          rouvert: Kit.moisRouvert(e.recap) });
      });
    });
    fiches.forEach(function (f) {
      if (f.erreur || !f.entree) return;
      if (f.entree.salaireManquant || !f.entree.resultat.salaireNetCentimes) return;
      /* GARDE V8-03, CONSERVÉE. Le mois COURANT n'entre dans la clôture qu'à
         partir du 25 : avant, il reste un tiers du mois à vivre, et la clôture
         est le seul geste irréversible de l'application.

         POINT À ARBITRER, SIGNALÉ ET NON TRANCHÉ EN SILENCE : la maquette 2A
         affiche « Clôturer le mois de <mois> » en pied d'accueil SANS
         condition, tous les jours du mois. Le bouton est donc là — c'est la
         maquette —, mais ce qu'il ouvre respecte la garde : le 24, il ne
         propose que les mois ÉCHUS. Le bouton n'invite pas à figer un mois
         qui n'est pas fini. */
      if (f.etat !== 'a_cloturer') return;
      liste.push({ contrat: f.contrat, annee: m.annee, mois: m.mois, echu: false,
        rouvert: Kit.moisRouvert(f.entree.recap) });
    });
    return liste.sort(function (a, b) {
      return (a.annee * 12 + a.mois) - (b.annee * 12 + b.mois);
    });
  }

  function ouvrirCompteurs(contrat) {
    global.App.aller('compteurs', { contratId: contrat.id });
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
    /* LOT 31 (§3.2) — UNE ORPHELINE BLOQUE AUSSI LE PARCOURS GUIDÉ. Le
       verrou du §16.1 c) est repris tel quel : le parcours guidé est l'autre
       porte par laquelle un mois se fige, et un mois ne se fige pas sur une
       décision perdue. Le geste, lui, vit sur le récapitulatif (§3.3) : c'est
       là que la période est nommée et retirée. */
    var orphelines = (entree && entree.imputationsOrphelines) || [];
    if (orphelines.length) {
      var o0 = orphelines[0];
      ctx.corps.appendChild(Kit.warnbox(
        'Une période de congé de ' + cible.contrat.prenom_enfant +
          ' n’a plus aucune journée',
        ' Du ' + Kit.dateLongue(o0.date_debut) + ' au ' + Kit.dateLongue(o0.date_fin) +
        ', une répartition existe mais aucune journée de congé n’est posée sur ' +
        'ces dates. Ce mois ne peut pas être clôturé tant qu’elle subsiste.'));
      actions.appendChild(boutonTexte('btn', 'Voir le récapitulatif', function () {
        parcours = null;
        global.App.aller('document', {
          contratId: cible.contrat.id, annee: cible.annee, mois: cible.mois
        });
      }));
    }

    var bloque = !!(entree && ((entree.imputationsEcartees || []).length ||
                               orphelines.length));
    if (bloque && (entree.imputationsEcartees || []).length) {
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
