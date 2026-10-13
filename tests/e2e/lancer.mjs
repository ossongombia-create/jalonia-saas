// Parcours navigateur et matrice des autorisations, de bout en bout, depuis un dépôt propre :
//   npm run test:e2e      (= npm run build && node tests/e2e/lancer.mjs)
//
// 1. Base PostgreSQL NEUVE, préparée comme en production (deploy/preparer-base.sql, mots de passe tirés au sort),
//    migrations, superadministrateur créé par le VRAI script (scripts/creer-superadmin.ts), données de départ
//    (tests/e2e/preparer.ts) ;
// 2. serveur de production construit (.next/standalone), démarré sur un port libre, secrets tirés au sort ;
// 3. parties p1 à p7, sondes CSP, matrice des autorisations — l'une après l'autre, arrêt à la première erreur ;
// 4. journal du serveur relu après chaque partie : aucune erreur ;
// 5. tout est supprimé (base, rôles des organisations), même en cas d'échec.
//
// JAMAIS sur le serveur de production : refusé si /etc/jalonia/jalonia.env existe (comme les tests d'intégration ;
// deploy/preparer-base.sql redéfinit les mots de passe des rôles jalonia_owner et jalonia_app de l'instance).
// Ne pas lancer en même temps que « npm run test:integration » (même instance PostgreSQL, mêmes rôles).
//
// Variables (facultatives) :
//   PG_TEST_ADMIN_URL  superutilisateur PostgreSQL de test (défaut : celui des tests d'intégration) ;
//   E2E_PARTIES        sous-ensemble, ex. « p1,p2,autorisations » (p2 à p4 supposent p1 déjà passée) ;
//   E2E_CHROMIUM       Chromium déjà installé (sinon celui de Playwright : npx playwright install chromium) ;
//   E2E_SANS_QR=1      p7 sans décodage du code QR (sinon : python3 et opencv-python-headless requis) ;
//   E2E_GARDER=1       garder base et serveur à la fin (mise au point) : les accès sont affichés.
import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ICI = path.join(RACINE, "tests/e2e");
const ETAT = path.join(ICI, ".etat");
const TSX = path.join(RACINE, "node_modules/.bin/tsx");
const PARTIES = ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "sonde-csp", "sonde-csp-blocage", "autorisations"];
const SUPERADMIN = { email: "superadmin@e2e.test", nom: "Superadmin E2E", mdp: "superadmin-e2e-motdepasse" }; // (outils.cjs)
const MINUTES_PAR_PARTIE = 10;

const alea = (n) => randomBytes(n).toString("hex");
const titre = (t) => console.log(`\n━━━ ${t}`);

function urlPour(base, utilisateur, motDePasse, nomBase) {
  const u = new URL(base.toString());
  u.username = utilisateur;
  u.password = motDePasse;
  u.pathname = `/${nomBase}`;
  return u.toString();
}

/** Lance une commande ; échec si le code de sortie n'est pas 0 (ou au-delà du délai). */
function executer(commande, args, { env = {}, entree, delaiMinutes = 5 } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(commande, args, { cwd: RACINE, env: { ...process.env, ...env }, stdio: [entree === undefined ? "ignore" : "pipe", "inherit", "inherit"] });
    const minuterie = setTimeout(() => { p.kill("SIGKILL"); reject(new Error(`${path.basename(args[0] ?? commande)} : délai de ${delaiMinutes} min dépassé`)); }, delaiMinutes * 60_000);
    if (entree !== undefined) p.stdin.end(entree);
    p.on("error", (e) => { clearTimeout(minuterie); reject(e); });
    p.on("exit", (code, signal) => {
      clearTimeout(minuterie);
      if (code === 0) resolve();
      else reject(new Error(`${path.relative(RACINE, args[0] ?? commande)} : sortie ${code ?? signal}`));
    });
  });
}

function portLibre() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

