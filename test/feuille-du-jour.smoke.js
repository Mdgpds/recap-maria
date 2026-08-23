/* ============================================================================
   Test de fumée — LA FEUILLE DU JOUR REFAITE COMME LA MAQUETTE.

   POURQUOI CE FICHIER EXISTE.

   Retour d'Adrien du 23 août 2026, sur capture de la production : « trop de
   trucs, c'est le bazar ». La feuille de saisie d'une journée avait empilé les
   couches de quatre lots — deux grosses cartes, un paragraphe permanent sur
   les congés, trois volets repliés, puis un bouton « Autre cas… ». Quatre
   styles de présentation pour des choix de même nature.

   La cible est la maquette : UNE liste, tous les choix du même style, ce qui
   se déplie apparaît sous la liste, UN bouton « Enregistrer ».

   CE FICHIER VÉRIFIE LES DEUX MOITIÉS DE L'EXIGENCE :
     1. la forme neuve — sept choix dans l'ordre, un seul style, le dépliage
        au choix, l'interrupteur d'entretien qui n'apparaît que hors du cadre,
        un seul bouton inactif tant que le choix n'est pas complet ;
     2. et surtout CE QUI NE DOIT PAS SE PERDRE — c'est le « mais attention »
        du brief : les aperçus chiffrés rejoués par le moteur, l'ajustement
        manuel des heures rangé dans « Autre cas… », les avertissements
        conditionnels, la feuille de familiarisation intacte, l'accord en
        genre sans point médian, et le fait qu'un choix ne détruise plus ce
        qui ne le regarde pas.

   Décor : Léa, journée de 8 h 30 à 17 h 30 plus 30 minutes — référence à
   18 h 00, exactement celle de la maquette. Valeurs FICTIVES et rondes : le
   dépôt est PUBLIC, aucune donnée réelle n'y entre jamais.

   Lancement : node test/feuille-du-jour.smoke.js
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
function txt(el) { return el ? String(el.textContent) : ''; }
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
function contient(el, morceau, msg) {
  var ok = sansInsecable(txt(el)).indexOf(sansInsecable(morceau)) !== -1;
  assert(ok, ok ? msg : msg + ' — « ' + morceau + ' » introuvable');
}
function absent(el, morceau, msg) {
  var ok = sansInsecable(txt(el)).indexOf(sansInsecable(morceau)) === -1;
  assert(ok, ok ? msg : msg + ' — « ' + morceau + ' » ne devrait pas être là');
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

/* --- Décor -------------------------------------------------------------- */

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
var AVENANTS = [
  Decor.avenantDe(LEA, { id: 's1', date_effet: '2024-09-01',
    brut_mensuel_centimes: 150000, net_mensuel_centimes: 115000 })
];
AVENANTS[0].numero = 1;

var journees = {};
var imputations = [];
var periodes = [];
var ecritures = { journees: [], supprimees: [], retraits: [], groupes: [] };

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
  ajouterAvenant: function () { return Promise.resolve(AVENANTS[0]); },
  majAvenant: function (id, champs) { return Promise.resolve(champs); },
  supprimerAvenant: function () { return Promise.resolve(true); },
  getCompteurInitial: function (id) {
    return Promise.resolve({ contrat_id: id, date_reference: '2024-09-01',
      minutes_sup: 600, minutes_cp_acquis: 5400, minutes_cp_pris: 0 });
  },
  getJourneesMois: function () { return Promise.resolve(copie(journees)); },
  getJourneesPeriode: function () { return Promise.resolve({}); },
  listImputations: function () { return Promise.resolve(imputations.slice()); },
  listImputationsPourMois: function () { return Promise.resolve(imputations.slice()); },
  supprimerImputation: function () { return Promise.resolve(true); },
  getNoteMensuelle: function () { return Promise.resolve(null); },
  enregistrerNoteMensuelle: function (c, a, m, t) { return Promise.resolve({ texte: t }); },
  listRecapsPeriode: function () { return Promise.resolve([]); },
  listPeriodesFamiliarisation: function () { return Promise.resolve(periodes.slice()); },
  listPeriodesFamiliarisationContrat: function () { return Promise.resolve(periodes.slice()); },
  listRecapsContrat: function () { return Promise.resolve([]); },
  getRecap: function () { return Promise.resolve(null); },
  enregistrerJournee: function (l) { ecritures.journees.push(l); return Promise.resolve(l); },
  supprimerJournee: function (c, j) {
    ecritures.supprimees.push({ contratId: c, jour: j });
    return Promise.resolve(true);
  },
  poserAbsenceMaria: function (a, t) {
    ecritures.groupes.push({ affectations: a, type: t });
    return Promise.resolve([]);
  },
  retirerAbsenceMaria: function (ids, jours) {
    ecritures.retraits.push({ ids: ids, jours: jours });
    return Promise.resolve(true);
  },
  enregistrerImputation: function (i) { return Promise.resolve(i); },
  recloturerRecap: function () { return Promise.resolve({ id: 'x', statut: 'fige' }); }
};
function copie(o) {
  var r = {};
  Object.keys(o).forEach(function (k) { r[k] = o[k]; });
  return r;
}
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

