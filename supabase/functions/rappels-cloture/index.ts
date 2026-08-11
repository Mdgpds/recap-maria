/* ============================================================================
   rappels-cloture — Fonction Supabase planifiée (lot 15).

   LA SEULE BRIQUE SERVEUR DU PROJET. Elle existe parce qu'une notification à
   heure fixe ne peut pas être programmée depuis un téléphone : un minuteur
   JavaScript ne s'exécute que si l'application est ouverte. Le rappel
   n'arriverait jamais, et — c'est le pire — personne ne s'en apercevrait
   (risque n° 1). Il faut donc quelque chose qui tourne sans Maria.

   PLANIFICATION : toutes les heures, à la minute 0.
     select cron.schedule('rappels-cloture', '0 * * * *', $$ ... $$);

   LE FUSEAU EST LE PIÈGE (risque n° 4). Cette fonction s'exécute en UTC.
   « 19:00 » réglé par Maria, c'est 19 h à PARIS — donc 17:00 UTC en été et
   18:00 UTC en hiver. Comparer l'heure réglée à l'heure UTC enverrait le
   rappel à 21 h en juillet. On convertit donc l'instant courant en heure de
   Paris avant toute comparaison, en laissant `Intl` faire le travail : lui
   seul connaît les dates de changement d'heure.

   AUCUNE CLÉ DANS CE FICHIER (risque n° 2, A4). Les clés VAPID viennent des
   secrets de la fonction. Une clé privée committée dans un dépôt PUBLIC est
   irrécupérable : elle reste dans l'historique git après suppression.
   ========================================================================= */

import { createClient } from 'jsr:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3';

const URL_SUPABASE = Deno.env.get('SUPABASE_URL')!;
const CLE_SERVICE  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const VAPID_PUBLIQUE = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVEE   = Deno.env.get('VAPID_PRIVATE_KEY')!;
const VAPID_CONTACT  = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:contact@exemple.test';

webpush.setVapidDetails(VAPID_CONTACT, VAPID_PUBLIQUE, VAPID_PRIVEE);

/* L'heure et le jour du mois À PARIS, quelle que soit l'heure du serveur. */
function maintenantAParis(): {
  jour: number; heure: number; annee: number; mois: number; iso: string;
} {
  const f = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', hour12: false
  });
  const p: Record<string, string> = {};
  for (const part of f.formatToParts(new Date())) p[part.type] = part.value;
  const annee = Number(p.year), mois = Number(p.month), jour = Number(p.day);
  return {
    annee, mois, jour, heure: Number(p.hour),
    /* La DATE de Paris, écrite comme la base l'attend. Elle sert à la trace
       d'envoi (correctif A6) : « ai-je déjà prévenu Maria aujourd'hui ? » ne
       doit pas dépendre du fuseau du serveur. */
    iso: annee + '-' + String(mois).padStart(2, '0') + '-' + String(jour).padStart(2, '0')
  };
}

/* Le dernier jour du mois courant, à Paris. Correctif A9 : un réglage à 30 ou
   31 ne se déclenchait jamais les mois plus courts — avec « 31 », cinq mois
   sur douze étaient perdus, en silence. Le dernier jour du mois vaut désormais
   le jour réglé. */
function dernierJourDuMois(annee: number, mois: number): number {
  const bis = (annee % 4 === 0 && annee % 100 !== 0) || annee % 400 === 0;
  return [31, bis ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mois - 1];
}

/* Le mois PRÉCÉDENT celui qu'on est en train de vivre : c'est lui qu'on
   rappelle de clôturer, plus les éventuels retards antérieurs. */
function moisPrecedent(annee: number, mois: number) {
  return mois === 1 ? { annee: annee - 1, mois: 12 } : { annee, mois: mois - 1 };
}

/* CORRECTIF A7 DE LA RELECTURE PR9 — LA FONCTION ÉTAIT OUVERTE.

   `Deno.serve(async () => …)` ne regardait ni la méthode, ni un en-tête, ni un
   jeton. N'importe quelle requête atteignant ce point déclenchait la boucle
   complète, pour TOUTES les utilisatrices. Et la façon dont le planificateur
   s'authentifie n'était écrite nulle part dans le dépôt.

   Le contrôle ÉCHOUE FERMÉ : sans secret configuré, la fonction refuse tout.
   C'est volontaire. Une fonction ouverte qui « marche » est pire qu'une
   fonction qui refuse en disant pourquoi — la première ne se remarque jamais.
   Le secret se pose comme les clés VAPID, dans les secrets de la fonction, et
   la commande de planification doit le présenter :

     select cron.schedule('rappels-cloture', '0 * * * *', $$
       select net.http_post(
         url    := '<URL DE LA FONCTION>',
         headers := jsonb_build_object(
           'Content-Type',      'application/json',
           'x-rappels-secret',  '<LE SECRET>')
       );
     $$);
*/
const SECRET_APPEL = Deno.env.get('RAPPELS_SECRET') ?? '';

