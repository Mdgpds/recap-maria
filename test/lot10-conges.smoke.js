/* ============================================================================
   Test de fumée — lot 10 : congés, dates puis ventilation famille par famille.
   Cas P1 à P10 de la spécification.

   POURQUOI CE FICHIER EXISTE.

   Ce lot rend à Maria un arbitrage que l'application lui avait pris. Poser un
   congé était un geste unique : elle choisissait des dates, et le moteur
   décidait seul comment les payer — congés payés d'abord, puis récupération,
   puis sans solde —, le même arbitrage pour les quatre enfants.

   Or les réserves diffèrent d'un contrat à l'autre : Tom a 6 jours de congés
   payés quand Léa en a 19, parce que les contrats n'ont pas commencé en même
   temps. La même semaine d'août se paie donc confortablement chez Léa et passe
   en partie SANS SOLDE chez Tom — c'est-à-dire en retenue sur salaire. Aucun
   choix global ne peut convenir.

   Ce qui se vérifie ici tient en trois garanties :
     - le décompte en jours ouvrables vient du MOTEUR (RG-06, samedi inclus) et
       n'est jamais recalculé dans l'écran ;
     - « Continuer » reste INACTIF tant que la ventilation ne couvre pas
       exactement la période — une ventilation incomplète serait refusée par le
       moteur, autant ne jamais la laisser partir ;
     - la retenue de sans-solde vient de `Engine.montantCentimes`, et elle est
       montrée AVANT le choix, pas découverte sur le document du mois.

   Lancement : node test/lot10-conges.smoke.js
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
function sansInsecable(t) { return String(t).replace(/ /g, ' '); }
function parTexte(racineEl, selecteur, morceau) {
  return Array.prototype.filter.call(racineEl.querySelectorAll(selecteur), function (e) {
    return e.textContent.indexOf(morceau) !== -1;
  })[0] || null;
}
function boutonExact(racineEl, libelle) {
  return Array.prototype.filter.call(racineEl.querySelectorAll('button'), function (e) {
    return e.textContent.trim() === libelle;
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

/* --- Décor. Valeurs FICTIVES et rondes : le dépôt est public. -----------
   Deux enfants aux réserves DIFFÉRENTES, parce que c'est tout le sujet :
     Léa    — compteurs confortables
     Tom    — compteurs presque vides, il tombera en sans-solde
*/
function contrat(id, prenom, genre) {
  return {
    id: id, prenom_enfant: prenom, famille_id: 'f-' + id,
    famille: { id: 'f-' + id, nom: 'Foyer-' + prenom }, date_debut: '2026-01-01', date_fin: null,
    minutes_contractuelles: 540, minutes_sup_jour: 30, minutes_par_jour_conge: 540,
    entretien_centimes_jour: 500, jours_planning: [1, 2, 3, 4, 5],
    heure_arrivee: '08:30:00', heure_depart: '18:00:00', statut: 'actif',
    sup_dues_si_enfant_absent: true, ordre_imputation: 'cp_puis_sup', archive: false,
    nom: null, genre: genre, couleur: null, photo: null
  };
}
var LEA = contrat('c-lea', 'Léa', 'f');
var TOM = contrat('c-tom', 'Tom', 'g');

/* Compteurs de départ : c'est eux qui font toute la différence.
   Léa  : 19 jours de CP (190 dixièmes) et 4 jours de récupération (2160 min)
   Tom  : rien du tout — son contrat vient de commencer

   NB : le moteur rejoue le mois affiché, et y AJOUTE ce qui s'y acquiert
   (RG-11 pour les congés payés, RG-09 pour les heures supplémentaires). Les
   réserves offertes à la ventilation sont donc celles de la SORTIE du mois,
   pas celles de son entrée. Le test ne suppose donc jamais un chiffre exact :
   il lit ce que l'écran affiche et vérifie les RÈGLES — un mur existe, il ne
   se franchit pas, et la somme couvre la période. */
var COMPTEURS = {
  'c-lea': { dixiemes_cp_acquis: 190, dixiemes_cp_pris: 0, minutes_sup: 2160 },
  'c-tom': { dixiemes_cp_acquis: 0,   dixiemes_cp_pris: 0, minutes_sup: 0 }
};

var scene = {
  contrats: [LEA, TOM],
  aujourdhui: '2026-07-01',
  moisCourant: { annee: 2026, mois: 7 },
  recaps: {},                 // 'contratId|annee-mois' -> recap
  journees: {},               // contratId -> { 'YYYY-MM-DD': ligne }
  imputations: {},            // contratId -> [imputation]
  ecritureCassee: false
};
var appels = { poser: [], imputations: [], rouvrir: [], supprImput: [], retirer: [] };
var sequence = 0;

function cle(id, a, m) { return id + '|' + a + '-' + m; }

