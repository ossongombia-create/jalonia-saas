// formulaire.js — les FORMULAIRES de saisie : étape 1 (identification) et contenu du document (les 11 sections du modèle,
// proposé à l'étape 3), plus les champs partagés (champ, zoneTexte). L'étape 2 (déroulé) est dans deroule.js.
// Il construit des éléments HTML avec document.createElement et les place dans la page.
// Les textes viennent de t() (jamais écrits en dur), et les valeurs saisies sont posées avec
// .value / .textContent (jamais innerHTML) : rien de ce que l'utilisateur tape ne peut devenir du code.

import { t, langueCourante } from "./i18n.js";
import * as store from "./store.js";
import { h } from "./dom.js";
import { preparerLogo } from "./logo.js";
import { icone } from "./icones.js";
import { carte, carteAvec } from "./cartes.js";
import { TYPES_DOCUMENT, SECTIONS, MODELES_TABLEAU, DOMAINES, DOMAINES_ANCIENS, SIGNATAIRES, MAX_REVISIONS } from "./model.js";
import { lire as lireCartographie } from "./cartographie-store.js";
import { codeTypeDuDocument, libelleProcessus, nomenclatureActive, prochainCode, processusDuTexte, processusParCategorie } from "./cartographie.js";

// Champ de saisie : un <textarea> qui GRANDIT avec le texte, pour toujours voir la saisie en entier.
// - Entrée ne crée pas de saut de ligne (un libellé reste une seule phrase) ; un texte collé est mis sur une ligne.
// - spellcheck + lang : le navigateur souligne les fautes d'orthographe dans la langue choisie (FR/EN).
function ajuster(zone) {
  zone.style.height = "auto";
  zone.style.height = zone.scrollHeight + 2 + "px";
}

export function zoneTexte(valeur, quandChange, { placeholder = "", label = "" } = {}) {
  const zone = h("textarea", {
    class: "auto", rows: "1", spellcheck: "true", lang: langueCourante(),
    autocapitalize: "sentences", placeholder, "aria-label": label,
  });
  zone.value = valeur;
  zone.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") ev.preventDefault();
  });
  zone.addEventListener("input", () => {
    if (/[\r\n]/.test(zone.value)) zone.value = zone.value.replace(/\s*[\r\n]+\s*/g, " ");
    ajuster(zone);
    quandChange(zone.value);
  });
  return zone;
}

export function champ(libelle, valeur, quandChange, { placeholder = "", large = false, requis = false } = {}) {
  const zone = zoneTexte(valeur, quandChange, { placeholder, label: libelle });
  return h("label", { class: "champ" + (large ? " large" : "") + (requis ? " requis" : "") }, h("span", {}, libelle), zone);
}

// Après l'affichage, on règle la hauteur de chaque zone (impossible avant : la largeur n'est pas connue).
export function ajusterToutes(conteneur) {
  conteneur.querySelectorAll("textarea.auto").forEach(ajuster);
}
window.addEventListener("resize", () => ajusterToutes(document));

// ---------- Étape 1 : identification ----------
// Un champ date : le navigateur donne la date au format AAAA-MM-JJ, que le document affiche en JJ/MM/AAAA.
function champDate(libelle, valeur, quandChange) {
  const saisie = h("input", { type: "date", value: valeur || "", "aria-label": libelle });
  saisie.addEventListener("change", () => quandChange(saisie.value));
  return h("label", { class: "champ" }, h("span", {}, libelle), saisie);
}

// Tableau « Validation du document » : rédigé / vérifié / approuvé par (nom, fonction, date ; le visa se signe sur le papier).
function blocValidation(m) {
  return carte("check", t("form.validation"),
    h("p", { class: "aide" }, t("form.validation.aide")),
    h("div", { class: "grille g3" },
      ...SIGNATAIRES.map((qui) => h("div", { class: "sous-carte" },
        h("h4", {}, t("valid." + qui)),
        champ(t("valid.ligne.nom"), m.signataires[qui].nom, (v) => store.modifierSignataire(qui, "nom", v)),
        champ(t("valid.ligne.fonction"), m.signataires[qui].fonction, (v) => store.modifierSignataire(qui, "fonction", v)),
        champDate(t("valid.ligne.date"), m.signataires[qui].date, (v) => store.modifierSignataire(qui, "date", v))))));
}

