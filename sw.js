/* ============================================================================
   sw.js — Service worker minimal (§3 des specs).

   Un seul objectif : que l'application S'OUVRE même sans réseau. Les DONNÉES,
   elles, restent en ligne — il n'y a PAS de synchronisation hors ligne dans ce
   lot, et c'est volontaire : une saisie mise en file d'attente puis rejouée
   plus tard sur un mois entre-temps clôturé produirait exactement le genre
   d'incohérence que cette application existe pour éviter.

   Conséquence assumée et visible à l'écran : hors ligne, l'application
   s'ouvre, mais toute lecture ou écriture échoue avec un message français
   explicite (js/messages.js) et la saisie en cours reste affichée.

   Règles de cache, volontairement simples :
   - LA PAGE elle-même (une navigation) : demandée au RÉSEAU à chaque
     ouverture, le cache ne servant que de secours hors ligne. C'est elle qui
     désigne tous les autres fichiers : une copie périmée fait perdre la
     livraison entière ;
   - les fichiers de l'application (même origine) : servis depuis le cache,
     rafraîchis en arrière-plan — sans risque, puisqu'ils portent désormais
     leur version dans leur URL (`?v=`) ;
   - le client Supabase du CDN : même traitement, sinon l'application ne
     démarre pas hors ligne ;
   - TOUT LE RESTE (appels à l'API Supabase, authentification) : jamais
     intercepté, jamais mis en cache. Servir un récapitulatif périmé depuis un
     cache serait pire que ne rien afficher.

   Écrit à la main, sans étape de build : le fichier livré est le fichier lu.
   ========================================================================= */
'use strict';

/* À incrémenter à chaque livraison : c'est ce qui déclenche le remplacement
   des fichiers en cache sur le téléphone de Maria. */
/* Correctifs de la relecture PR9 : tous les modules d'écran changent, plus le
   moteur de chaîne. Sans incrément, l'ancien service worker continuerait à
   servir la version d'avant — et les correctifs n'atteindraient Maria qu'à la
   deuxième ouverture, ou jamais. */
/* LOT 17 — NOM DE CACHE CHANGÉ. Aucun fichier n'est ajouté par ce lot, mais
   TREIZE fichiers changent de contenu — `js/engine.js` compris, qui est le
   plus lourd de conséquences : il change d'UNITÉ pour les congés payés et de
   SOURCE pour les conditions.

   Sans incrément, le téléphone de Maria garderait les anciens fichiers du
   pré-cache et ferait tourner un mélange des deux versions : un moteur qui
   lit des minutes contre une chaîne qui lui envoie des dixièmes. Les chiffres
   seraient faux d'un facteur 54, et crédibles.

   Rappel de la règle, à ne jamais desserrer : tout fichier `js/` ou `css/`
   ajouté doit entrer dans `index.html` ET dans cette liste, et `CACHE` doit
   changer de nom. Un fichier absent de la liste n'est rafraîchi qu'au hasard
   des requêtes. */
/* LOT 18 — NOM DE CACHE CHANGÉ. Aucun fichier n'est ajouté par ce lot non
   plus, mais sept fichiers changent de contenu, dont `js/ui-kit.js` et
   `js/db.js` — dont tous les écrans dépendent.

   Le cas à éviter est concret : `js/ui-enfant.js` rafraîchi et `js/db.js`
   resté à la version d'avant. L'écran proposerait « Marquer plusieurs jours
   d'un coup », Maria en choisirait cinq, et l'appui sur « Valider »
   appellerait une fonction qui n'existe pas dans le fichier servi. Le geste
   échouerait sans que rien n'explique pourquoi. */
/* CORRECTIONS DES RELECTURES DES LOTS 17 ET 18 — NOM DE CACHE CHANGÉ.

   Onze fichiers changent, dont `js/engine.js`, `js/chaine-mois.js` et
   `js/app.js`. Le cas à éviter est précis : `js/db.js` rafraîchi — qui ne
   renumérote plus les avenants, parce que la base s'en charge — et
   `js/app.js` resté en arrière, avec son cache de chaîne sans la date de fin.
   Le téléphone de Maria ferait tourner un mélange dont chaque moitié est
   correcte et dont l'ensemble ne l'est pas. */
