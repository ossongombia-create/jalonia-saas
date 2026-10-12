// deroule-it.js — l'étape 2 d'une INSTRUCTION DE TRAVAIL (niveau 3, chapitre 7 du livre Qualigramme) : un tableau à 3 colonnes comme
// le dessin du livre (fig. 7.3) — Opérations | Plan d'auto-contrôle | Actions correctrices. Chaque opération a, en face d'elle,
// ses contrôles (questions Oui / Non) et les actions correctives à faire si la réponse est Non. Un seul rôle, en haut.
// Les textes viennent de t() ; les valeurs saisies sont posées avec .value (jamais innerHTML).
// Deux niveaux de rafraîchissement, comme deroule.js : rendreDerouleIT() redessine tout (ajout, suppression, case cochée) ;
// rafraichirDerouleIT() ne touche qu'aux textes en lecture seule (à chaque frappe : le curseur ne bouge pas).

import { t, langueCourante } from "./i18n.js";
import * as store from "./store.js";
import { h } from "./dom.js";
import { icone } from "./icones.js";
import { carte } from "./cartes.js";
import { champ, ajusterToutes } from "./formulaire.js";
import { blocRaccord } from "./deroule.js";
import { questionnement } from "./questionnement.js";
import { TYPES_OUTIL, NATURES_CONTROLE, NATURES_CONTRAINTE, MAX_OPERATIONS_SAISIE, MAX_CONTROLES, MAX_CORRECTIVES } from "./model.js";
import { MIN_OPERATIONS, MAX_OPERATIONS } from "./rules-it.js";

let racine = null;
let focusApres = null; // (procédure) => clé du champ (data-cle) où placer le curseur après le prochain dessin
const detailsOuverts = new Set(); // ids des opérations dont le volet « outils » est ouvert (état de l'écran, pas de la procédure)

// Un champ de saisie sur une ligne qui grandit avec le texte ; « cle » sert à retrouver le champ après un redessin.
function zone(cle, valeur, quandChange, { placeholder = "", label = "", classe = "" } = {}) {
  const z = h("textarea", { class: ("auto " + classe).trim(), rows: "1", spellcheck: "true", lang: langueCourante(), autocapitalize: "sentences", placeholder, "aria-label": label, "data-cle": cle });
  z.value = valeur;
  z.addEventListener("keydown", (ev) => { if (ev.key === "Enter") ev.preventDefault(); });
  z.addEventListener("input", () => {
    if (/[\r\n]/.test(z.value)) z.value = z.value.replace(/\s*[\r\n]+\s*/g, " ");
    z.style.height = "auto";
    z.style.height = z.scrollHeight + 2 + "px";
    quandChange(z.value);
  });
  return z;
}

const champAvec = (libelle, cle, valeur, quandChange, options = {}) =>
  h("label", { class: "champ" + (options.requis ? " requis" : "") }, h("span", {}, libelle), zone(cle, valeur, quandChange, { ...options, label: libelle }));

function boutonRond(nomIcone, libelle, quandClic, { desactive = false, classe = "", cle = "" } = {}) {
  return h("button", { type: "button", class: ("bouton-rond-petit " + classe).trim(), "aria-label": libelle, title: libelle, disabled: desactive, "data-cle": cle || undefined, onclick: quandClic }, icone(nomIcone, 17));
}

function pastille(nomIcone, libelle, actif, quandClic, cle, titre = "") {
  return h("button", { type: "button", class: "pastille-option", "aria-pressed": String(actif), title: titre || undefined, "data-cle": cle, onclick: quandClic }, icone(nomIcone, 16), libelle);
}

// ---------- Point d'entrée ----------
export function rendreDerouleIT(conteneur) {
  racine = conteneur;
  const p = store.lire();
  const parent = document.getElementById("zone-travail");
  const defilement = parent ? parent.scrollTop : 0;
  const cleFocus = document.activeElement && conteneur.contains(document.activeElement) ? document.activeElement.dataset.cle : undefined;
  const demande = focusApres ? focusApres(p) : null;
  focusApres = null;

  conteneur.replaceChildren(h("div", { class: "it" },
    h("p", { class: "intro" }, t("it.intro")),
    h("div", { class: "it-tableau" },
      titresColonnes(),
      ligneRole(p),
      ligneFixe(carteDebut(p)),
      ...p.it.operations.map((op, i) => ligneOperation(p, op, i)),
      ligneAjout(p),
      ligneFixe(carteFin(p)))));
  ajusterToutes(conteneur);
  if (parent) parent.scrollTop = defilement;
  requestAnimationFrame(() => {
    ajusterToutes(conteneur);
    if (parent) parent.scrollTop = defilement;
    const cible = demande || cleFocus;
    if (cible) {
      const el = [...conteneur.querySelectorAll("[data-cle]")].find((x) => x.dataset.cle === cible);
      if (el) el.focus({ preventScroll: !demande });
    }
  });
}

