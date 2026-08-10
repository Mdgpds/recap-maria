-- ============================================================================
-- 006_reouverture_correctifs.sql — Correctifs de relecture du lot 13.
--
-- La migration 005 affirmait : « La garantie devient structurelle au lieu
-- d'être une intention. » C'ÉTAIT FAUX, et la relecture l'a montré en
-- l'exécutant. Les trois fonctions garantissent que SI on passe par elles, la
-- trace est écrite. Rien n'obligeait à passer par elles : le trigger
-- autorisait la transition « figé -> brouillon » sans rien exiger en échange,
-- et un simple
--
--     supabase.from('recap_mensuel').update({ statut: 'brouillon', fige_le: null })
--
-- lancé depuis le navigateur avec la clé publique et une session ordinaire
-- rouvrait un mois clôturé SANS écrire le moindre événement.
--
-- Ce fichier renverse la charge : ce n'est plus l'appelant qui doit penser à
-- écrire la trace, c'est la BASE qui l'écrit, quel que soit le chemin. Une
-- réouverture sans événement devient impossible, pas déconseillée.
--
-- Il ferme aussi la seconde porte que le lot 13 avait ouverte sans le dire :
-- un mois rouvert redevient un brouillon, donc supprimable, et sa suppression
-- emportait TOUT son historique par cascade. Avant le lot 13, un mois clôturé
-- était indestructible, donc son histoire aussi.
--
-- Conventions inchangées : « if not exists » / « drop … if exists » partout,
-- RLS explicite, jamais de using (true).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. La trace est écrite par la base, pas par l'appelant (anomalie B1)
--
-- Un trigger AFTER UPDATE écrit l'événement dès que le statut change, quelle
-- que soit l'origine de la modification : fonction, requête directe depuis le
-- navigateur, ou code d'un lot futur qui aurait oublié la règle.
--
-- Pourquoi AFTER et non BEFORE : la validation (ce qui est refusé) reste dans
-- le trigger BEFORE du lot 2 ; l'écriture de la trace (ce qui est enregistré)
-- vient après, une fois la modification acquise. Deux responsabilités, deux
-- triggers.
--
-- Le motif, lui, ne peut venir que de l'appelante : il transite par un
-- réglage LOCAL à la transaction, posé par `rouvrir_recap` juste avant son
-- UPDATE. Une réouverture faite par un autre chemin produit donc un événement
-- SANS motif — ce qui est exactement ce qu'on veut dire : le geste est tracé,
-- même quand personne n'a expliqué pourquoi.
--
-- Si l'insertion de l'événement échoue — RLS, droits retirés —, l'UPDATE
-- échoue avec elle. C'est le but : pas de trace, pas de réouverture.
-- ----------------------------------------------------------------------------

create or replace function public.tracer_changement_statut_recap()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  motif text;
begin
  if new.statut is not distinct from old.statut then
    return null;                                   -- rien à tracer
  end if;

  if old.statut = 'fige' and new.statut = 'brouillon' then
    motif := nullif(btrim(coalesce(current_setting('recap.motif_reouverture', true), '')), '');
    insert into public.evenement_recap (recap_id, type, motif)
    values (new.id, 'reouverture', motif);

  elsif old.statut = 'brouillon' and new.statut = 'fige' then
    insert into public.evenement_recap (recap_id, type)
    values (new.id, 'cloture');
  end if;

  return null;                                     -- AFTER : la valeur est ignorée
end;
$$;

drop trigger if exists recap_mensuel_tracer_statut on public.recap_mensuel;
create trigger recap_mensuel_tracer_statut
  after update on public.recap_mensuel
  for each row execute function public.tracer_changement_statut_recap();

-- ----------------------------------------------------------------------------
-- 2. Les trois fonctions n'écrivent plus l'événement elles-mêmes
--
-- Sans quoi il serait écrit deux fois. Elles gardent tout le reste : la
-- lecture verrouillée, les refus silencieux quand il n'y a rien à faire,
-- l'horodatage produit par la base, `donnees` intact à la réouverture.
-- `rouvrir_recap` se contente désormais de transmettre le motif au trigger.
-- ----------------------------------------------------------------------------

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

  /* Le motif voyage jusqu'au trigger par un réglage local à la transaction :
     lui seul connaît l'événement, elle seule connaît le motif. */
  perform set_config('recap.motif_reouverture', coalesce(p_motif, ''), true);

  update public.recap_mensuel
     set statut = 'brouillon', fige_le = null
   where id = r.id
   returning * into r;

  /* Remis à blanc : une seconde réouverture dans la même transaction ne doit
     pas hériter du motif de la première. */
  perform set_config('recap.motif_reouverture', '', true);

  return r;
end;
$$;

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
    insert into public.recap_mensuel (contrat_id, annee, mois, statut, donnees)
    values (p_contrat_id, p_annee, p_mois, 'brouillon', p_donnees)
    returning * into r;

    update public.recap_mensuel
       set statut = 'fige', fige_le = now()
     where id = r.id
     returning * into r;
  end if;

  return r;                                        -- l'événement est écrit par le trigger
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Un historique ne s'efface pas par ricochet (anomalie B2)
--
-- `on delete cascade` faisait disparaître tout l'historique d'un mois avec le
-- mois lui-même — et, par la cascade du contrat, avec le contrat. Avant le
-- lot 13 c'était sans objet : un mois clôturé était indestructible. Depuis
-- qu'il peut redevenir brouillon, la porte s'ouvrait.
--
-- `restrict` : un récapitulatif qui a une histoire ne se supprime plus, et un
-- contrat qui porte un tel récapitulatif non plus. C'est aussi ce que le
-- lot 14 exigera. Un récapitulatif sans aucun événement — jamais clôturé —
-- reste supprimable.
-- ----------------------------------------------------------------------------

alter table public.evenement_recap
  drop constraint if exists evenement_recap_recap_id_fkey;

alter table public.evenement_recap
  add constraint evenement_recap_recap_id_fkey
    foreign key (recap_id) references public.recap_mensuel(id) on delete restrict;

-- ----------------------------------------------------------------------------
-- 4. L'historique devient réellement indélébile (anomalie C1)
--
-- La migration 005 avait repris « le modèle exact de 002_rls.sql » : quatre
-- policies par table. Sur une table de données métier c'est la bonne
-- convention ; sur la table qui PORTE la garantie, elle est à l'envers.
-- `authenticated` pouvait modifier et supprimer des événements depuis le
-- navigateur, et la phrase « Cet historique ne peut pas être effacé »,
-- affichée à Maria, n'était vraie que par convention.
--
-- Le lot n'a besoin ni de mise à jour ni de suppression d'événement : on
-- retire les deux. La phrase devient vraie.
-- ----------------------------------------------------------------------------

revoke update, delete on public.evenement_recap from anon, authenticated, public;

drop policy if exists evenement_recap_update on public.evenement_recap;
drop policy if exists evenement_recap_delete on public.evenement_recap;

comment on table public.evenement_recap is
  'Historique INDÉLÉBILE des événements d''un récapitulatif mensuel : clôture, '
  'réouverture, transmission. Écrit par la base elle-même (trigger '
  'recap_mensuel_tracer_statut) dès qu''un statut change, quel que soit le '
  'chemin emprunté : aucune réouverture ne peut exister sans sa trace. '
  'Ni modifiable ni supprimable par l''application ; un récapitulatif qui '
  'porte une histoire ne se supprime pas non plus.';
