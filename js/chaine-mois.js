/* ============================================================================
   chaine-mois.js — Chaîne des mois d'un contrat (lot 5).

   AUCUNE RÈGLE MÉTIER ICI. Ce module ne fait qu'ORCHESTRER : il charge les
   données via DB, enchaîne les mois (compteurSortie du mois N -> compteurEntree
   du mois N+1) et délègue chaque mois à Engine.calculerMois(). Il n'existe et
   n'existera qu'UN SEUL moteur de calcul (js/engine.js) : le récapitulatif de
   période (C6) agrège des résultats mensuels, il n'en recalcule aucun
   autrement.

   Pourquoi ce module : la chaîne des mois était écrite dans ui-recap.js et
   n'était donc utilisable que par l'écran mensuel. Le récap de période (C6),
   l'historique par famille (C4) et le solde de fin de contrat (C3) ont besoin
   exactement de la même chaîne. On l'extrait telle quelle plutôt que de la
   réécrire trois fois — une seule source de vérité.

   Deux principes non négociables :
   - Un mois FIGÉ n'est jamais recalculé : on lit son instantané (RG-15 et
     immuabilité). Son compteurSortie alimente le mois suivant : c'est le
     chiffre parti chez les parents qui fait foi, pas un recalcul.
   - Chargement MUTUALISÉ : les journées de toute la période sont lues en un
     seul aller-retour, les récaps aussi. Sur une année et quatre contrats,
     l'écart se voit à l'œil nu.

   Dates : chaînes 'YYYY-MM-DD' (dates pures), jamais d'objet Date avec heure.
   ========================================================================= */
