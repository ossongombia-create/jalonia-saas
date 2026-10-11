// Consultation pour le suivi : statistiques, sessions, journaux d'audit.
import type { Pool } from "pg";
import type { Action } from "@/lib/actions-journal";
import { avecOrganisation, enTransaction } from "../db/transactions";
import type { OrganisationTechnique } from "../db/identifiants";
import { journaliserPlateforme } from "../audit/journal";
import { revoquerUneSession, type ReglesSession } from "../auth/sessions";
import { traceActeur, type Acteur } from "../acteur";

export const LIGNES_PAR_PAGE = 50;

// ----------------------------------------------------------------------------------------------------
// Statistiques
// ----------------------------------------------------------------------------------------------------
export interface Statistiques {
  organisationsActives: number;
  comptesActifs: number;
  sessionsOuvertes: number;
  connexions24h: number;
  echecs24h: number;
}

/** Condition SQL « session réellement ouverte » ($1 = minutes d'inactivité, $2 = heures de durée max). */
const SESSION_OUVERTE = `s.fin IS NULL
  AND s.derniere_activite >= now() - ($1::int * interval '1 minute')
  AND s.debut >= now() - ($2::int * interval '1 hour')`;

export async function statistiquesPlateforme(pool: Pool, regles: ReglesSession): Promise<Statistiques> {
  return enTransaction(pool, async (client) => {
    const r = await client.query<{ o: number; u: number; s: number; c: number; e: number }>(
      `SELECT (SELECT count(*)::int FROM platform.organisations WHERE statut = 'active') AS o,
              (SELECT count(*)::int FROM platform.utilisateurs WHERE statut = 'actif') AS u,
              (SELECT count(*)::int FROM platform.sessions s WHERE ${SESSION_OUVERTE}) AS s,
              (SELECT count(*)::int FROM platform.journal WHERE action = 'CONNEXION' AND horodatage >= now() - interval '24 hours') AS c,
              (SELECT count(*)::int FROM platform.journal WHERE action = 'CONNEXION_ECHEC' AND horodatage >= now() - interval '24 hours') AS e`,
      [regles.inactiviteMinutes, regles.dureeMaxHeures],
    );
    const l = r.rows[0]!;
    return { organisationsActives: l.o, comptesActifs: l.u, sessionsOuvertes: l.s, connexions24h: l.c, echecs24h: l.e };
  });
}

// ----------------------------------------------------------------------------------------------------
// Sessions
// ----------------------------------------------------------------------------------------------------
export interface LigneSession {
  id: string;
  utilisateurId: string;
  email: string;
  nom: string;
  organisation: string | null;
  debut: Date;
  derniereActivite: Date;
  fin: Date | null;
  motifFin: "deconnexion" | "expiration" | "revocation" | null;
  ip: string | null;
  agent: string | null;
  secondes: number;
}

interface LigneSessionSql {
  id: string; utilisateur_id: string; email: string; nom: string; organisation: string | null; debut: Date; derniere_activite: Date;
  fin: Date | null; motif_fin: LigneSession["motifFin"]; ip: string | null; agent: string | null; secondes: number;
}

const COLONNES_SESSION = `s.id, s.utilisateur_id, u.email, u.nom, o.nom AS organisation, s.debut, s.derniere_activite, s.fin, s.motif_fin,
  host(s.ip) AS ip, s.agent, extract(epoch FROM (COALESCE(s.fin, s.derniere_activite) - s.debut))::int AS secondes
  FROM platform.sessions s
  JOIN platform.utilisateurs u ON u.id = s.utilisateur_id
  LEFT JOIN platform.organisations o ON o.id = s.organisation_id`;

function versSession(l: LigneSessionSql): LigneSession {
  return {
    id: l.id, utilisateurId: l.utilisateur_id, email: l.email, nom: l.nom, organisation: l.organisation, debut: l.debut, derniereActivite: l.derniere_activite,
    fin: l.fin, motifFin: l.motif_fin, ip: l.ip, agent: l.agent, secondes: l.secondes,
  };
}

export async function listerSessionsOuvertes(pool: Pool, regles: ReglesSession, utilisateurId?: string): Promise<LigneSession[]> {
  return enTransaction(pool, async (client) => {
    const r = await client.query<LigneSessionSql>(
      `SELECT ${COLONNES_SESSION}
        WHERE ${SESSION_OUVERTE} AND ($3::uuid IS NULL OR s.utilisateur_id = $3::uuid)
        ORDER BY s.derniere_activite DESC
        LIMIT 500`,
      [regles.inactiviteMinutes, regles.dureeMaxHeures, utilisateurId ?? null],
    );
    return r.rows.map(versSession);
  });
}

