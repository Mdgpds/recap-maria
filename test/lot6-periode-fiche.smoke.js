/* ============================================================================
   Test de fumée — récapitulatif de période, historique, bilan et fiche contrat
   (lot 6), hors réseau.

   Ce qu'il vérifie, et pourquoi :

   - PÉRIODE (§2.8) : le résultat est bien rendu en DEUX blocs. « Compté au
     jour près » ne compte que les jours réellement couverts (une période
     démarrée le 12 mars ne compte pas les 11 premiers jours du mois), alors
     que « Sur les mois entiers » n'additionne QUE les mois entièrement
     contenus dans la période — aucun prorata de salaire n'est inventé, et les
     mois écartés sont nommés. Aucun bloc de copie : consultation personnelle.

   - HISTORIQUE (§2.6) : les mois sont groupés par année de bilan
     (septembre → août), du plus récent au plus ancien, et le bilan annuel
     affiche l'évolution des compteurs sans jamais les additionner.

   - FICHE CONTRAT (§2.7) : le garde-fou du lot 5 tient toujours — une date
     d'effet de barème qui toucherait un mois DÉJÀ CLÔTURÉ est refusée, avec
     une explication, et rien n'est écrit.

   Lancement : NODE_PATH=... node test/lot6-periode-fiche.smoke.js
   ========================================================================= */
'use strict';
/* LOT 17 §17.2 — les conditions du contrat sont DATÉES : le décor expose
   `getAvenants`, pas `getSalaires`. La traduction est faite par
   `test/decor-avenants.js`, qui assemble l'avenant à partir du contrat et du
   barème déjà écrits ici. Aucune valeur n'est inventée. */
var Decor = require('./decor-avenants.js');


var fs = require('fs');
var path = require('path');
var JSDOM = require('jsdom').JSDOM;

var racine = path.join(__dirname, '..');
var dom = new JSDOM(fs.readFileSync(path.join(racine, 'index.html'), 'utf8'),
  { url: 'https://exemple.test/' });

global.window = dom.window;
global.document = dom.window.document;
global.URL = dom.window.URL;

var echecs = 0;
function assert(cond, msg) {
  if (!cond) { echecs++; console.error('FAIL ' + msg); } else { console.log('ok   ' + msg); }
}
function pause(ms) { return new Promise(function (r) { setTimeout(r, ms || 20); }); }
function txt(el) { return el ? el.textContent : ''; }
function parTexte(racineEl, selecteur, morceau) {
  return Array.prototype.filter.call(racineEl.querySelectorAll(selecteur), function (e) {
    return e.textContent.indexOf(morceau) !== -1;
  })[0] || null;
}
function paneParTitre(racineEl, titre) {
  return Array.prototype.filter.call(racineEl.querySelectorAll('.pane'), function (p) {
    var t = p.querySelector('.pt');
    return t && t.textContent.indexOf(titre) !== -1;
  })[0] || null;
}
function valeurLigne(pane, libelle) {
  var l = Array.prototype.filter.call(pane.querySelectorAll('.l'), function (e) {
    return e.firstChild && e.firstChild.textContent.indexOf(libelle) !== -1;
  })[0];
  return l ? l.lastChild.textContent : null;
}

var Feries = require('../js/feries.js');
var Format = require('../js/format.js');
var Engine = require('../js/engine.js');
var Messages = require('../js/messages.js');
var Chaine = require('../js/chaine-mois.js');
global.Feries = Feries; window.Feries = Feries;
global.Format = Format; window.Format = Format;
global.Engine = Engine; window.Engine = Engine;
global.Messages = Messages; window.Messages = Messages;
global.ChaineMois = Chaine; window.ChaineMois = Chaine;

var LEA = {
  id: 'c-lea', prenom_enfant: 'Léa', famille_id: 'f1', famille: { id: 'f1', nom: 'Papillon' },
  date_debut: '2025-09-01', date_fin: null, jours_planning: [1, 2, 3, 4, 5],
  heure_arrivee: '08:30:00', heure_depart: '18:00:00',
  minutes_contractuelles: 540, minutes_sup_jour: 30, minutes_par_jour_conge: 540,
  entretien_centimes_jour: 500, statut: 'actif',
  sup_dues_si_enfant_absent: true, ordre_imputation: 'cp_puis_sup', archive: false
};
var SALAIRE = { id: 's1', contrat_id: 'c-lea', date_effet: '2025-09-01',
  brut_mensuel_centimes: 137289, net_mensuel_centimes: 107250 };
