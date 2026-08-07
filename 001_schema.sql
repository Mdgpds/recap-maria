-- ============================================================================
-- 001_schema.sql — Structure de la base « Récap Maria »
--
-- Rejouable telle quelle sur un projet Supabase vierge (Postgres 15+).
-- Unités (§1 des specs) : temps en minutes entières, argent en centimes
-- entiers, congés payés en dixièmes de jour entiers — aucun numeric/float.
-- Dates : type date (date pure), jamais de timestamp pour un jour de garde.
-- Référence métier : cahier des charges consolidé, RG-01 à RG-15.
--
-- gen_random_uuid() est natif depuis Postgres 13 : aucune extension requise.
-- « if not exists » / « drop … if exists » : recollage sans erreur en cas
-- d'application manuelle répétée (relecture lot 2, B7).
-- ============================================================================

create table if not exists public.famille (
  id            uuid primary key default gen_random_uuid(),
  owner         uuid not null default auth.uid(),
  nom           text not null,
  canal         text,                        -- libellé du groupe WhatsApp
  archive       boolean not null default false,  -- rangement sans suppression (relecture lot 2, remarque 1)
  created_at    timestamptz not null default now()
);

comment on table public.famille is
  'Famille employeur. canal = libellé libre du groupe WhatsApp (cahier §2). '
  'archive = masquée dans l''app sans être supprimée (une famille liée à un '
  'récap figé ne peut pas être détruite).';

