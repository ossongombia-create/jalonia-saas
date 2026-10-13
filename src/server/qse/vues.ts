// Lectures groupées pour les pages QSE (une transaction par page : vue cohérente).
import type { Pool } from "pg";
import { avecOrganisation } from "../db/transactions";
import type { OrganisationCible } from "../membres/service";
import { estIdentifiant } from "../documents/service";
import { actionsOuvertesParElement } from "./actions";
import { cleIndicateur, dernieresMesures, lireObjectifs, situationIndicateur, type Objectif, type SituationIndicateur } from "./indicateurs";
import { lireIndicateurs, lireOpportunites, lireRisques, trouverElement, type ElementDocument, type IndicateurDocument, type OpportuniteDocument, type Portee, type RisqueDocument } from "./registres";

export interface RegistreRisques {
  risques: RisqueDocument[];
  opportunites: OpportuniteDocument[];
  /** Actions non closes par élément (clé « documentId:elementId »). */
  actions: Map<string, number>;
}

export function lireRegistreRisques(pool: Pool, org: OrganisationCible, portee: Portee): Promise<RegistreRisques> {
  return avecOrganisation(pool, org, async (client) => ({
    risques: await lireRisques(client, portee),
    opportunites: await lireOpportunites(client, portee),
    actions: await actionsOuvertesParElement(client),
  }));
}

export interface LigneIndicateur extends IndicateurDocument {
  objectif: Objectif | null;
  derniere: { date: string; valeur: number } | null;
  situation: SituationIndicateur;
}

export function lireRegistreIndicateurs(pool: Pool, org: OrganisationCible, portee: Portee): Promise<LigneIndicateur[]> {
  return avecOrganisation(pool, org, async (client) => {
    const [indicateurs, objectifs, mesures] = [await lireIndicateurs(client, portee), await lireObjectifs(client), await dernieresMesures(client)];
    return indicateurs.map((i) => {
      const cle = cleIndicateur(i.documentId, i.id);
      const objectif = objectifs.get(cle) ?? null;
      const derniere = mesures.get(cle) ?? null;
      return { ...i, objectif, derniere, situation: situationIndicateur(objectif, derniere) };
    });
  });
}

/** Élément de document visé par une nouvelle action (voir registres.trouverElement). */
export async function elementVise(pool: Pool, org: OrganisationCible, documentId: string, elementId: string): Promise<ElementDocument | null> {
  if (!estIdentifiant(documentId)) return null;
  return avecOrganisation(pool, org, (client) => trouverElement(client, documentId, elementId));
}
