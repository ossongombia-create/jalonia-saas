"use server";
// Actions de l'espace superadministrateur. CHAQUE action revérifie le rôle (exigerSuperadmin) :
// une action serveur est appelable directement, sans passer par la page qui l'affiche.
import { z } from "zod";
import { identifiant, schemaNouvelleOrganisation } from "@/lib/validation";
import type { EtatAction } from "@/lib/etat-action";
import { poolApplication } from "@/server/db/pools";
import { creerOrganisation } from "@/server/organisations/provisionnement";
import { cheminInvitation, DUREE_INVITATION_HEURES } from "@/server/invitations/service";
import { changerStatutOrganisation } from "@/server/organisations/service";
import {
  desactiverUtilisateur,
  reactiverUtilisateur,
  reinitialiserMotDePasse,
  revoquerSessionsUtilisateur,
} from "@/server/utilisateurs/service";
import { revoquerSession } from "@/server/consultation/service";
import { reinitialiserSecondFacteur } from "@/server/auth/second-facteur";
import { exigerSuperadmin } from "@/server/web/contexte";
import { champ, executer, valider } from "@/server/web/actions";

/**
 * Crée une organisation et invite son premier administrateur. Le lien d'invitation est affiché UNE fois (seule son
 * empreinte est rangée) : la page reste ouverte pour le copier. Pour un nouveau lien : inviter à nouveau depuis la
 * page de l'organisation.
 */
export async function actionCreerOrganisation(_etat: EtatAction, formulaire: FormData): Promise<EtatAction> {
  const ctx = await exigerSuperadmin();
  return executer(ctx.langue, async () => {
    const saisie = valider(schemaNouvelleOrganisation, {
      nom: champ(formulaire, "nom"),
      slug: champ(formulaire, "slug"),
      adminEmail: champ(formulaire, "adminEmail"),
      adminNom: champ(formulaire, "adminNom"),
    });
    const creee = await creerOrganisation(poolApplication(), { nom: saisie.nom, slug: saisie.slug, admin: { email: saisie.adminEmail, nom: saisie.adminNom } }, ctx.acteur);
    return { cle: "orgs.creee_invitation", variables: { heures: DUREE_INVITATION_HEURES }, lien: cheminInvitation(creee.invitation.jeton) };
  });
}

const schemaStatut = z.object({ organisationId: identifiant, statut: z.enum(["active", "suspendue"], "erreur.saisie_invalide") });

export async function actionChangerStatutOrganisation(_etat: EtatAction, formulaire: FormData): Promise<EtatAction> {
  const ctx = await exigerSuperadmin();
  return executer(ctx.langue, async () => {
    const s = valider(schemaStatut, { organisationId: champ(formulaire, "organisationId"), statut: champ(formulaire, "statut") });
    await changerStatutOrganisation(poolApplication(), s.organisationId, s.statut, ctx.acteur);
    return { cle: "commun.succes" };
  });
}

const schemaCible = z.object({ utilisateurId: identifiant });

function cible(formulaire: FormData): string {
  return valider(schemaCible, { utilisateurId: champ(formulaire, "utilisateurId") }).utilisateurId;
}

export async function actionDesactiverUtilisateur(_etat: EtatAction, formulaire: FormData): Promise<EtatAction> {
  const ctx = await exigerSuperadmin();
  return executer(ctx.langue, async () => {
    await desactiverUtilisateur(poolApplication(), cible(formulaire), ctx.acteur);
    return { cle: "users.desactive" };
  });
}

export async function actionReactiverUtilisateur(_etat: EtatAction, formulaire: FormData): Promise<EtatAction> {
  const ctx = await exigerSuperadmin();
  return executer(ctx.langue, async () => {
    await reactiverUtilisateur(poolApplication(), cible(formulaire), ctx.acteur);
    return { cle: "users.reactive" };
  });
}

export async function actionRevoquerSessionsUtilisateur(_etat: EtatAction, formulaire: FormData): Promise<EtatAction> {
  const ctx = await exigerSuperadmin();
  return executer(ctx.langue, async () => {
    const n = await revoquerSessionsUtilisateur(poolApplication(), cible(formulaire), ctx.acteur);
    return { cle: "users.sessions_fermees", variables: { n } };
  });
}

export async function actionReinitialiserMotDePasse(_etat: EtatAction, formulaire: FormData): Promise<EtatAction> {
  const ctx = await exigerSuperadmin();
  return executer(ctx.langue, async () => {
    const mdp = valider(z.string().max(200, "erreur.mdp_trop_long"), champ(formulaire, "motDePasse"));
    await reinitialiserMotDePasse(poolApplication(), cible(formulaire), mdp, ctx.acteur);
    return { cle: "users.reinitialise" };
  });
}

/** Retire le second facteur d'un compte (téléphone perdu) : jamais celui d'un superadmin (ligne de commande). */
export async function actionReinitialiserSecondFacteur(_etat: EtatAction, formulaire: FormData): Promise<EtatAction> {
  const ctx = await exigerSuperadmin();
  return executer(ctx.langue, async () => {
    await reinitialiserSecondFacteur(poolApplication(), cible(formulaire), ctx.acteur);
    return { cle: "mfa.reinitialise" };
  });
}

export async function actionRevoquerSession(_etat: EtatAction, formulaire: FormData): Promise<EtatAction> {
  const ctx = await exigerSuperadmin();
  return executer(ctx.langue, async () => {
    const sessionId = valider(identifiant, champ(formulaire, "sessionId"));
    await revoquerSession(poolApplication(), sessionId, ctx.acteur);
    return { cle: "sessions.revoquee" };
  });
}
