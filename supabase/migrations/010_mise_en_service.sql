-- ============================================================================
-- 010_mise_en_service.sql — Suppression franche d'un contrat vierge (lot 14).
--
-- NUMÉRO : la spécification attribuait `009` à ce lot. Ce numéro a été pris par
-- le lot 12 (`009_notes.sql`), dans le décalage entamé quand `006` a servi aux
-- correctifs de relecture du lot 13. Il reste : lot 15 -> 011.
--
-- POURQUOI CETTE MIGRATION EXISTE ALORS QUE LA SPÉCIFICATION N'EN PRÉVOYAIT
-- (PRESQUE) PAS.
--
-- Le §14.3 dit : « Aucune table nouvelle : compteur_initial existe déjà. La
-- migration ne porte que d'éventuels index. Si aucun n'est nécessaire, ne pas
-- créer de fichier vide — le signaler. »
--
-- INDEX : aucun n'est nécessaire, et c'est signalé en restitution.
-- `journee_contrat_id_jour_key` et `recap_mensuel_contrat_id_annee_mois_key`
-- commencent tous deux par `contrat_id` : les recherches « ce contrat a-t-il
-- des journées ? » sont déjà servies.
--
-- MAIS le §14.4 exige que `supprimerContrat` « vérifie CÔTÉ BASE l'absence de
-- journée et de récapitulatif », et le risque n° 2 le répète : « vérifier la
-- vacuité du contrat côté interface seulement ». Or les six clés étrangères
-- qui pointent vers `contrat` sont toutes en `on delete cascade` :
--
--     salaire_contrat · journee · recap_mensuel
--     compteur_initial · imputation_conge · note_mensuelle
--
-- Autrement dit, sans garde en base, un `delete from contrat` réussirait
-- TOUJOURS et emporterait silencieusement toutes les journées et tous les
-- récapitulatifs — y compris des mois clôturés dont les documents sont partis
-- chez des familles. Le trigger d'immuabilité du lot 2 ne protège que les
-- modifications de `recap_mensuel` faites directement ; une cascade ne le
-- déclenche pas de la même façon pour un contrat entier.
--
-- Un contrôle écrit en JavaScript n'est pas un contrôle : le client est servi
-- en statique et la clé publique circule dans le navigateur. La vérification
-- vit donc ICI, en base, sur le seul chemin que personne ne contourne.
--
-- Conventions inchangées : « drop … if exists » avant chaque create,
-- `set search_path = ''`, aucune policy nouvelle.
-- ============================================================================

create or replace function public.proteger_suppression_contrat()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  n_journees int;
  n_recaps   int;
begin
  select count(*) into n_journees from public.journee where contrat_id = old.id;
  select count(*) into n_recaps   from public.recap_mensuel where contrat_id = old.id;

  if n_journees > 0 or n_recaps > 0 then
    /* Le message NOMME ce qui bloque. « Suppression impossible » tout seul
       obligerait Maria à deviner — et ici il n'y a rien à deviner : soit des
       journées ont été saisies, soit des mois ont été enregistrés. Dans les
       deux cas la réponse est la même : ce contrat s'ARCHIVE, il ne se
       supprime pas. */
    raise exception
      'contrat % : suppression impossible, % journée(s) et % récapitulatif(s) existent (CONTRAT_NON_VIERGE)',
      old.id, n_journees, n_recaps
      using errcode = 'restrict_violation';
  end if;

  return old;
end;
$$;

drop trigger if exists contrat_suppression_franche on public.contrat;
create trigger contrat_suppression_franche
  before delete on public.contrat
  for each row execute function public.proteger_suppression_contrat();

comment on function public.proteger_suppression_contrat() is
  'Autorise la suppression d''un contrat UNIQUEMENT s''il ne porte aucune '
  'journée et aucun récapitulatif. Les six clés étrangères qui pointent vers '
  'contrat sont en « on delete cascade » : sans ce garde, un delete emporterait '
  'silencieusement des mois clôturés dont les documents sont partis chez des '
  'familles. Un contrat qui a servi s''archive, il ne se supprime pas (B.0-7).';

-- ----------------------------------------------------------------------------
-- Le droit de suppression sur `contrat`
--
-- `002_rls.sql` accorde déjà `delete` à `authenticated` avec une policy sur
-- `owner`. On ne touche à rien : c'est le trigger ci-dessus qui porte la
-- règle métier, pas les droits. Séparer les deux est volontaire — les droits
-- disent QUI, le trigger dit QUOI.
-- ----------------------------------------------------------------------------

-- Vérification de cohérence des compteurs de reprise : la contrainte
-- `compteur_initial_coherent` existe depuis 001_schema (pris <= acquis, rien
-- de négatif). Rien à ajouter ; son refus est traduit en français par
-- js/messages.js, jamais affiché brut.
