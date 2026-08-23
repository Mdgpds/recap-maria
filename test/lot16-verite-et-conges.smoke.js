/* ============================================================================
   Test de fumée — LOT 16 : l'écran qui ne s'ouvre plus, et là où l'application
   dit faux.

   POURQUOI CE FICHIER EXISTE.

   Une ligne `imputation_conge` a été écrite en production pour un contrat avec
   6 jours de récupération alors que ses réserves n'en couvraient que 5. Le
   moteur a refusé, `App.serie` a rejeté, et L'ÉCRAN ENTIER est tombé — y
   compris celui qui aurait permis de corriger la répartition. Tous les mois
   suivants de ce contrat sont devenus inatteignables.

   Ce qui se vérifie ici tient en cinq garanties :

     - LE MOTEUR RESTE STRICT. Il continue de refuser. On ne l'assouplit pas :
       le repli vit dans la couche qui l'appelle, et nulle part ailleurs.
     - LA CHAÎNE NE TOMBE PLUS. Elle écarte la seule ligne fautive, rejoue le
       mois dans l'ordre par défaut du contrat, et PORTE ce qu'elle a écarté —
       avec les nombres qui permettent de l'expliquer à Maria.
     - SEULE LA LIGNE FAUTIVE EST ÉCARTÉE. Une période valide du même mois
       garde son choix.
     - AUCUNE ADRESSE E-MAIL NE SIGNE UN DOCUMENT.
     - AUCUN ÉCRAN N'AFFIRME QU'UNE CLÔTURE EST DÉFINITIVE, et aucun
       « Annuler » ne suit une clôture.

   Lancement : node test/lot16-verite-et-conges.smoke.js
   ========================================================================= */
'use strict';
/* LOT 17 §17.2 — les conditions du contrat sont DATÉES : le décor expose
   `getAvenants`, pas `getSalaires`. La traduction est faite par
   `test/decor-avenants.js`. */
var Decor = require('./decor-avenants.js');


var fs = require('fs');
var path = require('path');
var JSDOM = require('jsdom').JSDOM;

var racine = path.join(__dirname, '..');
var dom = new JSDOM('<!doctype html><html><body></body></html>',
  { url: 'https://exemple.test/' });
global.window = dom.window;
global.document = dom.window.document;

var echecs = 0;
function assert(cond, msg) {
  if (!cond) { echecs++; console.error('FAIL ' + msg); } else { console.log('ok   ' + msg); }
}
function egal(obtenu, attendu, msg) {
  assert(obtenu === attendu, msg + ' (attendu ' + JSON.stringify(attendu) +
    ', obtenu ' + JSON.stringify(obtenu) + ')');
}
function lire(f) { return fs.readFileSync(path.join(racine, f), 'utf8'); }
function sansInsecable(t) { return String(t).replace(/ /g, ' '); }
/* Les commentaires EXPLIQUENT les défauts corrigés, en les citant. Une
   recherche naïve dans le source confondrait l'explication avec le défaut :
   on les retire avant tout contrôle de code. */
function sansCommentaires(src) {
  return String(src).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}
/* CORRECTION RELECTURE LOT 16 (C6, faiblesse 1) — EXTRAIRE UNE FONCTION
   ENTIÈRE, pas ses vingt-deux premières lignes.

   `corpsCloturer` découpait de `function cloturer(` au premier « \n  }\n »
   rencontré : la fonction en fait trente-deux, la tranche examinée s'arrêtait
   à vingt-deux. Un « Annuler » ajouté dans les dix dernières lignes passait le
   contrôle — alors que l'assertion s'intitule « aucun Annuler n'est proposé
   après une clôture ».

   On compte les accolades, commentaires et chaînes retirés au préalable. */
function corpsDeFonction(src, entete) {
  var nu = sansCommentaires(src);
  var debut = nu.indexOf(entete);
  if (debut === -1) return '';
  var i = nu.indexOf('{', debut);
  if (i === -1) return '';
  var profondeur = 0;
  for (var j = i; j < nu.length; j++) {
    if (nu[j] === '{') profondeur++;
    else if (nu[j] === '}') {
      profondeur--;
      if (profondeur === 0) return nu.slice(debut, j + 1);
    }
  }
  return nu.slice(debut);
}

