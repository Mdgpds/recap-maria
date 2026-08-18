-- ============================================================================
-- 014_conditions_datees.sql — LOT 17 — Les conditions du contrat, datées.
--
-- ⚠️ CETTE MIGRATION CASSE L'APPLICATION EN LIGNE tant que la branche n'est pas
-- fusionnée : `salaire_contrat` disparaît, et le front publié l'interroge.
-- C'est assumé (§A.1) : l'application est en phase de test, Adrien en est le
-- seul utilisateur, une coupure de quelques minutes est acceptée. AUCUNE
-- rétrocompatibilité n'est construite — pas de vue portant l'ancien nom, pas
-- de double écriture, pas de bascule en deux temps. SQL d'abord, fusion
-- ensuite, dans la foulée.
--
-- ---------------------------------------------------------------------------
-- CE QUE ÇA CORRIGE
--
-- Deux réglages sur onze avaient un historique : le brut et le net. Les neuf
-- autres vivaient en valeur courante sur `contrat`, et le moteur les lisait
-- tels quels. Conséquences, toutes constatées :
--   - passer l'entretien de 5,00 € à 5,50 € recalculait TOUS les mois non
--     clôturés à 5,50 €, y compris un juillet qui traînait ;
--   - changer un jour de garde modifiait les « journées particulières » d'un
--     document déjà remis à une famille ;
--   - un récapitulatif sur trois ans appliquait les réglages d'aujourd'hui aux
--     trois années ;
--   - le solde de fin de contrat, qui reprend toute la vie du contrat, était
--     calculé au tarif du jour.
--
-- Ce n'est pas de l'archive : c'est de la donnée de CALCUL. Un mois n'affiche
-- pas les conditions de son époque, il est calculé avec elles.
--
-- UN SEUL MÉCANISME, PAS DEUX. `salaire_contrat` devient `avenant_contrat` et
-- absorbe les onze réglages. Deux tables datées côte à côte seraient
-- exactement le désordre qu'on veut éviter.
--
-- ---------------------------------------------------------------------------
-- TROIS POINTS SIGNALÉS À ADRIEN, TRANCHÉS ICI FAUTE DE RÉPONSE
--
-- 1. LA SPÉCIFICATION SE CONTREDIT sur la date du premier avenant. Le §17.2
--    demande « un premier avenant daté de sa date_debut » ET « date_effet doit
--    être un 1er de mois ». Les deux ne peuvent pas tenir : un contrat démarré
--    le 16 mars n'aurait alors AUCUNE condition applicable en mars, puisque
--    `conditionsApplicables` retient le dernier avenant dont la date d'effet
--    est ≤ au 1er du mois. Le mois d'ouverture du contrat deviendrait
--    incalculable — exactement ce qu'on vient de corriger au lot 16.
--    RETENU : le premier avenant est daté du 1er du mois de `date_debut`. La
--    contrainte reste pure, et rien n'existe avant le début du contrat de
--    toute façon (le moteur ignore déjà tout jour antérieur). L'écran affiche
--    la vraie date de début du contrat, pas celle de l'avenant.
--
-- 2. LES DATES D'EFFET EXISTANTES ne sont pas toutes des 1ers de mois. Elles
--    sont normalisées VERS L'AVANT, au 1er du mois SUIVANT — et c'est le seul
--    choix qui ne change aucun calcul : `salaireApplicable` comparait déjà
--    `date_effet <= 1er du mois`, donc un barème au 15 mars ne s'appliquait
--    qu'à partir d'avril. Le normaliser au 1er mars aurait modifié mars, y
--    compris sur des mois clôturés.
--
-- 3. LE BRUT ET LE NET RESTENT NULLABLES. Un mois antérieur au premier barème
--    connu n'a pas de rémunération, et l'application le DIT (« aucune
--    rémunération connue pour ce mois », clôture refusée). Mettre 0 à la
--    place ferait passer un mois incomplet pour un mois à zéro euro : le
--    document partirait chez la famille avec un total amputé du salaire
--    entier. La colonne accepte donc `null`, et le moteur continue de
--    distinguer « pas de barème » de « barème à zéro ».
--
-- ---------------------------------------------------------------------------
-- LES CONGÉS PAYÉS PASSENT EN MINUTES (§17.6)
--
-- Ils étaient comptés en DIXIÈMES DE JOUR. Un congé d'1 h 30 vaut 1,67 dixième
-- et 15 minutes en valent 0,28 : garder cette unité obligerait à arrondir à
-- chaque fois, et Maria perdrait ou gagnerait des minutes qui s'accumulent
-- sans que personne ne s'en aperçoive.
--
-- Conversion : dixièmes × minutes_par_jour_conge / 10. Aucune quantité ne
-- change, seule l'unité. L'affichage reste en jours.
--
-- ⚠️ LES INSTANTANÉS DE MOIS CLÔTURÉS NE SONT PAS TOUCHÉS. Ils portent
-- `compteurSortie.dixiemesCpAcquis` / `dixiemesCpPris`, et un mois clôturé ne
-- se réécrit JAMAIS — c'est la garantie qui protège les documents remis aux
-- familles, et le trigger d'immuabilité le refuserait de toute façon. La
-- conversion à la lecture est faite par `js/chaine-mois.js`, qui reconnaît un
-- instantané ancien à l'absence du champ `uniteCp`. Signalé en restitution.
--
-- ---------------------------------------------------------------------------
-- LE COMPTEUR DE RÉCUPÉRATION PEUT DEVENIR NÉGATIF (§17.5)
--
-- Quand Maria libère l'enfant plus tôt de son fait, les minutes se déduisent
-- de sa récupération, qui peut passer sous zéro : c'est du temps qu'elle
-- rendra. La contrainte `minutes_sup >= 0` de `compteur_initial` tombe donc —
-- sans quoi une reprise de comptes ne pourrait jamais dire « je dois 1 h 30 ».
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. `salaire_contrat` devient `avenant_contrat`
-- ---------------------------------------------------------------------------

