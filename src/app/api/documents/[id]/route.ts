// PUT /api/documents/<id> — enregistrer un document (enregistrement automatique de l'éditeur).
// 409 « conflit » : quelqu'un a enregistré une version plus récente ; l'éditeur propose alors de recharger
// la version du serveur ou de garder la sienne (forcer).
import { schemaEnregistrement } from "@/lib/schemas-api";
import { poolApplication } from "@/server/db/pools";
import { enregistrerDocument } from "@/server/documents/service";
import { contexteApi, organisationChangee, reponseErreur } from "@/server/web/api";
import { lireCorpsJson, origineAutorisee, reponseJson } from "@/server/web/requetes-json";

export async function PUT(requete: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!origineAutorisee(requete)) return reponseJson({ erreur: "origine" }, 403);
  const acces = await contexteApi("documents.rediger");
  if (!acces.ok) return acces.reponse;
  const { ctx } = acces;
  const corps = await lireCorpsJson(requete);
  if (!corps.ok) return corps.reponse;
  const lu = schemaEnregistrement.safeParse(corps.valeur);
  if (!lu.success) return reponseJson({ erreur: "erreur.saisie_invalide" }, 400);
  const autre = organisationChangee(ctx, lu.data.organisationId);
  if (autre) return autre;
  const { id } = await params;
  try {
    const etat = await enregistrerDocument(poolApplication(), ctx.organisation, id, lu.data, ctx.acteur);
    return reponseJson(etat);
  } catch (erreur) {
    return reponseErreur(erreur, ctx.langue);
  }
}
