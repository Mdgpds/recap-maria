/* ============================================================================
   ui-accueil.js — Écran d'accueil (§2.1 des specs) et, depuis le lot 7, la
   fin de mois guidée (§6.7).

   Le principe directeur du lot 6 : l'application s'organise par FAMILLE, pas
   par mois. L'accueil est donc une liste de contrats — « le dossier de Léa » —
   et non un tableau du mois de mai.

   CE QUE LE LOT 7 CHANGE ICI.

   L'accueil présentait une PROJECTION COMME UN FAIT. Le 11 août il annonçait
   « 1 142,50 € à verser » et proposait de clôturer le mois, alors qu'il restait
   quatorze jours travaillés. Deux défauts en un : un chiffre provisoire donné
   pour définitif, et une invitation à poser le seul geste IRRÉVERSIBLE de
   l'application au pire moment.

   Désormais :
     - un mois a trois états — en cours, à clôturer, clôturé — et le mot est
       toujours écrit à côté de la pastille, jamais porté par la couleur seule ;
     - « À faire » montre D'ABORD les mois passés non clôturés, toujours, quelle
       que soit la date : ce sont eux qui coûtent cher, pas le mois courant ;
     - le mois courant n'est proposé à la clôture qu'à partir du 25 ;
     - un montant provisoire le dit.

   POURQUOI LA FIN DE MOIS GUIDÉE VIT DANS CE FICHIER. La spécification réserve
   au lot 7 une liste de fichiers close, et `ui-fin-de-mois.js` n'en fait pas
   partie. Plutôt que d'élargir le périmètre de ma propre initiative, l'écran
   est rendu ici, sous la vue `finDeMois`. Signalé dans les points d'alerte :
   ce fichier en devient long.

   Aucun calcul ici. Les chiffres viennent tous de la chaîne des mois
   (chaine-mois.js -> Engine.calculerMois). Les montants d'entretien
   n'apparaissent PAS isolément sur cet écran (§2.1) : seulement le total à
   verser, qui est le chiffre que Maria attend.
   ========================================================================= */
