/* ============================================================================
   Test de fumée — LOT 28 : « JOURNÉES À PART ».

   POURQUOI CE FICHIER EXISTE.

   Retour d'Adrien du 24 août 2026, sur la production :
   « Pour le mois de décembre 2025 je ne comprends pas, parce que Maria a
     terminé à 12h30 et le temps restant a été déduit des heures
     supplémentaires, mais on ne voit rien dans le récap du mois. »

   Le chiffre était JUSTE et l'écran était MUET. Le moteur produit
   `ecartsDeclares` depuis le lot 17 — la liste jour par jour des écarts
   d'horaire déclarés, avec le geste — et un seul fichier la lisait :
   `js/ui-document.js`, le document remis à la famille. Le parent voyait
   l'explication ; Maria, sur son propre écran, voyait un total plus bas que
   le mois d'avant et rien pour le justifier.

   CE FICHIER VÉRIFIE LES DEUX MOITIÉS DE LA CORRECTION :
     1. le repli neuf — il existe quand le mois a des journées à part, il
        NOMME le geste, l'heure et la poche, il chiffre chaque journée, et il
        RECONSTITUE le total du mois à partir des sorties du moteur ;
     2. et surtout CE QUI NE DOIT PAS BOUGER — la phrase du document remis à
        la famille est identique au caractère près après le déménagement des
        deux tables de libellés vers `js/ui-kit.js`, et aucun total ne
        change. Un repli d'affichage qui déplacerait un chiffre serait un
        défaut bien pire que celui qu'il corrige.

   Décor : Léa, journée 8 h 30 → 17 h 30 plus 30 min — référence 18 h 00,
   celle de la maquette et celle du contrat réel. Juin 2026 rejoue le cas de
   décembre 2025 : une libération anticipée déclarée à 12h30, soit − 5 h 30.
   Valeurs FICTIVES et rondes : le dépôt est PUBLIC, aucune donnée réelle n'y
   entre jamais.

   Lancement : node test/lot28-journees-a-part.smoke.js
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
function sansInsecable(t) { return String(t).replace(/[\u00a0\u202f]/g, ' '); }
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
  /* LA CHAÎNE LIT ICI, PAS DANS `getJourneesMois`. Ce fichier teste des
     TOTAUX, donc le décor doit alimenter la chaîne : un stub qui rend `{}`
     ferait calculer un mois sans aucune journée — 22 j de présence et 11 h de
     sup — et les assertions vérifieraient un mois qui n'existe pas. */
  getJourneesPeriode: function (id, d, f) {
    var parMois = {};
    Object.keys(journees).forEach(function (j) {
      if (j < d || j > f) return;
      var cle = j.slice(0, 7);
      if (!parMois[cle]) parMois[cle] = {};
      parMois[cle][j] = journees[j];
    });
    return Promise.resolve(parMois);
  },
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


/* --- Le décor du mois : le cas de décembre 2025, rejoué en juin 2026 ----- */

/* Juin 2026 : 22 jours ouvrés du lundi au vendredi, aucun férié.
     · mardi 2   — libération anticipée déclarée à 12h30 → écart − 5 h 30,
                   imputé sur la récupération. C'est LE cas d'Adrien.
     · mardi 9   — 30 minutes non réclamées, choix de Maria (lot 9).
     · 22, 23, 24 — congé de Maria : trois journées SANS travail, qui doivent
                   tenir sur UNE ligne et non trois (sinon trois semaines de
                   congés d'été enterreraient la ligne du 2 juin).
   Attendu, calculé par le moteur et jamais ici :
     base 19 j × 30 min = 9h30 · − 30 min renoncées · − 5h30 déclarées
     = 3h30 net. */
function poserLeMois() {
  journees = {
    '2026-06-02': { contrat_id: 'c-lea', jour: '2026-06-02', type: 'presence',
      ecart_minutes: -330, ecart_evenement: 'liberation_anticipee',
      ecart_heure_reelle: '12:30:00', ecart_impute_sur: 'recuperation' },
    '2026-06-09': { contrat_id: 'c-lea', jour: '2026-06-09', type: 'presence',
      minutes_sup_renoncees: 30 },
    '2026-06-22': { contrat_id: 'c-lea', jour: '2026-06-22', type: 'conge_maria' },
    '2026-06-23': { contrat_id: 'c-lea', jour: '2026-06-23', type: 'conge_maria' },
    '2026-06-24': { contrat_id: 'c-lea', jour: '2026-06-24', type: 'conge_maria' }
  };
}
function moisOrdinaire() { journees = {}; }

async function ouvrirEnfant() {
  window.App.invalider();
  window.App.aller('enfant', { contratId: 'c-lea', annee: 2026, mois: 6 });
  await pause(320);
}

