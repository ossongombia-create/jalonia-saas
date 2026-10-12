// La personne qui agit (pour les contrôles et le journal d'audit).
export interface Acteur {
  id: string;
  email: string;
  /** Nom affiché (ex. « modifié par … » sur un document). À défaut : l'e-mail. */
  nom?: string;
  ip?: string | null;
  agent?: string | null;
}

export function nomActeur(a: Acteur): string {
  return (a.nom ?? "").trim() || a.email;
}

export function traceActeur(a: Acteur) {
  return { acteurId: a.id, acteurEmail: a.email, ip: a.ip ?? null, agent: a.agent ?? null };
}
