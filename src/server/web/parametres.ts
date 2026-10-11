// Lecture prudente des paramètres d'adresse (?page=2&action=CONNEXION).
import { estAction, type Action } from "@/lib/actions-journal";

type Parametres = Record<string, string | string[] | undefined>;

function premier(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export function lireFiltreJournal(p: Parametres): { page: number; action?: Action } {
  const page = Number.parseInt(premier(p.page) ?? "1", 10);
  const action = premier(p.action);
  return { page: Number.isInteger(page) && page >= 1 && page <= 10_000 ? page : 1, action: estAction(action) ? action : undefined };
}