var DB = {
  getSession: function () {
    return Promise.resolve({ user: { id: 'u1', email: 'maria@exemple.test' } });
  },
  onAuthChange: function () {},
  signOut: function () { return Promise.resolve(true); },
  listContratsActifs: function () { return Promise.resolve(scene.contrats); },
  listContratsTous: function () { return Promise.resolve(scene.contrats); },
  listContratsPourMois: function () { return Promise.resolve(scene.contrats); },
  listContratsPourPeriode: function () { return Promise.resolve(scene.contrats); },
  listFamilles: function () { return Promise.resolve([]); },
  listFamillesToutes: function () { return Promise.resolve([]); },
  listFamillesAvecContrats: function () { return Promise.resolve([]); },
  getSalaires: function (id) {
    return Promise.resolve([{ id: 's-' + id, contrat_id: id, date_effet: '2026-01-01',
      brut_mensuel_centimes: 200000, net_mensuel_centimes: 150000 }]);
  },
  getCompteurInitial: function (id) {
    var c = COMPTEURS[id];
    return Promise.resolve({ contrat_id: id, date_reference: '2026-07-01',
      minutes_sup: c.minutes_sup, dixiemes_cp_acquis: c.dixiemes_cp_acquis,
      dixiemes_cp_pris: c.dixiemes_cp_pris });
  },
  getJourneesMois: function (id) { return Promise.resolve(scene.journees[id] || {}); },
  getJourneesPeriode: function () { return Promise.resolve({}); },
  listImputations: function (id) { return Promise.resolve(scene.imputations[id] || []); },
  listImputationsPourMois: function (id) { return Promise.resolve(scene.imputations[id] || []); },
  getNoteMensuelle: function () { return Promise.resolve(null); },
    enregistrerNoteMensuelle: function (c, a, m, t) { return Promise.resolve({ texte: t }); },
  enregistrerImputation: function (i) {
    if (scene.ecritureCassee) return Promise.reject(new Error('Failed to fetch'));
    appels.imputations.push(i);
    var pose = { id: 'imp-' + (++sequence) };
    Object.keys(i).forEach(function (k) { pose[k] = i[k]; });
    if (!scene.imputations[i.contrat_id]) scene.imputations[i.contrat_id] = [];
    scene.imputations[i.contrat_id].push(pose);
    return Promise.resolve(pose);
  },
  supprimerImputation: function (id) {
    appels.supprImput.push(id);
    Object.keys(scene.imputations).forEach(function (k) {
      scene.imputations[k] = scene.imputations[k].filter(function (i) { return i.id !== id; });
    });
    return Promise.resolve(true);
  },
  listRecapsPeriode: function (id) {
    return Promise.resolve(Object.keys(scene.recaps)
      .filter(function (k) { return k.indexOf(id + '|') === 0; })
      .map(function (k) { return scene.recaps[k]; }));
  },
  listRecapsContrat: function (id) { return DB.listRecapsPeriode(id); },
  getRecap: function (id, a, m) { return Promise.resolve(scene.recaps[cle(id, a, m)] || null); },
  enregistrerJournee: function (l) { return Promise.resolve(l); },
  supprimerJournee: function () { return Promise.resolve(true); },
  poserAbsenceMaria: function (affectations, type) {
    if (scene.ecritureCassee) return Promise.reject(new Error('Failed to fetch'));
    appels.poser.push({ affectations: affectations, type: type });
    affectations.forEach(function (a) {
      if (!scene.journees[a.contratId]) scene.journees[a.contratId] = {};
      a.jours.forEach(function (d) { scene.journees[a.contratId][d] = { jour: d, type: type }; });
    });
    return Promise.resolve([]);
  },
  retirerAbsenceMaria: function (ids, jours) {
    appels.retirer.push({ ids: ids, jours: jours });
    ids.forEach(function (id) {
      jours.forEach(function (d) { if (scene.journees[id]) delete scene.journees[id][d]; });
    });
    return Promise.resolve(true);
  },
  rouvrirRecap: function (id, a, m, motif) {
    appels.rouvrir.push({ contratId: id, annee: a, mois: m, motif: motif });
    delete scene.recaps[cle(id, a, m)];
    return Promise.resolve({ id: 'r', statut: 'brouillon' });
  },
  recloturerRecap: function () { return Promise.resolve(null); },
  listEvenementsRecap: function () { return Promise.resolve([]); },
  marquerTransmis: function () { return Promise.resolve(null); },
  estMoisCloture: function (id, a, m) { return Promise.resolve(!!scene.recaps[cle(id, a, m)]); },
  /* Lot 14 — la fiche contrat demande si le contrat est vierge pour décider
  d'AFFICHER ou non la suppression franche. Décor mis à jour ici : sans
  cette fonction, l'écran lève avant même de se rendre. */
  contratEstVierge: function () { return Promise.resolve(false); },
  majContrat: function (id, c) { return Promise.resolve(c); },
  creerFamille: function (c) { return Promise.resolve(c); },
  majFamille: function (id, c) { return Promise.resolve(c); }
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
require('../js/ui-menu.js');
require('../js/ui-periode.js');
require('../js/app.js');

window.App.moisCourant = function () { return scene.moisCourant; };
window.App.aujourdhui = function () { return scene.aujourdhui; };

var corps = document.getElementById('corps');
var sheet = document.getElementById('sheet');
var toast = document.getElementById('toast');

async function ouvrirConges(annee, mois) {
  window.App.invalider();
  window.App.aller('conges', { annee: annee || 2026, mois: mois || 7 }, true);
  await pause(350);
}

/* Les champs de date sont trois listes déroulantes (jamais de clavier). On
   les pose puis on déclenche `change`, comme le ferait un doigt. */
function poserDate(bloc, iso) {
  var p = iso.split('-');
  var sels = bloc.querySelectorAll('select');
  sels[0].value = String(Number(p[2]));      // jour
  sels[1].value = String(Number(p[1]));      // mois
  sels[2].value = p[0];                      // année
  Array.prototype.forEach.call(sels, function (s) {
    s.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  });
}
function champsDates() {
  var blocs = sheet.querySelectorAll('.fld');
  return { du: blocs[0], au: blocs[1] };
}
function compteurDe(libelle) {
  return parTexte(sheet, '.compteur-jours', libelle);
}
function valeurDe(libelle) {
  var c = compteurDe(libelle);
  return c ? Number(txt(c.querySelector('.val'))) : null;
}
function resteAffiche() {
  var r = sheet.querySelector('.reste b');
  return r ? Number(r.textContent) : null;
}
/* Remet une ventilation VALABLE, sans supposer aucune réserve : on vide les
   trois compteurs, puis on remplit dans l'ordre du contrat — congés payés,
   récupération, sans solde —, chacun jusqu'à son mur. Les bornes dépendent du
   mois rejoué par le moteur ; le test ne doit pas les deviner. */
function remettreProposition() {
  ['Congés payés', 'Récupération', 'Sans solde'].forEach(function (l) {
    cliquer(l, '−', 40);
  });
  ['Congés payés', 'Récupération', 'Sans solde'].forEach(function (l) {
    var manque = resteAffiche();
    if (manque > 0) cliquer(l, '+', manque);
  });
}
function cliquer(libelle, signe, fois) {
  var c = compteurDe(libelle);
  var b = Array.prototype.filter.call(c.querySelectorAll('.pas'), function (x) {
    return x.textContent === signe;
  })[0];
  for (var i = 0; i < (fois || 1); i++) b.click();
}

(async function () {
  document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  await pause(300);

  /* ==================================================================== */
  /* L'onglet : réserves contrat par contrat, un seul bouton              */
  /* ==================================================================== */
  console.log('\n--- L’onglet « Mes congés » ---');
  await ouvrirConges();

  assert(txt(corps).indexOf('Vos réserves') !== -1, 'les réserves sont affichées');
  assert(txt(corps).indexOf('Léa') !== -1 && txt(corps).indexOf('Tom') !== -1,
    'contrat par contrat, jamais consolidées');
  assert(txt(corps).indexOf('de congés payés') !== -1 && txt(corps).indexOf('de récupération') !== -1,
    'congés payés ET récupération — sans la seconde, Maria ne peut pas éviter le sans-solde');
  assert(txt(corps).indexOf('Les compteurs diffèrent') !== -1, 'la phrase d’explication');
  assert(!!boutonExact(corps, 'Poser des congés'), 'V8-08 : UN SEUL bouton de pose');
  assert(!parTexte(corps, 'button', 'Poser une semaine'), 'V8-08 : le mode semaine a disparu');
  assert(!parTexte(corps, 'button', 'Poser une seule journée'),
    'V8-08 : le faux raccourci « une seule journée » a disparu');

  /* ==================================================================== */
  /* P1 — Semaine complète, réserves suffisantes                          */
  /* A1 — 6 jours ouvrables, samedi inclus, décompte du MOTEUR            */
  /* ==================================================================== */
  console.log('\n--- P1 : semaine du lundi 6 au vendredi 10 juillet ---');
  boutonExact(corps, 'Poser des congés').click();
  await pause(200);

  assert(txt(sheet).indexOf('Quand serez-vous absente ?') !== -1, 'P1 : l’étape des dates');
  assert(txt(sheet).indexOf('mettez la même date dans les deux champs') !== -1,
    'P1 : le cas de la journée unique est expliqué');

  var ch = champsDates();
  poserDate(ch.du, '2026-07-06');
  poserDate(ch.au, '2026-07-10');
  await pause(80);

  assert(sansInsecable(txt(sheet)).indexOf('6 j ouvrables décomptés') !== -1,
    'A1 : une semaine du lundi au vendredi décompte 6 JOURS (obtenu « ' +
    (sansInsecable(txt(sheet)).match(/\d+ j ouvrables[^.]{0,20}/) || [''])[0] + ' »)');
  assert(txt(sheet).indexOf('samedi inclus') !== -1,
    'A1 : le samedi inclus est dit — c’est le désaccord historique avec les familles');
  /* Le décompte vient du moteur : on le recalcule ici indépendamment. */
  assert(Engine.decompterJoursOuvrables('2026-07-06', '2026-07-10') === 6,
    'A1 : et c’est bien ce que rend Engine.decompterJoursOuvrables');

  boutonExact(sheet, 'Continuer').click();
  await pause(300);

  assert(txt(sheet).indexOf('Léa') !== -1 && txt(sheet).indexOf('à répartir') !== -1,
    'P1 : l’étape 2 s’ouvre sur le premier contrat');
  assert(!!sheet.querySelector('.etapes'), 'P1 : la barre d’étapes est présente');
  assert(txt(sheet).indexOf('Vos réserves pour ce contrat') !== -1,
    'P1 : les réserves DE CE CONTRAT sont sous les yeux');

  /* Répartition proposée par le moteur : Léa a 19 jours de CP, les 6 jours y
     tiennent entièrement. */
  assert(valeurDe('Congés payés') === 6, 'P1 : la proposition par défaut met 6 sur les congés payés');
  assert(valeurDe('Récupération') === 0, 'P1 : rien sur la récupération');
  assert(valeurDe('Sans solde') === 0, 'P1 : rien sans solde');
  assert(txt(sheet).indexOf('Reste à répartir') !== -1, 'P1 : le reste à répartir est affiché');
  assert(!!sheet.querySelector('.reste.ok'), 'P1 : il est à zéro, donc conforme');
  assert(boutonExact(sheet, 'Continuer').disabled === false, 'A2 : « Continuer » est actif');

  /* ==================================================================== */
  /* P7 — Modification manuelle de la répartition                         */
  /* A3 — les bornes des compteurs                                        */
  /* ==================================================================== */
  console.log('\n--- P7 : Maria modifie la répartition ---');
  cliquer('Congés payés', '−', 2);
  await pause(30);
  assert(valeurDe('Congés payés') === 4, 'P7 : les congés payés descendent à 4');
  assert(!!sheet.querySelector('.reste.ko'), 'P8 : le reste n’est plus à zéro');
  assert(boutonExact(sheet, 'Continuer').disabled === true,
    'A2 : « Continuer » est INACTIF tant que le reste n’est pas nul');

  cliquer('Récupération', '+', 2);
  await pause(30);
  assert(valeurDe('Récupération') === 2, 'P7 : deux jours sur la récupération');
  assert(!!sheet.querySelector('.reste.ok'), 'P7 : le compte est bon à nouveau');
  assert(boutonExact(sheet, 'Continuer').disabled === false, 'A2 : « Continuer » se rouvre');

  /* A3 — la récupération est BORNÉE par la réserve. On ne suppose pas sa
     valeur exacte : elle dépend du mois rejoué par le moteur, qui ajoute les
     heures supplémentaires acquises en juillet. Ce qui se vérifie, c'est qu'un
     mur existe et qu'on ne le franchit pas. */
  cliquer('Récupération', '+', 30);
  await pause(30);
  var plafondRecup = valeurDe('Récupération');
  cliquer('Récupération', '+', 5);
  await pause(30);
  assert(valeurDe('Récupération') === plafondRecup,
    'A3 : la récupération bute sur la réserve à ' + plafondRecup +
    ' jours et n’en bouge plus');
  assert(plafondRecup < 30, 'A3 : ce plafond est bien une contrainte, pas l’infini');

  /* Le reste peut être négatif à l'affichage — c'est justement ce que le
     piège n° 5 met en garde. On vérifie que « Continuer » le refuse. */
  if (resteAffiche() !== 0) {
    assert(boutonExact(sheet, 'Continuer').disabled === true,
      'P8 : « Continuer » refuse aussi un reste NÉGATIF');
  }

  /* On revient à la proposition du moteur pour la suite du parcours. */
  remettreProposition();
  await pause(30);
  assert(!!sheet.querySelector('.reste.ok'), 'P7 : le compte est bon à nouveau');

  boutonExact(sheet, 'Continuer').click();
  await pause(300);

  /* ==================================================================== */
  /* P6 — Réserves insuffisantes : le sans-solde, et son coût             */
  /* A4 — le montant vient de Engine.montantCentimes                      */
  /* ==================================================================== */
  console.log('\n--- P6 : Tom, réserves insuffisantes ---');
  assert(txt(sheet).indexOf('Tom') !== -1, 'P6 : l’étape 2 passe au second contrat');
  assert(txt(sheet).indexOf('ne suffisent pas') !== -1,
    'P6 : l’écran DIT que les réserves de Tom ne suffisent pas');
  var cpTom = valeurDe('Congés payés');
  var supTom = valeurDe('Récupération');
  var ssTom = valeurDe('Sans solde');
  assert(cpTom + supTom + ssTom === 6, 'P6 : la proposition couvre bien les 6 jours');
  assert(ssTom > 0,
    'P6 : faute de réserves, une partie passe SANS SOLDE — c’est-à-dire en retenue ' +
    'sur salaire (obtenu ' + ssTom + ' jour(s))');
  assert(!!sheet.querySelector('.reste.ok'), 'P6 : le reste à répartir est nul');

  assert(txt(sheet).indexOf('sans solde') !== -1, 'V8-11 : l’effet du sans-solde est annoncé');
  assert(txt(sheet).indexOf('retenue de') !== -1,
    'V8-11 : la retenue est chiffrée AVANT le choix, pas découverte sur le document');
  /* A4 — le montant est bien celui du moteur, pas une règle de trois écrite
     dans l'écran. On le recalcule ici indépendamment. */
  var attendu = Engine.montantCentimes(200000, ssTom * 540);
  var euros = Format.centimesEnEuros(attendu);
  assert(sansInsecable(txt(sheet)).indexOf(sansInsecable(euros)) !== -1,
    'A4 : la retenue vaut ' + euros + ' — celle de Engine.montantCentimes (texte : « ' +
    (sansInsecable(txt(sheet)).match(/retenue de [^ ]+ [^ ]+/) || [''])[0] + ' »)');

  /* A3 — le sans-solde n'a PAS de borne de réserve : c'est le seul moyen de
     poser un congé quand les compteurs sont vides. Il est borné par la DURÉE
     de la période, jamais au-delà (piège n° 5 : pas de reste négatif). */
  cliquer('Congés payés', '−', 30);
  cliquer('Récupération', '−', 30);
  cliquer('Sans solde', '+', 30);
  await pause(30);
  assert(valeurDe('Sans solde') === 6,
    'A3 : le sans-solde peut couvrir toute la période (obtenu ' + valeurDe('Sans solde') + ')');
  cliquer('Sans solde', '+', 5);
  await pause(30);
  assert(valeurDe('Sans solde') === 6,
    'P5 (piège n° 5) : mais jamais AU-DELÀ — pas de reste négatif');
  assert(resteAffiche() === 0, 'le reste est bien nul');

  /* On revient à la proposition du moteur avant d'écrire. */
  remettreProposition();
  await pause(30);
  assert(!!sheet.querySelector('.reste.ok'), 'la ventilation est complète');

  boutonExact(sheet, 'Voir le récapitulatif').click();
  await pause(250);

  /* ==================================================================== */
  /* Étape 3 — le récapitulatif, puis l'écriture                          */
  /* A6 — l'imputation porte la PÉRIODE, pas les journées                 */
  /* ==================================================================== */
  console.log('\n--- Étape 3 : récapitulatif et écriture ---');
  assert(txt(sheet).indexOf('Vérifiez avant de poser') !== -1, 'l’étape 3 s’ouvre');
  assert(txt(sheet).indexOf('Léa') !== -1 && txt(sheet).indexOf('Tom') !== -1,
    'les deux ventilations sont côte à côte');
  assert(txt(sheet).indexOf('sans solde en tout') !== -1,
    'le total de sans-solde est rappelé en euros');
  assert(appels.imputations.length === 0, 'RIEN n’est écrit avant confirmation');

  boutonExact(sheet, 'Poser ces congés').click();
  await pause(350);

  assert(appels.poser.length === 1, 'les journées partent en UNE écriture groupée');
  assert(appels.poser[0].type === 'conge_maria', 'type écrit : conge_maria');
  assert(appels.imputations.length === 2, 'A6 : une imputation PAR CONTRAT');

  var impLea = appels.imputations.filter(function (i) { return i.contrat_id === 'c-lea'; })[0];
  assert(!!impLea, 'A6 : Léa a son imputation');
  assert(impLea.date_debut === '2026-07-06' && impLea.date_fin === '2026-07-10',
    'A6 : elle porte la PÉRIODE COMPLÈTE, pas une journée (piège n° 2)');
  assert(impLea.jours_ouvrables === 6, 'A6 : avec le décompte RG-06 de la période');
  assert(impLea.jours_sur_cp === 6 && impLea.jours_sur_sup === 0 && impLea.jours_sans_solde === 0,
    'A6 : et la ventilation choisie pour Léa');

  var impTom = appels.imputations.filter(function (i) { return i.contrat_id === 'c-tom'; })[0];
  /* LE POINT CENTRAL DU LOT. La MÊME semaine, sur la même période, produit
     deux ventilations DIFFÉRENTES parce que les réserves diffèrent : Léa la
     passe entièrement sur ses congés payés, Tom tombe en sans-solde faute de
     compteurs. Aucun arbitrage global n'aurait pu convenir aux deux. */
  assert(impTom.jours_sans_solde > 0,
    'A6 : Tom tombe en sans-solde faute de réserves (obtenu ' +
    impTom.jours_sans_solde + ')');
  assert(impLea.jours_sans_solde === 0,
    'A6 : Léa, elle, ne perd rien — mêmes dates, ventilation différente');
  assert(impTom.jours_sur_cp !== impLea.jours_sur_cp,
    'A6 : les deux ventilations ne sont PAS les mêmes (Léa cp=' + impLea.jours_sur_cp +
    ', Tom cp=' + impTom.jours_sur_cp + ')');
  assert(impTom.jours_sur_cp + impTom.jours_sur_sup + impTom.jours_sans_solde === impTom.jours_ouvrables,
    'A6 : la ventilation couvre exactement le décompte');

  assert(txt(toast).indexOf('Annuler') !== -1, 'V8-21 : un « Annuler » est proposé');

  /* ==================================================================== */
  /* P2 — Journée isolée : la même date dans les deux champs              */
  /* ==================================================================== */
  console.log('\n--- P2 : une seule journée ---');
  scene.imputations = {}; scene.journees = {};
  appels.imputations = []; appels.poser = [];
  await ouvrirConges();
  boutonExact(corps, 'Poser des congés').click();
  await pause(200);
  var ch2 = champsDates();
  poserDate(ch2.du, '2026-07-15');
  poserDate(ch2.au, '2026-07-15');
  await pause(80);
  assert(sansInsecable(txt(sheet)).indexOf('1 j ouvrables décomptés') !== -1,
    'P2 : une journée isolée décompte 1 jour (obtenu « ' +
    (sansInsecable(txt(sheet)).match(/\d+ j ouvrables/) || [''])[0] + ' »)');
  boutonExact(sheet, 'Continuer').click();
  await pause(300);
  assert(valeurDe('Congés payés') === 1, 'P2 : proposé sur les congés payés');
  window.Kit.fermerFeuille();
  await pause(50);

  /* ==================================================================== */
  /* P3 — Période à cheval sur deux mois                                  */
  /* ==================================================================== */
  console.log('\n--- P3 : période à cheval sur deux mois ---');
  await ouvrirConges();
  boutonExact(corps, 'Poser des congés').click();
  await pause(200);
  var ch3 = champsDates();
  poserDate(ch3.du, '2026-07-29');
  poserDate(ch3.au, '2026-08-04');
  await pause(80);
  var attenduCheval = Engine.decompterJoursOuvrables('2026-07-29', '2026-08-04');
  assert(sansInsecable(txt(sheet)).indexOf(attenduCheval + ' j ouvrables décomptés') !== -1,
    'P3 : le décompte d’une période à cheval vient du moteur — ' + attenduCheval +
    ' jours (obtenu « ' + (sansInsecable(txt(sheet)).match(/\d+ j ouvrables/) || [''])[0] + ' »)');
  boutonExact(sheet, 'Continuer').click();
  await pause(300);
  assert(txt(sheet).indexOf('à répartir') !== -1, 'P3 : la ventilation s’ouvre normalement');
  window.Kit.fermerFeuille();
  await pause(50);

  /* ==================================================================== */
  /* P4 / A5 — Période sur un mois CLÔTURÉ : réouverture acceptée         */
  /* ==================================================================== */
  console.log('\n--- P4 : le mois est clôturé ---');
  scene.recaps[cle('c-lea', 2026, 7)] = { id: 'r1', contrat_id: 'c-lea', annee: 2026, mois: 7,
    statut: 'fige', donnees: {}, fige_le: '2026-07-31T18:00:00Z', transmis_le: null };
  await ouvrirConges();
  boutonExact(corps, 'Poser des congés').click();
  await pause(200);
  var ch4 = champsDates();
  poserDate(ch4.du, '2026-07-20');
  poserDate(ch4.au, '2026-07-24');
  await pause(80);
  var avantImput = appels.imputations.length;
  boutonExact(sheet, 'Continuer').click();
  await pause(300);

  assert(txt(sheet).indexOf('est clôturé') !== -1,
    'A5 : la période recouvrant un mois clôturé est signalée');
  assert(txt(sheet).indexOf('Léa') !== -1, 'A5 : les contrats concernés sont nommés');
  assert(txt(sheet).indexOf('renvoyer les récapitulatifs déjà transmis') !== -1,
    'A5 : la conséquence pour les familles est dite');
  assert(appels.imputations.length === avantImput, 'A5 : RIEN n’est posé avant la réouverture');
  assert(!!parTexte(sheet, 'button', 'Rouvrir juillet et continuer'),
    'A5 : « Rouvrir juillet et continuer »');
  assert(!!boutonExact(sheet, 'Choisir d’autres dates'), 'A5 : « Choisir d’autres dates »');

  parTexte(sheet, 'button', 'Rouvrir juillet et continuer').click();
  await pause(350);
  assert(appels.rouvrir.length === 1, 'P4 : la réouverture est demandée');
  assert(appels.rouvrir[0].motif === 'Congés posés après clôture',
    'P4 : avec le motif prévu — c’est lui qui rendra l’historique lisible dans six mois ' +
    '(obtenu « ' + appels.rouvrir[0].motif + ' »)');
  assert(txt(sheet).indexOf('à répartir') !== -1, 'P4 : la ventilation s’ouvre ensuite');
  window.Kit.fermerFeuille();
  await pause(50);

  /* ==================================================================== */
  /* P5 — Même cas, mais Maria refuse                                     */
  /* ==================================================================== */
  console.log('\n--- P5 : le mois est clôturé, Maria refuse ---');
  scene.recaps[cle('c-lea', 2026, 7)] = { id: 'r1', contrat_id: 'c-lea', annee: 2026, mois: 7,
    statut: 'fige', donnees: {}, fige_le: '2026-07-31T18:00:00Z', transmis_le: null };
  await ouvrirConges();
  boutonExact(corps, 'Poser des congés').click();
  await pause(200);
  var ch5 = champsDates();
  poserDate(ch5.du, '2026-07-20');
  poserDate(ch5.au, '2026-07-24');
  await pause(80);
  var avantRouvrir = appels.rouvrir.length;
  boutonExact(sheet, 'Continuer').click();
  await pause(300);
  boutonExact(sheet, 'Choisir d’autres dates').click();
  await pause(200);

  assert(appels.rouvrir.length === avantRouvrir, 'P5 : aucune réouverture');
  assert(txt(sheet).indexOf('Quand serez-vous absente ?') !== -1,
    'P5 : on revient au choix des dates');
  window.Kit.fermerFeuille();
  await pause(50);
  delete scene.recaps[cle('c-lea', 2026, 7)];

  /* ==================================================================== */
  /* P9 — Retirer une période                                             */
  /* A7 — l'imputation ET les journées                                    */
  /* ==================================================================== */
  console.log('\n--- P9 : retirer une période ---');
  scene.imputations = {
    'c-lea': [{ id: 'i-lea', contrat_id: 'c-lea', date_debut: '2026-07-06',
      date_fin: '2026-07-10', jours_ouvrables: 6, jours_sur_cp: 6, jours_sur_sup: 0, jours_sans_solde: 0 }],
    'c-tom': [{ id: 'i-tom', contrat_id: 'c-tom', date_debut: '2026-07-06',
      date_fin: '2026-07-10', jours_ouvrables: 6, jours_sur_cp: 1, jours_sur_sup: 0, jours_sans_solde: 5 }]
  };
  scene.journees = {
    'c-lea': { '2026-07-06': { type: 'conge_maria' }, '2026-07-07': { type: 'conge_maria' } },
    'c-tom': { '2026-07-06': { type: 'conge_maria' }, '2026-07-07': { type: 'conge_maria' } }
  };
  appels.supprImput = []; appels.retirer = [];
  await ouvrirConges();
  parTexte(corps, 'button', 'Retirer des congés').click();
  await pause(300);

  var periode = parTexte(sheet, '.choice', '6 juillet');
  assert(!!periode, 'P9 : la période posée est listée');
  assert(txt(periode).indexOf('Léa') !== -1 && txt(periode).indexOf('Tom') !== -1,
    'P9 : une seule entrée pour les deux contrats — Maria n’a posé qu’une période');
  periode.click();
  await pause(200);

  assert(txt(sheet).indexOf('rendus à vos compteurs') !== -1,
    'P9 : la confirmation dit ce qui sera rendu');
  assert(sansInsecable(txt(sheet)).indexOf('6 j') !== -1, 'P9 : et combien');
  boutonExact(sheet, 'Retirer ces congés').click();
  await pause(350);

  assert(appels.supprImput.length === 2, 'A7 : les deux imputations sont supprimées');
  assert(appels.retirer.length === 1, 'A7 : et les journées remises en présence');
  assert(appels.retirer[0].ids.length === 2, 'A7 : sur les deux contrats');
  assert(appels.retirer[0].jours.indexOf('2026-07-06') !== -1,
    'A7 : les journées de la période sont bien visées');

  /* ==================================================================== */
  /* P10 — Panne réseau pendant l'écriture                                */
  /* ==================================================================== */
  console.log('\n--- P10 : panne pendant l’écriture ---');
  scene.imputations = {}; scene.journees = {};
  appels.imputations = []; appels.poser = [];
  await ouvrirConges();
  boutonExact(corps, 'Poser des congés').click();
  await pause(200);
  var ch6 = champsDates();
  poserDate(ch6.du, '2026-07-13');
  poserDate(ch6.au, '2026-07-17');
  await pause(80);
  boutonExact(sheet, 'Continuer').click();
  await pause(300);
  /* Le bouton de la DERNIÈRE étape s'appelle « Voir le récapitulatif », pas
     « Continuer » : on traverse la ventilation quel que soit le nombre de
     contrats plutôt que de supposer combien il y en a. */
  for (var pas = 0; pas < 6; pas++) {
    var bSuivant = boutonExact(sheet, 'Continuer') || boutonExact(sheet, 'Voir le récapitulatif');
    if (!bSuivant) break;
    bSuivant.click();
    await pause(300);
    if (boutonExact(sheet, 'Poser ces congés')) break;
  }
  assert(!!boutonExact(sheet, 'Poser ces congés'), 'P10 : l’étape 3 est atteinte');
  scene.ecritureCassee = true;
  boutonExact(sheet, 'Poser ces congés').click();
  await pause(350);

  assert(appels.imputations.length === 0, 'P10 : aucune imputation écrite');
  /* CORRECTIF B3 — le contrôle le plus important de ce cas, et il manquait :
     l'ancienne version posait les JOURNÉES d'abord et n'écoutait que les
     imputations. Sept journées par contrat pouvaient donc être écrites, sans
     ventilation, pendant que l'écran affichait « Enregistrement impossible ».
     On vérifie désormais les deux côtés de l'écriture. */
  assert(appels.poser.length === 0,
    'B3 : AUCUNE journée écrite non plus — l’écriture partielle est impossible');
  assert(txt(toast).indexOf('Rien n’a été enregistré') !== -1,
    'P10 : l’échec est dit (obtenu « ' + txt(toast).slice(0, 80) + ' »)');
  assert(txt(toast).indexOf('restés comme ils étaient') !== -1,
    'B3 : et le message dit ce qui reste vrai, au lieu de l’affirmer à tort');
  assert(document.getElementById('sheetwrap').hidden === false,
    'P10 : la feuille reste ouverte, la saisie n’est pas perdue');
  var bRetry = boutonExact(sheet, 'Poser ces congés');
  assert(bRetry && bRetry.disabled === false, 'P10 : on peut réessayer');
  scene.ecritureCassee = false;
  window.Kit.fermerFeuille();
  await pause(50);

  /* ==================================================================== */
  /* A8 / A9 — Le calendrier ne propose plus « Mon congé », et l'écran     */
  /* des congés ne calcule rien                                           */
  /* ==================================================================== */
  console.log('\n--- A8/A9 : le pinceau retiré, aucun calcul dans l’écran ---');
  window.App.invalider();
  window.App.aller('enfant', { contratId: 'c-lea', annee: 2026, mois: 7 });
  await pause(350);
  /* On est le 1er juillet dans ce décor : les jours POSTÉRIEURS ne sont pas
     touchables depuis le lot 7 — on ne saisit pas l'avenir. On prend donc le
     jour même, qui l'est. */
  var jour = Array.prototype.filter.call(
    corps.querySelectorAll('table.cal td[role="button"]'), function (td) {
      return txt(td.querySelector('.num')) === '1';
    })[0];
  assert(!!jour, 'le 1er juillet est touchable');
  jour.click();
  await pause(150);
  var choix = sheet.querySelectorAll('.choice');
  assert(choix.length === 2, 'A8 : DEUX marquages seulement (obtenu ' + choix.length + ')');
  assert(!parTexte(sheet, '.choice', 'Je ne travaillais pas'),
    'A8 : « Mon congé » a disparu du calendrier');
  assert(txt(sheet).indexOf('Mes congés') !== -1,
    'A8 : la phrase renvoie vers l’onglet « Mes congés »');
  window.Kit.fermerFeuille();
  await pause(50);

  /* A9 — aucun calcul métier dans ui-conges.js. On lit le fichier : il ne doit
     contenir aucune arithmétique de décompte ni de montant. Le seul calcul
     autorisé est l'addition des trois cases de la ventilation, qui n'est pas
     une règle métier mais une somme affichée. */
  var src = fs.readFileSync(path.join(racine, 'js', 'ui-conges.js'), 'utf8');
  assert(src.indexOf('Engine.decompterJoursOuvrables') !== -1,
    'A9 : le décompte est demandé au moteur');
  assert(src.indexOf('Engine.montantCentimes') !== -1,
    'A9 : le montant de la retenue aussi');
  assert(src.indexOf('Engine.imputerConges') !== -1,
    'A9 : et la répartition par défaut');
  assert(!/MINUTES_BASE|\/\s*151|\*\s*1\.5\b/.test(src),
    'A9 : aucune constante de calcul de salaire n’est écrite dans l’écran');

  /* ==================================================================== */
  console.log('');
  if (echecs) { console.error(echecs + ' échec(s).'); process.exit(1); }
  console.log('Tout est conforme.');
})().catch(function (e) {
  console.error('Erreur pendant le parcours :', e && e.stack || e);
  process.exit(1);
});
