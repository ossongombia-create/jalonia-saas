// Préparation des tests d'intégration : une VRAIE base PostgreSQL, créée pour la séance puis supprimée.
//
// Elle est préparée exactement comme en production : script deploy/preparer-base.sql (rôles, base, droits),
// puis les migrations. À lancer sur un poste de développement ou en intégration continue — JAMAIS sur le
// serveur de production (le script redéfinit les mots de passe des rôles jalonia_owner et jalonia_app).
//
// Variable attendue : PG_TEST_ADMIN_URL, connexion d'un superutilisateur PostgreSQL de test.
//   Par défaut : postgresql://jalonia_test_admin:jalonia_test_admin@127.0.0.1:5432/postgres
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { Client, Pool } from "pg";
import type { TestProject } from "vitest/node";
import { migrer } from "../../src/server/migrations/lanceur";

declare module "vitest" {
  export interface ProvidedContext {
    urlApplication: string;
    urlProprietaire: string;
  }
}

const MDP_PROPRIETAIRE = "test-proprietaire-jalonia";
const MDP_APPLICATION = "test-application-jalonia";

function urlPour(base: URL, utilisateur: string, motDePasse: string, nomBase: string): string {
  const u = new URL(base.toString());
  u.username = utilisateur;
  u.password = motDePasse;
  u.pathname = `/${nomBase}`;
  return u.toString();
}

export default async function preparer(project: TestProject) {
  if (existsSync("/etc/jalonia/jalonia.env")) {
    throw new Error("Tests d'intégration refusés : ce poste ressemble au serveur de production (/etc/jalonia/jalonia.env existe).");
  }
  const admin = new URL(process.env.PG_TEST_ADMIN_URL ?? "postgresql://jalonia_test_admin:jalonia_test_admin@127.0.0.1:5432/postgres");
  const nomBase = `jalonia_test_${randomBytes(4).toString("hex")}`;

  // 1. Rôles et base, avec le script d'installation réel.
  execFileSync(
    "psql",
    [admin.toString(), "-q", "-v", "ON_ERROR_STOP=1", "-v", `nom_base=${nomBase}`, "-v", `mdp_proprietaire=${MDP_PROPRIETAIRE}`, "-v", `mdp_app=${MDP_APPLICATION}`, "-f", "deploy/preparer-base.sql"],
    { stdio: ["ignore", "ignore", "inherit"] },
  );

  const urlProprietaire = urlPour(admin, "jalonia_owner", MDP_PROPRIETAIRE, nomBase);
  const urlApplication = urlPour(admin, "jalonia_app", MDP_APPLICATION, nomBase);

  // 2. Migrations, comme en production.
  const pool = new Pool({ connectionString: urlProprietaire, max: 1 });
  try {
    await migrer(pool, path.resolve("."));
  } finally {
    await pool.end();
  }

  project.provide("urlApplication", urlApplication);
  project.provide("urlProprietaire", urlProprietaire);

  // 3. Nettoyage : la base de test et les rôles des organisations créées pendant les tests.
  return async () => {
    const client = new Client({ connectionString: admin.toString() });
    await client.connect();
    try {
      const base = new Client({ connectionString: urlPour(admin, admin.username, decodeURIComponent(admin.password), nomBase) });
      await base.connect();
      let roles: string[] = [];
      try {
        roles = (await base.query<{ role_name: string }>("SELECT role_name FROM platform.organisations")).rows.map((r) => r.role_name);
      } finally {
        await base.end();
      }
      await client.query(`DROP DATABASE IF EXISTS "${nomBase}" WITH (FORCE)`);
      for (const r of roles) {
        if (/^org_[0-9a-f]{12}_rw$/.test(r)) await client.query(`DROP ROLE IF EXISTS "${r}"`);
      }
    } finally {
      await client.end();
    }
  };
}
