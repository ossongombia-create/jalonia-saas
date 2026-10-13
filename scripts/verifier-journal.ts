// Vérifie la chaîne d'empreintes du journal de la plateforme et de celui de chaque organisation (audit S6).
// Avec --ancres, contrôle aussi les ancres exportées chaque jour par deploy/sauvegarde.sh (fichiers
// /var/backups/jalonia/ancres-AAAA-MM-JJ.txt — idéalement une copie gardée HORS du serveur).
//
// Usage (à la racine d'une version déployée) :
//   sudo -u jalonia -H npx tsx --env-file=/etc/jalonia/proprietaire.env scripts/verifier-journal.ts [--ancres fichier…]
// Code de sortie 0 : tout est intact ; 1 : au moins une anomalie (détaillée).
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { chaineIntacte, lireAncres, verifierJournal, type Ancre } from "../src/server/audit/chaine";
import { citer } from "../src/server/db/identifiants";

async function principal(): Promise<number> {
  const url = process.env.DATABASE_URL_PROPRIETAIRE;
  if (!url) throw new Error("DATABASE_URL_PROPRIETAIRE n'est pas définie (fichier d'environnement non chargé ?).");
  const args = process.argv.slice(2);
  const ancres: Ancre[] = [];
  if (args[0] === "--ancres") for (const f of args.slice(1)) ancres.push(...lireAncres(readFileSync(f, "utf8")));
  else if (args.length) throw new Error("Usage : verifier-journal.ts [--ancres fichier…]");

  const pool = new Pool({ connectionString: url, max: 1, application_name: "jalonia-verification-journal" });
  try {
    // Lecture seule, dans une seule transaction : une vue cohérente de tous les journaux.
    const client = await pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      await client.query("SELECT set_config('search_path', '', true)");
      const orgs = await client.query<{ schema_name: string; slug: string }>("SELECT schema_name, slug FROM platform.organisations ORDER BY slug");
      const cibles = [
        { table: "platform.journal", journal: "platform", libelle: "plateforme", avecOrganisation: true },
        ...orgs.rows.map((o) => ({ table: `${citer(o.schema_name)}.journal`, journal: o.schema_name, libelle: o.slug, avecOrganisation: false })),
      ];
      let anomalies = 0;
      for (const c of cibles) {
        const r = await verifierJournal(client, c.table, c.journal, c.avecOrganisation, ancres);
        const ok = chaineIntacte(r);
        if (!ok) anomalies++;
        const ancresTexte = r.ancresVerifiees || r.ancresEnEchec.length ? `, ancres : ${r.ancresVerifiees} vérifiée(s)` : "";
        console.log(`${ok ? "✔" : "✘"} ${c.libelle} : ${r.lignes} ligne(s), dernière ${r.journal}|${r.rang}|${r.empreinte}${ancresTexte}`);
        if (r.rangsManquants.length) console.log(`    lignes supprimées (rangs) : ${r.rangsManquants.join(", ")}`);
        if (r.lignesModifiees.length) console.log(`    lignes modifiées (rangs) : ${r.lignesModifiees.join(", ")}`);
        if (r.divergenceDepuis !== null) console.log(`    chaîne réécrite à partir du rang ${r.divergenceDepuis}`);
        for (const a of r.ancresEnEchec) console.log(`    ancre non retrouvée : ${a.journal}|${a.rang}|${a.empreinte}`);
      }
      console.log(anomalies ? `✘ ${anomalies} journal(aux) en anomalie.` : `✔ ${cibles.length} journal(aux) intact(s).`);
      await client.query("COMMIT");
      return anomalies ? 1 : 0;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

principal()
  .then((code) => process.exit(code))
  .catch((erreur: unknown) => {
    console.error(`✘ ${erreur instanceof Error ? erreur.message : String(erreur)}`);
    process.exit(1);
  });
