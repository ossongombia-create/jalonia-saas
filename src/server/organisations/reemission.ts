// Réémission de l'invitation d'administrateur d'une organisation (chantier 1 du 20/10/2026), réservée au superadmin
// (vérifié par l'action, src/actions/plateforme.ts). C'est le SEUL membre que le superadmin peut faire entrer dans une
// organisation après sa création, et seulement quand elle n'a AUCUN administrateur actif (jamais accepté, invitation
// expirée, ou administrateur désactivé). Contrôles, dans cet ordre, en une seule transaction :
//   organisation inconnue → erreur.introuvable ; suspendue → erreur.organisation_suspendue ; au moins un administrateur
//   actif → orgs.admin_present ; puis creerInvitation : adresse du superadmin → invitation.soi_meme ; déjà membre →
//   erreur.deja_membre (cas de l'administrateur seulement désactivé : réactiver son compte).
// Rôles forcés à Administrateur. Une invitation en attente pour la MÊME adresse est remplacée (creerInvitation) ; les
// autres invitations en attente ne sont pas touchées. Journal : INVITATION_CREEE (acteur = superadmin), deux journaux.
import type { Pool } from "pg";
import { enTransaction } from "../db/transactions";
import { ErreurMetier } from "../erreurs";
import type { Acteur } from "../acteur";
import { creerInvitation, type InvitationCreee } from "../invitations/service";

export interface ReemissionAdmin {
  email: string;
  nom: string;
}

export async function reemettreInvitationAdmin(pool: Pool, organisationId: string, entree: ReemissionAdmin, acteur: Acteur): Promise<InvitationCreee & { organisation: string }> {
  return enTransaction(pool, async (client) => {
    const r = await client.query<{ id: string; nom: string; statut: string; schema_name: string; role_name: string }>(
      "SELECT id, nom, statut, schema_name, role_name FROM platform.organisations WHERE id = $1 FOR UPDATE",
      [organisationId],
    );
    const o = r.rows[0];
    if (!o) throw new ErreurMetier("erreur.introuvable");
    if (o.statut !== "active") throw new ErreurMetier("erreur.organisation_suspendue");
    // Même définition qu'autresAdministrateursActifs (src/server/membres/service.ts) : rôle Administrateur ET compte actif
    // (copie volontaire : la couche service des membres n'est pas modifiée, Q7 ; à fusionner avec le chantier défense
    // en profondeur).
    const admins = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n
         FROM platform.adhesions a JOIN platform.utilisateurs u ON u.id = a.utilisateur_id
        WHERE a.organisation_id = $1 AND 'ADMIN_ORGANISATION' = ANY (a.roles) AND u.statut = 'actif'`,
      [o.id],
    );
    if ((admins.rows[0]?.n ?? 0) > 0) throw new ErreurMetier("orgs.admin_present");
    const invitation = await creerInvitation(
      client,
      { id: o.id, schemaName: o.schema_name, roleName: o.role_name },
      { email: entree.email, nom: entree.nom, roles: ["ADMIN_ORGANISATION"] },
      acteur,
    );
    return { ...invitation, organisation: o.nom };
  });
}
