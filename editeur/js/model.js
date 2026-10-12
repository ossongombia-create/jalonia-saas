// model.js — le MODÈLE DE DONNÉES : comment une procédure est représentée en mémoire.
// Une procédure est un simple objet JavaScript (donc facile à sauvegarder en .json).
//
//   procedure = { meta: {...}, roles: [...], etapes: [...] }
//
// Les rôles et les étapes ont un identifiant ("id") : on s'y réfère par cet id, jamais par le nom,
// pour que renommer un rôle ne casse rien.

// Identifiant court et aléatoire (ex. "e4k9x2"). Aléatoire pour ne jamais entrer en collision
// avec ceux d'une procédure rechargée depuis un fichier.
export function nouvelId(prefixe = "x") {
  return prefixe + Math.random().toString(36).slice(2, 8);
}

// Les 11 sections du corps du document (modèle standard de procédure, v0.11).
// (Avant la v0.11 : 13 sections, avec « Points de contrôle » et « Annexes » ; leur contenu est repris à l'ouverture d'un ancien fichier.)
export const SECTIONS = [
  "objet", "domaine", "references", "definitions", "responsabilites", "description",
  "logigramme", "indicateurs", "risques", "enregistrements", "diffusion",
];

// Domaines proposés dans l'en-tête du modèle : les BLOCS de la cartographie des processus (management, réalisation, support, vérification).
// « Vérification » est d'abord entré dans cette liste (v0.25), puis la cartographie a reçu le même 4e bloc (v0.27) : les deux listes coïncident.
// L'intitulé vient de i18n : domaine.<clé>.
// Les anciens domaines (v0.11 à v0.19) restent lisibles : un fichier qui en porte un le garde (sa signature de validation ne change
// pas), mais on ne les propose plus.
export const DOMAINES = ["management", "realisation", "support", "verification"];
export const DOMAINES_ANCIENS = ["exploitation", "maintenance", "depot", "hse"];
export const domaineValide = (v) => DOMAINES.includes(v) || DOMAINES_ANCIENS.includes(v);

// Les trois signataires du tableau « Validation du document ».
export const SIGNATAIRES = ["redige", "verifie", "approuve"];
export const MAX_REVISIONS = 10;

// Tableaux standard proposés par section (clés des colonnes ; les titres viennent de i18n : col.<section>.<clé>).
export const MODELES_TABLEAU = {
  references: ["type", "reference", "intitule"],
  definitions: ["terme", "definition"],
  indicateurs: ["indicateur", "formule", "cible", "frequence"],
  risques: ["risque", "mesure", "responsable"],
  enregistrements: ["nom", "support", "duree", "lieu"],
};

// Type de document à rédiger : une procédure (niveau 2, « Qui fait quoi ? ») ou une instruction de travail (niveau 3, « Comment ? »).
// Depuis la v0.16, une instruction de travail est un document à part (fichier séparé) : l'ancien type « les_deux » (procédure +
// instructions) n'existe plus ; un ancien fichier qui l'avait est rouvert comme une procédure (voir store.nettoyer).
export const TYPES_DOCUMENT = ["procedure", "instruction"];

// Limites (protègent contre un document démesuré et gardent le document dans 4 à 5 pages).
export const MAX_RISQUES = 5; // risques maîtrisés par une même instruction
export const MAX_OPPORTUNITES = 5; // opportunités d'amélioration portées par une même instruction (v0.28)
export const MAX_BLOCS = 30;
export const MAX_LIGNES = 60;
export const MAX_COLONNES = 8;

// Le CORPS du document : pour chaque section, une liste de blocs.
//   { id, type: "p", texte }                         un paragraphe
//   { id, type: "tableau", colonnes: [...], lignes: [[...]] }   un tableau
//   { id, type: "genere" }                           (sections 5, 6, 8 et 9) tableau construit automatiquement
//                                                    à partir des rôles / des instructions / des indicateurs / des risques maîtrisés
export function nouveauBloc(type, colonnes = []) {
  if (type === "tableau") return { id: nouvelId("b"), type, colonnes: [...colonnes], lignes: [colonnes.map(() => "")] };
  return { id: nouvelId("b"), type: "p", texte: "" };
}

