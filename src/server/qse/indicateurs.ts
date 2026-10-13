// Objectifs et mesures des indicateurs (audit Q1 ; migration organisation 0007).
//
// Un indicateur est décrit dans une instruction de procédure (fanion « indicateur » : nom, formule, cible, fréquence).
// Il est identifié par le document et l'identifiant de l'instruction. Ici s'ajoutent :
//   - un OBJECTIF chiffré (au moins / au plus un seuil, une unité) — droit indicateurs.objectifs ;
//   - des MESURES datées (une par jour de mesure ; ressaisir le même jour corrige la valeur) — droit indicateurs.mesurer.
// L'indicateur doit exister dans la version publiée ou la version en cours du document. Toute modification est inscrite
// au journal de l'organisation (valeurs avant / après) ; la plateforme ne reçoit que l'opération.
import type { Pool, PoolClient } from "pg";
import { ecartJours, estJour } from "@/lib/dates";
import { lireNombre, objectifAtteint, type SensObjectif } from "@/lib/qse";
import { avecOrganisation, dansOrganisation, enTransaction } from "../db/transactions";
import type { OrganisationCible } from "../membres/service";
import { journaliserOrganisation, journaliserPlateforme, type EntreeJournal } from "../audit/journal";
import type { Action as ActionJournal } from "@/lib/actions-journal";
import { ErreurMetier } from "../erreurs";
import { nomActeur, traceActeur, type Acteur } from "../acteur";
import { estIdentifiant } from "../documents/service";

export const UNITE_MAX = 30;
export const COMMENTAIRE_MAX = 1000;
const ELEMENT = /^.{1,100}$/su;

export interface Objectif {
  sens: SensObjectif;
  seuil: number;
  unite: string;
  modifieParNom: string;
  modifieLe: Date;
}

export interface Mesure {
  id: string;
  date: string;
  valeur: number;
  commentaire: string;
  nom: string;
  saisiParNom: string;
  saisiLe: Date;
}

export const cleIndicateur = (documentId: string, elementId: string) => `${documentId}:${elementId}`;

/** Objectifs de tous les indicateurs (client DANS l'organisation). */
export async function lireObjectifs(client: PoolClient): Promise<Map<string, Objectif>> {
  const r = await client.query<{ document_id: string; element_id: string; sens: SensObjectif; seuil: string; unite: string; modifie_par_nom: string; modifie_le: Date }>(
    "SELECT document_id, element_id, sens, seuil::text AS seuil, unite, modifie_par_nom, modifie_le FROM objectifs_indicateur",
  );
  return new Map(r.rows.map((l) => [cleIndicateur(l.document_id, l.element_id), { sens: l.sens, seuil: Number(l.seuil), unite: l.unite, modifieParNom: l.modifie_par_nom, modifieLe: l.modifie_le }]));
}

/** Dernière mesure de chaque indicateur (client DANS l'organisation). */
export async function dernieresMesures(client: PoolClient): Promise<Map<string, { date: string; valeur: number }>> {
  const r = await client.query<{ document_id: string; element_id: string; date: string; valeur: string }>(
    `SELECT DISTINCT ON (document_id, element_id) document_id, element_id, to_char(date_mesure, 'YYYY-MM-DD') AS date, valeur::text AS valeur
       FROM mesures_indicateur ORDER BY document_id, element_id, date_mesure DESC`,
  );
  return new Map(r.rows.map((l) => [cleIndicateur(l.document_id, l.element_id), { date: l.date, valeur: Number(l.valeur) }]));
}

/**
 * Nom de l'indicateur porté par l'instruction `elementId`, dans la version publiée ou la version en cours du document
 * (non archivé, pas à la corbeille) ; null s'il n'existe pas. Client DANS l'organisation.
 */
export async function nomIndicateur(client: PoolClient, documentId: string, elementId: string): Promise<string | null> {
  if (!estIdentifiant(documentId) || !ELEMENT.test(elementId)) return null;
  const r = await client.query<{ nom: string }>(
    `SELECT CASE WHEN jsonb_typeof(e #> '{indicateur,nom}') = 'string' THEN left(e #>> '{indicateur,nom}', 500) ELSE '' END AS nom
       FROM documents d
       LEFT JOIN versions_document v ON v.document_id = d.id AND v.version = d.version_publiee
       CROSS JOIN LATERAL (VALUES (d.contenu), (v.contenu)) AS c(contenu)
       CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(c.contenu -> 'etapes') = 'array' THEN c.contenu -> 'etapes' ELSE '[]'::jsonb END) AS x(e)
      WHERE d.id = $1 AND d.supprime_le IS NULL AND d.etat <> 'archive'
        AND jsonb_typeof(e) = 'object' AND e ->> 'id' = $2
        AND jsonb_typeof(e #> '{indicateur,actif}') = 'boolean' AND (e #>> '{indicateur,actif}')::boolean
      LIMIT 1`,
    [documentId, elementId],
  );
  return r.rows[0] ? r.rows[0].nom : null;
}