/* Le 30 juin 2026 : tout le mois est passé, donc touchable (V8-05, on ne
   saisit pas l'avenir). */
window.App.moisCourant = function () { return { annee: 2026, mois: 6 }; };
window.App.aujourdhui = function () { return '2026-06-30'; };

var corps = document.getElementById('corps');
var sheet = document.getElementById('sheet');

async function ouvrirEnfant() {
  window.App.invalider();
  window.App.aller('enfant', { contratId: 'c-lea', annee: 2026, mois: 6 });
  await pause(320);
}
async function ouvrirJour(numero) {
  var td = Array.prototype.filter.call(
    corps.querySelectorAll('table.cal td[role="button"]'), function (x) {
      return txt(x.querySelector('.num')) === String(numero);
    })[0];
  if (!td) return null;
  td.click();
  await pause(220);
  return td;
}
function choixParLibelle(morceau) { return parTexte(sheet, '.choice', morceau); }
/* Le libellé d'un choix, sans son sous-texte : `.why` vit à l'intérieur de
   `.tx`, et `textContent` les colle l'un à l'autre. */
function libellesDeLaListe() {
  return Array.prototype.map.call(sheet.querySelectorAll('.liste-choix .choice'),
    function (x) {
      var tx = x.querySelector('.tx');
      var why = tx.querySelector('.why');
      return txt(tx).replace(txt(why), '').trim();
    });
}
function champHeure() { return sheet.querySelector('.detail-choix input[type="time"]'); }
function poserHeure(valeur) {
  var i = champHeure();
  i.value = valeur;
  i.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  i.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
}
function boutonEnregistrer() { return boutonExact(sheet, 'Enregistrer'); }

