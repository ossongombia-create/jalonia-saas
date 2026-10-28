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
  return h("div", { class: "feuille feuille-it" }, zone, modeOperatoire(procedure));
}

// « Comment ? » des opérations (v1.9) : tableau « Mode opératoire » sous le logigramme, seulement s'il y en a un de renseigné.
function modeOperatoire(procedure) {
  const ops = (procedure.it && procedure.it.operations) || [];
  if (!ops.some((o) => (o.commentaire || "").trim())) return null;
  return h("section", { class: "mode-operatoire" },
    h("h4", {}, t("it.mode_operatoire")),
    h("table", { class: "tab-apercu tab-mode-operatoire" },
      h("thead", {}, h("tr", {}, h("th", { class: "c" }, t("it.mode_operatoire.n")), h("th", {}, t("it.mode_operatoire.operation")), h("th", {}, t("it.mode_operatoire.comment")))),
      h("tbody", {}, ...ops.map((o, i) => (o.commentaire || "").trim()
        ? h("tr", {}, h("td", { class: "c" }, String(i + 1)), h("td", {}, o.libelle), h("td", {}, o.commentaire))
        : null).filter(Boolean))));
}
