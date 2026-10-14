"use server";
// Réponse à une invitation (page /invitation/<jeton>, publique) :
//   - sans compte : la personne crée le sien (SON mot de passe), est connectée et arrive dans l'organisation ;
//   - avec un compte : connectée avec l'adresse invitée, elle accepte.
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { signIn } from "@/auth";
import { jetonInvitation, schemaCompteInvitation } from "@/lib/validation";
import type { EtatAction } from "@/lib/etat-action";
import { poolApplication } from "@/server/db/pools";
import { accepterAvecCompte, accepterAvecNouveauCompte } from "@/server/invitations/service";
import { ErreurMetier } from "@/server/erreurs";
import { estMaintenanceActive, exigerContexte, lireContexte, lireLangue } from "@/server/web/contexte";
import { poserCookieOrganisation } from "@/server/web/cookies";
import { agentDepuisEntetes, ipDepuisEntetes } from "@/server/web/reseau";
import { champ, executer, valider } from "@/server/web/actions";

export async function actionCreerCompteInvitation(_etat: EtatAction, formulaire: FormData): Promise<EtatAction> {
  const langue = await lireLangue();
  const suite: { arrivee?: { organisationId: string; email: string; motDePasse: string } } = {};
  const etat = await executer(langue, async () => {
    // Quelqu'un est déjà connecté dans ce navigateur : il doit d'abord se déconnecter.
    if (await lireContexte()) throw new ErreurMetier("invitation.deja_connecte");
    if (await estMaintenanceActive()) throw new ErreurMetier("maintenance.bloquee");
    const saisie = valider(schemaCompteInvitation, {
      jeton: champ(formulaire, "jeton"),
      nom: champ(formulaire, "nom"),
      nouveau: champ(formulaire, "nouveau"),
      confirmation: champ(formulaire, "confirmation"),
    });
    const entetes = await headers();
    const r = await accepterAvecNouveauCompte(
      poolApplication(),
      saisie.jeton,
      { nom: saisie.nom, motDePasse: saisie.nouveau, langue },
      { ip: ipDepuisEntetes(entetes), agent: agentDepuisEntetes(entetes) },
    );
    suite.arrivee = { ...r, motDePasse: saisie.nouveau };
    return { cle: "invitation.compte_cree" };
  });
  if (!suite.arrivee) return etat;
  // Compte créé : connexion immédiate, puis l'organisation qui a invité.
  const { organisationId, email, motDePasse } = suite.arrivee;
  try {
    await signIn("credentials", { email, motDePasse, redirect: false });
  } catch (erreur) {
    if (erreur instanceof AuthError) redirect("/connexion"); // (limite de tentatives, serveur occupé…) : se connecter soi-même
    throw erreur;
  }
  await poserCookieOrganisation(organisationId);
  redirect("/app");
}

export async function actionAccepterInvitation(_etat: EtatAction, formulaire: FormData): Promise<EtatAction> {
  const ctx = await exigerContexte();
  const suite: { organisationId?: string } = {};
  const etat = await executer(ctx.langue, async () => {
    const jeton = valider(jetonInvitation, champ(formulaire, "jeton"));
    suite.organisationId = (await accepterAvecCompte(poolApplication(), jeton, ctx.acteur)).organisationId;
    return { cle: "invitation.acceptee" };
  });
  if (!suite.organisationId) return etat;
  await poserCookieOrganisation(suite.organisationId);
  redirect("/app");
}
