-- ============================================================================
-- 002_rls.sql — Exposition explicite et Row Level Security.
--
-- Le projet Supabase est configuré avec l'exposition automatique des
-- nouvelles tables DÉSACTIVÉE et le RLS automatique ACTIVÉ (§3 des specs) :
-- chaque table est donc explicitement exposée (GRANT) et chaque policy
-- écrite à la main. Jamais de using (true) : tout accès est filtré sur
-- owner = auth.uid().
--
-- Le rôle anonyme n'a AUCUN droit : l'application impose une session
-- authentifiée (Maria est l'unique utilisatrice).
--
-- Note advisor : les policies utilisent (select auth.uid()) et non
-- auth.uid() nu — strictement équivalent, mais évalué une seule fois par
-- requête (recommandation Supabase « auth_rls_initplan »).
-- ============================================================================

-- --- RLS explicite (idempotent si le RLS automatique l'a déjà activé) ------

alter table public.famille          enable row level security;
alter table public.contrat          enable row level security;
alter table public.salaire_contrat  enable row level security;
alter table public.journee          enable row level security;
alter table public.recap_mensuel    enable row level security;
alter table public.compteur_initial enable row level security;

-- --- Aucun droit au rôle anonyme -------------------------------------------

revoke all
  on public.famille, public.contrat, public.salaire_contrat,
     public.journee, public.recap_mensuel, public.compteur_initial
  from anon;

-- --- Exposition explicite au rôle authentifié uniquement -------------------

grant select, insert, update, delete
  on public.famille, public.contrat, public.salaire_contrat,
     public.journee, public.recap_mensuel, public.compteur_initial
  to authenticated;

-- --- Policies : une par opération et par table, toutes sur owner -----------

-- famille
create policy famille_select on public.famille
  for select to authenticated
  using (owner = (select auth.uid()));
create policy famille_insert on public.famille
  for insert to authenticated
  with check (owner = (select auth.uid()));
create policy famille_update on public.famille
  for update to authenticated
  using (owner = (select auth.uid()))
  with check (owner = (select auth.uid()));
create policy famille_delete on public.famille
  for delete to authenticated
  using (owner = (select auth.uid()));

-- contrat
create policy contrat_select on public.contrat
  for select to authenticated
  using (owner = (select auth.uid()));
create policy contrat_insert on public.contrat
  for insert to authenticated
  with check (owner = (select auth.uid()));
create policy contrat_update on public.contrat
  for update to authenticated
  using (owner = (select auth.uid()))
  with check (owner = (select auth.uid()));
create policy contrat_delete on public.contrat
  for delete to authenticated
  using (owner = (select auth.uid()));

-- salaire_contrat
create policy salaire_contrat_select on public.salaire_contrat
  for select to authenticated
  using (owner = (select auth.uid()));
create policy salaire_contrat_insert on public.salaire_contrat
  for insert to authenticated
  with check (owner = (select auth.uid()));
create policy salaire_contrat_update on public.salaire_contrat
  for update to authenticated
  using (owner = (select auth.uid()))
  with check (owner = (select auth.uid()));
create policy salaire_contrat_delete on public.salaire_contrat
  for delete to authenticated
  using (owner = (select auth.uid()));

-- journee
create policy journee_select on public.journee
  for select to authenticated
  using (owner = (select auth.uid()));
create policy journee_insert on public.journee
  for insert to authenticated
  with check (owner = (select auth.uid()));
create policy journee_update on public.journee
  for update to authenticated
  using (owner = (select auth.uid()))
  with check (owner = (select auth.uid()));
create policy journee_delete on public.journee
  for delete to authenticated
  using (owner = (select auth.uid()));

-- recap_mensuel (l'immuabilité d'un récap figé est assurée par trigger,
-- indépendamment de ces policies)
create policy recap_mensuel_select on public.recap_mensuel
  for select to authenticated
  using (owner = (select auth.uid()));
create policy recap_mensuel_insert on public.recap_mensuel
  for insert to authenticated
  with check (owner = (select auth.uid()));
create policy recap_mensuel_update on public.recap_mensuel
  for update to authenticated
  using (owner = (select auth.uid()))
  with check (owner = (select auth.uid()));
create policy recap_mensuel_delete on public.recap_mensuel
  for delete to authenticated
  using (owner = (select auth.uid()));

-- compteur_initial
create policy compteur_initial_select on public.compteur_initial
  for select to authenticated
  using (owner = (select auth.uid()));
create policy compteur_initial_insert on public.compteur_initial
  for insert to authenticated
  with check (owner = (select auth.uid()));
create policy compteur_initial_update on public.compteur_initial
  for update to authenticated
  using (owner = (select auth.uid()))
  with check (owner = (select auth.uid()));
create policy compteur_initial_delete on public.compteur_initial
  for delete to authenticated
  using (owner = (select auth.uid()));
