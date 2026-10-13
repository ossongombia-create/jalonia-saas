// Tableau de bord de l'organisation (audit Q1) : documents par état, revues, actions, risques, opportunités,
// indicateurs, et ce qui attend la personne connectée (documents à décider, actions qui lui sont confiées).
// Tout est lu dans UNE transaction (vue cohérente), avec les droits de l'organisation.
import type { Pool } from "pg";
import type { RoleOrganisation } from "@/lib/rbac";
import { situationEcheance } from "@/lib/dates";
import { STATUTS_OUVERTS } from "@/lib/qse";
import { avecOrganisation } from "../db/transactions";
import type { OrganisationCible } from "../membres/service";
import { ETATS, lireIntervenants, transitionsPossibles, type EtatDocument } from "../documents/circuit";
import { lireParametres, revueDe } from "../documents/revues";
import { lireIndicateurs, lireOpportunites, lireRisques } from "./registres";
import { cleIndicateur, dernieresMesures, lireObjectifs, situationIndicateur, type SituationIndicateur } from "./indicateurs";

export interface DocumentADecider {
  id: string;
  reference: string;
  titre: string;
  etat: EtatDocument;
}

export interface ActionResumee {
  id: string;
  numero: number;
  titre: string;
  echeance: string | null;
  enRetard: boolean;
}

export interface TableauDeBord {
  documents: Record<EtatDocument, number>;
  revues: { proches: number; retard: number };
  actions: { ouvertes: number; retard: number; aVerifier: number };
  risques: { critique: number; significatif: number; acceptable: number; nonCote: number };
  opportunites: { plan: number; etudier: number; nonCote: number };
  indicateurs: Record<SituationIndicateur, number>;
  aDecider: DocumentADecider[];
  mesActions: ActionResumee[];
}

export async function lireTableauDeBord(pool: Pool, org: OrganisationCible, personne: { id: string; roles: readonly RoleOrganisation[] }, fuseau: string, aujourdhui: string): Promise<TableauDeBord> {
  return avecOrganisation(pool, org, async (client) => {
    const p = await lireParametres(client);
    const docs = await client.query<{ id: string; reference: string; titre: string; etat: EtatDocument; revue_le: Date | null; modifie_par: string | null }>(
      "SELECT id, reference, titre, etat, revue_le, modifie_par FROM documents WHERE supprime_le IS NULL ORDER BY reference, titre, id",
    );
    const documents = Object.fromEntries(ETATS.map((e) => [e, 0])) as Record<EtatDocument, number>;
    const revues = { proches: 0, retard: 0 };
    const aDecider: DocumentADecider[] = [];
    for (const d of docs.rows) {
      documents[d.etat]++;
      const revue = revueDe({ etat: d.etat, revueLe: d.revue_le }, p, fuseau, aujourdhui);
      if (revue?.situation === "proche") revues.proches++;
      else if (revue && revue.situation !== "a_jour") revues.retard++;
      if (d.etat === "en_verification" || d.etat === "en_approbation") {
        const intervenants = await lireIntervenants(client, d.id, d.modifie_par, d.etat);
        if (transitionsPossibles(d.etat, personne.roles, personne.id, intervenants).length > 0) aDecider.push({ id: d.id, reference: d.reference, titre: d.titre, etat: d.etat });
      }
    }

    const acts = await client.query<{ id: string; numero: number; titre: string; statut: string; responsable: string | null; echeance: string | null }>(
      "SELECT id, numero, titre, statut, responsable, to_char(echeance, 'YYYY-MM-DD') AS echeance FROM actions ORDER BY echeance NULLS LAST, numero",
    );
    const actions = { ouvertes: 0, retard: 0, aVerifier: 0 };
    const mesActions: ActionResumee[] = [];
    for (const a of acts.rows) {
      const ouverte = (STATUTS_OUVERTS as readonly string[]).includes(a.statut);
      const enRetard = ouverte && a.echeance !== null && ["retard", "escalade"].includes(situationEcheance(a.echeance, aujourdhui, 0, p.escaladeJours));
      if (ouverte) actions.ouvertes++;
      if (enRetard) actions.retard++;
      if (a.statut === "realisee") actions.aVerifier++;
      if (ouverte && a.responsable === personne.id) mesActions.push({ id: a.id, numero: a.numero, titre: a.titre, echeance: a.echeance, enRetard });
    }

    const risques = { critique: 0, significatif: 0, acceptable: 0, nonCote: 0 };
    for (const r of await lireRisques(client, "publies")) {
      if (r.niveau) risques[r.niveau]++;
      else risques.nonCote++;
    }
    const opportunites = { plan: 0, etudier: 0, nonCote: 0 };
    for (const o of await lireOpportunites(client, "publies")) {
      if (o.suite) opportunites[o.suite]++;
      else opportunites.nonCote++;
    }
    const [objectifs, mesures] = [await lireObjectifs(client), await dernieresMesures(client)];
    const indicateurs: Record<SituationIndicateur, number> = { atteint: 0, non_atteint: 0, sans_mesure: 0, sans_objectif: 0 };
    for (const i of await lireIndicateurs(client, "publies")) {
      const cle = cleIndicateur(i.documentId, i.id);
      indicateurs[situationIndicateur(objectifs.get(cle), mesures.get(cle))]++;
    }
    return { documents, revues, actions, risques, opportunites, indicateurs, aDecider, mesActions };
  });
}