async function journaliser(client: PoolClient, org: OrganisationCible, action: ActionJournal, documentId: string, acteur: Acteur, details: Record<string, unknown>) {
  const entree: EntreeJournal = { action, ...traceActeur(acteur), cibleType: "indicateur", cibleId: documentId, details };
  await dansOrganisation(client, org, () => journaliserOrganisation(client, entree));
  await journaliserPlateforme(client, { ...entree, details: {}, organisationId: org.id });
}

export interface SaisieObjectif {
  sens: string;
  seuil: string;
  unite: string;
}

/** Pose ou modifie l'objectif ; `null` le retire. */
export async function definirObjectif(pool: Pool, org: OrganisationCible, documentId: string, elementId: string, s: SaisieObjectif | null, acteur: Acteur): Promise<void> {
  let valeurs: { sens: SensObjectif; seuil: number; unite: string } | null = null;
  if (s) {
    if (s.sens !== "min" && s.sens !== "max") throw new ErreurMetier("indicateurs.erreur.sens");
    const seuil = lireNombre(s.seuil);
    if (seuil === null) throw new ErreurMetier("indicateurs.erreur.nombre");
    const unite = s.unite.trim();
    if (unite.length > UNITE_MAX) throw new ErreurMetier("indicateurs.erreur.unite");
    valeurs = { sens: s.sens, seuil, unite };
  }
  await enTransaction(pool, async (client) => {
    const detail = await dansOrganisation(client, org, async () => {
      const nom = await nomIndicateur(client, documentId, elementId);
      if (nom === null) throw new ErreurMetier("indicateurs.introuvable");
      const avant = await client.query<{ sens: string; seuil: string; unite: string }>(
        "SELECT sens, seuil::text AS seuil, unite FROM objectifs_indicateur WHERE document_id = $1 AND element_id = $2 FOR UPDATE",
        [documentId, elementId],
      );
      const a = avant.rows[0] ? { sens: avant.rows[0].sens, seuil: Number(avant.rows[0].seuil), unite: avant.rows[0].unite } : null;
      if (valeurs) {
        await client.query(
          `INSERT INTO objectifs_indicateur (document_id, element_id, sens, seuil, unite, modifie_par, modifie_par_nom)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (document_id, element_id) DO UPDATE SET sens = EXCLUDED.sens, seuil = EXCLUDED.seuil, unite = EXCLUDED.unite,
             modifie_par = EXCLUDED.modifie_par, modifie_par_nom = EXCLUDED.modifie_par_nom, modifie_le = now()`,
          [documentId, elementId, valeurs.sens, valeurs.seuil, valeurs.unite, acteur.id, nomActeur(acteur)],
        );
      } else {
        await client.query("DELETE FROM objectifs_indicateur WHERE document_id = $1 AND element_id = $2", [documentId, elementId]);
      }
      return { nom, avant: a };
    });
    await journaliser(client, org, "OBJECTIF_INDICATEUR_MODIFIE", documentId, acteur, { elementId, indicateur: detail.nom, avant: detail.avant, apres: valeurs });
  });
}

export interface SaisieMesure {
  date: string;
  valeur: string;
  commentaire: string;
}

/**
 * Enregistre la mesure du jour donné (au plus tard aujourd'hui, au plus tôt il y a dix ans) ; s'il y en a déjà une
 * ce jour-là, elle est corrigée (valeurs avant / après au journal).
 */
