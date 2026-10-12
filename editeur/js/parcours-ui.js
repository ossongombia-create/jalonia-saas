// parcours-ui.js — le PARCOURS en 4 étapes, côté page : bandeau d'étapes, contenu de l'étape courante,
// boutons Précédent / Continuer et liste de ce qu'il reste à renseigner.
// La logique « quand une étape est-elle remplie ? » est dans parcours.js (testable sans navigateur).
//
// Deux niveaux de rafraîchissement :
//   rendre()    : tout redessiner (changement d'étape, ajout/suppression d'un élément) ; on perd le curseur
//   actualiser(): frappe au clavier ; on ne touche ni aux champs ni au curseur, seulement à ce qui est en lecture seule

import { h } from "./dom.js";
import { t } from "./i18n.js";
import * as store from "./store.js";
import { ETAPES, manquants, etapeAccessible, etapeMax, etapeInitiale, estInstruction, etatsEtapes } from "./parcours.js";
import { rendreIdentification, rendreContenu } from "./formulaire.js";
import { rendreDeroule, rafraichirDeroule } from "./deroule.js";
import { rendreDerouleIT, rafraichirDerouleIT } from "./deroule-it.js";
import { rendreSynthese, rendreValidation } from "./synthese.js";
import { rendreSyntheseIT } from "./synthese-it.js";
import { rendreGeneration } from "./generation.js";
import { ouvrirApercu } from "./apercus.js";
import { icone } from "./icones.js";
import { afficher as afficherVue } from "./vue.js";

const CLE_ETAPE = "qualigramme-app-etape";
const $ = (id) => document.getElementById(id);

function etapeSauvee() {
  try {
    const n = Number(localStorage.getItem(CLE_ETAPE));
    return n >= 1 && n <= ETAPES.length ? n : 0;
  } catch (e) {
    return 0;
  }
}

function sauverEtape() {
  try {
    localStorage.setItem(CLE_ETAPE, String(courante));
  } catch (e) {
    // stockage indisponible : le parcours fonctionne quand même, seule l'étape n'est pas retenue.
  }
}

let courante = etapeSauvee() || etapeInitiale(store.lire());
let zonesDynamiques = [];

export function etapeCourante() {
  return courante;
}

export function allerA(n) {
  if (!etapeAccessible(store.lire(), n)) return;
  courante = n;
  sauverEtape();
  afficherVue("parcours"); // depuis l'accueil, un clic sur une étape ouvre le parcours
  rendre();
  const zone = $("zone-travail");
  if (zone) zone.scrollTop = 0;
}

// Après le chargement d'un exemple, d'un fichier ou d'un Word : on se place là où il reste du travail.
export function apresChargement() {
  courante = etapeInitiale(store.lire());
  sauverEtape();
  afficherVue("parcours"); // le document chargé (exemple, fichier, Word, nouveau) s'ouvre dans le parcours
  rendre();
}

// Les 4 étapes, à la verticale dans la colonne marine : fait (coche verte), en cours (halo bleu), à faire, verrouillée.
function bandeau() {
  const etats = etatsEtapes(store.lire(), courante);
  return h("ol", { class: "liste-etapes" },
    ...etats.map(({ cle, n, etat, ouverte }, i) => {
      const bouton = h("button", {
        type: "button", class: "pas " + etat, disabled: !ouverte, "aria-current": n === courante ? "step" : undefined,
        title: ouverte ? undefined : t("parcours.verrouille"), onclick: () => allerA(n),
      },
      h("span", { class: "pas-gauche" },
        h("span", { class: "rond" }, etat === "fait" ? icone("check", 16, 2.4) : etat === "verrouille" ? icone("lock", 14) : String(n)),
        i < ETAPES.length - 1 ? h("span", { class: "trait-pas" }) : null),
      h("span", { class: "pas-droite" },
        h("span", { class: "nom-pas" }, t("parcours.etape." + cle)),
        h("span", { class: "sous-pas" }, t("parcours.etat." + etat))));
      return h("li", {}, bouton);
    }));
}

// La carte « procédure en cours » de la colonne marine : intitulé, code, version, type — elle suit la saisie.
function carteProcedure() {
  const m = store.lire().meta;
  const it = m.typeDocument === "instruction";
  const details = [m.reference, m.version, m.typeDocument ? t("type_document." + m.typeDocument) : ""].filter(Boolean).join(" · ");
  return [
    h("div", { class: "kicker" }, t(it ? "rail.instruction" : "rail.procedure")),
    m.titre ? h("div", { class: "titre" }, m.titre) : h("div", { class: "titre vide" }, t(it ? "rail.sans_titre_it" : "rail.sans_titre")),
    details ? h("div", { class: "sous" }, details) : null,
  ];
}

// Le cadre autour de l'étape : colonne marine (étapes + procédure), titre de la page, barre Continuer.
function rafraichirCadre() {
  $("parcours").setAttribute("aria-label", t("parcours.titre"));
  $("parcours").replaceChildren(bandeau());
  $("carte-procedure").replaceChildren(...carteProcedure().filter(Boolean)); // replaceChildren écrirait « null » pour un élément absent
  $("entete-kicker").textContent = t("parcours.etape_n", { n: courante });
  $("entete-titre").textContent = t((estInstruction(store.lire()) ? "parcours.page_it." : "parcours.page.") + ETAPES[courante - 1]);
  $("etape-navigation").replaceChildren(navigation());
}

