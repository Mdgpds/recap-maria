-- ============================================================================
-- 005_reouverture.sql — Lot 13. Réouverture d'un mois clôturé.
--
-- C'est la seule migration du projet qui AFFAIBLIT délibérément une garantie
-- existante. Le trigger d'immuabilité du lot 2 rejette aujourd'hui toute
-- modification d'un récapitulatif figé : c'est lui qui rend les comptes de
-- Maria incontestables. Ce fichier lui ajoute une porte — une seule, étroite,
-- et tracée.
--
-- Conséquence assumée : le verrou technique devient une CONVENTION OUTILLÉE.
-- Ce qui protège Maria n'est plus l'impossibilité de modifier, mais la
-- traçabilité de chaque modification. La trace n'est donc pas un confort,
-- c'est la garantie elle-même. D'où le choix, expliqué au §4 ci-dessous, de
-- rendre chaque geste et son événement INSÉPARABLES au niveau de la base.
--
-- Conventions reprises de 001_schema.sql et 002_rls.sql : owner par défaut
-- auth.uid(), RLS activée, revoke all puis policies explicites par opération,
-- jamais de using (true), « if not exists » / « drop … if exists » partout.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Trace de transmission à la famille
--
-- null = jamais transmis. CE CHAMP NE CONDITIONNE RIEN : il déclenche un
-- avertissement, jamais un refus. Il est renseigné par marquer_transmis()
-- ci-dessous ; l'écran qui l'appelle appartient au lot 7. Jusque-là il reste
-- nul, et l'avertissement de transmission ne se déclenche jamais : c'est
-- correct et voulu.
-- ----------------------------------------------------------------------------

alter table public.recap_mensuel
  add column if not exists transmis_le timestamptz;

comment on column public.recap_mensuel.transmis_le is
  'Date à laquelle le récapitulatif a été transmis à la famille. null = jamais '
  'transmis. Ne conditionne aucun refus : sert uniquement à avertir avant une '
  'réouverture et lors d''une reclôture. Raccourci opérationnel de l''événement '
  'de type « transmission », écrit dans la même opération que lui.';

-- ----------------------------------------------------------------------------
-- 2. Historique des événements d'un récapitulatif
--
-- SOURCE DE VÉRITÉ de l'historique d'un mois. Puisque le verrou devient une
-- convention, c'est cette table qui porte la garantie.
--
-- `motif` est optionnel et JAMAIS imposé : demander une justification écrite
-- à chaque correction transformerait un outil en tribunal. Il est proposé,
-- pas requis.
-- ----------------------------------------------------------------------------

create table if not exists public.evenement_recap (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null default auth.uid(),
  recap_id    uuid not null references public.recap_mensuel(id) on delete cascade,
  type        text not null check (type in ('cloture','reouverture','transmission')),
  survenu_le  timestamptz not null default now(),
  motif       text
);

comment on table public.evenement_recap is
  'Historique indélébile des événements d''un récapitulatif mensuel : clôture, '
  'réouverture, transmission. Aucun chemin de l''application ne supprime une '
  'ligne d''ici. Un geste qui ne laisse pas son événement vide le lot 13 de '
  'son sens : c''est pourquoi les deux écritures passent par les fonctions du '
  '§4, où elles sont dans la même transaction.';

create index if not exists evenement_recap_recap
  on public.evenement_recap (recap_id, survenu_le);

-- ----------------------------------------------------------------------------
-- 3. Exposition explicite et RLS (modèle exact de 002_rls.sql)
-- ----------------------------------------------------------------------------

revoke all on public.evenement_recap from anon, authenticated, public;
grant select, insert, update, delete on public.evenement_recap to authenticated;
alter table public.evenement_recap enable row level security;

drop policy if exists evenement_recap_select on public.evenement_recap;
create policy evenement_recap_select on public.evenement_recap
  for select to authenticated using (owner = (select auth.uid()));

drop policy if exists evenement_recap_insert on public.evenement_recap;
create policy evenement_recap_insert on public.evenement_recap
  for insert to authenticated with check (owner = (select auth.uid()));

drop policy if exists evenement_recap_update on public.evenement_recap;
create policy evenement_recap_update on public.evenement_recap
  for update to authenticated
  using (owner = (select auth.uid())) with check (owner = (select auth.uid()));

