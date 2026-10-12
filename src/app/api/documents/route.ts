// POST /api/documents — créer un document depuis l'éditeur (raccourci « Créer l'instruction de travail » d'une
// procédure : l'instruction devient un NOUVEAU document, la procédure reste intacte).
// Les documents vierges sont créés depuis la page « Documents » (action serveur).
import { schemaCreation } from "@/lib/schemas-api";
import { poolApplication } from "@/server/db/pools";
import { creerDocument } from "@/server/documents/service";
import { contexteApi, organisationChangee, reponseErreur } from "@/server/web/api";
import { lireCorpsJson, origineAutorisee, reponseJson } from "@/server/web/requetes-json";

export async function POST(requete: Request) {
  if (!origineAutorisee(requete)) return reponseJson({ erreur: "origine" }, 403);
  const acces = await contexteApi("documents.rediger");
  if (!acces.ok) return acces.reponse;
  const { ctx } = acces;
  const corps = await lireCorpsJson(requete);
  if (!corps.ok) return corps.reponse;
  const lu = schemaCreation.safeParse(corps.valeur);
  if (!lu.success) return reponseJson({ erreur: "erreur.saisie_invalide" }, 400);
  const autre = organisationChangee(ctx, lu.data.organisationId);
  if (autre) return autre;
  try {
    const cree = await creerDocument(poolApplication(), ctx.organisation, lu.data.contenu, ctx.acteur);
    return reponseJson(cree, 201);
  } catch (erreur) {
    return reponseErreur(erreur, ctx.langue);
  }
}