(function (global) {
  'use strict';

  /* Garde-fou : une chaîne de plus de 600 mois (50 ans) est forcément une
     donnée aberrante (date_debut fantaisiste). On borne et on le dit. */
  var MAX_MOIS = 600;

  function resoudreEngine() {
    if (global.Engine) return global.Engine;
    if (typeof module !== 'undefined' && module.exports) return require('./engine.js');
    throw new Error('chaine-mois : Engine (js/engine.js) non chargé.');
  }
  function resoudreDb() {
    if (global.DB) return global.DB;
    throw new Error('chaine-mois : DB (js/db.js) non chargé.');
  }
  function resoudreFeries() {
    if (global.Feries) return global.Feries;
    if (typeof module !== 'undefined' && module.exports) return require('./feries.js');
    throw new Error('chaine-mois : Feries (js/feries.js) non chargé.');
  }

  /* ------------------------------------------------------------------ */
  /* Calendrier (pur, sans fuseau)                                       */
  /* ------------------------------------------------------------------ */

  function estBissextile(a) { return (a % 4 === 0 && a % 100 !== 0) || a % 400 === 0; }
  function nbJoursDansMois(annee, mois) {
    return [31, estBissextile(annee) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mois - 1];
  }
  function deuxChiffres(n) { return String(n).padStart(2, '0'); }
  function premierJour(annee, mois) { return annee + '-' + deuxChiffres(mois) + '-01'; }
  function dernierJour(annee, mois) {
    return annee + '-' + deuxChiffres(mois) + '-' + deuxChiffres(nbJoursDansMois(annee, mois));
  }
  function moisSuivant(a, m) { m++; if (m > 12) { m = 1; a++; } return { annee: a, mois: m }; }
  function moisPrecedent(a, m) { m--; if (m < 1) { m = 12; a--; } return { annee: a, mois: m }; }
  function cmpMois(a1, m1, a2, m2) { return a1 !== a2 ? a1 - a2 : m1 - m2; }
  function moisDeDate(dateStr) { var p = String(dateStr).split('-'); return { annee: +p[0], mois: +p[1] }; }
  function cleMois(annee, mois) { return annee + '-' + deuxChiffres(mois); }
  function nbMoisEntre(a1, m1, a2, m2) { return (a2 - a1) * 12 + (m2 - m1) + 1; }

  var LIBELLES_MOIS = ['', 'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
    'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  function libelleMois(mois) { return LIBELLES_MOIS[mois]; }
  function libelleMoisAnnee(annee, mois) { return LIBELLES_MOIS[mois] + ' ' + annee; }

  /* ------------------------------------------------------------------ */
  /* Chargement mutualisé                                                */
  /* ------------------------------------------------------------------ */

  function chargerJournees(DB, contratId, debut, fin) {
    if (typeof DB.getJourneesPeriode === 'function') {
      return DB.getJourneesPeriode(contratId, debut, fin);
    }
    /* Repli (DB ancien ou simulé) : lecture mois par mois. */
    var d = moisDeDate(debut), f = moisDeDate(fin);
    var cur = { annee: d.annee, mois: d.mois };
    var parMois = {};
    var seq = Promise.resolve();
    var garde = 0;
    while (cmpMois(cur.annee, cur.mois, f.annee, f.mois) <= 0 && garde < MAX_MOIS) {
      (function (mm) {
        seq = seq.then(function () {
          return DB.getJourneesMois(contratId, mm.annee, mm.mois).then(function (parJour) {
            parMois[cleMois(mm.annee, mm.mois)] = parJour || {};
          });
        });
      })(cur);
      cur = moisSuivant(cur.annee, cur.mois);
      garde++;
    }
    return seq.then(function () { return parMois; });
  }

  /* ------------------------------------------------------------------ */
  /* Les imputations de congé posées (correctif B1 de la relecture PR9)   */
  /*                                                                     */
  /* CE CHARGEMENT MANQUAIT, ET C'EST TOUT LE LOT 10 QUI NE SERVAIT À     */
  /* RIEN. Le lot 9 avait donné au moteur la capacité d'accepter une      */
  /* ventilation IMPOSÉE — « ces 6 jours, je les prends 0 sur mes congés  */
  /* payés et 6 sans solde ». Le lot 10 a construit l'écran qui la fait   */
  /* choisir et l'écrit en base. Personne n'a branché les deux : ce       */
  /* fichier est le SEUL appelant du moteur pour tous les écrans, et il   */
  /* ne transmettait pas `imputations`. Le moteur retombait donc          */
  /* systématiquement sur l'ordre par défaut du contrat (RG-07), et le    */
  /* choix de Maria — écrit, visible, confirmé à l'écran — n'avait aucun  */
  /* effet sur le récapitulatif remis à la famille.                       */
  /*                                                                     */
  /* La fenêtre de lecture DÉBORDE volontairement des bornes de la        */
  /* chaîne : une période posée du 29 juillet au 4 août doit être connue  */
  /* du mois d'août, alors qu'elle COMMENCE en juillet. `listImputations` */
  /* interroge par recouvrement (`date_debut <= fin` et `date_fin >=      */
  /* debut`), ce qui suffit — encore faut-il l'appeler.                   */
  /* ------------------------------------------------------------------ */
  function chargerImputations(DB, contratId, debut, fin) {
    /* Contrôle de CAPACITÉ, pas rattrapage d'erreur : les décors de test
       anciens n'exposent pas cette fonction. Une erreur réelle, elle,
       remonte — une imputation silencieusement perdue redonnerait
       exactement le défaut qu'on corrige ici. */
    if (typeof DB.listImputations !== 'function') return Promise.resolve([]);
    return DB.listImputations(contratId, debut, fin).then(function (l) { return l || []; });
  }

  /* Les imputations dont la période RECOUPE le mois. Le moteur veut la ligne
     ENTIÈRE — bornes comprises — pour décompter la période d'un seul tenant
     (RG-06) et n'en retenir que la part du mois. On ne découpe rien ici. */
  function imputationsDuMois(imputations, annee, mois) {
    var d = premierJour(annee, mois);
    var f = dernierJour(annee, mois);
    return (imputations || []).filter(function (i) {
      return i && i.date_debut <= f && i.date_fin >= d;
    });
  }

  /* ------------------------------------------------------------------ */
  /* LOT 17 — DEUX DETTES DU LOT 16 RENDUES AU MOTEUR                    */
  /* ------------------------------------------------------------------ */

  /* Le lot 16 avait dû écrire ICI deux fonctions qui redisaient RG-06 :
     `partDuMois`, qui déduisait la part d'une période à cheval par différence
     de deux décomptes, et `feriesDecomptes`, qui recopiait la boucle de
     reprise du moteur. Toutes deux étaient justes, et toutes deux étaient au
     mauvais endroit : une règle métier écrite à deux endroits finit toujours
     par diverger, et celle-ci est précisément celle qui fait litige avec les
     familles.

     Le lot 17 est le seul autorisé à rouvrir `js/engine.js` : la dette est
     donc soldée. `Engine.joursOuvrablesParMois` existait déjà, non exposée ;
     `Engine.feriesDeLaPeriode` est le déménagement littéral de
     `feriesDecomptes`, boucle pour boucle. Il ne reste ici qu'une LECTURE de
     ce que le moteur produit — plus aucune règle.

     `feriesDecomptes` n'est plus exportée du tout : les écrans appellent
     `Engine.feriesDeLaPeriode`. Laisser un alias aurait gardé deux noms pour
     une seule règle, ce qui est la moitié du défaut d'origine. */

  /* Part d'une période imputée tombant dans un mois donné (§16.8 : « Du 29
     juillet au 4 août — 6 jours ouvrables, dont 2 en août »). Ce n'est plus
     un calcul, c'est la lecture d'une tranche. */
  function partDuMois(Engine, imputation, planning, annee, mois) {
    if (!imputation || !imputation.date_debut || !imputation.date_fin) return 0;
    if (imputation.date_fin < imputation.date_debut) return 0;
    var cible = annee + '-' + String(mois).padStart(2, '0');
    var tranches = Engine.joursOuvrablesParMois(
      imputation.date_debut, imputation.date_fin, planning);
    for (var i = 0; i < tranches.length; i++) {
      if (tranches[i].cle === cible) return tranches[i].jours;
    }
    return 0;
  }

  /* ------------------------------------------------------------------ */
  /* LOT 16 §16.1 — Le repli d'imputation                                */
  /* ------------------------------------------------------------------ */

  /* Les trois codes que le moteur lève quand une ventilation de congé
     enregistrée ne peut pas être honorée. Ils ont tous la même conséquence
     pour Maria : sans repli, `serie` rejette, et l'écran qui lui permettrait
     de corriger est précisément celui qui refuse de s'ouvrir. */
  var CODES_IMPUTATION = {
    IMPUTATION_DEPASSE_RESERVES: true,
    IMPUTATION_INCOMPLETE: true,
    IMPUTATION_NEGATIVE: true
  };

  function estErreurImputation(e) {
    return !!(e && e.code && CODES_IMPUTATION[e.code] === true);
  }

  /* Un nombre de jours volontairement hors d'atteinte : `imputerConges` le
     répartit dans l'ordre du contrat, épuise les DEUX réserves, et le
     débordement part en sans solde. Ce qu'il a pu prendre sur chacune est
     donc, en jours, ce que chaque réserve couvre — quel que soit RG-07.
     C'est le moteur qui divise ; rien n'est recalculé ici. */
  var SONDE_JOURS = 1000000;

  function memeParams(params, imputations) {
    return {
      contrat: params.contrat, conditions: params.conditions, journees: params.journees,
      compteurEntree: params.compteurEntree, annee: params.annee, mois: params.mois,
      imputations: imputations
    };
  }

  /* Ce que les réserves du mois couvrent réellement, en jours, demandé au
     moteur. Sert à l'encart : « vous aviez choisi 6 jours de récupération,
     vous n'en avez que 5 ». */
  function reservesEnJours(Engine, conditions, compteurEntree) {
    var c = compteurEntree || {};
    var r = Engine.imputerConges(SONDE_JOURS, {
      minutesCp: (c.minutesCpAcquis || 0) - (c.minutesCpPris || 0),
      minutesSup: c.minutesSup || 0
    }, conditions);
    return { joursCp: r.joursSurCp, joursSup: r.joursSurSup };
  }

  /* Reprend la forme que le moteur produit déjà pour un choix écarté
     (`source: 'defaut_choix_ecarte'` + `choixEcarte`), afin que les écrans
     n'aient qu'UN seul cas à connaître. La période marquée est celle que le
     moteur a décomptée par défaut et qui recouvre l'imputation refusée. */
  function marquerEcartees(resultat, ecartees) {
    var appliquees = (resultat && resultat.imputationsAppliquees) || [];
    ecartees.forEach(function (x) {
      for (var i = 0; i < appliquees.length; i++) {
        var a = appliquees[i];
        if (a.date_debut > x.imputation.date_fin) continue;
        if (a.date_fin < x.imputation.date_debut) continue;
        /* CORRECTION RELECTURE LOT 16 (C5) — DEUX IMPUTATIONS ÉCARTÉES PEUVENT
           TOMBER DANS LA MÊME PÉRIODE REGROUPÉE PAR LE MOTEUR.

           La boucle sautait les maillons déjà marqués (`source !== 'defaut'`)
           et sortait dès le premier trouvé : la seconde écartée n'était alors
           jamais marquée, et le calendrier de l'espace enfant n'en montrait
           qu'une. Les chiffres étaient justes, l'affichage incomplet.

           On marque désormais la période — que ce soit la première fois ou la
           seconde — et `choixEcarte` devient une LISTE quand plusieurs choix
           tombent au même endroit. La forme reste compatible : le premier
           écarté garde sa place, les écrans qui ne lisent que `choixEcarte`
           continuent de fonctionner. */
        if (a.source !== 'defaut' && a.source !== 'defaut_choix_ecarte') continue;
        var choix = { date_debut: x.imputation.date_debut, date_fin: x.imputation.date_fin };
        if (a.source === 'defaut_choix_ecarte') {
          a.choixEcartes = (a.choixEcartes || [a.choixEcarte]).concat([choix]);
        } else {
          a.source = 'defaut_choix_ecarte';
          a.choixEcarte = choix;
          a.choixEcartes = [choix];
        }
        return;
      }
    });
  }

  /* Calcule un mois. Si — et SEULEMENT si — le moteur refuse à cause d'une
     ventilation devenue impossible, la ou les imputations en cause sont
     écartées et le mois est rejoué avec l'ordre par défaut du contrat pour
     ces périodes-là.

     AUCUNE RÈGLE MÉTIER ICI, et le moteur n'est pas assoupli : il continue de
     dire non. Ce module se contente de retirer une ligne de l'entrée et de
     redemander — c'est de l'orchestration, sa seule raison d'être.

     Pourquoi une par une et dans l'ordre chronologique : c'est exactement
     l'ordre dans lequel le moteur décrémente les réserves au fil des périodes
     (`js/engine.js`, boucle sur `plan`). Une imputation valable seule peut
     devenir impossible après qu'une précédente a consommé la réserve ;
     l'inverse ne se produit pas. Les ajouter une à une dans cet ordre isole
     donc celles qui ne passent pas, sans jamais en écarter une qui tenait —
     c'est le critère A6 (« seule l'imputation fautive est écartée »).

     Sur un échec d'une autre nature, RIEN n'est rejoué et l'erreur remonte
     telle quelle : l'écran affichera ce qu'il peut et dira ce qui manque.
     Une erreur qu'on ne sait pas nommer ne doit pas être avalée. */
  function calculerMoisAvecRepli(params) {
    var Engine = resoudreEngine();
    var premiere;
    try {
      return { resultat: Engine.calculerMois(params), ecartees: [] };
    } catch (e) {
      if (!estErreurImputation(e)) throw e;
      premiere = e;
    }

    var candidates = (params.imputations || []).slice().sort(function (a, b) {
      if (a.date_debut === b.date_debut) return 0;
      return a.date_debut < b.date_debut ? -1 : 1;
    });
    var retenues = [];
    var ecartees = [];
    for (var i = 0; i < candidates.length; i++) {
      var essai = retenues.concat([candidates[i]]);
      try {
        Engine.calculerMois(memeParams(params, essai));
        retenues = essai;
      } catch (e2) {
        if (!estErreurImputation(e2)) throw e2;
        /* CORRECTION RELECTURE LOT 16 (B1) — LE NOMBRE QUI MANQUE.

           Sur `IMPUTATION_INCOMPLETE`, le moteur pose sur l'erreur le décompte
           RG-06 qu'il a lui-même calculé (`attendu`) et la somme reçue
           (`recu`). Ces deux nombres n'étaient pas repris : l'encart écrivait
           donc « votre répartition ne couvre pas les 5 jours » là où 5 était
           justement ce qu'elle avait réparti — la phrase disait que 5 ne
           couvre pas 5, et le nombre manquant, 6, n'apparaissait nulle part.

           Sans lui, l'écran de correction ne peut pas non plus annoncer le bon
           nombre de jours à répartir, et Maria tourne en rond indéfiniment. */
        ecartees.push({
          imputation: candidates[i],
          code: e2.code,
          attendu: typeof e2.attendu === 'number' ? e2.attendu : null,
          recu: typeof e2.recu === 'number' ? e2.recu : null
        });
      }
    }

    /* Aucune imputation n'a pu être désignée : le refus ne vient pas d'une
       ligne identifiable. On ne masque pas ce qu'on ne comprend pas. */
    if (!ecartees.length) throw premiere;

    var resultat = Engine.calculerMois(memeParams(params, retenues));
    marquerEcartees(resultat, ecartees);

    var dispo = reservesEnJours(Engine, params.conditions, params.compteurEntree);
    var detail = ecartees.map(function (x) {
      var imp = x.imputation;
      return {
        /* L'identifiant, pour que le bouton « Corriger la répartition » ouvre
           LA période concernée et pas le parcours de pose. */
        id: imp.id,
        date_debut: imp.date_debut,
        date_fin: imp.date_fin,
        code: x.code,
        /* Le décompte RG-06 réel de la période, tel que le moteur le calcule
           (B1). `null` quand le code d'erreur ne le porte pas. */
        attendu: x.attendu,
        recu: x.recu,
        choisi: {
          joursSurCp: imp.jours_sur_cp || 0,
          joursSurSup: imp.jours_sur_sup || 0,
          joursSansSolde: imp.jours_sans_solde || 0,
          joursOuvrables: imp.jours_ouvrables == null ? null : imp.jours_ouvrables
        },
        disponible: { joursCp: dispo.joursCp, joursSup: dispo.joursSup }
      };
    });
    return { resultat: resultat, ecartees: detail };
  }

  function chargerRecaps(DB, contratId, anneeMin, anneeMax) {
    if (typeof DB.listRecapsPeriode === 'function') {
      return DB.listRecapsPeriode(contratId, anneeMin, anneeMax).then(function (lignes) {
        var parMois = {};
        (lignes || []).forEach(function (r) { parMois[cleMois(r.annee, r.mois)] = r; });
        return parMois;
      });
    }
    return Promise.resolve(null);   // repli : lecture unitaire dans la boucle
  }

  /* ------------------------------------------------------------------ */
  /* Période d'activité d'un contrat                                     */
  /* ------------------------------------------------------------------ */

  /* Le mois demandé est-il RECOUVERT par la période d'activité du contrat ?
     Exactement la règle de DB.listContratsPourMois, appliquée mois par mois :
       date_debut <= dernier jour du mois
       ET (date_fin nulle OU date_fin >= premier jour du mois)
     Comparaisons sur des chaînes 'YYYY-MM-DD' (dates pures). */
  /* CORRECTION DE LA REMARQUE 1 DE LA RELECTURE DU LOT 17 — RENOMMÉE.

     Elle s'appelait `contratCouvreLeMois`, comme la fonction du moteur
     (`js/engine.js`), qui dit l'INVERSE : là-bas, « couvre » signifie couvrir
     le mois ENTIER, pour RG-11 ; ici, il s'agit de savoir si le contrat
     TOUCHE le mois, ne serait-ce qu'un jour. Deux règles opposées sous le même
     nom, dans deux fichiers voisins : aucun défaut trouvé, mais un piège posé
     pour le lot suivant. */
  function contratToucheLeMois(contrat, annee, mois) {
    var premier = premierJour(annee, mois);
    var dernier = dernierJour(annee, mois);
    if (contrat.date_debut && contrat.date_debut > dernier) return false;
    if (contrat.date_fin && contrat.date_fin < premier) return false;
    return true;
  }

  /* Intersection de la fenêtre demandée [debut, fin] et de la période
     d'activité du contrat. Retourne null si elles ne se recouvrent pas.

     C'est ce qui empêche un récapitulatif de période de compter un mois de
     salaire pour un mois où le contrat n'existait plus : le moteur, lui, ne
     compte aucune journée hors bornes, mais il renvoie quand même le net du
     barème applicable — et un net additionné douze fois au lieu de sept fait
     un total faux et parfaitement crédible, sur le document même qui sert de
     pièce justificative après le départ d'une famille. */
  function fenetreContrat(contrat, debut, fin) {
    var d = { annee: debut.annee, mois: debut.mois };
    var f = { annee: fin.annee, mois: fin.mois };
    if (contrat.date_debut) {
      var cd = moisDeDate(contrat.date_debut);
      if (cmpMois(cd.annee, cd.mois, d.annee, d.mois) > 0) d = cd;
    }
    if (contrat.date_fin) {
      var cf = moisDeDate(contrat.date_fin);
      if (cmpMois(cf.annee, cf.mois, f.annee, f.mois) < 0) f = cf;
    }
    if (cmpMois(d.annee, d.mois, f.annee, f.mois) > 0) return null;
    return { debut: { annee: d.annee, mois: d.mois }, fin: { annee: f.annee, mois: f.mois } };
  }

  /* ------------------------------------------------------------------ */
  /* Chaîne des mois                                                     */
  /* ------------------------------------------------------------------ */

  /* Compteur d'ENTRÉE d'un mois figé, relu depuis son instantané.
     ResultatMois ne porte que le compteur de SORTIE ; l'entrée s'en déduit
     exactement, en défaisant l'enchaînement que ce module a lui-même posé :
       entrée.minutesSup = sortie − acquises + consommées
       entrée.cpAcquis   = sortie − acquis du mois
       entrée.cpPris     = sortie − consommés du mois − minutes de congé à l'heure
     Aucune règle nouvelle : c'est l'inverse littéral du chaînage. Sert à ce
     qu'un récapitulatif de période démarrant sur un mois figé affiche le
     solde d'entrée du DOCUMENT, et non celui d'un rejeu. Repli sur `defaut`
     si l'instantané est incomplet (récaps figés d'avant le lot 5). */
  function compteurEntreeDe(donnees, defaut) {
    if (!donnees || !donnees.compteurSortie) return defaut;
    var s = donnees.compteurSortie;
    var imp = donnees.imputation || {};
    if (typeof s.minutesSup !== 'number') return defaut;
    return {
      minutesSup: s.minutesSup - (donnees.minutesSupAcquises || 0) + (imp.minutesSupConsommees || 0),
      minutesCpAcquis: (s.minutesCpAcquis || 0) - (donnees.minutesCpAcquis || 0),
      /* CORRECTION C6 DE LA RELECTURE DU LOT 17 — LES CONGÉS À L'HEURE.
         Depuis le §17.6, la sortie vaut `entrée + minutesCpConsommees +
         minutesEcartSurCp`. Ce dernier terme n'était jamais retranché : un
         mois clôturé portant une libération d'1h30 imputée sur les congés
         payés affichait « 9 j 5h30 » au 1er du mois au lieu de « 10 j ».
         C'est ce compteur qui alimente le récapitulatif de période et le
         bilan annuel. Les instantanés d'avant le lot 17 ne portent pas ce
         champ : il vaut alors zéro, et le calcul est inchangé pour eux. */
      minutesCpPris: (s.minutesCpPris || 0) - (imp.minutesCpConsommees || 0)
                     - (donnees.minutesEcartSurCp || 0)
    };
  }

  /* ------------------------------------------------------------------ */
  /* LOT 17 §17.6 — LES INSTANTANÉS D'AVANT LA BASCULE                   */
  /* ------------------------------------------------------------------ */

  /* UN MOIS CLÔTURÉ N'EST JAMAIS RÉÉCRIT. C'est la quatrième des six qualités
     à ne pas casser, et le trigger d'immuabilité de la migration `002` le
     refuserait de toute façon. Les instantanés figés avant le lot 17 portent
     donc pour toujours des congés payés en DIXIÈMES DE JOUR, et ceux d'après
     les portent en MINUTES.

     La conversion se fait donc à la LECTURE, sur une COPIE, et jamais en base.
     Un instantané ancien se reconnaît à l'absence du champ `uniteCp`, que le
     moteur pose depuis le lot 17 — on ne devine pas l'unité d'un nombre.

     POURQUOI ÇA COMPTE. Le `compteurSortie` d'un mois figé alimente le mois
     suivant. Un solde de 300 dixièmes lu comme 300 minutes ferait passer
     30 jours de congés payés pour une demi-heure, et l'écart se propagerait
     sur toutes les années suivantes sans qu'aucun écran ne le signale — les
     compteurs ne se remettent jamais à zéro (RG-12).

     Le facteur est `minutes_par_jour_conge / 10`, pris dans les conditions du
     mois concerné : c'est la valeur qui avait cours quand l'instantané a été
     figé, et c'est la même que celle qu'a utilisée la migration `014`. */
  function instantaneEnMinutes(donnees, conditions) {
    if (!donnees) return donnees;
    if (donnees.uniteCp === 'minutes') return donnees;      // déjà à la bonne unité
    var mpjc = (conditions && conditions.minutes_par_jour_conge) || 540;
    var f = mpjc / 10;

    var copie = {};
    var k;
    for (k in donnees) copie[k] = donnees[k];

    copie.minutesCpAcquis = (donnees.dixiemesCpAcquis || 0) * f;
    if (donnees.imputation) {
      var imp = {};
      for (k in donnees.imputation) imp[k] = donnees.imputation[k];
      imp.minutesCpConsommees = (donnees.imputation.dixiemesCpConsommes || 0) * f;
      copie.imputation = imp;
    }
    if (donnees.compteurSortie) {
      var cs = {};
      for (k in donnees.compteurSortie) cs[k] = donnees.compteurSortie[k];
      cs.minutesCpAcquis = (donnees.compteurSortie.dixiemesCpAcquis || 0) * f;
      cs.minutesCpPris = (donnees.compteurSortie.dixiemesCpPris || 0) * f;
      copie.compteurSortie = cs;
    }
    /* §17.8 — le brut RÉELLEMENT dû du mois. Les instantanés d'avant le lot 17
       ne le portent pas ; il se reconstitue exactement, parce qu'aucun d'eux
       n'a connu le prorata du §17.7 : brut contractuel moins la retenue de
       sans solde, déjà exprimée en brut (RG-08). Sans cette reprise,
       l'indemnité de rupture ignorerait tous les mois clôturés — c'est-à-dire
       presque toute la vie du contrat. */
    if (copie.brutDuCentimes == null) {
      copie.brutDuCentimes = Math.max(0,
        (donnees.salaireBrutCentimes || 0) - (donnees.retenueSansSoldeCentimes || 0));
    }
    /* CORRECTION B4 DE LA RELECTURE — LE NET ET LE BRUT PRORATISÉS EXISTENT
       SUR TOUS LES INSTANTANÉS, SANS EXCEPTION.

       Le §17.7 fait du net proratisé LE net du mois. Un instantané d'avant le
       lot 17 ne le porte pas — et chaque écran devait alors se souvenir de
       replier sur `salaireNetCentimes`. Un seul l'a fait : le document. Les
       cinq autres écrans, plus `agregerPeriode`, affichaient le net
       contractuel, et se contredisaient entre eux sur le même mois.

       Le repli est donc posé ICI, une fois : aucun instantané ne sort de la
       chaîne sans ses deux champs proratisés. Ces mois n'ont jamais connu le
       prorata, leur net contractuel EST leur net dû — la reprise est exacte,
       pas approchée. */
    if (copie.salaireNetProrataCentimes == null) {
      copie.salaireNetProrataCentimes = copie.salaireNetCentimes || 0;
    }
    if (copie.salaireBrutProrataCentimes == null) {
      copie.salaireBrutProrataCentimes = copie.salaireBrutCentimes || 0;
    }
    /* On NE POSE PAS `uniteCp` sur la copie : elle resterait indiscernable
       d'un instantané récent si elle était un jour réécrite en base. La copie
       vit le temps d'un affichage, et c'est tout. */
    copie.instantaneConverti = true;
    return copie;
  }

  /* Rejoue tous les mois du contrat depuis son point de départ (compteur
     d'initialisation, sinon date de début) jusqu'au mois `cible` inclus.

     contrat : ligne de la table contrat
     cible   : { annee, mois } — dernier mois calculé
     opts    : { onProgress: function (fait, total),
                 depuis: { annee, mois } }   // premier mois voulu par l'appelant

     `opts.depuis` sert quand la fenêtre demandée commence AVANT le point de
     départ des compteurs : sans lui, la chaîne ne remonterait pas assez loin
     et le récapitulatif de période serait tronqué en silence.

     Résout :
       { mois: [ entree… ], depart, debutChaine, tronquee, avantInitialisation }
     avec entree = {
       annee, mois, cle,
       resultat,             // ResultatMois (instantané figé, ou calcul courant)
       fige,                 // true si le mois porte un récap figé
       recap,                // la ligne recap_mensuel s'il en existe une
       conditions,           // avenant en vigueur ce mois-là (§17.3), ou null
       salaire,              // idem — nom conservé pour les écrans qui ne
                             //   lisent que le brut et le net
       salaireManquant,      // aucune rémunération connue et mois non figé
       avantInitialisation,  // mois antérieur à la reprise manuelle des compteurs
       compteurEntree, compteurSortie
     }

     Un mois figé n'est JAMAIS recalculé : son instantané est repris tel quel
     et son compteurSortie alimente le mois suivant. */
  function serie(contrat, cible, opts) {
    opts = opts || {};
    var Engine = resoudreEngine();
    var DB = resoudreDb();

    /* LOT 17 §17.4 — `opts.avenants` REMPLACE la lecture en base, pour rejouer
       un mois « comme si » un avenant existait. C'est ce qui permet à l'écran
       « Faire un avenant » d'annoncer l'effet chiffré AVANT d'écrire, sans
       recomposer un seul montant à la main (B.0-5).

       Rien n'est écrit : la liste passée ici ne sort jamais de ce calcul. */
    return Promise.all([
      opts.avenants ? Promise.resolve(opts.avenants) : DB.getAvenants(contrat.id),
      DB.getCompteurInitial(contrat.id)
    ]).then(function (res) {
      var avenants = res[0] || [];
      var init = res[1];

      /* Point de départ « officiel » de la chaîne : la reprise manuelle des
         compteurs si elle existe (cahier §7, « ne pas repartir de zéro »),
         sinon le début du contrat. */
      var depart = init ? moisDeDate(init.date_reference) : moisDeDate(contrat.date_debut);
      var compteurInitial = init
        ? { minutesSup: init.minutes_sup,
            minutesCpAcquis: init.minutes_cp_acquis,
            minutesCpPris: init.minutes_cp_pris }
        : { minutesSup: 0, minutesCpAcquis: 0, minutesCpPris: 0 };
      var zero = { minutesSup: 0, minutesCpAcquis: 0, minutesCpPris: 0 };

      /* La chaîne peut devoir commencer AVANT ce point de départ : c'est le
         cas quand on remonte à une famille de l'année précédente (C4) ou
         qu'une période libre couvre des mois antérieurs à la mise en service
         de l'application (C6). Ces mois existent — ils ont des journées et un
         barème — mais aucun compteur ne peut en être déduit : la reprise
         manuelle est le point zéro. On les calcule avec des compteurs à zéro
         et on les MARQUE (`avantInitialisation`), pour que les écrans disent
         la vérité au lieu de faire croire à des soldes significatifs.
         Au mois de la reprise, le compteur est remis à sa valeur saisie :
         c'est elle qui fait foi, pas le cumul des mois d'avant. */
      var debutChaine = { annee: depart.annee, mois: depart.mois };
      if (opts.depuis && cmpMois(opts.depuis.annee, opts.depuis.mois, debutChaine.annee, debutChaine.mois) < 0) {
        debutChaine = { annee: opts.depuis.annee, mois: opts.depuis.mois };
      }
      if (cmpMois(cible.annee, cible.mois, debutChaine.annee, debutChaine.mois) < 0) {
        debutChaine = { annee: cible.annee, mois: cible.mois };
      }

      var total = nbMoisEntre(debutChaine.annee, debutChaine.mois, cible.annee, cible.mois);
      var tronquee = false;
      if (total > MAX_MOIS) { total = MAX_MOIS; tronquee = true; }

      var avantDepart = cmpMois(debutChaine.annee, debutChaine.mois, depart.annee, depart.mois) < 0;
      var compteur = avantDepart ? zero : compteurInitial;

      return Promise.all([
        chargerJournees(DB, contrat.id, premierJour(debutChaine.annee, debutChaine.mois), dernierJour(cible.annee, cible.mois)),
        chargerRecaps(DB, contrat.id, debutChaine.annee, cible.annee),
        chargerImputations(DB, contrat.id, premierJour(debutChaine.annee, debutChaine.mois), dernierJour(cible.annee, cible.mois))
      ]).then(function (charge) {
        var journeesParMois = charge[0] || {};
        var recapsParMois = charge[1];
        var imputations = charge[2] || [];

        var entrees = [];
        var cur = { annee: debutChaine.annee, mois: debutChaine.mois };
        var seq = Promise.resolve();

        for (var i = 0; i < total; i++) {
          (function (mm, rang) {
            seq = seq.then(function () {
              var cle = cleMois(mm.annee, mm.mois);
              var lireRecap = recapsParMois
                ? Promise.resolve(recapsParMois[cle] || null)
                : DB.getRecap(contrat.id, mm.annee, mm.mois);

              return lireRecap.then(function (recap) {
                /* Au mois de la reprise manuelle, le compteur saisi reprend
                   la main sur tout cumul antérieur. */
                if (cmpMois(mm.annee, mm.mois, depart.annee, depart.mois) === 0) {
                  compteur = compteurInitial;
                }
                var avant = cmpMois(mm.annee, mm.mois, depart.annee, depart.mois) < 0;
                /* Mois hors de la période d'activité du contrat : il est
                   rejoué pour ne pas rompre la continuité des compteurs, mais
                   il est MARQUÉ — aucun récapitulatif mensuel n'existe ni ne
                   peut exister pour lui, et agregerPeriode l'écarte. */
                var hors = !contratToucheLeMois(contrat, mm.annee, mm.mois);
                var compteurEntree = compteur;
                /* §17.3 — LES CONDITIONS DU MOIS, et plus seulement son
                   barème. Même règle de sélection qu'avant (le dernier avenant
                   dont la date d'effet précède ou égale le 1er du mois),
                   périmètre élargi aux onze réglages. */
                var conditions = Engine.conditionsApplicables(avenants, mm.annee, mm.mois);
                var salaire = conditions;
                var entree;

                if (recap && recap.statut === 'fige' && recap.donnees) {
                  /* Mois figé : instantané tel quel, aucun recalcul. Son
                     compteur d'entrée est celui du document lui-même. */
                  /* §17.6 — un instantané figé avant le lot 17 porte des
                     dixièmes de jour. Il n'est PAS réécrit : on en lit une
                     copie convertie, le temps de l'affichage et du chaînage. */
                  var d = instantaneEnMinutes(recap.donnees, conditions);
                  compteur = d.compteurSortie || compteur;
                  entree = {
                    annee: mm.annee, mois: mm.mois, cle: cle,
                    resultat: d, fige: true, recap: recap,
                    conditions: conditions,
                    salaire: salaire, salaireManquant: false,
                    avantInitialisation: avant,
                    horsContrat: hors,
                    /* Un mois figé n'est jamais recalculé : rien ne peut y
                       être écarté. La forme reste la même pour que les écrans
                       n'aient pas à distinguer. */
                    imputationsEcartees: [],
                    compteurEntree: compteurEntreeDe(d, compteurEntree),
                    compteurSortie: compteur
                  };
                } else if (!conditions) {
                  /* AUCUNE CONDITION APPLICABLE À CE MOIS. Depuis le lot 17,
                     chaque contrat a reçu à la reprise un avenant daté du 1er
                     du mois de sa `date_debut` (§17.2) : un mois sans
                     condition est donc nécessairement ANTÉRIEUR au contrat, et
                     il porte déjà `horsContrat`. Il n'y a rien à calculer, et
                     surtout rien à deviner — un mois calculé sur des réglages
                     supposés produirait un chiffre crédible et faux. Le
                     maillon existe quand même, pour ne pas rompre la
                     continuité des compteurs, et il DIT ce qui manque. */
                  entree = {
                    annee: mm.annee, mois: mm.mois, cle: cle,
                    resultat: null, fige: false, recap: recap || null,
                    conditions: null, salaire: null, salaireManquant: true,
                    conditionsManquantes: true,
                    avantInitialisation: avant, horsContrat: hors,
                    imputationsEcartees: [],
                    compteurEntree: compteurEntree, compteurSortie: compteur
                  };
                } else {
                  /* Correction B1 du lot 4, conservée : un mois sans barème
                     connu n'est PAS sauté — les heures sup, les congés et les
                     CP s'y accumulent quand même. On calcule avec un barème
                     nul (seule la retenue monétaire en dépend) et on signale
                     l'absence à l'écran. Depuis le lot 17, ce sont le BRUT et
                     le NET de l'avenant qui peuvent manquer (ils sont
                     nullables, §17.2 point 3), pas l'avenant lui-même. */
                  var conditionsCalcul = conditions;
                  if (conditions.brut_mensuel_centimes == null ||
                      conditions.net_mensuel_centimes == null) {
                    conditionsCalcul = {};
                    for (var kc in conditions) conditionsCalcul[kc] = conditions[kc];
                    conditionsCalcul.brut_mensuel_centimes = conditions.brut_mensuel_centimes || 0;
                    conditionsCalcul.net_mensuel_centimes = conditions.net_mensuel_centimes || 0;
                  }
                  var parJour = journeesParMois[cle] || {};
                  var journees = Object.keys(parJour).map(function (k) { return parJour[k]; });
                  /* LOT 16 §16.1 — le repli passe par ici, et par ici seul :
                     un mois dont la ventilation ne tient plus se calcule
                     quand même, sur l'ordre par défaut du contrat, et le
                     maillon porte ce qui a été écarté. Sans ça, la chaîne
                     entière rejette et tous les écrans tombent. */
                  var rep = calculerMoisAvecRepli({
                    contrat: contrat, conditions: conditionsCalcul, journees: journees,
                    compteurEntree: compteurEntree, annee: mm.annee, mois: mm.mois,
                    /* Correctif B1 : la ventilation choisie par Maria entre
                       ici, ou elle n'entre nulle part. */
                    imputations: imputationsDuMois(imputations, mm.annee, mm.mois)
                  });
                  var r = rep.resultat;
                  compteur = r.compteurSortie;
                  entree = {
                    annee: mm.annee, mois: mm.mois, cle: cle,
                    resultat: r, fige: false, recap: recap || null,
                    conditions: conditions,
                    salaire: salaire,
                    salaireManquant: conditions.brut_mensuel_centimes == null ||
                                     conditions.net_mensuel_centimes == null,
                    avantInitialisation: avant,
                    horsContrat: hors,
                    /* Vide dans l'immense majorité des cas. Non vide, c'est
                       l'encart du §16.1 et le blocage de la clôture. */
                    imputationsEcartees: rep.ecartees,
                    compteurEntree: compteurEntree, compteurSortie: compteur
                  };
                }

                entrees.push(entree);
                if (typeof opts.onProgress === 'function') opts.onProgress(rang + 1, total);
              });
            });
          })(cur, i);
          cur = moisSuivant(cur.annee, cur.mois);
        }

        return seq.then(function () {
          return {
            mois: entrees,
            depart: depart,
            debutChaine: debutChaine,
            tronquee: tronquee,
            avantInitialisation: avantDepart
          };
        });
      });
    });
  }

  /* Un seul mois : la chaîne complète, dont on ne garde que le dernier
     maillon. C'est ce que fait l'écran mensuel. */
  function mois1(contrat, annee, moisNum, opts) {
    return serie(contrat, { annee: annee, mois: moisNum }, opts).then(function (s) {
      var dernier = s.mois[s.mois.length - 1];
      if (!dernier || dernier.annee !== annee || dernier.mois !== moisNum) return null;
      return dernier;
    });
  }

  /* Extrait la fenêtre [debut..fin] d'une chaîne complète. */
  function fenetre(s, debut, fin) {
    return (s.mois || []).filter(function (e) {
      return cmpMois(e.annee, e.mois, debut.annee, debut.mois) >= 0 &&
             cmpMois(e.annee, e.mois, fin.annee, fin.mois) <= 0;
    });
  }

  /* ------------------------------------------------------------------ */
  /* Agrégation d'une période (lot 5 C6)                                 */
  /* ------------------------------------------------------------------ */

  /* Somme des GRANDEURS DE FLUX d'une liste de mois, et RIEN d'autre.

     Ce qui s'additionne : jours de présence, entretien, heures sup acquises,
     congés décomptés et leur répartition, retenues sans solde, salaires,
     total versé, congés payés acquis.

     Ce qui ne s'additionne JAMAIS : les COMPTEURS. Le solde d'heures sup et
     de congés payés à la fin de la période est celui du DERNIER mois, pas la
     somme des soldes mensuels — additionner douze soldes de fin de mois
     produirait un nombre dépourvu de sens, et crédible. On expose donc le
     compteur d'ENTRÉE du premier mois et le compteur de SORTIE du dernier.

     Fonction pure : aucun accès réseau, aucun DOM. Testable sous Node. */
  function agregerPeriode(entrees) {
    /* Un mois hors de la période d'activité du contrat n'est PAS un résultat
       mensuel : aucun récapitulatif n'existe pour lui. On l'écarte ici, à la
       source, pour qu'aucun écran ne puisse le faire entrer dans un total en
       oubliant de borner sa fenêtre. */
    var toutes = (entrees || []).filter(function (e) { return e && e.resultat; });
    var liste = toutes.filter(function (e) { return !e.horsContrat; });
    var somme = {
      nbMois: liste.length,
      joursPresence: 0,
      entretienCentimes: 0,
      minutesSupAcquises: 0,
      joursCongesDecomptes: 0,
      imputation: {
        joursSurCp: 0, joursSurSup: 0, joursSansSolde: 0,
        minutesSupConsommees: 0, minutesCpConsommees: 0
      },
      retenueSansSoldeCentimes: 0,
      minutesCpAcquis: 0,
      salaireBrutCentimes: 0,
      salaireNetCentimes: 0,
      /* §17.8 — le total des bruts RÉELLEMENT dus, assiette du 1/80ᵉ de
         l'indemnité de rupture. Ce n'est pas la somme des bruts contractuels :
         le sans solde et le prorata en sont déjà déduits, mois par mois. */
      brutDuCentimes: 0,
      totalAVerserCentimes: 0,
      compteurEntree: null,
      compteurSortie: null,
      moisProvisoires: [],
      moisFiges: [],
      moisAvantInitialisation: [],
      moisHorsContrat: toutes.filter(function (e) { return e.horsContrat; })
        .map(function (e) { return { annee: e.annee, mois: e.mois }; }),
      /* Cas rare mais lourd de conséquence : un mois FIGÉ — donc déjà envoyé
         aux parents — qui tombe hors des bornes du contrat parce que la date
         de fin a été saisie après coup. Il est écarté des totaux (le contrat
         n'existait plus), mais le taire ferait disparaître du document de
         période un mois que les parents ont bel et bien reçu. */
      moisHorsContratFiges: toutes.filter(function (e) { return e.horsContrat && e.fige; })
        .map(function (e) { return { annee: e.annee, mois: e.mois }; }),
      /* Noms tels qu'ils étaient au figement, dans l'ordre des mois. Le
         document de période peut ainsi porter le nom des récapitulatifs
         qu'il agrège, et non un renommage postérieur. */
      nomsFiges: [],
      baremes: [],
      /* LOT 17 §17.6 — LE FACTEUR D'AFFICHAGE DES CONGÉS PAYÉS.

         Les compteurs sont en minutes et s'affichent en jours. Sur une période
         qui traverse un avenant, `minutes_par_jour_conge` a pu changer : le
         solde affiché est celui de la FIN de la période, on l'exprime donc
         avec le facteur de la fin. C'est le seul choix qui dise la vérité sur
         ce que Maria peut poser demain — un solde de fin converti au facteur
         d'il y a deux ans annoncerait un nombre de jours qu'elle n'a pas.

         Il est calculé ICI, une fois, plutôt que dans chacun des quatre écrans
         qui affichent un solde : c'est exactement le genre de conversion qui
         se met à diverger d'un écran à l'autre. */
      minutesParJourConge: null
    };
    if (!liste.length) return somme;

    for (var d = liste.length - 1; d >= 0; d--) {
      var cd = liste[d].conditions;
      if (cd && cd.minutes_par_jour_conge) {
        somme.minutesParJourConge = cd.minutes_par_jour_conge;
        break;
      }
    }

    var baremesParCle = {};

    liste.forEach(function (e) {
      var r = e.resultat;
      var imp = r.imputation || {};
      somme.joursPresence += r.joursPresence || 0;
      somme.entretienCentimes += r.entretienCentimes || 0;
      somme.minutesSupAcquises += r.minutesSupAcquises || 0;
      somme.joursCongesDecomptes += r.joursCongesDecomptes || 0;
      somme.imputation.joursSurCp += imp.joursSurCp || 0;
      somme.imputation.joursSurSup += imp.joursSurSup || 0;
      somme.imputation.joursSansSolde += imp.joursSansSolde || 0;
      somme.imputation.minutesSupConsommees += imp.minutesSupConsommees || 0;
      somme.imputation.minutesCpConsommees += imp.minutesCpConsommees || 0;
      somme.retenueSansSoldeCentimes += r.retenueSansSoldeCentimes || 0;
      somme.minutesCpAcquis += r.minutesCpAcquis || 0;
      /* CORRECTION B4 — LES SALAIRES AGRÉGÉS SONT CEUX QUI SONT DUS.
         `agregerPeriode` totalisait les nets CONTRACTUELS. Sur une période
         contenant un premier ou un dernier mois de contrat, la ligne
         « Salaires nets » pouvait dépasser le « Total versé », lequel inclut
         pourtant l'indemnité d'entretien. Le récapitulatif de période se
         contredisait tout seul — et c'est la pièce que Maria sortira si un
         désaccord remonte à plusieurs années.
         `instantaneEnMinutes` garantit ces deux champs sur tous les
         instantanés ; le repli reste, pour qu'un chemin oublié ne totalise
         jamais zéro en silence. */
      somme.salaireBrutCentimes += (r.salaireBrutProrataCentimes == null)
        ? (r.salaireBrutCentimes || 0)
        : r.salaireBrutProrataCentimes;
      /* Repli pour les instantanés d'avant le lot 17, que
         `instantaneEnMinutes` a déjà complétés — la double garde ne coûte
         rien et évite qu'un chemin oublié fasse silencieusement compter zéro
         dans l'assiette de l'indemnité. */
      somme.brutDuCentimes += brutDuCentimes(r);
      somme.salaireNetCentimes += (r.salaireNetProrataCentimes == null)
        ? (r.salaireNetCentimes || 0)
        : r.salaireNetProrataCentimes;
      somme.totalAVerserCentimes += r.totalAVerserCentimes || 0;

      if (e.fige && r.prenomEnfant) {
        somme.nomsFiges.push({
          annee: e.annee, mois: e.mois,
          prenom: r.prenomEnfant, famille: r.nomFamille || null
        });
      }
      if (e.fige) somme.moisFiges.push({ annee: e.annee, mois: e.mois });
      else somme.moisProvisoires.push({ annee: e.annee, mois: e.mois });
      if (e.avantInitialisation) somme.moisAvantInitialisation.push({ annee: e.annee, mois: e.mois });

      /* Barèmes appliqués sur la période. Pour un mois figé, on lit d'abord la
         date d'effet inscrite dans l'instantané (ajoutée au lot 5) ; à défaut
         — instantanés d'avant le lot 5 — on retombe sur le barème applicable
         calculé par le moteur. */
      var dateEffet = (r.salaireDateEffet != null)
        ? r.salaireDateEffet
        : (e.salaire ? e.salaire.date_effet : null);
      /* Le regroupement des barèmes lit les montants CONTRACTUELS, et c'est
         voulu : un barème n'est pas proratisé, c'est le mois qui l'est. Deux
         mois du même barème, dont l'un partiel, doivent rester regroupés. */
      var cle = dateEffet + '|' + (r.salaireBrutCentimes || 0) + '|' + (r.salaireNetCentimes || 0);
      if (!baremesParCle[cle]) {
        baremesParCle[cle] = {
          dateEffet: dateEffet,
          brutMensuelCentimes: r.salaireBrutCentimes || 0,
          netMensuelCentimes: r.salaireNetCentimes || 0,
          mois: []
        };
        somme.baremes.push(baremesParCle[cle]);
      }
      baremesParCle[cle].mois.push({ annee: e.annee, mois: e.mois });
    });

    somme.compteurEntree = liste[0].compteurEntree || null;
    somme.compteurSortie = liste[liste.length - 1].compteurSortie || null;
    return somme;
  }

  /* Total de plusieurs agrégats (vue d'ensemble tous contrats confondus).
     Mêmes grandeurs que agregerPeriode, même règle : seuls les FLUX
     s'additionnent. Aucun compteur n'est totalisé entre contrats — un solde
     d'heures supplémentaires global n'a aucun sens. La règle vit ici, à un
     seul endroit, et elle est testée. */
  function totaliserAgregats(agregats) {
    var t = {
      nbContrats: 0, nbMois: 0,
      joursPresence: 0, entretienCentimes: 0, minutesSupAcquises: 0,
      joursCongesDecomptes: 0, retenueSansSoldeCentimes: 0,
      salaireBrutCentimes: 0, salaireNetCentimes: 0, totalAVerserCentimes: 0,
      nbMoisProvisoires: 0
    };
    (agregats || []).forEach(function (a) {
      if (!a) return;
      t.nbContrats++;
      t.nbMois += a.nbMois;
      t.joursPresence += a.joursPresence;
      t.entretienCentimes += a.entretienCentimes;
      t.minutesSupAcquises += a.minutesSupAcquises;
      t.joursCongesDecomptes += a.joursCongesDecomptes;
      t.retenueSansSoldeCentimes += a.retenueSansSoldeCentimes;
      t.salaireBrutCentimes += a.salaireBrutCentimes;
      t.salaireNetCentimes += a.salaireNetCentimes;
      t.totalAVerserCentimes += a.totalAVerserCentimes;
      t.nbMoisProvisoires += a.moisProvisoires.length;
    });
    return t;
  }

  /* ------------------------------------------------------------------ */
  /* Écarts entre deux instantanés d'un même mois (lot 13)               */
  /* ------------------------------------------------------------------ */

  /* Postes comparés à la reclôture d'un mois rouvert. L'ordre est celui de
     lecture du document, pas celui du calcul. `format` dit à l'écran comment
     présenter la valeur ; ce module ne produit jamais de texte affichable. */
  var POSTES_COMPARES = [
    { cle: 'joursPresence',        libelle: 'Jours de présence',              format: 'jours' },
    { cle: 'entretienCentimes',    libelle: 'Indemnité d’entretien',          format: 'euros' },
    /* CORRECTION B4 — le poste comparé à la reclôture est le net RÉELLEMENT
       DÛ. Comparer les nets contractuels tairait précisément l'écart qu'une
       réouverture pour cause de prorata (§17.7) est censée faire apparaître.
       `repli` couvre les instantanés d'avant le lot 17, qui n'ont jamais connu
       le prorata : leur net contractuel EST leur net dû. Sans ce repli, la
       première comparaison d'un vieux mois annoncerait « 0 € → 1 072 € ». */
    { cle: 'salaireNetProrataCentimes', repli: 'salaireNetCentimes',
      libelle: 'Salaire net',                                                 format: 'euros' },
    { cle: 'totalAVerserCentimes', libelle: 'Total à verser',                 format: 'euros' },
    { cle: 'minutesSupAcquises',   libelle: 'Heures supplémentaires du mois', format: 'minutes' },
    { cle: 'joursCongesDecomptes', libelle: 'Congés décomptés',               format: 'jours' },

    /* CORRECTION RELECTURE LOT 13 (C2). Les six postes ci-dessus sont ceux du
       document : ils ne disent QUE des montants. Or une reclôture peut ne
       changer aucun montant et déplacer durablement des compteurs — quatre
       jours pris sur les congés payés au lieu de la récupération, par exemple.
       Le mois se lit pareil, et deux compteurs qui ne se remettent jamais à
       zéro (RG-12) ont changé de poche en silence. C'est exactement la matière
       du litige que cette application existe pour éteindre.
       Les quatre postes suivants sortent de la liste du §5.4 de la
       spécification : ajout délibéré, signalé dans la restitution. */
    { cle: 'imputation.minutesCpConsommees', libelle: 'Congés payés décomptés ce mois', format: 'cp' },
    { cle: 'imputation.minutesSupConsommees', libelle: 'Récupération utilisée ce mois', format: 'minutes' },
    { cle: 'compteurSortie.minutesCpPris',   libelle: 'Congés payés pris, en tout',     format: 'cp' },
    { cle: 'compteurSortie.minutesSup',      libelle: 'Récupération restante',          format: 'minutes' }
  ];

  /* CORRECTION B4 — LE NET ET LE BRUT DU MOIS, EN UN SEUL ENDROIT.

     Le §17.7 fait du montant proratisé LE montant du mois. Ces deux lectures
     ne calculent rien : elles choisissent le bon champ du résultat, et
     replient sur le net contractuel pour les instantanés d'avant le lot 17,
     qui n'ont jamais connu le prorata et dont le contractuel EST le dû.

     Elles vivent ici et non dans les écrans parce que le repli répété six fois
     est le repli qu'on oublie cinq fois — c'est exactement ce qui s'est passé :
     un seul écran sur six l'appliquait. */
  function netDuMois(resultat) {
    var r = resultat || {};
    return (r.salaireNetProrataCentimes == null)
      ? (r.salaireNetCentimes || 0)
      : r.salaireNetProrataCentimes;
  }

  /* Le brut RÉELLEMENT dû du mois : l'assiette du 1/80ᵉ (§17.8). Le repli
     couvre les instantanés d'avant le lot 17, qui n'ont jamais connu le
     prorata : brut contractuel moins la retenue de sans solde, déjà exprimée
     en brut (RG-08).

     CORRECTION C1 — cette formule existait en TROIS exemplaires : ici, dans
     `agregerPeriode`, et dans l'export CSV. Trois copies d'une règle qui
     décide d'une indemnité de rupture. */
  function brutDuCentimes(resultat) {
    var r = resultat || {};
    if (r.brutDuCentimes != null) return r.brutDuCentimes;
    return Math.max(0, (r.salaireBrutCentimes || 0) - (r.retenueSansSoldeCentimes || 0));
  }

  function brutDuMois(resultat) {
    var r = resultat || {};
    return (r.salaireBrutProrataCentimes == null)
      ? (r.salaireBrutCentimes || 0)
      : r.salaireBrutProrataCentimes;
  }

  /* Le mois est-il partiel, et dans quelle proportion ? Rend `null` quand le
     contrat couvre le mois entier — l'écran n'a alors rien à dire. */
  function proratOuNull(resultat) {
    var p = resultat && resultat.prorata;
    return (p && p.applique) ? p : null;
  }

  /* Compare l'instantané déjà établi et celui qu'on s'apprête à écrire.
     Retourne UNIQUEMENT les postes qui diffèrent :
     [{ cle, libelle, format, ancien, nouveau }], dans l'ordre du document.

     Fonction PURE, et ici plutôt que dans un écran : « aucun calcul métier
     dans l'interface » (B.0-5). C'est elle qui empêche qu'une reclôture après
     une revalorisation de salaire modifie en silence un montant déjà parti
     chez un parent — le défaut le plus coûteux que la réouverture puisse
     introduire.

     Un instantané absent (mois jamais clôturé) donne [] : il n'y a pas de
     document antérieur, donc rien à comparer. */
  function ecartsInstantanes(ancien, nouveau) {
    if (!ancien || !nouveau) return [];
    var ecarts = [];
    for (var i = 0; i < POSTES_COMPARES.length; i++) {
      var p = POSTES_COMPARES[i];
      var a = valeurComparee(lireAvecRepli(ancien, p));
      var n = valeurComparee(lireAvecRepli(nouveau, p));
      if (a !== n) {
        ecarts.push({ cle: p.cle, libelle: p.libelle, format: p.format, ancien: a, nouveau: n });
      }
    }
    return ecarts;
  }

  /* Lecture d'un poste, avec son repli éventuel : un instantané produit par
     une version antérieure de l'application n'a pas les mêmes champs, et un
     champ absent doit être lu comme son équivalent d'alors, pas comme zéro. */
  function lireAvecRepli(instantane, poste) {
    var v = lire(instantane, poste.cle);
    if (v == null && poste.repli) v = lire(instantane, poste.repli);
    return v;
  }

  /* Lecture d'un poste, y compris imbriqué : 'compteurSortie.minutesSup'. */
  function lire(instantane, chemin) {
    var parties = chemin.split('.');
    var v = instantane;
    for (var i = 0; i < parties.length; i++) {
      if (v == null) return undefined;
      v = v[parties[i]];
    }
    return v;
  }

  /* Un poste absent d'un instantané — produit par une version antérieure de
     l'application — est lu comme 0.

     CORRECTION RELECTURE LOT 13 (remarque 1) : le commentaire d'origine
     prétendait qu'on « ne signale pas un écart qui n'en est pas un ». C'était
     faux, et dans le bon sens : un instantané ancien dépourvu de
     `salaireNetCentimes` produira un écart « 0 € → 1 072 € » au premier écran
     de comparaison. Montrer plutôt que taire est le bon arbitrage — mais il
     faut le dire, pas prétendre l'inverse. */
  function valeurComparee(v) {
    return (typeof v === 'number' && isFinite(v)) ? v : 0;
  }

  /* ------------------------------------------------------------------ */

  var api = {
    serie: serie,
    mois1: mois1,
    /* LOT 16 §16.1 — le même repli pour tous ceux qui rejouent un mois hors
       de la chaîne (l'aperçu « voilà ce que ce geste change » de l'espace
       enfant). Une seule règle de repli, un seul endroit. */
    calculerMoisAvecRepli: calculerMoisAvecRepli,
    CODES_IMPUTATION: CODES_IMPUTATION,
    /* CORRECTION RELECTURE LOT 16 (C3) — ce que les réserves couvrent, EN
       JOURS, demandé au moteur. Les écrans convertissaient eux-mêmes
       (`Math.floor(cp / 10)`), c'est-à-dire RG-05 réécrite dans l'interface —
       et le lot 17, qui fait passer les congés payés en minutes, l'aurait
       rendue fausse sans lever la moindre erreur. */
    reservesEnJours: function (conditions, compteurEntree) {
      return reservesEnJours(resoudreEngine(), conditions, compteurEntree);
    },
    /* LOT 16 §16.8 — la part d'un mois dans une période à cheval. Depuis le
       lot 17 ce n'est plus qu'une LECTURE de `Engine.joursOuvrablesParMois` ;
       `feriesDecomptes` a disparu au profit de `Engine.feriesDeLaPeriode`. */
    partDuMois: partDuMois,
    /* §17.6 — conversion à la lecture d'un instantané figé avant le lot 17.
       Exposée pour que les écrans qui relisent un instantané hors chaîne
       (aperçu de document, comparaison avant clôture) n'aient pas à
       reconnaître l'unité eux-mêmes. */
    instantaneEnMinutes: instantaneEnMinutes,
    ecartsInstantanes: ecartsInstantanes,
    POSTES_COMPARES: POSTES_COMPARES,
    /* §17.7 / correction B4 — le montant du mois, lu au bon endroit. */
    netDuMois: netDuMois, brutDuMois: brutDuMois, proratOuNull: proratOuNull,
    brutDuCentimes: brutDuCentimes,
    /* Exportée pour être testable : c'est l'inverse littéral du chaînage, et
       la correction C6 y ajoute un terme qu'aucun test ne pouvait voir. */
    compteurEntreeDe: compteurEntreeDe,
    fenetre: fenetre,
    fenetreContrat: fenetreContrat,
    contratToucheLeMois: contratToucheLeMois,
    agregerPeriode: agregerPeriode,
    totaliserAgregats: totaliserAgregats,
    /* calendrier, partagé par les écrans */
    nbJoursDansMois: nbJoursDansMois,
    premierJour: premierJour,
    dernierJour: dernierJour,
    moisSuivant: moisSuivant,
    moisPrecedent: moisPrecedent,
    cmpMois: cmpMois,
    moisDeDate: moisDeDate,
    cleMois: cleMois,
    nbMoisEntre: nbMoisEntre,
    libelleMois: libelleMois,
    libelleMoisAnnee: libelleMoisAnnee,
    MAX_MOIS: MAX_MOIS
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.ChaineMois = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
