-- ============================================================================
-- 004_moteur_flexibilite.sql — Lot 9.
--
-- Deux objets, aucun écran :
--   1. Flexibilité au niveau de la JOURNÉE : minutes supplémentaires
--      exceptionnelles, renoncement explicite, surcharge de RG-09 (V8-18,
--      V8-19).
--   2. Imputation CHOISIE d'une période de congé (V8-07) : RG-07 cesse d'être
--      une fatalité et devient une valeur par défaut proposée, surchargeable
--      période par période.
--
-- L'imputation est stockée PAR PÉRIODE et par contrat, jamais portée par le
-- récapitulatif mensuel : une période de congé peut être à cheval sur deux
-- mois (28 juillet -> 4 août) et le décompte en jours ouvrables (RG-06) porte
-- sur la période ENTIÈRE — une semaine du lundi au vendredi compte 6 jours,
-- samedi inclus. Un décompte n'est pas sécable ; une imputation portée par le
-- récap mensuel serait donc indéfinissable pour une période à cheval.
--
-- Conventions reprises de 001_schema.sql et 002_rls.sql :
--   owner uuid not null default auth.uid(), RLS activée, revoke all puis
--   policies explicites par opération, jamais de using (true).
--   « if not exists » / « drop … if exists » partout : recollage sans erreur
--   en cas d'application manuelle répétée.
--
-- Unités : temps en minutes entières, congés payés en dixièmes de jour,
-- dates en type `date` pur. Aucun numeric, aucun float, aucun timestamp pour
-- un jour de garde.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Extension requise par la contrainte d'exclusion (§3.2 de la spec)
--
-- btree_gist permet de mêler une égalité (contrat_id) et un chevauchement de
-- plage (daterange) dans une même contrainte d'exclusion. Sur un projet
-- Supabase, les extensions vivent dans le schéma `extensions` ; le bloc
-- ci-dessous retombe sur le schéma courant si ce schéma n'existe pas.
--
-- SI CETTE ÉTAPE ÉCHOUE : ne pas la remplacer par une vérification côté
-- application. Un chevauchement d'imputations produit un double décompte de
-- congés, invisible et impossible à retrouver après coup. Arrêter et le
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

-- La classe d'opérateurs gist_int4_ops / la fonction && doivent être visibles
-- au moment du create table ci-dessous.
set search_path = public, extensions;

-- ----------------------------------------------------------------------------
-- 1. Flexibilité au niveau de la journée (V8-18, V8-19)
-- ----------------------------------------------------------------------------

alter table public.journee
  add column if not exists minutes_sup_exceptionnelles int not null default 0,
  add column if not exists minutes_sup_renoncees      int not null default 0,
  add column if not exists sup_dues_override          boolean;

comment on column public.journee.minutes_sup_exceptionnelles is
  'Minutes travaillées AU-DELÀ des minutes du contrat ce jour-là (V8-18). '
  'Entier positif, en minutes. 0 = rien d''exceptionnel.';

comment on column public.journee.minutes_sup_renoncees is
  'Minutes auxquelles Maria renonce explicitement ce jour-là (V8-18). '
  'Entier positif, en minutes. Le moteur ne laisse jamais le résultat '
  'devenir négatif : on ne renonce pas à plus que ce qui est dû.';

comment on column public.journee.sup_dues_override is
  'Surcharge de contrat.sup_dues_si_enfant_absent pour CETTE SEULE journée '
  '(RG-09, V8-19). null = suivre le réglage du contrat — c''est le cas par '
  'défaut et le seul moyen de distinguer « non renseigné » de « explicitement '
  'faux ». Ne jamais remplacer ce null par false.';

