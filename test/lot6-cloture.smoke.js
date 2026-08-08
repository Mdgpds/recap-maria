/* ============================================================================
   Test de fumée — mois clôturé, net manquant, aperçu de congé et échec de
   lecture (corrections B1, B2, B4, B5, A6, A7 de la relecture du lot 6).

   La relecture avait relevé que les deux tests de fumée existants ne couvraient
   AUCUN mois clôturé ni AUCUN chemin d'erreur — précisément l'angle mort des
   cinq anomalies bloquantes. Ce fichier vise exactement cet angle.

   Chaque scénario est joué contre le VRAI index.html, le VRAI moteur et la
   VRAIE chaîne des mois ; seul l'accès aux données est simulé.

   Lancement : NODE_PATH=... node test/lot6-cloture.smoke.js
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
/* Les durées et quantités portent une espace INSÉCABLE (format.js) : voulu,
   une valeur ne doit jamais se couper en fin de ligne. On normalise ici. */
function norm(t) { return t == null ? t : String(t).replace(/\u00A0/g, ' '); }
function ligneDe(racineEl, libelle) {
  var l = Array.prototype.filter.call(racineEl.querySelectorAll('.l'), function (e) {
    return e.firstChild && e.firstChild.textContent.indexOf(libelle) !== -1;
  })[0];
  return l ? norm(l.lastChild.textContent) : null;
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

/* --- Données simulées ---------------------------------------------------- */
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
  famille: { id: 'f2', nom: 'Mésange' }, date_debut: '2025-09-01' });
/* Zoé : barème SANS NET — le cas de B2. */
var ZOE = contrat({ id: 'c-zoe', prenom_enfant: 'Zoé', famille_id: 'f3',
  famille: { id: 'f3', nom: 'Hirondelle' }, date_debut: '2025-09-01' });

var SALAIRE_PLEIN = { id: 's1', date_effet: '2025-09-01',
  brut_mensuel_centimes: 137289, net_mensuel_centimes: 107250 };
var SALAIRE_SANS_NET = { id: 's2', date_effet: '2025-09-01',
  brut_mensuel_centimes: 137289, net_mensuel_centimes: 0 };

/* Un congé DÉJÀ POSÉ le lundi 18 mai 2026, sur les trois contrats. C'est lui
   qui faisait compter deux fois le lundi dans l'aperçu d'une semaine (B4). */
function journeesDeMai(contratId) {
  return {
    '2026-05-18': { contrat_id: contratId, jour: '2026-05-18', type: 'conge_maria',
                    minutes_reelles: null, entretien_centimes: null }
  };
}

/* Instantané du mois clôturé de Léa : produit par le VRAI moteur, pour que le
   test n'invente aucun chiffre. */
var SNAPSHOT_LEA_MAI = (function () {
  var r = Engine.calculerMois({
    contrat: LEA, salaire: SALAIRE_PLEIN,
    journees: [journeesDeMai('c-lea')['2026-05-18']],
    compteurEntree: { minutesSup: 0, dixiemesCpAcquis: 200, dixiemesCpPris: 0 },
    annee: 2026, mois: 5
  });
  r.prenomEnfant = 'Léa';
  r.nomFamille = 'Papillon';
  r.salaireDateEffet = '2025-09-01';
  r.joursConge = ['2026-05-18'];
  return r;
})();

var appels = { poser: [], journee: [], fige: [] };
var etatTest = { serieCassee: null, dejaClos: false };