alter table public.salaire_contrat rename to avenant_contrat;

-- Le brut et le net deviennent nullables (point 3 ci-dessus). La contrainte de
-- non-négativité les suit.
alter table public.avenant_contrat alter column brut_mensuel_centimes drop not null;
alter table public.avenant_contrat alter column net_mensuel_centimes  drop not null;

alter table public.avenant_contrat drop constraint if exists salaire_montants_non_negatifs;
alter table public.avenant_contrat
  add constraint avenant_montants_non_negatifs
  check ((brut_mensuel_centimes is null or brut_mensuel_centimes >= 0)
     and (net_mensuel_centimes  is null or net_mensuel_centimes  >= 0));

-- Les neuf autres réglages. Nullables le temps de la reprise, puis rendus
-- obligatoires : une condition partielle serait pire qu'aucune condition.
alter table public.avenant_contrat
  add column if not exists numero                    int,
  add column if not exists reconstitue               boolean not null default false,
  add column if not exists jours_planning            smallint[],
  add column if not exists heure_arrivee             time,
  add column if not exists heure_depart              time,
  add column if not exists minutes_contractuelles    int,
  add column if not exists minutes_sup_jour          int,
  add column if not exists minutes_par_jour_conge    int,
  add column if not exists entretien_centimes_jour   int,
  add column if not exists sup_dues_si_enfant_absent boolean,
  add column if not exists ordre_imputation          text;

-- ---------------------------------------------------------------------------
-- 2. Normalisation des dates d'effet existantes (point 2 ci-dessus)
-- ---------------------------------------------------------------------------

-- Vers l'AVANT, au 1er du mois suivant : c'est le seul décalage qui ne change
-- aucun calcul, puisque `salaireApplicable` ignorait déjà un barème dont la
-- date d'effet tombait après le 1er du mois.
update public.avenant_contrat
   set date_effet = (date_trunc('month', date_effet) + interval '1 month')::date
 where date_effet <> date_trunc('month', date_effet)::date;

-- ---------------------------------------------------------------------------
-- 3. Reprise : chaque contrat reçoit un premier avenant reconstitué
-- ---------------------------------------------------------------------------

