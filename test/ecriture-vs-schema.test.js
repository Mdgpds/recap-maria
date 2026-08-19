/* ============================================================================
   ecriture-vs-schema.test.js — CE QUE LE NAVIGATEUR ÉCRIT DOIT SATISFAIRE CE
   QUE LA BASE EXIGE.

   POURQUOI CE FICHIER EXISTE.

   La relecture du lot 17 a trouvé une bloquante que 1 039 assertions n'ont pas
   vue : `avenant_contrat.numero` est `not null`, sans valeur par défaut et sans
   trigger, et `DB.ajouterAvenant` l'exclut délibérément du corps de la requête.
   « Faire un avenant » — la fonction centrale du lot — échouait à tous les
   coups, en production, sur tous les contrats :

       23502 null value in column "numero" violates not-null constraint

   Aucun test ne pouvait le voir, et la raison est structurelle : les quinze
   tests de fumée REMPLACENT `DB` par un double qui accepte tout ce qu'on lui
   donne. Ils vérifient que l'écran appelle la bonne fonction avec les bonnes
   valeurs. Ils ne peuvent pas vérifier que la base acceptera l'écriture.

   `couche-donnees.test.js` couvre le sens de la LECTURE : une colonne ajoutée
   en base doit être demandée par un `select`. Ce fichier couvre le sens de
   l'ÉCRITURE : une colonne que la base exige doit être fournie par l'écriture,
   ou remplie par la base elle-même.

   Il lit les migrations et `db.js` comme des TEXTES. Aucune base de données,
   aucune dépendance : ce contrôle doit tourner en CI sur une machine nue.
   ========================================================================= */
'use strict';

var fs = require('fs');
var path = require('path');

var DOSSIER = path.join(__dirname, '..', 'supabase', 'migrations');
var SOURCE_DB = fs.readFileSync(path.join(__dirname, '..', 'js', 'db.js'), 'utf8');

/* Les migrations, dans l'ordre : une colonne peut devenir `not null` deux
   migrations après sa création, et redevenir nullable ensuite. On rejoue donc
   la suite, on ne la survole pas. */
var SQL = fs.readdirSync(DOSSIER)
  .filter(function (f) { return /^\d+_.*\.sql$/.test(f); })
  .sort()
  .map(function (f) { return fs.readFileSync(path.join(DOSSIER, f), 'utf8'); })
  .join('\n')
  .replace(/--[^\n]*/g, ' ');          // les commentaires SQL, hors du jeu

/* LES RENOMMAGES DE TABLE SONT SUIVIS. `salaire_contrat` est devenu
   `avenant_contrat` à la migration `014` : sans cette étape, le `create table`
   d'origine et ses contraintes resteraient attachés à l'ancien nom, et le
   contrôle croirait qu'`avenant_contrat` n'exige presque rien — ce qui est
   exactement la panne qu'il doit détecter. */
(function suivreLesRenommages() {
  var re = /alter\s+table\s+(?:if\s+exists\s+)?public\.([a-z_0-9]+)\s+rename\s+to\s+([a-z_0-9]+)/gi;
  var m, couples = [];
  while ((m = re.exec(SQL)) !== null) couples.push([m[1], m[2]]);
  couples.forEach(function (c) {
    SQL = SQL.replace(new RegExp('public\\.' + c[0] + '\\b', 'g'), 'public.' + c[1]);
  });
})();

function echoue(msg) { throw new Error(msg); }

/* ------------------------------------------------------------------ */
/* 1. Ce que la base EXIGE                                             */
/* ------------------------------------------------------------------ */

/* Colonnes `not null` d'une table, moins celles que la base sait remplir
   seule : valeur par défaut, ou trigger `before insert` qui les pose. */
