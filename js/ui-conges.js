/* ============================================================================
   ui-conges.js — Onglet « Mes congés » (§2.5 des specs).

   C'est la SEULE chose globale de l'application. Tout le reste est rangé par
   famille. Et pourtant, même ici, AUCUN COMPTEUR GLOBAL : les congés payés
   restants sont affichés contrat par contrat, avec la phrase qui explique
   pourquoi ils diffèrent. Additionner les quatre compteurs produirait un
   nombre parfaitement crédible et parfaitement faux.

   « Poser une semaine entière » ne pose rien avant d'avoir montré ce que ça
   coûte : le nombre de jours décomptés (6, samedi inclus — RG-06) et l'effet
   sur CHACUN des contrats, avec alerte si l'un tombe à zéro ou bascule en
   sans solde.

   Ces deux chiffres viennent du moteur, pas d'un calcul refait ici :
   Engine.decompterJoursOuvrables pour le décompte, Engine.imputerConges pour
   l'imputation contrat par contrat (RG-05 / RG-07).
   ========================================================================= */
(function (global) {
  'use strict';

  var Kit = global.Kit;
  var Engine = global.Engine;
  var Feries = global.Feries;

  /* Fenêtre de choix des semaines : quatre semaines en arrière (un congé peut
     se saisir après coup) et vingt en avant. Aucune date ne se tape. */
  var SEMAINES_AVANT = 4;
  var SEMAINES_APRES = 20;

  function afficher(ctx) {
    var m = global.App.moisCourant();
    var contrats = global.App.contrats();

    ctx.barre.className = 'bar';
    ctx.barre.appendChild(Kit.ce('span', 'ti', 'Mes congés'));
    ctx.barre.appendChild(Kit.ce('span', 'r', Kit.libelleMoisAnnee(m.annee, m.mois)));

    if (!contrats.length) {
      ctx.corps.appendChild(Kit.ce('p', 'vide', 'Aucun contrat actif : rien à poser.'));
      return Promise.resolve();
    }

    ctx.corps.appendChild(Kit.ce('div', 'attente', 'Lecture de vos compteurs…'));

    return Promise.all(contrats.map(function (c) {
      return Promise.all([
        global.App.serie(c, m),
        global.App.journees(c.id, m.annee, m.mois)
      ]).then(function (r) {
        return { contrat: c, entree: global.App.moisDe(r[0], m.annee, m.mois), journees: r[1], erreur: null };
      }).catch(function (e) {
        return { contrat: c, entree: null, journees: {}, erreur: e };
      });
    })).then(function (fiches) {
      Kit.vider(ctx.corps);
      rendre(ctx.corps, fiches, m);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Rendu                                                               */
  /* ------------------------------------------------------------------ */

  function rendre(corps, fiches, m) {
    corps.appendChild(panneauPoses(fiches, m));
    corps.appendChild(panneauCompteurs(fiches));

    var bSemaine = Kit.bouton('btn', function () { feuilleSemaine(fiches); });
    bSemaine.textContent = 'Poser une semaine entière';
    corps.appendChild(bSemaine);

    var bJour = Kit.bouton('btn nt', function () { feuilleJour(fiches, m); });
    bJour.textContent = 'Poser une seule journée';
    corps.appendChild(bJour);

    corps.appendChild(Kit.note('Un congé vaut pour ' + libelleContrats(fiches.length),
      'Vous le posez une fois, il s’applique partout. Une semaine complète compte 6 jours, ' +
      'samedi inclus.'));
  }

  function libelleContrats(n) {
    return n <= 1 ? 'votre contrat' : 'vos ' + n + ' contrats';
  }

  /* Congés déjà posés dans le mois affiché, tous contrats confondus. */
  function panneauPoses(fiches, m) {
    var p = Kit.pane('Posés en ' + Kit.libelleMois(m.mois));
    var set = {};
    fiches.forEach(function (f) {
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
       semaine posée du lundi au vendredi compte 6 jours. On affiche donc le
       chiffre du moteur, celui qui figure sur les documents. */
    var decompte = fiches.reduce(function (max, f) {
      return f.entree ? Math.max(max, f.entree.resultat.joursCongesDecomptes || 0) : max;
    }, 0);
    if (decompte) {
      Kit.ligne(l, 'Décompte en jours ouvrables', Kit.jours(decompte), { discret: true });
    }
    return p;
  }

  function panneauCompteurs(fiches) {
    var p = Kit.pane('Congés payés restants par contrat');
    var l = Kit.lines(p);
    fiches.forEach(function (f) {
      if (f.erreur) {
        Kit.ligne(l, f.contrat.prenom_enfant, 'indisponible', { discret: true });
        return;
      }
      var cp = cpDe(f);
      Kit.ligne(l, f.contrat.prenom_enfant, Kit.joursCp(cp), { alerte: cp <= 20 });
    });
    p.appendChild(Kit.ce('div', 'sb q',
      'Les compteurs diffèrent car les contrats n’ont pas commencé en même temps.'));
    return p;
  }

  function cpDe(fiche) {
    var cs = (fiche.entree && fiche.entree.resultat && fiche.entree.resultat.compteurSortie) || {};
    return (cs.dixiemesCpAcquis || 0) - (cs.dixiemesCpPris || 0);
  }
  function supDe(fiche) {
    var cs = (fiche.entree && fiche.entree.resultat && fiche.entree.resultat.compteurSortie) || {};
    return cs.minutesSup || 0;
  }

  /* ------------------------------------------------------------------ */
  /* Poser une seule journée                                             */
  /* ------------------------------------------------------------------ */

  function feuilleJour(fiches, m) {
    Kit.ouvrirFeuille('Poser une seule journée',
      'Touchez le jour sur le calendrier d’un enfant : le congé sera posé sur ' +
      libelleContrats(fiches.length) + '.',
      function (corps) {
        fiches.forEach(function (f) {
          Kit.choix(corps, 'c3', '☾', 'Calendrier de ' + f.contrat.prenom_enfant,
            'Famille ' + ((f.contrat.famille && f.contrat.famille.nom) || '—'),
            function () {
              Kit.fermerFeuille();
              global.App.aller('enfant', { contratId: f.contrat.id, annee: m.annee, mois: m.mois });
            });
        });
      });
  }

  /* ------------------------------------------------------------------ */
  /* Poser une semaine entière                                           */
  /* ------------------------------------------------------------------ */

  /* Lundi de la semaine contenant `iso`. */
  function lundiDe(isoJour) {
    return Feries.ajouterJours(isoJour, 1 - Engine.jourSemaine(isoJour));
  }

  function semainesProposees() {
    var lundi = lundiDe(global.App.aujourdhui());
    var out = [];
    for (var k = -SEMAINES_AVANT; k <= SEMAINES_APRES; k++) {
      var l = Feries.ajouterJours(lundi, k * 7);
      var v = Feries.ajouterJours(l, 4);
      out.push({ lundi: l, vendredi: v, libelle: libelleSemaine(l, v) });
    }
    return out;
  }

  function libelleSemaine(l, v) {
    var jl = Number(l.slice(8, 10)), jv = Number(v.slice(8, 10));
    var ml = Number(l.slice(5, 7)), mv = Number(v.slice(5, 7));
    if (ml === mv) return 'du ' + jl + ' au ' + jv + ' ' + Kit.libelleMois(mv) + ' ' + v.slice(0, 4);
    return 'du ' + jl + ' ' + Kit.libelleMois(ml) + ' au ' + jv + ' ' + Kit.libelleMois(mv) + ' ' + v.slice(0, 4);
  }

  function feuilleSemaine(fiches) {
    var semaines = semainesProposees();
    var courante = SEMAINES_AVANT;   // index de la semaine en cours

    Kit.ouvrirFeuille('Poser une semaine entière',
      'Choisissez la semaine : vous verrez son effet avant de confirmer.',
      function (corps) {
        var sel = Kit.champSelect('Semaine',
          semaines.map(function (s, i) { return [i, s.libelle]; }), courante);
        corps.appendChild(sel.bloc);

        var apercu = Kit.ce('div');
        corps.appendChild(apercu);

        function maj() {
          Kit.vider(apercu);
          apercu.appendChild(vueApercu(fiches, semaines[Number(sel.select.value)]));
        }
        sel.select.addEventListener('change', maj);
        maj();
      });
  }

  /* L'aperçu AVANT confirmation (§2.5) : jours décomptés, effet contrat par
     contrat, alerte si un contrat tombe à zéro ou bascule en sans solde. */
  function vueApercu(fiches, semaine) {
    var bloc = Kit.ce('div');
    var effets = fiches.map(function (f) { return effetSurContrat(f, semaine); });
    var utiles = effets.filter(function (e) { return e.jours > 0; });

    if (!utiles.length) {
      bloc.appendChild(Kit.ce('p', 'vide',
        'Cette semaine ne contient aucun jour de travail (fériés, ou hors de vos contrats).'));
      return bloc;
    }

    var p = Kit.pane('Semaine ' + semaine.libelle);
    var l = Kit.lines(p);
    var decompte = utiles.reduce(function (max, e) { return Math.max(max, e.jours); }, 0);
    Kit.ligne(l, 'Jours décomptés', Kit.jours(decompte));
    Kit.ligne(l, 'Samedi inclus — jours ouvrables', '', { discret: true });
    effets.forEach(function (e) {
      if (e.jours === 0) {
        Kit.ligne(l, e.contrat.prenom_enfant, 'non concerné', { discret: true });
        return;
      }
      Kit.ligne(l, e.contrat.prenom_enfant,
        Kit.joursCp(e.cpAvant) + ' → ' + Kit.joursCp(e.cpApres),
        { alerte: e.cpApres === 0 || e.sansSolde > 0 });
    });
    bloc.appendChild(p);

    var critiques = effets.filter(function (e) { return e.jours > 0 && e.sansSolde > 0; });
    var vides = effets.filter(function (e) { return e.jours > 0 && e.sansSolde === 0 && e.cpApres === 0; });

    if (critiques.length) {
      bloc.appendChild(Kit.warnbox(
        critiques.map(function (e) { return e.contrat.prenom_enfant; }).join(', ') +
        ' : une partie de cette semaine serait SANS SOLDE',
        'Congés payés et récupération ne suffisent pas. ' +
        critiques.map(function (e) {
          return e.contrat.prenom_enfant + ' : ' + Kit.jours(e.sansSolde) + ' sans solde';
        }).join(' · ') + '.'));
    } else if (vides.length) {
      bloc.appendChild(Kit.warnbox(
        vides.map(function (e) { return e.contrat.prenom_enfant; }).join(', ') +
        ' n’aura plus de congés payés après cette semaine',
        'Un prochain congé serait pris sur la récupération, puis sans solde.'));
    }

    bloc.appendChild(Kit.ce('p', 'sb q',
      'Effet calculé sur vos compteurs d’aujourd’hui. Les congés payés que vous acquerrez ' +
      'd’ici là ne sont pas comptés.'));

    var b = Kit.bouton('btn', function () { poser(effets, semaine, b); });
    b.textContent = 'Confirmer cette semaine';
    bloc.appendChild(b);
    return bloc;
  }

  /* Effet de la semaine sur un contrat — deux appels au moteur, zéro formule. */
  function effetSurContrat(fiche, semaine) {
    var c = fiche.contrat;
    var planning = c.jours_planning || [1, 2, 3, 4, 5];

    /* Jours réellement posés sur CE contrat : son planning, ses bornes, fériés
       exclus. C'est ce qui partira en base. */
    var jours = [];
    for (var d = semaine.lundi; d <= semaine.vendredi; d = Feries.ajouterJours(d, 1)) {
      if (planning.indexOf(Engine.jourSemaine(d)) === -1) continue;
      if (Feries.estJourFerie(d)) continue;
      if (c.date_debut && d < c.date_debut) continue;
      if (c.date_fin && d > c.date_fin) continue;
      jours.push(d);
    }
    if (!jours.length || !fiche.entree) {
      return { contrat: c, jours: 0, joursPoses: [], cpAvant: cpDe(fiche), cpApres: cpDe(fiche), sansSolde: 0 };
    }

    /* RG-06 : le décompte officiel de la période, samedi inclus. */
    var nb = Engine.decompterJoursOuvrables(jours[0], jours[jours.length - 1], planning);

    /* RG-05 / RG-07 : imputation sur les compteurs disponibles. */
    var cpAvant = cpDe(fiche);
    var imp = Engine.imputerConges(nb, { minutesSup: supDe(fiche), dixiemesCp: cpAvant }, c);

    return {
      contrat: c,
      jours: nb,
      joursPoses: jours,
      cpAvant: cpAvant,
      cpApres: cpAvant - (imp.dixiemesCpConsommes || 0),
      surSup: imp.joursSurSup || 0,
      sansSolde: imp.joursSansSolde || 0
    };
  }

  function poser(effets, semaine, bouton) {
    var affectations = effets
      .filter(function (e) { return e.joursPoses && e.joursPoses.length; })
      .map(function (e) { return { contratId: e.contrat.id, jours: e.joursPoses }; });
    if (!affectations.length) { Kit.toast('Aucun jour à poser sur cette semaine.', true); return; }

    bouton.disabled = true;
    global.DB.poserAbsenceMaria(affectations, 'conge_maria', null)
      .then(function () {
        global.App.invalider();
        Kit.fermerFeuille();
        Kit.toast('Semaine ' + semaine.libelle + ' posée sur ' + libelleContrats(affectations.length));
        return global.App.rafraichir();
      })
      .catch(function (e) {
        bouton.disabled = false;
        Kit.toast('Enregistrement impossible : ' + Kit.messageErreur(e) + ' Rien n’a été posé.', true);
      });
  }

  global.UiConges = { afficher: afficher };
})(window);
