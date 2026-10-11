// Lanceur de migrations SQL.
//   db/migrations/plateforme/NNNN_nom.sql   : appliquées une fois au schéma « platform ».
//   db/migrations/organisation/NNNN_nom.sql : gabarit appliqué à CHAQUE organisation (et à toute nouvelle).
// Exécuté par le rôle propriétaire (jalonia_owner). Chaque fichier passe dans sa propre transaction et
// n'est appliqué qu'une fois (suivi dans platform.migrations et platform.migrations_organisation).
// Un verrou consultatif empêche deux lancements simultanés.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Pool, PoolClient } from "pg";
import { citer, verifierOrganisationTechnique, type OrganisationTechnique } from "../db/identifiants";

export interface Migration {
  nom: string;
  sql: string;
}

const MOTIF_FICHIER = /^\d{4}_[a-z0-9_]+\.sql$/;
const VERROU_MIGRATIONS = 7_041_993; // numéro arbitraire, propre à Jalonia

/** Lit les fichiers de migration d'un dossier, triés par nom (donc par numéro). */
export async function lireMigrations(dossier: string): Promise<Migration[]> {
  const fichiers = (await readdir(dossier)).filter((f) => MOTIF_FICHIER.test(f)).sort();
  return Promise.all(fichiers.map(async (nom) => ({ nom, sql: await readFile(path.join(dossier, nom), "utf8") })));
}

/** Remplace {{schema}} et {{role}} par les identifiants (validés) de l'organisation. */
export function preparerPourOrganisation(sql: string, org: OrganisationTechnique): string {
  verifierOrganisationTechnique(org);
  const resultat = sql.replaceAll("{{schema}}", citer(org.schemaName)).replaceAll("{{role}}", citer(org.roleName));
  const reste = resultat.match(/\{\{[^}]*\}\}/);
  if (reste) throw new Error(`Paramètre de gabarit inconnu : ${reste[0]}`);
  return resultat;
}

/** Crée (si besoin) le schéma « platform » et les tables de suivi. Idempotent. */
async function amorcer(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE SCHEMA IF NOT EXISTS platform;
    CREATE TABLE IF NOT EXISTS platform.migrations (
      nom text PRIMARY KEY,
      appliquee_le timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS platform.migrations_organisation (
      schema_name text NOT NULL,
      nom text NOT NULL,
      appliquee_le timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (schema_name, nom)
    );
  `);
}

/**
 * Applique à UNE organisation les migrations de gabarit qui lui manquent.
 * Doit être appelée dans une transaction déjà ouverte (par le lanceur ou par la création d'organisation).
 */
export async function appliquerMigrationsOrganisation(client: PoolClient, org: OrganisationTechnique, migrations: Migration[]): Promise<string[]> {
  const deja = await client.query<{ nom: string }>("SELECT nom FROM platform.migrations_organisation WHERE schema_name = $1", [org.schemaName]);
  const appliquees = new Set(deja.rows.map((r) => r.nom));
  const nouvelles: string[] = [];
  for (const m of migrations) {
    if (appliquees.has(m.nom)) continue;
    await client.query(preparerPourOrganisation(m.sql, org));
    await client.query("INSERT INTO platform.migrations_organisation (schema_name, nom) VALUES ($1, $2)", [org.schemaName, m.nom]);
    nouvelles.push(m.nom);
  }
  return nouvelles;
}

export interface RapportMigrations {
  plateforme: string[];
  organisations: Record<string, string[]>;
}

/** Applique toutes les migrations manquantes : la plateforme d'abord, puis chaque organisation. */
export async function migrer(poolProprietaire: Pool, racine: string): Promise<RapportMigrations> {
  const plateforme = await lireMigrations(path.join(racine, "db/migrations/plateforme"));
  const organisation = await lireMigrations(path.join(racine, "db/migrations/organisation"));
  const rapport: RapportMigrations = { plateforme: [], organisations: {} };

  const client = await poolProprietaire.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [VERROU_MIGRATIONS]);
    try {
      await amorcer(client);

      const deja = await client.query<{ nom: string }>("SELECT nom FROM platform.migrations");
      const appliquees = new Set(deja.rows.map((r) => r.nom));
      for (const m of plateforme) {
        if (appliquees.has(m.nom)) continue;
        await client.query("BEGIN");
        try {
          await client.query("SELECT set_config('search_path', '', true)");
          await client.query(m.sql);
          await client.query("INSERT INTO platform.migrations (nom) VALUES ($1)", [m.nom]);
          await client.query("COMMIT");
        } catch (erreur) {
          await client.query("ROLLBACK");
          throw new Error(`Échec de la migration plateforme ${m.nom} : ${(erreur as Error).message}`);
        }
        rapport.plateforme.push(m.nom);
      }

      const orgs = await client.query<{ schema_name: string; role_name: string }>(
        "SELECT schema_name, role_name FROM platform.organisations ORDER BY cree_le, id",
      );
      for (const o of orgs.rows) {
        const org = { schemaName: o.schema_name, roleName: o.role_name };
        await client.query("BEGIN");
        try {
          await client.query("SELECT set_config('search_path', '', true)");
          const nouvelles = await appliquerMigrationsOrganisation(client, org, organisation);
          await client.query("COMMIT");
          if (nouvelles.length) rapport.organisations[org.schemaName] = nouvelles;
        } catch (erreur) {
          await client.query("ROLLBACK");
          throw new Error(`Échec de la migration de l'organisation ${org.schemaName} : ${(erreur as Error).message}`);
        }
      }
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [VERROU_MIGRATIONS]);
    }
  } finally {
    client.release();
  }
  return rapport;
}
