// cartographie-store.js — l'ÉTAT de la cartographie des processus, côté navigateur : elle appartient à l'organisation (pas à un
// document) ; on la garde dans le navigateur (localStorage) et on peut l'enregistrer / la rouvrir en fichier .json.
// Comme pour la procédure, seul ce module la modifie : l'écran appelle des fonctions, puis se redessine à l'appel de l'abonné.
//
// Pendant la saisie on ne « nettoie » pas (un code à moitié tapé ne doit pas disparaître) : le nettoyage sévère se fait à l'ouverture
// d'un fichier, à l'import d'un PDF et au rechargement du navigateur.

import {
  nouvelleCartographie, nettoyerCartographie, depuisJSON, versJSON, estVide, POINTS_FIXES, CATEGORIES, MAX_PROCESSUS, MAX_FLUX, MAX_DOCUMENTS, FICHE_CHAMPS, MAX_FICHE,
} from "./cartographie.js";
import { nouvelId } from "./model.js";
import { exempleCartographie } from "./exemple-carto.js";
import { EN_LIGNE } from "./en-ligne.js";

const CLE = "qualigramme-app-cartographie";
let carto = charger();
const abonnes = new Set();
// Lecture seule (en ligne, rôle sans droit de modifier la cartographie) : toute modification est aussitôt défaite.
let verrouillee = false;
let cartoOuverte = null;
const copie = (c) => JSON.parse(JSON.stringify(c));

// En ligne, la cartographie vient du serveur (demarrerAvec) : rien n'est lu ni gardé dans le navigateur.
function charger() {
  if (EN_LIGNE) return nouvelleCartographie();
  try {
    const brut = localStorage.getItem(CLE);
    return brut ? nettoyerCartographie(JSON.parse(brut)) : nouvelleCartographie();
  } catch (e) {
    return nouvelleCartographie(); // stockage indisponible ou contenu abîmé : on repart d'une cartographie vide
  }
}

function sauver() {
  if (EN_LIGNE) return;
  try {
    localStorage.setItem(CLE, JSON.stringify(carto));
  } catch (e) {
    // stockage indisponible : la cartographie reste utilisable jusqu'à la fermeture de la page, et s'enregistre en fichier.
  }
}

export const lire = () => carto;
export function abonner(fn) {
  abonnes.add(fn);
  return () => abonnes.delete(fn);
}
function apres(structure) {
  if (verrouillee) {
    carto = copie(cartoOuverte);
    abonnes.forEach((fn) => fn(true));
    return;
  }
  sauver();
  abonnes.forEach((fn) => fn(structure));
}

// ---------- En ligne ----------
// Ouvre la cartographie reçue du serveur, nettoyée comme un fichier (un contenu vide donne une cartographie vide).
export function demarrerAvec(brut) {
  carto = nettoyerCartographie(brut);
  if (verrouillee) cartoOuverte = copie(carto);
  apres(true);
  return carto;
}
export function verrouiller() {
  verrouillee = true;
  cartoOuverte = copie(carto);
}
export const estVerrouillee = () => verrouillee;

// ---------- Remplacer toute la cartographie ----------
// Importer une cartographie (PDF, fichier) ne change pas la façon dont l'organisation code ses documents, sauf si le fichier la contient.
export function remplacer(brut) {
  carto = nettoyerCartographie(brut, { nomenclature: carto.nomenclature });
  apres(true);
  return carto;
}
export function vider() {
  carto = nouvelleCartographie(); // repart de zéro, nomenclature comprise
  apres(true);
}
export function chargerExemple() {
  return remplacer(exempleCartographie());
}
export function importerJSON(contenu) {
  carto = depuisJSON(contenu, { nomenclature: carto.nomenclature });
  apres(true);
  return carto;
}
export function exporterJSON() {
  return versJSON(carto);
}
export const estVideMaintenant = () => estVide(carto);

// ---------- Textes de la cartographie ----------
const CHAMPS = ["organisation", "titre", "contexte", "exigences", "satisfaction"];
export function modifierChamp(champ, valeur) {
  if (!CHAMPS.includes(champ) || typeof valeur !== "string") return;
  carto[champ] = valeur.slice(0, 600);
  apres(false);
}

