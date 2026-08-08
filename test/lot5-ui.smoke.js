/* ============================================================================
   lot5-ui.smoke.js — Tests de fumée des correctifs C1, C2 et C4, hors réseau.

   C1 : après connexion, on atterrit sur un onglet Récap DÉJÀ REMPLI (le piège
        du correctif est d'y basculer avant que `pret` ne soit vrai : l'onglet
        s'afficherait vide et ne se remplirait qu'au second clic).
   C2 : renommer un enfant ne réécrit pas un récapitulatif figé — le nom lu à
        l'affichage vient de l'instantané, pas du contrat courant.
   C4 : un contrat archivé reste visible sur les mois qu'il couvrait, signalé
        comme tel.

   Lancement : node test/lot5-ui.smoke.js  (nécessite jsdom en dev).
   ========================================================================= */
'use strict';

var JSDOM = require('jsdom').JSDOM;

var HTML = '<!DOCTYPE html><body>' +
  '<section id="vue-login" hidden><form id="form-login">' +
  '<input id="login-email"><input id="login-mdp">' +
  '<button id="btn-login" type="submit"></button><div id="msg-login"></div></form></section>' +
  '<section id="vue-app" hidden>' +
  '<button id="btn-logout"></button>' +
  '<div id="chargement">Chargement…</div>' +
  '<nav id="onglets" hidden>' +
  '<button id="onglet-recap" class="onglet onglet-actif"></button>' +
  '<button id="onglet-saisie" class="onglet"></button>' +
  '<button id="onglet-periode" class="onglet"></button>' +
  '<button id="onglet-familles" class="onglet"></button></nav>' +
  '<main id="recap" hidden></main><main id="saisie" hidden></main>' +
  '<main id="periode" hidden></main><main id="familles" hidden></main>' +
  '</section></body>';

var dom = new JSDOM(HTML, { url: 'https://exemple.test/' });
global.window = dom.window;
global.document = dom.window.document;
window.confirm = function () { return true; };

var echecs = 0;
function assert(cond, msg) { if (!cond) { echecs++; console.error('FAIL ' + msg); } else console.log('ok   ' + msg); }

window.Feries = require('../js/feries.js');
window.Format = require('../js/format.js');
window.Engine = require('../js/engine.js');

/* Deux contrats sur mars 2026 : un actif, un archivé le 15 mars.
   Le contrat archivé DOIT rester visible sur ce mois (C4) : l'enfant a bien
   été gardé quinze jours. */
var contratActif = {
  id: 'c1', prenom_enfant: 'Alpha', famille_id: 'f1', famille: { id: 'f1', nom: 'Papillon' },
  jours_planning: [1, 2, 3, 4, 5], date_debut: '2026-03-01', date_fin: null, archive: false,
  minutes_sup_jour: 30, minutes_par_jour_conge: 540, entretien_centimes_jour: 500,
  ordre_imputation: 'cp_puis_sup', sup_dues_si_enfant_absent: true
};
/* Contrat renommé « Nouveau » APRÈS le figement de mars, dont l'instantané
   porte encore « Ancien ». */
var contratArchive = {
  id: 'c2', prenom_enfant: 'Nouveau', famille_id: 'f2', famille: { id: 'f2', nom: 'Renommée' },
  jours_planning: [1, 2, 3, 4, 5], date_debut: '2026-03-01', date_fin: '2026-03-15', archive: true,
  minutes_sup_jour: 30, minutes_par_jour_conge: 540, entretien_centimes_jour: 500,
  ordre_imputation: 'cp_puis_sup', sup_dues_si_enfant_absent: true
};

var recapFigeC2 = {
  id: 'r1', contrat_id: 'c2', annee: 2026, mois: 3, statut: 'fige', fige_le: '2026-04-02T09:00:00Z',
  donnees: {
    joursPresence: 11, entretienCentimes: 5500, minutesSupAcquises: 330,
    joursCongesDecomptes: 0,
    imputation: { joursSurCp: 0, joursSurSup: 0, joursSansSolde: 0, minutesSupConsommees: 0, dixiemesCpConsommes: 0 },
    retenueSansSoldeCentimes: 0, dixiemesCpAcquis: 0,
    salaireBrutCentimes: 195000, salaireNetCentimes: 150000,
    /* Instantané figé AVANT le lot 5 : volontairement SANS salaireDateEffet,
       pour vérifier que la date d'effet est retrouvée par RG-15 et non
       affichée « — » aux parents. */
    prenomEnfant: 'Ancien', nomFamille: 'Papillon',
    totalAVerserCentimes: 155500,
    compteurSortie: { minutesSup: 330, dixiemesCpAcquis: 0, dixiemesCpPris: 0 }
  }
};

