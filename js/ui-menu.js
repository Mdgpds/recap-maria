/* ============================================================================
   ui-menu.js — Onglet « Menu » (§1 des specs).

   Tout ce qui ne se fait pas tous les jours : consulter une période, rouvrir un
   ancien contrat, ajouter un enfant, se déconnecter.

   Un point mérite d'être dit ici plutôt qu'en commentaire perdu : les ANCIENS
   CONTRATS ouvrent LE MÊME espace enfant que les contrats en cours, en lecture
   seule. Pas un écran d'archive appauvri : le même calendrier, les mêmes
   panneaux, le même historique. Une pièce justificative se relit exactement
   comme elle a été produite.

   Aucun calcul ici, aucune règle. Les créations passent par DB.
   ========================================================================= */
(function (global) {
  'use strict';

  var Kit = global.Kit;
  var Chaine = global.ChaineMois;
  var Format = global.Format;
  var Feries = global.Feries;

  function afficher(ctx) {
    if (ctx.vue === 'familles') return afficherFamilles(ctx);
    if (ctx.vue === 'modeles') return afficherModeles(ctx);
    if (ctx.vue === 'modifGroupee') return afficherModifGroupee(ctx);
    if (ctx.vue === 'reprise') return afficherReprise(ctx);
    if (ctx.vue === 'rappels') return afficherRappels(ctx);
    return afficherMenu(ctx);
  }

  function afficherMenu(ctx) {
    ctx.barre.className = 'bar';
    ctx.barre.appendChild(Kit.ce('span', 'ti', 'Menu'));
    var corps = ctx.corps;

    /* LOT 8 — la rubrique « Consulter » DISPARAÎT.
       « Récapitulatif sur une période » et « Anciens contrats » vivaient ici,
       à deux gestes de profondeur, dans un menu qu'on n'ouvre que quand on
       cherche quelque chose. Ils sont désormais sur l'onglet Historique, qui
       est justement l'endroit où l'on va chercher le passé. Le Menu ne garde
       que ce qu'on y attend : gérer, et son compte. */

    corps.appendChild(Kit.section('Gérer'));
    corps.appendChild(entree('Familles', 'Chargement…',
      function () { global.App.aller('familles', {}); }));
    corps.appendChild(entree('Mes contrats types', 'Vos conditions habituelles, en versions datées',
      function () { global.App.aller('modeles', {}); }));
    corps.appendChild(entree('Modifier plusieurs contrats', 'Une chose à la fois, sur les contrats que vous choisissez',
      function () { global.App.aller('modifGroupee', {}); }));
    corps.appendChild(entree('Ajouter un enfant', 'Une famille, un enfant, une date de début',
      function () { feuilleNouvelEnfant(); }));

    corps.appendChild(Kit.section('Compte'));
    corps.appendChild(entree('Me rappeler de clôturer mes mois',
      'Chargement…',
      function () { global.App.aller('rappels', {}); }));
    corps.appendChild(entree('Reprendre mes comptes',
      'Si vous teniez déjà vos comptes sur papier',
      function () { global.App.aller('reprise', {}); }));
    corps.appendChild(entree('Exporter tout mon historique',
      'Tous vos mois, tous vos contrats. À garder de côté.',
      function () { feuilleExport(); }));
    corps.appendChild(Kit.fld('Connectée', global.App.email() || '—'));
    var bOut = Kit.bouton('btn nt', function () { deconnecter(bOut); });
    bOut.textContent = 'Se déconnecter';
    corps.appendChild(bOut);
    corps.appendChild(Kit.ce('p', 'sb q',
      'Vous restez connectée d’une fois sur l’autre : ce bouton est le seul moyen de fermer ' +
      'votre session.'));

    var ligneFamilles = corps.querySelectorAll('.menu')[0];
    return global.DB.listFamillesAvecContrats().then(function (familles) {
      var sous = ligneFamilles && ligneFamilles.querySelector('.d');
      if (!sous) return;
      var enCours = (familles || []).filter(function (f) { return !f.archive; });
      sous.textContent = enCours.length
        ? enCours.map(function (f) { return f.nom; }).join(', ')
        : 'Aucune famille pour l’instant';
    }).catch(function () {
      var sous = ligneFamilles && ligneFamilles.querySelector('.d');
      if (sous) sous.textContent = 'Liste indisponible pour l’instant';
    });
  }

  /* La version en vigueur à une date : la plus récente dont la date d'effet
     est antérieure ou égale. Même règle que `salaireApplicable` du moteur —
     ce qui vaut à une date ne dépend pas de ce qui a été décidé après.
     Calculée ici plutôt que par un appel : la liste est déjà en mémoire. */
  function modeleApplicable(modeles, dateIso) {
    var retenu = null;
    (modeles || []).forEach(function (m) {
      if (m.date_effet <= dateIso && (!retenu || m.date_effet > retenu.date_effet)) retenu = m;
    });
    return retenu;
  }

  function entree(titre, sous, onclick) {
    var b = onclick ? Kit.bouton('menu', onclick) : Kit.ce('div', 'menu');
    var tx = Kit.ce('span');
    tx.appendChild(document.createTextNode(titre));
    if (sous) tx.appendChild(Kit.ce('span', 'd', sous));
    b.appendChild(tx);
    b.appendChild(Kit.ce('span', 'ar', '›'));
    return b;
  }

  /* `majAnciens` et `feuilleAnciens` ONT ÉTÉ SUPPRIMÉES ICI (lot 8).
     Elles rendaient les contrats terminés sous forme d'une ligne de menu dont
     le sous-titre énumérait des prénoms, et d'une feuille pour les ouvrir.
     L'onglet Historique fait mieux et le fait ailleurs : une carte par enfant,
     les terminés sous leur propre intertitre. Garder les deux chemins, c'était
     garder deux endroits à corriger le jour où l'un se trompe. */

  /* ------------------------------------------------------------------ */
  /* Ajouter un enfant                                                   */
  /* ------------------------------------------------------------------ */

  function feuilleNouvelEnfant() {
    var maintenant = global.App.moisCourant();

    /* Lot 11 (A7) — les réglages sont repris de la VERSION EN VIGUEUR, et
       l'écran le DIT. Une valeur pré-remplie dont on ignore l'origine est pire
       qu'un champ vide : on ne sait pas s'il faut la vérifier. */
    Promise.all([
      global.DB.listFamillesToutes(),
      global.DB.listModeles().catch(function () { return []; })
    ]).then(function (rr) {
      var familles = rr[0];
      var modeles = rr[1] || [];
      Kit.ouvrirFeuille('Ajouter un enfant',
        'La famille, l’enfant, la date de début, puis sa rémunération.',
        function (corps) {
          var options = [['', '➕ Nouvelle famille']].concat(
            (familles || []).filter(function (f) { return !f.archive; })
              .map(function (f) { return [f.id, f.nom]; }));
          var selFamille = Kit.champSelect('Famille', options, options.length > 1 ? options[1][0] : '');
          corps.appendChild(selFamille.bloc);

          var nomFamille = Kit.champ('Nom de la nouvelle famille', '', { placeholder: 'Papillon' });
          corps.appendChild(nomFamille.bloc);

          function majFamille() {
            nomFamille.bloc.hidden = !!selFamille.select.value;
          }
          selFamille.select.addEventListener('change', majFamille);
          majFamille();

          var prenom = Kit.champ('Prénom de l’enfant', '', { placeholder: 'Léa' });
          corps.appendChild(prenom.bloc);

          var debut = Kit.champDate('Début du contrat',
            Kit.iso(maintenant.annee, maintenant.mois, 1),
            { anneeMin: maintenant.annee - 3, anneeMax: maintenant.annee + 1 });
          corps.appendChild(debut.bloc);

          corps.appendChild(Kit.section('Rémunération'));
          var brut = Kit.champ('Salaire brut', '', { placeholder: '1 401,20', inputmode: 'decimal' });
          corps.appendChild(brut.bloc);
          var net = Kit.champ('Salaire net', '', { placeholder: '1 094,60', inputmode: 'decimal' });
          corps.appendChild(net.bloc);
          corps.appendChild(Kit.ce('p', 'sb q',
            'Le net se lit sur la fiche de paie : il ne se calcule pas depuis le brut. ' +
            'Vous pourrez le compléter plus tard depuis la fiche du contrat.'));

          var noteReglages = Kit.note('Les autres réglages prennent les valeurs habituelles',
            'Lundi à vendredi, 8h30 → 17h30, 30 minutes supplémentaires par jour travaillé, ' +
            '5,00 € d’entretien par jour de présence. Tout est modifiable ensuite dans la fiche ' +
            'du contrat.');
          corps.appendChild(noteReglages);

          /* A7 — la provenance des valeurs pré-remplies, mise à jour chaque
             fois que la date de début change : c'est ELLE qui décide de la
             version en vigueur, pas la date du jour (RG-15, même principe). */
          function majProvenance() {
            var d = debut.valeur();
            var enVigueur = modeleApplicable(modeles, d);
            Kit.vider(noteReglages);
            if (!enVigueur) {
              noteReglages.appendChild(Kit.ce('b', null,
                'Les autres réglages prennent les valeurs habituelles'));
              noteReglages.appendChild(document.createTextNode(
                'Lundi à vendredi, 8h30 → 17h30, 30 minutes supplémentaires par jour ' +
                'travaillé, 5,00 € d’entretien par jour de présence. Tout est modifiable ' +
                'ensuite dans la fiche du contrat.'));
              return;
            }
            noteReglages.appendChild(Kit.ce('b', null,
              'Réglages repris de ' + enVigueur.nom));
            noteReglages.appendChild(document.createTextNode(
              'Horaires, entretien et règles de ce contrat type. Vous pouvez les modifier ' +
              'ensuite dans la fiche du contrat.'));
            if (!brut.input.value) {
              brut.input.value = Format.centimesEnEuros(enVigueur.brut_mensuel_centimes)
                .replace(/[^\d,]/g, '');
            }
            if (!net.input.value) {
              net.input.value = Format.centimesEnEuros(enVigueur.net_mensuel_centimes)
                .replace(/[^\d,]/g, '');
            }
          }
          debut.bloc.addEventListener('change', majProvenance);
          majProvenance();

          var msg = Kit.ce('div', 'msg');
          corps.appendChild(msg);
          var b = Kit.bouton('btn', function () { creer(); });
          b.textContent = 'Créer le contrat';
          corps.appendChild(b);

          function erreur(t) { msg.textContent = t; msg.className = 'msg ko'; }

          function creer() {
            msg.textContent = ''; msg.className = 'msg';
            var p = prenom.input.value.trim();
            if (!p) { erreur('Le prénom de l’enfant est obligatoire.'); return; }
            var idFamille = selFamille.select.value;
            var nouveauNom = nomFamille.input.value.trim();
            if (!idFamille && !nouveauNom) { erreur('Donnez un nom à la nouvelle famille.'); return; }
            var brutC = Kit.parseEuros(brut.input.value);
            var netC = Kit.parseEuros(net.input.value);
            if (brut.input.value.trim() && brutC == null) {
              erreur('Le salaire brut est illisible (exemple : 1 401,20).'); return;
            }

            b.disabled = true;
            msg.className = 'msg';
            msg.textContent = 'Création…';

            var pFamille = idFamille
              ? Promise.resolve({ id: idFamille })
              : global.DB.creerFamille({ nom: nouveauNom, canal: null });

            pFamille
              .then(function (famille) {
                var d = debut.valeur();
                var enVigueur = modeleApplicable(modeles, d);
                var champsContrat = {
                  famille_id: famille.id,
                  prenom_enfant: p,
                  date_debut: d,
                  statut: 'actif'
                };
                if (enVigueur) {
                  champsContrat.modele_id = enVigueur.id;
                  champsContrat.jours_planning = enVigueur.jours_planning;
                  champsContrat.heure_arrivee = enVigueur.heure_arrivee;
                  champsContrat.heure_depart = enVigueur.heure_depart;
                  champsContrat.minutes_contractuelles = enVigueur.minutes_contractuelles;
                  champsContrat.minutes_sup_jour = enVigueur.minutes_sup_jour;
                  champsContrat.minutes_par_jour_conge = enVigueur.minutes_par_jour_conge;
                  champsContrat.entretien_centimes_jour = enVigueur.entretien_centimes_jour;
                  champsContrat.sup_dues_si_enfant_absent = enVigueur.sup_dues_si_enfant_absent;
                  champsContrat.ordre_imputation = enVigueur.ordre_imputation;
                }
                return global.DB.creerContrat(champsContrat);
              })
              .then(function (contrat) {
                if (brutC == null) return contrat;
                var d = debut.valeur();
                var mm = Chaine.moisDeDate(d);
                return global.DB.ajouterSalaire(contrat.id, {
                  date_effet: Chaine.premierJour(mm.annee, mm.mois),
                  brut_mensuel_centimes: brutC,
                  net_mensuel_centimes: netC == null ? 0 : netC
                }).then(function () { return contrat; });
              })
              /* Correction A10 (relecture lot 6) : la feuille était fermée AVANT
                 le rechargement. Si celui-ci échouait, le message d'erreur
                 partait dans un nœud détaché : Maria lisait « contrat créé »,
                 ne voyait pas l'enfant sur l'accueil, recommençait — et créait
                 un SECOND contrat. On ne ferme qu'une fois tout abouti, et un
                 échec de rechargement dit exactement ce qui s'est passé. */
              .then(function () {
                return global.App.rechargerContrats().catch(function (e) {
                  var err = new Error('rechargement');
                  err.recharge = e;
                  throw err;
                });
              })
              .then(function () {
                Kit.fermerFeuille();
                Kit.toast('Contrat de ' + p + ' créé');
                return global.App.aller('accueil', {}, true);
              })
              .catch(function (e) {
                b.disabled = false;
                if (e && e.recharge) {
                  erreur('Le contrat de ' + p + ' A BIEN ÉTÉ CRÉÉ, mais l’écran n’a pas pu se ' +
                    'rafraîchir (' + Kit.messageErreur(e.recharge) + '). Ne le recréez pas : ' +
                    'fermez et rouvrez l’application.');
                  return;
                }
                erreur('Création impossible : ' + Kit.messageErreur(e) +
                  ' Vérifiez et réessayez — votre saisie est conservée.');
              });
          }
        });
    }).catch(function (e) {
      Kit.toast('Liste des familles indisponible : ' + Kit.messageErreur(e), true);
    });
  }

  /* ------------------------------------------------------------------ */

  /* ------------------------------------------------------------------ */
  /* LOT 8 — Écran Familles                                              */
  /*                                                                     */
  /* CE QU'IL CORRIGE. La fiche contrat portait un champ texte « Nom de   */
  /* la famille ». Le remplir écrivait dans `famille.nom` — c'est-à-dire  */
  /* renommait le FOYER, donc changeait le nom affiché pour TOUS ses      */
  /* enfants. Maria croyait corriger Léa, elle renommait aussi Tom, et    */
  /* rien à l'écran ne le disait. C'est une perte de données réelle, en   */
  /* production, et elle est silencieuse : on ne s'en aperçoit qu'en      */
  /* ouvrant la fiche d'un autre enfant, parfois des semaines plus tard.  */
  /*                                                                     */
  /* Le renommage devient donc un geste À PART, avec son écran, et cet    */
  /* écran NOMME les enfants concernés avant de laisser valider. Pas un   */
  /* décompte — « cela concerne 3 contrats » n'aide personne —, les       */
  /* PRÉNOMS.                                                            */
  /* ------------------------------------------------------------------ */

  function afficherFamilles(ctx) {
    global.App.barreRetour(ctx.barre, 'Familles');
    ctx.corps.appendChild(Kit.ce('div', 'attente', 'Lecture de vos familles…'));

    return global.DB.listFamillesAvecContrats().then(function (familles) {
      Kit.vider(ctx.corps);
      var liste = familles || [];
      if (!liste.length) {
        ctx.corps.appendChild(Kit.ce('p', 'vide',
          'Aucune famille pour l’instant. Elle se crée en ajoutant un enfant.'));
        return;
      }
      var enCours = liste.filter(function (f) { return !f.archive; });
      var rangees = liste.filter(function (f) { return f.archive; });

      if (enCours.length) {
        ctx.corps.appendChild(Kit.section('En cours'));
        enCours.forEach(function (f) { ctx.corps.appendChild(carteFamille(f)); });
      }
      if (rangees.length) {
        ctx.corps.appendChild(Kit.section('Terminées'));
        rangees.forEach(function (f) { ctx.corps.appendChild(carteFamille(f)); });
      }
    }).catch(function (e) {
      Kit.vider(ctx.corps);
      ctx.corps.appendChild(Kit.warnbox('Impossible de charger vos familles.',
        ' ' + Kit.messageErreur(e) + ' Vérifiez votre connexion, puis réessayez.'));
      var b = Kit.bouton('btn pr', function () { global.App.rafraichir(); });
      b.textContent = 'Réessayer';
      ctx.corps.appendChild(b);
    });
  }

  /* Un foyer est TITRÉ PAR LES PRÉNOMS DE SES ENFANTS, le nom de famille en
     sous-titre. C'est ce qui parle à Maria : elle ne pense pas « la famille
     Papillon », elle pense « Léa et Tom ». Le nom du foyer, lui, sert aux
     documents et aux échanges avec les parents. */
  function carteFamille(f) {
    var contrats = f.contrats || [];
    var actifs = contrats.filter(function (c) { return !c.archive && c.statut !== 'termine'; });
    var b = Kit.bouton('big' + (f.archive ? ' off' : ''), function () { feuilleFamille(f); });

    var top = Kit.ce('div', 'top');
    top.appendChild(pileAvatars(contrats));
    var ident = Kit.ce('div');
    ident.appendChild(Kit.ce('div', 'nm', prenomsDe(contrats) || 'Aucun enfant'));
    ident.appendChild(Kit.ce('div', 'fm', 'famille ' + f.nom + ' · ' + phraseContrats(contrats, actifs)));
    top.appendChild(ident);
    top.appendChild(Kit.ce('div', 'ar', '›'));
    b.appendChild(top);
    return b;
  }

  /* Pile de photos superposées quand le foyer compte plusieurs enfants. */
  function pileAvatars(contrats) {
    var pile = Kit.ce('div', 'pile');
    contrats.slice(0, 3).forEach(function (c) { pile.appendChild(Kit.avatar(c, 'pt')); });
    if (!contrats.length) pile.appendChild(Kit.avatar({ prenom_enfant: '·' }, 'pt'));
    return pile;
  }

  function prenomsDe(contrats) {
    var noms = contrats.map(function (c) { return c.prenom_enfant; }).filter(Boolean);
    if (!noms.length) return '';
    if (noms.length === 1) return noms[0];
    return noms.slice(0, -1).join(', ') + ' et ' + noms[noms.length - 1];
  }

  function phraseContrats(contrats, actifs) {
    if (!contrats.length) return 'aucun contrat';
    if (!actifs.length) return contrats.length + (contrats.length > 1 ? ' contrats terminés' : ' contrat terminé');
    return actifs.length + (actifs.length > 1 ? ' contrats en cours' : ' contrat en cours');
  }

  function feuilleFamille(f) {
    var contrats = f.contrats || [];
    var actifs = contrats.filter(function (c) { return !c.archive && c.statut !== 'termine'; });

    Kit.ouvrirFeuille('Famille ' + f.nom, prenomsDe(contrats) || 'Aucun enfant rattaché',
      function (corps) {
        if (contrats.length) {
          var l = Kit.lines(corps);
          contrats.forEach(function (c) {
            Kit.ligne(l, Kit.nomComplet(c),
              c.archive || c.statut === 'termine' ? 'terminé' : 'en cours',
              { discret: c.archive });
          });
        }

        var bRenommer = Kit.bouton('btn nt', function () {
          Kit.fermerFeuille();
          feuilleRenommer(f);
        });
        bRenommer.textContent = 'Renommer cette famille';
        corps.appendChild(bRenommer);

        if (f.archive) {
          var bSortir = Kit.bouton('btn nt', function () { ranger(f, false, bSortir); });
          bSortir.textContent = 'Sortir cette famille du rangement';
          corps.appendChild(bSortir);
          return;
        }

        var bRanger = Kit.bouton('btn nt', function () { ranger(f, true, bRanger); });
        bRanger.textContent = 'Ranger cette famille';
        /* V8-20 — grisé, AVEC son explication. Un bouton inerte sans raison
           fait croire à une panne ; nommer le contrat bloquant dit quoi
           faire. */
        if (actifs.length) {
          bRanger.disabled = true;
          corps.appendChild(bRanger);
          corps.appendChild(Kit.ce('p', 'sb q',
            'Impossible tant qu’un contrat est en cours : ' +
            prenomsDe(actifs) + '. Terminez-le d’abord depuis sa fiche.'));
        } else {
          corps.appendChild(bRanger);
          corps.appendChild(Kit.ce('p', 'sb q',
            'Une famille rangée sort des écrans courants. Tout son historique ' +
            'reste consultable, et le rangement se défait.'));
        }
      });
  }

  /* V8-22 — Renommer une famille : geste distinct, et ANNONCÉ. */
  function feuilleRenommer(f) {
    var contrats = f.contrats || [];
    Kit.ouvrirFeuille('Renommer la famille ' + f.nom, null, function (corps) {
      if (contrats.length > 1) {
        corps.appendChild(Kit.warnbox('Ce nom changera aussi pour les autres enfants de cette famille',
          ' ' + prenomsDe(contrats) + '.'));
      } else if (contrats.length === 1) {
        corps.appendChild(Kit.note('Un seul enfant est concerné',
          contrats[0].prenom_enfant + '. Ce nom désigne le foyer, pas l’enfant : ' +
          'le nom de ' + contrats[0].prenom_enfant + ' se modifie dans sa fiche.'));
      }

      var champ = Kit.champ('Nom de la famille', f.nom);
      corps.appendChild(champ.bloc);

      var msg = Kit.ce('div', 'msg');
      corps.appendChild(msg);

      var bOk = Kit.bouton('btn', function () {
        var nouveau = String(champ.input.value || '').trim();
        if (!nouveau) {
          msg.className = 'msg ko';
          msg.textContent = 'Le nom ne peut pas être vide.';
          return;
        }
        if (nouveau === f.nom) { Kit.fermerFeuille(); return; }
        bOk.disabled = true;
        global.DB.renommerFamille(f.id, nouveau).then(function () {
          Kit.fermerFeuille();
          return global.App.rechargerContrats();
        }).then(function () {
          Kit.toast('La famille s’appelle désormais ' + nouveau + '.');
          global.App.rafraichir();
        }).catch(function (e) {
          bOk.disabled = false;
          msg.className = 'msg ko';
          msg.textContent = 'Le renommage n’a pas abouti : ' + Kit.messageErreur(e) +
            ' Le nom n’a pas changé.';
        });
      });
      bOk.textContent = 'Renommer';
      corps.appendChild(bOk);

      var bNon = Kit.bouton('btn nt', function () { Kit.fermerFeuille(); });
      bNon.textContent = 'Annuler';
      corps.appendChild(bNon);
    });
  }

  function ranger(f, ranger_, bouton) {
    bouton.disabled = true;
    var geste = ranger_ ? global.DB.archiverFamille(f.id) : global.DB.desarchiverFamille(f.id);
    geste.then(function () {
      Kit.fermerFeuille();
      return global.App.rechargerContrats();
    }).then(function () {
      Kit.toast(ranger_ ? 'La famille ' + f.nom + ' est rangée.'
                        : 'La famille ' + f.nom + ' est de retour.');
      global.App.rafraichir();
    }).catch(function (e) {
      bouton.disabled = false;
      /* L'erreur de la couche données NOMME les contrats bloquants : on la
         relaie telle quelle plutôt que de dire « impossible ». */
      if (e && e.code === 'FAMILLE_ENCORE_ACTIVE') {
        Kit.toast('Impossible de ranger cette famille : ' +
          prenomsDe((e.prenoms || []).map(function (p) { return { prenom_enfant: p }; })) +
          (e.prenoms && e.prenoms.length > 1 ? ' ont encore un contrat en cours.'
                                             : ' a encore un contrat en cours.'), true);
        return;
      }
      Kit.toast('Le rangement n’a pas abouti : ' + Kit.messageErreur(e) +
        ' Rien n’a changé.', true);
    });
  }

  /* ------------------------------------------------------------------ */
  /* LOT 11 — Mes contrats types                                         */
  /*                                                                     */
  /* UNE VERSION NE S'APPLIQUE JAMAIS SEULE (V8-14). C'est la décision    */
  /* structurante du lot, et l'inverse de ce qu'un logiciel fait          */
  /* d'habitude : créer « Conditions 2026 » ne touche à aucun contrat.    */
  /* L'alignement se PROPOSE, contrat par contrat, en montrant pour       */
  /* chacun sa valeur actuelle et sa valeur cible.                        */
  /*                                                                     */
  /* Parce qu'un contrat qui reste en arrière n'a rien d'anormal : Tom    */
  /* garde son ancienne rémunération parce que ses parents ne l'ont pas   */
  /* revalorisée. C'est un fait négocié. L'application le CONSTATE.       */
  /* ------------------------------------------------------------------ */

  function afficherModeles(ctx) {
    global.App.barreRetour(ctx.barre, 'Mes contrats types');
    ctx.corps.appendChild(Kit.ce('div', 'attente', 'Lecture de vos versions…'));

    return Promise.all([
      global.DB.listModeles(),
      global.App.tousLesContrats()
    ]).then(function (r) {
      var modeles = r[0] || [];
      var contrats = (r[1] || []).filter(function (c) { return !c.archive; });
      Kit.vider(ctx.corps);

      if (!modeles.length) {
        ctx.corps.appendChild(Kit.note('Aucun contrat type pour l’instant',
          'Un contrat type rassemble vos conditions habituelles — horaires, entretien, ' +
          'rémunération — à une date donnée. Il sert à créer un nouveau contrat sans tout ' +
          'ressaisir, et à voir d’un coup d’œil quels contrats s’en écartent.'));
      } else {
        modeles.forEach(function (m, i) {
          ctx.corps.appendChild(carteModele(m, modeles[i - 1] || null, contrats));
        });
      }

      var b = Kit.bouton('btn', function () { feuilleNouvelleVersion(modeles, contrats); });
      b.textContent = 'Créer une nouvelle version';
      ctx.corps.appendChild(b);

      ctx.corps.appendChild(Kit.ce('p', 'sb q',
        'Les anciennes versions ne se suppriment pas : elles expliquent les montants ' +
        'de vos mois déjà clôturés.'));
    }).catch(function (e) {
      Kit.vider(ctx.corps);
      ctx.corps.appendChild(Kit.warnbox('Impossible de charger vos contrats types.',
        ' ' + Kit.messageErreur(e) + ' Vérifiez votre connexion, puis réessayez.'));
      var b = Kit.bouton('btn pr', function () { global.App.rafraichir(); });
      b.textContent = 'Réessayer';
      ctx.corps.appendChild(b);
    });
  }

  /* `suivant` est la version postérieure, quand elle existe : c'est elle qui
     donne la date de fin de celle-ci. Une version n'a pas de fin en propre —
     elle vaut jusqu'à ce qu'une autre prenne le relais. */
  function carteModele(m, suivant, contrats) {
    var rattaches = contrats.filter(function (c) { return c.modele_id === m.id; });
    var b = Kit.bouton('big', function () { feuilleModele(m, rattaches); });

    var top = Kit.ce('div', 'top');
    var ident = Kit.ce('div');
    ident.appendChild(Kit.ce('div', 'nm', m.nom));
    ident.appendChild(Kit.ce('div', 'fm', suivant
      ? 'du ' + Kit.dateLongue(m.date_effet) + ' au ' + Kit.dateLongue(veille(suivant.date_effet))
      : 'en vigueur depuis le ' + Kit.dateLongue(m.date_effet)));
    top.appendChild(ident);
    top.appendChild(Kit.ce('div', 'ar', '›'));
    b.appendChild(top);

    var ecarts = 0;
    rattaches.forEach(function (c) {
      if (global.DB.ecartsContratModele(c, m).length) ecarts++;
    });
    b.appendChild(Kit.ce('div', 'sb q',
      (rattaches.length ? rattaches.length + (rattaches.length > 1 ? ' contrats rattachés' : ' contrat rattaché')
                        : 'Aucun contrat rattaché') +
      (ecarts ? ' · ' + ecarts + (ecarts > 1 ? ' écarts' : ' écart') : '')));
    return b;
  }

  function veille(iso) {
    return Feries && Feries.ajouterJours ? Feries.ajouterJours(iso, -1) : iso;
  }

  function feuilleModele(m, rattaches) {
    Kit.ouvrirFeuille(m.nom, 'En vigueur depuis le ' + Kit.dateLongue(m.date_effet),
      function (corps) {
        var l = Kit.lines(corps);
        Kit.ligne(l, 'Jours de garde', libellePlanningCourt(m.jours_planning));
        Kit.ligne(l, 'Horaire', String(m.heure_arrivee).slice(0, 5) + ' → ' +
          String(m.heure_depart).slice(0, 5));
        Kit.ligne(l, 'Heures sup par jour', Kit.duree(m.minutes_sup_jour));
        Kit.ligne(l, 'Entretien par jour', Kit.eur(m.entretien_centimes_jour));
        Kit.ligne(l, 'Salaire brut', Kit.eur(m.brut_mensuel_centimes));
        Kit.ligne(l, 'Salaire net', Kit.eur(m.net_mensuel_centimes));

        if (rattaches.length) {
          corps.appendChild(Kit.section('Contrats rattachés'));
          var l2 = Kit.lines(corps);
          rattaches.forEach(function (c) {
            var e = global.DB.ecartsContratModele(c, m);
            Kit.ligne(l2, c.prenom_enfant,
              e.length ? e.length + (e.length > 1 ? ' écarts' : ' écart') : 'aligné',
              { alerte: false, discret: !e.length });
          });
          corps.appendChild(Kit.ce('p', 'sb q',
            'Un écart n’est pas une erreur : c’est une condition négociée avec une famille. ' +
            'Il se corrige depuis la fiche du contrat, si vous le souhaitez.'));
        }

        corps.appendChild(Kit.ce('p', 'sb q',
          'Cette version ne peut pas être supprimée : elle explique les montants des mois ' +
          'déjà clôturés, qui ne se recalculent jamais.'));
      });
  }

  function libellePlanningCourt(planning) {
    var noms = ['', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'];
    return (planning || []).slice().sort().map(function (j) { return noms[j]; }).join(', ');
  }

  /* --- Créer une version, puis PROPOSER l'alignement ------------------ */

  function feuilleNouvelleVersion(modeles, contrats) {
    var courant = modeles[0] || null;
    var maintenant = global.App.moisCourant();

    Kit.ouvrirFeuille('Nouvelle version',
      courant ? 'Pré-remplie depuis « ' + courant.nom + ' ».'
              : 'Vos conditions habituelles.',
      function (corps) {
        var nom = Kit.champ('Nom de cette version', '', { placeholder: 'Conditions 2027' });
        corps.appendChild(nom.bloc);

        var effet = Kit.champDate('À partir du',
          Kit.iso(maintenant.annee, maintenant.mois, 1),
          { anneeMin: maintenant.annee - 2, anneeMax: maintenant.annee + 3 });
        corps.appendChild(effet.bloc);

        corps.appendChild(Kit.section('Conditions'));
        var champs = {};
        champs.entretien = Kit.champ('Entretien par jour de présence',
          courant ? Format.centimesEnEuros(courant.entretien_centimes_jour).replace(/[^\d,]/g, '') : '',
          { inputmode: 'decimal', placeholder: '5,00' });
        corps.appendChild(champs.entretien.bloc);

        champs.sup = Kit.champ('Heures sup par jour travaillé (minutes)',
          courant ? String(courant.minutes_sup_jour) : '30', { inputmode: 'numeric' });
        corps.appendChild(champs.sup.bloc);

        corps.appendChild(Kit.section('Rémunération de référence'));
        champs.brut = Kit.champ('Salaire brut',
          courant ? Format.centimesEnEuros(courant.brut_mensuel_centimes).replace(/[^\d,]/g, '') : '',
          { inputmode: 'decimal', placeholder: '1 401,20' });
        corps.appendChild(champs.brut.bloc);
        champs.net = Kit.champ('Salaire net',
          courant ? Format.centimesEnEuros(courant.net_mensuel_centimes).replace(/[^\d,]/g, '') : '',
          { inputmode: 'decimal', placeholder: '1 094,60' });
        corps.appendChild(champs.net.bloc);

        var msg = Kit.ce('div', 'msg');
        corps.appendChild(msg);

        /* A1 — LE MESSAGE CENTRAL DU LOT, dit avant même de créer. */
        corps.appendChild(Kit.note('Créer cette version ne modifie aucun contrat',
          'Vous choisirez ensuite, un par un, ceux qui y passent. Rien ne changera pour ' +
          'les autres.'));

        var b = Kit.bouton('btn', function () {
          msg.textContent = ''; msg.className = 'msg';
          var n = String(nom.input.value || '').trim();
          if (!n) { msg.className = 'msg ko'; msg.textContent = 'Donnez un nom à cette version.'; return; }
          var entretien = Kit.parseEuros(champs.entretien.input.value);
          var brut = Kit.parseEuros(champs.brut.input.value);
          var net = Kit.parseEuros(champs.net.input.value);
          var sup = Kit.parseEntier(champs.sup.input.value, 0);
          if (entretien == null || brut == null || net == null || sup == null) {
            msg.className = 'msg ko';
            msg.textContent = 'Un des montants est illisible (exemple : 5,00).';
            return;
          }

          b.disabled = true;
          msg.textContent = 'Création…';
          global.DB.creerModele({
            nom: n, date_effet: effet.valeur(),
            jours_planning: courant ? courant.jours_planning : [1, 2, 3, 4, 5],
            heure_arrivee: courant ? courant.heure_arrivee : '08:30:00',
            heure_depart: courant ? courant.heure_depart : '18:00:00',
            minutes_contractuelles: courant ? courant.minutes_contractuelles : 540,
            minutes_sup_jour: sup,
            minutes_par_jour_conge: courant ? courant.minutes_par_jour_conge : 540,
            entretien_centimes_jour: entretien,
            brut_mensuel_centimes: brut,
            net_mensuel_centimes: net,
            sup_dues_si_enfant_absent: courant ? courant.sup_dues_si_enfant_absent : true,
            ordre_imputation: courant ? courant.ordre_imputation : 'cp_puis_sup'
          }).then(function (modele) {
            /* On ENCHAÎNE sur l'alignement, sans l'avoir appliqué. */
            feuilleAlignement(modele, contrats);
          }).catch(function (e) {
            b.disabled = false;
            msg.className = 'msg ko';
            msg.textContent = 'La version n’a pas été créée : ' + Kit.messageErreur(e);
          });
        });
        b.textContent = 'Créer cette version';
        corps.appendChild(b);
      });
  }

  /* V8-14 — L'ALIGNEMENT, JAMAIS AUTOMATIQUE.
     Chaque ligne montre LA VALEUR ACTUELLE ET LA VALEUR CIBLE. Une case cochée
     par défaut serait déjà une décision prise à la place de Maria : elles ne le
     sont pas. */
  function feuilleAlignement(modele, contrats) {
    var maintenant = global.App.moisCourant();
    Kit.ouvrirFeuille('Quels contrats passent à cette version ?',
      'Rien ne changera pour ceux que vous ne cochez pas.',
      function (corps) {
        var actifs = (contrats || []).filter(function (c) { return !c.archive; });
        if (!actifs.length) {
          corps.appendChild(Kit.ce('p', 'vide', 'Aucun contrat actif à aligner.'));
          return;
        }

        var cases = [];
        var attente = Kit.ce('div', 'attente', 'Lecture des rémunérations…');
        corps.appendChild(attente);

        Promise.all(actifs.map(function (c) {
          return global.DB.getSalaires(c.id)
            .then(function (l) { return { contrat: c, salaires: l || [] }; })
            .catch(function () { return { contrat: c, salaires: [] }; });
        })).then(function (liste) {
          corps.removeChild(attente);

          liste.forEach(function (x) {
            var dernier = x.salaires[x.salaires.length - 1] || null;
            var f = Kit.ce('label', 'aligne');
            var box = document.createElement('input');
            box.type = 'checkbox';
            box.checked = false;                 // JAMAIS coché par défaut
            f.appendChild(box);
            var tx = Kit.ce('span', 'tx');
            tx.appendChild(Kit.ce('b', null, x.contrat.prenom_enfant));
            tx.appendChild(Kit.ce('span', 'd', dernier
              ? Kit.eur(dernier.brut_mensuel_centimes) + ' → ' +
                Kit.eur(modele.brut_mensuel_centimes)
              : 'aucune rémunération connue → ' + Kit.eur(modele.brut_mensuel_centimes)));
            f.appendChild(tx);
            corps.appendChild(f);
            cases.push({ contrat: x.contrat, box: box });
          });

          var effet = Kit.champDate('À partir du',
            Kit.iso(maintenant.annee, maintenant.mois, 1),
            { anneeMin: maintenant.annee - 1, anneeMax: maintenant.annee + 3 });
          corps.appendChild(effet.bloc);

          var msg = Kit.ce('div', 'msg');
          corps.appendChild(msg);

          var b = Kit.bouton('btn', function () {
            var choisis = cases.filter(function (c) { return c.box.checked; });
            b.disabled = true;
            msg.className = 'msg';
            msg.textContent = choisis.length ? 'Alignement…' : 'Enregistrement…';
            aligner(modele, choisis.map(function (c) { return c.contrat; }), effet.valeur())
              .then(function () {
                Kit.fermerFeuille();
                Kit.toast(choisis.length
                  ? choisis.length + (choisis.length > 1 ? ' contrats alignés' : ' contrat aligné') +
                    ' sur ' + modele.nom + '.'
                  : modele.nom + ' est créée. Aucun contrat n’a changé.');
                global.App.rafraichir();
              })
              .catch(function (e) {
                b.disabled = false;
                msg.className = 'msg ko';
                msg.textContent = 'L’alignement n’a pas abouti : ' + Kit.messageErreur(e) +
                  ' La version, elle, est bien créée.';
              });
          });
          b.textContent = 'Appliquer';
          corps.appendChild(b);

          /* RG-15, rappelé là où le geste se pose. */
          corps.appendChild(Kit.ce('p', 'sb q',
            'Les mois déjà clôturés ne changeront pas.'));
        });
      });
  }

  /* Aligner : rattacher, puis poser les réglages ET une ligne de rémunération
     DATÉE. Jamais d'écriture directe du montant sur le contrat — les mois
     passés changeraient (risque n° 2). */
  function aligner(modele, contrats, dateEffet) {
    if (!contrats.length) return Promise.resolve();
    var ids = contrats.map(function (c) { return c.id; });
    return Promise.all(ids.map(function (id) {
      return global.DB.majContrat(id, {
        modele_id: modele.id,
        jours_planning: modele.jours_planning,
        heure_arrivee: modele.heure_arrivee,
        heure_depart: modele.heure_depart,
        minutes_contractuelles: modele.minutes_contractuelles,
        minutes_sup_jour: modele.minutes_sup_jour,
        minutes_par_jour_conge: modele.minutes_par_jour_conge,
        entretien_centimes_jour: modele.entretien_centimes_jour,
        sup_dues_si_enfant_absent: modele.sup_dues_si_enfant_absent,
        ordre_imputation: modele.ordre_imputation
      });
    })).then(function () {
      return global.DB.majContratsEnLot(ids, 'remuneration', {
        brut_mensuel_centimes: modele.brut_mensuel_centimes,
        net_mensuel_centimes: modele.net_mensuel_centimes
      }, dateEffet);
    }).then(function () {
      return global.App.rechargerContrats();
    });
  }

  /* ------------------------------------------------------------------ */
  /* LOT 11 — Modifier plusieurs contrats (V8-25)                        */
  /*                                                                     */
  /* UNE CHOSE À LA FOIS, LA NOUVELLE VALEUR D'ABORD.                    */
  /*                                                                     */
  /* L'ordre compte. Un écran qui présenterait d'abord la liste des       */
  /* contrats puis un formulaire à cinq champs inviterait à tout changer  */
  /* d'un coup — et une erreur y toucherait quatre familles en même       */
  /* temps. Ici : on choisit CE QU'ON change, on saisit la valeur, PUIS   */
  /* on désigne les contrats, chacun affichant sa valeur actuelle.        */
  /* ------------------------------------------------------------------ */

  var CHOSES_MODIFIABLES = [
    { cle: 'remuneration', libelle: 'Rémunération',
      aide: 'Crée une ligne de barème datée sur chaque contrat choisi.', dateEffet: true },
    { cle: 'entretien_centimes_jour', libelle: 'Indemnité d’entretien',
      aide: 'Le montant par jour de présence.', format: 'euros' },
    { cle: 'minutes_sup_jour', libelle: 'Heures supplémentaires par jour',
      aide: 'En minutes, par jour travaillé.', format: 'minutes' },
    { cle: 'ordre_imputation', libelle: 'Congés déduits d’abord',
      aide: 'Congés payés, ou récupération.', format: 'ordre' },
    { cle: 'sup_dues_si_enfant_absent', libelle: 'Heures sup si l’enfant est absent',
      aide: 'Dues, ou non dues.', format: 'oui_non' }
  ];

  function afficherModifGroupee(ctx) {
    global.App.barreRetour(ctx.barre, 'Modifier plusieurs contrats');
    ctx.corps.appendChild(Kit.section('Que voulez-vous modifier ?'));
    CHOSES_MODIFIABLES.forEach(function (c) {
      Kit.choix(ctx.corps, 'c1', '›', c.libelle, c.aide, function () { feuilleValeur(c); });
    });
    ctx.corps.appendChild(Kit.ce('p', 'sb q',
      'Une chose à la fois : vous choisirez ensuite les contrats concernés, ' +
      'chacun avec sa valeur actuelle.'));
    return Promise.resolve();
  }

  function feuilleValeur(chose) {
    Kit.ouvrirFeuille(chose.libelle, 'La nouvelle valeur d’abord.', function (corps) {
      var saisie = champPour(chose);
      corps.appendChild(saisie.bloc);
      var msg = Kit.ce('div', 'msg');
      corps.appendChild(msg);

      var b = Kit.bouton('btn', function () {
        var v = saisie.lire();
        if (v === null) {
          msg.className = 'msg ko';
          msg.textContent = 'Cette valeur est illisible.';
          return;
        }
        feuilleContratsConcernes(chose, v);
      });
      b.textContent = 'Continuer';
      corps.appendChild(b);
    });
  }

  function champPour(chose) {
    if (chose.cle === 'remuneration') {
      var bloc = Kit.ce('div');
      var brut = Kit.champ('Salaire brut', '', { inputmode: 'decimal', placeholder: '1 401,20' });
      var net = Kit.champ('Salaire net', '', { inputmode: 'decimal', placeholder: '1 094,60' });
      bloc.appendChild(brut.bloc);
      bloc.appendChild(net.bloc);
      bloc.appendChild(Kit.ce('p', 'sb q',
        'Le net se lit sur la fiche de paie : il ne se calcule pas depuis le brut.'));
      return { bloc: bloc, lire: function () {
        var b = Kit.parseEuros(brut.input.value);
        var n = Kit.parseEuros(net.input.value);
        if (b == null || n == null) return null;
        return { brut_mensuel_centimes: b, net_mensuel_centimes: n };
      } };
    }
    if (chose.format === 'euros') {
      var e = Kit.champ(chose.libelle, '', { inputmode: 'decimal', placeholder: '5,00' });
      return { bloc: e.bloc, lire: function () { return Kit.parseEuros(e.input.value); } };
    }
    if (chose.format === 'minutes') {
      var m = Kit.champ(chose.libelle + ' (minutes)', '', { inputmode: 'numeric', placeholder: '30' });
      return { bloc: m.bloc, lire: function () { return Kit.parseEntier(m.input.value, 0); } };
    }
    if (chose.format === 'ordre') {
      var o = Kit.champSelect(chose.libelle, [
        ['cp_puis_sup', 'congés payés'], ['sup_puis_cp', 'récupération']
      ], 'cp_puis_sup');
      return { bloc: o.bloc, lire: function () { return o.select.value; } };
    }
    var s = Kit.champSelect(chose.libelle, [['true', 'dues'], ['false', 'non dues']], 'true');
    return { bloc: s.bloc, lire: function () { return s.select.value === 'true'; } };
  }

  /* Chaque contrat affiche SA VALEUR ACTUELLE : sans cela, Maria coche des
     noms sans savoir ce qu'elle change chez qui. */
  function feuilleContratsConcernes(chose, valeur) {
    var maintenant = global.App.moisCourant();
    Kit.ouvrirFeuille('Quels contrats ?', 'Rien ne changera pour ceux que vous ne cochez pas.',
      function (corps) {
        var actifs = global.App.contrats();
        var cases = [];
        var attente = Kit.ce('div', 'attente', 'Lecture des valeurs actuelles…');
        corps.appendChild(attente);

        Promise.all(actifs.map(function (c) {
          if (chose.cle !== 'remuneration') return Promise.resolve({ contrat: c, actuelle: c[chose.cle] });
          return global.DB.getSalaires(c.id).then(function (l) {
            var d = (l || [])[l.length - 1];
            return { contrat: c, actuelle: d ? d.brut_mensuel_centimes : null };
          }).catch(function () { return { contrat: c, actuelle: null }; });
        })).then(function (liste) {
          corps.removeChild(attente);

          liste.forEach(function (x) {
            var f = Kit.ce('label', 'aligne');
            var box = document.createElement('input');
            box.type = 'checkbox';
            box.checked = false;
            f.appendChild(box);
            var tx = Kit.ce('span', 'tx');
            tx.appendChild(Kit.ce('b', null, x.contrat.prenom_enfant));
            tx.appendChild(Kit.ce('span', 'd',
              'actuellement ' + lisible(chose, x.actuelle) + ' → ' + lisible(chose, valeur)));
            f.appendChild(tx);
            corps.appendChild(f);
            cases.push({ contrat: x.contrat, box: box });
          });

          var effet = null;
          if (chose.dateEffet) {
            effet = Kit.champDate('À partir du',
              Kit.iso(maintenant.annee, maintenant.mois, 1),
              { anneeMin: maintenant.annee - 1, anneeMax: maintenant.annee + 3 });
            corps.appendChild(effet.bloc);
          }

          var msg = Kit.ce('div', 'msg');
          corps.appendChild(msg);

          var b = Kit.bouton('btn', function () {
            var choisis = cases.filter(function (c) { return c.box.checked; });
            if (!choisis.length) {
              msg.className = 'msg ko';
              msg.textContent = 'Cochez au moins un contrat.';
              return;
            }
            b.disabled = true;
            msg.className = 'msg';
            msg.textContent = 'Modification…';
            global.DB.majContratsEnLot(
              choisis.map(function (c) { return c.contrat.id; }),
              chose.cle, valeur, effet ? effet.valeur() : null)
              .then(function () { return global.App.rechargerContrats(); })
              .then(function () {
                Kit.fermerFeuille();
                Kit.toast(choisis.length + (choisis.length > 1 ? ' contrats modifiés' : ' contrat modifié') + '.');
                global.App.rafraichir();
              })
              .catch(function (e) {
                b.disabled = false;
                msg.className = 'msg ko';
                msg.textContent = 'La modification n’a pas abouti : ' + Kit.messageErreur(e) +
                  ' Rien n’a changé.';
              });
          });
          b.textContent = 'Appliquer';
          corps.appendChild(b);

          corps.appendChild(Kit.ce('p', 'sb q', 'Les mois déjà clôturés ne changeront pas.'));
        });
      });
  }

  function lisible(chose, v) {
    if (v === null || v === undefined) return 'inconnue';
    if (chose.cle === 'remuneration') {
      return Kit.eur(typeof v === 'object' ? v.brut_mensuel_centimes : v);
    }
    if (chose.format === 'euros') return Kit.eur(v);
    if (chose.format === 'minutes') return Kit.duree(v);
    if (chose.format === 'ordre') return v === 'sup_puis_cp' ? 'récupération' : 'congés payés';
    if (chose.format === 'oui_non') return v === false ? 'non dues' : 'dues';
    return String(v);
  }

  /* ------------------------------------------------------------------ */
  /* LOT 14 — Reprendre mes comptes (V8-27)                              */
  /*                                                                     */
  /* Le nom « reprise des compteurs » est abandonné : Maria ne comprenait */
  /* pas de quoi il s'agissait. La question posée est celle qu'elle se    */
  /* pose : « je tenais déjà mes comptes sur papier, où j'en suis ? »     */
  /*                                                                     */
  /* GARDE-FOU CENTRAL : dès qu'un mois est clôturé pour un contrat, sa   */
  /* saisie est REFUSÉE. Ces chiffres sont le point de départ de tout     */
  /* l'historique ; les changer après une clôture rendrait faux des mois  */
  /* dont les documents sont partis chez des familles (risque n° 1).      */
  /* ------------------------------------------------------------------ */

  function afficherReprise(ctx) {
    global.App.barreRetour(ctx.barre, 'Reprendre mes comptes');
    ctx.corps.appendChild(Kit.ce('div', 'attente', 'Lecture de vos contrats…'));

    var contrats = global.App.contrats();
    return Promise.all(contrats.map(function (c) {
      return Promise.all([
        global.DB.getCompteurInitial(c.id).catch(function () { return null; }),
        global.DB.listRecapsContrat(c.id).catch(function () { return []; })
      ]).then(function (r) {
        return {
          contrat: c,
          compteur: r[0],
          cloturés: (r[1] || []).filter(function (x) { return x.statut === 'fige'; })
        };
      });
    })).then(function (fiches) {
      Kit.vider(ctx.corps);

      ctx.corps.appendChild(Kit.ce('p', 'intro',
        'Si vous teniez déjà vos comptes sur papier, indiquez ici où vous en êtes. ' +
        'L’application repartira de ces chiffres.'));

      /* L'avertissement est PERMANENT, pas un message qui passe. */
      ctx.corps.appendChild(Kit.warnbox('À ne saisir qu’une fois',
        ' Ces chiffres servent de point de départ à tout votre historique. ' +
        'Une erreur ici se retrouvera dans tous les mois suivants.'));

      if (!fiches.length) {
        ctx.corps.appendChild(Kit.ce('p', 'vide', 'Aucun contrat actif.'));
        return;
      }
      fiches.forEach(function (f) { ctx.corps.appendChild(carteReprise(f)); });
    }).catch(function (e) {
      Kit.vider(ctx.corps);
      ctx.corps.appendChild(Kit.warnbox('Impossible de charger vos contrats.',
        ' ' + Kit.messageErreur(e) + ' Vérifiez votre connexion, puis réessayez.'));
    });
  }

  function carteReprise(f) {
    var c = f.contrat;
    var p = Kit.pane(c.prenom_enfant);

    if (f.cloturés.length) {
      /* A1 — REFUS, avec l'explication. Pas un champ grisé sans raison : la
         phrase dit ce qui bloque ET pourquoi. */
      p.appendChild(Kit.warnbox(
        'Impossible de modifier le point de départ de ' + c.prenom_enfant,
        ' Des mois sont déjà clôturés pour ce contrat. Modifier les chiffres de ' +
        'départ rendrait ces mois faux.'));
      if (f.compteur) {
        var lc = Kit.lines(p);
        Kit.ligne(lc, 'Point de départ', Kit.dateLongue(f.compteur.date_reference), { discret: true });
        Kit.ligne(lc, 'Récupération', Kit.heures(f.compteur.minutes_sup), { discret: true });
        Kit.ligne(lc, 'Congés payés acquis', Kit.joursCp(f.compteur.dixiemes_cp_acquis), { discret: true });
        Kit.ligne(lc, 'Congés payés déjà pris', Kit.joursCp(f.compteur.dixiemes_cp_pris), { discret: true });
      }
      return p;
    }

    var maintenant = global.App.moisCourant();
    var actuel = f.compteur || {};
    var dateRef = Kit.champDate('Date de reprise',
      actuel.date_reference || c.date_debut,
      { anneeMin: maintenant.annee - 5, anneeMax: maintenant.annee + 1 });
    p.appendChild(dateRef.bloc);

    /* La récupération se saisit en HEURES ET MINUTES, pas en minutes brutes :
       Maria lit « 12 h 30 » sur son papier, pas « 750 ». */
    var heures = Kit.champ('Récupération accumulée — heures',
      String(Math.floor((actuel.minutes_sup || 0) / 60)), { inputmode: 'numeric' });
    var minutes = Kit.champ('… et minutes',
      String((actuel.minutes_sup || 0) % 60), { inputmode: 'numeric' });
    p.appendChild(heures.bloc);
    p.appendChild(minutes.bloc);

    /* Les congés payés se comptent en jours ET DEMI-JOURS : « 12,5 jours »
       est ce qui figure sur un bulletin. Le stockage, lui, est en dixièmes. */
    var acquis = Kit.champ('Congés payés acquis (en jours)',
      dixiemesEnSaisie(actuel.dixiemes_cp_acquis), { inputmode: 'decimal', placeholder: '12,5' });
    var pris = Kit.champ('Congés payés déjà pris (en jours)',
      dixiemesEnSaisie(actuel.dixiemes_cp_pris), { inputmode: 'decimal', placeholder: '3' });
    p.appendChild(acquis.bloc);
    p.appendChild(pris.bloc);

    var msg = Kit.ce('div', 'msg');
    p.appendChild(msg);

    var b = Kit.bouton('btn', function () {
      msg.textContent = ''; msg.className = 'msg';
      var h = Kit.parseEntier(heures.input.value, 0);
      var mn = Kit.parseEntier(minutes.input.value, 0);
      var a = saisieEnDixiemes(acquis.input.value);
      var pr = saisieEnDixiemes(pris.input.value);
      if (h === null || mn === null || a === null || pr === null) {
        msg.className = 'msg ko';
        msg.textContent = 'Un des chiffres est illisible (exemples : 12 et 30, ou 12,5).';
        return;
      }
      /* A2 — le contrôle est fait ICI aussi, pour dire la vérité en français
         AVANT l'aller-retour. La contrainte en base reste la garantie. */
      if (pr > a) {
        msg.className = 'msg ko';
        msg.textContent = 'Vous ne pouvez pas avoir pris plus de congés que vous n’en avez acquis : ' +
          Kit.joursCp(pr) + ' pris pour ' + Kit.joursCp(a) + ' acquis.';
        return;
      }
      b.disabled = true;
      msg.textContent = 'Enregistrement…';
      global.DB.enregistrerCompteurInitial(c.id, {
        date_reference: dateRef.valeur(),
        minutes_sup: h * 60 + mn,
        dixiemes_cp_acquis: a,
        dixiemes_cp_pris: pr
      }).then(function () {
        global.App.invalider();
        /* Le bouton REDEVIENT actif. Il ne rouvrira plus rien une fois un mois
           clôturé — la carte entière cède alors la place au refus expliqué —
           mais tant que rien n'est figé, Maria doit pouvoir corriger une faute
           de frappe dans la seconde qui suit. Un bouton resté mort après un
           succès n'apprend rien et fait croire à une panne. */
        b.disabled = false;
        msg.className = 'msg ok';
        msg.textContent = 'Point de départ enregistré pour ' + c.prenom_enfant + '.';
      }).catch(function (e) {
        b.disabled = false;
        msg.className = 'msg ko';
        msg.textContent = 'Enregistrement impossible : ' + Kit.messageErreur(e) +
          ' Vos chiffres sont toujours là.';
      });
    });
    b.textContent = 'Enregistrer le point de départ de ' + c.prenom_enfant;
    p.appendChild(b);
    return p;
  }

  /* Dixièmes de jour <-> saisie en jours. « 125 dixièmes » ne veut rien dire
     pour personne ; « 12,5 jours » est ce qui figure sur un bulletin. */
  function dixiemesEnSaisie(d) {
    if (!d) return '';
    return String(d / 10).replace('.', ',');
  }
  function saisieEnDixiemes(txt) {
    var t = String(txt == null ? '' : txt).trim().replace(',', '.');
    if (t === '') return 0;
    if (!/^\d+(\.\d+)?$/.test(t)) return null;
    var v = Math.round(parseFloat(t) * 10);
    if (isNaN(v) || v < 0) return null;
    return v;
  }

  /* ------------------------------------------------------------------ */
  /* LOT 14 — Export (V8-28)                                             */
  /*                                                                     */
  /* « À garder de côté » : c'est le filet de Maria si l'application      */
  /* disparaît, et la pièce qu'elle sortira si un désaccord remonte à     */
  /* plusieurs années. AUCUNE PHOTO — le retrait se fait dans db.js, à la */
  /* source.                                                             */
  /* ------------------------------------------------------------------ */

  function feuilleExport() {
    Kit.ouvrirFeuille('Exporter tout mon historique',
      'Tous vos mois, tous vos contrats, tous vos comptes.',
      function (corps) {
        corps.appendChild(Kit.ce('p', 'sb q',
          'Le fichier ne contient aucune photo. Les contrats terminés y figurent : ' +
          'ce sont eux qu’on vient chercher des années après.'));

        var msg = Kit.ce('div', 'msg');

        var bDoc = Kit.bouton('btn', function () { exporter('document', bDoc, msg); });
        bDoc.textContent = 'Document unique — lisible';
        corps.appendChild(bDoc);

        var bTab = Kit.bouton('btn nt', function () { exporter('tableau', bTab, msg); });
        bTab.textContent = 'Tableau — un mois par ligne';
        corps.appendChild(bTab);

        corps.appendChild(msg);
      });
  }

  function exporter(format, bouton, msg) {
    bouton.disabled = true;
    msg.className = 'msg';
    msg.textContent = 'Préparation…';
    global.DB.exporterHistorique().then(function (donnees) {
      donnees.exporte_le = global.App.aujourdhui();
      var texte = format === 'tableau' ? enTableau(donnees) : enDocument(donnees);
      var extension = format === 'tableau' ? 'csv' : 'txt';
      var type = format === 'tableau' ? 'text/csv;charset=utf-8' : 'text/plain;charset=utf-8';
      telechargerTexte(texte, 'recap-maria-' + donnees.exporte_le + '.' + extension, type);
      bouton.disabled = false;
      msg.className = 'msg ok';
      msg.textContent = 'Fichier prêt. Rangez-le en lieu sûr.';
    }).catch(function (e) {
      bouton.disabled = false;
      msg.className = 'msg ko';
      msg.textContent = 'L’export n’a pas abouti : ' + Kit.messageErreur(e) + ' Rien n’a été écrit.';
    });
  }

  function telechargerTexte(texte, nom, type) {
    var blob = new global.Blob([texte], { type: type });
    var url = global.URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = nom;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    global.setTimeout(function () { global.URL.revokeObjectURL(url); }, 1000);
  }

  /* Le document LISIBLE : un mois par section, en français, sans jargon. Il
     doit se comprendre seul, des années après, par quelqu'un qui n'a jamais
     vu l'application. */
  function enDocument(d) {
    var parContrat = {};
    (d.contrats || []).forEach(function (c) { parContrat[c.id] = c; });

    var out = ['RÉCAP MARIA — HISTORIQUE COMPLET',
               'Exporté le ' + Kit.dateLongue(d.exporte_le), ''];

    (d.contrats || []).forEach(function (c) {
      out.push('==============================================================');
      out.push(c.prenom_enfant + (c.nom ? ' ' + c.nom : '') +
        ' — famille ' + ((c.famille && c.famille.nom) || '—'));
      out.push('Du ' + Kit.dateLongue(c.date_debut) +
        (c.date_fin ? ' au ' + Kit.dateLongue(c.date_fin) : ' à aujourd’hui') +
        (c.archive ? ' (contrat terminé)' : ''));
      out.push('');

      var recaps = (d.recapitulatifs || []).filter(function (r) { return r.contrat_id === c.id; })
        .sort(function (a, b) { return (a.annee * 12 + a.mois) - (b.annee * 12 + b.mois); });
      if (!recaps.length) { out.push('  Aucun mois enregistré.'); out.push(''); return; }

      recaps.forEach(function (r) {
        var v = r.donnees || {};
        out.push('  ' + Kit.moisCapitale(r.annee, r.mois) +
          (r.statut === 'fige' ? ' — clôturé' : ' — en cours'));
        out.push('    Jours de présence      : ' + (v.joursPresence || 0));
        out.push('    Indemnité d’entretien  : ' + Kit.eur(v.entretienCentimes || 0));
        out.push('    Salaire net            : ' + Kit.eur(v.salaireNetCentimes || 0));
        out.push('    Total à verser         : ' + Kit.eur(v.totalAVerserCentimes || 0));
        out.push('    Heures supplémentaires : ' + Kit.heures(v.minutesSupAcquises || 0));
        out.push('    Congés décomptés       : ' + (v.joursCongesDecomptes || 0) + ' j ouvrables');
        out.push('');
      });
    });

    out.push('==============================================================');
    out.push('Les congés payés d’une assistante maternelle se comptent en jours');
    out.push('ouvrables, du lundi au samedi. Une semaine complète compte 6 jours.');
    return out.join('\n');
  }

  /* Le TABLEAU : une ligne par mois et par contrat, ouvrable dans un tableur.
     Séparateur POINT-VIRGULE et non virgule : les montants français portent
     une virgule décimale, et un tableur francophone attend le point-virgule.
     Les montants sont exportés en CENTIMES ENTIERS pour rester exacts — un
     tableur qui relit « 1 610,00 » selon ses propres réglages introduirait un
     arrondi dans un chiffre qui n'en a jamais eu. */
  function enTableau(d) {
    var parContrat = {};
    (d.contrats || []).forEach(function (c) { parContrat[c.id] = c; });

    var lignes = [['enfant', 'famille', 'annee', 'mois', 'statut',
      'jours_presence', 'entretien_centimes', 'salaire_net_centimes',
      'total_a_verser_centimes', 'minutes_sup_acquises', 'jours_conges_decomptes'].join(';')];

    (d.recapitulatifs || []).slice().sort(function (a, b) {
      return (a.annee * 12 + a.mois) - (b.annee * 12 + b.mois);
    }).forEach(function (r) {
      var c = parContrat[r.contrat_id] || {};
      var v = r.donnees || {};
      lignes.push([
        csv(c.prenom_enfant), csv((c.famille && c.famille.nom) || ''),
        r.annee, r.mois, r.statut === 'fige' ? 'clôturé' : 'en cours',
        v.joursPresence || 0, v.entretienCentimes || 0, v.salaireNetCentimes || 0,
        v.totalAVerserCentimes || 0, v.minutesSupAcquises || 0, v.joursCongesDecomptes || 0
      ].join(';'));
    });
    return lignes.join('\n');
  }

  function csv(v) {
    var t = String(v == null ? '' : v);
    return /[";\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  }

  /* ------------------------------------------------------------------ */
  /* LOT 15 — Rappels par notification (V8-26)                           */
  /*                                                                     */
  /* Ce lot dépend de trois choses hors de notre portée : un service qui  */
  /* envoie, la permission du téléphone, et — sur iPhone — l'application  */
  /* installée sur l'écran d'accueil. Chacune peut manquer.               */
  /*                                                                     */
  /* D'où la règle qui structure cet écran : LA PASTILLE FONCTIONNE       */
  /* TOUJOURS. Elle ne demande ni permission, ni serveur, ni installation.*/
  /* Les notifications sont un confort par-dessus ; la pastille est le    */
  /* filet. Quand la permission est refusée, on le DIT et on rappelle que */
  /* le filet est là — plutôt que de laisser Maria croire qu'un rappel    */
  /* viendra alors qu'il ne viendra jamais (risque n° 1).                 */
  /* ------------------------------------------------------------------ */

  /* A3 — CE TEXTE EST DUPLIQUÉ dans supabase/functions/rappels-cloture.
     Impossible de le partager : l'un tourne dans un navigateur, l'autre dans
     Deno. Toute modification doit être faite AUX DEUX ENDROITS, et le test de
     fumée du lot 15 compare les deux chaînes caractère par caractère. */
  function texteDuRappel(nb) {
    return nb === 1 ? 'Il vous reste 1 mois à clôturer.'
                    : 'Il vous reste ' + nb + ' mois à clôturer.';
  }

  function afficherRappels(ctx) {
    global.App.barreRetour(ctx.barre, 'Me rappeler de clôturer');
    ctx.corps.appendChild(Kit.ce('div', 'attente', 'Lecture de vos réglages…'));

    return global.DB.getPreferenceRappel().catch(function () { return null; })
      .then(function (pref) {
        Kit.vider(ctx.corps);
        rendreRappels(ctx.corps, pref || { actif: false, jour_du_mois: 25,
          heure: '19:00', chaque_jour_ensuite: true });
      });
  }

  function rendreRappels(corps, pref) {
    var etat = {
      actif: !!pref.actif,
      jour: pref.jour_du_mois || 25,
      heure: String(pref.heure || '19:00').slice(0, 5),
      chaque: pref.chaque_jour_ensuite !== false
    };

    var p = Kit.pane('Me rappeler de clôturer mes mois');

    var ligneActif = Kit.ce('label', 'coche-ligne');
    var boxActif = document.createElement('input');
    boxActif.type = 'checkbox';
    boxActif.checked = etat.actif;
    ligneActif.appendChild(boxActif);
    var txA = Kit.ce('span', 'tx');
    txA.appendChild(Kit.ce('b', null, 'Recevoir un rappel sur mon téléphone'));
    txA.appendChild(Kit.ce('span', 'd',
      'Même application fermée, si votre téléphone l’autorise.'));
    ligneActif.appendChild(txA);
    p.appendChild(ligneActif);

    var reglages = Kit.ce('div');
    var selJour = Kit.champSelect('À partir du … du mois',
      joursPossibles(), String(etat.jour));
    reglages.appendChild(selJour.bloc);
    var selHeure = Kit.champSelect('À', heuresPossibles(), etat.heure);
    reglages.appendChild(selHeure.bloc);

    var ligneChaque = Kit.ce('label', 'coche-ligne');
    var boxChaque = document.createElement('input');
    boxChaque.type = 'checkbox';
    boxChaque.checked = etat.chaque;
    ligneChaque.appendChild(boxChaque);
    var txC = Kit.ce('span', 'tx');
    txC.appendChild(Kit.ce('b', null, 'Puis chaque jour tant qu’un mois n’est pas clôturé'));
    ligneChaque.appendChild(txC);
    reglages.appendChild(ligneChaque);
    p.appendChild(reglages);

    /* L'APERÇU du message, sous les réglages. Maria voit exactement ce qui
       arrivera sur son écran. */
    var apercu = Kit.ce('div', 'apercu-rappel');
    apercu.appendChild(Kit.ce('b', null, 'Récap'));
    apercu.appendChild(Kit.ce('span', null, ' — ' + texteDuRappel(2)));
    p.appendChild(Kit.ce('p', 'sb q', 'Ce que vous verrez :'));
    p.appendChild(apercu);

    var msg = Kit.ce('div', 'msg');
    p.appendChild(msg);

    function majVisibilite() { reglages.hidden = !boxActif.checked; }
    boxActif.addEventListener('change', function () {
      majVisibilite();
      if (boxActif.checked) demanderPermission(msg, boxActif);
    });
    majVisibilite();

    var b = Kit.bouton('btn', function () {
      b.disabled = true;
      msg.className = 'msg';
      msg.textContent = 'Enregistrement…';
      global.DB.enregistrerPreferenceRappel({
        actif: boxActif.checked,
        jour_du_mois: Number(selJour.select.value),
        heure: selHeure.select.value,
        chaque_jour_ensuite: boxChaque.checked
      }).then(function () {
        b.disabled = false;
        msg.className = 'msg ok';
        msg.textContent = 'Réglages enregistrés.';
      }).catch(function (e) {
        b.disabled = false;
        msg.className = 'msg ko';
        msg.textContent = 'Enregistrement impossible : ' + Kit.messageErreur(e) +
          ' Vos réglages sont toujours là.';
      });
    });
    b.textContent = 'Enregistrer';
    p.appendChild(b);
    corps.appendChild(p);

    /* A5 — LE FILET, dit explicitement. */
    corps.appendChild(Kit.note('Dans tous les cas, une pastille',
      'Que les notifications soient activées ou non, l’onglet Accueil porte une ' +
      'pastille dès qu’un mois est à clôturer. Elle fonctionne partout, sans ' +
      'permission et sans réseau.'));
  }

  function joursPossibles() {
    var out = [];
    for (var j = 20; j <= 31; j++) out.push([String(j), String(j)]);
    return out;
  }
  function heuresPossibles() {
    var out = [];
    for (var h = 7; h <= 22; h++) {
      var hh = String(h).padStart(2, '0');
      out.push([hh + ':00', hh + ' h']);
      out.push([hh + ':30', hh + ' h 30']);
    }
    return out;
  }

  /* A2 — LE REFUS DE PERMISSION EST EXPLIQUÉ EN FRANÇAIS, sans terme
     technique, et la pastille prend le relais. Le pire serait de laisser la
     case cochée : Maria croirait qu'un rappel viendra, et il ne viendrait
     jamais. */
  function demanderPermission(msg, boxActif) {
    if (!global.Notification || !global.navigator || !global.navigator.serviceWorker) {
      msg.className = 'msg ko';
      msg.textContent = 'Ce téléphone ne sait pas afficher de notifications. ' +
        'La pastille dans l’application prendra le relais.';
      boxActif.checked = false;
      return;
    }
    global.Notification.requestPermission().then(function (reponse) {
      if (reponse === 'granted') {
        msg.className = 'msg ok';
        msg.textContent = 'Notifications autorisées.';
        return abonner().catch(function (e) {
          msg.className = 'msg ko';
          msg.textContent = 'L’abonnement n’a pas abouti : ' + Kit.messageErreur(e) +
            ' La pastille dans l’application prend le relais.';
        });
      }
      msg.className = 'msg ko';
      msg.textContent = 'Les notifications sont bloquées sur ce téléphone. ' +
        'Vous les retrouverez dans les réglages de votre téléphone, à la ligne ' +
        'Récap. En attendant, un rappel s’affichera dans l’application.';
      boxActif.checked = false;
      var ev = document.createEvent('Event');
      ev.initEvent('change', true, true);
      boxActif.dispatchEvent(ev);
    });
  }

  /* L'abonnement de CET appareil. La clé publique VAPID vient de config.js —
     elle est publique par nature, contrairement à la privée qui ne quitte
     jamais les secrets de la fonction serveur (A4). */
  function abonner() {
    var cfg = global.RECAP_MARIA_CONFIG || {};
    var clePublique = cfg.VAPID_PUBLIC_KEY;
    if (!clePublique) {
      return Promise.reject(new Error(
        'les notifications ne sont pas encore configurées sur ce compte'));
    }
    return global.navigator.serviceWorker.ready.then(function (reg) {
      return reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64EnOctets(clePublique)
      });
    }).then(function (ab) {
      var brut = ab.toJSON();
      return global.DB.enregistrerAbonnementPush({
        endpoint: brut.endpoint,
        cle_p256dh: brut.keys.p256dh,
        cle_auth: brut.keys.auth
      });
    });
  }

  function base64EnOctets(base64) {
    var complet = (base64 + '='.repeat((4 - base64.length % 4) % 4))
      .replace(/-/g, '+').replace(/_/g, '/');
    var brut = global.atob(complet);
    var octets = new Uint8Array(brut.length);
    for (var i = 0; i < brut.length; i++) octets[i] = brut.charCodeAt(i);
    return octets;
  }

  function deconnecter(bouton) {
    bouton.disabled = true;
    global.App.deconnecter().catch(function () { bouton.disabled = false; });
  }

  global.UiMenu = { afficher: afficher, texteDuRappel: texteDuRappel };
})(window);