drop policy if exists evenement_recap_delete on public.evenement_recap;
create policy evenement_recap_delete on public.evenement_recap
  for delete to authenticated using (owner = (select auth.uid()));

-- ----------------------------------------------------------------------------
-- 4. Le trigger d'immuabilité, rouvert d'un cran — et d'un seul
--
-- AUTORISÉ sur une ligne figée :
--   - les champs d'audit (audit_note, audit_le, audit_par), comme avant ;
--   - `transmis_le` ;
--   - LA transition « fige -> brouillon » avec `fige_le` remis à null,
--     c'est-à-dire la réouverture, et rien d'autre dans la même instruction.
--
-- REJETÉ, comme avant : toute modification de `donnees`, `annee`, `mois`,
-- `contrat_id`, `id`, `owner`, et tout DELETE.
--
-- LE PIÈGE que ce trigger existe pour fermer : autoriser le passage
-- fige -> brouillon en laissant passer d'autres champs dans la même
-- instruction. Un UPDATE qui changerait le statut ET `donnees` d'un coup
-- contournerait toute la protection. Les colonnes intouchables sont donc
-- vérifiées AVANT d'examiner la transition.
--
-- Le message reste technique et contient le mot « figé » : il n'atteint
-- jamais l'écran, js/messages.js le traduit en « ce mois est clôturé : il ne
-- peut plus être modifié ».
-- ----------------------------------------------------------------------------

