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

/* Version SANS COMMENTAIRES, pour l'analyse des `select`.

   Ce contrôle lit db.js comme un texte : il repère une constante, en extrait
   les fragments entre apostrophes et les recolle. Or les commentaires de ce
   dépôt sont écrits en français, donc pleins d'apostrophes — « l'application »,
   « n'existerait », « c'est ». Un commentaire posé AU MILIEU d'une constante
   concaténée injectait donc ses propres morceaux dans la valeur reconstituée,
   et le contrôle déclarait manquante une colonne parfaitement présente.

   Trouvé en ajoutant les colonnes du lot 8, qui sont précédées d'un tel
   commentaire. Le défaut était dans le contrôle, pas dans db.js. */
var SANS_COMMENTAIRES = SOURCE
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:'"])\/\/[^\n]*/g, '$1');

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
  contrat: ['id', 'prenom_enfant', 'famille_id', 'date_debut', 'date_fin',
            'jours_planning', 'statut', 'archive',
            'nom', 'genre', 'couleur', 'photo',                 // lot 8
            'modele_id'],                                       // lot 11
  note_mensuelle: ['id', 'contrat_id', 'annee', 'mois', 'texte', 'maj_le'],
  modele_contrat: ['id', 'nom', 'date_effet', 'jours_planning',
                   'heure_arrivee', 'heure_depart', 'minutes_contractuelles',
                   'minutes_sup_jour', 'minutes_par_jour_conge',
                   'entretien_centimes_jour', 'brut_mensuel_centimes',
                   'net_mensuel_centimes', 'sup_dues_si_enfant_absent',
                   'ordre_imputation'],
  recap_mensuel: ['id', 'contrat_id', 'annee', 'mois', 'statut', 'donnees',
                  'fige_le', 'transmis_le'],
  journee: ['id', 'contrat_id', 'jour', 'type', 'minutes_reelles',
            'entretien_centimes', 'commentaire',
            'minutes_sup_exceptionnelles', 'minutes_sup_renoncees', 'sup_dues_override',
            /* Lot 17 — l'écart d'horaire déclaré (§17.5). Les quatre colonnes
               vont ensemble : les minutes font le calcul, l'événement et
               l'heure réelle font l'explication sur le document. */
            'ecart_minutes', 'ecart_evenement', 'ecart_heure_reelle', 'ecart_impute_sur'],
  imputation_conge: ['id', 'contrat_id', 'date_debut', 'date_fin', 'jours_ouvrables',
                     'jours_sur_cp', 'jours_sur_sup', 'jours_sans_solde'],
  evenement_recap: ['id', 'recap_id', 'type', 'survenu_le', 'motif'],
  /* Lot 17 — les congés payés passent en MINUTES (§17.6). Les colonnes en
     dixièmes existent toujours en base mais ne sont plus lues : les demander
     serait la meilleure façon de les réafficher un jour par mégarde. */
  compteur_initial: ['contrat_id', 'date_reference', 'minutes_sup',           // lot 14
                     'minutes_cp_acquis', 'minutes_cp_pris'],
  /* Lot 17 — les conditions du contrat, datées (§17.2). C'est la table la
     plus exposée au défaut que ce contrôle garde : onze réglages, dont
     l'oubli d'un seul dans un select ferait calculer un mois avec un réglage
     à `undefined`. */
  avenant_contrat: ['id', 'contrat_id', 'date_effet', 'numero', 'reconstitue',
                    'brut_mensuel_centimes', 'net_mensuel_centimes',
                    'jours_planning', 'heure_arrivee', 'heure_depart',
                    'minutes_contractuelles', 'minutes_sup_jour',
                    'minutes_par_jour_conge', 'entretien_centimes_jour',
                    'sup_dues_si_enfant_absent', 'ordre_imputation'],
  preference_rappel: ['owner', 'actif', 'jour_du_mois', 'heure',              // lot 15
                      'chaque_jour_ensuite', 'maj_le'],
  abonnement_push: ['id', 'endpoint', 'cree_le']                              // lot 15
};

/* Toutes les lectures ne ramènent pas une ligne entière : `estMoisCloture` ne
   demande que `statut`, et c'est très bien — une projection étroite et
   volontaire n'a aucune raison de tout lister. Le contrôle ne porte donc que
   sur les select qui ramènent la LIGNE, reconnus à une colonne pivot. Les
   deux défauts réels portaient tous deux sur des select de ce type. */
var COLONNE_PIVOT = {
  /* `ordre_imputation` désigne les select de ligne ENTIÈRE d'un contrat, et
     laisse de côté les projections étroites volontaires — celle
     d'`archiverFamille`, qui ne lit que de quoi refuser, ou celle des
     contrats imbriqués de `listFamillesAvecContrats`. */
  contrat: 'ordre_imputation',
  modele_contrat: 'brut_mensuel_centimes',
  note_mensuelle: 'texte',
  recap_mensuel: 'donnees',
  journee: 'type',
  imputation_conge: 'jours_ouvrables',
  evenement_recap: 'type',
  compteur_initial: 'minutes_cp_acquis',
  /* La projection étroite de `supprimerAvenant`, qui ne lit que `contrat_id`
     pour savoir quel contrat renuméroter, n'est pas une lecture de ligne. */
  avenant_contrat: 'ordre_imputation',
  preference_rappel: 'chaque_jour_ensuite',
  /* `abonnement_push` ne se relit jamais en entier côté client : l'appareil
     n'a rien à faire de ses propres clés, seul le serveur les utilise. Le
     pivot est donc `endpoint`, la seule colonne que l'application consulte. */
  abonnement_push: 'endpoint'
};

/* Une constante de la forme `var CHAMPS_X = 'a, b, ' + 'c';` — on récupère le
   texte concaténé, sans exécuter le fichier. */
function valeurConstante(nom) {
  var re = new RegExp('var\\s+' + nom + '\\s*=\\s*([\\s\\S]*?);');
  var m = re.exec(SANS_COMMENTAIRES);
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
  while ((m = re.exec(SANS_COMMENTAIRES)) !== null) {
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
  nom: 'db.js — l’export ne contient AUCUNE photo (lot 14, A5)',
  fn: function () {
    /* Risque n° 3 du lot 14 : une photo dans l'export, ce sont des centaines
       de kilo-octets de données inutiles hors de l'application — et un fichier
       qu'on n'ouvre plus. Le retrait doit se faire À LA SOURCE : un export qui
       la porterait serait déjà écrit sur le disque de Maria avant qu'on s'en
       aperçoive. */
    var i = SANS_COMMENTAIRES.indexOf('function exporterHistorique');
    egal(i !== -1, true, 'exporterHistorique existe');
    var corps = SANS_COMMENTAIRES.slice(i, i + 3000);
    egal(/k !== 'photo'/.test(corps), true,
      'la photo est explicitement retirée des contrats exportés');
  }
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
  nom: 'db.js — aucune colonne des lots 9, 13 et 8 n’est lue sans être demandée',
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
       'minutes_sup_exceptionnelles', 'minutes_sup_renoncees',
       'couleur', 'photo', 'genre', 'modele_id'].forEach(function (col) {
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
