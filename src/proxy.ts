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
  // Les routes JSON (éditeur) répondent 401 : une redirection vers la page de connexion ne leur servirait à rien.
  if (pathname.startsWith("/api/")) return NextResponse.json({ erreur: "session" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  return NextResponse.redirect(new URL("/connexion", requete.url));
}

export const config = {
  // Tout, sauf : la sonde de santé, les fichiers statiques de Next.js, et ce que le navigateur demande SANS
  // être connecté — icônes, manifeste d'installation (sinon : redirection, et icône ou installation cassées).
  matcher: ["/((?!api/sante|_next/static|_next/image|favicon\\.ico$|icon(?:\\.svg)?$|apple-icon(?:\\.png)?$|manifest\\.webmanifest$|icones/).*)"],
};
