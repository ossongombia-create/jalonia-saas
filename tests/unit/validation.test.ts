import { describe, expect, it } from "vitest";
import { premiereErreur, roles, schemaChangementMotDePasse, schemaConnexion, schemaNouvelleOrganisation } from "@/lib/validation";

describe("validation des formulaires", () => {
  it("l'e-mail est normalisé (espaces, majuscules)", () => {
    const r = schemaConnexion.parse({ email: "  Brice.O@Exemple.COM ", motDePasse: "x" });
    expect(r.email).toBe("brice.o@exemple.com");
  });

  it("e-mail invalide refusé avec une clé traduisible", () => {
    const r = schemaConnexion.safeParse({ email: "pas-un-email", motDePasse: "x" });
    expect(r.success).toBe(false);
    if (!r.success) expect(premiereErreur(r.error)).toBe("erreur.email_invalide");
  });

  it("identifiant court : format strict", () => {
    const base = { nom: "Site", adminEmail: "a@b.co", adminNom: "A", suppleantEmail: "s@b.co", suppleantNom: "S" };
    for (const ok of ["site-port-gentil", "a", "abc123", "x-1"]) expect(schemaNouvelleOrganisation.safeParse({ ...base, slug: ok }).success, ok).toBe(true);
    for (const ko of ["-debut", "fin-", "avec espace", "accentué", "a".repeat(51), "a_b", ""]) {
      expect(schemaNouvelleOrganisation.safeParse({ ...base, slug: ko }).success, ko).toBe(false);
    }
  });

  it("rôles : connus uniquement, au moins un, doublons retirés", () => {
    expect(roles.parse(["LECTEUR", "LECTEUR", "REDACTEUR"])).toEqual(["LECTEUR", "REDACTEUR"]);
    expect(roles.safeParse([]).success).toBe(false);
    expect(roles.safeParse(["SUPERADMIN_PLATFORM"]).success).toBe(false);
  });

  it("changement de mot de passe : la confirmation doit correspondre", () => {
    const r = schemaChangementMotDePasse.safeParse({ actuel: "a", nouveau: "nouveau-mot-de-passe", confirmation: "autre" });
    expect(r.success).toBe(false);
    if (!r.success) expect(premiereErreur(r.error)).toBe("erreur.mdp_confirmation");
  });
});
