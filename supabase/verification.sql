-- ============================================================================
-- verification.sql — Contrôles à lancer APRÈS l'application des 3 migrations.
-- (Fichier de contrôle, hors migrations : ne laisse aucune trace en base —
--  tous les tests destructifs sont en transaction annulée par ROLLBACK.)
--
-- Refonte relecture lot 2 (B3, B4) : V1 lit réellement l'expression des
-- policies, V2 montre TOUS les bénéficiaires et tente un accès anon réel,
-- les tests du trigger créent leur propre fixture puis l'annulent.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- V1. RLS actif + policies, AVEC leur expression (pas seulement le compte).
-- Attendu : 24 lignes (6 tables × 4 opérations), rls_actif = true partout,
-- et aucune expression égale à 'true'.
-- ---------------------------------------------------------------------------
select c.relname                               as table_name,
       c.relrowsecurity                        as rls_actif,
       p.polname                               as policy,
       p.polcmd                                as operation,
       pg_get_expr(p.polqual, p.polrelid)      as using_expr,
       pg_get_expr(p.polwithcheck, p.polrelid) as with_check_expr
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policy p on p.polrelid = c.oid
where n.nspname = 'public'
  and c.relname in ('famille','contrat','salaire_contrat',
                    'journee','recap_mensuel','compteur_initial')
order by c.relname, p.polname;

-- V1bis. Détecteur de policy trop permissive : DOIT renvoyer 0 ligne.
select c.relname, p.polname,
       pg_get_expr(p.polqual, p.polrelid) as using_expr
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
join pg_policy p on p.polrelid = c.oid
where n.nspname = 'public'
  and c.relname in ('famille','contrat','salaire_contrat',
                    'journee','recap_mensuel','compteur_initial')
  and (pg_get_expr(p.polqual, p.polrelid) = 'true'
       or pg_get_expr(p.polwithcheck, p.polrelid) = 'true');