/* CORRECTIF DE L'ÉCRAN « MES CONGÉS » — NOM DE CACHE CHANGÉ.

   Trois fichiers changent : `css/style.css`, `js/ui-kit.js`, `js/ui-conges.js`.
   Le cas à éviter est direct : la feuille de style rafraîchie et `js/ui-kit.js`
   resté en arrière. La règle `.phr` existerait, mais aucune ligne ne porterait
   la classe — et l'écran continuerait de glisser exactement comme avant, en
   donnant l'impression que le correctif ne marche pas. */
/* LOT 20 — NOM DE CACHE CHANGÉ, ET UN FICHIER AJOUTÉ.

   `js/ui-familiarisation.js` entre dans `index.html` ET dans la liste
   ci-dessous. Un fichier absent de la liste n'est rafraîchi qu'au hasard des
   requêtes : l'application servirait un `app.js` qui route vers un écran que
   le cache ne connaît pas — un mélange de deux versions, et l'écran de la
   période introuvable une fois sur deux. */
/* LOT 22 — NOM DE CACHE CHANGÉ. Aucun fichier n'est ajouté par ce lot (la
   page « Mes enfants » vit dans `js/ui-menu.js`, déjà pré-caché), mais
   `index.html`, `css/style.css`, `js/app.js`, `js/ui-menu.js` et
   `js/ui-contrat.js` changent tous : les icônes SVG de la barre d'onglets sont
   dans la page elle-même. Sans incrément, le service worker servirait
   l'ancienne page avec le nouveau CSS — une barre stylée pour des SVG, avec
   des caractères Unicode dedans. */
/* CORRECTIONS DE LA RELECTURE DES LOTS 20 À 22 — NOM DE CACHE CHANGÉ.

   Aucun fichier ajouté, mais cinq fichiers servis changent : `js/app.js`,
   `js/ui-conges.js`, `js/ui-contrat.js`, `js/ui-enfant.js`, `js/ui-menu.js`,
   et `css/style.css`. Deux d'entre eux se répondent — la correction B2 fait
   dire la MÊME chose à l'espace enfant et à « Mes congés » — et servir l'un
   sans l'autre rendrait exactement le défaut corrigé : un congé posé visible
   d'un côté, écrasable de l'autre. */
/* FEUILLE DU JOUR REFAITE COMME LA MAQUETTE — NOM DE CACHE CHANGÉ.

   Aucun fichier ajouté, deux fichiers servis changent : `js/ui-enfant.js` et
   `css/style.css`. Ils se répondent — la liste de choix est écrite dans l'un
   et habillée par l'autre — et servir le script neuf avec l'ancienne feuille
   de style donnerait une liste sans son espacement ni sa pastille. */
/* LA LISTE DE CHOIX AUX MESURES DE LA MAQUETTE — NOM DE CACHE CHANGÉ.

   Premier rendu côte à côte : « ça ne ressemble toujours pas à la maquette ».
   La pastille radio et la ligne de choix changent dans `css/style.css`, et
   `js/ui-enfant.js` pose une classe de plus. Les deux se répondent : servir
   l'un sans l'autre donnerait un chevron sans son style. */
/* LA RÈGLE DES CINQ SAMEDIS — NOM DE CACHE CHANGÉ.

   Six fichiers servis changent : `js/engine.js`, `js/chaine-mois.js`,
   `js/db.js`, `js/ui-kit.js`, `js/ui-conges.js`, `js/ui-document.js`,
   `js/ui-menu.js` et `js/ui-enfant.js`. Ils se répondent tous : un moteur neuf
   servi avec un écran ancien produirait des décomptes incohérents ET
   CRÉDIBLES — le pire résultat possible sur le chiffre que les familles
   contestent. */
/* LOT 24 (REDESIGN, LE SOCLE) — NOM DE CACHE CHANGÉ.

   Quatre fichiers servis changent : `css/style.css` (réécrite en entier —
   jetons, composants, deux rayons, quatre tailles), `js/ui-kit.js` (les
   composants du socle et l'espace fine des milliers), `js/ui-menu.js` et
   `js/ui-contrat.js` (le code mort du §17.9 est retiré). Le cas à éviter
   est immédiat : la feuille de style neuve servie avec l'ancien
   `js/ui-kit.js` — des classes stylées que personne ne pose, et des
   montants dont le séparateur change d'un écran à l'autre. */
