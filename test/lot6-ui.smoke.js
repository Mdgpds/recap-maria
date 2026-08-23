/* ============================================================================
   Test de fumée de la refonte d'interface (lot 6), hors réseau.

   Charge le VRAI index.html dans jsdom, branche le vrai moteur (engine.js),
   la vraie chaîne des mois et un DB simulé, puis parcourt l'application comme
   Maria le ferait : accueil -> espace enfant -> feuille d'une journée ->
   document et clôture -> onglet Mes congés -> menu.

   Ce qu'il vérifie, et pourquoi :
   - la barre d'onglets n'apparaît QUE sur les trois écrans racine (§1) ;
   - le calendrier n'ouvre pas les jours fériés et les week-ends (§2.3) ;
   - les effets annoncés dans la feuille sont CALCULÉS par le moteur : le
     montant d'entretien vient du contrat, pas d'un texte en dur (§4) ;
   - « Je ne travaillais pas » écrit sur TOUS les contrats en un seul appel,
     chaque contrat ne recevant que SES propres jours (§2.3) ;
   - la clôture enregistre un instantané portant le prénom, le nom de famille
     et les jours de congé du mois (§2.4) ;
   - l'onglet Mes congés n'affiche AUCUN compteur global et montre l'aperçu
     d'une semaine avant confirmation (§2.5).

   Lancement : NODE_PATH=... node test/lot6-ui.smoke.js   (nécessite jsdom).
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
var html = fs.readFileSync(path.join(racine, 'index.html'), 'utf8');
var dom = new JSDOM(html, { url: 'https://exemple.test/' });

global.window = dom.window;
global.document = dom.window.document;
/* `navigator` est en lecture seule sur le global de Node : on ne le remplace
   pas, les modules passent de toute façon par window.navigator. */
global.URL = dom.window.URL;

var echecs = 0;
function assert(cond, msg) {
  if (!cond) { echecs++; console.error('FAIL ' + msg); } else { console.log('ok   ' + msg); }
}
function pause(ms) { return new Promise(function (r) { setTimeout(r, ms || 20); }); }
function txt(el) { return el ? el.textContent : ''; }
function sansInsecable(t) { return String(t).replace(/\u00a0/g, ' '); }
function boutonExact(racineEl, libelle) {
  return Array.prototype.filter.call(racineEl.querySelectorAll('button'), function (e) {
    return e.textContent.trim() === libelle;
  })[0] || null;
}
function parTexte(racineEl, selecteur, morceau) {
  return Array.prototype.filter.call(racineEl.querySelectorAll(selecteur), function (e) {
    return e.textContent.indexOf(morceau) !== -1;
  })[0] || null;
}

/* --- Modules purs --------------------------------------------------------- */
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

/* --- Données simulées ----------------------------------------------------- */
var BASE = {
  minutes_contractuelles: 540, minutes_sup_jour: 30, minutes_par_jour_conge: 540,
  entretien_centimes_jour: 500, jours_planning: [1, 2, 3, 4, 5],
  heure_arrivee: '08:30:00', heure_depart: '18:00:00',
  statut: 'actif', sup_dues_si_enfant_absent: true, ordre_imputation: 'cp_puis_sup',
  archive: false, date_fin: null
};
function contrat(o) {
  var c = {};
  Object.keys(BASE).forEach(function (k) { c[k] = BASE[k]; });
  Object.keys(o).forEach(function (k) { c[k] = o[k]; });
  return c;
}
var LEA = contrat({ id: 'c-lea', prenom_enfant: 'Léa', famille_id: 'f1',
  famille: { id: 'f1', nom: 'Papillon' }, date_debut: '2025-09-01' });
var TOM = contrat({ id: 'c-tom', prenom_enfant: 'Tom', famille_id: 'f2',
  famille: { id: 'f2', nom: 'Mésange' }, date_debut: '2026-02-02' });