async function attendreServeur(base, serveur) {
  const limite = Date.now() + 60_000;
  while (Date.now() < limite) {
    if (serveur.exitCode !== null) throw new Error(`le serveur s'est arrêté (code ${serveur.exitCode}) : voir ${path.relative(RACINE, path.join(ETAT, "serveur.log"))}`);
    try {
      const r = await fetch(`${base}/api/sante`);
      if (r.ok) return;
    } catch { /* pas encore prêt */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("le serveur n'a pas répondu en 60 s");
}

async function nettoyer(admin, nomBase) {
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    let roles = [];
    const existe = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [nomBase]);
    if (existe.rowCount) {
      const base = new pg.Client({ connectionString: urlPour(admin, admin.username, decodeURIComponent(admin.password), nomBase) });
      await base.connect();
      try {
        roles = (await base.query("SELECT role_name FROM platform.organisations")).rows.map((r) => r.role_name);
      } catch { /* migrations non appliquées : aucun rôle d'organisation */ } finally {
        await base.end();
      }
      await client.query(`DROP DATABASE IF EXISTS "${nomBase}" WITH (FORCE)`);
    }
    for (const r of roles) if (/^org_[0-9a-f]{12}_rw$/.test(r)) await client.query(`DROP ROLE IF EXISTS "${r}"`);
  } finally {
    await client.end();
  }
}