var DB = {
  getSession: function () {
    return Promise.resolve({ user: { id: 'u1', email: 'maria@exemple.test' } });
  },
  onAuthChange: function () {},
  signOut: function () { return Promise.resolve(true); },
  listContratsActifs: function () { return Promise.resolve([LEA, TOM, ZOE]); },
  listContratsTous: function () { return Promise.resolve([LEA, TOM, ZOE]); },
  listContratsPourMois: function () { return Promise.resolve([LEA, TOM, ZOE]); },
  listContratsPourPeriode: function () { return Promise.resolve([LEA, TOM, ZOE]); },
  listFamillesToutes: function () { return Promise.resolve([]); },
  getSalaires: function (id) {
    var s = (id === 'c-zoe') ? SALAIRE_SANS_NET : SALAIRE_PLEIN;
    var copie = {}; Object.keys(s).forEach(function (k) { copie[k] = s[k]; });
    copie.contrat_id = id;
    return Promise.resolve([copie]);
  },
  getCompteurInitial: function (id) {
    return Promise.resolve({
      contrat_id: id, date_reference: '2026-05-01',
      minutes_sup: 0, dixiemes_cp_acquis: 200, dixiemes_cp_pris: 0
    });
  },
  getJourneesMois: function (id) {
    if (etatTest.serieCassee === id) return Promise.reject(new Error('Failed to fetch'));
    return Promise.resolve(journeesDeMai(id));
  },
  getJourneesPeriode: function (id) {
    if (etatTest.serieCassee === id) return Promise.reject(new Error('Failed to fetch'));
    return Promise.resolve({ '2026-05': journeesDeMai(id) });
  },
  listRecapsPeriode: function (id) {
    if (id !== 'c-lea') return Promise.resolve([]);
    return Promise.resolve([{ id: 'r-lea', contrat_id: 'c-lea', annee: 2026, mois: 5,
      statut: 'fige', donnees: SNAPSHOT_LEA_MAI, fige_le: '2026-05-31T18:00:00Z' }]);
  },
  listRecapsContrat: function (id) { return DB.listRecapsPeriode(id); },
  getRecap: function (id, a, m) {
    if (id === 'c-lea' && a === 2026 && m === 5) {
      return Promise.resolve({ id: 'r-lea', contrat_id: 'c-lea', annee: 2026, mois: 5,
        statut: 'fige', donnees: SNAPSHOT_LEA_MAI, fige_le: '2026-05-31T18:00:00Z' });
    }
    return Promise.resolve(null);
  },
  enregistrerJournee: function (l) { appels.journee.push(l); return Promise.resolve(l); },
  supprimerJournee: function () { return Promise.resolve(true); },
  poserAbsenceMaria: function (a, t) {
    appels.poser.push({ affectations: a, type: t });
    return Promise.resolve([]);
  },
  retirerAbsenceMaria: function () { return Promise.resolve(true); },
  figerRecap: function (id, a, m, donnees) {
    appels.fige.push({ contratId: id, annee: a, mois: m, donnees: donnees });
    /* A7 : sur un mois déjà clôturé ailleurs, db.js renvoie null sans écrire. */
    return Promise.resolve(etatTest.dejaClos ? null : { id: 'x', statut: 'fige' });
  }
};
global.DB = DB; window.DB = DB;

require('../js/ui-kit.js');
require('../js/ui-accueil.js');
require('../js/ui-enfant.js');
require('../js/ui-document.js');
require('../js/ui-conges.js');
require('../js/ui-historique.js');
require('../js/ui-contrat.js');
require('../js/ui-menu.js');
require('../js/ui-periode.js');
require('../js/app.js');

window.App.moisCourant = function () { return { annee: 2026, mois: 5 }; };
window.App.aujourdhui = function () { return '2026-05-24'; };

var corps = document.getElementById('corps');
var sheet = document.getElementById('sheet');
var toast = document.getElementById('toast');

