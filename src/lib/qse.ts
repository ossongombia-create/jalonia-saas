// Règles QSE partagées (audit Q1) : cotation des risques et des opportunités (MÊMES règles que l'éditeur :
// editeur/js/model.js, vérifié par un test), objectifs des indicateurs, avancement des actions.

// ---------------------------------------------------------------------------------------------------
// Risques et opportunités (cotation saisie dans les instructions des procédures)
// ---------------------------------------------------------------------------------------------------

export type NiveauRisque = "critique" | "significatif" | "acceptable";

/**
 * Criticité = Impact × Vraisemblance (1 à 4 chacun, entiers) : critique si C ≥ 9 OU Impact = 4 ; significatif si
 * 5 ≤ C ≤ 8 ; acceptable si C ≤ 4. null si la cotation est incomplète ou invalide.
 */
export function criticite(risque: { gravite?: unknown; probabilite?: unknown }): { valeur: number; g: number; p: number; niveau: NiveauRisque } | null {
  const g = Number(risque.gravite);
  const p = Number(risque.probabilite);
  if (!(Number.isInteger(g) && Number.isInteger(p) && g >= 1 && g <= 4 && p >= 1 && p <= 4)) return null;
  const valeur = g * p;
  const niveau: NiveauRisque = g === 4 || valeur >= 9 ? "critique" : valeur >= 5 ? "significatif" : "acceptable";
  return { valeur, g, p, niveau };
}

/** Score d'une opportunité = intérêt × faisabilité (1 à 3 chacun) : ≥ 6 → plan d'amélioration, sinon à étudier. */
export function scoreOpportunite(opp: { interet?: unknown; faisabilite?: unknown }): { valeur: number; i: number; f: number; suite: "plan" | "etudier" } | null {
  const i = Number(opp.interet);
  const f = Number(opp.faisabilite);
  if (!(Number.isInteger(i) && Number.isInteger(f) && i >= 1 && i <= 3 && f >= 1 && f <= 3)) return null;
  const valeur = i * f;
  return { valeur, i, f, suite: valeur >= 6 ? "plan" : "etudier" };
}

// ---------------------------------------------------------------------------------------------------
// Indicateurs
// ---------------------------------------------------------------------------------------------------

export type SensObjectif = "min" | "max";

/** L'objectif est-il atteint ? « min » : au moins le seuil ; « max » : au plus le seuil. */
export function objectifAtteint(sens: SensObjectif, seuil: number, valeur: number): boolean {
  return sens === "min" ? valeur >= seuil : valeur <= seuil;
}

/** Bornes des nombres rangés (numeric(18, 4)) : 14 chiffres avant la virgule, 4 après. */
export const NOMBRE_MAX = 99_999_999_999_999;

/** Lit un nombre saisi (« 95 », « 95,5 », « -3.25 ») ; null s'il est illisible, hors bornes ou a plus de 4 décimales. */
export function lireNombre(saisie: string): number | null {
  const t = saisie.trim().replace(/\s/g, "").replace(",", ".");
  if (!/^-?\d{1,14}(\.\d{1,4})?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) && Math.abs(n) <= NOMBRE_MAX ? n : null;
}

// ---------------------------------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------------------------------

export const ORIGINES_ACTION = ["risque", "opportunite", "indicateur", "revue", "audit", "non_conformite", "reclamation", "autre"] as const;
export type OrigineAction = (typeof ORIGINES_ACTION)[number];

export const STATUTS_ACTION = ["a_faire", "en_cours", "realisee", "cloturee", "abandonnee"] as const;
export type StatutAction = (typeof STATUTS_ACTION)[number];

/** Une action est « ouverte » tant qu'elle n'est ni réalisée, ni close, ni abandonnée : son échéance compte. */
export const STATUTS_OUVERTS: readonly StatutAction[] = ["a_faire", "en_cours"];

/**
 * Avancement permis : à faire ↔ en cours → réalisée → close (efficacité vérifiée) ; une action réalisée peut être
 * rouverte (en cours) si la vérification montre qu'il reste à faire ; abandon possible tant qu'elle n'est pas close.
 * Close et abandonnée sont définitives (une nouvelle action se crée si besoin).
 */
export const SUITES_STATUT: Record<StatutAction, readonly StatutAction[]> = {
  a_faire: ["en_cours", "realisee", "abandonnee"],
  en_cours: ["a_faire", "realisee", "abandonnee"],
  realisee: ["en_cours", "cloturee", "abandonnee"],
  cloturee: [],
  abandonnee: [],
};

export function estOrigine(v: unknown): v is OrigineAction {
  return typeof v === "string" && (ORIGINES_ACTION as readonly string[]).includes(v);
}

export function estStatut(v: unknown): v is StatutAction {
  return typeof v === "string" && (STATUTS_ACTION as readonly string[]).includes(v);
}

/**
 * Refus éventuel d'un changement de statut (clé de message) : statut d'arrivée non permis, efficacité manquante pour
 * clore, motif manquant pour abandonner.
 */
export function refusStatut(avant: StatutAction, apres: StatutAction, efficace: boolean | null, resultat: string): string | null {
  if (avant === apres) return apres === "cloturee" || apres === "abandonnee" ? "actions.definitive" : null;
  if (!SUITES_STATUT[avant].includes(apres)) return avant === "cloturee" || avant === "abandonnee" ? "actions.definitive" : "actions.statut_impossible";
  if (apres === "cloturee" && efficace === null) return "actions.efficacite_requise";
  if (apres === "abandonnee" && resultat.trim() === "") return "actions.motif_abandon";
  return null;
}