/** Sessions terminées des N derniers jours (les sessions expirées sans retour de l'utilisateur sont comprises). */
export async function listerSessionsTerminees(pool: Pool, regles: ReglesSession, jours: number, utilisateurId?: string): Promise<LigneSession[]> {
  return enTransaction(pool, async (client) => {
    const r = await client.query<LigneSessionSql>(
      `SELECT ${COLONNES_SESSION}
        WHERE NOT (${SESSION_OUVERTE})
          AND s.debut >= now() - ($4::int * interval '1 day')
          AND ($3::uuid IS NULL OR s.utilisateur_id = $3::uuid)
        ORDER BY s.debut DESC
        LIMIT 500`,
      [regles.inactiviteMinutes, regles.dureeMaxHeures, utilisateurId ?? null, jours],
    );
    return r.rows.map(versSession);
  });
}

/** Le superadmin ferme une session. Renvoie false si elle était déjà fermée. */
export async function revoquerSession(pool: Pool, sessionId: string, acteur: Acteur): Promise<boolean> {
  return enTransaction(pool, async (client) => {
    const r = await client.query<{ utilisateur_id: string }>("SELECT utilisateur_id FROM platform.sessions WHERE id = $1", [sessionId]);
    const cible = r.rows[0];
    if (!cible) return false;
    const fermee = await revoquerUneSession(client, sessionId);
    if (fermee) {
      await journaliserPlateforme(client, { action: "SESSION_REVOQUEE", ...traceActeur(acteur), cibleType: "session", cibleId: sessionId, details: { utilisateurId: cible.utilisateur_id } });
    }
    return fermee;
  });
}

// ----------------------------------------------------------------------------------------------------
// Journaux d'audit
// ----------------------------------------------------------------------------------------------------
export interface LigneJournal {
  id: string;
  horodatage: Date;
  acteurId: string | null;
  acteurEmail: string | null;
  action: Action;
  cibleType: string | null;
  cibleId: string | null;
  details: Record<string, unknown>;
  ip: string | null;
  organisation?: string | null;
}

export interface PageJournal {
  lignes: LigneJournal[];
  page: number;
  aSuite: boolean;
}

export interface FiltreJournal {
  page: number; // à partir de 1
  action?: Action;
  acteurId?: string;
}

interface LigneJournalSql {
  id: string; horodatage: Date; acteur_id: string | null; acteur_email: string | null; action: Action; cible_type: string | null;
  cible_id: string | null; details: Record<string, unknown>; ip: string | null; organisation?: string | null;
}

function versPage(lignes: LigneJournalSql[], page: number): PageJournal {
  return {
    page,
    aSuite: lignes.length > LIGNES_PAR_PAGE,
    lignes: lignes.slice(0, LIGNES_PAR_PAGE).map((l) => ({
      id: l.id, horodatage: l.horodatage, acteurId: l.acteur_id, acteurEmail: l.acteur_email, action: l.action, cibleType: l.cible_type,
      cibleId: l.cible_id, details: l.details, ip: l.ip, organisation: l.organisation,
    })),
  };
}

function pageValide(page: number): number {
  return Number.isInteger(page) && page >= 1 && page <= 10_000 ? page : 1;
}

export async function lireJournalPlateforme(pool: Pool, filtre: FiltreJournal): Promise<PageJournal> {
  const page = pageValide(filtre.page);
  return enTransaction(pool, async (client) => {
    const r = await client.query<LigneJournalSql>(
      `SELECT j.id::text AS id, j.horodatage, j.acteur_id, j.acteur_email, j.action, j.cible_type, j.cible_id, j.details,
              host(j.ip) AS ip, o.nom AS organisation
         FROM platform.journal j
         LEFT JOIN platform.organisations o ON o.id = j.organisation_id
        WHERE ($1::text IS NULL OR j.action = $1::text)
          AND ($2::uuid IS NULL OR j.acteur_id = $2::uuid)
        ORDER BY j.id DESC
        LIMIT $3 OFFSET $4`,
      [filtre.action ?? null, filtre.acteurId ?? null, LIGNES_PAR_PAGE + 1, (page - 1) * LIGNES_PAR_PAGE],
    );
    return versPage(r.rows, page);
  });
}

/** Journal d'une organisation : lu AVEC LE RÔLE de l'organisation, dans son schéma (étanchéité). */
export async function lireJournalOrganisation(pool: Pool, org: OrganisationTechnique, filtre: FiltreJournal): Promise<PageJournal> {
  const page = pageValide(filtre.page);
  return avecOrganisation(pool, org, async (client) => {
    const r = await client.query<LigneJournalSql>(
      `SELECT id::text AS id, horodatage, acteur_id, acteur_email, action, cible_type, cible_id, details, host(ip) AS ip
         FROM journal
        WHERE ($1::text IS NULL OR action = $1::text)
        ORDER BY id DESC
        LIMIT $2 OFFSET $3`,
      [filtre.action ?? null, LIGNES_PAR_PAGE + 1, (page - 1) * LIGNES_PAR_PAGE],
    );
    return versPage(r.rows, page);
  });
}