export function nouveauCorps() {
  const corps = {};
  SECTIONS.forEach((cle) => { corps[cle] = []; });
  corps.responsabilites.push({ id: nouvelId("b"), type: "genere" });
  corps.description.push({ id: nouvelId("b"), type: "genere" });
  corps.indicateurs.push({ id: nouvelId("b"), type: "genere" }); // v0.19 : les indicateurs de performance des instructions (fanion)
  corps.risques.push({ id: nouvelId("b"), type: "genere" });
  return corps;
}

export function nouveauxSignataires() {
  const s = {};
  SIGNATAIRES.forEach((k) => { s[k] = { nom: "", fonction: "", date: "" }; });
  return s;
}

export function nouvelleRevision(champs = {}) {
  return { id: nouvelId("v"), version: "", date: "", nature: "", auteur: "", ...champs };
}

export function nouvelleProcedure() {
  return {
    meta: {
      organisation: "", direction: "", processus: "", pilote: "", // étape 1 : identification (fiche de collecte)
      titre: "", reference: "", version: "", typeDocument: "",
      domaine: "", dateApplication: "", // en-tête du modèle : domaine (voir DOMAINES) et date d'application (AAAA-MM-JJ)
      signataires: nouveauxSignataires(), // tableau « Validation du document » : rédigé / vérifié / approuvé par
      revisions: [], // historique des révisions : { id, version, date, nature, auteur }
      logo: "", // logo de l'organisation : image PNG ou JPEG en base64 ("data:image/png;base64,…"), "" = aucun
      niveau: 2, declencheur: "", fin: "",
      // Actions hors périmètre (livre §6.5.12-13 et §7.5.9-10) : « amont » = ce qui précède et déclenche le document (texte sur une barre,
      // au-dessus du Début), « aval » = la suite donnée après lui (sous la Fin). « role » = rôle de provenance ou de destination (petit
      // ovale gris) ; « information » (v0.17) = ce que la flèche transmet (panier d'information), facultatif.
      amont: { texte: "", role: "", information: "" }, aval: { texte: "", role: "", information: "" },
      issueDe: "", // instruction de travail créée depuis une procédure : « PR-ACH-01 — instruction 3 » (affiché dans l'en-tête)
    },
    roles: [],
    etapes: [],
    it: nouvelleInstruction(), // contenu d'une instruction de travail (niveau 3) : n'est utilisé que si typeDocument = « instruction »
    corps: nouveauCorps(),
    validation: "", // empreinte du contenu au moment de la validation de la synthèse (étape 3) ; "" = non validée
  };
}

