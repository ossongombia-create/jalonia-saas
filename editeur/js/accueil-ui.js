// accueil-ui.js — l'écran d'ACCUEIL « Mon espace », côté page : le document en cours (avancement et compteurs), les autres façons de commencer,
// la cartographie par blocs, l'aide et la version d'essai. Ce que l'écran montre est calculé par accueil.js (sans page) ; ici on dessine.
// Tous les textes viennent de t() et sont posés en texte (jamais de HTML injecté) ; les actions sont fournies par main.js.

import { h } from "./dom.js";
import { t, langueCourante } from "./i18n.js";
import { icone } from "./icones.js";
import * as store from "./store.js";
import * as cartographie from "./cartographie-store.js";
import { etapeCourante } from "./parcours-ui.js";
import { accueilMasque, definirAccueilMasque } from "./vue.js";
import { resumeDocument, blocsCartographie, libelleModification, nomOrganisation, cleCompteur } from "./accueil.js";

const bouton = (genre, iconeNom, libelle, onclick, attributs = {}) =>
  h("button", { type: "button", class: genre === "plein" ? "bouton-plein" : "bouton-pilule", onclick, ...attributs },
    iconeNom ? icone(iconeNom, 17) : null, h("span", {}, libelle));

const ligneAction = (iconeNom, libelle, onclick, attributs = {}) =>
  h("button", { type: "button", class: "accueil-ligne", onclick, ...attributs },
    icone(iconeNom, 19), h("span", { class: "accueil-ligne-texte" }, libelle), icone("arrR", 16));

const ligneLien = (iconeNom, libelle, href) =>
  h("a", { class: "accueil-ligne", href, target: "_blank", rel: "noopener" },
    icone(iconeNom, 19), h("span", { class: "accueil-ligne-texte" }, libelle), icone("arrR", 16));

const titreCarte = (texte) => h("h2", { class: "accueil-titre-carte" }, texte);

// ----- Carte « document en cours » (ou, à défaut, le parcours en 4 étapes) -----
function carteDocument(resume, actions) {
  if (!resume) {
    return h("section", { class: "carte accueil-carte accueil-doc vide" },
      titreCarte(t("accueil.vide.titre")),
      h("p", { class: "accueil-texte" }, t("accueil.vide.texte")),
      h("ol", { class: "accueil-parcours" },
        ["identification", "deroule", "synthese", "generation"].map((cle, i) =>
          h("li", {},
            h("span", { class: "accueil-parcours-n" }, String(i + 1)),
            h("span", {}, h("strong", {}, t("parcours.etape." + cle)), " — ", t("accueil.parcours." + cle))))));
  }
  const modifie = libelleModification(store.derniereModification(), Date.now(), langueCourante());
  const details = [resume.details, modifie ? t(modifie.cle, modifie.params) : ""].filter(Boolean).join(" · ");
  const etiquetteType = t("accueil.doc.etiquette." + (resume.type || "aucun"));
  const enregistre = !store.nonEnregistre();
  const titreVide = t(resume.instruction ? "rail.sans_titre_it" : "rail.sans_titre");
  return h("section", { class: "carte accueil-carte accueil-doc" },
    h("div", { class: "accueil-doc-etiquettes" },
      h("span", { class: "accueil-pastille" }, etiquetteType),
      h("span", { class: "accueil-etiquette" }, t("accueil.doc.brouillon")),
      h("span", { class: "accueil-fichier " + (enregistre ? "ok" : "alerte"), id: "accueil-etat-fichier" },
        icone(enregistre ? "check" : "warn", 14, 2.2), t(enregistre ? "accueil.doc.enregistre" : "accueil.doc.non_enregistre"))),
    h("h2", { class: "accueil-doc-titre" + (resume.titre ? "" : " vide") }, resume.titre || titreVide),
    details ? h("p", { class: "accueil-doc-details" }, details) : null,
    h("ol", { class: "accueil-suivi", "aria-label": t("accueil.doc.avancement") },
      resume.etapes.map((e) =>
        h("li", { class: "accueil-suivi-pas " + e.etat, title: t("parcours.etat." + e.etat) },
          h("span", { class: "accueil-suivi-rond" }, e.etat === "fait" ? icone("check", 15, 2.6) : e.etat === "verrouille" ? icone("lock", 13) : null),
          h("span", { class: "accueil-suivi-nom" }, t("parcours.etape." + e.cle))))),
    h("ul", { class: "accueil-compteurs" },
      resume.compteurs.map((c) =>
        h("li", { class: "accueil-compteur " + c.ton },
          h("strong", {}, String(c.n)), h("span", {}, t(cleCompteur(c.base, c.n, langueCourante())))))),
    h("div", { class: "accueil-actions-carte" },
      bouton("plein", "arrR", t(resume.cleReprise), () => actions.reprendre(resume.reprise), { id: "accueil-reprendre" }),
      bouton("pilule", "save", t("accueil.enregistrer"), actions.enregistrer, { id: "accueil-enregistrer" })));
}

