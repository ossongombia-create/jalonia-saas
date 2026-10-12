// logo.js — préparer le LOGO envoyé par l'utilisateur (partie qui demande le navigateur : lecture du fichier et redimensionnement).
// On ne garde jamais le fichier d'origine : l'image est relue par le navigateur puis redessinée dans un petit canevas, puis
// exportée en PNG. Un fichier qui n'est pas une vraie image PNG ou JPEG est refusé, et ce qui sort d'ici est toujours un PNG propre.

export const LOGO_LARGEUR_MAX = 360; // pixels : assez fin pour l'impression, assez léger pour le fichier de sauvegarde
export const LOGO_HAUTEUR_MAX = 140;

// Renvoie une promesse : « data:image/png;base64,… », ou une erreur (Error("format")) si le fichier n'est pas une image lisible.
export function preparerLogo(fichier) {
  return new Promise((ok, ko) => {
    if (!fichier || !/^image\/(png|jpeg)$/.test(fichier.type) || fichier.size > 8 * 1024 * 1024) { ko(new Error("format")); return; }
    const url = URL.createObjectURL(fichier);
    const image = new Image();
    image.onload = () => {
      try {
        const echelle = Math.min(1, LOGO_LARGEUR_MAX / image.naturalWidth, LOGO_HAUTEUR_MAX / image.naturalHeight);
        const canevas = document.createElement("canvas");
        canevas.width = Math.max(1, Math.round(image.naturalWidth * echelle));
        canevas.height = Math.max(1, Math.round(image.naturalHeight * echelle));
        canevas.getContext("2d").drawImage(image, 0, 0, canevas.width, canevas.height);
        ok(canevas.toDataURL("image/png"));
      } catch (e) {
        ko(new Error("format"));
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    image.onerror = () => { URL.revokeObjectURL(url); ko(new Error("format")); };
    image.src = url;
  });
}
