"use server";
// Lien de réinitialisation du mot de passe (page /reinitialisation/<jeton>, publique ; décision n° 1 du 19/10/2026) :
// la personne choisit SON nouveau mot de passe ; le lien ne sert qu'une fois, toutes ses sessions sont fermées.
import { headers } from "next/headers";
import { schemaReinitialisation } from "@/lib/validation";
import type { EtatAction } from "@/lib/etat-action";
import { poolApplication } from "@/server/db/pools";
import { reinitialiserParLien } from "@/server/utilisateurs/service";
import { ErreurMetier } from "@/server/erreurs";
import { estMaintenanceActive, lireContexte, lireLangue } from "@/server/web/contexte";
import { agentDepuisEntetes, ipDepuisEntetes } from "@/server/web/reseau";
import { champ, executer, valider } from "@/server/web/actions";

export async function actionReinitialiserParLien(_etat: EtatAction, formulaire: FormData): Promise<EtatAction> {
  const langue = await lireLangue();
  return executer(langue, async () => {
    // Quelqu'un est déjà connecté dans ce navigateur : il doit d'abord se déconnecter.
    if (await lireContexte()) throw new ErreurMetier("invitation.deja_connecte");
    if (await estMaintenanceActive()) throw new ErreurMetier("maintenance.bloquee");
    const saisie = valider(schemaReinitialisation, {
      jeton: champ(formulaire, "jeton"),
      nouveau: champ(formulaire, "nouveau"),
      confirmation: champ(formulaire, "confirmation"),
    });
    const entetes = await headers();
    await reinitialiserParLien(poolApplication(), saisie.jeton, saisie.nouveau, { ip: ipDepuisEntetes(entetes), agent: agentDepuisEntetes(entetes) });
    return { cle: "reinit.fait" };
  });
}
