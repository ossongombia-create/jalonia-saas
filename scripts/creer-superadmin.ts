// Crée un compte SUPERADMIN_PLATFORM — ou, si l'e-mail existe déjà, le promeut superadmin et lui
// attribue le mot de passe saisi (sert aussi à RÉCUPÉRER un accès superadmin perdu).
// C'est le SEUL moyen de créer un superadmin : l'application web n'en a pas le droit (droits PostgreSQL).
//
// Usage (à la racine du projet) :  npx tsx --env-file=/etc/jalonia/jalonia.env scripts/creer-superadmin.ts
// Le mot de passe est saisi sans être affiché, deux fois.
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { Pool } from "pg";
import { email as schemaEmail, nomPersonne } from "../src/lib/validation";
import { controlerMotDePasse, hacherMotDePasse } from "../src/server/auth/motdepasse";
import { revoquerSessionsDe } from "../src/server/auth/sessions";
import { journaliserPlateforme } from "../src/server/audit/journal";
import { enTransaction } from "../src/server/db/transactions";

// Une seule interface de saisie pour toute la session (sinon les lignes déjà lues seraient perdues).
// Pendant une saisie masquée, l'écho des caractères tapés est coupé.
let muet = false;
const sortie = new Writable({
  write(morceau, encodage, suite) {
    if (!muet) process.stdout.write(morceau, encodage as BufferEncoding);
    suite();
  },
});
const saisie = createInterface({ input: process.stdin, output: sortie, terminal: Boolean(process.stdin.isTTY) });
const lignes = saisie[Symbol.asyncIterator](); // garde en réserve les lignes déjà reçues

async function demander(question: string): Promise<string> {
  process.stdout.write(question);
  const { value, done } = await lignes.next();
  if (done) throw new Error("Saisie interrompue.");
  return value;
}

/** Saisie masquée (rien ne s'affiche à l'écran). */
async function demanderMasque(question: string): Promise<string> {
  muet = true;
  try {
    return await demander(question);
  } finally {
    muet = false;
    process.stdout.write("\n");
  }
}

async function principal(): Promise<void> {
  const url = process.env.DATABASE_URL_PROPRIETAIRE;
  if (!url) throw new Error("DATABASE_URL_PROPRIETAIRE n'est pas définie (fichier d'environnement non chargé ?).");

  const email = schemaEmail.safeParse(await demander("E-mail du superadministrateur : "));
  if (!email.success) throw new Error("Adresse e-mail invalide.");
  const nom = nomPersonne.safeParse(await demander("Nom affiché : "));
  if (!nom.success) throw new Error("Nom invalide (1 à 200 caractères).");
  const mdp = await demanderMasque("Mot de passe (12 caractères minimum) : ");
  const refus = controlerMotDePasse(mdp, email.data);
  if (refus) throw new Error(`Mot de passe refusé (${refus}).`);
  if ((await demanderMasque("Confirmez le mot de passe : ")) !== mdp) throw new Error("Les deux saisies ne correspondent pas.");

  const empreinte = await hacherMotDePasse(mdp);
  const pool = new Pool({ connectionString: url, max: 1, application_name: "jalonia-superadmin" });
  try {
    const resultat = await enTransaction(pool, async (client) => {
      const existant = await client.query<{ id: string }>("SELECT id FROM platform.utilisateurs WHERE email = $1 FOR UPDATE", [email.data]);
      let id = existant.rows[0]?.id;
      const promotion = Boolean(id);
      if (id) {
        await client.query(
          `UPDATE platform.utilisateurs
              SET est_superadmin = true, statut = 'actif', nom = $2, mot_de_passe_hash = $3, doit_changer_mdp = false,
                  echecs_connexion = 0, verrouille_jusqua = NULL
            WHERE id = $1`,
          [id, nom.data, empreinte],
        );
        await revoquerSessionsDe(client, id);
      } else {
        const cree = await client.query<{ id: string }>(
          `INSERT INTO platform.utilisateurs (email, nom, mot_de_passe_hash, est_superadmin, doit_changer_mdp)
           VALUES ($1, $2, $3, true, false) RETURNING id`,
          [email.data, nom.data, empreinte],
        );
        id = cree.rows[0]!.id;
      }
      await journaliserPlateforme(client, {
        action: "SUPERADMIN_CREE",
        acteurEmail: "ligne-de-commande",
        cibleType: "utilisateur",
        cibleId: id,
        details: { email: email.data, promotion },
      });
      return { promotion };
    });
    console.log(resultat.promotion ? `✔ Compte existant promu superadministrateur : ${email.data}` : `✔ Superadministrateur créé : ${email.data}`);
  } finally {
    await pool.end();
  }
}

principal()
  .then(() => saisie.close())
  .catch((erreur: unknown) => {
    console.error(`✘ ${erreur instanceof Error ? erreur.message : String(erreur)}`);
    process.exit(1);
  });
