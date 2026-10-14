# Jalonia — application multi-organisations

Jalonia produit la documentation des processus selon le **langage Qualigramme** (cartographie de niveau 1,
procédures de niveau 2, instructions de travail de niveau 3). Cette version est une **application web
multi-organisations** (SaaS interne) : chaque organisation dispose de son propre espace de données, isolé
des autres par PostgreSQL lui-même.

## État d'avancement

| Incrément | Contenu | État |
|---|---|---|
| 1 — Socle | Connexion, sessions suivies et révocables, superadmin (organisations, utilisateurs, sessions, journal d'audit, matrice des droits), espace organisation (membres, rôles, journal), isolation par schéma et rôle PostgreSQL, français / anglais | ✔ |
| 2 — Documents Qualigramme | L'éditeur d'origine (cartographie N1 et fiches, procédures N2, instructions N3, logigramme, export et import Word, PDF, questionnement avec « sans objet », synthèse, modèles) en ligne : documents et cartographie enregistrés automatiquement dans l'espace de l'organisation, versions et conflits gérés, lecture seule selon le rôle, suppression tracée | ✔ |
| 3 — Cycle de vie | Versions, vérification, approbation, publication, archivage, revues périodiques, notifications dans l'application et traçabilité | ✔ |
| 4 — Pilotage | Risques / opportunités issus des documents, plan d'actions, objectifs et mesures d'indicateurs, tableaux de bord | ✔ |
| 5 — Exploitation | Tâches quotidiennes (revues et rappels) | ✔ |
| 5 — Exploitation (à compléter) | Mode maintenance, envoi d'e-mails (SMTP), sauvegardes hors serveur et restauration vérifiée, observabilité | à faire |

## Technique

- **Next.js 16** (App Router, TypeScript strict), sortie autonome (`output: "standalone"`).
- **PostgreSQL ≥ 16**, auto-hébergé. Requêtes SQL **paramétrées** avec `pg` (pas d'ORM, voir `docs/DECISIONS.md`).
- **Auth.js v5** (identifiants e-mail + mot de passe), sessions vérifiées en base à chaque requête.
- Mots de passe **argon2id** ; verrouillage 15 min après 5 échecs.
- Isolation : un **schéma** et un **rôle PostgreSQL** par organisation ; l'application n'accède aux données
  d'une organisation qu'après `SET LOCAL ROLE` vers le rôle de cette organisation.
- Journaux d'audit **en ajout seul** (plateforme et organisation).

```
src/
  app/            pages (connexion, /plateforme = superadmin, /app = espace organisation)
  actions/        actions serveur (chacune revérifie l'identité et les droits)
  components/     composants d'interface
  lib/            code partagé : rôles et droits (rbac.ts), validation, traductions (i18n/)
  server/         accès aux données : base, authentification, organisations, membres, documents, audit…
editeur/          l'éditeur Qualigramme d'origine (JavaScript, sans dépendance) et ses tests (node --test)
                  → copié dans public/editeur/ à chaque « npm run build » / « npm run dev », en mode « en ligne »
db/migrations/
  plateforme/     schéma « platform » (appliqué une fois)
  organisation/   gabarit appliqué à CHAQUE organisation
deploy/           installation et mise à jour du VPS (voir deploy/INSTALL-VPS.md)
scripts/          migrations, création du superadmin
tests/            tests unitaires et d'intégration (vraie base PostgreSQL)
```

## Développement local

Prérequis : Node.js ≥ 22.12, PostgreSQL ≥ 16.

```bash
npm ci
# Base locale : rôles et base « jalonia » (mots de passe de votre choix)
sudo -u postgres psql -v ON_ERROR_STOP=1 -v nom_base=jalonia -v mdp_proprietaire=dev-proprietaire -v mdp_app=dev-application < deploy/preparer-base.sql
cp .env.example .env.local   # renseigner les deux mots de passe, AUTH_SECRET et AUTH_URL=http://localhost:3000
npx tsx --env-file=.env.local scripts/migrer.ts
npx tsx --env-file=.env.local scripts/creer-superadmin.ts
npm run dev
```

## Vérifications

```bash
npm run typecheck          # types
npm run lint               # règles de code
npm run test:unit          # tests unitaires
npm run test:editeur       # tests de l'éditeur Qualigramme (node --test)
npm run test:integration   # tests sur une vraie base PostgreSQL
npm run test:e2e           # construction, puis parcours navigateur et matrice des autorisations
```

L'éditeur (`editeur/`) reste utilisable seul, en local : ouvrir `editeur/index.html` (brouillon dans le
navigateur, enregistrement en fichier .json). Dans l'application web, la copie `public/editeur/` porte
`<html data-mode="en-ligne">` : le document et la cartographie viennent du serveur et y sont enregistrés.

Les tests d'intégration créent une base PostgreSQL temporaire (puis la suppriment). Ils ont besoin d'un
superutilisateur PostgreSQL **de test** (variable `PG_TEST_ADMIN_URL`, par défaut
`postgresql://jalonia_test_admin:jalonia_test_admin@127.0.0.1:5432/postgres`). À lancer sur un poste de
développement uniquement : ils refusent de s'exécuter sur le serveur de production.

`npm run test:e2e` construit l'application, crée sa propre base de test (même `PG_TEST_ADMIN_URL`), démarre le
serveur de production construit sur un port libre, joue les parcours navigateur (`tests/e2e/p1.cjs` à `p13.cjs`), les
sondes de la politique de sécurité du contenu et la matrice des autorisations (`tests/e2e/autorisations.cjs` : toutes
les actions serveur appelées directement par huit profils), puis supprime tout. Prérequis : `psql`, Chromium de
Playwright (`npx playwright install chromium`), et pour le décodage du code QR de la partie 7, `python3` avec
`opencv-python-headless` (sinon `E2E_SANS_QR=1`, signalé dans la sortie). Ne pas le lancer en même temps que les
tests d'intégration (mêmes rôles PostgreSQL). Captures et journal du serveur : `tests/e2e/.etat/`. Les mêmes
vérifications tournent à chaque envoi sur GitHub (`.github/workflows/verifications.yml`).

## Installation sur le serveur

Voir **[deploy/INSTALL-VPS.md](deploy/INSTALL-VPS.md)**. Mise à jour : `sudo jalonia-deployer` (installation faite avec les instructions précédentes : appliquer d'abord, une fois, la section « Durcissement d'une installation existante »).
