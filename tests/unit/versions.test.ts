// Historique des documents (D1) : règle des copies et comparaison champ par champ, sans base.
import { describe, expect, it } from "vitest";
import { copiesAPrendre, PERIODE_COPIES_MINUTES } from "../../src/server/documents/copies";
import { comparer, MAX_DIFFERENCES } from "../../src/lib/comparaison";

const t0 = new Date("2026-10-13T08:00:00Z");
const minutes = (n: number) => new Date(t0.getTime() + n * 60_000);
const base = {
  derniere: { version: 3, copieLe: t0 },
  versionAvant: 3,
  auteurAvant: "alice",
  auteur: "alice",
  force: false,
  validationAvant: "",
  validationApres: "",
  maintenant: minutes(1),
};

describe("règle des copies", () => {
  it("enregistrement automatique de la même personne : une copie par période, pas plus", () => {
    expect(copiesAPrendre(base)).toEqual({ avant: null, apres: null });
    expect(copiesAPrendre({ ...base, maintenant: minutes(PERIODE_COPIES_MINUTES - 0.01) })).toEqual({ avant: null, apres: null });
    expect(copiesAPrendre({ ...base, maintenant: minutes(PERIODE_COPIES_MINUTES) })).toEqual({ avant: null, apres: "enregistrement" });
  });
  it("une AUTRE personne enregistre : l'état laissé par la précédente est copié d'abord (s'il ne l'est pas déjà)", () => {
    expect(copiesAPrendre({ ...base, versionAvant: 5, auteur: "bob" })).toEqual({ avant: "enregistrement", apres: null });
    expect(copiesAPrendre({ ...base, auteur: "bob" })).toEqual({ avant: null, apres: null }); // version 3 déjà copiée
    expect(copiesAPrendre({ ...base, versionAvant: 5, auteurAvant: null, auteur: "bob" }).avant).toBe("enregistrement");
  });
  it("remplacement forcé (conflit tranché) : avant ET après", () => {
    expect(copiesAPrendre({ ...base, versionAvant: 5, force: true })).toEqual({ avant: "avant_remplacement", apres: "remplacement" });
    expect(copiesAPrendre({ ...base, force: true })).toEqual({ avant: null, apres: "remplacement" });
  });
  it("validation de la synthèse : la version validée est copiée ; retirer la validation ne l'est pas", () => {
    expect(copiesAPrendre({ ...base, validationApres: "abc" }).apres).toBe("validation");
    expect(copiesAPrendre({ ...base, validationAvant: "abc", validationApres: "abc" }).apres).toBeNull();
    expect(copiesAPrendre({ ...base, validationAvant: "abc", validationApres: "" }).apres).toBeNull();
    expect(copiesAPrendre({ ...base, validationAvant: "abc", validationApres: "def" }).apres).toBe("validation");
  });
  it("aucune copie encore (document antérieur à l'historique) : copie", () => {
    expect(copiesAPrendre({ ...base, derniere: null })).toEqual({ avant: null, apres: "enregistrement" });
    expect(copiesAPrendre({ ...base, derniere: null, auteur: "bob" })).toEqual({ avant: "enregistrement", apres: null });
  });
});

describe("comparaison champ par champ", () => {
  const doc = (champs: Record<string, unknown> = {}) => ({
    meta: { titre: "Acheter", reference: "PR-1" },
    roles: [{ id: "r1", nom: "Acheteur" }],
    etapes: [{ id: "e1", libelle: "Commander", sortie: "BC" }, { id: "e2", libelle: "Recevoir", sortie: "BR" }],
    ...champs,
  });
  it("identiques : aucune différence", () => {
    expect(comparer(doc(), doc())).toEqual({ differences: [], tronque: false });
  });
  it("valeur modifiée, champ ajouté et retiré", () => {
    const a = doc();
    const b = doc({ meta: { titre: "Acheter vite", version: "V2" } });
    expect(comparer(a, b).differences).toEqual([
      { chemin: [{ cle: "meta" }, { cle: "titre" }], nature: "modification", avant: "Acheter", apres: "Acheter vite" },
      { chemin: [{ cle: "meta" }, { cle: "reference" }], nature: "suppression", avant: "PR-1", apres: undefined },
      { chemin: [{ cle: "meta" }, { cle: "version" }], nature: "ajout", avant: undefined, apres: "V2" },
    ]);
  });
  it("listes d'éléments avec id : appariés par id (ajout, retrait, modification, ordre)", () => {
    const a = doc();
    const b = doc({ etapes: [{ id: "e3", libelle: "Payer" }, { id: "e2", libelle: "Réceptionner", sortie: "BR" }, { id: "e1", libelle: "Commander", sortie: "BC" }] });
    const d = comparer(a, b).differences;
    expect(d.map((x) => [x.nature, x.chemin.map((p) => ("cle" in p ? p.cle : "id" in p ? `${p.id}@${p.position}` : p.position))])).toEqual([
      ["modification", ["etapes", "e2@1", "libelle"]],
      ["ajout", ["etapes", "e3@0"]],
      ["ordre", ["etapes"]],
    ]);
    expect(d[2]).toMatchObject({ avant: ["e1", "e2"], apres: ["e2", "e1"] });
  });
  it("une instruction retirée", () => {
    const b = doc({ etapes: [{ id: "e1", libelle: "Commander", sortie: "BC" }] });
    const d = comparer(doc(), b).differences;
    expect(d).toEqual([{ chemin: [{ cle: "etapes" }, { id: "e2", position: 1, element: { id: "e2", libelle: "Recevoir", sortie: "BR" } }], nature: "suppression", avant: { id: "e2", libelle: "Recevoir", sortie: "BR" }, apres: undefined }]);
  });
  it("listes sans id : position par position ; types différents : une modification", () => {
    expect(comparer({ l: ["a", "b"] }, { l: ["a", "c", "d"] }).differences.map((x) => [x.nature, x.avant, x.apres])).toEqual([
      ["modification", "b", "c"], ["ajout", undefined, "d"],
    ]);
    expect(comparer({ v: "1" }, { v: 1 }).differences[0]).toMatchObject({ nature: "modification", avant: "1", apres: 1 });
    expect(comparer({ v: [1] }, { v: { a: 1 } }).differences[0]).toMatchObject({ nature: "modification" });
  });
  it("au plus MAX_DIFFERENCES, et le dit", () => {
    const a = { l: Array.from({ length: MAX_DIFFERENCES + 10 }, (_, i) => i) };
    const b = { l: a.l.map((x) => x + 1) };
    const r = comparer(a, b);
    expect(r.differences).toHaveLength(MAX_DIFFERENCES);
    expect(r.tronque).toBe(true);
  });
});
