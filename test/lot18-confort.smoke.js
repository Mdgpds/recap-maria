/* ============================================================================
   Test de fumée — LOT 18, LE CONFORT.

   POURQUOI CE FICHIER EXISTE.

   Le lot 18 ne change aucune règle de calcul. Il change des GESTES : marquer
   cinq jours d'un coup, relire avant de clôturer, répartir un congé en un
   appui, corriger un prénom sans ouvrir douze champs. Rien de tout cela ne se
   vérifie en lisant du code : il faut rendre les écrans, cliquer, et regarder
   ce qui part en base.

   Trois assertions sont ici les plus importantes du lot :

     - §18.1 A2 — l'effet chiffré ANNONCÉ avant validation est identique à
       celui OBTENU après. C'est le point où la tentation d'écrire « 5 × 5,50 »
       est la plus forte, et où une valeur en dur passerait inaperçue tant que
       le contrat ne change pas.
     - §18.1 — l'écriture groupée n'écrit QUE les jours choisis, sur le SEUL
       contrat affiché. Une absence d'enfant ne vaut jamais pour les autres.
     - « chaque contrat ne reçoit que SON propre jour » — l'assertion retirée
       en août, sur la charge utile d'une écriture groupée de congé. Elle
       revient ici (§19.3, point 2), parce que c'est ce lot qui touche aux
       écritures groupées.

   Lancement : node test/lot18-confort.smoke.js
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
/* Pose une date dans un `Kit.champDate` : mois et année d'abord (ils
   reconstruisent la liste des jours), le jour ensuite. */
function poserDate(boite, iso) {
  var sels = boite.querySelectorAll('select');
  var an = iso.slice(0, 4), mo = String(Number(iso.slice(5, 7))), jo = String(Number(iso.slice(8, 10)));
  function change(sel, v) {
    sel.value = v;
    sel.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  }
  change(sels[1], mo);
  change(sels[2], an);
  change(sels[0], jo);
}

