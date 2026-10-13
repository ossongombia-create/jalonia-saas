// Données de départ des parcours navigateur (lancé par tests/e2e/lancer.mjs, APRÈS scripts/creer-superadmin.ts).
// Tout est créé comme en production : organisations par la fonction de création en base (rôle de l'application),
// comptes par l'acceptation d'une invitation (chaque personne choisit son mot de passe).
//
// Variables : DATABASE_URL (rôle de l'application), CLE_SECOND_FACTEUR (même clé que le serveur de test).
import { Pool } from "pg";
import type { RoleOrganisation } from "../../src/lib/rbac";
import type { Langue } from "../../src/lib/i18n";
import type { Acteur } from "../../src/server/acteur";
import { depuisBase32, lireCle, totp } from "../../src/server/auth/totp";
import { activerSecondFacteur, preparerEnrolement } from "../../src/server/auth/second-facteur";
import { enTransaction } from "../../src/server/db/transactions";
import { accepterAvecNouveauCompte, inviter } from "../../src/server/invitations/service";
import type { OrganisationCible } from "../../src/server/membres/service";
import { creerOrganisation } from "../../src/server/organisations/provisionnement";
import { lireOrganisation } from "../../src/server/organisations/service";

const SUPERADMIN = "superadmin@e2e.test"; // (tests/e2e/outils.cjs)
const MDP = "motdepasse-e2e-demo"; // (tests/e2e/outils.cjs)
const RESEAU = { ip: "127.0.0.1", agent: "e2e-preparation" };

interface Personne {
  email: string;
  nom: string;
  roles: RoleOrganisation[];
  langue?: Langue;
}

interface Organisation {
  nom: string;
  slug: string;
  admin: { email: string; nom: string };
  membres: Personne[];
}

// Parcours p1 à p7.
const PARCOURS: Organisation[] = [
  {
    nom: "Atelier Démo",
    slug: "atelier-demo",
    admin: { email: "admin@demo.test", nom: "Admin Atelier Démo" },
    membres: [
      { email: "redac@demo.test", nom: "Rita Rédactrice", roles: ["REDACTEUR"] },
      { email: "redac2@demo.test", nom: "Rémi Rédacteur", roles: ["REDACTEUR"] },
      { email: "lecteur@demo.test", nom: "Léa Lectrice", roles: ["LECTEUR"], langue: "en" },
      { email: "verif@demo.test", nom: "Victor Vérificateur", roles: ["VERIFICATEUR", "APPROBATEUR"] },
      // Circuit de validation (p11) : celui qui vérifie ne peut pas approuver la même version.
      { email: "appro@demo.test", nom: "Agathe Approbatrice", roles: ["APPROBATEUR"] },
    ],
  },
  { nom: "Autre Organisation", slug: "autre-org", admin: { email: "autre@demo.test", nom: "Admin Autre Organisation" }, membres: [] },
];

// Matrice des autorisations (tests/e2e/autorisations.cjs) : organisations à part, que les parcours ne touchent pas.
const AUTORISATIONS: Organisation[] = [
  {
    nom: "Droits A",
    slug: "droits-a",
    admin: { email: "admin-a@droits.test", nom: "Admin A" },
    membres: [
      { email: "redac-a@droits.test", nom: "Rédacteur A", roles: ["REDACTEUR"] },
      { email: "lect-a@droits.test", nom: "Lecteur A", roles: ["LECTEUR"] },
      { email: "verif-a@droits.test", nom: "Vérificateur A", roles: ["VERIFICATEUR", "APPROBATEUR"] },
      { email: "appro-a@droits.test", nom: "Approbateur A", roles: ["APPROBATEUR"] },
      // Administrateur À SECOND FACTEUR : sa session « en attente du code » ne doit rien ouvrir.
      { email: "mfa-a@droits.test", nom: "Admin A à second facteur", roles: ["ADMIN_ORGANISATION"] },
      // Cibles des actions (rôles modifiés, retrait).
      { email: "cible-a@droits.test", nom: "Cible A", roles: ["LECTEUR"] },
      { email: "retrait-a@droits.test", nom: "Retrait A", roles: ["LECTEUR"] },
    ],
  },
  {
    nom: "Droits B",
    slug: "droits-b",
    admin: { email: "admin-b@droits.test", nom: "Admin B" },
    membres: [
      // Cible des actions du superadmin (désactivation, mot de passe, sessions…).
      { email: "jetable@droits.test", nom: "Compte jetable", roles: ["LECTEUR"] },
    ],
  },
];

async function idDe(pool: Pool, email: string): Promise<string> {
  const r = await enTransaction(pool, (c) => c.query<{ id: string }>("SELECT id FROM platform.utilisateurs WHERE email = $1", [email]));
  if (!r.rows[0]) throw new Error(`compte introuvable : ${email}`);
  return r.rows[0].id;
}

async function creer(pool: Pool, superadmin: Acteur, o: Organisation): Promise<void> {
  const creee = await creerOrganisation(pool, { nom: o.nom, slug: o.slug, admin: o.admin }, superadmin);
  await accepterAvecNouveauCompte(pool, creee.invitation.jeton, { nom: o.admin.nom, motDePasse: MDP, langue: "fr" }, RESEAU);
  const lue = await lireOrganisation(pool, creee.organisationId);
  if (!lue) throw new Error(`organisation introuvable : ${o.slug}`);
  const cible: OrganisationCible = { id: lue.id, schemaName: lue.schemaName, roleName: lue.roleName };
  const admin: Acteur = { id: await idDe(pool, o.admin.email), email: o.admin.email, ...RESEAU };
  for (const m of o.membres) {
    const invitation = await inviter(pool, cible, { email: m.email, nom: m.nom, roles: m.roles }, admin);
    await accepterAvecNouveauCompte(pool, invitation.jeton, { nom: m.nom, motDePasse: MDP, langue: m.langue ?? "fr" }, RESEAU);
  }
  console.log(`✔ ${o.slug} : ${1 + o.membres.length} comptes`);
}

async function principal(): Promise<void> {
  const url = process.env.DATABASE_URL;
  const cleTexte = process.env.CLE_SECOND_FACTEUR;
  if (!url || !cleTexte) throw new Error("DATABASE_URL et CLE_SECOND_FACTEUR attendues (tests/e2e/lancer.mjs).");
  const cle = lireCle(cleTexte);
  const pool = new Pool({ connectionString: url, max: 2 });
  try {
    const superadmin: Acteur = { id: await idDe(pool, SUPERADMIN), email: SUPERADMIN, ...RESEAU };
    for (const o of [...PARCOURS, ...AUTORISATIONS]) await creer(pool, superadmin, o);

    // Second facteur de mfa-a@droits.test, activé par le parcours normal (secret chiffré, code TOTP valable).
    const mfa: Acteur = { id: await idDe(pool, "mfa-a@droits.test"), email: "mfa-a@droits.test", ...RESEAU };
    const { secret } = await preparerEnrolement(pool, cle, mfa);
    await activerSecondFacteur(pool, cle, mfa, totp(depuisBase32(secret), Date.now()));
    console.log("✔ second facteur actif : mfa-a@droits.test");
  } finally {
    await pool.end();
  }
}

principal().catch((erreur: unknown) => {
  console.error(`✘ préparation : ${erreur instanceof Error ? erreur.stack : String(erreur)}`);
  process.exit(1);
});
