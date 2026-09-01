/* ============================================================================
   CORRECTIF DU PARCOURS DE MISE À JOUR — LE TEST.

   CE QUE CE FICHIER GARDE, ET POURQUOI IL EXISTE.

   Le 31 août 2026, le lot 31 était en ligne, servi correctement par GitHub
   Pages, et le téléphone continuait d'afficher la version d'avant. Aucun test
   ne pouvait le voir : tous portaient sur ce que l'application CALCULE et
   AFFICHE, aucun sur la façon dont elle est LIVRÉE. Une livraison juste qui
   n'atteint pas l'écran vaut exactement autant qu'une livraison fausse.

   Ce fichier tient les deux moitiés de la correction :

   1. LE COMPORTEMENT. On charge `sw.js` pour de vrai — pas en le relisant à
      la recherche de mots-clés — dans un décor de service worker fabriqué
      ici : un cache en mémoire, un réseau qu'on pilote. Puis on déclenche un
      `fetch` de NAVIGATION avec une page PÉRIMÉE dans le cache et une page
      NEUVE sur le réseau, et on regarde ce qui sort.

      LA PREUVE QUE LE TEST MORD : on remet ensuite le défaut dans une copie
      de `sw.js` — la branche de navigation est retirée, rien d'autre ne
      change — et la même mesure doit rendre la page PÉRIMÉE. Une mutation,
      pas une comparaison avec l'historique git : le contrôle reste valable
      dans un ZIP, dans un dépôt sans historique, et le jour où ce correctif
      sera loin derrière.

   2. LA COHÉRENCE. Le versionnement des URLs (`?v=`) n'a de valeur que si
      `index.html` et `sw.js` portent LA MÊME version. Deux fichiers écrits à
      la main, dix-huit lignes chacun, aucune étape de build pour les
      accorder : c'est exactement le genre d'accord qui se défait au troisième
      lot, en silence, et qui rend le pré-cache inutile sans que rien ne
      prévienne. On le vérifie ici, dans les deux sens.

   Lancement : node test/cache-navigation.smoke.js
   ========================================================================= */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var racine = path.join(__dirname, '..');
var SOURCE_SW = fs.readFileSync(path.join(racine, 'sw.js'), 'utf8');
var SOURCE_INDEX = fs.readFileSync(path.join(racine, 'index.html'), 'utf8');

var echecs = 0;
function assert(cond, msg) {
  if (!cond) { echecs++; console.error('FAIL ' + msg); } else { console.log('ok   ' + msg); }
}

/* ------------------------------------------------------------------------ */
/* LE DÉCOR : un service worker complet, en mémoire                          */
/* ------------------------------------------------------------------------ */

var BASE = 'https://exemple.test/recap-maria/';

/* Un cache qui se comporte comme le vrai sur le seul point qui compte ici :
   la clé est l'URL ABSOLUE, requête ET chaîne de recherche comprises. C'est
   précisément ce qui fait que `js/app.js?v=lot31-2` et `js/app.js?v=lot31-1`
   sont deux entrées différentes — tout le versionnement repose là-dessus. */
function fabriquerCaches() {
  var boites = {};
  function cle(r) { return new URL(typeof r === 'string' ? r : r.url, BASE).href; }
  function boite(nom) {
    if (!boites[nom]) {
      boites[nom] = {
        _m: new Map(),
        put: function (r, rep) { this._m.set(cle(r), rep); return Promise.resolve(); },
        match: function (r) { return Promise.resolve(this._m.get(cle(r))); },
        add: function (r) { this._m.set(cle(r), reponse('reseau ' + cle(r))); return Promise.resolve(); },
        addAll: function (rs) { rs.forEach(this.add, this); return Promise.resolve(); }
      };
    }
    return boites[nom];
  }
  return {
    _boites: boites,
    open: function (nom) { return Promise.resolve(boite(nom)); },
    keys: function () { return Promise.resolve(Object.keys(boites)); },
    delete: function (nom) { delete boites[nom]; return Promise.resolve(true); },
    match: function (r) {
      var noms = Object.keys(boites);
      for (var i = 0; i < noms.length; i++) {
        var v = boites[noms[i]]._m.get(cle(r));
        if (v) return Promise.resolve(v);
      }
      return Promise.resolve(undefined);
    }
  };
}

/* Une réponse réduite à ce que `sw.js` en lit : `ok`, `clone()`, et un corps
   qu'on peut reconnaître. */
function reponse(corps, ok) {
  return { ok: ok !== false, corps: corps, clone: function () { return reponse(corps, ok); } };
}

