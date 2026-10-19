// Accès d'urgence de l'exploitant (décision n° 1 du 19/10/2026, audit S9 ; migration plateforme 0008).
//
// Un compte superadmin n'est jamais membre d'une organisation. Pour intervenir dans ses données (dépannage, support
// demandé par le client), il ouvre un accès d'urgence : un MOTIF, un rôle (administrateur, rédacteur ou lecteur) et
// une durée de 1, 4, 8 ou 24 heures. À l'ouverture, chaque administrateur actif de l'organisation est notifié (dans
// l'application, puis par courriel) et l'accès est inscrit dans les deux journaux. L'accès ne vaut plus rien à son
// échéance (lireAccesActifs ne le rend plus) ; le superadmin peut aussi le fermer avant.
import type { Pool, PoolClient } from "pg";
import type { RoleOrganisation } from "@/lib/rbac";
import { enTransaction, dansOrganisation } from "../db/transactions";
import { journaliserLesDeux } from "../audit/journal";
import { ErreurMetier, estErreurPg, PG_UNICITE } from "../erreurs";
import { nomActeur, traceActeur, type Acteur } from "../acteur";
import { ayantRole, membresDestinataires, notifier } from "../notifications/service";

export const ROLES_ACCES_URGENCE = ["ADMIN_ORGANISATION", "REDACTEUR", "LECTEUR"] as const satisfies readonly RoleOrganisation[];
export type RoleAccesUrgence = (typeof ROLES_ACCES_URGENCE)[number];
export const DUREES_ACCES_URGENCE = [1, 4, 8, 24] as const;
export type DureeAccesUrgence = (typeof DUREES_ACCES_URGENCE)[number];

export interface DemandeAccesUrgence {
  role: RoleAccesUrgence;
  dureeHeures: DureeAccesUrgence;
  motif: string; // 10 à 2 000 caractères
}

export interface AccesUrgenceOuvert {
  id: string;
  expireLe: Date;
  /** Nombre d'administrateurs de l'organisation notifiés. */
  notifies: number;
}

/** Ouvre un accès d'urgence (l'acteur DOIT être superadmin : vérifié par l'action, et par la base). */
export async function ouvrirAccesUrgence(pool: Pool, organisationId: string, demande: DemandeAccesUrgence, acteur: Acteur): Promise<AccesUrgenceOuvert> {
  if (!(ROLES_ACCES_URGENCE as readonly string[]).includes(demande.role)) throw new ErreurMetier("erreur.role_invalide");
  if (!(DUREES_ACCES_URGENCE as readonly number[]).includes(demande.dureeHeures)) throw new ErreurMetier("acces.duree_invalide");
  const motif = demande.motif.trim();
  if (motif.length < 10 || motif.length > 2000) throw new ErreurMetier("acces.motif_requis");
  try {
    return await enTransaction(pool, async (client) => {
      const r = await client.query<{ nom: string; statut: string; schema_name: string; role_name: string }>(
        "SELECT nom, statut, schema_name, role_name FROM platform.organisations WHERE id = $1 FOR SHARE",
        [organisationId],
      );
      const o = r.rows[0];
      if (!o) throw new ErreurMetier("erreur.introuvable");
      if (o.statut !== "active") throw new ErreurMetier("acces.organisation_suspendue");
      const org = { id: organisationId, schemaName: o.schema_name, roleName: o.role_name };
      await fermerEchus(client, acteur.id, organisationId);
      const cree = await client.query<{ id: string; expire_le: Date }>(
        `INSERT INTO platform.acces_urgence (organisation_id, superadmin_id, role, motif, duree_heures, expire_le)
         VALUES ($1, $2, $3, $4, $5, now() + make_interval(hours => $5))
         RETURNING id, expire_le`,
        [organisationId, acteur.id, demande.role, motif, demande.dureeHeures],
      );
      const acces = cree.rows[0]!;
      await journaliserLesDeux(client, org, {
        action: "ACCES_URGENCE_OUVERT", ...traceActeur(acteur), cibleType: "acces_urgence", cibleId: acces.id,
        details: { role: demande.role, dureeHeures: demande.dureeHeures, expireLe: acces.expire_le.toISOString(), motif },
      });
      const administrateurs = ayantRole(await membresDestinataires(client, organisationId), ["ADMIN_ORGANISATION"]);
      await dansOrganisation(client, org, () =>
        notifier(client, administrateurs.map((destinataire) => ({
          destinataire, nature: "acces_urgence" as const, cle: `acces_urgence:${acces.id}`,
          details: { par: nomActeur(acteur), motif, heures: demande.dureeHeures },
        }))),
      );
      return { id: acces.id, expireLe: acces.expire_le, notifies: administrateurs.length };
    });
  } catch (erreur) {
    // Un accès est déjà ouvert pour ce superadmin dans cette organisation (ou deux ouvertures simultanées).
    if (estErreurPg(erreur, PG_UNICITE)) throw new ErreurMetier("acces.deja_ouvert");
    throw erreur;
  }
}

