/* ============================================================================
   ui-reouverture.js — Rouvrir un mois clôturé pour le corriger (lot 13).

   Ce n'est pas un écran : c'est le petit ensemble de gestes que DEUX écrans
   partagent, l'espace enfant et le document. Les y dupliquer aurait produit
   deux textes qui divergent au premier correctif — et ces textes-là sont ce
   qui reste quand la garantie technique s'assouplit.

   Ce que le lot 13 change dans la philosophie de l'application : jusqu'ici,
   ce qui protégeait Maria était l'IMPOSSIBILITÉ de modifier un mois clôturé.
   Désormais c'est la TRACE de chaque modification. Tout ici sert cette
   bascule : on prévient avant, on inscrit pendant, on montre les écarts après.

   Aucun calcul métier ici : la comparaison des instantanés est une fonction
   pure de chaine-mois.js (B.0-5).
   ========================================================================= */
(function (global) {
  'use strict';

  var Kit = global.Kit;
  var Chaine = global.ChaineMois;

  /* '2026-05-31T18:42:00Z' -> '31 mai 2026 à 18h42' */
  function dateHeure(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    var hh = String(d.getHours()).padStart(2, '0');
    var mm = String(d.getMinutes()).padStart(2, '0');
    return Kit.dateLongue(iso) + ' à ' + hh + 'h' + mm;
  }

  function nomDeLaFamille(contrat) {
    return (contrat && contrat.famille && contrat.famille.nom) ? contrat.famille.nom : null;
  }

  /* ------------------------------------------------------------------ */
  /* 1. Les deux actions sous le bandeau d'un mois clôturé              */
  /* ------------------------------------------------------------------ */

  /* opts = { contrat, annee, mois, recap, apres } — `apres` est rappelé après
     une réouverture réussie, pour que l'écran appelant se rafraîchisse. */
  function actionsMoisCloture(corps, opts) {
    var recap = opts.recap;
    if (!recap) return;

    if (recap.transmis_le) {
      corps.appendChild(Kit.ce('p', 'msg',
        'Récapitulatif transmis à la famille le ' + Kit.dateLongue(recap.transmis_le) + '.'));
    }

    var bHisto = Kit.bouton('btn nt', function () { feuilleHistorique(opts); });
    bHisto.textContent = 'Voir l’historique de ce mois';
    corps.appendChild(bHisto);

    var bRouvrir = Kit.bouton('btn nt', function () { feuilleRouvrir(opts); });
    bRouvrir.textContent = 'Rouvrir pour corriger';
    corps.appendChild(bRouvrir);
  }

  /* ------------------------------------------------------------------ */
  /* 2. Feuille de confirmation de réouverture                          */
  /* ------------------------------------------------------------------ */

  function feuilleRouvrir(opts) {
    var contrat = opts.contrat;
    var recap = opts.recap;
    var famille = nomDeLaFamille(contrat);
    var libelleMois = Kit.libelleMoisAnnee(opts.annee, opts.mois);
    var champMotif = null;

    Kit.ouvrirFeuille('Rouvrir ' + libelleMois + ' ?',
      contrat.prenom_enfant + (famille ? ' · famille ' + famille : ''),
      function (corps) {
        if (recap && recap.transmis_le) {
          /* Le texte change, l'action reste possible : c'est une décision
             d'Adrien du 10 août 2026, sur demande de Maria. On avertit, on
             n'interdit pas. */
          corps.appendChild(Kit.warnbox(
            'Vous avez transmis ce récapitulatif' + (famille ? ' à la famille ' + famille : '') +
            ' le ' + Kit.dateLongue(recap.transmis_le),
            'Si vous modifiez ce mois, les chiffres ne correspondront plus au document ' +
            'qu’elle a reçu : il faudra le lui renvoyer. La réouverture sera inscrite ' +
            'dans l’historique du mois.'));
        } else {
          corps.appendChild(Kit.note('Vous pourrez corriger, puis clôturer à nouveau',
            'Vous pourrez modifier les journées de ce mois, puis le clôturer une seconde fois. ' +
            'La réouverture sera inscrite dans l’historique du mois.'));
        }

        var motif = Kit.champ('Pourquoi ? (facultatif)', '',
          { placeholder: 'Oubli d’une absence, erreur de saisie…' });
        champMotif = motif.input;
        corps.appendChild(motif.bloc);

        var b = Kit.bouton('btn', function (ev) { rouvrir(opts, champMotif, ev.currentTarget); });
        b.textContent = 'Rouvrir le mois';
        corps.appendChild(b);
      });
  }

  function rouvrir(opts, champMotif, bouton) {
    var motif = champMotif && champMotif.value ? champMotif.value.trim() : null;
    /* L'instantané d'origine est capturé AVANT la réouverture : c'est lui que
       « Annuler » réécrira, sans aucun recalcul. Annuler une action sans effet
       ne doit pas produire d'effet. */
    var instantaneOrigine = opts.recap && opts.recap.donnees ? opts.recap.donnees : null;

    if (bouton) bouton.disabled = true;
    global.DB.rouvrirRecap(opts.contrat.id, opts.annee, opts.mois, motif)
      .then(function (ligne) {
        global.App.invalider();
        Kit.fermerFeuille();
        if (!ligne) {
          Kit.toast('Ce mois n’était plus clôturé — depuis un autre appareil, sans doute.');
        } else {
          Kit.toast(Kit.moisCapitale(opts.annee, opts.mois) + ' est rouvert. Vous pouvez le modifier.',
            false,
            instantaneOrigine ? {
              libelle: 'Annuler',
              onclick: function () { annulerReouverture(opts, instantaneOrigine); }
            } : null);
        }
        if (typeof opts.apres === 'function') return opts.apres();
        return global.App.rafraichir();
      })
      .catch(function (e) {
        if (bouton) bouton.disabled = false;
        Kit.toast('Réouverture impossible : ' + Kit.messageErreur(e) +
          ' Le mois reste clôturé.', true);
      });
  }

  /* « Annuler » reclôture immédiatement AVEC L'INSTANTANÉ D'ORIGINE, sans
     recalcul. Les deux événements restent dans l'historique : on n'efface
     jamais une trace, on en ajoute une. */
  function annulerReouverture(opts, instantaneOrigine) {
    global.DB.recloturerRecap(opts.contrat.id, opts.annee, opts.mois, instantaneOrigine)
      .then(function (ligne) {
        global.App.invalider();
        Kit.toast(ligne
          ? Kit.moisCapitale(opts.annee, opts.mois) + ' est de nouveau clôturé.'
          : 'Ce mois était déjà clôturé.');
        if (typeof opts.apres === 'function') return opts.apres();
        return global.App.rafraichir();
      })
      .catch(function (e) {
        Kit.toast('Impossible de reclôturer : ' + Kit.messageErreur(e) +
          ' Le mois est resté ouvert, vous pouvez le clôturer depuis le document.', true);
      });
  }

  /* ------------------------------------------------------------------ */
  /* 3. Historique d'un mois                                            */
  /* ------------------------------------------------------------------ */

  var LIBELLES = {
    reouverture: 'Rouvert',
    transmission: 'Transmis à la famille'
  };

  function feuilleHistorique(opts) {
    var libelleMois = Kit.libelleMoisAnnee(opts.annee, opts.mois);
    Kit.ouvrirFeuille('Historique de ' + libelleMois, opts.contrat.prenom_enfant,
      function (corps) {
        var attente = Kit.ce('div', 'attente', 'Lecture de l’historique…');
        corps.appendChild(attente);

        global.DB.listEvenementsRecap(opts.recap.id)
          .then(function (evenements) {
            Kit.vider(corps);
            corps.appendChild(listeEvenements(evenements));
            corps.appendChild(Kit.note('Cet historique ne peut pas être effacé',
              'Il montre que vos comptes sont tenus à jour.'));
          })
          .catch(function (e) {
            Kit.vider(corps);
            var msg = Kit.ce('p', 'msg ko',
              'Historique indisponible : ' + Kit.messageErreur(e));
            corps.appendChild(msg);
          });
      });
  }

  /* `listEvenementsRecap` rend du plus ancien au plus récent ; l'écran lit du
     plus récent au plus ancien. C'est ICI, et nulle part ailleurs, qu'on
     inverse — ne pas inverser deux fois. */
  function listeEvenements(evenements) {
    var liste = Kit.ce('div');
    if (!evenements || !evenements.length) {
      liste.appendChild(Kit.ce('p', 'vide', 'Aucun événement enregistré pour ce mois.'));
      return liste;
    }

    /* Le rang de clôture se compte dans l'ordre chronologique : la première
       est « Clôturé », les suivantes « Clôturé à nouveau ». */
    var nbClotures = 0;
    var libelles = evenements.map(function (ev) {
      if (ev.type === 'cloture') {
        nbClotures++;
        return nbClotures === 1 ? 'Clôturé' : 'Clôturé à nouveau';
      }
      return LIBELLES[ev.type] || ev.type;
    });

    for (var i = evenements.length - 1; i >= 0; i--) {
      var ev = evenements[i];
      var carte = Kit.ce('div', 'card');
      var ligne = Kit.ce('div', 'row');
      ligne.appendChild(Kit.ce('span', 'nm', libelles[i]));
      carte.appendChild(ligne);
      carte.appendChild(Kit.ce('div', 'sb', dateHeure(ev.survenu_le)));
      if (ev.motif) carte.appendChild(Kit.ce('div', 'sb q', ev.motif));
      liste.appendChild(carte);
    }
    return liste;
  }

  /* ------------------------------------------------------------------ */
  /* 4. Reclôture : montrer les écarts avant d'écrire                   */
  /* ------------------------------------------------------------------ */

  /* `cp` : les congés payés se comptent en DIXIÈMES de jour dans tout le
     moteur. Sans ce cas, 25 dixièmes s'afficheraient « 25 j » au lieu de
     « 2,5 j » — un écart de compteur lu dix fois trop grand, dans l'écran
     dont le seul rôle est de dire la vérité sur ce qui change. */
  function valeurFormatee(valeur, format) {
    if (format === 'euros') return Kit.eur(valeur);
    if (format === 'minutes') return Kit.heures(valeur);
    if (format === 'cp') return Kit.joursCp(valeur);
    return Kit.jours(valeur);
  }

  /* opts = { contrat, annee, mois, recap, ecarts, confirmer(bouton) }
     N'est appelée que s'il y a au moins un écart : sans écart, on reclôture
     directement, sans écran intermédiaire. */
  function feuilleEcarts(opts) {
    var famille = nomDeLaFamille(opts.contrat);
    Kit.ouvrirFeuille('Ce qui change par rapport au document déjà établi',
      Kit.libelleMoisAnnee(opts.annee, opts.mois) + ' · ' + opts.contrat.prenom_enfant,
      function (corps) {
        var lignes = Kit.ce('div', 'lines');
        opts.ecarts.forEach(function (ec) {
          Kit.ligne(lignes, ec.libelle,
            valeurFormatee(ec.ancien, ec.format) + ' → ' + valeurFormatee(ec.nouveau, ec.format));
        });
        corps.appendChild(lignes);

        if (opts.recap && opts.recap.transmis_le) {
          corps.appendChild(Kit.warnbox(
            (famille ? 'La famille ' + famille + ' a reçu' : 'La famille a reçu') +
            ' l’ancienne version le ' + Kit.dateLongue(opts.recap.transmis_le),
            'Pensez à lui renvoyer le récapitulatif corrigé.'));
        }

        var b = Kit.bouton('btn', function (ev) { opts.confirmer(ev.currentTarget); });
        b.textContent = 'Clôturer avec ces valeurs';
        corps.appendChild(b);
      });
  }

  /* Calcule les écarts entre l'instantané déjà établi et celui qu'on
     s'apprête à écrire. Retourne [] si le mois n'a jamais été clôturé. */
  function ecarts(recap, nouvelInstantane) {
    var ancien = recap && recap.donnees ? recap.donnees : null;
    return Chaine.ecartsInstantanes(ancien, nouvelInstantane);
  }

  global.UiReouverture = {
    actionsMoisCloture: actionsMoisCloture,
    feuilleRouvrir: feuilleRouvrir,
    feuilleHistorique: feuilleHistorique,
    feuilleEcarts: feuilleEcarts,
    ecarts: ecarts,
    dateHeure: dateHeure
  };
})(window);
