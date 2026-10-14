"use server";
import { z } from "zod";
import type { EtatAction } from "@/lib/etat-action";
import { poolApplication } from "@/server/db/pools";
import { changerMaintenance } from "@/server/maintenance/service";
import { exigerSuperadmin } from "@/server/web/contexte";
import { champ, executer, valider } from "@/server/web/actions";

const schema = z.object({
  actif: z.enum(["oui", "non"], "erreur.saisie_invalide").transform((v) => v === "oui"),
  messageFr: z.string().trim().min(1, "erreur.saisie_invalide").max(1000, "erreur.saisie_invalide"),
  messageEn: z.string().trim().min(1, "erreur.saisie_invalide").max(1000, "erreur.saisie_invalide"),
});

export async function actionEnregistrerMaintenance(_etat: EtatAction, formulaire: FormData): Promise<EtatAction> {
  const ctx = await exigerSuperadmin();
  return executer(ctx.langue, async () => {
    const entree = valider(schema, {
      actif: champ(formulaire, "actif"),
      messageFr: champ(formulaire, "messageFr"),
      messageEn: champ(formulaire, "messageEn"),
    });
    await changerMaintenance(poolApplication(), entree, ctx.acteur);
    return { cle: "maintenance.enregistree" };
  });
}