var appelsAfficherSaisie = 0;
var DB = {
  getSession: function () { return Promise.resolve({ user: { id: 'u1' } }); },
  onAuthChange: function () { /* aucun événement simulé */ },
  signOut: function () { return Promise.resolve(true); },
  listContratsActifs: function () { return Promise.resolve([contratActif]); },
  listContratsTous: function () { return Promise.resolve([contratActif, contratArchive]); },
  listContratsPourMois: function () { return Promise.resolve([contratActif, contratArchive]); },
  getSalaires: function () {
    return Promise.resolve([{ id: 's1', contrat_id: 'c1', date_effet: '2026-01-01', brut_mensuel_centimes: 195000, net_mensuel_centimes: 150000 }]);
  },
  getCompteurInitial: function () { return Promise.resolve(null); },
  getJourneesPeriode: function () { return Promise.resolve({}); },
  listRecapsPeriode: function (contratId) {
    return Promise.resolve(contratId === 'c2' ? [recapFigeC2] : []);
  },
  /* Comme en production : le récap figé est lu directement, sans rejouer la
     chaîne (chemin rapide de l'écran mensuel). */
  getRecap: function (contratId, a, m) {
    return Promise.resolve(contratId === 'c2' && a === 2026 && m === 3 ? recapFigeC2 : null);
  }
};
window.DB = DB;
global.DB = DB;

window.ChaineMois = require('../js/chaine-mois.js');

/* UiSaisie simulé : le lot 5 ne touche pas à l'écran de saisie. */
window.UiSaisie = {
  init: function () {},
  afficherMois: function () { appelsAfficherSaisie++; return Promise.resolve(); }
};

require('../js/ui-recap.js');
require('../js/app.js');

document.dispatchEvent(new window.Event('DOMContentLoaded'));

setTimeout(function () {
  /* ---- C1 : atterrissage sur le récap, rempli ---- */
  var recap = document.getElementById('recap');
  var onglets = document.getElementById('onglets');
  var chargement = document.getElementById('chargement');

  assert(chargement.hidden === true, 'C1 : l’état d’attente est masqué une fois chargé');
  assert(onglets.hidden === false, 'C1 : les onglets sont révélés');
  assert(recap.hidden === false, 'C1 : l’onglet Récap est celui affiché');
  assert(document.getElementById('saisie').hidden === true, 'C1 : l’onglet Saisie n’est pas affiché');
  assert(document.getElementById('onglet-recap').classList.contains('onglet-actif'),
    'C1 : l’onglet Récap est marqué actif');
  assert(appelsAfficherSaisie === 1, 'C1 : la saisie a bien été initialisée avant la bascule');
  assert(recap.querySelectorAll('.carte-contrat').length > 0,
    'C1 : l’onglet Récap est REMPLI dès l’arrivée (pas vide au premier affichage)');

  /* ---- C2 et C4, sur un mois précis ---- */
  window.UiRecap.afficherRecapMois(2026, 3).then(function () {
    var cartes = recap.querySelectorAll('.carte-contrat');
    assert(cartes.length === 2, 'C4 : les deux contrats du mois sont affichés');

    var textes = Array.prototype.map.call(cartes, function (c) { return c.textContent; }).join(' | ');
    assert(textes.indexOf('Ancien') !== -1,
      'C2 : le récap figé affiche le nom inscrit dans l’instantané (« Ancien »)');
    assert(textes.indexOf('Nouveau') === -1,
      'C2 : le renommage du contrat ne réécrit pas le récap figé');

    assert(recap.querySelectorAll('.badge-archive').length === 1,
      'C4 : le contrat archivé est signalé comme tel');
    assert(recap.querySelectorAll('.badge-fige').length === 1,
      'le mois figé est signalé comme tel');
    assert(textes.indexOf('aucune saisie de journée n’est possible') !== -1,
      'C4 : le contrat archivé est affiché en lecture seule côté saisie');
    assert(textes.indexOf('01/01/2026') !== -1,
      'C5 : sur un instantané figé d’avant le lot 5, la date d’effet est retrouvée par RG-15');
    var wa = recap.querySelector('.wa-texte');
    assert(!!wa && wa.value.indexOf('en vigueur depuis le —') === -1,
      'C5 : le document parents n’affiche jamais « en vigueur depuis le — »');

    console.log('\n' + (echecs === 0 ? 'Tout est conforme.' : echecs + ' échec(s).'));
    process.exit(echecs === 0 ? 0 : 1);
  }).catch(function (e) { console.error('Erreur :', e); process.exit(1); });
}, 200);
