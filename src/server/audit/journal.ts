// Journal d'audit : traçabilité des opérations sensibles. Deux journaux, tous deux en AJOUT SEUL :
//   - platform.journal          : toute la plateforme (consulté par le superadmin) ;
//   - <schéma organisation>.journal : les opérations d'une organisation (consulté par son administrateur),
//     isolé dans le schéma de l'organisation.
// RÈGLE : ne jamais mettre de secret (mot de passe, empreinte…) dans « details ».
import { isIP } from "node:net";
import type { PoolClient } from "pg";
import type { Action } from "@/lib/actions-journal";
import { citer, type OrganisationTechnique } from "../db/identifiants";

export { ACTIONS, type Action } from "@/lib/actions-journal";

export interface EntreeJournal {
  action: Action;
  acteurId?: string | null;
  acteurEmail?: string | null;
  cibleType?: string | null;
  cibleId?: string | null;
  details?: Record<string, unknown>;
  ip?: string | null;
  agent?: string | null;
}

/** Une adresse IP valide, sinon null (une valeur invalide ferait échouer l'insertion dans la colonne inet). */
export function ipValide(ip: string | null | undefined): string | null {
  const v = ip?.trim();
  return v && isIP(v) ? v : null;
}

function valeurs(e: EntreeJournal): unknown[] {
  return [
    e.acteurId ?? null,
    e.acteurEmail ?? null,
    e.action,
    e.cibleType ?? null,
    e.cibleId ?? null,
    JSON.stringify(e.details ?? {}),
    ipValide(e.ip),
    e.agent ? e.agent.slice(0, 500) : null,
  ];
}

export async function journaliserPlateforme(client: PoolClient, e: EntreeJournal & { organisationId?: string | null }): Promise<void> {
  await client.query(
    `INSERT INTO platform.journal (acteur_id, acteur_email, action, cible_type, cible_id, details, ip, agent, organisation_id)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::inet, $8, $9)`,
    [...valeurs(e), e.organisationId ?? null],
  );
}

/**
 * Écrit dans le journal d'une organisation.
 *  - Sans « schema » : la requête vise la table « journal » du chemin de recherche courant ; il faut donc
 *    être DANS l'organisation (voir dansOrganisation).
 *  - Avec « schema » : nom qualifié (utilisé par le rôle propriétaire lors de la création d'une organisation).
 */
export async function journaliserOrganisation(client: PoolClient, e: EntreeJournal, schema?: OrganisationTechnique): Promise<void> {
  const table = schema ? `${citer(schema.schemaName)}.journal` : "journal";
  await client.query(
    `INSERT INTO ${table} (acteur_id, acteur_email, action, cible_type, cible_id, details, ip, agent)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::inet, $8)`,
    valeurs(e),
  );
}
