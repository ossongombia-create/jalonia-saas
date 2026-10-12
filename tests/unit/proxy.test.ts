// Filtre « proxy » : redirection sans cookie, 401 JSON pour l'API, 404 pour l'optimiseur d'images désactivé,
// et chemins que le filtre laisse passer sans connexion (matcher).
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { config, proxy } from "../../src/proxy";

const BASE = "https://jalonia.exemple";
const requete = (chemin: string, cookie?: string) => new NextRequest(`${BASE}${chemin}`, { headers: cookie ? { cookie } : {} });
const laisse = (r: Response) => r.headers.get("x-middleware-next") === "1";

describe("proxy", () => {
  it("optimiseur d'images : 404 immédiat, avec ou sans cookie", () => {
    for (const cookie of [undefined, "authjs.session-token=abc"]) {
      const r = proxy(requete("/_next/image?url=%2Ficones%2Ficone-192.png&w=64&q=75", cookie));
      expect(r.status).toBe(404);
      expect(laisse(r)).toBe(false);
    }
  });

  it("sans cookie : redirection vers /connexion (pages), 401 JSON (API)", async () => {
    const page = proxy(requete("/app/documents"));
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toBe(`${BASE}/connexion`);
    const api = proxy(requete("/api/documents"));
    expect(api.status).toBe(401);
    expect(await api.json()).toEqual({ erreur: "session" });
  });

  it("page de connexion, ou cookie de session présent : la requête continue", () => {
    expect(laisse(proxy(requete("/connexion")))).toBe(true);
    expect(laisse(proxy(requete("/app", "authjs.session-token=abc")))).toBe(true);
    expect(laisse(proxy(requete("/app", "__Secure-authjs.session-token.0=abc")))).toBe(true);
    expect(laisse(proxy(requete("/app", "autre=abc")))).toBe(false);
  });

  it("matcher : /_next/image passe par le filtre ; fichiers statiques, icônes, manifeste et sonde n'y passent pas", () => {
    const motif = new RegExp(`^${config.matcher[0]}$`);
    for (const chemin of ["/_next/image", "/app", "/api/documents", "/connexion", "/editeur/index.html"]) expect(motif.test(chemin), chemin).toBe(true);
    for (const chemin of ["/api/sante", "/_next/static/chunks/a.js", "/favicon.ico", "/icon.svg", "/apple-icon.png", "/manifest.webmanifest", "/icones/icone-192.png"]) {
      expect(motif.test(chemin), chemin).toBe(false);
    }
  });
});
