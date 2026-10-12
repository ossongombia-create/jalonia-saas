// Outils des routes JSON (API de l'éditeur) : réponses, contrôle de l'origine, lecture prudente du corps.
// Sans dépendance à Next.js : testables directement (tests/unit/requetes-json.test.ts).

/** Taille maximale d'un corps de requête JSON : un contenu de document (2 Mo) et son enveloppe. */
export const TAILLE_MAX_REQUETE = 2_500_000;

export function reponseJson(corps: unknown, statut = 200): Response {
  return Response.json(corps, { status: statut, headers: { "Cache-Control": "no-store" } });
}

/**
 * Protection contre les requêtes forgées depuis un autre site : une requête qui modifie des données doit venir
 * d'une page de Jalonia (en-tête Origin du navigateur = adresse du site). Même règle que les actions serveur
 * de Next.js. Derrière Caddy, l'hôte d'origine est transmis tel quel (Host) et dans X-Forwarded-Host.
 */
export function origineAutorisee(requete: Request): boolean {
  const origine = requete.headers.get("origin");
  if (!origine) return false;
  let hote: string;
  try {
    hote = new URL(origine).host;
  } catch {
    return false;
  }
  const attendu = requete.headers.get("x-forwarded-host") ?? requete.headers.get("host");
  return Boolean(attendu) && hote === attendu;
}

export type CorpsLu = { ok: true; valeur: unknown } | { ok: false; reponse: Response };

/**
 * Lit un corps JSON en refusant ce qui dépasse la taille maximale AVANT de tout charger en mémoire.
 * 415 : pas du JSON · 413 : trop volumineux · 400 : illisible (JSON invalide, encodage invalide).
 */
export async function lireCorpsJson(requete: Request, max = TAILLE_MAX_REQUETE): Promise<CorpsLu> {
  const type = requete.headers.get("content-type") ?? "";
  if (!/^application\/json\s*(;|$)/i.test(type)) return { ok: false, reponse: reponseJson({ erreur: "type_contenu" }, 415) };
  const annonce = Number(requete.headers.get("content-length") ?? "0");
  if (Number.isFinite(annonce) && annonce > max) return { ok: false, reponse: reponseJson({ erreur: "docs.erreur.trop_volumineux" }, 413) };
  if (!requete.body) return { ok: false, reponse: reponseJson({ erreur: "corps_illisible" }, 400) };

  const lecteur = requete.body.getReader();
  const morceaux: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await lecteur.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await lecteur.cancel().catch(() => undefined);
      return { ok: false, reponse: reponseJson({ erreur: "docs.erreur.trop_volumineux" }, 413) };
    }
    morceaux.push(value);
  }
  try {
    const texte = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(morceaux));
    return { ok: true, valeur: JSON.parse(texte) };
  } catch {
    return { ok: false, reponse: reponseJson({ erreur: "corps_illisible" }, 400) };
  }
}