// Une étape (instruction). "participants" = ids des rôles qui réalisent l'instruction avec le
// responsable (roleId) : s'il y en a, l'instruction est COLLABORATIVE (livre p.113).
export function nouvelleEtape(champs = {}) {
  return {
    id: nouvelId("e"),
    roleId: "",
    libelle: "",
    entree: "",
    entreeDe: "",
    sortie: "",
    versQui: "",
    participants: [], // ids de rôles (instruction collaborative)
    // R.A.C.I. : « roleId » est le réalisateur principal (R) et « participants » les autres réalisateurs (R) ; « raci » donne
    // la lettre des autres rôles : { idRole: "A" | "C" | "I" }. Un seul A par instruction.
    raci: {},
    informes: [], // noms libres (texte) d'informés qui ne sont pas des rôles de la procédure, affichés dans le tableau seulement
    outils: [], // outils utilisés : { id, type: "document" | "materiel", nom } (livre : reliés en pointillé)
    risques: [], // risques que l'instruction permet de maîtriser : alimentent la section 9 du document
    opportunites: [], // opportunités d'amélioration portées par l'instruction (v0.28) : intérêt × faisabilité ; section 9
    niveau3: { actif: false, code: "", intitule: "" }, // l'instruction fait l'objet d'une instruction de travail (zoom niveau 3)
    // Contrôle (triangle Q/H/S/R/E en haut à droite de l'instruction) : alimente la section 8 du document.
    controle: { actif: false, nature: "", critere: "", enregistrement: "" },
    // Décision (OU en sortie) : la suite normale est l'instruction suivante (« condition » la nomme) ;
    // les alternatives partent ailleurs : retour (boucle), saut en avant ou fin de la procédure.
    condition: "",
    alternatives: [], // { id, condition, info, versQui, vers } ; vers = "" (à choisir) | "fin" | id d'une instruction
    // Opérateur de sortie (cercle sur la sortie de l'instruction, quand elle a des alternatives) : « ou » = une seule des suites
    // (décision), « et » = toutes les suites en même temps (tâches simultanées).
    operateurSortie: "ou",
    // Opérateur d'entrée (cercle sur l'arrivée) : quand plusieurs flèches arrivent sur l'instruction, « et » = il faut toutes
    // les informations, « ou » = l'une ou l'autre suffit. "" = aucun opérateur.
    operateurEntree: "",
    // Contrainte de délai ou de coût (cercle en haut à droite de l'instruction : sablier, €, ou + si non précisé) et son texte (« 48 h »).
    contrainte: { actif: false, nature: "", texte: "" },
    // Instruction correctrice (symbole « recyclage » en haut à droite) : elle répond à un contrôle.
    correctrice: false,
    // Indicateur de performance (fanion en haut à droite) : l'instruction est mesurée par un indicateur, décrit dans le document.
    // v0.19 : formule, cible et fréquence alimentent le tableau de la section 8 (« Indicateurs de suivi »).
    indicateur: { actif: false, nom: "", formule: "", cible: "", frequence: "" },
    // Indicateur d'interface (v0.19, livre §6.5.22) : la flèche d'information qui SORT de cette instruction est régie par un contrat entre
    // les deux parties (le rôle de l'instruction et celui de la suivante). Le symbole « contrat » est posé sur le panier de la flèche ;
    // « reference » = code ou titre du contrat (la fiche du contrat, avec ses clauses, est un document à part).
    contrat: { actif: false, reference: "" },
    // Sous-procédure (cadre gras « SOUS-PROCÉDURE ») : l'instruction renvoie à une autre procédure, dont on cite le code (PR-XXX-NN).
    sousProcedure: { actif: false, code: "" },
    // Macro-instruction : type "regroupement" (bord double : plusieurs étapes homogènes regroupées, détail en annexe) ou
    // "alternatives" (cadre gras titré par le verbe commun, un compartiment en pointillé par alternative exclusive). "" = instruction simple.
    macro: { type: "", detail: "", alternatives: [] },
    // Points d'alerte (Comment / Avec quoi / Sous contraintes) jugés « sans objet » pour CETTE instruction : ils ne sont plus
    // comptés comme manquants mais rangés dans un résumé discret du diagnostic. Seules les alertes sont concernées (jamais les erreurs).
    sansObjet: { comment: false, avec: false, contraintes: false },
    ...champs,
  };
}

// ---------- Instruction de travail (niveau 3) : chapitre 7 du livre ----------
// Un seul rôle, 5 à 10 opérations enchaînées de haut en bas ; chaque opération peut avoir des contrôles (plan d'auto-contrôle :
// libellé en question, nature Q/H/S/R/E) et des actions correctives (verbe à l'infinitif) ; les correctives d'une opération sont
// partagées par ses contrôles (« Revoir proposition » répond à trois contrôles de « Rédiger proposition », fig. 7.7).
// Le déclencheur, la fin, l'action amont et l'action aval sont ceux de « meta » (comme pour une procédure).
export const MAX_OPERATIONS_SAISIE = 20; // limite de saisie ; la règle du livre (10 au plus) est vérifiée par rules-it.js
export const MAX_CONTROLES = 4; // par opération
export const MAX_CORRECTIVES = 4; // par opération

export function nouvelleInstruction() {
  return { role: { nom: "" }, operations: [] };
}

