# Configuration Supabase — BoutiquePro

Cette branche ajoute la première base d'authentification SaaS. Les migrations ne sont pas appliquées automatiquement au projet Supabase de production.

## 1. Variables d'environnement Next.js

Créer un fichier `.env.local` à la racine du projet (ne jamais le committer) avec :

```env
NEXT_PUBLIC_SUPABASE_URL=https://VOTRE_PROJET.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=VOTRE_CLE_PUBLISHABLE
NEXT_PUBLIC_SITE_URL=http://localhost:3000
DATABASE_URL=VOTRE_URL_POOLER_TRANSACTION
DIRECT_URL=VOTRE_URL_POOLER_SESSION
```

La clé publishable est destinée au navigateur et ne remplace jamais les règles RLS. Ne jamais placer une clé `service_role` dans une variable `NEXT_PUBLIC_`, dans le navigateur ou dans GitHub.

## 2. Authentification par e-mail

Dans Supabase Dashboard → Authentication → URL Configuration :

- Site URL : l'URL publique de l'application.
- Redirect URLs : ajouter `http://localhost:3000/auth/callback` pour le développement.
- Avant la mise en production, ajouter aussi l'URL HTTPS réelle suivie de `/auth/callback`.

Le parcours créé est : inscription → confirmation d'e-mail → callback sécurisé → création atomique de la boutique et du rôle OWNER → tableau de bord.

## 3. Migrations SQL

Les migrations sont ordonnées ainsi :

1. `20261105080000_initial_schema` : tables et types PostgreSQL.
2. `20261105090000_enable_tenant_rls` : politiques RLS et fonction sécurisée de création de boutique.

La seconde migration suppose que Supabase Auth est disponible (schéma `auth`, fonction `auth.uid()`, rôle `authenticated`). Elle doit être exécutée avec un rôle de migration privilégié, après revue du résultat CI. Ne pas coller les secrets dans une conversation.

## 4. Isolation des boutiques

- Chaque ligne opérationnelle contient un `shopId`.
- Les politiques RLS vérifient l'appartenance via `shop_memberships`.
- Le navigateur ne peut pas s'ajouter lui-même à une boutique ni modifier les rôles.
- La fonction `create_shop_for_current_user` attribue le rôle OWNER à l'identité authentifiée par Supabase.
- Les règles STAFF/MANAGER/OWNER plus fines et les validations métier devront être complétées avant la mise en production.

## 5. État actuel et limites

Cette livraison pose l'authentification, l'onboarding initial et l'isolation des lignes PostgreSQL. Les modules de ventes, stock, clients, crédits et dépenses utilisent encore leur stockage IndexedDB local : leur migration et leur synchronisation vers PostgreSQL restent à réaliser. Le mode hors ligne et la résolution des conflits ne sont donc pas encore connectés au compte SaaS.

Avant toute ouverture publique : exécuter les migrations après validation, configurer les URL Auth, renseigner les variables locales et de l'hébergeur, puis tester deux comptes sur deux boutiques distinctes.
