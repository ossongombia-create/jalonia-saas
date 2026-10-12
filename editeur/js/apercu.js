// apercu.js — l'APERÇU du document, dans la mise en page du modèle standard de procédure : en-tête d'identification,
// validation du document, historique des révisions, 11 sections avec leur contenu réel (paragraphes, tableaux, logigramme),
// et le compteur de pages.
// construireFeuille() sert aussi à l'impression (PDF) : c'est exactement le même document.

import { h } from "./dom.js";
import { t } from "./i18n.js";
import { construireDocument, estimerPages, colonnesCentrees, largeursColonnes, GABARITS, LARGEUR_TEXTE, PAGES_MAX, PAGES_CIBLE_MIN } from "./document.js";
import { dessinerNiveau2, disposerNiveau2 } from "./render.js";

// Une cellule peut avoir plusieurs lignes ; « gras1 » met la première en gras.
function contenuCellule(texte, gras1) {
  const lignes = String(texte ?? "").split(/\r\n|\r|\n/);
  if (lignes.length === 1 && !gras1) return lignes[0];
  return lignes.map((l, k) => h("div", { class: gras1 && k === 0 ? "l1" : "" }, l));
}

function tableau(bloc, classe = "") {
  const centrees = colonnesCentrees(bloc);
  const gras1 = bloc.gras1 || [];
  const enteteVide = bloc.colonnes.every((c) => !String(c).trim());
  const classeCol = (j) => (centrees.includes(j) ? "c" : "");
  // Mêmes largeurs de colonnes que le Word (une seule règle : document.js).
  const largeurs = largeursColonnes(bloc.colonnes, bloc.lignes, bloc.gabarit);
  return h("table", { class: `tab-apercu ${classe}`.trim() },
    h("colgroup", {}, ...largeurs.map((w) => h("col", { style: `width:${((w / LARGEUR_TEXTE) * 100).toFixed(2)}%` }))),
    enteteVide ? null : h("thead", {}, h("tr", {}, ...bloc.colonnes.map((c, j) => h("th", { class: classeCol(j) }, c)))),
    h("tbody", {}, ...bloc.lignes.map((l) => h("tr", {},
      ...bloc.colonnes.map((_, j) => h(bloc.premiereColonneEtiquette && j === 0 ? "th" : "td", { class: classeCol(j) }, contenuCellule(l[j], gras1.includes(j))))))));
}

function rendreBloc(bloc, procedure, suivant) {
  // Un paragraphe qui introduit un tableau reste sur la même page que lui (comme « garder avec le suivant » dans Word).
  if (bloc.type === "paragraphe") return h("p", { class: suivant && suivant.type === "tableau" ? "avant-tableau" : "" }, bloc.texte);
  if (bloc.type === "sous-titre") return h("h4", {}, bloc.texte);
  if (bloc.type === "tableau") return tableau(bloc);
  // Logigramme : le dessin est produit par render.js, qui protège tous les textes. Sa taille finale (à l'impression) est celle du Word.
  const d = disposerNiveau2(procedure);
  const zone = h("div", { class: "logigramme-apercu", role: "img", "aria-label": t("doc.section.logigramme") });
  if (d) zone.style.setProperty("--largeur-dessin", `${Math.round(d.largeur)}px`);
  zone.innerHTML = dessinerNiveau2(procedure);
  return zone;
}

// En-tête : organisation | titre | référence et version ; puis domaine, processus, date d'application.
function enTete(doc) {
  const c = doc.cartouche;
  const largeurs = largeursColonnes(["", "", ""], [], GABARITS.entete);
  return h("table", { class: "tab-apercu tab-entete" },
    h("colgroup", {}, ...largeurs.map((w) => h("col", { style: `width:${((w / LARGEUR_TEXTE) * 100).toFixed(2)}%` }))),
    h("tbody", {},
      h("tr", {},
        h("td", { class: "c org" }, c.logo ? h("img", { class: "logo-entete", src: c.logo, alt: "" }) : null, c.logo ? h("div", {}, c.organisation) : c.organisation),
        h("td", { class: "c titre-doc" }, `${c.typeTitre} ${c.titre || t("doc.sans_titre")}`),
        h("td", { class: "refs" }, h("div", {}, `${t("doc.hd.reference")} : ${c.reference}`), h("div", {}, `${t("doc.hd.version")} : ${c.version}`))),
      h("tr", { class: "etiquettes" }, ...["domaine", "processus", "date"].map((k) => h("th", {}, t("doc.hd." + k)))),
      h("tr", {}, h("td", {}, c.domaine), h("td", {}, c.processus), h("td", {}, c.dateApplication))));
}

// La « feuille » : le document tel qu'il sera imprimé.
export function construireFeuille(procedure) {
  const doc = construireDocument(procedure);
  const disposition = disposerNiveau2(procedure);
  const paysage = disposition && disposition.orientation === "paysage";
  let apresLogigramme = false;
  const corps = doc.sections.map((s, i) => {
    const aLogigramme = s.blocs.some((b) => b.type === "logigramme");
    const classe = ["section-doc",
      aLogigramme ? "section-logigramme" + (paysage ? " paysage" : "") : "",
      apresLogigramme ? "apres-logigramme" : "",
      i === 0 && doc.enTeteSeparee ? "apres-entete" : ""].filter(Boolean).join(" ");
    apresLogigramme = aLogigramme;
    return h("section", { class: classe },
      h("h3", {}, `${i + 1}. ${t("doc.section." + s.cle)}`),
      ...(s.blocs.length ? s.blocs.map((b, k) => rendreBloc(b, procedure, s.blocs[k + 1])) : [h("div", { class: "zone-vide", "aria-hidden": "true", "data-texte": t("doc.section_vide") })]));
  });
  return h("div", { class: "feuille", "data-pied": doc.cartouche.pied },
    enTete(doc),
    h("h4", {}, t("valid.titre")), tableau(doc.validation, "tab-validation"),
    h("h4", {}, t("histo.titre")), tableau(doc.historique),
    ...corps);
}

export function rendreApercu(conteneur, procedure) {
  const pages = estimerPages(construireDocument(procedure));
  const classe = pages > PAGES_MAX ? "erreur" : pages >= PAGES_CIBLE_MIN ? "ok" : "neutre";
  conteneur.replaceChildren(
    h("p", { class: "compteur-pages " + classe }, t("doc.pages", { n: pages, min: PAGES_CIBLE_MIN, max: PAGES_MAX })),
    construireFeuille(procedure));
}
