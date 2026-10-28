import { describe, expect, it } from "vitest";
import { aLeDroit, DROITS, estRoleOrganisation, LISTE_DROITS, ROLE_SUPERADMIN, ROLES_ORGANISATION } from "@/lib/rbac";

describe("rôles et droits", () => {
  it("chaque droit est accordé à au moins un rôle", () => {
    for (const d of LISTE_DROITS) expect(DROITS[d].roles.length, d).toBeGreaterThan(0);
  });

  it("les droits de la plateforme sont réservés au superadmin", () => {
    for (const d of LISTE_DROITS.filter((x) => x.startsWith("plateforme."))) {
      expect(DROITS[d].roles).toEqual([ROLE_SUPERADMIN]);
      for (const r of ROLES_ORGANISATION) expect(aLeDroit([r], d), `${r} / ${d}`).toBe(false);
    }
  });

  it("le superadmin n'a PAS de droit implicite sur les documents des organisations", () => {
    for (const d of LISTE_DROITS.filter((x) => !x.startsWith("plateforme."))) {
      expect(aLeDroit([ROLE_SUPERADMIN], d), d).toBe(false);
    }
  });

  it("cycle documentaire : séparation rédaction / vérification / approbation", () => {
    expect(aLeDroit(["REDACTEUR"], "documents.rediger")).toBe(true);
    expect(aLeDroit(["REDACTEUR"], "documents.approuver")).toBe(false);
    expect(aLeDroit(["VERIFICATEUR"], "documents.verifier")).toBe(true);
    expect(aLeDroit(["VERIFICATEUR"], "documents.publier")).toBe(false);
    expect(aLeDroit(["APPROBATEUR"], "documents.approuver")).toBe(true);
    expect(aLeDroit(["LECTEUR"], "documents.lire")).toBe(true);
    expect(aLeDroit(["LECTEUR"], "documents.rediger")).toBe(true); // tout membre rédige (28/10/2026)
    expect(aLeDroit(["LECTEUR"], "documents.verifier")).toBe(false);
  });

  it("documents : tout membre rédige et supprime ; l'administrateur seul lit sans rédiger ; cartographie au rédacteur", () => {
    for (const r of ["REDACTEUR", "VERIFICATEUR", "APPROBATEUR", "LECTEUR"] as const) {
      for (const d of ["documents.lire", "documents.rediger", "documents.supprimer"] as const) expect(aLeDroit([r], d), `${r} / ${d}`).toBe(true);
    }
    expect(aLeDroit(["ADMIN_ORGANISATION"], "documents.lire")).toBe(true);
    for (const d of ["documents.rediger", "documents.supprimer", "documents.soumettre", "cartographie.modifier"] as const) expect(aLeDroit(["ADMIN_ORGANISATION"], d), d).toBe(false);
    for (const r of ROLES_ORGANISATION) expect(aLeDroit([r], "cartographie.modifier"), r).toBe(r === "REDACTEUR");
    for (const d of ["documents.lire", "documents.rediger", "documents.supprimer", "cartographie.modifier"] as const) expect(DROITS[d].etat, d).toBe("actif");
  });

  it("circuit de validation : droits actifs ; soumettre pour qui rédige, vérifier, approuver, publier et archiver pour leurs rôles", () => {
    const attendus = {
      "documents.soumettre": ["REDACTEUR", "VERIFICATEUR", "APPROBATEUR", "LECTEUR"],
      "documents.verifier": ["VERIFICATEUR"],
      "documents.approuver": ["APPROBATEUR"],
      "documents.publier": ["APPROBATEUR"],
      "documents.archiver": ["APPROBATEUR"],
    } as const;
    for (const [d, roles] of Object.entries(attendus) as [keyof typeof attendus, readonly string[]][]) {
      expect(DROITS[d].etat, d).toBe("actif");
      for (const r of ROLES_ORGANISATION) expect(aLeDroit([r], d), `${r} / ${d}`).toBe(roles.includes(r));
    }
  });

  it("plusieurs rôles se cumulent ; aucun rôle = aucun droit", () => {
    expect(aLeDroit(["LECTEUR", "ADMIN_ORGANISATION"], "organisation.membres.gerer")).toBe(true);
    expect(aLeDroit([], "documents.lire")).toBe(false);
  });

  it("reconnaissance des rôles d'organisation", () => {
    expect(estRoleOrganisation("REDACTEUR")).toBe(true);
    expect(estRoleOrganisation("SUPERADMIN_PLATFORM")).toBe(false);
    expect(estRoleOrganisation("admin")).toBe(false);
  });
});
