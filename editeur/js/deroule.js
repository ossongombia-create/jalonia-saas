// deroule.js — l'étape 2 (déroulé) : à gauche la LISTE (rôles, Début, instructions, Fin), à droite UNE seule fiche à la fois.
// Une instruction se règle en 4 panneaux (échanges, R.A.C.I., outils et informés, particularités) ; chaque particularité
// (contrôle, décision, contrainte…) s'active par une pastille et ouvre sa fiche de détail.
// Les textes viennent de t() ; les valeurs saisies sont posées avec .value / .textContent (jamais innerHTML).
// Le choix de la fiche affichée est un état de l'écran (variable « vue ») : il n'est pas dans la procédure, donc pas dans l'historique annuler/rétablir.

import { t, langueCourante } from "./i18n.js";
import * as store from "./store.js";
import { h } from "./dom.js";
import { icone } from "./icones.js";
import { carte, carteAvec, pointRole } from "./cartes.js";
import { champ, zoneTexte, ajusterToutes } from "./formulaire.js";
import { enregistrerJSON } from "./sorties.js";
import { EN_LIGNE } from "./en-ligne.js";
import { lire as lireCartographie } from "./cartographie-store.js";
import { fluxDuProcessus, libelleProcessus, processusDuTexte } from "./cartographie.js";
import { questionnement } from "./questionnement.js";
import { LETTRES_RACI, lettreRaci, TYPES_MACRO, MAX_ALTERNATIVES_MACRO, TYPES_OUTIL, partiesDeLaFleche, MAX_RISQUES, MAX_OPPORTUNITES, MAX_ALTERNATIVES, NATURES_CONTROLE, NATURES_CONTRAINTE, OPERATEURS, criticite, scoreOpportunite } from "./model.js";

// ---------- État de l'écran ----------
let vue = null; // { type: "roles" | "debut" | "instruction" | "fin", id? }
let selectionEnAttente = null; // (procédure) => vue : choisie AVANT un ajout/suppression, appliquée quand la page est redessinée
let focusEnAttente = null; // "libelle" : place le curseur dans l'intitulé de l'instruction (après un ajout)
let racine = null;

const cleVue = (v) => (v.type === "instruction" ? "instruction:" + v.id : v.type);

// La fiche à afficher : celle demandée si elle existe encore, sinon la plus utile (rôles d'abord s'il n'y en a pas).
function vueValide(p, v) {
  if (v && v.type === "instruction" && p.etapes.some((e) => e.id === v.id)) return v;
  if (v && v.type !== "instruction") return v;
  if (v && v.type === "instruction") return p.etapes.length ? { type: "instruction", id: p.etapes[0].id } : { type: "debut" };
  if (p.roles.length === 0) return { type: "roles" };
  return p.etapes.length ? { type: "instruction", id: p.etapes[0].id } : { type: "debut" };
}

function choisirVue(v) {
  vue = v;
  rendreDeroule(racine);
  const ligne = racine.querySelector(".liste-instructions .selection");
  if (ligne) ligne.scrollIntoView({ block: "nearest" });
}

// ---------- Point d'entrée ----------
export function rendreDeroule(conteneur) {
  racine = conteneur;
  const p = store.lire();
  if (selectionEnAttente) {
    vue = selectionEnAttente(p);
    selectionEnAttente = null;
  }
  vue = vueValide(p, vue);
  // On garde le défilement et la touche active quand on redessine la MÊME fiche (ex. clic sur une pastille).
  const ancien = conteneur.querySelector(".editeur");
  const defilement = ancien && conteneur.dataset.vue === cleVue(vue) ? ancien.scrollTop : 0;
  const cleFocus = document.activeElement && conteneur.contains(document.activeElement) ? document.activeElement.dataset.cle : undefined;
  const defListe = conteneur.querySelector(".liste-instructions");
  const defilementListe = defListe ? defListe.scrollTop : 0;

  const liste = h("aside", { class: "liste-instructions", "aria-label": t("form.deroule.instructions") });
  liste.append(...contenuListe(p));
  const editeur = h("div", { class: "editeur" }, ...contenuVue(p));
  conteneur.replaceChildren(h("div", { class: "deroule" }, liste, editeur));
  conteneur.dataset.vue = cleVue(vue);
  liste.scrollTop = defilementListe;
  editeur.scrollTop = defilement;
  ajusterToutes(conteneur);
  requestAnimationFrame(() => {
    ajusterToutes(conteneur);
    editeur.scrollTop = defilement;
    if (focusEnAttente === "libelle") {
      const zone = conteneur.querySelector(".libelle-grand textarea");
      if (zone) zone.focus();
      focusEnAttente = null;
    } else if (cleFocus) {
      const cible = [...conteneur.querySelectorAll("[data-cle]")].find((el) => el.dataset.cle === cleFocus);
      if (cible) cible.focus({ preventScroll: true });
    }
  });
}

// Rafraîchissement léger (à chaque frappe) : seule la liste de gauche est reconstruite ; la fiche et son curseur ne bougent pas.
export function rafraichirDeroule(conteneur) {
  const liste = conteneur.querySelector(".liste-instructions");
  if (!liste) return;
  const haut = liste.scrollTop;
  liste.replaceChildren(...contenuListe(store.lire()));
  liste.scrollTop = haut;
  rafraichirDestinations(conteneur);
  rafraichirNomsRoles(conteneur);
}

