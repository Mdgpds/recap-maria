/* ============================================================================
   parcours-plages.test.js — LOT 31 §5 : LA RÈGLE DES PLAGES, ISOLÉE.

   La règle, tranchée par Adrien le 1er septembre 2026 :

       « Une plage ne regroupe que des journées STRICTEMENT IDENTIQUES.
         Même nature, même décompte, même imputation. Dès qu'un de ces trois
         éléments change, la plage se coupe. »

   Et ce qui compte comme consécutif : les jours se suivent en JOURS OUVRÉS DU
   PLANNING — un week-end ne coupe pas, un férié non plus, une journée ouvrable
   absente de la liste, si.

   Ce fichier teste `Kit.plagesDeJours` et `Kit.libellePlageJours` SEULS, sur un
   calendrier connu, sans écran, sans base et sans décor. Les trois écrans qui
   s'en servent sont vérifiés ailleurs, dans leurs parcours ; ici on vérifie la
   règle elle-même, parce que c'est elle qui décide de ce qu'une famille lira.

   Calendrier de référence — SEPTEMBRE 2026, valeurs fictives (dépôt public) :
       mardi 1er … mercredi 30 ; samedis 5, 12, 19, 26 ; dimanches 6, 13, 20, 27.
   Planning du contrat : lundi à vendredi.

   Lancement : node test/parcours-plages.test.js
   ========================================================================= */
'use strict';

var JSDOM = require('jsdom').JSDOM;

var dom = new JSDOM('<!doctype html><html><body></body></html>',
  { url: 'https://exemple.test/' });
global.window = dom.window;
global.document = dom.window.document;

var Feries = require('../js/feries.js');
var Format = require('../js/format.js');
var Engine = require('../js/engine.js');
global.Feries = Feries; window.Feries = Feries;
global.Format = Format; window.Format = Format;
global.Engine = Engine; window.Engine = Engine;
require('../js/ui-kit.js');
var Kit = window.Kit;

var echecs = 0;
function assert(cond, msg) {
  if (!cond) { echecs++; console.error('FAIL ' + msg); } else { console.log('ok   ' + msg); }
}
function egal(obtenu, attendu, msg) {
  assert(obtenu === attendu, msg +
    ' (attendu ' + JSON.stringify(attendu) + ', obtenu ' + JSON.stringify(obtenu) + ')');
}

/* Le planning lundi-vendredi, fériés exclus : c'est ce que l'appelant fournit. */
function ouvrableLV(d) {
  var js = Engine.jourSemaine(d);
  return js >= 1 && js <= 5 && !Feries.estJourFerie(d);
}
function j(n) { return '2026-09-' + String(n).padStart(2, '0'); }
function jours(liste) { return liste.map(j); }
function libelles(plages) { return plages.map(Kit.libellePlageJours); }

/* ------------------------------------------------------------------------ */
console.log('\n--- §5 : les trois cas d’écriture ---');

egal(libelles(Kit.plagesDeJours(jours([15]), { ouvrable: ouvrableLV })).join(' | '),
  'Le 15 septembre', 'un seul jour : « Le 15 septembre »');

egal(libelles(Kit.plagesDeJours(jours([15, 16]), { ouvrable: ouvrableLV })).join(' | '),
  'Le 15 et le 16 septembre', 'deux jours : « Le 15 et le 16 septembre »');

egal(libelles(Kit.plagesDeJours(jours([15, 16, 17, 18]), { ouvrable: ouvrableLV })).join(' | '),
  'Du 15 au 18 septembre', 'trois jours ou plus : « Du 15 au 18 septembre »');

/* ------------------------------------------------------------------------ */
console.log('\n--- §5 : ce qui compte comme consécutif ---');

/* Vendredi 18 et lundi 21 : le week-end ne coupe pas. Mais ils sont DEUX,
   donc « Le 18 et le 21 » — pas « Du 18 au 21 », qui laisserait croire à
   quatre journées décomptées. */
var vendrediLundi = Kit.plagesDeJours(jours([18, 21]), { ouvrable: ouvrableLV });
egal(vendrediLundi.length, 1, 'un vendredi et le lundi suivant : UNE seule plage');
egal(libelles(vendrediLundi).join(' | '), 'Le 18 et le 21 septembre',
  'et elle s’écrit avec les deux quantièmes, pas comme une plage de quatre jours');

