// Titre d'onglet traduit dans la langue de la personne.
import "server-only";
import type { Metadata } from "next";
import { traducteur, type Cle } from "@/lib/i18n";
import { lireLangue } from "./contexte";

export function titrePage(cle: Cle): () => Promise<Metadata> {
  return async () => ({ title: traducteur(await lireLangue())(cle) });
}