var Feries = require('../js/feries.js');
var Format = require('../js/format.js');
var Engine = require('../js/engine.js');
global.Feries = Feries; window.Feries = Feries;
global.Format = Format; window.Format = Format;
global.Engine = Engine; window.Engine = Engine;

/* --- Décor. Valeurs FICTIVES et rondes : le dépôt est PUBLIC. ----------- */
var PLANNING = [1, 2, 3, 4, 5];

function contrat() {
  return {
    id: 'c-test', prenom_enfant: 'Test', famille_id: 'f-test',
    date_debut: '2026-01-01', date_fin: null,
    minutes_contractuelles: 540, minutes_sup_jour: 30, minutes_par_jour_conge: 540,
    entretien_centimes_jour: 500, jours_planning: PLANNING,
    heure_arrivee: '08:30:00', heure_depart: '17:30:00', statut: 'actif',
    sup_dues_si_enfant_absent: true, ordre_imputation: 'cp_puis_sup', archive: false
  };
}

function journeesConge(dates) {
  var out = {};
  dates.forEach(function (d) {
    out[d] = { id: 'j-' + d, contrat_id: 'c-test', jour: d, type: 'conge_maria',
      minutes_reelles: null, entretien_centimes: null, commentaire: null,
      minutes_sup_exceptionnelles: 0, minutes_sup_renoncees: 0, sup_dues_override: null };
  });
  return out;
}

/* Base simulée minimale : la chaîne ne lit que ces cinq fonctions. */
function baseSimulee(opts) {
  return {
    getAvenants: function () {
      return Promise.resolve(Decor.avenantsDe(contrat(),
        [{ id: 's1', contrat_id: 'c-test', date_effet: '2026-01-01',
           brut_mensuel_centimes: 200000, net_mensuel_centimes: 150000 }]));
    },
    getCompteurInitial: function () {
      return Promise.resolve(Decor.compteurEnMinutes({
        contrat_id: 'c-test', date_reference: '2026-06-01',
        minutes_sup: opts.minutesSup || 0,
        dixiemes_cp_acquis: opts.cpAcquis || 0,
        dixiemes_cp_pris: 0
      }));
    },
    /* LOT 20, correction C3 — la chaîne appelle `listPeriodesFamiliarisation`
       sans repli : un décor qui ne l'expose pas fait échouer le rejeu, et c'est
       voulu. Ce décor n'a aucune période de familiarisation. */
    listPeriodesFamiliarisation: function () { return Promise.resolve([]); },
    listPeriodesFamiliarisationContrat: function () { return Promise.resolve([]); },
    getJourneesMois: function () { return Promise.resolve(opts.journees || {}); },
    listRecapsPeriode: function () { return Promise.resolve([]); },
    listImputations: function () { return Promise.resolve(opts.imputations || []); }
  };
}

function chaine(opts, cible) {
  global.DB = baseSimulee(opts);
  delete require.cache[require.resolve('../js/chaine-mois.js')];
  var Chaine = require('../js/chaine-mois.js');
  return Chaine.serie(contrat(), cible || { annee: 2026, mois: 6 },
    { depuis: { annee: 2026, mois: 6 } });
}
function moisDe(s, annee, mois) {
  var cle = annee + '-' + String(mois).padStart(2, '0');
  return (s.mois || []).filter(function (e) { return e.cle === cle; })[0] || null;
}

