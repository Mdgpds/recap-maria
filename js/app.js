/* ============================================================================
   app.js — Orchestration de l'application.

   Enchaîne : porte d'authentification (Supabase Auth) → chargement des
   contrats → quatre onglets : Récap, Saisie, Période, Familles.
   Ne parle pas au réseau directement (tout via DB) et ne calcule rien
   lui-même (le moteur du lot 1 est branché dans les écrans).

   Correctif C1 du lot 5 — atterrissage sur le récapitulatif.
   Le correctif « évident » (remplacer 'saisie' par 'recap' dans l'appel à
   montrerOnglet au début de entrerDansApp) ne marche PAS : à cet instant
   `pret` vaut encore false, et montrerOnglet ne déclenche le rendu du récap
   que sous la condition (estRecap && !recapCharge && pret). On afficherait un
   onglet Récap vide, qui ne se remplirait qu'au second clic.
   Le basculement a donc lieu APRÈS `pret = true`, une fois la saisie
   initialisée. Pendant tout le chargement, l'écran reste sur un état
   d'attente lisible — pas sur un onglet vide.
   ========================================================================= */
(function (global) {
  'use strict';

  var vues = {};
  var contrats = [];
  var ongletCourant = null;
  var charge = { recap: false, periode: false, familles: false };
  var pret = false;                 // vrai une fois les contrats chargés et les écrans initialisés
  var chargementEnCours = false;
  var utilisateurCourant = null;    // pour ignorer les simples rafraîchissements de jeton

  var ONGLETS = ['recap', 'saisie', 'periode', 'familles'];

  document.addEventListener('DOMContentLoaded', function () {
    vues.login = document.getElementById('vue-login');
    vues.app = document.getElementById('vue-app');
    vues.chargement = document.getElementById('chargement');
    vues.onglets = document.getElementById('onglets');
    vues.saisie = document.getElementById('saisie');
    vues.recap = document.getElementById('recap');
    vues.periode = document.getElementById('periode');
    vues.familles = document.getElementById('familles');

    câblerLogin();
    câblerLogout();
    câblerOnglets();

    // Réagit aux changements de session (login / logout / refresh de jeton).
    global.DB.onAuthChange(function (session) {
      if (session) entrerDansApp(session);
      else { utilisateurCourant = null; pret = false; montrerLogin(); }
    });

    // État initial.
    global.DB.getSession()
      .then(function (session) { if (session) entrerDansApp(session); else montrerLogin(); })
      .catch(function (e) { messageLogin('Connexion impossible : ' + (e.message || e)); montrerLogin(); });
  });

  /* ---------------------------------------------------------------- */
  /* Authentification                                                 */
  /* ---------------------------------------------------------------- */

  function câblerLogin() {
    var form = document.getElementById('form-login');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = document.getElementById('login-email').value.trim();
      var mdp = document.getElementById('login-mdp').value;
      var btn = document.getElementById('btn-login');
      if (!email || !mdp) { messageLogin('Renseigner l’e-mail et le mot de passe.'); return; }
      btn.disabled = true; messageLogin('Connexion…');
      global.DB.signIn(email, mdp)
        .then(function () { messageLogin(''); /* onAuthChange déclenche l'entrée */ })
        .catch(function (err) {
          messageLogin('Connexion refusée : ' + (err.message || err));
          btn.disabled = false;
        });
    });
  }

  function câblerLogout() {
    document.getElementById('btn-logout').addEventListener('click', function () {
      global.DB.signOut().catch(function () {});
    });
  }

  /* ---------------------------------------------------------------- */
  /* Onglets                                                          */
  /* ---------------------------------------------------------------- */

  function câblerOnglets() {
    ONGLETS.forEach(function (nom) {
      var b = document.getElementById('onglet-' + nom);
      if (b) b.addEventListener('click', function () { montrerOnglet(nom); });
    });
  }

  function montrerOnglet(nom) {
    if (!pret) return;              // pendant le chargement, on reste sur l'état d'attente
    ongletCourant = nom;
    ONGLETS.forEach(function (n) {
      if (vues[n]) vues[n].hidden = (n !== nom);
      var b = document.getElementById('onglet-' + n);
      if (b) b.classList.toggle('onglet-actif', n === nom);
    });

    // Chaque écran n'est calculé qu'à son premier affichage.
    if (nom === 'recap' && !charge.recap) {
      charge.recap = true;
      var m = moisCourant();
      global.UiRecap.afficherRecapMois(m.annee, m.mois);
    } else if (nom === 'periode' && !charge.periode && global.UiPeriode) {
      charge.periode = true;
      global.UiPeriode.afficher();
    } else if (nom === 'familles' && !charge.familles && global.UiFamilles) {
      charge.familles = true;
      global.UiFamilles.afficher();
    }
  }

  function messageLogin(txt) {
    var m = document.getElementById('msg-login');
    if (m) m.textContent = txt || '';
  }

  function montrerLogin() {
    vues.app.hidden = true;
    vues.login.hidden = false;
    var btn = document.getElementById('btn-login');
    if (btn) btn.disabled = false;
  }

  /* État d'attente : les onglets et les écrans sont masqués, un message
     lisible occupe l'espace. On n'affiche jamais un onglet vide. */
  function montrerAttente(texte) {
    vues.login.hidden = true;
    vues.app.hidden = false;
    if (vues.onglets) vues.onglets.hidden = true;
    ONGLETS.forEach(function (n) { if (vues[n]) vues[n].hidden = true; });
    if (vues.chargement) {
      vues.chargement.hidden = false;
      vues.chargement.textContent = texte;
    }
  }

  function masquerAttente() {
    if (vues.chargement) vues.chargement.hidden = true;
    if (vues.onglets) vues.onglets.hidden = false;
  }

  /* ---------------------------------------------------------------- */
  /* Entrée dans l'application                                         */
  /* ---------------------------------------------------------------- */

  function entrerDansApp(session) {
    var uid = (session && session.user) ? session.user.id : null;
    // Un rafraîchissement de jeton ne doit pas relancer le chargement ni
    // ramener Maria de force sur l'onglet Récap en pleine saisie.
    if (pret && uid && uid === utilisateurCourant) return;
    if (chargementEnCours) return;

    chargementEnCours = true;
    utilisateurCourant = uid;
    pret = false;
    charge = { recap: false, periode: false, familles: false };
    montrerAttente('Chargement de vos contrats…');

    global.DB.listContratsActifs()
      .then(function (liste) {
        contrats = liste || [];
        global.UiSaisie.init({ conteneur: vues.saisie, contrats: contrats });
        global.UiRecap.init({ conteneur: vues.recap });
        if (global.UiPeriode) global.UiPeriode.init({ conteneur: vues.periode });
        if (global.UiFamilles) global.UiFamilles.init({ conteneur: vues.familles });

        pret = true;
        var maintenant = moisCourant();
        return global.UiSaisie.afficherMois(maintenant.annee, maintenant.mois);
      })
      .then(function () {
        masquerAttente();
        montrerOnglet('recap');            // C1 : après pret = true, jamais avant
      })
      .catch(function (e) {
        // On redevient « non prêt » : une nouvelle session ou un nouvel
        // événement d'authentification pourra relancer le chargement au lieu
        // de laisser l'écran bloqué sur l'erreur.
        pret = false;
        utilisateurCourant = null;
        montrerAttente('Chargement impossible : ' + (e.message || e) +
          '\nVérifiez votre connexion, puis rechargez la page.');
      })
      .then(function () { chargementEnCours = false; });
  }

  /* ---------------------------------------------------------------- */
  /* Services offerts aux écrans (onglet Familles surtout)             */
  /* ---------------------------------------------------------------- */

  /* Recharge la liste des contrats ACTIFS après une création, un renommage
     ou un archivage, et rafraîchit les écrans qui en dépendent.
     L'onglet Période est simplement invalidé : il sera recalculé à sa
     prochaine ouverture, sans faire travailler l'application pour un écran
     que Maria ne regarde pas. */
  function rechargerContrats() {
    return global.DB.listContratsActifs().then(function (liste) {
      contrats = liste || [];
      global.UiSaisie.init({ conteneur: vues.saisie, contrats: contrats });
      global.UiRecap.oublierBornes();
      charge.periode = false;
      var m = moisCourant();
      var maj = [global.UiSaisie.afficherMois(m.annee, m.mois)];
      if (charge.recap) maj.push(global.UiRecap.rafraichir());
      return Promise.all(maj);
    });
  }

  /* Ouvre le récapitulatif d'un mois précis (historique par famille, C4). */
  function ouvrirRecapMois(annee, mois) {
    charge.recap = true;
    montrerOnglet('recap');
    return global.UiRecap.afficherRecapMois(annee, mois);
  }

  /* Mois courant (Europe/Paris implicite via l'horloge locale du téléphone).
     C'est de l'UI (choix du mois par défaut), pas du calcul métier : le moteur
     pur du lot 1 est le seul à ne jamais lire l'horloge. */
  function moisCourant() {
    var d = new Date();
    return { annee: d.getFullYear(), mois: d.getMonth() + 1 };
  }

  global.App = {
    montrerOnglet: montrerOnglet,
    rechargerContrats: rechargerContrats,
    ouvrirRecapMois: ouvrirRecapMois,
    moisCourant: moisCourant
  };
})(window);