// Historique des révisions : une ligne par version (sans ligne, le document affiche la création initiale).
function blocHistorique(m) {
  const lignes = m.revisions.map((r) => h("div", { class: "sous-carte revision" },
    champ(t("histo.col.version"), r.version, (v) => store.modifierRevision(r.id, "version", v)),
    champDate(t("histo.col.date"), r.date, (v) => store.modifierRevision(r.id, "date", v)),
    champ(t("histo.col.nature"), r.nature, (v) => store.modifierRevision(r.id, "nature", v)),
    champ(t("histo.col.auteur"), r.auteur, (v) => store.modifierRevision(r.id, "auteur", v)),
    h("button", { type: "button", class: "suppr bouton-icone", "aria-label": t("form.supprimer"), title: t("form.supprimer"), onclick: () => store.supprimerRevision(r.id) }, icone("trash", 17))));
  const ajouter = h("button", { type: "button", class: "discret", onclick: () => store.ajouterRevision() }, t("form.revision.ajouter"));
  ajouter.disabled = m.revisions.length >= MAX_REVISIONS;
  return carteAvec({ actions: [ajouter] }, "list", t("histo.titre"),
    h("p", { class: "aide" }, t("form.historique.aide")),
    ...lignes);
}

// Logo de l'organisation : image PNG ou JPEG réduite par le navigateur, placée dans l'en-tête du document.
function blocLogo(m) {
  const message = h("p", { class: "erreur-champ", role: "alert" }, "");
  const fichier = h("input", { type: "file", accept: "image/png,image/jpeg", hidden: true, "aria-label": t("form.logo.choisir") });
  fichier.addEventListener("change", async () => {
    message.textContent = "";
    const f = fichier.files && fichier.files[0];
    if (!f) return;
    try {
      const url = await preparerLogo(f);
      if (!store.definirLogo(url)) message.textContent = t("form.logo.erreur");
    } catch (e) {
      message.textContent = t("form.logo.erreur");
    }
    fichier.value = "";
  });
  return h("div", { class: "champ logo" },
    h("span", {}, t("form.logo")),
    h("div", { class: "depot-logo" + (m.logo ? " rempli" : "") },
      h("span", { class: "depot-icone" }, m.logo ? h("img", { class: "apercu-logo", src: m.logo, alt: t("form.logo.alt") }) : icone("upload", 22)),
      h("div", { class: "depot-texte" }, h("strong", {}, m.logo ? t("form.logo.choisi") : t("form.logo.aucun")), h("span", {}, t("form.logo.aide"))),
      h("div", { class: "depot-actions" },
        h("button", { type: "button", class: "contour", onclick: () => fichier.click() }, t("form.logo.choisir")),
        m.logo ? h("button", { type: "button", class: "suppr", onclick: () => store.definirLogo("") }, t("form.logo.retirer")) : null)),
    fichier,
    message);
}

// Un choix qui change ce que l'étape affiche : on demande au point d'entrée (main.js) de la redessiner.
const redessinerEtape = () => document.dispatchEvent(new Event("redessiner-etape"));
let processusLibre = false; // l'utilisateur a choisi « Autre processus » dans la liste : on affiche la saisie libre

// Processus de rattachement : une liste tirée de la cartographie (quand il y en a une), sinon une saisie libre.
// La valeur enregistrée est le texte « CODE Nom » (ex. « ACH Acheter et gérer les stocks »).
function champProcessus(m) {
  const carto = lireCartographie();
  const libre = champ(t("form.processus"), m.processus, (v) => store.modifierMeta("processus", v), { requis: true, placeholder: t("form.processus.ph") });
  if (carto.processus.length === 0) return libre;
  const choisi = processusDuTexte(carto, m.processus);
  const modeLibre = processusLibre || (!choisi && m.processus.trim() !== "");
  const liste = h("select", { "aria-label": t("form.processus") },
    h("option", { value: "" }, t("form.choisir")),
    ...processusParCategorie(carto).map((g) => h("optgroup", { label: t(g.categorie ? "carto.categorie." + g.categorie : "carto.categorie.aucune") },
      ...g.processus.map((p) => h("option", { value: p.id, selected: !modeLibre && choisi && choisi.id === p.id }, libelleProcessus(p))))),
    h("option", { value: "__autre__", selected: modeLibre }, t("form.processus.autre")));
  liste.addEventListener("change", () => {
    if (liste.value === "__autre__") { processusLibre = true; redessinerEtape(); return; }
    processusLibre = false;
    const p = carto.processus.find((x) => x.id === liste.value);
    store.modifierMeta("processus", p ? libelleProcessus(p) : "");
    if (p && p.categorie) store.modifierMeta("domaine", p.categorie); // le domaine est le bloc du processus dans la cartographie
    redessinerEtape();
  });
  return h("div", { class: "champ requis" },
    h("span", {}, t("form.processus")),
    liste,
    modeLibre ? libre : null,
    h("p", { class: "aide" }, t("form.processus.carto_aide")));
}

