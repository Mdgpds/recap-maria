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

  function charger(ctx, contrat, m) {
    if (!contrat) throw new Error('contrat introuvable');

    global.App.barreRetour(ctx.barre,
      'Récap de ' + Kit.libelleMois(m.mois), { droite: contrat.prenom_enfant });
    ctx.corps.appendChild(Kit.ce('div', 'attente', 'Préparation du document…'));

    return Promise.all([
      global.App.serie(contrat, m),
      global.App.journees(contrat.id, m.annee, m.mois)
    ]).then(function (r) {
      var entree = global.App.moisDe(r[0], m.annee, m.mois);
      if (!entree) throw new Error('mois hors du contrat');
      vue = {
        contrat: contrat, annee: m.annee, mois: m.mois,
        entree: entree, journees: r[1],
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
    return Object.keys(vue.journees).filter(function (d) {
      return vue.journees[d].type === 'conge_maria';
    }).sort();
  }

  /* Le document, sous forme de blocs. Chaque bloc : { titre, lignes }. */
  function blocs() {
    var r = vue.entree.resultat;
    var imp = r.imputation || {};
    var cs = r.compteurSortie || {};
    var conges = joursConge();
    var out = [];

    var principal = [
      ['Jours de présence', Kit.jours(r.joursPresence)],
      /* LOT 7 — l'entretien est DÉTAILLÉ, jamais donné en bloc. « 70,00 € »
         seul n'est pas vérifiable ; « 14 jours × 5,00 € » l'est, et c'est ce
         qui éteint une contestation avant qu'elle ne naisse. */
      [libelleEntretienDetaille(r), Kit.eur(r.entretienCentimes)],
      ['Salaire net', Kit.eur(r.salaireNetCentimes)],
      ['Salaire brut correspondant', Kit.eur(r.salaireBrutCentimes), { doux: true }]
    ];
    if (r.retenueSansSoldeCentimes > 0) {
      principal.push(['Retenue pour jour(s) sans solde', '−' + Kit.eur(r.retenueSansSoldeCentimes)]);
    }
    principal.push(['Total à verser', Kit.eur(r.totalAVerserCentimes), { total: true }]);
    out.push({ titre: null, lignes: principal });

    var lignesConge = [];
    if (conges && conges.length) {
      conges.forEach(function (d) { lignesConge.push([Kit.jourLong(d), '1 jour']); });
    }
    if (r.joursCongesDecomptes > 0) {
      lignesConge.push(['Décompte en jours ouvrables', r.joursCongesDecomptes + ' j']);
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
    if (r.minutesSupRenoncees > 0) {
      out.push({
        titre: null,
        lignes: [['Heures supplémentaires du mois', Kit.heures(r.minutesSupAcquises)],
                 ['Dont ' + Kit.heures(r.minutesSupRenoncees) +
                  ' auxquelles j’ai choisi de renoncer ce mois-ci', '', { doux: true }]]
      });
    }

    out.push({
      titre: 'Compteurs de ce contrat à la fin du mois',
      lignes: [
        ['Heures supplémentaires acquises dans le mois', Kit.heures(r.minutesSupAcquises)],
        ['Récupération restante', Kit.heures(cs.minutesSup || 0)],
        ['Congés payés restants', Kit.joursCp(Kit.cpDisponible(cs))]
      ]
    });
    return out;
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
    var parJour = vue.contrat.entretien_centimes_jour || 0;
    if (parJour > 0 && r.joursPresence * parJour === r.entretienCentimes) {
      return 'Indemnité d’entretien — ' + r.joursPresence + ' jours × ' + Kit.eur(parJour);
    }
    return 'Indemnité d’entretien';
  }

  /* L'auteur du document. Le nom vient du compte : c'est la seule identité que
     l'application connaisse. Sans lui, un document retrouvé des mois plus tard
     ne dit pas de qui il vient.
     // TODO RÈGLE ABSENTE : ni le nom complet ni le numéro d'agrément de
     // l'assistante maternelle n'existent en base. À reprendre au lot 14
     // (mise en service), qui écrit les informations d'installation. */
  function enTeteAuteur() {
    var qui = global.App.email && global.App.email();
    return 'Établi par ' + (qui ? qui : 'votre assistante maternelle') +
      ', assistante maternelle';
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

    var out = [];
    Object.keys(vue.journees || {}).sort().forEach(function (d) {
      var t = vue.journees[d].type;
      if (t === 'presence') return;
      var f = LIBELLE_ECART[t];
      if (!f) return;
      out.push({ date: d, quoi: f(prenom, vue.contrat) });
    });
    /* Les fériés ne sont pas saisis : ils viennent du calendrier. Ils comptent
       pourtant parmi les journées où l'enfant n'était pas là, et un parent qui
       compte ses jours doit les retrouver. */
    Kit.joursPlanning(vue.contrat, vue.annee, vue.mois).forEach(function (d) {
      if ((vue.journees || {})[d]) return;
      if (!Feries.estJourFerie(d)) return;
      out.push({ date: d, quoi: 'férié' });
    });
    return out.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  }

  /* Encart permanent de RG-06 : c'est lui qui doit éteindre le désaccord
     historique sur le décompte des congés. Il figure sur TOUS les documents,
     même ceux sans congé. */
  var ENCART_RG06 =
    'Les congés payés d’une assistante maternelle se comptent en jours ouvrables, ' +
    'du lundi au samedi, dimanches et jours fériés exclus. Une semaine complète compte ' +
    'donc 6 jours, même si je ne travaille pas le samedi.';

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

    if (!e.salaireManquant && !netManquant) {
      var b = Kit.bouton('btn', demanderCloture);
      b.textContent = 'Clôturer le mois';
      corps.appendChild(b);
      corps.appendChild(Kit.warnbox('La clôture verrouille le mois',
        'Après clôture, plus aucune modification n’est possible sur ' +
        Kit.libelleMoisAnnee(vue.annee, vue.mois) + '. C’est ce qui protège vos comptes ' +
        'en cas de désaccord.'));
    } else {
      var bFiche = Kit.bouton('btn', function () {
        global.App.aller('fiche', { contratId: vue.contrat.id });
      });
      bFiche.textContent = 'Compléter la rémunération';
      corps.appendChild(bFiche);
    }
    corps.appendChild(sectionPartage());
  }

  function documentHtml(id) {
    var doc = Kit.ce('div', 'doc');
    var dh = Kit.ce('div', 'dh');
    /* LOT 7 — Le document devient AUTO-PORTANT : lisible seul, hors contexte,
       des mois plus tard. Un parent qui rouvre ce papier en février doit
       pouvoir dire de qui il vient, pour quel enfant, sur quelle période, sans
       rien d'autre sous les yeux. L'en-tête portait le prénom et le mois ; il
       lui manquait l'auteur et les dates exactes. */
    dh.appendChild(Kit.ce('div', 't1',
      'Récapitulatif de ' + id.prenom + ' — ' + Kit.libelleMoisAnnee(vue.annee, vue.mois)));
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

    var dn = Kit.ce('div', 'dn');
    dn.appendChild(Kit.ce('b', null, 'Décompte des congés. '));
    dn.appendChild(document.createTextNode(ENCART_RG06));
    doc.appendChild(dn);
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
    lignes.push('');
    lignes.push('Décompte des congés. ' + ENCART_RG06);
    if (!vue.entree.fige) {
      lignes.push('');
      lignes.push('(Mois non encore clôturé : ces chiffres peuvent encore changer.)');
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

    g.fillStyle = '#f4f1e6';
    g.fillRect(marge, y - 6, L - 2 * marge, 132);
    g.strokeStyle = '#e3dcca'; g.lineWidth = 1;
    g.strokeRect(marge, y - 6, L - 2 * marge, 132);
    g.fillStyle = '#5d5747';
    g.font = 'bold 19px -apple-system, Helvetica, Arial, sans-serif';
    g.fillText('Décompte des congés', marge + 18, y + 26);
    g.font = '19px -apple-system, Helvetica, Arial, sans-serif';
    habiller(g, ENCART_RG06, marge + 18, y + 54, L - 2 * marge - 36, 26);

    /* Correction A11 : le texte copié porte la mention « provisoire » sur un
       mois non clôturé, l'image ne la portait pas — un PNG envoyé aux parents
       avant clôture était indiscernable du définitif. */
    if (!vue.entree.fige) {
      g.fillStyle = '#a34e00';
      g.font = 'bold 20px -apple-system, Helvetica, Arial, sans-serif';
      g.fillText('Mois non encore clôturé — ces chiffres peuvent encore changer.',
        marge, y + 168);
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
        var restants = Kit.joursTravaillesRestants(
          vue.contrat, vue.annee, vue.mois, global.App.aujourdhui());
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
      confirmer: function (b) { cloturer(b, snap); }
    });
  }

  /* L'instantané enregistré : le ResultatMois du moteur, plus ce que le moteur
     ne connaît pas et qui doit pourtant rester figé — le prénom et le nom de
     famille (acquis du lot 5), la date d'effet du barème appliqué, et la liste
     des jours de congé du mois (lot 6, pour que le document affiche les mêmes
     dates avant et après la clôture). Le moteur n'est pas touché. */
  function instantane() {
    var r = vue.entree.resultat;
    var snap = {};
    Object.keys(r).forEach(function (k) { snap[k] = r[k]; });
    snap.prenomEnfant = vue.contrat.prenom_enfant;
    snap.nomFamille = (vue.contrat.famille && vue.contrat.famille.nom) || null;
    snap.salaireDateEffet = vue.entree.salaire ? vue.entree.salaire.date_effet : null;
    snap.joursConge = joursConge() || [];
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

  global.UiDocument = { afficher: afficher, ENCART_RG06: ENCART_RG06 };
})(window);
