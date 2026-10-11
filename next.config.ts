import type { NextConfig } from "next";

// Politique de sécurité du contenu (CSP), appliquée en production uniquement : en développement,
// le rechargement à chaud de Next.js a besoin de eval().
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  // Sortie autonome : un dossier .next/standalone qui tourne avec « node server.js », sans le dépôt complet.
  output: "standalone",
  poweredByHeader: false,
  // « cacheComponents » est volontairement désactivé : application d'administration entièrement
  // dynamique (chaque page dépend de l'utilisateur et de son organisation). Voir docs/DECISIONS.md.
  async headers() {
    const entetes = [
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    ];
    if (process.env.NODE_ENV === "production") entetes.push({ key: "Content-Security-Policy", value: CSP });
    return [{ source: "/:path*", headers: entetes }];
  },
};

export default nextConfig;
