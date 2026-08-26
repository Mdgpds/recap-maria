/* ============================================================================
   ui-familiarisation.js — L'ÉCRAN DE LA PÉRIODE DE FAMILIARISATION (§20.4 d).

   Depuis la fiche du contrat : les deux dates, la phrase de la règle, puis le
   JOUR PAR JOUR — chaque jour ouvré de la période avec son état (déclaré, à
   déclarer, à venir) — et le total déclaré avec son montant.

   CE QUE CET ÉCRAN NE FAIT PAS, ET NE DOIT JAMAIS FAIRE :

   - il ne calcule aucun montant lui-même. Le total vient de
     `Engine.montantCentimes`, appelé sur les minutes réellement déclarées ;
   - il n'énumère pas les jours ouvrés à la main. `Engine.joursOuvresDePeriode`
     porte cette règle, la même que celle du prorata. Un écran qui la referait
     la ferait diverger le jour où un contrat passe au mercredi ;
   - il ne décide pas de ce qui est modifiable. Le refus sur un mois clôturé
     vient de la liste des récapitulatifs figés, lue ici, et le refus NOMME les
     mois — même règle et même message que les avenants (§17.4).

   La seule chose que cet écran sait et que le moteur ignore : quel jour on
   est. C'est ce qui distingue « à déclarer » (un jour passé sans saisie, en
   orange) de « à venir ».
   ========================================================================= */
