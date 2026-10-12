import type { NextConfig } from "next";

// La politique de sécurité du contenu (CSP) est posée par le proxy (src/proxy.ts, src/lib/csp.ts) : un nonce
// neuf par page. Ici, les autres en-têtes de sécurité, pour toutes les réponses.

const nextConfig: NextConfig = {
  // Sortie autonome : un dossier .next/standalone qui tourne avec « node server.js », sans le dépôt complet.
  output: "standalone",
  poweredByHeader: false,
  // Pas d'optimiseur d'images (/_next/image répond 404) : l'application n'affiche que des SVG (déjà servis tels
  // quels) ; et le service, en lecture seule (deploy/jalonia.service), ne pourrait pas garder les images calculées
  // en cache : chaque requête referait le calcul.
  images: { unoptimized: true },
  // « cacheComponents » est volontairement désactivé : application d'administration entièrement
  // dynamique (chaque page dépend de l'utilisateur et de son organisation). Voir docs/DECISIONS.md.
  async headers() {
    const entetes = [
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    ];
    return [{ source: "/:path*", headers: entetes }];
  },
};

export default nextConfig;