// À chaque frappe : compteur d'opérations et noms des correctives (dans les cases « Si Non ») ; rien d'autre n'est reconstruit.
export function rafraichirDerouleIT(conteneur) {
  const p = store.lire();
  conteneur.querySelectorAll("[data-corr]").forEach((el) => {
    const [opId, corrId] = el.dataset.corr.split(":");
    const op = p.it.operations.find((o) => o.id === opId);
    const k = op ? op.correctives.findIndex((m) => m.id === corrId) : -1;
    if (k >= 0) el.textContent = op.correctives[k].libelle.trim() || t("it.corr.n", { n: k + 1 });
  });
  const compteur = conteneur.querySelector("[data-compteur]");
  if (compteur) Object.assign(compteur, compteurIT(p.it.operations.length));
}

// ---------- Les lignes du tableau ----------
function titresColonnes() {
  const titre = (cle, nomIcone) => h("div", { class: "it-titre" }, h("span", { class: "pastille-titre" }, icone(nomIcone, 16)), h("div", {}, h("strong", {}, t("it.col." + cle)), h("small", {}, t("it.col." + cle + ".aide"))));
  return h("div", { class: "it-ligne it-titres" }, titre("operations", "list"), titre("controles", "tri"), titre("correctives", "loop"));
}

// Une ligne « fixe » (rôle, début, fin) : la carte est dans la première colonne, les deux autres restent vides.
function ligneFixe(contenu) {
  return h("div", { class: "it-ligne it-fixe" }, h("div", { class: "it-cellule" }, contenu), h("div", { class: "it-cellule vide", "aria-hidden": "true" }), h("div", { class: "it-cellule vide", "aria-hidden": "true" }));
}

function ligneRole(p) {
  const r = p.it.role;
  return ligneFixe(carte("users", t("it.role.titre"),
    h("p", { class: "aide" }, t("it.role.aide")),
    champAvec(t("it.role.nom"), "role-nom", r.nom, (v) => store.modifierRoleIT("nom", v), { requis: true, placeholder: t("it.role.ph") })));
}

function carteDebut(p) {
  return carte("play", t("it.carte.debut"),
    champ(t("form.declencheur"), p.meta.declencheur, (v) => store.modifierMeta("declencheur", v), { requis: true, placeholder: t("it.declencheur.ph") }),
    blocRaccord("amont", p.meta.amont, "_it"));
}

function carteFin(p) {
  return carte("stop", t("it.carte.fin"),
    champ(t("form.fin"), p.meta.fin, (v) => store.modifierMeta("fin", v), { requis: true, placeholder: t("it.fin.ph") }),
    blocRaccord("aval", p.meta.aval, "_it"));
}

// Compteur : « 6 opérations · de 5 à 10 » ; orange sous 5, rouge au-dessus de 10 (règles 4 et 5 du livre).
function compteurIT(n) {
  const etat = n > MAX_OPERATIONS ? "erreur" : n > 0 && n < MIN_OPERATIONS ? "alerte" : "ok";
  return { className: "it-compteur " + etat, textContent: t("it.compteur", { n, min: MIN_OPERATIONS, max: MAX_OPERATIONS }) };
}

function ligneAjout(p) {
  const n = p.it.operations.length;
  const compteur = h("span", { "data-compteur": "1" });
  Object.assign(compteur, compteurIT(n));
  return h("div", { class: "it-ligne it-ajout" },
    h("div", { class: "it-cellule" },
      n === 0 ? h("p", { class: "aide" }, t("it.op.aucune")) : null,
      h("div", { class: "it-ajout-barre" },
        h("button", { type: "button", class: "ajout-rangee", disabled: n >= MAX_OPERATIONS_SAISIE, "data-cle": "op-ajouter", onclick: ajouterOperation }, icone("plus", 16), t("it.op.ajouter")),
        compteur)),
    h("div", { class: "it-cellule vide", "aria-hidden": "true" }), h("div", { class: "it-cellule vide", "aria-hidden": "true" }));
}

function ajouterOperation() {
  focusApres = (p) => "op-libelle-" + p.it.operations[p.it.operations.length - 1].id;
  store.ajouterOperation();
}

