"use server";
// Actions de l'espace superadministrateur. CHAQUE action revérifie le rôle (exigerSuperadmin) :
// une action serveur est appelable directement, sans passer par la page qui l'affiche.
import path from "node:path";
import { redirect } from "next/navigation";
import { z } from "zod";
import { identifiant, schemaNouvelleOrganisation } from "@/lib/validation";
import type { EtatAction } from "@/lib/etat-action";
import { poolApplication, poolProprietaire } from "@/server/db/pools";
import { lireMigrations } from "@/server/migrations/lanceur";
import { creerOrganisation } from "@/server/organisations/provisionnement";
import { changerStatutOrganisation } from "@/server/organisations/service";
import {
  desactiverUtilisateur,
  reactiverUtilisateur,
  reinitialiserMotDePasse,
  revoquerSessionsUtilisateur,
} from "@/server/utilisateurs/service";
import { revoquerSession } from "@/server/consultation/service";
import { exigerSuperadmin } from "@/server/web/contexte";
import { champ, executer, valider } from "@/server/web/actions";

export async function actionCreerOrganisation(_etat: EtatAction, formulaire: FormData): Promise<EtatAction> {
  const ctx = await exigerSuperadmin();
  const creation: { organisationId?: string } = {};
  const etat = await executer(ctx.langue, async () => {
    const saisie = valider(schemaNouvelleOrganisation, {
      nom: champ(formulaire, "nom"),
      slug: champ(formulaire, "slug"),
      adminEmail: champ(formulaire, "adminEmail"),
      adminNom: champ(formulaire, "adminNom"),
      adminMotDePasse: champ(formulaire, "adminMotDePasse"),
    });
    const migrations = await lireMigrations(path.join(process.cwd(), "db/migrations/organisation"));
    if (migrations.length === 0) throw new Error("Migrations d'organisation introuvables (dossier db/migrations/organisation).");
    const creee = await creerOrganisation(
      poolProprietaire(),
      migrations,
      { nom: saisie.nom, slug: saisie.slug, admin: { email: saisie.adminEmail, nom: saisie.adminNom, motDePasseProvisoire: saisie.adminMotDePasse } },
      ctx.acteur,
    );
    creation.organisationId = creee.organisationId;
    return { cle: "orgs.creee" };
  });
  if (etat.ok && creation.organisationId) redirect(`/plateforme/organisations/${creation.organisationId}`);
  return etat;
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

export async function actionRevoquerSession(_etat: EtatAction, formulaire: FormData): Promise<EtatAction> {
  const ctx = await exigerSuperadmin();
  return executer(ctx.langue, async () => {
    const sessionId = valider(identifiant, champ(formulaire, "sessionId"));
    await revoquerSession(poolApplication(), sessionId, ctx.acteur);
    return { cle: "sessions.revoquee" };
  });
}
