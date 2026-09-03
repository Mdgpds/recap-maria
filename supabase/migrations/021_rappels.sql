-- ============================================================================
-- 021_rappels.sql — Les rappels, remis d'aplomb (lot 32, §9 et §10).
--
-- NUMÉRO : `main` porte 001 à 020, suite continue. Celle-ci est la SEULE
-- migration du lot, et elle prend le numéro suivant.
--
-- CE QU'ELLE FAIT, ET RIEN D'AUTRE :
--   1. `preference_rappel.quoi` — ce que Maria veut qu'on lui rappelle : le
--      mois à clôturer, les journées non déclarées, ou les deux. Défaut « les
--      deux » : la ligne existante (une seule, `actif = false`, réglée au 25 à
--      19 h) devient utilisable telle quelle, sans être dupliquée.
--   2. `preference_rappel.actif` — remis à `false` là où aucun appareil n'est
--      abonné : « actif » veut dire « un abonnement enregistré », et la table
--      `abonnement_push` est vide en production. Une préférence active sans
--      appareil est exactement la ligne « inutilisable » du §9.3.
--   3. Un index sur `abonnement_push (owner, cree_le)` : la fonction lit les
--      abonnements par utilisatrice à chaque exécution.
--   4. Les policies, ré-affirmées : `revoke all` puis une policy explicite par
--      opération, `owner = auth.uid()`. JAMAIS `using (true)`. Idempotent.
--
-- CE QUI N'EST PAS ICI, ET NE DOIT JAMAIS Y ÊTRE : aucune clé VAPID, aucun
-- secret d'appel. Ils vivent dans les secrets de la fonction Supabase.
--
-- ORDRE DE MISE EN PRODUCTION : ce SQL d'abord, la fusion ensuite (§0.3).
-- Sans lui, `db.js` lit une colonne `quoi` qui n'existe pas, et l'écran des
-- rappels tombe en panne de lecture.
--
-- Exécution : à la main, dans l'éditeur SQL de Supabase. Rejouable sans
-- effet : « if not exists » partout, `drop policy if exists` avant chaque
-- `create policy`.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Ce que Maria veut qu'on lui rappelle
-- ----------------------------------------------------------------------------
alter table public.preference_rappel
  add column if not exists quoi text not null default 'les_deux'
  check (quoi in ('cloture', 'journees', 'les_deux'));

comment on column public.preference_rappel.quoi is
  'Ce que le rappel annonce : ''cloture'' (le mois à clôturer), ''journees'' '
  '(les journées de familiarisation non déclarées) ou ''les_deux''. Lot 32 §9.3.';

-- ----------------------------------------------------------------------------
-- 2. La ligne existante, remise d'aplomb — pas dupliquée
-- ----------------------------------------------------------------------------
-- « actif » signifie « au moins un appareil abonné ». Une préférence active
-- sans abonnement promettrait un rappel qui ne partira jamais.
update public.preference_rappel p
   set actif = false
 where p.actif = true
   and not exists (select 1 from public.abonnement_push a where a.owner = p.owner);

-- Les valeurs hors bornes de l'écran (jour < 20, heure hors 7 h – 22 h ou
-- non ronde) sont ramenées aux défauts : l'écran ne sait pas les afficher.
update public.preference_rappel
   set jour_du_mois = 25
 where jour_du_mois is null or jour_du_mois < 20 or jour_du_mois > 31;

update public.preference_rappel
   set heure = '19:00'
 where heure is null
    or extract(hour from heure) < 7
    or extract(hour from heure) > 22
    or extract(minute from heure) <> 0;

-- ----------------------------------------------------------------------------
-- 3. L'index de lecture de la fonction
-- ----------------------------------------------------------------------------
create index if not exists abonnement_push_owner_cree_idx
  on public.abonnement_push (owner, cree_le);

-- ----------------------------------------------------------------------------
-- 4. Les policies — modèle exact de 002_rls.sql, ré-affirmé
-- ----------------------------------------------------------------------------
alter table public.preference_rappel enable row level security;
alter table public.abonnement_push   enable row level security;

revoke all on public.preference_rappel from anon, authenticated, public;
revoke all on public.abonnement_push   from anon, authenticated, public;

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

-- ----------------------------------------------------------------------------
-- Contrôle, à lire juste après : une ligne, `quoi = les_deux`, `actif = false`.
-- ----------------------------------------------------------------------------
-- select owner, actif, jour_du_mois, heure, chaque_jour_ensuite, quoi
--   from public.preference_rappel;
