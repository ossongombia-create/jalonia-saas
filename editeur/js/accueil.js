// accueil.js — la LOGIQUE de l'accueil « Mon espace » : ce qu'on y montre, d'après le document en cours et la cartographie.
// Aucun accès à la page ici : des fonctions qui reçoivent des données et renvoient des données (testables sans navigateur).
// L'affichage est dans accueil-ui.js.

import { estDocumentVide } from "./model.js";
import { estInstruction, etatsEtapes, etapeAccessible, etapeMax, ETAPES } from "./parcours.js";
import { CATEGORIES } from "./cartographie.js";

// { erreurs, alertes } d'après la liste des constats du diagnostic (« ok » n'est ni une erreur ni une alerte).
export function compterConstats(constats = []) {
  return {
    erreurs: constats.filter((c) => c.gravite === "erreur").length,
    alertes: constats.filter((c) => c.gravite === "alerte").length,
  };
}

// La clé du texte d'un compteur, au singulier ou au pluriel : en français 0 et 1 sont au singulier (« 0 erreur »), en anglais seul 1 l'est.
export function cleCompteur(base, n, langue = "fr") {
  const singulier = langue === "en" ? n === 1 : n <= 1;
  return "accueil.compteur." + base + (singulier ? ".un" : ".autres");
}

// Le nom sous lequel présenter l'espace de travail : celui de la cartographie, sinon celui du document ; "" si personne n'a rien écrit.
export function nomOrganisation(p, carto) {
  const brut = (v) => (typeof v === "string" ? v.trim() : "");
  return brut(carto && carto.organisation) || brut(p && p.meta && p.meta.organisation);
}

// Le document en cours vu par l'accueil : null s'il n'y a rien (document vide). « courante » = l'étape où l'on s'était arrêté.
export function resumeDocument(p, constats = [], courante = 1) {
  if (estDocumentVide(p)) return null;
  const type = p.meta.typeDocument === "procedure" || p.meta.typeDocument === "instruction" ? p.meta.typeDocument : "";
  const it = estInstruction(p);
  const { erreurs, alertes } = compterConstats(constats);
  const reprise = etapeAccessible(p, courante) ? courante : etapeMax(p);
  const controles = it ? p.it.operations.reduce((somme, op) => somme + op.controles.length, 0) : 0;
  const compteurs = it
    ? [{ base: "operation", n: p.it.operations.length, ton: "neutre" }, { base: "controle", n: controles, ton: "neutre" }]
    : [{ base: "instruction", n: p.etapes.length, ton: "neutre" }, { base: "role", n: p.roles.length, ton: "neutre" }];
  compteurs.push({ base: "erreur", n: erreurs, ton: erreurs === 0 ? "ok" : "erreur" });
  compteurs.push({ base: "alerte", n: alertes, ton: alertes === 0 ? "ok" : "alerte" });
  return {
    type,
    instruction: it,
    titre: (p.meta.titre || "").trim(),
    details: [p.meta.reference, p.meta.version].filter((v) => v && String(v).trim()).join(" · "),
    etapes: etatsEtapes(p, reprise),
    reprise,
    cleReprise: "accueil.reprendre." + ETAPES[reprise - 1],
    compteurs,
  };
}

// La cartographie par blocs (management, réalisation, support, vérification) : les codes des processus de chaque bloc ; les processus sans bloc à part.
export function blocsCartographie(carto) {
  const processus = (carto && carto.processus) || [];
  const puce = (p) => ({ code: p.code || p.nom || "", nom: p.nom || "" });
  return {
    nbProcessus: processus.length,
    nbEchanges: ((carto && carto.flux) || []).length,
    vide: processus.length === 0,
    blocs: CATEGORIES.map((categorie) => ({ categorie, puces: processus.filter((p) => p.categorie === categorie).map(puce).filter((x) => x.code) })),
    sansBloc: processus.filter((p) => !CATEGORIES.includes(p.categorie)).map(puce).filter((x) => x.code),
  };
}

// « modifié aujourd'hui à 15:42 », « modifié hier à … », « modifié le 27/09/2026 » : { cle, params }, ou null si la date n'est pas connue.
export function libelleModification(instant, maintenant = Date.now(), langue = "fr") {
  if (!instant || !Number.isFinite(instant)) return null;
  const d = new Date(instant);
  const n = new Date(maintenant);
  const deuxChiffres = (x) => String(x).padStart(2, "0");
  const debutDuJour = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const ecart = Math.round((debutDuJour(n) - debutDuJour(d)) / 86400000); // en jours calendaires ; négatif si l'horloge a été reculée
  const heure = `${deuxChiffres(d.getHours())}:${deuxChiffres(d.getMinutes())}`;
  if (ecart <= 0) return { cle: "accueil.doc.modifie.aujourdhui", params: { heure } };
  if (ecart === 1) return { cle: "accueil.doc.modifie.hier", params: { heure } };
  return { cle: "accueil.doc.modifie.date", params: { date: d.toLocaleDateString(langue === "en" ? "en-GB" : "fr-FR") } };
}
