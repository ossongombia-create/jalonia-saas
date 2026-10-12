// document.js — la STRUCTURE du document final et l'estimation de sa longueur.
// Le document suit le « Modèle standard de procédure » : un en-tête (référence, version, domaine, processus,
// date d'application), le tableau « Validation du document », l'historique des révisions, puis 11 sections.
// Contrainte du projet : le document fait 4 à 5 pages A4 au maximum, logigramme compris ; la limite est vérifiée
// à chaque évolution.
//
// Chaque section contient une liste de « blocs » (paragraphe, sous-titre, tableau, logigramme). Les sections 5, 6 et 9
// sont construites à partir des rôles, des instructions et des risques maîtrisés.

import { SECTIONS, MODELES_TABLEAU, criticite, scoreOpportunite, LETTRES_RACI, lettreRaci, raciDuRole, raciUtilise, partiesDeLaFleche } from "./model.js";
import { t } from "./i18n.js";

export { SECTIONS };

export const PAGES_MAX = 5;
export const PAGES_CIBLE_MIN = 4;

// Blocs du document :
//   { type: "paragraphe", texte } | { type: "sous-titre", texte } | { type: "logigramme" }
//   { type: "tableau", colonnes, lignes, gabarit?, centrees?, gras1? }
// Dans un tableau, une cellule peut contenir plusieurs lignes (séparées par \n). « gras1 » : colonnes dont la première ligne est en gras.
const cellule = (texte) => (texte && String(texte).trim() ? String(texte).trim() : "-");
const lignesNonVides = (liste) => liste.map((x) => String(x || "").trim()).filter(Boolean);

// « 25/09/2026 » à partir de « 2026-09-25 » ; un autre texte est rendu tel quel.
export function formaterDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || "").trim());
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso || "").trim();
}

// « 6.1 Codification » : sous-titre d'une section (texte court commençant par un numéro à deux niveaux).
export const estSousTitre = (texte) => /^\d{1,2}\.\d{1,2}\s+\S/.test(texte) && texte.length <= 80;

const nomRoleDe = (procedure, id) => (procedure.roles.find((r) => r.id === id) || { nom: "" }).nom;

// ---------- Listes calculées à partir des instructions ----------
// Risques maîtrisés par les instructions : une entrée par risque renseigné, dans l'ordre du déroulé.
export function listeRisques(procedure) {
  const liste = [];
  procedure.etapes.forEach((e, i) => {
    e.risques.filter((r) => r.risque.trim() || r.mesure.trim()).forEach((r) => {
      liste.push({ n: i + 1, etape: e, risque: r, criticite: criticite(r), responsable: nomRoleDe(procedure, e.roleId) });
    });
  });
  return liste;
}

// Opportunités d'amélioration portées par les instructions (v0.28) : une entrée par opportunité renseignée.
export function listeOpportunites(procedure) {
  const liste = [];
  procedure.etapes.forEach((e, i) => {
    (e.opportunites || []).filter((o) => o.opportunite.trim()).forEach((o) => {
      liste.push({ n: i + 1, etape: e, opportunite: o, score: scoreOpportunite(o) });
    });
  });
  return liste;
}

// Indicateurs de performance (fanion du logigramme) : une entrée par instruction mesurée, dans l'ordre du déroulé.
export function listeIndicateurs(procedure) {
  return procedure.etapes
    .map((e, k) => ({ n: k + 1, etape: e }))
    .filter(({ etape }) => etape.indicateur && etape.indicateur.actif && (etape.indicateur.nom || "").trim())
    .map(({ n, etape }) => ({
      n, etape, nom: etape.indicateur.nom.trim(), formule: (etape.indicateur.formule || "").trim(),
      cible: (etape.indicateur.cible || "").trim(), frequence: (etape.indicateur.frequence || "").trim(),
      responsable: nomRoleDe(procedure, etape.roleId),
    }));
}

