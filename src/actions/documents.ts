"use server";
// Documents de l'organisation ouverte : création d'un document vierge, suppression, historique, circuit de validation.
// L'identifiant d'organisation envoyé par le formulaire doit être celui de l'organisation ACTUELLEMENT ouverte,
// et la personne doit y avoir le droit demandé — sinon refus (le superadmin n'a aucun droit implicite ici).
import { redirect } from "next/navigation";
import type { Droit } from "@/lib/rbac";
import { aLeDroit } from "@/lib/rbac";
import { identifiant } from "@/lib/validation";
import type { EtatAction } from "@/lib/etat-action";
import { poolApplication } from "@/server/db/pools";
import { contenuInitial, creerDocument, supprimerDocument } from "@/server/documents/service";
import { restaurerVersion, retablirDocument } from "@/server/documents/versions";
import { appliquerTransition, estTransition, TRANSITIONS } from "@/server/documents/circuit";
import type { OrganisationCible } from "@/server/membres/service";
import { ErreurMetier } from "@/server/erreurs";
import { exigerContexte, type Contexte } from "@/server/web/contexte";
import { champ, executer, valider } from "@/server/web/actions";

export interface EtatCreation extends EtatAction {
  /** Identifiant du document créé (l'éditeur s'ouvre alors dessus). */
  id: string | null;
}

function autoriser(ctx: Contexte, formulaire: FormData, droit: Droit): OrganisationCible {
  const organisationId = valider(identifiant, champ(formulaire, "organisationId"));
  const ouverte = ctx.organisation;
  if (!ouverte || ouverte.id !== organisationId || !aLeDroit(ouverte.roles, droit)) throw new ErreurMetier("erreur.interdit");
  return { id: ouverte.id, schemaName: ouverte.schemaName, roleName: ouverte.roleName };
}

export async function actionCreerDocument(_etat: EtatCreation, formulaire: FormData): Promise<EtatCreation> {
  const ctx = await exigerContexte();
  let id: string | null = null;
  const etat = await executer(ctx.langue, async () => {
    const org = autoriser(ctx, formulaire, "documents.rediger");
    const type = champ(formulaire, "type");
    if (type !== "procedure" && type !== "instruction") throw new ErreurMetier("erreur.saisie_invalide");
    id = (await creerDocument(poolApplication(), org, contenuInitial(type), ctx.acteur)).id;
    return { cle: "docs.cree" };
  });
  return { ...etat, id: etat.ok ? id : null };
}

export async function actionSupprimerDocument(_etat: EtatAction, formulaire: FormData): Promise<EtatAction> {
  const ctx = await exigerContexte();
  return executer(ctx.langue, async () => {
    const org = autoriser(ctx, formulaire, "documents.supprimer");
    const documentId = valider(identifiant, champ(formulaire, "documentId"));
    // « confirmerLiens » : la personne a vu l'avertissement des documents liés (ils ne sont pas supprimés avec celui-ci).
    await supprimerDocument(poolApplication(), org, documentId, ctx.acteur, { confirmerLiens: champ(formulaire, "confirmerLiens") === "1" });
    return { cle: "docs.supprime" };
  });
}

const entier = (v: string): number => (/^\d{1,9}$/.test(v) ? Number(v) : NaN);

/** Remet une version de l'historique dans le document (nouvelle version ; l'état remplacé reste dans l'historique). */
export async function actionRestaurerVersion(_etat: EtatAction, formulaire: FormData): Promise<EtatAction> {
  const ctx = await exigerContexte();
  return executer(ctx.langue, async () => {
    const org = autoriser(ctx, formulaire, "documents.rediger");
    const documentId = valider(identifiant, champ(formulaire, "documentId"));
    const version = entier(champ(formulaire, "version"));
    const versionActuelle = entier(champ(formulaire, "versionActuelle"));
    if (!Number.isSafeInteger(version) || !Number.isSafeInteger(versionActuelle)) throw new ErreurMetier("erreur.saisie_invalide");
    const r = await restaurerVersion(poolApplication(), org, documentId, version, versionActuelle, ctx.acteur);
    return { cle: "versions.restauree", variables: { v: version, n: r.version } };
  });
}

/** Sort un document de la corbeille (même droit que la mise à la corbeille). */
export async function actionRetablirDocument(_etat: EtatAction, formulaire: FormData): Promise<EtatAction> {
  const ctx = await exigerContexte();
  return executer(ctx.langue, async () => {
    const org = autoriser(ctx, formulaire, "documents.supprimer");
    const documentId = valider(identifiant, champ(formulaire, "documentId"));
    await retablirDocument(poolApplication(), org, documentId, ctx.acteur);
    return { cle: "corbeille.retabli" };
  });
}

/**
 * Décision du circuit de validation (circuit.ts) : soumettre, vérifier, refuser, approuver, archiver, réviser.
 * Le droit demandé dépend de la décision ; la séparation des tâches, l'état et le motif sont vérifiés par le service.
 * `versionVue` : la version que la personne avait sous les yeux (refus si le document a changé depuis).
 * Après la décision, la page de validation est rechargée avec l'état obtenu (?etat=…), qu'elle confirme.
 */
export async function actionTransitionDocument(_etat: EtatAction, formulaire: FormData): Promise<EtatAction> {
  const ctx = await exigerContexte();
  return executer(ctx.langue, async () => {
    const transition = champ(formulaire, "transition");
    const org = autoriser(ctx, formulaire, estTransition(transition) ? TRANSITIONS[transition].droit : "documents.lire");
    if (!estTransition(transition)) throw new ErreurMetier("erreur.saisie_invalide");
    const documentId = valider(identifiant, champ(formulaire, "documentId"));
    const versionVue = entier(champ(formulaire, "versionVue"));
    if (!Number.isSafeInteger(versionVue)) throw new ErreurMetier("erreur.saisie_invalide");
    const r = await appliquerTransition(
      poolApplication(), org, documentId, transition, { motif: champ(formulaire, "motif"), versionVue, roles: ctx.organisation?.roles ?? [] }, ctx.acteur,
    );
    redirect(`/app/documents/${documentId}/validation?etat=${r.etat}`);
  });
}
