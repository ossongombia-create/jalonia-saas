import { describe, expect, it } from "vitest";
import { cheminInterne } from "@/lib/chemins";

describe("redirections internes uniquement", () => {
  it("garde un chemin du site", () => {
    expect(cheminInterne("/plateforme/journal?action=CONNEXION")).toBe("/plateforme/journal?action=CONNEXION");
    expect(cheminInterne("/app")).toBe("/app");
  });

  it("refuse tout ce qui mène ailleurs", () => {
    for (const ko of ["//exemple.com", "/\\exemple.com", "https://exemple.com", "javascript:alert(1)", "", "exemple.com"]) {
      expect(cheminInterne(ko), ko).toBe("/");
    }
  });
});
