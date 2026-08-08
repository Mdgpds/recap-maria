/* ============================================================================
   ui-accueil.js — Écran d'accueil (§2.1 des specs).

   Le principe directeur du lot : l'application s'organise par FAMILLE, pas par
   mois. L'accueil est donc une liste de contrats — « le dossier de Léa » — et
   non un tableau du mois de mai.

   Trois blocs, dans cet ordre :
     1. l'en-tête vert : bonjour, mois en cours, avancement du mois ;
     2. « À faire » : un mois à clôturer par contrat, plus les compteurs bas ;
     3. une carte par contrat actif, avec trois mini-chiffres.

   Aucun calcul ici. Les chiffres viennent tous de la chaîne des mois
   (chaine-mois.js -> Engine.calculerMois). Les montants d'entretien
   n'apparaissent PAS isolément sur cet écran (§2.1) : seulement le total à
   verser, qui est le chiffre que Maria attend.
   ========================================================================= */
(function (global) {
  'use strict';

  var Kit = global.Kit;

  /* Seuil d'alerte de l'accueil (§2.1) : 6 jours ouvrables de congés payés ou
     moins, soit 60 dixièmes. Une semaine complète en coûte 6 (RG-06) : à ce
     niveau, le prochain congé d'été bascule en partie sur la récupération puis
     en sans solde. */
  var SEUIL_ALERTE_CP_DIXIEMES = 60;

  function afficher(ctx) {
    var m = global.App.moisCourant();
    var contrats = global.App.contrats();

    enTete(ctx.barre, m, null);

    if (!contrats.length) {
      ctx.corps.appendChild(Kit.ce('div', 'sec', 'Mes contrats'));
      ctx.corps.appendChild(Kit.ce('p', 'vide',
        'Aucun contrat pour l’instant. Ajoutez un enfant depuis le Menu.'));
      return Promise.resolve();
    }

    ctx.corps.appendChild(Kit.ce('div', 'attente', 'Calcul de vos mois…'));

    return Promise.all(contrats.map(function (c) { return charger(c, m); }))
      .then(function (fiches) {
        Kit.vider(ctx.corps);
        enTete(ctx.barre, m, fiches);
        rendreAFaire(ctx.corps, fiches, m);
        rendreCartes(ctx.corps, fiches, m);
      });
  }

  /* Une fiche = tout ce que l'accueil doit savoir d'un contrat pour ce mois.
     Un contrat qui échoue n'efface pas les autres : il porte son erreur. */
  function charger(contrat, m) {
    return Promise.all([
      global.App.serie(contrat, m),
      global.App.journees(contrat.id, m.annee, m.mois)
    ]).then(function (r) {
      var chaine = r[0];
      var journees = r[1];
      var entree = global.App.moisDe(chaine, m.annee, m.mois);
      return {
        contrat: contrat,
        entree: entree,
        journees: journees,
        travailles: Kit.joursTravailles(contrat, m.annee, m.mois, journees),
        erreur: null
      };
    }).catch(function (e) {
      return { contrat: contrat, entree: null, journees: {}, travailles: [], erreur: e };
    });
  }

  /* ------------------------------------------------------------------ */
  /* En-tête                                                             */
  /* ------------------------------------------------------------------ */

  function enTete(barre, m, fiches) {
    Kit.vider(barre);
    barre.className = 'hero';
    barre.appendChild(Kit.ce('div', 'hi', 'Bonjour Maria'));
    barre.appendChild(Kit.ce('div', 'mo', Kit.moisCapitale(m.annee, m.mois)));

    if (!fiches) return;

    /* Avancement du mois : jours travaillés écoulés sur jours travaillés du
       mois, tous contrats confondus (l'union, parce que les quatre contrats
       partagent le même planning mais pas les mêmes dates de début). C'est une
       lecture d'almanach, pas un calcul métier — voir ui-kit.js. */
    var toutes = {};
    fiches.forEach(function (f) { f.travailles.forEach(function (d) { toutes[d] = true; }); });
    var jours = Object.keys(toutes).sort();
    if (!jours.length) return;

    var auj = global.App.aujourdhui();
    var ecoules = jours.filter(function (d) { return d <= auj; }).length;
    var pct = Math.round(ecoules * 100 / jours.length);

    var wrap = Kit.ce('div', 'pwrap');
    var lab = Kit.ce('div', 'plab');
    lab.appendChild(Kit.ce('span', null, 'Le mois avance'));
    var droite = auj >= jours[0] && auj <= jours[jours.length - 1]
      ? Kit.jourLong(auj).replace(/^\S+\s/, '') + ' — j. ' + ecoules + ' sur ' + jours.length + ' travaillés'
      : ecoules + ' jours travaillés sur ' + jours.length;
    lab.appendChild(Kit.ce('span', null, droite));
    wrap.appendChild(lab);
    var bar = Kit.ce('div', 'pbar');
    var i = Kit.ce('i');
    i.style.width = pct + '%';
    bar.appendChild(i);
    wrap.appendChild(bar);
    barre.appendChild(wrap);
  }

  /* ------------------------------------------------------------------ */
  /* « À faire »                                                         */
  /* ------------------------------------------------------------------ */

  function rendreAFaire(corps, fiches, m) {
    corps.appendChild(Kit.section('À faire'));
    var nb = 0;

    fiches.forEach(function (f) {
      if (f.erreur) {
        nb++;
        tuile(corps, '!', 'Le mois de ' + f.contrat.prenom_enfant + ' n’a pas pu être calculé',
          Kit.messageErreur(f.erreur), null);
        return;
      }
      if (!f.entree) return;                 // contrat hors de ce mois : rien à faire
      if (f.entree.salaireManquant) {
        nb++;
        tuile(corps, '!', 'Aucune rémunération connue pour ' + f.contrat.prenom_enfant,
          'Renseignez son barème dans sa fiche contrat, sinon le mois ne peut pas être clôturé.',
          function () { ouvrirFiche(f.contrat); });
        return;
      }
      if (!f.entree.fige) {
        nb++;
        tuile(corps, '!', 'Clôturer le mois de ' + f.contrat.prenom_enfant,
          'Vérifiez les journées, puis verrouillez le mois',
          function () { ouvrirEnfant(f.contrat, m); });
      }
    });

    fiches.forEach(function (f) {
      if (f.erreur || !f.entree) return;
      var cp = cpDisponible(f.entree);
      if (cp > SEUIL_ALERTE_CP_DIXIEMES) return;
      nb++;
      tuile(corps, '⚠',
        f.contrat.prenom_enfant + ' n’a plus que ' + Kit.joursCp(cp) + ' de congés payés',
        'Un congé passerait en partie sans solde sur ce contrat',
        function () { ouvrirEnfant(f.contrat, m); });
    });

    if (nb === 0) {
      var t = Kit.ce('div', 'todo act');
      t.appendChild(Kit.ce('div', 'ic', '✓'));
      var tx = Kit.ce('div', 'tx', 'Tout est à jour');
      tx.appendChild(Kit.ce('small', null,
        'Les ' + fiches.length + ' mois de ' + Kit.libelleMois(m.mois) + ' sont clôturés'));
      t.appendChild(tx);
      corps.appendChild(t);
    }
  }

  function tuile(corps, icone, titre, sous, onclick) {
    var t = onclick ? Kit.bouton('todo', onclick) : Kit.ce('div', 'todo');
    t.appendChild(Kit.ce('div', 'ic', icone));
    var tx = Kit.ce('div', 'tx', titre);
    if (sous) tx.appendChild(Kit.ce('small', null, sous));
    t.appendChild(tx);
    if (onclick) t.appendChild(Kit.ce('div', 'ar', '›'));
    corps.appendChild(t);
    return t;
  }

  /* ------------------------------------------------------------------ */
  /* Cartes contrat                                                      */
  /* ------------------------------------------------------------------ */

  function rendreCartes(corps, fiches, m) {
    corps.appendChild(Kit.section('Mes contrats'));
    fiches.forEach(function (f) {
      corps.appendChild(carte(f, m));
    });
  }

  function carte(f, m) {
    var c = f.contrat;
    var clos = !!(f.entree && f.entree.fige);
    var b = Kit.bouton('big' + (clos ? '' : ' warn'), function () { ouvrirEnfant(c, m); });

    var top = Kit.ce('div', 'top');
    top.appendChild(Kit.ce('div', 'av', (c.prenom_enfant || '?').charAt(0).toUpperCase()));
    var ident = Kit.ce('div');
    ident.appendChild(Kit.ce('div', 'nm', c.prenom_enfant));
    ident.appendChild(Kit.ce('div', 'fm', 'Famille ' + ((c.famille && c.famille.nom) || '—')));
    top.appendChild(ident);
    top.appendChild(Kit.ce('div', 'ar', '›'));
    b.appendChild(top);

    if (f.erreur) {
      b.appendChild(Kit.ce('div', 'sb q', 'Chiffres indisponibles : ' + Kit.messageErreur(f.erreur)));
      return b;
    }
    if (!f.entree) {
      b.appendChild(Kit.ce('div', 'sb q',
        'Ce contrat ne couvre pas ' + Kit.libelleMoisAnnee(m.annee, m.mois) + '.'));
      return b;
    }

    var r = f.entree.resultat;
    var stats = Kit.ce('div', 'stats');
    stat(stats, Kit.jours(r.joursPresence), 'présence');
    /* §2.1 : pas de montant d'entretien isolé sur l'accueil — le total seul. */
    stat(stats, Kit.eurCourt(r.totalAVerserCentimes), 'à verser');
    stat(stats, Kit.joursCp(cpDisponible(f.entree)), 'congés payés');
    b.appendChild(stats);

    var etat = Kit.ce('div', 'etat ' + (clos ? 'ok' : 'wa'),
      (clos ? '✓ ' : '● ') + Kit.moisCapitale(m.annee, m.mois).split(' ')[0] +
      (clos ? ' clôturé' : ' à clôturer'));
    b.appendChild(etat);
    return b;
  }

  function stat(parent, valeur, cle) {
    var s = Kit.ce('div', 'st');
    s.appendChild(Kit.ce('div', 'v', valeur));
    s.appendChild(Kit.ce('div', 'k', cle));
    parent.appendChild(s);
  }

  function cpDisponible(entree) {
    var cs = (entree && entree.resultat && entree.resultat.compteurSortie) || {};
    return (cs.dixiemesCpAcquis || 0) - (cs.dixiemesCpPris || 0);
  }

  function ouvrirEnfant(contrat, m) {
    global.App.aller('enfant', { contratId: contrat.id, annee: m.annee, mois: m.mois });
  }
  function ouvrirFiche(contrat) {
    global.App.aller('fiche', { contratId: contrat.id });
  }

  global.UiAccueil = { afficher: afficher, SEUIL_ALERTE_CP_DIXIEMES: SEUIL_ALERTE_CP_DIXIEMES };
})(window);
