// Fin de contrat d'une organisation (décisions n° 3 et n° 6 du 19/10/2026) : export complet de ses données, puis
// suppression définitive. Réservé au rôle PROPRIÉTAIRE de la base (scripts/exporter-organisation.ts et
// scripts/supprimer-organisation.ts, lancés sur le serveur) : l'application en service n'a aucun de ces droits.
//
// Export : un seul fichier JSON, lu dans un instantané cohérent (transaction REPEATABLE READ en lecture seule) :
//   - TOUTES les tables du schéma de l'organisation, lues dans le catalogue (une table ajoutée par une migration
//     future est exportée sans changer ce code) : documents, versions, décisions, cartographie, plan d'actions,
//     objectifs et mesures des indicateurs, notifications, paramètres, journal ;
//   - ses lignes dans les tables communes : l'organisation, ses membres (nom, e-mail, rôles — jamais de mot de passe
//     ni de secret), ses invitations (sans l'empreinte du jeton), ses accès d'urgence, ses entrées du journal de la
//     plateforme, ses migrations.
//   L'export est tracé dans les deux journaux (ORGANISATION_EXPORTEE).
//
// Suppression : tout ou rien, dans une seule transaction, et seulement si
//   - le nom de l'organisation a été retapé à l'identique (confirmation) ;
//   - l'organisation est SUSPENDUE (on ne supprime pas une organisation en service) ;
//   - un export a été fait APRÈS sa suspension (rien n'a pu changer depuis).
// Elle retire le schéma (DROP SCHEMA … CASCADE), le rôle PostgreSQL de l'organisation, et ses lignes des tables
// communes (organisation, adhésions, invitations, accès d'urgence, migrations ; les sessions ouvertes perdent
// simplement leur organisation). Les AUTRES organisations ne sont jamais touchées.
// Restent, volontairement : le journal de la plateforme (en ajout seul et chaîné : effacer des lignes casserait la
// chaîne ; il ne contient que les opérations, jamais le contenu des documents), où la suppression est elle-même
// tracée (ORGANISATION_SUPPRIMEE) ; et les comptes des personnes (ils peuvent servir dans d'autres organisations) :
// ceux qui n'appartiennent plus à aucune organisation sont listés pour que l'exploitant décide de leur sort.
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import type { Pool, PoolClient } from "pg";
import { journaliserOrganisation, journaliserPlateforme, type EntreeJournal } from "../audit/journal";
import { enTransaction } from "../db/transactions";
import { citer, verifierOrganisationTechnique } from "../db/identifiants";

/** Format du fichier d'export (à changer si sa structure change). */
export const FORMAT_EXPORT = "jalonia-export-organisation/1";

/** Acteur des entrées de journal écrites par les scripts de fin de contrat. */
const ACTEUR = "ligne-de-commande";

export class ErreurFinDeContrat extends Error {}

export interface OrganisationVisee {
  id: string;
  nom: string;
  slug: string;
  statut: "active" | "suspendue";
  schemaName: string;
  roleName: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** L'organisation désignée par son identifiant OU son identifiant court (slug) ; erreur si elle n'existe pas. */
export async function trouverOrganisation(client: PoolClient, reference: string, verrou = false): Promise<OrganisationVisee> {
  const ref = reference.trim();
  if (ref === "") throw new ErreurFinDeContrat("Organisation à préciser : --organisation <identifiant ou identifiant court>.");
  const r = await client.query<{ id: string; nom: string; slug: string; statut: "active" | "suspendue"; schema_name: string; role_name: string }>(
    `SELECT id, nom, slug, statut, schema_name, role_name FROM platform.organisations
      WHERE ${UUID.test(ref) ? "id = $1::uuid" : "slug = $1"}${verrou ? " FOR UPDATE" : ""}`,
    [ref],
  );
  const o = r.rows[0];
  if (!o) throw new ErreurFinDeContrat(`Organisation introuvable : « ${ref} ». Rien n'a été fait.`);
  const org = { id: o.id, nom: o.nom, slug: o.slug, statut: o.statut, schemaName: o.schema_name, roleName: o.role_name };
  verifierOrganisationTechnique(org); // noms de schéma et de rôle au format attendu, avant tout SQL dynamique
  return org;
}

/** Transaction en lecture seule sur un instantané cohérent (REPEATABLE READ), chemin de recherche vidé. */
async function enInstantane<T>(pool: Pool, travail: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SELECT set_config('search_path', '', true)");
    const resultat = await travail(client);
    await client.query("COMMIT");
    return resultat;
  } finally {
    await client.query("ROLLBACK").catch(() => undefined); // sans effet après COMMIT ; annule après une erreur
    client.release();
  }
}

