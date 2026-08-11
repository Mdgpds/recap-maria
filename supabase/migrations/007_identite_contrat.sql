-- ============================================================================
-- 007_identite_contrat.sql — Identité d'un contrat (lot 8).
--
-- NUMÉRO : la spécification du lot 8 attribuait `006`. Ce numéro a été
-- consommé par les correctifs de relecture du lot 13 (`006_reouverture_
-- correctifs.sql`), appliqués en production le 10 août 2026. Tous les numéros
-- attribués par la spécification v8 décalent donc d'un cran :
--   lot 8 -> 007, lot 11 -> 008, lot 12 -> 009, lot 14 -> 010, lot 15 -> 011.
-- Signalé en restitution.
--
-- CE QUE CETTE MIGRATION AJOUTE, ET POURQUOI.
--
-- Un contrat ne portait qu'un prénom. Tout le reste de l'identité d'un enfant
-- vivait ailleurs ou nulle part :
--
--   * son NOM DE FAMILLE n'existait pas. Le seul champ « nom » à portée de
--     main était `famille.nom`, qui désigne le FOYER. C'est de cette confusion
--     que vient la perte de données que le lot 8 corrige : le champ « Nom de
--     la famille » de la fiche contrat renommait silencieusement le foyer pour
--     TOUS ses contrats. Maria croyait corriger un enfant, elle en renommait
--     trois, et rien ne l'en avertissait.
--
--   * son GENRE n'existait pas non plus, d'où les points médians semés dans
--     l'application (« Léa est comptée présent·e ») : faute de savoir, on
--     écrivait les deux. Ce champ ne sert QU'À accorder les phrases.
--
--   * sa PHOTO et sa COULEUR n'existaient pas : quatre cartes d'accueil se
--     distinguaient par une initiale dans un rond vert identique.
--
-- Aucune table nouvelle. `famille.archive` et `contrat.famille_id` existent
-- depuis le lot 2 et n'attendaient qu'un branchement.
--
-- Conventions inchangées : « add column if not exists » partout, aucune
-- policy touchée (celles de `contrat` du lot 2 couvrent ces colonnes), aucune
-- valeur par défaut imposée à des lignes existantes.
-- ============================================================================

alter table public.contrat
  add column if not exists nom     text,
  add column if not exists genre   text,
  add column if not exists couleur text,
  add column if not exists photo   text;

-- ----------------------------------------------------------------------------
-- Contraintes de valeur
--
-- Elles sont ajoutées séparément, avec un garde `if not exists` simulé : une
-- migration doit pouvoir être rejouée sans échouer, et `add constraint` n'a pas
-- de forme conditionnelle en PostgreSQL.
-- ----------------------------------------------------------------------------

-- Le genre ne sert QU'À l'accord des phrases. Deux valeurs, et le silence :
-- `null` signifie « non renseigné » et produit une formulation neutre. Ce
-- n'est pas une case à cocher obligatoire, et ce ne doit jamais le devenir.
alter table public.contrat drop constraint if exists contrat_genre_connu;
alter table public.contrat add constraint contrat_genre_connu
  check (genre is null or genre in ('f', 'g'));

-- La couleur est un JETON de palette, jamais une valeur hexadécimale libre.
-- Si l'application acceptait « #ff0000 », la palette cesserait d'être une
-- palette : les six teintes sont choisies pour rester distinctes entre elles
-- ET pour ne jamais entrer en collision avec les couleurs d'ÉTAT du calendrier
-- (V8-31). Une couleur libre casserait les deux garanties d'un coup.
alter table public.contrat drop constraint if exists contrat_couleur_de_palette;
alter table public.contrat add constraint contrat_couleur_de_palette
  check (couleur is null or couleur in
    ('vert', 'bleu', 'prune', 'terracotta', 'ocre', 'ardoise'));

-- La photo est stockée en base64 dans la ligne du contrat, redimensionnée à
-- 200 px de côté côté client, en JPEG, PLAFONNÉE À 50 Ko.
--
-- Pourquoi une contrainte en base alors que le client redimensionne déjà : le
-- client est du JavaScript servi en statique, et rien n'empêche un appel
-- direct à l'API avec la clé publique. Sans ce garde, une photo de 4 Mo entre
-- en base et se recharge à CHAQUE lecture de contrat — c'est-à-dire à chaque
-- ouverture de l'accueil, sur un téléphone, en 4G.
--
-- 68 000 caractères : 50 Ko de binaire font environ 66 700 caractères en
-- base64 (4 caractères pour 3 octets), plus le préfixe « data:image/jpeg;
-- base64, ». La borne est volontairement un peu large — elle est là pour
-- arrêter les mégaoctets, pas pour chicaner sur un kilo-octet.
alter table public.contrat drop constraint if exists contrat_photo_bornee;
alter table public.contrat add constraint contrat_photo_bornee
  check (photo is null or length(photo) <= 68000);

-- ----------------------------------------------------------------------------
-- Documentation des colonnes
-- ----------------------------------------------------------------------------

comment on column public.contrat.nom is
  'Nom de famille de l''ENFANT. À ne jamais confondre avec famille.nom, qui '
  'désigne le FOYER : c''est cette confusion qui renommait trois enfants '
  'quand Maria croyait en corriger un. Facultatif.';

comment on column public.contrat.genre is
  '''f'' ou ''g''. Sert UNIQUEMENT à accorder les phrases et à supprimer les '
  'points médians. null = formulation neutre, et c''est un état légitime : '
  'ce champ ne doit jamais devenir obligatoire.';

comment on column public.contrat.couleur is
  'Jeton de palette : vert, bleu, prune, terracotta, ocre, ardoise. Jamais une '
  'valeur hexadécimale libre. Cette couleur identifie un ENFANT ; elle n''entre '
  'jamais dans le codage des états du calendrier (V8-31).';

comment on column public.contrat.photo is
  'Image JPEG encodée en base64, 200 px de côté, 50 Ko maximum. N''apparaît '
  'sur AUCUN document transmis à une famille.';
