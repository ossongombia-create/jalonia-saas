// Comparaison de deux versions d'un document, champ par champ (audit D1). Fonction pure : testée sans base ni navigateur.
//
// Le contenu est un objet JSON (celui de l'éditeur). On le parcourt en parallèle :
//   - objets : clé par clé ;
//   - listes d'objets qui ont chacun un « id » unique (rôles, instructions, alternatives, risques…) : appariées par id,
//     ce qui distingue un élément ajouté, retiré, modifié ou déplacé ;
//   - autres listes : position par position ;
//   - valeurs simples : égales ou non.
// Chaque différence porte son chemin (pour l'afficher en clair) et les deux valeurs.

export type Nature = "ajout" | "suppression" | "modification" | "ordre";

/** Un pas du chemin : une clé d'objet, ou un élément de liste (par son id s'il en a un, sinon par sa position). */
export type Pas = { cle: string } | { id: string; position: number; element: Record<string, unknown> } | { position: number };

export interface Difference {
  chemin: Pas[];
  nature: Nature;
  avant: unknown;
  apres: unknown;
}

export const MAX_DIFFERENCES = 500;

const estObjet = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function avecIds(liste: unknown[]): boolean {
  if (liste.length === 0) return false;
  const vus = new Set<string>();
  for (const x of liste) {
    if (!estObjet(x) || typeof x.id !== "string" || x.id === "" || vus.has(x.id)) return false;
    vus.add(x.id);
  }
  return true;
}

function egal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => egal(x, b[i]));
  if (estObjet(a) && estObjet(b)) {
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => k in b && egal(a[k], b[k]));
  }
  return false;
}

/** Les différences entre `avant` et `apres` (au plus MAX_DIFFERENCES ; `tronque` dit s'il y en avait davantage). */
export function comparer(avant: unknown, apres: unknown): { differences: Difference[]; tronque: boolean } {
  const differences: Difference[] = [];
  let tronque = false;
  const noter = (d: Difference) => {
    if (differences.length >= MAX_DIFFERENCES) tronque = true;
    else differences.push(d);
  };

  const parcourir = (a: unknown, b: unknown, chemin: Pas[]) => {
    if (egal(a, b)) return;
    if (estObjet(a) && estObjet(b)) {
      const cles = [...Object.keys(a), ...Object.keys(b).filter((k) => !(k in a))];
      for (const k of cles) {
        if (!(k in b)) noter({ chemin: [...chemin, { cle: k }], nature: "suppression", avant: a[k], apres: undefined });
        else if (!(k in a)) noter({ chemin: [...chemin, { cle: k }], nature: "ajout", avant: undefined, apres: b[k] });
        else parcourir(a[k], b[k], [...chemin, { cle: k }]);
      }
      return;
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      if ((avecIds(a) || a.length === 0) && (avecIds(b) || b.length === 0) && (a.length > 0 || b.length > 0)) {
        const objA = a as Record<string, unknown>[];
        const objB = b as Record<string, unknown>[];
        const parId = new Map(objB.map((x, i) => [x.id as string, { x, i }]));
        const idsA = new Set(objA.map((x) => x.id as string));
        objA.forEach((x, i) => {
          const pas = { id: x.id as string, position: i, element: x };
          const correspondant = parId.get(x.id as string);
          if (!correspondant) noter({ chemin: [...chemin, pas], nature: "suppression", avant: x, apres: undefined });
          else parcourir(x, correspondant.x, [...chemin, { ...pas, position: correspondant.i, element: correspondant.x }]);
        });
        objB.forEach((x, i) => {
          if (!idsA.has(x.id as string)) noter({ chemin: [...chemin, { id: x.id as string, position: i, element: x }], nature: "ajout", avant: undefined, apres: x });
        });
        // Ordre : les éléments présents des deux côtés ne se suivent plus dans le même ordre.
        const communsA = objA.map((x) => x.id as string).filter((id) => parId.has(id));
        const communsB = objB.map((x) => x.id as string).filter((id) => idsA.has(id));
        if (!egal(communsA, communsB)) noter({ chemin, nature: "ordre", avant: communsA, apres: communsB });
        return;
      }
      const n = Math.max(a.length, b.length);
      for (let i = 0; i < n; i += 1) {
        if (i >= b.length) noter({ chemin: [...chemin, { position: i }], nature: "suppression", avant: a[i], apres: undefined });
        else if (i >= a.length) noter({ chemin: [...chemin, { position: i }], nature: "ajout", avant: undefined, apres: b[i] });
        else parcourir(a[i], b[i], [...chemin, { position: i }]);
      }
      return;
    }
    noter({ chemin, nature: a === undefined ? "ajout" : b === undefined ? "suppression" : "modification", avant: a, apres: b });
  };

  parcourir(avant, apres, []);
  return { differences, tronque };
}