/* LOT 25 (L'ACCUEIL ET L'ESPACE ENFANT) — NOM DE CACHE CHANGÉ.

   Deux fichiers servis changent : `js/ui-accueil.js` (deux blocs, une carte
   par geste) et `js/ui-enfant.js` (encart unique et sa file, synthèse
   chiffrée, replis, barre fixe, ⋯ de multi-sélection). Ils se RÉPONDENT :
   la carte « heures à déclarer » de l'Accueil appelle
   `UiEnfant.declarerFamiliarisation`, exportée par le second. Servir
   l'accueil neuf avec l'ancien espace enfant ferait échouer le geste le plus
   fréquent de la période d'adaptation, sans un mot pour l'expliquer. */
/* LOT 26 (POSER UN CONGÉ EN UN ÉCRAN) — NOM DE CACHE CHANGÉ.

   Trois fichiers servis changent : `js/ui-conges.js` (huit écrans deviennent
   un), `js/ui-kit.js` (`champDate` gagne `poser`, dont l'écran de pose a
   besoin pour que le « Au » suive le « Du ») et `css/style.css` (le décompte
   vert pâle et le « reste à répartir » sont retirés). Ils se RÉPONDENT : le
   nouvel écran de pose appelle `champDate().poser()`. Servi avec l'ancien
   `js/ui-kit.js`, le choix des dates lèverait au premier changement de
   date — c'est-à-dire au premier geste. */
/* LOT 27 (LE MENU, LA FICHE, LES RÈGLES) — NOM DE CACHE CHANGÉ.

   Cinq fichiers servis changent : `js/ui-menu.js` (le Menu en cartes, « Comment
   l'application compte », « Ajouter un enfant » en trois étapes),
   `js/ui-contrat.js` (la fiche en trois blocs, l'avenant en tête),
   `js/ui-kit.js` (`champsConditions` rend ses deux paquets de champs),
   `js/app.js` (la route de l'écran des règles) et `css/style.css`.
   Ils se RÉPONDENT : le Menu route vers `regles`, qui n'existe que si
   `js/app.js` la connaît ; et « Ajouter un enfant » répartit les onze
   conditions entre ses étapes 2 et 3 en lisant `conditions.temps` et
   `conditions.argent`, que seul le socle neuf expose. Servir l'un avec
   l'ancien de l'autre, c'est une entrée de Menu qui ne mène nulle part, ou
   deux étapes vides. Aucun fichier ajouté. */
/* LOT 28 (« JOURNÉES À PART ») — NOM DE CACHE CHANGÉ.

   Trois fichiers servis changent : `js/ui-kit.js` (les deux tables de
   libellés d'un écart d'horaire, et `quantieme` exposé), `js/ui-enfant.js`
   (le repli « Journées à part ») et `js/ui-document.js` (il lit désormais ces
   libellés dans `js/ui-kit.js` au lieu de les redéfinir).

   Ils se RÉPONDENT, et c'est le lot où l'ordre de service compte le plus :
   `js/ui-document.js` lit `Kit.LIBELLE_EVENEMENT_ECART` À SON CHARGEMENT.
   Servi avec un `js/ui-kit.js` d'avant ce lot, il obtiendrait `undefined` —
   et le document remis à la famille perdrait la moitié de la phrase qui
   explique une déduction sur une pièce opposable. C'est exactement le cas
   que le changement de nom de cache empêche. Aucun fichier ajouté. */
/* CORRECTIFS DE CALCUL, LOT 28 (« LES CALCULS ») — NOM DE CACHE CHANGÉ.

   Onze fichiers servis changent : `js/engine.js` (acquisition des congés
   payés, absence de l'enfant sans minute, congés payés jamais négatifs,
   renoncement borné, congé horaire en période, planning vide refusé),
   `js/chaine-mois.js` (cumul d'exercice, fenêtre des samedis, troncature,
   part de familiarisation agrégée), `js/messages.js`, `js/ui-kit.js`,
   `js/ui-enfant.js`, `js/ui-conges.js`, `js/ui-accueil.js`, `js/ui-periode.js`,
   `js/ui-historique.js`, `js/ui-document.js`, `js/ui-contrat.js` et
   `js/ui-menu.js`.

   Ils se RÉPONDENT : un moteur neuf servi avec un écran ancien annoncerait un
   disponible de congés payés que le moteur ne servira pas, et un écran neuf
   avec le moteur ancien lirait `acquisitionCp` ou
   `minutesCpRestantesApresConsommation` à `undefined`. Sur les chiffres que
   ce lot existe pour rendre justes, une incohérence crédible est le pire
   résultat possible. Aucun fichier ajouté. */
