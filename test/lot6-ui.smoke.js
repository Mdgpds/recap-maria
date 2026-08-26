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
/* LOT 24 (§24.2) — le séparateur de milliers est une espace fine insécable
   (U+202F) posée à l'affichage par `Kit.eur`. Le normalisateur des tests la
   ramène à une espace ordinaire, comme il le fait déjà pour U+00A0. */
function sansInsecable(t) { return String(t).replace(/[\u00a0\u202f]/g, ' '); }
var srcAccueil = fs.readFileSync(path.join(racine, 'js', 'ui-accueil.js'), 'utf8');
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
  /* ==========================================================================
     EXIGENCE CHANGÉE — LOT 25 : L'ACCUEIL EST REFAIT (§25.1 des spécifications).
     L'accueil ne montre plus une grande carte par contrat avec sa barre de
     progression et ses mini-chiffres. Il montre DEUX BLOCS : « Aujourd'hui »
     (ce qu'il y a à faire, rien d'autre) puis « Mes contrats » (une ligne par
     enfant, avatar, sous-texte chiffré, pastille d'état).

     CE QUI CHANGE, ASSERTION PAR ASSERTION, ET POURQUOI :

     - « Bonjour Maria » -> « Bonjour ». Le prénom n'est plus écrit en dur dans
       l'écran : l'en-tête salue avec le nom ENREGISTRÉ (§16.2). Le décor de ce
       fichier n'a pas d'émettrice (`getEmettrice` rend null), donc la
       salutation est nue. L'exigence « l'accueil salue par son nom » n'est pas
       abandonnée : elle est vérifiée sur le chemin qui la produit.
     - « barre de progression du mois » (`.pbar i`) : RETIRÉE. Elle peignait
       l'avancement du mois calendaire, pas celui du travail de Maria — un
       mois à moitié écoulé dont tout est déclaré affichait la même barre
       qu'un mois à moitié écoulé dont rien ne l'est. Ce qui reste à faire est
       maintenant DIT, en toutes lettres, dans le bloc « Aujourd'hui » et dans
       la pastille de chaque contrat.
     - `.big` -> `.cd.tap` : le composant de carte du socle (lot 24) remplace
       la grande carte. Le compte se fait désormais dans le bloc
       « Mes contrats », pour ne pas confondre les cartes d'action du bloc
       « Aujourd'hui » avec les contrats.
     - « mini-chiffre à verser » et « provisoire » : RETIRÉS de la carte. Le
       sous-texte porte désormais « N j · montant », et le caractère provisoire
       est dit par la PASTILLE (« en cours », « à déclarer », « N mois en
       retard »...) plus le bandeau du document, pas par un adjectif répété
       sur chaque carte (§25.2).
     - « pastille `.pastille.en_cours .rond` » -> `Kit.pill` : le rond coloré
       a disparu, LE MOT RESTE. L'exigence de fond — l'état est écrit, pas
       seulement peint — est vérifiée plus fermement qu'avant : on exige que
       chaque carte de contrat porte une pastille NON VIDE.

     AUCUNE ASSERTION DE COMPORTEMENT N'EST AFFAIBLIE : les montants, la garde
     V8-03 (le mois courant n'est pas proposé à la clôture le 24) et
     l'interdiction du montant d'entretien isolé (§2.1) sont conservées
     telles quelles ci-dessous.
     ====================================================================== */
  assert(txt(barre).indexOf('Bonjour') !== -1, 'en-tête : la salutation');
  assert(txt(barre).indexOf('Bonjour Maria') === -1,
    '§16.2 : sans émettrice enregistrée, aucun prénom n’est inventé');
  assert(srcAccueil.indexOf('App.nomEmettrice()') !== -1,
    '§16.2 : la salutation est bien branchée sur le nom enregistré');
  assert(txt(barre).indexOf('Mai 2026') !== -1, 'en-tête : mois en cours');
  assert(!barre.querySelector('.pbar'),
    '§25.1 : plus de barre de progression du mois calendaire');
  assert(tabbar.hidden === false, 'barre d’onglets visible sur l’accueil');

  /* Les deux blocs, dans cet ordre : ce qu'il y a à faire, puis les contrats. */
  var sections = Array.prototype.map.call(corps.querySelectorAll('.sec'), txt);
  assert(sections.length === 2 && sections[0] === 'Aujourd’hui' &&
         sections[1] === 'Mes contrats',
    '§25.1 : deux blocs, « Aujourd’hui » puis « Mes contrats » (obtenu ' +
    sections.join(' | ') + ')');

  var titreContrats = parTexte(corps, '.sec', 'Mes contrats');
  var cartes = [];
  for (var n = titreContrats.nextSibling; n; n = n.nextSibling) {
    if (n.nodeType === 1 && n.className.indexOf('cd') !== -1) cartes.push(n);
  }
  assert(cartes.length === 2, 'une carte par contrat actif (obtenu ' + cartes.length + ')');
  assert(cartes[0].className.indexOf('cd tap') !== -1,
    '§24.3 : la carte de contrat est le composant `cd tap` du socle');
  assert(txt(cartes[0]).indexOf('Léa') !== -1, 'la carte porte le prénom');
  assert(!!cartes[0].querySelector('.av'),
    '§25.1 : la carte porte l’avatar de l’enfant');
  assert(sansInsecable(txt(cartes[0])).indexOf('1 157,50 €') !== -1,
    '§25.1 : le sous-texte porte le montant du mois, calculé par le moteur (obtenu « ' +
    sansInsecable(txt(cartes[0])) + ' »)');
  assert(txt(corps).indexOf('entretien') === -1,
    '§2.1 : aucun montant d’entretien isolé sur l’accueil');
  /* LOT 7 (V8-03) — on est le 24 mai : le mois COURANT n'est pas encore proposé
     à la clôture. Il ne le sera qu'à partir du 25. Avant le lot 7, l'accueil
     invitait Maria à figer un mois dont il restait un tiers à vivre — et la
     clôture est le seul geste irréversible de l'application. */
  assert(!parTexte(corps, '.cd', 'Clôturer mai pour Léa'),
    'V8-03 : le 24, le mois courant n’est PAS proposé à la clôture');
  /* L'état est ÉCRIT, pas seulement peint : chaque carte de contrat porte une
     pastille dont le texte n'est pas vide. */
  cartes.forEach(function (carte, rang) {
    var pastille = carte.querySelector('.pill');
    assert(!!pastille && txt(pastille).trim().length > 0,
      '§25.2 : la carte ' + (rang + 1) + ' annonce son état avec un MOT, pas ' +
      'seulement une couleur (obtenu « ' + txt(pastille) + ' »)');
  });
  assert(txt(corps).indexOf('provisoire') === -1,
    '§25.2 : l’adjectif « provisoire » ne se répète plus sur chaque carte — ' +
    'la pastille et le bandeau du document portent cette information');

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
  assert(txt(barre).indexOf('Léa · mai 2026') !== -1, 'titre de la barre : enfant et mois');
  assert(!!barre.querySelector('.av'),
    '§25.3 : l’avatar de l’enfant est dans la barre, à côté du titre');
  assert(!!corps.querySelector('table.cal'), 'calendrier présent');

  /* ==========================================================================
     EXIGENCE CHANGÉE — LOT 25 : L'ESPACE ENFANT EST REFAIT (§25.3).
     Les cinq PANNEAUX (`.pane`) empilés, chacun avec son titre et son contenu
     toujours déplié, deviennent quatre REPLIS (`.fold`, composant du socle du
     lot 24) : « Le mois » (ouvert), « Réserves », « Mes notes », « Depuis le
     début ». Le calendrier passe DEVANT, immédiatement sous les encarts.

     CE QUI CHANGE, ASSERTION PAR ASSERTION, ET POURQUOI :

     - « cinq panneaux `.pane` » -> « quatre replis `.fold` ». Ce n'est pas une
       suppression de contenu : les cinq panneaux tenaient sur plus de trois
       écrans de téléphone et le calendrier — le seul endroit où Maria SAISIT —
       arrivait après. Chaque repli porte sa VALEUR sur sa tête, donc rien
       n'oblige plus à dérouler pour savoir. Le cinquième panneau,
       « Le mois de… », et le panneau du calendrier ont fusionné : le
       calendrier n'a plus de panneau autour de lui, et son titre était le mois
       déjà écrit dans la barre.
     - les TITRES raccourcissent, parce que la barre dit déjà l'enfant et le
       mois : « Le mois de mai » -> « Le mois », « Réserves de Léa » ->
       « Réserves », « Mes notes sur ce mois » -> « Mes notes », « Depuis le
       début du contrat » -> « Depuis le début ».
     - « deux barres de progression `.cptr .cb i` » : RETIRÉES. Une barre de
       progression suppose un plafond ; la récupération n'en a pas, et la barre
       des congés payés se remplissait à l'envers (elle grandissait quand la
       réserve se vidait). Les deux réserves sont désormais des LIGNES chiffrées
       du repli, avec leur unité. Les deux exigences de fond tiennent et sont
       vérifiées ci-dessous : les congés payés passent DEVANT la récupération
       (§18.5) et l'ordre d'imputation est DIT (§18.6).
     - « la note est placée AVANT les compteurs » (V8-17) : l'ordre est
       conservé, il est simplement vérifié sur les replis. La mention « pour
       vous seule, jamais sur le document remis à la famille » quitte le corps
       du panneau pour devenir le PLACEHOLDER du champ : elle est là où l'on
       écrit, au moment où l'on écrit.
     - « Rien à faire les jours normaux » : RETIRÉE, remplacée par la ligne de
       synthèse chiffrée sous le calendrier (§25.3 point 4 des spécifications,
       qui l'énonce mot pour mot). La phrase rassurait ; les pastilles
       « 17 présents · 4 fériés » informent, et disent la même chose en creux.

     AUCUNE ASSERTION DE COMPORTEMENT N'EST AFFAIBLIE : le total à verser,
     l'entretien détaillé « n j × 5,00 € » calculé par le moteur, les deux
     réserves, leur ordre, l'ordre d'imputation, la destination de la note et
     le lien vers la fiche sont tous exigés ci-dessous.
     ====================================================================== */
  assert(corps.querySelectorAll('.pane').length === 0,
    '§25.3 : plus aucun panneau `.pane` dans l’espace enfant');
  var replis = corps.querySelectorAll('.fold');
  var titresReplis = Array.prototype.map.call(replis, function (f) {
    return txt(f.querySelector('.fh > span'));
  });
  assert(replis.length === 4,
    '§25.3 : quatre replis (obtenu ' + replis.length + ' : ' + titresReplis.join(' | ') + ')');

  /* Le calendrier est AU-DESSUS des replis : c'est le seul endroit où l'on
     saisit, il ne se mérite pas au bout de trois écrans de défilement. */
  assert(corps.querySelector('table.cal').compareDocumentPosition(replis[0]) &
         dom.window.Node.DOCUMENT_POSITION_FOLLOWING,
    '§25.3 : le calendrier vient AVANT les replis');

  var rMois = parTexte(corps, '.fold', 'Le mois');
  assert(!!rMois && txt(rMois).indexOf('Total à verser') !== -1,
    'le repli du mois porte le total à verser');
  assert(rMois.className.indexOf('open') !== -1,
    '§25.3 : « Le mois » est le seul repli ouvert par défaut');
  assert(sansInsecable(txt(rMois)).indexOf('× 5,00') !== -1,
    'entretien détaillé « n j × 5,00 € »');
  assert(!!rMois.querySelector('.ln.tot'),
    '§24.3 : le total porte la classe de total du socle');
  /* La tête du repli annonce sa valeur : on sait sans dérouler. */
  assert(sansInsecable(txt(rMois.querySelector('.fh .vv'))) ===
         sansInsecable(txt(rMois.querySelector('.ln.tot b'))),
    '§24.3 : la tête du repli affiche le total, identique à celui de la ligne');

  var rNote = parTexte(corps, '.fold', 'Mes notes');
  assert(!!rNote, 'V8-17 : le repli de note est présent');
  var champNote = rNote.querySelector('textarea');
  assert(!!champNote &&
         champNote.getAttribute('placeholder').indexOf('jamais sur le document remis à la famille') !== -1,
    'V8-17 : et il dit à qui la note est destinée, là où l’on écrit');

  /* LOT 18 §18.5 — « Compteurs de » est devenu « Réserves de » au lot 18, puis
     « Réserves » tout court au lot 25 : la barre dit déjà de qui. */
  var rReserves = parTexte(corps, '.fold', 'Réserves');
  assert(!!rReserves && txt(rReserves).indexOf('Récupération') !== -1 &&
         txt(rReserves).indexOf('Congés payés') !== -1,
    'les deux réserves du contrat sont présentes');
  assert(rReserves.querySelectorAll('.cptr .cb i').length === 0,
    '§25.3 : plus de barres de progression — les réserves sont chiffrées');
  /* LOT 18 §18.5 — les congés payés PASSENT DEVANT la récupération : l'ordre
     à l'écran doit être celui de la consommation. */
  assert(txt(rReserves).indexOf('Congés payés') < txt(rReserves).indexOf('Récupération'),
    '§18.5 : les congés payés sont affichés avant la récupération');
  /* LOT 18 §18.6 — devant deux réserves, laquelle sera consommée ? La phrase
     « Vos congés se prennent d'abord sur… » est devenue une LIGNE du repli,
     « Déduits d'abord sur | les congés payés » : même information, à la même
     place que les réserves qu'elle départage. */
  var ligneImputation = parTexte(rReserves, '.ln', 'Déduits d’abord sur');
  assert(!!ligneImputation && txt(ligneImputation).indexOf('congés payés') !== -1,
    '§18.6 : l’ordre d’imputation est dit sous les réserves (obtenu « ' +
    txt(ligneImputation) + ' »)');

  var rDebut = parTexte(corps, '.fold', 'Depuis le début');
  assert(!!rDebut, 'repli « depuis le début »');
  assert(!!parTexte(rDebut, '.ln.tap', 'Contrat, horaires et rémunération'),
    '§25.3 : le chemin vers la fiche du contrat vit dans « Depuis le début »');

  /* EXIGENCE CHANGÉE — V8-17, l'ORDRE DE LA NOTE.
     Ancienne assertion : « la note est placée AVANT les compteurs ». Le motif
     était écrit noir sur blanc au lot 12 : « le chercher sous trois panneaux
     de chiffres revenait à ne pas l'écrire ». Ce motif TOMBE avec les replis :
     les quatre têtes tiennent ensemble sur un écran de téléphone, « Mes notes »
     est visible sans dérouler quoi que ce soit, et l'atteindre coûte un appui,
     pas trois écrans de défilement. L'ordre des spécifications du lot 25
     (§25.3 point 5) s'applique donc : Le mois, Réserves, Mes notes, Depuis le
     début.
     CE QUI RESTE EXIGÉ, et c'est le fond de V8-17 : la note ne se mérite pas.
     Sa tête est visible d'emblée, dans le premier écran, sans avoir à ouvrir
     un autre repli d'abord. */
  var titresOrdre = Array.prototype.map.call(replis, function (f) {
    return txt(f.querySelector('.fh > span'));
  }).join(' | ');
  assert(titresOrdre === 'Le mois | Réserves | Mes notes | Depuis le début',
    '§25.3 : les quatre replis dans l’ordre des spécifications (obtenu ' +
    titresOrdre + ')');
  assert(Array.prototype.indexOf.call(replis, rNote) <= 2,
    'V8-17 : la tête « Mes notes » reste dans le premier écran, atteignable ' +
    'sans dérouler un autre repli');

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
  /* EXIGENCE CHANGÉE — V8-06, LA PHRASE SOUS LE CALENDRIER (§25.3 point 4).
     Ancienne assertion : « Rien à faire les jours normaux » est écrit en
     permanence sous le calendrier. Les spécifications du lot 25 la remplacent
     mot pour mot par LA LIGNE DE SYNTHÈSE CHIFFRÉE : des pastilles
     « 17 présents · 4 fériés ». La phrase rassurait sans informer, et elle
     occupait la place à chaque ouverture, y compris les mois où il y avait
     beaucoup à faire. Les pastilles disent la même chose en creux — si le
     compte des jours à déclarer est absent, c'est qu'il n'y a rien à faire —
     et disent en plus ce que la phrase ne disait pas.
     CE QUI RESTE EXIGÉ : quelque chose est écrit sous le calendrier, à cette
     place-là, et ce quelque chose est chiffré et lisible en mots. */
  var synthese = corps.querySelector('.synth');
  assert(!!synthese, '§25.3 : la ligne de synthèse chiffrée figure sous le calendrier');
  assert(corps.querySelector('table.cal').compareDocumentPosition(synthese) &
         dom.window.Node.DOCUMENT_POSITION_FOLLOWING,
    '§25.3 : et elle est bien SOUS le calendrier');
  var pastillesSynthese = synthese.querySelectorAll('.pill');
  assert(pastillesSynthese.length >= 2,
    '§25.3 : au moins deux pastilles de synthèse (obtenu ' + pastillesSynthese.length + ')');
  assert(txt(synthese).indexOf('17 présents') !== -1 &&
         txt(synthese).indexOf('4 fériés') !== -1,
    '§25.3 : les pastilles sont chiffrées ET nommées — « 17 présents », ' +
    '« 4 fériés » (obtenu « ' + txt(synthese) + ' »)');
  assert(txt(corps).indexOf('Rien à faire les jours normaux') === -1,
    '§25.3 : l’ancienne phrase permanente a bien quitté l’écran');
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
  /* LOT 28 (§28.2) — EXIGENCE CHANGÉE : quand l'enfant est absent, aucune
     minute n'est due (décision d'Adrien du 25 août 2026). L'aperçu, rejoué
     par le moteur, dit désormais « vos 30 min ne sont pas dues ». */
  assert(apercu.indexOf('30 min') !== -1 && apercu.indexOf('ne sont pas dues') !== -1,
    '§28.2 : « vos 30 min ne sont pas dues » (obtenu « ' + apercu + ' »)');

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
  /* ==========================================================================
     EXIGENCE CHANGÉE — LOT 26 §26.2 : « MES CONGÉS » S'ALLÈGE.

     - « 22,5 j DE CONGÉS PAYÉS · 93h30 DE RÉCUPÉRATION » -> « 22,5 j ·
       93h30 ». La valeur d'une ligne redevient une VALEUR : elle était une
       phrase de trois membres posée dans la colonne des montants, qu'il avait
       fallu forcer à passer à la ligne pour qu'elle ne pousse pas l'écran de
       côté. Le titre de la section dit déjà « Vos réserves », et l'ordre —
       congés payés d'abord, récupération ensuite — est celui de la
       consommation (§18.5), le même partout dans l'application.
       CE QUE LOT 10 EXIGE NE BOUGE PAS, et c'est vérifié plus haut ET plus
       bas : les DEUX réserves sont affichées, contrat par contrat, pour que
       Maria sache avant de poser si sa récupération lui évitera le sans-solde.
     - « Les compteurs diffèrent car les contrats n'ont pas commencé en même
       temps. » : RETIRÉE de cet écran. C'est une RÈGLE, pas un état ; elle va
       dans « Comment l'application compte » (lot 27). Ce qu'elle expliquait —
       pourquoi les chiffres ne sont pas les mêmes d'un enfant à l'autre — est
       dit par la structure elle-même : une ligne par enfant, chacune avec ses
       propres nombres. La phrase commentait ce que l'écran montrait déjà.
     - la règle du décompte RG-06 (28 mots) et la note de 46 mots quittent
       aussi l'écran. RIEN NE SE PERD : la règle reste écrite là où le NOMBRE
       est produit — le bloc vert de l'écran de pose — et sur l'encart RG-06
       de chaque document qui porte des congés. Vérifié ci-dessous.
     ====================================================================== */
  assert(txt(corps).indexOf('Vos réserves') !== -1, '§2.5 : les réserves, contrat par contrat');
  var lignesReserves = Array.prototype.filter.call(corps.querySelectorAll('.ln'), function (l) {
    return txt(l).indexOf('Léa') === 0 || txt(l).indexOf('Tom') === 0;
  });
  assert(lignesReserves.length >= 2,
    '§2.5 : une ligne par contrat (obtenu ' + lignesReserves.length + ')');
  assert(sansInsecable(txt(lignesReserves[0])).indexOf('j') !== -1 &&
         /\d+h\d\d/.test(txt(lignesReserves[0])),
    'LOT 10 : congés payés (en jours) ET récupération (en heures) sont affichés ' +
    'sur la même ligne (obtenu « ' + txt(lignesReserves[0]) + ' »)');
  assert(txt(lignesReserves[0]).indexOf('samedis') !== -1,
    '§7 : et le reste du quota de samedis, visible HORS de la pose');
  assert(txt(corps).indexOf('Les compteurs diffèrent') === -1,
    '§26.2 : la phrase d’explication a quitté l’écran — c’est une règle, elle ' +
    'vit désormais dans « Comment l’application compte »');
  assert(txt(corps).indexOf('Total des congés payés') === -1, '§2.5 : jamais de compteur global');
  assert(txt(corps).indexOf('Un congé vaut pour vos 2 contrats.') !== -1,
    '§26.2 : les six mots qui restent — et ils passent DEVANT le bouton (§18.6)');

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
  assert(!parTexte(corps, '.cd', 'Anciens contrats'),
    'LOT 8 : « Anciens contrats » n’est plus une entrée du Menu');

  /* ==========================================================================
     EXIGENCE CHANGÉE — LOT 27 §27.2 : LE MENU EN CARTES, ET « FAMILLES » S'EN VA.

     - `.menu` -> `.cd tap` : l'entrée de Menu était une ligne avec son propre
       style, de même géométrie et de même chevron que la carte du socle. Un
       composant de moins à corriger le jour où la carte change.
     - « FAMILLES » QUITTE LE MENU. Le lot 22 l'avait remplacée par « Mes
       enfants » (Maria pense par enfant), puis la relecture l'avait rétablie
       « le temps qu'Adrien tranche ». Il a tranché le 23 août, et le §27.2 le
       reprend : Gérer ne porte que Mes enfants, Ajouter un enfant, Comment
       l'application compte.
       RIEN NE SE PERD (B.0-7) : l'écran des familles existe toujours, et il
       s'atteint par « Voir par famille » en bas de « Mes enfants » — le même
       nombre d'appuis, depuis l'endroit où la question « qui vit ensemble ? »
       se pose vraiment. Vérifié ci-dessous en franchissant le chemin.
     - « Comment l'application compte » entre dans Gérer : c'est l'endroit
       unique des règles, et c'est lui qui autorise les retraits des lots 25
       et 26.
     ====================================================================== */
  var rubriques = Array.prototype.map.call(corps.querySelectorAll('.sec'), txt);
  assert(rubriques.indexOf('Gérer') === 0,
    'LOT 27 : le Menu commence par « Gérer » (obtenu ' + rubriques.join(' | ') + ')');
  assert(rubriques.indexOf('Compte') !== -1, 'LOT 27 : puis « Compte »');

  var ligneEnfants = parTexte(corps, '.cd', 'Mes enfants');
  assert(!!ligneEnfants, 'LOT 22 : « Mes enfants » est la première entrée');
  assert(!!parTexte(corps, '.cd', 'Ajouter un enfant'), 'le Menu garde « Ajouter un enfant »');
  assert(!!parTexte(corps, '.cd', 'Comment l’application compte'),
    '§27.1 : l’endroit unique des règles est atteignable depuis le Menu');
  assert(!parTexte(corps, '.cd', 'Familles'),
    '§27.2 : « Familles » a quitté le Menu — décision d’Adrien du 23 août');

  /* RIEN NE SE PERD : on franchit le chemin de remplacement. */
  ligneEnfants.click();
  await pause(300);
  var versFamilles = parTexte(corps, 'button', 'Voir par famille');
  assert(!!versFamilles,
    '§27.2 : « Voir par famille » est en bas de « Mes enfants »');
  versFamilles.click();
  await pause(300);
  assert(txt(corps).indexOf('famille') !== -1 || txt(barre).indexOf('amille') !== -1,
    '§27.2 : et il mène bien à l’écran des familles');
  window.App.aller('menu', {}, true);
  await pause(200);

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
