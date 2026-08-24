/* ============================================================================
   ui-document.js — Le document du mois, sa clôture et son partage (§2.4).

   DÉCISION STRUCTURANTE DU LOT, tenue par ce fichier : la clôture du mois et
   l'envoi aux parents sont DEUX CHOSES DISTINCTES.

   - Le geste central est « Clôturer le mois ». Il fige le récapitulatif
     (statut `fige` en base). À l'écran, le mot est TOUJOURS « clôturé » :
     jamais « figé », jamais « envoyé ».
   - Le partage est FACULTATIF et disponible avant comme après la clôture :
     copier le texte, enregistrer une image. Aucune intégration WhatsApp,
     aucune API d'envoi — le document reste ici, disponible à tout moment.

   Un mois clôturé s'affiche depuis son INSTANTANÉ, jamais recalculé : c'est le
   document parti chez les parents qui fait foi, y compris si un barème ou un
   prénom change ensuite.

   Aucun calcul ici : le contenu vient de la chaîne des mois (donc de Engine),
   ou de l'instantané pour un mois clôturé.
   ========================================================================= */
(function (global) {
  'use strict';

  var Kit = global.Kit;
  var Chaine = global.ChaineMois;
  /* LOT 20 — le taux horaire affiché sur le document vient du MOTEUR
     (`montantCentimes` sur soixante minutes), jamais d'une division faite
     ici : un taux recomposé à l'écran diverge du taux qui a servi au calcul
     dès que l'avenant change, et le document devient indéfendable. */
  var Engine = global.Engine;
  var Feries = global.Feries;

  var vue = null;

  /* ------------------------------------------------------------------ */
  /* Affichage                                                           */
  /* ------------------------------------------------------------------ */

  function afficher(ctx) {
    var contrat = global.App.contratParId(ctx.params.contratId);
    var m = { annee: ctx.params.annee, mois: ctx.params.mois };
    if (!contrat) {
      return global.App.tousLesContrats().then(function () {
        return charger(ctx, global.App.contratParId(ctx.params.contratId), m);
      });
    }
    return charger(ctx, contrat, m);
  }

  /* Le mois, débordé d'un mois de chaque côté. */
  function fenetreSamedis(m) {
    var d = new Date(Date.UTC(m.annee, m.mois - 2, 1));
    var f = new Date(Date.UTC(m.annee, m.mois + 1, 0));
    return { debut: d.toISOString().slice(0, 10), fin: f.toISOString().slice(0, 10) };
  }

  function charger(ctx, contrat, m) {
    if (!contrat) throw new Error('contrat introuvable');

    global.App.barreRetour(ctx.barre,
      /* LOT 16 §16.6 — « Récap de août ». L'élision vit dans ui-kit.js. */
      'Récap ' + Kit.deMois(m.mois), { droite: contrat.prenom_enfant });
    ctx.corps.appendChild(Kit.ce('div', 'attente', 'Préparation du document…'));

    return Promise.all([
      global.App.serie(contrat, m),
      global.App.journees(contrat.id, m.annee, m.mois),
      /* §6.2 — LES SAMEDIS COMPTÉS DU MOIS. Une période qui compte un samedi
         le NOMME sur le document : « du 19 au 24 octobre — 6 jours ouvrables,
         dont le samedi 24 octobre ». Sans cette phrase, la famille lit un
         6 qu'aucune ligne n'explique, et c'est exactement le litige que ce
         document existe pour éteindre.

         La fenêtre déborde du mois : un samedi qui prolonge une semaine de fin
         de mois appartient au mois suivant. Une lecture qui échoue rend une
         liste vide — le document reste juste, il est seulement moins bavard,
         et aucun chiffre n'en dépend. */
      (typeof global.DB.listSamedisConge === 'function'
        ? global.DB.listSamedisConge(contrat.id, fenetreSamedis(m).debut,
            fenetreSamedis(m).fin).catch(function () { return []; })
        : Promise.resolve([]))
    ]).then(function (r) {
      var entree = global.App.moisDe(r[0], m.annee, m.mois);
      if (!entree) throw new Error('mois hors du contrat');
      vue = {
        contrat: contrat, annee: m.annee, mois: m.mois,
        entree: entree, journees: r[1], samedis: r[2] || [],
        lectureSeule: !!contrat.archive
      };
      Kit.vider(ctx.corps);
      rendre(ctx.corps);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Contenu du document — une seule source pour l'écran, le texte et    */
  /* l'image. Trois rendus différents ne doivent jamais pouvoir diverger. */
  /* ------------------------------------------------------------------ */

  function identite() {
    var r = vue.entree.resultat;
    /* Sur un mois clôturé, le nom vient de l'instantané : renommer un enfant
       ne réécrit pas un document déjà remis aux parents. */
    if (vue.entree.fige && r.prenomEnfant) {
      return { prenom: r.prenomEnfant, famille: r.nomFamille || null };
    }
    return {
      prenom: vue.contrat.prenom_enfant,
      famille: (vue.contrat.famille && vue.contrat.famille.nom) || null
    };
  }

  /* Jours de congé du mois. Sur un mois clôturé ils viennent de l'instantané
     (champ ajouté au figement, cf. instantane()) ; sur un mois en cours, des
     journées saisies. Repli sur le décompte seul pour les instantanés
     antérieurs au lot 6, qui ne portent pas la liste. */
  function joursConge() {
    var r = vue.entree.resultat;
    if (vue.entree.fige) return r.joursConge || null;
    return joursCongeDe(vue.journees);
  }

  /* Forme PURE, sans `vue` : c'est elle que partagent les deux chemins de
     clôture (correctif B4). */
  function joursCongeDe(journees) {
    return Object.keys(journees || {}).filter(function (d) {
      return journees[d].type === 'conge_maria';
    }).sort();
  }

  /* LOT 17 §17.3 — LES CONDITIONS DU MOIS. Un document est la pièce qui doit
     éteindre un désaccord : il doit porter les conditions de SON époque, pas
     celles d'aujourd'hui. La chaîne les a résolues et les transporte sur le
     maillon ; sur un mois figé, ce sont celles de l'avenant en vigueur au
     moment de la clôture. */
  function cond() {
    return (vue && vue.entree && vue.entree.conditions) || null;
  }
  function reg(champ, defaut) {
    var c = cond();
    return (c && c[champ] != null) ? c[champ] : defaut;
  }
  function planningDuMois() { return reg('jours_planning', null); }

  /* Le document, sous forme de blocs. Chaque bloc : { titre, lignes }. */
  function blocs() {
    var r = vue.entree.resultat;
    var imp = r.imputation || {};
    var cs = r.compteurSortie || {};
    var conges = joursConge();
    var out = [];

    /* LOT 20 (§20.3) — LE MOIS MÊLÉ SE MONTRE EN DEUX BLOCS.

       « Familiarisation du 1er au 19 septembre — 22 h 30 déclarées × 7,20 € »
       puis « Garde à partir du 21 septembre — 8 jours travaillés sur 22 ». Les
       deux parts sont payées selon deux règles différentes ; les fondre en une
       seule ligne rendrait le total invérifiable pour la famille, ce qui est
       exactement ce que ce document existe pour éviter.

       Le bloc passe EN TÊTE quand il y en a un : c'est la partie du mois qui
       demande une explication. */
    var fam = r.familiarisation;
    if (fam && fam.actif) {
      /* CORRECTION C2 DE LA RELECTURE — LE DÉTAIL NE S'AFFICHE QUE S'IL
         RECONSTITUE SON TOTAL.

         Le document annonçait « Heures déclarées 22 h 30 », « Rémunération
         nette 123,69 € » et « Taux horaire net 5,50 € ». Chaque chiffre était
         juste, et pourtant la multiplication ne tombait pas : 22,5 × 5,50 fait
         123,75 €. L'arrondi unique porte sur le MOIS, à la minute, pas sur un
         taux horaire arrondi au centime — et une famille qui refait le calcul
         trouve six centimes d'écart sans aucune explication.

         C'est exactement la règle appliquée dix lignes plus bas à l'indemnité
         d'entretien, et elle vaut ici pour la même raison : mieux vaut moins de
         détail qu'un détail qui ment. On tente donc la multiplication ; si elle
         reconstitue au centime, elle s'affiche et rend le montant vérifiable ;
         sinon la ligne de taux disparaît, et une phrase dit pourquoi. */
      var lignesFam = [];
      lignesFam.push(['Heures déclarées', Kit.heures(fam.minutesDeclarees)]);
      lignesFam.push(['Rémunération nette', Kit.eur(fam.netCentimes || 0)]);
      /* LA MULTIPLICATION VÉRIFIABLE VA SUR LE BRUT, pas sur le net, et ce
         n'est pas un choix esthétique. Le taux horaire est le brut mensuel
         divisé par 195 h : sur un brut rond il tombe juste au centime, et
         « 22 h 30 déclarées × 7,20 € — 162,00 € » — l'exemple du §20.3 — se
         refait de tête. Le net, lui, est saisi à la main depuis une fiche de
         paie et ne divise presque jamais rond : y accrocher la multiplication
         produisait six centimes d'écart inexplicables. */
      var lib = libelleBrutFamiliarisation(fam);
      lignesFam.push([lib.libelle, Kit.eur(fam.brutCentimes || 0), { doux: true }]);
      if (!lib.reconstitue) {
        lignesFam.push(['Rémunération calculée à la minute sur l’ensemble du ' +
          'mois : un taux horaire arrondi au centime ne redonne pas exactement ' +
          'ce total.', '', { doux: true }]);
      }
      lignesFam.push([libelleEntretienFamiliarisation(r),
        Kit.eur(fam.entretienCentimes)]);
      lignesFam.push(['Jours déclarés',
        fam.joursDeclares + ' sur ' + fam.joursDeLaPeriode, { doux: true }]);
      lignesFam.push(['Pendant la familiarisation, seules les heures déclarées ' +
        'sont payées, au taux du contrat, et aucune heure supplémentaire n’est due.',
        '', { doux: true }]);
      out.push({ titre: 'Familiarisation', lignes: lignesFam });
    }

    var principal = [
      ['Jours de présence', Kit.jours(r.joursPresence)],
      /* LOT 7 — l'entretien est DÉTAILLÉ, jamais donné en bloc. « 70,00 € »
         seul n'est pas vérifiable ; « 14 jours × 5,00 € » l'est, et c'est ce
         qui éteint une contestation avant qu'elle ne naisse. */
      [libelleEntretienDetaille(r), Kit.eur(r.entretienCentimes)],
      /* LOT 17 §17.7 — LE SALAIRE DU MOIS, PRORATISÉ QUAND LE CONTRAT NE LE
         COUVRE PAS EN ENTIER. Un contrat ouvert le 16 mars retenait jusqu'ici
         le mois de mars complet ; le document partait chez la famille avec un
         salaire qu'elle ne devait pas.

         Les instantanés d'avant le lot 17 ne portent pas `salaireNetProrata` :
         ils n'ont jamais connu le prorata, et leur net contractuel EST leur net
         du mois. Le repli est donc exact, pas approximatif.

         CORRECTION B4 — ce repli vivait ICI, et ici seulement : les cinq
         autres écrans lisaient le net contractuel. Il est désormais dans
         `Chaine.netDuMois`, appelée par tous. */
      ['Salaire net', Kit.eur(Chaine.netDuMois(r))],
      ['Salaire brut correspondant', Kit.eur(Chaine.brutDuMois(r)), { doux: true }]
    ];
    if (r.prorata && r.prorata.applique) {
      /* La phrase qui rend le chiffre vérifiable. Un montant proratisé sans son
         quotient est indéfendable : la famille compte 22 jours et lit un
         salaire qui n'en vaut que 12.
         LOT 20 — quand une période de familiarisation borne le mois, la
         phrase le DIT : sinon la famille cherche pourquoi il manque quatorze
         jours à un contrat qui n'a pourtant pas bougé. */
      principal.push([(fam && fam.actif
        ? 'Garde mensualisée — ' + r.prorata.joursCouverts + ' jours travaillés sur ' +
          r.prorata.joursDuMois + ', hors familiarisation'
        : 'Mois partiel — ' + r.prorata.joursCouverts + ' jours de garde sur ' +
          r.prorata.joursDuMois + ' au contrat'), '', { doux: true }]);
    }
    if (r.retenueSansSoldeCentimes > 0) {
      principal.push(['Retenue pour jour(s) sans solde', '−' + Kit.eur(r.retenueSansSoldeCentimes)]);
    }
    principal.push(['Total à verser', Kit.eur(r.totalAVerserCentimes), { total: true }]);
    out.push({ titre: (fam && fam.actif) ? 'Garde mensualisée' : null, lignes: principal });

    var lignesConge = [];
    if (conges && conges.length) {
      conges.forEach(function (d) { lignesConge.push([Kit.jourLong(d), '1 jour']); });
    }
    if (r.joursCongesDecomptes > 0) {
      lignesConge.push(['Décompte en jours ouvrables', r.joursCongesDecomptes + ' j']);
      /* §6.2 — la période NOMME son samedi. Une période sans samedi compté ne
         dit rien de plus : le décompte parle seul. */
      var samedisDits = samedisDuMois();
      if (samedisDits.length) {
        lignesConge.push(['— ' + (samedisDits.length > 1 ? 'dont les samedis ' : 'dont le ') +
          samedisDits.map(function (d) {
            return samedisDits.length > 1
              ? Kit.jourLong(d).toLowerCase().replace('samedi ', '')
              : Kit.jourLong(d).toLowerCase();
          }).join(', '), '', { doux: true }]);
      }
      lignesConge.push(['— sur congés payés', Kit.jours(imp.joursSurCp || 0)]);
      lignesConge.push(['— sur récupération', Kit.jours(imp.joursSurSup || 0)]);
      if ((imp.joursSansSolde || 0) > 0) lignesConge.push(['— sans solde', Kit.jours(imp.joursSansSolde)]);
    }
    if (!lignesConge.length) lignesConge.push(['Aucun ce mois-ci', '—']);
    out.push({ titre: 'Congés de l’assistante maternelle', lignes: lignesConge });

    /* Les journées qui s'écartent de la normale, datées en clair. */
    var part = journeesParticulieres(identite().prenom);
    if (part.length) {
      out.push({
        titre: 'Journées particulières',
        lignes: part.map(function (j) { return [Kit.jourLong(j.date), j.quoi]; })
      });
    }

    /* LOT 12 — LE RENONCEMENT FIGURE SUR LE DOCUMENT TRANSMIS.
       Décision d'Adrien du 10 août 2026 : le parent voit que Maria a renoncé
       à des heures qui lui étaient dues.

       La formulation est reprise MOT POUR MOT de la spécification, et ce n'est
       pas une coquetterie. « Dont 1 h 30 auxquelles j'ai choisi de renoncer ce
       mois-ci » énonce un GESTE ASSUMÉ. « Non facturées », « offertes » ou
       « dues » énonceraient une créance en attente — c'est-à-dire une dette
       que le parent pourrait croire devoir régler un jour, ou pire, une
       faveur à rappeler. Ce document sert à éteindre les désaccords, pas à en
       créer un nouveau. (Risque n° 4.) */
    /* LOT 17 §17.5 (A5) — LE TOTAL EST NET, ET LA LIGNE QUI L'EXPLIQUE EST LÀ.

         Heures supplémentaires du mois — 8 h 30
         dont 1 h 30 déduite — libération anticipée du 17 novembre

       Un total amputé sans son détail est incontestable et inexplicable en
       même temps : le parent voit un chiffre plus bas que le mois d'avant et
       n'a aucun moyen de savoir pourquoi. C'est exactement le genre de
       silence que ce document existe pour supprimer.

       Les minutes RENDUES par Maria (écart négatif imputé à la récupération)
       et les minutes de RETARD d'un parent (écart positif) sont dites
       séparément : ce ne sont pas les mêmes faits, et les confondre dans un
       solde ferait disparaître le retard du parent. */
    var ecarts = r.ecartsDeclares || [];
    if (r.minutesSupRenoncees > 0 || ecarts.length) {
      var lignesSup = [['Heures supplémentaires du mois', Kit.heures(r.minutesSupAcquises)]];
      if (r.minutesSupRenoncees > 0) {
        lignesSup.push(['Dont ' + Kit.heures(r.minutesSupRenoncees) +
          ' auxquelles j’ai choisi de renoncer ce mois-ci', '', { doux: true }]);
      }
      ecarts.forEach(function (e) {
        lignesSup.push([libelleEcartHoraire(e), '', { doux: true }]);
      });
      out.push({ titre: null, lignes: lignesSup });
    }

    out.push({
      titre: 'Compteurs de ce contrat à la fin du mois',
      lignes: [
        ['Heures supplémentaires acquises dans le mois', Kit.heures(r.minutesSupAcquises)],
        ['Récupération restante', Kit.heures(cs.minutesSup || 0)],
        ['Congés payés restants',
         Kit.joursCp(Kit.cpDisponible(cs), reg('minutes_par_jour_conge', 0))]
      ]
    });
    return out;
  }

  /* LOT 17 §17.5 — la phrase d'un écart d'horaire, sur le document.

     Elle dit TROIS choses, et il en faut trois : combien, dans quel sens, et
     à quel titre. « − 1 h 30 » seul laisse le parent supposer une erreur ;
     « libération anticipée du 17 novembre » lui dit que c'est Maria qui a
     rendu ce temps, et que le mois d'après ne recommencera pas.

     La destination n'est nommée que lorsqu'elle change quelque chose pour le
     parent : une déduction sur les congés payés ou en sans solde ne se lit pas
     comme une déduction sur la récupération, et le sans-solde apparaît en plus
     dans la retenue.

     LOT 28 — LES DEUX TABLES DE LIBELLÉS ONT DÉMÉNAGÉ DANS `js/ui-kit.js`.

     Elles étaient ici parce que ce document était le seul écran à nommer un
     écart. Le repli « Journées à part » de l'espace enfant le nomme désormais
     lui aussi. Deux copies d'une même phrase finissent toujours par diverger,
     et celle-ci sépare ce que Maria lit de ce que la famille lit sur une pièce
     opposable : un seul exemplaire, comme `ENCART_RG06`.

     AUCUN LIBELLÉ N'EST MODIFIÉ. La phrase produite ici est identique au
     caractère près à celle d'avant ce lot — c'est l'objet des assertions du
     lot 17 et du lot 21, qui n'ont pas bougé d'une ligne. */
  var LIBELLE_DESTINATION_ECART = Kit.LIBELLE_DESTINATION_ECART;
  var LIBELLE_EVENEMENT_ECART = Kit.LIBELLE_EVENEMENT_ECART;

  function libelleEcartHoraire(e) {
    var quand = ' du ' + Kit.jourLong(e.jour).toLowerCase();
    var evenement = LIBELLE_EVENEMENT_ECART[e.evenement] || null;
    if (e.minutes > 0) {
      return 'Dont ' + Kit.heures(e.minutes) + ' de garde en plus' + quand +
        (evenement ? ' — ' + evenement : '');
    }
    var destination = LIBELLE_DESTINATION_ECART[e.imputeSur] || '';
    return 'Dont ' + Kit.heures(-e.minutes) + ' que je n’ai pas gardée' + quand +
      (evenement ? ' — ' + evenement : '') +
      (destination ? ', ' + destination : '');
  }

  /* Même mise en forme que l'historique du lot 13 : « 31 août 2026 à 18h42 ».
     Deux écrans qui parlent du même horodatage ne doivent pas l'écrire
     différemment. */
  function dateHeure(iso) {
    if (global.UiReouverture && global.UiReouverture.dateHeure) {
      return global.UiReouverture.dateHeure(iso);
    }
    return Kit.dateLongue(iso);
  }

  /* Le détail n'est affichable que s'il RECONSTITUE le montant. Si les deux ne
     tombent pas juste — un barème changé en cours de mois, une reprise de
     compteurs — on ne fabrique pas une multiplication fausse : on donne le
     montant seul. Mieux vaut moins de détail qu'un détail qui ment. */
  function libelleEntretienDetaille(r) {
    var parJour = reg('entretien_centimes_jour', 0);
    if (parJour <= 0) return 'Indemnité d’entretien';
    /* LOT 20 (§20.6) — « 19 jours × 5,50 € + 1 jour sans indemnité ». Les
       journées dont Maria a retiré l'indemnité sont comptées présentes : sans
       cette mention, le détail ne reconstitue plus le total et la règle
       ci-dessus l'efface — la famille perdrait l'explication, pas le chiffre.
       `joursSansEntretien` est absent des instantanés d'avant le lot 20 : le
       `|| 0` n'est pas une prudence, c'est le cas normal de tous les mois
       clôturés, qui ne sont jamais réécrits. */
    var sansIndemnite = r.joursSansEntretien || 0;
    var dus = r.joursPresence - sansIndemnite;
    if (dus >= 0 && dus * parJour === r.entretienCentimes) {
      return 'Indemnité d’entretien — ' + dus + ' jours × ' + Kit.eur(parJour) +
        (sansIndemnite > 0
          ? ' + ' + sansIndemnite + ' jour' + (sansIndemnite > 1 ? 's' : '') +
            ' sans indemnité'
          : '');
    }
    return 'Indemnité d’entretien';
  }

  /* Le taux d'une heure, demandé au moteur sur soixante minutes. `null` quand
     le mois n'a pas de rémunération connue — on n'affiche alors pas de taux
     plutôt que d'en inventer un à zéro. */
  function tauxHoraire(champ) {
    var c = cond();
    if (!c || c[champ] == null) return null;
    return Engine.montantCentimes(c[champ], 60);
  }

  /* Le libellé de la rémunération brute de familiarisation, avec sa
     multiplication SI elle reconstitue le total au centime. Rend aussi le
     verdict, pour que l'appelant puisse EXPLIQUER l'absence de détail plutôt
     que de la laisser sans un mot. Même règle que l'indemnité d'entretien :
     un détail qui ne redonne pas son total ne s'affiche pas. */
  function libelleBrutFamiliarisation(fam) {
    var minutes = fam.minutesDeclarees || 0;
    var total = fam.brutCentimes || 0;
    var taux = tauxHoraire('brut_mensuel_centimes');
    var reconstitue = taux != null && minutes > 0 &&
      Math.round(taux * minutes / 60) === total;
    return {
      reconstitue: reconstitue,
      libelle: reconstitue
        ? 'Rémunération brute — ' + Kit.heures(minutes) + ' × ' + Kit.eur(taux) +
          ' de l’heure'
        : 'Rémunération brute correspondante'
    };
  }

  /* Le même principe pour la part de familiarisation : le détail n'apparaît
     que s'il redonne le total. Les jours sans indemnité y sont ceux que Maria
     a déclarés sans compter l'entretien. */
  function libelleEntretienFamiliarisation(r) {
    var fam = r.familiarisation || {};
    var parJour = reg('entretien_centimes_jour', 0);
    if (parJour <= 0 || fam.joursAvecEntretien * parJour !== fam.entretienCentimes) {
      return 'Indemnité d’entretien';
    }
    /* CORRECTION C1 — le bloc de familiarisation a SON propre compte de jours
       sans indemnité, distinct de celui de la garde. Sans lui, une journée
       déclarée sans entretien disparaissait du détail des deux blocs à la
       fois. */
    var sans = fam.joursSansEntretien || 0;
    return 'Indemnité d’entretien — ' + fam.joursAvecEntretien + ' jour' +
      (fam.joursAvecEntretien > 1 ? 's' : '') + ' × ' + Kit.eur(parJour) +
      (sans > 0
        ? ' + ' + sans + ' jour' + (sans > 1 ? 's' : '') + ' sans indemnité'
        : '');
  }

  /* LOT 16 §16.2 — L'AUTEUR DU DOCUMENT.

     Cette fonction écrivait « Établi par <adresse de connexion>, assistante
     maternelle » : la pièce dont le seul métier est d'éteindre un désaccord
     avec une famille était signée par une adresse e-mail. Le `TODO RÈGLE
     ABSENTE` qui tenait cette place renvoyait au lot 14, jamais fait.

     La ligne est désormais exactement « Établi par <nom> » — sans mention de
     la profession, sans numéro d'agrément.

     UN MOIS CLÔTURÉ GARDE LE NOM DU MOMENT DE LA CLÔTURE : il vient de
     l'instantané, jamais du compte. Renommer plus tard ne réécrit aucun
     document déjà remis.

     Tant que rien n'est saisi : « votre assistante maternelle ». JAMAIS
     l'adresse, sur aucun écran, aperçu ou export. */
  function nomAuteur() {
    var r = vue.entree && vue.entree.resultat;
    if (vue.entree && vue.entree.fige && r && r.nomEmettrice) return r.nomEmettrice;
    if (vue.entree && vue.entree.fige) return null;
    return (global.App.nomEmettrice && global.App.nomEmettrice()) || null;
  }

  function enTeteAuteur() {
    return 'Établi par ' + (nomAuteur() || 'votre assistante maternelle');
  }

  function enTetePeriode(id) {
    var dernier = Kit.nbJoursDansMois(vue.annee, vue.mois);
    return 'Période du 1er au ' + dernier + ' ' +
      Kit.libelleMois(vue.mois) + ' ' + vue.annee +
      (id.famille ? ' · famille ' + id.famille : '');
  }

  /* Toutes les journées qui S'ÉCARTENT de la normale, avec leur date en clair.
     Le document disait « 14 jours de présence » sans jamais dire lesquels
     manquaient : un parent qui conteste une absence n'avait aucun moyen de
     vérifier laquelle. La présence reste le cas par défaut, non listée — c'est
     la même règle qu'à la saisie. */
  /* Lot 8 — l'accord vient du genre du contrat. Ce document part chez une
     famille : « Léa absent·e » y est plus visible qu'ailleurs. */
  var LIBELLE_ECART = {
    absence_enfant:  function (prenom, contrat) {
      return prenom + ' ' + Kit.accordDe(contrat, 'absent');
    },
    ferie:           function () { return 'férié'; },
    conge_maria:     function () { return 'congé de l’assistante maternelle'; },
    sans_solde:      function () { return 'congé sans solde'; },
    hors_planning:   function () { return 'je ne travaillais pas'; },
    familiarisation: function () { return 'familiarisation'; }
  };

  function journeesParticulieres(prenom) {
    var r = vue.entree.resultat;
    /* Sur un mois clôturé, la liste vient de l'instantané si elle y figure :
       un document remis aux parents ne se réécrit pas. Les instantanés
       antérieurs au lot 7 n'en portent pas — on se rabat alors sur les
       journées saisies, qui n'ont pas bougé puisque le mois est verrouillé. */
    var source = (vue.entree.fige && r.journeesParticulieres) || null;
    if (source) return source;
    return journeesParticulieresDe(prenom, vue.contrat, planningDuMois(),
      vue.journees, vue.annee, vue.mois);
  }

  /* Forme PURE. Correctif A15 de la relecture PR9 : cette liste n'était écrite
     dans AUCUN instantané, si bien que la branche « figé » ci-dessus était
     morte et qu'un document clôturé reconstruisait toujours ses journées
     particulières depuis le planning ACTUEL. Changer les jours de garde après
     la clôture changeait donc le contenu d'un document déjà remis. */
  function journeesParticulieresDe(prenom, contrat, planning, journees, annee, mois) {
    var out = [];
    Object.keys(journees || {}).sort().forEach(function (d) {
      var t = journees[d].type;
      if (t === 'presence') return;
      var f = LIBELLE_ECART[t];
      if (!f) return;
      out.push({ date: d, quoi: f(prenom, contrat) });
    });
    /* Les fériés ne sont pas saisis : ils viennent du calendrier. Ils comptent
       pourtant parmi les journées où l'enfant n'était pas là, et un parent qui
       compte ses jours doit les retrouver. */
    Kit.joursPlanning(contrat, planning, annee, mois).forEach(function (d) {
      if ((journees || {})[d]) return;
      if (!Feries.estJourFerie(d)) return;
      out.push({ date: d, quoi: 'férié' });
    });
    return out.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  }

  /* Encart permanent de RG-06 : c'est lui qui doit éteindre le désaccord
     historique sur le décompte des congés. Il figure sur TOUS les documents,
     même ceux sans congé. */
  /* DÉCISION D'ADRIEN (19 août 2026) — L'ENCART NE FIGURE PLUS QUE SUR LES
     MOIS QUI PORTENT DES CONGÉS.

     ÉCART ASSUMÉ À LA SPÉCIFICATION, à signaler en relecture. Le §A.3 range
     « l'encart expliquant le décompte en jours ouvrables figure sur tous les
     documents » parmi les six qualités à ne pas casser, et le référentiel dit
     pourquoi : le décompte des congés est LE point de friction historique avec
     les familles — elles comptent 5 jours pour une semaine, Maria en compte 6,
     et c'est elle qui a raison.

     Ce que la décision retient : sur un mois sans aucun congé, l'encart
     explique une règle que le document n'applique nulle part. Trois lignes de
     droit du travail sous « Aucun ce mois-ci », c'est du bruit — et le bruit,
     à force, fait qu'on ne lit plus rien. Il reste donc là où il explique un
     chiffre que la famille a sous les yeux.

     UNE SEULE CONDITION, lue par les trois rendus — écran, texte, image. Les
     séparer ferait diverger la pièce papier de ce qu'on colle dans un message,
     et c'est exactement le genre d'écart qu'on ne voit qu'une fois le document
     parti. */
  /* Les samedis comptés qui se rattachent aux congés de CE mois. Le rattachement
     suit celui du décompte RG-06 : un samedi de prolongation appartient au mois
     du dernier jour posé. On retient donc les samedis dont la période commence
     dans le mois affiché, plus ceux qui y tombent. */
  function samedisDuMois() {
    var cle = vue.annee + '-' + String(vue.mois).padStart(2, '0');
    var vus = {};
    (vue.samedis || []).forEach(function (sm) {
      var d = String(sm.date_samedi || sm).slice(0, 10);
      vus[d] = true;
    });
    return Object.keys(vus).filter(function (d) {
      /* Le samedi du mois, ou celui du 1er jour du mois suivant qui prolonge
         la dernière semaine de congé du mois affiché. */
      if (d.slice(0, 7) === cle) return true;
      var veille = new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1,
        Number(d.slice(8, 10)) - 1)).toISOString().slice(0, 10);
      return veille.slice(0, 7) === cle;
    }).sort();
  }

  function encartCongesUtile() {
    var r = vue.entree && vue.entree.resultat;
    if (!r) return false;
    if ((r.joursCongesDecomptes || 0) > 0) return true;
    /* Des journées de congé posées sans décompte — un mois entier de congé
       à cheval, par exemple — méritent l'explication autant que les autres. */
    var j = joursConge();
    return !!(j && j.length);
  }

  /* §6.3 — UNE SEULE SOURCE, ET PAS HUIT. La phrase vivait ici, recopiée
     ailleurs. Elle vit maintenant dans `js/ui-kit.js`, et le document à
     l'écran, le texte à copier et l'image la lisent tous les trois au même
     endroit. `UiDocument.ENCART_RG06` reste exporté : c'est ce que lisent les
     tests, et le document reste le lieu où la phrase compte le plus. */
  var ENCART_RG06 = Kit.ENCART_RG06;

  /* ------------------------------------------------------------------ */
  /* Rendu écran                                                         */
  /* ------------------------------------------------------------------ */

  function rendre(corps) {
    var e = vue.entree;
    var id = identite();
    /* Correction B2 (relecture lot 6). Un barème dont le net vaut 0 est un
       barème PRÉSENT : le moteur ne signale rien, `salaireManquant` est faux,
       et le document part avec un total amputé du salaire entier — 85,00 € au
       lieu de 1 157,50 €. Comme le document est immuable, le mois serait faux
       pour toujours sur la pièce remise aux parents. L'alerte du lot 5 est
       rétablie, et la clôture refusée tant que le net est inconnu. */
    var netManquant = !e.salaireManquant && !e.resultat.salaireNetCentimes;

    if (e.salaireManquant) {
      corps.appendChild(Kit.warnbox('Aucune rémunération connue pour ce mois',
        'Le document est incomplet : les montants resteront à zéro tant qu’aucun barème ' +
        'n’est enregistré dans la fiche contrat. Ce mois ne peut pas être clôturé.'));
    } else if (netManquant) {
      corps.appendChild(Kit.warnbox('Ce récapitulatif est incomplet : le net n’est pas renseigné',
        'Le total à verser ci-dessous ne contient que l’indemnité d’entretien, sans le salaire. ' +
        'Le net figure sur la fiche de paie du mois : renseignez-le dans la fiche contrat. ' +
        'Ce mois ne peut pas être clôturé tant qu’il manque.'));
    }

    /* LOT 16 §16.2 — L'ENCART ACTIONNABLE. Tant que le nom n'est pas saisi, le
       document se signe « votre assistante maternelle ». C'est correct, mais
       ce n'est pas ce que Maria veut remettre à une famille : on le lui dit,
       avec le chemin pour y remédier. Rien de bloquant.
       Sur un mois déjà clôturé, on se tait : son document ne changera plus. */
    if (!e.fige && global.App.emettriceAsaisir && global.App.emettriceAsaisir()) {
      var enc = Kit.note('Ce document n’est pas encore signé à votre nom',
        'Il indique « votre assistante maternelle ». Renseignez votre nom pour qu’il ' +
        'dise qui l’a établi — c’est ce qui le rend opposable en cas de désaccord.');
      var bNom = Kit.bouton('btn nt', function () { global.App.aller('compte', {}); });
      bNom.textContent = 'Renseigner mon nom';
      enc.appendChild(bNom);
      corps.appendChild(enc);
    }

    corps.appendChild(documentHtml(id));

    if (e.fige) {
      corps.appendChild(Kit.note('Mois clôturé' + (e.recap && e.recap.fige_le ? ' le ' + Kit.dateLongue(e.recap.fige_le) : ''),
        'Les chiffres de ce mois ne bougeront plus, même si un salaire change plus tard.'));
      /* Lot 13 : la porte de réouverture, et l'historique qui la rend
         acceptable. Les deux vont toujours ensemble. */
      if (global.UiReouverture && e.recap) {
        global.UiReouverture.actionsMoisCloture(corps, {
          contrat: vue.contrat, annee: vue.annee, mois: vue.mois, recap: e.recap
        });
      }
      corps.appendChild(sectionPartage());
      return;
    }

    if (e.avantInitialisation) {
      corps.appendChild(Kit.warnbox('Ce mois ne peut pas être clôturé',
        'Il est antérieur à la reprise de vos compteurs : les soldes y repartent de zéro. ' +
        'Le document reste consultable et partageable.'));
      corps.appendChild(sectionPartage());
      return;
    }

    if (vue.lectureSeule) {
      corps.appendChild(Kit.note('Ancien contrat — lecture seule',
        'Ce contrat est rangé : ses mois ne se clôturent plus. Le document reste disponible.'));
      corps.appendChild(sectionPartage());
      return;
    }

    /* Un mois à venir n'a pas été travaillé : il n'y a rien à verrouiller. */
    var maintenant = global.App.moisCourant();
    var aVenir = Chaine.cmpMois(vue.annee, vue.mois, maintenant.annee, maintenant.mois) > 0;

    if (aVenir) {
      corps.appendChild(Kit.warnbox('Mois à venir',
        'Il ne se clôture qu’une fois passé. Les chiffres ci-dessus sont une projection.'));
      corps.appendChild(sectionPartage());
      return;
    }

    /* LOT 16 §16.1 c) — LA CLÔTURE EST BLOQUÉE tant qu'une répartition ne
       tient pas. Le mois se calcule (il se replie sur l'ordre par défaut du
       contrat), mais le figer reviendrait à remettre à la famille un document
       qui ne reflète pas ce que Maria avait choisi — et un mois clôturé ne se
       recalcule jamais. Le blocage vit ici, dans l'écran : il disparaît de
       lui-même dès que les réserves suffisent, sans rien écrire en base. */
    var ecartees = (e.imputationsEcartees || []);
    if (ecartees.length) {
      corps.appendChild(Kit.warnbox(
        'Corrigez d’abord la répartition du congé ' +
        minuscule(Kit.libellePeriode(ecartees[0].date_debut, ecartees[0].date_fin)),
        ' Ce mois ne peut pas être clôturé tant que les jours ne sont pas répartis ' +
        'sur des réserves suffisantes.'));
      var bCorriger = Kit.bouton('btn', function () {
        global.App.aller('conges', {
          annee: vue.annee, mois: vue.mois, corrigerImputation: ecartees[0].id
        }, true);
      });
      bCorriger.textContent = 'Corriger la répartition';
      corps.appendChild(bCorriger);
      corps.appendChild(sectionPartage());
      return;
    }

    if (!e.salaireManquant && !netManquant) {
      var b = Kit.bouton('btn', demanderCloture);
      b.textContent = 'Clôturer le mois';
      corps.appendChild(b);
      /* LOT 16 §16.3 — L'ÉCRAN DISAIT LE CONTRAIRE DE LA FEUILLE DE
         CONFIRMATION, deux clics plus loin, et c'est elle qui avait raison :
         la réouverture existe depuis le lot 13. Une application qui fait
         croire à Maria qu'elle joue son mois sur un clic lui fait redouter le
         seul geste qu'elle doit faire chaque mois. */
      corps.appendChild(Kit.warnbox('La clôture verrouille les chiffres du mois',
        'Ils ne bougeront plus, même si un salaire change plus tard. C’est ce qui protège ' +
        'vos comptes en cas de désaccord. Vous pourrez rouvrir ' +
        Kit.libelleMoisAnnee(vue.annee, vue.mois) + ' si vous devez corriger.'));
    } else {
      var bFiche = Kit.bouton('btn', function () {
        global.App.aller('fiche', { contratId: vue.contrat.id });
      });
      bFiche.textContent = 'Compléter la rémunération';
      corps.appendChild(bFiche);
    }
    corps.appendChild(sectionPartage());
  }

  /* « Corrigez d'abord la répartition du congé du 3 au 21 août » : le libellé
     de période commence par une majuscule, il est ici au milieu d'une phrase. */
  function minuscule(t) { return t ? t.charAt(0).toLowerCase() + t.slice(1) : t; }

  function documentHtml(id) {
    var doc = Kit.ce('div', 'doc');
    var dh = Kit.ce('div', 'dh');
    /* LOT 7 — Le document devient AUTO-PORTANT : lisible seul, hors contexte,
       des mois plus tard. Un parent qui rouvre ce papier en février doit
       pouvoir dire de qui il vient, pour quel enfant, sur quelle période, sans
       rien d'autre sous les yeux. L'en-tête portait le prénom et le mois ; il
       lui manquait l'auteur et les dates exactes. */
    dh.appendChild(Kit.ce('div', 't1',
      /* CORRECTION RELECTURE LOT 16 (C2) — le §16.6 demandait de chercher les
         AUTRES occurrences. Celle-ci est sur le titre du document remis à la
         famille : « Récapitulatif de Elliot ». La maquette écran 4 écrit bien
         « Récapitulatif d'Elliot ». */
      'Récapitulatif ' + Kit.elider('de', id.prenom) + ' — ' +
      Kit.libelleMoisAnnee(vue.annee, vue.mois)));
    dh.appendChild(Kit.ce('div', 't2', enTeteAuteur()));
    dh.appendChild(Kit.ce('div', 't3', enTetePeriode(id)));
    doc.appendChild(dh);

    /* Bandeau de statut : un document provisoire ne se présente jamais comme
       définitif. C'est le défaut central que le lot 7 corrige. */
    var fige = vue.entree.fige;
    var st = Kit.ce('div', 'dstat ' + (fige ? 'def' : 'prov'),
      fige ? 'Document définitif' : 'Document provisoire');
    doc.appendChild(st);

    blocs().forEach(function (b) {
      if (b.titre) doc.appendChild(Kit.ce('div', 'ds', b.titre));
      b.lignes.forEach(function (l) {
        var o = l[2] || {};
        var dl = Kit.ce('div', 'dl' + (o.total ? ' tt' : ''));
        if (o.doux) dl.style.color = '#6b6659';
        dl.appendChild(Kit.ce('span', null, l[0]));
        dl.appendChild(Kit.ce('span', null, l[1]));
        doc.appendChild(dl);
      });
    });

    if (encartCongesUtile()) {
      var dn = Kit.ce('div', 'dn');
      dn.appendChild(Kit.ce('b', null, 'Décompte des congés. '));
      dn.appendChild(document.createTextNode(ENCART_RG06));
      doc.appendChild(dn);
    }
    return doc;
  }

  function sectionPartage() {
    var bloc = Kit.ce('div');
    bloc.appendChild(Kit.section('Partager — si vous le souhaitez'));

    /* LOT 7 — APERÇU DU TEXTE À COLLER (§6.6). Le bouton « Copier » agissait à
       l'aveugle : Maria collait dans son application de messages sans avoir
       jamais vu ce qu'elle envoyait. Le texte est désormais affiché EN CLAIR
       et sélectionnable — ce qui règle du même coup l'échec de copie, puisque
       le texte reste sous les yeux et se sélectionne à la main. */
    bloc.appendChild(Kit.section('Le message que vous allez coller'));
    var apercu = Kit.ce('pre', 'apercu-texte', texte());
    apercu.setAttribute('tabindex', '0');
    bloc.appendChild(apercu);

    var bTexte = Kit.bouton('btn nt', function () { copier(bTexte, apercu); });
    bTexte.textContent = 'Copier le texte';
    bloc.appendChild(bTexte);

    var bImage = Kit.bouton('btn nt', function () { enregistrerImage(bImage); });
    bImage.textContent = 'Enregistrer en image';
    bloc.appendChild(bImage);

    bloc.appendChild(Kit.ce('p', 'sb q',
      'L’envoi aux parents est facultatif : le document reste disponible ici à tout moment.'));

    bloc.appendChild(caseTransmis());
    return bloc;
  }

  /* Le message d'échec est posé par Kit, une seule fois pour toute
     l'application. Ce qui se joue ICI, c'est de ramener l'aperçu sous les yeux
     de Maria : lui dire « le texte reste affiché » sans le lui montrer ne sert
     à rien si elle a fait défiler l'écran. */
  function copier(bouton, apercu) {
    Kit.copierTexte(texte()).catch(function () {
      if (apercu && apercu.scrollIntoView) apercu.scrollIntoView({ block: 'center' });
    });
  }

  /* LOT 7 — « Transmis à la famille » (§6.6, V8-30).

     COCHER NE CLÔTURE PAS, ET CLÔTURER NE COCHE PAS. Ce sont deux gestes
     indépendants, et les coupler — même « logiquement », même « ça va de
     soi » — casserait le cas réel : Maria clôture le 31 et transmet le 3 du
     mois suivant. Piège n° 6 de la spécification.

     La case ne se DÉCOCHE pas. Si Maria s'est trompée, c'est l'historique du
     mois (lot 13) qui fait foi : un événement écrit ne s'efface pas, on lui en
     ajoute un autre. */
  function caseTransmis() {
    var bloc = Kit.ce('div', 'transmis');
    var recap = vue.entree.recap;
    var id = identite();
    var nomFamille = id.famille ? 'famille ' + id.famille : 'la famille';

    if (!recap) {
      /* Rien n'est encore enregistré pour ce mois : il n'y a pas de ligne à
         horodater. On le dit plutôt que d'afficher une case sans effet. */
      bloc.appendChild(Kit.ce('p', 'sb q',
        'La transmission pourra être notée une fois le mois enregistré.'));
      return bloc;
    }

    if (recap.transmis_le) {
      bloc.appendChild(coche(true,
        'Transmis à la ' + nomFamille, 'le ' + dateHeure(recap.transmis_le)));
      return bloc;
    }

    var b = Kit.bouton('coche', function () { marquer(b, bloc, nomFamille); });
    b.appendChild(Kit.ce('span', 'bx', '☐'));
    b.appendChild(Kit.ce('span', 'tx', 'Transmis à la ' + nomFamille));
    bloc.appendChild(b);
    return bloc;
  }

  function coche(cochee, libelle, quand) {
    var d = Kit.ce('div', 'coche' + (cochee ? ' on' : ''));
    d.appendChild(Kit.ce('span', 'bx', cochee ? '☑' : '☐'));
    var tx = Kit.ce('span', 'tx', libelle);
    if (quand) tx.appendChild(Kit.ce('small', null, ' — ' + quand));
    d.appendChild(tx);
    return d;
  }

  function marquer(bouton, bloc, nomFamille) {
    bouton.disabled = true;
    global.DB.marquerTransmis(vue.contrat.id, vue.annee, vue.mois)
      .then(function (r) {
        global.App.invalider();
        if (vue.entree.recap && r && r.transmis_le) vue.entree.recap.transmis_le = r.transmis_le;
        Kit.vider(bloc);
        bloc.appendChild(coche(true, 'Transmis à la ' + nomFamille,
          r && r.transmis_le ? 'le ' + dateHeure(r.transmis_le) : 'à l’instant'));
        Kit.toast('La transmission est notée. Le mois n’a pas été modifié.');
      })
      .catch(function (e) {
        bouton.disabled = false;
        Kit.toast('La transmission n’a pas été notée. ' + Kit.messageErreur(e) +
          ' Vous pouvez réessayer.', true);
      });
  }

  /* ------------------------------------------------------------------ */
  /* Texte à copier                                                      */
  /* ------------------------------------------------------------------ */

  function texte() {
    var id = identite();
    var lignes = [id.prenom + ' — ' + Kit.libelleMoisAnnee(vue.annee, vue.mois)];
    lignes.push('Récapitulatif mensuel' + (id.famille ? ' · famille ' + id.famille : ''));
    blocs().forEach(function (b) {
      lignes.push('');
      if (b.titre) lignes.push(b.titre.toUpperCase());
      b.lignes.forEach(function (l) { lignes.push(l[0] + ' : ' + l[1]); });
    });
    if (encartCongesUtile()) {
      lignes.push('');
      lignes.push('Décompte des congés. ' + ENCART_RG06);
    }
    /* DÉCISION D'ADRIEN — la longue parenthèse « Mois non encore clôturé : ces
       chiffres peuvent encore changer » est retirée.

       ELLE N'EST PAS SUPPRIMÉE POUR AUTANT, et voici pourquoi. À l'écran, le
       bandeau « Document provisoire » le dit déjà. Mais le texte et l'image
       SORTENT de l'application : ce sont eux qui arrivent chez la famille, et
       ils ne portent aucun autre repère. Les vider entièrement recréerait le
       défaut A11, corrigé au lot 7 — un récapitulatif envoyé avant clôture
       devenait indiscernable d'un définitif.
       La mention passe donc de deux lignes à quatre mots, en tête plutôt qu'en
       pied : elle se lit d'un coup d'œil et n'alourdit plus la fin. */
    if (!vue.entree.fige) {
      lignes.splice(2, 0, 'Document provisoire');
    }
    return lignes.join('\n');
  }

  /* ------------------------------------------------------------------ */
  /* Image                                                               */
  /* ------------------------------------------------------------------ */

  /* Le document est redessiné dans un canvas avec la même identité papier
     (fond crème, Georgia, filet bleu). Pas de bibliothèque, pas de capture
     d'écran : le rendu est piloté par les MÊMES blocs que l'écran et le texte. */
  function dessiner() {
    var id = identite();
    var L = 820, marge = 52, ligneH = 46, titreH = 34;
    var groupes = blocs();

    var hauteur = marge + 96;                       // en-tête
    groupes.forEach(function (b) {
      if (b.titre) hauteur += titreH;
      hauteur += b.lignes.length * ligneH + 10;
    });
    hauteur += 180 + 30;                            // encart RG-06, mention provisoire, marge

    var canvas = document.createElement('canvas');
    canvas.width = L;
    canvas.height = hauteur;
    var g = canvas.getContext('2d');
    if (!g) throw new Error('canvas indisponible');

    g.fillStyle = '#fffdf8';
    g.fillRect(0, 0, L, hauteur);

    var y = marge + 12;
    g.fillStyle = '#2b2a26';
    g.font = 'bold 34px Georgia, "Times New Roman", serif';
    g.fillText(id.prenom + ' — ' + Kit.libelleMoisAnnee(vue.annee, vue.mois), marge, y);
    y += 30;
    g.fillStyle = '#6b6659';
    g.font = '20px -apple-system, Helvetica, Arial, sans-serif';
    g.fillText('Récapitulatif mensuel' + (id.famille ? ' · famille ' + id.famille : ''), marge, y);
    y += 22;
    g.strokeStyle = '#1f4f7a';
    g.lineWidth = 3;
    g.beginPath(); g.moveTo(marge, y); g.lineTo(L - marge, y); g.stroke();
    y += 34;

    groupes.forEach(function (b) {
      if (b.titre) {
        g.fillStyle = '#8a8371';
        g.font = 'bold 17px -apple-system, Helvetica, Arial, sans-serif';
        g.fillText(b.titre.toUpperCase(), marge, y);
        y += titreH - 8;
      }
      b.lignes.forEach(function (l) {
        var o = l[2] || {};
        if (o.total) {
          g.strokeStyle = '#2b2a26'; g.lineWidth = 3;
          g.beginPath(); g.moveTo(marge, y - 24); g.lineTo(L - marge, y - 24); g.stroke();
        }
        g.fillStyle = o.doux ? '#6b6659' : '#2b2a26';
        g.font = (o.total ? 'bold ' : '') + '24px Georgia, "Times New Roman", serif';
        g.textAlign = 'left';
        g.fillText(l[0], marge, y);
        g.textAlign = 'right';
        g.font = 'bold 24px Georgia, "Times New Roman", serif';
        g.fillText(l[1], L - marge, y);
        g.textAlign = 'left';
        y += ligneH - 14;
        if (!o.total) {
          g.strokeStyle = '#e3dcca'; g.lineWidth = 1;
          g.beginPath(); g.moveTo(marge, y); g.lineTo(L - marge, y); g.stroke();
        }
        y += 14;
      });
      y += 10;
    });

    if (encartCongesUtile()) {
      g.fillStyle = '#f4f1e6';
      g.fillRect(marge, y - 6, L - 2 * marge, 132);
      g.strokeStyle = '#e3dcca'; g.lineWidth = 1;
      g.strokeRect(marge, y - 6, L - 2 * marge, 132);
      g.fillStyle = '#5d5747';
      g.font = 'bold 19px -apple-system, Helvetica, Arial, sans-serif';
      g.fillText('Décompte des congés', marge + 18, y + 26);
      g.font = '19px -apple-system, Helvetica, Arial, sans-serif';
      habiller(g, ENCART_RG06, marge + 18, y + 54, L - 2 * marge - 36, 26);
      y += 138;
    }

    /* Correction A11, CONSERVÉE sous une forme plus courte. L'image ne porte
       aucun autre repère que celui-ci : la vider ferait d'un PNG envoyé avant
       clôture l'exact sosie d'un définitif. Deux mots suffisent. */
    if (!vue.entree.fige) {
      g.fillStyle = '#a34e00';
      g.font = 'bold 20px -apple-system, Helvetica, Arial, sans-serif';
      g.fillText('Document provisoire', marge, y + 30);
    }

    return canvas;
  }

  /* Découpe un paragraphe en lignes qui tiennent dans `largeur`. */
  function habiller(g, texteBrut, x, y, largeur, interligne) {
    var mots = texteBrut.split(' ');
    var ligne = '';
    for (var i = 0; i < mots.length; i++) {
      var essai = ligne ? ligne + ' ' + mots[i] : mots[i];
      if (g.measureText(essai).width > largeur && ligne) {
        g.fillText(ligne, x, y);
        y += interligne;
        ligne = mots[i];
      } else {
        ligne = essai;
      }
    }
    if (ligne) g.fillText(ligne, x, y);
  }

  function nomFichier() {
    var id = identite();
    return 'recap-' + sansAccent(id.prenom) + '-' +
      sansAccent(Kit.libelleMois(vue.mois)) + '-' + vue.annee + '.png';
  }
  function sansAccent(s) {
    return String(s || '').normalize ? String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
                                     : String(s).toLowerCase();
  }

  function enregistrerImage(bouton) {
    var canvas;
    try { canvas = dessiner(); }
    catch (e) {
      Kit.toast('Image impossible à produire sur cet appareil. Utilisez « Copier le texte ».', true);
      return;
    }
    bouton.disabled = true;
    var fini = function () { bouton.disabled = false; };

    canvas.toBlob(function (blob) {
      if (!blob) { Kit.toast('Image impossible à produire.', true); fini(); return; }
      var fichier = null;
      try { fichier = new File([blob], nomFichier(), { type: 'image/png' }); } catch (e) { fichier = null; }

      /* Sur téléphone, le partage natif enregistre dans les photos ou envoie
         directement — sans aucune intégration WhatsApp de notre côté. */
      if (fichier && global.navigator && global.navigator.canShare &&
          global.navigator.canShare({ files: [fichier] }) && global.navigator.share) {
        global.navigator.share({ files: [fichier] })
          .then(function () { Kit.toast('Image partagée'); })
          .catch(function () { telecharger(blob); })
          .then(fini, fini);
        return;
      }
      telecharger(blob);
      fini();
    }, 'image/png');
  }

  function telecharger(blob) {
    try {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = nomFichier();
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      Kit.toast('Image enregistrée');
    } catch (e) {
      Kit.toast('Enregistrement de l’image impossible. Utilisez « Copier le texte ».', true);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Clôture                                                             */
  /* ------------------------------------------------------------------ */

  function demanderCloture() {
    var id = identite();
    Kit.ouvrirFeuille('Clôturer ' + Kit.libelleMoisAnnee(vue.annee, vue.mois) + ' ?',
      id.prenom + (id.famille ? ' — famille ' + id.famille : ''),
      function (corps) {
        /* Lot 13 : la clôture n'est plus définitive, elle est réversible par
           un geste tracé. Le texte le dit — promettre l'irréversible alors
           qu'un bouton la défait ferait douter de tout le reste. */
        corps.appendChild(Kit.warnbox('La clôture verrouille le mois',
          'Après clôture, les chiffres ne bougent plus. Vérifiez vos journées avant de continuer. ' +
          'Vous pourrez rouvrir ce mois si vous devez corriger : la réouverture sera inscrite ' +
          'dans son historique. Le partage aux parents, lui, reste possible à tout moment.'));
        /* LOT 7 (V8-04) — CLÔTURE D'UN MOIS NON ÉCHU.
           Elle reste possible : le dernier jour ouvré du mois est un cas
           parfaitement légitime, et l'interdire ferait perdre à Maria le seul
           moment où elle a le temps. Mais elle ne se fait plus en silence.
           Le mois d'août clôturé le 20, ce sont sept journées travaillées qui
           disparaissent d'un document remis à une famille — et le mois ne se
           recalcule jamais après coup (RG-15). */
        /* A3 : les journées, pour que les congés déjà posés ne soient pas
           comptés comme des jours encore à travailler. C'est ici que le
           chiffre compte le plus — il mesure ce qu'on s'apprête à perdre. */
        var restants = Kit.joursTravaillesRestants(
          vue.contrat, planningDuMois(), vue.annee, vue.mois,
          global.App.aujourdhui(), vue.journees);
        if (restants > 0) {
          corps.appendChild(Kit.warnbox(
            restants + (restants > 1 ? ' jours travaillés sont encore à venir'
                                     : ' jour travaillé est encore à venir') +
              ' en ' + Kit.libelleMois(vue.mois) + '.',
            ' Si vous clôturez maintenant, ' +
            (restants > 1 ? 'ces journées ne seront pas comptées.'
                          : 'cette journée ne sera pas comptée.')));
        }

        var l = Kit.lines(corps);
        var r = vue.entree.resultat;
        Kit.ligne(l, 'Jours de présence', Kit.jours(r.joursPresence));
        Kit.ligne(l, 'Total à verser', Kit.eur(r.totalAVerserCentimes), { total: true });

        var b = Kit.bouton('btn', function () { verifierPuisCloturer(b); });
        /* Le libellé change avec la situation : « quand même » n'a de sens que
           s'il y a un avertissement au-dessus. */
        b.textContent = restants > 0 ? 'Clôturer quand même' : 'Oui, clôturer le mois';
        corps.appendChild(b);

        var bAnnuler = Kit.bouton('btn nt', function () { Kit.fermerFeuille(); });
        bAnnuler.textContent = 'Annuler';
        corps.appendChild(bAnnuler);
      });
  }

  /* Reclôture d'un mois qui avait déjà été clôturé une fois : avant d'écrire
     le nouvel instantané, on compare poste à poste avec l'ancien.

     Le résultat peut différer pour deux raisons — une journée corrigée, ou un
     barème changé entre-temps. Le second cas est le dangereux : sans cet
     écran, rouvrir puis refermer un mois après une revalorisation modifierait
     en silence un document déjà chez un parent.

     Aucun écart, ou mois jamais clôturé : on clôture directement, sans écran
     intermédiaire. */
  function verifierPuisCloturer(bouton) {
    var snap = instantane();
    var ecarts = global.UiReouverture
      ? global.UiReouverture.ecarts(vue.entree.recap, snap)
      : [];

    if (!ecarts.length) return cloturer(bouton, snap);

    global.UiReouverture.feuilleEcarts({
      contrat: vue.contrat, annee: vue.annee, mois: vue.mois,
      recap: vue.entree.recap, ecarts: ecarts,
      /* LOT 17 §17.6 — le facteur d'affichage des congés payés, celui du mois
         rouvert. L'écran des écarts compare deux instantanés du MÊME mois :
         un seul facteur, celui de ses conditions. */
      minutesParJourConge: reg('minutes_par_jour_conge', 0),
      confirmer: function (b) { cloturer(b, snap); }
    });
  }

  /* L'instantané enregistré : le ResultatMois du moteur, plus ce que le moteur
     ne connaît pas et qui doit pourtant rester figé — le prénom et le nom de
     famille (acquis du lot 5), la date d'effet du barème appliqué, et la liste
     des jours de congé du mois (lot 6, pour que le document affiche les mêmes
     dates avant et après la clôture). Le moteur n'est pas touché. */
  function instantane() {
    return construireInstantane({
      entree: vue.entree, contrat: vue.contrat, journees: vue.journees,
      annee: vue.annee, mois: vue.mois
    });
  }

  /* CORRECTIF B4 DE LA RELECTURE PR9 — UN SEUL CONSTRUCTEUR D'INSTANTANÉ.

     Il y avait deux chemins de clôture et deux instantanés différents. Celui-ci
     enrichissait le résultat du moteur ; la fin de mois guidée du lot 7
     envoyait `entree.resultat` brut. Un mois clôturé par le parcours guidé
     perdait donc son prénom figé, son nom de famille, la date d'effet de son
     barème et la liste datée de ses jours de congé.

     Conséquence concrète : Maria clôture juillet par le parcours guidé, corrige
     plus tard le prénom de l'enfant ou le nom du foyer, rouvre le document de
     juillet et le renvoie aux parents — il porte le nom d'AUJOURD'HUI, et la
     liste des jours de congé a disparu. Un document déjà remis se réécrivait
     tout seul. C'est très exactement ce que la fin de mois guidée devait
     supprimer.

     La fonction est PURE et EXPORTÉE : les deux chemins l'appellent, et il
     devient impossible qu'ils divergent de nouveau sans que ce soit visible. */
  function construireInstantane(ctx) {
    var r = ctx.entree.resultat;
    var snap = {};
    Object.keys(r).forEach(function (k) { snap[k] = r[k]; });
    snap.prenomEnfant = ctx.contrat.prenom_enfant;
    snap.nomFamille = (ctx.contrat.famille && ctx.contrat.famille.nom) || null;
    snap.salaireDateEffet = ctx.entree.salaire ? ctx.entree.salaire.date_effet : null;
    /* LOT 16 §16.2 — le nom entre dans l'instantané. Un mois clôturé avant
       toute saisie garde `null` et ne se met JAMAIS à jour tout seul quand le
       nom est renseigné ensuite (critère A2) : il continue d'écrire « votre
       assistante maternelle », comme le jour de sa clôture. */
    snap.nomEmettrice = (global.App.nomEmettrice && global.App.nomEmettrice()) || null;
    snap.joursConge = joursCongeDe(ctx.journees) || [];
    /* A15 : la liste des journées particulières entre enfin dans l'instantané.
       Sans elle, un changement de planning après la clôture réécrivait le
       contenu d'un document déjà remis. */
    snap.journeesParticulieres = journeesParticulieresDe(
      ctx.contrat.prenom_enfant, ctx.contrat,
      (ctx.entree.conditions && ctx.entree.conditions.jours_planning) || null,
      ctx.journees, ctx.annee, ctx.mois);
    /* LOT 17 §17.4 — quelles conditions ont servi à ce mois. Le document doit
       pouvoir le dire des années plus tard, quand l'avenant aura été suivi de
       trois autres. */
    snap.avenantNumero = ctx.entree.conditions ? ctx.entree.conditions.numero : null;
    return snap;
  }

  /* Lot 13 : la clôture passe désormais par `recloturerRecap`, qui écrit
     l'événement « cloture » dans la même transaction. C'est vrai AUSSI de la
     première clôture — sans quoi l'historique d'un mois commencerait par
     « Rouvert », sans jamais dire quand il avait été clôturé.
     L'horodatage est produit par la base : plus d'objet Date ici. */
  function cloturer(bouton, snap) {
    bouton.disabled = true;
    global.DB.recloturerRecap(vue.contrat.id, vue.annee, vue.mois, snap || instantane())
      .then(function (ligne) {
        global.App.invalider();
        Kit.fermerFeuille();
        if (!ligne) {
          /* Le mois était déjà clôturé ailleurs (deuxième téléphone, second
             onglet). Cette branche était INATTEIGNABLE avant la correction A7
             de db.js : l'upsert du brouillon partait en premier et le trigger
             d'immuabilité le rejetait, si bien que Maria lisait « rien n'a été
             verrouillé » sur un mois pourtant bel et bien clôturé. */
          Kit.toast('Ce mois était déjà clôturé — depuis un autre appareil, sans doute.');
        } else {
          Kit.toast('Mois de ' + vue.contrat.prenom_enfant + ' clôturé');
        }
        return global.App.rafraichir();
      })
      .catch(function (e) {
        bouton.disabled = false;
        Kit.toast('Clôture impossible : ' + Kit.messageErreur(e) + ' Rien n’a été verrouillé.', true);
      });
  }

  global.UiDocument = {
    afficher: afficher,
    ENCART_RG06: ENCART_RG06,
    /* Exporté pour la fin de mois guidée (correctif B4). Un seul constructeur
       d'instantané dans tout le projet, quel que soit le chemin de clôture. */
    construireInstantane: construireInstantane
  };
})(window);
