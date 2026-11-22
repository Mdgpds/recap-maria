/* ============================================================================
   ui-recap.js — LOT 33 : le récap court, l'image à envoyer aux parents.

   « Maria aimerait avoir la possibilité d'envoyer une image assez succincte,
   avec seulement les infos clés. » Puis, sur une capture du bloc « Le mois »
   de l'espace enfant : « Maria aime ce récap. »

   LE MODÈLE EST LE BLOC « LE MOIS ». LA fonction qui rend ses lignes —
   `Kit.lignesDuMois`, dans js/ui-kit.js — est lue à la fois par le bloc de
   l'espace enfant (js/ui-enfant.js) et par le récap court. Deux copies d'une même
   liste finissent toujours par diverger, et ici l'une des deux part chez une
   famille.

   LES TROIS FORMES, UNE SEULE LISTE. Comme le document détaillé : un aperçu à
   l'écran, une image dessinée au canvas, un texte à copier. Tous les trois
   lisent le même `modele()`, et `contenu(modele)` dit, dans l'ordre, chaque
   morceau de texte que les trois doivent porter. Une différence entre eux est
   bloquante (test/lot33.smoke.js, test/mesures-390.js).

   AUCUN CALCUL. Chaque chiffre est une sortie du moteur ou de l'instantané,
   formatée par `Kit`. Ce module choisit, ordonne, met en forme — rien d'autre.
   Un mois clôturé lit son instantané : `calculerMois` n'est jamais appelé ici.

   L'IDENTITÉ DE L'APPLICATION. Fond blanc, vert d'accent, police système —
   pas l'identité papier du document détaillé. Les couleurs de l'image sont
   LUES dans les jetons de `:root` : aucune n'est écrite dans ce fichier.
   ========================================================================= */
