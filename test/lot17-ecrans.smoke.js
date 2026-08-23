/* ============================================================================
   Test de fumée — LOT 17, LES ÉCRANS RENDUS.

   POURQUOI CE FICHIER EXISTE.

   C'est la règle tirée de la relecture du lot 16, et elle n'a pas d'exception :
   TOUT ÉCRAN LIVRÉ DOIT ÊTRE RENDU PAR UN TEST QUI CLIQUE. Les deux anomalies
   bloquantes du lot 16 étaient des défauts de comportement — une feuille qui
   annonçait le mauvais nombre de jours, une phrase qui restait muette — et
   aucune recherche de chaîne dans un fichier `.js` ne pouvait les voir.

   Le lot 17 livre quatre écrans neufs. Ce fichier les monte pour de vrai — le
   vrai `index.html`, le vrai moteur, la vraie chaîne — et lit ce qui s'affiche :

     §17.5  déclarer ce qui s'est passé une journée, et l'effet chiffré ;
     §17.6  choisir où se déduisent les minutes rendues ;
     §17.4  la frise des conditions et « Faire un avenant » ;
     §17.8  le solde de fin de contrat et l'indemnité de rupture.

   Il complète `lot17-differentiel.test.js` (le moteur n'a pas bougé) et
   `lot17-temps.test.js` (les règles nouvelles), qui ne rendent aucun écran.

   Lancement : node test/lot17-ecrans.smoke.js
   ========================================================================= */
'use strict';