/* Un mois DÉJÀ CLÔTURÉ : avril 2026. */
var RECAPS = [{ id: 'r-avr', contrat_id: 'c-lea', annee: 2026, mois: 4, statut: 'fige',
  donnees: null, fige_le: '2026-05-02T08:00:00Z' }];

var ecritures = { salaires: [], avenants: [] };

var TOUS_CONTRATS = [LEA];

/* LOT 17 §17.2 — le contrat par son identifiant. `getAvenants` en a besoin
   pour reprendre les réglages du décor dans l'avenant : le moteur ne les lit
   plus sur `contrat`. */
function contratDe(id) {
  return TOUS_CONTRATS.filter(function (c) { return c.id === id; })[0] || TOUS_CONTRATS[0];
}

var DB = {
  getSession: function () { return Promise.resolve({ user: { id: 'u1', email: 'maria@exemple.test' } }); },
  onAuthChange: function () {},
  /* LOT 16 §16.2 — le nom qui signe les documents. Décor : non renseigné,
     le document dira « votre assistante maternelle ». */
  getEmettrice: function () { return Promise.resolve(null); },
  enregistrerEmettrice: function (nom) { return Promise.resolve({ nom: nom }); },
  /* LOT 16 §16.4 — la ligne des rappels affiche désormais son VRAI réglage.
     Décor : rappels inactifs, la ligne dira « Vous ne recevez aucun rappel ». */
  getPreferenceRappel: function () { return Promise.resolve(null); },
  listContratsActifs: function () { return Promise.resolve([LEA]); },
  listContratsTous: function () { return Promise.resolve([LEA]); },
  listContratsPourMois: function () { return Promise.resolve([LEA]); },
  listContratsPourPeriode: function () { return Promise.resolve([LEA]); },
  listFamillesToutes: function () { return Promise.resolve([]); },
    /* Lot 8 — identité et familles. */
    majContratIdentite: function (id, champs) { return Promise.resolve(champs); },
    rattacherContratAFamille: function () { return Promise.resolve(true); },
    renommerFamille: function () { return Promise.resolve(true); },
    archiverFamille: function () { return Promise.resolve(true); },
    desarchiverFamille: function () { return Promise.resolve(true); },
    listFamillesAvecContrats: function () { return Promise.resolve([]); },
  /* Lot 14 — la fiche contrat demande si le contrat est vierge pour décider
     d'AFFICHER ou non la suppression franche. Décor mis à jour ici : sans
     cette fonction, l'écran lève avant même de se rendre. */
  contratEstVierge: function () { return Promise.resolve(false); },
  getAvenants: function (id) {
    return Promise.resolve(Decor.avenantsDe(contratDe(id), [SALAIRE]));
  },
  getCompteurInitial: function () { return Promise.resolve(null); },
  getJourneesMois: function () { return Promise.resolve({}); },
  listImputationsPourMois: function () { return Promise.resolve([]); },
  getNoteMensuelle: function () { return Promise.resolve(null); },
    enregistrerNoteMensuelle: function (c, a, m, t) { return Promise.resolve({ texte: t }); },
  getJourneesPeriode: function () { return Promise.resolve({}); },
  /* Le récap figé n'a pas d'instantané utilisable ici : la chaîne le
     recalcule donc comme un mois ordinaire. C'est volontaire — ce test porte
     sur l'agrégation et sur le garde-fou, pas sur l'immuabilité (couverte par
     les tests du moteur et de la chaîne). */
  listRecapsPeriode: function () { return Promise.resolve([]); },
  listRecapsContrat: function () { return Promise.resolve(RECAPS); },
  getRecap: function () { return Promise.resolve(null); },
  ajouterAvenant: function (id, champs) {
    ecritures.avenants.push({ id: id, champs: champs });
    return Promise.resolve(Decor.avenantDe(contratDe(id), champs));
  },
  majAvenant: function (idAvenant, champs) {
    ecritures.avenants.push({ id: idAvenant, champs: champs });
    return Promise.resolve(champs);
  }
};
global.DB = DB; window.DB = DB;

