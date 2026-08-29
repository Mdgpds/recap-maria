-- ============================================================================
-- §3.4 — LES PÉRIODES DE CONGÉ QUI N'ONT PLUS AUCUNE JOURNÉE.
--
-- « Livre son résultat dans la restitution : je veux savoir combien il en
--   reste aujourd'hui. » (Adrien, 28 août 2026)
--
-- CETTE REQUÊTE NE MODIFIE RIEN. Aucun update, aucun delete, aucun insert :
-- c'est un SELECT, et il peut être lancé autant de fois qu'on veut.
--
-- CE QU'ELLE CHERCHE. Une période de congé vit dans DEUX endroits : des
-- journées `conge_maria`, une par jour réellement posé, et une ligne
-- `imputation_conge` qui porte les bornes, le décompte en jours ouvrables et
-- la ventilation choisie (congés payés / récupération / sans solde).
--
-- Quand une imputation ne recouvre AUCUNE journée `conge_maria`, le moteur
-- regroupe les périodes à partir des journées : il n'y en a pas, l'imputation
-- n'est confrontée à rien, elle est ignorée. La ventilation choisie par Maria
-- est perdue sans un mot, et les jours concernés sont recomptés comme des
-- journées travaillées. C'est le défaut que le lot corrige DANS
-- L'APPLICATION — pour les mois à venir. Cette requête, elle, regarde TOUT LE
-- PASSÉ, tous contrats confondus.
--
-- POURQUOI PAS UN TRIGGER. Un trigger qui refuserait une imputation sans
-- journées casserait la pose : `poser` écrit l'imputation AVANT les journées.
-- La garantie devait être une DÉTECTION, pas un refus — la voici pour le
-- passé, et `imputationsOrphelines` la porte pour la suite.
--
-- CE QU'ELLE NE CHERCHE PAS. Une imputation qui recouvre une période avec un
-- DÉCOMPTE FAUX n'est pas orpheline : le moteur la refuse déjà franchement
-- (`IMPUTATION_INCOMPLETE`), et l'application le dit. Le cas d'ici est celui
-- où il n'y a RIEN en face.
-- ============================================================================

select
  c.prenom_enfant                                         as enfant,
  f.nom                                                   as famille,
  to_char(i.date_debut, 'DD/MM/YYYY')                     as du,
  to_char(i.date_fin,   'DD/MM/YYYY')                     as au,
  i.jours_ouvrables                                       as jours_decomptes,
  -- La ventilation que la période DEMANDAIT : c'est la décision perdue.
  i.jours_sur_cp                                          as sur_conges_payes,
  i.jours_sur_sup                                         as sur_recuperation,
  i.jours_sans_solde                                      as sans_solde,
  -- Combien de journées de congé existent réellement sur ces dates : par
  -- construction 0 ici, la colonne est là pour qu'on puisse le VÉRIFIER
  -- plutôt que de le croire.
  (select count(*)
     from public.journee j
    where j.contrat_id = i.contrat_id
      and j.type = 'conge_maria'
      and j.jour between i.date_debut and i.date_fin)     as journees_de_conge,
  -- Ce qui occupe réellement ces dates, s'il y a quelque chose : c'est ce qui
  -- dit par quel chemin l'imputation s'est retrouvée seule.
  coalesce((
    select string_agg(distinct j.type, ', ' order by j.type)
      from public.journee j
     where j.contrat_id = i.contrat_id
       and j.jour between i.date_debut and i.date_fin
  ), '— aucune journée saisie')                           as journees_trouvees,
  -- Le mois clôturé ne se recalcule jamais (RG-15) : s'il y en a un sur ces
  -- dates, le document est parti chez la famille avec la ventilation perdue.
  coalesce((
    select string_agg(r.annee || '-' || lpad(r.mois::text, 2, '0'), ', '
                      order by r.annee, r.mois)
      from public.recap_mensuel r
     where r.contrat_id = i.contrat_id
       and r.statut = 'fige'
       and make_date(r.annee, r.mois, 1)
           <= date_trunc('month', i.date_fin)::date
       and (make_date(r.annee, r.mois, 1) + interval '1 month - 1 day')::date
           >= date_trunc('month', i.date_debut)::date
  ), '—')                                                 as mois_cloture_concerne,
  to_char(i.cree_le, 'DD/MM/YYYY HH24:MI')                as posee_le,
  i.id                                                    as imputation_id
from public.imputation_conge i
join public.contrat c on c.id = i.contrat_id
join public.famille f on f.id = c.famille_id
where not exists (
  select 1
    from public.journee j
   where j.contrat_id = i.contrat_id
     and j.type = 'conge_maria'
     and j.jour between i.date_debut and i.date_fin
)
order by c.prenom_enfant, i.date_debut;

-- ----------------------------------------------------------------------------
-- SI LA LISTE EST VIDE : aucune période de congé n'est restée seule. C'est
-- l'état attendu, et c'est celui que l'application maintient désormais toute
-- seule (encart du récapitulatif + clôture bloquée, §3.2).
--
-- SI LA LISTE N'EST PAS VIDE : chaque ligne est une décision de Maria perdue.
-- Le geste est le même que dans l'application (§3.3) : RETIRER la période —
-- depuis l'encart du récapitulatif du mois concerné, jamais en SQL, où rien
-- n'en garderait trace. On ne devine JAMAIS les journées manquantes : écrire
-- d'office des `conge_maria` sur ces dates reviendrait à décider à la place de
-- Maria qu'elle était bien absente ces jours-là.
--
-- Une ligne dont `mois_cloture_concerne` n'est pas « — » demande une décision
-- de plus : le document est déjà parti chez la famille. Rouvrir le mois se
-- fait DEPUIS L'APPLICATION (bandeau du document, « Rouvrir ce mois »), qui
-- trace le geste dans `evenement_recap`.
-- ----------------------------------------------------------------------------
