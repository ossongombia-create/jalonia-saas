// parcours.js — la LOGIQUE du parcours en 4 étapes : quand une étape est-elle « remplie » (ce qui ouvre la suivante) ?
// Ce fichier ne dessine rien et ne touche pas à la page : il reçoit une procédure et répond par des listes.
//
//   1. Identification  : organisation, processus, pilote, intitulé, code, type de document
//   2. Déroulé         : rôles, début, instructions (avec risques et niveau 3), fin
//   3. Synthèse        : relecture, conformité aux règles, longueur ≤ 10 pages, puis validation
//   4. Génération      : Word et PDF
//
// Un « manque » est { cle, params } : le texte s'obtient par t(cle, params), comme pour les règles.

import { verifier } from "./rules.js";
import { verifierIT } from "./rules-it.js";
import { construireDocument, verifierLongueur } from "./document.js";
import { signatureContenu } from "./model.js";
import { constatsQuestionnement, sansDoublons } from "./questionnement.js";

export const ETAPES = ["identification", "deroule", "synthese", "generation"];

const vide = (v) => !v || !String(v).trim();

// Champs obligatoires de l'étape 1. « Direction / Site » reste facultatif : toutes les organisations n'en ont pas.
export const CHAMPS_IDENTIFICATION = ["organisation", "processus", "pilote", "titre", "reference", "typeDocument"];

// Vrai pour une instruction de travail (niveau 3) : un document à part, avec son propre déroulé (1 rôle, opérations, contrôles).
export const estInstruction = (p) => p.meta.typeDocument === "instruction";

export function manquantsIdentification(p) {
  return CHAMPS_IDENTIFICATION.filter((c) => vide(p.meta[c])).map((c) => ({ cle: "manque.meta." + (c === "titre" && estInstruction(p) ? "titre_it" : c), params: {} }));
}

// Étape 2 : tout ce qui doit être renseigné pour que le déroulé soit complet (pas encore « conforme » : voir l'étape 3).
// Étape 2 d'une instruction de travail : le rôle, le début, les opérations (libellé ; information d'entrée de la première,
// de sortie de la dernière), la question de chaque contrôle, le libellé de chaque corrective, la fin.
export function manquantsDerouleIT(p) {
  const m = [];
  const ajouter = (cle, params = {}) => m.push({ cle, params });
  const ops = p.it.operations;
  if (vide(p.it.role.nom)) ajouter("manque.it.role");
  if (vide(p.meta.declencheur)) ajouter("manque.declencheur");
  if (ops.length === 0) ajouter("manque.it.operations");
  ops.forEach((op, k) => {
    const i = k + 1;
    if (vide(op.libelle)) ajouter("manque.it.operation.libelle", { i });
    if (k === 0 && vide(op.entree)) ajouter("manque.it.operation.entree", { i });
    if (k === ops.length - 1 && vide(op.sortie)) ajouter("manque.it.operation.sortie", { i });
    if (op.outils.some((o) => vide(o.nom))) ajouter("manque.it.operation.outil", { i });
    if (op.contrainte.actif && vide(op.contrainte.texte)) ajouter("manque.it.operation.contrainte", { i });
    op.controles.forEach((c, r) => {
      if (vide(c.question)) ajouter("manque.it.controle.question", { i, j: r + 1 });
      if (vide(c.nature)) ajouter("manque.it.controle.nature", { i, j: r + 1 });
    });
    op.correctives.forEach((c, r) => {
      if (vide(c.libelle)) ajouter("manque.it.corrective.libelle", { i, j: r + 1 });
    });
  });
  if (vide(p.meta.fin)) ajouter("manque.fin");
  return m;
}