/* CORRECTIFS DE CALCUL, LOT 29 (« LA JOURNÉE QUI SE CORRIGE VRAIMENT ») — NOM
   DE CACHE CHANGÉ.

   Deux fichiers servis changent : `js/ui-enfant.js` (déclarer un écart sur
   une absence remet la journée en présence ; marquer une absence efface
   l'écart et rend l'indemnité ; l'écran l'annonce avant ; « Annuler » rend
   l'indemnité aussi) et `js/ui-conges.js` (aucun congé à l'heure sur une
   absence de l'enfant). Ils se répondent avec le moteur du lot 28, qui
   ignore déjà tout écart porté par une absence : un écran ancien laisserait
   encore écrire des journées que le moteur n'entend plus. */
/* CORRECTIFS DE CALCUL, LOT 30 (« LA SOUPLESSE DE LA SAISIE ») — NOM DE
   CACHE CHANGÉ.

   Huit fichiers servis changent : `js/ui-reouverture.js` (la feuille « rouvrir
   et continuer », le bandeau du mois rouvert, le motif après coup),
   `js/ui-kit.js` (`moisRouvert`, un mois rouvert est « à clôturer »,
   `signales` du sélecteur de mois), `js/db.js` (`audit_note` lu, le motif
   écrit), `js/ui-enfant.js`, `js/ui-document.js`, `js/ui-accueil.js`,
   `js/ui-contrat.js` et `js/ui-familiarisation.js`.
   Ils se RÉPONDENT : cinq écrans appellent
   `UiReouverture.feuilleRouvrirEtContinuer`, qui n'existe que dans le
   nouveau `js/ui-reouverture.js` ; servi avec l'ancien, toucher un jour d'un
   mois clôturé lèverait — au lieu de proposer la réouverture qui est tout
   l'objet du lot. Aucun fichier ajouté. */
/* LA FAMILIARISATION EN ARRIVÉE PUIS DÉPART — NOM DE CACHE CHANGÉ.

   Deux fichiers servis changent : `js/db.js` (deux colonnes de plus lues et
   écrites sur `journee` — `fam_heure_arrivee`, `fam_heure_depart`, migration
   019) et `js/ui-enfant.js` (la feuille du jour de familiarisation sans
   raccourcis, l'enregistrement en deux temps, la case « en cours »). Ils se
   RÉPONDENT : l'écran lit sur la ligne une arrivée que seul le nouveau
   `js/db.js` demande. Servi avec l'ancien, l'arrivée enregistrée le matin ne
   reviendrait jamais le soir — exactement le défaut que ce changement
   corrige. Aucun fichier ajouté. */
/* LES IMPUTATIONS ORPHELINES — NOM DE CACHE CHANGÉ.

   Quatre fichiers servis changent : `js/engine.js` (le moteur NOMME
   l'imputation qui ne recouvre aucune période), `js/chaine-mois.js` (le
   maillon du mois la transporte et lui rattache son identifiant),
   `js/ui-document.js` (l'encart du récapitulatif, le verrou de clôture et le
   bouton « Retirer cette période ») et `js/ui-accueil.js` (l'entrée
   d'« Aujourd'hui » et le verrou du parcours guidé). Ils se RÉPONDENT :
   les écrans lisent `imputationsOrphelines`, que seuls le moteur et la
   chaîne neufs produisent. Servis avec un moteur ancien, l'encart ne
   s'afficherait JAMAIS — c'est-à-dire que le silence que ce lot supprime
   reviendrait intact, et que la clôture resterait ouverte sur une décision
   perdue. Aucun fichier ajouté. */
