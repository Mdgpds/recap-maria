/* ============================================================================
   ui-contrat.js — Fiche contrat, barèmes, règles et fin de contrat (§2.7).

   La fiche montre, en clair et sans jargon, ce qui gouverne les calculs de ce
   contrat : identité, horaires, rémunération, et les règles paramétrables.

   Trois corrections de la relecture du lot 6 vivent ici, et elles ont la même
   racine : la refonte avait rendu la fiche entièrement CONSULTABLE et plus du
   tout MODIFIABLE, alors que deux écrans promettaient l'inverse.

   - B3 — UN BARÈME SE CORRIGE. Il n'était qu'ajoutable : un net oublié restait
     à zéro pour toujours, une faute de frappe au brut était définitive, et
     recréer un barème à la même date se heurtait à « un barème existe déjà ».
     Modifier et supprimer sont rétablis, avec le garde-fou du lot 5 : un
     barème dont dépend un mois CLÔTURÉ ne bouge plus, et on dit lequel.

   - R1 — LE CONTRAT SE MODIFIE. Prénom, nom de famille, dates, planning,
     horaires, minutes, indemnité, statut : tout redevient modifiable. Une
     famille qui passe de cinq à quatre jours de garde rendait sinon FAUX tous
     ses mois suivants, sans aucun recours.

   - R3 / R4 — LES AVERTISSEMENTS DU LOT 5 SONT RENDUS. Une date d'effet
     rétroactive dit désormais quels récapitulatifs non clôturés elle va
     recalculer ; une date de fin tombant dans un mois déjà clôturé dit que ce
     document, lui, ne sera pas recalculé.

   Aucune formule n'est réécrite : la valorisation des heures supplémentaires
   passe par Engine.montantCentimes avec le coefficient de RG-13, la sélection
   du barème par Engine.salaireApplicable, les soldes par la chaîne des mois.
   ========================================================================= */
