/* ============================================================================
   ui-menu.js — Onglet « Menu » (§1 des specs).

   Tout ce qui ne se fait pas tous les jours : consulter une période, rouvrir un
   ancien contrat, ajouter un enfant, se déconnecter.

   Un point mérite d'être dit ici plutôt qu'en commentaire perdu : les ANCIENS
   CONTRATS ouvrent LE MÊME espace enfant que les contrats en cours, en lecture
   seule. Pas un écran d'archive appauvri : le même calendrier, les mêmes
   panneaux, le même historique. Une pièce justificative se relit exactement
   comme elle a été produite.

   Aucun calcul ici, aucune règle. Les créations passent par DB.
   ========================================================================= */
(function (global) {
  'use strict';

  var Kit = global.Kit;
  var Chaine = global.ChaineMois;
  var Format = global.Format;
  var Feries = global.Feries;
  /* Le moteur, uniquement pour LIRE quel barème est en vigueur à une date
     donnée (RG-15). Aucun montant n'est calculé dans cet écran. */
  var Engine = global.Engine;

  function afficher(ctx) {
    if (ctx.vue === 'enfants') return afficherEnfants(ctx);
    if (ctx.vue === 'familles') return afficherFamilles(ctx);
    if (ctx.vue === 'reprise') return afficherReprise(ctx);
    if (ctx.vue === 'rappels') return afficherRappels(ctx);
    if (ctx.vue === 'compte') return afficherCompte(ctx);
    if (ctx.vue === 'regles') return afficherRegles(ctx);
    return afficherMenu(ctx);
  }

  /* ================================================================== */
  /* LOT 27 (§27.1) — « COMMENT L'APPLICATION COMPTE »                  */
  /*                                                                     */
  /* L'ENDROIT UNIQUE DES RÈGLES. C'est lui qui autorise les retraits    */
  /* des lots 25 et 26 : chaque phrase de règle qui a quitté un écran    */
  /* de saisie atterrit ici, une fois, en entier.                        */
  /*                                                                     */
  /* Un écran de saisie doit dire ce que le geste FAIT — un montant, un  */
  /* décompte, un effet. Il n'a pas à porter le cours de droit qui va    */
  /* avec, à chaque ouverture, pour toujours. Maria connaît son métier ; */
  /* ce qu'elle veut de l'application, c'est le chiffre, et de savoir OÙ */
  /* aller quand une famille conteste.                                   */
  /*                                                                     */
  /* PAS DE « ? » DANS LES BARRES D'ÉCRAN (décision d'Adrien du 24 août :*/
  /* « incompréhensible »). Cet écran s'atteint par le Menu, et les      */
  /* renvois en contexte sont des liens texte, sobres et rares.          */
  /*                                                                     */
  /* LES SEPT TEXTES SONT CEUX DE LA MAQUETTE, à une exception près et   */
  /* elle est délibérée : la règle du décompte des congés est celle de   */
  /* `Kit.ENCART_RG06`, la constante partagée qui sert DÉJÀ au document  */
  /* remis à la famille (critère A12 du lot 23). Écrire ici une seconde  */
  /* version de la phrase la plus contestée de l'application, c'était    */
  /* garantir qu'un jour les deux divergeraient — et que Maria           */
  /* défendrait devant une famille un texte que son propre document ne   */
  /* dit pas. Le complément propre à l'écran (le quota par famille) est  */
  /* ajouté APRÈS la constante, pas à sa place.                          */
  /* ================================================================== */

  function reglesDeLApplication() {
    return [
      ['Le décompte des congés',
        Kit.ENCART_RG06 + ' Le quota de cinq vaut PAR FAMILLE : sur une même ' +
        'période, vous pouvez compter le samedi pour un enfant et pas pour un autre.'],
      ['Les 30 minutes',
        'Votre journée va au-delà de la fin d’accueil : 30 minutes par jour sont ' +
        'dues, enfant présent ou non. Un parent en retard en ajoute, une ' +
        'libération anticipée que vous demandez en rend. La durée exacte est ' +
        'celle de chaque contrat — elle se lit sur sa fiche.'],
      ['L’entretien',
        'Dû au montant plein chaque jour de présence. Il ne se retire qu’hors du ' +
        'cadre : une absence, un écart d’horaire déclaré, ou la familiarisation.'],
      ['La familiarisation',
        'Une période avant la garde normale : seules les heures déclarées sont ' +
        'payées, à l’heure, au taux du contrat. Pas de minutes supplémentaires. ' +
        'Les congés s’acquièrent normalement.'],
      ['Un congé vaut pour tous vos contrats',
        'Vous le posez une fois ; pour chaque enfant, vous choisissez sur quoi il ' +
        'se décompte — récupération, congés payés (jamais négatifs), ou sans ' +
        'solde. Les compteurs diffèrent d’un enfant à l’autre parce que les ' +
        'contrats n’ont pas commencé en même temps.'],
      ['Le mois clôturé',
        'Ses chiffres ne bougent plus jamais, même si un barème change. Le rouvrir ' +
        'laisse une trace définitive dans son historique.'],
      ['Les avenants',
        'Les conditions d’un contrat se changent par avenant, en vigueur au 1er ' +
        'd’un mois, jamais rétroactif. Les mois passés gardent leurs conditions : ' +
        'c’est ce qui rend le solde de tout compte juste.']
    ];
  }

  function afficherRegles(ctx) {
    global.App.barreRetour(ctx.barre, 'Comment l’application compte');

    ctx.corps.appendChild(Kit.ce('p', 'sb q',
      'Tout ce que les écrans n’ont plus besoin de répéter.'));

    reglesDeLApplication().forEach(function (r) {
      var f = Kit.fold(r[0], null);
      f.corps.appendChild(Kit.ce('p', 'regle', r[1]));
      ctx.corps.appendChild(f.bloc);
    });
    return Promise.resolve(true);
  }

  function afficherMenu(ctx) {
    ctx.barre.className = 'bar';
    ctx.barre.appendChild(Kit.ce('span', 'ti', 'Menu'));
    var corps = ctx.corps;

    /* LOT 8 — la rubrique « Consulter » DISPARAÎT.
       « Récapitulatif sur une période » et « Anciens contrats » vivaient ici,
       à deux gestes de profondeur, dans un menu qu'on n'ouvre que quand on
       cherche quelque chose. Ils sont désormais sur l'onglet Historique, qui
       est justement l'endroit où l'on va chercher le passé. Le Menu ne garde
       que ce qu'on y attend : gérer, et son compte. */

    /* ==================================================================
       LOT 27 (§27.2) — LE MENU EN CARTES DU SOCLE, ET « FAMILLES » S'EN VA.

       DEUX RUBRIQUES. « Gérer » : Mes enfants, Ajouter un enfant, Comment
       l'application compte. « Compte » : le nom sur les documents, les
       rappels, la reprise, l'export, la connexion.

       « FAMILLES » QUITTE LE MENU — décision d'Adrien du 23 août, confirmée
       par le §27.2. Le lot 22 l'avait remplacée par « Mes enfants » (Maria
       pense par enfant), puis la relecture l'avait rétablie « le temps qu'il
       tranche ». Il a tranché.

       RIEN NE SE PERD (B.0-7) : l'écran des familles existe toujours, et il
       s'atteint par « Voir par famille », en bas de « Mes enfants ». Le
       chemin n'est pas plus long — c'est le même nombre d'appuis — et il part
       de l'endroit où Maria vient de lire la liste de ses enfants, donc de
       l'endroit où la question « qui vit ensemble ? » se pose vraiment.
       ================================================================== */
    corps.appendChild(Kit.section('Gérer'));

    /* LOT 22 §22.1 — le sous-titre porte les deux comptes, et ils sont
       CALCULÉS : un historique peut compter quatorze enfants, et un compte
       écrit en dur mentirait dès le quinzième.
       LOT 16 §16.4 — chaque ligne est tenue par sa PROPRE RÉFÉRENCE et non
       par sa position : une ligne insérée avant elle déplaçait le correctif
       sur la mauvaise, et la ligne restait sur « Chargement… » pour
       toujours. */
    var ligneEnfants = entree('Mes enfants', 'Chargement…',
      function () { global.App.aller('enfants', {}); });
    corps.appendChild(ligneEnfants);

    corps.appendChild(entree('Ajouter un enfant', 'En trois étapes courtes',
      function () { feuilleNouvelEnfant(); }));

    /* §27.1 — L'ENDROIT UNIQUE DES RÈGLES. Le sous-titre les nomme : sans
       lui, « Comment l'application compte » ne dit pas ce qu'on y trouve, et
       Maria n'y va pas quand une famille conteste un décompte. */
    corps.appendChild(entree('Comment l’application compte',
      'Les règles — congés, samedis, entretien, 30 minutes…',
      function () { global.App.aller('regles', {}); }));

    corps.appendChild(Kit.section('Compte'));
    /* LOT 16 §16.2 — la saisie du nom qui signe les documents, en tête de la
       rubrique Compte : c'est la première chose à renseigner. */
    corps.appendChild(entree('Mon nom sur les documents',
      global.App.emettriceAsaisir && global.App.emettriceAsaisir()
        ? 'Vos récapitulatifs ne sont pas encore signés'
        : (global.App.nomEmettrice && global.App.nomEmettrice()) || null,
      function () { global.App.aller('compte', {}); }));
    /* §16.4 — la ligne des Rappels, tenue par sa référence et non par sa
       position. Son vrai réglage est posé plus bas, ou rien du tout. */
    var ligneRappels = entree('Me rappeler de clôturer mes mois', null,
      function () { global.App.aller('rappels', {}); });
    corps.appendChild(ligneRappels);
    corps.appendChild(entree('Reprendre mes comptes',
      'Vos compteurs papier, une fois',
      function () { global.App.aller('reprise', {}); }));
    corps.appendChild(entree('Exporter tout mon historique',
      'Tous vos mois, tous vos contrats. À garder de côté.',
      function () { feuilleExport(); }));
    corps.appendChild(Kit.ce('div', 'sec', 'Connectée'));
    corps.appendChild(Kit.ce('p', 'sb q', global.App.email() || '—'));
    var bOut = Kit.bouton('btn nt', function () { deconnecter(bOut); });
    bOut.textContent = 'Se déconnecter';
    corps.appendChild(bOut);
    corps.appendChild(Kit.ce('p', 'sb q centre',
      'Vous restez connectée d’une fois sur l’autre : ce bouton est le seul moyen ' +
      'de fermer votre session.'));

    /* Les deux lectures sont indépendantes : l'échec de l'une ne doit pas
       laisser l'autre ligne dans son état d'attente. */
    var pEnfants = global.DB.listContratsTous().then(function (tous) {
      var parts = partagerContrats(tous || []);
      poserSousTitre(ligneEnfants, phraseComptes(parts));
    }).catch(function () {
      poserSousTitre(ligneEnfants, 'Liste indisponible pour l’instant');
    });

    /* §16.4 — LE VRAI RÉGLAGE, ou RIEN. Une ligne qui n'a pas pu lire son
       réglage n'affiche aucun sous-titre : mieux vaut une ligne muette qu'un
       mot d'attente qu'elle ne saura jamais lever. */
    var pRappels = global.DB.getPreferenceRappel().then(function (pref) {
      poserSousTitre(ligneRappels, libelleReglageRappel(pref));
    }).catch(function () {
      poserSousTitre(ligneRappels, null);
    });

    return Promise.all([pEnfants, pRappels]);
  }

  function poserSousTitre(ligne, texte) {
    if (!ligne) return;
    var sous = ligne.querySelector('.d');
    if (!texte) { if (sous) sous.parentNode.removeChild(sous); return; }
    if (!sous) {
      sous = Kit.ce('span', 'd');
      /* LOT 27 — le sous-titre se pose dans le GROUPE de la carte (`.gr`),
         à côté du titre. `querySelector('span')` prenait le premier span
         venu : sur la carte du socle c'est `.gr` lui-même, ce qui marchait
         par accident. On le nomme. */
      var groupe = ligne.querySelector('.gr');
      if (groupe) groupe.appendChild(sous); else return;
    }
    sous.textContent = texte;
  }

  /* « Le 25, puis chaque jour tant qu'un mois n'est pas clôturé ». Le jour
     vient du réglage, jamais écrit en dur : Maria peut l'avoir mis au 28. */
  function libelleReglageRappel(pref) {
    if (!pref || !pref.actif) return 'Vous ne recevez aucun rappel';
    var jour = pref.jour_du_mois || 25;
    var base = 'Le ' + (jour === 1 ? '1er' : jour);
    if (pref.chaque_jour_ensuite !== false) {
      return base + ', puis chaque jour tant qu’un mois n’est pas clôturé';
    }
    return base + ' de chaque mois';
  }

  /* ------------------------------------------------------------------ */
  /* LOT 16 §16.5 — LES RÉGLAGES PAR DÉFAUT D'UN NOUVEAU CONTRAT          */
  /* ------------------------------------------------------------------ */

  /* L'écran de création ANNONÇAIT « 8h30 → 17h30 » et n'envoyait rien : la
     base appliquait ses propres valeurs par défaut, dont `heure_depart` à
     18:00. L'écran disait donc une chose, la base en enregistrait une autre,
     et le contrat se retrouvait avec un départ à 18h00 ET une journée de 9 h —
     deux valeurs qui se contredisent, puisque 8h30 → 18h00 fait 9h30.

     Les valeurs sont désormais ÉNONCÉES ICI et ENVOYÉES telles quelles, et la
     phrase affichée est produite à partir de ce même objet. Elles ne peuvent
     plus diverger : c'est le seul moyen d'empêcher le défaut de revenir.

     La fin d'ACCUEIL est 17:30. Les 30 minutes supplémentaires viennent après
     et vivent dans `minutes_sup_jour` : l'enfant repart vers 18 h, mais
     l'accueil s'arrête à 17h30. Le schéma porte le même défaut depuis la
     migration 013. */
  var REGLAGES_PAR_DEFAUT = {
    jours_planning: [1, 2, 3, 4, 5],
    heure_arrivee: '08:30',
    heure_depart: '17:30',
    minutes_contractuelles: 540,
    minutes_sup_jour: 30,
    minutes_par_jour_conge: 540,
    entretien_centimes_jour: 500,
    sup_dues_si_enfant_absent: true,
    ordre_imputation: 'cp_puis_sup'
  };

  /* La phrase de l'écran de création, produite à partir des valeurs qui seront
     RÉELLEMENT appliquées. Aucun chiffre écrit en dur. */
  function phraseReglages(r) {
    return libellePlanningLong(r.jours_planning) + ', ' +
      String(r.heure_arrivee).slice(0, 5).replace(':', 'h') + ' → ' +
      String(r.heure_depart).slice(0, 5).replace(':', 'h') + ' d’accueil, ' +
      Kit.duree(r.minutes_sup_jour) + ' supplémentaires par jour travaillé, ' +
      Kit.eur(r.entretien_centimes_jour) + ' d’entretien par jour de présence. ' +
      'Tout est modifiable ensuite dans la fiche du contrat.';
  }

  var NOMS_JOURS_LONGS = ['', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
  function libellePlanningLong(planning) {
    var p = (planning || []).slice().sort(function (a, b) { return a - b; });
    if (!p.length) return 'Aucun jour de garde';
    var continu = p.every(function (j, i) { return i === 0 || j === p[i - 1] + 1; });
    if (continu && p.length > 2) {
      return 'Du ' + NOMS_JOURS_LONGS[p[0]] + ' au ' + NOMS_JOURS_LONGS[p[p.length - 1]];
    }
    return p.map(function (j) { return NOMS_JOURS_LONGS[j]; }).join(', ');
  }

  /* LOT 27 (§27.2) — UNE ENTRÉE DE MENU EST LA CARTE DU SOCLE (`cd tap`).
     C'était une ligne `menu` avec son propre style : même géométrie, même
     chevron, un composant de plus à corriger le jour où la carte change.
     `Kit.carteTap` la remplace, et `poserSousTitre` continue de poser le
     sous-titre en différé sur `.d` — la classe ne change pas. */
  function entree(titre, sous, onclick) {
    if (!onclick) {
      var d = Kit.ce('div', 'cd');
      var g = Kit.ce('span', 'gr');
      g.appendChild(Kit.ce('span', 'n', titre));
      if (sous) g.appendChild(Kit.ce('span', 'd', sous));
      d.appendChild(g);
      return d;
    }
    return Kit.carteTap(titre, sous, onclick);
  }

  /* `majAnciens` et `feuilleAnciens` ONT ÉTÉ SUPPRIMÉES ICI (lot 8).
     Elles rendaient les contrats terminés sous forme d'une ligne de menu dont
     le sous-titre énumérait des prénoms, et d'une feuille pour les ouvrir.
     L'onglet Historique fait mieux et le fait ailleurs : une carte par enfant,
     les terminés sous leur propre intertitre. Garder les deux chemins, c'était
     garder deux endroits à corriger le jour où l'un se trompe. */

  /* ------------------------------------------------------------------ */
  /* Ajouter un enfant                                                   */
  /* ------------------------------------------------------------------ */

  /* LOT 17 §17.4 — CRÉER UN CONTRAT, ONZE CONDITIONS DÈS LE DÉPART.

     Avant ce lot, seuls le brut et le net étaient saisissables ici : les neuf
     autres réglages partaient aux valeurs par défaut, et Maria ne découvrait
     qu'ils étaient faux qu'en lisant un chiffre qui ne tombait pas juste.

     Trois choses disparaissent, et c'est le §17.9 :
       - le choix d'un CONTRAT TYPE, avec la phrase qui disait d'où venaient
         les valeurs pré-remplies ;
       - le bloc de REPRISE DES COMPTEURS — il vit dans « Reprendre mes
         comptes », et le dupliquer ici en faisait deux points d'entrée pour
         une donnée qui ne se saisit qu'une fois ;
       - l'écriture des réglages sur `contrat`. Ils partent désormais dans le
         PREMIER AVENANT, daté du 1er du mois de début. C'est la seule chose
         que le moteur lira.

     Le bloc est titré « Conditions au 1er septembre 2026 » : le vocabulaire
     prépare l'avenant, pour que « Faire un avenant » ne soit pas un geste
     nouveau six mois plus tard. */
  /* ================================================================== */
  /* LOT 27 (§27.4) — AJOUTER UN ENFANT EN TROIS ÉTAPES                 */
  /*                                                                     */
  /* C'ÉTAIT UNE SEULE FEUILLE DE QUINZE CHAMPS. Photo, famille, prénom, */
  /* date, puis les onze conditions, puis la rémunération : sur un       */
  /* téléphone, six écrans de défilement avant le bouton, et un refus    */
  /* posé tout en bas qui pouvait porter sur un champ hors de vue.       */
  /*                                                                     */
  /* TROIS ÉTAPES, CHACUNE TENANT SANS DÉFILEMENT À 390 px :             */
  /*   Qui     — la photo, le prénom, la famille, le premier jour ;      */
  /*   Quand   — le planning, les horaires, la journée, les minutes sup, */
  /*             ce que consomme un jour de congé ;                      */
  /*   Combien — l'entretien, l'ordre d'imputation, le brut et le net.   */
  /*                                                                     */
  /* CE QUI NE CHANGE PAS : les champs sont les MÊMES objets, construits */
  /* une seule fois par `Kit.champsConditions` — l'écran ne fait que les */
  /* répartir. Le refus est le même `erreur()`, l'écriture le même       */
  /* enchaînement (contrat, puis avenant nº 1 daté du 1er du mois), et   */
  /* les trois messages d'échec du lot 6 (A10) sont conservés mot pour   */
  /* mot : contrat créé sans son avenant, rechargement raté, échec sec.  */
  /*                                                                     */
  /* LE REFUS REMONTE À L'ÉTAPE QUI LE PORTE. Un prénom manquant est dit */
  /* à l'étape « Qui », un planning vide à l'étape « Quand » : un        */
  /* message qui parle d'un champ invisible n'aide personne.             */
  /* ================================================================== */

  function feuilleNouvelEnfant() {
    var maintenant = global.App.moisCourant();

    global.DB.listFamillesToutes().then(function (familles) {
      Kit.ouvrirFeuille('Ajouter un enfant', null,
        function (corps) {
          var ETAPES = ['Qui', 'Quand', 'Combien'];
          var etape = 0;

          /* La barre de progression : trois traits, celui de l'étape en cours
             et les précédents en vert. Elle dit où l'on en est et combien il
             reste — sans elle, trois feuilles successives ressemblent à un
             formulaire sans fin. */
          var barre = Kit.ce('div', 'wsteps');
          var traits = ETAPES.map(function () {
            var t = Kit.ce('i');
            barre.appendChild(t);
            return t;
          });
          corps.appendChild(barre);
          var soustitre = Kit.ce('div', 'sec');
          corps.appendChild(soustitre);

          var zone1 = Kit.ce('div');
          var zone2 = Kit.ce('div');
          var zone3 = Kit.ce('div');
          corps.appendChild(zone1);
          corps.appendChild(zone2);
          corps.appendChild(zone3);
          var zones = [zone1, zone2, zone3];

          /* --- ÉTAPE 1 : QUI ------------------------------------------ */

          /* LOT 22 §22.2 — « L'ÉCRAN AJOUTER UN ENFANT COMMENCE PAR ELLE. »
             Quatre cartes d'accueil se distinguaient par une seule lettre
             dans quatre ronds ; la photo est ce qui les rend reconnaissables
             d'un coup d'œil, debout, entre deux enfants. La poser à la
             création est le seul moment où Maria l'a sous la main. Elle part
             avec le contrat, dans le même `creerContrat` : aucune écriture
             séparée, donc aucun état à moitié créé si le réseau lâche. */
          var photo = { valeur: null };
          zone1.appendChild(global.UiContrat.blocPhoto(photo, { grand: true }));

          var prenom = Kit.champ('Prénom de l’enfant', '', { placeholder: 'Léa' });
          zone1.appendChild(prenom.bloc);

          var options = [['', '➕ Nouvelle famille']].concat(
            (familles || []).filter(function (f) { return !f.archive; })
              .map(function (f) { return [f.id, f.nom]; }));
          var selFamille = Kit.champSelect('Famille', options,
            options.length > 1 ? options[1][0] : '');
          zone1.appendChild(selFamille.bloc);

          var nomFamille = Kit.champ('Nom de la nouvelle famille', '',
            { placeholder: 'Papillon' });
          zone1.appendChild(nomFamille.bloc);

          function majFamille() {
            nomFamille.bloc.hidden = !!selFamille.select.value;
          }
          selFamille.select.addEventListener('change', majFamille);
          majFamille();

          var debut = Kit.champDate('Premier jour de garde',
            Kit.iso(maintenant.annee, maintenant.mois, 1),
            { anneeMin: maintenant.annee - 3, anneeMax: maintenant.annee + 1 });
          zone1.appendChild(debut.bloc);

          /* --- ÉTAPES 2 ET 3 : LES ONZE CONDITIONS -------------------- */

          /* Construites UNE FOIS, puis réparties : `temps` va dans « Quand »,
             `argent` dans « Combien ». Déplacer un nœud ne le recrée pas, donc
             `conditions.valeurs()` et `conditions.erreur()` continuent de lire
             les mêmes champs. */
          var conditions = Kit.champsConditions(REGLAGES_PAR_DEFAUT);
          zone2.appendChild(conditions.temps);
          zone3.appendChild(conditions.argent);

          /* La phrase des avenants clôt la dernière étape : c'est là que Maria
             valide, et c'est ce qu'elle doit savoir avant de le faire. Le
             titre daté, lui, est devenu le sous-titre de l'étape — il suit la
             date de début, qui se saisit à l'étape précédente. */
          zone3.appendChild(Kit.ce('p', 'sb q',
            'Ces conditions valent à partir de ce mois-là. Pour les changer plus tard, ' +
            'vous ferez un avenant depuis la fiche du contrat : les mois d’avant ne ' +
            'bougeront pas.'));

          /* --- LE PIED : progression, refus, navigation ---------------- */

          var msg = Kit.ce('div', 'msg');
          corps.appendChild(msg);

          var b = Kit.bouton('btn', function () { suivant(); });
          corps.appendChild(b);
          var bRetour = Kit.bouton('btn nt', function () { precedent(); });
          bRetour.textContent = 'Revenir';
          corps.appendChild(bRetour);

          function erreur(t) { msg.textContent = t; msg.className = 'msg ko'; }

          function dessiner() {
            zones.forEach(function (z, k) { z.hidden = k !== etape; });
            traits.forEach(function (t, k) { t.className = k <= etape ? 'on' : ''; });
            soustitre.textContent = 'Étape ' + (etape + 1) + ' sur ' + ETAPES.length +
              ' · ' + ETAPES[etape] +
              (etape === 1 || etape === 2 ? ' — ' + titreConditions(debut.valeur()) : '');
            b.textContent = etape === ETAPES.length - 1 ? 'Créer le contrat' : 'Continuer';
            bRetour.hidden = etape === 0;
            msg.textContent = ''; msg.className = 'msg';
          }

          /* LE REFUS EST RENDU À L'ÉTAPE QUI LE PORTE : on ne laisse pas Maria
             avancer sur une saisie qu'on refusera trois écrans plus loin, et
             on ne lui parle jamais d'un champ qu'elle ne voit pas. */
          function refusDeLEtape() {
            if (etape === 0) {
              if (!prenom.input.value.trim()) {
                return 'Le prénom de l’enfant est obligatoire.';
              }
              if (!selFamille.select.value && !nomFamille.input.value.trim()) {
                return 'Donnez un nom à la nouvelle famille.';
              }
              return null;
            }
            /* `conditions.erreur()` couvre les onze champs à la fois. On ne le
               pose qu'à la dernière étape, où ils ont tous été vus — le poser
               à l'étape « Quand » refuserait un brut que Maria n'a pas encore
               eu l'occasion de saisir. */
            return etape === ETAPES.length - 1 ? conditions.erreur() : null;
          }

          function suivant() {
            var refus = refusDeLEtape();
            if (refus) { erreur(refus); return; }
            if (etape < ETAPES.length - 1) { etape++; dessiner(); return; }
            creer();
          }

          function precedent() {
            if (etape > 0) { etape--; dessiner(); }
          }

          dessiner();

          function creer() {
            msg.textContent = ''; msg.className = 'msg';
            /* LES TROIS REFUS SONT REJOUÉS ICI, ET C'EST VOULU : `suivant()`
               les a déjà posés étape par étape, mais `creer()` est le dernier
               point avant l'écriture. Un garde-fou qui ne tient que dans le
               chemin nominal n'est pas un garde-fou. */
            var p = prenom.input.value.trim();
            if (!p) { etape = 0; dessiner(); erreur('Le prénom de l’enfant est obligatoire.'); return; }
            var idFamille = selFamille.select.value;
            var nouveauNom = nomFamille.input.value.trim();
            if (!idFamille && !nouveauNom) {
              etape = 0; dessiner();
              erreur('Donnez un nom à la nouvelle famille.'); return;
            }
            var refus = conditions.erreur();
            if (refus) { erreur(refus); return; }
            var vals = conditions.valeurs();

            b.disabled = true;
            msg.className = 'msg';
            msg.textContent = 'Création…';

            var pFamille = idFamille
              ? Promise.resolve({ id: idFamille })
              : global.DB.creerFamille({ nom: nouveauNom, canal: null });

            var contratCree = null;

            pFamille
              .then(function (famille) {
                /* Les colonnes de réglage de `contrat` ne sont PLUS LUES
                   (§17.2). On les remplit quand même à la création, à
                   l'identique du premier avenant : elles restent le filet
                   documenté par la migration `014` si une reprise devait être
                   rejouée, et une ligne à moitié vide se relit de travers. */
                var champsContrat = {
                  famille_id: famille.id,
                  prenom_enfant: p,
                  date_debut: debut.valeur(),
                  statut: 'actif',
                  /* §22.2 — la photo part AVEC le contrat, dans la même
                     écriture : `null` quand Maria n'en a pas choisi. */
                  photo: photo.valeur || null
                };
                Object.keys(REGLAGES_PAR_DEFAUT).forEach(function (k) {
                  champsContrat[k] = vals[k] == null ? REGLAGES_PAR_DEFAUT[k] : vals[k];
                });
                return global.DB.creerContrat(champsContrat);
              })
              .then(function (contrat) {
                contratCree = contrat;
                /* LE PREMIER AVENANT. Daté du 1er du mois de `date_debut` :
                   la contrainte `avenant_date_effet_premier_du_mois` l'impose,
                   et surtout, un avenant daté du 16 mars laisserait le mois de
                   mars sans aucune condition applicable — donc incalculable.
                   `reconstitue` reste FAUX : ces conditions-là ne sont pas
                   reconstituées, Maria vient de les saisir. */
                var mm = Chaine.moisDeDate(debut.valeur());
                var champs = { date_effet: Chaine.premierJour(mm.annee, mm.mois) };
                Object.keys(vals).forEach(function (k) { champs[k] = vals[k]; });
                return global.DB.ajouterAvenant(contrat.id, champs);
              })
              /* Correction A10 (relecture lot 6) : la feuille était fermée AVANT
                 le rechargement. Si celui-ci échouait, le message d'erreur
                 partait dans un nœud détaché : Maria lisait « contrat créé »,
                 ne voyait pas l'enfant sur l'accueil, recommençait — et créait
                 un SECOND contrat. On ne ferme qu'une fois tout abouti, et un
                 échec de rechargement dit exactement ce qui s'est passé. */
              .then(function () {
                global.App.invalider();
                return global.App.rechargerContrats().catch(function (e) {
                  var err = new Error('rechargement');
                  err.recharge = e;
                  throw err;
                });
              })
              .then(function () {
                Kit.fermerFeuille();
                Kit.toast('Contrat de ' + p + ' créé');
                return global.App.aller('accueil', {}, true);
              })
              .catch(function (e) {
                b.disabled = false;
                if (e && e.recharge) {
                  erreur('Le contrat de ' + p + ' A BIEN ÉTÉ CRÉÉ, mais l’écran n’a pas pu se ' +
                    'rafraîchir (' + Kit.messageErreur(e.recharge) + '). Ne le recréez pas : ' +
                    'fermez et rouvrez l’application.');
                  return;
                }
                /* Le contrat existe mais son avenant a échoué : c'est le seul
                   état à moitié écrit que ce chemin puisse produire, et le taire
                   laisserait un contrat qu'aucun mois ne sait calculer. On le
                   DIT, et on dit quoi faire. */
                if (contratCree) {
                  erreur('Le contrat de ' + p + ' a été créé, mais ses conditions n’ont pas pu ' +
                    'être enregistrées (' + Kit.messageErreur(e) + '). Ouvrez sa fiche et ' +
                    'saisissez-les : sans elles, aucun mois ne peut être calculé.');
                  return;
                }
                erreur('Création impossible : ' + Kit.messageErreur(e) +
                  ' Vérifiez et réessayez — votre saisie est conservée.');
              });
          }
        });
    }).catch(function (e) {
      Kit.toast('Liste des familles indisponible : ' + Kit.messageErreur(e), true);
    });
  }

  /* « Conditions au 1er septembre 2026 » — le vocabulaire de l'avenant, dès la
     création (§17.4). */
  function titreConditions(dateIso) {
    var mm = Chaine.moisDeDate(dateIso);
    return 'Conditions au 1er ' + Kit.libelleMoisAnnee(mm.annee, mm.mois);
  }

  /* ------------------------------------------------------------------ */

  /* ------------------------------------------------------------------ */
  /* LOT 8 — Écran Familles                                              */
  /*                                                                     */
  /* CE QU'IL CORRIGE. La fiche contrat portait un champ texte « Nom de   */
  /* la famille ». Le remplir écrivait dans `famille.nom` — c'est-à-dire  */
  /* renommait le FOYER, donc changeait le nom affiché pour TOUS ses      */
  /* enfants. Maria croyait corriger Léa, elle renommait aussi Tom, et    */
  /* rien à l'écran ne le disait. C'est une perte de données réelle, en   */
  /* production, et elle est silencieuse : on ne s'en aperçoit qu'en      */
  /* ouvrant la fiche d'un autre enfant, parfois des semaines plus tard.  */
  /*                                                                     */
  /* Le renommage devient donc un geste À PART, avec son écran, et cet    */
  /* écran NOMME les enfants concernés avant de laisser valider. Pas un   */
  /* décompte — « cela concerne 3 contrats » n'aide personne —, les       */
  /* PRÉNOMS.                                                            */
  /* ------------------------------------------------------------------ */

  function afficherFamilles(ctx) {
    global.App.barreRetour(ctx.barre, 'Familles');
    ctx.corps.appendChild(Kit.ce('div', 'attente', 'Lecture de vos familles…'));

    return global.DB.listFamillesAvecContrats().then(function (familles) {
      Kit.vider(ctx.corps);
      var liste = familles || [];
      if (!liste.length) {
        ctx.corps.appendChild(Kit.ce('p', 'vide',
          'Aucune famille pour l’instant. Elle se crée en ajoutant un enfant.'));
        return;
      }
      var enCours = liste.filter(function (f) { return !f.archive; });
      var rangees = liste.filter(function (f) { return f.archive; });

      if (enCours.length) {
        ctx.corps.appendChild(Kit.section('En cours'));
        enCours.forEach(function (f) { ctx.corps.appendChild(carteFamille(f)); });
      }
      if (rangees.length) {
        ctx.corps.appendChild(Kit.section('Terminées'));
        rangees.forEach(function (f) { ctx.corps.appendChild(carteFamille(f)); });
      }
    }).catch(function (e) {
      Kit.vider(ctx.corps);
      ctx.corps.appendChild(Kit.warnbox('Impossible de charger vos familles.',
        ' ' + Kit.messageErreur(e) + ' Vérifiez votre connexion, puis réessayez.'));
      var b = Kit.bouton('btn pr', function () { global.App.rafraichir(); });
      b.textContent = 'Réessayer';
      ctx.corps.appendChild(b);
    });
  }

  /* ================================================================== */
  /* LOT 22 §22.1 — LA PAGE « MES ENFANTS »                              */
  /*                                                                     */
  /* Le Menu ne peut pas porter l'historique : quatorze enfants sur       */
  /* quatre ans en feraient une liste à faire défiler avant d'atteindre   */
  /* « Se déconnecter ». Une entrée unique, et une page à eux.            */
  /* ================================================================== */

  /* Un contrat est « en garde » s'il n'est ni rangé ni terminé. Les deux
     drapeaux existent et ne veulent pas dire la même chose — `archive` est un
     rangement, `statut` est l'état du contrat — mais ils atterrissent dans la
     même section, parce que c'est la même chose pour Maria : cet enfant, elle
     ne le garde plus. */
  function partagerContrats(tous) {
    var enGarde = [], termines = [];
    (tous || []).forEach(function (c) {
      if (c.archive || c.statut === 'termine') termines.push(c);
      else enGarde.push(c);
    });
    return { enGarde: enGarde, termines: termines };
  }

  /* REMARQUE 5 DE LA RELECTURE — le ternaire portait deux branches
     identiques : un accord au pluriel prévu puis oublié. « en garde » ne
     s'accorde pas, il n'avait rien à faire là. */
  function phraseComptes(parts) {
    var g = parts.enGarde.length;
    var t = parts.termines.length;
    if (!g && !t) return 'Aucun enfant pour l’instant';
    var gauche = g + ' en garde';
    if (!t) return gauche;
    return gauche + ' · ' + t + ' contrat' + (t > 1 ? 's terminés' : ' terminé');
  }

  function afficherEnfants(ctx) {
    global.App.barreRetour(ctx.barre, 'Mes enfants');
    ctx.corps.appendChild(Kit.ce('div', 'attente', 'Lecture de vos contrats…'));

    return global.DB.listContratsTous().then(function (tous) {
      Kit.vider(ctx.corps);
      var parts = partagerContrats(tous || []);
      var corps = ctx.corps;

      if (!parts.enGarde.length && !parts.termines.length) {
        corps.appendChild(Kit.ce('p', 'vide',
          'Aucun enfant pour l’instant. Ajoutez-en un pour commencer.'));
        corps.appendChild(boutonAjouter());
        return;
      }

      corps.appendChild(Kit.section('En garde'));
      if (parts.enGarde.length) {
        parts.enGarde.forEach(function (c) { corps.appendChild(carteEnfant(c, false)); });
      } else {
        corps.appendChild(Kit.ce('p', 'vide', 'Aucun contrat en cours.'));
      }
      corps.appendChild(boutonAjouter());

      if (parts.termines.length) {
        corps.appendChild(Kit.section('Contrats terminés'));
        parts.termines.forEach(function (c) { corps.appendChild(carteEnfant(c, true)); });
        corps.appendChild(Kit.ce('p', 'sb q',
          'Un contrat terminé garde tout son historique et reste consultable. ' +
          'Il peut être remis en cours à tout moment.'));
      }

      /* La vue PAR FAMILLE n'est pas perdue, elle change de porte. Un foyer à
         deux enfants gardés reste consultable d'un geste (B.0-1). */
      var bFamilles = Kit.bouton('btn nt', function () { global.App.aller('familles', {}); });
      bFamilles.textContent = 'Voir par famille';
      corps.appendChild(bFamilles);
    }).catch(function (e) {
      Kit.vider(ctx.corps);
      ctx.corps.appendChild(Kit.warnbox('Impossible de charger vos contrats.',
        ' ' + Kit.messageErreur(e) + ' Vérifiez votre connexion, puis réessayez.'));
      var b = Kit.bouton('btn pr', function () { global.App.rafraichir(); });
      b.textContent = 'Réessayer';
      ctx.corps.appendChild(b);
    });
  }

  function boutonAjouter() {
    var b = Kit.bouton('btn nt', function () { feuilleNouvelEnfant(); });
    b.textContent = 'Ajouter un enfant';
    return b;
  }

  /* La carte d'un enfant. Elle mène à sa FICHE — pas à son espace mensuel :
     depuis cette page, on vient gérer un contrat, pas consulter un mois. Un
     contrat terminé est atténué, et sa carte dit depuis quand il l'est. */
  function carteEnfant(c, termine) {
    var b = Kit.bouton('big' + (termine ? ' off' : ''), function () {
      global.App.aller('fiche', { contratId: c.id });
    });
    var top = Kit.ce('div', 'top');
    top.appendChild(Kit.avatar(c));
    var ident = Kit.ce('div');
    ident.appendChild(Kit.ce('div', 'nm', Kit.nomComplet(c)));
    ident.appendChild(Kit.ce('div', 'fm', termine
      ? periodeDuContrat(c) + ' · historique conservé'
      : 'famille ' + ((c.famille && c.famille.nom) || '—')));
    top.appendChild(ident);
    top.appendChild(Kit.ce('div', 'ar', '›'));
    b.appendChild(top);
    return b;
  }

  /* La même phrase que le bandeau de la fiche, demandée à `UiContrat` plutôt
     que réécrite : deux formulations pour une même période finiraient par
     diverger, et la carte dirait autre chose que l'écran qu'elle ouvre. */
  function periodeDuContrat(c) {
    return global.UiContrat.periodeDuContrat(c);
  }

  /* Un foyer est TITRÉ PAR LES PRÉNOMS DE SES ENFANTS, le nom de famille en
     sous-titre. C'est ce qui parle à Maria : elle ne pense pas « la famille
     Papillon », elle pense « Léa et Tom ». Le nom du foyer, lui, sert aux
     documents et aux échanges avec les parents. */
  function carteFamille(f) {
    var contrats = f.contrats || [];
    var actifs = contrats.filter(function (c) { return !c.archive && c.statut !== 'termine'; });
    var b = Kit.bouton('big' + (f.archive ? ' off' : ''), function () { feuilleFamille(f); });

    var top = Kit.ce('div', 'top');
    top.appendChild(pileAvatars(contrats));
    var ident = Kit.ce('div');
    ident.appendChild(Kit.ce('div', 'nm', prenomsDe(contrats) || 'Aucun enfant'));
    ident.appendChild(Kit.ce('div', 'fm', 'famille ' + f.nom + ' · ' + phraseContrats(contrats, actifs)));
    top.appendChild(ident);
    top.appendChild(Kit.ce('div', 'ar', '›'));
    b.appendChild(top);
    return b;
  }

  /* Pile de photos superposées quand le foyer compte plusieurs enfants. */
  function pileAvatars(contrats) {
    var pile = Kit.ce('div', 'pile');
    contrats.slice(0, 3).forEach(function (c) { pile.appendChild(Kit.avatar(c, 'pt')); });
    if (!contrats.length) pile.appendChild(Kit.avatar({ prenom_enfant: '·' }, 'pt'));
    return pile;
  }

  function prenomsDe(contrats) {
    var noms = contrats.map(function (c) { return c.prenom_enfant; }).filter(Boolean);
    if (!noms.length) return '';
    if (noms.length === 1) return noms[0];
    return noms.slice(0, -1).join(', ') + ' et ' + noms[noms.length - 1];
  }

  function phraseContrats(contrats, actifs) {
    if (!contrats.length) return 'aucun contrat';
    if (!actifs.length) return contrats.length + (contrats.length > 1 ? ' contrats terminés' : ' contrat terminé');
    return actifs.length + (actifs.length > 1 ? ' contrats en cours' : ' contrat en cours');
  }

  function feuilleFamille(f) {
    var contrats = f.contrats || [];
    var actifs = contrats.filter(function (c) { return !c.archive && c.statut !== 'termine'; });

    Kit.ouvrirFeuille('Famille ' + f.nom, prenomsDe(contrats) || 'Aucun enfant rattaché',
      function (corps) {
        /* LOT 18 §18.3 — LES ENFANTS D'UN FOYER MÈNENT À LEUR FICHE.

           C'étaient des lignes inertes : Maria ouvrait la famille pour
           atteindre un enfant, ne trouvait rien de cliquable, refermait, et
           repassait par l'accueil. Le chemin le plus naturel était le seul qui
           ne menait nulle part. */
        if (contrats.length) {
          contrats.forEach(function (c) {
            var b = Kit.bouton('big', function () {
              Kit.fermerFeuille();
              global.App.aller('fiche', { contratId: c.id });
            });
            var top = Kit.ce('div', 'top');
            top.appendChild(Kit.avatar(c, 'pt'));
            var ident = Kit.ce('div');
            ident.appendChild(Kit.ce('div', 'nm', Kit.nomComplet(c)));
            ident.appendChild(Kit.ce('div', 'fm',
              c.archive || c.statut === 'termine' ? 'contrat terminé' : 'contrat en cours'));
            top.appendChild(ident);
            top.appendChild(Kit.ce('div', 'ar', '›'));
            b.appendChild(top);
            corps.appendChild(b);
          });
        }

        var bRenommer = Kit.bouton('btn nt', function () {
          Kit.fermerFeuille();
          feuilleRenommer(f);
        });
        bRenommer.textContent = 'Renommer cette famille';
        corps.appendChild(bRenommer);

        if (f.archive) {
          var bSortir = Kit.bouton('btn nt', function () { ranger(f, false, bSortir); });
          bSortir.textContent = 'Sortir cette famille du rangement';
          corps.appendChild(bSortir);
          return;
        }

        var bRanger = Kit.bouton('btn nt', function () { ranger(f, true, bRanger); });
        bRanger.textContent = 'Ranger cette famille';
        /* V8-20 — grisé, AVEC son explication. Un bouton inerte sans raison
           fait croire à une panne ; nommer le contrat bloquant dit quoi
           faire. */
        if (actifs.length) {
          bRanger.disabled = true;
          corps.appendChild(bRanger);
          corps.appendChild(Kit.ce('p', 'sb q',
            'Impossible tant qu’un contrat est en cours : ' +
            prenomsDe(actifs) + '. Terminez-le d’abord depuis sa fiche.'));
        } else {
          corps.appendChild(bRanger);
          corps.appendChild(Kit.ce('p', 'sb q',
            'Une famille rangée sort des écrans courants. Tout son historique ' +
            'reste consultable, et le rangement se défait.'));
        }
      });
  }

  /* V8-22 — Renommer une famille : geste distinct, et ANNONCÉ. */
  function feuilleRenommer(f) {
    var contrats = f.contrats || [];
    Kit.ouvrirFeuille('Renommer la famille ' + f.nom, null, function (corps) {
      if (contrats.length > 1) {
        corps.appendChild(Kit.warnbox('Ce nom changera aussi pour les autres enfants de cette famille',
          ' ' + prenomsDe(contrats) + '.'));
      } else if (contrats.length === 1) {
        corps.appendChild(Kit.note('Un seul enfant est concerné',
          contrats[0].prenom_enfant + '. Ce nom désigne le foyer, pas l’enfant : ' +
          'le nom de ' + contrats[0].prenom_enfant + ' se modifie dans sa fiche.'));
      }

      var champ = Kit.champ('Nom de la famille', f.nom);
      corps.appendChild(champ.bloc);

      var msg = Kit.ce('div', 'msg');
      corps.appendChild(msg);

      var bOk = Kit.bouton('btn', function () {
        var nouveau = String(champ.input.value || '').trim();
        if (!nouveau) {
          msg.className = 'msg ko';
          msg.textContent = 'Le nom ne peut pas être vide.';
          return;
        }
        if (nouveau === f.nom) { Kit.fermerFeuille(); return; }
        bOk.disabled = true;
        global.DB.renommerFamille(f.id, nouveau).then(function () {
          Kit.fermerFeuille();
          return global.App.rechargerContrats();
        }).then(function () {
          Kit.toast('La famille s’appelle désormais ' + nouveau + '.');
          global.App.rafraichir();
        }).catch(function (e) {
          bOk.disabled = false;
          msg.className = 'msg ko';
          msg.textContent = 'Le renommage n’a pas abouti : ' + Kit.messageErreur(e) +
            ' Le nom n’a pas changé.';
        });
      });
      bOk.textContent = 'Renommer';
      corps.appendChild(bOk);

      var bNon = Kit.bouton('btn nt', function () { Kit.fermerFeuille(); });
      bNon.textContent = 'Annuler';
      corps.appendChild(bNon);
    });
  }

  function ranger(f, ranger_, bouton) {
    bouton.disabled = true;
    var geste = ranger_ ? global.DB.archiverFamille(f.id) : global.DB.desarchiverFamille(f.id);
    geste.then(function () {
      Kit.fermerFeuille();
      return global.App.rechargerContrats();
    }).then(function () {
      Kit.toast(ranger_ ? 'La famille ' + f.nom + ' est rangée.'
                        : 'La famille ' + f.nom + ' est de retour.');
      global.App.rafraichir();
    }).catch(function (e) {
      bouton.disabled = false;
      /* L'erreur de la couche données NOMME les contrats bloquants : on la
         relaie telle quelle plutôt que de dire « impossible ». */
      if (e && e.code === 'FAMILLE_ENCORE_ACTIVE') {
        Kit.toast('Impossible de ranger cette famille : ' +
          prenomsDe((e.prenoms || []).map(function (p) { return { prenom_enfant: p }; })) +
          (e.prenoms && e.prenoms.length > 1 ? ' ont encore un contrat en cours.'
                                             : ' a encore un contrat en cours.'), true);
        return;
      }
      Kit.toast('Le rangement n’a pas abouti : ' + Kit.messageErreur(e) +
        ' Rien n’a changé.', true);
    });
  }

  /* ------------------------------------------------------------------ */
  /* LOT 24 (§24.5) — LE CODE MORT DU §17.9 EST RETIRÉ.                  */
  /*                                                                     */
  /* Les écrans « Mes contrats types » et « Modifier plusieurs           */
  /* contrats » vivaient ici, morts depuis le lot 17 : plus routés,      */
  /* signalés en bannière, appelant des fonctions `DB` disparues         */
  /* (`getSalaires`, `ajouterSalaire`, `supprimerSalaire`). Le lot 17    */
  /* demandait de les SIGNALER et réservait leur retrait au §19.2 :      */
  /* c'est ce lot-ci. Retrait pur — aucun comportement ne change, et le  */
  /* test `lot11-modeles.smoke.js` continue de vérifier qu'aucun chemin  */
  /* n'y mène. Les DONNÉES restent en base (`modele_contrat`,            */
  /* `contrat.modele_id`) : on ne détruit rien, on cesse de s'en servir. */
  /* ------------------------------------------------------------------ */

  /* ------------------------------------------------------------------ */
  /* LOT 14 — Reprendre mes comptes (V8-27)                              */
  /*                                                                     */
  /* Le nom « reprise des compteurs » est abandonné : Maria ne comprenait */
  /* pas de quoi il s'agissait. La question posée est celle qu'elle se    */
  /* pose : « je tenais déjà mes comptes sur papier, où j'en suis ? »     */
  /*                                                                     */
  /* GARDE-FOU CENTRAL : dès qu'un mois est clôturé pour un contrat, sa   */
  /* saisie est REFUSÉE. Ces chiffres sont le point de départ de tout     */
  /* l'historique ; les changer après une clôture rendrait faux des mois  */
  /* dont les documents sont partis chez des familles (risque n° 1).      */
  /* ------------------------------------------------------------------ */

  function afficherReprise(ctx) {
    global.App.barreRetour(ctx.barre, 'Reprendre mes comptes');
    ctx.corps.appendChild(Kit.ce('div', 'attente', 'Lecture de vos contrats…'));

    var contrats = global.App.contrats();
    return Promise.all(contrats.map(function (c) {
      return Promise.all([
        global.DB.getCompteurInitial(c.id).catch(function () { return null; }),
        /* CORRECTIF B7 DE LA RELECTURE PR9 — CE GARDE-FOU ÉCHOUAIT OUVERT.
           Un `catch` rendait une liste VIDE : une lecture ratée — tunnel,
           réseau qui coupe — faisait croire qu'aucun mois n'était clôturé, et
           le formulaire complet s'affichait sur un contrat dont les documents
           sont partis chez une famille. Désormais l'échec de lecture est un
           ÉTAT à part entière, et il ferme. La garantie, elle, est en base
           (migration 012). */
        global.DB.listRecapsContrat(c.id)
          .then(function (l) { return { ok: true, liste: l || [] }; })
          .catch(function (e) { return { ok: false, erreur: e }; }),
        /* LOT 17 §17.6 — les congés payés se STOCKENT en minutes et se
           SAISISSENT en jours. Le facteur de conversion est
           `minutes_par_jour_conge`, qui vit sur l'avenant : sans lui, on ne
           sait pas ce que vaut « 12,5 jours » pour ce contrat-là. */
        global.App.avenants(c.id).catch(function () { return null; })
      ]).then(function (r) {
        return {
          contrat: c,
          compteur: r[0],
          avenants: r[2],
          lectureRatee: !r[1].ok || r[2] === null,
          erreurLecture: r[1].erreur || null,
          cloturés: (r[1].liste || []).filter(function (x) { return x.statut === 'fige'; })
        };
      });
    })).then(function (fiches) {
      Kit.vider(ctx.corps);

      ctx.corps.appendChild(Kit.ce('p', 'intro',
        'Si vous teniez déjà vos comptes sur papier, indiquez ici où vous en êtes. ' +
        'L’application repartira de ces chiffres.'));

      /* L'avertissement est PERMANENT, pas un message qui passe. */
      ctx.corps.appendChild(Kit.warnbox('À ne saisir qu’une fois',
        ' Ces chiffres servent de point de départ à tout votre historique. ' +
        'Une erreur ici se retrouvera dans tous les mois suivants.'));

      if (!fiches.length) {
        ctx.corps.appendChild(Kit.ce('p', 'vide', 'Aucun contrat actif.'));
        return;
      }
      fiches.forEach(function (f) { ctx.corps.appendChild(carteReprise(f)); });
    }).catch(function (e) {
      Kit.vider(ctx.corps);
      ctx.corps.appendChild(Kit.warnbox('Impossible de charger vos contrats.',
        ' ' + Kit.messageErreur(e) + ' Vérifiez votre connexion, puis réessayez.'));
    });
  }

  function carteReprise(f) {
    var c = f.contrat;
    var p = Kit.pane(c.prenom_enfant);

    /* B7 — échec FERMÉ. Tant qu'on ne sait pas si des mois sont clôturés, on
       ne propose rien. Le refus dit pourquoi et ce qu'il faut faire ; il ne
       laisse pas croire à une interdiction définitive. */
    if (f.lectureRatee) {
      p.appendChild(Kit.warnbox(
        'Impossible de vérifier les mois de ' + c.prenom_enfant,
        ' ' + (f.erreurLecture ? Kit.messageErreur(f.erreurLecture)
                               : 'Les conditions de ce contrat n’ont pas pu être lues.') +
        ' Tant que cette vérification n’aboutit pas, la saisie reste fermée : ' +
        'modifier un point de départ après une clôture rendrait faux des mois ' +
        'déjà remis. Réessayez une fois le réseau revenu.'));
      return p;
    }

    if (f.cloturés.length) {
      /* A1 — REFUS, avec l'explication. Pas un champ grisé sans raison : la
         phrase dit ce qui bloque ET pourquoi. */
      p.appendChild(Kit.warnbox(
        'Impossible de modifier le point de départ de ' + c.prenom_enfant,
        ' Des mois sont déjà clôturés pour ce contrat. Modifier les chiffres de ' +
        'départ rendrait ces mois faux.'));
      if (f.compteur) {
        var lc = Kit.lines(p);
        Kit.ligne(lc, 'Point de départ', Kit.dateLongue(f.compteur.date_reference), { discret: true });
        Kit.ligne(lc, 'Récupération', Kit.heures(f.compteur.minutes_sup), { discret: true });
        Kit.ligne(lc, 'Congés payés acquis',
          Kit.joursCp(f.compteur.minutes_cp_acquis, mpjcDe(f)), { discret: true });
        Kit.ligne(lc, 'Congés payés déjà pris',
          Kit.joursCp(f.compteur.minutes_cp_pris, mpjcDe(f)), { discret: true });
      }
      return p;
    }

    var maintenant = global.App.moisCourant();
    var actuel = f.compteur || {};
    var dateRef = Kit.champDate('Date de reprise',
      actuel.date_reference || c.date_debut,
      { anneeMin: maintenant.annee - 5, anneeMax: maintenant.annee + 1 });
    p.appendChild(dateRef.bloc);

    /* La récupération se saisit en HEURES ET MINUTES, pas en minutes brutes :
       Maria lit « 12 h 30 » sur son papier, pas « 750 ».

       LOT 17 §17.5 — ELLE PEUT ÊTRE NÉGATIVE. Depuis que Maria peut libérer
       l'enfant plus tôt de son fait, son compteur de récupération peut passer
       sous zéro : c'est du temps qu'elle rendra. Une reprise de comptes doit
       donc pouvoir dire « je dois 1 h 30 ». Le sens est un CHOIX explicite,
       pas un signe moins à taper devant un nombre d'heures : un « -1 » dans un
       champ « heures » se lit de travers une fois sur deux, et l'erreur
       s'installe dans tout l'historique. */
    var minutesSup = actuel.minutes_sup || 0;
    var sens = Kit.champSelect('Votre récupération', [
      ['du', 'On me doit du temps'],
      ['je', 'Je dois du temps']
    ], minutesSup < 0 ? 'je' : 'du');
    p.appendChild(sens.bloc);

    var absSup = minutesSup < 0 ? -minutesSup : minutesSup;
    var heures = Kit.champ('Récupération accumulée — heures',
      String(Math.floor(absSup / 60)), { inputmode: 'numeric' });
    var minutes = Kit.champ('… et minutes',
      String(absSup % 60), { inputmode: 'numeric' });
    p.appendChild(heures.bloc);
    p.appendChild(minutes.bloc);

    /* Les congés payés se comptent en jours ET DEMI-JOURS : « 12,5 jours »
       est ce qui figure sur un bulletin. Le stockage, lui, est en MINUTES
       depuis le §17.6 — 12,5 jours × `minutes_par_jour_conge`. La saisie ne
       change pas d'un caractère ; c'est l'unité derrière qui change. */
    var parJour = mpjcDe(f);
    var acquis = Kit.champ('Congés payés acquis (en jours)',
      joursEnSaisie(actuel.minutes_cp_acquis, parJour),
      { inputmode: 'decimal', placeholder: '12,5' });
    var pris = Kit.champ('Congés payés déjà pris (en jours)',
      joursEnSaisie(actuel.minutes_cp_pris, parJour),
      { inputmode: 'decimal', placeholder: '3' });
    /* LOT 18 §18.6 — LA PHRASE PASSE DEVANT LES DEUX CHAMPS.
       Elle était sous eux : Maria saisissait 25 — le compte en jours ouvrés
       qu'elle a en tête — puis lisait, une ligne plus bas, qu'il fallait
       compter les samedis. Une saisie faite une seule fois, dont tout
       l'historique dérive, ne peut pas s'expliquer après coup. */
    p.appendChild(Kit.ce('p', 'sb q',
      /* §6.3 — la règle du décompte vient de `js/ui-kit.js`, en un seul
         exemplaire : la reprise des compteurs et le document doivent dire la
         même chose, sans quoi Maria saisit un chiffre selon une règle et
         l'application en applique une autre. */
      Kit.RESUME_RG06));
    p.appendChild(acquis.bloc);
    p.appendChild(pris.bloc);

    /* LOT 18 §18.6 — CE QUI EST ENCORE RATTRAPABLE, DIT AVANT D'ENREGISTRER.
       L'application ne le disait qu'une fois la porte fermée : « impossible de
       modifier, des mois sont déjà clôturés ». La même vérité, dite avant,
       enlève la peur de se tromper et empêche l'erreur définitive. */
    p.appendChild(Kit.ce('p', 'sb q',
      'Vous pourrez corriger ces valeurs tant qu’aucun mois postérieur n’est ' +
      'clôturé pour ' + c.prenom_enfant + '. Après, elles ne bougeront plus.'));

    var msg = Kit.ce('div', 'msg');
    p.appendChild(msg);

    var b = Kit.bouton('btn', function () {
      msg.textContent = ''; msg.className = 'msg';
      var h = Kit.parseEntier(heures.input.value, 0);
      var mn = Kit.parseEntier(minutes.input.value, 0);
      var a = saisieEnMinutes(acquis.input.value, parJour);
      var pr = saisieEnMinutes(pris.input.value, parJour);
      if (h === null || mn === null || a === null || pr === null) {
        msg.className = 'msg ko';
        msg.textContent = 'Un des chiffres est illisible (exemples : 12 et 30, ou 12,5).';
        return;
      }
      if (!parJour) {
        msg.className = 'msg ko';
        msg.textContent = 'Les conditions de ce contrat ne sont pas lisibles : ' +
          'impossible de savoir ce que vaut un jour de congé. Rien n’a été enregistré.';
        return;
      }
      /* A2 — le contrôle est fait ICI aussi, pour dire la vérité en français
         AVANT l'aller-retour. La contrainte en base reste la garantie. */
      if (pr > a) {
        msg.className = 'msg ko';
        msg.textContent = 'Vous ne pouvez pas avoir pris plus de congés que vous n’en avez acquis : ' +
          Kit.joursCp(pr, parJour) + ' pris pour ' + Kit.joursCp(a, parJour) + ' acquis.';
        return;
      }
      b.disabled = true;
      msg.textContent = 'Enregistrement…';
      global.DB.enregistrerCompteurInitial(c.id, {
        date_reference: dateRef.valeur(),
        minutes_sup: (sens.select.value === 'je' ? -1 : 1) * (h * 60 + mn),
        minutes_cp_acquis: a,
        minutes_cp_pris: pr
      }).then(function () {
        global.App.invalider();
        /* Le bouton REDEVIENT actif. Il ne rouvrira plus rien une fois un mois
           clôturé — la carte entière cède alors la place au refus expliqué —
           mais tant que rien n'est figé, Maria doit pouvoir corriger une faute
           de frappe dans la seconde qui suit. Un bouton resté mort après un
           succès n'apprend rien et fait croire à une panne. */
        b.disabled = false;
        msg.className = 'msg ok';
        msg.textContent = 'Point de départ enregistré pour ' + c.prenom_enfant + '.';
      }).catch(function (e) {
        b.disabled = false;
        msg.className = 'msg ko';
        msg.textContent = 'Enregistrement impossible : ' + Kit.messageErreur(e) +
          ' Vos chiffres sont toujours là.';
      });
    });
    b.textContent = 'Enregistrer le point de départ de ' + c.prenom_enfant;
    p.appendChild(b);
    return p;
  }

  /* LOT 17 §17.6 — le facteur de conversion des congés payés du contrat, pris
     sur l'avenant en vigueur AU MOIS DE LA REPRISE : c'est la valeur qui avait
     cours quand Maria tenait ces comptes-là sur papier. Zéro quand les
     conditions manquent — l'appelant refuse alors d'écrire plutôt que de
     convertir avec un diviseur inventé. */
  function mpjcDe(f) {
    var ref = (f.compteur && f.compteur.date_reference) || f.contrat.date_debut;
    if (!ref || !f.avenants) return 0;
    var cond = global.App.conditionsDuMois(f.avenants,
      Number(ref.slice(0, 4)), Number(ref.slice(5, 7)));
    /* Un point de départ antérieur au premier avenant : on prend le premier
       connu, faute de mieux, plutôt que de refuser une reprise légitime. */
    if (!cond && f.avenants.length) cond = f.avenants[0];
    return (cond && cond.minutes_par_jour_conge) || 0;
  }

  /* Minutes <-> saisie en jours. « 6 750 minutes » ne veut rien dire pour
     personne ; « 12,5 jours » est ce qui figure sur un bulletin. */
  function joursEnSaisie(minutes, parJour) {
    if (!minutes || !parJour) return '';
    var j = minutes / parJour;
    return String(Math.round(j * 10) / 10).replace('.', ',');
  }
  function saisieEnMinutes(txt, parJour) {
    var t = String(txt == null ? '' : txt).trim().replace(',', '.');
    if (t === '') return 0;
    if (!/^\d+(\.\d+)?$/.test(t)) return null;
    if (!parJour) return null;
    /* Un seul arrondi, sur le résultat en minutes : arrondir d'abord en
       dixièmes puis convertir ferait perdre des minutes à chaque saisie. */
    var v = Math.round(parseFloat(t) * parJour);
    if (isNaN(v) || v < 0) return null;
    return v;
  }

  /* ------------------------------------------------------------------ */
  /* LOT 14 — Export (V8-28)                                             */
  /*                                                                     */
  /* « À garder de côté » : c'est le filet de Maria si l'application      */
  /* disparaît, et la pièce qu'elle sortira si un désaccord remonte à     */
  /* plusieurs années. AUCUNE PHOTO — le retrait se fait dans db.js, à la */
  /* source.                                                             */
  /* ------------------------------------------------------------------ */

  function feuilleExport() {
    Kit.ouvrirFeuille('Exporter tout mon historique',
      'Tous vos mois, tous vos contrats, tous vos comptes.',
      function (corps) {
        corps.appendChild(Kit.ce('p', 'sb q',
          'Le fichier ne contient aucune photo. Les contrats terminés y figurent : ' +
          'ce sont eux qu’on vient chercher des années après.'));

        var msg = Kit.ce('div', 'msg');

        var bDoc = Kit.bouton('btn', function () { exporter('document', bDoc, msg); });
        bDoc.textContent = 'Document unique — lisible';
        corps.appendChild(bDoc);

        corps.appendChild(Kit.ce('p', 'sb q',
          'Le document contient TOUT : les mois, le détail des journées ' +
          'particulières, les congés et leur répartition, vos rémunérations ' +
          'successives et les réouvertures. Le tableau porte une ligne par mois, ' +
          'avec les conditions du contrat et le point de départ de vos compteurs ' +
          'sur chaque ligne — c’est ce qui s’ouvre dans un tableur.'));

        var bTab = Kit.bouton('btn nt', function () { exporter('tableau', bTab, msg); });
        bTab.textContent = 'Tableau — un mois par ligne';
        corps.appendChild(bTab);

        corps.appendChild(msg);
      });
  }

  function exporter(format, bouton, msg) {
    bouton.disabled = true;
    msg.className = 'msg';
    msg.textContent = 'Préparation…';
    global.DB.exporterHistorique().then(function (donnees) {
      donnees.exporte_le = global.App.aujourdhui();
      var texte = format === 'tableau' ? enTableau(donnees) : enDocument(donnees);
      var extension = format === 'tableau' ? 'csv' : 'txt';
      var type = format === 'tableau' ? 'text/csv;charset=utf-8' : 'text/plain;charset=utf-8';
      telechargerTexte(texte, 'recap-maria-' + donnees.exporte_le + '.' + extension, type);
      bouton.disabled = false;
      msg.className = 'msg ok';
      msg.textContent = 'Fichier prêt. Rangez-le en lieu sûr.';
    }).catch(function (e) {
      bouton.disabled = false;
      msg.className = 'msg ko';
      msg.textContent = 'L’export n’a pas abouti : ' + Kit.messageErreur(e) + ' Rien n’a été écrit.';
    });
  }

  function telechargerTexte(texte, nom, type) {
    var blob = new global.Blob([texte], { type: type });
    var url = global.URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = nom;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    global.setTimeout(function () { global.URL.revokeObjectURL(url); }, 1000);
  }

  /* Le document LISIBLE : un mois par section, en français, sans jargon. Il
     doit se comprendre seul, des années après, par quelqu'un qui n'a jamais
     vu l'application. */
  function enDocument(d) {
    var parContrat = {};
    (d.contrats || []).forEach(function (c) { parContrat[c.id] = c; });

    var out = ['RÉCAP MARIA — HISTORIQUE COMPLET',
               'Exporté le ' + Kit.dateLongue(d.exporte_le), ''];

    (d.contrats || []).forEach(function (c) {
      out.push('==============================================================');
      out.push(c.prenom_enfant + (c.nom ? ' ' + c.nom : '') +
        ' — famille ' + ((c.famille && c.famille.nom) || '—'));
      out.push('Du ' + Kit.dateLongue(c.date_debut) +
        (c.date_fin ? ' au ' + Kit.dateLongue(c.date_fin) : ' à aujourd’hui') +
        (c.archive ? ' (contrat terminé)' : ''));
      out.push('');

      var recaps = (d.recapitulatifs || []).filter(function (r) { return r.contrat_id === c.id; })
        .sort(function (a, b) { return (a.annee * 12 + a.mois) - (b.annee * 12 + b.mois); });
      if (!recaps.length) { out.push('  Aucun mois enregistré.'); out.push(''); return; }

      recaps.forEach(function (r) {
        var v = r.donnees || {};
        out.push('  ' + Kit.moisCapitale(r.annee, r.mois) +
          (r.statut === 'fige' ? ' — clôturé' : ' — en cours'));
        out.push('    Jours de présence      : ' + (v.joursPresence || 0));
        out.push('    Indemnité d’entretien  : ' + Kit.eur(v.entretienCentimes || 0));
        /* CORRECTION B4 — le net DÛ, celui qui figure sur le document. */
        out.push('    Salaire net            : ' + Kit.eur(Chaine.netDuMois(v)));
        out.push('    Total à verser         : ' + Kit.eur(v.totalAVerserCentimes || 0));
        out.push('    Heures supplémentaires : ' + Kit.heures(v.minutesSupAcquises || 0));
        out.push('    Congés décomptés       : ' + (v.joursCongesDecomptes || 0) + ' j ouvrables');
        out.push('');
      });
    });

    /* CORRECTIF A3 (lot 14) DE LA RELECTURE PR9 — L'EXPORT ÉTAIT AMPUTÉ.

       `exporterHistorique` remplit NEUF clés ; le document n'en lisait que
       DEUX. Aucune journée, aucun congé imputé, aucun barème, aucune
       réouverture — alors que l'écran le présente comme « la pièce qu'elle
       sortira si un désaccord remonte à plusieurs années ». Or c'est
       précisément le détail des journées et l'historique des réouvertures
       qu'on vient chercher dans ce cas-là, pas le total du mois. */

    var parId = {};
    (d.contrats || []).forEach(function (c) { parId[c.id] = c; });

    /* LOT 17 §17.2 — L'EXPORT PORTE LES AVENANTS, pas les seuls barèmes.
       C'est le seul endroit où l'historique complet des conditions se relit
       hors de l'application : un export qui ne porterait que le brut et le net
       ne permettrait pas de refaire un calcul de 2024, puisque le planning et
       l'entretien de l'époque auraient disparu. */
    var avenantsParContrat = grouper(d.avenants, 'contrat_id');
    var impParContrat = grouper(d.imputations, 'contrat_id');
    var jrsParContrat = grouper(d.journees, 'contrat_id');
    var departParContrat = {};
    (d.compteurs_initiaux || []).forEach(function (x) { departParContrat[x.contrat_id] = x; });

    (d.contrats || []).forEach(function (c) {
      var avenants = avenantsParContrat[c.id] || [];
      var imp = impParContrat[c.id] || [];
      /* LOT 16 §16.7 — TOUTE JOURNÉE QUI PORTE UN AJUSTEMENT, QUEL QUE SOIT
         SON TYPE. Le filtre excluait les journées de type `presence` : or ce
         sont elles qui portent les ajustements d'heures du lot 12 (minutes
         travaillées en plus, minutes auxquelles Maria a renoncé, décision au
         cas par cas sur les minutes dues). Un export annoncé comme « TOUT »
         perdait donc exactement ce qui explique un écart d'heures.
         Une journée de présence SANS ajustement reste hors du document : elle
         n'apprend rien et noierait le reste. */
      var jrs = (jrsParContrat[c.id] || []).filter(estJourneeParlante);
      var depart = departParContrat[c.id] || null;
      if (!avenants.length && !imp.length && !jrs.length && !depart) return;

      out.push('==============================================================');
      out.push('DÉTAIL — ' + c.prenom_enfant + (c.nom ? ' ' + c.nom : ''));
      out.push('');

      /* §16.7 — LES CONDITIONS DU CONTRAT, écrites nulle part jusqu'ici. Sans
         elles, aucun chiffre du document n'est vérifiable : on ne sait ni sur
         quels jours il a été gardé, ni combien vaut son entretien, ni combien
         de minutes fait un jour de congé. */
      /* LOT 17 — UNE SECTION PAR PÉRIODE DE CONDITIONS, et non plus un bloc
         unique pris sur `contrat`. Les réglages sont datés : les écrire une
         seule fois, aux valeurs d'aujourd'hui, ferait croire qu'ils ont
         toujours valu ça — et l'export existe précisément pour refaire un
         calcul ancien. */
      avenants.slice().sort(function (a, b) {
        return a.date_effet < b.date_effet ? -1 : 1;
      }).forEach(function (a) {
        out.push('  Conditions à partir du ' + Kit.dateLongue(a.date_effet) +
          ' — avenant n° ' + a.numero + (a.reconstitue ? ' (reconstitué)' : ''));
        out.push('    Jours de garde         : ' + libellePlanningLong(a.jours_planning));
        out.push('    Accueil                : ' + String(a.heure_arrivee).slice(0, 5) +
          ' → ' + String(a.heure_depart).slice(0, 5));
        out.push('    Durée de la journée    : ' + Kit.duree(a.minutes_contractuelles));
        out.push('    Minutes supplémentaires: ' + Kit.duree(a.minutes_sup_jour) + ' par jour travaillé');
        out.push('    Un jour de congé vaut  : ' + Kit.duree(a.minutes_par_jour_conge));
        out.push('    Entretien par présence : ' + Kit.eur(a.entretien_centimes_jour));
        out.push('    Si l’enfant est absent : ' + (a.sup_dues_si_enfant_absent === false
          ? 'les minutes supplémentaires ne sont pas dues'
          : 'les minutes supplémentaires restent dues'));
        out.push('    Congés déduits d’abord : ' + (a.ordre_imputation === 'sup_puis_cp'
          ? 'sur la récupération' : 'sur les congés payés'));
        out.push('    Rémunération           : ' +
          (a.brut_mensuel_centimes == null
            ? 'inconnue pour cette période'
            : 'brut ' + Kit.eur(a.brut_mensuel_centimes) +
              ', net ' + Kit.eur(a.net_mensuel_centimes || 0)));
        out.push('');
      });
      if (!avenants.length) {
        out.push('  Conditions du contrat : aucune enregistrée.');
        out.push('');
      }

      /* §16.7 — LE POINT DE DÉPART. C'est de lui que dérivent TOUS les soldes :
         sans lui, un compteur de congés payés lu dans l'export est un nombre
         sans origine, donc invérifiable. */
      if (depart) {
        out.push('  Point de départ des compteurs');
        out.push('    Repris au           : ' + Kit.dateLongue(depart.date_reference));
        out.push('    Récupération        : ' + Kit.heures(depart.minutes_sup || 0));
        /* §17.6 — les compteurs sont en minutes ; le facteur d'affichage est
           celui du PREMIER avenant, la valeur qui avait cours au moment de la
           reprise. Sans facteur connu, on écrit les minutes brutes plutôt
           qu'un nombre de jours inventé. */
        var facteur = avenants.length ? avenants[0].minutes_par_jour_conge : 0;
        out.push('    Congés payés acquis : ' + Kit.joursCp(depart.minutes_cp_acquis || 0, facteur));
        out.push('    Congés payés pris   : ' + Kit.joursCp(depart.minutes_cp_pris || 0, facteur));
        out.push('');
      } else {
        out.push('  Point de départ des compteurs : aucun — les compteurs partent de zéro');
        out.push('  au premier mois du contrat.');
        out.push('');
      }

      /* Les rémunérations successives ne font plus de section à part : elles
         vivent sur les avenants, avec le reste des conditions, ci-dessus. Les
         séparer redonnerait l'impression qu'elles seules sont datées — c'est
         exactement l'idée fausse que le lot 17 corrige. */

      if (imp.length) {
        out.push('  Congés posés et leur répartition');
        imp.forEach(function (i) {
          out.push('    du ' + Kit.dateLongue(i.date_debut) + ' au ' +
            Kit.dateLongue(i.date_fin) + ' — ' + i.jours_ouvrables + ' j ouvrables : ' +
            (i.jours_sur_cp || 0) + ' sur congés payés, ' +
            (i.jours_sur_sup || 0) + ' sur récupération, ' +
            (i.jours_sans_solde || 0) + ' sans solde');
        });
        out.push('');
      }

      if (jrs.length) {
        out.push('  Journées qui s’écartent de la normale');
        jrs.sort(function (a, b) { return a.jour < b.jour ? -1 : 1; }).forEach(function (j) {
          out.push('    ' + Kit.dateLongue(j.jour) + ' — ' + libelleTypeJournee(j.type) +
            (j.minutes_sup_exceptionnelles ? ' · +' + Kit.heures(j.minutes_sup_exceptionnelles) + ' travaillées en plus' : '') +
            (j.minutes_sup_renoncees ? ' · renoncé à ' + Kit.heures(j.minutes_sup_renoncees) : '') +
            (j.sup_dues_override === true ? ' · minutes supplémentaires dues ce jour-là' : '') +
            (j.sup_dues_override === false ? ' · minutes supplémentaires non dues ce jour-là' : '') +
            (j.minutes_reelles != null ? ' · ' + Kit.heures(j.minutes_reelles) + ' réellement travaillées' : '') +
            (j.entretien_centimes != null ? ' · entretien ' + Kit.eur(j.entretien_centimes) : ''));
        });
        out.push('');
      }
    });

    /* §16.7 — LES CONTRATS TYPES, chargés par `exporterHistorique` et jamais
       écrits. Le lot 17 retire leurs écrans mais CONSERVE la donnée en base
       (§17.9) : un export qui se dit complet doit donc continuer de la porter,
       même quand plus aucun écran ne la montre. C'est justement à ce
       moment-là qu'un export devient le seul endroit où elle est lisible. */
    if ((d.contrats_types || []).length) {
      out.push('==============================================================');
      out.push('CONTRATS TYPES — vos conditions habituelles, en versions datées');
      out.push('');
      d.contrats_types.slice().sort(function (a, b) {
        return String(a.date_effet) < String(b.date_effet) ? -1 : 1;
      }).forEach(function (m) {
        out.push('  ' + m.nom + ' — à partir du ' + Kit.dateLongue(m.date_effet));
        out.push('    Jours de garde : ' + libellePlanningLong(m.jours_planning) +
          ' · accueil ' + String(m.heure_arrivee).slice(0, 5) + ' → ' +
          String(m.heure_depart).slice(0, 5));
        out.push('    Entretien ' + Kit.eur(m.entretien_centimes_jour) +
          ' · ' + Kit.duree(m.minutes_sup_jour) + ' supplémentaires par jour');
      });
      out.push('');
    }

    if ((d.evenements || []).length) {
      out.push('==============================================================');
      out.push('RÉOUVERTURES ET CLÔTURES');
      out.push('');
      d.evenements.slice().sort(function (a, b) {
        return String(a.survenu_le) < String(b.survenu_le) ? -1 : 1;
      }).forEach(function (e) {
        out.push('  ' + String(e.survenu_le).slice(0, 10) + ' — ' + e.type +
          (e.motif ? ' : ' + e.motif : ''));
      });
      out.push('');
    }

    out.push('==============================================================');
    /* §6.3 — l'export dit exactement ce que dit le document. */
    out.push(Kit.ENCART_RG06);
    return out.join('\n');
  }

  /* LOT 16 §16.7 — Une journée entre dans le document si elle DIT quelque
     chose : un type autre que la présence ordinaire, ou un ajustement porté
     sur une journée de présence. Le filtre précédent ne regardait que le type
     et perdait tous les ajustements du lot 12. */
  function estJourneeParlante(j) {
    if (!j) return false;
    if (j.type && j.type !== 'presence') return true;
    return (j.minutes_sup_exceptionnelles || 0) > 0 ||
           (j.minutes_sup_renoncees || 0) > 0 ||
           j.sup_dues_override !== null && j.sup_dues_override !== undefined ||
           j.minutes_reelles != null ||
           j.entretien_centimes != null;
  }

  /* Le document doit se comprendre par quelqu'un qui n'a jamais vu
     l'application : aucun nom de colonne ne doit y apparaître tel quel. */
  var TYPES_JOURNEE = {
    presence: 'présence',
    absence_enfant: 'enfant absent',
    conge_maria: 'congé de l’assistante maternelle',
    sans_solde: 'jour sans solde',
    familiarisation: 'familiarisation',
    ferie: 'jour férié',
    hors_planning: 'hors planning'
  };
  function libelleTypeJournee(t) { return TYPES_JOURNEE[t] || t || 'journée'; }

  function grouper(liste, cle) {
    var out = {};
    (liste || []).forEach(function (x) {
      if (!x) return;
      if (!out[x[cle]]) out[x[cle]] = [];
      out[x[cle]].push(x);
    });
    return out;
  }

  /* Le TABLEAU : une ligne par mois et par contrat, ouvrable dans un tableur.
     Séparateur POINT-VIRGULE et non virgule : les montants français portent
     une virgule décimale, et un tableur francophone attend le point-virgule.
     Les montants sont exportés en CENTIMES ENTIERS pour rester exacts — un
     tableur qui relit « 1 610,00 » selon ses propres réglages introduirait un
     arrondi dans un chiffre qui n'en a jamais eu. */
  /* CORRECTION RELECTURE LOT 16 (C4) — LE TABLEAU AUSSI ANNONCE « TOUT ».

     Le §16.7 tranche : « on complète les DEUX formats existants ». Le document
     texte avait reçu les conditions du contrat et le point de départ des
     compteurs ; le tableau non, au motif que la phrase suivante ne parle que
     du « document ». Lecture trop étroite : c'est le format qui s'ouvre dans
     un tableur, et c'est celui qu'on trie et qu'on recoupe.

     LA FORME RESTE UN TABLEAU — une ligne = un mois. Pas de blocs en tête, qui
     casseraient la lecture d'un tableur. Les conditions et le point de départ
     deviennent donc des COLONNES, répétées sur chaque ligne du contrat.
     Redondant aujourd'hui, et c'est le prix du format tabulaire ; mais au
     lot 17 les conditions sont datées et changent d'un mois à l'autre — ces
     colonnes cesseront alors d'être constantes, et c'est là qu'elles prendront
     tout leur sens. */
  function enTableau(d) {
    var parContrat = {};
    (d.contrats || []).forEach(function (c) { parContrat[c.id] = c; });
    var departParContrat = {};
    (d.compteurs_initiaux || []).forEach(function (x) { departParContrat[x.contrat_id] = x; });
    /* LOT 17 §17.2 — LES CONDITIONS DE CHAQUE MOIS, pas celles d'aujourd'hui.

       Le lot 16 (C4) avait ajouté ces colonnes en les prenant sur `contrat` :
       une ligne de mars 2024 portait donc l'entretien de 2026. C'était le
       mieux qu'on pouvait faire avant les avenants ; ce ne l'est plus. Chaque
       ligne résout maintenant l'avenant en vigueur SON mois-là, par la même
       règle que le moteur — `Engine.conditionsApplicables`, jamais une
       sélection réécrite ici. */
    var avenantsParContrat = grouper(d.avenants, 'contrat_id');

    var lignes = [['enfant', 'famille', 'annee', 'mois', 'statut',
      'jours_presence', 'entretien_centimes', 'salaire_net_centimes',
      'total_a_verser_centimes', 'minutes_sup_acquises', 'jours_conges_decomptes',
      /* Conditions applicables — datées à partir du lot 17. */
      'avenant_numero', 'avenant_date_effet',
      'jours_de_garde', 'accueil_debut', 'accueil_fin', 'minutes_journee',
      'minutes_sup_par_jour', 'minutes_par_jour_conge', 'entretien_centimes_jour',
      'sup_dues_si_enfant_absent', 'ordre_imputation',
      'brut_mensuel_centimes', 'net_mensuel_centimes',
      /* §17.7 et §17.8 — le prorata d'un mois partiel, et le brut RÉELLEMENT
         dû, qui est l'assiette de l'indemnité de rupture. */
      'jours_couverts', 'jours_du_mois', 'brut_du_centimes',
      /* Point de départ des compteurs — l'origine de tous les soldes. */
      'depart_date_reference', 'depart_minutes_sup',
      'depart_minutes_cp_acquis', 'depart_minutes_cp_pris'].join(';')];

    (d.recapitulatifs || []).slice().sort(function (a, b) {
      return (a.annee * 12 + a.mois) - (b.annee * 12 + b.mois);
    }).forEach(function (r) {
      var c = parContrat[r.contrat_id] || {};
      var v = r.donnees || {};
      var dep = departParContrat[r.contrat_id] || {};
      var a = global.Engine.conditionsApplicables(
        avenantsParContrat[r.contrat_id] || [], r.annee, r.mois) || {};
      var pro = v.prorata || {};
      lignes.push([
        csv(c.prenom_enfant), csv((c.famille && c.famille.nom) || ''),
        r.annee, r.mois, r.statut === 'fige' ? 'clôturé' : 'en cours',
        /* CORRECTION B4 — `salaire_net_centimes` est le net DÛ du mois, celui
           du document. Le net CONTRACTUEL a sa propre colonne plus loin,
           `net_mensuel_centimes` : les deux se lisent, et ne se confondent
           plus. */
        v.joursPresence || 0, v.entretienCentimes || 0, Chaine.netDuMois(v),
        v.totalAVerserCentimes || 0, v.minutesSupAcquises || 0, v.joursCongesDecomptes || 0,
        a.numero == null ? '' : a.numero,
        csv(a.date_effet || ''),
        csv((a.jours_planning || []).join(' ')),
        csv(String(a.heure_arrivee || '').slice(0, 5)),
        csv(String(a.heure_depart || '').slice(0, 5)),
        a.minutes_contractuelles == null ? '' : a.minutes_contractuelles,
        a.minutes_sup_jour == null ? '' : a.minutes_sup_jour,
        a.minutes_par_jour_conge == null ? '' : a.minutes_par_jour_conge,
        a.entretien_centimes_jour == null ? '' : a.entretien_centimes_jour,
        a.sup_dues_si_enfant_absent === false ? 'non' : 'oui',
        csv(a.ordre_imputation === 'sup_puis_cp' ? 'recuperation_puis_cp' : 'cp_puis_recuperation'),
        /* Le brut et le net du MOIS, tels que l'instantané les porte : ce sont
           eux qui ont servi au calcul de cette ligne, pas ceux d'aujourd'hui. */
        v.salaireBrutCentimes == null ? '' : v.salaireBrutCentimes,
        v.salaireNetCentimes == null ? '' : v.salaireNetCentimes,
        pro.joursCouverts == null ? '' : pro.joursCouverts,
        pro.joursDuMois == null ? '' : pro.joursDuMois,
        /* CORRECTION C1 — la troisième copie de la règle du §17.8 a disparu :
           le brut dû se lit là où il est défini, dans la chaîne. */
        Chaine.brutDuCentimes(v),
        csv(dep.date_reference || ''),
        dep.minutes_sup == null ? '' : dep.minutes_sup,
        dep.minutes_cp_acquis == null ? '' : dep.minutes_cp_acquis,
        dep.minutes_cp_pris == null ? '' : dep.minutes_cp_pris
      ].join(';'));
    });
    return lignes.join('\n');
  }

  function csv(v) {
    var t = String(v == null ? '' : v);
    return /[";\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  }

  /* ------------------------------------------------------------------ */
  /* LOT 15 — Rappels par notification (V8-26)                           */
  /*                                                                     */
  /* Ce lot dépend de trois choses hors de notre portée : un service qui  */
  /* envoie, la permission du téléphone, et — sur iPhone — l'application  */
  /* installée sur l'écran d'accueil. Chacune peut manquer.               */
  /*                                                                     */
  /* D'où la règle qui structure cet écran : LA PASTILLE FONCTIONNE       */
  /* TOUJOURS. Elle ne demande ni permission, ni serveur, ni installation.*/
  /* Les notifications sont un confort par-dessus ; la pastille est le    */
  /* filet. Quand la permission est refusée, on le DIT et on rappelle que */
  /* le filet est là — plutôt que de laisser Maria croire qu'un rappel    */
  /* viendra alors qu'il ne viendra jamais (risque n° 1).                 */
  /* ------------------------------------------------------------------ */

  /* A3 — CE TEXTE EST DUPLIQUÉ dans supabase/functions/rappels-cloture.
     Impossible de le partager : l'un tourne dans un navigateur, l'autre dans
     Deno. Toute modification doit être faite AUX DEUX ENDROITS, et le test de
     fumée du lot 15 compare les deux chaînes caractère par caractère. */
  function texteDuRappel(nb) {
    return nb === 1 ? 'Il vous reste 1 mois à clôturer.'
                    : 'Il vous reste ' + nb + ' mois à clôturer.';
  }

  /* ------------------------------------------------------------------ */
  /* LOT 16 §16.2 — Mon nom sur les documents                            */
  /* ------------------------------------------------------------------ */

  /* Le récapitulatif remis à une famille était signé par l'adresse e-mail du
     compte. Cet écran est le seul endroit où ce nom se saisit, et la phrase
     qui l'accompagne dit à quoi il sert — sans quoi Maria n'a aucune raison
     de le renseigner.

     Ce qui est déjà clôturé ne bouge pas : le nom entre dans l'instantané au
     moment de la clôture. Il faut le dire ici, pas le découvrir après. */
  function afficherCompte(ctx) {
    global.App.barreRetour(ctx.barre, 'Mon nom sur les documents');
    ctx.corps.appendChild(Kit.ce('div', 'attente', 'Lecture de votre nom…'));

    return global.DB.getEmettrice()
      .then(function (e) {
        global.App.poserNomEmettrice(e && e.nom ? e.nom : '');
        Kit.vider(ctx.corps);
        rendreCompte(ctx.corps, e && e.nom ? e.nom : '');
      })
      .catch(function (err) {
        Kit.vider(ctx.corps);
        /* L'échec est dit jusqu'au bout, et l'écran reste utilisable : Maria
           peut saisir son nom, l'enregistrement dira ce qu'il en advient. */
        ctx.corps.appendChild(Kit.warnbox('Votre nom n’a pas pu être lu',
          ' ' + Kit.messageErreur(err) +
          ' Vous pouvez le saisir ci-dessous : il remplacera ce qui est enregistré.'));
        rendreCompte(ctx.corps, '');
      });
  }

  function rendreCompte(corps, nomActuel) {
    var p = Kit.pane('Votre nom');
    var champNom = Kit.champ('Nom affiché sur les documents', nomActuel,
      { placeholder: 'Par exemple : Maria' });
    p.appendChild(champNom.bloc);
    p.appendChild(Kit.ce('p', 'sb q',
      'Chaque récapitulatif remis à une famille portera « Établi par ' +
      (nomActuel || 'votre nom') + ' ». Tant que rien n’est renseigné, il indique ' +
      '« votre assistante maternelle » — jamais votre adresse e-mail.'));
    corps.appendChild(p);

    corps.appendChild(Kit.note('Les mois déjà clôturés ne changent pas',
      'Un récapitulatif clôturé garde le nom qu’il portait ce jour-là. C’est ce qui ' +
      'fait qu’un document remis à une famille ne se réécrit jamais tout seul.'));

    var msg = Kit.ce('div', 'msg');
    var b = Kit.bouton('btn', function () {
      var nom = (champNom.input.value || '').trim();
      if (!nom) {
        msg.className = 'msg ko';
        msg.textContent = 'Écrivez le nom que vous voulez voir sur vos documents.';
        return;
      }
      b.disabled = true;
      msg.className = 'msg';
      msg.textContent = 'Enregistrement…';
      global.DB.enregistrerEmettrice(nom)
        .then(function () {
          b.disabled = false;
          global.App.poserNomEmettrice(nom);
          msg.className = 'msg ok';
          msg.textContent = 'Vos prochains documents seront établis par ' + nom + '.';
          global.App.invalider();
        })
        .catch(function (e) {
          /* La saisie reste à l'écran : rien n'est perdu en silence. */
          b.disabled = false;
          msg.className = 'msg ko';
          msg.textContent = 'Votre nom n’a pas pu être enregistré : ' +
            Kit.messageErreur(e) + ' Il est toujours écrit ci-dessus.';
        });
    });
    b.textContent = 'Enregistrer';
    corps.appendChild(b);
    corps.appendChild(msg);
  }

  function afficherRappels(ctx) {
    global.App.barreRetour(ctx.barre, 'Me rappeler de clôturer');
    ctx.corps.appendChild(Kit.ce('div', 'attente', 'Lecture de vos réglages…'));

    return global.DB.getPreferenceRappel().catch(function () { return null; })
      .then(function (pref) {
        Kit.vider(ctx.corps);
        rendreRappels(ctx.corps, pref || { actif: false, jour_du_mois: 25,
          heure: '19:00', chaque_jour_ensuite: true });
      });
  }

  function rendreRappels(corps, pref) {
    var etat = {
      actif: !!pref.actif,
      jour: pref.jour_du_mois || 25,
      heure: String(pref.heure || '19:00').slice(0, 5),
      chaque: pref.chaque_jour_ensuite !== false
    };

    var p = Kit.pane('Me rappeler de clôturer mes mois');

    var ligneActif = Kit.ce('label', 'coche-ligne');
    var boxActif = document.createElement('input');
    boxActif.type = 'checkbox';
    boxActif.checked = etat.actif;
    ligneActif.appendChild(boxActif);
    var txA = Kit.ce('span', 'tx');
    txA.appendChild(Kit.ce('b', null, 'Recevoir un rappel sur mon téléphone'));
    txA.appendChild(Kit.ce('span', 'd',
      'Même application fermée, si votre téléphone l’autorise.'));
    ligneActif.appendChild(txA);
    p.appendChild(ligneActif);

    var reglages = Kit.ce('div');
    var selJour = Kit.champSelect('À partir du … du mois',
      joursPossibles(), String(etat.jour));
    reglages.appendChild(selJour.bloc);
    var selHeure = Kit.champSelect('À', heuresPossibles(), etat.heure);
    reglages.appendChild(selHeure.bloc);

    var ligneChaque = Kit.ce('label', 'coche-ligne');
    var boxChaque = document.createElement('input');
    boxChaque.type = 'checkbox';
    boxChaque.checked = etat.chaque;
    ligneChaque.appendChild(boxChaque);
    var txC = Kit.ce('span', 'tx');
    txC.appendChild(Kit.ce('b', null, 'Puis chaque jour tant qu’un mois n’est pas clôturé'));
    ligneChaque.appendChild(txC);
    reglages.appendChild(ligneChaque);
    p.appendChild(reglages);

    /* L'APERÇU du message, sous les réglages. Maria voit exactement ce qui
       arrivera sur son écran. */
    var apercu = Kit.ce('div', 'apercu-rappel');
    apercu.appendChild(Kit.ce('b', null, 'Récap'));
    apercu.appendChild(Kit.ce('span', null, ' — ' + texteDuRappel(2)));
    p.appendChild(Kit.ce('p', 'sb q', 'Ce que vous verrez :'));
    p.appendChild(apercu);

    var msg = Kit.ce('div', 'msg');
    p.appendChild(msg);

    function majVisibilite() { reglages.hidden = !boxActif.checked; }
    boxActif.addEventListener('change', function () {
      majVisibilite();
      if (boxActif.checked) demanderPermission(msg, boxActif);
    });
    majVisibilite();

    var b = Kit.bouton('btn', function () {
      b.disabled = true;
      msg.className = 'msg';
      msg.textContent = 'Enregistrement…';
      global.DB.enregistrerPreferenceRappel({
        actif: boxActif.checked,
        jour_du_mois: Number(selJour.select.value),
        heure: selHeure.select.value,
        chaque_jour_ensuite: boxChaque.checked
      }).then(function () {
        b.disabled = false;
        msg.className = 'msg ok';
        msg.textContent = 'Réglages enregistrés.';
      }).catch(function (e) {
        b.disabled = false;
        msg.className = 'msg ko';
        msg.textContent = 'Enregistrement impossible : ' + Kit.messageErreur(e) +
          ' Vos réglages sont toujours là.';
      });
    });
    b.textContent = 'Enregistrer';
    p.appendChild(b);
    corps.appendChild(p);

    /* A5 — LE FILET, dit explicitement. */
    /* CORRECTIF A4 (lot 15) DE LA RELECTURE PR9 — CETTE PHRASE ÉTAIT FAUSSE.

       « Elle fonctionne partout, sans permission et sans réseau » : la pastille
       est calculée à partir des mois lus au chargement de l'accueil. Si TOUT
       échoue, elle est retirée plutôt que laissée à une valeur périmée — un
       chiffre faux vaut moins que pas de chiffre, et ce choix-là est le bon.
       Mais il faut alors cesser de promettre le contraire. */
    corps.appendChild(Kit.note('Dans tous les cas, une pastille',
      'Que les notifications soient activées ou non, l’onglet Accueil porte une ' +
      'pastille dès qu’un mois est à clôturer. Elle ne demande ni autorisation ' +
      'du téléphone, ni service extérieur : elle vient de vos propres chiffres. ' +
      'Sans réseau au démarrage, l’application ne peut rien calculer et le dit ' +
      '— la pastille n’apparaît pas plutôt que d’afficher un nombre périmé.'));
  }

  function joursPossibles() {
    var out = [];
    for (var j = 20; j <= 31; j++) out.push([String(j), String(j)]);
    return out;
  }
  /* CORRECTIF A5 DE LA RELECTURE PR9 — LES DEMI-HEURES SONT RETIRÉES.

     L'écran proposait « 20 h 30 » ; la fonction serveur ne lit que les deux
     premiers caractères de l'heure et la planification est de toute façon
     HORAIRE. Le rappel arrivait donc à 20 h 00, et rien ne le disait. Plutôt
     que de faire semblant d'accepter un réglage qu'on ne sait pas tenir, on ne
     le propose plus : une liste plus courte vaut mieux qu'un choix qui ment. */
  function heuresPossibles() {
    var out = [];
    for (var h = 7; h <= 22; h++) {
      var hh = String(h).padStart(2, '0');
      out.push([hh + ':00', hh + ' h']);
    }
    return out;
  }

  /* A2 — LE REFUS DE PERMISSION EST EXPLIQUÉ EN FRANÇAIS, sans terme
     technique, et la pastille prend le relais. Le pire serait de laisser la
     case cochée : Maria croirait qu'un rappel viendra, et il ne viendrait
     jamais. */
  function demanderPermission(msg, boxActif) {
    if (!global.Notification || !global.navigator || !global.navigator.serviceWorker) {
      msg.className = 'msg ko';
      msg.textContent = 'Ce téléphone ne sait pas afficher de notifications. ' +
        'La pastille dans l’application prendra le relais.';
      decocher(boxActif);
      return;
    }
    global.Notification.requestPermission().then(function (reponse) {
      if (reponse === 'granted') {
        msg.className = 'msg ok';
        msg.textContent = 'Notifications autorisées.';
        return abonner().catch(function (e) {
          /* CORRECTIF B8 DE LA RELECTURE PR9 — LA CASE SE DÉCOCHE ICI AUSSI.

             Les deux autres branches — permission refusée, téléphone incapable
             — décochaient bien. Celle-ci, « permission accordée mais
             abonnement raté », laissait la case COCHÉE : Maria appuyait sur
             Enregistrer, lisait « Réglages enregistrés » en vert, et aucun
             rappel n'arrivait jamais. Aucun abonnement n'existait côté
             serveur, la boucle d'envoi ne la voyait pas.

             Et c'était le chemin NOMINAL : `config.js` livre la clé publique
             VIDE tant qu'Adrien n'a pas généré la paire VAPID, donc
             `abonner()` rejetait systématiquement. L'écran affirmait donc
             l'inverse de ce qui allait se passer — le pire des deux mondes. */
          decocher(boxActif);
          msg.className = 'msg ko';
          msg.textContent = 'L’abonnement n’a pas abouti : ' + Kit.messageErreur(e) +
            ' Les rappels restent éteints ; la pastille de l’onglet Accueil ' +
            'prend le relais.';
        });
      }
      msg.className = 'msg ko';
      msg.textContent = 'Les notifications sont bloquées sur ce téléphone. ' +
        'Vous les retrouverez dans les réglages de votre téléphone, à la ligne ' +
        'Récap. En attendant, un rappel s’affichera dans l’application.';
      decocher(boxActif);
    });
  }

  /* Décocher ET prévenir l'écran : la case pilote la visibilité des réglages
     fins. La changer en silence laisserait des réglages affichés pour des
     rappels éteints. Un seul endroit, pour que les trois branches d'échec
     fassent exactement la même chose (correctif B8). */
  function decocher(boxActif) {
    boxActif.checked = false;
    var ev = document.createEvent('Event');
    ev.initEvent('change', true, true);
    boxActif.dispatchEvent(ev);
  }

  /* L'abonnement de CET appareil. La clé publique VAPID vient de config.js —
     elle est publique par nature, contrairement à la privée qui ne quitte
     jamais les secrets de la fonction serveur (A4). */
  function abonner() {
    var cfg = global.RECAP_MARIA_CONFIG || {};
    var clePublique = cfg.VAPID_PUBLIC_KEY;
    if (!clePublique) {
      var e = new Error('VAPID_PUBLIC_KEY absente de config.js');
      /* La phrase est écrite pour Maria et traverse messages.js intacte
         (correctif B8) : sans ce marquage elle tombait sur « une erreur
         inattendue s'est produite. Réessayez… », qui invitait à réessayer une
         action structurellement impossible. */
      e.messageFrancais = 'les notifications ne sont pas encore configurées sur ' +
        'ce compte.';
      return Promise.reject(e);
    }
    return global.navigator.serviceWorker.ready.then(function (reg) {
      return reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64EnOctets(clePublique)
      });
    }).then(function (ab) {
      var brut = ab.toJSON();
      return global.DB.enregistrerAbonnementPush({
        endpoint: brut.endpoint,
        cle_p256dh: brut.keys.p256dh,
        cle_auth: brut.keys.auth
      });
    });
  }

  function base64EnOctets(base64) {
    var complet = (base64 + '='.repeat((4 - base64.length % 4) % 4))
      .replace(/-/g, '+').replace(/_/g, '/');
    var brut = global.atob(complet);
    var octets = new Uint8Array(brut.length);
    for (var i = 0; i < brut.length; i++) octets[i] = brut.charCodeAt(i);
    return octets;
  }

  function deconnecter(bouton) {
    bouton.disabled = true;
    global.App.deconnecter().catch(function () { bouton.disabled = false; });
  }

  global.UiMenu = {
    afficher: afficher,
    texteDuRappel: texteDuRappel,
    /* CORRECTIF B5 DE LA RELECTURE PR9 — la feuille de création était PRIVÉE.
       L'écran vide proposait « Ajouter mon premier enfant » et envoyait vers
       la fiche d'un contrat inexistant : « Écran indisponible », avec un
       bouton « Réessayer » qui rejouait le même échec. V8-29 décrit un écran
       vide ACTIONNABLE ; il était livré en cul-de-sac, sur le seul chemin
       qu'il décrit. */
    nouvelEnfant: feuilleNouvelEnfant
  };
})(window);
