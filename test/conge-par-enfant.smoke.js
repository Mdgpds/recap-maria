/* ============================================================================
   Test de fumée — CORRECTIF DU 28 AOÛT 2026 : poser un congé pour les enfants
   que Maria choisit, sur le chemin « Des journées ».

   POURQUOI CE FICHIER EXISTE.

   « Je ne peux pas poser un congé seulement avec un enfant » (Adrien, 28 août
   2026). Les chemins « ½ journée » et « Durée libre » offraient une case par
   enfant depuis le lot 21 ; « Des journées » n'en offrait aucune, et la phrase
   « Un congé vaut pour vos 3 contrats » énonçait la contrainte sans donner le
   moyen d'y échapper. Deux situations butaient dessus, et la seconde s'est
   produite : rattraper une période oubliée chez un enfant, et poser sur une
   période où un contrat démarre, se termine ou est suspendu.

   CE QUI SE VÉRIFIE ICI :
     - une case par enfant dans « Pour qui — déjà réparti », cochée par défaut ;
     - décocher retire l'enfant du décompte, du libellé du bouton et du total ;
     - AUCUNE IMPUTATION n'est écrite pour un enfant décoché — c'est
       l'assertion la plus importante du fichier : une imputation orpheline
       consommerait des congés payés qu'aucune journée n'expliquerait, et
       personne ne pourrait la retrouver ;
     - un enfant qui porte déjà un congé sur la période arrive DÉCOCHÉ, et le
       recocher déclenche l'avertissement d'écrasement avant l'écriture ;
     - tout décocher rend le bouton inactif, sans chiffre ;
     - un enfant décoché ne propose plus ses samedis et n'en consomme aucun.

   CE QUI NE DOIT PAS BOUGER, et qui est vérifié ici aussi : la ventilation
   reste par enfant, les bornes restent celles de chaque contrat, et le
   décompte vient toujours du moteur.

   Lancement : node test/conge-par-enfant.smoke.js
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

/* Les cases « Pour qui » d'un enfant nommé, et son état. */
function estCochee(b) { return !!b && b.getAttribute('aria-checked') === 'true'; }
function libelleBouton() { return sansInsecable(txt(boutonPoser())); }
function zoneTotal() { return txt(sheet); }

