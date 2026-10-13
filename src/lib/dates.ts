// Jours calendaires (« AAAA-MM-JJ ») : échéances des revues et des actions (audit W2, Q1).
// Un jour n'a pas de fuseau : il se calcule à partir d'un instant DANS le fuseau de la plateforme (jourLocal), puis
// toute l'arithmétique se fait sur des dates UTC sans heure (aucun effet des changements d'heure).

const MOTIF_JOUR = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Le jour est-il une date réelle au format AAAA-MM-JJ ? (refuse 2026-02-30, 2026-13-01…) */
export function estJour(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const m = MOTIF_JOUR.exec(v);
  if (!m) return false;
  const [a, mo, j] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (a < 1900 || a > 2999) return false;
  const d = new Date(Date.UTC(a, mo - 1, j));
  return d.getUTCFullYear() === a && d.getUTCMonth() === mo - 1 && d.getUTCDate() === j;
}

function versDate(jour: string): Date {
  if (!estJour(jour)) throw new Error(`jour invalide : ${jour}`);
  const [a, m, j] = jour.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(a, m - 1, j));
}

function versJour(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Le jour (AAAA-MM-JJ) que l'instant représente dans le fuseau donné (nom IANA). */
export function jourLocal(instant: Date, fuseau: string): string {
  const parties = new Intl.DateTimeFormat("en-US", { timeZone: fuseau, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(instant);
  const v = (type: string) => parties.find((p) => p.type === type)?.value ?? "";
  return `${v("year")}-${v("month")}-${v("day")}`;
}

export function ajouterJours(jour: string, n: number): string {
  const d = versDate(jour);
  d.setUTCDate(d.getUTCDate() + n);
  return versJour(d);
}

/**
 * Ajoute des mois ; si le jour n'existe pas dans le mois d'arrivée, on prend le dernier jour de ce mois
 * (31 janvier + 1 mois = 28 ou 29 février), comme PostgreSQL.
 */
export function ajouterMois(jour: string, n: number): string {
  const d = versDate(jour);
  const cible = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const dernier = new Date(Date.UTC(cible.getUTCFullYear(), cible.getUTCMonth() + 1, 0)).getUTCDate();
  cible.setUTCDate(Math.min(d.getUTCDate(), dernier));
  return versJour(cible);
}

/** Nombre de jours de `de` à `a` (positif si `a` est après `de`). */
export function ecartJours(de: string, a: string): number {
  return Math.round((versDate(a).getTime() - versDate(de).getTime()) / 86_400_000);
}

/**
 * Situation d'une échéance aujourd'hui :
 *   - « a_jour »    : plus de `rappelJours` jours avant l'échéance ;
 *   - « proche »    : dans les `rappelJours` jours qui précèdent l'échéance, ou le jour même ;
 *   - « retard »    : échéance dépassée depuis moins de `escaladeJours` jours ;
 *   - « escalade »  : échéance dépassée depuis `escaladeJours` jours ou plus.
 */
export type SituationEcheance = "a_jour" | "proche" | "retard" | "escalade";

export function situationEcheance(echeance: string, aujourdhui: string, rappelJours: number, escaladeJours: number): SituationEcheance {
  const restant = ecartJours(aujourdhui, echeance);
  if (restant > rappelJours) return "a_jour";
  if (restant >= 0) return "proche";
  return -restant >= escaladeJours ? "escalade" : "retard";
}
