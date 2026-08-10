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

    return Promise.all([
      global.DB.getSalaires(contrat.id),
      global.DB.listRecapsContrat(contrat.id).catch(function () { return []; }),
      /* Lot 11 — la version à laquelle ce contrat est rattaché. Un échec ici
         ne doit pas vider la fiche : on perd la mention d'écart, pas le
         contrat. */
      contrat.modele_id
        ? global.DB.listModeles().catch(function () { return []; })
        : Promise.resolve([])
    ]).then(function (r) {
      var salaires = r[0] || [];
      var recaps = r[1] || [];
      var modele = (r[2] || []).filter(function (m) { return m.id === contrat.modele_id; })[0] || null;
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

      corps.appendChild(Kit.fld('Prénom de l’enfant', contrat.prenom_enfant));
      corps.appendChild(Kit.fld('Nom de l’enfant', contrat.nom || '—'));
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

      if (modele) corps.appendChild(blocModele(contrat, modele, salaires));

      corps.appendChild(Kit.section('Horaires'));
      corps.appendChild(Kit.fld('Jours de garde', libellePlanning(contrat.jours_planning)));
      corps.appendChild(Kit.fld('Horaire contractuel',
        heureCourte(contrat.heure_arrivee) + ' → ' + heureCourte(contrat.heure_depart)));
      corps.appendChild(Kit.fld('Heures sup par jour travaillé', Kit.duree(contrat.minutes_sup_jour)));
      corps.appendChild(Kit.fld('Entretien par jour de présence', Kit.eur(contrat.entretien_centimes_jour)));

      if (!contrat.archive) {
        var bModif = Kit.bouton('btn nt', function () { feuilleContrat(contrat, recaps); });
        bModif.textContent = 'Modifier l’identité et les horaires';
        corps.appendChild(bModif);
      }

      corps.appendChild(Kit.section('Rémunération'));
      var m = global.App.moisCourant();
      var enVigueur = Engine.salaireApplicable(salaires, m.annee, m.mois);
      if (!salaires.length) {
        corps.appendChild(Kit.warnbox('Aucune rémunération connue',
          'Tant qu’aucun barème n’est enregistré, les montants de ce contrat restent à zéro ' +
          'et ses mois ne peuvent pas être clôturés.'));
      }
      salaires.slice().sort(function (a, b) { return a.date_effet < b.date_effet ? 1 : -1; })
        .forEach(function (s) {
          corps.appendChild(carteBareme(contrat, s, salaires, recaps, enVigueur));
        });

      if (!contrat.archive) {
        var bBareme = Kit.bouton('menu', function () {
          feuilleBareme(contrat, null, salaires, recaps);
        });
        var tx = Kit.ce('span');
        tx.appendChild(document.createTextNode('Nouveau barème'));
        tx.appendChild(Kit.ce('span', 'd', 'Au prochain relèvement du SMIC'));
        bBareme.appendChild(tx);
        bBareme.appendChild(Kit.ce('span', 'ar', '›'));
        corps.appendChild(bBareme);
      }

      corps.appendChild(Kit.section('Règles de ce contrat'));
      corps.appendChild(Kit.fld('Congés déduits d’abord',
        contrat.ordre_imputation === 'sup_puis_cp' ? 'récupération' : 'congés payés'));
      corps.appendChild(Kit.fld('Quand ' + contrat.prenom_enfant + ' est ' +
        Kit.accordDe(contrat, 'absent'),
        contrat.sup_dues_si_enfant_absent === false
          ? 'je ne compte pas mes ' + Kit.duree(contrat.minutes_sup_jour)
          : 'mes ' + Kit.duree(contrat.minutes_sup_jour) + ' restent dues'));
      corps.appendChild(Kit.fld('Majoration fin de contrat', libelleMajoration()));
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
  var CHAMPS_SENSIBLES = [
    ['date_debut', 'la date de début'],
    ['date_fin', 'la date de fin'],
    ['jours_planning', 'les jours de planning'],
    ['minutes_sup_jour', 'les minutes supplémentaires par jour'],
    ['minutes_par_jour_conge', 'la durée d’un jour de congé'],
    ['entretien_centimes_jour', 'l’indemnité d’entretien'],
    ['ordre_imputation', 'l’ordre d’imputation des congés'],
    ['sup_dues_si_enfant_absent', 'les heures sup en cas d’absence de l’enfant']
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

  function feuilleContrat(contrat, recaps) {
    var maintenant = global.App.moisCourant();
    Kit.ouvrirFeuille('Modifier le contrat', contrat.prenom_enfant,
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

        var debut = Kit.champDate('Début du contrat', contrat.date_debut,
          { anneeMin: Number(String(contrat.date_debut).slice(0, 4)) - 3, anneeMax: maintenant.annee + 2 });
        corps.appendChild(debut.bloc);

        corps.appendChild(Kit.section('Jours de garde'));
        var cases = [];
        JOURS.forEach(function (j) {
          var f = Kit.ce('div', 'fld');
          var lab = Kit.ce('label', 'lb', j[1]);
          lab.style.flex = '1';
          var cb = Kit.ce('input');
          cb.type = 'checkbox';
          cb.checked = (contrat.jours_planning || [1, 2, 3, 4, 5]).indexOf(j[0]) !== -1;
          cb.style.width = '22px';
          cb.style.height = '22px';
          lab.appendChild(cb);
          f.appendChild(lab);
          corps.appendChild(f);
          cases.push({ jour: j[0], cb: cb });
        });

        corps.appendChild(Kit.section('Horaires et montants'));
        var arrivee = Kit.champ('Heure d’arrivée', heureCourte(contrat.heure_arrivee), { type: 'time' });
        corps.appendChild(arrivee.bloc);
        var depart = Kit.champ('Heure de départ', heureCourte(contrat.heure_depart), { type: 'time' });
        corps.appendChild(depart.bloc);
        var supJour = Kit.champ('Minutes sup par jour travaillé',
          String(contrat.minutes_sup_jour), { inputmode: 'numeric' });
        corps.appendChild(supJour.bloc);
        var minConge = Kit.champ('Minutes pour un jour de congé',
          String(contrat.minutes_par_jour_conge), { inputmode: 'numeric' });
        corps.appendChild(minConge.bloc);
        var entretien = Kit.champ('Entretien par jour de présence',
          (contrat.entretien_centimes_jour / 100).toFixed(2).replace('.', ','),
          { inputmode: 'decimal' });
        corps.appendChild(entretien.bloc);

        var statut = Kit.champSelect('Statut du contrat', [
          ['familiarisation', 'Familiarisation'],
          ['actif', 'Actif'],
          ['termine', 'Terminé']
        ], contrat.statut || 'actif');
        corps.appendChild(statut.bloc);

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
          var planning = cases.filter(function (x) { return x.cb.checked; })
            .map(function (x) { return x.jour; });
          if (!planning.length) { erreur('Cochez au moins un jour de garde.'); return; }
          var msj = Kit.parseEntier(supJour.input.value, 0);
          if (msj == null) { erreur('Les minutes sup par jour doivent être un nombre entier (0 accepté).'); return; }
          var mpjc = Kit.parseEntier(minConge.input.value, 1);
          if (mpjc == null) { erreur('La durée d’un jour de congé doit être un entier supérieur à zéro.'); return; }
          var ent = Kit.parseEuros(entretien.input.value);
          if (ent == null) { erreur('Indemnité d’entretien illisible (exemple : 5,00).'); return; }

          var saisis = {
            prenom_enfant: p,
            date_debut: debut.valeur(),
            jours_planning: planning,
            heure_arrivee: arrivee.input.value || '08:30',
            heure_depart: depart.input.value || '18:00',
            minutes_sup_jour: msj,
            minutes_par_jour_conge: mpjc,
            entretien_centimes_jour: ent,
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

  function blocModele(contrat, modele, salaires) {
    var bloc = Kit.ce('div', 'modele-bloc');
    var dernier = (salaires || [])[salaires.length - 1] || null;
    var ecarts = global.DB.ecartsContratModele(contrat, modele, dernier);

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
      feuilleAlignerCeContrat(contrat, modele, ecarts, dernier);
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
          effet = Kit.champDate('Rémunération à partir du',
            Kit.iso(maintenant.annee, maintenant.mois, 1),
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
          var p = Object.keys(reglages).length
            ? global.DB.majContrat(contrat.id, reglages)
            : Promise.resolve(null);
          p.then(function () {
            if (!touchRemuneration) return null;
            /* A4 — une ligne salaire_contrat DATÉE, jamais une écriture
               directe sur le contrat : sinon les mois passés changeraient. */
            return global.DB.ajouterSalaire(contrat.id, {
              date_effet: effet.valeur(),
              brut_mensuel_centimes: modele.brut_mensuel_centimes,
              net_mensuel_centimes: modele.net_mensuel_centimes
            });
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

  function blocPhoto(courante) {
    var f = Kit.ce('div', 'fld photo-fld');
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
        courante.valeur = dataUrl;
        redessiner();
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

    var bRetirer = Kit.bouton('btn nt', function () {
      courante.valeur = null;
      redessiner();
      msg.className = 'msg';
      msg.textContent = 'La photo sera retirée à l’enregistrement.';
    });
    bRetirer.textContent = 'Retirer la photo';
    f.appendChild(bRetirer);

    f.appendChild(msg);
    f.appendChild(Kit.ce('p', 'sb q',
      'La photo ne figure sur aucun document remis aux familles. ' +
      'Elle sert à reconnaître l’enfant d’un coup d’œil dans l’application.'));
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

  /* Un barème est « utilisé par un mois clôturé » si, pour au moins un mois
     figé, c'est lui que RG-15 retient. On ne recalcule rien : on interroge le
     moteur. */
  function moisClosDependants(bareme, salaires, recaps) {
    var out = [];
    (recaps || []).forEach(function (r) {
      if (r.statut !== 'fige') return;
      var applicable = Engine.salaireApplicable(salaires, r.annee, r.mois);
      if (applicable && applicable.id === bareme.id) out.push(r);
    });
    return out;
  }

  function listeMois(rs) {
    return rs.map(function (r) { return Kit.libelleMoisAnnee(r.annee, r.mois); }).join(', ');
  }

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
      var minutes = Kit.supDisponible(cs);
      var cp = Kit.cpDisponible(cs);

      var p = Kit.pane('Soldes au ' + Kit.dateLongue(dateFin));
      var l = Kit.lines(p);
      Kit.ligne(l, 'Récupération restante', Kit.heures(minutes));
      Kit.ligne(l, 'Congés payés restants', Kit.joursCp(cp));

      var salaire = Engine.salaireApplicable(salaires, m.annee, m.mois);
      if (salaire) {
        /* RG-13 : exactement la formule validée par le cas T6 du moteur. */
        var montant = Engine.montantCentimes(salaire.brut_mensuel_centimes,
          Math.max(0, minutes), COEFF_FIN_CONTRAT);
        Kit.ligne(l, 'Heures sup majorées de ' + libelleMajoration() + ' (indicatif)',
          Kit.eur(montant), { total: true });
      }
      zone.appendChild(p);

      zone.appendChild(Kit.note('À la fin du contrat',
        'Les congés payés restants sont payés sans majoration ; les heures supplémentaires ' +
        'sont payées avec une majoration de ' + libelleMajoration() + '. Le montant des congés ' +
        'payés n’est pas calculé ici : la base de calcul n’est pas définie au cahier des charges. ' +
        'Notez ces chiffres, rien n’est enregistré.'));
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
            'Le récapitulatif de ' + Kit.libelleMoisAnnee(closDuMois[0].annee, closDuMois[0].mois) +
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

  global.UiContrat = { afficher: afficher, COEFF_FIN_CONTRAT: COEFF_FIN_CONTRAT };
})(window);
