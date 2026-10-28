// store.js — l'ÉTAT de l'application : la procédure en cours + toutes les façons de la modifier.
// Règle d'or : on ne modifie la procédure QUE par les fonctions de ce fichier. Après chaque
// modification, tous les « abonnés » (le dessin, le diagnostic…) sont prévenus et se mettent à jour.

import {
  nouvelleProcedure, nouvelleEtape, nouveauBloc, nouveauCorps, nouveauRisque, nouvelleOpportunite, nouvelleAlternative, nouvelleRevision, nouvelId, signatureContenu,
  TYPES_OUTIL, TYPES_DOCUMENT, SECTIONS, MAX_BLOCS, MAX_LIGNES, MAX_COLONNES, MAX_RISQUES, MAX_OPPORTUNITES, MAX_ALTERNATIVES, NATURES_CONTROLE,
  domaineValide, SIGNATAIRES, MAX_REVISIONS, OPERATEURS, NATURES_CONTRAINTE, LOGO_MAX_OCTETS, LETTRES_RACI, LETTRES_RACI_AUTRES, lettreRaci,
  TYPES_MACRO, MAX_ALTERNATIVES_MACRO,
  nouvelleInstruction, nouvelleOperation, nouveauControle, nouvelleCorrective, MAX_OPERATIONS_SAISIE, MAX_CONTROLES, MAX_CORRECTIVES,
  instructionDepuisEtape, empreinteDocument, estDocumentVide,
} from "./model.js";
import { exempleProcedure } from "./exemple-procedure.js";
import { exempleInstruction } from "./exemple-it.js";
import { EN_LIGNE } from "./en-ligne.js";

const CLE_STOCKAGE = "qualigramme-app-brouillon-v1";
const CLE_ENREGISTRE = "qualigramme-app-enregistre-v1"; // empreinte du document au dernier enregistrement en fichier .json
const CLE_MODIFIE = "qualigramme-app-modifie-v1"; // instant de la dernière modification (millisecondes)
const TYPES_ROLE = ["individuel", "unite", "externe"];
const MAX_OUTILS = 6;

// Ces deux petits outils sont utilisés par nettoyer(), donc par le rechargement du brouillon.
const texteCourt = (v, max = 500) => (typeof v === "string" ? v.slice(0, max) : "");
const idPropre = (v) => (typeof v === "string" && /^[\w-]{1,30}$/.test(v) ? v : "");

// La procédure en cours. Elle est chargée tout EN BAS du fichier (« procedure = charger() ?? … ») : charger()
// appelle nettoyer(), qui utilise des constantes définies plus loin ; chargée ici, le brouillon serait ignoré
// sans erreur visible (« Cannot access before initialization », avalée par le try/catch de charger()).
let procedure = null;
const abonnes = [];
const abonnesEnregistrement = [];
let empreinteEnregistree = ""; // empreinte du document au dernier enregistrement en fichier (ou à son ouverture)
let instantModification = 0;
// Lecture seule (en ligne, rôle sans droit de rédaction) : toute modification est aussitôt défaite (voir verrouiller()).
let verrouille = false;
let documentOuvert = null; // copie du document tel qu'ouvert, rétablie après chaque tentative de modification

export function lire() {
  return procedure;
}

// S'abonner : fn(structureChangee) sera appelée après chaque modification.
// structureChangee = true si on a ajouté/supprimé/déplacé quelque chose (il faut redessiner le
// formulaire) ; false si on a juste tapé dans un champ (inutile de le redessiner : on perdrait le curseur).
export function abonner(fn) {
  abonnes.push(fn);
}

// ---------- Historique (annuler / rétablir) ----------
// Avant chaque modification, on garde une COPIE de la procédure (un « instantané »).
// Annuler = revenir au dernier instantané ; rétablir = ré-avancer.
// Les frappes au clavier dans un même champ sont regroupées en un seul instantané
// (sinon il faudrait annuler lettre par lettre).
const passe = [];
const futur = [];
const LIMITE_HISTORIQUE = 100;
let derniereCle = "";
let derniereHeure = 0;

const copie = (p) => JSON.parse(JSON.stringify(p));

function avant(cle = "") {
  if (verrouille) return; // lecture seule : rien à annuler
  const maintenant = Date.now();
  const regroupe = cle && cle === derniereCle && maintenant - derniereHeure < 1000;
  derniereCle = cle;
  derniereHeure = maintenant;
  if (regroupe) return;
  passe.push(copie(procedure));
  if (passe.length > LIMITE_HISTORIQUE) passe.shift();
  futur.length = 0;
}

export function peutAnnuler() {
  return passe.length > 0;
}
export function peutRetablir() {
  return futur.length > 0;
}

export function annuler() {
  if (!passe.length) return;
  futur.push(copie(procedure));
  procedure = passe.pop();
  derniereCle = "";
  apres(true);
}

export function retablir() {
  if (!futur.length) return;
  passe.push(copie(procedure));
  procedure = futur.pop();
  derniereCle = "";
  apres(true);
}

function apres(structure) {
  if (verrouille) {
    // Lecture seule : quelle que soit la modification tentée, on revient au document ouvert et on redessine tout.
    procedure = copie(documentOuvert);
    abonnes.forEach((fn) => fn(true));
    return;
  }
  instantModification = Date.now();
  sauvegarderLocalement();
  abonnes.forEach((fn) => fn(structure));
}

// ---------- Identification et cadrage ----------
const CHAMPS_META = ["organisation", "direction", "processus", "pilote", "titre", "reference", "version", "typeDocument", "declencheur", "fin", "domaine", "dateApplication"];
const DATE_ISO = /^\d{4}-\d{2}-\d{2}$/;
const dateOuVide = (v) => (typeof v === "string" && DATE_ISO.test(v) ? v : "");

export function modifierMeta(champ, valeur) {
  if (!CHAMPS_META.includes(champ)) return;
  if (champ === "typeDocument" && valeur !== "" && !TYPES_DOCUMENT.includes(valeur)) return;
  if (champ === "domaine" && valeur !== "" && !domaineValide(valeur)) return;
  if (champ === "dateApplication" && valeur !== "" && !DATE_ISO.test(valeur)) return;
  avant("meta:" + champ);
  procedure.meta[champ] = valeur;
  if (champ === "typeDocument") procedure.meta.niveau = valeur === "instruction" ? 3 : 2;
  apres(champ === "typeDocument"); // le type de document change des textes ailleurs dans le parcours
}

// ---------- Validation du document (rédigé / vérifié / approuvé par) et historique des révisions ----------
export function modifierSignataire(qui, champ, valeur) {
  if (!SIGNATAIRES.includes(qui) || !["nom", "fonction", "date"].includes(champ)) return;
  if (champ === "date" && valeur !== "" && !DATE_ISO.test(valeur)) return;
  avant("sign:" + qui + champ);
  procedure.meta.signataires[qui][champ] = texteCourt(valeur, 200);
  apres(false);
}

export function ajouterRevision() {
  if (procedure.meta.revisions.length >= MAX_REVISIONS) return;
  avant();
  procedure.meta.revisions.push(nouvelleRevision());
  apres(true);
}

export function modifierRevision(id, champ, valeur) {
  const r = procedure.meta.revisions.find((x) => x.id === id);
  if (!r || !["version", "date", "nature", "auteur"].includes(champ)) return;
  if (champ === "date" && valeur !== "" && !DATE_ISO.test(valeur)) return;
  avant("rev:" + id + champ);
  r[champ] = texteCourt(valeur, 300);
  apres(false);
}

export function supprimerRevision(id) {
  if (!procedure.meta.revisions.some((x) => x.id === id)) return;
  avant();
  procedure.meta.revisions = procedure.meta.revisions.filter((x) => x.id !== id);
  apres(true);
}

// ---------- Validation de la synthèse (étape 3) ----------
// On mémorise l'empreinte du contenu au moment de la validation : toute modification ensuite la rend caduque.
export function valider() {
  avant();
  procedure.validation = signatureContenu(procedure);
  apres(true);
}

export function retirerValidation() {
  avant();
  procedure.validation = "";
  apres(true);
}

