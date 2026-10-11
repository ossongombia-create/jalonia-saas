// Identifiants PostgreSQL dynamiques (schéma et rôle d'une organisation).
// RÈGLE : un identifiant n'est JAMAIS inséré dans du SQL sans être passé par citer(), qui le valide.
// Les valeurs (textes, nombres…) passent toujours par des paramètres $1, $2… — jamais par concaténation.
import { randomBytes } from "node:crypto";

const MOTIF_SCHEMA = /^org_[0-9a-f]{12}$/;
const MOTIF_IDENTIFIANT = /^[a-z_][a-z0-9_]{0,62}$/;

/** Ce qu'il faut savoir d'une organisation pour basculer dans son schéma. */
export interface OrganisationTechnique {
  schemaName: string;
  roleName: string;
}

/** Vérifie qu'un couple schéma/rôle est bien celui d'une organisation (format strict). Lève une erreur sinon. */
export function verifierOrganisationTechnique(org: OrganisationTechnique): void {
  if (!MOTIF_SCHEMA.test(org.schemaName) || org.roleName !== `${org.schemaName}_rw`) {
    throw new Error("Identifiants d'organisation invalides.");
  }
}

/** Entoure un identifiant de guillemets après l'avoir validé (minuscules, chiffres, soulignés). */
export function citer(identifiant: string): string {
  if (!MOTIF_IDENTIFIANT.test(identifiant)) throw new Error("Identifiant SQL invalide.");
  return `"${identifiant}"`;
}

/** Génère les identifiants d'une nouvelle organisation : org_<12 caractères hexadécimaux aléatoires>. */
export function nouveauxIdentifiants(): OrganisationTechnique {
  const schemaName = `org_${randomBytes(6).toString("hex")}`;
  return { schemaName, roleName: `${schemaName}_rw` };
}
