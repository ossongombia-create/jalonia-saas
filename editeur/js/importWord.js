// importWord.js — IMPORT d'une procédure rédigée au format Word (.docx).
// Un .docx est une archive ZIP contenant du XML. Trois étapes, toutes testables sans navigateur :
//   1. lireZip()          : ouvre l'archive et en sort word/document.xml
//   2. extraireBlocs()    : transforme le XML en liste de paragraphes et de tableaux (texte seul)
//   3. interpreter()      : repère rôles, étapes, déclencheur, fin, outils d'après le modèle standard de procédure
//                           (11 sections ; les anciens Word à 13 sections restent lisibles) et produit une procédure
//                           + un rapport de ce qui a été lu.
// Un Word généré par l'application contient la procédure complète (embarque.js) : s'il n'a pas été modifié, on la reprend telle quelle.
// Le fichier est une donnée NON FIABLE : on ne lit que du texte, jamais de HTML ; la procédure obtenue
// passe ensuite par nettoyer() du store, comme un fichier .json importé.

import { nouvelleProcedure, nouvelleEtape, nouvelleAlternative, nouvelleRevision, nouvelId, SECTIONS, NATURES_CONTROLE, MAX_ALTERNATIVES, MAX_REVISIONS, domaineValide } from "./model.js";
import { deballer, texteVisible, empreinte } from "./embarque.js";

const TAILLE_MAX_XML = 15_000_000;

// ---------- 1. Lecture de l'archive ZIP ----------
async function decompresser(octets) {
  const flux = new Blob([octets]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const lecteur = flux.getReader();
  const morceaux = [];
  let total = 0;
  for (;;) {
    const { done, value } = await lecteur.read();
    if (done) break;
    total += value.length;
    if (total > TAILLE_MAX_XML) throw new Error("trop_gros"); // archive piégée (« zip bomb »)
    morceaux.push(value);
  }
  const sortie = new Uint8Array(total);
  let pos = 0;
  morceaux.forEach((m) => { sortie.set(m, pos); pos += m.length; });
  return sortie;
}

export async function lireZip(tampon, nomVoulu = "word/document.xml") {
  const octets = tampon instanceof Uint8Array ? tampon : new Uint8Array(tampon);
  const vue = new DataView(octets.buffer, octets.byteOffset, octets.byteLength);
  let fin = -1;
  for (let i = octets.length - 22; i >= Math.max(0, octets.length - 65_600); i -= 1) {
    if (vue.getUint32(i, true) === 0x06054b50) { fin = i; break; }
  }
  if (fin < 0) throw new Error("pas_zip");
  const nombre = vue.getUint16(fin + 10, true);
  let pos = vue.getUint32(fin + 16, true);
  for (let k = 0; k < nombre; k += 1) {
    if (pos + 46 > octets.length || vue.getUint32(pos, true) !== 0x02014b50) throw new Error("pas_zip");
    const methode = vue.getUint16(pos + 10, true);
    const taille = vue.getUint32(pos + 20, true);
    const tailleFinale = vue.getUint32(pos + 24, true);
    const lNom = vue.getUint16(pos + 28, true);
    const lExtra = vue.getUint16(pos + 30, true);
    const lCom = vue.getUint16(pos + 32, true);
    const decalage = vue.getUint32(pos + 42, true);
    const nom = new TextDecoder().decode(octets.subarray(pos + 46, pos + 46 + lNom));
    pos += 46 + lNom + lExtra + lCom;
    if (nom !== nomVoulu) continue;
    if (tailleFinale > TAILLE_MAX_XML) throw new Error("trop_gros");
    if (vue.getUint32(decalage, true) !== 0x04034b50) throw new Error("pas_zip");
    const debut = decalage + 30 + vue.getUint16(decalage + 26, true) + vue.getUint16(decalage + 28, true);
    const donnees = octets.subarray(debut, debut + taille);
    const brut = methode === 0 ? donnees : methode === 8 ? await decompresser(donnees) : null;
    if (!brut) throw new Error("pas_zip");
    return new TextDecoder("utf-8").decode(brut);
  }
  throw new Error("pas_word");
}

// ---------- 2. Du XML aux paragraphes et tableaux ----------
const ENTITES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function decoder(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
    }
    return ENTITES[e.toLowerCase()];
  });
}
const nettoyerEspaces = (s) => s.replace(/\s+/g, " ").trim();

