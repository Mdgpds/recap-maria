# CLAUDE.md — conventions du dépôt `recap-maria`

Ce fichier existe pour qu'un agent qui arrive sur ce dépôt n'ait pas à
redécouvrir les conventions à zéro. Il dit ce qui est **vrai aujourd'hui**, pas
ce qu'on aimerait. Quand une règle change, ce fichier change dans le même
commit.

---

## 0. Les deux règles absolues

Elles ne se discutent pas, elles ne se desserrent pas, et aucun raccourci ne
les remplace.

### 0.1 — Dépôt PUBLIC : aucune donnée réelle, nulle part

Ni prénom, ni nom de famille, ni salaire, ni identifiant, ni adresse, ni
numéro. **Y compris** en commentaire, en valeur par défaut, en jeu de test, en
fixture, en message de commit et en capture d'écran.

Les décors de test utilisent des noms d'oiseaux et de plantes — *Aigrette*,
*Alouette*, *Aubépine*. Continuer ainsi.

Ce qui **peut** figurer ici : l'URL Supabase et la clé `publishable` (anon),
déjà dans `config.js` — elles sont faites pour vivre côté navigateur et ne
donnent accès qu'à ce que les policies RLS autorisent. Ce qui ne le peut
**jamais** : la clé `service_role`, la clé VAPID **privée**, `RAPPELS_SECRET`.
Un dépôt public garde dans son historique git une clé committée, même
supprimée ensuite.

### 0.2 — Aucune commande git qui écrit

Adrien ne travaille jamais en ligne de commande et **pousse lui-même**, par la
page web de GitHub. Un agent n'exécute ni `git push`, ni `git commit` sur le
dépôt distant, ni `gh`, ni aucun outil qui écrit dans le dépôt.

Ce que l'agent livre à la place : les **fichiers**, le **nom de branche**, le
**titre** et la **description**. Il peut ouvrir la page GitHub et remplir les
champs ; c'est Adrien qui clique.

> **Piège vérifié** : le glisser-déposer de GitHub **saute les fichiers
> cachés**. Un `.gitignore` déposé de cette façon n'arrive jamais. Pour un
> fichier commençant par un point, passer par « Add file → Create new file » et
> taper le nom à la main.

---

## 1. Ce que fait l'application

« Récap Maria » est une PWA de récapitulatif mensuel pour assistante
maternelle : présences, heures supplémentaires, congés et salaire, contrat par
contrat, avec un document mensuel à remettre aux familles.

- En ligne : https://mdgpds.github.io/recap-maria/ (GitHub Pages, branche `main`)
- Back-end : Supabase (projet `exsllenakcbxfqasaupu`)

---

## 2. La pile

**HTML, CSS et JavaScript natifs. Zéro framework, zéro étape de build.**
Le fichier livré est le fichier lu. C'est un choix, pas un retard : l'
application doit rester réparable dans dix ans par quelqu'un qui ouvre un
éditeur de texte.

Chaque module est une IIFE qui expose une seule globale :

```js
(function (global) {
  'use strict';
  // ...
  global.Kit = { /* … */ };
}(window));
```

Globales exposées : `Messages`, `Feries`, `Format`, `Engine`, `DB`,
`ChaineMois`, `Kit`, `App`.

L'ordre de chargement des `<script>` dans `index.html` **est** l'ordre des
dépendances. Un nouveau fichier `js/` ou `css/` doit entrer dans **trois**
endroits : `index.html`, la liste `VERSIONNES` de `sw.js`, et la vérification
de `test/cache-navigation.smoke.js` s'en assure.

Seule dépendance externe : le client Supabase, chargé du CDN jsDelivr.
`node_modules` ne sert qu'aux tests (jsdom) et n'est jamais livré.

---

## 3. Le moteur — `js/engine.js`

**Le moteur est PUR.** Il ne fait ni réseau, ni DOM, ni horloge :

- pas de `new Date()`, pas de `Date.now()` ;
- pas de `document`, pas de `window` autre que le porteur de la globale ;
- pas de `fetch`, pas de `DB`.

La **date du jour entre par les paramètres** : `entrees.aujourdhui`. Sans elle,
le moteur se comporte comme si aucune date de référence n'existait — et c'est
testé (`parcours-anticipation.test.js`, « aucune horloge n'est entrée dans le
moteur »).

Pourquoi c'est intransigeant : un moteur qui lit l'heure donne des résultats
différents selon le jour où on le lance. Un récap de mars recalculé en
septembre ne rendrait plus les mêmes chiffres, et personne ne saurait lequel
est le bon.

**Corollaire pour l'interface** : un chiffre annoncé à l'écran se **rejoue**
avec `Engine`, il ne se réécrit pas. Une borne, un plafond, un décompte
recopiés en dur dans un fichier `ui-*.js` sont un défaut, même si la valeur est
juste aujourd'hui.

