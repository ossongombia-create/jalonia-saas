import { describe, expect, it } from "vitest";
import { creerLimiteur, ErreurOccupe } from "@/server/auth/limiteur";

function attente() {
  let liberer!: () => void;
  const promesse = new Promise<void>((r) => (liberer = r));
  return { promesse, liberer };
}

describe("limiteur de calculs simultanés", () => {
  it("au plus N à la fois ; les suivants attendent leur tour, dans l'ordre", async () => {
    const l = creerLimiteur(2, 10);
    const portes = [attente(), attente(), attente()];
    const ordre: number[] = [];
    const taches = portes.map((p, i) => l.executer(async () => { ordre.push(i); await p.promesse; return i; }));
    await Promise.resolve();
    expect(l.etat()).toEqual({ enCours: 2, enAttente: 1 });
    expect(ordre).toEqual([0, 1]);
    portes[0]!.liberer();
    await taches[0];
    await new Promise((r) => setImmediate(r));
    expect(ordre).toEqual([0, 1, 2]);
    expect(l.etat()).toEqual({ enCours: 2, enAttente: 0 });
    portes[1]!.liberer();
    portes[2]!.liberer();
    expect(await Promise.all(taches)).toEqual([0, 1, 2]);
    expect(l.etat()).toEqual({ enCours: 0, enAttente: 0 });
  });

  it("file d'attente pleine : refus immédiat (ErreurOccupe), sans rien bloquer", async () => {
    const l = creerLimiteur(1, 1);
    const p = attente();
    const a = l.executer(() => p.promesse);
    const b = l.executer(async () => "b");
    await expect(l.executer(async () => "c")).rejects.toBeInstanceOf(ErreurOccupe);
    p.liberer();
    await a;
    expect(await b).toBe("b");
    expect(l.etat()).toEqual({ enCours: 0, enAttente: 0 });
  });

  it("une erreur dans un travail libère sa place", async () => {
    const l = creerLimiteur(1, 0);
    await expect(l.executer(async () => { throw new Error("x"); })).rejects.toThrow("x");
    expect(await l.executer(async () => 1)).toBe(1);
  });
});