/* LA RÉCUPÉRATION SE GAGNE JOUR APRÈS JOUR — NOM DE CACHE CHANGÉ.

   Cinq fichiers servis changent : `js/engine.js` (la réserve de récupération
   s'évalue à la DATE de chaque période, plus au 1er du mois ; deux relevés de
   plus dans le résultat), `js/chaine-mois.js` (elle passe `aujourdhui` au
   moteur, transporte le nouveau code de refus et lit le disponible à la date),
   `js/app.js` (l'horloge, qui n'est ni au moteur ni à la chaîne, part d'ici),
   `js/ui-conges.js` (le plafond du stepper et la phrase « dont N gagnés depuis
   le 1er ») et `js/messages.js` (« ces heures ne sont pas encore acquises »).
   `js/ui-enfant.js` change aussi, pour que le rejeu voie ce que voit la chaîne.

   Ils se RÉPONDENT, et dans les deux sens : un écran neuf servi avec un moteur
   ancien lirait `Engine.recuperationALaDate` à `undefined` et annoncerait un
   plafond du 1er — le défaut que ce lot corrige, revenu intact ; un moteur
   neuf servi avec une chaîne ancienne ne recevrait jamais `aujourdhui` et
   refuserait encore le 28 mai ce que le mois a financé. Aucun fichier
   ajouté. */
/* LA RÉCUPÉRATION PEUT PASSER EN NÉGATIF — NOM DE CACHE CHANGÉ.

   Six fichiers servis changent : `js/engine.js` (la récupération ne se refuse
   plus, le solde descend sous zéro et le moteur le NOMME), `js/chaine-mois.js`
   (un code de refus retiré de la liste du repli), `js/messages.js` (le refus
   ne parle plus que des congés payés), `js/ui-conges.js` (le stepper
   déplafonné, l'avertissement « votre récupération passera à − X », le solde
   signé dans « Vos réserves »), `js/ui-enfant.js` (l'encart des répartitions
   écartées) et `js/ui-document.js` (le solde négatif dit en toutes lettres
   sur le récapitulatif).

   Ils se RÉPONDENT, et le mélange serait pire que d'habitude : un écran neuf
   servi avec l'ancien moteur laisserait Maria pousser le stepper au-delà de sa
   réserve, puis l'écriture ferait tomber le mois entier sur
   `IMPUTATION_DEPASSE_RESERVES` — un geste offert et refusé une seconde plus
   tard. Un moteur neuf servi avec l'ancien écran, à l'inverse, garderait le
   mur là où la règle vient de l'ôter. Aucun fichier ajouté. */
/* LOT 31 — LES HUIT CORRECTIONS DU PARCOURS — NOM DE CACHE CHANGÉ.

   Huit fichiers servis changent : `css/style.css` (la couleur des états du
   calendrier gagne enfin), `js/ui-kit.js` (la règle des plages, en un seul
   exemplaire), `js/ui-conges.js` (le choix de la demi-journée, les raccourcis
   retirés, le plafond d'anticipation), `js/ui-document.js` (la moitié de
   journée sur la pièce remise à la famille, et les plages), `js/ui-enfant.js`
   (« Journées à part » en plages), `js/ui-menu.js` (la vérité sur les rappels,
   « Reprendre mes comptes » retiré), `js/db.js` (la colonne `demi_journee`
   lue et écrite) et `js/engine.js` (l'anticipation bornée).

   ILS SE RÉPONDENT, et deux mélanges seraient franchement mauvais :

   - `js/ui-document.js` neuf servi avec `js/ui-kit.js` ancien appellerait
     `Kit.plagesDeJours` à `undefined` À SON RENDU : le document remis à une
     famille tomberait, pas seulement une ligne de plus ou de moins ;
   - `js/ui-conges.js` neuf servi avec `js/engine.js` ancien laisserait Maria
     pousser le stepper des congés payés deux jours au-delà de sa réserve, puis
     l'écriture ferait tomber le mois sur `IMPUTATION_DEPASSE_RESERVES` — un
     geste offert et refusé une seconde plus tard, exactement le défaut que le
     lot précédent a corrigé dans l'autre sens.

   `js/db.js` neuf avec un ancien écran est inoffensif (une colonne lue que
   personne n'affiche), mais l'inverse ne l'est pas : l'écran écrirait
   `demi_journee` sans que la couche données la transmette, et la demi-journée
   serait perdue en silence entre le geste et le document.

   Aucun fichier ajouté : la migration `020` n'est pas servie, et les trois
   fichiers de test non plus. */