var MANON = contrat({ id: 'c-man', prenom_enfant: 'Manon', famille_id: 'f3',
  famille: { id: 'f3', nom: 'Alouette' }, date_debut: '2024-09-02',
  date_fin: '2026-01-30', archive: true, statut: 'termine' });

var appels = { poser: [], retirer: [], journee: [], suppression: [], fige: [] };
var SALAIRE = { id: 's1', date_effet: '2025-09-01',
  brut_mensuel_centimes: 137289, net_mensuel_centimes: 107250 };


var TOUS_CONTRATS = [LEA, TOM, MANON];

/* LOT 17 §17.2 — le contrat par son identifiant. `getAvenants` en a besoin
   pour reprendre les réglages du décor dans l'avenant : le moteur ne les lit
   plus sur `contrat`. */
function contratDe(id) {
  return TOUS_CONTRATS.filter(function (c) { return c.id === id; })[0] || TOUS_CONTRATS[0];
}

var DB = {
  getSession: function () {
    return Promise.resolve({ user: { id: 'u1', email: 'maria@exemple.test' } });
  },
  onAuthChange: function () { /* pas de rejeu d'authentification dans ce test */ },
  signOut: function () { return Promise.resolve(true); },
  /* LOT 16 §16.2 — le nom qui signe les documents. Décor : non renseigné,
     le document dira « votre assistante maternelle ». */
  getEmettrice: function () { return Promise.resolve(null); },
  enregistrerEmettrice: function (nom) { return Promise.resolve({ nom: nom }); },
  /* LOT 16 §16.4 — la ligne des rappels affiche désormais son VRAI réglage.
     Décor : rappels inactifs, la ligne dira « Vous ne recevez aucun rappel ». */
  getPreferenceRappel: function () { return Promise.resolve(null); },
  listContratsActifs: function () { return Promise.resolve([LEA, TOM]); },
  listContratsTous: function () { return Promise.resolve([LEA, TOM, MANON]); },
  listContratsPourMois: function () { return Promise.resolve([LEA, TOM]); },
  listContratsPourPeriode: function () { return Promise.resolve([LEA, TOM]); },
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
    var s = {}; Object.keys(SALAIRE).forEach(function (k) { s[k] = SALAIRE[k]; });
    s.contrat_id = id;
    return Promise.resolve(Decor.avenantsDe(contratDe(id), [s]));
  },
  getCompteurInitial: function () { return Promise.resolve(null); },
  getJourneesMois: function () { return Promise.resolve({}); },
  listImputationsPourMois: function () { return Promise.resolve([]); },
  getNoteMensuelle: function () { return Promise.resolve(null); },
    enregistrerNoteMensuelle: function (c, a, m, t) { return Promise.resolve({ texte: t }); },
  getJourneesPeriode: function () { return Promise.resolve({}); },
  listRecapsPeriode: function () { return Promise.resolve([]); },
  /* LOT 20 — les périodes de familiarisation (§20.2). Le décor les rend
     vides : ces écrans-là n'en ont aucune, et la fiche du contrat doit
     l'afficher comme telle plutôt que d'échouer. */
  listPeriodesFamiliarisation: function () { return Promise.resolve([]); },
  listPeriodesFamiliarisationContrat: function () { return Promise.resolve([]); },
  listRecapsContrat: function () { return Promise.resolve([]); },
  getRecap: function () { return Promise.resolve(null); },
  enregistrerJournee: function (l) { appels.journee.push(l); return Promise.resolve(l); },
  supprimerJournee: function (c, j) { appels.suppression.push([c, j]); return Promise.resolve(true); },
  poserAbsenceMaria: function (a, t) { appels.poser.push({ affectations: a, type: t }); return Promise.resolve([]); },
  retirerAbsenceMaria: function (ids, jours, types) {
    appels.retirer.push({ ids: ids, jours: jours, types: types });
    return Promise.resolve(true);
  },
  /* Lot 13 : la clôture passe désormais par recloturerRecap, qui écrit
     l'événement « cloture » dans la même transaction que le figement.
     L'ancienne figerRecap a été SUPPRIMÉE de db.js (relecture lot 13, C4) :
     elle clôturait sans écrire d'événement. Il n'existe plus qu'un chemin. */
  recloturerRecap: function (id, a, m, donnees) {
    appels.fige.push({ contratId: id, annee: a, mois: m, donnees: donnees });
    return Promise.resolve({ id: 'r1', statut: 'fige' });
  }
};
global.DB = DB; window.DB = DB;