// Où mène une alternative : « retour à l'instruction 2 », « instruction 7 (Diffuser le document) » ou « fin de la procédure ».
function destination(procedure, alt, i) {
  if (alt.vers === "fin") return t("doc.suite.fin");
  const k = procedure.etapes.findIndex((x) => x.id === alt.vers);
  if (k < 0) return "";
  const libelle = procedure.etapes[k].libelle.trim();
  return t(k + 1 <= i ? "doc.suite.retour" : "doc.suite.vers", { n: k + 1, libelle });
}

// Suite d'une instruction qui décide : « Non conforme → retour à l'instruction 2 ; Réserves → … ».
function suiteAlternatives(procedure, etape, i) {
  return etape.alternatives
    .map((a) => `${a.condition.trim() || t("doc.cas")} → ${destination(procedure, a, i)}`.trim())
    .join(" ; ");
}

// Contrôles (triangle Q/H/S/R/E du logigramme) : une entrée par instruction de contrôle, dans l'ordre du déroulé.
export function listeControles(procedure) {
  return procedure.etapes
    .map((e, k) => ({ n: k + 1, etape: e }))
    .filter(({ etape }) => etape.controle && etape.controle.actif)
    .map(({ n, etape }) => ({
      n, etape, nature: etape.controle.nature, critere: etape.controle.critere.trim(),
      enregistrement: etape.controle.enregistrement.trim(), suite: suiteAlternatives(procedure, etape, n),
    }));
}

// Décisions : pour chaque instruction qui a des alternatives, une ligne par cas (suite normale d'abord).
export function listeDecisions(procedure) {
  const lignes = [];
  procedure.etapes.forEach((e, k) => {
    if (!e.alternatives.length) return;
    const n = k + 1;
    const suivante = k + 1 < procedure.etapes.length ? t("doc.suite.vers", { n: n + 1 }) : t("doc.suite.fin");
    lignes.push({ n, cas: e.condition.trim(), info: e.sortie.trim(), destination: suivante });
    e.alternatives.forEach((a) => lignes.push({ n, cas: a.condition.trim(), info: a.info.trim(), destination: destination(procedure, a, n) }));
  });
  return lignes;
}

// Instructions qui font l'objet d'une instruction de travail (niveau 3).
export function listeNiveau3(procedure) {
  return procedure.etapes
    .map((e, i) => ({ n: i + 1, etape: e }))
    .filter(({ etape }) => etape.niveau3.actif)
    .map(({ n, etape }) => ({
      n, code: etape.niveau3.code.trim(), intitule: (etape.niveau3.intitule.trim() || etape.libelle.trim()),
      role: nomRoleDe(procedure, etape.roleId), libelle: etape.libelle.trim(),
    }));
}

// ---------- Tableaux construits automatiquement (colonnes du modèle) ----------
// 5. Responsabilités : Acteur / Fonction | Responsabilité dans le processus
// Quand au moins une instruction porte un A, un C ou un I (liste R.A.C.I. de l'étape 2), quatre colonnes s'ajoutent : pour chaque
// rôle, les numéros des instructions où il est R (réalisateur), A (responsable final), C (consulté) ou I (informé).
function tableauResponsabilites(procedure) {
  const roles = procedure.roles.filter((r) => r.nom.trim());
  const avecRaci = raciUtilise(procedure);
  const acteur = (r) => lignesNonVides([r.nom, [r.service, r.type === "externe" ? t("doc.externe") : ""].filter((x) => x && x.trim()).join(", ")]).join("\n");
  if (!avecRaci) {
    return {
      type: "tableau", gabarit: GABARITS.responsabilites, gras1: [0],
      colonnes: ["acteur", "resp"].map((k) => t("col.responsabilites." + k)),
      lignes: roles.map((r) => [acteur(r), r.responsabilite || ""].map(cellule)),
    };
  }
  return {
    type: "tableau", gabarit: GABARITS.responsabilitesRaci, gras1: [0], centrees: [2, 3, 4, 5],
    colonnes: [t("col.responsabilites.acteur"), t("col.responsabilites.resp"), ...LETTRES_RACI],
    lignes: roles.map((r) => {
      const numeros = raciDuRole(procedure, r.id);
      return [acteur(r), r.responsabilite || "", ...LETTRES_RACI.map((l) => plagesDeNumeros(numeros[l]))].map(cellule);
    }),
  };
}

