/* ============================================================================
   Test de fumée — LOT 16, LES ÉCRANS RENDUS.

   POURQUOI CE FICHIER EXISTE.

   La relecture du lot 16 a trouvé deux anomalies bloquantes, et a montré par
   où elles étaient passées : la suite du lot ne rendait AUCUN écran. Sur ses
   73 assertions, 41 interrogeaient le texte du code source — `indexOf` sur un
   fichier `.js` lu au disque. Aucune recherche de chaîne ne peut voir qu'une
   feuille annonce le mauvais nombre de jours, ni qu'une phrase reste muette.

   Les deux défauts trouvés étaient des défauts DE COMPORTEMENT, et tous deux
   se voient au premier écran rendu :

     - B1 : la feuille de correction annonçait « 5 jours à répartir » sur une
       période dont le décompte RG-06 vaut 6. Maria répartissait 5, la période
       restait écartée, la clôture restait bloquée — indéfiniment.
     - B2 : la liste des congés affichait « 5 j ouvrables » juste au-dessus de
       la phrase « une semaine complète compte 6 jours », sans nommer le samedi
       férié qui explique l'écart. C'est mot pour mot le défaut que le §16.8
       existe pour supprimer.

   Ce fichier monte donc le VRAI `index.html`, le VRAI moteur, la VRAIE chaîne
   et les VRAIS écrans, puis lit ce qui s'affiche. Il ne remplace pas
   `lot16-verite-et-conges.smoke.js`, qui garde les 32 assertions
   comportementales du moteur et de la chaîne : il ajoute la couche qui
   manquait.

   Lancement : node test/lot16-ecrans.smoke.js
   ========================================================================= */
'use strict';

var fs = require('fs');
var path = require('path');
var JSDOM = require('jsdom').JSDOM;

var racine = path.join(__dirname, '..');
var dom = new JSDOM(fs.readFileSync(path.join(racine, 'index.html'), 'utf8'),
  { url: 'https://exemple.test/' });

global.window = dom.window;
global.document = dom.window.document;
global.URL = dom.window.URL;
global.Blob = dom.window.Blob;