// Renvoie une liste de blocs : { type: "p", style, texte } ou { type: "tableau", lignes: [[texte de cellule]] }.
export function extraireBlocs(xml) {
  const blocs = [];
  const tokens = /<(\/?)w:(tbl|tr|tc|p|tab|br|pStyle)(?=[\s>/])([^>]*)>|<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g;
  let profondeurTableau = 0;
  let tableau = null;
  let ligne = null;
  let cellule = null;
  let paragraphe = null;
  let m;
  while ((m = tokens.exec(xml))) {
    if (m[4] !== undefined) { if (paragraphe) paragraphe.texte += decoder(m[4]); continue; }
    const fermant = m[1] === "/";
    const nom = m[2];
    if (nom === "tab" || nom === "br") { if (paragraphe && !fermant) paragraphe.texte += " "; continue; }
    if (nom === "pStyle") { const v = /w:val="([^"]*)"/.exec(m[3]); if (paragraphe && v) paragraphe.style = v[1]; continue; }
    if (nom === "tbl") {
      if (!fermant) {
        profondeurTableau += 1;
        if (profondeurTableau === 1) tableau = { type: "tableau", lignes: [] };
      } else {
        profondeurTableau -= 1;
        if (profondeurTableau === 0 && tableau) { blocs.push(tableau); tableau = null; }
      }
    } else if (nom === "tr" && profondeurTableau === 1) {
      if (!fermant) ligne = []; else if (ligne && tableau) { tableau.lignes.push(ligne); ligne = null; }
    } else if (nom === "tc" && profondeurTableau === 1) {
      if (!fermant) cellule = []; else if (cellule && ligne) { ligne.push(cellule.join("\n")); cellule = null; }
    } else if (nom === "p") {
      if (!fermant) paragraphe = { type: "p", style: "", texte: "" };
      else if (paragraphe) {
        paragraphe.texte = nettoyerEspaces(paragraphe.texte);
        if (profondeurTableau > 0) { if (cellule && paragraphe.texte) cellule.push(paragraphe.texte); }
        else if (paragraphe.texte) blocs.push(paragraphe);
        paragraphe = null;
      }
    }
  }
  return blocs;
}

// ---------- 3. Interprétation d'après le modèle standard ----------
const STYLE_SOMMAIRE = /^(toc|tm|sommaire|tabledesmati)/i; // lignes du sommaire (Word : « TOC1 » ou « TM1 »)
const ADJECTIF_UNITE = /^(direction|service|d[ée]partement|[ée]quipe|comit[ée]|cellule|division|pole|pôle)\b/i;
const MOT_VIDE = /^[-–—\s]*$/;
const minuscule = (s) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

const majuscule = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function sentenceCase(s) {
  const lettres = s.replace(/[^A-Za-zÀ-ÿ]/g, "");
  if (lettres.length > 3 && lettres === lettres.toUpperCase()) return s.charAt(0) + s.slice(1).toLowerCase();
  return s;
}

// « Besoin exprimé (tout collaborateur) » -> ["Besoin exprimé", "tout collaborateur"].
// On ne sépare pas quand la parenthèse renvoie à des étapes (« (étapes 3, 5) »).
function separerParenthese(texte) {
  const m = /^(.*?)\s*\(([^()]+)\)\s*$/.exec(texte);
  if (!m || !m[1] || /^[ée]tapes?\s/i.test(m[2].trim())) return [texte, ""];
  return [m[1].trim(), m[2].trim()];
}

// Texte d'une cellule sur une seule ligne (les paragraphes d'une cellule sont recollés par un espace) ; « » si la colonne n'existe pas.
const plat = (c) => String(c || "").replace(/\s*\n\s*/g, " ").trim();
function colonne8(ligne, i) {
  return i >= 0 && ligne[i] ? plat(ligne[i]) : "";
}
const lignesDe = (c) => String(c || "").split("\n").map((x) => x.trim()).filter(Boolean);

function indexColonne(entete, ...mots) {
  return entete.findIndex((c) => mots.some((mot) => minuscule(c).includes(mot)));
}

// ---------- Décisions et contrôles (documents produits par cette application) ----------
// Destination d'une alternative écrite dans un tableau : « retour à l'instruction 2 », « instruction 7 » ou « fin de la procédure ».
function lireDestination(texte) {
  if (/fin de la proc[ée]dure|end of the procedure/i.test(texte)) return "fin";
  const m = /instruction\s+(\d+)/i.exec(texte);
  return m ? Number(m[1]) : null;
}