// « 1, 2, 3, 5, 6, 9 » devient « 1-3, 5-6, 9 » : les colonnes R, A, C, I restent étroites.
export function plagesDeNumeros(numeros) {
  const parties = [];
  for (let i = 0; i < numeros.length; ) {
    let j = i;
    while (j + 1 < numeros.length && numeros[j + 1] === numeros[j] + 1) j += 1;
    parties.push(j > i ? `${numeros[i]}-${numeros[j]}` : String(numeros[i]));
    i = j + 1;
  }
  return parties.join(", ");
}

// 8. Indicateurs de suivi : Indicateur | Mode de calcul | Cible | Fréquence (les trois dernières colonnes viennent de la fiche « indicateur » de l'instruction)
function tableauIndicateurs(procedure) {
  return {
    type: "tableau", gabarit: GABARITS.indicateurs, gras1: [0],
    colonnes: ["indicateur", "formule", "cible", "frequence"].map((k) => t("col.indicateurs." + k)),
    lignes: listeIndicateurs(procedure).map(({ n, nom, formule, cible, frequence }) => [
      lignesNonVides([nom, `${t("doc.instruction")} ${n}`]).join("\n"), formule, cible, frequence,
    ].map(cellule)),
  };
}

// 9. Risques associés : Risque associé | Mesure de maîtrise | Acteur responsable
function tableauRisques(procedure) {
  return {
    type: "tableau", gabarit: GABARITS.risques, gras1: [0],
    colonnes: ["risque", "mesure", "responsable"].map((k) => t("col.risques." + k)),
    lignes: listeRisques(procedure).map(({ n, risque, criticite: c, responsable }) => [
      lignesNonVides([
        risque.risque,
        `${t("doc.instruction")} ${n}${c ? ` · ${t("doc.criticite")} ${c.g} × ${c.p} = ${c.valeur} (${t("risque.niveau." + c.niveau)})` : ""}`,
      ]).join("\n"),
      risque.mesure, responsable,
    ].map(cellule)),
  };
}

// 9bis. Opportunités d'amélioration (v0.28) : Opportunité | Intérêt × faisabilité | Suite
function tableauOpportunites(procedure) {
  return {
    type: "tableau", gabarit: GABARITS.opportunites, gras1: [0],
    colonnes: ["opportunite", "cotation", "suite"].map((k) => t("col.opportunites." + k)),
    lignes: listeOpportunites(procedure).map(({ n, opportunite: o, score: s }) => [
      lignesNonVides([o.opportunite, `${t("doc.instruction")} ${n}`, o.benefice]).join("\n"),
      s ? `${s.i} × ${s.f} = ${s.valeur}` : "",
      s ? t("opportunite.suite." + s.suite) : "",
    ].map(cellule)),
  };
}

// Largeurs des colonnes du modèle (proportions ; les tableaux du modèle font 9200 twips de large).
export const GABARITS = {
  references: [2000, 2200, 5000],
  definitions: [2800, 6400],
  responsabilites: [3200, 6000],
  responsabilitesRaci: [2500, 3300, 850, 850, 850, 850],
  description: [700, 4200, 2200, 2100],
  indicateurs: [2400, 3800, 1700, 1300],
  risques: [3600, 3800, 1800],
  opportunites: [5000, 2200, 2000],
  enregistrements: [2800, 1700, 2700, 2000],
  entete: [2600, 4200, 2400],
  validation: [2300, 2300, 2300, 2300],
  historique: [1400, 1600, 4700, 1500],
};