// ---------- Nomenclature des codes de documents ----------
export function modifierNomenclature(champ, valeur) {
  if (champ === "controle") carto.nomenclature.controle = valeur === true;
  else if ((champ === "procedure" || champ === "instruction") && typeof valeur === "string") carto.nomenclature[champ] = valeur.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);
  else return;
  apres(champ === "controle"); // le type se tape lettre par lettre : on ne redessine pas pendant la saisie
}

// ---------- Processus ----------
export function ajouterProcessus(categorie = "") {
  if (carto.processus.length >= MAX_PROCESSUS) return null;
  const p = { id: nouvelId("q"), code: "", nom: "", categorie: CATEGORIES.includes(categorie) ? categorie : "" };
  carto.processus.push(p);
  apres(true);
  return p.id;
}
export function modifierProcessus(id, champ, valeur) {
  const p = carto.processus.find((x) => x.id === id);
  if (!p || typeof valeur !== "string") return;
  if (champ === "code") p.code = valeur.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
  else if (champ === "nom") p.nom = valeur.slice(0, 200);
  else if (champ === "categorie") { if (valeur !== "" && !CATEGORIES.includes(valeur)) return; p.categorie = valeur; }
  else return;
  apres(champ === "categorie");
}
export function supprimerProcessus(id) {
  carto.processus = carto.processus.filter((p) => p.id !== id);
  carto.flux = carto.flux.filter((f) => f.de !== id && f.vers !== id); // un échange ne peut pas pointer vers un processus disparu
  apres(true);
}

// ---------- Fiches d'identité des processus (niveau 1) ----------
// Rangées par CODE de processus. On n'écrit que si un processus porte ce code. Un champ vidé est retiré ; une fiche vide disparaît.
// Pendant la saisie on ne redessine pas (apres(false)) : le nettoyage (sauts de ligne, longueur) a lieu au rechargement / à l'import.
export function modifierFiche(code, champ, valeur) {
  if (!FICHE_CHAMPS.includes(champ) || typeof valeur !== "string") return;
  const cle = String(code || "").trim().toUpperCase();
  if (!cle || !carto.processus.some((p) => p.code === cle)) return;
  if (!carto.fiches || typeof carto.fiches !== "object") carto.fiches = {};
  const v = valeur.slice(0, MAX_FICHE);
  const fiche = carto.fiches[cle] || {};
  if (v.trim()) fiche[champ] = v; else delete fiche[champ];
  if (Object.keys(fiche).length) carto.fiches[cle] = fiche; else delete carto.fiches[cle];
  apres(false);
}

// ---------- Échanges ----------
export function ajouterFlux() {
  if (carto.flux.length >= MAX_FLUX) return null;
  const f = { id: nouvelId("f"), de: "", vers: "", information: "", double: false };
  carto.flux.push(f);
  apres(true);
  return f.id;
}
export function modifierFlux(id, champ, valeur) {
  const f = carto.flux.find((x) => x.id === id);
  if (!f) return;
  if (champ === "de" || champ === "vers") {
    if (valeur !== "" && !POINTS_FIXES.includes(valeur) && !carto.processus.some((p) => p.id === valeur)) return;
    f[champ] = valeur;
  } else if (champ === "information") {
    if (typeof valeur !== "string") return;
    f.information = valeur.slice(0, 300);
  } else if (champ === "double") f.double = valeur === true;
  else return;
  apres(champ !== "information");
}
export function supprimerFlux(id) {
  carto.flux = carto.flux.filter((f) => f.id !== id);
  apres(true);
}

// ---------- Registre des documents (codes déjà attribués) ----------
export function ajouterDocument() {
  if (carto.documents.length >= MAX_DOCUMENTS) return null;
  const d = { id: nouvelId("d"), code: "", titre: "" };
  carto.documents.push(d);
  apres(true);
  return d.id;
}
export function modifierDocument(id, champ, valeur) {
  const d = carto.documents.find((x) => x.id === id);
  if (!d || typeof valeur !== "string") return;
  if (champ === "code") d.code = valeur.toUpperCase().replace(/[^A-Z0-9._/-]/g, "").slice(0, 20);
  else if (champ === "titre") d.titre = valeur.slice(0, 300);
  else return;
  apres(false);
}
export function supprimerDocument(id) {
  carto.documents = carto.documents.filter((d) => d.id !== id);
  apres(true);
}
