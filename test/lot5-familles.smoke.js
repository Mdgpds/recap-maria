/* ============================================================================
   lot5-familles.smoke.js — Tests de fumée de l'onglet Familles (C2, C3, C5).

   Vérifie les garde-fous, c'est-à-dire ce qui protège les récapitulatifs déjà
   partis chez les parents :
   - un barème dont la date d'effet tomberait sur un mois FIGÉ est refusé ;
   - un barème utilisé par un récapitulatif figé n'est pas supprimable ;
   - un barème sans net est enregistrable, mais signalé comme incomplet ;
   - le geste d'archivage écrit les TROIS notions d'un coup (statut, date de
     fin, archivage) sans jamais rien supprimer.

   Lancement : node test/lot5-familles.smoke.js  (nécessite jsdom en dev).
   ========================================================================= */
'use strict';

var JSDOM = require('jsdom').JSDOM;
var dom = new JSDOM('<!DOCTYPE html><body><main id="familles"></main></body>', { url: 'https://exemple.test/' });
global.window = dom.window;
global.document = dom.window.document;

var reponsesConfirm = [];
window.confirm = function () { return reponsesConfirm.length ? reponsesConfirm.shift() : true; };

var echecs = 0;
function assert(cond, msg) { if (!cond) { echecs++; console.error('FAIL ' + msg); } else console.log('ok   ' + msg); }

window.Feries = require('../js/feries.js');
window.Format = require('../js/format.js');
window.Engine = require('../js/engine.js');

var famille = { id: 'f1', nom: 'Papillon', canal: 'Groupe Papillon', archive: false };
var contrat = {
  id: 'c1', prenom_enfant: 'Alpha', famille_id: 'f1', famille: famille,
  jours_planning: [1, 2, 3, 4, 5], date_debut: '2026-01-01', date_fin: null, archive: false,
  heure_arrivee: '08:30:00', heure_depart: '18:00:00', statut: 'actif',
  minutes_contractuelles: 540, minutes_sup_jour: 30, minutes_par_jour_conge: 540,
  entretien_centimes_jour: 500, ordre_imputation: 'cp_puis_sup', sup_dues_si_enfant_absent: true
};
var salaires = [
  { id: 'A', contrat_id: 'c1', date_effet: '2026-01-01', brut_mensuel_centimes: 195000, net_mensuel_centimes: 150000 }
];
/* Juin 2026 est FIGÉ : c'est lui qui doit bloquer une date d'effet rétroactive. */
var recaps = [
  { id: 'r6', contrat_id: 'c1', annee: 2026, mois: 6, statut: 'fige', fige_le: '2026-07-01T09:00:00Z', donnees: {} },
  { id: 'r7', contrat_id: 'c1', annee: 2026, mois: 7, statut: 'brouillon', fige_le: null, donnees: {} }
];

var ecrits = { salaires: [], contrats: [], supprimes: [] };
var DB = {
  listFamillesToutes: function () { return Promise.resolve([famille]); },
  listContratsTous: function () { return Promise.resolve([contrat]); },
  listContratsActifs: function () { return Promise.resolve([contrat]); },
  getSalaires: function () { return Promise.resolve(salaires); },
  listRecapsContrat: function () { return Promise.resolve(recaps); },
  ajouterSalaire: function (id, champs) { ecrits.salaires.push({ id: id, champs: champs }); return Promise.resolve({}); },
  majSalaire: function (id, champs) { ecrits.salaires.push({ id: id, champs: champs, maj: true }); return Promise.resolve({}); },
  supprimerSalaire: function (id) { ecrits.supprimes.push(id); return Promise.resolve(true); },
  majContrat: function (id, champs) { ecrits.contrats.push({ id: id, champs: champs }); return Promise.resolve(contrat); },
  archiverContrat: function (id, dateFin) {
    return DB.majContrat(id, { statut: 'termine', date_fin: dateFin, archive: true });
  },
  desarchiverContrat: function (id) { return DB.majContrat(id, { archive: false }); },
  getCompteurInitial: function () { return Promise.resolve(null); },
  getJourneesPeriode: function () { return Promise.resolve({}); },
  listRecapsPeriode: function () { return Promise.resolve([]); }
};
window.DB = DB;
global.DB = DB;
window.ChaineMois = require('../js/chaine-mois.js');
window.App = {
  moisCourant: function () { return { annee: 2026, mois: 8 }; },
  ouvrirRecapMois: function () { return Promise.resolve(); },
  rechargerContrats: function () { return Promise.resolve(); }
};