// Sous le code : « Proposer le code PR-ACH-01 » (d'après la cartographie et le registre), seulement si l'organisation code ses documents
// TYPE-PROCESSUS-NN (fenêtre Cartographie) ; le code définitif reste attribué par la personne responsable chez l'organisation.
function propositionCode(m) {
  const carto = lireCartographie();
  if (carto.processus.length === 0 || !nomenclatureActive(carto)) return null;
  const processus = processusDuTexte(carto, m.processus);
  const type = codeTypeDuDocument(carto, m.typeDocument);
  if (!processus || !type) return h("p", { class: "aide" }, t("form.code.choisir"));
  const code = prochainCode(carto, type, processus.code, { exclure: (m.reference || "").trim().toUpperCase() });
  const dejaBon = (m.reference || "").trim().toUpperCase() === code;
  return h("div", { class: "proposition-code" },
    h("button", { type: "button", disabled: dejaBon, onclick: () => { store.modifierMeta("reference", code); redessinerEtape(); } }, icone("check", 16, 2.2), t("form.code.proposer", { code })),
    h("span", { class: "aide" }, t("form.code.proposition_aide")));
}

// L'organisation de la cartographie, reprise en un clic quand le champ est vide.
function reprendreOrganisation(m) {
  const carto = lireCartographie();
  if (m.organisation.trim() || !carto.organisation) return null;
  return h("button", { type: "button", class: "lien", onclick: () => { store.modifierMeta("organisation", carto.organisation); redessinerEtape(); } }, t("form.organisation.reprendre", { nom: carto.organisation }));
}

export function rendreIdentification(conteneur) {
  const p = store.lire();
  const m = p.meta;
  const modifier = (cle) => (v) => store.modifierMeta(cle, v);
  const choixType = h("select", { "aria-label": t("form.type_document") },
    h("option", { value: "" }, t("form.choisir")),
    ...TYPES_DOCUMENT.map((k) => h("option", { value: k, selected: m.typeDocument === k }, t("type_document." + k))));
  choixType.addEventListener("change", () => store.modifierMeta("typeDocument", choixType.value));
  const choixDomaine = h("select", { "aria-label": t("form.domaine") },
    h("option", { value: "" }, t("form.choisir")),
    // Management, Réalisation, Support (les blocs de la cartographie) et Vérification ; un ancien domaine (fichier d'avant la v0.20) reste affiché tant qu'on ne le change pas.
    ...[...DOMAINES, ...(DOMAINES_ANCIENS.includes(m.domaine) ? [m.domaine] : [])].map((k) => h("option", { value: k, selected: m.domaine === k }, t("domaine." + k))));
  choixDomaine.addEventListener("change", () => store.modifierMeta("domaine", choixDomaine.value));
  const champSelect = (libelle, select, requis, aide) => h("label", { class: "champ" + (requis ? " requis" : "") }, h("span", {}, libelle), select, aide ? h("small", { class: "aide-champ" }, aide) : null);
  const it = m.typeDocument === "instruction"; // instruction de travail (niveau 3) : mêmes rubriques, textes adaptés, sans validation ni historique
  const k = (cle) => t(it ? cle + "_it" : cle); // variante « instruction » : clé + « _it » (ex. form.titre_it)
  conteneur.replaceChildren(...[
    h("p", { class: "intro" }, k("form.identification.aide")),
    h("div", { class: "colonnes-cartes" },
      carte("id", t("carte.document"),
        champ(t("form.organisation"), m.organisation, modifier("organisation"), { requis: true, placeholder: t("form.organisation.ph") }),
        reprendreOrganisation(m),
        blocLogo(m),
        champ(t("form.direction"), m.direction, modifier("direction"), { placeholder: t("form.direction.ph") }),
        h("div", { class: "grille g2" },
          champSelect(t("form.domaine"), choixDomaine, false, t("form.domaine.aide")),
          champDate(t("form.date_application"), m.dateApplication, modifier("dateApplication")))),
      carte("list", t(it ? "carte.instruction" : "carte.procedure"),
        champProcessus(m),
        champ(t("form.pilote"), m.pilote, modifier("pilote"), { requis: true, placeholder: t("form.pilote.ph") }),
        it ? champ(t("form.auteur"), m.signataires.redige.nom, (v) => store.modifierSignataire("redige", "nom", v), { placeholder: t("form.auteur.ph") }) : null,
        champ(k("form.titre"), m.titre, modifier("titre"), { requis: true, placeholder: k("form.titre.ph") }),
        h("div", { class: "grille g-code" },
          champ(t("form.reference"), m.reference, modifier("reference"), { requis: true, placeholder: k("form.reference.ph") }),
          champ(t("form.version"), m.version, modifier("version")),
          champSelect(t("form.type_document"), choixType, true)),
        propositionCode(m),
        h("p", { class: "aide" }, k("form.reference.aide")),
        it && m.issueDe ? h("p", { class: "aide" }, t("form.issue_de", { texte: m.issueDe })) : null)),
    it ? null : blocValidation(m),
    it ? null : blocHistorique(m),
  ].filter(Boolean)); // replaceChildren écrirait « null » pour un élément absent
  requestAnimationFrame(() => ajusterToutes(conteneur));
}