// ---------- Rôles ----------
export function ajouterRole() {
  avant();
  procedure.roles.push({ id: nouvelId("r"), nom: "", type: "individuel", service: "", responsabilite: "" });
  apres(true);
}

export function modifierRole(id, champ, valeur) {
  avant("role:" + id + champ);
  const role = procedure.roles.find((r) => r.id === id);
  if (!role || !["nom", "type", "service", "responsabilite"].includes(champ)) return;
  if (champ === "type" && !TYPES_ROLE.includes(valeur)) return;
  role[champ] = valeur;
  apres(champ === "type");
}

export function supprimerRole(id) {
  avant();
  procedure.roles = procedure.roles.filter((r) => r.id !== id);
  procedure.etapes.forEach((e) => {
    if (e.roleId === id) e.roleId = "";
    e.participants = e.participants.filter((p) => p !== id);
    if (e.raci) delete e.raci[id];
  });
  apres(true);
}

// ---------- Étapes ----------
export function ajouterEtape() {
  avant();
  const derniere = procedure.etapes[procedure.etapes.length - 1];
  procedure.etapes.push(nouvelleEtape({ roleId: derniere ? derniere.roleId : "" }));
  apres(true);
}

const CHAMPS_ETAPE = ["roleId", "libelle", "entree", "entreeDe", "sortie", "versQui", "informes", "condition"];

export function modifierEtape(id, champ, valeur) {
  const etape = procedure.etapes.find((e) => e.id === id);
  if (!etape || !CHAMPS_ETAPE.includes(champ)) return;
  avant("etape:" + id + champ);
  etape[champ] = valeur;
  if (champ === "roleId" && valeur) {
    // Le nouveau réalisateur principal ne peut plus être participant ni avoir un autre rôle R.A.C.I. dans cette instruction.
    etape.participants = etape.participants.filter((p) => p !== valeur);
    delete etape.raci[valeur];
  }
  apres(champ === "roleId");
}

// R.A.C.I. : donne à un rôle sa lettre dans une instruction (liste déroulante). "" = non concerné.
//   R : réalisateur principal s'il n'y en a pas encore, sinon autre réalisateur (participant : instruction collaborative)
//   A : un seul par instruction (le A précédent est retiré)   C, I : consulté, informé
export function definirRaci(etapeId, roleId, lettre) {
  const etape = procedure.etapes.find((e) => e.id === etapeId);
  if (!etape || !procedure.roles.some((r) => r.id === roleId) || !["", ...LETTRES_RACI].includes(lettre)) return;
  if (lettreRaci(etape, roleId) === lettre) return;
  avant();
  if (etape.roleId === roleId) etape.roleId = etape.participants.shift() || ""; // le suivant devient réalisateur principal
  etape.participants = etape.participants.filter((p) => p !== roleId);
  delete etape.raci[roleId];
  if (lettre === "R") {
    if (!etape.roleId) etape.roleId = roleId;
    else etape.participants.push(roleId);
  } else if (lettre === "A") {
    Object.keys(etape.raci).forEach((k) => { if (etape.raci[k] === "A") delete etape.raci[k]; });
    etape.raci[roleId] = "A";
  } else if (lettre) {
    etape.raci[roleId] = lettre;
  }
  apres(true);
}

export function basculerParticipant(id, roleId) {
  avant();
  const etape = procedure.etapes.find((e) => e.id === id);
  if (!etape || roleId === etape.roleId) return;
  etape.participants = etape.participants.includes(roleId)
    ? etape.participants.filter((p) => p !== roleId)
    : [...etape.participants, roleId];
  delete etape.raci[roleId]; // un participant est un réalisateur (R) : il n'a plus de A, C ou I
  apres(false);
}

// ---------- Corps du document (13 sections : paragraphes et tableaux) ----------
function bloc(cle, id) {
  const liste = procedure.corps[cle];
  return liste ? liste.find((b) => b.id === id) : undefined;
}

export function ajouterBloc(cle, type, colonnes = []) {
  const liste = procedure.corps[cle];
  if (!SECTIONS.includes(cle) || !liste || liste.length >= MAX_BLOCS) return;
  if (type === "tableau" && colonnes.length === 0) return;
  avant();
  liste.push(nouveauBloc(type, colonnes.slice(0, MAX_COLONNES).map((c) => texteCourt(c, 200))));
  apres(true);
}

export function supprimerBloc(cle, id) {
  const liste = procedure.corps[cle];
  if (!liste || !bloc(cle, id) || bloc(cle, id).type === "genere") return;
  avant();
  procedure.corps[cle] = liste.filter((b) => b.id !== id);
  apres(true);
}

export function deplacerBloc(cle, id, sens) {
  const liste = procedure.corps[cle];
  const i = liste ? liste.findIndex((b) => b.id === id) : -1;
  const j = i + sens;
  if (i < 0 || j < 0 || j >= liste.length) return;
  avant();
  const [b] = liste.splice(i, 1);
  liste.splice(j, 0, b);
  apres(true);
}

export function modifierTexteBloc(cle, id, texte) {
  const b = bloc(cle, id);
  if (!b || b.type !== "p") return;
  avant("bloc:" + id);
  b.texte = texteCourt(texte, 5000);
  apres(false);
}

export function modifierEnTete(cle, id, colonne, valeur) {
  const b = bloc(cle, id);
  if (!b || b.type !== "tableau" || colonne < 0 || colonne >= b.colonnes.length) return;
  avant("th:" + id + colonne);
  b.colonnes[colonne] = texteCourt(valeur, 200);
  apres(false);
}

export function modifierCellule(cle, id, ligne, colonne, valeur) {
  const b = bloc(cle, id);
  if (!b || b.type !== "tableau" || !b.lignes[ligne] || colonne < 0 || colonne >= b.colonnes.length) return;
  avant("td:" + id + ligne + "-" + colonne);
  b.lignes[ligne][colonne] = texteCourt(valeur, 1000);
  apres(false);
}

export function ajouterLigne(cle, id) {
  const b = bloc(cle, id);
  if (!b || b.type !== "tableau" || b.lignes.length >= MAX_LIGNES) return;
  avant();
  b.lignes.push(b.colonnes.map(() => ""));
  apres(true);
}

export function supprimerLigne(cle, id, ligne) {
  const b = bloc(cle, id);
  if (!b || b.type !== "tableau" || !b.lignes[ligne]) return;
  avant();
  b.lignes.splice(ligne, 1);
  apres(true);
}

export function ajouterColonne(cle, id) {
  const b = bloc(cle, id);
  if (!b || b.type !== "tableau" || b.colonnes.length >= MAX_COLONNES) return;
  avant();
  b.colonnes.push("");
  b.lignes.forEach((l) => l.push(""));
  apres(true);
}

export function supprimerColonne(cle, id, colonne) {
  const b = bloc(cle, id);
  if (!b || b.type !== "tableau" || b.colonnes.length <= 1 || colonne < 0 || colonne >= b.colonnes.length) return;
  avant();
  b.colonnes.splice(colonne, 1);
  b.lignes.forEach((l) => l.splice(colonne, 1));
  apres(true);
}

// ---------- Outils d'une instruction ----------
export function ajouterOutil(etapeId, type) {
  avant();
  const etape = procedure.etapes.find((e) => e.id === etapeId);
  if (!etape || !TYPES_OUTIL.includes(type) || etape.outils.length >= MAX_OUTILS) return;
  etape.outils.push({ id: nouvelId("o"), type, nom: "" });
  apres(true);
}

export function modifierOutil(etapeId, outilId, champ, valeur) {
  avant("outil:" + outilId + champ);
  const etape = procedure.etapes.find((e) => e.id === etapeId);
  const outil = etape && etape.outils.find((o) => o.id === outilId);
  if (!outil || (champ !== "nom" && champ !== "type")) return;
  if (champ === "type" && !TYPES_OUTIL.includes(valeur)) return;
  outil[champ] = valeur;
  apres(champ === "type");
}