/** Tables du schéma de l'organisation, lues dans le catalogue (ordre alphabétique). */
async function tablesDe(client: PoolClient, schema: string): Promise<string[]> {
  const r = await client.query<{ nom: string }>(
    "SELECT table_name AS nom FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE' ORDER BY table_name",
    [schema],
  );
  return r.rows.map((l) => l.nom);
}

async function lignes(client: PoolClient, sql: string, parametres: unknown[] = []): Promise<unknown[]> {
  return (await client.query<{ l: unknown }>(sql, parametres)).rows.map((x) => x.l);
}

export interface ExportOrganisation {
  format: typeof FORMAT_EXPORT;
  exporteLe: string;
  organisation: Record<string, unknown>;
  plateforme: {
    membres: unknown[];
    invitations: unknown[];
    accesUrgence: unknown[];
    journal: unknown[];
    migrations: unknown[];
  };
  /** Nombre de lignes par table du schéma de l'organisation. */
  comptes: Record<string, number>;
  tables: Record<string, unknown[]>;
}

/** Lit toutes les données de l'organisation dans un instantané cohérent (rien n'est écrit). */
export async function lireExport(pool: Pool, reference: string): Promise<{ organisation: OrganisationVisee; donnees: ExportOrganisation }> {
  return enInstantane(pool, async (client) => {
    const org = await trouverOrganisation(client, reference);
    const tables: Record<string, unknown[]> = {};
    const comptes: Record<string, number> = {};
    for (const table of await tablesDe(client, org.schemaName)) {
      // row_to_json : dates en ISO 8601, binaires en hexadécimal ; ordre stable (première colonne de la table).
      const premiere = (await client.query<{ c: string }>(
        "SELECT column_name AS c FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND ordinal_position = 1",
        [org.schemaName, table],
      )).rows[0]!.c;
      tables[table] = await lignes(client, `SELECT row_to_json(t) AS l FROM ${citer(org.schemaName)}.${citer(table)} t ORDER BY t.${citer(premiere)}`);
      comptes[table] = tables[table].length;
    }
    const donnees: ExportOrganisation = {
      format: FORMAT_EXPORT,
      exporteLe: new Date().toISOString(),
      organisation: (await lignes(client, "SELECT row_to_json(o) AS l FROM platform.organisations o WHERE id = $1", [org.id]))[0] as Record<string, unknown>,
      plateforme: {
        membres: await lignes(client,
          `SELECT json_build_object('utilisateurId', u.id, 'email', u.email, 'nom', u.nom, 'statutCompte', u.statut, 'adhesion', to_jsonb(a) - 'utilisateur_id' - 'organisation_id') AS l
             FROM platform.adhesions a JOIN platform.utilisateurs u ON u.id = a.utilisateur_id WHERE a.organisation_id = $1 ORDER BY u.email`, [org.id]),
        invitations: await lignes(client, "SELECT to_jsonb(i) - 'jeton_empreinte' AS l FROM platform.invitations i WHERE organisation_id = $1 ORDER BY cree_le, id", [org.id]),
        accesUrgence: await lignes(client, "SELECT to_jsonb(x) AS l FROM platform.acces_urgence x WHERE organisation_id = $1 ORDER BY ouvert_le, id", [org.id]),
        journal: await lignes(client, "SELECT row_to_json(j) AS l FROM platform.journal j WHERE organisation_id = $1 ORDER BY id", [org.id]),
        migrations: await lignes(client, "SELECT row_to_json(m) AS l FROM platform.migrations_organisation m WHERE schema_name = $1 ORDER BY nom", [org.schemaName]),
      },
      comptes,
      tables,
    };
    return { organisation: org, donnees };
  });
}

