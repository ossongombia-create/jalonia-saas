// Sessions : validées à CHAQUE requête. Une session est refusée si elle est terminée (déconnexion,
// révocation), inactive depuis trop longtemps, trop ancienne, ou si l'utilisateur a été désactivé.
import type { Pool, PoolClient } from "pg";
import { enTransaction } from "../db/transactions";
import { journaliserPlateforme } from "../audit/journal";
import type { Langue } from "@/lib/i18n";

export interface ReglesSession {
  inactiviteMinutes: number;
  dureeMaxHeures: number;
}

export interface UtilisateurSession {
  id: string;
  email: string;
  nom: string;
  estSuperadmin: boolean;
  doitChangerMdp: boolean;
  langue: Langue;
}

export interface SessionValide {
  utilisateur: UtilisateurSession;
  /** Organisation retenue dans la session (suivi d'activité), ou null. */
  organisationId: string | null;
}

interface Ligne {
  fin: Date | null;
  expiree: boolean;
  a_rafraichir: boolean;
  organisation_id: string | null;
  id: string;
  email: string;
  nom: string;
  est_superadmin: boolean;
  statut: "actif" | "desactive";
  doit_changer_mdp: boolean;
  langue: Langue;
}

const MOTIF_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Renvoie l'utilisateur de la session si elle est valide, sinon null (et la ferme si elle a expiré). */
export async function validerSession(pool: Pool, ids: { utilisateurId: string; sessionId: string }, regles: ReglesSession): Promise<SessionValide | null> {
  if (!MOTIF_UUID.test(ids.sessionId) || !MOTIF_UUID.test(ids.utilisateurId)) return null;
  return enTransaction(pool, async (client) => {
    const lu = await client.query<Ligne>(
      `SELECT s.fin, s.organisation_id,
              (s.derniere_activite < now() - ($3::int * interval '1 minute')
                OR s.debut < now() - ($4::int * interval '1 hour')) AS expiree,
              (s.derniere_activite < now() - interval '60 seconds') AS a_rafraichir,
              u.id, u.email, u.nom, u.est_superadmin, u.statut, u.doit_changer_mdp, u.langue
         FROM platform.sessions s
         JOIN platform.utilisateurs u ON u.id = s.utilisateur_id
        WHERE s.id = $1 AND s.utilisateur_id = $2`,
      [ids.sessionId, ids.utilisateurId, regles.inactiviteMinutes, regles.dureeMaxHeures],
    );
    const l = lu.rows[0];
    if (!l || l.fin !== null || l.statut !== "actif") return null;
    if (l.expiree) {
      await fermer(client, ids.sessionId, "expiration");
      await journaliserPlateforme(client, { action: "SESSION_EXPIREE", acteurId: l.id, acteurEmail: l.email, cibleType: "session", cibleId: ids.sessionId });
      return null;
    }
    // On n'écrit la dernière activité qu'une fois par minute au plus (évite une écriture à chaque clic).
    if (l.a_rafraichir) await client.query("UPDATE platform.sessions SET derniere_activite = now() WHERE id = $1", [ids.sessionId]);
    return {
      utilisateur: { id: l.id, email: l.email, nom: l.nom, estSuperadmin: l.est_superadmin, doitChangerMdp: l.doit_changer_mdp, langue: l.langue },
      organisationId: l.organisation_id,
    };
  });
}

async function fermer(client: PoolClient, sessionId: string, motif: "deconnexion" | "expiration" | "revocation"): Promise<void> {
  await client.query("UPDATE platform.sessions SET fin = now(), motif_fin = $2 WHERE id = $1 AND fin IS NULL", [sessionId, motif]);
}

/** Déconnexion volontaire. */
export async function terminerSession(pool: Pool, sessionId: string, acteur: { id: string; email: string; ip?: string | null; agent?: string | null }): Promise<void> {
  await enTransaction(pool, async (client) => {
    await fermer(client, sessionId, "deconnexion");
    await journaliserPlateforme(client, {
      action: "DECONNEXION",
      acteurId: acteur.id,
      acteurEmail: acteur.email,
      cibleType: "session",
      cibleId: sessionId,
      ip: acteur.ip,
      agent: acteur.agent,
    });
  });
}

/** Ferme toutes les sessions ouvertes d'un utilisateur (sauf, éventuellement, une). Renvoie le nombre fermé. */
export async function revoquerSessionsDe(client: PoolClient, utilisateurId: string, saufSessionId?: string): Promise<number> {
  const r = await client.query(
    `UPDATE platform.sessions SET fin = now(), motif_fin = 'revocation'
      WHERE utilisateur_id = $1 AND fin IS NULL AND ($2::uuid IS NULL OR id <> $2::uuid)`,
    [utilisateurId, saufSessionId ?? null],
  );
  return r.rowCount ?? 0;
}

/** Ferme une session précise (révocation par un superadmin). Renvoie false si elle était déjà fermée. */
export async function revoquerUneSession(client: PoolClient, sessionId: string): Promise<boolean> {
  const r = await client.query("UPDATE platform.sessions SET fin = now(), motif_fin = 'revocation' WHERE id = $1 AND fin IS NULL", [sessionId]);
  return (r.rowCount ?? 0) > 0;
}

/** Retient l'organisation choisie dans la session (pour le suivi d'activité par organisation). */
export async function noterOrganisationDeSession(pool: Pool, sessionId: string, organisationId: string): Promise<void> {
  await enTransaction(pool, (client) =>
    client.query("UPDATE platform.sessions SET organisation_id = $2 WHERE id = $1 AND fin IS NULL", [sessionId, organisationId]),
  );
}
