// cartographie-ui.js — l'écran « Cartographie des processus » : une fenêtre où l'on voit, saisit et corrige les processus, leurs échanges
// et le registre des codes. Chaque organisation y met la sienne : import d'un PDF, fichier .json ou saisie (l'exemple sert à essayer).
// Les textes viennent de t() ; tout ce qui est saisi ou lu dans un PDF est posé avec .value / .textContent (jamais innerHTML).

import { h } from "./dom.js";
import { t } from "./i18n.js";
import * as cs from "./cartographie-store.js";
import * as store from "./store.js";
import { champ, ajusterToutes } from "./formulaire.js";
import { icone } from "./icones.js";
import {
  CATEGORIES, EXTREMITES, FICHE_CHAMPS, FORMAT_CODE_LIBRE, FORMAT_CODE_PROCESSUS, analyserCode, codeTypeDuDocument, ficheProcessus, libelleProcessus, nomenclatureActive, processusParCategorie, documentParCode,
} from "./cartographie.js";
import { importerPdf } from "./cartographie-pdf.js";
import { svgCartographie } from "./carto-dessin.js";
import { construireDocxCarto } from "./exportDocx.js";
import { BIBLIOTHEQUE } from "./carto-bibliotheque.js";
import { EN_LIGNE } from "./en-ligne.js";

const $ = (id) => document.getElementById(id);
const TAILLE_MAX_PDF = 10_000_000;
let rapport = []; // ce que la dernière lecture de PDF a compris (affiché en haut de la fenêtre)
let focusApres = null; // l'élément à sélectionner après un redessin (ex. le code du processus qu'on vient d'ajouter)
let apercu = false; // l'aperçu dessiné de la cartographie est-il ouvert ?
let modeles = false; // la bibliothèque de modèles est-elle ouverte ?
// En ligne, en lecture seule (rôle sans droit de modifier la cartographie) : on n'affiche pas ce qui modifierait la cartographie.
const ecriture = () => !cs.estVerrouillee();

export function ouvrirCartographie() {
  const fenetre = $("fenetre-carto");
  if (!fenetre.open) fenetre.showModal();
  rendre();
}

function telecharger(contenu, nom, type) {
  const lien = document.createElement("a");
  lien.href = URL.createObjectURL(new Blob([contenu], { type }));
  lien.download = nom;
  document.body.appendChild(lien);
  lien.click();
  lien.remove();
  setTimeout(() => URL.revokeObjectURL(lien.href), 2000);
}

// ---------- Actions de la barre du haut ----------
// Une seule cartographie par organisation (TC-09) : importer un PDF, ouvrir un fichier, charger l'exemple ou un modèle
// ne remplacent pas une cartographie existante. Pour en mettre une autre, on efface d'abord celle-ci (« Tout effacer »).
function cartographieExiste() {
  if (cs.estVideMaintenant()) return false;
  rapport = [{ gravite: "erreur", cle: "carto.existe_deja" }];
  rendre();
  return true;
}

async function lirePdf(fichier) {
  if (!fichier) return;
  if (fichier.size > TAILLE_MAX_PDF || !/\.pdf$/i.test(fichier.name)) {
    rapport = [{ gravite: "erreur", cle: "carto.import.fichier_refuse" }];
    rendre();
    return;
  }
  if (cartographieExiste()) return;
  try {
    const resultat = await importerPdf(await fichier.arrayBuffer());
    rapport = resultat.rapport;
    if (resultat.cartographie.processus.length > 0) cs.remplacer(resultat.cartographie);
  } catch (e) {
    rapport = [{ gravite: "erreur", cle: "carto.import.illisible" }];
  }
  rendre();
}

function lireJson(fichier) {
  if (!fichier) return;
  if (fichier.size > 2_000_000) { rapport = [{ gravite: "erreur", cle: "carto.import.fichier_refuse" }]; rendre(); return; }
  if (cartographieExiste()) return;
  const lecteur = new FileReader();
  lecteur.onload = () => {
    try {
      const c = cs.importerJSON(String(lecteur.result));
      rapport = [{ gravite: "ok", cle: "carto.import.resume", params: { processus: c.processus.length, flux: c.flux.length } }];
    } catch (e) {
      rapport = [{ gravite: "erreur", cle: "carto.import.json_illisible" }];
    }
    rendre();
  };
  lecteur.readAsText(fichier);
}