require('../js/ui-kit.js');
require('../js/ui-accueil.js');
require('../js/ui-enfant.js');
require('../js/ui-document.js');
require('../js/ui-conges.js');
require('../js/ui-historique.js');
require('../js/ui-contrat.js');
require('../js/ui-menu.js');
require('../js/ui-periode.js');
require('../js/app.js');

window.App.moisCourant = function () { return { annee: 2026, mois: 5 }; };
window.App.aujourdhui = function () { return '2026-05-24'; };

var corps = document.getElementById('corps');
var sheet = document.getElementById('sheet');

(async function () {
  document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  await pause(120);

  /* ---------- Période : deux dates, dont un mois entamé ---------- */
  window.App.aller('periode', {});
  await pause(60);

  assert(!!parTexte(corps, 'button', 'Ce mois-ci'), 'raccourcis présents');
  assert(!!parTexte(corps, '.fld', 'Du') && !!parTexte(corps, '.fld', 'Au'),
    'deux dates choisies par listes déroulantes');
  assert(corps.querySelectorAll('input[type="date"]').length === 0,
    '§2.3 : aucune date ne se tape au clavier');

  /* Du 12 mars au 31 mai 2026 : mars est entamé, avril et mai sont entiers. */
  var champs = corps.querySelectorAll('.fld .dates');
  function poserDate(bloc, jour, mois, annee) {
    var s = bloc.querySelectorAll('select');
    s[1].value = String(mois); s[1].dispatchEvent(new dom.window.Event('change'));
    s[2].value = String(annee); s[2].dispatchEvent(new dom.window.Event('change'));
    s[0].value = String(jour); s[0].dispatchEvent(new dom.window.Event('change'));
  }
  poserDate(champs[0], 12, 3, 2026);
  poserDate(champs[1], 31, 5, 2026);
  parTexte(corps, 'button', 'Voir le récapitulatif').click();
  await pause(120);

  var resultats = document.getElementById('resultats-periode');
  var jour = paneParTitre(resultats, 'Compté au jour près');
  var entiers = paneParTitre(resultats, 'Sur les mois entiers');
  assert(!!jour && !!entiers, '§2.8 : résultat en deux blocs');
  assert(valeurLigne(entiers, 'Mois entiers') === '2',
    'seuls avril et mai sont des mois entiers (obtenu ' + valeurLigne(entiers, 'Mois entiers') + ')');
  assert(String(valeurLigne(entiers, 'Hors mois complets')).indexOf('mars') !== -1,
    'le mois entamé est nommé, jamais tronqué en silence');

  /* Mars 2026 compte 22 jours ouvrés ; à partir du 12, il n'en reste que 14.
     Le total du bloc « au jour près » doit donc être inférieur au total de
     trois mois pleins — c'est exactement ce que la copie bornée du contrat
     permet d'obtenir sans toucher au moteur. */
  var presence = Number(String(valeurLigne(jour, 'Jours de présence')).replace(/\D/g, ''));
  assert(presence > 30 && presence < 60,
    'présence comptée à partir du 12 mars (obtenu ' + presence + ' jours)');
  assert(!paneParTitre(resultats, 'Compteurs'),
    'aucun solde affiché sur une période à dates libres');
  assert(txt(resultats).indexOf('Pourquoi cette séparation') !== -1, 'encart d’explication présent');
  assert(txt(resultats).indexOf('consultation personnelle') !== -1, 'mention « consultation personnelle »');
  assert(resultats.querySelectorAll('textarea').length === 0,
    'aucun bloc « copier pour WhatsApp » : la période ne se transmet pas');

  /* ---------- Période : un raccourci, donc des mois entiers ---------- */
  parTexte(corps, 'button', 'Ce mois-ci').click();
  await pause(120);
  resultats = document.getElementById('resultats-periode');
  assert(!!paneParTitre(resultats, 'Compteurs'),
    'les soldes s’affichent sur une période faite de mois entiers');

  /* ---------- Historique et bilan ---------- */
  window.App.aller('historique', { contratId: 'c-lea', annee: 2026, mois: 5 });
  await pause(120);

  var annees = corps.querySelectorAll('.an');
  assert(annees.length === 1, 'une seule année de bilan (obtenu ' + annees.length + ')');
  assert(txt(annees[0]).indexOf('2025-2026') !== -1, 'année de bilan septembre → août');
  var cartes = corps.querySelectorAll('.card.click');
  assert(cartes.length === 9, 'les neuf mois de septembre à mai (obtenu ' + cartes.length + ')');
  assert(txt(cartes[0]).indexOf('Mai 2026') !== -1, 'du plus récent au plus ancien');
  assert(txt(cartes[0]).indexOf('en cours') !== -1, 'badge « en cours » sur un mois non clôturé');

  parTexte(corps, 'button', 'Bilan de l’année').click();
  await pause(120);
  assert(txt(corps).indexOf('Totaux de l’année') !== -1, 'bilan annuel : totaux');
  assert(txt(corps).indexOf('Où en sont les compteurs') !== -1, 'bilan annuel : évolution des compteurs');
  assert(txt(corps).indexOf('Rien ne se perd au 31 août') !== -1, 'RG-12 / RG-12bis rappelés');

  /* ---------- Fiche contrat : garde-fou du barème ---------- */
  window.App.aller('fiche', { contratId: 'c-lea' });
  await pause(80);

  assert(txt(corps).indexOf('Congés déduits d’abord') !== -1, '§2.7 : règles paramétrables affichées en clair');
  assert(txt(corps).indexOf('Majoration fin de contrat') !== -1, 'majoration de fin de contrat affichée');
  assert(!!parTexte(corps, 'button', 'Ce contrat est terminé'), 'accès à l’écran de fin de contrat');

  /* ---------- LOT 17 §17.4 : les conditions datées ---------- */

  /* Le vocabulaire a changé, et c'est le sujet du lot : on ne modifie plus
     des réglages, on fait un avenant. Les écrans « Nouveau barème » et
     « Modifier ces règles » n'existent plus. */
  assert(!parTexte(corps, '.menu', 'Nouveau barème') && !parTexte(corps, 'button', 'Nouveau barème'),
    '§17.4 : plus aucun « Nouveau barème »');
  assert(!parTexte(corps, 'button', 'Modifier ces règles'),
    '§17.4 : modifier les conditions sans avenant n’existe plus');
  assert(txt(corps).indexOf('En vigueur depuis le') !== -1,
    '§17.4 : la fiche dit depuis quand les conditions s’appliquent');
  assert(txt(corps).indexOf('avenant n°') !== -1, '§17.4 : et quel avenant les porte');
  assert(!!parTexte(corps, 'button', 'Voir l’historique des conditions'),
    '§17.4 : le lien vers la frise');

  parTexte(corps, 'button', 'Faire un avenant').click();
  await pause(60);
  assert(txt(sheet).indexOf('À partir du 1er') !== -1, 'feuille « Faire un avenant »');

  /* LE GARDE-FOU DU §17.4 : un avenant n'est JAMAIS rétroactif. Avril 2026
     est clôturé — il doit apparaître dans la liste, BARRÉ, avec sa raison, et
     ne doit pas pouvoir être choisi. */
  var selMois = sheet.querySelector('select');
  var optAvril = Array.prototype.filter.call(selMois.querySelectorAll('option'), function (o) {
    return o.textContent.indexOf('avril 2026') !== -1;
  })[0];
  assert(!!optAvril, '§17.4 : le mois clôturé est MONTRÉ, pas caché');
  assert(optAvril.disabled === true, '§17.4 : et il n’est pas choisissable');
  assert(optAvril.textContent.indexOf('clôturé') !== -1,
    '§17.4 : la raison est dite (obtenu « ' + optAvril.textContent + ' »)');
  assert(selMois.value.slice(0, 7) !== '2026-04',
    '§17.4 : un mois interdit n’est jamais présélectionné');
  assert(txt(sheet).indexOf('ne changeront pas') !== -1,
    '§17.4 : ce qui NE changera pas est dit sous le champ de date');

  console.log('\n' + (echecs === 0 ? 'Tout est conforme.' : echecs + ' échec(s).'));
  process.exit(echecs === 0 ? 0 : 1);
})().catch(function (e) {
  console.error('Erreur pendant le parcours :', e);
  process.exit(1);
});