// ---------- Corps du document : les 11 sections du modèle ----------
// Chaque section est un bloc repliable ; on retient lesquelles sont ouvertes, car le formulaire est
// redessiné quand on ajoute ou supprime quelque chose.
const sectionsOuvertes = new Set();

export function rendreContenu(conteneur) {
  const p = store.lire();
  conteneur.replaceChildren(
    carte("doc", t("synth.contenu"),
      h("p", { class: "aide" }, t("synth.contenu.aide")),
      ...SECTIONS.map((cle, i) => sectionCorps(p, cle, i + 1))));
  requestAnimationFrame(() => ajusterToutes(conteneur));
}

function sectionCorps(p, cle, numero) {
  const blocs = p.corps[cle] || [];
  const details = h("details", { class: "section-corps" },
    h("summary", {}, `${numero}. ${t("doc.section." + cle)}`, h("small", {}, ` — ${t("form.corps.blocs", { n: blocs.filter((b) => b.type !== "genere").length })}`)),
    cle === "logigramme" ? h("p", { class: "aide" }, t("form.corps.logigramme")) : null,
    ...blocs.map((b) => blocCorpsDe(cle, b)),
    h("div", { class: "ajout-bloc" },
      h("button", { type: "button", onclick: () => store.ajouterBloc(cle, "p") }, t("form.bloc.paragraphe")),
      " ",
      MODELES_TABLEAU[cle]
        ? h("button", { type: "button", onclick: () => store.ajouterBloc(cle, "tableau", MODELES_TABLEAU[cle].map((k) => t(`col.${cle}.${k}`))) }, t("form.bloc.tableau_standard"))
        : null,
      " ",
      h("button", { type: "button", onclick: () => store.ajouterBloc(cle, "tableau", [t("col.libre.1"), t("col.libre.2")]) }, t("form.bloc.tableau_libre"))));
  details.open = sectionsOuvertes.has(cle);
  details.addEventListener("toggle", () => {
    if (details.open) sectionsOuvertes.add(cle); else sectionsOuvertes.delete(cle);
  });
  return details;
}

function blocCorpsDe(cle, b) {
  if (b.type === "genere") return h("p", { class: "aide genere" }, t("form.corps.genere_" + cle));
  const commandes = h("div", { class: "commandes-bloc" },
    h("span", {}, t(b.type === "p" ? "form.bloc.texte" : "form.bloc.tableau")),
    h("button", { type: "button", "aria-label": t("form.monter"), onclick: () => store.deplacerBloc(cle, b.id, -1) }, "↑"),
    h("button", { type: "button", "aria-label": t("form.descendre"), onclick: () => store.deplacerBloc(cle, b.id, 1) }, "↓"),
    h("button", { type: "button", class: "suppr", "aria-label": t("form.supprimer"), onclick: () => store.supprimerBloc(cle, b.id) }, "×"));
  const contenu = b.type === "p"
    ? zoneTexte(b.texte, (v) => store.modifierTexteBloc(cle, b.id, v), { label: t("form.bloc.texte") })
    : editeurTableau(cle, b);
  return h("div", { class: "bloc-corps" }, commandes, contenu);
}

function editeurTableau(cle, b) {
  const titres = h("details", { class: "titres-colonnes" },
    h("summary", {}, t("form.bloc.colonnes")),
    ...b.colonnes.map((c, k) => h("div", { class: "ligne-titre" },
      zoneTexte(c, (v) => store.modifierEnTete(cle, b.id, k, v), { label: t("form.bloc.colonne_n", { n: k + 1 }) }),
      h("button", { type: "button", class: "suppr", "aria-label": t("form.supprimer"), onclick: () => store.supprimerColonne(cle, b.id, k) }, "×"))),
    h("button", { type: "button", onclick: () => store.ajouterColonne(cle, b.id) }, t("form.bloc.colonne")));
  const lignes = b.lignes.map((l, i) => h("div", { class: "ligne-tab" },
    h("div", { class: "entete-ligne" }, h("strong", {}, String(i + 1)),
      h("button", { type: "button", class: "suppr", "aria-label": t("form.supprimer"), onclick: () => store.supprimerLigne(cle, b.id, i) }, "×")),
    ...b.colonnes.map((c, k) => champ(c || t("form.bloc.colonne_n", { n: k + 1 }), l[k] || "", (v) => store.modifierCellule(cle, b.id, i, k, v)))));
  return h("div", { class: "tableau-edition" }, titres, ...lignes,
    h("button", { type: "button", onclick: () => store.ajouterLigne(cle, b.id) }, t("form.bloc.ligne")));
}