-- Un avenant au 1er du mois de `date_debut`, portant les valeurs actuelles du
-- contrat, marqué `reconstitue`. L'application n'a jamais enregistré le passé :
-- on ne fait pas passer une reconstitution pour un fait, et l'écran le dit.
--
-- Son brut et son net sont laissés à `null` s'il n'existe aucun barème
-- antérieur ou égal : le mois dira « aucune rémunération connue », comme
-- aujourd'hui.
insert into public.avenant_contrat (
  owner, contrat_id, date_effet, reconstitue,
  brut_mensuel_centimes, net_mensuel_centimes,
  jours_planning, heure_arrivee, heure_depart, minutes_contractuelles,
  minutes_sup_jour, minutes_par_jour_conge, entretien_centimes_jour,
  sup_dues_si_enfant_absent, ordre_imputation)
select c.owner, c.id, date_trunc('month', c.date_debut)::date, true,
       null, null,
       c.jours_planning, c.heure_arrivee, c.heure_depart, c.minutes_contractuelles,
       c.minutes_sup_jour, c.minutes_par_jour_conge, c.entretien_centimes_jour,
       c.sup_dues_si_enfant_absent, c.ordre_imputation
  from public.contrat c
 where not exists (
   select 1 from public.avenant_contrat a
    where a.contrat_id = c.id
      and a.date_effet = date_trunc('month', c.date_debut)::date
 );

-- Les lignes `salaire_contrat` devenues avenants complètent leurs réglages
-- avec les valeurs ACTUELLES du contrat. C'est une reconstitution, elle aussi :
-- l'application ne sait pas quels réglages avaient cours à cette date-là.
update public.avenant_contrat a
   set jours_planning            = coalesce(a.jours_planning,            c.jours_planning),
       heure_arrivee             = coalesce(a.heure_arrivee,             c.heure_arrivee),
       heure_depart              = coalesce(a.heure_depart,              c.heure_depart),
       minutes_contractuelles    = coalesce(a.minutes_contractuelles,    c.minutes_contractuelles),
       minutes_sup_jour          = coalesce(a.minutes_sup_jour,          c.minutes_sup_jour),
       minutes_par_jour_conge    = coalesce(a.minutes_par_jour_conge,    c.minutes_par_jour_conge),
       entretien_centimes_jour   = coalesce(a.entretien_centimes_jour,   c.entretien_centimes_jour),
       sup_dues_si_enfant_absent = coalesce(a.sup_dues_si_enfant_absent, c.sup_dues_si_enfant_absent),
       ordre_imputation          = coalesce(a.ordre_imputation,          c.ordre_imputation)
  from public.contrat c
 where c.id = a.contrat_id;

-- Le brut et le net d'un avenant qui n'en porte pas reprennent ceux de
-- l'avenant précédent : un avenant ne change QUE ce qu'il change, et le reste
-- est repris tel quel. Sans cela, un avenant qui ne toucherait qu'à
-- l'entretien effacerait la rémunération.
update public.avenant_contrat a
   set brut_mensuel_centimes = p.brut_mensuel_centimes,
       net_mensuel_centimes  = p.net_mensuel_centimes
  from lateral (
    select b.brut_mensuel_centimes, b.net_mensuel_centimes
      from public.avenant_contrat b
     where b.contrat_id = a.contrat_id
       and b.date_effet < a.date_effet
       and b.brut_mensuel_centimes is not null
     order by b.date_effet desc
     limit 1
  ) p
 where a.brut_mensuel_centimes is null;

-- Numérotation, par contrat et par date d'effet croissante.
update public.avenant_contrat a
   set numero = n.rang
  from (select id, row_number() over (partition by contrat_id order by date_effet) as rang
          from public.avenant_contrat) n
 where n.id = a.id;

-- ---------------------------------------------------------------------------
-- 4. Les réglages deviennent obligatoires, et la date d'effet un 1er de mois
-- ---------------------------------------------------------------------------

alter table public.avenant_contrat
  alter column numero                    set not null,
  alter column jours_planning            set not null,
  alter column heure_arrivee             set not null,
  alter column heure_depart              set not null,
  alter column minutes_contractuelles    set not null,
  alter column minutes_sup_jour          set not null,
  alter column minutes_par_jour_conge    set not null,
  alter column entretien_centimes_jour   set not null,
  alter column sup_dues_si_enfant_absent set not null,
  alter column ordre_imputation          set not null;

