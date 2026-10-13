// Registres QSE tirés des documents (audit Q1) : risques et opportunités portés par les instructions des procédures,
// indicateurs de performance des instructions.
//
// Source : la VERSION PUBLIÉE de chaque document en application (copie de l'historique à la version publiée) — c'est
// elle qui fait foi. Avec la portée « tous », la version EN COURS de chaque document non archivé (brouillon compris).
// Les éléments sont extraits par PostgreSQL (jsonpath / jsonb), sans charger les contenus entiers ; chaque valeur est
// contrôlée en forme (une valeur inattendue est ignorée ou vide, jamais une erreur), comme les contrôles de cohérence.
import type { PoolClient } from "pg";
import { criticite, scoreOpportunite, type NiveauRisque } from "@/lib/qse";

export type Portee = "publies" | "tous";

export function estPortee(v: unknown): v is Portee {
  return v === "publies" || v === "tous";
}

export interface Source {
  documentId: string;
  reference: string;
  titre: string;
  /** Version lue (publiée, ou en cours avec la portée « tous ») et si c'est la version publiée. */
  version: number;
  publiee: boolean;
  etapeId: string;
  etapeLibelle: string;
  etapeRang: number;
}

export interface RisqueDocument extends Source {
  id: string;
  risque: string;
  causes: string;
  mesure: string;
  gravite: number | null;
  probabilite: number | null;
  criticite: number | null;
  niveau: NiveauRisque | null;
}

export interface OpportuniteDocument extends Source {
  id: string;
  opportunite: string;
  benefice: string;
  interet: number | null;
  faisabilite: number | null;
  score: number | null;
  suite: "plan" | "etudier" | null;
}

export interface IndicateurDocument extends Source {
  /** Un indicateur est porté par une instruction : son identifiant est celui de l'instruction. */
  id: string;
  nom: string;
  formule: string;
  cible: string;
  frequence: string;
}

// Texte d'un champ : seulement une chaîne (tronquée), sinon vide. Cote : chaîne ou nombre, sinon vide.
const texte = (expr: string, max = 500) => `CASE WHEN jsonb_typeof(${expr}) = 'string' THEN left(${expr} #>> '{}', ${max}) ELSE '' END`;
const cote = (expr: string) => `CASE WHEN jsonb_typeof(${expr}) IN ('string', 'number') THEN left(${expr} #>> '{}', 10) ELSE '' END`;

// Documents sources : version publiée (portée « publies ») ou version en cours (portée « tous ») ; jamais archivés ni
// à la corbeille.
const SOURCES = `
  WITH sources AS (
    SELECT d.id, d.titre, d.reference,
           CASE WHEN $1 = 'publies' THEN v.contenu ELSE d.contenu END AS contenu,
           CASE WHEN $1 = 'publies' THEN d.version_publiee ELSE d.version END AS version,
           ($1 = 'publies' OR d.version = d.version_publiee) IS TRUE AS publiee
      FROM documents d
      LEFT JOIN versions_document v ON v.document_id = d.id AND v.version = d.version_publiee
     WHERE d.supprime_le IS NULL AND d.etat <> 'archive' AND d.type = 'procedure'
       AND ($1 = 'tous' OR d.version_publiee IS NOT NULL)
  ), etapes AS (
    SELECT s.id AS document_id, s.titre, s.reference, s.version, s.publiee, e.etape, e.rang
      FROM sources s
      CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(s.contenu -> 'etapes') = 'array' THEN s.contenu -> 'etapes' ELSE '[]'::jsonb END)
           WITH ORDINALITY AS e(etape, rang)
     WHERE jsonb_typeof(e.etape) = 'object' AND jsonb_typeof(e.etape -> 'id') = 'string' AND char_length(e.etape ->> 'id') BETWEEN 1 AND 100
  )`;

const COLONNES_SOURCE = `document_id, titre, reference, version, publiee, etape ->> 'id' AS etape_id, ${texte("etape -> 'libelle'")} AS etape_libelle, rang::int AS etape_rang`;

interface LigneSource {
  document_id: string;
  titre: string;
  reference: string;
  version: number;
  publiee: boolean;
  etape_id: string;
  etape_libelle: string;
  etape_rang: number;
}

function source(l: LigneSource): Source {
  return {
    documentId: l.document_id, reference: l.reference, titre: l.titre, version: l.version, publiee: l.publiee,
    etapeId: l.etape_id, etapeLibelle: l.etape_libelle, etapeRang: l.etape_rang,
  };
}

/** Une cote dans ses bornes (1 à max), sinon null : une cote hors bornes n'est pas une cote. */
const cote1a = (v: string, max: number): number | null => (/^\d$/.test(v) && Number(v) >= 1 && Number(v) <= max ? Number(v) : null);

/** Éléments d'une liste de l'instruction (risques, opportunités), avec un identifiant texte (1 à 100 caractères). */
function elements(liste: string): string {
  return `CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(etape -> '${liste}') = 'array' THEN etape -> '${liste}' ELSE '[]'::jsonb END) WITH ORDINALITY AS x(el, ordre)
     WHERE jsonb_typeof(x.el) = 'object' AND jsonb_typeof(x.el -> 'id') = 'string' AND char_length(x.el ->> 'id') BETWEEN 1 AND 100`;
}