create or replace function public.proteger_recap_fige()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.statut = 'fige' then
    if tg_op = 'DELETE' then
      raise exception 'recap_mensuel % (contrat %, %/%) est figé : suppression interdite (immuabilité)',
        old.id, old.contrat_id, old.mois, old.annee
        using errcode = 'P0001';
    end if;

    -- Colonnes intouchables sur une ligne figée, quelle que soit l'opération.
    if new.id         is distinct from old.id
       or new.owner      is distinct from old.owner
       or new.contrat_id is distinct from old.contrat_id
       or new.annee      is distinct from old.annee
       or new.mois       is distinct from old.mois
       or new.donnees    is distinct from old.donnees
    then
      raise exception 'recap_mensuel % (contrat %, %/%) est figé : les valeurs du document ne sont pas modifiables (immuabilité)',
        old.id, old.contrat_id, old.mois, old.annee
        using errcode = 'P0001';
    end if;

    -- Cas 1 — le mois reste figé : seuls les champs d'audit ou transmis_le
    -- ont pu changer (comportement d'avant le lot 13, inchangé).
    if new.statut is not distinct from old.statut
       and new.fige_le is not distinct from old.fige_le
    then
      return new;
    end if;

    -- Cas 2 — LA réouverture : fige -> brouillon, et fige_le remis à null.
    if new.statut = 'brouillon' and new.fige_le is null then
      return new;
    end if;

    raise exception 'recap_mensuel % (contrat %, %/%) est figé : seule la réouverture est permise (immuabilité)',
      old.id, old.contrat_id, old.mois, old.annee
      using errcode = 'P0001';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. Gestes tracés — un geste et son événement, jamais l'un sans l'autre
--
-- POURQUOI DES FONCTIONS EN BASE plutôt que deux appels depuis le navigateur :
-- la spécification demande que l'événement soit écrit « dans la même
-- opération ». Deux requêtes lancées depuis un téléphone ne le sont pas : si
-- le réseau tombe entre les deux, le mois est rouvert SANS trace — et le §9
-- de la spécification qualifie ce cas de défaut bloquant. Le corps d'une
-- fonction plpgsql s'exécute dans une seule transaction : si l'insertion de
-- l'événement échoue, la réouverture est annulée avec elle. La garantie
-- devient structurelle au lieu d'être une intention.
--
-- `security invoker` (le défaut, écrit ici pour qu'il soit lu) : les fonctions
-- s'exécutent avec les droits de l'appelante, donc la RLS s'applique
-- normalement — une fonction ne doit jamais être une porte dérobée.
-- ----------------------------------------------------------------------------

-- 5.1 Réouverture ----------------------------------------------------------
-- Renvoie null si le récapitulatif n'existe pas ou n'est pas figé : ce n'est
-- pas une erreur, c'est « il n'y avait rien à rouvrir » (deuxième appareil,
-- double appui). `donnees` n'est PAS touché : l'instantané de la clôture
-- d'origine est conservé intact, c'est lui qui permettra la comparaison à la
-- reclôture.

create or replace function public.rouvrir_recap(
  p_contrat_id uuid,
  p_annee      int,
  p_mois       int,
  p_motif      text default null
)
returns public.recap_mensuel
language plpgsql
security invoker
set search_path = ''
as $$
declare
  r public.recap_mensuel;
begin
  select * into r
    from public.recap_mensuel
   where contrat_id = p_contrat_id and annee = p_annee and mois = p_mois
   for update;

  if not found or r.statut <> 'fige' then
    return null;
  end if;

  update public.recap_mensuel
     set statut = 'brouillon', fige_le = null
   where id = r.id
   returning * into r;

  insert into public.evenement_recap (recap_id, type, motif)
  values (r.id, 'reouverture', nullif(btrim(coalesce(p_motif, '')), ''));

  return r;
end;
$$;

-- 5.2 Clôture et reclôture -------------------------------------------------
-- Sert AUSSI à la première clôture : sans cela, le premier événement
-- « Clôturé » manquerait à l'historique, qui commencerait par « Rouvert ».
-- Renvoie null si le mois est déjà figé — le mois a été clôturé ailleurs,
-- rien n'est écrasé. L'horodatage est produit par la base (now()) : aucun
-- objet Date ne traverse la couche données.

create or replace function public.recloturer_recap(
  p_contrat_id uuid,
  p_annee      int,
  p_mois       int,
  p_donnees    jsonb
)
returns public.recap_mensuel
language plpgsql
security invoker
set search_path = ''
as $$
declare
  r public.recap_mensuel;
begin
  select * into r
    from public.recap_mensuel
   where contrat_id = p_contrat_id and annee = p_annee and mois = p_mois
   for update;

  if found and r.statut = 'fige' then
    return null;
  end if;

  if found then
    update public.recap_mensuel
       set donnees = p_donnees, statut = 'fige', fige_le = now()
     where id = r.id
     returning * into r;
  else
    -- Le trigger d'insertion refuse une création directe au statut « fige » :
    -- on passe par le brouillon, seul chemin contrôlé (lot 2, B5).
    insert into public.recap_mensuel (contrat_id, annee, mois, statut, donnees)
    values (p_contrat_id, p_annee, p_mois, 'brouillon', p_donnees)
    returning * into r;

    update public.recap_mensuel
       set statut = 'fige', fige_le = now()
     where id = r.id
     returning * into r;
  end if;

  insert into public.evenement_recap (recap_id, type)
  values (r.id, 'cloture');

  return r;
end;
$$;

-- 5.3 Transmission à la famille --------------------------------------------
-- IDEMPOTENTE : appelée deux fois, elle n'écrase pas la première date et
-- n'ajoute pas de second événement. Fournie ici, branchée à l'écran au lot 7.

create or replace function public.marquer_transmis(
  p_contrat_id uuid,
  p_annee      int,
  p_mois       int
)
returns public.recap_mensuel
language plpgsql
security invoker
set search_path = ''
as $$
declare
  r public.recap_mensuel;
begin
  select * into r
    from public.recap_mensuel
   where contrat_id = p_contrat_id and annee = p_annee and mois = p_mois
   for update;

  if not found then
    return null;
  end if;
  if r.transmis_le is not null then
    return r;                      -- déjà transmis : on ne touche à rien
  end if;

  update public.recap_mensuel
     set transmis_le = now()
   where id = r.id
   returning * into r;

  insert into public.evenement_recap (recap_id, type)
  values (r.id, 'transmission');

  return r;
end;
$$;

-- 5.4 Exposition des fonctions ---------------------------------------------
-- Comme pour les tables : rien pour anon, seulement ce qui sert à
-- authenticated. La RLS reste la barrière (security invoker).

revoke all on function public.rouvrir_recap(uuid, int, int, text)   from anon, authenticated, public;
revoke all on function public.recloturer_recap(uuid, int, int, jsonb) from anon, authenticated, public;
revoke all on function public.marquer_transmis(uuid, int, int)      from anon, authenticated, public;

grant execute on function public.rouvrir_recap(uuid, int, int, text)   to authenticated;
grant execute on function public.recloturer_recap(uuid, int, int, jsonb) to authenticated;
grant execute on function public.marquer_transmis(uuid, int, int)      to authenticated;