(async function () {
  document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  await pause(300);

  /* ==================================================================== */
  /* §3 — UNE CASE PAR ENFANT, COCHÉE PAR DÉFAUT                          */
  /* ==================================================================== */
  console.log('\n--- §3 : une case par enfant, cochée par défaut ---');
  await ouvrirConges();
  await ouvrirPose('2026-07-06', '2026-07-10');

  assert(casesEnfants().length === 2,
    '§3 : une case par enfant dans « Pour qui » (obtenu ' + casesEnfants().length + ')');
  assert(!!caseDe('Léa') && !!caseDe('Tom'),
    '§3 : et chaque case porte le prénom de l’enfant');
  assert(estCochee(caseDe('Léa')) && estCochee(caseDe('Tom')),
    '§3 : tous les enfants sont cochés par défaut');
  assert(caseDe('Léa').getAttribute('role') === 'checkbox',
    '§3 : c’est bien une case à cocher, pas un bouton muet — même composant ' +
    'que le chemin « à l’heure »');
  assert(!!carteDe('Léa') && !!carteDe('Tom'),
    '§4 : la ventilation reste par enfant — une carte chacun');

  assert(txt(sheet).indexOf('Décochez un enfant pour ne pas poser chez lui.') !== -1,
    '§3 : la phrase dit le vrai, et dit le geste');
  assert(txt(sheet).indexOf('Un congé vaut pour') === -1,
    '§3 : « Un congé vaut pour vos N contrats » a quitté l’écran de pose — ' +
    'la contrainte qu’elle énonçait n’existe plus');

  assert(libelleBouton() === 'Poser 5 j sur 2 contrats',
    '§3 : le libellé compte les enfants retenus (obtenu « ' + libelleBouton() + ' »)');

  /* ==================================================================== */
  /* §3 — DÉCOCHER UN ENFANT LE RETIRE DE LA POSE                         */
  /* ==================================================================== */
  console.log('\n--- §3 : décocher retire l’enfant de la pose ---');

  /* Le sans-solde de Tom est visible AVANT : ses réserves sont vides. C'est
     ce total qui doit disparaître avec lui. */
  assert(zoneTotal().indexOf('sans solde en tout') !== -1,
    '§3 : avant de décocher, le total de sans solde de Tom est annoncé');
  assert(!!samediDe('Tom') && !!samediDe('Léa'),
    'A5 : chaque enfant propose SON samedi — le quota est par famille');

  caseDe('Tom').click();
  await pause(200);

  assert(!estCochee(caseDe('Tom')), '§3 : Tom est décoché');
  assert(estCochee(caseDe('Léa')), '§3 : Léa ne bouge pas');
  assert(!carteDe('Tom'), '§3 : sa ventilation disparaît — on n’arbitre pas pour ' +
    'quelqu’un qu’on ne pose pas');
  assert(!!carteDe('Léa'), '§4 : celle de Léa reste, avec ses propres plafonds');
  assert(libelleBouton() === 'Poser 5 j sur 1 contrat',
    '§3 : le libellé compte 1 contrat, pas tous (obtenu « ' + libelleBouton() + ' »)');
  assert(zoneTotal().indexOf('sans solde en tout') === -1,
    '§3 : et il disparaît du total en bas de feuille');
  assert(!samediDe('Tom'),
    '§4 : un enfant décoché ne propose plus ses samedis — il n’en consomme aucun');
  /* Il reste UNE ligne de samedi, et elle ne nomme plus personne : quand un
     seul contrat peut compter ce samedi, la maquette dit « Compter le samedi
     11 juillet », sans prénom. C'est le comportement d'avant, retrouvé parce
     qu'il ne reste qu'un enfant retenu. */
  assert(lignesSamedi().length === 1 && txt(lignesSamedi()[0]).indexOf('Tom') === -1,
    '§4 : celui de Léa reste, et il ne nomme plus personne (obtenu ' +
    lignesSamedi().length + ' ligne(s) : « ' + txt(lignesSamedi()[0] || null) + ' »)');

  /* ==================================================================== */
  /* §3 — AU MOINS UN ENFANT COCHÉ                                        */
  /* ==================================================================== */
  console.log('\n--- §3 : au moins un enfant coché ---');
  caseDe('Léa').click();
  await pause(200);

  assert(boutonPoser().disabled === true,
    '§3 : tout décocher rend le bouton inactif');
  assert(libelleBouton() === 'Poser',
    '§3 : et son libellé redevient « Poser », sans chiffre (obtenu « ' +
    libelleBouton() + ' »)');

  /* ==================================================================== */
  /* §5.2 — AUCUNE IMPUTATION POUR UN ENFANT DÉCOCHÉ                      */
  /*                                                                     */
  /* C'est l'assertion la plus importante du fichier. Une imputation      */
  /* orpheline consomme des congés payés qu'aucune journée n'explique, et */
  /* personne ne peut la retrouver.                                       */
  /* ==================================================================== */
  console.log('\n--- §5.2 : rien n’est écrit pour un enfant décoché ---');
  caseDe('Léa').click();
  await pause(250);
  assert(boutonPoser().disabled === false, '§3 : recocher Léa réactive le bouton');

  var avantImput = appels.imputations.length;
  var avantSamedis = scene.samedisEcrits.length;
  boutonPoser().click();
  await pause(600);

  var ecrites = appels.imputations.slice(avantImput);
  assert(ecrites.length === 1,
    '§5.2 : UNE seule imputation — celle de l’enfant coché (obtenu ' +
    ecrites.length + ')');
  assert(ecrites[0].contrat_id === 'c-lea',
    '§5.2 : et c’est bien celle de Léa (obtenu ' + ecrites[0].contrat_id + ')');
  assert(!ecrites.some(function (i) { return i.contrat_id === 'c-tom'; }),
    '§5.2 : AUCUNE imputation pour Tom — décoché veut dire absent de l’écriture');
  assert(ecrites[0].date_debut === '2026-07-06' && ecrites[0].date_fin === '2026-07-10',
    'A6 : les bornes restent celles du contrat de Léa (obtenu ' +
    ecrites[0].date_debut + ' → ' + ecrites[0].date_fin + ')');

  var derniere = appels.poser[appels.poser.length - 1];
  assert(derniere.affectations.length === 1 &&
         derniere.affectations[0].contratId === 'c-lea',
    '§5.2 : aucune journée écrite chez Tom non plus');
  assert(scene.samedisEcrits.length === avantSamedis,
    '§4 : et aucun samedi consommé — ni chez l’un, ni chez l’autre');
  assert(txt(toast).indexOf('sur 1 contrat') !== -1,
    '§5.2 : le message dit sur combien de contrats les congés sont posés ' +
    '(obtenu « ' + txt(toast) + ' »)');

  window.Kit.fermerFeuille();
  await pause(80);

  /* ==================================================================== */
  /* §3 — UN ENFANT DÉJÀ EN CONGÉ ARRIVE DÉCOCHÉ                          */
  /* ==================================================================== */
  console.log('\n--- §3 : un enfant déjà en congé sur la période ---');
  /* Tom porte déjà un congé du 13 au 17 juillet ; Léa, non. C'est le cas de
     rattrapage : une période posée chez l'un, oubliée chez l'autre. */
  scene.journees['c-tom'] = {};
  ['2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16', '2026-07-17']
    .forEach(function (d) {
      scene.journees['c-tom'][d] = { contrat_id: 'c-tom', jour: d, type: 'conge_maria',
        minutes_reelles: null, entretien_centimes: null };
    });

  await ouvrirConges();
  await ouvrirPose('2026-07-13', '2026-07-17');

  assert(!estCochee(caseDe('Tom')),
    '§3 : l’enfant qui porte déjà un congé sur la période arrive DÉCOCHÉ');
  assert(txt(caseDe('Tom')).indexOf('congé déjà posé sur cette période') !== -1,
    '§3 : et la mention le dit (obtenu « ' + txt(caseDe('Tom')) + ' »)');
  assert(estCochee(caseDe('Léa')),
    '§3 : Léa, elle, arrive cochée — c’est chez elle qu’il faut rattraper');
  /* 4 jours et non 5 : le 14 juillet est férié, et le décompte vient du
     moteur — l'écran ne le recalcule pas. */
  assert(libelleBouton() === 'Poser 4 j sur 1 contrat',
    '§3 : le libellé ne compte que Léa (obtenu « ' + libelleBouton() + ' »)');

  /* ==================================================================== */
  /* §3 — LE RECOCHER DÉCLENCHE L'AVERTISSEMENT D'ÉCRASEMENT              */
  /* ==================================================================== */
  console.log('\n--- §3 : recocher un enfant déjà en congé ---');
  caseDe('Tom').click();
  await pause(250);
  assert(estCochee(caseDe('Tom')), '§3 : Maria peut le recocher');
  assert(libelleBouton() === 'Poser 4 j sur 2 contrats',
    '§3 : et il revient dans le libellé (obtenu « ' + libelleBouton() + ' »)');

  var avantImput2 = appels.imputations.length;
  boutonPoser().click();
  await pause(600);

  assert(txt(sheet).indexOf('Des journées vont être remplacées') !== -1,
    '§3 : l’avertissement d’écrasement s’affiche AVANT l’écriture');
  assert(txt(sheet).indexOf('Un congé est déjà posé chez Tom') !== -1,
    '§3 : il nomme l’enfant concerné (obtenu « ' + txt(sheet).slice(0, 160) + ' »)');
  assert(appels.imputations.length === avantImput2,
    '§3 : et RIEN n’est écrit tant que Maria n’a pas confirmé');

  parTexte(sheet, 'button', 'Poser ces congés quand même').click();
  await pause(700);
  var ecrites2 = appels.imputations.slice(avantImput2);
  assert(ecrites2.length === 2,
    '§3 : après confirmation, les deux enfants sont posés (obtenu ' +
    ecrites2.length + ')');

  window.Kit.fermerFeuille();
  await pause(80);

  /* ==================================================================== */
  /* §2 — LE CAS QUI S'EST PRODUIT : RATTRAPER CHEZ L'AUTRE ENFANT        */
  /*                                                                     */
  /* Ici le congé existant de Tom porte AUSSI son imputation — c'est le   */
  /* cas courant. La base refuse deux périodes qui se chevauchent         */
  /* (`imputation_sans_chevauchement`, migration 004) : le décor le       */
  /* reproduit, sinon le test prouverait quelque chose que la production  */
  /* ne fait pas.                                                        */
  /* ==================================================================== */
  console.log('\n--- §2 : rattraper chez l’enfant oublié ---');
  var ecrireVrai = DB.enregistrerImputation;
  DB.enregistrerImputation = function (i) {
    var chevauche = (scene.imputations[i.contrat_id] || []).some(function (e) {
      return !(e.date_fin < i.date_debut || e.date_debut > i.date_fin);
    });
    if (chevauche) {
      return Promise.reject(new Error(
        'cette période chevauche une période de congé déjà enregistrée'));
    }
    return ecrireVrai(i);
  };

  function decorRattrapage() {
    scene.journees['c-lea'] = {};
    scene.journees['c-tom'] = {};
    scene.imputations['c-lea'] = [];
    scene.imputations['c-tom'] = [{ id: 'imp-tom-1', contrat_id: 'c-tom',
      date_debut: '2026-07-13', date_fin: '2026-07-17', jours_ouvrables: 4,
      jours_sur_cp: 0, jours_sur_sup: 0, jours_sans_solde: 4 }];
    ['2026-07-13', '2026-07-15', '2026-07-16', '2026-07-17'].forEach(function (d) {
      scene.journees['c-tom'][d] = { contrat_id: 'c-tom', jour: d, type: 'conge_maria',
        minutes_reelles: null, entretien_centimes: null };
    });
  }

  decorRattrapage();
  await ouvrirConges();
  await ouvrirPose('2026-07-13', '2026-07-17');

  assert(!estCochee(caseDe('Tom')) && estCochee(caseDe('Léa')),
    '§2 : Tom, déjà posé, arrive décoché ; Léa, oubliée, arrive cochée');

  var avantR = appels.imputations.length;
  boutonPoser().click();
  await pause(700);
  var ecritesR = appels.imputations.slice(avantR);
  assert(ecritesR.length === 1 && ecritesR[0].contrat_id === 'c-lea',
    '§2 : LE RATTRAPAGE ABOUTIT — la période passe chez Léa seule, sans buter ' +
    'sur le congé de Tom (obtenu ' + ecritesR.length + ' imputation(s))');
  window.Kit.fermerFeuille();
  await pause(80);

  /* Et si Maria recoche Tom : elle est prévenue AVANT, et le refus de la base
     ne laisse rien derrière lui — ni chez Tom, ni chez Léa. */
  console.log('\n--- §2 : et si elle recoche l’enfant déjà posé ---');
  decorRattrapage();
  await ouvrirConges();
  await ouvrirPose('2026-07-13', '2026-07-17');
  caseDe('Tom').click();
  await pause(250);

  var avantR2 = appels.imputations.length;
  var avantSup = appels.supprImput.length;
  boutonPoser().click();
  await pause(600);
  assert(txt(sheet).indexOf('RIEN ne sera posé') !== -1,
    '§2 : l’avertissement dit ce qui va VRAIMENT arriver, pas un remplacement ' +
    'que la base n’accepte pas');
  assert(txt(sheet).indexOf('Retirer des congés') !== -1,
    '§2 : et il dit le geste qui débloque');

  parTexte(sheet, 'button', 'Poser ces congés quand même').click();
  await pause(800);
  assert(txt(toast).indexOf('Rien n’a été enregistré') !== -1,
    '§2 : la base refuse, et le message le dit (obtenu « ' + txt(toast) + ' »)');
  var resteLea = (scene.imputations['c-lea'] || []).filter(function (i) {
    return i.date_debut === '2026-07-13';
  });
  assert(resteLea.length === 0,
    '§2 : et la compensation a tout retiré — aucune imputation orpheline chez Léa ' +
    '(obtenu ' + resteLea.length + ')');
  assert(appels.supprImput.length > avantSup || appels.imputations.length === avantR2,
    '§2 : le rollback a bien eu lieu');

  DB.enregistrerImputation = ecrireVrai;
  scene.imputations['c-lea'] = [];
  scene.imputations['c-tom'] = [];
  scene.journees['c-lea'] = {};
  scene.journees['c-tom'] = {};
  window.Kit.fermerFeuille();
  await pause(80);

  /* ==================================================================== */
  /* §4 — ÉCHEC FERMÉ : UN CONTEXTE ILLISIBLE RESTE DÉCOCHÉ               */
  /* ==================================================================== */
  console.log('\n--- §4 : échec fermé ---');
  /* La lecture échoue sur OCTOBRE seulement : l'onglet, lui, affiche juillet
     et doit continuer de se rendre. C'est bien le contexte de la PÉRIODE qui
     manque, pas l'application qui tombe. */
  var lireVrai = DB.getJourneesMois;
  DB.getJourneesMois = function (id, annee, mois) {
    if (annee === 2026 && mois === 10) return Promise.reject(new Error('Failed to fetch'));
    return lireVrai(id, annee, mois);
  };
  await ouvrirConges();
  await ouvrirPose('2026-10-19', '2026-10-23');

  assert(casesEnfants().length === 2,
    '§4 : les cases sont là — l’écran ne se dérobe pas');
  assert(!estCochee(caseDe('Léa')) && !estCochee(caseDe('Tom')),
    '§4 : un enfant dont le contexte est illisible reste DÉCOCHÉ — jamais ' +
    'coché « au cas où »');
  assert(txt(caseDe('Léa')).indexOf('n’ont pas pu être lues') !== -1,
    '§4 : et la raison est dite (obtenu « ' + txt(caseDe('Léa')) + ' »)');
  assert(boutonPoser().disabled === true,
    '§4 : rien ne peut partir tant qu’on ne sait pas ce qu’il y a');

  var avantImput3 = appels.imputations.length;
  caseDe('Léa').click();
  await pause(200);
  assert(!estCochee(caseDe('Léa')),
    '§4 : la case refuse — ce n’est pas un défaut que Maria peut lever');
  assert(appels.imputations.length === avantImput3, '§4 : et rien n’a été écrit');

  DB.getJourneesMois = lireVrai;
  window.Kit.fermerFeuille();
  await pause(80);

  /* ==================================================================== */
  /* §4 — AUCUNE RÈGLE DE CALCUL NE BOUGE                                 */
  /* ==================================================================== */
  console.log('\n--- §4 : le moteur n’a pas été touché ---');
  var srcMoteur = fs.readFileSync(path.join(racine, 'js', 'engine.js'), 'utf8');
  assert(srcMoteur.indexOf('parcours') === -1 && srcMoteur.indexOf('estRetenu') === -1,
    '§4 : le choix des enfants est un geste d’écran — le moteur ignore ' +
    'jusqu’à l’existence du parcours de pose');
  var srcConges = fs.readFileSync(path.join(racine, 'js', 'ui-conges.js'), 'utf8');
  assert(srcConges.indexOf('decompterJoursOuvrables') !== -1,
    '§4 : le décompte vient toujours du moteur, jamais recalculé dans l’écran');

  /* ==================================================================== */
  console.log('');
  if (echecs) { console.error(echecs + ' échec(s).'); process.exit(1); }
  console.log('Tout est conforme.');
})().catch(function (e) {
  console.error('Erreur pendant le parcours :', e && e.stack || e);
  process.exit(1);
});