// ---------- Une opération : sa carte, ses contrôles, ses actions correctives ----------
function ligneOperation(p, op, i) {
  const total = p.it.operations.length;
  return h("div", { class: "it-ligne it-operation", "data-op": op.id },
    h("div", { class: "it-cellule", "data-titre": t("it.col.operations") }, carteOperation(op, i, total)),
    h("div", { class: "it-cellule", "data-titre": t("it.col.controles") }, celluleControles(op)),
    h("div", { class: "it-cellule", "data-titre": t("it.col.correctives") }, celluleCorrectives(op)));
}

function carteOperation(op, i, total) {
  const supprimer = () => {
    if ((op.controles.length || op.correctives.length) && !confirm(t("it.op.supprimer_confirmer"))) return;
    store.supprimerOperation(op.id);
  };
  const dupliquer = () => {
    focusApres = (q) => "op-libelle-" + q.it.operations[i + 1].id;
    store.dupliquerOperation(op.id);
  };
  const premiere = i === 0;
  const derniere = i === total - 1;
  const details = h("details", { class: "op-details" },
    h("summary", {}, t("it.op.details"), op.outils.length ? h("small", {}, ` — ${t("it.op.outils_n", { n: op.outils.length })}`) : null),
    ...panneauOutils(op),
    // Intermédiaire : l'information produite est facultative (elle figure sur la flèche vers l'opération suivante).
    !derniere ? champAvec(t("it.op.sortie"), "op-sortie-" + op.id, op.sortie, (v) => store.modifierOperation(op.id, "sortie", v), { placeholder: t("it.op.sortie.ph") }) : null,
    !premiere && op.entree ? champAvec(t("it.op.entree"), "op-entree-" + op.id, op.entree, (v) => store.modifierOperation(op.id, "entree", v)) : null);
  details.open = detailsOuverts.has(op.id);
  details.addEventListener("toggle", () => { if (details.open) detailsOuverts.add(op.id); else detailsOuverts.delete(op.id); });

  return h("section", { class: "carte op-carte" },
    h("div", { class: "ligne-entete" },
      h("span", { class: "numero-grand" }, String(i + 1)),
      h("span", { class: "position" }, t("it.op.n", { n: i + 1, total })),
      h("div", { class: "actions-instruction" },
        boutonRond("chevUp", t("form.monter"), () => store.deplacerOperation(op.id, -1), { desactive: premiere, cle: "op-monter-" + op.id }),
        boutonRond("chev", t("form.descendre"), () => store.deplacerOperation(op.id, 1), { desactive: derniere, cle: "op-descendre-" + op.id }),
        h("span", { class: "separateur-vertical" }),
        boutonRond("copy", t("form.dupliquer"), dupliquer, { desactive: total >= MAX_OPERATIONS_SAISIE }),
        boutonRond("trash", t("form.supprimer"), supprimer, { classe: "suppr" }))),
    h("div", { class: "libelle-op" }, zone("op-libelle-" + op.id, op.libelle, (v) => store.modifierOperation(op.id, "libelle", v), { placeholder: t("it.op.libelle.ph"), label: t("it.op.libelle") })),
    premiere ? champAvec(t("it.op.entree"), "op-entree-" + op.id, op.entree, (v) => store.modifierOperation(op.id, "entree", v), { requis: true, placeholder: t("it.op.entree.ph") }) : null,
    derniere ? champAvec(t("it.op.sortie"), "op-sortie-" + op.id, op.sortie, (v) => store.modifierOperation(op.id, "sortie", v), { requis: true, placeholder: t("it.op.sortie.ph") }) : null,
    h("div", { class: "pastilles" },
      pastille("warn", t("it.op.vigilance"), op.vigilance, () => store.modifierOperation(op.id, "vigilance", !op.vigilance), "op-vigilance-" + op.id, t("it.op.vigilance.aide")),
      pastille("doc", t("it.op.enregistrement"), op.enregistrement, () => store.modifierOperation(op.id, "enregistrement", !op.enregistrement), "op-enregistrement-" + op.id, t("it.op.enregistrement.aide")),
      pastille("circplus", t("it.op.contrainte"), op.contrainte.actif, () => store.modifierContrainteOperation(op.id, "actif", !op.contrainte.actif), "op-contrainte-" + op.id, t("form.contrainte.aide"))),
    op.contrainte.actif ? detailContrainte(op) : null,
    details,
    blocSansObjetOp(op, i));
}

