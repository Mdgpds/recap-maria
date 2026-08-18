/* ============================================================================
   decor-avenants.js — LE DÉCOR DES CONDITIONS DATÉES (lot 17).

   Les quatorze tests d'écran posent chacun leur propre faux `DB`. Avant le
   lot 17, chacun exposait `getSalaires`, qui rendait un brut et un net ; les
   neuf autres réglages vivaient sur l'objet `contrat` du décor.

   Depuis le §17.2, le moteur ne lit plus AUCUN réglage sur `contrat` : il
   reçoit les conditions du mois, c'est-à-dire l'avenant en vigueur. Les décors
   doivent donc exposer `getAvenants`.

   CE FICHIER NE FAIT QUE TRADUIRE LA FORME. Il assemble l'avenant à partir du
   contrat et du barème que le test a déjà écrits — exactement comme la
   migration `014` l'a fait en base. Aucune valeur n'est inventée, aucune règle
   n'est réécrite : un test qui posait 500 centimes d'entretien continue de
   poser 500 centimes d'entretien.

   Il vit ici, en un seul exemplaire, parce que quatorze traductions écrites à
   la main auraient divergé — et une divergence dans un décor produit un test
   qui passe sur des données que l'application ne verra jamais.
   ========================================================================= */
'use strict';

/* Les onze réglages, avec les mêmes défauts que `001_schema.sql` corrigé par
   la migration `013` (fin d'accueil à 17h30, §16.5). */
var DEFAUTS = {
  jours_planning: [1, 2, 3, 4, 5],
  heure_arrivee: '08:30',
  heure_depart: '17:30',
  minutes_contractuelles: 540,
  minutes_sup_jour: 30,
  minutes_par_jour_conge: 540,
  entretien_centimes_jour: 500,
  sup_dues_si_enfant_absent: true,
  ordre_imputation: 'cp_puis_sup'
};

/* Un avenant à partir d'un contrat et d'un barème.

   `date_effet` : celle du barème s'il en porte une, sinon le 1er du mois de
   `date_debut` — c'est la règle qu'a retenue la migration `014`, et pour la
   même raison : un avenant daté du 16 mars laisserait mars sans aucune
   condition applicable, donc incalculable. */
function avenantDe(contrat, salaire, extra) {
  var c = contrat || {};
  var s = salaire || {};
  var a = {
    id: s.id ? 'av-' + s.id : 'av-' + (c.id || 'x'),
    contrat_id: c.id || null,
    numero: 1,
    reconstitue: false,
    date_effet: normaliser(s.date_effet) || premierDuMois(c.date_debut) || '2020-01-01',
    brut_mensuel_centimes: s.brut_mensuel_centimes == null ? null : s.brut_mensuel_centimes,
    net_mensuel_centimes: s.net_mensuel_centimes == null ? null : s.net_mensuel_centimes
  };
  Object.keys(DEFAUTS).forEach(function (k) {
    a[k] = (c[k] === undefined || c[k] === null) ? DEFAUTS[k] : c[k];
  });
  Object.keys(extra || {}).forEach(function (k) { a[k] = extra[k]; });
  return a;
}

/* Plusieurs barèmes datés d'un même contrat deviennent plusieurs avenants,
   numérotés par date d'effet croissante — comme le fait `ajouterAvenant`. */
function avenantsDe(contrat, salaires, extra) {
  var liste = (salaires || []).slice().sort(function (x, y) {
    return String(x.date_effet) < String(y.date_effet) ? -1 : 1;
  });
  if (!liste.length) return [avenantDe(contrat, null, extra)];
  return liste.map(function (s, i) {
    var a = avenantDe(contrat, s, extra);
    a.numero = i + 1;
    /* Le premier avenant est ramené au 1er du mois de `date_debut` : sans
       lui, le mois d'ouverture du contrat n'aurait aucune condition. */
    if (i === 0) {
      var premier = premierDuMois(contrat && contrat.date_debut);
      if (premier && premier < a.date_effet) a.date_effet = premier;
    }
    return a;
  });
}

function premierDuMois(dateIso) {
  if (!dateIso) return null;
  return String(dateIso).slice(0, 7) + '-01';
}

/* Une date d'effet qui n'est pas un 1er de mois est normalisée VERS L'AVANT,
   au 1er du mois suivant — exactement comme la migration `014`, et pour la
   même raison : `salaireApplicable` comparait déjà `date_effet <= 1er du
   mois`, donc un barème au 15 mars ne s'appliquait qu'à partir d'avril. Le
   ramener au 1er mars changerait mars, et le décor ne testerait plus la même
   chose que l'application. */
function normaliser(dateIso) {
  if (!dateIso) return null;
  var d = String(dateIso).slice(0, 10);
  if (d.slice(8, 10) === '01') return d.slice(0, 7) + '-01';
  var an = Number(d.slice(0, 4));
  var mo = Number(d.slice(5, 7)) + 1;
  if (mo > 12) { mo = 1; an++; }
  return an + '-' + String(mo).padStart(2, '0') + '-01';
}

/* Le compteur de reprise, dans la nouvelle unité (§17.6). Les décors
   l'écrivaient en dixièmes de jour ; la conversion est exacte au facteur
   `minutes_par_jour_conge / 10`. */
function compteurEnMinutes(compteur, minutesParJourConge) {
  if (!compteur) return compteur;
  var f = (minutesParJourConge || 540) / 10;
  var out = {};
  Object.keys(compteur).forEach(function (k) { out[k] = compteur[k]; });
  if (out.minutes_cp_acquis == null) {
    out.minutes_cp_acquis = (compteur.dixiemes_cp_acquis || 0) * f;
  }
  if (out.minutes_cp_pris == null) {
    out.minutes_cp_pris = (compteur.dixiemes_cp_pris || 0) * f;
  }
  return out;
}

module.exports = {
  DEFAUTS: DEFAUTS,
  avenantDe: avenantDe,
  avenantsDe: avenantsDe,
  compteurEnMinutes: compteurEnMinutes
};
