/* ============================================================================
   Test de fumée — LES CORRECTIONS DE LA RELECTURE DU LOT 17.

   POURQUOI CE FICHIER EXISTE.

   Cinq anomalies bloquantes, dont une qui rendait la fonction centrale du lot
   inutilisable en production. Aucune n'avait de test, et chacune est passée à
   travers 1 039 assertions pour une raison précise, qu'il faut nommer :

     - B1 : les quinze tests de fumée remplacent `DB` par un double qui accepte
       tout. Aucun ne confrontait le corps d'une requête au schéma. C'est
       désormais `test/ecriture-vs-schema.test.js`.
     - B2, B3 : les défauts n'apparaissent que sur un ÉCHEC de lecture ou sur
       un ENCHAÎNEMENT de deux écrans. Aucun test ne mettait une lecture en
       échec, ni n'ouvrait deux écrans à la suite.
     - B4, B5 : les écrans étaient rendus, mais on ne lisait jamais le CHIFFRE
       affiché — seulement la présence des libellés.

   Ce fichier ne fait que ça : il met des lectures en échec, il enchaîne des
   écrans, et il lit des montants.

   Lancement : node test/lot17-correctifs.smoke.js
   ========================================================================= */
'use strict';
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
global.Blob = dom.window.Blob;

var echecs = 0;
function assert(cond, msg) {
  if (!cond) { echecs++; console.error('FAIL ' + msg); } else { console.log('ok   ' + msg); }
}
function egal(obtenu, attendu, msg) {
  assert(obtenu === attendu, msg + ' (attendu ' + JSON.stringify(attendu) +
    ', obtenu ' + JSON.stringify(obtenu) + ')');
}
function pause(ms) { return new Promise(function (r) { setTimeout(r, ms || 60); }); }
function txt(el) { return el ? String(el.textContent).replace(/[\u00a0\u202f]/g, ' ') : ''; }
/* LOT 24 (§24.3) — le séparateur de milliers est une espace FINE insécable.
   `txt` normalise déjà les deux espaces invisibles du rendu ; un montant
   attendu doit passer par le même filtre, sinon on compare « 1 142,00 € »
   normalisé à « 1 142,00 € » qui ne l'est pas. Harnais, pas assertion. */
function eurN(centimes) { return String(window.Kit.eur(centimes)).replace(/[\u00a0\u202f]/g, ' '); }
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

/* --- Décor. Valeurs FICTIVES et rondes : le dépôt est PUBLIC. -----------
   Le contrat ouvre le 16 mars 2026 : mars n'est donc PAS entièrement couvert,
   et c'est le cas du §17.7 — celui sur lequel B4 se voit. */
var ALPHA = {
  id: 'c-alpha', prenom_enfant: 'Alpha', famille_id: 'f1',
  famille: { id: 'f1', nom: 'Papillon' },
  date_debut: '2026-03-16', date_fin: null,
  minutes_contractuelles: 540, minutes_sup_jour: 30, minutes_par_jour_conge: 540,
  entretien_centimes_jour: 500, jours_planning: [1, 2, 3, 4, 5],
  heure_arrivee: '08:30', heure_depart: '17:30', statut: 'actif',
  sup_dues_si_enfant_absent: true, ordre_imputation: 'cp_puis_sup', archive: false,
  nom: 'Un', genre: 'f', couleur: null, photo: null
};

var CONGE_JUIN = {};
['2026-06-15', '2026-06-16', '2026-06-17', '2026-06-18', '2026-06-19'].forEach(function (d) {
  CONGE_JUIN[d] = { id: 'j-' + d, contrat_id: 'c-alpha', jour: d, type: 'conge_maria',
    minutes_reelles: null, entretien_centimes: null, commentaire: null,
    minutes_sup_exceptionnelles: 0, minutes_sup_renoncees: 0, sup_dues_override: null };
});

var etatDecor = {
  congeEnJuin: false,
  recapsEnEchec: false,      // B2 : la lecture des récapitulatifs échoue-t-elle ?
  supDepart: 0,              // B5 : récupération de départ, éventuellement négative
  avenantsEcrits: []
};

