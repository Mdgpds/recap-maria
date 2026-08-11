-- ============================================================================
-- 012_correctifs_relecture_pr9.sql — Les trois correctifs de la relecture de la
-- PR #9 qui ne peuvent pas vivre dans un écran.
--
-- Un principe, posé au lot 13 et rappelé par cette relecture : CE QUI PROTÈGE
-- MARIA VIT EN BASE. Le client est servi en statique et sa clé circule dans le
-- navigateur ; un contrôle écrit en JavaScript est une courtoisie, jamais une
-- garantie. Les trois points ci-dessous étaient tous des courtoisies.
--
--   1. B7 — le point de départ des compteurs se réécrivait après clôture.
--   2. A4 (lot 14) — la suppression franche emportait les notes en silence.
--   3. A6 (lot 15) — aucune trace d'envoi : ni idempotence, ni rattrapage.
--
-- Conventions inchangées : « drop … if exists » avant chaque create,
-- « if not exists » sur les colonnes, `set search_path = ''`, aucune policy
-- nouvelle, aucun `drop table`, aucun `drop column`.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. B7 — LE POINT DE DÉPART NE SE RÉÉCRIT PAS APRÈS UNE CLÔTURE
--
-- Ce que faisait le lot 14 : l'écran « Reprendre mes comptes » lisait les
-- récapitulatifs du contrat et masquait le formulaire si l'un d'eux était figé.
-- La lecture était enveloppée dans un `catch` qui rendait une liste VIDE.
--
-- Autrement dit, le garde-fou échouait OUVERT. Maria ouvre l'écran dans un
-- tunnel ou sur un réseau qui coupe : la lecture échoue, la liste est vide, le
-- formulaire s'affiche entier, elle saisit, le réseau revient, l'écriture
-- passe. Rien en base ne s'y opposait — `002_rls.sql` accorde `update` sur
-- `compteur_initial` sans aucune condition d'état, et `010` n'y ajoutait qu'un
-- commentaire.
--
-- Pourquoi c'est grave : `chaine-mois.js` repart de `date_reference` et FORCE
-- le compteur aux valeurs saisies au mois de la reprise. Déplacer ce point de
-- départ après coup fait diverger toute la chaîne des mois d'un document déjà
-- parti chez une famille. Le document reste figé — il est protégé — mais plus
-- rien ne s'y raccorde, et aucune trace n'est laissée.
--
-- La règle posée ici est EXACTEMENT celle que l'écran énonçait déjà : dès
-- qu'un mois est clôturé pour ce contrat, le point de départ est arrêté. Rien
-- de neuf n'est décidé ; ce qui était dit est désormais tenu.
-- ----------------------------------------------------------------------------

create or replace function public.proteger_compteur_initial()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  n_figes int;
begin
  select count(*) into n_figes
    from public.recap_mensuel
   where contrat_id = new.contrat_id
     and statut = 'fige';

  if n_figes > 0 then
    /* Le message NOMME la cause. « Modification impossible » tout seul
       laisserait Maria chercher ce qu'elle a mal fait, alors qu'elle n'a rien
       fait de mal : ces chiffres sont simplement devenus le socle de mois
       qu'elle a déjà remis. */
    raise exception
      'contrat % : point de départ non modifiable, % mois déjà clôturé(s) (COMPTEUR_INITIAL_VERROUILLE)',
      new.contrat_id, n_figes
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

-- `security definer` — et c'est délibéré. La fonction lit `recap_mensuel` pour
-- REFUSER. Sous `security invoker`, une policy trop étroite ou une session mal
-- authentifiée ferait retourner zéro ligne au `count(*)`, et le garde
-- laisserait passer. Un garde-fou qui dépend de ce que l'appelant a le droit de
-- voir n'est pas un garde-fou. `set search_path = ''` ferme la porte que
-- `security definer` ouvre.

drop trigger if exists compteur_initial_verrou on public.compteur_initial;
create trigger compteur_initial_verrou
  before insert or update on public.compteur_initial
  for each row execute function public.proteger_compteur_initial();

comment on function public.proteger_compteur_initial() is
  'Refuse d''écrire ou de modifier le point de départ des compteurs d''un '
  'contrat dès qu''un de ses mois est clôturé. La chaîne des mois repart de '
  'ces valeurs : les déplacer après coup ferait diverger tout l''historique '
  'des documents déjà remis aux familles. L''écran énonçait déjà cette règle ; '
  'elle est désormais tenue là où personne ne la contourne (relecture PR9, B7).';