// ---------- La liste de gauche ----------
function contenuListe(p) {
  const nomRole = (r) => r.nom || t("form.role.sans_nom");
  const actif = (v) => cleVue(vue) === cleVue(v);

  const rangeeFixe = (nomIcone, libelle, v) => h("button", {
    type: "button", class: "rangee fixe" + (actif(v) ? " selection" : ""), "aria-current": actif(v) ? "true" : undefined,
    "data-cle": "vue-" + v.type, onclick: () => choisirVue(v),
  }, h("span", { class: "rond-num" }, icone(nomIcone, 15)), h("span", { class: "rangee-texte" }, libelle));

  const rangee = (e, i) => {
    const v = { type: "instruction", id: e.id };
    const iRole = p.roles.findIndex((r) => r.id === e.roleId);
    return h("li", {}, h("button", {
      type: "button", class: "rangee" + (actif(v) ? " selection" : ""), "aria-current": actif(v) ? "true" : undefined,
      "data-cle": "instr-" + e.id, onclick: () => choisirVue(v),
    },
    h("span", { class: "rond-num" }, String(i + 1)),
    h("span", { class: "rangee-texte" + (e.libelle.trim() ? "" : " vide") }, e.libelle.trim() || t("liste.sans_libelle")),
    e.controle.actif ? h("span", { class: "rangee-symbole", title: t("part.controle") }, icone("tri", 14)) : null,
    !e.controle.actif && e.alternatives.length ? h("span", { class: "rangee-symbole", title: t("part.decision") }, icone("dia", 14)) : null,
    iRole >= 0 ? pointRole(iRole) : h("span", { class: "point-role vide", "aria-hidden": "true" })));
  };

  return [
    h("div", { class: "liste-bloc" },
      h("div", { class: "liste-titre" },
        h("span", {}, `${t("form.roles")} · ${p.roles.length}`),
        h("button", { type: "button", class: "lien" + (vue.type === "roles" ? " actif" : ""), "data-cle": "vue-roles", onclick: () => choisirVue({ type: "roles" }) }, t("liste.modifier"))),
      p.roles.length
        ? h("div", { class: "puces" }, ...p.roles.map((r, i) => h("span", { class: "puce" }, pointRole(i), nomRole(r))))
        : h("p", { class: "aide" }, t("panneau.raci.aucun_role"))),
    h("div", { class: "filet" }),
    rangeeFixe("play", t("liste.debut"), { type: "debut" }),
    h("div", { class: "liste-titre" },
      h("span", {}, `${t("liste.instructions")} · ${p.etapes.length}`),
      h("button", { type: "button", class: "bouton-plus", "aria-label": t("liste.ajouter"), title: t("liste.ajouter"), "data-cle": "ajouter", onclick: ajouterInstruction }, icone("plus", 17, 2.2))),
    p.etapes.length
      ? h("ol", { class: "rangees" }, ...p.etapes.map(rangee))
      : h("p", { class: "aide" }, t("liste.aucune")),
    h("button", { type: "button", class: "ajout-rangee", "data-cle": "ajouter-bas", onclick: ajouterInstruction }, icone("plus", 16), t("liste.ajouter")),
    rangeeFixe("stop", t("liste.fin"), { type: "fin" }),
  ];
}

function ajouterInstruction() {
  selectionEnAttente = (p) => ({ type: "instruction", id: p.etapes[p.etapes.length - 1].id });
  focusEnAttente = "libelle";
  store.ajouterEtape();
}

// ---------- La fiche de droite ----------
function contenuVue(p) {
  if (vue.type === "roles") return vueRoles(p);
  if (vue.type === "debut") return vueDebut(p);
  if (vue.type === "fin") return vueFin(p);
  const i = p.etapes.findIndex((e) => e.id === vue.id);
  return vueInstruction(p, p.etapes[i], i);
}

function boutonIcone(nomIcone, libelle, quandClic, { desactive = false, classe = "", cle = "" } = {}) {
  return h("button", { type: "button", class: ("bouton-rond-petit " + classe).trim(), "aria-label": libelle, title: libelle, disabled: desactive, "data-cle": cle || undefined, onclick: quandClic }, icone(nomIcone, 17));
}

// --- Rôles ---
function vueRoles(p) {
  const cartes = p.roles.map((r, i) => {
    const nom = h("input", { value: r.nom, placeholder: t("form.role.placeholder"), "aria-label": t("form.role.nom"), spellcheck: "true", lang: langueCourante() });
    nom.addEventListener("input", () => store.modifierRole(r.id, "nom", nom.value));
    const type = h("select", { "aria-label": t("form.role.type") },
      ...["individuel", "unite", "externe"].map((k) => h("option", { value: k, selected: r.type === k }, t("role.type." + k))));
    type.addEventListener("change", () => store.modifierRole(r.id, "type", type.value));
    return h("section", { class: "carte" },
      h("div", { class: "ligne-role-vue" }, pointRole(i), nom, type,
        boutonIcone("trash", t("form.supprimer"), () => store.supprimerRole(r.id), { classe: "suppr" })),
      champ(t("form.role.service"), r.service || "", (v) => store.modifierRole(r.id, "service", v)),
      champ(t("form.role.responsabilite"), r.responsabilite || "", (v) => store.modifierRole(r.id, "responsabilite", v)));
  });
  return [
    h("p", { class: "intro" }, t("form.roles.aide")),
    h("div", { class: "colonnes-cartes" }, ...cartes),
    h("div", {}, h("button", { type: "button", class: "primaire", onclick: () => store.ajouterRole() }, icone("plus", 17, 2.2), t("form.role.ajouter"))),
  ];
}