export function nouvelleOperation(champs = {}) {
  return {
    id: nouvelId("p"),
    libelle: "",
    entree: "", // information reçue (flèche d'arrivée) : obligatoire pour la 1re opération
    sortie: "", // information produite (flèche de sortie) : obligatoire pour la dernière opération
    vigilance: false, // opération à risque ou qui demande une vigilance : elle doit avoir au moins un contrôle
    enregistrement: false, // l'opération produit un document d'enregistrement (petit carré noir en bas à gauche)
    contrainte: { actif: false, nature: "", texte: "" }, // délai ou coût (cercle « + »)
    outils: [], // { id, type: "document" | "materiel", nom } : reliés à l'opération par un trait en pointillé
    controles: [], // { id, question, nature, enregistrement, correctives: [ids de correctives de CETTE opération] }
    // Au niveau 3, « Comment ? » est toujours tenu : seules les alertes « Avec quoi ? » et « Sous contraintes ? » peuvent être jugées sans objet.
    sansObjet: { avec: false, contraintes: false },
    correctives: [], // { id, libelle, renvoi } : « renvoi » = autre instruction ou procédure si l'action ne règle pas tout le défaut
    ...champs,
  };
}

export function nouveauControle(champs = {}) {
  return { id: nouvelId("c"), question: "", nature: "", enregistrement: false, correctives: [], ...champs };
}

export function nouvelleCorrective(champs = {}) {
  return { id: nouvelId("m"), libelle: "", renvoi: "", ...champs };
}

// Vrai si le contenu « instruction de travail » a été commencé (sert à la signature du contenu : un fichier de procédure d'avant la
// v0.16 garde la même signature, donc reste validé).
export function instructionUtilisee(it) {
  return !!it && (!!(it.role && it.role.nom) || (it.operations || []).length > 0);
}

// Raccourci « Créer l'instruction de travail » depuis une instruction de procédure marquée niveau 3 : renvoie une NOUVELLE procédure
// de type « instruction » préremplie (organisation, logo, direction, processus, auteur, domaine ; titre et code du niveau 3 ; rôle de
// l'instruction ; action amont et action aval = instructions voisines de la procédure). Ne modifie pas la procédure d'origine.
export function instructionDepuisEtape(procedure, etapeId) {
  const i = procedure.etapes.findIndex((e) => e.id === etapeId);
  if (i < 0) return null;
  const e = procedure.etapes[i];
  const m = procedure.meta;
  const nomRole = (id) => (procedure.roles.find((r) => r.id === id) || { nom: "" }).nom.trim();
  // Information transmise : ce que l'instruction précédente produit (amont) ou ce que l'instruction reçoit du dessus, à l'inverse pour l'aval.
  const voisine = (v, information) => (v ? { texte: v.libelle.trim(), role: nomRole(v.roleId), information: String(information || "").trim() } : { texte: "", role: "", information: "" });
  const p = nouvelleProcedure();
  p.meta = {
    ...p.meta,
    organisation: m.organisation, direction: m.direction, processus: m.processus, pilote: m.pilote, domaine: m.domaine, logo: m.logo,
    titre: (e.niveau3.intitule.trim() || e.libelle.trim()), reference: e.niveau3.code.trim(), typeDocument: "instruction", niveau: 3,
    issueDe: [m.reference, e.libelle].map((x) => String(x || "").trim()).filter(Boolean).join(" — "),
    amont: voisine(procedure.etapes[i - 1], procedure.etapes[i - 1] && procedure.etapes[i - 1].sortie), aval: voisine(procedure.etapes[i + 1], e.sortie),
  };
  p.it.role.nom = nomRole(e.roleId);
  return p;
}

// Les deux parties de la flèche de sortie de l'instruction i (indicateur d'interface, livre §6.5.22) : le rôle de l'instruction et celui de
// la suivante (ou celui de l'action aval, pour la dernière). « memeRole » = vrai si les deux sont le même rôle : un contrat lie deux
// parties différentes, la règle demande alors de vérifier.
export function partiesDeLaFleche(procedure, i) {
  const nom = (id) => ((procedure.roles.find((r) => r.id === id) || { nom: "" }).nom || "").trim();
  const e = procedure.etapes[i];
  if (!e) return { de: "", vers: "", memeRole: false };
  const suivante = procedure.etapes[i + 1];
  const de = nom(e.roleId);
  const vers = suivante ? nom(suivante.roleId) : ((procedure.meta.aval && procedure.meta.aval.role) || "").trim();
  return { de, vers, memeRole: !!de && de.toLowerCase() === vers.toLowerCase() };
}

