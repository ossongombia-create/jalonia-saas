// PUT /api/cartographie — enregistrer la cartographie des processus de l'organisation (une seule par organisation).
import { schemaEnregistrement } from "@/lib/schemas-api";
import { poolApplication } from "@/server/db/pools";
import { enregistrerCartographie } from "@/server/documents/service";
import { contexteApi, organisationChangee, reponseErreur } from "@/server/web/api";
import { lireCorpsJson, origineAutorisee, reponseJson } from "@/server/web/requetes-json";

export async function PUT(requete: Request) {
  if (!origineAutorisee(requete)) return reponseJson({ erreur: "origine" }, 403);
  const acces = await contexteApi("cartographie.modifier");
  if (!acces.ok) return acces.reponse;
  const { ctx } = acces;
  const corps = await lireCorpsJson(requete);
  if (!corps.ok) return corps.reponse;
  const lu = schemaEnregistrement.safeParse(corps.valeur);
  if (!lu.success) return reponseJson({ erreur: "erreur.saisie_invalide" }, 400);
  const autre = organisationChangee(ctx, lu.data.organisationId);
  if (autre) return autre;
  try {
    const etat = await enregistrerCartographie(poolApplication(), ctx.organisation, lu.data, ctx.acteur);
    return reponseJson(etat);
  } catch (erreur) {
    return reponseErreur(erreur, ctx.langue);
  }
}
