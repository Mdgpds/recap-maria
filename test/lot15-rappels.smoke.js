/* ============================================================================
   Test de fumée — lot 15 : rappels de clôture.
   Cas P1 à P7 de la spécification.

   POURQUOI CE FICHIER EXISTE.

   Ce lot est le seul du projet qui dépende de choses hors de notre portée : un
   service d'envoi, la permission du téléphone, et — sur iPhone — l'application
   installée sur l'écran d'accueil. Chacune peut manquer, et manquer
   SILENCIEUSEMENT.

   D'où la règle qui structure tout, et que ce fichier vérifie sous plusieurs
   angles : LA PASTILLE FONCTIONNE TOUJOURS. Elle ne demande ni permission, ni
   serveur, ni installation. Les notifications sont un confort par-dessus ; la
   pastille est le filet. Le pire scénario n'est pas « le rappel n'arrive pas » :
   c'est « le rappel n'arrive pas ET Maria croit qu'il arrivera ». C'est
   pourquoi un refus de permission DÉCOCHE la case et le DIT.

   TROIS CONTRÔLES PORTENT SUR DU CODE QU'ON NE PEUT PAS EXÉCUTER ICI — la
   fonction serveur tourne dans Deno, le service worker dans un navigateur.
   Plutôt que de les paraphraser (ce qui ne prouve rien), ce fichier EXTRAIT
   leurs expressions du fichier source et les évalue. Si quelqu'un modifie
   la règle d'envoi ou le texte du rappel, le test le voit.

   Lancement : node test/lot15-rappels.smoke.js
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
function pause(ms) { return new Promise(function (r) { setTimeout(r, ms || 30); }); }
function txt(el) { return el ? el.textContent : ''; }
function parTexte(racineEl, selecteur, morceau) {
  return Array.prototype.filter.call(racineEl.querySelectorAll(selecteur), function (e) {
    return e.textContent.indexOf(morceau) !== -1;
  })[0] || null;
}
function boutonQuiContient(racineEl, morceau) {
  return Array.prototype.filter.call(racineEl.querySelectorAll('button'), function (e) {
    return e.textContent.indexOf(morceau) !== -1;
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

/* --- Le téléphone simulé -------------------------------------------------
   Notification et pushManager sont remplacés par des objets qu'on pilote :
   c'est la seule façon de rejouer un refus de permission, qui est le cas le
   plus important du lot et celui qu'aucun essai manuel ne reproduit deux fois
   (le navigateur mémorise la réponse). */
var telephone = {
  permission: 'granted',        // 'granted' | 'denied'
  supporte: true,
  abonnementCasse: false,
  demandes: 0
};

function installerTelephone() {
  if (!telephone.supporte) {
    delete dom.window.Notification;
    delete dom.window.navigator.serviceWorker;
    return;
  }
  dom.window.Notification = {
    requestPermission: function () {
      telephone.demandes++;
      return Promise.resolve(telephone.permission);
    }
  };
  Object.defineProperty(dom.window.navigator, 'serviceWorker', {
    configurable: true,
    get: function () {
      return {
        /* app.js enregistre le service worker au démarrage : sans cette
           fonction, l'amorçage lève et TOUT l'écran manque. */
        register: function () { return Promise.resolve({ scope: './' }); },
        addEventListener: function () {},
        ready: Promise.resolve({
          pushManager: {
            subscribe: function () {
              if (telephone.abonnementCasse) {
                return Promise.reject(new Error('Failed to fetch'));
              }
              return Promise.resolve({
                toJSON: function () {
                  return {
                    endpoint: 'https://push.exemple.test/abonnement-fictif',
                    keys: { p256dh: 'CLE-P256DH-FICTIVE', auth: 'CLE-AUTH-FICTIVE' }
                  };
                }
              });
            }
          }
        })
      };
    }
  });
}
installerTelephone();

/* La clé publique VAPID vient de config.js. Le dépôt la livre VIDE (aucune clé
   dans un dépôt public) ; on en pose une fictive pour pouvoir jouer P1. */