(async function () {
  document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  await pause(300);

  /* ==================================================================== */
  /* 1. LA LISTE — SEPT CHOIX, DANS L'ORDRE, TOUS DU MÊME STYLE           */
  /* ==================================================================== */
  console.log('\n--- 1 : une seule liste, sept choix, un seul style ---');

  await ouvrirEnfant();
  await ouvrirJour(8);                        // lundi 8 juin 2026

  contient(sheet, 'Lundi 8 juin', 'la feuille annonce le jour en toutes lettres');
  contient(sheet, 'Léa — famille Papillon', 'et le sous-titre est inchangé');
  contient(sheet, 'Ce jour-là…', 'la phrase d’amorce de la maquette');

  var libelles = libellesDeLaListe();
  var attendus = [
    'Un parent est venu en retard',
    'J’ai libéré plus tôt',
    'J’ai demandé une arrivée plus tardive',
    'Absence de Léa',
    'Une note sur la journée',
    'Finalement, rien de particulier ce jour-là',
    'Autre cas…'
  ];
  egal(libelles.length, 7, 'sept choix, pas un de plus');
  attendus.forEach(function (lib, i) {
    egal(libelles[i], lib, 'choix ' + (i + 1) + ' dans l’ordre de la maquette');
  });

  var tous = sheet.querySelectorAll('.liste-choix .choice');
  assert(Array.prototype.every.call(tous, function (x) {
    return x.className.indexOf('choice c1') !== -1;
  }), 'un seul style : les sept lignes partagent le même composant de choix');
  var radios = Array.prototype.filter.call(tous, function (x) {
    return x.getAttribute('role') === 'radio' && x.getAttribute('aria-checked') !== null;
  });
  egal(radios.length, 6,
    'les six choix qui se cochent sont annoncés comme des pastilles radio');
  egal(tous[6].getAttribute('role'), null,
    '« Autre cas… » reste un bouton : il ouvre une feuille, il ne se coche pas');

  /* Ce qui a été retiré, et qui ne doit pas revenir. */
  absent(sheet, 'était là', 'la carte « Léa était là — rien à faire » a disparu');
  absent(sheet, 'Pour vos congés, passez par',
    'le paragraphe permanent sur les congés a disparu');
  assert(!sheet.querySelector('details.ajuster'),
    'plus aucun volet replié dans la feuille du jour');
  assert(!parTexte(sheet, '.choice', 'absent·e'),
    'l’accord en genre passe par « Absence de Léa » — jamais de point médian');

  /* UN SEUL BOUTON, inactif tant que le choix n'est pas complet. */
  var boutons = Array.prototype.filter.call(sheet.querySelectorAll('button'), function (b) {
    return txt(b).trim() === 'Enregistrer';
  });
  egal(boutons.length, 1, 'un seul bouton « Enregistrer »');
  assert(boutons[0].disabled === true, 'inactif tant qu’aucun choix n’est fait');

  /* A3 — sans déclaration, rien ne change : la règle qui est une ABSENCE
     reste dite. */
  contient(sheet, 'restent dues', 'A3 : sans déclaration, les minutes restent dues');
  contient(sheet, 'de lui-même n’est pas un événement',
    'A3 : un départ anticipé du parent est explicitement écarté');

  /* Le dépliage n'a lieu QU'AU CHOIX. */
  assert(!champHeure(), 'aucun champ d’heure tant qu’aucun écart n’est choisi');
  absent(sheet, 'Indemnité d’entretien du jour',
    '§20.6 : aucun interrupteur d’entretien sur une journée sans écart');

  /* ==================================================================== */
  /* 2. UN PARENT EN RETARD — 18 h 12                                     */
  /* ==================================================================== */
  console.log('\n--- 2 : un parent est venu en retard ---');

  choixParLibelle('Un parent est venu en retard').click();
  await pause(150);

  assert(!!champHeure(), 'le champ d’heure se déplie sous la liste');
  egal(champHeure().getAttribute('type'), 'time',
    'c’est le champ à la minute près, pas le sélecteur au quart d’heure');
  contient(sheet, 'L’enfant est parti à', 'le libellé de la maquette');
  contient(sheet, 'à la minute près', 'et la précision demandée');
  /* DÉCISION D'ADRIEN, 23 août : les trois raccourcis de la maquette ne sont
     pas repris — ils ne vaudraient que pour un contrat dont la journée finit
     à 18 h 00, et Maria doit régler l'heure ET la minute. */
  assert(!parTexte(sheet, 'button', '18h01') && !parTexte(sheet, 'button', '18h15'),
    'aucun raccourci d’heure écrit en dur');
  /* La journée de référence vient du MOTEUR. */
  contient(sheet, '8h30 à 18h00',
    'la journée de référence est annoncée, produite par le moteur');

  poserHeure('18:12');
  await pause(120);
  contient(sheet, '+ 0h42 ce jour-là',
    'l’encart du delta est rejoué par le moteur : 30 min dues + 12 min de retard');
  contient(sheet, 'plus le retard', 'et la phrase dit d’où vient le chiffre');
  contient(sheet, 'Indemnité d’entretien du jour',
    '§20.6 : l’interrupteur apparaît dès que la journée sort du cadre');
  var comptee = parTexte(sheet, '.choice', 'Comptée');
  assert(comptee && comptee.className.indexOf('on') !== -1,
    '§20.6 : « Comptée » est coché par défaut — retirer est un choix');
  assert(boutonEnregistrer() && boutonEnregistrer().disabled === false,
    'le bouton s’active quand le choix est complet');

  /* 17 h 55 : rien à enregistrer, bouton inactif. */
  poserHeure('17:55');
  await pause(120);
  contient(sheet, 'Rien à enregistrer', 'à 18 h 00 ou avant, il n’y a rien à déclarer');
  contient(sheet, 'À 18h00 ou avant', 'et la phrase nomme l’heure DU CONTRAT');
  assert(boutonEnregistrer().disabled === true, 'le bouton redevient inactif');
  absent(sheet, 'Indemnité d’entretien du jour',
    'et l’interrupteur d’entretien disparaît avec l’écart');

  /* Ce qui part en base. */
  poserHeure('18:12');
  await pause(120);
  boutonEnregistrer().click();
  await pause(300);
  var ecrit = ecritures.journees[ecritures.journees.length - 1];
  egal(ecrit.ecart_evenement, 'retard_parent', 'l’événement part en base');
  egal(ecrit.ecart_minutes, 12, 'l’écart part SIGNÉ, calculé par le moteur');
  egal(ecrit.ecart_heure_reelle, '18:12', 'et l’heure réelle, à la minute');
  egal(ecrit.entretien_du, true, '§20.6 : l’indemnité reste due par défaut');

  /* ==================================================================== */
  /* 3. J'AI LIBÉRÉ PLUS TÔT — LE DELTA NÉGATIF ET SA DESTINATION         */
  /* ==================================================================== */
  console.log('\n--- 3 : j’ai libéré plus tôt ---');

  await ouvrirEnfant();
  await ouvrirJour(9);
  choixParLibelle('J’ai libéré plus tôt').click();
  await pause(150);
  poserHeure('16:30');
  await pause(150);

  contient(sheet, 'sur votre cumul du mois', 'le delta négatif est annoncé comme tel');
  contient(sheet, '-1h00', 'et chiffré par le moteur : 30 min dues − 1 h 30 rendue');
  /* §17.6 — la destination, seulement sur un écart négatif. Elle n'est pas
     dans la maquette ; elle ne se perd pas pour autant. */
  var selDest = parTexte(sheet, '.fld', 'se déduisent de');
  assert(!!selDest, '§17.6 : la destination des minutes rendues est toujours offerte');
  var options = Array.prototype.map.call(selDest.querySelectorAll('option'),
    function (o) { return txt(o); });
  egal(options.length, 3, '§17.6 : récupération, congés payés, sans solde');
  egal(options[0], 'Ma récupération', '§17.6 : la récupération en premier');

  /* 18 h 30 : ce n'est pas une libération anticipée, et l'écran renvoie vers
     le cas du retard. */
  poserHeure('18:30');
  await pause(120);
  contient(sheet, 'Rien à enregistrer', 'à 18 h 00 ou après, rien à enregistrer');
  contient(sheet, 'Un parent est venu en retard',
    'et l’écran renvoie vers le cas du retard');
  assert(boutonEnregistrer().disabled === true, 'le bouton reste inactif');

  /* ==================================================================== */
  /* 4. UNE ARRIVÉE PLUS TARDIVE                                          */
  /* ==================================================================== */
  console.log('\n--- 4 : j’ai demandé une arrivée plus tardive ---');

  await ouvrirEnfant();
  await ouvrirJour(10);
  choixParLibelle('J’ai demandé une arrivée plus tardive').click();
  await pause(150);
  contient(sheet, 'L’enfant est arrivé à', 'c’est l’heure du MATIN qui est demandée');
  poserHeure('08:00');
  await pause(120);
  contient(sheet, 'Rien à enregistrer', 'à 8 h 30 ou avant, rien ne change');
  contient(sheet, 'À 8h30 ou avant', 'et la phrase nomme l’heure d’arrivée du contrat');
  poserHeure('09:30');
  await pause(120);
  contient(sheet, 'sur votre cumul du mois', 'une arrivée décalée rend du temps');
  assert(boutonEnregistrer().disabled === false, 'et elle peut s’enregistrer');

  /* ==================================================================== */
  /* 5. L'ABSENCE DE L'ENFANT — L'APERÇU CHIFFRÉ                          */
  /* ==================================================================== */
  console.log('\n--- 5 : absence de Léa ---');

  await ouvrirEnfant();
  await ouvrirJour(11);
  choixParLibelle('Absence de Léa').click();
  await pause(200);
  contient(sheet, 'Pas d’entretien ce jour',
    'l’entretien retiré est annoncé, rejoué par le moteur');
  contient(sheet, '5,00', 'et chiffré : l’indemnité du contrat');
  contient(sheet, 'restent dues', 'RG-09 : vos 30 min restent dues');
  boutonEnregistrer().click();
  await pause(300);
  var abs = ecritures.journees[ecritures.journees.length - 1];
  egal(abs.type, 'absence_enfant', 'l’absence part en base');

  /* ==================================================================== */
  /* 6. LA NOTE — ET CE QU'ELLE NE DÉTRUIT PLUS                           */
  /* ==================================================================== */
  console.log('\n--- 6 : une note sur la journée ---');

  await ouvrirEnfant();
  await ouvrirJour(12);
  choixParLibelle('Une note sur la journée').click();
  await pause(150);
  contient(sheet, 'Jamais sur le document remis à la famille',
    'la note reste pour Maria seule');
  var champNote = parTexte(sheet, '.fld', 'Note').querySelector('input');
  champNote.value = 'Sortie au parc';
  champNote.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await pause(80);
  boutonEnregistrer().click();
  await pause(300);
  var note = ecritures.journees[ecritures.journees.length - 1];
  egal(note.commentaire, 'Sortie au parc', 'la note part en base');

  /* DÉCISION D'ADRIEN, 23 août : « chaque choix ne touche que son domaine ».
     Marquer une absence EFFAÇAIT la note du jour, sans un mot. */
  journees['2026-06-15'] = {
    id: 'j15', contrat_id: 'c-lea', jour: '2026-06-15', type: 'presence',
    minutes_reelles: null, entretien_centimes: null, commentaire: 'Sortie au parc',
    entretien_du: true, minutes_sup_exceptionnelles: 0, minutes_sup_renoncees: 0,
    sup_dues_override: null, ecart_minutes: null, ecart_evenement: null,
    ecart_heure_reelle: null, ecart_impute_sur: null
  };
  await ouvrirEnfant();
  await ouvrirJour(15);
  choixParLibelle('Absence de Léa').click();
  await pause(200);
  boutonEnregistrer().click();
  await pause(300);
  var absAvecNote = ecritures.journees[ecritures.journees.length - 1];
  egal(absAvecNote.type, 'absence_enfant', 'l’absence est écrite');
  egal(absAvecNote.commentaire, 'Sortie au parc',
    'et la note du jour SURVIT — un choix ne détruit plus ce qui ne le regarde pas');

  /* ==================================================================== */
  /* 7. DÉFAIRE — ET CORRIGER                                             */
  /* ==================================================================== */
  console.log('\n--- 7 : défaire, et corriger ---');

  /* Une journée qui porte déjà une déclaration s'ouvre dessus : « il faut
     qu'elle puisse corriger » (Adrien, 23 août). */
  journees['2026-06-16'] = {
    id: 'j16', contrat_id: 'c-lea', jour: '2026-06-16', type: 'presence',
    minutes_reelles: null, entretien_centimes: null, commentaire: 'Sortie au parc',
    entretien_du: true, minutes_sup_exceptionnelles: 0, minutes_sup_renoncees: 0,
    sup_dues_override: null, ecart_minutes: 30, ecart_evenement: 'retard_parent',
    ecart_heure_reelle: '18:30', ecart_impute_sur: null
  };
  await ouvrirEnfant();
  await ouvrirJour(16);
  var dejaCoche = parTexte(sheet, '.choice', 'Un parent est venu en retard');
  egal(dejaCoche.getAttribute('aria-checked'), 'true',
    'la journée s’ouvre sur la déclaration qu’elle porte déjà');
  egal(champHeure().value, '18:30', 'et l’heure enregistrée est dans le champ');
  poserHeure('18:45');
  await pause(120);
  assert(boutonEnregistrer().disabled === false,
    'corriger, c’est changer l’heure et enregistrer — rien de plus');

  /* Le sixième choix retire ce que la liste a posé, et dit ce qui reste. */
  choixParLibelle('Finalement, rien de particulier').click();
  await pause(200);
  contient(sheet, 'Ce que vous aviez déclaré sera retiré', 'le geste dit ce qu’il fait');
  contient(sheet, 'votre note sur cette journée',
    'et il dit ce qui RESTE — la note ne part pas avec l’écart');
  boutonEnregistrer().click();
  await pause(300);
  var remis = ecritures.journees[ecritures.journees.length - 1];
  egal(remis.type, 'presence', 'la journée redevient ordinaire');
  egal(remis.ecart_evenement, null, 'la déclaration est retirée');
  egal(remis.ecart_minutes, null, 'les quatre colonnes repartent ensemble');
  egal(remis.entretien_du, true, '§20.6 : retirer une déclaration REND l’indemnité');
  egal(remis.commentaire, 'Sortie au parc', 'et la note est conservée');

  /* Sur une journée ordinaire, il n'y a rien à annuler, et l'écran le dit
     plutôt que de laisser un bouton mort sans explication. */
  await ouvrirEnfant();
  await ouvrirJour(17);
  choixParLibelle('Finalement, rien de particulier').click();
  await pause(150);
  contient(sheet, 'il n’y a rien à annuler', 'un bouton inactif n’est jamais muet');
  assert(boutonEnregistrer().disabled === true, 'et le bouton reste inactif');

  /* ==================================================================== */
  /* 8. « AUTRE CAS… » — DANS LA LISTE, ET COMPLET                        */
  /* ==================================================================== */
  console.log('\n--- 8 : autre cas ---');

  await ouvrirEnfant();
  await ouvrirJour(18);
  var autre = choixParLibelle('Autre cas…');
  assert(!!autre && autre.className.indexOf('choice') !== -1,
    '« Autre cas… » est un choix de la liste, plus un bouton à part');
  autre.click();
  await pause(200);
  contient(sheet, 'Je n’étais pas demandée', 'le jour non travaillé est toujours là');
  contient(sheet, 'Congé sans solde', 'le sans solde aussi');
  contient(sheet, 'Ajuster mes heures ce jour-là',
    'et l’ajustement manuel des heures (lot 12) n’est pas supprimé');
  contient(sheet, 'que la déclaration d’horaire ne couvre pas',
    'avec la phrase qui dit quand s’en servir');
  var det = parTexte(sheet, 'details', 'Ajuster mes heures');
  det.open = true;
  await pause(80);
  contient(sheet, 'Heures supplémentaires en plus', 'le compteur du lot 12 est intact');
  contient(sheet, 'Je renonce à mes minutes', 'le renoncement aussi');

  /* ==================================================================== */
  /* 9. LES AVERTISSEMENTS CONDITIONNELS                                  */
  /* ==================================================================== */
  console.log('\n--- 9 : les avertissements, quand leur condition est vraie ---');

  imputations = [{
    id: 'imp1', contrat_id: 'c-lea', date_debut: '2026-06-22', date_fin: '2026-06-26',
    jours_ouvrables: 5, jours_sur_cp: 5, jours_sur_sup: 0, jours_sans_solde: 0
  }];
  journees['2026-06-22'] = {
    id: 'j22', contrat_id: 'c-lea', jour: '2026-06-22', type: 'conge_maria',
    minutes_reelles: null, entretien_centimes: null, commentaire: null,
    entretien_du: true, minutes_sup_exceptionnelles: 0, minutes_sup_renoncees: 0,
    sup_dues_override: null, ecart_minutes: null, ecart_evenement: null,
    ecart_heure_reelle: null, ecart_impute_sur: null
  };
  await ouvrirEnfant();
  await ouvrirJour(22);
  contient(sheet, 'période de congé déjà répartie',
    'l’avertissement de ventilation s’affiche AVANT le geste');

  /* Un jour où Maria ne travaillait pas : les déclarations d'horaire n'y
     produiraient rien (RG-04). La liste ne propose que ce qui agit. */
  var libellesConge = libellesDeLaListe();
  egal(libellesConge.length, 3, 'une liste courte sur un jour non travaillé');
  egal(libellesConge[0], 'Finalement, je travaillais', 'le geste de retour en tête');
  assert(libellesConge.indexOf('Un parent est venu en retard') === -1,
    'RG-04 : aucune déclaration d’horaire sur une journée sans minutes');
  assert(!sheet.querySelector('.choice.c1.grosse-carte'),
    'et le geste de retour est dans le style de la liste, plus en grosse carte');
  choixParLibelle('Finalement, je travaillais').click();
  await pause(150);
  boutonEnregistrer().click();
  await pause(300);
  egal(ecritures.retraits[ecritures.retraits.length - 1].jours[0], '2026-06-22',
    'le retrait passe par le chemin existant');
  imputations = [];
  delete journees['2026-06-22'];

  /* ==================================================================== */
  /* 10. LA FEUILLE DE FAMILIARISATION N'EST PAS TOUCHÉE                  */
  /* ==================================================================== */
  console.log('\n--- 10 : la familiarisation garde sa feuille dédiée ---');

  periodes = [{ id: 'p1', contrat_id: 'c-lea', date_debut: '2026-06-01',
    date_fin: '2026-06-05', taux_horaire_centimes: 720 }];
  await ouvrirEnfant();
  await ouvrirJour(2);
  contient(sheet, 'Familiarisation', 'un jour de période ouvre sa feuille dédiée');
  contient(sheet, 'seules les heures déclarées sont payées',
    'et elle est inchangée');
  assert(!sheet.querySelector('.liste-choix'),
    '§20.4 : la liste des sept choix n’y apparaît pas — le moteur les ignore');
  periodes = [];

  /* ==================================================================== */
  console.log('');
  if (echecs) { console.error(echecs + ' échec(s).'); process.exit(1); }
  console.log('Tout est conforme.');
})().catch(function (e) {
  console.error('Erreur pendant le parcours :', e && e.stack || e);
  process.exit(1);
});