// R.A.C.I. (matrice des responsabilités) : R réalisateur (effectue la tâche), A responsable final (décide, valide),
// C consulté (son avis est nécessaire), I informé (tenu au courant).
export const LETTRES_RACI = ["R", "A", "C", "I"];
export const LETTRES_RACI_AUTRES = ["A", "C", "I"];

// Lettre d'un rôle dans une instruction : "R", "A", "C", "I" ou "" (non concerné).
export function lettreRaci(etape, roleId) {
  if (!roleId) return "";
  if (etape.roleId === roleId || (etape.participants || []).includes(roleId)) return "R";
  const l = etape.raci && etape.raci[roleId];
  return LETTRES_RACI_AUTRES.includes(l) ? l : "";
}

// Numéros des instructions par lettre pour un rôle : { R: [1, 2], A: [], C: [3], I: [] } (numéros à partir de 1).
export function raciDuRole(procedure, roleId) {
  const sortie = { R: [], A: [], C: [], I: [] };
  procedure.etapes.forEach((e, i) => {
    const l = lettreRaci(e, roleId);
    if (l) sortie[l].push(i + 1);
  });
  return sortie;
}

// Vrai si au moins une instruction porte un A, un C ou un I : c'est alors seulement que le document ajoute les colonnes R.A.C.I.
export function raciUtilise(procedure) {
  return procedure.etapes.some((e) => Object.values(e.raci || {}).some((l) => LETTRES_RACI_AUTRES.includes(l)));
}

// Nature d'un contrôle : la lettre inscrite dans le triangle (livre : Q qualité, H hygiène, S sécurité, R réglementaire, E environnement).
export const NATURES_CONTROLE = ["Q", "H", "S", "R", "E"];
export const MAX_ALTERNATIVES = 3; // suites possibles en plus de la suite normale
export const OPERATEURS = ["ou", "et"];
export const NATURES_CONTRAINTE = ["delai", "cout", "autre"]; // nature notée dans le document ; le dessin montre toujours le « + » de la légende Qualigramme
export const TYPES_MACRO = ["regroupement", "alternatives"];
export const MAX_ALTERNATIVES_MACRO = 4; // compartiments d'une macro-instruction « alternatives »
export const LOGO_MAX_OCTETS = 300000; // logo : image PNG ou JPEG, une fois redimensionnée par le navigateur elle pèse bien moins

// Une alternative de suite : cas (condition), information transmise, rôle destinataire, destination.
export function nouvelleAlternative(champs = {}) {
  return { id: nouvelId("a"), condition: "", info: "", versQui: "", vers: "", ...champs };
}

// Un risque maîtrisé par une instruction. Impact et vraisemblance : 1 à 4 ; criticité = Impact × Vraisemblance.
// NB : les champs de données restent nommés `gravite` et `probabilite` (compatibilité des fichiers enregistrés et de la
// signature de validation) ; seuls les LIBELLÉS affichés changent (Impact / Vraisemblance), via i18n (v0.28).
export function nouveauRisque(champs = {}) {
  return { id: nouvelId("k"), risque: "", causes: "", gravite: "", probabilite: "", mesure: "", ...champs };
}

// Criticité = Impact (g) × Vraisemblance (p). Décision (v0.28, méthode de management des processus / ISO 9001 §6.1) :
//   critique si C ≥ 9 OU Impact = 4 (tout impact 4 déclenche une action, quelle que soit la vraisemblance) ;
//   significatif si 5 ≤ C ≤ 8 ; acceptable si C ≤ 4.
export function criticite(risque) {
  const g = Number(risque.gravite);
  const p = Number(risque.probabilite);
  // Cotation = entiers 1 à 4 uniquement (une valeur non entière, ex. importée d'un fichier modifié, n'est pas une cotation valide).
  if (!(Number.isInteger(g) && Number.isInteger(p) && g >= 1 && g <= 4 && p >= 1 && p <= 4)) return null;
  const valeur = g * p;
  const niveau = (g === 4 || valeur >= 9) ? "critique" : valeur >= 5 ? "significatif" : "acceptable";
  return { valeur, g, p, niveau };
}

