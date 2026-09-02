/* Faux client Supabase — décor FICTIF, pour mesurer la mise en page à 390 px
   dans un vrai navigateur. Aucune donnée réelle : deux prénoms de plantes. */
(function () {
  var AUJ = '2026-08-21';
  var FAMILLE = { id: 'f1', nom: 'Aubépine', canal: null, archive: false };
  var CONTRATS = [
    { id: 'c1', prenom_enfant: 'Alouette', nom: null, famille_id: 'f1', couleur: 'prune',
      date_debut: '2025-09-01', date_fin: null, statut: 'actif', archive: false,
      minutes_contractuelles: 540, minutes_sup_jour: 30, minutes_par_jour_conge: 540,
      entretien_centimes_jour: 550, jours_planning: [1,2,3,4,5],
      heure_arrivee: '08:30:00', heure_depart: '17:30:00',
      sup_dues_si_enfant_absent: true, ordre_imputation: 'cp_puis_sup',
      genre: 'f', photo: null },
    { id: 'c2', prenom_enfant: 'Aigrette', nom: null, famille_id: 'f1', couleur: 'terracotta',
      date_debut: '2025-09-01', date_fin: null, statut: 'actif', archive: false,
      minutes_contractuelles: 540, minutes_sup_jour: 30, minutes_par_jour_conge: 540,
      entretien_centimes_jour: 550, jours_planning: [1,2,3,4,5],
      heure_arrivee: '08:30:00', heure_depart: '17:30:00',
      sup_dues_si_enfant_absent: true, ordre_imputation: 'cp_puis_sup',
      genre: 'f', photo: null }
  ];
  var AVENANTS = CONTRATS.map(function (c) {
    return { id: 'a-' + c.id, contrat_id: c.id, numero: 1, date_effet: '2025-09-01',
      brut_mensuel_centimes: 140400, net_mensuel_centimes: 107100,
      minutes_contractuelles: 540, minutes_sup_jour: 30, minutes_par_jour_conge: 540,
      entretien_centimes_jour: 550, jours_planning: [1,2,3,4,5],
      heure_arrivee: '08:30:00', heure_depart: '17:30:00',
      sup_dues_si_enfant_absent: true, ordre_imputation: 'cp_puis_sup' };
  });
  var JOURNEES = [
    { id: 'j1', contrat_id: 'c1', jour: '2026-08-05', type: 'presence',
      ecart_minutes: -60, ecart_evenement: 'liberation_anticipee',
      ecart_heure_reelle: '16:30:00', ecart_impute_sur: 'recuperation' },
    { id: 'j2', contrat_id: 'c1', jour: '2026-08-12', type: 'absence_enfant' },
    { id: 'j3', contrat_id: 'c1', jour: '2026-08-17', type: 'conge_maria' },
    { id: 'j4', contrat_id: 'c1', jour: '2026-08-18', type: 'conge_maria' },
    { id: 'j5', contrat_id: 'c1', jour: '2026-08-19', type: 'conge_maria' },
    { id: 'j6', contrat_id: 'c2', jour: '2026-08-17', type: 'conge_maria' },
    { id: 'j7', contrat_id: 'c2', jour: '2026-08-18', type: 'conge_maria' },
    { id: 'j8', contrat_id: 'c2', jour: '2026-08-19', type: 'conge_maria' }
  ];
  var IMPUTATIONS = [
    { id: 'i1', contrat_id: 'c1', date_debut: '2026-08-17', date_fin: '2026-08-19',
      jours_decomptes: 3, jours_sur_cp: 3, jours_sur_sup: 0, jours_sans_solde: 0,
      minutes_sur_cp: 1620, minutes_sur_sup: 0 },
    { id: 'i2', contrat_id: 'c2', date_debut: '2026-08-17', date_fin: '2026-08-19',
      jours_decomptes: 3, jours_sur_cp: 3, jours_sur_sup: 0, jours_sans_solde: 0,
      minutes_sur_cp: 1620, minutes_sur_sup: 0 }
  ];
  var RECAPS = [
    { id: 'r1', contrat_id: 'c1', annee: 2026, mois: 7, statut: 'fige',
      fige_le: '2026-08-02T10:00:00Z', transmis_le: null, audit_note: null,
      donnees: { joursPresence: 21, entretienCentimes: 11550, salaireNetCentimes: 107100,
        totalAVerserCentimes: 118650, compteurSortie: { minutesSup: 1200, minutesCp: 5400 } } },
    { id: 'r2', contrat_id: 'c2', annee: 2026, mois: 7, statut: 'fige',
      fige_le: '2026-08-02T10:00:00Z', transmis_le: null, audit_note: null,
      donnees: { joursPresence: 21, entretienCentimes: 11550, salaireNetCentimes: 107100,
        totalAVerserCentimes: 118650, compteurSortie: { minutesSup: 1200, minutesCp: 5400 } } }
  ];
  var SAMEDIS = [];

  function table(nom) {
    if (nom === 'famille') return [FAMILLE];
    if (nom === 'contrat') return CONTRATS;
    if (nom === 'avenant_contrat') return AVENANTS;
    if (nom === 'journee') return JOURNEES;
    if (nom === 'imputation_conge') return IMPUTATIONS;
    if (nom === 'recap_mensuel') return RECAPS;
    if (nom === 'samedi_compte') return SAMEDIS;
    return [];
  }

  function requete(nom) {
    var lignes = table(nom).slice();
    var q = {
      select: function () { return q; },
      eq: function (col, v) { lignes = lignes.filter(function (l) { return l[col] === v; }); return q; },
      neq: function (col, v) { lignes = lignes.filter(function (l) { return l[col] !== v; }); return q; },
      in: function (col, vs) { lignes = lignes.filter(function (l) { return vs.indexOf(l[col]) !== -1; }); return q; },
      gte: function (col, v) { lignes = lignes.filter(function (l) { return String(l[col]) >= v; }); return q; },
      lte: function (col, v) { lignes = lignes.filter(function (l) { return String(l[col]) <= v; }); return q; },
      gt: function (col, v) { lignes = lignes.filter(function (l) { return String(l[col]) > v; }); return q; },
      lt: function (col, v) { lignes = lignes.filter(function (l) { return String(l[col]) < v; }); return q; },
      is: function () { return q; },
      or: function () { return q; },
      order: function () { return q; },
      limit: function () { return q; },
      maybeSingle: function () { return Promise.resolve({ data: lignes[0] || null, error: null }); },
      single: function () { return Promise.resolve({ data: lignes[0] || null, error: null }); },
      insert: function () { return q; },
      update: function () { return q; },
      upsert: function () { return q; },
      delete: function () { return q; },
      then: function (f, g) { return Promise.resolve({ data: lignes, error: null }).then(f, g); }
    };
    return q;
  }

  window.supabase = {
    createClient: function () {
      return {
        auth: {
          getSession: function () {
            return Promise.resolve({ data: { session: { user: { id: 'u1', email: 'a@b.test' } } }, error: null });
          },
          onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
          signInWithPassword: function () { return Promise.resolve({ data: {}, error: null }); },
          signOut: function () { return Promise.resolve({ error: null }); },
          resetPasswordForEmail: function () { return Promise.resolve({ error: null }); }
        },
        from: requete,
        rpc: function () { return Promise.resolve({ data: null, error: null }); }
      };
    }
  };
  /* L'horloge, figée : sans elle, la mesure changerait de jour en jour. */
  var VraiDate = Date;
  function FausseDate(a) {
    if (arguments.length === 0) return new VraiDate(AUJ + 'T09:00:00Z');
    return new (Function.prototype.bind.apply(VraiDate, [null].concat([].slice.call(arguments))))();
  }
  FausseDate.prototype = VraiDate.prototype;
  FausseDate.now = function () { return new VraiDate(AUJ + 'T09:00:00Z').getTime(); };
  FausseDate.UTC = VraiDate.UTC;
  FausseDate.parse = VraiDate.parse;
  window.Date = FausseDate;
}());
