-- ============================================================================
-- 002_rls.sql — Exposition explicite et Row Level Security.
--
-- Le projet Supabase est configuré avec l'exposition automatique des
-- nouvelles tables DÉSACTIVÉE et le RLS automatique ACTIVÉ (§3 des specs) :
-- chaque table est donc explicitement exposée et chaque policy écrite à la
-- main. Jamais de using (true) : tout accès est filtré sur owner = auth.uid().
--
-- CORRECTION RELECTURE LOT 2 (A1) : un projet Supabase applique par défaut
-- « grant all on tables to anon, authenticated, service_role » sur le schéma
-- public. Un simple grant n'aurait donc rien restreint (authenticated aurait
-- gardé TRUNCATE, qui contourne le trigger d'immuabilité). On RÉVOQUE tout
-- pour anon, authenticated ET public AVANT d'accorder les 4 droits utiles à
-- authenticated. service_role garde ses droits (usage serveur, clé secrète).
--
-- Note advisor : les policies utilisent (select auth.uid()) et non auth.uid()
-- nu — équivalent, mais évalué une seule fois par requête (auth_rls_initplan).
--
-- « drop policy if exists » avant chaque create : recollage sans erreur en
-- application manuelle répétée (relecture lot 2, B7).
-- ============================================================================

-- --- RLS explicite ---------------------------------------------------------

alter table public.famille          enable row level security;
alter table public.contrat          enable row level security;
alter table public.salaire_contrat  enable row level security;
alter table public.journee          enable row level security;
alter table public.recap_mensuel    enable row level security;
alter table public.compteur_initial enable row level security;

-- --- Remise à plat des privilèges de table (A1) ----------------------------
-- On révoque pour anon, authenticated et le pseudo-rôle public, afin que
-- l'exposition ne dépende plus des privilèges par défaut du projet.

revoke all on public.famille          from anon, authenticated, public;
revoke all on public.contrat          from anon, authenticated, public;
revoke all on public.salaire_contrat  from anon, authenticated, public;
revoke all on public.journee          from anon, authenticated, public;
revoke all on public.recap_mensuel    from anon, authenticated, public;
revoke all on public.compteur_initial from anon, authenticated, public;

-- --- Exposition explicite : seulement les 4 droits utiles, à authenticated -

grant select, insert, update, delete
  on public.famille, public.contrat, public.salaire_contrat,
     public.journee, public.recap_mensuel, public.compteur_initial
  to authenticated;

-- --- Policies : une par opération et par table, toutes sur owner -----------

-- famille
drop policy if exists famille_select on public.famille;
create policy famille_select on public.famille
  for select to authenticated using (owner = (select auth.uid()));
drop policy if exists famille_insert on public.famille;
create policy famille_insert on public.famille
  for insert to authenticated with check (owner = (select auth.uid()));
drop policy if exists famille_update on public.famille;
create policy famille_update on public.famille
  for update to authenticated
  using (owner = (select auth.uid())) with check (owner = (select auth.uid()));
drop policy if exists famille_delete on public.famille;
create policy famille_delete on public.famille
  for delete to authenticated using (owner = (select auth.uid()));

-- contrat
drop policy if exists contrat_select on public.contrat;
create policy contrat_select on public.contrat
  for select to authenticated using (owner = (select auth.uid()));
drop policy if exists contrat_insert on public.contrat;
create policy contrat_insert on public.contrat
  for insert to authenticated with check (owner = (select auth.uid()));
drop policy if exists contrat_update on public.contrat;
create policy contrat_update on public.contrat
  for update to authenticated
  using (owner = (select auth.uid())) with check (owner = (select auth.uid()));
drop policy if exists contrat_delete on public.contrat;
create policy contrat_delete on public.contrat
  for delete to authenticated using (owner = (select auth.uid()));

-- salaire_contrat
drop policy if exists salaire_contrat_select on public.salaire_contrat;
create policy salaire_contrat_select on public.salaire_contrat
  for select to authenticated using (owner = (select auth.uid()));
drop policy if exists salaire_contrat_insert on public.salaire_contrat;
create policy salaire_contrat_insert on public.salaire_contrat
  for insert to authenticated with check (owner = (select auth.uid()));
drop policy if exists salaire_contrat_update on public.salaire_contrat;
create policy salaire_contrat_update on public.salaire_contrat
  for update to authenticated
  using (owner = (select auth.uid())) with check (owner = (select auth.uid()));
drop policy if exists salaire_contrat_delete on public.salaire_contrat;
create policy salaire_contrat_delete on public.salaire_contrat
  for delete to authenticated using (owner = (select auth.uid()));

-- journee
drop policy if exists journee_select on public.journee;
create policy journee_select on public.journee
  for select to authenticated using (owner = (select auth.uid()));
drop policy if exists journee_insert on public.journee;
create policy journee_insert on public.journee
  for insert to authenticated with check (owner = (select auth.uid()));
drop policy if exists journee_update on public.journee;
create policy journee_update on public.journee
  for update to authenticated
  using (owner = (select auth.uid())) with check (owner = (select auth.uid()));
drop policy if exists journee_delete on public.journee;
create policy journee_delete on public.journee
  for delete to authenticated using (owner = (select auth.uid()));

-- recap_mensuel (l'immuabilité d'un récap figé est assurée par trigger,
-- indépendamment de ces policies)
drop policy if exists recap_mensuel_select on public.recap_mensuel;
create policy recap_mensuel_select on public.recap_mensuel
  for select to authenticated using (owner = (select auth.uid()));
drop policy if exists recap_mensuel_insert on public.recap_mensuel;
create policy recap_mensuel_insert on public.recap_mensuel
  for insert to authenticated with check (owner = (select auth.uid()));
drop policy if exists recap_mensuel_update on public.recap_mensuel;
create policy recap_mensuel_update on public.recap_mensuel
  for update to authenticated
  using (owner = (select auth.uid())) with check (owner = (select auth.uid()));
drop policy if exists recap_mensuel_delete on public.recap_mensuel;
create policy recap_mensuel_delete on public.recap_mensuel
  for delete to authenticated using (owner = (select auth.uid()));

-- compteur_initial
drop policy if exists compteur_initial_select on public.compteur_initial;
create policy compteur_initial_select on public.compteur_initial
  for select to authenticated using (owner = (select auth.uid()));
drop policy if exists compteur_initial_insert on public.compteur_initial;
create policy compteur_initial_insert on public.compteur_initial
  for insert to authenticated with check (owner = (select auth.uid()));
drop policy if exists compteur_initial_update on public.compteur_initial;
create policy compteur_initial_update on public.compteur_initial
  for update to authenticated
  using (owner = (select auth.uid())) with check (owner = (select auth.uid()));
drop policy if exists compteur_initial_delete on public.compteur_initial;
create policy compteur_initial_delete on public.compteur_initial
  for delete to authenticated using (owner = (select auth.uid()));
