// Cohérence entre documents (D2) : règles pures, sans base.
import { describe, expect, it } from "vitest";
import { analyserCoherence, dependancesDe, normaliserCode, processusConnu, type LiensDocument } from "../../src/server/documents/coherence";

let n = 0;
function doc(champs: Partial<LiensDocument>): LiensDocument {
  n += 1;
  return { id: `d${n}`, type: "procedure", titre: `Doc ${n}`, reference: "", processus: "", n3: [], sousProcedures: [], ...champs };
}
const PROCESSUS = [{ code: "ACH", nom: "Acheter" }, { code: "VEN", nom: "" }];
const cles = (docs: LiensDocument[], processus = PROCESSUS) => analyserCoherence(docs, processus).map((c) => `${c.gravite}:${c.cle}:${c.code ?? c.processus ?? ""}:${c.documents.map((d) => d.id).join(",")}`);

describe("normalisation et processus", () => {
  it("codes : espaces superflus retirés, majuscules", () => {
    expect(normaliserCode("  it-ach-01 ")).toBe("IT-ACH-01");
    expect(normaliserCode("pr  ach 1")).toBe("PR ACH 1");
    expect(normaliserCode("   ")).toBe("");
  });
  it("processus : « CODE Nom » ou « CODE », sans tenir compte des majuscules (règle de l'éditeur)", () => {
    expect(processusConnu(PROCESSUS, "ACH Acheter")).toBe(true);
    expect(processusConnu(PROCESSUS, " ach acheter ")).toBe(true);
    expect(processusConnu(PROCESSUS, "ach")).toBe(true);
    expect(processusConnu(PROCESSUS, "VEN")).toBe(true);
    expect(processusConnu(PROCESSUS, "ACH Vendre")).toBe(false);
    expect(processusConnu(PROCESSUS, "XYZ")).toBe(false);
    expect(processusConnu(PROCESSUS, "")).toBe(true);
  });
});

describe("constats", () => {
  it("un ensemble cohérent : aucun constat", () => {
    const pr = doc({ reference: "PR-ACH-01", processus: "ACH Acheter", n3: ["IT-ACH-01"], sousProcedures: ["PR-ACH-02"] });
    const sp = doc({ reference: "pr-ach-02", processus: "ach" });
    const it = doc({ type: "instruction", reference: " it-ach-01", processus: "ACH Acheter" });
    expect(cles([pr, sp, it])).toEqual([]);
  });

  it("code porté par plusieurs documents (après normalisation)", () => {
    const a = doc({ reference: "PR-ACH-01" });
    const b = doc({ reference: "pr-ach-01 " });
    expect(cles([a, b])).toEqual([`alerte:code_double:PR-ACH-01:${a.id},${b.id}`]);
  });

  it("instruction de travail citée mais absente (info), ou code porté par une procédure (alerte)", () => {
    const pr = doc({ reference: "PR-1", n3: ["IT-1", "it-1", "PR-2", " "] });
    const autre = doc({ reference: "PR-2" });
    expect(cles([pr, autre])).toEqual([`alerte:n3_pas_instruction:PR-2:${pr.id},${autre.id}`, `info:n3_absente:IT-1:${pr.id}`]);
  });

  it("instruction de travail non citée (alerte) ou sans code (info)", () => {
    const orpheline = doc({ type: "instruction", reference: "IT-9" });
    const sansCode = doc({ type: "instruction", reference: "" });
    expect(cles([orpheline, sansCode])).toEqual([`alerte:it_non_rattachee:IT-9:${orpheline.id}`, `info:it_sans_code::${sansCode.id}`]);
  });

  it("une instruction citée par une INSTRUCTION ne compte pas comme rattachée", () => {
    const it1 = doc({ type: "instruction", reference: "IT-1", n3: ["IT-2"] });
    const it2 = doc({ type: "instruction", reference: "IT-2" });
    expect(cles([it1, it2])).toEqual([`alerte:it_non_rattachee:IT-1:${it1.id}`, `alerte:it_non_rattachee:IT-2:${it2.id}`]);
  });

  it("sous-procédure appelée sans procédure de ce code (une instruction de ce code ne suffit pas)", () => {
    const pr = doc({ reference: "PR-1", sousProcedures: ["PR-9", "IT-1"] });
    const it = doc({ type: "instruction", reference: "IT-1" });
    expect(cles([pr, it])).toEqual([`alerte:it_non_rattachee:IT-1:${it.id}`, `alerte:sp_absente:IT-1:${pr.id}`, `alerte:sp_absente:PR-9:${pr.id}`]);
  });

  it("processus absent de la cartographie : un constat par processus, avec tous ses documents ; rien sans cartographie", () => {
    const a = doc({ reference: "A", processus: "XYZ Disparu" });
    const b = doc({ reference: "B", processus: "XYZ Disparu" });
    const c = doc({ reference: "C", processus: "ACH Acheter" });
    expect(cles([a, b, c])).toEqual([`alerte:processus_inconnu:XYZ Disparu:${a.id},${b.id}`]);
    expect(cles([a, b, c], [])).toEqual([]);
  });

  it("les alertes avant les informations", () => {
    const d = analyserCoherence([doc({ reference: "P", n3: ["IT-X"] }), doc({ reference: "Q" }), doc({ reference: "Q" })], []);
    expect(d.map((c) => c.gravite)).toEqual(["alerte", "info"]);
  });
});

describe("documents liés (avertissement avant suppression)", () => {
  const pr = doc({ reference: "PR-1", n3: ["IT-1", "IT-2"], sousProcedures: ["PR-2"] });
  const sp = doc({ reference: "PR-2" });
  const it1 = doc({ type: "instruction", reference: "it-1" });
  const it2 = doc({ type: "instruction", reference: "IT-2" });
  const appelante = doc({ reference: "PR-3", sousProcedures: ["PR-1"] });
  const tous = [pr, sp, it1, it2, appelante];

  it("procédure : ses instructions de travail et les procédures qui l'appellent", () => {
    expect(dependancesDe(tous, pr.id).map((d) => [d.id, d.lien])).toEqual([[it1.id, "instruction"], [it2.id, "instruction"], [appelante.id, "appelante"]]);
  });
  it("sous-procédure : la procédure qui l'appelle", () => {
    expect(dependancesDe(tous, sp.id).map((d) => [d.id, d.lien])).toEqual([[pr.id, "appelante"]]);
  });
  it("instruction de travail : la procédure qui la cite", () => {
    expect(dependancesDe(tous, it1.id).map((d) => [d.id, d.lien])).toEqual([[pr.id, "citante"]]);
  });
  it("document sans lien, ou inconnu : rien", () => {
    expect(dependancesDe(tous, appelante.id).map((d) => d.lien)).toEqual([]);
    expect(dependancesDe(tous, "inconnu")).toEqual([]);
    expect(dependancesDe([doc({ type: "instruction", reference: "" })], `d${n}`)).toEqual([]);
  });
});
