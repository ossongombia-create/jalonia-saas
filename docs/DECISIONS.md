# Décisions techniques — Jalonia SaaS

Ce fichier garde la trace des choix d'architecture et de leur raison, pour que personne n'ait à les deviner.

| Date | Décision | Raison |
|------|----------|--------|
| 2026-10-11 | **TypeScript de bout en bout** : Next.js 16 (App Router), Node.js | Un seul langage pour tout ; réutilise la logique du moteur Qualigramme (JavaScript). |
| 2026-10-11 | **PostgreSQL auto-hébergé** sur le VPS | Maîtrise des données ; pas de dépendance à un service tiers. |
| 2026-10-11 | **Auth.js v5** (`next-auth@5.0.0-beta.32`, version figée) | Demandé par Brice. La v5 reste étiquetée « beta » mais elle est maintenue et compatible Next 16 ; version figée pour éviter une mise à jour imprévue. |
| 2026-10-11 | **Schéma PostgreSQL par organisation** + **rôle PostgreSQL par organisation** | Isolation « étanche » : chaque requête d'une organisation s'exécute avec `SET LOCAL ROLE org_xxx_rw`, rôle qui n'a de droits que sur son propre schéma. Une erreur de code ne peut pas lire le schéma d'une autre organisation : PostgreSQL refuse. |
| 2026-10-11 | Rôle applicatif `jalonia_app` membre des rôles d'organisation **sans héritage** (`WITH INHERIT FALSE, SET TRUE`) | Sans `SET ROLE` explicite, l'application n'a AUCUN droit sur les schémas d'organisation (échec fermé). |
| 2026-10-11 | Rôle `jalonia_owner` réservé aux migrations et à la création d'organisations | L'application courante n'a pas le droit de créer des schémas ou des rôles. |
| 2026-10-11 | **Migrations SQL écrites à la main** (une seule source de vérité) + Drizzle comme constructeur de requêtes typé | Les rôles, droits et déclencheurs ne s'expriment pas avec les migrations générées ; un test vérifie que les définitions Drizzle correspondent à la base réelle. |
| 2026-10-11 | **Journal d'audit en ajout seul** (déclencheurs qui refusent UPDATE, DELETE, TRUNCATE ; droits SELECT/INSERT seulement) | Traçabilité inaltérable des opérations sensibles. |
| 2026-10-11 | Sessions Auth.js en **JWT** + table `platform.sessions` vérifiée à **chaque requête** | Le fournisseur « identifiants » d'Auth.js impose le JWT ; la table permet de suivre la durée, l'adresse IP et de **révoquer** une session. |
| 2026-10-11 | Mots de passe **argon2id** (19 Mio, t=2, p=1 — recommandations OWASP), verrouillage 15 min après 5 échecs | Standard actuel de stockage des mots de passe. |
| 2026-10-11 | **Un seul nom de domaine** ; l'organisation active est déduite de l'adhésion de l'utilisateur | Évite les certificats « wildcard » et la configuration DNS par client. |
| 2026-10-11 | `cacheComponents` **désactivé** (option de Next 16) | Application d'administration entièrement dynamique ; ce mode impose des contraintes (frontières `<Suspense>`, erreurs de compilation sur la lecture des cookies) sans bénéfice ici. **À adopter lors du passage à Next 17**, où il deviendra le comportement par défaut. |
| 2026-10-11 | Le proxy (`src/proxy.ts`) ne fait qu'une redirection « optimiste » ; **chaque page et chaque action serveur revérifie** l'authentification et les droits | Recommandation explicite de la documentation Next.js 16 (Data Security). |
| 2026-10-11 | Police Outfit **embarquée** (pas de téléchargement Google à la compilation) | Compilation sans dépendance réseau externe. |
| 2026-10-11 | Alerte `npm audit` sur `braces` (via `eslint-config-next`) **acceptée** | Concerne uniquement l'outil de vérification du code, jamais l'application en production ; aucune version corrigée n'existe. `npm audit --omit=dev` = 0 vulnérabilité. |