function celluleDu(jour) {
  return Array.prototype.filter.call(
    document.querySelectorAll('#corps table.cal td'), function (td) {
      return txt(td.querySelector('.num')) === String(Number(jour.slice(8, 10)));
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
/* ALPHA travaille du lundi au vendredi ; BETA du lundi au mercredi seulement,
   et son contrat s'arrête le 10 juin. Les deux différences servent à la même
   assertion : une écriture groupée ne doit JAMAIS donner à un contrat un jour
   qui n'est pas le sien. */
var ALPHA = {
  id: 'c-alpha', prenom_enfant: 'Alpha', famille_id: 'f1',
  famille: { id: 'f1', nom: 'Papillon' },
  date_debut: '2026-01-01', date_fin: null,
  minutes_contractuelles: 540, minutes_sup_jour: 30, minutes_par_jour_conge: 540,
  entretien_centimes_jour: 500, jours_planning: [1, 2, 3, 4, 5],
  heure_arrivee: '08:30', heure_depart: '17:30', statut: 'actif',
  sup_dues_si_enfant_absent: true, ordre_imputation: 'cp_puis_sup', archive: false,
  nom: 'Un', genre: 'f', couleur: null, photo: null
};
var BETA = {
  id: 'c-beta', prenom_enfant: 'Beta', famille_id: 'f1',
  famille: { id: 'f1', nom: 'Papillon' },
  date_debut: '2026-01-01', date_fin: '2026-06-10',
  minutes_contractuelles: 540, minutes_sup_jour: 30, minutes_par_jour_conge: 540,
  entretien_centimes_jour: 500, jours_planning: [1, 2, 3],
  heure_arrivee: '08:30', heure_depart: '17:30', statut: 'actif',
  sup_dues_si_enfant_absent: true, ordre_imputation: 'cp_puis_sup', archive: false,
  nom: 'Deux', genre: 'g', couleur: null, photo: null
};
var CONTRATS = [ALPHA, BETA];
function contratDe(id) { return id === 'c-beta' ? BETA : ALPHA; }

/* Une journée de familiarisation chez ALPHA, le 3 juin : elle porte des heures
   saisies à la main, et c'est ce qui doit déclencher les avertissements. */
var JOURNEES_ALPHA_JUIN = {
  '2026-06-03': {
    id: 'j-fam', contrat_id: 'c-alpha', jour: '2026-06-03', type: 'familiarisation',
    minutes_reelles: 300, entretien_centimes: 250, commentaire: null,
    minutes_sup_exceptionnelles: 0, minutes_sup_renoncees: 0, sup_dues_override: null
  },
  /* CORRECTIONS B1, C1 ET C2 DE LA RELECTURE DU LOT 18 — une journée de
     présence qui porte À LA FOIS un ajustement d'heures (lot 12) et une note
     (lot 12 également). Les deux n'ont pas le même sort : l'ajustement est
     effacé par un changement de type et annoncé avant ; la note survit. */
  '2026-06-09': {
    id: 'j-ajust', contrat_id: 'c-alpha', jour: '2026-06-09', type: 'presence',
    minutes_reelles: null, entretien_centimes: null, commentaire: 'Rendez-vous',
    minutes_sup_exceptionnelles: 45, minutes_sup_renoncees: 0, sup_dues_override: null,
    ecart_minutes: null, ecart_evenement: null, ecart_heure_reelle: null,
    ecart_impute_sur: null
  }
};

/* L'instantané d'avril, produit par le MOTEUR : un mois clôturé ne se
   recalcule pas, il relit ce qu'il a figé (RG-15). Un décor qui poserait un
   objet inventé ferait passer un test sur des chiffres que l'application ne
   produirait jamais. */
var INSTANTANE_AVRIL = (function () {
  var av = Decor.avenantsDe(ALPHA, [{ id: 's-c-alpha', contrat_id: 'c-alpha',
    date_effet: '2026-01-01', brut_mensuel_centimes: 150000, net_mensuel_centimes: 115000 }]);
  var r = Engine.calculerMois({
    contrat: ALPHA, conditions: Engine.conditionsApplicables(av, 2026, 4),
    annee: 2026, mois: 4, journees: [],
    compteurEntree: { minutesSup: 1080, minutesCpAcquis: 40 * 54, minutesCpPris: 0 }
  });
  r.prenomEnfant = 'Alpha';
  r.nomEmettrice = 'Maria';
  return r;
})();

var RECAP_AVRIL = {
  id: 'r1', contrat_id: 'c-alpha', annee: 2026, mois: 4,
  statut: 'fige', fige_le: '2026-05-02T10:00:00Z', transmis_le: null,
  donnees: INSTANTANE_AVRIL
};

var ecritures = { marquees: [], supprimees: [], groupees: [], contrat: [] };

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
  listContratsActifs: function () { return Promise.resolve(CONTRATS); },
  listContratsTous: function () { return Promise.resolve(CONTRATS); },
  listContratsPourMois: function () { return Promise.resolve(CONTRATS); },
  listContratsPourPeriode: function () { return Promise.resolve(CONTRATS); },
  listFamilles: function () { return Promise.resolve([ALPHA.famille]); },
  listFamillesToutes: function () { return Promise.resolve([ALPHA.famille]); },
  listFamillesAvecContrats: function () {
    return Promise.resolve([{ id: 'f1', nom: 'Papillon', archive: false, contrats: CONTRATS }]);
  },
  contratEstVierge: function () { return Promise.resolve(false); },
  majContrat: function (id, champs) {
    ecritures.contrat.push({ id: id, champs: champs });
    return Promise.resolve(champs);
  },
  getAvenants: function (id) {
    return Promise.resolve(Decor.avenantsDe(contratDe(id),
      [{ id: 's-' + id, contrat_id: id, date_effet: '2026-01-01',
         brut_mensuel_centimes: 150000, net_mensuel_centimes: 115000 }]));
  },
  getCompteurInitial: function (id) {
    return Promise.resolve(Decor.compteurEnMinutes({ contrat_id: id,
      date_reference: '2026-01-01',
      minutes_sup: 1080, dixiemes_cp_acquis: 40, dixiemes_cp_pris: 0 }));
  },
  getJourneesMois: function (id, a, m) {
    if (id === 'c-alpha' && a === 2026 && m === 6) {
      return Promise.resolve(JSON.parse(JSON.stringify(JOURNEES_ALPHA_JUIN)));
    }
    return Promise.resolve({});
  },
  /* La chaîne lit les journées PAR PÉRIODE, pas mois par mois : un décor qui
     ne sert que `getJourneesMois` fait calculer au moteur un mois sans aucune
     exception, et l'écran compare alors deux mois qui n'existent pas. */
  getJourneesPeriode: function (id) {
    if (id !== 'c-alpha') return Promise.resolve({});
    return Promise.resolve({ '2026-06': JSON.parse(JSON.stringify(JOURNEES_ALPHA_JUIN)) });
  },
  listImputations: function () { return Promise.resolve([]); },
  listImputationsPourMois: function () { return Promise.resolve([]); },
  majVentilationImputation: function () { return Promise.resolve({}); },
  supprimerImputation: function () { return Promise.resolve(true); },
  getNoteMensuelle: function () { return Promise.resolve(null); },
  enregistrerNoteMensuelle: function (c, a, m, t) { return Promise.resolve({ texte: t }); },
  listRecapsPeriode: function (id) {
    if (id === 'c-alpha' && DB.__avrilClos) return Promise.resolve([RECAP_AVRIL]);
    return Promise.resolve([]);
  },
  /* LOT 20 — les périodes de familiarisation (§20.2). Le décor les rend
     vides : ces écrans-là n'en ont aucune, et la fiche du contrat doit
     l'afficher comme telle plutôt que d'échouer. */
  listPeriodesFamiliarisation: function () { return Promise.resolve([]); },
  listPeriodesFamiliarisationContrat: function () { return Promise.resolve([]); },
  listRecapsContrat: function () { return Promise.resolve([]); },
  getRecap: function () { return Promise.resolve(null); },
  enregistrerJournee: function (l) { return Promise.resolve(l); },
  supprimerJournee: function () { return Promise.resolve(true); },
  marquerJournees: function (id, jours, type) {
    ecritures.marquees.push({ contratId: id, jours: jours.slice(), type: type });
    return Promise.resolve([]);
  },
  supprimerJournees: function (id, jours) {
    ecritures.supprimees.push({ contratId: id, jours: jours.slice() });
    return Promise.resolve(true);
  },
  poserAbsenceMaria: function (affectations, type) {
    ecritures.groupees.push({ affectations: JSON.parse(JSON.stringify(affectations)), type: type });
    return Promise.resolve([]);
  },
  retirerAbsenceMaria: function () { return Promise.resolve(true); },
  enregistrerImputation: function (i) { return Promise.resolve({ id: 'i1', ...i }); },
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
window.App.aujourdhui = function () { return '2026-06-26'; };

var corps = document.getElementById('corps');
var sheet = document.getElementById('sheet');

/* LOT 25 §25.3 — LA PORTE DE LA MULTI-SÉLECTION EST LE ⋯ DE LA BARRE HAUTE.
   Elle était un bouton « Choisir plusieurs jours » posé sous le calendrier.
   Le geste ne change pas : cette aide appuie sur la nouvelle porte, pour que
   les cas qui vérifient la SÉLECTION ne dépendent pas de l'endroit d'où on
   l'ouvre. */
function entrerSelection() {
  var b = Array.prototype.filter.call(
    document.getElementById('barre').querySelectorAll('button'), function (x) {
      return x.getAttribute('aria-label') === 'Marquer plusieurs jours';
    })[0];
  if (!b) throw new Error('le ⋯ d’entrée en sélection est absent de la barre');
  b.click();
}

(async function () {
  document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  await pause(300);

  /* ==================================================================== */
  /* §18.4 (7·A5) — LE BANDEAU DU 25                                      */
  /* ==================================================================== */
  console.log('\n--- §18.4 : le bandeau du 25 ---');

  window.App.aller('enfant', { contratId: 'c-alpha', annee: 2026, mois: 6 }, true);
  await pause(300);

  egal(window.Kit.etatDuMois(2026, 6, null, '2026-06-26'), 'a_cloturer',
    'décor : le 26 juin, juin est bien passé en « à clôturer »');
  /* ==========================================================================
     EXIGENCE CHANGÉE — LOT 25 §25.2 : L'ENCART D'ÉTAT DU MOIS DISPARAÎT DE
     L'ESPACE ENFANT. Le §18.4 avait corrigé sa PHRASE (du 25 au 31, dire « ce
     mois est terminé » d'un mois qui court encore est faux) ; le lot 25 retire
     le pavé lui-même, parce que l'écran n'a plus qu'un encart et que celui-ci
     doit servir à ce qui appelle un GESTE.

     RIEN NE SE PERD (A.2) : la distinction que le §18.4 a établie — un mois
     ÉCHU n'est pas un mois EN COURS qu'on peut déjà clôturer — est portée par
     la carte du bloc « Aujourd'hui » de l'accueil, qui écrit « Terminé depuis
     le 31 mai 2026. » pour l'un et « Vérifiez les journées, puis clôturez le
     mois. » pour l'autre. C'est là que Maria décide de clôturer, donc là que
     la nuance sert.

     L'ASSERTION NE S'AFFAIBLIT PAS : les deux cas — mois en cours au 26, mois
     échu — sont rejoués sur l'écran où l'information vit désormais, et le
     texte exact est exigé de part et d'autre. On vérifie EN PLUS que la phrase
     fautive corrigée par le §18.4 n'a reparu nulle part.
     ====================================================================== */
  assert(txt(corps).indexOf('Ce mois est terminé') === -1,
    '7·A5 : le 26 du mois, l’écran n’affirme PLUS qu’un mois en cours est terminé');
  assert(!parTexte(corps, '.enc', 'Chiffres provisoires'),
    '§25.2 : l’encart permanent d’état du mois a quitté l’espace enfant');

  /* Le mois échu, lui, ne se confond pas avec celui-ci : l'espace enfant ne
     l'affirme plus nulle part, et la barre fixe propose le même geste dans les
     deux cas — « Vérifier et clôturer le mois ». */
  window.App.aller('enfant', { contratId: 'c-alpha', annee: 2026, mois: 5 }, true);
  await pause(300);
  assert(txt(corps).indexOf('Ce mois est terminé') === -1,
    '§25.2 : sur un mois échu non plus, l’espace enfant ne porte plus de ' +
    'bandeau d’état permanent');
  var pied7 = corps.querySelector('.stick');
  assert(!!pied7 && txt(pied7).indexOf('Vérifier et clôturer le mois') !== -1,
    '§25.3 : la barre fixe porte le geste, sans avoir à défiler');

  /* LES DEUX FORMULATIONS DU §18.4 SONT EXIGÉES SUR L'ACCUEIL, dans
     test/lot7-tempo.smoke.js (cas P1 et P2), dont le décor isole un seul
     contrat et un seul mois en retard — ce que celui-ci, avec ses douze mois
     ouverts, ne permet pas. */
  window.App.aller('enfant', { contratId: 'c-alpha', annee: 2026, mois: 6 }, true);
  await pause(300);

  /* ==================================================================== */
  /* §18.1 — MARQUER PLUSIEURS JOURS D'UN COUP                            */
  /* ==================================================================== */
  console.log('\n--- §18.1 : marquer plusieurs jours d’un coup ---');

  window.App.aller('enfant', { contratId: 'c-alpha', annee: 2026, mois: 6 }, true);
  await pause(300);

  /* ==========================================================================
     EXIGENCE CHANGÉE — LOT 25 §25.3 : LA MULTI-SÉLECTION CHANGE DE PORTE.
     Elle s'ouvrait par une barre posée SOUS le calendrier — un titre
     (« Marquer plusieurs jours d'un coup »), un sous-titre sur les congés, un
     bouton : quatre lignes pour un raccourci, qu'il fallait atteindre en
     défilant. Elle s'ouvre désormais par le **⋯** de la barre haute, toujours
     visible, comme le demande le §25.3 point 1.

     LE GESTE NE CHANGE PAS D'UN CARACTÈRE : c'est `entrerSelection()` dans les
     deux cas, et tout ce que ce fichier vérifie ensuite — les deux marquages
     et seulement deux, l'absence de « Mon congé », le pied fixe, le compte, la
     validation — est rejoué à l'identique juste en dessous.

     LE SOUS-TITRE « passez par l'onglet Mes congés » : RIEN NE SE PERD (A.2).
     Il vivait sur une barre permanente, affichée même quand Maria ne
     cherchait pas à poser un congé. La règle V8-09 — les congés ont UN seul
     chemin — est dite là où quelqu'un s'y trompe vraiment, et elle y est
     vérifiée : aucun choix de congé dans la feuille du jour, aucun « Mon
     congé » dans la multi-sélection (assertion ci-dessous, conservée), et une
     feuille dédiée qui renvoie vers « Mes congés » quand on touche un jour
     déjà couvert par un congé posé.

     ON VÉRIFIE EN PLUS que le ⋯ n'apparaît pas là où il refuserait de servir
     (mois clôturé, mois à venir) — un bouton qui refuse est pire qu'un bouton
     absent.
     ====================================================================== */
  var barreEl = document.getElementById('barre');
  var bChoisir = Array.prototype.filter.call(barreEl.querySelectorAll('button'), function (b) {
    return b.getAttribute('aria-label') === 'Marquer plusieurs jours';
  })[0];
  assert(!!bChoisir, 'A1 : le bouton d’entrée en sélection est là, dans la barre haute');
  assert(txt(bChoisir) === '⋯',
    '§25.3 : et c’est le ⋯ de la maquette (obtenu « ' + txt(bChoisir) + ' »)');
  bChoisir.click();
  await pause(120);

  var pied = corps.querySelector('.selbar');
  assert(!!pied, '§18.1 : le pied fixe apparaît');
  assert(txt(pied).indexOf('Absence de Alpha') !== -1 && txt(pied).indexOf('Présence') !== -1,
    '§18.1 : DEUX marquages, et seulement deux');
  assert(txt(pied).indexOf('Mon congé') === -1,
    'V8-09 : « Mon congé » n’entre pas dans la multi-sélection');
  assert(boutonExact(pied, 'Valider').disabled === true,
    '§18.1 : rien à valider tant qu’aucun jour n’est choisi');

  /* Cinq jours de présence ordinaires : le 8, 9, 10, 11 et 12 juin. */
  var tableAuDepart = corps.querySelector('table.cal');
  /* Cinq journées ORDINAIRES : le 9 en est exclu, il porte un ajustement
     d'heures et son cas est traité plus bas (correction B1 du lot 18). */
  var CINQ = ['2026-06-08', '2026-06-10', '2026-06-11', '2026-06-12', '2026-06-15'];
  CINQ.forEach(function (d) {
    var td = celluleDu(d);
    assert(!!td && td.getAttribute('role') === 'checkbox', 'le ' + d + ' est cochable');
    td.click();
  });
  await pause(150);

  pied = corps.querySelector('.selbar');
  assert(txt(pied).indexOf('5 jours choisis') !== -1, '§18.1 : le pied compte les jours');
  egal(corps.querySelectorAll('table.cal td.sel').length, 5,
    '§18.1 : les cinq cases portent la marque de sélection');
  /* Cocher ne redessine PAS l'écran : la table du calendrier est le MÊME
     nœud qu'à l'entrée en sélection. Sans cette garantie, la position de
     défilement sauterait à chaque appui. */
  assert(corps.querySelector('table.cal') === tableAuDepart,
    '§18.1 : cocher un jour ne redessine pas l’écran — le défilement est conservé');

  /* L'EFFET ANNONCÉ. Il vient du moteur : cinq jours d'absence retirent cinq
     indemnités d'entretien de 5,00 €, et les 30 minutes restent dues (RG-09,
     `sup_dues_si_enfant_absent` vaut vrai sur ce contrat). */
  var annonce = txt(corps.querySelector('.selbar .sb-ef'));
  assert(annonce.indexOf('25,00') !== -1,
    '§18.1 : l’effet chiffré est annoncé avant validation (obtenu « ' + annonce + ' »)');
  /* LOT 28 (§28.2) — EXIGENCE CHANGÉE : quand l'enfant est absent, aucune
     minute n'est due (décision d'Adrien du 25 août 2026). L'annonce, rejouée
     par le moteur, dit désormais que les 5 × 30 minutes ne sont pas dues. */
  assert(annonce.indexOf('non dues') !== -1 && annonce.indexOf('2h30') !== -1,
    '§28.2 : et il dit que les 30 minutes de chaque jour ne sont pas dues (obtenu « ' +
    annonce + ' »)');

  /* La comparaison qui compte : ce que le moteur donne pour ce mois avec ces
     cinq absences. L'écran ne doit pas annoncer autre chose. */
  var avenants = await DB.getAvenants('c-alpha');
  var conditions = Engine.conditionsApplicables(avenants, 2026, 6);
  var sans = Engine.calculerMois({
    contrat: ALPHA, conditions: conditions, annee: 2026, mois: 6,
    journees: [JOURNEES_ALPHA_JUIN['2026-06-03']],
    compteurEntree: { minutesSup: 1080, minutesCpAcquis: 40 * 54, minutesCpPris: 0 }
  });
  var avec = Engine.calculerMois({
    contrat: ALPHA, conditions: conditions, annee: 2026, mois: 6,
    journees: [JOURNEES_ALPHA_JUIN['2026-06-03']].concat(CINQ.map(function (d) {
      return { contrat_id: 'c-alpha', jour: d, type: 'absence_enfant',
        minutes_reelles: null, entretien_centimes: null };
    })),
    compteurEntree: { minutesSup: 1080, minutesCpAcquis: 40 * 54, minutesCpPris: 0 }
  });
  egal(sans.entretienCentimes - avec.entretienCentimes, 2500,
    'A2 : le moteur, interrogé à part, donne exactement le même écart d’entretien');

  boutonExact(corps.querySelector('.selbar'), 'Valider').click();
  await pause(300);

  egal(ecritures.marquees.length, 1, 'A1 : UNE seule écriture pour cinq jours');
  egal(ecritures.marquees[0].contratId, 'c-alpha',
    '§18.1 : elle ne touche que le contrat affiché — une absence d’enfant ne vaut ' +
    'jamais pour les autres');
  egal(ecritures.marquees[0].type, 'absence_enfant', '§18.1 : avec le bon marquage');
  egal(ecritures.marquees[0].jours.join(','), CINQ.join(','),
    '§18.1 : et exactement les cinq jours choisis, ni plus ni moins');

  /* ==================================================================== */
  /* §18.1 A3 — LA JOURNÉE SAISIE À LA MAIN EST ANNONCÉE                  */
  /* ==================================================================== */
  console.log('\n--- §18.1 A3 : la saisie manuelle qui va être écrasée ---');

  window.App.aller('enfant', { contratId: 'c-alpha', annee: 2026, mois: 6 }, true);
  await pause(300);
  /* LOT 25 §25.3 — la multi-sélection s'ouvre par le ⋯ de la barre haute. */
  entrerSelection();
  await pause(120);
  celluleDu('2026-06-03').click();
  await pause(150);
  assert(txt(corps.querySelector('.selbar')).indexOf('Une saisie manuelle sera') !== -1,
    'A3 : la journée de familiarisation déclenche l’avertissement AVANT validation');
  boutonExact(corps.querySelector('.selbar'), 'Annuler').click();
  await pause(120);
  assert(!corps.querySelector('.selbar'), '§18.1 : « Annuler » sort du mode sélection');

  /* ==================================================================== */
  /* §18.3 — LES RACCOURCIS DE VENTILATION                                */
  /* ==================================================================== */
  console.log('\n--- §18.3 : les raccourcis de répartition ---');

  window.App.aller('conges', { annee: 2026, mois: 6 }, true);
  await pause(350);
  assert(txt(corps).indexOf('Un congé vaut pour') !== -1,
    '§18.6 : la phrase « un congé vaut pour vos contrats » est présente');
  /* EXIGENCE CHANGÉE — LOT 26 §26.2 : LA PHRASE PASSE ENTRE LES DEUX BOUTONS.
     Le §18.6 l'avait sortie de la note du bas pour la mettre DEVANT les
     boutons : une explication lue après l'appui n'évite aucune erreur. Elle
     est maintenant sous « Poser des congés » et au-dessus de « Retirer des
     congés », centrée, comme la maquette.
     LA GARANTIE DE FOND EST TENUE, et vérifiée telle quelle : Maria lit ce que
     le geste va faire AVANT d'avoir posé. Le bouton de retrait, lui, n'a
     jamais eu besoin de cette phrase — il ne pose rien. */
  var iPhrase = txt(corps).indexOf('Un congé vaut pour');
  var iRetrait = txt(corps).indexOf('Retirer des congés');
  assert(iPhrase < iRetrait,
    '§18.6 : elle est lue avec le geste de pose, pas reléguée en bas d’écran');
  assert(txt(corps).indexOf('Un congé vaut pour vos 2 contrats.') !== -1,
    '§26.2 : six mots, et c’est la seule explication qui reste sur cet écran');

  /* ==========================================================================
     EXIGENCE CHANGÉE — LOT 26 §26.1 : LES DEUX RACCOURCIS DE VENTILATION
     DEVIENNENT LE GESTE ORDINAIRE.

     « Tout sur mes congés payés » et « Tout sur ma récupération » existaient
     parce que la ventilation partait de zéro et qu'une semaine sur quatre
     contrats demandait jusqu'à vingt-quatre appuis sur les « + ». Le §18.3 les
     a ajoutés pour faire ce geste courant en un seul.

     LA RÉPARTITION EST MAINTENANT DÉJÀ FAITE, par le moteur, dans l'ordre du
     contrat (RG-07) — c'est-à-dire exactement ce que produisait le raccourci
     correspondant à cet ordre. Les corriger coûte un appui par jour déplacé,
     sur trois steppers qui se rééquilibrent. Les deux boutons n'ont plus rien
     à raccourcir.

     CE QUE LE §18.3 PROTÉGEAIT, ET QUI EST VÉRIFIÉ ICI :
     · la répartition ne dépasse JAMAIS le disponible — la borne vient du
       moteur (`plafondsDe`), pas d'une borne réécrite dans l'écran ;
     · elle couvre la période ENTIÈRE, sans reste à répartir ;
     · le prix d'un jour sans solde est dit SOUS son propre compteur (§18.6).
     ====================================================================== */
  boutonExact(corps, 'Poser des congés').click();
  await pause(200);
  /* Du 1er au 5 juin : la période contient le 3, jour de familiarisation
     saisi à la main. C'est lui qui doit déclencher la garde du §18.4. */
  var boites = sheet.querySelectorAll('.fld .dates');
  assert(boites.length >= 2, '§26.1 : l’écran de pose porte un début et une fin');
  poserDate(boites[0], '2026-06-01');
  poserDate(boites[1], '2026-06-05');
  await pause(600);

  assert(!boutonExact(sheet, 'Tout sur mes congés payés') &&
         !boutonExact(sheet, 'Tout sur ma récupération'),
    '§26.1 : les deux raccourcis ont disparu — la répartition est déjà faite');

  var carteAlpha = Array.prototype.filter.call(sheet.querySelectorAll('.kid'), function (k) {
    return txt(k.querySelector('.nm')) === 'Alpha';
  })[0];
  assert(!!carteAlpha, '§26.1 : une carte par enfant, déjà remplie');
  carteAlpha.querySelector('.hd').click();
  await pause(100);
  carteAlpha = Array.prototype.filter.call(sheet.querySelectorAll('.kid'), function (k) {
    return txt(k.querySelector('.nm')) === 'Alpha';
  })[0];

  var lignesAlpha = carteAlpha.querySelectorAll('.cnt');
  assert(lignesAlpha.length === 3, '§18.3 : les trois réserves sont proposées');
  assert(txt(carteAlpha).indexOf('par jour') !== -1,
    '§18.6 : le prix d’un jour sans solde est dit sous son compteur');

  var valRecup = null, dispoRecup = null, somme = 0;
  Array.prototype.forEach.call(lignesAlpha, function (c) {
    var v = Number(txt(c.querySelector('.stp span'))) || 0;
    somme += v;
    if (txt(c.querySelector('.cl')).indexOf('Récupération') !== 0) return;
    valRecup = v;
    /* Le disponible est annoncé par l'écran lui-même : « reste 7 j
       convertibles ». C'est CE nombre que la répartition ne doit jamais
       dépasser — et il vient du moteur, pas du test. */
    var m = txt(c.querySelector('.cl i')).match(/(\d+)/);
    dispoRecup = m ? Number(m[1]) : null;
  });
  assert(valRecup !== null && dispoRecup !== null && valRecup <= dispoRecup,
    '§18.3 : la répartition ne dépasse jamais le disponible (obtenu ' +
    valRecup + ', disponible ' + dispoRecup + ')');
  /* EXIGENCE CHANGÉE — LA RÈGLE DES CINQ SAMEDIS (specs du 24 août 2026).
     Ce parcours ne coche aucun samedi : la semaine compte 5 jours et non 6.
     Ce que ce cas vérifie — que la répartition couvre la période ENTIÈRE,
     sans reste — ne change pas d'un mot. */
  assert(somme === 5,
    '§18.3 : la répartition couvre la période entière — 5 jours ouvrables ' +
    'répartis (obtenu ' + somme + ')');

  /* ==================================================================== */
  /* §18.4 (10·A5) — L'AVERTISSEMENT DE SAISIE MANUELLE, DANS LES CONGÉS  */
  /* ==================================================================== */
  console.log('\n--- §18.4 : la garde de saisie manuelle, rétablie ---');

  /* EXIGENCE DÉPLACÉE — LOT 26 §26.1, « ce qui ne se perd pas » :
     l'avertissement vivait sur le récapitulatif, septième écran du parcours.
     Il s'affiche désormais dans une feuille courte qui ne s'ouvre QUE s'il y a
     quelque chose à écraser, à l'appui sur « Poser ». Le texte n'a pas changé
     d'un mot, et il est lu au moment où il décide de quelque chose. */
  sheet.querySelector('.stick button').click();
  await pause(500);

  assert(txt(sheet).indexOf('Une saisie manuelle sera remplacée') !== -1,
    '10·A5 : la garde est rétablie — une journée de familiarisation ne s’efface ' +
    'plus sans un mot');

  /* ------------------------------------------------------------------ */
  /* L'ASSERTION RETIRÉE EN AOÛT, RÉTABLIE :                             */
  /* « chaque contrat ne reçoit que SON propre jour »                    */
  /* ------------------------------------------------------------------ */
  var bPoser = boutonExact(sheet, 'Poser ces congés quand même');
  assert(!!bPoser, '§18.4 : le bouton de pose est offert, APRÈS l’avertissement');
  assert(!!boutonExact(sheet, 'Annuler'),
    '§18.4 : et le refus l’est aussi — l’avertissement n’est pas un passage obligé');
  bPoser.click();
  await pause(500);

  egal(ecritures.groupees.length, 1, 'une seule écriture groupée est partie');
  var aff = ecritures.groupees[0].affectations;
  var parContrat = {};
  aff.forEach(function (a) { parContrat[a.contratId] = a.jours; });

  var joursAlpha = parContrat['c-alpha'] || [];
  var joursBeta = parContrat['c-beta'] || [];
  assert(joursAlpha.every(function (d) {
    return [1, 2, 3, 4, 5].indexOf(new Date(d + 'T00:00:00Z').getUTCDay() || 7) !== -1;
  }), 'chaque contrat ne reçoit que les jours de SON planning (Alpha, lundi-vendredi)');
  assert(joursBeta.every(function (d) {
    return [1, 2, 3].indexOf(new Date(d + 'T00:00:00Z').getUTCDay() || 7) !== -1;
  }), 'chaque contrat ne reçoit que les jours de SON planning (Beta, lundi-mercredi)');
  assert(joursBeta.every(function (d) { return d <= '2026-06-10'; }),
    'chaque contrat ne reçoit que les jours de SES bornes — rien après la date de ' +
    'fin de Beta');
  assert(joursAlpha.length > 0, 'et Alpha, lui, reçoit bien ses jours');

  /* ==================================================================== */
  /* CORRECTIONS DE LA RELECTURE DU LOT 18                                */
  /* ==================================================================== */
  console.log('\n--- B1 : l’effet annoncé EST l’effet obtenu, ajustements compris ---');

  ecritures.marquees.length = 0;
  window.App.invalider();
  window.App.aller('enfant', { contratId: 'c-alpha', annee: 2026, mois: 6 }, true);
  await pause(350);
  /* LOT 25 §25.3 — la multi-sélection s'ouvre par le ⋯ de la barre haute. */
  entrerSelection();
  await pause(150);
  celluleDu('2026-06-09').click();
  await pause(200);

  var piedAjust = corps.querySelector('.selbar');
  var annonceAjust = txt(piedAjust.querySelector('.sb-ef'));
  assert(annonceAjust.indexOf('45 min') !== -1 || annonceAjust.indexOf('45') !== -1,
    'B1 : l’écran annonce la perte des 45 minutes ajoutées (obtenu « ' + annonceAjust + ' »)');
  assert(txt(piedAjust).indexOf('Une saisie manuelle sera effacée') !== -1,
    'C1 : et l’avertissement couvre les ajustements, pas seulement les heures réelles');
  assert(txt(piedAjust).indexOf('Vos notes, elles, sont conservées') !== -1,
    'C2 : il dit aussi ce qui NE sera pas perdu');

  boutonExact(piedAjust, 'Valider').click();
  await pause(350);

  egal(ecritures.marquees.length, 1, 'B1 : une écriture est partie');
  egal(ecritures.marquees[0].jours.join(','), '2026-06-09', 'B1 : sur la bonne journée');

  /* CE QUE CE FICHIER NE PEUT PAS VÉRIFIER, ET OÙ ÇA L'EST.
     Le double remplace `DB` : il ne voit pas la charge utile réellement
     envoyée en base, qui est précisément ce que la relecture a pris en défaut.
     Les sept colonnes remises à plat et l'absence délibérée de `commentaire`
     sont donc contrôlées dans `test/ecriture-vs-schema.test.js`, qui lit
     `js/db.js` — le seul endroit d'où cette charge utile est observable sans
     base de données. Ce qui se vérifie ICI, c'est que l'écran ANNONCE la
     perte, et qu'il achemine chaque journée vers le bon geste. */

  /* Le chemin « Présence » : une journée annotée ne passe PAS par la
     suppression, qui détruirait la ligne entière. */
  console.log('\n--- C2 : la note survit au retour à la présence ---');
  ecritures.marquees.length = 0;
  ecritures.supprimees.length = 0;
  window.App.invalider();
  window.App.aller('enfant', { contratId: 'c-alpha', annee: 2026, mois: 6 }, true);
  await pause(350);
  /* LOT 25 §25.3 — la multi-sélection s'ouvre par le ⋯ de la barre haute. */
  entrerSelection();
  await pause(150);
  celluleDu('2026-06-09').click();          // annotée
  celluleDu('2026-06-10').click();          // ordinaire
  await pause(200);
  var piedP = corps.querySelector('.selbar');
  Array.prototype.filter.call(piedP.querySelectorAll('button'), function (b) {
    return txt(b).trim() === 'Présence';
  })[0].click();
  await pause(200);
  boutonExact(corps.querySelector('.selbar'), 'Valider').click();
  await pause(350);

  egal(ecritures.supprimees.length, 1, 'C2 : une suppression pour la journée ordinaire');
  egal(ecritures.supprimees[0].jours.join(','), '2026-06-10',
    'C2 : et elle ne porte QUE la journée sans note');
  egal(ecritures.marquees.length, 1, 'C2 : une écriture pour la journée annotée');
  egal(ecritures.marquees[0].jours.join(','), '2026-06-09', 'C2 : c’est bien elle');
  egal(ecritures.marquees[0].type, 'presence',
    'C2 : elle repasse en présence sans que sa ligne — donc sa note — soit détruite');

  /* ==================================================================== */
  /* §18.2 — RELIRE AVANT DE CLÔTURER                                     */
  /* ==================================================================== */
  console.log('\n--- §18.2 : relire le récapitulatif complet ---');

  var liste = [
    { contrat: ALPHA, annee: 2026, mois: 5 },
    { contrat: BETA, annee: 2026, mois: 5 }
  ];
  window.App.aller('finDeMois', { liste: liste }, true);
  await pause(450);

  assert(txt(corps).indexOf('Alpha') !== -1, 'décor : le parcours guidé s’ouvre sur le premier enfant');
  var bRelire = boutonExact(corps, 'Voir le récapitulatif complet');
  assert(!!bRelire, '§18.2 : chaque étape propose de relire le récapitulatif complet');

  bRelire.click();
  await pause(450);
  assert(txt(corps).indexOf('Récapitulatif mensuel') !== -1 &&
         txt(corps).indexOf('Total à verser') !== -1,
    '§18.2 : le document complet s’affiche');

  /* LE RETOUR RAMÈNE À LA MÊME ÉTAPE. Un bouton de relecture qui ferait perdre
     le parcours coûterait plus qu'il ne rapporte : Maria devrait tout
     recommencer, et la clôture du mois avec. */
  window.App.retour();
  await pause(450);
  assert(!!boutonExact(corps, 'Voir le récapitulatif complet'),
    '§18.2 : le retour ramène au parcours guidé');
  assert(txt(corps).indexOf('Alpha') !== -1,
    '§18.2 : et à la MÊME étape — le parcours n’est pas rejoué depuis le début');

  /* ==================================================================== */
  /* §18.3 — LES ENFANTS D'UN FOYER MÈNENT À LEUR FICHE                   */
  /* ==================================================================== */
  console.log('\n--- §18.3 : les enfants d’un foyer sont cliquables ---');

  window.App.aller('familles', {}, true);
  await pause(350);
  var carte = corps.querySelector('button.big');
  assert(!!carte, 'décor : la carte de la famille est là');
  carte.click();
  await pause(250);
  var lienEnfant = Array.prototype.filter.call(sheet.querySelectorAll('button.big'),
    function (b) { return txt(b).indexOf('Alpha') !== -1; })[0];
  assert(!!lienEnfant, '§18.3 : l’enfant est un BOUTON, plus une ligne inerte');
  lienEnfant.click();
  await pause(400);
  /* LOT 27 §27.3 — l'intertitre « Identité » a disparu avec le bloc qu'il
     coiffait : l'identité tient sur UNE CARTE, qui porte le nom de l'enfant.
     C'est elle qui dit qu'on est arrivé sur la bonne fiche. */
  assert(txt(corps).indexOf('Alpha') !== -1 && !!parTexte(corps, '.cd', 'Alpha'),
    '§18.3 : et il mène à la fiche du contrat');

  /* ==================================================================== */
  /* §18.3 — LE PRÉNOM SE CORRIGE SUR PLACE                               */
  /* ==================================================================== */
  console.log('\n--- §18.3 : corriger un prénom sur place ---');

  var champPrenom = parTexte(corps, '.fld.mod', 'Prénom de l’enfant');
  assert(!!champPrenom, '§18.3 : le prénom est un champ modifiable sur place');
  boutonExact(champPrenom, 'Modifier').click();
  await pause(120);
  var input = champPrenom.querySelector('input');
  assert(!!input, '§18.3 : l’appui ouvre un champ de saisie, sans quitter l’écran');

  /* Un prénom vidé est refusé, avec sa phrase. */
  input.value = '   ';
  boutonExact(champPrenom, 'Enregistrer').click();
  await pause(120);
  assert(txt(champPrenom).indexOf('obligatoire') !== -1,
    '§18.3 : un prénom vide est refusé, et le refus dit pourquoi');
  egal(ecritures.contrat.length, 0, '§18.3 : et rien n’est parti en base');

  input = champPrenom.querySelector('input');
  input.value = 'Alphonse';
  boutonExact(champPrenom, 'Enregistrer').click();
  await pause(400);

  egal(ecritures.contrat.length, 1, '§18.3 : une seule écriture');
  egal(Object.keys(ecritures.contrat[0].champs).join(','), 'prenom_enfant',
    '§18.3 : et elle ne porte QUE le prénom — ni date de début, ni statut, ni ' +
    'nom de famille');
  egal(ecritures.contrat[0].champs.prenom_enfant, 'Alphonse', '§18.3 : avec la bonne valeur');

  /* ==================================================================== */
  /* §18.1 — UN MOIS CLÔTURÉ N'ENTRE PAS EN MODE SÉLECTION                */
  /* ==================================================================== */
  console.log('\n--- §18.1 : le mode sélection est fermé là où il doit l’être ---');

  DB.__avrilClos = true;
  DB.getRecap = function (id, a, m) {
    if (id === 'c-alpha' && a === 2026 && m === 4) return Promise.resolve(RECAP_AVRIL);
    return Promise.resolve(null);
  };
  window.App.invalider();
  window.App.aller('enfant', { contratId: 'c-alpha', annee: 2026, mois: 4 }, true);
  await pause(400);

  /* ==========================================================================
     EXIGENCE CHANGÉE — LOT 25 §25.2 : LE PAVÉ DU MOIS CLÔTURÉ DEVIENT UNE
     PORTE. Le §18.6 avait remplacé « Rien à faire les jours normaux » — qui
     invitait à toucher des jours inertes — par ce qui est vrai sur un mois
     verrouillé, plus le chemin pour corriger. Le lot 25 ne revient pas
     là-dessus : il déplace le TEXTE, pas la garantie.

     RIEN NE SE PERD (A.2), et voici où chaque morceau vit :
     - « Ce mois est clôturé » -> l'encart unique de l'espace enfant, qui le
       nomme ET DIT LA DATE de clôture, ce que le pavé ne faisait pas ;
     - « Vous pouvez le rouvrir » -> le bouton « Rouvrir pour corriger » du
       document, où il était déjà, et où la porte mène ;
     - « Il n'a pas encore été transmis » -> la ligne posée juste au-dessus de
       cette porte de réouverture (`UiReouverture.actionsMoisCloture`), qui
       DÉSORMAIS dit les deux cas — transmis, et pas encore. Elle y change
       quelque chose : rouvrir un mois déjà remis à la famille n'est pas le
       même geste que rouvrir un mois qu'elle n'a jamais vu.

     L'ASSERTION SE RENFORCE : on exige la porte, on la franchit, et on exige
     les deux textes au bout. Un pavé présent dont les boutons ne mènent nulle
     part passait l'ancienne assertion.
     ====================================================================== */
  /* LOT 30 (§30.2) — EXIGENCE CHANGÉE : sur un mois clôturé d'un contrat en
     cours, le ⋯ RESTE. La multi-sélection propose la réouverture au moment
     de valider, comme la feuille du jour ; rien n'est écrit tant que le mois
     n'est pas rouvert (vérifié par `lot30-rouvrir.smoke.js`). Un contrat
     RANGÉ, lui, reste sans ⋯. */
  assert(!boutonExact(corps, 'Choisir plusieurs jours') &&
         !!document.getElementById('barre').querySelector('button[aria-label="Marquer plusieurs jours"]'),
    '§30.2 : sur un mois clôturé, le ⋯ reste — valider proposera de rouvrir');
  assert(txt(corps).indexOf('Rien à faire les jours normaux') === -1,
    '§18.6 : et la phrase qui invite à toucher des jours inertes a disparu');
  /* REDESIGN 2A §4.3 — LE CHEMIN RACCOURCIT D'UN APPUI.
     Le bandeau d'un mois cloture porte desormais « Rouvrir » directement : il
     ne renvoie plus au document pour y trouver le bouton. L'assertion ne
     s'affaiblit pas — on verifie toujours qu'au bout du chemin la reouverture
     est offerte —, le chemin est simplement plus court. */
  var encClos = parTexte(corps, '.enc', 'Mois clôturé');
  assert(!!encClos, '§18.6 : l’écran dit ce qui est vrai — le mois est clôturé');
  assert(txt(encClos).indexOf('ne se modifient pas') !== -1,
    '§4.3 : et il dit pourquoi (obtenu « ' + txt(encClos).slice(0, 90) + ' »)');
  var porteClos = boutonExact(encClos, 'Rouvrir');
  assert(!!porteClos, '§18.6 : et il ouvre le chemin pour corriger, d’un appui');
  porteClos.click();
  await pause(350);
  /* La reouverture s'offre dans une FEUILLE montante, pas dans le corps de
     l'ecran : Maria n'a pas quitte son calendrier. */
  assert(!!boutonExact(sheet, 'Rouvrir pour corriger'),
    '§18.6 : au bout de ce chemin, la réouverture est offerte');
  assert(txt(sheet).indexOf('n’a pas encore été transmis') !== -1,
    '§18.6 : et la feuille signale qu’aucun document n’est parti');
  window.Kit.fermerFeuille();
  await pause(80);
  window.App.aller('enfant', { contratId: 'c-alpha', annee: 2026, mois: 4 }, true);
  await pause(350);

  /* Et sur un contrat RANGÉ, même règle : l'écran entier est en lecture. */
  BETA.archive = true;
  BETA.statut = 'termine';
  window.App.invalider();
  await window.App.rechargerContrats();
  window.App.aller('enfant', { contratId: 'c-beta', annee: 2026, mois: 5 }, true);
  await pause(400);
  assert(txt(corps).indexOf('Ancien contrat — lecture seule') !== -1,
    'décor : le contrat de Beta est rangé, et l’écran le DIT (§18.6) — sans ' +
    'quoi Maria appuierait sur des journées inertes sans savoir pourquoi');
  assert(!boutonExact(corps, 'Choisir plusieurs jours') &&
         !document.getElementById('barre').querySelector('button[aria-label="Marquer plusieurs jours"]'),
    '§18.1 : sur un contrat rangé non plus, le mode sélection n’est pas proposé');

  /* ==================================================================== */
  console.log('');
  if (echecs) { console.error(echecs + ' échec(s).'); process.exit(1); }
  console.log('Tout est conforme.');
})().catch(function (e) {
  console.error('ERREUR', e && e.stack ? e.stack : e);
  process.exit(1);
});