// --- Début et Fin ---
// Action hors périmètre (légende Qualigramme) : « amont » au-dessus du Début, « aval » sous la Fin ; le rôle est celui d'où vient
// l'information (amont) ou qui la reçoit (aval). Facultatif : sans texte, rien n'est dessiné.
export function blocRaccord(quel, r, suffixe = "") {
  return h("div", { class: "sous-carte" },
    h("p", { class: "aide" }, t("form." + quel + ".aide" + suffixe)),
    champ(t("form." + quel + ".texte"), r.texte, (v) => store.modifierRaccord(quel, "texte", v), { placeholder: t("form." + quel + ".ph") }),
    champ(t("form." + quel + ".role"), r.role, (v) => store.modifierRaccord(quel, "role", v), { placeholder: t("form.raccord.role.ph") }),
    champ(t("form." + quel + ".information"), r.information || "", (v) => store.modifierRaccord(quel, "information", v), { placeholder: t("form.raccord.information.ph") }));
}

// Selon la cartographie des processus de l'organisation : les informations que le processus de rattachement reçoit (Début) ou fournit (Fin),
// proposées en pastilles. Un clic les reprend dans le champ (à reformuler) ; sans cartographie ni processus reconnu, rien n'est affiché.
function blocCartographie(p, sens, cleMeta) {
  const carto = lireCartographie();
  const processus = processusDuTexte(carto, p.meta.processus);
  if (!processus) return null;
  const liste = fluxDuProcessus(carto, processus.id)[sens === "entrants" ? "entrants" : "sortants"];
  if (liste.length === 0) return null;
  const nomPoint = (pt) => (pt.genre === "processus" ? libelleProcessus(pt.processus) : t("carto.point." + pt.cle));
  const reprendre = (information) => {
    const actuel = String(p.meta[cleMeta] || "").trim();
    if (actuel.toLowerCase().includes(information.toLowerCase())) return; // déjà repris
    store.modifierMeta(cleMeta, actuel ? actuel + " ; " + information : information);
    document.dispatchEvent(new Event("redessiner-etape"));
  };
  return h("div", { class: "sous-carte carto-propositions" },
    h("p", { class: "aide" }, t("deroule.carto." + sens, { processus: libelleProcessus(processus) })),
    h("div", { class: "pastilles" }, ...liste.map((f) => h("button", {
      type: "button", class: "pastille-option carto-pastille", title: t(sens === "entrants" ? "deroule.carto.de" : "deroule.carto.vers", { point: nomPoint(f.point) }),
      onclick: () => reprendre(f.information),
    }, icone("plus", 15, 2.2), h("span", {}, f.information)))),
    h("p", { class: "aide" }, t("deroule.carto.aide")));
}

function vueDebut(p) {
  return [carte("play", t("carte.debut"),
    champ(t("form.declencheur"), p.meta.declencheur, (v) => store.modifierMeta("declencheur", v), { requis: true, placeholder: t("form.declencheur.ph") }),
    blocCartographie(p, "entrants", "declencheur"),
    blocRaccord("amont", p.meta.amont))];
}

function vueFin(p) {
  return [carte("stop", t("carte.fin"),
    champ(t("form.fin"), p.meta.fin, (v) => store.modifierMeta("fin", v), { requis: true, placeholder: t("form.fin.ph") }),
    blocCartographie(p, "sortants", "fin"),
    blocRaccord("aval", p.meta.aval))];
}

// --- Une instruction ---
function selecteurRole(p, e) {
  const i = p.roles.findIndex((r) => r.id === e.roleId);
  const choix = h("select", { class: "choix-role", "aria-label": t("form.etape.role") },
    h("option", { value: "" }, t("form.choisir")),
    ...p.roles.map((r) => h("option", { value: r.id, selected: r.id === e.roleId }, r.nom || t("form.role.sans_nom"))));
  choix.addEventListener("change", () => store.modifierEtape(e.id, "roleId", choix.value));
  return h("div", { class: "select-pastille" }, i >= 0 ? pointRole(i) : h("span", { class: "point-role vide", "aria-hidden": "true" }), choix);
}

function vueInstruction(p, e, i) {
  const total = p.etapes.length;
  const voisin = p.etapes[i + 1] || p.etapes[i - 1];
  const supprimer = () => {
    selectionEnAttente = () => (voisin ? { type: "instruction", id: voisin.id } : { type: "debut" });
    store.supprimerEtape(e.id);
  };
  const dupliquer = () => {
    selectionEnAttente = (q) => ({ type: "instruction", id: q.etapes[i + 1].id });
    store.dupliquerEtape(e.id);
  };
  const entete = h("section", { class: "carte entete-instruction" },
    h("div", { class: "ligne-entete" },
      h("span", { class: "numero-grand" }, String(i + 1)),
      h("span", { class: "position" }, t("liste.instruction_n", { n: i + 1, total })),
      selecteurRole(p, e),
      h("div", { class: "actions-instruction" },
        boutonIcone("chevUp", t("form.monter"), () => store.deplacerEtape(e.id, -1), { desactive: i === 0, cle: "monter" }),
        boutonIcone("chev", t("form.descendre"), () => store.deplacerEtape(e.id, 1), { desactive: i === total - 1, cle: "descendre" }),
        h("span", { class: "separateur-vertical" }),
        boutonIcone("copy", t("form.dupliquer"), dupliquer),
        boutonIcone("trash", t("form.supprimer"), supprimer, { classe: "suppr" }))),
    h("div", { class: "libelle-grand" },
      champ(t("form.etape.libelle"), e.libelle, (v) => store.modifierEtape(e.id, "libelle", v), { requis: true, placeholder: t("form.etape.libelle.placeholder") })));

  const particularites = listeParticularites(p, e);
  const details = particularites.filter((x) => x.actif).map((x) => x.detail());
  const entreeOp = blocEntree(p, e);
  if (entreeOp) details.push(entreeOp);

  return [
    entete,
    panneauEchanges(e),
    panneauRaci(p, e),
    h("div", { class: "grille-panneaux" },
      panneauOutils(e),
      panneauParticularites(p, e, particularites)),
    details.length ? h("div", { class: "details-particularites" }, ...details) : null,
    blocSansObjet(p, e, i),
  ];
}