function enregistrer() {
  const c = cs.lire();
  const base = (c.organisation || "cartographie").replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "cartographie";
  telecharger(cs.exporterJSON(), `cartographie-${base}.json`, "application/json");
}

function barreActions() {
  const pdf = h("input", { type: "file", accept: ".pdf,application/pdf", hidden: true });
  pdf.addEventListener("change", () => { const f = pdf.files[0]; pdf.value = ""; lirePdf(f); });
  const json = h("input", { type: "file", accept: ".json,application/json", hidden: true });
  json.addEventListener("change", () => { const f = json.files[0]; json.value = ""; lireJson(f); });
  const vide = cs.estVideMaintenant();
  const modif = ecriture();
  // En ligne, la cartographie s'enregistre toute seule sur le serveur : ce bouton en télécharge une copie (fichier .json).
  return h("div", { class: "carto-actions" },
    modif ? h("button", { type: "button", class: vide ? "primaire" : "", onclick: () => { if (!cartographieExiste()) pdf.click(); } }, icone("upload", 17), t("carto.importer_pdf")) : null,
    modif ? h("button", { type: "button", onclick: () => { if (!cartographieExiste()) json.click(); } }, icone("folder", 17), t("carto.ouvrir")) : null,
    h("button", { type: "button", disabled: vide, onclick: enregistrer }, icone("save", 17), EN_LIGNE ? t("enligne.copie_carto") : t("carto.enregistrer")),
    h("button", { type: "button", disabled: vide, class: apercu ? "primaire" : "", onclick: () => { apercu = !apercu; rendre(); } }, icone("carto", 17), t("carto.voir")),
    h("button", { type: "button", disabled: vide, onclick: genererWordNiveau1 }, icone("word", 17), t("carto.generer_word")),
    modif ? h("button", { type: "button", class: modeles ? "primaire" : "", onclick: () => { modeles = !modeles; rendre(); } }, icone("layers", 17), t("carto.modeles")) : null,
    modif ? h("button", { type: "button", onclick: () => { if (!cartographieExiste()) { rapport = []; cs.chargerExemple(); rendre(); } } }, icone("doc", 17), t("carto.exemple")) : null,
    modif ? h("button", { type: "button", class: "suppr", disabled: vide, onclick: () => { if (confirm(t("carto.confirmer_vider"))) { rapport = []; cs.vider(); rendre(); } } }, icone("trash", 17), t("carto.vider")) : null,
    pdf, json);
}

// Nom de fichier à partir du nom de l'organisation.
function baseNom(c) {
  return (c.organisation || "cartographie").replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "cartographie";
}

// Exporte le SVG de la cartographie en PNG (rasterisé à 2× via un canvas).
function telechargerPng(svg, base) {
  let node;
  try { node = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement; } catch (e) { return; }
  const w = Number(node.getAttribute("width")) || 1600;
  const hh = Number(node.getAttribute("height")) || 900;
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  const img = new Image();
  img.onload = () => {
    const cv = document.createElement("canvas");
    cv.width = w * 2; cv.height = hh * 2;
    const ctx = cv.getContext("2d");
    ctx.scale(2, 2); ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, w, hh); ctx.drawImage(img, 0, 0, w, hh);
    URL.revokeObjectURL(url);
    cv.toBlob((b) => { if (b) telecharger(b, `cartographie-${base}.png`, "image/png"); }, "image/png");
  };
  img.onerror = () => URL.revokeObjectURL(url);
  img.src = url;
}