(function (global) {
  'use strict';

  var Kit = global.Kit;
  var Engine = global.Engine;
  var Chaine = global.ChaineMois;

  var vue = null;

  /* ------------------------------------------------------------------ */
  /* Chargement                                                          */
  /* ------------------------------------------------------------------ */

  function afficher(ctx) {
    var contrat = global.App.contratParId(ctx.params.contratId);
    if (!contrat) {
      return global.App.tousLesContrats().then(function () {
        var c = global.App.contratParId(ctx.params.contratId);
        if (!c) throw new Error('contrat introuvable');
        return afficherContrat(ctx, c);
      });
    }
    return afficherContrat(ctx, contrat);
  }

  function afficherContrat(ctx, contrat) {
    global.App.barreRetour(ctx.barre, 'Familiarisation', { droite: contrat.prenom_enfant });
    ctx.corps.appendChild(Kit.ce('div', 'attente', 'Lecture de la période…'));

    /* LA LECTURE DES RÉCAPITULATIFS ÉCHOUE FERMÉ, comme sur la fiche du
       contrat (correction B2 du lot 17). C'est la source UNIQUE du garde-fou
       « la période n'est plus modifiable dès qu'un mois clôturé la recouvre ».
       Une coupure réseau ne doit pas ouvrir une porte que le réseau seul
       aurait laissée fermée. */
    return Promise.all([
      global.DB.listPeriodesFamiliarisationContrat(contrat.id),
      global.App.avenants(contrat.id),
      global.DB.listRecapsContrat(contrat.id)
        .then(function (l) { return { ok: true, liste: l || [], erreur: null }; })
        .catch(function (e) { return { ok: false, liste: [], erreur: e }; })
    ]).then(function (r) {
      var periodes = r[0] || [];
      vue = {
        contrat: contrat,
        periodes: periodes,
        periode: periodes.length ? periodes[0] : null,
        avenants: r[1] || [],
        recaps: r[2],
        journees: {},
        aujourdhui: global.App.aujourdhui(),
        corps: ctx.corps
      };
      if (!vue.periode) {
        Kit.vider(ctx.corps);
        rendre(ctx.corps);
        return null;
      }
      /* Les journées de la période, en un seul aller-retour. Une période de
         cinq à dix jours (RG-14) tient largement dans une requête ; on la lit
         quand même par plage plutôt que mois par mois, parce qu'une période à
         cheval sur deux mois est le cas ordinaire. */
      return global.DB.getJourneesPeriode(contrat.id, vue.periode.date_debut, vue.periode.date_fin)
        .then(function (parMois) {
          var parJour = {};
          Object.keys(parMois || {}).forEach(function (cle) {
            Object.keys(parMois[cle]).forEach(function (j) { parJour[j] = parMois[cle][j]; });
          });
          vue.journees = parJour;
          Kit.vider(ctx.corps);
          rendre(ctx.corps);
        });
    });
  }

  function redessiner() {
    if (!vue || !vue.corps) return;
    Kit.vider(vue.corps);
    rendre(vue.corps);
  }

  /* ------------------------------------------------------------------ */
  /* Les conditions applicables, et le taux                              */
  /* ------------------------------------------------------------------ */

  /* CORRECTION C4 DE LA RELECTURE DU LOT 20 — LE TOTAL EST CALCULÉ MOIS PAR
     MOIS, PAS À UN SEUL TAUX.

     Cet écran retenait l'avenant du mois où la période COMMENCE et totalisait
     tout à ce taux-là. Un commentaire promettait qu'une phrase sous le total
     préviendrait — cette phrase n'était pas rendue. Le code affirmait une
     protection qu'il n'avait pas.

     Le risque est faible (une familiarisation dure cinq à dix jours, RG-14),
     mais le contrôle n° 10 du lot est clair : le taux vient de l'avenant en
     vigueur DU MOIS. Plutôt qu'un avertissement, on fait le calcul juste — et
     l'écran n'a plus rien à excuser. C'est aussi ce que fait le
     récapitulatif de chaque mois : les deux ne peuvent plus diverger. */
  function conditionsDuMois(dateStr) {
    var p = String(dateStr).split('-');
    return Engine.conditionsApplicables(vue.avenants, Number(p[0]), Number(p[1]));
  }

  /* Les conditions du premier jour de la période — pour ce qui ne dépend pas
     d'un mois en particulier (le libellé de la règle, l'indemnité affichée). */
  function conditionsInitiales() {
    return vue.periode ? conditionsDuMois(vue.periode.date_debut) : null;
  }

  /* Les jours ouvrés de la période, découpés par mois, chacun avec SES
     conditions. Le planning lui-même vient de l'avenant : un avenant qui
     ajoute le mercredi ajoute des jours ouvrés à partir de son mois, et pas
     avant. */
  function tranchesParMois() {
    if (!vue.periode) return [];
    var out = [];
    var d = vue.periode.date_debut;
    var fin = vue.periode.date_fin;
    /* Borne dure : une période aberrante ne doit pas faire tourner l'écran
       indéfiniment. Cent vingt mois, c'est déjà mille fois trop. */
    for (var garde = 0; garde < 120 && d <= fin; garde++) {
      var an = Number(d.slice(0, 4));
      var mo = Number(d.slice(5, 7));
      var dernierDuMois = Kit.iso(an, mo, Kit.nbJoursDansMois(an, mo));
      var borneFin = dernierDuMois < fin ? dernierDuMois : fin;
      var cond = conditionsDuMois(d);
      out.push({
        annee: an, mois: mo,
        conditions: cond,
        jours: Engine.joursOuvresDePeriode(d, borneFin,
          (cond && cond.jours_planning) || null)
      });
      if (borneFin >= fin) break;
      var suivant = mo === 12 ? { a: an + 1, m: 1 } : { a: an, m: mo + 1 };
      d = Kit.iso(suivant.a, suivant.m, 1);
    }
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Les mois clôturés que la période recouvre                           */
  /* ------------------------------------------------------------------ */

  /* Les mois FIGÉS que recouvre une période donnée, dans l'ordre. C'est ce que
     le refus doit NOMMER : « mois déjà clôturé(s) — septembre 2026 » vaut
     mille fois « modification impossible ». */
  function moisClosRecouverts(debut, fin) {
    if (!vue.recaps.ok) return null;          // lecture impossible : on refuse
    var out = [];
    (vue.recaps.liste || []).forEach(function (rec) {
      if (rec.statut !== 'fige') return;
      var premier = rec.annee + '-' + String(rec.mois).padStart(2, '0') + '-01';
      var dernier = rec.annee + '-' + String(rec.mois).padStart(2, '0') + '-' +
        String(Kit.nbJoursDansMois(rec.annee, rec.mois)).padStart(2, '0');
      if (premier <= fin && dernier >= debut) out.push(rec);
    });
    out.sort(function (a, b) { return Chaine.cmpMois(a.annee, a.mois, b.annee, b.mois); });
    return out;
  }

  function listeMois(rs) {
    return rs.map(function (r) { return Kit.libelleMoisAnnee(r.annee, r.mois); }).join(', ');
  }

  /* Le verrou de la période affichée : elle ne se modifie plus dès qu'un mois
     clôturé la recouvre. `null` = modifiable ; une phrase = refusée. */
  function raisonVerrou() {
    if (vue.contrat.archive) {
      return 'Ce contrat est rangé : ses journées ne se modifient plus.';
    }
    if (!vue.periode) return null;
    if (!vue.recaps.ok) {
      return 'Impossible de vérifier vos mois clôturés (' +
        Kit.messageErreur(vue.recaps.erreur) + '). La période n’est pas ' +
        'modifiable tant que cette vérification n’a pas abouti.';
    }
    /* LOT 30 (§30.3) — un mois clôturé ne verrouille plus la période : la
       corriger PROPOSE de le rouvrir, puis poursuit. Seuls un contrat rangé
       et une lecture des mois clôturés qui a échoué (A6) verrouillent. */
    return null;
  }

  /* §30.3 — les mois clôturés que la période recouvre, pour le dire d'avance
     sous les dates : ils seront proposés à la réouverture. */
  function phraseMoisClos() {
    if (!vue.periode || !vue.recaps.ok) return null;
    var clos = moisClosRecouverts(vue.periode.date_debut, vue.periode.date_fin);
    if (!clos || !clos.length) return null;
    return 'Mois déjà clôturé' + (clos.length > 1 ? 's' : '') + ' — ' + listeMois(clos) +
      '. Corriger les dates proposera de ' + (clos.length > 1 ? 'les' : 'le') +
      ' rouvrir, puis continuera.';
  }

  /* ------------------------------------------------------------------ */
  /* Rendu                                                               */
  /* ------------------------------------------------------------------ */

  function rendre(corps) {
    var c = vue.contrat;

    if (!vue.periode) {
      corps.appendChild(Kit.note('Aucune période de familiarisation',
        'Avant une garde normale, ' + c.prenom_enfant + ' peut passer par une ' +
        'période d’adaptation : ' + Kit.accordDe(c, 'il') + ' vient un temps ' +
        'réduit, vous déclarez les heures réellement faites, et elles sont ' +
        'payées à l’heure, au taux du contrat.'));
      if (!c.archive) {
        var bAjout = Kit.bouton('btn', function () { feuillePeriode(null); });
        bAjout.textContent = 'Poser une période de familiarisation';
        corps.appendChild(bAjout);
      }
      return;
    }

    var verrou = raisonVerrou();

    corps.appendChild(Kit.section('Période'));
    corps.appendChild(Kit.fld('Du', Kit.dateLongue(vue.periode.date_debut)));
    corps.appendChild(Kit.fld('Au', Kit.dateLongue(vue.periode.date_fin)));
    var tranches = tranchesParMois();
    corps.appendChild(phraseDeLaRegle(tranches));

    if (verrou) {
      corps.appendChild(Kit.note('Période non modifiable', verrou));
    } else {
      var avertClos = phraseMoisClos();
      if (avertClos) corps.appendChild(Kit.ce('p', 'sb q', avertClos));
      var bModif = Kit.bouton('btn nt', function () { feuillePeriode(vue.periode); });
      bModif.textContent = 'Corriger les dates';
      corps.appendChild(bModif);
    }

    corps.appendChild(blocJourParJour(verrou, tranches));

    /* Plusieurs périodes sur un même contrat restent possibles en base (elles
       ne peuvent simplement pas se chevaucher). L'écran en affiche une ; on ne
       cache pas les autres, on les nomme. */
    if (vue.periodes.length > 1) {
      corps.appendChild(Kit.section('Autres périodes de ce contrat'));
      vue.periodes.slice(1).forEach(function (p) {
        corps.appendChild(Kit.fld('Du ' + Kit.dateLongue(p.date_debut),
          'au ' + Kit.dateLongue(p.date_fin)));
      });
    }
  }

  /* Le taux horaire d'un jeu de conditions, demandé au moteur sur soixante
     minutes. `null` quand le mois n'a pas de rémunération connue : on
     n'affiche alors aucun taux plutôt que d'en inventer un à zéro. */
  function tauxHoraire(cond) {
    if (!cond || cond.brut_mensuel_centimes == null) return null;
    return Engine.montantCentimes(cond.brut_mensuel_centimes, 60);
  }

  function phraseDeLaRegle(tranches) {
    /* Un seul taux sur toute la période : on le nomme. Plusieurs — la période
       traverse un avenant : on ne choisit pas, on dit que chaque mois a le
       sien, et le détail par mois plus bas le montre. */
    var taux = [];
    tranches.forEach(function (t) {
      if (!t.jours.length) return;
      var x = tauxHoraire(t.conditions);
      if (x != null && taux.indexOf(x) === -1) taux.push(x);
    });
    var phrase;
    if (taux.length === 1) {
      phrase = 'Au taux du contrat : ' + Kit.eur(taux[0]) + ' brut de l’heure. ';
    } else if (taux.length > 1) {
      phrase = 'Cette période traverse un changement de conditions : chaque mois ' +
        'est payé au taux de son avenant, et le détail ci-dessous le montre. ';
    } else {
      phrase = '';
    }
    return Kit.note('Seules les heures déclarées sont payées',
      phrase + 'Pas de minutes supplémentaires pendant cette période. ' +
      'Vos congés payés s’acquièrent normalement.');
  }

  function blocJourParJour(verrou, tranches) {
    var bloc = Kit.ce('div');
    bloc.appendChild(Kit.section('Jour par jour'));

    var avecJours = tranches.filter(function (t) { return t.jours.length; });
    var nbJours = 0;
    avecJours.forEach(function (t) { nbJours += t.jours.length; });

    if (!nbJours) {
      bloc.appendChild(Kit.ce('p', 'vide',
        'Aucun jour de garde dans cette période : elle ne tombe que sur des ' +
        'jours qui ne sont pas au planning de ce contrat.'));
      return bloc;
    }

    var totalMinutes = 0;
    var totalCentimes = 0;
    var declares = 0;
    var aDeclarer = 0;
    var chiffrable = true;

    avecJours.forEach(function (t) {
      var minutesDuMois = 0;

      /* L'intitulé du mois n'apparaît QUE si la période en traverse plusieurs :
         sur une familiarisation de cinq jours, il n'apprendrait rien. */
      if (avecJours.length > 1) {
        bloc.appendChild(Kit.ce('div', 'sb q', Kit.moisCapitale(t.annee, t.mois)));
      }

      t.jours.forEach(function (d) {
        var l = vue.journees[d] || null;
        var minutes = (l && l.minutes_reelles != null && l.minutes_reelles > 0)
          ? l.minutes_reelles : 0;
        var entretien = !(l && l.entretien_du === false);
        var etat;
        if (minutes > 0) {
          minutesDuMois += minutes;
          declares++;
          etat = Kit.heures(minutes) + (entretien ? ' · entretien' : ' · sans entretien');
        } else if (d > vue.aujourdhui) {
          etat = 'à venir';
        } else {
          aDeclarer++;
          etat = 'à déclarer';
        }

        var ligne = Kit.ce('div', 'fld' +
          (minutes === 0 && d <= vue.aujourdhui ? ' a-declarer' : '') +
          (d > vue.aujourdhui ? ' futur' : ''));
        ligne.appendChild(Kit.ce('span', 'lb', Kit.jourLong(d)));
        ligne.appendChild(Kit.ce('span', 'vl', etat));
        /* Un jour à venir ne se déclare pas : on ne saisit pas l'avenir
           (V8-05). Sur une période verrouillée, aucun jour ne s'ouvre. */
        if (!verrou && d <= vue.aujourdhui) {
          ligne.setAttribute('role', 'button');
          ligne.setAttribute('tabindex', '0');
          ligne.addEventListener('click', function () { ouvrirJour(d); });
          ligne.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ouvrirJour(d); }
          });
        }
        bloc.appendChild(ligne);
      });

      /* CORRECTION C4 — LE MONTANT DU MOIS, AU TAUX DE SON AVENANT.
         Un seul arrondi par mois, sur le total de ses minutes : c'est
         exactement ce que fait `calculerMois`, et c'est ce qui garantit que ce
         total et le récapitulatif du mois ne divergent jamais. */
      totalMinutes += minutesDuMois;
      if (minutesDuMois > 0) {
        if (t.conditions && t.conditions.brut_mensuel_centimes != null) {
          totalCentimes += Engine.montantCentimes(
            t.conditions.brut_mensuel_centimes, minutesDuMois);
        } else {
          chiffrable = false;
        }
      }
    });

    bloc.appendChild(Kit.fld('Total déclaré',
      Kit.heures(totalMinutes) +
      (totalMinutes > 0 && chiffrable ? ' — ' + Kit.eur(totalCentimes) + ' brut' : '')));
    bloc.appendChild(Kit.ce('p', 'sb q',
      declares + ' jour' + (declares > 1 ? 's' : '') + ' déclaré' + (declares > 1 ? 's' : '') +
      ' sur ' + nbJours +
      (aDeclarer > 0
        ? ' — ' + aDeclarer + ' jour' + (aDeclarer > 1 ? 's' : '') + ' passé' +
          (aDeclarer > 1 ? 's' : '') + ' sans déclaration ne ' +
          (aDeclarer > 1 ? 'seront' : 'sera') + ' payé' + (aDeclarer > 1 ? 's' : '') + ' pour rien.'
        : '.')));
    if (!chiffrable && totalMinutes > 0) {
      bloc.appendChild(Kit.ce('p', 'sb q',
        'Le montant ne peut pas être chiffré en entier : les conditions d’au ' +
        'moins un mois de cette période ne portent pas de rémunération.'));
    }
    return bloc;
  }

  /* Déclarer un jour se fait sur l'espace de l'enfant, dans le mois du jour :
     c'est là que vit la feuille de saisie, et c'est là que Maria voit l'effet
     de sa déclaration sur le mois. Deux feuilles de saisie pour un même geste
     divergeraient à la première correction. */
  function ouvrirJour(d) {
    var p = d.split('-');
    global.App.aller('enfant', {
      contratId: vue.contrat.id,
      annee: Number(p[0]),
      mois: Number(p[1]),
      jour: d
    });
  }

  /* ------------------------------------------------------------------ */
  /* Poser ou corriger les dates                                         */
  /* ------------------------------------------------------------------ */

  function feuillePeriode(periode) {
    var c = vue.contrat;
    var creation = !periode;
    var defautDebut = (periode && periode.date_debut) || c.date_debut ||
      global.App.aujourdhui();

    Kit.ouvrirFeuille(creation ? 'Période de familiarisation' : 'Corriger les dates',
      c.prenom_enfant + ' — les heures se déclarent ensuite, jour par jour.',
      function (corps) {
        var chDebut = Kit.champDate('Premier jour', defautDebut);
        var chFin = Kit.champDate('Dernier jour (inclus)',
          (periode && periode.date_fin) || defautDebut);
        corps.appendChild(chDebut.bloc);
        corps.appendChild(chFin.bloc);

        var msg = Kit.ce('div', 'msg');
        corps.appendChild(msg);

        function echec(texte) {
          msg.className = 'msg ko';
          msg.textContent = texte;
        }

        var b = Kit.bouton('btn', function () {
          var debut = chDebut.valeur();
          var fin = chFin.valeur();
          if (fin < debut) {
            return echec('Le dernier jour doit être après le premier. Reprenez les deux dates.');
          }
          /* LE GARDE-FOU DES MOIS CLÔTURÉS, AVANT L'ÉCRITURE ET SUR LES DEUX
             PÉRIODES : celle qu'on quitte comme celle qu'on pose. Déplacer une
             période HORS d'un mois clôturé le recalculerait tout autant que
             l'y faire entrer. */
          if (!vue.recaps.ok) {
            return echec('Impossible de vérifier vos mois clôturés (' +
              Kit.messageErreur(vue.recaps.erreur) + '). Rien n’a été enregistré.');
          }
          var clos = moisClosRecouverts(debut, fin) || [];
          if (periode) {
            (moisClosRecouverts(periode.date_debut, periode.date_fin) || [])
              .forEach(function (r) {
                if (clos.indexOf(r) === -1) clos.push(r);
              });
          }

          function ecrire(bouton) {
            var promesse = creation
              ? global.DB.enregistrerPeriodeFamiliarisation({
                  contrat_id: c.id, date_debut: debut, date_fin: fin
                })
              : global.DB.majPeriodeFamiliarisation(periode.id,
                  { date_debut: debut, date_fin: fin });
            return promesse.then(function () {
              global.App.invalider();
              Kit.fermerFeuille();
              Kit.toast(creation ? 'Période enregistrée' : 'Dates corrigées');
              global.App.remplacer('familiarisation', { contratId: c.id });
            }).catch(function (e) {
              /* La feuille RESTE ouverte : la saisie en cours ne disparaît
                 jamais en silence (B.0-9). */
              if (bouton) {
                bouton.disabled = false;
                echec('Rien n’a été enregistré — ' + Kit.messageErreur(e));
              } else {
                Kit.toast('Les mois sont rouverts mais la période n’a pas été enregistrée : ' +
                  Kit.messageErreur(e), true);
                feuillePeriode(periode);
              }
            });
          }

          /* LOT 30 (§30.3) — LE MODÈLE DU CONGÉ, GÉNÉRALISÉ. Déplacer une
             période HORS d'un mois clôturé le recalculerait tout autant que
             l'y faire entrer : les deux jeux de dates sont vérifiés, les mois
             sont NOMMÉS, la réouverture proposée, et les dates s'écrivent
             ensuite. Plus de refus sec. */
          if (clos.length) {
            clos.sort(function (x, y) { return Chaine.cmpMois(x.annee, x.mois, y.annee, y.mois); });
            return global.UiReouverture.feuilleRouvrirEtContinuer({
              mois: clos.map(function (r) {
                return { contrat: c, annee: r.annee, mois: r.mois, recap: r };
              }),
              question: (creation ? 'Cette période' : 'Ces dates') + ' recouvre' +
                (creation ? '' : 'nt') + ' ' + listeMois(clos) + ', déjà clôturé' +
                (clos.length > 1 ? 's' : '') + '. Rouvrir ' +
                (clos.length > 1 ? 'ces mois' : 'ce mois') + ' et continuer ?',
              bouton: clos.length > 1
                ? 'Rouvrir ces ' + clos.length + ' récapitulatifs et enregistrer la période'
                : 'Rouvrir ' + Kit.libelleMois(clos[0].mois) + ' et enregistrer la période',
              motif: creation ? 'Période de familiarisation posée' : 'Période de familiarisation corrigée',
              continuer: function () {
                return global.DB.listRecapsContrat(c.id).then(function (liste) {
                  vue.recaps = { ok: true, liste: liste || [] };
                  return ecrire(null);
                });
              },
              annuler: function () { feuillePeriode(periode); }
            });
          }

          msg.className = 'msg';
          msg.textContent = '';
          b.disabled = true;
          ecrire(b);
        });
        b.textContent = creation ? 'Enregistrer la période' : 'Corriger';
        corps.appendChild(b);

        if (!creation) {
          var bSup = Kit.bouton('btn dg', function () {
            var clos = moisClosRecouverts(periode.date_debut, periode.date_fin) || [];
            if (!vue.recaps.ok) {
              return echec('Impossible de vérifier vos mois clôturés. Rien n’a été retiré.');
            }
            function retirer(bouton) {
              return global.DB.supprimerPeriodeFamiliarisation(periode.id).then(function () {
                global.App.invalider();
                Kit.fermerFeuille();
                Kit.toast('Période retirée');
                global.App.remplacer('familiarisation', { contratId: c.id });
              }).catch(function (e) {
                if (bouton) { bouton.disabled = false; echec('Rien n’a été retiré — ' + Kit.messageErreur(e)); }
                else Kit.toast('Les mois sont rouverts mais la période n’a pas été retirée : ' +
                  Kit.messageErreur(e), true);
              });
            }
            /* §30.3 — retirer une période qui recouvre un mois clôturé le
               recalcule : on propose de rouvrir, puis on retire. */
            if (clos.length) {
              return global.UiReouverture.feuilleRouvrirEtContinuer({
                mois: clos.map(function (r) {
                  return { contrat: c, annee: r.annee, mois: r.mois, recap: r };
                }),
                question: 'Retirer cette période change ' + listeMois(clos) + ', déjà clôturé' +
                  (clos.length > 1 ? 's' : '') + '. Rouvrir et continuer ?',
                bouton: 'Rouvrir et retirer la période',
                motif: 'Période de familiarisation retirée',
                continuer: function () { return retirer(null); },
                annuler: function () { feuillePeriode(periode); }
              });
            }
            bSup.disabled = true;
            retirer(bSup);
          });
          bSup.textContent = 'Retirer cette période';
          corps.appendChild(bSup);
          corps.appendChild(Kit.ce('p', 'sb q',
            'Les heures que vous avez déjà déclarées restent enregistrées : ' +
            'ce sont des faits. Sans période, elles ne sont simplement plus payées ' +
            'à l’heure.'));
        }
      });
  }

  global.UiFamiliarisation = { afficher: afficher, redessiner: redessiner };
})(window);
