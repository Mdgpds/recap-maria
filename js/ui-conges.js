/* ============================================================================
   ui-conges.js — Onglet « Mes congés » (§2.5 des specs).

   C'est la SEULE chose globale de l'application. Tout le reste est rangé par
   famille. Et pourtant, même ici, AUCUN COMPTEUR GLOBAL : les congés payés
   restants sont affichés contrat par contrat, avec la phrase qui explique
   pourquoi ils diffèrent.

   « Poser des congés » ne pose rien avant d'avoir montré ce que ça coûte. Et
   ce coût est obtenu de la seule façon qui ne puisse pas mentir : en REJOUANT
   les mois concernés avec Engine.calculerMois(), journées existantes
   comprises, puis en comparant au même rejeu sans les nouveaux jours.

   C'était le défaut B4 de la relecture : la version précédente décomptait la
   semaine ISOLÉMENT (decompterJoursOuvrables) puis imputait ce total sur le
   compteur courant. Or le moteur, lui, regroupe TOUS les congés du mois en
   périodes continues avant d'imputer. Un congé déjà posé dans la semaine était
   donc compté deux fois, et l'aperçu annonçait un jour de trop — la même
   sur-estimation pilotant l'alerte « sans solde », qui pouvait se déclencher à
   tort. Le rejeu supprime la classe entière de ce défaut : il n'y a plus qu'un
   seul chemin de calcul, celui du moteur.

   Deux autres exigences tenues ici :
   - un contrat dont les compteurs n'ont pas pu être lus BLOQUE la pose au lieu
     d'être écarté en silence sous un discret « non concerné » (B5) ;
   - un contrat dont le mois est déjà clôturé ne reçoit rien, et on le dit (B1).
   ========================================================================= */