// Transforme les blocs saisis d'une section en blocs de document (les blocs « genere » deviennent leur tableau).
function blocsSection(cle, procedure) {
  const saisis = (procedure.corps && procedure.corps[cle]) || [];
  const sortie = [];
  saisis.forEach((b) => {
    if (b.type === "p") {
      const texte = b.texte.trim();
      if (texte) sortie.push({ type: estSousTitre(texte) ? "sous-titre" : "paragraphe", texte });
    } else if (b.type === "tableau") {
      const modele = MODELES_TABLEAU[cle];
      sortie.push({
        type: "tableau", colonnes: b.colonnes, lignes: b.lignes,
        ...(modele && GABARITS[cle] && modele.length === b.colonnes.length ? { gabarit: GABARITS[cle] } : {}),
      });
    } else if (b.type === "genere" && cle === "responsabilites") {
      sortie.push(tableauResponsabilites(procedure));
      if (raciUtilise(procedure)) sortie.push({ type: "paragraphe", texte: t("doc.raci.legende") });
    }
    else if (b.type === "genere" && cle === "risques") {
      sortie.push(tableauRisques(procedure));
      if (listeOpportunites(procedure).length) {
        sortie.push({ type: "paragraphe", texte: t("doc.opportunites.sous_titre") });
        sortie.push(tableauOpportunites(procedure));
      }
    }
    else if (b.type === "genere" && cle === "indicateurs") sortie.push(tableauIndicateurs(procedure));
    else if (b.type === "genere" && cle === "description") {
      const raccord = (r, cle) => (r && r.texte.trim() ? { type: "paragraphe", texte: `${t(cle)} : ${r.texte.trim()}${r.role.trim() ? ` (${r.role.trim()})` : ""}${(r.information || "").trim() ? ` — ${t("doc.raccord.information")} : ${r.information.trim()}` : ""}` } : null);
      const amont = raccord(procedure.meta.amont, "doc.amont");
      if (amont) sortie.push(amont);
      if (procedure.meta.declencheur.trim()) sortie.push({ type: "paragraphe", texte: `${t("doc.declencheur")} : ${procedure.meta.declencheur.trim()}` });
      // v1.2 : le tableau « Description des activités » est retiré (doublon avec le logigramme, section 7). On garde le cadrage :
      // fait déclencheur, fait de fin, interfaces amont/aval ; le détail des tâches se lit sur le logigramme.
      if (procedure.meta.fin.trim()) sortie.push({ type: "paragraphe", texte: `${t("doc.fin")} : ${procedure.meta.fin.trim()}` });
      const aval = raccord(procedure.meta.aval, "doc.aval");
      if (aval) sortie.push(aval);
    }
  });
  if (cle === "logigramme" && procedure.etapes.length) sortie.push({ type: "logigramme" });
  // Un tableau généré vide n'a pas de raison d'apparaître.
  return sortie.filter((b) => b.type !== "tableau" || b.lignes.length > 0);
}

// ---------- En-tête, validation, historique ----------
function enTete(procedure) {
  const m = procedure.meta;
  const type = m.typeDocument === "instruction" ? "instruction" : "procedure";
  return {
    titre: m.titre,
    typeTitre: t("doc.type_titre." + type),
    reference: m.reference,
    version: m.version,
    organisation: m.organisation,
    logo: m.logo || "", // image PNG / JPEG (data URL), vide s'il n'y en a pas
    direction: m.direction,
    pilote: m.pilote,
    processus: m.processus,
    domaine: m.domaine ? t("domaine." + m.domaine) : "",
    dateApplication: formaterDate(m.dateApplication),
    pied: [[m.reference, m.version].filter((x) => x && x.trim()).join(" · "), m.titre].filter((x) => x && x.trim()).join(" — "),
  };
}