/* Charge `sw.js` dans un décor neuf et rend de quoi le piloter. */
function chargerSw(source, options) {
  options = options || {};
  var handlers = {};
  var journalReseau = [];
  var faux = fabriquerCaches();

  var self = {
    location: { origin: 'https://exemple.test', href: BASE },
    addEventListener: function (nom, fn) { handlers[nom] = fn; },
    skipWaiting: function () { return Promise.resolve(); },
    clients: { claim: function () { return Promise.resolve(); }, matchAll: function () { return Promise.resolve([]); } },
    registration: { showNotification: function () { return Promise.resolve(); } }
  };

  var contexte = {
    self: self, caches: faux, URL: URL, console: console,
    Request: function (entree, init) {
      var url = typeof entree === 'string' ? entree : entree.url;
      this.url = new URL(url, BASE).href;
      this.method = 'GET';
      this.mode = (typeof entree === 'object' && entree.mode) || 'no-cors';
      this.cache = (init && init.cache) || 'default';
    },
    fetch: function (r) {
      var url = typeof r === 'string' ? r : r.url;
      journalReseau.push({ url: new URL(url, BASE).href, cache: (r && r.cache) || 'default' });
      if (options.horsLigne) return Promise.reject(new Error('hors ligne'));
      return Promise.resolve(reponse(options.reseau || 'PAGE NEUVE'));
    }
  };
  contexte.globalThis = contexte;
  vm.createContext(contexte);
  vm.runInContext(source, contexte, { filename: 'sw.js' });

  return {
    handlers: handlers, caches: faux, journalReseau: journalReseau, contexte: contexte,
    /* Déclenche un `fetch` et rend ce que le service worker a décidé de servir. */
    demander: function (url, mode) {
      var recu = null;
      var evenement = {
        request: { url: new URL(url, BASE).href, method: 'GET', mode: mode || 'no-cors' },
        respondWith: function (p) { recu = Promise.resolve(p); }
      };
      handlers.fetch(evenement);
      return recu === null ? Promise.resolve('NON INTERCEPTÉ') : recu;
    }
  };
}

/* ------------------------------------------------------------------------ */
/* 1. LA NAVIGATION : le réseau l'emporte sur un cache périmé                */
/* ------------------------------------------------------------------------ */

console.log('\n--- la navigation : réseau d’abord, cache en secours ---');

function scenarioNavigation(source, options) {
  var sw = chargerSw(source, options);
  /* Le pré-cache d'une livraison précédente contient la page sous SES DEUX
     clés — `./` (l'URL que le téléphone ouvre) et `./index.html`. Semer les
     deux est ce qui rend le scénario fidèle : c'est `./` que le gestionnaire
     `fetch` retrouvait le 31 août, et servait. */
  return sw.caches.open('vieux-cache').then(function (c) {
    return c.put('./', reponse('PAGE PÉRIMÉE')).then(function () {
      return c.put('./index.html', reponse('PAGE PÉRIMÉE'));
    });
  }).then(function () {
    return sw.demander(BASE, 'navigate');
  }).then(function (rep) {
    return { corps: rep && rep.corps, sw: sw };
  });
}

