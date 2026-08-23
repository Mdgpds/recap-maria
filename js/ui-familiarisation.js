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

  /* Les conditions du mois où la période COMMENCE. Une familiarisation ne
     traverse pas un changement d'avenant en pratique (cinq à dix jours), mais
     si elle le faisait, le total affiché ici resterait indicatif — le
     récapitulatif de chaque mois, lui, est calculé avec SES conditions. La
     phrase sous le total le dit plutôt que de laisser croire au contraire. */
  function conditions() {
    if (!vue.periode) return null;
    var p = vue.periode.date_debut.split('-');
    return Engine.conditionsApplicables(vue.avenants, Number(p[0]), Number(p[1]));
  }

  function planning() {
    var c = conditions();
    return (c && c.jours_planning) || null;
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
    var clos = moisClosRecouverts(vue.periode.date_debut, vue.periode.date_fin);
    if (clos && clos.length) {
      return 'Mois déjà clôturé(s) — ' + listeMois(clos) + '. Un mois clôturé ne ' +
        'se recalcule pas : la période ne peut plus être déplacée.';
    }
    return null;
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
    corps.appendChild(phraseDeLaRegle());

    if (verrou) {
      corps.appendChild(Kit.note('Période non modifiable', verrou));
    } else {
      var bModif = Kit.bouton('btn nt', function () { feuillePeriode(vue.periode); });
      bModif.textContent = 'Corriger les dates';
      corps.appendChild(bModif);
    }

    corps.appendChild(blocJourParJour(verrou));

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

  function phraseDeLaRegle() {
    var cd = conditions();
    var taux = (cd && cd.brut_mensuel_centimes != null)
      ? Engine.montantCentimes(cd.brut_mensuel_centimes, 60) : null;
    return Kit.note('Seules les heures déclarées sont payées',
      (taux != null ? 'Au taux du contrat : ' + Kit.eur(taux) + ' brut de l’heure. ' : '') +
      'Pas de minutes supplémentaires pendant cette période. ' +
      'Vos congés payés s’acquièrent normalement.');
  }

  function blocJourParJour(verrou) {
    var bloc = Kit.ce('div');
    bloc.appendChild(Kit.section('Jour par jour'));

    var jours = Engine.joursOuvresDePeriode(
      vue.periode.date_debut, vue.periode.date_fin, planning());

    if (!jours.length) {
      bloc.appendChild(Kit.ce('p', 'vide',
        'Aucun jour de garde dans cette période : elle ne tombe que sur des ' +
        'jours qui ne sont pas au planning de ce contrat.'));
      return bloc;
    }

    var totalMinutes = 0;
    var declares = 0;
    var aDeclarer = 0;

    jours.forEach(function (d) {
      var l = vue.journees[d] || null;
      var minutes = (l && l.minutes_reelles != null && l.minutes_reelles > 0)
        ? l.minutes_reelles : 0;
      var entretien = !(l && l.entretien_du === false);
      var etat;
      if (minutes > 0) {
        totalMinutes += minutes;
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

    var cd = conditions();
    var montant = (cd && cd.brut_mensuel_centimes != null && totalMinutes > 0)
      ? Engine.montantCentimes(cd.brut_mensuel_centimes, totalMinutes) : null;
    bloc.appendChild(Kit.fld('Total déclaré',
      Kit.heures(totalMinutes) + (montant != null ? ' — ' + Kit.eur(montant) + ' brut' : '')));
    bloc.appendChild(Kit.ce('p', 'sb q',
      declares + ' jour' + (declares > 1 ? 's' : '') + ' déclaré' + (declares > 1 ? 's' : '') +
      ' sur ' + jours.length +
      (aDeclarer > 0
        ? ' — ' + aDeclarer + ' jour' + (aDeclarer > 1 ? 's' : '') + ' passé' +
          (aDeclarer > 1 ? 's' : '') + ' sans déclaration ne ' +
          (aDeclarer > 1 ? 'seront' : 'sera') + ' payé' + (aDeclarer > 1 ? 's' : '') + ' pour rien.'
        : '.')));
    if (montant == null && totalMinutes > 0) {
      bloc.appendChild(Kit.ce('p', 'sb q',
        'Le montant ne peut pas être chiffré : les conditions de ce contrat ne ' +
        'portent pas de rémunération.'));
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
          if (clos.length) {
            return echec('Mois déjà clôturé(s) — ' + listeMois(clos) +
              '. Un mois clôturé ne se recalcule pas : choisissez des dates qui ' +
              'ne les recouvrent pas.');
          }

          msg.className = 'msg';
          msg.textContent = '';
          b.disabled = true;
          var promesse = creation
            ? global.DB.enregistrerPeriodeFamiliarisation({
                contrat_id: c.id, date_debut: debut, date_fin: fin
              })
            : global.DB.majPeriodeFamiliarisation(periode.id,
                { date_debut: debut, date_fin: fin });

          promesse.then(function () {
            global.App.invalider();
            Kit.fermerFeuille();
            Kit.toast(creation ? 'Période enregistrée' : 'Dates corrigées');
            global.App.remplacer('familiarisation', { contratId: c.id });
          }).catch(function (e) {
            /* La feuille RESTE ouverte : la saisie en cours ne disparaît
               jamais en silence (B.0-9). */
            b.disabled = false;
            echec('Rien n’a été enregistré — ' + Kit.messageErreur(e));
          });
        });
        b.textContent = creation ? 'Enregistrer la période' : 'Corriger';
        corps.appendChild(b);

        if (!creation) {
          var bSup = Kit.bouton('btn dg', function () {
            var clos = moisClosRecouverts(periode.date_debut, periode.date_fin) || [];
            if (!vue.recaps.ok) {
              return echec('Impossible de vérifier vos mois clôturés. Rien n’a été retiré.');
            }
            if (clos.length) {
              return echec('Mois déjà clôturé(s) — ' + listeMois(clos) +
                '. La période ne peut pas être retirée.');
            }
            bSup.disabled = true;
            global.DB.supprimerPeriodeFamiliarisation(periode.id).then(function () {
              global.App.invalider();
              Kit.fermerFeuille();
              Kit.toast('Période retirée');
              global.App.remplacer('familiarisation', { contratId: c.id });
            }).catch(function (e) {
              bSup.disabled = false;
              echec('Rien n’a été retiré — ' + Kit.messageErreur(e));
            });
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
