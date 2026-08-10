/* ============================================================================
   ui-historique.js — Historique des mois et bilan annuel (§2.6 des specs).

   Deux écrans rendus par le même module, parce qu'ils lisent exactement la
   même chaîne de mois :

   - HISTORIQUE : les mois du contrat, groupés par ANNÉE DE BILAN
     (1er septembre → 31 août), du plus récent au plus ancien. Chaque mois
     porte son badge (« clôturé » / « en cours ») et ses deux chiffres clés ;
     le toucher ouvre son document.

   - BILAN ANNUEL : les totaux de l'année et surtout l'ÉVOLUTION des compteurs,
     valeur au 1er septembre → valeur actuelle. Le 31 août n'est pas une
     clôture : rien ne se perd, tout est reporté (RG-12 et RG-12bis). L'écran
     le dit noir sur blanc, parce que c'est précisément la question que Maria
     se pose chaque été.

   Aucun total n'est calculé ici : ChaineMois.agregerPeriode sait déjà ce qui
   s'additionne (les flux) et ce qui ne s'additionne jamais (les compteurs).
   ========================================================================= */
(function (global) {
  'use strict';

  var Kit = global.Kit;
  var Chaine = global.ChaineMois;

  /* Année de bilan d'un mois : septembre ouvre l'exercice suivant. */
  function anneeBilan(annee, mois) { return mois >= 9 ? annee : annee - 1; }
  function libelleAnnee(a) { return a + '-' + (a + 1); }

  function afficher(ctx) {
    /* LOT 8 — l'Historique est désormais un ONGLET RACINE. Ouvert sans
       contrat, il liste les enfants ; ouvert avec un contrat, il montre ses
       mois comme avant. C'est le même module parce que c'est le même sujet :
       « ce qui s'est passé », par opposition à « ce qui se passe ». */
    if (ctx.vue === 'historique' && !ctx.params.contratId) return rendreRacine(ctx);

    var contrat = global.App.contratParId(ctx.params.contratId);
    if (!contrat) {
      return global.App.tousLesContrats().then(function () {
        return charger(ctx, global.App.contratParId(ctx.params.contratId));
      });
    }
    return charger(ctx, contrat);
  }

  /* ------------------------------------------------------------------ */
  /* Onglet racine : une carte par enfant                                */
  /*                                                                     */
  /* Ce que cet écran remplace : une rubrique « Consulter » enfouie dans  */
  /* le Menu, où « Anciens contrats » était une LIGNE DE TEXTE dont le    */
  /* sous-titre énumérait des prénoms. Les contrats terminés y étaient    */
  /* rangés au sens de « cachés ». Or ce sont exactement ceux qu'on vient */
  /* consulter : un mois de 2024 peut être contesté en 2027.             */
  /* ------------------------------------------------------------------ */

  function rendreRacine(ctx) {
    ctx.barre.className = 'bar';
    ctx.barre.appendChild(Kit.ce('span', 'ti', 'Historique'));
    ctx.corps.appendChild(Kit.ce('div', 'attente', 'Lecture de vos contrats…'));

    return global.App.tousLesContrats().then(function (tous) {
      Kit.vider(ctx.corps);
      var liste = (tous || []).slice();

      if (!liste.length) {
        ctx.corps.appendChild(Kit.ce('p', 'vide',
          'Aucun contrat pour l’instant. Ajoutez un enfant depuis le Menu.'));
        ctx.corps.appendChild(boutonPeriode());
        return;
      }

      var enCours = liste.filter(function (c) { return !c.archive; });
      var termines = liste.filter(function (c) { return c.archive; });

      if (enCours.length) {
        ctx.corps.appendChild(Kit.section('Contrats en cours'));
        enCours.forEach(function (c) { ctx.corps.appendChild(carteContrat(c)); });
      }
      if (termines.length) {
        /* Séparés, jamais masqués. « Rangé » ne veut pas dire « perdu ». */
        ctx.corps.appendChild(Kit.section('Contrats terminés'));
        termines.forEach(function (c) { ctx.corps.appendChild(carteContrat(c)); });
      }
      ctx.corps.appendChild(boutonPeriode());
    }).catch(function (e) {
      Kit.vider(ctx.corps);
      ctx.corps.appendChild(Kit.warnbox('Impossible de charger vos contrats.',
        ' ' + Kit.messageErreur(e) + ' Vérifiez votre connexion, puis réessayez.'));
      var b = Kit.bouton('btn pr', function () { global.App.rafraichir(); });
      b.textContent = 'Réessayer';
      ctx.corps.appendChild(b);
    });
  }

  function carteContrat(c) {
    var b = Kit.bouton('big' + (c.archive ? ' off' : ''), function () {
      global.App.aller('historique', { contratId: c.id });
    });
    var top = Kit.ce('div', 'top');
    top.appendChild(Kit.avatar(c));
    var ident = Kit.ce('div');
    ident.appendChild(Kit.ce('div', 'nm', Kit.nomComplet(c)));
    ident.appendChild(Kit.ce('div', 'fm', 'Famille ' + ((c.famille && c.famille.nom) || '—')));
    top.appendChild(ident);
    top.appendChild(Kit.ce('div', 'ar', '›'));
    b.appendChild(top);

    /* Le NOMBRE DE MOIS d'historique se lit sur les dates du contrat, sans
       rien charger : ouvrir l'onglet ne doit pas déclencher un calcul complet
       par enfant. La chaîne des mois, elle, se construit à l'ouverture d'une
       carte — au moment où Maria l'a demandée. */
    b.appendChild(Kit.ce('div', 'sb q', phraseEtendue(c)));
    return b;
  }

  function phraseEtendue(c) {
    var debut = Chaine.moisDeDate(c.date_debut);
    var fin = c.date_fin ? Chaine.moisDeDate(c.date_fin) : global.App.moisCourant();
    var n = Chaine.nbMoisEntre(debut.annee, debut.mois, fin.annee, fin.mois);
    if (n < 1) n = 1;
    var etendue = Kit.libelleMoisAnnee(debut.annee, debut.mois) +
      ' → ' + (c.date_fin ? Kit.libelleMoisAnnee(fin.annee, fin.mois) : 'aujourd’hui');
    return n + ' mois d’historique · ' + etendue;
  }

  function boutonPeriode() {
    var bloc = Kit.ce('div');
    bloc.appendChild(Kit.section('Plusieurs enfants à la fois'));
    var b = Kit.bouton('menu', function () { global.App.aller('periode', {}); });
    var tx = Kit.ce('span');
    tx.appendChild(document.createTextNode('Récapitulatif sur une période'));
    tx.appendChild(Kit.ce('span', 'd', 'Deux dates, un ou plusieurs enfants'));
    b.appendChild(tx);
    b.appendChild(Kit.ce('span', 'ar', '›'));
    bloc.appendChild(b);
    return bloc;
  }

  function charger(ctx, contrat) {
    if (!contrat) throw new Error('contrat introuvable');
    var cible = cibleDe(contrat, ctx.params);

    var estBilan = ctx.vue === 'bilan';
    global.App.barreRetour(ctx.barre, estBilan
      ? 'Année ' + libelleAnnee(ctx.params.anneeBilan) + ' — ' + contrat.prenom_enfant
      : 'Historique — ' + contrat.prenom_enfant);
    ctx.corps.appendChild(Kit.ce('div', 'attente', 'Relecture de vos mois…'));

    return global.App.serie(contrat, cible).then(function (chaine) {
      /* Un mois hors des dates du contrat n'a jamais existé pour ce contrat :
         il est rejoué pour la continuité des compteurs, jamais montré. */
      var mois = (chaine.mois || []).filter(function (e) { return !e.horsContrat; });
      Kit.vider(ctx.corps);
      if (estBilan) rendreBilan(ctx.corps, contrat, mois, ctx.params.anneeBilan);
      else rendreHistorique(ctx.corps, contrat, mois, chaine);
    });
  }

  /* Le dernier mois à montrer : celui d'où l'on vient, ou le mois courant,
     borné à la fin du contrat. */
  function cibleDe(contrat, params) {
    var maintenant = global.App.moisCourant();
    var cible = (params.annee && params.mois) ? { annee: params.annee, mois: params.mois } : maintenant;
    if (contrat.date_fin) {
      var f = Chaine.moisDeDate(contrat.date_fin);
      if (Chaine.cmpMois(f.annee, f.mois, cible.annee, cible.mois) < 0) cible = f;
    }
    if (params.anneeBilan) {
      /* Sur un bilan, il faut au moins couvrir août de l'année demandée. */
      var fin = { annee: params.anneeBilan + 1, mois: 8 };
      if (Chaine.cmpMois(fin.annee, fin.mois, cible.annee, cible.mois) > 0 &&
          Chaine.cmpMois(fin.annee, fin.mois, maintenant.annee, maintenant.mois) <= 0) {
        cible = fin;
      }
    }
    return cible;
  }

  /* ------------------------------------------------------------------ */
  /* Historique                                                          */
  /* ------------------------------------------------------------------ */

  function rendreHistorique(corps, contrat, mois, chaine) {
    if (!mois.length) {
      corps.appendChild(Kit.ce('p', 'vide', 'Aucun mois à afficher pour ce contrat.'));
      return;
    }
    if (chaine.tronquee) {
      corps.appendChild(Kit.warnbox('Historique trop long',
        'Seuls les ' + Chaine.MAX_MOIS + ' derniers mois sont rejoués. ' +
        'Vérifiez la date de début du contrat dans sa fiche.'));
    }

    var groupes = {};
    var ordre = [];
    mois.slice().reverse().forEach(function (e) {
      var a = anneeBilan(e.annee, e.mois);
      if (!groupes[a]) { groupes[a] = []; ordre.push(a); }
      groupes[a].push(e);
    });

    ordre.forEach(function (a) {
      corps.appendChild(enteteAnnee(contrat, a));
      groupes[a].forEach(function (e) { corps.appendChild(carteMois(contrat, e)); });
    });

    corps.appendChild(Kit.note('Tout est conservé',
      'Chaque mois clôturé est conservé tel quel. Rien ne s’efface, même après la fin du contrat.'));
  }

  function enteteAnnee(contrat, a) {
    var an = Kit.ce('div', 'an');
    an.appendChild(Kit.ce('span', 't', libelleAnnee(a)));
    an.appendChild(Kit.ce('span', 'tr'));
    var b = Kit.bouton('more', function () {
      global.App.aller('bilan', { contratId: contrat.id, anneeBilan: a });
    });
    b.textContent = 'Bilan de l’année ›';
    an.appendChild(b);
    return an;
  }

  function carteMois(contrat, e) {
    var r = e.resultat;
    var b = Kit.bouton('card click', function () {
      global.App.aller('document', { contratId: contrat.id, annee: e.annee, mois: e.mois });
    });
    var row = Kit.ce('div', 'row');
    row.appendChild(Kit.ce('span', 'nm', Kit.moisCapitale(e.annee, e.mois)));
    row.appendChild(Kit.ce('span', 'badge ' + (e.fige ? 'ar' : 'wa'), e.fige ? 'clôturé' : 'en cours'));
    b.appendChild(row);
    b.appendChild(Kit.ce('div', 'sb',
      Kit.jours(r.joursPresence) + ' · ' + Kit.eur(r.totalAVerserCentimes)));
    if (e.avantInitialisation) {
      b.appendChild(Kit.ce('div', 'sb q', 'Avant la reprise de vos compteurs — soldes non significatifs'));
    }
    return b;
  }

  /* ------------------------------------------------------------------ */
  /* Bilan annuel                                                        */
  /* ------------------------------------------------------------------ */

  function rendreBilan(corps, contrat, mois, a) {
    var duMois = mois.filter(function (e) { return anneeBilan(e.annee, e.mois) === a; });
    if (!duMois.length) {
      corps.appendChild(Kit.ce('p', 'vide',
        'Aucun mois de ' + contrat.prenom_enfant + ' sur l’année ' + libelleAnnee(a) + '.'));
      return;
    }

    var agr = Chaine.agregerPeriode(duMois);
    var premier = duMois[0];
    var dernier = duMois[duMois.length - 1];

    corps.appendChild(Kit.ce('div', 'sb q',
      'Du ' + Kit.libelleMoisAnnee(premier.annee, premier.mois) + ' à ' +
      Kit.libelleMoisAnnee(dernier.annee, dernier.mois) + ' · ' + agr.nbMois + ' mois'));

    var p1 = Kit.pane('Totaux de l’année');
    var l1 = Kit.lines(p1);
    Kit.ligne(l1, 'Jours de présence', Kit.jours(agr.joursPresence));
    Kit.ligne(l1, 'Indemnité d’entretien', Kit.eur(agr.entretienCentimes));
    Kit.ligne(l1, 'Salaires nets', Kit.eur(agr.salaireNetCentimes));
    if (agr.retenueSansSoldeCentimes > 0) {
      Kit.ligne(l1, 'Retenues sans solde', '−' + Kit.eur(agr.retenueSansSoldeCentimes), { alerte: true });
    }
    Kit.ligne(l1, 'Heures sup acquises', Kit.heures(agr.minutesSupAcquises));
    Kit.ligne(l1, 'Congés posés', Kit.jours(agr.joursCongesDecomptes));
    Kit.ligne(l1, 'Total versé sur l’année', Kit.eur(agr.totalAVerserCentimes), { total: true });
    corps.appendChild(p1);

    /* Les compteurs ne s'additionnent pas : entrée au 1er septembre, sortie
       aujourd'hui. C'est l'ÉVOLUTION qui est lisible, pas une somme. */
    var ce0 = agr.compteurEntree || { minutesSup: 0, dixiemesCpAcquis: 0, dixiemesCpPris: 0 };
    var cs = agr.compteurSortie || ce0;
    var p2 = Kit.pane('Où en sont les compteurs');
    var l2 = Kit.lines(p2);
    Kit.ligne(l2, 'Récupération au 1er ' + Kit.libelleMois(premier.mois),
      Kit.heures(ce0.minutesSup || 0), { discret: true });
    Kit.ligne(l2, 'Récupération à la fin de la période', Kit.heures(cs.minutesSup || 0));
    Kit.ligne(l2, 'Congés payés au 1er ' + Kit.libelleMois(premier.mois),
      Kit.joursCp(Kit.cpDisponible(ce0)), { discret: true });
    Kit.ligne(l2, 'Congés payés à la fin de la période', Kit.joursCp(Kit.cpDisponible(cs)));
    corps.appendChild(p2);

    if (agr.moisProvisoires.length) {
      corps.appendChild(Kit.warnbox('Mois pas encore clôturés dans ce bilan',
        agr.moisProvisoires.map(function (m) { return Kit.libelleMoisAnnee(m.annee, m.mois); }).join(', ') +
        '. Ces montants peuvent encore changer.'));
    }
    if (agr.moisAvantInitialisation.length) {
      corps.appendChild(Kit.warnbox('Mois antérieurs à la reprise de vos compteurs',
        agr.moisAvantInitialisation.map(function (m) { return Kit.libelleMoisAnnee(m.annee, m.mois); }).join(', ') +
        '. Leurs jours et montants sont exacts, mais les soldes y repartent de zéro.'));
    }

    corps.appendChild(Kit.note('Rien ne se perd au 31 août',
      'La récupération et les congés payés non pris sont reportés sur l’année suivante. ' +
      'Le 31 août est une date de bilan, pas une remise à zéro.'));
  }

  global.UiHistorique = { afficher: afficher, anneeBilan: anneeBilan };
})(window);
