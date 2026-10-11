// Connexions à PostgreSQL (une réserve de connexions par rôle), créées au premier usage et gardées
// dans globalThis : en développement, le rechargement à chaud ne multiplie pas les connexions.
//   - poolApplication()  : rôle jalonia_app — TOUTES les requêtes de l'application ;
//   - poolProprietaire() : rôle jalonia_owner — UNIQUEMENT la création d'organisation (création de
//                          schéma et de rôle PostgreSQL), réservée au superadmin.
import "server-only";
import { Pool } from "pg";
import { config } from "../config";

interface Reserves {
  application?: Pool;
  proprietaire?: Pool;
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

export function poolProprietaire(): Pool {
  return (reserves.proprietaire ??= creer(config().DATABASE_URL_PROPRIETAIRE, 2, "jalonia-proprietaire"));
}
