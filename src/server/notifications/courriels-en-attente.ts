// Vide la file des notifications après la transaction métier (livraison au plus tard au passage du minuteur).
import type { Pool } from "pg";
import { avecOrganisation, dansOrganisation, enTransaction } from "../db/transactions";
import { verifierOrganisationTechnique } from "../db/identifiants";
import { courrielConfigure, envoyerCourriel } from "./courriel";
import { membresDestinataires, notificationsEnAttenteCourriel, noterCourrielNotification } from "./service";

const OBJETS = {
  fr: { a_verifier: "Document à vérifier", a_approuver: "Document à approuver", refuse: "Document refusé", publie: "Document publié", revue_proche: "Revue périodique à venir", revue_retard: "Revue périodique en retard", revue_escalade: "Escalade de revue périodique", action_confiee: "Action confiée", action_proche: "Échéance d’action proche", action_retard: "Action en retard", action_escalade: "Escalade d’action", acces_urgence: "Accès d’urgence de l’exploitant", absence_titulaire: "Administrateur titulaire absent depuis 60 jours", validation_relance: "Relance : document en attente de votre décision" },
  en: { a_verifier: "Document to review", a_approuver: "Document to approve", refuse: "Document rejected", publie: "Document published", revue_proche: "Periodic review due soon", revue_retard: "Periodic review overdue", revue_escalade: "Periodic review escalation", action_confiee: "Action assigned", action_proche: "Action due soon", action_retard: "Action overdue", action_escalade: "Action escalation", acces_urgence: "Emergency access by the operator", absence_titulaire: "Primary administrator absent for 60 days", validation_relance: "Reminder: document awaiting your decision" },
} as const;

export interface BilanCourriels {
  organisations: number;
  envoyes: number;
  echoues: number;
  desactives: boolean;
  erreurs: string[];
}

export async function traiterCourrielsEnAttente(pool: Pool): Promise<BilanCourriels> {
  const bilan: BilanCourriels = { organisations: 0, envoyes: 0, echoues: 0, desactives: false, erreurs: [] };
  if (!courrielConfigure()) {
    bilan.desactives = true;
    return bilan;
  }
  const orgs = await enTransaction(pool, (c) =>
    c.query<{ id: string; schema_name: string; role_name: string }>("SELECT id, schema_name, role_name FROM platform.organisations WHERE statut = 'active' ORDER BY id"),
  );
  for (const o of orgs.rows) {
    const org = { id: o.id, schemaName: o.schema_name, roleName: o.role_name };
    try {
      verifierOrganisationTechnique(org);
      const lot = await enTransaction(pool, async (client) => {
        const membres = await membresDestinataires(client, org.id);
        const enAttente = await dansOrganisation(client, org, () => notificationsEnAttenteCourriel(client));
        return { membres, enAttente };
      });
      bilan.organisations++;
      const membres = new Map(lot.membres.map((m) => [m.id, m]));
      for (const n of lot.enAttente) {
        const membre = membres.get(n.destinataire);
        try {
          if (membre?.email) {
            const langue = membre.langue ?? "fr";
            const libelle = OBJETS[langue][n.nature];
            const origine = process.env.AUTH_URL;
            const url = origine ? new URL("/app/notifications", origine).toString() : "/app/notifications";
            const titre = n.details.titre ? `\n${n.details.titre}${n.details.reference ? ` (${n.details.reference})` : ""}` : "";
            const echeance = n.details.echeance ? `\n${langue === "en" ? "Due date" : "Échéance"} : ${n.details.echeance}` : "";
            const urgence = n.nature === "acces_urgence"
              ? `\n${langue === "en" ? "By" : "Par"} : ${n.details.par ?? "—"}\n${langue === "en" ? "Duration" : "Durée"} : ${n.details.heures ?? "—"} h\n${langue === "en" ? "Reason" : "Motif"} : ${n.details.motif ?? "—"}`
              : "";
            await envoyerCourriel({
              a: membre.email,
              sujet: `Jalonia — ${libelle}`,
              texte: `${libelle}${titre}${echeance}${urgence}\n\n${langue === "en" ? "Open Jalonia" : "Ouvrir Jalonia"} : ${url}\n\n${langue === "en" ? "This message was generated automatically." : "Ce message a été généré automatiquement."}`,
            });
          }
          await avecOrganisation(pool, org, (client) => noterCourrielNotification(client, n.id, true));
          if (membre?.email) bilan.envoyes++;
        } catch {
          await avecOrganisation(pool, org, (client) => noterCourrielNotification(client, n.id, false));
          bilan.echoues++;
          console.error(JSON.stringify({ evenement: "courriel_notification_echec", organisationId: org.id, notificationId: n.id }));
        }
      }
    } catch (erreur) {
      bilan.erreurs.push(org.id);
      console.error(JSON.stringify({ evenement: "courriel_file_organisation_echec", organisationId: org.id, erreur: erreur instanceof Error ? erreur.message : "inconnue" }));
    }
  }
  return bilan;
}
