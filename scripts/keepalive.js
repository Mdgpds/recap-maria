/* ============================================================================
   keepalive.js — Empêche la mise en pause du projet Supabase (plan gratuit
   suspendu après ~7 jours sans activité).

   Fait UNE requête légère sur l'API REST du projet, avec la clé publique
   (anon) déjà présente dans config.js — aucun secret à configurer dans le
   dépôt. Lancé par le workflow keepalive.yml (cron tous les 3 jours).

   Lecture de config.js comme SEULE source de vérité (URL + clé) : on charge
   le fichier avec un `window` factice, exactement comme le navigateur.
   ========================================================================= */
'use strict';

var path = require('path');
var https = require('https');

// config.js fait « window.RECAP_MARIA_CONFIG = {...} » : on fournit window.
global.window = {};
require(path.join(__dirname, '..', 'config.js'));

var cfg = global.window.RECAP_MARIA_CONFIG || {};
if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
  console.error('config.js incomplet (SUPABASE_URL / SUPABASE_ANON_KEY manquant).');
  process.exit(1);
}

var u = new URL('/rest/v1/', cfg.SUPABASE_URL);
var req = https.request({
  method: 'GET',
  hostname: u.hostname,
  path: u.pathname,
  headers: { apikey: cfg.SUPABASE_ANON_KEY }
}, function (res) {
  res.resume(); // vide le flux
  console.log('Keepalive Supabase — statut HTTP ' + res.statusCode);
  // Tout code < 500 prouve que le projet répond (donc actif). 5xx = souci serveur.
  process.exit(res.statusCode && res.statusCode < 500 ? 0 : 1);
});
req.on('error', function (e) { console.error('Keepalive échec : ' + e.message); process.exit(1); });
req.setTimeout(15000, function () { console.error('Keepalive timeout'); req.destroy(); process.exit(1); });
req.end();