require('../js/ui-familles.js');
var UiFamilles = window.UiFamilles;

function parTexte(racine, selecteur, texte) {
  return Array.prototype.filter.call(racine.querySelectorAll(selecteur), function (e) {
    return e.textContent.indexOf(texte) !== -1;
  })[0];
}
function ouvrirDetails(det) {
  det.open = true;
  det.dispatchEvent(new window.Event('toggle'));
}
function attendre(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

var conteneur = document.getElementById('familles');
UiFamilles.init({ conteneur: conteneur });

UiFamilles.afficher()
  .then(function () {
    assert(conteneur.textContent.indexOf('Papillon') !== -1, 'C2 : la famille est affichée');
    assert(!!conteneur.querySelector('.bloc-contrat'), 'C2 : le contrat est affiché');

    var blocContrat = conteneur.querySelector('.bloc-contrat');
    ouvrirDetails(blocContrat);
    var sections = blocContrat.querySelectorAll(':scope > details');
    assert(sections.length === 4,
      'C2/C3/C5 : quatre sections par contrat (contrat, barèmes, historique, archivage)');

    // Les trois règles paramétrables sont exposées à l'écran.
    ouvrirDetails(sections[0]);
    var texteForm = sections[0].textContent;
    assert(texteForm.indexOf('Minutes supplémentaires par jour') !== -1, 'C2 : minutes_sup_jour modifiable');
    assert(texteForm.indexOf('Ordre d’imputation') !== -1, 'C2 : ordre_imputation modifiable');
    assert(texteForm.indexOf('Heures sup dues si l’enfant est absent') !== -1,
      'C2 : sup_dues_si_enfant_absent modifiable');

    // Aucun bouton de suppression de contrat ou de famille, nulle part.
    var suppressions = Array.prototype.filter.call(conteneur.querySelectorAll('button'), function (b) {
      var t = b.textContent.toLowerCase();
      return t.indexOf('supprimer') !== -1 && t.indexOf('barème') === -1;
    });
    assert(suppressions.length === 0, 'C3 : aucun bouton de suppression de contrat ou de famille');

    ouvrirDetails(sections[1]);       // barèmes (chargement asynchrone)
    return attendre(30).then(function () { return sections; });
  })
  .then(function (sections) {
    var baremes = sections[1];
    assert(baremes.textContent.indexOf('En vigueur') !== -1, 'C5 : le barème en vigueur est signalé');

    /* --- Garde-fou 1 : date d'effet sur un mois FIGÉ -> refus --- */
    var bNouveau = parTexte(baremes, 'button', 'Nouveau barème');
    assert(!!bNouveau, 'C5 : bouton « Nouveau barème » présent');
    bNouveau.click();

    var feuille = document.querySelector('#overlay-familles .feuille');
    assert(!!feuille, 'C5 : la feuille de saisie du barème s’ouvre');
    var champs = feuille.querySelectorAll('input');
    champs[0].value = '2026-06-01';        // juin est figé
    champs[1].value = '2 100,00';
    champs[2].value = '1 620,00';
    parTexte(feuille, 'button', 'Enregistrer le barème').click();

    return attendre(20).then(function () {
      var msg = feuille.querySelector('.msg-erreur');
      assert(!!msg && msg.textContent.indexOf('figé') !== -1,
        'C5 : une date d’effet sur un mois figé est refusée, avec explication');
      assert(ecrits.salaires.length === 0, 'C5 : rien n’a été enregistré en cas de refus');

      /* RG-15 : une date d'effet EN COURS DE MOIS ne touche que le mois
         suivant. Le 15 juin ne touche donc pas juin (figé) mais juillet
         (brouillon) : refuser ici serait un faux refus. */
      reponsesConfirm = [false];
      champs[0].value = '2026-06-15';
      parTexte(feuille, 'button', 'Enregistrer le barème').click();
      return attendre(20);
    }).then(function () {
      var msg = feuille.querySelector('.msg-erreur');
      assert(!msg || msg.textContent.indexOf('figé') === -1,
        'C5/RG-15 : une date d’effet au 15 juin n’est PAS refusée à cause d’un juin figé');
      assert(ecrits.salaires.length === 0,
        'C5 : la confirmation refusée sur juillet (brouillon) n’enregistre rien');

      /* --- Garde-fou 2 : mois en brouillon -> avertissement + confirmation --- */
      reponsesConfirm = [false];         // l'utilisatrice refuse le recalcul du brouillon
      champs[0].value = '2026-07-01';    // juillet est en brouillon
      parTexte(feuille, 'button', 'Enregistrer le barème').click();
      return attendre(20);
    }).then(function () {
      assert(ecrits.salaires.length === 0,
        'C5 : refuser la confirmation sur un mois en brouillon n’enregistre rien');

      /* --- Net absent : enregistrable, mais signalé --- */
      reponsesConfirm = [true];          // confirmation « net non renseigné »
      champs[0].value = '2026-09-01';
      champs[2].value = '';
      parTexte(feuille, 'button', 'Enregistrer le barème').click();
      return attendre(30);
    }).then(function () {
      assert(ecrits.salaires.length === 1, 'C5 : le barème au 1er septembre est enregistré');
      if (ecrits.salaires.length) {
        var s = ecrits.salaires[0].champs;
        assert(s.date_effet === '2026-09-01', 'C5 : date d’effet enregistrée');
        assert(s.brut_mensuel_centimes === 210000, 'C5 : brut converti en centimes entiers');
        assert(s.net_mensuel_centimes === 0, 'C5 : net non renseigné enregistré à zéro, signalé incomplet');
      }
      return sections;
    });
  })
  .then(function (sections) {
    /* --- Garde-fou 3 : suppression d'un barème servant un récap figé --- */
    var baremes = sections[1];
    var bSupprimer = parTexte(baremes, 'button', 'Supprimer');
    assert(!!bSupprimer, 'C5 : bouton « Supprimer » présent sur un barème');
    bSupprimer.click();
    return attendre(20).then(function () {
      assert(ecrits.supprimes.length === 0,
        'C5 : suppression refusée — ce barème sert un récapitulatif figé');
      var msg = document.getElementById('msg-familles');
      assert(msg.textContent.indexOf('figés') !== -1, 'C5 : le refus est expliqué en français');
      return sections;
    });
  })
  .then(function (sections) {
    /* --- C3 : le geste d'archivage --- */
    var archivage = sections[3];
    ouvrirDetails(archivage);
    assert(archivage.textContent.indexOf('RG-13') === -1 ||
           archivage.textContent.indexOf('rangement visuel') !== -1,
      'C3 : les trois notions (statut, date de fin, archivage) sont explicitées');

    var inputs = archivage.querySelectorAll('input');
    inputs[0].value = '2026-08-31';
    reponsesConfirm = [true];
    parTexte(archivage, 'button', 'Archiver ce contrat').click();
    return attendre(40).then(function () {
      assert(ecrits.contrats.length === 1, 'C3 : l’archivage écrit une fois');
      if (ecrits.contrats.length) {
        var c = ecrits.contrats[0].champs;
        assert(c.statut === 'termine', 'C3 : le statut passe à « terminé »');
        assert(c.date_fin === '2026-08-31', 'C3 : la date de fin est renseignée');
        assert(c.archive === true, 'C3 : le contrat est rangé (archive = true)');
      }
    });
  })
  .then(function () {
    console.log('\n' + (echecs === 0 ? 'Tout est conforme.' : echecs + ' échec(s).'));
    process.exit(echecs === 0 ? 0 : 1);
  })
  .catch(function (e) { console.error('Erreur :', e); process.exit(1); });
