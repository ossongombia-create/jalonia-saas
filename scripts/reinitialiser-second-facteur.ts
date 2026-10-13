// Retire le second facteur d'un compte — SEUL moyen pour un SUPERADMIN qui a perdu son téléphone et ses codes de
// secours (l'interface ne touche jamais aux superadmins). Le compte en activera un nouveau à sa prochaine connexion
// (obligatoire pour un superadmin). Ses sessions sont fermées. Tracé dans le journal de la plateforme et dans
// celui de chacune de ses organisations.
//
// Usage (à la racine d'une version déployée) :
//   sudo -u jalonia -H npx tsx --env-file=/etc/jalonia/proprietaire.env scripts/reinitialiser-second-facteur.ts
import { createInterface } from "node:readline";
import { Pool } from "pg";
import { email as schemaEmail } from "../src/lib/validation";
import { journaliserOrganisation, journaliserPlateforme } from "../src/server/audit/journal";
import { revoquerSessionsDe } from "../src/server/auth/sessions";
import { enTransaction } from "../src/server/db/transactions";

// Une seule interface de saisie, lue ligne par ligne (les lignes déjà reçues ne sont pas perdues : la saisie
// peut aussi venir d'un tube).
const saisie = createInterface({ input: process.stdin, terminal: Boolean(process.stdin.isTTY) });
const lignes = saisie[Symbol.asyncIterator]();

async function demander(question: string): Promise<string> {
  process.stdout.write(question);
  const { value, done } = await lignes.next();
  if (done) throw new Error("Saisie interrompue.");
  return value;
}

async function principal(): Promise<void> {
  const url = process.env.DATABASE_URL_PROPRIETAIRE;
  if (!url) throw new Error("DATABASE_URL_PROPRIETAIRE n'est pas définie (fichier d'environnement non chargé ?).");
  try {
    const email = schemaEmail.safeParse(await demander("E-mail du compte : "));
    if (!email.success) throw new Error("Adresse e-mail invalide.");
    const confirmation = await demander(`Retirer le second facteur de ${email.data} et fermer ses sessions ? Tapez « oui » : `);
    if (confirmation.trim().toLowerCase() !== "oui") throw new Error("Abandon : rien n'a été modifié.");

    const pool = new Pool({ connectionString: url, max: 1, application_name: "jalonia-second-facteur" });
    try {
      const fermees = await enTransaction(pool, async (client) => {
        const r = await client.query<{ id: string }>(
          `UPDATE platform.utilisateurs SET mfa_active_le = NULL, mfa_secret_chiffre = NULL, mfa_dernier_pas = NULL, echecs_mfa = 0
            WHERE email = $1 RETURNING id`,
          [email.data],
        );
        const id = r.rows[0]?.id;
        if (!id) throw new Error(`Aucun compte pour ${email.data}.`);
        await client.query("DELETE FROM platform.codes_secours WHERE utilisateur_id = $1", [id]);
        const n = await revoquerSessionsDe(client, id);
        const entree = {
          action: "SECOND_FACTEUR_REINITIALISE" as const, acteurEmail: "ligne-de-commande", cibleType: "utilisateur", cibleId: id,
          details: { email: email.data, ligneDeCommande: true, sessionsFermees: n },
        };
        await journaliserPlateforme(client, entree);
        const orgs = await client.query<{ schema_name: string; role_name: string }>(
          "SELECT o.schema_name, o.role_name FROM platform.adhesions a JOIN platform.organisations o ON o.id = a.organisation_id WHERE a.utilisateur_id = $1",
          [id],
        );
        for (const o of orgs.rows) await journaliserOrganisation(client, entree, { schemaName: o.schema_name, roleName: o.role_name });
        return n;
      });
      console.log(`✔ Second facteur retiré pour ${email.data} (${fermees} session(s) fermée(s)). Il sera à réactiver à la prochaine connexion.`);
    } finally {
      await pool.end();
    }
  } finally {
    saisie.close();
  }
}

principal().catch((erreur: unknown) => {
  console.error(`✘ ${erreur instanceof Error ? erreur.message : String(erreur)}`);
  process.exit(1);
});
