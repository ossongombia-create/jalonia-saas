// Contexte et erreurs des routes JSON de l'éditeur. Mêmes règles que les pages (contexte.ts) — session vérifiée
// en base, organisation ouverte, droit exigé — mais les refus sont des réponses JSON (401, 403, 409) et non des
// redirections : c'est l'éditeur qui les affiche.
import "server-only";
import { traduireMessage, type Langue } from "@/lib/i18n";
import { aLeDroit, type Droit } from "@/lib/rbac";
import { ConflitVersion } from "../documents/service";
import { ErreurMetier } from "../erreurs";
import { lireContexte, type ContexteOrganisation } from "./contexte";
import { reponseJson } from "./requetes-json";

export type ContexteApi = { ok: true; ctx: ContexteOrganisation } | { ok: false; reponse: Response };

/**
 * 401 « session » : pas (ou plus) connecté · 403 « mot_de_passe » : mot de passe provisoire à changer ·
 * 403 « organisation » : aucune organisation ouverte · 403 « interdit » : le rôle ne donne pas ce droit.
 */
export async function contexteApi(droit: Droit): Promise<ContexteApi> {
  const ctx = await lireContexte();
  if (!ctx) return { ok: false, reponse: reponseJson({ erreur: "session" }, 401) };
  // « langue » : l'éditeur affiche son explication dans la langue de la personne.
  const langue = ctx.langue;
  if (ctx.utilisateur.doitChangerMdp) return { ok: false, reponse: reponseJson({ erreur: "mot_de_passe", langue }, 403) };
  if (!ctx.organisation) return { ok: false, reponse: reponseJson({ erreur: "organisation", langue }, 403) };
  if (!aLeDroit(ctx.organisation.roles, droit)) {
    return { ok: false, reponse: reponseJson({ erreur: "interdit", langue, message: traduireMessage(langue, "erreur.interdit") }, 403) };
  }
  return { ok: true, ctx: ctx as ContexteOrganisation };
}

/**
 * L'éditeur envoie l'organisation dans laquelle il a ouvert le document. Si la personne a changé d'organisation
 * dans un autre onglet entre-temps, on refuse (409) : sinon le travail serait enregistré dans la mauvaise.
 */
export function organisationChangee(ctx: ContexteOrganisation, organisationId: string): Response | null {
  return ctx.organisation.id === organisationId ? null : reponseJson({ erreur: "organisation_changee" }, 409);
}

export function reponseErreur(erreur: unknown, langue: Langue): Response {
  if (erreur instanceof ConflitVersion) {
    return reponseJson({ erreur: "conflit", ...erreur.actuel }, 409);
  }
  if (erreur instanceof ErreurMetier) {
    const statut = erreur.cle === "erreur.introuvable" ? 404 : erreur.cle === "docs.erreur.trop_volumineux" ? 413 : 400;
    return reponseJson({ erreur: erreur.cle, message: traduireMessage(langue, erreur.cle) }, statut);
  }
  console.error("[jalonia] erreur inattendue (API) :", erreur);
  return reponseJson({ erreur: "inattendue", message: traduireMessage(langue, "erreur.inattendue") }, 500);
}
