# Les rappels — marche à suivre pour la mise en service (lot 32, §10)

Préparé par l'agent, **exécuté par Adrien**. Rien de ce qui suit n'a été
fait : la fonction n'est pas déployée, aucun secret n'est posé, `pg_cron`
n'est pas installé. Chaque étape dit **ce qu'il faut voir** pour savoir
qu'elle est réussie. Aucune valeur réelle ne figure ici, et aucune ne doit
jamais entrer dans le dépôt.

Ordre impératif : **le SQL d'abord (étape 1), la fusion ensuite (étape 2)**,
puis le reste.

---

## 1. La migration `021_rappels.sql`

1. Ouvrir Supabase → **SQL Editor** → **New query**.
2. Coller le contenu complet de `supabase/migrations/021_rappels.sql`, puis
   **Run**.
3. **À voir** : « Success. No rows returned ». Puis lancer :
   ```sql
   select actif, jour_du_mois, heure, chaque_jour_ensuite, quoi
     from public.preference_rappel;
   ```
   **À voir** : une ligne, `actif = false`, `jour_du_mois = 25`,
   `heure = 19:00:00`, `quoi = les_deux`. La colonne `quoi` existe : sans
   elle l'application ne pourra pas lire les réglages.

## 2. La fusion de la branche

1. Fusionner `feat/lot32-finitions` dans `main` (page « compare » de GitHub).
2. **À voir** : la CI verte (`node test/run.js`, `npm run test:ui`,
   `npm run mesures`), et, quelques minutes après, la page servie porte
   `?v=lot32-finitions` (afficher le code source de
   https://mdgpds.github.io/recap-maria/ et chercher `lot32-finitions`).
3. **Sur le téléphone** : fermer complètement l'application (la balayer hors
   de la liste des applications), la rouvrir, la fermer encore, la rouvrir.
   La première ouverture installe le nouveau service worker, la seconde le
   sert. **À voir** : dans Menu → « Me rappeler de clôturer », l'encart orange
   « Les rappels ne sont pas encore activés sur ce compte. » et des réglages
   estompés. C'est l'état attendu tant que la clé n'est pas posée.

## 3. Générer la paire de clés VAPID

Sur un ordinateur où `node` est installé (aucune dépendance à ajouter au
dépôt) :

```bash
npx --yes web-push generate-vapid-keys
```

**À voir** : deux lignes, `Public Key:` (87 caractères) et `Private Key:`
(43 caractères). Les garder dans un gestionnaire de mots de passe. **La
privée ne se colle nulle part d'autre que dans les secrets de la fonction
(étape 5).**

## 4. Poser la clé PUBLIQUE dans `config.js`

C'est **le seul fichier du dépôt qui bouge**, et il contient déjà d'autres
valeurs publiques (l'URL et la clé `publishable`).

1. Sur GitHub, ouvrir `config.js` → crayon « Edit ».
2. Remplacer `VAPID_PUBLIC_KEY: ''` par `VAPID_PUBLIC_KEY: '<la clé
   publique>'` — la publique, celle de 87 caractères.
3. Committer sur `main`, changer `VERSION` dans `sw.js` (par exemple
   `lot32-vapid`) et les `?v=` de `index.html` — `test/cache-navigation.smoke.js`
   refuse sinon la livraison.
4. **À voir** : après le double fermer/rouvrir sur le téléphone, l'écran des
   rappels passe en **« Les rappels sont prêts, il reste à les autoriser. »**
   avec le bouton **« Autoriser les rappels »**. Ne pas appuyer encore : la
   fonction n'est pas déployée.

## 5. Poser la clé PRIVÉE et le secret d'appel dans les secrets Supabase

1. Supabase → **Edge Functions** → **Secrets** (ou **Project Settings →
   Edge Functions**).
2. Ajouter quatre secrets, **jamais dans le dépôt** :
   - `VAPID_PUBLIC_KEY` — la même clé publique qu'en étape 4 ;
   - `VAPID_PRIVATE_KEY` — la clé privée de l'étape 3 ;
   - `VAPID_SUBJECT` — `mailto:` suivi d'une adresse e-mail à vous (les
     services de notification l'exigent pour vous joindre en cas d'abus) ;
   - `RAPPELS_SECRET` — une longue chaîne aléatoire inventée pour l'occasion
     (par exemple le résultat de `openssl rand -base64 32`). C'est le mot de
     passe entre la planification et la fonction : **aucun appel anonyme ne
     doit pouvoir la déclencher.**
