-- ============================================================================
-- 017 — LE CONGÉ POSÉ À L'HEURE (§21.1 à §21.3 du lot 21).
--
-- POURQUOI CETTE MIGRATION EXISTE, ALORS QUE LE LOT 21 N'EN PRÉVOYAIT AUCUNE.
--
-- La spécification écrit « Migration : aucune — les congés payés sont en
-- minutes depuis `014` ». C'est vrai des COMPTEURS, et faux du congé lui-même :
-- aucune table existante ne peut porter une pose de 23 minutes.
--
--   * `imputation_conge` est en JOURS ENTIERS : `jours_ouvrables > 0`, entier,
--     et `imputation_complete` exige que la ventilation les couvre exactement.
--     Une pose de 1 h 34 n'y entre pas.
--
--   * `journee.ecart_*` porte exactement ce qu'il faut — des minutes SIGNÉES
--     et une destination parmi récupération, congés payés et sans solde. Mais
--     `journee_ecart_evenement_valide` n'admet que trois événements, et aucun
--     ne veut dire « congé ».
--
-- Détourner `liberation_anticipee` aurait marché sans migration. Le document
-- remis à la famille aurait alors écrit, par la ligne du §17.5 : « dont 1 h 34
-- que je n'ai pas gardée le 8 octobre — libération anticipée ». C'est FAUX, et
-- c'est faux sur une pièce opposable des années plus tard. Un quatrième
-- événement de six lignes coûte moins cher qu'un document qui ment.
--
-- DÉCISION D'ADRIEN, 23 août 2026 : « tu fais ce qui te semble le plus efficace
-- et maintenable dans le temps. »
--
-- CE QUE CETTE MIGRATION NE FAIT PAS : aucune table nouvelle, aucune colonne
-- nouvelle, aucune donnée touchée. Deux contraintes de contrôle sont remplacées
-- par des versions élargies, et rien d'autre.
--
-- ORDRE DE MISE EN PRODUCTION : LE SQL D'ABORD, LA FUSION ENSUITE.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Le quatrième événement
--
-- `conge_horaire` : Maria pose un congé d'une durée libre, ou une demi-journée,
-- sur une journée qu'elle travaille par ailleurs. La journée reste une journée
-- de présence — l'indemnité d'entretien reste due, les minutes du contrat
-- restent dues (RG-01, RG-02) — et seules les minutes posées sont déduites du
-- compteur choisi. C'est exactement le traitement d'un écart d'horaire, et
-- c'est pourquoi il vit ici plutôt que dans une table à lui.
-- ----------------------------------------------------------------------------

alter table public.journee
  drop constraint if exists journee_ecart_evenement_valide;

alter table public.journee
  add constraint journee_ecart_evenement_valide
    check (ecart_evenement is null or ecart_evenement in
           ('retard_parent', 'liberation_anticipee', 'arrivee_decalee',
            'conge_horaire'));

-- ----------------------------------------------------------------------------
-- 2. Le signe reste contrôlé
--
-- Un congé posé RETIRE du temps : ses minutes sont négatives, comme celles
-- d'une libération anticipée. Sans cette garde, « j'ai posé 1 h 34 de congé »
-- pourrait AJOUTER 1 h 34 au compteur de Maria, et le document serait
-- indéfendable. La contrainte d'origine est reprise mot pour mot, augmentée
-- d'une seule ligne.
-- ----------------------------------------------------------------------------

alter table public.journee
  drop constraint if exists journee_ecart_signe_coherent;

alter table public.journee
  add constraint journee_ecart_signe_coherent
    check (ecart_minutes is null
           or (ecart_evenement = 'retard_parent'         and ecart_minutes > 0)
           or (ecart_evenement = 'liberation_anticipee'  and ecart_minutes < 0)
           or (ecart_evenement = 'arrivee_decalee'       and ecart_minutes < 0)
           or (ecart_evenement = 'conge_horaire'         and ecart_minutes < 0));

comment on column public.journee.ecart_evenement is
  'Ce que Maria DÉCLARE sur la journée (§17.5, §21.1). Quatre valeurs, et '
  'quatre seulement, parce que chacune dit QUI a décidé — et que c''est ça qui '
  'décide si le temps est dû : `retard_parent` (un parent est venu après la '
  'référence, minutes positives), `liberation_anticipee` (Maria a rendu '
  'l''enfant plus tôt, de son fait), `arrivee_decalee` (Maria a demandé qu''on '
  'lui amène l''enfant plus tard), `conge_horaire` (Maria a posé un congé '
  'd''une durée libre ou une demi-journée sur cette journée). Le dernier ne '
  'change rien à la journée elle-même : elle reste présente, l''indemnité '
  'd''entretien reste due, seules les minutes posées sortent du compteur '
  'choisi par `ecart_impute_sur`.';

-- ----------------------------------------------------------------------------
-- 3. Contrôle de bonne fin
--
-- À exécuter après la migration. Les deux contraintes doivent nommer
-- `conge_horaire`, et aucune ligne existante ne doit avoir été touchée.
-- ----------------------------------------------------------------------------

-- select conname, pg_get_constraintdef(oid) as definition
--   from pg_constraint
--  where conrelid = 'public.journee'::regclass
--    and conname in ('journee_ecart_evenement_valide',
--                    'journee_ecart_signe_coherent')
--  order by conname;
--
-- select ecart_evenement, count(*)
--   from public.journee
--  group by 1 order by 1;