(function (global) {
  'use strict';

  var Kit = global.Kit;
  var Chaine = global.ChaineMois;
  var Engine = global.Engine;

  /* Majoration du solde d'heures supplémentaires à la fin du contrat (RG-13).
     Clause écrite au contrat, identique aux quatre contrats : elle n'a pas de
     colonne en base et n'en gagne pas une dans un lot d'interface. Le libellé
     affiché en DÉRIVE (remarque 2 de la relecture) : « +50 % » n'est plus écrit
     en dur à côté d'une constante qui pourrait dire autre chose. */
  var COEFF_FIN_CONTRAT = 1.5;
  function libelleMajoration() {
    return '+' + Math.round((COEFF_FIN_CONTRAT - 1) * 100) + ' %';
  }

  var JOURS = [[1, 'lundi'], [2, 'mardi'], [3, 'mercredi'], [4, 'jeudi'],
               [5, 'vendredi'], [6, 'samedi'], [7, 'dimanche']];

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

    /* LOT 17 §17.9 — le rattachement à un contrat type ne se lit plus : les
       contrats types sortent de l'application, et la notion d'« écart »
       disparaît avec eux. La colonne `contrat.modele_id` reste en base. */
    /* CORRECTION B2 DE LA RELECTURE DU LOT 17 — CETTE LECTURE ÉCHOUE FERMÉ.

       `.catch(function () { return []; })` transformait un échec de lecture en
       « aucun mois n'est clôturé ». Or cette liste est la source UNIQUE des
       trois garde-fous du §17.4 : quels mois le sélecteur interdit, quels mois
       clôturés dépendent d'un avenant qu'on veut corriger, et les mêmes pour
       la suppression.

       Conséquence mesurée par la relecture : sur une simple coupure réseau,
       Maria pouvait poser un avenant sur un mois clôturé, et SUPPRIMER
       l'avenant qui avait produit un document déjà parti chez une famille.

       C'est le défaut B7 d'août, corrigé une fois puis revenu sur un écran
       neuf. Le correctif correct existait à quelques centaines de lignes de
       là, dans `js/ui-menu.js` : `{ ok, liste }` / `{ ok, erreur }`. Il est
       repris ici, et il est repris À L'IDENTIQUE — un échec ne rend pas une
       liste, il rend un état. */
    return Promise.all([
      global.App.avenants(contrat.id),
      global.DB.listRecapsContrat(contrat.id)
        .then(function (l) { return { ok: true, liste: l || [], erreur: null }; })
        .catch(function (e) { return { ok: false, liste: [], erreur: e }; })
    ]).then(function (r) {
      var avenants = r[0] || [];
      var recaps = r[1];
      Kit.vider(ctx.corps);
      var corps = ctx.corps;

      corps.appendChild(Kit.section('Identité'));

      /* LOT 8 — la photo et la couleur, en tête : c'est ce qui distingue
         quatre cartes d'accueil autrement identiques. */
      var portrait = Kit.ce('div', 'portrait');
      portrait.appendChild(Kit.avatar(contrat, 'gd'));
      var pTx = Kit.ce('div');
      pTx.appendChild(Kit.ce('div', 'nm', Kit.nomComplet(contrat)));
      pTx.appendChild(Kit.ce('div', 'fm', 'famille ' + ((contrat.famille && contrat.famille.nom) || '—')));
      portrait.appendChild(pTx);
      corps.appendChild(portrait);

      /* LOT 22 §22.2 — LA PHOTO DEVIENT ACCESSIBLE.

         Elle existe depuis le lot 8 : réduite à 200 px, 50 Ko au plus, jamais
         sur un document ni dans l'export. Mais on ne pouvait la poser que
         depuis « Modifier l'identité » — un formulaire de douze champs où l'on
         croise la date de début du contrat et son statut. Le geste le plus
         anodin passait par l'écran le plus risqué, et personne ne l'a jamais
         fait : l'application avait une photo que personne ne pouvait mettre.

         Elle est donc EN TÊTE DE LA FICHE, et elle s'enregistre toute seule.
         Sur un contrat rangé, elle reste en lecture : un contrat terminé ne se
         modifie plus. */
      if (!contrat.archive) {
        corps.appendChild(blocPhoto({ valeur: contrat.photo || null }, {
          grand: true,
          enregistrer: function (valeur) {
            return majIdentiteSurPlace(contrat, { photo: valeur });
          }
        }));
      }

      /* LOT 18 §18.3 — LE PRÉNOM ET LE NOM SE CORRIGENT SUR PLACE.

         Corriger une faute d'orthographe demandait d'ouvrir « Modifier
         l'identité », un formulaire de douze champs où l'on croise la date de
         début du contrat et son statut — deux réglages qui, eux, changent des
         calculs. Le geste le plus anodin de la fiche passait par l'écran le
         plus risqué.

         Ces deux champs-là ne changent AUCUN chiffre : ils changent un nom.
         Ils se corrigent donc ici, d'un appui, et le formulaire complet reste
         pour tout le reste. Sur un contrat rangé, les champs redeviennent de
         simples lignes en lecture : un contrat terminé ne se modifie plus. */
      if (contrat.archive) {
        corps.appendChild(Kit.fld('Prénom de l’enfant', contrat.prenom_enfant));
        corps.appendChild(Kit.fld('Nom de l’enfant', contrat.nom || '—'));
      } else {
        corps.appendChild(Kit.fldModifiable('Prénom de l’enfant', contrat.prenom_enfant, {
          obligatoire: 'Le prénom de l’enfant est obligatoire.',
          enregistrer: function (v) { return majIdentiteSurPlace(contrat, { prenom_enfant: v }); }
        }));
        corps.appendChild(Kit.fldModifiable('Nom de l’enfant', contrat.nom, {
          enregistrer: function (v) { return majIdentiteSurPlace(contrat, { nom: v }); }
        }));
      }
      corps.appendChild(Kit.fld('Genre', libelleGenre(contrat.genre)));

      /* LOT 8 — LE CHAMP « Nom de la famille » A DISPARU DE CETTE FICHE.
         Il était un champ TEXTE, et le remplir renommait le FOYER, donc tous
         ses enfants d'un coup, sans que rien ne le dise. Le rattachement se lit
         désormais ici, et se change par un geste qui ouvre la liste des foyers
         existants : personne n'écrit plus un nom de famille depuis un écran
         qui parle d'un enfant. */
      var fFamille = Kit.fld('Famille', (contrat.famille && contrat.famille.nom) || '—');
      corps.appendChild(fFamille);
      if (!contrat.archive) {
        var bFam = Kit.bouton('btn nt', function () { feuilleChangerFamille(contrat); });
        bFam.textContent = 'Changer de famille';
        corps.appendChild(bFam);
      }

      corps.appendChild(Kit.fld('Début du contrat', Kit.dateLongue(contrat.date_debut)));
      if (contrat.date_fin) corps.appendChild(Kit.fld('Fin du contrat', Kit.dateLongue(contrat.date_fin)));

      if (!contrat.archive) {
        var bModif = Kit.bouton('btn nt', function () { feuilleContrat(contrat, recaps); });
        bModif.textContent = 'Modifier l’identité';
        corps.appendChild(bModif);
      }

      /* LOT 17 §17.4 — LES CONDITIONS, EN VIGUEUR AUJOURD'HUI, ET DATÉES.

         Les trois sections « Horaires », « Rémunération » et « Règles de ce
         contrat » n'en font plus qu'une. Elles présentaient les valeurs
         COURANTES de `contrat` comme si elles avaient toujours valu ça, et
         chacune avait son bouton pour les changer sans aucune date. C'est
         précisément ce qui rendait faux un juillet qui traînait. */
      corps.appendChild(blocConditions(contrat, avenants, recaps));

      /* LOT 20 (§20.4 d) — LA PORTE DE LA PÉRIODE DE FAMILIARISATION.

         Elle est sur la fiche, sous les conditions, parce que la période est
         un CADRE du contrat au même titre qu'elles : elle décide de la règle
         de rémunération d'une partie du mois. Le nombre de périodes est lu
         ici pour que la ligne dise ce qu'elle ouvre — une entrée muette qui
         mène parfois à un écran vide n'apprend rien. Un échec de lecture ne
         cache pas la ligne : il le dit et laisse entrer. */
      corps.appendChild(ligneFamiliarisation(contrat));

      if (contrat.archive) {
        /* LOT 22 §22.1 — LE CONTRAT TERMINÉ S'OUVRE EN LECTURE SEULE, ET LE DIT.

           La lecture seule EXISTE déjà : aucune journée d'un contrat rangé ne
           se modifie, aucun avenant ne s'y pose, et l'espace mensuel se rend
           en consultation. Ce que ce lot lui donne, c'est sa PORTE D'ENTRÉE et
           sa phrase — l'ancienne renvoyait vers « Anciens contrats », une
           entrée de Menu qui n'existe plus depuis le lot 8. Une fiche qui
           indique un chemin disparu est pire qu'une fiche muette.

           Trois choses, et trois seulement : ce que le bandeau promet, ses
           mois, et ses soldes de fin de contrat. */
        corps.appendChild(Kit.note('Contrat terminé — ' + periodeDuContrat(contrat),
          'Aucune journée n’est modifiable, et aucun montant ne bougera plus. ' +
          'Tout son historique reste consultable ci-dessous.'));

        var bMois = Kit.bouton('btn nt', function () {
          global.App.aller('historique', { contratId: contrat.id });
        });
        bMois.textContent = 'Voir tous ses mois';
        corps.appendChild(bMois);

        var bSoldes = Kit.bouton('btn nt', function () {
          global.App.aller('fiche', { contratId: contrat.id, section: 'fin' });
        });
        bSoldes.textContent = 'Ses soldes de fin de contrat';
        corps.appendChild(bSoldes);

        var bRemettre = Kit.bouton('btn nt', function () { remettreEnCours(contrat, bRemettre); });
        bRemettre.textContent = 'Remettre en cours';
        corps.appendChild(bRemettre);
      } else {
        var bFin = Kit.bouton('btn dg', function () {
          global.App.aller('fiche', { contratId: contrat.id, section: 'fin' });
        });
        bFin.textContent = 'Ce contrat est terminé';
        corps.appendChild(bFin);

        /* LOT 14 (V8-20) — LA SUPPRESSION FRANCHE, uniquement sur un contrat
           VIERGE. C'est le cas de la faute de frappe : un enfant créé deux
           fois, un prénom mal saisi. L'archiver serait absurde, il n'y a rien
           à conserver.

           ON NE MONTRE JAMAIS UNE ACTION IMPOSSIBLE : dès qu'une journée ou un
           récapitulatif existe, le bouton n'apparaît pas — et AUCUN message
           n'explique son absence. Un « suppression impossible car… » grisé
           n'apprendrait rien à Maria et lui ferait croire qu'elle a raté
           quelque chose. Le bouton d'archivage, lui, est déjà là.

           La vérification affichée ici est une COURTOISIE. La garantie est en
           base (migration 010) : les six clés étrangères qui pointent vers
           `contrat` sont en cascade, et sans le trigger un delete emporterait
           silencieusement des mois clôturés. */
        global.DB.contratEstVierge(contrat.id).then(function (vierge) {
          if (!vierge) return;
          var bSuppr = Kit.bouton('btn nt', function () { feuilleSuppression(contrat); });
          bSuppr.textContent = 'Supprimer ce contrat';
          corps.appendChild(bSuppr);
          corps.appendChild(Kit.ce('p', 'sb q',
            'Possible car aucune journée n’a encore été saisie.'));
        }).catch(function () {
          /* Lecture impossible : on ne montre RIEN plutôt que de proposer une
             suppression dont on ignore si elle est légitime. */
        });
      }
    });
  }

  function feuilleSuppression(contrat) {
    Kit.ouvrirFeuille('Supprimer le contrat de ' + contrat.prenom_enfant + ' ?',
      'Cette action est définitive.', function (corps) {
        corps.appendChild(Kit.ce('p', 'sb q',
          'Ce contrat ne porte aucune journée ni aucun mois enregistré : il ne reste ' +
          'rien à conserver. Si vous voulez garder son historique, choisissez plutôt ' +
          '« Ce contrat est terminé ».'));

        var msg = Kit.ce('div', 'msg');
        corps.appendChild(msg);

        var b = Kit.bouton('btn dg', function () {
          b.disabled = true;
          msg.className = 'msg';
          msg.textContent = 'Suppression…';
          global.DB.supprimerContrat(contrat.id)
            .then(function () { return global.App.rechargerContrats(); })
            .then(function () {
              Kit.fermerFeuille();
              Kit.toast('Le contrat de ' + contrat.prenom_enfant + ' est supprimé.');
              global.App.aller('accueil', {}, true);
            })
            .catch(function (e) {
              b.disabled = false;
              msg.className = 'msg ko';
              msg.textContent = 'Suppression impossible : ' + Kit.messageErreur(e) +
                ' Rien n’a été supprimé.';
            });
        });
        b.textContent = 'Supprimer définitivement';
        corps.appendChild(b);

        var bNon = Kit.bouton('btn nt', function () { Kit.fermerFeuille(); });
        bNon.textContent = 'Annuler';
        corps.appendChild(bNon);
      });
  }

  /* ================================================================== */
  /* CODE MORT DEPUIS LE LOT 17 — RETRAIT AU §19.2                       */
  /*                                                                     */
  /* Deux familles de fonctions, mortes pour deux raisons différentes.    */
  /*                                                                     */
  /* LES BARÈMES (`carteBareme`, `feuilleBareme`,                        */
  /* `feuilleSuppressionBareme`, `moisClosDependants`) : la table         */
  /* `salaire_contrat` est devenue `avenant_contrat` et porte les ONZE    */
  /* réglages (§17.2). Un écran qui ne daterait QUE le brut et le net     */
  /* redonnerait l'impression qu'eux seuls ont un historique — c'est      */
  /* exactement l'idée fausse que ce lot corrige. Ils sont remplacés par  */
  /* la frise et « Faire un avenant ».                                     */
  /*                                                                     */
  /* LES CONTRATS TYPES (`blocModele`, `ligneEcartReferme`, `phraseEcart`,*/
  /* `valeurLisible`, `feuilleAlignerCeContrat`) : décision d'Adrien      */
  /* (§17.9). Les données restent en base ; la notion d'« écart »         */
  /* disparaît, puisque plus rien ne compare un contrat à une référence.   */
  /*                                                                     */
  /* `feuilleRegles` : « modifier les conditions sans passer par un       */
  /* avenant n'existe plus » (§17.4).                                     */
  /*                                                                     */
  /* CE CODE NE FONCTIONNE PLUS — il appelle `DB.getSalaires`,           */
  /* `DB.ajouterSalaire`, `DB.majSalaire`, `DB.supprimerSalaire` et      */
  /* `Engine.salaireApplicable`, qui n'existent plus. C'est délibéré :    */
  /* un écran qui écrirait encore un réglage sans date serait le seul     */
  /* moyen d'effacer le passé sans s'en apercevoir. Plus aucun appelant   */
  /* ne le touche ; la spécification demande de le SIGNALER, pas de le    */
  /* supprimer dans ce lot.                                               */
  /* ================================================================== */

  /* CODE MORT DEPUIS LE LOT 17 — RETRAIT AU §19.2. Voir la bannière plus bas. */
  function carteBareme(contrat, s, salaires, recaps, enVigueur) {
    var carte = Kit.ce('div', 'card');
    var row = Kit.ce('div', 'row');
    row.appendChild(Kit.ce('span', 'nm', 'Depuis le ' + Kit.dateLongue(s.date_effet)));
    if (enVigueur && enVigueur.id === s.id) {
      row.appendChild(Kit.ce('span', 'badge ok', 'en cours'));
    }
    carte.appendChild(row);
    carte.appendChild(Kit.ce('div', 'sb',
      'Brut ' + Kit.eur(s.brut_mensuel_centimes) + ' · Net ' +
      (s.net_mensuel_centimes ? Kit.eur(s.net_mensuel_centimes) : 'non renseigné')));
    if (!s.net_mensuel_centimes) {
      carte.appendChild(Kit.ce('div', 'sb', 'Les récapitulatifs des mois concernés sont incomplets ' +
        'et ne peuvent pas être clôturés tant que le net manque.'));
    }
    if (contrat.archive) return carte;

    var moisClos = moisClosDependants(s, salaires, recaps);
    if (moisClos.length) {
      carte.appendChild(Kit.ce('div', 'sb q',
        'Ce barème sert au(x) mois clôturé(s) de ' + listeMois(moisClos) +
        ' : il ne peut plus être modifié ni supprimé.'));
      return carte;
    }
    var b = Kit.bouton('btn nt', function () { feuilleBareme(contrat, s, salaires, recaps); });
    b.textContent = 'Modifier ce barème';
    b.style.marginTop = '8px';
    carte.appendChild(b);
    var d = Kit.bouton('btn dg', function () { feuilleSuppressionBareme(contrat, s, salaires, recaps); });
    d.textContent = 'Supprimer ce barème';
    carte.appendChild(d);
    return carte;
  }

  function libelleStatut(s) {
    return { familiarisation: 'familiarisation', actif: 'actif', termine: 'terminé' }[s] || s;
  }
  function heureCourte(h) { return String(h || '').slice(0, 5) || '—'; }

  /* LOT 16 §16.5 — L'HEURE À LAQUELLE L'ENFANT REPART, PRODUITE À PARTIR DES
     VALEURS APPLIQUÉES, jamais écrite en dur. C'est fin d'accueil + minutes
     supplémentaires du contrat : un contrat qui en prévoit 45 le dira, et une
     constante « 18 h » serait fausse ce jour-là sans que rien ne le signale.
     Aucun calcul métier : une addition de minutes d'horloge, pas une règle. */
  function finReelle(contrat) {
    var h = String(contrat.heure_depart || '').slice(0, 5).split(':');
    if (h.length !== 2) return '—';
    var total = Number(h[0]) * 60 + Number(h[1]) + (contrat.minutes_sup_jour || 0);
    if (!isFinite(total)) return '—';
    total = ((total % 1440) + 1440) % 1440;
    var mm = total % 60;
    return Math.floor(total / 60) + ' h' + (mm ? ' ' + String(mm).padStart(2, '0') : '');
  }
  var NOMS_JOURS = ['', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'];
  function libellePlanning(planning) {
    var p = (planning || [1, 2, 3, 4, 5]).slice().sort(function (a, b) { return a - b; });
    if (!p.length) return '—';
    var continu = p.every(function (j, i) { return i === 0 || j === p[i - 1] + 1; });
    if (continu && p.length > 2) return NOMS_JOURS[p[0]] + ' → ' + NOMS_JOURS[p[p.length - 1]];
    return p.map(function (j) { return NOMS_JOURS[j]; }).join(', ');
  }

  /* ------------------------------------------------------------------ */
  /* Modifier le contrat et la famille (restauration R1)                 */
  /* ------------------------------------------------------------------ */

  /* Champs dont la modification CHANGE des chiffres déjà calculés. Les mois
     clôturés sont protégés en base, mais tous les mois non clôturés seront
     recalculés — y compris des montants déjà annoncés aux parents. On demande
     confirmation en nommant ce qui change. */
  /* LOT 17 §17.4 — LES RÉGLAGES SORTENT DE CETTE LISTE.

     Les six réglages qu'elle contenait ne se modifient plus depuis une fiche :
     ils sont datés, et passent par un avenant, qui a son propre garde-fou —
     il ne peut pas prendre effet sur un mois clôturé.

     Restent les deux DATES. Ce ne sont pas des réglages : elles bornent le
     contrat, elles ne le tarifient pas. Mais les déplacer change bel et bien
     tous les mois non clôturés — un début reculé fait apparaître des journées,
     une fin avancée en fait disparaître, et le §17.7 proratise désormais le
     salaire des mois partiels. L'avertissement les concernant reste donc. */
  var CHAMPS_SENSIBLES = [
    ['date_debut', 'le premier jour de garde'],
    ['date_fin', 'le dernier jour de garde']
  ];

  function changementsSensibles(contrat, saisis) {
    var out = [];
    CHAMPS_SENSIBLES.forEach(function (c) {
      var avant = contrat[c[0]];
      var apres = saisis[c[0]];
      if (apres === undefined) return;
      var egal = (Array.isArray(avant) || Array.isArray(apres))
        ? String(avant) === String(apres)
        : String(avant == null ? '' : avant).slice(0, 10) === String(apres == null ? '' : apres).slice(0, 10);
      if (!egal) out.push(c[1]);
    });
    return out;
  }

  /* LOT 17 §17.4 — CETTE FEUILLE NE TOUCHE PLUS AUX CONDITIONS.

     Elle portait les jours de garde, les horaires, les minutes
     supplémentaires, la durée d'un jour de congé et l'indemnité d'entretien,
     et les écrivait sur `contrat` — sans aucune date. Tous les mois non
     clôturés étaient alors recalculés, y compris ceux d'il y a deux ans, et
     l'écran devait avertir « vous modifiez … touchez de nouveau pour
     confirmer ». Cet avertissement était le symptôme : un geste dont on ne
     peut pas dire l'effet ne devrait pas exister.

     « Modifier les conditions sans passer par un avenant n'existe plus. »
     Il ne reste ici que l'IDENTITÉ — le prénom, le nom, le genre, la couleur,
     la photo — et deux champs qui ne sont pas des conditions de calcul : la
     date de début et le statut.

     La date de début reste ici parce qu'elle borne le contrat, elle ne le
     règle pas : le moteur s'en sert pour ignorer les jours d'avant, jamais
     pour choisir un tarif. Elle reste donc sensible, et l'avertissement la
     concernant est conservé. */
  /* L'écriture de la correction sur place. Un seul champ part à la fois, et
     RIEN d'autre : ni date de début, ni statut, ni couleur. Le nom du FOYER
     n'est pas touché non plus — c'est le défaut du lot 8, et il ne revient
     pas par cette porte.

     La liste des contrats est rechargée pour que les autres écrans affichent
     le nouveau nom ; l'écran courant se redessine ensuite. Un échec remonte
     tel quel : c'est le champ qui l'annonce et qui garde la saisie. */
  /* La période d'un contrat, en clair. Sert au bandeau du §22.1 et à la carte
     d'un contrat terminé sur la page « Mes enfants » — la même phrase aux deux
     endroits, écrite une fois. */
  function periodeDuContrat(contrat) {
    if (!contrat.date_debut) return 'période inconnue';
    return 'du ' + Kit.dateLongue(contrat.date_debut) +
      (contrat.date_fin ? ' au ' + Kit.dateLongue(contrat.date_fin) : '');
  }

  function majIdentiteSurPlace(contrat, champs) {
    return global.DB.majContrat(contrat.id, champs).then(function () {
      for (var k in champs) contrat[k] = champs[k];
      return global.App.rechargerContrats();
    }).then(function () {
      Kit.toast('C’est enregistré.');
      return global.App.rafraichir();
    });
  }

  function feuilleContrat(contrat, recaps) {
    var maintenant = global.App.moisCourant();
    Kit.ouvrirFeuille('Modifier l’identité', contrat.prenom_enfant,
      function (corps) {
        var prenom = Kit.champ('Prénom de l’enfant', contrat.prenom_enfant);
        corps.appendChild(prenom.bloc);
        /* LOT 8 — le champ « Nom de la famille » est REMPLACÉ par le nom de
           l'ENFANT. Ce sont deux choses distinctes, et les confondre était le
           défaut. Le nom du foyer se change depuis l'écran Familles, qui
           annonce les enfants concernés. */
        var nomEnfant = Kit.champ('Nom de l’enfant', contrat.nom || '');
        corps.appendChild(nomEnfant.bloc);

        var genre = Kit.champSelect('Genre', [
          ['', 'non précisé'],
          ['f', 'une fille'],
          ['g', 'un garçon']
        ], contrat.genre || '');
        corps.appendChild(genre.bloc);
        corps.appendChild(Kit.ce('p', 'sb q',
          'Le genre sert uniquement à accorder les phrases de l’application. ' +
          'Sans lui, elles restent neutres.'));

        var couleurChoisie = { jeton: contrat.couleur || null };
        corps.appendChild(nuancier(couleurChoisie));

        var photoCourante = { valeur: contrat.photo || null };
        corps.appendChild(blocPhoto(photoCourante));

        var debut = Kit.champDate('Premier jour de garde', contrat.date_debut,
          { anneeMin: Number(String(contrat.date_debut).slice(0, 4)) - 3, anneeMax: maintenant.annee + 2 });
        corps.appendChild(debut.bloc);

        var statut = Kit.champSelect('Statut du contrat', [
          ['familiarisation', 'Familiarisation'],
          ['actif', 'Actif'],
          ['termine', 'Terminé']
        ], contrat.statut || 'actif');
        corps.appendChild(statut.bloc);

        corps.appendChild(Kit.ce('p', 'sb q',
          'Les jours de garde, les horaires, l’entretien et la rémunération ne se ' +
          'modifient plus ici : ils sont datés. Passez par « Faire un avenant » sur la ' +
          'fiche du contrat — les mois d’avant ne bougeront pas.'));

        var msg = Kit.ce('div', 'msg');
        corps.appendChild(msg);
        var confirme = false;
        var b = Kit.bouton('btn', function () { enregistrer(); });
        b.textContent = 'Enregistrer';
        corps.appendChild(b);

        function erreur(t) { msg.textContent = t; msg.className = 'msg ko'; }

        function enregistrer() {
          msg.textContent = ''; msg.className = 'msg';
          var p = prenom.input.value.trim();
          if (!p) { erreur('Le prénom de l’enfant est obligatoire.'); return; }

          var saisis = {
            prenom_enfant: p,
            date_debut: debut.valeur(),
            statut: statut.select.value
          };

          var sensibles = changementsSensibles(contrat, saisis);
          if (sensibles.length && !confirme) {
            confirme = true;
            b.textContent = 'Enregistrer quand même';
            erreur('Vous modifiez ' + sensibles.join(', ') + '. Tous les récapitulatifs NON ' +
              'CLÔTURÉS seront recalculés, y compris ceux des mois passés. Les mois déjà ' +
              'clôturés ne bougeront pas. Touchez de nouveau pour confirmer.');
            return;
          }

          b.disabled = true;
          msg.className = 'msg';
          msg.textContent = 'Enregistrement…';

          /* LOT 8 — plus AUCUN appel à majFamille depuis cette fiche. Ce seul
             appel, déclenché par un champ texte mal nommé, renommait le foyer
             de tous les enfants. Le nom de l'enfant, son genre, sa couleur et
             sa photo partent avec le reste du contrat. */
          saisis.nom = nomEnfant.input.value.trim() || null;
          saisis.genre = genre.select.value || null;
          saisis.couleur = couleurChoisie.jeton || null;
          saisis.photo = photoCourante.valeur || null;

          Promise.resolve()
            .then(function () { return global.DB.majContrat(contrat.id, saisis); })
            .then(function () { return global.App.rechargerContrats(); })
            .then(function () {
              global.App.invalider();
              Kit.fermerFeuille();
              Kit.toast('Contrat enregistré');
              return global.App.rafraichir();
            })
            .catch(function (e) {
              b.disabled = false;
              erreur('Enregistrement impossible : ' + Kit.messageErreur(e) +
                ' Votre saisie est conservée.');
            });
        }
      });
  }

  /* ------------------------------------------------------------------ */
  /* LOT 11 — Le rattachement à un contrat type, et ses ÉCARTS           */
  /*                                                                     */
  /* UN ÉCART N'EST PAS UNE ERREUR (V8-13, risque n° 3). Tom garde son    */
  /* ancienne rémunération parce que ses parents ne l'ont pas             */
  /* revalorisée : c'est un fait négocié, pas un oubli. L'application le  */
  /* CONSTATE — pas d'icône d'alerte, pas de rouge, pas d'injonction. Et  */
  /* « Garder cet écart » ne fait rien d'autre que refermer la mention :  */
  /* un écart ne doit pas devenir une alerte permanente.                  */
  /* ------------------------------------------------------------------ */

  var ecartsMasques = {};   // contratId -> true, le temps de la session

  /* CODE MORT DEPUIS LE LOT 17 — RETRAIT AU §19.2. Voir la bannière plus bas. */
  function blocModele(contrat, modele, salaires) {
    var bloc = Kit.ce('div', 'modele-bloc');
    /* CORRECTIF A4 DE LA RELECTURE PR9 — l'écart se compare au barème EN
       VIGUEUR, pas au DERNIER SAISI. `getSalaires` trie par date d'effet
       croissante : prendre le dernier, c'était prendre un barème FUTUR s'il
       existait. Saisir un relèvement du SMIC au 1ᵉʳ septembre faisait
       apparaître, en août, un « écart » assorti d'un bouton invitant à défaire
       ce qu'on venait de saisir. Quinze lignes plus bas, la section
       Rémunération du même écran affichait, elle, le bon barème. */
    var m = global.App.moisCourant();
    var enVigueur = Engine.salaireApplicable(salaires || [], m.annee, m.mois);
    var ecarts = global.DB.ecartsContratModele(contrat, modele, enVigueur);

    var ligne = Kit.ce('div', 'fld');
    ligne.appendChild(Kit.ce('span', 'lb', 'Contrat type'));
    ligne.appendChild(Kit.ce('span', 'vl', modele.nom));
    bloc.appendChild(ligne);

    if (!ecarts.length) return bloc;

    /* « Garder cet écart » referme la mention pour la session. Mais il ne la
       fait pas DISPARAÎTRE : il reste une ligne discrète, sans injonction, qui
       permet d'y revenir. Sans elle, Maria qui a refermé une fois n'aurait plus
       aucun moyen d'aligner depuis cette fiche — on aurait remplacé une alerte
       trop insistante par une porte fermée. */
    if (ecartsMasques[contrat.id]) {
      bloc.appendChild(ligneEcartReferme(contrat, ecarts));
      return bloc;
    }

    var n = Kit.note(ecarts.length > 1 ? ecarts.length + ' écarts avec ' + modele.nom
                                       : 'Un écart avec ' + modele.nom,
      ecarts.map(function (e) { return phraseEcart(e); }).join(' · ') + '.');
    n.classList.add('ecart');

    var actions = Kit.ce('div', 'actions');
    var bAligner = Kit.bouton('btn nt', function () {
      feuilleAlignerCeContrat(contrat, modele, ecarts, enVigueur);
    });
    bAligner.textContent = 'Aligner sur la version';
    actions.appendChild(bAligner);

    var bGarder = Kit.bouton('btn nt', function () {
      /* Rien d'autre que refermer : aucune écriture, aucune trace. La note est
         remplacée SUR PLACE par la ligne discrète — refermer n'est pas fermer
         la porte. */
      ecartsMasques[contrat.id] = true;
      if (n.parentNode) n.parentNode.replaceChild(ligneEcartReferme(contrat, ecarts), n);
    });
    bGarder.textContent = 'Garder cet écart';
    actions.appendChild(bGarder);
    n.appendChild(actions);

    bloc.appendChild(n);
    return bloc;
  }

  /* CODE MORT DEPUIS LE LOT 17 — RETRAIT AU §19.2. Voir la bannière plus bas. */
  function ligneEcartReferme(contrat, ecarts) {
    var rappel = Kit.ce('div', 'fld ecart-referme');
    rappel.appendChild(Kit.ce('span', 'lb',
      ecarts.length > 1 ? ecarts.length + ' écarts assumés' : 'Un écart assumé'));
    var bVoir = Kit.bouton('lien', function () {
      delete ecartsMasques[contrat.id];
      global.App.rafraichir();
    });
    bVoir.textContent = 'Voir';
    rappel.appendChild(bVoir);
    return rappel;
  }

  function phraseEcart(e) {
    if (e.format === 'remuneration') {
      return 'rémunération ' + Kit.eur(e.valeurContrat.brut_mensuel_centimes) +
        ' au lieu de ' + Kit.eur(e.valeurModele.brut_mensuel_centimes);
    }
    return e.libelle.toLowerCase() + ' ' + valeurLisible(e, e.valeurContrat) +
      ' au lieu de ' + valeurLisible(e, e.valeurModele);
  }

  function valeurLisible(e, v) {
    if (e.format === 'euros') return Kit.eur(v);
    if (e.format === 'duree') return Kit.duree(v);
    if (e.format === 'heure') return String(v).slice(0, 5);
    if (e.format === 'planning') return libellePlanning(v);
    if (e.format === 'oui_non') return v === false ? 'non dues' : 'dues';
    if (e.format === 'ordre') return v === 'sup_puis_cp' ? 'récupération' : 'congés payés';
    return String(v);
  }

  /* CODE MORT DEPUIS LE LOT 17 — RETRAIT AU §19.2. Voir la bannière plus bas. */
  function feuilleAlignerCeContrat(contrat, modele, ecarts, dernierSalaire) {
    var maintenant = global.App.moisCourant();
    var touchRemuneration = ecarts.some(function (e) { return e.champ === 'remuneration'; });

    Kit.ouvrirFeuille('Aligner ' + contrat.prenom_enfant + ' sur ' + modele.nom,
      null, function (corps) {
        var l = Kit.lines(corps);
        ecarts.forEach(function (e) {
          Kit.ligne(l, e.libelle,
            valeurLisible(e, e.format === 'remuneration' ? e.valeurContrat.brut_mensuel_centimes : e.valeurContrat) +
            ' → ' +
            valeurLisible(e, e.format === 'remuneration' ? e.valeurModele.brut_mensuel_centimes : e.valeurModele));
        });

        var effet = null;
        if (touchRemuneration) {
          /* A2 : le mois SUIVANT par défaut, comme la feuille de barème.
             Le 1ᵉʳ du mois en cours appliquait la revalorisation au mois qu'on
             est en train de vivre, sans le dire. */
          var prochainMois = Chaine.moisSuivant(maintenant.annee, maintenant.mois);
          effet = Kit.champDate('Rémunération à partir du',
            Kit.iso(prochainMois.annee, prochainMois.mois, 1),
            { anneeMin: maintenant.annee - 1, anneeMax: maintenant.annee + 3 });
          corps.appendChild(effet.bloc);
        }

        var msg = Kit.ce('div', 'msg');
        corps.appendChild(msg);

        var b = Kit.bouton('btn', function () {
          b.disabled = true;
          msg.className = 'msg';
          msg.textContent = 'Alignement…';
          var reglages = {};
          ecarts.forEach(function (e) {
            if (e.champ !== 'remuneration') reglages[e.champ] = e.valeurModele;
          });
          /* CORRECTIF B6 : le garde-fou des mois clôturés, absent ici comme
             sur les deux autres chemins d'alignement. Et la rémunération part
             AVANT les réglages (A6) : c'est elle qui porte le refus possible,
             et un refus ne doit rien laisser derrière lui. */
          var gardeFou = touchRemuneration
            ? verifierDateEffet([contrat], effet.valeur())
            : Promise.resolve(null);

          gardeFou.then(function (refus) {
            if (refus) {
              var eRefus = new Error('date d’effet sur un mois clôturé');
              eRefus.messageFrancais = 'mois déjà clôturé(s) — ' + refus +
                '. Choisissez une date postérieure : un mois clôturé ne se recalcule pas.';
              throw eRefus;
            }
            if (!touchRemuneration) return null;
            /* A4 — une ligne salaire_contrat DATÉE, jamais une écriture
               directe sur le contrat : sinon les mois passés changeraient. */
            return global.DB.ajouterSalaire(contrat.id, {
              date_effet: effet.valeur(),
              brut_mensuel_centimes: modele.brut_mensuel_centimes,
              net_mensuel_centimes: modele.net_mensuel_centimes
            });
          }).then(function () {
            return Object.keys(reglages).length
              ? global.DB.majContrat(contrat.id, reglages)
              : null;
          }).then(function () {
            return global.App.rechargerContrats();
          }).then(function () {
            Kit.fermerFeuille();
            Kit.toast(contrat.prenom_enfant + ' est aligné' +
              (contrat.genre === 'f' ? 'e' : (contrat.genre === 'g' ? '' : '·e')) +
              ' sur ' + modele.nom + '.');
            global.App.rafraichir();
          }).catch(function (e2) {
            b.disabled = false;
            msg.className = 'msg ko';
            msg.textContent = 'L’alignement n’a pas abouti : ' + Kit.messageErreur(e2);
          });
        });
        b.textContent = 'Aligner';
        corps.appendChild(b);

        corps.appendChild(Kit.ce('p', 'sb q',
          'Les mois déjà clôturés ne changeront pas.'));
      });
  }

  /* ------------------------------------------------------------------ */
  /* LOT 8 — Identité : genre, couleur, photo, famille                   */
  /* ------------------------------------------------------------------ */

  function libelleGenre(g) {
    if (g === 'f') return 'une fille';
    if (g === 'g') return 'un garçon';
    return 'non précisé';
  }

  /* Six pastilles, jamais un sélecteur de couleur libre. Une couleur choisie
     au hasard finirait par ressembler à celle d'un ÉTAT du calendrier — et
     deux systèmes de sens sur le même pixel, aucun des deux ne survit. */
  function nuancier(choisie) {
    var f = Kit.ce('div', 'fld nuancier');
    f.appendChild(Kit.ce('span', 'lb', 'Couleur'));
    var rangee = Kit.ce('div', 'teintes');

    function poser(jeton) {
      choisie.jeton = jeton;
      Array.prototype.forEach.call(rangee.querySelectorAll('button'), function (b) {
        var on = b.getAttribute('data-jeton') === (jeton || '');
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    }

    Kit.COULEURS_IDENTITE.forEach(function (c) {
      var b = Kit.bouton('teinte id-' + c.jeton, function () { poser(c.jeton); });
      b.setAttribute('data-jeton', c.jeton);
      /* Le nom de la teinte est lu par les lecteurs d'écran ET par qui ne
         distingue pas les couleurs : la pastille seule ne dit rien. */
      b.setAttribute('aria-label', c.libelle);
      b.setAttribute('title', c.libelle);
      rangee.appendChild(b);
    });
    f.appendChild(rangee);
    poser(choisie.jeton);
    return f;
  }

  /* La photo, redimensionnée CÔTÉ CLIENT avant d'être envoyée.

     Sans ce redimensionnement, une photo prise au téléphone fait 4 Mo, part
     telle quelle en base, et se recharge à CHAQUE lecture de contrat —
     c'est-à-dire à chaque ouverture de l'accueil, en 4G. La base refuse
     désormais au-delà de 50 Ko (migration 007), mais compter sur ce refus
     serait laisser Maria face à une erreur technique : on redimensionne
     d'abord, on ne se sert du garde qu'en dernier recours. */
  var COTE_PHOTO = 200;
  var POIDS_MAX_OCTETS = 50 * 1024;

  /* LOT 22 §22.2 — LE MÊME BLOC, DEUX USAGES.

     `blocPhoto` servait au formulaire d'identité : on y choisit une photo, et
     elle part avec le reste à l'enregistrement du formulaire. Le §22.2 la veut
     aussi EN TÊTE DE LA FICHE, où il n'y a pas de formulaire à valider : le
     geste doit s'enregistrer tout seul.

     `opts.enregistrer` porte cette différence, et elle seule. Sans lui, le
     bloc se comporte comme avant, au caractère près — c'est ce qui permet aux
     deux usages de partager le même code plutôt que d'en avoir deux qui
     divergeront à la première correction. */
  function blocPhoto(courante, opts) {
    opts = opts || {};
    var f = Kit.ce('div', 'fld photo-fld' + (opts.grand ? ' grand' : ''));
    f.appendChild(Kit.ce('span', 'lb', 'Photo'));

    var apercu = Kit.ce('div', 'apercu-photo');
    var msg = Kit.ce('div', 'msg');

    function redessiner() {
      Kit.vider(apercu);
      if (courante.valeur) {
        var img = Kit.ce('img');
        img.src = courante.valeur;
        img.alt = '';
        apercu.appendChild(img);
      } else {
        apercu.appendChild(Kit.ce('span', 'q', 'Aucune photo'));
      }
    }
    redessiner();
    f.appendChild(apercu);

    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    input.addEventListener('change', function () {
      var fichier = input.files && input.files[0];
      input.value = '';                       // pour pouvoir reprendre le même fichier
      if (!fichier) return;
      msg.className = 'msg';
      msg.textContent = 'Préparation de la photo…';
      reduirePhoto(fichier).then(function (dataUrl) {
        /* CORRECTION C4 — LA VALEUR PRÉCÉDENTE EST CAPTURÉE AVANT D'ÊTRE
           ÉCRASÉE. `appliquer` la lisait sur `courante.valeur`, qui portait
           déjà la nouvelle : le retour arrière retombait systématiquement sur
           `null`, et un échec d'écriture affichait l'initiale sur un enfant
           qui a une photo en base. Le message disait « rien n'a été
           enregistré » pendant que l'écran montrait le contraire. */
        var precedente = courante.valeur;
        courante.valeur = dataUrl;
        redessiner();
        majRetirer();
        if (opts.enregistrer) return appliquer(dataUrl, 'Photo enregistrée', precedente);
        msg.className = 'msg ok';
        msg.textContent = 'Photo prête. Elle sera enregistrée avec le contrat.';
      }).catch(function (e) {
        msg.className = 'msg ko';
        msg.textContent = e && e.message === 'PHOTO_TROP_LOURDE'
          ? 'Cette photo reste trop lourde même après réduction. ' +
            'Choisissez-en une autre, ou recadrez-la avant.'
          : 'Cette image n’a pas pu être lue. Choisissez-en une autre.';
      });
    });
    f.appendChild(input);

    var bChoisir = Kit.bouton('btn nt', function () { input.click(); });
    bChoisir.textContent = 'Choisir une photo';
    f.appendChild(bChoisir);

    /* §22.2 — « Retirer la photo » n'apparaît QUE s'il y en a une. Un bouton
       qui ne peut rien faire n'apprend rien et fait douter. */
    var bRetirer = Kit.bouton('btn nt', function () {
      var precedente = courante.valeur;
      courante.valeur = null;
      redessiner();
      majRetirer();
      if (opts.enregistrer) return appliquer(null, 'Photo retirée', precedente);
      msg.className = 'msg';
      msg.textContent = 'La photo sera retirée à l’enregistrement.';
    });
    bRetirer.textContent = 'Retirer la photo';
    f.appendChild(bRetirer);
    function majRetirer() { bRetirer.hidden = !courante.valeur; }
    majRetirer();

    /* L'écriture immédiate, quand le bloc vit sur la fiche. Un échec se VOIT
       et la photo affichée revient à ce que la base porte réellement : laisser
       à l'écran une photo qui n'a pas été enregistrée est exactement le genre
       de mensonge silencieux qu'on refuse (B.0-9). */
    function appliquer(valeur, succes, precedente) {
      msg.className = 'msg';
      msg.textContent = 'Enregistrement…';
      bChoisir.disabled = true;
      bRetirer.disabled = true;
      return opts.enregistrer(valeur).then(function () {
        msg.className = 'msg ok';
        msg.textContent = succes;
      }).catch(function (e) {
        /* On revient à ce que la base porte encore : laisser à l'écran une
           photo qui n'a pas été enregistrée — ou une initiale sur un enfant
           qui en a une — est le mensonge silencieux que cette fonction existe
           pour éviter (B.0-9). */
        courante.valeur = precedente === undefined ? null : precedente;
        redessiner();
        majRetirer();
        msg.className = 'msg ko';
        msg.textContent = 'Rien n’a été enregistré — ' + Kit.messageErreur(e);
      }).then(function () {
        bChoisir.disabled = false;
        bRetirer.disabled = false;
      });
    }

    f.appendChild(msg);
    f.appendChild(Kit.ce('p', 'sb q',
      'Réduite et rangée avec le contrat. Jamais sur le récapitulatif ni dans ' +
      'l’export. Elle sert à reconnaître l’enfant d’un coup d’œil dans ' +
      'l’application.'));
    return f;
  }

  /* Réduit à 200 px de côté, recadré au centre, en JPEG. La qualité baisse par
     paliers jusqu'à tenir sous 50 Ko — mieux vaut une photo un peu moins nette
     qu'un refus que Maria ne saurait pas contourner. */
  function reduirePhoto(fichier) {
    return new Promise(function (resoudre, rejeter) {
      var lecteur = new FileReader();
      lecteur.onerror = function () { rejeter(new Error('LECTURE_IMPOSSIBLE')); };
      lecteur.onload = function () {
        var img = new Image();
        img.onerror = function () { rejeter(new Error('LECTURE_IMPOSSIBLE')); };
        img.onload = function () {
          try {
            var cote = Math.min(img.width, img.height);
            var canvas = document.createElement('canvas');
            canvas.width = COTE_PHOTO;
            canvas.height = COTE_PHOTO;
            var g = canvas.getContext('2d');
            g.drawImage(img,
              (img.width - cote) / 2, (img.height - cote) / 2, cote, cote,
              0, 0, COTE_PHOTO, COTE_PHOTO);

            var qualites = [0.82, 0.7, 0.6, 0.5, 0.4];
            for (var i = 0; i < qualites.length; i++) {
              var url = canvas.toDataURL('image/jpeg', qualites[i]);
              if (poidsApproximatif(url) <= POIDS_MAX_OCTETS) return resoudre(url);
            }
            rejeter(new Error('PHOTO_TROP_LOURDE'));
          } catch (e) { rejeter(e); }
        };
        img.src = lecteur.result;
      };
      lecteur.readAsDataURL(fichier);
    });
  }

  /* Poids réel des octets derrière une chaîne base64 : 3 octets pour 4
     caractères, moins le remplissage. On mesure ce qu'on envoie, pas la
     longueur du texte. */
  function poidsApproximatif(dataUrl) {
    var i = String(dataUrl).indexOf(',');
    var b64 = i === -1 ? dataUrl : dataUrl.slice(i + 1);
    var remplissage = b64.slice(-2) === '==' ? 2 : (b64.slice(-1) === '=' ? 1 : 0);
    return Math.floor(b64.length * 3 / 4) - remplissage;
  }

  /* Changer un contrat de famille. Écrit `famille_id`, RIEN d'autre : aucun
     nom n'est touché, ni celui de l'enfant, ni celui d'aucun foyer. */
  function feuilleChangerFamille(contrat) {
    Kit.ouvrirFeuille('Changer ' + contrat.prenom_enfant + ' de famille',
      'Ce geste ne renomme aucune famille.',
      function (corps) {
        var attente = Kit.ce('div', 'attente', 'Lecture de vos familles…');
        corps.appendChild(attente);

        global.DB.listFamillesAvecContrats().then(function (familles) {
          corps.removeChild(attente);
          (familles || []).filter(function (f) { return !f.archive; }).forEach(function (f) {
            var enfants = (f.contrats || []).map(function (c) { return c.prenom_enfant; });
            var actuelle = f.id === contrat.famille_id;
            Kit.choix(corps, 'c1', f.nom.charAt(0).toUpperCase(), f.nom,
              (actuelle ? 'famille actuelle' : (enfants.length ? enfants.join(', ') : 'aucun enfant')),
              actuelle ? null : function () { rattacher(contrat, f); });
          });

          var bNouvelle = Kit.bouton('btn nt', function () {
            Kit.fermerFeuille();
            feuilleNouvelleFamille(contrat);
          });
          bNouvelle.textContent = 'Créer une nouvelle famille';
          corps.appendChild(bNouvelle);
        }).catch(function (e) {
          corps.removeChild(attente);
          corps.appendChild(Kit.warnbox('Familles indisponibles',
            ' ' + Kit.messageErreur(e) + ' Rien n’a été modifié.'));
        });
      });
  }

  function feuilleNouvelleFamille(contrat) {
    Kit.ouvrirFeuille('Nouvelle famille pour ' + contrat.prenom_enfant, null, function (corps) {
      var champ = Kit.champ('Nom de la famille', '');
      corps.appendChild(champ.bloc);
      var msg = Kit.ce('div', 'msg');
      corps.appendChild(msg);
      var b = Kit.bouton('btn', function () {
        var nom = String(champ.input.value || '').trim();
        if (!nom) {
          msg.className = 'msg ko';
          msg.textContent = 'Donnez un nom à cette famille.';
          return;
        }
        b.disabled = true;
        global.DB.creerFamille({ nom: nom })
          .then(function (f) { return rattacher(contrat, f); })
          .catch(function (e) {
            b.disabled = false;
            msg.className = 'msg ko';
            msg.textContent = 'La famille n’a pas été créée : ' + Kit.messageErreur(e);
          });
      });
      b.textContent = 'Créer et rattacher';
      corps.appendChild(b);
    });
  }

  function rattacher(contrat, famille) {
    return global.DB.rattacherContratAFamille(contrat.id, famille.id)
      .then(function () { return global.App.rechargerContrats(); })
      .then(function () {
        Kit.fermerFeuille();
        Kit.toast(contrat.prenom_enfant + ' est rattaché' +
          (contrat.genre === 'f' ? 'e' : (contrat.genre === 'g' ? '' : '·e')) +
          ' à la famille ' + famille.nom + '.');
        return global.App.rafraichir();
      })
      .catch(function (e) {
        Kit.toast('Le rattachement n’a pas abouti : ' + Kit.messageErreur(e) +
          ' Rien n’a changé.', true);
      });
  }

  /* ------------------------------------------------------------------ */
  /* Les deux règles paramétrables (RG-07, RG-09)                        */
  /* ------------------------------------------------------------------ */

  /* CODE MORT DEPUIS LE LOT 17 — RETRAIT AU §19.2. Voir la bannière plus bas. */
  function feuilleRegles(contrat) {
    Kit.ouvrirFeuille('Règles de ' + contrat.prenom_enfant,
      'Elles décident comment vos congés et vos heures sont comptés.',
      function (corps) {
        var ordre = Kit.champSelect('Congés déduits d’abord', [
          ['cp_puis_sup', 'congés payés'],
          ['sup_puis_cp', 'récupération']
        ], contrat.ordre_imputation || 'cp_puis_sup');
        corps.appendChild(ordre.bloc);

        /* LOT 12 (V8-19) — RG-09 EN CLAIR. Le libellé technique « heures sup si
           l'enfant est absent : dues / non dues » demandait à Maria de traduire
           une règle de convention collective. La question se pose désormais
           dans ses mots. */
        corps.appendChild(Kit.section('Quand l’enfant est absent'));
        var sup = Kit.champSelect('Mes ' + Kit.duree(contrat.minutes_sup_jour) + ' ce jour-là', [
          ['true', 'restent dues'],
          ['false', 'je ne les compte pas']
        ], contrat.sup_dues_si_enfant_absent === false ? 'false' : 'true');
        corps.appendChild(sup.bloc);
        corps.appendChild(Kit.ce('p', 'sb q',
          'Vous pouvez aussi décider au cas par cas, jour par jour, depuis le calendrier.'));

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
            return global.App.rechargerContrats();
          }).then(function () {
            Kit.fermerFeuille();
            Kit.toast('Règles enregistrées');
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
  /* Barèmes (RG-15) — création, modification, suppression               */
  /* ------------------------------------------------------------------ */

  /* Premier mois RÉELLEMENT touché par une date d'effet : le test de RG-15 tel
     qu'implémenté par salaireApplicable (« date_effet <= 1er jour du mois »). */
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

  /* CORRECTIF B6 DE LA RELECTURE PR9 — LE MÊME GARDE-FOU SUR TOUS LES CHEMINS.

     `analyserDateEffet` existait, et `feuilleBareme` s'en servait pour refuser
     une date d'effet tombant sur un mois clôturé. Les TROIS chemins
     d'alignement sur un contrat type ne l'appelaient pas : aucun ne lisait les
     récapitulatifs. Maria pouvait donc poser une rémunération au 1ᵉʳ juillet
     alors que juillet était clôturé et le document parti chez les parents.

     Le mois figé ne change pas de montant — l'instantané protège — mais le
     barème que RG-15 retient POUR CE MOIS devient un barème qui n'a jamais été
     validé pour lui. Deux conséquences : ce barème devient indéboulonnable
     (un mois clôturé en dépend), et toute réouverture de juillet le
     reclôturerait sur le nouveau montant, en silence.

     Le garde-fou est donc PARTAGÉ, et il échoue FERMÉ : si les récapitulatifs
     ne peuvent pas être lus, on refuse. Une lecture ratée ne doit jamais
     ouvrir une porte que le réseau seul aurait laissée fermée — c'est la leçon
     de B7, appliquée ici aussi. */
  function verifierDateEffet(contrats, dateEffet) {
    if (!contrats || !contrats.length) return Promise.resolve(null);
    return Promise.all(contrats.map(function (c) {
      return global.DB.listRecapsContrat(c.id).then(function (recaps) {
        return { contrat: c, analyse: analyserDateEffet(dateEffet, recaps || []) };
      });
    })).then(function (res) {
      var bloquants = res.filter(function (r) { return r.analyse.clos.length; });
      if (!bloquants.length) return null;
      return bloquants.map(function (r) {
        return r.contrat.prenom_enfant + ' : ' + listeMois(r.analyse.clos);
      }).join(' · ');
    }).catch(function (e) {
      return 'impossible de vérifier les mois clôturés (' + Kit.messageErreur(e) +
        ')';
    });
  }

  /* ================================================================== */
  /* LOT 17 §17.4 — LES AVENANTS                                        */
  /*                                                                     */
  /* « Une date n'appartient ni à un contrat ni à un papier. Elle        */
  /*   appartient à la mise en vigueur de conditions avec une famille. » */
  /*                                                                     */
  /* Ce n'est pas de l'archive, c'est de la donnée de CALCUL. Un mois    */
  /* n'affiche pas les conditions de son époque : il est CALCULÉ avec    */
  /* elles. C'est pourquoi « modifier les conditions » n'existe plus :   */
  /* le seul geste est « faire un avenant », et il ne touche jamais à ce */
  /* qui précède.                                                        */
  /* ================================================================== */

  /* Les onze réglages, dans l'ordre où ils se lisent, avec de quoi les
     écrire en français. Une seule table : la frise, l'encart « ce qui
     change » et le refus de suppression s'en servent tous les trois, et
     trois listes jumelles finiraient par diverger. */
  var REGLAGES_LISIBLES = [
    ['jours_planning', 'Jours de garde', function (v) { return libellePlanning(v); }],
    ['heure_arrivee', 'Début d’accueil', function (v) { return heureCourte(v); }],
    ['heure_depart', 'Fin d’accueil', function (v) { return heureCourte(v); }],
    ['minutes_contractuelles', 'Journée d’accueil', function (v) { return Kit.duree(v); }],
    ['minutes_sup_jour', 'Minutes supplémentaires par jour', function (v) { return Kit.duree(v); }],
    ['minutes_par_jour_conge', 'Un jour de congé vaut', function (v) { return Kit.duree(v); }],
    ['entretien_centimes_jour', 'Entretien par jour de présence', function (v) { return Kit.eur(v); }],
    ['sup_dues_si_enfant_absent', 'Minutes dues si l’enfant est absent',
      function (v) { return v === false ? 'non' : 'oui'; }],
    ['ordre_imputation', 'Congés déduits d’abord',
      function (v) { return v === 'sup_puis_cp' ? 'sur la récupération' : 'sur les congés payés'; }],
    ['brut_mensuel_centimes', 'Salaire brut',
      function (v) { return v == null ? 'inconnu' : Kit.eur(v); }],
    ['net_mensuel_centimes', 'Salaire net',
      function (v) { return v == null ? 'inconnu' : Kit.eur(v); }]
  ];

  function memeValeur(a, b) {
    if (Array.isArray(a) || Array.isArray(b)) {
      return String((a || []).slice().sort()) === String((b || []).slice().sort());
    }
    if (a == null || b == null) return a == null && b == null;
    /* Les heures arrivent tantôt en '17:30', tantôt en '17:30:00'. */
    return String(a).slice(0, 5) === String(b).slice(0, 5) || String(a) === String(b);
  }

  /* Ce qui change d'un jeu de conditions à l'autre, en clair. `precedent`
     absent = premier avenant : rien à comparer, tout est nouveau. */
  function differences(precedent, courant) {
    if (!precedent) return [];
    var out = [];
    REGLAGES_LISIBLES.forEach(function (r) {
      if (memeValeur(precedent[r[0]], courant[r[0]])) return;
      out.push({ champ: r[0], libelle: r[1],
                 avant: r[2](precedent[r[0]]), apres: r[2](courant[r[0]]) });
    });
    return out;
  }

  function trierAvenants(avenants) {
    return (avenants || []).slice().sort(function (a, b) {
      return a.date_effet < b.date_effet ? -1 : 1;
    });
  }

  /* Un avenant est « utilisé par un mois clôturé » si, pour au moins un mois
     figé, c'est LUI que `conditionsApplicables` retient. On ne recalcule
     rien : on interroge le moteur, comme le faisait déjà le contrôle des
     barèmes du lot 5. */
  /* CORRECTION B2 — l'état de lecture des récapitulatifs, en un seul endroit.
     `recaps` est désormais `{ ok, liste, erreur }` ; ces deux lectures rendent
     l'écriture des appelants inchangée là où elle est légitime, et rendent
     IMPOSSIBLE de lire la liste sans avoir vu le drapeau. */
  function listeRecaps(recaps) {
    if (!recaps) return [];
    if (Array.isArray(recaps)) return recaps;      // appelants historiques
    return recaps.liste || [];
  }

  function recapsLus(recaps) {
    if (!recaps) return false;
    if (Array.isArray(recaps)) return true;
    return recaps.ok === true;
  }

  function moisClosDependantsAvenant(avenant, avenants, recaps) {
    var out = [];
    listeRecaps(recaps).forEach(function (r) {
      if (r.statut !== 'fige') return;
      var applicable = Engine.conditionsApplicables(avenants, r.annee, r.mois);
      if (applicable && applicable.id === avenant.id) out.push(r);
    });
    return out;
  }

  /* Les mois clôturés, indexés 'YYYY-MM' -> raison. Sert au sélecteur de
     date : les mois interdits sont MONTRÉS et barrés, avec ce qui les bloque. */
  function moisInterdits(recaps) {
    var out = {};
    listeRecaps(recaps).forEach(function (r) {
      if (r.statut !== 'fige') return;
      out[r.annee + '-' + String(r.mois).padStart(2, '0')] =
        r.fige_le ? 'clôturé le ' + Kit.dateLongue(r.fige_le) : 'clôturé';
    });
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Le bloc de la fiche                                                 */
  /* ------------------------------------------------------------------ */

  function blocConditions(contrat, avenants, recaps) {
    var bloc = Kit.ce('div');
    var tries = trierAvenants(avenants);
    var m = global.App.moisCourant();
    var enVigueur = Engine.conditionsApplicables(tries, m.annee, m.mois);

    bloc.appendChild(Kit.section('Conditions'));

    if (!tries.length) {
      /* Sans aucun avenant, aucun mois ne se calcule : le moteur refuse
         plutôt que de deviner. On le dit, et on propose le geste. */
      bloc.appendChild(Kit.warnbox('Aucune condition enregistrée',
        'Tant qu’aucune condition n’est posée, aucun mois de ce contrat ne peut être ' +
        'calculé ni clôturé.'));
      if (!contrat.archive) bloc.appendChild(boutonAvenant(contrat, tries, recaps));
      return bloc;
    }

    /* Un avenant À VENIR est visible sans être appliqué (§17.4). Il disparaît
       de lui-même à sa date : rien n'est à faire pour le « valider ». */
    var aVenir = tries.filter(function (a) {
      return !enVigueur || a.date_effet > enVigueur.date_effet;
    });
    if (aVenir.length) {
      var suivant = aVenir[0];
      var chgts = differences(enVigueur, suivant);
      var bandeau = Kit.note('Avenant n° ' + suivant.numero + ' à venir — au ' +
        Kit.dateLongue(suivant.date_effet),
        chgts.length
          ? 'Il changera : ' + chgts.map(function (d) {
              return d.libelle.toLowerCase() + ' (' + d.avant + ' → ' + d.apres + ')';
            }).join(', ') + '. Les mois d’avant ne bougeront pas.'
          : 'Il ne change aucun réglage. Les mois d’avant ne bougeront pas.');
      bandeau.classList.add('a-venir');
      bloc.appendChild(bandeau);
    }

    if (!enVigueur) {
      bloc.appendChild(Kit.warnbox('Aucune condition applicable aujourd’hui',
        'Le premier avenant de ce contrat prend effet le ' +
        Kit.dateLongue(tries[0].date_effet) + '. Les mois d’avant ne peuvent pas être calculés.'));
    } else {
      REGLAGES_LISIBLES.forEach(function (r) {
        bloc.appendChild(Kit.fld(r[1], r[2](enVigueur[r[0]])));
      });
      /* §16.5 — la phrase qui réconcilie la fin d'accueil et l'heure à
         laquelle l'enfant repart vraiment. Elle est produite par le MOTEUR
         depuis le lot 17 : c'est la référence d'une journée (§17.5), et elle
         décide du signe de chaque écart déclaré. */
      bloc.appendChild(Kit.ce('p', 'sb q',
        'L’enfant repart vers ' + heureDeReferenceLisible(enVigueur) + ' : les ' +
        Kit.duree(enVigueur.minutes_sup_jour) + ' s’ajoutent à l’accueil.'));
      bloc.appendChild(Kit.fld('Majoration fin de contrat', libelleMajoration()));

      var depuis = Kit.ce('p', 'sb',
        'En vigueur depuis le ' + Kit.dateLongue(enVigueur.date_effet) +
        ' · avenant n° ' + enVigueur.numero +
        (enVigueur.reconstitue ? ' (reconstitué)' : ''));
      bloc.appendChild(depuis);
      if (enVigueur.brut_mensuel_centimes == null) {
        bloc.appendChild(Kit.warnbox('Aucune rémunération connue',
          'Tant que le brut et le net ne sont pas renseignés, les montants de ce contrat ' +
          'restent à zéro et ses mois ne peuvent pas être clôturés.'));
      }
    }

    var bFrise = Kit.bouton('btn nt', function () { feuilleFrise(contrat, tries, recaps); });
    bFrise.textContent = 'Voir l’historique des conditions';
    bloc.appendChild(bFrise);

    if (!contrat.archive) bloc.appendChild(boutonAvenant(contrat, tries, recaps));

    bloc.appendChild(Kit.ce('p', 'sb q',
      'Ces conditions gouvernent vos calculs. Un avenant ne touche jamais un mois ' +
      'antérieur à sa date : c’est ce qui protège les documents déjà remis. ' +
      'La majoration de fin de contrat est une clause écrite au contrat, elle ne se règle pas ici.'));
    return bloc;
  }

  /* CORRECTION B2 — SANS LA LISTE DES MOIS CLÔTURÉS, ON NE PROPOSE RIEN.
     Un avenant posé à l'aveugle peut tomber sur un mois déjà remis à une
     famille, et un mois clôturé ne se recalcule jamais. Le refus dit ce qui
     manque et ce qu'il faut faire — il ne laisse pas croire à une
     interdiction définitive. */
  function boutonAvenant(contrat, avenants, recaps) {
    if (!recapsLus(recaps)) return refusFauteDeRecaps(recaps);
    var b = Kit.bouton('btn', function () {
      feuilleAvenant(contrat, avenants, recaps, null);
    });
    b.textContent = 'Faire un avenant';
    return b;
  }

  function refusFauteDeRecaps(recaps) {
    var e = recaps && recaps.erreur;
    return Kit.warnbox('Impossible de vérifier les mois déjà clôturés',
      ' ' + (e ? Kit.messageErreur(e) : 'La lecture n’a pas abouti.') +
      ' Tant que cette vérification échoue, aucun avenant ne peut être posé, ' +
      'corrigé ni supprimé : il pourrait tomber sur un mois déjà remis à une ' +
      'famille. Réessayez une fois le réseau revenu.');
  }

  /* La référence d'une journée, en clair. Le calcul appartient au moteur
     (§17.5) ; ici on ne fait que l'écrire. */
  function heureDeReferenceLisible(conditions) {
    var minutes;
    try {
      minutes = Engine.heureDeReference(conditions);
    } catch (e) {
      return '—';
    }
    return Math.floor(minutes / 60) + 'h' + String(minutes % 60).padStart(2, '0');
  }

  /* ------------------------------------------------------------------ */
  /* La frise                                                            */
  /* ------------------------------------------------------------------ */

  /* « La suite des périodes, du plus récent au plus ancien, chacune avec ses
     dates, son numéro, et ce qui a changé en clair. La plus ancienne porte la
     mention "reconstituées". » */
  function feuilleFrise(contrat, avenants, recaps) {
    var tries = trierAvenants(avenants);
    Kit.ouvrirFeuille('Historique des conditions', contrat.prenom_enfant,
      function (corps) {
        if (!tries.length) {
          corps.appendChild(Kit.ce('p', 'vide', 'Aucune condition enregistrée.'));
          return;
        }
        var m = global.App.moisCourant();
        var enVigueur = Engine.conditionsApplicables(tries, m.annee, m.mois);

        for (var i = tries.length - 1; i >= 0; i--) {
          (function (a, precedent) {
            var suivant = tries[i + 1] || null;
            var carte = Kit.ce('div', 'card');
            var ligne = Kit.ce('div', 'row');
            ligne.appendChild(Kit.ce('span', 'nm', 'Avenant n° ' + a.numero));
            /* Le mot est dit en toutes lettres, jamais la couleur seule
               (V8-01). La classe, elle, reste un identifiant simple : un nom
               de classe avec un espace et un accent ne s'applique pas. */
            var etat = enVigueur && a.id === enVigueur.id ? 'en vigueur'
              : (!enVigueur || a.date_effet > enVigueur.date_effet) ? 'à venir' : 'passé';
            var jeton = etat === 'en vigueur' ? 'vigueur'
              : etat === 'à venir' ? 'avenir' : 'passe';
            ligne.appendChild(Kit.ce('span', 'pastille p-' + jeton, etat));
            carte.appendChild(ligne);

            /* Les BORNES de la période, pas seulement sa date de début : « du
               1er avril au 31 octobre » se lit d'un coup d'œil, « à partir du
               1er avril » oblige à regarder la ligne suivante. */
            carte.appendChild(Kit.ce('div', 'sb',
              suivant
                ? 'Du ' + Kit.dateLongue(a.date_effet) + ' au ' +
                  Kit.dateLongue(veilleDe(suivant.date_effet))
                : 'À partir du ' + Kit.dateLongue(a.date_effet)));

            if (a.reconstitue) {
              /* « On ne fait pas passer une reconstitution pour un fait. » */
              carte.appendChild(Kit.note('Conditions reconstituées',
                'L’application n’a pas connu ces conditions au moment où elles ont pris ' +
                'effet : elle les a reconstituées à partir des valeurs courantes du contrat. ' +
                'Corrigez-les si vous avez le contrat signé.'));
            }

            var chgts = differences(precedent, a);
            if (!precedent) {
              carte.appendChild(Kit.ce('div', 'sb q', 'Conditions initiales.'));
            } else if (!chgts.length) {
              carte.appendChild(Kit.ce('div', 'sb q', 'Aucun réglage modifié.'));
            } else {
              var liste = Kit.lines(carte);
              chgts.forEach(function (d) {
                Kit.ligne(liste, d.libelle, d.avant + ' → ' + d.apres);
              });
            }

            if (!contrat.archive && !recapsLus(recaps)) {
              /* CORRECTION B2 — même garde sur la frise : ni correction ni
                 suppression tant qu'on ne sait pas quels mois sont clôturés. */
              carte.appendChild(refusFauteDeRecaps(recaps));
            } else if (!contrat.archive) {
              var bM = Kit.bouton('btn nt', function () {
                feuilleAvenant(contrat, tries, recaps, a);
              });
              bM.textContent = 'Corriger cet avenant';
              carte.appendChild(bM);
              /* Le PREMIER avenant ne se supprime pas : le contrat n'aurait
                 plus aucune condition applicable à son mois d'ouverture, et
                 tous ses mois deviendraient incalculables. On le corrige. */
              if (tries.length > 1 && a.id !== tries[0].id) {
                var bS = Kit.bouton('btn dg', function () {
                  feuilleSuppressionAvenant(contrat, a, tries, recaps);
                });
                bS.textContent = 'Supprimer cet avenant';
                carte.appendChild(bS);
              }
            }
            corps.appendChild(carte);
          })(tries[i], tries[i - 1] || null);
        }
      });
  }

  function veilleDe(dateIso) {
    return global.Feries.ajouterJours(dateIso, -1);
  }

  /* ------------------------------------------------------------------ */
  /* Faire un avenant — ou en corriger un                                */
  /* ------------------------------------------------------------------ */

  /* « La date d'abord — un sélecteur de MOIS, jamais de jours — puis les
     réglages pré-remplis, avec ce qui change mis en évidence. »

     LE GARDE-FOU : un avenant n'est JAMAIS rétroactif. Sa date ne peut pas
     tomber sur un mois clôturé, parce que ce mois-là ne sera pas recalculé
     (RG-15) : l'avenant deviendrait la condition d'un mois qu'il n'a jamais
     servi à calculer, et toute réouverture le reclôturerait en silence sur de
     nouveaux montants. Les mois clôturés sont MONTRÉS et barrés, avec leur
     raison — un mois absent de la liste n'apprend rien. */
  function feuilleAvenant(contrat, avenants, recaps, existant) {
    var tries = trierAvenants(avenants);
    var m = global.App.moisCourant();
    var prochain = Chaine.moisSuivant(m.annee, m.mois);
    var interdits = moisInterdits(recaps);

    /* En correction, le mois de l'avenant lui-même n'est pas « interdit » du
       fait de sa propre présence : c'est sa date actuelle. Mais s'il est
       utilisé par un mois clôturé, la correction entière est refusée — c'est
       le contrôle ci-dessous, pas celui du sélecteur. */
    var bloquants = existant ? moisClosDependantsAvenant(existant, tries, recaps) : [];

    /* Les conditions à pré-remplir : celles de l'avenant qu'on corrige, sinon
       celles en vigueur au mois visé — « un avenant ne change QUE ce qu'il
       change, et le reste est repris tel quel ». */
    var depart = existant
      || Engine.conditionsApplicables(tries, prochain.annee, prochain.mois)
      || tries[tries.length - 1]
      || null;

    Kit.ouvrirFeuille(existant ? 'Corriger l’avenant n° ' + existant.numero : 'Faire un avenant',
      contrat.prenom_enfant, function (corps) {

        if (bloquants.length) {
          /* « Sinon, refus qui NOMME les mois et propose de les rouvrir.
             Jamais un bouton grisé sans explication. » */
          corps.appendChild(Kit.warnbox(
            'Cet avenant ne peut pas être modifié',
            'Il sert de conditions à des mois déjà clôturés : ' +
            listeMois(bloquants) + '. Les modifier changerait des documents ' +
            'qui sont partis chez la famille. Rouvrez ces mois d’abord si vous ' +
            'devez vraiment corriger cet avenant.'));
          var bRouvrir = Kit.bouton('btn nt', function () {
            Kit.fermerFeuille();
            global.App.aller('historique', { contratId: contrat.id });
          });
          bRouvrir.textContent = 'Ouvrir l’historique pour rouvrir ces mois';
          corps.appendChild(bRouvrir);
          return;
        }

        var borneBasse = Chaine.moisDeDate(contrat.date_debut);
        var date = Kit.champMoisListe('À partir du 1er',
          existant ? existant.date_effet : Kit.iso(prochain.annee, prochain.mois, 1),
          {
            interdits: interdits,
            deMois: borneBasse,
            /* Aucune limite vers le futur, dit le §17.4 : trois ans suffisent
               à couvrir toute négociation réelle sans faire une liste illisible. */
            aMois: { annee: m.annee + 3, mois: 12 }
          });
        corps.appendChild(date.bloc);

        var phraseAvant = Kit.ce('div', 'sb q');
        corps.appendChild(phraseAvant);

        var conditions = Kit.champsConditions(depart || {}, { titre: 'Les conditions à partir de cette date' });
        corps.appendChild(conditions.bloc);

        var apercu = Kit.ce('div', 'apercu-avenant');
        corps.appendChild(apercu);

        var msg = Kit.ce('div', 'msg');
        corps.appendChild(msg);
        var b = Kit.bouton('btn', function () { enregistrer(); });
        corps.appendChild(b);

        function erreur(t) { msg.textContent = t; msg.className = 'msg ko'; }

        /* Ce qui change, et ce qui ne changera PAS. Les deux phrases comptent
           autant : « Les mois d'octobre et avant ne changeront pas » est ce
           qui autorise Maria à appuyer sans crainte. */
        function majPhrases() {
          var mm = date.mois();
          var veille = Chaine.moisSuivant(mm.annee, mm.mois);
          veille = { annee: mm.mois === 1 ? mm.annee - 1 : mm.annee,
                     mois: mm.mois === 1 ? 12 : mm.mois - 1 };
          Kit.vider(phraseAvant);
          phraseAvant.appendChild(document.createTextNode(
            'Les mois de ' + Kit.libelleMois(veille.mois) + ' ' + veille.annee +
            ' et avant ne changeront pas.'));

          b.textContent = (existant ? 'Enregistrer l’avenant au 1er ' : 'Faire l’avenant au 1er ') +
            Kit.libelleMois(mm.mois) + ' ' + mm.annee;

          Kit.vider(apercu);
          var precedent = conditionsAvant(tries, date.valeur(), existant);
          var chgts = differences(precedent, conditions.valeurs());
          if (!precedent) {
            apercu.appendChild(Kit.note('Premières conditions de ce contrat',
              'Il n’y a rien avant : ces conditions valent depuis l’ouverture du contrat.'));
            return;
          }
          if (!chgts.length) {
            apercu.appendChild(Kit.note('Rien ne change',
              'Ces conditions sont identiques aux précédentes. Un avenant qui ne change ' +
              'rien n’est pas une erreur, mais il n’aura aucun effet sur vos calculs.'));
            return;
          }
          var pane = Kit.pane('Ce que change cet avenant');
          var l = Kit.lines(pane);
          chgts.forEach(function (d) { Kit.ligne(l, d.libelle, d.avant + ' → ' + d.apres); });
          apercu.appendChild(pane);
          /* L'effet CHIFFRÉ sur le premier mois concerné, rejoué par le
             moteur (§17.4, et B.0-5 : aucun chiffre écrit en dur). */
          apercu.appendChild(Kit.ce('div', 'attente', 'Calcul de l’effet sur ' +
            Kit.libelleMois(mm.mois) + '…'));
          effetPremierMois(contrat, tries, existant, date.valeur(), conditions.valeurs())
            .then(function (texte) {
              if (!apercu.isConnected && apercu.parentNode === null) return;
              var att = apercu.querySelector('.attente');
              if (att) att.parentNode.removeChild(att);
              apercu.appendChild(Kit.note('Effet sur ' + Kit.libelleMois(mm.mois) + ' ' + mm.annee, texte));
            })
            .catch(function (e) {
              var att = apercu.querySelector('.attente');
              if (att) att.parentNode.removeChild(att);
              /* Un effet non chiffrable ne bloque pas l'avenant — mais il ne
                 se tait pas non plus : un encart absent se lirait comme
                 « aucun effet ». */
              apercu.appendChild(Kit.warnbox('Effet non calculable',
                Kit.messageErreur(e) + ' L’avenant reste enregistrable.'));
            });
        }

        date.select.addEventListener('change', majPhrases);
        conditions.bloc.addEventListener('change', majPhrases);
        majPhrases();

        function enregistrer() {
          msg.textContent = ''; msg.className = 'msg';
          var refus = conditions.erreur();
          if (refus) { erreur(refus); return; }
          var cle = date.valeur().slice(0, 7);
          if (interdits[cle]) {
            /* CORRECTION C3 — « Le mois de 2026-06 est clôturé » : un format
               machine à l'écran, alors que `Kit.libelleMoisAnnee` est utilisé
               partout ailleurs sur cet écran. */
            erreur('Le mois ' + Kit.deMoisAnnee(Number(cle.slice(0, 4)), Number(cle.slice(5, 7))) +
              ' est clôturé : un avenant n’est jamais rétroactif.');
            return;
          }
          /* Deux avenants au même mois : la base le refuse
             (`unique (contrat_id, date_effet)`), et le dire ici évite un
             message technique. */
          var collision = tries.filter(function (a) {
            return a.date_effet.slice(0, 7) === cle && (!existant || a.id !== existant.id);
          })[0];
          if (collision) {
            erreur('L’avenant n° ' + collision.numero + ' prend déjà effet ce mois-là. ' +
              'Corrigez-le plutôt que d’en poser un second.');
            return;
          }

          var champs = { date_effet: date.valeur() };
          var vals = conditions.valeurs();
          Object.keys(vals).forEach(function (k) { champs[k] = vals[k]; });

          b.disabled = true;
          msg.className = 'msg';
          msg.textContent = 'Enregistrement…';
          var p = existant
            ? global.DB.majAvenant(existant.id, champs)
            : global.DB.ajouterAvenant(contrat.id, champs);
          p.then(function () {
            global.App.invalider();
            Kit.fermerFeuille();
            Kit.toast(existant ? 'Avenant enregistré' : 'Avenant créé');
            return global.App.rafraichir();
          }).catch(function (e) {
            b.disabled = false;
            erreur('Enregistrement impossible : ' + Kit.messageErreur(e) +
              ' Votre saisie est conservée.');
          });
        }
      });
  }

  /* Les conditions qui précèdent immédiatement une date d'effet, en ignorant
     l'avenant qu'on est en train de corriger — sinon il se comparerait à
     lui-même et « rien ne change » serait toujours vrai. */
  function conditionsAvant(avenants, dateEffet, existant) {
    var candidats = avenants.filter(function (a) {
      if (existant && a.id === existant.id) return false;
      return a.date_effet < dateEffet;
    });
    return candidats.length ? candidats[candidats.length - 1] : null;
  }

  /* L'effet chiffré du premier mois concerné, REJOUÉ PAR LE MOTEUR.

     On rejoue le mois deux fois — une fois avec les conditions actuelles, une
     fois avec les nouvelles — et on annonce l'écart. Aucun montant n'est
     recomposé à la main : c'est la sixième des qualités à ne pas casser. */
  function effetPremierMois(contrat, avenants, existant, dateEffet, valeurs) {
    var mm = Chaine.moisDeDate(dateEffet);
    var futurs = avenants.filter(function (a) {
      return !existant || a.id !== existant.id;
    }).concat([mêmeAvenant(valeurs, dateEffet)]);

    return Promise.all([
      Chaine.mois1(contrat, mm.annee, mm.mois),
      Chaine.mois1(contrat, mm.annee, mm.mois, { avenants: futurs })
    ]).then(function (r) {
      var avant = r[0] && r[0].resultat;
      var apres = r[1] && r[1].resultat;
      if (!avant || !apres) throw new Error('mois non calculable');
      var dTotal = (apres.totalAVerserCentimes || 0) - (avant.totalAVerserCentimes || 0);
      var dSup = (apres.minutesSupAcquises || 0) - (avant.minutesSupAcquises || 0);
      var morceaux = [];
      morceaux.push('Total à verser : ' + Kit.eur(avant.totalAVerserCentimes) +
        ' → ' + Kit.eur(apres.totalAVerserCentimes) +
        (dTotal === 0 ? ' (inchangé)' : ' (' + (dTotal > 0 ? '+ ' : '− ') +
          Kit.eur(Math.abs(dTotal)) + ')'));
      if (dSup !== 0) {
        morceaux.push('Heures supplémentaires : ' + Kit.heures(avant.minutesSupAcquises) +
          ' → ' + Kit.heures(apres.minutesSupAcquises));
      }
      if ((apres.joursPresence || 0) !== (avant.joursPresence || 0)) {
        morceaux.push('Jours de présence : ' + avant.joursPresence + ' → ' + apres.joursPresence);
      }
      return morceaux.join('. ') + '.';
    });
  }

  /* La forme d'avenant que le moteur attend, à partir d'une saisie. Elle n'est
     jamais écrite en base : elle sert au rejeu de l'aperçu. */
  function mêmeAvenant(valeurs, dateEffet) {
    var a = { id: '__apercu__', date_effet: dateEffet, numero: 0, reconstitue: false };
    Object.keys(valeurs).forEach(function (k) { a[k] = valeurs[k]; });
    /* Le brut et le net à zéro plutôt qu'à `null` : c'est ce que fait la
       chaîne quand la rémunération est inconnue, et l'aperçu doit montrer le
       même chiffre que le mois réel. */
    if (a.brut_mensuel_centimes == null) a.brut_mensuel_centimes = 0;
    if (a.net_mensuel_centimes == null) a.net_mensuel_centimes = 0;
    return a;
  }

  /* ------------------------------------------------------------------ */
  /* Supprimer un avenant                                                */
  /* ------------------------------------------------------------------ */

  function feuilleSuppressionAvenant(contrat, avenant, avenants, recaps) {
    var bloquants = moisClosDependantsAvenant(avenant, avenants, recaps);
    var precedent = conditionsAvant(avenants, avenant.date_effet, avenant);

    Kit.ouvrirFeuille('Supprimer l’avenant n° ' + avenant.numero + ' ?',
      contrat.prenom_enfant + ' — à partir du ' + Kit.dateLongue(avenant.date_effet),
      function (corps) {
        if (bloquants.length) {
          corps.appendChild(Kit.warnbox('Suppression impossible',
            'Cet avenant sert de conditions à des mois déjà clôturés : ' +
            listeMois(bloquants) + '. Rouvrez ces mois d’abord si vous devez ' +
            'vraiment le supprimer.'));
          return;
        }
        corps.appendChild(Kit.ce('p', 'sb q',
          precedent
            ? 'Le contrat reviendra aux conditions de l’avenant n° ' + precedent.numero +
              ', en vigueur depuis le ' + Kit.dateLongue(precedent.date_effet) + '.'
            : 'Ce contrat n’aurait plus aucune condition applicable : ses mois deviendraient ' +
              'incalculables.'));
        var chgts = differences(precedent, avenant);
        if (chgts.length) {
          var pane = Kit.pane('Ce qui revient en arrière');
          var l = Kit.lines(pane);
          chgts.forEach(function (d) { Kit.ligne(l, d.libelle, d.apres + ' → ' + d.avant); });
          corps.appendChild(pane);
        }
        corps.appendChild(Kit.ce('p', 'sb q',
          'Tous les mois non clôturés à partir du ' + Kit.dateLongue(avenant.date_effet) +
          ' seront recalculés.'));
        var msg = Kit.ce('div', 'msg');
        corps.appendChild(msg);
        var b = Kit.bouton('btn dg', function () {
          b.disabled = true;
          msg.className = 'msg';
          msg.textContent = 'Suppression…';
          global.DB.supprimerAvenant(avenant.id).then(function () {
            global.App.invalider();
            Kit.fermerFeuille();
            Kit.toast('Avenant supprimé');
            return global.App.rafraichir();
          }).catch(function (e) {
            b.disabled = false;
            msg.className = 'msg ko';
            msg.textContent = 'Suppression impossible : ' + Kit.messageErreur(e);
          });
        });
        b.textContent = 'Supprimer cet avenant';
        corps.appendChild(b);
      });
  }

  /* Un barème est « utilisé par un mois clôturé » si, pour au moins un mois
     figé, c'est lui que RG-15 retient. On ne recalcule rien : on interroge le
     moteur. */
  /* CODE MORT DEPUIS LE LOT 17 — RETRAIT AU §19.2. Voir la bannière plus bas. */
  function moisClosDependants(bareme, salaires, recaps) {
    var out = [];
    (recaps || []).forEach(function (r) {
      if (r.statut !== 'fige') return;
      var applicable = Engine.salaireApplicable(salaires, r.annee, r.mois);
      if (applicable && applicable.id === bareme.id) out.push(r);
    });
    return out;
  }

  /* La ligne « Familiarisation » de la fiche. Elle se remplit après coup : la
     fiche ne doit pas attendre une lecture de plus pour s'afficher. Le
     sous-titre part sur « Chargement… » et est levé par CELUI QUI SAIT le
     lever — jamais repéré par sa position dans la liste (correction §16.4). */
  function ligneFamiliarisation(contrat) {
    var ligne = Kit.ce('div', 'menu');
    var tx = Kit.ce('div');
    tx.appendChild(Kit.ce('div', null, 'Familiarisation'));
    var sous = Kit.ce('div', 'd', 'Chargement…');
    tx.appendChild(sous);
    ligne.appendChild(tx);
    ligne.appendChild(Kit.ce('span', 'ar', '›'));
    ligne.setAttribute('role', 'button');
    ligne.setAttribute('tabindex', '0');
    function ouvrir() {
      global.App.aller('familiarisation', { contratId: contrat.id });
    }
    ligne.addEventListener('click', ouvrir);
    ligne.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ouvrir(); }
    });

    global.DB.listPeriodesFamiliarisationContrat(contrat.id).then(function (l) {
      var p = (l || [])[0];
      sous.textContent = p
        ? 'Du ' + Kit.dateLongue(p.date_debut) + ' au ' + Kit.dateLongue(p.date_fin) +
          ' — seules les heures déclarées sont payées'
        : 'Aucune période — les heures déclarées y sont payées à l’heure';
    }).catch(function (e) {
      sous.textContent = 'Périodes illisibles pour l’instant (' +
        Kit.messageErreur(e) + ')';
    });
    return ligne;
  }

  function listeMois(rs) {
    return rs.map(function (r) { return Kit.libelleMoisAnnee(r.annee, r.mois); }).join(', ');
  }

  /* CODE MORT DEPUIS LE LOT 17 — RETRAIT AU §19.2. Voir la bannière plus bas. */
  function feuilleBareme(contrat, bareme, salaires, recaps) {
    var creation = !bareme;
    var m = global.App.moisCourant();
    var prochain = Chaine.moisSuivant(m.annee, m.mois);
    var autres = creation
      ? global.App.contrats().filter(function (c) { return c.id !== contrat.id; })
      : [];

    Kit.ouvrirFeuille(creation ? 'Nouveau barème' : 'Modifier le barème',
      contrat.prenom_enfant + ' — le net se lit sur la fiche de paie, il ne se calcule pas.',
      function (corps) {
        var date = Kit.champMois('À partir du',
          bareme ? bareme.date_effet : Kit.iso(prochain.annee, prochain.mois, 1),
          { anneeMin: m.annee - 3, anneeMax: m.annee + 2 });
        corps.appendChild(date.bloc);

        var brut = Kit.champ('Salaire brut',
          bareme ? (bareme.brut_mensuel_centimes / 100).toFixed(2).replace('.', ',') : '',
          { placeholder: '1 401,20', inputmode: 'decimal' });
        corps.appendChild(brut.bloc);
        var net = Kit.champ('Salaire net',
          (bareme && bareme.net_mensuel_centimes)
            ? (bareme.net_mensuel_centimes / 100).toFixed(2).replace('.', ',') : '',
          { placeholder: '1 094,60', inputmode: 'decimal' });
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
          'Un barème ne peut pas réécrire un document déjà remis aux parents.'));

        var msg = Kit.ce('div', 'msg');
        corps.appendChild(msg);
        var etape = 0;          // 0 = saisie, 1 = confirmation demandée
        var b = Kit.bouton('btn', function () { enregistrer(); });
        b.textContent = 'Enregistrer';
        corps.appendChild(b);

        function erreur(t) { msg.textContent = t; msg.className = 'msg ko'; }

        function enregistrer() {
          if (etape === 0) { msg.textContent = ''; msg.className = 'msg'; }
          var dateEffet = date.valeur();
          var brutC = Kit.parseEuros(brut.input.value);
          var netC = Kit.parseEuros(net.input.value);
          if (brutC == null) { erreur('Le salaire brut est illisible (exemple : 1 401,20).'); return; }

          /* Modifier un barème dont dépend un mois clôturé reviendrait à
             réécrire ce document : même interdit que la suppression. */
          if (!creation) {
            var dep = moisClosDependants(bareme, salaires, recaps);
            if (dep.length) {
              erreur('Ce barème sert au(x) récapitulatif(s) clôturé(s) de ' + listeMois(dep) +
                '. Ces documents sont partis chez les parents : créez plutôt un nouveau barème ' +
                'à une date postérieure.');
              return;
            }
          }

          var choisis = [contrat].concat(cases.filter(function (x) { return x.cb.checked; })
            .map(function (x) { return x.contrat; }));

          b.disabled = true;
          msg.className = 'msg';
          msg.textContent = 'Vérification des mois clôturés…';

          Promise.all(choisis.map(function (c) {
            var pRecaps = (c.id === contrat.id)
              ? Promise.resolve(recaps)
              : global.DB.listRecapsContrat(c.id);
            return Promise.all([global.DB.getSalaires(c.id), pRecaps]).then(function (r) {
              var analyse = analyserDateEffet(dateEffet, r[1]);
              var doublon = (r[0] || []).some(function (s) {
                return s.date_effet === dateEffet && (!bareme || s.id !== bareme.id);
              });
              var refus = null;
              if (doublon) refus = 'un barème existe déjà à cette date';
              else if (analyse.clos.length) refus = 'mois déjà clôturé(s) : ' + listeMois(analyse.clos);
              return { contrat: c, refus: refus, brouillons: analyse.brouillons };
            });
          })).then(function (verifs) {
            b.disabled = false;
            var refuses = verifs.filter(function (v) { return v.refus; });
            var acceptes = verifs.filter(function (v) { return !v.refus; });
            if (!acceptes.length) {
              erreur('Enregistrement refusé — ' + refuses.map(function (v) {
                return v.contrat.prenom_enfant + ' : ' + v.refus;
              }).join(' · ') + '. Choisissez un mois postérieur au dernier mois clôturé.');
              return null;
            }

            /* Restauration R3 : une date d'effet rétroactive recalcule TOUS les
               mois non clôturés, dont des montants déjà annoncés aux parents.
               Le lot 5 le disait ; la refonte jetait la liste en silence. */
            var brouillons = [];
            acceptes.forEach(function (v) { brouillons = brouillons.concat(v.brouillons); });
            if (etape === 0 && (brouillons.length || netC == null)) {
              etape = 1;
              b.textContent = 'Enregistrer quand même';
              var phrases = [];
              if (brouillons.length) {
                phrases.push('Le(s) récapitulatif(s) non clôturé(s) de ' + listeMois(brouillons) +
                  ' seront recalculés avec ce barème.');
              }
              if (netC == null) {
                phrases.push('Sans le net, les récapitulatifs des mois concernés resteront ' +
                  'incomplets et ne pourront pas être clôturés.');
              }
              erreur(phrases.join(' ') + ' Touchez de nouveau pour enregistrer.');
              return null;
            }

            b.disabled = true;
            msg.className = 'msg';
            msg.textContent = 'Enregistrement…';
            var champs = {
              date_effet: dateEffet,
              brut_mensuel_centimes: brutC,
              net_mensuel_centimes: netC == null ? 0 : netC
            };
            var travaux = creation
              ? acceptes.map(function (v) { return global.DB.ajouterSalaire(v.contrat.id, champs); })
              : [global.DB.majSalaire(bareme.id, champs)];

            return Promise.all(travaux).then(function () {
              global.App.invalider();
              Kit.fermerFeuille();
              Kit.toast(creation
                ? acceptes.length + ' barème(s) enregistré(s)' +
                  (refuses.length ? ' · ' + refuses.length + ' refusé(s), mois déjà clôturés' : '')
                : 'Barème modifié');
              return global.App.rafraichir();
            });
          }).catch(function (e) {
            b.disabled = false;
            erreur('Enregistrement impossible : ' + Kit.messageErreur(e) + ' Rien n’a été enregistré.');
          });
        }
      });
  }

  /* CODE MORT DEPUIS LE LOT 17 — RETRAIT AU §19.2. Voir la bannière plus bas. */
  function feuilleSuppressionBareme(contrat, bareme, salaires, recaps) {
    var dep = moisClosDependants(bareme, salaires, recaps);
    Kit.ouvrirFeuille('Supprimer ce barème ?',
      'Depuis le ' + Kit.dateLongue(bareme.date_effet) + ' — ' +
      Kit.eur(bareme.brut_mensuel_centimes) + ' brut',
      function (corps) {
        if (dep.length) {
          corps.appendChild(Kit.warnbox('Suppression impossible',
            'Ce barème est celui appliqué au(x) récapitulatif(s) clôturé(s) de ' + listeMois(dep) +
            '. Le supprimer effacerait la justification de documents déjà remis aux parents.'));
          return;
        }
        corps.appendChild(Kit.warnbox('Les mois concernés repasseront au barème précédent',
          'Les récapitulatifs non clôturés qui s’appuyaient sur ce barème seront recalculés.'));
        var b = Kit.bouton('btn dg', function () {
          b.disabled = true;
          global.DB.supprimerSalaire(bareme.id)
            .then(function () {
              global.App.invalider();
              Kit.fermerFeuille();
              Kit.toast('Barème supprimé');
              return global.App.rafraichir();
            })
            .catch(function (e) {
              b.disabled = false;
              Kit.toast('Suppression impossible : ' + Kit.messageErreur(e) + ' Rien n’a changé.', true);
            });
        });
        b.textContent = 'Oui, supprimer ce barème';
        corps.appendChild(b);
      });
  }

  /* ------------------------------------------------------------------ */
  /* Fin de contrat (RG-13)                                              */
  /* ------------------------------------------------------------------ */

  /* ------------------------------------------------------------------ */
  /* LOT 17 §17.8 — LA FIN DE CONTRAT ET L'INDEMNITÉ DE RUPTURE          */
  /*                                                                     */
  /* Trois défauts corrigés d'un coup, tous constatés :                   */
  /*                                                                     */
  /*  1. LE RÉSULTAT S'AFFICHAIT AU-DESSUS DU BOUTON qui le calcule. Sur  */
  /*     un téléphone, Maria appuyait et ne voyait rien changer : le      */
  /*     chiffre apparaissait hors de l'écran, au-dessus de son doigt.    */
  /*     La zone est désormais SOUS le bouton.                            */
  /*                                                                     */
  /*  2. LES CONGÉS PAYÉS PASSENT AVANT LA RÉCUPÉRATION. C'est l'ordre    */
  /*     du contrat (RG-07) et celui de tous les autres écrans depuis le  */
  /*     lot 18 ; un ordre différent ici faisait chercher deux fois.      */
  /*                                                                     */
  /*  3. IL MANQUAIT LA LIGNE DE TOTAL. « À régler en plus du dernier     */
  /*     mois » est LE chiffre que Maria annonce aux parents ; l'écran    */
  /*     donnait ses composantes et la laissait faire l'addition.          */
  /*                                                                     */
  /* Et l'indemnité de rupture est calculée, avec son détail par période. */
  /* ------------------------------------------------------------------ */

  function ecranFinContrat(ctx, contrat) {
    global.App.barreRetour(ctx.barre, 'Fin du contrat — ' + contrat.prenom_enfant, { fermer: true });
    var corps = ctx.corps;

    corps.appendChild(Kit.note('Rien n’est supprimé',
      'Le contrat sort de l’Accueil et de la saisie, mais tout son historique reste consultable ' +
      'depuis « Anciens contrats ». C’est réversible.'));

    var date = Kit.champDate('Dernier jour de garde', global.App.aujourdhui(), {
      anneeMin: Number(String(contrat.date_debut).slice(0, 4)),
      anneeMax: global.App.moisCourant().annee + 1,
      onchange: function () { avertirMoisOuvert(); }
    });
    corps.appendChild(date.bloc);

    /* LOT 18 §18.6 — L'AVERTISSEMENT VIENT AVANT LE CALCUL, PAS APRÈS.

       « Le mois de décembre n'est pas encore clôturé » ne s'affichait qu'une
       fois les soldes calculés — c'est-à-dire seulement si Maria appuyait sur
       un bouton facultatif. Celle qui range directement le contrat ne le
       voyait jamais, et le dernier mois restait ouvert indéfiniment : un mois
       jamais clôturé n'a pas de document, et il n'y a plus d'écran pour aller
       le chercher une fois le contrat rangé.

       La phrase suit la date choisie : changer de mois change l'avertissement. */
    var alerteMois = Kit.ce('div');
    corps.appendChild(alerteMois);

    function avertirMoisOuvert() {
      var m = Chaine.moisDeDate(date.valeur());
      Kit.vider(alerteMois);
      global.App.recapsDuMois(m.annee, m.mois).then(function (parId) {
        Kit.vider(alerteMois);
        if (global.App.estClos(parId, contrat.id)) return;
        alerteMois.appendChild(Kit.warnbox(
          'Le mois de ' + Kit.libelleMois(m.mois) + ' n’est pas encore clôturé',
          'Clôturez-le avant de ranger le contrat : une fois le contrat rangé, ' +
          'ce mois n’aura jamais de récapitulatif.'));
      }).catch(function (e) {
        Kit.vider(alerteMois);
        /* B.0-9 : on ne se tait pas sur ce qu'on n'a pas pu lire. */
        alerteMois.appendChild(Kit.warnbox(
          'Impossible de savoir si le mois de ' + Kit.libelleMois(m.mois) + ' est clôturé',
          ' ' + Kit.messageErreur(e) + ' Vérifiez-le avant de ranger le contrat.'));
      });
    }
    avertirMoisOuvert();

    var bSoldes = Kit.bouton('btn nt', function () { afficherSoldes(zone, contrat, date.valeur()); });
    bSoldes.textContent = 'Calculer les soldes de fin de contrat';
    corps.appendChild(bSoldes);

    /* §17.8 — SOUS le bouton, pas au-dessus. */
    var zone = Kit.ce('div');
    corps.appendChild(zone);

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

    /* Le contrat AVEC sa date de fin : c'est elle qui borne les journées et,
       depuis le §17.7, qui proratise le salaire du dernier mois. */
    var simule = {};
    Object.keys(contrat).forEach(function (k) { simule[k] = contrat[k]; });
    simule.date_fin = dateFin;
    var m = Chaine.moisDeDate(dateFin);

    /* LA CHAÎNE ENTIÈRE, pas seulement le dernier mois. L'indemnité de rupture
       est le 1/80ᵉ du total des bruts DEPUIS LE DÉBUT du contrat : elle a
       besoin de tous les mois, chacun calculé avec les conditions de SON
       époque — ce que le §17.2 rend enfin possible. Les mois clôturés
       fournissent leur instantané ; les autres sont recalculés. */
    Promise.all([
      global.App.serie(simule, { annee: m.annee, mois: m.mois }),
      global.App.avenants(contrat.id)
    ]).then(function (r) {
      var chaine = r[0];
      var avenants = r[1] || [];
      var entree = global.App.moisDe(chaine, m.annee, m.mois);
      Kit.vider(zone);
      if (!entree) {
        zone.appendChild(Kit.ce('p', 'vide', 'Aucun mois calculable jusqu’à cette date.'));
        return;
      }

      var conditions = Engine.conditionsApplicables(avenants, m.annee, m.mois);
      var cs = entree.compteurSortie || {};
      /* CORRECTION B5 — LES SOLDES SIGNÉS. Ces deux lignes lisaient les
         valeurs bornées à zéro : un compteur à −9 h s'affichait « 0h00 », et
         l'avertissement « votre compteur est négatif », gardé par
         `if (minutes < 0)`, ne pouvait s'afficher JAMAIS. */
      var minutes = Kit.supSolde(cs);
      var cp = Kit.cpSolde(cs);
      var parJour = (conditions && conditions.minutes_par_jour_conge) || 0;
      var brut = conditions ? conditions.brut_mensuel_centimes : null;

      var p = Kit.pane('Soldes au ' + Kit.dateLongue(dateFin));
      var l = Kit.lines(p);
      /* §17.8 — les congés payés d'abord, comme partout ailleurs. */
      Kit.ligne(l, 'Congés payés restants',
        cp < 0 ? '− ' + Kit.joursCp(-cp, parJour) : Kit.joursCp(cp, parJour));
      Kit.ligne(l, 'Récupération restante',
        minutes < 0 ? '− ' + Kit.heures(-minutes) : Kit.heures(minutes));
      zone.appendChild(p);

      /* --- L'INDEMNITÉ DE RUPTURE (§17.8) --------------------------- */
      var moisBruts = (chaine.mois || [])
        .filter(function (e) { return e.resultat && !e.horsContrat; })
        .map(function (e) {
          return { cle: e.cle, brutDuCentimes: e.resultat.brutDuCentimes || 0 };
        });
      var ind = Engine.indemniteRupture({
        date_debut: contrat.date_debut, date_fin: dateFin, moisBruts: moisBruts
      });

      /* CORRECTION C1 DE LA RELECTURE — LE TOTAL VIENT DU MOTEUR.
         « À régler en plus du dernier mois » était additionné ici, poste par
         poste, à quatre endroits. C'est le chiffre que Maria annonce aux
         parents : c'est le dernier de l'application qui devrait être calculé
         dans un écran. */
      var solde = Engine.soldeFinContrat({
        brutMensuelCentimes: brut,
        minutesSupSolde: minutes,
        coefficient: COEFF_FIN_CONTRAT,
        indemnite: ind
      });

      if (solde.chiffrable) {
        /* RG-13, la formule validée par le cas T6 du moteur. */
        Kit.ligne(l, 'Heures supplémentaires, majorées de ' + libelleMajoration(),
          Kit.eur(solde.montantSupCentimes));
      }

      var pi = Kit.pane('Indemnité de rupture');
      var li = Kit.lines(pi);
      Kit.ligne(li, 'Ancienneté', libelleAnciennete(ind.ancienneteMois));
      if (!ind.due) {
        /* « En dessous de neuf mois, l'écran dit qu'aucune indemnité n'est due
           ET POURQUOI. » Un zéro sans motif se lit comme une panne. */
        pi.appendChild(Kit.note('Aucune indemnité n’est due',
          ind.motif === 'ANCIENNETE_INSUFFISANTE'
            ? 'L’indemnité de rupture est due à partir de neuf mois d’ancienneté. ' +
              'Ce contrat en compte ' + libelleAnciennete(ind.ancienneteMois) + '.'
            : 'Les dates du contrat sont incomplètes : l’ancienneté ne peut pas être établie.'));
      } else {
        Kit.ligne(li, 'Total des salaires bruts', Kit.eur(ind.totalBrutCentimes));
        Kit.ligne(li, 'Indemnité — 1/80ᵉ', Kit.eur(ind.indemniteCentimes), { total: true });
        pi.appendChild(Kit.ce('div', 'sb q',
          'Hors indemnités d’entretien. Calculée sur ' + libellePeriodes(avenants) +
          ', du ' + Kit.dateLongue(contrat.date_debut) + ' au ' + Kit.dateLongue(dateFin) + '.'));
        var bDetail = Kit.bouton('btn nt', function () {
          feuilleDetailIndemnite(contrat, dateFin, chaine, avenants, ind);
        });
        bDetail.textContent = 'Voir le détail par période';
        pi.appendChild(bDetail);
      }
      zone.appendChild(pi);

      /* --- LE CHIFFRE QUE MARIA ANNONCE AUX PARENTS ------------------ */
      if (solde.chiffrable) {
        var pt = Kit.pane('À régler en plus du dernier mois');
        var lt = Kit.lines(pt);
        Kit.ligne(lt, 'Total', Kit.eur(solde.totalARegler), { total: true });
        pt.appendChild(Kit.ce('div', 'sb q',
          'Le montant des congés payés restants n’y figure PAS : sa base de calcul n’est ' +
          'pas tranchée, et l’inventer donnerait un total faux et crédible. ' +
          'Ces ' + Kit.joursCp(Math.max(0, cp), parJour) + ' sont à régler en plus.'));
        zone.appendChild(pt);
      } else {
        zone.appendChild(Kit.warnbox('Montants non chiffrables',
          'Aucune rémunération n’est connue pour ' + Kit.libelleMoisAnnee(m.annee, m.mois) +
          ' : ni les heures supplémentaires ni le total ne peuvent être calculés.'));
      }

      if (solde.minutesDues > 0) {
        /* Question ouverte n° 3 pour Maria : « un solde d'heures négatif en fin
           de contrat : déduit du solde à régler, ou seulement signalé ? »
           Tant qu'elle n'a pas répondu, on SIGNALE — déduire d'office
           reviendrait à trancher à sa place, sur un chiffre qui part chez une
           famille. */
        zone.appendChild(Kit.warnbox('Votre compteur de récupération est négatif',
          'Il manque ' + Kit.heures(solde.minutesDues) + ' à ' + contrat.prenom_enfant + '. ' +
          'Ce temps n’est PAS déduit du total ci-dessus : la règle n’est pas tranchée. ' +
          'Voyez avec la famille.'));
      }

      zone.appendChild(Kit.note('À la fin du contrat',
        'Les congés payés restants sont payés sans majoration ; les heures supplémentaires ' +
        'sont payées avec une majoration de ' + libelleMajoration() + '. ' +
        'Notez ces chiffres, rien n’est enregistré.'));

      if (!entree.fige) {
        /* Le rappel, une seconde fois, au pied des soldes : ce sont EUX qui
           sont provisoires tant que le mois n'est pas clôturé. L'avertissement
           qui empêche d'oublier, lui, est en haut de l'écran (§18.6) et ne
           dépend pas de ce bouton. */
        zone.appendChild(Kit.warnbox(
          'Le mois de ' + Kit.libelleMois(m.mois) + ' n’est pas encore clôturé',
          'Clôturez-le avant de ranger le contrat : ces soldes resteront provisoires ' +
          'tant qu’il ne l’est pas.'));
      }
    }).catch(function (e) {
      Kit.vider(zone);
      zone.appendChild(Kit.warnbox('Calcul impossible', Kit.messageErreur(e)));
    });
  }

  function libelleAnciennete(mois) {
    if (mois == null) return '—';
    var ans = Math.floor(mois / 12);
    var reste = mois % 12;
    if (ans && reste) return ans + ' an' + (ans > 1 ? 's' : '') + ' ' + reste + ' mois';
    if (ans) return ans + ' an' + (ans > 1 ? 's' : '');
    return reste + ' mois';
  }

  function libellePeriodes(avenants) {
    var n = (avenants || []).length;
    if (n <= 1) return 'une seule période de conditions';
    return n + ' périodes de conditions';
  }

  /* « Voir le détail par période » — le détail qui rend le 1/80ᵉ vérifiable.

     Un total de 54 016,80 € qu'on ne peut pas décomposer est un chiffre qu'on
     ne peut pas défendre. Le détail montre chaque période de conditions, les
     mois qu'elle couvre, et ce qu'ils ont réellement pesé. */
  function feuilleDetailIndemnite(contrat, dateFin, chaine, avenants, ind) {
    var tries = trierAvenants(avenants);
    Kit.ouvrirFeuille('Détail de l’indemnité', contrat.prenom_enfant +
      ' — ' + Kit.eur(ind.indemniteCentimes), function (corps) {

        corps.appendChild(Kit.ce('p', 'sb q',
          'L’indemnité vaut le 1/80ᵉ du total des salaires bruts réellement dus depuis ' +
          'le début du contrat. Un mois sans solde ou un mois partiel y pèse moins : ' +
          'c’est le brut DÛ qui compte, pas le brut prévu au contrat.'));

        var mois = (chaine.mois || []).filter(function (e) {
          return e.resultat && !e.horsContrat;
        });

        tries.forEach(function (a, i) {
          var suivant = tries[i + 1] || null;
          var duPeriode = mois.filter(function (e) {
            var premier = Chaine.premierJour(e.annee, e.mois);
            return premier >= a.date_effet && (!suivant || premier < suivant.date_effet);
          });
          if (!duPeriode.length) return;
          /* CORRECTION C1 — l'assiette du 1/80ᵉ se lit là où elle est
             définie. `Chaine.brutDuCentimes` porte le repli des instantanés
             d'avant le lot 17 ; l'addition faite ici comptait zéro sur eux. */
          var total = duPeriode.reduce(function (n, e) {
            return n + Chaine.brutDuCentimes(e.resultat);
          }, 0);

          var carte = Kit.ce('div', 'card');
          carte.appendChild(Kit.ce('div', 'nm', 'Avenant n° ' + a.numero +
            (a.reconstitue ? ' (reconstitué)' : '')));
          carte.appendChild(Kit.ce('div', 'sb',
            'À partir du ' + Kit.dateLongue(a.date_effet) + ' · ' +
            duPeriode.length + ' mois'));
          var l = Kit.lines(carte);
          Kit.ligne(l, 'Brut mensuel au contrat',
            a.brut_mensuel_centimes == null ? 'inconnu' : Kit.eur(a.brut_mensuel_centimes));
          Kit.ligne(l, 'Bruts réellement dus sur la période', Kit.eur(total), { total: true });
          /* Les mois qui S'ÉCARTENT du brut contractuel sont nommés : ce sont
             eux qu'on vient vérifier quand un total surprend. */
          var ecarts = duPeriode.filter(function (e) {
            return (e.resultat.brutDuCentimes || 0) !== (a.brut_mensuel_centimes || 0);
          });
          if (ecarts.length) {
            var det = Kit.ce('details');
            det.appendChild(Kit.ce('summary', null,
              ecarts.length + (ecarts.length > 1 ? ' mois s’écartent' : ' mois s’écarte') +
              ' du brut prévu'));
            var ld = Kit.lines(det);
            ecarts.forEach(function (e) {
              Kit.ligne(ld, Kit.libelleMoisAnnee(e.annee, e.mois),
                Kit.eur(e.resultat.brutDuCentimes || 0) + raisonEcartBrut(e.resultat));
            });
            det.appendChild(Kit.ce('div', 'sb q',
              'Un mois partiel est proratisé ; un jour sans solde est retenu sur le brut.'));
            carte.appendChild(det);
          }
          corps.appendChild(carte);
        });

        var pane = Kit.pane('Total');
        var lt = Kit.lines(pane);
        Kit.ligne(lt, 'Salaires bruts', Kit.eur(ind.totalBrutCentimes));
        Kit.ligne(lt, 'Ancienneté', libelleAnciennete(ind.ancienneteMois));
        Kit.ligne(lt, 'Indemnité — 1/80ᵉ', Kit.eur(ind.indemniteCentimes), { total: true });
        corps.appendChild(pane);

        /* Le point d'assiette non tranché, dit à l'écran comme le demande le
           §17.8 : tant que Maria n'a pas répondu, les indemnités de congés
           payés versées N'ENTRENT PAS dans le total. */
        corps.appendChild(Kit.note('Un point reste à confirmer',
          'Les indemnités de congés payés versées n’entrent PAS dans ce total de bruts. ' +
          'Si votre convention dit le contraire, ce montant sera à revoir.'));
      });
  }

  function raisonEcartBrut(r) {
    var raisons = [];
    if (r.prorata && r.prorata.applique) {
      raisons.push('mois partiel, ' + r.prorata.joursCouverts + ' j sur ' + r.prorata.joursDuMois);
    }
    if (r.retenueSansSoldeCentimes > 0) {
      raisons.push('sans solde retenu ' + Kit.eur(r.retenueSansSoldeCentimes));
    }
    return raisons.length ? ' (' + raisons.join(', ') + ')' : '';
  }

  function demanderFin(contrat, dateFin) {
    if (dateFin < contrat.date_debut) {
      Kit.toast('Le dernier jour de garde ne peut pas précéder le début du contrat.', true);
      return;
    }
    /* Restauration R4 : si la date de fin tombe dans un mois DÉJÀ CLÔTURÉ, ce
       document a été calculé sans elle et ne sera pas recalculé. Le
       récapitulatif de période, lui, tiendra compte de la date de fin : les
       deux diront alors des choses différentes. Il faut le dire avant. */
    global.DB.listRecapsContrat(contrat.id).catch(function () { return []; })
      .then(function (recaps) {
        var mFin = Chaine.moisDeDate(dateFin);
        var closDuMois = (recaps || []).filter(function (r) {
          return r.statut === 'fige' && r.annee === mFin.annee && r.mois === mFin.mois;
        });
        ouvrirConfirmationFin(contrat, dateFin, closDuMois);
      });
  }

  function ouvrirConfirmationFin(contrat, dateFin, closDuMois) {
    Kit.ouvrirFeuille('Ranger le contrat de ' + contrat.prenom_enfant + ' ?',
      'Dernier jour de garde : ' + Kit.dateLongue(dateFin),
      function (corps) {
        if (closDuMois.length) {
          corps.appendChild(Kit.warnbox(
            'Le récapitulatif ' + Kit.deMoisAnnee(closDuMois[0].annee, closDuMois[0].mois) +
            ' est déjà clôturé',
            'Il a été calculé sans cette date de fin et ne sera PAS recalculé : le document ' +
            'remis aux parents fait foi. Seuls les récapitulatifs de période tiendront compte ' +
            'de la date de fin — les deux ne diront donc pas la même chose sur ce mois.'));
        }
        corps.appendChild(Kit.warnbox('Avez-vous noté les deux soldes ?',
          'Congés payés restants (payés sans majoration) et heures supplémentaires ' +
          '(payées avec ' + libelleMajoration() + ' de majoration). Ils restent consultables ' +
          'après le rangement, mais c’est le moment de les relever.'));
        corps.appendChild(Kit.ce('p', 'sb q',
          'Le contrat sortira de l’Accueil, de la saisie et des congés. Rien ne sera supprimé, ' +
          'et vous pourrez le remettre en cours.'));
        var b = Kit.bouton('btn dg', function () {
          b.disabled = true;
          global.DB.archiverContrat(contrat.id, dateFin)
            .then(function () { return global.App.rechargerContrats(); })
            .then(function () {
              Kit.fermerFeuille();
              Kit.toast('Contrat de ' + contrat.prenom_enfant + ' rangé');
              return global.App.aller('accueil', {}, true);
            })
            .catch(function (e) {
              b.disabled = false;
              Kit.toast('Impossible de ranger ce contrat : ' + Kit.messageErreur(e) +
                ' Vérifiez avant de réessayer.', true);
            });
        });
        b.textContent = 'Oui, ranger ce contrat';
        corps.appendChild(b);
      });
  }

  function remettreEnCours(contrat, bouton) {
    bouton.disabled = true;
    global.DB.desarchiverContrat(contrat.id)
      .then(function () { return global.App.rechargerContrats(); })
      .then(function () {
        Kit.toast('Contrat de ' + contrat.prenom_enfant + ' remis en cours');
        return global.App.aller('accueil', {}, true);
      })
      .catch(function (e) {
        bouton.disabled = false;
        Kit.toast('Impossible : ' + Kit.messageErreur(e) + ' Vérifiez avant de réessayer.', true);
      });
  }

  global.UiContrat = {
    afficher: afficher,
    COEFF_FIN_CONTRAT: COEFF_FIN_CONTRAT,
    /* Exporté pour que les trois chemins d'alignement (correctif B6) posent
       EXACTEMENT le même garde-fou que la feuille de barème. Un garde-fou
       recopié est un garde-fou qui finit par diverger. */
    verifierDateEffet: verifierDateEffet,
    /* LOT 22 §22.2 — la photo se pose aussi à la CRÉATION d'un enfant, depuis
       `js/ui-menu.js`. Le bloc est exporté plutôt que recopié : deux blocs
       photo, ce sont deux endroits où oublier la réduction à 200 px ou la
       phrase qui promet qu'elle ne partira sur aucun document. */
    blocPhoto: blocPhoto,
    /* §22.1 — la carte d'un contrat terminé, sur la page « Mes enfants »,
       annonce la même période que le bandeau de sa fiche. */
    periodeDuContrat: periodeDuContrat
  };
})(window);
