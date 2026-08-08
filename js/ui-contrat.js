/* ============================================================================
   ui-contrat.js — Fiche contrat, nouveau barème, fin de contrat (§2.7).

   La fiche montre, en clair et sans jargon, ce qui gouverne les calculs de ce
   contrat : identité, horaires, rémunération, et les TROIS RÈGLES
   PARAMÉTRABLES (ordre d'imputation RG-07, heures sup si l'enfant est absent
   RG-09, majoration de fin de contrat RG-13). Elles étaient invisibles avant
   le lot 5 ; elles restent affichées ici, parce qu'un chiffre qu'on ne peut
   pas expliquer est un chiffre qu'on ne peut pas défendre.

   Deux flux repris du lot 5, sans en changer une règle :

   - NOUVEAU BARÈME (RG-15) : date d'effet choisie au mois (jamais tapée au
     clavier), brut, net SAISI À LA MAIN — il n'est pas calculable depuis le
     brut — et application groupée décochable, parce que le SMIC bouge pour
     tous les contrats le même jour. Garde-fou conservé tel quel : une date
     d'effet qui toucherait un mois DÉJÀ CLÔTURÉ est refusée, contrat par
     contrat. Les mois clôturés ne bougent pas.

   - FIN DE CONTRAT (RG-13) : les deux soldes sont affichés avant tout
     rangement — congés payés sans majoration, heures supplémentaires majorées
     de 50 %. Rien n'est supprimé : le contrat sort des écrans courants et
     garde tout son historique.

   Aucune formule n'est réécrite : la valorisation des heures supplémentaires
   passe par Engine.montantCentimes avec le coefficient 1,5, la sélection du
   barème par Engine.salaireApplicable, les soldes par la chaîne des mois.
   ========================================================================= */
