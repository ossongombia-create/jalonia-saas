// Vérification de la chaîne d'empreintes des journaux (audit S6 ; migrations plateforme 0006, organisation 0003).
//
// Chaque ligne : chaine_empreinte = SHA-256( empreinte précédente | représentation canonique ), chaine_rang = 1, 2, 3…
// La vérification relit le journal dans l'ordre des rangs et :
//   1. contrôle que les rangs se suivent sans trou (ligne supprimée) ;
//   2. recalcule chaque empreinte à partir de la précédente ENREGISTRÉE (désigne précisément la ligne modifiée) ;
//   3. recalcule toute la chaîne depuis le début (une chaîne entièrement recalculée par un faussaire reste
//      cohérente, mais ne correspond plus aux ANCRES exportées hors du serveur : voir deploy/sauvegarde.sh).
// La représentation canonique est calculée par les seules fonctions intégrées de PostgreSQL, avec l'expression
// ci-dessous — identique à celle des déclencheurs (un test le vérifie) : rien ne dépend d'une fonction que le
// propriétaire de la base pourrait avoir remplacée.
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";

export const GENESE = "0".repeat(64);

/** Expression SQL de la représentation canonique d'une ligne (préfixe : « NEW. », « r. », « j. »). */
export function expressionCanonique(prefixe: string, avecOrganisation: boolean): string {
  const p = prefixe;
  const champs = [
    `${p}id::text`,
    `to_char(${p}horodatage AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
    `quote_nullable(${p}acteur_id::text)`,
    `quote_nullable(${p}acteur_email)`,
    ...(avecOrganisation ? [`quote_nullable(${p}organisation_id::text)`] : []),
    `quote_nullable(${p}action)`,
    `quote_nullable(${p}cible_type)`,
    `quote_nullable(${p}cible_id)`,
    `quote_nullable(${p}details::text)`,
    `quote_nullable(${p}ip::text)`,
    `quote_nullable(${p}agent)`,
  ];
  return `concat_ws('|', ${champs.join(", ")})`;
}

export function chainer(precedente: string, canonique: string): string {
  return createHash("sha256").update(`${precedente}|${canonique}`, "utf8").digest("hex");
}

export interface Ancre {
  journal: string;
  rang: number;
  empreinte: string;
}

export interface ResultatChaine {
  journal: string;
  lignes: number;
  /** Dernière ligne de la chaîne (ce qui s'exporte comme ancre). */
  rang: number;
  empreinte: string;
  /** Rangs absents (lignes supprimées). */
  rangsManquants: number[];
  /** Lignes dont l'empreinte ne correspond pas à leur contenu (lignes modifiées). */
  lignesModifiees: number[];
  /** La chaîne recalculée depuis le début diffère de l'empreinte enregistrée à partir de ce rang. */
  divergenceDepuis: number | null;
  /** Ancres non retrouvées (historique réécrit). */
  ancresEnEchec: Ancre[];
  ancresVerifiees: number;
}

const MAX_SIGNALES = 50;

/**
 * Vérifie le journal `table` (nom qualifié et déjà cité, ex. platform.journal ou "org_…".journal). `journal` est
 * l'identifiant utilisé dans les ancres (« platform » ou le nom du schéma).
 */
export async function verifierJournal(client: PoolClient, table: string, journal: string, avecOrganisation: boolean, ancres: Ancre[] = []): Promise<ResultatChaine> {
  const aVerifier = new Map(ancres.filter((a) => a.journal === journal).map((a) => [a.rang, a]));
  const r: ResultatChaine = {
    journal, lignes: 0, rang: 0, empreinte: GENESE, rangsManquants: [], lignesModifiees: [], divergenceDepuis: null, ancresEnEchec: [], ancresVerifiees: 0,
  };
  let rangAttendu = 1;
  let precedenteEnregistree = GENESE;
  let recalculee = GENESE;
  for (;;) {
    const lot = await client.query<{ chaine_rang: string; chaine_empreinte: string; canonique: string }>(
      `SELECT j.chaine_rang, j.chaine_empreinte, ${expressionCanonique("j.", avecOrganisation)} AS canonique
         FROM ${table} j WHERE j.chaine_rang > $1 ORDER BY j.chaine_rang LIMIT 2000`,
      [r.rang],
    );
    if (lot.rows.length === 0) break;
    for (const l of lot.rows) {
      const rang = Number(l.chaine_rang);
      while (rangAttendu < rang) {
        if (r.rangsManquants.length < MAX_SIGNALES) r.rangsManquants.push(rangAttendu);
        rangAttendu++;
      }
      if (chainer(precedenteEnregistree, l.canonique) !== l.chaine_empreinte && r.lignesModifiees.length < MAX_SIGNALES) r.lignesModifiees.push(rang);
      recalculee = chainer(recalculee, l.canonique);
      if (recalculee !== l.chaine_empreinte && r.divergenceDepuis === null) r.divergenceDepuis = rang;
      const ancre = aVerifier.get(rang);
      if (ancre) {
        // L'ancre a été exportée quand cette ligne était la dernière : la chaîne recalculée DOIT y passer.
        if (ancre.empreinte === recalculee && ancre.empreinte === l.chaine_empreinte) r.ancresVerifiees++;
        else r.ancresEnEchec.push(ancre);
        aVerifier.delete(rang);
      }
      precedenteEnregistree = l.chaine_empreinte;
      r.lignes++;
      r.rang = rang;
      r.empreinte = l.chaine_empreinte;
      rangAttendu = rang + 1;
    }
  }
  // Ancre au-delà de la fin du journal : des lignes ont disparu.
  for (const a of aVerifier.values()) r.ancresEnEchec.push(a);
  return r;
}

export function chaineIntacte(r: ResultatChaine): boolean {
  return r.rangsManquants.length === 0 && r.lignesModifiees.length === 0 && r.divergenceDepuis === null && r.ancresEnEchec.length === 0;
}

/** Lit un fichier d'ancres (« journal|rang|empreinte » par ligne ; lignes « # » ignorées). */
export function lireAncres(texte: string): Ancre[] {
  const ancres: Ancre[] = [];
  for (const brute of texte.split(/\r?\n/)) {
    const ligne = brute.trim();
    if (!ligne || ligne.startsWith("#")) continue;
    const m = /^(platform|org_[0-9a-f]{12})\|(\d+)\|([0-9a-f]{64})$/.exec(ligne);
    if (!m) throw new Error(`ligne d'ancre illisible : ${ligne.slice(0, 80)}`);
    ancres.push({ journal: m[1]!, rang: Number(m[2]), empreinte: m[3]! });
  }
  return ancres;
}