Deno.serve(async (requete: Request) => {
  if (!SECRET_APPEL) {
    return new Response(JSON.stringify({
      erreur: 'RAPPELS_SECRET n’est pas configuré : la fonction refuse de ' +
              's’exécuter tant qu’elle n’est pas protégée.'
    }), { status: 503, headers: { 'Content-Type': 'application/json' } });
  }
  if (requete.method !== 'POST') {
    return new Response(JSON.stringify({ erreur: 'méthode non autorisée' }),
      { status: 405, headers: { 'Content-Type': 'application/json' } });
  }
  if (requete.headers.get('x-rappels-secret') !== SECRET_APPEL) {
    return new Response(JSON.stringify({ erreur: 'appel non autorisé' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  const client = createClient(URL_SUPABASE, CLE_SERVICE);
  const now = maintenantAParis();

  /* Les réglages dont l'heure correspond à l'heure courante à Paris, et dont
     le jour du mois est atteint. `chaque_jour_ensuite` décide si le rappel se
     répète les jours suivants. */
  const { data: preferences, error: errPref } = await client
    .from('preference_rappel')
    .select('owner, actif, jour_du_mois, heure, chaque_jour_ensuite, dernier_envoi_le')
    .eq('actif', true);
  if (errPref) return new Response(JSON.stringify({ erreur: errPref.message }), { status: 500 });

  let envoyees = 0;
  let ignorees = 0;
  let dejaFaites = 0;
  let abonnementsRetires = 0;

  for (const pref of preferences ?? []) {
    const heureReglee = Number(String(pref.heure).slice(0, 2));
    if (heureReglee !== now.heure) continue;

    /* CORRECTIF A6 — UNE TRACE D'ENVOI.
       Le seul garde-fou contre l'envoi en boucle était l'égalité des heures,
       qui suppose exactement une exécution par heure. Deux invocations la même
       heure donnaient deux notifications. */
    if (pref.dernier_envoi_le === now.iso) { dejaFaites++; continue; }

    /* A1 — AUCUNE NOTIFICATION SI RIEN N'EST À CLÔTURER. Un rappel qui arrive
       alors que tout est fait apprend à Maria à ignorer les rappels, et le
       jour où il compte vraiment il ne sera plus lu. */
    const compte = await moisAClôturer(client, pref.owner, now);
    const nb = compte.total;
    if (nb === 0) { ignorees++; continue; }

    /* CORRECTIF B9 DE LA RELECTURE PR9 — TRENTE ET UN JOURS DE SILENCE.

       Deux règles se combinaient mal. Le comptage démarrait au mois PRÉCÉDENT,
       donc le mois courant n'était jamais compté, même après la bascule du 25.
       Et l'envoi ne démarrait qu'au `jour_du_mois`, en se réinitialisant le 1ᵉʳ.

       Résultat, avec le réglage par défaut : le 25 août, la pastille affichait
       « 1 mois à clôturer » (août) et le serveur trouvait 0. Du 1ᵉʳ au
       24 septembre, août était EN RETARD, la pastille l'affichait, et le
       serveur passait son chemin parce que le jour réglé n'était pas atteint.
       Premier rappel : le 25 septembre. Trente et un jours après que le mois
       soit devenu clôturable.

       Deux corrections, l'une dans le comptage (le mois courant compte dès la
       bascule, voir `moisAClôturer`), l'autre ici : UN MOIS EN RETARD N'ATTEND
       PAS LE JOUR RÉGLÉ. V8-03 dit « les mois passés non clôturés sont
       rappelés EN PERMANENCE » ; c'est la même règle que celle de l'accueil.

       `chaque_jour_ensuite` décoché reste respecté à la lettre : Maria a
       demandé un seul rappel par mois, elle en aura un seul. */
    const jourReglé = Math.min(pref.jour_du_mois, dernierJourDuMois(now.annee, now.mois));
    const jourAtteint = now.jour >= jourReglé;

    if (!pref.chaque_jour_ensuite) {
      if (now.jour !== jourReglé) continue;
    } else if (!jourAtteint && compte.retards === 0) {
      continue;
    }

    const { data: abonnements } = await client
      .from('abonnement_push')
      .select('id, endpoint, cle_p256dh, cle_auth')
      .eq('owner', pref.owner);

    /* A3 — CE TEXTE EST EXACTEMENT CELUI DE L'APERÇU affiché dans les
       réglages. Les deux sont construits par la même formule, dupliquée ici
       et dans js/ui-menu.js faute de pouvoir partager du code entre le
       navigateur et Deno. Toute modification doit être faite AUX DEUX
       ENDROITS — le test de fumée du lot 15 compare les deux chaînes. */
    const corps = nb === 1
      ? 'Il vous reste 1 mois à clôturer.'
      : `Il vous reste ${nb} mois à clôturer.`;
    const charge = JSON.stringify({ titre: 'Récap', corps });

    let envoyeesPourCePref = 0;
    for (const ab of abonnements ?? []) {
      try {
        await webpush.sendNotification({
          endpoint: ab.endpoint,
          keys: { p256dh: ab.cle_p256dh, auth: ab.cle_auth }
        }, charge);
        envoyees++;
        envoyeesPourCePref++;
      } catch (e) {
        /* A6 — UN ABONNEMENT REJETÉ EST SUPPRIMÉ. 404 et 410 signifient que
           l'appareil n'existe plus : téléphone changé, application
           désinstallée. Le garder ferait échouer chaque envoi, tous les
           jours, pour toujours. C'est le seul cas de suppression automatique
           du projet, et il ne porte aucune donnée métier. */
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) {
          await client.from('abonnement_push').delete().eq('id', ab.id);
          abonnementsRetires++;
        }
        /* Tout autre échec — réseau, service indisponible — n'entraîne AUCUNE
           suppression : l'abonnement est probablement valide, et le rappel
           repartira à la prochaine exécution. */
      }
    }

    /* A6 — la trace n'est posée QUE si au moins une notification est partie.
       Une exécution qui n'envoie rien ne doit pas consommer le rappel du
       jour : sinon un incident du service d'envoi le ferait perdre
       définitivement, exactement le défaut qu'on corrige. */
    if (envoyeesPourCePref > 0) {
      await client.from('preference_rappel')
        .update({ dernier_envoi_le: now.iso })
        .eq('owner', pref.owner);
    }
  }

  return new Response(JSON.stringify({
    heure_paris: now.heure, jour: now.jour, date_paris: now.iso,
    envoyees, ignorees, deja_faites: dejaFaites,
    abonnements_retires: abonnementsRetires
  }), { headers: { 'Content-Type': 'application/json' } });
});

/* Combien de mois cette utilisatrice a-t-elle à clôturer ?

   On ne recalcule RIEN ici : un mois est « à clôturer » s'il est échu, s'il
   entre dans la période d'un contrat, et s'il n'a pas de récapitulatif figé.
   Le calcul des montants ne regarde pas cette fonction — elle compte, elle
   n'additionne pas. */
async function moisAClôturer(
  client: ReturnType<typeof createClient>,
  owner: string,
  now: { annee: number; mois: number; jour: number }
): Promise<{ total: number; retards: number }> {
  const { data: contrats } = await client
    .from('contrat')
    .select('id, date_debut, date_fin')
    .eq('owner', owner)
    .eq('archive', false);
  if (!contrats?.length) return { total: 0, retards: 0 };

  const { data: recaps } = await client
    .from('recap_mensuel')
    .select('contrat_id, annee, mois, statut')
    .eq('owner', owner)
    .eq('statut', 'fige');

  const figes = new Set((recaps ?? []).map((r) => `${r.contrat_id}|${r.annee}-${r.mois}`));

  /* CORRECTIF B9 — LE MOIS COURANT COMPTE DÈS LA BASCULE DU 25.

     Le comptage démarrait au mois PRÉCÉDENT, toujours. Le serveur ne pouvait
     donc jamais parler du mois qu'on est en train de finir, même le 30 du
     mois, alors que la pastille de l'accueil l'annonçait depuis cinq jours.
     Le commentaire de `ui-accueil.js` affirmait que les deux comptaient
     « exactement » la même chose : c'était faux.

     `JOUR_BASCULE_CLOTURE` vaut 25 dans `ui-kit.js` (V8-03). La valeur est
     dupliquée ici faute de pouvoir partager du code entre le navigateur et
     Deno — comme le texte du rappel, et pour la même raison. */
  const JOUR_BASCULE_CLOTURE = 25;

  /* On regarde les DOUZE derniers mois échus : au-delà, un retard n'est plus
     un oubli, c'est autre chose, et un rappel n'y changera rien. */
  let compte = 0;
  let retards = 0;
  const debut = now.jour >= JOUR_BASCULE_CLOTURE
    ? { annee: now.annee, mois: now.mois }
    : moisPrecedent(now.annee, now.mois);
  let curseur = debut;
  for (let i = 0; i < 13; i++) {
    const premier = `${curseur.annee}-${String(curseur.mois).padStart(2, '0')}-01`;
    const dernier = `${curseur.annee}-${String(curseur.mois).padStart(2, '0')}-31`;
    /* « En retard » = strictement antérieur au mois courant. C'est cette
       distinction qui permet de rappeler un retard sans attendre le jour
       réglé, tout en n'insistant pas sur le mois qu'on vient d'entamer. */
    const enRetard = curseur.annee * 12 + curseur.mois < now.annee * 12 + now.mois;
    for (const c of contrats) {
      if (c.date_debut > dernier) continue;
      if (c.date_fin && c.date_fin < premier) continue;
      if (!figes.has(`${c.id}|${curseur.annee}-${curseur.mois}`)) {
        compte++;
        if (enRetard) retards++;
      }
    }
    curseur = moisPrecedent(curseur.annee, curseur.mois);
  }
  return { total: compte, retards: retards };
}
