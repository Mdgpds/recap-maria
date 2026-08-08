/* ============================================================================
   ui-periode.js — Récapitulatif sur une large période (lot 5, correctif C6).

   INTERDIT ABSOLU, ET C'EST LE CŒUR DE CE FICHIER : aucun second moteur de
   calcul. Une période n'est rien d'autre qu'une AGRÉGATION de résultats
   mensuels produits par Engine.calculerMois(), enchaînés par chaine-mois.js.
   Toute formule qui calculerait directement sur la période créerait une
   seconde source de vérité, qui divergerait des récapitulatifs mensuels déjà
   envoyés aux parents.

   Le piège central : ce qui s'additionne et ce qui ne s'additionne pas.
   S'additionnent les FLUX (présences, entretien, heures sup acquises, congés
   décomptés, retenues, salaires, total versé). Ne s'additionnent JAMAIS les
   COMPTEURS : le solde d'heures sup et de congés payés à la fin de la période
   est celui du DERNIER mois. On affiche le solde d'entrée au début et le
   solde de sortie à la fin. La règle est portée par
   ChaineMois.agregerPeriode(), testée sous Node.

   Le récapitulatif de période ne se fige pas : c'est une vue dérivée des mois
   qui la composent. Deux niveaux d'immuabilité pourraient diverger ; un seul
   fait foi, celui du mois.
   ========================================================================= */
