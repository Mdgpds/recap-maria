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
-- ============================================================================

create table public.famille (
  id            uuid primary key default gen_random_uuid(),
  owner         uuid not null default auth.uid(),
  nom           text not null,
  canal         text,                        -- libellé du groupe WhatsApp
  created_at    timestamptz not null default now()
);

comment on table public.famille is
  'Famille employeur. canal = libellé libre du groupe WhatsApp (cahier §2).';

create table public.contrat (
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
  created_at                timestamptz not null default now()
);

comment on table public.contrat is
  'Un contrat = un enfant gardé pour une famille. Les règles paramétrables '
  '(minutes_sup_jour, sup_dues_si_enfant_absent, ordre_imputation) restent '
  'des colonnes : le moteur ne contient aucune constante métier.';

-- Clé étrangère non couverte par une contrainte unique : index explicite.
create index contrat_famille_id_idx on public.contrat (famille_id);

create table public.salaire_contrat (
  id                    uuid primary key default gen_random_uuid(),
  owner                 uuid not null default auth.uid(),
  contrat_id            uuid not null references public.contrat(id) on delete cascade,
  date_effet            date not null,
  brut_mensuel_centimes int not null,
  net_mensuel_centimes  int not null,        -- saisi manuellement (cahier §3)
  unique (contrat_id, date_effet)
);

comment on table public.salaire_contrat is
  'Historique de salaire (RG-15) : le salaire applicable à un mois est celui '
  'dont la date_effet est la plus récente antérieure ou égale au 1er du mois.';

create table public.journee (
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
  unique (contrat_id, jour)
);

comment on table public.journee is
  'Saisie par exception (§5 specs) : seuls les écarts au planning sont '
  'stockés ; un jour du planning sans ligne est présumé « presence ».';

create table public.recap_mensuel (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null default auth.uid(),
  contrat_id  uuid not null references public.contrat(id) on delete cascade,
  annee       int not null,
  mois        int not null check (mois between 1 and 12),
  statut      text not null default 'brouillon' check (statut in ('brouillon','fige')),
  donnees     jsonb not null,     -- instantané complet du calcul (ResultatMois)
  fige_le     timestamptz,
  unique (contrat_id, annee, mois)
);

comment on table public.recap_mensuel is
  'Récapitulatif mensuel. Un récap figé est immuable (trigger '
  'recap_mensuel_immuable) : le document remis en mars doit être identique '
  's''il est rouvert deux ans plus tard.';

create table public.compteur_initial (
  contrat_id       uuid primary key references public.contrat(id) on delete cascade,
  owner            uuid not null default auth.uid(),
  date_reference   date not null,
  minutes_sup      int not null default 0,
  dixiemes_cp_acquis int not null default 0,
  dixiemes_cp_pris   int not null default 0
);

comment on table public.compteur_initial is
  'Reprise manuelle des compteurs au démarrage (cahier §7, « Initialisation » : '
  'ne pas repartir de zéro).';

-- ============================================================================
-- Immuabilité d'un récap figé (§3 des specs)
--
-- Tout UPDATE d'une ligne dont statut = 'fige' est rejeté, quel que soit le
-- champ touché. Le passage brouillon -> fige (qui renseigne fige_le) reste
-- permis : le trigger ne regarde que l'état AVANT modification.
-- Le schéma ne comporte aucun champ d'audit séparé ; le rejet est donc
-- strict — si un champ d'audit apparaît plus tard, assouplir ici.
-- Le DELETE d'un récap figé est également rejeté (décision, signalée en
-- restitution) : la suppression détruirait la même preuve que l'UPDATE.
-- Conséquence : un contrat portant des récaps figés ne peut plus être
-- supprimé (le cascade échoue) — cohérent avec la protection de Maria,
-- un contrat terminé passe en statut 'termine', il n'est pas supprimé.
-- ============================================================================

create or replace function public.proteger_recap_fige()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.statut = 'fige' then
    raise exception 'recap_mensuel % (contrat %, %/%) est figé : toute modification ou suppression est interdite (immuabilité)',
      old.id, old.contrat_id, old.mois, old.annee
      using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger recap_mensuel_immuable
  before update or delete on public.recap_mensuel
  for each row execute function public.proteger_recap_fige();
