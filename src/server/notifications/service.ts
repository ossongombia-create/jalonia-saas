// Notifications dans l'application (audit W2 ; migration organisation 0006).
//
// Une notification est adressée à UNE personne de l'organisation : document à vérifier ou à approuver, document refusé
// ou publié, revue à faire ou en retard, action confiée ou en retard. Chacune porte une clé : la même notification
// n'est jamais créée deux fois pour la même personne (les tâches quotidiennes peuvent repasser sans doublon).
// Chacun ne lit et ne marque que les siennes, dans l'organisation ouverte.
// L'envoi par e-mail viendra avec le module SMTP (audit O2) ; les notifications restent la source.
import type { Pool, PoolClient } from "pg";
import type { RoleOrganisation } from "@/lib/rbac";
import { avecOrganisation } from "../db/transactions";
import type { OrganisationCible } from "../membres/service";

export const NATURES = [
  "a_verifier", "a_approuver", "refuse", "publie",
  "revue_proche", "revue_retard", "revue_escalade",
  "action_confiee", "action_proche", "action_retard", "action_escalade",
  "acces_urgence",
  "absence_titulaire",
] as const;
export type NatureNotification = (typeof NATURES)[number];

/** Ce que le texte de la notification affiche (instantané : le titre au moment de la notification). */
export interface DetailsNotification {
  titre?: string;
  reference?: string;
  version?: number;
  motif?: string;
  par?: string;
  echeance?: string;
  jours?: number;
  /** Accès d'urgence : durée en heures. */
  heures?: number;
  /** Absence du titulaire (chantier 2) : nom du titulaire et jour de début. */
  titulaire?: string;
  debut?: string;
}

export interface NouvelleNotification {
  destinataire: string;
  nature: NatureNotification;
  cle: string;
  documentId?: string | null;
  actionId?: string | null;
  details: DetailsNotification;
}

export interface Notification {
  id: string;
  nature: NatureNotification;
  documentId: string | null;
  actionId: string | null;
  details: DetailsNotification;
  creeeLe: Date;
  lueLe: Date | null;
}

export interface MembreDestinataire {
  id: string;
  nom: string;
  roles: RoleOrganisation[];
  email?: string;
  langue?: "fr" | "en";
}

const MOTIF_MAX = 300;
const TEXTE_MAX = 200;
const court = (v: string | undefined, max: number) => (v === undefined ? undefined : v.length > max ? `${v.slice(0, max)}…` : v);

/**
 * Membres ACTIFS de l'organisation et leurs rôles (tables de la plateforme : à appeler AVANT de passer dans
 * l'organisation, dans la même transaction).
 */
export async function membresDestinataires(client: PoolClient, organisationId: string): Promise<MembreDestinataire[]> {
  const r = await client.query<{ id: string; nom: string; email: string; langue: "fr" | "en"; roles: RoleOrganisation[] }>(
    `SELECT u.id, u.nom, u.email, u.langue, a.roles FROM platform.adhesions a JOIN platform.utilisateurs u ON u.id = a.utilisateur_id
      WHERE a.organisation_id = $1 AND u.statut = 'actif' ORDER BY u.id`,
    [organisationId],
  );
  return r.rows.map((m) => ({ ...m, id: m.id }));
}

export interface CourrielNotification {
  id: string;
  destinataire: string;
  nature: NatureNotification;
  details: DetailsNotification;
}

/** Notifications récentes à livrer, relues hors de la transaction de création. */
export async function notificationsEnAttenteCourriel(client: PoolClient): Promise<CourrielNotification[]> {
  const r = await client.query<{ id: string; destinataire: string; nature: NatureNotification; details: DetailsNotification }>(
    `SELECT id::text, destinataire::text, nature, details FROM notifications
      WHERE email_envoyee_le IS NULL AND email_tentatives < 5 AND creee_le >= now() - interval '7 days'
      ORDER BY id LIMIT 100`,
  );
  return r.rows;
}

