-- ============================================================================
-- 016 — LA FAMILIARISATION DEVIENT UNE PÉRIODE (§20.1 à §20.3 du lot 20).
--
-- CE QUE CETTE MIGRATION CHANGE, ET POURQUOI.
--
-- Depuis la migration `001`, l'application connaît la familiarisation comme un
-- simple TYPE DE JOURNÉE : `journee.type = 'familiarisation'`, avec une
-- colonne `minutes_reelles` que rien ne payait. Le moteur comptait ces
-- journées, ne les rémunérait pas, et — plus grave — les faisait perdre les
-- 2,5 jours de congés payés du mois (RG-11).
--
-- Le lot 20 en fait une PÉRIODE de premier rang : deux dates posées à la main
-- par Maria, pendant lesquelles la rémunération est HORAIRE et déclarée jour
-- par jour. C'est la période, et non la ligne de journée, qui décide du sort
-- d'un jour : sans elle, un jour non déclaré serait présumé « présence » et
-- paierait une journée mensualisée pleine.
--
-- DEUX OBJETS, ET DEUX SEULEMENT :
--   1. la table `periode_familiarisation` ;
--   2. la colonne `journee.entretien_du`.
--
-- ORDRE DE MISE EN PRODUCTION : CE SQL D'ABORD, LA FUSION ENSUITE. L'inverse
-- déploierait un front qui interroge une table et une colonne inexistantes.
--
-- Unités : dates en type `date` pur, bornes INCLUSES. Aucun timestamp pour un
-- jour de garde, aucun fuseau.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Extension requise par la contrainte d'exclusion
--
-- `btree_gist` est déjà installée par la migration `004` (contrainte
-- d'exclusion de `imputation_conge`). Le bloc est repris à l'identique pour
-- que `016` reste rejouable seule sur une base neuve.
--
-- SI CETTE ÉTAPE ÉCHOUE : ne pas la remplacer par une vérification côté
-- application. Deux périodes de familiarisation qui se chevauchent paieraient
-- deux fois les mêmes minutes, sans que rien ne le signale. Arrêter et le
-- signaler.
-- ----------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'extensions') then
    execute 'create extension if not exists btree_gist with schema extensions';
  else
    execute 'create extension if not exists btree_gist';
  end if;
end
$$;

-- ----------------------------------------------------------------------------
-- 1. La période de familiarisation (§20.2)
-- ----------------------------------------------------------------------------

create table if not exists public.periode_familiarisation (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null default auth.uid(),
  contrat_id  uuid not null references public.contrat(id) on delete cascade,
  date_debut  date not null,
  date_fin    date not null,
  cree_le     timestamptz not null default now(),

  constraint periode_familiarisation_periode_valide
    check (date_fin >= date_debut),

  -- Deux périodes d'un même contrat ne peuvent pas se chevaucher : un
  -- chevauchement ferait payer deux fois les mêmes minutes déclarées, et le
  -- prorata du mois retrancherait deux fois les mêmes jours. Même mécanique
  -- que `imputation_conge` (migration 004), pour la même raison.
  constraint periode_familiarisation_sans_chevauchement
    exclude using gist (
      contrat_id with =,
      daterange(date_debut, date_fin, '[]') with &&
    )
);

comment on table public.periode_familiarisation is
  'Période d''adaptation en début de contrat (RG-14, §20.1). Bornes INCLUSES. '
  'Pendant cette période, la rémunération est horaire : seules les minutes '
  'déclarées sur `journee.minutes_reelles` sont payées, au taux du contrat, '
  'et la part mensualisée du mois est proratisée sur les jours restants. '
  'C''est la PÉRIODE qui décide du sort d''un jour, pas la ligne de journée : '
  'un jour du planning compris dans ses bornes est de la familiarisation, '
  'qu''une ligne existe ou non.';

comment on column public.periode_familiarisation.date_fin is
  'Dernier jour de la période, INCLUS. Une période d''un seul jour a '
  'date_debut = date_fin.';

create index if not exists periode_familiarisation_contrat_dates
  on public.periode_familiarisation (contrat_id, date_debut, date_fin);

-- ----------------------------------------------------------------------------
-- 2. Exposition explicite et Row Level Security (modèle exact de 002_rls.sql)
--
-- `revoke all` d'abord, puis les droits nécessaires et RIEN de plus, puis une
-- policy par opération. Jamais de `using (true)`.
-- ----------------------------------------------------------------------------

revoke all on public.periode_familiarisation from anon, authenticated, public;
grant select, insert, update, delete on public.periode_familiarisation to authenticated;
alter table public.periode_familiarisation enable row level security;

drop policy if exists periode_familiarisation_select on public.periode_familiarisation;
create policy periode_familiarisation_select on public.periode_familiarisation
  for select to authenticated using (owner = (select auth.uid()));

drop policy if exists periode_familiarisation_insert on public.periode_familiarisation;
create policy periode_familiarisation_insert on public.periode_familiarisation
  for insert to authenticated with check (owner = (select auth.uid()));

drop policy if exists periode_familiarisation_update on public.periode_familiarisation;
create policy periode_familiarisation_update on public.periode_familiarisation
  for update to authenticated
  using (owner = (select auth.uid())) with check (owner = (select auth.uid()));

drop policy if exists periode_familiarisation_delete on public.periode_familiarisation;
create policy periode_familiarisation_delete on public.periode_familiarisation
  for delete to authenticated using (owner = (select auth.uid()));

-- ----------------------------------------------------------------------------
-- 3. L'indemnité d'entretien du jour (§20.2 et §20.6)
--
-- `journee.entretien_centimes` existe depuis la migration `001` : c'est la
-- surcharge du MONTANT. `entretien_du` répond à une autre question — l'
-- indemnité est-elle due, oui ou non — et l'emporte sur la première.
--
-- DÉFAUT `true`, ET NOT NULL. Retirer l'indemnité est un CHOIX de Maria, jamais
-- un automatisme (§20.6) : toutes les journées existantes gardent donc leur
-- indemnité, et le calcul de tous les mois passés est strictement inchangé.
-- Un défaut à `false` aurait rejoué des mois clôturés à la baisse.
-- ----------------------------------------------------------------------------

alter table public.journee
  add column if not exists entretien_du boolean not null default true;

comment on column public.journee.entretien_du is
  'L''indemnité d''entretien du jour est-elle due ? (§20.6) Vrai par défaut. '
  'Faux uniquement quand Maria l''a explicitement retirée, et l''écran ne le '
  'propose que sur une journée qui SORT DU CADRE : un écart d''horaire '
  'déclaré (§17.5) ou un jour de familiarisation. La journée reste comptée '
  'présente pour tout le reste — salaire et minutes ne bougent pas. '
  'L''emporte sur `entretien_centimes`, qui ne surcharge que le MONTANT '
  'lorsque l''indemnité est due.';

-- ----------------------------------------------------------------------------
-- 4. Contrôle de bonne fin
--
-- À exécuter après la migration. Trois lignes attendues :
--   periode_familiarisation | t (RLS active) | 4 policies
--   journee.entretien_du    | boolean | not null | default true
-- ----------------------------------------------------------------------------

-- select c.relname, c.relrowsecurity,
--        (select count(*) from pg_policies p
--          where p.schemaname = 'public' and p.tablename = c.relname) as policies
--   from pg_class c join pg_namespace n on n.oid = c.relnamespace
--  where n.nspname = 'public' and c.relname = 'periode_familiarisation';
--
-- select column_name, data_type, is_nullable, column_default
--   from information_schema.columns
--  where table_schema = 'public' and table_name = 'journee'
--    and column_name = 'entretien_du';
