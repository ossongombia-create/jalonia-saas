// Transactions et bascule dans le schéma d'une organisation.
//
// Toute requête passe par enTransaction(). Au début de chaque transaction, le chemin de recherche est
// VIDÉ : un nom de table non qualifié ne correspond alors à rien (échec fermé). Les tables de la
// plateforme sont toujours écrites en entier (platform.xxx).
//
// dansOrganisation() exécute du code « en tant que » l'organisation : SET LOCAL ROLE vers le rôle
// PostgreSQL de l'organisation (qui n'a de droits QUE sur son schéma) et search_path vers son schéma.
// « LOCAL » : tout est annulé automatiquement à la fin de la transaction, même en cas d'erreur.
import type { Pool, PoolClient } from "pg";
import { citer, verifierOrganisationTechnique, type OrganisationTechnique } from "./identifiants";

export async function enTransaction<T>(pool: Pool, travail: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let connexionCassee = false;
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('search_path', '', true)");
    const resultat = await travail(client);
    await client.query("COMMIT");
    return resultat;
  } catch (erreur) {
    try {
      await client.query("ROLLBACK");
    } catch {
      connexionCassee = true; // la connexion est inutilisable : on la détruit au lieu de la rendre au pool
    }
    throw erreur;
  } finally {
    client.release(connexionCassee);
  }
}

/**
 * Exécute `travail` avec les droits de l'organisation, À L'INTÉRIEUR d'une transaction déjà ouverte.
 * Après le travail, on revient au rôle de l'application (toujours dans la même transaction).
 * Si le travail échoue, on laisse l'erreur remonter : l'annulation de la transaction défait la bascule.
 */
export async function dansOrganisation<T>(client: PoolClient, org: OrganisationTechnique, travail: () => Promise<T>): Promise<T> {
  verifierOrganisationTechnique(org);
  await client.query(`SET LOCAL ROLE ${citer(org.roleName)}`);
  await client.query(`SET LOCAL search_path TO ${citer(org.schemaName)}`);
  const resultat = await travail();
  await client.query("SET LOCAL ROLE NONE");
  await client.query("SELECT set_config('search_path', '', true)");
  return resultat;
}

/** Raccourci : une transaction entière exécutée avec les droits de l'organisation. */
export function avecOrganisation<T>(pool: Pool, org: OrganisationTechnique, travail: (client: PoolClient) => Promise<T>): Promise<T> {
  return enTransaction(pool, (client) => dansOrganisation(client, org, () => travail(client)));
}