(async function () {
  document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  await pause(200);

  /* ================= B1 — un mois clôturé ne se modifie plus ============= */
  window.App.aller('enfant', { contratId: 'c-lea', annee: 2026, mois: 5 });
  await pause(200);

  assert(txt(corps).indexOf('Mois clôturé — plus aucune modification') !== -1,
    'B1 : le mois clôturé porte un bandeau qui le dit');
  assert(corps.querySelectorAll('table.cal td[role="button"]').length === 0,
    'B1 : aucune journée n’est touchable sur un mois clôturé (obtenu ' +
    corps.querySelectorAll('table.cal td[role="button"]').length + ')');
  assert(!!parTexte(corps, 'button', 'Revoir le mois clôturé'),
    'B1 : le bouton devient « Revoir le mois clôturé »');

  /* A6 — le dénominateur « sur N » n'est plus recompté en direct */
  var presence = ligneDe(corps, 'Jours de présence');
  assert(presence && presence.indexOf('sur') === -1,
    'A6 : sur un mois clôturé, seul le chiffre figé est affiché (obtenu « ' + presence + ' »)');

  /* ===== B1 (suite) — un geste posé ailleurs ne touche pas ce contrat ==== */
  window.App.aller('enfant', { contratId: 'c-tom', annee: 2026, mois: 5 });
  await pause(200);

  var touchables = corps.querySelectorAll('table.cal td[role="button"]');
  assert(touchables.length > 0, 'le mois de Tom, lui, reste modifiable');
  var mardi26 = Array.prototype.filter.call(touchables, function (td) {
    return txt(td.querySelector('.num')) === '26';
  })[0];
  assert(!!mardi26, 'le mardi 26 mai est touchable chez Tom');
  mardi26.click();
  await pause(60);

  assert(txt(sheet).indexOf('Mois déjà clôturé pour Léa') !== -1,
    'B1 : la feuille dit que Léa ne sera pas touchée');
  var pourquoiConge = txt(sheet.querySelectorAll('.choice')[2].querySelector('.why'));
  assert(pourquoiConge.indexOf('les 2 enfants') !== -1,
    'A2 : le libellé compte les contrats RÉELLEMENT servis, pas « les 4 enfants » ' +
    '(obtenu « ' + pourquoiConge + ' »)');

  sheet.querySelectorAll('.choice')[2].click();
  await pause(200);

  assert(appels.poser.length === 1, 'une écriture groupée est partie');
  var ids = appels.poser[0].affectations.map(function (a) { return a.contratId; }).sort();
  assert(ids.join(',') === 'c-tom,c-zoe',
    'B1 : le congé ne part QUE sur les contrats dont le mois n’est pas clôturé ' +
    '(obtenu ' + ids.join(',') + ')');

  /* ================= B2 — net manquant : pas de clôture ================== */
  window.App.aller('document', { contratId: 'c-zoe', annee: 2026, mois: 5 });
  await pause(200);

  assert(txt(corps).indexOf('le net n’est pas renseigné') !== -1,
    'B2 : l’alerte « récapitulatif incomplet » est rétablie');
  assert(!parTexte(corps, 'button', 'Clôturer le mois'),
    'B2 : la clôture est refusée tant que le net est inconnu');
  assert(!!parTexte(corps, 'button', 'Compléter la rémunération'),
    'B2 : l’écran propose la sortie plutôt qu’une impasse');

  /* Le document reste consultable et partageable. */
  assert(!!corps.querySelector('.doc'), 'le document reste affiché');
  assert(!!parTexte(corps, 'button', 'Copier le texte'), 'le partage reste possible');

  /* ================= A7 — clôture depuis un second appareil ============== */
  etatTest.dejaClos = true;
  window.App.aller('document', { contratId: 'c-tom', annee: 2026, mois: 5 });
  await pause(200);
  var bCloture = parTexte(corps, 'button', 'Clôturer le mois');
  assert(!!bCloture, 'le mois de Tom est clôturable');
  bCloture.click();
  await pause(60);
  parTexte(sheet, 'button', 'Oui, clôturer le mois').click();
  await pause(200);
  assert(txt(toast).indexOf('déjà clôturé') !== -1,
    'A7 : le message dit la vérité quand le mois était déjà clôturé (obtenu « ' + txt(toast) + ' »)');
  assert(txt(toast).indexOf('figé') === -1, 'A8 : le mot « figé » n’apparaît jamais à l’écran');
  etatTest.dejaClos = false;

  /* ================= B4 — l’aperçu d’une semaine dit la vérité =========== */
  window.App.aller('conges', { annee: 2026, mois: 5 }, true);
  await pause(250);

  assert(txt(corps).indexOf('Lundi 18 mai') !== -1, 'le congé déjà posé est listé');

  parTexte(corps, 'button', 'Poser une semaine entière').click();
  await pause(400);

  /* Semaine du 18 au 22 mai : le lundi 18 est DÉJÀ posé. Le moteur décompte 6
     jours ouvrables pour la période complète, dont 1 était déjà compté : la
     consommation supplémentaire est de 5 jours, pas 6. */
  var decompte = ligneDe(sheet, 'Jours décomptés');
  assert(decompte === '5 j',
    'B4 : l’effet réel de la semaine est de 5 jours, le lundi déjà posé n’est pas ' +
    'compté deux fois (obtenu ' + decompte + ')');
  assert(ligneDe(sheet, 'Déjà posés') === '1 j',
    'B4 : le jour déjà posé est nommé plutôt que caché');
  var lignetom = ligneDe(sheet, 'Tom');
  assert(lignetom && lignetom.indexOf('→') !== -1, 'l’aperçu montre le solde avant → après');
  /* Valeur attendue par la relecture : « 19 j → 14 j ». L'ancien code annonçait
     13 j, en comptant le lundi déjà posé une seconde fois. */
  assert(lignetom.indexOf('19 j → 14 j') !== -1,
    'B4 : 19 j → 14 j, et non 13 j comme le donnait le double comptage ' +
    '(obtenu « ' + lignetom + ' »)');
  assert(txt(sheet).indexOf('Mois déjà clôturé pour Léa') !== -1,
    'B1 : la semaine ne partira pas sur le mois clôturé de Léa, et c’est dit');

  /* ================= B5 — un contrat illisible bloque la pose =========== */
  etatTest.serieCassee = 'c-tom';
  window.App.invalider();
  window.App.aller('conges', { annee: 2026, mois: 5 }, true);
  await pause(300);

  assert(txt(corps).indexOf('Compteurs indisponibles pour Tom') !== -1,
    'B5 : l’échec de lecture est annoncé, pas caché sous « non concerné »');
  var bSemaine = parTexte(corps, 'button', 'Poser une semaine entière');
  assert(bSemaine && bSemaine.disabled === true,
    'B5 : la pose est bloquée tant qu’un contrat n’est pas lisible');
  assert(ligneDe(corps, 'Tom') === 'indisponible',
    'B5 : le contrat en échec est nommé dans les compteurs');
  etatTest.serieCassee = null;

  console.log('\n' + (echecs === 0 ? 'Tout est conforme.' : echecs + ' échec(s).'));
  process.exit(echecs === 0 ? 0 : 1);
})().catch(function (e) {
  console.error('Erreur pendant le parcours :', e);
  process.exit(1);
});