function tableauValidation(procedure) {
  const s = procedure.meta.signataires;
  const ligne = (cle, valeur) => [t("valid.ligne." + cle), ...["redige", "verifie", "approuve"].map((q) => valeur(s[q]))];
  return {
    type: "tableau", gabarit: GABARITS.validation, gras1: [], centrees: [1, 2, 3], premiereColonneEtiquette: true,
    colonnes: ["", t("valid.redige"), t("valid.verifie"), t("valid.approuve")],
    lignes: [
      ligne("nom", (x) => x.nom.trim()),
      ligne("fonction", (x) => x.fonction.trim()),
      ligne("date", (x) => formaterDate(x.date)),
      ligne("visa", () => ""),
    ],
  };
}

function tableauHistorique(procedure) {
  const m = procedure.meta;
  const saisies = m.revisions.filter((r) => [r.version, r.date, r.nature, r.auteur].some((x) => x && x.trim()));
  const lignes = saisies.length
    ? saisies.map((r) => [r.version, formaterDate(r.date), r.nature, r.auteur])
    : [[m.version, formaterDate(m.dateApplication), t("doc.creation_initiale"), m.signataires.redige.nom]];
  return {
    type: "tableau", gabarit: GABARITS.historique, gras1: [], centrees: [0, 1],
    colonnes: ["version", "date", "nature", "auteur"].map((k) => t("histo.col." + k)),
    lignes: lignes.map((l) => l.map((x) => String(x || "").trim())),
  };
}

// ---------- Construction ----------
export function construireDocument(procedure) {
  const doc = {
    cartouche: enTete(procedure),
    validation: tableauValidation(procedure),
    historique: tableauHistorique(procedure),
    sections: SECTIONS.map((cle) => ({ cle, blocs: blocsSection(cle, procedure) })),
    enTeteSeparee: true, // l'en-tête occupe sa propre page, comme dans le modèle, tant que le document tient dans la limite
  };
  // Trop long avec la page d'en-tête séparée : les sections suivent directement l'historique des révisions.
  if (mesurer(doc).pages > PAGES_MAX) doc.enTeteSeparee = false;
  return doc;
}

// ---------- Largeur des colonnes d'un tableau ----------
// Une seule règle pour le Word généré et pour l'estimation des pages. Résultat en twips (vingtièmes de point) ;
// la somme vaut toujours LARGEUR_TEXTE. Un tableau aux colonnes du modèle garde les proportions du modèle ; les autres
// reçoivent une largeur qui dépend de la racine de la longueur de leur texte le plus long.
export const LARGEUR_TEXTE = 9872; // A4 (11906) moins marges gauche 1134 et droite 900 : celles du modèle

const longueurMax = (texte) => Math.max(0, ...String(texte ?? "").split("\n").map((l) => l.length));

export function largeursColonnes(colonnes, lignes, gabarit) {
  if (gabarit && gabarit.length === colonnes.length) {
    const somme = gabarit.reduce((a, b) => a + b, 0);
    const largeurs = gabarit.map((g) => Math.round((g / somme) * LARGEUR_TEXTE));
    largeurs[largeurs.length - 1] += LARGEUR_TEXTE - largeurs.reduce((a, b) => a + b, 0);
    return largeurs;
  }
  const poids = colonnes.map((titre, j) => {
    const plusLong = Math.max(String(titre).length / 2, ...lignes.map((l) => longueurMax(l[j])));
    return Math.min(40, Math.max(5, Math.sqrt(plusLong) * 3));
  });
  const somme = poids.reduce((a, b) => a + b, 0);
  const largeurs = poids.map((p) => Math.max(520, Math.round((p / somme) * LARGEUR_TEXTE)));
  const ecart = largeurs.reduce((a, b) => a + b, 0) - LARGEUR_TEXTE;
  largeurs[largeurs.indexOf(Math.max(...largeurs))] -= ecart; // la plus large absorbe l'écart
  return largeurs;
}