-- ----------------------------------------------------------------------------
-- 2. A4 (lot 14) — LA SUPPRESSION FRANCHE N'EMPORTE PLUS LES NOTES
--
-- `010` comptait `journee` et `recap_mensuel`. `note_mensuelle` est née au
-- lot 12 avec un `on delete cascade`, et `imputation_conge` existe depuis le
-- lot 9 : ni l'une ni l'autre n'entrait dans le décompte. Un contrat portant
-- une note mais aucune journée affichait donc le bouton de suppression ET la
-- phrase « ce contrat ne porte rien : il ne reste rien à conserver ». La
-- phrase était fausse, et la note disparaissait sans un mot.
--
-- LA REMARQUE STRUCTURELLE, qui vaut plus que le correctif lui-même : toute
-- table référençant `contrat` en cascade et créée APRÈS ce trigger héritera du
-- même angle mort. Le décompte ci-dessous est donc écrit table par table,
-- explicitement, pour qu'un oubli se voie à la lecture — et cette phrase est
-- là pour la prochaine personne qui ajoutera une table.
-- ----------------------------------------------------------------------------

create or replace function public.proteger_suppression_contrat()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  n_journees   int;
  n_recaps     int;
  n_notes      int;
  n_imputs     int;
  quoi         text;
begin
  select count(*) into n_journees from public.journee          where contrat_id = old.id;
  select count(*) into n_recaps   from public.recap_mensuel    where contrat_id = old.id;
  select count(*) into n_notes    from public.note_mensuelle   where contrat_id = old.id;
  select count(*) into n_imputs   from public.imputation_conge where contrat_id = old.id;

  if n_journees > 0 or n_recaps > 0 or n_notes > 0 or n_imputs > 0 then
    quoi := '';
    if n_journees > 0 then quoi := quoi || n_journees || ' journée(s) '; end if;
    if n_recaps   > 0 then quoi := quoi || n_recaps   || ' récapitulatif(s) '; end if;
    if n_notes    > 0 then quoi := quoi || n_notes    || ' note(s) '; end if;
    if n_imputs   > 0 then quoi := quoi || n_imputs   || ' congé(s) imputé(s) '; end if;

    raise exception
      'contrat % : suppression impossible, % existent (CONTRAT_NON_VIERGE)',
      old.id, trim(quoi)
      using errcode = 'restrict_violation';
  end if;

  return old;
end;
$$;

-- Le trigger de `010` pointe déjà sur cette fonction : `create or replace`
-- suffit, il n'y a rien à recréer. On le repose tout de même à l'identique,
-- pour qu'une base où `010` n'aurait pas été jouée reste cohérente.
drop trigger if exists contrat_suppression_franche on public.contrat;
create trigger contrat_suppression_franche
  before delete on public.contrat
  for each row execute function public.proteger_suppression_contrat();

comment on function public.proteger_suppression_contrat() is
  'Autorise la suppression d''un contrat UNIQUEMENT s''il ne porte AUCUNE '
  'journée, AUCUN récapitulatif, AUCUNE note et AUCUN congé imputé. Les clés '
  'étrangères qui pointent vers contrat sont en cascade : sans ce garde, un '
  'delete emporterait silencieusement des mois clôturés dont les documents '
  'sont partis chez des familles. ATTENTION : toute table référençant contrat '
  'ajoutée plus tard doit être ajoutée à ce décompte (relecture PR9, A4).';


-- ----------------------------------------------------------------------------
-- 3. A6 (lot 15) — UNE TRACE D'ENVOI, POUR NE NI DOUBLER NI PERDRE UN RAPPEL
--
-- Le seul garde-fou contre l'envoi en boucle était l'égalité entre l'heure
-- réglée et l'heure courante, qui suppose EXACTEMENT une exécution par heure.
-- Deux invocations la même heure — un rejeu du planificateur, un appel
-- manuel — donnaient deux notifications le même jour. Et une exécution ratée à
-- 19 h perdait le rappel du jour, définitivement, sans que rien ne le consigne.
--
-- Une seule colonne règle les deux : la date du dernier envoi, en heure de
-- PARIS. Un envoi déjà fait aujourd'hui ne se refait pas ; un envoi manqué se
-- rattrape à l'exécution suivante, puisque la date d'hier ne vaut pas celle
-- d'aujourd'hui.
--
-- La colonne porte une DATE et non un horodatage : c'est « ai-je déjà prévenu
-- Maria aujourd'hui ? » qu'on veut savoir, et la réponse ne doit pas dépendre
-- du fuseau du serveur. La fonction serveur y écrit la date de Paris qu'elle a
-- déjà calculée pour comparer l'heure.
-- ----------------------------------------------------------------------------

alter table public.preference_rappel
  add column if not exists dernier_envoi_le date;

comment on column public.preference_rappel.dernier_envoi_le is
  'Date PARIS du dernier rappel effectivement envoyé. Sert à deux choses et '
  'deux seulement : ne pas envoyer deux fois le même jour si la fonction est '
  'exécutée plusieurs fois, et permettre à un rappel manqué d''être rattrapé à '
  'l''exécution suivante (relecture PR9, A6). Ne porte aucune donnée métier.';

-- Aucun droit nouveau : `002_rls.sql` puis `011_rappels.sql` accordent déjà
-- `update` sur `preference_rappel` à `authenticated`, et la fonction serveur
-- écrit avec la clé de service. La policy `update` existante suffit — elle
-- porte sur la ligne, pas sur la colonne.
