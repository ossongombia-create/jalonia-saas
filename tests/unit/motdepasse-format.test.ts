import { describe, expect, it } from "vitest";
import { controlerMotDePasse, hacherMotDePasse, verifierContreLeurre, verifierMotDePasse } from "@/server/auth/motdepasse";
import { formaterDuree, resumerAgent } from "@/lib/format";
import { traducteur } from "@/lib/i18n";

describe("mots de passe", () => {
  it("politique : longueur et différence avec l'e-mail", () => {
    expect(controlerMotDePasse("court")).toBe("erreur.mdp_trop_court");
    expect(controlerMotDePasse("x".repeat(201))).toBe("erreur.mdp_trop_long");
    expect(controlerMotDePasse("Brice@exemple.com", "brice@exemple.com")).toBe("erreur.mdp_egal_email");
    expect(controlerMotDePasse("une phrase de passe solide")).toBeNull();
  });

  it("hachage argon2id, vérification, empreinte illisible refusée", async () => {
    const h = await hacherMotDePasse("une phrase de passe solide");
    expect(h.startsWith("$argon2id$")).toBe(true);
    expect(await verifierMotDePasse(h, "une phrase de passe solide")).toBe(true);
    expect(await verifierMotDePasse(h, "autre chose")).toBe(false);
    expect(await verifierMotDePasse("pas-une-empreinte", "x")).toBe(false);
    expect(await verifierContreLeurre("n'importe quoi")).toBe(false);
  });
});

describe("mise en forme", () => {
  const t = traducteur("fr");
  it("durées", () => {
    expect(formaterDuree(t, 0)).toBe("0 min");
    expect(formaterDuree(t, 45 * 60)).toBe("45 min");
    expect(formaterDuree(t, 3 * 3600 + 5 * 60)).toBe("3 h 05 min");
    expect(formaterDuree(t, null)).toBe("—");
  });

  it("navigateur résumé", () => {
    expect(resumerAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 Edg/141.0")).toBe("Edge · Windows");
    expect(resumerAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1")).toBe("Safari · iOS");
    expect(resumerAgent(null)).toBe("—");
  });
});