// Colonnes centrées : celles que le bloc désigne, sinon (tableau saisi) les colonnes de valeurs courtes (cible, fréquence, code…).
export function colonnesCentrees(bloc) {
  if (bloc.centrees) return bloc.centrees;
  return bloc.colonnes.map((c, j) => j).filter((j) => {
    if (j === 0 && bloc.colonnes.length > 1) return false;
    const corps = bloc.lignes.map((l) => String(l[j] ?? "").trim());
    return corps.length > 0 && corps.some((x) => x) && Math.max(...corps.map((x) => x.length)) <= 16 && String(bloc.colonnes[j]).length <= 24;
  });
}

// ---------- Estimation des pages ----------
// On mesure en points (1 pt = 1/72 pouce) d'après la mise en page du Word généré (exportDocx.js) : A4, marges du modèle
// (zone utile 752 pt de haut, 493,6 pt de large), texte Calibri 10,5 pt, tableaux 9 pt. Réglage vérifié avec LibreOffice
// sur la procédure d'exemple (PR-VEN-01) : l'estimation doit être égale ou légèrement supérieure, jamais très inférieure.
export const PAGE_PT = 752;
const LARGEUR_PT = LARGEUR_TEXTE / 20;
// Réglages de mise en page communs au Word (exportDocx.js) et à l'estimation, en vingtièmes de point (twips).
// Ils reprennent le modèle en le resserrant un peu : c'est ce qui permet de tenir en 5 pages.
export const MISE_EN_PAGE = { interligne: 276, apresParagraphe: 120, titre1Avant: 280, titre1Apres: 120, titre2Avant: 200, titre2Apres: 80, margeCellule: 50, apresTableau: 200 };
const CAR_TEXTE_PT = 5.1; // largeur moyenne d'un caractère en Calibri 10,5
const LIGNE_TEXTE_PT = 12.8 * (MISE_EN_PAGE.interligne / 240); // ligne Calibri 10,5 pt x interligne
const APRES_PARAGRAPHE_PT = MISE_EN_PAGE.apresParagraphe / 20;
const TITRE1_PT = (MISE_EN_PAGE.titre1Avant + MISE_EN_PAGE.titre1Apres) / 20 + 17; // + une ligne de 14 pt
const SOUS_TITRE_PT = (MISE_EN_PAGE.titre2Avant + MISE_EN_PAGE.titre2Apres) / 20 + 13.4; // + une ligne de 11 pt
const SECTION_VIDE_PT = 20;
const CAR_TABLEAU_PT = 4.4; // largeur moyenne d'un caractère en Calibri 9
const LIGNE_TABLEAU_PT = 11;
const MARGES_LIGNE_TABLEAU_PT = MISE_EN_PAGE.margeCellule / 10; // haut + bas
const ESPACE_APRES_TABLEAU_PT = MISE_EN_PAGE.apresTableau / 20;
const MARGE_CELLULE_TWIPS = 220; // 2 x 110 (gauche et droite)

// Un tableau : chaque ligne occupe autant de lignes que sa cellule la plus longue, dans SA colonne.
export function hauteurTableau(bloc) {
  const largeurs = largeursColonnes(bloc.colonnes, bloc.lignes, bloc.gabarit);
  const hauteurLigne = (cellules) => {
    const nb = Math.max(1, ...cellules.map((c, j) => {
      const capacite = Math.max(3, Math.floor(((largeurs[j] - MARGE_CELLULE_TWIPS) / 20) / CAR_TABLEAU_PT));
      return String(c ?? "").split("\n").reduce((somme, l) => somme + Math.max(1, Math.ceil(l.length / capacite)), 0);
    }));
    return nb * LIGNE_TABLEAU_PT + MARGES_LIGNE_TABLEAU_PT;
  };
  return bloc.lignes.reduce((somme, l) => somme + hauteurLigne(l), hauteurLigne(bloc.colonnes)) + ESPACE_APRES_TABLEAU_PT;
}

