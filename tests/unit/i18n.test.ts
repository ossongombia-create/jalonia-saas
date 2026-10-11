import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { clesDe, estCle, traducteur, traduireMessage } from "@/lib/i18n";
import { ACTIONS } from "@/lib/actions-journal";
import { LISTE_DROITS, TOUS_LES_ROLES } from "@/lib/rbac";

function fichiers(dossier: string): string[] {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = path.join(dossier, nom);
    return statSync(chemin).isDirectory() ? fichiers(chemin) : /\.(ts|tsx)$/.test(nom) ? [chemin] : [];
  });
}

describe("traductions", () => {
  it("le français et l'anglais ont exactement les mêmes clés", () => {
    expect(clesDe("en")).toEqual(clesDe("fr"));
  });

  it("aucun texte vide", () => {
    for (const langue of ["fr", "en"] as const) {
      const t = traducteur(langue);
      for (const cle of clesDe(langue)) if (estCle(cle)) expect(t(cle).trim(), `${langue}:${cle}`).not.toBe("");
    }
  });

  it("chaque opération du journal, chaque rôle et chaque droit a un libellé", () => {
    for (const a of ACTIONS) expect(estCle(`journal.action.${a}`), a).toBe(true);
    for (const r of TOUS_LES_ROLES) expect(estCle(`role.${r}`), r).toBe(true);
    for (const d of LISTE_DROITS) expect(estCle(`droit.${d}`), d).toBe(true);
  });

  it("toutes les clés de message citées dans le code existent (erreurs, succès)", () => {
    const code = fichiers(path.resolve("src")).map((f) => readFileSync(f, "utf8")).join("\n");
    const citees = new Set([...code.matchAll(/["'`]((?:erreur|membres|users|orgs|sessions|mdp|commun|connexion)\.[a-z_]+)["'`]/g)].map((m) => m[1]!));
    const manquantes = [...citees].filter((c) => !estCle(c));
    expect(manquantes).toEqual([]);
  });

  it("variables remplacées ; clé inconnue → message générique", () => {
    expect(traducteur("fr")("org.bienvenue", { nom: "Brice" })).toBe("Bienvenue, Brice");
    expect(traduireMessage("en", "erreur.n_existe_pas")).toBe(traducteur("en")("erreur.inattendue"));
  });
});
