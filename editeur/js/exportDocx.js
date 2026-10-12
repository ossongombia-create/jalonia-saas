// exportDocx.js — fabrique le document Word (.docx) à partir de la procédure, dans le style du « Modèle standard de procédure ».
// Un .docx est une archive ZIP de fichiers XML. On écrit ce XML à la main (pas de bibliothèque) :
//   [Content_Types].xml        la liste des types de fichiers
//   _rels/.rels                le point d'entrée (word/document.xml)
//   word/document.xml          le contenu : en-tête, validation, historique, 11 sections
//   word/styles.xml            Calibri 10,5 pt, titres sarcelle (005A70), sous-titres violets (6F5091)
//   word/settings.xml          mode de compatibilité Word récent
//   word/footer1.xml           pied de page centré : code · version — titre · page X / Y
//   word/media/logigramme.png  le logigramme, en image (fournie par le navigateur)
//   word/media/logo.png|jpg    le logo de l'organisation, s'il y en a un (cellule d'en-tête)
//   customXml/item1.xml        la procédure complète (JSON), pour rouvrir le fichier sans perte (voir embarque.js)
//   docProps/core.xml          titre et auteur du fichier
// Le logigramme est sur sa propre page, en portrait ou en paysage ; le reste du document est en portrait.
// Cette fonction ne touche pas à la page : elle reçoit la procédure et rend les octets du fichier,
// ce qui permet de la tester sans navigateur.
// Une INSTRUCTION DE TRAVAIL (niveau 3) a son propre document (construireDocxIT, en bas) : une seule page A4 portrait, comme au chapitre 7
// du livre — le dessin (en-tête, rôle, trois colonnes, légende) en image, et l'instruction complète embarquée pour la rouvrir sans perte.

import { construireDocument, largeursColonnes, colonnesCentrees, GABARITS, LARGEUR_TEXTE, MISE_EN_PAGE as MEP } from "./document.js";
import { meilleurePage } from "./render.js";
import { emballer, texteVisible, empreinte, URI_EMBARQUE } from "./embarque.js";
import { creerZip } from "./zip.js";
import { lireLogo } from "./logoImage.js";
import { t, langueCourante } from "./i18n.js";
import { NOM_OUTIL } from "./config.js";
import { CATEGORIES, processusParCategorie, fluxDuProcessus, libelleProcessus, ficheProcessus } from "./cartographie.js";

const EMU_PAR_PX = 9525; // 96 dpi

// Couleurs et mesures du modèle.
// Charte Jalonia (la même que l'aperçu : css/style.css, .feuille) : sarcelle pour les titres et les en-têtes de tableau, violet pour les sous-titres, lavande pour les étiquettes.
const TEXTE = "1C2A33";
const SARCELLE = "005A70";
const VIOLET = "6F5091";
const FOND_ETIQUETTE = "F1EEF4";
const BORD = "D2CBDC";
const PIED = "4E5A63";
const GRIS_VIDE = "56666F";

const PORTRAIT = { w: 11906, h: 16838, haut: 900, bas: 900, gauche: 1134, droite: 900 };
const PAYSAGE = { w: 16838, h: 11906, haut: 600, bas: 950, gauche: 1134, droite: 700 };

const NS_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const ENTETE_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

