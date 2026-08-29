/* ============================================================================
   app.js — Orchestration de l'application (lot 6, refonte de l'interface).

   Trois responsabilités, et rien d'autre :

   1. LA PORTE. Session Supabase persistante : connectée un jour, connectée
      toujours, jusqu'à déconnexion volontaire (§3 des specs). Après
      reconnexion automatique, l'atterrissage se fait DIRECTEMENT sur l'Accueil,
      jamais sur l'écran de connexion.

   2. LA NAVIGATION. Deux logiques qui ne se mélangent jamais (§1 des specs) :
      - trois écrans racine (Accueil, Mes congés, Menu) portés par la barre
        d'onglets du bas ;
      - tout le reste (espace enfant, document, historique, bilan, fiche
        contrat, période) en navigation par bouton retour, sur une pile.
      La barre d'onglets n'apparaît QUE sur les trois écrans racine.

   3. LES SERVICES PARTAGÉS. Liste des contrats, mois courant, et surtout le
      CACHE des chaînes de mois : chaque écran a besoin de la même chaîne
      (accueil, espace enfant, document, historique, congés). La rejouer une
      fois par écran ferait quatre relectures complètes de l'historique à
      chaque touche. Le cache est vidé à la moindre écriture.

   Aucun calcul métier ici. Aucun accès réseau direct : tout passe par DB.
   ========================================================================= */