// Bloc « sans objet » : pour les SEULES alertes actuellement ouvertes sur cette instruction (Comment / Avec quoi / Sous contraintes),
// une case « non applicable » qui retire l'alerte du diagnostic (elle part dans le résumé discret). N'apparaît pas si aucune alerte n'est ouverte.
const POINT_PAR_CLE = { comment: 6, avec: 7, contraintes: 11 };
function blocSansObjet(p, e, i) {
  const q = questionnement(p);
  const num = i + 1;
  const ouverte = (cle) => {
    const pt = q.points.find((x) => x.n === POINT_PAR_CLE[cle]);
    return pt && (pt.manquants.includes(num) || pt.nonApplicables.includes(num));
  };
  const cles = ["comment", "avec", "contraintes"].filter(ouverte);
  if (!cles.length) return null;
  const cases = cles.map((cle) => {
    const input = h("input", { type: "checkbox", checked: (e.sansObjet && e.sansObjet[cle]) === true });
    input.addEventListener("change", () => store.basculerSansObjet(e.id, cle, input.checked));
    return h("label", { class: "case-sansobjet" }, input, h("span", {}, t("quest.na." + cle)));
  });
  return h("section", { class: "carte bloc-sansobjet" },
    h("p", { class: "aide" }, t("part.sansobjet.aide")),
    h("div", { class: "cases-sansobjet" }, ...cases));
}

function panneauEchanges(e) {
  return carte("swap", t("panneau.echanges"),
    h("div", { class: "grille g4" },
      champ(t("form.etape.entree"), e.entree, (v) => store.modifierEtape(e.id, "entree", v)),
      champ(t("form.etape.entree_de"), e.entreeDe, (v) => store.modifierEtape(e.id, "entreeDe", v)),
      champ(t("form.etape.sortie"), e.sortie, (v) => store.modifierEtape(e.id, "sortie", v)),
      champ(t("form.etape.vers_qui"), e.versQui, (v) => store.modifierEtape(e.id, "versQui", v))),
    h("div", { class: "bandeau-info" }, icone("panier", 26, 1.8), h("span", {}, t("panneau.echanges.panier"))));
}

// R.A.C.I. : pour chaque rôle, une liste déroulante (R, A, C, I ou non concerné). Les lettres sont stockées par le store (definirRaci).
function panneauRaci(p, e) {
  const lignes = p.roles.map((r, i) => {
    const nom = r.nom || t("form.role.sans_nom");
    const choix = h("select", { class: "choix-raci", "aria-label": t("form.raci.role", { nom }) },
      h("option", { value: "" }, t("form.raci.aucun")),
      ...LETTRES_RACI.map((l) => h("option", { value: l, selected: lettreRaci(e, r.id) === l }, t("raci." + l))));
    choix.addEventListener("change", () => store.definirRaci(e.id, r.id, choix.value));
    return h("label", { class: "ligne-raci" }, h("span", { class: "nom-role" }, pointRole(i), h("span", { "data-role": r.id }, nom)), choix);
  });
  return carte("users", t("form.raci.titre"),
    h("p", { class: "aide" }, t("form.raci.aide")),
    p.roles.length ? h("div", { class: "liste-raci" }, ...lignes) : h("p", { class: "aide" }, t("panneau.raci.aucun_role")));
}

// Outils utilisés par l'instruction : document (rectangle ondulé) ou matériel (triangle) ; et les informés qui ne sont pas des rôles.
function panneauOutils(e) {
  const lignes = e.outils.map((o) => {
    const type = h("select", { "aria-label": t("form.outil.type") },
      ...TYPES_OUTIL.map((k) => h("option", { value: k, selected: o.type === k }, t("outil.type." + k))));
    type.addEventListener("change", () => store.modifierOutil(e.id, o.id, "type", type.value));
    const nom = zoneTexte(o.nom, (v) => store.modifierOutil(e.id, o.id, "nom", v),
      { placeholder: t("form.outil.placeholder." + o.type), label: t("form.outil.nom") });
    return h("div", { class: "ligne-outil " + o.type }, type, nom,
      boutonIcone("trash", t("form.supprimer"), () => store.supprimerOutil(e.id, o.id), { classe: "suppr" }));
  });
  return carte("doc", t("panneau.outils"),
    h("p", { class: "aide" }, t("form.outils.aide")),
    ...lignes,
    h("div", { class: "boutons-ligne" },
      h("button", { type: "button", class: "discret", onclick: () => store.ajouterOutil(e.id, "document") }, t("form.outil.ajouter_document")),
      h("button", { type: "button", class: "discret", onclick: () => store.ajouterOutil(e.id, "materiel") }, t("form.outil.ajouter_materiel"))),
    champ(t("form.etape.informes"), e.informes.join(", "),
      (v) => store.modifierEtape(e.id, "informes", v.split(",").map((s) => s.trim()).filter(Boolean))));
}