-- ---------------------------------------------------------------------------
-- V2. Droits par bénéficiaire, PUBLIC compris (pas de filtre sur grantee).
-- Attendu : uniquement des lignes 'authenticated' avec
-- DELETE, INSERT, SELECT, UPDATE — et AUCUNE ligne anon / PUBLIC.
-- (service_role peut apparaître : c'est voulu, usage serveur.)
-- ---------------------------------------------------------------------------
select table_name, grantee,
       string_agg(privilege_type, ', ' order by privilege_type) as droits
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('famille','contrat','salaire_contrat',
                     'journee','recap_mensuel','compteur_initial')
group by table_name, grantee
order by table_name, grantee;

-- V2bis. Accès réel en tant qu'anon : DOIT être refusé (permission denied).
-- Affiche « TEST OK » si l'accès échoue, « ECHEC » si anon peut lire.
do $$
begin
  set local role anon;
  perform 1 from public.contrat limit 1;
  reset role;
  raise exception 'ECHEC : anon a pu accéder à contrat';
exception
  when insufficient_privilege then
    reset role;
    raise notice 'TEST OK — anon refusé sur contrat (permission denied)';
  when others then
    reset role;
    raise;
end $$;

-- ---------------------------------------------------------------------------
-- V3. Immuabilité — fixture créée puis annulée (ROLLBACK) : aucune trace.
-- Enchaîne : insert brouillon -> passage figé (doit réussir) -> UPDATE d'un
-- figé (doit être rejeté) -> DELETE d'un figé (doit être rejeté).
-- ---------------------------------------------------------------------------
begin;

-- insertion en brouillon (l'insert direct d'un figé est refusé par trigger)
insert into public.recap_mensuel (id, owner, contrat_id, annee, mois, statut, donnees)
select 'ffffffff-0000-4000-8000-0000000000a1', owner,
       'bbbbbbbb-0000-4000-8000-000000000001', 2099, 1, 'brouillon',
       '{"test": "immuabilite"}'::jsonb
from public.contrat where id = 'bbbbbbbb-0000-4000-8000-000000000001';

-- figement brouillon -> fige : DOIT réussir (le trigger lit l'état AVANT)
update public.recap_mensuel
   set statut = 'fige', fige_le = now()
 where id = 'ffffffff-0000-4000-8000-0000000000a1';

-- V3a. UPDATE d'un figé : DOIT être rejeté
do $$
begin
  update public.recap_mensuel
     set donnees = donnees || '{"tentative": "modif"}'::jsonb
   where id = 'ffffffff-0000-4000-8000-0000000000a1';
  raise exception 'ECHEC : la modification d''un figé a été acceptée';
exception
  when others then
    if sqlerrm like '%immuabilité%' then
      raise notice 'TEST OK — modification rejetée par le trigger';
    else raise; end if;
end $$;

-- V3b. DELETE d'un figé : DOIT être rejeté
do $$
begin
  delete from public.recap_mensuel where id = 'ffffffff-0000-4000-8000-0000000000a1';
  raise exception 'ECHEC : la suppression d''un figé a été acceptée';
exception
  when others then
    if sqlerrm like '%immuabilité%' then
      raise notice 'TEST OK — suppression rejetée par le trigger';
    else raise; end if;
end $$;

rollback;   -- rien de tout ceci ne persiste

-- ---------------------------------------------------------------------------
-- V4. Insert direct d'un figé : DOIT être rejeté (relecture lot 2, B5).
-- ---------------------------------------------------------------------------
do $$
begin
  insert into public.recap_mensuel (owner, contrat_id, annee, mois, statut, donnees, fige_le)
  select owner, 'bbbbbbbb-0000-4000-8000-000000000001', 2099, 2, 'fige',
         '{"test": "insert fige"}'::jsonb, now()
  from public.contrat where id = 'bbbbbbbb-0000-4000-8000-000000000001';
  raise exception 'ECHEC : un figé a pu être inséré directement';
exception
  when others then
    if sqlerrm like '%brouillon%' or sqlerrm like '%fige%' then
      raise notice 'TEST OK — insertion directe d''un figé rejetée';
    else raise; end if;
end $$;

-- ---------------------------------------------------------------------------
-- V5. Garde-fous numériques (relecture lot 2, B2) : chacun DOIT échouer.
-- ---------------------------------------------------------------------------
do $$
declare v_owner uuid; v_fam uuid; nb int := 0;
begin
  select owner, id into v_owner, v_fam from public.famille limit 1;
  if v_fam is null then raise notice 'V5 ignoré : pas de donnée de seed'; return; end if;

  begin
    insert into public.contrat (owner, famille_id, prenom_enfant, date_debut, minutes_par_jour_conge)
    values (v_owner, v_fam, 'X', '2025-01-01', 0);
    raise exception 'ECHEC : minutes_par_jour_conge = 0 accepté';
  exception when check_violation then nb := nb + 1; end;

  begin
    insert into public.contrat (owner, famille_id, prenom_enfant, date_debut, date_fin)
    values (v_owner, v_fam, 'X', '2025-06-01', '2024-01-01');
    raise exception 'ECHEC : date_fin < date_debut accepté';
  exception when check_violation then nb := nb + 1; end;

  begin
    insert into public.contrat (owner, famille_id, prenom_enfant, date_debut, jours_planning)
    values (v_owner, v_fam, 'X', '2025-01-01', '{0,9}');
    raise exception 'ECHEC : jours_planning {0,9} accepté';
  exception when check_violation then nb := nb + 1; end;

  raise notice 'TEST OK — % garde-fous numériques ont rejeté les valeurs invalides (attendu 3)', nb;
end $$;

-- ---------------------------------------------------------------------------
-- V7. Champ d'audit sur un récap figé (décision Adrien) : la modification du
-- SEUL champ d'audit doit être ACCEPTÉE, celle d'un autre champ REJETÉE.
-- Fixture créée puis annulée (ROLLBACK) : aucune trace.
-- ---------------------------------------------------------------------------
begin;

insert into public.recap_mensuel (id, owner, contrat_id, annee, mois, statut, donnees)
select 'ffffffff-0000-4000-8000-0000000000a2', owner,
       'bbbbbbbb-0000-4000-8000-000000000001', 2099, 3, 'brouillon', '{"t":1}'::jsonb
from public.contrat where id = 'bbbbbbbb-0000-4000-8000-000000000001';

update public.recap_mensuel set statut = 'fige', fige_le = now()
 where id = 'ffffffff-0000-4000-8000-0000000000a2';

-- V7a. Modifier uniquement l'audit : DOIT réussir
do $$
begin
  update public.recap_mensuel
     set audit_note = 'correction tracée', audit_le = now()
   where id = 'ffffffff-0000-4000-8000-0000000000a2';
  raise notice 'TEST OK — champ d''audit modifiable sur un figé';
exception
  when others then
    raise notice 'ECHEC : audit refusé alors qu''il devrait passer : %', sqlerrm;
end $$;

-- V7b. Modifier une VRAIE donnée : DOIT être rejeté
do $$
begin
  update public.recap_mensuel set donnees = '{"x":2}'::jsonb
   where id = 'ffffffff-0000-4000-8000-0000000000a2';
  raise notice 'ECHEC : donnees modifiée sur un figé';
exception
  when others then
    if sqlerrm like '%immuabilité%' then
      raise notice 'TEST OK — modification de donnees rejetée sur un figé';
    else raise; end if;
end $$;

rollback;

-- ---------------------------------------------------------------------------
-- V6. Rejouabilité du seed : relancer 003_seed_dev.sql une 2e fois ne doit
-- provoquer aucune erreur et aucun doublon. Comptages attendus :
-- famille 4, contrat 4, salaire_contrat 5, journee 10, compteur_initial 4,
-- recap_mensuel 1 (brouillon).
-- ---------------------------------------------------------------------------
select
  (select count(*) from public.famille)          as familles,
  (select count(*) from public.contrat)          as contrats,
  (select count(*) from public.salaire_contrat)  as salaires,
  (select count(*) from public.journee)          as journees,
  (select count(*) from public.compteur_initial) as compteurs,
  (select count(*) from public.recap_mensuel)    as recaps;