(function (global) {
  'use strict';

  var Kit = global.Kit;

  /* `Kit.bouton(classe, onclick)` ne pose pas de libellé : ce raccourci évite
     de répéter trois lignes à chaque bouton de cet écran. */
  function boutonTexte(classe, libelle, onclick) {
    var b = Kit.bouton(classe, onclick);
    b.textContent = libelle;
    return b;
  }

  /* Correction A3 (relecture lot 6) : le seuil de « compteur bas » vit
     désormais à un seul endroit, dans Kit. Trois écrans en portaient trois
     valeurs différentes — à 7 jours restants, l'espace enfant affichait
     « compteur bas » en orange pendant que l'accueil annonçait « tout est à
     jour » et que « Mes congés » affichait le même chiffre en noir. */

  /* Au-delà de ce nombre de mois à clôturer, l'accueil propose le parcours
     guidé plutôt que de laisser Maria ouvrir chaque enfant à la main. */
  var SEUIL_PARCOURS_GUIDE = 2;

  function afficher(ctx) {
    if (ctx.vue === 'finDeMois') return afficherFinDeMois(ctx);
    return afficherAccueil(ctx);
  }

  /* LOT 17 §17.2 — LE PLANNING D'UN MOIS vient des conditions que la chaîne a
     résolues pour ce mois-là, jamais de `contrat`. Les jours de garde sont
     datés : un avenant peut les changer au 1er d'un mois, et compter les jours
     travaillés d'un mois passé sur le planning d'aujourd'hui afficherait
     « 20 j sur 22 » là où le contrat n'en prévoyait que 18.

     `null` quand la chaîne n'a pas répondu : `Kit.joursPlanning` retombe alors
     sur lundi-vendredi, ce qui est un défaut d'affichage sur un écran déjà en
     erreur — jamais un chiffre transmis à une famille. */
  function planningDe(entree) {
    return (entree && entree.conditions && entree.conditions.jours_planning) || null;
  }

  /* §17.6 — le facteur d'affichage des congés payés, celui du mois montré. */
  function mpjcDe(entree) {
    return (entree && entree.conditions && entree.conditions.minutes_par_jour_conge) || 0;
  }

  /* ------------------------------------------------------------------ */
  /* 1. Accueil                                                          */
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
          enTete(ctx.barre, m, null);
          /* Rien n'a pu être lu : la pastille est retirée plutôt que laissée
             à une valeur périmée. Un chiffre faux vaut moins que pas de
             chiffre — et l'écran des rappels ne promet plus l'inverse
             (correctif A4 de la relecture PR9). */
          global.App.majPastilleAccueil(0);
          etatDePanne(ctx.corps, enEchec[0].erreur, function () { global.App.rafraichir(); });
          return;
        }

        enTete(ctx.barre, m, fiches);
        rendreAFaire(ctx.corps, fiches, m);
        rendreCartes(ctx.corps, fiches, m);

        /* LOT 15 (A5) — la pastille est posée à partir de ce que l'accueil
           VIENT DE CALCULER : les mois en retard, plus le mois courant s'il
           est à clôturer. Aucun appel supplémentaire, aucune permission,
           aucun serveur. C'est le filet qui fonctionne quand les
           notifications ne fonctionnent pas. */
        global.App.majPastilleAccueil(compterAClôturer(fiches));
      });
  }

  /* Une fiche = tout ce que l'accueil doit savoir d'un contrat pour ce mois.
     Un contrat qui échoue n'efface pas les autres : il porte son erreur.

     Lot 7 : la fiche porte aussi l'état du mois affiché et la liste des mois
     PASSÉS restés en brouillon. Ces derniers se lisent dans la chaîne, qui
     remonte jusqu'au début du contrat — aucun appel supplémentaire. */
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
        /* LOT 17 §17.2 — le planning vient des CONDITIONS du mois, résolues
           par la chaîne. Un avenant peut le changer, et compter les jours
           travaillés d'un mois passé sur le planning d'aujourd'hui donnerait
           « 20 j sur 22 » là où le contrat n'en prévoyait que 18. */
        travailles: Kit.joursTravailles(contrat, planningDe(entree), m.annee, m.mois, journees),
        etat: entree ? Kit.etatDuMois(m.annee, m.mois, entree.recap, auj) : null,
        restants: Kit.joursTravaillesRestants(contrat, planningDe(entree), m.annee, m.mois, auj, journees),
        retards: moisEnRetard(chaine, m, auj),
        erreur: null
      };
    }).catch(function (e) {
      return {
        contrat: contrat, entree: null, journees: {}, travailles: [],
        etat: null, restants: 0, retards: [], erreur: e
      };
    });
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

  function enTete(barre, m, fiches) {
    Kit.vider(barre);
    barre.className = 'hero';
    barre.appendChild(Kit.ce('div', 'hi', 'Bonjour Maria'));
    barre.appendChild(Kit.ce('div', 'mo', Kit.moisCapitale(m.annee, m.mois)));

    if (!fiches) return;

    /* Avancement du mois : jours travaillés écoulés sur jours travaillés du
       mois, tous contrats confondus (l'union, parce que les quatre contrats
       partagent le même planning mais pas les mêmes dates de début). C'est une
       lecture d'almanach, pas un calcul métier — voir ui-kit.js. */
    var toutes = {};
    fiches.forEach(function (f) { f.travailles.forEach(function (d) { toutes[d] = true; }); });
    var jours = Object.keys(toutes).sort();
    if (!jours.length) return;

    var auj = global.App.aujourdhui();
    var ecoules = jours.filter(function (d) { return d <= auj; }).length;
    var pct = Math.round(ecoules * 100 / jours.length);

    var wrap = Kit.ce('div', 'pwrap');
    var lab = Kit.ce('div', 'plab');
    lab.appendChild(Kit.ce('span', null, 'Le mois avance'));
    var droite = auj >= jours[0] && auj <= jours[jours.length - 1]
      ? Kit.jourLong(auj).replace(/^\S+\s/, '') + ' — j. ' + ecoules + ' sur ' + jours.length + ' travaillés'
      : ecoules + ' jours travaillés sur ' + jours.length;
    lab.appendChild(Kit.ce('span', null, droite));
    wrap.appendChild(lab);
    var bar = Kit.ce('div', 'pbar');
    var i = Kit.ce('i');
    i.style.width = pct + '%';
    bar.appendChild(i);
    wrap.appendChild(bar);
    barre.appendChild(wrap);
  }

  /* ------------------------------------------------------------------ */
  /* « À faire » — ordre strict (§6.2)                                   */
  /* ------------------------------------------------------------------ */

  function rendreAFaire(corps, fiches, m) {
    corps.appendChild(Kit.section('À faire'));
    var aCloturer = [];      // pour le parcours guidé
    var nb = 0;

    /* --- 1. Les mois PASSÉS non clôturés, d'abord, toujours ------------
       Quelle que soit la date. C'est le renversement du lot 7 : jusqu'ici
       l'accueil ne parlait que du mois courant, et un juillet oublié pouvait
       le rester indéfiniment sans que rien ne le dise. */
    var retards = [];
    fiches.forEach(function (f) {
      if (f.erreur) return;
      f.retards.forEach(function (e) { retards.push({ fiche: f, entree: e }); });
    });
    retards.sort(function (a, b) {
      return (a.entree.annee * 12 + a.entree.mois) - (b.entree.annee * 12 + b.entree.mois);
    });
    retards.forEach(function (x) {
      nb++;
      aCloturer.push({ contrat: x.fiche.contrat, annee: x.entree.annee, mois: x.entree.mois });
      tuile(corps, '!',
        Kit.moisCapitale(x.entree.annee, x.entree.mois).split(' ')[0] +
          ' n’est pas clôturé pour ' + x.fiche.contrat.prenom_enfant,
        'Le mois est terminé depuis le ' + Kit.dateLongue(dernierJourDuMois(x.entree.annee, x.entree.mois)) + '.',
        function () { ouvrirEnfant(x.fiche.contrat, { annee: x.entree.annee, mois: x.entree.mois }); });
    });

    /* --- 2. Les empêchements du mois courant --------------------------
       Ils passent avant la proposition de clôture : proposer de clôturer un
       mois dont le salaire est inconnu, c'est proposer de figer un total
       amputé. */
    fiches.forEach(function (f) {
      if (f.erreur) {
        nb++;
        tuile(corps, '!', 'Le mois de ' + f.contrat.prenom_enfant + ' n’a pas pu être calculé',
          Kit.messageErreur(f.erreur), null);
        return;
      }
      if (!f.entree) return;                 // contrat hors de ce mois : rien à faire
      if (f.entree.salaireManquant) {
        nb++;
        tuile(corps, '!', 'Aucune rémunération connue pour ' + f.contrat.prenom_enfant,
          'Renseignez son barème dans sa fiche contrat, sinon le mois ne peut pas être clôturé.',
          function () { ouvrirFiche(f.contrat); });
        return;
      }
      /* Correction B2 : un barème sans net n'est pas un barème manquant, et
         personne ne le signalait — le mois se clôturait avec un total amputé
         du salaire entier, définitivement. */
      if (!f.entree.resultat.salaireNetCentimes) {
        nb++;
        tuile(corps, '!', 'Le net de ' + f.contrat.prenom_enfant + ' n’est pas renseigné',
          'Son récapitulatif est incomplet et ne peut pas être clôturé tant qu’il manque.',
          function () { ouvrirFiche(f.contrat); });
      }
    });

    /* --- 3. Le mois COURANT, seulement à partir du 25 (V8-03) ---------
       Avant le 25, proposer la clôture reviendrait à inviter Maria à figer un
       mois dont elle ignore encore un tiers. Le geste est irréversible. */
    fiches.forEach(function (f) {
      if (f.erreur || !f.entree) return;
      if (f.entree.salaireManquant || !f.entree.resultat.salaireNetCentimes) return;
      if (f.etat !== 'a_cloturer') return;
      nb++;
      aCloturer.push({ contrat: f.contrat, annee: m.annee, mois: m.mois });
      tuile(corps, '!',
        'Clôturer ' + Kit.libelleMois(m.mois) + ' pour ' + f.contrat.prenom_enfant,
        'Vérifiez les journées, puis clôturez le mois.',
        function () { ouvrirEnfant(f.contrat, m); });
    });

    /* --- 4. Les compteurs bas ----------------------------------------- */
    fiches.forEach(function (f) {
      if (f.erreur || !f.entree) return;
      var cp = cpDisponible(f.entree);
      var parJour = mpjcDe(f.entree);
      if (!Kit.cpEstBas(cp, parJour)) return;
      nb++;
      tuile(corps, '⚠',
        f.contrat.prenom_enfant + ' n’a plus que ' + Kit.joursCp(cp, parJour) +
          ' de congés payés',
        'Un congé passerait en partie sans solde sur ce contrat',
        function () { ouvrirEnfant(f.contrat, m); });
    });

    /* --- 5. Le parcours guidé, quand il y a plusieurs mois à clôturer -- */
    if (aCloturer.length >= SEUIL_PARCOURS_GUIDE) {
      var t = tuile(corps, '→',
        aCloturer.length + ' mois sont à clôturer',
        'Les passer en revue un par un, sans en oublier.',
        function () { global.App.aller('finDeMois', { liste: aCloturer }); });
      t.classList.add('act');
    }

    /* --- 6. Rien à faire ---------------------------------------------- */
    if (nb === 0) {
      var r = Kit.ce('div', 'todo act');
      r.appendChild(Kit.ce('div', 'ic', '✓'));
      var tx = Kit.ce('div', 'tx', 'Rien à clôturer pour l’instant');
      tx.appendChild(Kit.ce('small', null, 'Les mois terminés sont tous clôturés.'));
      r.appendChild(tx);
      corps.appendChild(r);
    }
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

  function tuile(corps, icone, titre, sous, onclick) {
    var t = onclick ? Kit.bouton('todo', onclick) : Kit.ce('div', 'todo');
    t.appendChild(Kit.ce('div', 'ic', icone));
    var tx = Kit.ce('div', 'tx', titre);
    if (sous) tx.appendChild(Kit.ce('small', null, sous));
    t.appendChild(tx);
    if (onclick) t.appendChild(Kit.ce('div', 'ar', '›'));
    corps.appendChild(t);
    return t;
  }

  /* ------------------------------------------------------------------ */
  /* Cartes contrat                                                      */
  /* ------------------------------------------------------------------ */

  function rendreCartes(corps, fiches, m) {
    corps.appendChild(Kit.section('Mes contrats'));
    fiches.forEach(function (f) {
      corps.appendChild(carte(f, m));
    });
  }

  function carte(f, m) {
    var c = f.contrat;
    var clos = f.etat === 'cloture';
    var b = Kit.bouton('big' + (clos ? '' : ' warn'), function () { ouvrirEnfant(c, m); });

    var top = Kit.ce('div', 'top');
    /* Lot 8 — photo si elle existe, initiale sinon, dans la couleur de
       l'enfant. Quatre cartes se distinguaient jusqu'ici par une seule lettre
       dans quatre ronds verts identiques. */
    top.appendChild(Kit.avatar(c));
    var ident = Kit.ce('div');
    ident.appendChild(Kit.ce('div', 'nm', Kit.nomComplet(c)));
    ident.appendChild(Kit.ce('div', 'fm', 'Famille ' + ((c.famille && c.famille.nom) || '—')));
    top.appendChild(ident);
    top.appendChild(Kit.ce('div', 'ar', '›'));
    b.appendChild(top);

    if (f.erreur) {
      b.appendChild(Kit.ce('div', 'sb q', 'Chiffres indisponibles : ' + Kit.messageErreur(f.erreur)));
      return b;
    }
    if (!f.entree) {
      b.appendChild(Kit.ce('div', 'sb q',
        'Ce contrat ne couvre pas ' + Kit.libelleMoisAnnee(m.annee, m.mois) + '.'));
      return b;
    }

    var r = f.entree.resultat;
    var stats = Kit.ce('div', 'stats');
    stat(stats, Kit.jours(r.joursPresence), 'présence');
    /* §2.1 : pas de montant d'entretien isolé sur l'accueil — le total seul.
       Lot 7 : sur un mois en cours, le total est SUIVI de « provisoire ». Un
       chiffre qui va encore bouger ne se présente pas comme un fait. */
    /* CORRECTIF A6 (lot 7) DE LA RELECTURE PR9 — `restants` était calculé puis
       JAMAIS AFFICHÉ. V8-02 demande « provisoire » ET le nombre de jours
       travaillés restants : sans lui, Maria ne sait pas de combien le montant
       peut encore bouger, sur l'écran qu'elle ouvre le plus souvent. */
    stat(stats, Kit.eurCourt(r.totalAVerserCentimes),
      f.etat === 'en_cours'
        ? (f.restants > 0
            ? 'à verser · provisoire, ' + f.restants + ' j restants'
            : 'à verser · provisoire')
        : 'à verser');
    stat(stats, Kit.joursCp(cpDisponible(f.entree), mpjcDe(f.entree)), 'congés payés');
    b.appendChild(stats);

    /* La pastille porte le mot, jamais la couleur seule (V8-01, V8-05). */
    var etat = Kit.ce('div', 'etat ' + f.etat);
    etat.appendChild(Kit.pastilleEtat(f.etat));
    etat.appendChild(Kit.ce('span', 'quand',
      Kit.moisCapitale(m.annee, m.mois).split(' ')[0]));
    b.appendChild(etat);

    /* Un mois en retard sur ce contrat se voit depuis sa carte, pas seulement
       depuis « À faire » : Maria descend souvent directement aux cartes. */
    if (f.retards.length) {
      b.appendChild(Kit.ce('div', 'sb q', f.retards.length === 1
        ? Kit.moisCapitale(f.retards[0].annee, f.retards[0].mois) + ' n’est pas clôturé.'
        : f.retards.length + ' mois antérieurs ne sont pas clôturés.'));
    }
    return b;
  }

  function stat(parent, valeur, cle) {
    var s = Kit.ce('div', 'st');
    s.appendChild(Kit.ce('div', 'v', valeur));
    s.appendChild(Kit.ce('div', 'k', cle));
    parent.appendChild(s);
  }

  function cpDisponible(entree) {
    return Kit.cpDisponible(entree && entree.resultat && entree.resultat.compteurSortie);
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
    b.appendChild(boutonTexte('btn pr plein', 'Ajouter mon premier enfant', function () {
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
    b.appendChild(boutonTexte('btn pr', 'Réessayer', reessayer));
    corps.appendChild(b);
  }

  /* ------------------------------------------------------------------ */
  /* 2. Fin de mois guidée (§6.7, V8-32)                                 */
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
    Kit.ligne(lignes, 'Salaire net', Kit.eur(r.salaireNetCentimes));
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
