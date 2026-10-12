// cartographie.js — la CARTOGRAPHIE DES PROCESSUS de l'organisation (niveau 1 du langage) : les données, leur nettoyage et les codes.
// Aucune interface ici : des fonctions simples, testables sans navigateur.
//
//   cartographie = {
//     organisation, titre, contexte, exigences, satisfaction,      textes de la cartographie (facultatifs)
//     processus: [{ id, code, nom, categorie }],                    code = PIL, ACH, VEN… ; categorie = management | realisation | support | verification
//     flux:      [{ id, de, vers, information, double }],           échange d'information entre deux « points » (voir POINTS)
//     documents: [{ id, code, titre }],                             registre (facultatif) des codes déjà attribués : PR-ACH-01…
//     nomenclature: { controle, procedure, instruction },           la façon dont l'organisation code ses documents (voir plus bas)
//   }
//
// Un « point » d'un échange est l'id d'un processus, ou l'un des mots : management, realisation, support, verification (un bloc entier),
// contexte, exigences, satisfaction (les parties intéressées à l'entrée et à la sortie).
//
// La cartographie est celle de CHAQUE organisation : rien ici n'est propre à une entreprise. L'exemple (exemple-carto.js) est celui d'une organisation fictive.
// Le champ « Processus » d'un document s'écrit « CODE Nom » (ex. « ACH Acheter et gérer les stocks »).

import { nouvelId } from "./model.js";

// Les blocs de la cartographie. « Vérification » a été ajouté en v0.27 (demande de Brice) pour que la cartographie suive la liste
// « Domaine » (model.js, DOMAINES) : management, réalisation, support, vérification. Le livre n'en montre que trois ; le quatrième est un ajout de l'organisation.
export const CATEGORIES = ["management", "realisation", "support", "verification"];
export const EXTREMITES = ["contexte", "exigences", "satisfaction"];
export const POINTS_FIXES = [...CATEGORIES, ...EXTREMITES];

// Nomenclature des codes de documents : TYPE-PROCESSUS-NN (ex. PR-ACH-01 = procédure du processus ACH, numéro 01). C'est une convention
// courante, pas une règle du langage : chaque organisation dit si elle l'utilise (« controle ») et quels types elle donne aux
// procédures et aux instructions de travail. Sans « controle », l'application ne juge pas la forme des codes.
export const NOMENCLATURE_PAR_DEFAUT = Object.freeze({ controle: false, procedure: "PR", instruction: "IT" });
export const FORMAT_TYPE_CODE = /^[A-Z]{1,3}$/;
export const FORMAT_CODE_PROCESSUS = /^[A-Z][A-Z0-9]{1,4}$/;
export const FORMAT_CODE = /^([A-Z]{1,3})-([A-Z][A-Z0-9]{1,4})-(\d{2,3})$/;
export const FORMAT_CODE_LIBRE = /^[A-Z0-9][A-Z0-9._/-]{0,19}$/; // un code du registre, quelle que soit la nomenclature de l'organisation

export const MAX_PROCESSUS = 40;
export const MAX_FLUX = 120;
export const MAX_DOCUMENTS = 500;

// Fiche d'identité d'un processus (niveau 1) : les parties que la cartographie ne peut pas déduire et que l'organisation saisit.
// Les fiches sont rangées par CODE de processus (le code survit à un import, contrairement à l'id, qui est régénéré).
export const FICHE_CHAMPS = ["finalite", "pilote", "ressources", "risques", "exigences"];
export const MAX_FICHE = 2000;

export function nouvelleCartographie() {
  return { organisation: "", titre: "", contexte: "", exigences: "", satisfaction: "", processus: [], flux: [], documents: [], nomenclature: { ...NOMENCLATURE_PAR_DEFAUT }, fiches: {} };
}

// Le type de code d'un document (« PR », « IT »…) d'après la nomenclature de l'organisation ; la valeur par défaut si elle est vide ou invalide.
export function codeTypeDuDocument(c, typeDocument) {
  const n = (c && c.nomenclature) || NOMENCLATURE_PAR_DEFAUT;
  const cle = typeDocument === "instruction" ? "instruction" : typeDocument === "procedure" ? "procedure" : null;
  if (!cle) return "";
  return FORMAT_TYPE_CODE.test(n[cle]) ? n[cle] : NOMENCLATURE_PAR_DEFAUT[cle];
}
export const nomenclatureActive = (c) => Boolean(c && c.nomenclature && c.nomenclature.controle);

export function estVide(c) {
  return !c || (c.processus.length === 0 && c.flux.length === 0 && c.documents.length === 0);
}

// ---------- Nettoyage (tout fichier ou tout PDF lu passe ici : jamais de confiance) ----------
function texte(v, max = 300) {
  if (typeof v !== "string") return "";
  // eslint-disable-next-line no-control-regex
  return v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}
