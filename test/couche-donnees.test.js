/* ============================================================================
   couche-donnees.test.js — Une colonne ajoutée en base doit être LUE.

   Ce fichier existe à cause d'un défaut qui s'est produit DEUX FOIS.

   Au lot 9, trois colonnes de flexibilité ont été ajoutées à `journee` ; les
   `select` de db.js listent leurs colonnes une par une, et personne n'y avait
   pensé : le moteur ne les aurait jamais vues, quel que soit l'écran qui les
   écrirait ensuite. La spécification a dû être corrigée pour le dire.

   Au lot 13, exactement la même chose est arrivée avec `transmis_le` : trois
   `select` de `recap_mensuel` ne la demandaient pas, alors que six endroits de
   `ui-reouverture.js` la lisent. Résultat : les trois avertissements « ce
   récapitulatif a été transmis à la famille » n'auraient JAMAIS pu s'afficher,
   même une fois le lot 7 livré — et aucun test ne le voyait, puisque les tests
   de fumée simulent la couche données et lui passent des objets déjà complets.

   Un `select` qui oublie une colonne ne casse rien : il rend simplement une
   valeur `undefined`, et le code qui la lit se tait. C'est précisément le
   genre de panne silencieuse que cette application ne peut pas se permettre.

   Ce contrôle lit db.js comme un TEXTE — il ne l'exécute pas, puisque ce
   fichier a besoin d'un navigateur. Aucune dépendance.
   ========================================================================= */
'use strict';

var fs = require('fs');
var path = require('path');

var SOURCE = fs.readFileSync(path.join(__dirname, '..', 'js', 'db.js'), 'utf8');

function egal(obtenu, attendu, libelle) {
  if (obtenu !== attendu) {
    throw new Error(libelle + ' : attendu ' + JSON.stringify(attendu) +
      ', obtenu ' + JSON.stringify(obtenu));
  }
}

/* Colonnes que le RESTE de l'application lit sur chaque table. Toute colonne
   ajoutée par une migration et consommée par un écran ou par le moteur doit
   être ajoutée ici EN MÊME TEMPS que dans le select. */
var COLONNES_ATTENDUES = {
  recap_mensuel: ['id', 'contrat_id', 'annee', 'mois', 'statut', 'donnees',
                  'fige_le', 'transmis_le'],
  journee: ['id', 'contrat_id', 'jour', 'type', 'minutes_reelles',
            'entretien_centimes', 'commentaire',
            'minutes_sup_exceptionnelles', 'minutes_sup_renoncees', 'sup_dues_override'],
  imputation_conge: ['id', 'contrat_id', 'date_debut', 'date_fin', 'jours_ouvrables',
                     'jours_sur_cp', 'jours_sur_sup', 'jours_sans_solde'],
  evenement_recap: ['id', 'recap_id', 'type', 'survenu_le', 'motif']
};

/* Toutes les lectures ne ramènent pas une ligne entière : `estMoisCloture` ne
   demande que `statut`, et c'est très bien — une projection étroite et
   volontaire n'a aucune raison de tout lister. Le contrôle ne porte donc que
   sur les select qui ramènent la LIGNE, reconnus à une colonne pivot. Les
   deux défauts réels portaient tous deux sur des select de ce type. */
var COLONNE_PIVOT = {
  recap_mensuel: 'donnees',
  journee: 'type',
  imputation_conge: 'jours_ouvrables',
  evenement_recap: 'type'
};

/* Une constante de la forme `var CHAMPS_X = 'a, b, ' + 'c';` — on récupère le
   texte concaténé, sans exécuter le fichier. */
function valeurConstante(nom) {
  var re = new RegExp('var\\s+' + nom + '\\s*=\\s*([\\s\\S]*?);');
  var m = re.exec(SOURCE);
  if (!m) return null;
  var morceaux = m[1].match(/'([^']*)'/g) || [];
  return morceaux.map(function (s) { return s.slice(1, -1); }).join('');
}

/* Tous les `select` NON VIDES posés sur une table donnée. Un `.select()` sans
   argument demande toutes les colonnes : il n'y a rien à vérifier. */
