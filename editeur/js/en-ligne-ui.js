// en-ligne-ui.js — l'éditeur EN LIGNE, dans l'application web de l'organisation :
//   - ouverture : le document (?doc=…) et la cartographie de l'organisation viennent du serveur, avec les droits de la personne ;
//     ?vue=cartographie ouvre la cartographie seule ;
//   - enregistrement automatique sur le serveur (synchro.js) : un état « Enregistré / Enregistrement… » dans l'en-tête ;
//   - lecture seule pour les rôles qui consultent sans rédiger (le document peut être vu, prévisualisé, exporté en Word et PDF),
//     et pour tout document qui n'est plus un brouillon (circuit de validation : en vérification, en approbation, publié, archivé) ;
//   - quand l'enregistrement est refusé (conflit, session expirée…), une fenêtre explique quoi faire ; le travail reste dans la page
//     et peut toujours être téléchargé en .json ;
//   - « Mes documents » ramène à la liste, après avoir enregistré.
// Tout est construit avec h() et des textes de t() : jamais de HTML injecté.

import * as store from "./store.js";
import { definirValidationCircuit } from "./signataires.js";
import * as cartographie from "./cartographie-store.js";
import { t, definirLangue, langueCourante } from "./i18n.js";
import { h } from "./dom.js";
import { appeler } from "./serveur.js";
import { creerSynchro } from "./synchro.js";
import { empreinteDocument, instructionDepuisEtape } from "./model.js";
import { enregistrerJSON } from "./sorties.js";
import { ouvrirCartographie } from "./cartographie-ui.js";

const $ = (id) => document.getElementById(id);
export const PAGE_DOCUMENTS = "/app/documents";
const MOTIF_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRIORITE = { inactif: 0, enregistre: 1, modifie: 2, envoi: 3, erreur_reseau: 4, bloque: 5 };
const ETATS_FIGES = ["en_verification", "en_approbation", "publie", "archive"]; // circuit de validation : seul un brouillon se modifie

let organisation = null; // { id, nom }
let documentId = null;
let synchroDoc = null;
let synchroCarto = null;
let lectureSeule = false;
let cartoLectureSeule = false;
let cartoSeule = false;
let departAutorise = false;
const blocagesOuverts = { document: null, cartographie: null }; // raison du blocage déjà expliqué (on ne rouvre pas la fenêtre à chaque frappe)

const contexteApi = (doc) => "/api/editeur/contexte" + (doc ? "?doc=" + encodeURIComponent(doc) : "");

// ---------- Écran d'ouverture (chargement, erreur) ----------
function afficherAttente(texte) {
  $("ecran-en-ligne-texte").textContent = texte;
  $("ecran-en-ligne-actions").replaceChildren();
}

function erreurOuverture(cle) {
  $("ecran-en-ligne-texte").textContent = t(cle);
  // replaceChildren écrirait « null » pour un élément absent : on ne passe que les éléments présents.
  $("ecran-en-ligne-actions").replaceChildren(...[
    cle === "enligne.erreur.reseau" ? h("button", { type: "button", onclick: () => location.reload() }, t("enligne.reessayer")) : null,
    h("a", { href: PAGE_DOCUMENTS }, t("enligne.retour_documents")),
  ].filter(Boolean));
  $("ecran-en-ligne").setAttribute("data-erreur", "");
}

// Ce que veut dire un refus à l'ouverture.
function cleErreurOuverture(r) {
  const erreur = r.corps && r.corps.erreur;
  if (r.statut === 404) return "enligne.erreur.introuvable";
  if (r.statut === 403 && erreur === "organisation") return "enligne.erreur.organisation";
  if (r.statut === 403) return "enligne.erreur.interdit";
  return "enligne.erreur.reseau";
}