/* CORRECTIF DU PARCOURS DE MISE À JOUR — NOM DE CACHE CHANGÉ, ET SURTOUT :
   LE NUMÉRO DE VERSION SORT D'ICI ET ENTRE DANS LES URLS.

   Ce qui s'est passé le 31 août 2026, et qu'il ne faut plus jamais revoir :
   le lot 31 était en ligne, servi correctement par GitHub Pages, et le
   téléphone continuait d'afficher la version d'avant. Deux causes, qui se
   renforçaient l'une l'autre.

   1. Le gestionnaire `fetch` servait le CACHE D'ABORD, y compris pour la
      NAVIGATION — c'est-à-dire pour la page elle-même. Le réseau n'était
      consulté qu'en arrière-plan, pour la fois SUIVANTE. Or une application
      posée sur l'écran d'accueil n'est pas rechargée quand on la rouvre : le
      système la met en pause et la reprend. Elle n'avait donc jamais de
      « fois suivante ».

   2. `index.html` désignait ses fichiers par des URLs INVARIANTES
      (`js/app.js`). Un `index.html` en cache redemandait exactement les
      mêmes URLs, et rien ne distinguait le fichier neuf de l'ancien.

   La correction porte sur les deux, parce que corriger l'une sans l'autre
   laisse la panne possible :

   - la NAVIGATION passe en RÉSEAU D'ABORD, cache en secours (plus bas) ;
   - chaque fichier `js/` et `css/` servi porte `?v=` + VERSION, ici comme
     dans `index.html`. Un fichier modifié devient une URL DIFFÉRENTE :
     aucune ancienne copie ne peut plus être servie à sa place, ni par ce
     cache, ni par celui du navigateur, ni par celui de GitHub Pages.

   LA RÈGLE, DÉSORMAIS, TIENT EN UNE LIGNE : à chaque livraison qui touche un
   fichier `js/` ou `css/`, on change VERSION — et rien d'autre. Le nom du
   cache et les dix-huit URLs en découlent. `test/cache-navigation.smoke.js`
   refuse la livraison si `index.html` et ce fichier ne portent pas la même. */
var VERSION = 'lot32-finitions';

var CACHE = 'recap-' + VERSION;

/* Les fichiers dont le CONTENU change d'une livraison à l'autre : ils portent
   la version dans leur URL. La liste doit rester identique, au même ordre
   près, à celle des balises `<script>` et `<link>` de `index.html` — c'est ce
   que le test vérifie. */
var VERSIONNES = [
  './css/style.css',
  './config.js',
  './js/messages.js',
  './js/feries.js',
  './js/format.js',
  './js/engine.js',
  './js/db.js',
  './js/chaine-mois.js',
  './js/ui-kit.js',
  './js/ui-reouverture.js',
  './js/ui-accueil.js',
  './js/ui-enfant.js',
  './js/ui-document.js',
  './js/ui-conges.js',
  './js/ui-historique.js',
  './js/ui-contrat.js',
  './js/ui-familiarisation.js',
  './js/ui-menu.js',
  './js/ui-periode.js',
  './js/app.js'
];

var CDN_SUPABASE = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';

/* Ce qui NE porte PAS de version : la page elle-même — elle est désormais
   servie réseau d'abord, la question ne se pose plus — le manifeste et les
   icônes, dont le contenu ne change pas d'une livraison à l'autre. */
