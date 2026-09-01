-- ===========================================================================
-- 020_demi_journee.sql — LOT 31 §3 : UNE DEMI-JOURNÉE DIT LAQUELLE.
--
-- Une demi-journée de congé est déjà écrite : c'est un `conge_horaire` avec
-- ses minutes (migration 017). Ce qui manquait n'est pas une durée, c'est un
-- FAIT : de quelle moitié de journée il s'agit. Le moteur n'en a pas besoin —
-- il ne compte que des minutes — mais Maria et la famille, si : c'est ce qui
-- figure sur le document remis en fin de mois.
--
-- NUMÉRO 020, ET PAS 019. La spécification écrivait `019_demi_journee.sql` ;
-- `019_familiarisation_heures.sql` occupe déjà ce numéro. Corrigé avec Adrien
-- avant écriture.
--
-- Colonne NULLABLE, SANS DÉFAUT, et aucune donnée existante touchée. Un
-- `conge_horaire` posé avant cette migration n'a pas de moitié : l'écran ne
-- l'invente pas, il n'affiche rien de plus. Donner un défaut `'matin'`
-- écrirait sur une pièce opposable une affirmation que personne n'a faite.
--
-- La contrainte n'admet que deux valeurs. Une troisième moitié n'existe pas,
-- et une faute de frappe dans un futur écran doit être refusée par la base,
-- pas découverte sur le document d'une famille.
-- ===========================================================================

alter table public.journee
  add column if not exists demi_journee text
  check (demi_journee in ('matin', 'apres_midi'));

comment on column public.journee.demi_journee is
  'Lot 31 §3 — de quelle moitié de journée relève un conge_horaire de demi-journée. '
  'null = non renseigné (pose antérieure à cette migration, ou congé à l''heure '
  'd''une durée libre). Le moteur ne la lit jamais : affichage et document seuls.';
