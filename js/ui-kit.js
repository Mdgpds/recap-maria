/* ============================================================================
   ui-kit.js — Boîte à outils d'interface (lot 6).

   Ce module ne contient AUCUNE règle de calcul et ne parle jamais au réseau.
   Il porte ce que les sept écrans de la refonte ont en commun :
     - fabrication d'éléments DOM et mise en forme (via js/format.js) ;
     - barre haute, feuille en bas d'écran, message éphémère ;
     - sélecteurs de date par listes déroulantes — jamais de clavier (§2.3 des
       specs : « aucune date ne se tape jamais au clavier, nulle part ») ;
     - lecture du CALENDRIER d'un mois (jours du planning, fériés, congés).

   Sur ce dernier point, la frontière est volontairement étroite : « quels jours
   du mois Maria a-t-elle travaillé » est une lecture d'almanach — jours du
   planning du contrat, moins les fériés de feries.js, moins les journées où une
   ligne dit qu'elle ne travaillait pas. Aucun euro, aucun compteur, aucune
   minute n'est calculé ici : tout cela vient de Engine. La fonction s'appuie
   d'ailleurs sur `Engine.joursDuMois` et `Engine.jourSemaine`, exposés par le
   moteur « pour les tests et l'interface ».
   ========================================================================= */
