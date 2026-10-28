// xlsx.js — LECTURE d'un classeur Excel (.xlsx), en texte seul, sans bibliothèque (comme importWord.js pour le Word).
// Un .xlsx est une archive ZIP de fichiers XML :
//   xl/workbook.xml              la liste des feuilles (nom, identifiant de relation)
//   xl/_rels/workbook.xml.rels   où se trouve chaque feuille (xl/worksheets/sheetN.xml)
//   xl/sharedStrings.xml         les textes partagés (une cellule de texte y renvoie par son numéro)
//   xl/worksheets/sheetN.xml     les cellules : référence (B9), type, valeur (pour une formule : la dernière valeur calculée)
// Le fichier est une donnée NON FIABLE : on n'en tire que du texte (jamais de HTML), avec des limites de taille ; l'archive est
// décompressée par lireZip (limite de taille, protection contre les archives piégées).
import { lireZip } from "./importWord.js";

export const MAX_FEUILLES = 40;
export const MAX_CELLULES = 20_000; // par feuille
const MAX_TEXTE = 5_000; // par cellule

const ENTITES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function decoder(s) {
  return s
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e) => {
      if (e[0] === "#") {
        const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
      }
      return ENTITES[e.toLowerCase()];
    })
    // Excel échappe certains caractères en _xHHHH_ (ex. _x000D_ = retour chariot).
    .replace(/_x([0-9a-f]{4})_/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

const attribut = (balise, nom) => {
  const m = new RegExp(`\\s${nom}="([^"]*)"`).exec(balise);
  return m ? decoder(m[1]) : "";
};

/** Texte d'un élément <si> ou <is> : tous ses <t>, hors indications phonétiques (<rPh>). */
function texteRiche(xml) {
  return [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>|<t\s*\/>/g)].map((m) => decoder(m[1] || "")).join("");
}

/** « B9 » → { ligne: 9, colonne: 2 } (colonnes à partir de 1). */
export function adresse(ref) {
  const m = /^([A-Z]{1,3})(\d{1,7})$/.exec(ref || "");
  if (!m) return null;
  let colonne = 0;
  for (const c of m[1]) colonne = colonne * 26 + (c.charCodeAt(0) - 64);
  return { ligne: Number(m[2]), colonne };
}

/** Les cellules d'une feuille, en texte : grille[ligne - 1][colonne - 1] (lignes et colonnes vides : ""). */
export function lireFeuille(xml, partages) {
  const grille = [];
  let n = 0;
  for (const m of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    if (++n > MAX_CELLULES) break;
    const balise = m[1];
    const contenu = m[2] || "";
    const a = adresse(attribut(balise, "r"));
    if (!a) continue;
    const type = attribut(balise, "t");
    const v = /<v>([^<]*)<\/v>/.exec(contenu);
    let texte = "";
    if (type === "s") texte = v ? partages[Number(v[1])] ?? "" : "";
    else if (type === "inlineStr") texte = texteRiche((/<is>([\s\S]*?)<\/is>/.exec(contenu) || ["", ""])[1]);
    else if (type === "b") texte = v ? (v[1] === "1" ? "VRAI" : "FAUX") : "";
    else texte = v ? decoder(v[1]) : ""; // nombre, date (numéro de série), texte de formule (t="str")
    texte = texte.replace(/\r\n?/g, "\n").slice(0, MAX_TEXTE);
    if (!texte.trim()) continue;
    while (grille.length < a.ligne) grille.push([]);
    const ligne = grille[a.ligne - 1];
    while (ligne.length < a.colonne) ligne.push("");
    ligne[a.colonne - 1] = texte;
  }
  return grille;
}

/** Les feuilles du classeur, dans l'ordre des onglets : [{ nom, grille }]. Erreur « pas_xlsx » si ce n'est pas un classeur. */
export async function lireClasseur(tampon) {
  let classeur;
  let relations;
  try {
    classeur = await lireZip(tampon, "xl/workbook.xml");
    relations = await lireZip(tampon, "xl/_rels/workbook.xml.rels");
  } catch (e) {
    throw new Error(e && e.message === "trop_gros" ? "trop_gros" : "pas_xlsx");
  }
  let partages = [];
  try {
    partages = [...(await lireZip(tampon, "xl/sharedStrings.xml")).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texteRiche(m[1]));
  } catch (e) {
    if (e && e.message === "trop_gros") throw e;
    partages = []; // un classeur sans texte partagé (que des nombres) n'a pas ce fichier
  }
  const cibles = new Map([...relations.matchAll(/<Relationship\b([^>]*)\/?>/g)].map((m) => [attribut(m[1], "Id"), attribut(m[1], "Target")]));
  const feuilles = [];
  for (const m of [...classeur.matchAll(/<sheet\b([^>]*)\/?>/g)].slice(0, MAX_FEUILLES)) {
    const nom = attribut(m[1], "name");
    const cible = cibles.get(attribut(m[1], "r:id"));
    if (!cible) continue;
    // Chemin relatif à xl/ (« worksheets/sheet1.xml ») ou absolu (« /xl/worksheets/sheet1.xml »).
    const chemin = cible.startsWith("/") ? cible.slice(1) : "xl/" + cible.replace(/^\.\//, "");
    if (!/^xl\/worksheets\/[\w.-]+\.xml$/.test(chemin)) continue;
    let xml;
    try {
      xml = await lireZip(tampon, chemin);
    } catch (e) {
      if (e && e.message === "trop_gros") throw e;
      continue;
    }
    feuilles.push({ nom, grille: lireFeuille(xml, partages) });
  }
  if (feuilles.length === 0) throw new Error("pas_xlsx");
  return feuilles;
}
