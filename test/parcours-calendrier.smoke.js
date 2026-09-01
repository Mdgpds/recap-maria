/* ============================================================================
   Test de fumée — LOT 31 §2, LA COULEUR DES ÉTATS DU CALENDRIER.

   Ce que le §9.2 demande : « la couleur des états du calendrier se vérifie par
   la VALEUR CALCULÉE, pas par la présence d'une classe ».

   POURQUOI CE FICHIER N'UTILISE PAS `getComputedStyle`, ET C'EST IMPORTANT.

   jsdom résout la cascade dans l'ORDRE DES SOURCES et IGNORE la spécificité.
   Vérifié ici même avant d'écrire ce fichier :

       table.cal td { background: rgb(1,1,1) }   td.cg { background: rgb(2,2,2) }
       -> jsdom rend rgb(2,2,2)   ; un vrai navigateur rend rgb(1,1,1)

   Autrement dit : sur le défaut EXACT que le §2 corrige, `getComputedStyle`
   sous jsdom donne la BONNE réponse AVANT la correction comme après. Un test
   bâti dessus serait vert des deux côtés — il ne prouverait rien, et il
   affirmerait le contraire. Un test qui ment est pire qu'un test absent.

   Ce fichier résout donc lui-même la cascade pour la seule propriété en jeu :
   il laisse jsdom faire ce qu'il fait bien — apparier un sélecteur à un
   élément (`element.matches`) — et fait l'arithmétique de spécificité
   lui-même, celle du navigateur : (id, classe/attribut/pseudo-classe, type).
   À spécificité égale, la dernière règle gagne.

   La preuve que le test mord : on REMET le défaut dans une copie de la feuille
   — `table.cal td.cg` redevient `td.cg`, rien d'autre ne change — et la mesure
   doit s'effondrer sur les cinq états. Une mutation, pas une comparaison avec
   l'historique git : le contrôle reste valable dans un ZIP, dans un dépôt sans
   historique, et le jour où ce lot sera loin derrière.

   Lancement : node test/parcours-calendrier.smoke.js
   ========================================================================= */
'use strict';

var fs = require('fs');
var path = require('path');
var JSDOM = require('jsdom').JSDOM;

var racine = path.join(__dirname, '..');

var echecs = 0;
function assert(cond, msg) {
  if (!cond) { echecs++; console.error('FAIL ' + msg); } else { console.log('ok   ' + msg); }
}

/* ------------------------------------------------------------------------ */
/* La cascade, pour une seule propriété, faite à la main et honnêtement      */
/* ------------------------------------------------------------------------ */

/* Les variables du `:root`, substituées une fois pour toutes : jsdom ne sait
   pas résoudre `var()`, et une couleur non résolue rendrait « transparent »
   pour tout le monde — le même piège que ci-dessus, en plus discret. */
function resoudreVariables(css) {
  var vars = {};
  var bloc = (css.match(/:root\s*\{([\s\S]*?)\}/) || [])[1] || '';
  bloc.replace(/(--[\w-]+)\s*:\s*([^;]+);/g, function (_, k, v) { vars[k] = v.trim(); });
  for (var i = 0; i < 4; i++) {
    css = css.replace(/var\((--[\w-]+)\)/g, function (m, k) { return vars[k] || m; });
  }
  return css;
}

/* La spécificité d'un sélecteur simple, telle que la calcule un navigateur.
   Pas de `:where()`, pas de `:is()` dans cette feuille — le calcul reste celui
   du modèle historique, et c'est celui que le §2 cite. */