(async function () {

  /* ==================================================================== */
  /* §16.1 — LE CAS SURVENU EN PRODUCTION, REJOUÉ                                      */
  /* ==================================================================== */
  console.log('\n--- §16.1 : une répartition qui dépasse les réserves ---');

  /* Trois semaines de congé, et une ligne qui impute 6 jours sur une
     récupération qui n'en couvre que 5. C'est la situation exacte survenue
     en production, à un décor fictif près. */
  var jours = ['2026-06-08', '2026-06-09', '2026-06-10', '2026-06-11', '2026-06-12',
               '2026-06-15', '2026-06-16', '2026-06-17', '2026-06-18', '2026-06-19'];
  var decompte = Engine.decompterJoursOuvrables('2026-06-08', '2026-06-19', PLANNING);

  var CINQ_JOURS_DE_RECUP = 5 * 540;   // minutes_par_jour_conge du décor
  var opts = {
    journees: journeesConge(jours),
    cpAcquis: 0,
    minutesSup: CINQ_JOURS_DE_RECUP,
    imputations: [{ id: 'i-fautive', contrat_id: 'c-test',
      date_debut: '2026-06-08', date_fin: '2026-06-19',
      jours_ouvrables: decompte,
      jours_sur_cp: 0, jours_sur_sup: 6, jours_sans_solde: decompte - 6 }]
  };

  /* 1. LE MOTEUR REFUSE TOUJOURS. Le repli ne l'assouplit pas : s'il cédait,
        une ventilation impossible serait appliquée en silence, et le document
        remis à la famille annoncerait des congés payés qui n'existent pas. */
  var refus = null;
  try {
    Engine.calculerMois({
      contrat: contrat(),
      /* §17.3 — le moteur reçoit les CONDITIONS du mois, assemblées à partir
         des mêmes valeurs qu'avant. §17.6 — les congés payés sont en minutes. */
      conditions: Decor.avenantDe(contrat(),
        { brut_mensuel_centimes: 200000, net_mensuel_centimes: 150000 }),
      journees: jours.map(function (d) { return opts.journees[d]; }),
      compteurEntree: { minutesSup: CINQ_JOURS_DE_RECUP, minutesCpAcquis: 0, minutesCpPris: 0 },
      annee: 2026, mois: 6, imputations: opts.imputations
    });
  } catch (e) { refus = e; }
  egal(refus && refus.code, 'IMPUTATION_DEPASSE_RESERVES',
    'A8 : le moteur refuse toujours — il n’a pas été modifié, son diff est vide');

  /* 2. LA CHAÎNE, ELLE, S'AFFICHE. */
  var erreur = null;
  var s = null;
  try { s = await chaine(opts); } catch (e) { erreur = e; }
  assert(!erreur, 'A1 : la chaîne ne rejette plus — l’écran de l’enfant s’affiche ' +
    'entièrement, y compris celui qui permet de corriger');

  var m = s && moisDe(s, 2026, 6);
  assert(!!(m && m.resultat), 'A1 : et le mois porte un résultat calculable');
  egal(m && m.resultat.joursCongesDecomptes, decompte,
    'A2 : les congés sont décomptés, avec le chiffre du moteur');
  egal(m && m.resultat.imputation.joursSurSup, 5,
    'A2 : dans l’ordre par défaut du contrat, la récupération n’est consommée ' +
    'qu’à hauteur de ce qu’elle couvre — jamais 6');

  /* 3. ET ELLE LE DIT, avec les nombres qui permettent de l'expliquer. */
  var ecartees = (m && m.imputationsEcartees) || [];
  egal(ecartees.length, 1, 'A3 : le maillon porte la répartition écartée');
  egal(ecartees[0] && ecartees[0].date_debut, '2026-06-08',
    'A3 : l’encart peut nommer la période');
  egal(ecartees[0] && ecartees[0].choisi.joursSurSup, 6,
    'A3 : le nombre CHOISI par Maria');
  egal(ecartees[0] && ecartees[0].disponible.joursSup, 5,
    'A3 : et le nombre DISPONIBLE, produit par le moteur — c’est la phrase ' +
    '« vous aviez choisi 6 jours de récupération, vous n’en avez que 5 »');
  egal(ecartees[0] && ecartees[0].id, 'i-fautive',
    'A3 : avec l’identifiant, pour que « Corriger la répartition » ouvre CETTE période');

  assert((m.resultat.imputationsAppliquees || []).some(function (i) {
    return i.source === 'defaut_choix_ecarte';
  }), 'A2 : la période reprend la forme que le moteur produit déjà pour un ' +
      'choix écarté — les écrans n’ont qu’un seul cas à connaître');

  /* 4. SANS IMPUTATION FAUTIVE, RIEN NE CHANGE. Le repli ne doit exister que
        sur le chemin d'échec : un mois ordinaire ne passe jamais par lui. */
  var sain = await chaine({
    journees: journeesConge(jours), cpAcquis: 300, minutesSup: 0,
    imputations: [{ id: 'i-ok', contrat_id: 'c-test',
      date_debut: '2026-06-08', date_fin: '2026-06-19',
      jours_ouvrables: decompte,
      jours_sur_cp: decompte, jours_sur_sup: 0, jours_sans_solde: 0 }]
  });
  var mSain = moisDe(sain, 2026, 6);
  egal((mSain.imputationsEcartees || []).length, 0,
    'A6 : un mois dont la ventilation tient n’écarte rien');
  egal(mSain.resultat.imputation.joursSurCp, decompte,
    'A6 : et le choix de Maria est appliqué tel quel');

  /* 5. UN MOIS SANS AUCUN CONGÉ garde exactement le même résultat qu'avant :
        le repli ne doit se voir nulle part ailleurs. */
  var vide = await chaine({ journees: {}, cpAcquis: 250, minutesSup: 0, imputations: [] });
  var mVide = moisDe(vide, 2026, 6);
  egal(mVide.resultat.joursCongesDecomptes, 0, 'Non-régression : mois sans congé');
  egal((mVide.imputationsEcartees || []).length, 0,
    'Non-régression : et rien d’écarté');

  /* ==================================================================== */
  /* §16.8 — LA PART D'UN MOIS DANS UNE PÉRIODE À CHEVAL                  */
  /* ==================================================================== */
  console.log('\n--- §16.8 : « dont 2 en août » ---');

  delete require.cache[require.resolve('../js/chaine-mois.js')];
  global.DB = baseSimulee({});
  var Chaine = require('../js/chaine-mois.js');

  /* Une période du lundi 27 juillet au vendredi 7 août. Le décompte RG-06
     couvre le samedi 1er août ET le samedi 8 août (prolongement jusqu'à la
     veille de la reprise). La question est de savoir combien tombent en
     juillet et combien en août — et de ne JAMAIS redécouper la période. */
  var imp = { date_debut: '2026-07-27', date_fin: '2026-08-07' };
  var total = Engine.decompterJoursOuvrables(imp.date_debut, imp.date_fin, PLANNING);
  var juillet = Chaine.partDuMois(Engine, imp, PLANNING, 2026, 7);
  var aout = Chaine.partDuMois(Engine, imp, PLANNING, 2026, 8);

  egal(juillet + aout, total,
    'La somme des parts vaut EXACTEMENT le décompte de la période — aucune ' +
    'journée ne se perd, aucune ne se compte deux fois');
  egal(juillet, 5, 'Juillet : les cinq jours du 27 au 31');
  egal(aout, 7,
    'Août : le samedi 1er, les cinq jours du 3 au 7, et le samedi 8 du ' +
    'prolongement RG-06 — c’est le samedi que la liste jour par jour ne ' +
    'pouvait pas montrer');

  var isolee = { date_debut: '2026-06-08', date_fin: '2026-06-12' };
  egal(Chaine.partDuMois(Engine, isolee, PLANNING, 2026, 6),
    Engine.decompterJoursOuvrables('2026-06-08', '2026-06-12', PLANNING),
    'Une période d’un seul mois vaut son décompte entier');
  egal(Chaine.partDuMois(Engine, isolee, PLANNING, 2026, 7), 0,
    'Et rien ne déborde sur un mois qu’elle ne touche pas');

  /* Le 15 août 2026 tombe un samedi et il est FÉRIÉ : il ne se décompte pas.
     C'est l'exemple exact de la spécification. */
  assert(Engine.estJourFerie('2026-08-15'),
    'Le 15 août 2026 est bien un férié — c’est le samedi qui ne compte pas');

  /* ==================================================================== */
  /* §16.6 — L'ÉLISION, et §16.8 le libellé d'une période                 */
  /* ==================================================================== */
  console.log('\n--- §16.6 : « Récap de août » ---');

  var Kit = require('../js/ui-kit.js') || window.Kit;
  Kit = window.Kit || Kit;

  egal(Kit.deMois(8), 'd’août', 'Août s’élide');
  egal(Kit.deMois(4), 'd’avril', 'Avril aussi');
  egal(Kit.deMois(10), 'd’octobre', 'Et octobre');
  egal(Kit.deMois(3), 'de mars', 'Mars ne s’élide pas');
  egal(Kit.deMois(12), 'de décembre', 'Décembre non plus');
  egal(Kit.deMoisAnnee(2026, 8), 'd’août 2026', 'L’année suit le mois élidé');

  var sourceDoc = lire('js/ui-document.js');
  assert(sourceDoc.indexOf("'Récap de ' +") === -1,
    '§16.6 : plus aucune concaténation « Récap de » + mois dans le document');

  egal(sansInsecable(Kit.libellePeriode('2026-08-03', '2026-08-22')), 'Du 3 au 22 août',
    '§16.8 : une période dans le même mois ne répète pas le mois');
  egal(sansInsecable(Kit.libellePeriode('2026-07-29', '2026-08-04')),
    'Du 29 juillet au 4 août', '§16.8 : une période à cheval nomme les deux mois');
  egal(sansInsecable(Kit.libellePeriode('2026-08-14', '2026-08-14')), 'Le 14 août',
    '§16.8 : un jour isolé se dit au singulier');

  /* ==================================================================== */
  /* §16.2 — AUCUNE ADRESSE E-MAIL NE SIGNE UN DOCUMENT                   */
  /* ==================================================================== */
  console.log('\n--- §16.2 : la signature du document ---');

  assert(sourceDoc.indexOf('App.email') === -1,
    'A1 : `ui-document.js` n’appelle plus l’adresse de connexion, nulle part');
  assert(sourceDoc.indexOf('TODO RÈGLE ABSENTE') === -1,
    'Le TODO qui renvoyait au lot 14 est levé, pas déplacé');
  assert(sourceDoc.indexOf('votre assistante maternelle') !== -1,
    'A1 : sans nom saisi, le document dit « votre assistante maternelle »');
  /* C6, faiblesse 3 — même remarque : on vérifie la RÈGLE, pas la ligne.
     La profession et le numéro d'agrément ne doivent plus figurer sur la
     signature ; le rendu réel est contrôlé par `lot16-ecrans.smoke.js`. */
  var corpsAuteur = corpsDeFonction(sourceDoc, 'function enTeteAuteur(');
  assert(corpsAuteur.indexOf('Établi par') !== -1,
    '§16.2 : la signature dit « Établi par »');
  assert(corpsAuteur.indexOf('assistante maternelle,') === -1 &&
         corpsAuteur.indexOf(', assistante maternelle') === -1,
    '§16.2 : sans mention de la profession accolée au nom');
  assert(corpsAuteur.indexOf('agrément') === -1,
    '§16.2 : et sans numéro d’agrément');
  assert(sourceDoc.indexOf('snap.nomEmettrice') !== -1,
    'A2 : le nom entre dans l’instantané — un mois clôturé avant la saisie ne ' +
    'se met jamais à jour tout seul');
  assert(/if \(vue\.entree && vue\.entree\.fige\) return null;/.test(sourceDoc),
    'A2 : et un mois figé ne va JAMAIS relire le nom du compte');

  var migration = lire('supabase/migrations/013_identite_emettrice.sql');
  /* Les commentaires sont retirés avant le contrôle : le fichier PARLE de
     `using (true)` pour dire qu'on n'en veut pas, et une recherche naïve
     confondrait la consigne avec sa violation. */
  var sqlNu = migration.split('\n').filter(function (l) {
    return l.trim().indexOf('--') !== 0;
  }).join('\n');
  assert(sqlNu.indexOf('using (true)') === -1,
    'Sécurité : jamais de `using (true)` dans la migration 013');
  assert(sqlNu.indexOf('revoke all on public.emettrice') !== -1,
    'Sécurité : `revoke all` avant tout grant');
  assert(sqlNu.indexOf('enable row level security') !== -1,
    'Sécurité : RLS activée');
  ['select', 'insert', 'update', 'delete'].forEach(function (op) {
    assert(sqlNu.indexOf('emettrice_' + op + ' on public.emettrice') !== -1,
      'Sécurité : une policy explicite pour ' + op);
  });
  assert(sqlNu.indexOf('default auth.uid()') !== -1,
    'Sécurité : `owner` par défaut `auth.uid()`');

  /* ==================================================================== */
  /* §16.3 — CE QUE DIT VRAIMENT LA CLÔTURE                               */
  /* ==================================================================== */
  console.log('\n--- §16.3 : la clôture est réversible, et l’écran le dit ---');

  assert(sourceDoc.indexOf('plus aucune modification n’est possible') === -1,
    'A1 : aucun écran n’affirme plus qu’une clôture est définitive');
  assert(sourceDoc.indexOf('La clôture verrouille les chiffres du mois') !== -1,
    '§16.3 : la formulation retenue est en place');
  assert(sourceDoc.indexOf('Vous pourrez rouvrir') !== -1,
    '§16.3 : et elle dit que la réouverture existe — c’est le seul geste que ' +
    'Maria redoute');

  /* A2 — aucun « Annuler » ne suit une clôture. La fonction `cloturer` ne
     passe aucune action d'annulation au toast, et c'est ce qu'on vérifie :
     un bouton qui défait aussitôt un geste réfléchi en affaiblit le sens. */
  var corpsCloturer = corpsDeFonction(sourceDoc, 'function cloturer(');
  assert(corpsCloturer.length > 400,
    'C6 : la fonction `cloturer` est extraite ENTIÈREMENT (obtenu ' +
    corpsCloturer.length + ' caractères) — l’ancien découpage n’en voyait que ' +
    'les deux tiers');
  assert(corpsCloturer.indexOf('Annuler') === -1,
    'A2 : aucun « Annuler » n’est proposé après une clôture');

  var sourceAccueil = lire('js/ui-accueil.js');
  var corpsEtape = corpsDeFonction(sourceAccueil, 'function cloturerEtape(');
  assert(corpsEtape.length > 400,
    'C6 : la fonction `cloturerEtape` est extraite entièrement (obtenu ' +
    corpsEtape.length + ' caractères)');
  assert(corpsEtape.indexOf('libelle: \'Annuler\'') === -1,
    'A2 : ni sur le second chemin de clôture, celui de la fin de mois guidée');

  /* ==================================================================== */
  /* §16.1 c) — LA CLÔTURE EST BLOQUÉE                                    */
  /* ==================================================================== */
  console.log('\n--- §16.1 c) : la clôture bloquée ---');

  assert(/imputationsEcartees/.test(sourceDoc),
    'Le document connaît les répartitions écartées');
  assert(sourceDoc.indexOf('Corrigez d’abord la répartition du congé') !== -1,
    'A4 : et refuse la clôture avec une phrase qui dit quoi corriger');
  assert(sourceAccueil.indexOf('Corrigez d’abord la répartition du congé') !== -1,
    'A4 : la fin de mois guidée aussi — c’est le second chemin de clôture');
  /* C6, faiblesse 3 — cette assertion figeait une ligne de code au caractère
     près : elle cassait sur un simple renommage de variable, et ne vérifiait
     RIEN de ce qu'elle annonçait. Le comportement lui-même est désormais
     couvert par `lot16-ecrans.smoke.js`, qui rend l'écran et constate que le
     bouton n'est pas offert. Ici on ne garde qu'un contrôle de structure :
     l'étape guidée consulte bien les répartitions écartées avant de proposer
     la clôture. */
  var corpsBoutons = corpsDeFonction(sourceAccueil, 'function boutonsEtape(');
  assert(corpsBoutons.indexOf('imputationsEcartees') !== -1,
    'A4 : l’étape guidée consulte les répartitions écartées');
  assert(corpsBoutons.indexOf('imputationsEcartees') <
         corpsBoutons.indexOf('Clôturer et continuer'),
    'A4 : et elle le fait AVANT de proposer « Clôturer et continuer »');

  /* ==================================================================== */
  /* §16.1 d) — LES BORNES DE LA VENTILATION                              */
  /* ==================================================================== */
  console.log('\n--- §16.1 d) : les bornes viennent du compteur d’ENTRÉE ---');

  var sourceConges = lire('js/ui-conges.js');
  assert(/function cpDe\(fiche\) \{\s*return Kit\.cpDisponible\(fiche\.entree && fiche\.entree\.compteurEntree\);/
    .test(sourceConges),
    'A7 : les congés payés disponibles se lisent sur le compteur d’ENTRÉE du ' +
    'mois, celui-là même que le moteur contrôle');
  assert(/function supDe\(fiche\) \{\s*return Kit\.supDisponible\(fiche\.entree && fiche\.entree\.compteurEntree\);/
    .test(sourceConges),
    'A7 : la récupération aussi');
  /* Commentaires retirés : le fichier EXPLIQUE le défaut corrigé en citant
     `resultat.compteurSortie`, et une recherche naïve confondrait
     l'explication avec le défaut. */
  var congesNu = sansCommentaires(sourceConges);
  assert(congesNu.indexOf('resultat.compteurSortie') === -1,
    'A7 : plus aucune borne ne se calcule sur le compteur de SORTIE — c’est ' +
    'l’écart qui a laissé écrire 6 jours là où le moteur n’en accepte que 5');
  assert(sourceConges.indexOf('Vos réserves ne couvrent pas toute la période') !== -1,
    '§16.1 d) : le basculement en sans solde est annoncé AVANT validation');
  assert(/Engine\.montantCentimes\(brut, minutes\)/.test(sourceConges),
    '§16.1 d) : et son montant vient du moteur, jamais écrit en dur');

  /* ==================================================================== */
  /* §16.4 — PLUS AUCUN « Chargement… » RÉSIDUEL                          */
  /* ==================================================================== */
  console.log('\n--- §16.4 : la ligne de menu figée ---');

  var sourceMenu = lire('js/ui-menu.js');
  /* C6, faiblesse 2 — les contrôles du §16.7 portaient sur le source
     COMMENTAIRES COMPRIS : `indexOf('Conditions du contrat')` aurait été
     satisfait par un simple commentaire portant ces mots. */
  var menuNu = sansCommentaires(sourceMenu);
  var nbChargement = (sourceMenu.match(/'Chargement…'/g) || []).length;
  egal(nbChargement, 1,
    '§16.4 : un seul sous-titre d’attente subsiste — celui des Familles, que ' +
    'quelqu’un sait lever');
  assert(menuNu.indexOf("querySelectorAll('.menu')[0]") === -1,
    '§16.4 : la ligne n’est plus retrouvée par sa POSITION dans la liste');
  assert(menuNu.indexOf('function libelleReglageRappel') !== -1,
    '§16.4 : la ligne des rappels affiche son vrai réglage');
  assert(/poserSousTitre\(ligneRappels, null\)/.test(sourceMenu),
    '§16.4 : et n’affiche RIEN si la lecture échoue, plutôt qu’un mot ' +
    'd’attente qu’elle ne saura pas lever');

  /* ==================================================================== */
  /* §16.5 — L'HORAIRE ENREGISTRÉ NE CONTREDIT PLUS LA DURÉE              */
  /* ==================================================================== */
  console.log('\n--- §16.5 : la fin d’accueil ---');

  assert(sqlNu.indexOf("alter column heure_depart set default '17:30'") !== -1,
    '§16.5 : le défaut du schéma est ramené à 17:30');
  assert(sqlNu.indexOf('update public.contrat') === -1 &&
         sqlNu.indexOf('UPDATE public.contrat') === -1,
    '§16.5 : et AUCUN contrat existant n’est modifié en silence par la migration');
  assert(/heure_depart: '17:30'/.test(sourceMenu),
    '§16.5 : la création envoie 17:30, au lieu de laisser la base décider');
  assert(menuNu.indexOf('function phraseReglages') !== -1,
    '§16.5 : et la phrase affichée est PRODUITE à partir des valeurs envoyées');
  assert(menuNu.indexOf("'Lundi à vendredi, 8h30 → 17h30") === -1,
    '§16.5 : plus aucun horaire écrit en dur dans l’écran de création');

  var sourceContrat = lire('js/ui-contrat.js');
  assert(sourceContrat.indexOf('Fin d’accueil') !== -1,
    '§16.5 : le champ s’appelle « fin d’accueil » à l’écran');
  assert(sourceContrat.indexOf('function finReelle') !== -1,
    '§16.5 : et l’heure à laquelle l’enfant repart est produite à partir des ' +
    'valeurs appliquées, jamais écrite en dur');

  /* ==================================================================== */
  /* REMARQUE 4 DE LA RELECTURE — L'ÉCRAN ET LE SCHÉMA NE PEUVENT PAS      */
  /* DIVERGER EN SILENCE                                                   */
  /* ==================================================================== */
  console.log('\n--- remarque 4 : les défauts de création tenus au schéma ---');

  /* Le §16.5 impose que l'écran de création ENVOIE les réglages qu'il annonce,
     au lieu de laisser la base décider — c'est ce qui le faisait mentir. Mais
     déplacer neuf valeurs métier dans l'interface crée un risque neuf : rien
     n'empêche plus l'écran et le schéma de diverger, et personne ne le verrait.

     Ce contrôle lit les DEUX sources et les compare. Il tombera le jour où
     l'une bouge sans l'autre. */
  var blocReglages = /var REGLAGES_PAR_DEFAUT = (\{[\s\S]*?\n  \});/.exec(sourceMenu);
  assert(!!blocReglages, 'les réglages par défaut de la création sont lisibles');
  /* eslint-disable-next-line no-eval */
  var reglages = blocReglages ? eval('(' + blocReglages[1] + ')') : {};

  var schema = lire('supabase/migrations/001_schema.sql');
  function defautSchema(colonne) {
    var re = new RegExp(colonne + "\\s+[a-z\\[\\]]+(?:\\(\\d+\\))?\\s+not null default ([^,\\n]+)", 'i');
    var m = re.exec(schema);
    return m ? m[1].trim().replace(/^'|'(::[a-z\[\]]+)?$/g, '') : null;
  }

  /* `heure_depart` est le seul défaut que le lot 16 change : la migration 013
     le ramène de 18:00 à 17:30. C'est donc elle qui fait foi (§16.5). */
  var defautDepart = /alter column heure_depart set default '([^']+)'/.exec(sqlNu);
  egal(defautDepart && defautDepart[1], '17:30',
    '§16.5 : la migration 013 pose bien 17:30 comme défaut de fin d’accueil');
  egal(reglages.heure_depart, defautDepart && defautDepart[1],
    'remarque 4 : l’écran de création envoie EXACTEMENT le défaut du schéma ' +
    'pour la fin d’accueil');

  [['heure_arrivee', 'heure_arrivee'],
   ['minutes_contractuelles', 'minutes_contractuelles'],
   ['minutes_sup_jour', 'minutes_sup_jour'],
   ['minutes_par_jour_conge', 'minutes_par_jour_conge'],
   ['entretien_centimes_jour', 'entretien_centimes_jour'],
   ['ordre_imputation', 'ordre_imputation']].forEach(function (paire) {
    var attendu = defautSchema(paire[0]);
    if (attendu === null) { assert(false, 'défaut de ' + paire[0] + ' introuvable au schéma'); return; }
    egal(String(reglages[paire[1]]), String(attendu),
      'remarque 4 : ' + paire[0] + ' — écran et schéma disent la même chose');
  });

  egal(JSON.stringify(reglages.jours_planning), JSON.stringify([1, 2, 3, 4, 5]),
    'remarque 4 : les jours de garde par défaut sont ceux du schéma');
  egal(reglages.sup_dues_si_enfant_absent, true,
    'remarque 4 : et RG-09 par défaut aussi');

  /* ==================================================================== */
  /* §16.7 — L'EXPORT ANNONCE « TOUT »                                    */
  /* ==================================================================== */
  console.log('\n--- §16.7 : l’export ---');

  assert(menuNu.indexOf('function estJourneeParlante') !== -1,
    '§16.7 : une journée de PRÉSENCE portant un ajustement entre dans le document');
  assert(!/return j\.type && j\.type !== 'presence';/.test(sourceMenu),
    '§16.7 : le filtre qui les excluait a disparu');
  assert(menuNu.indexOf('Conditions du contrat') !== -1,
    '§16.7 : les conditions du contrat y figurent — sans elles, aucun chiffre ' +
    'du document n’est vérifiable');
  assert(menuNu.indexOf('Point de départ des compteurs') !== -1,
    '§16.7 : le point de départ aussi — c’est de lui que dérivent tous les soldes');
  assert(menuNu.indexOf('CONTRATS TYPES') !== -1,
    '§16.7 : et les contrats types, chargés depuis toujours et jamais écrits');

  /* ==================================================================== */
  console.log('');
  if (echecs) { console.error(echecs + ' échec(s).'); process.exit(1); }
  console.log('Tout est conforme.');
})().catch(function (e) {
  console.error('ERREUR', e && e.stack ? e.stack : e);
  process.exit(1);
});
