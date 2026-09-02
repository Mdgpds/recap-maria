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

  function majusculeInitiale(t) {
    return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
  }

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
    /* REDESIGN 2A §7 — TROIS ÉCRANS NEUFS DANS CE MODULE.
       `docs` est la racine de l'onglet, `cloture` le geste de fin de mois,
       `moisPasse` un mois figé détaillé enfant par enfant. Ils vivent ici
       plutôt que dans un fichier de plus : trois écrans sans état propre, et
       chaque fichier servi coûte une balise dans `index.html`, une ligne dans
       le pré-cache et une URL versionnée. */
    if (ctx.vue === 'docs') return rendreDocs(ctx);
    if (ctx.vue === 'cloture') return rendreCloture(ctx);
    if (ctx.vue === 'moisPasse') return rendreMoisPasse(ctx);
    if ((ctx.vue === 'historique' || ctx.vue === 'histoContrat') && !ctx.params.contratId) {
      return rendreRacine(ctx);
    }

    var contrat = global.App.contratParId(ctx.params.contratId);
    if (!contrat) {
      return global.App.tousLesContrats().then(function () {
        return charger(ctx, global.App.contratParId(ctx.params.contratId));
      });
    }
    return charger(ctx, contrat);
  }

  /* ------------------------------------------------------------------ */
  /* REDESIGN 2A §7 — L'ONGLET DOCUMENTS                                 */
  /* ------------------------------------------------------------------ */

  /* L'onglet ne classe plus par DATE mais par ce qu'on vient y chercher.
     Deux sections, et rien d'autre (§7.1) :

       « Clôturer le mois en cours »  — le geste de fin de mois
       « Les mois précédents »        — ce qui est figé, mois par mois

     L'ancienne racine — une carte par enfant, ses contrats en cours et
     terminés — n'est pas supprimée : elle devient « Voir par enfant », en bas
     de page. C'est là qu'on va chercher UN mois précis d'UN enfant, et un
     mois de 2024 peut être contesté en 2027. */

  function rendreDocs(ctx) {
    ctx.barre.className = 'top';
    ctx.barre.appendChild(Kit.ce('h1', null, 'Documents'));
    ctx.corps.appendChild(Kit.ce('div', 'attente', 'Lecture de vos mois…'));

    var m = global.App.moisCourant();
    var contrats = global.App.contrats();

    return Promise.all(contrats.map(function (c) {
      return global.App.serie(c, m)
        .then(function (chaine) { return { contrat: c, chaine: chaine, erreur: null }; })
        .catch(function (e) { return { contrat: c, chaine: null, erreur: e }; });
    })).then(function (series) {
      Kit.vider(ctx.corps);

      ctx.corps.appendChild(Kit.section('Clôturer le mois en cours'));
      ctx.corps.appendChild(carteCloture(series, m));

      ctx.corps.appendChild(Kit.section('Les mois précédents'));
      var passes = moisPrecedents(series, m);
      if (!passes.length) {
        ctx.corps.appendChild(Kit.ce('p', 'pfin',
          'Aucun mois passé pour l’instant. Ils s’ajouteront ici au fil des ' +
          'clôtures.'));
      } else {
        passes.forEach(function (p) {
          ctx.corps.appendChild(carteMoisPasse(p));
        });
      }

      var b = Kit.bouton('btn nt', function () {
        global.App.aller('histoContrat', {});
      });
      b.textContent = 'Voir par enfant';
      ctx.corps.appendChild(b);
    });
  }

  /* La carte du mois en cours : combien d'enfants sont prêts, combien
     restent à compléter. Le chiffre est CALCULÉ, jamais écrit en dur. */
  function carteCloture(series, m) {
    var aCompleter = series.filter(function (s) { return !estPret(s, m); }).length;
    var b = Kit.bouton('card tap' + (aCompleter ? ' warn' : ''), function () {
      global.App.aller('cloture', {});
    });
    var g = Kit.ce('span', 'gro');
    g.appendChild(Kit.ce('span', 'nm', Kit.moisCapitale(m.annee, m.mois)));
    g.appendChild(Kit.ce('span', 'dt', aCompleter
      ? (aCompleter > 1
        ? aCompleter + ' enfants à compléter avant de clôturer'
        : '1 enfant à compléter avant de clôturer')
      : series.length + (series.length > 1 ? ' récapitulatifs prêts' : ' récapitulatif prêt')));
    b.appendChild(g);
    b.appendChild(Kit.ce('span', 'chev', '›'));
    return b;
  }

  /* Un enfant est PRÊT quand son mois est calculable et complet : pas
     d'erreur de lecture, un salaire connu, et aucune journée de
     familiarisation en attente de déclaration. */
  function estPret(s, m) {
    if (s.erreur || !s.chaine) return false;
    var e = global.App.moisDe(s.chaine, m.annee, m.mois);
    if (!e) return true;                       // hors contrat : rien à compléter
    if (e.salaireManquant) return false;
    if (!e.resultat.salaireNetCentimes) return false;
    if (joursFamEnAttente(e).length) return false;
    return true;
  }

  /* Les journées de familiarisation DÉJÀ PASSÉES qui ne sont pas déclarées.

     Le moteur ne connaît pas la date du jour — c'est un module pur — et il
     n'expose donc pas de « jours échus » : il donne la période jour par jour
     (`familiarisation.jours`), et c'est ICI qu'on la croise avec l'horloge,
     lue une fois par `App.aujourdhui()`.

     Une journée À VENIR n'est pas un manque : rien ne peut encore y être
     déclaré, et la compter bloquerait la clôture d'un mois qui n'a rien à se
     reprocher. */
  function joursFamEnAttente(e) {
    var fam = e && e.resultat && e.resultat.familiarisation;
    if (!fam || !fam.actif) return [];
    var auj = global.App.aujourdhui();
    return (fam.jours || []).filter(function (j) {
      return !j.declare && (!auj || j.jour <= auj);
    });
  }

  /* Les mois ANTÉRIEURS au mois affiché, tous contrats confondus, du plus
     récent au plus ancien. Un mois où AUCUN contrat n'a de récapitulatif
     n'existe pas : on ne fabrique pas des mois vides. */
  function moisPrecedents(series, m) {
    var rangCourant = m.annee * 12 + m.mois;
    var par = {};
    series.forEach(function (s) {
      if (s.erreur || !s.chaine) return;
      (s.chaine.mois || []).forEach(function (e) {
        var rang = e.annee * 12 + e.mois;
        if (rang >= rangCourant) return;
        if (e.avantInitialisation) return;
        var cle = e.annee + '-' + e.mois;
        if (!par[cle]) par[cle] = { annee: e.annee, mois: e.mois, entrees: [] };
        par[cle].entrees.push({ contrat: s.contrat, entree: e });
      });
    });
    return Object.keys(par).map(function (k) { return par[k]; })
      .sort(function (a, b) {
        return (b.annee * 12 + b.mois) - (a.annee * 12 + a.mois);
      });
  }

  /* LE TOTAL D'UN MOIS, ECRIT UNE FOIS. Trois ecrans l'affichent — la liste
     des mois passes, l'ecran de cloture, l'ecran d'un mois passe — et trois
     copies de la meme boucle vivaient ici (reserve R4 de la relecture du
     1er septembre). Deux copies du meme calcul finissent par diverger : le
     lot 31 l'a paye sur un titre de conge. Les valeurs additionnees viennent
     du moteur ; seul l'agregat entre contrats est fait ici, et il n'est fait
     qu'a un endroit. Une entree absente (contrat sans mois calcule) compte
     zero, et c'est la seule garde. */
  function totalDuMois(entrees) {
    var total = 0;
    entrees.forEach(function (e) {
      if (e && e.resultat) total += e.resultat.totalAVerserCentimes || 0;
    });
    return total;
  }

  function carteMoisPasse(p) {
    var auj = global.App.aujourdhui();
    var total = totalDuMois(p.entrees.map(function (x) { return x.entree; }));
    var aCloturer = p.entrees.filter(function (x) {
      return Kit.etatDuMois(x.annee || p.annee, p.mois, x.entree.recap, auj) !== 'cloture';
    }).length;
    var b = Kit.bouton('card tap' + (aCloturer === 0 ? '' : ' warn'), function () {
      global.App.aller('moisPasse', { annee: p.annee, mois: p.mois });
    });
    var g = Kit.ce('span', 'gro');
    g.appendChild(Kit.ce('span', 'nm', Kit.moisCapitale(p.annee, p.mois)));
    g.appendChild(Kit.ce('span', 'dt',
      p.entrees.length + (p.entrees.length > 1 ? ' récapitulatifs' : ' récapitulatif') +
      ' · ' + (aCloturer === 0 ? 'tous clôturés' :
               aCloturer + ' à clôturer')));
    b.appendChild(g);
    b.appendChild(Kit.ce('span', 'mt', Kit.eur(total)));
    b.appendChild(Kit.ce('span', 'chev', '›'));
    return b;
  }

  /* ------------------------------------------------------------------ */
  /* §7.2 — L'ÉCRAN DE CLÔTURE                                           */
  /* ------------------------------------------------------------------ */

  function rendreCloture(ctx) {
    /* app.js a posé une barre de retour de secours avant de déléguer :
       sans ce vidage, son bouton « ‹ » reste sous la barre 2A, hors de
       toute règle de taille, et offre une cible tactile de 20 px. */
    Kit.vider(ctx.barre);
    ctx.barre.className = 'top slim';
    var bk = Kit.bouton('back', function () { global.App.retour(); });
    bk.textContent = '‹';
    bk.setAttribute('aria-label', 'Retour');
    ctx.barre.appendChild(bk);
    ctx.barre.appendChild(Kit.ce('h1', null, 'Clôturer le mois'));
    ctx.corps.appendChild(Kit.ce('div', 'attente', 'Calcul de vos mois…'));

    var m = global.App.moisCourant();
    var contrats = global.App.contrats();

    return Promise.all(contrats.map(function (c) {
      return global.App.serie(c, m)
        .then(function (chaine) { return { contrat: c, chaine: chaine, erreur: null }; })
        .catch(function (e) { return { contrat: c, chaine: null, erreur: e }; });
    })).then(function (series) {
      Kit.vider(ctx.corps);

      ctx.corps.appendChild(Kit.enc('i',
        'Clôturer fige les chiffres du mois et prépare les documents. ' +
        'Un mois clôturé peut toujours être rouvert.'));

      var manquants = [];
      var total = totalDuMois(series.map(function (s) {
        return s.chaine && global.App.moisDe(s.chaine, m.annee, m.mois);
      }));

      series.forEach(function (s) {
        var pret = estPret(s, m);
        if (!pret) manquants.push({ contrat: s.contrat, quoi: cePourquoiIlManque(s, m) });

        var b = Kit.bouton('card tap' + (pret ? '' : ' warn'), function () {
          if (pret) {
            global.App.aller('document',
              { contratId: s.contrat.id, annee: m.annee, mois: m.mois });
          } else {
            /* §7.2 — « Une carte "à compléter" mène directement à ce qui
               manque. » L'espace de l'enfant, sur le mois en cours : c'est là
               que la journée se déclare et que le salaire se corrige. */
            global.App.aller('enfant',
              { contratId: s.contrat.id, annee: m.annee, mois: m.mois });
          }
        });
        b.appendChild(Kit.avatar(s.contrat, 'pt'));
        var g = Kit.ce('span', 'gro');
        g.appendChild(Kit.ce('span', 'nm', s.contrat.prenom_enfant));
        g.appendChild(Kit.ce('span', 'dt', pret
          ? (e ? Kit.eur(e.resultat.totalAVerserCentimes) + ' — tout est saisi'
               : 'ce mois ne concerne pas ce contrat')
          : cePourquoiIlManque(s, m)));
        b.appendChild(g);
        b.appendChild(Kit.pill(pret ? 'o' : 'w', pret ? 'prêt' : 'à compléter'));
        ctx.corps.appendChild(b);
      });

      var l = Kit.ce('div', 'card');
      Kit.ligneLn(l, 'Total du mois', Kit.eur(total), { total: true });
      ctx.corps.appendChild(l);

      var b = Kit.bouton('btn', function () {
        global.App.aller('finDeMois', { liste: aCloturerDepuis(series, m) });
      });
      b.textContent = manquants.length
        ? 'Clôturer ' + Kit.libelleMois(m.mois) + ' — ' +
          (manquants.length > 1 ? manquants.length + ' enfants à compléter'
                                : '1 enfant à compléter')
        : 'Clôturer ' + Kit.libelleMois(m.mois);
      b.disabled = manquants.length > 0;
      ctx.corps.appendChild(b);

      /* §7.2 — « une phrase dit ce qui manque et pour qui ». Un bouton
         inactif sans explication est une impasse : Maria appuie, rien ne se
         passe, et rien ne lui dit pourquoi. */
      if (manquants.length) {
        ctx.corps.appendChild(Kit.ce('p', 'pfin',
          'Le bouton s’activera dès que ' +
          manquants.map(function (x) {
            return x.quoi.charAt(0).toLowerCase() + x.quoi.slice(1) +
              ' pour ' + x.contrat.prenom_enfant;
          }).join(', et ') + '.'));
      }
    });
  }

  function cePourquoiIlManque(s, m) {
    if (s.erreur) return 'Le mois n’a pas pu être calculé';
    var e = global.App.moisDe(s.chaine, m.annee, m.mois);
    if (!e) return '';
    if (e.salaireManquant) return 'La rémunération n’est pas renseignée';
    if (!e.resultat.salaireNetCentimes) return 'Le net n’est pas renseigné';
    var attente = joursFamEnAttente(e);
    if (attente.length) {
      return attente.length > 1
        ? attente.length + ' journées de familiarisation restent à déclarer'
        : 'Une journée de familiarisation reste à déclarer';
    }
    return '';
  }

  function aCloturerDepuis(series, m) {
    var liste = [];
    series.forEach(function (s) {
      if (s.erreur || !s.chaine) return;
      var e = global.App.moisDe(s.chaine, m.annee, m.mois);
      if (!e) return;
      liste.push({ contrat: s.contrat, annee: m.annee, mois: m.mois, echu: false,
        rouvert: Kit.moisRouvert(e.recap) });
    });
    return liste;
  }

  /* ------------------------------------------------------------------ */
  /* §7.3 — UN MOIS PASSÉ, SUR SON PROPRE ÉCRAN                          */
  /* ------------------------------------------------------------------ */

  /* C'était le point 1 du lot 31, et le §7.3 dit de ne pas le défaire :
     toucher un mois passé ouvrait le document d'UN enfant choisi au hasard.
     Il ouvre désormais son propre écran, détaillé enfant par enfant.

     UN MOIS CLÔTURÉ LIT SON INSTANTANÉ. `App.serie` rend une chaîne dont les
     mois figés portent leur `recap.donnees` — le moteur ne les recalcule pas.
     C'est l'endroit exact où un redesign peut réintroduire un recalcul sans
     qu'on le voie : ce qui est lu ici, ce sont les entrées de la chaîne,
     jamais `Engine.calculerMois`. */
  function rendreMoisPasse(ctx) {
    var annee = Number(ctx.params.annee);
    var mois = Number(ctx.params.mois);

    /* app.js a posé une barre de retour de secours avant de déléguer :
       sans ce vidage, son bouton « ‹ » reste sous la barre 2A, hors de
       toute règle de taille, et offre une cible tactile de 20 px. */
    Kit.vider(ctx.barre);
    ctx.barre.className = 'top slim';
    var bk = Kit.bouton('back', function () { global.App.retour(); });
    bk.textContent = '‹';
    bk.setAttribute('aria-label', 'Retour');
    ctx.barre.appendChild(bk);
    ctx.barre.appendChild(Kit.ce('h1', null, Kit.moisCapitale(annee, mois)));
    ctx.corps.appendChild(Kit.ce('div', 'attente', 'Lecture du mois…'));

    return global.App.tousLesContrats().then(function (tous) {
      return Promise.all((tous || []).map(function (c) {
        return global.App.serie(c, { annee: annee, mois: mois })
          .then(function (chaine) {
            return { contrat: c, entree: global.App.moisDe(chaine, annee, mois) };
          })
          .catch(function () { return { contrat: c, entree: null }; });
      }));
    }).then(function (lignes) {
      Kit.vider(ctx.corps);
      var avec = lignes.filter(function (x) { return !!x.entree; });

      ctx.corps.appendChild(Kit.enc('i',
        'Mois clôturé. Chaque récapitulatif est figé : ses chiffres ne bougent ' +
        'plus. Touchez un enfant pour le rouvrir et le corriger.'));

      if (!avec.length) {
        ctx.corps.appendChild(Kit.ce('p', 'vide',
          'Aucun récapitulatif pour ' + Kit.libelleMoisAnnee(annee, mois) + '.'));
        return;
      }

      var total = totalDuMois(avec.map(function (x) { return x.entree; }));
      avec.forEach(function (x) {
        ctx.corps.appendChild(carteEnfantDuMois(x, annee, mois));
      });

      var l = Kit.ce('div', 'card');
      Kit.ligneLn(l, 'Total du mois', Kit.eur(total), { total: true });
      ctx.corps.appendChild(l);
    });
  }

  /* Une carte à DEUX PARTIES : l'identité et le montant en haut, le détail en
     dessous. Un appui ouvre le document de cet enfant pour ce mois. */
  function carteEnfantDuMois(x, annee, mois) {
    var r = x.entree.resultat;
    var carte = Kit.ce('div', 'card cart3');

    var haut = Kit.bouton('card tap etg1', function () {
      global.App.aller('document',
        { contratId: x.contrat.id, annee: annee, mois: mois });
    });
    haut.appendChild(Kit.avatar(x.contrat, 'pt'));
    var g = Kit.ce('span', 'gro');
    g.appendChild(Kit.ce('span', 'nm', x.contrat.prenom_enfant));
    g.appendChild(Kit.ce('span', 'dt',
      Kit.LIBELLE_ETAT[Kit.etatDuMois(annee, mois, x.entree.recap,
        global.App.aujourdhui())] || ''));
    haut.appendChild(g);
    haut.appendChild(Kit.ce('span', 'mt', Kit.eur(r.totalAVerserCentimes)));
    carte.appendChild(haut);

    var bas = Kit.ce('div', 'moisd');
    Kit.ligneLn(bas, 'Jours de présence', Kit.jours(r.joursPresence));
    if (r.joursConge) Kit.ligneLn(bas, 'Jours de congé', Kit.jours(r.joursConge));
    Kit.ligneLn(bas, 'Salaire net', Kit.eur(r.salaireNetCentimes));
    Kit.ligneLn(bas, 'Indemnité d’entretien', Kit.eur(r.entretienCentimes));
    if (r.joursAbsence) Kit.ligneLn(bas, 'Absences', Kit.jours(r.joursAbsence));
    carte.appendChild(bas);
    return carte;
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
    /* CORRECTIF A7 (lot 7) DE LA RELECTURE PR9 — DEUX ÉTATS AU LIEU DE TROIS.
       `e.fige ? 'clôturé' : 'en cours'` étiquetait « en cours » un juillet
       jamais clôturé, au mois d'août. L'écran où Maria vient VÉRIFIER son
       passé était précisément celui qui lui disait que rien ne manquait.
       V8-01 demande les trois états partout : on interroge la même fonction
       que l'accueil et la fiche. */
    var etat = Kit.etatDuMois(e.annee, e.mois, e.recap, global.App.aujourdhui());
    row.appendChild(Kit.pastilleEtat(etat));
    b.appendChild(row);
    b.appendChild(Kit.ce('div', 'sb',
      Kit.jours(r.joursPresence) + ' · ' + Kit.eur(r.totalAVerserCentimes)));
    /* CORRECTION RELECTURE LOT 16 (C1) — LA MARQUE SUIT LE MOIS JUSQU'ICI.

       Le §16.1 a) demande « le même traitement partout où un mois se calcule »
       et cite les cinq écrans. Le repli y remonte bien — la chaîne est commune
       — mais la MARQUE ne s'affichait que sur trois. L'historique est justement
       un écran qui agrège : un mois retombé sur l'ordre par défaut du contrat
       y présentait des chiffres plausibles, et qui ne sont pas ceux que Maria
       avait choisis.

       Forme allégée, décision d'Adrien : une mention sur la ligne. L'encart
       complet avec son bouton reste réservé à l'espace enfant, où la
       correction se fait. */
    if ((e.imputationsEcartees || []).length) {
      b.appendChild(Kit.ce('div', 'sb alerte',
        (e.imputationsEcartees.length > 1
          ? 'Des répartitions de congé ont été écartées'
          : 'Une répartition de congé a été écartée') +
        ' — chiffres calculés dans l’ordre habituel du contrat'));
    }
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
      /* C2 — « Du août 2026 » : l'élision manquait aussi sur le bilan annuel. */
      majusculeInitiale(Kit.elider('du', Kit.libelleMoisAnnee(premier.annee, premier.mois))) + ' à ' +
      Kit.libelleMoisAnnee(dernier.annee, dernier.mois) + ' · ' + agr.nbMois + ' mois'));

    var p1 = Kit.pane('Totaux de l’année');
    var l1 = Kit.lines(p1);
    Kit.ligne(l1, 'Jours de présence', Kit.jours(agr.joursPresence));
    Kit.ligne(l1, 'Indemnité d’entretien', Kit.eur(agr.entretienCentimes));
    Kit.ligne(l1, 'Salaires nets', Kit.eur(agr.salaireNetCentimes));
    /* LOT 28 (§28.4) — la part de familiarisation de l'année : sans elle, le
       total versé ne se reconstituait pas à partir des lignes au-dessus. */
    if (agr.familiarisationNetCentimes || agr.familiarisationEntretienCentimes) {
      Kit.ligne(l1, 'Familiarisation — heures déclarées', Kit.eur(agr.familiarisationNetCentimes));
      Kit.ligne(l1, 'Familiarisation — entretien', Kit.eur(agr.familiarisationEntretienCentimes));
    }
    if (agr.retenueSansSoldeCentimes > 0) {
      Kit.ligne(l1, 'Retenues sans solde', '−' + Kit.eur(agr.retenueSansSoldeCentimes), { alerte: true });
    }
    Kit.ligne(l1, 'Heures sup acquises', Kit.heures(agr.minutesSupAcquises));
    Kit.ligne(l1, 'Congés posés', Kit.jours(agr.joursCongesDecomptes));
    Kit.ligne(l1, 'Total versé sur l’année', Kit.eur(agr.totalAVerserCentimes), { total: true });
    corps.appendChild(p1);

    /* Les compteurs ne s'additionnent pas : entrée au 1er septembre, sortie
       aujourd'hui. C'est l'ÉVOLUTION qui est lisible, pas une somme. */
    var ce0 = agr.compteurEntree || { minutesSup: 0, minutesCpAcquis: 0, minutesCpPris: 0 };
    /* LOT 17 §17.6 — le facteur d'affichage des congés payés, calculé par la
       chaîne sur le DERNIER mois de la période. Voir `agregerPeriode`. */
    var mpjc = agr.minutesParJourConge;
    var cs = agr.compteurSortie || ce0;
    var p2 = Kit.pane('Où en sont les compteurs');
    var l2 = Kit.lines(p2);
    Kit.ligne(l2, 'Récupération au 1er ' + Kit.libelleMois(premier.mois),
      Kit.heures(ce0.minutesSup || 0), { discret: true });
    Kit.ligne(l2, 'Récupération à la fin de la période', Kit.heures(cs.minutesSup || 0));
    Kit.ligne(l2, 'Congés payés au 1er ' + Kit.libelleMois(premier.mois),
      Kit.joursCp(Kit.cpDisponible(ce0), mpjc), { discret: true });
    Kit.ligne(l2, 'Congés payés à la fin de la période',
      Kit.joursCp(Kit.cpDisponible(cs), mpjc));
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