// Bloc « sans objet » niveau 3 : seules les alertes « Avec quoi ? » et « Sous contraintes ? » peuvent l'être (« Comment ? » est toujours tenu).
// N'apparaît que pour les alertes actuellement ouvertes sur cette opération.
const POINT_PAR_CLE_IT = { avec: 7, contraintes: 11 };
function blocSansObjetOp(op, i) {
  const q = questionnement(store.lire());
  const num = i + 1;
  const ouverte = (cle) => {
    const pt = q.points.find((x) => x.n === POINT_PAR_CLE_IT[cle]);
    return pt && (pt.manquants.includes(num) || pt.nonApplicables.includes(num));
  };
  const cles = ["avec", "contraintes"].filter(ouverte);
  if (!cles.length) return null;
  const cases = cles.map((cle) => {
    const input = h("input", { type: "checkbox", checked: (op.sansObjet && op.sansObjet[cle]) === true });
    input.addEventListener("change", () => store.basculerSansObjetOperation(op.id, cle, input.checked));
    return h("label", { class: "case-sansobjet" }, input, h("span", {}, t("quest.na." + cle)));
  });
  return h("div", { class: "bloc-sansobjet" },
    h("p", { class: "aide" }, t("part.sansobjet.aide")),
    h("div", { class: "cases-sansobjet" }, ...cases));
}

function detailContrainte(op) {
  const c = op.contrainte;
  const nature = h("select", { "aria-label": t("form.contrainte.nature"), "data-cle": "op-contrainte-nature-" + op.id },
    ...NATURES_CONTRAINTE.map((k) => h("option", { value: k, selected: c.nature === k }, t("contrainte.nature." + k))));
  nature.addEventListener("change", () => store.modifierContrainteOperation(op.id, "nature", nature.value));
  return h("div", { class: "sous-carte it-contrainte" },
    h("label", { class: "champ" }, h("span", {}, t("form.contrainte.nature")), nature),
    champAvec(t("form.contrainte.texte"), "op-contrainte-texte-" + op.id, c.texte, (v) => store.modifierContrainteOperation(op.id, "texte", v), { requis: true, placeholder: t("form.contrainte.texte.ph") }));
}

function panneauOutils(op) {
  const lignes = op.outils.map((o) => {
    const type = h("select", { "aria-label": t("form.outil.type") },
      ...TYPES_OUTIL.map((k) => h("option", { value: k, selected: o.type === k }, t("outil.type." + k))));
    type.addEventListener("change", () => store.modifierOutilOperation(op.id, o.id, "type", type.value));
    return h("div", { class: "ligne-outil " + o.type }, type,
      zone("op-outil-" + o.id, o.nom, (v) => store.modifierOutilOperation(op.id, o.id, "nom", v), { placeholder: t("form.outil.placeholder." + o.type), label: t("form.outil.nom") }),
      boutonRond("trash", t("form.supprimer"), () => store.supprimerOutilOperation(op.id, o.id), { classe: "suppr" }));
  });
  return [
    h("p", { class: "aide" }, t("it.op.outils.aide")),
    ...lignes,
    h("div", { class: "boutons-ligne" },
      h("button", { type: "button", class: "discret", onclick: () => store.ajouterOutilOperation(op.id, "document") }, t("form.outil.ajouter_document")),
      h("button", { type: "button", class: "discret", onclick: () => store.ajouterOutilOperation(op.id, "materiel") }, t("form.outil.ajouter_materiel"))),
  ];
}

// ---------- Colonne « plan d'auto-contrôle » ----------
function celluleControles(op) {
  const cartes = op.controles.map((c, k) => carteControle(op, c, k));
  const ajouter = () => {
    focusApres = (q) => {
      const o = q.it.operations.find((x) => x.id === op.id);
      return "ctrl-question-" + o.controles[o.controles.length - 1].id;
    };
    store.ajouterControleOperation(op.id);
  };
  return h("div", { class: "it-pile" },
    ...cartes,
    op.vigilance && op.controles.length === 0 ? h("p", { class: "it-rappel alerte" }, icone("warn", 15), t("it.ctrl.risque")) : null,
    op.controles.length === 0 && !op.vigilance ? h("p", { class: "aide" }, t("it.ctrl.aucun")) : null,
    h("button", { type: "button", class: "discret it-ajout-petit", disabled: op.controles.length >= MAX_CONTROLES, "data-cle": "ctrl-ajouter-" + op.id, onclick: ajouter }, icone("plus", 15), t("it.ctrl.ajouter")));
}