/* La même chose sur cinq jours à cheval sur le week-end. */
var aCheval = Kit.plagesDeJours(jours([17, 18, 21, 22]), { ouvrable: ouvrableLV });
egal(aCheval.length, 1, 'jeudi, vendredi, lundi, mardi : une seule plage');
egal(libelles(aCheval).join(' | '), 'Du 17 au 22 septembre',
  'et elle s’écrit « du 17 au 22 » : le week-end ne se compte pas, il ne coupe pas');

/* Un férié au milieu ne coupe pas non plus. Le 11 novembre 2026 est un
   mercredi férié : mardi 10 et jeudi 12 se suivent. */
var pontNovembre = Kit.plagesDeJours(['2026-11-10', '2026-11-12'],
  { ouvrable: ouvrableLV });
assert(Feries.estJourFerie('2026-11-11'),
  'décor : le 11 novembre 2026 est bien férié');
egal(pontNovembre.length, 1, 'un férié au milieu ne coupe pas la plage');

/* Une journée OUVRABLE absente coupe. */
var trou = Kit.plagesDeJours(jours([15, 16, 18]), { ouvrable: ouvrableLV });
egal(trou.length, 2, 'une journée ouvrable absente (le 17) coupe la plage');
egal(libelles(trou).join(' | '), 'Le 15 et le 16 septembre | Le 18 septembre',
  'et les deux morceaux s’écrivent chacun selon sa règle');

/* ------------------------------------------------------------------------ */
console.log('\n--- §5 : une plage ne regroupe que des journées identiques ---');

/* NATURE. congé, congé, absence, congé -> deux plages. */
var nature = { 15: 'cg', 16: 'cg', 17: 'ab', 18: 'cg' };
var parNature = Kit.plagesDeJours(jours([15, 16, 17, 18]), {
  ouvrable: ouvrableLV,
  cle: function (d) { return nature[Number(d.slice(8, 10))]; }
});
egal(parNature.length, 3,
  'congé, congé, ABSENCE, congé : trois plages, la nature coupe');
egal(libelles(parNature).join(' | '),
  'Le 15 et le 16 septembre | Le 17 septembre | Le 18 septembre',
  'et chacune porte ses propres jours');

/* DÉCOMPTE. Une demi-journée au milieu de journées entières coupe. C'est le
   cas que le §9.2 nomme explicitement. */
var decompte = { 15: '1j', 16: '1j', 17: '0,5j', 18: '1j' };
var parDecompte = Kit.plagesDeJours(jours([15, 16, 17, 18]), {
  ouvrable: ouvrableLV,
  cle: function (d) { return decompte[Number(d.slice(8, 10))]; }
});
egal(parDecompte.length, 3,
  'une DEMI-JOURNÉE au milieu de journées entières coupe la plage');
egal(libelles(parDecompte)[0], 'Le 15 et le 16 septembre',
  'la plage d’avant s’arrête à la veille');
egal(libelles(parDecompte)[2], 'Le 18 septembre',
  'et celle d’après repart au lendemain');

/* IMPUTATION. Deux congés qui relèvent d'imputations différentes ne se
   rejoignent pas, même collés et de même nature. */
var imputation = { 15: 'imp-A', 16: 'imp-A', 17: 'imp-B', 18: 'imp-B' };
var parImputation = Kit.plagesDeJours(jours([15, 16, 17, 18]), {
  ouvrable: ouvrableLV,
  cle: function (d) { return imputation[Number(d.slice(8, 10))]; }
});
egal(parImputation.length, 2,
  'deux IMPUTATIONS différentes coupent la plage');
egal(libelles(parImputation).join(' | '),
  'Le 15 et le 16 septembre | Le 17 et le 18 septembre',
  'et chacune reste entière');

/* ------------------------------------------------------------------------ */
console.log('\n--- §5 : ce que la règle NE fait pas ---');

/* Quinze jours d'affilée : une ligne, pas quinze. C'est le motif du §5. */
var troisSemaines = Kit.plagesDeJours(
  jours([1, 2, 3, 4, 7, 8, 9, 10, 11, 14, 15, 16, 17, 18]),
  { ouvrable: ouvrableLV });
