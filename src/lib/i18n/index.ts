// Traduction de l'interface (français / anglais). Sans dépendance serveur : utilisable partout.
import { fr, type Cle } from "./fr";
import { en } from "./en";

export type { Cle } from "./fr";

export const LANGUES = ["fr", "en"] as const;
export type Langue = (typeof LANGUES)[number];
export const LANGUE_PAR_DEFAUT: Langue = "fr";

const DICTIONNAIRES: Record<Langue, Record<Cle, string>> = { fr, en };

export type Variables = Record<string, string | number>;
export type Traducteur = (cle: Cle, variables?: Variables) => string;

export function estLangue(valeur: unknown): valeur is Langue {
  return typeof valeur === "string" && (LANGUES as readonly string[]).includes(valeur);
}

export function estCle(valeur: string): valeur is Cle {
  return Object.hasOwn(fr, valeur);
}

function remplir(texte: string, variables?: Variables): string {
  if (!variables) return texte;
  return texte.replace(/\{(\w+)\}/g, (tout, nom: string) => (nom in variables ? String(variables[nom]) : tout));
}

export function traducteur(langue: Langue): Traducteur {
  const dico = DICTIONNAIRES[langue];
  return (cle, variables) => remplir(dico[cle], variables);
}

/** Traduit une clé venue du serveur (ex. erreur métier). Clé inconnue : message d'erreur générique. */
export function traduireMessage(langue: Langue, cle: string, variables?: Variables): string {
  const t = traducteur(langue);
  return estCle(cle) ? t(cle, variables) : t("erreur.inattendue");
}

/** Nombre de clés (sert aux tests de parité). */
export function clesDe(langue: Langue): string[] {
  return Object.keys(DICTIONNAIRES[langue]).sort();
}