function hauteurParagraphe(texte) {
  const capacite = Math.floor(LARGEUR_PT / CAR_TEXTE_PT);
  return Math.max(1, Math.ceil(texte.length / capacite)) * LIGNE_TEXTE_PT + APRES_PARAGRAPHE_PT;
}

function hauteurBloc(bloc) {
  if (bloc.type === "paragraphe") return hauteurParagraphe(bloc.texte);
  if (bloc.type === "sous-titre") return SOUS_TITRE_PT;
  if (bloc.type === "tableau") return hauteurTableau(bloc);
  return 0;
}

const hauteurSection = (section) =>
  TITRE1_PT + (section.blocs.length === 0 ? SECTION_VIDE_PT : section.blocs.reduce((somme, b) => somme + hauteurBloc(b), 0));

// En-tête : tableau d'identification (3 lignes), « Validation du document », « Historique des révisions ».
function hauteurEnTete(doc) {
  const c = doc.cartouche;
  const identite = hauteurTableau({
    colonnes: [c.organisation, `${c.typeTitre} ${c.titre}`, `${c.reference}\n${c.version}\nPage`], gabarit: GABARITS.entete,
    lignes: [[c.domaine, c.processus, c.dateApplication]],
  }) + 18 + (c.logo ? 6 : 0); // le logo (40 px de haut au plus) agrandit un peu la première ligne
  return identite + 2 * SOUS_TITRE_PT + hauteurTableau(doc.validation) + hauteurTableau(doc.historique);
}

// Découpe le document : pages avant le logigramme, page du logigramme, pages après.
export function mesurer(doc) {
  const iLog = doc.sections.findIndex((s) => s.blocs.some((b) => b.type === "logigramme"));
  const avant = iLog < 0 ? doc.sections : doc.sections.slice(0, iLog);
  const apres = iLog < 0 ? [] : doc.sections.slice(iLog + 1);
  const enTete = hauteurEnTete(doc);
  const corpsAvant = avant.reduce((somme, s) => somme + hauteurSection(s), 0);
  const pagesAvant = doc.enTeteSeparee
    ? Math.ceil(enTete / PAGE_PT) + Math.ceil(corpsAvant / PAGE_PT)
    : Math.ceil((enTete + corpsAvant) / PAGE_PT);
  let pagesLogigramme = 0;
  if (iLog >= 0) {
    // Le logigramme (titre, introduction, image) occupe une page ; une introduction très longue en ajoute une.
    const intro = doc.sections[iLog].blocs.filter((b) => b.type !== "logigramme").reduce((somme, b) => somme + hauteurBloc(b), 0);
    pagesLogigramme = 1 + (intro > 120 ? Math.ceil((intro - 120) / PAGE_PT) : 0);
  }
  const corpsApres = apres.reduce((somme, s) => somme + hauteurSection(s), 0);
  const pagesApres = Math.ceil(corpsApres / PAGE_PT);
  return {
    avant: pagesAvant, logigramme: pagesLogigramme, apres: pagesApres, pages: Math.max(1, pagesAvant + pagesLogigramme + pagesApres),
    points: { enTete: Math.round(enTete), avant: Math.round(corpsAvant), apres: Math.round(corpsApres) }, // pour régler l'estimation
  };
}

export function estimerPages(doc) {
  return mesurer(doc).pages;
}

// Constats sur la longueur, au même format que rules.js.
export function verifierLongueur(doc) {
  const pages = estimerPages(doc);
  if (pages > PAGES_MAX) return [{ gravite: "erreur", cle: "regle.document.trop_long", params: { n: pages, max: PAGES_MAX } }];
  if (pages === PAGES_MAX) return [{ gravite: "alerte", cle: "regle.document.limite", params: { n: pages, max: PAGES_MAX } }];
  return [];
}
