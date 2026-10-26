// signataires.js — qui a rédigé, vérifié et approuvé le document, pour le document imprimé (PDF, Word) et les dessins.
//   En local (fichier ouvert sur le poste) : les noms, fonctions et dates saisis dans le formulaire (meta.signataires).
//   En ligne : ceux du CIRCUIT DE VALIDATION de l'application (nom du compte, fonction donnée à chaque étape, date de la
//   décision), envoyés par le serveur à l'ouverture. Tant que le document n'est pas approuvé, c'est un PROJET : tableau
//   vide et mention « PROJET — non approuvé » à l'impression. La case « Visa » reste toujours vide (signature sur papier).
import { EN_LIGNE } from "./en-ligne.js";

const VIDE = Object.freeze({ nom: "", fonction: "", date: "" });
const AUCUN = Object.freeze({ redige: VIDE, verifie: VIDE, approuve: VIDE });

let circuit = null; // { etat: "approuve" | "projet", signataires } — en ligne seulement
let nomOrganisation = "";

/** En ligne, à l'ouverture d'un document : la validation venue du serveur et le nom de l'organisation. */
export function definirValidationCircuit(validation, organisation) {
  circuit = validation && (validation.etat === "approuve" || validation.etat === "projet") ? validation : { etat: "projet", signataires: null };
  nomOrganisation = String(organisation || "").trim();
}

/** Les signataires viennent-ils du circuit (en ligne, document ouvert) ? Le formulaire ne les saisit alors plus. */
export function signatairesDuCircuit() {
  return EN_LIGNE && circuit !== null;
}

/** En ligne : document pas encore approuvé (impression marquée « PROJET — non approuvé »). */
export function estProjet() {
  return signatairesDuCircuit() && circuit.etat !== "approuve";
}

/** Rédigé / vérifié / approuvé par : nom, fonction, date (AAAA-MM-JJ). */
export function signatairesEffectifs(procedure) {
  if (!signatairesDuCircuit()) return procedure.meta.signataires;
  return circuit.etat === "approuve" && circuit.signataires ? circuit.signataires : AUCUN;
}

/** Nom de l'organisation de l'en-tête : celui saisi dans le document ; à défaut, en ligne, celui de l'organisation. */
export function organisationEffective(procedure) {
  const saisi = String(procedure.meta.organisation || "").trim();
  return saisi || (signatairesDuCircuit() ? nomOrganisation : "");
}
