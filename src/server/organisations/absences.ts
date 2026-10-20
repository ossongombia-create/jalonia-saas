// Alerte « titulaire absent depuis 60 jours » (chantier 2 du 20/10/2026, B6 et B7) : section « Alertes » du
// superadmin (calculée à la lecture, aucune table), notifications et journal par les tâches quotidiennes, courriel aux
// superadmins par scripts/taches-quotidiennes.ts. À part de binome.ts : les tâches quotidiennes, construites en un
// seul fichier (scripts/construire-taches.mjs), n'embarquent pas les invitations (hachage des mots de passe).
import type { Pool } from "pg";
import { ecartJours, jourLocal } from "@/lib/dates";
import { dansOrganisation, enTransaction } from "../db/transactions";
import { journaliserLesDeux } from "../audit/journal";
import { notifier, type NouvelleNotification } from "../notifications/service";
import { envoyerCourriel } from "../notifications/courriel";

/** Jours d'absence à partir desquels le titulaire, le suppléant actif et le superadmin sont alertés. */
export const JOURS_ALERTE_ABSENCE = 60;

export interface AlerteAbsence {
  organisationId: string;
  organisation: string;
  titulaireId: string;
  titulaire: string;
  debut: string;
  jours: number;
  suppleantActif: boolean;
  suppleant: string | null;
}

/**
 * Titulaires absents depuis 60 jours ou plus, dans les organisations actives : section « Alertes » du superadmin,
 * calculée à la lecture (aucune table). `aujourdhui` : jour local (AAAA-MM-JJ).
 */
export async function alertesAbsence(pool: Pool, fuseau: string, aujourdhui: string): Promise<AlerteAbsence[]> {
  const r = await enTransaction(pool, (client) =>
    client.query<{ organisation_id: string; organisation: string; titulaire_id: string; titulaire: string; debut: Date; suppleant: string | null; suppleant_actif: boolean | null }>(
      `SELECT o.id AS organisation_id, o.nom AS organisation, u.id AS titulaire_id, coalesce(nullif(u.nom, ''), u.email) AS titulaire, a.date_absence_debut AS debut,
              (SELECT coalesce(nullif(us.nom, ''), us.email) FROM platform.adhesions s JOIN platform.utilisateurs us ON us.id = s.utilisateur_id
                WHERE s.organisation_id = o.id AND s.fonction_org = 'suppleant') AS suppleant,
              (SELECT s.statut_suppleant = 'actif' FROM platform.adhesions s WHERE s.organisation_id = o.id AND s.fonction_org = 'suppleant') AS suppleant_actif
         FROM platform.adhesions a
         JOIN platform.organisations o ON o.id = a.organisation_id
         JOIN platform.utilisateurs u ON u.id = a.utilisateur_id
        WHERE a.fonction_org = 'titulaire' AND a.date_absence_debut IS NOT NULL AND o.statut = 'active'
        ORDER BY a.date_absence_debut, o.nom`,
    ),
  );
  return r.rows
    .map((l) => {
      const debut = jourLocal(l.debut, fuseau);
      return {
        organisationId: l.organisation_id, organisation: l.organisation, titulaireId: l.titulaire_id, titulaire: l.titulaire, debut, jours: ecartJours(debut, aujourdhui),
        suppleantActif: l.suppleant_actif === true, suppleant: l.suppleant,
      };
    })
    .filter((a) => a.jours >= JOURS_ALERTE_ABSENCE);
}

/**
 * Tâches quotidiennes : notification « titulaire absent depuis 60 jours » au titulaire et au suppléant actif (nature
 * absence_titulaire), une seule fois par période d'absence (clé), plus ADMIN_ABSENCE_SOIXANTE_JOURS dans les deux journaux.
 * Aucun changement d'état. Renvoie les alertes NOUVELLES (à envoyer aux superadmins par courriel).
 */