export async function noterCourrielNotification(client: PoolClient, id: string, envoye: boolean): Promise<void> {
  await client.query(
    `UPDATE notifications SET email_tentatives = email_tentatives + 1,
            email_envoyee_le = CASE WHEN $2 THEN now() ELSE email_envoyee_le END
      WHERE id = $1 AND email_envoyee_le IS NULL`,
    [id, envoye],
  );
}

/** Les membres qui ont l'un des rôles, sauf les personnes exclues (sans doublon). */
export function ayantRole(membres: readonly MembreDestinataire[], roles: readonly RoleOrganisation[], exclus: readonly (string | null | undefined)[] = []): string[] {
  return membres.filter((m) => m.roles.some((r) => roles.includes(r)) && !exclus.includes(m.id)).map((m) => m.id);
}

/** Crée les notifications (client DANS l'organisation) ; une notification déjà créée (même clé) est ignorée. */
export async function notifier(client: PoolClient, liste: readonly NouvelleNotification[]): Promise<number> {
  let creees = 0;
  for (const n of liste) {
    const details: DetailsNotification = {
      ...n.details,
      titre: court(n.details.titre, TEXTE_MAX),
      reference: court(n.details.reference, TEXTE_MAX),
      motif: court(n.details.motif, MOTIF_MAX),
      par: court(n.details.par, TEXTE_MAX),
    };
    const r = await client.query(
      `INSERT INTO notifications (destinataire, nature, cle, document_id, action_id, details) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (destinataire, cle) DO NOTHING`,
      [n.destinataire, n.nature, n.cle, n.documentId ?? null, n.actionId ?? null, JSON.stringify(details)],
    );
    creees += r.rowCount ?? 0;
  }
  return creees;
}

export async function listerNotifications(pool: Pool, org: OrganisationCible, utilisateurId: string, limite = 100): Promise<Notification[]> {
  return avecOrganisation(pool, org, async (client) => {
    const r = await client.query<{ id: string; nature: NatureNotification; document_id: string | null; action_id: string | null; details: DetailsNotification; creee_le: Date; lue_le: Date | null }>(
      `SELECT id::text AS id, nature, document_id, action_id, details, creee_le, lue_le FROM notifications
        WHERE destinataire = $1 ORDER BY notifications.id DESC LIMIT $2`, // la colonne, pas l'alias texte « id »
      [utilisateurId, limite],
    );
    return r.rows.map((l) => ({ id: l.id, nature: l.nature, documentId: l.document_id, actionId: l.action_id, details: l.details, creeeLe: l.creee_le, lueLe: l.lue_le }));
  });
}

export async function compterNonLues(pool: Pool, org: OrganisationCible, utilisateurId: string): Promise<number> {
  return avecOrganisation(pool, org, async (client) => {
    const r = await client.query<{ n: number }>("SELECT count(*)::int AS n FROM notifications WHERE destinataire = $1 AND lue_le IS NULL", [utilisateurId]);
    return r.rows[0]?.n ?? 0;
  });
}

/** Marque comme lues les notifications de la personne (toutes, ou celles dont l'identifiant est donné). */
export async function marquerLues(pool: Pool, org: OrganisationCible, utilisateurId: string, ids: readonly string[] | "toutes"): Promise<number> {
  return avecOrganisation(pool, org, async (client) => {
    if (ids === "toutes") {
      return (await client.query("UPDATE notifications SET lue_le = now() WHERE destinataire = $1 AND lue_le IS NULL", [utilisateurId])).rowCount ?? 0;
    }
    const valides = ids.filter((i) => /^\d{1,18}$/.test(i));
    if (valides.length === 0) return 0;
    return (await client.query("UPDATE notifications SET lue_le = now() WHERE destinataire = $1 AND lue_le IS NULL AND id = ANY ($2::bigint[])", [utilisateurId, valides])).rowCount ?? 0;
  });
}

/** Ménage (tâches quotidiennes) : les notifications LUES de plus de `jours` jours. */
export async function purgerNotificationsLues(client: PoolClient, jours: number): Promise<number> {
  return (await client.query("DELETE FROM notifications WHERE lue_le IS NOT NULL AND lue_le < now() - make_interval(days => $1)", [jours])).rowCount ?? 0;
}