-- Garde-fous de saisie. Le plafond de 720 minutes (12 h) n'est pas une règle
-- métier : il empêche une faute de frappe de produire un compteur aberrant.
-- « add constraint if not exists » n'existe pas en Postgres : on teste.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'journee_minutes_positives'
      and conrelid = 'public.journee'::regclass
  ) then
    alter table public.journee
      add constraint journee_minutes_positives
        check (minutes_sup_exceptionnelles >= 0 and minutes_sup_renoncees >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'journee_minutes_plafond'
      and conrelid = 'public.journee'::regclass
  ) then
    alter table public.journee
      add constraint journee_minutes_plafond
        check (minutes_sup_exceptionnelles <= 720 and minutes_sup_renoncees <= 720);
  end if;
end
$$;

-- ----------------------------------------------------------------------------
-- 2. Imputation choisie d'une période de congé (V8-07)
-- ----------------------------------------------------------------------------

create table if not exists public.imputation_conge (
  id               uuid primary key default gen_random_uuid(),
  owner            uuid not null default auth.uid(),
  contrat_id       uuid not null references public.contrat(id) on delete cascade,
  date_debut       date not null,
  date_fin         date not null,
  jours_ouvrables  int  not null,
  jours_sur_cp     int  not null default 0,
  jours_sur_sup    int  not null default 0,
  jours_sans_solde int  not null default 0,
  cree_le          timestamptz not null default now(),

  constraint imputation_periode_valide
    check (date_fin >= date_debut),
  constraint imputation_positive
    check (jours_ouvrables > 0 and jours_sur_cp >= 0
           and jours_sur_sup >= 0 and jours_sans_solde >= 0),
  -- La ventilation couvre EXACTEMENT le décompte de la période (V8-07,
  -- « reste à répartir » bloquant côté écran, lot 10).
  constraint imputation_complete
    check (jours_sur_cp + jours_sur_sup + jours_sans_solde = jours_ouvrables),
  -- Deux périodes de congé d'un même contrat ne peuvent pas se chevaucher :
  -- un chevauchement produirait un double décompte, invisible.
  constraint imputation_sans_chevauchement
    exclude using gist (
      contrat_id with =,
      daterange(date_debut, date_fin, '[]') with &&
    )
);

comment on table public.imputation_conge is
  'Ventilation choisie d''une période de congé (V8-07). Une ligne = une '
  'période continue de congé pour UN contrat, avec son décompte RG-06 en '
  'jours ouvrables (samedi inclus) et sa répartition entre congés payés, '
  'récupération et sans solde. Portée par la période et non par le mois : '
  'une période à cheval sur deux mois garde un décompte unique et insécable.';

comment on column public.imputation_conge.jours_ouvrables is
  'Décompte RG-06 de la période ENTIÈRE : du premier jour d''absence au '
  'dernier jour ouvrable avant la reprise, dimanches et fériés exclus, '
  'samedi inclus. Jamais recalculé mois par mois.';

create index if not exists imputation_conge_contrat_dates
  on public.imputation_conge (contrat_id, date_debut, date_fin);

-- ----------------------------------------------------------------------------
-- 3. Exposition explicite et Row Level Security (modèle exact de 002_rls.sql)
-- ----------------------------------------------------------------------------

revoke all on public.imputation_conge from anon, authenticated, public;
grant select, insert, update, delete on public.imputation_conge to authenticated;
alter table public.imputation_conge enable row level security;

drop policy if exists imputation_conge_select on public.imputation_conge;
create policy imputation_conge_select on public.imputation_conge
  for select to authenticated using (owner = (select auth.uid()));

drop policy if exists imputation_conge_insert on public.imputation_conge;
create policy imputation_conge_insert on public.imputation_conge
  for insert to authenticated with check (owner = (select auth.uid()));

drop policy if exists imputation_conge_update on public.imputation_conge;
create policy imputation_conge_update on public.imputation_conge
  for update to authenticated
  using (owner = (select auth.uid())) with check (owner = (select auth.uid()));

drop policy if exists imputation_conge_delete on public.imputation_conge;
create policy imputation_conge_delete on public.imputation_conge
  for delete to authenticated using (owner = (select auth.uid()));
