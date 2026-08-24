-- ============================================================================
-- 018 — LA RÈGLE DES CINQ SAMEDIS (§3 des specs du 24 août 2026).
--
-- CE QUI CHANGE DANS LE MÉTIER.
--
-- Jusqu'ici, RG-06 décomptait une période de congé du premier jour d'absence
-- au dernier jour ouvrable avant la reprise, dimanches et fériés exclus, en
-- INCLUANT systématiquement tous les samedis. Une semaine complète valait donc
-- toujours 6 jours.
--
-- Désormais, un samedi que Maria NE TRAVAILLE PAS n'est décompté que si elle
-- le choisit, et au plus cinq fois par année de référence (1er juin – 31 mai)
-- et par famille. C'est la « règle des cinq samedis », proposée par le
-- ministère du Travail en 1980 : 30 jours ouvrables acquis par an, divisés par
-- 6 jours ouvrables par semaine, font 5 semaines — donc au plus 5 samedis
-- décomptés par période de référence. Elle empêche l'optimisation par
-- fractionnement (poser du lundi au jeudi pour ne jamais « payer » de samedi).
--
-- CE QUE CETTE TABLE EST, ET CE QU'ELLE N'EST PAS.
--
-- Elle est la LISTE DES SAMEDIS EFFECTIVEMENT COMPTÉS. Une ligne = un samedi
-- décompté sur une période. Rien d'autre : ni quota, ni année de référence, ni
-- décompte. Le quota se compte en lisant ces lignes ; le décompte se calcule
-- dans le moteur, qui reçoit ces dates en donnée et ne va jamais les chercher.
--
-- Deux cas ne passent JAMAIS par cette table, et n'entament aucun quota :
--   * un samedi qui est dans le planning du contrat — c'est une vraie journée
--     de garde manquée, elle se décompte d'office comme n'importe quel jour ;
--   * un samedi férié — il n'est jamais décompté, règle existante inchangée.
--
-- DÉCISION D'ADRIEN, 24 août 2026 : « rien n'est coché par défaut, c'est Maria
-- qui arbitre ». La table démarre donc VIDE, et elle le reste tant que Maria
-- n'a rien coché.
--
-- DÉCISION D'ADRIEN, 24 août 2026, sur les congés DÉJÀ POSÉS : « on ne coche
-- rien, les périodes passées perdent leur samedi ». Cette migration ne
-- rattrape donc AUCUNE période existante. Conséquence assumée et annoncée :
-- les mois NON CLÔTURÉS qui portent déjà des congés se recalculent au premier
-- affichage — une semaine déjà posée passe de 6 à 5 jours décomptés tant que
-- Maria n'a pas rouvert la pose pour cocher son samedi. Les mois clôturés, eux,
-- ne bougent pas : leurs chiffres sont figés dans leur récapitulatif.
--
-- CE QUE CETTE MIGRATION NE FAIT PAS : aucune colonne supprimée, aucune donnée
-- modifiée, aucun `update`, aucun `delete`, aucun `insert` sur les tables
-- métier existantes. Une seule table nouvelle.
--
-- ORDRE DE MISE EN PRODUCTION : LE SQL D'ABORD, LA FUSION ENSUITE.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. La table
--
-- Le contrat N'EST PAS dupliqué ici : il se lit par jointure sur
-- `imputation_conge`. Une donnée dénormalisée est une donnée qui peut diverger,
-- et celle-ci divergerait en silence le jour où une période changerait de main.
--
-- `on delete cascade` sur l'imputation : retirer une période REND ses samedis
-- au quota, sans code de nettoyage à écrire — donc sans code de nettoyage à
-- oublier. C'est la base qui tient la règle, pas l'écran.
-- ----------------------------------------------------------------------------

create table if not exists public.samedi_conge (
  imputation_id uuid not null
    references public.imputation_conge(id) on delete cascade,
  date_samedi   date not null,
  owner         uuid not null default auth.uid(),
  cree_le       timestamptz not null default now(),

  -- Le même samedi ne peut pas être compté deux fois sur la même période.
  constraint samedi_conge_pk primary key (imputation_id, date_samedi),

  -- UNE DONNÉE QUI NE PEUT PAS ÊTRE FAUSSE VAUT MIEUX QU'UN CONTRÔLE D'ÉCRAN.
  -- `isodow` vaut 6 le samedi. Un lundi écrit ici ferait décompter un jour qui
  -- n'a rien à voir avec la règle, et l'erreur ne se verrait que sur le
  -- document remis à la famille.
  constraint samedi_conge_est_un_samedi
    check (extract(isodow from date_samedi) = 6)
);

comment on table public.samedi_conge is
  'Samedis NON TRAVAILLÉS effectivement décomptés sur une période de congé '
  '(règle des cinq samedis, §2.2 des specs du 24 août 2026). Une ligne = un '
  'samedi compté. Un samedi du planning du contrat ou un samedi férié '
  'n''apparaît jamais ici : le premier se décompte d''office, le second ne se '
  'décompte jamais.';

comment on column public.samedi_conge.imputation_id is
  'Période de congé qui porte ce samedi. `on delete cascade` : retirer la '
  'période rend le samedi au quota de l''année.';

comment on column public.samedi_conge.date_samedi is
  'Date du samedi compté. Son ANNÉE DE RÉFÉRENCE (1er juin – 31 mai) est celle '
  'de cette date : une période à cheval sur le 31 mai voit ses samedis '
  'répartis entre deux années, chacun comptant dans la sienne.';

-- L'index qui sert le décompte du quota : « combien de samedis comptés pour ce
-- contrat sur cette année de référence ». La jointure part de la période, la
-- borne est une plage de dates.
create index if not exists samedi_conge_date
  on public.samedi_conge (date_samedi);

-- ----------------------------------------------------------------------------
-- 2. Exposition explicite et Row Level Security
--
-- Même modèle que `002_rls.sql`, sans exception : on RÉVOQUE tout pour anon,
-- authenticated et le pseudo-rôle public AVANT d'accorder les droits utiles,
-- parce qu'un projet Supabase accorde par défaut « grant all » sur le schéma
-- public — un simple grant n'aurait donc rien restreint.
--
-- JAMAIS DE `using (true)` : tout accès est filtré sur owner = auth.uid().
--
-- Les policies utilisent `(select auth.uid())` et non `auth.uid()` nu :
-- équivalent, mais évalué une seule fois par requête (advisor
-- `auth_rls_initplan`).
--
-- `drop policy if exists` avant chaque `create` : recollage sans erreur en
-- application manuelle répétée.
-- ----------------------------------------------------------------------------

alter table public.samedi_conge enable row level security;

revoke all on public.samedi_conge from anon, authenticated, public;

grant select, insert, update, delete on public.samedi_conge to authenticated;

drop policy if exists samedi_conge_select on public.samedi_conge;
create policy samedi_conge_select on public.samedi_conge
  for select to authenticated using (owner = (select auth.uid()));

drop policy if exists samedi_conge_insert on public.samedi_conge;
create policy samedi_conge_insert on public.samedi_conge
  for insert to authenticated with check (owner = (select auth.uid()));

drop policy if exists samedi_conge_update on public.samedi_conge;
create policy samedi_conge_update on public.samedi_conge
  for update to authenticated
  using (owner = (select auth.uid())) with check (owner = (select auth.uid()));

drop policy if exists samedi_conge_delete on public.samedi_conge;
create policy samedi_conge_delete on public.samedi_conge
  for delete to authenticated using (owner = (select auth.uid()));
