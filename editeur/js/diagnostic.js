// diagnostic.js — la liste des CONSTATS affichée dans la bande du bas et dans la synthèse : règles du langage, lisibilité du dessin
// sur A4, croisements de flèches, longueur du document. Un seul endroit pour les deux types de document (procédure, instruction de travail).
// Chaque constat = { gravite, cle, params } ; le texte est produit par t(cle, params).

import { verifier } from "./rules.js";
import { verifierIT } from "./rules-it.js";
import { verifierCodes } from "./rules-codes.js";
import { lire as lireCartographie } from "./cartographie-store.js";
import { taillePointsSurA4, croisementsNiveau2, SEUIL_PT } from "./render.js";
import { taillePointsNiveau3, croisementsNiveau3, SEUIL_PT_IT } from "./render3.js";
import { constatsLisibilite } from "./conseils.js";
import { construireDocument, verifierLongueur } from "./document.js";
import { nombre } from "./i18n.js";
import { estInstruction } from "./parcours.js";
import { constatsQuestionnement, constatsNonApplicables, sansDoublons } from "./questionnement.js";

// Instruction de travail : le dessin doit tenir sur UNE page A4 avec un texte lisible, et les flèches « non » ne se croisent pas.
export function constatsDessinIT(p) {
  const constats = [];
  const pt = taillePointsNiveau3(p);
  if (pt !== null && pt < SEUIL_PT_IT) constats.push({ gravite: "alerte", cle: "regle3.dessin.trop_dense", params: { pt: nombre(pt), seuil: nombre(SEUIL_PT_IT) } });
  const n = croisementsNiveau3(p);
  if (n > 0) constats.push({ gravite: "alerte", cle: "regle3.dessin.croisements", params: { n } });
  return constats;
}

// La cartographie (facultative) sert aux règles de codification ; les tests peuvent en donner une autre en second argument.
export function constatsDiagnostic(p, carto = lireCartographie()) {
  const codes = verifierCodes(p, carto);
  // Le questionnement en 11 points (voir questionnement.js) : des pistes de contrôle, jamais un tableau ; seuls les points non respectés apparaissent.
  const questions = constatsQuestionnement(p);
  // « Aucune anomalie » n'a plus de sens dès qu'une alerte de codification ou un point du questionnement s'ajoute.
  const sansOk = (liste) => (codes.length || questions.length ? liste.filter((c) => c.gravite !== "ok") : liste);
  // Résumé discret des alertes jugées « sans objet » : toujours en dernier, non compté dans erreurs/alertes.
  const nonApplicables = constatsNonApplicables(p);
  if (estInstruction(p)) return [...sansOk(sansDoublons(verifierIT(p), p)), ...questions, ...codes, ...constatsDessinIT(p), ...nonApplicables];
  const pt = taillePointsSurA4(p);
  const constatsDessin = pt !== null && pt < SEUIL_PT ? [{ gravite: "alerte", cle: "regle.logigramme.trop_haut", params: { pt: nombre(pt), seuil: nombre(SEUIL_PT) } }, ...constatsLisibilite(p)] : [];
  const croisements = croisementsNiveau2(p);
  if (croisements > 0) constatsDessin.push({ gravite: "alerte", cle: "regle.logigramme.croisements", params: { n: croisements } });
  return [...sansOk(sansDoublons(verifier(p, { nomenclature: carto.nomenclature }), p)), ...questions, ...codes, ...constatsDessin, ...verifierLongueur(construireDocument(p)), ...nonApplicables];
}
