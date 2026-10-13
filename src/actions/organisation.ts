"use server";
// Réglages de l'organisation ouverte (revue périodique, rappels) et notifications de la personne connectée.
// L'identifiant d'organisation envoyé par le formulaire doit être celui de l'organisation ACTUELLEMENT ouverte ;
// le superadmin n'a aucun droit implicite ici.
import { aLeDroit, type Droit } from "@/lib/rbac";
import { identifiant } from "@/lib/validation";
import type { EtatAction } from "@/lib/etat-action";
import { poolApplication } from "@/server/db/pools";
import { modifierParametres } from "@/server/documents/revues";
import { marquerLues } from "@/server/notifications/service";
import type { OrganisationCible } from "@/server/membres/service";
import { ErreurMetier } from "@/server/erreurs";
import { exigerContexte, type Contexte } from "@/server/web/contexte";
import { champ, executer, valider } from "@/server/web/actions";

function autoriser(ctx: Contexte, formulaire: FormData, droit: Droit): OrganisationCible {
  const organisationId = valider(identifiant, champ(formulaire, "organisationId"));
  const ouverte = ctx.organisation;
  if (!ouverte || ouverte.id !== organisationId || !aLeDroit(ouverte.roles, droit)) throw new ErreurMetier("erreur.interdit");
  return { id: ouverte.id, schemaName: ouverte.schemaName, roleName: ouverte.roleName };
}

const entier = (v: string): number => (/^\d{1,4}$/.test(v.trim()) ? Number(v.trim()) : NaN);

export async function actionModifierParametres(_etat: EtatAction, formulaire: FormData): Promise<EtatAction> {
  const ctx = await exigerContexte();
  return executer(ctx.langue, async () => {
    const org = autoriser(ctx, formulaire, "organisation.parametres");
    await modifierParametres(poolApplication(), org, {
      periodeRevueMois: entier(champ(formulaire, "periodeRevueMois")),
      rappelJours: entier(champ(formulaire, "rappelJours")),
      escaladeJours: entier(champ(formulaire, "escaladeJours")),
    }, ctx.acteur);
    return { cle: "parametres.fait" };
  });
}

/** Marque comme lues TOUTES les notifications de la personne connectée, dans l'organisation ouverte. */
export async function actionToutMarquerLu(_etat: EtatAction, formulaire: FormData): Promise<EtatAction> {
  const ctx = await exigerContexte();
  return executer(ctx.langue, async () => {
    const org = autoriser(ctx, formulaire, "documents.lire");
    const n = await marquerLues(poolApplication(), org, ctx.acteur.id, "toutes");
    return { cle: "notifications.fait", variables: { n } };
  });
}
