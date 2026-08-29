/* ============================================================================
   Test de fumée — LA RÉCUPÉRATION SE GAGNE JOUR APRÈS JOUR, À L'ÉCRAN.

   Brief du 28 août 2026, §4.2 et §6.3.

   Le §2 du brief décrit deux moitiés du même défaut : le moteur refusait un
   jour de récupération financé par le mois en cours, et l'écran de pose —
   `plafondsDe` — plafonnait le stepper sur le seul compteur d'entrée, si bien
   que « Maria ne peut même pas essayer ».

   Ce fichier vérifie la moitié ÉCRAN, sur le vrai `index.html` :

     E1  LE STEPPER MONTE QUAND LA DATE AVANCE DANS LE MOIS. La même période
         d'un jour, posée en début puis en fin de mois, n'offre pas le même
         plafond de récupération — et c'est le mois travaillé entre les deux
         qui fait la différence.
     E2  LA PHRASE « dont N gagnés depuis le 1er » APPARAÎT SEULEMENT QUAND
         C'EST LE CAS : absente en début de mois, présente en fin de mois.
     E3  UNE DATE FUTURE NE GAGNE RIEN. Posée à une date que les journées
         travaillées n'ont pas encore financée, la récupération reste au
         plafond du 1er : l'arbitrage n° 1 se voit à l'écran comme au moteur.
     E4  L'ÉCRAN NE PROPOSE JAMAIS PLUS QUE LE MOTEUR N'ACCEPTE — le défaut du
         lot 16, vérifié dans l'autre sens : ce que le stepper autorise, le
         moteur le calcule sans lever.

   Décor : deux enfants, réserves différentes, repris tel quel du test de fumée
   du congé par enfant. Valeurs FICTIVES (dépôt public).

   Lancement : node test/recuperation-ecrans.smoke.js
   ========================================================================= */
'use strict';
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
function sansInsecable(t) { return String(t).replace(/[\u00a0\u202f]/g, ' '); }
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
  samedis: {},
  samedisEcrits: [],
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
  signOut: function () { return Promise.resolve(true); },
  /* LOT 16 §16.2 — le nom qui signe les documents. Décor : non renseigné,
     le document dira « votre assistante maternelle ». */
  getEmettrice: function () { return Promise.resolve(null); },
  enregistrerEmettrice: function (nom) { return Promise.resolve({ nom: nom }); },
  /* LOT 16 §16.4 — la ligne des rappels affiche désormais son VRAI réglage.
     Décor : rappels inactifs, la ligne dira « Vous ne recevez aucun rappel ». */
  getPreferenceRappel: function () { return Promise.resolve(null); },
  listContratsActifs: function () { return Promise.resolve(scene.contrats); },
  listContratsTous: function () { return Promise.resolve(scene.contrats); },
  listContratsPourMois: function () { return Promise.resolve(scene.contrats); },
  listContratsPourPeriode: function () { return Promise.resolve(scene.contrats); },
  listFamilles: function () { return Promise.resolve([]); },
  listFamillesToutes: function () { return Promise.resolve([]); },
  listFamillesAvecContrats: function () { return Promise.resolve([]); },
  getAvenants: function (id) {
    return Promise.resolve(Decor.avenantsDe(contratDe(id),
      [{ id: 's-' + id, contrat_id: id, date_effet: '2026-01-01',
         brut_mensuel_centimes: 200000, net_mensuel_centimes: 150000 }]));
  },
  getCompteurInitial: function (id) {
    var c = COMPTEURS[id];
    return Promise.resolve(Decor.compteurEnMinutes({ contrat_id: id,
      date_reference: '2026-07-01',
      minutes_sup: c.minutes_sup, dixiemes_cp_acquis: c.dixiemes_cp_acquis,
      dixiemes_cp_pris: c.dixiemes_cp_pris }));
  },
  getJourneesMois: function (id) { return Promise.resolve(scene.journees[id] || {}); },
  getJourneesPeriode: function () { return Promise.resolve({}); },
  listImputations: function (id) { return Promise.resolve(scene.imputations[id] || []); },
  /* LA RÈGLE DES CINQ SAMEDIS (specs du 24 août 2026) — le décor expose les
     trois fonctions neuves. Aucun samedi n'est compté au départ : c'est l'état
     réel après la migration, décision d'Adrien du 24 août (« on ne coche rien,
     les périodes passées perdent leur samedi »). */
  listSamedisConge: function (id) { return Promise.resolve(scene.samedis[id] || []); },
  compterSamedisAnnee: function (id, debut, fin) {
    return Promise.resolve((scene.samedis[id] || []).filter(function (x) {
      var d = String(x.date_samedi || x).slice(0, 10);
      return d >= debut && d <= fin;
    }).length);
  },
  enregistrerSamedis: function (imputationId, dates) {
    scene.samedisEcrits.push({ imputationId: imputationId, dates: dates });
    return Promise.resolve(dates.map(function (d) {
      return { imputation_id: imputationId, date_samedi: d };
    }));
  },
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
  /* LOT 20 — les périodes de familiarisation (§20.2). Le décor les rend
     vides : ces écrans-là n'en ont aucune, et la fiche du contrat doit
     l'afficher comme telle plutôt que d'échouer. */
  listPeriodesFamiliarisation: function () { return Promise.resolve([]); },
  listPeriodesFamiliarisationContrat: function () { return Promise.resolve([]); },
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
require('../js/ui-familiarisation.js');
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
/* LOT 26 — OUVRIR L'ÉCRAN DE POSE ET Y CHOISIR UNE PÉRIODE. Il n'y a plus
   de feuille de format, plus d'étape des dates, plus d'étape des samedis :
   un seul écran, qui CHARGE avant d'annoncer (conditions du mois visé,
   journées déjà saisies, quota réel des samedis). D'où l'attente. */