(function (global) {
  'use strict';

  var Kit = global.Kit;
  var Chaine = global.ChaineMois;
  var Engine = global.Engine;
  var Feries = global.Feries;

  /* Fenêtre de choix des semaines : quatre semaines en arrière (un congé peut
     se saisir après coup) et vingt en avant. La navigation par mois de cet
     écran et du calendrier couvre la même profondeur, pour qu'un congé posé
     d'avance reste consultable et retirable (correction A13). */
  var SEMAINES_AVANT = 4;
  var SEMAINES_APRES = 20;

  var vue = null;

  /* ------------------------------------------------------------------ */
  /* Affichage                                                           */
  /* ------------------------------------------------------------------ */

  function afficher(ctx) {
    var m = { annee: ctx.params.annee, mois: ctx.params.mois };
    if (!m.annee || !m.mois) m = global.App.moisCourant();
    var contrats = global.App.contrats();

    barre(ctx.barre, m);

    if (!contrats.length) {
      ctx.corps.appendChild(Kit.ce('p', 'vide', 'Aucun contrat actif : rien à poser.'));
      return Promise.resolve();
    }

    ctx.corps.appendChild(Kit.ce('div', 'attente', 'Lecture de vos compteurs…'));

    return Promise.all([
      Promise.all(contrats.map(function (c) {
        return Promise.all([
          global.App.serie(c, m),
          global.App.journees(c.id, m.annee, m.mois)
        ]).then(function (r) {
          return {
            contrat: c,
            entree: global.App.moisDe(r[0], m.annee, m.mois),
            journees: r[1],
            erreur: null
          };
        }).catch(function (e) {
          return { contrat: c, entree: null, journees: {}, erreur: e };
        });
      })),
      global.App.recapsDuMois(m.annee, m.mois).catch(function () { return null; })
    ]).then(function (r) {
      vue = { annee: m.annee, mois: m.mois, fiches: r[0], recaps: r[1] };
      Kit.vider(ctx.corps);
      rendre(ctx.corps);
    });
  }

  /* Navigation par mois : sans elle, un congé posé d'avance était écrit en base
     puis n'apparaissait sur aucun écran et ne pouvait plus être retiré. */
  function barre(barreEl, m) {
    Kit.vider(barreEl);
    barreEl.className = 'bar';
    barreEl.appendChild(Kit.ce('span', 'ti', 'Mes congés'));

    var nav = Kit.ce('div', 'nav');
    var prec = Kit.bouton(null, function () { changerMois(-1); });
    prec.textContent = '‹';
    prec.setAttribute('aria-label', 'Mois précédent');
    var etiquette = Kit.ce('span', 'r', Kit.libelleMoisAnnee(m.annee, m.mois));
    var suiv = Kit.bouton(null, function () { changerMois(1); });
    suiv.textContent = '›';
    suiv.setAttribute('aria-label', 'Mois suivant');

    var maintenant = global.App.moisCourant();
    var limite = maintenant;
    for (var i = 0; i < 12; i++) limite = Chaine.moisSuivant(limite.annee, limite.mois);
    var debut = maintenant;
    global.App.contrats().forEach(function (c) {
      var d = Chaine.moisDeDate(c.date_debut);
      if (Chaine.cmpMois(d.annee, d.mois, debut.annee, debut.mois) < 0) debut = d;
    });
    var p = Chaine.moisPrecedent(m.annee, m.mois);
    var s = Chaine.moisSuivant(m.annee, m.mois);
    prec.disabled = Chaine.cmpMois(p.annee, p.mois, debut.annee, debut.mois) < 0;
    suiv.disabled = Chaine.cmpMois(s.annee, s.mois, limite.annee, limite.mois) > 0;

    nav.appendChild(prec);
    nav.appendChild(suiv);
    barreEl.appendChild(etiquette);
    barreEl.appendChild(nav);
  }

  function changerMois(delta) {
    if (!vue) return;
    var m = delta < 0
      ? Chaine.moisPrecedent(vue.annee, vue.mois)
      : Chaine.moisSuivant(vue.annee, vue.mois);
    global.App.remplacer('conges', { annee: m.annee, mois: m.mois });
  }

  /* ------------------------------------------------------------------ */
  /* Rendu                                                               */
  /* ------------------------------------------------------------------ */

  function rendre(corps) {
    var fiches = vue.fiches;
    var enErreur = fiches.filter(function (f) { return f.erreur; });

    if (enErreur.length) {
      /* Correction B5 : l'échec de lecture d'un contrat n'est pas un détail
         gris, c'est un état incohérent. Il se voit, et il bloque la pose. */
      corps.appendChild(Kit.warnbox(
        'Compteurs indisponibles pour ' +
        enErreur.map(function (f) { return f.contrat.prenom_enfant; }).join(', '),
        'Impossible de savoir ce qu’un congé coûterait sur ' +
        (enErreur.length > 1 ? 'ces contrats' : 'ce contrat') + '. ' +
        'Poser un congé maintenant le laisserait en dehors, et ses compteurs divergeraient ' +
        'des autres. Revenez sur cet écran une fois le réseau revenu.'));
    }

    corps.appendChild(panneauPoses());
    corps.appendChild(panneauCompteurs());

    var bSemaine = Kit.bouton('btn', function () { feuilleSemaine(); });
    bSemaine.textContent = 'Poser une semaine entière';
    bSemaine.disabled = enErreur.length > 0;
    corps.appendChild(bSemaine);

    /* Restauration R6 : la plage libre du lot 5. Trois semaines d'été ne
       doivent pas coûter trois passages, et un congé oublié il y a trois mois
       doit rester posable. */
    var bPlage = Kit.bouton('btn nt', function () { feuillePlage(); });
    bPlage.textContent = 'Poser plusieurs jours (du… au…)';
    bPlage.disabled = enErreur.length > 0;
    corps.appendChild(bPlage);

    var bJour = Kit.bouton('btn nt', function () { feuilleJour(); });
    bJour.textContent = 'Poser une seule journée';
    corps.appendChild(bJour);

    var bRetrait = Kit.bouton('btn nt', function () { feuilleRetrait(); });
    bRetrait.textContent = 'Retirer des congés';
    corps.appendChild(bRetrait);

    corps.appendChild(Kit.note('Un congé vaut pour ' + libelleContrats(fiches.length),
      'Vous le posez une fois, il s’applique partout. Une semaine complète compte 6 jours, ' +
      'samedi inclus.'));
  }

  function libelleContrats(n) {
    return n <= 1 ? 'votre contrat' : 'vos ' + n + ' contrats';
  }

  function panneauPoses() {
    var p = Kit.pane('Posés en ' + Kit.libelleMois(vue.mois));
    var set = {};
    vue.fiches.forEach(function (f) {
      Object.keys(f.journees).forEach(function (d) {
        if (f.journees[d].type === 'conge_maria') set[d] = true;
      });
    });
    var jours = Object.keys(set).sort();
    if (!jours.length) {
      p.appendChild(Kit.ce('div', 'sb q', 'Aucun congé posé ce mois-ci.'));
      return p;
    }
    var l = Kit.lines(p);
    jours.forEach(function (d) { Kit.ligne(l, Kit.jourLong(d), '1 jour'); });

    /* Le décompte officiel (RG-06) n'est pas le nombre de cases cochées : une
       semaine posée du lundi au vendredi compte 6 jours. On affiche le chiffre
       du moteur, celui qui figure sur les documents. */
    var decompte = vue.fiches.reduce(function (max, f) {
      return f.entree ? Math.max(max, f.entree.resultat.joursCongesDecomptes || 0) : max;
    }, 0);
    if (decompte) {
      Kit.ligne(l, 'Décompte en jours ouvrables', Kit.jours(decompte), { discret: true });
    }
    return p;
  }

  function panneauCompteurs() {
    var p = Kit.pane('Congés payés restants par contrat');
    var l = Kit.lines(p);
    vue.fiches.forEach(function (f) {
      if (f.erreur) {
        Kit.ligne(l, f.contrat.prenom_enfant, 'indisponible', { alerte: true });
        return;
      }
      var cp = cpDe(f);
      /* Correction A3 : un seul seuil dans toute l'application. */
      Kit.ligne(l, f.contrat.prenom_enfant, Kit.joursCp(cp),
        { alerte: cp < Kit.SEUIL_CP_BAS_DIXIEMES });
    });
    p.appendChild(Kit.ce('div', 'sb q',
      'Les compteurs diffèrent car les contrats n’ont pas commencé en même temps.'));
    return p;
  }

  function cpDe(fiche) {
    return Kit.cpDisponible(fiche.entree && fiche.entree.resultat && fiche.entree.resultat.compteurSortie);
  }

  /* ------------------------------------------------------------------ */
  /* Poser une seule journée                                             */
  /* ------------------------------------------------------------------ */

  function feuilleJour() {
    Kit.ouvrirFeuille('Poser une seule journée',
      'Touchez le jour sur le calendrier d’un enfant : le congé sera posé sur ' +
      libelleContrats(vue.fiches.length) + '.',
      function (corps) {
        vue.fiches.forEach(function (f) {
          Kit.choix(corps, 'c3', '☾', 'Calendrier de ' + f.contrat.prenom_enfant,
            'Famille ' + ((f.contrat.famille && f.contrat.famille.nom) || '—'),
            function () {
              Kit.fermerFeuille();
              global.App.aller('enfant',
                { contratId: f.contrat.id, annee: vue.annee, mois: vue.mois });
            });
        });
      });
  }

  /* ------------------------------------------------------------------ */
  /* Choix d'une semaine / d'une plage                                   */
  /* ------------------------------------------------------------------ */

  function lundiDe(isoJour) {
    return Feries.ajouterJours(isoJour, 1 - Engine.jourSemaine(isoJour));
  }

  function semainesProposees() {
    var lundi = lundiDe(global.App.aujourdhui());
    var out = [];
    for (var k = -SEMAINES_AVANT; k <= SEMAINES_APRES; k++) {
      var l = Feries.ajouterJours(lundi, k * 7);
      out.push({ debut: l, fin: Feries.ajouterJours(l, 4), libelle: libellePlage(l, Feries.ajouterJours(l, 4)) });
    }
    return out;
  }

  function libellePlage(a, b) {
    var ja = Number(a.slice(8, 10)), jb = Number(b.slice(8, 10));
    var ma = Number(a.slice(5, 7)), mb = Number(b.slice(5, 7));
    if (ma === mb && a.slice(0, 4) === b.slice(0, 4)) {
      return 'du ' + ja + ' au ' + jb + ' ' + Kit.libelleMois(mb) + ' ' + b.slice(0, 4);
    }
    return 'du ' + ja + ' ' + Kit.libelleMois(ma) + ' au ' + jb + ' ' + Kit.libelleMois(mb) + ' ' + b.slice(0, 4);
  }

  function feuilleSemaine() {
    var semaines = semainesProposees();
    Kit.ouvrirFeuille('Poser une semaine entière',
      'Choisissez la semaine : vous verrez son effet réel avant de confirmer.',
      function (corps) {
        var sel = Kit.champSelect('Semaine',
          semaines.map(function (s, i) { return [i, s.libelle]; }), SEMAINES_AVANT);
        corps.appendChild(sel.bloc);
        var zone = Kit.ce('div');
        corps.appendChild(zone);
        function maj() { montrerApercu(zone, semaines[Number(sel.select.value)]); }
        sel.select.addEventListener('change', maj);
        maj();
      });
  }

  function feuillePlage() {
    var auj = global.App.aujourdhui();
    var maintenant = global.App.moisCourant();
    Kit.ouvrirFeuille('Poser plusieurs jours',
      'Deux dates, et vous verrez l’effet réel avant de confirmer.',
      function (corps) {
        var du = Kit.champDate('Du', auj, { anneeMin: maintenant.annee - 2, anneeMax: maintenant.annee + 2 });
        var au = Kit.champDate('Au', auj, { anneeMin: maintenant.annee - 2, anneeMax: maintenant.annee + 2 });
        corps.appendChild(du.bloc);
        corps.appendChild(au.bloc);
        var zone = Kit.ce('div');
        corps.appendChild(zone);
        var b = Kit.bouton('btn nt', function () {
          var d = du.valeur(), f = au.valeur();
          if (f < d) { Kit.toast('La fin de la période précède son début.', true); return; }
          montrerApercu(zone, { debut: d, fin: f, libelle: libellePlage(d, f) });
        });
        b.textContent = 'Voir l’effet';
        corps.appendChild(b);
      });
  }

  /* ------------------------------------------------------------------ */
  /* Aperçu — calculé par le moteur, sur le vrai périmètre               */
  /* ------------------------------------------------------------------ */

  function montrerApercu(zone, plage) {
    Kit.vider(zone);
    zone.appendChild(Kit.ce('div', 'attente', 'Calcul de l’effet…'));
    preparer(plage).then(function (prep) {
      Kit.vider(zone);
      zone.appendChild(vueApercu(prep, plage));
    }).catch(function (e) {
      Kit.vider(zone);
      zone.appendChild(Kit.warnbox('Effet incalculable', Kit.messageErreur(e) +
        ' Rien n’a été posé. Réessayez une fois le réseau revenu.'));
    });
  }

  /* Jours d'une plage qui appartiennent RÉELLEMENT à un contrat : son planning,
     ses bornes, hors fériés. Le filtre « mois clôturé » vient ensuite, car il
     demande une lecture en base. */
  function joursDuContrat(contrat, plage) {
    var planning = contrat.jours_planning || [1, 2, 3, 4, 5];
    var out = [];
    for (var d = plage.debut; d <= plage.fin; d = Feries.ajouterJours(d, 1)) {
      if (planning.indexOf(Engine.jourSemaine(d)) === -1) continue;
      if (Feries.estJourFerie(d)) continue;
      if (contrat.date_debut && d < contrat.date_debut) continue;
      if (contrat.date_fin && d > contrat.date_fin) continue;
      out.push(d);
    }
    return out;
  }

  function moisDeJours(jours) {
    var vus = {}, out = [];
    jours.forEach(function (d) {
      var k = d.slice(0, 7);
      if (!vus[k]) { vus[k] = true; out.push({ annee: Number(d.slice(0, 4)), mois: Number(d.slice(5, 7)) }); }
    });
    out.sort(function (a, b) { return Chaine.cmpMois(a.annee, a.mois, b.annee, b.mois); });
    return out;
  }

  /* Prépare tout ce qu'il faut pour décider : effet par contrat, contrats dont
     le mois est clôturé, journées manuelles qui seraient écrasées. */
  function preparer(plage) {
    var fiches = vue.fiches;
    var moisConcernes = moisDeJours(joursDuContrat({ jours_planning: [1, 2, 3, 4, 5, 6, 7] }, plage));
    if (!moisConcernes.length) return Promise.resolve({ effets: [], clos: [], ecrases: [] });

    return Promise.all(moisConcernes.map(function (mm) {
      return global.App.recapsDuMois(mm.annee, mm.mois).then(function (r) {
        return { cle: Chaine.cleMois(mm.annee, mm.mois), recaps: r };
      });
    })).then(function (liste) {
      var recapsParMois = {};
      liste.forEach(function (x) { recapsParMois[x.cle] = x.recaps; });
      return Promise.all(fiches.map(function (f) {
        return effetSurContrat(f, plage, recapsParMois);
      })).then(function (effets) {
        var clos = [];
        effets.forEach(function (e) {
          if (e.moisClos.length) clos.push(e);
        });
        return { effets: effets, clos: clos };
      });
    });
  }

  /* L'effet réel d'une pose sur un contrat : les mois concernés sont REJOUÉS
     par le moteur, avec et sans les nouveaux jours. Aucun décompte n'est refait
     à la main, aucune imputation n'est réécrite. */
  function effetSurContrat(fiche, plage, recapsParMois) {
    var c = fiche.contrat;
    var vide = {
      contrat: c, fiche: fiche, jours: 0, joursPoses: [], moisClos: [],
      cpAvant: cpDe(fiche), cpApres: cpDe(fiche), sansSolde: 0, ecrase: []
    };
    if (fiche.erreur) return Promise.resolve(vide);

    var tous = joursDuContrat(c, plage);
    if (!tous.length) return Promise.resolve(vide);

    /* Correction B1 : un mois déjà clôturé pour CE contrat ne reçoit rien. */
    var moisClos = [];
    var jours = tous.filter(function (d) {
      var cle = d.slice(0, 7);
      var recaps = recapsParMois[cle];
      if (global.App.estClos(recaps, c.id)) {
        if (moisClos.indexOf(cle) === -1) moisClos.push(cle);
        return false;
      }
      return true;
    });
    vide.moisClos = moisClos;
    if (!jours.length) return Promise.resolve(vide);

    var moisTouches = moisDeJours(jours);
    var premier = moisTouches[0];
    var dernier = moisTouches[moisTouches.length - 1];

    /* Tous les mois de la fenêtre, y compris ceux sans jour ajouté : le
       compteur du mois N alimente le mois N+1, on ne peut pas en sauter un. */
    var fenetre = [];
    var cur = { annee: premier.annee, mois: premier.mois };
    var garde = 0;
    while (Chaine.cmpMois(cur.annee, cur.mois, dernier.annee, dernier.mois) <= 0 && garde < 36) {
      fenetre.push({ annee: cur.annee, mois: cur.mois });
      cur = Chaine.moisSuivant(cur.annee, cur.mois);
      garde++;
    }

    return global.App.serie(c, dernier).then(function (chaine) {
      return Promise.all(fenetre.map(function (mm) {
        return global.App.journees(c.id, mm.annee, mm.mois).then(function (j) {
          return { cle: Chaine.cleMois(mm.annee, mm.mois), jours: j };
        });
      })).then(function (js) {
        var journeesParMois = {};
        js.forEach(function (x) { journeesParMois[x.cle] = x.jours; });

        var entreePremier = global.App.moisDe(chaine, premier.annee, premier.mois);
        if (!entreePremier) return vide;

        var compteur = entreePremier.compteurEntree;
        var reference = null, simule = null;
        var sansSolde = 0, decompte = 0, dejaPoses = 0;
        var etatSimule = compteur;

        fenetre.forEach(function (mm) {
          var cle = Chaine.cleMois(mm.annee, mm.mois);
          var entree = global.App.moisDe(chaine, mm.annee, mm.mois);
          var salaire = (entree && entree.salaire) || { brut_mensuel_centimes: 0, net_mensuel_centimes: 0 };
          var base = Object.keys(journeesParMois[cle] || {}).map(function (k) {
            return journeesParMois[cle][k];
          });

          /* Le mois tel qu'il est aujourd'hui — repris de la chaîne pour un
             mois clôturé (jamais recalculé), rejoué sinon. */
          var avant = (entree && entree.fige) ? entree.resultat : Engine.calculerMois({
            contrat: c, salaire: salaire, journees: base,
            compteurEntree: entree ? entree.compteurEntree : compteur,
            annee: mm.annee, mois: mm.mois
          });

          var ajoutes = jours.filter(function (d) { return d.slice(0, 7) === cle; });
          ajoutes.forEach(function (d) {
            var deja = (journeesParMois[cle] || {})[d];
            if (deja && deja.type === 'conge_maria') dejaPoses++;
          });
          var avecCongé = base.filter(function (l) { return ajoutes.indexOf(l.jour) === -1; })
            .concat(ajoutes.map(function (d) {
              return { contrat_id: c.id, jour: d, type: 'conge_maria',
                       minutes_reelles: null, entretien_centimes: null };
            }));
          var apres = Engine.calculerMois({
            contrat: c, salaire: salaire, journees: avecCongé,
            compteurEntree: etatSimule, annee: mm.annee, mois: mm.mois
          });

          etatSimule = apres.compteurSortie;
          reference = avant;
          simule = apres;
          decompte += (apres.joursCongesDecomptes || 0) - (avant.joursCongesDecomptes || 0);
          sansSolde += ((apres.imputation || {}).joursSansSolde || 0) -
                       ((avant.imputation || {}).joursSansSolde || 0);
        });

        /* Correction A5 : une journée saisie à la main sur ce contrat serait
           remplacée par l'upsert groupé, ses heures réelles perdues. */
        var ecrase = jours.filter(function (d) {
          var l = (journeesParMois[d.slice(0, 7)] || {})[d];
          return l && (l.type === 'familiarisation' ||
                       l.minutes_reelles != null || l.entretien_centimes != null);
        });

        return {
          contrat: c, fiche: fiche,
          jours: decompte,
          dejaPoses: dejaPoses,
          joursPoses: jours,
          moisClos: moisClos,
          cpAvant: Kit.cpDisponible(reference ? reference.compteurSortie : null),
          cpApres: Kit.cpDisponible(simule ? simule.compteurSortie : null),
          sansSolde: sansSolde,
          ecrase: ecrase
        };
      });
    });
  }

  function vueApercu(prep, plage) {
    var bloc = Kit.ce('div');
    var effets = prep.effets;
    var utiles = effets.filter(function (e) { return e.joursPoses.length; });
    var indisponibles = effets.filter(function (e) { return e.fiche.erreur; });

    if (!utiles.length) {
      bloc.appendChild(Kit.ce('p', 'vide',
        'Cette période ne contient aucun jour de travail à poser : fériés, hors planning, ' +
        'hors de vos contrats, ou mois déjà clôturés.'));
      return bloc;
    }

    var p = Kit.pane('Période ' + plage.libelle);
    var l = Kit.lines(p);
    var decompte = utiles.reduce(function (max, e) { return Math.max(max, e.jours); }, 0);
    var dejaPoses = utiles.reduce(function (max, e) { return Math.max(max, e.dejaPoses || 0); }, 0);
    Kit.ligne(l, 'Jours décomptés', Kit.jours(decompte));
    Kit.ligne(l, 'Samedi inclus — jours ouvrables', '', { discret: true });
    if (dejaPoses) {
      /* Le chiffre ci-dessus est bien l'effet RÉEL de ce geste : les jours déjà
         posés dans la période sont déjà comptés dans vos compteurs, ils ne le
         sont pas une seconde fois. */
      Kit.ligne(l, 'Déjà posés dans cette période', Kit.jours(dejaPoses), { discret: true });
    }
    effets.forEach(function (e) {
      if (e.fiche.erreur) {
        Kit.ligne(l, e.contrat.prenom_enfant, 'indisponible', { alerte: true });
        return;
      }
      if (!e.joursPoses.length) {
        Kit.ligne(l, e.contrat.prenom_enfant,
          e.moisClos.length ? 'mois clôturé' : 'non concerné', { discret: !e.moisClos.length, alerte: !!e.moisClos.length });
        return;
      }
      /* Correction A4 : le seuil d'alerte porte sur « moins d'un jour entier »,
         pas sur un zéro exact. imputerConges ne consomme que des multiples de
         10 dixièmes : un solde de 6,5 j ne peut jamais atteindre 0 pile, et
         l'alerte ne se déclenchait donc jamais pour lui. */
      Kit.ligne(l, e.contrat.prenom_enfant,
        Kit.joursCp(e.cpAvant) + ' → ' + Kit.joursCp(e.cpApres),
        { alerte: e.cpApres < 10 || e.sansSolde > 0 });
    });
    bloc.appendChild(p);

    var critiques = utiles.filter(function (e) { return e.sansSolde > 0; });
    var vides = utiles.filter(function (e) { return e.sansSolde === 0 && e.cpApres < 10; });

    if (critiques.length) {
      bloc.appendChild(Kit.warnbox(
        critiques.map(function (e) { return e.contrat.prenom_enfant; }).join(', ') +
        ' : une partie de cette période serait SANS SOLDE',
        'Congés payés et récupération ne suffisent pas. ' +
        critiques.map(function (e) {
          return e.contrat.prenom_enfant + ' : ' + Kit.jours(e.sansSolde) + ' sans solde';
        }).join(' · ') + '.'));
    } else if (vides.length) {
      bloc.appendChild(Kit.warnbox(
        vides.map(function (e) { return e.contrat.prenom_enfant; }).join(', ') +
        ' n’aura plus de congés payés après cette période',
        'Un prochain congé serait pris sur la récupération, puis sans solde.'));
    }

    if (prep.clos.length) {
      bloc.appendChild(Kit.warnbox(
        'Mois déjà clôturé pour ' +
        prep.clos.map(function (e) { return e.contrat.prenom_enfant; }).join(', '),
        'Ces contrats ne recevront rien sur les mois verrouillés : leur récapitulatif est ' +
        'déjà parti. Leurs compteurs vont donc s’écarter des autres — c’est normal, et c’est dit.'));
    }

    var ecrases = utiles.filter(function (e) { return e.ecrase.length; });
    if (ecrases.length) {
      bloc.appendChild(Kit.warnbox(
        'Une saisie manuelle sera remplacée chez ' +
        ecrases.map(function (e) { return e.contrat.prenom_enfant; }).join(', '),
        'Ces journées portent des heures réelles ou une indemnité saisies à la main ' +
        '(familiarisation). Poser un congé les efface définitivement.'));
    }

    if (indisponibles.length) {
      bloc.appendChild(Kit.warnbox(
        'Impossible de poser : compteurs illisibles pour ' +
        indisponibles.map(function (e) { return e.contrat.prenom_enfant; }).join(', '),
        'Un congé posé maintenant laisserait ' +
        (indisponibles.length > 1 ? 'ces contrats' : 'ce contrat') +
        ' en dehors, sans que rien ne le signale ensuite. Réessayez une fois le réseau revenu.'));
      return bloc;
    }

    bloc.appendChild(Kit.ce('p', 'sb q',
      'Effet calculé par le moteur sur les mois concernés, congés déjà posés compris.'));

    var b = Kit.bouton('btn', function () { poser(utiles, plage, b); });
    b.textContent = 'Confirmer cette période';
    bloc.appendChild(b);
    return bloc;
  }

  function poser(effets, plage, bouton) {
    var affectations = effets.map(function (e) {
      return { contratId: e.contrat.id, jours: e.joursPoses };
    });
    if (!affectations.length) { Kit.toast('Aucun jour à poser.', true); return; }

    bouton.disabled = true;
    global.DB.poserAbsenceMaria(affectations, 'conge_maria', null)
      .then(function () {
        global.App.invalider();
        Kit.fermerFeuille();
        Kit.toast('Période ' + plage.libelle + ' posée sur ' +
          (affectations.length > 1 ? affectations.length + ' contrats' : 'un contrat'));
        return global.App.rafraichir();
      })
      .catch(function (e) {
        bouton.disabled = false;
        Kit.toast('Enregistrement impossible : ' + Kit.messageErreur(e) + ' Rien n’a été posé.', true);
      });
  }

  /* ------------------------------------------------------------------ */
  /* Retirer des congés sur une plage (restauration R6)                  */
  /* ------------------------------------------------------------------ */

  var TYPES_ABSENCE_MARIA = ['conge_maria', 'sans_solde', 'hors_planning'];

  function feuilleRetrait() {
    var auj = global.App.aujourdhui();
    var maintenant = global.App.moisCourant();
    Kit.ouvrirFeuille('Retirer des congés',
      'Les journées redeviennent normales. Les absences d’enfant et les familiarisations ' +
      'ne sont jamais touchées.',
      function (corps) {
        var du = Kit.champDate('Du', auj, { anneeMin: maintenant.annee - 2, anneeMax: maintenant.annee + 2 });
        var au = Kit.champDate('Au', auj, { anneeMin: maintenant.annee - 2, anneeMax: maintenant.annee + 2 });
        corps.appendChild(du.bloc);
        corps.appendChild(au.bloc);
        var zone = Kit.ce('div');
        corps.appendChild(zone);

        var bVoir = Kit.bouton('btn nt', function () {
          var d = du.valeur(), f = au.valeur();
          if (f < d) { Kit.toast('La fin de la période précède son début.', true); return; }
          montrerRetrait(zone, { debut: d, fin: f, libelle: libellePlage(d, f) });
        });
        bVoir.textContent = 'Voir ce qui serait retiré';
        corps.appendChild(bVoir);
      });
  }

  function montrerRetrait(zone, plage) {
    Kit.vider(zone);
    zone.appendChild(Kit.ce('div', 'attente', 'Recherche des congés posés…'));

    var fiches = vue.fiches;
    var moisConcernes = moisDeJours(joursDuContrat({ jours_planning: [1, 2, 3, 4, 5, 6, 7] }, plage));

    Promise.all(moisConcernes.map(function (mm) {
      return global.App.recapsDuMois(mm.annee, mm.mois).then(function (r) {
        return { cle: Chaine.cleMois(mm.annee, mm.mois), recaps: r };
      });
    })).then(function (liste) {
      var recapsParMois = {};
      liste.forEach(function (x) { recapsParMois[x.cle] = x.recaps; });

      return Promise.all(fiches.map(function (f) {
        return Promise.all(moisConcernes.map(function (mm) {
          return global.App.journees(f.contrat.id, mm.annee, mm.mois);
        })).then(function (js) {
          var jours = [], clos = [];
          js.forEach(function (parJour) {
            Object.keys(parJour || {}).forEach(function (d) {
              if (d < plage.debut || d > plage.fin) return;
              if (TYPES_ABSENCE_MARIA.indexOf(parJour[d].type) === -1) return;
              var cle = d.slice(0, 7);
              if (global.App.estClos(recapsParMois[cle], f.contrat.id)) {
                if (clos.indexOf(cle) === -1) clos.push(cle);
                return;
              }
              jours.push(d);
            });
          });
          jours.sort();
          return { contrat: f.contrat, jours: jours, clos: clos };
        });
      }));
    }).then(function (parContrat) {
      Kit.vider(zone);
      var utiles = parContrat.filter(function (x) { return x.jours.length; });
      if (!utiles.length) {
        zone.appendChild(Kit.ce('p', 'vide',
          'Aucun congé à retirer sur cette période (ou ils sont sur des mois clôturés).'));
        return;
      }
      var p = Kit.pane('À retirer — ' + plage.libelle);
      var l = Kit.lines(p);
      parContrat.forEach(function (x) {
        Kit.ligne(l, x.contrat.prenom_enfant,
          x.jours.length ? Kit.jours(x.jours.length) : '—', { discret: !x.jours.length });
      });
      zone.appendChild(p);

      var closTous = parContrat.filter(function (x) { return x.clos.length; });
      if (closTous.length) {
        zone.appendChild(Kit.warnbox('Des mois clôturés sont concernés',
          'Les congés posés sur un mois déjà clôturé ne peuvent plus être retirés : ' +
          'le document est parti chez les parents.'));
      }

      var b = Kit.bouton('btn dg', function () {
        b.disabled = true;
        var ids = utiles.map(function (x) { return x.contrat.id; });
        var jours = {};
        utiles.forEach(function (x) { x.jours.forEach(function (d) { jours[d] = true; }); });
        global.DB.retirerAbsenceMaria(ids, Object.keys(jours).sort(), TYPES_ABSENCE_MARIA)
          .then(function () {
            global.App.invalider();
            Kit.fermerFeuille();
            Kit.toast('Congés retirés');
            return global.App.rafraichir();
          })
          .catch(function (e) {
            b.disabled = false;
            Kit.toast('Retrait impossible : ' + Kit.messageErreur(e) + ' Rien n’a changé.', true);
          });
      });
      b.textContent = 'Retirer ces congés';
      zone.appendChild(b);
    }).catch(function (e) {
      Kit.vider(zone);
      zone.appendChild(Kit.warnbox('Lecture impossible', Kit.messageErreur(e)));
    });
  }

  global.UiConges = { afficher: afficher, SEMAINES_APRES: SEMAINES_APRES };
})(window);
