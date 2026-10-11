"use server";
// Gestion des membres d'une organisation. Deux personnes peuvent le faire :
//   - le superadmin, pour n'importe quelle organisation ;
//   - l'administrateur d'une organisation, pour l'organisation ACTUELLEMENT OUVERTE uniquement
//     (l'identifiant envoyé par le formulaire doit être celui de son organisation, sinon refus).
import { z } from "zod";
import { aLeDroit } from "@/lib/rbac";
import { identifiant, schemaNouveauMembre, roles as schemaRoles } from "@/lib/validation";
import type { EtatAction } from "@/lib/etat-action";
import { poolApplication } from "@/server/db/pools";
import { lireOrganisation } from "@/server/organisations/service";
import { ajouterMembre, modifierRoles, retirerMembre, type OrganisationCible } from "@/server/membres/service";
import { ErreurMetier } from "@/server/erreurs";
import { exigerContexte, type Contexte } from "@/server/web/contexte";
import { champ, executer, valider } from "@/server/web/actions";

async function autoriser(ctx: Contexte, formulaire: FormData): Promise<OrganisationCible> {
  const organisationId = valider(identifiant, champ(formulaire, "organisationId"));
  if (ctx.utilisateur.estSuperadmin) {
    const org = await lireOrganisation(poolApplication(), organisationId);
    if (!org) throw new ErreurMetier("erreur.introuvable");
    return { id: org.id, schemaName: org.schemaName, roleName: org.roleName };
  }
  const ouverte = ctx.organisation;
  if (!ouverte || ouverte.id !== organisationId || !aLeDroit(ouverte.roles, "organisation.membres.gerer")) {
    throw new ErreurMetier("erreur.interdit");
  }
  return { id: ouverte.id, schemaName: ouverte.schemaName, roleName: ouverte.roleName };
}

function rolesCoches(formulaire: FormData): unknown[] {
  return formulaire.getAll("roles").filter((v) => typeof v === "string");
}

export async function actionAjouterMembre(_etat: EtatAction, formulaire: FormData): Promise<EtatAction> {
  const ctx = await exigerContexte();
  return executer(ctx.langue, async () => {
    const org = await autoriser(ctx, formulaire);
    const saisie = valider(schemaNouveauMembre, {
      email: champ(formulaire, "email"),
      nom: champ(formulaire, "nom"),
      roles: rolesCoches(formulaire),
      motDePasseProvisoire: champ(formulaire, "motDePasseProvisoire"),
    });
    const r = await ajouterMembre(poolApplication(), org, saisie, ctx.acteur);
    return { cle: r.compteCree ? "membres.ajoute_compte_cree" : "membres.ajoute_compte_existant" };
  });
}

const schemaMembre = z.object({ utilisateurId: identifiant });

export async function actionModifierRoles(_etat: EtatAction, formulaire: FormData): Promise<EtatAction> {
  const ctx = await exigerContexte();
  return executer(ctx.langue, async () => {
    const org = await autoriser(ctx, formulaire);
    const { utilisateurId } = valider(schemaMembre, { utilisateurId: champ(formulaire, "utilisateurId") });
    const roles = valider(schemaRoles, rolesCoches(formulaire));
    await modifierRoles(poolApplication(), org, utilisateurId, roles, ctx.acteur);
    return { cle: "membres.roles_modifies" };
  });
}

export async function actionRetirerMembre(_etat: EtatAction, formulaire: FormData): Promise<EtatAction> {
  const ctx = await exigerContexte();
  return executer(ctx.langue, async () => {
    const org = await autoriser(ctx, formulaire);
    const { utilisateurId } = valider(schemaMembre, { utilisateurId: champ(formulaire, "utilisateurId") });
    await retirerMembre(poolApplication(), org, utilisateurId, ctx.acteur);
    return { cle: "membres.retire" };
  });
}
