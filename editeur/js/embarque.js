// embarque.js — la procédure EMBARQUÉE dans le fichier Word.
// Le Word généré ne montre que les colonnes du modèle de procédure (le détail des entrées/sorties n'y est pas). Pour pouvoir
// rouvrir un Word généré par l'application SANS perte, on y glisse la procédure complète (JSON) dans une « partie XML
// personnalisée » (customXml), invisible à l'écran. Avec une signature du texte visible du document : si quelqu'un a modifié le
// texte dans Word, la signature ne correspond plus et l'import lit alors les tableaux (comme pour n'importe quel Word).

export const URI_EMBARQUE = "urn:jalonia:procedure";
// Identifiants des fichiers produits AVANT la v0.23 : on continue de les lire (un Word ou un .json déjà enregistré doit toujours s'ouvrir).
// Ces identifiants techniques ne changent plus, même si l'outil est un jour renommé : ils désignent le FORMAT du fichier, pas le nom affiché.
const URI_ANCIEN = "urn:qualigramme-app:procedure";
const FORMATS_LUS = ["jalonia", "qualigramme-app"];
const MOTIF_EMBARQUE = new RegExp(`<(jalonia|qualigramme)\\b[^>]*xmlns="(?:${URI_EMBARQUE}|${URI_ANCIEN})"[^>]*>([\\s\\S]*?)</\\1>`);

// Texte visible d'un document.xml : tout le texte des <w:t>, sans les champs (numéros de page : Word en change le résultat)
// ni les espaces (Word peut découper ou recoller les morceaux de texte).
export function texteVisible(documentXml) {
  const sansChamps = String(documentXml)
    .replace(/<w:fldSimple\b[^>]*>[\s\S]*?<\/w:fldSimple>/g, "")
    .replace(/<w:fldChar\b[^>]*w:fldCharType="begin"[^>]*\/>[\s\S]*?<w:fldChar\b[^>]*w:fldCharType="end"[^>]*\/>/g, "");
  const morceaux = [];
  const re = /<w:t\b[^>]*>([^<]*)<\/w:t>/g;
  let m;
  while ((m = re.exec(sansChamps)) !== null) morceaux.push(m[1]);
  return morceaux.join("").replace(/\s+/g, "");
}

// Empreinte simple du texte (pas de cryptographie : elle détecte un changement, rien de plus).
export function empreinte(texte) {
  let h1 = 5381;
  let h2 = 52711;
  for (let i = 0; i < texte.length; i += 1) {
    const c = texte.charCodeAt(i);
    h1 = ((h1 * 33) ^ c) >>> 0;
    h2 = ((h2 * 31) + c) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0") + "-" + texte.length;
}

function versBase64(texte) {
  const octets = new TextEncoder().encode(texte);
  let binaire = "";
  for (let i = 0; i < octets.length; i += 0x8000) binaire += String.fromCharCode(...octets.subarray(i, i + 0x8000));
  return btoa(binaire);
}

function depuisBase64(base64) {
  const binaire = atob(base64);
  const octets = new Uint8Array(binaire.length);
  for (let i = 0; i < binaire.length; i += 1) octets[i] = binaire.charCodeAt(i);
  return new TextDecoder().decode(octets);
}

// Contenu du fichier customXml/item1.xml.
export function emballer(procedure, signature) {
  const json = JSON.stringify({ format: "jalonia", version: 1, procedure });
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<jalonia xmlns="${URI_EMBARQUE}" signature="${signature}">${versBase64(json)}</jalonia>`;
}

// Relit un item customXml : { signature, procedure } ou null si ce n'est pas le nôtre ou s'il est illisible.
export function deballer(xml) {
  const m = MOTIF_EMBARQUE.exec(String(xml));
  if (!m) return null;
  const s = /\bsignature="([^"]*)"/.exec(m[0].slice(0, m[0].indexOf(">")));
  try {
    const donnees = JSON.parse(depuisBase64(m[2].trim()));
    if (!donnees || !FORMATS_LUS.includes(donnees.format) || typeof donnees.procedure !== "object") return null;
    return { signature: s ? s[1] : "", procedure: donnees.procedure };
  } catch (e) {
    return null;
  }
}