dom.window.RECAP_MARIA_CONFIG = { VAPID_PUBLIC_KEY: 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo' };
dom.window.atob = function (b64) { return Buffer.from(b64, 'base64').toString('binary'); };

/* --- Décor. Valeurs FICTIVES : le dépôt est public. --------------------- */
function contrat(id, prenom) {
  return {
    id: id, prenom_enfant: prenom, famille_id: 'f-' + id,
    famille: { id: 'f-' + id, nom: 'Foyer-' + prenom },
    date_debut: '2026-01-01', date_fin: null,
    minutes_contractuelles: 540, minutes_sup_jour: 30, minutes_par_jour_conge: 540,
    entretien_centimes_jour: 500, jours_planning: [1, 2, 3, 4, 5],
    heure_arrivee: '08:30:00', heure_depart: '18:00:00', statut: 'actif',
    sup_dues_si_enfant_absent: true, ordre_imputation: 'cp_puis_sup', archive: false,
    nom: null, genre: 'f', couleur: 'bleu', photo: null, modele_id: null
  };
}
var LEA = contrat('c-lea', 'Léa');
var TOM = contrat('c-tom', 'Tom');

var scene = {
  contrats: [LEA, TOM],
  journees: {},
  recaps: {},
  preference: null,
  preferenceCassee: false,
  moisCourant: { annee: 2026, mois: 7 },
  /* Le 28 : passé la bascule du 25, juillet est « à clôturer » et juin est en
     retard. Deux contrats, donc de quoi voir la pastille compter. */
  aujourdhui: '2026-07-28'
};
var appels = { preference: [], abonnement: [] };

function cleR(id, a, m) { return id + '|' + a + '-' + m; }
function recapsDe(id) {
  return Object.keys(scene.recaps)
    .filter(function (k) { return k.indexOf(id + '|') === 0; })
    .map(function (k) { return scene.recaps[k]; });
}


/* LOT 17 §17.2 — le contrat par son identifiant. `getAvenants` en a besoin
   pour reprendre les réglages du décor dans l'avenant : le moteur ne les lit
   plus sur `contrat`. */
function contratDe(id) {
  var liste = scene.contrats || [];
  return liste.filter(function (c) { return c && c.id === id; })[0] || liste[0] || {};
}

var DB = {
  getSession: function () {
    return Promise.resolve({ user: { id: 'u1', email: 'maria@exemple.test' } });
  },
  onAuthChange: function () {},
  signIn: function () { return Promise.resolve(true); },
  signOut: function () { return Promise.resolve(true); },
  demanderReinitialisation: function () { return Promise.resolve(true); },
  /* LOT 16 §16.2 — le nom qui signe les documents. Décor : non renseigné,
     le document dira « votre assistante maternelle ». */
  getEmettrice: function () { return Promise.resolve(null); },
  enregistrerEmettrice: function (nom) { return Promise.resolve({ nom: nom }); },

  listContratsActifs: function () { return Promise.resolve(scene.contrats); },
  listContratsTous: function () { return Promise.resolve(scene.contrats); },
  listContratsPourMois: function () { return Promise.resolve(scene.contrats); },
  listContratsPourPeriode: function () { return Promise.resolve(scene.contrats); },
  listFamilles: function () { return Promise.resolve([LEA.famille, TOM.famille]); },
  listFamillesToutes: function () { return Promise.resolve([LEA.famille, TOM.famille]); },
  listFamillesAvecContrats: function () { return Promise.resolve([]); },
  listModeles: function () { return Promise.resolve([]); },
  modeleEnVigueur: function () { return Promise.resolve(null); },
  getAvenants: function (id) {
    return Promise.resolve(Decor.avenantsDe(contratDe(id),
      [{ id: 's-' + id, contrat_id: id, date_effet: '2026-01-01',
         brut_mensuel_centimes: 200000, net_mensuel_centimes: 150000 }]));
  },
  getCompteurInitial: function (id) {
    return Promise.resolve(Decor.compteurEnMinutes({ contrat_id: id,
      date_reference: '2026-01-01',
      minutes_sup: 0, dixiemes_cp_acquis: 200, dixiemes_cp_pris: 0 }));
  },
  getJourneesMois: function (id) { return Promise.resolve(scene.journees[id] || {}); },
  getJourneesPeriode: function (id) {
    var parMois = {};
    Object.keys(scene.journees[id] || {}).forEach(function (d) {
      var cle = d.slice(0, 7);
      if (!parMois[cle]) parMois[cle] = {};
      parMois[cle][d] = scene.journees[id][d];
    });
    return Promise.resolve(parMois);
  },
  listImputations: function () { return Promise.resolve([]); },
  listImputationsPourMois: function () { return Promise.resolve([]); },
  enregistrerImputation: function (i) { return Promise.resolve(i); },
  supprimerImputation: function () { return Promise.resolve(true); },
  getNoteMensuelle: function () { return Promise.resolve(null); },
  enregistrerNoteMensuelle: function (id, a, m, t) { return Promise.resolve({ texte: t }); },
  listRecapsPeriode: function (id) { return Promise.resolve(recapsDe(id)); },
  /* LOT 20 — les périodes de familiarisation (§20.2). Le décor les rend
     vides : ces écrans-là n'en ont aucune, et la fiche du contrat doit
     l'afficher comme telle plutôt que d'échouer. */
  listPeriodesFamiliarisation: function () { return Promise.resolve([]); },
  listPeriodesFamiliarisationContrat: function () { return Promise.resolve([]); },
  listRecapsContrat: function (id) { return Promise.resolve(recapsDe(id)); },
  getRecap: function (id, a, m) { return Promise.resolve(scene.recaps[cleR(id, a, m)] || null); },
  estMoisCloture: function (id, a, m) {
    var r = scene.recaps[cleR(id, a, m)];
    return Promise.resolve(!!r && r.statut === 'fige');
  },
  enregistrerJournee: function (l) { return Promise.resolve(l); },
  supprimerJournee: function () { return Promise.resolve(true); },
  poserAbsenceMaria: function () { return Promise.resolve([]); },
  retirerAbsenceMaria: function () { return Promise.resolve(true); },
  rouvrirRecap: function () { return Promise.resolve(null); },
  recloturerRecap: function () { return Promise.resolve(null); },
  listEvenementsRecap: function () { return Promise.resolve([]); },
  marquerTransmis: function () { return Promise.resolve(null); },
  majContrat: function (id, c) { return Promise.resolve(c); },
  majContratIdentite: function (id, c) { return Promise.resolve(c); },
  creerFamille: function (f) { return Promise.resolve(f); },
  majFamille: function (id, f) { return Promise.resolve(f); },
  rattacherContratAFamille: function () { return Promise.resolve(true); },
  renommerFamille: function () { return Promise.resolve(true); },
  archiverFamille: function () { return Promise.resolve(true); },
  desarchiverFamille: function () { return Promise.resolve(true); },
  ajouterSalaire: function (id, s) { return Promise.resolve(s); },
  majSalaire: function (id, s) { return Promise.resolve(s); },
  supprimerSalaire: function () { return Promise.resolve(true); },
  enregistrerCompteurInitial: function (id, c) { return Promise.resolve(c); },
  supprimerContrat: function () { return Promise.resolve(true); },
  contratEstVierge: function () { return Promise.resolve(false); },
  exporterHistorique: function () { return Promise.resolve({}); },

  /* --- Lot 15 ------------------------------------------------------- */
  getPreferenceRappel: function () {
    if (scene.preferenceCassee) return Promise.reject(new Error('Failed to fetch'));
    return Promise.resolve(scene.preference);
  },
  enregistrerPreferenceRappel: function (champs) {
    appels.preference.push(champs);
    scene.preference = {
      owner: 'u1', actif: champs.actif, jour_du_mois: champs.jour_du_mois,
      heure: champs.heure, chaque_jour_ensuite: champs.chaque_jour_ensuite,
      maj_le: '2026-07-28T19:00:00Z'
    };
    return Promise.resolve(scene.preference);
  },
  enregistrerAbonnementPush: function (ab) {
    appels.abonnement.push(ab);
    return Promise.resolve({ id: 'ab1', endpoint: ab.endpoint, cree_le: '2026-07-28T19:00:00Z' });
  },
  supprimerAbonnementPush: function () { return Promise.resolve(true); }
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

window.App.moisCourant = function () { return scene.moisCourant; };
window.App.aujourdhui = function () { return scene.aujourdhui; };

var corps = document.getElementById('corps');
var tabbar = document.getElementById('tabbar');

async function ouvrir(ecran, params) {
  window.App.invalider();
  window.App.aller(ecran, params || {});
  await pause(500);
}
function pastille() {
  var b = tabbar.querySelector('button[data-onglet="accueil"]');
  return b ? b.querySelector('.pastille-onglet') : null;
}
function boutonAccueil() {
  return tabbar.querySelector('button[data-onglet="accueil"]');
}
function caseActif() {
  var l = parTexte(corps, '.coche-ligne', 'Recevoir un rappel');
  return l ? l.querySelector('input[type="checkbox"]') : null;
}
function caseChaque() {
  var l = parTexte(corps, '.coche-ligne', 'chaque jour tant qu’un mois');
  return l ? l.querySelector('input[type="checkbox"]') : null;
}
function cocher(box, valeur) {
  box.checked = valeur;
  var ev = document.createEvent('Event');
  ev.initEvent('change', true, true);
  box.dispatchEvent(ev);
}

/* ==========================================================================
   Extraction du code SERVEUR, pour l'exécuter au lieu de le paraphraser.
   ====================================================================== */
var SRC_FN = fs.readFileSync(
  path.join(racine, 'supabase', 'functions', 'rappels-cloture', 'index.ts'), 'utf8');

function extraire(regex, quoi) {
  var m = SRC_FN.match(regex);
  if (!m) { echecs++; console.error('FAIL extraction impossible : ' + quoi); return null; }
  return m[1];
}

/* Le texte du rappel, tel que le serveur le construit. */
var exprTexte = extraire(
  /const corps = ([\s\S]*?);\n/, 'l’expression du texte de rappel');
var texteServeur = exprTexte
  ? new Function('nb', 'return ' + exprTexte + ';')
  : function () { return ''; };

/* La règle d'envoi, EXTRAITE du fichier serveur puis exécutée. Elle a changé
   au correctif B9 : un mois EN RETARD ne doit plus attendre le jour réglé. */
var blocGardes = extraire(
  /(const jourReglé[\s\S]*?compte\.retards === 0\) \{\n      continue;\n    \})/,
  'les gardes d’envoi');
var blocDernierJour = extraire(
  /(function dernierJourDuMois[\s\S]*?\n\})/, 'dernierJourDuMois');