(function (global) {
  'use strict';

  var Format = global.Format;
  var Chaine = global.ChaineMois;

  /* Borne explicite (jamais de troncature silencieuse) : au-delà, le nombre
     de mois rejoués devient déraisonnable sur un téléphone. */
  var MAX_MOIS_PERIODE = 60;

  var etat = {
    conteneur: null,
    contrats: [],
    resultats: null
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
  function eur(c) { return Format ? Format.centimesEnEuros(c) : (c / 100).toFixed(2) + ' €'; }
  function heures(min) { return Format ? Format.minutesEnHeures(min) : min + ' min'; }
  function joursCp(dix) { return Format ? Format.dixiemesEnJours(dix) : (dix / 10) + ' j'; }
  function dateFr(iso) {
    if (!iso) return '—';
    var p = String(iso).slice(0, 10).split('-');
    return p[2] + '/' + p[1] + '/' + p[0];
  }
  function moisCourant() {
    if (global.App) return global.App.moisCourant();
    var d = new Date();
    return { annee: d.getFullYear(), mois: d.getMonth() + 1 };
  }
  function messageLisible(e) {
    var brut = (e && (e.message || e.details)) || String(e);
    if (/row-level security|permission|42501/i.test(brut)) return 'accès refusé (reconnectez-vous).';
    if (/Failed to fetch|NetworkError/i.test(brut)) return 'connexion indisponible, réessayez.';
    return brut;
  }
  function ligne(parent, libelle, valeur, fort) {
    var l = ce('div', 'recap-ligne' + (fort ? ' recap-fort' : ''));
    l.appendChild(ce('span', 'recap-lib', libelle));
    l.appendChild(ce('span', 'recap-val', valeur));
    parent.appendChild(l);
  }
  function libellePeriode(debut, fin) {
    return Chaine.libelleMoisAnnee(debut.annee, debut.mois) + ' → ' +
           Chaine.libelleMoisAnnee(fin.annee, fin.mois);
  }

  /* ------------------------------------------------------------------ */
  /* Écran                                                               */
  /* ------------------------------------------------------------------ */

  function afficher() {
    if (!etat.conteneur) return Promise.resolve();
    etat.conteneur.textContent = 'Chargement…';
    return global.DB.listContratsTous().then(function (liste) {
      etat.contrats = liste || [];
      rendreFormulaire();
    }).catch(function (e) {
      etat.conteneur.textContent = 'Écran indisponible : ' + messageLisible(e);
    });
  }

  var champs = {};

  function rendreFormulaire() {
    var c = etat.conteneur;
    vider(c);

    var entete = ce('div', 'barre-mois');
    entete.appendChild(ce('h2', 'titre-mois', 'Récapitulatif de période'));
    c.appendChild(entete);

    var form = ce('section', 'bloc-absence-maria');
    form.appendChild(ce('p', 'aide',
      'Une période est l’addition des mois qui la composent — jamais un calcul séparé. ' +
      'Les mois figés sont repris tels quels ; les autres sont provisoires et signalés.'));

    var lignePeriode = ce('div', 'form-ligne');

    var lblType = ce('label', null, 'Période');
    champs.type = ce('select', 'in-type');
    [['bilan', 'Année de bilan (1er sept → 31 août)'],
     ['civile', 'Année civile'],
     ['contrat', 'Durée entière d’un contrat'],
     ['libre', 'Période libre']].forEach(function (o) {
      var op = ce('option', null, o[1]); op.value = o[0]; champs.type.appendChild(op);
    });
    lblType.appendChild(champs.type);
    lignePeriode.appendChild(lblType);

    var lblContrat = ce('label', null, 'Contrat');
    champs.contrat = ce('select', 'in-type');
    var opTous = ce('option', null, 'Tous les contrats'); opTous.value = '';
    champs.contrat.appendChild(opTous);
    etat.contrats.forEach(function (ct) {
      var op = ce('option', null, ct.prenom_enfant +
        (ct.famille && ct.famille.nom ? ' · ' + ct.famille.nom : '') +
        (ct.archive ? ' (archivé)' : ''));
      op.value = ct.id;
      champs.contrat.appendChild(op);
    });
    lblContrat.appendChild(champs.contrat);
    lignePeriode.appendChild(lblContrat);
    form.appendChild(lignePeriode);

    var bornes = ce('div', 'form-ligne'); bornes.id = 'bornes-periode';
    form.appendChild(bornes);
    champs.type.onchange = function () { rendreBornes(bornes); };
    rendreBornes(bornes);

    var actions = ce('div', 'form-actions');
    var bCalc = ce('button', 'btn btn-primary', 'Calculer');
    bCalc.onclick = function () { calculer(bCalc); };
    actions.appendChild(bCalc);
    form.appendChild(actions);

    var msg = ce('div', 'msg-absence'); msg.id = 'msg-periode';
    form.appendChild(msg);
    c.appendChild(form);

    var resultats = ce('div'); resultats.id = 'resultats-periode';
    c.appendChild(resultats);
  }

  function selectAnnee(valeur) {
    var s = ce('select', 'in-type');
    var m = moisCourant();
    var min = m.annee - 12, max = m.annee + 1;
    etat.contrats.forEach(function (ct) {
      if (ct.date_debut) min = Math.min(min, Number(String(ct.date_debut).slice(0, 4)));
    });
    for (var a = min; a <= max; a++) {
      var op = ce('option', null, String(a)); op.value = String(a);
      if (a === valeur) op.selected = true;
      s.appendChild(op);
    }
    return s;
  }
  function selectMois(valeur) {
    var s = ce('select', 'in-type');
    for (var m = 1; m <= 12; m++) {
      var op = ce('option', null, Chaine.libelleMois(m)); op.value = String(m);
      if (m === valeur) op.selected = true;
      s.appendChild(op);
    }
    return s;
  }

  function rendreBornes(bornes) {
    vider(bornes);
    var m = moisCourant();
    var type = champs.type.value;

    if (type === 'bilan') {
      var l = ce('label', null, 'Bilan de septembre');
      champs.anneeBilan = selectAnnee(m.mois >= 9 ? m.annee : m.annee - 1);
      l.appendChild(champs.anneeBilan);
      bornes.appendChild(l);
      bornes.appendChild(ce('p', 'aide', 'Du 1er septembre au 31 août — date de bilan du cahier des charges.'));
    } else if (type === 'civile') {
      var l2 = ce('label', null, 'Année');
      champs.anneeCivile = selectAnnee(m.annee);
      l2.appendChild(champs.anneeCivile);
      bornes.appendChild(l2);
    } else if (type === 'contrat') {
      bornes.appendChild(ce('p', 'aide',
        'Choisissez un contrat précis ci-dessus : la période va de sa date de début à sa date de fin ' +
        '(ou au mois courant s’il est toujours en cours). C’est ce document qui alimente le solde de ' +
        'fin de contrat (RG-13) et sert de pièce justificative en cas de désaccord après le départ.'));
    } else {
      var lD = ce('label', null, 'Du');
      champs.moisDebut = selectMois(1); lD.appendChild(champs.moisDebut);
      champs.anneeDebut = selectAnnee(m.annee); lD.appendChild(champs.anneeDebut);
      var lF = ce('label', null, 'Au');
      champs.moisFin = selectMois(m.mois); lF.appendChild(champs.moisFin);
      champs.anneeFin = selectAnnee(m.annee); lF.appendChild(champs.anneeFin);
      bornes.appendChild(lD); bornes.appendChild(lF);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Détermination de la période                                         */
  /* ------------------------------------------------------------------ */

  function contratChoisi() {
    var id = champs.contrat.value;
    if (!id) return null;
    return etat.contrats.filter(function (c) { return c.id === id; })[0] || null;
  }

  function periodeDemandee() {
    var type = champs.type.value;
    var m = moisCourant();
    if (type === 'bilan') {
      var a = Number(champs.anneeBilan.value);
      return { debut: { annee: a, mois: 9 }, fin: { annee: a + 1, mois: 8 },
               titre: 'Année de bilan ' + a + '–' + (a + 1) };
    }
    if (type === 'civile') {
      var y = Number(champs.anneeCivile.value);
      return { debut: { annee: y, mois: 1 }, fin: { annee: y, mois: 12 }, titre: 'Année ' + y };
    }
    if (type === 'contrat') {
      var ct = contratChoisi();
      if (!ct) return { erreur: 'Choisissez un contrat précis pour ce type de période.' };
      var d = Chaine.moisDeDate(ct.date_debut);
      var f = ct.date_fin ? Chaine.moisDeDate(ct.date_fin) : { annee: m.annee, mois: m.mois };
      return { debut: d, fin: f,
               titre: 'Durée du contrat de ' + ct.prenom_enfant + ' (' + dateFr(ct.date_debut) +
                      ' → ' + (ct.date_fin ? dateFr(ct.date_fin) : 'en cours') + ')' };
    }
    var debut = { annee: Number(champs.anneeDebut.value), mois: Number(champs.moisDebut.value) };
    var fin = { annee: Number(champs.anneeFin.value), mois: Number(champs.moisFin.value) };
    if (Chaine.cmpMois(debut.annee, debut.mois, fin.annee, fin.mois) > 0) {
      return { erreur: 'La fin de période précède son début.' };
    }
    return { debut: debut, fin: fin, titre: 'Période ' + libellePeriode(debut, fin) };
  }

  /* ------------------------------------------------------------------ */
  /* Calcul                                                              */
  /* ------------------------------------------------------------------ */

  function calculer(bouton) {
    var msg = document.getElementById('msg-periode');
    var cible = document.getElementById('resultats-periode');
    var p = periodeDemandee();
    if (p.erreur) { msg.textContent = p.erreur; return; }

    var nbMois = Chaine.nbMoisEntre(p.debut.annee, p.debut.mois, p.fin.annee, p.fin.mois);
    if (nbMois > MAX_MOIS_PERIODE) {
      msg.textContent = 'Période limitée à ' + MAX_MOIS_PERIODE + ' mois (' + nbMois +
        ' demandés). Choisissez une période plus courte — rien n’est tronqué en silence.';
      return;
    }

    var un = contratChoisi();
    var debutIso = Chaine.premierJour(p.debut.annee, p.debut.mois);
    var finIso = Chaine.dernierJour(p.fin.annee, p.fin.mois);

    bouton.disabled = true;
    msg.textContent = 'Calcul…';
    vider(cible);

    // Progression affichée seulement si le calcul dure : sur un mois ou deux,
    // un indicateur qui clignote est du bruit.
    var faits = 0, total = 0, lent = false;
    var progression = ce('p', 'aide', '');
    var minuteur = setTimeout(function () {
      lent = true;
      cible.appendChild(progression);
      majProgression();
    }, 1000);
    function majProgression() {
      if (lent) progression.textContent = 'Calcul en cours… ' + faits + ' mois rejoués' +
        (total ? ' sur ' + total : '') + '.';
    }

    var pContrats = un
      ? Promise.resolve([un])
      : global.DB.listContratsPourPeriode(debutIso, finIso);

    pContrats.then(function (contrats) {
      contrats = contrats || [];
      if (!contrats.length) {
        clearTimeout(minuteur);
        msg.textContent = '';
        cible.appendChild(ce('p', 'vide', 'Aucun contrat actif sur cette période.'));
        bouton.disabled = false;
        return null;
      }
      return Promise.all(contrats.map(function (ct) {
        return Chaine.serie(ct, p.fin, {
          depuis: p.debut,     // la chaîne doit couvrir toute la fenêtre demandée
          onProgress: function (fait, tot) {
            faits++;
            if (fait === 1) { total += tot; }
            majProgression();
          }
        }).then(function (s) {
          var fenetre = Chaine.fenetre(s, p.debut, p.fin);
          return {
            contrat: ct,
            mois: fenetre,
            agregat: Chaine.agregerPeriode(fenetre),
            tronquee: s.tronquee,
            /* Nombre de mois de la période que ce contrat ne couvre pas
               (contrat commencé après le début de la période, ou terminé
               avant sa fin). Sert à ne jamais laisser croire qu'un document
               couvre toute la période affichée alors qu'il n'en couvre
               qu'une partie. */
            moisDemandes: nbMois
          };
        });
      })).then(function (resultats) {
        clearTimeout(minuteur);
        msg.textContent = '';
        etat.resultats = { periode: p, contrats: resultats };
        rendreResultats(cible, p, resultats);
        bouton.disabled = false;
        return resultats;
      });
    }).catch(function (e) {
      clearTimeout(minuteur);
      msg.textContent = 'Calcul impossible : ' + messageLisible(e);
      bouton.disabled = false;
    });
  }

  /* ------------------------------------------------------------------ */
  /* Rendu des résultats                                                 */
  /* ------------------------------------------------------------------ */

  function rendreResultats(cible, p, resultats) {
    vider(cible);
    cible.appendChild(ce('h3', null, p.titre));

    var utiles = resultats.filter(function (r) { return r.agregat.nbMois > 0; });
    if (!utiles.length) {
      cible.appendChild(ce('p', 'vide', 'Aucun mois calculable sur cette période.'));
      return;
    }

    cible.appendChild(vueEnsemble(p, utiles));
    utiles.forEach(function (r) { cible.appendChild(documentContrat(p, r)); });
  }

  /* Vue d'ensemble, pour Maria seule : tous contrats confondus.
     Seuls les FLUX sont additionnés entre contrats. Les compteurs (soldes)
     restent affichés contrat par contrat — un solde global n'a pas de sens. */
  function vueEnsemble(p, resultats) {
    var carte = ce('section', 'carte-contrat');
    carte.appendChild(ce('h3', null, 'Vue d’ensemble — ' + resultats.length + ' contrat(s)'));
    carte.appendChild(ce('p', 'aide', libellePeriode(p.debut, p.fin) + ' · usage interne, non transmissible.'));

    var t = { presence: 0, entretien: 0, sup: 0, conges: 0, retenue: 0, net: 0, total: 0 };
    var provisoires = 0;
    resultats.forEach(function (r) {
      var a = r.agregat;
      t.presence += a.joursPresence;
      t.entretien += a.entretienCentimes;
      t.sup += a.minutesSupAcquises;
      t.conges += a.joursCongesDecomptes;
      t.retenue += a.retenueSansSoldeCentimes;
      t.net += a.salaireNetCentimes;
      t.total += a.totalAVerserCentimes;
      provisoires += a.moisProvisoires.length;
    });

    ligne(carte, 'Jours de présence', String(t.presence));
    ligne(carte, 'Indemnités d’entretien', eur(t.entretien));
    ligne(carte, 'Heures sup acquises', heures(t.sup));
    ligne(carte, 'Jours de congés décomptés', String(t.conges));
    if (t.retenue > 0) ligne(carte, 'Retenues sans solde', '-' + eur(t.retenue));
    ligne(carte, 'Salaires nets', eur(t.net));
    ligne(carte, 'Total versé', eur(t.total), true);

    if (provisoires > 0) {
      carte.appendChild(ce('p', 'alerte',
        provisoires + ' mois encore provisoire(s) dans ce total (récapitulatif non figé) : ' +
        'ces montants peuvent encore changer.'));
    }

    var liste = ce('div', 'form-colonne');
    resultats.forEach(function (r) {
      var a = r.agregat;
      liste.appendChild(ce('p', 'resume',
        r.contrat.prenom_enfant + (r.contrat.archive ? ' (archivé)' : '') + ' — ' +
        a.nbMois + ' mois · ' + a.joursPresence + ' présences · ' + eur(a.totalAVerserCentimes) +
        ' · solde sup ' + heures(a.compteurSortie ? a.compteurSortie.minutesSup : 0)));
    });
    carte.appendChild(liste);
    return carte;
  }

  /* Document par contrat, transmissible aux parents (mêmes formats que le
     récapitulatif mensuel : lecture à l'écran + texte prêt à copier). */
  function documentContrat(p, r) {
    var a = r.agregat;
    var ct = r.contrat;
    var carte = ce('section', 'carte-contrat');

    var entete = ce('div', 'recap-entete');
    entete.appendChild(ce('h3', null, nomContrat(r)));
    if (ct.archive) entete.appendChild(ce('span', 'badge-archive', 'Archivé'));
    carte.appendChild(entete);
    carte.appendChild(ce('p', 'aide', libellePeriode(p.debut, p.fin) + ' · ' + a.nbMois + ' mois'));

    if (r.tronquee) {
      carte.appendChild(ce('p', 'alerte',
        'Chaîne de mois tronquée à ' + Chaine.MAX_MOIS + ' mois : vérifiez la date de début du contrat.'));
    }
    /* Jamais de troncature silencieuse : si le contrat ne couvre qu'une partie
       de la période demandée, le document doit le dire lui-même. */
    if (r.moisDemandes && a.nbMois < r.moisDemandes) {
      carte.appendChild(ce('p', 'alerte',
        'Ce contrat ne couvre que ' + a.nbMois + ' des ' + r.moisDemandes +
        ' mois de la période demandée : les totaux ci-dessous ne portent que sur ces mois.'));
    }
    if (a.moisAvantInitialisation.length) {
      carte.appendChild(ce('p', 'alerte',
        a.moisAvantInitialisation.length + ' mois antérieur(s) à la reprise des compteurs (' +
        a.moisAvantInitialisation.map(function (m) { return Chaine.libelleMoisAnnee(m.annee, m.mois); }).join(', ') +
        ') : leurs jours et montants sont exacts, mais les soldes d’heures supplémentaires et de ' +
        'congés payés y repartent de zéro et ne sont pas significatifs.'));
    }

    ligne(carte, 'Jours de présence', String(a.joursPresence));
    ligne(carte, 'Indemnités d’entretien', eur(a.entretienCentimes));
    ligne(carte, 'Heures sup acquises', heures(a.minutesSupAcquises));
    if (a.joursCongesDecomptes > 0) {
      ligne(carte, 'Congés décomptés', a.joursCongesDecomptes + ' j ouvrables');
      ligne(carte, '— sur congés payés', String(a.imputation.joursSurCp) + ' j');
      ligne(carte, '— sur heures sup', String(a.imputation.joursSurSup) + ' j');
      if (a.imputation.joursSansSolde > 0) ligne(carte, '— en sans solde', String(a.imputation.joursSansSolde) + ' j');
    }
    if (a.retenueSansSoldeCentimes > 0) ligne(carte, 'Retenues sans solde', '-' + eur(a.retenueSansSoldeCentimes));
    ligne(carte, 'Salaires nets', eur(a.salaireNetCentimes));
    ligne(carte, 'Total versé sur la période', eur(a.totalAVerserCentimes), true);

    /* Les compteurs ne s'additionnent pas : entrée au début, sortie à la fin. */
    var ce0 = a.compteurEntree || { minutesSup: 0, dixiemesCpAcquis: 0, dixiemesCpPris: 0 };
    var cs = a.compteurSortie || ce0;
    carte.appendChild(ce('h4', null, 'Compteurs (soldes, jamais additionnés)'));
    ligne(carte, 'Solde heures sup à l’entrée', heures(ce0.minutesSup || 0));
    ligne(carte, 'Solde heures sup à la sortie', heures(cs.minutesSup || 0), true);
    ligne(carte, 'Solde congés payés à l’entrée', joursCp((ce0.dixiemesCpAcquis || 0) - (ce0.dixiemesCpPris || 0)));
    ligne(carte, 'Solde congés payés à la sortie', joursCp((cs.dixiemesCpAcquis || 0) - (cs.dixiemesCpPris || 0)), true);

    if (a.baremes.length > 1) {
      carte.appendChild(ce('h4', null, 'Barèmes appliqués sur la période'));
      a.baremes.forEach(function (b) {
        ligne(carte, 'Depuis le ' + dateFr(b.dateEffet) + ' (' + b.mois.length + ' mois)',
          eur(b.netMensuelCentimes) + ' net');
      });
    } else if (a.baremes.length === 1) {
      ligne(carte, 'Barème appliqué',
        eur(a.baremes[0].netMensuelCentimes) + ' net depuis le ' + dateFr(a.baremes[0].dateEffet));
    }

    if (a.moisProvisoires.length) {
      carte.appendChild(ce('p', 'alerte',
        'Mois encore provisoires (récapitulatif non figé) : ' +
        a.moisProvisoires.map(function (m) { return Chaine.libelleMoisAnnee(m.annee, m.mois); }).join(', ') +
        '. Ces montants peuvent encore changer.'));
    }
    carte.appendChild(ce('p', 'aide',
      'Ce récapitulatif de période ne se fige pas : il est dérivé des mois qui le composent, ' +
      'seuls ceux-ci font foi.'));

    var wa = ce('div', 'recap-wa');
    var ta = ce('textarea', 'wa-texte'); ta.readOnly = true; ta.rows = 12;
    ta.value = textePeriode(p, r);
    wa.appendChild(ta);
    var copier = ce('button', 'btn btn-secondaire btn-bloc', 'Copier pour WhatsApp');
    copier.onclick = function () { copierTexte(ta.value, copier); };
    wa.appendChild(copier);
    carte.appendChild(wa);
    return carte;
  }

  function nomContrat(r) {
    var ct = r.contrat;
    return ct.prenom_enfant + (ct.famille && ct.famille.nom ? ' · ' + ct.famille.nom : '');
  }

  function textePeriode(p, r) {
    var a = r.agregat;
    var ce0 = a.compteurEntree || { minutesSup: 0, dixiemesCpAcquis: 0, dixiemesCpPris: 0 };
    var cs = a.compteurSortie || ce0;
    var lignes = [
      'Récap de période — ' + nomContrat(r),
      libellePeriode(p.debut, p.fin) + ' (' + a.nbMois + ' mois)',
      '',
      'Présence : ' + a.joursPresence + ' jour(s)',
      'Entretien : ' + eur(a.entretienCentimes),
      'Heures sup acquises : ' + heures(a.minutesSupAcquises)
    ];
    if (a.joursCongesDecomptes > 0) {
      lignes.push('Congés pris : ' + a.joursCongesDecomptes + ' jour(s) ouvrable(s)' +
        ' (CP ' + a.imputation.joursSurCp + ' · sup ' + a.imputation.joursSurSup +
        ' · sans solde ' + a.imputation.joursSansSolde + ')');
    }
    if (a.retenueSansSoldeCentimes > 0) lignes.push('Retenues sans solde : -' + eur(a.retenueSansSoldeCentimes));
    lignes.push('Salaires nets : ' + eur(a.salaireNetCentimes));
    lignes.push('Total versé sur la période : ' + eur(a.totalAVerserCentimes));
    lignes.push('');
    lignes.push('Solde heures sup : ' + heures(ce0.minutesSup || 0) + ' au début → ' +
      heures(cs.minutesSup || 0) + ' à la fin');
    lignes.push('Solde congés payés : ' +
      joursCp((ce0.dixiemesCpAcquis || 0) - (ce0.dixiemesCpPris || 0)) + ' au début → ' +
      joursCp((cs.dixiemesCpAcquis || 0) - (cs.dixiemesCpPris || 0)) + ' à la fin');
    lignes.push('(les soldes ne s’additionnent pas : ce sont ceux du dernier mois)');
    if (a.baremes.length) {
      lignes.push('');
      lignes.push('Barème(s) appliqué(s) :');
      a.baremes.forEach(function (b) {
        lignes.push('- ' + eur(b.netMensuelCentimes) + ' net depuis le ' + dateFr(b.dateEffet) +
          ' (' + b.mois.length + ' mois)');
      });
    }
    if (a.moisProvisoires.length) {
      lignes.push('');
      lignes.push('Mois encore provisoires : ' +
        a.moisProvisoires.map(function (m) { return Chaine.libelleMoisAnnee(m.annee, m.mois); }).join(', '));
    }
    return lignes.join('\n');
  }

  function copierTexte(txt, bouton) {
    var ok = function () {
      var t = bouton.textContent; bouton.textContent = 'Copié ✓';
      setTimeout(function () { bouton.textContent = t; }, 1500);
    };
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

  /* ------------------------------------------------------------------ */

  function init(opts) { etat.conteneur = opts.conteneur; }

  global.UiPeriode = { init: init, afficher: afficher };
})(window);