// ----- Carte « autres façons de commencer » -----
function carteAutres(actions) {
  return h("section", { class: "carte accueil-carte accueil-lignes" },
    titreCarte(t("accueil.autres.titre")),
    ligneAction("folder", t("fichier.ouvrir"), actions.ouvrirJson, { id: "accueil-ouvrir" }),
    ligneAction("upload", t("fichier.importer_word"), actions.importerWord, { id: "accueil-importer-word" }),
    ligneAction("doc", t("fichier.exemple"), actions.exemple, { id: "accueil-exemple" }),
    ligneAction("doc", t("fichier.exemple_it"), actions.exempleIT, { id: "accueil-exemple-it" }));
}

// ----- Carte « cartographie des processus » -----
function carteCartographie(actions) {
  const c = blocsCartographie(cartographie.lire());
  const bloc = (titre, puces) =>
    h("div", { class: "accueil-bloc" },
      h("h3", {}, titre),
      puces.length
        ? h("ul", { class: "accueil-puces" }, puces.map((x) => h("li", { class: "accueil-puce", title: x.nom || undefined }, x.code)))
        : h("p", { class: "accueil-bloc-vide" }, "—"));
  return h("section", { class: "carte accueil-carte accueil-carto" },
    h("div", { class: "accueil-carto-tete" },
      h("span", { class: "pastille-titre" }, icone("carto", 20)),
      h("div", {},
        h("h2", { class: "accueil-titre-carte" }, t("carto.titre")),
        c.vide ? null : h("p", { class: "accueil-sous" }, t("accueil.carto.compte", { processus: c.nbProcessus, echanges: c.nbEchanges })))),
    c.vide
      ? h("p", { class: "accueil-texte" }, t("accueil.carto.vide"))
      : h("div", { class: "accueil-blocs" },
        c.blocs.map((b) => bloc(t("carto.categorie." + b.categorie), b.puces)),
        c.sansBloc.length ? bloc(t("accueil.carto.sans_bloc"), c.sansBloc) : null),
    h("div", { class: "accueil-actions-carte" },
      bouton("pilule", null, t(c.vide ? "accueil.carto.creer" : "accueil.carto.ouvrir"), actions.cartographie, { id: "accueil-cartographie" })));
}

// ----- Carte « aide et version d'essai » -----
function carteAide(actions) {
  return h("section", { class: "carte accueil-carte accueil-lignes" },
    titreCarte(t("accueil.aide.titre")),
    ligneLien("book", t("accueil.aide.guide"), "guide-" + langueCourante() + ".html"),
    ligneAction("info", t("retour.bouton"), actions.retour, { id: "accueil-retour" }),
    ligneAction("shield", t("mentions.bouton"), actions.mentions, { id: "accueil-mentions" }));
}

// ----- Pied : confiance, version d'essai, « ne plus afficher » -----
function pied(actions) {
  const case_ = h("input", { type: "checkbox", id: "accueil-masquer", checked: accueilMasque() });
  case_.addEventListener("change", () => definirAccueilMasque(case_.checked));
  return h("footer", { class: "accueil-pied" },
    h("p", { class: "accueil-confiance" }, icone("shield", 17, 1.9), t("accueil.confiance"),
      h("span", { class: "accueil-sep", "aria-hidden": "true" }), t("accueil.essai_court"),
      h("span", { class: "accueil-sep", "aria-hidden": "true" }),
      h("button", { type: "button", class: "accueil-lien", onclick: actions.mentions }, t("mentions.bouton"))),
    h("label", { class: "accueil-masquer", for: "accueil-masquer" }, case_, h("span", {}, t("accueil.masquer")),
      h("small", {}, t("accueil.masquer.aide"))));
}

// Redessine l'accueil dans « zone ». « constats » = la liste du diagnostic du document en cours (déjà calculée par main.js).
export function rendreAccueil(zone, actions, constats = []) {
  const p = store.lire();
  const resume = resumeDocument(p, constats, etapeCourante());
  const organisation = nomOrganisation(p, cartographie.lire());
  zone.replaceChildren(
    h("div", { class: "accueil-entete" },
      h("div", { class: "accueil-titres" },
        h("p", { class: "accueil-kicker" }, t("accueil.kicker")),
        h("h1", { id: "accueil-titre" }, organisation || t("accueil.titre_sans_organisation"))),
      h("div", { class: "accueil-actions" },
        bouton("plein", "plus", t("accueil.nouvelle_procedure"), () => actions.nouveau("procedure"), { id: "accueil-nouvelle-procedure" }),
        bouton("pilule", "plus", t("accueil.nouvelle_instruction"), () => actions.nouveau("instruction"), { id: "accueil-nouvelle-instruction" }))),
    h("div", { class: "accueil-grille" },
      h("div", { class: "accueil-colonne" }, carteDocument(resume, actions), carteAutres(actions)),
      h("div", { class: "accueil-colonne" }, carteCartographie(actions), carteAide(actions))),
    pied(actions));
}