/** Client DANS l'organisation. */
export async function lireRisques(client: PoolClient, portee: Portee): Promise<RisqueDocument[]> {
  const r = await client.query<LigneSource & { id: string; risque: string; causes: string; mesure: string; gravite: string; probabilite: string }>(
    `${SOURCES}
     SELECT ${COLONNES_SOURCE}, x.el ->> 'id' AS id, ${texte("x.el -> 'risque'")} AS risque, ${texte("x.el -> 'causes'")} AS causes,
            ${texte("x.el -> 'mesure'", 1000)} AS mesure, ${cote("x.el -> 'gravite'")} AS gravite, ${cote("x.el -> 'probabilite'")} AS probabilite
       FROM etapes ${elements("risques")}
      ORDER BY reference, titre, document_id, rang, x.ordre`,
    [portee],
  );
  return r.rows.map((l) => {
    const c = criticite({ gravite: l.gravite, probabilite: l.probabilite });
    return {
      ...source(l), id: l.id, risque: l.risque, causes: l.causes, mesure: l.mesure,
      gravite: c ? c.g : cote1a(l.gravite, 4), probabilite: c ? c.p : cote1a(l.probabilite, 4), criticite: c?.valeur ?? null, niveau: c?.niveau ?? null,
    };
  });
}

export async function lireOpportunites(client: PoolClient, portee: Portee): Promise<OpportuniteDocument[]> {
  const r = await client.query<LigneSource & { id: string; opportunite: string; benefice: string; interet: string; faisabilite: string }>(
    `${SOURCES}
     SELECT ${COLONNES_SOURCE}, x.el ->> 'id' AS id, ${texte("x.el -> 'opportunite'")} AS opportunite, ${texte("x.el -> 'benefice'")} AS benefice,
            ${cote("x.el -> 'interet'")} AS interet, ${cote("x.el -> 'faisabilite'")} AS faisabilite
       FROM etapes ${elements("opportunites")}
      ORDER BY reference, titre, document_id, rang, x.ordre`,
    [portee],
  );
  return r.rows.map((l) => {
    const s = scoreOpportunite({ interet: l.interet, faisabilite: l.faisabilite });
    return {
      ...source(l), id: l.id, opportunite: l.opportunite, benefice: l.benefice,
      interet: s ? s.i : cote1a(l.interet, 3), faisabilite: s ? s.f : cote1a(l.faisabilite, 3), score: s?.valeur ?? null, suite: s?.suite ?? null,
    };
  });
}

/** Indicateurs actifs des instructions (« indicateur.actif » exactement vrai, comme l'éditeur), nom non vide. */
export async function lireIndicateurs(client: PoolClient, portee: Portee): Promise<IndicateurDocument[]> {
  const r = await client.query<LigneSource & { nom: string; formule: string; cible: string; frequence: string }>(
    `${SOURCES}
     SELECT ${COLONNES_SOURCE}, ${texte("etape #> '{indicateur,nom}'")} AS nom, ${texte("etape #> '{indicateur,formule}'")} AS formule,
            ${texte("etape #> '{indicateur,cible}'")} AS cible, ${texte("etape #> '{indicateur,frequence}'")} AS frequence
       FROM etapes
      WHERE jsonb_typeof(etape -> 'indicateur') = 'object'
        AND jsonb_typeof(etape #> '{indicateur,actif}') = 'boolean' AND (etape #>> '{indicateur,actif}')::boolean
      ORDER BY reference, titre, document_id, rang`,
    [portee],
  );
  return r.rows.map((l) => ({ ...source(l), id: l.etape_id, nom: l.nom, formule: l.formule, cible: l.cible, frequence: l.frequence }));
}

export interface ElementDocument {
  origine: "risque" | "opportunite" | "indicateur";
  libelle: string;
  document: string;
}

/**
 * Élément d'un document (risque, opportunité, indicateur) cherché dans la version EN COURS des documents non archivés,
 * puis dans la version publiée : son texte vient du document, jamais de la saisie. Client DANS l'organisation.
 */
export async function trouverElement(client: PoolClient, documentId: string, elementId: string): Promise<ElementDocument | null> {
  if (elementId.length < 1 || elementId.length > 100) return null;
  const nomDoc = (x: { reference: string; titre: string }) => (x.reference && x.titre ? `${x.reference} — ${x.titre}` : x.reference || x.titre);
  for (const portee of ["tous", "publies"] as const) {
    const r = (await lireRisques(client, portee)).find((x) => x.documentId === documentId && x.id === elementId);
    if (r) return { origine: "risque", libelle: r.risque, document: nomDoc(r) };
    const o = (await lireOpportunites(client, portee)).find((x) => x.documentId === documentId && x.id === elementId);
    if (o) return { origine: "opportunite", libelle: o.opportunite, document: nomDoc(o) };
    const i = (await lireIndicateurs(client, portee)).find((x) => x.documentId === documentId && x.id === elementId);
    if (i) return { origine: "indicateur", libelle: i.nom, document: nomDoc(i) };
  }
  return null;
}
