// Cohérence ENTRE les documents d'une organisation (audit 4.3, D2). L'éditeur contrôle un document à la fois, par rapport
// à la cartographie (editeur/js/rules-codes.js) ; ici, le serveur regarde l'ensemble des documents enregistrés :
//   - un même code porté par plusieurs documents ;
//   - une instruction de la procédure marquée « niveau 3 » dont l'instruction de travail n'existe pas (ou n'en est pas une) ;
//   - une instruction de travail qu'aucune procédure ne cite, ou qui n'a pas de code ;
//   - une sous-procédure appelée qu'aucune procédure ne porte ;
//   - un processus de rattachement absent de la cartographie.
// Ces contrôles SIGNALENT : ils ne modifient ni ne suppriment rien. La suppression d'un document lié à d'autres demande
// une confirmation explicite (supprimerDocument), et les documents liés ne sont jamais supprimés avec lui.
import type { PoolClient } from "pg";
import type { TypeDocument } from "./service";

/** Ce qu'un document dit de ses liens (lu dans son contenu). */
export interface LiensDocument {
  id: string;
  type: TypeDocument;
  titre: string;
  reference: string;
  /** Champ « Processus » de l'identification (« ACH Acheter… » ou « ACH »). */
  processus: string;
  /** Codes des instructions de travail citées (instructions marquées « niveau 3 »). */
  n3: string[];
  /** Codes des sous-procédures appelées. */
  sousProcedures: string[];
}

export interface ProcessusCartographie {
  code: string;
  nom: string;
}

export interface DocumentCite {
  id: string;
  type: TypeDocument;
  titre: string;
  reference: string;
}

export type CleConstat = "code_double" | "n3_absente" | "n3_pas_instruction" | "it_non_rattachee" | "it_sans_code" | "sp_absente" | "processus_inconnu";

export interface Constat {
  /** « alerte » : à corriger ; « info » : état normal en cours de rédaction (ex. instruction pas encore créée). */
  gravite: "alerte" | "info";
  cle: CleConstat;
  code?: string;
  processus?: string;
  documents: DocumentCite[];
}

export type NatureLien = "instruction" | "citante" | "appelante";

export interface Dependance extends DocumentCite {
  /** instruction : instruction de travail de cette procédure ; citante : procédure qui cite cette instruction ;
   *  appelante : procédure qui appelle cette procédure comme sous-procédure. */
  lien: NatureLien;
}

/** Code comparable : sans espaces superflus, en majuscules (comme l'éditeur). */
export function normaliserCode(code: string): string {
  return code.trim().replace(/\s+/g, " ").toUpperCase();
}

const cite = (d: LiensDocument): DocumentCite => ({ id: d.id, type: d.type, titre: d.titre, reference: d.reference });
/** Procédure au sens des liens : tout document qui n'est pas une instruction de travail (y compris un document sans type). */
const estProcedure = (d: LiensDocument) => d.type !== "instruction";
const codesDe = (liste: string[]) => [...new Set(liste.map(normaliserCode).filter(Boolean))];

/** Même règle que l'éditeur (cartographie.js, processusDuTexte) : « CODE Nom » ou « CODE », sans tenir compte des majuscules. */
export function processusConnu(processus: ProcessusCartographie[], texte: string): boolean {
  const s = texte.trim().toLowerCase();
  if (!s) return true;
  return processus.some((p) => (p.nom ? `${p.code} ${p.nom}` : p.code).toLowerCase() === s || p.code.toLowerCase() === s);
}

export function analyserCoherence(documents: LiensDocument[], processus: ProcessusCartographie[]): Constat[] {
  const constats: Constat[] = [];
  const parCode = new Map<string, LiensDocument[]>();
  for (const d of documents) {
    const c = normaliserCode(d.reference);
    if (c) parCode.set(c, [...(parCode.get(c) ?? []), d]);
  }

  for (const [code, docs] of parCode) {
    if (docs.length > 1) constats.push({ gravite: "alerte", cle: "code_double", code, documents: docs.map(cite) });
  }

  const citesEnN3 = new Set<string>();
  for (const p of documents.filter(estProcedure)) {
    for (const code of codesDe(p.n3)) {
      citesEnN3.add(code);
      const porteurs = parCode.get(code) ?? [];
      if (porteurs.length === 0) constats.push({ gravite: "info", cle: "n3_absente", code, documents: [cite(p)] });
      else if (!porteurs.some((d) => d.type === "instruction")) constats.push({ gravite: "alerte", cle: "n3_pas_instruction", code, documents: [cite(p), ...porteurs.map(cite)] });
    }
    for (const code of codesDe(p.sousProcedures)) {
      if (!(parCode.get(code) ?? []).some(estProcedure)) constats.push({ gravite: "alerte", cle: "sp_absente", code, documents: [cite(p)] });
    }
  }

  for (const i of documents.filter((d) => d.type === "instruction")) {
    const code = normaliserCode(i.reference);
    if (!code) constats.push({ gravite: "info", cle: "it_sans_code", documents: [cite(i)] });
    else if (!citesEnN3.has(code)) constats.push({ gravite: "alerte", cle: "it_non_rattachee", code, documents: [cite(i)] });
  }

  // Processus inconnus : un constat par texte saisi (plusieurs documents peuvent citer le même processus disparu).
  if (processus.length > 0) {
    const inconnus = new Map<string, LiensDocument[]>();
    for (const d of documents) {
      const texte = d.processus.trim();
      if (texte && !processusConnu(processus, texte)) inconnus.set(texte, [...(inconnus.get(texte) ?? []), d]);
    }
    for (const [texte, docs] of inconnus) constats.push({ gravite: "alerte", cle: "processus_inconnu", processus: texte, documents: docs.map(cite) });
  }

  // Alertes d'abord, puis par code (ou processus), puis par nature : un ordre stable pour l'affichage et les tests.
  return constats.sort(
    (a, b) =>
      (a.gravite === b.gravite ? 0 : a.gravite === "alerte" ? -1 : 1) ||
      (a.code ?? a.processus ?? "").localeCompare(b.code ?? b.processus ?? "") ||
      a.cle.localeCompare(b.cle),
  );
}