create table if not exists public.contrat (
  id                        uuid primary key default gen_random_uuid(),
  owner                     uuid not null default auth.uid(),
  famille_id                uuid not null references public.famille(id) on delete restrict,
  prenom_enfant             text not null,
  date_debut                date not null,
  date_fin                  date,
  jours_planning            smallint[] not null default '{1,2,3,4,5}',  -- 1 = lundi … 7 = dimanche
  heure_arrivee             time not null default '08:30',
  heure_depart              time not null default '18:00',
  minutes_contractuelles    int  not null default 540,   -- 9 h
  minutes_sup_jour          int  not null default 30,    -- paramètre, jamais une constante (§8 specs)
  minutes_par_jour_conge    int  not null default 540,   -- RG-05 : 9 h = 1 jour
  entretien_centimes_jour   int  not null default 500,   -- RG-01/RG-02 : 5 €/jour de présence
  statut                    text not null default 'actif'
                            check (statut in ('familiarisation','actif','termine')),
  sup_dues_si_enfant_absent boolean not null default true,   -- RG-09, paramétrable
  ordre_imputation          text not null default 'cp_puis_sup'
                            check (ordre_imputation in ('sup_puis_cp','cp_puis_sup')),  -- RG-07
  archive                   boolean not null default false,  -- rangement sans suppression (relecture lot 2, remarque 1)
  created_at                timestamptz not null default now(),

  -- Garde-fous numériques (relecture lot 2, B2). minutes_par_jour_conge > 0
  -- est le plus important : le moteur l'utilise en DIVISEUR (imputerConges).
  constraint contrat_minutes_par_jour_conge_positif  check (minutes_par_jour_conge > 0),
  constraint contrat_minutes_sup_jour_non_negatif    check (minutes_sup_jour >= 0),
  constraint contrat_minutes_contractuelles_positif  check (minutes_contractuelles > 0),
  constraint contrat_entretien_non_negatif           check (entretien_centimes_jour >= 0),
  constraint contrat_dates_coherentes                check (date_fin is null or date_fin >= date_debut),
  -- planning : valeurs dans 1..7, tableau non vide (le doublon reste possible,
  -- à filtrer dans l'UI du lot 3)
  constraint contrat_planning_valide
    check (jours_planning <@ '{1,2,3,4,5,6,7}'::smallint[]
           and coalesce(array_length(jours_planning, 1), 0) >= 1)
);

comment on table public.contrat is
  'Un contrat = un enfant gardé pour une famille. Les règles paramétrables '
  '(minutes_sup_jour, sup_dues_si_enfant_absent, ordre_imputation) restent '
  'des colonnes : le moteur ne contient aucune constante métier.';

-- Clé étrangère non couverte par une contrainte unique : index explicite.
create index if not exists contrat_famille_id_idx on public.contrat (famille_id);

create table if not exists public.salaire_contrat (
  id                    uuid primary key default gen_random_uuid(),
  owner                 uuid not null default auth.uid(),
  contrat_id            uuid not null references public.contrat(id) on delete cascade,
  date_effet            date not null,
  brut_mensuel_centimes int not null,
  net_mensuel_centimes  int not null,        -- saisi manuellement (cahier §3)
  unique (contrat_id, date_effet),
  constraint salaire_montants_non_negatifs
    check (brut_mensuel_centimes >= 0 and net_mensuel_centimes >= 0)  -- B2
);

comment on table public.salaire_contrat is
  'Historique de salaire (RG-15) : le salaire applicable à un mois est celui '
  'dont la date_effet est la plus récente antérieure ou égale au 1er du mois. '
  'date_effet en cours de mois AUTORISÉE (décision Adrien) : un changement au '
  'cours du mois M ne s''applique qu''à partir du mois M+1 ; le mois M garde '
  'l''ancien salaire en entier (pas de proratisation). '
  '// TODO RÈGLE ABSENTE : proratisation du mois de changement à confirmer.';

create table if not exists public.journee (
  id                 uuid primary key default gen_random_uuid(),
  owner              uuid not null default auth.uid(),
  contrat_id         uuid not null references public.contrat(id) on delete cascade,
  jour               date not null,
  type               text not null check (type in
                     ('presence','absence_enfant','ferie','conge_maria',
                      'sans_solde','familiarisation','hors_planning')),
  minutes_reelles    int,        -- renseigné uniquement si type = 'familiarisation' (RG-14)
  entretien_centimes int,        -- surcharge manuelle ; sinon calculé par le moteur
  commentaire        text,
  unique (contrat_id, jour),
  constraint journee_minutes_reelles_non_negatives
    check (minutes_reelles is null or minutes_reelles >= 0),           -- B2
  constraint journee_entretien_non_negatif
    check (entretien_centimes is null or entretien_centimes >= 0)      -- B2
);

comment on table public.journee is
  'Saisie par exception (§5 specs) : seuls les écarts au planning sont '
  'stockés ; un jour du planning sans ligne est présumé « presence ». '
  'Le contrôle des bornes du contrat est laissé à l''UI du lot 3.';

create table if not exists public.recap_mensuel (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null default auth.uid(),
  contrat_id  uuid not null references public.contrat(id) on delete cascade,
  annee       int not null check (annee between 2000 and 2100),          -- B2
  mois        int not null check (mois between 1 and 12),
  statut      text not null default 'brouillon' check (statut in ('brouillon','fige')),
  donnees     jsonb not null,     -- instantané complet du calcul (ResultatMois)
  fige_le     timestamptz,
  -- Champ d'audit (décision Adrien post-relecture lot 2) : seules ces trois
  -- colonnes peuvent être modifiées sur un récap figé — trace d'une
  -- correction exceptionnelle, sans altérer les valeurs du document.
  audit_note  text,
  audit_le    timestamptz,
  audit_par   uuid,
  unique (contrat_id, annee, mois),
  -- Un récap figé porte toujours sa date de figement (relecture lot 2, B5).
  constraint recap_fige_date_presente
    check (statut <> 'fige' or fige_le is not null)
);

comment on table public.recap_mensuel is
  'Récapitulatif mensuel. Un récap figé est immuable (trigger '
  'recap_mensuel_immuable) SAUF le champ d''audit (audit_note/audit_le/'
  'audit_par) : le document remis en mars reste identique s''il est rouvert '
  'deux ans plus tard, mais une correction exceptionnelle peut être tracée. '
  'Le figement se fait par UPDATE brouillon -> fige ; l''insertion directe '
  'd''un figé est refusée.';

create table if not exists public.compteur_initial (
  contrat_id       uuid primary key references public.contrat(id) on delete cascade,
  owner            uuid not null default auth.uid(),
  date_reference   date not null,
  minutes_sup      int not null default 0,
  dixiemes_cp_acquis int not null default 0,
  dixiemes_cp_pris   int not null default 0,
  -- Compteurs cohérents : rien de négatif, et on ne peut pas avoir pris plus
  -- de congés qu'on n'en a acquis (relecture lot 2, B2).
  constraint compteur_initial_coherent
    check (minutes_sup >= 0
           and dixiemes_cp_acquis >= 0
           and dixiemes_cp_pris >= 0
           and dixiemes_cp_pris <= dixiemes_cp_acquis)
);

comment on table public.compteur_initial is
  'Reprise manuelle des compteurs au démarrage (cahier §7, « Initialisation » : '
  'ne pas repartir de zéro).';

-- ============================================================================
-- Immuabilité d'un récap figé (§3 des specs)
--
-- 1) Sur un récap figé, tout UPDATE est rejeté SAUF s'il ne touche qu'aux
--    champs d'audit (audit_note / audit_le / audit_par). Toutes les autres
--    colonnes doivent rester identiques : le document lui-même est immuable,
--    seule une trace de correction exceptionnelle peut être ajoutée. Le
--    passage brouillon -> fige reste permis (le trigger regarde l'état AVANT).
-- 2) Le DELETE d'un récap figé est rejeté (décision au-delà des specs,
--    signalée en restitution) : la suppression détruirait la même preuve que
--    l'UPDATE. Conséquence : un contrat/famille portant un récap figé n'est
--    plus supprimable (cascade / on delete restrict) — d'où le champ archive.
-- 3) L'INSERT direct d'un récap déjà figé est refusé (relecture lot 2, B5) :
--    le figement doit passer par le chemin contrôlé brouillon -> UPDATE, seul
--    endroit où l'application pose fige_le.
-- ============================================================================