/** Trace l'export dans les deux journaux (après l'écriture réussie du fichier). */
async function tracerExport(pool: Pool, org: OrganisationVisee, details: Record<string, unknown>): Promise<void> {
  await enTransaction(pool, async (client) => {
    const entree: EntreeJournal = { action: "ORGANISATION_EXPORTEE", acteurEmail: ACTEUR, cibleType: "organisation", cibleId: org.id, details };
    await journaliserPlateforme(client, { ...entree, organisationId: org.id });
    await journaliserOrganisation(client, entree, org);
  });
}

export interface BilanExport {
  organisation: OrganisationVisee;
  chemin: string;
  octets: number;
  /** SHA-256 du fichier : à noter avec le fichier, pour vérifier plus tard qu'il est intact. */
  empreinte: string;
  comptes: Record<string, number>;
}

/**
 * Exporte l'organisation dans `chemin` (fichier NEUF : un fichier existant n'est jamais écrasé ; lisible par son
 * seul propriétaire), puis trace l'export.
 */
export async function exporterOrganisation(pool: Pool, reference: string, chemin: string): Promise<BilanExport> {
  const { organisation, donnees } = await lireExport(pool, reference);
  const texte = `${JSON.stringify(donnees, null, 2)}\n`;
  try {
    await writeFile(chemin, texte, { encoding: "utf8", mode: 0o600, flag: "wx" });
  } catch (erreur) {
    if ((erreur as NodeJS.ErrnoException).code === "EEXIST") throw new ErreurFinDeContrat(`Le fichier ${chemin} existe déjà : il n'est jamais écrasé. Choisissez un autre nom.`);
    throw erreur;
  }
  const octets = Buffer.byteLength(texte, "utf8");
  const empreinte = createHash("sha256").update(texte, "utf8").digest("hex");
  await tracerExport(pool, organisation, { fichier: chemin.split(/[\\/]/).pop(), octets, empreinte, comptes: donnees.comptes });
  return { organisation, chemin, octets, empreinte, comptes: donnees.comptes };
}

export interface ApercuSuppression {
  organisation: OrganisationVisee;
  membres: number;
  tables: Record<string, number>;
  /** Dernier export fait après la suspension (null : aucun, la suppression sera refusée). */
  exportLe: Date | null;
}

async function dernierExportApresSuspension(client: PoolClient, organisationId: string): Promise<Date | null> {
  const r = await client.query<{ export_le: Date | null }>(
    `SELECT max(horodatage) FILTER (WHERE action = 'ORGANISATION_EXPORTEE') AS export_le,
            max(horodatage) FILTER (WHERE action = 'ORGANISATION_SUSPENDUE') AS suspendue_le
       FROM platform.journal WHERE organisation_id = $1 AND action IN ('ORGANISATION_EXPORTEE', 'ORGANISATION_SUSPENDUE')
     HAVING max(horodatage) FILTER (WHERE action = 'ORGANISATION_EXPORTEE') > coalesce(max(horodatage) FILTER (WHERE action = 'ORGANISATION_SUSPENDUE'), '-infinity')`,
    [organisationId],
  );
  return r.rows[0]?.export_le ?? null;
}

