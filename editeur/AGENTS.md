# Contrat de l'agent — éditeur Qualigramme (`editeur/`)

Ce fichier dit à un agent (ou à une personne) ce qu'il doit savoir avant de modifier l'éditeur. Il complète
`AGENTS.md` à la racine du dépôt ; en cas de doute, les tests font foi : `tests/v170.test.mjs` vérifie que ce
fichier reste à jour.

## Règles héritées de la racine

- Le bloc de `AGENTS.md` à la racine concerne **Next.js 16** (application web, `src/`) : lire le guide voulu dans
  `node_modules/next/dist/docs/` avant d'écrire du code Next.js et tenir compte des avertissements de dépréciation.
  Ce bloc est réécrit par `next dev` (`node_modules/next/dist/server/lib/generate-agent-files.js`).
- L'éditeur, lui, **n'est pas du code Next.js** : JavaScript sans dépendance, utilisable seul (ouvrir `index.html`).
  `scripts/copier-editeur.mjs` le copie dans `public/editeur/` à chaque `npm run build` / `npm run dev`
  (`index.html`, les deux guides, `LICENCES-TIERS.md`, `css`, `js`, `img`, `vendor` ; ni `tests` ni ce fichier)
  et pose `<html data-mode="en-ligne">`. Ne jamais modifier `public/editeur/` : c'est une copie générée.

## Règles de l'éditeur (vérifiées par les tests)

