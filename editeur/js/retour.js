// retour.js — la fenêtre « Envoyer un retour » de la version d'essai : rappelle qu'il s'agit d'une version d'essai, prépare les informations
// techniques à joindre (version, navigateur, écran, langue, type de document, nombre de constats — jamais le texte du document),
// et propose le formulaire de retours et / ou l'e-mail réglés dans config.js. Rien n'est envoyé automatiquement.
// Les textes viennent de t() ; tout est posé avec .textContent / .value (jamais de HTML injecté).

import { h } from "./dom.js";
import { t, langueCourante } from "./i18n.js";
import { VERSION } from "./version.js";
import { CONFIG } from "./config.js";
import * as store from "./store.js";
import { constatsDiagnostic } from "./diagnostic.js";

const $ = (id) => document.getElementById(id);

// ---------- Fonctions pures (testées) ----------

// « Chrome 141 », « Edge 141 », « Firefox 133 », « Safari 17 » d'après l'identifiant du navigateur ; « ? » si on ne sait pas.
export function nomNavigateur(ua = "") {
  const cherche = (motif) => { const m = String(ua).match(motif); return m ? m[1].split(".")[0] : ""; };
  let v = cherche(/\bEdg(?:e|A|iOS)?\/([\d.]+)/);
  if (v) return "Edge " + v;
  v = cherche(/\bOPR\/([\d.]+)/);
  if (v) return "Opera " + v;
  v = cherche(/\b(?:Firefox|FxiOS)\/([\d.]+)/);
  if (v) return "Firefox " + v;
  v = cherche(/(?:Chrome|CriOS)\/([\d.]+)/);
  if (v) return "Chrome " + v;
  v = cherche(/\bVersion\/([\d.]+).*Safari\//);
  if (v) return "Safari " + v;
  return "?";
}

// « Windows », « macOS », « Android », « iOS », « Linux » ; « ? » si on ne sait pas.
export function nomSysteme(ua = "") {
  const s = String(ua);
  if (/Android/i.test(s)) return "Android";
  if (/iPhone|iPad|iPod/i.test(s)) return "iOS";
  if (/Windows/i.test(s)) return "Windows";
  if (/Mac OS X|Macintosh/i.test(s)) return "macOS";
  if (/Linux|X11/i.test(s)) return "Linux";
  return "?";
}

// Une adresse de formulaire n'est reprise que si elle commence par https:// (pas de javascript:, pas de http:).
export function adresseFormulaire(url) {
  const brut = String(url || "").trim();
  if (!/^https:\/\/[^\s]+$/i.test(brut)) return "";
  try { return new URL(brut).href; } catch (e) { return ""; }
}

export function adresseEmail(email) {
  const brut = String(email || "").trim();
  // Pas de ? & = # % / dans l'adresse : elle ne doit pas pouvoir ajouter un destinataire ou un champ au lien mailto:.
  return /^[^\s@<>"',;:()?&=#%/\\]+@[^\s@<>"',;:()?&=#%/\\]+\.[^\s@<>"',;:()?&=#%/\\]+$/.test(brut) ? brut : "";
}

// Le lien « Écrire par e-mail » : objet et corps préparés (les informations techniques y sont jointes).
export function lienEmail(email, sujet, corps) {
  const adresse = adresseEmail(email);
  if (!adresse) return "";
  return `mailto:${adresse}?subject=${encodeURIComponent(sujet)}&body=${encodeURIComponent(corps)}`;
}

// Les lignes « Étiquette : valeur » à joindre à un retour. Aucun texte du document n'y figure.
export function lignesInformations({ typeDocument = "", erreurs = 0, alertes = 0, ua = "", ecran = "", langue = "fr" } = {}) {
  const doc = typeDocument === "procedure" || typeDocument === "instruction" ? t("retour.doc." + typeDocument) : t("retour.doc.aucun");
  return [
    [t("retour.info.version"), "v" + VERSION],
    [t("retour.info.navigateur"), `${nomNavigateur(ua)} (${nomSysteme(ua)})`],
    [t("retour.info.ecran"), ecran || "?"],
    [t("retour.info.langue"), langue],
    [t("retour.info.document"), doc],
    [t("retour.info.constats"), t("retour.constats", { erreurs, alertes })],
  ];
}

export const texteInformations = (donnees) => lignesInformations(donnees).map(([nom, valeur]) => `${nom} : ${valeur}`).join("\n");

// ---------- La fenêtre ----------
export function donneesCourantes() {
  const constats = constatsDiagnostic(store.lire()).filter((c) => c.gravite !== "ok");
  return {
    typeDocument: store.lire().meta.typeDocument,
    erreurs: constats.filter((c) => c.gravite === "erreur").length,
    alertes: constats.filter((c) => c.gravite === "alerte").length,
    ua: typeof navigator !== "undefined" ? navigator.userAgent : "",
    ecran: typeof window !== "undefined" ? `${window.innerWidth} × ${window.innerHeight}` : "",
    langue: langueCourante(),
  };
}

async function copier(texte, zone, message) {
  let reussi = false;
  try {
    await navigator.clipboard.writeText(texte);
    reussi = true;
  } catch (e) {
    zone.focus();
    zone.select();
    try { reussi = document.execCommand("copy"); } catch (e2) { reussi = false; }
  }
  message.textContent = t(reussi ? "retour.copie" : "retour.copie_impossible");
}

export function rendreRetour() {
  const contenu = $("retour-contenu");
  if (!contenu) return;
  const donnees = donneesCourantes();
  const texte = texteInformations(donnees);
  const zone = h("textarea", { id: "retour-infos", readonly: true, rows: String(lignesInformations(donnees).length), "aria-label": t("retour.infos.titre") });
  zone.value = texte;
  zone.addEventListener("focus", () => zone.select());
  const message = h("span", { class: "retour-copie", role: "status", "aria-live": "polite" });
  const url = adresseFormulaire(CONFIG.urlRetours);
  const mail = lienEmail(CONFIG.emailRetours, t("retour.email_sujet", { version: VERSION }), texte);
  const actions = [
    url && h("a", { class: "bouton-plein", href: url, target: "_blank", rel: "noopener noreferrer" }, t("retour.formulaire")),
    mail && h("a", { class: "bouton-pilule", href: mail }, t("retour.email")),
  ];
  contenu.replaceChildren(
    h("p", { class: "retour-essai" }, t("retour.mention")),
    h("p", {}, t("retour.intro")),
    h("h3", {}, t("retour.infos.titre")),
    h("p", { class: "aide-champ" }, t("retour.infos.aide")),
    zone,
    h("div", { class: "retour-ligne" },
      h("button", { type: "button", class: "bouton-pilule", id: "retour-copier", onclick: () => copier(texte, zone, message) }, t("retour.copier")),
      message),
    h("div", { class: "retour-ligne" }, ...actions.filter(Boolean)),
    !url && !mail ? h("p", { class: "aide alerte-douce", id: "retour-pas-configure" }, t("retour.pas_configure")) : null,
    h("p", { class: "aide-champ" }, t("retour.confidentialite")),
    h("p", {}, h("a", { href: "guide-" + langueCourante() + ".html", target: "_blank", rel: "noopener" }, t("retour.guide"))),
  );
  $("retour-titre").textContent = t("retour.titre");
}

export function ouvrirRetour() {
  const fenetre = $("fenetre-retour");
  if (!fenetre.open) fenetre.showModal();
  rendreRetour();
}

export function preparerFenetreRetour() {
  $("retour-fermer").addEventListener("click", () => $("fenetre-retour").close());
  // Un clic sur le fond (hors de la boîte) referme la fenêtre.
  $("fenetre-retour").addEventListener("click", (evenement) => { if (evenement.target === evenement.currentTarget) evenement.currentTarget.close(); });
  document.addEventListener("langue-changee", () => { if ($("fenetre-retour").open) rendreRetour(); });
}
