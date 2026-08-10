/* ============================================================================
   config.js — Configuration Supabase.

   SEUL fichier portant l'URL et la clé publique (§1 des specs). Pour migrer le
   projet vers un autre compte Supabase, c'est le SEUL fichier à modifier.

   La clé « publishable » (anon) est faite pour vivre côté navigateur : elle ne
   donne accès qu'à ce que les policies RLS autorisent (lot 2), et l'utilisatrice
   doit être authentifiée pour lire ou écrire quoi que ce soit. Elle peut donc
   figurer dans un dépôt public sans risque. NE JAMAIS mettre ici la clé
   « service_role » / secrète.
   ========================================================================= */
window.RECAP_MARIA_CONFIG = {
  SUPABASE_URL: 'https://exsllenakcbxfqasaupu.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_yqqBLOng_N6m5vNOvczEcA_gNoIyWia',

  /* LOT 15 — clé PUBLIQUE VAPID des notifications de rappel.

     Elle est publique par nature : le navigateur en a besoin pour s'abonner, et
     elle ne permet à personne d'envoyer quoi que ce soit. La clé PRIVÉE, elle,
     ne vit QUE dans les secrets de la fonction Supabase et ne doit JAMAIS
     figurer ici — un dépôt public conserve dans son historique git une clé
     committée, même supprimée ensuite.

     Tant que cette valeur est vide, l'abonnement n'est pas tenté : l'écran le
     dit en français, et la pastille de l'onglet Accueil — qui ne dépend
     d'aucune clé, d'aucune permission et d'aucun réseau — continue de faire le
     travail. */
  VAPID_PUBLIC_KEY: ''
};