export function supprimerOutil(etapeId, outilId) {
  avant();
  const etape = procedure.etapes.find((e) => e.id === etapeId);
  if (!etape) return;
  etape.outils = etape.outils.filter((o) => o.id !== outilId);
  apres(true);
}

// ---------- Risques maîtrisés par une instruction (alimentent la section 10) ----------
const CHAMPS_RISQUE = ["risque", "causes", "gravite", "probabilite", "mesure"];

function etapeDe(id) {
  return procedure.etapes.find((e) => e.id === id);
}

// Coche « cette instruction maîtrise un risque » : crée un premier risque à remplir ; décoche : les supprime.
export function basculerRisques(etapeId, actif) {
  const etape = etapeDe(etapeId);
  if (!etape) return;
  avant();
  etape.risques = actif ? (etape.risques.length ? etape.risques : [nouveauRisque()]) : [];
  apres(true);
}

export function ajouterRisque(etapeId) {
  const etape = etapeDe(etapeId);
  if (!etape || etape.risques.length >= MAX_RISQUES) return;
  avant();
  etape.risques.push(nouveauRisque());
  apres(true);
}

export function modifierRisque(etapeId, risqueId, champ, valeur) {
  const etape = etapeDe(etapeId);
  const risque = etape && etape.risques.find((r) => r.id === risqueId);
  if (!risque || !CHAMPS_RISQUE.includes(champ)) return;
  if ((champ === "gravite" || champ === "probabilite") && !["", "1", "2", "3", "4"].includes(valeur)) return;
  avant("risque:" + risqueId + champ);
  risque[champ] = valeur;
  apres(champ === "gravite" || champ === "probabilite"); // la criticité affichée dépend de ces deux champs
}

export function supprimerRisque(etapeId, risqueId) {
  const etape = etapeDe(etapeId);
  if (!etape) return;
  avant();
  etape.risques = etape.risques.filter((r) => r.id !== risqueId);
  apres(true);
}

// ---------- Opportunités d'amélioration portées par une instruction (v0.28 ; section 9) ----------
const CHAMPS_OPPORTUNITE = ["opportunite", "benefice", "interet", "faisabilite"];

export function basculerOpportunites(etapeId, actif) {
  const etape = etapeDe(etapeId);
  if (!etape) return;
  avant();
  etape.opportunites = actif ? (etape.opportunites && etape.opportunites.length ? etape.opportunites : [nouvelleOpportunite()]) : [];
  apres(true);
}

export function ajouterOpportunite(etapeId) {
  const etape = etapeDe(etapeId);
  if (!etape || (etape.opportunites && etape.opportunites.length >= MAX_OPPORTUNITES)) return;
  avant();
  (etape.opportunites = etape.opportunites || []).push(nouvelleOpportunite());
  apres(true);
}

export function modifierOpportunite(etapeId, oppId, champ, valeur) {
  const etape = etapeDe(etapeId);
  const opp = etape && (etape.opportunites || []).find((o) => o.id === oppId);
  if (!opp || !CHAMPS_OPPORTUNITE.includes(champ)) return;
  if ((champ === "interet" || champ === "faisabilite") && !["", "1", "2", "3"].includes(valeur)) return;
  avant("opp:" + oppId + champ);
  opp[champ] = valeur;
  apres(champ === "interet" || champ === "faisabilite"); // le score affiché dépend de ces deux champs
}

export function supprimerOpportunite(etapeId, oppId) {
  const etape = etapeDe(etapeId);
  if (!etape) return;
  avant();
  etape.opportunites = (etape.opportunites || []).filter((o) => o.id !== oppId);
  apres(true);
}

// ---------- Niveau 3 : l'instruction fait l'objet d'une instruction de travail ----------
export function modifierNiveau3(etapeId, champ, valeur) {
  const etape = etapeDe(etapeId);
  if (!etape || !["actif", "code", "intitule"].includes(champ)) return;
  if (champ === "actif") {
    avant();
    etape.niveau3.actif = valeur === true;
    if (etape.niveau3.actif) libererForme(etape, "niveau3"); // une instruction n'a qu'une forme particulière à la fois
    apres(true);
    return;
  }
  avant("n3:" + etapeId + champ);
  etape.niveau3[champ] = valeur;
  apres(false);
}

// ---------- Contrôle : triangle Q / H / S / R / E sur l'instruction (alimente la section 8) ----------
const CHAMPS_CONTROLE = ["actif", "nature", "critere", "enregistrement"];

// Cocher « contrôle » prépare aussi la suite si le résultat n'est pas conforme (une alternative à compléter).
export function modifierControle(etapeId, champ, valeur) {
  const etape = etapeDe(etapeId);
  if (!etape || !CHAMPS_CONTROLE.includes(champ)) return;
  if (champ === "actif") {
    avant();
    etape.controle.actif = valeur === true;
    if (etape.controle.actif) etape.operateurSortie = "ou"; // un contrôle est toujours une alternative (conforme / non conforme)
    if (etape.controle.actif && etape.alternatives.length === 0) etape.alternatives.push(nouvelleAlternative());
    apres(true);
    return;
  }
  if (champ === "nature" && valeur !== "" && !NATURES_CONTROLE.includes(valeur)) return;
  avant("controle:" + etapeId + champ);
  etape.controle[champ] = valeur;
  apres(false);
}

// ---------- Décision : plusieurs suites possibles (OU en sortie), retours, sauts, fin ----------
const CHAMPS_ALTERNATIVE = ["condition", "info", "versQui", "vers"];

export function basculerDecision(etapeId, actif) {
  const etape = etapeDe(etapeId);
  if (!etape) return;
  avant();
  if (actif) {
    if (etape.alternatives.length === 0) etape.alternatives.push(nouvelleAlternative());
  } else {
    etape.alternatives = [];
    etape.condition = "";
    etape.operateurSortie = "ou";
  }
  apres(true);
}

export function ajouterAlternative(etapeId) {
  const etape = etapeDe(etapeId);
  if (!etape || etape.alternatives.length >= MAX_ALTERNATIVES) return;
  avant();
  etape.alternatives.push(nouvelleAlternative());
  apres(true);
}

export function modifierAlternative(etapeId, altId, champ, valeur) {
  const etape = etapeDe(etapeId);
  const alt = etape && etape.alternatives.find((a) => a.id === altId);
  if (!alt || !CHAMPS_ALTERNATIVE.includes(champ)) return;
  // Destination : rien (à choisir), la fin, ou une AUTRE instruction existante.
  if (champ === "vers" && valeur !== "" && valeur !== "fin" && !procedure.etapes.some((e) => e.id === valeur && e.id !== etapeId)) return;
  avant("alt:" + altId + champ);
  alt[champ] = valeur;
  apres(false);
}

export function supprimerAlternative(etapeId, altId) {
  const etape = etapeDe(etapeId);
  if (!etape) return;
  avant();
  etape.alternatives = etape.alternatives.filter((a) => a.id !== altId);
  if (etape.alternatives.length === 0) { etape.condition = ""; etape.operateurSortie = "ou"; }
  apres(true);
}

// ---------- Opérateurs ET / OU, contrainte de délai ou de coût, instruction correctrice (éléments facultatifs d'une instruction) ----------
// Opérateur de sortie : « ou » (une seule des suites) ou « et » (toutes en même temps). Un contrôle est toujours « ou ».
export function modifierOperateurSortie(etapeId, valeur) {
  const etape = etapeDe(etapeId);
  if (!etape || !OPERATEURS.includes(valeur)) return;
  if (valeur === "et" && etape.controle && etape.controle.actif) return;
  avant();
  etape.operateurSortie = valeur;
  apres(true);
}

// Opérateur d'entrée : "" (aucun), « et » ou « ou ».
export function modifierOperateurEntree(etapeId, valeur) {
  const etape = etapeDe(etapeId);
  if (!etape || (valeur !== "" && !OPERATEURS.includes(valeur))) return;
  avant();
  etape.operateurEntree = valeur;
  apres(true);
}