// --- Particularités : une pastille par symbole du logigramme ---
function listeParticularites(p, e) {
  const detail = (cle, nomIcone, contenu, retirer, largeur = "") => carteDetail(cle, nomIcone, t("part." + cle), retirer, largeur, ...contenu);
  return [
    { cle: "controle", icone: "tri", aide: "form.controle.case", actif: e.controle.actif,
      bascule: (v) => store.modifierControle(e.id, "actif", v),
      detail: () => detail("controle", "tri", detailControle(e), () => store.modifierControle(e.id, "actif", false)) },
    { cle: "decision", icone: "dia", aide: "form.decision.case", actif: e.alternatives.length > 0, desactive: e.controle.actif,
      bascule: (v) => basculerDecision(e, v),
      detail: () => detail("decision", "dia", detailDecision(p, e), () => basculerDecision(e, false), "large") },
    { cle: "contrainte", icone: "circplus", aide: "form.contrainte.case", actif: e.contrainte.actif,
      bascule: (v) => store.modifierContrainte(e.id, "actif", v),
      detail: () => detail("contrainte", "circplus", detailContrainte(e), () => store.modifierContrainte(e.id, "actif", false)) },
    { cle: "corrective", icone: "loop", aide: "form.correctrice.case", actif: e.correctrice === true,
      bascule: (v) => store.basculerCorrectrice(e.id, v),
      detail: () => detail("corrective", "loop", [h("p", { class: "aide" }, t("form.correctrice.aide"))], () => store.basculerCorrectrice(e.id, false)) },
    { cle: "indicateur", icone: "flag", aide: "form.indicateur.case", actif: e.indicateur.actif,
      bascule: (v) => store.modifierIndicateur(e.id, "actif", v),
      detail: () => detail("indicateur", "flag", detailIndicateur(e), () => store.modifierIndicateur(e.id, "actif", false)) },
    { cle: "contrat", icone: "contrat", aide: "form.contrat.case", actif: e.contrat.actif,
      bascule: (v) => store.modifierContrat(e.id, "actif", v),
      detail: () => detail("contrat", "contrat", detailContrat(p, e), () => store.modifierContrat(e.id, "actif", false)) },
    { cle: "risques", icone: "warn", aide: "form.risque.case", actif: e.risques.length > 0,
      bascule: (v) => basculerRisques(e, v),
      detail: () => detail("risques", "warn", detailRisques(e), () => basculerRisques(e, false), "large") },
    { cle: "opportunite", icone: "bulb", aide: "form.opportunite.case", actif: (e.opportunites || []).length > 0,
      bascule: (v) => basculerOpportunites(e, v),
      detail: () => detail("opportunite", "bulb", detailOpportunites(e), () => basculerOpportunites(e, false), "large") },
    { cle: "niveau3", icone: "layers", aide: "form.n3.case", actif: e.niveau3.actif,
      bascule: (v) => store.modifierNiveau3(e.id, "actif", v),
      detail: () => detail("niveau3", "layers", detailNiveau3(e), () => store.modifierNiveau3(e.id, "actif", false)) },
    { cle: "sousprocedure", icone: "subp", aide: "form.sp.case", actif: e.sousProcedure.actif,
      bascule: (v) => store.modifierSousProcedure(e.id, "actif", v),
      detail: () => detail("sousprocedure", "subp", detailSousProcedure(e), () => store.modifierSousProcedure(e.id, "actif", false)) },
    { cle: "macro", icone: "macro", aide: "form.macro.titre", actif: Boolean(e.macro.type),
      bascule: (v) => store.definirMacro(e.id, v ? "regroupement" : ""),
      detail: () => detail("macro", "macro", detailMacro(e), () => store.definirMacro(e.id, ""))},
  ];
}

function panneauParticularites(p, e, liste) {
  const pastilles = liste.map((x) => h("button", {
    type: "button", class: "pastille-option", "aria-pressed": String(x.actif), disabled: x.desactive || undefined,
    title: x.desactive ? t("part.decision.controle") : t(x.aide), "data-cle": "part-" + x.cle,
    onclick: () => x.bascule(!x.actif),
  }, icone(x.icone, 16), t("part." + x.cle)));
  return carte("layers", t("part.titre"),
    h("p", { class: "aide" }, t("part.aide")),
    h("div", { class: "pastilles" }, ...pastilles),
    !e.niveau3.actif && e.risques.length > 0 ? h("p", { class: "aide" }, t("form.n3.suggestion")) : null);
}

// Une fiche de détail : son titre, un bouton pour la retirer, puis ses champs.
function carteDetail(cle, nomIcone, titre, retirer, largeur, ...contenu) {
  const bouton = retirer ? boutonIcone("close", t("part.retirer"), retirer, { cle: "retirer-" + cle }) : null;
  const fiche = carteAvec({ classe: "detail " + largeur, actions: bouton ? [bouton] : [] }, nomIcone, titre, ...contenu);
  fiche.dataset.detail = cle;
  return fiche;
}

// Décision : confirmation si des suites ont déjà été saisies.
function basculerDecision(e, actif) {
  if (!actif) {
    const rempli = e.condition.trim() || e.alternatives.some((a) => a.condition.trim() || a.info.trim() || a.vers);
    if (rempli && !confirm(t("form.decision.confirmer"))) return;
  }
  store.basculerDecision(e.id, actif);
}

// Risques : confirmation si un risque a déjà été saisi.
function basculerRisques(e, actif) {
  if (!actif && e.risques.some((r) => r.risque.trim() || r.mesure.trim() || r.causes.trim())) {
    if (!confirm(t("form.risque.confirmer"))) return;
  }
  store.basculerRisques(e.id, actif);
}

