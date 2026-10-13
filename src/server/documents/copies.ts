// Copies des versions d'un document (table versions_document, en ajout seul) : la règle qui décide quand copier, et la
// copie elle-même. Module sans dépendance au service des documents (qui l'utilise à chaque enregistrement).
// Voir versions.ts pour la vue d'ensemble.
import type { PoolClient } from "pg";

export const PERIODE_COPIES_MINUTES = 15;

export type MotifCopie = "creation" | "enregistrement" | "validation" | "avant_remplacement" | "remplacement" | "restauration" | "suppression" | "reprise" | "soumission";

export interface Copie {
  version: number;
  copieLe: Date;
}

/**
 * Les copies à prendre lors d'un enregistrement (règle pure, testée sans base) : `avant` = copier l'état actuel AVANT
 * d'écrire, `apres` = copier le nouvel état.
 */
export function copiesAPrendre(e: {
  derniere: Copie | null;
  versionAvant: number;
  auteurAvant: string | null;
  auteur: string;
  force: boolean;
  validationAvant: string;
  validationApres: string;
  maintenant: Date;
}): { avant: MotifCopie | null; apres: MotifCopie | null } {
  const autrePersonne = e.auteurAvant !== e.auteur;
  const dejaCopie = e.derniere !== null && e.derniere.version === e.versionAvant;
  const avant: MotifCopie | null = (e.force || autrePersonne) && !dejaCopie ? (e.force ? "avant_remplacement" : "enregistrement") : null;
  let apres: MotifCopie | null = null;
  if (e.force) apres = "remplacement";
  else if (e.validationApres !== "" && e.validationApres !== e.validationAvant) apres = "validation";
  else if (e.derniere === null && avant === null) apres = "enregistrement";
  else if (avant === null && e.maintenant.getTime() - e.derniere!.copieLe.getTime() >= PERIODE_COPIES_MINUTES * 60_000) apres = "enregistrement";
  return { avant, apres };
}

/** Dernière copie d'un document (client placé dans l'organisation). */
export async function derniereCopie(client: PoolClient, documentId: string): Promise<Copie | null> {
  const r = await client.query<{ version: number; copie_le: Date }>(
    "SELECT version, copie_le FROM versions_document WHERE document_id = $1 ORDER BY version DESC LIMIT 1",
    [documentId],
  );
  return r.rows[0] ? { version: r.rows[0].version, copieLe: r.rows[0].copie_le } : null;
}

/** Copie l'état ACTUEL du document (sans faire transiter le contenu par l'application). Sans effet si cette version est déjà copiée. */
export async function copier(client: PoolClient, documentId: string, motif: MotifCopie): Promise<void> {
  await client.query(
    `INSERT INTO versions_document (document_id, version, type, titre, reference, contenu, auteur, auteur_nom, enregistre_le, motif)
     SELECT id, version, type, titre, reference, contenu, modifie_par, modifie_par_nom, modifie_le, $2 FROM documents WHERE id = $1
     ON CONFLICT (document_id, version) DO NOTHING`,
    [documentId, motif],
  );
}

