-- ============================================================================
-- verification.sql — Contrôles à lancer APRÈS l'application des 3 migrations.
-- (Fichier de contrôle, hors migrations : ne modifie rien en base.)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- V1. RLS actif et policies présentes sur chaque table.
-- Attendu : 6 lignes, rls_actif = true partout, nb_policies = 4 partout
-- (select / insert / update / delete).
-- ---------------------------------------------------------------------------
select c.relname                                   as table_name,
       c.relrowsecurity                            as rls_actif,
       count(p.polname)                            as nb_policies,
       array_agg(p.polname order by p.polname)     as policies
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policy p on p.polrelid = c.oid
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relname in ('famille','contrat','salaire_contrat',
                    'journee','recap_mensuel','compteur_initial')
group by c.relname, c.relrowsecurity
order by c.relname;

-- ---------------------------------------------------------------------------
-- V2. Exposition : droits par rôle.
-- Attendu : pour chaque table, une seule ligne « authenticated » avec
-- DELETE, INSERT, SELECT, UPDATE — et AUCUNE ligne « anon ».
-- ---------------------------------------------------------------------------
select table_name, grantee,
       string_agg(privilege_type, ', ' order by privilege_type) as droits
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('famille','contrat','salaire_contrat',
                     'journee','recap_mensuel','compteur_initial')
  and grantee in ('anon','authenticated')
group by table_name, grantee
order by table_name, grantee;

-- ---------------------------------------------------------------------------
-- V3. Test du trigger d'immuabilité — version brute.
-- Cet UPDATE DOIT ÉCHOUER avec le message :
-- « recap_mensuel … est figé : toute modification ou suppression est
--   interdite (immuabilité) ».
-- (Nécessite 003_seed_dev.sql : le récap figé de test en fait partie.)
-- ---------------------------------------------------------------------------
-- update public.recap_mensuel
--    set donnees = donnees || '{"tentative": "modification"}'::jsonb
--  where id = 'eeeeeeee-0000-4000-8000-000000000001';

-- ---------------------------------------------------------------------------
-- V4. Test du trigger — version auto-vérifiante (à lancer telle quelle).
-- Affiche « TEST OK — modification rejetée par le trigger : … » dans les
-- messages (onglet Results/Messages du dashboard). Ne laisse aucune trace.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from public.recap_mensuel
                 where id = 'eeeeeeee-0000-4000-8000-000000000001') then
    raise exception 'Recap de test introuvable : appliquer 003_seed_dev.sql d''abord';
  end if;

  update public.recap_mensuel
     set donnees = donnees || '{"tentative": "modification"}'::jsonb
   where id = 'eeeeeeee-0000-4000-8000-000000000001';

  -- Si on arrive ici, le trigger n'a pas rejeté l'UPDATE : échec du test.
  raise exception 'ECHEC DU TEST : la ligne a ete modifiee — trigger absent ou inactif';
exception
  when others then
    if sqlerrm like '%immuabilité%' then
      raise notice 'TEST OK — modification rejetée par le trigger : %', sqlerrm;
    else
      raise;
    end if;
end $$;

-- ---------------------------------------------------------------------------
-- V5. Idem pour la suppression : ce DELETE DOIT ÉCHOUER lui aussi.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from public.recap_mensuel
                 where id = 'eeeeeeee-0000-4000-8000-000000000001') then
    raise exception 'Recap de test introuvable : appliquer 003_seed_dev.sql d''abord';
  end if;

  delete from public.recap_mensuel
   where id = 'eeeeeeee-0000-4000-8000-000000000001';

  raise exception 'ECHEC DU TEST : la ligne a ete supprimee — trigger absent ou inactif';
exception
  when others then
    if sqlerrm like '%immuabilité%' then
      raise notice 'TEST OK — suppression rejetée par le trigger : %', sqlerrm;
    else
      raise;
    end if;
end $$;

-- ---------------------------------------------------------------------------
-- V6. Le passage brouillon -> figé reste permis (contre-épreuve).
-- Crée un brouillon sur le contrat de seed, le fige, vérifie, puis le
-- laisse en place figé (il ne peut plus être supprimé — c'est le principe).
-- À ne lancer qu'une fois ; relance = no-op grâce au on conflict.
-- ---------------------------------------------------------------------------
-- insert into public.recap_mensuel (id, owner, contrat_id, annee, mois, statut, donnees)
-- select 'eeeeeeee-0000-4000-8000-000000000002', owner,
--        'bbbbbbbb-0000-4000-8000-000000000001', 2025, 6, 'brouillon',
--        '{"seed": true, "test": "figement"}'::jsonb
--   from public.contrat where id = 'bbbbbbbb-0000-4000-8000-000000000001'
-- on conflict (id) do nothing;
--
-- update public.recap_mensuel
--    set statut = 'fige', fige_le = now()
--  where id = 'eeeeeeee-0000-4000-8000-000000000002'
--    and statut = 'brouillon';   -- doit réussir : l'état AVANT est brouillon