const CHAMPS_CONTRAINTE = ["actif", "nature", "texte"];
export function modifierContrainte(etapeId, champ, valeur) {
  const etape = etapeDe(etapeId);
  if (!etape || !CHAMPS_CONTRAINTE.includes(champ)) return;
  if (champ === "actif") {
    avant();
    etape.contrainte.actif = valeur === true;
    if (etape.contrainte.actif && !etape.contrainte.nature) etape.contrainte.nature = "delai";
    apres(true);
    return;
  }
  if (champ === "nature" && !NATURES_CONTRAINTE.includes(valeur)) return;
  avant("contrainte:" + etapeId + champ);
  etape.contrainte[champ] = champ === "texte" ? texteCourt(valeur, 40) : valeur;
  apres(champ === "nature");
}

export function basculerCorrectrice(etapeId, actif) {
  const etape = etapeDe(etapeId);
  if (!etape) return;
  avant();
  etape.correctrice = actif === true;
  apres(true);
}

// Marque (ou non) un point d'alerte du questionnement comme « sans objet » pour une instruction. cle ∈ { comment, avec, contraintes }.
const CLES_SANS_OBJET = ["comment", "avec", "contraintes"];
export function basculerSansObjet(etapeId, cle, actif) {
  const etape = etapeDe(etapeId);
  if (!etape || !CLES_SANS_OBJET.includes(cle)) return;
  if (!etape.sansObjet || typeof etape.sansObjet !== "object") etape.sansObjet = { comment: false, avec: false, contraintes: false };
  avant();
  etape.sansObjet[cle] = actif === true;
  apres(true);
}
export function basculerSansObjetOperation(opId, cle, actif) {
  const op = operationDe(opId);
  if (!op || !["avec", "contraintes"].includes(cle)) return;
  if (!op.sansObjet || typeof op.sansObjet !== "object") op.sansObjet = { avec: false, contraintes: false };
  avant();
  op.sansObjet[cle] = actif === true;
  apres(true);
}

// ---------- Formes particulières d'une instruction : niveau 3, sous-procédure, macro-instruction ----------
// Une instruction n'a qu'UNE de ces formes à la fois (cadre du dessin) : en activer une désactive les autres.
function libererForme(etape, garder) {
  if (garder !== "niveau3") etape.niveau3.actif = false;
  if (garder !== "sousProcedure") etape.sousProcedure.actif = false;
  if (garder !== "macro") etape.macro.type = "";
}

export function modifierSousProcedure(etapeId, champ, valeur) {
  const etape = etapeDe(etapeId);
  if (!etape || !["actif", "code"].includes(champ)) return;
  if (champ === "actif") {
    avant();
    etape.sousProcedure.actif = valeur === true;
    if (etape.sousProcedure.actif) libererForme(etape, "sousProcedure");
    apres(true);
    return;
  }
  avant("sp:" + etapeId);
  etape.sousProcedure.code = texteCourt(valeur, 60);
  apres(false);
}

// Macro-instruction : "" (aucune), "regroupement" ou "alternatives".
export function definirMacro(etapeId, type) {
  const etape = etapeDe(etapeId);
  if (!etape || (type !== "" && !TYPES_MACRO.includes(type))) return;
  avant();
  etape.macro.type = type;
  if (type) libererForme(etape, "macro");
  if (type === "alternatives" && etape.macro.alternatives.length === 0) etape.macro.alternatives = ["", ""];
  apres(true);
}

export function modifierMacroDetail(etapeId, valeur) {
  const etape = etapeDe(etapeId);
  if (!etape) return;
  avant("macro:" + etapeId);
  etape.macro.detail = texteCourt(valeur, 200);
  apres(false);
}

export function ajouterAlternativeMacro(etapeId) {
  const etape = etapeDe(etapeId);
  if (!etape || etape.macro.alternatives.length >= MAX_ALTERNATIVES_MACRO) return;
  avant();
  etape.macro.alternatives.push("");
  apres(true);
}

export function modifierAlternativeMacro(etapeId, rang, valeur) {
  const etape = etapeDe(etapeId);
  if (!etape || !Number.isInteger(rang) || rang < 0 || rang >= etape.macro.alternatives.length) return;
  avant("macroalt:" + etapeId + rang);
  etape.macro.alternatives[rang] = texteCourt(valeur, 120);
  apres(false);
}

export function supprimerAlternativeMacro(etapeId, rang) {
  const etape = etapeDe(etapeId);
  if (!etape || !Number.isInteger(rang) || rang < 0 || rang >= etape.macro.alternatives.length) return;
  avant();
  etape.macro.alternatives.splice(rang, 1);
  apres(true);
}

// ---------- Indicateur de performance (fanion) ----------
const LIMITES_INDICATEUR = { nom: 200, formule: 300, cible: 120, frequence: 120 };
export function modifierIndicateur(etapeId, champ, valeur) {
  const etape = etapeDe(etapeId);
  if (!etape || !["actif", ...Object.keys(LIMITES_INDICATEUR)].includes(champ)) return;
  if (champ === "actif") {
    avant();
    etape.indicateur.actif = valeur === true;
    apres(true);
    return;
  }
  avant("ind:" + etapeId);
  etape.indicateur[champ] = texteCourt(valeur, LIMITES_INDICATEUR[champ]);
  apres(false);
}

// ---------- Indicateur d'interface : contrat sur la flèche de sortie (livre §6.5.22) ----------
export function modifierContrat(etapeId, champ, valeur) {
  const etape = etapeDe(etapeId);
  if (!etape || !["actif", "reference"].includes(champ)) return;
  if (champ === "actif") {
    avant();
    etape.contrat.actif = valeur === true;
    apres(true);
    return;
  }
  avant("contrat:" + etapeId);
  etape.contrat.reference = texteCourt(valeur, 80);
  apres(false);
}

// ---------- Actions hors périmètre : amont (avant le Début) et aval (après la Fin) ----------
export function modifierRaccord(quel, champ, valeur) {
  if (!["amont", "aval"].includes(quel) || !["texte", "role", "information"].includes(champ)) return;
  avant("raccord:" + quel + champ);
  procedure.meta[quel][champ] = texteCourt(valeur, champ === "role" ? 60 : 200);
  apres(false);
}

// ---------- Instruction de travail (niveau 3) : un rôle, des opérations, des contrôles et des actions correctives ----------
const CHAMPS_OPERATION = ["libelle", "entree", "sortie", "commentaire"];
const LONGUEUR_CHAMP_OPERATION = { libelle: 300, commentaire: 2000 };
const BOOLEENS_OPERATION = ["vigilance", "enregistrement"];
const operationDe = (id) => procedure.it.operations.find((o) => o.id === id);

export function modifierRoleIT(champ, valeur) {
  if (champ !== "nom") return;
  avant("itrole:" + champ);
  procedure.it.role.nom = texteCourt(valeur, 200);
  apres(false);
}

export function ajouterOperation() {
  if (procedure.it.operations.length >= MAX_OPERATIONS_SAISIE) return;
  avant();
  procedure.it.operations.push(nouvelleOperation());
  apres(true);
}

export function modifierOperation(id, champ, valeur) {
  const op = operationDe(id);
  if (!op) return;
  if (BOOLEENS_OPERATION.includes(champ)) {
    if (typeof valeur !== "boolean") return;
    avant();
    op[champ] = valeur;
    apres(true);
    return;
  }
  if (!CHAMPS_OPERATION.includes(champ)) return;
  avant("op:" + id + champ);
  op[champ] = texteCourt(valeur, LONGUEUR_CHAMP_OPERATION[champ] ?? 500);
  apres(false);
}

export function deplacerOperation(id, sens) {
  const liste = procedure.it.operations;
  const i = liste.findIndex((o) => o.id === id);
  const j = i + sens;
  if (i < 0 || j < 0 || j >= liste.length) return;
  avant();
  const [op] = liste.splice(i, 1);
  liste.splice(j, 0, op);
  apres(true);
}

