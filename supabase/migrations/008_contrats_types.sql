-- ============================================================================
-- 008_contrats_types.sql — Contrats types (lot 11).
--
-- NUMÉRO : la spécification attribuait `007` à ce lot. Ce numéro a été pris par
-- le lot 8 (`007_identite_contrat.sql`), lui-même décalé parce que `006` a
-- servi aux correctifs de relecture du lot 13. Le décalage se poursuit :
--   lot 12 -> 009, lot 14 -> 010, lot 15 -> 011.
--
-- CE QUE CETTE TABLE EST, ET CE QU'ELLE N'EST PAS.
--
-- Un « contrat type » n'est pas un gabarit qu'on applique. C'est un ÉTAT DES
-- CONDITIONS HABITUELLES de Maria à une date donnée : ses horaires, son
-- entretien, sa rémunération de référence. Les contrats s'y RATTACHENT, et
-- peuvent s'en écarter — un écart est un fait négocié avec une famille, pas
-- une erreur à corriger.
--
-- D'où trois choix qui structurent tout :
--
--   1. Les versions sont DATÉES et ne se remplacent pas. Créer « Conditions
--      2026 » ne supprime pas « Conditions 2025 » et ne modifie aucun contrat.
--      Une nouvelle version se PROPOSE, contrat par contrat (V8-14).
--
--   2. Les anciennes versions ne sont JAMAIS supprimées. Elles expliquent les
--      montants des mois déjà clôturés : RG-15 interdit de recalculer un mois
--      figé, et un document remis à une famille doit rester justifiable des
--      années après. Aucune fonction de suppression n'est exposée, et la
--      policy `delete` est volontairement absente.
--
--   3. La rémunération vit ICI comme RÉFÉRENCE, mais elle ne s'écrit jamais
--      directement sur un contrat : aligner un contrat crée une ligne
--      `salaire_contrat` DATÉE. Écrire le montant en dur sur `contrat`
--      changerait les mois passés — c'est le risque n° 2 de la spécification.
--
-- Conventions inchangées : « if not exists » partout, RLS explicite sur le
-- modèle de 002_rls.sql, jamais de `using (true)`, `owner` posé par défaut en
-- base et jamais transmis par le client.
-- ============================================================================

create table if not exists public.modele_contrat (
  id                        uuid primary key default gen_random_uuid(),
  owner                     uuid not null default auth.uid(),
  nom                       text not null,
  date_effet                date not null,
  jours_planning            smallint[] not null default '{1,2,3,4,5}',
  heure_arrivee             time not null,
  heure_depart              time not null,
  minutes_contractuelles    int  not null,
  minutes_sup_jour          int  not null,
  minutes_par_jour_conge    int  not null,
  entretien_centimes_jour   int  not null,
  brut_mensuel_centimes     int  not null,
  net_mensuel_centimes      int  not null,
  sup_dues_si_enfant_absent boolean not null default true,
  ordre_imputation          text not null default 'cp_puis_sup',
  cree_le                   timestamptz not null default now(),
  unique (owner, nom, date_effet)
);

-- Les mêmes bornes de bon sens que sur `contrat` : un modèle qui porterait
-- zéro minute contractuelle produirait des divisions par zéro dans le moteur
-- le jour où un contrat s'y aligne.
alter table public.modele_contrat drop constraint if exists modele_minutes_positives;
alter table public.modele_contrat add constraint modele_minutes_positives
  check (minutes_contractuelles > 0 and minutes_par_jour_conge > 0);

alter table public.modele_contrat drop constraint if exists modele_montants_non_negatifs;
alter table public.modele_contrat add constraint modele_montants_non_negatifs
  check (minutes_sup_jour >= 0 and entretien_centimes_jour >= 0
     and brut_mensuel_centimes >= 0 and net_mensuel_centimes >= 0);

alter table public.modele_contrat drop constraint if exists modele_ordre_imputation_connu;
alter table public.modele_contrat add constraint modele_ordre_imputation_connu
  check (ordre_imputation in ('cp_puis_sup', 'sup_puis_cp'));

-- Le rattachement d'un contrat à une version.
--
-- `on delete set null` plutôt que `restrict` : la suppression d'une version
-- n'est de toute façon pas exposée (voir plus bas), mais si elle survenait par
-- la console d'administration, un contrat orphelin vaut mieux qu'une
-- suppression bloquée sans explication. Le rattachement est un CONFORT
-- d'affichage — il ne porte aucune donnée de calcul.
alter table public.contrat
  add column if not exists modele_id uuid references public.modele_contrat(id)
    on delete set null;

create index if not exists modele_contrat_date_effet_idx
  on public.modele_contrat (owner, date_effet desc);
create index if not exists contrat_modele_id_idx
  on public.contrat (modele_id);

-- ----------------------------------------------------------------------------
-- RLS — modèle exact de 002_rls.sql
--
-- Une exception assumée : PAS DE POLICY `delete`. Supprimer une version de
-- contrat type ferait perdre l'explication des montants d'un mois clôturé, et
-- RG-15 interdit de le recalculer. Une version périmée n'encombre rien : elle
-- sort simplement de l'affichage courant.
-- ----------------------------------------------------------------------------

alter table public.modele_contrat enable row level security;

revoke all on public.modele_contrat from anon, authenticated, public;
grant select, insert, update on public.modele_contrat to authenticated;

drop policy if exists modele_contrat_select on public.modele_contrat;
create policy modele_contrat_select on public.modele_contrat
  for select to authenticated using (owner = (select auth.uid()));

drop policy if exists modele_contrat_insert on public.modele_contrat;
create policy modele_contrat_insert on public.modele_contrat
  for insert to authenticated with check (owner = (select auth.uid()));

drop policy if exists modele_contrat_update on public.modele_contrat;
create policy modele_contrat_update on public.modele_contrat
  for update to authenticated using (owner = (select auth.uid()))
                                with check (owner = (select auth.uid()));

drop policy if exists modele_contrat_delete on public.modele_contrat;

comment on table public.modele_contrat is
  'Conditions habituelles de l''assistante maternelle, en VERSIONS datées. '
  'Une version ne s''applique jamais seule : elle se propose, contrat par '
  'contrat (V8-14). Les anciennes versions ne sont JAMAIS supprimées — elles '
  'expliquent les montants des mois déjà clôturés, que RG-15 interdit de '
  'recalculer. Aucun droit de suppression n''est accordé.';

comment on column public.contrat.modele_id is
  'Version de contrat type à laquelle ce contrat est rattaché. Confort '
  'd''affichage : sert à montrer les ÉCARTS. N''entre dans aucun calcul — la '
  'rémunération d''un contrat vient toujours de salaire_contrat, datée.';