export async function notifierAbsences(pool: Pool, fuseau: string, aujourdhui: string): Promise<{ notifications: number; nouvelles: AlerteAbsence[] }> {
  let notifications = 0;
  const nouvelles: AlerteAbsence[] = [];
  for (const a of await alertesAbsence(pool, fuseau, aujourdhui)) {
    const r = await enTransaction(pool, async (client) => {
      const o = (await client.query<{ schema_name: string; role_name: string }>(
        "SELECT schema_name, role_name FROM platform.organisations WHERE id = $1", [a.organisationId])).rows[0];
      if (!o) return 0;
      const org = { id: a.organisationId, schemaName: o.schema_name, roleName: o.role_name };
      const suppleant = (await client.query<{ utilisateur_id: string }>(
        `SELECT a.utilisateur_id FROM platform.adhesions a JOIN platform.utilisateurs u ON u.id = a.utilisateur_id
          WHERE a.organisation_id = $1 AND a.fonction_org = 'suppleant' AND a.statut_suppleant = 'actif' AND u.statut = 'actif'`,
        [org.id])).rows[0]?.utilisateur_id;
      const cle = `absence:${org.id}:${a.titulaireId}:${a.debut}:${JOURS_ALERTE_ABSENCE}`;
      const details = { titulaire: a.titulaire, debut: a.debut, jours: a.jours };
      const pour = (destinataire: string): NouvelleNotification => ({ destinataire, nature: "absence_titulaire", cle, details });
      // Le titulaire d'abord : c'est SA notification qui marque la première alerte de cette absence (journal, courriel).
      const premiere = await dansOrganisation(client, org, () => notifier(client, [pour(a.titulaireId)]));
      const autres = suppleant ? await dansOrganisation(client, org, () => notifier(client, [pour(suppleant)])) : 0;
      if (premiere > 0) {
        await journaliserLesDeux(client, org, {
          action: "ADMIN_ABSENCE_SOIXANTE_JOURS", acteurEmail: "taches-quotidiennes", cibleType: "utilisateur", cibleId: a.titulaireId,
          details: { debut: a.debut, jours: a.jours, suppleantActif: Boolean(suppleant) },
        });
        nouvelles.push(a);
      }
      return premiere + autres;
    });
    notifications += r;
  }
  return { notifications, nouvelles };
}

/** Courriel aux superadmins actifs pour chaque NOUVELLE alerte (si le SMTP est configuré ; un échec ne bloque rien). */
export async function envoyerAlertesSuperadmins(pool: Pool, alertes: readonly AlerteAbsence[]): Promise<number> {
  if (alertes.length === 0) return 0;
  const superadmins = await enTransaction(pool, (c) =>
    c.query<{ email: string; langue: "fr" | "en" }>("SELECT email, langue FROM platform.utilisateurs WHERE est_superadmin AND statut = 'actif' ORDER BY email"));
  let envoyes = 0;
  for (const a of alertes) {
    for (const sa of superadmins.rows) {
      const en = sa.langue === "en";
      try {
        const ok = await envoyerCourriel({
          a: sa.email,
          sujet: en ? `Jalonia — alert: ${a.organisation}` : `Jalonia — alerte : ${a.organisation}`,
          texte: en
            ? `Primary administrator ${a.titulaire} of ${a.organisation} has been absent since ${a.debut} (${a.jours} days). Deputy: ${a.suppleant ?? "none"}${a.suppleant ? (a.suppleantActif ? " (active)" : " (inactive)") : ""}.\n\nSee the « Alerts » section of the platform dashboard.`
            : `L'administrateur titulaire ${a.titulaire} de ${a.organisation} est absent depuis le ${a.debut} (${a.jours} jours). Suppléant : ${a.suppleant ?? "aucun"}${a.suppleant ? (a.suppleantActif ? " (actif)" : " (inactif)") : ""}.\n\nVoir la section « Alertes » du tableau de bord de la plateforme.`,
        });
        if (ok) envoyes++;
      } catch {
        console.error(JSON.stringify({ evenement: "courriel_alerte_superadmin_echec", organisationId: a.organisationId }));
      }
    }
  }
  return envoyes;
}