var fs = require('fs');
var path = require('path');
var JSDOM = require('jsdom').JSDOM;
var Decor = require('./decor-avenants.js');

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
function txt(el) { return el ? String(el.textContent).replace(/ /g, ' ') : ''; }
function sansInsecable(t) { return String(t).replace(/ /g, ' '); }
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
function selectApresLibelle(racineEl, libelle) {
  var bloc = Array.prototype.filter.call(racineEl.querySelectorAll('.fld'), function (f) {
    var lb = f.querySelector('.lb');
    return lb && txt(lb).indexOf(libelle) !== -1;
  })[0];
  return bloc ? bloc.querySelector('select') : null;
}
function choisir(sel, valeur) {
  sel.value = valeur;
  sel.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
}
/* Le champ d'heure à la minute (`<input type="time">`) qui suit un libellé. */
function champHeureDe(racineEl, libelle) {
  var bloc = Array.prototype.filter.call(racineEl.querySelectorAll('.fld'), function (f) {
    var lb = f.querySelector('.lb');
    return lb && txt(lb).indexOf(libelle) !== -1;
  })[0];
  return bloc ? bloc.querySelector('input') : null;
}
function poserHeure(input, valeur) {
  input.value = valeur;
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
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
var LEA = {
  id: 'c-lea', prenom_enfant: 'Léa', famille_id: 'f1',
  famille: { id: 'f1', nom: 'Papillon' },
  date_debut: '2024-09-01', date_fin: null,
  minutes_contractuelles: 540, minutes_sup_jour: 30, minutes_par_jour_conge: 540,
  entretien_centimes_jour: 500, jours_planning: PLANNING,
  heure_arrivee: '08:30:00', heure_depart: '17:30:00', statut: 'actif',
  sup_dues_si_enfant_absent: true, ordre_imputation: 'cp_puis_sup', archive: false,
  nom: null, genre: 'f', couleur: null, photo: null
};

/* Deux avenants : les conditions initiales, puis une revalorisation au
   1er mars 2026. C'est ce qui fait travailler la frise ET le §17.8 (une
   indemnité calculée sur deux périodes de conditions). */
var AVENANTS = [
  Decor.avenantDe(LEA, { id: 's1', date_effet: '2024-09-01',
    brut_mensuel_centimes: 130000, net_mensuel_centimes: 100000 }),
  Decor.avenantDe(LEA, { id: 's2', date_effet: '2026-03-01',
    brut_mensuel_centimes: 150000, net_mensuel_centimes: 115000 },
    { entretien_centimes_jour: 550 })
];
AVENANTS[0].numero = 1;
AVENANTS[1].numero = 2;
AVENANTS[0].reconstitue = true;

var ecritures = { journees: [], avenants: [] };

var DB = {
  getSession: function () {
    return Promise.resolve({ user: { id: 'u1', email: 'maria@exemple.test' } });
  },
  onAuthChange: function () {},
  signOut: function () { return Promise.resolve(true); },
  getEmettrice: function () { return Promise.resolve({ nom: 'Maria' }); },
  enregistrerEmettrice: function (nom) { return Promise.resolve({ nom: nom }); },
  getPreferenceRappel: function () { return Promise.resolve(null); },
  listContratsActifs: function () { return Promise.resolve([LEA]); },
  listContratsTous: function () { return Promise.resolve([LEA]); },
  listContratsPourMois: function () { return Promise.resolve([LEA]); },
  listContratsPourPeriode: function () { return Promise.resolve([LEA]); },
  listFamilles: function () { return Promise.resolve([LEA.famille]); },
  listFamillesToutes: function () { return Promise.resolve([LEA.famille]); },
  listFamillesAvecContrats: function () {
    return Promise.resolve([{ id: 'f1', nom: 'Papillon', archive: false, contrats: [LEA] }]);
  },
  contratEstVierge: function () { return Promise.resolve(false); },
  getAvenants: function () { return Promise.resolve(AVENANTS.slice()); },
  ajouterAvenant: function (id, champs) {
    ecritures.avenants.push({ contratId: id, champs: champs });
    return Promise.resolve(Decor.avenantDe(LEA, champs));
  },
  majAvenant: function (id, champs) {
    ecritures.avenants.push({ avenantId: id, champs: champs });
    return Promise.resolve(champs);
  },
  supprimerAvenant: function () { return Promise.resolve(true); },
  getCompteurInitial: function (id) {
    return Promise.resolve({ contrat_id: id, date_reference: '2024-09-01',
      minutes_sup: 0, minutes_cp_acquis: 0, minutes_cp_pris: 0 });
  },
  getJourneesMois: function () { return Promise.resolve({}); },
  getJourneesPeriode: function () { return Promise.resolve({}); },
  listImputations: function () { return Promise.resolve([]); },
  listImputationsPourMois: function () { return Promise.resolve([]); },
  supprimerImputation: function () { return Promise.resolve(true); },
  getNoteMensuelle: function () { return Promise.resolve(null); },
  enregistrerNoteMensuelle: function (c, a, m, t) { return Promise.resolve({ texte: t }); },
  listRecapsPeriode: function () { return Promise.resolve([]); },
  /* LOT 20 — les périodes de familiarisation (§20.2). Le décor les rend
     vides : ces écrans-là n'en ont aucune, et la fiche du contrat doit
     l'afficher comme telle plutôt que d'échouer. */
  listPeriodesFamiliarisation: function () { return Promise.resolve([]); },
  listPeriodesFamiliarisationContrat: function () { return Promise.resolve([]); },
  listRecapsContrat: function () { return Promise.resolve([]); },
  getRecap: function () { return Promise.resolve(null); },
  enregistrerJournee: function (l) { ecritures.journees.push(l); return Promise.resolve(l); },
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
require('../js/ui-familiarisation.js');
require('../js/ui-menu.js');
require('../js/ui-periode.js');
require('../js/app.js');

window.App.moisCourant = function () { return { annee: 2026, mois: 6 }; };
window.App.aujourdhui = function () { return '2026-06-30'; };

var corps = document.getElementById('corps');
var sheet = document.getElementById('sheet');

(async function () {
  document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  await pause(300);

  /* ==================================================================== */
  /* §17.5 — DÉCLARER CE QUI S'EST PASSÉ UNE JOURNÉE                      */
  /* ==================================================================== */
  console.log('\n--- §17.5 : Maria déclare, l’application ne devine rien ---');

  window.App.aller('enfant', { contratId: 'c-lea', annee: 2026, mois: 6 });
  await pause(300);

  /* Le lundi 8 juin 2026. */
  var jour8 = Array.prototype.filter.call(
    corps.querySelectorAll('table.cal td[role="button"]'), function (td) {
      return txt(td.querySelector('.num')) === '8';
    })[0];
  assert(!!jour8, 'décor : le lundi 8 juin est touchable');
  jour8.click();
  await pause(250);

  /* EXIGENCE CHANGÉE — LA FEUILLE DU JOUR EST REFAITE COMME LA MAQUETTE
     (retour d'Adrien du 23 août 2026). Ce qui change ici, assertion par
     assertion :
       - « la journée propose de déclarer un événement » portait sur le volet
         replié `<summary>Que s'est-il passé ce jour-là ?</summary>` : il
         n'existe plus. Les trois événements sont devenus les TROIS PREMIERS
         CHOIX de la liste unique, ce que l'assertion remplaçante exige.
       - « le choix de l'événement est offert » / « trois événements, plus
         rien à signaler » portaient sur un `<select>` : il n'y en a plus.
         « Rien à signaler » n'a plus à être une option — ne rien choisir,
         c'est déjà lui. Le contenu exigé, lui, est le même : trois événements
         et pas un quatrième.
       - « l'heure réelle est demandée » portait sur un sélecteur au quart
         d'heure. Le brief demande la minute près, et Adrien a tranché le
         23 août : un champ d'heure à la minute, sans raccourcis.
     AUCUNE assertion de comportement n'est affaiblie : la référence produite
     par le moteur, A3, le refus du départ anticipé du parent, le calcul de
     l'écart, la destination et ce qui part en base sont tous conservés. */
  assert(!parTexte(sheet, 'summary', 'Que s’est-il passé'),
    '§17.5 : l’ancien volet replié a disparu');
  var choixListe = sheet.querySelectorAll('.liste-choix .choice');
  assert(choixListe.length > 0, '§17.5 : la journée propose une liste de choix');

  /* LA RÉFÉRENCE EST DITE, et elle vient du moteur : fin d'accueil + minutes
     supplémentaires du contrat = 18h00. Un écran qui l'écrirait en dur serait
     faux le jour où un avenant déplace les horaires. */
  egal(Engine.heureDeReference(AVENANTS[1]), 18 * 60,
    'décor : la référence d’une journée vaut 18h00');
  /* EXIGENCE DÉPLACÉE, PAS AFFAIBLIE — la journée de référence était annoncée
     dans un volet permanent ; elle s'affiche maintenant sous le champ d'heure,
     donc une fois l'événement choisi. Elle vient toujours du moteur, et le
     test l'exige toujours : voir plus bas, après le choix. */

  /* A3 — SANS DÉCLARATION, RIEN NE CHANGE. C'est la règle la plus facile à
     perdre : elle est une ABSENCE. */
  assert(txt(sheet).indexOf('restent dues') !== -1,
    '§17.5 A3 : sans déclaration, les minutes restent dues — et l’écran le dit');
  assert(txt(sheet).indexOf('de lui-même n’est pas un événement') !== -1,
    '§17.5 A3 : un départ anticipé du parent est explicitement écarté');

  var libelles = Array.prototype.map.call(choixListe, function (x) {
    return txt(x.querySelector('.tx')).split('\n')[0].trim();
  });
  var evenements = libelles.filter(function (l) {
    return ['Un parent est venu en retard', 'J’ai libéré plus tôt',
            'J’ai demandé une arrivée plus tardive'].indexOf(l) !== -1;
  });
  egal(evenements.length, 3, '§17.5 : trois événements, et pas un quatrième');
  assert(libelles.indexOf('J’ai libéré plus tôt') !== -1,
    '§17.5 : « j’ai libéré plus tôt » est proposé');
  assert(!libelles.some(function (l) { return l.indexOf('parent est parti plus tôt') !== -1; }),
    '§17.5 A3 : aucun choix ne permet de déclarer un départ anticipé du parent');

  /* A2 — « J'ai libéré plus tôt », départ 17h00 : 30 − 60 = − 30 minutes. */
  var choixLib = parTexte(sheet, '.choice', 'J’ai libéré plus tôt');
  choixLib.click();
  await pause(120);
  var champHeure = champHeureDe(sheet, 'L’enfant est parti à');
  assert(!!champHeure, '§17.5 : l’heure réelle est demandée, à la minute près');
  egal(champHeure.getAttribute('type'), 'time',
    '§17.5 : c’est le champ d’heure à la minute, pas le sélecteur au quart d’heure');
  assert(!parTexte(sheet, 'button', '18h01') && !parTexte(sheet, 'button', '17h00'),
    'DÉCISION D’ADRIEN (23 août) : aucun raccourci d’heure — ils ne vaudraient ' +
    'que pour un contrat dont la journée finit à 18 h 00');
  assert(sansInsecable(txt(sheet)).indexOf('8h30 à 18h00') !== -1,
    '§17.5 : l’écran annonce la journée de référence, produite par le moteur');
  poserHeure(champHeure, '17:00');
  await pause(120);

  assert(sansInsecable(txt(sheet)).indexOf('Ce jour : -0h30') !== -1,
    '§17.5 A2 : l’écran annonce − 30 min pour ce jour (obtenu « ' +
    sansInsecable(txt(sheet.querySelector('.effet-heures'))) + ' »)');

  /* ==================================================================== */
  /* §17.6 — OÙ SE DÉDUISENT LES MINUTES RENDUES                          */
  /* ==================================================================== */
  console.log('\n--- §17.6 : le choix de la destination ---');

  var selDest = selectApresLibelle(sheet, 'se déduisent de');
  assert(!!selDest, '§17.6 : la destination est demandée, et seulement sur un écart négatif');
  var dests = Array.prototype.map.call(selDest.querySelectorAll('option'), function (o) {
    return txt(o);
  });
  egal(dests[0], 'Ma récupération',
    '§17.6 : la récupération est proposée EN PREMIER — c’est ce que Maria privilégie');
  egal(dests.length, 3, '§17.6 : récupération, congés payés, sans solde');

  /* Sur les congés payés : la retenue en euros disparaît, les congés payés
     sont annoncés à la place. */
  choisir(selDest, 'conges_payes');
  await pause(80);
  assert(sansInsecable(txt(sheet)).indexOf('retirées de vos congés payés') !== -1,
    '§17.6 : l’écran annonce ce que la déduction retire aux congés payés');

  /* LE CHOIX SURVIT À UN CHANGEMENT D'HEURE. Un sélecteur reconstruit à chaque
     passage remettrait « Ma récupération » sans rien dire — Maria choisirait
     ses congés payés et l'écran lui répondrait autre chose. */
  poserHeure(champHeureDe(sheet, 'L’enfant est parti à'), '16:30');
  await pause(120);
  egal(selectApresLibelle(sheet, 'se déduisent de').value, 'conges_payes',
    '§17.6 : le choix de destination survit à un changement d’heure');
  poserHeure(champHeureDe(sheet, 'L’enfant est parti à'), '17:00');
  await pause(120);

  /* Sans solde : la retenue en euros est affichée AVANT validation. */
  choisir(selectApresLibelle(sheet, 'se déduisent de'), 'sans_solde');
  await pause(80);
  var retenueAttendue = Engine.montantCentimes(150000, 60);
  assert(sansInsecable(txt(sheet)).indexOf(sansInsecable(window.Kit.eur(retenueAttendue))) !== -1,
    '§17.6 : la retenue en euros est chiffrée avant validation (attendue ' +
    sansInsecable(window.Kit.eur(retenueAttendue)) + ')');

  /* CE QUI PART EN BASE. Le signe est calculé, jamais saisi. */
  choisir(selectApresLibelle(sheet, 'se déduisent de'), 'recuperation');
  await pause(60);
  var bEnregistrer = parTexte(sheet, 'button', 'Enregistrer');
  assert(!!bEnregistrer && !bEnregistrer.disabled, '§17.5 : l’enregistrement est possible');
  bEnregistrer.click();
  await pause(250);

  var ecrit = ecritures.journees[ecritures.journees.length - 1];
  assert(!!ecrit, '§17.5 : une journée est écrite');
  egal(ecrit.ecart_minutes, -60,
    '§17.5 : l’écart part en base SIGNÉ — c’est le moteur qui l’a calculé');
  egal(ecrit.ecart_evenement, 'liberation_anticipee',
    '§17.5 : l’événement déclaré part avec lui — sans lui le chiffre serait ' +
    'inexplicable des mois plus tard');
  egal(ecrit.ecart_heure_reelle, '17:00', '§17.5 : et l’heure réelle aussi');
  egal(ecrit.ecart_impute_sur, 'recuperation', '§17.6 : la destination part en base');

  /* ==================================================================== */
  /* §17.4 — LA FICHE, LA FRISE, ET « FAIRE UN AVENANT »                  */
  /* ==================================================================== */
  console.log('\n--- §17.4 : les conditions datées ---');

  window.App.aller('fiche', { contratId: 'c-lea' });
  await pause(300);

  assert(txt(corps).indexOf('En vigueur depuis le 1 mars 2026') !== -1 ||
         txt(corps).indexOf('En vigueur depuis le') !== -1,
    '§17.4 : la fiche dit depuis quand les conditions s’appliquent');
  assert(txt(corps).indexOf('avenant n° 2') !== -1,
    '§17.4 : et quel avenant les porte (le 2, pas le 1)');
  /* Les conditions affichées sont celles de l'avenant EN VIGUEUR, pas celles
     de `contrat` : l'entretien vaut 5,50 € depuis mars, pas 5,00 €. */
  assert(sansInsecable(txt(corps)).indexOf('5,50 ') !== -1,
    '§17.4 : les conditions affichées sont celles de l’avenant en vigueur');

  var bFrise = boutonExact(corps, 'Voir l’historique des conditions');
  assert(!!bFrise, '§17.4 : le lien vers la frise');
  bFrise.click();
  await pause(200);

  assert(txt(sheet).indexOf('Avenant n° 2') !== -1 && txt(sheet).indexOf('Avenant n° 1') !== -1,
    '§17.4 : la frise montre les deux périodes');
  var positionDe2 = txt(sheet).indexOf('Avenant n° 2');
  var positionDe1 = txt(sheet).indexOf('Avenant n° 1');
  assert(positionDe2 < positionDe1,
    '§17.4 : du plus récent au plus ancien');
  assert(txt(sheet).indexOf('reconstitu') !== -1,
    '§17.4 : la plus ancienne porte la mention « reconstituées »');
  assert(txt(sheet).indexOf('Entretien par jour de présence') !== -1,
    '§17.4 : et ce qui a changé est dit en clair');
  assert(sansInsecable(txt(sheet)).indexOf('5,00 € → 5,50 €') !== -1,
    '§17.4 : avec l’avant et l’après (obtenu sans la flèche attendue)');

  window.Kit.fermerFeuille();
  await pause(120);

  var bAvenant = boutonExact(corps, 'Faire un avenant');
  assert(!!bAvenant, '§17.4 : le bouton s’appelle « Faire un avenant »');
  bAvenant.click();
  await pause(250);

  /* LE BOUTON DIT CE QU'IL FAIT. */
  var bFaire = parTexte(sheet, 'button', 'Faire l’avenant au 1er');
  assert(!!bFaire, '§17.4 : le bouton dit ce qu’il fait et à quelle date (obtenu « ' +
    (bFaire ? txt(bFaire) : txt(parTexte(sheet, 'button', 'avenant'))) + ' »)');
  assert(txt(sheet).indexOf('ne changeront pas') !== -1,
    '§17.4 : ce qui NE changera pas est dit sous le champ de date');

  /* LES ONZE RÉGLAGES sont saisissables (A1). */
  ['Jours de garde', 'Début d’accueil', 'Fin d’accueil',
   'Journée d’accueil prévue au contrat', 'Minutes supplémentaires par jour',
   'Ce que consomme un jour de congé', 'Indemnité d’entretien par jour de présence',
   'Minutes supplémentaires dues quand l’enfant est absent',
   'Vos congés se prennent d’abord sur', 'Salaire brut mensuel', 'Salaire net mensuel']
    .forEach(function (libelle) {
      assert(!!parTexte(sheet, '.lb', libelle),
        '§17.4 A1 : « ' + libelle +' » est saisissable');
    });

  /* L'ENCART D'EFFET, REJOUÉ PAR LE MOTEUR. */
  await pause(400);
  assert(txt(sheet).indexOf('Effet sur') !== -1 || txt(sheet).indexOf('Rien ne change') !== -1,
    '§17.4 : l’effet sur le premier mois concerné est annoncé');

  /* On modifie l'entretien et on enregistre : ce qui part en base doit porter
     les ONZE réglages, pas seulement celui qu'on a touché. */
  var champEntretien = Array.prototype.filter.call(sheet.querySelectorAll('.fld'), function (f) {
    var lb = f.querySelector('.lb');
    return lb && txt(lb).indexOf('Indemnité d’entretien') !== -1;
  })[0].querySelector('input');
  champEntretien.value = '6,00';
  champEntretien.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await pause(300);

  parTexte(sheet, 'button', 'Faire l’avenant au 1er').click();
  await pause(300);

  var pose = ecritures.avenants[ecritures.avenants.length - 1];
  assert(!!pose, '§17.4 : l’avenant part en base');
  egal(pose.champs.entretien_centimes_jour, 600, '§17.4 : avec la valeur saisie');
  egal(pose.champs.date_effet.slice(8, 10), '01',
    '§17.4 : sa date d’effet est TOUJOURS un 1er de mois');
  ['jours_planning', 'heure_arrivee', 'heure_depart', 'minutes_contractuelles',
   'minutes_sup_jour', 'minutes_par_jour_conge', 'entretien_centimes_jour',
   'sup_dues_si_enfant_absent', 'ordre_imputation',
   'brut_mensuel_centimes', 'net_mensuel_centimes'].forEach(function (champ) {
    assert(pose.champs[champ] !== undefined,
      '§17.4 : l’avenant porte « ' + champ + ' » — un avenant partiel ne veut rien dire');
  });
  egal(pose.champs.minutes_sup_jour, 30,
    '§17.4 : les réglages non touchés sont REPRIS, pas remis au défaut');

  /* ==================================================================== */
  /* §17.8 — LE SOLDE DE FIN DE CONTRAT                                   */
  /* ==================================================================== */
  console.log('\n--- §17.8 : la fin de contrat et l’indemnité de rupture ---');

  window.App.aller('fiche', { contratId: 'c-lea', section: 'fin' });
  await pause(300);

  var bCalcul = parTexte(corps, 'button', 'Calculer les soldes');
  assert(!!bCalcul, '§17.8 : le bouton de calcul est offert');

  /* LE RÉSULTAT S'AFFICHE SOUS LE BOUTON. Sur un téléphone, au-dessus, il
     apparaissait hors de l'écran : Maria appuyait et ne voyait rien. */
  var boutons = Array.prototype.slice.call(corps.querySelectorAll('button'));
  bCalcul.click();
  await pause(600);

  var pane = parTexte(corps, '.pane', 'Soldes au');
  assert(!!pane, '§17.8 : les soldes s’affichent');
  if (pane) {
    var position = bCalcul.compareDocumentPosition(pane);
    assert((position & dom.window.Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
      '§17.8 : le résultat est SOUS le bouton qui le calcule');
  }

  /* LES CONGÉS PAYÉS AVANT LA RÉCUPÉRATION. */
  var t = txt(pane);
  assert(t.indexOf('Congés payés restants') < t.indexOf('Récupération restante'),
    '§17.8 : les congés payés passent avant la récupération');

  /* LA LIGNE DE TOTAL — le chiffre que Maria annonce aux parents. */
  assert(!!parTexte(corps, '.pane', 'À régler en plus du dernier mois'),
    '§17.8 : la ligne de total existe');

  /* L'INDEMNITÉ DE RUPTURE, avec son détail. */
  var pi = parTexte(corps, '.pane', 'Indemnité de rupture');
  assert(!!pi, '§17.8 : l’indemnité de rupture est calculée');
  assert(txt(pi).indexOf('Ancienneté') !== -1, '§17.8 : l’ancienneté est dite');
  assert(txt(pi).indexOf('1/80') !== -1, '§17.8 : la formule est nommée');
  assert(txt(pi).indexOf('périodes de conditions') !== -1,
    '§17.8 : le nombre de périodes de conditions est dit');
  assert(!!parTexte(corps, 'button', 'Voir le détail par période'),
    '§17.8 : le détail par période est accessible');

  /* Le chiffre est celui du moteur, pas un chiffre recomposé ici. */
  parTexte(corps, 'button', 'Voir le détail par période').click();
  await pause(250);
  assert(txt(sheet).indexOf('Avenant n° 1') !== -1 && txt(sheet).indexOf('Avenant n° 2') !== -1,
    '§17.8 : le détail montre chaque période de conditions');
  assert(txt(sheet).indexOf('n’entrent PAS dans ce total') !== -1,
    '§17.8 : le point d’assiette non tranché est dit à l’écran');

  console.log('\n' + (echecs === 0 ? 'Tout est conforme.' : echecs + ' échec(s).'));
  process.exit(echecs === 0 ? 0 : 1);
})().catch(function (e) {
  console.error('Erreur pendant le parcours :', e);
  process.exit(1);
});
