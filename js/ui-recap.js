/* ============================================================================
   ui-recap.js — Écran de récapitulatif mensuel (lot 4, corrigé au lot 5).

   Branche le moteur PUR du lot 1 (engine.js) sur les données lues via DB
   (db.js) : pour chaque contrat, affiche le récap du mois choisi, produit un
   texte prêt à copier dans WhatsApp, et permet de FIGER le mois
   (recap_mensuel, immuable — lot 2).

   Le cumul des compteurs (RG-12) n'est plus écrit ici : il vit dans
   js/chaine-mois.js, partagé avec le récap de période (C6), l'historique par
   famille (C4) et le solde de fin de contrat (C3). Une seule chaîne, un seul
   moteur.

   Corrections du lot 5 :
   - C4 : sélection directe du mois + de l'année, bornée aux données réelles ;
          les contrats affichés sont ceux ACTIFS PENDANT LE MOIS AFFICHÉ
          (listContratsPourMois), archivés compris — plus par leur rangement.
   - C2 : au figement, le prénom de l'enfant et le nom de la famille sont
          inscrits DANS l'instantané. Un renommage ultérieur ne réécrit donc
          plus les récapitulatifs déjà envoyés aux parents.
   - C5 : le barème appliqué et sa date d'effet sont affichés (et inscrits
          dans l'instantané) — sans quoi un parent comparant deux mois aux
          montants différents n'a aucun moyen de comprendre pourquoi.

   Ne parle jamais au réseau directement : tout passe par DB.
   Aucune règle de calcul ici : tout vient de Engine.
   ========================================================================= */
