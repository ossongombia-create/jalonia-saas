import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { citer, nouveauxIdentifiants, verifierOrganisationTechnique } from "@/server/db/identifiants";
import { preparerPourOrganisation } from "@/server/migrations/lanceur";

describe("identifiants SQL", () => {
  it("citer() accepte un identifiant simple et refuse toute tentative d'injection", () => {
    expect(citer("org_0123456789ab")).toBe('"org_0123456789ab"');
    for (const ko of ['x"; DROP SCHEMA platform; --', "Majuscule", "avec espace", "1commence", "", "a".repeat(64), "point.virgule"]) {
      expect(() => citer(ko), ko).toThrow();
    }
  });

  it("les identifiants générés ont le format attendu et sont uniques", () => {
    const vus = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const id = nouveauxIdentifiants();
      expect(id.schemaName).toMatch(/^org_[0-9a-f]{12}$/);
      expect(id.roleName).toBe(`${id.schemaName}_rw`);
      vus.add(id.schemaName);
    }
    expect(vus.size).toBe(200);
  });

  it("un couple schéma/rôle incohérent est refusé", () => {
    expect(() => verifierOrganisationTechnique({ schemaName: "org_0123456789ab", roleName: "org_ba9876543210_rw" })).toThrow();
    expect(() => verifierOrganisationTechnique({ schemaName: "platform", roleName: "platform_rw" })).toThrow();
  });
});

describe("gabarit des migrations d'organisation", () => {
  const org = { schemaName: "org_0123456789ab", roleName: "org_0123456789ab_rw" };

  it("remplace {{schema}} et {{role}} par des identifiants cités", () => {
    expect(preparerPourOrganisation("GRANT USAGE ON SCHEMA {{schema}} TO {{role}};", org)).toBe('GRANT USAGE ON SCHEMA "org_0123456789ab" TO "org_0123456789ab_rw";');
  });

  it("refuse un paramètre inconnu", () => {
    expect(() => preparerPourOrganisation("SELECT {{autre}}", org)).toThrow(/inconnu/);
  });

  it("le gabarit réel ne laisse aucun paramètre ni aucune référence à un autre schéma", () => {
    const sql = preparerPourOrganisation(readFileSync(path.resolve("db/migrations/organisation/0001_socle.sql"), "utf8"), org);
    expect(sql).not.toMatch(/\{\{/);
    expect(sql).not.toMatch(/platform\./);
  });
});
