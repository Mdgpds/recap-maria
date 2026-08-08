/* ============================================================================
   ui-menu.js — Onglet « Menu » (§1 des specs).

   Tout ce qui ne se fait pas tous les jours : consulter une période, rouvrir un
   ancien contrat, ajouter un enfant, se déconnecter.

   Un point mérite d'être dit ici plutôt qu'en commentaire perdu : les ANCIENS
   CONTRATS ouvrent LE MÊME espace enfant que les contrats en cours, en lecture
   seule. Pas un écran d'archive appauvri : le même calendrier, les mêmes
   panneaux, le même historique. Une pièce justificative se relit exactement
   comme elle a été produite.

   Aucun calcul ici, aucune règle. Les créations passent par DB.
   ========================================================================= */
(function (global) {
  'use strict';

  var Kit = global.Kit;
  var Chaine = global.ChaineMois;

  function afficher(ctx) {
    ctx.barre.className = 'bar';
    ctx.barre.appendChild(Kit.ce('span', 'ti', 'Menu'));
    var corps = ctx.corps;

    corps.appendChild(Kit.section('Consulter'));
    corps.appendChild(entree('Récapitulatif sur une période',
      'Deux dates, un ou plusieurs enfants',
      function () { global.App.aller('periode', {}); }));

    var anciens = entree('Anciens contrats', 'Chargement…', null);
    corps.appendChild(anciens);

    corps.appendChild(Kit.section('Gérer'));
    corps.appendChild(entree('Ajouter un enfant', 'Une famille, un enfant, une date de début',
      function () { feuilleNouvelEnfant(); }));

    corps.appendChild(Kit.section('Compte'));
    corps.appendChild(Kit.fld('Connectée', global.App.email() || '—'));
    var bOut = Kit.bouton('btn nt', function () { deconnecter(bOut); });
    bOut.textContent = 'Se déconnecter';
    corps.appendChild(bOut);
    corps.appendChild(Kit.ce('p', 'sb q',
      'Vous restez connectée d’une fois sur l’autre : ce bouton est le seul moyen de fermer ' +
      'votre session.'));

    return global.App.tousLesContrats().then(function (tous) {
      var archives = (tous || []).filter(function (c) { return c.archive; });
      majAnciens(anciens, archives);
    }).catch(function () {
      majAnciens(anciens, null);
    });
  }

  function entree(titre, sous, onclick) {
    var b = onclick ? Kit.bouton('menu', onclick) : Kit.ce('div', 'menu');
    var tx = Kit.ce('span');
    tx.appendChild(document.createTextNode(titre));
    if (sous) tx.appendChild(Kit.ce('span', 'd', sous));
    b.appendChild(tx);
    b.appendChild(Kit.ce('span', 'ar', '›'));
    return b;
  }

  function majAnciens(el, archives) {
    var sous = el.querySelector('.d');
    if (archives === null) {
      if (sous) sous.textContent = 'Liste indisponible pour l’instant';
      return;
    }
    if (!archives.length) {
      if (sous) sous.textContent = 'Aucun pour l’instant';
      return;
    }
    if (sous) {
      sous.textContent = archives.map(function (c) { return c.prenom_enfant; }).join(', ') +
        ' — tout l’historique';
    }
    var remplacant = Kit.bouton('menu', function () { feuilleAnciens(archives); });
    while (el.firstChild) remplacant.appendChild(el.firstChild);
    el.parentNode.replaceChild(remplacant, el);
  }

  function feuilleAnciens(archives) {
    Kit.ouvrirFeuille('Anciens contrats',
      'Même espace que les contrats en cours, en lecture seule.',
      function (corps) {
        archives.forEach(function (c) {
          Kit.choix(corps, 'c1', (c.prenom_enfant || '?').charAt(0).toUpperCase(),
            c.prenom_enfant,
            'Famille ' + ((c.famille && c.famille.nom) || '—') +
            (c.date_fin ? ' — jusqu’au ' + Kit.dateLongue(c.date_fin) : ''),
            function () {
              Kit.fermerFeuille();
              /* On atterrit sur le DERNIER mois du contrat : c'est celui qu'on
                 vient consulter, pas un mois vide d'aujourd'hui. */
              var m = c.date_fin ? Chaine.moisDeDate(c.date_fin) : global.App.moisCourant();
              global.App.aller('enfant', { contratId: c.id, annee: m.annee, mois: m.mois });
            });
        });
      });
  }

  /* ------------------------------------------------------------------ */
  /* Ajouter un enfant                                                   */
  /* ------------------------------------------------------------------ */

  function parseEuros(txt) {
    if (txt == null) return null;
    var norm = String(txt).replace(/[\s €]/g, '');
    if (norm === '') return null;
    if (norm.indexOf(',') !== -1) norm = norm.replace(/\./g, '').replace(',', '.');
    if (!/^\d+(\.\d+)?$/.test(norm)) return null;
    var v = parseFloat(norm);
    if (isNaN(v) || v < 0) return null;
    return Math.round(v * 100);
  }

  function feuilleNouvelEnfant() {
    var maintenant = global.App.moisCourant();

    global.DB.listFamillesToutes().then(function (familles) {
      Kit.ouvrirFeuille('Ajouter un enfant',
        'La famille, l’enfant, la date de début, puis sa rémunération.',
        function (corps) {
          var options = [['', '➕ Nouvelle famille']].concat(
            (familles || []).filter(function (f) { return !f.archive; })
              .map(function (f) { return [f.id, f.nom]; }));
          var selFamille = Kit.champSelect('Famille', options, options.length > 1 ? options[1][0] : '');
          corps.appendChild(selFamille.bloc);

          var nomFamille = Kit.champ('Nom de la nouvelle famille', '', { placeholder: 'Papillon' });
          corps.appendChild(nomFamille.bloc);

          function majFamille() {
            nomFamille.bloc.hidden = !!selFamille.select.value;
          }
          selFamille.select.addEventListener('change', majFamille);
          majFamille();

          var prenom = Kit.champ('Prénom de l’enfant', '', { placeholder: 'Léa' });
          corps.appendChild(prenom.bloc);

          var debut = Kit.champDate('Début du contrat',
            Kit.iso(maintenant.annee, maintenant.mois, 1),
            { anneeMin: maintenant.annee - 3, anneeMax: maintenant.annee + 1 });
          corps.appendChild(debut.bloc);

          corps.appendChild(Kit.section('Rémunération'));
          var brut = Kit.champ('Salaire brut', '', { placeholder: '1 401,20', inputmode: 'decimal' });
          corps.appendChild(brut.bloc);
          var net = Kit.champ('Salaire net', '', { placeholder: '1 094,60', inputmode: 'decimal' });
          corps.appendChild(net.bloc);
          corps.appendChild(Kit.ce('p', 'sb q',
            'Le net se lit sur la fiche de paie : il ne se calcule pas depuis le brut. ' +
            'Vous pourrez le compléter plus tard depuis la fiche du contrat.'));

          corps.appendChild(Kit.note('Les autres réglages prennent les valeurs habituelles',
            'Lundi à vendredi, 8h30 → 17h30, 30 minutes supplémentaires par jour travaillé, ' +
            '5,00 € d’entretien par jour de présence. Tout est modifiable ensuite dans la fiche ' +
            'du contrat.'));

          var msg = Kit.ce('div', 'msg');
          corps.appendChild(msg);
          var b = Kit.bouton('btn', function () { creer(); });
          b.textContent = 'Créer le contrat';
          corps.appendChild(b);

          function erreur(t) { msg.textContent = t; msg.className = 'msg ko'; }

          function creer() {
            msg.textContent = ''; msg.className = 'msg';
            var p = prenom.input.value.trim();
            if (!p) { erreur('Le prénom de l’enfant est obligatoire.'); return; }
            var idFamille = selFamille.select.value;
            var nouveauNom = nomFamille.input.value.trim();
            if (!idFamille && !nouveauNom) { erreur('Donnez un nom à la nouvelle famille.'); return; }
            var brutC = parseEuros(brut.input.value);
            var netC = parseEuros(net.input.value);
            if (brut.input.value.trim() && brutC == null) {
              erreur('Le salaire brut est illisible (exemple : 1 401,20).'); return;
            }

            b.disabled = true;
            msg.className = 'msg';
            msg.textContent = 'Création…';

            var pFamille = idFamille
              ? Promise.resolve({ id: idFamille })
              : global.DB.creerFamille({ nom: nouveauNom, canal: null });

            pFamille
              .then(function (famille) {
                return global.DB.creerContrat({
                  famille_id: famille.id,
                  prenom_enfant: p,
                  date_debut: debut.valeur(),
                  statut: 'actif'
                });
              })
              .then(function (contrat) {
                if (brutC == null) return contrat;
                var d = debut.valeur();
                var mm = Chaine.moisDeDate(d);
                return global.DB.ajouterSalaire(contrat.id, {
                  date_effet: Chaine.premierJour(mm.annee, mm.mois),
                  brut_mensuel_centimes: brutC,
                  net_mensuel_centimes: netC == null ? 0 : netC
                }).then(function () { return contrat; });
              })
              .then(function () {
                Kit.fermerFeuille();
                Kit.toast('Contrat de ' + p + ' créé');
                return global.App.rechargerContrats();
              })
              .then(function () { return global.App.aller('accueil', {}, true); })
              .catch(function (e) {
                b.disabled = false;
                erreur('Création impossible : ' + Kit.messageErreur(e) +
                  ' Vérifiez et réessayez — votre saisie est conservée.');
              });
          }
        });
    }).catch(function (e) {
      Kit.toast('Liste des familles indisponible : ' + Kit.messageErreur(e), true);
    });
  }

  /* ------------------------------------------------------------------ */

  function deconnecter(bouton) {
    bouton.disabled = true;
    global.App.deconnecter().catch(function () { bouton.disabled = false; });
  }

  global.UiMenu = { afficher: afficher };
})(window);
