-- ============================================================================
-- 011_rappels.sql — Rappels par notification (lot 15).
--
-- NUMÉRO : la spécification attribuait `010`. Ce numéro a été pris par le
-- lot 14 (`010_mise_en_service.sql`). C'est le dernier décalage : la série
-- s'arrête ici.
--
-- LE SEUL LOT DU PROJET QUI AJOUTE UNE BRIQUE SERVEUR.
--
-- Une notification à heure fixe ne peut PAS être programmée depuis le
-- téléphone. Un minuteur JavaScript ne s'exécute que si l'application est
-- ouverte : le rappel n'arriverait jamais, et personne ne s'en apercevrait —
-- c'est le risque n° 1 de la spécification, et le plus vicieux, parce qu'il
-- ne produit aucune erreur. Il faut donc un service qui ENVOIE, côté serveur.
--
-- Deux tables :
--   * `preference_rappel` — ce que Maria a réglé. Une ligne par utilisatrice.
--   * `abonnement_push`   — les appareils sur lesquels elle a accepté les
--                           notifications. Plusieurs par utilisatrice : un
--                           téléphone, une tablette.
--
-- CE QUI N'EST PAS ICI, ET NE DOIT JAMAIS Y ÊTRE : les clés de signature VAPID.
-- Elles vivent dans les secrets de la fonction Supabase. Une clé privée
-- committée dans un dépôt PUBLIC est irrécupérable — elle reste dans
-- l'historique git même après suppression (risque n° 2, A4).
--
-- Conventions inchangées : « if not exists » partout, RLS explicite sur le
-- modèle de 002_rls.sql, jamais de `using (true)`.
-- ============================================================================

create table if not exists public.preference_rappel (
  owner               uuid primary key default auth.uid(),
  actif               boolean not null default false,
  jour_du_mois        int not null default 25 check (jour_du_mois between 20 and 31),
  heure               time not null default '19:00',
  chaque_jour_ensuite boolean not null default true,
  maj_le              timestamptz not null default now()
);

-- Pourquoi `jour_du_mois` est borné entre 20 et 31 : avant le 20, un mois n'est
-- pas assez avancé pour être clôturé — le lot 7 ne le propose qu'à partir du
-- 25. Un rappel le 3 du mois ne servirait qu'à apprendre à Maria à ignorer les
-- rappels.

create table if not exists public.abonnement_push (
  id         uuid primary key default gen_random_uuid(),
  owner      uuid not null default auth.uid(),
  endpoint   text not null unique,
  cle_p256dh text not null,
  cle_auth   text not null,
  cree_le    timestamptz not null default now()
);

create index if not exists abonnement_push_owner_idx on public.abonnement_push (owner);

-- `maj_le` tenu par la base, comme pour les notes (migration 009).
create or replace function public.toucher_preference_rappel()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.maj_le := now();
  return new;
end;
$$;

drop trigger if exists preference_rappel_maj_le on public.preference_rappel;
create trigger preference_rappel_maj_le
  before update on public.preference_rappel
  for each row execute function public.toucher_preference_rappel();

-- ----------------------------------------------------------------------------
-- RLS — modèle exact de 002_rls.sql
--
-- `abonnement_push` a bien une policy `delete`, et c'est le SEUL cas de
-- suppression automatique autorisé du projet (§15.4) : un abonnement rejeté
-- par le service de notification — téléphone changé, application désinstallée
-- — est retiré. Il ne porte aucune donnée métier : ni un chiffre, ni une
-- preuve, juste l'adresse technique d'un appareil qui n'existe plus.
-- ----------------------------------------------------------------------------

alter table public.preference_rappel enable row level security;
alter table public.abonnement_push   enable row level security;

revoke all on public.preference_rappel from anon, authenticated, public;
revoke all on public.abonnement_push   from anon, authenticated, public;

-- `update` sur `abonnement_push` : indispensable, et non évident.
--
-- Le navigateur peut rendre LE MÊME `endpoint` à un nouvel abonnement — même
-- appareil, application rouverte, permission redonnée — avec des clés
-- renouvelées. La couche de données écrit donc l'abonnement en `upsert` sur
-- `endpoint`, ce que PostgreSQL exécute en `insert … on conflict do update`.
-- Sans droit d'`update`, ce chemin échoue par « permission denied » dès le
-- deuxième abonnement du même téléphone : Maria verrait « l'abonnement n'a pas
-- abouti » sans qu'aucun défaut ne soit visible côté application.
-- Vérifié en exécution réelle, `set role authenticated` posé.
grant select, insert, update on public.preference_rappel to authenticated;
grant select, insert, update, delete on public.abonnement_push to authenticated;

drop policy if exists preference_rappel_select on public.preference_rappel;
create policy preference_rappel_select on public.preference_rappel
  for select to authenticated using (owner = (select auth.uid()));
drop policy if exists preference_rappel_insert on public.preference_rappel;
create policy preference_rappel_insert on public.preference_rappel
  for insert to authenticated with check (owner = (select auth.uid()));
drop policy if exists preference_rappel_update on public.preference_rappel;
create policy preference_rappel_update on public.preference_rappel
  for update to authenticated using (owner = (select auth.uid()))
                                with check (owner = (select auth.uid()));

drop policy if exists abonnement_push_select on public.abonnement_push;
create policy abonnement_push_select on public.abonnement_push
  for select to authenticated using (owner = (select auth.uid()));
drop policy if exists abonnement_push_insert on public.abonnement_push;
create policy abonnement_push_insert on public.abonnement_push
  for insert to authenticated with check (owner = (select auth.uid()));
drop policy if exists abonnement_push_update on public.abonnement_push;
create policy abonnement_push_update on public.abonnement_push
  for update to authenticated using (owner = (select auth.uid()))
                                with check (owner = (select auth.uid()));
drop policy if exists abonnement_push_delete on public.abonnement_push;
create policy abonnement_push_delete on public.abonnement_push
  for delete to authenticated using (owner = (select auth.uid()));

comment on table public.preference_rappel is
  'Réglage des rappels de clôture : à partir de quel jour du mois, à quelle '
  'heure, et faut-il répéter chaque jour. Une ligne par utilisatrice.';

comment on table public.abonnement_push is
  'Appareils sur lesquels l''utilisatrice a accepté les notifications. Un '
  'abonnement rejeté par le service de notification est SUPPRIMÉ : seul cas de '
  'suppression automatique du projet, et il ne porte aucune donnée métier — '
  'juste l''adresse technique d''un appareil qui n''existe plus.';
