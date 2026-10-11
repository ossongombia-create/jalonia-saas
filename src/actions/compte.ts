"use server";
// Actions liées au compte de la personne connectée : connexion, déconnexion, mot de passe, langue,
// choix de l'organisation.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { signIn, signOut } from "@/auth";
import { cheminInterne } from "@/lib/chemins";
import { estLangue, traduireMessage } from "@/lib/i18n";
import { identifiant, schemaChangementMotDePasse, schemaConnexion } from "@/lib/validation";
import type { EtatAction } from "@/lib/etat-action";
import { poolApplication } from "@/server/db/pools";
import { terminerSession, noterOrganisationDeSession } from "@/server/auth/sessions";
import { changerLangue, changerMotDePasse } from "@/server/utilisateurs/service";
import { COOKIE_LANGUE, COOKIE_ORGANISATION, accueilDe, exigerContexte, lireContexte, lireLangue } from "@/server/web/contexte";
import { champ, executer, valider } from "@/server/web/actions";

const EN_PRODUCTION = process.env.NODE_ENV === "production";
const COOKIE_UN_AN = { httpOnly: true, secure: EN_PRODUCTION, sameSite: "lax" as const, path: "/", maxAge: 365 * 24 * 3600 };

export async function actionConnexion(_etat: EtatAction, formulaire: FormData): Promise<EtatAction> {
  const langue = await lireLangue();
  const lu = schemaConnexion.safeParse({ email: champ(formulaire, "email"), motDePasse: champ(formulaire, "motDePasse") });
  if (!lu.success) return { ok: false, message: traduireMessage(langue, "connexion.echec"), jeton: Date.now() };
  try {
    await signIn("credentials", { email: lu.data.email, motDePasse: lu.data.motDePasse, redirect: false });
  } catch (erreur) {
    if (erreur instanceof AuthError) return { ok: false, message: traduireMessage(langue, "connexion.echec"), jeton: Date.now() };
    throw erreur;
  }
  redirect("/"); // la page d'accueil oriente selon le profil (changement de mot de passe, plateforme, organisation)
}

export async function actionDeconnexion(): Promise<void> {
  const ctx = await lireContexte();
  if (ctx) await terminerSession(poolApplication(), ctx.sessionId, ctx.acteur);
  (await cookies()).delete(COOKIE_ORGANISATION);
  await signOut({ redirect: false });
  redirect("/connexion");
}

export async function actionChangerMotDePasse(_etat: EtatAction, formulaire: FormData): Promise<EtatAction> {
  const ctx = await exigerContexte({ permettreMdpProvisoire: true });
  return executer(ctx.langue, async () => {
    const saisie = valider(schemaChangementMotDePasse, {
      actuel: champ(formulaire, "actuel"),
      nouveau: champ(formulaire, "nouveau"),
      confirmation: champ(formulaire, "confirmation"),
    });
    await changerMotDePasse(poolApplication(), ctx.acteur, ctx.sessionId, saisie);
    return { cle: "mdp.succes" };
  });
}

/** Change la langue : cookie (pages publiques) et, si la personne est connectée, son compte. */
export async function actionChangerLangue(formulaire: FormData): Promise<void> {
  const langue = champ(formulaire, "langue");
  if (!estLangue(langue)) return;
  (await cookies()).set(COOKIE_LANGUE, langue, COOKIE_UN_AN);
  const ctx = await lireContexte();
  if (ctx) await changerLangue(poolApplication(), ctx.utilisateur.id, langue);
  redirect(cheminInterne(champ(formulaire, "retour")));
}

export async function actionChoisirOrganisation(formulaire: FormData): Promise<void> {
  const ctx = await exigerContexte();
  const lu = identifiant.safeParse(champ(formulaire, "organisationId"));
  const choisie = lu.success ? ctx.adhesions.find((a) => a.id === lu.data && a.statut === "active") : undefined;
  if (!choisie) redirect("/choisir-organisation");
  (await cookies()).set(COOKIE_ORGANISATION, choisie.id, { ...COOKIE_UN_AN, maxAge: 30 * 24 * 3600 });
  await noterOrganisationDeSession(poolApplication(), ctx.sessionId, choisie.id);
  redirect("/app");
}

/** Après un changement de mot de passe obligatoire : aller à l'accueil. */
export async function actionContinuer(): Promise<void> {
  const ctx = await exigerContexte({ permettreMdpProvisoire: true });
  redirect(accueilDe(ctx));
}