var DB = {
  getSession: function () {
    return Promise.resolve({ user: { id: 'u1', email: 'maria@exemple.test' } });
  },
  onAuthChange: function () {},
  signOut: function () { return Promise.resolve(true); },
  getEmettrice: function () { return Promise.resolve({ nom: 'Maria' }); },
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
  majContrat: function (id, champs) { return Promise.resolve(champs); },
  getAvenants: function (id) {
    return Promise.resolve(Decor.avenantsDe(ALPHA,
      [{ id: 's1', contrat_id: id, date_effet: '2026-03-01',
         brut_mensuel_centimes: 100000, net_mensuel_centimes: 78000 }]));
  },
  ajouterAvenant: function (contratId, champs) {
    /* Le double N'INVENTE PAS de numéro : depuis la migration 015 c'est la
       base qui le pose. Le test qui vérifie que la base l'exige vraiment est
       `ecriture-vs-schema.test.js` ; celui-ci vérifie le chemin d'écran. */
    etatDecor.avenantsEcrits.push({ contratId: contratId, champs: champs });
    return Promise.resolve({ id: 'av-neuf', contrat_id: contratId, numero: 2, champs: champs });
  },
  majAvenant: function (id, champs) { return Promise.resolve({ id: id }); },
  supprimerAvenant: function () { return Promise.resolve(true); },
  getCompteurInitial: function (id) {
    return Promise.resolve({ contrat_id: id, date_reference: '2026-03-01',
      minutes_sup: etatDecor.supDepart, minutes_cp_acquis: 0, minutes_cp_pris: 0 });
  },
  /* Une semaine de congé posée du 15 au 19 juin : c'est elle qui rend
     l'encart RG-06 utile, et qui permet de vérifier qu'il est bien là quand il
     explique un chiffre que la famille a sous les yeux. */
  getJourneesMois: function (id, a, m) {
    if (etatDecor.congeEnJuin && a === 2026 && m === 6) return Promise.resolve(CONGE_JUIN);
    return Promise.resolve({});
  },
  getJourneesPeriode: function () {
    if (etatDecor.congeEnJuin) return Promise.resolve({ '2026-06': CONGE_JUIN });
    return Promise.resolve({});
  },
  listImputations: function () { return Promise.resolve([]); },
  listImputationsPourMois: function () { return Promise.resolve([]); },
  majVentilationImputation: function () { return Promise.resolve({}); },
  supprimerImputation: function () { return Promise.resolve(true); },
  getNoteMensuelle: function () { return Promise.resolve(null); },
  enregistrerNoteMensuelle: function (c, a, m, t) { return Promise.resolve({ texte: t }); },
  listRecapsPeriode: function () { return Promise.resolve([]); },
  /* LOT 20 — les périodes de familiarisation (§20.2). Le décor les rend
     vides : ces écrans-là n'en ont aucune, et la fiche du contrat doit
     l'afficher comme telle plutôt que d'échouer. */
  listPeriodesFamiliarisation: function () { return Promise.resolve([]); },
  listPeriodesFamiliarisationContrat: function () { return Promise.resolve([]); },
  listRecapsContrat: function () {
    /* B2 — LA LECTURE QUI PEUT ÉCHOUER. C'est la source unique des trois
       garde-fous du §17.4. */
    if (etatDecor.recapsEnEchec) return Promise.reject(new Error('Failed to fetch'));
    return Promise.resolve([]);
  },
  getRecap: function () { return Promise.resolve(null); },
  enregistrerJournee: function (l) { return Promise.resolve(l); },
  supprimerJournee: function () { return Promise.resolve(true); },
  marquerJournees: function () { return Promise.resolve([]); },
  supprimerJournees: function () { return Promise.resolve(true); },
  poserAbsenceMaria: function () { return Promise.resolve([]); },
  retirerAbsenceMaria: function () { return Promise.resolve(true); },
  enregistrerImputation: function (i) { return Promise.resolve(i); },
  recloturerRecap: function () { return Promise.resolve({ id: 'x', statut: 'fige' }); },
  figerRecap: function () { return Promise.resolve({ id: 'x', statut: 'fige' }); }
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
require('../js/ui-familiarisation.js');
require('../js/ui-menu.js');
require('../js/ui-periode.js');
require('../js/app.js');

window.App.moisCourant = function () { return { annee: 2026, mois: 6 }; };
window.App.aujourdhui = function () { return '2026-06-15'; };

var corps = document.getElementById('corps');
var sheet = document.getElementById('sheet');

(async function () {
  document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  await pause(300);

  /* ==================================================================== */
  /* B4 — LE NET AFFICHÉ EST LE NET DÛ, SUR TOUS LES ÉCRANS               */
  /* ==================================================================== */
  console.log('\n--- B4 : le salaire du mois est celui qui est dû ---');

  /* Mars 2026 : le contrat ouvre le 16. Les jours travaillés du mois complet
     sont ceux du planning ; ceux couverts partent du 16. Le moteur donne le
     quotient — le test ne le réécrit pas. */
  var avenants = await DB.getAvenants('c-alpha');
  var conditions = Engine.conditionsApplicables(avenants, 2026, 3);
  var rMars = Engine.calculerMois({
    contrat: ALPHA, conditions: conditions, annee: 2026, mois: 3, journees: [],
    compteurEntree: { minutesSup: 0, minutesCpAcquis: 0, minutesCpPris: 0 }
  });
  assert(rMars.prorata && rMars.prorata.applique,
    'décor : mars 2026 est bien un mois partiel (' +
    rMars.prorata.joursCouverts + ' jours sur ' + rMars.prorata.joursDuMois + ')');
  assert(rMars.salaireNetProrataCentimes < rMars.salaireNetCentimes,
    'décor : le net proratisé est inférieur au net contractuel');

  window.App.aller('enfant', { contratId: 'c-alpha', annee: 2026, mois: 3 }, true);
  await pause(350);

  /* LOT 25 §25.3 — les panneaux `.pane` de l'espace enfant sont devenus des
     replis `.fold`, et leurs titres ont perdu ce que la barre haute dit déjà :
     « Le mois de mars » -> « Le mois », « Réserves de Alpha » -> « Réserves ».
     Les LIGNES, elles, sont les mêmes — c'est ce que ce fichier vérifie. Une
     nuance de casse : « Mois partiel — n jours… » était une ligne à part
     entière ; c'est maintenant le SOUS-TEXTE de la ligne « Salaire net »,
     donc « mois partiel — n jours… », attaché au montant qu'il explique.
     L'exigence ne bouge pas : un montant proratisé ne s'affiche jamais sans
     son quotient, et il est désormais impossible de lire l'un sans l'autre. */
  var pMois = parTexte(corps, '.fold', 'Le mois');
  assert(!!pMois, 'l’espace enfant affiche le repli du mois');
  assert(txt(pMois).indexOf(eurN(rMars.salaireNetProrataCentimes)) !== -1,
    'B4 : l’espace enfant affiche le net PRORATISÉ (' +
    window.Kit.eur(rMars.salaireNetProrataCentimes) + ')');
  assert(txt(pMois).indexOf(eurN(rMars.salaireNetCentimes)) === -1,
    'B4 : et plus le net contractuel (' + window.Kit.eur(rMars.salaireNetCentimes) + ')');
  assert(txt(pMois).toLowerCase().indexOf('mois partiel') !== -1,
    'B4 : le quotient est dit — un montant proratisé sans son quotient est indéfendable');

  /* Le document, lui, ne régresse pas. */
  window.App.aller('document', { contratId: 'c-alpha', annee: 2026, mois: 3 }, true);
  await pause(350);
  assert(txt(corps).indexOf(eurN(rMars.salaireNetProrataCentimes)) !== -1,
    'B4 : le document remis à la famille porte le MÊME net que l’espace enfant');

  /* La fin de mois guidée : c'est l'écran qui précède la clôture. */
  window.App.aller('finDeMois', { liste: [{ contrat: ALPHA, annee: 2026, mois: 3 }] }, true);
  await pause(400);
  assert(txt(corps).indexOf(eurN(rMars.salaireNetProrataCentimes)) !== -1,
    'B4 : la fin de mois guidée annonce le net dû, pas un montant que le document ' +
    'contredira dix secondes plus tard');
  assert(txt(corps).indexOf('Mois partiel') !== -1,
    'B4 : avec son quotient, là aussi');

  /* ==================================================================== */
  /* L'ENCART RG-06 — DÉCISION D'ADRIEN DU 19 AOÛT 2026                   */
  /*                                                                     */
  /* ÉCART ASSUMÉ À LA SPÉCIFICATION. Le §A.3 range « l'encart figure sur */
  /* TOUS les documents » parmi les six qualités à ne pas casser. La      */
  /* décision le restreint aux mois qui portent des congés : sur un mois  */
  /* sans aucun congé, il explique une règle que le document n'applique   */
  /* nulle part.                                                          */
  /*                                                                     */
  /* Ces quatre assertions sont la contrepartie de l'écart : là où il     */
  /* SERT, il doit être là — à l'écran ET dans le texte qui part chez la  */
  /* famille.                                                             */
  /* ==================================================================== */
  console.log('\n--- Encart RG-06 : absent sans congé, présent avec ---');

  etatDecor.congeEnJuin = false;
  window.App.invalider();
  window.App.aller('document', { contratId: 'c-alpha', annee: 2026, mois: 5 }, true);
  await pause(400);
  assert(txt(corps).indexOf('Décompte des congés') === -1,
    'un mois SANS congé ne porte plus l’encart');

  etatDecor.congeEnJuin = true;
  window.App.invalider();
  window.App.aller('document', { contratId: 'c-alpha', annee: 2026, mois: 6 }, true);
  await pause(450);
  assert(txt(corps).indexOf('Décompte des congés') !== -1,
    'un mois AVEC congés le porte — c’est là qu’il éteint le litige');
  /* EXIGENCE CHANGÉE — LA RÈGLE DES CINQ SAMEDIS (specs du 24 août 2026, §6).
     « Une semaine complète compte donc 6 jours » devient faux le jour du
     déploiement. L'assertion garde son objet — l'encart énonce RG-06 mot pour
     mot sur le document remis à la famille — et exige EN PLUS que ce mot pour
     mot vienne de la constante partagée (§6.3, critère A12). */
  assert(txt(corps).indexOf(window.Kit.ENCART_RG06) !== -1,
    'et il énonce RG-06 mot pour mot, depuis la constante partagée');
  assert(txt(corps).indexOf('règle dite des cinq samedis') !== -1,
    'et la règle nommée est bien celle des cinq samedis');

  /* Le TEXTE À COLLER doit dire la même chose que le document : c'est lui qui
     part chez la famille. Les faire diverger serait pire que les vider tous
     les deux. */
  var apercuTexte = corps.querySelector('.apercu-texte');
  assert(!!apercuTexte && txt(apercuTexte).indexOf('Décompte des congés') !== -1,
    'le texte à coller porte le même encart que le document');

  etatDecor.congeEnJuin = false;
  window.App.invalider();

  /* ==================================================================== */
  /* B2 — LE GARDE-FOU DE LA RÉTROACTIVITÉ ÉCHOUE FERMÉ                   */
  /* ==================================================================== */
  console.log('\n--- B2 : une lecture ratée REFUSE, elle n’autorise pas ---');

  etatDecor.recapsEnEchec = false;
  window.App.invalider();
  window.App.aller('fiche', { contratId: 'c-alpha' }, true);
  await pause(400);
  assert(!!boutonExact(corps, 'Faire un avenant'),
    'décor : lecture OK — « Faire un avenant » est proposé');

  etatDecor.recapsEnEchec = true;
  window.App.invalider();
  window.App.aller('fiche', { contratId: 'c-alpha' }, true);
  await pause(400);
  assert(!boutonExact(corps, 'Faire un avenant'),
    'B2 : lecture EN ÉCHEC — l’avenant n’est plus proposé du tout');
  assert(txt(corps).indexOf('Impossible de vérifier les mois déjà clôturés') !== -1,
    'B2 : et le refus dit ce qui manque');
  assert(txt(corps).indexOf('Réessayez une fois le réseau revenu') !== -1,
    'B2 : il ne laisse pas croire à une interdiction définitive');
  assert(txt(corps).indexOf('déjà remis à une famille') !== -1,
    'B2 : il dit POURQUOI — c’est ce qui rend le refus acceptable');

  /* La frise porte la même garde : ni correction ni suppression à l’aveugle. */
  var bFrise = boutonExact(corps, 'Voir l’historique') || parTexte(corps, 'button', 'historique');
  if (bFrise) {
    bFrise.click();
    await pause(300);
    assert(!boutonExact(sheet, 'Corriger cet avenant'),
      'B2 : la frise non plus ne propose pas de corriger un avenant à l’aveugle');
    assert(txt(sheet).indexOf('Impossible de vérifier') !== -1,
      'B2 : et elle dit pourquoi');
    window.Kit.fermerFeuille();
    await pause(120);
  }
  etatDecor.recapsEnEchec = false;
  window.App.invalider();

  /* ==================================================================== */
  /* B3 — LE CACHE DE LA CHAÎNE NE MÉLANGE PLUS DEUX CONTRATS             */
  /* ==================================================================== */
  console.log('\n--- B3 : une date de fin simulée ne pollue pas le contrat réel ---');

  var reel = { annee: 2026, mois: 6 };
  var chaineReelle = await window.App.serie(ALPHA, reel);
  var juinReel = window.App.moisDe(chaineReelle, 2026, 6);
  assert(!!juinReel, 'décor : juin se calcule pour le contrat réel');

  /* L'écran de fin de contrat copie le contrat et y pose une date de fin. */
  var simule = {};
  Object.keys(ALPHA).forEach(function (k) { simule[k] = ALPHA[k]; });
  simule.date_fin = '2026-06-04';
  var chaineSimulee = await window.App.serie(simule, reel);
  var juinSimule = window.App.moisDe(chaineSimulee, 2026, 6);

  assert(juinSimule.resultat.joursPresence < juinReel.resultat.joursPresence,
    'B3 : la simulation au 4 juin compte MOINS de jours que le mois entier (' +
    juinSimule.resultat.joursPresence + ' contre ' + juinReel.resultat.joursPresence + ')');

  /* LE POINT QUI COMPTE : redemander la chaîne du contrat RÉEL doit rendre le
     mois entier. Avant la correction, la chaîne simulée restait en cache sous
     la clé du contrat réel, et l'espace de l'enfant affichait un mois amputé —
     que la clôture aurait figé pour toujours. */
  var chaineApres = await window.App.serie(ALPHA, reel);
  var juinApres = window.App.moisDe(chaineApres, 2026, 6);
  egal(juinApres.resultat.joursPresence, juinReel.resultat.joursPresence,
    'B3 : le contrat réel retrouve SON mois entier après une simulation');
  egal(juinApres.resultat.totalAVerserCentimes, juinReel.resultat.totalAVerserCentimes,
    'B3 : et son total à verser — c’est ce chiffre qu’une clôture aurait figé');

  /* Et recalculer avec une AUTRE date de fin ne rend pas la première. */
  var simule2 = {};
  Object.keys(ALPHA).forEach(function (k) { simule2[k] = ALPHA[k]; });
  simule2.date_fin = '2026-06-25';
  var juin25 = window.App.moisDe(await window.App.serie(simule2, reel), 2026, 6);
  assert(juin25.resultat.joursPresence > juinSimule.resultat.joursPresence,
    'B3 : corriger la date et recalculer donne les chiffres de la NOUVELLE date (' +
    juin25.resultat.joursPresence + ' contre ' + juinSimule.resultat.joursPresence + ')');

  /* ==================================================================== */
  /* B5 — UN COMPTEUR NÉGATIF SE VOIT                                     */
  /* ==================================================================== */
  console.log('\n--- B5 : le compteur de récupération négatif est dit ---');

  etatDecor.supDepart = -540;               // Maria doit 9 h
  window.App.invalider();
  window.App.aller('enfant', { contratId: 'c-alpha', annee: 2026, mois: 3 }, true);
  await pause(400);

  var pRes = parTexte(corps, '.fold', 'Réserves');
  assert(!!pRes, 'le repli des réserves est là');
  assert(txt(pRes).indexOf('0h00') === -1,
    'B5 : il n’affiche plus « 0h00 » sur un compteur négatif');
  assert(txt(pRes).indexOf('− 9h00') !== -1 || txt(pRes).indexOf('−') !== -1,
    'B5 : le solde est affiché avec son signe (obtenu « ' +
    txt(pRes).replace(/\s+/g, ' ').slice(0, 120) + ' »)');
  assert(txt(pRes).indexOf('Vous devez ce temps') !== -1,
    'B5 : et l’écran dit ce que ça veut dire');

  /* L'avertissement de fin de contrat, jusqu'ici structurellement
     inatteignable, doit maintenant s'afficher.

     La date du jour est ramenée au 20 mars : le contrat n'a alors accumulé que
     quelques journées de récupération, et le solde reste négatif. Plus tard
     dans l'année il redeviendrait positif — ce qui est le comportement normal,
     et pas ce qu'on teste ici. */
  window.App.aujourdhui = function () { return '2026-03-20'; };
  window.App.moisCourant = function () { return { annee: 2026, mois: 3 }; };
  window.App.invalider();
  window.App.aller('fiche', { contratId: 'c-alpha', section: 'fin' }, true);
  await pause(400);
  var bSoldes = boutonExact(corps, 'Calculer les soldes de fin de contrat');
  assert(!!bSoldes, 'l’écran de fin de contrat s’ouvre');
  bSoldes.click();
  await pause(500);
  assert(txt(corps).indexOf('Votre compteur de récupération est négatif') !== -1,
    'B5 : l’avertissement de fin de contrat s’affiche enfin — sa condition était ' +
    'structurellement inatteignable');
  assert(txt(corps).indexOf('n’est PAS déduit') !== -1,
    'B5 : et il dit que la règle n’est pas tranchée, au lieu de trancher');
  assert(txt(corps).indexOf('À régler en plus du dernier mois') !== -1,
    'C1 : le total de fin de contrat est bien affiché');

  etatDecor.supDepart = 0;
  window.App.invalider();

  /* ==================================================================== */
  console.log('');
  if (echecs) { console.error(echecs + ' échec(s).'); process.exit(1); }
  console.log('Tout est conforme.');
})().catch(function (e) {
  console.error('ERREUR', e && e.stack ? e.stack : e);
  process.exit(1);
});
