-- ============================================================================
-- 015 — LE NUMÉRO D'UN AVENANT DEVIENT UNE IDENTITÉ, POSÉE PAR LA BASE.
--
-- CE QUE CETTE MIGRATION CORRIGE, ET POURQUOI ELLE EST URGENTE.
--
-- La migration `014` crée `avenant_contrat.numero` en `int`, SANS valeur par
-- défaut, puis le rend `not null`. Aucun trigger ne le remplit. Côté
-- navigateur, `numero` est délibérément exclu des champs transmis : il était
-- censé être posé APRÈS l'insertion, par une renumérotation.
--
-- L'insertion part donc sans `numero`, contre une colonne `not null`. Résultat
-- en production, sur tous les contrats, à tous les coups :
--
--     23502 null value in column "numero" violates not-null constraint
--
-- « Faire un avenant » est LA fonction du lot 17. Sans elle, le lot livre une
-- table datée, un moteur qui lit des conditions datées, et aucun moyen d'en
-- poser une seule.
--
-- LA DÉCISION D'ADRIEN : le numéro est une IDENTITÉ, pas un rang.
--
-- C'est le numéro que Maria cite à une famille. « L'avenant n° 2 » doit rester
-- le n° 2, même si une date est corrigée plus tard. Il est donc attribué une
-- fois, à la création, et ne change plus jamais.
--
-- Cette décision fait tomber deux anomalies d'un coup :
--   - la création d'un avenant aboutit (le défaut ci-dessus) ;
--   - la renumérotation disparaît, et avec elle son échec sur une permutation
--     cyclique : corriger la date d'un avenant vers l'amont écrivait la date,
--     puis échouait sur l'index unique, et annonçait un échec total alors que
--     la date avait bien changé.
--
-- L'ORDRE D'AFFICHAGE NE CHANGE PAS. La frise, le moteur et la chaîne trient
-- par `date_effet` — jamais par `numero`. Un numéro non monotone dans la frise
-- est donc possible après une correction de date, et c'est le comportement
-- voulu : c'est une référence, pas un rang.
--
-- CETTE MIGRATION NE TOUCHE À AUCUNE DONNÉE MÉTIER. Elle ne modifie aucun
-- montant, aucune date, aucun réglage. Les onze avenants reconstitués par
-- `014` gardent les numéros que `014` leur a donnés.
--
-- Rejouable : `create or replace`, `drop trigger if exists`.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Le numéro suivant, pour un contrat
-- ---------------------------------------------------------------------------

-- `security definer` n'est PAS utilisé : la fonction ne lit que la table que
-- l'appelant a déjà le droit de lire, sous sa propre RLS. Un `definer` ici
-- laisserait un propriétaire compter les avenants d'un autre.
create or replace function public.avenant_numero_suivant()
returns trigger
language plpgsql
as $$
begin
  -- Seulement si l'appelant n'a rien posé : un import qui fournit ses numéros
  -- reste maître des siens.
  if new.numero is null then
    select coalesce(max(a.numero), 0) + 1
      into new.numero
      from public.avenant_contrat a
     where a.contrat_id = new.contrat_id;
  end if;
  return new;
end;
$$;

drop trigger if exists avenant_contrat_numero on public.avenant_contrat;

create trigger avenant_contrat_numero
  before insert on public.avenant_contrat
  for each row
  execute function public.avenant_numero_suivant();

-- ---------------------------------------------------------------------------
-- 2. Le numéro ne se corrige plus après coup
-- ---------------------------------------------------------------------------

-- Une identité qui change n'est pas une identité. La garde vit en base, et pas
-- seulement dans l'écran : c'est la seule qui tienne si un jour un autre
-- chemin d'écriture existe.
create or replace function public.avenant_numero_immuable()
returns trigger
language plpgsql
as $$
begin
  if new.numero is distinct from old.numero then
    raise exception 'avenant_numero_immuable'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists avenant_contrat_numero_fige on public.avenant_contrat;

create trigger avenant_contrat_numero_fige
  before update on public.avenant_contrat
  for each row
  execute function public.avenant_numero_immuable();

-- ---------------------------------------------------------------------------
-- 3. Contrôle
-- ---------------------------------------------------------------------------

-- L'index unique `(contrat_id, numero)` de la `014` est CONSERVÉ : il reste la
-- garantie qu'un numéro ne désigne qu'un avenant. Avec une identité figée, il
-- ne peut plus être mis en défaut par une permutation.
--
-- UN NUMÉRO LIBÉRÉ PAR UNE SUPPRESSION EST RÉUTILISÉ. C'est assumé : un
-- avenant ne peut être supprimé que si AUCUN mois clôturé ne s'appuie sur lui
-- (§17.4). Un numéro déjà cité à une famille sur un document ne peut donc pas
-- être libéré.

comment on column public.avenant_contrat.numero is
  'Identité de l''avenant pour son contrat, posée à la création et immuable. '
  'N''est PAS un rang : l''ordre d''application vient de date_effet.';

-- ============================================================================
-- 4. CORRECTION C2 — LA DURÉE D'UN JOUR DE CONGÉ EST UN MULTIPLE DE 10 MINUTES
--
-- CE QUE ÇA CORRIGE. Le moteur convertit l'acquisition mensuelle de congés
-- payés par `Math.round(25 * minutes_par_jour_conge / 10)` ; la migration
-- `014` a converti les compteurs existants par `(dixiemes * minutes) / 10` en
-- division entière SQL, qui TRONQUE.
--
-- Les deux ne donnent le même résultat que si le produit tombe juste. Pour
-- 545 minutes et 25 dixièmes : le moteur retient 1363, la migration écrivait
-- 1362. Un demi-point de minute par mois, cumulatif, invisible, en faveur de
-- Maria — mesuré à 30 minutes d'écart au bout de 60 mois.
--
-- La contrainte rend la divergence IMPOSSIBLE plutôt que de l'harmoniser :
-- un multiple de 10 donne toujours un produit entier, et les deux
-- arithmétiques coïncident exactement.
--
-- Aucun contrat réel n'est concerné : ils sont tous à 540 minutes. La
-- contrainte est posée `not valid` puis validée, pour que l'échec — s'il y en
-- avait un — nomme la ligne fautive au lieu de faire échouer la migration
-- entière sans rien dire.
-- ============================================================================

alter table public.avenant_contrat
  drop constraint if exists avenant_minutes_par_jour_conge_decimal;

alter table public.avenant_contrat
  add constraint avenant_minutes_par_jour_conge_decimal
  check (minutes_par_jour_conge % 10 = 0) not valid;

alter table public.avenant_contrat
  validate constraint avenant_minutes_par_jour_conge_decimal;

comment on constraint avenant_minutes_par_jour_conge_decimal on public.avenant_contrat is
  'Multiple de 10 : garantit que la conversion dixièmes <-> minutes donne le '
  'même entier dans le moteur (Math.round) et en SQL (division entière).';
