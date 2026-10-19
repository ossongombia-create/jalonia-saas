// Fin de contrat (décisions n° 3 et n° 6 du 19/10/2026) — étape 1 : EXPORT complet d'une organisation dans un seul
// fichier JSON (toutes les tables de son schéma, ses lignes dans les tables communes ; jamais de mot de passe ni de
// secret). Rien n'est modifié dans ses données ; l'export est tracé dans les deux journaux (ORGANISATION_EXPORTEE).
// Le fichier n'écrase jamais un fichier existant et n'est lisible que par son propriétaire. Son empreinte SHA-256
// est affichée : notez-la avec le fichier.
//
// Usage (à la racine d'une version déployée ; procédure : deploy/INSTALL-VPS.md, « Fin de contrat ») :
//   sudo -u jalonia -H npx tsx --env-file=/etc/jalonia/proprietaire.env scripts/exporter-organisation.ts \
//     --organisation <identifiant ou identifiant court> [--sortie <fichier.json>]
import { parseArgs } from "node:util";
import { Pool } from "pg";
import { ErreurFinDeContrat, exporterOrganisation } from "../src/server/fin-de-contrat/service";

async function principal(): Promise<void> {
  const { values } = parseArgs({ options: { organisation: { type: "string" }, sortie: { type: "string" } }, strict: true });
  const url = process.env.DATABASE_URL_PROPRIETAIRE;
  if (!url) throw new ErreurFinDeContrat("DATABASE_URL_PROPRIETAIRE n'est pas définie (fichier d'environnement non chargé ?).");
  const reference = values.organisation ?? "";
  const horodatage = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-");
  const pool = new Pool({ connectionString: url, max: 1, application_name: "jalonia-export" });
  try {
    const sortie = values.sortie ?? `export-${reference.replace(/[^a-z0-9-]/gi, "_")}-${horodatage}.json`;
    const bilan = await exporterOrganisation(pool, reference, sortie);
    console.log(`✔ Organisation « ${bilan.organisation.nom} » (${bilan.organisation.slug}, ${bilan.organisation.statut}) exportée dans ${bilan.chemin}`);
    for (const [table, n] of Object.entries(bilan.comptes)) console.log(`    ${table.padEnd(24)} ${n} ligne(s)`);
    console.log(`  Taille : ${bilan.octets} octets`);
    console.log(`  Empreinte SHA-256 : ${bilan.empreinte}`);
  } finally {
    await pool.end();
  }
}

principal().catch((erreur: unknown) => {
  console.error(`✘ ${erreur instanceof Error ? erreur.message : String(erreur)}`);
  process.exit(1);
});
