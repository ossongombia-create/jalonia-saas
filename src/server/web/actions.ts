// Exécution encadrée des actions serveur : traduction des refus « métier », masquage des erreurs
// inattendues (journalisées côté serveur, jamais montrées telles quelles), rafraîchissement de la page.
import "server-only";
import { refresh } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import type { ZodType } from "zod";
import { traduireMessage, type Langue, type Variables } from "@/lib/i18n";
import { premiereErreur } from "@/lib/validation";
import type { EtatAction } from "@/lib/etat-action";
import { ErreurMetier } from "../erreurs";

export interface Reussite {
  cle: string;
  variables?: Variables;
  /** Chemin d'un lien à transmettre (voir EtatAction.lien). */
  lien?: string;
}

export async function executer(langue: Langue, travail: () => Promise<Reussite>): Promise<EtatAction> {
  try {
    const r = await travail();
    refresh();
    return { ok: true, message: traduireMessage(langue, r.cle, r.variables), jeton: Date.now(), ...(r.lien ? { lien: r.lien } : {}) };
  } catch (erreur) {
    unstable_rethrow(erreur); // redirect(), notFound()… doivent remonter à Next.js
    if (erreur instanceof ErreurMetier) return { ok: false, message: traduireMessage(langue, erreur.cle), jeton: Date.now() };
    console.error("[jalonia] erreur inattendue dans une action :", erreur);
    return { ok: false, message: traduireMessage(langue, "erreur.inattendue"), jeton: Date.now() };
  }
}

/** Valide un formulaire ; lève une ErreurMetier (clé traduisible) si la saisie est invalide. */
export function valider<T>(schema: ZodType<T>, donnees: unknown): T {
  const lu = schema.safeParse(donnees);
  if (!lu.success) throw new ErreurMetier(premiereErreur(lu.error));
  return lu.data;
}

/** Champ texte d'un formulaire (chaîne vide s'il est absent ou n'est pas du texte). */
export function champ(formulaire: FormData, nom: string): string {
  const v = formulaire.get(nom);
  return typeof v === "string" ? v : "";
}
