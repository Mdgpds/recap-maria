/* ============================================================================
   ui-saisie.js — Écran de saisie mensuelle (par exception).

   Objectif (§5 specs) : descendre sous 5 min de saisie par mois.

   Principes :
   - Saisie par exception : chaque jour du planning est présumé « présence ».
     Maria ne touche que les écarts. Aucun jour « présence » n'est écrit en
     base ; seules les exceptions créent une ligne journee.
   - Fériés pré-remplis automatiquement depuis feries.js — jamais écrits en
     base (le moteur les déduit du calendrier).
   - Action groupée : une absence de Maria (congé, jour non travaillé) se pose
     en UNE fois sur tous les contrats ; une absence d'enfant se saisit
     contrat par contrat.

   Ne parle jamais au réseau directement : tout passe par DB (db.js).
   Aucune règle de calcul ici : le moteur (lot 1) n'intervient qu'au lot 4.
   ========================================================================= */
(function (global) {
  'use strict';

  var Feries = global.Feries;

  var TYPES = {
    presence:        { libelle: 'Présence',        court: 'Présent',   classe: 'j-presence' },
    absence_enfant:  { libelle: 'Absence enfant',  court: 'Absent',    classe: 'j-absence' },
    conge_maria:     { libelle: 'Congé (Maria)',   court: 'Congé',     classe: 'j-conge' },
    sans_solde:      { libelle: 'Sans solde',      court: 'Ss solde',  classe: 'j-sanssolde' },
    familiarisation: { libelle: 'Familiarisation', court: 'Familia.',  classe: 'j-familia' },
    ferie:           { libelle: 'Férié',           court: 'Férié',     classe: 'j-ferie' },
    hors_planning:   { libelle: 'Hors planning',   court: '—',         classe: 'j-hors' }
  };

  var JOURS_LETTRE = ['', 'L', 'M', 'M', 'J', 'V', 'S', 'D'];

  var etat = {
    conteneur: null,
    contrats: [],
    annee: null,
    mois: null,
    journees: {}   // { contratId : { 'YYYY-MM-DD' : ligne } }
  };

  /* ------------------------------------------------------------------ */
  /* Utilitaires de dates (purs, sans fuseau)                            */
  /* ------------------------------------------------------------------ */

  function jourSemaine(dateStr) {
    var p = dateStr.split('-');
    var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay();
    return d === 0 ? 7 : d;
  }
  function nbJoursMois(annee, mois) { return new Date(Date.UTC(annee, mois, 0)).getUTCDate(); }
  function dateStr(annee, mois, jour) {
    return annee + '-' + String(mois).padStart(2, '0') + '-' + String(jour).padStart(2, '0');
  }
  function moisLibelle(mois) {
    return ['', 'janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet',
      'août', 'septembre', 'octobre', 'novembre', 'décembre'][mois];
  }

  /* Type effectif d'un jour pour un contrat : ligne saisie si présente ;
     sinon 'ferie' (calendrier) ou 'presence' (présomption). */
  function typeEffectif(contrat, ligneParJour, jStr) {
    var ligne = ligneParJour[jStr];
    if (ligne) return ligne.type;
    if (Feries.estJourFerie(jStr)) return 'ferie';
    return 'presence';
  }

  /* Jours du planning du mois pour un contrat, dans ses bornes de contrat. */
  function joursPlanningDuMois(contrat) {
    var planning = contrat.jours_planning || [1, 2, 3, 4, 5];
    var n = nbJoursMois(etat.annee, etat.mois);
    var jours = [];
    for (var d = 1; d <= n; d++) {
      var jStr = dateStr(etat.annee, etat.mois, d);
      if (planning.indexOf(jourSemaine(jStr)) === -1) continue;      // hors planning
      if (contrat.date_debut && jStr < contrat.date_debut) continue; // avant le contrat
      if (contrat.date_fin && jStr > contrat.date_fin) continue;     // après le contrat
      jours.push(jStr);
    }
    return jours;
  }

  /* ------------------------------------------------------------------ */
  /* Rendu                                                               */
  /* ------------------------------------------------------------------ */

  function vider(el) { while (el.firstChild) el.removeChild(el.firstChild); }
  function ce(tag, classe, texte) {
    var e = document.createElement(tag);
    if (classe) e.className = classe;
    if (texte != null) e.textContent = texte;
    return e;
  }

  function rendre() {
    var c = etat.conteneur;
    vider(c);

    c.appendChild(barreMois());
    c.appendChild(blocAbsenceMaria());

    etat.contrats.forEach(function (contrat) {
      c.appendChild(carteContrat(contrat));
    });

    if (etat.contrats.length === 0) {
      c.appendChild(ce('p', 'vide', 'Aucun contrat actif. (Les contrats se créent en base ; l’édition de contrat arrivera dans un lot ultérieur.)'));
    }
  }

  function barreMois() {
    var barre = ce('div', 'barre-mois');
    var prec = ce('button', 'nav-mois', '◀');
    prec.setAttribute('aria-label', 'Mois précédent');
    prec.onclick = function () { changerMois(-1); };
    var titre = ce('h2', 'titre-mois', moisLibelle(etat.mois) + ' ' + etat.annee);
    var suiv = ce('button', 'nav-mois', '▶');
    suiv.setAttribute('aria-label', 'Mois suivant');
    suiv.onclick = function () { changerMois(1); };
    barre.appendChild(prec); barre.appendChild(titre); barre.appendChild(suiv);
    return barre;
  }

  function changerMois(delta) {
    var m = etat.mois + delta, a = etat.annee;
    if (m < 1) { m = 12; a--; } else if (m > 12) { m = 1; a++; }
    afficherMois(a, m);
  }

  /* Bloc « Absence de Maria » — action groupée sur tous les contrats. */
  function blocAbsenceMaria() {
    var bloc = ce('section', 'bloc-absence-maria');
    bloc.appendChild(ce('h3', null, 'Absence de Maria (tous les enfants)'));
    bloc.appendChild(ce('p', 'aide', 'Congé ou jour non travaillé : posé en une fois sur tous les contrats.'));

    var ligne = ce('div', 'form-ligne');

    var lblDu = ce('label', null, 'Du'); var du = ce('input');
    du.type = 'date'; du.className = 'in-date'; du.value = dateStr(etat.annee, etat.mois, 1);
    lblDu.appendChild(du);

    var lblAu = ce('label', null, 'Au'); var au = ce('input');
    au.type = 'date'; au.className = 'in-date'; au.value = dateStr(etat.annee, etat.mois, 1);
    lblAu.appendChild(au);

    var lblType = ce('label', null, 'Type'); var sel = ce('select', 'in-type');
    [['conge_maria', 'Congé'], ['sans_solde', 'Sans solde'], ['hors_planning', 'Jour non travaillé']]
      .forEach(function (o) { var op = ce('option', null, o[1]); op.value = o[0]; sel.appendChild(op); });
    lblType.appendChild(sel);

    ligne.appendChild(lblDu); ligne.appendChild(lblAu); ligne.appendChild(lblType);
    bloc.appendChild(ligne);

    var actions = ce('div', 'form-actions');
    var poser = ce('button', 'btn btn-primary', 'Poser sur tous les contrats');
    poser.onclick = function () { poserAbsenceMaria(du.value, au.value, sel.value, poser); };
    var retirer = ce('button', 'btn btn-secondaire', 'Retirer');
    retirer.onclick = function () { retirerAbsenceMaria(du.value, au.value, retirer); };
    actions.appendChild(poser); actions.appendChild(retirer);
    bloc.appendChild(actions);

    var msg = ce('div', 'msg-absence'); msg.id = 'msg-absence-maria';
    bloc.appendChild(msg);
    return bloc;
  }

  /* Liste des dates du planning d'un contrat comprises dans [du, au]. */
  function joursPlanningEntre(contrat, du, au) {
    return joursPlanningDuMois(contrat).filter(function (j) { return j >= du && j <= au; });
  }
  /* Union des jours de planning (tous contrats) sur l'intervalle, non fériés. */
  function joursAbsenceMaria(du, au) {
    var set = {};
    etat.contrats.forEach(function (contrat) {
      joursPlanningEntre(contrat, du, au).forEach(function (j) {
        if (!Feries.estJourFerie(j)) set[j] = true;
      });
    });
    return Object.keys(set).sort();
  }

  function poserAbsenceMaria(du, au, type, bouton) {
    var msg = document.getElementById('msg-absence-maria');
    if (!du || !au || au < du) { msg.textContent = 'Dates invalides.'; return; }
    var contratIds = etat.contrats.map(function (c) { return c.id; });
    var jours = joursAbsenceMaria(du, au);
    if (jours.length === 0) { msg.textContent = 'Aucun jour de planning dans cette période.'; return; }
    bouton.disabled = true; msg.textContent = 'Enregistrement…';
    global.DB.poserAbsenceMaria(contratIds, jours, type, null)
      .then(function () { return afficherMois(etat.annee, etat.mois); })
      .then(function () {
        var m = document.getElementById('msg-absence-maria');
        if (m) m.textContent = jours.length + ' jour(s) posé(s) sur ' + contratIds.length + ' contrat(s).';
      })
      .catch(function (e) { msg.textContent = 'Erreur : ' + (e.message || e); bouton.disabled = false; });
  }

  function retirerAbsenceMaria(du, au, bouton) {
    var msg = document.getElementById('msg-absence-maria');
    if (!du || !au || au < du) { msg.textContent = 'Dates invalides.'; return; }
    var contratIds = etat.contrats.map(function (c) { return c.id; });
    var jours = joursAbsenceMaria(du, au);
    if (jours.length === 0) { msg.textContent = 'Aucun jour concerné.'; return; }
    bouton.disabled = true; msg.textContent = 'Suppression…';
    global.DB.retirerAbsenceMaria(contratIds, jours)
      .then(function () { return afficherMois(etat.annee, etat.mois); })
      .then(function () {
        var m = document.getElementById('msg-absence-maria');
        if (m) m.textContent = 'Absence retirée.';
      })
      .catch(function (e) { msg.textContent = 'Erreur : ' + (e.message || e); bouton.disabled = false; });
  }

  /* Carte d'un contrat : grille des jours du planning du mois. */
  function carteContrat(contrat) {
    var carte = ce('section', 'carte-contrat');
    var enteteTexte = contrat.prenom_enfant +
      (contrat.famille && contrat.famille.nom ? ' · ' + contrat.famille.nom : '');
    carte.appendChild(ce('h3', null, enteteTexte));

    var ligneParJour = etat.journees[contrat.id] || {};
    var jours = joursPlanningDuMois(contrat);

    // résumé rapide (nb présences / absences)
    var nbPres = 0, nbAbs = 0, nbConge = 0;
    jours.forEach(function (j) {
      var t = typeEffectif(contrat, ligneParJour, j);
      if (t === 'presence') nbPres++;
      else if (t === 'absence_enfant') nbAbs++;
      else if (t === 'conge_maria') nbConge++;
    });
    carte.appendChild(ce('p', 'resume',
      nbPres + ' présence(s) · ' + nbAbs + ' absence(s) enfant · ' + nbConge + ' congé(s)'));

    var grille = ce('div', 'grille-jours');
    jours.forEach(function (jStr) {
      var t = typeEffectif(contrat, ligneParJour, jStr);
      var chip = ce('button', 'chip ' + TYPES[t].classe);
      var num = jStr.slice(8, 10);
      chip.appendChild(ce('span', 'chip-jour', JOURS_LETTRE[jourSemaine(jStr)] + num));
      chip.appendChild(ce('span', 'chip-etat', TYPES[t].court));
      chip.onclick = function () { ouvrirFeuille(contrat, jStr, t); };
      grille.appendChild(chip);
    });
    carte.appendChild(grille);
    return carte;
  }

  /* ------------------------------------------------------------------ */
  /* Feuille d'action (bottom sheet) pour un (contrat, jour)             */
  /* ------------------------------------------------------------------ */

  function ouvrirFeuille(contrat, jStr, typeActuel) {
    fermerFeuille();
    var overlay = ce('div', 'overlay'); overlay.id = 'overlay-feuille';
    overlay.onclick = function (e) { if (e.target === overlay) fermerFeuille(); };

    var feuille = ce('div', 'feuille');
    feuille.appendChild(ce('h4', null, contrat.prenom_enfant + ' — ' +
      jStr.slice(8, 10) + ' ' + moisLibelle(etat.mois)));

    var ferie = Feries.estJourFerie(jStr);
    if (ferie) feuille.appendChild(ce('p', 'aide', 'Ce jour est férié (chômé et payé). Il est déjà géré automatiquement.'));

    // Options principales
    var options = [
      ['presence', 'Présence (normal)'],
      ['absence_enfant', 'Absence de l’enfant'],
      ['conge_maria', 'Congé de Maria'],
      ['sans_solde', 'Sans solde'],
      ['familiarisation', 'Familiarisation'],
      ['hors_planning', 'Hors planning']
    ];
    options.forEach(function (o) {
      var b = ce('button', 'opt' + (o[0] === typeActuel ? ' opt-actif' : ''), o[1]);
      b.onclick = function () {
        if (o[0] === 'familiarisation') { formFamiliarisation(feuille, contrat, jStr); }
        else { appliquerType(contrat, jStr, o[0]); }
      };
      feuille.appendChild(b);
    });

    var fermer = ce('button', 'btn btn-secondaire btn-bloc', 'Fermer');
    fermer.onclick = fermerFeuille;
    feuille.appendChild(fermer);

    overlay.appendChild(feuille);
    document.body.appendChild(overlay);
  }

  function fermerFeuille() {
    var o = document.getElementById('overlay-feuille');
    if (o && o.parentNode) o.parentNode.removeChild(o);
  }

  /* Familiarisation : saisie manuelle des heures réelles + entretien (RG-14). */
  function formFamiliarisation(feuille, contrat, jStr) {
    vider(feuille);
    feuille.appendChild(ce('h4', null, 'Familiarisation — ' + jStr.slice(8, 10) + ' ' + moisLibelle(etat.mois)));
    feuille.appendChild(ce('p', 'aide', 'Rémunération au réel (RG-14). Saisir les heures réelles et l’indemnité d’entretien du jour.'));

    var ligne = (etat.journees[contrat.id] || {})[jStr] || {};

    var lblH = ce('label', null, 'Heures réelles (ex. 3h30)');
    var inH = ce('input'); inH.type = 'text'; inH.className = 'in-texte'; inH.placeholder = '3h30';
    if (ligne.minutes_reelles != null) inH.value = global.Format ? global.Format.minutesEnHeures(ligne.minutes_reelles) : String(ligne.minutes_reelles);
    lblH.appendChild(inH);

    var lblE = ce('label', null, 'Entretien du jour (€)');
    var inE = ce('input'); inE.type = 'text'; inE.className = 'in-texte'; inE.placeholder = '5,00';
    if (ligne.entretien_centimes != null) inE.value = (ligne.entretien_centimes / 100).toFixed(2).replace('.', ',');
    lblE.appendChild(inE);

    feuille.appendChild(lblH); feuille.appendChild(lblE);

    var valider = ce('button', 'btn btn-primary btn-bloc', 'Enregistrer');
    valider.onclick = function () {
      var minutes = parseHeures(inH.value);
      var centimes = parseEuros(inE.value);
      appliquerType(contrat, jStr, 'familiarisation', { minutes_reelles: minutes, entretien_centimes: centimes });
    };
    feuille.appendChild(valider);
    var annuler = ce('button', 'btn btn-secondaire btn-bloc', 'Annuler');
    annuler.onclick = fermerFeuille;
    feuille.appendChild(annuler);
  }

  function parseHeures(txt) {
    if (!txt) return null;
    txt = txt.trim().toLowerCase();
    var m = txt.match(/^(\d+)\s*h\s*(\d{0,2})$/);
    if (m) return parseInt(m[1], 10) * 60 + (m[2] ? parseInt(m[2], 10) : 0);
    var n = parseInt(txt, 10);
    return isNaN(n) ? null : n; // interprété comme minutes si pas de "h"
  }
  function parseEuros(txt) {
    if (!txt) return null;
    var norm = txt.replace(/\s/g, '').replace(',', '.');
    var v = parseFloat(norm);
    if (isNaN(v)) return null;
    return Math.round(v * 100);
  }

  /* Applique un type à un (contrat, jour) : supprime la ligne si « présence »
     (retour à la présomption), sinon upsert. */
  function appliquerType(contrat, jStr, type, extra) {
    var p;
    if (type === 'presence') {
      p = global.DB.supprimerJournee(contrat.id, jStr);
    } else {
      var ligne = {
        contrat_id: contrat.id, jour: jStr, type: type,
        minutes_reelles: extra ? extra.minutes_reelles : null,
        entretien_centimes: extra ? extra.entretien_centimes : null,
        commentaire: null
      };
      p = global.DB.enregistrerJournee(ligne);
    }
    p.then(function () {
      fermerFeuille();
      return afficherMois(etat.annee, etat.mois);
    }).catch(function (e) {
      alert('Erreur : ' + (e.message || e)); // eslint-disable-line no-alert
    });
  }

  /* ------------------------------------------------------------------ */
  /* API publique                                                        */
  /* ------------------------------------------------------------------ */

  function init(opts) {
    etat.conteneur = opts.conteneur;
    etat.contrats = opts.contrats || [];
  }

  /* Charge les journées de tous les contrats pour le mois puis rend. */
  function afficherMois(annee, mois) {
    etat.annee = annee; etat.mois = mois;
    var lectures = etat.contrats.map(function (c) {
      return global.DB.getJourneesMois(c.id, annee, mois).then(function (parJour) {
        return { id: c.id, parJour: parJour };
      });
    });
    return Promise.all(lectures).then(function (res) {
      etat.journees = {};
      res.forEach(function (r) { etat.journees[r.id] = r.parJour; });
      rendre();
    });
  }

  global.UiSaisie = { init: init, afficherMois: afficherMois };
})(window);