---

## 4. Unités et conventions de données

| Grandeur | Unité | Jamais |
|---|---|---|
| Durées | **minutes entières** | heures décimales, flottants |
| Argent | **centimes entiers** | euros flottants |
| Dates | **chaînes `YYYY-MM-DD`** | objets `Date` transportés |
| Mois | `{ annee, mois }`, mois de **1 à 12** | index 0-11 |

### La conversion salariale

```js
MINUTES_BASE_MENSUELLE = 195 * 60          // = 11700 (195 h/mois)
montantCentimes(brutMensuelCentimes, minutes, coefficient = 1)
  = Math.round(brutMensuelCentimes * minutes * coefficient / 11700)
```

Un seul `Math.round`, à la fin. Arrondir en cours de route fait dériver les
totaux de quelques centimes, et c'est exactement le genre d'écart qu'une
famille remarque.

### Les dates

Une date de calendrier est une **chaîne**, manipulée comme une chaîne
(`d.slice(0, 7)` pour le mois). Quand un calcul de calendrier est
inévitable — ajouter un jour, trouver la fin d'un mois — il se fait en **UTC** :

```js
// correct
new Date(Date.UTC(annee, mois - 1, jour)).toISOString().slice(0, 10)

// FAUX : un fuseau à l'ouest de Greenwich recule d'un jour
new Date(annee, mois - 1, jour).toISOString().slice(0, 10)
```

`new Date().toISOString()` reste légitime pour un **horodatage** (`updated_at`,
`audit_le`) — c'est un instant, pas une date de calendrier.

---

## 5. La saisie par exception

**L'absence de ligne est un état.** Un jour du planning sans ligne `journee` est
un jour de garde ordinaire. On n'écrit une ligne que pour ce qui **dévie** :
absence, congé, journée particulière, horaire différent.

Conséquence directe : revenir à la normale, c'est **supprimer** la ligne, pas
en écrire une qui dit « normal ». Un agent qui ajoute une ligne « présence »
casse le modèle et fait payer une journée deux fois.

---

## 6. L'immuabilité d'un mois clôturé

Un récap passe de `brouillon` à `fige`. **Un récap figé ne change plus.**

La protection est **en base**, par le trigger `recap_mensuel_immuable`
(migration `001`) — pas seulement dans l'interface. Seuls les champs d'audit
(`audit_note`, `audit_le`) restent modifiables sur un figé, et l'insertion
directe d'un récap déjà figé est refusée.

Un agent ne recalcule jamais un mois figé, et n'écrit jamais de contournement
côté client : si le trigger refuse, c'est qu'il a raison.

Rouvrir un mois est un geste explicite, tracé, avec son propre écran.

---

## 7. Le service worker et la mise à jour — `sw.js`

**La règle tient en une ligne :**

> À chaque livraison qui touche un fichier `js/` ou `css/`, on change
> `VERSION` dans `sw.js` — **et rien d'autre**.

Le nom du cache (`'recap-' + VERSION`) et les vingt URLs versionnées du
pré-cache en découlent. `index.html` porte les mêmes `?v=` **écrits à la
main** : `test/cache-navigation.smoke.js` refuse la livraison si les deux
fichiers divergent.

Deux comportements à ne pas inverser :

- **la navigation** (la page elle-même) : **réseau d'abord**, cache en secours,
  avec `cache: 'reload'` — sinon le `max-age=600` de GitHub Pages sert une page
  vieille de dix minutes ;
- **les fichiers versionnés** : **cache d'abord**. C'est sans danger *parce
  que* leur URL porte la version : une entrée en cache ne peut plus
  correspondre qu'au contenu demandé.

`sw.js` lui-même est enregistré **sans** version — c'est le seul fichier dont
le navigateur doit pouvoir constater le changement tout seul.

> Pourquoi ces précautions : le 31 août 2026, une livraison juste, servie
> correctement, n'a pas atteint le téléphone. Le service worker servait le cache
> d'abord y compris pour la page, et une PWA posée sur l'écran d'accueil n'est
> jamais rechargée. **« C'est en production » sur le serveur n'est pas « c'est
> en production » sur l'écran** : vérifier les fichiers servis ne prouve rien
> sur la page chargée.

Après une livraison qui change le service worker, il faut **ouvrir
l'application deux fois** sur un appareil qui portait l'ancien : la première
ouverture l'installe, la seconde le sert.

---

## 8. La base — migrations Supabase

`supabase/migrations/`, numérotées et **jamais réécrites** : `001` à `020`.

`020_demi_journee.sql` est la dernière appliquée en production.

Elles sont exécutées **à la main** dans l'éditeur SQL de Supabase, jamais par
un outil. Une nouvelle migration prend le numéro **suivant** — vérifier le
dossier avant de choisir, le numéro `019` a déjà été proposé alors qu'il était
pris.

