// GET /api/editeur/contexte?doc=<id> — ce dont l'éditeur a besoin à l'ouverture : l'organisation, la personne,
// ses droits, le document demandé (s'il y en a un) et la cartographie de l'organisation.
// « rediger » tient compte du circuit de validation : seul un brouillon se modifie (le serveur le refuse de toute façon).
import { aLeDroit } from "@/lib/rbac";
import { traduireMessage } from "@/lib/i18n";
import { poolApplication } from "@/server/db/pools";
import { lireCartographie, lireDocument } from "@/server/documents/service";
import { contexteApi, reponseErreur } from "@/server/web/api";
import { reponseJson } from "@/server/web/requetes-json";

export async function GET(requete: Request) {
  const acces = await contexteApi("documents.lire");
  if (!acces.ok) return acces.reponse;
  const { ctx } = acces;
  const { organisation } = ctx;
  const docId = new URL(requete.url).searchParams.get("doc");
  try {
    const pool = poolApplication();
    const [document, cartographie] = await Promise.all([docId ? lireDocument(pool, organisation, docId) : null, lireCartographie(pool, organisation)]);
    if (docId && !document) return reponseJson({ erreur: "erreur.introuvable", langue: ctx.langue, message: traduireMessage(ctx.langue, "erreur.introuvable") }, 404);
    return reponseJson({
      organisation: { id: organisation.id, nom: organisation.nom },
      utilisateur: { nom: ctx.utilisateur.nom, langue: ctx.langue },
      droits: {
        rediger: aLeDroit(organisation.roles, "documents.rediger") && (!document || document.etat === "brouillon"),
        supprimer: aLeDroit(organisation.roles, "documents.supprimer"),
        cartographie: aLeDroit(organisation.roles, "cartographie.modifier"),
      },
      document: document
        ? { id: document.id, version: document.version, etat: document.etat, contenu: document.contenu, modifieParNom: document.modifieParNom, modifieLe: document.modifieLe }
        : null,
      cartographie,
    });
  } catch (erreur) {
    return reponseErreur(erreur, ctx.langue);
  }
}
