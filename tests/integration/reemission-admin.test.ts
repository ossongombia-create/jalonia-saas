// Réémission de l'invitation d'administrateur par le superadmin (chantier 1 du 20/10/2026) : seulement pour une
// organisation ACTIVE sans AUCUN administrateur actif (invitation initiale jamais acceptée ou expirée, administrateur
// désactivé) ; rôles forcés à Administrateur ; tracée dans les deux journaux ; les autres invitations en attente ne
// sont pas touchées ; refus clairs sinon.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { reemettreInvitationAdmin } from "../../src/server/organisations/reemission";
import { creerOrganisation } from "../../src/server/organisations/provisionnement";
import { changerStatutOrganisation, lireOrganisation } from "../../src/server/organisations/service";
import { accepterAvecNouveauCompte, inviter, lireInvitation } from "../../src/server/invitations/service";
import { modifierRoles, type OrganisationCible } from "../../src/server/membres/service";
import { desactiverUtilisateur } from "../../src/server/utilisateurs/service";
import { lireJournalOrganisation, lireJournalPlateforme } from "../../src/server/consultation/service";
import { enTransaction } from "../../src/server/db/transactions";
import type { Acteur } from "../../src/server/acteur";
import { cleErreur, creerOrgDeTest, creerSuperadmin, MDP_TEST, ouvrirPools, RESEAU_TEST, suffixe } from "./outils";

let app: Pool;
let proprietaire: Pool;
let superadmin: Acteur;

beforeAll(async () => {
  ({ app, proprietaire } = ouvrirPools());
  superadmin = await creerSuperadmin(proprietaire);
});

afterAll(async () => {
  await app.end();
  await proprietaire.end();
});

const adresse = () => `admin-${suffixe()}@test.local`;

/** Une organisation dont l'invitation d'administrateur n'a JAMAIS été acceptée (aucun membre). */
async function orgSansAdmin(): Promise<{ id: string; cible: OrganisationCible; invitationId: string }> {
  const s = suffixe();
  const creee = await creerOrganisation(app, { nom: `Sans admin ${s}`, slug: `sans-${s}`, admin: { email: adresse(), nom: "Premier" } }, superadmin);
  const org = (await lireOrganisation(app, creee.organisationId))!;
  return { id: org.id, cible: { id: org.id, schemaName: org.schemaName, roleName: org.roleName }, invitationId: creee.invitation.id };
}

const invitation = async (id: string) =>
  (await enTransaction(proprietaire, (c) => c.query<{ roles: string[]; annulee_le: Date | null; cree_par: string }>(
    "SELECT roles, annulee_le, cree_par FROM platform.invitations WHERE id = $1", [id]))).rows[0]!;

