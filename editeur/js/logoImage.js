// logoImage.js — lire le LOGO enregistré dans la procédure (data URL PNG ou JPEG) pour le mettre dans le fichier Word :
// octets de l'image, type et dimensions en pixels. Aucun accès au navigateur : fonctionne aussi dans les tests.
// Renvoie null si l'image n'est pas exploitable (l'en-tête du Word est alors fait sans logo).

const MAX_LARGEUR_AFFICHEE = 120; // pixels à 96 dpi : la taille du logo dans l'en-tête du document (aperçu, PDF et Word)
const MAX_HAUTEUR_AFFICHEE = 40;

function decoder(base64) {
  const binaire = atob(base64);
  const octets = new Uint8Array(binaire.length);
  for (let i = 0; i < binaire.length; i += 1) octets[i] = binaire.charCodeAt(i);
  return octets;
}

function dimensionsPng(o) {
  if (o.length < 24) return null;
  const v = new DataView(o.buffer, o.byteOffset, o.byteLength);
  return { largeur: v.getUint32(16), hauteur: v.getUint32(20) };
}

// JPEG : on cherche le premier marqueur « Start Of Frame » (SOF0 à SOF15, sauf DHT, JPG et DAC) qui contient la taille.
function dimensionsJpeg(o) {
  let i = 2;
  while (i + 9 < o.length) {
    if (o[i] !== 0xff) { i += 1; continue; }
    const marqueur = o[i + 1];
    if (marqueur === 0xff) { i += 1; continue; }
    if (marqueur >= 0xc0 && marqueur <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marqueur)) {
      return { hauteur: (o[i + 5] << 8) | o[i + 6], largeur: (o[i + 7] << 8) | o[i + 8] };
    }
    if (marqueur === 0xd8 || (marqueur >= 0xd0 && marqueur <= 0xd7) || marqueur === 0x01) { i += 2; continue; }
    i += 2 + ((o[i + 2] << 8) | o[i + 3]);
  }
  return null;
}

// { octets, type: "png" | "jpeg", extension, largeur, hauteur (pixels de l'image), affichage: { largeur, hauteur } (pixels à 96 dpi) } ou null.
export function lireLogo(dataUrl) {
  const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(dataUrl || ""));
  if (!m) return null;
  let octets;
  try { octets = decoder(m[2]); } catch (e) { return null; }
  const dim = m[1] === "png" ? dimensionsPng(octets) : dimensionsJpeg(octets);
  if (!dim || !(dim.largeur > 0) || !(dim.hauteur > 0) || dim.largeur > 20000 || dim.hauteur > 20000) return null;
  const echelle = Math.min(1, MAX_LARGEUR_AFFICHEE / dim.largeur, MAX_HAUTEUR_AFFICHEE / dim.hauteur);
  return {
    octets, type: m[1], extension: m[1] === "png" ? "png" : "jpg", largeur: dim.largeur, hauteur: dim.hauteur,
    affichage: { largeur: Math.max(1, Math.round(dim.largeur * echelle)), hauteur: Math.max(1, Math.round(dim.hauteur * echelle)) },
  };
}

export const LOGO_AFFICHAGE_MAX = { largeur: MAX_LARGEUR_AFFICHEE, hauteur: MAX_HAUTEUR_AFFICHEE };
