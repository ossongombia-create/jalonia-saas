// Connexions à PostgreSQL, créées au premier usage et gardées dans globalThis : en développement, le
// rechargement à chaud ne multiplie pas les connexions.
//   - poolApplication() : rôle jalonia_app — TOUTES les requêtes de l'application, y compris la création d'une
//     organisation (par la fonction platform.provisionner_organisation). L'application en service ne détient PAS
//     le mot de passe du rôle propriétaire : seuls les scripts de migration et de création de superadmin s'en
//     servent, avec un fichier d'environnement à part (voir deploy/INSTALL-VPS.md).
import "server-only";
import { Pool } from "pg";
import { config } from "../config";

interface Reserves {
  application?: Pool;
}

const global = globalThis as typeof globalThis & { __jaloniaPools?: Reserves };
const reserves: Reserves = (global.__jaloniaPools ??= {});

function creer(url: string, max: number, nom: string): Pool {
  const pool = new Pool({ connectionString: url, max, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000, application_name: nom });
  // Une connexion inactive qui tombe (redémarrage de PostgreSQL…) ne doit pas arrêter le serveur.
  pool.on("error", (erreur) => console.error(`[jalonia] connexion PostgreSQL perdue (${nom}) :`, erreur.message));
  return pool;
}

export function poolApplication(): Pool {
  return (reserves.application ??= creer(config().DATABASE_URL, 10, "jalonia-app"));
}

