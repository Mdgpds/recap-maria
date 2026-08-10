/* ============================================================================
   ui-document.js — Le document du mois, sa clôture et son partage (§2.4).

   DÉCISION STRUCTURANTE DU LOT, tenue par ce fichier : la clôture du mois et
   l'envoi aux parents sont DEUX CHOSES DISTINCTES.

   - Le geste central est « Clôturer le mois ». Il fige le récapitulatif
     (statut `fige` en base). À l'écran, le mot est TOUJOURS « clôturé » :
     jamais « figé », jamais « envoyé ».
   - Le partage est FACULTATIF et disponible avant comme après la clôture :
     copier le texte, enregistrer une image. Aucune intégration WhatsApp,
     aucune API d'envoi — le document reste ici, disponible à tout moment.

   Un mois clôturé s'affiche depuis son INSTANTANÉ, jamais recalculé : c'est le
   document parti chez les parents qui fait foi, y compris si un barème ou un
   prénom change ensuite.

   Aucun calcul ici : le contenu vient de la chaîne des mois (donc de Engine),
   ou de l'instantané pour un mois clôturé.
   ========================================================================= */
(function (global) {
  'use strict';

  var Kit = global.Kit;
  var Chaine = global.ChaineMois;

  var vue = null;

  /* ------------------------------------------------------------------ */
  /* Affichage                                                           */
  /* ------------------------------------------------------------------ */

  function afficher(ctx) {
    var contrat = global.App.contratParId(ctx.params.contratId);
    var m = { annee: ctx.params.annee, mois: ctx.params.mois };
    if (!contrat) {
      return global.App.tousLesContrats().then(function () {
        return charger(ctx, global.App.contratParId(ctx.params.contratId), m);
      });
    }
    return charger(ctx, contrat, m);
  }

  function charger(ctx, contrat, m) {
    if (!contrat) throw new Error('contrat introuvable');

    global.App.barreRetour(ctx.barre,
      'Récap de ' + Kit.libelleMois(m.mois), { droite: contrat.prenom_enfant });
    ctx.corps.appendChild(Kit.ce('div', 'attente', 'Préparation du document…'));

    return Promise.all([
      global.App.serie(contrat, m),
      global.App.journees(contrat.id, m.annee, m.mois)
    ]).then(function (r) {
      var entree = global.App.moisDe(r[0], m.annee, m.mois);
      if (!entree) throw new Error('mois hors du contrat');
      vue = {
        contrat: contrat, annee: m.annee, mois: m.mois,
        entree: entree, journees: r[1],
        lectureSeule: !!contrat.archive
      };
      Kit.vider(ctx.corps);
      rendre(ctx.corps);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Contenu du document — une seule source pour l'écran, le texte et    */
  /* l'image. Trois rendus différents ne doivent jamais pouvoir diverger. */
  /* ------------------------------------------------------------------ */

  function identite() {
    var r = vue.entree.resultat;
    /* Sur un mois clôturé, le nom vient de l'instantané : renommer un enfant
       ne réécrit pas un document déjà remis aux parents. */
    if (vue.entree.fige && r.prenomEnfant) {
      return { prenom: r.prenomEnfant, famille: r.nomFamille || null };
    }
    return {
      prenom: vue.contrat.prenom_enfant,
      famille: (vue.contrat.famille && vue.contrat.famille.nom) || null
    };
  }

  /* Jours de congé du mois. Sur un mois clôturé ils viennent de l'instantané
     (champ ajouté au figement, cf. instantane()) ; sur un mois en cours, des
     journées saisies. Repli sur le décompte seul pour les instantanés
     antérieurs au lot 6, qui ne portent pas la liste. */
  function joursConge() {
    var r = vue.entree.resultat;
    if (vue.entree.fige) return r.joursConge || null;
    return Object.keys(vue.journees).filter(function (d) {
      return vue.journees[d].type === 'conge_maria';
    }).sort();
  }

  /* Le document, sous forme de blocs. Chaque bloc : { titre, lignes }. */
  function blocs() {
    var r = vue.entree.resultat;
    var imp = r.imputation || {};
    var cs = r.compteurSortie || {};
    var conges = joursConge();
    var out = [];

    var principal = [
      ['Jours de présence', Kit.jours(r.joursPresence)],
      ['Indemnité d’entretien', Kit.eur(r.entretienCentimes)],
      ['Salaire net', Kit.eur(r.salaireNetCentimes)],
      ['Salaire brut correspondant', Kit.eur(r.salaireBrutCentimes), { doux: true }]
    ];
    if (r.retenueSansSoldeCentimes > 0) {
      principal.push(['Retenue pour jour(s) sans solde', '−' + Kit.eur(r.retenueSansSoldeCentimes)]);
    }
    principal.push(['Total à verser', Kit.eur(r.totalAVerserCentimes), { total: true }]);
    out.push({ titre: null, lignes: principal });

    var lignesConge = [];
    if (conges && conges.length) {
      conges.forEach(function (d) { lignesConge.push([Kit.jourLong(d), '1 jour']); });
    }
    if (r.joursCongesDecomptes > 0) {
      lignesConge.push(['Décompte en jours ouvrables', r.joursCongesDecomptes + ' j']);
      lignesConge.push(['— sur congés payés', Kit.jours(imp.joursSurCp || 0)]);
      lignesConge.push(['— sur récupération', Kit.jours(imp.joursSurSup || 0)]);
      if ((imp.joursSansSolde || 0) > 0) lignesConge.push(['— sans solde', Kit.jours(imp.joursSansSolde)]);
    }
    if (!lignesConge.length) lignesConge.push(['Aucun ce mois-ci', '—']);
    out.push({ titre: 'Congés de l’assistante maternelle', lignes: lignesConge });

    out.push({
      titre: 'Compteurs de ce contrat à la fin du mois',
      lignes: [
        ['Heures supplémentaires acquises dans le mois', Kit.heures(r.minutesSupAcquises)],
        ['Récupération restante', Kit.heures(cs.minutesSup || 0)],
        ['Congés payés restants', Kit.joursCp(Kit.cpDisponible(cs))]
      ]
    });
    return out;
  }

  /* Encart permanent de RG-06 : c'est lui qui doit éteindre le désaccord
     historique sur le décompte des congés. Il figure sur TOUS les documents,
     même ceux sans congé. */
  var ENCART_RG06 =
    'Les congés payés d’une assistante maternelle se comptent en jours ouvrables, ' +
    'du lundi au samedi, dimanches et jours fériés exclus. Une semaine complète compte ' +
    'donc 6 jours, même si je ne travaille pas le samedi.';

  /* ------------------------------------------------------------------ */
  /* Rendu écran                                                         */
  /* ------------------------------------------------------------------ */

  function rendre(corps) {
    var e = vue.entree;
    var id = identite();
    /* Correction B2 (relecture lot 6). Un barème dont le net vaut 0 est un
       barème PRÉSENT : le moteur ne signale rien, `salaireManquant` est faux,
       et le document part avec un total amputé du salaire entier — 85,00 € au
       lieu de 1 157,50 €. Comme le document est immuable, le mois serait faux
       pour toujours sur la pièce remise aux parents. L'alerte du lot 5 est
       rétablie, et la clôture refusée tant que le net est inconnu. */
    var netManquant = !e.salaireManquant && !e.resultat.salaireNetCentimes;

    if (e.salaireManquant) {
      corps.appendChild(Kit.warnbox('Aucune rémunération connue pour ce mois',
        'Le document est incomplet : les montants resteront à zéro tant qu’aucun barème ' +
        'n’est enregistré dans la fiche contrat. Ce mois ne peut pas être clôturé.'));
    } else if (netManquant) {
      corps.appendChild(Kit.warnbox('Ce récapitulatif est incomplet : le net n’est pas renseigné',
        'Le total à verser ci-dessous ne contient que l’indemnité d’entretien, sans le salaire. ' +
        'Le net figure sur la fiche de paie du mois : renseignez-le dans la fiche contrat. ' +
        'Ce mois ne peut pas être clôturé tant qu’il manque.'));
    }

    corps.appendChild(documentHtml(id));

    if (e.fige) {
      corps.appendChild(Kit.note('Mois clôturé' + (e.recap && e.recap.fige_le ? ' le ' + Kit.dateLongue(e.recap.fige_le) : ''),
        'Les chiffres de ce mois ne bougeront plus, même si un salaire change plus tard.'));
      /* Lot 13 : la porte de réouverture, et l'historique qui la rend
         acceptable. Les deux vont toujours ensemble. */
      if (global.UiReouverture && e.recap) {
        global.UiReouverture.actionsMoisCloture(corps, {
          contrat: vue.contrat, annee: vue.annee, mois: vue.mois, recap: e.recap
        });
      }
      corps.appendChild(sectionPartage());
      return;
    }

    if (e.avantInitialisation) {
      corps.appendChild(Kit.warnbox('Ce mois ne peut pas être clôturé',
        'Il est antérieur à la reprise de vos compteurs : les soldes y repartent de zéro. ' +
        'Le document reste consultable et partageable.'));
      corps.appendChild(sectionPartage());
      return;
    }

    if (vue.lectureSeule) {
      corps.appendChild(Kit.note('Ancien contrat — lecture seule',
        'Ce contrat est rangé : ses mois ne se clôturent plus. Le document reste disponible.'));
      corps.appendChild(sectionPartage());
      return;
    }

    /* Un mois à venir n'a pas été travaillé : il n'y a rien à verrouiller. */
    var maintenant = global.App.moisCourant();
    var aVenir = Chaine.cmpMois(vue.annee, vue.mois, maintenant.annee, maintenant.mois) > 0;

    if (aVenir) {
      corps.appendChild(Kit.warnbox('Mois à venir',
        'Il ne se clôture qu’une fois passé. Les chiffres ci-dessus sont une projection.'));
      corps.appendChild(sectionPartage());
      return;
    }

    if (!e.salaireManquant && !netManquant) {
      var b = Kit.bouton('btn', demanderCloture);
      b.textContent = 'Clôturer le mois';
      corps.appendChild(b);
      corps.appendChild(Kit.warnbox('La clôture verrouille le mois',
        'Après clôture, plus aucune modification n’est possible sur ' +
        Kit.libelleMoisAnnee(vue.annee, vue.mois) + '. C’est ce qui protège vos comptes ' +
        'en cas de désaccord.'));
    } else {
      var bFiche = Kit.bouton('btn', function () {
        global.App.aller('fiche', { contratId: vue.contrat.id });
      });
      bFiche.textContent = 'Compléter la rémunération';
      corps.appendChild(bFiche);
    }
    corps.appendChild(sectionPartage());
  }

  function documentHtml(id) {
    var doc = Kit.ce('div', 'doc');
    var dh = Kit.ce('div', 'dh');
    dh.appendChild(Kit.ce('div', 't1', id.prenom + ' — ' + Kit.libelleMoisAnnee(vue.annee, vue.mois)));
    dh.appendChild(Kit.ce('div', 't2', 'Récapitulatif mensuel' + (id.famille ? ' · famille ' + id.famille : '')));
    doc.appendChild(dh);

    blocs().forEach(function (b) {
      if (b.titre) doc.appendChild(Kit.ce('div', 'ds', b.titre));
      b.lignes.forEach(function (l) {
        var o = l[2] || {};
        var dl = Kit.ce('div', 'dl' + (o.total ? ' tt' : ''));
        if (o.doux) dl.style.color = '#6b6659';
        dl.appendChild(Kit.ce('span', null, l[0]));
        dl.appendChild(Kit.ce('span', null, l[1]));
        doc.appendChild(dl);
      });
    });

    var dn = Kit.ce('div', 'dn');
    dn.appendChild(Kit.ce('b', null, 'Décompte des congés. '));
    dn.appendChild(document.createTextNode(ENCART_RG06));
    doc.appendChild(dn);
    return doc;
  }

  function sectionPartage() {
    var bloc = Kit.ce('div');
    bloc.appendChild(Kit.section('Partager — si vous le souhaitez'));

    var bTexte = Kit.bouton('btn nt', function () { Kit.copierTexte(texte()); });
    bTexte.textContent = 'Copier le texte';
    bloc.appendChild(bTexte);

    var bImage = Kit.bouton('btn nt', function () { enregistrerImage(bImage); });
    bImage.textContent = 'Enregistrer en image';
    bloc.appendChild(bImage);

    bloc.appendChild(Kit.ce('p', 'sb q',
      'L’envoi aux parents est facultatif : le document reste disponible ici à tout moment.'));
    return bloc;
  }

  /* ------------------------------------------------------------------ */
  /* Texte à copier                                                      */
  /* ------------------------------------------------------------------ */

  function texte() {
    var id = identite();
    var lignes = [id.prenom + ' — ' + Kit.libelleMoisAnnee(vue.annee, vue.mois)];
    lignes.push('Récapitulatif mensuel' + (id.famille ? ' · famille ' + id.famille : ''));
    blocs().forEach(function (b) {
      lignes.push('');
      if (b.titre) lignes.push(b.titre.toUpperCase());
      b.lignes.forEach(function (l) { lignes.push(l[0] + ' : ' + l[1]); });
    });
    lignes.push('');
    lignes.push('Décompte des congés. ' + ENCART_RG06);
    if (!vue.entree.fige) {
      lignes.push('');
      lignes.push('(Mois non encore clôturé : ces chiffres peuvent encore changer.)');
    }
    return lignes.join('\n');
  }

  /* ------------------------------------------------------------------ */
  /* Image                                                               */
  /* ------------------------------------------------------------------ */

  /* Le document est redessiné dans un canvas avec la même identité papier
     (fond crème, Georgia, filet bleu). Pas de bibliothèque, pas de capture
     d'écran : le rendu est piloté par les MÊMES blocs que l'écran et le texte. */
  function dessiner() {
    var id = identite();
    var L = 820, marge = 52, ligneH = 46, titreH = 34;
    var groupes = blocs();

    var hauteur = marge + 96;                       // en-tête
    groupes.forEach(function (b) {
      if (b.titre) hauteur += titreH;
      hauteur += b.lignes.length * ligneH + 10;
    });
    hauteur += 180 + 30;                            // encart RG-06, mention provisoire, marge

    var canvas = document.createElement('canvas');
    canvas.width = L;
    canvas.height = hauteur;
    var g = canvas.getContext('2d');
    if (!g) throw new Error('canvas indisponible');

    g.fillStyle = '#fffdf8';
    g.fillRect(0, 0, L, hauteur);

    var y = marge + 12;
    g.fillStyle = '#2b2a26';
    g.font = 'bold 34px Georgia, "Times New Roman", serif';
    g.fillText(id.prenom + ' — ' + Kit.libelleMoisAnnee(vue.annee, vue.mois), marge, y);
    y += 30;
    g.fillStyle = '#6b6659';
    g.font = '20px -apple-system, Helvetica, Arial, sans-serif';
    g.fillText('Récapitulatif mensuel' + (id.famille ? ' · famille ' + id.famille : ''), marge, y);
    y += 22;
    g.strokeStyle = '#1f4f7a';
    g.lineWidth = 3;
    g.beginPath(); g.moveTo(marge, y); g.lineTo(L - marge, y); g.stroke();
    y += 34;

    groupes.forEach(function (b) {
      if (b.titre) {
        g.fillStyle = '#8a8371';
        g.font = 'bold 17px -apple-system, Helvetica, Arial, sans-serif';
        g.fillText(b.titre.toUpperCase(), marge, y);
        y += titreH - 8;
      }
      b.lignes.forEach(function (l) {
        var o = l[2] || {};
        if (o.total) {
          g.strokeStyle = '#2b2a26'; g.lineWidth = 3;
          g.beginPath(); g.moveTo(marge, y - 24); g.lineTo(L - marge, y - 24); g.stroke();
        }
        g.fillStyle = o.doux ? '#6b6659' : '#2b2a26';
        g.font = (o.total ? 'bold ' : '') + '24px Georgia, "Times New Roman", serif';
        g.textAlign = 'left';
        g.fillText(l[0], marge, y);
        g.textAlign = 'right';
        g.font = 'bold 24px Georgia, "Times New Roman", serif';
        g.fillText(l[1], L - marge, y);
        g.textAlign = 'left';
        y += ligneH - 14;
        if (!o.total) {
          g.strokeStyle = '#e3dcca'; g.lineWidth = 1;
          g.beginPath(); g.moveTo(marge, y); g.lineTo(L - marge, y); g.stroke();
        }
        y += 14;
      });
      y += 10;
    });

    g.fillStyle = '#f4f1e6';
    g.fillRect(marge, y - 6, L - 2 * marge, 132);
    g.strokeStyle = '#e3dcca'; g.lineWidth = 1;
    g.strokeRect(marge, y - 6, L - 2 * marge, 132);
    g.fillStyle = '#5d5747';
    g.font = 'bold 19px -apple-system, Helvetica, Arial, sans-serif';
    g.fillText('Décompte des congés', marge + 18, y + 26);
    g.font = '19px -apple-system, Helvetica, Arial, sans-serif';
    habiller(g, ENCART_RG06, marge + 18, y + 54, L - 2 * marge - 36, 26);

    /* Correction A11 : le texte copié porte la mention « provisoire » sur un
       mois non clôturé, l'image ne la portait pas — un PNG envoyé aux parents
       avant clôture était indiscernable du définitif. */
    if (!vue.entree.fige) {
      g.fillStyle = '#a34e00';
      g.font = 'bold 20px -apple-system, Helvetica, Arial, sans-serif';
      g.fillText('Mois non encore clôturé — ces chiffres peuvent encore changer.',
        marge, y + 168);
    }

    return canvas;
  }

  /* Découpe un paragraphe en lignes qui tiennent dans `largeur`. */
  function habiller(g, texteBrut, x, y, largeur, interligne) {
    var mots = texteBrut.split(' ');
    var ligne = '';
    for (var i = 0; i < mots.length; i++) {
      var essai = ligne ? ligne + ' ' + mots[i] : mots[i];
      if (g.measureText(essai).width > largeur && ligne) {
        g.fillText(ligne, x, y);
        y += interligne;
        ligne = mots[i];
      } else {
        ligne = essai;
      }
    }
    if (ligne) g.fillText(ligne, x, y);
  }

  function nomFichier() {
    var id = identite();
    return 'recap-' + sansAccent(id.prenom) + '-' +
      sansAccent(Kit.libelleMois(vue.mois)) + '-' + vue.annee + '.png';
  }
  function sansAccent(s) {
    return String(s || '').normalize ? String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
                                     : String(s).toLowerCase();
  }

  function enregistrerImage(bouton) {
    var canvas;
    try { canvas = dessiner(); }
    catch (e) {
      Kit.toast('Image impossible à produire sur cet appareil. Utilisez « Copier le texte ».', true);
      return;
    }
    bouton.disabled = true;
    var fini = function () { bouton.disabled = false; };

    canvas.toBlob(function (blob) {
      if (!blob) { Kit.toast('Image impossible à produire.', true); fini(); return; }
      var fichier = null;
      try { fichier = new File([blob], nomFichier(), { type: 'image/png' }); } catch (e) { fichier = null; }

      /* Sur téléphone, le partage natif enregistre dans les photos ou envoie
         directement — sans aucune intégration WhatsApp de notre côté. */
      if (fichier && global.navigator && global.navigator.canShare &&
          global.navigator.canShare({ files: [fichier] }) && global.navigator.share) {
        global.navigator.share({ files: [fichier] })
          .then(function () { Kit.toast('Image partagée'); })
          .catch(function () { telecharger(blob); })
          .then(fini, fini);
        return;
      }
      telecharger(blob);
      fini();
    }, 'image/png');
  }

  function telecharger(blob) {
    try {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = nomFichier();
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      Kit.toast('Image enregistrée');
    } catch (e) {
      Kit.toast('Enregistrement de l’image impossible. Utilisez « Copier le texte ».', true);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Clôture                                                             */
  /* ------------------------------------------------------------------ */

  function demanderCloture() {
    var id = identite();
    Kit.ouvrirFeuille('Clôturer ' + Kit.libelleMoisAnnee(vue.annee, vue.mois) + ' ?',
      id.prenom + (id.famille ? ' — famille ' + id.famille : ''),
      function (corps) {
        /* Lot 13 : la clôture n'est plus définitive, elle est réversible par
           un geste tracé. Le texte le dit — promettre l'irréversible alors
           qu'un bouton la défait ferait douter de tout le reste. */
        corps.appendChild(Kit.warnbox('La clôture verrouille le mois',
          'Après clôture, les chiffres ne bougent plus. Vérifiez vos journées avant de continuer. ' +
          'Vous pourrez rouvrir ce mois si vous devez corriger : la réouverture sera inscrite ' +
          'dans son historique. Le partage aux parents, lui, reste possible à tout moment.'));
        var l = Kit.lines(corps);
        var r = vue.entree.resultat;
        Kit.ligne(l, 'Jours de présence', Kit.jours(r.joursPresence));
        Kit.ligne(l, 'Total à verser', Kit.eur(r.totalAVerserCentimes), { total: true });
        var b = Kit.bouton('btn', function () { verifierPuisCloturer(b); });
        b.textContent = 'Oui, clôturer le mois';
        corps.appendChild(b);
      });
  }

  /* Reclôture d'un mois qui avait déjà été clôturé une fois : avant d'écrire
     le nouvel instantané, on compare poste à poste avec l'ancien.

     Le résultat peut différer pour deux raisons — une journée corrigée, ou un
     barème changé entre-temps. Le second cas est le dangereux : sans cet
     écran, rouvrir puis refermer un mois après une revalorisation modifierait
     en silence un document déjà chez un parent.

     Aucun écart, ou mois jamais clôturé : on clôture directement, sans écran
     intermédiaire. */
  function verifierPuisCloturer(bouton) {
    var snap = instantane();
    var ecarts = global.UiReouverture
      ? global.UiReouverture.ecarts(vue.entree.recap, snap)
      : [];

    if (!ecarts.length) return cloturer(bouton, snap);

    global.UiReouverture.feuilleEcarts({
      contrat: vue.contrat, annee: vue.annee, mois: vue.mois,
      recap: vue.entree.recap, ecarts: ecarts,
      confirmer: function (b) { cloturer(b, snap); }
    });
  }

  /* L'instantané enregistré : le ResultatMois du moteur, plus ce que le moteur
     ne connaît pas et qui doit pourtant rester figé — le prénom et le nom de
     famille (acquis du lot 5), la date d'effet du barème appliqué, et la liste
     des jours de congé du mois (lot 6, pour que le document affiche les mêmes
     dates avant et après la clôture). Le moteur n'est pas touché. */
  function instantane() {
    var r = vue.entree.resultat;
    var snap = {};
    Object.keys(r).forEach(function (k) { snap[k] = r[k]; });
    snap.prenomEnfant = vue.contrat.prenom_enfant;
    snap.nomFamille = (vue.contrat.famille && vue.contrat.famille.nom) || null;
    snap.salaireDateEffet = vue.entree.salaire ? vue.entree.salaire.date_effet : null;
    snap.joursConge = joursConge() || [];
    return snap;
  }

  /* Lot 13 : la clôture passe désormais par `recloturerRecap`, qui écrit
     l'événement « cloture » dans la même transaction. C'est vrai AUSSI de la
     première clôture — sans quoi l'historique d'un mois commencerait par
     « Rouvert », sans jamais dire quand il avait été clôturé.
     L'horodatage est produit par la base : plus d'objet Date ici. */
  function cloturer(bouton, snap) {
    bouton.disabled = true;
    global.DB.recloturerRecap(vue.contrat.id, vue.annee, vue.mois, snap || instantane())
      .then(function (ligne) {
        global.App.invalider();
        Kit.fermerFeuille();
        if (!ligne) {
          /* Le mois était déjà clôturé ailleurs (deuxième téléphone, second
             onglet). Cette branche était INATTEIGNABLE avant la correction A7
             de db.js : l'upsert du brouillon partait en premier et le trigger
             d'immuabilité le rejetait, si bien que Maria lisait « rien n'a été
             verrouillé » sur un mois pourtant bel et bien clôturé. */
          Kit.toast('Ce mois était déjà clôturé — depuis un autre appareil, sans doute.');
        } else {
          Kit.toast('Mois de ' + vue.contrat.prenom_enfant + ' clôturé');
        }
        return global.App.rafraichir();
      })
      .catch(function (e) {
        bouton.disabled = false;
        Kit.toast('Clôture impossible : ' + Kit.messageErreur(e) + ' Rien n’a été verrouillé.', true);
      });
  }

  global.UiDocument = { afficher: afficher, ENCART_RG06: ENCART_RG06 };
})(window);
