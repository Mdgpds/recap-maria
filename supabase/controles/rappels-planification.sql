-- ============================================================================
-- rappels-planification.sql — La planification des rappels (lot 32, §10).
--
-- À COLLER DANS L'ÉDITEUR SQL DE SUPABASE, PAR ADRIEN, UNE FOIS LA FONCTION
-- `rappels-cloture` DÉPLOYÉE ET SES SECRETS POSÉS. Ce fichier n'est PAS une
-- migration : il ne change aucun schéma, il programme un appel. Il n'a été
-- exécuté par personne.
--
-- DEUX VALEURS À REMPLACER À LA MAIN, et deux seulement :
--   <URL-DE-LA-FONCTION>  l'URL de la fonction déployée, de la forme
--                         https://<ref-du-projet>.supabase.co/functions/v1/rappels-cloture
--   <RAPPELS_SECRET>      le secret d'appel posé dans les secrets de la
--                         fonction (Edge Functions → Secrets). Le MÊME, au
--                         caractère près : la fonction refuse tout appel qui
--                         ne le présente pas (401), et tout appel tant qu'il
--                         n'est pas configuré (503).
--
-- AUCUNE VALEUR RÉELLE N'EST ÉCRITE ICI, ET AUCUNE NE DOIT L'ÊTRE : ce fichier
-- vit dans un dépôt public. On remplace dans l'éditeur SQL, jamais dans le
-- dépôt.
--
-- CADENCE : toutes les heures, à la minute 0. La fonction compare l'heure
-- réglée par Maria à l'heure de PARIS (elle fait la conversion elle-même) et
-- ne repart jamais deux fois le même jour (trace `dernier_envoi_le`).
-- ============================================================================

-- 1. Les deux extensions : la planification et l'appel HTTP.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 2. Si une planification du même nom existe déjà (relance), on la retire
--    d'abord : `cron.schedule` avec un nom déjà pris la REMPLACE, mais le
--    dire explicitement évite d'en laisser deux par erreur de nom.
select cron.unschedule('rappels-cloture')
 where exists (select 1 from cron.job where jobname = 'rappels-cloture');

-- 3. La planification.
select cron.schedule(
  'rappels-cloture',
  '0 * * * *',
  $$
  select net.http_post(
    url     := '<URL-DE-LA-FONCTION>',
    headers := jsonb_build_object(
      'Content-Type',     'application/json',
      'x-rappels-secret', '<RAPPELS_SECRET>'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- ----------------------------------------------------------------------------
-- CONTRÔLES, à lire juste après.
-- ----------------------------------------------------------------------------

-- a) La planification est enregistrée : une ligne, active, cadence horaire.
select jobid, jobname, schedule, active from cron.job where jobname = 'rappels-cloture';

-- b) Après l'heure ronde suivante : la dernière exécution a réussi.
select start_time, end_time, status, return_message
  from cron.job_run_details
 where jobid = (select jobid from cron.job where jobname = 'rappels-cloture')
 order by start_time desc
 limit 3;

-- c) La réponse de la fonction (pg_net) : un statut 200 et un corps JSON
--    { "heure_paris": …, "envoyees": …, "ignorees": … }. Un 401 veut dire que
--    le secret collé ici n'est pas celui des secrets de la fonction ; un 503
--    que RAPPELS_SECRET n'est pas posé côté fonction.
select id, status_code, content::text
  from net._http_response
 order by id desc
 limit 3;
