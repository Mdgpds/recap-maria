/* ============================================================================
   REDESIGN 2A §10.4 — LES MESURES À 390 PX, SUR LES ÉCRANS RÉELS.

   « Mesures à 390 px de large, pas sur un écran d'ordinateur. Aucun
     débordement horizontal, aucun contrôle rogné, aucune zone tactile sous
     44 px. »

   jsdom ne met pas en page : il ne sait ni la largeur d'un bouton ni si un
   tableau déborde. Ce script lance donc un VRAI navigateur (Chromium, par
   Playwright) à 390 × 780, densité 3, tactile, et parcourt sept écrans. Le
   client Supabase est remplacé par un faux qui sert un décor FICTIF et rond
   (`test/fixtures/faux-supabase-390.js`) : l'application se croit connectée et
   dessine ses écrans pour de vrai, mise en page comprise. L'horloge est figée
   au 21 août 2026 pour que la mesure ne change pas de jour en jour.

   La zone tactile n'est pas toujours le rectangle dessiné : la maquette gagne
   sur le dessin, et une surface transparente (`::after` hors flux, min 44 px)
   peut étendre la cible. On ne compte comme extension qu'un `::after`
   EXPLICITEMENT marqué min-width et min-height 44px — la décoration ne
   compte pas, sinon la mesure se mentirait à elle-même.

   Ce script est versé au dépôt à la demande de la relecture du 1er septembre :
   une preuve qu'on ne peut pas rejouer n'est pas une preuve.

   Prérequis : Playwright et un Chromium (`npm i -D playwright` puis
   `npx playwright install chromium`, ou PLAYWRIGHT_CHROMIUM=/chemin/chromium).
   Il n'est PAS dans `npm run test:ui`, qui doit rester sans navigateur.

   Lancement : node test/mesures-390.js        (code 1 au premier défaut)
   ========================================================================= */
'use strict';
let chromium;
try { chromium = require('playwright').chromium; }
catch (e) {
  console.error('Playwright est absent : `npm i -D playwright && npx playwright install chromium`.');
  process.exit(2);
}
const path = require('path'), http = require('http'), fs = require('fs');
const RACINE = path.join(__dirname, '..');
const TYPES = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
  '.json':'application/json', '.png':'image/png' };

const serveur = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(RACINE, p);
  if (!f.startsWith(RACINE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    res.writeHead(404); res.end('non'); return;
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'text/plain' });
  res.end(fs.readFileSync(f));
});

const FAUX = fs.readFileSync(path.join(__dirname, 'fixtures', 'faux-supabase-390.js'), 'utf8');

const ECRANS = [
  ['accueil', {}], ['conges', {}], ['docs', {}], ['menu', {}],
  ['enfant', { contratId: 'c1', annee: 2026, mois: 8 }],
  ['cloture', {}], ['moisPasse', { annee: 2026, mois: 7 }]
];

(async () => {
  await new Promise(r => serveur.listen(8098, r));
  const nav = await (process.env.PLAYWRIGHT_CHROMIUM
    ? chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM })
    : chromium.launch());
  const page = await nav.newPage({ viewport: { width: 390, height: 780 },
    deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await page.addInitScript(FAUX);
  await page.goto('http://localhost:8098/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  let total = { deb: 0, rog: 0, pet: 0 };
  for (const [ecran, params] of ECRANS) {
    await page.evaluate(([e, p]) => window.App && window.App.aller(e, p, true), [ecran, params]);
    await page.waitForTimeout(700);
    const r = await page.evaluate(() => {
      const out = { largeur: document.documentElement.scrollWidth,
        deb: [], rog: [], pet: [] };
      document.querySelectorAll('#vue-app *').forEach(el => {
        const b = el.getBoundingClientRect();
        if (b.width === 0 && b.height === 0) return;
        if (b.right > 390.5 || b.left < -0.5) {
          out.deb.push((el.tagName + '.' + (el.className || '')).slice(0, 55) +
            ' [' + Math.round(b.left) + '→' + Math.round(b.right) + ']');
        }
        if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX === 'hidden') {
          out.rog.push((el.tagName + '.' + (el.className || '')).slice(0, 55));
        }
      });
      /* La zone tactile n'est pas toujours le rectangle dessiné : une
         surface transparente peut l'étendre (::after hors flux, min 44 px).
         On ne compte comme extension qu'un ::after explicitement marqué
         min-width/min-height 44px — la décoration ne compte pas. */
      const zone = (el) => {
        const b = el.getBoundingClientRect();
        let w = b.width, h = b.height;
        const a = getComputedStyle(el, '::after');
        if (a && a.content !== 'none' && a.position === 'absolute' &&
            a.minHeight === '44px' && a.minWidth === '44px') {
          w = Math.max(w, parseFloat(a.width) || 0);
          h = Math.max(h, parseFloat(a.height) || 0);
        }
        return { w: w, h: h, dessine: b };
      };
      document.querySelectorAll('#vue-app button, #vue-app a, #vue-app input, #vue-app select').forEach(el => {
        const z = zone(el);
        if (z.dessine.width === 0 && z.dessine.height === 0) return;
        if (z.h < 44 || z.w < 44) out.pet.push((el.tagName + '.' + (el.className || '')).slice(0, 45) +
          ' ' + Math.round(z.w) + '×' + Math.round(z.h));
      });
      return out;
    });
    total.deb += r.deb.length; total.rog += r.rog.length; total.pet += r.pet.length;
    console.log('\n=== ' + ecran + ' === largeur ' + r.largeur + ' px');
    console.log('  débordements : ' + (r.deb.length || 'aucun'));
    r.deb.slice(0, 6).forEach(x => console.log('     ' + x));
    console.log('  rognés       : ' + (r.rog.length || 'aucun'));
    r.rog.slice(0, 6).forEach(x => console.log('     ' + x));
    console.log('  < 44 px      : ' + (r.pet.length || 'aucune'));
    r.pet.slice(0, 8).forEach(x => console.log('     ' + x));
    if (process.env.CAPTURES) await page.screenshot({ path: path.join(process.env.CAPTURES, '390-' + ecran + '.png') });
  }
  console.log('\nTOTAL — débordements ' + total.deb + ', rognés ' + total.rog +
    ', zones < 44 px ' + total.pet);
  await nav.close(); serveur.close();
  if (total.deb + total.rog + total.pet > 0) process.exit(1);
})();