/** Ce que la suppression retirerait (montré avant la confirmation ; rien n'est écrit). */
export async function apercuSuppression(pool: Pool, reference: string): Promise<ApercuSuppression> {
  return enTransaction(pool, async (client) => {
    const org = await trouverOrganisation(client, reference);
    const tables: Record<string, number> = {};
    for (const table of await tablesDe(client, org.schemaName)) {
      tables[table] = Number((await client.query<{ n: string }>(`SELECT count(*) AS n FROM ${citer(org.schemaName)}.${citer(table)}`)).rows[0]!.n);
    }
    const membres = Number((await client.query<{ n: string }>("SELECT count(*) AS n FROM platform.adhesions WHERE organisation_id = $1", [org.id])).rows[0]!.n);
    return { organisation: org, membres, tables, exportLe: await dernierExportApresSuspension(client, org.id) };
  });
}

export interface BilanSuppression {
  organisation: OrganisationVisee;
  tables: number;
  membres: number;
  /** E-mails des comptes qui n'appartiennent plus à aucune organisation (à désactiver si besoin). */
  comptesSansOrganisation: string[];
}

/**
 * Supprime DÉFINITIVEMENT l'organisation (tout ou rien). `confirmation` : le nom de l'organisation, retapé à
 * l'identique par l'exploitant.
 */
export async function supprimerOrganisation(pool: Pool, reference: string, confirmation: string): Promise<BilanSuppression> {
  return enTransaction(pool, async (client) => {
    const org = await trouverOrganisation(client, reference, true);
    if (confirmation.trim() !== org.nom) throw new ErreurFinDeContrat("Confirmation incorrecte : le nom tapé n'est pas celui de l'organisation. Rien n'a été supprimé.");
    if (org.statut !== "suspendue") throw new ErreurFinDeContrat("L'organisation est encore active : suspendez-la d'abord (interface du superadmin), puis exportez-la. Rien n'a été supprimé.");
    if (!(await dernierExportApresSuspension(client, org.id))) throw new ErreurFinDeContrat("Aucun export fait depuis la suspension : lancez d'abord scripts/exporter-organisation.ts. Rien n'a été supprimé.");

    const membres = await client.query<{ email: string; seul: boolean }>(
      `SELECT u.email, NOT EXISTS (SELECT 1 FROM platform.adhesions b WHERE b.utilisateur_id = a.utilisateur_id AND b.organisation_id <> a.organisation_id) AS seul
         FROM platform.adhesions a JOIN platform.utilisateurs u ON u.id = a.utilisateur_id WHERE a.organisation_id = $1 ORDER BY u.email`,
      [org.id],
    );
    const tables = (await tablesDe(client, org.schemaName)).length;

    // Lignes des tables communes (les adhésions, invitations et accès d'urgence suivent par ON DELETE CASCADE ;
    // les sessions perdent leur organisation par ON DELETE SET NULL).
    await client.query("DELETE FROM platform.migrations_organisation WHERE schema_name = $1", [org.schemaName]);
    const supprimee = await client.query("DELETE FROM platform.organisations WHERE id = $1", [org.id]);
    if (supprimee.rowCount !== 1) throw new ErreurFinDeContrat("Suppression impossible (organisation modifiée entre-temps). Rien n'a été supprimé.");
    // Schéma, puis rôle PostgreSQL de l'organisation (noms vérifiés par trouverOrganisation, cités).
    await client.query(`DROP SCHEMA ${citer(org.schemaName)} CASCADE`);
    await client.query(`REVOKE ${citer(org.roleName)} FROM jalonia_app`);
    await client.query(`DROP ROLE ${citer(org.roleName)}`);

    const bilan: BilanSuppression = {
      organisation: org, tables, membres: membres.rowCount ?? 0, comptesSansOrganisation: membres.rows.filter((m) => m.seul).map((m) => m.email),
    };
    await journaliserPlateforme(client, {
      action: "ORGANISATION_SUPPRIMEE", acteurEmail: ACTEUR, cibleType: "organisation", cibleId: org.id, organisationId: org.id,
      details: { nom: org.nom, slug: org.slug, schema: org.schemaName, tables, membres: bilan.membres, comptesSansOrganisation: bilan.comptesSansOrganisation.length },
    });
    return bilan;
  });
}