// Rend la cartographie en PNG (bytes) pour l'insérer dans le document Word. Résout { bytes, w, h } (canvas à l'échelle 2) ou { bytes: null }.
function cartoVersPng(c) {
  return new Promise((resolve) => {
    const svg = svgCartographie(c);
    let node;
    try { node = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement; } catch (e) { resolve({ bytes: null, w: 0, h: 0 }); return; }
    const w = Number(node.getAttribute("width")) || 1600, h = Number(node.getAttribute("height")) || 900;
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement("canvas");
      cv.width = w * 2; cv.height = h * 2;
      const ctx = cv.getContext("2d");
      ctx.scale(2, 2); ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, w, h); ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      cv.toBlob(async (b) => {
        if (!b) { resolve({ bytes: null, w: 0, h: 0 }); return; }
        resolve({ bytes: new Uint8Array(await b.arrayBuffer()), w: cv.width, h: cv.height });
      }, "image/png");
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve({ bytes: null, w: 0, h: 0 }); };
    img.src = url;
  });
}

// Génère le document Word de NIVEAU 1 : la cartographie (en image) + le sommaire + une fiche par processus.
async function genererWordNiveau1() {
  const c = cs.lire();
  if (cs.estVideMaintenant()) return;
  const png = await cartoVersPng(c);
  const octets = construireDocxCarto(c, { png: png.bytes, largeurPng: png.w, hauteurPng: png.h, echellePng: 2 });
  telecharger(octets, `cartographie-niveau1-${baseNom(c)}.docx`, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
}

// La bibliothèque de modèles : 50 cartographies de départ par secteur. Choisir en charge une (remplace la saisie en cours).
function blocModeles() {
  if (!modeles || !ecriture()) return null;
  return h("section", { class: "carte carto-modeles" },
    h("div", { class: "carte-entete" },
      h("h3", {}, t("carto.modeles.titre")),
      h("button", { type: "button", onclick: () => { modeles = false; rendre(); } }, t("import.fermer"))),
    h("p", { class: "aide" }, t("carto.modeles.aide")),
    h("ul", { class: "carto-modeles-liste" }, ...BIBLIOTHEQUE.map((m) =>
      h("li", {},
        h("span", { class: "carto-modeles-nom" }, m.organisation),
        h("button", { type: "button", onclick: () => {
          if (!cartographieExiste()) { cs.remplacer(m); rapport = []; modeles = false; apercu = true; rendre(); }
        } }, t("carto.modeles.charger"))))));
}

// L'aperçu dessiné de la cartographie (style 09) + les boutons d'export. Le SVG est construit par carto-dessin.js (texte échappé).
function blocApercu(c) {
  if (!apercu || cs.estVideMaintenant()) return null;
  const svg = svgCartographie(c);
  const vue = h("div", { class: "carto-apercu-vue" });
  try {
    const node = document.importNode(new DOMParser().parseFromString(svg, "image/svg+xml").documentElement, true);
    node.removeAttribute("width"); node.removeAttribute("height");
    node.setAttribute("style", "width:100%;height:auto");
    vue.appendChild(node);
  } catch (e) { /* aperçu indisponible : on laisse la vue vide */ }
  const base = baseNom(c);
  return h("section", { class: "carte carto-apercu" },
    h("div", { class: "carte-entete" },
      h("h3", {}, t("carto.apercu.titre")),
      h("div", { class: "carto-apercu-actions" },
        h("button", { type: "button", onclick: () => telecharger(svg, `cartographie-${base}.svg`, "image/svg+xml") }, icone("dl", 16), t("carto.telecharger_svg")),
        h("button", { type: "button", onclick: () => telechargerPng(svg, base) }, icone("dl", 16), t("carto.telecharger_png")),
        h("button", { type: "button", onclick: () => { apercu = false; rendre(); } }, t("import.fermer")))),
    h("p", { class: "aide" }, t("carto.apercu.aide")),
    vue);
}

function blocRapport() {
  if (rapport.length === 0) return null;
  return h("aside", { class: "carto-rapport" },
    h("h3", {}, t("carto.rapport.titre")),
    h("ul", {}, ...rapport.map((c) => h("li", { class: c.gravite }, t(c.cle, c.params)))),
    h("button", { type: "button", onclick: () => { rapport = []; rendre(); } }, t("import.fermer")));
}

// ---------- Cartes ----------
function carteOrganisation(c) {
  const modifier = (cle) => (v) => cs.modifierChamp(cle, v);
  return h("section", { class: "carte" },
    h("div", { class: "carte-entete" }, h("h3", {}, t("carto.organisation"))),
    h("div", { class: "grille g2" },
      champ(t("carto.organisation.nom"), c.organisation, modifier("organisation"), { placeholder: t("form.organisation.ph") }),
      champ(t("carto.titre_champ"), c.titre, modifier("titre"))),
    champ(t("carto.contexte"), c.contexte, modifier("contexte")),
    h("div", { class: "grille g2" },
      champ(t("carto.exigences"), c.exigences, modifier("exigences")),
      champ(t("carto.satisfaction"), c.satisfaction, modifier("satisfaction"))));
}

function messageCode(c, p) {
  if (!p.code) return "carto.processus.code.vide";
  if (!FORMAT_CODE_PROCESSUS.test(p.code)) return "carto.processus.code.invalide";
  if (c.processus.some((x) => x !== p && x.code === p.code)) return "carto.processus.code.double";
  return null;
}

function ligneProcessus(c, p) {
  const code = h("input", { type: "text", class: "code-court", maxlength: "5", value: p.code, "aria-label": t("carto.processus.code"), placeholder: "ACH", spellcheck: "false", autocapitalize: "characters", "data-focus": p.id });
  const indice = h("small", { class: "indice-erreur" });
  const verifier = () => {
    const cle = messageCode(cs.lire(), p);
    indice.textContent = cle && p.code ? t(cle) : "";
    code.classList.toggle("invalide", Boolean(cle && p.code));
  };
  code.addEventListener("input", () => {
    cs.modifierProcessus(p.id, "code", code.value);
    code.value = p.code;
    verifier();
  });
  verifier();
  const categorie = h("select", { "aria-label": t("carto.processus.categorie") },
    h("option", { value: "" }, t("carto.categorie.aucune")),
    ...CATEGORIES.map((k) => h("option", { value: k, selected: p.categorie === k }, t("carto.categorie." + k))));
  categorie.addEventListener("change", () => cs.modifierProcessus(p.id, "categorie", categorie.value));
  return h("div", { class: "ligne-carto processus" },
    h("div", {}, code, indice),
    champ(t("carto.processus.nom"), p.nom, (v) => cs.modifierProcessus(p.id, "nom", v), { placeholder: t("carto.processus.nom.ph") }),
    categorie,
    ecriture() ? h("button", { type: "button", class: "suppr", "aria-label": t("form.supprimer"), title: t("form.supprimer"), onclick: () => cs.supprimerProcessus(p.id) }, icone("trash", 17)) : null);
}

function carteProcessus(c) {
  const groupes = processusParCategorie(c);
  return h("section", { class: "carte" },
    h("div", { class: "carte-entete" }, h("h3", {}, t("carto.processus")), h("span", { class: "compteur" }, String(c.processus.length))),
    h("p", { class: "aide" }, t("carto.processus.aide")),
    ...groupes.map((g) => h("div", { class: "groupe-carto" },
      h("h4", {}, t(g.categorie ? "carto.categorie." + g.categorie : "carto.categorie.aucune")),
      ...g.processus.map((p) => ligneProcessus(c, p)))),
    ecriture() ? h("div", {}, h("button", { type: "button", onclick: () => { const id = cs.ajouterProcessus(); if (id) focusApres = id; } }, icone("plus", 16, 2.2), t("carto.processus.ajouter"))) : null);
}

// Les extrémités possibles d'un échange : un processus, un bloc (management, réalisation, support, vérification) ou l'extérieur de la cartographie.
function optionsPoints(c, valeur) {
  const groupe = (libelle, options) => h("optgroup", { label: libelle }, ...options);
  return [
    h("option", { value: "" }, t("form.choisir")),
    groupe(t("carto.processus"), c.processus.map((p) => h("option", { value: p.id, selected: valeur === p.id }, libelleProcessus(p)))),
    groupe(t("carto.blocs"), CATEGORIES.map((k) => h("option", { value: k, selected: valeur === k }, t("carto.point." + k)))),
    groupe(t("carto.exterieur"), EXTREMITES.map((k) => h("option", { value: k, selected: valeur === k }, t("carto.point." + k)))),
  ];
}

function ligneFlux(c, f) {
  const de = h("select", { "aria-label": t("carto.flux.de") }, ...optionsPoints(c, f.de));
  de.addEventListener("change", () => cs.modifierFlux(f.id, "de", de.value));
  const vers = h("select", { "aria-label": t("carto.flux.vers") }, ...optionsPoints(c, f.vers));
  vers.addEventListener("change", () => cs.modifierFlux(f.id, "vers", vers.value));
  const double = h("input", { type: "checkbox", checked: f.double, "aria-label": t("carto.flux.double") });
  double.addEventListener("change", () => cs.modifierFlux(f.id, "double", double.checked));
  return h("div", { class: "ligne-carto flux" },
    h("div", {}, de),
    h("span", { class: "sens", title: t("carto.flux.double") }, f.double ? "⇄" : "→"),
    h("div", {}, vers),
    champ(t("carto.flux.information"), f.information, (v) => cs.modifierFlux(f.id, "information", v), { placeholder: t("carto.flux.information.ph") }),
    h("label", { class: "case-double", title: t("carto.flux.double") }, double, h("span", {}, "⇄")),
    ecriture() ? h("button", { type: "button", class: "suppr", "aria-label": t("form.supprimer"), title: t("form.supprimer"), onclick: () => cs.supprimerFlux(f.id) }, icone("trash", 17)) : null);
}

function carteFlux(c) {
  return h("section", { class: "carte" },
    h("div", { class: "carte-entete" }, h("h3", {}, t("carto.flux")), h("span", { class: "compteur" }, String(c.flux.length))),
    h("p", { class: "aide" }, t("carto.flux.aide")),
    ...c.flux.map((f) => ligneFlux(c, f)),
    ecriture() ? h("div", {}, h("button", { type: "button", disabled: c.processus.length === 0, onclick: () => { const id = cs.ajouterFlux(); if (id) focusApres = id; } }, icone("plus", 16, 2.2), t("carto.flux.ajouter"))) : null);
}

// ---------- Fiches d'identité des processus (contenu qualitatif du document niveau 1) ----------
// Chaque processus ayant un code valide reçoit une fiche repliable : finalité, pilote, ressources, risques, exigences.
// Ce qui est saisi ici remplit le document Word ; les exemples (placeholders) guident, et un bouton les insère dans les champs vides.
const EXEMPLE_FICHE = {
  finalite: (p) => t("carto.fiche.finalite.ex." + (p.categorie || "aucune")),
  pilote: () => t("carto.fiche.pilote.ex"),
  ressources: () => sansPrefixeExemple(t("carto.fiche.ressources.ph")),
  risques: () => sansPrefixeExemple(t("carto.fiche.risques.ph")),
  exigences: () => sansPrefixeExemple(t("carto.fiche.exigences.ph")),
};
const LABEL_FICHE = { finalite: "carto.fiche.finalite", pilote: "carto.fiche.pilote", ressources: "carto.fiche.ressources", risques: "carto.fiche.risques_opp", exigences: "carto.fiche.exigences" };
const PLACEHOLDER_FICHE = { finalite: (p) => t("carto.fiche.finalite.ex." + (p.categorie || "aucune")), pilote: () => t("carto.fiche.pilote.ph"), ressources: () => t("carto.fiche.ressources.ph"), risques: () => t("carto.fiche.risques.ph"), exigences: () => t("carto.fiche.exigences.ph") };
const sansPrefixeExemple = (s) => s.replace(/^\s*(ex\.|e\.g\.)\s*/i, "");

function blocFiche(c, p) {
  const f = ficheProcessus(c, p.code);
  const rempli = FICHE_CHAMPS.some((k) => (f[k] || "").trim());
  const champs = FICHE_CHAMPS.map((k) => champ(t(LABEL_FICHE[k]), f[k] || "", (v) => cs.modifierFiche(p.code, k, v), { placeholder: PLACEHOLDER_FICHE[k](p), large: k !== "pilote" }));
  const inserer = h("button", { type: "button", class: "mini", title: t("carto.fiches.inserer.titre"), onclick: () => {
    const fiche = ficheProcessus(cs.lire(), p.code);
    FICHE_CHAMPS.forEach((k) => { if (!(fiche[k] || "").trim()) cs.modifierFiche(p.code, k, EXEMPLE_FICHE[k](p)); });
    rendre();
  } }, icone("plus", 15, 2.2), t("carto.fiches.inserer"));
  return h("details", { class: "carto-fiche" + (rempli ? " remplie" : ""), open: false },
    h("summary", {},
      h("span", { class: "carto-fiche-titre" }, libelleProcessus(p)),
      h("span", { class: "carto-fiche-bloc" }, p.categorie ? t("carto.categorie." + p.categorie) : t("carto.categorie.aucune")),
      rempli ? h("span", { class: "carto-fiche-ok", title: t("carto.fiches") }, icone("check", 15)) : null),
    ...champs,
    ecriture() ? h("div", { class: "boutons-ligne" }, inserer) : null);
}

function carteFiches(c) {
  const eligibles = c.processus.filter((p) => messageCode(c, p) === null);
  return h("section", { class: "carte" },
    h("div", { class: "carte-entete" }, h("h3", {}, t("carto.fiches")), h("span", { class: "compteur" }, String(eligibles.length))),
    h("p", { class: "aide" }, t("carto.fiches.aide")),
    eligibles.length ? h("div", { class: "carto-fiches" }, ...eligibles.map((p) => blocFiche(c, p))) : h("p", { class: "aide carto-vide" }, t("carto.fiches.vide")));
}

function messageDocument(c, d) {
  if (!d.code) return null;
  if (!FORMAT_CODE_LIBRE.test(d.code)) return "carto.documents.code.invalide";
  if (c.documents.some((x) => x !== d && x.code === d.code)) return "carto.documents.code.double";
  if (nomenclatureActive(c)) {
    const a = analyserCode(d.code);
    if (!a) return "carto.documents.code.nomenclature";
    if (!c.processus.some((p) => p.code === a.processus)) return "carto.documents.processus_inconnu";
  }
  return null;
}

function ligneDocument(c, d) {
  const code = h("input", { type: "text", class: "code-long", maxlength: "20", value: d.code, "aria-label": t("carto.documents.code"), placeholder: "PR-ACH-01", spellcheck: "false", autocapitalize: "characters", "data-focus": d.id });
  const indice = h("small", { class: "indice-erreur" });
  const verifier = () => {
    const cle = messageDocument(cs.lire(), d);
    indice.textContent = cle ? t(cle) : "";
    code.classList.toggle("invalide", Boolean(cle));
  };
  code.addEventListener("input", () => {
    cs.modifierDocument(d.id, "code", code.value);
    code.value = d.code;
    verifier();
  });
  verifier();
  return h("div", { class: "ligne-carto document" },
    h("div", {}, code, indice),
    champ(t("carto.documents.titre"), d.titre, (v) => cs.modifierDocument(d.id, "titre", v)),
    ecriture() ? h("button", { type: "button", class: "suppr", "aria-label": t("form.supprimer"), title: t("form.supprimer"), onclick: () => cs.supprimerDocument(d.id) }, icone("trash", 17)) : null);
}

// La procédure en cours peut rejoindre le registre en un clic (une fois son code attribué par la personne responsable des codes).
function boutonAjouterEnCours(c) {
  const m = store.lire().meta;
  const code = (m.reference || "").trim().toUpperCase();
  if (!code || !FORMAT_CODE_LIBRE.test(code) || documentParCode(c, code)) return null;
  return h("button", { type: "button", onclick: () => { const id = cs.ajouterDocument(); if (id) { cs.modifierDocument(id, "code", code); cs.modifierDocument(id, "titre", m.titre || ""); rendre(); } } },
    icone("plus", 16, 2.2), t("carto.documents.ajouter_en_cours", { code }));
}

// Comment l'organisation code ses documents : facultatif ; coché, l'application propose et contrôle les codes TYPE-PROCESSUS-NN.
function carteNomenclature(c) {
  const n = c.nomenclature;
  const exemple = h("p", { class: "aide" });
  const majExemple = () => { exemple.textContent = `${codeTypeDuDocument(cs.lire(), "procedure")}-ACH-01 · ${codeTypeDuDocument(cs.lire(), "instruction")}-ACH-01`; };
  majExemple();
  const type = (cle) => {
    const saisie = h("input", { type: "text", class: "code-court", maxlength: "3", value: n[cle], "aria-label": t("carto.nomenclature." + cle), placeholder: t("carto.nomenclature.type.ph"), spellcheck: "false", autocapitalize: "characters" });
    saisie.addEventListener("input", () => { cs.modifierNomenclature(cle, saisie.value); saisie.value = cs.lire().nomenclature[cle]; majExemple(); });
    return h("label", { class: "champ" }, h("span", {}, t("carto.nomenclature." + cle)), saisie);
  };
  const case_ = h("input", { type: "checkbox", checked: n.controle });
  case_.addEventListener("change", () => cs.modifierNomenclature("controle", case_.checked));
  return h("section", { class: "carte" },
    h("div", { class: "carte-entete" }, h("h3", {}, t("carto.nomenclature"))),
    h("p", { class: "aide" }, t("carto.nomenclature.aide")),
    h("label", { class: "case-double" }, case_, h("span", {}, t("carto.nomenclature.controle"))),
    n.controle ? h("div", { class: "grille g2" }, type("procedure"), type("instruction")) : null,
    n.controle ? exemple : null);
}

function carteDocuments(c) {
  return h("section", { class: "carte" },
    h("div", { class: "carte-entete" }, h("h3", {}, t("carto.documents")), h("span", { class: "compteur" }, String(c.documents.length))),
    h("p", { class: "aide" }, t("carto.documents.aide")),
    ...c.documents.map((d) => ligneDocument(c, d)),
    ecriture() ? h("div", { class: "boutons-ligne" },
      h("button", { type: "button", onclick: () => { const id = cs.ajouterDocument(); if (id) focusApres = id; } }, icone("plus", 16, 2.2), t("carto.documents.ajouter")),
      boutonAjouterEnCours(c)) : null);
}

// ---------- Fenêtre ----------
export function rendre() {
  const conteneur = $("carto-contenu");
  if (!conteneur) return;
  const c = cs.lire();
  conteneur.replaceChildren(...[
    barreActions(),
    blocRapport(),
    blocModeles(),
    blocApercu(c),
    cs.estVideMaintenant() ? h("p", { class: "intro carto-vide" }, t("carto.vide")) : h("p", { class: "intro" }, t("carto.intro")),
    carteOrganisation(c), carteProcessus(c), carteFlux(c), carteFiches(c), carteNomenclature(c), carteDocuments(c),
  ].filter(Boolean));
  $("carto-info").textContent = t("carto.info", { processus: c.processus.length, flux: c.flux.length });
  requestAnimationFrame(() => ajusterToutes(conteneur));
  if (focusApres) {
    const cible = conteneur.querySelector(`[data-focus="${focusApres}"]`) || conteneur.querySelector(".ligne-carto:last-of-type textarea, .ligne-carto:last-of-type select");
    focusApres = null;
    if (cible) cible.focus();
  }
}

export function preparerFenetre() {
  $("carto-fermer").addEventListener("click", () => $("fenetre-carto").close());
  // Un clic sur le fond (hors de la boîte) ferme aussi la fenêtre.
  $("fenetre-carto").addEventListener("click", (ev) => { if (ev.target === $("fenetre-carto")) $("fenetre-carto").close(); });
  cs.abonner((structure) => {
    const fenetre = $("fenetre-carto");
    if (fenetre && fenetre.open && structure) rendre();
  });
}
