// Schémas de validation des formulaires (zod). Utilisés côté serveur : on ne fait JAMAIS confiance à ce
// qu'envoie le navigateur. Les messages sont des clés de traduction.
import { z } from "zod";
import { ROLES_ORGANISATION } from "./rbac";

export const MOTIF_SLUG = /^[a-z0-9]([a-z0-9-]{0,48}[a-z0-9])?$/;

export const email = z.string().trim().toLowerCase().max(254, "erreur.email_invalide").pipe(z.email("erreur.email_invalide"));
export const nomPersonne = z.string().trim().min(1, "erreur.nom_requis").max(200, "erreur.nom_trop_long");
export const motDePasseSaisi = z.string().min(1, "erreur.mdp_requis").max(200, "erreur.mdp_trop_long");
export const identifiant = z.uuid("erreur.introuvable");

export const roles = z
  .array(z.enum(ROLES_ORGANISATION, "erreur.role_invalide"))
  .min(1, "erreur.role_requis")
  .transform((liste) => [...new Set(liste)]);

export const schemaConnexion = z.object({ email, motDePasse: motDePasseSaisi });

export const schemaNouvelleOrganisation = z.object({
  nom: z.string().trim().min(2, "erreur.nom_org_court").max(200, "erreur.nom_trop_long"),
  slug: z.string().trim().toLowerCase().regex(MOTIF_SLUG, "erreur.slug_invalide"),
  adminEmail: email,
  adminNom: nomPersonne,
});

export const schemaInvitation = z.object({ email, nom: nomPersonne, roles });

/** Lien d'invitation : 32 octets aléatoires en base64url. */
export const jetonInvitation = z.string().regex(/^[A-Za-z0-9_-]{43}$/, "invitation.invalide");

export const schemaCompteInvitation = z
  .object({
    jeton: jetonInvitation,
    nom: nomPersonne,
    nouveau: z.string().max(200, "erreur.mdp_trop_long"),
    confirmation: z.string(),
  })
  .refine((d) => d.nouveau === d.confirmation, { message: "erreur.mdp_confirmation", path: ["confirmation"] });

export const schemaChangementMotDePasse = z
  .object({
    actuel: motDePasseSaisi,
    nouveau: z.string().max(200, "erreur.mdp_trop_long"),
    confirmation: z.string(),
  })
  .refine((d) => d.nouveau === d.confirmation, { message: "erreur.mdp_confirmation", path: ["confirmation"] });

/** Première clé d'erreur d'un résultat de validation raté. */
export function premiereErreur(erreur: z.ZodError): string {
  return erreur.issues[0]?.message ?? "erreur.saisie_invalide";
}