// Cellule « Sortie » d'une instruction qui décide : « Conforme : Document conforme ; Non conforme : Avis motivé (Rédacteur) → retour à l'instruction 2 ».
// Renvoie null si la cellule ne contient aucune flèche (sortie ordinaire).
function lireDecision(cellule) {
  const segments = cellule.split(/\s+;\s+/).map((x) => x.trim()).filter(Boolean);
  const alternatives = [];
  const autres = [];
  segments.forEach((seg) => {
    const m = /^(.*?)\s*:\s*(.*?)\s*→\s*(.+)$/.exec(seg) || /^()()(.*?)\s*→\s*(.+)$/.exec(seg);
    if (!m) { autres.push(seg); return; }
    const [info, versQui] = separerParenthese(m[2]);
    alternatives.push({ condition: m[1].trim(), info, versQui, cible: lireDestination(m[m.length - 1]) });
  });
  if (alternatives.length === 0) return null;
  let condition = "";
  let sortie = autres.join(" ; ");
  const c = autres.length ? /^(.{1,40}?)\s:\s(.*)$/.exec(autres[0]) : null;
  if (c) { condition = c[1].trim(); sortie = [c[2], ...autres.slice(1)].join(" ; "); }
  return { condition, sortie, alternatives };
}

// Nature d'un contrôle d'après la cellule « Nature » : « Q — Qualité », « S », « Sécurité »…
function lireNature(cellule) {
  const m = /^\s*([A-Za-z])\b/.exec(cellule || "");
  if (m && NATURES_CONTROLE.includes(m[1].toUpperCase())) return m[1].toUpperCase();
  const mot = minuscule(cellule || "");
  const parMot = [["qualit", "Q"], ["quality", "Q"], ["hygi", "H"], ["secur", "S"], ["safety", "S"], ["reglement", "R"], ["regulat", "R"], ["environ", "E"]];
  const trouve = parMot.find(([debut]) => mot.includes(debut));
  return trouve ? trouve[1] : "";
}

