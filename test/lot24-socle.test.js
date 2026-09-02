/* ============================================================================
   lot24-socle.test.js — LE SOCLE (lot 24 du redesign) : les lois du système.

   Le lot 24 remplace « 24 tailles, ~100 couleurs, 10 encarts, 16 rayons » par
   un système. Un système ne tient que si ses lois sont CONTRÔLÉES : une
   taille de police ajoutée « juste pour cet écran » dans six mois referait la
   dette silencieusement. Ce fichier lit `css/style.css` et vérifie :

     A1 — aucune taille de police hors 13/15/17/22 px (hors la section papier
          du document, qui a sa propre échelle réduite : 17/15/13/11) ;
     A2 — aucune couleur hexadécimale hors `:root` (hors section papier, où
          la palette est rassemblée en tête, entre <papier> et </papier>) ;
     A3 — deux rayons (12 px, 999 px), une amplitude au toucher (.985, plus
          l'exception écrite .94 du calendrier), trois graisses (400/600/700) ;
     §24.3 — la garde Safari (`> * { flex: none }`) est posée DANS le
          composant pour chacun des conteneurs défilants en colonne flex, et
          le séparateur de milliers est l'espace fine insécable (U+202F) —
          vérifié sur `Kit.eur`, par lequel tous les écrans passent ;
     §24.5 — le code mort du §17.9 a bien quitté `js/ui-menu.js` et
          `js/ui-contrat.js`, et le renvoi fantôme vers « Anciens contrats »
          est corrigé.

   Ces contrôles sont STATIQUES : jsdom ne calcule pas de mise en page, le
   défilement horizontal à 320/390/430 px (critère A5) se vérifie donc au
   navigateur — le résultat est consigné dans la description du commit.

   Ce fichier charge ui-kit.js dans le même décor minimal que
   etat-mois.test.js ; il est placé après lui dans le runner, pour la même
   raison (il pose des globaux).
   ========================================================================= */
'use strict';

var fs = require('fs');
var path = require('path');

var racine = path.join(__dirname, '..');
function lire(rel) { return fs.readFileSync(path.join(racine, rel), 'utf8'); }

var css = lire('css/style.css');

/* --- Découpage : :root, section papier, et le reste ---------------------- */

var debPapier = css.indexOf('/*<papier>*/');
var finPapier = css.indexOf('/*</papier>*/');
var debRoot = css.indexOf(':root {');
var finRoot = css.indexOf('}', debRoot);

