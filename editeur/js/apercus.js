// apercus.js — les APERÇUS à la demande : une fenêtre qui montre le logigramme (bouton « Aperçu logigramme » de l'étape 2)
// ou le document (bouton « Aperçu document » de l'étape 3). La page de saisie occupe toute la largeur ; l'aperçu ne se calcule
// que quand la fenêtre est ouverte, et il se met à jour à chaque modification tant qu'elle reste ouverte.

import * as store from "./store.js";
import { t, nombre } from "./i18n.js";
import { dessinerNiveau2, disposerNiveau2, taillePointsSurA4, croisementsNiveau2 } from "./render.js";
import { rendreApercu } from "./apercu.js";
import { dessinerNiveau3, taillePointsNiveau3, croisementsNiveau3 } from "./render3.js";
import { estInstruction } from "./parcours.js";

const $ = (id) => document.getElementById(id);
let ouvert = null; // "dessin" | "document" | null

export function apercuOuvert() {
  return ouvert;
}

export function ouvrirApercu(type) {
  if (type !== "dessin" && type !== "document") return;
  const fenetre = $("fenetre-apercu");
  if (!fenetre) return;
  ouvert = estInstruction(store.lire()) ? "dessin" : type; // une instruction de travail n'a, pour l'instant, que son dessin à apercevoir
  actualiserApercu();
  if (!fenetre.open) fenetre.showModal();
  const corps = fenetre.querySelector(".apercu-corps");
  if (corps) corps.scrollTop = 0;
}

export function fermerApercu() {
  const fenetre = $("fenetre-apercu");
  if (fenetre && fenetre.open) fenetre.close();
  ouvert = null;
}

// Redessine l'aperçu ouvert (ne fait rien si la fenêtre est fermée).
export function actualiserApercu() {
  if (!ouvert) return;
  const procedure = store.lire();
  $("zone-dessin").hidden = ouvert !== "dessin";
  $("apercu-document").hidden = ouvert !== "document";
  const it = estInstruction(procedure);
  $("apercu-titre").textContent = t(ouvert === "dessin" ? (it ? "zone.instruction" : "zone.dessin") : "zone.apercu");
  if (ouvert === "dessin" && it) {
    const zone = $("zone-dessin");
    zone.innerHTML = dessinerNiveau3(procedure);
    const svg = zone.querySelector("svg");
    if (svg) {
      svg.style.width = "100%";
      svg.style.height = "auto";
      svg.style.maxWidth = "820px";
      svg.style.display = "block";
      svg.style.margin = "0 auto";
    }
    const pt = taillePointsNiveau3(procedure);
    const morceaux = [t("apercu.orientation.portrait")];
    if (pt !== null) morceaux.push(t("apercu.texte_pt", { pt: nombre(pt) }));
    const croisements = croisementsNiveau3(procedure);
    if (croisements > 0) morceaux.push(t("apercu.croisements", { n: croisements }));
    $("apercu-info").textContent = morceaux.join(" · ");
  } else if (ouvert === "dessin") {
    const zone = $("zone-dessin");
    zone.innerHTML = dessinerNiveau2(procedure);
    // Le dessin occupe la largeur de la fenêtre (jusqu'à 1,4 fois sa taille naturelle, pour rester net).
    const svg = zone.querySelector("svg");
    if (svg) {
      const largeur = Number(svg.getAttribute("width")) || 0;
      svg.style.width = "100%";
      svg.style.height = "auto";
      if (largeur) svg.style.maxWidth = Math.round(largeur * 1.4) + "px";
    }
    const d = disposerNiveau2(procedure);
    const pt = taillePointsSurA4(procedure);
    const morceaux = [];
    if (d) morceaux.push(t("apercu.orientation." + d.orientation));
    if (pt !== null) morceaux.push(t("apercu.texte_pt", { pt: nombre(pt) }));
    const croisements = croisementsNiveau2(procedure);
    if (croisements > 0) morceaux.push(t("apercu.croisements", { n: croisements }));
    $("apercu-info").textContent = morceaux.join(" · ");
  } else {
    rendreApercu($("apercu-document"), procedure);
    $("apercu-info").textContent = "";
  }
}

// Fermer : bouton, touche Échap (natif), clic à côté de la fenêtre.
const fenetre = $("fenetre-apercu");
if (fenetre) {
  fenetre.addEventListener("close", () => { ouvert = null; });
  fenetre.addEventListener("click", (evenement) => {
    if (evenement.target === fenetre) fermerApercu();
  });
  $("apercu-fermer").addEventListener("click", fermerApercu);
}
