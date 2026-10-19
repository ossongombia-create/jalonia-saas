// Fin de contrat (décisions n° 3 et n° 6 du 19/10/2026) — étape 2 : SUPPRESSION DÉFINITIVE d'une organisation et de
// toutes ses données (son schéma, son rôle PostgreSQL, ses lignes des tables communes). Les autres organisations ne
// sont pas touchées. Tracée dans le journal de la plateforme (ORGANISATION_SUPPRIMEE).
//
// Protections : terminal INTERACTIF obligatoire (jamais de saisie par un tube ni par un script) ; le nom de
// l'organisation est à retaper à l'identique ; l'organisation doit être SUSPENDUE et avoir été EXPORTÉE après sa
// suspension (scripts/exporter-organisation.ts). Tout ou rien : en cas d'erreur, rien n'est supprimé.
//
// Usage (à la racine d'une version déployée ; procédure : deploy/INSTALL-VPS.md, « Fin de contrat ») :
//   sudo -u jalonia -H npx tsx --env-file=/etc/jalonia/proprietaire.env scripts/supprimer-organisation.ts \
//     --organisation <identifiant ou identifiant court>
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { Pool } from "pg";
import { apercuSuppression, ErreurFinDeContrat, supprimerOrganisation } from "../src/server/fin-de-contrat/service";

async function principal(): Promise<void> {
  const { values } = parseArgs({ options: { organisation: { type: "string" } }, strict: true });
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new ErreurFinDeContrat("Suppression refusée : ce script se lance dans un terminal interactif (la confirmation ne peut pas venir d'un tube ni d'un script). Rien n'a été supprimé.");
  }
  const url = process.env.DATABASE_URL_PROPRIETAIRE;
  if (!url) throw new ErreurFinDeContrat("DATABASE_URL_PROPRIETAIRE n'est pas définie (fichier d'environnement non chargé ?).");
  const pool = new Pool({ connectionString: url, max: 1, application_name: "jalonia-suppression" });
  const saisie = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const apercu = await apercuSuppression(pool, values.organisation ?? "");
    const o = apercu.organisation;
    console.log(`Organisation : « ${o.nom} » (identifiant court ${o.slug}, ${o.statut})`);
    console.log(`  identifiant ${o.id}, schéma ${o.schemaName}, ${apercu.membres} membre(s)`);
    for (const [table, n] of Object.entries(apercu.tables)) console.log(`    ${table.padEnd(24)} ${n} ligne(s)`);
    console.log(apercu.exportLe ? `  Dernier export après la suspension : ${apercu.exportLe.toISOString()}` : "  ⚠ Aucun export depuis la suspension : la suppression sera refusée.");
    console.log("\nCETTE SUPPRESSION EST DÉFINITIVE (seule une restauration de sauvegarde pourrait la défaire).");
    const confirmation = await new Promise<string>((ok) => saisie.question(`Pour confirmer, tapez le nom exact de l'organisation (${o.nom}) : `, ok));
    // Le service revérifie tout (nom, suspension, export) dans la transaction de suppression.
    const bilan = await supprimerOrganisation(pool, o.id, confirmation);
    console.log(`✔ Organisation « ${o.nom} » supprimée : schéma ${o.schemaName} (${bilan.tables} tables) et rôle ${o.roleName} retirés, ${bilan.membres} adhésion(s) retirée(s).`);
    if (bilan.comptesSansOrganisation.length > 0) {
      console.log("  Comptes qui n'appartiennent plus à aucune organisation (à désactiver depuis l'interface du superadmin si besoin) :");
      for (const e of bilan.comptesSansOrganisation) console.log(`    ${e}`);
    }
  } finally {
    saisie.close();
    await pool.end();
  }
}

principal().catch((erreur: unknown) => {
  console.error(`✘ ${erreur instanceof Error ? erreur.message : String(erreur)}`);
  process.exit(1);
});