create or replace function public.proteger_recap_fige()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.statut = 'fige' then
    if tg_op = 'DELETE' then
      raise exception 'recap_mensuel % (contrat %, %/%) est figé : suppression interdite (immuabilité)',
        old.id, old.contrat_id, old.mois, old.annee
        using errcode = 'P0001';
    end if;
    -- UPDATE : autorisé uniquement si SEULS les champs d'audit changent.
    if new.id          is not distinct from old.id
       and new.owner       is not distinct from old.owner
       and new.contrat_id  is not distinct from old.contrat_id
       and new.annee       is not distinct from old.annee
       and new.mois        is not distinct from old.mois
       and new.statut      is not distinct from old.statut
       and new.donnees     is not distinct from old.donnees
       and new.fige_le     is not distinct from old.fige_le
    then
      return new;   -- seul audit_note / audit_le / audit_par a pu changer
    end if;
    raise exception 'recap_mensuel % (contrat %, %/%) est figé : seul le champ d''audit est modifiable (immuabilité)',
      old.id, old.contrat_id, old.mois, old.annee
      using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function public.refuser_insert_recap_fige()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.statut = 'fige' then
    raise exception 'un recap_mensuel ne peut pas être créé directement au statut « fige » : créer en brouillon puis figer par UPDATE'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists recap_mensuel_immuable on public.recap_mensuel;
create trigger recap_mensuel_immuable
  before update or delete on public.recap_mensuel
  for each row execute function public.proteger_recap_fige();

drop trigger if exists recap_mensuel_insert_brouillon on public.recap_mensuel;
create trigger recap_mensuel_insert_brouillon
  before insert on public.recap_mensuel
  for each row execute function public.refuser_insert_recap_fige();
