// Accueil : oriente chaque personne vers son espace.
import { redirect } from "next/navigation";
import { accueilDe, lireContexte } from "@/server/web/contexte";

export default async function Accueil() {
  const ctx = await lireContexte();
  redirect(ctx ? accueilDe(ctx) : "/connexion");
}
