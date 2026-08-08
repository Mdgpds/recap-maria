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

  function listFamilles() {
    return client.from('famille')
      .select('id, nom, canal, archive')
      .order('nom', { ascending: true })
      .then(deballer);
  }

  /* Contrats non archivés, avec leur famille. Triés par prénom d'enfant. */
  function listContratsActifs() {
    return client.from('contrat')
      .select('id, prenom_enfant, famille_id, date_debut, date_fin, jours_planning, ' +
              'heure_arrivee, heure_depart, minutes_contractuelles, minutes_sup_jour, ' +
              'minutes_par_jour_conge, entretien_centimes_jour, statut, ' +
              'sup_dues_si_enfant_absent, ordre_imputation, archive, ' +
              'famille:famille_id ( id, nom, canal )')
      .eq('archive', false)
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
  /* Journées (saisie par exception)                                     */
  /* ------------------------------------------------------------------ */

  /* Toutes les journées saisies d'un contrat pour un mois donné.
     Renvoie un objet indexé par date : { 'YYYY-MM-DD': ligneJournee }. */
  function getJourneesMois(contratId, annee, mois) {
    var bornes = bornesMois(annee, mois);
    return client.from('journee')
      .select('id, contrat_id, jour, type, minutes_reelles, entretien_centimes, commentaire')
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

  /* Enregistre une exception pour un contrat et un jour (upsert sur la
     contrainte unique (contrat_id, jour)). owner est posé par défaut en base
     (auth.uid()) et filtré par RLS : on ne le transmet jamais côté client. */
  function enregistrerJournee(ligne) {
    var payload = {
      contrat_id: ligne.contrat_id,
      jour: ligne.jour,
      type: ligne.type,
      minutes_reelles: (ligne.minutes_reelles == null ? null : ligne.minutes_reelles),
      entretien_centimes: (ligne.entretien_centimes == null ? null : ligne.entretien_centimes),
      commentaire: (ligne.commentaire == null ? null : ligne.commentaire)
    };
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
     posé ici (horloge de persistance, pas de calcul métier). Sur un mois déjà
     figé, l'UPDATE ne matche rien (filtre statut='brouillon') et renvoie null. */
  function figerRecap(contratId, annee, mois, donnees, figeLeIso) {
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

  /* ------------------------------------------------------------------ */
  /* Utilitaires internes                                                */
  /* ------------------------------------------------------------------ */

  function deballer(r) {
    if (r.error) throw r.error;
    return r.data || [];
  }

  function bornesMois(annee, mois) {
    var mm = String(mois).padStart(2, '0');
    var dernier = new Date(Date.UTC(annee, mois, 0)).getUTCDate(); // 0 = dernier jour du mois précédent+1
    return {
      debut: annee + '-' + mm + '-01',
      fin: annee + '-' + mm + '-' + String(dernier).padStart(2, '0')
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
    listContratsActifs: listContratsActifs,
    getSalaires: getSalaires,
    getCompteurInitial: getCompteurInitial,
    getJourneesMois: getJourneesMois,
    enregistrerJournee: enregistrerJournee,
    supprimerJournee: supprimerJournee,
    poserAbsenceMaria: poserAbsenceMaria,
    retirerAbsenceMaria: retirerAbsenceMaria,
    getRecap: getRecap,
    enregistrerRecapBrouillon: enregistrerRecapBrouillon,
    figerRecap: figerRecap
  };
})(window);