// ---------- Modèle de procédure : en-tête, validation, historique ----------
// « 25/09/2026 » -> « 2026-09-25 » (sinon vide : une date illisible n'est pas reprise).
function dateVersIso(texte) {
  const m = /(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(String(texte || ""));
  if (!m) return /^\d{4}-\d{2}-\d{2}$/.test(String(texte || "").trim()) ? String(texte).trim() : "";
  return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

// « Réalisation » -> « realisation » (et les anciens domaines : « Dépôt / Infrastructure » -> « depot ») ; libellé inconnu : vide.
// Le 4e bloc s'affiche « Surveillance & mesure » / « Monitoring & measurement » (clé « verification ») ; l'ancien libellé « Vérification » reste lu.
function lireDomaine(texte) {
  const k = minuscule(texte);
  const trouve = [["management", "management"], ["pilotage", "management"], ["realisation", "realisation"], ["realization", "realisation"], ["support", "support"],
    ["surveillance", "verification"], ["monitoring", "verification"], ["verification", "verification"],
    ["exploitation", "exploitation"], ["operation", "exploitation"], ["maintenance", "maintenance"], ["depot", "depot"], ["infrastructure", "depot"],
    ["hse", "hse"], ["urgence", "hse"], ["emergency", "hse"]].find(([mot]) => k.includes(mot));
  return trouve && domaineValide(trouve[1]) ? trouve[1] : "";
}

// Les blocs avant le premier titre : tableau d'identification (organisation | « PROCÉDURE titre » | référence, version), validation, historique.
function lireEnTete(blocs, p) {
  let lu = false;
  blocs.filter((b) => b.type === "tableau" && b.lignes.length).forEach((t) => {
    const l0 = t.lignes[0];
    const texte0 = minuscule(l0.join(" "));
    if (t.lignes.length === 3 && l0.length === 3 && /domaine|area/.test(minuscule(t.lignes[1].join(" "))) && !lu) {
      lu = true;
      p.meta.organisation = plat(l0[0]);
      p.meta.titre = sentenceCase(plat(l0[1]).replace(/^(proc[ée]dure|instruction de travail|procedure|work instruction)\s*/i, ""));
      const ref = /(?:r[ée]f[ée]rence|reference)\s*:\s*(\S+)/i.exec(l0[2] || "");
      const ver = /version\s*:\s*(\S+)/i.exec(l0[2] || "");
      if (ref) p.meta.reference = ref[1];
      if (ver) p.meta.version = ver[1];
      p.meta.domaine = lireDomaine(t.lignes[2][0] || "");
      p.meta.processus = plat(t.lignes[2][1]);
      p.meta.dateApplication = dateVersIso(t.lignes[2][2]);
    } else if (/r[ée]dig|prepared/.test(texte0) && /v[ée]rifi|checked/.test(texte0)) {
      // Validation : colonnes rédigé / vérifié / approuvé ; lignes Nom, Fonction, Date, Visa.
      const qui = ["redige", "verifie", "approuve"];
      t.lignes.slice(1).forEach((l) => {
        const etiquette = minuscule(l[0] || "");
        const champ = /^(nom|name)/.test(etiquette) ? "nom" : /^(fonction|position)/.test(etiquette) ? "fonction" : /^date/.test(etiquette) ? "date" : "";
        if (!champ) return;
        qui.forEach((q, j) => { p.meta.signataires[q][champ] = champ === "date" ? dateVersIso(l[j + 1]) : plat(l[j + 1]); });
      });
    } else if (/^version/.test(texte0) && /nature|change|modification/.test(texte0)) {
      p.meta.revisions = t.lignes.slice(1, 1 + MAX_REVISIONS)
        .map((l) => nouvelleRevision({ version: plat(l[0]), date: dateVersIso(l[1]), nature: plat(l[2]), auteur: plat(l[3]) }))
        .filter((r) => r.version || r.date || r.nature || r.auteur);
    }
  });
  return lu;
}

// ---------- Titres de sections ----------
// La section se reconnaît à son titre (« 6. Description des activités » ou, avant la v0.11, « 6. Description du processus »),
// pas à son numéro : le modèle a maintenant 11 sections, les anciens Word en avaient 13.
const TITRES_SECTIONS = [["objet", "objet"], ["purpose", "objet"], ["domaine", "domaine"], ["scope", "domaine"], ["reference", "references"],
  ["definition", "definitions"], ["responsabilit", "responsabilites"], ["description", "description"], ["logigramme", "logigramme"],
  ["qualigramme", "logigramme"], ["flowchart", "logigramme"], ["representation", "logigramme"], ["controle", "controles"], ["control point", "controles"],
  ["indicateur", "indicateurs"], ["indicator", "indicateurs"], ["risque", "risques"], ["risk", "risques"], ["enregistrement", "enregistrements"],
  ["record", "enregistrements"], ["diffusion", "diffusion"], ["distribution", "diffusion"], ["annexe", "annexes"], ["appendi", "annexes"]];
const cleDeTitre = (texte) => {
  const titre = minuscule(texte.replace(/^\d{1,2}\.\s+/, ""));
  const trouve = TITRES_SECTIONS.find(([mot]) => titre.includes(mot));
  return trouve ? trouve[1] : "";
};

// ---------- Tableau « Description des activités » du modèle : N° | Description | Acteur responsable | Documents ----------
// La cellule de description contient le libellé, puis (chacun sur sa ligne) « Contrôle Q : critère », « Décision : cas → suite ; … »
// et « Informé(s) : … ». Ce que le modèle n'a pas (entrées, sorties) n'est pas dans le tableau : il reste à compléter à l'étape 2.
function lireDescriptionModele(cellule) {
  const [libelle = "", ...reste] = lignesDe(cellule);
  const resultat = { libelle, controle: null, condition: "", alternatives: [], informes: [] };
  reste.forEach((ligne) => {
    let m;
    if ((m = /^(?:contr[ôo]le|check)\s+([A-Za-z?])\b\s*(?::\s*(.*))?$/i.exec(ligne))) {
      const nature = m[1].toUpperCase();
      resultat.controle = { actif: true, nature: NATURES_CONTROLE.includes(nature) ? nature : "", critere: (m[2] || "").trim(), enregistrement: "" };
    } else if ((m = /^(?:d[ée]cision)\s*:\s*(.+)$/i.exec(ligne))) {
      m[1].split(/\s+;\s+/).forEach((seg, k) => {
        const c = /^(.*?)\s*→\s*(.+)$/.exec(seg);
        if (!c) return;
        const cas = c[1].trim();
        if (k === 0) resultat.condition = /^(sinon|otherwise)$/i.test(cas) ? "" : cas;
        else resultat.alternatives.push({ condition: /^(autre cas|other case)$/i.test(cas) ? "" : cas, cible: lireDestination(c[2]) });
      });
    } else if ((m = /^(?:inform[ée]\(?s?\)?|informed)\s*:\s*(.+)$/i.exec(ligne))) {
      resultat.informes = m[1].split(/\s*,\s*/).filter(Boolean).slice(0, 10);
    } else {
      resultat.libelle += ` ${ligne}`;
    }
  });
  return resultat;
}

export function interpreter(blocs) {
  const procedure = nouvelleProcedure();
  const rapport = [];
  const p = procedure;

  // Découpe en sections : chaque titre numérique (« 1. Objet »…) ouvre la section dont il porte le nom.
  const sections = {};
  const avant = []; // ce qui précède le premier titre : en-tête, validation, historique
  let courante = "";
  let dernierNumero = 0;
  blocs.forEach((b) => {
    if (b.type === "p" && !STYLE_SOMMAIRE.test(b.style)) {
      const m = /^(\d{1,2})\.\s+\S/.exec(b.texte);
      // Les lignes du sommaire (« 5. Responsabilités 5 », numéro de page à la fin) ne sont pas des titres.
      const dansSommaire = /\s\d{1,3}$/.test(b.texte);
      if (m && !dansSommaire && Number(m[1]) <= 13 && Number(m[1]) > dernierNumero && b.texte.length <= 90) {
        const cle = cleDeTitre(b.texte);
        if (cle && !(cle in sections)) { dernierNumero = Number(m[1]); courante = cle; sections[cle] = []; return; }
      }
    }
    if (courante) sections[courante].push(b); else avant.push(b);
  });
  if (Object.keys(sections).length < 3) {
    rapport.push({ gravite: "erreur", cle: "import.pas_modele" });
    return { procedure, rapport };
  }

  // En-tête du modèle (tableau d'identification, validation, historique), sinon anciennes pages de garde.
  const enTeteModele = lireEnTete(avant, p);
  if (!enTeteModele) {
    // Titre : le paragraphe qui suit « PROCÉDURE » sur la page de garde.
    const iTitre = avant.findIndex((b) => b.type === "p" && /^proc[ée]dure$/i.test(b.texte));
    if (iTitre >= 0 && avant[iTitre + 1] && avant[iTitre + 1].type === "p") p.meta.titre = sentenceCase(avant[iTitre + 1].texte);
    else {
      // Document produit par cette application avant la v0.11 : le titre porte le style « Title ».
      const titre = avant.find((b) => b.type === "p" && /^(title|titre)$/i.test(b.style));
      if (titre) p.meta.titre = titre.texte;
    }
    // Cartouche : premier tableau à deux colonnes (Code / Version…).
    const cartouche = avant.find((b) => b.type === "tableau" && b.lignes.length && b.lignes.every((l) => l.length === 2));
    if (cartouche) {
      cartouche.lignes.forEach(([cle, valeur]) => {
        const k = minuscule(cle);
        const v = plat(valeur);
        if (k === "code") p.meta.reference = v;
        if (k === "version") p.meta.version = /^\S+/.exec(v)?.[0] ?? v;
        // Identification (étape 1) : reprise des lignes du cartouche quand elles existent.
        if (/^(organisation|societe)\b/.test(k)) p.meta.organisation = v;
        if (/^(direction|site|domaine)\b/.test(k)) p.meta.direction = v;
        if (/^processus\b/.test(k)) p.meta.processus = v;
        if (/^pilote\b/.test(k)) p.meta.pilote = v;
      });
    }
  }

  p.meta.typeDocument = "procedure"; // l'import lit des procédures (niveau 2)

  // Section 5 : rôles. Modèle : « Acteur / Fonction » (nom, puis service sur la ligne suivante) | « Responsabilité » ;
  // anciens Word : Rôle | Service | Interne / Externe | Responsabilités.
  const tabRoles = (sections.responsabilites || []).find((b) => b.type === "tableau" && b.lignes.length > 1);
  const roles = new Map();
  const creerRole = (nom, type, service = "", responsabilite = "") => {
    const id = nouvelId("r");
    const role = { id, nom, type, service, responsabilite };
    p.roles.push(role);
    roles.set(minuscule(nom), role);
    return role;
  };
  if (tabRoles) {
    const [entete, ...corps] = tabRoles.lignes;
    const iType = indexColonne(entete, "externe", "interne");
    const iService = indexColonne(entete, "service", "direction");
    const iResp = indexColonne(entete, "responsabilit");
    corps.forEach((l) => {
      const [nom = "", ...suite] = lignesDe(l[0]);
      if (!nom || roles.has(minuscule(nom))) return;
      let service = iService >= 0 ? plat(l[iService]) : "";
      let externe = iType >= 0 && /^externe/i.test(minuscule(l[iType] || ""));
      if (iService < 0 && suite.length) {
        // Modèle : « Service, Externe » sur la ligne qui suit le nom.
        service = suite.join(" ");
        if (/(?:,|\s)\s*(externe|external)\s*$/i.test(service)) { externe = true; service = service.replace(/\s*,?\s*(externe|external)\s*$/i, "").trim(); }
      }
      creerRole(nom, externe ? "externe" : ADJECTIF_UNITE.test(nom) ? "unite" : "individuel", service, iResp >= 0 ? plat(l[iResp]) : plat(l[1]));
    });
  } else {
    rapport.push({ gravite: "alerte", cle: "import.roles_absents" });
  }

  // Section 6 : déclencheur, fin, tableau des instructions.
  const blocs6 = sections.description || [];
  blocs6.forEach((b) => {
    if (b.type !== "p") return;
    const dec = /^fait\s+d[ée]clencheur\s*:\s*(.+)$/i.exec(b.texte);
    if (dec) p.meta.declencheur = majuscule(dec[1].replace(/\.\s*$/, ""));
    const fin = /^fin\s*:\s*(.+)$/i.exec(b.texte);
    if (fin) p.meta.fin = majuscule(fin[1].replace(/\.\s*$/, ""));
  });
  const tab6 = blocs6.find((b) => b.type === "tableau" && b.lignes.length > 1 && indexColonne(b.lignes[0], "acteur") >= 0);
  let nbOutils = 0;
  let renvois = 0;
  let nbRenvoisLus = 0;
  const numerosControles = [];
  let entreesSortiesAbsentes = false;
  const acteurDe = (nom) => {
    let role = nom ? roles.get(minuscule(nom)) : null;
    if (!role && nom) {
      role = creerRole(nom, ADJECTIF_UNITE.test(nom) ? "unite" : "individuel");
      rapport.push({ gravite: "info", cle: "import.role_ajoute", params: { nom } });
    }
    return role;
  };
  if (!tab6) {
    rapport.push({ gravite: "erreur", cle: "import.instructions_absentes" });
  } else {
    const [entete, ...corps] = tab6.lignes;
    const iOp = indexColonne(entete, "operation", "instruction", "activite", "description", "etape");
    const iActeur = indexColonne(entete, "acteur", "role");
    const iEntree = indexColonne(entete, "entree");
    const iSortie = indexColonne(entete, "sortie");
    const iSupport = indexColonne(entete, "support", "outil", "document");
    const colonne = (l, i) => (i >= 0 && l[i] ? plat(l[i]) : "");
    const versModele = iEntree < 0 && iSortie < 0; // tableau du modèle : pas de colonnes entrée / sortie
    corps.forEach((l) => {
      let libelle = colonne(l, iOp >= 0 ? iOp : 1);
      let lu = null;
      if (versModele) {
        lu = lireDescriptionModele(l[iOp >= 0 ? iOp : 1]);
        libelle = lu.libelle.trim();
      }
      if (!libelle) return;
      const acteurBrut = colonne(l, iActeur);
      const avec = /^(.*?)\s*\((?:avec|with)\s+(.+)\)$/i.exec(acteurBrut);
      const role = acteurDe(avec ? avec[1].trim() : acteurBrut);
      const participants = avec ? avec[2].split(/\s*,\s*/).map((n) => roles.get(minuscule(n))).filter(Boolean).map((r) => r.id) : [];
      const [entree, entreeDe] = separerParenthese(colonne(l, iEntree));
      const decision = versModele ? null : lireDecision(colonne(l, iSortie));
      const [sortie, versQui] = separerParenthese(decision ? decision.sortie : colonne(l, iSortie));
      if (!versModele && !decision && /[ée]tapes?\s+\d/i.test(colonne(l, iEntree) + " " + colonne(l, iSortie))) renvois += 1;
      const supports = versModele ? lignesDe(l[iSupport]) : colonne(l, iSupport).split(/\s*[,;]\s*/);
      let niveau3 = null;
      const outils = supports.filter((x) => {
        const n3 = /^(?:IT N3|IT L3|level-3 WI)\s*:\s*(.+)$/i.exec(x);
        if (n3 && versModele) { niveau3 = { actif: true, code: n3[1].trim(), intitule: "" }; return false; }
        return x && !MOT_VIDE.test(x) && !/^section\s+\d/i.test(x);
      }).slice(0, 6).map((nom) => ({ id: nouvelId("o"), type: "document", nom }));
      nbOutils += outils.length;
      const etape = nouvelleEtape({ roleId: role ? role.id : "", libelle, entree, entreeDe, sortie, versQui, outils, participants });
      if (niveau3) etape.niveau3 = niveau3;
      if (lu) {
        if (lu.controle) { etape.controle = lu.controle; numerosControles.push(p.etapes.length + 1); }
        etape.informes = lu.informes;
        etape.condition = lu.condition;
        lu.alternatives.slice(0, MAX_ALTERNATIVES).forEach((a) => etape.alternatives.push(nouvelleAlternative({ condition: a.condition, cible: a.cible })));
      }
      if (decision) {
        etape.condition = decision.condition;
        decision.alternatives.slice(0, MAX_ALTERNATIVES).forEach((a) => etape.alternatives.push(nouvelleAlternative({ condition: a.condition, info: a.info, versQui: a.versQui, cible: a.cible })));
      }
      p.etapes.push(etape);
    });
    if (versModele && p.etapes.length) entreesSortiesAbsentes = true;
    // Les destinations sont des numéros d'instruction : on les convertit en identifiants quand toutes les instructions existent.
    p.etapes.forEach((etape, k) => {
      etape.alternatives.forEach((a) => {
        const cible = a.cible;
        delete a.cible;
        a.vers = cible === "fin" ? "fin" : Number.isInteger(cible) && cible >= 1 && cible <= p.etapes.length && cible - 1 !== k ? p.etapes[cible - 1].id : "";
        nbRenvoisLus += 1;
      });
    });
  }

  // Anciens Word (13 sections) — section « Points de contrôle » : tableau N°, Contrôle, Nature, Critère, Enregistrement, Suite si non conforme.
  // Chaque ligne dont le numéro désigne une instruction devient un contrôle (triangle) de cette instruction.
  const tabControles = (sections.controles || []).find((b) => b.type === "tableau" && b.lignes.length > 1
    && /^n/.test(minuscule(b.lignes[0][0] || "")) && indexColonne(b.lignes[0], "contr") >= 0);
  let controlesLus = false;
  if (tabControles) {
    const [entete, ...corps] = tabControles.lignes;
    const iNature = indexColonne(entete, "nature");
    const iCritere = indexColonne(entete, "crit");
    const iEnreg = indexColonne(entete, "enregistrement", "record");
    const iSuite = indexColonne(entete, "suite", "if non");
    const lignesNumerotees = corps.filter((l) => /^\d+$/.test((l[0] || "").trim()));
    const toutesConnues = lignesNumerotees.length > 0 && lignesNumerotees.every((l) => Number(l[0]) >= 1 && Number(l[0]) <= p.etapes.length);
    if (toutesConnues) {
      // Le tableau est remplacé par le tableau généré seulement si toutes ses colonnes sont connues (rien n'est perdu).
      const connue = (c) => /^(n\W?|n[°o]|no\.?)$/.test(minuscule(c).trim()) || /contr|nature|crit|enregistr|record|suite|if non/.test(minuscule(c));
      controlesLus = entete.every(connue);
      lignesNumerotees.forEach((l) => {
        const n = Number(l[0]);
        const etape = p.etapes[n - 1];
        numerosControles.push(n);
        etape.controle = {
          actif: true, nature: lireNature(colonne8(l, iNature)), critere: colonne8(l, iCritere), enregistrement: colonne8(l, iEnreg),
        };
        // Suite si non conforme : utilisée seulement si la colonne « Sortie » de la section 6 n'a pas déjà donné les alternatives.
        if (etape.alternatives.length === 0 && iSuite >= 0) {
          colonne8(l, iSuite).split(/\s+;\s+/).slice(0, MAX_ALTERNATIVES).forEach((seg) => {
            const m = /^(.*?)\s*→\s*(.+)$/.exec(seg);
            if (!m) return;
            const cible = lireDestination(m[2]);
            const vers = cible === "fin" ? "fin" : Number.isInteger(cible) && cible >= 1 && cible <= p.etapes.length && cible !== n ? p.etapes[cible - 1].id : "";
            etape.alternatives.push(nouvelleAlternative({ condition: m[1].trim(), vers }));
            nbRenvoisLus += 1;
          });
        }
      });
    }
  }

  // Corps du document : chaque section devient une liste de paragraphes et de tableaux.
  const consommes = new Set([tabRoles, tab6, controlesLus ? tabControles : null].filter(Boolean));
  const listeDe = (cle) => {
    const liste = [];
    (sections[cle] || []).forEach((b) => {
      if (b.type === "p") {
        if (cle === "description" && /^(fait\s+d[ée]clencheur|fin)\s*:/i.test(b.texte)) return; // reprises dans le cadrage
        liste.push({ id: nouvelId("b"), type: "p", texte: b.texte });
      } else if (consommes.has(b)) {
        liste.push({ id: nouvelId("b"), type: "genere" }); // tableau reconstruit à partir des rôles / instructions
      } else if (b.lignes.length) {
        const [entete, ...corps] = b.lignes;
        liste.push({ id: nouvelId("b"), type: "tableau", colonnes: entete.map(plat), lignes: corps.map((l) => entete.map((_, k) => l[k] || "")) });
      }
    });
    return liste;
  };
  SECTIONS.forEach((cle) => { p.corps[cle] = listeDe(cle); });
  // Anciens Word : « Points de contrôle » et « Annexes » sont reprises à la suite de la section qui les remplace (fait par le store).
  if (sections.controles) p.corps.controles = listeDe("controles");
  if (sections.annexes) p.corps.annexes = listeDe("annexes");

  // Ce qui a été repris ou reste à vérifier.
  if (numerosControles.length) rapport.push({ gravite: "info", cle: "import.controles", params: { liste: numerosControles.join(", ") } });
  if (nbRenvoisLus) rapport.push({ gravite: "info", cle: "import.renvois", params: { n: nbRenvoisLus } });
  if (renvois) rapport.push({ gravite: "info", cle: "import.renvois_texte", params: { n: renvois } });
  if (!p.meta.declencheur) rapport.push({ gravite: "alerte", cle: "import.declencheur_absent" });
  if (!p.meta.fin) rapport.push({ gravite: "alerte", cle: "import.fin_absente" });
  if (nbOutils) rapport.push({ gravite: "info", cle: "import.outils_documents", params: { n: nbOutils } });
  if (entreesSortiesAbsentes) rapport.push({ gravite: "alerte", cle: "import.entrees_sorties_absentes" });
  if (!p.meta.organisation || !p.meta.processus || !p.meta.pilote) rapport.push({ gravite: "info", cle: "import.identification" });
  rapport.push({ gravite: "info", cle: "import.sections_non_reprises" });
  rapport.unshift({ gravite: "ok", cle: "import.resume", params: { roles: p.roles.length, etapes: p.etapes.length } });
  return { procedure, rapport };
}

// Chaîne complète : contenu du fichier -> { procedure, rapport }.
// Un Word généré par l'application et non modifié depuis contient la procédure complète : on la reprend sans perte.
export async function importerWord(tampon) {
  const xml = await lireZip(tampon);
  let embarque = null;
  try {
    embarque = deballer(await lireZip(tampon, "customXml/item1.xml"));
  } catch (e) {
    embarque = null; // pas de partie embarquée : Word ordinaire
  }
  // Word d'une instruction de travail : le dessin est une image, il n'y a pas de texte à relire dans les tableaux — l'instruction
  // embarquée est toujours reprise, même si quelqu'un a ajouté du texte dans Word.
  const instructionEmbarquee = embarque && embarque.procedure && embarque.procedure.meta && embarque.procedure.meta.typeDocument === "instruction";
  if (instructionEmbarquee) {
    const it = embarque.procedure.it || {};
    return { procedure: embarque.procedure, rapport: [{ gravite: "ok", cle: "import.embarque_it", params: { operations: Array.isArray(it.operations) ? it.operations.length : 0 } }] };
  }
  if (embarque && embarque.signature === empreinte(texteVisible(xml)) && embarque.procedure) {
    const p = embarque.procedure;
    return { procedure: p, rapport: [{ gravite: "ok", cle: "import.embarque", params: { roles: (p.roles || []).length, etapes: (p.etapes || []).length } }] };
  }
  const resultat = interpreter(extraireBlocs(xml));
  if (embarque) resultat.rapport.push({ gravite: "info", cle: "import.embarque_modifie" });
  return resultat;
}