(function (global) {
  'use strict';

  var Format = global.Format;
  var Feries = global.Feries;

  var NBSP = ' ';

  /* ------------------------------------------------------------------ */
  /* DOM                                                                 */
  /* ------------------------------------------------------------------ */

  function ce(tag, classe, texte) {
    var e = document.createElement(tag);
    if (classe) e.className = classe;
    if (texte != null) e.textContent = texte;
    return e;
  }

  function vider(el) { while (el && el.firstChild) el.removeChild(el.firstChild); }

  /* Bouton : un vrai <button>, jamais un <div> cliquable — la maquette dessine
     des cartes, mais une carte qui agit doit rester atteignable au clavier et
     annoncée comme un bouton. */
  function bouton(classe, onclick) {
    var b = ce('button', classe);
    b.type = 'button';
    if (onclick) b.addEventListener('click', onclick);
    return b;
  }

  function ajouter(parent, enfant) { parent.appendChild(enfant); return enfant; }

  /* ------------------------------------------------------------------ */
  /* Mise en forme (déléguée à format.js, jamais réécrite)               */
  /* ------------------------------------------------------------------ */

  function eur(centimes) {
    return Format ? Format.centimesEnEuros(centimes || 0) : ((centimes || 0) / 100) + ' €';
  }
  /* Montant sans les centimes quand ils sont nuls — l'accueil affiche des
     mini-chiffres, « 1 340 € » y tient là où « 1 340,00 € » déborde. */
  function eurCourt(centimes) {
    var t = eur(centimes);
    return t.replace(',00' + NBSP + '€', NBSP + '€');
  }
  function heures(minutes) {
    return Format ? Format.minutesEnHeures(minutes || 0) : (minutes || 0) + ' min';
  }
  function joursCp(dixiemes) {
    return Format ? Format.dixiemesEnJours(dixiemes || 0) : ((dixiemes || 0) / 10) + ' j';
  }
  function jours(n) { return n + NBSP + 'j'; }

  /* Durée « parlée » plutôt que comptable : « 30 min », « 9 h », « 9h30 ».
     C'est ce qu'on met dans une phrase (« vos 30 min restent dues ») ; les
     colonnes de chiffres, elles, gardent le format de format.js. */
  function duree(minutes) {
    var m = minutes || 0;
    /* Une durée NÉGATIVE n'a pas de sens dans une phrase (« vos -0h30 ne sont
       pas dues ») : on rend toujours une valeur absolue, à l'appelant de porter
       le sens (gagné / perdu) dans sa formulation. */
    if (m < 0) m = -m;
    if (m < 60) return m + NBSP + 'min';
    if (m % 60 === 0) return (m / 60) + NBSP + 'h';
    return heures(m);
  }

  /* CONGÉS PAYÉS DISPONIBLES = acquis − pris.
     Cette soustraction est une DÉFINITION MÉTIER, pas une mise en forme : elle
     vivait en neuf exemplaires dans les écrans (relecture lot 6, remarque 1).
     Elle vit désormais ici, à un seul endroit. Elle ne calcule rien de neuf :
     elle lit le compteur de sortie produit par le moteur, et borne à zéro
     comme le fait imputerConges — un compteur incohérent (reprise manuelle
     erronée) ne doit pas afficher un solde négatif à Maria. */
  function cpDisponible(compteurSortie) {
    var cs = compteurSortie || {};
    return Math.max(0, (cs.dixiemesCpAcquis || 0) - (cs.dixiemesCpPris || 0));
  }

  /* Solde de récupération, même principe. */
  function supDisponible(compteurSortie) {
    return Math.max(0, (compteurSortie || {}).minutesSup || 0);
  }

  /* SEUIL UNIQUE de « compteur bas » (relecture lot 6, A3). Trois écrans en
     portaient trois valeurs différentes : à 7 jours restants, l'un affichait
     « compteur bas » en orange pendant qu'un autre annonçait « tout est à
     jour ». 80 dixièmes = 8 jours ouvrables : au-dessous, une semaine complète
     de congé (6 jours, RG-06) ne laisse plus de quoi en poser une seconde. */
  var SEUIL_CP_BAS_DIXIEMES = 80;

  /* Saisie française d'un montant -> centimes entiers. Mise en forme d'entrée,
     pas un calcul : le point n'est un séparateur décimal que sans virgule.
     Était dupliquée mot pour mot dans deux écrans (relecture lot 6, remarque 2).
     Renvoie null si la saisie est illisible ou vide — jamais 0 par défaut. */
  function parseEuros(txt) {
    if (txt == null) return null;
    var norm = String(txt).replace(/[\s €]/g, '');
    if (norm === '') return null;
    if (norm.indexOf(',') !== -1) norm = norm.replace(/\./g, '').replace(',', '.');
    if (!/^\d+(\.\d+)?$/.test(norm)) return null;
    var v = parseFloat(norm);
    if (isNaN(v) || v < 0) return null;
    return Math.round(v * 100);
  }

  /* Entier positif saisi dans un champ nombre. Un champ vidé ne doit pas
     passer silencieusement pour zéro. */
  function parseEntier(txt, min) {
    var t = String(txt == null ? '' : txt).trim();
    if (t === '' || !/^\d+$/.test(t)) return null;
    var v = parseInt(t, 10);
    if (min != null && v < min) return null;
    return v;
  }

  var MOIS = ['', 'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
    'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  var MOIS_COURT = ['', 'janv.', 'févr.', 'mars', 'avril', 'mai', 'juin',
    'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  var JOURS_SEMAINE = ['', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

  function libelleMois(m) { return MOIS[m]; }
  function libelleMoisAnnee(a, m) { return MOIS[m] + ' ' + a; }
  function moisCapitale(a, m) { return MOIS[m].charAt(0).toUpperCase() + MOIS[m].slice(1) + ' ' + a; }

  /* '2026-05-19' -> 'Mardi 19 mai' */
  function jourLong(iso) {
    var p = String(iso).slice(0, 10).split('-');
    return JOURS_SEMAINE[global.Engine.jourSemaine(iso)] + ' ' + Number(p[2]) + ' ' + MOIS[Number(p[1])];
  }
  /* '2026-05-19' -> '19 mai 2026' */
  function dateLongue(iso) {
    if (!iso) return '—';
    var p = String(iso).slice(0, 10).split('-');
    return Number(p[2]) + ' ' + MOIS_COURT[Number(p[1])] + ' ' + p[0];
  }

  /* ------------------------------------------------------------------ */
  /* Éléments composés repris de la maquette                             */
  /* ------------------------------------------------------------------ */

  /* Panneau blanc à titre, avec lien facultatif à droite. */
  function pane(titre, lien) {
    var p = ce('div', 'pane');
    if (titre != null) {
      var t = ce('div', 'pt');
      t.appendChild(ce('span', null, titre));
      if (lien) {
        var b = bouton('more', lien.onclick);
        b.textContent = lien.texte;
        t.appendChild(b);
      }
      p.appendChild(t);
    }
    return p;
  }

  /* Bloc de lignes « libellé … valeur ». */
  function lines(parent) {
    return ajouter(parent, ce('div', 'lines'));
  }
  function ligne(bloc, libelle, valeur, opts) {
    opts = opts || {};
    var l = ce('div', 'l' + (opts.total ? ' tot' : '') + (opts.discret ? ' q' : ''));
    l.appendChild(ce('span', null, libelle));
    var v = ce('span', opts.alerte ? 'wa' : null, valeur == null ? '' : valeur);
    l.appendChild(v);
    bloc.appendChild(l);
    return l;
  }

  function note(titre, texte) {
    var n = ce('div', 'note');
    if (titre) n.appendChild(ce('b', null, titre));
    n.appendChild(document.createTextNode(texte));
    return n;
  }
  function warnbox(titre, texte) {
    var n = ce('div', 'warnbox');
    if (titre) n.appendChild(ce('b', null, titre));
    n.appendChild(document.createTextNode(texte));
    return n;
  }
  function section(titre) { return ce('div', 'sec', titre); }

  /* Champ en lecture seule (libellé à gauche, valeur à droite). */
  function fld(libelle, valeur) {
    var f = ce('div', 'fld');
    f.appendChild(ce('span', 'lb', libelle));
    f.appendChild(ce('span', 'vl', valeur == null ? '—' : String(valeur)));
    return f;
  }

  /* Champ saisissable (texte, e-mail…). Renvoie { bloc, input }. */
  function champ(libelle, valeur, opts) {
    opts = opts || {};
    var f = ce('div', 'fld');
    f.appendChild(ce('span', 'lb', libelle));
    var i = ce('input');
    i.type = opts.type || 'text';
    if (opts.inputmode) i.inputMode = opts.inputmode;
    if (opts.placeholder) i.placeholder = opts.placeholder;
    if (valeur != null) i.value = valeur;
    f.appendChild(i);
    return { bloc: f, input: i };
  }

  /* Liste déroulante. `options` = [[valeur, libellé], …]. */
  function champSelect(libelle, options, valeur) {
    var f = ce('div', 'fld');
    f.appendChild(ce('span', 'lb', libelle));
    var s = selectSimple(options, valeur);
    f.appendChild(s);
    return { bloc: f, select: s };
  }
  function selectSimple(options, valeur) {
    var s = ce('select');
    (options || []).forEach(function (o) {
      var op = ce('option', null, o[1]);
      op.value = String(o[0]);
      if (String(o[0]) === String(valeur)) op.selected = true;
      s.appendChild(op);
    });
    return s;
  }

  /* ------------------------------------------------------------------ */
  /* Sélecteurs de date — listes déroulantes, jamais de clavier          */
  /* ------------------------------------------------------------------ */

  function nbJoursDansMois(annee, mois) {
    var bis = (annee % 4 === 0 && annee % 100 !== 0) || annee % 400 === 0;
    return [31, bis ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mois - 1];
  }
  function iso(annee, mois, jour) {
    return annee + '-' + String(mois).padStart(2, '0') + '-' + String(jour).padStart(2, '0');
  }

  /* Sélecteur jour / mois / année. `opts` : { anneeMin, anneeMax }.
     Renvoie { bloc, valeur() } — valeur() rend une date pure 'YYYY-MM-DD'. */
  function champDate(libelle, isoDefaut, opts) {
    opts = opts || {};
    var d = String(isoDefaut || '').slice(0, 10).split('-');
    var an = Number(d[0]) || opts.anneeDefaut || new Date().getFullYear();
    var mo = Number(d[1]) || 1;
    var jo = Number(d[2]) || 1;
    var anneeMin = opts.anneeMin != null ? opts.anneeMin : an - 5;
    var anneeMax = opts.anneeMax != null ? opts.anneeMax : an + 3;

    var f = ce('div', 'fld');
    f.appendChild(ce('span', 'lb', libelle));
    var boite = ce('div', 'dates');

    var optJours = [];
    var selJour = selectSimple([], jo);
    var selMois = selectSimple(MOIS.slice(1).map(function (m, i) { return [i + 1, MOIS_COURT[i + 1]]; }), mo);
    var optAnnees = [];
    for (var a = anneeMin; a <= anneeMax; a++) optAnnees.push([a, String(a)]);
    var selAnnee = selectSimple(optAnnees, an);

    function majJours() {
      var n = nbJoursDansMois(Number(selAnnee.value), Number(selMois.value));
      var courant = Number(selJour.value) || jo;
      vider(selJour);
      optJours = [];
      for (var j = 1; j <= n; j++) {
        var op = ce('option', null, String(j));
        op.value = String(j);
        if (j === Math.min(courant, n)) op.selected = true;
        selJour.appendChild(op);
      }
    }
    majJours();
    selMois.addEventListener('change', majJours);
    selAnnee.addEventListener('change', majJours);

    boite.appendChild(selJour);
    boite.appendChild(selMois);
    boite.appendChild(selAnnee);
    f.appendChild(boite);

    return {
      bloc: f,
      valeur: function () {
        return iso(Number(selAnnee.value), Number(selMois.value), Number(selJour.value));
      }
    };
  }

  /* Sélecteur mois / année. Rend le PREMIER jour du mois choisi — c'est la
     seule date d'effet qui a un sens pour un barème (RG-15 : un barème
     s'applique aux mois dont le 1er est postérieur ou égal à sa date d'effet). */
  function champMois(libelle, isoDefaut, opts) {
    opts = opts || {};
    var d = String(isoDefaut || '').slice(0, 10).split('-');
    var an = Number(d[0]) || new Date().getFullYear();
    var mo = Number(d[1]) || 1;
    var anneeMin = opts.anneeMin != null ? opts.anneeMin : an - 5;
    var anneeMax = opts.anneeMax != null ? opts.anneeMax : an + 3;

    var f = ce('div', 'fld');
    f.appendChild(ce('span', 'lb', libelle));
    var boite = ce('div', 'dates');
    var selMois = selectSimple(MOIS.slice(1).map(function (m, i) { return [i + 1, MOIS_COURT[i + 1]]; }), mo);
    var optAnnees = [];
    for (var a = anneeMin; a <= anneeMax; a++) optAnnees.push([a, String(a)]);
    var selAnnee = selectSimple(optAnnees, an);
    boite.appendChild(selMois);
    boite.appendChild(selAnnee);
    f.appendChild(boite);

    return {
      bloc: f,
      valeur: function () { return iso(Number(selAnnee.value), Number(selMois.value), 1); },
      mois: function () { return { annee: Number(selAnnee.value), mois: Number(selMois.value) }; }
    };
  }

  /* ------------------------------------------------------------------ */
  /* Feuille en bas d'écran                                              */
  /* ------------------------------------------------------------------ */

  var feuilleOuverte = false;

  /* remplir(corps, fermer) — le contenu est libre. La feuille se ferme au clic
     sur le fond ; jamais toute seule après une erreur d'écriture, pour que la
     saisie en cours reste à l'écran (§3 des specs). */
  function ouvrirFeuille(titre, sousTitre, remplir) {
    var wrap = document.getElementById('sheetwrap');
    var sheet = document.getElementById('sheet');
    if (!wrap || !sheet) return;
    vider(sheet);
    if (titre) sheet.appendChild(ce('div', 'h', titre));
    if (sousTitre) sheet.appendChild(ce('div', 's', sousTitre));
    var corps = ce('div');
    sheet.appendChild(corps);
    remplir(corps, fermerFeuille);
    var annuler = bouton('btn nt', fermerFeuille);
    annuler.textContent = 'Annuler';
    sheet.appendChild(annuler);
    wrap.hidden = false;
    feuilleOuverte = true;
    wrap.onclick = function (e) { if (e.target === wrap) fermerFeuille(); };
    sheet.scrollTop = 0;
  }

  function fermerFeuille() {
    var wrap = document.getElementById('sheetwrap');
    if (wrap) wrap.hidden = true;
    feuilleOuverte = false;
  }
  function feuilleEstOuverte() { return feuilleOuverte; }

  /* Choix d'une feuille : une icône, un libellé, et SON EFFET en sous-texte. */
  function choix(parent, classe, icone, libelle, effet, onclick) {
    var b = bouton('choice ' + classe, onclick);
    b.appendChild(ce('span', 'ic', icone));
    var tx = ce('span', 'tx');
    tx.appendChild(document.createTextNode(libelle));
    if (effet) tx.appendChild(ce('span', 'why', effet));
    b.appendChild(tx);
    parent.appendChild(b);
    return b;
  }

  /* ------------------------------------------------------------------ */
  /* Message éphémère                                                    */
  /* ------------------------------------------------------------------ */

  var minuteurToast = null;

  /* toast(texte, estErreur)
     toast(texte, estErreur, { libelle, onclick, delai })  — lot 13

     La troisième forme ajoute UNE action au message, « Annuler » après une
     réouverture (V8-21). Elle reste volontairement pauvre : un seul bouton,
     jamais deux, et le message disparaît de lui-même. Un geste qu'on peut
     défaire tout de suite se propose ici ; un geste qui demande réflexion
     passe par une feuille de confirmation, jamais par un message éphémère.

     L'action a droit à plus de temps qu'une simple confirmation : Maria doit
     pouvoir la lire, la comprendre et la viser du doigt. */
  function toast(texte, estErreur, action) {
    var t = document.getElementById('toast');
    if (!t) return;
    vider(t);
    t.appendChild(document.createTextNode(texte));

    var delai = estErreur ? 5000 : 2400;
    if (action && action.libelle && typeof action.onclick === 'function') {
      var b = bouton('tact', function () {
        if (minuteurToast) clearTimeout(minuteurToast);
        t.className = 'toast';
        action.onclick();
      });
      b.textContent = action.libelle;
      t.appendChild(b);
      delai = action.delai || 8000;
    }

    t.className = 'toast on' + (estErreur ? ' ko' : '');
    if (minuteurToast) clearTimeout(minuteurToast);
    /* Un échec reste lisible plus longtemps qu'une confirmation : Maria doit
       avoir le temps de comprendre que son écriture n'est PAS passée. */
    minuteurToast = setTimeout(function () { t.className = 'toast'; }, delai);
  }

  function messageErreur(e) {
    return global.Messages ? global.Messages.lisible(e) : 'une erreur est survenue.';
  }

  /* ------------------------------------------------------------------ */
  /* Presse-papiers                                                      */
  /* ------------------------------------------------------------------ */

  /* Un échec de copie doit se VOIR : sinon Maria colle le contenu précédent du
     presse-papiers en croyant avoir copié son récapitulatif. */
  /* LOT 7 — rend désormais une PROMESSE, pour que l'appelant puisse réagir à
     l'échec (ramener l'aperçu du texte sous les yeux, par exemple). Les
     messages restent posés ici : ils doivent être les mêmes partout. */
  function copierTexte(txt) {
    return new Promise(function (resoudre, rejeter) {
      var ok = function () {
        toast('Texte copié — collez-le où vous voulez');
        resoudre();
      };
      var ko = function (e) {
        if (global.console) global.console.error('[Récap] copie impossible :', e);
        toast('La copie n’a pas fonctionné. Le texte reste affiché, ' +
          'vous pouvez le sélectionner à la main.', true);
        rejeter(e);
      };
      if (global.navigator && global.navigator.clipboard && global.navigator.clipboard.writeText) {
        global.navigator.clipboard.writeText(txt).then(ok, function () { replierCopie(txt, ok, ko); });
      } else {
        replierCopie(txt, ok, ko);
      }
    });
  }
  function replierCopie(txt, ok, ko) {
    try {
      var ta = document.createElement('textarea');
      ta.value = txt;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var reussi = document.execCommand('copy');
      document.body.removeChild(ta);
      if (reussi) ok(); else ko(new Error('execCommand a renvoyé false'));
    } catch (e) { ko(e); }
  }

  /* ------------------------------------------------------------------ */
  /* Lecture du calendrier d'un mois (voir l'avertissement en tête)      */
  /* ------------------------------------------------------------------ */

  var TYPES_NON_TRAVAILLES = ['conge_maria', 'sans_solde', 'hors_planning', 'ferie'];

  /* Les jours du mois qui appartiennent au planning du contrat ET à ses bornes.
     Rien d'autre : ni férié, ni congé — c'est l'étape d'avant. */
  function joursPlanning(contrat, annee, mois) {
    var planning = contrat.jours_planning || [1, 2, 3, 4, 5];
    return global.Engine.joursDuMois(annee, mois).filter(function (d) {
      if (planning.indexOf(global.Engine.jourSemaine(d)) === -1) return false;
      if (contrat.date_debut && d < contrat.date_debut) return false;
      if (contrat.date_fin && d > contrat.date_fin) return false;
      return true;
    });
  }

  /* Jours effectivement TRAVAILLÉS par Maria dans le mois pour ce contrat :
     jours du planning, moins les fériés (RG-10 : elle ne travaille jamais un
     jour férié), moins les journées dont une ligne saisie dit qu'elle ne
     travaillait pas. Une absence de l'ENFANT reste un jour travaillé.
     `journees` = { 'YYYY-MM-DD' : ligne } tel que rendu par DB. */
  function joursTravailles(contrat, annee, mois, journees) {
    journees = journees || {};
    return joursPlanning(contrat, annee, mois).filter(function (d) {
      var ligne = journees[d];
      var type = ligne ? ligne.type : (Feries.estJourFerie(d) ? 'ferie' : 'presence');
      return TYPES_NON_TRAVAILLES.indexOf(type) === -1;
    });
  }

  /* Type affiché d'une journée, exactement comme le moteur le lit :
     ligne saisie si elle existe, sinon 'ferie' si le calendrier le dit,
     sinon 'presence' (saisie par exception). */
  function typeDuJour(journees, dateIso) {
    var ligne = (journees || {})[dateIso];
    if (ligne) return ligne.type;
    return Feries.estJourFerie(dateIso) ? 'ferie' : 'presence';
  }

  /* ------------------------------------------------------------------ */
  /* Lot 7 — L'état d'avancement d'un mois                               */
  /*                                                                     */
  /* Jusqu'ici l'application ne connaissait que deux états, clôturé ou    */
  /* pas, et présentait une PROJECTION COMME UN FAIT : le 11 août elle    */
  /* annonçait « 1 150,00 € à verser » alors qu'il restait dix jours      */
  /* travaillés. Trois états explicites remplacent ce silence.           */
  /*                                                                     */
  /* Ces deux fonctions reçoivent la date du jour EN PARAMÈTRE et ne      */
  /* lisent jamais l'horloge (piège n° 1 de la spécification). C'est ce   */
  /* qui rend le comportement du 25 vérifiable par un test : une         */
  /* fonction qui lit `new Date()` à l'intérieur est intestable, et le    */
  /* jour de bascule ne se contrôlerait plus jamais.                      */
  /* ------------------------------------------------------------------ */

  /* À partir de ce jour du mois, le mois courant passe de « en cours » à
     « à clôturer » : Maria connaît alors l'essentiel de son mois. */
  var JOUR_BASCULE_CLOTURE = 25;

  var ETAT_EN_COURS   = 'en_cours';
  var ETAT_A_CLOTURER = 'a_cloturer';
  var ETAT_CLOTURE    = 'cloture';

  /* Les trois seuls mots autorisés à l'écran (V8-01). Ni « en attente », ni
     « terminé », ni « validé », ni « figé », ni « envoyé ». */
  var LIBELLE_ETAT = {
    en_cours:   'en cours',
    a_cloturer: 'à clôturer',
    cloture:    'clôturé'
  };

  function etatDuMois(annee, mois, recap, aujourdhuiIso) {
    if (recap && recap.statut === 'fige') return ETAT_CLOTURE;

    var p = String(aujourdhuiIso || '').split('-');
    var anAuj   = Number(p[0]);
    var moisAuj = Number(p[1]);
    var jourAuj = Number(p[2]);
    /* Date du jour illisible : on ne devine pas. Le mois est dit à clôturer,
       ce qui montre la tuile plutôt que de la cacher — un mois oublié coûte
       plus cher qu'une tuile de trop. */
    if (!anAuj || !moisAuj || !jourAuj) return ETAT_A_CLOTURER;

    var rang    = annee * 12 + mois;
    var rangAuj = anAuj * 12 + moisAuj;

    if (rang > rangAuj) return ETAT_EN_COURS;          // mois futur
    if (rang < rangAuj) return ETAT_A_CLOTURER;        // mois échu, non clôturé
    return jourAuj < JOUR_BASCULE_CLOTURE ? ETAT_EN_COURS : ETAT_A_CLOTURER;
  }

  /* Nombre de jours du planning du contrat, non fériés, STRICTEMENT
     postérieurs à la date du jour, dans le mois demandé. Zéro pour un mois
     échu — la comparaison de chaînes « YYYY-MM-DD » suffit, elles se trient
     dans l'ordre chronologique.

     Ce nombre est ce qui rend la mention « provisoire » utile : « chiffres
     provisoires » tout seul n'aide personne, « il reste 6 jours travaillés »
     dit à Maria de combien son mois peut encore bouger. */
  /* CORRECTIF A3 (lot 7) DE LA RELECTURE PR9 — LES CONGÉS DÉJÀ POSÉS COMPTAIENT
     COMME DES JOURS À VENIR.

     Ce décompte ne recevait pas les journées et ne filtrait que les fériés. Le
     10 août, avec une semaine de congé déjà posée du 17 au 21, l'écran
     annonçait « il reste 15 jours travaillés » là où il en restait 10. Le
     chiffre sert à mesurer ce qu'on s'apprête à perdre en clôturant tôt
     (V8-04) : il doit être juste, ou il fait exactement l'inverse de ce pour
     quoi il existe.

     `journees` est FACULTATIF : les appelants qui ne l'ont pas obtiennent le
     décompte d'avant, jamais une exception. */
  function joursTravaillesRestants(contrat, annee, mois, aujourdhuiIso, journees) {
    if (!contrat || !aujourdhuiIso) return 0;
    return joursPlanning(contrat, annee, mois).filter(function (d) {
      if (d <= aujourdhuiIso) return false;
      if (Feries.estJourFerie(d)) return false;
      /* Une journée DÉJÀ SAISIE qui n'est pas une présence — congé de Maria,
         absence de l'enfant, sans solde — n'est plus un jour à travailler. */
      var ligne = journees && journees[d];
      if (ligne && ligne.type && ligne.type !== 'presence') return false;
      return true;
    }).length;
  }

  /* ------------------------------------------------------------------ */
  /* Lot 8 — Identité d'un enfant : accord, couleur, photo               */
  /* ------------------------------------------------------------------ */

  /* Accord d'un adjectif ou d'un participe avec le genre de l'enfant.

     AVANT LE LOT 8, le genre n'existait pas en base : l'application écrivait
     « Léa est comptée présent·e » partout, faute de savoir. Le point médian
     n'était pas un choix d'écriture, c'était un aveu d'ignorance — et il tombe
     mal dans une application dont la règle est « français simple » (B.0-8),
     lue par une personne qui n'est pas informaticienne.

     Le genre est désormais une colonne. Renseigné, il donne « comptée
     présente » ou « compté présent ». Absent — et c'est un état parfaitement
     légitime, la colonne accepte `null` —, on garde la forme inclusive courte :
     elle est juste dans tous les cas.

     `accord(mot, genre)` : 'f' -> « présente », 'g' -> « présent »,
     rien -> « présent·e ».
     // DÉCISION EN ATTENTE : conserver le point médian quand le genre est vide,
     // ou trouver une tournure qui l'évite ? Signalé à Adrien. */
  function accord(mot, genre) {
    if (genre === 'g') return mot;
    if (genre === 'f') return mot + 'e';
    return mot + '·e';
  }

  /* Raccourci quand on a le contrat sous la main plutôt que le seul genre. */
  function accordDe(contrat, mot) { return accord(mot, contrat && contrat.genre); }

  /* La palette d'identité. SIX jetons, jamais une valeur libre.

     Ces six teintes sont choisies pour deux raisons à la fois : rester
     distinctes entre elles, et ne JAMAIS entrer en collision avec les couleurs
     d'ÉTAT du calendrier (V8-31). Le calendrier parle d'états — présent,
     absent, congé, férié —, pas d'enfants. Si la couleur de Léa se mettait à
     teinter ses cases, Maria ne lirait plus rien : deux systèmes de sens sur
     le même pixel, et aucun des deux ne survit. */
  var COULEURS_IDENTITE = [
    { jeton: 'vert',       libelle: 'Vert',       fond: '#dcefe8', trait: '#2f6b56', texte: '#1d4436' },
    { jeton: 'bleu',       libelle: 'Bleu',       fond: '#dee6f4', trait: '#3a5a8c', texte: '#24395a' },
    { jeton: 'prune',      libelle: 'Prune',      fond: '#eee0ec', trait: '#7a4370', texte: '#4e2b48' },
    { jeton: 'terracotta', libelle: 'Terracotta', fond: '#f6e2da', trait: '#9c4f33', texte: '#63321f' },
    { jeton: 'ocre',       libelle: 'Ocre',       fond: '#f3ead2', trait: '#87682a', texte: '#55411a' },
    { jeton: 'ardoise',    libelle: 'Ardoise',    fond: '#e4e8ea', trait: '#4d5a61', texte: '#30393e' }
  ];
  /* Couleur NEUTRE, pour un enfant à qui aucune couleur n'a été donnée.
     CORRECTIF A13 (lot 8) DE LA RELECTURE PR9 : le repli était
     `COULEURS_IDENTITE[0]`, c'est-à-dire VERT. Deux enfants — l'un
     explicitement vert, l'autre sans couleur — portaient donc la même
     pastille, et le sélecteur CSS écrit pour teindre l'absence de couleur
     (`.av:not([class*="id-"])`) ne pouvait jamais s'appliquer, puisque
     `avatar` posait toujours une classe `id-*`. */
  var COULEUR_NEUTRE = {
    jeton: 'neutre', libelle: 'Sans couleur',
    fond: '#e9edf0', trait: '#5a666e', texte: '#39434a'
  };

  function couleurIdentite(jeton) {
    for (var i = 0; i < COULEURS_IDENTITE.length; i++) {
      if (COULEURS_IDENTITE[i].jeton === jeton) return COULEURS_IDENTITE[i];
    }
    return COULEUR_NEUTRE;
  }

  /* Pastille d'identité : la photo si elle existe, l'initiale sinon, dans la
     couleur du contrat. `classe` permet d'en faire une petite ou une grande
     (« av », « av gd », « av pt ») sans dupliquer la logique. */
  function avatar(contrat, classe) {
    var c = contrat || {};
    var col = couleurIdentite(c.couleur);
    var e = ce('div', 'av ' + (classe || '') + ' id-' + col.jeton);
    if (c.photo) {
      var img = ce('img');
      img.src = c.photo;
      img.alt = '';                       // décoratif : le prénom est écrit à côté
      e.appendChild(img);
      e.classList.add('avphoto');
    } else {
      e.textContent = (c.prenom_enfant || '?').charAt(0).toUpperCase();
    }
    return e;
  }

  /* Nom complet de l'enfant : « Léa Dupont » si le nom est connu, « Léa »
     sinon. `contrat.nom` est le nom de l'ENFANT ; `contrat.famille.nom` est
     celui du FOYER. Les confondre est exactement le défaut que le lot 8
     corrige : ne jamais les substituer l'un à l'autre ici. */
  function nomComplet(contrat) {
    var c = contrat || {};
    return c.nom ? (c.prenom_enfant + ' ' + c.nom) : (c.prenom_enfant || '');
  }

  /* Pastille ronde d'état, avec son mot. La couleur ne porte jamais le sens
     toute seule (V8-05) : le mot est toujours là, à côté du rond. */
  function pastilleEtat(etat) {
    var s = ce('span', 'pastille ' + etat);
    s.appendChild(ce('span', 'rond'));
    s.appendChild(ce('span', 'mot', LIBELLE_ETAT[etat] || ''));
    return s;
  }

  /* ------------------------------------------------------------------ */

  global.Kit = {
    ce: ce, vider: vider, bouton: bouton, ajouter: ajouter,
    eur: eur, eurCourt: eurCourt, heures: heures, joursCp: joursCp, jours: jours, duree: duree,
    cpDisponible: cpDisponible, supDisponible: supDisponible,
    SEUIL_CP_BAS_DIXIEMES: SEUIL_CP_BAS_DIXIEMES,
    parseEuros: parseEuros, parseEntier: parseEntier,
    libelleMois: libelleMois, libelleMoisAnnee: libelleMoisAnnee, moisCapitale: moisCapitale,
    jourLong: jourLong, dateLongue: dateLongue,
    MOIS: MOIS, MOIS_COURT: MOIS_COURT, JOURS_SEMAINE: JOURS_SEMAINE, NBSP: NBSP,
    pane: pane, lines: lines, ligne: ligne, note: note, warnbox: warnbox, section: section,
    fld: fld, champ: champ, champSelect: champSelect, selectSimple: selectSimple,
    champDate: champDate, champMois: champMois, nbJoursDansMois: nbJoursDansMois, iso: iso,
    ouvrirFeuille: ouvrirFeuille, fermerFeuille: fermerFeuille, feuilleEstOuverte: feuilleEstOuverte,
    choix: choix,
    toast: toast, messageErreur: messageErreur, copierTexte: copierTexte,
    joursPlanning: joursPlanning, joursTravailles: joursTravailles, typeDuJour: typeDuJour,
    etatDuMois: etatDuMois, joursTravaillesRestants: joursTravaillesRestants,
    pastilleEtat: pastilleEtat, LIBELLE_ETAT: LIBELLE_ETAT,
    JOUR_BASCULE_CLOTURE: JOUR_BASCULE_CLOTURE,
    accord: accord, accordDe: accordDe, avatar: avatar, nomComplet: nomComplet,
    COULEURS_IDENTITE: COULEURS_IDENTITE, couleurIdentite: couleurIdentite
  };
})(window);
