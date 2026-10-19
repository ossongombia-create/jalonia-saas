"use server";
// Actions de l'espace superadministrateur. CHAQUE action revérifie le rôle (exigerSuperadmin) :
// une action serveur est appelable directement, sans passer par la page qui l'affiche.
import { z } from "zod";
import { identifiant, schemaNouvelleOrganisation } from "@/lib/validation";
import type { EtatAction } from "@/lib/etat-action";
import { poolApplication } from "@/server/db/pools";
import { creerOrganisation } from "@/server/organisations/provisionnement";
import { cheminInvitation, DUREE_INVITATION_HEURES } from "@/server/invitations/service";
import { changerModeValidation, changerStatutOrganisation } from "@/server/organisations/service";
import { MODES_VALIDATION } from "@/server/documents/circuit";
import {
  annulerReinitialisation,
  cheminReinitialisation,
  creerReinitialisation,
  desactiverUtilisateur,
  DUREE_REINITIALISATION_MINUTES,
  reactiverUtilisateur,
  revoquerSessionsUtilisateur,
} from "@/server/utilisateurs/service";
import { DUREES_ACCES_URGENCE, fermerAccesUrgence, ouvrirAccesUrgence, ROLES_ACCES_URGENCE } from "@/server/acces-urgence/service";
import { ErreurMetier } from "@/server/erreurs";
import { revoquerSession } from "@/server/consultation/service";
import { reinitialiserSecondFacteur } from "@/server/auth/second-facteur";
import { exigerSuperadmin } from "@/server/web/contexte";
import { champ, executer, valider } from "@/server/web/actions";
import { courrielConfigure, envoyerCourriel, envoyerInvitationCourriel } from "@/server/notifications/courriel";

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
    try {
      await envoyerInvitationCourriel({ a: saisie.adminEmail, nom: saisie.adminNom, organisation: saisie.nom, lien: cheminInvitation(creee.invitation.jeton), heures: DUREE_INVITATION_HEURES });
    } catch {
      console.error(JSON.stringify({ evenement: "courriel_invitation_echec", organisationId: creee.organisationId }));
    }
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

const schemaMode = z.object({ organisationId: identifiant, mode: z.enum(MODES_VALIDATION, "erreur.saisie_invalide") });

/** Mode de validation d'une organisation (décision n° 2 du 19/10/2026) : réservé à l'exploitant, tracé. */
export async function actionChangerModeValidation(_etat: EtatAction, formulaire: FormData): Promise<EtatAction> {
  const ctx = await exigerSuperadmin();
  return executer(ctx.langue, async () => {
    const s = valider(schemaMode, { organisationId: champ(formulaire, "organisationId"), mode: champ(formulaire, "mode") });
    await changerModeValidation(poolApplication(), s.organisationId, s.mode, ctx.acteur);
    return { cle: `orgs.mode_${s.mode}_fait` };
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

/**
 * Réinitialisation d'un mot de passe (décision n° 1 du 19/10/2026) : un lien à usage unique, valable 1 heure, est
 * ENVOYÉ PAR COURRIEL à la personne, qui choisit elle-même son nouveau mot de passe. Le lien n'est jamais montré au
 * superadmin ; sans SMTP configuré, la demande est refusée. Si l'envoi échoue, le lien est annulé.
 */
export async function actionReinitialiserMotDePasse(_etat: EtatAction, formulaire: FormData): Promise<EtatAction> {
  const ctx = await exigerSuperadmin();
  return executer(ctx.langue, async () => {
    const utilisateurId = cible(formulaire);
    if (!courrielConfigure()) throw new ErreurMetier("users.reinit_smtp_requis");
    const origine = process.env.AUTH_URL;
    if (!origine) throw new ErreurMetier("users.reinit_smtp_requis");
    const lien = await creerReinitialisation(poolApplication(), utilisateurId, ctx.acteur);
    const url = new URL(cheminReinitialisation(lien.jeton), origine).toString();
    const en = lien.langue === "en";
    try {
      const envoye = await envoyerCourriel({
        a: lien.email,
        sujet: en ? "Jalonia — Reset your password" : "Jalonia — Réinitialiser votre mot de passe",
        texte: en
          ? `Hello ${lien.nom},\n\nThe Jalonia operator has started a reset of your password.\n\nChoose a new password: ${url}\n\nThis link is personal, single-use and expires in ${DUREE_REINITIALISATION_MINUTES} minutes. If you did not expect this message, ignore it: your current password stays valid.`
          : `Bonjour ${lien.nom},\n\nL’exploitant de Jalonia a lancé la réinitialisation de votre mot de passe.\n\nChoisir un nouveau mot de passe : ${url}\n\nCe lien est personnel, à usage unique et expire dans ${DUREE_REINITIALISATION_MINUTES} minutes. Si vous ne vous attendiez pas à ce message, ignorez-le : votre mot de passe actuel reste valable.`,
      });
      if (!envoye) throw new Error("SMTP non configuré");
    } catch {
      await annulerReinitialisation(poolApplication(), lien.id);
      console.error(JSON.stringify({ evenement: "courriel_reinitialisation_echec", utilisateurId }));
      throw new ErreurMetier("users.reinit_courriel_echec");
    }
    return { cle: "users.reinit_envoye", variables: { email: lien.email, minutes: DUREE_REINITIALISATION_MINUTES } };
  });
}

const schemaAccesUrgence = z.object({
  organisationId: identifiant,
  role: z.enum(ROLES_ACCES_URGENCE, "erreur.role_invalide"),
  dureeHeures: z.coerce.number().refine((n) => (DUREES_ACCES_URGENCE as readonly number[]).includes(n), "acces.duree_invalide"),
  motif: z.string().trim().min(10, "acces.motif_requis").max(2000, "acces.motif_requis"),
});

/** Ouvre un accès d'urgence à une organisation (décision n° 1 du 19/10/2026) : motif, rôle, durée ; notifié. */
export async function actionOuvrirAccesUrgence(_etat: EtatAction, formulaire: FormData): Promise<EtatAction> {
  const ctx = await exigerSuperadmin();
  return executer(ctx.langue, async () => {
    const s = valider(schemaAccesUrgence, {
      organisationId: champ(formulaire, "organisationId"),
      role: champ(formulaire, "role"),
      dureeHeures: champ(formulaire, "dureeHeures"),
      motif: champ(formulaire, "motif"),
    });
    const ouvert = await ouvrirAccesUrgence(poolApplication(), s.organisationId, { role: s.role, dureeHeures: s.dureeHeures as (typeof DUREES_ACCES_URGENCE)[number], motif: s.motif }, ctx.acteur);
    return { cle: "acces.ouvert", variables: { heures: s.dureeHeures, n: ouvert.notifies } };
  });
}

export async function actionFermerAccesUrgence(_etat: EtatAction, formulaire: FormData): Promise<EtatAction> {
  const ctx = await exigerSuperadmin();
  return executer(ctx.langue, async () => {
    const accesId = valider(identifiant, champ(formulaire, "accesId"));
    await fermerAccesUrgence(poolApplication(), accesId, ctx.acteur);
    return { cle: "acces.ferme" };
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
