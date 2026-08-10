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
function maintenantAParis(): { jour: number; heure: number; annee: number; mois: number } {
  const f = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', hour12: false
  });
  const p: Record<string, string> = {};
  for (const part of f.formatToParts(new Date())) p[part.type] = part.value;
  return {
    annee: Number(p.year), mois: Number(p.month),
    jour: Number(p.day), heure: Number(p.hour)
  };
}

/* Le mois PRÉCÉDENT celui qu'on est en train de vivre : c'est lui qu'on
   rappelle de clôturer, plus les éventuels retards antérieurs. */
function moisPrecedent(annee: number, mois: number) {
  return mois === 1 ? { annee: annee - 1, mois: 12 } : { annee, mois: mois - 1 };
}

Deno.serve(async () => {
  const client = createClient(URL_SUPABASE, CLE_SERVICE);
  const now = maintenantAParis();

  /* Les réglages dont l'heure correspond à l'heure courante à Paris, et dont
     le jour du mois est atteint. `chaque_jour_ensuite` décide si le rappel se
     répète les jours suivants. */
  const { data: preferences, error: errPref } = await client
    .from('preference_rappel')
    .select('owner, actif, jour_du_mois, heure, chaque_jour_ensuite')
    .eq('actif', true);
  if (errPref) return new Response(JSON.stringify({ erreur: errPref.message }), { status: 500 });

  let envoyees = 0;
  let ignorees = 0;
  let abonnementsRetires = 0;

  for (const pref of preferences ?? []) {
    const heureReglee = Number(String(pref.heure).slice(0, 2));
    if (heureReglee !== now.heure) continue;
    if (now.jour < pref.jour_du_mois) continue;
    if (now.jour > pref.jour_du_mois && !pref.chaque_jour_ensuite) continue;

    /* A1 — AUCUNE NOTIFICATION SI RIEN N'EST À CLÔTURER. Un rappel qui arrive
       alors que tout est fait apprend à Maria à ignorer les rappels, et le
       jour où il compte vraiment il ne sera plus lu. */
    const nb = await moisAClôturer(client, pref.owner, now);
    if (nb === 0) { ignorees++; continue; }

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

    for (const ab of abonnements ?? []) {
      try {
        await webpush.sendNotification({
          endpoint: ab.endpoint,
          keys: { p256dh: ab.cle_p256dh, auth: ab.cle_auth }
        }, charge);
        envoyees++;
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
  }

  return new Response(JSON.stringify({
    heure_paris: now.heure, jour: now.jour,
    envoyees, ignorees, abonnements_retires: abonnementsRetires
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
): Promise<number> {
  const { data: contrats } = await client
    .from('contrat')
    .select('id, date_debut, date_fin')
    .eq('owner', owner)
    .eq('archive', false);
  if (!contrats?.length) return 0;

  const { data: recaps } = await client
    .from('recap_mensuel')
    .select('contrat_id, annee, mois, statut')
    .eq('owner', owner)
    .eq('statut', 'fige');

  const figes = new Set((recaps ?? []).map((r) => `${r.contrat_id}|${r.annee}-${r.mois}`));

  /* On regarde les DOUZE derniers mois échus : au-delà, un retard n'est plus
     un oubli, c'est autre chose, et un rappel n'y changera rien. */
  let compte = 0;
  let curseur = moisPrecedent(now.annee, now.mois);
  for (let i = 0; i < 12; i++) {
    const premier = `${curseur.annee}-${String(curseur.mois).padStart(2, '0')}-01`;
    const dernier = `${curseur.annee}-${String(curseur.mois).padStart(2, '0')}-31`;
    for (const c of contrats) {
      if (c.date_debut > dernier) continue;
      if (c.date_fin && c.date_fin < premier) continue;
      if (!figes.has(`${c.id}|${curseur.annee}-${curseur.mois}`)) compte++;
    }
    curseur = moisPrecedent(curseur.annee, curseur.mois);
  }
  return compte;
}