// Une copie a de nouveaux identifiants, y compris pour ses contrôles et ses correctives (les liens entre eux sont conservés).
function copierOperation(op) {
  const nouvelle = { ...copie(op), id: nouvelId("p") };
  nouvelle.outils = nouvelle.outils.map((o) => ({ ...o, id: nouvelId("o") }));
  const correspondance = new Map();
  nouvelle.correctives = nouvelle.correctives.map((m) => {
    const id = nouvelId("m");
    correspondance.set(m.id, id);
    return { ...m, id };
  });
  nouvelle.controles = nouvelle.controles.map((c) => ({ ...c, id: nouvelId("c"), correctives: c.correctives.map((k) => correspondance.get(k)).filter(Boolean) }));
  return nouvelle;
}

export function dupliquerOperation(id) {
  const liste = procedure.it.operations;
  const i = liste.findIndex((o) => o.id === id);
  if (i < 0 || liste.length >= MAX_OPERATIONS_SAISIE) return;
  avant();
  liste.splice(i + 1, 0, copierOperation(liste[i]));
  apres(true);
}

export function supprimerOperation(id) {
  if (!operationDe(id)) return;
  avant();
  procedure.it.operations = procedure.it.operations.filter((o) => o.id !== id);
  apres(true);
}

export function modifierContrainteOperation(opId, champ, valeur) {
  const op = operationDe(opId);
  if (!op || !CHAMPS_CONTRAINTE.includes(champ)) return;
  if (champ === "actif") {
    avant();
    op.contrainte.actif = valeur === true;
    if (op.contrainte.actif && !op.contrainte.nature) op.contrainte.nature = "delai";
    apres(true);
    return;
  }
  if (champ === "nature" && !NATURES_CONTRAINTE.includes(valeur)) return;
  avant("opcontrainte:" + opId + champ);
  op.contrainte[champ] = champ === "texte" ? texteCourt(valeur, 40) : valeur;
  apres(champ === "nature");
}

export function ajouterOutilOperation(opId, type) {
  const op = operationDe(opId);
  if (!op || !TYPES_OUTIL.includes(type) || op.outils.length >= MAX_OUTILS) return;
  avant();
  op.outils.push({ id: nouvelId("o"), type, nom: "" });
  apres(true);
}

export function modifierOutilOperation(opId, outilId, champ, valeur) {
  const op = operationDe(opId);
  const outil = op && op.outils.find((o) => o.id === outilId);
  if (!outil || (champ !== "nom" && champ !== "type")) return;
  if (champ === "type" && !TYPES_OUTIL.includes(valeur)) return;
  avant("opoutil:" + outilId + champ);
  outil[champ] = champ === "nom" ? texteCourt(valeur, 200) : valeur;
  apres(champ === "type");
}

export function supprimerOutilOperation(opId, outilId) {
  const op = operationDe(opId);
  if (!op) return;
  avant();
  op.outils = op.outils.filter((o) => o.id !== outilId);
  apres(true);
}

// Contrôles d'une opération (plan d'auto-contrôle). Un nouveau contrôle est lié à la première corrective de l'opération, s'il y en a une.
export function ajouterControleOperation(opId) {
  const op = operationDe(opId);
  if (!op || op.controles.length >= MAX_CONTROLES) return;
  avant();
  op.controles.push(nouveauControle({ correctives: op.correctives.length ? [op.correctives[0].id] : [] }));
  apres(true);
}

export function modifierControleOperation(opId, ctrlId, champ, valeur) {
  const op = operationDe(opId);
  const c = op && op.controles.find((x) => x.id === ctrlId);
  if (!c || !["question", "nature", "enregistrement"].includes(champ)) return;
  if (champ === "nature" && valeur !== "" && !NATURES_CONTROLE.includes(valeur)) return;
  if (champ === "enregistrement") {
    if (typeof valeur !== "boolean") return;
    avant();
    c.enregistrement = valeur;
    apres(true);
    return;
  }
  avant("opctrl:" + ctrlId + champ);
  c[champ] = champ === "question" ? texteCourt(valeur, 300) : valeur;
  apres(champ === "nature");
}

export function supprimerControleOperation(opId, ctrlId) {
  const op = operationDe(opId);
  if (!op) return;
  avant();
  op.controles = op.controles.filter((c) => c.id !== ctrlId);
  apres(true);
}

// Lie ou délie une corrective à un contrôle de la même opération.
export function lierCorrective(opId, ctrlId, corrId, actif) {
  const op = operationDe(opId);
  const c = op && op.controles.find((x) => x.id === ctrlId);
  if (!c || !op.correctives.some((m) => m.id === corrId)) return;
  if (c.correctives.includes(corrId) === (actif === true)) return;
  avant();
  c.correctives = actif === true ? [...c.correctives, corrId] : c.correctives.filter((k) => k !== corrId);
  apres(true);
}

// Ajoute une action corrective à l'opération ; si un contrôle est donné, elle lui est aussitôt liée.
export function ajouterCorrective(opId, ctrlId = "") {
  const op = operationDe(opId);
  if (!op || op.correctives.length >= MAX_CORRECTIVES) return;
  avant();
  const m = nouvelleCorrective();
  op.correctives.push(m);
  const c = op.controles.find((x) => x.id === ctrlId);
  if (c) c.correctives.push(m.id);
  apres(true);
}

export function modifierCorrective(opId, corrId, champ, valeur) {
  const op = operationDe(opId);
  const m = op && op.correctives.find((x) => x.id === corrId);
  if (!m || !["libelle", "renvoi"].includes(champ)) return;
  avant("opcorr:" + corrId + champ);
  m[champ] = texteCourt(valeur, champ === "libelle" ? 300 : 200);
  apres(false);
}

export function supprimerCorrective(opId, corrId) {
  const op = operationDe(opId);
  if (!op) return;
  avant();
  op.correctives = op.correctives.filter((m) => m.id !== corrId);
  op.controles.forEach((c) => { c.correctives = c.correctives.filter((k) => k !== corrId); });
  apres(true);
}

// Raccourci : depuis une instruction marquée « niveau 3 » d'une procédure, crée l'instruction de travail correspondante
// (organisation, logo, processus, auteur, domaine repris ; titre et code = ceux du niveau 3 ; rôle = celui de l'instruction).
// Renvoie true si l'instruction a été créée. La procédure d'origine n'est pas modifiée ici : l'appelant l'a déjà enregistrée.
export function creerInstructionDepuisEtape(etapeId) {
  const nouvelleDoc = instructionDepuisEtape(procedure, etapeId);
  if (!nouvelleDoc) return false;
  avant();
  procedure = nettoyer(nouvelleDoc);
  apres(true);
  return true;
}

// ---------- Logo de l'organisation ----------
// Image PNG ou JPEG (data URL) : la page la redimensionne avant de l'envoyer ici ; on ne garde que ce qui ressemble vraiment
// à une de ces deux images (début du fichier reconnu, taille limitée).
export function logoValide(v) {
  if (typeof v !== "string" || v.length > LOGO_MAX_OCTETS * 1.4) return "";
  const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(v);
  if (!m) return "";
  let debut;
  try { debut = atob(m[2].slice(0, 16)); } catch (e) { return ""; }
  const octets = [...debut].map((c) => c.charCodeAt(0));
  const png = octets[0] === 0x89 && octets[1] === 0x50 && octets[2] === 0x4e && octets[3] === 0x47;
  const jpeg = octets[0] === 0xff && octets[1] === 0xd8 && octets[2] === 0xff;
  return (m[1] === "png" && png) || (m[1] === "jpeg" && jpeg) ? v : "";
}

export function definirLogo(dataUrl) {
  const propre = dataUrl === "" ? "" : logoValide(dataUrl);
  if (dataUrl !== "" && propre === "") return false;
  avant();
  procedure.meta.logo = propre;
  apres(true);
  return true;
}

export function deplacerEtape(id, sens) {
  avant();
  const i = procedure.etapes.findIndex((e) => e.id === id);
  const j = i + sens;
  if (i < 0 || j < 0 || j >= procedure.etapes.length) return;
  const [etape] = procedure.etapes.splice(i, 1);
  procedure.etapes.splice(j, 0, etape);
  apres(true);
}

