-- ============================================================================
-- 003_seed_dev.sql — Jeu de données de développement.
--
-- DONNÉES 100 % FICTIVES : le dépôt est public, aucun prénom, salaire ou
-- montant réel de Maria n'apparaît ici (§8 des specs).
--
-- CORRECTION RELECTURE LOT 16 (contrôle 7). Ce commentaire affirmait le
-- contraire de ce que le fichier contenait : les deux montants bruts qui s'y
-- trouvaient n'étaient pas des « valeurs d'exemple », c'étaient LES SALAIRES
-- RÉELS de Maria (référentiel A.4), dans un dépôt public. Ils sont remplacés
-- par des montants manifestement fictifs et ronds — 1 500,00 € et 1 400,00 €
-- brut, avec des nets arrondis — qui ne ressemblent à aucune paie réelle.
--
-- Un montant seul n'identifie personne, mais un jeu de développement n'a
-- aucune raison de porter la rémunération de quelqu'un. Règle à tenir : dans
-- ce fichier, tout nombre est rond et faux.
--
-- L'historique git n'est pas réécrit — décision d'Adrien : un force-push sur
-- une branche qui porte plusieurs lots en cours est un risque réel pour un
-- bénéfice faible, ces valeurs étant publiques depuis le lot 2.
--
-- Idempotent : UUID fixes + « on conflict do nothing » SANS colonne, ce qui
-- couvre toutes les contraintes uniques, y compris les uniques métier
-- (contrat_id, jour) etc. (relecture lot 2, B1).
--
-- N'insère AUCUN récap figé (relecture lot 2, A2) : un figé serait
-- indestructible et rendrait contrat/famille non supprimables, et
-- l'owner irrattrapable si le seed tourne avant la création du compte. Le
-- récap de démonstration est en « brouillon » et daté APRÈS la date de
-- reprise des compteurs (relecture lot 2, B6). Le test du trigger figé est
-- désormais fait par verification.sql, en transaction annulée (rollback).
--
-- Owner : premier utilisateur auth existant, sinon UUID de développement
-- (lignes alors invisibles de l'application tant qu'aucun compte n'existe).
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
  on conflict do nothing;

  -- --- 4 contrats fictifs, mêmes planning/horaires (cahier §3) -------------
  -- Delta est en période de familiarisation (cohérent avec ses journées, B6).
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
     540, 30, 540, 500, 'familiarisation', false, 'cp_puis_sup')
  on conflict do nothing;

  -- --- Historique de salaire (RG-15) : le contrat Alpha a un changement ----
  insert into public.salaire_contrat
    (id, owner, contrat_id, date_effet, brut_mensuel_centimes, net_mensuel_centimes)
  values
    ('cccccccc-0000-4000-8000-000000000001', v_owner, 'bbbbbbbb-0000-4000-8000-000000000001',
     '2024-09-02', 140000, 108000),
    ('cccccccc-0000-4000-8000-000000000002', v_owner, 'bbbbbbbb-0000-4000-8000-000000000001',
     '2025-04-01', 150000, 115000),
    ('cccccccc-0000-4000-8000-000000000003', v_owner, 'bbbbbbbb-0000-4000-8000-000000000002',
     '2024-10-01', 150000, 115000),
    ('cccccccc-0000-4000-8000-000000000004', v_owner, 'bbbbbbbb-0000-4000-8000-000000000003',
     '2025-01-06', 140000, 108000),
    ('cccccccc-0000-4000-8000-000000000005', v_owner, 'bbbbbbbb-0000-4000-8000-000000000004',
     '2025-03-03', 150000, 115000)
  on conflict do nothing;

  -- --- Journées d'exception (saisie par exception, §5 des specs) -----------
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
  on conflict do nothing;

  -- --- Compteurs initiaux (reprise manuelle, cahier §7) --------------------
  insert into public.compteur_initial
    (contrat_id, owner, date_reference, minutes_sup, dixiemes_cp_acquis, dixiemes_cp_pris)
  values
    ('bbbbbbbb-0000-4000-8000-000000000001', v_owner, '2025-09-01',  600, 50, 0),
    ('bbbbbbbb-0000-4000-8000-000000000002', v_owner, '2025-09-01', 2400, 20, 0),
    ('bbbbbbbb-0000-4000-8000-000000000003', v_owner, '2025-09-01', 1080, 30, 0),
    ('bbbbbbbb-0000-4000-8000-000000000004', v_owner, '2025-09-01',    0,  0, 0)
  on conflict do nothing;

  -- --- Un récap de démonstration, en BROUILLON, daté APRÈS la reprise ------
  -- (septembre 2025 >= date_reference 2025-09-01). Aucun figé n'est semé :
  -- le figement est un acte applicatif, testé par verification.sql.
  insert into public.recap_mensuel
    (id, owner, contrat_id, annee, mois, statut, donnees, fige_le)
  values
    ('eeeeeeee-0000-4000-8000-000000000001', v_owner, 'bbbbbbbb-0000-4000-8000-000000000001',
     2025, 9, 'brouillon',
     '{"seed": true, "commentaire": "brouillon fictif de démonstration"}'::jsonb,
     null)
  on conflict do nothing;
end
$$;