async function principal() {
  if (existsSync("/etc/jalonia/jalonia.env")) {
    throw new Error("refusé : ce poste ressemble au serveur de production (/etc/jalonia/jalonia.env existe).");
  }
  for (const f of [".next/standalone/server.js", ".next/server/server-reference-manifest.json"]) {
    if (!existsSync(path.join(RACINE, f))) throw new Error(`${f} absent : lancer « npm run test:e2e » (qui construit l'application d'abord).`);
  }
  const demandees = process.env.E2E_PARTIES ? process.env.E2E_PARTIES.split(",").map((s) => s.trim()).filter(Boolean) : PARTIES;
  for (const p of demandees) if (!PARTIES.includes(p)) throw new Error(`partie inconnue : ${p} (connues : ${PARTIES.join(", ")})`);

  const admin = new URL(process.env.PG_TEST_ADMIN_URL ?? "postgresql://jalonia_test_admin:jalonia_test_admin@127.0.0.1:5432/postgres");
  const nomBase = `jalonia_e2e_${alea(4)}`;
  const mdpProprietaire = alea(18);
  const mdpApplication = alea(18);
  const urlProprietaire = urlPour(admin, "jalonia_owner", mdpProprietaire, nomBase);
  const urlApplication = urlPour(admin, "jalonia_app", mdpApplication, nomBase);
  const garder = process.env.E2E_GARDER === "1";

  rmSync(ETAT, { recursive: true, force: true });
  mkdirSync(path.join(ETAT, "captures"), { recursive: true });

  let serveur = null;
  const bilan = [];
  let succes = false;
  try {
    titre(`base de test ${nomBase}`);
    execFileSync(
      "psql",
      [admin.toString(), "-q", "-v", "ON_ERROR_STOP=1", "-v", `nom_base=${nomBase}`, "-v", `mdp_proprietaire=${mdpProprietaire}`, "-v", `mdp_app=${mdpApplication}`, "-f", "deploy/preparer-base.sql"],
      { cwd: RACINE, stdio: ["ignore", "ignore", "inherit"] },
    );
    await executer(TSX, ["scripts/migrer.ts"], { env: { DATABASE_URL_PROPRIETAIRE: urlProprietaire } });
    const s = SUPERADMIN;
    await executer(TSX, ["scripts/creer-superadmin.ts"], { env: { DATABASE_URL_PROPRIETAIRE: urlProprietaire }, entree: `${s.email}\n${s.nom}\n${s.mdp}\n${s.mdp}\n` });
    console.log();
    const cleSecondFacteur = randomBytes(32).toString("base64");
    await executer(TSX, ["tests/e2e/preparer.ts"], { env: { DATABASE_URL: urlApplication, CLE_SECOND_FACTEUR: cleSecondFacteur } });

    titre("serveur de production (.next/standalone)");
    // Comme le déploiement (deploy/deployer.sh) : fichiers statiques à côté du serveur autonome.
    cpSync(path.join(RACINE, ".next/static"), path.join(RACINE, ".next/standalone/.next/static"), { recursive: true });
    cpSync(path.join(RACINE, "public"), path.join(RACINE, ".next/standalone/public"), { recursive: true });
    const port = await portLibre();
    const base = `http://localhost:${port}`;
    const journalServeur = openSync(path.join(ETAT, "serveur.log"), "w");
    serveur = spawn(process.execPath, [".next/standalone/server.js"], {
      cwd: RACINE,
      // Environnement minimal : rien d'autre que ce qu'aurait le service en production.
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        NODE_ENV: "production",
        PORT: String(port),
        HOSTNAME: "127.0.0.1",
        DATABASE_URL: urlApplication,
        AUTH_SECRET: randomBytes(32).toString("base64"),
        AUTH_URL: base,
        AUTH_TRUST_HOST: "true",
        FUSEAU_HORAIRE: "Africa/Douala",
        CLE_SECOND_FACTEUR: cleSecondFacteur,
      },
      stdio: ["ignore", journalServeur, journalServeur],
    });
    await attendreServeur(base, serveur);
    console.log(`✔ ${base}`);

    const envParties = { E2E_BASE: base, E2E_URL_PROPRIETAIRE: urlProprietaire, E2E_ETAT: ETAT };
    const fichierJournal = path.join(ETAT, "serveur.log");
    for (const p of demandees) {
      titre(p);
      const debut = Date.now();
      const debutJournal = statSync(fichierJournal).size;
      try {
        await executer(process.execPath, [path.join(ICI, `${p}.cjs`)], { env: envParties, delaiMinutes: MINUTES_PAR_PARTIE });
        // Journal du serveur pendant la partie : aucune erreur. (La matrice des autorisations provoque des refus
        // journalisés — cookie forgé, autre site — et contrôle elle-même son morceau de journal.)
        if (p !== "autorisations") {
          const lignes = readFileSync(fichierJournal).subarray(debutJournal).toString("utf8").split("\n");
          const suspectes = lignes.filter((l) => /error|⨯|exception|rejection|erreur inattendue/i.test(l));
          if (suspectes.length) {
            for (const l of suspectes.slice(0, 30)) console.error(`  ${l}`);
            throw new Error(`${p} : ${suspectes.length} ligne(s) d'erreur dans le journal du serveur (${path.relative(RACINE, fichierJournal)})`);
          }
        }
        bilan.push({ p, ok: true, s: (Date.now() - debut) / 1000 });
      } catch (e) {
        bilan.push({ p, ok: false, s: (Date.now() - debut) / 1000 });
        throw e;
      }
    }
    succes = true;
  } finally {
    if (bilan.length) {
      titre("bilan");
      for (const b of bilan) console.log(`${b.ok ? "✔" : "✘"} ${b.p.padEnd(20)} ${b.s.toFixed(1)} s`);
    }
    if (garder) {
      console.log(`\nE2E_GARDER=1 : serveur ${serveur ? `PID ${serveur.pid}` : "non démarré"}, base ${urlProprietaire}`);
      serveur?.unref();
    } else {
      if (serveur && serveur.exitCode === null) {
        serveur.kill("SIGTERM");
        await new Promise((r) => { serveur.once("exit", r); setTimeout(r, 5000); });
      }
      await nettoyer(admin, nomBase).catch((e) => console.error(`✘ nettoyage : ${e.message}`));
    }
  }
  if (!succes) process.exitCode = 1;
}

principal().catch((e) => {
  console.error(`\n✘ ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
