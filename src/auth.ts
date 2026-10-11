// Auth.js (next-auth v5) : connexion par e-mail et mot de passe.
//
// Le jeton (cookie chiffré, httpOnly) ne contient que l'identifiant de l'utilisateur et celui de sa
// session. La session est REVÉRIFIÉE en base à chaque requête (voir src/server/web/contexte.ts) : une
// session fermée (déconnexion, révocation, expiration, compte désactivé) est refusée immédiatement,
// même si le cookie est encore valide.
//
// Aucune route /api/auth n'est exposée : connexion et déconnexion passent par des actions serveur.
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { schemaConnexion } from "@/lib/validation";
import { authentifier } from "@/server/auth/connexion";
import { poolApplication } from "@/server/db/pools";
import { config } from "@/server/config";
import { agentDepuisEntetes, ipDepuisEntetes } from "@/server/web/reseau";

// Configuration « paresseuse » : lue à l'exécution (les variables d'environnement du serveur), pas à la compilation.
export const { auth, signIn, signOut } = NextAuth(() => ({
  trustHost: true,
  session: { strategy: "jwt", maxAge: config().SESSION_DUREE_HEURES * 3600 },
  pages: { signIn: "/connexion", error: "/connexion" },
  providers: [
    Credentials({
      credentials: { email: {}, motDePasse: {} },
      async authorize(saisie, requete) {
        const lu = schemaConnexion.safeParse(saisie);
        if (!lu.success) return null;
        const resultat = await authentifier(poolApplication(), {
          email: lu.data.email,
          motDePasse: lu.data.motDePasse,
          ip: ipDepuisEntetes(requete.headers),
          agent: agentDepuisEntetes(requete.headers),
        });
        if (!resultat.ok) return null; // message générique : on ne dit pas pourquoi
        return { id: resultat.utilisateur.id, email: resultat.utilisateur.email, name: resultat.utilisateur.nom, sid: resultat.sessionId };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.uid = user.id;
        token.sid = (user as { sid?: unknown }).sid;
      }
      return token;
    },
    session({ session, token }) {
      return Object.assign(session, {
        uid: typeof token.uid === "string" ? token.uid : undefined,
        sid: typeof token.sid === "string" ? token.sid : undefined,
      });
    },
  },
}));