// La barre du bas : Précédent · où j'en suis (ou ce qu'il reste à renseigner) · aperçu · Continuer.
function navigation() {
  const p = store.lire();
  const manques = manquants(p, courante);
  const derniere = courante === ETAPES.length;
  let statut = h("div", { class: "statut-nav" });
  if (!derniere) {
    if (manques.length === 0) {
      statut = h("div", { class: "statut-nav ok", role: "status" }, icone("check", 17, 2.2), t("parcours.complete"));
    } else {
      const textes = manques.map((m) => t(m.cle, m.params));
      const resume = textes.slice(0, 2).join(" · ") + (textes.length > 2 ? " " + t("parcours.et_autres", { n: textes.length - 2 }) : "");
      statut = h("div", { class: "statut-nav reste", role: "status", title: textes.join("\n") },
        icone("warn", 17), h("span", {}, t("parcours.reste"), " ", resume));
    }
  }
  return h("div", { class: "navigation-etapes" },
    courante > 1 ? h("button", { type: "button", onclick: () => allerA(courante - 1) }, icone("arrL", 17), t("parcours.precedent")) : null,
    statut,
    h("div", { class: "boutons-apercu" }, ...boutonsApercu()),
    derniere ? null : h("button", { type: "button", class: "primaire", disabled: manques.length > 0, onclick: () => allerA(courante + 1) }, t("parcours.suivant"), icone("arrR", 17)));
}

// Aperçus à la demande : le logigramme à l'étape 2 (déroulé), le document à l'étape 3 (synthèse) ; les deux à l'étape 4.
function boutonsApercu() {
  if (estInstruction(store.lire())) {
    // Instruction de travail : seul le dessin s'aperçoit dans cette version (le document Word / PDF d'une page vient ensuite).
    const dessinIT = h("button", { type: "button", class: "apercu", id: "btn-apercu-dessin", onclick: () => ouvrirApercu("dessin") }, icone("eye", 17), t("apercu.bouton.instruction"));
    return courante >= 2 ? [dessinIT] : [];
  }
  const dessin = h("button", { type: "button", class: "apercu", id: "btn-apercu-dessin", onclick: () => ouvrirApercu("dessin") }, icone("eye", 17), t("apercu.bouton.dessin"));
  const document_ = h("button", { type: "button", class: "apercu", id: "btn-apercu-document", onclick: () => ouvrirApercu("document") }, icone("eye", 17), t("apercu.bouton.document"));
  if (courante === 2) return [dessin];
  if (courante === 3) return [document_];
  if (courante === 4) return [dessin, document_];
  return [];
}

// Redessine le bandeau, le contenu de l'étape et la navigation.
export function rendre() {
  const p = store.lire();
  if (!etapeAccessible(p, courante)) courante = etapeMax(p); // ex. après « annuler » : l'étape n'est plus ouverte
  const contenu = $("etape-contenu");
  zonesDynamiques = [];
  const it = estInstruction(p);
  // étape 2 d'une procédure : la liste et la fiche défilent chacune de leur côté ; celle d'une instruction est un tableau qui défile d'un bloc
  $("zone-travail").classList.toggle("pleine-hauteur", courante === 2 && !it);

  if (courante === 1) {
    contenu.replaceChildren();
    rendreIdentification(contenu);
  } else if (courante === 2 && it) {
    rendreDerouleIT(contenu);
  } else if (courante === 2) {
    rendreDeroule(contenu); // redessine sans vider avant : elle garde le défilement et la fiche affichée
  } else if (courante === 3 && it) {
    const synthese = h("div", { class: "zone-synthese" });
    const validation = h("div", { class: "zone-validation" });
    contenu.replaceChildren(synthese, validation);
    zonesDynamiques = [() => rendreSyntheseIT(synthese, allerA), () => rendreValidation(validation)];
  } else if (courante === 3) {
    const synthese = h("div", { class: "zone-synthese" });
    const sections = h("div", { class: "zone-sections" });
    const validation = h("div", { class: "zone-validation" });
    contenu.replaceChildren(synthese, sections, validation);
    rendreContenu(sections);
    zonesDynamiques = [() => rendreSynthese(synthese, allerA), () => rendreValidation(validation)];
  } else {
    const generation = h("div", { class: "zone-generation" });
    contenu.replaceChildren(generation);
    zonesDynamiques = [() => rendreGeneration(generation)];
  }
  zonesDynamiques.forEach((f) => f());
  rafraichirCadre();
}

// Rafraîchissement léger : à chaque frappe, sans toucher aux champs de saisie.
export function actualiser() {
  const p = store.lire();
  if (!etapeAccessible(p, courante)) {
    rendre();
    return;
  }
  zonesDynamiques.forEach((f) => f());
  if (courante === 2) (estInstruction(p) ? rafraichirDerouleIT : rafraichirDeroule)($("etape-contenu")); // liste de gauche, libellés des destinations, noms des rôles
  rafraichirCadre();
}
