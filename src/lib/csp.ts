// Politiques de sécurité du contenu (CSP), posées par le proxy (src/proxy.ts), en production.
//
// - Pages Next.js : scripts autorisés UNIQUEMENT s'ils portent le nonce de la requête (Next.js l'ajoute lui-même à
//   ses scripts, en le lisant dans l'en-tête Content-Security-Policy de la requête) ; « strict-dynamic » laisse
//   ces scripts charger les morceaux suivants de l'application. Aucun script en ligne injecté ne peut s'exécuter.
// - Éditeur (fichiers statiques /editeur/…) : il ne contient aucun script en ligne ; seuls ses fichiers .js
//   (même origine) s'exécutent.
// Les styles restent permis en ligne (« unsafe-inline ») : React écrit des attributs style, et l'éditeur dessine
// ses SVG avec des attributs style. Un nonce ne couvre pas les attributs, et sa présence annulerait
// « unsafe-inline ». Le risque d'un style injecté est bien moindre que celui d'un script.

const COMMUN = [
  "default-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
];

/** Nonce imprévisible, propre à une requête (128 bits, base64). */
export function nouveauNonce(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64");
}

/** CSP des pages de l'application : seuls les scripts portant ce nonce s'exécutent. */
export function politiquePages(nonce: string): string {
  return [`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`, ...COMMUN].join("; ");
}

/** CSP de l'éditeur (fichiers statiques sans script en ligne). */
export const POLITIQUE_EDITEUR = ["script-src 'self'", ...COMMUN].join("; ");