function foldParTitre(morceau) {
  return Array.prototype.filter.call(corps.querySelectorAll('.fold'), function (f) {
    var h = f.querySelector('.fh');
    return h && txt(h).indexOf(morceau) !== -1;
  })[0] || null;
}
function lignesDe(fold) {
  return Array.prototype.map.call(fold.querySelectorAll('.fb .ln'), function (l) {
    return sansInsecable(txt(l));
  });
}

(async function () {
  document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  await pause(300);

  /* ==================================================================== */
  /* 1. LE REPLI EXISTE, ET IL EST OUVERT QUAND UN ÉCART A BOUGÉ LE TOTAL */
  /* ==================================================================== */
  console.log('\n--- 1 : le repli « Journées à part » ---');

  poserLeMois();
  await ouvrirEnfant();

  var f = foldParTitre('Journées à part');
  assert(!!f, 'le repli « Journées à part » existe');
  contient(f.querySelector('.fh'), '5',
    'son en-tête compte les JOURNÉES concernées — 2 déclarées + 3 de congé');
  assert(f.classList.contains('open'),
    'il est OUVERT d’office : un écart a bougé le total, et un repli fermé ' +
    'laisserait le chiffre sans explication — c’est le défaut qu’on corrige');

  /* Il se lit dans la foulée de « Le mois », dont il explique les chiffres. */
  var tous = Array.prototype.map.call(corps.querySelectorAll('.fold .fh'), function (h) {
    return txt(h);
  });
  var rangMois = tous.findIndex(function (t) { return t.indexOf('Le mois') !== -1; });
  var rangPart = tous.findIndex(function (t) { return t.indexOf('Journées à part') !== -1; });
  egal(rangPart, rangMois + 1, '« Journées à part » suit immédiatement « Le mois »');

  /* ==================================================================== */
  /* 2. LA JOURNÉE D'ADRIEN — NOMMÉE, DATÉE, CHIFFRÉE                     */
  /* ==================================================================== */
  console.log('\n--- 2 : le 2 juin, celui qui a fait remonter le défaut ---');

  var lignes = lignesDe(f);
  var l2 = lignes.filter(function (t) { return t.indexOf('Mardi 2 juin') !== -1; })[0];
  assert(!!l2, 'la journée est nommée en toutes lettres');
  assert(l2.indexOf('Libération anticipée') !== -1,
    'le GESTE est nommé — c’est lui qui explique pourquoi le temps a bougé, ' +
    'pas la poche où il est allé');
  assert(l2.indexOf('12h30') !== -1,
    'et l’heure réellement déclarée est là : c’est ce que Maria cherche à ' +
    'retrouver quand elle ne comprend pas son total');
  assert(l2.indexOf('déduite de ma récupération') !== -1,
    'la poche est nommée aussi — même libellé que le document de la famille');
  assert(l2.indexOf('− 5 h') !== -1,
    'la journée porte ce que le MOTEUR retient pour elle : 30 min du contrat ' +
    'moins 5 h 30 rendues = − 5 h, et non l’écart brut');

  var l9 = lignes.filter(function (t) { return t.indexOf('Mardi 9 juin') !== -1; })[0];
  assert(!!l9, 'le renoncement du lot 9 a lui aussi sa ligne');
  assert(l9.indexOf('30 min non réclamées, votre choix') !== -1,
    'et il dit que c’est un choix, jamais une créance en attente');

  /* ==================================================================== */
  /* 3. LES JOURNÉES SANS TRAVAIL TIENNENT SUR UNE LIGNE PAR TYPE         */
  /* ==================================================================== */
  console.log('\n--- 3 : les congés groupés, pas un par jour ---');

  var lc = lignes.filter(function (t) { return t.indexOf('Mon congé') !== -1; });
  egal(lc.length, 1,
    'UNE seule ligne pour trois jours de congé — trois semaines d’été en ' +
    'feraient sinon dix-huit, qui enterreraient la ligne qui explique un chiffre');
  assert(lc[0].indexOf('22, 23, 24 juin') !== -1,
    'les quantièmes y sont tous : le groupement ne perd aucune date');
  assert(lc[0].indexOf('pas d’heures sup ces jours-là') !== -1,
    'RG-04 est dite là où elle est INCONDITIONNELLE (conge_maria est dans ' +
    'TYPES_SANS_MINUTES du moteur, toujours)');
  egal(lignes.filter(function (t) { return t.indexOf('juin') !== -1 &&
    t.indexOf('Mardi') === -1; }).length, 1,
    'aucune ligne par jour de congé n’est ajoutée');

  /* ==================================================================== */
  /* 4. LA RÉCONCILIATION — LA LIGNE QUI RÉPOND À « POURQUOI 3H30 ? »     */
  /* ==================================================================== */
  console.log('\n--- 4 : le total se reconstitue, à partir du moteur seul ---');

  var lt = lignes.filter(function (t) { return t.indexOf('Heures sup du mois') !== -1; })[0];
  assert(!!lt, 'le repli se termine par le total du mois');
  assert(lt.indexOf('3h30') !== -1, 'le net du moteur, inchangé');
  assert(lt.indexOf('9h30 au contrat') !== -1, 'ce que le contrat prévoyait');
  assert(lt.indexOf('− 30 min non réclamées') !== -1, 'ce à quoi Maria a renoncé');
  assert(lt.indexOf('− 5h30 déclarées') !== -1, 'ce qu’elle a rendu, déclaré');

  /* Le même total, au même endroit qu'avant : « Le mois » n'a pas bougé. */
  var fm = foldParTitre('Le mois');
  var lm = lignesDe(fm).filter(function (t) {
    return t.indexOf('Heures sup du mois') !== -1;
  })[0];
  assert(lm.indexOf('3h30') !== -1,
    'AUCUN CHIFFRE NE BOUGE : « Le mois » affiche le même net qu’avant ce lot');

  /* ==================================================================== */
  /* 5. UN MOIS ORDINAIRE N'A PAS DE REPLI DU TOUT                        */
  /* ==================================================================== */
  console.log('\n--- 5 : rien à part, rien à ouvrir ---');

  moisOrdinaire();
  await ouvrirEnfant();
  assert(!foldParTitre('Journées à part'),
    'le repli n’apparaît pas : une case de plus à ouvrir pour lire « rien » ' +
    'est un écran plus lourd, pas plus honnête');
  assert(!!foldParTitre('Le mois'), 'les autres replis sont intacts');

  /* ==================================================================== */
  /* 5 bis. UNE LIGNE CLIQUABLE RESTE UNE LIGNE                           */
  /*                                                                     */
  /* DÉFAUT TROUVÉ EN VÉRIFIANT AU NAVIGATEUR, ANTÉRIEUR À CE LOT.       */
  /* `Kit.ligneLn` avec un `onclick` fabrique un vrai <button>, et        */
  /* `.ln.tap` ne portait QUE `cursor: pointer` : le navigateur lui       */
  /* donnait son apparence à lui — fond gris, bordure, texte centré.      */
  /* jsdom ne calcule aucune mise en page et ne pouvait pas le voir ; le  */
  /* rendu Chromium à 390 px, si. Cette assertion lit la feuille de style */
  /* pour que le défaut ne revienne pas par une réécriture.               */
  /* ==================================================================== */
  console.log('\n--- 5 bis : la remise à zéro de .ln.tap ---');

  var css = fs.readFileSync(path.join(racine, 'css', 'style.css'), 'utf8');
  var regleTap = (css.match(/\.ln\.tap\s*\{[^}]*\}/) || [''])[0];
  ['width: 100%', 'text-align: left', 'background: none', 'border: 0',
   'font-family: inherit', 'color: inherit'].forEach(function (d) {
    assert(regleTap.indexOf(d) !== -1,
      '.ln.tap remet le bouton à zéro — « ' + d +' »');
  });
  assert(regleTap.indexOf('border-bottom: 1px solid var(--ln2)') !== -1,
    'et lui REND son filet bas, que le `border: 0` venait d’effacer');

  /* ==================================================================== */
  /* 6. LE DOCUMENT DE LA FAMILLE N'A PAS CHANGÉ D'UN CARACTÈRE           */
  /* ==================================================================== */
  console.log('\n--- 6 : la pièce opposable, après le déménagement des libellés ---');

  egal(window.Kit.LIBELLE_EVENEMENT_ECART.liberation_anticipee, 'libération anticipée',
    'le geste est nommé dans Kit, en un seul exemplaire');
  egal(window.Kit.LIBELLE_EVENEMENT_ECART.conge_horaire, 'congé posé sur cette journée',
    'le congé à l’heure du lot 21 garde son mot à lui — la migration 017 ' +
    'existe pour ça');
  egal(window.Kit.LIBELLE_DESTINATION_ECART.recuperation, 'déduite de ma récupération',
    'la poche aussi');
  egal(window.Kit.LIBELLE_DESTINATION_ECART.sans_solde, 'passée en sans solde',
    'les trois destinations sont là');

  poserLeMois();
  window.App.invalider();
  window.App.aller('document', { contratId: 'c-lea', annee: 2026, mois: 6 });
  await pause(340);

  contient(corps, 'Dont 5h30 que je n’ai pas gardée du mardi 2 juin — ' +
    'libération anticipée, déduite de ma récupération',
    'la phrase du document est identique au caractère près : le déménagement ' +
    'des libellés vers Kit n’a rien réécrit');
  contient(corps, 'Heures supplémentaires du mois',
    'et elle reste sous le total, qui est net');

  console.log(echecs ? '\n' + echecs + ' ÉCHEC(S).' : '\nTout est conforme.');
  process.exit(echecs ? 1 : 0);
})();