export function dupliquerEtape(id) {
  const i = procedure.etapes.findIndex((e) => e.id === id);
  if (i < 0) return;
  avant();
  const copieEtape = { ...copie(procedure.etapes[i]), id: nouvelId("e") };
  copieEtape.outils = copieEtape.outils.map((o) => ({ ...o, id: nouvelId("o") }));
  copieEtape.risques = copieEtape.risques.map((r) => ({ ...r, id: nouvelId("k") }));
  copieEtape.opportunites = (copieEtape.opportunites || []).map((o) => ({ ...o, id: nouvelId("o") }));
  copieEtape.alternatives = copieEtape.alternatives.map((a) => ({ ...a, id: nouvelId("a") }));
  procedure.etapes.splice(i + 1, 0, copieEtape);
  apres(true);
}

export function supprimerEtape(id) {
  avant();
  procedure.etapes = procedure.etapes.filter((e) => e.id !== id);
  // Une suite qui menait à l'instruction supprimée doit être choisie de nouveau.
  procedure.etapes.forEach((e) => e.alternatives.forEach((a) => { if (a.vers === id) a.vers = ""; }));
  apres(true);
}

// ---------- Procédure entière ----------
// « type » (facultatif) : « procedure » ou « instruction » — le document démarre alors avec ce type choisi (page d'accueil).
export function nouvelle(type = "") {
  avant();
  procedure = nouvelleProcedure();
  if (TYPES_DOCUMENT.includes(type)) {
    procedure.meta.typeDocument = type;
    procedure.meta.niveau = type === "instruction" ? 3 : 2;
  }
  apres(true);
}

export function chargerExemple() {
  avant();
  procedure = exempleProcedure();
  considererEnregistre(); // un exemple se recharge à volonté : rien à protéger
  apres(true);
}

export function chargerExempleInstruction() {
  avant();
  procedure = exempleInstruction();
  considererEnregistre();
  apres(true);
}

// ---------- En ligne : document reçu du serveur, lecture seule ----------
// Ouvre le document reçu du serveur. Même nettoyage qu'un fichier .json (le contenu n'est jamais pris tel quel) ; lève une erreur
// AVANT de toucher à l'état s'il n'a pas la forme d'un document. L'historique repart de zéro : on n'« annule » pas une ouverture.
export function demarrerAvec(brute) {
  const propre = nettoyer(brute);
  procedure = propre;
  passe.length = 0;
  futur.length = 0;
  derniereCle = "";
  if (verrouille) documentOuvert = copie(propre);
  considererEnregistre();
  apres(true);
}

// Lecture seule : le document reste consultable (étapes, aperçus, synthèse, Word, PDF) mais ne peut plus changer.
export function verrouiller() {
  verrouille = true;
  documentOuvert = copie(procedure);
  passe.length = 0;
  futur.length = 0;
}
export const estVerrouille = () => verrouille;

// ---------- Sauvegarde locale (navigateur) ----------
// En ligne, rien n'est gardé dans le navigateur : le document vit sur le serveur.
function sauvegarderLocalement() {
  if (EN_LIGNE) return;
  try {
    localStorage.setItem(CLE_STOCKAGE, JSON.stringify(procedure));
    localStorage.setItem(CLE_MODIFIE, String(instantModification));
  } catch (e) {
    // stockage indisponible (mode privé…) : l'application continue de fonctionner sans brouillon.
  }
}

function charger() {
  if (EN_LIGNE) return null;
  try {
    const brut = localStorage.getItem(CLE_STOCKAGE);
    return brut ? nettoyer(JSON.parse(brut)) : null;
  } catch (e) {
    return null;
  }
}

// ---------- v0.22 : le document est-il enregistré dans un fichier .json ? ----------
// Le brouillon vit dans le navigateur (il revient tout seul à la réouverture) ; mais vider les données du navigateur, changer d'ordinateur ou
// travailler en navigation privée l'efface. « Non enregistré » = le document n'est pas vide ET diffère de celui du dernier fichier .json
// enregistré ou ouvert (l'empreinte est gardée dans le navigateur pour survivre à un rechargement).
function memoriserEnregistre() {
  if (EN_LIGNE) return;
  try {
    localStorage.setItem(CLE_ENREGISTRE, empreinteEnregistree);
  } catch (e) {
    // stockage indisponible : l'information reste valable jusqu'à la fermeture de la page.
  }
}
function considererEnregistre() {
  empreinteEnregistree = empreinteDocument(procedure);
  memoriserEnregistre();
}
// Appelée par « Enregistrer » (fichier .json téléchargé).
export function marquerEnregistre() {
  considererEnregistre();
  abonnesEnregistrement.forEach((fn) => fn());
}
export function abonnerEnregistrement(fn) {
  abonnesEnregistrement.push(fn);
}
export function nonEnregistre() {
  return !estDocumentVide(procedure) && empreinteDocument(procedure) !== empreinteEnregistree;
}
// Instant (millisecondes) de la dernière modification du brouillon ; 0 si on ne le sait pas (brouillon d'avant la v0.22).
export function derniereModification() {
  return instantModification;
}

// ---------- Fichiers .json ----------
export function exporterJSON() {
  return JSON.stringify({ application: "jalonia", version: 1, procedure }, null, 2);
}

// Un fichier importé est une donnée NON FIABLE : on ne le copie jamais tel quel. nettoyer() reconstruit
// une procédure propre en ne gardant que les champs connus, avec des types et des longueurs contrôlés.
// Lève une erreur si le fichier n'a pas la forme d'une procédure.
export function importerJSON(texte) {
  const brut = JSON.parse(texte);
  const propre = nettoyer(brut.procedure ?? brut); // lève une erreur avant de toucher à l'état
  avant();
  procedure = propre;
  considererEnregistre(); // le fichier qu'on vient d'ouvrir est, par définition, enregistré
  apres(true);
}

// Remplace la procédure par une procédure construite par un import (Word…) : même nettoyage qu'un .json.
export function importerProcedure(brute) {
  const propre = nettoyer(brute);
  avant();
  procedure = propre;
  considererEnregistre(); // le Word qu'on vient d'importer contient ce document
  apres(true);
}

// Sections dont un tableau est construit automatiquement (rôles, instructions, risques maîtrisés).
const BLOCS_GENERES = ["responsabilites", "description", "indicateurs", "risques"];

// Anciennes sections (13 sections avant la v0.11) : leur contenu saisi est repris dans la section qui les remplace.
const SECTIONS_FUSIONNEES = { controles: "description", annexes: "enregistrements" };

// Le corps du document : on ne garde que des blocs connus, aux tailles limitées.
function nettoyerCorps(brut) {
  const corps = nouveauCorps();
  const source = brut && typeof brut === "object" ? brut : {};
  const nettoyerSection = (cle, liste, deja = []) => {
    const vus = new Set(deja.map((b) => b.id));
    const propres = [];
    liste.slice(0, MAX_BLOCS).forEach((b) => {
      if (!b || typeof b !== "object") return;
      let id = idPropre(b.id);
      if (!id || vus.has(id)) id = nouvelId("b");
      vus.add(id);
      if (b.type === "p") {
        propres.push({ id, type: "p", texte: texteCourt(b.texte, 5000) });
      } else if (b.type === "genere" && BLOCS_GENERES.includes(cle)) {
        if (!propres.some((x) => x.type === "genere")) propres.push({ id, type: "genere" });
      } else if (b.type === "tableau" && Array.isArray(b.colonnes) && b.colonnes.length > 0) {
        const colonnes = b.colonnes.slice(0, MAX_COLONNES).map((c) => texteCourt(c, 200));
        const lignes = (Array.isArray(b.lignes) ? b.lignes : []).slice(0, MAX_LIGNES).filter(Array.isArray)
          .map((l) => colonnes.map((_, i) => texteCourt(l[i], 1000)));
        propres.push({ id, type: "tableau", colonnes, lignes });
      }
    });
    return propres;
  };
  SECTIONS.forEach((cle) => {
    const propres = Array.isArray(source[cle]) ? nettoyerSection(cle, source[cle]) : [];
    // Les sections 5, 6, 8 et 9 gardent toujours leur tableau généré.
    if (BLOCS_GENERES.includes(cle) && !propres.some((x) => x.type === "genere")) {
      propres.push({ id: nouvelId("b"), type: "genere" });
    }
    corps[cle] = propres;
  });
  // Ancien fichier (13 sections) : ce qui était écrit dans « Points de contrôle » et « Annexes » est repris à la suite de la section qui les remplace.
  Object.entries(SECTIONS_FUSIONNEES).forEach(([ancienne, cible]) => {
    if (!Array.isArray(source[ancienne])) return;
    // (les paragraphes de « Points de contrôle » présentaient le tableau généré, qui n'existe plus : seuls ses tableaux saisis sont repris)
    const repris = nettoyerSection(ancienne, source[ancienne], corps[cible]).filter((b) => b.type !== "genere" && !(ancienne === "controles" && b.type === "p"));
    corps[cible] = [...corps[cible], ...repris].slice(0, MAX_BLOCS);
  });
  return corps;
}