async function ouvrirPose(debut, fin) {
  boutonExact(corps, 'Poser des congés').click();
  await pause(200);
  var ch = champsDates();
  poserDate(ch.du, debut);
  poserDate(ch.au, fin || debut);
  await pause(500);
}

/* ==========================================================================
   LOT 26 §26.1 — LES AIDES SUIVENT L'ÉCRAN DE POSE UNIQUE.

   Il n'y a plus de feuille par étape : le format est un segmenté, les dates
   et le bloc vert du décompte sont dessous, et « Pour qui — déjà réparti »
   pose une carte par enfant (`.kid`) dont le chevron déplie trois steppers.
   La barre fixe porte le bouton qui récapitule et pose.

   UN POINT DE MÉCANIQUE : chaque appui sur un stepper REDESSINE la carte de
   l'enfant — c'est ce qui rééquilibre les autres lignes. Les aides
   re-interrogent donc le DOM à chaque clic ; garder une référence sur un
   bouton et l'appuyer deux fois n'aurait aucun effet la seconde fois.
   ========================================================================= */
function champsDates() {
  var blocs = sheet.querySelectorAll('.fld');
  return { du: blocs[0], au: blocs[1] };
}
function boutonPoser() { return sheet.querySelector('.stick button'); }

/* CORRECTIF 28 AOÛT — LES CASES « POUR QUI ». Le chemin « Des journées » porte
   désormais une case par enfant. Un enfant qui porte déjà un congé sur la
   période arrive DÉCOCHÉ ; les scénarios qui reposent sur une période déjà
   posée doivent le recocher pour retrouver le parcours d'avant.

   Chaque appui REDESSINE la zone : on re-interroge le DOM à chaque tour. */
function casesEnfants() {
  return Array.prototype.slice.call(sheet.querySelectorAll('button.choice.c1'));
}
function caseDe(prenom) {
  return casesEnfants().filter(function (b) {
    return txt(b.querySelector('.tx')).indexOf(prenom) === 0;
  })[0] || null;
}
async function cocherTousLesEnfants() {
  for (var garde = 0; garde < 12; garde++) {
    var b = casesEnfants().filter(function (x) {
      return x.getAttribute('aria-checked') !== 'true' &&
             x.className.indexOf('off') === -1;
    })[0];
    if (!b) return;
    b.click();
    await pause(60);
  }
}
function carteDe(prenom) {
  return Array.prototype.filter.call(sheet.querySelectorAll('.kid'), function (k) {
    return txt(k.querySelector('.nm')) === prenom;
  })[0] || null;
}
function ouvrirCarte(prenom) {
  var k = carteDe(prenom);
  if (k && k.className.indexOf('open') === -1) k.querySelector('.hd').click();
  return carteDe(prenom);
}
function compteurDe(prenom, libelle) {
  var k = carteDe(prenom);
  if (!k) return null;
  return Array.prototype.filter.call(k.querySelectorAll('.cnt'), function (c) {
    return txt(c.querySelector('.cl')).indexOf(libelle) === 0;
  })[0] || null;
}
function valeurDe(prenom, libelle) {
  var c = compteurDe(prenom, libelle);
  return c ? Number(txt(c.querySelector('.stp span'))) : null;
}
function sommeDe(prenom) {
  return valeurDe(prenom, 'Congés payés') + valeurDe(prenom, 'Récupération') +
         valeurDe(prenom, 'Sans solde');
}
function cliquer(prenom, libelle, signe, fois) {
  for (var i = 0; i < (fois || 1); i++) {
    var c = compteurDe(prenom, libelle);
    if (!c) return;
    var b = Array.prototype.filter.call(c.querySelectorAll('.stp button'), function (x) {
      return txt(x) === signe;
    })[0];
    if (!b || b.disabled) return;
    b.click();
  }
}
/* Les lignes de samedi du bloc vert. Une par samedi ET PAR ENFANT dès que
   plusieurs contrats peuvent le compter : le quota est par famille (§2.4). */