3. **À voir** : les quatre noms dans la liste des secrets. Leurs valeurs ne se
   relisent pas, c'est normal.

## 6. Déployer la fonction

Depuis un ordinateur avec la CLI Supabase (`npm i -g supabase`, puis
`supabase login`) :

```bash
supabase functions deploy rappels-cloture --project-ref <ref-du-projet> --no-verify-jwt
```

`--no-verify-jwt` : la fonction est appelée par `pg_cron`, pas par une
utilisatrice connectée ; sa protection est `RAPPELS_SECRET`, vérifié dans
le code.

**À voir** : « Deployed Function rappels-cloture », puis dans Supabase →
Edge Functions, la fonction listée. Un premier appel de contrôle, **sans
secret**, doit être refusé :

```bash
curl -s -X POST https://<ref-du-projet>.supabase.co/functions/v1/rappels-cloture
```

**À voir** : `{"erreur":"appel non autorisé"}` (401). Si c'est
`RAPPELS_SECRET n’est pas configuré` (503), retourner à l'étape 5.

Puis **avec** le secret :

```bash
curl -s -X POST https://<ref-du-projet>.supabase.co/functions/v1/rappels-cloture \
  -H "x-rappels-secret: <RAPPELS_SECRET>"
```

**À voir** : un JSON `{"heure_paris":…, "envoyees":0, "ignorees":…}`. Rien ne
part encore : aucun appareil n'est abonné.

## 7. Autoriser les rappels sur le téléphone

1. L'application doit être **installée sur l'écran d'accueil** (iPhone
   n'envoie aucune notification à une page ouverte dans Safari).
2. Menu → « Me rappeler de clôturer » → **« Autoriser les rappels »** →
   accepter la demande du téléphone.
3. **À voir** : l'encart vert **« Les rappels sont actifs sur cet appareil. »**,
   les réglages actifs. Choisir le jour, l'heure, « quoi rappeler », puis
   **Enregistrer** → « Réglages enregistrés. ».
4. Contrôle en base :
   ```sql
   select count(*) from public.abonnement_push;
   select actif, quoi from public.preference_rappel;
   ```
   **À voir** : `1` abonnement, `actif = true`.

## 8. Installer `pg_cron` et planifier

1. Ouvrir `supabase/controles/rappels-planification.sql`, remplacer
   `<URL-DE-LA-FONCTION>` et `<RAPPELS_SECRET>` **dans l'éditeur SQL**, jamais
   dans le fichier.
2. **Run**.
3. **À voir** : la requête de contrôle a) rend une ligne
   `rappels-cloture · 0 * * * · active = true`. À l'heure ronde suivante,
   b) rend `status = succeeded`, et c) un `status_code = 200` avec un corps
   `{"heure_paris":…}`.

## 9. Le contrôle final : un rappel qui arrive vraiment sur le téléphone

1. Régler l'heure du rappel sur **l'heure ronde qui suit** (par exemple 15 h
   s'il est 14 h 20), **« Puis chaque jour »**, **« Les deux »**, et
   **Enregistrer**. Il faut qu'il y ait quelque chose à rappeler : un mois
   passé non clôturé, ou — après le 25 — le mois en cours.
2. Verrouiller le téléphone et attendre l'heure ronde.
3. **À voir** : une notification **« Récap »** avec, par exemple, « Vous
   n’avez pas encore clôturé le mois de juillet. » — **sans aucun prénom ni
   nom de famille**. L'ouvrir ouvre l'application.
4. Contrôle en base :
   ```sql
   select dernier_envoi_le from public.preference_rappel;
   ```
   **À voir** : la date du jour. Le rappel ne repartira pas avant demain.
5. Remettre ensuite l'heure voulue (19 h par défaut) et **Enregistrer**.

Si rien n'arrive : la requête c) de l'étape 8 dit ce que la fonction a
répondu (`ignorees` = rien à rappeler à cette heure ; `abonnements_retires`
= l'appareil a rejeté l'abonnement, l'écran repassera en « à autoriser »).