// ---------- Lecture seule : les champs ne se modifient pas ----------
// Le magasin défait de toute façon chaque tentative (store.verrouiller) ; ici, on rend les champs non modifiables à l'écran.
function figer(conteneur) {
  conteneur.querySelectorAll("textarea, input, select").forEach((el) => {
    if (el.tagName === "SELECT" || ["checkbox", "radio", "file", "color", "range"].includes(el.type)) el.disabled = true;
    else el.readOnly = true;
  });
}
function figerEnPermanence(conteneur) {
  figer(conteneur);
  new MutationObserver(() => figer(conteneur)).observe(conteneur, { childList: true, subtree: true });
}

// ---------- État de l'enregistrement ----------
function dateLisible(valeur) {
  const d = new Date(valeur);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(langueCourante() === "en" ? "en-GB" : "fr-FR", { dateStyle: "short", timeStyle: "short" });
}

function texteEtat(e, lecture) {
  if (!e || e.cle === "inactif") return lecture ? t("enligne.etat.lecture_seule") : "";
  return t("enligne.etat." + e.cle);
}

function pire(etats) {
  return etats.filter(Boolean).reduce((a, b) => (PRIORITE[b.cle] > PRIORITE[a.cle] ? b : a), { cle: "inactif" });
}

function afficherEtats() {
  const enTete = $("etat-synchro");
  const global = pire([synchroDoc && synchroDoc.etat(), synchroCarto && synchroCarto.etat()]);
  // Document en lecture seule : l'en-tête le dit, même si la cartographie (enregistrée à part) est modifiable — sauf
  // quand celle-ci a quelque chose à signaler (modification en cours d'envoi, coupure, refus).
  const lectureDoc = lectureSeule && (global.cle === "inactif" || global.cle === "enregistre");
  enTete.dataset.etat = lectureDoc || global.cle === "inactif" ? "lecture" : global.cle;
  enTete.textContent = lectureDoc ? t("enligne.etat.lecture_seule") : texteEtat(global, lectureSeule);
  const carto = $("carto-etat");
  const etatCarto = synchroCarto ? synchroCarto.etat() : null;
  carto.dataset.etat = etatCarto ? etatCarto.cle : "lecture";
  carto.textContent = texteEtat(etatCarto, cartoLectureSeule);
}

function surChangement(genre, synchro, e) {
  afficherEtats();
  if (e.cle !== "bloque") {
    blocagesOuverts[genre] = null;
    return;
  }
  if (blocagesOuverts[genre] === e.raison) return;
  blocagesOuverts[genre] = e.raison;
  expliquerBlocage(genre, synchro, e);
}

// ---------- Fenêtre « non enregistré » : ce qui s'est passé, ce que la personne peut faire ----------
function telechargerCopie(genre) {
  if (genre === "document") {
    enregistrerJSON();
    return;
  }
  const c = cartographie.lire();
  const base = (c.organisation || "cartographie").replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "cartographie";
  const lien = h("a", { href: URL.createObjectURL(new Blob([cartographie.exporterJSON()], { type: "application/json" })), download: `cartographie-${base}.json` });
  document.body.appendChild(lien);
  lien.click();
  lien.remove();
  setTimeout(() => URL.revokeObjectURL(lien.href), 2000);
}