egal(troisSemaines.length, 1,
  'trois semaines pleines : UNE ligne, pas quatorze');
egal(libelles(troisSemaines).join(''), 'Du 1er au 18 septembre',
  'et le premier du mois s’écrit « 1er », comme au lot 16');

/* L'ordre d'entrée ne change rien : la liste est triée avant regroupement. */
egal(libelles(Kit.plagesDeJours(jours([18, 15, 17, 16]), { ouvrable: ouvrableLV })).join(''),
  'Du 15 au 18 septembre', 'l’ordre d’entrée ne change pas le découpage');

/* Une plage à cheval sur deux mois se nomme des deux côtés. */
egal(libelles(Kit.plagesDeJours(['2026-09-30', '2026-10-01'],
  { ouvrable: ouvrableLV })).join(''),
  'Le 30 septembre et le 1er octobre',
  'à cheval sur deux mois, les deux mois sont nommés');

egal(libelles(Kit.plagesDeJours([], { ouvrable: ouvrableLV })).join(''), '',
  'aucun jour : aucune plage, et rien qui plante');

/* ------------------------------------------------------------------------ */
/* CE QUE CE FICHIER NE TESTAIT PAS — et ce que la relecture a trouvé grâce   */
/* à ce trou                                                                  */
/* ------------------------------------------------------------------------ */

/* Tout ce qui précède teste la FONCTION avec des clés fabriquées par le test.
   C'est nécessaire et ça ne suffit pas : la relecture a trouvé que le repli
   « Journées à part » appelait `plagesDeJours` SANS clé, donc en groupant sur
   la nature seule, pendant que le document, lui, passait l'imputation. Les
   deux écrans découpaient les mêmes journées autrement — l'un pour Maria,
   l'autre pour la famille.

   Aucune assertion ne pouvait le voir, parce qu'aucune ne regardait QUELLE clé
   chaque appelant fournit. Celles-ci le regardent : elles lisent le code des
   deux appelants et exigent qu'ils passent tous les deux une clé d'imputation.

   C'est un contrôle de texte, et il est modeste — mais il tient exactement la
   promesse que la règle porte : « même nature, même décompte, MÊME
   IMPUTATION », partout, sans exception. */

console.log('\n--- §5 : les DEUX appelants passent bien une clé d’imputation ---');

var fs = require('fs');
var path = require('path');
function source(f) {
  return fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8');
}

[['ui-document.js', 'le document remis à la famille'],
 ['ui-enfant.js', 'le repli « Journées à part » que Maria relit']]
  .forEach(function (x) {
    var src = source(x[0]);
    /* Chaque appel de regroupement de CE fichier doit porter une clé. Un appel
       sans `cle:` groupe sur la chaîne vide, c'est-à-dire sur rien.

       On lit la fenêtre qui suit l'appel jusqu'au traitement des plages
       (`.forEach(function (plage`) : `cle:` doit s'y trouver. Une expression
       régulière sur le corps de l'appel se serait arrêtée au premier `})`
       venu — celui d'une fonction passée en argument — et aurait déclaré
       manquante une clé pourtant présente. Vérifié : c'est ce qui s'est
       produit à la première écriture de ce contrôle. */
    var appels = [];
    var pos = -1;
    while ((pos = src.indexOf('Kit.plagesDeJours(', pos + 1)) !== -1) {
      var fenetre = src.slice(pos, pos + 700);
      var fin = fenetre.indexOf('.forEach(function (plage');
      appels.push(fin === -1 ? fenetre : fenetre.slice(0, fin));
    }
    assert(appels.length > 0, x[1] + ' : au moins un regroupement en plages');
    appels.forEach(function (appel, i) {
      assert(appel.indexOf('cle:') !== -1,
        x[1] + ' — appel n° ' + (i + 1) + ' : une CLÉ est fournie, sinon la ' +
        'plage groupe sur la nature seule et masque une imputation');
    });
    assert(src.indexOf('function imputationDuJour') !== -1,
      x[1] + ' : et il sait lire l’imputation d’une journée');
  });

/* ------------------------------------------------------------------------ */
console.log('');
if (echecs) { console.error(echecs + ' échec(s)'); process.exit(1); }
console.log('Tout est conforme.');
