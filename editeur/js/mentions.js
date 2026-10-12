// mentions.js — la fenêtre « Mentions et licences » : version d'essai non commerciale, titulaire des droits (si renseigné dans config.js),
// « aide à la rédaction, sans garantie », rapport à la méthode, données de l'utilisateur, composants de tiers et leurs licences.
// Les textes viennent de t() ; tout est posé en texte (jamais de HTML injecté).

import { h } from "./dom.js";
import { t } from "./i18n.js";
import { VERSION } from "./version.js";
import { CONFIG } from "./config.js";
import { EN_LIGNE } from "./en-ligne.js";

const $ = (id) => document.getElementById(id);

// Le titulaire des droits à afficher : "" si config.js n'en donne pas (la ligne n'est alors pas affichée).
export const titulaireAffiche = () => (typeof CONFIG.titulaire === "string" ? CONFIG.titulaire.trim().slice(0, 200) : "");

// L'année de la mention « © année titulaire » : celle de config.js si elle a quatre chiffres, sinon l'année en cours.
export const anneeDroits = () => {
  const brute = String(CONFIG.anneeDroits ?? "").trim();
  return /^\d{4}$/.test(brute) ? brute : String(new Date().getFullYear());
};

// La ligne complète des droits (« © 2026 Prénom Nom — tous droits réservés — version d'essai »), ou "" s'il n'y a pas de titulaire.
export const droitsAffiches = () => {
  const titulaire = titulaireAffiche();
  return titulaire ? t("mentions.droits", { annee: anneeDroits(), titulaire }) : "";
};

const rubrique = (titre, ...contenu) => h("section", { class: "mentions-rubrique" }, h("h3", {}, titre), ...contenu);

export function rendreMentions() {
  const contenu = $("mentions-contenu");
  if (!contenu) return;
  const droits = droitsAffiches();
  contenu.replaceChildren(
    h("p", { class: "mentions-version" }, t("mentions.version", { version: VERSION })),
    rubrique(t("mentions.essai.titre"),
      h("p", {}, t("mentions.essai.texte")),
      droits ? h("p", { class: "mentions-titulaire" }, droits) : null),
    rubrique(t("mentions.aide.titre"), h("p", {}, t("mentions.aide.texte"))),
    rubrique(t("mentions.methode.titre"), h("p", {}, t("mentions.methode.texte"))),
    rubrique(t("mentions.donnees.titre"), h("p", {}, EN_LIGNE ? t("enligne.mentions.donnees") : t("mentions.donnees.texte"))),
    rubrique(t("mentions.licences.titre"),
      h("p", {}, t("mentions.licences.intro")),
      h("ul", {}, h("li", {}, t("mentions.licences.pdfjs")), h("li", {}, t("mentions.licences.police"))),
      h("p", { class: "aide-champ" }, t("mentions.licences.fichier"))));
  $("mentions-titre").textContent = t("mentions.titre");
}

export function ouvrirMentions() {
  const fenetre = $("fenetre-mentions");
  if (!fenetre.open) fenetre.showModal();
  rendreMentions();
}

export function preparerFenetreMentions() {
  $("mentions-fermer").addEventListener("click", () => $("fenetre-mentions").close());
  // Un clic sur le fond (hors de la boîte) referme la fenêtre.
  $("fenetre-mentions").addEventListener("click", (evenement) => { if (evenement.target === evenement.currentTarget) evenement.currentTarget.close(); });
  document.addEventListener("langue-changee", () => { if ($("fenetre-mentions").open) rendreMentions(); });
}
