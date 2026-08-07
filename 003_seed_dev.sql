-- ============================================================================
-- 003_seed_dev.sql — Jeu de données de développement.
--
-- DONNÉES 100 % FICTIVES : le dépôt est public, aucun prénom, salaire ou
-- montant réel de Maria n'apparaît ici (§8 des specs). Les montants
-- reprennent les valeurs d'exemple du §7 des specs (137289 / 132745), qui
-- sont déjà publiques dans le dépôt via les tests.
--
-- Idempotent : UUID fixes + on conflict do nothing — rejouable sans effet
-- de bord sur une base déjà seedée.
--
-- Owner : premier utilisateur auth existant (ordre de création), sinon un
-- UUID de développement. Dans ce second cas les lignes restent invisibles
-- de l'application tant qu'aucun compte ne porte cet identifiant —
-- comportement voulu pour un seed appliqué avant la création du compte.
-- ============================================================================

do $$
declare
  v_owner uuid;
begin
  select id into v_owner from auth.users order by created_at limit 1;
  if v_owner is null then
    v_owner := '00000000-0000-4000-8000-0000000000de'::uuid;  -- uuid de dev
  end if;

  -- --- 4 familles fictives -------------------------------------------------
  insert into public.famille (id, owner, nom, canal) values
    ('aaaaaaaa-0000-4000-8000-000000000001', v_owner, 'Famille Papillon',  'WhatsApp Papillon'),
    ('aaaaaaaa-0000-4000-8000-000000000002', v_owner, 'Famille Libellule', 'WhatsApp Libellule'),
    ('aaaaaaaa-0000-4000-8000-000000000003', v_owner, 'Famille Colibri',   'WhatsApp Colibri'),
    ('aaaaaaaa-0000-4000-8000-000000000004', v_owner, 'Famille Luciole',   'WhatsApp Luciole')
  on conflict (id) do nothing;

  -- --- 4 contrats fictifs, mêmes planning/horaires (cahier §3) -------------
  insert into public.contrat
    (id, owner, famille_id, prenom_enfant, date_debut, date_fin,
     jours_planning, heure_arrivee, heure_depart,
     minutes_contractuelles, minutes_sup_jour, minutes_par_jour_conge,
     entretien_centimes_jour, statut, sup_dues_si_enfant_absent, ordre_imputation)
  values
    ('bbbbbbbb-0000-4000-8000-000000000001', v_owner, 'aaaaaaaa-0000-4000-8000-000000000001',
     'Alpha', '2024-09-02', null, '{1,2,3,4,5}', '08:30', '18:00',
     540, 30, 540, 500, 'actif', true, 'cp_puis_sup'),
    ('bbbbbbbb-0000-4000-8000-000000000002', v_owner, 'aaaaaaaa-0000-4000-8000-000000000002',
     'Bravo', '2024-10-01', null, '{1,2,3,4,5}', '08:30', '18:00',
     540, 30, 540, 500, 'actif', true, 'cp_puis_sup'),
    ('bbbbbbbb-0000-4000-8000-000000000003', v_owner, 'aaaaaaaa-0000-4000-8000-000000000003',
     'Charlie', '2025-01-06', null, '{1,2,3,4,5}', '08:30', '18:00',
     540, 30, 540, 500, 'actif', true, 'sup_puis_cp'),
    ('bbbbbbbb-0000-4000-8000-000000000004', v_owner, 'aaaaaaaa-0000-4000-8000-000000000004',
     'Delta', '2025-03-03', null, '{1,2,3,4,5}', '08:30', '18:00',
     540, 30, 540, 500, 'actif', false, 'cp_puis_sup')
  on conflict (id) do nothing;

  -- --- Historique de salaire (RG-15) : le contrat Alpha a un changement ----
  insert into public.salaire_contrat
    (id, owner, contrat_id, date_effet, brut_mensuel_centimes, net_mensuel_centimes)
  values
    ('cccccccc-0000-4000-8000-000000000001', v_owner, 'bbbbbbbb-0000-4000-8000-000000000001',
     '2024-09-02', 132745, 103500),
    ('cccccccc-0000-4000-8000-000000000002', v_owner, 'bbbbbbbb-0000-4000-8000-000000000001',
     '2025-04-01', 137289, 107200),
    ('cccccccc-0000-4000-8000-000000000003', v_owner, 'bbbbbbbb-0000-4000-8000-000000000002',
     '2024-10-01', 137289, 107200),
    ('cccccccc-0000-4000-8000-000000000004', v_owner, 'bbbbbbbb-0000-4000-8000-000000000003',
     '2025-01-06', 132745, 103500),
    ('cccccccc-0000-4000-8000-000000000005', v_owner, 'bbbbbbbb-0000-4000-8000-000000000004',
     '2025-03-03', 137289, 107200)
  on conflict (id) do nothing;

  -- --- Journées d'exception (saisie par exception, §5 des specs) -----------
  -- Alpha : 3 absences enfant en septembre 2025 (cas T2)
  -- Bravo : semaine de congé de Maria du 7 au 11 avril 2025 (cas T4)
  -- Delta : 2 jours de familiarisation au démarrage (RG-14, saisie manuelle)
  insert into public.journee
    (id, owner, contrat_id, jour, type, minutes_reelles, entretien_centimes, commentaire)
  values
    ('dddddddd-0000-4000-8000-000000000001', v_owner, 'bbbbbbbb-0000-4000-8000-000000000001',
     '2025-09-03', 'absence_enfant', null, null, 'malade'),
    ('dddddddd-0000-4000-8000-000000000002', v_owner, 'bbbbbbbb-0000-4000-8000-000000000001',
     '2025-09-10', 'absence_enfant', null, null, null),
    ('dddddddd-0000-4000-8000-000000000003', v_owner, 'bbbbbbbb-0000-4000-8000-000000000001',
     '2025-09-17', 'absence_enfant', null, null, null),
    ('dddddddd-0000-4000-8000-000000000004', v_owner, 'bbbbbbbb-0000-4000-8000-000000000002',
     '2025-04-07', 'conge_maria', null, null, 'vacances'),
    ('dddddddd-0000-4000-8000-000000000005', v_owner, 'bbbbbbbb-0000-4000-8000-000000000002',
     '2025-04-08', 'conge_maria', null, null, null),
    ('dddddddd-0000-4000-8000-000000000006', v_owner, 'bbbbbbbb-0000-4000-8000-000000000002',
     '2025-04-09', 'conge_maria', null, null, null),
    ('dddddddd-0000-4000-8000-000000000007', v_owner, 'bbbbbbbb-0000-4000-8000-000000000002',
     '2025-04-10', 'conge_maria', null, null, null),
    ('dddddddd-0000-4000-8000-000000000008', v_owner, 'bbbbbbbb-0000-4000-8000-000000000002',
     '2025-04-11', 'conge_maria', null, null, null),
    ('dddddddd-0000-4000-8000-000000000009', v_owner, 'bbbbbbbb-0000-4000-8000-000000000004',
     '2025-03-03', 'familiarisation', 240, 300, 'familiarisation j1'),
    ('dddddddd-0000-4000-8000-000000000010', v_owner, 'bbbbbbbb-0000-4000-8000-000000000004',
     '2025-03-04', 'familiarisation', 300, 300, 'familiarisation j2')
  on conflict (id) do nothing;

  -- --- Compteurs initiaux (reprise manuelle, cahier §7) --------------------
  insert into public.compteur_initial
    (contrat_id, owner, date_reference, minutes_sup, dixiemes_cp_acquis, dixiemes_cp_pris)
  values
    ('bbbbbbbb-0000-4000-8000-000000000001', v_owner, '2025-09-01',  600, 50, 0),
    ('bbbbbbbb-0000-4000-8000-000000000002', v_owner, '2025-09-01', 2400, 20, 0),
    ('bbbbbbbb-0000-4000-8000-000000000003', v_owner, '2025-09-01', 1080, 30, 0),
    ('bbbbbbbb-0000-4000-8000-000000000004', v_owner, '2025-09-01',    0,  0, 0)
  on conflict (contrat_id) do nothing;

  -- --- Un récap déjà figé, pour vérifier l'immuabilité en conditions réelles
  insert into public.recap_mensuel
    (id, owner, contrat_id, annee, mois, statut, donnees, fige_le)
  values
    ('eeeeeeee-0000-4000-8000-000000000001', v_owner, 'bbbbbbbb-0000-4000-8000-000000000001',
     2025, 3, 'fige',
     '{"seed": true, "salaireBrutCentimes": 132745, "commentaire": "instantané fictif de démonstration"}'::jsonb,
     '2025-04-02T09:00:00Z')
  on conflict (id) do nothing;
end
$$;
