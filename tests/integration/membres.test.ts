// Membres d'une organisation : rôles, règle du dernier administrateur, traçabilité dans les deux journaux.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { ajouterMembre, listerMembres, modifierRoles, retirerMembre } from "../../src/server/membres/service";
import { lireJournalOrganisation, lireJournalPlateforme } from "../../src/server/consultation/service";
import { desactiverUtilisateur } from "../../src/server/utilisateurs/service";
import type { Acteur } from "../../src/server/acteur";
import { cleErreur, creerOrgDeTest, creerSuperadmin, MDP_TEST, ouvrirPools, suffixe, type OrgDeTest } from "./outils";

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

async function membre(org: OrgDeTest, roles: ("ADMIN_ORGANISATION" | "REDACTEUR" | "LECTEUR")[]) {
  const email = `m-${suffixe()}@test.local`;
  const r = await ajouterMembre(app, org.cible, { email, nom: "Membre", roles, motDePasseProvisoire: MDP_TEST }, superadmin);
  return { id: r.utilisateurId, email };
}

describe("règle du dernier administrateur", () => {
  it("on ne peut ni retirer ni rétrograder le seul administrateur actif", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    expect(await cleErreur(retirerMembre(app, org.cible, org.adminId, superadmin))).toBe("erreur.dernier_admin");
    expect(await cleErreur(modifierRoles(app, org.cible, org.adminId, ["LECTEUR"], superadmin))).toBe("erreur.dernier_admin");
  });

  it("avec un second administrateur actif, c'est possible", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    await membre(org, ["ADMIN_ORGANISATION"]);
    await modifierRoles(app, org.cible, org.adminId, ["LECTEUR"], superadmin);
    const roles = (await listerMembres(app, org.organisationId)).find((m) => m.utilisateurId === org.adminId)?.roles;
    expect(roles).toEqual(["LECTEUR"]);
  });

  it("un administrateur DÉSACTIVÉ ne compte pas comme administrateur actif", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const second = await membre(org, ["ADMIN_ORGANISATION"]);
    await desactiverUtilisateur(app, second.id, superadmin);
    expect(await cleErreur(retirerMembre(app, org.cible, org.adminId, superadmin))).toBe("erreur.dernier_admin");
  });
});

describe("ajout et retrait", () => {
  it("compte existant ajouté sans mot de passe ; doublon refusé ; nouveau compte sans mot de passe refusé", async () => {
    const org1 = await creerOrgDeTest(app, proprietaire, superadmin);
    const org2 = await creerOrgDeTest(app, proprietaire, superadmin);
    const m = await membre(org1, ["REDACTEUR"]);
    const r = await ajouterMembre(app, org2.cible, { email: m.email, nom: "Ignoré", roles: ["LECTEUR"], motDePasseProvisoire: "" }, superadmin);
    expect(r).toEqual({ utilisateurId: m.id, compteCree: false });
    expect(await cleErreur(ajouterMembre(app, org2.cible, { email: m.email, nom: "X", roles: ["LECTEUR"], motDePasseProvisoire: "" }, superadmin))).toBe("erreur.deja_membre");
    expect(
      await cleErreur(ajouterMembre(app, org2.cible, { email: `neuf-${suffixe()}@test.local`, nom: "X", roles: ["LECTEUR"], motDePasseProvisoire: "" }, superadmin)),
    ).toBe("erreur.mdp_provisoire_requis");
  });

  it("retrait d'un membre", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const m = await membre(org, ["LECTEUR"]);
    await retirerMembre(app, org.cible, m.id, superadmin);
    expect((await listerMembres(app, org.organisationId)).some((x) => x.utilisateurId === m.id)).toBe(false);
    expect(await cleErreur(retirerMembre(app, org.cible, m.id, superadmin))).toBe("erreur.introuvable");
  });
});

describe("traçabilité", () => {
  it("chaque opération est dans le journal de la plateforme ET dans celui de l'organisation — et seulement le sien", async () => {
    const a = await creerOrgDeTest(app, proprietaire, superadmin);
    const b = await creerOrgDeTest(app, proprietaire, superadmin);
    const m = await membre(a, ["LECTEUR"]);
    await modifierRoles(app, a.cible, m.id, ["REDACTEUR", "VERIFICATEUR"], superadmin);
    await retirerMembre(app, a.cible, m.id, superadmin);
    await membre(b, ["LECTEUR"]);

    const journalA = await lireJournalOrganisation(app, a.cible, { page: 1 });
    const actionsA = journalA.lignes.map((l) => l.action).reverse();
    expect(actionsA).toEqual(["ORGANISATION_CREEE", "MEMBRE_AJOUTE", "MEMBRE_AJOUTE", "DROITS_MODIFIES", "MEMBRE_RETIRE"]);
    const droits = journalA.lignes.find((l) => l.action === "DROITS_MODIFIES");
    expect(droits?.details).toEqual({ avant: ["LECTEUR"], apres: ["REDACTEUR", "VERIFICATEUR"] });
    // Rien de l'organisation B dans le journal de A.
    expect(journalA.lignes.every((l) => l.cibleId !== b.organisationId)).toBe(true);

    const plateforme = await lireJournalPlateforme(app, { page: 1, action: "DROITS_MODIFIES" });
    expect(plateforme.lignes.some((l) => l.cibleId === m.id)).toBe(true);
  });

  it("filtre et pagination du journal", async () => {
    const page = await lireJournalPlateforme(app, { page: 1, action: "ORGANISATION_CREEE" });
    expect(page.lignes.every((l) => l.action === "ORGANISATION_CREEE")).toBe(true);
    const lointaine = await lireJournalPlateforme(app, { page: 999 });
    expect(lointaine.lignes).toEqual([]);
  });
});