function sansCommentaires(t) { return t.replace(/\/\*[\s\S]*?\*\//g, ' '); }

var papier = sansCommentaires(css.slice(debPapier, finPapier));
var horsPapier = sansCommentaires(css.slice(0, debPapier) + css.slice(finPapier));
var horsRootEtPapier = sansCommentaires(
  css.slice(0, debRoot) + css.slice(finRoot + 1, debPapier) + css.slice(finPapier));

function egal(obtenu, attendu, libelle) {
  if (obtenu !== attendu) {
    throw new Error(libelle + ' : attendu ' + JSON.stringify(attendu) +
      ', obtenu ' + JSON.stringify(obtenu));
  }
}
function vrai(cond, libelle) { if (!cond) throw new Error(libelle); }

function taillesDe(t) {
  var out = [];
  var re = /font-size:\s*([\d.]+)px/g;
  var m;
  while ((m = re.exec(t))) { if (out.indexOf(m[1]) === -1) out.push(m[1]); }
  return out.sort();
}

var cas = [];

/* ====================================================================== */
/* A1 — les quatre tailles                                                */

/* REDESIGN 2A — L'ECHELLE CHANGE, LE GARDE-FOU RESTE.

   Le lot 24 tenait QUATRE tailles (13/15/17/22). La maquette 2A, testee et
   validee par l'utilisatrice finale, en porte VINGT : elle module beaucoup
   plus finement, et c'est ce que Maria a essaye au doigt. Arbitrage d'Adrien
   du 1er septembre 2026 : « la maquette gagne ».

   Le garde-fou n'est donc pas supprime, il est REECRIT sur la nouvelle
   echelle : la liste ci-dessous est FERMEE. Une vingt-et-unieme taille fait
   echouer ce test. C'est plus lache qu'avant — quatre valeurs valaient mieux
   que vingt — et il faut le savoir : ce qu'on garde ici, c'est l'interdiction
   d'inventer une taille de plus au fil des lots, pas la discipline du lot 24. */
var ECHELLE_2A = ['9', '9.5', '10.5', '11', '11.5', '12', '12.5', '13', '13.5',
                  '14', '15', '15.5', '16', '16.5', '17', '18', '19', '21', '25', '30',
                  /* HERITE du lot 24, le temps de la migration des ecrans :
                     22 px est le titre d'ecran d'avant (`.t-ecran`, `.av.gd`).
                     Il part avec le dernier ecran qui le porte, au commit 8. */
                  '22'];

cas.push({ nom: 'A1 — hors papier, aucune taille de police hors l\u2019echelle 2A (20 valeurs)', fn: function () {
  var interdites = taillesDe(horsPapier).filter(function (t) {
    return ECHELLE_2A.indexOf(t) === -1;
  });
  egal(interdites.join(','), '', 'tailles hors echelle 2A');
} });

cas.push({ nom: 'A1 — l\u2019echelle 2A est FERMEE : une taille de plus fait echouer', fn: function () {
  /* La preuve que le controle mord : on injecte une taille absente de
     l'echelle et la mesure doit la denoncer. Sans cela, une liste de vingt
     valeurs finirait par tout accepter sans que personne s'en apercoive. */
  var mute = horsPapier + '\n.faux { font-size: 23.5px; }';
  var interdites = taillesDe(mute).filter(function (t) {
    return ECHELLE_2A.indexOf(t) === -1;
  });
  egal(interdites.join(','), '23.5', 'la taille intruse doit etre denoncee');
} });

cas.push({ nom: 'A1 — la section papier tient en quatre tailles (11/13/15/17)', fn: function () {
  var interdites = taillesDe(papier).filter(function (t) {
    return ['11', '13', '15', '17'].indexOf(t) === -1;
  });
  egal(interdites.join(','), '', 'tailles papier hors échelle');
} });

/* ====================================================================== */
/* A2 — zéro couleur en dur hors :root (hors papier)                      */

cas.push({ nom: 'A2 — aucune couleur hexadécimale hors :root et hors papier', fn: function () {
  var hex = horsRootEtPapier.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  egal(hex.join(','), '', 'couleurs en dur');
} });

cas.push({ nom: 'A2 — les doublons du :root d’avant ont disparu (--bd, #649685, #b1833f)', fn: function () {
  vrai(css.indexOf('--bd:') === -1, '--bd (doublon de --ln) devrait avoir disparu');
  vrai(css.indexOf('#649685') === -1, '#649685 devrait céder la place à --acl');
  vrai(css.indexOf('#b1833f') === -1, '#b1833f devrait céder la place à --wal');
} });

/* ====================================================================== */
/* A3 — deux rayons, une amplitude, trois graisses                        */

/* REDESIGN 2A — les rayons. Le lot 24 en tenait deux (12 px et 999 px) ; la
   maquette en porte six, dont deux nommes : `--r` (15 px, les surfaces) et
   `--r2` (11 px, les cases du calendrier et les apercus). La liste reste
   FERMEE, et les deux jetons sont a preferer aux valeurs libres. */
var RAYONS_2A = ['var(--r)', 'var(--r2)', '999px', '12px', '24px', '3.5px', '0'];

cas.push({ nom: 'A3 — les rayons tiennent dans la liste fermee du 2A', fn: function () {
  var re = /border-radius:\s*([^;]+);/g;
  var m, interdits = [];
  var t = sansCommentaires(css);
  while ((m = re.exec(t))) {
    m[1].split(/\s+/).forEach(function (v) {
      if (!v) return;
      if (RAYONS_2A.indexOf(v) === -1 && interdits.indexOf(v) === -1) interdits.push(v);
    });
  }
  egal(interdits.join(','), '', 'rayons hors liste 2A');
} });

cas.push({ nom: 'A3 — deux amplitudes au toucher : .988 (2A) et .94 (calendrier)', fn: function () {
  /* La maquette 2A appuie a .988 la ou le lot 24 appuyait a .985. Les ecrans
     non encore migres gardent .985 le temps de leur commit ; les trois
     valeurs cohabitent donc, et rien d'autre n'est admis. */
  var re = /scale\(([^)]+)\)/g;
  var m, interdites = [];
  var t = sansCommentaires(css);
  while ((m = re.exec(t))) {
    if (['.988', '.985', '.94', '0.988', '0.985', '0.94'].indexOf(m[1]) === -1 &&
        interdites.indexOf(m[1]) === -1) {
      interdites.push(m[1]);
    }
  }
  egal(interdites.join(','), '', 'amplitudes hors socle');
} });

cas.push({ nom: 'A3 — trois graisses : 400, 600, 700', fn: function () {
  var re = /font-weight:\s*(\d+)/g;
  var m, interdites = [];
  var t = sansCommentaires(css);
  while ((m = re.exec(t))) {
    if (['400', '600', '700'].indexOf(m[1]) === -1 && interdites.indexOf(m[1]) === -1) interdites.push(m[1]);
  }
  egal(interdites.join(','), '', 'graisses hors socle');
} });

/* ====================================================================== */
/* §24.3 — la garde Safari, posée dans le composant (critère A6)          */

cas.push({ nom: 'A6 — chaque conteneur défilant en colonne flex porte > * { flex: none }', fn: function () {
  [['.bd', /\.bd\s*>\s*\*\s*\{\s*flex:\s*none/],
   ['.shb', /\.shb\s*>\s*\*\s*\{\s*flex:\s*none/],
   ['.corps-feuille', /\.corps-feuille\s*>\s*\*\s*\{\s*flex:\s*none/],
   ['.selbar', /\.selbar\s*>\s*\*\s*\{\s*flex:\s*none/]].forEach(function (x) {
    vrai(x[1].test(css), 'la garde flex:none manque pour ' + x[0]);
  });
  vrai(/\.bd\s*\{[^}]*display:\s*flex/.test(sansCommentaires(css)), '.bd doit être une colonne flex');
  vrai(/\.shb\s*\{[^}]*display:\s*flex/.test(sansCommentaires(css)), '.shb doit être une colonne flex');
} });

cas.push({ nom: '§24.1 — les valeurs chiffrées sont en tabular-nums', fn: function () {
  var n = (sansCommentaires(css).match(/font-variant-numeric:\s*tabular-nums/g) || []).length;
  vrai(n >= 6, 'tabular-nums devrait couvrir lignes, pastilles, compteurs (trouvé ' + n + ')');
} });

/* ====================================================================== */
/* §24.3 — le séparateur de milliers, espace fine insécable                */

cas.push({ nom: '§24.3 — Kit.eur : « 1 142,00 € », espace fine (U+202F) aux milliers', fn: function () {
  /* Décor minimal, comme etat-mois.test.js : ui-kit.js ne dessine rien ici. */
  if (!global.Kit) {
    global.window = global;
    global.document = global.document || {
      createElement: function () {
        return { className: '', textContent: '', appendChild: function () {}, style: {} };
      }
    };
    global.Format = require('../js/format.js');
    global.Feries = require('../js/feries.js');
    global.Engine = require('../js/engine.js');
    require('../js/ui-kit.js');
  }
  var Kit = global.Kit;
  egal(Kit.eur(114200), '1 142,00 €', 'séparateur de milliers');
  /* L'espace devant « € » reste l'insécable de format.js : le moteur est
     fermé, seul le séparateur change, à l'affichage. */
  egal(Kit.eur(500), '5,00 €', 'un montant sans milliers ne change pas');
  egal(Kit.eur(123456789), '1 234 567,89 €', 'chaque groupe de milliers');
} });

cas.push({ nom: '§24.3 — le moteur est fermé : format.js produit toujours l’insécable simple', fn: function () {
  var Format = require('../js/format.js');
  egal(Format.centimesEnEuros(114200), '1 142,00 €',
    'format.js ne doit pas changer (diff moteur vide)');
} });

/* ====================================================================== */
/* §24.5 — la dette est retirée, le renvoi fantôme corrigé                 */

cas.push({ nom: '§24.5 — le code mort du §17.9 a quitté ui-menu.js et ui-contrat.js', fn: function () {
  var menu = sansCommentaires(lire('js/ui-menu.js'));
  var contrat = sansCommentaires(lire('js/ui-contrat.js'));
  ['afficherModeles', 'afficherModifGroupee', 'feuilleNouvelleVersion',
   'feuilleAlignement', 'feuilleContratsConcernes'].forEach(function (f) {
    vrai(menu.indexOf('function ' + f) === -1, f + ' devrait avoir quitté ui-menu.js');
  });
  ['carteBareme', 'blocModele', 'feuilleAlignerCeContrat', 'feuilleRegles',
   'feuilleBareme', 'feuilleSuppressionBareme'].forEach(function (f) {
    vrai(contrat.indexOf('function ' + f) === -1, f + ' devrait avoir quitté ui-contrat.js');
  });
  /* Plus une seule référence aux fonctions DB disparues. */
  vrai(menu.indexOf('getSalaires') === -1, 'ui-menu.js ne doit plus citer getSalaires');
  vrai(contrat.indexOf('getSalaires') === -1, 'ui-contrat.js ne doit plus citer getSalaires');
} });

cas.push({ nom: '§24.5 — le renvoi fantôme : « Mes enfants → Contrats terminés »', fn: function () {
  var contrat = lire('js/ui-contrat.js');
  vrai(contrat.indexOf('Mes enfants → Contrats terminés') !== -1,
    'l’écran de fin de contrat doit renvoyer vers « Mes enfants → Contrats terminés »');
  var code = sansCommentaires(contrat);
  vrai(code.indexOf('Anciens contrats') === -1,
    'plus aucune phrase active ne cite « Anciens contrats »');
} });

cas.push({ nom: '§24 — la feuille de style est organisée par composant, sommaire en tête', fn: function () {
  vrai(css.indexOf('SOMMAIRE') !== -1, 'le sommaire manque en tête de style.css');
  vrai(debPapier !== -1 && finPapier !== -1 && debPapier < finPapier,
    'les repères <papier> / </papier> délimitent la section du document');
} });

module.exports = { cas: cas };
