-- ============================================================================
-- 009_notes.sql — Notes mensuelles (lot 12).
--
-- NUMÉRO : la spécification attribuait `008` à ce lot. Ce numéro a été pris par
-- le lot 11 (`008_contrats_types.sql`), dans le décalage entamé quand `006` a
-- servi aux correctifs de relecture du lot 13. Il reste :
--   lot 14 -> 010, lot 15 -> 011.
--
-- CE QUE CETTE TABLE PORTE, ET CE QU'ELLE NE DOIT JAMAIS TOUCHER.
--
-- Une note mensuelle est un espace d'écriture POUR MARIA SEULE : « le lundi 6,
-- les parents sont arrivés en retard », « prévenir pour les vacances de la
-- Toussaint ». Rien de tout cela ne regarde une famille, et rien de tout cela
-- n'est un chiffre.
--
-- D'où deux propriétés qui semblent des détails et n'en sont pas :
--
--   1. LA NOTE N'ENTRE DANS AUCUN INSTANTANÉ de récapitulatif. Si elle y
--      entrait, elle serait FIGÉE à la clôture — donc non modifiable — et
--      surtout elle voyagerait avec le document remis aux parents. C'est le
--      risque n° 1 de la spécification, et il est silencieux : personne ne
--      s'en aperçoit avant qu'un parent lise une note qui ne lui était pas
--      destinée.
--
--   2. LA NOTE SURVIT À LA CLÔTURE et reste modifiable après. Le trigger
--      d'immuabilité du lot 2 protège `recap_mensuel` ; il ne s'applique pas
--      ici, et c'est voulu. Un mois clôturé fige des MONTANTS, pas des
--      souvenirs.
--
-- `journee.commentaire` existe depuis le lot 1 : ce lot le BRANCHE à l'écran,
-- sans migration.
--
-- Conventions inchangées : « if not exists » partout, RLS explicite sur le
-- modèle de 002_rls.sql, jamais de `using (true)`, `owner` posé par défaut en
-- base et jamais transmis par le client.
-- ============================================================================

create table if not exists public.note_mensuelle (
  id         uuid primary key default gen_random_uuid(),
  owner      uuid not null default auth.uid(),
  contrat_id uuid not null references public.contrat(id) on delete cascade,
  annee      int not null check (annee between 2000 and 2100),
  mois       int not null check (mois between 1 and 12),
  texte      text not null default '',
  maj_le     timestamptz not null default now(),
  unique (contrat_id, annee, mois)
);

-- `on delete cascade` : contrairement à l'historique des événements (lot 13),
-- une note n'est pas une preuve. Elle n'explique aucun montant et ne sert
-- aucune contestation ; elle disparaît avec le contrat qu'elle annote.

create index if not exists note_mensuelle_contrat_idx
  on public.note_mensuelle (contrat_id, annee, mois);

-- ----------------------------------------------------------------------------
-- `maj_le` tenu par la BASE, pas par le client
--
-- L'horodatage d'une note sert à afficher « enregistrée à 18h42 ». Le laisser
-- au client, c'est le laisser à l'horloge d'un téléphone — et deux appareils
-- mal réglés produiraient un ordre faux. Ce n'est pas dramatique ici, mais le
-- principe vaut partout dans ce projet : une date produite par la base ne
-- ment pas.
-- ----------------------------------------------------------------------------

create or replace function public.toucher_note_mensuelle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.maj_le := now();
  return new;
end;
$$;

drop trigger if exists note_mensuelle_maj_le on public.note_mensuelle;
create trigger note_mensuelle_maj_le
  before update on public.note_mensuelle
  for each row execute function public.toucher_note_mensuelle();

-- ----------------------------------------------------------------------------
-- RLS — modèle exact de 002_rls.sql
--
-- Ici les quatre policies, suppression comprise : une note s'efface, c'est un
-- brouillon. C'est l'inverse de `evenement_recap`, qui porte une garantie.
-- ----------------------------------------------------------------------------

alter table public.note_mensuelle enable row level security;

revoke all on public.note_mensuelle from anon, authenticated, public;
grant select, insert, update, delete on public.note_mensuelle to authenticated;

drop policy if exists note_mensuelle_select on public.note_mensuelle;
create policy note_mensuelle_select on public.note_mensuelle
  for select to authenticated using (owner = (select auth.uid()));

drop policy if exists note_mensuelle_insert on public.note_mensuelle;
create policy note_mensuelle_insert on public.note_mensuelle
  for insert to authenticated with check (owner = (select auth.uid()));

drop policy if exists note_mensuelle_update on public.note_mensuelle;
create policy note_mensuelle_update on public.note_mensuelle
  for update to authenticated using (owner = (select auth.uid()))
                                with check (owner = (select auth.uid()));

drop policy if exists note_mensuelle_delete on public.note_mensuelle;
create policy note_mensuelle_delete on public.note_mensuelle
  for delete to authenticated using (owner = (select auth.uid()));

comment on table public.note_mensuelle is
  'Note libre de l''assistante maternelle sur un mois et un enfant. POUR ELLE '
  'SEULE : n''entre dans AUCUN instantané de récapitulatif et n''apparaît sur '
  'aucun document remis à une famille. Reste modifiable après la clôture du '
  'mois — un mois clôturé fige des montants, pas des souvenirs.';