// Opportunités : confirmation si une opportunité a déjà été saisie.
function basculerOpportunites(e, actif) {
  if (!actif && (e.opportunites || []).some((o) => o.opportunite.trim() || o.benefice.trim())) {
    if (!confirm(t("form.opportunite.confirmer"))) return;
  }
  store.basculerOpportunites(e.id, actif);
}

function detailControle(e) {
  const c = e.controle;
  const nature = h("select", { "aria-label": t("form.controle.nature") },
    h("option", { value: "" }, t("form.choisir")),
    ...NATURES_CONTROLE.map((k) => h("option", { value: k, selected: c.nature === k }, `${k} — ${t("controle.nature." + k)}`)));
  nature.addEventListener("change", () => store.modifierControle(e.id, "nature", nature.value));
  return [
    h("p", { class: "aide" }, t("form.controle.aide")),
    h("label", { class: "champ requis" }, h("span", {}, t("form.controle.nature")), nature),
    champ(t("form.controle.critere"), c.critere, (v) => store.modifierControle(e.id, "critere", v), { requis: true, placeholder: t("form.controle.critere.ph") }),
    champ(t("form.controle.enregistrement"), c.enregistrement, (v) => store.modifierControle(e.id, "enregistrement", v), { placeholder: t("form.controle.enregistrement.ph") }),
  ];
}

function detailContrainte(e) {
  const c = e.contrainte;
  const nature = h("select", { "aria-label": t("form.contrainte.nature") },
    ...NATURES_CONTRAINTE.map((k) => h("option", { value: k, selected: c.nature === k }, t("contrainte.nature." + k))));
  nature.addEventListener("change", () => store.modifierContrainte(e.id, "nature", nature.value));
  return [
    h("p", { class: "aide" }, t("form.contrainte.aide")),
    h("label", { class: "champ" }, h("span", {}, t("form.contrainte.nature")), nature),
    champ(t("form.contrainte.texte"), c.texte, (v) => store.modifierContrainte(e.id, "texte", v), { requis: true, placeholder: t("form.contrainte.texte.ph") }),
  ];
}

// Indicateur d'interface : le contrat qui régit la flèche de sortie. On montre les deux parties, pour que le choix soit évident.
function detailContrat(p, e) {
  const i = p.etapes.findIndex((x) => x.id === e.id);
  const { de, vers, memeRole } = partiesDeLaFleche(p, i);
  const parties = de || vers
    ? h("p", { class: "aide" }, t("form.contrat.parties", { de: de || "?", vers: vers || "?" }))
    : null;
  return [
    h("p", { class: "aide" }, t("form.contrat.aide")),
    parties,
    memeRole ? h("p", { class: "aide alerte-douce" }, t("form.contrat.meme_role", { role: de })) : null,
    champ(t("form.contrat.reference"), e.contrat.reference, (v) => store.modifierContrat(e.id, "reference", v), { requis: true, placeholder: t("form.contrat.reference.ph") }),
  ].filter(Boolean);
}

function detailIndicateur(e) {
  return [
    h("p", { class: "aide" }, t("form.indicateur.aide")),
    champ(t("form.indicateur.nom"), e.indicateur.nom, (v) => store.modifierIndicateur(e.id, "nom", v), { requis: true, placeholder: t("form.indicateur.nom.ph") }),
    champ(t("form.indicateur.formule"), e.indicateur.formule || "", (v) => store.modifierIndicateur(e.id, "formule", v), { placeholder: t("form.indicateur.formule.ph") }),
    h("div", { class: "grille g2" },
      champ(t("form.indicateur.cible"), e.indicateur.cible || "", (v) => store.modifierIndicateur(e.id, "cible", v), { placeholder: t("form.indicateur.cible.ph") }),
      champ(t("form.indicateur.frequence"), e.indicateur.frequence || "", (v) => store.modifierIndicateur(e.id, "frequence", v), { placeholder: t("form.indicateur.frequence.ph") })),
  ];
}

function detailSousProcedure(e) {
  return [
    h("p", { class: "aide" }, t("form.sp.aide")),
    champ(t("form.sp.code"), e.sousProcedure.code, (v) => store.modifierSousProcedure(e.id, "code", v), { requis: true, placeholder: t("form.sp.code.ph") }),
  ];
}

function detailNiveau3(e) {
  const n3 = e.niveau3;
  return [
    h("p", { class: "aide" }, t("form.n3.aide")),
    champ(t("form.n3.code"), n3.code, (v) => store.modifierNiveau3(e.id, "code", v), { requis: true, placeholder: t("form.n3.code.ph") }),
    champ(t("form.n3.intitule"), n3.intitule, (v) => store.modifierNiveau3(e.id, "intitule", v), { placeholder: t("form.n3.intitule.ph") }),
    h("div", { class: "n3-creer" },
      h("button", { type: "button", class: "contour", onclick: () => creerInstructionDeTravail(e.id) }, icone("doc", 17), t("form.n3.creer")),
      h("p", { class: "aide" }, EN_LIGNE ? t("enligne.n3.aide") : t("form.n3.creer.aide"))),
  ];
}

// Raccourci « Créer l'instruction de travail » : la procédure est d'abord enregistrée en fichier (rien n'est perdu), puis une
// instruction de travail préremplie s'ouvre à sa place. main.js écoute l'événement pour rouvrir le parcours à la bonne étape.
// En ligne : l'instruction devient un NOUVEAU document de l'organisation (en-ligne-ui.js s'en charge, la procédure reste intacte).
function creerInstructionDeTravail(etapeId) {
  if (EN_LIGNE) {
    document.dispatchEvent(new CustomEvent("creer-instruction", { detail: { etapeId } }));
    return;
  }
  if (!confirm(t("form.n3.creer.confirmer"))) return;
  enregistrerJSON();
  if (store.creerInstructionDepuisEtape(etapeId)) document.dispatchEvent(new CustomEvent("document-remplace"));
}