describe("réémission permise : organisation active sans administrateur actif", () => {
  it("invitation initiale expirée : nouvelle invitation, rôle Administrateur forcé, acteur superadmin, deux journaux", async () => {
    const org = await orgSansAdmin();
    await enTransaction(proprietaire, (c) =>
      c.query("UPDATE platform.invitations SET cree_le = now() - interval '4 days', expire_le = now() - interval '1 day' WHERE id = $1", [org.invitationId]));
    const email = adresse();
    const r = await reemettreInvitationAdmin(app, org.id, { email, nom: "Nouvel admin" }, superadmin);
    expect(r.organisation).toMatch(/^Sans admin /);
    expect(await invitation(r.id)).toMatchObject({ roles: ["ADMIN_ORGANISATION"], annulee_le: null, cree_par: superadmin.id });
    expect(await lireInvitation(app, r.jeton)).not.toBeNull();
    const dansOrg = (await lireJournalOrganisation(app, org.cible, { page: 1 })).lignes.find((l) => l.action === "INVITATION_CREEE" && l.cibleId === r.id);
    expect(dansOrg?.acteurEmail).toBe(superadmin.email);
    expect(dansOrg?.details).toMatchObject({ email, roles: ["ADMIN_ORGANISATION"] });
    expect((await lireJournalPlateforme(app, { page: 1 })).lignes.some((l) => l.action === "INVITATION_CREEE" && l.cibleId === r.id)).toBe(true);
  });

  it("même adresse qu'une invitation en attente : elle est remplacée (tracé « remplace ») ; l'ancien lien ne vaut plus rien", async () => {
    const s = suffixe();
    const email = adresse();
    const creee = await creerOrganisation(app, { nom: `Remplacee ${s}`, slug: `remp-${s}`, admin: { email, nom: "Premier" } }, superadmin);
    const r = await reemettreInvitationAdmin(app, creee.organisationId, { email, nom: "Premier" }, superadmin);
    expect((await invitation(creee.invitation.id)).annulee_le).toBeInstanceOf(Date);
    expect(await lireInvitation(app, creee.invitation.jeton)).toBeNull();
    const org = (await lireOrganisation(app, creee.organisationId))!;
    const ligne = (await lireJournalOrganisation(app, { schemaName: org.schemaName, roleName: org.roleName }, { page: 1 })).lignes
      .find((l) => l.action === "INVITATION_CREEE" && l.cibleId === r.id);
    expect(ligne?.details).toMatchObject({ remplace: true });
  });

  it("seul administrateur DÉSACTIVÉ : réémission vers une autre adresse ; les autres invitations en attente ne sont pas touchées", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const admin: Acteur = { id: org.adminId, email: org.adminEmail, ...RESEAU_TEST };
    const autre = await inviter(app, org.cible, { email: adresse(), nom: "Lecteur invité", roles: ["LECTEUR"] }, admin);
    await desactiverUtilisateur(app, org.adminId, superadmin);
    const r = await reemettreInvitationAdmin(app, org.organisationId, { email: adresse(), nom: "Remplaçant" }, superadmin);
    expect((await invitation(r.id)).roles).toEqual(["ADMIN_ORGANISATION"]);
    expect((await invitation(autre.id)).annulee_le).toBeNull();
  });

  it("acceptée : la personne est administratrice, et la règle du dernier administrateur s'applique à elle", async () => {
    const org = await orgSansAdmin();
    const r = await reemettreInvitationAdmin(app, org.id, { email: adresse(), nom: "Nouvel admin" }, superadmin);
    await accepterAvecNouveauCompte(app, r.jeton, { nom: "Nouvel admin", motDePasse: MDP_TEST, langue: "fr" }, RESEAU_TEST);
    const id = (await enTransaction(proprietaire, (c) => c.query<{ utilisateur_id: string }>(
      "SELECT utilisateur_id FROM platform.adhesions WHERE organisation_id = $1", [org.id]))).rows[0]!.utilisateur_id;
    expect(await cleErreur(modifierRoles(app, org.cible, id, ["LECTEUR"], superadmin))).toBe("erreur.dernier_admin");
    // Il y a désormais un administrateur actif : plus de réémission.
    expect(await cleErreur(reemettreInvitationAdmin(app, org.id, { email: adresse(), nom: "Un autre" }, superadmin))).toBe("orgs.admin_present");
  });
});

describe("réémission refusée (rien n'est écrit)", () => {
  const nbInvitations = async (organisationId: string) =>
    Number((await enTransaction(proprietaire, (c) => c.query<{ n: string }>("SELECT count(*) AS n FROM platform.invitations WHERE organisation_id = $1", [organisationId]))).rows[0]!.n);

  it("administrateur actif présent → orgs.admin_present", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const avant = await nbInvitations(org.organisationId);
    expect(await cleErreur(reemettreInvitationAdmin(app, org.organisationId, { email: adresse(), nom: "Intrus" }, superadmin))).toBe("orgs.admin_present");
    expect(await nbInvitations(org.organisationId)).toBe(avant);
  });

  it("organisation suspendue → erreur.organisation_suspendue ; permise après réactivation", async () => {
    const org = await orgSansAdmin();
    await changerStatutOrganisation(app, org.id, "suspendue", superadmin);
    const avant = await nbInvitations(org.id);
    expect(await cleErreur(reemettreInvitationAdmin(app, org.id, { email: adresse(), nom: "Trop tôt" }, superadmin))).toBe("erreur.organisation_suspendue");
    expect(await nbInvitations(org.id)).toBe(avant);
    await changerStatutOrganisation(app, org.id, "active", superadmin);
    await reemettreInvitationAdmin(app, org.id, { email: adresse(), nom: "Après réactivation" }, superadmin);
    expect(await nbInvitations(org.id)).toBe(avant + 1);
  });

  it("organisation inconnue → erreur.introuvable ; adresse du superadmin → invitation.soi_meme", async () => {
    expect(await cleErreur(reemettreInvitationAdmin(app, "00000000-0000-4000-8000-000000000000", { email: adresse(), nom: "X" }, superadmin))).toBe("erreur.introuvable");
    const org = await orgSansAdmin();
    expect(await cleErreur(reemettreInvitationAdmin(app, org.id, { email: superadmin.email, nom: "Moi" }, superadmin))).toBe("invitation.soi_meme");
  });

  it("administrateur désactivé, MÊME adresse → erreur.deja_membre (il faut réactiver son compte)", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    await desactiverUtilisateur(app, org.adminId, superadmin);
    const avant = await nbInvitations(org.organisationId);
    expect(await cleErreur(reemettreInvitationAdmin(app, org.organisationId, { email: org.adminEmail, nom: "Ancien" }, superadmin))).toBe("erreur.deja_membre");
    expect(await nbInvitations(org.organisationId)).toBe(avant);
  });
});
