"use server";
// Gestion des membres d'une organisation (invitations, rôles, retrait). Deux personnes peuvent le faire :
//   - le superadmin, pour n'importe quelle organisation ;
//   - l'administrateur d'une organisation, pour l'organisation ACTUELLEMENT OUVERTE uniquement
//     (l'identifiant envoyé par le formulaire doit être celui de son organisation, sinon refus).
import { z } from "zod";
import { aLeDroit } from "@/lib/rbac";
import { identifiant, schemaInvitation, roles as schemaRoles } from "@/lib/validation";
import type { EtatAction } from "@/lib/etat-action";
import { poolApplication } from "@/server/db/pools";
import { lireOrganisation } from "@/server/organisations/service";
import { modifierRoles, retirerMembre, type OrganisationCible } from "@/server/membres/service";
import { annulerInvitation, cheminInvitation, DUREE_INVITATION_HEURES, inviter } from "@/server/invitations/service";
import { ErreurMetier } from "@/server/erreurs";
import { exigerContexte, type Contexte } from "@/server/web/contexte";
import { champ, executer, valider } from "@/server/web/actions";

async function autoriser(ctx: Contexte, formulaire: FormData): Promise<OrganisationCible> {
  const organisationId = valider(identifiant, champ(formulaire, "organisationId"));
  if (ctx.utilisateur.estSuperadmin) {
    const org = await lireOrganisation(poolApplication(), organisationId);
    if (!org) throw new ErreurMetier("erreur.introuvable");
    return { id: org.id, schemaName: org.schemaName, roleName: org.roleName };
  }
  const ouverte = ctx.organisation;
  if (!ouverte || ouverte.id !== organisationId || !aLeDroit(ouverte.roles, "organisation.membres.gerer")) {
    throw new ErreurMetier("erreur.interdit");
  }
  return { id: ouverte.id, schemaName: ouverte.schemaName, roleName: ouverte.roleName };
}

function rolesCoches(formulaire: FormData): unknown[] {
  return formulaire.getAll("roles").filter((v) => typeof v === "string");
}

/** Invite une adresse. La réponse est la MÊME que l'adresse ait déjà un compte Jalonia ou non (audit S10). */
export async function actionInviterMembre(_etat: EtatAction, formulaire: FormData): Promise<EtatAction> {
  const ctx = await exigerContexte();
  return executer(ctx.langue, async () => {
    const org = await autoriser(ctx, formulaire);
    const saisie = valider(schemaInvitation, { email: champ(formulaire, "email"), nom: champ(formulaire, "nom"), roles: rolesCoches(formulaire) });
    const invitation = await inviter(poolApplication(), org, saisie, ctx.acteur);
    return { cle: "invitation.creee", variables: { heures: DUREE_INVITATION_HEURES }, lien: cheminInvitation(invitation.jeton) };
  });
}

export async function actionAnnulerInvitation(_etat: EtatAction, formulaire: FormData): Promise<EtatAction> {
  const ctx = await exigerContexte();
  return executer(ctx.langue, async () => {
    const org = await autoriser(ctx, formulaire);
    const invitationId = valider(identifiant, champ(formulaire, "invitationId"));
    await annulerInvitation(poolApplication(), org, invitationId, ctx.acteur);
    return { cle: "invitation.annulee" };
  });
}

const schemaMembre = z.object({ utilisateurId: identifiant });

export async function actionModifierRoles(_etat: EtatAction, formulaire: FormData): Promise<EtatAction> {
  const ctx = await exigerContexte();
  return executer(ctx.langue, async () => {
    const org = await autoriser(ctx, formulaire);
    const { utilisateurId } = valider(schemaMembre, { utilisateurId: champ(formulaire, "utilisateurId") });
    const roles = valider(schemaRoles, rolesCoches(formulaire));
    await modifierRoles(poolApplication(), org, utilisateurId, roles, ctx.acteur);
    return { cle: "membres.roles_modifies" };
  });
}

export async function actionRetirerMembre(_etat: EtatAction, formulaire: FormData): Promise<EtatAction> {
  const ctx = await exigerContexte();
  return executer(ctx.langue, async () => {
    const org = await autoriser(ctx, formulaire);
    const { utilisateurId } = valider(schemaMembre, { utilisateurId: champ(formulaire, "utilisateurId") });
    await retirerMembre(poolApplication(), org, utilisateurId, ctx.acteur);
    return { cle: "membres.retire" };
  });
}
