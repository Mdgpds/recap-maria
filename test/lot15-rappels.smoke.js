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
/* LOT 31 — deux aides de lecture, du même modèle que les autres tests de
   fumée : elles disent CE QUI MANQUE quand elles échouent, pas seulement
   qu'elles ont échoué. */
function contient(el, morceau, msg) {
  var ok = txt(el).replace(/[\u00a0\u202f]/g, ' ').indexOf(morceau) !== -1;
  assert(ok, ok ? msg : msg + ' — « ' + morceau + ' » introuvable dans : ' +
    txt(el).slice(0, 300));
}
function absent(el, morceau, msg) {
  var ok = txt(el).replace(/[\u00a0\u202f]/g, ' ').indexOf(morceau) === -1;
  assert(ok, ok ? msg : msg + ' — « ' + morceau + ' » ne devrait pas être là');
}
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
  etatPermission: 'default',    // ce que Notification.permission rend
  abonne: false,                // l'abonnement que le navigateur détient
  demandes: 0
};

function installerTelephone() {
  if (!telephone.supporte) {
    delete dom.window.Notification;
    delete dom.window.navigator.serviceWorker;
    return;
  }
  dom.window.Notification = {
    get permission() { return telephone.etatPermission || 'default'; },
    requestPermission: function () {
      telephone.demandes++;
      if (telephone.permission === 'granted') telephone.etatPermission = 'granted';
      else telephone.etatPermission = 'denied';
      return Promise.resolve(telephone.permission);
    }
  };
  var ABONNEMENT = {
    toJSON: function () {
      return {
        endpoint: 'https://push.exemple.test/abonnement-fictif',
        keys: { p256dh: 'CLE-P256DH-FICTIVE', auth: 'CLE-AUTH-FICTIVE' }
      };
    },
    unsubscribe: function () { telephone.abonne = false; return Promise.resolve(true); }
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
            /* LOT 32 §9 — l'écran lit l'abonnement que le navigateur détient
               ENCORE : c'est ce qui distingue « actif » de « à autoriser ». */
            getSubscription: function () {
              return Promise.resolve(telephone.abonne ? ABONNEMENT : null);
            },
            subscribe: function () {
              if (telephone.abonnementCasse) {
                return Promise.reject(new Error('Failed to fetch'));
              }
              telephone.abonne = true;
              return Promise.resolve(ABONNEMENT);
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
    var avant = scene.preference || { actif: false, jour_du_mois: 25, heure: '19:00',
      chaque_jour_ensuite: true, quoi: 'les_deux' };
    scene.preference = {
      owner: 'u1',
      actif: champs.actif !== undefined ? champs.actif : avant.actif,
      jour_du_mois: champs.jour_du_mois !== undefined ? champs.jour_du_mois : avant.jour_du_mois,
      heure: champs.heure !== undefined ? champs.heure : avant.heure,
      chaque_jour_ensuite: champs.chaque_jour_ensuite !== undefined ? champs.chaque_jour_ensuite : avant.chaque_jour_ensuite,
      quoi: champs.quoi !== undefined ? champs.quoi : avant.quoi,
      maj_le: '2026-07-28T19:00:00Z'
    };
    return Promise.resolve(scene.preference);
  },
  enregistrerAbonnementPush: function (ab) {
    appels.abonnement.push(ab);
    scene.abonnements = scene.abonnements || [];
    if (scene.abonnements.indexOf(ab.endpoint) === -1) scene.abonnements.push(ab.endpoint);
    return Promise.resolve({ id: 'ab1', endpoint: ab.endpoint, cree_le: '2026-07-28T19:00:00Z' });
  },
  abonnementPushExiste: function (endpoint) {
    return Promise.resolve((scene.abonnements || []).indexOf(endpoint) !== -1);
  },
  supprimerAbonnementPush: function (endpoint) {
    scene.abonnements = (scene.abonnements || []).filter(function (e) { return e !== endpoint; });
    return Promise.resolve(true);
  }
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
function etatW() { return corps.querySelector('.cd .enc.w'); }
function etatI() { return corps.querySelector('.cd .enc.i'); }
function etatO() { return corps.querySelector('.cd .enc.o'); }
function reglagesInactifs() {
  var r = corps.querySelector('.reglages-rappel');
  if (!r) return false;
  var boutons = r.querySelectorAll('button');
  return r.classList.contains('inactifs') && boutons.length > 0 &&
    Array.prototype.every.call(boutons, function (b) { return b.disabled; });
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

/* Le texte du rappel, tel que le serveur le construit : la fonction est
   EXTRAITE entre ses deux repères et exécutée telle quelle. */
var blocTexte = extraire(
  /\/\* TEXTE-RAPPEL-DEBUT \*\/([\s\S]*?)\/\* TEXTE-RAPPEL-FIN \*\//, 'la fonction du texte de rappel');
/* Les annotations TypeScript sont retirées par Node lui-même (Node ≥ 22.13),
   sans réécrire le code : ce qui s'exécute est le bloc du serveur. */
var sansTypes = require('node:module').stripTypeScriptTypes;
var texteServeur = blocTexte
  ? new Function('info', sansTypes(blocTexte) + '\nreturn texteDuRappel(info);')
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
  /* LOT 22 §22.3 A2, remarque 3 de la relecture — LA PASTILLE AFFICHE LE
     COMPTE RÉEL, plus « 9+ ». Avec quatre contrats, trois mois de retard en
     font douze : « 9+ » cachait précisément le cas où le chiffre compte. La
     pastille s'élargit d'elle-même (`min-width` et `padding` en CSS), et
     l'annonce vocale disait déjà le vrai nombre — les deux concordent enfin. */
  assert(txt(pas) === String(compte),
    'P7 : la pastille affiche le COMPTE RÉEL — « ' + txt(pas) + ' » pour ' + compte);
  assert(txt(pas) === annonce.split(' ')[0],
    'P7 : et elle dit exactement la même chose que l’annonce vocale');

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
  /* LOT 32 §9 — TROIS ÉTATS, UN SEUL AFFICHÉ                              */
  /*                                                                     */
  /* L'écran des rappels a été refait au lot 32 : plus de case à cocher   */
  /* « Recevoir un rappel », mais trois états — non configuré (clé vide), */
  /* configuré non autorisé (bouton « Autoriser les rappels »), actif —   */
  /* et des réglages en composants du socle (stepper, segmenté, choix).   */
  /* CHAQUE EXIGENCE DU LOT 15 EST CONSERVÉE, sous sa nouvelle forme : la  */
  /* permission demandée AU GESTE, l'abonnement écrit avec ses deux clés, */
  /* le refus dit en français, l'échec d'abonnement qui ne laisse jamais  */
  /* croire qu'un rappel viendra, la préférence enregistrée, le filet.    */
  /* ==================================================================== */

  /* --- P1 : activation acceptée --------------------------------------- */
  console.log('\n--- P1 : activation acceptée (au geste, jamais au chargement) ---');
  telephone.permission = 'granted';
  telephone.etatPermission = 'default';
  telephone.abonne = false;
  telephone.demandes = 0;
  scene.abonnements = [];
  await ouvrir('rappels');

  assert(txt(corps).indexOf('Me rappeler de clôturer mes mois') !== -1,
    'P1 : l’écran existe et se nomme en français');
  assert(telephone.demandes === 0,
    'P1 (§9.2) : AUCUNE permission demandée au chargement — on ne s’invite pas ' +
    'sur le téléphone de quelqu’un sans qu’il le demande');
  assert(!!etatI() && txt(etatI()).indexOf('il reste à les autoriser') !== -1,
    '§9.1 : clé présente, permission non donnée — l’écran est en « configuré, ' +
    'non autorisé », en `.enc.i`');
  assert(!etatO() && !etatW(), '§9.1 : et dans aucun autre état');
  var bAut = boutonQuiContient(corps, 'Autoriser les rappels');
  assert(!!bAut, '§9.1 : avec le bouton « Autoriser les rappels »');
  assert(reglagesInactifs(), '§9.1 : les réglages sont visibles mais INACTIFS tant que rien n’est autorisé');

  /* A5 — le filet est dit AVANT même d'avoir activé quoi que ce soit. */
  var filet = parTexte(corps, '.enc', 'Dans tous les cas, une pastille');
  assert(!!filet, 'A5 : l’écran dit que la pastille existe quoi qu’il arrive');
  assert(txt(filet).indexOf('ni autorisation du téléphone, ni service extérieur') !== -1,
    'A5 : et qu’elle ne dépend d’aucune permission ni d’aucun service');
  assert(txt(filet).indexOf('sans réseau au démarrage') === -1 &&
         txt(filet).indexOf('Sans réseau au démarrage') !== -1,
    'A4 : et l’écran DIT ce qui se passe sans réseau, au lieu de promettre ' +
    'le contraire');

  /* A1 — l'aperçu du message. Maria voit ce qui arrivera sur son écran. */
  var apercu = corps.querySelector('.apercu-rappel');
  assert(!!apercu, 'A1 : un aperçu du message est affiché');
  assert(txt(apercu).indexOf('Récap') !== -1 &&
         txt(apercu).indexOf('Août est terminé. Il reste 1 journée à déclarer avant de clôturer.') !== -1 &&
         txt(apercu).indexOf('Vous n’avez pas encore clôturé le mois de juillet.') !== -1,
    'A1 : et c’est le vrai message (§9.4), pas une description de message');
  assert(!/Léa|Tom|Foyer/.test(txt(apercu)),
    '§9.4 : aucun prénom d’enfant ni nom de famille dans le rappel — il s’affiche ' +
    'sur un écran verrouillé');

  bAut.click();
  await pause(300);
  assert(telephone.demandes === 1, 'P1 : la permission est demandée AU GESTE, pas avant');
  assert(appels.abonnement.length === 1, 'P1 : l’appareil s’abonne');
  assert(appels.abonnement[0].endpoint.indexOf('push.exemple.test') !== -1,
    'P1 : avec son adresse d’envoi');
  assert(appels.abonnement[0].cle_p256dh === 'CLE-P256DH-FICTIVE' &&
         appels.abonnement[0].cle_auth === 'CLE-AUTH-FICTIVE',
    'P1 : et ses deux clés');
  await pause(300);
  assert(!!etatO() && txt(etatO()).indexOf('Les rappels sont actifs sur cet appareil') !== -1,
    '§9.1 : clé + permission + abonnement enregistré — l’écran passe en « actif », en `.enc.o`');
  assert(!boutonQuiContient(corps, 'Autoriser les rappels'), '§9.1 : le bouton d’autorisation a disparu');
  assert(!reglagesInactifs(), '§9.1 : les réglages deviennent actifs');
  assert(appels.preference.length >= 1 && appels.preference[appels.preference.length - 1].actif === true,
    'P1 : l’abonnement enregistre la préférence « actif »');

  /* Les réglages : jour (stepper, 20-31), heure (stepper), répétition
     (segmenté), quoi rappeler (choix cochables — jamais une liste déroulante). */
  assert(corps.querySelectorAll('.reglages-rappel select').length === 0,
    '§9.3 : aucune liste déroulante dans les réglages');
  assert(corps.querySelectorAll('.reglages-rappel .ch').length === 3,
    '§9.3 : trois choix cochables pour « quoi rappeler »');
  var chJournees = parTexte(corps, '.ch', 'Les journées non déclarées');
  chJournees.click();
  await pause(100);
  assert(chJournees.classList.contains('on') && corps.querySelectorAll('.ch.on').length === 1,
    '§9.3 : un seul choix coché à la fois');
  assert(txt(corps.querySelector('.apercu-rappel')).indexOf('Vous n’avez pas encore clôturé') === -1,
    '§9.4 : l’aperçu suit le choix — « journées » seul ne parle plus de clôture');
  parTexte(corps, '.ch', 'Les deux').click();

  appels.preference.length = 0;
  boutonQuiContient(corps, 'Enregistrer').click();
  await pause(250);
  assert(appels.preference.length === 1, 'P1 : les réglages partent');
  assert(appels.preference[0].actif === true, 'P1 : actifs');
  assert(appels.preference[0].jour_du_mois === 25,
    'P1 : à partir du 25 par défaut — la même bascule que l’accueil (lot 7)');
  assert(appels.preference[0].heure === '19:00', 'P1 : à 19 h par défaut');
  assert(appels.preference[0].chaque_jour_ensuite === true,
    'P1 : puis chaque jour, par défaut');
  assert(appels.preference[0].quoi === 'les_deux', '§9.3 : et « les deux » par défaut');
  assert(txt(corps).indexOf('Réglages enregistrés') !== -1, 'P1 : et c’est confirmé');

  /* Un abonnement devenu invalide — le navigateur l'a révoqué — n'est plus
     « actif » : l'écran repasse en « configuré, non autorisé ». */
  telephone.abonne = false;
  await ouvrir('rappels');
  assert(!!etatI() && !!boutonQuiContient(corps, 'Autoriser les rappels'),
    '§9.2 : l’abonnement révoqué par le navigateur, l’écran repasse en « configuré, non autorisé »');
  /* Et un abonnement que la base ne connaît pas non plus. */
  telephone.abonne = true;
  scene.abonnements = [];
  await ouvrir('rappels');
  assert(!!etatI(), '§9.1 : un abonnement absent de la base n’est pas « actif » — le serveur ne l’enverrait à personne');

  /* --- P2 : le téléphone refuse ------------------------------------- */
  console.log('\n--- P2 : le téléphone refuse ---');
  scene.preference = null;
  appels.abonnement.length = 0;
  telephone.permission = 'denied';
  telephone.etatPermission = 'default';
  telephone.abonne = false;
  await ouvrir('rappels');
  boutonQuiContient(corps, 'Autoriser les rappels').click();
  await pause(250);

  assert(appels.abonnement.length === 0, 'P2 : aucun abonnement n’est créé');
  assert(!etatO(), 'A2 (risque n° 1) : l’écran ne passe PAS en « actif » — Maria ne doit pas croire qu’un rappel viendra');
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
  assert(!!etatI() && txt(etatI()).indexOf('ne sait pas afficher de notifications') !== -1,
    'P2 : sans notifications du tout, l’écran le dit en une phrase');
  var bSans = boutonQuiContient(corps, 'Autoriser les rappels');
  assert(!!bSans && bSans.disabled, 'P2 : et le bouton ne propose pas une action impossible');
  dom.window.Notification = vraieNotif;
  telephone.permission = 'granted';

  /* L'abonnement qui échoue alors que la permission est donnée. */
  telephone.abonnementCasse = true;
  telephone.etatPermission = 'default';
  await ouvrir('rappels');
  boutonQuiContient(corps, 'Autoriser les rappels').click();
  await pause(300);
  assert(txt(corps.querySelector('.msg.ko')).indexOf('la pastille de l’onglet Accueil prend le relais') !== -1,
    'B.0-9 : l’échec d’abonnement est dit, et ce qui reste vrai aussi');
  assert(!etatO() && !!boutonQuiContient(corps, 'Autoriser les rappels'),
    'B8 : la permission accordée mais l’abonnement raté, l’écran reste en « non autorisé » — ' +
    'sinon Maria croit qu’un rappel viendra');
  assert(txt(corps.querySelector('.msg.ko')).indexOf('restent éteints') !== -1,
    'B8 : et l’écran dit que les rappels sont éteints, au lieu de le taire');
  telephone.abonnementCasse = false;

  /* --- LOT 31 §7 / LOT 32 §9.1 : la clé VIDE, le cas RÉEL d'aujourd'hui --- */
  console.log('\n--- clé vide : ne rien promettre qu’on ne tient pas ---');
  var vraieCle = dom.window.RECAP_MARIA_CONFIG.VAPID_PUBLIC_KEY;
  dom.window.RECAP_MARIA_CONFIG.VAPID_PUBLIC_KEY = '';
  telephone.demandes = 0;
  appels.abonnement.length = 0;
  await ouvrir('rappels');
  assert(!!etatW() && txt(etatW()).indexOf('Les rappels ne sont pas encore activés sur ce compte') !== -1,
    '§9.1 : clé vide — « non configuré », en `.enc.w`, en tête de l’écran');
  contient(corps, 'elles seront utilisées dès que les notifications seront en service',
    '§7.1 (lot 31) : et il dit que la préférence servira le jour venu');
  assert(reglagesInactifs(), '§9.1 : les réglages sont visibles mais INACTIFS — rien n’active rien quand la clé est vide');
  assert(!boutonQuiContient(corps, 'Autoriser les rappels'),
    '§9.1 : aucun bouton d’autorisation — on ne demande pas une permission qui ne servirait à rien');
  assert(telephone.demandes === 0 && appels.abonnement.length === 0,
    'B8 : ni permission demandée, ni abonnement tenté sans clé');

  /* Le sous-titre du Menu ne doit plus annoncer un rappel qui ne part pas. */
  scene.preference = { actif: true, jour_du_mois: 25, heure: '19:00',
    chaque_jour_ensuite: true };
  await ouvrir('menu');
  await pause(350);
  var ligneMenu = parTexte(corps, '.gr', 'Me rappeler de clôturer mes mois');
  assert(!!ligneMenu, '§7.2 : la ligne du Menu est là');
  contient(ligneMenu, 'Réglages enregistrés — pas encore activés',
    '§7.2 : et son sous-titre dit l’état réel');
  absent(ligneMenu, 'puis chaque jour tant qu’un mois n’est pas clôturé',
    '§7.2 : il n’annonce plus un rappel qui ne partira pas');

  /* Avec la clé, la phrase d’avant revient : ce lot ne casse rien pour le
     jour où le déploiement sera fait. */
  dom.window.RECAP_MARIA_CONFIG.VAPID_PUBLIC_KEY = vraieCle;
  await ouvrir('menu');
  await pause(350);
  contient(parTexte(corps, '.gr', 'Me rappeler de clôturer mes mois'),
    'puis chaque jour tant qu’un mois n’est pas clôturé',
    '§7.2 : la clé posée, le sous-titre redit le réglage — rien n’est perdu');
  await ouvrir('rappels');
  absent(corps, 'Les rappels ne sont pas encore activés',
    '§7.1 : et l’encart disparaît de lui-même');

  /* ==================================================================== */
  /* LOT 31 §8 — « REPRENDRE MES COMPTES » N'EST PLUS PROPOSÉ             */
  /* ==================================================================== */
  console.log('\n--- lot 31 §8 : l’entrée disparaît, l’écran reste ---');

  await ouvrir('menu');
  await pause(350);
  absent(corps, 'Reprendre mes comptes',
    '§8 : l’entrée a disparu du Menu (compteur_initial : 0 ligne en base)');
  absent(corps, 'Vos compteurs papier, une fois',
    '§8 : son sous-titre aussi');

  await ouvrir('reprise');
  await pause(400);
  assert(txt(corps).length > 0 && txt(corps).indexOf('introuvable') === -1,
    '§8 : mais l’écran reste ATTEIGNABLE par sa route — c’est un filet, pas ' +
    'une fonctionnalité retirée');

  /* Panne de LECTURE des réglages : l'écran s'ouvre quand même, sur les
     valeurs par défaut, plutôt que de rester vide. */
  scene.preferenceCassee = true;
  await ouvrir('rappels');
  assert(!!corps.querySelector('.reglages-rappel'), 'B.0-9 : réglages illisibles, l’écran s’affiche quand même');
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
  /* LOT 32 §9.3 — le garde tient compte de ce que Maria a demandé : rien à
     clôturer ET rien à déclarer, rien ne part. */
  var iGarde = SRC_FN.indexOf('nb === 0) && journees === 0');
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
  /* A3 — LE MÊME TEXTE DES DEUX CÔTÉS, sur les mêmes entrées             */
  /* ==================================================================== */
  console.log('\n--- A3 : un seul texte, deux exécutions ---');
  assert(typeof window.UiMenu.texteDuRappel === 'function',
    'A3 : le texte de l’aperçu est exposé pour pouvoir être comparé');
  var CAS_TEXTE = [
    { quoi: 'cloture', moisNonClotures: ['juillet'] },
    { quoi: 'cloture', moisNonClotures: ['août'] },
    { quoi: 'cloture', moisNonClotures: ['juin', 'juillet', 'août'] },
    { quoi: 'journees', moisTermine: 'août', journees: 1 },
    { quoi: 'journees', moisTermine: 'octobre', journees: 3 },
    { quoi: 'les_deux', moisTermine: 'août', journees: 2, moisNonClotures: ['juillet'] },
    { quoi: 'les_deux', moisTermine: 'août', journees: 0, moisNonClotures: ['juillet'] },
    { quoi: 'cloture', moisNonClotures: [] }
  ];
  CAS_TEXTE.forEach(function (cas) {
    assert(window.UiMenu.texteDuRappel(cas) === texteServeur(cas),
      'A3 : l’aperçu et le serveur disent EXACTEMENT la même chose — « ' +
      window.UiMenu.texteDuRappel(cas) + ' »');
  });
  assert(window.UiMenu.texteDuRappel(CAS_TEXTE[0]) === 'Vous n’avez pas encore clôturé le mois de juillet.' &&
         window.UiMenu.texteDuRappel(CAS_TEXTE[3]) === 'Août est terminé. Il reste 1 journée à déclarer avant de clôturer.',
    '§9.4 : ce sont les phrases de la spécification');
  assert(window.UiMenu.texteDuRappel(CAS_TEXTE[1]).indexOf('d’août') !== -1 &&
         window.UiMenu.texteDuRappel(CAS_TEXTE[4]).indexOf('3 journées') !== -1,
    'A3 : l’élision et le pluriel sont traités');
  assert(window.UiMenu.texteDuRappel(CAS_TEXTE[7]) === '',
    'A1 : rien à dire, rien n’est dit — aucune notification vide');


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
    data: { json: function () { return { titre: 'Récap',
      corps: texteServeur({ quoi: 'cloture', moisNonClotures: ['juillet'] }) }; } },
    waitUntil: function (p) { return p; }
  });
  assert(faux.affiche && faux.affiche.titre === 'Récap', 'A6 : le titre vient de la charge');
  assert(faux.affiche.opts.body === 'Vous n’avez pas encore clôturé le mois de juillet.',
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
