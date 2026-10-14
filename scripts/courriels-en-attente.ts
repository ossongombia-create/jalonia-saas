// Traite la file SMTP des notifications; la configuration SMTP est facultative pour démarrer.
import { Pool } from "pg";
import { config } from "../src/server/config";
import { traiterCourrielsEnAttente } from "../src/server/notifications/courriels-en-attente";

async function principal(): Promise<void> {
  const c = config();
  const pool = new Pool({ connectionString: c.DATABASE_URL, max: 3, application_name: "jalonia-courriels" });
  try {
    const bilan = await traiterCourrielsEnAttente(pool);
    console.log(JSON.stringify({ evenement: "courriels_en_attente", ...bilan }));
    if (bilan.erreurs.length || bilan.echoues) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

principal().catch((erreur: unknown) => {
  console.error(JSON.stringify({ evenement: "courriels_en_attente_echec", erreur: erreur instanceof Error ? erreur.message : "inconnue" }));
  process.exitCode = 1;
});
