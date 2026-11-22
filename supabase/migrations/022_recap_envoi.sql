-- ============================================================================
-- 022_recap_envoi.sql — Ce qu'on garde d'un récap envoyé aux parents (lot 33).
--
-- NUMÉRO : `main` porte 001 à 021, suite continue. Celle-ci est la SEULE
-- migration du lot 33, et elle prend le numéro suivant. Elle NE DÉPEND PAS de
-- 021 (les rappels) : elle se colle et s'exécute que 021 ait été appliquée ou
-- non.
--
-- POURQUOI. Dès le 25, Maria peut envoyer aux parents un récap PRÉVISIONNEL ;
-- le dernier jour, l'application doit pouvoir dire ce qui a changé depuis cet
-- envoi. Il faut donc savoir ce qui est parti. Aucune copie n'en était gardée :
-- `recap_mensuel.transmis_le` n'est qu'un horodatage, unique, sur un mois qui
-- doit exister en base.
--
-- CE QU'ELLE FAIT, ET RIEN D'AUTRE :
--   1. la table `recap_envoi` : UNE LIGNE PAR ENVOI — le contrat, l'année, le
--      mois, l'instant, la nature (`previsionnel` ou `definitif`) et les
--      données de l'image telle qu'elle est partie (chaque ligne affichée, en
--      centimes et en minutes entiers, plus l'état de chaque journée du mois
--      à cet instant), en `jsonb` ;
--   2. un index de lecture (contrat, année, mois, instant) ;
--   3. l'exposition et la Row Level Security, modèle exact de 002_rls.sql :
--      `revoke all`, puis une policy explicite par opération autorisée,
--      `owner = auth.uid()`. JAMAIS `using (true)`.
--
-- ELLE NE SE MODIFIE PAS. Un envoi corrigé est une ligne de plus : plusieurs
-- prévisionnels dans un mois sont possibles, la référence du dernier jour est
-- le dernier. Il n'y a donc NI droit NI policy de modification ou de
-- suppression — rien ne les demande. La table ne dépend pas de
-- `recap_mensuel` : un mois en cours peut ne pas y avoir de ligne.
--
-- ORDRE DE MISE EN PRODUCTION : ce SQL d'abord, la fusion ensuite. Sans lui,
-- l'accueil lit une table qui n'existe pas (la ligne « Récap » de la carte ne
-- s'affiche pas) et noter un envoi échoue avec un message.
--
-- Exécution : à la main, dans l'éditeur SQL de Supabase. Rejouable sans
-- effet : « if not exists » partout, `drop policy if exists` avant chaque
-- `create policy`.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. La table
-- ----------------------------------------------------------------------------
create table if not exists public.recap_envoi (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null default auth.uid(),
  contrat_id  uuid not null references public.contrat(id) on delete cascade,
  annee       integer not null check (annee between 2000 and 2100),
  mois        integer not null check (mois between 1 and 12),
  envoye_le   timestamptz not null default now(),
  nature      text not null check (nature in ('previsionnel', 'definitif')),
  donnees     jsonb not null
);

comment on table public.recap_envoi is
  'Un récap court envoyé aux parents (lot 33) : une ligne par envoi, jamais '
  'modifiée. `donnees` garde l''image telle qu''elle est partie : ses lignes '
  'en centimes et minutes entiers, et l''état de chaque journée du mois.';
comment on column public.recap_envoi.nature is
  '''previsionnel'' (envoyé avant la clôture, dès le 25) ou ''definitif'' '
  '(envoyé sur le mois clôturé).';

-- ----------------------------------------------------------------------------
-- 2. L'index de lecture : l'accueil lit les envois du mois de TOUS les
--    contrats en une requête ; l'écran du mois lit ceux d'un contrat.
-- ----------------------------------------------------------------------------
create index if not exists recap_envoi_contrat_mois_idx
  on public.recap_envoi (contrat_id, annee, mois, envoye_le);

-- ----------------------------------------------------------------------------
-- 3. Exposition explicite et Row Level Security (modèle exact de 002_rls.sql)
-- ----------------------------------------------------------------------------
revoke all on public.recap_envoi from anon, authenticated, public;
grant select, insert on public.recap_envoi to authenticated;
alter table public.recap_envoi enable row level security;

drop policy if exists recap_envoi_select on public.recap_envoi;
create policy recap_envoi_select on public.recap_envoi
  for select to authenticated using (owner = (select auth.uid()));

-- L'insertion exige AUSSI que le contrat appartienne à la même utilisatrice :
-- la clé étrangère seule ne le vérifie pas (elle ne passe pas par la RLS).
drop policy if exists recap_envoi_insert on public.recap_envoi;
create policy recap_envoi_insert on public.recap_envoi
  for insert to authenticated with check (
    owner = (select auth.uid())
    and exists (
      select 1 from public.contrat c
       where c.id = contrat_id and c.owner = (select auth.uid())
    )
  );

-- Aucune policy `update` ni `delete` : un envoi ne se modifie pas et ne
-- s'efface pas. Sans droit ni policy, la base refuse les deux.

-- ----------------------------------------------------------------------------
-- Contrôle, à lire juste après : la table existe, la RLS est active, deux
-- policies (select, insert), aucune ligne.
-- ----------------------------------------------------------------------------
-- select relrowsecurity from pg_class where oid = 'public.recap_envoi'::regclass;
-- select policyname, cmd from pg_policies where tablename = 'recap_envoi';
-- select count(*) from public.recap_envoi;
