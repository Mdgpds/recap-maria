/* ============================================================================
   ui-enfant.js — Espace enfant : calendrier et saisie d'une journée
   (§2.2 et §2.3 des specs).

   C'est l'écran central de la refonte. Un enfant, un calendrier, quatre
   panneaux :
     1. le calendrier du mois de CET enfant (un seul enfant par calendrier) ;
     2. le mois : présence, salaire, entretien, heures sup, total à verser ;
     3. les compteurs de CE contrat (jamais de compteur global) ;
     4. depuis le début du contrat, avec le lien vers l'historique.

   Deux points de vigilance, tenus ici et nulle part ailleurs :

   - AUCUN CALCUL DANS L'INTERFACE (§4). Les effets annoncés dans la feuille de
     saisie — « Pas d'entretien ce jour (−5,00 €) », « Congé posé pour les 4
     enfants, −1 jour » — ne sont pas des textes recopiés de la maquette : ils
     sont obtenus en REJOUANT le mois avec Engine.calculerMois() tel qu'il
     serait après le geste, et en comparant au mois actuel. Si un paramètre du
     contrat change (indemnité, minutes supplémentaires, ordre d'imputation),
     la phrase change toute seule. Rien à maintenir en double.

   - « JE NE TRAVAILLAIS PAS » ÉCRIT SUR TOUS LES CONTRATS (§2.3), en une seule
     écriture, chaque contrat ne recevant que SES propres jours (planning,
     bornes, fériés exclus). Une absence de Maria vaut pour tous ses enfants ;
     une absence d'enfant ne vaut que pour le sien.
   ========================================================================= */