/** Documents liés à `id` : ceux qui deviendraient incohérents si on le supprimait (ils ne sont jamais supprimés avec lui). */
export function dependancesDe(documents: LiensDocument[], id: string): Dependance[] {
  const d = documents.find((x) => x.id === id);
  if (!d) return [];
  const code = normaliserCode(d.reference);
  const liees: Dependance[] = [];
  if (d.type === "instruction") {
    if (code) for (const p of documents) if (p.id !== id && estProcedure(p) && codesDe(p.n3).includes(code)) liees.push({ ...cite(p), lien: "citante" });
  } else {
    const n3 = codesDe(d.n3);
    for (const i of documents) if (i.id !== id && i.type === "instruction" && n3.includes(normaliserCode(i.reference))) liees.push({ ...cite(i), lien: "instruction" });
    if (code) for (const p of documents) if (p.id !== id && estProcedure(p) && codesDe(p.sousProcedures).includes(code)) liees.push({ ...cite(p), lien: "appelante" });
  }
  return liees;
}

// ---------------------------------------------------------------------------------------------------
// Lecture en base (client déjà placé dans l'organisation : dansOrganisation / avecOrganisation)
// ---------------------------------------------------------------------------------------------------

// Les liens sont extraits par PostgreSQL (jsonpath), sans charger les contenus (jusqu'à 2 Mo chacun). Le contenu n'est
// contrôlé qu'en forme : chaque valeur est filtrée sur son type (une valeur inattendue est ignorée, jamais une erreur).
// Les types sont testés AVANT d'accéder aux valeurs : en mode « lax », jsonpath déballerait un tableau (["PR-X"] → "PR-X"),
// alors que la méthode type() ne le fait pas. Même lecture que l'éditeur : « actif » vaut exactement true, le code est un texte.
const filtre = (champ: string) => `@.${champ}.actif.type() == "boolean" && @.${champ}.actif == true && @.${champ}.code.type() == "string"`;
const REQUETE_LIENS = `
  SELECT id, type, titre, reference,
         CASE WHEN jsonb_typeof(contenu #> '{meta,processus}') = 'string' THEN left(contenu #>> '{meta,processus}', 500) ELSE '' END AS processus,
         jsonb_path_query_array(contenu, '$.etapes[*] ? (${filtre("niveau3")}).niveau3.code') AS n3,
         jsonb_path_query_array(contenu, '$.etapes[*] ? (${filtre("sousProcedure")}).sousProcedure.code') AS sp
    FROM documents`;

const MAX_CODE = 60;
const codes = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.slice(0, MAX_CODE)) : []);

export async function lireLiens(client: PoolClient): Promise<LiensDocument[]> {
  const r = await client.query<{ id: string; type: TypeDocument; titre: string; reference: string; processus: string; n3: unknown; sp: unknown }>(
    `${REQUETE_LIENS} ORDER BY reference, titre, id`,
  );
  return r.rows.map((l) => ({ id: l.id, type: l.type, titre: l.titre, reference: l.reference, processus: l.processus, n3: codes(l.n3), sousProcedures: codes(l.sp) }));
}

export async function lireProcessusCartographie(client: PoolClient): Promise<ProcessusCartographie[]> {
  const r = await client.query<{ processus: unknown }>("SELECT contenu -> 'processus' AS processus FROM cartographie WHERE id = 1");
  const liste = r.rows[0]?.processus;
  if (!Array.isArray(liste)) return [];
  return liste
    .filter((p): p is { code: string; nom?: unknown } => typeof p === "object" && p !== null && typeof (p as { code?: unknown }).code === "string")
    .map((p) => ({ code: p.code.trim(), nom: typeof p.nom === "string" ? p.nom.trim() : "" }))
    .filter((p) => p.code !== "");
}
