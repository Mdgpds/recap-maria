# Récap Maria

Récapitulatif mensuel pour assistante maternelle : présences, heures
supplémentaires, congés et salaire, **contrat par contrat**, avec le document
mensuel à remettre à chaque famille.

Application web installable (PWA), utilisée depuis un téléphone.

- **En ligne** : https://mdgpds.github.io/recap-maria/
- **Base de données** : Supabase (authentification, stockage, règles d'accès)

---

## À quoi elle sert

Une assistante maternelle garde plusieurs enfants, chacun sous son contrat, avec
ses horaires, son salaire mensualisé et ses congés. Chaque fin de mois, elle
doit dire à chaque famille : combien de jours de garde, combien d'heures
supplémentaires, quels congés, quel salaire dû. Fait à la main, c'est long et
c'est contesté.

L'application tient les journées au fil du mois, calcule le récapitulatif, et
produit le document que la famille reçoit.

### Ce qu'elle fait

- **Le calendrier du mois**, enfant par enfant : garde, absence, congé, jour
  férié, journée particulière.
- **La saisie par exception** : une journée ordinaire ne se saisit pas. On
  n'enregistre que ce qui dévie.
- **Le calcul** : heures effectuées, heures supplémentaires, congés payés,
  récupération, salaire brut et net dus, au centime.
- **Les congés** : pose en journées ou en durée libre, imputation sur les
  congés payés ou la récupération, anticipation sur le mois en cours.
- **Le document mensuel**, prêt à être remis.
- **La clôture** : un mois clôturé est figé et ne change plus.
- **Les contrats et leurs avenants**, datés : un mois relève d'un seul jeu de
  conditions.
- **Hors ligne** : l'application s'ouvre sans réseau. Les données, elles,
  restent en ligne — il n'y a pas de synchronisation différée, et c'est
  volontaire : une saisie rejouée plus tard sur un mois entre-temps clôturé
  produirait exactement l'incohérence que cette application existe pour éviter.

---

## Comment elle est faite

**HTML, CSS et JavaScript natifs. Zéro framework, zéro étape de build.**
Le fichier livré est le fichier lu.

Le cœur du calcul, `js/engine.js`, est une **fonction pure** : ni réseau, ni
DOM, ni horloge. La date du jour lui est passée en paramètre. Un mois recalculé
dans six mois rend exactement les mêmes chiffres qu'aujourd'hui.

Les durées sont des **minutes entières**, l'argent des **centimes entiers**, les
dates des chaînes `YYYY-MM-DD`. Aucun flottant n'entre dans un montant.

```
index.html            l'unique page
sw.js                 service worker : cache et mise à jour
config.js             URL et clé publique Supabase
css/style.css         feuille unique
js/                   18 modules (moteur, données, écrans)
test/                 suites de test et tests de fumée d'interface
supabase/migrations/  le schéma, migration par migration
```

---

## Développement

```bash
npm install           # jsdom, pour les tests d'interface uniquement
node test/run.js      # moteur, chaîne des mois, messages, couche données
npm run test:ui       # tests de fumée d'interface (jsdom sur le vrai index.html)
```

Il n'y a **rien à compiler**. Pour voir l'application, servir le dossier :

```bash
python3 -m http.server 8000
```

puis ouvrir http://localhost:8000 — un service worker exige `localhost` ou
HTTPS, `file://` ne suffit pas.

Les deux suites tournent en intégration continue sur chaque *pull request* et
sur chaque poussée vers `main`.

---

## Contribuer

Les conventions du dépôt — le moteur pur, les unités, la saisie par exception,
l'immuabilité d'un mois clôturé, la règle de version du service worker, l'état
des migrations, ce qu'on attend d'un test — sont dans **[`CLAUDE.md`](CLAUDE.md)**.
À lire avant toute modification.

Deux règles y sont absolues :

1. **Dépôt public : aucune donnée réelle, nulle part.** Ni prénom, ni salaire,
   ni identifiant — y compris en commentaire, en valeur par défaut ou en jeu de
   test. Les décors de test utilisent des noms d'oiseaux et de plantes.
2. **La mise en production se fait par la page web de GitHub**, jamais par une
   commande qui écrit dans le dépôt. Et **le SQL d'abord, la fusion ensuite**.