alter table public.avenant_contrat
  add constraint avenant_date_effet_premier_du_mois
    check (date_effet = date_trunc('month', date_effet)::date),
  add constraint avenant_numero_positif
    check (numero >= 1),
  -- Les mêmes garde-fous numériques que sur `contrat`. `minutes_par_jour_conge`
  -- est le plus important : le moteur l'utilise en DIVISEUR.
  add constraint avenant_minutes_par_jour_conge_positif
    check (minutes_par_jour_conge > 0),
  add constraint avenant_minutes_sup_jour_non_negatif
    check (minutes_sup_jour >= 0),
  add constraint avenant_minutes_contractuelles_positif
    check (minutes_contractuelles > 0),
  add constraint avenant_entretien_non_negatif
    check (entretien_centimes_jour >= 0),
  add constraint avenant_ordre_imputation_valide
    check (ordre_imputation in ('sup_puis_cp', 'cp_puis_sup')),
  add constraint avenant_planning_valide
    check (jours_planning <@ '{1,2,3,4,5,6,7}'::smallint[]
           and coalesce(array_length(jours_planning, 1), 0) >= 1);

create unique index if not exists avenant_contrat_numero_unique
  on public.avenant_contrat (contrat_id, numero);

comment on table public.avenant_contrat is
  'Les conditions du contrat, datées (lot 17). Ce n''est pas une archive : '
  'chaque mois est CALCULÉ avec les conditions de sa période. Un avenant ne '
  'touche jamais à ce qui le précède. `reconstitue` marque les lignes que la '
  'migration a fabriquées faute d''historique — on ne fait pas passer une '
  'reconstitution pour un fait.';

comment on column public.avenant_contrat.date_effet is
  'Toujours un 1er de mois : un mois porte UN seul jeu de conditions. Le '
  'premier avenant d''un contrat est daté du 1er du mois de sa date_debut, '
  'faute de quoi ce mois n''aurait aucune condition applicable.';

comment on column public.avenant_contrat.brut_mensuel_centimes is
  'Nullable : un mois antérieur au premier barème connu n''a pas de '
  'rémunération, et l''application le DIT. Zéro ferait passer un mois '
  'incomplet pour un mois à zéro euro.';

-- ---------------------------------------------------------------------------
-- 5. Exposition explicite et RLS de la table renommée
-- ---------------------------------------------------------------------------
-- Le renommage conserve les policies, mais sous leurs anciens noms. On les
-- réécrit proprement : une policy nommée `salaire_contrat_select` sur une
-- table `avenant_contrat` est une invitation à l'erreur au prochain lot.

drop policy if exists salaire_contrat_select on public.avenant_contrat;
drop policy if exists salaire_contrat_insert on public.avenant_contrat;
drop policy if exists salaire_contrat_update on public.avenant_contrat;
drop policy if exists salaire_contrat_delete on public.avenant_contrat;

revoke all on public.avenant_contrat from anon, authenticated, public;
grant select, insert, update, delete on public.avenant_contrat to authenticated;
alter table public.avenant_contrat enable row level security;

drop policy if exists avenant_contrat_select on public.avenant_contrat;
create policy avenant_contrat_select on public.avenant_contrat
  for select to authenticated using (owner = (select auth.uid()));

drop policy if exists avenant_contrat_insert on public.avenant_contrat;
create policy avenant_contrat_insert on public.avenant_contrat
  for insert to authenticated with check (owner = (select auth.uid()));

drop policy if exists avenant_contrat_update on public.avenant_contrat;
create policy avenant_contrat_update on public.avenant_contrat
  for update to authenticated
  using (owner = (select auth.uid()))
  with check (owner = (select auth.uid()));

