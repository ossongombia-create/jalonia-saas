// Mise en forme des dates et durées pour l'affichage.
import type { Langue, Traducteur } from "./i18n";

const LOCALES: Record<Langue, string> = { fr: "fr-FR", en: "en-GB" };

export function formaterDate(langue: Langue, date: Date | string | null | undefined, fuseau: string): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat(LOCALES[langue], { dateStyle: "short", timeStyle: "short", timeZone: fuseau }).format(d);
}

/** Durée lisible à partir d'un nombre de secondes : « 45 min », « 3 h 05 min ». */
export function formaterDuree(t: Traducteur, secondes: number | null | undefined): string {
  if (secondes === null || secondes === undefined || !Number.isFinite(secondes)) return "—";
  const minutes = Math.max(0, Math.round(secondes / 60));
  if (minutes < 60) return t("commun.duree_min", { m: minutes });
  return t("commun.duree_h", { h: Math.floor(minutes / 60), m: String(minutes % 60).padStart(2, "0") });
}

/** Navigateur résumé (la chaîne complète reste dans le journal). */
export function resumerAgent(agent: string | null | undefined): string {
  if (!agent) return "—";
  const reperes: [RegExp, string][] = [
    [/Edg\//, "Edge"],
    [/OPR\//, "Opera"],
    [/Firefox\//, "Firefox"],
    [/Chrome\//, "Chrome"],
    [/Safari\//, "Safari"],
  ];
  const nav = reperes.find(([motif]) => motif.test(agent))?.[1] ?? "?";
  const os = /Windows/.test(agent) ? "Windows" : /Android/.test(agent) ? "Android" : /iPhone|iPad/.test(agent) ? "iOS" : /Mac OS X/.test(agent) ? "macOS" : /Linux/.test(agent) ? "Linux" : "";
  return os ? `${nav} · ${os}` : nav;
}