/* --- Écrans --------------------------------------------------------------- */
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

/* Horloge figée : mai 2026, le 24. Le moteur, lui, ne lit jamais l'heure. */
window.App.moisCourant = function () { return { annee: 2026, mois: 5 }; };
window.App.aujourdhui = function () { return '2026-05-24'; };

var corps = document.getElementById('corps');
var barre = document.getElementById('barre');
var tabbar = document.getElementById('tabbar');
var sheet = document.getElementById('sheet');

(async function () {
  document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  await pause(120);

  /* ---------- 1. Accueil ---------- */
  assert(document.getElementById('vue-app').hidden === false, 'l’application est affichée après reconnexion automatique');
  assert(document.getElementById('vue-login').hidden === true, 'aucun passage par l’écran de connexion');
  assert(barre.className === 'hero', 'l’accueil porte l’en-tête vert, pas une barre de retour');
  assert(txt(barre).indexOf('Bonjour Maria') !== -1, 'en-tête : « Bonjour Maria »');
  assert(txt(barre).indexOf('Mai 2026') !== -1, 'en-tête : mois en cours');
  assert(!!barre.querySelector('.pbar i'), 'barre de progression du mois présente');
  assert(tabbar.hidden === false, 'barre d’onglets visible sur l’accueil');

  var cartes = corps.querySelectorAll('.big');
  assert(cartes.length === 2, 'une carte par contrat actif (obtenu ' + cartes.length + ')');
  assert(txt(cartes[0]).indexOf('Léa') !== -1 && txt(cartes[0]).indexOf('Papillon') !== -1,
    'la carte porte le prénom et la famille');
  assert(txt(cartes[0]).indexOf('à verser') !== -1, 'mini-chiffre « à verser » présent');
  assert(txt(corps).indexOf('entretien') === -1,
    '§2.1 : aucun montant d’entretien isolé sur l’accueil');
  /* LOT 7 (V8-03) — on est le 24 mai : le mois COURANT n'est pas encore proposé
     à la clôture. Il ne le sera qu'à partir du 25. Avant le lot 7, l'accueil
     invitait Maria à figer un mois dont il restait un tiers à vivre — et la
     clôture est le seul geste irréversible de l'application. */
  assert(!parTexte(corps, '.todo', 'Clôturer mai pour Léa'),
    'V8-03 : le 24, le mois courant n’est PAS proposé à la clôture');
  assert(txt(cartes[0]).indexOf('en cours') !== -1,
    'la carte annonce « en cours », avec le mot et pas seulement la couleur');
  assert(txt(cartes[0]).indexOf('provisoire') !== -1,
    'LOT 7 : un total qui peut encore bouger le dit');
  assert(!!cartes[0].querySelector('.pastille.en_cours .rond'),
    'la pastille d’état est présente, en renfort du mot');

  /* ---------- 2. Espace enfant ---------- */
  cartes[0].click();
  await pause(80);

  /* LOT 22 §22.3 — LA BARRE SUIT DÉSORMAIS LES ÉCRANS INTÉRIEURS.
     Elle disparaissait dès qu'on descendait d'un cran, et sur un téléphone en
     mode installé — sans barre de navigateur — il ne restait qu'un chevron de
     retour pour dire où l'on est. Elle reste affichée, avec l'onglet PARENT
     actif : « Accueil » sur l'espace d'un enfant. Le §22.3 prime ici sur le
     §B.1 du référentiel, qui parle encore de trois écrans racine. */
  assert(tabbar.hidden === false,
    '§22.3 : la barre d’onglets reste visible sur l’espace enfant');
  var ongletActif = tabbar.querySelector('button.on');
  assert(!!ongletActif && ongletActif.getAttribute('data-onglet') === 'accueil',
    '§22.3 : et c’est « Accueil », l’onglet parent, qui est actif');
  assert(ongletActif.getAttribute('aria-current') === 'page',
    '§22.3 : l’état actif est annoncé, pas seulement peint');
  assert(!!barre.querySelector('.bk'), 'l’espace enfant a un bouton retour');
  assert(txt(barre).indexOf('Léa — mai 2026') !== -1, 'titre de la barre : enfant et mois');
  assert(!!corps.querySelector('table.cal'), 'calendrier présent');

  /* LOT 12 (V8-17) — un CINQUIÈME panneau : « Mes notes sur ce mois ». Il est
     placé AVANT les compteurs, à la demande de Maria : c'est ce qu'elle relit
     le plus souvent, et le chercher sous trois panneaux de chiffres revenait à
     ne pas l'écrire. Les panneaux sont donc repérés par leur TITRE plutôt que
     par leur rang — un test qui compte des positions se casse au prochain
     panneau ajouté, et ne dit rien de ce qui compte. */
  var panneaux = corps.querySelectorAll('.pane');
  assert(panneaux.length === 5, '§2.2 + V8-17 : cinq panneaux (obtenu ' + panneaux.length + ')');
  var pMois = parTexte(corps, '.pane', 'Le mois de');
  assert(!!pMois && txt(pMois).indexOf('Total à verser') !== -1,
    'le panneau du mois porte le total à verser');
  assert(txt(pMois).indexOf('× 5,00') !== -1, 'entretien détaillé « n j × 5,00 € »');
  var pNote = parTexte(corps, '.pane', 'Mes notes sur ce mois');
  assert(!!pNote, 'V8-17 : le panneau de note est présent');
  assert(txt(pNote).indexOf('n’apparaît pas sur le document remis à la famille') !== -1,
    'V8-17 : et il dit à qui la note est destinée');
  /* LOT 18 §18.5 — « Compteurs de » est devenu « Réserves de » : une réserve
     est ce qui reste, un compteur est un instrument. */
  var pCompteurs = parTexte(corps, '.pane', 'Réserves de');
  assert(!!pCompteurs && txt(pCompteurs).indexOf('Récupération') !== -1 &&
         txt(pCompteurs).indexOf('Congés payés') !== -1,
    'réserves du contrat en barres');
  assert(pCompteurs.querySelectorAll('.cptr .cb i').length === 2, 'deux barres de progression');
  /* LOT 18 §18.5 — les congés payés PASSENT DEVANT la récupération : l'ordre
     à l'écran doit être celui de la consommation. */
  assert(txt(pCompteurs).indexOf('Congés payés') < txt(pCompteurs).indexOf('Récupération'),
    '§18.5 : les congés payés sont affichés avant la récupération');
  /* LOT 18 §18.6 — devant deux réserves, laquelle sera consommée ? */
  assert(txt(pCompteurs).indexOf('Vos congés se prennent d’abord sur') !== -1,
    '§18.6 : l’ordre d’imputation est dit sous les réserves');
  assert(!!parTexte(corps, '.pane', 'Depuis le début du contrat'),
    'panneau « depuis le début »');

  /* V8-17 — l'ORDRE compte : la note vient avant les compteurs. */
  var indexNote = Array.prototype.indexOf.call(panneaux, pNote);
  var indexCompteurs = Array.prototype.indexOf.call(panneaux, pCompteurs);
  assert(indexNote < indexCompteurs,
    'V8-17 : la note est placée AVANT les compteurs (note ' + indexNote +
    ', compteurs ' + indexCompteurs + ')');

  /* Mai 2026 : 21 jours du lundi au vendredi, dont 4 fériés (1, 8, 14, 25).
     LOT 7 — on ne saisit pas l'avenir : les jours POSTÉRIEURS au 24 ne sont
     plus touchables. Un jour à venir touchable permettait de noter une absence
     qui n'a pas encore eu lieu, ce qui rendait le décompte des jours restants
     faux et la projection incohérente. Restent les jours ouvrés non fériés du
     1er au 24 : 13. */
  var touchables = corps.querySelectorAll('table.cal td[role="button"]');
  assert(touchables.length === 13,
    'LOT 7 : 13 journées touchables — ni week-end, ni férié, ni à venir (obtenu ' +
    touchables.length + ')');
  var futurs = corps.querySelectorAll('table.cal td.futur');
  assert(futurs.length > 0, 'LOT 7 : les jours à venir sont marqués');
  assert(Array.prototype.every.call(futurs, function (td) {
    return td.getAttribute('role') !== 'button';
  }), 'LOT 7 : aucun jour à venir ne réagit à l’appui');
  var auj = corps.querySelectorAll('table.cal td.auj');
  assert(auj.length === 1 && txt(auj[0].querySelector('.num')) === '24',
    'LOT 7 : le repère « aujourd’hui » est posé sur le 24, et sur lui seul');
  assert(txt(corps).indexOf('Rien à faire les jours normaux') !== -1,
    'V8-06 : la phrase permanente figure sous le calendrier');
  var feries = Array.prototype.filter.call(corps.querySelectorAll('table.cal td.fe'), function (td) {
    return td.getAttribute('role') === 'button';
  });
  assert(feries.length === 0, '§2.3 : aucun jour férié n’est touchable');

  /* ---------- 3. Feuille de saisie d'une journée ---------- */
  var mardi19 = Array.prototype.filter.call(touchables, function (td) {
    return txt(td.querySelector('.num')) === '19';
  })[0];
  assert(!!mardi19, 'le mardi 19 mai est touchable');
  mardi19.click();
  await pause(20);

  assert(document.getElementById('sheetwrap').hidden === false, 'la feuille s’ouvre');
  assert(txt(sheet).indexOf('Mardi 19 mai') !== -1, 'la feuille annonce le jour');
  /* EXIGENCE CHANGÉE — LA FEUILLE DU JOUR EST REFAITE COMME LA MAQUETTE
     (retour d'Adrien du 23 août 2026 : « trop de trucs, c'est le bazar »).

     CE QUI DISPARAÎT, ET POURQUOI, assertion par assertion :
       - « deux marquages seulement » : il y a maintenant SEPT choix, tous du
         même style. Ce n'est pas un choix de congé qui revient (V8-09 tient,
         vérifié plus bas) : ce sont les gestes qui vivaient jusqu'ici dans
         trois volets repliés et un bouton à part.
       - « choix 1 : l'enfant était là » : la carte « était là — rien à faire »
         a été retirée. La présence est l'état par défaut, le calendrier le dit
         déjà ; le retour en présence est le sixième choix.
       - « la phrase qui dit où poser un congé est présente » : le paragraphe
         permanent sur les congés a été retiré de cette feuille (décision
         d'Adrien du 23 août). La RÈGLE, elle, ne change pas — aucun choix de
         congé ici — et c'est ce que vérifie l'assertion conservée ci-dessous.

     AUCUNE ASSERTION DE COMPORTEMENT N'EST AFFAIBLIE : l'effet chiffré de
     l'absence, rejoué par le moteur, et « vos 30 min restent dues » sont
     toujours exigés — sur le choix qui les porte désormais. */
  var choix = sheet.querySelectorAll('.liste-choix .choice');
  var libelles = Array.prototype.map.call(choix, function (x) {
    return txt(x.querySelector('.tx')).split('\n')[0].trim();
  });
  assert(choix.length === 7,
    'la feuille propose SEPT choix, tous du même style (obtenu ' + choix.length + ')');
  var attendus = ['Un parent est venu en retard', 'J’ai libéré plus tôt',
    'J’ai demandé une arrivée plus tardive', 'Absence de Léa',
    'Une note sur la journée', 'Finalement, rien de particulier ce jour-là',
    'Autre cas…'];
  attendus.forEach(function (lib, i) {
    assert(libelles[i] && libelles[i].indexOf(lib) === 0,
      'choix ' + (i + 1) + ' dans l’ordre de la maquette : « ' + lib + ' » (obtenu « ' +
      (libelles[i] || '') + ' »)');
  });
  /* Un seul style : le même composant de choix pour les sept lignes. Les six
     premières se cochent et sont annoncées comme des pastilles radio ;
     « Autre cas… » ouvre une autre feuille, il reste un bouton — dire « case
     non cochée » sur un geste qui change d'écran serait faux. */
  assert(Array.prototype.every.call(choix, function (x) {
    return x.className.indexOf('choice c1') !== -1;
  }), 'les sept lignes partagent le même composant de choix');
  assert(Array.prototype.filter.call(choix, function (x) {
    return x.getAttribute('role') === 'radio';
  }).length === 6, 'les six choix qui se cochent portent la pastille radio');
  assert(txt(sheet).indexOf('Ce jour-là…') !== -1,
    'la phrase d’amorce de la maquette ouvre la liste');
  assert(!parTexte(sheet, '.choice', 'était là'),
    'la carte « Léa était là — rien à faire » a disparu : la présence est l’état par défaut');
  assert(!parTexte(sheet, 'details', 'Que s’est-il passé') &&
         !parTexte(sheet, 'details', 'Un mot sur cette journée') &&
         !parTexte(sheet, 'details', 'Ajuster mes heures'),
    'plus aucun volet replié : les trois gestes sont des choix de la liste');
  assert(txt(sheet).indexOf('Pour vos congés, passez par') === -1,
    'le paragraphe permanent sur les congés a été retiré de la feuille');
  assert(!parTexte(sheet, '.choice', 'Je ne travaillais pas') &&
         !parTexte(sheet, '.choice', 'congé'),
    'V8-09 : aucun choix « congé » dans cette liste — les congés se posent ' +
    'depuis « Mes congés », qui les ventile contrat par contrat');

  /* ---------- 4. Une absence d’enfant s’écrit ---------- */
  var choixAbsence = parTexte(sheet, '.choice', 'Absence de Léa');
  assert(!!choixAbsence, 'le choix « Absence de Léa » est offert');
  assert(txt(choixAbsence).indexOf('absent·e') === -1,
    'l’accord en genre passe par « Absence de Léa » — jamais de point médian');
  var boutonAvant = boutonExact(sheet, 'Enregistrer');
  assert(!!boutonAvant && boutonAvant.disabled === true,
    'un seul bouton « Enregistrer », inactif tant qu’aucun choix n’est fait');
  choixAbsence.click();
  await pause(120);

  var apercu = sansInsecable(txt(sheet));
  assert(apercu.indexOf('5,00') !== -1,
    'effet de l’absence calculé par le moteur : −5,00 € (obtenu « ' + apercu + ' »)');
  assert(apercu.indexOf('30 min') !== -1 && apercu.indexOf('restent dues') !== -1,
    'RG-09 : « vos 30 min restent dues »');

  var boutonApres = boutonExact(sheet, 'Enregistrer');
  assert(!!boutonApres && boutonApres.disabled === false,
    'le bouton s’active une fois le choix complet');
  boutonApres.click();
  await pause(120);
  assert(document.getElementById('sheetwrap').hidden === true,
    'la feuille se referme après un enregistrement réussi');

  /* ---------- 5. Document et clôture ---------- */
  window.App.aller('document', { contratId: 'c-lea', annee: 2026, mois: 5 });
  await pause(80);

  assert(!!corps.querySelector('.doc'), 'le document garde son identité papier');
  /* DÉCISION D'ADRIEN (19 août 2026) — l'encart RG-06 ne figure plus que sur
     les mois QUI PORTENT DES CONGÉS. Ce mois-ci n'en a aucun : sur un document
     qui affiche « Aucun ce mois-ci », trois lignes de droit du travail
     n'expliquent aucun chiffre. Le cas AVEC congés est vérifié dans
     `lot17-correctifs.smoke.js`. */
  assert(txt(corps).indexOf('Décompte des congés') === -1,
    'l’encart RG-06 est absent d’un mois sans aucun congé');
  assert(txt(corps).indexOf('Salaire brut correspondant') !== -1, 'brut et net affichés séparément');
  assert(txt(corps).indexOf('L’envoi aux parents est facultatif') !== -1,
    '§2.4 : le partage est facultatif et l’écrit');
  assert(!!parTexte(corps, 'button', 'Copier le texte') && !!parTexte(corps, 'button', 'Enregistrer en image'),
    'les deux formats de partage sont proposés');
  assert(txt(corps).indexOf('figé') === -1 && txt(corps).indexOf('envoyé') === -1,
    'vocabulaire : jamais « figé » ni « envoyé » à l’écran');

  var bCloture = parTexte(corps, 'button', 'Clôturer le mois');
  assert(!!bCloture, 'bouton « Clôturer le mois »');
  bCloture.click();
  await pause(20);
  assert(txt(sheet).indexOf('verrouille le mois') !== -1, 'avertissement avant clôture');
  /* LOT 7 (V8-04) — on est le 24 mai : sept jours travaillés restent à venir.
     La clôture reste POSSIBLE, mais elle est précédée d'un avertissement et le
     bouton devient « Clôturer quand même ». Clôturer un mois inachevé en
     croyant ses chiffres définitifs est le seul risque irréversible de
     l'application. */
  assert(txt(sheet).indexOf('jours travaillés sont encore à venir') !== -1,
    'V8-04 : la clôture anticipée avertit du nombre de jours restants');
  assert(txt(sheet).indexOf('ces journées ne seront pas comptées') !== -1,
    'V8-04 : et de la conséquence');
  var bQuandMeme = parTexte(sheet, 'button', 'Clôturer quand même');
  assert(!!bQuandMeme, 'V8-04 : le bouton devient « Clôturer quand même »');
  bQuandMeme.click();
  await pause(80);

  assert(appels.fige.length === 1, 'la clôture appelle recloturerRecap une fois (lot 13)');
  var snap = appels.fige[0].donnees;
  assert(snap.prenomEnfant === 'Léa' && snap.nomFamille === 'Papillon',
    'l’instantané embarque le prénom et le nom de famille');
  assert(Array.isArray(snap.joursConge), 'l’instantané embarque les jours de congé du mois');
  assert(typeof snap.totalAVerserCentimes === 'number', 'l’instantané est bien le résultat du moteur');

  /* ---------- 6. Mes congés (refondu au lot 10) ---------- */
  window.App.aller('conges', {}, true);
  await pause(250);

  assert(tabbar.hidden === false, 'barre d’onglets visible sur Mes congés');
  /* LOT 10 — les réserves montrent désormais les congés payés ET la
     récupération. Sans la seconde, Maria ne pouvait pas savoir, avant de
     poser, si sa récupération lui éviterait le sans-solde — c'est-à-dire une
     retenue sur salaire. */
  assert(txt(corps).indexOf('Vos réserves') !== -1, '§2.5 : les réserves, contrat par contrat');
  assert(txt(corps).indexOf('de congés payés') !== -1 && txt(corps).indexOf('de récupération') !== -1,
    'LOT 10 : congés payés ET récupération sont affichés');
  assert(txt(corps).indexOf('Les compteurs diffèrent') !== -1, 'la phrase d’explication est présente');
  assert(txt(corps).indexOf('Total des congés payés') === -1, '§2.5 : jamais de compteur global');

  /* V8-08 — UN SEUL bouton de pose. */
  assert(!!boutonExact(corps, 'Poser des congés'), 'V8-08 : « Poser des congés »');
  assert(!parTexte(corps, 'button', 'Poser une semaine entière'),
    'V8-08 : le mode « une semaine entière » a disparu');
  assert(!parTexte(corps, 'button', 'Poser une seule journée'),
    'V8-08 : le faux raccourci « une seule journée » a disparu');
  assert(!!parTexte(corps, 'button', 'Retirer des congés'), 'le retrait reste offert');

  /* ---------- 7. Menu ---------- */
  window.App.aller('menu', {}, true);
  await pause(120);
  assert(tabbar.hidden === false, 'barre d’onglets visible sur le Menu');
  assert(txt(corps).indexOf('maria@exemple.test') !== -1, 'le compte connecté est affiché');

  /* LOT 8 — la rubrique « Consulter » a DISPARU du Menu, et avec elle
     « Anciens contrats » et « Récapitulatif sur une période ». Les deux
     vivaient à deux gestes de profondeur dans un menu qu'on n'ouvre que quand
     on cherche ; ils sont désormais sur l'onglet Historique, qui est
     justement l'endroit où l'on va chercher le passé. */
  assert(txt(corps).indexOf('Consulter') === -1,
    'LOT 8 : la rubrique « Consulter » a disparu du Menu');
  assert(!parTexte(corps, '.menu', 'Anciens contrats'),
    'LOT 8 : « Anciens contrats » n’est plus une entrée du Menu');
  /* LOT 22 §22.1 — « Mes enfants » S'AJOUTE au Menu ; « Familles » y reste.
     La spécification demande l'entrée « Mes enfants » et une page dédiée ;
     elle ne demande nulle part de supprimer l'accès par famille. Correction C5
     de la relecture : les deux entrées cohabitent. */
  assert(!!parTexte(corps, '.menu', 'Familles'),
    'LOT 22 : « Familles » reste une entrée du Menu');
  var ligneEnfants = parTexte(corps, '.menu', 'Mes enfants');
  assert(!!ligneEnfants, 'LOT 22 : et « Mes enfants » s’y ajoute');
  assert(!!parTexte(corps, '.menu', 'Ajouter un enfant'), 'le Menu garde « Ajouter un enfant »');

  /* ---------- 7bis. Onglet Historique ---------- */
  window.App.aller('historique', {}, true);
  await pause(150);
  assert(tabbar.hidden === false, 'LOT 8 : l’Historique est un onglet racine');
  assert(txt(corps).indexOf('Contrats en cours') !== -1, 'LOT 8 : les contrats en cours d’abord');
  assert(txt(corps).indexOf('Contrats terminés') !== -1,
    'LOT 8 : les contrats terminés sous leur propre intertitre');
  assert(txt(corps).indexOf('Manon') !== -1, 'LOT 8 : le contrat rangé est listé, pas caché');
  assert(!!parTexte(corps, '.menu', 'Récapitulatif sur une période'),
    'LOT 8 : le récapitulatif de période est accessible depuis l’Historique');
  assert(txt(corps).indexOf('mois d’historique') !== -1,
    'LOT 8 : chaque carte annonce son nombre de mois');

  var carteManon = parTexte(corps, '.big', 'Manon');
  assert(!!carteManon, 'LOT 8 : Manon a sa carte');
  carteManon.click();
  await pause(200);
  assert(txt(barre).indexOf('Historique — Manon') !== -1,
    'LOT 8 : la carte ouvre l’historique de ce contrat');

  console.log('\n' + (echecs === 0 ? 'Tout est conforme.' : echecs + ' échec(s).'));
  process.exit(echecs === 0 ? 0 : 1);
})().catch(function (e) {
  console.error('Erreur pendant le parcours :', e);
  process.exit(1);
});
