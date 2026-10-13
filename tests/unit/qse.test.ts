// Règles QSE (Q1) sans base : cotation identique à l'éditeur, nombres saisis, objectifs, avancement des actions.
import { describe, expect, it } from "vitest";
import { criticite, lireNombre, objectifAtteint, refusStatut, scoreOpportunite, STATUTS_ACTION, SUITES_STATUT, type StatutAction } from "../../src/lib/qse";
import { situationIndicateur } from "../../src/server/qse/indicateurs";
import { controlerSaisie } from "../../src/server/qse/actions";

// L'éditeur d'origine (même règle de cotation, affichée dans les documents) : module JavaScript sans types.
type Cotation = (x: Record<string, unknown>) => unknown;
const editeur = (await import(/* @vite-ignore */ new URL("../../editeur/js/model.js", import.meta.url).href)) as { criticite: Cotation; scoreOpportunite: Cotation };

const VALEURS: unknown[] = ["", "0", "1", "2", "3", "4", "5", "1.5", "2.0", " 3", 1, 2, 3, 4, 5, 0, -1, 2.5, null, undefined, "abc", true, [], {}];

describe("cotation : mêmes résultats que l'éditeur", () => {
  it("criticité des risques (impact × vraisemblance, toutes les combinaisons)", () => {
    for (const g of VALEURS) for (const p of VALEURS) {
      expect(criticite({ gravite: g, probabilite: p }), `${String(g)} × ${String(p)}`).toEqual(editeur.criticite({ gravite: g, probabilite: p }));
    }
    expect(criticite({ gravite: "4", probabilite: "1" })?.niveau).toBe("critique"); // impact 4 : toujours critique
    expect(criticite({ gravite: "3", probabilite: "3" })?.niveau).toBe("critique");
    expect(criticite({ gravite: "2", probabilite: "4" })?.niveau).toBe("significatif");
    expect(criticite({ gravite: "1", probabilite: "4" })?.niveau).toBe("acceptable");
  });
  it("score des opportunités (intérêt × faisabilité)", () => {
    for (const i of VALEURS) for (const f of VALEURS) {
      expect(scoreOpportunite({ interet: i, faisabilite: f }), `${String(i)} × ${String(f)}`).toEqual(editeur.scoreOpportunite({ interet: i, faisabilite: f }));
    }
    expect(scoreOpportunite({ interet: "2", faisabilite: "3" })?.suite).toBe("plan");
    expect(scoreOpportunite({ interet: "1", faisabilite: "3" })?.suite).toBe("etudier");
  });
});

describe("indicateurs", () => {
  it("lireNombre : virgule ou point, signe, 4 décimales et 14 chiffres au plus", () => {
    expect(lireNombre("95")).toBe(95);
    expect(lireNombre(" 97,5 ")).toBe(97.5);
    expect(lireNombre("-3.25")).toBe(-3.25);
    expect(lireNombre("1 000")).toBe(1000);
    expect(lireNombre("0,0001")).toBe(0.0001);
    expect(lireNombre("99999999999999")).toBe(99_999_999_999_999);
    for (const x of ["", "abc", "1e5", "0x10", "12,34567", "1.2.3", "100000000000000", "Infinity", "NaN", "--1", "1,", ",5", "+3"]) expect(lireNombre(x), x).toBeNull();
  });
  it("objectif atteint : au moins / au plus le seuil (bornes comprises)", () => {
    expect(objectifAtteint("min", 95, 95)).toBe(true);
    expect(objectifAtteint("min", 95, 94.9999)).toBe(false);
    expect(objectifAtteint("max", 3, 3)).toBe(true);
    expect(objectifAtteint("max", 3, 3.0001)).toBe(false);
  });
  it("situation : sans objectif, sans mesure, atteint, non atteint", () => {
    expect(situationIndicateur(null, { valeur: 1 })).toBe("sans_objectif");
    expect(situationIndicateur({ sens: "min", seuil: 1 }, null)).toBe("sans_mesure");
    expect(situationIndicateur({ sens: "min", seuil: 1 }, { valeur: 2 })).toBe("atteint");
    expect(situationIndicateur({ sens: "max", seuil: 1 }, { valeur: 2 })).toBe("non_atteint");
  });
});

describe("actions", () => {
  it("avancement : ce qui est permis depuis chaque statut ; close et abandonnée sont définitives", () => {
    const permis = (de: StatutAction, vers: StatutAction) => refusStatut(de, vers, vers === "cloturee" ? true : null, "motif") === null;
    const attendu: Record<StatutAction, StatutAction[]> = {
      a_faire: ["a_faire", "en_cours", "realisee", "abandonnee"],
      en_cours: ["a_faire", "en_cours", "realisee", "abandonnee"],
      realisee: ["en_cours", "realisee", "cloturee", "abandonnee"],
      cloturee: [],
      abandonnee: [],
    };
    for (const de of STATUTS_ACTION) {
      expect(STATUTS_ACTION.filter((vers) => permis(de, vers)), de).toEqual(attendu[de]);
    }
    expect(SUITES_STATUT.cloturee).toEqual([]);
    expect(refusStatut("cloturee", "cloturee", true, "x")).toBe("actions.definitive");
    expect(refusStatut("abandonnee", "en_cours", null, "x")).toBe("actions.definitive");
    expect(refusStatut("a_faire", "cloturee", true, "x")).toBe("actions.statut_impossible");
  });
  it("clore exige l'efficacité ; abandonner exige un motif", () => {
    expect(refusStatut("realisee", "cloturee", null, "")).toBe("actions.efficacite_requise");
    expect(refusStatut("realisee", "cloturee", false, "")).toBeNull(); // « non efficace » est une réponse
    expect(refusStatut("en_cours", "abandonnee", null, "  ")).toBe("actions.motif_abandon");
    expect(refusStatut("en_cours", "abandonnee", null, "Plus d'objet")).toBeNull();
  });
  it("saisie : intitulé, description, origine, échéance, responsable", () => {
    const ok = { titre: "Former l'équipe", description: "", origine: "risque", responsableId: null, echeance: "2026-12-31" };
    expect(controlerSaisie(ok)).toBeNull();
    expect(controlerSaisie({ ...ok, titre: "   " })).toBe("actions.erreur.titre");
    expect(controlerSaisie({ ...ok, titre: "x".repeat(201) })).toBe("actions.erreur.titre");
    expect(controlerSaisie({ ...ok, description: "x".repeat(4001) })).toBe("actions.erreur.description");
    expect(controlerSaisie({ ...ok, origine: "toString" })).toBe("actions.erreur.origine");
    expect(controlerSaisie({ ...ok, echeance: "2026-02-30" })).toBe("actions.erreur.echeance");
    expect(controlerSaisie({ ...ok, echeance: null })).toBeNull();
    expect(controlerSaisie({ ...ok, responsableId: "pas-un-id" })).toBe("actions.erreur.responsable");
  });
});
