// Outils communs aux tests d'intégration.
import path from "node:path";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { inject } from "vitest";
import { lireMigrations } from "../../src/server/migrations/lanceur";
import { creerOrganisation, type OrganisationCreee } from "../../src/server/organisations/provisionnement";
import { lireOrganisation } from "../../src/server/organisations/service";
import type { OrganisationCible } from "../../src/server/membres/service";
import type { Acteur } from "../../src/server/acteur";
import { hacherMotDePasse } from "../../src/server/auth/motdepasse";
import { enTransaction } from "../../src/server/db/transactions";

export const MDP_TEST = "mot-de-passe-de-test-1";

export function ouvrirPools(): { app: Pool; proprietaire: Pool } {
  return {
    app: new Pool({ connectionString: inject("urlApplication"), max: 4 }),
    proprietaire: new Pool({ connectionString: inject("urlProprietaire"), max: 2 }),
  };
}

export function suffixe(): string {
  return randomBytes(3).toString("hex");
}

/** Un superadmin de test (créé avec le rôle propriétaire, comme le script en ligne de commande). */
export async function creerSuperadmin(proprietaire: Pool): Promise<Acteur> {
  const email = `super-${suffixe()}@test.local`;
  const empreinte = await hacherMotDePasse(MDP_TEST);
  const r = await enTransaction(proprietaire, (c) =>
    c.query<{ id: string }>(
      "INSERT INTO platform.utilisateurs (email, nom, mot_de_passe_hash, est_superadmin, doit_changer_mdp) VALUES ($1, 'Super Admin', $2, true, false) RETURNING id",
      [email, empreinte],
    ),
  );
  return { id: r.rows[0]!.id, email, ip: "127.0.0.1", agent: "vitest" };
}

export interface OrgDeTest extends OrganisationCreee {
  cible: OrganisationCible;
  adminEmail: string;
}

export async function creerOrgDeTest(app: Pool, proprietaire: Pool, acteur: Acteur, nom = "Organisation"): Promise<OrgDeTest> {
  const s = suffixe();
  const migrations = await lireMigrations(path.resolve("db/migrations/organisation"));
  const adminEmail = `admin-${s}@test.local`;
  const creee = await creerOrganisation(
    proprietaire,
    migrations,
    { nom: `${nom} ${s}`, slug: `org-${s}`, admin: { email: adminEmail, nom: `Admin ${s}`, motDePasseProvisoire: MDP_TEST } },
    acteur,
  );
  const org = await lireOrganisation(app, creee.organisationId);
  if (!org) throw new Error("organisation introuvable après création");
  return { ...creee, adminEmail, cible: { id: org.id, schemaName: org.schemaName, roleName: org.roleName } };
}

/** Code d'erreur PostgreSQL d'une promesse rejetée (ex. « 42501 » = droits insuffisants). */
export async function codeErreur(promesse: Promise<unknown>): Promise<string | undefined> {
  try {
    await promesse;
    return undefined;
  } catch (erreur) {
    return (erreur as { code?: string }).code ?? "inconnu";
  }
}

/** Clé d'une ErreurMetier levée par une promesse. */
export async function cleErreur(promesse: Promise<unknown>): Promise<string | undefined> {
  try {
    await promesse;
    return undefined;
  } catch (erreur) {
    return (erreur as { cle?: string }).cle ?? `non-métier: ${(erreur as Error).message}`;
  }
}
