// Lecture des organisations et changement de statut (suspension / réactivation).
import type { Pool } from "pg";
import { enTransaction, dansOrganisation } from "../db/transactions";
import type { OrganisationTechnique } from "../db/identifiants";
import { journaliserOrganisation, journaliserPlateforme } from "../audit/journal";
import { ErreurMetier } from "../erreurs";
import { traceActeur, type Acteur } from "../acteur";

export type StatutOrganisation = "active" | "suspendue";

export interface OrganisationResume {
  id: string;
  nom: string;
  slug: string;
  statut: StatutOrganisation;
  creeLe: Date;
  membres: number;
}

export interface Organisation extends OrganisationTechnique {
  id: string;
  nom: string;
  slug: string;
  statut: StatutOrganisation;
  creeLe: Date;
}

export async function listerOrganisations(pool: Pool): Promise<OrganisationResume[]> {
  return enTransaction(pool, async (client) => {
    const r = await client.query<{ id: string; nom: string; slug: string; statut: StatutOrganisation; cree_le: Date; membres: number }>(
      `SELECT o.id, o.nom, o.slug, o.statut, o.cree_le,
              (SELECT count(*)::int FROM platform.adhesions a WHERE a.organisation_id = o.id) AS membres
         FROM platform.organisations o
        ORDER BY o.nom`,
    );
    return r.rows.map((o) => ({ id: o.id, nom: o.nom, slug: o.slug, statut: o.statut, creeLe: o.cree_le, membres: o.membres }));
  });
}

export async function lireOrganisation(pool: Pool, id: string): Promise<Organisation | null> {
  return enTransaction(pool, async (client) => {
    const r = await client.query<{ id: string; nom: string; slug: string; statut: StatutOrganisation; cree_le: Date; schema_name: string; role_name: string }>(
      "SELECT id, nom, slug, statut, cree_le, schema_name, role_name FROM platform.organisations WHERE id = $1",
      [id],
    );
    const o = r.rows[0];
    return o ? { id: o.id, nom: o.nom, slug: o.slug, statut: o.statut, creeLe: o.cree_le, schemaName: o.schema_name, roleName: o.role_name } : null;
  });
}

export async function changerStatutOrganisation(pool: Pool, organisationId: string, statut: StatutOrganisation, acteur: Acteur): Promise<void> {
  await enTransaction(pool, async (client) => {
    const r = await client.query<{ schema_name: string; role_name: string }>(
      "UPDATE platform.organisations SET statut = $2 WHERE id = $1 AND statut <> $2 RETURNING schema_name, role_name",
      [organisationId, statut],
    );
    const o = r.rows[0];
    if (!o) {
      const existe = await client.query("SELECT 1 FROM platform.organisations WHERE id = $1", [organisationId]);
      if (!existe.rowCount) throw new ErreurMetier("erreur.introuvable");
      return; // déjà dans ce statut : rien à faire
    }
    const action = statut === "suspendue" ? "ORGANISATION_SUSPENDUE" : "ORGANISATION_REACTIVEE";
    const trace = traceActeur(acteur);
    await journaliserPlateforme(client, { action, ...trace, cibleType: "organisation", cibleId: organisationId, organisationId });
    await dansOrganisation(client, { schemaName: o.schema_name, roleName: o.role_name }, () =>
      journaliserOrganisation(client, { action, ...trace, cibleType: "organisation", cibleId: organisationId }),
    );
  });
}