var echecs = 0;
function assert(cond, msg) {
  if (!cond) { echecs++; console.error('FAIL ' + msg); } else { console.log('ok   ' + msg); }
}
function egal(obtenu, attendu, msg) {
  assert(obtenu === attendu, msg + ' (attendu ' + JSON.stringify(attendu) +
    ', obtenu ' + JSON.stringify(obtenu) + ')');
}
function pause(ms) { return new Promise(function (r) { setTimeout(r, ms || 40); }); }
function txt(el) { return el ? String(el.textContent).replace(/ /g, ' ') : ''; }
function parTexte(racineEl, selecteur, morceau) {
  return Array.prototype.filter.call(racineEl.querySelectorAll(selecteur), function (e) {
    return txt(e).indexOf(morceau) !== -1;
  })[0] || null;
}
function boutonExact(racineEl, libelle) {
  return Array.prototype.filter.call(racineEl.querySelectorAll('button'), function (e) {
    return txt(e).trim() === libelle;
  })[0] || null;
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

/* --- Décor. Valeurs FICTIVES et rondes : le dépôt est PUBLIC. ----------- */
var PLANNING = [1, 2, 3, 4, 5];
var ALPHA = {
  id: 'c-alpha', prenom_enfant: 'Alpha', famille_id: 'f1',
  famille: { id: 'f1', nom: 'Papillon' },
  date_debut: '2026-01-01', date_fin: null,
  minutes_contractuelles: 540, minutes_sup_jour: 30, minutes_par_jour_conge: 540,
  entretien_centimes_jour: 500, jours_planning: PLANNING,
  heure_arrivee: '08:30:00', heure_depart: '17:30:00', statut: 'actif',
  sup_dues_si_enfant_absent: true, ordre_imputation: 'cp_puis_sup', archive: false,
  nom: null, genre: 'f', couleur: null, photo: null
};

/* JUIN — la période du 8 au 12 juin porte `jours_ouvrables = 5`, alors que le
   décompte RG-06 en vaut 6 : le samedi 13 est compris. C'est le cas B1. */
var JOURS_JUIN = ['2026-06-08', '2026-06-09', '2026-06-10', '2026-06-11', '2026-06-12'];
/* AOÛT — une semaine complète du 10 au 14. Le samedi 15 août est FÉRIÉ : la
   semaine ne compte donc que 5 jours et non 6. C'est le cas B2. */
var JOURS_AOUT = ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14'];

function journees(dates) {
  var out = {};
  dates.forEach(function (d) {
    out[d] = { id: 'j-' + d, contrat_id: 'c-alpha', jour: d, type: 'conge_maria',
      minutes_reelles: null, entretien_centimes: null, commentaire: null,
      minutes_sup_exceptionnelles: 0, minutes_sup_renoncees: 0, sup_dues_override: null };
  });
  return out;
}

var IMPUT_JUIN = {
  id: 'i-juin', contrat_id: 'c-alpha',
  date_debut: '2026-06-08', date_fin: '2026-06-12',
  jours_ouvrables: 5,            /* FAUX : RG-06 en compte 6 */
  jours_sur_cp: 5, jours_sur_sup: 0, jours_sans_solde: 0
};
var IMPUT_AOUT = {
  id: 'i-aout', contrat_id: 'c-alpha',
  date_debut: '2026-08-10', date_fin: '2026-08-14',
  jours_ouvrables: 5,            /* JUSTE : le samedi 15 est férié */
  jours_sur_cp: 5, jours_sur_sup: 0, jours_sans_solde: 0
};

var ecritures = { ventilation: [] };

var DB = {
  getSession: function () {
    return Promise.resolve({ user: { id: 'u1', email: 'maria@exemple.test' } });
  },
  onAuthChange: function () {},
  signOut: function () { return Promise.resolve(true); },
  getEmettrice: function () { return Promise.resolve(null); },
  enregistrerEmettrice: function (nom) { return Promise.resolve({ nom: nom }); },
  getPreferenceRappel: function () {
    return Promise.resolve({ actif: true, jour_du_mois: 25, heure: '19:00',
      chaque_jour_ensuite: true });
  },
  listContratsActifs: function () { return Promise.resolve([ALPHA]); },
  listContratsTous: function () { return Promise.resolve([ALPHA]); },
  listContratsPourMois: function () { return Promise.resolve([ALPHA]); },
  listContratsPourPeriode: function () { return Promise.resolve([ALPHA]); },
  listFamilles: function () { return Promise.resolve([ALPHA.famille]); },
  listFamillesToutes: function () { return Promise.resolve([ALPHA.famille]); },
  listFamillesAvecContrats: function () {
    return Promise.resolve([{ id: 'f1', nom: 'Papillon', archive: false, contrats: [ALPHA] }]);
  },
  contratEstVierge: function () { return Promise.resolve(false); },
  majContratIdentite: function (id, champs) { return Promise.resolve(champs); },
  getSalaires: function (id) {
    return Promise.resolve([{ id: 's1', contrat_id: id, date_effet: '2026-01-01',
      brut_mensuel_centimes: 150000, net_mensuel_centimes: 115000 }]);
  },
  getCompteurInitial: function (id) {
    return Promise.resolve({ contrat_id: id, date_reference: '2026-06-01',
      minutes_sup: 0, dixiemes_cp_acquis: 200, dixiemes_cp_pris: 0 });
  },
  getJourneesMois: function (id, a, m) {
    if (a === 2026 && m === 6) return Promise.resolve(journees(JOURS_JUIN));
    if (a === 2026 && m === 8) return Promise.resolve(journees(JOURS_AOUT));
    return Promise.resolve({});
  },
  getJourneesPeriode: function () {
    return Promise.resolve({ '2026-06': journees(JOURS_JUIN), '2026-08': journees(JOURS_AOUT) });
  },
  listImputations: function (id, debut, fin) {
    return Promise.resolve([IMPUT_JUIN, IMPUT_AOUT].filter(function (i) {
      return i.date_debut <= fin && i.date_fin >= debut;
    }));
  },
  listImputationsPourMois: function (id, a, m) {
    if (a === 2026 && m === 6) return Promise.resolve([IMPUT_JUIN]);
    if (a === 2026 && m === 8) return Promise.resolve([IMPUT_AOUT]);
    return Promise.resolve([]);
  },
  majVentilationImputation: function (id, v) {
    ecritures.ventilation.push({ id: id, v: v });
    return Promise.resolve({ id: id });
  },
  supprimerImputation: function () { return Promise.resolve(true); },
  getNoteMensuelle: function () { return Promise.resolve(null); },
  enregistrerNoteMensuelle: function (c, a, m, t) { return Promise.resolve({ texte: t }); },
  listRecapsPeriode: function () { return Promise.resolve([]); },
  listRecapsContrat: function () { return Promise.resolve([]); },
  getRecap: function () { return Promise.resolve(null); },
  enregistrerJournee: function (l) { return Promise.resolve(l); },
  supprimerJournee: function () { return Promise.resolve(true); },
  poserAbsenceMaria: function () { return Promise.resolve([]); },
  retirerAbsenceMaria: function () { return Promise.resolve(true); },
  enregistrerImputation: function (i) { return Promise.resolve(i); },
  recloturerRecap: function () { return Promise.resolve({ id: 'x', statut: 'fige' }); }
};
global.DB = DB; window.DB = DB;

require('../js/ui-kit.js');
require('../js/ui-reouverture.js');
require('../js/ui-accueil.js');
require('../js/ui-enfant.js');
require('../js/ui-document.js');
require('../js/ui-conges.js');
require('../js/ui-historique.js');
require('../js/ui-contrat.js');
require('../js/ui-menu.js');
require('../js/ui-periode.js');
require('../js/app.js');

window.App.moisCourant = function () { return { annee: 2026, mois: 6 }; };
window.App.aujourdhui = function () { return '2026-06-30'; };

var corps = document.getElementById('corps');
var sheet = document.getElementById('sheet');

(async function () {
  document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  await pause(250);

  /* ==================================================================== */
  /* B1 — LA FEUILLE DE CORRECTION ANNONCE LE DÉCOMPTE DU MOTEUR          */
  /* ==================================================================== */
  console.log('\n--- B1 : corriger une répartition dont le décompte est faux ---');

  var attendu = Engine.decompterJoursOuvrables('2026-06-08', '2026-06-12', PLANNING);
  egal(attendu, 6, 'décor : le décompte RG-06 réel de la période vaut 6, la ligne en porte 5');

  window.App.aller('enfant', { contratId: 'c-alpha', annee: 2026, mois: 6 });
  await pause(250);

  assert(txt(corps).indexOf('ne correspond plus à vos réserves') !== -1,
    'A1 : l’écran de l’enfant s’affiche, et porte l’encart en tête');

  /* L'ENCART NE DIT PLUS QUE 5 NE COUVRE PAS 5. */
  assert(txt(corps).indexOf('couvre 5 j') !== -1 && txt(corps).indexOf('en compte 6 j') !== -1,
    'B1 : l’encart oppose les DEUX nombres — ce qui est réparti, et ce que la ' +
    'période compte réellement');
  assert(txt(corps).indexOf('samedis inclus') !== -1,
    'B1 : et il dit pourquoi le second est plus grand');

  var bCorriger = boutonExact(corps, 'Corriger la répartition');
  assert(!!bCorriger, 'B1 : le bouton de correction est offert');
  bCorriger.click();
  await pause(300);

  /* LA FEUILLE ANNONCE 6, PAS 5. C'est tout le défaut. */
  assert(txt(sheet).indexOf('6 j à répartir') !== -1,
    'B1 : la feuille annonce le décompte du MOTEUR — 6 jours, pas les 5 enregistrés');
  assert(txt(sheet).indexOf('pas 5 j comme enregistré') !== -1,
    'B1 : et elle dit à Maria que la valeur enregistrée était fausse, avant ' +
    'qu’elle ne réparte');

  /* Le « reste à répartir » démarre à 1 : sa répartition d'origine est reprise
     (5 sur les congés payés), et il lui reste le jour découvert à placer. */
  var reste = sheet.querySelector('.reste');
  assert(!!reste && txt(reste).indexOf('1') !== -1,
    'B1 : « reste à répartir » démarre à 1 — le jour de plus, à elle de le placer');
  var bValider = boutonExact(sheet, 'Enregistrer la répartition');
  assert(!!bValider && bValider.disabled === true,
    'B1 : tant qu’il reste un jour à placer, l’enregistrement est refusé');

  /* Elle place le jour manquant sur les congés payés, puis valide. */
  var plusCp = sheet.querySelectorAll('.compteur-jours')[0].querySelectorAll('button')[1];
  plusCp.click();
  await pause(60);
  assert(bValider.disabled === false, 'B1 : le compte est bon, l’enregistrement s’ouvre');

  bValider.click();
  await pause(250);

  egal(ecritures.ventilation.length, 1, 'B1 : une écriture est partie');
  egal(ecritures.ventilation[0].v.jours_ouvrables, 6,
    'B1 : et elle porte `jours_ouvrables` corrigé au décompte du moteur — sans ' +
    'quoi la période resterait écartée et Maria tournerait en rond');
  egal(ecritures.ventilation[0].v.jours_sur_cp, 6,
    'B1 : avec la ventilation qui le couvre exactement');

  /* ==================================================================== */
  /* B2 — LE FÉRIÉ QUI EXPLIQUE LE DÉCOMPTE EST NOMMÉ                     */
  /* ==================================================================== */
  console.log('\n--- B2 : le samedi férié qui suit une semaine posée ---');

  egal(Engine.decompterJoursOuvrables('2026-08-10', '2026-08-14', PLANNING), 5,
    'décor : la semaine du 10 au 14 août ne compte que 5 jours — le samedi 15 ' +
    'est férié');

  window.App.aller('conges', { annee: 2026, mois: 8 }, true);
  await pause(300);

  assert(txt(corps).indexOf('Du 10 au 14 août') !== -1,
    '§16.8 : la période est listée en UNE ligne, avec ses vraies bornes');
  assert(txt(corps).indexOf('Une semaine complète compte 6 jours') !== -1,
    '§16.8 : la phrase du décompte est là');
  assert(txt(corps).indexOf('15 août') !== -1,
    'B2 : LE SAMEDI FÉRIÉ EST NOMMÉ — sans lui, l’écran affiche « 5 j » sous ' +
    '« une semaine complète compte 6 jours » et rien ne l’explique');
  assert(txt(corps).indexOf('ne compte pas') !== -1,
    'B2 : et la phrase dit qu’il ne compte pas');

  /* ==================================================================== */
  /* §16.2 — AUCUNE ADRESSE E-MAIL SUR LE DOCUMENT                        */
  /* ==================================================================== */
  console.log('\n--- §16.2 : la signature du document ---');

  window.App.aller('document', { contratId: 'c-alpha', annee: 2026, mois: 6 });
  await pause(300);

  assert(txt(corps).indexOf('maria@exemple.test') === -1,
    'A1 : aucune adresse e-mail nulle part sur le document');
  assert(txt(corps).indexOf('Établi par votre assistante maternelle') !== -1,
    'A1 : sans nom saisi, le document le dit ainsi');
  assert(!!boutonExact(corps, 'Renseigner mon nom'),
    '§16.2 : et l’encart actionnable mène à la saisie');
  assert(txt(corps).indexOf('Récapitulatif d’Alpha') !== -1,
    'C2 : le titre du document élide — « Récapitulatif d’Alpha », pas « de Alpha »');

  /* ==================================================================== */
  /* §16.3 — CE QUE DIT LA CLÔTURE                                        */
  /* ==================================================================== */
  console.log('\n--- §16.3 : la clôture est réversible ---');

  assert(txt(corps).indexOf('plus aucune modification n’est possible') === -1,
    'A1 : l’écran n’affirme plus qu’une clôture est définitive');

  /* Le mois de juin porte une répartition écartée : la clôture doit être
     refusée, et l’écran doit dire quoi corriger (§16.1 c). */
  assert(txt(corps).indexOf('Corrigez d’abord la répartition') !== -1,
    'A4 : la clôture est bloquée, avec la phrase qui dit quoi corriger');
  assert(!boutonExact(corps, 'Clôturer le mois'),
    'A4 : et le bouton de clôture n’est pas offert');

  /* ==================================================================== */
  /* §16.4 — LA LIGNE DE MENU N'EST PLUS FIGÉE                            */
  /* ==================================================================== */
  console.log('\n--- §16.4 : le menu ---');

  window.App.aller('menu', {}, true);
  await pause(300);

  assert(txt(corps).indexOf('Chargement…') === -1,
    '§16.4 : aucune ligne ne reste sur « Chargement… »');
  assert(txt(corps).indexOf('Le 25, puis chaque jour') !== -1,
    '§16.4 : la ligne des rappels affiche son VRAI réglage, lu en base');
  assert(!!parTexte(corps, '.menu', 'Mon nom sur les documents'),
    '§16.2 : le Menu propose la saisie du nom');
  assert(txt(corps).indexOf('Papillon') !== -1,
    '§16.4 : et la ligne des familles est bien renseignée, elle aussi');

  /* ==================================================================== */
  console.log('');
  if (echecs) { console.error(echecs + ' échec(s).'); process.exit(1); }
  console.log('Tout est conforme.');
})().catch(function (e) {
  console.error('ERREUR', e && e.stack ? e.stack : e);
  process.exit(1);
});