// Macro-instruction : « regroupement » (bord double) ou « alternatives » (cadre gras, un compartiment par alternative exclusive).
function detailMacro(e) {
  const m = e.macro;
  const choix = h("select", { "aria-label": t("form.macro.type") },
    ...TYPES_MACRO.map((k) => h("option", { value: k, selected: m.type === k }, t("form.macro.type." + k))));
  choix.addEventListener("change", () => store.definirMacro(e.id, choix.value));
  const compartiments = m.type === "alternatives"
    ? m.alternatives.map((a, k) => h("div", { class: "ligne-alt-macro" },
      zoneTexte(a, (v) => store.modifierAlternativeMacro(e.id, k, v), { placeholder: t("form.macro.alt.ph", { n: k + 1 }), label: t("form.macro.alt", { n: k + 1 }) }),
      boutonIcone("trash", t("form.supprimer"), () => store.supprimerAlternativeMacro(e.id, k), { classe: "suppr" })))
    : [];
  return [
    h("label", { class: "champ" }, h("span", {}, t("form.macro.titre")), choix),
    h("p", { class: "aide" }, t("form.macro.aide." + m.type)),
    ...compartiments,
    m.type === "alternatives" && m.alternatives.length < MAX_ALTERNATIVES_MACRO
      ? h("div", {}, h("button", { type: "button", class: "discret", onclick: () => store.ajouterAlternativeMacro(e.id) }, t("form.macro.ajouter"))) : null,
    m.type === "regroupement" ? champ(t("form.macro.detail"), m.detail, (v) => store.modifierMacroDetail(e.id, v), { placeholder: t("form.macro.detail.ph") }) : null,
  ];
}

// Opérateur d'entrée (ET / OU) : proposé seulement quand une autre instruction renvoie vers celle-ci (donc plusieurs flèches y arrivent).
function blocEntree(p, e) {
  const renvoi = p.etapes.some((x) => x.alternatives.some((a) => a.vers === e.id));
  if (!renvoi && !e.operateurEntree) return null;
  const choix = h("select", { "aria-label": t("form.entree.operateur") },
    h("option", { value: "" }, t("form.entree.operateur.aucun")),
    ...OPERATEURS.map((k) => h("option", { value: k, selected: e.operateurEntree === k }, t("form.entree.operateur." + k))));
  choix.addEventListener("change", () => store.modifierOperateurEntree(e.id, choix.value));
  return carteDetail("entree", "swap", t("form.entree.operateur"), null, "", h("label", { class: "champ" }, h("span", {}, t("form.entree.operateur")), choix));
}

// Texte d'une destination possible pour une alternative (« Instruction 3 : Vérifier le document »).
function libelleDestination(p, k) {
  return t("form.decision.alt.instruction", { n: k + 1, libelle: p.etapes[k].libelle.trim() || "…" });
}

// Les listes de destinations montrent le libellé des autres instructions : on les met à jour quand on tape ces libellés
// (sans redessiner la fiche, ce qui ferait perdre le curseur).
export function rafraichirDestinations(conteneur) {
  const p = store.lire();
  conteneur.querySelectorAll("select.destination").forEach((sel) => {
    [...sel.options].forEach((o) => {
      const k = o.value && o.value !== "fin" ? p.etapes.findIndex((x) => x.id === o.value) : -1;
      if (k >= 0) o.textContent = libelleDestination(p, k);
    });
  });
}

// Les noms de rôles tapés dans la fiche « Rôles » se retrouvent dans les listes des instructions sans redessiner le formulaire.
export function rafraichirNomsRoles(conteneur) {
  const p = store.lire();
  const nom = (id) => {
    const r = p.roles.find((x) => x.id === id);
    return r ? r.nom || t("form.role.sans_nom") : null;
  };
  conteneur.querySelectorAll("select.choix-role option").forEach((o) => {
    const n = o.value ? nom(o.value) : null;
    if (n !== null) o.textContent = n;
  });
  conteneur.querySelectorAll("span[data-role]").forEach((el) => {
    const n = nom(el.dataset.role);
    if (n !== null) el.textContent = n;
  });
}