// Une opportunité d'amélioration portée par une instruction (v0.28). Cotation : intérêt × faisabilité, 1 à 3 chacun.
// Impact « positif » (par opposition au risque) ; le score oriente la suite : ≥ 6 → plan d'amélioration, sinon à étudier.
export function nouvelleOpportunite(champs = {}) {
  return { id: nouvelId("o"), opportunite: "", benefice: "", interet: "", faisabilite: "", ...champs };
}
export function scoreOpportunite(opp) {
  const i = Number(opp.interet);
  const f = Number(opp.faisabilite);
  // Cotation = entiers 1 à 3 uniquement (cohérent avec criticite).
  if (!(Number.isInteger(i) && Number.isInteger(f) && i >= 1 && i <= 3 && f >= 1 && f <= 3)) return null;
  const valeur = i * f;
  return { valeur, i, f, suite: valeur >= 6 ? "plan" : "etudier" };
}

// Empreinte du contenu (identification, rôles, instructions, corps), indépendante de l'ordre des clés :
// sert à savoir si la synthèse validée a changé depuis. Rien de cryptographique : simple contrôle de changement.
function stable(v) {
  if (Array.isArray(v)) return "[" + v.map(stable).join(",") + "]";
  if (v && typeof v === "object") {
    return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + stable(v[k])).join(",") + "}";
  }
  return JSON.stringify(v);
}
export function signatureContenu(p) {
  // Les éléments ajoutés après une validation n'entrent dans la signature que s'ils sont renseignés : « raci » (v0.13),
  // « indicateur », « sousProcedure », « macro », « amont », « aval » (v0.14). Un fichier validé avant reste validé.
  const vides = {
    raci: (v) => !v || Object.keys(v).length === 0,
    indicateur: (v) => !v || (!v.actif && !v.nom),
    contrat: (v) => !v || (!v.actif && !v.reference), // v0.19 : un fichier d'avant garde sa signature
    sousProcedure: (v) => !v || (!v.actif && !v.code),
    macro: (v) => !v || (!v.type && !v.detail && !(v.alternatives || []).length),
    opportunites: (v) => !v || v.length === 0, // v0.28 : pas d'opportunité = champ absent de la signature (fichier validé avant reste validé)
  };
  // v0.19 : formule, cible et fréquence de l'indicateur n'entrent dans la signature que si elles sont renseignées.
  const sansChampsIndicateurVides = (k, v) => (k === "indicateur" && v ? Object.fromEntries(Object.entries(v).filter(([c, x]) => !(["formule", "cible", "frequence"].includes(c) && !x))) : v);
  const etapes = p.etapes.map((e) => Object.fromEntries(Object.entries(e).filter(([k, v]) => !(vides[k] && vides[k](v))).map(([k, v]) => [k, sansChampsIndicateurVides(k, v)])));
  // v0.19 : le tableau généré de la section 8 (recalculé à partir des instructions) n'entre pas dans la signature ; un fichier validé avant reste validé.
  const corps = p.corps && Array.isArray(p.corps.indicateurs) ? { ...p.corps, indicateurs: p.corps.indicateurs.filter((b) => b.type !== "genere") } : p.corps;
  // v0.17 : « information » (panier de la flèche amont / aval) n'entre dans la signature que s'il est renseigné.
  const sansInfoVide = (k, v) => ((k === "amont" || k === "aval") && v && !v.information ? Object.fromEntries(Object.entries(v).filter(([c]) => c !== "information")) : v);
  const meta = Object.fromEntries(Object.entries(p.meta).filter(([k, v]) => !((k === "amont" || k === "aval") && (!v || (!v.texte && !v.role && !v.information))) && !(k === "issueDe" && !v)).map(([k, v]) => [k, sansInfoVide(k, v)]));
  // L'instruction de travail (v0.16) n'entre dans la signature que si elle est commencée.
  // v0.17 : le champ « compétences requises » a été retiré du rôle ; la signature garde son ancienne forme (competences: "") pour qu'un
  // fichier d'instruction validé en v0.16 reste validé.
  const itSigne = instructionUtilisee(p.it) ? { it: { ...p.it, role: { ...p.it.role, competences: "" } } } : {};
  const texte = stable({ meta, roles: p.roles, etapes, corps, ...itSigne });
  let h1 = 5381;
  let h2 = 52711;
  for (let i = 0; i < texte.length; i += 1) {
    const c = texte.charCodeAt(i);
    h1 = ((h1 * 33) ^ c) >>> 0;
    h2 = ((h2 * 31) + c) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0") + "-" + texte.length;
}

// ---------- v0.22 : « enregistré ou non » ----------
// Empreinte de TOUT le document (contrairement à signatureContenu, qui ne sert qu'à la validation et ne doit pas changer) : elle sert à savoir
// si le document a changé depuis le dernier enregistrement en fichier .json. Deux documents identiques donnent la même empreinte, quel que soit
// l'ordre des champs.
export function empreinteDocument(p) {
  const texte = stable(p);
  let h1 = 5381;
  let h2 = 52711;
  for (let i = 0; i < texte.length; i += 1) {
    const c = texte.charCodeAt(i);
    h1 = ((h1 * 33) ^ c) >>> 0;
    h2 = ((h2 * 31) + c) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0") + "-" + texte.length;
}

// Un document « vide » : rien n'a été saisi (le choix du type de document, procédure ou instruction, ne compte pas ; les identifiants sont tirés au sort à la création).
const sansIdentifiants = (texte) => texte.replace(/"id":"[^"]*"/g, '"id":""');
const normaliserPourVide = (p) => sansIdentifiants(stable({ ...p, meta: { ...p.meta, typeDocument: "", niveau: 2 } }));
let videNormalise = null; // le document vierge, calculé une seule fois
export function estDocumentVide(p) {
  if (!p || typeof p !== "object" || !p.meta) return true;
  try {
    if (videNormalise === null) videNormalise = normaliserPourVide(nouvelleProcedure());
    return normaliserPourVide(p) === videNormalise;
  } catch (e) {
    return false;
  }
}

// Types d'outils Qualigramme : document (rectangle à base ondulée : formulaire, enregistrement,
// logiciel) ou matériel (triangle : équipement).
export const TYPES_OUTIL = ["document", "materiel"];

// Petit exemple de secours, gardé pour les tests (contient une instruction collaborative et un rôle externe).
// L'exemple montré à l'utilisateur est exempleProcedure() (exemple-procedure.js).
export function exempleValiderCommande() {
  const p = nouvelleProcedure();
  const client = { id: "r-client", nom: "Client", type: "externe" };
  const assistante = { id: "r-assist", nom: "Assistante administrative", type: "individuel" };
  const comptable = { id: "r-compta", nom: "Comptable", type: "individuel" };
  p.roles = [assistante, comptable, client];
  p.meta = {
    ...p.meta,
    titre: "Valider la commande", reference: "PR-22-01", version: "4.0", niveau: 2,
    declencheur: "Demande client reçue par mail ou formulaire",
    fin: "Dossier classé",
  };
  const e = (champs) => nouvelleEtape(champs);
  p.etapes = [
    e({ roleId: assistante.id, libelle: "Réceptionner la commande client", entree: "Demande client", entreeDe: "Client", sortie: "Commande reçue", outils: [{ id: "o1", type: "document", nom: "FO-32-02" }, { id: "o2", type: "materiel", nom: "Scanner" }] }),
    e({ roleId: assistante.id, libelle: "Vérifier le besoin client", entree: "Commande reçue", sortie: "Besoin validé" }),
    e({ roleId: comptable.id, libelle: "Établir le devis", entree: "Besoin validé", sortie: "Devis", participants: [assistante.id], outils: [{ id: "o3", type: "document", nom: "Logiciel de gestion, module Vente" }] }),
    e({ roleId: comptable.id, libelle: "Enregistrer la commande", entree: "Bon de commande", sortie: "Commande enregistrée" }),
    e({ roleId: assistante.id, libelle: "Classer le dossier commande", entree: "Commande enregistrée", sortie: "Dossier classé", outils: [{ id: "o4", type: "document", nom: "EN-22-03" }] }),
  ];
  return p;
}