/** Marque fermés (à leur échéance) les accès échus de ce superadmin dans cette organisation. */
async function fermerEchus(client: PoolClient, superadminId: string, organisationId: string): Promise<void> {
  await client.query(
    `UPDATE platform.acces_urgence SET ferme_le = expire_le
      WHERE superadmin_id = $1 AND organisation_id = $2 AND ferme_le IS NULL AND expire_le <= now()`,
    [superadminId, organisationId],
  );
}

/** Ferme un accès encore valable, avant son échéance. */
export async function fermerAccesUrgence(pool: Pool, accesId: string, acteur: Acteur): Promise<void> {
  await enTransaction(pool, async (client) => {
    const r = await client.query<{ organisation_id: string; schema_name: string; role_name: string }>(
      `UPDATE platform.acces_urgence a SET ferme_le = now(), ferme_par = $2
         FROM platform.organisations o
        WHERE a.id = $1 AND o.id = a.organisation_id AND a.ferme_le IS NULL AND a.expire_le > now()
        RETURNING a.organisation_id, o.schema_name, o.role_name`,
      [accesId, acteur.id],
    );
    const a = r.rows[0];
    if (!a) throw new ErreurMetier("acces.deja_ferme");
    await journaliserLesDeux(client, { id: a.organisation_id, schemaName: a.schema_name, roleName: a.role_name }, {
      action: "ACCES_URGENCE_FERME", ...traceActeur(acteur), cibleType: "acces_urgence", cibleId: accesId,
    });
  });
}

export interface AccesActif {
  organisationId: string;
  role: RoleAccesUrgence;
  expireLe: Date;
}

/** Accès d'urgence valables MAINTENANT pour ce compte (aucun pour un compte qui n'est pas superadmin). */
export async function lireAccesActifs(client: PoolClient, utilisateurId: string): Promise<AccesActif[]> {
  const r = await client.query<{ organisation_id: string; role: RoleAccesUrgence; expire_le: Date }>(
    `SELECT a.organisation_id, a.role, a.expire_le
       FROM platform.acces_urgence a JOIN platform.utilisateurs u ON u.id = a.superadmin_id
      WHERE a.superadmin_id = $1 AND u.est_superadmin AND a.ferme_le IS NULL AND a.expire_le > now()`,
    [utilisateurId],
  );
  return r.rows.map((a) => ({ organisationId: a.organisation_id, role: a.role, expireLe: a.expire_le }));
}

export type EtatAccesUrgence = "actif" | "ferme" | "echu";

export interface LigneAccesUrgence {
  id: string;
  superadminEmail: string;
  superadminNom: string;
  role: RoleAccesUrgence;
  motif: string;
  dureeHeures: number;
  ouvertLe: Date;
  expireLe: Date;
  fermeLe: Date | null;
  etat: EtatAccesUrgence;
}

/** Les accès d'urgence d'une organisation, les plus récents d'abord (montrés au superadmin ET à l'organisation). */
export async function listerAccesUrgence(pool: Pool, organisationId: string, limite = 20): Promise<LigneAccesUrgence[]> {
  return enTransaction(pool, async (client) => {
    const r = await client.query<{
      id: string; email: string; nom: string; role: RoleAccesUrgence; motif: string; duree_heures: number; ouvert_le: Date; expire_le: Date; ferme_le: Date | null; actif: boolean;
    }>(
      `SELECT a.id, u.email, u.nom, a.role, a.motif, a.duree_heures, a.ouvert_le, a.expire_le, a.ferme_le,
              (a.ferme_le IS NULL AND a.expire_le > now()) AS actif
         FROM platform.acces_urgence a JOIN platform.utilisateurs u ON u.id = a.superadmin_id
        WHERE a.organisation_id = $1
        ORDER BY a.ouvert_le DESC, a.id LIMIT $2`,
      [organisationId, limite],
    );
    return r.rows.map((a) => ({
      id: a.id, superadminEmail: a.email, superadminNom: a.nom, role: a.role, motif: a.motif, dureeHeures: a.duree_heures,
      ouvertLe: a.ouvert_le, expireLe: a.expire_le, fermeLe: a.ferme_le,
      etat: a.actif ? "actif" : a.ferme_le && a.ferme_le < a.expire_le ? "ferme" : "echu",
    }));
  });
}