function nettoyerOutils(brut) {
  if (!Array.isArray(brut)) return [];
  const vus = new Set();
  const propres = [];
  brut.slice(0, MAX_OUTILS).forEach((o) => {
    if (!o || typeof o !== "object") return;
    let id = idPropre(o.id);
    if (!id || vus.has(id)) id = nouvelId("o");
    vus.add(id);
    propres.push({ id, type: TYPES_OUTIL.includes(o.type) ? o.type : "document", nom: texteCourt(o.nom, 200) });
  });
  return propres;
}

function nettoyerRisques(brut) {
  if (!Array.isArray(brut)) return [];
  const vus = new Set();
  const propres = [];
  brut.slice(0, MAX_RISQUES).forEach((r) => {
    if (!r || typeof r !== "object") return;
    let id = idPropre(r.id);
    if (!id || vus.has(id)) id = nouvelId("k");
    vus.add(id);
    const cote = (v) => (["1", "2", "3", "4"].includes(String(v)) ? String(v) : "");
    propres.push({
      id, risque: texteCourt(r.risque, 500), causes: texteCourt(r.causes, 500),
      gravite: cote(r.gravite), probabilite: cote(r.probabilite), mesure: texteCourt(r.mesure, 1000),
    });
  });
  return propres;
}

// v0.28 : opportunités (intérêt × faisabilité, cotées 1 à 3).
function nettoyerOpportunites(brut) {
  if (!Array.isArray(brut)) return [];
  const vus = new Set();
  const propres = [];
  brut.slice(0, MAX_OPPORTUNITES).forEach((o) => {
    if (!o || typeof o !== "object") return;
    let id = idPropre(o.id);
    if (!id || vus.has(id)) id = nouvelId("o");
    vus.add(id);
    const cote = (v) => (["1", "2", "3"].includes(String(v)) ? String(v) : "");
    propres.push({
      id, opportunite: texteCourt(o.opportunite, 500), benefice: texteCourt(o.benefice, 500),
      interet: cote(o.interet), faisabilite: cote(o.faisabilite),
    });
  });
  return propres;
}

function nettoyerControle(brut) {
  const c = brut && typeof brut === "object" ? brut : {};
  return {
    actif: c.actif === true, nature: NATURES_CONTROLE.includes(c.nature) ? c.nature : "",
    critere: texteCourt(c.critere, 1000), enregistrement: texteCourt(c.enregistrement, 300),
  };
}

// Les destinations (« vers ») sont contrôlées après coup, quand on connaît toutes les instructions (voir nettoyer).
function nettoyerAlternatives(brut) {
  if (!Array.isArray(brut)) return [];
  const vus = new Set();
  const propres = [];
  brut.slice(0, MAX_ALTERNATIVES).forEach((a) => {
    if (!a || typeof a !== "object") return;
    let id = idPropre(a.id);
    if (!id || vus.has(id)) id = nouvelId("a");
    vus.add(id);
    propres.push({
      id, condition: texteCourt(a.condition, 200), info: texteCourt(a.info, 500), versQui: texteCourt(a.versQui, 200),
      vers: typeof a.vers === "string" ? a.vers.slice(0, 30) : "",
    });
  });
  return propres;
}

function nettoyerContrainte(brut) {
  const c = brut && typeof brut === "object" ? brut : {};
  return { actif: c.actif === true, nature: NATURES_CONTRAINTE.includes(c.nature) ? c.nature : c.actif === true ? "delai" : "", texte: texteCourt(c.texte, 40) };
}

// Points d'alerte jugés « sans objet » : un objet { <cle>: bool } restreint aux clés attendues (comment/avec/contraintes).
function nettoyerSansObjet(brut, cles) {
  const s = brut && typeof brut === "object" ? brut : {};
  return Object.fromEntries(cles.map((k) => [k, s[k] === true]));
}

// R.A.C.I. : seuls les rôles qui existent, ni réalisateur ni participant, avec A, C ou I ; un seul A.
function nettoyerRaci(brut, idsRoles, roleId, participants) {
  const sortie = {};
  if (!brut || typeof brut !== "object" || Array.isArray(brut)) return sortie;
  let aDejaUnA = false;
  Object.keys(brut).slice(0, 40).forEach((id) => {
    const l = brut[id];
    if (!idsRoles.has(id) || id === roleId || participants.includes(id) || !LETTRES_RACI_AUTRES.includes(l)) return;
    if (l === "A") {
      if (aDejaUnA) return;
      aDejaUnA = true;
    }
    sortie[id] = l;
  });
  return sortie;
}

function nettoyerIndicateur(brut) {
  const i = brut && typeof brut === "object" ? brut : {};
  return { actif: i.actif === true, nom: texteCourt(i.nom, 200), formule: texteCourt(i.formule, 300), cible: texteCourt(i.cible, 120), frequence: texteCourt(i.frequence, 120) };
}

function nettoyerContrat(brut) {
  const c = brut && typeof brut === "object" ? brut : {};
  return { actif: c.actif === true, reference: texteCourt(c.reference, 80) };
}

function nettoyerSousProcedure(brut) {
  const c = brut && typeof brut === "object" ? brut : {};
  return { actif: c.actif === true, code: texteCourt(c.code, 60) };
}

function nettoyerMacro(brut) {
  const m = brut && typeof brut === "object" ? brut : {};
  const type = TYPES_MACRO.includes(m.type) ? m.type : "";
  const alternatives = Array.isArray(m.alternatives) ? m.alternatives.filter((a) => typeof a === "string").map((a) => texteCourt(a, 120)).slice(0, MAX_ALTERNATIVES_MACRO) : [];
  return { type, detail: texteCourt(m.detail, 200), alternatives };
}

function nettoyerRaccord(brut) {
  const r = brut && typeof brut === "object" ? brut : {};
  return { texte: texteCourt(r.texte, 200), role: texteCourt(r.role, 60), information: texteCourt(r.information, 200) };
}

function nettoyerNiveau3(brut) {
  const n = brut && typeof brut === "object" ? brut : {};
  return { actif: n.actif === true, code: texteCourt(n.code, 60), intitule: texteCourt(n.intitule, 300) };
}

