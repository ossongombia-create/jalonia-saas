// La personne qui agit (pour les contrôles et le journal d'audit).
export interface Acteur {
  id: string;
  email: string;
  ip?: string | null;
  agent?: string | null;
}

export function traceActeur(a: Acteur) {
  return { acteurId: a.id, acteurEmail: a.email, ip: a.ip ?? null, agent: a.agent ?? null };
}