function expliquerBlocage(genre, synchro, e) {
  const fenetre = $("fenetre-synchro");
  const fermer = () => fenetre.close();
  const bouton = (texte, action, classe = "") => h("button", { type: "button", class: classe, onclick: action }, texte);
  const copie = bouton(t(genre === "cartographie" ? "enligne.copie_carto" : "enligne.copie_json"), () => telechargerCopie(genre));
  const reessayer = bouton(t("enligne.reessayer"), () => { fermer(); synchro.reessayer(); }, "primaire");
  const retour = bouton(t("enligne.retour_documents"), () => { departAutorise = true; location.href = PAGE_DOCUMENTS; });
  const textes = [];
  const boutons = [];
  const d = e.details || {};
  const auteur = d.modifieParNom || t("enligne.quelquun");
  switch (e.raison) {
    case "conflit":
      textes.push(t("enligne.bloque.conflit", { auteur, date: dateLisible(d.modifieLe) }), t("enligne.bloque.conflit.choix", { auteur }));
      boutons.push(bouton(t("enligne.recharger"), () => { fermer(); recharger(genre); }), bouton(t("enligne.garder"), () => { fermer(); synchro.garderMaVersion(); }, "primaire"));
      break;
    case "session":
      textes.push(t("enligne.bloque.session"));
      boutons.push(h("a", { href: "/connexion", target: "_blank", rel: "noopener", class: "lien-bouton" }, t("enligne.se_reconnecter")), reessayer);
      break;
    case "organisation_changee":
      textes.push(t("enligne.bloque.organisation_changee", { organisation: organisation ? organisation.nom : "" }));
      boutons.push(copie, reessayer);
      break;
    case "introuvable":
      textes.push(t("enligne.bloque.introuvable"));
      boutons.push(copie, retour);
      break;
    case "interdit":
      textes.push(t("enligne.bloque.interdit"));
      boutons.push(copie, retour);
      break;
    case "circuit":
      textes.push(t("enligne.bloque.circuit"));
      boutons.push(copie, retour);
      break;
    case "trop_volumineux":
      textes.push(t("enligne.bloque.trop_volumineux"));
      boutons.push(bouton(t("enligne.fermer"), fermer, "primaire"));
      break;
    default:
      textes.push(t("enligne.bloque.invalide"));
      boutons.push(copie, bouton(t("enligne.fermer"), fermer, "primaire"));
  }
  $("synchro-titre").textContent = t("enligne.bloque.titre." + genre);
  $("synchro-contenu").replaceChildren(...textes.map((x) => h("p", {}, x)), h("div", { class: "synchro-boutons" }, ...boutons));
  if (!fenetre.open) fenetre.showModal();
}

// Après un conflit : on reprend la version du serveur (les modifications non enregistrées de la page sont abandonnées).
async function recharger(genre) {
  const synchro = genre === "document" ? synchroDoc : synchroCarto;
  const r = await appeler("GET", contexteApi(genre === "document" ? documentId : null));
  const recu = r.statut === 200 && r.corps ? (genre === "document" ? r.corps.document : r.corps.cartographie) : null;
  if (!recu) {
    alert(t("enligne.erreur.rechargement"));
    expliquerBlocage(genre, synchro, synchro.etat());
    return;
  }
  try {
    if (genre === "document") synchro.recharger(recu.version, () => store.demarrerAvec(recu.contenu));
    else synchro.recharger(recu.version, () => cartographie.demarrerAvec(recu.contenu));
  } catch (e) {
    alert(t("enligne.erreur.rechargement"));
  }
}

// ---------- Enregistrer, quitter ----------
async function toutEnregistrer() {
  const resultats = await Promise.all([synchroDoc ? synchroDoc.envoyerMaintenant() : true, synchroCarto ? synchroCarto.envoyerMaintenant() : true]);
  return resultats.every(Boolean);
}

// Bouton « Enregistrer » : enregistre tout de suite ; si c'est bloqué, réexplique pourquoi.
export async function enregistrerMaintenant() {
  if (await toutEnregistrer()) return;
  [["document", synchroDoc], ["cartographie", synchroCarto]].forEach(([genre, s]) => {
    const e = s && s.etat();
    if (e && e.cle === "bloque") expliquerBlocage(genre, s, e);
  });
}

// Reste-t-il quelque chose de non enregistré ? (alerte du navigateur avant de quitter la page)
export function aEnregistrer() {
  return !departAutorise && Boolean((synchroDoc && synchroDoc.enAttente()) || (synchroCarto && synchroCarto.enAttente()));
}

