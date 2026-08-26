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

    /* LOT 25 (A.2) — LE CAS NÉGATIF EST DIT, LUI AUSSI. Jusqu'ici, seul un
       récapitulatif DÉJÀ transmis était annoncé ; l'espace enfant portait, sur
       son bandeau de mois clôturé, la mention « Il n'a pas encore été
       transmis ». Ce bandeau a quitté l'espace enfant au lot 25 (§25.2) :
       l'information vient ici, juste au-dessus de la réouverture, où elle
       change quelque chose — rouvrir un mois déjà remis à la famille n'est
       pas le même geste que rouvrir un mois qu'elle n'a jamais vu. */
    corps.appendChild(Kit.ce('p', 'msg', recap.transmis_le
      ? 'Récapitulatif transmis à la famille le ' + Kit.dateLongue(recap.transmis_le) + '.'
      : 'Ce récapitulatif n’a pas encore été transmis à la famille.'));

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
  /* 2 bis. LOT 30 — ROUVRIR DEPUIS LÀ OÙ ON EST, ET POURSUIVRE LE GESTE  */
  /*                                                                     */
  /* « J'aimerais facilement pouvoir rouvrir un mois qui a été clôturé,  */
  /* je trouve que l'app manque de souplesse dans la saisie. » (Adrien)  */
  /*                                                                     */
  /* Le bon modèle existait à UN seul endroit : la pose d'un congé sur un */
  /* mois clôturé propose « Rouvrir ces N récapitulatifs et continuer ». */
  /* Partout ailleurs, un mois clôturé produisait un refus sec ou une     */
  /* cellule morte. Cette feuille est ce modèle, généralisé : elle NOMME  */
  /* ce qu'il faut rouvrir, PROPOSE de le faire, et POURSUIT le geste     */
  /* commencé. Le motif n'est plus demandé ici — demander une             */
  /* justification avant d'autoriser un geste légitime est la friction à  */
  /* retirer (§30.2) ; la base écrit l'événement de réouverture elle-même */
  /* (migration 006), motif ou non (A5).                                  */
  /*                                                                     */
  /* Ce qui ne s'assouplit pas : si la lecture des mois clôturés a        */
  /* échoué, l'appelant n'arrive pas ici — il refuse (A6, défaut B7).     */
  /* ------------------------------------------------------------------ */

  /* opts = {
       mois:      [{ contrat, annee, mois, recap }] — les récapitulatifs à
                  rouvrir (un par contrat et par mois) ;
       titre:     titre de la feuille (défaut : « Ce mois est clôturé » ou
                  « N mois sont clôturés ») ;
       question:  la phrase qui nomme le geste (« Le rouvrir pour corriger le
                  mardi 14 avril ? ») ;
       bouton:    libellé du bouton (« Rouvrir et corriger ce jour ») ;
       motif:     motif inscrit dans l'historique, ou null ;
       continuer: function () -> Promise, appelée UNE FOIS les mois rouverts ;
       annuler:   function (), facultative — rendre à Maria son formulaire.
     } */
  function feuilleRouvrirEtContinuer(opts) {
    var liste = (opts.mois || []).filter(Boolean);
    if (!liste.length) return Promise.resolve(opts.continuer());

    var moisNommes = [];
    var vus = {};
    liste.forEach(function (x) {
      var cle = x.annee + '-' + x.mois;
      if (vus[cle]) return;
      vus[cle] = true;
      moisNommes.push(Kit.libelleMoisAnnee(x.annee, x.mois));
    });
    var transmis = liste.filter(function (x) { return x.recap && x.recap.transmis_le; });
    var n = liste.length;
    var premier = liste[0];
    var titre = opts.titre || (moisNommes.length > 1
      ? moisNommes.length + ' mois sont clôturés'
      : 'Ce mois est clôturé');

    Kit.ouvrirFeuille(titre,
      liste.length === 1
        ? premier.contrat.prenom_enfant + ' — ' + Kit.libelleMoisAnnee(premier.annee, premier.mois)
        : moisNommes.join(', '),
      function (corps) {
        if (opts.question) corps.appendChild(Kit.ce('p', 'regle', opts.question));
        corps.appendChild(Kit.ce('p', 'sb q',
          (n > 1
            ? 'Cela rouvre ' + n + ' récapitulatifs — ' + moisNommes.join(', ') + '. '
            : '') +
          'La réouverture laisse une trace définitive dans l’historique du mois. ' +
          (n > 1 ? 'Ils seront' : 'Il sera') + ' à clôturer à nouveau ensuite.'));
        if (transmis.length) {
          corps.appendChild(Kit.warnbox(
            transmis.length > 1
              ? transmis.length + ' récapitulatifs ont déjà été transmis à la famille'
              : 'Ce récapitulatif a déjà été transmis à la famille' +
                (transmis[0].recap.transmis_le
                  ? ' le ' + Kit.dateLongue(transmis[0].recap.transmis_le) : ''),
            ' Si les chiffres changent, il faudra renvoyer la version corrigée.'));
        }

        var b = Kit.bouton('btn', function () { rouvrirTout(b); });
        b.textContent = opts.bouton || (n > 1
          ? 'Rouvrir ces ' + n + ' récapitulatifs et continuer'
          : 'Rouvrir ' + Kit.libelleMois(premier.mois) + ' et continuer');
        corps.appendChild(b);

        if (typeof opts.annuler === 'function') {
          var bRetour = Kit.bouton('btn nt', function () { opts.annuler(); });
          bRetour.textContent = opts.libelleAnnuler || 'Revenir en arrière';
          corps.appendChild(bRetour);
        }
      });

    function rouvrirTout(bouton) {
      bouton.disabled = true;
      var gestes = liste.map(function (x) {
        return global.DB.rouvrirRecap(x.contrat.id, x.annee, x.mois, opts.motif || null);
      });
      return Promise.all(gestes).then(function () {
        global.App.invalider();
        Kit.fermerFeuille();
        Kit.toast(n > 1
          ? n + ' récapitulatifs rouverts — à clôturer à nouveau ensuite.'
          : Kit.moisCapitale(premier.annee, premier.mois) + ' est rouvert — à clôturer à nouveau ensuite.');
        return opts.continuer();
      }).catch(function (e) {
        bouton.disabled = false;
        /* Plusieurs réouvertures ont pu aboutir avant l'échec : on ne
           promet pas que rien n'a bougé, on dit ce qu'on sait. */
        Kit.toast('La réouverture n’a pas abouti : ' + Kit.messageErreur(e) +
          (n > 1 ? ' Vérifiez l’état de chaque mois avant de recommencer.'
                 : ' Le mois reste clôturé, rien n’a été modifié.'), true);
      });
    }
  }

  /* LOT 30 (§30.4) — UN MOIS ROUVERT SE RECONNAÎT À SON RÉCAPITULATIF :
     statut « brouillon » ET un instantané conservé (`donnees`), celui du
     document remis. Un mois jamais clôturé n'a pas de récapitulatif du tout,
     ou pas d'instantané. */
  function moisRouvert(recap) { return Kit.moisRouvert(recap); }

  /* La date de la dernière réouverture d'un récapitulatif, lue dans son
     historique — la base l'écrit, l'écran la lit. `null` si l'historique ne
     peut pas être lu : le bandeau dit alors « rouvert » sans date, il ne
     devine pas. */
  function dateReouverture(recap) {
    if (!moisRouvert(recap) || !recap.id) return Promise.resolve(null);
    if (typeof global.DB.listEvenementsRecap !== 'function') return Promise.resolve(null);
    return global.DB.listEvenementsRecap(recap.id).then(function (evenements) {
      var derniere = null;
      (evenements || []).forEach(function (ev) {
        if (ev.type === 'reouverture') derniere = ev.survenu_le;
      });
      return derniere;
    }).catch(function () { return null; });
  }

  /* LOT 30 (§30.4) — LE BANDEAU D'UN MOIS ROUVERT, tant qu'il n'est pas
     reclôturé : la date de réouverture, la transmission s'il y a lieu, et le
     bouton qui reclôture. Rendu par l'appelant là où il veut. */
  function bandeauMoisRouvert(opts) {
    var recap = opts.recap;
    var bloc = Kit.warnbox(
      'Mois rouvert' + (opts.rouvertLe ? ' le ' + Kit.dateLongue(opts.rouvertLe) : '') +
      ' — à clôturer à nouveau',
      recap && recap.transmis_le
        ? ' Le récapitulatif avait été transmis à la famille le ' +
          Kit.dateLongue(recap.transmis_le) + ' : elle devra recevoir la version corrigée.'
        : ' Ses chiffres peuvent encore bouger tant qu’il n’est pas reclôturé.');
    /* §30.2 — le motif, facultatif, se saisit ICI, après coup. */
    if (recap && recap.audit_note) {
      bloc.appendChild(Kit.ce('div', 'sb q', 'Motif : ' + recap.audit_note));
    }
    if (typeof opts.recloturer === 'function') {
      var b = Kit.bouton('btn', function () { opts.recloturer(); });
      b.textContent = 'Reclôturer ' + Kit.libelleMois(opts.mois);
      bloc.appendChild(b);
    }
    if (opts.contrat && typeof global.DB.noterMotifRecap === 'function') {
      var bMotif = Kit.bouton('btn nt', function () { feuilleMotif(opts); });
      bMotif.textContent = recap && recap.audit_note ? 'Changer le motif' : 'Ajouter un motif';
      bloc.appendChild(bMotif);
    }
    return bloc;
  }

  function feuilleMotif(opts) {
    Kit.ouvrirFeuille('Pourquoi ce mois est-il rouvert ?',
      opts.contrat.prenom_enfant + ' — ' + Kit.libelleMoisAnnee(opts.annee, opts.mois),
      function (corps) {
        var champ = Kit.champ('Motif (facultatif)', (opts.recap && opts.recap.audit_note) || '',
          { placeholder: 'Oubli d’une absence, erreur de saisie…' });
        corps.appendChild(champ.bloc);
        corps.appendChild(Kit.ce('p', 'sb q',
          'Pour vous seule. Il reste lisible sur ce mois, même une fois reclôturé.'));
        var b = Kit.bouton('btn', function () {
          b.disabled = true;
          global.DB.noterMotifRecap(opts.contrat.id, opts.annee, opts.mois, champ.input.value)
            .then(function () {
              global.App.invalider();
              Kit.fermerFeuille();
              Kit.toast('Motif enregistré');
              return global.App.rafraichir();
            })
            .catch(function (e) {
              b.disabled = false;
              Kit.toast('Motif non enregistré : ' + Kit.messageErreur(e), true);
            });
        });
        b.textContent = 'Enregistrer le motif';
        corps.appendChild(b);
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
    Kit.ouvrirFeuille('Historique ' + Kit.deMoisAnnee(opts.annee, opts.mois),
      opts.contrat.prenom_enfant,
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

  /* `cp` : les congés payés se comptent en MINUTES dans tout le moteur depuis
     le lot 17 (§17.6), et s'affichent en jours. Sans ce cas, 1 350 minutes
     s'afficheraient « 1 350 j » au lieu de « 2,5 j » — un écart de compteur
     illisible, dans l'écran dont le seul rôle est de dire la vérité sur ce qui
     change. Le facteur vient des conditions du mois rouvert. */
  function valeurFormatee(valeur, format, minutesParJourConge) {
    if (format === 'euros') return Kit.eur(valeur);
    if (format === 'minutes') return Kit.heures(valeur);
    if (format === 'cp') return Kit.joursCp(valeur, minutesParJourConge);
    return Kit.jours(valeur);
  }

  /* opts = { contrat, annee, mois, recap, ecarts, minutesParJourConge,
              confirmer(bouton) }
     N'est appelée que s'il y a au moins un écart : sans écart, on reclôture
     directement, sans écran intermédiaire. */
  function feuilleEcarts(opts) {
    var famille = nomDeLaFamille(opts.contrat);
    var nb = (opts.ecarts || []).length;
    /* LOT 30 (§30.5) — LE TITRE COMPTE ET DATE : « 3 écarts avec le document
       remis le 3 mai ». Plus il est facile de rouvrir, plus il doit être
       impossible de reclôturer sans voir ce qu'on a changé. */
    var reference = opts.recap && opts.recap.transmis_le
      ? 'remis le ' + Kit.dateLongue(opts.recap.transmis_le)
      : (opts.recap && opts.recap.fige_le
          ? 'établi le ' + Kit.dateLongue(opts.recap.fige_le) : 'déjà établi');
    Kit.ouvrirFeuille(
      (nb > 1 ? nb + ' écarts' : '1 écart') + ' avec le document ' + reference,
      Kit.libelleMoisAnnee(opts.annee, opts.mois) + ' · ' + opts.contrat.prenom_enfant,
      function (corps) {
        var lignes = Kit.ce('div', 'lines');
        opts.ecarts.forEach(function (ec) {
          Kit.ligne(lignes, ec.libelle,
            valeurFormatee(ec.ancien, ec.format, opts.minutesParJourConge) + ' → ' +
            valeurFormatee(ec.nouveau, ec.format, opts.minutesParJourConge));
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
    /* LOT 30 — le modèle du congé, généralisé. */
    feuilleRouvrirEtContinuer: feuilleRouvrirEtContinuer,
    moisRouvert: moisRouvert,
    dateReouverture: dateReouverture,
    bandeauMoisRouvert: bandeauMoisRouvert,
    feuilleHistorique: feuilleHistorique,
    feuilleEcarts: feuilleEcarts,
    ecarts: ecarts,
    dateHeure: dateHeure
  };
})(window);
