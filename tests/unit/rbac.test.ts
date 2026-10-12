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
    expect(aLeDroit(["LECTEUR"], "documents.rediger")).toBe(false);
  });

  it("documents : rédaction, suppression et cartographie pour l'administrateur et le rédacteur ; lecture seule pour les autres", () => {
    for (const r of ["ADMIN_ORGANISATION", "REDACTEUR"] as const) {
      for (const d of ["documents.lire", "documents.rediger", "documents.supprimer", "cartographie.modifier"] as const) expect(aLeDroit([r], d), `${r} / ${d}`).toBe(true);
    }
    for (const r of ["VERIFICATEUR", "APPROBATEUR", "LECTEUR"] as const) {
      expect(aLeDroit([r], "documents.lire"), r).toBe(true);
      for (const d of ["documents.rediger", "documents.supprimer", "cartographie.modifier"] as const) expect(aLeDroit([r], d), `${r} / ${d}`).toBe(false);
    }
    for (const d of ["documents.lire", "documents.rediger", "documents.supprimer", "cartographie.modifier"] as const) expect(DROITS[d].etat, d).toBe("actif");
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
