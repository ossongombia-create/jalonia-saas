import { describe, expect, it } from "vitest";
import { lireCorpsJson, origineAutorisee, reponseJson } from "@/server/web/requetes-json";

function requete(corps: BodyInit | null, entetes: Record<string, string> = {}): Request {
  return new Request("http://127.0.0.1:3000/api/documents/x", { method: "PUT", body: corps, headers: entetes });
}

describe("origine des requêtes", () => {
  it("acceptée seulement si l'en-tête Origin désigne le site lui-même", () => {
    expect(origineAutorisee(requete(null, { origin: "https://jalonia.exemple.org", host: "jalonia.exemple.org" }))).toBe(true);
    // Derrière Caddy : l'hôte public est aussi dans X-Forwarded-Host.
    expect(origineAutorisee(requete(null, { origin: "https://jalonia.exemple.org", host: "127.0.0.1:3000", "x-forwarded-host": "jalonia.exemple.org" }))).toBe(true);
    expect(origineAutorisee(requete(null, { origin: "https://pirate.exemple.com", host: "jalonia.exemple.org" }))).toBe(false);
    expect(origineAutorisee(requete(null, { host: "jalonia.exemple.org" }))).toBe(false); // pas d'Origin
    expect(origineAutorisee(requete(null, { origin: "null", host: "jalonia.exemple.org" }))).toBe(false);
    expect(origineAutorisee(requete(null, { origin: "https://jalonia.exemple.org.pirate.com", host: "jalonia.exemple.org" }))).toBe(false);
  });
});

describe("lecture du corps JSON", () => {
  const json = { "content-type": "application/json" };

  it("JSON valide lu", async () => {
    const r = await lireCorpsJson(requete(JSON.stringify({ a: 1, b: "é" }), json));
    expect(r).toEqual({ ok: true, valeur: { a: 1, b: "é" } });
    expect(await lireCorpsJson(requete("{}", { "content-type": "application/json; charset=utf-8" }))).toEqual({ ok: true, valeur: {} });
  });

  it("type de contenu autre que JSON : 415", async () => {
    for (const type of ["text/plain", "application/x-www-form-urlencoded", "application/jsonx", ""]) {
      const r = await lireCorpsJson(requete("{}", type ? { "content-type": type } : {}));
      expect(r.ok ? 200 : r.reponse.status, type).toBe(415);
    }
  });

  it("trop volumineux : 413, annoncé ou constaté pendant la lecture", async () => {
    const annonce = await lireCorpsJson(requete("{}", { ...json, "content-length": "9999999" }), 100);
    expect(annonce.ok ? 200 : annonce.reponse.status).toBe(413);
    const flux = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < 10; i += 1) c.enqueue(new TextEncoder().encode("x".repeat(50)));
        c.close();
      },
    });
    const lu = await lireCorpsJson(new Request("http://127.0.0.1/api", { method: "PUT", body: flux, headers: json, duplex: "half" } as RequestInit), 100);
    expect(lu.ok ? 200 : lu.reponse.status).toBe(413);
    if (!lu.ok) expect(await lu.reponse.json()).toEqual({ erreur: "docs.erreur.trop_volumineux" });
  });

  it("JSON invalide, encodage invalide ou corps absent : 400", async () => {
    for (const corps of ["{pas du json", new Uint8Array([0x7b, 0xff, 0x7d]), null]) {
      const r = await lireCorpsJson(requete(corps as BodyInit | null, json));
      expect(r.ok ? 200 : r.reponse.status).toBe(400);
    }
  });

  it("les réponses JSON ne sont jamais mises en cache", () => {
    expect(reponseJson({}).headers.get("cache-control")).toBe("no-store");
  });
});
