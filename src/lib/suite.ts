// Retour après la connexion (« ?suite=… ») : seul le chemin d'une invitation est accepté (aucune redirection
// vers un autre site ni vers une page arbitraire).
const SUITE_PERMISE = /^\/invitation\/[A-Za-z0-9_-]{43}$/;

/** La suite si elle est permise, sinon "". */
export function suiteValide(valeur: unknown): string {
  return typeof valeur === "string" && SUITE_PERMISE.test(valeur) ? valeur : "";
}

/** « ?suite=… » à ajouter à une adresse (vide s'il n'y a pas de suite). */
export function parametreSuite(suite: string): string {
  return suite ? `?suite=${encodeURIComponent(suite)}` : "";
}