// Instruction de travail : rôle, opérations, contrôles, correctives. Les identifiants sont uniques dans toute l'instruction ;
// un contrôle ne peut être lié qu'à une corrective de sa propre opération.
function nettoyerInstruction(brut) {
  const propre = nouvelleInstruction();
  if (!brut || typeof brut !== "object") return propre;
  const r = brut.role && typeof brut.role === "object" ? brut.role : {};
  propre.role = { nom: texteCourt(r.nom, 200) }; // (« competences » des fichiers v0.16 : abandonné en v0.17)
  const vus = new Set();
  const identifiant = (v, prefixe) => {
    let id = idPropre(v);
    if (!id || vus.has(id)) id = nouvelId(prefixe);
    vus.add(id);
    return id;
  };
  (Array.isArray(brut.operations) ? brut.operations : []).slice(0, MAX_OPERATIONS_SAISIE).forEach((o) => {
    if (!o || typeof o !== "object") return;
    const op = nouvelleOperation({
      id: identifiant(o.id, "p"), libelle: texteCourt(o.libelle, 300), entree: texteCourt(o.entree, 500), sortie: texteCourt(o.sortie, 500),
      commentaire: texteCourt(o.commentaire, 2000),
      vigilance: o.vigilance === true, enregistrement: o.enregistrement === true, contrainte: nettoyerContrainte(o.contrainte),
      sansObjet: nettoyerSansObjet(o.sansObjet, ["avec", "contraintes"]),
    });
    op.outils = nettoyerOutils(o.outils);
    const anciensIds = new Map(); // ancien identifiant -> identifiant propre, pour rétablir les liens contrôle -> corrective
    (Array.isArray(o.correctives) ? o.correctives : []).slice(0, MAX_CORRECTIVES).forEach((m) => {
      if (!m || typeof m !== "object") return;
      const id = identifiant(m.id, "m");
      if (!anciensIds.has(m.id)) anciensIds.set(m.id, id); // deux correctives de même identifiant : les liens vont à la première
      op.correctives.push(nouvelleCorrective({ id, libelle: texteCourt(m.libelle, 300), renvoi: texteCourt(m.renvoi, 200) }));
    });
    (Array.isArray(o.controles) ? o.controles : []).slice(0, MAX_CONTROLES).forEach((c) => {
      if (!c || typeof c !== "object") return;
      const liees = (Array.isArray(c.correctives) ? c.correctives : []).map((k) => anciensIds.get(k)).filter(Boolean);
      op.controles.push(nouveauControle({
        id: identifiant(c.id, "c"), question: texteCourt(c.question, 300), nature: NATURES_CONTROLE.includes(c.nature) ? c.nature : "",
        enregistrement: c.enregistrement === true, correctives: [...new Set(liees)],
      }));
    });
    propre.operations.push(op);
  });
  return propre;
}

export function nettoyer(brut) {
  if (!brut || typeof brut !== "object" || !Array.isArray(brut.roles) || !Array.isArray(brut.etapes)) {
    throw new Error("format");
  }
  const propre = nouvelleProcedure();
  const meta = brut.meta && typeof brut.meta === "object" ? brut.meta : {};
  ["organisation", "direction", "processus", "pilote", "titre", "reference", "version", "declencheur", "fin"].forEach((c) => {
    propre.meta[c] = texteCourt(meta[c]);
  });
  // « les_deux » (procédure + instructions) n'existe plus depuis la v0.16 : un ancien fichier est rouvert comme une procédure.
  propre.meta.typeDocument = meta.typeDocument === "les_deux" ? "procedure" : TYPES_DOCUMENT.includes(meta.typeDocument) ? meta.typeDocument : "";
  propre.meta.niveau = propre.meta.typeDocument === "instruction" ? 3 : 2; // niveau du langage : 2 = procédure, 3 = instruction de travail
  propre.meta.issueDe = texteCourt(meta.issueDe, 200);
  propre.meta.domaine = domaineValide(meta.domaine) ? meta.domaine : "";
  propre.meta.dateApplication = dateOuVide(meta.dateApplication);
  propre.meta.logo = logoValide(meta.logo);
  propre.meta.amont = nettoyerRaccord(meta.amont);
  propre.meta.aval = nettoyerRaccord(meta.aval);
  const sign = meta.signataires && typeof meta.signataires === "object" ? meta.signataires : {};
  SIGNATAIRES.forEach((k) => {
    const x = sign[k] && typeof sign[k] === "object" ? sign[k] : {};
    propre.meta.signataires[k] = { nom: texteCourt(x.nom, 200), fonction: texteCourt(x.fonction, 200), date: dateOuVide(x.date) };
  });
  const vusRev = new Set();
  (Array.isArray(meta.revisions) ? meta.revisions : []).slice(0, MAX_REVISIONS).forEach((r) => {
    if (!r || typeof r !== "object") return;
    let id = idPropre(r.id);
    if (!id || vusRev.has(id)) id = nouvelId("v");
    vusRev.add(id);
    propre.meta.revisions.push({ id, version: texteCourt(r.version, 40), date: dateOuVide(r.date), nature: texteCourt(r.nature, 300), auteur: texteCourt(r.auteur, 200) });
  });
  const vus = new Set();
  brut.roles.slice(0, 40).forEach((r) => {
    if (!r || typeof r !== "object") return;
    let id = idPropre(r.id);
    if (!id || vus.has(id)) id = nouvelId("r");
    vus.add(id);
    propre.roles.push({
      id, nom: texteCourt(r.nom, 200), type: TYPES_ROLE.includes(r.type) ? r.type : "individuel",
      service: texteCourt(r.service, 200), responsabilite: texteCourt(r.responsabilite, 1000),
    });
  });
  const idsRoles = new Set(propre.roles.map((r) => r.id));
  const idsEtapes = new Set();
  brut.etapes.slice(0, 100).forEach((e) => {
    if (!e || typeof e !== "object") return;
    let id = idPropre(e.id);
    if (!id || idsEtapes.has(id)) id = nouvelId("e");
    idsEtapes.add(id);
    propre.etapes.push(nouvelleEtape({
      id,
      roleId: idsRoles.has(e.roleId) ? e.roleId : "",
      libelle: texteCourt(e.libelle, 300),
      entree: texteCourt(e.entree),
      entreeDe: texteCourt(e.entreeDe),
      sortie: texteCourt(e.sortie),
      versQui: texteCourt(e.versQui),
      participants: Array.isArray(e.participants) ? e.participants.filter((p) => idsRoles.has(p) && p !== e.roleId).slice(0, 10) : [],
      outils: nettoyerOutils(e.outils),
      risques: nettoyerRisques(e.risques),
      opportunites: nettoyerOpportunites(e.opportunites),
      niveau3: nettoyerNiveau3(e.niveau3),
      controle: nettoyerControle(e.controle),
      condition: texteCourt(e.condition, 200),
      alternatives: nettoyerAlternatives(e.alternatives),
      operateurSortie: e.operateurSortie === "et" && !(e.controle && e.controle.actif === true) ? "et" : "ou",
      operateurEntree: OPERATEURS.includes(e.operateurEntree) ? e.operateurEntree : "",
      contrainte: nettoyerContrainte(e.contrainte),
      correctrice: e.correctrice === true,
      informes: Array.isArray(e.informes) ? e.informes.map((v) => texteCourt(v, 100)).filter(Boolean).slice(0, 10) : [],
      raci: nettoyerRaci(e.raci, idsRoles, e.roleId, Array.isArray(e.participants) ? e.participants : []),
      indicateur: nettoyerIndicateur(e.indicateur),
      contrat: nettoyerContrat(e.contrat),
      sousProcedure: nettoyerSousProcedure(e.sousProcedure),
      macro: nettoyerMacro(e.macro),
      sansObjet: nettoyerSansObjet(e.sansObjet, ["comment", "avec", "contraintes"]),
    }));
    // Une seule forme particulière par instruction : sous-procédure, puis macro-instruction, puis niveau 3.
    const dernier = propre.etapes[propre.etapes.length - 1];
    if (dernier.sousProcedure.actif) { dernier.macro.type = ""; dernier.niveau3.actif = false; }
    else if (dernier.macro.type) dernier.niveau3.actif = false;
  });
  // Destination d'une alternative : la fin, ou une AUTRE instruction qui existe ; sinon « à choisir ».
  propre.etapes.forEach((e) => {
    e.alternatives.forEach((a) => {
      if (a.vers !== "fin" && !(a.vers !== e.id && idsEtapes.has(a.vers))) a.vers = "";
    });
  });
  propre.it = nettoyerInstruction(brut.it);
  propre.corps = nettoyerCorps(brut.corps);
  propre.validation = texteCourt(brut.validation, 40);
  return propre;
}

// ---------- Démarrage : reprise du brouillon enregistré dans le navigateur ----------
// Doit rester la DERNIÈRE ligne du fichier (voir plus haut).
procedure = charger() ?? nouvelleProcedure();
try {
  if (!EN_LIGNE) {
    empreinteEnregistree = localStorage.getItem(CLE_ENREGISTRE) || "";
    instantModification = Number(localStorage.getItem(CLE_MODIFIE)) || 0;
  }
} catch (e) {
  // stockage indisponible : on part de « rien d'enregistré », sans date de modification.
}
