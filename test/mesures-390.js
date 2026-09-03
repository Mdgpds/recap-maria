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

/* Sept écrans, puis DEUX FEUILLES : la pose d'un congé (depuis Congés) et la
   journée du 21 août (depuis l'espace enfant). Le troisième élément ouvre la
   feuille une fois l'écran rendu ; la mesure exige alors que `#sheetwrap`
   soit réellement VISIBLE et occupe l'écran. Le 2 septembre, toutes les
   feuilles de l'application étaient invisibles en production — `display:none`
   au repos, montré par une classe que personne ne posait — et cette mesure
   n'ouvrait aucune feuille. Elle en ouvre deux maintenant. */
const ECRANS = [
  ['accueil', {}], ['conges', {}], ['docs', {}], ['menu', {}],
  ['enfant', { contratId: 'c1', annee: 2026, mois: 8 }],
  ['cloture', {}], ['moisPasse', { annee: 2026, mois: 7 }],
  /* LOT 32 — les écrans restants passent sous la même mesure. */
  ['fiche', { contratId: 'c1' }],
  ['fiche', { contratId: 'c1', section: 'fin' }],
  ['periode', {}],
  ['periode', {}, { resultats: true, ouvrir: () => {
    const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Ce mois-ci');
    if (b) b.click(); return !!b;
  } }],
  ['familiarisation', { contratId: 'c2' }],
  ['conges', {}, { feuille: 'pose', ouvrir: () => {
    const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Poser des congés');
    if (b) b.click(); return !!b;
  } }],
  /* LOT 32 §6 — la réouverture est une feuille : elle s'ouvre depuis le
     document d'un mois clôturé, et sa visibilité se mesure comme les autres. */
  ['document', { contratId: 'c1', annee: 2026, mois: 7 }, { feuille: 'rouvrir', ouvrir: () => {
    const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Rouvrir pour corriger');
    if (b) b.click(); return !!b;
  } }],
  ['enfant', { contratId: 'c1', annee: 2026, mois: 8 }, { feuille: 'journee', ouvrir: () => {
    const td = [...document.querySelectorAll('table.cal td')].find(t => t.querySelector('.num') &&
      t.querySelector('.num').textContent.trim() === '20' && t.getAttribute('role') === 'button');
    if (td) td.click(); return !!td;
  } }]
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

  let total = { deb: 0, rog: 0, pet: 0, feuilles: 0 };
  for (const [ecran, params, extra] of ECRANS) {
    await page.evaluate(() => { if (window.Kit && window.Kit.fermerFeuille) window.Kit.fermerFeuille(); });
    await page.evaluate(([e, p]) => window.App && window.App.aller(e, p, true), [ecran, params]);
    await page.waitForTimeout(700);
    let nom = ecran;
    if (extra && extra.resultats) {
      nom = ecran + ' → résultats';
      await page.evaluate(extra.ouvrir);
      await page.waitForTimeout(1200);
    }
    if (extra && extra.feuille) {
      nom = ecran + ' → feuille ' + extra.feuille;
      const trouve = await page.evaluate(extra.ouvrir);
      await page.waitForTimeout(700);
      const f = await page.evaluate(() => {
        const w = document.getElementById('sheetwrap'), s = document.getElementById('sheet');
        const rw = w.getBoundingClientRect(), rs = s.getBoundingClientRect();
        return { hidden: w.hidden, display: getComputedStyle(w).display,
          voile: [Math.round(rw.width), Math.round(rw.height)],
          feuille: [Math.round(rs.width), Math.round(rs.height)],
          texte: s.textContent.replace(/\s+/g, ' ').trim().slice(0, 40) };
      });
      const visible = trouve && !f.hidden && f.display !== 'none' &&
        f.voile[0] >= 390 && f.voile[1] >= 780 && f.feuille[1] >= 200;
      console.log('\n=== ' + nom + ' === ' + (visible ? 'VISIBLE' : 'INVISIBLE') +
        ' — voile ' + f.voile.join('×') + ', feuille ' + f.feuille.join('×') +
        ', display ' + f.display + ' — « ' + f.texte + ' »');
      if (!visible) total.feuilles++;
    }
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
    console.log((extra && extra.feuille ? '' : '\n=== ' + nom + ' === ') + 'largeur ' + r.largeur + ' px');
    console.log('  débordements : ' + (r.deb.length || 'aucun'));
    r.deb.slice(0, 6).forEach(x => console.log('     ' + x));
    console.log('  rognés       : ' + (r.rog.length || 'aucun'));
    r.rog.slice(0, 6).forEach(x => console.log('     ' + x));
    console.log('  < 44 px      : ' + (r.pet.length || 'aucune'));
    r.pet.slice(0, 8).forEach(x => console.log('     ' + x));
    if (process.env.CAPTURES) await page.screenshot({ path: path.join(process.env.CAPTURES,
      '390-' + ecran + (params && params.section ? '-' + params.section : '') +
      (extra && extra.feuille ? '-feuille-' + extra.feuille : '') + (extra && extra.resultats ? '-resultats' : '') + '.png') });
  }
  /* ------------------------------------------------------------------
     LOT 32 — LES CONTRÔLES DE VALEUR CALCULÉE.

     Quatre défauts de la même forme en deux jours : « ce que la feuille de
     style fait vraiment, que personne ne regardait », chaque fois invisibles
     à jsdom. Chaque contrôle ci-dessous lit la VALEUR CALCULÉE dans le vrai
     navigateur et compte un défaut par échec. Un contrôle qui ne sait pas
     échouer ne teste rien : chacun a été vu rouge contre le code d'avant.
     ------------------------------------------------------------------ */
  let defauts = 0;
  const controle = (nom, ok, detail) => {
    console.log((ok ? 'ok   ' : 'KO   ') + nom + (detail ? ' — ' + detail : ''));
    if (!ok) defauts++;
  };
  const aller = async (ecran, params) => {
    await page.evaluate(() => { if (window.Kit && window.Kit.fermerFeuille) window.Kit.fermerFeuille(); });
    await page.evaluate(([e, p]) => window.App.aller(e, p, true), [ecran, params || {}]);
    await page.waitForTimeout(600);
  };
  const fondBarre = () => page.evaluate(() => {
    const b = document.getElementById('barre') || document.querySelector('#vue-app .bar, #vue-app .top');
    const c = getComputedStyle(b);
    return c.backgroundImage + ' | ' + c.backgroundColor;
  });

  console.log('\n=== §1 — l’en-tête reprend sa couleur en quittant un enfant ===');
  /* Le vert de référence se lit sur un élément NEUF portant la même classe
     que l'en-tête de l'accueil, jamais sur l'en-tête lui-même : le parcours
     précédent a déjà ouvert un enfant, et c'est précisément lui qui pouvait
     laisser sa teinte. Sans cette précaution, le « vert » relevé serait la
     couleur de l'enfant, et le contrôle se validerait lui-même. */
  await aller('accueil');
  const vert = await page.evaluate(() => {
    const b = document.getElementById('barre');
    const t = document.createElement('header'); t.className = b.className;
    b.parentNode.insertBefore(t, b);
    const c = getComputedStyle(t); const v = c.backgroundImage + ' | ' + c.backgroundColor;
    t.remove(); return v;
  });
  const accueil = await fondBarre();
  controle('§1 l’accueil, après un enfant déjà ouvert, porte le vert de la feuille de style', accueil === vert, accueil.slice(0, 60));
  await aller('enfant', { contratId: 'c1', annee: 2026, mois: 8 });
  const teinte = await fondBarre();
  controle('§1 l’espace enfant teinte l’en-tête (valeur calculée ≠ vert)', teinte !== vert, teinte.slice(0, 60));
  /* retour par la flèche */
  await page.evaluate(() => { const bk = document.querySelector('#barre .back, #barre .bk'); if (bk) bk.click(); });
  await page.waitForTimeout(600);
  const apresFleche = await fondBarre();
  controle('§1 retour par la flèche : le vert à l’identique', apresFleche === vert, apresFleche.slice(0, 60));
  /* retour par chaque onglet */
  for (const onglet of ['conges', 'docs', 'menu', 'accueil']) {
    await aller('enfant', { contratId: 'c1', annee: 2026, mois: 8 });
    await page.evaluate((o) => {
      const b = document.querySelector('#tabbar button[data-onglet="' + o + '"]');
      if (b) b.click(); else window.App.aller(o, {}, true);
    }, onglet);
    await page.waitForTimeout(600);
    const apres = await fondBarre();
    controle('§1 retour par l’onglet ' + onglet + ' : le vert à l’identique', apres === vert, apres.slice(0, 60));
  }

  console.log('\nTOTAL — débordements ' + total.deb + ', rognés ' + total.rog +
    ', zones < 44 px ' + total.pet + ', feuilles invisibles ' + total.feuilles +
    ', contrôles en défaut ' + defauts);
  await nav.close(); serveur.close();
  if (total.deb + total.rog + total.pet + total.feuilles + defauts > 0) process.exit(1);
})();