(function (global) {
  'use strict';

  var Kit = global.Kit;
  var Chaine = global.ChaineMois;

  /* 1. LES LIGNES DU BLOC « LE MOIS » vivent dans js/ui-kit.js
     (`Kit.lignesDuMois`, `Kit.lignesPour`, `Kit.reservesFinDeMois`) : le bloc
     de l'espace enfant les lit là, et tous les écrans chargent Kit. Ce module
     les relit au même endroit — une seule source. */
  var lignesDuMois = function (p) { return Kit.lignesDuMois(p); };
  var lignesPour = function (ctx) { return Kit.lignesPour(ctx); };
  var reservesFinDeMois = function (p) { return Kit.reservesFinDeMois(p); };
  var travaillesDu = function (ctx) { return Kit.travaillesDu(ctx); };
  var conditionDu = function (ctx, champ) { return Kit.conditionDu(ctx, champ); };

  /* ------------------------------------------------------------------ */
  /* 2. LE MODÈLE DU RÉCAP COURT                                         */
  /* ------------------------------------------------------------------ */

  var ETATS = {
    previsionnel: 'Prévisionnel',
    definitif: 'Définitif',
    definitif_corrige: 'Définitif · corrigé'
  };

  /* Le récap court n'est PROPOSÉ qu'à partir du 25 pour le mois en cours
     (D2) ; un mois clôturé l'a toujours. Le 25 a déjà son nom :
     `Kit.JOUR_BASCULE_CLOTURE`. Un mois échu non clôturé garde le traitement
     d'aujourd'hui (le parcours de fin de mois) : on le clôture d'abord. */
  function estPropose(annee, mois, entree, aujourdhui) {
    if (!entree || !entree.resultat) return false;
    if (entree.fige) return true;
    if (!aujourdhui) return false;
    var a = Number(aujourdhui.slice(0, 4)), m = Number(aujourdhui.slice(5, 7)), j = Number(aujourdhui.slice(8, 10));
    return a === annee && m === mois && j >= Kit.JOUR_BASCULE_CLOTURE;
  }

  function identiteDu(ctx) {
    var r = ctx.entree.resultat;
    if (ctx.entree.fige && r.prenomEnfant) return { prenom: r.prenomEnfant, famille: r.nomFamille || null };
    return { prenom: ctx.contrat.prenom_enfant,
      famille: (ctx.contrat.famille && ctx.contrat.famille.nom) || null };
  }

  /* Un jour ouvrable du planning de ce contrat, pour la règle des plages. */
  function ouvrableDu(ctx) {
    var cond = ctx.entree.conditions || {};
    var jours = Kit.joursPlanning(ctx.contrat, cond.jours_planning || null, ctx.annee, ctx.mois);
    return function (d) { return jours.indexOf(d) !== -1 && !global.Feries.estJourFerie(d); };
  }

  /* « du 26 au 30 novembre », « le 26 et le 27 novembre », « le 30 novembre ».
     La règle des plages du lot 31 (`Kit.plagesDeJours`) : deux jours « le 26
     et le 27 », trois ou plus qui se suivent « du 26 au 30 ». Plusieurs
     plages : « le 23 novembre et du 26 au 30 novembre ». */
  function datesEnPlages(jours, ouvrable) {
    var plages = Kit.plagesDeJours(jours, { ouvrable: ouvrable });
    var bouts = plages.map(function (pl) {
      var t = Kit.libellePlageJours(pl);
      return t.charAt(0).toLowerCase() + t.slice(1);
    });
    if (bouts.length <= 1) return bouts[0] || '';
    return bouts.slice(0, -1).join(', ') + ' et ' + bouts[bouts.length - 1];
  }

  /* `ctx` : { contrat, entree, journees, annee, mois, aujourdhui,
     nomEmettrice }. Rend tout ce que les trois formes affichent. */
  function modele(ctx) {
    var r = ctx.entree.resultat;
    var clos = !!ctx.entree.fige;
    var id = identiteDu(ctx);
    var cond = ctx.entree.conditions || {};

    var aVenir = clos ? [] : Kit.joursRestantsListe(ctx.contrat, cond.jours_planning || null,
      ctx.annee, ctx.mois, ctx.aujourdhui, ctx.journees || {});

    var lignes = lignesPour(ctx);
    /* « 17 faits · 3 à venir » : SEULEMENT quand des journées restent et que
       le mois n'est pas clôturé. Les journées à venir viennent de
       `Kit.joursRestantsListe` (la liste dont `joursTravaillesRestants` est la
       longueur) ; les faites sont le reste des jours de présence. */
    var avancement = null;
    if (!clos && aVenir.length > 0) {
      avancement = { faits: r.joursPresence - aVenir.length, aVenir: aVenir.length };
      lignes[0].sous = avancement.faits + ' faits · ' + avancement.aVenir + ' à venir';
    }

    var emettrice = clos
      ? (r.nomEmettrice || 'votre assistante maternelle')
      : (ctx.nomEmettrice || 'votre assistante maternelle');

    var m = {
      prenom: id.prenom,
      famille: id.famille,
      annee: ctx.annee, mois: ctx.mois,
      titre: id.prenom + ' · ' + Kit.libelleMoisAnnee(ctx.annee, ctx.mois),
      sousTitre: id.famille ? 'famille ' + id.famille : '',
      clos: clos,
      etat: clos ? 'definitif' : 'previsionnel',
      lignes: lignes,
      avancement: avancement,
      reserves: reservesFinDeMois({ resultat: r, parJourConge: conditionDu(ctx, 'minutes_par_jour_conge') }),
      joursAVenir: aVenir,
      pied: null,
      signature: emettrice + ' · le ' + Kit.jourLong(ctx.aujourdhui).toLowerCase(),
      dateIso: ctx.aujourdhui
    };
    if (m.etat === 'previsionnel' && aVenir.length) {
      var un = aVenir.length === 1;
      m.pied = {
        gras: aVenir.length + (un ? ' journée à venir' : ' journées à venir'),
        suite: ' (' + datesEnPlages(aVenir, ouvrableDu(ctx)) + '), ' +
          (un ? 'comptée comme d’habitude. Je vous préviens si elle change.'
              : 'comptées comme d’habitude. Je vous préviens si l’une d’elles change.')
      };
    }
    m.libelleEtat = ETATS[m.etat];
    return m;
  }

  /* CE QUE LES TROIS FORMES DOIVENT PORTER, dans l'ordre. C'est la mesure
     d'égalité entre l'aperçu, l'image et le texte. */
  function contenu(m) {
    var out = [m.titre];
    if (m.sousTitre) out.push(m.sousTitre);
    out.push(m.libelleEtat);
    /* Par ligne : le libellé, ce qui s'écrit dessous, puis la valeur. */
    var rang = function (l) {
      out.push(l.libelle);
      if (l.sous) out.push(l.sous);
      if (l.ancien) out.push(l.ancien);
      out.push(l.valeur);
    };
    m.lignes.forEach(rang);
    if (m.reserves.length) {
      out.push('Mes réserves à la fin du mois');
      m.reserves.forEach(rang);
    }
    if (m.pied) out.push(m.pied.gras + m.pied.suite);
    out.push(m.signature);
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* 3. LE TEXTE À COPIER                                                */
  /* ------------------------------------------------------------------ */

  /* Une dizaine de lignes : même ordre, mêmes libellés que l'image. */
  function texte(m) {
    var t = [];
    t.push(m.titre + (m.sousTitre ? ' — ' + m.sousTitre : ''));
    t.push(m.libelleEtat);
    var ligne = function (l) {
      t.push(l.libelle + (l.sous ? ' (' + l.sous + ')' : '') + (l.ancien ? ' (' + l.ancien + ')' : '') +
        ' : ' + l.valeur);
    };
    m.lignes.forEach(ligne);
    if (m.reserves.length) {
      t.push('Mes réserves à la fin du mois');
      m.reserves.forEach(ligne);
    }
    if (m.pied) t.push(m.pied.gras + m.pied.suite);
    t.push(m.signature);
    return t.join('\n');
  }

  /* ------------------------------------------------------------------ */
  /* 4. L'APERÇU À L'ÉCRAN                                               */
  /* ------------------------------------------------------------------ */

  var CLASSE_ETAT = { previsionnel: 'prev', definitif: 'def', definitif_corrige: 'cor' };

  function apercu(m) {
    var c = Kit.ce('div', 'rcc ' + CLASSE_ETAT[m.etat]);
    c.setAttribute('data-etat', m.etat);
    var tete = Kit.ce('div', 'rcc-tete');
    var g = Kit.ce('div', 'rcc-id');
    g.appendChild(Kit.ce('div', 'rcc-ti', m.titre));
    if (m.sousTitre) g.appendChild(Kit.ce('div', 'rcc-fa', m.sousTitre));
    tete.appendChild(g);
    tete.appendChild(Kit.ce('span', 'rcc-et', m.libelleEtat));
    c.appendChild(tete);

    var corpsL = Kit.ce('div', 'rcc-lignes');
    m.lignes.forEach(function (l) { corpsL.appendChild(ligneApercu(l)); });
    c.appendChild(corpsL);

    if (m.reserves.length) {
      var res = Kit.ce('div', 'rcc-res');
      res.appendChild(Kit.ce('div', 'rcc-st', 'Mes réserves à la fin du mois'));
      m.reserves.forEach(function (l) { res.appendChild(ligneApercu(l)); });
      c.appendChild(res);
    }

    var pied = Kit.ce('div', 'rcc-pied');
    if (m.pied) {
      var p = Kit.ce('p', 'rcc-ph');
      p.appendChild(Kit.ce('b', null, m.pied.gras));
      p.appendChild(document.createTextNode(m.pied.suite));
      pied.appendChild(p);
    }
    pied.appendChild(Kit.ce('div', 'rcc-sig', m.signature));
    c.appendChild(pied);
    return c;
  }

  function ligneApercu(l) {
    var d = Kit.ce('div', 'rcc-l' + (l.total ? ' tot' : ''));
    d.setAttribute('data-cle', l.cle);
    var g = Kit.ce('span', 'rcc-lg', l.libelle);
    if (l.sous) g.appendChild(Kit.ce('span', 'rcc-sous' + (l.raison ? ' ch' : ''), l.sous));
    if (l.ancien) g.appendChild(Kit.ce('span', 'rcc-sous ch', l.ancien));
    d.appendChild(g);
    d.appendChild(Kit.ce('b', l.alerte ? 'wa' : null, l.valeur));
    return d;
  }

  /* ------------------------------------------------------------------ */
  /* 5. L'IMAGE — DESSINÉE AU CANVAS, SANS BIBLIOTHÈQUE                  */
  /* ------------------------------------------------------------------ */

  /* Largeur de dessin : 360 points à l'échelle 3 — nette dans une
     conversation. Hauteur : celle du contenu. Aucun texte sous 11 points. */
  var LARGEUR = 360, ECHELLE = 3, MARGE = 16;
  var POLICE = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  var TAILLE_MIN = 11;

  /* Les couleurs, LUES dans les jetons de `:root`. Un jeton absent rend une
     chaîne vide, et le canvas garde alors sa couleur précédente : on ne
     remplace jamais par une valeur écrite ici. */
  function jetons() {
    var cs = global.getComputedStyle(document.documentElement);
    var j = function (n) { return cs.getPropertyValue(n).trim(); };
    return { fond: j('--bg2'), ink: j('--ink'), ink2: j('--ink2'), ink3: j('--ink3'), ln: j('--ln'),
      ac: j('--ac'), acs: j('--acs'), acl2: j('--acl2'), wa: j('--wa'), was: j('--was'),
      wal: j('--wal'), wad: j('--wad') };
  }

  function police(taille, graisse) {
    return (graisse ? graisse + ' ' : '') + taille + 'px ' + POLICE;
  }

  /* Découpe un texte en lignes qui tiennent dans `largeur`. */
  function couper(g, t, largeur) {
    var mots = String(t).split(' ');
    var lignes = [], ligne = '';
    mots.forEach(function (mot) {
      var essai = ligne ? ligne + ' ' + mot : mot;
      if (g.measureText(essai).width > largeur && ligne) { lignes.push(ligne); ligne = mot; }
      else ligne = essai;
    });
    if (ligne) lignes.push(ligne);
    return lignes;
  }

  /* LA COMPOSITION : un plan d'opérations (rectangles, traits, textes), bâti
     avec un contexte de mesure, puis rejoué sur le canvas définitif. Le plan
     est gardé sur le canvas (`plan`) : c'est ce que la mesure en vrai
     navigateur relit pour vérifier qu'aucun texte ne sort du cadre. */
  function composer(g, m, J) {
    var ops = [];
    var L = LARGEUR, x0 = MARGE, x1 = LARGEUR - MARGE;
    var texteOp = function (t, x, y, taille, graisse, couleur, align) {
      g.font = police(taille, graisse);
      var w = g.measureText(t).width;
      ops.push({ t: 'texte', texte: t, x: x, y: y, taille: taille, graisse: graisse || '',
        couleur: couleur, align: align || 'left', largeur: w });
      return w;
    };
    var y = MARGE;

    /* En-tête : titre, famille, et l'état à droite. */
    g.font = police(11, '700');
    var etat = m.libelleEtat.toUpperCase();
    var wEtat = g.measureText(etat).width + 16;
    g.font = police(15, '700');
    var wTitre = g.measureText(m.titre).width;
    var etatSeul = wTitre + 10 + wEtat > x1 - x0;
    var couleursEtat = m.etat === 'previsionnel'
      ? { fond: J.was, bord: J.wal, texte: J.wa } : { fond: J.acs, bord: J.acl2, texte: J.ac };
    /* Ordre de lecture : titre, famille, puis l'état — celui de l'aperçu. */
    var yTete = y;
    texteOp(m.titre, x0, y + 15, 15, '700', J.ink);
    y += 21;
    if (m.sousTitre) { texteOp(m.sousTitre, x0, y + 13, 11.5, '', J.ink3); y += 17; }
    if (!etatSeul) {
      ops.push({ t: 'rect', x: x1 - wEtat, y: yTete + 1, w: wEtat, h: 20, fond: couleursEtat.fond, bord: couleursEtat.bord, rayon: 10 });
      texteOp(etat, x1 - wEtat / 2, yTete + 15, 11, '700', couleursEtat.texte, 'center');
    }
    if (etatSeul) {
      ops.push({ t: 'rect', x: x0, y: y + 3, w: wEtat, h: 20, fond: couleursEtat.fond, bord: couleursEtat.bord, rayon: 10 });
      texteOp(etat, x0 + wEtat / 2, y + 17, 11, '700', couleursEtat.texte, 'center');
      y += 25;
    }
    y += 10;
    ops.push({ t: 'trait', x1: 0, y1: y, x2: L, y2: y, couleur: J.ln, ep: 1 });

    var rangee = function (l, dernier) {
      var total = !!l.total;
      if (total) {
        y += 4;
        ops.push({ t: 'trait', x1: x0, y1: y, x2: x1, y2: y, couleur: J.ink, ep: 1.5 });
      }
      var tailleV = total ? 19 : 13.5, tailleL = total ? 14 : 13.5;
      g.font = police(tailleV, '700');
      var wV = g.measureText(l.valeur).width;
      g.font = police(tailleL, total ? '600' : '');
      var lignesL = couper(g, l.libelle, x1 - x0 - wV - 12);
      var yHaut = y + 10;
      var yL = yHaut + tailleL;
      lignesL.forEach(function (t, i) {
        texteOp(t, x0, yL + i * (tailleL + 4), tailleL, total ? '600' : '', J.ink);
      });
      var yBas = yL + (lignesL.length - 1) * (tailleL + 4);
      var sous = [];
      if (l.sous) sous.push({ t: l.sous, ch: !!l.raison });
      if (l.ancien) sous.push({ t: l.ancien, ch: true });
      sous.forEach(function (s) {
        g.font = police(TAILLE_MIN, s.ch ? '600' : '');
        couper(g, s.t, x1 - x0 - wV - 12).forEach(function (t) {
          yBas += 15;
          texteOp(t, x0, yBas, TAILLE_MIN, s.ch ? '600' : '', s.ch ? J.wad : J.ink3);
        });
      });
      /* La valeur est posée APRÈS ce qui s'écrit sous le libellé : le plan
         suit l'ordre de lecture des deux autres formes. */
      texteOp(l.valeur, x1, yHaut + (total ? 17 : tailleL), tailleV, '700', l.alerte ? J.wa : J.ink, 'right');
      y = Math.max(yBas, yHaut + (total ? 20 : tailleL)) + 10;
      if (!total && !dernier) ops.push({ t: 'trait', x1: x0, y1: y, x2: x1, y2: y, couleur: J.ln, ep: 1 });
    };

    m.lignes.forEach(function (l, i) { rangee(l, i === m.lignes.length - 1 || (m.lignes[i + 1] && m.lignes[i + 1].total)); });

    if (m.reserves.length) {
      y += 4;
      ops.push({ t: 'trait', x1: 0, y1: y, x2: L, y2: y, couleur: J.ln, ep: 1 });
      y += 8;
      texteOp('MES RÉSERVES À LA FIN DU MOIS', x0, y + 12, TAILLE_MIN, '700', J.ink3);
      y += 14;
      m.reserves.forEach(function (l, i) { rangee(l, i === m.reserves.length - 1); });
    }

    /* Le pied : la phrase d'état, puis « émettrice · le <date> ». */
    y += 4;
    var hautPied = y;
    var debutPied = ops.length;
    y += 10;
    if (m.pied) {
      var mots = [];
      m.pied.gras.split(' ').forEach(function (w) { mots.push({ w: w, g: true }); });
      m.pied.suite.replace(/^ /, '').split(' ').forEach(function (w) { mots.push({ w: w, g: false }); });
      var x = x0, yl = y + 12;
      var espace = function (gr) { g.font = police(12, gr ? '700' : ''); return g.measureText(' ').width; };
      mots.forEach(function (mot, i) {
        g.font = police(12, mot.g ? '700' : '');
        var w = g.measureText(mot.w).width;
        if (x + w > x1 && x > x0) { x = x0; yl += 16; }
        texteOp(mot.w, x, yl, 12, mot.g ? '700' : '', mot.g ? J.ink : J.ink2);
        x += w + espace(mot.g);
      });
      y = yl + 8;
    }
    texteOp(m.signature, x0, y + 12, TAILLE_MIN, '', J.ink3);
    y += 18 + MARGE - 6;
    var fondPied = m.etat === 'definitif' ? J.acs : (m.pied ? J.was : null);
    if (fondPied) ops.splice(debutPied, 0, { t: 'rect', x: 0, y: hautPied, w: L, h: y - hautPied, fond: fondPied });
    ops.splice(debutPied, 0, { t: 'trait', x1: 0, y1: hautPied, x2: L, y2: hautPied, couleur: J.ln, ep: 1 });
    return { hauteur: Math.ceil(y), ops: ops };
  }

  function rejouer(g, plan, J) {
    g.fillStyle = J.fond;
    g.fillRect(0, 0, LARGEUR, plan.hauteur);
    plan.ops.forEach(function (o) {
      if (o.t === 'rect') {
        g.beginPath();
        if (o.rayon && g.roundRect) g.roundRect(o.x, o.y, o.w, o.h, o.rayon); else g.rect(o.x, o.y, o.w, o.h);
        if (o.fond) { g.fillStyle = o.fond; g.fill(); }
        if (o.bord) { g.strokeStyle = o.bord; g.lineWidth = 1; g.stroke(); }
      } else if (o.t === 'trait') {
        g.strokeStyle = o.couleur; g.lineWidth = o.ep;
        g.beginPath(); g.moveTo(o.x1, o.y1); g.lineTo(o.x2, o.y2); g.stroke();
      } else {
        g.font = police(o.taille, o.graisse);
        g.fillStyle = o.couleur;
        g.textAlign = o.align;
        g.fillText(o.texte, o.x, o.y);
      }
    });
    g.textAlign = 'left';
  }

  function dessiner(m) {
    var mesure = document.createElement('canvas').getContext('2d');
    if (!mesure) throw new Error('canvas indisponible');
    var J = jetons();
    var plan = composer(mesure, m, J);
    var canvas = document.createElement('canvas');
    canvas.width = LARGEUR * ECHELLE;
    canvas.height = plan.hauteur * ECHELLE;
    var g = canvas.getContext('2d');
    if (!g) throw new Error('canvas indisponible');
    g.scale(ECHELLE, ECHELLE);
    rejouer(g, plan, J);
    canvas.plan = plan;
    canvas.largeurPoints = LARGEUR;
    return canvas;
  }

  function sansAccent(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  }
  function nomFichier(m) {
    return 'recap-' + sansAccent(m.prenom) + '-' + sansAccent(Kit.libelleMois(m.mois)) + '-' + m.annee + '.png';
  }

  /* ------------------------------------------------------------------ */
  /* 6. LE BLOC « L'IMAGE À ENVOYER » DU DOCUMENT DU MOIS                */
  /* ------------------------------------------------------------------ */

  /* `ctx.envois` : les envois déjà notés pour ce contrat et ce mois (ou
     `null` s'ils n'ont pas pu être lus). `opts.versDetaille()` : mène au
     récapitulatif détaillé, juste dessous. */
  function blocImageAEnvoyer(ctx, opts) {
    opts = opts || {};
    var m = modele(ctx);
    var bloc = Kit.ce('div', 'rc-bloc');
    bloc.appendChild(Kit.ttl('L’image à envoyer'));

    /* Les envois déjà notés, dits en clair. */
    var etatEnvois = Kit.ce('div', 'rc-envois');
    bloc.appendChild(etatEnvois);
    var redireEnvois = function () {
      Kit.vider(etatEnvois);
      envoisDuMois(ctx.envois, ctx.annee, ctx.mois).forEach(function (e) {
        etatEnvois.appendChild(Kit.ce('p', 'rc-envoye', '✓ ' + phraseEnvoi(e, m)));
      });
      if (ctx.envois === null) {
        etatEnvois.appendChild(Kit.ce('p', 'sb q', 'Les envois déjà faits n’ont pas pu être lus.'));
      }
    };
    redireEnvois();

    bloc.appendChild(apercu(m));

    /* « J'ai envoyé le récap » — seulement après un geste dont l'issue est
       inconnue de l'application : le repli par téléchargement, ou la copie
       du texte. Le partage abouti, lui, note tout seul. */
    var zoneConfirmer = Kit.ce('div', 'rc-confirmer');
    var proposerJaiEnvoye = function () {
      Kit.vider(zoneConfirmer);
      zoneConfirmer.appendChild(Kit.ce('p', 'sb q',
        'L’application ne sait pas si le récap est parti. S’il l’est, dites-le-lui :'));
      var b = Kit.bouton('btn gh', function () { noter(b); });
      b.textContent = 'J’ai envoyé le récap';
      zoneConfirmer.appendChild(b);
    };
    var noter = function (bouton) {
      if (bouton) bouton.disabled = true;
      return noterEnvoi(ctx, m).then(function (ligne) {
        Kit.vider(zoneConfirmer);
        if (ctx.envois) ctx.envois.push(ligne); else ctx.envois = [ligne];
        redireEnvois();
        if (opts.apresEnvoi) opts.apresEnvoi(ligne);
      }).catch(function (e) {
        if (bouton) bouton.disabled = false;
        Kit.toast('L’envoi n’a pas pu être noté : ' + Kit.messageErreur(e) +
          ' Le récap, lui, est peut-être parti.', true);
      });
    };

    var bEnvoyer = Kit.bouton('btn', function () {
      envoyer(m, bEnvoyer).then(function (issue) {
        /* L'application n'affirme jamais qu'un récap est parti si elle ne le
           sait pas. Partage abouti → noté. Partage refermé → rien, et rien
           n'est reproché. Repli par téléchargement → c'est Maria qui dit. */
        if (issue === 'partage') return noter(null);
        if (issue === 'telecharge') proposerJaiEnvoye();
      });
    });
    bEnvoyer.textContent = 'Envoyer aux parents';
    bloc.appendChild(bEnvoyer);
    var bCopier = Kit.bouton('btn nt', function () {
      Kit.copierTexte(texte(m)).then(proposerJaiEnvoye, function () {});
    });
    bCopier.textContent = 'Copier le texte';
    bloc.appendChild(bCopier);
    bloc.appendChild(zoneConfirmer);
    if (opts.versDetaille) {
      var lien = Kit.bouton('lien2', opts.versDetaille);
      lien.textContent = 'Voir le récapitulatif détaillé';
      bloc.appendChild(lien);
    }
    return bloc;
  }

  /* « Envoyer aux parents » passe par le partage existant. */
  function envoyer(m, bouton) {
    var canvas;
    try { canvas = dessiner(m); }
    catch (e) {
      Kit.toast('Image impossible à produire sur cet appareil. Utilisez « Copier le texte ».', true);
      return Promise.resolve('echec');
    }
    bouton.disabled = true;
    return Kit.partagerImage(canvas, nomFichier(m)).then(function (issue) {
      bouton.disabled = false;
      return issue;
    });
  }

  /* ------------------------------------------------------------------ */
  /* 7. LES ENVOIS — CE QU'ON GARDE, CE QU'ON EN DIT (§5.4, §5.5)        */
  /* ------------------------------------------------------------------ */

  /* L'état d'une journée, sous une forme comparable : la ligne saisie réduite
     à ce qui la distingue, ou '' pour une journée sans ligne (« comme
     d'habitude »). Deux états égaux décrivent la même journée. */
  var CHAMPS_ETAT_JOUR = ['type', 'ecart_evenement', 'ecart_heure_reelle', 'ecart_minutes',
    'ecart_impute_sur', 'entretien_du', 'minutes_reelles', 'demi_journee',
    'minutes_sup_exceptionnelles', 'minutes_sup_renoncees', 'sup_dues_override', 'entretien_centimes'];
  function cleJournee(ligne) {
    if (!ligne) return '';
    return CHAMPS_ETAT_JOUR.map(function (k) {
      var v = ligne[k];
      return v === undefined || v === null ? '' : String(v);
    }).join('|');
  }

  /* L'état de chaque journée du planning du mois, à cet instant. Un mois
     clôturé n'a plus ses journées sous la main de l'écran : on garde alors ce
     que l'écran a reçu. */
  function etatsDesJours(ctx) {
    var cond = ctx.entree.conditions || {};
    var out = {};
    Kit.joursPlanning(ctx.contrat, cond.jours_planning || null, ctx.annee, ctx.mois).forEach(function (d) {
      var l = (ctx.journees || {})[d];
      out[d] = { c: cleJournee(l), t: l ? l.type : (global.Feries.estJourFerie(d) ? 'ferie' : 'presence') };
    });
    return out;
  }

  /* Les données de l'image telle qu'elle part : chaque ligne affichée, en
     centimes et en minutes ENTIERS (`n`), avec son libellé et sa valeur
     formatée ; les réserves ; l'état de chaque journée du mois. C'est ce que
     la comparaison du dernier jour relit — elle ne recalcule jamais l'ancien
     mois. */
  function donneesEnvoi(ctx, m) {
    var garde = function (l) { return { cle: l.cle, libelle: l.libelle, valeur: l.valeur, n: l.n, unite: l.unite }; };
    return {
      version: 1,
      etat: m.etat,
      lignes: m.lignes.map(garde),
      reserves: m.reserves.map(garde),
      joursAVenir: m.joursAVenir.slice(),
      jours: etatsDesJours(ctx)
    };
  }

  function noterEnvoi(ctx, m) {
    return global.DB.enregistrerEnvoi({
      contrat_id: ctx.contrat.id, annee: ctx.annee, mois: ctx.mois,
      nature: m.clos ? 'definitif' : 'previsionnel',
      donnees: donneesEnvoi(ctx, m)
    }).then(function (ligne) {
      global.App.invalider();
      /* Un définitif envoyé sur un mois clôturé coche aussi « Transmis à la
         famille » — par la fonction existante, idempotente, sans la
         réécrire. Un échec ici n'annule pas l'envoi noté : on le dit. */
      if (m.clos && global.DB.marquerTransmis) {
        return global.DB.marquerTransmis(ctx.contrat.id, ctx.annee, ctx.mois)
          .catch(function (e) {
            Kit.toast('Envoi noté, mais « Transmis à la famille » n’a pas pu être coché : ' +
              Kit.messageErreur(e), true);
          })
          .then(function () { return ligne; });
      }
      return ligne;
    });
  }

  function envoisDuMois(envois, annee, mois) {
    return (envois || []).filter(function (e) { return e && e.annee === annee && e.mois === mois; })
      .sort(function (a, b) { return String(a.envoye_le).localeCompare(String(b.envoye_le)); });
  }

  /* Le dernier prévisionnel, et y a-t-il un définitif APRÈS lui ? */
  function situationEnvois(envois, annee, mois) {
    var liste = envoisDuMois(envois, annee, mois);
    var dernierPrev = null, definitifApres = false, dernier = liste[liste.length - 1] || null;
    liste.forEach(function (e) {
      if (e.nature === 'previsionnel') { dernierPrev = e; definitifApres = false; }
      else if (e.nature === 'definitif' && dernierPrev) definitifApres = true;
    });
    return { liste: liste, dernierPrev: dernierPrev, definitifApres: definitifApres, dernier: dernier };
  }

  /* Un instant (horodatage du serveur) lu en heure LOCALE du téléphone :
     c'est un instant, pas une date de calendrier — on le décompose avec les
     accesseurs locaux, jamais avec `toISOString()`. */
  function instantLocal(ts) {
    var d = new Date(ts);
    return { jour: d.getDate(), mois: d.getMonth() + 1, h: d.getHours(), mn: d.getMinutes() };
  }
  function phraseEnvoi(e, m) {
    var t = instantLocal(e.envoye_le);
    var qui = m && m.famille ? 'la famille ' + m.famille : 'la famille';
    var nature = e.nature === 'definitif' ? 'Définitif envoyé à ' : 'Envoyé à ';
    return nature + qui + ' le ' + (t.jour === 1 ? '1er' : t.jour) + ' ' + Kit.libelleMois(t.mois) +
      ' à ' + t.h + '\u202fh\u202f' + String(t.mn).padStart(2, '0');
  }
  function jourDEnvoi(e) {
    var t = instantLocal(e.envoye_le);
    return t.jour === 1 ? '1er' : String(t.jour);
  }

  /* ------------------------------------------------------------------ */
  /* 8. LA LIGNE DE LA CARTE DE L'ENFANT, SUR L'ACCUEIL (§5.1)           */
  /* ------------------------------------------------------------------ */

  /* `p` : { m (mois courant), aujourdhui, entree (mois courant), restants,
     precedent (l'entrée du mois d'avant, ou null), envois (de ce contrat) }.
     Rend `null` quand il n'y a rien à faire, sinon
     { annee, mois, titre, sous, bouton, ton, action }. Le tableau du §5.1,
     état par état — et rien d'autre. */
  function ligneCarte(p) {
    if (p.envois === null || p.envois === undefined) return null;   // envois illisibles : on se tait
    var cur = ligneDuMois(p.m.annee, p.m.mois, p.entree, p.restants, p.envois, p.aujourdhui, true);
    if (cur) return cur;
    /* Un mois PASSÉ garde le traitement d'aujourd'hui (retards, fin de mois
       guidée), sauf s'il porte un prévisionnel envoyé. */
    var prev = moisAvant(p.m);
    if (p.precedent) return ligneDuMois(prev.annee, prev.mois, p.precedent, 0, p.envois, p.aujourdhui, false);
    return null;
  }

  function moisAvant(m) { return m.mois === 1 ? { annee: m.annee - 1, mois: 12 } : { annee: m.annee, mois: m.mois - 1 }; }

  function ligneDuMois(annee, mois, entree, restants, envois, auj, courant) {
    if (!entree || !entree.resultat) return null;
    var s = situationEnvois(envois, annee, mois);
    var nomMois = Kit.libelleMois(mois);
    var base = { annee: annee, mois: mois };
    if (entree.fige) {
      if (s.dernierPrev && !s.definitifApres) {
        return Object.assign(base, { titre: nomMois.charAt(0).toUpperCase() + nomMois.slice(1) + ' est clôturé',
          sous: 'récap définitif à envoyer', bouton: 'Envoyer', ton: 'ac', action: 'envoyer' });
      }
      return null;
    }
    if (s.dernierPrev) {
      if (courant && restants > 0) {
        return Object.assign(base, { titre: 'Récap envoyé le ' + jourDEnvoi(s.dernierPrev),
          sous: 'le mois reste ouvert', bouton: 'Voir', ton: '', action: 'voir' });
      }
      return Object.assign(base, { titre: 'Récap envoyé le ' + jourDEnvoi(s.dernierPrev),
        sous: 'à confirmer avant de clôturer', bouton: 'Confirmer', ton: 'w', action: 'confirmer' });
    }
    if (!courant) return null;
    if (!entree.resultat.salaireNetCentimes || entree.salaireManquant) return null;
    if (!estPropose(annee, mois, entree, auj)) return null;
    return Object.assign(base, { titre: 'Récap ' + Kit.deMois(mois),
      sous: 'prêt à envoyer aux parents', bouton: 'Préparer', ton: 'ac', action: 'preparer' });
  }

  /* L'écran où mène chaque bouton de la ligne. */
  var ECRAN_ACTION = { preparer: 'preparer', voir: 'preparer', confirmer: 'document', envoyer: 'document' };

  function etageRecap(contrat, l) {
    var b = Kit.ce('div', 'etg-rc' + (l.ton ? ' ' + l.ton : ''));
    b.setAttribute('data-action', l.action);
    var g = Kit.ce('span', 'gro');
    g.appendChild(Kit.ce('b', null, l.titre));
    g.appendChild(document.createTextNode(' — ' + l.sous));
    b.appendChild(g);
    var bt = Kit.bouton('etg-rc-b', function () {
      global.App.aller(ECRAN_ACTION[l.action], { contratId: contrat.id, annee: l.annee, mois: l.mois });
    });
    bt.textContent = l.bouton;
    b.appendChild(bt);
    return b;
  }

  /* ------------------------------------------------------------------ */
  /* 9. L'ÉCRAN « PRÉPARER LE RÉCAP » (§5.2)                             */
  /* ------------------------------------------------------------------ */

  function afficher(ctx) {
    if (ctx.vue === 'preparer') return afficherPreparer(ctx);
    return Promise.resolve();
  }

  function chargerMois(params) {
    var contrat = global.App.contratParId(params.contratId);
    var avoir = contrat ? Promise.resolve(contrat)
      : global.App.tousLesContrats().then(function () { return global.App.contratParId(params.contratId); });
    return avoir.then(function (c) {
      if (!c) throw new Error('contrat introuvable');
      var m = { annee: params.annee, mois: params.mois };
      return Promise.all([
        global.App.serie(c, m),
        global.App.journees(c.id, m.annee, m.mois),
        global.DB.listEnvois([c.id], [m]).catch(function () { return null; })
      ]).then(function (r) {
        var entree = global.App.moisDe(r[0], m.annee, m.mois);
        if (!entree) throw new Error('mois hors du contrat');
        return { contrat: c, entree: entree, journees: r[1], envois: r[2], annee: m.annee, mois: m.mois,
          aujourdhui: global.App.aujourdhui(),
          nomEmettrice: (global.App.nomEmettrice && global.App.nomEmettrice()) || null };
      });
    });
  }

  /* « 8 h 30 – 18 h » — les heures de l'avenant en vigueur, ou rien. */
  function heureCourte(v) {
    var s = String(v || '').slice(0, 5);
    if (!/^\d{2}:\d{2}$/.test(s)) return '';
    var h = Number(s.slice(0, 2)), mn = s.slice(3, 5);
    return h + '\u202fh' + (mn === '00' ? '' : '\u202f' + mn);
  }
  function horaireDu(ctx) {
    var a = heureCourte(conditionDu(ctx, 'heure_arrivee')), d = heureCourte(conditionDu(ctx, 'heure_depart'));
    return a && d ? a + ' – ' + d : '';
  }

  /* L'état d'une journée, dit en clair pour Maria. */
  function etatJourneeTexte(ctx, d) {
    var c = ctx.contrat;
    var l = (ctx.journees || {})[d];
    if (!l || (l.type === 'presence' && !l.ecart_evenement)) {
      var h = horaireDu(ctx);
      var entretien = l && l.entretien_du === false ? 'pas d’entretien' : 'entretien dû';
      return h ? 'Comme d’habitude · ' + h + ' · ' + entretien : 'Comme d’habitude';
    }
    var heure = heureCourte(l.ecart_heure_reelle);
    var ent = l.entretien_du === false ? ' · pas d’entretien' : ' · entretien dû';
    if (l.type === 'absence_enfant') return c.prenom_enfant + ' ' + Kit.accordDe(c, 'absent') + ' · pas d’entretien';
    if (l.type === 'conge_maria') return 'Congé de l’assistante maternelle';
    if (l.type === 'sans_solde') return 'Congé sans solde';
    if (l.type === 'hors_planning') return 'Journée non travaillée';
    if (l.type === 'familiarisation') return 'Familiarisation';
    if (l.ecart_evenement === 'liberation_anticipee' && heure) return Kit.accordDe(c, 'parti') + ' à ' + heure + ent;
    if (l.ecart_evenement === 'retard_parent' && heure) return Kit.accordDe(c, 'parti') + ' à ' + heure + ' — parent en retard' + ent;
    if (l.ecart_evenement === 'arrivee_decalee' && heure) return Kit.accordDe(c, 'arrivé') + ' à ' + heure + ent;
    if (l.ecart_evenement === 'conge_horaire') return 'Congé posé à l’heure';
    return 'Journée modifiée' + ent;
  }

  /* Les journées du planning à venir dans le mois, hors férié — y compris
     celles qui portent déjà une déclaration : chacune dit son état. */
  function journeesQuiRestent(ctx) {
    var cond = ctx.entree.conditions || {};
    return Kit.joursPlanning(ctx.contrat, cond.jours_planning || null, ctx.annee, ctx.mois)
      .filter(function (d) { return d > ctx.aujourdhui && !global.Feries.estJourFerie(d); });
  }

  /* Le dernier jour travaillé du mois — « vous confirmerez le lundi 30
     novembre ». */
  function dernierJourTravaille(ctx) {
    var cond = ctx.entree.conditions || {};
    var j = Kit.joursPlanning(ctx.contrat, cond.jours_planning || null, ctx.annee, ctx.mois)
      .filter(function (d) { return !global.Feries.estJourFerie(d); });
    return j[j.length - 1] || Kit.iso(ctx.annee, ctx.mois, Kit.nbJoursDansMois(ctx.annee, ctx.mois));
  }

  function afficherPreparer(ctx) {
    var p = ctx.params;
    global.App.barreSlim(ctx.barre, 'Récap ' + Kit.deMois(p.mois), { droite: '' });
    ctx.corps.appendChild(Kit.ce('div', 'attente', 'Préparation du récap…'));
    return chargerMois(p).then(function (rc) {
      Kit.vider(ctx.corps);
      global.App.barreSlim(ctx.barre, 'Récap ' + Kit.deMois(p.mois), { droite: rc.contrat.prenom_enfant });
      rendrePreparer(ctx.corps, rc);
    });
  }

  function rendrePreparer(corps, rc) {
    var e = rc.entree;
    if (e.fige) {
      corps.appendChild(Kit.enc('', 'Ce mois est clôturé.', ' Son récap définitif se trouve dans le document du mois.'));
      corps.appendChild(boutonDocument(rc, 'Voir le document du mois'));
      return;
    }
    if (!estPropose(rc.annee, rc.mois, e, rc.aujourdhui)) {
      corps.appendChild(Kit.enc('', 'Le récap se prépare à partir du 25.', ''));
      return;
    }
    var s = situationEnvois(rc.envois, rc.annee, rc.mois);
    var restent = journeesQuiRestent(rc);
    var dernier = dernierJourTravaille(rc);

    if (s.dernierPrev) {
      corps.appendChild(Kit.enc('', 'Récap prévisionnel envoyé.',
        ' Le mois reste ouvert : vous confirmerez le ' + Kit.quantieme(dernier) + ' que tout s’est passé comme prévu.'));
      s.liste.forEach(function (x) { corps.appendChild(Kit.ce('p', 'rc-envoye', '✓ ' + phraseEnvoi(x, modele(rc)))); });
    } else if (restent.length) {
      corps.appendChild(Kit.enc('', 'Vous pouvez envoyer le récap dès aujourd’hui.',
        ' Les journées qui restent sont comptées comme d’habitude.'));
    } else {
      corps.appendChild(Kit.enc('', 'Le mois est entièrement saisi.',
        ' Vous pouvez envoyer le récap dès aujourd’hui.'));
    }

    if (restent.length) {
      corps.appendChild(Kit.ttl(restent.length > 1
        ? 'Les ' + restent.length + ' journées qui restent'
        : 'La journée qui reste'));
      var carteJ = Kit.ce('div', 'cd pad0 rc-jours');
      restent.forEach(function (d) { carteJ.appendChild(ligneJourneeModifiable(rc, d)); });
      corps.appendChild(carteJ);
    }

    var tot = Kit.ce('div', 'cd pad0');
    Kit.ligneLn(tot, 'Total prévu du mois', Kit.eur(e.resultat.totalAVerserCentimes), { total: true });
    corps.appendChild(tot);

    var voir = boutonDocument(rc, 'Voir l’image à envoyer');
    voir.className = 'btn';
    corps.appendChild(voir);
    corps.appendChild(Kit.ce('p', 'pfin', 'Le mois reste ouvert : vous confirmerez le ' +
      Kit.jourLong(dernier).toLowerCase() + '.'));
  }

  function boutonDocument(rc, libelle) {
    var b = Kit.bouton('btn nt', function () {
      global.App.aller('document', { contratId: rc.contrat.id, annee: rc.annee, mois: rc.mois });
    });
    b.textContent = libelle;
    return b;
  }

  /* Une journée qui reste, avec « Modifier » : la feuille du jour habituelle
     (§5.3), ouverte par l'espace enfant sur cette journée à venir. */
  function ligneJourneeModifiable(rc, d) {
    var l = Kit.ce('div', 'ln rc-j');
    l.setAttribute('data-jour', d);
    var g = Kit.ce('span', null, Kit.jourLong(d));
    g.appendChild(Kit.ce('span', 'sb2', etatJourneeTexte(rc, d)));
    l.appendChild(g);
    var b = Kit.bouton('rc-mod', function () {
      global.UiEnfant.modifierJourAVenir(rc.contrat, d);
    });
    b.textContent = 'Modifier';
    l.appendChild(b);
    return l;
  }

  global.UiRecap = {
    afficher: afficher,
    ligneCarte: ligneCarte,
    etageRecap: etageRecap,
    situationEnvois: situationEnvois,
    donneesEnvoi: donneesEnvoi,
    etatsDesJours: etatsDesJours,
    cleJournee: cleJournee,
    etatJourneeTexte: etatJourneeTexte,
    journeesQuiRestent: journeesQuiRestent,
    phraseEnvoi: phraseEnvoi,
    lignesDuMois: lignesDuMois,
    lignesPour: lignesPour,
    reservesFinDeMois: reservesFinDeMois,
    travaillesDu: travaillesDu,
    estPropose: estPropose,
    modele: modele,
    contenu: contenu,
    texte: texte,
    apercu: apercu,
    dessiner: dessiner,
    nomFichier: nomFichier,
    blocImageAEnvoyer: blocImageAEnvoyer,
    datesEnPlages: datesEnPlages,
    LARGEUR: LARGEUR, ECHELLE: ECHELLE, TAILLE_MIN: TAILLE_MIN
  };
})(window);
