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
    'famille:famille_id ( id, nom, canal, archive )';

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

  function getSalaires(contratId) {
    return client.from('salaire_contrat')
      .select('id, contrat_id, date_effet, brut_mensuel_centimes, net_mensuel_centimes')
      .eq('contrat_id', contratId)
      .order('date_effet', { ascending: true })
      .then(deballer);
  }

  function getCompteurInitial(contratId) {
    return client.from('compteur_initial')
      .select('contrat_id, date_reference, minutes_sup, dixiemes_cp_acquis, dixiemes_cp_pris')
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
    'sup_dues_si_enfant_absent', 'ordre_imputation', 'archive'
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
  /* Barèmes de rémunération (lot 5 C5)                                  */
  /*                                                                     */
  /* La mécanique RG-15 (salaireApplicable) est déjà en place et validée  */
  /* dans le moteur : il ne manquait que la saisie. Aucun calcul ici.    */
  /* ------------------------------------------------------------------ */

  function ajouterSalaire(contratId, champs) {
    return client.from('salaire_contrat')
      .insert({
        contrat_id: contratId,
        date_effet: champs.date_effet,
        brut_mensuel_centimes: champs.brut_mensuel_centimes,
        net_mensuel_centimes: champs.net_mensuel_centimes
      })
      .select('id, contrat_id, date_effet, brut_mensuel_centimes, net_mensuel_centimes')
      .then(deballer)
      .then(function (r) { return r[0]; });
  }

  function majSalaire(id, champs) {
    return client.from('salaire_contrat')
      .update(nettoyer(champs, ['date_effet', 'brut_mensuel_centimes', 'net_mensuel_centimes']))
      .eq('id', id)
      .select('id, contrat_id, date_effet, brut_mensuel_centimes, net_mensuel_centimes')
      .then(deballer)
      .then(function (r) { return r[0]; });
  }

  /* Suppression d'un barème. L'appelant DOIT avoir vérifié qu'aucun récap
     figé ne s'appuie dessus (garde-fou C5, porté par l'écran : la base ne
     connaît pas le lien entre un barème et un récap figé). */
  function supprimerSalaire(id) {
    return client.from('salaire_contrat')
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
      .select('id, contrat_id, jour, type, minutes_reelles, entretien_centimes, commentaire, ' +
              'minutes_sup_exceptionnelles, minutes_sup_renoncees, sup_dues_override')
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
      .select('id, contrat_id, jour, type, minutes_reelles, entretien_centimes, commentaire, ' +
              'minutes_sup_exceptionnelles, minutes_sup_renoncees, sup_dues_override')
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
    ['minutes_sup_exceptionnelles', 'minutes_sup_renoncees', 'sup_dues_override']
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

  /* Raccourci sur listImputations avec les bornes d'un mois — c'est l'appel
     dominant, et cela évite que chaque écran recalcule les bornes. */
  function listImputationsPourMois(contratId, annee, mois) {
    var b = bornesMois(annee, mois);
    return listImputations(contratId, b.debut, b.fin);
  }

  /* Insère une imputation et retourne la ligne créée, avec son id.
     En cas de chevauchement avec une période déjà imputée sur le même
     contrat, la base refuse l'écriture : l'erreur REMONTE telle quelle à
     l'appelant, qui la fera traduire en français par js/messages.js. On ne
     l'avale surtout pas — un chevauchement avalé produirait un double
     décompte de congés, invisible et introuvable après coup. */
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
  /* Récap mensuel (lot 4)                                               */
  /* ------------------------------------------------------------------ */

  /* Lit le récap d'un mois (brouillon ou figé), ou null s'il n'existe pas. */
  function getRecap(contratId, annee, mois) {
    return client.from('recap_mensuel')
      .select('id, contrat_id, annee, mois, statut, donnees, fige_le')
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

  /* Fige un mois : enregistre d'abord l'instantané en brouillon, puis passe
     brouillon -> figé (SEUL chemin autorisé par le trigger). `figeLeIso` est
     posé ici (horloge de persistance, pas de calcul métier).

     Correction A7 (relecture lot 6) : sur un mois DÉJÀ figé, c'est l'upsert du
     brouillon qui partait en premier, et le trigger d'immuabilité le rejetait.
     L'appelant recevait donc une erreur — « ce mois est clôturé, rien n'a été
     verrouillé » — alors que le mois était bel et bien clôturé, depuis un autre
     appareil. On lit d'abord l'état : déjà figé, on ne touche à rien et on
     renvoie null, ce que l'appelant sait dire correctement. */
  function figerRecap(contratId, annee, mois, donnees, figeLeIso) {
    return getRecap(contratId, annee, mois).then(function (existant) {
      if (existant && existant.statut === 'fige') return null;
      return figerVraiment(contratId, annee, mois, donnees, figeLeIso);
    });
  }

  function figerVraiment(contratId, annee, mois, donnees, figeLeIso) {
    return enregistrerRecapBrouillon(contratId, annee, mois, donnees)
      .then(function () {
        return client.from('recap_mensuel')
          .update({ statut: 'fige', fige_le: figeLeIso })
          .eq('contrat_id', contratId)
          .eq('annee', annee)
          .eq('mois', mois)
          .eq('statut', 'brouillon')
          .select()
          .then(deballer)
          .then(function (r) { return r[0] || null; });
      });
  }

  /* Lot 5 C4/C6 — tous les récaps d'un contrat, du plus récent au plus
     ancien. Sert à l'historique par famille et au chargement mutualisé de la
     chaîne des mois (un appel au lieu d'un par mois). */
  function listRecapsContrat(contratId) {
    return client.from('recap_mensuel')
      .select('id, contrat_id, annee, mois, statut, donnees, fige_le')
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
      .select('id, contrat_id, annee, mois, statut, donnees, fige_le')
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
    getSalaires: getSalaires,
    ajouterSalaire: ajouterSalaire,
    majSalaire: majSalaire,
    supprimerSalaire: supprimerSalaire,
    getCompteurInitial: getCompteurInitial,
    getJourneesMois: getJourneesMois,
    getJourneesPeriode: getJourneesPeriode,
    enregistrerJournee: enregistrerJournee,
    supprimerJournee: supprimerJournee,
    poserAbsenceMaria: poserAbsenceMaria,
    retirerAbsenceMaria: retirerAbsenceMaria,
    listImputations: listImputations,
    listImputationsPourMois: listImputationsPourMois,
    enregistrerImputation: enregistrerImputation,
    supprimerImputation: supprimerImputation,
    getRecap: getRecap,
    listRecapsContrat: listRecapsContrat,
    listRecapsPeriode: listRecapsPeriode,
    enregistrerRecapBrouillon: enregistrerRecapBrouillon,
    figerRecap: figerRecap,
    rouvrirRecap: rouvrirRecap,
    recloturerRecap: recloturerRecap,
    listEvenementsRecap: listEvenementsRecap,
    marquerTransmis: marquerTransmis,
    estMoisCloture: estMoisCloture
  };
})(window);