// Décision : nom de la suite normale + alternatives (retour, saut, fin).
function detailDecision(p, e) {
  const et = e.operateurSortie === "et";
  const cartes = e.alternatives.map((a, k) => {
    const vers = h("select", { class: "destination", "aria-label": t("form.decision.alt.vers") },
      h("option", { value: "" }, t("form.choisir")),
      h("option", { value: "fin", selected: a.vers === "fin" }, t("form.decision.alt.fin")),
      ...p.etapes.map((x, j) => (x.id === e.id ? null : h("option", { value: x.id, selected: a.vers === x.id }, libelleDestination(p, j)))));
    vers.addEventListener("change", () => store.modifierAlternative(e.id, a.id, "vers", vers.value));
    return h("div", { class: "sous-carte" },
      h("div", { class: "entete-sous" }, h("strong", {}, t("form.decision.alt_n", { n: k + 1 })),
        boutonIcone("trash", t("form.supprimer"), () => store.supprimerAlternative(e.id, a.id), { classe: "suppr" })),
      h("div", { class: "grille g2" },
        champ(t("form.decision.alt.condition"), a.condition, (v) => store.modifierAlternative(e.id, a.id, "condition", v), { requis: !et }),
        h("label", { class: "champ requis" }, h("span", {}, t("form.decision.alt.vers")), vers),
        champ(t("form.decision.alt.info"), a.info, (v) => store.modifierAlternative(e.id, a.id, "info", v)),
        champ(t("form.decision.alt.vers_qui"), a.versQui, (v) => store.modifierAlternative(e.id, a.id, "versQui", v))));
  });
  const operateur = h("select", { "aria-label": t("form.decision.operateur") },
    ...OPERATEURS.map((k) => h("option", { value: k, selected: e.operateurSortie === k }, t("form.decision.operateur." + k))));
  operateur.addEventListener("change", () => store.modifierOperateurSortie(e.id, operateur.value));
  return [
    h("p", { class: "aide" }, t(et ? "form.decision.aide_et" : "form.decision.aide")),
    h("div", { class: "grille g2" },
      !e.controle.actif ? h("label", { class: "champ" }, h("span", {}, t("form.decision.operateur")), operateur) : null,
      champ(t("form.decision.condition"), e.condition, (v) => store.modifierEtape(e.id, "condition", v), { requis: !et })),
    ...cartes,
    e.alternatives.length < MAX_ALTERNATIVES
      ? h("div", {}, h("button", { type: "button", class: "discret", onclick: () => store.ajouterAlternative(e.id) }, t("form.decision.ajouter"))) : null,
  ];
}

// Risques maîtrisés : risque(s) + mesure de maîtrise → section 10.
function detailRisques(e) {
  const cartes = e.risques.map((r, k) => {
    const cote = (nom, valeur) => {
      const sel = h("select", { "aria-label": t("form.risque." + nom) },
        h("option", { value: "" }, t("form.cote.choisir")),
        ...["1", "2", "3", "4"].map((v) => h("option", { value: v, selected: valeur === v }, v)));
      sel.addEventListener("change", () => store.modifierRisque(e.id, r.id, nom, sel.value));
      return h("label", { class: "champ" }, h("span", {}, t("form.risque." + nom)), sel);
    };
    const c = criticite(r);
    return h("div", { class: "sous-carte" },
      h("div", { class: "entete-sous" }, h("strong", {}, t("form.risque.n", { n: k + 1 })),
        boutonIcone("trash", t("form.supprimer"), () => store.supprimerRisque(e.id, r.id), { classe: "suppr" })),
      champ(t("form.risque.risque"), r.risque, (v) => store.modifierRisque(e.id, r.id, "risque", v), { requis: true, placeholder: t("form.risque.risque.ph") }),
      champ(t("form.risque.causes"), r.causes, (v) => store.modifierRisque(e.id, r.id, "causes", v)),
      h("div", { class: "cotes" }, cote("gravite", r.gravite), cote("probabilite", r.probabilite),
        c ? h("span", { class: "criticite " + c.niveau }, t("form.risque.criticite", { g: c.g, p: c.p, v: c.valeur, niveau: t("risque.niveau." + c.niveau) })) : null),
      champ(t("form.risque.mesure"), r.mesure, (v) => store.modifierRisque(e.id, r.id, "mesure", v), { requis: true, placeholder: t("form.risque.mesure.ph") }));
  });
  return [
    h("p", { class: "aide" }, t("form.risque.aide")),
    ...cartes,
    e.risques.length < MAX_RISQUES
      ? h("div", {}, h("button", { type: "button", class: "discret", onclick: () => store.ajouterRisque(e.id) }, t("form.risque.ajouter"))) : null,
  ];
}

// Opportunités d'amélioration : intitulé + bénéfice, cotées intérêt × faisabilité → section 9 (v0.28).
function detailOpportunites(e) {
  const liste = e.opportunites || [];
  const cartes = liste.map((o, k) => {
    const cote = (nom, valeur) => {
      const sel = h("select", { "aria-label": t("form.opportunite." + nom) },
        h("option", { value: "" }, t("form.cote.choisir")),
        ...["1", "2", "3"].map((v) => h("option", { value: v, selected: valeur === v }, v)));
      sel.addEventListener("change", () => store.modifierOpportunite(e.id, o.id, nom, sel.value));
      return h("label", { class: "champ" }, h("span", {}, t("form.opportunite." + nom)), sel);
    };
    const s = scoreOpportunite(o);
    return h("div", { class: "sous-carte" },
      h("div", { class: "entete-sous" }, h("strong", {}, t("form.opportunite.n", { n: k + 1 })),
        boutonIcone("trash", t("form.supprimer"), () => store.supprimerOpportunite(e.id, o.id), { classe: "suppr" })),
      champ(t("form.opportunite.opportunite"), o.opportunite, (v) => store.modifierOpportunite(e.id, o.id, "opportunite", v), { requis: true, placeholder: t("form.opportunite.opportunite.ph") }),
      champ(t("form.opportunite.benefice"), o.benefice, (v) => store.modifierOpportunite(e.id, o.id, "benefice", v), { placeholder: t("form.opportunite.benefice.ph") }),
      h("div", { class: "cotes" }, cote("interet", o.interet), cote("faisabilite", o.faisabilite),
        s ? h("span", { class: "score-opp " + s.suite }, t("form.opportunite.score", { i: s.i, f: s.f, v: s.valeur, suite: t("opportunite.suite." + s.suite) })) : null));
  });
  return [
    h("p", { class: "aide" }, t("form.opportunite.aide")),
    ...cartes,
    liste.length < MAX_OPPORTUNITES
      ? h("div", {}, h("button", { type: "button", class: "discret", onclick: () => store.ajouterOpportunite(e.id) }, t("form.opportunite.ajouter"))) : null,
  ];
}
