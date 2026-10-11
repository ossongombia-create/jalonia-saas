// Filtre « proxy » (Next.js 16) : redirection RAPIDE vers la connexion quand il n'y a même pas de cookie
// de session. C'est un confort, pas une protection : la vraie vérification (session en base, rôles,
// organisation) est faite par chaque page et chaque action serveur (src/server/web/contexte.ts).
import { NextResponse, type NextRequest } from "next/server";

const COOKIE_SESSION = /^(__Secure-)?authjs\.session-token(\.\d+)?$/;
const PAGES_PUBLIQUES = new Set(["/connexion"]);

export function proxy(requete: NextRequest) {
  const { pathname } = requete.nextUrl;
  if (PAGES_PUBLIQUES.has(pathname)) return NextResponse.next();
  const aUnCookie = requete.cookies.getAll().some((c) => COOKIE_SESSION.test(c.name));
  if (aUnCookie) return NextResponse.next();
  return NextResponse.redirect(new URL("/connexion", requete.url));
}

export const config = {
  // Tout, sauf la sonde de santé, les fichiers statiques de Next.js et l'icône.
  matcher: ["/((?!api/sante|_next/static|_next/image|favicon\\.ico).*)"],
};