(function (global) {
  'use strict';

  var Kit = global.Kit;
  var Chaine = global.ChaineMois;
  var Engine = global.Engine;
  var Feries = global.Feries;

  /* Types posés par une absence de Maria. Le retrait ne cible que ceux-là :
     une absence d'enfant saisie le même jour ne doit pas disparaître. */
  var TYPES_ABSENCE_MARIA = ['conge_maria', 'sans_solde', 'hors_planning'];

  /* Échelles des barres de progression des compteurs (§2.2 : « en barres de
     progression avec équivalence en jours »). Une barre a besoin d'un maximum,
     et le cahier des charges n'en définit aucun pour la récupération : on
     affiche donc l'équivalent de 10 jours de congé, soit la réserve que Maria
     accumule en une année environ. Pour les congés payés, le maximum est celui
     de RG-11 : 30 jours ouvrables acquis par exercice.
     Ces deux valeurs ne servent QU'À la longueur de la barre : aucun chiffre
     affiché n'en dépend. */
  var BARRE_RECUP_EN_JOURS = 10;
  var BARRE_CP_DIXIEMES = 300;

  /* Sous ce seuil, la barre des congés payés passe en orange (§2.2). */
  var SEUIL_CP_ORANGE_DIXIEMES = 80;

  var vue = null;   // état de l'écran affiché (contrat, mois, chaîne, journées)

  /* ------------------------------------------------------------------ */
  /* Affichage                                                           */
  /* ------------------------------------------------------------------ */

  function afficher(ctx) {
    var contrat = global.App.contratParId(ctx.params.contratId);
    if (!contrat) {
      return global.App.tousLesContrats().then(function () {
        var c = global.App.contratParId(ctx.params.contratId);
        if (!c) throw new Error('contrat introuvable');
        return afficherContrat(ctx, c);
      });
    }
    return afficherContrat(ctx, contrat);
  }

  function afficherContrat(ctx, contrat) {
    var m = { annee: ctx.params.annee, mois: ctx.params.mois };
    if (!m.annee || !m.mois) m = global.App.moisCourant();

    barre(ctx.barre, contrat, m);
    ctx.corps.appendChild(Kit.ce('div', 'attente', 'Calcul du mois…'));

    return Promise.all([
      global.App.serie(contrat, m),
      global.App.journees(contrat.id, m.annee, m.mois)
    ]).then(function (r) {
      var chaine = r[0];
      var journees = r[1];
      vue = {
        contrat: contrat,
        annee: m.annee,
        mois: m.mois,
        chaine: chaine,
        journees: journees,
        entree: global.App.moisDe(chaine, m.annee, m.mois),
        lectureSeule: !!contrat.archive
      };
      Kit.vider(ctx.corps);
      rendre(ctx.corps);
    });
  }

  function barre(barreEl, contrat, m) {
    barreEl.className = 'bar';
    var bk = Kit.bouton('bk', function () { global.App.retour(); });
    bk.textContent = '‹';
    bk.setAttribute('aria-label', 'Retour');
    barreEl.appendChild(bk);
    barreEl.appendChild(Kit.ce('span', 'ti',
      contrat.prenom_enfant + ' — ' + Kit.libelleMoisAnnee(m.annee, m.mois)));

    var nav = Kit.ce('div', 'nav');
    var prec = Kit.bouton(null, function () { changerMois(-1); });
    prec.textContent = '‹';
    prec.setAttribute('aria-label', 'Mois précédent');
    var suiv = Kit.bouton(null, function () { changerMois(1); });
    suiv.textContent = '›';
    suiv.setAttribute('aria-label', 'Mois suivant');

    /* Bornes de navigation : jamais avant le début du contrat, jamais après le
       mois courant (un mois à venir n'a rien à montrer) ni après la fin du
       contrat. Un bouton qui ne mène nulle part est désactivé, pas silencieux. */
    var debut = Chaine.moisDeDate(contrat.date_debut);
    var maintenant = global.App.moisCourant();
    var fin = contrat.date_fin ? Chaine.moisDeDate(contrat.date_fin) : maintenant;
    if (Chaine.cmpMois(fin.annee, fin.mois, maintenant.annee, maintenant.mois) > 0) fin = maintenant;
    var p = Chaine.moisPrecedent(m.annee, m.mois);
    var s = Chaine.moisSuivant(m.annee, m.mois);
    prec.disabled = Chaine.cmpMois(p.annee, p.mois, debut.annee, debut.mois) < 0;
    suiv.disabled = Chaine.cmpMois(s.annee, s.mois, fin.annee, fin.mois) > 0;

    nav.appendChild(prec);
    nav.appendChild(suiv);
    barreEl.appendChild(nav);
  }

  function changerMois(delta) {
    if (!vue) return;
    var m = delta < 0
      ? Chaine.moisPrecedent(vue.annee, vue.mois)
      : Chaine.moisSuivant(vue.annee, vue.mois);
    global.App.remplacer('enfant', { contratId: vue.contrat.id, annee: m.annee, mois: m.mois });
  }

  /* ------------------------------------------------------------------ */
  /* Les quatre panneaux                                                 */
  /* ------------------------------------------------------------------ */

  function rendre(corps) {
    var c = vue.contrat;

    if (vue.lectureSeule) {
      corps.appendChild(Kit.note('Ancien contrat — lecture seule',
        'Ce contrat est terminé et rangé. Tout son historique reste consultable, ' +
        'mais aucune journée ne peut plus être modifiée.'));
    }

    corps.appendChild(panneauCalendrier());

    if (!vue.entree) {
      corps.appendChild(Kit.ce('p', 'vide',
        'Le contrat de ' + c.prenom_enfant + ' ne couvre pas ' +
        Kit.libelleMoisAnnee(vue.annee, vue.mois) + '.'));
      corps.appendChild(boutonFiche());
      return;
    }

    corps.appendChild(panneauMois());
    corps.appendChild(panneauCompteurs());
    corps.appendChild(panneauDepuisDebut());
    corps.appendChild(boutonFiche());
  }

  function boutonFiche() {
    var b = Kit.bouton('btn nt', function () {
      global.App.aller('fiche', { contratId: vue.contrat.id });
    });
    b.textContent = 'Contrat, horaires et rémunération';
    return b;
  }

  /* --- 1. Calendrier ------------------------------------------------- */

  function panneauCalendrier() {
    var c = vue.contrat;
    var p = Kit.pane('Le calendrier de ' + c.prenom_enfant);
    var table = Kit.ce('table', 'cal');

    var thead = Kit.ce('tr');
    ['L', 'M', 'M', 'J', 'V', 'S', 'D'].forEach(function (j, i) {
      var th = Kit.ce('th', null, j);
      th.setAttribute('aria-label', Kit.JOURS_SEMAINE[i + 1]);
      thead.appendChild(th);
    });
    table.appendChild(thead);

    var jours = Engine.joursDuMois(vue.annee, vue.mois);
    var planning = c.jours_planning || [1, 2, 3, 4, 5];
    var tr = Kit.ce('tr');
    var col = Engine.jourSemaine(jours[0]);
    for (var v = 1; v < col; v++) tr.appendChild(cellVide());

    jours.forEach(function (d, index) {
      tr.appendChild(cellule(d, planning));
      col++;
      if (col > 7 && index < jours.length - 1) {
        table.appendChild(tr);
        tr = Kit.ce('tr');
        col = 1;
      }
    });
    while (col <= 7) { tr.appendChild(cellVide()); col++; }
    table.appendChild(tr);

    p.appendChild(table);

    var lg = Kit.ce('div', 'lg');
    legende(lg, 'g1', 'Présent' + suffixeAccord());
    legende(lg, 'g2', 'Absent' + suffixeAccord());
    legende(lg, 'g5', 'Mon congé');
    legende(lg, 'g3', 'Férié');
    p.appendChild(lg);
    return p;
  }

  function suffixeAccord() { return '·e'; }

  function legende(parent, classe, texte) {
    var s = Kit.ce('span');
    s.appendChild(Kit.ce('i', classe));
    s.appendChild(document.createTextNode(texte));
    parent.appendChild(s);
  }

  function cellVide() {
    var td = Kit.ce('td', 'we no');
    return td;
  }

  function cellule(d, planning) {
    var c = vue.contrat;
    var jour = Number(d.slice(8, 10));
    var horsPlanning = planning.indexOf(Engine.jourSemaine(d)) === -1;
    var horsBornes = (c.date_debut && d < c.date_debut) || (c.date_fin && d > c.date_fin);
    var type = Kit.typeDuJour(vue.journees, d);

    var classe, mini = null, touchable = false;
    if (horsBornes) { classe = 'we no'; }
    else if (type === 'ferie') { classe = 'fe no'; mini = 'férié'; }
    else if (horsPlanning) { classe = 'we no'; }
    else if (type === 'conge_maria') { classe = 'cg'; mini = 'congé'; touchable = true; }
    else if (type === 'sans_solde') { classe = 'cg'; mini = 'ss solde'; touchable = true; }
    else if (type === 'hors_planning') { classe = 'we'; mini = 'non trav.'; touchable = true; }
    else if (type === 'familiarisation') { classe = 'ok'; mini = 'familia.'; touchable = true; }
    else if (type === 'absence_enfant') { classe = 'ab'; mini = 'abs.'; touchable = true; }
    else { classe = 'ok'; touchable = true; }

    var td = Kit.ce('td', classe + (touchable && vue.lectureSeule ? ' no' : ''));
    var contenu = Kit.ce('div', 'num', String(jour));
    td.appendChild(contenu);
    if (mini) td.appendChild(Kit.ce('div', 'mini', mini));

    if (touchable && !vue.lectureSeule) {
      td.setAttribute('role', 'button');
      td.setAttribute('tabindex', '0');
      td.setAttribute('aria-label', Kit.jourLong(d));
      td.addEventListener('click', function () { ouvrirJour(d); });
      td.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ouvrirJour(d); }
      });
    }
    return td;
  }

  /* --- 2. Le mois ---------------------------------------------------- */

  function panneauMois() {
    var c = vue.contrat;
    var e = vue.entree;
    var r = e.resultat;
    var p = Kit.pane('Le mois de ' + c.prenom_enfant);

    if (e.salaireManquant) {
      p.appendChild(Kit.warnbox('Aucune rémunération connue pour ce mois',
        'Renseignez un barème dans la fiche contrat : les jours sont exacts, mais les montants ' +
        'resteront à zéro tant qu’aucun barème n’est enregistré.'));
    }
    if (e.avantInitialisation) {
      p.appendChild(Kit.warnbox('Mois antérieur à la reprise de vos compteurs',
        'Les jours et les montants sont exacts, mais les soldes d’heures et de congés payés ' +
        'y repartent de zéro : ils ne veulent rien dire. Ce mois se consulte, il ne se clôture pas.'));
    }

    var l = Kit.lines(p);
    var travailles = Kit.joursTravailles(c, vue.annee, vue.mois, vue.journees).length;
    Kit.ligne(l, 'Jours de présence', r.joursPresence + ' j sur ' + travailles);
    Kit.ligne(l, 'Salaire net', Kit.eur(r.salaireNetCentimes));
    Kit.ligne(l, libelleEntretien(r), Kit.eur(r.entretienCentimes));

    if (r.joursCongesDecomptes > 0) {
      var imp = r.imputation || {};
      Kit.ligne(l, 'Congés posés ce mois-ci', r.joursCongesDecomptes + ' j ouvrables');
      Kit.ligne(l, '— sur vos congés payés', Kit.jours(imp.joursSurCp || 0), { discret: true });
      Kit.ligne(l, '— sur votre récupération', Kit.jours(imp.joursSurSup || 0), { discret: true });
      if ((imp.joursSansSolde || 0) > 0) {
        Kit.ligne(l, '— sans solde', Kit.jours(imp.joursSansSolde), { alerte: true });
      }
    }
    if (r.retenueSansSoldeCentimes > 0) {
      /* Sans cette ligne, le total serait plus bas que « salaire + entretien »
         sans explication : c'est exactement le genre de chiffre qui déclenche
         un désaccord. */
      Kit.ligne(l, 'Retenue pour jour(s) sans solde', '−' + Kit.eur(r.retenueSansSoldeCentimes), { alerte: true });
    }
    Kit.ligne(l, 'Heures sup du mois', Kit.heures(r.minutesSupAcquises), { discret: true });
    Kit.ligne(l, 'Total à verser', Kit.eur(r.totalAVerserCentimes), { total: true });

    var b = Kit.bouton(e.fige ? 'btn nt' : 'btn', function () {
      global.App.aller('document', { contratId: c.id, annee: vue.annee, mois: vue.mois });
    });
    b.textContent = e.fige ? 'Revoir le mois clôturé' : 'Vérifier et clôturer le mois';
    b.style.marginBottom = '0';
    p.appendChild(b);
    return p;
  }

  /* « Entretien — 19 j × 5,00 € » quand le tarif du contrat explique le total ;
     libellé neutre si une journée porte un montant saisi à la main (RG-14). */
  function libelleEntretien(r) {
    var attendu = r.joursPresence * (vue.contrat.entretien_centimes_jour || 0);
    if (attendu === r.entretienCentimes) {
      return 'Entretien — ' + r.joursPresence + ' j × ' + Kit.eur(vue.contrat.entretien_centimes_jour);
    }
    return 'Indemnité d’entretien';
  }

  /* --- 3. Compteurs de ce contrat ------------------------------------ */

  function panneauCompteurs() {
    var c = vue.contrat;
    var cs = vue.entree.resultat.compteurSortie || {};
    var p = Kit.pane('Compteurs de ' + c.prenom_enfant);

    var minutes = cs.minutesSup || 0;
    var parJour = c.minutes_par_jour_conge || 540;
    var joursRecup = Math.floor(minutes / parJour);
    compteur(p, {
      titre: 'Récupération',
      valeur: Kit.heures(minutes),
      pct: pourcent(minutes, BARRE_RECUP_EN_JOURS * parJour),
      note: joursRecup + ' jour' + (joursRecup > 1 ? 's' : '') + ' de congé — ' +
            Kit.duree(parJour) + ' accumulées = 1 jour',
      bas: false
    });

    var cp = (cs.dixiemesCpAcquis || 0) - (cs.dixiemesCpPris || 0);
    var bas = cp < SEUIL_CP_ORANGE_DIXIEMES;
    compteur(p, {
      titre: 'Congés payés',
      valeur: Kit.joursCp(cp),
      pct: pourcent(cp, BARRE_CP_DIXIEMES),
      note: bas
        ? 'Compteur bas — un congé d’été passerait en partie sans solde'
        : 'sur 30 jours ouvrables acquis par an',
      bas: bas
    });
    return p;
  }

  function pourcent(valeur, max) {
    if (!max) return 0;
    return Math.max(0, Math.min(100, Math.round(valeur * 100 / max)));
  }

  function compteur(parent, o) {
    var bloc = Kit.ce('div', 'cptr' + (o.bas ? ' low' : ''));
    var cl = Kit.ce('div', 'cl');
    cl.appendChild(Kit.ce('b', null, o.titre));
    cl.appendChild(Kit.ce('span', null, o.valeur));
    bloc.appendChild(cl);
    var cb = Kit.ce('div', 'cb');
    var i = Kit.ce('i');
    i.style.width = o.pct + '%';
    cb.appendChild(i);
    bloc.appendChild(cb);
    bloc.appendChild(Kit.ce('div', 'cn', o.note));
    parent.appendChild(bloc);
  }

  /* --- 4. Depuis le début du contrat --------------------------------- */

  function panneauDepuisDebut() {
    var c = vue.contrat;
    /* Les mois antérieurs au mois affiché sont déjà dans la chaîne : on les
       agrège avec la fonction partagée, qui sait ce qui s'additionne (les flux)
       et ce qui ne s'additionne jamais (les compteurs). */
    var jusquIci = (vue.chaine.mois || []).filter(function (e) {
      return Chaine.cmpMois(e.annee, e.mois, vue.annee, vue.mois) <= 0;
    });
    var a = Chaine.agregerPeriode(jusquIci);

    var p = Kit.pane('Depuis le début du contrat', {
      texte: 'Historique',
      onclick: function () {
        global.App.aller('historique', { contratId: c.id, annee: vue.annee, mois: vue.mois });
      }
    });
    var l = Kit.lines(p);
    Kit.ligne(l, 'Contrat démarré le', Kit.dateLongue(c.date_debut), { discret: true });
    Kit.ligne(l, 'Mois de garde', String(a.nbMois));
    Kit.ligne(l, 'Jours de présence', Kit.jours(a.joursPresence));
    Kit.ligne(l, 'Entretien versé', Kit.eur(a.entretienCentimes));
    if (vue.chaine.tronquee) {
      p.appendChild(Kit.warnbox('Historique trop long',
        'Seuls les ' + Chaine.MAX_MOIS + ' derniers mois ont été rejoués. ' +
        'Vérifiez la date de début du contrat dans sa fiche.'));
    }
    return p;
  }

  /* ------------------------------------------------------------------ */
  /* Feuille de saisie d'une journée (§2.3)                              */
  /* ------------------------------------------------------------------ */

  function ouvrirJour(d) {
    var c = vue.contrat;
    var type = Kit.typeDuJour(vue.journees, d);
    var autres = global.App.contrats();

    Kit.ouvrirFeuille(Kit.jourLong(d), c.prenom_enfant + ' — famille ' + ((c.famille && c.famille.nom) || '—'),
      function (corps) {
        if (type === 'conge_maria' || type === 'sans_solde' || type === 'hors_planning') {
          Kit.choix(corps, 'c1', '✓', 'Finalement, je travaillais',
            'Le jour redevient normal pour ' + libelleEnfants(autres),
            function (ev) { retirerConge(d, ev.currentTarget); });
          return;
        }

        if (type === 'familiarisation') {
          corps.appendChild(Kit.ce('p', 'sb q',
            'Journée de familiarisation, saisie à la main (heures réelles et indemnité). ' +
            'La modifier ci-dessous effacera ces valeurs.'));
        }

        var apercus = apercuDesChoix(d);

        Kit.choix(corps, 'c1', '✓', c.prenom_enfant + ' était là',
          apercus.presence, function (ev) { poserPresence(d, ev.currentTarget); });

        Kit.choix(corps, 'c2', '−', c.prenom_enfant + ' était ' + Kit.accord('absent'),
          apercus.absence, function (ev) { poserAbsenceEnfant(d, ev.currentTarget); });

        Kit.choix(corps, 'c3', '☾', 'Je ne travaillais pas',
          apercus.conge, function (ev) { poserConge(d, ev.currentTarget); });
      });
  }

  function libelleEnfants(contrats) {
    if (contrats.length <= 1) return 'ce contrat';
    return 'les ' + contrats.length + ' enfants';
  }

  /* Les effets annoncés sont CALCULÉS PAR LE MOTEUR (§4 des specs) : on rejoue
     le mois tel qu'il serait après chaque geste, et on lit l'écart. Aucun
     « −5 € » ni « −1 jour » n'est écrit en dur. */
  function apercuDesChoix(d) {
    var actuel = vue.entree.resultat;
    var typeActuel = Kit.typeDuJour(vue.journees, d);

    var presence = typeActuel === 'presence'
      ? 'C’est déjà le cas — rien à faire'
      : phraseEcart(simuler(d, 'presence'), actuel);

    var absence = phraseAbsence(simuler(d, 'absence_enfant'), actuel);

    var apresConge = simuler(d, 'conge_maria');
    var deltaConge = (apresConge.joursCongesDecomptes || 0) - (actuel.joursCongesDecomptes || 0);
    var conge = 'Congé posé pour ' + libelleEnfants(global.App.contrats()) +
      ', −' + deltaConge + ' jour' + (deltaConge > 1 ? 's' : '');

    return { presence: presence, absence: absence, conge: conge };
  }

  /* Rejoue le mois avec la journée `d` forcée au type `type`. Fonction pure :
     Engine.calculerMois ne touche ni au réseau, ni à la base. */
  function simuler(d, type) {
    var lignes = [];
    Object.keys(vue.journees).forEach(function (k) {
      if (k !== d) lignes.push(vue.journees[k]);
    });
    if (type !== 'presence') {
      lignes.push({ contrat_id: vue.contrat.id, jour: d, type: type,
                    minutes_reelles: null, entretien_centimes: null });
    }
    var salaire = vue.entree.salaire || { brut_mensuel_centimes: 0, net_mensuel_centimes: 0 };
    return Engine.calculerMois({
      contrat: vue.contrat,
      salaire: { brut_mensuel_centimes: salaire.brut_mensuel_centimes,
                 net_mensuel_centimes: salaire.net_mensuel_centimes },
      journees: lignes,
      compteurEntree: vue.entree.compteurEntree,
      annee: vue.annee,
      mois: vue.mois
    });
  }

  function phraseEcart(apres, avant) {
    var delta = (apres.entretienCentimes || 0) - (avant.entretienCentimes || 0);
    if (delta > 0) return 'Entretien de la journée rétabli (+' + Kit.eur(delta) + ')';
    if (delta < 0) return 'Entretien de la journée retiré (−' + Kit.eur(-delta) + ')';
    return 'Journée comptée comme travaillée';
  }

  function phraseAbsence(apres, avant) {
    var deltaEntretien = (apres.entretienCentimes || 0) - (avant.entretienCentimes || 0);
    var deltaSup = (apres.minutesSupAcquises || 0) - (avant.minutesSupAcquises || 0);
    var phrase = deltaEntretien < 0
      ? 'Pas d’entretien ce jour (−' + Kit.eur(-deltaEntretien) + ').'
      : 'Pas d’entretien ce jour.';
    /* RG-09 : les minutes restent dues, sauf si le paramètre du contrat dit le
       contraire. La phrase suit le paramètre, elle ne le devine pas. */
    if (deltaSup === 0) {
      phrase += ' Vos ' + Kit.duree(vue.contrat.minutes_sup_jour) + ' restent dues';
    } else {
      phrase += ' Vos ' + Kit.duree(-deltaSup) + ' ne sont pas dues sur ce contrat';
    }
    return phrase;
  }

  /* ------------------------------------------------------------------ */
  /* Écritures                                                           */
  /* ------------------------------------------------------------------ */

  /* Un échec d'écriture doit se VOIR, et la feuille RESTE ouverte : la saisie
     en cours ne disparaît pas sous les doigts de Maria (§3 des specs). */
  function ecrire(promesse, bouton, messageOk) {
    if (bouton) bouton.disabled = true;
    return promesse
      .then(function () {
        global.App.invalider();
        Kit.fermerFeuille();
        Kit.toast(messageOk);
        return global.App.rafraichir();
      })
      .catch(function (e) {
        if (bouton) bouton.disabled = false;
        Kit.toast('Enregistrement impossible : ' + Kit.messageErreur(e) + ' Rien n’a été modifié.', true);
      });
  }

  function poserPresence(d, bouton) {
    if (Kit.typeDuJour(vue.journees, d) === 'presence') { Kit.fermerFeuille(); return; }
    ecrire(global.DB.supprimerJournee(vue.contrat.id, d), bouton, 'Journée enregistrée');
  }

  function poserAbsenceEnfant(d, bouton) {
    ecrire(global.DB.enregistrerJournee({
      contrat_id: vue.contrat.id, jour: d, type: 'absence_enfant',
      minutes_reelles: null, entretien_centimes: null, commentaire: null
    }), bouton, vue.contrat.prenom_enfant + ' ' + Kit.accord('noté') + ' ' + Kit.accord('absent'));
  }

  /* « Je ne travaillais pas » — écrit sur TOUS les contrats actifs, chacun
     avec SES propres jours. Un seul aller-retour réseau. */
  function poserConge(d, bouton) {
    var affectations = affectationsDuJour(d);
    if (!affectations.length) { Kit.toast('Ce jour n’est dans aucun planning.', true); return; }
    ecrire(global.DB.poserAbsenceMaria(affectations, 'conge_maria', null), bouton,
      'Congé posé — appliqué à ' + libelleEnfants(global.App.contrats()));
  }

  function retirerConge(d, bouton) {
    var ids = global.App.contrats().map(function (c) { return c.id; });
    if (ids.indexOf(vue.contrat.id) === -1) ids.push(vue.contrat.id);
    ecrire(global.DB.retirerAbsenceMaria(ids, [d], TYPES_ABSENCE_MARIA), bouton,
      'Congé retiré de ' + libelleEnfants(global.App.contrats()));
  }

  /* Chaque contrat ne reçoit que le jour qui LUI appartient : jour de son
     planning, dans ses bornes, non férié. On n'applique jamais le jour d'un
     contrat à un autre. */
  function affectationsDuJour(d) {
    if (Feries.estJourFerie(d)) return [];
    return global.App.contrats().map(function (c) {
      var planning = c.jours_planning || [1, 2, 3, 4, 5];
      var ok = planning.indexOf(Engine.jourSemaine(d)) !== -1 &&
               !(c.date_debut && d < c.date_debut) &&
               !(c.date_fin && d > c.date_fin);
      return { contratId: c.id, jours: ok ? [d] : [] };
    }).filter(function (a) { return a.jours.length > 0; });
  }

  global.UiEnfant = {
    afficher: afficher,
    TYPES_ABSENCE_MARIA: TYPES_ABSENCE_MARIA,
    SEUIL_CP_ORANGE_DIXIEMES: SEUIL_CP_ORANGE_DIXIEMES
  };
})(window);
