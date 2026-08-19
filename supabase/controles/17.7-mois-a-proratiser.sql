-- ============================================================================
-- §17.7 — LES MOIS À ROUVRIR, AVANT DE ROUVRIR QUOI QUE CE SOIT.
--
-- « Fais la liste des mois concernés sur les quatre contrats et donne-la
--   avant de rouvrir quoi que ce soit. »
--
-- CETTE REQUÊTE NE MODIFIE RIEN. Aucun update, aucun delete, aucun insert :
-- c'est un SELECT, et il peut être lancé autant de fois qu'on veut.
--
-- CE QU'ELLE CHERCHE. Le lot 17 proratise le salaire d'un mois que le contrat
-- ne couvre pas en entier (§17.7) : un contrat ouvert le 16 mars retenait
-- jusqu'ici le mois de mars complet. Les mois NON clôturés se recalculeront
-- tout seuls. Les mois CLÔTURÉS, eux, ne se recalculent jamais (RG-15) : leur
-- document est parti chez la famille avec un montant qui ne sera pas corrigé
-- tant que personne ne rouvre le mois.
--
-- La liste ci-dessous est donc exactement celle des documents à revoir avec
-- les familles. Pour chacun, elle donne l'écart en euros : c'est le montant
-- que la famille a payé en trop.
--
-- ⚠️ À LANCER APRÈS LA MIGRATION 014 (elle lit `avenant_contrat`).
-- ============================================================================

with jours_planning as (
  -- Les jours du planning de chaque mois clôturé, et ceux réellement couverts
  -- par le contrat. Même définition que `partCouverteDuMois` dans le moteur :
  -- les fériés comptent comme couverts, ils sont chômés ET payés (RG-10).
  select
    r.id                        as recap_id,
    c.id                        as contrat_id,
    c.prenom_enfant,
    r.annee,
    r.mois,
    r.fige_le,
    c.date_debut,
    c.date_fin,
    a.brut_mensuel_centimes,
    a.net_mensuel_centimes,
    count(*) filter (
      where extract(isodow from d)::int = any (a.jours_planning::int[])
    ) as jours_du_mois,
    count(*) filter (
      where extract(isodow from d)::int = any (a.jours_planning::int[])
        and d >= c.date_debut
        and (c.date_fin is null or d <= c.date_fin)
    ) as jours_couverts
  from public.recap_mensuel r
  join public.contrat c on c.id = r.contrat_id
  join lateral (
    select b.*
      from public.avenant_contrat b
     where b.contrat_id = c.id
       and b.date_effet <= make_date(r.annee, r.mois, 1)
     order by b.date_effet desc
     limit 1
  ) a on true
  cross join lateral generate_series(
    make_date(r.annee, r.mois, 1),
    (make_date(r.annee, r.mois, 1) + interval '1 month - 1 day')::date,
    interval '1 day'
  ) as d
  where r.statut = 'fige'
  group by r.id, c.id, c.prenom_enfant, r.annee, r.mois, r.fige_le,
           c.date_debut, c.date_fin, a.brut_mensuel_centimes, a.net_mensuel_centimes
)
select
  prenom_enfant                                       as enfant,
  annee, mois,
  to_char(fige_le, 'DD/MM/YYYY')                      as cloture_le,
  jours_couverts || ' / ' || jours_du_mois            as jours_de_garde_couverts,
  -- Ce qui a été retenu sur le document déjà remis.
  round(net_mensuel_centimes / 100.0, 2)              as net_facture_eur,
  -- Ce que le lot 17 retiendra désormais.
  round((net_mensuel_centimes::numeric * jours_couverts / jours_du_mois) / 100.0, 2)
                                                      as net_proratise_eur,
  -- L'écart : ce que la famille a payé EN TROP.
  round((net_mensuel_centimes
         - round(net_mensuel_centimes::numeric * jours_couverts / jours_du_mois))
        / 100.0, 2)                                   as ecart_eur
from jours_planning
where jours_couverts < jours_du_mois          -- le mois n'est pas entièrement couvert
  and jours_du_mois > 0
order by annee, mois, prenom_enfant;

-- ----------------------------------------------------------------------------
-- SI LA LISTE EST VIDE : aucun mois clôturé n'est partiel, et il n'y a rien à
-- rouvrir. Les mois non clôturés se corrigeront d'eux-mêmes à la fusion.
--
-- SI LA LISTE N'EST PAS VIDE : c'est à Adrien de décider, contrat par contrat,
-- ce qu'il fait auprès de chaque famille. La réouverture se fait DEPUIS
-- L'APPLICATION (bandeau du document, « Rouvrir ce mois »), qui trace le geste
-- et son motif dans `evenement_recap` — pas en SQL, où rien n'en garderait
-- trace.
-- ----------------------------------------------------------------------------
