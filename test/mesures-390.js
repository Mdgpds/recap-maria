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
  ['rappels', {}],
  /* LOT 33 §1.4 — l'écran de diagnostic de l'affichage. */
  ['affichage', {}],
  ['conges', {}, { feuille: 'pose', ouvrir: () => {
    const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Poser des congés');
    if (b) b.click(); return !!b;
  } }],
  /* LOT 32 §8 — la même feuille, deux bornes posées au calendrier : le
     décompte, les samedis et « Pour qui » sont alors à l'écran. */
  ['conges', {}, { feuille: 'pose-bornes', ouvrir: () => {
    const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Poser des congés');
    if (!b) return false;
    b.click();
    const suiv = document.querySelector('#sheet button[aria-label="Mois suivant"]');
    if (!suiv) return false;
    suiv.click();
    const t1 = document.querySelector('#sheet td[data-jour="2026-09-21"]');
    const t2 = document.querySelector('#sheet td[data-jour="2026-09-24"]');
    if (!t1 || !t2) return false;
    t1.click(); t2.click();
    return true;
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

  /* §7 — LA CONNEXION, À 390 PX, CLAVIER FERMÉ PUIS OUVERT. L'écran vit hors
     de `#vue-app` : on le montre à la main et on le mesure comme les autres,
     puis on réduit la fenêtre de la hauteur d'un clavier d'iPhone (≈ 336 pt)
     et on vérifie que le bouton reste atteignable — visible, ou amené dans
     la fenêtre en faisant défiler le conteneur. */
  /* §8 — LES COULEURS DE `selb` ET DE `dans`, EN VALEUR CALCULÉE. Leur
     présence dans le CSS ne prouve rien : c'est précisément ce qui a manqué
     au redesign. On ouvre la pose, on touche deux jours, et on lit ce que le
     navigateur peint — contre les jetons `--ac` et `--dansf` lus au même
     endroit. */
  console.log('\n=== §8 — la pose au calendrier, en valeur calculée ===');
  await aller('conges', {});
  const p8 = await page.evaluate(async () => {
    const attendre = (ms) => new Promise(r => setTimeout(r, ms));
    const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Poser des congés');
    b.click(); await attendre(300);
    document.querySelector('#sheet button[aria-label="Mois suivant"]').click();
    await attendre(100);
    const cs = getComputedStyle(document.documentElement);
    const jeton = (n) => { const d = document.createElement('div'); d.style.background = cs.getPropertyValue(n).trim();
      document.body.appendChild(d); const v = getComputedStyle(d).backgroundColor; d.remove(); return v; };
    const out = { ac: jeton('--ac'), dansf: jeton('--dansf'), ln2: jeton('--ln2') };
    const btn = document.querySelector('#sheet .stick button');
    out.inactifAvant = btn.disabled;
    document.querySelector('#sheet td[data-jour="2026-09-21"]').click(); await attendre(100);
    out.inactifUneBorne = btn.disabled;
    out.selb1 = getComputedStyle(document.querySelector('#sheet td[data-jour="2026-09-21"]')).backgroundColor;
    document.querySelector('#sheet td[data-jour="2026-09-24"]').click(); await attendre(900);
    out.selb2 = getComputedStyle(document.querySelector('#sheet td[data-jour="2026-09-24"]')).backgroundColor;
    out.dans = getComputedStyle(document.querySelector('#sheet td[data-jour="2026-09-22"]')).backgroundColor;
    out.horsPlage = getComputedStyle(document.querySelector('#sheet td[data-jour="2026-09-25"]')).backgroundColor;
    out.actifDeux = !btn.disabled;
    out.decompte = (document.querySelector('#sheet .res .big2') || {}).textContent || '';
    document.querySelector('#sheet button[aria-label="Mois suivant"]').click();
    document.querySelector('#sheet button[aria-label="Mois suivant"]').click(); await attendre(100);
    out.ferie = getComputedStyle(document.querySelector('#sheet td[data-jour="2026-11-11"]')).backgroundColor;
    return out;
  });
  controle('§8 le bouton est inactif sans borne', p8.inactifAvant);
  controle('§8 le bouton reste inactif avec une seule borne', p8.inactifUneBorne);
  controle('§8 la première borne est peinte en `--ac`', p8.selb1 === p8.ac, p8.selb1 + ' / ' + p8.ac);
  controle('§8 la seconde borne est peinte en `--ac`', p8.selb2 === p8.ac, p8.selb2);
  controle('§8 un jour entre les bornes est peint en `--dansf`', p8.dans === p8.dansf, p8.dans + ' / ' + p8.dansf);
  controle('§8 un jour hors plage n’est ni l’un ni l’autre', p8.horsPlage !== p8.ac && p8.horsPlage !== p8.dansf, p8.horsPlage);
  controle('§8 un férié est peint en `--ln2` (état `fe`)', p8.ferie === p8.ln2, p8.ferie);
  controle('§8 les deux bornes posées, le bouton s’active', p8.actifDeux);
  controle('§8 le décompte est affiché (« 4 j ouvrables »)', /4/.test(p8.decompte), p8.decompte);
  await page.evaluate(() => window.Kit.fermerFeuille());

  console.log('\n=== §7 — la connexion ===');
  await page.evaluate(() => { if (window.Kit && window.Kit.fermerFeuille) window.Kit.fermerFeuille(); });
  const mesureLogin = async (etiquette) => page.evaluate((etq) => {
    const login = document.getElementById('vue-login');
    document.getElementById('vue-app').hidden = true;
    login.hidden = false;
    const out = { deb: [], pet: [], fond: getComputedStyle(login).backgroundColor,
      onglets: !!document.querySelector('#vue-login .tabs, #vue-login .back, #vue-login .bk') };
    login.querySelectorAll('*').forEach(el => {
      const b = el.getBoundingClientRect();
      if (b.width === 0 && b.height === 0) return;
      if (b.right > 390.5 || b.left < -0.5) out.deb.push(el.tagName + '.' + el.className);
    });
    login.querySelectorAll('button, input').forEach(el => {
      const b = el.getBoundingClientRect();
      if (b.height < 44 || b.width < 44) out.pet.push(el.tagName + '#' + el.id + ' ' + Math.round(b.width) + '×' + Math.round(b.height));
    });
    const btn = document.getElementById('btn-login');
    login.scrollTop = login.scrollHeight;
    const rb = btn.getBoundingClientRect();
    out.boutonAtteignable = rb.bottom <= window.innerHeight + 0.5 && rb.top >= 0;
    out.boutonBas = Math.round(rb.bottom); out.fenetre = window.innerHeight;
    login.scrollTop = 0;
    return out;
  }, etiquette);
  const l1 = await mesureLogin('fermé');
  controle('§7 fond `--bg` (pas de dégradé vert)', l1.fond === 'rgb(247, 250, 248)', l1.fond);
  controle('§7 ni barre d’onglets ni flèche de retour', !l1.onglets);
  controle('§7 aucun débordement horizontal', l1.deb.length === 0, l1.deb.join(', '));
  controle('§7 aucune zone tactile sous 44 px', l1.pet.length === 0, l1.pet.join(', '));
  controle('§7 clavier fermé : le bouton est dans l’écran', l1.boutonAtteignable, l1.boutonBas + ' / ' + l1.fenetre);
  /* Deux hauteurs : un iPhone 14 Pro clavier ouvert (≈ 444 pt), et un petit
     iPhone clavier ouvert avec les barres de Safari (≈ 360 pt). C'est la
     seconde qui mordait sur le code d'avant : le bloc centré débordait des
     deux côtés et le bouton restait sous le clavier. */
  for (const h of [444, 360]) {
    await page.setViewportSize({ width: 390, height: h });
    await page.waitForTimeout(300);
    const l2 = await mesureLogin('ouvert');
    controle('§7 clavier ouvert (' + h + ' px) : le bouton reste atteignable', l2.boutonAtteignable, l2.boutonBas + ' / ' + l2.fenetre);
  }
  await page.setViewportSize({ width: 390, height: 780 });
  await page.evaluate(() => { document.getElementById('vue-login').hidden = true; document.getElementById('vue-app').hidden = false; });

  /* ------------------------------------------------------------------
     LOT 33 §1.5 — « TOUTES LES TAILLES D'IPHONE ».

     Les écrans racine aux sept tailles d'iPhone en service. À chacune :
     aucun débordement, aucun contrôle rogné, aucune zone tactile sous
     44 px, le bas de la barre d'onglets au bas de la fenêtre à 1 px près,
     l'en-tête qui part de 0. Une ligne par taille et par écran.
     ------------------------------------------------------------------ */
  const TAILLES = [
    ['iPhone SE (1re génération)', 320, 568],
    ['iPhone SE (2e et 3e)', 375, 667],
    ['iPhone 12 à 14', 390, 844],
    ['iPhone 14 Pro, 15, 16', 393, 852],
    ['iPhone 16 Pro', 402, 874],
    ['iPhone Pro Max', 430, 932],
    ['iPhone 16 Pro Max', 440, 956]
  ];
  const RACINES = [
    ['accueil', {}], ['enfant', { contratId: 'c1', annee: 2026, mois: 8 }],
    ['conges', {}], ['docs', {}], ['menu', {}]
  ];
  const mesurerTaille = (L) => page.evaluate((L) => {
    const out = { deb: [], rog: [], pet: [] };
    document.querySelectorAll('#vue-app *').forEach(el => {
      const b = el.getBoundingClientRect();
      if (b.width === 0 && b.height === 0) return;
      if (b.right > L + 0.5 || b.left < -0.5) out.deb.push((el.tagName + '.' + (el.className || '')).slice(0, 50));
      if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX === 'hidden') {
        out.rog.push((el.tagName + '.' + (el.className || '')).slice(0, 50));
      }
    });
    document.querySelectorAll('#vue-app button, #vue-app a, #vue-app input, #vue-app select').forEach(el => {
      const b = el.getBoundingClientRect();
      if (b.width === 0 && b.height === 0) return;
      let w = b.width, h = b.height;
      const a = getComputedStyle(el, '::after');
      if (a && a.content !== 'none' && a.position === 'absolute' && a.minHeight === '44px' && a.minWidth === '44px') {
        w = Math.max(w, parseFloat(a.width) || 0); h = Math.max(h, parseFloat(a.height) || 0);
      }
      if (h < 44 || w < 44) out.pet.push((el.tagName + '.' + (el.className || '')).slice(0, 40) + ' ' + Math.round(w) + '×' + Math.round(h));
    });
    const tb = document.getElementById('tabbar');
    const rb = tb && !tb.hidden ? tb.getBoundingClientRect() : null;
    out.ongletsBas = rb ? rb.bottom : null;
    out.fenetre = window.innerHeight;
    out.enteteHaut = document.getElementById('barre').getBoundingClientRect().top;
    out.defile = document.scrollingElement.scrollHeight > window.innerHeight + 1;
    return out;
  }, L);
  console.log('\n=== LOT 33 §1.5 — les sept tailles d’iPhone ===');
  const tableau = [];
  for (const [nomT, L, H] of TAILLES) {
    await page.setViewportSize({ width: L, height: H });
    await page.waitForTimeout(250);
    let lig = { taille: nomT + ' ' + L + '×' + H, deb: 0, rog: 0, pet: 0, bas: 'ok', entete: 'ok' };
    for (const [ecran, params] of RACINES) {
      await aller(ecran, params);
      const r = await mesurerTaille(L);
      const basOk = r.ongletsBas != null && Math.abs(r.ongletsBas - r.fenetre) <= 1;
      const entOk = Math.abs(r.enteteHaut) <= 0.5;
      controle(nomT + ' ' + L + '×' + H + ' · ' + ecran + ' : rien ne déborde, rien n’est rogné, rien sous 44 px',
        r.deb.length + r.rog.length + r.pet.length === 0,
        [].concat(r.deb, r.rog, r.pet).slice(0, 4).join(' ; '));
      controle(nomT + ' ' + L + '×' + H + ' · ' + ecran + ' : la barre d’onglets touche le bas',
        basOk, Math.round(r.ongletsBas) + ' / ' + r.fenetre);
      controle(nomT + ' ' + L + '×' + H + ' · ' + ecran + ' : l’en-tête part de 0, la page ne défile pas',
        entOk && !r.defile, 'haut ' + r.enteteHaut + (r.defile ? ', la page défile' : ''));
      lig.deb += r.deb.length; lig.rog += r.rog.length; lig.pet += r.pet.length;
      if (!basOk) lig.bas = 'KO'; if (!entOk) lig.entete = 'KO';
    }
    tableau.push(lig);
  }
  console.log('\n  Taille                                 débord. rognés <44px  bas   en-tête');
  tableau.forEach(l => console.log('  ' + l.taille.padEnd(38) + String(l.deb).padStart(6) +
    String(l.rog).padStart(7) + String(l.pet).padStart(6) + '  ' + l.bas.padEnd(5) + ' ' + l.entete));

  /* LOT 33 §3 — LE TOTAL DU MOIS, EN VALEUR CALCULÉE, au plus étroit
     (320 px) et au plus large (440 px) : dernier élément de la page, entier
     au-dessus de la barre d'onglets une fois le corps défilé jusqu'en bas,
     fond tiré des jetons `--ac2` / `--ac`, aucun texte qui sort du cadre. */
  console.log('\n=== LOT 33 §3 — le total du mois en bas de l’accueil ===');
  for (const [L, H] of [[320, 568], [440, 956]]) {
    await page.setViewportSize({ width: L, height: H });
    await aller('accueil');
    const t3 = await page.evaluate(() => {
      const bd = document.getElementById('corps'); bd.scrollTop = bd.scrollHeight;
      const c = document.querySelector('.totmois');
      if (!c) return null;
      const rc = c.getBoundingClientRect(), rt = document.getElementById('tabbar').getBoundingClientRect();
      const cs = getComputedStyle(document.documentElement);
      const jeton = (n) => { const d = document.createElement('div'); d.style.color = cs.getPropertyValue(n).trim();
        document.body.appendChild(d); const v = getComputedStyle(d).color; d.remove(); return v; };
      const sorti = [...c.querySelectorAll('*')].filter(e => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && (r.right > rc.right + 0.5 || r.left < rc.left - 0.5 || e.scrollWidth > e.clientWidth + 1);
      }).map(e => e.className);
      return { dernier: bd.lastElementChild === c, bas: rc.bottom, haut: rc.top, onglets: rt.top,
        fond: getComputedStyle(c).backgroundImage, ac: jeton('--ac'), ac2: jeton('--ac2'),
        texte: getComputedStyle(c).color, bg2: jeton('--bg2'), sorti };
    });
    controle('§3 ' + L + '×' + H + ' : la carte du total est le dernier élément de l’accueil', t3 && t3.dernier);
    controle('§3 ' + L + '×' + H + ' : corps défilé en bas, la carte est entière au-dessus de la barre d’onglets',
      t3 && t3.bas <= t3.onglets + 0.5 && t3.haut >= 0, t3 && (Math.round(t3.bas) + ' / ' + Math.round(t3.onglets)));
    controle('§3 ' + L + '×' + H + ' : fond d’accent tiré des jetons (--ac2 → --ac)',
      t3 && t3.fond.indexOf(t3.ac) !== -1 && t3.fond.indexOf(t3.ac2) !== -1, t3 && t3.fond.slice(0, 70));
    controle('§3 ' + L + '×' + H + ' : texte en `--bg2`', t3 && t3.texte === t3.bg2, t3 && t3.texte);
    controle('§3 ' + L + '×' + H + ' : aucun texte ne sort de la carte', t3 && t3.sorti.length === 0, t3 && t3.sorti.join(', '));
  }

  /* LA MESURE MORD : on remet en place, sur une copie de l'état, le défaut
     d'iOS — l'application qui s'arrête 59 pt avant le bas — et la mesure du
     bas de la barre doit tomber. Si elle restait verte, elle ne mesurerait
     rien. */
  await page.setViewportSize({ width: 393, height: 852 });
  await aller('accueil');
  await page.addStyleTag({ content: '.appli{bottom:59px !important}', }).then(h => page.evaluate(e => e.id = 'mutation-ios', h));
  const mut = await mesurerTaille(393);
  controle('§1.5 la mesure mord : avec le défaut d’iOS remis (59 pt), le bas de la barre est vu faux',
    !(mut.ongletsBas != null && Math.abs(mut.ongletsBas - mut.fenetre) <= 1), Math.round(mut.ongletsBas) + ' / ' + mut.fenetre);
  /* le diagnostic, lui, doit annoncer « Il manque 59 points » */
  await aller('affichage');
  const vMut = await page.evaluate(() => (document.querySelector('[data-verdict]') || {}).textContent || '');
  controle('§1.4 le diagnostic, défaut remis, dit « Il manque 59 points en bas »', /Il manque 59 points en bas/.test(vMut), vMut.slice(0, 60));
  await page.evaluate(() => { const m = document.getElementById('mutation-ios'); if (m) m.remove(); });
  await aller('affichage');
  const vOk = await page.evaluate(() => (document.querySelector('[data-verdict]') || {}).textContent || '');
  controle('§1.4 le diagnostic, sans défaut, dit « La barre d’onglets touche le bas de l’écran »', /touche le bas de l’écran/.test(vOk), vOk.slice(0, 60));
  const lignesDiag = await page.evaluate(() => [...document.querySelectorAll('#corps .ln')].map(l => l.firstChild.textContent));
  controle('§1.4 le diagnostic affiche ses douze mesures', ['Application installée', 'Hauteur de l’écran', 'Hauteur de la fenêtre',
    'Hauteur visible', '100lvh', '100dvh', '100vh', 'Marge du haut', 'Marge du bas', 'Hauteur de l’application',
    'Bas de l’application', 'Bas de la barre d’onglets'].every(x => lignesDiag.includes(x)), lignesDiag.length + ' lignes');

  /* L'APPLICATION « INSTALLÉE » DANS CHROMIUM. On ne reproduit pas le défaut
     d'iOS — aucun navigateur de bureau ne le fait — mais on vérifie que le
     correctif ne casse rien là où la marge est nulle : la classe est posée,
     la règle s'applique, le document ne grandit pas au-delà de la fenêtre et
     la page ne se met pas à défiler. */
  const pageI = await nav.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await pageI.addInitScript(FAUX);
  await pageI.addInitScript(() => { Object.defineProperty(navigator, 'standalone', { get: () => true }); });
  await pageI.goto('http://localhost:8098/', { waitUntil: 'domcontentloaded' });
  await pageI.waitForTimeout(1500);
  const inst = await pageI.evaluate(() => {
    const h = document.documentElement;
    return { classe: h.classList.contains('installee'), minH: getComputedStyle(h).minHeight,
      fenetre: window.innerHeight, docH: h.getBoundingClientRect().height,
      defile: document.scrollingElement.scrollHeight > window.innerHeight + 1,
      bas: document.getElementById('tabbar').getBoundingClientRect().bottom };
  });
  controle('§1.3 installée (navigator.standalone) : la classe `installee` est posée', inst.classe);
  controle('§1.3 installée : la règle `min-height` s’applique (valeur calculée)', inst.minH !== '0px' && inst.minH !== 'auto', inst.minH);
  controle('§1.3 installée, marge nulle : le document ne dépasse pas la fenêtre', Math.abs(inst.docH - inst.fenetre) <= 1, inst.docH + ' / ' + inst.fenetre);
  controle('§1.3 installée : la page elle-même ne défile pas', !inst.defile);
  controle('§1.3 installée : la barre d’onglets touche le bas', Math.abs(inst.bas - inst.fenetre) <= 1, inst.bas + ' / ' + inst.fenetre);
  await pageI.close();
  const nonInst = await page.evaluate(() => ({ classe: document.documentElement.classList.contains('installee'),
    minH: getComputedStyle(document.documentElement).minHeight }));
  controle('§1.3 non installée : pas de classe, `min-height` inchangé', !nonInst.classe && (nonInst.minH === '0px' || nonInst.minH === 'auto'), nonInst.minH);
  await page.setViewportSize({ width: 390, height: 780 });

  console.log('\nTOTAL — débordements ' + total.deb + ', rognés ' + total.rog +
    ', zones < 44 px ' + total.pet + ', feuilles invisibles ' + total.feuilles +
    ', contrôles en défaut ' + defauts);
  await nav.close(); serveur.close();
  if (total.deb + total.rog + total.pet + total.feuilles + defauts > 0) process.exit(1);
})();
