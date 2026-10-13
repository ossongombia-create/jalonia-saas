// Membres d'une organisation : liste, modification des rôles, retrait. (On devient membre en ACCEPTANT une
// invitation : voir src/server/invitations/service.ts.)
// Utilisé par l'administrateur de l'organisation (sur SON organisation) et par le superadmin.
// Règle : retirer un membre ou lui ôter le rôle d'administrateur ne peut pas laisser l'organisation sans
// administrateur actif. (Le superadmin peut, lui, désactiver un compte — départ d'une personne — puis
// désigner un nouvel administrateur.)
// Chaque modification est tracée dans le journal de la plateforme ET dans celui de l'organisation,
// dans la même transaction (tout ou rien).
import type { Pool, PoolClient } from "pg";
import type { RoleOrganisation } from "@/lib/rbac";
import { enTransaction } from "../db/transactions";
import type { OrganisationTechnique } from "../db/identifiants";
import { journaliserLesDeux } from "../audit/journal";
import { ErreurMetier } from "../erreurs";
import { traceActeur, type Acteur } from "../acteur";

export interface OrganisationCible extends OrganisationTechnique {
  id: string;
}

export interface Membre {
  utilisateurId: string;
  email: string;
  nom: string;
  statut: "actif" | "desactive";
  roles: RoleOrganisation[];
  /** Dernière opération tracée DANS CETTE organisation (rien de l'activité ailleurs sur la plateforme). */
  derniereAction: Date | null;
  membreDepuis: Date;
}

export async function listerMembres(pool: Pool, organisationId: string): Promise<Membre[]> {
  return enTransaction(pool, async (client) => {
    const r = await client.query<{ id: string; email: string; nom: string; statut: "actif" | "desactive"; roles: RoleOrganisation[]; derniere_action: Date | null; cree_le: Date }>(
      `SELECT u.id, u.email, u.nom, u.statut, a.roles, a.cree_le,
              (SELECT max(j.horodatage) FROM platform.journal j
                WHERE j.organisation_id = a.organisation_id AND j.acteur_id = a.utilisateur_id) AS derniere_action
         FROM platform.adhesions a
         JOIN platform.utilisateurs u ON u.id = a.utilisateur_id
        WHERE a.organisation_id = $1
        ORDER BY u.nom, u.email`,
      [organisationId],
    );
    return r.rows.map((m) => ({
      utilisateurId: m.id, email: m.email, nom: m.nom, statut: m.statut, roles: m.roles, derniereAction: m.derniere_action, membreDepuis: m.cree_le,
    }));
  });
}

/** Verrouille les adhésions de l'organisation : deux modifications simultanées ne peuvent pas retirer le dernier administrateur. */
async function verrouillerAdhesions(client: PoolClient, organisationId: string): Promise<void> {
  await client.query("SELECT 1 FROM platform.adhesions WHERE organisation_id = $1 FOR UPDATE", [organisationId]);
}

async function autresAdministrateursActifs(client: PoolClient, organisationId: string, saufUtilisateurId: string): Promise<number> {
  const r = await client.query<{ n: number }>(
    `SELECT count(*)::int AS n
       FROM platform.adhesions a JOIN platform.utilisateurs u ON u.id = a.utilisateur_id
      WHERE a.organisation_id = $1 AND a.utilisateur_id <> $2
        AND 'ADMIN_ORGANISATION' = ANY (a.roles) AND u.statut = 'actif'`,
    [organisationId, saufUtilisateurId],
  );
  return r.rows[0]?.n ?? 0;
}

export async function modifierRoles(pool: Pool, org: OrganisationCible, utilisateurId: string, roles: RoleOrganisation[], acteur: Acteur): Promise<void> {
  if (roles.length === 0) throw new ErreurMetier("erreur.role_requis");
  await enTransaction(pool, async (client) => {
    await verrouillerAdhesions(client, org.id);
    const avant = await client.query<{ roles: RoleOrganisation[] }>(
      "SELECT roles FROM platform.adhesions WHERE utilisateur_id = $1 AND organisation_id = $2",
      [utilisateurId, org.id],
    );
    const anciens = avant.rows[0]?.roles;
    if (!anciens) throw new ErreurMetier("erreur.introuvable");
    const perdAdmin = anciens.includes("ADMIN_ORGANISATION") && !roles.includes("ADMIN_ORGANISATION");
    if (perdAdmin && (await autresAdministrateursActifs(client, org.id, utilisateurId)) === 0) throw new ErreurMetier("erreur.dernier_admin");
    await client.query("UPDATE platform.adhesions SET roles = $3 WHERE utilisateur_id = $1 AND organisation_id = $2", [utilisateurId, org.id, roles]);
    await journaliserLesDeux(client, org, {
      action: "DROITS_MODIFIES", ...traceActeur(acteur), cibleType: "utilisateur", cibleId: utilisateurId, details: { avant: anciens, apres: roles },
    });
  });
}

export async function retirerMembre(pool: Pool, org: OrganisationCible, utilisateurId: string, acteur: Acteur): Promise<void> {
  await enTransaction(pool, async (client) => {
    await verrouillerAdhesions(client, org.id);
    const avant = await client.query<{ roles: RoleOrganisation[] }>(
      "SELECT roles FROM platform.adhesions WHERE utilisateur_id = $1 AND organisation_id = $2",
      [utilisateurId, org.id],
    );
    const anciens = avant.rows[0]?.roles;
    if (!anciens) throw new ErreurMetier("erreur.introuvable");
    if (anciens.includes("ADMIN_ORGANISATION") && (await autresAdministrateursActifs(client, org.id, utilisateurId)) === 0) {
      throw new ErreurMetier("erreur.dernier_admin");
    }
    await client.query("DELETE FROM platform.adhesions WHERE utilisateur_id = $1 AND organisation_id = $2", [utilisateurId, org.id]);
    await journaliserLesDeux(client, org, { action: "MEMBRE_RETIRE", ...traceActeur(acteur), cibleType: "utilisateur", cibleId: utilisateurId, details: { roles: anciens } });
  });
}
