// i18n.js — internationalisation (FR / EN)
// Principe : le code ne contient JAMAIS de texte visible en dur.
// Il contient des CLÉS (ex. "regle.libelle.trop_long") ; chaque langue a son fichier de textes.
// Ajouter une langue = ajouter un fichier dans js/locales/, sans toucher au reste.

import fr from "./locales/fr.js";
import en from "./locales/en.js";
import { NOM_OUTIL } from "./config.js";

const LANGUES = { fr, en };
let langue = "fr";

export function definirLangue(code) {
  if (LANGUES[code]) langue = code;
  return langue;
}

export function langueCourante() {
  return langue;
}

// t("cle", { n: 7 }) -> le texte de la langue courante, avec {n} remplacé par 7.
// {nom} est toujours disponible : c'est le nom de l'outil (config.js), le seul endroit où il s'écrit.
// Si la clé manque dans la langue courante, on retombe sur le français, puis sur la clé elle-même
// (un texte manquant se voit tout de suite, mais ne casse jamais l'application).
export function t(cle, params = {}) {
  const modele = LANGUES[langue][cle] ?? LANGUES.fr[cle] ?? cle;
  return modele.replace(/\{(\w+)\}/g, (_, nom) => (params[nom] !== undefined ? params[nom] : nom === "nom" ? NOM_OUTIL : `{${nom}}`));
}

// Écrit un nombre avec la virgule décimale en français (5,8) et le point en anglais (5.8).
export function nombre(n) {
  return langue === "fr" ? String(n).replace(".", ",") : String(n);
}
