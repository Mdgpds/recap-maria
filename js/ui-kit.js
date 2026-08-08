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
    if (m < 0) return heures(m);
    if (m < 60) return m + NBSP + 'min';
    if (m % 60 === 0) return (m / 60) + NBSP + 'h';
    return heures(m);
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
  function toast(texte, estErreur) {
    var t = document.getElementById('toast');
    if (!t) return;
    t.textContent = texte;
    t.className = 'toast on' + (estErreur ? ' ko' : '');
    if (minuteurToast) clearTimeout(minuteurToast);
    /* Un échec reste lisible plus longtemps qu'une confirmation : Maria doit
       avoir le temps de comprendre que son écriture n'est PAS passée. */
    minuteurToast = setTimeout(function () { t.className = 'toast'; }, estErreur ? 5000 : 2400);
  }

  function messageErreur(e) {
    return global.Messages ? global.Messages.lisible(e) : 'une erreur est survenue.';
  }

  /* ------------------------------------------------------------------ */
  /* Presse-papiers                                                      */
  /* ------------------------------------------------------------------ */

  /* Un échec de copie doit se VOIR : sinon Maria colle le contenu précédent du
     presse-papiers en croyant avoir copié son récapitulatif. */
  function copierTexte(txt) {
    var ok = function () { toast('Texte copié — collez-le où vous voulez'); };
    var ko = function (e) {
      if (global.console) global.console.error('[Récap] copie impossible :', e);
      toast('Copie impossible. Le texte reste affiché : vous pouvez le sélectionner à la main.', true);
    };
    if (global.navigator && global.navigator.clipboard && global.navigator.clipboard.writeText) {
      global.navigator.clipboard.writeText(txt).then(ok, function () { replierCopie(txt, ok, ko); });
    } else {
      replierCopie(txt, ok, ko);
    }
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

  /* Accord féminin du prénom de l'enfant. Impossible à deviner sûrement (« Tom »
     ne finit pas par -a, « Noah » si) : on se rabat sur la forme inclusive
     courte, qui est juste dans tous les cas et se lit bien.
     // TODO RÈGLE ABSENTE : le genre de l'enfant n'existe pas en base. */
  function accord(mot) { return mot + '·e'; }

  /* ------------------------------------------------------------------ */

  global.Kit = {
    ce: ce, vider: vider, bouton: bouton, ajouter: ajouter,
    eur: eur, eurCourt: eurCourt, heures: heures, joursCp: joursCp, jours: jours, duree: duree,
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
    accord: accord
  };
})(window);