function colonnesExigees(table) {
  var notNull = {};
  var defaut = {};

  /* a) Le `create table` d'origine. */
  var creation = new RegExp(
    'create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?public\\.' + table + '\\s*\\(([\\s\\S]*?)\\n\\s*\\);', 'i');
  var m = SQL.match(creation);
  if (m) {
    decouperColonnes(m[1]).forEach(function (ligne) {
      var nom = (ligne.match(/^([a-z_][a-z0-9_]*)/i) || [])[1];
      if (!nom) return;
      if (/^(primary|unique|check|constraint|foreign|exclude)$/i.test(nom)) return;
      if (/\bnot\s+null\b/i.test(ligne)) notNull[nom] = true;
      if (/\bdefault\b/i.test(ligne)) defaut[nom] = true;
      /* Une clé primaire vaut `not null`. */
      if (/\bprimary\s+key\b/i.test(ligne)) notNull[nom] = true;
    });
  }

  /* b) Les `alter column`, dans l'ordre du fichier concaténé. */
  var alter = new RegExp(
    'alter\\s+table\\s+(?:only\\s+)?public\\.' + table + '\\b([\\s\\S]*?);', 'gi');
  var bloc;
  while ((bloc = alter.exec(SQL)) !== null) {
    var corps = bloc[1];
    var re = /alter\s+column\s+([a-z_][a-z0-9_]*)\s+(set\s+not\s+null|drop\s+not\s+null|set\s+default|drop\s+default)/gi;
    var a;
    while ((a = re.exec(corps)) !== null) {
      var col = a[1];
      var geste = a[2].toLowerCase().replace(/\s+/g, ' ');
      if (geste === 'set not null') notNull[col] = true;
      if (geste === 'drop not null') delete notNull[col];
      if (geste === 'set default') defaut[col] = true;
      if (geste === 'drop default') delete defaut[col];
    }
    /* `add column ... not null default ...` */
    var ra = /add\s+column\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)([^,]*)/gi;
    var b;
    while ((b = ra.exec(corps)) !== null) {
      if (/\bnot\s+null\b/i.test(b[2])) notNull[b[1]] = true;
      if (/\bdefault\b/i.test(b[2])) defaut[b[1]] = true;
    }
  }

  /* c) Les colonnes qu'un trigger `before insert` pose lui-même. */
  var parTrigger = colonnesPoseesParTrigger(table);

  return Object.keys(notNull).filter(function (c) {
    return !defaut[c] && parTrigger.indexOf(c) === -1;
  }).sort();
}

/* Découpe la liste de colonnes d'un `create table` en respectant les
   parenthèses : `numeric(10,2)` ne doit pas produire deux lignes. */
function decouperColonnes(corps) {
  var out = [], profondeur = 0, courant = '';
  for (var i = 0; i < corps.length; i++) {
    var c = corps[i];
    if (c === '(') profondeur++;
    if (c === ')') profondeur--;
    if (c === ',' && profondeur === 0) { out.push(courant.trim()); courant = ''; continue; }
    courant += c;
  }
  if (courant.trim()) out.push(courant.trim());
  return out.filter(Boolean);
}

/* Les colonnes qu'un trigger `before insert` de cette table renseigne.
   On lit le corps de la fonction déclenchée, et on y cherche `new.<col> :=`
   ou `into new.<col>`. */
