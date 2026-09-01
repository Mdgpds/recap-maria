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

  /* LOT 24 (§24.3) — LE SÉPARATEUR DE MILLIERS EST UNE ESPACE FINE INSÉCABLE.
     « 1 142,00 € », partout : écran, document, texte copié, image. Le moteur
     est FERMÉ sur ce cycle (`js/format.js`, diff vide) : la conversion se fait
     donc ici, à l'affichage, et uniquement sur le séparateur de milliers —
     l'espace insécable devant « € » ne bouge pas. Tous les écrans passent par
     `Kit.eur` : une seule ligne, aucun rendu ne peut diverger. */
  var ESPACE_FINE = '\u202f';

  function eur(centimes) {
    var t = Format ? Format.centimesEnEuros(centimes || 0) : ((centimes || 0) / 100) + ' €';
    /* Une espace insécable SUIVIE d'un chiffre est un séparateur de milliers ;
       celle qui précède « € » n'en est pas un. */
    return t.replace(/\u00a0(?=\d)/g, ESPACE_FINE);
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
  /* LOT 17 §17.6 — les congés payés sont en MINUTES et s'affichent en jours.
     Le second paramètre est le facteur de conversion, `minutes_par_jour_conge`,
     qui vient des CONDITIONS du mois — un avenant peut le changer.

     Il est OBLIGATOIRE. Un repli silencieux sur 540 afficherait « 10 j » là où
     un contrat à 480 minutes en a 11,25 : un chiffre faux, crédible, et sur le
     compteur qui se propage le plus loin. On préfère afficher des heures
     brutes, visiblement inhabituelles, qu'un nombre de jours inventé. */
  function joursCp(minutes, minutesParJourConge) {
    if (Format) return Format.minutesEnJoursCp(minutes || 0, minutesParJourConge);
    if (!minutesParJourConge) return (minutes || 0) + ' min';
    return ((minutes || 0) / minutesParJourConge) + ' j';
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
    return Math.max(0, (cs.minutesCpAcquis || 0) - (cs.minutesCpPris || 0));
  }

  /* Solde de récupération, même principe. */
  function supDisponible(compteurSortie) {
    return Math.max(0, (compteurSortie || {}).minutesSup || 0);
  }

  /* CORRECTION B5 DE LA RELECTURE DU LOT 17 — CE QU'ON PEUT CONSOMMER ET CE
     QU'ON MONTRE SONT DEUX CHOSES.

     Le bornage à zéro est la correction B1 du lot 1 : elle porte sur ce qu'une
     imputation a le droit de CONSOMMER. Un compteur incohérent ne doit pas
     « rendre » des jours.

     Mais depuis le §17.5, un solde de récupération négatif est un état
     LÉGITIME : Maria a libéré l'enfant plus tôt de son fait, elle doit ce
     temps. La spécification est explicite — « le compteur peut être négatif,
     ET L'ÉCRAN LE DIT ». Or les écrans lisaient `supDisponible` et affichaient
     « 0h00 » sur un compteur à −9 h, pendant que le document remis à la
     famille affichait le solde brut. Les deux se contredisaient.

     Pire : l'avertissement « votre compteur est négatif » de l'écran de fin de
     contrat était gardé par `if (Kit.supDisponible(cs) < 0)`. Structurellement
     inatteignable : il ne pouvait s'afficher JAMAIS.

     `supSolde` rend donc la valeur SIGNÉE, et c'est elle que lisent les
     écrans. `supDisponible` reste, inchangée, pour les bornes de ventilation :
     on ne pose pas un congé sur une dette. */
  function supSolde(compteurSortie) {
    return (compteurSortie || {}).minutesSup || 0;
  }

  /* Le même couple pour les congés payés. Un solde négatif y est, lui, une
     ANOMALIE et non un état voulu (voir la question C5 remontée par la
     relecture : rien ne confronte encore un congé à l'heure imputé sur les
     congés payés au disponible). Le montrer plutôt que le border à zéro est ce
     qui permettra de s'en apercevoir. */
  function cpSolde(compteurSortie) {
    var cs = compteurSortie || {};
    return (cs.minutesCpAcquis || 0) - (cs.minutesCpPris || 0);
  }

  /* SEUIL UNIQUE de « compteur bas » (relecture lot 6, A3). Trois écrans en
     portaient trois valeurs différentes : à 7 jours restants, l'un affichait
     « compteur bas » en orange pendant qu'un autre annonçait « tout est à
     jour ». 8 jours ouvrables : au-dessous, une semaine complète de congé
     (6 jours, RG-06) ne laisse plus de quoi en poser une seconde.

     LOT 17 §17.6 — le seuil était exprimé en dixièmes (80). Il l'est désormais
     en JOURS, et se convertit en minutes avec le facteur du contrat : un
     contrat à 480 minutes par jour de congé a le même seuil de 8 jours, pas le
     même nombre de minutes. Une constante en minutes aurait figé le seuil sur
     un seul contrat. */
  var SEUIL_CP_BAS_JOURS = 8;

  /* CORRECTION C1 DE LA RELECTURE DU LOT 17 — LA CONVERSION VIENT DU MOTEUR.
     Le seuil est exprimé en JOURS ; comparer des minutes obligeait à convertir
     ici, c'est-à-dire à réécrire RG-05 dans la boîte à outils de l'interface.
     `Chaine.reservesEnJours` interroge `Engine.imputerConges`, la seule
     fonction qui a le droit de dire combien de jours une réserve couvre.
     `conditions` est l'avenant en vigueur pour le mois affiché. */
  function cpEstBas(minutesDisponibles, conditions) {
    var Chaine = global.ChaineMois;
    if (!conditions || !Chaine || typeof Chaine.reservesEnJours !== 'function') return false;
    if (!conditions.minutes_par_jour_conge || conditions.minutes_par_jour_conge <= 0) return false;
    /* `reservesEnJours` attend un COMPTEUR (acquis − pris), pas un solde déjà
       fait : on lui donne le disponible comme acquis, et zéro pris. */
    var jours = Chaine.reservesEnJours(conditions, {
      minutesCpAcquis: minutesDisponibles || 0, minutesCpPris: 0
    }).joursCp;
    return jours < SEUIL_CP_BAS_JOURS;
  }

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

  /* LOT 16 §16.6 — L'ÉLISION.

     « Récap de août » : la barre du haut concaténait « de » et le mois sans
     jamais se demander par quelle lettre il commence. Trois mois sur douze
     sont concernés — avril, août, octobre — soit un quart de l'année où
     l'application écrit du français fautif sur l'écran le plus vu.

     La fonction est générale : on lui donne le mot et l'article, elle rend
     l'un ou l'autre. Elle vit ici parce que le cas se reproduira à chaque
     phrase où un mois suit une préposition, et qu'une correction faite à un
     seul endroit ne tiendrait pas.

     `h` n'est pas traité : aucun mois français ne commence par un h. */
  var VOYELLES = 'aàâeéèêiîïoôuûy';

  function elider(article, mot) {
    var premiere = String(mot || '').charAt(0).toLowerCase();
    if (VOYELLES.indexOf(premiere) === -1) return article + ' ' + mot;
    return article.slice(0, -1) + '’' + mot;
  }

  /* « de mars », « d'août ». */
  function deMois(m) { return elider('de', MOIS[m]); }
  /* « de mars 2026 », « d'août 2026 ». */
  function deMoisAnnee(a, m) { return elider('de', MOIS[m] + ' ' + a); }

  /* LOT 16 §16.8 — « Du 3 au 22 août », « Du 29 juillet au 4 août »,
     « Le 14 août ». Sur une période, le jour de la semaine n'apporte rien et
     allonge la ligne ; il reste sur les dates isolées. */
  function libellePeriode(debut, fin) {
    if (!debut || !fin) return '—';
    if (debut === fin) return 'Le ' + jourEtMois(debut);
    var memeMois = debut.slice(0, 7) === fin.slice(0, 7);
    return 'Du ' + (memeMois ? quantieme(debut) : jourEtMois(debut)) +
      ' au ' + jourEtMois(fin);
  }
  /* CORRECTION RELECTURE LOT 16 (remarque 3) — « Du 1 au 22 août » n'est pas
     du français : le premier du mois se dit « 1er ». Les autres quantièmes
     s'écrivent en chiffres nus. */
  function quantieme(d) {
    var n = Number(d.slice(8, 10));
    return n === 1 ? '1er' : String(n);
  }
  function jourEtMois(d) {
    return quantieme(d) + ' ' + MOIS[Number(d.slice(5, 7))];
  }

  /* ------------------------------------------------------------------ */
  /* LOT 31 §5 — DES JOURS QUI SE SUIVENT S'ÉCRIVENT « DU 15 AU 18 »     */
  /*                                                                     */
  /* Trois semaines de congé donnaient quinze lignes identiques : illisible */
  /* pour Maria, et pire pour la famille qui reçoit le document.          */
  /*                                                                     */
  /* UN SEUL EXEMPLAIRE, ICI. Le document du mois, le repli « Journées à  */
  /* part » et la liste de « Mes congés » regroupent la même chose ; trois */
  /* implémentations auraient produit trois découpages, et c'est le       */
  /* document remis à un tiers qui aurait fini par différer de l'écran que */
  /* Maria a relu. Le document a d'ailleurs trois rendus — écran, texte à  */
  /* copier, image — qui partagent tous cette fonction, comme l'encart     */
  /* RG-06 (§5).                                                          */
  /* ------------------------------------------------------------------ */

  /* LA RÈGLE, TRANCHÉE PAR ADRIEN LE 1er SEPTEMBRE 2026 :

       « Une plage ne regroupe que des journées STRICTEMENT IDENTIQUES.
         Même nature, même décompte, même imputation. Dès qu'un de ces trois
         éléments change, la plage se coupe. »

     Elle est appliquée telle quelle : l'appelant fournit `cle(jour)`, qui
     porte ces trois éléments, et deux journées de clés différentes ne se
     rejoignent jamais. Une liste d'exceptions se périme au premier attribut
     ajouté ; une règle unique tient par construction.

     CE QUI COMPTE COMME « CONSÉCUTIF » : les jours se suivent en JOURS
     OUVRÉS DU PLANNING. Un vendredi et le lundi suivant se suivent — le
     week-end ne coupe pas. Un férié au milieu ne coupe pas non plus. En
     revanche une journée ouvrable ABSENTE de la liste coupe : c'est elle qui
     fait qu'une demi-journée posée au milieu d'une semaine de congés entiers
     produit bien deux plages, sans qu'aucune règle spéciale n'ait à le dire.

     `ouvrable(jour)` est fourni par l'appelant : lui seul connaît le
     planning du contrat, ses bornes et le calendrier des fériés. */
  function suitDansLeRythme(precedent, jour, ouvrable) {
    if (jour <= precedent) return false;
    var x = global.Feries.ajouterJours(precedent, 1);
    var garde = 0;
    while (x < jour && garde++ < 400) {
      if (ouvrable(x)) return false;
      x = global.Feries.ajouterJours(x, 1);
    }
    return x === jour;
  }

  /* `plagesDeJours(['2026-09-15', ...], { cle, ouvrable })`
     -> [{ debut, fin, jours: [...], cle }], dans l'ordre des dates. */
  function plagesDeJours(jours, options) {
    var opts = options || {};
    var cle = opts.cle || function () { return ''; };
    var ouvrable = opts.ouvrable || function () { return true; };
    var tries = (jours || []).slice().sort();
    var out = [];
    var courante = null;
    tries.forEach(function (d) {
      var k = String(cle(d));
      if (courante && courante.cle === k &&
          suitDansLeRythme(courante.fin, d, ouvrable)) {
        courante.jours.push(d);
        courante.fin = d;
        return;
      }
      courante = { cle: k, jours: [d], debut: d, fin: d };
      out.push(courante);
    });
    return out;
  }

  /* LES TROIS CAS DU §5, ET RIEN D'AUTRE :

       un seul jour            -> « Le 15 septembre »
       deux jours              -> « Le 15 et le 16 septembre »
       trois jours ou plus     -> « Du 15 au 18 septembre »

     Le cas à deux se décide sur le NOMBRE DE JOURS de la plage, pas sur son
     étendue : un vendredi et le lundi suivant font deux jours et s'écrivent
     « Le 18 et le 21 septembre », jamais « Du 18 au 21 » — qui laisserait
     croire à quatre journées décomptées.

     `quantieme` rend « 1er » pour le premier du mois : la même correction
     qu'au lot 16, et elle vaut pour les deux bornes. */
  function libellePlageJours(plage) {
    var jours = (plage && plage.jours) || [];
    if (!jours.length) return '—';
    if (jours.length === 1) return 'Le ' + jourEtMois(jours[0]);
    if (jours.length === 2) {
      var memeMois2 = jours[0].slice(0, 7) === jours[1].slice(0, 7);
      return 'Le ' + (memeMois2 ? quantieme(jours[0]) : jourEtMois(jours[0])) +
        ' et le ' + jourEtMois(jours[1]);
    }
    return libellePeriode(plage.debut, plage.fin);
  }

  /* La même règle des trois cas pour une PÉRIODE déjà bornée — « Mes congés »
     stocke des bornes, pas une liste de jours (§5, troisième endroit). Le cas
     à deux ne s'applique que si les deux bornes se suivent dans le rythme :
     une période qui commence un samedi non compté n'a pas ses deux journées
     décomptées sur ses bornes, et « Le 19 et le 22 » serait faux. */
  function libellePeriodeTroisCas(debut, fin, nbJoursDecomptes, ouvrable) {
    if (!debut || !fin) return '—';
    if (debut === fin) return 'Le ' + jourEtMois(debut);
    if (nbJoursDecomptes === 2) {
      var p = plagesDeJours([debut, fin], { ouvrable: ouvrable });
      if (p.length === 1) return libellePlageJours(p[0]);
    }
    return libellePeriode(debut, fin);
  }

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
    /* `opts.phrase` : la valeur est une phrase, pas un nombre — elle a le
       droit de revenir à la ligne. À demander explicitement, pour que les
       montants et les durées gardent leur insécabilité par défaut. */
    var cv = (opts.alerte ? 'wa' : '') + (opts.phrase ? ' phr' : '');
    var v = ce('span', cv.trim() || null, valeur == null ? '' : valeur);
    l.appendChild(v);
    bloc.appendChild(l);
    return l;
  }

  /* ------------------------------------------------------------------ */
  /* LE DÉCOMPTE DES CONGÉS, DIT UNE SEULE FOIS                          */
  /*                                                                     */
  /* Cette phrase est la raison d'être d'une bonne partie de              */
  /* l'application : les familles comptent 5 jours pour une semaine,      */
  /* Maria en compte 6, et c'est elle qui a raison.                       */
  /*                                                                     */
  /* Elle était RECOPIÉE dans au moins sept endroits — le document, le    */
  /* texte à copier, l'image, l'écran « Mes congés » (trois fois), le     */
  /* menu (deux fois), l'espace enfant. Le document à l'écran, le texte à */
  /* copier et l'image sortent tous de l'application et arrivent chez la  */
  /* famille : les laisser diverger ne se verrait qu'une fois le document */
  /* parti. Elles viennent donc toutes d'ici, et d'ici seulement (§6.3).  */
  /*                                                                     */
  /* LA RÈGLE DES CINQ SAMEDIS L'A RENDUE FAUSSE (§6.1). « Une semaine    */
  /* complète compte donc 6 jours, même si je ne travaille pas le         */
  /* samedi » cesse d'être vrai le jour du déploiement : une semaine ne   */
  /* compte plus 6 jours d'office. La laisser en l'état ferait mentir le  */
  /* document remis aux familles — exactement ce que l'application existe */
  /* pour empêcher.                                                       */
  /* ------------------------------------------------------------------ */

  /* ------------------------------------------------------------------ */
  /* LOT 28 — LE NOM D'UN ÉCART D'HORAIRE, À UN SEUL ENDROIT             */
  /*                                                                     */
  /* Ces deux tables vivaient dans `js/ui-document.js`, parce que le      */
  /* document remis à la famille était le SEUL écran à nommer un écart.   */
  /* Le repli « Journées à part » le nomme désormais lui aussi, et deux   */
  /* copies d'une même phrase divergent toujours : le jour où « J'ai      */
  /* libéré plus tôt » change de mot, Maria lirait un libellé sur son     */
  /* écran et la famille un autre sur la pièce opposable. C'est le même   */
  /* raisonnement que `ENCART_RG06` ci-dessous, appliqué au geste plutôt  */
  /* qu'à la règle.                                                       */
  /*                                                                     */
  /* AUCUN LIBELLÉ N'EST MODIFIÉ : les chaînes sont reprises mot pour     */
  /* mot, elles changent de fichier, pas de texte.                        */
  /* ------------------------------------------------------------------ */

  /* Le GESTE déclaré. C'est lui qui explique pourquoi le temps a bougé —
     la poche où il se déduit ne le dit pas (correction de la remarque 4 de
     la relecture du lot 17). */
  var LIBELLE_EVENEMENT_ECART = {
    liberation_anticipee: 'libération anticipée',
    arrivee_decalee: 'arrivée décalée à ma demande',
    retard_parent: 'retard à la reprise',
    /* LOT 21 (§21.3) — le congé posé à l'heure emprunte la mécanique de
       l'écart d'horaire, mais ce n'est PAS une libération anticipée : c'est un
       congé, et le document doit le dire. C'est toute la raison d'être de la
       migration `017` — sans elle, cette ligne aurait menti sur une pièce
       opposable des années plus tard. */
    conge_horaire: 'congé posé sur cette journée'
  };

  /* La POCHE où l'écart se déduit. Nommée seulement quand elle change
     quelque chose pour le lecteur. */
  var LIBELLE_DESTINATION_ECART = {
    recuperation: 'déduite de ma récupération',
    conges_payes: 'déduite de mes congés payés',
    sans_solde: 'passée en sans solde'
  };

  var ENCART_RG06 =
    'Les congés payés d’une assistante maternelle se comptent en jours ouvrables, ' +
    'du lundi au samedi, dimanches et jours fériés exclus. Le samedi que je ne ' +
    'travaille pas n’est décompté que lorsque je le choisis, dans la limite de cinq ' +
    'par année de référence (1er juin – 31 mai) — c’est la règle dite des cinq samedis.';

  /* La même règle en une ligne, pour les écrans où la phrase entière
     n'entrerait pas. Elle dit la MÊME chose, en plus court — jamais autre
     chose. */
  var RESUME_RG06 =
    'En jours ouvrables, du lundi au samedi. Un samedi non travaillé n’est ' +
    'décompté que si vous le choisissez, dans la limite de cinq par an et par famille.';

  /* L'ANNÉE DE RÉFÉRENCE DES CONGÉS PAYÉS : du 1er juin au 31 mai.

     Elle ne vit PAS dans le moteur, et c'est voulu (§4.1) : le moteur ne
     connaît ni l'année de référence ni le quota de cinq — il compte les
     samedis qu'on lui donne. Ce n'est pas non plus un calcul métier : c'est
     une fenêtre de dates, celle que la base interroge et que l'écran nomme.

     Un samedi est rattaché à l'année de SA PROPRE DATE : une période à cheval
     sur le 31 mai voit donc ses samedis répartis entre deux années, chacun
     comptant dans la sienne (§2.3). */
  function anneeDeReferenceConges(dateIso) {
    var d = String(dateIso).slice(0, 10);
    var annee = Number(d.slice(0, 4));
    var mois = Number(d.slice(5, 7));
    var premiere = (mois >= 6) ? annee : annee - 1;
    return {
      debut: premiere + '-06-01',
      fin: (premiere + 1) + '-05-31',
      libelle: '1er juin ' + premiere + ' – 31 mai ' + (premiere + 1)
    };
  }

  /* Le quota de la règle : cinq samedis par année de référence ET PAR
     FAMILLE. Il n'est pas dans le moteur non plus — c'est une affaire de base
     et d'écran. */
  var QUOTA_SAMEDIS = 5;

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

  /* ------------------------------------------------------------------ */
  /* LOT 24 (§24.2) — LES COMPOSANTS UNIQUES DU SOCLE                    */
  /*                                                                     */
  /* Chaque écran passe sur ces briques aux lots 25 à 27. Elles vivent    */
  /* ici, en un seul exemplaire : dix encarts, huit lignes et sept cartes */
  /* qui divergent est très exactement la dette que ce lot rembourse.     */
  /* AUCUN calcul ici — que du DOM.                                       */
  /* ------------------------------------------------------------------ */

  /* ENCART — trois tons : '' (info, vert), 'w' (attention, orange),
     'k' (blocage, rouge). `titre` en gras, `texte` facultatif. */
  function enc(ton, titre, texte) {
    var e = ce('div', 'enc' + (ton ? ' ' + ton : ''));
    if (titre) e.appendChild(ce('b', null, titre));
    if (texte) e.appendChild(document.createTextNode(texte));
    return e;
  }

  /* ENCART UNE LIGNE — cliquable, chevron. Un vrai <button> : une carte qui
     agit reste atteignable au clavier et annoncée comme un bouton. */
  function encOne(ton, titre, onclick) {
    var e = bouton('enc one' + (ton ? ' ' + ton : ''), onclick);
    e.appendChild(ce('b', null, titre));
    e.appendChild(ce('span', 'chev', '›'));
    return e;
  }

  /* LIGNE « libellé · valeur » (`ln`). opts : { sous, total, alerte, phrase,
     onclick }. `sous` est le sous-texte à 3 px du libellé. */
  function ligneLn(parent, libelle, valeur, opts) {
    opts = opts || {};
    var l = opts.onclick
      ? bouton('ln tap', opts.onclick)
      : ce('div', 'ln' + (opts.total ? ' tot' : ''));
    var g = ce('span', null, libelle);
    if (opts.sous) g.appendChild(ce('span', 'sb2', opts.sous));
    l.appendChild(g);
    var v = ce('b', opts.alerte ? 'wa' : null, valeur == null ? '' : valeur);
    if (opts.phrase) v.style.whiteSpace = 'normal';
    l.appendChild(v);
    if (parent) parent.appendChild(l);
    return l;
  }

  /* CARTE cliquable (`cd tap`) : avatar facultatif, titre, sous-texte,
     chevron ou pastille à droite. opts : { avatar, droite }. */
  function carteTap(titre, sous, onclick, opts) {
    opts = opts || {};
    var b = bouton('cd tap' + (opts.classe ? ' ' + opts.classe : ''), onclick);
    if (opts.avatar) b.appendChild(opts.avatar);
    var g = ce('span', 'gr');
    g.appendChild(ce('span', 'n', titre));
    if (sous) g.appendChild(ce('span', 'd', sous));
    b.appendChild(g);
    b.appendChild(opts.droite || ce('span', 'chev', '›'));
    return b;
  }

  /* REPLI (`fold`) — en-tête (titre · valeur · chevron), corps replié.
     Rend { bloc, corps, majValeur(txt), ouvrir() }. */
  function fold(titre, valeur, opts) {
    opts = opts || {};
    var f = ce('div', 'fold' + (opts.ouvert ? ' open' : ''));
    var h = bouton('fh', function () {
      f.classList.toggle('open');
      h.setAttribute('aria-expanded', f.classList.contains('open') ? 'true' : 'false');
    });
    h.appendChild(ce('span', null, titre));
    var vv = ce('span', 'vv', valeur == null ? '' : valeur);
    h.appendChild(vv);
    h.appendChild(ce('span', 'chev', '›'));
    h.setAttribute('aria-expanded', opts.ouvert ? 'true' : 'false');
    f.appendChild(h);
    var corps = ce('div', 'fb');
    f.appendChild(corps);
    return {
      bloc: f, corps: corps,
      majValeur: function (txt) { vv.textContent = txt == null ? '' : txt; },
      ouvrir: function () { f.classList.add('open'); h.setAttribute('aria-expanded', 'true'); }
    };
  }

  /* SEGMENTÉ (`seg`) — choix exclusif horizontal. `options` = [[valeur,
     libellé], …] ; [valeur, libellé, false] rend l'option visible mais
     inactive. Rend { bloc, valeur(), poser(v), boutons }. */
  function seg(options, valeurInitiale, onchange, opts) {
    opts = opts || {};
    var bloc = ce('div', 'seg' + (opts.mini ? ' mini' : ''));
    var courante = valeurInitiale;
    var boutons = {};
    (options || []).forEach(function (o) {
      var b = bouton(null, function () {
        if (b.disabled || courante === o[0]) return;
        courante = o[0];
        peindre();
        if (onchange) onchange(o[0]);
      });
      b.textContent = o[1];
      if (o[2] === false) b.disabled = true;
      boutons[o[0]] = b;
      bloc.appendChild(b);
    });
    function peindre() {
      Object.keys(boutons).forEach(function (k) {
        var on = k === String(courante);
        boutons[k].classList.toggle('on', on);
        boutons[k].setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    }
    peindre();
    return {
      bloc: bloc, boutons: boutons,
      valeur: function () { return courante; },
      poser: function (v) { courante = v; peindre(); }
    };
  }

  /* STEPPER (`stp`) — boutons désactivés aux bornes. Les bornes peuvent être
     des FONCTIONS, relues à chaque appui : sur l'écran de pose, la borne
     d'une ligne dépend des autres. Rend { bloc, valeur(), poser(v) }. */
  function stepper(valeurInitiale, opts) {
    opts = opts || {};
    var v = valeurInitiale || 0;
    function borne(x, defaut) { return typeof x === 'function' ? x() : (x == null ? defaut : x); }
    var bloc = ce('span', 'stp');
    var moins = bouton(null, function () { pas(-1); });
    moins.textContent = '−';
    moins.setAttribute('aria-label', opts.libelle ? 'Retirer — ' + opts.libelle : 'Retirer');
    var champ = ce('span', null, String(v));
    var plus = bouton(null, function () { pas(1); });
    plus.textContent = '+';
    plus.setAttribute('aria-label', opts.libelle ? 'Ajouter — ' + opts.libelle : 'Ajouter');
    bloc.appendChild(moins);
    bloc.appendChild(champ);
    bloc.appendChild(plus);
    function peindre() {
      champ.textContent = String(v);
      moins.disabled = v <= borne(opts.min, 0);
      plus.disabled = v >= borne(opts.max, Infinity);
    }
    function pas(d) {
      var nv = v + d;
      if (nv < borne(opts.min, 0) || nv > borne(opts.max, Infinity)) return;
      v = nv;
      peindre();
      if (opts.onchange) opts.onchange(v);
    }
    peindre();
    return {
      bloc: bloc,
      valeur: function () { return v; },
      poser: function (nv) { v = nv; peindre(); }
    };
  }

  /* PASTILLE (`pill`) — 4 tons : '' vert, 'w' orange, 'b' bleu, 'g' gris. */
  function pill(ton, texte) {
    return ce('span', 'pill' + (ton ? ' ' + ton : ''), texte);
  }

  /* BARRE FIXE (`stick`) — l'action principale de l'écran, collée en bas du
     corps défilant, au-dessus de la barre d'onglets. À AJOUTER EN DERNIER
     dans le corps : `margin-top: auto` la pousse au fond quand le contenu
     est court, `position: sticky` la garde visible quand il est long. */
  function stick(parent) {
    var s = ce('div', 'stick');
    if (parent) parent.appendChild(s);
    return s;
  }

  /* Champ en lecture seule (libellé à gauche, valeur à droite). */
  function fld(libelle, valeur) {
    var f = ce('div', 'fld');
    f.appendChild(ce('span', 'lb', libelle));
    f.appendChild(ce('span', 'vl', valeur == null ? '—' : String(valeur)));
    return f;
  }

  /* LOT 18 §18.3 — LE CHAMP QUI SE CORRIGE SUR PLACE.

     Corriger un prénom mal orthographié demandait d'ouvrir un formulaire de
     douze champs, de retrouver la bonne ligne, puis de tout réenregistrer. Le
     geste le plus banal de la fiche était le plus coûteux.

     Ici, le champ se lit comme un `fld` ordinaire et s'ouvre d'un appui. Deux
     règles tiennent tout :
     - `enregistrer` rend une promesse ; tant qu'elle n'a pas abouti, l'input
       reste à l'écran avec ce que Maria a tapé. Une écriture qui échoue ne
       perd jamais la saisie (B.0-9).
     - une valeur inchangée ne déclenche AUCUNE écriture : rouvrir et refermer
       un champ ne doit pas toucher la base.

     `opts.obligatoire` refuse le vide, avec sa phrase — un prénom effacé
     rendrait quatre écrans muets. */
  function fldModifiable(libelle, valeur, opts) {
    opts = opts || {};
    var f = ce('div', 'fld mod');
    f.appendChild(ce('span', 'lb', libelle));

    var zone = ce('span', 'vl');
    f.appendChild(zone);

    function lecture() {
      vider(zone);
      zone.appendChild(ce('span', null, valeur == null || valeur === '' ? '—' : String(valeur)));
      var b = bouton('crayon', ouvrir);
      b.textContent = 'Modifier';
      b.setAttribute('aria-label', 'Modifier ' + libelle.toLowerCase());
      zone.appendChild(b);
    }

    function ouvrir() {
      vider(zone);
      var i = ce('input');
      i.type = 'text';
      i.value = valeur == null ? '' : String(valeur);
      i.setAttribute('aria-label', libelle);
      zone.appendChild(i);

      var msg = ce('div', 'msg');
      var bOk = bouton('pas ok', valider);
      bOk.textContent = 'Enregistrer';
      var bNon = bouton('pas', function () { lecture(); });
      bNon.textContent = 'Annuler';
      var actions = ce('div', 'grp');
      actions.appendChild(bOk);
      actions.appendChild(bNon);
      zone.appendChild(actions);
      zone.appendChild(msg);
      i.focus();

      i.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); valider(); }
        if (e.key === 'Escape') { e.preventDefault(); lecture(); }
      });

      function valider() {
        var v = String(i.value || '').trim();
        if (opts.obligatoire && !v) {
          msg.className = 'msg ko';
          msg.textContent = opts.obligatoire;
          return;
        }
        var ancienne = valeur == null ? '' : String(valeur);
        if (v === ancienne) { lecture(); return; }
        bOk.disabled = true;
        bNon.disabled = true;
        msg.className = 'msg';
        msg.textContent = 'Enregistrement…';
        Promise.resolve(opts.enregistrer(v || null))
          .then(function () { valeur = v; lecture(); })
          .catch(function (e) {
            bOk.disabled = false;
            bNon.disabled = false;
            msg.className = 'msg ko';
            /* La saisie reste à l'écran : c'est tout l'objet de la garde. */
            msg.textContent = 'Rien n’a été enregistré : ' + messageErreur(e) +
              ' Votre saisie est conservée.';
          });
      }
    }

    lecture();
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
  /* LOT 17 §17.4 — LE FORMULAIRE DES ONZE CONDITIONS                    */
  /*                                                                     */
  /* Les mêmes onze champs servent à DEUX écrans : la création d'un      */
  /* contrat et « Faire un avenant ». Ils vivent donc ici, en un seul     */
  /* exemplaire. Deux formulaires jumeaux finiraient par diverger — l'un  */
  /* validerait un planning vide que l'autre refuse — et la divergence ne */
  /* se verrait qu'au moment où un calcul devient faux.                   */
  /*                                                                     */
  /* AUCUNE RÈGLE MÉTIER ICI. Ce composant lit et écrit des valeurs ; ce  */
  /* qu'elles font au calcul appartient au moteur. Il refuse seulement ce */
  /* que la base refuserait de toute façon, pour le dire en français      */
  /* avant l'aller-retour.                                                */
  /* ------------------------------------------------------------------ */

  var NOMS_JOURS_COURTS = ['', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

  /* Durée en minutes saisie en heures ET minutes : Maria lit « 9 h » sur son
     contrat, pas « 540 ». Deux champs plutôt qu'un, parce qu'un champ unique
     « 9,5 » se lit tantôt neuf heures et demie, tantôt neuf heures cinquante. */
  function champDuree(libelle, minutes, opts) {
    var m = minutes || 0;
    var f = ce('div', 'fld duree');
    f.appendChild(ce('span', 'lb', libelle));
    var ligne = ce('div', 'row');
    var h = ce('input');
    h.type = 'text'; h.inputMode = 'numeric'; h.value = String(Math.floor(m / 60));
    var mn = ce('input');
    mn.type = 'text'; mn.inputMode = 'numeric'; mn.value = String(m % 60);
    ligne.appendChild(h);
    ligne.appendChild(ce('span', 'u', 'h'));
    ligne.appendChild(mn);
    ligne.appendChild(ce('span', 'u', 'min'));
    f.appendChild(ligne);
    if (opts && opts.aide) f.appendChild(ce('div', 'sb q', opts.aide));
    return {
      bloc: f, heures: h, minutes: mn,
      /* `null` si la saisie est illisible — jamais zéro par défaut : un champ
         vidé par mégarde ne doit pas passer pour « aucune minute due ». */
      valeur: function () {
        var a = parseEntier(h.value, 0);
        var b = parseEntier(mn.value, 0);
        if (a === null || b === null || b > 59) return null;
        return a * 60 + b;
      }
    };
  }

  /* Heure de la journée, en listes déroulantes par quart d'heure : un champ
     libre laisse écrire « 8h3 » et « 17.30 », et une heure fausse déplace la
     référence de toutes les journées du mois (§17.5). */
  function champHeure(libelle, valeur, opts) {
    var v = String(valeur || '08:30').slice(0, 5);
    var options = [];
    for (var hh = 5; hh <= 22; hh++) {
      for (var q = 0; q < 60; q += 15) {
        var t = String(hh).padStart(2, '0') + ':' + String(q).padStart(2, '0');
        options.push([t, t.replace(':', 'h')]);
      }
    }
    /* Une valeur enregistrée hors des quarts d'heure — une donnée d'avant ce
       sélecteur — reste proposée : on ne la fait pas disparaître en silence. */
    var connue = options.some(function (o) { return o[0] === v; });
    if (!connue) options.push([v, v.replace(':', 'h')]);
    var ch = champSelect(libelle, options, v);
    if (opts && opts.aide) ch.bloc.appendChild(ce('div', 'sb q', opts.aide));
    return { bloc: ch.bloc, select: ch.select,
             valeur: function () { return ch.select.value; } };
  }

  /* LOT 20 (§20.4 c) — L'HEURE À LA MINUTE PRÈS.

     `champHeure` propose des quarts d'heure : c'est ce qu'il faut pour un
     horaire d'accueil, qui est un réglage rond. Mais une journée de
     familiarisation se déclare « 9 h 05 → 11 h 47 » : le quart d'heure y
     perdrait jusqu'à quatorze minutes payées, à chaque jour, dans un sens ou
     dans l'autre.

     On passe donc par le sélecteur d'heure natif du téléphone (`type="time"`,
     `step="60"`), qui ouvre une molette et ne se tape pas au clavier — le
     principe B.0-3 est tenu. Sur un navigateur qui l'ignorerait, le champ
     retombe en texte : la valeur reste lisible et le moteur refuse en français
     ce qui n'est pas une heure (`HEURE_INVALIDE`). */
  function champHeureMinute(libelle, valeur) {
    var f = ce('div', 'fld');
    f.appendChild(ce('span', 'lb', libelle));
    var i = ce('input');
    i.type = 'time';
    i.step = '60';
    if (valeur) i.value = String(valeur).slice(0, 5);
    f.appendChild(i);
    return {
      bloc: f, input: i,
      valeur: function () { return String(i.value || '').slice(0, 5); }
    };
  }

  /* Les jours de garde, en cases à cocher du lundi au dimanche. Le samedi et
     le dimanche sont proposés comme les autres : certains contrats en ont, et
     surtout RG-06 compte le samedi que Maria travaille ou non. */
  function champPlanning(libelle, planning) {
    var choisis = (planning || [1, 2, 3, 4, 5]).slice();
    var f = ce('div', 'fld planning');
    f.appendChild(ce('span', 'lb', libelle));
    var ligne = ce('div', 'row jours');
    var cases = {};
    for (var j = 1; j <= 7; j++) {
      (function (jour) {
        var lab = ce('label', 'jour');
        var box = ce('input');
        box.type = 'checkbox';
        box.checked = choisis.indexOf(jour) !== -1;
        cases[jour] = box;
        lab.appendChild(box);
        lab.appendChild(ce('span', null, NOMS_JOURS_COURTS[jour]));
        ligne.appendChild(lab);
      })(j);
    }
    f.appendChild(ligne);
    return {
      bloc: f, cases: cases,
      valeur: function () {
        var out = [];
        for (var k = 1; k <= 7; k++) if (cases[k].checked) out.push(k);
        return out;
      }
    };
  }

  /* Le formulaire complet. `valeurs` pré-remplit ; `opts.titre` coiffe le bloc
     (« Conditions au 1er septembre 2026 » — le vocabulaire prépare l'avenant,
     §17.4). Rend { bloc, valeurs(), erreur() } : `erreur()` renvoie la phrase
     française du premier refus, ou `null`. */
  function champsConditions(valeurs, opts) {
    var v = valeurs || {};
    var o = opts || {};
    var bloc = ce('div', 'conditions');
    if (o.titre) bloc.appendChild(section(o.titre));

    /* LOT 27 (§27.4) — LES ONZE CONDITIONS, EN DEUX PAQUETS.

       « Ajouter un enfant » les demande en trois étapes — Qui, Quand,
       Combien — et la fiche du contrat les groupe en trois blocs. Les deux
       écrans ont besoin de la MÊME définition de chaque champ, du même
       `valeurs()` et du même `erreur()` : les dupliquer, c'est se donner deux
       endroits où un refus se formulera un jour différemment.

       Les champs sont donc construits une fois, dans deux conteneurs — Le
       temps, L'argent — que `bloc` contient l'un après l'autre. Un appelant
       qui veut tout, comme la feuille d'avenant, prend `bloc` et ne voit
       aucune différence. Un appelant qui veut les répartir prend `temps` et
       `argent` et les déplace où il veut : déplacer un nœud ne le recrée pas,
       donc les références des champs restent valides. */
    var temps = ce('div');
    var argent = ce('div');
    bloc.appendChild(temps);
    bloc.appendChild(argent);

    var planning = champPlanning('Jours de garde', v.jours_planning);
    temps.appendChild(planning.bloc);

    var arrivee = champHeure('Début d’accueil', v.heure_arrivee || '08:30');
    temps.appendChild(arrivee.bloc);
    /* §16.5 — « fin d'accueil », pas « heure de départ ». L'accueil s'arrête à
       17h30 ; les minutes supplémentaires viennent APRÈS, et c'est leur somme
       qui fait la référence d'une journée (§17.5). */
    var depart = champHeure('Fin d’accueil', v.heure_depart || '17:30',
      { aide: 'Les minutes supplémentaires ci-dessous viennent après cette heure.' });
    temps.appendChild(depart.bloc);

    var contractuelles = champDuree('Journée d’accueil prévue au contrat',
      v.minutes_contractuelles == null ? 540 : v.minutes_contractuelles);
    temps.appendChild(contractuelles.bloc);

    var supJour = champDuree('Minutes supplémentaires par jour travaillé',
      v.minutes_sup_jour == null ? 30 : v.minutes_sup_jour);
    temps.appendChild(supJour.bloc);

    var parJourConge = champDuree('Ce que consomme un jour de congé',
      v.minutes_par_jour_conge == null ? 540 : v.minutes_par_jour_conge,
      { aide: 'Sert à convertir vos compteurs en jours. Un jour de congé retire ' +
              'cette durée de vos réserves.' });
    temps.appendChild(parJourConge.bloc);

    var entretien = champ('Indemnité d’entretien par jour de présence',
      v.entretien_centimes_jour == null ? '5,00'
        : centimesEnSaisie(v.entretien_centimes_jour),
      { inputmode: 'decimal', placeholder: '5,00' });
    argent.appendChild(entretien.bloc);

    /* LOT 28 (§28.2) — LE CHOIX « MINUTES DUES QUAND L'ENFANT EST ABSENT »
       A DISPARU DU FORMULAIRE. Règle d'Adrien du 25 août 2026, confirmée le
       26 : quand l'enfant est absent, ni indemnité d'entretien, ni minute
       supplémentaire — pour tous les contrats. Le moteur ne lit plus ce
       réglage ; la colonne reste en base (aucune migration) et un avenant
       écrit désormais `false`. Le libellé, lui, dit la règle. */
    temps.appendChild(ce('p', 'sb q',
      'Quand l’enfant est absent, aucune minute supplémentaire n’est due, ni ' +
      'indemnité d’entretien : c’est la règle, pour tous les contrats.'));

    var ordre = champSelect('Vos congés se prennent d’abord sur',
      [['cp_puis_sup', 'Mes congés payés'], ['sup_puis_cp', 'Ma récupération']],
      v.ordre_imputation === 'sup_puis_cp' ? 'sup_puis_cp' : 'cp_puis_sup');
    argent.appendChild(ordre.bloc);


    var brut = champ('Salaire brut mensuel',
      v.brut_mensuel_centimes == null ? '' : centimesEnSaisie(v.brut_mensuel_centimes),
      { inputmode: 'decimal', placeholder: '1 401,20' });
    argent.appendChild(brut.bloc);
    var net = champ('Salaire net mensuel',
      v.net_mensuel_centimes == null ? '' : centimesEnSaisie(v.net_mensuel_centimes),
      { inputmode: 'decimal', placeholder: '1 094,60' });
    argent.appendChild(net.bloc);
    argent.appendChild(ce('p', 'sb q',
      'Le net se lit sur la fiche de paie : il ne se calcule pas depuis le brut.'));

    function valeursSaisies() {
      return {
        jours_planning: planning.valeur(),
        heure_arrivee: arrivee.valeur(),
        heure_depart: depart.valeur(),
        minutes_contractuelles: contractuelles.valeur(),
        minutes_sup_jour: supJour.valeur(),
        minutes_par_jour_conge: parJourConge.valeur(),
        entretien_centimes_jour: parseEuros(entretien.input.value),
        sup_dues_si_enfant_absent: false,   // §28.2 — la règle, pas un choix
        ordre_imputation: ordre.select.value,
        brut_mensuel_centimes: brut.input.value.trim() ? parseEuros(brut.input.value) : null,
        net_mensuel_centimes: net.input.value.trim() ? parseEuros(net.input.value) : null
      };
    }

    /* Les refus disent CE QUI ne va pas et POURQUOI. Ils reprennent les
       contraintes de la migration `014`, qui reste la garantie : celles-ci
       ne servent qu'à parler français avant l'aller-retour. */
    function erreur() {
      var x = valeursSaisies();
      if (!x.jours_planning.length) {
        return 'Choisissez au moins un jour de garde : sans planning, aucun mois ne peut être calculé.';
      }
      if (x.heure_depart <= x.heure_arrivee) {
        return 'La fin d’accueil doit venir après le début.';
      }
      if (x.minutes_contractuelles === null || x.minutes_contractuelles <= 0) {
        return 'La journée d’accueil prévue au contrat est illisible ou nulle.';
      }
      if (x.minutes_sup_jour === null) {
        return 'Les minutes supplémentaires par jour sont illisibles.';
      }
      if (x.minutes_par_jour_conge === null || x.minutes_par_jour_conge <= 0) {
        return 'Ce que consomme un jour de congé doit être une durée non nulle : ' +
               'c’est elle qui convertit vos compteurs en jours.';
      }
      if (x.entretien_centimes_jour === null) {
        return 'L’indemnité d’entretien est illisible (exemple : 5,00).';
      }
      if (brut.input.value.trim() && x.brut_mensuel_centimes === null) {
        return 'Le salaire brut est illisible (exemple : 1 401,20).';
      }
      if (net.input.value.trim() && x.net_mensuel_centimes === null) {
        return 'Le salaire net est illisible (exemple : 1 094,60).';
      }
      return null;
    }

    return { bloc: bloc, temps: temps, argent: argent,
             valeurs: valeursSaisies, erreur: erreur };
  }

  /* Centimes -> saisie française, sans le symbole ni l'espace insécable :
     c'est ce qu'on remet DANS un champ, pas ce qu'on affiche. */
  function centimesEnSaisie(centimes) {
    if (centimes == null) return '';
    var signe = centimes < 0 ? '-' : '';
    var abs = centimes < 0 ? -centimes : centimes;
    return signe + Math.floor(abs / 100) + ',' + String(abs % 100).padStart(2, '0');
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

    /* LOT 18 §18.6 — un écran peut avoir besoin de RÉAGIR au changement de
       date, et pas seulement de la lire au moment où l'on valide. L'écran de
       fin de contrat en a besoin : l'avertissement « ce mois n'est pas encore
       clôturé » ne vaut que pour le mois de la date choisie.
       Optionnel : les appelants existants ne changent pas d'un caractère. */
    if (typeof opts.onchange === 'function') {
      [selJour, selMois, selAnnee].forEach(function (sel) {
        sel.addEventListener('change', function () { opts.onchange(); });
      });
    }

    /* LOT 26 (§26.1) — `poser` : un écran peut avoir besoin de DÉPLACER la
       date, et pas seulement de la lire. L'écran de pose en a besoin : le
       « Au » suit le « Du » quand celui-ci le dépasse, comme la maquette. Une
       plage inversée n'est pas une erreur à signaler, c'est une plage qu'on
       vient de déplacer — et un avertissement à la place d'un ajustement
       ferait porter à Maria le travail de l'écran.
       Le champ ne DÉCLENCHE PAS `onchange` en se posant : c'est l'appelant
       qui vient de décider, il sait déjà. */
    function poser(isoDate) {
      var q = String(isoDate || '').slice(0, 10).split('-');
      if (q.length !== 3) return;
      selAnnee.value = String(Number(q[0]));
      selMois.value = String(Number(q[1]));
      majJours();
      selJour.value = String(Number(q[2]));
    }

    return {
      bloc: f,
      poser: poser,
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

  /* LOT 17 §17.4 — SÉLECTEUR DE MOIS EN LISTE UNIQUE, avec les mois INTERDITS
     montrés et barrés plutôt que cachés.

     « Le sélecteur affiche les mois clôturés barrés AVEC LEUR RAISON plutôt
     que de les cacher. » Un mois absent de la liste ne dit rien : Maria le
     cherche, ne le trouve pas, et conclut à un défaut de l'application. Un
     mois barré qui porte « clôturé le 3 novembre » lui dit ce qui bloque et ce
     qu'elle peut faire — rouvrir ce mois-là.

     `opts.interdits` : { 'YYYY-MM': 'raison en français' }. La liste couvre
     `opts.deMois` → `opts.aMois` inclus, tous deux { annee, mois }. */
  function champMoisListe(libelle, isoDefaut, opts) {
    opts = opts || {};
    var interdits = opts.interdits || {};
    /* LOT 30 (§30.3) — `signales` : des mois NOMMÉS avec leur raison, mais
       choisissables. C'est le cas d'un mois clôturé pour un avenant : le
       choisir propose de le rouvrir au moment de valider, il n'est plus
       barré. */
    var signales = opts.signales || {};
    var de = opts.deMois || { annee: Number(String(isoDefaut).slice(0, 4)) - 1, mois: 1 };
    var a = opts.aMois || { annee: de.annee + 3, mois: 12 };

    var f = ce('div', 'fld');
    f.appendChild(ce('span', 'lb', libelle));
    var sel = ce('select');
    var courant = { annee: de.annee, mois: de.mois };
    var voulu = String(isoDefaut || '').slice(0, 7);
    /* CORRECTION DE LA REMARQUE 3 DE LA RELECTURE DU LOT 17 — LE REPLI PART DU
       MOIS VOULU, PAS DU DÉBUT DE LA LISTE.

       `premierLibre` retenait le premier mois libre de TOUTE la liste, donc le
       plus ancien. Si juillet 2026 était clôturé, l'écran proposait « Faire
       l'avenant au 1er septembre 2024 » — deux ans en arrière — avec la phrase
       « Les mois d'août 2024 et avant ne changeront pas ». Le repli est
       désormais le premier mois libre À PARTIR de celui qu'on visait. */
    var premierLibre = null;
    var rangVoulu = voulu
      ? Number(voulu.slice(0, 4)) * 12 + Number(voulu.slice(5, 7))
      : -Infinity;
    while (courant.annee * 12 + courant.mois <= a.annee * 12 + a.mois) {
      var cle = courant.annee + '-' + String(courant.mois).padStart(2, '0');
      var op = ce('option');
      op.value = cle + '-01';
      var etiquette = MOIS[courant.mois] + ' ' + courant.annee;
      if (interdits[cle]) {
        /* Barré ET expliqué. Le tiret cadratin et la parenthèse font le travail
           du style barré, qui ne survit pas dans un <option> selon le système. */
        op.textContent = '— ' + etiquette + ' (' + interdits[cle] + ')';
        op.disabled = true;
      } else {
        op.textContent = signales[cle] ? etiquette + ' (' + signales[cle] + ')' : etiquette;
        if (premierLibre === null && courant.annee * 12 + courant.mois >= rangVoulu) {
          premierLibre = op.value;
        }
      }
      sel.appendChild(op);
      courant.mois++;
      if (courant.mois > 12) { courant.mois = 1; courant.annee++; }
    }
    /* La valeur voulue si elle est libre ; sinon le premier mois disponible —
       jamais un mois interdit présélectionné, qui ferait croire qu'il passe. */
    var cible = interdits[voulu] ? null : voulu + '-01';
    sel.value = cible || premierLibre || '';
    f.appendChild(sel);
    if (opts.aide) f.appendChild(ce('div', 'sb q', opts.aide));

    return {
      bloc: f, select: sel,
      valeur: function () { return sel.value; },
      mois: function () {
        return { annee: Number(sel.value.slice(0, 4)), mois: Number(sel.value.slice(5, 7)) };
      }
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
    /* LOT 24 (§24.3) — le corps d'une feuille est une colonne flex qui peut
       défiler avec elle : il porte la garde Safari (`> * { flex: none }`)
       posée dans le composant, pas au cas par cas. */
    var corps = ce('div', 'corps-feuille');
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
     Rien d'autre : ni férié, ni congé — c'est l'étape d'avant.

     LOT 17 §17.2 — LE PLANNING EST DONNÉ, PAS LU SUR `contrat`. Les jours de
     garde sont datés depuis le lot 17 : un avenant peut les changer au 1er
     d'un mois. Lire `contrat.jours_planning` afficherait le planning
     d'aujourd'hui sur un mois d'hier, et réécrirait les « journées
     particulières » d'un document déjà remis à une famille.

     L'appelant passe donc le planning du MOIS, résolu depuis les conditions.
     Il reste facultatif — un `null` retombe sur lundi-vendredi — parce que
     certains écrans travaillent sur un contrat dont la chaîne n'a pas encore
     répondu ; c'est un défaut d'affichage, jamais un chiffre. */
  function joursPlanning(contrat, planning, annee, mois) {
    var pl = (planning && planning.length) ? planning : [1, 2, 3, 4, 5];
    return global.Engine.joursDuMois(annee, mois).filter(function (d) {
      if (pl.indexOf(global.Engine.jourSemaine(d)) === -1) return false;
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
  function joursTravailles(contrat, planning, annee, mois, journees) {
    journees = journees || {};
    return joursPlanning(contrat, planning, annee, mois).filter(function (d) {
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

  /* LOT 30 (§30.4) — UN MOIS ROUVERT SE RECONNAÎT À SON RÉCAPITULATIF :
     statut « brouillon » ET un instantané conservé (`donnees`), celui du
     document remis. Un mois jamais clôturé n'a pas d'instantané. */
  function moisRouvert(recap) {
    return !!(recap && recap.statut === 'brouillon' && recap.donnees);
  }

  function etatDuMois(annee, mois, recap, aujourdhuiIso) {
    if (recap && recap.statut === 'fige') return ETAT_CLOTURE;
    /* LOT 30 (§30.4) — un mois rouvert est À RECLÔTURER, quelle que soit la
       date : il ne redevient pas un brouillon ordinaire qu'on oublie. C'est
       ce qui le fait entrer dans « Aujourd'hui » et dans la pastille. */
    if (moisRouvert(recap)) return ETAT_A_CLOTURER;

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
  function joursTravaillesRestants(contrat, planning, annee, mois, aujourdhuiIso, journees) {
    if (!contrat || !aujourdhuiIso) return 0;
    return joursPlanning(contrat, planning, annee, mois).filter(function (d) {
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
    /* LOT 28 — le nom d'un écart d'horaire, en un seul exemplaire, partagé
       par le document remis à la famille et par « Journées à part ». */
    LIBELLE_EVENEMENT_ECART: LIBELLE_EVENEMENT_ECART,
    LIBELLE_DESTINATION_ECART: LIBELLE_DESTINATION_ECART,
    /* §6.3 — la phrase du décompte, en un seul exemplaire. */
    ENCART_RG06: ENCART_RG06,
    RESUME_RG06: RESUME_RG06,
    anneeDeReferenceConges: anneeDeReferenceConges,
    QUOTA_SAMEDIS: QUOTA_SAMEDIS,
    ce: ce, vider: vider, bouton: bouton, ajouter: ajouter,
    eur: eur, eurCourt: eurCourt, heures: heures, joursCp: joursCp, jours: jours, duree: duree,
    cpDisponible: cpDisponible, supDisponible: supDisponible,
    /* §17.5 / correction B5 — le solde SIGNÉ, pour l'affichage. */
    cpSolde: cpSolde, supSolde: supSolde,
    SEUIL_CP_BAS_JOURS: SEUIL_CP_BAS_JOURS,
    cpEstBas: cpEstBas,
    parseEuros: parseEuros, parseEntier: parseEntier,
    libelleMois: libelleMois, libelleMoisAnnee: libelleMoisAnnee, moisCapitale: moisCapitale,
    /* LOT 16 §16.6 — élision ; §16.8 — libellé d'une période. */
    elider: elider, deMois: deMois, deMoisAnnee: deMoisAnnee,
    libellePeriode: libellePeriode,
    plagesDeJours: plagesDeJours,
    libellePlageJours: libellePlageJours,
    libellePeriodeTroisCas: libellePeriodeTroisCas,
    jourLong: jourLong, dateLongue: dateLongue,
    /* LOT 28 — le quantième seul (« 1er », « 26 »), pour énumérer plusieurs
       dates d'un même mois sans répéter le mois à chaque fois. `jourEtMois`
       s'en servait déjà ; il n'était simplement pas exposé. */
    quantieme: quantieme, jourEtMois: jourEtMois,
    MOIS: MOIS, MOIS_COURT: MOIS_COURT, JOURS_SEMAINE: JOURS_SEMAINE, NBSP: NBSP,
    pane: pane, lines: lines, ligne: ligne, note: note, warnbox: warnbox, section: section,
    /* LOT 24 (§24.2) — les composants uniques du socle. */
    enc: enc, encOne: encOne, ligneLn: ligneLn, carteTap: carteTap,
    fold: fold, seg: seg, stepper: stepper, pill: pill, stick: stick,
    fld: fld, fldModifiable: fldModifiable, champ: champ, champSelect: champSelect, selectSimple: selectSimple,
    champDate: champDate, champMois: champMois, nbJoursDansMois: nbJoursDansMois, iso: iso,
    ouvrirFeuille: ouvrirFeuille, fermerFeuille: fermerFeuille, feuilleEstOuverte: feuilleEstOuverte,
    choix: choix,
    toast: toast, messageErreur: messageErreur, copierTexte: copierTexte,
    joursPlanning: joursPlanning, joursTravailles: joursTravailles, typeDuJour: typeDuJour,
    etatDuMois: etatDuMois,
    /* LOT 30 — le prédicat d'un mois rouvert, à un seul endroit. */
    moisRouvert: moisRouvert, joursTravaillesRestants: joursTravaillesRestants,
    pastilleEtat: pastilleEtat, LIBELLE_ETAT: LIBELLE_ETAT,
    JOUR_BASCULE_CLOTURE: JOUR_BASCULE_CLOTURE,
    /* LOT 17 §17.4 — le formulaire des onze conditions, partagé par la
       création d'un contrat et « Faire un avenant ». */
    champsConditions: champsConditions, champDuree: champDuree,
    champMoisListe: champMoisListe,
    champHeure: champHeure,
    champHeureMinute: champHeureMinute, champPlanning: champPlanning,
    centimesEnSaisie: centimesEnSaisie,
    accord: accord, accordDe: accordDe, avatar: avatar, nomComplet: nomComplet,
    COULEURS_IDENTITE: COULEURS_IDENTITE, couleurIdentite: couleurIdentite
  };
})(window);
