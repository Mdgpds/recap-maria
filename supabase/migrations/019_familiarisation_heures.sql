-- ============================================================================
-- 019 — LA JOURNÉE DE FAMILIARISATION SE SAISIT EN ARRIVÉE PUIS DÉPART.
--
-- CE QUE CETTE MIGRATION CHANGE, ET POURQUOI.
--
-- Jusqu'ici, la feuille du jour de familiarisation n'écrivait qu'une DURÉE
-- (`journee.minutes_reelles`), calculée par le moteur à partir d'une arrivée
-- et d'un départ que la feuille oubliait aussitôt. Il fallait donc connaître
-- le départ pour enregistrer quoi que ce soit : Maria ne pouvait rien noter
-- le matin, et devait se souvenir de l'heure d'arrivée jusqu'au soir.
--
-- Retour d'Adrien du 26 août 2026 : Maria doit pouvoir enregistrer l'heure
-- d'arrivée, puis, plus tard, l'heure de départ. Pour qu'une arrivée seule
-- survive à la fermeture de la feuille, elle doit être en base.
--
-- DEUX COLONNES, ET DEUX SEULEMENT, sur `journee` : `fam_heure_arrivee` et
-- `fam_heure_depart`. Nullables, sans valeur par défaut. Aucune donnée
-- existante n'est touchée : aucun `update`, aucun `drop`, aucune contrainte
-- ni politique RLS modifiée — les politiques de `journee` portent sur la
-- ligne, pas sur ses colonnes, et couvrent donc celles-ci comme les autres.
--
-- CE QUE CES COLONNES NE SONT PAS : une donnée de calcul. La durée payée
-- reste `minutes_reelles`, écrite par la feuille quand les deux heures sont
-- là, et calculée par le moteur (`Engine.dureeEntreHeures`) — jamais
-- recalculée depuis ces deux heures, ni ici, ni par le moteur, qui ne les lit
-- pas. Une ligne avec une arrivée et sans `minutes_reelles` est une journée
-- « en cours » : rien n'est payé, exactement comme une journée à déclarer.
--
-- ORDRE DE MISE EN PRODUCTION : CE SQL D'ABORD, LA FUSION ENSUITE. L'inverse
-- déploierait un front qui lit deux colonnes inexistantes, et chaque
-- ouverture d'un mois échouerait.
--
-- Unités : heures en type `time` pur, à la minute, sans fuseau — comme
-- `heure_arrivee` et `heure_depart` du contrat.
-- ============================================================================

alter table public.journee
  add column if not exists fam_heure_arrivee time,
  add column if not exists fam_heure_depart  time;

comment on column public.journee.fam_heure_arrivee is
  'Familiarisation — heure d''arrivée saisie par Maria pour ce jour. Trace de '
  'la saisie, jamais une donnée de calcul : la durée payée reste '
  'minutes_reelles, écrite par la feuille quand le départ est connu, et n''est '
  'jamais recalculée depuis cette heure. Renseignée seule, la journée est '
  '« en cours » et rien n''est payé.';

comment on column public.journee.fam_heure_depart is
  'Familiarisation — heure de départ saisie par Maria pour ce jour. Trace de '
  'la saisie, jamais une donnée de calcul : la durée payée reste '
  'minutes_reelles, jamais recalculée depuis cette heure. Nulle tant que '
  'Maria n''a pas enregistré le départ.';
