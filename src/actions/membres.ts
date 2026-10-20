"use server";
// Gestion des membres d'une organisation (invitations, rôles, retrait) : réservée à l'administrateur de
// l'organisation, pour l'organisation ACTUELLEMENT OUVERTE uniquement (l'identifiant envoyé par le formulaire doit
// être celui de son organisation, sinon refus). Le superadmin n'y a AUCUN droit (chantier 1 du 20/10/2026), même
// en accès d'urgence (rôles Rédacteur ou Lecteur seulement) : il crée l'organisation et son administrateur initial,
// et peut seulement réémettre l'invitation d'administrateur quand l'organisation n'en a plus aucun d'actif
// (actionReemettreInvitationAdmin, src/actions/plateforme.ts).
import { z } from "zod";
import { aLeDroit } from "@/lib/rbac";
import { identifiant, schemaInvitation, roles as schemaRoles } from "@/lib/validation";
import type { EtatAction } from "@/lib/etat-action";
import { poolApplication } from "@/server/db/pools";
import { modifierRoles, retirerMembre, type OrganisationCible } from "@/server/membres/service";
import { annulerInvitation, cheminInvitation, DUREE_INVITATION_HEURES, inviter } from "@/server/invitations/service";
import { ErreurMetier } from "@/server/erreurs";
import { exigerContexte, type Contexte } from "@/server/web/contexte";
import { champ, executer, valider } from "@/server/web/actions";
import { envoyerInvitationCourriel } from "@/server/notifications/courriel";

async function autoriser(ctx: Contexte, formulaire: FormData): Promise<OrganisationCible & { nom: string }> {
  const organisationId = valider(identifiant, champ(formulaire, "organisationId"));
  const ouverte = ctx.organisation;
  if (!ouverte || ouverte.id !== organisationId || !aLeDroit(ouverte.roles, "organisation.membres.gerer")) {
    throw new ErreurMetier("erreur.interdit");
  }
  return { id: ouverte.id, nom: ouverte.nom, schemaName: ouverte.schemaName, roleName: ouverte.roleName };
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
    try {
      await envoyerInvitationCourriel({ a: saisie.email, nom: saisie.nom, organisation: org.nom, lien: cheminInvitation(invitation.jeton), heures: DUREE_INVITATION_HEURES });
    } catch {
      console.error(JSON.stringify({ evenement: "courriel_invitation_echec", organisationId: org.id }));
    }
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
