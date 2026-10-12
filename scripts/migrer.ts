// Applique les migrations de la base (plateforme puis chaque organisation).
// Usage (à la racine du projet) :  npx tsx --env-file=/etc/jalonia/proprietaire.env scripts/migrer.ts
// Utilise le rôle PROPRIÉTAIRE (DATABASE_URL_PROPRIETAIRE, seule variable lue). Sans effet si tout est déjà à jour.
// (En production, le déploiement — deploy/deployer.sh — le lance lui-même.)
import { Pool } from "pg";
import { migrer } from "../src/server/migrations/lanceur";

async function principal(): Promise<void> {
  const url = process.env.DATABASE_URL_PROPRIETAIRE;
  if (!url) throw new Error("DATABASE_URL_PROPRIETAIRE n'est pas définie (fichier d'environnement non chargé ?).");
  const pool = new Pool({ connectionString: url, max: 1, application_name: "jalonia-migrations" });
  try {
    const rapport = await migrer(pool, process.cwd());
    const orgs = Object.entries(rapport.organisations);
    if (rapport.plateforme.length === 0 && orgs.length === 0) {
      console.log("Base à jour : aucune migration à appliquer.");
      return;
    }
    for (const m of rapport.plateforme) console.log(`✔ plateforme : ${m}`);
    for (const [schema, liste] of orgs) for (const m of liste) console.log(`✔ ${schema} : ${m}`);
  } finally {
    await pool.end();
  }
}

principal().catch((erreur: unknown) => {
  console.error(`✘ ${erreur instanceof Error ? erreur.message : String(erreur)}`);
  process.exit(1);
});
