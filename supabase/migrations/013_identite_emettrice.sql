-- ============================================================================
-- 013_identite_emettrice.sql — LOT 16 §16.2 — Le nom qui signe les documents.
--
-- LE PROBLÈME. `enTeteAuteur` (js/ui-document.js) écrivait « Établi par
-- <adresse de connexion>, assistante maternelle ». La pièce dont le seul métier
-- est d'éteindre un désaccord avec une famille était donc signée par une
-- adresse e-mail — celle du compte, qui n'a aucun rapport avec l'identité de
-- l'assistante maternelle. Le code portait un `// TODO RÈGLE ABSENTE` renvoyant
-- au lot 14, qui n'a jamais été fait.
--
-- CE QUE FAIT CETTE MIGRATION. Une table `emettrice`, une ligne par `owner`,
-- un champ `nom` libre. Rien de plus : ni profession, ni numéro d'agrément —
-- la ligne du document devient exactement « Établi par <nom> ».
--
-- Sécurité : `owner` par défaut `auth.uid()`, RLS activée, `revoke all` puis
-- policies explicites par opération, sur le modèle de 002_rls.sql.
-- JAMAIS de `using (true)`. Les policies utilisent `(select auth.uid())`,
-- évalué une fois par requête (advisor auth_rls_initplan).
--
-- `drop policy if exists` avant chaque `create` : la migration se rejoue sans
-- erreur (relecture lot 2, B7).
--
-- AUCUNE DONNÉE N'EST ÉCRITE ICI. Tant que Maria n'a rien saisi, aucune ligne
-- n'existe et le document écrit « votre assistante maternelle » — jamais une
-- adresse.
-- ============================================================================

create table if not exists public.emettrice (
  owner      uuid primary key default auth.uid(),
  nom        text not null,
  updated_at timestamptz not null default now(),

  -- Un nom vide n'est pas un nom : il ferait écrire « Établi par  » sur un
  -- document remis à une famille. On refuse à la source plutôt que de laisser
  -- l'écran deviner.
  constraint emettrice_nom_non_vide check (length(btrim(nom)) > 0),
  -- Garde-fou de saisie : au-delà, c'est une erreur de collage, pas un nom.
  constraint emettrice_nom_borne    check (length(nom) <= 120)
);

comment on table public.emettrice is
  'Identité qui signe les récapitulatifs remis aux familles (lot 16 §16.2). '
  'Une ligne par compte. Le nom entre dans l''instantané de clôture : un mois '
  'clôturé garde le nom qu''il portait au moment de la clôture.';

comment on column public.emettrice.nom is
  'Nom affiché sur les documents, tel que Maria le saisit. Ni profession ni '
  'numéro d''agrément : la ligne est exactement « Établi par <nom> ».';

-- --- Exposition explicite et RLS -------------------------------------------

revoke all on public.emettrice from anon, authenticated, public;
grant select, insert, update, delete on public.emettrice to authenticated;
alter table public.emettrice enable row level security;

drop policy if exists emettrice_select on public.emettrice;
create policy emettrice_select on public.emettrice
  for select to authenticated using (owner = (select auth.uid()));

drop policy if exists emettrice_insert on public.emettrice;
create policy emettrice_insert on public.emettrice
  for insert to authenticated with check (owner = (select auth.uid()));

drop policy if exists emettrice_update on public.emettrice;
create policy emettrice_update on public.emettrice
  for update to authenticated
  using (owner = (select auth.uid()))
  with check (owner = (select auth.uid()));

-- La suppression reste possible : Maria doit pouvoir retirer son nom. Les
-- documents DÉJÀ CLÔTURÉS ne bougent pas — ils portent le nom dans leur
-- instantané, pas une référence à cette table.
drop policy if exists emettrice_delete on public.emettrice;
create policy emettrice_delete on public.emettrice
  for delete to authenticated using (owner = (select auth.uid()));

-- ============================================================================
-- LOT 16 §16.5 — L'HEURE DE FIN D'ACCUEIL PAR DÉFAUT.
--
-- Le schéma posait `heure_depart` à 18:00 ET `minutes_contractuelles` à 540
-- (9 h). Or 8h30 → 18h00 fait 9h30 : les deux valeurs se contredisaient, et
-- l'écran de création annonçait « 8h30 → 17h30 » tout en laissant la base
-- écrire 18:00.
--
-- C'est l'heure de fin qui est fausse. L'ACCUEIL s'arrête à 17h30 ; les 30
-- minutes supplémentaires viennent après et sont portées par
-- `minutes_sup_jour`. L'enfant repart bien vers 18 h.
--
-- SEUL LE DÉFAUT CHANGE. Les contrats existants qui portent 18:00 ne sont PAS
-- modifiés ici : ils sont signalés à Adrien, qui décide. Une écriture de
-- donnée métier ne se fait jamais dans une migration, et surtout pas en
-- silence — voir la requête de contrôle en commentaire ci-dessous.
--
-- À NOTER. Aujourd'hui `heure_depart` n'est lu par aucun calcul : le moteur ne
-- s'en sert pas. Le lot 17 en fait la référence d'une journée (fin d'accueil +
-- minutes supplémentaires). Les contrats restés à 18:00 donneraient alors une
-- référence à 18h30, et toute déclaration d'horaire au jour serait décalée
-- de 30 minutes. La correction des contrats existants doit donc être faite
-- AVANT la mise en production du lot 17.
-- ============================================================================

alter table public.contrat alter column heure_depart set default '17:30';

comment on column public.contrat.heure_depart is
  'Fin de l''ACCUEIL, pas fin de journée (lot 16 §16.5). Les minutes '
  'supplémentaires du contrat (minutes_sup_jour) viennent après : avec 17:30 '
  'et 30 minutes, l''enfant repart vers 18 h. Le couple heure_arrivee → '
  'heure_depart doit rester cohérent avec minutes_contractuelles.';

-- Contrôle à exécuter par Adrien, en LECTURE SEULE, pour la liste des contrats
-- concernés (aucune écriture n'est faite par cette migration) :
--
--   select id, prenom_enfant, heure_arrivee, heure_depart, minutes_contractuelles
--     from public.contrat
--    where heure_depart <> '17:30'
--       or (extract(epoch from (heure_depart - heure_arrivee)) / 60)
--           <> minutes_contractuelles;