**Ordre de mise en production, sans exception : le SQL d'abord, la fusion
ensuite.** Une migration qui arrive après le code laisse une application qui
écrit dans une colonne inexistante.

Deux règles de schéma :

- une colonne que la base **exige** doit être fournie par l'écriture — c'est ce
  que garde `test/ecriture-vs-schema.test.js` ;
- une colonne n'est **lue** que si elle est demandée — `test/couche-donnees.test.js`.

---

## 9. Les tests

```bash
node test/run.js      # moteur, chaîne des mois, messages, couche données
npm run test:ui       # tests de fumée d'interface (jsdom, index.html réel)
npm run mesures       # mise en page à 390 px dans un VRAI navigateur (Playwright)
```

**Décomptes de référence au 2 septembre 2026 (branche `feat/redesign-2a`) :**

| Suite | Assertions | Échecs |
|---|---|---|
| `node test/run.js` | **271** | 0 |
| `npm run test:ui` | **2173** | 0 |

(Avant le redesign 2A, `main` = `02dbd46` : 270 et 1976.)

**`npm run mesures` n'est pas dans `test:ui`** : il a besoin de Playwright et
d'un Chromium (`npm i -D playwright && npx playwright install chromium`, ou
`PLAYWRIGHT_CHROMIUM=/chemin/chromium`). Il parcourt sept écrans à 390 × 780,
tactile, sur un décor fictif servi par `test/fixtures/faux-supabase-390.js`, et
sort en code 1 au premier débordement, contrôle rogné ou zone tactile sous
44 px. C'est la seule mesure de mise en page du dépôt — jsdom ne met pas en
page. `CAPTURES=/un/dossier` enregistre une capture par écran.

Les deux tournent en CI (`.github/workflows/ci.yml`) sur chaque push vers
`main` et chaque pull request, après un `node --check` de tous les fichiers
servis.

**Un décompte qui baisse sans qu'un test ait été retiré volontairement est un
signal**, pas un détail : c'est ainsi qu'on s'est aperçu qu'une suppression de
sept tests n'avait déclenché aucune alerte.

### Ce qu'on attend d'un test ici

- **Un test qui ne sait pas échouer ne teste rien.** Quand un test garde une
  correction, il doit prouver qu'il mord : on **remet le défaut** dans une copie
  et on vérifie que la mesure s'effondre. Une mutation, pas une comparaison avec
  l'historique git — le contrôle doit rester valable dans un ZIP et dans un
  dépôt sans historique.
- **Jamais de branche d'échappement qui imprime `ok`.** Un test dont le décor
  manque doit **échouer**, pas se compter comme réussi.
- **jsdom ignore la spécificité CSS** : il résout la cascade dans l'ordre des
  sources. `getComputedStyle` y donne la bonne réponse avant *et* après une
  correction de spécificité — un test bâti dessus serait vert des deux côtés.
  Voir `test/parcours-calendrier.smoke.js`, qui fait l'arithmétique lui-même.
- **Tout lot qui rouvre le moteur porte un différentiel** contre le moteur figé
  d'avant, placé **en premier** dans `test/run.js` : si l'égalité tombe, tout ce
  qui suit est suspect. Les fixtures figées vivent dans `test/fixtures/`.

---

## 10. Organisation du dépôt

```
index.html            l'unique page ; l'ordre des <script> est l'ordre des dépendances
sw.js                 service worker : VERSION, pré-cache, stratégies
config.js             URL et clé publishable Supabase — rien d'autre
css/style.css         feuille unique ; couleurs dans :root, jamais en dur ailleurs
js/                   18 modules (voir §2)
test/                 suites + fumée d'interface ; test/fixtures/ = moteurs figés
supabase/migrations/  001 à 020, jamais réécrites
supabase/functions/   rappels-cloture (non déployée à ce jour)
supabase/controles/   requêtes SQL de contrôle, hors migrations
scripts/keepalive.js  maintien du projet Supabase
```

---

## 11. Comment travailler sur ce dépôt

1. **Montrer le plan avant de coder** quand le chantier est autre chose qu'un
   correctif évident.
2. **Ne jamais trancher une règle métier en silence.** Une ambiguïté se pose à
   Adrien, et on attend la réponse. Une règle tranchée seule qui se révèle
   fausse coûte plus cher que la question.
3. **Dire ce qu'on n'a pas pu prouver.** Une assertion qui mesure autre chose
   que ce qu'elle annonce est pire qu'une assertion absente ; l'écrire en clair
   dans la restitution est toujours préférable au vert de façade.
4. **Vérifier sur l'écran, pas sur le serveur** (§7).
5. Les décisions métier et les restitutions de lot sont tenues à jour dans le
   projet Claude « Maria app » — les lire avant de rouvrir un sujet.
