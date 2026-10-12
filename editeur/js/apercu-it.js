// apercu-it.js — la « feuille » d'une INSTRUCTION DE TRAVAIL : une page A4 portrait qui contient le dessin (en-tête, rôle, trois colonnes,
// légende). Sert à l'impression (PDF). Le document Word / PDF complet de l'instruction viendra dans une version suivante ;
// le dessin de render3.js est déjà celui du livre : en-tête compris, il n'y a rien à ajouter autour.

import { h } from "./dom.js";
import { t } from "./i18n.js";
import { dessinerNiveau3, disposerNiveau3 } from "./render3.js";

export function construireFeuilleIT(procedure) {
  const d = disposerNiveau3(procedure);
  const zone = h("div", { class: "logigramme-apercu", role: "img", "aria-label": t("zone.instruction") });
  if (d) zone.style.setProperty("--largeur-dessin", `${Math.round(d.largeur)}px`);
  zone.innerHTML = dessinerNiveau3(procedure); // SVG produit par render3.js : tous les textes y sont échappés
  return h("div", { class: "feuille feuille-it" }, zone);
}