- **Neutralité** : aucun nom d'entreprise réelle, de lieu ni de code qui lui soit propre, dans le code, les textes, les
  exemples et les guides (`tests/neutralite.mjs`, balayage de tout l'arbre dans `tests/v026.test.mjs`).
- **Textes FR / EN** : toute clé existe dans `js/locales/fr.js` **et** `js/locales/en.js`, avec les mêmes variables
  `{…}` ; les deux fichiers ont exactement les mêmes clés (`tests/v015.test.mjs`, `tests/v170.test.mjs`).
- **Séparation des rôles** : le moteur de règles (`rules.js`, `rules-it.js`, `rules-codes.js`) ne dessine rien ; le
  dessin (`render.js`, `render3.js`, `carto-dessin.js`) ne vérifie rien. `model.js` et `document.js` ignorent le
  questionnement (`tests/v130.test.mjs`).
- **Jamais de HTML injecté** : ni `innerHTML`, ni `outerHTML`, ni `insertAdjacentHTML`, ni `document.write` ; tout
  passe par `h()` (`js/dom.js`) et `textContent`. Tout fichier ouvert ou importé est une donnée non fiable, nettoyée
  champ par champ (`nettoyer()` dans `js/store.js`).
- **Nom de l'outil** : écrit seulement dans `js/config.js` (`nomOutil`) ; ailleurs on utilise `{nom}`. Seuls les deux
  guides et le README le reprennent en toutes lettres (un test signale un oubli).
- **Licence propriétaire** (depuis la v1.7) : « © 2026 Brice Ossongombia — tous droits réservés. Utilisation soumise à
  contrat. » Plus aucune mention « version d'essai » ni « non commerciale ». Le texte complet est dans `LICENSE` à la
  racine du dépôt.
- **Version** : `js/version.js` porte le numéro de la **dernière entrée** de `CHANGELOG.md` (`tests/v021.test.mjs`) ;
  les deux changent dans le même commit.
- **Nouvelle fonctionnalité = nouveau fichier de test** dans `tests/`. Le nommage `vXYZ.test.mjs` a servi jusqu'à la
  v1.3, puis a été abandonné au profit de noms de fonctionnalité : v1.4 = `synchro.test.mjs` + `en-ligne.test.mjs`,
  v1.5 = `bpmn.test.mjs` (v1.6 n'a pas ajouté de test à l'éditeur). Exception : `v170.test.mjs` vérifie la
  documentation et la licence de la v1.7.
- **Compatibilité** : un fichier `.json` ou Word enregistré par une version précédente doit toujours s'ouvrir, et la
  signature de validation d'un document déjà validé ne doit pas changer.

## État actuel

- Version : `VERSION = "1.7"` (`js/version.js`).
- Tests à la v1.7 : **780 tests automatisés** = 486 éditeur (477 + 9) + 133 unitaires + 161 intégration ; plus
  les contrôles BPMN (7/7 fichiers conformes au schéma XSD de l'OMG, 6/6 ouverts sans avertissement par bpmn-js)
  et 16/16 parties du parcours navigateur (dont la matrice des autorisations : 40 actions × 9 profils, 323 appels
  forgés).

## Prérequis

| Pour | Il faut |
|---|---|
| Tous les tests | Node.js **≥ 22.22** (`tls.setDefaultCACertificates`, utilisé par `tests/integration/courriel.test.ts`) ; CI et serveur : Node 24 |
| `test:integration` | **PostgreSQL 16** et un superutilisateur de test (`PG_TEST_ADMIN_URL`, par défaut `jalonia_test_admin`), **openssl** (certificat du faux serveur SMTP) |
| `test:e2e` | PostgreSQL 16, **Chromium** (Playwright, ou `E2E_CHROMIUM`), python3 + opencv pour la partie 7 (ou `E2E_SANS_QR=1`) |
| `test:bpmn` | python3 + lxml, accès à PyPI (schéma XSD), Chromium |

Les tests d'intégration et le parcours navigateur refusent de tourner sur le serveur de production
(`/etc/jalonia/jalonia.env` présent).

## Commandes (depuis la racine du dépôt)

```bash
npm run test:editeur       # node --test "editeur/tests/*.test.mjs"
npm run test:unit          # vitest, sans base
npm run test:bpmn          # schéma XSD officiel + ouverture dans bpmn-js
npm run test:integration   # vraie base PostgreSQL, créée puis supprimée
npm run test:e2e           # construction, parcours navigateur, matrice des autorisations
npm run typecheck
npm run lint
```

Recette de la CI (`.github/workflows/verifications.yml`, à chaque envoi sur `main` et à chaque demande de fusion) :
service `postgres:16`, Node 24, `npm ci`, puis `typecheck`, `lint`, `test:unit`, `test:editeur`, `test:integration`,
installation de Chromium, `test:bpmn`, `test:e2e`.

## Stratégie de release

- Plus de dossier `versions/` : depuis le Module 6, Git garde l'historique. Chaque release est un tag Git annoté `vX.Y` sur `main`
  (par exemple `git tag -a v1.7 -m "Jalonia v1.7"`).
- Une release = une entrée en tête de `CHANGELOG.md` + `js/version.js` au même numéro + toutes les familles de tests
  vertes (ci-dessus), dans cet ordre, puis le tag.

## Environnement cloud (proxy GitHub)

- Dans une session cloud, le proxy GitHub **accepte les push de branches** (`git push origin <branche>`, `main`
  compris) mais **refuse les push de tags** : `git push origin vX.Y` échoue avec HTTP 403. C'est une politique d'accès,
  pas une panne : ne pas réessayer ni contourner.
- Les tags de release se créent donc **hors de la session cloud** : depuis un poste local (`git tag -a vX.Y <commit>
  -m "…"` puis `git push origin vX.Y`), ou dans l'interface web GitHub (**Releases → Draft a new release**, en
  choisissant le tag et le commit cible).
- La release **v1.7** a été créée via l'interface web sur le commit `0d06bca` (contenu identique à la fusion `32a3073`
  sur `main`). L'interface web crée un tag **léger** (sans objet tag annoté) : `git ls-remote --tags origin` montre
  `refs/tags/v1.7` → `0d06bca`. Un tag annoté `v1.7` créé localement dans une session cloud n'a pas été publié ; avant
  de créer un tag localement, faire `git fetch --tags origin` pour partir de celui de GitHub.
