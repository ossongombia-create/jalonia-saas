// Rappels et escalades des revues périodiques et des actions, ménage des notifications lues, alerte des titulaires
// absents depuis 60 jours (binôme d'administration, chantier 2).
import type { Pool } from "pg";
import { ecartJours, jourLocal } from "@/lib/dates";
import { dansOrganisation, enTransaction } from "../db/transactions";
import { verifierOrganisationTechnique } from "../db/identifiants";
import { lireParametres, revueDe } from "../documents/revues";
import { ayantRole, membresDestinataires, notifier, purgerNotificationsLues, type NouvelleNotification } from "../notifications/service";
import { echeancesActions } from "../qse/actions";
import { notifierAbsences, type AlerteAbsence } from "../organisations/absences";

export const CONSERVATION_NOTIFICATIONS_LUES_JOURS = 180;

export interface BilanTaches {
  aujourdhui: string;
  organisations: number;
  notifications: number;
  purgees: number;
  /** Titulaires absents depuis 60 jours : alertes NOUVELLES de ce passage (courriel aux superadmins : le script). */
  absences: AlerteAbsence[];
  erreurs: { organisationId: string; message: string }[];
}

export async function executerTachesQuotidiennes(pool: Pool, options: { fuseau: string; maintenant?: Date }): Promise<BilanTaches> {
  const aujourdhui = jourLocal(options.maintenant ?? new Date(), options.fuseau);
  const orgs = await enTransaction(pool, (c) =>
    c.query<{ id: string; schema_name: string; role_name: string }>("SELECT id, schema_name, role_name FROM platform.organisations WHERE statut = 'active' ORDER BY id"),
  );
  const bilan: BilanTaches = { aujourdhui, organisations: 0, notifications: 0, purgees: 0, absences: [], erreurs: [] };
  for (const o of orgs.rows) {
    const org = { id: o.id, schemaName: o.schema_name, roleName: o.role_name };
    try {
      verifierOrganisationTechnique(org);
      const r = await enTransaction(pool, async (client) => {
        const membres = await membresDestinataires(client, org.id);
        return dansOrganisation(client, org, async () => {
          const p = await lireParametres(client);
          const approbateurs = ayantRole(membres, ["APPROBATEUR"]);
          const admins = ayantRole(membres, ["ADMIN_ORGANISATION"]);
          const pourRevue = approbateurs.length > 0 ? approbateurs : admins;
          const liste: NouvelleNotification[] = [];
          const docs = await client.query<{ id: string; titre: string; reference: string; etat: string; revue_le: Date | null }>(
            "SELECT id, titre, reference, etat, revue_le FROM documents WHERE etat = 'publie' AND supprime_le IS NULL AND revue_le IS NOT NULL ORDER BY id",
          );
          for (const d of docs.rows) {
            const revue = revueDe({ etat: d.etat, revueLe: d.revue_le }, p, options.fuseau, aujourdhui);
            if (!revue || revue.situation === "a_jour") continue;
            const details = { titre: d.titre, reference: d.reference, echeance: revue.echeance };
            const vers = (qui: string[], nature: NouvelleNotification["nature"], stade: string, plus: object = {}) => {
              for (const destinataire of qui) liste.push({ destinataire, nature, cle: `revue:${d.id}:${revue.echeance}:${stade}`, documentId: d.id, details: { ...details, ...plus } });
            };
            if (revue.situation === "proche") vers(pourRevue, "revue_proche", "proche");
            else {
              vers(pourRevue, "revue_retard", "retard");
              if (revue.situation === "escalade") vers(admins, "revue_escalade", "escalade", { jours: ecartJours(revue.echeance, aujourdhui) });
            }
          }
          liste.push(...(await echeancesActions(client, membres, p, aujourdhui)));
          const creees = await notifier(client, liste);
          const purgees = await purgerNotificationsLues(client, CONSERVATION_NOTIFICATIONS_LUES_JOURS);
          return { creees, purgees };
        });
      });
      bilan.organisations++;
      bilan.notifications += r.creees;
      bilan.purgees += r.purgees;
    } catch (erreur) {
      bilan.erreurs.push({ organisationId: org.id, message: erreur instanceof Error ? erreur.message : String(erreur) });
    }
  }
  // Binôme d'administration (chantier 2) : titulaires absents depuis 60 jours (aucun changement d'état).
  try {
    const r = await notifierAbsences(pool, options.fuseau, aujourdhui);
    bilan.notifications += r.notifications;
    bilan.absences = r.nouvelles;
  } catch (erreur) {
    bilan.erreurs.push({ organisationId: "absences", message: erreur instanceof Error ? erreur.message : String(erreur) });
  }
  return bilan;
}