function colonnesPoseesParTrigger(table) {
  var out = [];
  var re = new RegExp(
    'create\\s+trigger\\s+([a-z_0-9]+)\\s+before\\s+insert\\s+on\\s+public\\.' + table +
    '[\\s\\S]*?execute\\s+(?:function|procedure)\\s+public\\.([a-z_0-9]+)', 'gi');
  var t;
  while ((t = re.exec(SQL)) !== null) {
    var fn = t[2];
    var corps = SQL.match(new RegExp(
      'create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.' + fn + '\\s*\\([\\s\\S]*?\\$\\$([\\s\\S]*?)\\$\\$', 'i'));
    if (!corps) continue;
    var rc = /(?:new\.([a-z_][a-z0-9_]*)\s*:=)|(?:into\s+new\.([a-z_][a-z0-9_]*))/gi;
    var c;
    while ((c = rc.exec(corps[1])) !== null) out.push(c[1] || c[2]);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 2. Ce que le navigateur FOURNIT                                     */
/* ------------------------------------------------------------------ */

/* Le contenu d'une constante `var NOM = [ 'a', 'b', … ];` de db.js.
   Les commentaires sont retirés d'abord : ceux de ce dépôt sont en français,
   donc pleins d'apostrophes, et un commentaire au milieu d'un tableau
   injecterait ses propres morceaux (le piège déjà rencontré dans
   `couche-donnees.test.js`). */
function listeDe(nom) {
  var sansCommentaires = SOURCE_DB.replace(/\/\*[\s\S]*?\*\//g, ' ');
  var m = sansCommentaires.match(new RegExp('var\\s+' + nom + '\\s*=\\s*\\[([\\s\\S]*?)\\]', 'm'));
  if (!m) echoue('constante introuvable dans db.js : ' + nom);
  return (m[1].match(/'([^']+)'/g) || []).map(function (x) { return x.slice(1, -1); });
}

/* ------------------------------------------------------------------ */
/* 3. Les tables écrites par le navigateur                             */
/* ------------------------------------------------------------------ */

/* `owner` est posé par défaut à `auth.uid()` sur toutes les tables (convention
   de sécurité du projet) et n'est JAMAIS transmis : il est donc couvert par la
   règle du `default` et n'apparaît pas ici. `id` de même. */
var ECRITURES = [
  {
    table: 'avenant_contrat',
    geste: 'DB.ajouterAvenant',
    fournies: function () { return ['contrat_id'].concat(listeDe('CHAMPS_AVENANT_MODIFIABLES')); }
  },
  {
    table: 'contrat',
    geste: 'DB.creerContrat',
    fournies: function () { return listeDe('CHAMPS_CONTRAT_MODIFIABLES'); }
  }
];

/* ------------------------------------------------------------------ */

var cas = [];

ECRITURES.forEach(function (e) {
  cas.push({
    nom: e.geste + ' fournit tout ce que `' + e.table + '` exige à l’insertion',
    fn: function () {
      var exigees = colonnesExigees(e.table);
      if (!exigees.length) {
        echoue('aucune colonne obligatoire trouvée pour `' + e.table + '` : ' +
          'le contrôle ne lit plus les migrations, il ne prouve donc plus rien');
      }
      var fournies = e.fournies();
      var manquantes = exigees.filter(function (c) { return fournies.indexOf(c) === -1; });
      if (manquantes.length) {
        echoue('`' + e.table + '` exige ' + manquantes.join(', ') +
          ' — colonne(s) `not null`, sans valeur par défaut et sans trigger — ' +
          'mais ' + e.geste + ' ne les transmet pas. L’écriture échouera en base ' +
          '(23502), à tous les coups. Colonnes transmises : ' + fournies.join(', '));
      }
    }
  });
});

/* Le contrôle du contrôle : sans lui, une expression régulière qui cesse de
   reconnaître les migrations rendrait une liste vide, et tout passerait. */
cas.push({
  nom: 'le contrôle lit bien le schéma : `avenant_contrat.date_effet` est obligatoire',
  fn: function () {
    var exigees = colonnesExigees('avenant_contrat');
    if (exigees.indexOf('date_effet') === -1) {
      echoue('`date_effet` devrait figurer parmi les colonnes obligatoires ' +
        'd’`avenant_contrat` ; obtenu : ' + exigees.join(', '));
    }
  }
});

cas.push({
  nom: '`numero` est posé par la base, jamais par le navigateur (B1, migration 015)',
  fn: function () {
    var parTrigger = colonnesPoseesParTrigger('avenant_contrat');
    if (parTrigger.indexOf('numero') === -1) {
      echoue('aucun trigger `before insert` ne pose `avenant_contrat.numero`. ' +
        'C’est exactement le défaut B1 : la colonne est `not null`, personne ne ' +
        'la remplit, et créer un avenant échoue.');
    }
    var fournies = ['contrat_id'].concat(listeDe('CHAMPS_AVENANT_MODIFIABLES'));
    if (fournies.indexOf('numero') !== -1) {
      echoue('`numero` est transmis par le navigateur. Depuis la migration 015 ' +
        'c’est une identité posée par la base, et la base refuse qu’elle change.');
    }
  }
});

/* ------------------------------------------------------------------ */
/* CORRECTIONS B1, C1 ET C2 DE LA RELECTURE DU LOT 18                   */
/*                                                                     */
/* La charge utile d'un marquage groupé n'est observable QUE d'ici : les */
/* tests de fumée remplacent `DB` par un double, et c'est exactement ce  */
/* qui a laissé passer le défaut. Un `upsert` ne met à jour que les      */
/* colonnes PRÉSENTES — l'oubli d'une colonne ne lève aucune erreur, il  */
/* laisse simplement l'ancienne valeur en place.                         */
/* ------------------------------------------------------------------ */

/* Le corps d'une fonction, commentaires retirés. `source` par défaut db.js ;
   `restaurer` vit dans l'écran de l'enfant, qui est le seul à défaire un
   marquage groupé. */
var SOURCE_ENFANT = fs.readFileSync(path.join(__dirname, '..', 'js', 'ui-enfant.js'), 'utf8');

function corpsDe(nom, source) {
  var sansCommentaires = (source || SOURCE_DB).replace(/\/\*[\s\S]*?\*\//g, ' ');
  var i = sansCommentaires.indexOf('function ' + nom + '(');
  if (i === -1) echoue('fonction introuvable : ' + nom);
  var j = sansCommentaires.indexOf('\n  }', i);
  return sansCommentaires.slice(i, j === -1 ? undefined : j);
}

var COLONNES_REMISES_A_PLAT = [
  'minutes_reelles', 'entretien_centimes',
  'minutes_sup_exceptionnelles', 'minutes_sup_renoncees', 'sup_dues_override',
  'ecart_minutes', 'ecart_evenement', 'ecart_heure_reelle', 'ecart_impute_sur'
];

cas.push({
  nom: 'B1 (lot 18) — un marquage groupé remet à plat TOUT ce que le type rend caduc',
  fn: function () {
    var corps = corpsDe('marquerJournees');
    var manquantes = COLONNES_REMISES_A_PLAT.filter(function (c) {
      return corps.indexOf(c + ':') === -1;
    });
    if (manquantes.length) {
      echoue('`marquerJournees` ne pose pas ' + manquantes.join(', ') + '. ' +
        'Un `upsert` ne met à jour que les colonnes présentes : celles-ci ' +
        'SURVIVRAIENT au changement de type. Une journée d’absence porterait ' +
        'des minutes travaillées, et l’effet annoncé avant validation ne serait ' +
        'pas celui obtenu après (§18.1 A2).');
    }
  }
});

cas.push({
  nom: 'C2 (lot 18) — la note n’est PAS touchée par un marquage groupé',
  fn: function () {
    var corps = corpsDe('marquerJournees');
    if (corps.indexOf('commentaire') !== -1) {
      echoue('`marquerJournees` mentionne `commentaire`. Décision d’Adrien : la ' +
        'note survit au marquage — elle porte souvent la raison de l’absence. ' +
        'Son absence de la charge utile est ce qui la préserve ; l’y remettre, ' +
        'même à `null`, l’efface.');
    }
  }
});

cas.push({
  nom: 'C1 (lot 18) — « Annuler » rend toutes les colonnes qu’il a défaites',
  fn: function () {
    var corps = corpsDe('restaurer', SOURCE_ENFANT);
    var attendues = ['commentaire'].concat(COLONNES_REMISES_A_PLAT);
    var manquantes = attendues.filter(function (c) { return corps.indexOf(c) === -1; });
    if (manquantes.length) {
      echoue('la restauration ne rend pas ' + manquantes.join(', ') + '. ' +
        'Un bouton d’annulation qui ne rend qu’une partie de ce qu’il a défait ' +
        'est pire qu’aucun bouton : il fait croire que l’affaire est réglée.');
    }
  }
});

module.exports = { cas: cas };