drop policy if exists avenant_contrat_delete on public.avenant_contrat;
create policy avenant_contrat_delete on public.avenant_contrat
  for delete to authenticated using (owner = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 6. Les congés payés passent en minutes (§17.6)
-- ---------------------------------------------------------------------------

alter table public.compteur_initial
  add column if not exists minutes_cp_acquis int,
  add column if not exists minutes_cp_pris   int;

-- dixièmes × minutes_par_jour_conge / 10. La conversion prend les minutes du
-- PREMIER avenant du contrat : c'est la valeur qui avait cours au moment où
-- ces compteurs ont été saisis.
update public.compteur_initial ci
   set minutes_cp_acquis = (ci.dixiemes_cp_acquis * a.minutes_par_jour_conge) / 10,
       minutes_cp_pris   = (ci.dixiemes_cp_pris   * a.minutes_par_jour_conge) / 10
  from lateral (
    select b.minutes_par_jour_conge
      from public.avenant_contrat b
     where b.contrat_id = ci.contrat_id
     order by b.date_effet
     limit 1
  ) a
 where ci.minutes_cp_acquis is null;

-- Un contrat sans aucun avenant ne devrait pas exister après l'étape 3 ; par
-- sécurité, on ne laisse jamais une colonne à null sur une table lue par le
-- moteur.
update public.compteur_initial
   set minutes_cp_acquis = coalesce(minutes_cp_acquis, 0),
       minutes_cp_pris   = coalesce(minutes_cp_pris, 0)
 where minutes_cp_acquis is null or minutes_cp_pris is null;

alter table public.compteur_initial
  alter column minutes_cp_acquis set not null,
  alter column minutes_cp_pris   set not null;

-- Les colonnes en dixièmes NE SONT PAS SUPPRIMÉES : on ne détruit pas de
-- donnée. Elles cessent simplement d'être lues. Leur retrait appartient au
-- lot 19 (la dette), une fois la nouvelle unité éprouvée.
comment on column public.compteur_initial.dixiemes_cp_acquis is
  'PLUS LU depuis le lot 17 : remplacé par minutes_cp_acquis. Conservé le '
  'temps que la nouvelle unité soit éprouvée. Retrait au lot 19.';
comment on column public.compteur_initial.dixiemes_cp_pris is
  'PLUS LU depuis le lot 17 : remplacé par minutes_cp_pris. Retrait au lot 19.';

-- La contrainte de cohérence suit la nouvelle unité, et LAISSE LA
-- RÉCUPÉRATION DEVENIR NÉGATIVE (§17.5) : quand Maria libère l'enfant plus
-- tôt de son fait, elle doit du temps, et une reprise de comptes doit pouvoir
-- le dire. Les congés payés, eux, restent positifs : on ne prend pas plus de
-- congés qu'on n'en a acquis, c'est le sans-solde qui sert à cela.
alter table public.compteur_initial drop constraint if exists compteur_initial_coherent;
alter table public.compteur_initial
  add constraint compteur_initial_coherent
  check (minutes_cp_acquis >= 0
         and minutes_cp_pris >= 0
         and minutes_cp_pris <= minutes_cp_acquis);

-- ---------------------------------------------------------------------------
-- 7. Les colonnes de `contrat` cessent d'être lues (§17.2)
-- ---------------------------------------------------------------------------
-- Elles ne sont PAS supprimées — on ne détruit pas de donnée, et elles
-- servent de filet si une reprise devait être rejouée. Plus aucun écran ni le
-- moteur ne s'en sert : les conditions viennent désormais de
-- `avenant_contrat`. Leur retrait, s'il a lieu, appartient à un lot dédié.

comment on column public.contrat.jours_planning is
  'PLUS LU depuis le lot 17 : les conditions applicables à un mois viennent de '
  'avenant_contrat. Conservé comme filet de reprise.';
comment on column public.contrat.entretien_centimes_jour is
  'PLUS LU depuis le lot 17 : voir avenant_contrat.';
comment on column public.contrat.minutes_sup_jour is
  'PLUS LU depuis le lot 17 : voir avenant_contrat.';
comment on column public.contrat.minutes_par_jour_conge is
  'PLUS LU depuis le lot 17 : voir avenant_contrat.';
comment on column public.contrat.sup_dues_si_enfant_absent is
  'PLUS LU depuis le lot 17 : voir avenant_contrat.';
comment on column public.contrat.ordre_imputation is
  'PLUS LU depuis le lot 17 : voir avenant_contrat.';
comment on column public.contrat.minutes_contractuelles is
  'PLUS LU depuis le lot 17 : voir avenant_contrat.';

-- ---------------------------------------------------------------------------
-- 8. Les écarts d'horaire au jour, et les congés à l'heure (§17.5, §17.6)
-- ---------------------------------------------------------------------------
-- MARIA DÉCLARE L'ÉVÉNEMENT, L'APPLICATION NE DEVINE RIEN. On enregistre donc
-- les deux : ce qu'elle a déclaré (l'événement et l'heure réelle), et ce que
-- ça fait au calcul (les minutes signées). Le moteur ne lit que les minutes ;
-- l'événement et l'heure servent à EXPLIQUER le chiffre sur le document, des
-- mois plus tard, quand plus personne ne se souvient du 17 novembre.
--
-- Garder seulement les minutes rendrait le total incontestable et
-- inexplicable en même temps — exactement ce que ce projet refuse.
--
--   Minutes du jour = minutes supplémentaires du contrat
--                     + (heure réelle − heure de référence)
--
-- La référence vient des conditions du mois (fin d'accueil + minutes sup),
-- donc d'un avenant : un avenant qui déplace les horaires déplace la
-- référence, sans toucher aux mois d'avant.

alter table public.journee
  add column if not exists ecart_minutes     int,
  add column if not exists ecart_evenement   text,
  add column if not exists ecart_heure_reelle time,
  add column if not exists ecart_impute_sur  text;

comment on column public.journee.ecart_minutes is
  'Écart d''horaire DÉCLARÉ, en minutes SIGNÉES (§17.5). Positif : un parent '
  'est venu en retard. Négatif : Maria a libéré plus tôt, ou a demandé qu''on '
  'lui amène l''enfant plus tard. `null` = rien de déclaré, et c''est le cas '
  'd''un parent qui vient chercher son enfant plus tôt de lui-même : Maria '
  'était disponible, ses minutes restent dues.';

comment on column public.journee.ecart_impute_sur is
  'Où se déduisent les minutes d''un écart NÉGATIF (§17.6). `recuperation` '
  'par défaut — le compteur peut passer sous zéro, c''est ça « je le devrai ». '
  'Un écart positif va toujours à la récupération : il n''y a rien à choisir.';

alter table public.journee
  add constraint journee_ecart_evenement_valide
    check (ecart_evenement is null or ecart_evenement in
           ('retard_parent', 'liberation_anticipee', 'arrivee_decalee')),
  add constraint journee_ecart_impute_sur_valide
    check (ecart_impute_sur is null or ecart_impute_sur in
           ('recuperation', 'conges_payes', 'sans_solde')),
  -- Une destination sans écart ne veut rien dire, et un écart nul non plus :
  -- une ligne à demi remplie est une ligne qu'on relira de travers.
  add constraint journee_ecart_coherent
    check ((ecart_minutes is null and ecart_impute_sur is null
            and ecart_evenement is null and ecart_heure_reelle is null)
           or (ecart_minutes is not null and ecart_minutes <> 0
               and ecart_evenement is not null)),
  -- Le sens de l'événement et le signe des minutes doivent concorder. Sans
  -- cette garde, « j'ai libéré plus tôt » pourrait AJOUTER des minutes au
  -- compteur de Maria, et le document serait indéfendable.
  add constraint journee_ecart_signe_coherent
    check (ecart_minutes is null
           or (ecart_evenement = 'retard_parent'         and ecart_minutes > 0)
           or (ecart_evenement = 'liberation_anticipee'  and ecart_minutes < 0)
           or (ecart_evenement = 'arrivee_decalee'       and ecart_minutes < 0));

-- La contrainte `minutes_sup >= 0` de `compteur_initial` : voir la section 6.
-- Elle est déjà tombée avec la réécriture de `compteur_initial_coherent`, qui
-- ne contraint plus que les congés payés. Une reprise de comptes peut donc
-- enfin dire « je dois 1 h 30 ».
