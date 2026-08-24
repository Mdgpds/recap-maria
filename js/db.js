/* ============================================================================
   db.js — Accès Supabase (authentification + données).

   SEUL fichier de l'application qui parle au réseau (§1 des specs). Le reste
   de l'app (ui-saisie, app) passe uniquement par l'API exposée ici, dans
   l'objet global `DB`. Aucune URL ni clé en dur : tout vient de config.js.

   Client Supabase chargé depuis un CDN par balise <script> dans index.html
   (window.supabase). Ici on ne fait que créer le client et exposer des
   fonctions métier ; toute la sécurité repose sur le RLS du lot 2 (chaque
   requête est implicitement filtrée sur owner = auth.uid()).

   Unités : la base stocke des entiers (minutes, centimes, dixièmes de jour) et
   des dates pures 'YYYY-MM-DD'. db.js ne convertit rien — il transmet tel quel.
   ========================================================================= */
(function (global) {
  'use strict';

  var cfg = global.RECAP_MARIA_CONFIG || {};
  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
    throw new Error('config.js manquant ou incomplet (SUPABASE_URL / SUPABASE_ANON_KEY).');
  }
  if (!global.supabase || typeof global.supabase.createClient !== 'function') {
    throw new Error('Client Supabase non chargé : vérifier la balise <script> du CDN dans index.html.');
  }

  var client = global.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  /* ------------------------------------------------------------------ */
  /* Authentification                                                    */
  /* ------------------------------------------------------------------ */

  function getSession() {
    return client.auth.getSession().then(function (r) {
      if (r.error) throw r.error;
      return r.data.session; // null si non connecté
    });
  }

  function onAuthChange(cb) {
    // cb(session|null) à chaque changement (login / logout / refresh)
    client.auth.onAuthStateChange(function (_event, session) { cb(session); });
  }

  function signIn(email, motDePasse) {
    return client.auth.signInWithPassword({ email: email, password: motDePasse })
      .then(function (r) {
        if (r.error) throw r.error;
        return r.data.session;
      });
  }

  /* LOT 14 — « Mot de passe oublié ».

     LE MESSAGE NE RÉVÈLE JAMAIS SI L'ADRESSE EXISTE (A6, risque n° 4). C'est
     pourquoi cette fonction ne remonte PAS l'erreur « user not found » : elle
     l'avale volontairement et rend toujours `true`. Un formulaire qui répond
     « aucun compte ne correspond » est un outil pour savoir qui possède un
     compte quelque part — et cette application-là contient les revenus d'une
     personne et les noms de quatre enfants.

     Les erreurs de RÉSEAU, elles, remontent : Maria doit savoir que rien n'est
     parti. C'est la seule distinction qui compte ici. */
  function demanderReinitialisation(email) {
    return client.auth.resetPasswordForEmail(email, {
      redirectTo: global.location ? global.location.origin + global.location.pathname : undefined
    }).then(function (r) {
      if (r && r.error) {
        var m = String(r.error.message || '');
        /* Réseau, limite de débit : on le dit. Tout le reste — y compris
           « adresse inconnue » — est tu. */
        if (/failed to fetch|network|timeout|rate limit|too many/i.test(m)) throw r.error;
      }
      return true;
    }).catch(function (e) {
      var m = String((e && e.message) || '');
      if (/failed to fetch|network|timeout|rate limit|too many/i.test(m)) throw e;
      return true;
    });
  }

  function signOut() {
    return client.auth.signOut().then(function (r) {
      if (r.error) throw r.error;
      return true;
    });
  }

  /* ------------------------------------------------------------------ */
  /* Lecture des données de référence                                    */
  /* ------------------------------------------------------------------ */

  /* Colonnes lues pour un contrat — une seule définition, pour que tous les
     écrans (saisie, récap, période, familles) voient exactement les mêmes
     champs, y compris les paramètres de règles rendus modifiables au lot 5. */
  var CHAMPS_CONTRAT =
    'id, prenom_enfant, famille_id, date_debut, date_fin, jours_planning, ' +
    'heure_arrivee, heure_depart, minutes_contractuelles, minutes_sup_jour, ' +
    'minutes_par_jour_conge, entretien_centimes_jour, statut, ' +
    'sup_dues_si_enfant_absent, ordre_imputation, archive, ' +
    /* Lot 8 — l'identité de l'enfant. Ajoutée ICI et pas ailleurs : ce select
       est la seule définition de « ce qu'est un contrat » pour toute
       l'application. Une colonne ajoutée par une migration et oubliée ici
       n'existerait pour aucun écran — c'est le défaut qui s'est produit deux
       fois (lots 9 et 13) et que test/couche-donnees.test.js garde désormais. */
    'nom, genre, couleur, photo, modele_id, ' +
    'famille:famille_id ( id, nom, canal, archive )';

  /* LOT 17 — les conditions du contrat, datées (§17.2). `salaire_contrat` est
     devenue `avenant_contrat` et porte les ONZE réglages, plus le brut et le
     net. Une seule définition ici, comme pour `CHAMPS_CONTRAT` : une colonne
     ajoutée par une migration et oubliée dans un select n'existerait pour
     aucun écran — c'est le défaut qui s'est produit deux fois (lots 9 et 13),
     et que test/couche-donnees.test.js garde désormais. */
  var CHAMPS_AVENANT =
    'id, contrat_id, date_effet, numero, reconstitue, ' +
    'brut_mensuel_centimes, net_mensuel_centimes, ' +
    'jours_planning, heure_arrivee, heure_depart, minutes_contractuelles, ' +
    'minutes_sup_jour, minutes_par_jour_conge, entretien_centimes_jour, ' +
    'sup_dues_si_enfant_absent, ordre_imputation';

  /* Les onze réglages qu'un avenant peut porter, sans les colonnes d'identité.
     Sert aux écritures : `numero` et `reconstitue` ne sont jamais transmis par
     un écran — le premier est calculé, le second n'est vrai que pour les
     lignes fabriquées par la migration `014`. */
  var CHAMPS_AVENANT_MODIFIABLES = [
    'date_effet', 'brut_mensuel_centimes', 'net_mensuel_centimes',
    'jours_planning', 'heure_arrivee', 'heure_depart', 'minutes_contractuelles',
    'minutes_sup_jour', 'minutes_par_jour_conge', 'entretien_centimes_jour',
    'sup_dues_si_enfant_absent', 'ordre_imputation'
  ];

  /* LOT 17 — le point de départ des compteurs. Les congés payés passent en
     MINUTES (§17.6) ; les colonnes en dixièmes existent encore en base mais
     ne sont PLUS LUES, et ne doivent donc plus figurer dans aucun select :
     une colonne demandée est une colonne qu'un écran finira par afficher. */
  var CHAMPS_COMPTEUR_INITIAL =
    'contrat_id, date_reference, minutes_sup, minutes_cp_acquis, minutes_cp_pris';

  /* LOT 17 — les journées portent désormais l'écart d'horaire déclaré
     (§17.5). Une seule définition, pour les trois selects qui les lisent. */
  /* LOT 20 — `entretien_du` s'ajoute (§20.2). Elle décide si l'indemnité du
     jour est due, et le moteur la lit : oubliée du select, elle arriverait
     `undefined`, le moteur la lirait comme « non fausse », et l'indemnité
     serait payée sur une journée dont Maria l'a retirée. */
  var CHAMPS_JOURNEE =
    'id, contrat_id, jour, type, minutes_reelles, entretien_centimes, commentaire, ' +
    'minutes_sup_exceptionnelles, minutes_sup_renoncees, sup_dues_override, ' +
    'ecart_minutes, ecart_evenement, ecart_heure_reelle, ecart_impute_sur, ' +
    'entretien_du';

  /* LOT 20 (§20.2) — les périodes de familiarisation. */
  var CHAMPS_PERIODE_FAM = 'id, contrat_id, date_debut, date_fin';

  /* Familles non archivées. */
  function listFamilles() {
    return client.from('famille')
      .select('id, nom, canal, archive')
      .eq('archive', false)
      .order('nom', { ascending: true })
      .then(deballer);
  }

  /* Toutes les familles, archivées comprises (onglet Familles, lot 5 C2). */
  function listFamillesToutes() {
    return client.from('famille')
      .select('id, nom, canal, archive')
      .order('nom', { ascending: true })
      .then(deballer);
  }

  /* Contrats non archivés, avec leur famille. Triés par prénom d'enfant.
     Alimente l'écran de SAISIE : on ne saisit pas de journées sur un contrat
     terminé. Le récap, lui, passe par listContratsPourMois (lot 5 C4). */
  function listContratsActifs() {
    return client.from('contrat')
      .select(CHAMPS_CONTRAT)
      .eq('archive', false)
      .order('prenom_enfant', { ascending: true })
      .then(deballer);
  }

  /* Tous les contrats, archivés compris (onglet Familles, lot 5 C2). */
  function listContratsTous() {
    return client.from('contrat')
      .select(CHAMPS_CONTRAT)
      .order('prenom_enfant', { ascending: true })
      .then(deballer);
  }

  /* Lot 5 C4 — contrats dont la période d'activité RECOUVRE le mois demandé,
     ARCHIVÉS COMPRIS. C'est la période affichée qui décide de ce qui est
     visible, jamais le rangement visuel : un contrat archivé le 15 du mois
     doit rester dans le récap de ce mois-là.
     Recouvrement : date_debut <= dernier jour du mois
                    ET (date_fin nulle OU date_fin >= premier jour du mois).
     Comparaisons sur des chaînes 'YYYY-MM-DD' (dates pures, jamais d'objet
     Date avec heure). */
  function listContratsPourMois(annee, mois) {
    var b = bornesMois(annee, mois);
    return client.from('contrat')
      .select(CHAMPS_CONTRAT)
      .lte('date_debut', b.fin)
      .or('date_fin.is.null,date_fin.gte.' + b.debut)
      .order('prenom_enfant', { ascending: true })
      .then(deballer);
  }

  /* Lot 5 C6 — même règle que listContratsPourMois, sur une PLAGE de dates :
     ce sont les contrats actifs PENDANT la période qui doivent apparaître,
     archivés compris. */
  function listContratsPourPeriode(dateDebut, dateFin) {
    return client.from('contrat')
      .select(CHAMPS_CONTRAT)
      .lte('date_debut', dateFin)
      .or('date_fin.is.null,date_fin.gte.' + dateDebut)
      .order('prenom_enfant', { ascending: true })
      .then(deballer);
  }

  /* Les avenants d'un contrat, du plus ancien au plus récent. C'est la SEULE
     source des conditions de calcul depuis le lot 17 : plus aucun réglage
     n'est lu sur `contrat` (§17.2). */
  function getAvenants(contratId) {
    return client.from('avenant_contrat')
      .select(CHAMPS_AVENANT)
      .eq('contrat_id', contratId)
      .order('date_effet', { ascending: true })
      .then(deballer);
  }

  function getCompteurInitial(contratId) {
    return client.from('compteur_initial')
      .select(CHAMPS_COMPTEUR_INITIAL)
      .eq('contrat_id', contratId)
      .maybeSingle()
      .then(function (r) { if (r.error) throw r.error; return r.data; });
  }

  /* ------------------------------------------------------------------ */
  /* Écritures familles / contrats (lot 5 C2 et C3)                      */
  /*                                                                     */
  /* Aucune migration : les colonnes et les policies RLS famille_insert / */
  /* famille_update / contrat_insert / contrat_update existent depuis le  */
  /* lot 2. `owner` n'est JAMAIS transmis : il est posé par défaut en     */
  /* base (auth.uid()) et filtré par RLS.                                */
  /*                                                                     */
  /* Aucune suppression n'est exposée ici, volontairement (lot 5 C3) :    */
  /* les policies `delete` existent en base mais l'application ne doit    */
  /* jamais détruire une famille ou un contrat — on archive.             */
  /* ------------------------------------------------------------------ */

  function creerFamille(champs) {
    return client.from('famille')
      .insert({ nom: champs.nom, canal: (champs.canal == null ? null : champs.canal) })
      .select('id, nom, canal, archive')
      .then(deballer)
      .then(function (r) { return r[0]; });
  }

  function majFamille(id, champs) {
    return client.from('famille')
      .update(nettoyer(champs, ['nom', 'canal', 'archive']))
      .eq('id', id)
      .select('id, nom, canal, archive')
      .then(deballer)
      .then(function (r) { return r[0]; });
  }

  var CHAMPS_CONTRAT_MODIFIABLES = [
    'famille_id', 'prenom_enfant', 'date_debut', 'date_fin', 'jours_planning',
    'heure_arrivee', 'heure_depart', 'minutes_contractuelles', 'minutes_sup_jour',
    'minutes_par_jour_conge', 'entretien_centimes_jour', 'statut',
    'sup_dues_si_enfant_absent', 'ordre_imputation', 'archive',
    'nom', 'genre', 'couleur', 'photo',                      // lot 8
    'modele_id'                                             // lot 11
  ];

  function creerContrat(champs) {
    return client.from('contrat')
      .insert(nettoyer(champs, CHAMPS_CONTRAT_MODIFIABLES))
      .select(CHAMPS_CONTRAT)
      .then(deballer)
      .then(function (r) { return r[0]; });
  }

  function majContrat(id, champs) {
    return client.from('contrat')
      .update(nettoyer(champs, CHAMPS_CONTRAT_MODIFIABLES))
      .eq('id', id)
      .select(CHAMPS_CONTRAT)
      .then(deballer)
      .then(function (r) { return r[0]; });
  }

  /* Lot 5 C3 — le geste d'archivage, en une seule écriture : il porte les
     TROIS notions distinctes du contrat, sans jamais les confondre.
       statut   = cycle de vie métier      -> 'termine'
       date_fin = date effective de fin    -> conditionne les calculs
       archive  = rangement visuel         -> sort des écrans courants
     Réversible : voir desarchiverContrat. Jamais automatique. */
  function archiverContrat(id, dateFin) {
    return majContrat(id, { statut: 'termine', date_fin: dateFin, archive: true });
  }

  /* Désarchivage : on ne touche QU'AU rangement visuel. La date de fin et le
     statut restent tels quels — les effacer réécrirait l'histoire du contrat
     et modifierait des calculs déjà produits. */
  function desarchiverContrat(id) {
    return majContrat(id, { archive: false });
  }

  /* ------------------------------------------------------------------ */
  /* Identité d'un contrat et gestion des foyers (lot 8)                 */
  /*                                                                     */
  /* CE QUE CES SIX FONCTIONS SÉPARENT, ET POURQUOI ÇA COMPTE.           */
  /*                                                                     */
  /* Jusqu'ici la fiche contrat portait un champ « Nom de la famille »   */
  /* qui écrivait dans `famille.nom`. Trois gestes très différents        */
  /* passaient par le même champ :                                       */
  /*   - corriger le nom de l'ENFANT,                                    */
  /*   - renommer le FOYER, pour tous ses enfants d'un coup,             */
  /*   - rattacher ce contrat à un AUTRE foyer.                          */
  /* Maria croyait faire le premier, elle faisait le deuxième, sur trois  */
  /* contrats, sans le savoir. C'est une perte de données réelle, en      */
  /* production. Chaque geste a désormais sa fonction, et le renommage    */
  /* d'un foyer a en plus son écran dédié qui NOMME les enfants touchés.  */
  /* ------------------------------------------------------------------ */

  /* L'identité de l'enfant : ce qui le désigne, jamais ce qui désigne son
     foyer. `famille_id` n'en fait volontairement PAS partie — changer de
     famille est un autre geste, avec sa propre fonction. */
  function majContratIdentite(contratId, champs) {
    return majContrat(contratId,
      nettoyer(champs, ['nom', 'prenom_enfant', 'genre', 'couleur', 'photo']));
  }

  /* Rattacher un contrat à un autre foyer. N'écrit QUE `famille_id` : aucun
     nom n'est touché, ni celui de l'enfant, ni celui d'aucun foyer. */
  function rattacherContratAFamille(contratId, familleId) {
    return majContrat(contratId, { famille_id: familleId });
  }

  /* Renommer un FOYER. La fonction ne prévient personne : c'est l'écran qui
     doit avoir listé les enfants concernés AVANT d'arriver ici. */
  function renommerFamille(familleId, nouveauNom) {
    return majFamille(familleId, { nom: nouveauNom });
  }

  /* Ranger un foyer. REFUSE tant qu'un de ses contrats est encore actif
     (V8-20) : un foyer rangé disparaît des écrans courants, et avec lui un
     enfant que Maria garde encore. Le contrôle est fait ici, pas seulement à
     l'écran — l'écran peut être contourné, la couche données non.

     L'erreur NOMME le contrat bloquant. « Impossible d'archiver » sans dire
     lequel oblige Maria à ouvrir les contrats un par un pour deviner. */
  function archiverFamille(familleId) {
    return client.from('contrat')
      .select('id, prenom_enfant, archive, statut')
      .eq('famille_id', familleId)
      .then(deballer)
      .then(function (contrats) {
        var actifs = contrats.filter(function (c) {
          return !c.archive && c.statut !== 'termine';
        });
        if (actifs.length) {
          var e = new Error('FAMILLE_ENCORE_ACTIVE');
          e.code = 'FAMILLE_ENCORE_ACTIVE';
          e.prenoms = actifs.map(function (c) { return c.prenom_enfant; });
          throw e;
        }
        return majFamille(familleId, { archive: true });
      });
  }

  function desarchiverFamille(familleId) {
    return majFamille(familleId, { archive: false });
  }

  /* Les foyers avec leurs contrats imbriqués, ARCHIVÉS COMPRIS des deux côtés.
     Oublier `archive` ferait disparaître les anciens contrats au lieu de les
     ranger — et un contrat terminé reste consultable pour toujours : ses mois
     peuvent être contestés des années après.

     Un seul aller-retour : imbriquer coûte moins cher que N+1 appels depuis un
     téléphone en 4G. */
  function listFamillesAvecContrats() {
    return client.from('famille')
      .select('id, nom, canal, archive, ' +
        'contrats:contrat ( id, prenom_enfant, nom, genre, photo, couleur, ' +
        'statut, archive, date_debut, date_fin )')
      .order('nom', { ascending: true })
      .then(deballer)
      .then(function (familles) {
        /* PostgREST ne trie pas les lignes imbriquées : on le fait ici, une
           fois, plutôt que dans chacun des écrans qui les affichent. */
        familles.forEach(function (f) {
          (f.contrats || []).sort(function (a, b) {
            return String(a.prenom_enfant || '').localeCompare(String(b.prenom_enfant || ''), 'fr');
          });
        });
        return familles;
      });
  }

  /* ------------------------------------------------------------------ */
  /* Rappels par notification (lot 15)                                   */
  /* ------------------------------------------------------------------ */

  /* ------------------------------------------------------------------ */
  /* LOT 16 §16.2 — L'identité qui signe les documents                   */
  /* ------------------------------------------------------------------ */

  var CHAMPS_EMETTRICE = 'owner, nom, updated_at';

  /* Rend `null` quand rien n'a été saisi — ce n'est pas une erreur, c'est
     l'état de départ, et le document sait quoi en faire. */
  function getEmettrice() {
    return client.from('emettrice')
      .select(CHAMPS_EMETTRICE)
      .maybeSingle()
      .then(function (r) { if (r.error) throw r.error; return r.data; });
  }

  function enregistrerEmettrice(nom) {
    return client.from('emettrice')
      .upsert({ nom: nom, updated_at: new Date().toISOString() }, { onConflict: 'owner' })
      .select(CHAMPS_EMETTRICE)
      .then(deballer)
      .then(function (r) { return r[0]; });
  }

  function getPreferenceRappel() {
    return client.from('preference_rappel')
      .select('owner, actif, jour_du_mois, heure, chaque_jour_ensuite, maj_le')
      .maybeSingle()
      .then(function (r) { if (r.error) throw r.error; return r.data; });
  }

  function enregistrerPreferenceRappel(champs) {
    return client.from('preference_rappel')
      .upsert({
        actif: !!champs.actif,
        jour_du_mois: champs.jour_du_mois,
        heure: champs.heure,
        chaque_jour_ensuite: !!champs.chaque_jour_ensuite
      }, { onConflict: 'owner' })
      .select('owner, actif, jour_du_mois, heure, chaque_jour_ensuite, maj_le')
      .then(deballer)
      .then(function (r) { return r[0]; });
  }

  /* L'abonnement d'un APPAREIL. `endpoint` est unique : réenregistrer le même
     téléphone ne crée pas de doublon. */
  function enregistrerAbonnementPush(abonnement) {
    return client.from('abonnement_push')
      .upsert({
        endpoint: abonnement.endpoint,
        cle_p256dh: abonnement.cle_p256dh,
        cle_auth: abonnement.cle_auth
      }, { onConflict: 'endpoint' })
      .select('id, endpoint, cree_le')
      .then(deballer)
      .then(function (r) { return r[0]; });
  }

  function supprimerAbonnementPush(endpoint) {
    return client.from('abonnement_push')
      .delete()
      .eq('endpoint', endpoint)
      .then(function (r) { if (r.error) throw r.error; return true; });
  }

  /* ------------------------------------------------------------------ */
  /* Mise en service, export, suppression franche (lot 14)               */
  /* ------------------------------------------------------------------ */

  /* Les compteurs de reprise : « je tenais mes comptes sur papier, voilà où
     j'en suis ». Écrits UNE FOIS, ils servent de point de départ à tout
     l'historique — une erreur ici se retrouve dans tous les mois suivants.

     `upsert` sur la clé primaire (contrat_id) : un contrat n'a qu'un point de
     départ. Le refus de la contrainte `compteur_initial_coherent` (pris >
     acquis, valeurs négatives) remonte tel quel et sera traduit en français
     par messages.js — jamais affiché brut. */
  function enregistrerCompteurInitial(contratId, champs) {
    return client.from('compteur_initial')
      .upsert({
        contrat_id: contratId,
        date_reference: champs.date_reference,
        /* `minutes_sup` peut être NÉGATIF depuis le lot 17 (§17.5) : une
           reprise de comptes doit pouvoir dire « je dois 1 h 30 ». D'où le
           test à `null` plutôt qu'un `|| 0`, qui écraserait un négatif
           parfaitement légitime — non, il l'écraserait pas, mais il masquerait
           un zéro voulu ; le test explicite dit ce qu'on veut dire. */
        minutes_sup: champs.minutes_sup == null ? 0 : champs.minutes_sup,
        minutes_cp_acquis: champs.minutes_cp_acquis || 0,
        minutes_cp_pris: champs.minutes_cp_pris || 0
      }, { onConflict: 'contrat_id' })
      .select(CHAMPS_COMPTEUR_INITIAL)
      .then(deballer)
      .then(function (r) { return r[0]; });
  }

  /* LA SEULE SUPPRESSION FRANCHE DU PROJET, et elle est étroite : un contrat
     qui ne porte AUCUNE journée et AUCUN récapitulatif. C'est le cas de la
     faute de frappe — un enfant créé deux fois, un prénom mal saisi — pour
     lequel l'archivage serait absurde : il n'y a rien à conserver.

     LA VÉRIFICATION EST EN BASE (migration 010), pas ici. Les six clés
     étrangères qui pointent vers `contrat` sont en `on delete cascade` : sans
     le trigger, ce `delete` réussirait toujours et emporterait silencieusement
     des mois clôturés. Le contrôle client ci-dessous n'est qu'une courtoisie —
     il évite un aller-retour et donne un message immédiat. La garantie, elle,
     est ailleurs (risque n° 2 de la spécification). */
  function supprimerContrat(contratId) {
    return client.from('contrat')
      .delete()
      .eq('id', contratId)
      .then(function (r) { if (r.error) throw r.error; return true; });
  }

  /* Le contrat porte-t-il déjà quelque chose ? Sert à MONTRER ou non le bouton
     de suppression — on ne montre jamais une action impossible (V8-20). */
  function contratEstVierge(contratId) {
    /* CORRECTIF A4 DE LA RELECTURE PR9 — cette liste doit être EXACTEMENT
       celle du trigger (migration 012). Elle ne comptait que les journées et
       les récapitulatifs : un contrat portant une note ou un congé imputé
       affichait le bouton de suppression ET la phrase « il ne reste rien à
       conserver », qui était fausse. La base refusait ensuite — donc rien
       n'était perdu — mais Maria voyait une action proposée puis refusée, ce
       qui est exactement ce que V8-20 interdit.

       ATTENTION : toute table référençant `contrat` ajoutée plus tard doit
       être ajoutée ICI ET DANS LE TRIGGER. Les deux listes divergent en
       silence si on n'y prend pas garde. */
    return Promise.all([
      client.from('journee').select('id').eq('contrat_id', contratId).limit(1).then(deballer),
      client.from('recap_mensuel').select('id').eq('contrat_id', contratId).limit(1).then(deballer),
      client.from('note_mensuelle').select('id').eq('contrat_id', contratId).limit(1).then(deballer),
      client.from('imputation_conge').select('id').eq('contrat_id', contratId).limit(1).then(deballer)
    ]).then(function (r) {
      return r.every(function (liste) { return (liste || []).length === 0; });
    });
  }

  /* TOUT l'historique, en un objet. « À garder de côté » : c'est le filet de
     Maria si un jour l'application disparaît, et la pièce qu'elle sortira si
     un désaccord remonte à plusieurs années.

     AUCUNE PHOTO (risque n° 3, A5). Quatre photos de 50 Ko dans un export qui
     compte des dizaines de mois, ce sont des centaines de kilo-octets de
     données parfaitement inutiles hors de l'application — et un fichier qu'on
     n'ouvre plus. Les contrats ARCHIVÉS sont inclus : ce sont eux qu'on vient
     chercher des années après. */
  function exporterHistorique() {
    return Promise.all([
      listFamillesToutes(),
      listContratsTous(),
      client.from('avenant_contrat')
        .select(CHAMPS_AVENANT)
        .order('date_effet', { ascending: true }).then(deballer),
      client.from('compteur_initial')
        .select(CHAMPS_COMPTEUR_INITIAL)
        .then(deballer),
      client.from('journee')
        .select(CHAMPS_JOURNEE)
        .order('jour', { ascending: true }).then(deballer),
      client.from('recap_mensuel')
        .select('id, contrat_id, annee, mois, statut, donnees, fige_le, transmis_le')
        .order('annee', { ascending: true }).then(deballer),
      client.from('imputation_conge').select(CHAMPS_IMPUTATION).then(deballer),
      client.from('evenement_recap').select('id, recap_id, type, survenu_le, motif')
        .then(deballer).catch(function () { return []; }),
      listModeles().catch(function () { return []; })
    ]).then(function (r) {
      return {
        exporte_le: null,          // posé par l'appelant : la base n'a pas d'horloge ici
        familles: r[0],
        /* La photo est RETIRÉE ici, à la source. Un export qui la porterait
           serait déjà écrit sur le disque de Maria avant qu'on s'en aperçoive. */
        contrats: (r[1] || []).map(function (c) {
          var copie = {};
          Object.keys(c).forEach(function (k) { if (k !== 'photo') copie[k] = c[k]; });
          return copie;
        }),
        avenants: r[2],
        compteurs_initiaux: r[3],
        journees: r[4],
        recapitulatifs: r[5],
        imputations: r[6],
        evenements: r[7],
        contrats_types: r[8]
      };
    });
  }

  /* ------------------------------------------------------------------ */
  /* Notes mensuelles (lot 12)                                           */
  /*                                                                     */
  /* Un espace d'écriture POUR MARIA SEULE. Ces deux fonctions sont       */
  /* volontairement les seules : il n'existe aucun chemin par lequel une  */
  /* note pourrait rejoindre un instantané de récapitulatif, donc aucun   */
  /* chemin par lequel elle pourrait atteindre une famille.               */
  /* ------------------------------------------------------------------ */

  var CHAMPS_NOTE = 'id, contrat_id, annee, mois, texte, maj_le';

  function getNoteMensuelle(contratId, annee, mois) {
    return client.from('note_mensuelle')
      .select(CHAMPS_NOTE)
      .eq('contrat_id', contratId)
      .eq('annee', annee)
      .eq('mois', mois)
      .maybeSingle()
      .then(function (r) { if (r.error) throw r.error; return r.data; });
  }

  /* `upsert` sur la clé unique (contrat, année, mois) : une note par mois et
     par enfant, écrite ou réécrite d'un seul geste. `maj_le` est posé par la
     BASE (trigger de la migration 009) — l'horloge d'un téléphone mal réglé ne
     doit pas décider de l'ordre des choses. */
  function enregistrerNoteMensuelle(contratId, annee, mois, texte) {
    return client.from('note_mensuelle')
      .upsert({ contrat_id: contratId, annee: annee, mois: mois, texte: texte || '' },
              { onConflict: 'contrat_id,annee,mois' })
      .select(CHAMPS_NOTE)
      .then(deballer)
      .then(function (r) { return r[0]; });
  }

  /* ------------------------------------------------------------------ */
  /* Contrats types (lot 11)                                             */
  /*                                                                     */
  /* Un contrat type n'est pas un gabarit qu'on applique : c'est l'état   */
  /* des conditions habituelles de Maria à une date donnée. Les contrats  */
  /* s'y RATTACHENT et peuvent s'en écarter — un écart est un fait        */
  /* négocié avec une famille, jamais une erreur à corriger.              */
  /*                                                                     */
  /* AUCUNE FONCTION DE SUPPRESSION N'EST EXPOSÉE, et la base n'accorde   */
  /* pas le droit : une ancienne version explique les montants d'un mois  */
  /* déjà clôturé, que RG-15 interdit de recalculer.                      */
  /* ------------------------------------------------------------------ */

  var CHAMPS_MODELE =
    'id, nom, date_effet, jours_planning, heure_arrivee, heure_depart, ' +
    'minutes_contractuelles, minutes_sup_jour, minutes_par_jour_conge, ' +
    'entretien_centimes_jour, brut_mensuel_centimes, net_mensuel_centimes, ' +
    'sup_dues_si_enfant_absent, ordre_imputation, cree_le';

  var CHAMPS_MODELE_ECRITS = [
    'nom', 'date_effet', 'jours_planning', 'heure_arrivee', 'heure_depart',
    'minutes_contractuelles', 'minutes_sup_jour', 'minutes_par_jour_conge',
    'entretien_centimes_jour', 'brut_mensuel_centimes', 'net_mensuel_centimes',
    'sup_dues_si_enfant_absent', 'ordre_imputation'
  ];

  /* Toutes les versions, la plus récente en tête. On les renvoie TOUTES,
     périmées comprises : c'est leur raison d'être. */
  function listModeles() {
    return client.from('modele_contrat')
      .select(CHAMPS_MODELE)
      .order('date_effet', { ascending: false })
      .then(deballer);
  }

  /* La version en vigueur à une date : la plus récente dont la date d'effet
     est ANTÉRIEURE OU ÉGALE. Même règle que `salaireApplicable` du moteur
     (RG-15) — et pour la même raison : ce qui vaut à une date ne dépend pas
     de ce qui a été décidé après. */
  function modeleEnVigueur(dateIso) {
    return client.from('modele_contrat')
      .select(CHAMPS_MODELE)
      .lte('date_effet', dateIso)
      .order('date_effet', { ascending: false })
      .limit(1)
      .then(deballer)
      .then(function (r) { return r[0] || null; });
  }

  function creerModele(modele) {
    return client.from('modele_contrat')
      .insert(nettoyer(modele, CHAMPS_MODELE_ECRITS))
      .select(CHAMPS_MODELE)
      .then(deballer)
      .then(function (r) { return r[0]; });
  }

  /* Rattacher un contrat à une version. N'écrit QUE `modele_id` : le
     rattachement est un confort d'affichage, il ne change aucun réglage et
     n'entre dans aucun calcul. C'est l'ALIGNEMENT, geste distinct, qui
     modifie réellement un contrat. */
  function rattacherContratAModele(contratId, modeleId) {
    return majContrat(contratId, { modele_id: modeleId });
  }

  /* Les CHAMPS COMPARÉS entre un contrat et son modèle, dans l'ordre où ils
     se lisent. La rémunération est traitée à part : elle ne vit pas sur le
     contrat mais dans son historique de barèmes. */
  var CHAMPS_COMPARES_MODELE = [
    { champ: 'jours_planning',            libelle: 'Jours de garde',            format: 'planning' },
    { champ: 'heure_arrivee',             libelle: 'Heure d’arrivée',           format: 'heure' },
    { champ: 'heure_depart',              libelle: 'Heure de départ',           format: 'heure' },
    { champ: 'minutes_contractuelles',    libelle: 'Minutes contractuelles',    format: 'duree' },
    { champ: 'minutes_sup_jour',          libelle: 'Heures sup par jour',       format: 'duree' },
    { champ: 'minutes_par_jour_conge',    libelle: 'Minutes par jour de congé', format: 'duree' },
    { champ: 'entretien_centimes_jour',   libelle: 'Entretien par jour',        format: 'euros' },
    { champ: 'sup_dues_si_enfant_absent', libelle: 'Heures sup si l’enfant est absent', format: 'oui_non' },
    { champ: 'ordre_imputation',          libelle: 'Congés déduits d’abord',    format: 'ordre' }
  ];

  /* Les écarts entre un contrat et le modèle auquel il est rattaché.

     CALCULÉE CÔTÉ CLIENT, sans appel supplémentaire : les deux objets sont
     déjà en mémoire. Et surtout — un écart N'EST PAS UNE ERREUR. C'est un fait
     négocié avec une famille : Tom garde son ancienne rémunération parce que
     ses parents ne l'ont pas revalorisée. L'application le CONSTATE, elle ne le
     corrige jamais d'office (risque n° 3).

     `salaireCourant` est facultatif : sans lui, la rémunération n'est pas
     comparée plutôt que d'être comparée à zéro. */
  function ecartsContratModele(contrat, modele, salaireCourant) {
    if (!contrat || !modele) return [];
    var out = [];
    CHAMPS_COMPARES_MODELE.forEach(function (c) {
      var a = contrat[c.champ];
      var b = modele[c.champ];
      if (!memeValeur(a, b)) {
        out.push({ champ: c.champ, libelle: c.libelle, format: c.format,
                   valeurContrat: a, valeurModele: b });
      }
    });
    if (salaireCourant) {
      if (salaireCourant.brut_mensuel_centimes !== modele.brut_mensuel_centimes ||
          salaireCourant.net_mensuel_centimes !== modele.net_mensuel_centimes) {
        out.push({
          champ: 'remuneration', libelle: 'Rémunération', format: 'remuneration',
          valeurContrat: {
            brut_mensuel_centimes: salaireCourant.brut_mensuel_centimes,
            net_mensuel_centimes: salaireCourant.net_mensuel_centimes
          },
          valeurModele: {
            brut_mensuel_centimes: modele.brut_mensuel_centimes,
            net_mensuel_centimes: modele.net_mensuel_centimes
          }
        });
      }
    }
    return out;
  }

  /* Deux valeurs de réglage sont-elles les mêmes ? Les heures arrivent en
     'HH:MM:SS' d'un côté et parfois 'HH:MM' de l'autre ; les plannings sont
     des tableaux. Comparer avec === donnerait des écarts imaginaires, et un
     écart imaginaire est pire qu'un écart manqué : il pousse Maria à
     « corriger » un contrat qui n'a rien. */
  function memeValeur(a, b) {
    if (Array.isArray(a) || Array.isArray(b)) {
      var la = (a || []).slice().sort().join(',');
      var lb = (b || []).slice().sort().join(',');
      return la === lb;
    }
    if (typeof a === 'string' && typeof b === 'string' &&
        /^\d{2}:\d{2}/.test(a) && /^\d{2}:\d{2}/.test(b)) {
      return a.slice(0, 5) === b.slice(0, 5);
    }
    return a === b;
  }

  /* CODE MORT DEPUIS LE LOT 17 (§17.9), CONSERVÉ JUSQU'AU LOT 19 (§19.2).

     « Modifier plusieurs contrats » est RETIRÉ de l'application. Il écrivait
     les réglages directement sur `contrat`, sans aucune date : avec les
     avenants, il serait devenu le seul moyen d'effacer le passé sans s'en
     apercevoir. L'écran a disparu du Menu ; cette fonction n'est plus appelée
     par personne.

     Elle n'est pas supprimée — c'est le §19.2 qui s'en chargera — mais elle
     REFUSE désormais plutôt que d'écrire. Une fonction morte qui continuerait
     d'écrire sur `contrat` des réglages que plus rien ne lit produirait
     exactement le pire des cas : une modification qui paraît réussir et ne
     change aucun calcul. */
  function majContratsEnLot() {
    return Promise.reject(new Error('ECRAN_RETIRE_LOT17'));
  }

  /* ------------------------------------------------------------------ */
  /* Les avenants : les conditions du contrat, datées (lot 17, §17.2)     */
  /*                                                                     */
  /* La mécanique RG-15 (`conditionsApplicables`) est en place et validée */
  /* dans le moteur depuis le lot 1 ; le lot 17 en élargit le périmètre à */
  /* onze réglages. Aucun calcul ici : la couche données ne fait que lire */
  /* et écrire.                                                          */
  /*                                                                     */
  /* CORRECTION B1 ET C4 DE LA RELECTURE DU LOT 17 — LE NUMÉRO EST POSÉ EN   */
  /* BASE, ET IL EST UNE IDENTITÉ.                                          */
  /*                                                                        */
  /* CE QUI NE MARCHAIT PAS. `numero` est `not null` sans valeur par défaut  */
  /* et sans trigger ; il était délibérément exclu du corps de la requête,   */
  /* pour être posé APRÈS l'insertion par une renumérotation. L'insertion    */
  /* partait donc sans lui : `23502 null value in column "numero"`, à tous   */
  /* les coups, sur tous les contrats. « Faire un avenant » — LA fonction du */
  /* lot 17 — était inutilisable en production.                             */
  /*                                                                        */
  /* Et la renumérotation elle-même ne pouvait pas fonctionner : quatre      */
  /* requêtes indépendantes, sans transaction, contre un index unique. Sur   */
  /* une permutation cyclique — corriger la date d'un avenant vers l'amont — */
  /* aucun ordre d'exécution ligne à ligne ne l'applique. L'écran annonçait  */
  /* un échec TOTAL alors que la date avait bien été écrite.                 */
  /*                                                                        */
  /* DÉCISION D'ADRIEN : le numéro est l'identité de l'avenant, pas son      */
  /* rang. C'est le numéro que Maria cite à une famille ; il est posé à la   */
  /* création par la migration `015` et ne change plus jamais. La base le    */
  /* refuse même en modification.                                           */
  /*                                                                        */
  /* L'ORDRE D'APPLICATION, LUI, VIENT TOUJOURS DE `date_effet` : le moteur, */
  /* la chaîne et la frise trient par date, jamais par numéro. Un numéro non */
  /* monotone dans la frise est donc possible, et c'est voulu.               */
  /* ------------------------------------------------------------------ */

  function ajouterAvenant(contratId, champs) {
    return client.from('avenant_contrat')
      .insert(nettoyer(Object.assign({ contrat_id: contratId }, champs),
                       ['contrat_id'].concat(CHAMPS_AVENANT_MODIFIABLES)))
      .select(CHAMPS_AVENANT)
      .then(deballer)
      .then(function (r) { return r[0]; });
  }

  function majAvenant(id, champs) {
    return client.from('avenant_contrat')
      .update(nettoyer(champs, CHAMPS_AVENANT_MODIFIABLES))
      .eq('id', id)
      .select(CHAMPS_AVENANT)
      .then(deballer)
      .then(function (r) { return r[0]; });
  }

  /* Suppression d'un avenant. L'appelant DOIT avoir vérifié qu'aucun mois
     clôturé ne l'utilise (§17.4) : la base ne connaît pas le lien entre un
     avenant et un récapitulatif figé, et un refus qui ne nomme pas les mois
     concernés ne sert à rien. */
  function supprimerAvenant(id) {
    return client.from('avenant_contrat')
      .delete()
      .eq('id', id)
      .then(function (r) { if (r.error) throw r.error; return true; });
  }

  /* ------------------------------------------------------------------ */
  /* Journées (saisie par exception)                                     */
  /* ------------------------------------------------------------------ */

  /* Toutes les journées saisies d'un contrat pour un mois donné.
     Renvoie un objet indexé par date : { 'YYYY-MM-DD': ligneJournee }. */
  function getJourneesMois(contratId, annee, mois) {
    var bornes = bornesMois(annee, mois);
    return client.from('journee')
      .select(CHAMPS_JOURNEE)
      .eq('contrat_id', contratId)
      .gte('jour', bornes.debut)
      .lte('jour', bornes.fin)
      .then(deballer)
      .then(function (lignes) {
        var parJour = {};
        lignes.forEach(function (l) { parJour[l.jour] = l; });
        return parJour;
      });
  }

  /* Lot 5 C6 (performance) — toutes les journées d'un contrat sur une PLAGE
     de dates, en UN seul aller-retour. Le récap de période enchaîne des
     dizaines de mois : un appel par mois et par contrat écroulerait l'écran.
     Renvoie un objet indexé par mois : { 'YYYY-MM' : { 'YYYY-MM-DD': ligne } },
     directement consommable par le calcul mois par mois. */
  function getJourneesPeriode(contratId, dateDebut, dateFin) {
    return client.from('journee')
      .select(CHAMPS_JOURNEE)
      .eq('contrat_id', contratId)
      .gte('jour', dateDebut)
      .lte('jour', dateFin)
      .then(deballer)
      .then(function (lignes) {
        var parMois = {};
        lignes.forEach(function (l) {
          var cle = l.jour.slice(0, 7);
          if (!parMois[cle]) parMois[cle] = {};
          parMois[cle][l.jour] = l;
        });
        return parMois;
      });
  }

  /* Enregistre une exception pour un contrat et un jour (upsert sur la
     contrainte unique (contrat_id, jour)). owner est posé par défaut en base
     (auth.uid()) et filtré par RLS : on ne le transmet jamais côté client.

     Lot 9 — trois champs de flexibilité supplémentaires, tous OPTIONNELS.
     Règle de transmission, à respecter à la lettre :
       - champ absent de `ligne`            -> non transmis, la valeur en base
                                               est conservée ;
       - minutes_sup_exceptionnelles /
         minutes_sup_renoncees présents     -> transmis tels quels, entiers ;
       - sup_dues_override présent à null   -> transmis EXPLICITEMENT à null
                                               (retour au réglage du contrat).
     C'est le seul champ où `null` est une valeur signifiante et non une
     absence : null = « suivre le contrat », false = « explicitement non
     dues ». Ne jamais confondre les deux. */
  function enregistrerJournee(ligne) {
    var payload = {
      contrat_id: ligne.contrat_id,
      jour: ligne.jour,
      type: ligne.type,
      minutes_reelles: (ligne.minutes_reelles == null ? null : ligne.minutes_reelles),
      entretien_centimes: (ligne.entretien_centimes == null ? null : ligne.entretien_centimes),
      commentaire: (ligne.commentaire == null ? null : ligne.commentaire)
    };
    /* LOT 17 §17.5 — les quatre colonnes de l'écart d'horaire suivent la même
       règle de transmission : absentes, elles ne sont pas touchées ; présentes
       à `null`, elles EFFACENT la déclaration. C'est ce qui permet à Maria de
       revenir sur un événement déclaré par erreur — un écart qu'on ne pourrait
       pas retirer serait pire que pas d'écart du tout. */
    /* LOT 20 — `entretien_du` suit exactement la même règle : absente, elle
       n'est pas touchée ; présente, elle est écrite telle quelle. Elle n'est
       jamais transmise à `null` — la colonne est `not null` en base, et
       « je ne me prononce pas » n'existe pas pour elle : l'indemnité est due
       ou elle ne l'est pas. */
    ['minutes_sup_exceptionnelles', 'minutes_sup_renoncees', 'sup_dues_override',
     'ecart_minutes', 'ecart_evenement', 'ecart_heure_reelle', 'ecart_impute_sur',
     'entretien_du']
      .forEach(function (champ) {
        if (Object.prototype.hasOwnProperty.call(ligne, champ) && ligne[champ] !== undefined) {
          payload[champ] = ligne[champ];
        }
      });
    return client.from('journee')
      .upsert(payload, { onConflict: 'contrat_id,jour' })
      .select()
      .then(deballer)
      .then(function (r) { return r[0]; });
  }

  /* Supprime l'exception d'un jour : le jour redevient « présumé présence »
     (ou férié si le calendrier le dit), sans ligne en base. */
  function supprimerJournee(contratId, jour) {
    return client.from('journee')
      .delete()
      .eq('contrat_id', contratId)
      .eq('jour', jour)
      .then(function (r) { if (r.error) throw r.error; return true; });
  }

  /* LOT 18 §18.1 — L'ÉCRITURE GROUPÉE D'UN SEUL CONTRAT.

     `poserAbsenceMaria` écrit une absence de MARIA sur plusieurs contrats.
     Ici c'est l'inverse : plusieurs jours, UN SEUL contrat — parce qu'une
     absence d'enfant ne vaut que pour son contrat (B.0-6, RG-02).

     Les deux fonctions ci-dessous ne décident RIEN : la liste des jours leur
     arrive déjà filtrée sur le planning et les bornes du contrat par l'écran
     qui l'a construite. Elles n'inventent aucun jour, et n'en retirent aucun.

     Un seul appel réseau dans les deux cas : cinq jours marqués d'un geste ne
     doivent pas produire cinq allers-retours, dont trois pourraient réussir et
     deux échouer — un état à moitié écrit est exactement ce qu'on ne veut pas
     avoir à expliquer à Maria. */
  /* CORRECTION B1 ET C1 DE LA RELECTURE DU LOT 18.

     CE QUI NE MARCHAIT PAS. Un `upsert` ne met à jour que les colonnes
     PRÉSENTES dans la charge utile. Les trois colonnes d'ajustement du lot 12
     et les quatre de l'écart d'horaire du lot 17 n'y figuraient pas : elles
     SURVIVAIENT au changement de type, alors que la simulation les
     supprimait. L'effet annoncé avant validation n'était donc pas celui
     obtenu après — le critère §18.1 A2, mis en défaut.

     Et la ligne écrite était incohérente en elle-même : une journée
     `absence_enfant` portant « +45 minutes travaillées en plus ». Le moteur
     les comptait, le document les portait, et rien à l'écran ne permettait de
     comprendre d'où elles venaient.

     DÉCISION D'ADRIEN : l'ajustement est EFFACÉ avec le changement de type,
     l'écran l'annonce avant validation, et « Annuler » le rend.

     LA NOTE, ELLE, SURVIT. Décision d'Adrien également : elle porte souvent la
     raison de l'absence — c'est même son usage le plus probable ici — et
     « rien ne se supprime jamais » (B.0-7). `commentaire` est donc ABSENT de
     la charge utile, et son absence est délibérée : c'est ce qui la préserve.
     Ne pas l'y remettre. */
  function marquerJournees(contratId, jours, type) {
    if (!contratId || !jours || !jours.length) return Promise.resolve([]);
    var payload = jours.map(function (j) {
      return {
        contrat_id: contratId,
        jour: j,
        type: type,
        minutes_reelles: null,
        entretien_centimes: null,
        /* Les huit colonnes qu'un changement de type doit remettre à plat.
           LOT 20 — `entretien_du` en fait partie : l'interrupteur du §20.6
           n'existe que sur une journée qui SORT DU CADRE. Changer le type
           d'une journée la fait rentrer dans le cadre — la garder à `false`
           laisserait une indemnité retirée sur une journée ordinaire, sans
           aucun écran pour la remettre. Retour au défaut : due. */
        minutes_sup_exceptionnelles: 0,
        minutes_sup_renoncees: 0,
        sup_dues_override: null,
        ecart_minutes: null,
        ecart_evenement: null,
        ecart_heure_reelle: null,
        ecart_impute_sur: null,
        entretien_du: true
      };
    });
    return client.from('journee')
      .upsert(payload, { onConflict: 'contrat_id,jour' })
      .select()
      .then(deballer);
  }

  /* Le retour à la présence : la saisie par exception veut qu'une journée
     ordinaire n'ait PAS de ligne (B.0-2). Marquer « présent » n'écrit donc
     rien — cela supprime l'exception.

     ATTENTION (correction C2 du lot 18) : cette suppression détruit la ligne
     ENTIÈRE, note comprise. L'écran ne l'appelle donc que sur les journées qui
     n'en portent pas ; celles qui en portent une passent par
     `marquerJournees(…, 'presence')`, qui garde le commentaire. */
  function supprimerJournees(contratId, jours) {
    if (!contratId || !jours || !jours.length) return Promise.resolve(true);
    return client.from('journee')
      .delete()
      .eq('contrat_id', contratId)
      .in('jour', jours)
      .then(function (r) { if (r.error) throw r.error; return true; });
  }

  /* Action groupée (§5 specs) : pose une absence de Maria (congé, jour non
     travaillé) sur PLUSIEURS contrats à la fois.
     C'est l'asymétrie qui fait gagner du temps : une absence de Maria vaut
     pour tous ses contrats, contrairement à une absence d'enfant.
     `type` ∈ { 'conge_maria', 'sans_solde', 'hors_planning' }.

     `affectations` = [{ contratId, jours: ['YYYY-MM-DD', ...] }] : chaque
     contrat porte SES propres jours (déjà filtrés sur ses bornes et son
     planning côté UI). On n'applique jamais le jour d'un contrat à un autre
     (sinon on écrirait des lignes hors des bornes d'un contrat terminé).
     Un seul appel réseau (upsert en lot, toutes lignes confondues). */
  function poserAbsenceMaria(affectations, type, commentaire) {
    var payload = [];
    (affectations || []).forEach(function (a) {
      (a.jours || []).forEach(function (j) {
        payload.push({
          contrat_id: a.contratId,
          jour: j,
          type: type,
          minutes_reelles: null,
          entretien_centimes: null,
          commentaire: (commentaire == null ? null : commentaire)
        });
      });
    });
    if (payload.length === 0) return Promise.resolve([]);
    return client.from('journee')
      .upsert(payload, { onConflict: 'contrat_id,jour' })
      .select()
      .then(deballer);
  }

  /* Supprime une absence de Maria (annulation d'une action groupée), sur
     plusieurs contrats pour une liste de jours. Ne supprime QUE les lignes
     dont le type appartient à une absence de Maria (`types`) : une absence
     d'enfant ou une familiarisation saisies à la main sur les mêmes jours
     sont préservées. Symétrique du « Poser ». */
  function retirerAbsenceMaria(contratIds, jours, types) {
    if (!contratIds || !contratIds.length || !jours || !jours.length) {
      return Promise.resolve(true);
    }
    return client.from('journee')
      .delete()
      .in('contrat_id', contratIds)
      .in('jour', jours)
      .in('type', types)
      .then(function (r) { if (r.error) throw r.error; return true; });
  }

  /* ------------------------------------------------------------------ */
  /* Imputation choisie d'une période de congé (lot 9)                   */
  /*                                                                     */
  /* Une ligne = UNE période continue de congé pour UN contrat, avec son  */
  /* décompte RG-06 en jours ouvrables et sa ventilation entre congés     */
  /* payés, récupération et sans solde. Portée par la PÉRIODE et non par  */
  /* le mois : une période à cheval sur deux mois garde un décompte       */
  /* unique et insécable (le moteur en répartit la part de chaque mois).  */
  /*                                                                     */
  /* Aucun calcul ici : db.js transmet, le moteur calcule.                */
  /* ------------------------------------------------------------------ */

  var CHAMPS_IMPUTATION =
    'id, contrat_id, date_debut, date_fin, jours_ouvrables, ' +
    'jours_sur_cp, jours_sur_sup, jours_sans_solde';

  /* Imputations d'un contrat dont la période RECOUPE l'intervalle demandé,
     triées par date de début croissante. Retourne [] si aucune : l'absence
     d'imputation n'est pas une erreur, c'est le cas ordinaire (l'ordre par
     défaut du contrat s'applique alors, RG-07). */
  function listImputations(contratId, debutIso, finIso) {
    return client.from('imputation_conge')
      .select(CHAMPS_IMPUTATION)
      .eq('contrat_id', contratId)
      .lte('date_debut', finIso)
      .gte('date_fin', debutIso)
      .order('date_debut', { ascending: true })
      .then(deballer);
  }

  /* ------------------------------------------------------------------ */
  /* LA RÈGLE DES CINQ SAMEDIS (§3 des specs du 24 août 2026)            */
  /*                                                                     */
  /* Une ligne de `samedi_conge` = un samedi NON TRAVAILLÉ effectivement  */
  /* décompté sur une période. Le contrat n'y est pas dupliqué : il se    */
  /* lit par jointure sur `imputation_conge`, parce qu'une donnée         */
  /* dénormalisée est une donnée qui peut diverger.                       */
  /* ------------------------------------------------------------------ */

  var CHAMPS_SAMEDI = 'imputation_id, date_samedi';

  /* Les samedis comptés d'UN contrat sur une fenêtre de dates. C'est ce que
     la chaîne passe au moteur (§4.1). La jointure remonte le contrat depuis
     l'imputation ; PostgREST la fait en une requête. */
  function listSamedisConge(contratId, debutIso, finIso) {
    return client.from('samedi_conge')
      .select(CHAMPS_SAMEDI + ', imputation_conge!inner(contrat_id)')
      .eq('imputation_conge.contrat_id', contratId)
      .gte('date_samedi', debutIso)
      .lte('date_samedi', finIso)
      .order('date_samedi', { ascending: true })
      .then(deballer);
  }

  /* LE QUOTA, LU EN BASE ET JAMAIS SUPPOSÉ (§5.2 et §8).

     Combien de samedis ce contrat a-t-il déjà comptés sur cette année de
     référence. L'appelant donne les bornes : le moteur ne connaît pas l'année
     de référence, et la base non plus — c'est une fenêtre de dates, rien de
     plus.

     Une lecture qui ÉCHOUE remonte son erreur : l'écran doit alors refuser le
     choix plutôt que de supposer un quota plein. Un garde-fou qui échoue
     ouvert n'est pas un garde-fou (défaut B7 d'août, défaut B2 du lot 17). */
  function compterSamedisAnnee(contratId, debutIso, finIso) {
    return listSamedisConge(contratId, debutIso, finIso).then(function (l) {
      return (l || []).length;
    });
  }

  /* Écrit les samedis comptés d'UNE période, en une seule insertion.

     `owner` est posé par défaut en base (auth.uid()) et filtré par RLS : on ne
     le transmet jamais depuis le client. Une liste vide n'écrit rien — et
     n'est pas une erreur : c'est le cas normal, puisque rien n'est coché par
     défaut (décision d'Adrien du 24 août 2026).

     Aucun nettoyage n'est prévu ici : retirer la période rend ses samedis par
     la CASCADE de la clé étrangère. Une suppression écrite à la main serait
     une deuxième règle, donc une règle à oublier. */
  function enregistrerSamedis(imputationId, dates) {
    var lignes = (dates || []).filter(Boolean).map(function (d) {
      return { imputation_id: imputationId, date_samedi: String(d).slice(0, 10) };
    });
    if (!lignes.length) return Promise.resolve([]);
    return client.from('samedi_conge')
      .insert(lignes)
      .select()
      .then(deballer);
  }

  /* Raccourci sur listImputations avec les bornes d'un mois — c'est l'appel
     dominant, et cela évite que chaque écran recalcule les bornes. */
  function listImputationsPourMois(contratId, annee, mois) {
    var b = bornesMois(annee, mois);
    return listImputations(contratId, b.debut, b.fin);
  }

  /* Insère une imputation et retourne la ligne créée, avec son id.
     En cas de chevauchement avec une période déjà imputée sur le même
     contrat, la base refuse l'écriture : l'erreur REMONTE telle quelle à
     l'appelant. On ne l'avale surtout pas — un chevauchement avalé produirait
     un double décompte de congés, invisible et introuvable après coup.

     ATTENTION — correction de la 2ᵉ passe de relecture (C2). Ce commentaire
     affirmait que l'appelant « la fera traduire en français par
     js/messages.js ». C'ÉTAIT FAUX. La violation de la contrainte d'exclusion
     remonte le code Postgres 23P01 (« violates exclusion constraint »), que la
     table de traductions de js/messages.js ne reconnaît pas : Maria lirait
     « une erreur inattendue s'est produite », sans aucun moyen de comprendre
     ni de corriger — alors que la cause est parfaitement explicable, « cette
     période chevauche une période de congé déjà enregistrée ».
     La phrase manquante appartient à js/messages.js, hors du périmètre du
     lot 9 : à ajouter au lot 10, avec la traduction des quatre codes du
     moteur, AVANT qu'un écran n'écrive une seule imputation. */
  function enregistrerImputation(imputation) {
    return client.from('imputation_conge')
      .insert({
        contrat_id: imputation.contrat_id,
        date_debut: imputation.date_debut,
        date_fin: imputation.date_fin,
        jours_ouvrables: imputation.jours_ouvrables,
        jours_sur_cp: imputation.jours_sur_cp,
        jours_sur_sup: imputation.jours_sur_sup,
        jours_sans_solde: imputation.jours_sans_solde
      })
      .select(CHAMPS_IMPUTATION)
      .then(deballer)
      .then(function (r) { return r[0]; });
  }

  /* LOT 16 §16.1 b) — corriger la VENTILATION d'une période déjà posée, sans
     toucher ni à ses bornes ni à son décompte.

     C'est le geste que propose l'encart « une répartition de congé ne
     correspond plus à vos réserves ». Il ne pouvait pas passer par
     `enregistrerImputation` : celle-ci INSÈRE, et la contrainte d'exclusion de
     `imputation_conge` refuse toute période chevauchant une période déjà
     enregistrée — reposer les mêmes dates échouait donc à tous les coups.

     Les bornes et `jours_ouvrables` ne bougent pas : la période est une
     donnée, pas une déduction (§16.8). Seule sa répartition est en cause. */
  function majVentilationImputation(id, ventilation) {
    var champs = {
      jours_sur_cp: ventilation.jours_sur_cp,
      jours_sur_sup: ventilation.jours_sur_sup,
      jours_sans_solde: ventilation.jours_sans_solde
    };
    /* CORRECTION RELECTURE LOT 16 (B1) — `jours_ouvrables` PART AUSSI.

       Cette fonction n'écrivait que la ventilation. Or une ligne peut porter
       un décompte qui ne correspond pas à RG-06 — c'est exactement ce que
       `IMPUTATION_INCOMPLETE` signale, et ce que l'écran de correction sert à
       réparer. Sans réécrire `jours_ouvrables`, la correction reproduisait
       l'état refusé et Maria tournait en rond.

       Les BORNES, elles, ne bougent jamais : la période est une donnée, seul
       son décompte et sa répartition sont en cause. */
    if (ventilation.jours_ouvrables != null) {
      champs.jours_ouvrables = ventilation.jours_ouvrables;
    }
    return client.from('imputation_conge')
      .update(champs)
      .eq('id', id)
      .select(CHAMPS_IMPUTATION)
      .then(deballer)
      .then(function (r) { return r[0]; });
  }

  /* Supprime une imputation par son identifiant. Contrairement aux familles
     et aux contrats, une imputation n'est pas une donnée d'histoire : c'est
     la ventilation d'une période de congé, qui disparaît avec elle (lot 10). */
  function supprimerImputation(id) {
    return client.from('imputation_conge')
      .delete()
      .eq('id', id)
      .then(function (r) { if (r.error) throw r.error; return true; });
  }

  /* ------------------------------------------------------------------ */
  /* Périodes de familiarisation (lot 20, §20.2)                         */
  /*                                                                     */
  /* Aucun calcul ici : db.js transmet, le moteur calcule. La période est */
  /* une DONNÉE saisie par Maria — deux dates — et c'est `chaine-mois.js` */
  /* qui la porte jusqu'au moteur, comme il porte les imputations.       */
  /* ------------------------------------------------------------------ */

  /* Périodes d'un contrat dont les bornes RECOUPENT l'intervalle demandé,
     triées par date de début. Le recouvrement, et non l'inclusion : une
     période du 28 août au 10 septembre concerne les deux mois, et le mois de
     septembre doit la voir alors qu'elle commence en août. */
  function listPeriodesFamiliarisation(contratId, debutIso, finIso) {
    var q = client.from('periode_familiarisation')
      .select(CHAMPS_PERIODE_FAM)
      .eq('contrat_id', contratId);
    if (debutIso) q = q.gte('date_fin', debutIso);
    if (finIso) q = q.lte('date_debut', finIso);
    return q.order('date_debut', { ascending: true }).then(deballer);
  }

  /* Toutes les périodes d'un contrat, sans borne : c'est ce que lit la fiche
     du contrat et l'écran de la période (§20.4 d). */
  function listPeriodesFamiliarisationContrat(contratId) {
    return listPeriodesFamiliarisation(contratId, null, null);
  }

  /* Insère une période et rend la ligne créée, avec son id.

     Un chevauchement avec une période déjà enregistrée fait échouer
     l'écriture, et l'erreur REMONTE telle quelle : `js/messages.js` la traduit
     par son nom de contrainte, avant la règle générique qui, elle, parle
     d'une « période de congé » et enverrait Maria chercher le mauvais objet.
     On ne l'avale surtout pas — deux périodes qui se chevauchent paieraient
     deux fois les mêmes minutes. */
  function enregistrerPeriodeFamiliarisation(periode) {
    return client.from('periode_familiarisation')
      .insert({
        contrat_id: periode.contrat_id,
        date_debut: periode.date_debut,
        date_fin: periode.date_fin
      })
      .select(CHAMPS_PERIODE_FAM)
      .then(deballer)
      .then(function (r) { return r[0]; });
  }

  /* Corrige les bornes d'une période existante. Le refus sur un mois clôturé
     n'est pas ici : il appartient à l'écran, qui seul sait NOMMER les mois en
     cause (§20.4, même règle et même message que les avenants). db.js ne
     décide de rien, il écrit. */
  function majPeriodeFamiliarisation(id, bornes) {
    return client.from('periode_familiarisation')
      .update({ date_debut: bornes.date_debut, date_fin: bornes.date_fin })
      .eq('id', id)
      .select(CHAMPS_PERIODE_FAM)
      .then(deballer)
      .then(function (r) { return r[0]; });
  }

  /* Supprime une période. Comme une imputation, ce n'est pas une donnée
     d'histoire : c'est un cadre de calcul, qui disparaît si Maria s'est
     trompée de contrat. Les journées déclarées, elles, RESTENT — leurs
     minutes sont des faits, et « rien ne se supprime jamais » (B.0-7). */
  function supprimerPeriodeFamiliarisation(id) {
    return client.from('periode_familiarisation')
      .delete()
      .eq('id', id)
      .then(function (r) { if (r.error) throw r.error; return true; });
  }

  /* ------------------------------------------------------------------ */
  /* Récap mensuel (lot 4)                                               */
  /* ------------------------------------------------------------------ */

  /* Lit le récap d'un mois (brouillon ou figé), ou null s'il n'existe pas. */
  function getRecap(contratId, annee, mois) {
    return client.from('recap_mensuel')
      .select('id, contrat_id, annee, mois, statut, donnees, fige_le, transmis_le')
      .eq('contrat_id', contratId)
      .eq('annee', annee)
      .eq('mois', mois)
      .maybeSingle()
      .then(function (r) { if (r.error) throw r.error; return r.data; });
  }

  /* Enregistre (ou met à jour) le brouillon de récap d'un mois — instantané
     complet du calcul (ResultatMois) dans `donnees`. Ne doit PAS être appelé
     sur un mois déjà figé : le trigger d'immuabilité (lot 2) rejette tout
     passage figé -> brouillon (l'appelant vérifie l'état avant). */
  function enregistrerRecapBrouillon(contratId, annee, mois, donnees) {
    return client.from('recap_mensuel')
      .upsert({ contrat_id: contratId, annee: annee, mois: mois, statut: 'brouillon', donnees: donnees },
              { onConflict: 'contrat_id,annee,mois' })
      .select()
      .then(deballer)
      .then(function (r) { return r[0]; });
  }

  /* `figerRecap` / `figerVraiment` ONT ÉTÉ SUPPRIMÉES ICI (relecture lot 13,
     anomalie C4). C'était l'ancien chemin de clôture : un UPDATE direct vers
     `statut = 'fige'`, avec un `fige_le` fabriqué côté client et AUCUN
     événement écrit. Plus aucun écran ne l'appelait depuis le lot 13, mais
     elle restait exportée sur `DB`, sous un nom plus court et plus ancien que
     son remplaçant — une invitation à la rappeler « par habitude ».

     Or depuis le lot 13, ce qui protège Maria n'est plus l'impossibilité de
     modifier un mois clôturé, c'est la TRACE de chaque geste. Un mois clôturé
     par cet ancien chemin serait un mois dont le premier événement de
     l'historique serait « Rouvert », sans clôture avant. La fonction est donc
     retirée, pas seulement dépréciée.

     Le seul chemin de clôture est désormais `recloturerRecap`, qui passe par
     la fonction en base : l'horodatage vient de la base, et l'événement est
     écrit par le trigger `recap_mensuel_tracer_statut` (migration 006), quel
     que soit le chemin emprunté. */

  /* Lot 5 C4/C6 — tous les récaps d'un contrat, du plus récent au plus
     ancien. Sert à l'historique par famille et au chargement mutualisé de la
     chaîne des mois (un appel au lieu d'un par mois). */
  function listRecapsContrat(contratId) {
    return client.from('recap_mensuel')
      .select('id, contrat_id, annee, mois, statut, donnees, fige_le, transmis_le')
      .eq('contrat_id', contratId)
      .order('annee', { ascending: false })
      .order('mois', { ascending: false })
      .then(deballer);
  }

  /* Récaps d'un contrat entre deux années incluses (bornage grossier, le
     filtrage au mois près se fait côté appelant : la borne annuelle suffit à
     ne pas tout ramener). */
  function listRecapsPeriode(contratId, anneeMin, anneeMax) {
    return client.from('recap_mensuel')
      .select('id, contrat_id, annee, mois, statut, donnees, fige_le, transmis_le')
      .eq('contrat_id', contratId)
      .gte('annee', anneeMin)
      .lte('annee', anneeMax)
      .then(deballer);
  }

  /* ------------------------------------------------------------------ */
  /* Réouverture d'un mois clôturé (lot 13)                              */
  /*                                                                     */
  /* Depuis ce lot, un mois clôturé peut être rouvert pour être corrigé. */
  /* Ce qui protège Maria n'est donc plus l'impossibilité de modifier,    */
  /* mais la TRACE de chaque modification : un geste qui ne laisserait    */
  /* pas son événement viderait le lot de son sens.                      */
  /*                                                                     */
  /* C'est pourquoi les trois gestes passent par des fonctions de la      */
  /* base (migration 005) et non par deux requêtes enchaînées ici : deux  */
  /* requêtes lancées depuis un téléphone ne sont pas une seule           */
  /* opération, et un réseau qui tombe entre les deux laisserait un mois  */
  /* rouvert sans trace. Le corps d'une fonction plpgsql, lui, est une    */
  /* transaction : si l'événement n'est pas écrit, le geste est annulé    */
  /* avec lui.                                                           */
  /* ------------------------------------------------------------------ */

  var CHAMPS_EVENEMENT = 'id, recap_id, type, survenu_le, motif';

  /* Rouvre un mois clôturé : statut figé -> brouillon, `fige_le` remis à
     null, et un événement « reouverture » écrit dans la même transaction.
     `motif` est facultatif — on ne demande jamais de justification écrite.
     L'instantané (`donnees`) n'est PAS touché : c'est lui qui permettra
     d'afficher les écarts à la reclôture.
     Retourne null si le mois n'existe pas ou n'était pas clôturé : ce n'est
     pas une erreur, c'est « il n'y avait rien à rouvrir ». */
  function rouvrirRecap(contratId, annee, mois, motif) {
    return client.rpc('rouvrir_recap', {
      p_contrat_id: contratId,
      p_annee: annee,
      p_mois: mois,
      p_motif: (motif == null ? null : motif)
    }).then(deballerUn);
  }

  /* Clôture un mois et écrit un événement « cloture ». Sert AUSSI à la
     première clôture : sans cela, le premier événement manquerait et
     l'historique du mois commencerait par « Rouvert ».
     Retourne null si le mois était déjà clôturé (depuis un autre appareil) :
     rien n'est écrasé. L'horodatage est produit par la base — aucun objet
     Date ne traverse cette couche. */
  function recloturerRecap(contratId, annee, mois, donnees) {
    return client.rpc('recloturer_recap', {
      p_contrat_id: contratId,
      p_annee: annee,
      p_mois: mois,
      p_donnees: donnees
    }).then(deballerUn);
  }

  /* Événements d'un récapitulatif, du PLUS ANCIEN au PLUS RÉCENT.
     C'est l'écran qui inverse pour l'affichage : ne pas inverser deux fois.
     Retourne [] s'il n'y en a pas. */
  function listEvenementsRecap(recapId) {
    return client.from('evenement_recap')
      .select(CHAMPS_EVENEMENT)
      .eq('recap_id', recapId)
      .order('survenu_le', { ascending: true })
      .then(deballer);
  }

  /* Marque un récapitulatif comme transmis à la famille et écrit un
     événement « transmission ». Idempotente : un second appel ne modifie ni
     la date ni l'historique. Fournie ici, branchée à l'écran au lot 7 — d'ici
     là, `transmis_le` reste nul et aucun avertissement de transmission ne se
     déclenche, ce qui est voulu. */
  function marquerTransmis(contratId, annee, mois) {
    return client.rpc('marquer_transmis', {
      p_contrat_id: contratId,
      p_annee: annee,
      p_mois: mois
    }).then(deballerUn);
  }

  /* Le mois est-il clôturé ? Utilitaire destiné au lot 10, qui doit le savoir
     avant de poser un congé sur une période. */
  function estMoisCloture(contratId, annee, mois) {
    return client.from('recap_mensuel')
      .select('statut')
      .eq('contrat_id', contratId)
      .eq('annee', annee)
      .eq('mois', mois)
      .maybeSingle()
      .then(function (r) {
        if (r.error) throw r.error;
        return !!(r.data && r.data.statut === 'fige');
      });
  }

  /* ------------------------------------------------------------------ */
  /* Utilitaires internes                                                */
  /* ------------------------------------------------------------------ */

  /* Retour d'une fonction de la base : un objet, ou null quand la fonction
     n'avait rien à faire. L'erreur n'est jamais avalée. */
  function deballerUn(r) {
    if (r.error) throw r.error;
    return r.data || null;
  }

  function deballer(r) {
    if (r.error) throw r.error;
    return r.data || [];
  }

  /* Ne transmet que les champs autorisés et effectivement fournis : évite
     d'écraser une colonne par `undefined` et interdit qu'un écran pousse un
     champ qu'il n'a pas le droit d'écrire (owner, created_at…). */
  function nettoyer(champs, autorises) {
    var out = {};
    (autorises || []).forEach(function (k) {
      if (champs && Object.prototype.hasOwnProperty.call(champs, k) && champs[k] !== undefined) {
        out[k] = champs[k];
      }
    });
    return out;
  }

  /* Bornes d'un mois, en arithmétique pure : plus aucun objet Date dans la
     couche données. Les dates de la base sont des dates pures 'YYYY-MM-DD' ;
     les construire via Date, même en UTC, ne servait à rien et détonnait. */
  function bornesMois(annee, mois) {
    var mm = String(mois).padStart(2, '0');
    var bissextile = (annee % 4 === 0 && annee % 100 !== 0) || annee % 400 === 0;
    var longueurs = [31, bissextile ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return {
      debut: annee + '-' + mm + '-01',
      fin: annee + '-' + mm + '-' + String(longueurs[mois - 1]).padStart(2, '0')
    };
  }

  /* ------------------------------------------------------------------ */

  global.DB = {
    client: client,
    getSession: getSession,
    onAuthChange: onAuthChange,
    signIn: signIn,
    signOut: signOut,
    demanderReinitialisation: demanderReinitialisation,
    listFamilles: listFamilles,
    listFamillesToutes: listFamillesToutes,
    listContratsActifs: listContratsActifs,
    listContratsTous: listContratsTous,
    listContratsPourMois: listContratsPourMois,
    listContratsPourPeriode: listContratsPourPeriode,
    creerFamille: creerFamille,
    majFamille: majFamille,
    creerContrat: creerContrat,
    majContrat: majContrat,
    archiverContrat: archiverContrat,
    desarchiverContrat: desarchiverContrat,
    /* LOT 17 — les avenants remplacent les barèmes (§17.2). Aucun alias
       n'est laissé : `getSalaires` sur une table qui porte onze réglages
       ferait croire qu'il n'y en a que deux. */
    getAvenants: getAvenants,
    ajouterAvenant: ajouterAvenant,
    majAvenant: majAvenant,
    supprimerAvenant: supprimerAvenant,
    getCompteurInitial: getCompteurInitial,
    getJourneesMois: getJourneesMois,
    getJourneesPeriode: getJourneesPeriode,
    enregistrerJournee: enregistrerJournee,
    supprimerJournee: supprimerJournee,
    marquerJournees: marquerJournees,
    supprimerJournees: supprimerJournees,
    poserAbsenceMaria: poserAbsenceMaria,
    retirerAbsenceMaria: retirerAbsenceMaria,
    listImputations: listImputations,
    /* Règle des cinq samedis (§3 des specs du 24 août 2026). */
    listSamedisConge: listSamedisConge,
    compterSamedisAnnee: compterSamedisAnnee,
    enregistrerSamedis: enregistrerSamedis,
    listImputationsPourMois: listImputationsPourMois,
    enregistrerImputation: enregistrerImputation,
    majVentilationImputation: majVentilationImputation,
    supprimerImputation: supprimerImputation,
    /* Lot 20 — les périodes de familiarisation (§20.2). */
    listPeriodesFamiliarisation: listPeriodesFamiliarisation,
    listPeriodesFamiliarisationContrat: listPeriodesFamiliarisationContrat,
    enregistrerPeriodeFamiliarisation: enregistrerPeriodeFamiliarisation,
    majPeriodeFamiliarisation: majPeriodeFamiliarisation,
    supprimerPeriodeFamiliarisation: supprimerPeriodeFamiliarisation,
    getRecap: getRecap,
    listRecapsContrat: listRecapsContrat,
    listRecapsPeriode: listRecapsPeriode,
    /* LOT 16 §16.2 — l'identité qui signe les documents. */
    getEmettrice: getEmettrice,
    enregistrerEmettrice: enregistrerEmettrice,
    getPreferenceRappel: getPreferenceRappel,
    enregistrerPreferenceRappel: enregistrerPreferenceRappel,
    enregistrerAbonnementPush: enregistrerAbonnementPush,
    supprimerAbonnementPush: supprimerAbonnementPush,
    enregistrerCompteurInitial: enregistrerCompteurInitial,
    supprimerContrat: supprimerContrat,
    contratEstVierge: contratEstVierge,
    exporterHistorique: exporterHistorique,
    getNoteMensuelle: getNoteMensuelle,
    enregistrerNoteMensuelle: enregistrerNoteMensuelle,
    listModeles: listModeles,
    modeleEnVigueur: modeleEnVigueur,
    creerModele: creerModele,
    rattacherContratAModele: rattacherContratAModele,
    majContratsEnLot: majContratsEnLot,
    ecartsContratModele: ecartsContratModele,
    CHAMPS_COMPARES_MODELE: CHAMPS_COMPARES_MODELE,
    majContratIdentite: majContratIdentite,
    rattacherContratAFamille: rattacherContratAFamille,
    renommerFamille: renommerFamille,
    archiverFamille: archiverFamille,
    desarchiverFamille: desarchiverFamille,
    listFamillesAvecContrats: listFamillesAvecContrats,
    enregistrerRecapBrouillon: enregistrerRecapBrouillon,
    rouvrirRecap: rouvrirRecap,
    recloturerRecap: recloturerRecap,
    listEvenementsRecap: listEvenementsRecap,
    marquerTransmis: marquerTransmis,
    estMoisCloture: estMoisCloture
  };
})(window);
