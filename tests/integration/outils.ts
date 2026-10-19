// Outils communs aux tests d'intégration.
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { inject } from "vitest";
import { creerOrganisation, type OrganisationCreee } from "../../src/server/organisations/provisionnement";
import { lireOrganisation } from "../../src/server/organisations/service";
import type { OrganisationCible } from "../../src/server/membres/service";
import { accepterAvecNouveauCompte, inviter } from "../../src/server/invitations/service";
import type { RoleOrganisation } from "../../src/lib/rbac";
import type { Acteur } from "../../src/server/acteur";
import { hacherMotDePasse } from "../../src/server/auth/motdepasse";
import { enTransaction } from "../../src/server/db/transactions";

export const MDP_TEST = "mot-de-passe-de-test-1";

export function ouvrirPools(): { app: Pool; proprietaire: Pool } {
  return {
    app: new Pool({ connectionString: inject("urlApplication"), max: 4 }),
    proprietaire: new Pool({ connectionString: inject("urlProprietaire"), max: 2 }),
  };
}

export function suffixe(): string {
  return randomBytes(3).toString("hex");
}

/** Un superadmin de test (créé avec le rôle propriétaire, comme le script en ligne de commande). */
export async function creerSuperadmin(proprietaire: Pool): Promise<Acteur> {
  const email = `super-${suffixe()}@test.local`;
  const empreinte = await hacherMotDePasse(MDP_TEST);
  const r = await enTransaction(proprietaire, (c) =>
    c.query<{ id: string }>(
      "INSERT INTO platform.utilisateurs (email, nom, mot_de_passe_hash, est_superadmin, doit_changer_mdp) VALUES ($1, 'Super Admin', $2, true, false) RETURNING id",
      [email, empreinte],
    ),
  );
  return { id: r.rows[0]!.id, email, ip: "127.0.0.1", agent: "vitest" };
}

export const RESEAU_TEST = { ip: "127.0.0.1", agent: "vitest" };

export interface OrgDeTest extends OrganisationCreee {
  cible: OrganisationCible;
  adminEmail: string;
  adminId: string;
}

async function idDe(app: Pool, email: string): Promise<string> {
  const r = await enTransaction(app, (c) => c.query<{ id: string }>("SELECT id FROM platform.utilisateurs WHERE email = $1", [email]));
  if (!r.rows[0]) throw new Error(`compte introuvable : ${email}`);
  return r.rows[0].id;
}

/**
 * Une organisation de test, créée comme en production : par l'application (fonction de création en base) ; son
 * premier administrateur accepte l'invitation en créant son compte (mot de passe MDP_TEST).
 */
export async function creerOrgDeTest(app: Pool, _proprietaire: Pool, acteur: Acteur, nom = "Organisation"): Promise<OrgDeTest> {
  const s = suffixe();
  const adminEmail = `admin-${s}@test.local`;
  const creee = await creerOrganisation(app, { nom: `${nom} ${s}`, slug: `org-${s}`, admin: { email: adminEmail, nom: `Admin ${s}` } }, acteur);
  await accepterAvecNouveauCompte(app, creee.invitation.jeton, { nom: `Admin ${s}`, motDePasse: MDP_TEST, langue: "fr" }, RESEAU_TEST);
  const org = await lireOrganisation(app, creee.organisationId);
  if (!org) throw new Error("organisation introuvable après création");
  return { ...creee, adminEmail, adminId: await idDe(app, adminEmail), cible: { id: org.id, schemaName: org.schemaName, roleName: org.roleName } };
}

/** Un nouveau membre : invité par `acteur`, il crée son compte (mot de passe MDP_TEST). Renvoie son identifiant. */
export async function membreDeTest(app: Pool, org: OrganisationCible, entree: { email: string; nom?: string; roles: RoleOrganisation[] }, acteur: Acteur): Promise<string> {
  const nom = entree.nom ?? "Membre";
  const invitation = await inviter(app, org, { email: entree.email, nom, roles: entree.roles }, acteur);
  await accepterAvecNouveauCompte(app, invitation.jeton, { nom, motDePasse: MDP_TEST, langue: "fr" }, RESEAU_TEST);
  return idDe(app, entree.email);
}

/** Code d'erreur PostgreSQL d'une promesse rejetée (ex. « 42501 » = droits insuffisants). */
export async function codeErreur(promesse: Promise<unknown>): Promise<string | undefined> {
  try {
    await promesse;
    return undefined;
  } catch (erreur) {
    return (erreur as { code?: string }).code ?? "inconnu";
  }
}

/** Clé d'une ErreurMetier levée par une promesse. */
export async function cleErreur(promesse: Promise<unknown>): Promise<string | undefined> {
  try {
    await promesse;
    return undefined;
  } catch (erreur) {
    return (erreur as { cle?: string }).cle ?? `non-métier: ${(erreur as Error).message}`;
  }
}

/**
 * Second facteur ACTIF pour des comptes de test (rôle propriétaire), comme après un enrôlement : approuver, refuser une
 * approbation, archiver et confirmer une revue l'exigent (décision n° 4 du 19/10/2026). Une personne fictive des tests
 * (identifiant tiré au hasard, sans compte) reçoit d'abord un compte. Le secret n'est pas utilisable : ces tests ne
 * donnent jamais de code (second-facteur.test.ts éprouve l'enrôlement réel).
 */
export async function secondFacteurDeTest(proprietaire: Pool, personnes: readonly { id: string; email: string; nom?: string }[]): Promise<void> {
  await enTransaction(proprietaire, async (c) => {
    for (const p of personnes) {
      await c.query(
        "INSERT INTO platform.utilisateurs (id, email, nom, mot_de_passe_hash, doit_changer_mdp) VALUES ($1, $2, $3, '$argon2id$compte-de-test', false) ON CONFLICT (id) DO NOTHING",
        [p.id, p.email.toLowerCase(), p.nom ?? "Personne de test"],
      );
      await c.query("UPDATE platform.utilisateurs SET mfa_secret_chiffre = 'v1.test.test.test', mfa_active_le = now() WHERE id = $1", [p.id]);
    }
  });
}