// Quitter vers la liste des documents : on enregistre d'abord. Si ce n'est pas possible, la personne choisit : partir quand même,
// ou rester (on lui réexplique alors ce qui bloque). Renvoie vrai si on part.
async function partirVersDocuments() {
  if ((await toutEnregistrer()) || confirm(t("enligne.quitter_non_enregistre"))) {
    departAutorise = true;
    location.href = PAGE_DOCUMENTS;
    return true;
  }
  await enregistrerMaintenant();
  return false;
}

// Raccourci « Créer l'instruction de travail » d'une procédure : l'instruction devient un NOUVEAU document de l'organisation
// (la procédure, enregistrée d'abord, reste telle quelle), puis s'ouvre à sa place.
async function creerInstruction(etapeId) {
  if (lectureSeule) {
    alert(t("enligne.lecture_seule"));
    return;
  }
  const brute = instructionDepuisEtape(store.lire(), etapeId);
  if (!brute || !confirm(t("enligne.n3.confirmer"))) return;
  if (!(await toutEnregistrer())) {
    await enregistrerMaintenant(); // explique ce qui bloque
    return;
  }
  const r = await appeler("POST", "/api/documents", { organisationId: organisation.id, contenu: store.nettoyer(brute) });
  if (r.statut === 201 && r.corps && MOTIF_ID.test(r.corps.id)) {
    departAutorise = true;
    location.href = "index.html?doc=" + encodeURIComponent(r.corps.id);
  } else {
    alert(t("enligne.n3.echec"));
  }
}

/**
 * Documents créés d'un coup (instructions de travail d'une fiche de collecte) : un brouillon chacun, sur le serveur. Renvoie les
 * références créées et celles en échec (la procédure ouverte, elle, s'enregistre comme d'habitude).
 */
export async function creerDocuments(liste) {
  const creees = [];
  const echecs = [];
  for (const contenu of liste) {
    const nom = contenu.meta.reference || contenu.meta.titre;
    const r = await appeler("POST", "/api/documents", { organisationId: organisation.id, contenu });
    if (r.statut === 201 && r.corps && MOTIF_ID.test(r.corps.id)) creees.push(nom);
    else echecs.push(nom);
  }
  return { creees, echecs };
}