(function (global) {
  'use strict';

  var Format = global.Format;
  var Chaine = global.ChaineMois;

  var etat = {
    conteneur: null,
    contrats: [],
    annee: null,
    mois: null,
    bornes: null,     // { min: {annee,mois}, max: {annee,mois} } — cache
    sequence: 0       // jeton anti-course entre deux affichages successifs
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

  function moisLibelle(mois) { return Chaine.libelleMois(mois); }
  function eur(c) { return Format ? Format.centimesEnEuros(c) : (c / 100).toFixed(2) + ' €'; }
  function heures(min) { return Format ? Format.minutesEnHeures(min) : min + ' min'; }
  function jours(dix) { return Format ? Format.dixiemesEnJours(dix) : (dix / 10) + ' j'; }
  function dateFr(iso) {
    if (!iso) return '—';
    var p = String(iso).slice(0, 10).split('-');
    return p[2] + '/' + p[1] + '/' + p[0];
  }

  function moisCourant() {
    var d = new Date();
    return { annee: d.getFullYear(), mois: d.getMonth() + 1 };
  }

  /* ------------------------------------------------------------------ */
  /* Bornes de navigation (C4)                                           */
  /* ------------------------------------------------------------------ */

  /* Période réellement couverte par les données : du plus ancien début de
     contrat au plus tardif entre la fin de contrat la plus lointaine et le
     mois courant. Archivés compris — c'est justement eux qu'on cherche. */
  function chargerBornes() {
    if (etat.bornes) return Promise.resolve(etat.bornes);
    return global.DB.listContratsTous().then(function (tous) {
      var maintenant = moisCourant();
      var min = null, max = { annee: maintenant.annee, mois: maintenant.mois };
      (tous || []).forEach(function (c) {
        if (c.date_debut) {
          var d = Chaine.moisDeDate(c.date_debut);
          if (!min || Chaine.cmpMois(d.annee, d.mois, min.annee, min.mois) < 0) min = d;
        }
        if (c.date_fin) {
          var f = Chaine.moisDeDate(c.date_fin);
          if (Chaine.cmpMois(f.annee, f.mois, max.annee, max.mois) > 0) max = f;
        }
      });
      if (!min) min = { annee: maintenant.annee, mois: maintenant.mois };
      if (Chaine.cmpMois(min.annee, min.mois, max.annee, max.mois) > 0) min = max;
      etat.bornes = { min: min, max: max };
      return etat.bornes;
    }).catch(function () {
      var maintenant = moisCourant();
      etat.bornes = { min: maintenant, max: maintenant };
      return etat.bornes;
    });
  }

  function oublierBornes() { etat.bornes = null; }

  /* ------------------------------------------------------------------ */
  /* Barre de navigation du mois                                         */
  /* ------------------------------------------------------------------ */

  function barreMois() {
    var barre = ce('div', 'barre-mois');

    var prec = ce('button', 'nav-mois', '◀');
    prec.setAttribute('aria-label', 'Mois précédent');
    prec.onclick = function () { changerMois(-1); };

    /* Choix direct du mois et de l'année, borné à la période réellement
       couverte par les données (C4). L'année affichée y est toujours incluse :
       les flèches restent libres d'en sortir, on ne s'y enferme pas. */
    var b = etat.bornes || {
      min: { annee: etat.annee, mois: 1 },
      max: { annee: etat.annee, mois: 12 }
    };
    var minAnnee = Math.min(b.min.annee, etat.annee);
    var maxAnnee = Math.max(b.max.annee, etat.annee);
    var moisMin = (etat.annee === b.min.annee) ? b.min.mois : 1;
    var moisMax = (etat.annee === b.max.annee) ? b.max.mois : 12;
    if (moisMin > etat.mois) moisMin = etat.mois;
    if (moisMax < etat.mois) moisMax = etat.mois;

    var choix = ce('div', 'choix-mois');
    var selMois = ce('select', 'in-type');
    selMois.setAttribute('aria-label', 'Mois');
    for (var m = moisMin; m <= moisMax; m++) {
      var op = ce('option', null, moisLibelle(m));
      op.value = String(m);
      if (m === etat.mois) op.selected = true;
      selMois.appendChild(op);
    }
    var selAnnee = ce('select', 'in-type');
    selAnnee.setAttribute('aria-label', 'Année');
    for (var a = minAnnee; a <= maxAnnee; a++) {
      var oa = ce('option', null, String(a));
      oa.value = String(a);
      if (a === etat.annee) oa.selected = true;
      selAnnee.appendChild(oa);
    }
    /* Changer d'année peut rendre le mois choisi hors bornes : on le ramène
       dans la plage plutôt que d'afficher un mois qui n'existe pas. */
    var allerA = function () {
      var an = +selAnnee.value;
      var mo = +selMois.value;
      if (an === b.min.annee && mo < b.min.mois) mo = b.min.mois;
      if (an === b.max.annee && mo > b.max.mois) mo = b.max.mois;
      afficherRecapMois(an, mo);
    };
    selMois.onchange = allerA;
    selAnnee.onchange = allerA;
    choix.appendChild(selMois);
    choix.appendChild(selAnnee);

    var suiv = ce('button', 'nav-mois', '▶');
    suiv.setAttribute('aria-label', 'Mois suivant');
    suiv.onclick = function () { changerMois(1); };

    barre.appendChild(prec);
    barre.appendChild(choix);
    barre.appendChild(suiv);
    return barre;
  }

  function changerMois(delta) {
    var suivant = delta < 0
      ? Chaine.moisPrecedent(etat.annee, etat.mois)
      : Chaine.moisSuivant(etat.annee, etat.mois);
    afficherRecapMois(suivant.annee, suivant.mois);
  }

  /* ------------------------------------------------------------------ */
  /* Rendu d'une carte                                                   */
  /* ------------------------------------------------------------------ */

  function ligne(carte, libelle, valeur, fort) {
    var l = ce('div', 'recap-ligne' + (fort ? ' recap-fort' : ''));
    l.appendChild(ce('span', 'recap-lib', libelle));
    l.appendChild(ce('span', 'recap-val', valeur));
    carte.appendChild(l);
  }

  /* Nom affiché pour un récap. Sur un mois FIGÉ, on lit le nom inscrit dans
     l'instantané (C2) : renommer un enfant ne doit pas réécrire un document
     déjà remis aux parents. Repli sur le contrat courant pour les
     instantanés figés avant le lot 5, qui ne portent pas ces champs — ils
     sont immuables, on ne les modifie pas. */
  function nomAffiche(prep) {
    var contrat = prep.contrat;
    var r = prep.resultat;
    if (prep.fige && r && r.prenomEnfant) {
      return { prenom: r.prenomEnfant, famille: r.nomFamille || null };
    }
    return {
      prenom: contrat.prenom_enfant,
      famille: (contrat.famille && contrat.famille.nom) || null
    };
  }

  function dateEffetAffichee(prep) {
    var r = prep.resultat;
    if (r && r.salaireDateEffet != null) return r.salaireDateEffet;
    return prep.salaire ? prep.salaire.date_effet : null;
  }

  /* Texte prêt à copier dans WhatsApp pour un contrat/mois. */
  function texteWhatsApp(prep) {
    var r = prep.resultat;
    var n = nomAffiche(prep);
    var nom = n.prenom + (n.famille ? ' (' + n.famille + ')' : '');
    var imp = r.imputation || {};
    var lignes = [
      'Récap ' + moisLibelle(prep.mois) + ' ' + prep.annee + ' — ' + nom,
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
    /* C5 : sans cette ligne, un parent qui compare deux mois aux montants
       différents n'a aucun moyen de comprendre pourquoi. */
    lignes.push('Barème appliqué : ' + eur(r.salaireNetCentimes) + ' net' +
      ' (en vigueur depuis le ' + dateFr(dateEffetAffichee(prep)) + ')');
    return lignes.join('\n');
  }

  function carteContrat(prep) {
    var contrat = prep.contrat;
    var carte = ce('section', 'carte-contrat');
    var entete = ce('div', 'recap-entete');
    var n = nomAffiche(prep);
    entete.appendChild(ce('h3', null, n.prenom + (n.famille ? ' · ' + n.famille : '')));
    if (prep.fige) entete.appendChild(ce('span', 'badge-fige', 'Figé'));
    if (contrat.archive) entete.appendChild(ce('span', 'badge-archive', 'Archivé'));
    carte.appendChild(entete);

    if (contrat.archive) {
      /* C4 : un contrat archivé reste visible sur les mois qu'il couvrait —
         mais on ne saisit plus de journées dessus. */
      carte.appendChild(ce('p', 'aide',
        'Contrat archivé. Il reste affiché ici parce qu’il était actif sur ce mois ; ' +
        'aucune saisie de journée n’est possible (l’onglet Saisie ne le propose plus).'));
    }

    if (prep.horsChaine) {
      carte.appendChild(ce('p', 'vide',
        'Ce mois n’a pas pu être calculé : l’historique du contrat dépasse la limite de ' +
        Chaine.MAX_MOIS + ' mois. Vérifiez la date de début du contrat dans l’onglet Familles.'));
      return carte;
    }

    if (prep.salaireManquant) {
      carte.appendChild(ce('p', 'vide',
        'Aucun barème de rémunération connu pour ce mois. ' +
        'Ajouter un barème à date d’effet antérieure ou égale à ce mois dans l’onglet Familles.'));
      return carte;
    }

    /* Mois antérieur à la reprise manuelle des compteurs : les jours et les
       montants sont exacts, les SOLDES ne le sont pas — ils repartiraient de
       zéro. On le dit, et on n'autorise pas à figer un tel mois : ce serait
       enregistrer des compteurs faux dans un document définitif. */
    if (prep.avantInitialisation) {
      carte.appendChild(ce('p', 'alerte',
        'Mois antérieur à la reprise des compteurs : les jours et les montants sont exacts, ' +
        'mais les soldes d’heures supplémentaires et de congés payés repartent de zéro et ne ' +
        'sont pas significatifs. Ce mois est consultable, pas figeable.'));
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

    /* C5 — barème appliqué et date d'effet. */
    ligne(carte, 'Barème appliqué',
      eur(r.salaireNetCentimes) + ' net · ' + eur(r.salaireBrutCentimes) + ' brut');
    ligne(carte, 'En vigueur depuis le', dateFr(dateEffetAffichee(prep)));
    if (!r.salaireNetCentimes) {
      carte.appendChild(ce('p', 'alerte',
        'Le net de ce barème n’est pas renseigné : ce récapitulatif est incomplet. ' +
        'Le net figure sur la fiche de paie du premier mois concerné (onglet Familles).'));
    }

    // Bloc WhatsApp
    var wa = ce('div', 'recap-wa');
    var ta = ce('textarea', 'wa-texte'); ta.readOnly = true; ta.rows = 8;
    ta.value = texteWhatsApp(prep);
    wa.appendChild(ta);
    var copier = ce('button', 'btn btn-secondaire btn-bloc', 'Copier pour WhatsApp');
    copier.onclick = function () { copierTexte(ta.value, copier); };
    wa.appendChild(copier);
    carte.appendChild(wa);

    // Actions figement
    if (prep.fige) {
      var note = ce('p', 'aide');
      note.textContent = 'Mois figé' + (prep.recap && prep.recap.fige_le ? ' le ' + dateFr(prep.recap.fige_le) : '') +
        ' — le document est verrouillé (immuable).';
      carte.appendChild(note);
    } else if (!prep.avantInitialisation) {
      var actions = ce('div', 'form-actions');
      var brouillon = ce('button', 'btn btn-secondaire', 'Enregistrer le brouillon');
      brouillon.onclick = function () { enregistrer(prep, brouillon); };
      var figer = ce('button', 'btn btn-primary', 'Figer le mois');
      figer.onclick = function () { figer1(prep, figer); };
      actions.appendChild(brouillon); actions.appendChild(figer);
      carte.appendChild(actions);
    }

    var msg = ce('div', 'msg-absence'); msg.id = 'msg-recap-' + contrat.id;
    carte.appendChild(msg);
    return carte;
  }

  /* Copie dans le presse-papiers. Un échec de copie doit se VOIR : sinon
     Maria colle dans WhatsApp le contenu précédent du presse-papiers, ou
     rien, en croyant avoir copié son récapitulatif. */
  function copierTexte(txt, bouton) {
    var libelle = bouton.textContent;
    var ok = function () {
      bouton.textContent = 'Copié ✓';
      setTimeout(function () { bouton.textContent = libelle; }, 1500);
    };
    var echec = function (e) {
      if (global.console) global.console.error('[Récap Maria] copie impossible :', e);
      bouton.textContent = 'Copie impossible — sélectionnez le texte ci-dessus';
      setTimeout(function () { bouton.textContent = libelle; }, 4000);
    };
    if (global.navigator && global.navigator.clipboard && global.navigator.clipboard.writeText) {
      global.navigator.clipboard.writeText(txt).then(ok, function () { fallbackCopie(txt, ok, echec); });
    } else { fallbackCopie(txt, ok, echec); }
  }
  function fallbackCopie(txt, ok, echec) {
    try {
      var ta = document.createElement('textarea');
      ta.value = txt; document.body.appendChild(ta); ta.select();
      var reussi = document.execCommand('copy');
      document.body.removeChild(ta);
      if (reussi) ok(); else echec(new Error('execCommand a renvoyé false'));
    } catch (e) { echec(e); }
  }

  function messageRecap(contratId, txt) {
    var m = document.getElementById('msg-recap-' + contratId);
    if (m) m.textContent = txt || '';
  }

  /* ------------------------------------------------------------------ */
  /* Instantané enregistré (C2 / C5)                                     */
  /* ------------------------------------------------------------------ */

  /* Le ResultatMois du moteur ne porte AUCUN nom ni aucune date d'effet.
     On les ajoute ici, au moment de l'enregistrement, tels qu'ils sont à cet
     instant. C'est ce qui rend un récap figé vraiment immuable : renommer un
     enfant ou changer le barème plus tard ne réécrit plus le document envoyé
     aux parents. Le moteur, lui, n'est pas touché. */
  function instantane(prep) {
    var r = prep.resultat;
    var snap = {};
    Object.keys(r).forEach(function (k) { snap[k] = r[k]; });
    snap.prenomEnfant = prep.contrat.prenom_enfant;
    snap.nomFamille = (prep.contrat.famille && prep.contrat.famille.nom) || null;
    snap.salaireDateEffet = prep.salaire ? prep.salaire.date_effet : null;
    return snap;
  }

  function enregistrer(prep, bouton) {
    var contrat = prep.contrat;
    bouton.disabled = true; messageRecap(contrat.id, 'Enregistrement…');
    global.DB.enregistrerRecapBrouillon(contrat.id, prep.annee, prep.mois, instantane(prep))
      .then(function () { messageRecap(contrat.id, 'Brouillon enregistré.'); bouton.disabled = false; })
      .catch(function (e) { messageRecap(contrat.id, 'Enregistrement impossible : ' + messageLisible(e)); bouton.disabled = false; });
  }

  function figer1(prep, bouton) {
    var contrat = prep.contrat;
    if (!global.confirm('Figer ' + moisLibelle(prep.mois) + ' ' + prep.annee + ' pour ' + contrat.prenom_enfant +
        ' ? Le récap deviendra définitif (non modifiable).')) { return; }
    bouton.disabled = true; messageRecap(contrat.id, 'Figement…');
    global.DB.figerRecap(contrat.id, prep.annee, prep.mois, instantane(prep), new Date().toISOString())
      .then(function () { return afficherRecapMois(prep.annee, prep.mois); })
      .catch(function (e) { messageRecap(contrat.id, 'Figement impossible : ' + messageLisible(e)); bouton.disabled = false; });
  }

  /* Message d'erreur en français, sans vocabulaire technique ni anglais
     (points transverses du lot 5 : « échecs visibles »). La traduction est
     mutualisée dans js/messages.js ; le détail technique part en console. */
  function messageLisible(e) {
    return global.Messages ? global.Messages.lisible(e) : 'une erreur est survenue.';
  }

  /* ------------------------------------------------------------------ */
  /* Rendu global                                                        */
  /* ------------------------------------------------------------------ */

  function rendre(preps) {
    var c = etat.conteneur;
    vider(c);
    c.appendChild(barreMois());

    if (preps.some(function (p) { return !p.salaireManquant; })) {
      var expo = ce('button', 'btn btn-secondaire btn-bloc', 'Copier tous les récaps du mois');
      expo.onclick = function () { copierTexte(exportGlobal(preps), expo); };
      c.appendChild(expo);
    }

    preps.forEach(function (p) { c.appendChild(carteContrat(p)); });

    if (preps.length === 0) {
      c.appendChild(ce('p', 'vide', 'Aucun contrat actif sur ce mois.'));
    }
  }

  function exportGlobal(preps) {
    return preps.filter(function (p) { return !p.salaireManquant && p.resultat; })
      .map(function (p) { return texteWhatsApp(p); })
      .join('\n\n———\n\n');
  }

  /* ------------------------------------------------------------------ */
  /* API publique                                                        */
  /* ------------------------------------------------------------------ */

  function init(opts) {
    etat.conteneur = opts.conteneur;
    etat.contrats = opts.contrats || [];
    etat.bornes = null;
  }

  /* Affiche le récap d'un mois. Les contrats affichés sont ceux dont la
     période d'activité recouvre ce mois — archivés compris (C4).

     Un mois FIGÉ est lu directement (un seul appel) : rejouer la chaîne pour
     l'afficher serait à la fois inutile et coûteux, puisque l'instantané fait
     foi. La chaîne n'est parcourue que pour un mois encore calculable.

     `sequence` évite qu'un affichage lent (chaîne longue) écrase le rendu
     d'un mois demandé après lui : deux clics rapides sur ▶ ne doivent pas
     afficher les cartes d'un mois sous l'en-tête d'un autre. */
  function afficherRecapMois(annee, mois) {
    etat.annee = annee; etat.mois = mois;
    var jeton = ++etat.sequence;
    if (etat.conteneur) etat.conteneur.textContent = 'Calcul du récap…';

    return chargerBornes()
      .then(function () { return global.DB.listContratsPourMois(annee, mois); })
      .then(function (contrats) {
        if (jeton !== etat.sequence) return null;
        etat.contrats = contrats || [];
        var lectures = etat.contrats.map(function (contrat) {
          return global.DB.getRecap(contrat.id, annee, mois).then(function (recap) {
            if (recap && recap.statut === 'fige' && recap.donnees) {
              var prepFige = {
                contrat: contrat, annee: annee, mois: mois, fige: true, recap: recap,
                resultat: recap.donnees, salaire: null, salaireManquant: false
              };
              if (recap.donnees.salaireDateEffet != null) return prepFige;
              /* Instantané figé AVANT le lot 5 : il ne porte pas la date
                 d'effet du barème. On la retrouve par RG-15 pour ne pas
                 afficher « — » aux parents. L'instantané n'est pas modifié :
                 il est immuable. */
              return global.DB.getSalaires(contrat.id).then(function (sal) {
                prepFige.salaire = global.Engine.salaireApplicable(sal || [], annee, mois);
                return prepFige;
              }).catch(function () { return prepFige; });
            }
            return Chaine.mois1(contrat, annee, mois).then(function (entree) {
              if (!entree) {
                return {
                  contrat: contrat, annee: annee, mois: mois, fige: false, recap: recap || null,
                  resultat: null, salaire: null, salaireManquant: false, horsChaine: true
                };
              }
              return {
                contrat: contrat, annee: annee, mois: mois,
                fige: entree.fige, recap: entree.recap, resultat: entree.resultat,
                salaire: entree.salaire, salaireManquant: entree.salaireManquant,
                avantInitialisation: !!entree.avantInitialisation
              };
            });
          });
        });
        return Promise.all(lectures);
      })
      .then(function (preps) {
        if (preps === null || jeton !== etat.sequence) return;
        rendre(preps);
      })
      .catch(function (e) {
        if (jeton !== etat.sequence) return;
        if (etat.conteneur) etat.conteneur.textContent = 'Récapitulatif indisponible : ' + messageLisible(e);
      });
  }

  /* Redessine le mois actuellement affiché (après un changement de barème ou
     de contrat depuis l'onglet Familles). */
  function rafraichir() {
    if (etat.annee == null || etat.mois == null) return Promise.resolve();
    return afficherRecapMois(etat.annee, etat.mois);
  }

  global.UiRecap = {
    init: init,
    afficherRecapMois: afficherRecapMois,
    rafraichir: rafraichir,
    oublierBornes: oublierBornes
  };
})(window);