function carteControle(op, c, k) {
  const nature = h("select", { class: "choix-nature", "aria-label": t("form.controle.nature"), "data-cle": "ctrl-nature-" + c.id },
    h("option", { value: "" }, t("it.ctrl.nature.choisir")),
    ...NATURES_CONTROLE.map((n) => h("option", { value: n, selected: c.nature === n }, `${n} — ${t("controle.nature." + n)}`)));
  nature.addEventListener("change", () => store.modifierControleOperation(op.id, c.id, "nature", nature.value));

  const liens = op.correctives.map((m, j) => {
    const actif = c.correctives.includes(m.id);
    return h("button", { type: "button", class: "pastille-option lien-corrective", "aria-pressed": String(actif), "data-cle": `ctrl-lien-${c.id}-${m.id}`, onclick: () => store.lierCorrective(op.id, c.id, m.id, !actif) },
      icone("loop", 15), h("span", { "data-corr": `${op.id}:${m.id}` }, m.libelle.trim() || t("it.corr.n", { n: j + 1 })));
  });
  const creer = () => {
    focusApres = (q) => {
      const o = q.it.operations.find((x) => x.id === op.id);
      return "corr-libelle-" + o.correctives[o.correctives.length - 1].id;
    };
    store.ajouterCorrective(op.id, c.id);
  };

  return h("section", { class: "carte it-controle" },
    h("div", { class: "it-controle-entete" },
      h("span", { class: "it-triangle", title: t("part.controle") }, icone("tri", 18)),
      h("strong", {}, t("it.ctrl.n", { n: k + 1 })),
      nature,
      boutonRond("trash", t("form.supprimer"), () => store.supprimerControleOperation(op.id, c.id), { classe: "suppr" })),
    zone("ctrl-question-" + c.id, c.question, (v) => store.modifierControleOperation(op.id, c.id, "question", v), { placeholder: t("it.ctrl.question.ph"), label: t("it.ctrl.question") }),
    h("label", { class: "case-ligne" },
      h("input", { type: "checkbox", checked: c.enregistrement, "data-cle": "ctrl-enreg-" + c.id, onchange: (ev) => store.modifierControleOperation(op.id, c.id, "enregistrement", ev.target.checked) }),
      t("it.ctrl.enregistrement")),
    h("div", { class: "it-si-non" },
      h("span", { class: "it-si-non-titre" }, t("it.ctrl.si_non")),
      h("div", { class: "pastilles" },
        ...liens,
        op.correctives.length < MAX_CORRECTIVES ? h("button", { type: "button", class: "pastille-option ajouter", "data-cle": "ctrl-creer-" + c.id, onclick: creer }, icone("plus", 15), t("it.ctrl.creer_corrective")) : null)));
}

// ---------- Colonne « actions correctrices » ----------
function celluleCorrectives(op) {
  const ajouter = () => {
    focusApres = (q) => {
      const o = q.it.operations.find((x) => x.id === op.id);
      return "corr-libelle-" + o.correctives[o.correctives.length - 1].id;
    };
    store.ajouterCorrective(op.id);
  };
  return h("div", { class: "it-pile" },
    ...op.correctives.map((m, k) => carteCorrective(op, m, k)),
    op.correctives.length === 0 ? h("p", { class: "aide" }, t("it.corr.aucune")) : null,
    h("button", { type: "button", class: "discret it-ajout-petit", disabled: op.correctives.length >= MAX_CORRECTIVES, "data-cle": "corr-ajouter-" + op.id, onclick: ajouter }, icone("plus", 15), t("it.corr.ajouter")));
}

function carteCorrective(op, m, k) {
  const liees = op.controles.map((c, j) => (c.correctives.includes(m.id) ? j + 1 : 0)).filter(Boolean);
  return h("section", { class: "carte it-corrective" },
    h("div", { class: "it-controle-entete" },
      h("span", { class: "it-recyclage", title: t("part.corrective") }, icone("loop", 18)),
      h("strong", {}, t("it.corr.n", { n: k + 1 })),
      boutonRond("trash", t("form.supprimer"), () => store.supprimerCorrective(op.id, m.id), { classe: "suppr" })),
    zone("corr-libelle-" + m.id, m.libelle, (v) => store.modifierCorrective(op.id, m.id, "libelle", v), { placeholder: t("it.corr.ph"), label: t("it.corr.libelle") }),
    zone("corr-renvoi-" + m.id, m.renvoi, (v) => store.modifierCorrective(op.id, m.id, "renvoi", v), { placeholder: t("it.corr.renvoi.ph"), label: t("it.corr.renvoi"), classe: "petit" }),
    liees.length
      ? h("p", { class: "it-repond" }, t("it.corr.repond", { liste: liees.join(", ") }))
      : h("p", { class: "it-rappel alerte" }, icone("warn", 15), t("it.corr.orpheline")));
}
