/* ============================================================================
   ui-familles.js — Onglet « Familles » (lot 5, correctifs C2, C3 et C5).

   Ce que cet écran rend enfin possible sans toucher au code ni à la base :
   - C2 : créer et renommer une famille et un contrat. L'affichage
          « Alpha — Famille Papillon » se décompose en contrat.prenom_enfant
          (Alpha) et famille.nom (Papillon), tous deux modifiables. Les trois
          règles paramétrables déjà présentes en base et jusqu'ici invisibles
          (minutes_sup_jour, ordre_imputation, sup_dues_si_enfant_absent)
          deviennent modifiables : elles ont déjà changé une fois.
   - C3 : archiver un contrat terminé SANS rien supprimer, de façon
          réversible, en rappelant RG-13 (solde de fin de contrat).
   - C5 : saisir un nouveau barème de rémunération quand le SMIC change, avec
          les garde-fous qui protègent les récapitulatifs déjà partis.

   Aucune règle de calcul ici. Les seuls chiffres produits (soldes de fin de
   contrat) viennent de la chaîne des mois (chaine-mois.js) et de
   Engine.montantCentimes — le moteur n'est ni modifié ni dupliqué.
   Aucun accès réseau direct : tout passe par DB.
   ========================================================================= */
(function (global) {
  'use strict';

  var Format = global.Format;
  var Chaine = global.ChaineMois;

  var etat = {
    conteneur: null,
    familles: [],
    contrats: [],
    ouverts: {}      // { id de contrat : true } — blocs dépliés, conservés au re-rendu
  };

  /* ------------------------------------------------------------------ */
  /* Utilitaires d'affichage                                             */
  /* ------------------------------------------------------------------ */

  function ce(tag, classe, texte) {
    var e = document.createElement(tag);
    if (classe) e.className = classe;
    if (texte != null) e.textContent = texte;
    return e;
  }
  function vider(el) { while (el.firstChild) el.removeChild(el.firstChild); }
  function eur(c) { return Format ? Format.centimesEnEuros(c) : (c / 100).toFixed(2) + ' €'; }
  function heures(min) { return Format ? Format.minutesEnHeures(min) : min + ' min'; }
  function joursCp(dix) { return Format ? Format.dixiemesEnJours(dix) : (dix / 10) + ' j'; }
  function dateFr(iso) {
    if (!iso) return '—';
    var p = String(iso).slice(0, 10).split('-');
    return p[2] + '/' + p[1] + '/' + p[0];
  }
  function aujourdhui() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
           String(d.getDate()).padStart(2, '0');
  }

  /* Saisie d'un montant en euros -> centimes entiers. Mise en forme d'entrée,
     pas un calcul métier. */
  function parseEuros(txt) {
    if (txt == null) return null;
    var norm = String(txt).replace(/[\s €]/g, '');
    if (norm === '') return null;
    /* Écriture française : « 1 950,00 » ou « 1.950,00 ». Le point n'est un
       séparateur décimal que s'il n'y a pas de virgule. */
    if (norm.indexOf(',') !== -1) norm = norm.replace(/\./g, '').replace(',', '.');
    if (!/^\d+(\.\d+)?$/.test(norm)) return null;
    var v = parseFloat(norm);
    if (isNaN(v) || v < 0) return null;
    return Math.round(v * 100);
  }

  /* Entier positif saisi dans un champ nombre. Renvoie null si vide ou
     illisible : un champ vidé ne doit pas passer silencieusement pour zéro —
     mettre minutes_sup_jour à 0 par inadvertance changerait RG-03 sans que
     personne ne s'en aperçoive. */
  function parseEntier(txt, min) {
    var s = String(txt == null ? '' : txt).trim();
    if (s === '' || !/^\d+$/.test(s)) return null;
    var v = parseInt(s, 10);
    if (min != null && v < min) return null;
    return v;
  }

  function champ(parent, libelle, input, aide) {
    var l = ce('label', null, libelle);
    l.appendChild(input);
    if (aide) l.appendChild(ce('small', 'aide-champ', aide));
    parent.appendChild(l);
    return input;
  }
  function inputTexte(valeur, type) {
    var i = ce('input', 'in-texte');
    i.type = type || 'text';
    if (valeur != null) i.value = valeur;
    return i;
  }
  function inputNombre(valeur, min) {
    var i = ce('input', 'in-texte');
    i.type = 'number';
    i.step = '1';
    if (min != null) i.min = String(min);
    if (valeur != null) i.value = String(valeur);
    return i;
  }
  function selectOptions(options, valeur) {
    var s = ce('select', 'in-type');
    options.forEach(function (o) {
      var op = ce('option', null, o[1]);
      op.value = o[0];
      if (String(o[0]) === String(valeur)) op.selected = true;
      s.appendChild(op);
    });
    return s;
  }

  /* Message d'erreur en français, sans vocabulaire technique ni anglais.
     La traduction est mutualisée dans js/messages.js ; le détail technique
     part en console, jamais à l'écran. */
  function messageLisible(e) {
    if (!global.Messages) return 'une erreur est survenue.';
    var brut = (e && (e.message || e.details)) || String(e);
    if (/duplicate key|23505|unique/i.test(brut)) {
      return 'il existe déjà un barème à cette date d’effet pour ce contrat.';
    }
    return global.Messages.lisible(e);
  }

  function poserMessage(el, texte, estErreur) {
    el.textContent = texte || '';
    el.className = 'msg-absence' + (estErreur ? ' msg-erreur' : '');
  }

  /* ------------------------------------------------------------------ */
  /* Chargement                                                          */
  /* ------------------------------------------------------------------ */

  function afficher() {
    if (!etat.conteneur) return Promise.resolve();
    etat.conteneur.textContent = 'Chargement des familles…';
    return Promise.all([
      global.DB.listFamillesToutes(),
      global.DB.listContratsTous()
    ]).then(function (res) {
      etat.familles = res[0] || [];
      etat.contrats = res[1] || [];
      rendre();
    }).catch(function (e) {
      etat.conteneur.textContent = 'Familles indisponibles : ' + messageLisible(e);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Rendu                                                               */
  /* ------------------------------------------------------------------ */

  function rendre() {
    var c = etat.conteneur;
    vider(c);

    var entete = ce('div', 'barre-mois');
    entete.appendChild(ce('h2', 'titre-mois', 'Familles et contrats'));
    c.appendChild(entete);

    var actions = ce('div', 'form-actions');
    var bNouvelleFamille = ce('button', 'btn btn-primary', 'Nouvelle famille');
    bNouvelleFamille.onclick = function () { formulaireNouvelleFamille(); };
    var bBaremeGroupe = ce('button', 'btn btn-secondaire', 'Nouveau barème (plusieurs contrats)');
    bBaremeGroupe.onclick = function () { formulaireBaremeGroupe(); };
    actions.appendChild(bNouvelleFamille);
    actions.appendChild(bBaremeGroupe);
    c.appendChild(actions);

    var msgGlobal = ce('div', 'msg-absence'); msgGlobal.id = 'msg-familles';
    c.appendChild(msgGlobal);

    var familles = etat.familles.slice().sort(function (a, b) {
      if (!!a.archive !== !!b.archive) return a.archive ? 1 : -1;
      return String(a.nom).localeCompare(String(b.nom), 'fr');
    });

    if (familles.length === 0) {
      c.appendChild(ce('p', 'vide', 'Aucune famille. Commencez par « Nouvelle famille ».'));
      return;
    }
    familles.forEach(function (f) { c.appendChild(blocFamille(f)); });
  }

  function blocFamille(famille) {
    var bloc = ce('section', 'carte-contrat');

    var entete = ce('div', 'recap-entete');
    entete.appendChild(ce('h3', null, famille.nom));
    if (famille.archive) entete.appendChild(ce('span', 'badge-archive', 'Archivée'));
    bloc.appendChild(entete);
    if (famille.canal) bloc.appendChild(ce('p', 'aide', 'Groupe WhatsApp : ' + famille.canal));

    var det = ce('details', 'bloc-pliant');
    det.appendChild(ce('summary', null, 'Modifier la famille'));
    var form = ce('div', 'form-colonne');
    var inNom = champ(form, 'Nom de famille', inputTexte(famille.nom));
    var inCanal = champ(form, 'Groupe WhatsApp (facultatif)', inputTexte(famille.canal || ''));
    var msg = ce('div', 'msg-absence');
    var bEnr = ce('button', 'btn btn-primary btn-bloc', 'Enregistrer');
    bEnr.onclick = function () {
      var nom = inNom.value.trim();
      if (!nom) { poserMessage(msg, 'Le nom de famille est obligatoire.', true); return; }
      bEnr.disabled = true; poserMessage(msg, 'Enregistrement…');
      global.DB.majFamille(famille.id, { nom: nom, canal: inCanal.value.trim() || null })
        .then(rafraichirTout)
        .catch(function (e) {
          poserMessage(msg, 'Enregistrement impossible : ' + messageLisible(e), true);
          bEnr.disabled = false;
        });
    };
    form.appendChild(bEnr);
    form.appendChild(msg);
    det.appendChild(form);
    bloc.appendChild(det);

    var contrats = etat.contrats.filter(function (ct) { return ct.famille_id === famille.id; })
      .sort(function (a, b) {
        if (!!a.archive !== !!b.archive) return a.archive ? 1 : -1;
        return String(a.prenom_enfant).localeCompare(String(b.prenom_enfant), 'fr');
      });

    if (contrats.length === 0) {
      bloc.appendChild(ce('p', 'vide', 'Aucun contrat pour cette famille.'));
    }
    contrats.forEach(function (ct) { bloc.appendChild(blocContrat(famille, ct)); });

    var bNouveau = ce('button', 'btn btn-secondaire btn-bloc', 'Nouveau contrat pour ' + famille.nom);
    bNouveau.onclick = function () { formulaireNouveauContrat(famille); };
    bloc.appendChild(bNouveau);

    return bloc;
  }

  function blocContrat(famille, contrat) {
    var det = ce('details', 'bloc-pliant bloc-contrat');
    if (etat.ouverts[contrat.id]) det.open = true;
    det.addEventListener('toggle', function () { etat.ouverts[contrat.id] = det.open; });

    var titre = contrat.prenom_enfant + ' — ' + libelleStatut(contrat.statut) +
      (contrat.archive ? ' · archivé' : '');
    det.appendChild(ce('summary', null, titre));

    det.appendChild(formulaireContrat(contrat));
    det.appendChild(sectionBaremes(contrat));
    det.appendChild(sectionHistorique(contrat));
    det.appendChild(sectionArchivage(famille, contrat));
    return det;
  }

  function libelleStatut(s) {
    return { familiarisation: 'familiarisation', actif: 'actif', termine: 'terminé' }[s] || s;
  }

  /* ------------------------------------------------------------------ */
  /* Formulaire de contrat (C2)                                          */
  /* ------------------------------------------------------------------ */

  var JOURS = [[1, 'lundi'], [2, 'mardi'], [3, 'mercredi'], [4, 'jeudi'],
               [5, 'vendredi'], [6, 'samedi'], [7, 'dimanche']];

  function champsContrat(parent, contrat) {
    var c = contrat || {};
    var f = {};
    f.prenom = champ(parent, 'Prénom de l’enfant', inputTexte(c.prenom_enfant || ''));
    f.dateDebut = champ(parent, 'Date de début', inputTexte((c.date_debut || '').slice(0, 10), 'date'));
    f.dateFin = champ(parent, 'Date de fin', inputTexte((c.date_fin || '').slice(0, 10), 'date'),
      'Renseignée par l’archivage. La modifier change les calculs des mois concernés.');
    f.statut = champ(parent, 'Statut',
      selectOptions([['familiarisation', 'Familiarisation'], ['actif', 'Actif'], ['termine', 'Terminé']],
        c.statut || 'actif'),
      'Cycle de vie de la relation de travail — distinct du rangement (archivage).');

    var planning = ce('fieldset', 'planning');
    planning.appendChild(ce('legend', null, 'Jours de planning'));
    f.planning = [];
    JOURS.forEach(function (j) {
      var l = ce('label', 'case');
      var cb = ce('input');
      cb.type = 'checkbox';
      cb.value = String(j[0]);
      cb.checked = (c.jours_planning || [1, 2, 3, 4, 5]).indexOf(j[0]) !== -1;
      l.appendChild(cb);
      l.appendChild(ce('span', null, ' ' + j[1]));
      planning.appendChild(l);
      f.planning.push(cb);
    });
    parent.appendChild(planning);

    f.heureArrivee = champ(parent, 'Heure d’arrivée', inputTexte((c.heure_arrivee || '08:30').slice(0, 5), 'time'));
    f.heureDepart = champ(parent, 'Heure de départ', inputTexte((c.heure_depart || '18:00').slice(0, 5), 'time'));
    f.minutesContractuelles = champ(parent, 'Durée contractuelle (minutes/jour)',
      inputNombre(c.minutes_contractuelles != null ? c.minutes_contractuelles : 540, 1),
      '540 = 9 h.');
    f.minutesSupJour = champ(parent, 'Minutes supplémentaires par jour travaillé (RG-03)',
      inputNombre(c.minutes_sup_jour != null ? c.minutes_sup_jour : 30, 0),
      'Paramètre du contrat : 30 aujourd’hui, 0 demain si la règle change.');
    f.minutesParJourConge = champ(parent, 'Minutes pour un jour de congé (RG-05)',
      inputNombre(c.minutes_par_jour_conge != null ? c.minutes_par_jour_conge : 540, 1),
      '540 = 9 h. Doit rester strictement positif (le moteur en fait un diviseur).');
    f.entretien = champ(parent, 'Indemnité d’entretien par jour de présence (€)',
      inputTexte(((c.entretien_centimes_jour != null ? c.entretien_centimes_jour : 500) / 100).toFixed(2).replace('.', ',')),
      'RG-01 / RG-02.');
    f.ordreImputation = champ(parent, 'Ordre d’imputation des congés (RG-07)',
      selectOptions([['cp_puis_sup', 'Congés payés puis heures sup'],
                     ['sup_puis_cp', 'Heures sup puis congés payés']],
        c.ordre_imputation || 'cp_puis_sup'));
    f.supDuesSiAbsent = champ(parent, 'Heures sup dues si l’enfant est absent (RG-09)',
      selectOptions([['true', 'Oui — dues'], ['false', 'Non — non dues']],
        c.sup_dues_si_enfant_absent === false ? 'false' : 'true'));
    return f;
  }

  function lireChampsContrat(f, msg) {
    var prenom = f.prenom.value.trim();
    if (!prenom) { poserMessage(msg, 'Le prénom de l’enfant est obligatoire.', true); return null; }
    if (!f.dateDebut.value) { poserMessage(msg, 'La date de début est obligatoire.', true); return null; }
    var planning = f.planning.filter(function (cb) { return cb.checked; })
      .map(function (cb) { return Number(cb.value); });
    if (planning.length === 0) { poserMessage(msg, 'Cochez au moins un jour de planning.', true); return null; }
    var entretien = parseEuros(f.entretien.value);
    if (entretien == null) { poserMessage(msg, 'Indemnité d’entretien illisible (ex. « 5,00 »).', true); return null; }
    var mpjc = parseEntier(f.minutesParJourConge.value, 1);
    if (mpjc == null) { poserMessage(msg, 'Les minutes d’un jour de congé doivent être un nombre entier supérieur à zéro.', true); return null; }
    var mc = parseEntier(f.minutesContractuelles.value, 1);
    if (mc == null) { poserMessage(msg, 'La durée contractuelle doit être un nombre entier de minutes supérieur à zéro.', true); return null; }
    var msj = parseEntier(f.minutesSupJour.value, 0);
    if (msj == null) { poserMessage(msg, 'Les minutes supplémentaires par jour doivent être un nombre entier (0 accepté, mais il faut le saisir).', true); return null; }
    var dateFin = f.dateFin.value || null;
    if (dateFin && dateFin < f.dateDebut.value) {
      poserMessage(msg, 'La date de fin ne peut pas précéder la date de début.', true); return null;
    }
    return {
      prenom_enfant: prenom,
      date_debut: f.dateDebut.value,
      date_fin: dateFin,
      statut: f.statut.value,
      jours_planning: planning,
      heure_arrivee: f.heureArrivee.value || '08:30',
      heure_depart: f.heureDepart.value || '18:00',
      minutes_contractuelles: mc,
      minutes_sup_jour: msj,
      minutes_par_jour_conge: mpjc,
      entretien_centimes_jour: entretien,
      ordre_imputation: f.ordreImputation.value,
      sup_dues_si_enfant_absent: f.supDuesSiAbsent.value === 'true'
    };
  }

  /* Champs dont la modification CHANGE des chiffres déjà calculés. Les mois
     figés sont protégés en base, mais tous les mois non figés depuis le
     dernier figement seront recalculés — y compris des récapitulatifs déjà
     montrés à des parents sous forme de brouillon. On demande confirmation,
     en nommant ce qui change, au même titre que pour un archivage ou un
     barème rétroactif. */
  var CHAMPS_SENSIBLES = [
    ['date_debut', 'la date de début'],
    ['date_fin', 'la date de fin'],
    ['jours_planning', 'les jours de planning'],
    ['minutes_sup_jour', 'les minutes supplémentaires par jour (RG-03)'],
    ['minutes_par_jour_conge', 'les minutes d’un jour de congé (RG-05)'],
    ['entretien_centimes_jour', 'l’indemnité d’entretien (RG-02)'],
    ['ordre_imputation', 'l’ordre d’imputation des congés (RG-07)'],
    ['sup_dues_si_enfant_absent', 'les heures sup dues en cas d’absence de l’enfant (RG-09)']
  ];

  function changementsSensibles(contrat, champsSaisis) {
    var changes = [];
    CHAMPS_SENSIBLES.forEach(function (c) {
      var avant = contrat[c[0]];
      var apres = champsSaisis[c[0]];
      var egal = Array.isArray(avant) || Array.isArray(apres)
        ? String(avant) === String(apres)
        : String(avant == null ? '' : avant).slice(0, 10) === String(apres == null ? '' : apres).slice(0, 10);
      if (!egal) changes.push(c[1]);
    });
    return changes;
  }

  function formulaireContrat(contrat) {
    var det = ce('details', 'bloc-pliant');
    det.appendChild(ce('summary', null, 'Modifier le contrat'));
    var form = ce('div', 'form-colonne');
    var f = champsContrat(form, contrat);
    var msg = ce('div', 'msg-absence');
    var b = ce('button', 'btn btn-primary btn-bloc', 'Enregistrer');
    b.onclick = function () {
      poserMessage(msg, '');
      var champsSaisis = lireChampsContrat(f, msg);
      if (!champsSaisis) return;
      var sensibles = changementsSensibles(contrat, champsSaisis);
      if (sensibles.length && !global.confirm(
          'Vous modifiez ' + sensibles.join(', ') + ' de ' + contrat.prenom_enfant + '.\n\n' +
          'Tous les récapitulatifs NON FIGÉS seront recalculés avec ces nouvelles valeurs, ' +
          'y compris ceux des mois passés. Les récapitulatifs déjà figés, eux, ne bougeront pas.\n\n' +
          'Continuer ?')) {
        return;
      }
      b.disabled = true; poserMessage(msg, 'Enregistrement…');
      global.DB.majContrat(contrat.id, champsSaisis)
        .then(rafraichirTout)
        .catch(function (e) {
          poserMessage(msg, 'Enregistrement impossible : ' + messageLisible(e), true);
          b.disabled = false;
        });
    };
    form.appendChild(b);
    form.appendChild(msg);
    form.appendChild(ce('p', 'aide',
      'Renommer un enfant ou une famille ne modifie AUCUN récapitulatif déjà figé : ' +
      'les noms y sont inscrits au moment du figement.'));
    det.appendChild(form);
    return det;
  }

  function formulaireNouveauContrat(famille) {
    ouvrirFeuille('Nouveau contrat — ' + famille.nom, function (feuille, fermer) {
      var form = ce('div', 'form-colonne');
      var f = champsContrat(form, null);
      var msg = ce('div', 'msg-absence');
      var b = ce('button', 'btn btn-primary btn-bloc', 'Créer le contrat');
      b.onclick = function () {
        var champsSaisis = lireChampsContrat(f, msg);
        if (!champsSaisis) return;
        champsSaisis.famille_id = famille.id;
        b.disabled = true; poserMessage(msg, 'Création…');
        global.DB.creerContrat(champsSaisis)
          .then(function () { fermer(); return rafraichirTout(); })
          .catch(function (e) {
            poserMessage(msg, 'Création impossible : ' + messageLisible(e), true);
            b.disabled = false;
          });
      };
      form.appendChild(b);
      form.appendChild(msg);
      form.appendChild(ce('p', 'aide',
        'Pensez à saisir un barème de rémunération après la création : sans barème, ' +
        'le récapitulatif du mois ne peut pas être produit.'));
      feuille.appendChild(form);
    });
  }

  function formulaireNouvelleFamille() {
    ouvrirFeuille('Nouvelle famille', function (feuille, fermer) {
      var form = ce('div', 'form-colonne');
      var inNom = champ(form, 'Nom de famille', inputTexte(''));
      var inCanal = champ(form, 'Groupe WhatsApp (facultatif)', inputTexte(''));
      var msg = ce('div', 'msg-absence');
      var b = ce('button', 'btn btn-primary btn-bloc', 'Créer la famille');
      b.onclick = function () {
        var nom = inNom.value.trim();
        if (!nom) { poserMessage(msg, 'Le nom de famille est obligatoire.', true); return; }
        b.disabled = true; poserMessage(msg, 'Création…');
        global.DB.creerFamille({ nom: nom, canal: inCanal.value.trim() || null })
          .then(function () { fermer(); return rafraichirTout(); })
          .catch(function (e) {
            poserMessage(msg, 'Création impossible : ' + messageLisible(e), true);
            b.disabled = false;
          });
      };
      form.appendChild(b);
      form.appendChild(msg);
      feuille.appendChild(form);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Barèmes de rémunération (C5)                                        */
  /* ------------------------------------------------------------------ */

  function sectionBaremes(contrat) {
    var det = ce('details', 'bloc-pliant');
    det.appendChild(ce('summary', null, 'Barèmes de rémunération'));
    var corps = ce('div', 'form-colonne');
    corps.textContent = 'Chargement…';
    det.appendChild(corps);

    var charge = false;
    det.addEventListener('toggle', function () {
      if (!det.open || charge) return;
      charge = true;
      rendreBaremes(corps, contrat);
    });
    return det;
  }

  function rendreBaremes(corps, contrat) {
    vider(corps);
    corps.textContent = 'Chargement…';
    Promise.all([
      global.DB.getSalaires(contrat.id),
      global.DB.listRecapsContrat(contrat.id)
    ]).then(function (res) {
      var salaires = (res[0] || []).slice().sort(function (a, b) {
        return a.date_effet < b.date_effet ? 1 : (a.date_effet > b.date_effet ? -1 : 0);
      });
      var recaps = res[1] || [];
      vider(corps);

      var enVigueur = global.Engine.salaireApplicable(salaires, moisCourantUi().annee, moisCourantUi().mois);

      if (salaires.length === 0) {
        corps.appendChild(ce('p', 'vide',
          'Aucun barème. Sans barème, le récapitulatif de ce contrat ne peut pas être produit.'));
      }

      salaires.forEach(function (s) {
        var l = ce('div', 'bareme');
        var t = ce('div', 'bareme-t');
        t.appendChild(ce('strong', null, 'Depuis le ' + dateFr(s.date_effet)));
        if (enVigueur && enVigueur.id === s.id) t.appendChild(ce('span', 'badge-fige', 'En vigueur'));
        l.appendChild(t);
        l.appendChild(ce('div', 'bareme-m',
          'Brut ' + eur(s.brut_mensuel_centimes) + ' · Net ' +
          (s.net_mensuel_centimes ? eur(s.net_mensuel_centimes) : 'non renseigné')));
        if (!s.net_mensuel_centimes) {
          l.appendChild(ce('p', 'alerte',
            'Net manquant : les récapitulatifs des mois concernés seront incomplets. ' +
            'Le net figure sur la fiche de paie du premier mois concerné.'));
        }
        var acts = ce('div', 'form-actions');
        var bMod = ce('button', 'btn btn-secondaire', 'Modifier');
        bMod.onclick = function () { formulaireBareme(contrat, s, salaires, recaps, corps); };
        var bSup = ce('button', 'btn btn-secondaire', 'Supprimer');
        bSup.onclick = function () { supprimerBareme(contrat, s, salaires, recaps, corps); };
        acts.appendChild(bMod); acts.appendChild(bSup);
        l.appendChild(acts);
        corps.appendChild(l);
      });

      var bNouveau = ce('button', 'btn btn-primary btn-bloc', 'Nouveau barème');
      bNouveau.onclick = function () { formulaireBareme(contrat, null, salaires, recaps, corps); };
      corps.appendChild(bNouveau);
    }).catch(function (e) {
      corps.textContent = 'Barèmes indisponibles : ' + messageLisible(e);
    });
  }

  function moisCourantUi() {
    return global.App ? global.App.moisCourant() : (function () {
      var d = new Date(); return { annee: d.getFullYear(), mois: d.getMonth() + 1 };
    })();
  }

  /* Garde-fous C5. La protection des récapitulatifs passés ne repose pas sur
     salaireApplicable seul : elle tient tant que les dates d'effet sont dans
     le futur. Une date rétroactive changerait les mois non encore figés.
       - un mois FIGÉ serait touché  -> refus, avec explication ;
       - un mois en BROUILLON serait touché -> avertissement + confirmation. */
  /* Premier mois RÉELLEMENT touché par une date d'effet.

     On n'invente aucune règle : RG-15, tel qu'implémenté par
     Engine.salaireApplicable, retient un barème pour un mois dès lors que
     `date_effet <= premier jour du mois`. C'est exactement ce test qui est
     appliqué ici, en partant du mois de la date d'effet. Conséquence : une
     date au 15 septembre ne touche pas septembre mais octobre — refuser à
     cause d'un septembre figé serait un faux refus. */
  function premierMoisImpacte(dateEffet) {
    var m = Chaine.moisDeDate(dateEffet);
    if (dateEffet <= Chaine.premierJour(m.annee, m.mois)) return m;
    return Chaine.moisSuivant(m.annee, m.mois);
  }

  function analyserDateEffet(dateEffet, recaps) {
    var m = premierMoisImpacte(dateEffet);
    var figes = [], brouillons = [];
    (recaps || []).forEach(function (r) {
      if (Chaine.cmpMois(r.annee, r.mois, m.annee, m.mois) < 0) return;  // mois antérieur : intact
      if (r.statut === 'fige') figes.push(r); else brouillons.push(r);
    });
    var tri = function (a, b) { return Chaine.cmpMois(a.annee, a.mois, b.annee, b.mois); };
    figes.sort(tri); brouillons.sort(tri);
    return { figes: figes, brouillons: brouillons };
  }

  function listeMois(rs) {
    return rs.map(function (r) { return Chaine.libelleMoisAnnee(r.annee, r.mois); }).join(', ');
  }

  /* Un barème est « utilisé par un récap figé » si, pour au moins un mois
     figé, c'est lui que RG-15 (Engine.salaireApplicable) retient. On ne
     recalcule rien : on interroge le moteur. */
  function baremeUtiliseParUnFige(bareme, salaires, recaps) {
    var utilises = [];
    (recaps || []).forEach(function (r) {
      if (r.statut !== 'fige') return;
      var applicable = global.Engine.salaireApplicable(salaires, r.annee, r.mois);
      if (applicable && applicable.id === bareme.id) utilises.push(r);
    });
    return utilises;
  }

  function formulaireBareme(contrat, bareme, salaires, recaps, corps) {
    var creation = !bareme;
    ouvrirFeuille((creation ? 'Nouveau barème' : 'Modifier le barème') + ' — ' + contrat.prenom_enfant,
      function (feuille, fermer) {
        var form = ce('div', 'form-colonne');
        var inDate = champ(form, 'Date d’effet',
          inputTexte(bareme ? bareme.date_effet : premierJourMoisProchain(), 'date'),
          'Le barème s’applique aux mois dont le 1er jour est postérieur ou égal à cette date.');
        var inBrut = champ(form, 'Brut mensuel (€)',
          inputTexte(bareme ? (bareme.brut_mensuel_centimes / 100).toFixed(2).replace('.', ',') : ''));
        var inNet = champ(form, 'Net mensuel (€)',
          inputTexte(bareme && bareme.net_mensuel_centimes
            ? (bareme.net_mensuel_centimes / 100).toFixed(2).replace('.', ',') : ''),
          'Le net n’est pas calculable depuis le brut (cotisations, CSG, exonération ' +
          'des heures supplémentaires). Il se lit sur la fiche de paie du premier mois concerné.');
        var msg = ce('div', 'msg-absence');

        var b = ce('button', 'btn btn-primary btn-bloc', creation ? 'Enregistrer le barème' : 'Enregistrer');
        b.onclick = function () {
          poserMessage(msg, '');    // pas de message d'erreur périmé d'une tentative précédente
          var dateEffet = inDate.value;
          if (!dateEffet) { poserMessage(msg, 'La date d’effet est obligatoire.', true); return; }
          var brut = parseEuros(inBrut.value);
          if (brut == null) { poserMessage(msg, 'Brut mensuel illisible (ex. « 1 950,00 »).', true); return; }
          var netSaisi = parseEuros(inNet.value);

          // Doublon de date d'effet (contrainte unique en base) : message clair.
          var doublon = salaires.filter(function (s) {
            return s.date_effet === dateEffet && (!bareme || s.id !== bareme.id);
          });
          if (doublon.length) {
            poserMessage(msg, 'Un barème existe déjà au ' + dateFr(dateEffet) +
              ' pour ce contrat. Modifiez-le plutôt que d’en créer un second.', true);
            return;
          }

          // Modifier un barème dont dépend un récap figé reviendrait à
          // réécrire ce récap : même interdit que la suppression.
          if (!creation) {
            var utilises = baremeUtiliseParUnFige(bareme, salaires, recaps);
            if (utilises.length) {
              poserMessage(msg, 'Ce barème sert aux récapitulatifs figés de ' + listeMois(utilises) +
                '. Ces documents sont partis chez les parents : ils ne peuvent plus changer. ' +
                'Créez plutôt un nouveau barème à une date d’effet postérieure.', true);
              return;
            }
          }

          var analyse = analyserDateEffet(dateEffet, recaps);
          if (analyse.figes.length) {
            poserMessage(msg, 'Impossible : cette date d’effet toucherait le(s) récapitulatif(s) figé(s) de ' +
              listeMois(analyse.figes) + '. Ces récapitulatifs sont partis chez les parents et ne peuvent plus ' +
              'être recalculés. Choisissez une date d’effet postérieure au dernier mois figé.', true);
            return;
          }
          if (analyse.brouillons.length &&
              !global.confirm('Le récapitulatif de ' + listeMois(analyse.brouillons) +
                ' est encore en brouillon : il sera recalculé avec ce nouveau barème. Continuer ?')) {
            return;
          }
          if (netSaisi == null &&
              !global.confirm('Le net n’est pas renseigné. Le barème sera enregistré avec le brut seul, ' +
                'et les récapitulatifs des mois concernés seront incomplets tant que le net manque. Continuer ?')) {
            return;
          }

          b.disabled = true; poserMessage(msg, 'Enregistrement…');
          var champsSaisis = {
            date_effet: dateEffet,
            brut_mensuel_centimes: brut,
            net_mensuel_centimes: netSaisi == null ? 0 : netSaisi
          };
          var p = creation
            ? global.DB.ajouterSalaire(contrat.id, champsSaisis)
            : global.DB.majSalaire(bareme.id, champsSaisis);
          p.then(function () { fermer(); rendreBaremes(corps, contrat); return rafraichirRecap(); })
            .catch(function (e) {
              poserMessage(msg, 'Enregistrement impossible : ' + messageLisible(e), true);
              b.disabled = false;
            });
        };
        form.appendChild(b);
        form.appendChild(msg);
        feuille.appendChild(form);
      });
  }

  function premierJourMoisProchain() {
    var m = moisCourantUi();
    var s = Chaine.moisSuivant(m.annee, m.mois);
    return Chaine.premierJour(s.annee, s.mois);
  }

  function supprimerBareme(contrat, bareme, salaires, recaps, corps) {
    var utilises = baremeUtiliseParUnFige(bareme, salaires, recaps);
    var msg = document.getElementById('msg-familles');
    if (utilises.length) {
      poserMessage(msg, 'Suppression refusée : ce barème est celui appliqué aux récapitulatifs figés de ' +
        listeMois(utilises) + '. Les supprimer reviendrait à effacer la justification de documents ' +
        'déjà remis aux parents.', true);
      return;
    }
    if (!global.confirm('Supprimer le barème du ' + dateFr(bareme.date_effet) + ' ? ' +
        'Les mois qui s’appuyaient dessus repasseront au barème précédent.')) return;
    global.DB.supprimerSalaire(bareme.id)
      .then(function () { poserMessage(msg, 'Barème supprimé.'); rendreBaremes(corps, contrat); return rafraichirRecap(); })
      .catch(function (e) { poserMessage(msg, 'Suppression impossible : ' + messageLisible(e), true); });
  }

  /* Saisie groupée (C5) : le SMIC bouge pour tous les contrats en même temps.
     Un seul geste, avec possibilité de corriger un montant contrat par
     contrat — les montants actuels sont d'ailleurs appelés à converger. */
  function formulaireBaremeGroupe() {
    var actifs = etat.contrats.filter(function (c) { return !c.archive; });
    if (actifs.length === 0) {
      poserMessage(document.getElementById('msg-familles'), 'Aucun contrat actif.', true);
      return;
    }
    ouvrirFeuille('Nouveau barème pour plusieurs contrats', function (feuille, fermer) {
      var form = ce('div', 'form-colonne');
      form.appendChild(ce('p', 'aide',
        'Saisissez la date d’effet et les montants communs, puis corrigez contrat par contrat si besoin.'));
      var inDate = champ(form, 'Date d’effet (commune)', inputTexte(premierJourMoisProchain(), 'date'));
      var inBrut = champ(form, 'Brut mensuel commun (€)', inputTexte(''));
      var inNet = champ(form, 'Net mensuel commun (€)', inputTexte(''),
        'Se lit sur la fiche de paie du premier mois concerné. Peut rester vide.');
      var bAppliquer = ce('button', 'btn btn-secondaire btn-bloc', 'Reporter sur tous les contrats');

      var lignes = [];
      var listeEl = ce('div', 'form-colonne');
      actifs.forEach(function (ct) {
        var l = ce('div', 'bareme form-colonne');
        var lblC = ce('label', 'case');
        var cb = ce('input'); cb.type = 'checkbox'; cb.checked = true;
        lblC.appendChild(cb);
        lblC.appendChild(ce('span', null, ' ' + ct.prenom_enfant +
          (ct.famille && ct.famille.nom ? ' · ' + ct.famille.nom : '')));
        l.appendChild(lblC);
        var inB = champ(l, 'Brut (€)', inputTexte(''));
        var inN = champ(l, 'Net (€)', inputTexte(''));
        var etatEl = ce('div', 'msg-absence');
        l.appendChild(etatEl);
        listeEl.appendChild(l);
        lignes.push({ contrat: ct, coche: cb, brut: inB, net: inN, etat: etatEl });
      });

      bAppliquer.onclick = function () {
        lignes.forEach(function (li) {
          if (!li.coche.checked) return;
          li.brut.value = inBrut.value;
          li.net.value = inNet.value;
        });
      };
      form.appendChild(bAppliquer);
      form.appendChild(listeEl);

      var msg = ce('div', 'msg-absence');
      var b = ce('button', 'btn btn-primary btn-bloc', 'Enregistrer les barèmes');
      b.onclick = function () {
        var dateEffet = inDate.value;
        if (!dateEffet) { poserMessage(msg, 'La date d’effet est obligatoire.', true); return; }
        var choisies = lignes.filter(function (li) { return li.coche.checked; });
        if (!choisies.length) { poserMessage(msg, 'Cochez au moins un contrat.', true); return; }
        b.disabled = true; poserMessage(msg, 'Vérification des récapitulatifs figés…');

        // On vérifie CHAQUE contrat avant d'écrire quoi que ce soit : un
        // enregistrement partiel serait pire que pas d'enregistrement.
        Promise.all(choisies.map(function (li) {
          return Promise.all([
            global.DB.getSalaires(li.contrat.id),
            global.DB.listRecapsContrat(li.contrat.id)
          ]).then(function (r) {
            var brut = parseEuros(li.brut.value);
            var net = parseEuros(li.net.value);
            var analyse = analyserDateEffet(dateEffet, r[1]);
            var doublon = (r[0] || []).some(function (s) { return s.date_effet === dateEffet; });
            var refus = null;
            if (brut == null) refus = 'brut illisible';
            else if (doublon) refus = 'un barème existe déjà au ' + dateFr(dateEffet);
            else if (analyse.figes.length) refus = 'récapitulatif figé : ' + listeMois(analyse.figes);
            return { li: li, brut: brut, net: net, refus: refus, brouillons: analyse.brouillons };
          });
        })).then(function (verifs) {
          var refuses = verifs.filter(function (v) { return v.refus; });
          refuses.forEach(function (v) { poserMessage(v.li.etat, 'Refusé — ' + v.refus + '.', true); });
          var acceptes = verifs.filter(function (v) { return !v.refus; });
          if (!acceptes.length) {
            poserMessage(msg, 'Aucun barème enregistrable : voir le détail contrat par contrat.', true);
            b.disabled = false; return null;
          }
          var brouillons = [];
          acceptes.forEach(function (v) { brouillons = brouillons.concat(v.brouillons); });
          if (brouillons.length &&
              !global.confirm('Des récapitulatifs encore en brouillon (' + listeMois(brouillons) +
                ') seront recalculés avec ce barème. Continuer ?')) {
            b.disabled = false; return null;
          }
          var sansNet = acceptes.filter(function (v) { return v.net == null; });
          if (sansNet.length &&
              !global.confirm('Le net n’est pas renseigné pour ' + sansNet.length + ' contrat(s). ' +
                'Le barème sera enregistré avec le brut seul, et les récapitulatifs des mois ' +
                'concernés seront incomplets tant que le net manque. Continuer ?')) {
            b.disabled = false; return null;
          }
          poserMessage(msg, 'Enregistrement de ' + acceptes.length + ' barème(s)…');
          return Promise.all(acceptes.map(function (v) {
            return global.DB.ajouterSalaire(v.li.contrat.id, {
              date_effet: dateEffet,
              brut_mensuel_centimes: v.brut,
              net_mensuel_centimes: v.net == null ? 0 : v.net
            }).then(function () { poserMessage(v.li.etat, 'Enregistré.'); return true; })
              .catch(function (e) { poserMessage(v.li.etat, 'Échec — ' + messageLisible(e), true); return false; });
          })).then(function (rs) {
            var ok = rs.filter(Boolean).length;
            poserMessage(msg, ok + ' barème(s) enregistré(s)' +
              (refuses.length ? ', ' + refuses.length + ' refusé(s)' : '') + '.');
            b.disabled = false;
            if (ok) { fermer(); return rafraichirTout(); }
            return null;
          });
        }).catch(function (e) {
          poserMessage(msg, 'Enregistrement impossible : ' + messageLisible(e), true);
          b.disabled = false;
        });
      };
      form.appendChild(b);
      form.appendChild(msg);
      feuille.appendChild(form);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Historique des récapitulatifs (C4)                                  */
  /* ------------------------------------------------------------------ */

  function sectionHistorique(contrat) {
    var det = ce('details', 'bloc-pliant');
    det.appendChild(ce('summary', null, 'Historique des récapitulatifs'));
    var corps = ce('div', 'form-colonne');
    corps.textContent = 'Chargement…';
    det.appendChild(corps);

    var charge = false;
    det.addEventListener('toggle', function () {
      if (!det.open || charge) return;
      charge = true;
      global.DB.listRecapsContrat(contrat.id).then(function (recaps) {
        vider(corps);
        if (!recaps || !recaps.length) {
          corps.appendChild(ce('p', 'vide', 'Aucun récapitulatif enregistré pour ce contrat.'));
          return;
        }
        recaps.forEach(function (r) {
          var b = ce('button', 'btn btn-secondaire btn-bloc',
            Chaine.libelleMoisAnnee(r.annee, r.mois) + ' — ' +
            (r.statut === 'fige' ? 'figé le ' + dateFr(r.fige_le) : 'brouillon'));
          b.onclick = function () {
            if (global.App) global.App.ouvrirRecapMois(r.annee, r.mois);
          };
          corps.appendChild(b);
        });
      }).catch(function (e) {
        corps.textContent = 'Historique indisponible : ' + messageLisible(e);
      });
    });
    return det;
  }

  /* ------------------------------------------------------------------ */
  /* Archivage (C3)                                                      */
  /* ------------------------------------------------------------------ */

  function sectionArchivage(famille, contrat) {
    var det = ce('details', 'bloc-pliant');
    det.appendChild(ce('summary', null, contrat.archive ? 'Désarchiver' : 'Archiver ce contrat'));
    var corps = ce('div', 'form-colonne');

    corps.appendChild(ce('p', 'aide',
      'Trois notions distinctes, jamais confondues : le STATUT décrit la relation de travail, ' +
      'la DATE DE FIN conditionne les calculs, l’ARCHIVAGE n’est qu’un rangement visuel. ' +
      'Un contrat terminé n’est pas forcément archivé — vous pouvez vouloir consulter son solde ' +
      'pendant des mois. Rien n’est jamais supprimé, et l’archivage n’est jamais automatique.'));

    if (contrat.archive) {
      var msgD = ce('div', 'msg-absence');
      var bD = ce('button', 'btn btn-primary btn-bloc', 'Désarchiver ce contrat');
      bD.onclick = function () {
        bD.disabled = true; poserMessage(msgD, 'Désarchivage…');
        global.DB.desarchiverContrat(contrat.id)
          .then(rafraichirTout)
          .catch(function (e) {
            poserMessage(msgD, 'Désarchivage impossible : ' + messageLisible(e), true);
            bD.disabled = false;
          });
      };
      corps.appendChild(bD);
      corps.appendChild(msgD);
      corps.appendChild(ce('p', 'aide',
        'Le désarchivage ne touche qu’au rangement : la date de fin et le statut restent inchangés.'));
      det.appendChild(corps);
      return det;
    }

    var inFin = champ(corps, 'Date de fin du contrat',
      inputTexte(contrat.date_fin || aujourdhui(), 'date'),
      'C’est elle qui borne les calculs. L’archivage la renseigne et passe le statut à « terminé ».');

    /* Les mois déjà figés du contrat : sert à prévenir Maria si la date de fin
       tombe dans l'un d'eux (le document figé ne sera pas recalculé). */
    var moisFigeDeLaDateFin = null;
    var moisFiges = {};
    global.DB.listRecapsContrat(contrat.id).then(function (recaps) {
      (recaps || []).forEach(function (r) {
        if (r.statut === 'fige') moisFiges[Chaine.cleMois(r.annee, r.mois)] = true;
      });
      majAvertissementFin();
    }).catch(function () { /* l'avertissement est un confort, pas un garde-fou */ });

    function majAvertissementFin() {
      var cle = (inFin.value || '').slice(0, 7);
      moisFigeDeLaDateFin = moisFiges[cle] ? cle : null;
    }
    inFin.onchange = majAvertissementFin;
    var soldes = ce('div', 'soldes');
    var msg = ce('div', 'msg-absence');

    var bSoldes = ce('button', 'btn btn-secondaire btn-bloc', 'Calculer les soldes de fin de contrat');
    bSoldes.onclick = function () {
      if (!inFin.value) { poserMessage(msg, 'Renseignez la date de fin.', true); return; }
      afficherSoldesFinContrat(soldes, contrat, inFin.value, msg);
    };
    corps.appendChild(bSoldes);
    corps.appendChild(soldes);

    var bArchiver = ce('button', 'btn btn-primary btn-bloc', 'Archiver ce contrat');
    bArchiver.onclick = function () {
      if (!inFin.value) { poserMessage(msg, 'Renseignez la date de fin.', true); return; }
      if (inFin.value < contrat.date_debut) {
        poserMessage(msg, 'La date de fin ne peut pas précéder la date de début.', true); return;
      }
      if (moisFigeDeLaDateFin && inFin.value.slice(0, 7) === moisFigeDeLaDateFin &&
          !global.confirm('Le récapitulatif de ' +
            Chaine.libelleMoisAnnee(Number(moisFigeDeLaDateFin.slice(0, 4)), Number(moisFigeDeLaDateFin.slice(5, 7))) +
            ' est déjà figé.\n\nIl a été calculé sans cette date de fin et ne sera PAS recalculé : ' +
            'le document parti chez les parents fait foi. Seuls les récapitulatifs de période ' +
            'tiendront compte de la date de fin.\n\nContinuer ?')) { return; }
      if (!global.confirm('Archiver ' + contrat.prenom_enfant + ' au ' + dateFr(inFin.value) + ' ?\n\n' +
          'Le contrat passe au statut « terminé », sort des écrans courants et de la saisie. ' +
          'Rien n’est supprimé : il restera visible dans les récapitulatifs des mois qu’il couvrait, ' +
          'et vous pourrez le désarchiver.\n\n' +
          'RG-13 — avez-vous noté les deux soldes de fin de contrat ? (congés payés sans majoration, ' +
          'heures supplémentaires majorées de 50 %)')) return;
      bArchiver.disabled = true; poserMessage(msg, 'Archivage…');
      global.DB.archiverContrat(contrat.id, inFin.value)
        .then(rafraichirTout)
        .catch(function (e) {
          poserMessage(msg, 'Archivage impossible : ' + messageLisible(e), true);
          bArchiver.disabled = false;
        });
    };
    corps.appendChild(bArchiver);
    corps.appendChild(msg);
    det.appendChild(corps);
    return det;
  }

  /* RG-13 — l'archivage est le seul moment où le solde de fin de contrat se
     calcule naturellement ; passé sous silence, il serait oublié. On affiche
     les deux soldes (heures sup et congés payés) au dernier mois du contrat,
     et un montant INDICATIF obtenu par Engine.montantCentimes — la seule
     fonction du moteur qui porte la majoration de RG-13. Aucune formule n'est
     réécrite ici, et rien n'est enregistré : Maria note les montants. */
  function afficherSoldesFinContrat(cible, contrat, dateFin, msg) {
    vider(cible);
    cible.textContent = 'Calcul des soldes…';
    var m = Chaine.moisDeDate(dateFin);

    // Copie du contrat bornée à la date de fin saisie : le moteur doit voir
    // la fin de contrat pour ne pas compter des jours au-delà.
    var contratSimule = {};
    Object.keys(contrat).forEach(function (k) { contratSimule[k] = contrat[k]; });
    contratSimule.date_fin = dateFin;

    Promise.all([
      Chaine.mois1(contratSimule, m.annee, m.mois),
      global.DB.getSalaires(contrat.id)
    ]).then(function (res) {
      var entree = res[0];
      var salaires = res[1] || [];
      vider(cible);
      if (!entree) {
        cible.appendChild(ce('p', 'vide', 'Aucun mois calculable jusqu’à cette date.'));
        return;
      }
      var cs = entree.compteurSortie || {};
      var minutesSup = cs.minutesSup || 0;
      var dixiemesCp = (cs.dixiemesCpAcquis || 0) - (cs.dixiemesCpPris || 0);

      cible.appendChild(ce('h4', null, 'Soldes au ' + dateFr(dateFin) + ' (RG-13)'));
      var l1 = ce('div', 'recap-ligne');
      l1.appendChild(ce('span', 'recap-lib', 'Solde d’heures supplémentaires'));
      l1.appendChild(ce('span', 'recap-val', heures(minutesSup)));
      cible.appendChild(l1);
      var l2 = ce('div', 'recap-ligne');
      l2.appendChild(ce('span', 'recap-lib', 'Solde de congés payés'));
      l2.appendChild(ce('span', 'recap-val', joursCp(dixiemesCp)));
      cible.appendChild(l2);

      var salaire = global.Engine.salaireApplicable(salaires, m.annee, m.mois);
      /* Valorisation des heures supplémentaires : Engine.montantCentimes avec
         le coefficient 1,5, c'est-à-dire EXACTEMENT la formule de RG-13 déjà
         validée par le test T6 du moteur. Rien n'est réécrit ici.
         La valorisation du solde de CONGÉS PAYÉS n'est en revanche définie
         nulle part — ni dans le cahier des charges, ni dans le moteur. On ne
         l'invente pas dans un écran : le solde en jours est affiché, à Maria
         de le valoriser avec sa convention de paie.
         // TODO RÈGLE ABSENTE : valorisation monétaire du solde de CP à la fin
         // d'un contrat (RG-13 dit « payé sans majoration », sans dire sur
         // quelle assiette). À trancher avec Maria. */
      if (salaire) {
        var montantSup = global.Engine.montantCentimes(
          salaire.brut_mensuel_centimes, Math.max(0, minutesSup), 1.5);
        var l3 = ce('div', 'recap-ligne');
        l3.appendChild(ce('span', 'recap-lib', 'Heures sup, majorées de 50 % (indicatif)'));
        l3.appendChild(ce('span', 'recap-val', eur(montantSup)));
        cible.appendChild(l3);
        cible.appendChild(ce('p', 'aide',
          'Montant indicatif calculé au taux horaire brut du barème en vigueur ' +
          '(depuis le ' + dateFr(salaire.date_effet) + '). Rien n’est enregistré : notez-le.'));
      }
      cible.appendChild(ce('p', 'aide',
        'RG-13 : à la fin du contrat, le solde de congés payés est payé SANS majoration et ' +
        'le solde d’heures supplémentaires avec une majoration de 50 %. Le montant du solde de ' +
        'congés payés n’est pas calculé ici : l’assiette n’est pas définie au cahier des charges.'));
      if (!entree.fige) {
        cible.appendChild(ce('p', 'aide',
          'Le dernier mois n’est pas encore figé : ces soldes sont provisoires tant qu’il ne l’est pas.'));
      }
    }).catch(function (e) {
      vider(cible);
      poserMessage(msg, 'Calcul des soldes impossible : ' + messageLisible(e), true);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Feuille modale                                                      */
  /* ------------------------------------------------------------------ */

  function ouvrirFeuille(titre, remplir) {
    fermerFeuille();
    var overlay = ce('div', 'overlay'); overlay.id = 'overlay-familles';
    overlay.onclick = function (e) { if (e.target === overlay) fermerFeuille(); };
    var feuille = ce('div', 'feuille');
    feuille.appendChild(ce('h4', null, titre));
    remplir(feuille, fermerFeuille);
    var fermer = ce('button', 'btn btn-secondaire btn-bloc', 'Fermer');
    fermer.onclick = fermerFeuille;
    feuille.appendChild(fermer);
    overlay.appendChild(feuille);
    document.body.appendChild(overlay);
  }

  function fermerFeuille() {
    var o = document.getElementById('overlay-familles');
    if (o && o.parentNode) o.parentNode.removeChild(o);
  }

  /* ------------------------------------------------------------------ */
  /* Rafraîchissements                                                   */
  /* ------------------------------------------------------------------ */

  /* Un changement de barème modifie les montants du récap : on redessine le
     mois affiché plutôt que de laisser à l'écran des chiffres périmés. */
  function rafraichirRecap() {
    if (!global.UiRecap) return Promise.resolve();
    if (global.UiRecap.oublierBornes) global.UiRecap.oublierBornes();
    if (global.UiRecap.rafraichir) {
      return global.UiRecap.rafraichir().catch(function () { return null; });
    }
    return Promise.resolve();
  }

  function rafraichirTout() {
    return afficher().then(function () {
      if (global.App && global.App.rechargerContrats) {
        return global.App.rechargerContrats().catch(function () { return null; });
      }
      return null;
    });
  }

  /* ------------------------------------------------------------------ */

  function init(opts) {
    etat.conteneur = opts.conteneur;
  }

  global.UiFamilles = { init: init, afficher: afficher };
})(window);
