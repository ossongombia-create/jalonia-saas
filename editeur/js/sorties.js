// sorties.js — les SORTIES du document, côté navigateur : fichier Word (.docx) et PDF (impression).
// La fabrication du .docx est dans exportDocx.js (testable sans navigateur) ; ici on s'occupe de ce qui
// demande le navigateur : transformer le dessin (SVG) en image PNG, télécharger un fichier, imprimer.

import * as store from "./store.js";
import { langueCourante } from "./i18n.js";
import { construireDocx, construireDocxIT } from "./exportDocx.js";
import { dessinerNiveau2, mesurerNiveau2, disposerNiveau2 } from "./render.js";
import { construireFeuille } from "./apercu.js";
import { construireFeuilleIT } from "./apercu-it.js";
import { dessinerNiveau3, mesurerNiveau3, disposerNiveau3 } from "./render3.js";
import { estInstruction } from "./parcours.js";

const TYPE_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PIXELS_MAX = { largeur: 3200, hauteur: 5200 }; // au-delà, le navigateur risque de refuser le canevas

export function dateDuJour() {
  return new Date().toLocaleDateString(langueCourante() === "en" ? "en-GB" : "fr-FR");
}

// Le dessin (SVG, du texte) devient une image PNG : Word l'affiche telle quelle, sans dépendre des polices.
export async function svgVersPng(svg, largeur, hauteur) {
  const echelle = Math.min(2, PIXELS_MAX.largeur / largeur, PIXELS_MAX.hauteur / hauteur);
  const w = Math.max(1, Math.round(largeur * echelle));
  const h = Math.max(1, Math.round(hauteur * echelle));
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const image = new Image();
    await new Promise((ok, ko) => {
      image.onload = ok;
      image.onerror = () => ko(new Error("svg"));
      image.src = url;
    });
    const canevas = document.createElement("canvas");
    canevas.width = w;
    canevas.height = h;
    const ctx = canevas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(image, 0, 0, w, h);
    const blob = await new Promise((ok) => canevas.toBlob(ok, "image/png"));
    if (!blob) throw new Error("png");
    return { png: new Uint8Array(await blob.arrayBuffer()), largeur: w, hauteur: h, echelle: w / largeur };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function nomDeFichier(procedure, extension) {
  const m = procedure.meta;
  const defaut = m.typeDocument === "instruction" ? "instruction" : "procedure";
  const base = [m.reference, m.version].filter((v) => v && String(v).trim()).join("_") || m.titre || defaut;
  return `${base.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || defaut}.${extension}`;
}

function telecharger(octets, nom, type) {
  const lien = document.createElement("a");
  lien.href = URL.createObjectURL(new Blob([octets], { type }));
  lien.download = nom;
  document.body.appendChild(lien);
  lien.click();
  lien.remove();
  setTimeout(() => URL.revokeObjectURL(lien.href), 2000);
}

// Fabrique le .docx (avec le logigramme en image) et le fait télécharger. Renvoie les octets (utile aux tests).
export async function fabriquerWord() {
  const procedure = store.lire();
  if (estInstruction(procedure)) return fabriquerWordIT(procedure);
  let image = { png: null, largeur: 0, hauteur: 0, echelle: 1 };
  const taille = mesurerNiveau2(procedure);
  if (taille) image = await svgVersPng(dessinerNiveau2(procedure), taille.largeur, taille.hauteur);
  // Le dessin est posé sur sa page (portrait ou paysage) à la taille calculée par render.js : même règle que l'aperçu.
  return construireDocx(procedure, {
    png: image.png, largeurPng: image.largeur, hauteurPng: image.hauteur, echellePng: image.echelle, disposition: disposerNiveau2(procedure),
  });
}

// Instruction de travail : le .docx d'une page A4 portrait (le dessin de render3.js en image, l'instruction complète embarquée).
async function fabriquerWordIT(procedure) {
  const taille = mesurerNiveau3(procedure);
  let image = { png: null, largeur: 0, hauteur: 0 };
  if (taille) image = await svgVersPng(dessinerNiveau3(procedure), taille.largeur, taille.hauteur);
  return construireDocxIT(procedure, { png: image.png, largeurPng: image.largeur, hauteurPng: image.hauteur, disposition: disposerNiveau3(procedure) });
}

// Sauvegarde du document en cours (fichier .json à rouvrir plus tard) : utilisée par « Enregistrer » et par le raccourci
// « Créer l'instruction de travail », qui enregistre la procédure avant d'ouvrir l'instruction à sa place.
export function enregistrerJSON() {
  const p = store.lire();
  const nom = String(p.meta.reference || p.meta.titre || "document").replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "") || "document";
  telecharger(store.exporterJSON(), `${nom}.json`, "application/json");
  store.marquerEnregistre(); // v0.22 : le document est maintenant dans un fichier (l'alerte avant de quitter et le repère « non enregistré » s'éteignent)
}

export async function telechargerWord() {
  const octets = await fabriquerWord();
  telecharger(octets, nomDeFichier(store.lire(), "docx"), TYPE_DOCX);
}

// Instruction de travail : le dessin en image PNG (une page A4 portrait, texte net).
export async function telechargerPngIT() {
  const procedure = store.lire();
  const taille = mesurerNiveau3(procedure);
  if (!taille) throw new Error("vide");
  const image = await svgVersPng(dessinerNiveau3(procedure), taille.largeur, taille.hauteur);
  telecharger(image.png, nomDeFichier(procedure, "png"), "image/png");
}

// ----- PDF : on imprime le document seul (le reste de la page est masqué à l'impression) -----
let titreAvantImpression = "";

// Pied de page du PDF : « code · version — titre · page X / Y », centré (marges de page CSS : Chrome et Edge récents).
const texteCss = (texte) => `"${String(texte).replace(/[\\"]/g, "\\$&").replace(/[\n\r]/g, " ")}"`;
function stylePied(pied) {
  const style = document.createElement("style");
  style.id = "style-pied-impression";
  style.textContent = `@page { @bottom-center { content: ${pied ? texteCss(pied + " · ") + " " : ""}counter(page) " / " counter(pages); font: 7.5pt Calibri, Carlito, Arial, sans-serif; color: #4E5A63; } }`;
  return style;
}

export function preparerImpression() {
  const zone = document.getElementById("zone-impression");
  if (!zone) return;
  const procedure = store.lire();
  if (estInstruction(procedure)) {
    zone.replaceChildren(construireFeuilleIT(procedure)); // une page A4 : pas de numéro de page en pied
  } else {
    const feuille = construireFeuille(procedure);
    zone.replaceChildren(feuille, stylePied(feuille.getAttribute("data-pied") || ""));
  }
  titreAvantImpression = document.title;
  document.title = nomDeFichier(procedure, "pdf").replace(/\.pdf$/, ""); // nom proposé pour le PDF
}

window.addEventListener("beforeprint", preparerImpression);
window.addEventListener("afterprint", () => {
  const zone = document.getElementById("zone-impression");
  if (zone) zone.replaceChildren();
  if (titreAvantImpression) document.title = titreAvantImpression;
});

export function imprimerPdf() {
  window.print(); // « beforeprint » prépare le document
}