const idPropre = (v) => (typeof v === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(v) ? v : "");

// Comme texte(), mais pour un champ de fiche saisi sur plusieurs lignes : on garde les sauts de ligne (une ressource par ligne…),
// on retire les autres caractères de contrôle, on réduit les espaces en trop, et on limite la longueur.
function texteLong(v, max = MAX_FICHE) {
  if (typeof v !== "string") return "";
  return v
    .replace(/\r\n?/g, "\n")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ") // tous les contrôles sauf le saut de ligne (\u000a)
    .split("\n").map((l) => l.replace(/[ \t]+/g, " ").trim()).join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

export function nettoyerNomenclature(brut, repli = NOMENCLATURE_PAR_DEFAUT) {
  const b = brut && typeof brut === "object" ? brut : {};
  const type = (v, defaut) => (typeof v === "string" && FORMAT_TYPE_CODE.test(v.trim().toUpperCase()) ? v.trim().toUpperCase() : defaut);
  return {
    controle: typeof b.controle === "boolean" ? b.controle : repli.controle === true,
    procedure: type(b.procedure, repli.procedure),
    instruction: type(b.instruction, repli.instruction),
  };
}

// « repli » : la nomenclature à garder quand le fichier ou le PDF lu n'en contient pas (importer une carte ne change pas la façon de coder).
export function nettoyerCartographie(brut, { nomenclature = NOMENCLATURE_PAR_DEFAUT } = {}) {
  const propre = nouvelleCartographie();
  propre.nomenclature = nettoyerNomenclature(brut && typeof brut === "object" ? brut.nomenclature : null, nomenclature);
  if (!brut || typeof brut !== "object") return propre;
  propre.organisation = texte(brut.organisation, 200);
  propre.titre = texte(brut.titre, 200);
  propre.contexte = texte(brut.contexte, 600);
  propre.exigences = texte(brut.exigences, 300);
  propre.satisfaction = texte(brut.satisfaction, 300);
  const idsVus = new Set();
  const codesVus = new Set();
  (Array.isArray(brut.processus) ? brut.processus : []).slice(0, MAX_PROCESSUS).forEach((p) => {
    if (!p || typeof p !== "object") return;
    const code = texte(p.code, 10).toUpperCase();
    if (!FORMAT_CODE_PROCESSUS.test(code) || codesVus.has(code)) return; // pas de code valide : le processus est inutilisable
    let id = idPropre(p.id);
    if (!id || idsVus.has(id) || POINTS_FIXES.includes(id)) id = nouvelId("q");
    idsVus.add(id);
    codesVus.add(code);
    propre.processus.push({ id, code, nom: texte(p.nom, 200), categorie: CATEGORIES.includes(p.categorie) ? p.categorie : "" });
  });
  const points = new Set([...idsVus, ...POINTS_FIXES]);
  const fluxVus = new Set();
  (Array.isArray(brut.flux) ? brut.flux : []).slice(0, MAX_FLUX).forEach((f) => {
    if (!f || typeof f !== "object" || !points.has(f.de) || !points.has(f.vers) || f.de === f.vers) return;
    let id = idPropre(f.id);
    if (!id || fluxVus.has(id)) id = nouvelId("f");
    fluxVus.add(id);
    propre.flux.push({ id, de: f.de, vers: f.vers, information: texte(f.information, 300), double: f.double === true });
  });
  const docsVus = new Set();
  (Array.isArray(brut.documents) ? brut.documents : []).slice(0, MAX_DOCUMENTS).forEach((d) => {
    if (!d || typeof d !== "object") return;
    const code = texte(d.code, 20).toUpperCase();
    if (!FORMAT_CODE_LIBRE.test(code) || docsVus.has(code)) return;
    docsVus.add(code);
    let id = idPropre(d.id);
    if (!id) id = nouvelId("d");
    propre.documents.push({ id, code, titre: texte(d.titre, 300) });
  });
  // Fiches d'identité : rangées par code ; on ne garde que celles d'un processus existant et on ne retient que les champs non vides.
  const fichesBrut = brut.fiches && typeof brut.fiches === "object" ? brut.fiches : {};
  codesVus.forEach((code) => {
    const f = fichesBrut[code];
    if (!f || typeof f !== "object") return;
    const fiche = {};
    let rempli = false;
    FICHE_CHAMPS.forEach((champ) => {
      const v = texteLong(f[champ]);
      if (v) { fiche[champ] = v; rempli = true; }
    });
    if (rempli) propre.fiches[code] = fiche;
  });
  return propre;
}

// Lit un fichier .json de cartographie ; lève une erreur si ce n'en est pas une.
export function depuisJSON(contenu, options) {
  const brut = JSON.parse(contenu);
  if (!brut || typeof brut !== "object" || brut.type !== "cartographie" || !Array.isArray(brut.processus)) throw new Error("format");
  return nettoyerCartographie(brut, options);
}

export function versJSON(c) {
  return JSON.stringify({ type: "cartographie", version: 1, ...c }, null, 2);
}

// ---------- Processus ----------
export const libelleProcessus = (p) => (p.nom ? `${p.code} ${p.nom}` : p.code);

// La fiche d'identité d'un processus (par code), ou un objet vide si rien n'a été saisi.
export function ficheProcessus(c, code) {
  const cle = String(code || "").trim().toUpperCase();
  return (c && c.fiches && typeof c.fiches === "object" && c.fiches[cle]) || {};
}

export function processusParCode(c, code) {
  const voulu = String(code || "").trim().toUpperCase();
  return (c && c.processus.find((p) => p.code === voulu)) || null;
}

// Le processus désigné par le champ « Processus » d'un document : « ACH Acheter… » ou juste « ACH » (comparaison sans tenir compte des majuscules).
export function processusDuTexte(c, texteSaisi) {
  if (!c || typeof texteSaisi !== "string") return null;
  const s = texteSaisi.trim().toLowerCase();
  if (!s) return null;
  return c.processus.find((p) => libelleProcessus(p).toLowerCase() === s || p.code.toLowerCase() === s) || null;
}

// Un code de document découpé : { type, processus, numero } ou null s'il ne suit pas TYPE-PROCESSUS-NN (nomenclature « contrôlée »).
export function analyserCode(code) {
  const m = FORMAT_CODE.exec(String(code || "").trim().toUpperCase());
  return m ? { type: m[1], processus: m[2], numero: Number(m[3]) } : null;
}

// Le prochain code libre pour un type et un processus : PR-ACH-01, puis 02… d'après le registre. Le code définitif reste
// attribué par la personne responsable chez l'organisation (souvent le responsable qualité) : c'est une proposition.
export function prochainCode(c, type, codeProcessus, { exclure = "" } = {}) {
  const t = String(type || "").toUpperCase();
  const p = String(codeProcessus || "").toUpperCase();
  const pris = new Set();
  ((c && c.documents) || []).forEach((d) => {
    const a = analyserCode(d.code);
    if (a && a.type === t && a.processus === p && d.code !== exclure) pris.add(a.numero);
  });
  let n = 1;
  while (pris.has(n)) n += 1;
  return `${t}-${p}-${String(n).padStart(2, "0")}`;
}

export function documentParCode(c, code) {
  const voulu = String(code || "").trim().toUpperCase();
  return (c && c.documents.find((d) => d.code === voulu)) || null;
}

// ---------- Échanges ----------
// Les échanges qui arrivent au processus et ceux qui en partent. Un échange d'un bloc (ex. « Management → Réalisation ») concerne
// tous les processus du bloc. Chaque élément : { information, double, point } où « point » est l'autre extrémité : { genre, cle | processus }.
function decrirePoint(c, id) {
  const p = c.processus.find((x) => x.id === id);
  if (p) return { genre: "processus", processus: p };
  return { genre: CATEGORIES.includes(id) ? "categorie" : "extremite", cle: id };
}

export function fluxDuProcessus(c, idProcessus) {
  const res = { entrants: [], sortants: [] };
  const p = c && c.processus.find((x) => x.id === idProcessus);
  if (!p) return res;
  const concerne = (point) => point === p.id || (p.categorie && point === p.categorie);
  c.flux.forEach((f) => {
    if (!f.information) return;
    const versMoi = concerne(f.vers);
    const deMoi = concerne(f.de);
    if (versMoi === deMoi) return; // ni l'un ni l'autre, ou échange à l'intérieur du bloc : ni entrée ni sortie
    const autre = decrirePoint(c, versMoi ? f.de : f.vers);
    const element = { id: f.id, information: f.information, double: f.double, point: autre };
    if (versMoi || f.double) res.entrants.push(element);
    if (deMoi || f.double) res.sortants.push(element);
  });
  return res;
}

// Ordre d'affichage : management, réalisation, support, vérification, puis les processus sans catégorie.
export function processusParCategorie(c) {
  const groupes = CATEGORIES.map((k) => ({ categorie: k, processus: c.processus.filter((p) => p.categorie === k) }));
  const sans = c.processus.filter((p) => !p.categorie);
  if (sans.length) groupes.push({ categorie: "", processus: sans });
  return groupes.filter((g) => g.processus.length);
}

export function resumer(c) {
  return { processus: c.processus.length, flux: c.flux.length, documents: c.documents.length };
}