export async function enregistrerMesure(pool: Pool, org: OrganisationCible, documentId: string, elementId: string, s: SaisieMesure, aujourdhui: string, acteur: Acteur): Promise<{ corrigee: boolean }> {
  if (!estJour(s.date) || ecartJours(s.date, aujourdhui) < 0 || ecartJours(s.date, aujourdhui) > 3660) throw new ErreurMetier("indicateurs.erreur.date");
  const valeur = lireNombre(s.valeur);
  if (valeur === null) throw new ErreurMetier("indicateurs.erreur.nombre");
  const commentaire = s.commentaire.trim();
  if (commentaire.length > COMMENTAIRE_MAX) throw new ErreurMetier("indicateurs.erreur.commentaire");
  return enTransaction(pool, async (client) => {
    const r = await dansOrganisation(client, org, async () => {
      const nom = await nomIndicateur(client, documentId, elementId);
      if (nom === null) throw new ErreurMetier("indicateurs.introuvable");
      const avant = await client.query<{ valeur: string; commentaire: string }>(
        "SELECT valeur::text AS valeur, commentaire FROM mesures_indicateur WHERE document_id = $1 AND element_id = $2 AND date_mesure = $3 FOR UPDATE",
        [documentId, elementId, s.date],
      );
      await client.query(
        `INSERT INTO mesures_indicateur (document_id, element_id, nom, date_mesure, valeur, commentaire, saisi_par, saisi_par_nom)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (document_id, element_id, date_mesure) DO UPDATE SET nom = EXCLUDED.nom, valeur = EXCLUDED.valeur, commentaire = EXCLUDED.commentaire,
           saisi_par = EXCLUDED.saisi_par, saisi_par_nom = EXCLUDED.saisi_par_nom, saisi_le = now()`,
        [documentId, elementId, nom, s.date, valeur, commentaire, acteur.id, nomActeur(acteur)],
      );
      const a = avant.rows[0];
      return { nom, avant: a ? { valeur: Number(a.valeur), commentaire: a.commentaire } : null };
    });
    await journaliser(client, org, r.avant ? "MESURE_INDICATEUR_CORRIGEE" : "MESURE_INDICATEUR_ENREGISTREE", documentId, acteur, {
      elementId, indicateur: r.nom, date: s.date, ...(r.avant ? { avant: r.avant } : {}), apres: { valeur, commentaire },
    });
    return { corrigee: r.avant !== null };
  });
}

export async function supprimerMesure(pool: Pool, org: OrganisationCible, mesureId: string, acteur: Acteur): Promise<void> {
  if (!/^\d{1,18}$/.test(mesureId)) throw new ErreurMetier("erreur.introuvable");
  await enTransaction(pool, async (client) => {
    const m = await dansOrganisation(client, org, async () => {
      const r = await client.query<{ document_id: string; element_id: string; nom: string; date: string; valeur: string; commentaire: string }>(
        `DELETE FROM mesures_indicateur WHERE id = $1
         RETURNING document_id, element_id, nom, to_char(date_mesure, 'YYYY-MM-DD') AS date, valeur::text AS valeur, commentaire`,
        [mesureId],
      );
      if (!r.rows[0]) throw new ErreurMetier("erreur.introuvable");
      return r.rows[0];
    });
    await journaliser(client, org, "MESURE_INDICATEUR_SUPPRIMEE", m.document_id, acteur, {
      elementId: m.element_id, indicateur: m.nom, date: m.date, avant: { valeur: Number(m.valeur), commentaire: m.commentaire },
    });
  });
}

export async function listerMesures(pool: Pool, org: OrganisationCible, documentId: string, elementId: string): Promise<Mesure[]> {
  if (!estIdentifiant(documentId) || !ELEMENT.test(elementId)) return [];
  return avecOrganisation(pool, org, async (client) => {
    const r = await client.query<{ id: string; date: string; valeur: string; commentaire: string; nom: string; saisi_par_nom: string; saisi_le: Date }>(
      `SELECT id::text AS id, to_char(date_mesure, 'YYYY-MM-DD') AS date, valeur::text AS valeur, commentaire, nom, saisi_par_nom, saisi_le
         FROM mesures_indicateur WHERE document_id = $1 AND element_id = $2 ORDER BY date_mesure DESC LIMIT 500`,
      [documentId, elementId],
    );
    return r.rows.map((l) => ({ id: l.id, date: l.date, valeur: Number(l.valeur), commentaire: l.commentaire, nom: l.nom, saisiParNom: l.saisi_par_nom, saisiLe: l.saisi_le }));
  });
}

export async function lireObjectif(pool: Pool, org: OrganisationCible, documentId: string, elementId: string): Promise<Objectif | null> {
  if (!estIdentifiant(documentId) || !ELEMENT.test(elementId)) return null;
  return avecOrganisation(pool, org, async (client) => (await lireObjectifs(client)).get(cleIndicateur(documentId, elementId)) ?? null);
}

/** Situation d'un indicateur : objectif atteint, non atteint, sans mesure, sans objectif. */
export type SituationIndicateur = "atteint" | "non_atteint" | "sans_mesure" | "sans_objectif";

export function situationIndicateur(objectif: Pick<Objectif, "sens" | "seuil"> | undefined | null, derniere: { valeur: number } | undefined | null): SituationIndicateur {
  if (!objectif) return "sans_objectif";
  if (!derniere) return "sans_mesure";
  return objectifAtteint(objectif.sens, objectif.seuil, derniere.valeur) ? "atteint" : "non_atteint";
}
