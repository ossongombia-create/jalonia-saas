"use server";
// Second facteur : code demandé après le mot de passe, enrôlement (obligatoire pour un superadmin à sa première
// connexion), activation / désactivation / nouveaux codes de secours depuis « Mon compte ».
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signOut } from "@/auth";
import { suiteValide } from "@/lib/suite";
import type { EtatAction } from "@/lib/etat-action";
import { traduireMessage } from "@/lib/i18n";
import { poolApplication } from "@/server/db/pools";
import { cleSecondFacteur } from "@/server/config";
import { abandonnerSessionEnAttente } from "@/server/auth/sessions";
import {
  activerSecondFacteur,
  desactiverSecondFacteur,
  regenererCodesSecours,
  validerSessionParCode,
} from "@/server/auth/second-facteur";
import type { Acteur } from "@/server/acteur";
import { ErreurMetier } from "@/server/erreurs";
import { exigerContexte, lireConnexionEnAttente } from "@/server/web/contexte";
import { agentDepuisEntetes, ipDepuisEntetes } from "@/server/web/reseau";
import { champ, executer } from "@/server/web/actions";

async function reseau(): Promise<{ ip: string | null; agent: string | null }> {
  const entetes = await headers();
  return { ip: ipDepuisEntetes(entetes), agent: agentDepuisEntetes(entetes) };
}

const MESSAGES_ECHEC = {
  code: "mfa.code_faux",
  session_fermee: "mfa.session_fermee",
  verrouille: "mfa.verrouille",
  indisponible: "mfa.indisponible",
} as const;

/** Code (application ou secours) après le mot de passe : la connexion est terminée, ou l'échec est expliqué. */
export async function actionCodeSecondFacteur(_etat: EtatAction, formulaire: FormData): Promise<EtatAction> {
  const attente = await lireConnexionEnAttente();
  if (!attente) redirect("/connexion");
  const r = await validerSessionParCode(
    poolApplication(),
    cleSecondFacteur(),
    { sessionId: attente.sessionId, utilisateurId: attente.utilisateur.id },
    champ(formulaire, "code").slice(0, 50),
    await reseau(),
  );
  if (!r.ok) return { ok: false, message: traduireMessage(attente.utilisateur.langue, MESSAGES_ECHEC[r.raison]), jeton: Date.now() };
  redirect(suiteValide(champ(formulaire, "suite")) || "/");
}

/** Superadmin sans second facteur, à sa connexion : enrôlement, puis la session devient valable. */
export async function actionActiverSecondFacteurConnexion(_etat: EtatAction, formulaire: FormData): Promise<EtatAction> {
  const attente = await lireConnexionEnAttente();
  if (!attente) redirect("/connexion");
  const personne: Acteur = { id: attente.utilisateur.id, email: attente.utilisateur.email, nom: attente.utilisateur.nom, ...(await reseau()) };
  return executer(
    attente.utilisateur.langue,
    async () => {
      if (attente.mfaActif) throw new ErreurMetier("mfa.deja_actif");
      const codes = await activerSecondFacteur(poolApplication(), cleSecondFacteur(), personne, champ(formulaire, "code"), attente.sessionId);
      return { cle: "mfa.active", codes };
    },
    { rafraichir: false },
  );
}

/** « Annuler » sur la page du code : la connexion commencée est abandonnée. */
export async function actionAbandonnerConnexion(): Promise<void> {
  const attente = await lireConnexionEnAttente();
  if (attente) await abandonnerSessionEnAttente(poolApplication(), { sessionId: attente.sessionId, utilisateurId: attente.utilisateur.id });
  await signOut({ redirect: false });
  redirect("/connexion");
}

// ---------- Depuis « Mon compte » (session complète) ----------

export async function actionActiverSecondFacteur(_etat: EtatAction, formulaire: FormData): Promise<EtatAction> {
  const ctx = await exigerContexte();
  return executer(
    ctx.langue,
    async () => ({ cle: "mfa.active", codes: await activerSecondFacteur(poolApplication(), cleSecondFacteur(), ctx.acteur, champ(formulaire, "code")) }),
    { rafraichir: false },
  );
}

export async function actionDesactiverSecondFacteur(_etat: EtatAction, formulaire: FormData): Promise<EtatAction> {
  const ctx = await exigerContexte();
  return executer(ctx.langue, async () => {
    await desactiverSecondFacteur(poolApplication(), cleSecondFacteur(), { ...ctx.acteur, estSuperadmin: ctx.utilisateur.estSuperadmin }, champ(formulaire, "code").slice(0, 50));
    return { cle: "mfa.desactive" };
  });
}

export async function actionRegenererCodesSecours(_etat: EtatAction, formulaire: FormData): Promise<EtatAction> {
  const ctx = await exigerContexte();
  return executer(
    ctx.langue,
    async () => ({ cle: "mfa.codes_regeneres", codes: await regenererCodesSecours(poolApplication(), cleSecondFacteur(), ctx.acteur, champ(formulaire, "code").slice(0, 50)) }),
    { rafraichir: false },
  );
}