export function manquantsDeroule(p) {
  if (estInstruction(p)) return manquantsDerouleIT(p);
  const m = [];
  const ajouter = (cle, params = {}) => m.push({ cle, params });
  if (p.roles.length === 0) ajouter("manque.roles");
  if (p.roles.some((r) => vide(r.nom))) ajouter("manque.role_sans_nom");
  if (vide(p.meta.declencheur)) ajouter("manque.declencheur");
  if (p.etapes.length === 0) ajouter("manque.etapes");
  p.etapes.forEach((e, k) => {
    const i = k + 1;
    if (!e.roleId) ajouter("manque.etape.role", { i });
    if (vide(e.libelle)) ajouter("manque.etape.libelle", { i });
    if (vide(e.entree)) ajouter("manque.etape.entree", { i });
    if (vide(e.sortie)) ajouter("manque.etape.sortie", { i });
    if (e.risques.some((r) => vide(r.risque) || vide(r.mesure))) ajouter("manque.etape.risque", { i });
    if (e.niveau3.actif && vide(e.niveau3.code)) ajouter("manque.etape.n3", { i });
    // Contrôle : nature (Q/H/S/R/E) et critère de conformité sont nécessaires à la section 8.
    if (e.controle.actif && (vide(e.controle.nature) || vide(e.controle.critere))) ajouter("manque.etape.controle", { i });
    // Décision : chaque cas est nommé et va quelque part (instruction ou fin).
    if (e.alternatives.some((a) => vide(a.condition) || vide(a.vers)) || (e.alternatives.length > 0 && vide(e.condition))) ajouter("manque.etape.decision", { i });
  });
  if (vide(p.meta.fin)) ajouter("manque.fin");
  return m;
}

// Étape 3 : ce qui empêche de valider la synthèse (règles du langage enfreintes, document trop long).
export function bloquantsSynthese(p) {
  // Instruction de travail : les règles du chapitre 7 (la tenue sur une page A4 est jugée sur le dessin : voir diagnostic).
  // Dans les deux cas, les points essentiels du questionnement en 11 points (questionnement.js) s'ajoutent aux règles du langage.
  if (estInstruction(p)) return [...sansDoublons(verifierIT(p), p), ...constatsQuestionnement(p)].filter((c) => c.gravite === "erreur");
  const constats = [...sansDoublons(verifier(p), p), ...constatsQuestionnement(p), ...verifierLongueur(construireDocument(p))];
  return constats.filter((c) => c.gravite === "erreur");
}

export function estValidee(p) {
  return p.validation !== "" && p.validation === signatureContenu(p);
}

// Manques d'une étape donnée (1 à 4). L'étape 4 n'a rien à remplir : c'est la dernière.
export function manquants(p, n) {
  if (n === 1) return manquantsIdentification(p);
  if (n === 2) return manquantsDeroule(p);
  if (n === 3) {
    const m = bloquantsSynthese(p).map((c) => ({ cle: c.cle, params: c.params }));
    if (!estValidee(p)) m.push({ cle: "manque.validation", params: {} });
    return m;
  }
  return [];
}

export function etapeComplete(p, n) {
  return manquants(p, n).length === 0;
}

// Une étape est accessible si TOUTES les précédentes sont remplies.
export function etapeAccessible(p, n) {
  for (let k = 1; k < n; k += 1) if (!etapeComplete(p, k)) return false;
  return n >= 1 && n <= ETAPES.length;
}

// Dernière étape accessible (celle qu'on peut atteindre au plus loin).
export function etapeMax(p) {
  let n = 1;
  while (n < ETAPES.length && etapeComplete(p, n)) n += 1;
  return n;
}

// Où se placer après le chargement d'une procédure (exemple, fichier, Word) : là où reste du travail,
// sans jamais aller plus loin que le déroulé (l'utilisateur relit ce qui a été chargé).
export function etapeInitiale(p) {
  return Math.min(etapeMax(p), 2);
}

// L'état de chacune des 4 étapes, pour la colonne sarcelle et pour l'accueil : « fait » (remplie), « courant » (celle où l'on se trouve),
// « afaire » (ouverte, pas encore remplie) ou « verrouille » (une étape précédente reste à remplir). La dernière étape n'est jamais « faite ».
export function etatsEtapes(p, courante) {
  const remplie = ETAPES.map((_, i) => (i < ETAPES.length - 1 ? etapeComplete(p, i + 1) : false));
  const ouverte = ETAPES.map((_, i) => remplie.slice(0, i).every(Boolean));
  return ETAPES.map((cle, i) => {
    const n = i + 1;
    const etat = n === courante ? "courant" : remplie[i] ? "fait" : ouverte[i] ? "afaire" : "verrouille";
    return { cle, n, etat, ouverte: ouverte[i] };
  });
}
