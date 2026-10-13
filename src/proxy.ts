// Filtre « proxy » (Next.js 16) :
//   1. redirection RAPIDE vers la connexion quand il n'y a même pas de cookie de session. C'est un confort, pas
//      une protection : la vraie vérification (session en base, rôles, organisation) est faite par chaque page et
//      chaque action serveur (src/server/web/contexte.ts) ;
//   2. en production, la politique de sécurité du contenu (src/lib/csp.ts) : un nonce neuf à chaque page,
//      une politique fixe pour l'éditeur.
import { NextResponse, type NextRequest } from "next/server";
import { nouveauNonce, politiquePages, POLITIQUE_EDITEUR } from "./lib/csp";

const COOKIE_SESSION = /^(__Secure-)?authjs\.session-token(\.\d+)?$/;
// Pages accessibles sans session : la connexion, et les invitations (/invitation/<jeton>, voir plus bas).
const PAGES_PUBLIQUES = new Set(["/connexion"]);
const CSP = "Content-Security-Policy";

export function proxy(requete: NextRequest) {
  const { pathname } = requete.nextUrl;
  // Optimiseur d'images désactivé (next.config.ts) : on répond 404 ici, avant que Next.js ne tente de créer son
  // dossier de cache dans le code en service, qui est en lecture seule (erreur au journal à chaque requête).
  if (pathname === "/_next/image") return new NextResponse(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  const aUnCookie = requete.cookies.getAll().some((c) => COOKIE_SESSION.test(c.name));
  if (!aUnCookie && !PAGES_PUBLIQUES.has(pathname) && !pathname.startsWith("/invitation/")) {
    // Les routes JSON (éditeur) répondent 401 : une redirection vers la page de connexion ne leur servirait à rien.
    if (pathname.startsWith("/api/")) return NextResponse.json({ erreur: "session" }, { status: 401, headers: { "Cache-Control": "no-store" } });
    return NextResponse.redirect(new URL("/connexion", requete.url));
  }
  return continuer(requete, pathname);
}

/** La requête continue ; en production, avec sa politique de sécurité du contenu. */
function continuer(requete: NextRequest, pathname: string): NextResponse {
  if (process.env.NODE_ENV !== "production" || pathname.startsWith("/api/")) return NextResponse.next();
  if (pathname === "/editeur" || pathname.startsWith("/editeur/")) {
    const reponse = NextResponse.next();
    reponse.headers.set(CSP, POLITIQUE_EDITEUR);
    return reponse;
  }
  // Pages : Next.js lit le nonce dans l'en-tête CSP de la REQUÊTE et l'ajoute à ses propres scripts ; le
  // navigateur reçoit la même politique dans la RÉPONSE. (Toute CSP envoyée par le client est remplacée.)
  const politique = politiquePages(nouveauNonce());
  const entetes = new Headers(requete.headers);
  entetes.set(CSP, politique);
  const reponse = NextResponse.next({ request: { headers: entetes } });
  reponse.headers.set(CSP, politique);
  return reponse;
}

export const config = {
  // Tout, sauf : la sonde de santé, les fichiers statiques de Next.js, et ce que le navigateur demande SANS
  // être connecté — icônes, manifeste d'installation (sinon : redirection, et icône ou installation cassées).
  // (/_next/image passe par ici : voir plus haut.)
  matcher: ["/((?!api/sante|_next/static|favicon\\.ico$|icon(?:\\.svg)?$|apple-icon(?:\\.png)?$|manifest\\.webmanifest$|icones/).*)"],
};
