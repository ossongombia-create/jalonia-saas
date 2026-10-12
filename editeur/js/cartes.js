// cartes.js — les petites briques visuelles de l'interface : la CARTE (un panneau blanc arrondi avec son titre et son icône)
// et les couleurs des rôles. Aucun texte saisi n'y passe autrement que par h() (jamais innerHTML).

import { h } from "./dom.js";
import { icone } from "./icones.js";

// Couleur d'un rôle = sa colonne dans le logigramme (6 rôles au maximum). Le point de couleur aide à les reconnaître d'un coup d'œil.
export const COULEURS_ROLES = ["#005a70", "#6f5091", "#2a9d8f", "#c9772b", "#b0457a", "#5f7b94"];
export const couleurRole = (i) => COULEURS_ROLES[((i % COULEURS_ROLES.length) + COULEURS_ROLES.length) % COULEURS_ROLES.length];

// Le point de couleur d'un rôle.
export function pointRole(i) {
  return h("span", { class: "point-role", style: `background:${couleurRole(i)}`, "aria-hidden": "true" });
}

// L'en-tête d'une carte : pastille avec l'icône, titre, puis (facultatif) un compteur et des actions à droite.
export function enteteCarte(nomIcone, titre, { compteur = null, actions = [] } = {}) {
  return h("div", { class: "carte-entete" },
    h("span", { class: "pastille-titre" }, icone(nomIcone, 18)),
    h("h3", {}, titre),
    compteur !== null ? h("span", { class: "compteur" }, String(compteur)) : null,
    actions.length ? h("div", { class: "carte-actions" }, ...actions) : null);
}

// Une carte : carte("id", "Le document", champ1, champ2…) ; classe et options en dernier recours via carteAvec().
export function carte(nomIcone, titre, ...contenu) {
  return h("section", { class: "carte" }, enteteCarte(nomIcone, titre), ...contenu);
}
export function carteAvec(options, nomIcone, titre, ...contenu) {
  const { classe = "", ...entete } = options;
  return h("section", { class: ("carte " + classe).trim() }, enteteCarte(nomIcone, titre, entete), ...contenu);
}
