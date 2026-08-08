/* ============================================================================
   sw.js — Service worker minimal (§3 des specs).

   Un seul objectif : que l'application S'OUVRE même sans réseau. Les DONNÉES,
   elles, restent en ligne — il n'y a PAS de synchronisation hors ligne dans ce
   lot, et c'est volontaire : une saisie mise en file d'attente puis rejouée
   plus tard sur un mois entre-temps clôturé produirait exactement le genre
   d'incohérence que cette application existe pour éviter.

   Conséquence assumée et visible à l'écran : hors ligne, l'application
   s'ouvre, mais toute lecture ou écriture échoue avec un message français
   explicite (js/messages.js) et la saisie en cours reste affichée.

   Règles de cache, volontairement simples :
   - les fichiers de l'application (même origine) : servis depuis le cache,
     rafraîchis en arrière-plan ;
   - le client Supabase du CDN : même traitement, sinon l'application ne
     démarre pas hors ligne ;
   - TOUT LE RESTE (appels à l'API Supabase, authentification) : jamais
     intercepté, jamais mis en cache. Servir un récapitulatif périmé depuis un
     cache serait pire que ne rien afficher.

   Écrit à la main, sans étape de build : le fichier livré est le fichier lu.
   ========================================================================= */
'use strict';

/* À incrémenter à chaque livraison : c'est ce qui déclenche le remplacement
   des fichiers en cache sur le téléphone de Maria. */
var CACHE = 'recap-lot6-v2';

var CDN_SUPABASE = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';

var FICHIERS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './config.js',
  './icones/icone-192.png',
  './icones/icone-512.png',
  './js/messages.js',
  './js/feries.js',
  './js/format.js',
  './js/engine.js',
  './js/db.js',
  './js/chaine-mois.js',
  './js/ui-kit.js',
  './js/ui-accueil.js',
  './js/ui-enfant.js',
  './js/ui-document.js',
  './js/ui-conges.js',
  './js/ui-historique.js',
  './js/ui-contrat.js',
  './js/ui-menu.js',
  './js/ui-periode.js',
  './js/app.js'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (cache) {
      /* Les fichiers de l'application doivent tous être là : si l'un manque,
         l'installation échoue et l'ancienne version reste en place.

         `cache: 'reload'` (correction A12 de la relecture) : sans lui, addAll
         passe par le cache HTTP du navigateur — GitHub Pages sert les statiques
         en max-age=600 — et une installation pouvait donc re-stocker les
         fichiers de l'ANCIENNE version, rendant l'incrément de CACHE inopérant
         pendant dix minutes. On force le réseau au moment de l'installation. */
      var requetes = FICHIERS.map(function (u) {
        return new Request(u, { cache: 'reload' });
      });
      return cache.addAll(requetes).then(function () {
        /* Le CDN, lui, est tenté séparément : un CDN momentanément injoignable
           ne doit pas empêcher la mise à jour de l'application. */
        return cache.add(new Request(CDN_SUPABASE, { cache: 'reload' }))
          .catch(function () { return null; });
      });
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (cles) {
      return Promise.all(cles.map(function (c) {
        return c === CACHE ? null : caches.delete(c);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var requete = e.request;
  if (requete.method !== 'GET') return;

  var url;
  try { url = new URL(requete.url); } catch (err) { return; }

  var memeOrigine = url.origin === self.location.origin;
  var estCdn = requete.url.indexOf(CDN_SUPABASE) === 0;
  if (!memeOrigine && !estCdn) return;      // API Supabase : jamais interceptée

  e.respondWith(
    caches.match(requete).then(function (enCache) {
      var reseau = fetch(requete).then(function (reponse) {
        if (reponse && reponse.ok && (memeOrigine || estCdn)) {
          var copie = reponse.clone();
          caches.open(CACHE).then(function (cache) { cache.put(requete, copie); });
        }
        return reponse;
      }).catch(function () {
        /* Hors ligne : on retombe sur le cache, et à défaut sur la page
           d'accueil pour une navigation (l'application s'ouvre quand même). */
        if (enCache) return enCache;
        if (requete.mode === 'navigate') return caches.match('./index.html');
        throw new Error('hors ligne');
      });
      return enCache || reseau;
    })
  );
});