function selectsDe(table) {
  var re = new RegExp("client\\.from\\('" + table + "'\\)([\\s\\S]{0,600}?)\\.then\\(", 'g');
  var trouves = [];
  var m;
  while ((m = re.exec(SOURCE)) !== null) {
    var bloc = m[1];
    var sel = /\.select\(\s*([^)]*?)\s*\)/.exec(bloc);
    if (!sel) continue;
    var arg = sel[1].trim();
    if (arg === '') continue;                       // toutes les colonnes
    if (arg.charAt(0) === "'" || arg.charAt(0) === '"') {
      var morceaux = arg.match(/'([^']*)'/g) || [];
      trouves.push(morceaux.map(function (s) { return s.slice(1, -1); }).join(''));
    } else {
      var v = valeurConstante(arg);
      if (v) trouves.push(v);
    }
  }
  return trouves;
}

var cas = [];

Object.keys(COLONNES_ATTENDUES).forEach(function (table) {
  cas.push({
    nom: 'db.js — chaque select de « ' + table + ' » demande toutes les colonnes lues',
    fn: function () {
      var pivot = COLONNE_PIVOT[table];
      var selects = selectsDe(table).filter(function (sel) {
        return sel.indexOf(pivot) !== -1;         // lectures de ligne entière
      });
      egal(selects.length > 0, true,
        'au moins un select de ligne entière sur ' + table +
        ' (sinon ce contrôle ne sert à rien)');

      selects.forEach(function (sel, i) {
        COLONNES_ATTENDUES[table].forEach(function (colonne) {
          var present = new RegExp('(^|[\\s,(])' + colonne + '($|[\\s,)])').test(sel);
          egal(present, true,
            'select n° ' + (i + 1) + ' de ' + table + ' : la colonne « ' + colonne +
            ' » est lue par l’application mais absente du select');
        });
      });
    }
  });
});

cas.push({
  nom: 'db.js — aucun chemin ne clôture un mois sans passer par la base (C4)',
  fn: function () {
    /* Relecture lot 13, anomalie C4. `figerRecap` clôturait par un UPDATE
       direct, avec un `fige_le` fabriqué côté client et AUCUN événement. Elle
       n'était plus appelée, mais restait exportée sous un nom plus court et
       plus ancien que son remplaçant : « un lot suivant l'appellera par
       habitude, le mois se clôturera, et le premier événement de l'historique
       sera Rouvert ».

       Le lot 13 ne tient que si la clôture a UN SEUL chemin. Ce contrôle le
       verrouille : le jour où quelqu'un réécrit un raccourci, il échoue. */
    egal(/figerRecap|figerVraiment\s*\(/.test(SOURCE.replace(/\/\*[\s\S]*?\*\//g, '')), false,
      'db.js ne contient plus figerRecap ni figerVraiment (hors commentaire)');

    /* Le fond, pas seulement le nom : aucun écriture directe de statut « fige »
       depuis le navigateur. Le seul chemin est `recloturer_recap` en base, qui
       écrit dans la même transaction que l'événement. */
    var sansCommentaires = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '');
    egal(/statut\s*:\s*'fige'/.test(sansCommentaires), false,
      'aucun update ne pose statut « fige » depuis le client');
    egal(/fige_le\s*:/.test(sansCommentaires), false,
      'aucun fige_le n’est fabriqué côté client : l’horodatage vient de la base');

    egal(sansCommentaires.indexOf("rpc('recloturer_recap'") !== -1, true,
      'la clôture passe bien par la fonction en base');
  }
});

cas.push({
  nom: 'db.js — aucune colonne du lot 13 n’est lue sans être demandée',
  fn: function () {
    /* Contrôle croisé, dans l'autre sens : on part de ce que les écrans
       LISENT et on vérifie que db.js le DEMANDE. C'est ce sens-là qui a
       manqué deux fois. */
    var racine = path.join(__dirname, '..', 'js');
    var lus = {};
    fs.readdirSync(racine).filter(function (f) {
      return /^ui-.*\.js$/.test(f) || f === 'chaine-mois.js' || f === 'app.js';
    }).forEach(function (f) {
      var src = fs.readFileSync(path.join(racine, f), 'utf8');
      ['transmis_le', 'fige_le', 'sup_dues_override',
       'minutes_sup_exceptionnelles', 'minutes_sup_renoncees'].forEach(function (col) {
        if (src.indexOf('.' + col) !== -1 || src.indexOf(col + ':') !== -1) lus[col] = true;
      });
    });

    Object.keys(lus).forEach(function (col) {
      egal(SOURCE.indexOf(col) !== -1, true,
        'la colonne « ' + col + ' » est lue par un écran mais n’apparaît nulle part dans db.js');
    });
  }
});

module.exports = { cas: cas };
