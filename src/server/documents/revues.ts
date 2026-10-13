// Revues périodiques des documents publiés (audit W2 ; migration organisation 0006).
//
// Un document publié doit être revu au plus tard « période » mois après sa dernière approbation ou sa dernière revue
// confirmée (documents.revue_le). La revue se conclut soit par « Confirmer la revue » (le document reste tel quel :
// décision tracée, nouvelle échéance), soit par « Réviser » (nouveau brouillon, puis nouveau circuit).
// Les rappels partent `rappelJours` jours avant l'échéance ; après l'échéance, la revue est en retard ; au bout de
// `escaladeJours` jours de retard, les administrateurs de l'organisation sont prévenus (tâches quotidiennes).
// Réglages par organisation (page « Paramètres »), valeurs par défaut à confirmer par Brice : 24 mois, 30 jours, 30 jours.
import type { Pool, PoolClient } from "pg";
import { ajouterMois, jourLocal, situationEcheance, type SituationEcheance } from "@/lib/dates";
import { avecOrganisation, dansOrganisation, enTransaction } from "../db/transactions";
import type { OrganisationCible } from "../membres/service";
import { journaliserLesDeux } from "../audit/journal";
import { ErreurMetier } from "../erreurs";
import { nomActeur, traceActeur, type Acteur } from "../acteur";

export interface Parametres {
  periodeRevueMois: number;
  rappelJours: number;
  escaladeJours: number;
}

export interface ParametresStockes extends Parametres {
  modifieParNom: string;
  modifieLe: Date | null;
}

export const BORNES = {
  periodeRevueMois: { min: 1, max: 120 },
  rappelJours: { min: 0, max: 365 },
  escaladeJours: { min: 1, max: 365 },
} as const satisfies Record<keyof Parametres, { min: number; max: number }>;

/** Lit les réglages (client DANS l'organisation). */
export async function lireParametres(client: PoolClient): Promise<ParametresStockes> {
  const r = await client.query<{ periode_revue_mois: number; rappel_jours: number; escalade_jours: number; modifie_par_nom: string; modifie_le: Date | null }>(
    "SELECT periode_revue_mois, rappel_jours, escalade_jours, modifie_par_nom, modifie_le FROM parametres WHERE id = 1",
  );
  const l = r.rows[0];
  if (!l) throw new Error("réglages de l'organisation absents (migration 0006)");
  return { periodeRevueMois: l.periode_revue_mois, rappelJours: l.rappel_jours, escaladeJours: l.escalade_jours, modifieParNom: l.modifie_par_nom, modifieLe: l.modifie_le };
}

export function lireParametresOrganisation(pool: Pool, org: OrganisationCible): Promise<ParametresStockes> {
  return avecOrganisation(pool, org, (client) => lireParametres(client));
}

/** Contrôle des réglages saisis (clé de message en cas de refus). */
export function controlerParametres(p: Parametres): string | null {
  for (const [cle, b] of Object.entries(BORNES) as [keyof Parametres, { min: number; max: number }][]) {
    const v = p[cle];
    if (!Number.isInteger(v) || v < b.min || v > b.max) return `parametres.erreur.${cle}`;
  }
  return null;
}

export async function modifierParametres(pool: Pool, org: OrganisationCible, p: Parametres, acteur: Acteur): Promise<void> {
  const refus = controlerParametres(p);
  if (refus) throw new ErreurMetier(refus);
  await enTransaction(pool, async (client) => {
    const avant = await dansOrganisation(client, org, async () => {
      const lus = await lireParametres(client);
      await client.query(
        `UPDATE parametres SET periode_revue_mois = $1, rappel_jours = $2, escalade_jours = $3, modifie_par = $4, modifie_par_nom = $5, modifie_le = now() WHERE id = 1`,
        [p.periodeRevueMois, p.rappelJours, p.escaladeJours, acteur.id, nomActeur(acteur)],
      );
      return lus;
    });
    const valeurs = (x: Parametres) => ({ periodeRevueMois: x.periodeRevueMois, rappelJours: x.rappelJours, escaladeJours: x.escaladeJours });
    await journaliserLesDeux(client, org, {
      action: "PARAMETRES_MODIFIES", ...traceActeur(acteur), cibleType: "organisation", cibleId: org.id, details: { avant: valeurs(avant), apres: valeurs(p) },
    });
  });
}

/** Échéance de la revue (AAAA-MM-JJ, fuseau de la plateforme), ou null si le document n'a jamais été approuvé. */
export function echeanceRevue(revueLe: Date | null, periodeMois: number, fuseau: string): string | null {
  return revueLe ? ajouterMois(jourLocal(revueLe, fuseau), periodeMois) : null;
}

export interface Revue {
  echeance: string;
  situation: SituationEcheance;
}

/** La revue d'un document PUBLIÉ (null sinon : brouillon, en circuit, archivé, jamais approuvé). */
export function revueDe(doc: { etat: string; revueLe: Date | null }, p: Parametres, fuseau: string, aujourdhui: string): Revue | null {
  if (doc.etat !== "publie") return null;
  const echeance = echeanceRevue(doc.revueLe, p.periodeRevueMois, fuseau);
  return echeance ? { echeance, situation: situationEcheance(echeance, aujourdhui, p.rappelJours, p.escaladeJours) } : null;
}
