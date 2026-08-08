/* ============================================================================
   ui-recap.js — Écran de récapitulatif mensuel (lot 4).

   Branche le moteur PUR du lot 1 (engine.js) sur les données lues via DB
   (db.js) : pour chaque contrat, calcule le récap du mois affiché, l'affiche
   de façon lisible, produit un texte prêt à copier dans WhatsApp, et permet
   de FIGER le mois (recap_mensuel, immuable — lot 2).

   Cumul des compteurs (RG-12) : le compteur d'entrée d'un mois est obtenu en
   rejouant, depuis le compteur d'initialisation (ou zéro), tous les mois qui
   précèdent — chaque mois enchaîne compteurSortie -> compteurEntree suivant.
   Un mois figé n'est jamais recalculé : on affiche l'instantané stocké.

   Ne parle jamais au réseau directement : tout passe par DB.
   Aucune règle de calcul ici : tout vient de Engine.
   ========================================================================= */
(function (global) {
  'use strict';

  var Engine = global.Engine;
  var Format = global.Format;

  var etat = {
    conteneur: null,
    contrats: [],
    annee: null,
    mois: null
  };

  /* ------------------------------------------------------------------ */
  /* Utilitaires                                                         */
  /* ------------------------------------------------------------------ */

  function ce(tag, classe, texte) {
    var e = document.createElement(tag);
    if (classe) e.className = classe;
    if (texte != null) e.textContent = texte;
    return e;
  }
  function vider(el) { while (el.firstChild) el.removeChild(el.firstChild); }

  function moisLibelle(mois) {
    return ['', 'janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet',
      'août', 'septembre', 'octobre', 'novembre', 'décembre'][mois];
  }
  function moisSuivant(a, m) { m++; if (m > 12) { m = 1; a++; } return { annee: a, mois: m }; }
  function cmpMois(a1, m1, a2, m2) { return a1 !== a2 ? a1 - a2 : m1 - m2; }
  function moisDeDate(dateStr) { var p = dateStr.split('-'); return { annee: +p[0], mois: +p[1] }; }
  function eur(c) { return Format ? Format.centimesEnEuros(c) : (c / 100).toFixed(2) + ' €'; }
  function heures(min) { return Format ? Format.minutesEnHeures(min) : min + ' min'; }
  function jours(dix) { return Format ? Format.dixiemesEnJours(dix) : (dix / 10) + ' j'; }

  /* ------------------------------------------------------------------ */
  /* Calcul avec cumul des compteurs                                     */
  /* ------------------------------------------------------------------ */

  /* Rejoue les mois de [départ .. cible[ pour cumuler les compteurs, puis
     calcule le mois cible. `départ` = mois du compteur d'initialisation, sinon
     mois de début du contrat. Résout { resultat, salaireManquant }. */
  function calculerAvecCumul(contrat) {
    return Promise.all([
      global.DB.getSalaires(contrat.id),
      global.DB.getCompteurInitial(contrat.id)
    ]).then(function (res) {
      var salaires = res[0] || [];
      var init = res[1];
      var depart = init ? moisDeDate(init.date_reference) : moisDeDate(contrat.date_debut);
      var compteur = init
        ? { minutesSup: init.minutes_sup, dixiemesCpAcquis: init.dixiemes_cp_acquis, dixiemesCpPris: init.dixiemes_cp_pris }
        : { minutesSup: 0, dixiemesCpAcquis: 0, dixiemesCpPris: 0 };

      // Mois strictement AVANT le mois cible, à partir du départ (bornés).
      var chaine = [];
      var cur = { annee: depart.annee, mois: depart.mois };
      var garde = 0;
      while (cmpMois(cur.annee, cur.mois, etat.annee, etat.mois) < 0 && garde < 600) {
        chaine.push({ annee: cur.annee, mois: cur.mois });
        cur = moisSuivant(cur.annee, cur.mois);
        garde++;
      }

      // Replay séquentiel pour cumuler le compteur d'entrée du mois cible.
      // Correction B1 (relecture lot 4) : un mois intermédiaire sans salaire
      // connu (ex. contrat démarré en cours de mois, salaire à date d'effet
      // postérieure) ne doit PAS être ignoré — les heures sup, les congés et
      // les CP s'y accumulent quand même. On calcule alors avec un salaire nul
      // (seule la retenue monétaire en dépend, et on n'affiche pas ce mois) :
      // les compteurs de sortie restent exacts.
      var salaireNul = { brut_mensuel_centimes: 0, net_mensuel_centimes: 0 };
      var seq = Promise.resolve();
      chaine.forEach(function (mm) {
        seq = seq.then(function () {
          var salaire = Engine.salaireApplicable(salaires, mm.annee, mm.mois) || salaireNul;
          return global.DB.getJourneesMois(contrat.id, mm.annee, mm.mois).then(function (parJour) {
            var journees = Object.keys(parJour).map(function (k) { return parJour[k]; });
            var r = Engine.calculerMois({
              contrat: contrat, salaire: salaire, journees: journees,
              compteurEntree: compteur, annee: mm.annee, mois: mm.mois
            });
            compteur = r.compteurSortie;
          });
        });
      });

      // Mois cible.
      return seq.then(function () {
        var salaire = Engine.salaireApplicable(salaires, etat.annee, etat.mois);
        if (!salaire) return { resultat: null, salaireManquant: true };
        return global.DB.getJourneesMois(contrat.id, etat.annee, etat.mois).then(function (parJour) {
          var journees = Object.keys(parJour).map(function (k) { return parJour[k]; });
          var r = Engine.calculerMois({
            contrat: contrat, salaire: salaire, journees: journees,
            compteurEntree: compteur, annee: etat.annee, mois: etat.mois
          });
          return { resultat: r, salaireManquant: false };
        });
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /* Rendu                                                               */
  /* ------------------------------------------------------------------ */

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
    afficherRecapMois(a, m);
  }

  function ligne(carte, libelle, valeur, fort) {
    var l = ce('div', 'recap-ligne' + (fort ? ' recap-fort' : ''));
    l.appendChild(ce('span', 'recap-lib', libelle));
    l.appendChild(ce('span', 'recap-val', valeur));
    carte.appendChild(l);
  }

  /* Texte prêt à copier dans WhatsApp pour un contrat/mois. */
  function texteWhatsApp(contrat, r) {
    var nom = contrat.prenom_enfant + (contrat.famille && contrat.famille.nom ? ' (' + contrat.famille.nom + ')' : '');
    var imp = r.imputation || {};
    var lignes = [
      'Récap ' + moisLibelle(etat.mois) + ' ' + etat.annee + ' — ' + nom,
      'Présence : ' + r.joursPresence + ' jour(s)',
      'Entretien : ' + eur(r.entretienCentimes),
      'Heures sup du mois : ' + heures(r.minutesSupAcquises)
    ];
    if (r.joursCongesDecomptes > 0) {
      lignes.push('Congés pris : ' + r.joursCongesDecomptes + ' jour(s) ouvrable(s)' +
        ' (CP ' + (imp.joursSurCp || 0) + ' · sup ' + (imp.joursSurSup || 0) +
        ' · sans solde ' + (imp.joursSansSolde || 0) + ')');
    }
    if (r.retenueSansSoldeCentimes > 0) {
      lignes.push('Retenue sans solde : -' + eur(r.retenueSansSoldeCentimes));
    }
    lignes.push('Net à verser : ' + eur(r.totalAVerserCentimes));
    lignes.push('Solde heures sup : ' + heures(r.compteurSortie.minutesSup) +
      ' · Solde CP : ' + jours(r.compteurSortie.dixiemesCpAcquis - r.compteurSortie.dixiemesCpPris));
    return lignes.join('\n');
  }

  function carteContrat(prep) {
    var contrat = prep.contrat;
    var carte = ce('section', 'carte-contrat');
    var entete = ce('div', 'recap-entete');
    entete.appendChild(ce('h3', null, contrat.prenom_enfant +
      (contrat.famille && contrat.famille.nom ? ' · ' + contrat.famille.nom : '')));
    if (prep.fige) {
      var badge = ce('span', 'badge-fige', 'Figé');
      entete.appendChild(badge);
    }
    carte.appendChild(entete);

    if (prep.salaireManquant) {
      carte.appendChild(ce('p', 'vide', 'Aucun salaire connu pour ce mois (renseigner un salaire à date d’effet ≤ ce mois).'));
      return carte;
    }

    var r = prep.resultat;
    ligne(carte, 'Jours de présence', String(r.joursPresence));
    ligne(carte, 'Entretien', eur(r.entretienCentimes));
    ligne(carte, 'Heures sup du mois', heures(r.minutesSupAcquises));
    if (r.joursCongesDecomptes > 0) {
      var imp = r.imputation || {};
      ligne(carte, 'Congés décomptés', r.joursCongesDecomptes + ' j ouvrables');
      ligne(carte, '— sur congés payés', String(imp.joursSurCp || 0) + ' j');
      ligne(carte, '— sur heures sup', String(imp.joursSurSup || 0) + ' j');
      if ((imp.joursSansSolde || 0) > 0) ligne(carte, '— en sans solde', String(imp.joursSansSolde) + ' j');
    }
    if (r.retenueSansSoldeCentimes > 0) ligne(carte, 'Retenue sans solde', '-' + eur(r.retenueSansSoldeCentimes));
    ligne(carte, 'Salaire net', eur(r.salaireNetCentimes));
    ligne(carte, 'Net à verser', eur(r.totalAVerserCentimes), true);

    var sup = r.compteurSortie.minutesSup;
    var cpDispo = r.compteurSortie.dixiemesCpAcquis - r.compteurSortie.dixiemesCpPris;
    ligne(carte, 'Solde heures sup', heures(sup));
    ligne(carte, 'Solde congés payés', jours(cpDispo));

    // Bloc WhatsApp
    var wa = ce('div', 'recap-wa');
    var ta = ce('textarea', 'wa-texte'); ta.readOnly = true; ta.rows = 7;
    ta.value = texteWhatsApp(contrat, r);
    wa.appendChild(ta);
    var copier = ce('button', 'btn btn-secondaire btn-bloc', 'Copier pour WhatsApp');
    copier.onclick = function () { copierTexte(ta.value, copier); };
    wa.appendChild(copier);
    carte.appendChild(wa);

    // Actions figement
    var actions = ce('div', 'form-actions');
    if (prep.fige) {
      var note = ce('p', 'aide');
      note.textContent = 'Mois figé' + (prep.recap && prep.recap.fige_le ? ' le ' + prep.recap.fige_le.slice(0, 10) : '') +
        ' — le document est verrouillé (immuable).';
      carte.appendChild(note);
    } else {
      var brouillon = ce('button', 'btn btn-secondaire', 'Enregistrer le brouillon');
      brouillon.onclick = function () { enregistrer(contrat, r, brouillon); };
      var figer = ce('button', 'btn btn-primary', 'Figer le mois');
      figer.onclick = function () { figer1(contrat, r, figer); };
      actions.appendChild(brouillon); actions.appendChild(figer);
      carte.appendChild(actions);
    }

    var msg = ce('div', 'msg-absence'); msg.id = 'msg-recap-' + contrat.id;
    carte.appendChild(msg);
    return carte;
  }

  function copierTexte(txt, bouton) {
    var ok = function () { var t = bouton.textContent; bouton.textContent = 'Copié ✓'; setTimeout(function () { bouton.textContent = t; }, 1500); };
    if (global.navigator && global.navigator.clipboard && global.navigator.clipboard.writeText) {
      global.navigator.clipboard.writeText(txt).then(ok, function () { fallbackCopie(txt, ok); });
    } else { fallbackCopie(txt, ok); }
  }
  function fallbackCopie(txt, ok) {
    try {
      var ta = document.createElement('textarea');
      ta.value = txt; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta); ok();
    } catch (e) { /* silencieux */ }
  }

  function messageRecap(contratId, txt) {
    var m = document.getElementById('msg-recap-' + contratId);
    if (m) m.textContent = txt || '';
  }

  function enregistrer(contrat, resultat, bouton) {
    bouton.disabled = true; messageRecap(contrat.id, 'Enregistrement…');
    global.DB.enregistrerRecapBrouillon(contrat.id, etat.annee, etat.mois, resultat)
      .then(function () { messageRecap(contrat.id, 'Brouillon enregistré.'); bouton.disabled = false; })
      .catch(function (e) { messageRecap(contrat.id, 'Erreur : ' + (e.message || e)); bouton.disabled = false; });
  }

  function figer1(contrat, resultat, bouton) {
    if (!global.confirm('Figer ' + moisLibelle(etat.mois) + ' ' + etat.annee + ' pour ' + contrat.prenom_enfant +
        ' ? Le récap deviendra définitif (non modifiable).')) { return; }
    bouton.disabled = true; messageRecap(contrat.id, 'Figement…');
    global.DB.figerRecap(contrat.id, etat.annee, etat.mois, resultat, new Date().toISOString())
      .then(function () { return afficherRecapMois(etat.annee, etat.mois); })
      .catch(function (e) { messageRecap(contrat.id, 'Erreur : ' + (e.message || e)); bouton.disabled = false; });
  }

  function rendre(preps) {
    var c = etat.conteneur;
    vider(c);
    c.appendChild(barreMois());

    // Bouton export global (tous les contrats du mois)
    if (preps.some(function (p) { return !p.salaireManquant; })) {
      var expo = ce('button', 'btn btn-secondaire btn-bloc', 'Copier tous les récaps du mois');
      expo.onclick = function () { copierTexte(exportGlobal(preps), expo); };
      c.appendChild(expo);
    }

    preps.forEach(function (p) { c.appendChild(carteContrat(p)); });

    if (etat.contrats.length === 0) {
      c.appendChild(ce('p', 'vide', 'Aucun contrat actif.'));
    }
  }

  function exportGlobal(preps) {
    return preps.filter(function (p) { return !p.salaireManquant && p.resultat; })
      .map(function (p) { return texteWhatsApp(p.contrat, p.resultat); })
      .join('\n\n———\n\n');
  }

  /* ------------------------------------------------------------------ */
  /* API publique                                                        */
  /* ------------------------------------------------------------------ */

  function init(opts) {
    etat.conteneur = opts.conteneur;
    etat.contrats = opts.contrats || [];
  }

  function afficherRecapMois(annee, mois) {
    etat.annee = annee; etat.mois = mois;
    if (etat.conteneur) etat.conteneur.textContent = 'Calcul du récap…';

    var lectures = etat.contrats.map(function (contrat) {
      return global.DB.getRecap(contrat.id, annee, mois).then(function (recap) {
        if (recap && recap.statut === 'fige') {
          return { contrat: contrat, fige: true, recap: recap, resultat: recap.donnees, salaireManquant: false };
        }
        return calculerAvecCumul(contrat).then(function (calc) {
          return { contrat: contrat, fige: false, recap: recap, resultat: calc.resultat, salaireManquant: calc.salaireManquant };
        });
      });
    });

    return Promise.all(lectures)
      .then(function (preps) { rendre(preps); })
      .catch(function (e) {
        if (etat.conteneur) etat.conteneur.textContent = 'Erreur de calcul : ' + (e.message || e);
      });
  }

  global.UiRecap = { init: init, afficherRecapMois: afficherRecapMois };
})(window);