// ---------- Démarrage ----------
export async function demarrerEnLigne({ apresChargement, toutAfficher }) {
  const params = new URLSearchParams(location.search);
  const doc = params.get("doc");
  cartoSeule = !doc && params.get("vue") === "cartographie";
  if (!doc && !cartoSeule) {
    departAutorise = true;
    location.replace(PAGE_DOCUMENTS);
    return;
  }
  if (doc && !MOTIF_ID.test(doc)) {
    erreurOuverture("enligne.erreur.introuvable");
    return;
  }
  documentId = doc;
  afficherAttente(t(cartoSeule ? "enligne.chargement_carto" : "enligne.chargement"));

  const r = await appeler("GET", contexteApi(doc));
  if (r.corps && (r.corps.langue === "fr" || r.corps.langue === "en")) definirLangue(r.corps.langue);
  if (r.statut === 401 || (r.statut === 403 && r.corps && r.corps.erreur === "mot_de_passe")) {
    departAutorise = true;
    location.href = "/connexion"; // rien n'a encore été modifié : on peut partir sans rien perdre
    return;
  }
  if (r.statut !== 200 || !r.corps || !r.corps.organisation || !r.corps.cartographie || (doc && !r.corps.document)) {
    erreurOuverture(cleErreurOuverture(r));
    return;
  }
  const ctx = r.corps;
  definirLangue(ctx.utilisateur.langue);
  organisation = ctx.organisation;

  // Le document d'abord : s'il est illisible, on n'ouvre rien.
  if (doc) {
    // Rédigé / vérifié / approuvé par : le circuit de validation (document imprimé, TC-07).
    definirValidationCircuit(ctx.document.validation, ctx.organisation.nom);
    try {
      store.demarrerAvec(ctx.document.contenu);
    } catch (e) {
      erreurOuverture("enligne.erreur.format");
      return;
    }
    lectureSeule = !ctx.droits.rediger;
    if (lectureSeule) store.verrouiller();
  }
  cartographie.demarrerAvec(ctx.cartographie.contenu);
  cartoLectureSeule = !ctx.droits.cartographie;
  if (cartoLectureSeule) cartographie.verrouiller();

  // Enregistrement automatique (seulement ce que la personne a le droit de modifier).
  if (doc && !lectureSeule) {
    synchroDoc = creerSynchro({
      contenu: store.lire,
      empreinte: empreinteDocument,
      envoyer: ({ version, forcer, contenu }) => appeler("PUT", "/api/documents/" + encodeURIComponent(documentId), { organisationId: organisation.id, version, forcer, contenu }),
      surChangement: (e) => surChangement("document", synchroDoc, e),
    });
    synchroDoc.demarrer(ctx.document.version);
    store.abonner(() => synchroDoc.signaler());
  }
  if (!cartoLectureSeule) {
    synchroCarto = creerSynchro({
      contenu: cartographie.lire,
      empreinte: empreinteDocument,
      envoyer: ({ version, forcer, contenu }) => appeler("PUT", "/api/cartographie", { organisationId: organisation.id, version, forcer, contenu }),
      surChangement: (e) => surChangement("cartographie", synchroCarto, e),
    });
    synchroCarto.demarrer(ctx.cartographie.version);
    cartographie.abonner(() => synchroCarto.signaler());
  }

  // La page : lecture seule, liens, état.
  if (lectureSeule) {
    document.documentElement.setAttribute("data-lecture-seule", "");
    const bandeau = $("bandeau-lecture-seule");
    // Document qui n'est plus un brouillon : la raison est le circuit de validation, pas le rôle.
    const etat = ctx.document && ctx.document.etat;
    if (ETATS_FIGES.includes(etat)) {
      bandeau.dataset.i18n = "enligne.lecture_seule_circuit." + etat;
      bandeau.dataset.etat = etat;
      bandeau.textContent = t(bandeau.dataset.i18n);
    }
    bandeau.hidden = false;
    // Boutons de rédaction (enregistrer, ouvrir, importer, exemples) : visibles mais désactivés, avec la raison au survol
    // (dans la langue de la personne, mise à jour si elle en change).
    const raison = () => {
      for (const b of document.querySelectorAll("button.redaction-seulement")) {
        b.disabled = true;
        b.title = t(bandeau.dataset.i18n || "enligne.lecture_seule");
      }
    };
    raison();
    document.addEventListener("langue-changee", raison);
    figerEnPermanence($("etape-contenu"));
  }
  if (cartoLectureSeule) {
    $("carto-lecture-seule").hidden = false;
    figerEnPermanence($("carto-contenu"));
  }
  document.addEventListener("creer-instruction", (ev) => creerInstruction(ev.detail && ev.detail.etapeId));
  document.addEventListener("langue-changee", afficherEtats);
  $("lien-documents").addEventListener("click", (ev) => {
    ev.preventDefault();
    partirVersDocuments();
  });
  $("btn-copie-json").addEventListener("click", () => telechargerCopie("document"));
  $("synchro-fermer").addEventListener("click", () => $("fenetre-synchro").close());

  if (doc) apresChargement();
  toutAfficher();
  afficherEtats();
  document.documentElement.setAttribute("data-pret", "");

  if (cartoSeule) {
    // Cartographie seule : la fenêtre est la page ; la fermer ramène à la liste des documents (après avoir enregistré).
    document.body.setAttribute("data-carto-seule", "");
    ouvrirCartographie();
    $("fenetre-carto").addEventListener("close", async () => {
      if (!$("fenetre-carto").open) ouvrirCartographie(); // la fenêtre reste affichée pendant l'enregistrement
      await partirVersDocuments();
    });
  }
}
