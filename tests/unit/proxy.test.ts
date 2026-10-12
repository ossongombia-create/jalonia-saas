// Filtre « proxy » : redirection sans cookie, 401 JSON pour l'API, 404 pour l'optimiseur d'images désactivé,
// chemins que le filtre laisse passer sans connexion (matcher), politique de sécurité du contenu (production).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { getScriptNonceFromHeader } from "next/dist/server/app-render/get-script-nonce-from-header";
import { config, proxy } from "../../src/proxy";
import { nouveauNonce, politiquePages, POLITIQUE_EDITEUR } from "../../src/lib/csp";

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

describe("politique de sécurité du contenu (production)", () => {
  const csp = (r: Response) => r.headers.get("content-security-policy");
  const directive = (politique: string, nom: string) => politique.split(";").map((d) => d.trim()).find((d) => d.startsWith(`${nom} `));
  beforeEach(() => vi.stubEnv("NODE_ENV", "production"));
  afterEach(() => vi.unstubAllEnvs());

  it("pages : un nonce neuf par requête, lisible par Next.js, transmis à la page et au navigateur", () => {
    const r1 = proxy(requete("/app", "authjs.session-token=abc"));
    const r2 = proxy(requete("/connexion"));
    const p1 = csp(r1)!;
    const p2 = csp(r2)!;
    const n1 = getScriptNonceFromHeader(p1);
    const n2 = getScriptNonceFromHeader(p2);
    expect(n1).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(n2).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(n1).not.toBe(n2);
    expect(directive(p1, "script-src")).toBe(`script-src 'self' 'nonce-${n1}' 'strict-dynamic'`);
    // Next.js lit la politique dans l'en-tête de la REQUÊTE transmise à la page : la même.
    expect(r1.headers.get("x-middleware-request-content-security-policy")).toBe(p1);
    expect(laisse(r1)).toBe(true);
  });

  it("une CSP envoyée par le client est remplacée", () => {
    const req = new NextRequest(`${BASE}/app`, { headers: { cookie: "authjs.session-token=abc", "content-security-policy": "script-src 'nonce-AAAAAAAAAAAAAAAAAAAAAA=='" } });
    const r = proxy(req);
    expect(getScriptNonceFromHeader(r.headers.get("x-middleware-request-content-security-policy")!)).not.toBe("AAAAAAAAAAAAAAAAAAAAAA==");
  });

  it("aucun script en ligne permis, ni eval ; cadres, objets et formulaires restreints", () => {
    for (const politique of [csp(proxy(requete("/app", "authjs.session-token=abc")))!, POLITIQUE_EDITEUR]) {
      const scripts = directive(politique, "script-src")!;
      expect(scripts).not.toContain("unsafe-inline");
      expect(scripts).not.toContain("unsafe-eval");
      expect(politique).toContain("frame-ancestors 'none'");
      expect(politique).toContain("object-src 'none'");
      expect(politique).toContain("base-uri 'self'");
      expect(politique).toContain("form-action 'self'");
      expect(politique).toContain("default-src 'self'");
    }
  });

  it("éditeur : politique fixe (ses seuls fichiers .js) ; API : pas de CSP", () => {
    const editeur = proxy(requete("/editeur/index.html?doc=1", "authjs.session-token=abc"));
    expect(csp(editeur)).toBe(POLITIQUE_EDITEUR);
    expect(directive(POLITIQUE_EDITEUR, "script-src")).toBe("script-src 'self'");
    expect(csp(proxy(requete("/api/documents", "authjs.session-token=abc")))).toBeNull();
  });

  it("hors production : pas de CSP (le rechargement à chaud de Next.js a besoin d'eval)", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(csp(proxy(requete("/app", "authjs.session-token=abc")))).toBeNull();
  });

  it("nouveauNonce : 128 bits, jamais deux fois le même", () => {
    const vus = new Set(Array.from({ length: 1000 }, () => nouveauNonce()));
    expect(vus.size).toBe(1000);
    for (const n of vus) expect(Buffer.from(n, "base64")).toHaveLength(16);
    expect(politiquePages("abc")).toContain("'nonce-abc'");
  });
});