function lignesSamedi() {
  return Array.prototype.filter.call(sheet.querySelectorAll('.res .sam'), function (l) {
    return l.tagName === 'BUTTON';
  });
}
function samediDe(prenom) {
  return lignesSamedi().filter(function (l) { return txt(l).indexOf(prenom) !== -1; })[0] || null;
}
function grosDecompte() {
  var g = sheet.querySelector('.res .big2');
  return g ? sansInsecable(txt(g)) : '';
}

/* Les cases « Pour qui » d'un enfant nommé, et son état. */
function estCochee(b) { return !!b && b.getAttribute('aria-checked') === 'true'; }
function libelleBouton() { return sansInsecable(txt(boutonPoser())); }
function zoneTotal() { return txt(sheet); }

/* LE DÉCOR DE CE FICHIER — Léa entre juillet avec UN SEUL jour de
   récupération et aucun congé payé. C'est ce qui rend la démonstration
   lisible : au 1er juillet le stepper plafonne à 1, et il faut que le mois
   travaille pour qu'il monte à 2. Avec des réserves confortables, le plafond
   serait borné par le décompte de la période et rien ne se verrait. */
COMPTEURS['c-lea'] = { dixiemes_cp_acquis: 0, dixiemes_cp_pris: 0, minutes_sup: 540 };

/* La ligne « Récupération » de la carte d'un enfant, et sa phrase d'aide. */
function sousTitreRecup(prenom) {
  var c = compteurDe(prenom, 'Récupération');
  if (!c) return null;
  var cl = c.querySelector('.cl');
  return cl ? sansInsecable(txt(cl)) : null;
}
/* Le plafond ne s'affiche pas : on le MESURE, en appuyant sur « + » jusqu'à
   ce que le bouton s'éteigne. C'est ce que ferait un doigt, et c'est la seule
   mesure qui ne suppose rien du dessin de l'écran. */
function plafondRecup(prenom) {
  if (!compteurDe(prenom, 'Récupération')) return null;
  cliquer(prenom, 'Récupération', '+', 40);
  return valeurDe(prenom, 'Récupération');
}

/* Poser une période et ouvrir la carte de Léa. */
async function poserPeriode(debut, fin) {
  await ouvrirConges(2026, 7);
  await ouvrirPose(debut, fin);
  await cocherTousLesEnfants();
  await pause(250);
  ouvrirCarte('Léa');
  await pause(100);
}

/* Le moteur, interrogé exactement comme la chaîne l'interrogera après
   l'écriture. Rend le code de refus, ou null si le mois se calcule. */
function moteurSur(joursPoses, joursSurSup, entree, aujourdhui) {
  try {
    Engine.calculerMois({
      contrat: LEA,
      conditions: entree.conditions,
      journees: joursPoses.map(function (j) { return { jour: j, type: 'conge_maria' }; }),
      compteurEntree: entree.compteurEntree,
      annee: 2026, mois: 7,
      imputations: [{ id: 'i-test',
        date_debut: joursPoses[0], date_fin: joursPoses[joursPoses.length - 1],
        jours_ouvrables: joursPoses.length,
        jours_sur_cp: 0, jours_sur_sup: joursSurSup,
        jours_sans_solde: joursPoses.length - joursSurSup }],
      samedisComptes: [],
      aujourdhui: aujourdhui
    });
    return null;
  } catch (e) { return e.code || e.message; }
}

