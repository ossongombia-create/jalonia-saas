// Redirections : n'accepter qu'un chemin de CE site (empêche l'envoi vers un autre site,
// par exemple avec « //exemple.com » ou « /\exemple.com », que les navigateurs lisent comme une autre adresse).
const ORIGINE = "http://jalonia.invalid";

export function cheminInterne(valeur: string): string {
  if (!valeur.startsWith("/")) return "/";
  try {
    const url = new URL(valeur, ORIGINE);
    return url.origin === ORIGINE ? `${url.pathname}${url.search}` : "/";
  } catch {
    return "/";
  }
}
