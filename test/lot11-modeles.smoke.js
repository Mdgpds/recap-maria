/* ============================================================================
   Test de fumée — LOT 17 §17.9 : les contrats types et la modification
   groupée SONT RETIRÉS DE L'APPLICATION.

   CE QU'IL Y AVAIT ICI, ET POURQUOI IL N'Y EST PLUS.

   Ce fichier vérifiait, écran par écran, les huit cas du lot 11 : la création
   d'une version de conditions, l'alignement contrat par contrat, la
   modification groupée d'un réglage. Il tenait trois garanties qui étaient
   toutes des ABSENCES — créer une version n'écrit rien, aucune case n'est
   cochée par défaut, une rémunération ne s'écrit jamais directement sur un
   contrat.

   Le lot 17 retire ces deux écrans (§17.9), sur décision d'Adrien, et pour la
   raison même que ce fichier gardait : avec les conditions datées, « Modifier
   plusieurs contrats » serait devenu LE SEUL MOYEN D'EFFACER LE PASSÉ SANS
   S'EN APERCEVOIR. Il écrivait les réglages sur `contrat`, sans aucune date ;
   tous les mois non clôturés se seraient recalculés en silence, y compris ceux
   d'il y a deux ans. Les contrats types partent avec, et la notion d'« écart »
   avec eux : plus rien ne compare un contrat à une référence.

   ON NE SUPPRIME PAS UN TEST SANS LE REMPLACER. Une suite qui perdrait
   simplement ce fichier ne dirait plus rien du retrait : six mois plus tard,
   une entrée de menu remise « pour dépanner » repasserait sans un bruit. Ce
   fichier vérifie donc désormais l'INVERSE de ce qu'il vérifiait — que les
   écrans ont bien disparu, et qu'aucun chemin n'y mène plus.

   Les DONNÉES, elles, restent en base (`modele_contrat`, `contrat.modele_id`).
   On ne détruit rien : on cesse de s'en servir. Le retrait du code mort
   appartient au §19.2.

   Lancement : node test/lot11-modeles.smoke.js
   ========================================================================= */
'use strict';

var fs = require('fs');
var path = require('path');

var racine = path.join(__dirname, '..');
function lire(rel) { return fs.readFileSync(path.join(racine, rel), 'utf8'); }

/* Les commentaires expliquent précisément ce qui a été retiré : ils citent
   donc les noms qu'on cherche. Les contrôles portent sur le CODE, jamais sur
   la prose — sans quoi ils passeraient sur une bannière et rateraient un
   écran resté branché. */
function sansCommentaires(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

var echecs = 0;
function assert(cond, libelle) {
  if (cond) { console.log('ok   ' + libelle); return; }
  console.log('FAIL ' + libelle);
  echecs++;
}

var appJs = sansCommentaires(lire('js/app.js'));
var menuJs = sansCommentaires(lire('js/ui-menu.js'));
var contratJs = sansCommentaires(lire('js/ui-contrat.js'));
var dbJs = sansCommentaires(lire('js/db.js'));

console.log('--- §17.9 : les deux écrans ne sont plus atteignables ---');

/* 1. LES ROUTES. C'est le contrôle le plus important : une entrée de menu
      retirée mais une route laissée branchée redonne l'écran au premier lien
      de retour, à la première URL restée en cache, au premier bouton oublié. */
assert(!/\bmodeles\s*:\s*'UiMenu'/.test(appJs),
  'la route « modeles » a disparu du registre des écrans');
assert(!/\bmodifGroupee\s*:\s*'UiMenu'/.test(appJs),
  'la route « modifGroupee » a disparu du registre des écrans');

/* 2. LES ENTRÉES DU MENU. */
assert(menuJs.indexOf("aller('modeles'") === -1,
  'plus aucune entrée du Menu ne mène aux contrats types');
assert(menuJs.indexOf("aller('modifGroupee'") === -1,
  'plus aucune entrée du Menu ne mène à la modification groupée');
assert(menuJs.indexOf('Mes contrats types') === -1 ||
       lire('js/ui-menu.js').indexOf("entree('Mes contrats types'") === -1,
  'la ligne « Mes contrats types » n’est plus construite');
assert(lire('js/ui-menu.js').indexOf("entree('Modifier plusieurs contrats'") === -1,
  'la ligne « Modifier plusieurs contrats » n’est plus construite');

/* 3. LA FICHE DU CONTRAT ne mentionne plus de rattachement à une version. */
assert(!/[^a-zA-Z]blocModele\s*\(/.test(contratJs.replace(/function\s+blocModele/g, 'function _')),
  'la fiche du contrat n’appelle plus le bloc de rattachement à un contrat type');

console.log('\n--- §17.9 : la modification groupée ne peut plus écrire ---');

/* Le point qui compte vraiment. `majContratsEnLot` reste dans `db.js` jusqu'au
   §19.2, mais elle ne doit plus RIEN ÉCRIRE : une fonction morte qui
   continuerait d'écrire sur `contrat` des réglages que plus rien ne lit
   produirait le pire des cas — une modification qui paraît réussir et ne
   change aucun calcul. */
var corpsMaj = /function\s+majContratsEnLot\s*\([^)]*\)\s*\{([\s\S]*?)\n  \}/.exec(dbJs);
assert(!!corpsMaj, 'majContratsEnLot est toujours présente (retrait au §19.2)');
if (corpsMaj) {
  assert(corpsMaj[1].indexOf('ECRAN_RETIRE_LOT17') !== -1,
    'elle refuse explicitement au lieu d’écrire');
  assert(corpsMaj[1].indexOf('majContrat(') === -1,
    'elle n’écrit plus aucun réglage sur un contrat');
}

console.log('\n--- §17.9 : les données ne sont PAS détruites ---');

/* « Les données restent en base — on ne supprime rien, on cesse de s'en
   servir. » Une migration qui aurait fait le ménage rendrait le retrait
   irréversible, et une décision produit se révise. */
var migrations = fs.readdirSync(path.join(racine, 'supabase', 'migrations'))
  .filter(function (f) { return /^01[4-9]|^0[2-9]\d/.test(f); })
  .map(function (f) { return lire(path.join('supabase', 'migrations', f)); })
  .join('\n');
assert(!/drop\s+table\s+(if\s+exists\s+)?public\.modele_contrat/i.test(migrations),
  'aucune migration ne supprime la table modele_contrat');
assert(!/alter\s+table\s+public\.contrat\s+drop\s+column\s+(if\s+exists\s+)?modele_id/i.test(migrations),
  'aucune migration ne supprime contrat.modele_id');

console.log('\n' + (echecs === 0 ? 'Tout est conforme.' : echecs + ' échec(s).'));
process.exit(echecs === 0 ? 0 : 1);