(function (global) {
  'use strict';

  var Kit = global.Kit;
  var Chaine = global.ChaineMois;

  /* Écrans -> module global. Les trois premiers portent la barre d'onglets. */
  /* Lot 8 — quatre onglets. L'ordre de la barre est aussi celui du tableau :
     c'est lui qui décide de ce qui est un écran RACINE (pile remise à zéro,
     barre visible) et de ce qui est un sous-écran atteint par un retour. */
  var ONGLETS = ['accueil', 'historique', 'conges', 'menu'];

  /* LOT 22 §22.3 — LA BARRE SUIT LES ÉCRANS INTÉRIEURS.

     Elle disparaissait dès qu'on descendait d'un cran : ouvrir l'espace d'un
     enfant, une fiche, un document, et Maria n'avait plus qu'un chevron de
     retour. Sur un téléphone en mode installé, sans barre de navigateur, c'est
     le seul repère qui reste — et il ne dit pas où l'on est.

     La barre reste donc affichée partout, avec l'onglet PARENT actif :
     « Accueil » sur un espace enfant, « Menu » sur une fiche de contrat. Ce
     n'est pas un raccourci de navigation de plus : c'est la réponse à « où
     suis-je ». Le §22.3 le demande, et il prime sur le §B.1 du référentiel,
     qui dit encore que la barre n'existe que sur trois écrans racine.

     Un écran absent de cette table n'a pas de parent : la barre y reste
     masquée. C'est le cas de la connexion et du verrou. */
  var ONGLET_PARENT = {
    accueil: 'accueil', enfant: 'accueil', document: 'accueil', finDeMois: 'accueil',
    historique: 'historique', bilan: 'historique', periode: 'historique',
    conges: 'conges',
    menu: 'menu', fiche: 'menu', familles: 'menu', enfants: 'menu',
    familiarisation: 'menu', reprise: 'menu', rappels: 'menu', compte: 'menu',
    /* LOT 27 §27.1 — « Comment l'application compte », atteint depuis le
       Menu, dont il garde donc l'onglet actif. */
    regles: 'menu'
  };
  var ECRANS = {
    accueil: 'UiAccueil',
    conges: 'UiConges',
    menu: 'UiMenu',
    enfant: 'UiEnfant',
    document: 'UiDocument',
    historique: 'UiHistorique',
    bilan: 'UiHistorique',       // le bilan annuel est rendu par le même module
    fiche: 'UiContrat',
    periode: 'UiPeriode',
    /* LOT 20 (§20.4 d) — l'écran de la période de familiarisation, atteint
       depuis la fiche du contrat. Sous-écran : la barre d'onglets reste
       masquée, et le retour ramène à la fiche. */
    familiarisation: 'UiFamiliarisation',
    /* Lot 7 — la fin de mois guidée est rendue par le module d'accueil, qui
       distingue les deux vues. La spécification réserve au lot une liste de
       fichiers close : plutôt que d'y ajouter `ui-fin-de-mois.js` de ma propre
       initiative, l'écran vit dans `ui-accueil.js`. Signalé en restitution. */
    finDeMois: 'UiAccueil',
    familles: 'UiMenu',         // lot 8 — rendu par le module du Menu
    /* LOT 22 §22.1 — la page « Mes enfants », rendue par le même module que le
       Menu dont elle est la première entrée. */
    enfants: 'UiMenu',
    /* LOT 17 §17.9 — `modeles` et `modifGroupee` sortent du registre : plus
       aucune entrée de Menu n'y mène, et une route encore branchée serait un
       écran atteignable par un lien de retour ou une URL restée en cache.
       Le code des deux écrans reste dans `js/ui-menu.js`, mort et signalé ;
       son retrait appartient au §19.2. */
    reprise: 'UiMenu',          // lot 14 — reprendre mes comptes
    rappels: 'UiMenu',          // lot 15 — rappels par notification
    compte: 'UiMenu',           // lot 16 §16.2 — mon nom sur les documents
    /* LOT 27 §27.1 — L'ENDROIT UNIQUE DES RÈGLES.

       ÉCART ASSUMÉ AU PÉRIMÈTRE : le §27.1 propose « un nouveau module léger
       js/ui-regles.js si tu préfères, entré dans index.html et sw.js ». Cet
       écran est une liste de sept replis sans état, sans lecture en base et
       sans écriture. Lui donner un fichier, une balise `script` de plus au
       chargement et une entrée dans la liste de pré-cache coûterait plus que
       ce qu'il pèse. Il est rendu par le module du Menu, dont il est la
       troisième entrée — comme `reprise`, `rappels` et `compte` avant lui.

       Ces deux lignes sont les SEULES touchées dans `js/app.js` : le §27
       n'annonce pas ce fichier, mais un écran doit être routé pour exister. */
    regles: 'UiMenu'
  };

  var el = {};
  var etat = {
    session: null,
    email: null,
    contrats: [],        // contrats NON archivés, triés par prénom
    contratsTous: null,  // chargés à la demande (Menu : anciens contrats)
    pile: [],            // [{ ecran, params }] — le dernier est affiché
    series: {},          // cache : contratId|YYYY-MM -> Promise(chaîne)
    journees: {},        // cache : contratId|YYYY-MM -> Promise({ jour: ligne })
    /* LOT 17 §17.2 — les conditions du contrat, datées. Elles sont lues par
       tous les écrans qui ont besoin d'un réglage (le planning, les minutes
       d'un jour de congé, l'entretien) et qui n'ont pas de chaîne sous la
       main. Elles ne changent qu'à l'écriture d'un avenant, d'où le cache. */
    avenants: {},        // cache : contratId -> Promise([avenant…])
    recaps: {},          // cache : YYYY-MM -> Promise({ contratId: recap|null })
    pret: false,
    chargement: false,
    utilisateur: null,
    /* LOT 16 §16.2 — le nom qui signe les documents. `null` = pas encore lu ou
       lecture en échec ; chaîne vide = lue, non renseignée. Les deux mènent au
       même texte sur le document (« votre assistante maternelle »), mais seul
       le second déclenche l'encart qui invite à la saisie. */
    emettrice: null,
    emettriceLue: false
  };

  /* ------------------------------------------------------------------ */
  /* Démarrage                                                           */
  /* ------------------------------------------------------------------ */

  document.addEventListener('DOMContentLoaded', function () {
    el.login = document.getElementById('vue-login');
    el.app = document.getElementById('vue-app');
    el.barre = document.getElementById('barre');
    el.corps = document.getElementById('corps');
    el.tabbar = document.getElementById('tabbar');

    /* Correction A12 (relecture lot 6) : le service worker s'enregistre AVANT
       le garde-fou ci-dessous. C'est précisément quand le client Supabase du
       CDN n'a PAS pu être chargé que poser le cache a le plus de valeur — sans
       cela, le lancement suivant hors ligne échouerait de la même façon. */
    enregistrerServiceWorker();

    /* Sans le client Supabase (premier lancement hors ligne, CDN injoignable),
       db.js n'a pas pu se construire. On le dit en français plutôt que de
       laisser une page blanche. */
    if (!global.DB) {
      el.login.hidden = true;
      el.app.hidden = false;
      el.barre.hidden = true;
      el.corps.appendChild(Kit.ce('div', 'attente',
        'Application indisponible pour l’instant : la connexion à internet est nécessaire ' +
        'au premier lancement.\nRéessayez une fois le réseau revenu.'));
      return;
    }

    cablerLogin();
    cablerOnglets();
    cablerRetourSysteme();

    global.DB.onAuthChange(function (session) {
      if (session) entrer(session);
      else { etat.utilisateur = null; etat.pret = false; montrerLogin(); }
    });

    global.DB.getSession()
      .then(function (session) { if (session) entrer(session); else montrerLogin(); })
      .catch(function (e) { messageLogin('Connexion impossible : ' + Kit.messageErreur(e)); montrerLogin(); });
  });

  function cablerLogin() {
    var form = document.getElementById('form-login');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = document.getElementById('login-email').value.trim();
      var mdp = document.getElementById('login-mdp').value;
      var btn = document.getElementById('btn-login');
      if (!email || !mdp) { messageLogin('Renseignez votre e-mail et votre mot de passe.'); return; }
      btn.disabled = true;
      messageLogin('Connexion…');
      global.DB.signIn(email, mdp)
        .then(function () { messageLogin(''); })
        .catch(function (err) {
          messageLogin('Connexion refusée : ' + Kit.messageErreur(err));
          btn.disabled = false;
        });
    });

    /* LOT 14 (A6) — « Mot de passe oublié ».
       LE MESSAGE EST LE MÊME DANS TOUS LES CAS, y compris quand l'adresse est
       inconnue : « Si un compte existe pour cette adresse… ». C'est le
       conditionnel qui fait tout le travail. Un formulaire qui répondrait
       « aucun compte ne correspond » permettrait à n'importe qui de savoir si
       une adresse a un compte ici — et ce qu'il y a derrière, ce sont les
       revenus d'une personne et les noms de quatre enfants.
       Seul un échec de RÉSEAU est distingué : Maria doit savoir que rien
       n'est parti. */
    var bOubli = document.getElementById('btn-oubli');
    if (bOubli) {
      bOubli.addEventListener('click', function () {
        var email = document.getElementById('login-email').value.trim();
        if (!email) {
          messageLogin('Renseignez votre adresse e-mail, puis touchez « Mot de passe oublié ».');
          return;
        }
        bOubli.disabled = true;
        messageLogin('Envoi…');
        global.DB.demanderReinitialisation(email)
          .then(function () {
            messageLogin('Si un compte existe pour cette adresse, un message vient d’être envoyé.');
          })
          .catch(function (err) {
            messageLogin('L’envoi n’a pas abouti : ' + Kit.messageErreur(err));
          })
          .then(function () { bOubli.disabled = false; });
      });
    }
  }

  function messageLogin(txt) {
    var m = document.getElementById('msg-login');
    if (m) { m.textContent = txt || ''; m.className = 'msg' + (txt && txt !== 'Connexion…' ? ' ko' : ''); }
  }

  function montrerLogin() {
    el.app.hidden = true;
    el.login.hidden = false;
    var btn = document.getElementById('btn-login');
    if (btn) btn.disabled = false;
    Kit.fermerFeuille();
  }

  /* `reessayer` : sans lui, un échec de chargement au démarrage laisse un écran
     SANS AUCUN élément cliquable — barre d'onglets masquée, pile vide, et rien
     ne repart quand le réseau revient (relecture lot 6, A9). */
  function attente(texte, reessayer) {
    el.login.hidden = true;
    el.app.hidden = false;
    el.tabbar.hidden = true;
    Kit.vider(el.barre);
    el.barre.className = 'bar';
    el.barre.appendChild(Kit.ce('span', 'ti', 'Récap'));
    Kit.vider(el.corps);
    el.corps.appendChild(Kit.ce('div', 'attente', texte));
    if (reessayer) {
      var b = Kit.bouton('btn', reessayer);
      b.textContent = 'Réessayer';
      el.corps.appendChild(b);
      var d = Kit.bouton('btn nt', function () { deconnecter().catch(function () { return null; }); });
      d.textContent = 'Se déconnecter';
      el.corps.appendChild(d);
    }
  }

  /* Entrée dans l'application. Un simple rafraîchissement de jeton ne doit ni
     relancer le chargement, ni ramener Maria de force sur l'Accueil en pleine
     saisie : on compare l'utilisateur. */
  function entrer(session) {
    var uid = (session && session.user) ? session.user.id : null;
    if (etat.pret && uid && uid === etat.utilisateur) return;
    if (etat.chargement) return;

    etat.chargement = true;
    etat.utilisateur = uid;
    etat.session = session;
    etat.email = (session && session.user) ? session.user.email : null;
    etat.pret = false;
    viderCaches();
    attente('Chargement de vos contrats…');

    /* Le nom de l'émettrice est lu en même temps que les contrats : il est
       nécessaire à tout document, et un aller-retour de plus par document
       serait payé sur chaque écran. Son échec n'empêche RIEN — le document
       écrira « votre assistante maternelle », jamais une adresse e-mail. */
    Promise.all([
      global.DB.listContratsActifs(),
      global.DB.getEmettrice().then(function (e) {
        etat.emettriceLue = true;
        return e && e.nom ? e.nom : '';
      }).catch(function () { etat.emettriceLue = false; return null; })
    ])
      .then(function (r) {
        var liste = r[0];
        etat.emettrice = r[1];
        etat.contrats = liste || [];
        etat.pret = true;
        etat.pile = [];
        return aller('accueil', {}, true);
      })
      .catch(function (e) {
        etat.pret = false;
        etat.utilisateur = null;
        attente('Chargement impossible : ' + Kit.messageErreur(e), function () {
          etat.chargement = false;
          entrer(etat.session);
        });
      })
      .then(function () { etat.chargement = false; });
  }

  /* ------------------------------------------------------------------ */
  /* Navigation                                                          */
  /* ------------------------------------------------------------------ */

  function cablerOnglets() {
    Array.prototype.forEach.call(el.tabbar.querySelectorAll('button'), function (b) {
      b.addEventListener('click', function () { aller(b.getAttribute('data-onglet'), {}, true); });
    });
  }

  /* Bouton « retour » du téléphone : il doit remonter la pile de l'application
     avant de quitter. Sans cela, un retour depuis l'espace enfant ferme l'app. */
  function cablerRetourSysteme() {
    if (!global.history || !global.history.pushState) return;
    global.history.replaceState({ recap: 0 }, '');
    global.addEventListener('popstate', function () {
      if (Kit.feuilleEstOuverte()) {
        Kit.fermerFeuille();
        global.history.pushState({ recap: etat.pile.length }, '');
        return;
      }
      if (etat.pile.length > 1) {
        etat.pile.pop();
        var cible = etat.pile[etat.pile.length - 1];
        global.history.pushState({ recap: etat.pile.length }, '');
        rendre(cible.ecran, cible.params);
      }
    });
  }

  /* Va sur un écran. `racine` vrai = on repart d'une pile neuve (onglets). */
  function aller(ecran, params, racine) {
    if (!etat.pret) return Promise.resolve();
    Kit.fermerFeuille();
    /* CORRECTIF A4 (lot 8) DE LA RELECTURE PR9 — L'ONGLET HISTORIQUE PERDAIT
       SON FIL.

       Un écran d'ONGLET repart d'une pile neuve : c'est ce qu'on attend en
       touchant un onglet. Mais `ui-historique.js` navigue vers CE MÊME écran
       pour ouvrir un enfant. La pile était donc remise à zéro à l'ouverture
       d'un enfant, et « ‹ » ramenait à l'Accueil au lieu de la liste — le
       geste de retour du téléphone sortait même de l'application.

       La règle exacte : un onglet ne repart de zéro que lorsqu'on y arrive
       SANS paramètre. Avec un paramètre, c'est une descente dans l'écran, pas
       un retour à sa racine. */
    var aParametres = !!(params && Object.keys(params).length);
    var racineEffective = racine || (ONGLETS.indexOf(ecran) !== -1 && !aParametres);
    if (racineEffective) etat.pile = [{ ecran: ecran, params: params || {} }];
    else etat.pile.push({ ecran: ecran, params: params || {} });
    if (global.history && global.history.pushState) {
      global.history.pushState({ recap: etat.pile.length }, '');
    }
    return rendre(ecran, params || {});
  }

  /* Remplace l'écran courant sans empiler (rafraîchissement après écriture). */
  function remplacer(ecran, params) {
    if (!etat.pret) return Promise.resolve();
    if (!etat.pile.length) etat.pile.push({ ecran: ecran, params: params || {} });
    else etat.pile[etat.pile.length - 1] = { ecran: ecran, params: params || {} };
    return rendre(ecran, params || {});
  }

  function retour() {
    Kit.fermerFeuille();
    if (etat.pile.length > 1) {
      etat.pile.pop();
      var cible = etat.pile[etat.pile.length - 1];
      return rendre(cible.ecran, cible.params);
    }
    return aller('accueil', {}, true);
  }

  /* Rafraîchit l'écran affiché — après une écriture, jamais en aveugle. */
  function rafraichir() {
    if (!etat.pile.length) return Promise.resolve();
    var cible = etat.pile[etat.pile.length - 1];
    return rendre(cible.ecran, cible.params);
  }

  /* ------------------------------------------------------------------ */
  /* LOT 15 — LA PASTILLE DE L'ONGLET ACCUEIL (V8-26, A5)                */
  /*                                                                     */
  /* C'EST LE FILET. Les notifications dépendent d'un service qui envoie, */
  /* d'une permission accordée et — sur iPhone — de l'application         */
  /* installée sur l'écran d'accueil. Chacune de ces trois choses peut    */
  /* manquer, et deux d'entre elles sont hors de notre portée.            */
  /*                                                                     */
  /* La pastille, elle, ne demande rien : ni permission, ni serveur, ni   */
  /* réseau au moment de l'affichage. Elle est calculée avec les données  */
  /* déjà en mémoire, et fonctionne même quand tout le reste échoue.      */
  /* ------------------------------------------------------------------ */

  function majPastilleAccueil(nb) {
    var bouton = el.tabbar && el.tabbar.querySelector('button[data-onglet="accueil"]');
    if (!bouton) return;
    var existante = bouton.querySelector('.pastille-onglet');
    if (!nb) {
      if (existante) bouton.removeChild(existante);
      bouton.removeAttribute('aria-description');
      return;
    }
    if (!existante) {
      existante = Kit.ce('span', 'pastille-onglet');
      bouton.appendChild(existante);
    }
    /* REMARQUE 3 DE LA RELECTURE — LE COMPTE RÉEL, PAS « 9+ ».
       Le §22.3 A2 demande « le nombre de mois à clôturer ». Avec quatre
       contrats, trois mois de retard en font douze : « 9+ » cache précisément
       le cas où le chiffre compte. La pastille s'élargit d'elle-même
       (`min-width` et `padding`), et l'annonce vocale donnait déjà le vrai
       nombre — les deux disent désormais la même chose. */
    existante.textContent = String(nb);
    /* Le nombre est écrit DANS la pastille et annoncé aux lecteurs d'écran :
       une tache de couleur ne dit rien à qui ne la voit pas. */
    bouton.setAttribute('aria-description',
      nb === 1 ? '1 mois à clôturer' : nb + ' mois à clôturer');
  }

  function ecranCourant() {
    return etat.pile.length ? etat.pile[etat.pile.length - 1] : null;
  }

  function rendre(ecran, params) {
    var nomModule = ECRANS[ecran];
    var mod = nomModule ? global[nomModule] : null;
    if (!mod) {
      Kit.toast('Écran indisponible.', true);
      return Promise.resolve();
    }
    Kit.vider(el.barre);
    Kit.vider(el.corps);
    el.barre.className = 'bar';
    el.barre.hidden = false;
    el.corps.scrollTop = 0;
    var parent = ONGLET_PARENT[ecran] || null;
    el.tabbar.hidden = !parent;
    Array.prototype.forEach.call(el.tabbar.querySelectorAll('button'), function (b) {
      var actif = b.getAttribute('data-onglet') === parent;
      b.classList.toggle('on', actif);
      /* L'état est ANNONCÉ, pas seulement peint : une pastille de couleur ne
         dit rien à qui ne la voit pas. */
      if (actif) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });

    /* Barre de retour posée AVANT de déléguer : un écran qui échoue à charger
       (contrat introuvable, réseau coupé) laissait sinon une barre vide et
       aucune sortie — et sur iPhone en mode installé, il n'y a pas de bouton
       retour système (relecture lot 6, A9). L'écran la remplace ensuite. */
    if (ONGLETS.indexOf(ecran) === -1) barreRetour(el.barre, 'Récap');

    el.corps.appendChild(Kit.ce('div', 'attente', 'Un instant…'));
    return Promise.resolve()
      .then(function () {
        Kit.vider(el.corps);
        return mod.afficher({ barre: el.barre, corps: el.corps, params: params, vue: ecran });
      })
      .catch(function (e) {
        Kit.vider(el.corps);
        if (ONGLETS.indexOf(ecran) === -1 && !el.barre.querySelector('.bk')) {
          barreRetour(el.barre, 'Récap');
        }
        el.corps.appendChild(Kit.ce('div', 'attente', 'Écran indisponible : ' + Kit.messageErreur(e)));
        var b = Kit.bouton('btn nt', function () { rendre(ecran, params); });
        b.textContent = 'Réessayer';
        el.corps.appendChild(b);
      });
  }

  /* Barre haute standard : bouton retour, titre, et zone de droite libre. */
  function barreRetour(barre, titre, opts) {
    opts = opts || {};
    Kit.vider(barre);
    barre.className = 'bar';
    var bk = Kit.bouton('bk', function () { retour(); });
    bk.textContent = opts.fermer ? '✕' : '‹';
    bk.setAttribute('aria-label', opts.fermer ? 'Fermer' : 'Retour');
    barre.appendChild(bk);
    barre.appendChild(Kit.ce('span', 'ti', titre));
    if (opts.droite) barre.appendChild(Kit.ce('span', 'r', opts.droite));
    return barre;
  }

  /* ------------------------------------------------------------------ */
  /* Services partagés                                                   */
  /* ------------------------------------------------------------------ */

  /* Mois courant — horloge du téléphone (Europe/Paris implicite). C'est de
     l'interface (quel mois proposer par défaut), pas du calcul : le moteur pur
     du lot 1 reste le seul à ne jamais lire l'horloge. */
  function moisCourant() {
    var d = new Date();
    return { annee: d.getFullYear(), mois: d.getMonth() + 1 };
  }
  function aujourdhui() {
    var d = new Date();
    return Kit.iso(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }

  function contrats() { return etat.contrats; }
  function contratParId(id) {
    var trouve = etat.contrats.filter(function (c) { return c.id === id; })[0];
    if (trouve) return trouve;
    return (etat.contratsTous || []).filter(function (c) { return c.id === id; })[0] || null;
  }
  function email() { return etat.email; }

  /* LOT 16 §16.2 — le nom qui signe. Jamais l'adresse de connexion : c'est
     tout l'objet du correctif. */
  function nomEmettrice() { return etat.emettrice || null; }
  /* Vrai seulement quand la lecture a abouti ET que rien n'est saisi : c'est
     le seul cas où l'écran propose d'aller renseigner le nom. Sur un échec de
     lecture, on n'invite pas Maria à ressaisir ce qu'elle a peut-être déjà. */
  function emettriceAsaisir() { return etat.emettriceLue === true && !etat.emettrice; }
  function poserNomEmettrice(nom) {
    etat.emettrice = nom || '';
    etat.emettriceLue = true;
  }

  function tousLesContrats() {
    if (etat.contratsTous) return Promise.resolve(etat.contratsTous);
    return global.DB.listContratsTous().then(function (liste) {
      etat.contratsTous = liste || [];
      return etat.contratsTous;
    });
  }

  /* Chaîne des mois d'un contrat jusqu'au mois cible, mise en cache.

     La chaîne remonte toujours au DÉBUT DU CONTRAT, pas au mois où les
     compteurs ont été repris à la main. Sans cela, « depuis le début du
     contrat » et l'historique s'arrêteraient à la date de reprise et
     annonceraient trois mois de garde à un contrat qui en compte neuf.
     Les mois antérieurs à la reprise sont calculés avec des compteurs à zéro
     et MARQUÉS (`avantInitialisation`) : les écrans le disent, ils n'affichent
     pas des soldes qui n'ont pas de sens.

     Un échec n'est pas mémorisé : on doit pouvoir réessayer. */
  /* CORRECTION B3 DE LA RELECTURE DU LOT 17 — LA CLÉ PORTE LES BORNES DU
     CONTRAT, PAS SEULEMENT SON IDENTIFIANT.

     Ce qui se passait. L'écran de fin de contrat copie le contrat, y pose la
     date de fin SAISIE, et demande la chaîne. La clé ne retenant que
     `contrat.id` et le mois, deux choses en découlaient, toutes deux graves :

     1. Recalculer après avoir corrigé la date rendait les chiffres de la
        PREMIÈRE date, sous un titre qui annonçait la seconde. Aucun signal.
     2. Pire : la chaîne SIMULÉE restait en cache sous la clé du contrat RÉEL.
        L'espace de l'enfant, ouvert ensuite, affichait un mois amputé — « 4 j
        de présence sur 22 », « total à verser 189,09 € » au lieu de 1 040,00 €.
        Et l'Accueil propose la clôture juste à côté. Un mois clôturé ne se
        recalcule jamais : le document serait parti chez la famille avec ce
        chiffre, définitivement.

     C'était le seul chemin trouvé dans le lot 17 par lequel un chiffre faux
     pouvait devenir irréversible. Avant le lot 17 ce code appelait
     `Chaine.mois1`, qui recalculait à chaque fois : c'est le cache qui a
     introduit le défaut, et c'est donc sa clé qui le corrige.

     Les bornes sont ce que le moteur lit sur `contrat` — et depuis le §17.2,
     les SEULES choses qu'il y lise. Deux contrats de même identifiant mais de
     bornes différentes sont, pour la chaîne, deux contrats différents. */
  function cleSerie(contrat, cible) {
    return contrat.id +
      '|' + (contrat.date_debut || '') +
      '|' + (contrat.date_fin || '') +
      '|' + Chaine.cleMois(cible.annee, cible.mois);
  }

  function serie(contrat, cible) {
    var cle = cleSerie(contrat, cible);
    if (!etat.series[cle]) {
      var depuis = Chaine.moisDeDate(contrat.date_debut);
      /* LA RÉCUPÉRATION SE GAGNE JOUR APRÈS JOUR — LA DATE DU JOUR PART D'ICI.
         L'horloge est de l'interface : le moteur et la chaîne ne la lisent
         jamais, on la leur passe. C'est le même principe que `moisCourant`
         juste au-dessus. Le cache des séries est vidé par `invalider()` à
         chaque geste ; une application laissée ouverte d'un jour sur l'autre
         garde donc au pire la date de la veille jusqu'au prochain geste, et
         la réserve annoncée est alors la plus PRUDENTE des deux. */
      etat.series[cle] = Chaine.serie(contrat, cible, {
        /* `global.App.aujourdhui` et non `aujourdhui` : c'est la MÊME date
           que celle que lisent les écrans (`ui-conges.js`), y compris quand
           un test la fige. Deux horloges dans la même application, c'est un
           écran qui annonce une réserve et un moteur qui en accepte une
           autre — précisément ce que ce lot supprime. */
        depuis: depuis,
        aujourdhui: (global.App && global.App.aujourdhui)
          ? global.App.aujourdhui() : aujourdhui()
      }).catch(function (e) {
        delete etat.series[cle];
        throw e;
      });
    }
    return etat.series[cle];
  }

  /* Le maillon d'un mois précis dans la chaîne (null si hors chaîne). */
  function moisDe(chaine, annee, mois) {
    var cle = Chaine.cleMois(annee, mois);
    return (chaine.mois || []).filter(function (e) { return e.cle === cle; })[0] || null;
  }

  /* Récapitulatifs d'un mois pour TOUS les contrats actifs, mis en cache.

     Correction B1 (relecture lot 6). Un geste posé sur un jour — congé, retrait
     de congé — s'écrit sur plusieurs contrats à la fois. Il faut donc savoir,
     AVANT d'écrire, lesquels ont déjà clôturé ce mois-là : écrire sur un mois
     clôturé, c'est faire diverger le calendrier du document déjà remis aux
     parents. Un seul aller-retour par contrat et par mois, mis en cache et
     purgé comme le reste à la moindre écriture. */
  function recapsDuMois(annee, mois) {
    var cle = 'r|' + Chaine.cleMois(annee, mois);
    if (!etat.recaps[cle]) {
      etat.recaps[cle] = Promise.all(etat.contrats.map(function (c) {
        return global.DB.getRecap(c.id, annee, mois).then(function (r) {
          return { id: c.id, recap: r };
        });
      })).then(function (liste) {
        var parId = {};
        liste.forEach(function (x) { parId[x.id] = x.recap; });
        return parId;
      }).catch(function (e) {
        delete etat.recaps[cle];
        throw e;
      });
    }
    return etat.recaps[cle];
  }

  /* Vrai si ce contrat a clôturé ce mois-là. */
  function estClos(parId, contratId) {
    var r = parId && parId[contratId];
    return !!(r && r.statut === 'fige');
  }

  /* Journées saisies d'un contrat pour un mois, mises en cache. */
  function journees(contratId, annee, mois) {
    var cle = contratId + '|' + Chaine.cleMois(annee, mois);
    if (!etat.journees[cle]) {
      etat.journees[cle] = global.DB.getJourneesMois(contratId, annee, mois).catch(function (e) {
        delete etat.journees[cle];
        throw e;
      });
    }
    return etat.journees[cle];
  }

  function viderCaches() {
    etat.series = {};
    etat.journees = {};
    etat.recaps = {};
    etat.avenants = {};
  }

  /* Après toute écriture : les chaînes et les journées en cache sont périmées.
     On vide TOUT plutôt que d'essayer d'invalider finement — une invalidation
     partielle qui se trompe laisse un chiffre faux à l'écran, et un chiffre
     faux crédible est le pire résultat possible pour cette application. */
  function invalider() { viderCaches(); }

  /* LOT 17 §17.2 — les avenants d'un contrat, du plus ancien au plus récent.

     Un écran qui a besoin d'un réglage passe par ici, JAMAIS par `contrat` :
     les colonnes de `contrat` ne sont plus lues depuis le lot 17, et s'en
     servir ferait calculer un écran avec des conditions d'aujourd'hui sur un
     mois d'il y a deux ans. C'est exactement ce que les avenants existent pour
     empêcher.

     Un échec n'est pas mis en cache : sinon la première coupure réseau
     figerait l'application sur une liste vide pour toute la session, et les
     écrans afficheraient un planning par défaut sans que rien ne le dise. */
  function avenants(contratId) {
    if (!etat.avenants[contratId]) {
      etat.avenants[contratId] = global.DB.getAvenants(contratId).catch(function (e) {
        delete etat.avenants[contratId];
        throw e;
      });
    }
    return etat.avenants[contratId];
  }

  /* Les conditions applicables à un mois donné, résolues par le moteur.
     Aucune règle ici : `conditionsApplicables` est la règle, et elle vit dans
     `js/engine.js`. */
  function conditionsDuMois(avenantsListe, annee, mois) {
    return global.Engine.conditionsApplicables(avenantsListe || [], annee, mois);
  }

  /* Recharge la liste des contrats (création, archivage, renommage). */
  function rechargerContrats() {
    etat.contratsTous = null;
    viderCaches();
    return global.DB.listContratsActifs().then(function (liste) {
      etat.contrats = liste || [];
      return etat.contrats;
    });
  }

  function deconnecter() {
    return global.DB.signOut().catch(function (e) {
      /* Un échec silencieux ferait croire la session fermée alors qu'elle reste
         ouverte : Maria repose son téléphone rassurée à tort. */
      Kit.toast('Déconnexion impossible : ' + Kit.messageErreur(e) + ' Votre session est TOUJOURS ouverte.', true);
      throw e;
    });
  }

  /* ------------------------------------------------------------------ */
  /* Application installable                                             */
  /* ------------------------------------------------------------------ */

  function enregistrerServiceWorker() {
    if (!global.navigator || !global.navigator.serviceWorker) return;
    if (global.location && global.location.protocol === 'file:') return;
    global.navigator.serviceWorker.register('sw.js').catch(function (e) {
      /* L'application marche très bien sans : ce n'est pas une panne à
         montrer à Maria, seulement une trace pour le diagnostic. */
      if (global.console) global.console.warn('[Récap] service worker non enregistré :', e);
    });
  }

  /* ------------------------------------------------------------------ */

  global.App = {
    aller: aller,
    remplacer: remplacer,
    retour: retour,
    rafraichir: rafraichir,
    majPastilleAccueil: majPastilleAccueil,
    ecranCourant: ecranCourant,
    barreRetour: barreRetour,
    moisCourant: moisCourant,
    aujourdhui: aujourdhui,
    contrats: contrats,
    contratParId: contratParId,
    tousLesContrats: tousLesContrats,
    email: email,
    nomEmettrice: nomEmettrice,
    emettriceAsaisir: emettriceAsaisir,
    poserNomEmettrice: poserNomEmettrice,
    serie: serie,
    moisDe: moisDe,
    journees: journees,
    avenants: avenants,
    conditionsDuMois: conditionsDuMois,
    recapsDuMois: recapsDuMois,
    estClos: estClos,
    invalider: invalider,
    rechargerContrats: rechargerContrats,
    deconnecter: deconnecter
  };
})(window);