(async function () {
  document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  await pause(400);

  /* ==================================================================== */
  /* E1 + E2 — LE STEPPER MONTE, ET LA PHRASE DIT POURQUOI                */
  /* ==================================================================== */
  console.log('\n--- E1/E2 : le plafond suit la date dans le mois ---');

  /* On est le 31 juillet : tout le mois est passé. Léa entre juillet avec un
     seul jour de récupération ; vingt journées travaillées séparent le 1er du
     30 (le 14 est férié), soit 600 minutes — de quoi financer un second jour
     de 9 h. */
  scene.aujourdhui = '2026-07-31';

  /* Deux jours ouvrables, tout au DÉBUT du mois : rien n'a encore été gagné. */
  await poserPeriode('2026-07-01', '2026-07-02');
  var plafondDebut = plafondRecup('Léa');
  var phraseDebut = sousTitreRecup('Léa');
  assert(plafondDebut === 1,
    'E1 : au 1er juillet, le stepper plafonne au seul jour du compteur d’entrée ' +
    '(obtenu ' + plafondDebut + ')');
  assert(phraseDebut.indexOf('gagné') === -1,
    'E2 : le 1er juillet, rien n’a été gagné — la phrase se tait : ' + phraseDebut);

  /* Les deux mêmes jours ouvrables, tout à la FIN du mois. */
  await poserPeriode('2026-07-30', '2026-07-31');
  var plafondFin = plafondRecup('Léa');
  var phraseFin = sousTitreRecup('Léa');
  assert(plafondFin === 2,
    'E1 : au 30 juillet, le mois a financé un second jour (obtenu ' + plafondFin + ')');
  assert(plafondFin > plafondDebut,
    'E1 : le stepper MONTE quand la date avance dans le mois');
  assert(phraseFin.indexOf('dont 1 gagné depuis le 1er') !== -1,
    'E2 : la phrase annonce le jour gagné, et le bon nombre : ' + phraseFin);

  /* ==================================================================== */
  /* E3 — UNE DATE FUTURE NE GAGNE RIEN (arbitrage n° 1)                  */
  /* ==================================================================== */
  console.log('\n--- E3 : l’arbitrage n° 1, à l’écran ---');

  /* Même période du 30 au 31 juillet, mais on n'est que le 1er : aucune
     journée du mois n'est passée, rien n'est acquis. */
  scene.aujourdhui = '2026-07-01';
  await poserPeriode('2026-07-30', '2026-07-31');
  var plafondFutur = plafondRecup('Léa');
  var phraseFutur = sousTitreRecup('Léa');
  assert(plafondFutur === plafondDebut,
    'E3 : au 1er juillet, poser le 30 ne donne rien de plus (' + plafondFutur +
    ' contre ' + plafondDebut + ')');
  assert(phraseFutur.indexOf('gagné') === -1,
    'E3 : rien n’a été gagné, la phrase se tait : ' + phraseFutur);

  /* ==================================================================== */
  /* E4 — L'ÉCRAN ET LE MOTEUR DISENT LA MÊME CHOSE                       */
  /* ==================================================================== */
  console.log('\n--- E4 : le plafond de l’écran est celui du moteur ---');

  scene.aujourdhui = '2026-07-31';
  window.App.invalider();
  var serie = await window.App.serie(LEA, { annee: 2026, mois: 7 });
  var juillet = window.App.moisDe(serie, 2026, 7);
  var deuxJours = ['2026-07-30', '2026-07-31'];

  /* Ce que l'écran OFFRE le 30 juillet — deux jours — le moteur l'accepte. */
  var codeAccepte = moteurSur(deuxJours, 2, juillet, '2026-07-31');
  assert(codeAccepte === null,
    'E4 : ce que le stepper offre le 30 juillet, le moteur l’accepte (obtenu ' +
    codeAccepte + ')');

  /* Ce que l'écran REFUSE le 1er juillet — deux jours — le moteur le refuse
     aussi, et il le NOMME : les heures ne sont pas encore acquises. */
  var codeRefuse = moteurSur(deuxJours, 2, juillet, '2026-07-01');
  assert(codeRefuse === 'RESERVES_PAS_ENCORE_ACQUISES',
    'E4 : au 1er juillet, le moteur refuse et dit pourquoi (obtenu ' +
    codeRefuse + ')');

  /* Et la phrase que Maria lira est celle-là, pas « vous n’avez pas assez ». */
  var phrase = Messages.lisible({ code: 'RESERVES_PAS_ENCORE_ACQUISES',
    message: 'RESERVES_PAS_ENCORE_ACQUISES' });
  assert(String(phrase).indexOf('pas encore acquises') !== -1,
    'E4 : le refus se traduit en français, et dit la bonne chose : ' + phrase);

  /* -------------------------------------------------------------------- */
  console.log('');
  if (echecs) {
    console.error(echecs + ' assertion(s) en échec.');
    process.exit(1);
  }
  console.log('Tout est conforme.');
  process.exit(0);
})();
