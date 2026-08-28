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
  /* EXIGENCE CHANGÉE — LOT 26 §26.2 : « MES CONGÉS » S'ALLÈGE.
     La valeur d'une ligne de réserve redevient une VALEUR — « 19 j · 12h00 »
     au lieu de « 19 j de congés payés · 12h00 de récupération · samedis
     comptés : 0 sur 5 cette année », une phrase de trois membres posée dans
     la colonne des montants. Le titre de section dit déjà « Vos réserves »,
     et l'ordre — congés payés d'abord — est celui de la consommation (§18.5).
     Le quota de samedis descend en sous-texte, où il reste visible HORS de la
     pose (§7).
     CE QUE LOT 10 EXIGE NE BOUGE PAS : les DEUX réserves sont affichées,
     contrat par contrat, pour que Maria sache avant de poser si sa
     récupération lui évitera le sans-solde. C'est vérifié ici.
     « Les compteurs diffèrent car les contrats n'ont pas commencé en même
     temps. » quitte l'écran : c'est une RÈGLE, elle va dans « Comment
     l'application compte » (lot 27). Ce qu'elle expliquait est dit par la
     structure — une ligne par enfant, chacune avec ses propres nombres. */
  var lignesRes = Array.prototype.filter.call(corps.querySelectorAll('.ln'), function (l) {
    return txt(l).indexOf('Léa') === 0 || txt(l).indexOf('Tom') === 0;
  });
  assert(lignesRes.length === 2, 'une ligne par contrat (obtenu ' + lignesRes.length + ')');
  assert(/\d+ j/.test(sansInsecable(txt(lignesRes[0]))) && /\d+h\d\d/.test(txt(lignesRes[0])),
    'congés payés (en jours) ET récupération (en heures) — sans la seconde, ' +
    'Maria ne peut pas éviter le sans-solde (obtenu « ' + txt(lignesRes[0]) + ' »)');
  assert(txt(lignesRes[0]).indexOf('samedis') !== -1,
    '§7 : le reste du quota de samedis est visible hors de la pose');
  assert(txt(corps).indexOf('Les compteurs diffèrent') === -1,
    '§26.2 : la phrase d’explication a quitté l’écran');
  assert(txt(corps).indexOf('Un congé vaut pour vos 2 contrats.') !== -1,
    '§26.2 : les six mots qui restent, DEVANT le bouton (§18.6)');
  assert(!!boutonExact(corps, 'Poser des congés'), 'V8-08 : UN SEUL bouton de pose');
  assert(!parTexte(corps, 'button', 'Poser une semaine'), 'V8-08 : le mode semaine a disparu');
  assert(!parTexte(corps, 'button', 'Poser une seule journée'),
    'V8-08 : le faux raccourci « une seule journée » a disparu');

  /* ==================================================================== */
  /* P1 — Semaine complète, réserves suffisantes                          */
  /* A1 — 6 jours ouvrables, samedi inclus, décompte du MOTEUR            */
  /* ==================================================================== */
  console.log('\n--- P1 : semaine du lundi 6 au vendredi 10 juillet ---');
  /* ==========================================================================
     EXIGENCE CHANGÉE — LOT 26 §26.1 : HUIT ÉCRANS DEVIENNENT UN.

     Le parcours était : « Je pose… » (format) → les dates → les samedis →
     UNE FEUILLE DE VENTILATION PAR ENFANT → le récapitulatif. Tout tient
     maintenant sur un écran : le format en segmenté, Du/Au, le bloc vert du
     décompte avec ses samedis dedans, et « Pour qui — déjà réparti » qui pose
     une carte par enfant, dépliable.

     CE QUI CHANGE, ASSERTION PAR ASSERTION :

     - « Je pose… » et ses trois cartes -> un SEGMENTÉ. Les trois formats sont
       toujours proposés, ils ne coûtent plus un écran, et on change d'avis
       sans revenir en arrière. Libellés raccourcis (maquette) : « Des
       journées · ½ journée · Durée libre ».
     - « Quand serez-vous absente ? » et « mettez la même date dans les deux
       champs » -> les deux champs Du/Au, sur le même écran. La phrase
       disparaît parce que le geste est devenu évident : les deux champs sont
       côte à côte et déjà remplis avec la même date. LE CAS DE LA JOURNÉE
       UNIQUE EST VÉRIFIÉ EN P2, où il est réellement exercé.
     - « N j ouvrables décomptés » -> « N j ouvrables », dans le bloc vert. Le
       mot « décomptés » quitte le gros chiffre parce que la phrase juste
       dessous dit la règle du décompte en entier.
     - « Les samedis de cette période », son écran et ses cases -> les lignes
       du bloc vert, sous le chiffre qu'elles changent. Le quota reste RÉEL et
       PAR CONTRAT (§2.4, critère A5 du lot 23) : quand plusieurs enfants
       peuvent compter le même samedi, il y a une ligne par enfant, nommée.
       ÉCART ASSUMÉ À LA MAQUETTE, qui n'en montre qu'une : elle retirerait à
       Maria le droit de compter le samedi chez Léa et pas chez Tom.
     - « une feuille de ventilation PAR ENFANT », sa barre d'étapes, son
       panneau « Vos réserves pour ce contrat » et ses boutons « Continuer » ->
       une CARTE par enfant, déjà remplie par le moteur, dont le chevron
       déplie les trois mêmes steppers. Les réserves sont sous les steppers,
       en sous-texte de chaque ligne : « reste 19 j au compteur ».
     - « Reste à répartir » et « Continuer » désactivé -> RETIRÉS, et c'est
       plus fort que ce qu'ils protégeaient : la somme ne PEUT PLUS s'écarter
       du décompte, parce qu'ajuster une ligne rééquilibre les autres. Un
       bouton qu'on désactive dit « vous vous êtes trompée » ; une somme qui ne
       peut pas être fausse ne le demande jamais. C'est vérifié explicitement.
     - le récapitulatif « Vérifiez avant de poser » -> la BARRE FIXE, dont le
       libellé récapitule (« Poser 6 jours sur vos 2 contrats »), et le total
       du sans-solde chiffré juste au-dessus.

     AUCUNE GARANTIE N'EST AFFAIBLIE : le décompte vient du moteur, la
     répartition proposée aussi, les bornes des réserves sont celles du moteur,
     les congés payés ne passent jamais en négatif, le sans-solde ne dépasse
     jamais la période, et rien n'est écrit avant l'appui. Tout est vérifié
     ci-dessous.
     ====================================================================== */
  await ouvrirPose('2026-07-06', '2026-07-10');

  assert(txt(sheet).indexOf('Poser un congé') !== -1, 'P1 : la pose tient sur UN écran');
  var formats = Array.prototype.map.call(
    sheet.querySelector('.seg').querySelectorAll('button'), txt);
  assert(formats.join(' | ') === 'Des journées | ½ journée | Durée libre',
    'LOT 21 : les trois formats restent proposés, en segmenté (obtenu ' +
    formats.join(' | ') + ')');
  assert(!!champsDates().du && !!champsDates().au, 'P1 : les deux dates sont là');

  /* EXIGENCE CHANGÉE — LA RÈGLE DES CINQ SAMEDIS (specs du 24 août 2026).

     « Une semaine du lundi au vendredi décompte 6 JOURS » et « le samedi
     inclus est dit » portaient sur la règle d'avant : le samedi comptait
     d'office. Il ne compte plus que si Maria le choisit, et rien n'est coché
     par défaut. La semaine annonce donc 5. La preuve que 6 reste atteignable
     est juste en dessous. */
  assert(grosDecompte().indexOf('5 j ouvrables') !== -1,
    'A1 : sans samedi coché, une semaine du lundi au vendredi décompte 5 JOURS ' +
    '(obtenu « ' + grosDecompte() + ' »)');
  assert(txt(sheet).indexOf('que si vous le choisissez') !== -1,
    'A1 : la règle du décompte est dite — c’est le désaccord historique avec les familles');
  /* Le décompte vient du moteur : on le recalcule ici indépendamment. */
  assert(Engine.decompterJoursOuvrables('2026-07-06', '2026-07-10') === 5,
    'A1 : et c’est bien ce que rend Engine.decompterJoursOuvrables');
  assert(Engine.decompterJoursOuvrables('2026-07-06', '2026-07-10', null,
    ['2026-07-11']) === 6, 'A1 : avec le samedi coché, il en rend 6');

  /* ==================================================================== */
  /* §5 — LES SAMEDIS, DANS LE BLOC VERT                                  */
  /* ==================================================================== */
  console.log('\n--- §5 : les samedis, dans le bloc vert ---');

  assert(txt(sheet).indexOf('que si vous le choisissez') !== -1,
    '§5.2 : la règle est dite, avec son quota');
  assert(txt(sheet).indexOf('cinq') !== -1 || txt(sheet).indexOf('5 ') !== -1,
    '§5.2 : et le quota y figure');
  var samedis = lignesSamedi();
  /* A5 — LE QUOTA EST PAR CONTRAT : une ligne par enfant qui peut le compter,
     et cocher pour l'un ne coche rien pour l'autre. */
  assert(samedis.length === 2,
    '§5.2 + A5 : une ligne par samedi éligible ET par enfant (obtenu ' +
    samedis.length + ')');
  assert(txt(samedis[0]).indexOf('samedi 11 juillet') !== -1,
    '§5.2 : le samedi de la période est proposé, nommé en toutes lettres (obtenu « ' +
    txt(samedis[0]) + ' »)');
  assert(txt(samedis[0]).indexOf('reste 5 sur 5') !== -1,
    '§5.2 : le reste du quota est réel, lu en base et affiché (obtenu « ' +
    txt(samedis[0]) + ' »)');
  assert(samedis[0].getAttribute('aria-checked') === 'false',
    '§2.6 : rien n’est coché par défaut — c’est Maria qui arbitre');
  assert(!!samediDe('Léa') && !!samediDe('Tom'),
    'A5 : chaque enfant a SA ligne, nommée');

  samediDe('Léa').click();
  await pause(150);
  assert(grosDecompte().indexOf('de 5 à 6 j ouvrables') !== -1,
    'A3 : cocher le samedi de Léa change le décompte, rejoué par le moteur — ' +
    'et il diffère désormais d’un contrat à l’autre (obtenu « ' + grosDecompte() + ' »)');
  assert(txt(samediDe('Léa')).indexOf('reste 4 sur 5') !== -1,
    '§5.2 : et le reste du quota descend d’autant');
  assert(txt(samediDe('Tom')).indexOf('reste 5 sur 5') !== -1,
    'A5 : le quota de l’autre enfant n’a pas bougé — il est par contrat');

  /* ==================================================================== */
  /* « Pour qui — déjà réparti » : une carte par enfant                   */
  /* ==================================================================== */
  assert(txt(sheet).indexOf('Pour qui — déjà réparti') !== -1,
    '§26.1 : la répartition est DÉJÀ FAITE par le moteur — Maria arbitre, ' +
    'elle ne saisit pas');
  assert(!!carteDe('Léa') && !!carteDe('Tom'),
    'P1 : une carte par contrat, les deux sous les yeux en même temps');
  assert(!!sheet.querySelector('.stick'),
    '§26.1 : la barre fixe porte l’action, sans avoir à défiler');
  assert(sansInsecable(txt(boutonPoser())).indexOf('Poser') === 0,
    '§26.1 point 5 : le libellé du bouton récapitule (obtenu « ' +
    txt(boutonPoser()) + ' »)');

  ouvrirCarte('Léa');
  await pause(60);
  /* Répartition proposée par le moteur : Léa a 19 jours de CP, les 6 jours y
     tiennent entièrement. */
  assert(valeurDe('Léa', 'Congés payés') === 6,
    'P1 : la proposition par défaut met 6 sur les congés payés');
  assert(valeurDe('Léa', 'Récupération') === 0, 'P1 : rien sur la récupération');
  assert(valeurDe('Léa', 'Sans solde') === 0, 'P1 : rien sans solde');
  assert(sommeDe('Léa') === 6, 'P1 : la somme fait exactement le décompte');
  assert(txt(carteDe('Léa')).indexOf('6 j payés') !== -1,
    'P1 : et la carte le dit sans qu’il faille la déplier');
  assert(boutonPoser().disabled === false, 'A2 : le bouton de pose est actif');

  /* ==================================================================== */
  /* P7 — Modification manuelle de la répartition                         */
  /* A3 — les bornes des compteurs                                        */
  /* P8 — la somme ne peut plus s'écarter du décompte                     */
  /* ==================================================================== */
  console.log('\n--- P7 : Maria modifie la répartition ---');
  cliquer('Léa', 'Congés payés', '−', 2);
  await pause(60);
  assert(valeurDe('Léa', 'Congés payés') === 4, 'P7 : les congés payés descendent à 4');
  /* P8 — L'EXIGENCE EST RENFORCÉE : au lieu d'un « reste » non nul et d'un
     bouton désactivé, les deux jours retirés sont RETOMBÉS sur le sans-solde.
     La somme fait toujours le décompte, donc rien à refuser. */
  assert(sommeDe('Léa') === 6,
    'P8 : la somme reste égale au décompte — ajuster une ligne rééquilibre ' +
    'les autres (obtenu ' + sommeDe('Léa') + ')');
  assert(boutonPoser().disabled === false,
    'A2 : le bouton reste actif, parce qu’une ventilation incomplète est ' +
    'devenue impossible');

  cliquer('Léa', 'Récupération', '+', 2);
  await pause(60);
  assert(valeurDe('Léa', 'Récupération') === 2, 'P7 : deux jours sur la récupération');
  assert(sommeDe('Léa') === 6, 'P7 : et la somme fait toujours le compte');

  /* A3 — la récupération est BORNÉE par la réserve. On ne suppose pas sa
     valeur exacte : elle dépend du mois rejoué par le moteur. Ce qui se
     vérifie, c'est qu'un mur existe et qu'on ne le franchit pas. */
  cliquer('Léa', 'Récupération', '+', 30);
  await pause(60);
  var plafondRecup = valeurDe('Léa', 'Récupération');
  cliquer('Léa', 'Récupération', '+', 5);
  await pause(60);
  assert(valeurDe('Léa', 'Récupération') === plafondRecup,
    'A3 : la récupération bute sur la réserve à ' + plafondRecup +
    ' jours et n’en bouge plus');
  assert(plafondRecup < 30, 'A3 : ce plafond est bien une contrainte, pas l’infini');
  assert(sommeDe('Léa') === 6, 'P5 (piège n° 5) : et la somme n’a jamais dépassé le décompte');

  /* On revient à la proposition du moteur pour la suite du parcours : tout
     sur les congés payés, qui couvrent. */
  cliquer('Léa', 'Congés payés', '+', 30);
  await pause(60);
  assert(valeurDe('Léa', 'Congés payés') === 6 && sommeDe('Léa') === 6,
    'P7 : le compte est bon à nouveau');

  /* ==================================================================== */
  /* P6 — Réserves insuffisantes : le sans-solde, et son coût             */
  /* A4 — le montant vient de Engine.montantCentimes                      */
  /* ==================================================================== */
  console.log('\n--- P6 : Tom, réserves insuffisantes ---');
  ouvrirCarte('Tom');
  await pause(60);
  assert(!!carteDe('Tom'), 'P6 : la carte de Tom est sur le même écran que celle de Léa');
  /* MISE À JOUR LOT 16 §16.1 d) — la phrase change et se CHIFFRE. « Les
     réserves ne suffisent pas » disait le problème ; l'écran annonce le
     basculement en sans solde ET son coût, avant le geste. Elle vivait dans
     un encart par contrat plus un total sur le récapitulatif ; les deux
     écrans ont disparu, la phrase est au-dessus de la barre fixe. */
  assert(txt(sheet).indexOf('Vos réserves ne couvrent pas toute la période') !== -1,
    'P6 / §16.1 d) : l’écran DIT que les réserves ne couvrent pas la période');
  assert(txt(sheet).indexOf('passent en sans solde') !== -1,
    '§16.1 d) : et que le solde bascule en sans solde');
  assert(txt(sheet).indexOf('Vous pouvez changer avant de poser') !== -1,
    '§16.1 d) : rien n’est imposé — tout est annoncé');

  var cpTom = valeurDe('Tom', 'Congés payés');
  var supTom = valeurDe('Tom', 'Récupération');
  var ssTom = valeurDe('Tom', 'Sans solde');
  /* CRITÈRE A5 EN ACTION. Le samedi de LÉA a été coché, celui de TOM non. Le
     quota étant par contrat, la période de Tom compte 5 jours quand celle de
     Léa en compte 6 : « sur une même période, Maria peut compter le samedi
     pour Léa et pas pour Tom » (§2.4). */
  assert(cpTom + supTom + ssTom === 5,
    'A5 : la proposition de Tom couvre ses 5 jours — son samedi n’a pas été ' +
    'coché, celui de Léa si (obtenu ' + (cpTom + supTom + ssTom) + ')');
  assert(ssTom > 0,
    'P6 : faute de réserves, une partie passe SANS SOLDE — c’est-à-dire en ' +
    'retenue sur salaire (obtenu ' + ssTom + ' jour(s))');
  assert(carteDe('Tom').className.indexOf('warn') !== -1,
    '§26.1 point 4 : la ligne de Tom passe en orange dès qu’il y a du sans solde');
  assert(txt(carteDe('Tom')).indexOf('sans solde') !== -1,
    'V8-11 : l’effet du sans-solde est annoncé sur la carte elle-même');

  /* A4 — le montant est bien celui du moteur, pas une règle de trois écrite
     dans l'écran. On le recalcule ici indépendamment. */
  var attendu = Engine.montantCentimes(200000, ssTom * 540);
  var euros = Format.centimesEnEuros(attendu);
  assert(sansInsecable(txt(carteDe('Tom'))).indexOf(sansInsecable(euros)) !== -1,
    'A4 : la retenue vaut ' + euros + ' — celle de Engine.montantCentimes ' +
    '(carte : « ' + sansInsecable(txt(carteDe('Tom'))) + ' »)');
  assert(txt(sheet).indexOf('de retenue sur vos salaires') !== -1,
    'V8-11 : et le TOTAL est chiffré au-dessus du bouton, avant l’appui');

  /* A3 — le sans-solde n'a PAS de borne de réserve : c'est le seul moyen de
     poser un congé quand les compteurs sont vides. Il est borné par la DURÉE
     de la période, jamais au-delà (piège n° 5). */
  cliquer('Tom', 'Sans solde', '+', 30);
  await pause(60);
  assert(valeurDe('Tom', 'Sans solde') === 5,
    'A3 : le sans-solde peut couvrir toute la période (obtenu ' +
    valeurDe('Tom', 'Sans solde') + ')');
  cliquer('Tom', 'Sans solde', '+', 5);
  await pause(60);
  assert(valeurDe('Tom', 'Sans solde') === 5,
    'P5 (piège n° 5) : mais jamais AU-DELÀ');
  assert(sommeDe('Tom') === 5, 'et la somme fait exactement le décompte');
  /* A4 — les congés payés ne passent JAMAIS en négatif, par aucun chemin. */
  assert(valeurDe('Tom', 'Congés payés') >= 0 && valeurDe('Tom', 'Récupération') >= 0,
    'A4 : aucune réserve ne passe en négatif');

  /* On revient à la proposition du moteur avant d'écrire. */
  cliquer('Tom', 'Congés payés', '+', 30);
  cliquer('Tom', 'Récupération', '+', 30);
  await pause(60);
  assert(sommeDe('Tom') === 5, 'la ventilation couvre exactement le décompte');
  var ssFinalTom = valeurDe('Tom', 'Sans solde');
  assert(ssFinalTom > 0, 'et Tom reste en sans-solde : ses réserves ne suffisent pas');

  /* ==================================================================== */
  /* Étape 3 — le récapitulatif, puis l'écriture                          */
  /* A6 — l'imputation porte la PÉRIODE, pas les journées                 */
  /* ==================================================================== */
  console.log('\n--- L’écriture ---');
  /* EXIGENCE CHANGÉE — LOT 26 §26.1 : LE RÉCAPITULATIF DISPARAÎT.
     « Vérifiez avant de poser » montrait, sur un septième écran, ce que
     l'écran de pose montre déjà : les deux ventilations, et le total du
     sans-solde chiffré. Les vérifier deux fois n'ajoutait rien — sauf deux
     appuis.
     RIEN NE SE PERD : les deux ventilations sont côte à côte (vérifié
     ci-dessus, cartes de Léa et de Tom), le total du sans-solde est au-dessus
     du bouton, et RIEN n'est écrit avant l'appui — ce qui reste la garantie
     de fond, et se vérifie ici. */
  assert(!!carteDe('Léa') && !!carteDe('Tom'),
    'les deux ventilations sont côte à côte, sur le même écran');
  assert(txt(sheet).indexOf('sans solde en tout') !== -1,
    'le total de sans-solde est rappelé en euros');
  assert(appels.imputations.length === 0, 'RIEN n’est écrit avant l’appui');

  boutonPoser().click();
  await pause(450);

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
  /* LOT 26 — LE CAS DE LA JOURNÉE UNIQUE. La phrase « pour une seule journée,
     mettez la même date dans les deux champs » a disparu avec la feuille des
     dates : les deux champs sont côte à côte et ARRIVENT DÉJÀ REMPLIS avec la
     même date. Le geste est devenu évident ; ce qu'il produit est vérifié
     ici, et c'est ce qui compte. */
  await ouvrirPose('2026-07-15');
  assert(grosDecompte().indexOf('1 j ouvrables') !== -1,
    'P2 : une journée isolée décompte 1 jour (obtenu « ' + grosDecompte() + ' »)');
  ouvrirCarte('Léa');
  await pause(60);
  assert(valeurDe('Léa', 'Congés payés') === 1, 'P2 : proposé sur les congés payés');
  window.Kit.fermerFeuille();
  await pause(50);

  /* ==================================================================== */
  /* P3 — Période à cheval sur deux mois                                  */
  /* ==================================================================== */
  console.log('\n--- P3 : période à cheval sur deux mois ---');
  await ouvrirConges();
  await ouvrirPose('2026-07-29', '2026-08-04');
  var attenduCheval = Engine.decompterJoursOuvrables('2026-07-29', '2026-08-04');
  assert(grosDecompte().indexOf(attenduCheval + ' j ouvrables') !== -1,
    'P3 : le décompte d’une période à cheval vient du moteur — ' + attenduCheval +
    ' jours (obtenu « ' + grosDecompte() + ' »)');
  assert(!!carteDe('Léa'), 'P3 : la répartition s’affiche normalement');
  window.Kit.fermerFeuille();
  await pause(50);

  /* ==================================================================== */
  /* P4 / A5 — Période sur un mois CLÔTURÉ : réouverture acceptée         */
  /* ==================================================================== */
  console.log('\n--- P4 : le mois est clôturé ---');
  scene.recaps[cle('c-lea', 2026, 7)] = { id: 'r1', contrat_id: 'c-lea', annee: 2026, mois: 7,
    statut: 'fige', donnees: {}, fige_le: '2026-07-31T18:00:00Z', transmis_le: null };
  await ouvrirConges();
  /* EXIGENCE DÉPLACÉE — LOT 26 §26.1, « ce qui ne se perd pas » : la
     vérification des mois clôturés ne s'intercale plus entre les dates et la
     ventilation, mais À L'APPUI SUR « POSER ». Elle est ainsi lue au moment
     où elle décide de quelque chose, et ses textes n'ont pas changé d'un mot.
     LA GARANTIE EST LA MÊME, et se vérifie de la même façon : rien n'est posé
     avant la réouverture. */
  await ouvrirPose('2026-07-20', '2026-07-24');
  var avantImput = appels.imputations.length;
  boutonPoser().click();
  await pause(400);

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
  await pause(600);
  assert(appels.rouvrir.length === 1, 'P4 : la réouverture est demandée');
  assert(appels.rouvrir[0].motif === 'Congés posés après clôture',
    'P4 : avec le motif prévu — c’est lui qui rendra l’historique lisible dans six mois ' +
    '(obtenu « ' + appels.rouvrir[0].motif + ' »)');
  /* LOT 26 — LA RÉOUVERTURE POSE ENSUITE, directement : les plans sont refaits
     (les mois viennent de changer d'état) et l'écriture part. Le parcours ne
     redemande pas une ventilation que Maria a déjà faite avant d'appuyer. */
  assert(appels.imputations.length > avantImput,
    'P4 : après la réouverture, les congés sont posés — sans redemander la ' +
    'ventilation déjà faite');
  window.Kit.fermerFeuille();
  await pause(50);

  /* ==================================================================== */
  /* P5 — Même cas, mais Maria refuse                                     */
  /* ==================================================================== */
  console.log('\n--- P5 : le mois est clôturé, Maria refuse ---');
  scene.recaps[cle('c-lea', 2026, 7)] = { id: 'r1', contrat_id: 'c-lea', annee: 2026, mois: 7,
    statut: 'fige', donnees: {}, fige_le: '2026-07-31T18:00:00Z', transmis_le: null };
  await ouvrirConges();
  await ouvrirPose('2026-07-20', '2026-07-24');
  /* CORRECTIF 28 AOÛT — P4 vient de poser ces mêmes dates : les deux enfants
     arrivent décochés, « congé déjà posé sur cette période ». On les recoche
     pour rejouer le refus de réouverture tel qu'il était. */
  await cocherTousLesEnfants();
  await pause(120);
  var avantRouvrir = appels.rouvrir.length;
  var avantImput5 = appels.imputations.length;
  boutonPoser().click();
  await pause(400);
  boutonExact(sheet, 'Choisir d’autres dates').click();
  await pause(250);

  assert(appels.rouvrir.length === avantRouvrir, 'P5 : aucune réouverture');
  assert(appels.imputations.length === avantImput5, 'P5 : et rien n’est posé');
  /* EXIGENCE CHANGÉE — « on revient au choix des dates » : l'écran de pose est
     TOUJOURS DERRIÈRE cette feuille, avec les dates que Maria vient de saisir.
     Refermer suffit à y revenir, et elle les retrouve telles quelles au lieu
     de les ressaisir. C'est plus fort que l'ancien retour, qui rouvrait une
     feuille vide. */
  assert(!!champsDates().du && !!champsDates().au,
    'P5 : on revient au choix des dates');
  assert(grosDecompte().indexOf('j ouvrables') !== -1,
    'P5 : et les dates saisies sont toujours là (obtenu « ' + grosDecompte() + ' »)');
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
  /* LOT 26 — SIX ÉCRANS À TRAVERSER DEVIENNENT UN. La boucle qui enchaînait
     « Continuer » jusqu'à trouver « Poser ces congés » n'a plus d'objet : le
     bouton de la barre fixe est là dès que les dates sont posées. */
  await ouvrirPose('2026-07-13', '2026-07-17');
  assert(!!boutonPoser() && boutonPoser().disabled === false,
    'P10 : le bouton de pose est atteint en un écran');
  scene.ecritureCassee = true;
  boutonPoser().click();
  await pause(450);

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
  var bRetry = boutonPoser();
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
  var choix = sheet.querySelectorAll('.liste-choix .choice');
  /* EXIGENCE CHANGÉE — LA FEUILLE DU JOUR EST REFAITE COMME LA MAQUETTE
     (23 août 2026). Deux assertions changent parce que l'écran change ; la
     règle A8, elle, ne change pas d'un mot.
       - « DEUX marquages seulement » comptait les deux cartes de l'ancienne
         feuille. Il y a maintenant sept choix du même style, dont aucun n'est
         un congé — c'est CELA que A8 exige, et c'est ce que vérifie
         l'assertion remplaçante, plus stricte que le simple décompte.
       - « la phrase renvoie vers l'onglet Mes congés » portait sur le
         paragraphe permanent, retiré sur décision d'Adrien du 23 août : il
         expliquait où poser un congé sur une feuille où l'on ne vient pas en
         poser un. Le chemin unique des congés est inchangé, et il reste dit
         là où il sert — sur une journée qui PORTE un congé (correction B2,
         vérifiée dans lot21-conges-heure.smoke.js). */
  assert(choix.length === 7, 'A8 : la liste unique de la maquette (obtenu ' +
    choix.length + ')');
  assert(!parTexte(sheet, '.choice', 'Je ne travaillais pas'),
    'A8 : « Mon congé » a disparu du calendrier');
  assert(!Array.prototype.some.call(choix, function (x) {
    return txt(x).toLowerCase().indexOf('congé') !== -1;
  }), 'A8 : AUCUN choix de congé dans la feuille du jour — la ventilation ' +
    'contrat par contrat appartient à « Mes congés »');
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
  /* A7 — LE SIXIÈME SAMEDI : COCHABLE, MAIS DIT                          */
  /* A10 — RETIRER UNE PÉRIODE REND SES SAMEDIS AU QUOTA                  */
  /* ==================================================================== */
  console.log('\n--- A7 : le sixième samedi de l’année ---');

  /* Cinq samedis déjà comptés pour Léa sur l'année de référence en cours
     (1er juin 2026 – 31 mai 2027) : son quota est épuisé. */
  scene.samedis['c-lea'] = ['2026-06-06', '2026-06-13', '2026-06-20',
                            '2026-06-27', '2026-07-04'].map(function (d) {
    return { imputation_id: 'i-vieille', date_samedi: d };
  });

  await ouvrirConges();
  await ouvrirPose('2026-10-19', '2026-10-23');

  /* EXIGENCE DÉPLACÉE — LOT 26 §26.1 : l'étape des samedis devient les lignes
     du bloc vert, sous le chiffre qu'elles changent. Le libellé du reste passe
     de la phrase « vous avez utilisé vos 5 samedis (1er juin 2026 – 31 mai
     2027) », posée en tête de bloc, à la mention courte de la ligne elle-même
     — « quota épuisé », puis « dépassement de 1 ». Il n'y a plus de place pour
     une phrase à droite d'une case, et l'année de référence reste nommée dans
     l'avertissement de dépassement, qui est l'endroit où elle décide de
     quelque chose.
     LA RÈGLE NE BOUGE PAS : le quota est réel, lu en base, par contrat ; la
     ligne reste cochable ; le dépassement est nommé et permis. */
  var lignesA7 = lignesSamedi();
  assert(lignesA7.length > 0, 'A7 : le samedi reste proposé malgré le quota épuisé');
  var ligneLea = samediDe('Léa') || lignesA7[0];
  assert(txt(ligneLea).indexOf('quota épuisé') !== -1,
    'A7 : le quota épuisé est annoncé avant tout choix (obtenu « ' +
    txt(ligneLea) + ' »)');
  assert(ligneLea.disabled === false,
    'A7 : et la ligne reste COCHABLE — l’application ne décide pas à la place de Maria');
  ligneLea.click();
  await pause(250);

  assert(txt(sheet).indexOf('C’est le 6ᵉ samedi compté') !== -1,
    'A7 : le dépassement est NOMMÉ (obtenu « ' +
    (txt(sheet).match(/C’est le [^.]{0,40}/) || [''])[0] + ' »)');
  assert(txt(sheet).indexOf('1er juin 2026 – 31 mai 2027') !== -1,
    'A6 : et l’année de référence est nommée, du 1er juin au 31 mai');
  assert(txt(sheet).indexOf('vous pouvez le compter quand même') !== -1,
    'A7 : il reste permis — même logique que la récupération négative du lot 21');
  assert(!!sheet.querySelector('.warnbox'),
    'A7 : l’avertissement est orange, comme les autres avertissements de l’application');
  var ligneApres = samediDe('Léa') || lignesSamedi()[0];
  assert(txt(ligneApres).indexOf('dépassement de 1') !== -1,
    'A7 : et la ligne dit le dépassement ensuite (obtenu « ' + txt(ligneApres) + ' »)');

  window.Kit.fermerFeuille();
  await pause(50);
  scene.samedis['c-lea'] = [];

  /* A10 — la cascade. Elle n'est PAS écrite dans l'application : c'est la
     clé étrangère `on delete cascade` de `018_samedis_comptes.sql` qui la
     tient. Ce que ce test peut vérifier ici, c'est qu'aucun code de nettoyage
     ne s'y substitue — un nettoyage écrit à la main serait une deuxième règle,
     donc une règle à oublier. La cascade elle-même est vérifiée en base, sur
     le catalogue PostgreSQL, à la mise en production. */
  var srcConges = fs.readFileSync(path.join(racine, 'js', 'ui-conges.js'), 'utf8');
  assert(srcConges.indexOf('supprimerSamedi') === -1 &&
         srcConges.indexOf('retirerSamedis') === -1,
    'A10 : aucun retrait de samedi écrit à la main — c’est la cascade qui rend le quota');

  /* ==================================================================== */
  console.log('');
  if (echecs) { console.error(echecs + ' échec(s).'); process.exit(1); }
  console.log('Tout est conforme.');
})().catch(function (e) {
  console.error('Erreur pendant le parcours :', e && e.stack || e);
  process.exit(1);
});