scenarioNavigation(SOURCE_SW, { reseau: 'PAGE NEUVE' }).then(function (r) {
  assert(r.corps === 'PAGE NEUVE',
    'une page périmée est en cache, le réseau répond : c’est la NEUVE qui est servie (reçu : ' + r.corps + ')');

  var nav = r.sw.journalReseau.filter(function (a) { return a.url === BASE; })[0];
  assert(!!nav, 'la navigation a bien été demandée au réseau');
  assert(nav && nav.cache === 'reload',
    'et elle contourne le cache HTTP du navigateur (`cache: reload`) — sinon GitHub ' +
    'Pages la sert en max-age=600 et la panne se déplace d’un cran');

  /* ---------------------------------------------------------------------- */
  /* 2. LA PREUVE QUE LE TEST MORD : on remet le défaut                      */
  /* ---------------------------------------------------------------------- */

  console.log('\n--- on remet le défaut : la page périmée doit revenir ---');

  /* On retire la branche de navigation, et RIEN D'AUTRE : `sw.js` redevient
     cache d'abord pour tout, exactement comme le 31 août. */
  var debut = SOURCE_SW.indexOf("  if (requete.mode === 'navigate') {");
  var fin = SOURCE_SW.indexOf('    return;\n  }\n', debut);
  assert(debut !== -1 && fin !== -1,
    'la branche de navigation est repérable dans sw.js (sinon la mutation serait vide)');
  var avecLeDefaut = SOURCE_SW.slice(0, debut) + SOURCE_SW.slice(fin + '    return;\n  }\n'.length);
  assert(avecLeDefaut.length < SOURCE_SW.length, 'la mutation a bien retiré du code');

  return scenarioNavigation(avecLeDefaut, { reseau: 'PAGE NEUVE' }).then(function (m) {
    assert(m.corps === 'PAGE PÉRIMÉE',
      'sans cette branche, c’est la page PÉRIMÉE qui repart vers le téléphone — ' +
      'le défaut du 31 août, reproduit ici (reçu : ' + m.corps + ')');
  });
}).then(function () {

  /* ---------------------------------------------------------------------- */
  /* 3. HORS LIGNE : l’application s’ouvre quand même                       */
  /* ---------------------------------------------------------------------- */

  console.log('\n--- hors ligne : le cache reprend la main, l’application s’ouvre ---');

  return scenarioNavigation(SOURCE_SW, { horsLigne: true }).then(function (r) {
    assert(r.corps === 'PAGE PÉRIMÉE',
      'réseau injoignable : la page en cache est servie (reçu : ' + r.corps + ')');
  });

}).then(function () {

  /* ---------------------------------------------------------------------- */
  /* 4. LES FICHIERS VERSIONNÉS : cache d’abord, et c’est voulu             */
  /* ---------------------------------------------------------------------- */

  console.log('\n--- les fichiers versionnés restent servis depuis le cache ---');

  var sw = chargerSw(SOURCE_SW, { reseau: 'DEPUIS LE RÉSEAU' });
  var V = versionDuSw();
  return sw.caches.open('recap-' + V).then(function (c) {
    return c.put('./js/app.js?v=' + V, reponse('DEPUIS LE CACHE'));
  }).then(function () {
    return sw.demander('./js/app.js?v=' + V);
  }).then(function (rep) {
    assert(rep && rep.corps === 'DEPUIS LE CACHE',
      'un fichier versionné déjà en cache est servi instantanément (reçu : ' + (rep && rep.corps) + ')');
    return sw.demander('./js/app.js?v=AUTRE-VERSION');
  }).then(function (rep) {
    assert(rep && rep.corps === 'DEPUIS LE RÉSEAU',
      'et une AUTRE version du même fichier ne peut pas être servie depuis cette ' +
      'entrée : c’est ce qui rend le cache d’abord sans danger (reçu : ' + (rep && rep.corps) + ')');
  });

}).then(function () {

  /* ---------------------------------------------------------------------- */
  /* 5. LA COHÉRENCE index.html <-> sw.js                                    */
  /* ---------------------------------------------------------------------- */

  console.log('\n--- index.html et sw.js portent la même version, sur les mêmes fichiers ---');

  var V = versionDuSw();
  assert(!!V, 'sw.js déclare une VERSION');

  var nomCache = (SOURCE_SW.match(/var CACHE = ([^;]+);/) || [])[1] || '';
  assert(nomCache.indexOf('VERSION') !== -1,
    'le nom du cache DÉCOULE de VERSION — il ne peut plus être oublié (' + nomCache.trim() + ')');

  /* Ce que sw.js promet de pré-cacher, versionné. */
  var blocVersionnes = (SOURCE_SW.match(/var VERSIONNES = \[([\s\S]*?)\];/) || [])[1] || '';
  var attendus = (blocVersionnes.match(/'\.\/([^']+)'/g) || []).map(function (s) {
    return s.slice(3, -1);
  });
  assert(attendus.length > 0, 'sw.js liste les fichiers versionnés (' + attendus.length + ')');

  /* Ce que index.html demande réellement au navigateur. */
  var refs = [];
  SOURCE_INDEX.replace(/(?:src|href)="([^"]+)"/g, function (_, u) {
    if (/^https?:/.test(u)) return '';
    refs.push(u); return '';
  });
  var locaux = refs.filter(function (u) { return /^(js\/|css\/|config\.js)/.test(u); });

  assert(locaux.length === attendus.length,
    'index.html référence autant de fichiers js/css que sw.js en versionne (' +
    locaux.length + ' contre ' + attendus.length + ')');

  locaux.forEach(function (u) {
    var sansVersion = u.split('?')[0];
    assert(u === sansVersion + '?v=' + V,
      sansVersion + ' porte bien ?v=' + V + ' dans index.html (trouvé : ' + u + ')');
    assert(attendus.indexOf(sansVersion) !== -1,
      sansVersion + ' est bien dans la liste de pré-cache de sw.js');
  });

  attendus.forEach(function (u) {
    assert(locaux.indexOf(u + '?v=' + V) !== -1,
      u + ' est pré-caché par sw.js ET réellement demandé par index.html — ' +
      'un fichier pré-caché que personne ne charge est du poids mort, et ' +
      'l’inverse est la panne du 31 août');
  });

  /* Le service worker lui-même NE DOIT PAS être versionné : c'est le seul
     fichier que le navigateur doit pouvoir aller rechercher de lui-même. */
  assert(/serviceWorker\.register\('sw\.js'\)/.test(
    fs.readFileSync(path.join(racine, 'js', 'app.js'), 'utf8')),
    'sw.js est enregistré SANS version — c’est le seul fichier dont le ' +
    'navigateur doit pouvoir constater le changement tout seul');

}).then(function () {
  console.log('');
  if (echecs) { console.error(echecs + ' échec(s)'); process.exit(1); }
  console.log('Tout est conforme.');
}).catch(function (e) {
  console.error('FAIL exception : ' + (e && e.stack || e));
  process.exit(1);
});

function versionDuSw() {
  return (SOURCE_SW.match(/var VERSION = '([^']+)';/) || [])[1] || '';
}