var FICHIERS = [
  './',
  './index.html',
  './manifest.json',
  './icones/icone-192.png',
  './icones/icone-512.png'
].concat(VERSIONNES.map(function (u) { return u + '?v=' + VERSION; }));

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (cache) {
      /* Les fichiers de l'application doivent tous être là : si l'un manque,
         l'installation échoue et l'ancienne version reste en place.

         `cache: 'reload'` (correction A12 de la relecture) : sans lui, addAll
         passe par le cache HTTP du navigateur — GitHub Pages sert les statiques
         en max-age=600 — et une installation pouvait donc re-stocker les
         fichiers de l'ANCIENNE version, rendant l'incrément de CACHE inopérant
         pendant dix minutes. On force le réseau au moment de l'installation. */
      var requetes = FICHIERS.map(function (u) {
        return new Request(u, { cache: 'reload' });
      });
      return cache.addAll(requetes).then(function () {
        /* Le CDN, lui, est tenté séparément : un CDN momentanément injoignable
           ne doit pas empêcher la mise à jour de l'application. */
        return cache.add(new Request(CDN_SUPABASE, { cache: 'reload' }))
          .catch(function () { return null; });
      });
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (cles) {
      return Promise.all(cles.map(function (c) {
        return c === CACHE ? null : caches.delete(c);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var requete = e.request;
  if (requete.method !== 'GET') return;

  var url;
  try { url = new URL(requete.url); } catch (err) { return; }

  var memeOrigine = url.origin === self.location.origin;
  var estCdn = requete.url.indexOf(CDN_SUPABASE) === 0;
  if (!memeOrigine && !estCdn) return;      // API Supabase : jamais interceptée

  /* ---------------------------------------------------------------------- */
  /* LA NAVIGATION : RÉSEAU D'ABORD, CACHE EN SECOURS.                       */
  /* ---------------------------------------------------------------------- */

  /* La page elle-même est le seul fichier dont une copie périmée fait perdre
     TOUTE la livraison : elle désigne les autres. Elle est donc demandée au
     réseau à chaque ouverture, et le cache ne sert plus que de filet.

     `cache: 'reload'` pour la même raison qu'à l'installation : GitHub Pages
     sert les statiques en `max-age=600`, et sans lui le navigateur pourrait
     rendre depuis SON cache une page vieille de dix minutes — on aurait
     déplacé la panne d'un cran, pas supprimée.

     Le coût est une requête par ouverture, pour un fichier de quelques
     kilo-octets. Hors ligne, `fetch` échoue, on retombe sur le cache, et
     l'application s'ouvre exactement comme avant. */
  if (requete.mode === 'navigate') {
    e.respondWith(
      fetch(new Request(requete.url, { cache: 'reload' })).then(function (reponse) {
        if (reponse && reponse.ok) {
          var copie = reponse.clone();
          caches.open(CACHE).then(function (cache) {
            cache.put('./index.html', copie);
          });
        }
        return reponse;
      }).catch(function () {
        return caches.match(requete).then(function (enCache) {
          return enCache || caches.match('./index.html');
        });
      })
    );
    return;
  }

  /* ---------------------------------------------------------------------- */
  /* TOUT LE RESTE : CACHE D'ABORD — et c'est maintenant sans danger.        */
  /* ---------------------------------------------------------------------- */

  /* Ces fichiers portent leur version dans leur URL (`?v=`). Une entrée en
     cache ne peut donc plus correspondre qu'au contenu qu'on lui demande :
     servir le cache d'abord rend l'application instantanée sans risquer de
     servir un fichier périmé. C'est le versionnement des URLs qui autorise
     cette stratégie, pas l'inverse. */
  e.respondWith(
    caches.match(requete).then(function (enCache) {
      var reseau = fetch(requete).then(function (reponse) {
        if (reponse && reponse.ok && (memeOrigine || estCdn)) {
          var copie = reponse.clone();
          caches.open(CACHE).then(function (cache) { cache.put(requete, copie); });
        }
        return reponse;
      }).catch(function () {
        /* Hors ligne : on retombe sur le cache. Le cas de la NAVIGATION ne
           passe plus par ici — il a sa propre branche, plus haut, avec son
           propre secours. */
        if (enCache) return enCache;
        throw new Error('hors ligne');
      });
      return enCache || reseau;
    })
  );
});

/* ============================================================================
   LOT 15 — Réception des notifications de rappel.

   Ce bloc s'exécute même APPLICATION FERMÉE : c'est tout l'intérêt d'un
   service worker, et c'est la raison pour laquelle un minuteur JavaScript
   ordinaire ne pouvait pas faire le travail.

   Le texte affiché vient du serveur : il n'est ni reconstruit ni traduit ici.
   Deux formulations pour la même notification finiraient par diverger.
   ========================================================================= */

self.addEventListener('push', function (e) {
  var contenu = { titre: 'Récap', corps: 'Un mois reste à clôturer.' };
  try {
    if (e.data) contenu = e.data.json();
  } catch (err) {
    /* Charge illisible : on affiche quand même quelque chose d'utile plutôt
       que rien. Une notification muette serait pire qu'un texte générique. */
  }
  e.waitUntil(self.registration.showNotification(contenu.titre || 'Récap', {
    body: contenu.corps || '',
    icon: './icones/icone-192.png',
    badge: './icones/icone-192.png',
    tag: 'rappel-cloture',        // une seule notification à la fois, jamais une pile
    renotify: false,
    data: { url: './' }
  }));
});

/* Toucher la notification ouvre l'application — sur l'onglet où le travail
   attend, pas sur une page d'accueil vide. */
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (fenetres) {
      for (var i = 0; i < fenetres.length; i++) {
        if ('focus' in fenetres[i]) return fenetres[i].focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('./');
    })
  );
});
