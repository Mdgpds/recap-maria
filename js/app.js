/* ============================================================================
   app.js — Orchestration de l'application (lots 3 et 4).

   Enchaîne : porte d'authentification (Supabase Auth) → chargement des
   contrats actifs → écran de saisie (lot 3) + écran de récap (lot 4), avec
   deux onglets. Ne parle pas au réseau directement (tout via DB) et ne calcule
   rien lui-même (le moteur du lot 1 est branché dans l'écran de récap).
   ========================================================================= */
(function (global) {
  'use strict';

  var vues = {};
  var contrats = [];
  var recapCharge = false;   // le récap n'est calculé qu'au premier affichage de l'onglet
  var pret = false;          // vrai une fois les contrats chargés et UiRecap initialisé

  document.addEventListener('DOMContentLoaded', function () {
    vues.login = document.getElementById('vue-login');
    vues.app = document.getElementById('vue-app');
    vues.saisie = document.getElementById('saisie');
    vues.recap = document.getElementById('recap');

    câblerLogin();
    câblerLogout();
    câblerOnglets();

    // Réagit aux changements de session (login/logout/refresh de token).
    global.DB.onAuthChange(function (session) {
      if (session) entrerDansApp(); else montrerLogin();
    });

    // État initial.
    global.DB.getSession()
      .then(function (session) { if (session) entrerDansApp(); else montrerLogin(); })
      .catch(function (e) { messageLogin('Erreur de session : ' + (e.message || e)); montrerLogin(); });
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
  /* Onglets Saisie / Récap                                           */
  /* ---------------------------------------------------------------- */

  function câblerOnglets() {
    var oSaisie = document.getElementById('onglet-saisie');
    var oRecap = document.getElementById('onglet-recap');
    oSaisie.addEventListener('click', function () { montrerOnglet('saisie'); });
    oRecap.addEventListener('click', function () { montrerOnglet('recap'); });
  }

  function montrerOnglet(nom) {
    var estRecap = nom === 'recap';
    vues.saisie.hidden = estRecap;
    vues.recap.hidden = !estRecap;
    document.getElementById('onglet-saisie').classList.toggle('onglet-actif', !estRecap);
    document.getElementById('onglet-recap').classList.toggle('onglet-actif', estRecap);
    // Ne calcule le récap qu'une fois les contrats chargés (évite un rendu
    // sur un conteneur non initialisé si on clique « Récap » pendant le
    // chargement ; il sera rendu au prochain passage sur l'onglet).
    if (estRecap && !recapCharge && pret) {
      recapCharge = true;
      var m = moisCourant();
      global.UiRecap.afficherRecapMois(m.annee, m.mois);
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

  /* ---------------------------------------------------------------- */
  /* Entrée dans l'application                                         */
  /* ---------------------------------------------------------------- */

  function entrerDansApp() {
    vues.login.hidden = true;
    vues.app.hidden = false;
    recapCharge = false;
    pret = false;
    montrerOnglet('saisie');
    vues.saisie.textContent = 'Chargement des contrats…';

    global.DB.listContratsActifs()
      .then(function (liste) {
        contrats = liste || [];
        global.UiSaisie.init({ conteneur: vues.saisie, contrats: contrats });
        global.UiRecap.init({ conteneur: vues.recap, contrats: contrats });
        pret = true;
        var maintenant = moisCourant();
        return global.UiSaisie.afficherMois(maintenant.annee, maintenant.mois);
      })
      .catch(function (e) {
        vues.saisie.textContent = 'Erreur de chargement : ' + (e.message || e);
      });
  }

  /* Mois courant (Europe/Paris implicite via l'horloge locale du téléphone).
     C'est de l'UI (choix du mois par défaut), pas du calcul métier : le moteur
     pur du lot 1 est le seul à ne jamais lire l'horloge. */
  function moisCourant() {
    var d = new Date();
    return { annee: d.getFullYear(), mois: d.getMonth() + 1 };
  }
})(window);