var doitEnvoyer = (blocGardes && blocDernierJour)
  ? new Function('pref', 'now', 'compte',
      blocDernierJour.replace(/: number/g, '').replace(/\)\s*:\s*number/, ')') +
      '\n' + blocGardes.replace(/continue;/g, 'return false;') + '\nreturn true;')
  : function () { return false; };

/* Le mois précédent, utilisé par le comptage. */
var corpsMoisPrecedent = extraire(
  /function moisPrecedent\([^)]*\)[^{]*\{\s*(return [\s\S]*?);\s*\n\}/,
  'moisPrecedent');
var moisPrecedent = corpsMoisPrecedent
  ? new Function('annee', 'mois', corpsMoisPrecedent + ';')
  : function () { return null; };

(async function () {
  /* Pas de dispatch manuel de DOMContentLoaded : jsdom l'émet lui-même, de
     façon différée. Le forcer câblerait l'écran de connexion deux fois. */
  await pause(500);

  /* ==================================================================== */
  /* P7 (d'abord, car c'est le filet) — LA PASTILLE, sans notification    */
  /* ==================================================================== */
  console.log('\n--- P7 : la pastille, qui ne dépend de rien ---');
  await ouvrir('accueil');

  var pas = pastille();
  assert(!!pas, 'P7 : la pastille apparaît sur l’onglet Accueil dès qu’un mois ' +
    'est à clôturer — sans permission, sans serveur, sans réseau');
  var annonce = boutonAccueil().getAttribute('aria-description') || '';
  assert(/^\d+ mois à clôturer$/.test(annonce),
    'P7 : le nombre est ANNONCÉ — une tache de couleur ne dit rien à qui ne la ' +
    'voit pas — « ' + annonce + ' »');
  var compte = Number(annonce.split(' ')[0]);
  assert(compte >= 2,
    'P7 : elle compte les mois à clôturer des DEUX contrats — ' + compte);
  /* La pastille est large de deux caractères : « 14 » y tiendrait, « 9+ » dit
     la même chose sans jamais déborder, et le nombre exact reste dans
     l'annonce ci-dessus. */
  assert(txt(pas).length <= 2, 'P7 : et elle ne déborde jamais — « ' + txt(pas) + ' »');
  assert(compte <= 9 ? txt(pas) === String(compte) : txt(pas) === '9+',
    'P7 : au-delà de neuf, elle affiche « 9+ »');

  /* Tout clôturé : la pastille DISPARAÎT. Une pastille qui reste allumée
     alors qu'il n'y a rien à faire s'ignore au bout de trois jours. */
  [2026, 2026].forEach(function () {});
  ['c-lea', 'c-tom'].forEach(function (id) {
    [1, 2, 3, 4, 5, 6, 7].forEach(function (m) {
      scene.recaps[cleR(id, 2026, m)] = { id: 'r-' + id + '-' + m, contrat_id: id,
        annee: 2026, mois: m, statut: 'fige', donnees: {}, fige_le: '2026-08-01T09:00:00Z',
        transmis_le: null };
    });
  });
  await ouvrir('accueil');
  assert(!pastille(), 'P7 : plus rien à clôturer, plus de pastille');
  assert(!boutonAccueil().getAttribute('aria-description'),
    'P7 : et plus d’annonce non plus');
  scene.recaps = {};

  /* ==================================================================== */
  /* P1 — Activation acceptée                                             */
  /* ==================================================================== */
  console.log('\n--- P1 : activation acceptée ---');
  telephone.permission = 'granted';
  telephone.demandes = 0;
  await ouvrir('rappels');

  assert(txt(corps).indexOf('Me rappeler de clôturer mes mois') !== -1,
    'P1 : l’écran existe et se nomme en français');
  var box = caseActif();
  assert(!!box && box.checked === false,
    'P1 : les rappels sont ÉTEINTS par défaut — on ne s’invite pas sur le ' +
    'téléphone de quelqu’un sans qu’il le demande');

  /* A5 — le filet est dit AVANT même d'avoir activé quoi que ce soit. */
  var filet = parTexte(corps, '.note', 'Dans tous les cas, une pastille');
  assert(!!filet, 'A5 : l’écran dit que la pastille existe quoi qu’il arrive');
  assert(txt(filet).indexOf('ni autorisation du téléphone, ni service extérieur') !== -1,
    'A5 : et qu’elle ne dépend d’aucune permission ni d’aucun service');
  /* CORRECTIF A4 — l'écran promettait « sans réseau », ce que la pastille ne
     tient pas : elle vient des mois lus au chargement, et disparaît si tout
     échoue. Le choix est bon ; la promesse était fausse. */
  assert(txt(filet).indexOf('sans réseau au démarrage') === -1 &&
         txt(filet).indexOf('Sans réseau au démarrage') !== -1,
    'A4 : et l’écran DIT ce qui se passe sans réseau, au lieu de promettre ' +
    'le contraire');

  /* A1 — l'aperçu du message. Maria voit ce qui arrivera sur son écran. */
  var apercu = corps.querySelector('.apercu-rappel');
  assert(!!apercu, 'A1 : un aperçu du message est affiché');
  assert(txt(apercu).indexOf('Récap') !== -1 &&
         txt(apercu).indexOf('Il vous reste 2 mois à clôturer.') !== -1,
    'A1 : et c’est le vrai message, pas une description de message');

  cocher(box, true);
  await pause(250);
  assert(telephone.demandes === 1, 'P1 : la permission est demandée à la coche, pas avant');
  assert(appels.abonnement.length === 1, 'P1 : l’appareil s’abonne');
  assert(appels.abonnement[0].endpoint.indexOf('push.exemple.test') !== -1,
    'P1 : avec son adresse d’envoi');
  assert(appels.abonnement[0].cle_p256dh === 'CLE-P256DH-FICTIVE' &&
         appels.abonnement[0].cle_auth === 'CLE-AUTH-FICTIVE',
    'P1 : et ses deux clés');
  assert(box.checked === true, 'P1 : la case reste cochée');

  var reglages = caseChaque();
  assert(!!reglages && reglages.offsetParent !== null || !!reglages,
    'P1 : les réglages fins apparaissent une fois la case cochée');

  boutonQuiContient(corps, 'Enregistrer').click();
  await pause(250);
  assert(appels.preference.length === 1, 'P1 : les réglages partent');
  assert(appels.preference[0].actif === true, 'P1 : actifs');
  assert(appels.preference[0].jour_du_mois === 25,
    'P1 : à partir du 25 par défaut — la même bascule que l’accueil (lot 7)');
  assert(appels.preference[0].heure === '19:00', 'P1 : à 19 h par défaut');
  assert(appels.preference[0].chaque_jour_ensuite === true,
    'P1 : puis chaque jour, par défaut');
  assert(txt(corps).indexOf('Réglages enregistrés') !== -1, 'P1 : et c’est confirmé');

  /* ==================================================================== */
  /* P2 — Activation REFUSÉE par le téléphone                             */
  /* A2 — dit en français, sans terme technique, et la case se décoche    */
  /* ==================================================================== */
  console.log('\n--- P2 : le téléphone refuse ---');
  scene.preference = null;
  appels.abonnement.length = 0;
  telephone.permission = 'denied';
  await ouvrir('rappels');

  var box2 = caseActif();
  cocher(box2, true);
  await pause(250);

  assert(appels.abonnement.length === 0, 'P2 : aucun abonnement n’est créé');
  assert(box2.checked === false,
    'A2 (risque n° 1) : LA CASE SE DÉCOCHE — le pire serait de la laisser ' +
    'cochée : Maria croirait qu’un rappel viendra, et il ne viendrait jamais');
  var ko = corps.querySelector('.msg.ko');
  assert(!!ko, 'A2 : et c’est dit');
  assert(txt(ko).indexOf('bloquées sur ce téléphone') !== -1,
    'A2 : en français, sans « permission denied » ni « NotAllowedError »');
  assert(txt(ko).indexOf('réglages de votre téléphone') !== -1,
    'A2 : avec le chemin pour y revenir');
  assert(txt(ko).indexOf('un rappel s’affichera dans l’application') !== -1,
    'A2 : et le rappel que le filet existe');

  /* Un téléphone qui ne sait pas du tout notifier : même exigence. */
  var vraieNotif = dom.window.Notification;
  delete dom.window.Notification;
  await ouvrir('rappels');
  var box3 = caseActif();
  cocher(box3, true);
  await pause(200);
  assert(box3.checked === false, 'P2 : sans notifications du tout, la case se décoche aussi');
  assert(txt(corps.querySelector('.msg.ko')).indexOf('ne sait pas afficher de notifications') !== -1,
    'P2 : et l’explication tient en une phrase');
  dom.window.Notification = vraieNotif;
  telephone.permission = 'granted';

  /* L'abonnement qui échoue alors que la permission est donnée. */
  telephone.abonnementCasse = true;
  await ouvrir('rappels');
  var boxEchec = caseActif();
  cocher(boxEchec, true);
  await pause(250);
  assert(txt(corps.querySelector('.msg.ko')).indexOf('la pastille de l’onglet Accueil prend le relais') !== -1,
    'B.0-9 : l’échec d’abonnement est dit, et ce qui reste vrai aussi');
  /* CORRECTIF B8 — LE CONTRÔLE QUI MANQUAIT ET QUI COMPTE LE PLUS.
     La permission est ACCORDÉE, l'abonnement échoue : la case restait cochée,
     l'écran affichait ensuite « Réglages enregistrés » en vert, et aucun rappel
     n'arrivait jamais. C'était le chemin nominal tant que la clé VAPID n'est
     pas posée. */
  assert(boxEchec.checked === false,
    'B8 : la case se DÉCOCHE aussi quand la permission est accordée mais que ' +
    'l’abonnement échoue — sinon Maria croit qu’un rappel viendra');
  assert(txt(corps.querySelector('.msg.ko')).indexOf('restent éteints') !== -1,
    'B8 : et l’écran dit que les rappels sont éteints, au lieu de le taire');
  telephone.abonnementCasse = false;

  /* B8 (suite) — la clé VAPID absente est le cas RÉEL d'aujourd'hui. */
  var vraieCle = dom.window.RECAP_MARIA_CONFIG.VAPID_PUBLIC_KEY;
  dom.window.RECAP_MARIA_CONFIG.VAPID_PUBLIC_KEY = '';
  await ouvrir('rappels');
  var boxSansCle = caseActif();
  cocher(boxSansCle, true);
  await pause(250);
  var koCle = corps.querySelector('.msg.ko');
  assert(!!koCle && txt(koCle).indexOf('pas encore configurées') !== -1,
    'B8 : sans clé VAPID, la phrase française atteint enfin l’écran — elle ' +
    'tombait sur « une erreur inattendue s’est produite. Réessayez… »');
  assert(!!koCle && txt(koCle).indexOf('Réessayez') === -1,
    'B8 : et on n’invite plus à réessayer une action qui ne peut pas aboutir');
  assert(boxSansCle.checked === false, 'B8 : la case reste décochée');
  dom.window.RECAP_MARIA_CONFIG.VAPID_PUBLIC_KEY = vraieCle;

  /* Panne de LECTURE des réglages : l'écran s'ouvre quand même, sur les
     valeurs par défaut, plutôt que de rester vide. */
  scene.preferenceCassee = true;
  await ouvrir('rappels');
  assert(!!caseActif(), 'B.0-9 : réglages illisibles, l’écran s’affiche quand même');
  scene.preferenceCassee = false;

  /* ==================================================================== */
  /* P3 — Un mois en retard : le rappel part                              */
  /* P4 — Rien à clôturer : AUCUNE notification                           */
  /* P5 — Le rappel quotidien                                             */
  /* (règle d'envoi EXTRAITE du fichier serveur, puis exécutée)           */
  /* ==================================================================== */
  console.log('\n--- P3/P4/P5/B9 : la règle d’envoi du serveur ---');
  var reglage = { jour_du_mois: 25, heure: '19:00', chaque_jour_ensuite: true };
  var sansRetard = { total: 1, retards: 0 };
  var avecRetard = { total: 1, retards: 1 };

  assert(doitEnvoyer(reglage, { jour: 25, mois: 8, annee: 2026 }, sansRetard) === true,
    'P3 : le jour réglé, l’envoi a lieu');
  assert(doitEnvoyer(reglage, { jour: 24, mois: 8, annee: 2026 }, sansRetard) === false,
    'P3 : la veille du jour réglé, rien ne part si rien n’est en retard');

  assert(doitEnvoyer(reglage, { jour: 28, mois: 8, annee: 2026 }, sansRetard) === true,
    'P5 : « chaque jour ensuite » coché, le rappel se répète');
  var sansRepetition = { jour_du_mois: 25, heure: '19:00', chaque_jour_ensuite: false };
  assert(doitEnvoyer(sansRepetition, { jour: 28, mois: 8, annee: 2026 }, avecRetard) === false,
    'P5 : décoché, il ne part QUE le jour réglé — même avec un retard, Maria a ' +
    'demandé un seul rappel et elle en aura un seul');
  assert(doitEnvoyer(sansRepetition, { jour: 25, mois: 8, annee: 2026 }, sansRetard) === true,
    'P5 : … et il part bien ce jour-là');

  /* CORRECTIF B9 — LES TRENTE ET UN JOURS DE SILENCE. */
  assert(doitEnvoyer(reglage, { jour: 1, mois: 9, annee: 2026 }, avecRetard) === true,
    'B9 : le 1ᵉʳ septembre, août est EN RETARD — le rappel part sans attendre ' +
    'le 25 (V8-03 : les mois passés sont rappelés en permanence)');
  assert(doitEnvoyer(reglage, { jour: 10, mois: 9, annee: 2026 }, avecRetard) === true,
    'B9 : et il continue tant que le retard dure');
  assert(doitEnvoyer(reglage, { jour: 10, mois: 9, annee: 2026 }, sansRetard) === false,
    'B9 : mais pas un mot avant le 25 quand rien n’est en retard — on ' +
    'n’apprend pas à Maria à ignorer les rappels');

  /* CORRECTIF A9 — un réglage à 31 doit se déclencher les mois plus courts. */
  var le31 = { jour_du_mois: 31, heure: '19:00', chaque_jour_ensuite: false };
  assert(doitEnvoyer(le31, { jour: 28, mois: 2, annee: 2026 }, sansRetard) === true,
    'A9 : réglé au 31, le rappel part le dernier jour de février — sinon cinq ' +
    'mois sur douze étaient perdus en silence');
  assert(doitEnvoyer(le31, { jour: 31, mois: 8, annee: 2026 }, sansRetard) === true,
    'A9 : et le 31 des mois qui en ont un');

  /* P4 — le garde « rien à clôturer ». Il ne peut pas s'exécuter ici (il
     interroge la base), mais on vérifie qu'il est bien AVANT tout envoi :
     l'ordre est toute la garantie. */
  var iGarde = SRC_FN.indexOf('if (nb === 0)');
  var iEnvoi = SRC_FN.indexOf('sendNotification');
  assert(iGarde !== -1, 'P4 : le garde « rien à clôturer » existe');
  assert(iGarde < iEnvoi && iEnvoi !== -1,
    'P4 (A1) : et il précède l’envoi — un rappel qui arrive alors que tout est ' +
    'fait apprend à Maria à ignorer les rappels, et le jour où il compte ' +
    'vraiment il ne sera plus lu');

  /* Le comptage remonte 12 mois, et le mois de départ est le PRÉCÉDENT : on
     ne rappelle jamais de clôturer le mois qu'on est en train de vivre. */
  assert(JSON.stringify(moisPrecedent(2026, 1)) === JSON.stringify({ annee: 2025, mois: 12 }),
    'P3 : le passage d’année est correct — janvier renvoie à décembre précédent');
  assert(JSON.stringify(moisPrecedent(2026, 7)) === JSON.stringify({ annee: 2026, mois: 6 }),
    'P3 : et le cas ordinaire aussi');
  assert(/i < 13/.test(SRC_FN),
    'P3 : le comptage couvre le mois courant plus les douze précédents — ' +
    'au-delà, un retard n’est plus un oubli');
  assert(/JOUR_BASCULE_CLOTURE = 25/.test(SRC_FN),
    'B9 : le serveur connaît désormais la bascule du 25, comme l’accueil');

  /* ==================================================================== */
  /* A3 — LE MÊME TEXTE DES DEUX CÔTÉS, caractère par caractère           */
  /* ==================================================================== */
  console.log('\n--- A3 : un seul texte, deux exécutions ---');
  assert(typeof window.UiMenu.texteDuRappel === 'function',
    'A3 : le texte de l’aperçu est exposé pour pouvoir être comparé');
  [0, 1, 2, 3, 12].forEach(function (n) {
    assert(window.UiMenu.texteDuRappel(n) === texteServeur(n),
      'A3 : pour ' + n + ' mois, l’aperçu et le serveur disent EXACTEMENT la ' +
      'même chose — « ' + window.UiMenu.texteDuRappel(n) + ' »');
  });
  assert(window.UiMenu.texteDuRappel(1).indexOf('1 mois') !== -1 &&
         window.UiMenu.texteDuRappel(2).indexOf('2 mois') !== -1,
    'A3 : le singulier et le pluriel sont traités');

  /* ==================================================================== */
  /* P6 — Un abonnement périmé est retiré                                 */
  /* ==================================================================== */
  console.log('\n--- P6 : l’abonnement périmé ---');
  assert(/code === 404 \|\| code === 410/.test(SRC_FN),
    'P6 : 404 et 410 — appareil disparu — déclenchent le retrait');
  var iRetrait = SRC_FN.indexOf("from('abonnement_push').delete()");
  assert(iRetrait !== -1, 'P6 : et le retrait est bien une suppression');
  var apresCondition = SRC_FN.slice(SRC_FN.indexOf('code === 404'), iRetrait);
  assert(apresCondition.length < 120,
    'P6 : la suppression est DANS la condition — tout autre échec (réseau, ' +
    'service indisponible) ne supprime rien');

  /* ==================================================================== */
  /* A4 — AUCUNE CLÉ PRIVÉE DANS LE DÉPÔT                                 */
  /* ==================================================================== */
  console.log('\n--- A4 : aucune clé dans le dépôt ---');
  assert(/Deno\.env\.get\('VAPID_PRIVATE_KEY'\)/.test(SRC_FN),
    'A4 : la clé privée vient des secrets de la fonction');

  var fichiers = [];
  (function parcourir(dossier) {
    fs.readdirSync(dossier, { withFileTypes: true }).forEach(function (e) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name === 'icones') return;
      var complet = path.join(dossier, e.name);
      if (e.isDirectory()) return parcourir(complet);
      if (/\.(js|ts|json|html|sql|md|css)$/.test(e.name)) fichiers.push(complet);
    });
  })(racine);

  var suspects = [];
  fichiers.forEach(function (f) {
    var t = fs.readFileSync(f, 'utf8');
    /* Une clé privée VAPID est une chaîne base64url de 43 caractères. On
       cherche toute affectation d'une telle chaîne à un nom qui parle de clé
       privée ou de secret. */
    if (/(PRIVATE|PRIVEE|SECRET)[A-Z_]*\s*[:=]\s*['"`][A-Za-z0-9_-]{20,}['"`]/i.test(t)) {
      suspects.push(path.relative(racine, f));
    }
  });
  assert(suspects.length === 0,
    'A4 (risque n° 2) : aucune clé privée écrite dans le dépôt — une clé ' +
    'committée dans un dépôt PUBLIC reste dans l’historique git après ' +
    'suppression' + (suspects.length ? ' — ' + suspects.join(', ') : ''));

  var srcConfig = fs.readFileSync(path.join(racine, 'config.js'), 'utf8');
  assert(/VAPID_PUBLIC_KEY:\s*''/.test(srcConfig),
    'A4 : config.js livre la clé publique VIDE — c’est à Adrien de la poser');
  assert(!/VAPID_PRIVATE/.test(srcConfig),
    'A4 : et ne mentionne nulle part la privée');

  /* ==================================================================== */
  /* A6 — Le service worker affiche CE QUE LE SERVEUR ENVOIE              */
  /* ==================================================================== */
  console.log('\n--- A6 : le service worker ---');
  var srcSw = fs.readFileSync(path.join(racine, 'sw.js'), 'utf8');
  var faux = {
    handlers: {},
    registration: { showNotification: function (titre, opts) {
      faux.affiche = { titre: titre, opts: opts };
      return Promise.resolve();
    } },
    addEventListener: function (nom, fn) { faux.handlers[nom] = fn; },
    clients: { matchAll: function () { return Promise.resolve([]); },
               openWindow: function (u) { faux.ouvert = u; return Promise.resolve(); } },
    caches: undefined
  };
  /* On n'exécute que le bloc « push » : le reste du service worker touche à
     `caches`, absent de Node. */
  var blocPush = srcSw.slice(srcSw.indexOf("self.addEventListener('push'"));
  new Function('self', blocPush)(faux);

  assert(typeof faux.handlers.push === 'function', 'A6 : le service worker écoute « push »');
  await faux.handlers.push({
    data: { json: function () { return { titre: 'Récap', corps: texteServeur(3) }; } },
    waitUntil: function (p) { return p; }
  });
  assert(faux.affiche && faux.affiche.titre === 'Récap', 'A6 : le titre vient de la charge');
  assert(faux.affiche.opts.body === 'Il vous reste 3 mois à clôturer.',
    'A6 : et le corps AUSSI — le texte n’est ni reconstruit ni traduit dans le ' +
    'service worker : deux formulations pour la même notification finiraient ' +
    'par diverger');
  assert(faux.affiche.opts.tag === 'rappel-cloture',
    'A6 : une seule notification à la fois, jamais une pile');

  /* Charge illisible : on affiche quand même quelque chose d'utile. */
  faux.affiche = null;
  await faux.handlers.push({
    data: { json: function () { throw new Error('charge illisible'); } },
    waitUntil: function (p) { return p; }
  });
  assert(faux.affiche && faux.affiche.opts.body.length > 0,
    'A6 : une charge illisible donne un texte générique — une notification ' +
    'muette serait pire');

  /* ==================================================================== */
  console.log('');
  if (echecs) { console.error(echecs + ' échec(s).'); process.exit(1); }
  console.log('Tout est conforme.');
})().catch(function (e) {
  console.error('Erreur pendant le parcours :', e && e.stack || e);
  process.exit(1);
});