(function (global) {
  'use strict';

  var Kit = global.Kit;
  var Chaine = global.ChaineMois;
  var Engine = global.Engine;

  /* Majoration du solde d'heures supplémentaires à la fin du contrat (RG-13).
     Clause écrite au contrat, identique aux quatre contrats : elle n'a pas de
     colonne en base et n'en gagne pas une dans un lot d'interface. */
  var COEFF_FIN_CONTRAT = 1.5;

  function afficher(ctx) {
    var contrat = global.App.contratParId(ctx.params.contratId);
    if (!contrat) {
      return global.App.tousLesContrats().then(function () {
        return rendreEcran(ctx, global.App.contratParId(ctx.params.contratId));
      });
    }
    return rendreEcran(ctx, contrat);
  }

  function rendreEcran(ctx, contrat) {
    if (!contrat) throw new Error('contrat introuvable');
    if (ctx.params.section === 'fin') return ecranFinContrat(ctx, contrat);
    return ecranFiche(ctx, contrat);
  }

  /* ------------------------------------------------------------------ */
  /* Fiche contrat                                                       */
  /* ------------------------------------------------------------------ */

  function ecranFiche(ctx, contrat) {
    global.App.barreRetour(ctx.barre, 'Contrat — ' + contrat.prenom_enfant, {
      droite: contrat.archive ? 'rangé' : libelleStatut(contrat.statut)
    });
    ctx.corps.appendChild(Kit.ce('div', 'attente', 'Lecture du contrat…'));

    return global.DB.getSalaires(contrat.id).then(function (salaires) {
      Kit.vider(ctx.corps);
      var corps = ctx.corps;

      corps.appendChild(Kit.section('Identité'));
      corps.appendChild(Kit.fld('Prénom de l’enfant', contrat.prenom_enfant));
      corps.appendChild(Kit.fld('Nom de la famille', (contrat.famille && contrat.famille.nom) || '—'));
      corps.appendChild(Kit.fld('Début du contrat', Kit.dateLongue(contrat.date_debut)));
      if (contrat.date_fin) corps.appendChild(Kit.fld('Fin du contrat', Kit.dateLongue(contrat.date_fin)));

      corps.appendChild(Kit.section('Horaires'));
      corps.appendChild(Kit.fld('Jours de garde', libellePlanning(contrat.jours_planning)));
      corps.appendChild(Kit.fld('Horaire contractuel',
        heureCourte(contrat.heure_arrivee) + ' → ' + heureCourte(contrat.heure_depart)));
      corps.appendChild(Kit.fld('Heures sup par jour travaillé', Kit.duree(contrat.minutes_sup_jour)));

      corps.appendChild(Kit.section('Rémunération'));
      var m = global.App.moisCourant();
      var enVigueur = Engine.salaireApplicable(salaires || [], m.annee, m.mois);
      if (enVigueur) {
        corps.appendChild(Kit.fld('Barème en cours', Kit.eur(enVigueur.brut_mensuel_centimes) + ' brut'));
        corps.appendChild(Kit.fld('Salaire net', enVigueur.net_mensuel_centimes
          ? Kit.eur(enVigueur.net_mensuel_centimes) : 'non renseigné'));
        corps.appendChild(Kit.fld('En vigueur depuis le', Kit.dateLongue(enVigueur.date_effet)));
      } else {
        corps.appendChild(Kit.warnbox('Aucune rémunération connue',
          'Tant qu’aucun barème n’est enregistré, les montants de ce contrat restent à zéro ' +
          'et ses mois ne peuvent pas être clôturés.'));
      }
      corps.appendChild(Kit.fld('Entretien par jour de présence', Kit.eur(contrat.entretien_centimes_jour)));

      if (!contrat.archive) {
        var bBareme = Kit.bouton('menu', function () { feuilleBareme(contrat, salaires || []); });
        var tx = Kit.ce('span');
        tx.appendChild(document.createTextNode('Nouveau barème'));
        tx.appendChild(Kit.ce('span', 'd', 'Au prochain relèvement du SMIC'));
        bBareme.appendChild(tx);
        bBareme.appendChild(Kit.ce('span', 'ar', '›'));
        corps.appendChild(bBareme);
      }
      if ((salaires || []).length > 1) {
        corps.appendChild(barèmesPasses(salaires, enVigueur));
      }

      corps.appendChild(Kit.section('Règles de ce contrat'));
      corps.appendChild(Kit.fld('Congés déduits d’abord',
        contrat.ordre_imputation === 'sup_puis_cp' ? 'récupération' : 'congés payés'));
      corps.appendChild(Kit.fld('Heures sup si l’enfant est ' + Kit.accord('absent'),
        contrat.sup_dues_si_enfant_absent === false ? 'non dues' : 'dues'));
      corps.appendChild(Kit.fld('Majoration fin de contrat', '+50 %'));
      if (!contrat.archive) {
        var bRegles = Kit.bouton('btn nt', function () { feuilleRegles(contrat); });
        bRegles.textContent = 'Modifier ces règles';
        corps.appendChild(bRegles);
      }
      corps.appendChild(Kit.ce('p', 'sb q',
        'Ces règles gouvernent vos calculs. Les modifier ne touche jamais un mois déjà clôturé. ' +
        'La majoration de fin de contrat est une clause écrite au contrat : elle ne se règle pas ici.'));

      if (contrat.archive) {
        corps.appendChild(Kit.note('Contrat rangé',
          'Il n’apparaît plus sur l’Accueil. Tout son historique reste consultable ' +
          'depuis « Anciens contrats ».'));
        var bRemettre = Kit.bouton('btn nt', function () { remettreEnCours(contrat, bRemettre); });
        bRemettre.textContent = 'Remettre ce contrat en cours';
        corps.appendChild(bRemettre);
      } else {
        var bFin = Kit.bouton('btn dg', function () {
          global.App.aller('fiche', { contratId: contrat.id, section: 'fin' });
        });
        bFin.textContent = 'Ce contrat est terminé';
        corps.appendChild(bFin);
      }
    });
  }

  function barèmesPasses(salaires, enVigueur) {
    var p = Kit.pane('Barèmes enregistrés');
    var l = Kit.lines(p);
    salaires.slice().sort(function (a, b) { return a.date_effet < b.date_effet ? 1 : -1; })
      .forEach(function (s) {
        Kit.ligne(l, 'Depuis le ' + Kit.dateLongue(s.date_effet) +
          (enVigueur && enVigueur.id === s.id ? ' (en cours)' : ''),
          Kit.eur(s.net_mensuel_centimes) + ' net');
      });
    return p;
  }

  function libelleStatut(s) {
    return { familiarisation: 'familiarisation', actif: 'actif', termine: 'terminé' }[s] || s;
  }
  function heureCourte(h) { return String(h || '').slice(0, 5) || '—'; }
  var NOMS_JOURS = ['', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'];
  function libellePlanning(planning) {
    var p = (planning || [1, 2, 3, 4, 5]).slice().sort(function (a, b) { return a - b; });
    if (!p.length) return '—';
    var continu = p.every(function (j, i) { return i === 0 || j === p[i - 1] + 1; });
    if (continu && p.length > 2) return NOMS_JOURS[p[0]] + ' → ' + NOMS_JOURS[p[p.length - 1]];
    return p.map(function (j) { return NOMS_JOURS[j]; }).join(', ');
  }

  /* ------------------------------------------------------------------ */
  /* Nouveau barème (RG-15)                                              */
  /* ------------------------------------------------------------------ */

  /* Saisie française d'un montant -> centimes entiers. Mise en forme d'entrée,
     pas un calcul : le point n'est un séparateur décimal que sans virgule. */
  function parseEuros(txt) {
    if (txt == null) return null;
    var norm = String(txt).replace(/[\s €]/g, '');
    if (norm === '') return null;
    if (norm.indexOf(',') !== -1) norm = norm.replace(/\./g, '').replace(',', '.');
    if (!/^\d+(\.\d+)?$/.test(norm)) return null;
    var v = parseFloat(norm);
    if (isNaN(v) || v < 0) return null;
    return Math.round(v * 100);
  }

  /* Premier mois RÉELLEMENT touché par une date d'effet. On n'invente aucune
     règle : c'est le test de RG-15 tel qu'implémenté par salaireApplicable
     (« date_effet <= 1er jour du mois »). Ici la date est toujours un 1er du
     mois — le sélecteur ne propose que cela. */
  function premierMoisImpacte(dateEffet) {
    var m = Chaine.moisDeDate(dateEffet);
    if (dateEffet <= Chaine.premierJour(m.annee, m.mois)) return m;
    return Chaine.moisSuivant(m.annee, m.mois);
  }

  function analyserDateEffet(dateEffet, recaps) {
    var m = premierMoisImpacte(dateEffet);
    var clos = [], brouillons = [];
    (recaps || []).forEach(function (r) {
      if (Chaine.cmpMois(r.annee, r.mois, m.annee, m.mois) < 0) return;
      if (r.statut === 'fige') clos.push(r); else brouillons.push(r);
    });
    var tri = function (a, b) { return Chaine.cmpMois(a.annee, a.mois, b.annee, b.mois); };
    clos.sort(tri); brouillons.sort(tri);
    return { clos: clos, brouillons: brouillons };
  }

  function listeMois(rs) {
    return rs.map(function (r) { return Kit.libelleMoisAnnee(r.annee, r.mois); }).join(', ');
  }

  function feuilleBareme(contrat, salaires) {
    var m = global.App.moisCourant();
    var prochain = Chaine.moisSuivant(m.annee, m.mois);
    var autres = global.App.contrats().filter(function (c) { return c.id !== contrat.id; });

    Kit.ouvrirFeuille('Nouveau barème', contrat.prenom_enfant +
      ' — le net se lit sur la fiche de paie, il ne se calcule pas.',
      function (corps) {
        var date = Kit.champMois('À partir du',
          Kit.iso(prochain.annee, prochain.mois, 1),
          { anneeMin: m.annee - 2, anneeMax: m.annee + 2 });
        corps.appendChild(date.bloc);

        var brut = Kit.champ('Salaire brut', '', { placeholder: '1 401,20', inputmode: 'decimal' });
        corps.appendChild(brut.bloc);
        var net = Kit.champ('Salaire net', '', { placeholder: '1 094,60', inputmode: 'decimal' });
        corps.appendChild(net.bloc);

        var cases = [];
        if (autres.length) {
          corps.appendChild(Kit.section('Appliquer aussi à'));
          autres.forEach(function (c) {
            var f = Kit.ce('div', 'fld');
            var lab = Kit.ce('label', 'lb', c.prenom_enfant +
              (c.famille && c.famille.nom ? ' · ' + c.famille.nom : ''));
            lab.style.flex = '1';
            var cb = Kit.ce('input');
            cb.type = 'checkbox';
            cb.checked = true;
            cb.style.flex = '0 0 auto';
            cb.style.width = '22px';
            cb.style.height = '22px';
            lab.appendChild(cb);
            f.appendChild(lab);
            corps.appendChild(f);
            cases.push({ contrat: c, cb: cb });
          });
          corps.appendChild(Kit.ce('p', 'sb q',
            'Le SMIC bouge pour tous les contrats le même jour. Décochez ceux qui ne changent pas.'));
        }

        corps.appendChild(Kit.note('Les mois déjà clôturés ne bougent pas',
          'Le nouveau montant s’appliquera à partir de ' +
          Kit.libelleMoisAnnee(prochain.annee, prochain.mois) + ', jamais avant.'));

        var msg = Kit.ce('div', 'msg');
        corps.appendChild(msg);

        var forcerSansNet = false;
        var b = Kit.bouton('btn', function () {
          enregistrer();
        });
        b.textContent = 'Enregistrer';
        corps.appendChild(b);

        function enregistrer() {
          msg.textContent = '';
          msg.className = 'msg';
          var dateEffet = date.valeur();
          var brutC = parseEuros(brut.input.value);
          var netC = parseEuros(net.input.value);

          if (brutC == null) { erreur('Le salaire brut est illisible (exemple : 1 401,20).'); return; }
          if (netC == null && !forcerSansNet) {
            forcerSansNet = true;
            b.textContent = 'Enregistrer sans le net';
            erreur('Sans le net, les récapitulatifs des mois concernés resteront incomplets. ' +
              'Touchez de nouveau pour enregistrer quand même.');
            return;
          }

          var choisis = [contrat].concat(cases.filter(function (x) { return x.cb.checked; })
            .map(function (x) { return x.contrat; }));

          b.disabled = true;
          msg.className = 'msg';
          msg.textContent = 'Vérification des mois clôturés…';

          Promise.all(choisis.map(function (c) {
            return Promise.all([global.DB.getSalaires(c.id), global.DB.listRecapsContrat(c.id)])
              .then(function (r) {
                var analyse = analyserDateEffet(dateEffet, r[1]);
                var doublon = (r[0] || []).some(function (s) { return s.date_effet === dateEffet; });
                var refus = null;
                if (doublon) refus = 'un barème existe déjà à cette date';
                else if (analyse.clos.length) refus = 'mois déjà clôturé(s) : ' + listeMois(analyse.clos);
                return { contrat: c, refus: refus };
              });
          })).then(function (verifs) {
            var refuses = verifs.filter(function (v) { return v.refus; });
            var acceptes = verifs.filter(function (v) { return !v.refus; });
            if (!acceptes.length) {
              b.disabled = false;
              erreur('Enregistrement refusé — ' + refuses.map(function (v) {
                return v.contrat.prenom_enfant + ' : ' + v.refus;
              }).join(' · ') + '. Choisissez un mois postérieur au dernier mois clôturé.');
              return null;
            }
            msg.textContent = 'Enregistrement…';
            return Promise.all(acceptes.map(function (v) {
              return global.DB.ajouterSalaire(v.contrat.id, {
                date_effet: dateEffet,
                brut_mensuel_centimes: brutC,
                net_mensuel_centimes: netC == null ? 0 : netC
              });
            })).then(function () {
              global.App.invalider();
              Kit.fermerFeuille();
              Kit.toast(acceptes.length + ' barème(s) enregistré(s)' +
                (refuses.length ? ' · ' + refuses.length + ' refusé(s), mois déjà clôturés' : ''));
              return global.App.rafraichir();
            });
          }).catch(function (e) {
            b.disabled = false;
            erreur('Enregistrement impossible : ' + Kit.messageErreur(e) + ' Rien n’a été enregistré.');
          });
        }

        function erreur(t) { msg.textContent = t; msg.className = 'msg ko'; }
      });
  }

  /* ------------------------------------------------------------------ */
  /* Les deux règles paramétrables (RG-07, RG-09)                        */
  /* ------------------------------------------------------------------ */

  /* Elles sont en base depuis le lot 2 et modifiables depuis le lot 5 : cette
     capacité ne disparaît pas dans un lot d'interface. Elles ont déjà changé
     une fois (Maria a inversé l'ordre d'imputation), et la règle des heures
     supplémentaires en cas d'absence de l'enfant est toujours « en réflexion »
     au cahier des charges. On avertit clairement : les mois NON clôturés
     seront recalculés, les mois clôturés ne bougeront pas. */
  function feuilleRegles(contrat) {
    Kit.ouvrirFeuille('Règles de ' + contrat.prenom_enfant,
      'Elles décident comment vos congés et vos heures sont comptés.',
      function (corps) {
        var ordre = Kit.champSelect('Congés déduits d’abord', [
          ['cp_puis_sup', 'congés payés'],
          ['sup_puis_cp', 'récupération']
        ], contrat.ordre_imputation || 'cp_puis_sup');
        corps.appendChild(ordre.bloc);

        var sup = Kit.champSelect('Heures sup si l’enfant est ' + Kit.accord('absent'), [
          ['true', 'dues'],
          ['false', 'non dues']
        ], contrat.sup_dues_si_enfant_absent === false ? 'false' : 'true');
        corps.appendChild(sup.bloc);

        corps.appendChild(Kit.warnbox('Ce changement recalcule les mois non clôturés',
          'Tous les mois de ce contrat qui ne sont pas encore clôturés seront recalculés avec ' +
          'ces règles, y compris des mois passés. Les mois déjà clôturés ne bougeront pas.'));

        var msg = Kit.ce('div', 'msg');
        corps.appendChild(msg);
        var b = Kit.bouton('btn', function () {
          b.disabled = true;
          msg.className = 'msg';
          msg.textContent = 'Enregistrement…';
          global.DB.majContrat(contrat.id, {
            ordre_imputation: ordre.select.value,
            sup_dues_si_enfant_absent: sup.select.value === 'true'
          }).then(function () {
            Kit.fermerFeuille();
            Kit.toast('Règles enregistrées');
            return global.App.rechargerContrats();
          }).then(function () {
            return global.App.rafraichir();
          }).catch(function (e) {
            b.disabled = false;
            msg.className = 'msg ko';
            msg.textContent = 'Enregistrement impossible : ' + Kit.messageErreur(e) + ' Rien n’a changé.';
          });
        });
        b.textContent = 'Enregistrer ces règles';
        corps.appendChild(b);
      });
  }

  /* ------------------------------------------------------------------ */
  /* Fin de contrat (RG-13)                                              */
  /* ------------------------------------------------------------------ */

  function ecranFinContrat(ctx, contrat) {
    global.App.barreRetour(ctx.barre, 'Fin du contrat — ' + contrat.prenom_enfant, { fermer: true });
    var corps = ctx.corps;

    corps.appendChild(Kit.note('Rien n’est supprimé',
      'Le contrat sort de l’Accueil et de la saisie, mais tout son historique reste consultable ' +
      'depuis « Anciens contrats ». C’est réversible.'));

    var date = Kit.champDate('Dernier jour de garde', global.App.aujourdhui(), {
      anneeMin: Number(String(contrat.date_debut).slice(0, 4)),
      anneeMax: global.App.moisCourant().annee + 1
    });
    corps.appendChild(date.bloc);

    var zone = Kit.ce('div');
    corps.appendChild(zone);

    var bSoldes = Kit.bouton('btn nt', function () { afficherSoldes(zone, contrat, date.valeur()); });
    bSoldes.textContent = 'Calculer les soldes de fin de contrat';
    corps.appendChild(bSoldes);

    var bFin = Kit.bouton('btn dg', function () { demanderFin(contrat, date.valeur()); });
    bFin.textContent = 'Ranger ce contrat';
    corps.appendChild(bFin);

    return Promise.resolve();
  }

  function afficherSoldes(zone, contrat, dateFin) {
    Kit.vider(zone);
    if (dateFin < contrat.date_debut) {
      zone.appendChild(Kit.warnbox('Date impossible',
        'Le dernier jour de garde ne peut pas précéder le début du contrat.'));
      return;
    }
    zone.appendChild(Kit.ce('div', 'attente', 'Calcul des soldes…'));

    /* Copie du contrat bornée à la date saisie : le moteur doit voir la fin
       pour ne compter aucun jour au-delà. Rien n'est écrit en base. */
    var simule = {};
    Object.keys(contrat).forEach(function (k) { simule[k] = contrat[k]; });
    simule.date_fin = dateFin;
    var m = Chaine.moisDeDate(dateFin);

    Promise.all([
      Chaine.mois1(simule, m.annee, m.mois),
      global.DB.getSalaires(contrat.id)
    ]).then(function (r) {
      var entree = r[0];
      var salaires = r[1] || [];
      Kit.vider(zone);
      if (!entree) {
        zone.appendChild(Kit.ce('p', 'vide', 'Aucun mois calculable jusqu’à cette date.'));
        return;
      }
      var cs = entree.compteurSortie || {};
      var minutes = cs.minutesSup || 0;
      var cp = (cs.dixiemesCpAcquis || 0) - (cs.dixiemesCpPris || 0);

      var p = Kit.pane('Soldes au ' + Kit.dateLongue(dateFin));
      var l = Kit.lines(p);
      Kit.ligne(l, 'Récupération restante', Kit.heures(minutes));
      Kit.ligne(l, 'Congés payés restants', Kit.joursCp(cp));

      var salaire = Engine.salaireApplicable(salaires, m.annee, m.mois);
      if (salaire) {
        /* RG-13 : exactement la formule validée par le cas T6 du moteur. */
        var montant = Engine.montantCentimes(salaire.brut_mensuel_centimes,
          Math.max(0, minutes), COEFF_FIN_CONTRAT);
        Kit.ligne(l, 'Heures sup majorées de 50 % (indicatif)', Kit.eur(montant), { total: true });
      }
      zone.appendChild(p);

      zone.appendChild(Kit.note('À la fin du contrat',
        'Les congés payés restants sont payés sans majoration ; les heures supplémentaires ' +
        'sont payées avec une majoration de 50 %. Le montant des congés payés n’est pas calculé ' +
        'ici : la base de calcul n’est pas définie au cahier des charges. Notez ces chiffres, ' +
        'rien n’est enregistré.'));
      if (!entree.fige) {
        zone.appendChild(Kit.warnbox('Le dernier mois n’est pas clôturé',
          'Ces soldes resteront provisoires tant qu’il ne l’est pas.'));
      }
    }).catch(function (e) {
      Kit.vider(zone);
      zone.appendChild(Kit.warnbox('Calcul impossible', Kit.messageErreur(e)));
    });
  }

  function demanderFin(contrat, dateFin) {
    if (dateFin < contrat.date_debut) {
      Kit.toast('Le dernier jour de garde ne peut pas précéder le début du contrat.', true);
      return;
    }
    Kit.ouvrirFeuille('Ranger le contrat de ' + contrat.prenom_enfant + ' ?',
      'Dernier jour de garde : ' + Kit.dateLongue(dateFin),
      function (corps) {
        corps.appendChild(Kit.warnbox('Avez-vous noté les deux soldes ?',
          'Congés payés restants (payés sans majoration) et heures supplémentaires ' +
          '(payées avec 50 % de majoration). Ils restent consultables après le rangement, ' +
          'mais c’est le moment de les relever.'));
        corps.appendChild(Kit.ce('p', 'sb q',
          'Le contrat sortira de l’Accueil, de la saisie et des congés. Rien ne sera supprimé, ' +
          'et vous pourrez le remettre en cours.'));
        var b = Kit.bouton('btn dg', function () {
          b.disabled = true;
          global.DB.archiverContrat(contrat.id, dateFin)
            .then(function () {
              Kit.fermerFeuille();
              Kit.toast('Contrat de ' + contrat.prenom_enfant + ' rangé');
              return global.App.rechargerContrats();
            })
            .then(function () { return global.App.aller('accueil', {}, true); })
            .catch(function (e) {
              b.disabled = false;
              Kit.toast('Impossible de ranger ce contrat : ' + Kit.messageErreur(e) + ' Rien n’a changé.', true);
            });
        });
        b.textContent = 'Oui, ranger ce contrat';
        corps.appendChild(b);
      });
  }

  function remettreEnCours(contrat, bouton) {
    bouton.disabled = true;
    global.DB.desarchiverContrat(contrat.id)
      .then(function () {
        Kit.toast('Contrat de ' + contrat.prenom_enfant + ' remis en cours');
        return global.App.rechargerContrats();
      })
      .then(function () { return global.App.aller('accueil', {}, true); })
      .catch(function (e) {
        bouton.disabled = false;
        Kit.toast('Impossible : ' + Kit.messageErreur(e) + ' Rien n’a changé.', true);
      });
  }

  global.UiContrat = { afficher: afficher, COEFF_FIN_CONTRAT: COEFF_FIN_CONTRAT };
})(window);
