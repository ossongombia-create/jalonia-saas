// Erreur « métier » : un refus attendu (règle de gestion), avec une clé de message traduisible.
// Toute autre erreur est inattendue et ne doit pas être montrée telle quelle à l'utilisateur.
export class ErreurMetier extends Error {
  constructor(public readonly cle: string) {
    super(cle);
    this.name = "ErreurMetier";
  }
}

/** Code d'erreur PostgreSQL « violation d'unicité ». */
export const PG_UNICITE = "23505";

export function estErreurPg(erreur: unknown, code: string): boolean {
  return typeof erreur === "object" && erreur !== null && "code" in erreur && (erreur as { code?: unknown }).code === code;
}

/** Nom de la contrainte PostgreSQL en cause (ex. « organisations_slug_key »), s'il est connu. */
export function contrainteEnCause(erreur: unknown): string | undefined {
  if (typeof erreur !== "object" || erreur === null || !("constraint" in erreur)) return undefined;
  const c = (erreur as { constraint?: unknown }).constraint;
  return typeof c === "string" ? c : undefined;
}