// Un texte saisi peut contenir des caractères interdits en XML : sans les retirer, Word refuserait d'ouvrir le fichier.
const CARACTERES_INTERDITS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;
export function echapperXml(texte) {
  return String(texte)
    .replace(CARACTERES_INTERDITS, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const run = (texte, rpr = "") =>
  `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ""}<w:t xml:space="preserve">${echapperXml(String(texte).replace(/\t/g, " "))}</w:t></w:r>`;

// Plusieurs runs : un saut de ligne (\n) devient <w:br/>.
function runs(texte, rpr = "") {
  return String(texte).split(/\r\n|\r|\n/).map((ligne, k) => `${k ? "<w:r><w:br/></w:r>" : ""}${run(ligne, rpr)}`).join("");
}

const paragraphe = (contenu, ppr = "") => `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ""}${contenu}</w:p>`;

// Champ (numéro de page…) : Word et LibreOffice le recalculent ; « 1 » n'est que la valeur de départ.
const champ = (instruction, rpr = "") => `<w:fldSimple w:instr=" ${instruction} "><w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ""}<w:t>1</w:t></w:r></w:fldSimple>`;

// ---------- Tableaux ----------
const TAILLE_CELLULE = '<w:sz w:val="18"/><w:szCs w:val="18"/>';
const BORDS = ["top", "left", "bottom", "right", "insideH", "insideV"]
  .map((b) => `<w:${b} w:val="single" w:sz="4" w:space="0" w:color="${BORD}"/>`).join("");
const PROPRIETES_TABLEAU = `<w:tblPr><w:tblW w:w="${LARGEUR_TEXTE}" w:type="dxa"/><w:tblBorders>${BORDS}</w:tblBorders>` +
  '<w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="' + MEP.margeCellule + '" w:type="dxa"/><w:left w:w="110" w:type="dxa"/><w:bottom w:w="' + MEP.margeCellule + '" w:type="dxa"/><w:right w:w="110" w:type="dxa"/></w:tblCellMar></w:tblPr>';
// Un tableau ne peut pas être suivi directement d'un autre tableau, ni finir une section : petit paragraphe d'espacement.
const APRES_TABLEAU = paragraphe("", `<w:spacing w:before="0" w:after="0" w:line="${MEP.apresTableau}" w:lineRule="exact"/>`);

// Une cellule : plusieurs lignes possibles (\n), texte centré verticalement ; « gras1 » met la première ligne en gras.
function cellule(texte, largeur, { gras = false, gras1 = false, fond = "", centre = false, blanc = false, italique = false } = {}) {
  const lignes = String(texte ?? "").split(/\r\n|\r|\n/);
  const paragraphes = lignes.map((ligne, k) => {
    const rpr = `${gras || (gras1 && k === 0) ? "<w:b/><w:bCs/>" : ""}${italique ? "<w:i/><w:iCs/>" : ""}${blanc ? '<w:color w:val="FFFFFF"/>' : ""}${TAILLE_CELLULE}`;
    const ppr = `${k < lignes.length - 1 ? '<w:spacing w:after="20"/>' : ""}${centre ? '<w:jc w:val="center"/>' : ""}`;
    return paragraphe(ligne === "" ? "" : run(ligne, rpr), ppr);
  }).join("");
  return `<w:tc><w:tcPr><w:tcW w:w="${largeur}" w:type="dxa"/>${fond ? `<w:shd w:val="clear" w:color="auto" w:fill="${fond}"/>` : ""}<w:vAlign w:val="center"/></w:tcPr>${paragraphes}</w:tc>`;
}

const ligneTableau = (cellules, { entete = false, hauteurMin = 0 } = {}) =>
  `<w:tr><w:trPr><w:cantSplit/>${hauteurMin ? `<w:trHeight w:val="${hauteurMin}" w:hRule="atLeast"/>` : ""}${entete ? "<w:tblHeader/>" : ""}</w:trPr>${cellules.join("")}</w:tr>`;

// Un tableau du document : en-tête bleu (texte blanc), colonnes courtes centrées, texte centré verticalement.
function tableau(bloc) {
  const largeurs = largeursColonnes(bloc.colonnes, bloc.lignes, bloc.gabarit);
  const centrees = colonnesCentrees(bloc);
  const grille = largeurs.map((w) => `<w:gridCol w:w="${w}"/>`).join("");
  const gras1 = bloc.gras1 || [];
  const enteteVide = bloc.colonnes.every((c) => !String(c).trim());
  const entete = enteteVide ? "" : ligneTableau(
    bloc.colonnes.map((c, j) => cellule(c, largeurs[j], { gras: true, blanc: true, fond: SARCELLE, centre: centrees.includes(j) })), { entete: true });
  const corps = bloc.lignes.map((l) => {
    const visa = bloc.premiereColonneEtiquette && String(l[0]) === t("valid.ligne.visa");
    return ligneTableau(bloc.colonnes.map((_, j) => cellule(l[j] ?? "", largeurs[j], {
      gras: bloc.premiereColonneEtiquette && j === 0, gras1: gras1.includes(j), centre: centrees.includes(j),
      fond: bloc.premiereColonneEtiquette && j === 0 ? FOND_ETIQUETTE : "",
    })), { hauteurMin: visa ? 620 : 0 });
  }).join("");
  return `<w:tbl>${PROPRIETES_TABLEAU}<w:tblGrid>${grille}</w:tblGrid>${entete}${corps}</w:tbl>${APRES_TABLEAU}`;
}

// Tableau d'identification en haut de la première page : organisation | titre | référence, version, page ; puis domaine, processus, date.
function enteteXml(doc, logo) {
  const c = doc.cartouche;
  const l = largeursColonnes(["", "", ""], [], GABARITS.entete);
  const cellOrganisation = logo
    ? `<w:tc><w:tcPr><w:tcW w:w="${l[0]}" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="${FOND_ETIQUETTE}"/><w:vAlign w:val="center"/></w:tcPr>` +
      logoParagraphe(logo) + paragraphe(c.organisation ? run(c.organisation, `<w:b/><w:bCs/>${TAILLE_CELLULE}`) : "", '<w:jc w:val="center"/>') + "</w:tc>"
    : cellule(c.organisation, l[0], { fond: FOND_ETIQUETTE, centre: true, gras: true });
  const ligne1 = ligneTableau([
    cellOrganisation,
    `<w:tc><w:tcPr><w:tcW w:w="${l[1]}" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>` +
      paragraphe(run(`${c.typeTitre} ${c.titre || t("doc.sans_titre")}`, '<w:b/><w:bCs/><w:sz w:val="22"/><w:szCs w:val="22"/>'), '<w:jc w:val="center"/>') + "</w:tc>",
    `<w:tc><w:tcPr><w:tcW w:w="${l[2]}" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>` +
      paragraphe(run(`${t("doc.hd.reference")} : ${c.reference}`, TAILLE_CELLULE), '<w:spacing w:after="40"/>') +
      paragraphe(run(`${t("doc.hd.version")} : ${c.version}`, TAILLE_CELLULE), '<w:spacing w:after="40"/>') +
      paragraphe(run(`${t("doc.page")} `, TAILLE_CELLULE) + champ("PAGE", TAILLE_CELLULE) + run(" / ", TAILLE_CELLULE) + champ("NUMPAGES", TAILLE_CELLULE)) + "</w:tc>",
  ]);
  const ligne2 = ligneTableau(["domaine", "processus", "date"].map((k, j) => cellule(t("doc.hd." + k), l[j], { gras: true, fond: FOND_ETIQUETTE })));
  const ligne3 = ligneTableau([c.domaine, c.processus, c.dateApplication].map((v, j) => cellule(v, l[j], {})));
  return `<w:tbl>${PROPRIETES_TABLEAU}<w:tblGrid>${l.map((w) => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>${ligne1}${ligne2}${ligne3}</w:tbl>${APRES_TABLEAU}`;
}

// ---------- Logo de l'organisation (cellule d'en-tête) ----------
const RID_LOGO = "rId6";
function logoParagraphe(logo) {
  const cx = logo.affichage.largeur * EMU_PAR_PX;
  const cy = logo.affichage.hauteur * EMU_PAR_PX;
  return paragraphe(
    `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">` +
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="2" name="Logo" descr="${echapperXml(t("form.logo.alt"))}"/>` +
    '<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
    '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="logo.${logo.extension}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${RID_LOGO}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>` +
    "</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>",
    '<w:spacing w:after="40"/><w:jc w:val="center"/>');
}

// ---------- Image du logigramme ----------
function imageXml(cx, cy, description, ppr = '<w:keepLines/><w:spacing w:before="60" w:after="0"/><w:jc w:val="center"/>') {
  return paragraphe(
    `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">` +
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="1" name="Logigramme" descr="${echapperXml(description)}"/>` +
    '<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
    '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="logigramme.png"/><pic:cNvPicPr/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="rId3"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>` +
    "</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>",
    ppr);
}

// Comment le dessin est posé : { orientation, cx, cy } (EMU). Fourni par le navigateur (options.disposition, en pixels à 96 dpi),
// sinon calculé d'après la taille de l'image (PNG produit à l'échelle 1 ou 2 : on ne garde que ses proportions).
function dispositionImage(opt) {
  const d = opt.disposition;
  if (d && d.largeur > 0 && d.hauteur > 0) return { orientation: d.orientation, cx: Math.round(d.largeur * EMU_PAR_PX), cy: Math.round(d.hauteur * EMU_PAR_PX) };
  const m = meilleurePage(opt.largeurPng, opt.hauteurPng);
  const echelle = m.echelle * (opt.echellePng || 1);
  return { orientation: m.orientation, cx: Math.round((opt.largeurPng / (opt.echellePng || 1)) * echelle * EMU_PAR_PX), cy: Math.round((opt.hauteurPng / (opt.echellePng || 1)) * echelle * EMU_PAR_PX) };
}

// ---------- Contenu ----------
const titre1 = (numero, texte, saut = false) =>
  paragraphe(run(`${numero}. ${texte}`), `<w:pStyle w:val="Titre1"/>${saut ? "<w:pageBreakBefore/>" : ""}`);
const titre2 = (texte) => paragraphe(run(texte), '<w:pStyle w:val="Titre2"/>');

function propriete(page, extra = "") {
  const p = page === "paysage" ? PAYSAGE : PORTRAIT;
  return `<w:sectPr><w:footerReference w:type="default" r:id="rId2"/>${extra}<w:pgSz w:w="${p.w}" w:h="${p.h}"${page === "paysage" ? ' w:orient="landscape"' : ""}/>` +
    `<w:pgMar w:top="${p.haut}" w:right="${p.droite}" w:bottom="${p.bas}" w:left="${p.gauche}" w:header="500" w:footer="400" w:gutter="0"/></w:sectPr>`;
}

// Fin de section : un paragraphe minuscule qui porte les propriétés de page de la section qui se termine.
const finDeSection = (page) => paragraphe("", `<w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/>${propriete(page)}`);

function blocXml(b, suivant, options, disposition) {
  if (b.type === "paragraphe") {
    const intro = suivant && suivant.type === "tableau" ? "<w:keepNext/>" : "";
    return paragraphe(runs(b.texte), `${intro}<w:spacing w:after="${MEP.apresParagraphe}" w:line="${MEP.interligne}" w:lineRule="auto"/>`);
  }
  if (b.type === "sous-titre") return titre2(b.texte);
  if (b.type === "tableau") return tableau(b);
  // logigramme
  if (options.png && disposition) return imageXml(disposition.cx, disposition.cy, t("doc.section.logigramme"));
  return paragraphe(runs(t("doc.logigramme_ici"), `<w:i/><w:color w:val="${GRIS_VIDE}"/>`));
}

function sectionXml(doc, section, index, options, disposition, saut) {
  const parties = [titre1(index + 1, t("doc.section." + section.cle), saut)];
  if (section.blocs.length === 0) parties.push(paragraphe(runs(t("doc.section_vide"), `<w:i/><w:color w:val="${GRIS_VIDE}"/>`), '<w:spacing w:after="140"/>'));
  section.blocs.forEach((b, k) => parties.push(blocXml(b, section.blocs[k + 1], options, disposition)));
  return parties.join("");
}

function corpsXml(doc, options) {
  const parties = [];
  // En-tête du modèle : identification, validation du document, historique des révisions.
  parties.push(enteteXml(doc, options.logo || null));
  parties.push(titre2(t("valid.titre")), tableau(doc.validation));
  parties.push(titre2(t("histo.titre")), tableau(doc.historique));

  const iLog = doc.sections.findIndex((s) => s.blocs.some((b) => b.type === "logigramme"));
  const avecImage = iLog >= 0 && options.png;
  const disposition = iLog >= 0 && avecImage ? dispositionImage(options) : null;
  const orientation = disposition ? disposition.orientation : "portrait";

  doc.sections.forEach((s, i) => {
    // Le logigramme ouvre sa propre section (page portrait ou paysage) ; la section suivante repart en portrait.
    if (i === iLog) parties.push(finDeSection("portrait"));
    if (iLog >= 0 && i === iLog + 1) parties.push(finDeSection(orientation));
    parties.push(sectionXml(doc, s, i, options, disposition, i === 0 && doc.enTeteSeparee));
  });
  return parties.join("");
}

function documentXml(doc, options) {
  return `${ENTETE_XML}<w:document xmlns:w="${NS_W}" xmlns:r="${NS_R}"><w:body>${corpsXml(doc, options)}${propriete("portrait")}</w:body></w:document>`;
}

function piedXml(doc) {
  const pet = `<w:sz w:val="15"/><w:szCs w:val="15"/><w:color w:val="${PIED}"/>`;
  const gauche = doc.cartouche.pied ? `${doc.cartouche.pied} · ` : `${t("doc.page")} `;
  return `${ENTETE_XML}<w:ftr xmlns:w="${NS_W}" xmlns:r="${NS_R}">` +
    paragraphe(`${run(gauche, pet)}${champ("PAGE", pet)}${run(" / ", pet)}${champ("NUMPAGES", pet)}`, '<w:jc w:val="center"/>') +
    "</w:ftr>";
}

function stylesXml() {
  const langue = langueCourante() === "en" ? "en-GB" : "fr-FR";
  const titre = (id, nom, avant, apres, taille, niveau, couleur) =>
    `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${nom}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/>` +
    `<w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="${avant}" w:after="${apres}"/><w:outlineLvl w:val="${niveau}"/></w:pPr>` +
    `<w:rPr><w:b/><w:bCs/><w:color w:val="${couleur}"/><w:sz w:val="${taille}"/><w:szCs w:val="${taille}"/></w:rPr></w:style>`;
  return `${ENTETE_XML}<w:styles xmlns:w="${NS_W}"><w:docDefaults><w:rPrDefault><w:rPr>` +
    '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/>' + `<w:color w:val="${TEXTE}"/><w:sz w:val="21"/><w:szCs w:val="21"/>` +
    `<w:lang w:val="${langue}" w:eastAsia="${langue}" w:bidi="ar-SA"/></w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults>` +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
    titre("Titre1", "heading 1", MEP.titre1Avant, MEP.titre1Apres, 28, 0, SARCELLE) + titre("Titre2", "heading 2", MEP.titre2Avant, MEP.titre2Apres, 22, 1, VIOLET) + "</w:styles>";
}

const SETTINGS = `${ENTETE_XML}<w:settings xmlns:w="${NS_W}"><w:compat>` +
  '<w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>';

function typesXml(avecEmbarque, logo, avecPied = true) {
  return `${ENTETE_XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>' +
    (logo && logo.extension === "jpg" ? '<Default Extension="jpg" ContentType="image/jpeg"/>' : "") +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
    (avecPied ? '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' : "") +
    (avecEmbarque ? '<Override PartName="/customXml/itemProps1.xml" ContentType="application/vnd.openxmlformats-officedocument.customXmlProperties+xml"/>' : "") +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>';
}

const RELS = `${ENTETE_XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
  '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>';

function relsDocument(avecImage, avecEmbarque, logo) {
  return `${ENTETE_XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>' +
    (avecImage ? '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/logigramme.png"/>' : "") +
    '<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>' +
    (avecEmbarque ? '<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml" Target="../customXml/item1.xml"/>' : "") +
    (logo ? `<Relationship Id="${RID_LOGO}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/logo.${logo.extension}"/>` : "") +
    "</Relationships>";
}

const RELS_EMBARQUE = `${ENTETE_XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXmlProps" Target="itemProps1.xml"/></Relationships>';

const PROPRIETES_EMBARQUE = `${ENTETE_XML}<ds:datastoreItem ds:itemID="{5B1C2E34-7A9D-4F60-8C11-0D6E2A9F4B73}" xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml">` +
  `<ds:schemaRefs><ds:schemaRef ds:uri="${URI_EMBARQUE}"/></ds:schemaRefs></ds:datastoreItem>`;

function proprietesXml(doc, dateIso) {
  return `${ENTETE_XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ` +
    'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    `<dc:title>${echapperXml(doc.cartouche.titre || "")}</dc:title><dc:creator>${echapperXml(NOM_OUTIL)}</dc:creator>` +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${dateIso}</dcterms:created></cp:coreProperties>`;
}

// options : { png: Uint8Array | null, largeurPng, hauteurPng (pixels de l'image), echellePng (2 si l'image est deux fois plus grande que le dessin),
//             disposition: { orientation, largeur, hauteur } (taille finale du dessin en pixels à 96 dpi, voir render.js),
//             maintenant: Date (pour l'horodatage du fichier), embarquer: true (procédure complète dans le fichier) }
export function construireDocx(procedure, options = {}) {
  const opt = { png: null, largeurPng: 0, hauteurPng: 0, echellePng: 1, disposition: null, maintenant: new Date(), embarquer: true, ...options };
  const doc = construireDocument(procedure);
  const avecImage = Boolean(opt.png) && opt.largeurPng > 0 && opt.hauteurPng > 0;
  const logo = lireLogo(doc.cartouche.logo); // null s'il n'y a pas de logo, ou s'il n'est pas lisible
  const xmlDocument = documentXml(doc, { ...opt, png: avecImage ? opt.png : null, logo });
  const fichiers = [
    { nom: "[Content_Types].xml", donnees: typesXml(opt.embarquer, logo) },
    { nom: "_rels/.rels", donnees: RELS },
    { nom: "word/document.xml", donnees: xmlDocument },
    { nom: "word/styles.xml", donnees: stylesXml() },
    { nom: "word/settings.xml", donnees: SETTINGS },
    { nom: "word/footer1.xml", donnees: piedXml(doc) },
    { nom: "word/_rels/document.xml.rels", donnees: relsDocument(avecImage, opt.embarquer, logo) },
    { nom: "docProps/core.xml", donnees: proprietesXml(doc, opt.maintenant.toISOString().replace(/\.\d+Z$/, "Z")) },
  ];
  if (avecImage) fichiers.push({ nom: "word/media/logigramme.png", donnees: opt.png });
  if (logo) fichiers.push({ nom: `word/media/logo.${logo.extension}`, donnees: logo.octets });
  if (opt.embarquer) {
    fichiers.push({ nom: "customXml/item1.xml", donnees: emballer(procedure, empreinte(texteVisible(xmlDocument))) });
    fichiers.push({ nom: "customXml/_rels/item1.xml.rels", donnees: RELS_EMBARQUE });
    fichiers.push({ nom: "customXml/itemProps1.xml", donnees: PROPRIETES_EMBARQUE });
  }
  return creerZip(fichiers, opt.maintenant);
}

// ---------- Instruction de travail (niveau 3) ----------
// Une page A4 portrait : le dessin de render3.js, en image, centré, sans en-tête ni pied de page Word (le cartouche est dans le dessin).
// Marges étroites : le dessin est calculé pour une zone de 714 x 1040 px, la page en offre un peu plus (719 x 1055 px).
const PAGE_IT = { w: 11906, h: 16838, haut: 500, bas: 500, gauche: 560, droite: 560 };

function relsDocumentIT(avecImage, avecEmbarque) {
  return `${ENTETE_XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    (avecImage ? '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/logigramme.png"/>' : "") +
    '<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>' +
    (avecEmbarque ? '<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml" Target="../customXml/item1.xml"/>' : "") +
    "</Relationships>";
}

// options : { png, largeurPng, hauteurPng (pixels de l'image), disposition: { largeur, hauteur } (taille finale du dessin en pixels à 96 dpi,
//             voir disposerNiveau3), maintenant: Date, embarquer: true }
export function construireDocxIT(procedure, options = {}) {
  const opt = { png: null, largeurPng: 0, hauteurPng: 0, disposition: null, maintenant: new Date(), embarquer: true, ...options };
  const avecImage = Boolean(opt.png) && opt.largeurPng > 0 && opt.hauteurPng > 0;
  const titre = ((procedure.meta && procedure.meta.titre) || "").trim();
  // Taille du dessin sur la page : celle de disposerNiveau3 ; à défaut, les proportions de l'image sur toute la largeur utile.
  const d = opt.disposition && opt.disposition.largeur > 0 && opt.disposition.hauteur > 0
    ? opt.disposition
    : { largeur: 714, hauteur: (714 * (opt.hauteurPng || 1)) / (opt.largeurPng || 1) };
  const description = `${t("zone.instruction")} — ${titre || t("doc.sans_titre")}`;
  const corps = avecImage
    ? imageXml(Math.round(d.largeur * EMU_PAR_PX), Math.round(d.hauteur * EMU_PAR_PX), description, '<w:spacing w:before="0" w:after="0"/><w:jc w:val="center"/>')
    : paragraphe(runs(t("doc.instruction_ici"), `<w:i/><w:color w:val="${GRIS_VIDE}"/>`));
  const sect = `<w:sectPr><w:pgSz w:w="${PAGE_IT.w}" w:h="${PAGE_IT.h}"/><w:pgMar w:top="${PAGE_IT.haut}" w:right="${PAGE_IT.droite}" w:bottom="${PAGE_IT.bas}" w:left="${PAGE_IT.gauche}" w:header="300" w:footer="300" w:gutter="0"/></w:sectPr>`;
  const xmlDocument = `${ENTETE_XML}<w:document xmlns:w="${NS_W}" xmlns:r="${NS_R}"><w:body>${corps}${sect}</w:body></w:document>`;
  const fichiers = [
    { nom: "[Content_Types].xml", donnees: typesXml(opt.embarquer, null, false) },
    { nom: "_rels/.rels", donnees: RELS },
    { nom: "word/document.xml", donnees: xmlDocument },
    { nom: "word/styles.xml", donnees: stylesXml() },
    { nom: "word/settings.xml", donnees: SETTINGS },
    { nom: "word/_rels/document.xml.rels", donnees: relsDocumentIT(avecImage, opt.embarquer) },
    { nom: "docProps/core.xml", donnees: proprietesXml({ cartouche: { titre } }, opt.maintenant.toISOString().replace(/\.\d+Z$/, "Z")) },
  ];
  if (avecImage) fichiers.push({ nom: "word/media/logigramme.png", donnees: opt.png });
  if (opt.embarquer) {
    fichiers.push({ nom: "customXml/item1.xml", donnees: emballer(procedure, empreinte(texteVisible(xmlDocument))) });
    fichiers.push({ nom: "customXml/_rels/item1.xml.rels", donnees: RELS_EMBARQUE });
    fichiers.push({ nom: "customXml/itemProps1.xml", donnees: PROPRIETES_EMBARQUE });
  }
  return creerZip(fichiers, opt.maintenant);
}

// ---------- Document de NIVEAU 1 (cartographie + fiches processus) ----------
// Le document reprend la CARTOGRAPHIE (dessin en image, fourni par le navigateur) sur une page paysage,
// puis un SOMMAIRE des fiches par bande, puis UNE FICHE D'IDENTITÉ par processus. Les éléments que la
// cartographie connaît (code, nom, bloc, et interfaces d'après les flux) sont pré-remplis ; les parties
// qualitatives (finalité, ressources, risques/opportunités, exigences) sont des titres « à compléter ».
const titre1Simple = (texte, saut = false) => paragraphe(run(texte), `<w:pStyle w:val="Titre1"/>${saut ? "<w:pageBreakBefore/>" : ""}`);
const aCompleterCarto = () => paragraphe(runs(t("carto.fiche.a_completer"), `<w:i/><w:color w:val="${GRIS_VIDE}"/>`), '<w:spacing w:after="140"/>');

function pointLabelCarto(point) {
  if (!point) return "";
  if (point.genre === "processus") return libelleProcessus(point.processus);
  if (point.genre === "categorie") return t("carto.categorie." + point.cle);
  return t("carto.point." + point.cle);
}

// Tableau d'une interface (entrées ou sorties) : [ information | autre processus / bloc / partie intéressée ]. Vide : « à compléter ».
function interfaceTableCarto(elements, h1, h2) {
  if (!elements || !elements.length) return aCompleterCarto();
  const L = LARGEUR_TEXTE, w0 = Math.round(L * 0.58), w1 = L - w0;
  const grille = `<w:gridCol w:w="${w0}"/><w:gridCol w:w="${w1}"/>`;
  const entete = ligneTableau([cellule(h1, w0, { gras: true, blanc: true, fond: SARCELLE }), cellule(h2, w1, { gras: true, blanc: true, fond: SARCELLE })], { entete: true });
  const corps = elements.map((e) => ligneTableau([cellule(e.information || "", w0, {}), cellule(pointLabelCarto(e.point), w1, {})])).join("");
  return `<w:tbl>${PROPRIETES_TABLEAU}<w:tblGrid>${grille}</w:tblGrid>${entete}${corps}</w:tbl>${APRES_TABLEAU}`;
}

// Le texte saisi d'un champ de fiche, rendu en paragraphes (une ligne saisie = un paragraphe) ; vide : le repli « à compléter »/aide.
function texteFicheXml(valeur, repli) {
  const v = typeof valeur === "string" ? valeur.trim() : "";
  if (!v) return repli;
  const lignes = v.split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lignes.length) return repli;
  return lignes.map((l, i) => paragraphe(run(l), `<w:spacing w:after="${i === lignes.length - 1 ? 140 : 40}"/>`)).join("");
}

function ficheProcessusXml(c, p) {
  const f = ficheProcessus(c, p.code);
  const parts = [titre1Simple(libelleProcessus(p), true)];
  const L = LARGEUR_TEXTE, wl = Math.round(L * 0.17), wv = Math.round(L * 0.33), w = [wl, wv, wl, L - wl - wv - wl];
  const grille = w.map((x) => `<w:gridCol w:w="${x}"/>`).join("");
  const pilote = (f.pilote || "").split("\n")[0].trim(); // le pilote tient sur une ligne dans le cartouche
  const lignes = [
    [t("carto.fiche.organisation"), c.organisation || "", t("carto.fiche.bloc"), p.categorie ? t("carto.categorie." + p.categorie) : t("carto.categorie.aucune")],
    [t("carto.fiche.code"), p.code, t("carto.fiche.pilote"), pilote],
  ];
  const corps = lignes.map((r) => ligneTableau(r.map((v, j) => cellule(v, w[j], { gras: j % 2 === 0, fond: j % 2 === 0 ? FOND_ETIQUETTE : "" })))).join("");
  parts.push(`<w:tbl>${PROPRIETES_TABLEAU}<w:tblGrid>${grille}</w:tblGrid>${corps}</w:tbl>${APRES_TABLEAU}`);
  parts.push(titre2(t("carto.fiche.finalite")), texteFicheXml(f.finalite, aCompleterCarto()));
  const fx = fluxDuProcessus(c, p.id);
  parts.push(titre2(t("carto.fiche.entrees")), interfaceTableCarto(fx.entrants, t("carto.fiche.element"), t("carto.fiche.fournisseur")));
  parts.push(titre2(t("carto.fiche.sorties")), interfaceTableCarto(fx.sortants, t("carto.fiche.element"), t("carto.fiche.client")));
  parts.push(titre2(t("carto.fiche.ressources")), texteFicheXml(f.ressources, aCompleterCarto()));
  const aideRisques = paragraphe(runs(t("carto.fiche.risques_opp.aide"), `<w:i/><w:color w:val="${GRIS_VIDE}"/>`), '<w:spacing w:after="140"/>');
  parts.push(titre2(t("carto.fiche.risques_opp")), texteFicheXml(f.risques, aideRisques));
  parts.push(titre2(t("carto.fiche.exigences")), texteFicheXml(f.exigences, aCompleterCarto()));
  return parts.join("");
}

// Taille de l'image de la cartographie pour tenir sur une page paysage (proportions conservées).
function dispositionCarto(opt) {
  const wpx = opt.largeurPng / (opt.echellePng || 1), hpx = opt.hauteurPng / (opt.echellePng || 1);
  const maxW = Math.round(((PAYSAGE.w - PAYSAGE.gauche - PAYSAGE.droite) / 1440) * 96);
  const maxH = Math.round(((PAYSAGE.h - PAYSAGE.haut - PAYSAGE.bas) / 1440) * 96);
  let w = maxW, h = (w * hpx) / wpx;
  if (h > maxH) { h = maxH; w = (h * wpx) / hpx; }
  return { cx: Math.round(w * EMU_PAR_PX), cy: Math.round(h * EMU_PAR_PX) };
}

function corpsCartoXml(c, opt) {
  const avecImage = Boolean(opt.png) && opt.largeurPng > 0 && opt.hauteurPng > 0;
  const parts = [
    paragraphe(run(t("carto.doc.titre"), `<w:b/><w:color w:val="${SARCELLE}"/><w:sz w:val="36"/><w:szCs w:val="36"/>`), '<w:jc w:val="center"/><w:spacing w:after="80"/>'),
    paragraphe(run(c.organisation || t("carto.doc.sans_org"), `<w:i/><w:color w:val="${GRIS_VIDE}"/><w:sz w:val="24"/><w:szCs w:val="24"/>`), '<w:jc w:val="center"/><w:spacing w:after="160"/>'),
  ];
  if (avecImage) { const d = dispositionCarto(opt); parts.push(imageXml(d.cx, d.cy, t("carto.titre"), '<w:keepLines/><w:spacing w:before="40" w:after="0"/><w:jc w:val="center"/>')); parts.push(finDeSection("paysage")); }
  else parts.push(paragraphe(runs(t("carto.doc.image_absente"), `<w:i/><w:color w:val="${GRIS_VIDE}"/>`), '<w:jc w:val="center"/><w:spacing w:after="120"/>'));
  parts.push(titre1Simple(t("carto.doc.sommaire"), !avecImage));
  CATEGORIES.concat([""]).forEach((cat) => {
    const ps = c.processus.filter((p) => (p.categorie || "") === cat);
    if (!ps.length) return;
    parts.push(titre2(t("carto.categorie." + (cat || "aucune"))));
    ps.forEach((p) => parts.push(paragraphe(run("• " + libelleProcessus(p)), '<w:spacing w:after="40"/>')));
  });
  const ordre = [...CATEGORIES.flatMap((cat) => c.processus.filter((p) => p.categorie === cat)), ...c.processus.filter((p) => !p.categorie)];
  ordre.forEach((p) => parts.push(ficheProcessusXml(c, p)));
  return parts.join("");
}

function piedCartoXml() {
  const pet = `<w:sz w:val="15"/><w:szCs w:val="15"/><w:color w:val="${PIED}"/>`;
  return `${ENTETE_XML}<w:ftr xmlns:w="${NS_W}" xmlns:r="${NS_R}">` +
    paragraphe(`${run(t("carto.doc.titre") + " · ", pet)}${champ("PAGE", pet)}${run(" / ", pet)}${champ("NUMPAGES", pet)}`, '<w:jc w:val="center"/>') +
    "</w:ftr>";
}

// options : { png: Uint8Array | null, largeurPng, hauteurPng (pixels), echellePng (1 ou 2), maintenant: Date }
export function construireDocxCarto(cartographie, options = {}) {
  const opt = { png: null, largeurPng: 0, hauteurPng: 0, echellePng: 1, maintenant: new Date(), ...options };
  const c = cartographie || { processus: [], flux: [] };
  const avecImage = Boolean(opt.png) && opt.largeurPng > 0 && opt.hauteurPng > 0;
  const body = corpsCartoXml(c, { ...opt, png: avecImage ? opt.png : null });
  const xmlDocument = `${ENTETE_XML}<w:document xmlns:w="${NS_W}" xmlns:r="${NS_R}"><w:body>${body}${propriete("portrait")}</w:body></w:document>`;
  const fichiers = [
    { nom: "[Content_Types].xml", donnees: typesXml(false, null, true) },
    { nom: "_rels/.rels", donnees: RELS },
    { nom: "word/document.xml", donnees: xmlDocument },
    { nom: "word/styles.xml", donnees: stylesXml() },
    { nom: "word/settings.xml", donnees: SETTINGS },
    { nom: "word/footer1.xml", donnees: piedCartoXml() },
    { nom: "word/_rels/document.xml.rels", donnees: relsDocument(avecImage, false, null) },
    { nom: "docProps/core.xml", donnees: proprietesXml({ cartouche: { titre: t("carto.doc.titre") } }, opt.maintenant.toISOString().replace(/\.\d+Z$/, "Z")) },
  ];
  if (avecImage) fichiers.push({ nom: "word/media/logigramme.png", donnees: opt.png });
  return creerZip(fichiers, opt.maintenant);
}