function specificite(sel) {
  var s = sel.trim();
  var a = (s.match(/#[\w-]+/g) || []).length;
  var b = (s.match(/\.[\w-]+/g) || []).length +
          (s.match(/\[[^\]]*\]/g) || []).length +
          (s.match(/:(?!:)(?!not\b)[\w-]+/g) || []).length;
  /* `:not(x)` ne compte pas pour lui-même, mais son contenu compte. */
  (s.match(/:not\(([^)]*)\)/g) || []).forEach(function (n) {
    var dedans = n.slice(5, -1);
    b += (dedans.match(/\.[\w-]+/g) || []).length;
  });
  var sansPseudo = s.replace(/::?[\w-]+(\([^)]*\))?/g, ' ').replace(/\[[^\]]*\]/g, ' ')
                    .replace(/[.#][\w-]+/g, ' ');
  var c = (sansPseudo.match(/\b[a-zA-Z][\w-]*\b/g) || []).length;
  return a * 10000 + b * 100 + c;
}

/* Toutes les règles `background` de la feuille, dans l'ordre du fichier. */
function reglesFond(css) {
  var out = [];
  var sansCommentaires = css.replace(/\/\*[\s\S]*?\*\//g, '');
  var re = /([^{}]+)\{([^{}]*)\}/g, m;
  while ((m = re.exec(sansCommentaires))) {
    var selecteurs = m[1].trim();
    if (!selecteurs || selecteurs.charAt(0) === '@') continue;
    var decls = m[2];
    var fond = null;
    decls.replace(/(^|;)\s*background(-color)?\s*:\s*([^;]+)/g, function (_, __, ___, v) {
      fond = v.trim(); return '';
    });
    if (fond === null) continue;
    selecteurs.split(',').forEach(function (sel) {
      sel = sel.trim();
      if (sel) out.push({ sel: sel, fond: fond, spec: specificite(sel) });
    });
  }
  return out;
}

/* Le fond qui GAGNE réellement sur cet élément. */
function fondGagnant(css, doc, el) {
  var gagnante = null;
  reglesFond(css).forEach(function (r) {
    var colle;
    try { colle = el.matches(r.sel); } catch (e) { colle = false; }
    if (!colle) return;
    if (!gagnante || r.spec >= gagnante.spec) gagnante = r;   // >= : le dernier gagne à égalité
  });
  return gagnante;
}

/* Un calendrier de test, avec une case par état. Les classes sont exactement
   celles que `js/ui-enfant.js` pose : `ok`, `cg`, `ab`, `fe`, `nt`, `we`. */
var ETATS = [
  { classe: 'cg', quoi: 'congé de Maria' },
  { classe: 'ab', quoi: 'absence de l’enfant' },
  { classe: 'fe', quoi: 'jour férié' },
  { classe: 'nt', quoi: 'journée non travaillée' },
  { classe: 'ok', quoi: 'journée de garde' }
];

function monter(css) {
  var cases = ETATS.map(function (e) {
    return '<td class="' + e.classe + '" id="c-' + e.classe + '"><div class="num">15</div></td>';
  }).join('');
  var dom = new JSDOM('<!doctype html><html><head><style>' + css + '</style></head>' +
    '<body><table class="cal"><tr>' + cases + '</tr></table></body></html>');
  return dom.window.document;
}

function mesurer(cssBrut) {
  var css = resoudreVariables(cssBrut);
  var doc = monter(css);
  return ETATS.map(function (e) {
    var el = doc.getElementById('c-' + e.classe);
    var g = fondGagnant(css, doc, el);
    return { etat: e, gagnante: g };
  });
}

/* ------------------------------------------------------------------------ */
/* 1. La feuille d'AUJOURD'HUI : chaque état gagne, et aucun n'est blanc     */
/* ------------------------------------------------------------------------ */

var BLANC = '#ffffff';
var cssActuel = fs.readFileSync(path.join(racine, 'css', 'style.css'), 'utf8');

console.log('\n--- §2 : la couleur d’état l’emporte sur la règle de base ---');

mesurer(cssActuel).forEach(function (r) {
  var g = r.gagnante;
  assert(!!g, 'un fond est déclaré pour ' + r.etat.quoi);
  if (!g) return;
  assert(g.sel.indexOf('.' + r.etat.classe) !== -1,
    r.etat.quoi + ' : la règle gagnante est bien celle de l’état (' + g.sel + ')');
  assert(g.fond.toLowerCase().indexOf(BLANC) === -1,
    r.etat.quoi + ' : le fond n’est pas blanc (' + g.fond + ')');
});

/* La correction ne devait PAS passer par `!important` : le §2 le dit, et un
   `!important` sur un fond de calendrier gagnerait aussi contre la prochaine
   règle légitime — un thème sombre, un état ajouté. */
var sansCommentaires = cssActuel.replace(/\/\*[\s\S]*?\*\//g, ' ');
var zoneCal = sansCommentaires.slice(sansCommentaires.indexOf('table.cal {'),
                                     sansCommentaires.indexOf('.lg {'));
assert(zoneCal.length > 0 && zoneCal.indexOf('!important') === -1,
  'aucun !important n’a été ajouté dans le bloc du calendrier');

/* ------------------------------------------------------------------------ */
/* 2. LA PREUVE QUE LE TEST MORD : on lui rend le défaut, il doit crier      */
/* ------------------------------------------------------------------------ */

/* Un test de couleur qui ne sait pas échouer ne teste pas la couleur. On
   REMET donc le défaut dans une copie de la feuille — `table.cal td.cg`
   redevient `td.cg`, et rien d'autre ne change — et on vérifie que la mesure
   s'effondre. C'est une mutation, pas une comparaison avec l'historique git :
   le contrôle reste valable dans un ZIP, dans un dépôt sans historique, et le
   jour où ce lot sera loin derrière. */

console.log('\n--- on remet le défaut : la mesure doit s’effondrer ---');

var cssAvecLeDefaut = cssActuel.replace(
  /table\.cal td\.(ok|ab|fe|cg|we|nt|warn)\b/g, 'td.$1');

assert(cssAvecLeDefaut !== cssActuel,
  'la mutation a bien retiré la requalification (sinon le contrôle serait vide)');

var perdants = mesurer(cssAvecLeDefaut).filter(function (r) {
  return !r.gagnante || r.gagnante.sel.indexOf('.' + r.etat.classe) === -1;
});
assert(perdants.length === ETATS.length,
  'sans la requalification, TOUS les états perdent leur couleur — ' +
  perdants.length + ' sur ' + ETATS.length + ' (' +
  perdants.map(function (p) { return p.etat.classe; }).join(', ') + ')');

mesurer(cssAvecLeDefaut).forEach(function (r) {
  if (!r.gagnante) return;
  assert(r.gagnante.fond.toLowerCase().indexOf(BLANC) !== -1,
    r.etat.quoi + ' : et le fond qui gagnait était bien LE BLANC de ' +
    '`table.cal td` (' + r.gagnante.fond + ')');
});

/* ------------------------------------------------------------------------ */

console.log('');
if (echecs) { console.error(echecs + ' échec(s)'); process.exit(1); }
console.log('Tout est conforme.');
