// Tâches quotidiennes de Jalonia (audit W2) : voir src/server/taches/quotidiennes.ts.
//
// En production, ce fichier est CONSTRUIT avec l'application (npm run build → .next/standalone/taches/quotidiennes.mjs,
// par scripts/construire-taches.mjs) et lancé chaque jour par le minuteur systemd deploy/jalonia-taches.timer, sous le
// compte du service (jalonia-run), avec le fichier d'environnement du service (rôle PostgreSQL de l'application).
// Sortie : une ligne JSON (journal systemd). Code 0 : tout s'est bien passé ; 1 : au moins une organisation en erreur.
import { Pool } from "pg";
import { config } from "../src/server/config";
import { executerTachesQuotidiennes } from "../src/server/taches/quotidiennes";

async function principal(): Promise<number> {
  const c = config();
  const pool = new Pool({ connectionString: c.DATABASE_URL, max: 2, application_name: "jalonia-taches" });
  try {
    const bilan = await executerTachesQuotidiennes(pool, { fuseau: c.FUSEAU_HORAIRE });
    console.log(JSON.stringify({ evenement: "taches_quotidiennes", ...bilan }));
    return bilan.erreurs.length > 0 ? 1 : 0;
  } finally {
    await pool.end();
  }
}

principal().then(
  (code) => process.exit(code),
  (erreur) => {
    console.error(JSON.stringify({ evenement: "taches_quotidiennes", erreur: erreur instanceof Error ? erreur.message : String(erreur) }));
    process.exit(1);
  },
);
