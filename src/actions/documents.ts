"use server";
// Documents de l'organisation ouverte : création d'un document vierge, suppression.
// L'identifiant d'organisation envoyé par le formulaire doit être celui de l'organisation ACTUELLEMENT ouverte,
// et la personne doit y avoir le droit demandé — sinon refus (le superadmin n'a aucun droit implicite ici).
import type { Droit } from "@/lib/rbac";
import { aLeDroit } from "@/lib/rbac";
import { identifiant } from "@/lib/validation";
import type { EtatAction } from "@/lib/etat-action";
import { poolApplication } from "@/server/db/pools";
import { contenuInitial, creerDocument, supprimerDocument } from "@/server/documents/service";
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
    await supprimerDocument(poolApplication(), org, documentId, ctx.acteur);
    return { cle: "docs.supprime" };
  });
}
