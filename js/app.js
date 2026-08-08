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
  var ONGLETS = ['accueil', 'conges', 'menu'];
  var ECRANS = {
    accueil: 'UiAccueil',
    conges: 'UiConges',
    menu: 'UiMenu',
    enfant: 'UiEnfant',
    document: 'UiDocument',
    historique: 'UiHistorique',
    bilan: 'UiHistorique',       // le bilan annuel est rendu par le même module
    fiche: 'UiContrat',
    periode: 'UiPeriode'
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
    pret: false,
    chargement: false,
    utilisateur: null
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
    enregistrerServiceWorker();

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

  function attente(texte) {
    el.login.hidden = true;
    el.app.hidden = false;
    el.tabbar.hidden = true;
    Kit.vider(el.barre);
    el.barre.className = 'bar';
    el.barre.appendChild(Kit.ce('span', 'ti', 'Récap'));
    Kit.vider(el.corps);
    el.corps.appendChild(Kit.ce('div', 'attente', texte));
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

    global.DB.listContratsActifs()
      .then(function (liste) {
        etat.contrats = liste || [];
        etat.pret = true;
        etat.pile = [];
        return aller('accueil', {}, true);
      })
      .catch(function (e) {
        etat.pret = false;
        etat.utilisateur = null;
        attente('Chargement impossible : ' + Kit.messageErreur(e) + '\nRéessayez dans un instant.');
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
    if (racine || ONGLETS.indexOf(ecran) !== -1) etat.pile = [{ ecran: ecran, params: params || {} }];
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
    el.tabbar.hidden = ONGLETS.indexOf(ecran) === -1;
    Array.prototype.forEach.call(el.tabbar.querySelectorAll('button'), function (b) {
      b.classList.toggle('on', b.getAttribute('data-onglet') === ecran);
    });

    el.corps.appendChild(Kit.ce('div', 'attente', 'Un instant…'));
    return Promise.resolve()
      .then(function () {
        Kit.vider(el.corps);
        return mod.afficher({ barre: el.barre, corps: el.corps, params: params, vue: ecran });
      })
      .catch(function (e) {
        Kit.vider(el.corps);
        el.corps.appendChild(Kit.ce('div', 'attente', 'Écran indisponible : ' + Kit.messageErreur(e)));
      });
  }

  /* Barre haute standard : bouton retour, titre, et zone de droite libre. */
  function barreRetour(barre, titre, opts) {
    opts = opts || {};
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
  function serie(contrat, cible) {
    var cle = contrat.id + '|' + Chaine.cleMois(cible.annee, cible.mois);
    if (!etat.series[cle]) {
      var depuis = Chaine.moisDeDate(contrat.date_debut);
      etat.series[cle] = Chaine.serie(contrat, cible, { depuis: depuis }).catch(function (e) {
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
  }

  /* Après toute écriture : les chaînes et les journées en cache sont périmées.
     On vide TOUT plutôt que d'essayer d'invalider finement — une invalidation
     partielle qui se trompe laisse un chiffre faux à l'écran, et un chiffre
     faux crédible est le pire résultat possible pour cette application. */
  function invalider() { viderCaches(); }

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
    ecranCourant: ecranCourant,
    barreRetour: barreRetour,
    moisCourant: moisCourant,
    aujourdhui: aujourdhui,
    contrats: contrats,
    contratParId: contratParId,
    tousLesContrats: tousLesContrats,
    email: email,
    serie: serie,
    moisDe: moisDe,
    journees: journees,
    invalider: invalider,
    rechargerContrats: rechargerContrats,
    deconnecter: deconnecter
  };
})(window);
