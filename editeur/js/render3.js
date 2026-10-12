// render3.js — le DESSIN d'une instruction de travail (niveau 3), comme la figure 7.7 du livre Qualigramme :
//   en-tête (logo, INSTRUCTION, code, version, date, auteur, titre, « 3 COMMENT ? »), un seul rôle en ovale,
//   trois colonnes — les opérations enchaînées de haut en bas | le plan d'auto-contrôle | les actions correctrices —,
//   légende en bas de page. Une page A4 portrait.
// Chaque opération a en face d'elle ses contrôles (rectangle + triangle Q/H/S/R/E) ; la réponse « non » d'un contrôle mène à
// une ou plusieurs actions correctives (rectangle + symbole recyclage). Pas de flèche entre une opération et son contrôle : ils
// sont sur la même ligne (comme dans le livre). Les symboles sont ceux du dessin niveau 2 (render.js).
// Règle d'or, comme au niveau 2 : AUCUN texte n'est coupé ; les formes grandissent, et le dessin est réduit pour tenir sur la page.
// Pas encore dessinés : les branches OU / ET en parallèle et les flèches de retour d'une corrective vers une opération.

import { t, langueCourante } from "./i18n.js";
import { formaterDate } from "./document.js";
import {
  couper as couperBrut, echapper, txt, r1, mesurerPanier, dessinerPanier, symboleRecyclage, cercleContrainte, mesurerRaccord, dessinerRaccord, flecheRaccord, ecartOblique, PENTE_RACCORD, placerCentre,
  SARCELLE, ROUGE, ENCRE, GRIS_TEXTE, GRIS_LIGNE, POLICE, PX, PX_GRAS, PX_G12, HAUT_LIGNE_12, LIGNE_ANNOTATION, pointsDe,
} from "./render.js";

// Coupe en lignes comme render.js ; en plus, une ponctuation haute (« ? », « : ») ne reste jamais seule sur une ligne : elle rejoint
// le mot qui la précède (« conformes ? » ne devient pas « conformes » puis « ? »).
function couper(texte, max) {
  return couperBrut(texte, max).reduce((acc, l) => {
    if (acc.length && /^[?!:;»%]$/.test(l)) acc[acc.length - 1] += " " + l;
    else acc.push(l);
    return acc;
  }, []);
}

// Page A4 portrait : 794 x 1123 px à 96 dpi, moins des marges de 40 px.
export const PAGE_INSTRUCTION = { largeur: 714, hauteur: 1040 };
const ECHELLE_MAX = 1.3;
export const SEUIL_PT_IT = 5.5; // même seuil de lisibilité que le niveau 2 (décision du projet, v0.12)

const LARGEUR = 714;
const CADRE = 8; // marge entre le bord du dessin et le cadre
// Les trois colonnes : [gauche, droite] ; centres des colonnes.
const C1 = [8, 338];
const C2 = [338, 552];
const C3 = [552, 706];
const CX1 = 175;
const CX2 = (C2[0] + C2[1]) / 2;
const CX3 = (C3[0] + C3[1]) / 2;
const OP_L = 160; // largeur d'une opération
const CT_L = 176; // largeur d'un contrôle
const CO_L = 128; // largeur d'une action corrective
const X_OUTILS = 12; // bord gauche de la zone des outils
const L_OUTIL = 68;
const X_BUS = 86; // trait vertical qui relie les outils à l'opération
const RECUL = 20; // hauteur du triangle / du symbole recyclage au-dessus d'un contrôle / d'une corrective
const PAD = 8;
const ECART_MIN = 26;
const R_SYMBOLE = 10; // rayon du cercle de Début / de Fin
const H_BARRE = 3.4; // épaisseur de la barre de Début / de Fin
const PX_10 = 5.7; // largeur moyenne d'un caractère en corps 10,5

const cacheCle = { cle: null, resultat: null };

// ---------- Formes ----------
// Outils (compacts : la zone à gauche de l'opération fait 68 px). Matériel = triangle et nom dessous ; document = rectangle ondulé.
function formeOutilIT(o) {
  const lignes = couper(o.nom, 11);
  if (o.type === "materiel") {
    const hTri = 26;
    const hauteur = hTri + 3 + lignes.length * 11.4;
    return {
      hauteur, yLien: hTri * 0.7,
      dessiner: (x, y) => `<polygon points="${r1(x + L_OUTIL / 2)},${r1(y)} ${r1(x + L_OUTIL / 2 + 15)},${r1(y + hTri)} ${r1(x + L_OUTIL / 2 - 15)},${r1(y + hTri)}" fill="#fff" stroke="${GRIS_TEXTE}" stroke-width="1.5"/>` +
        txt(lignes, x + L_OUTIL / 2, y + hTri + 3 + (lignes.length * 11.4) / 2, { taille: 9.5, italique: true, couleur: GRIS_TEXTE }),
    };
  }
  const hauteur = lignes.length * 11.4 + 18;
  return {
    hauteur, yLien: (hauteur - 6) / 2,
    dessiner: (x, y) => {
      const yb = y + hauteur - 6;
      return `<path d="M${x} ${y}H${x + L_OUTIL}V${r1(yb)}Q${r1(x + L_OUTIL * 0.75)} ${r1(yb - 7)} ${r1(x + L_OUTIL / 2)} ${r1(yb)}T${x} ${r1(yb)}Z" fill="#fff" stroke="${GRIS_TEXTE}" stroke-width="1.5"/>` +
        txt(lignes, x + L_OUTIL / 2, y + (hauteur - 6) / 2, { taille: 9.5, italique: true, couleur: GRIS_TEXTE });
    },
  };
}

// Petit carré numéroté à cheval sur le coin bas-droit d'une forme (la numérotation suit l'ordre de lecture : opération, ses contrôles, ses correctives).
function numero(x1, y1, n) {
  return `<rect x="${r1(x1 - 8)}" y="${r1(y1 - 8)}" width="13" height="13" fill="#fff" stroke="${GRIS_TEXTE}" stroke-width="1"/>` +
    `<text x="${r1(x1 - 1.5)}" y="${r1(y1 + 2)}" text-anchor="middle" font-size="8" fill="${GRIS_TEXTE}">${n}</text>`;
}

// Petit carré noir « document d'enregistrement », à cheval sur le coin bas-gauche.
const carreNoir = (x0, y1) => `<rect x="${r1(x0 - 4)}" y="${r1(y1 - 4)}" width="8" height="8" fill="${ENCRE}"/>`;

// Triangle de contrôle à cheval sur le coin haut-droit du rectangle (comme au niveau 2), avec la lettre de la nature.
function triangleControle(x1, y0, lettre) {
  const xt = x1 - 14;
  return `<polygon points="${r1(xt)},${r1(y0 - 19)} ${r1(xt + 13)},${r1(y0)} ${r1(xt - 13)},${r1(y0)}" fill="#fff" stroke="${SARCELLE}" stroke-width="2" stroke-linejoin="round"/>` +
    `<text x="${r1(xt)}" y="${r1(y0 - 3)}" text-anchor="middle" font-size="10" font-weight="700" fill="${SARCELLE}">${echapper(lettre)}</text>`;
}

// ---------- Mesure de l'instruction ----------
function mesurerOperation(op, k) {
  const lignes = couper(op.libelle.trim() || t("logigramme.sans_libelle"), Math.floor((OP_L - 14) / PX_G12));
  const hOp = Math.max(40, lignes.length * HAUT_LIGNE_12 + 14);
  const contrainte = op.contrainte.actif ? { lignes: couper(op.contrainte.texte.trim(), 12) } : null;
  const outils = op.outils.filter((o) => o.nom.trim()).map(formeOutilIT);
  const hOutils = outils.reduce((s, o) => s + o.hauteur, 0) + Math.max(0, outils.length - 1) * 8;
  const hContrainte = contrainte ? Math.max(20, contrainte.lignes.length * 12 + 8) : 0;

  const controles = op.controles.map((c, i) => {
    const l = couper(c.question.trim() || "?", Math.floor((CT_L - 14) / PX_10));
    return { c, i, lignes: l, hBox: Math.max(34, l.length * 12.6 + 14) };
  });
  const correctives = op.correctives.map((m, i) => {
    const l = couper(m.libelle.trim() || "?", Math.floor((CO_L - 14) / PX_10));
    const lr = m.renvoi.trim() ? couper("→ " + m.renvoi.trim(), Math.floor((CO_L - 14) / PX_10)) : [];
    return { m, i, lignes: l, renvoi: lr, hBox: Math.max(34, l.length * 12.6 + lr.length * 11.4 + 14), liees: [] };
  });
  // Les correctives sont dessinées dans l'ordre qui évite les croisements de flèches : selon la moyenne du rang de leurs contrôles.
  controles.forEach((ct) => ct.c.correctives.forEach((id) => {
    const co = correctives.find((x) => x.m.id === id);
    if (co) co.liees.push(ct.i);
  }));
  correctives.forEach((co) => { co.bary = co.liees.length ? co.liees.reduce((s, v) => s + v, 0) / co.liees.length : Infinity; });
  correctives.sort((a, b) => a.bary - b.bary || a.i - b.i);
  correctives.forEach((co, rang) => { co.rang = rang; });
  const aretes = [];
  controles.forEach((ct) => ct.c.correctives.forEach((id) => {
    const co = correctives.find((x) => x.m.id === id);
    if (co) aretes.push({ ci: ct.i, co });
  }));
  // Deux flèches « non » se croisent quand l'ordre de leurs contrôles est inverse de l'ordre de leurs correctives.
  let croisements = 0;
  for (let a = 0; a < aretes.length; a += 1) {
    for (let b = a + 1; b < aretes.length; b += 1) {
      if ((aretes[a].ci - aretes[b].ci) * (aretes[a].co.rang - aretes[b].co.rang) < 0) croisements += 1;
    }
  }

  const hControles = controles.reduce((s, c) => s + RECUL + c.hBox, 0) + Math.max(0, controles.length - 1) * 6;
  const hCorrectives = correctives.reduce((s, c) => s + RECUL + c.hBox, 0) + Math.max(0, correctives.length - 1) * 6;
  const hOpBloc = Math.max(hOp + Math.max(14, hContrainte / 2 + 4), hOutils);
  return { op, k, lignes, hOp, contrainte, outils, hOutils, controles, correctives, aretes, croisements, hControles, hCorrectives, hBande: Math.max(hOpBloc, hControles, hCorrectives) + 2 * PAD };
}

// Place les contrôles (empilés au centre de la bande) puis les correctives (au plus près de leurs contrôles) ; renvoie la hauteur de bande définitive.
function placerBande(b, yb) {
  let H = b.hBande;
  for (let essai = 0; essai < 4; essai += 1) {
    let s = yb + (H - b.hControles) / 2;
    b.controles.forEach((c) => {
      c.top = s + RECUL;
      c.centre = c.top + c.hBox / 2;
      s += RECUL + c.hBox + 6;
    });
    let bas = yb + PAD;
    b.correctives.forEach((co) => {
      const desire = co.liees.length ? co.liees.reduce((sum, i) => sum + b.controles[i].centre, 0) / co.liees.length : yb + H / 2;
      co.top = Math.max(desire - co.hBox / 2, bas + RECUL);
      bas = co.top + co.hBox + 6;
    });
    const fin = b.correctives.length ? bas - 6 : 0;
    if (fin <= yb + H - PAD) break;
    H = fin - yb + PAD;
  }
  return H;
}

// ---------- Construction ----------
function construire(p) {
  const ops = p.it.operations;
  if (ops.length === 0) return null;
  const m = p.meta;
  const N = ops.length;
  const gaucheMin = 12;
  const droiteMax = LARGEUR - 12;

  // Panier d'information de chaque flèche : 0 = du Début à la première opération, k = de l'opération k à la suivante, N = de la dernière à la Fin.
  const infoFleche = (k) => (k === 0 ? ops[0].entree : k === N ? ops[N - 1].sortie : ops[k - 1].sortie || ops[k].entree || "").trim();
  const panierFleche = (k) => { const i = infoFleche(k); return i ? mesurerPanier([], couper(i, 40)) : null; };
  const ecartPour = (panier) => Math.max(ECART_MIN, panier ? panier.h + 12 : 0);

  const bandes = ops.map((op, k) => mesurerOperation(op, k));

  // ----- En-tête -----
  const titre = (m.titre || "").trim().toLocaleUpperCase(langueCourante()) || t("doc.sans_titre").toLocaleUpperCase(langueCourante());
  const lignesTitre = couper(titre, 40);
  const auteur = ((m.signataires && m.signataires.redige && m.signataires.redige.nom) || "").trim(); // vide : la ligne reste à compléter à la main
  const lignesAuteur = couper(`${t("dessin3.auteur")} : ${auteur || "________"}`, 46);
  const lignesIssue = (m.issueDe || "").trim() ? couper(`${t("dessin3.issue_de")} : ${m.issueDe.trim()}`, 74) : [];
  const hTitre = lignesTitre.length * 17 + 10;
  const nomOrg = (m.organisation || "").trim();
  const logoOk = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(m.logo || "");
  const lignesOrg = nomOrg ? couper(nomOrg, logoOk ? 17 : 15) : [];
  const hGauche = logoOk ? CADRE + 4 + (nomOrg ? 44 : 60) + 4 + lignesOrg.length * 10.8 + 6 : CADRE * 2 + lignesOrg.length * 13;
  const hEntete = Math.ceil(Math.max(88, hGauche, CADRE + 24 + lignesAuteur.length * 13 + 4 + hTitre + lignesIssue.length * 11.5 + 6 + 2));

  // ----- Rôle : ovale en haut de la première colonne, colonnes 2 et 3 titrées sur la même ligne -----
  const role = (p.it.role.nom || "").trim() || t("dessin3.sans_role");
  const lignesRole = couper(role, 13);
  const ryRole = Math.max(15, (lignesRole.length * 14.4 + 10) / 2);
  const yRole = hEntete + 8 + ryRole;
  const hRole = ryRole * 2 + 8;
  const yBasRole = hEntete + 8 + hRole;

  // ----- Début (livre, §7.5.8) : « fait initial » AU-DESSUS, cercle posé sur la barre, la flèche part de la barre vers le bas.
  // Une action amont REMPLACE le Début (fig. 7.7) : sa barre est reliée à la première opération par une flèche oblique. -----
  const largeurRaccord = Math.min(droiteMax - gaucheMin, 320);
  const amont = mesurerRaccord(m.amont || {}, "amont", largeurRaccord);
  const aval = mesurerRaccord(m.aval || {}, "aval", largeurRaccord);
  const annoterCentre = (texte, x) => {
    const cars = Math.max(16, Math.min(LIGNE_ANNOTATION, Math.floor((droiteMax - gaucheMin - 8) / PX)));
    const lignes = couper(texte, cars);
    const largeurTexte = Math.max(...lignes.map((l) => l.length)) * PX + 8;
    return { lignes, haut: lignes.length * 12, xc: placerCentre(x, largeurTexte, gaucheMin, droiteMax) };
  };
  const texteDebut = (m.declencheur || "").trim() || t("logigramme.debut");
  const debut = { amont: null, ann: null, yTexte: 0, yBoite: 0, xBoite: 0, yCercle: 0, yBarre: 0, dx: 0, panier: panierFleche(0) };
  let yBasDebut;
  if (amont) {
    // Le panier de la flèche oblique est celui de l'information de l'action amont ; à défaut, l'entrée de la première opération.
    debut.amont = amont;
    debut.panier = amont.panier || debut.panier;
    debut.dx = Math.round(ecartOblique(debut.panier) * PENTE_RACCORD);
    debut.yBoite = yBasRole + 3;
    debut.xBoite = placerCentre(CX1 - debut.dx, amont.largeur, gaucheMin, droiteMax); // flèche oblique descendante : la barre est à gauche
    yBasDebut = debut.yBoite + amont.hauteur;
  } else {
    debut.ann = annoterCentre(texteDebut, CX1);
    debut.yTexte = yBasRole + 2 + debut.ann.haut / 2;
    debut.yCercle = yBasRole + 2 + debut.ann.haut + 3 + R_SYMBOLE;
    debut.yBarre = debut.yCercle + R_SYMBOLE; // la barre touche le bas du cercle
    yBasDebut = debut.yBarre + H_BARRE;
  }

  // ----- Positions verticales des bandes -----
  let yb = 0;
  const paniers = []; // panier de chaque flèche, avec son centre
  bandes.forEach((b, k) => {
    const panier = k === 0 ? debut.panier : panierFleche(k);
    const marge = (bandes[k].hBande - b.hOp) / 2; // place libre au-dessus de l'opération, dans sa bande
    if (k === 0) {
      const fleche = Math.max(amont ? ecartOblique(panier) : ecartPour(panier), marge + 6);
      b.yOp = yBasDebut + fleche + b.hOp / 2; // centre de l'opération
      b.yBande = b.yOp - b.hBande / 2;
    } else {
      const precedent = bandes[k - 1];
      const libre = (precedent.hBande - precedent.hOp) / 2 + marge; // flèche déjà disponible entre les deux opérations
      const ajout = Math.max(6, ecartPour(panier) - libre); // espace entre les deux bandes (au moins 6 px)
      b.yBande = precedent.yBande + precedent.hBande + ajout;
      b.yOp = b.yBande + b.hBande / 2;
    }
    // Le placement des contrôles et des correctives peut agrandir la bande (beaucoup de correctives) : on l'applique avant de passer à la suivante.
    const H = placerBande(b, b.yBande);
    if (H > b.hBande) { b.hBande = H; b.yOp = b.yBande + H / 2; }
    yb = b.yBande + b.hBande;
    paniers[k] = panier;
  });
  // Dernière flèche : de la dernière opération à la Fin (livre, §7.5.9 : la flèche arrive sur la barre, le cercle est DESSOUS, le fait
  // aval est écrit sous le cercle). Une action aval REMPLACE la Fin : tronc vertical jusqu'au bas de la bande, puis flèche oblique.
  const dernier = bandes[N - 1];
  const texteFin = (m.fin || "").trim() || t("logigramme.fin");
  const fin = { aval: null, ann: null, yTexte: 0, yBoite: 0, xBoite: 0, yBarre: 0, yCercle: 0, dx: 0, yQueue: 0, panier: panierFleche(N) };
  const basOperation = dernier.yOp + dernier.hOp / 2;
  const basBande = basOperation + (dernier.hBande - dernier.hOp) / 2;
  let yFinHaut;
  let yBasFin;
  if (aval) {
    fin.aval = aval;
    fin.panier = aval.panier || fin.panier; // l'information de l'action aval remplace la sortie de la dernière opération sur la flèche
    fin.dx = Math.round(ecartOblique(fin.panier) * PENTE_RACCORD);
    fin.yQueue = basBande;
    yFinHaut = basBande + ecartOblique(fin.panier);
    fin.yBoite = yFinHaut;
    fin.xBoite = placerCentre(CX1 + fin.dx, aval.largeur, gaucheMin, droiteMax); // flèche oblique descendante : la barre est à droite
    yBasFin = fin.yBoite + aval.hauteur + 8;
  } else {
    yFinHaut = basOperation + Math.max(ecartPour(fin.panier), (dernier.hBande - dernier.hOp) / 2 + 8);
    fin.ann = annoterCentre(texteFin, CX1);
    fin.yBarre = yFinHaut;
    fin.yCercle = yFinHaut + H_BARRE + R_SYMBOLE; // le cercle touche le bas de la barre
    fin.yTexte = fin.yCercle + R_SYMBOLE + 3 + fin.ann.haut / 2;
    yBasFin = fin.yCercle + R_SYMBOLE + 3 + fin.ann.haut + 6;
  }
  const yLegende = Math.ceil(yBasFin) + 8;
  const hLegende = 36;
  const hauteur = yLegende + hLegende + CADRE;

  // ----- Dessin -----
  const parts = [];
  parts.push(`<defs><marker id="fleche" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="${SARCELLE}"/></marker>` +
    `<marker id="flecheRouge" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="${ROUGE}"/></marker>` +
    `<marker id="flecheGrise" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L10 5L0 10z" fill="${GRIS_TEXTE}"/></marker>` +
    `<marker id="flechePetite" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L10 5L0 10z" fill="${SARCELLE}"/></marker></defs>`);
  parts.push(`<rect x="0" y="0" width="${LARGEUR}" height="${hauteur}" fill="#fff"/>`);

  // Cadre et en-tête.
  parts.push(`<rect x="${CADRE / 2}" y="${CADRE / 2}" width="${LARGEUR - CADRE}" height="${hauteur - CADRE}" fill="none" stroke="${ENCRE}" stroke-width="1.6"/>`);
  parts.push(`<line x1="${CADRE / 2}" y1="${hEntete}" x2="${LARGEUR - CADRE / 2}" y2="${hEntete}" stroke="${ENCRE}" stroke-width="1.4"/>`);
  if (logoOk) {
    parts.push(`<image x="14" y="${CADRE + 4}" width="92" height="${nomOrg ? 46 : 60}" preserveAspectRatio="xMidYMid meet" href="${m.logo}"/>`);
    if (nomOrg) parts.push(txt(lignesOrg, 60, CADRE + 4 + 44 + 4 + (lignesOrg.length * 10.8) / 2, { taille: 9, gras: true, couleur: GRIS_TEXTE }));
  } else if (nomOrg) {
    parts.push(txt(lignesOrg, 60, hEntete / 2, { taille: 11, gras: true, couleur: SARCELLE }));
  }
  const xTexte = 122;
  const xDroite = 552;
  parts.push(`<text x="${xTexte}" y="${CADRE + 17}" font-size="12" font-weight="700" fill="${ENCRE}">${echapper(t("dessin3.instruction"))}</text>`);
  const code = (m.reference || "").trim() || "IT ____";
  parts.push(`<rect x="${(xTexte + xDroite) / 2 - 42}" y="${CADRE + 3}" width="84" height="19" fill="#fff" stroke="${ENCRE}" stroke-width="1.2"/>`);
  parts.push(`<text x="${(xTexte + xDroite) / 2}" y="${CADRE + 17}" text-anchor="middle" font-size="12" font-weight="700" fill="${ENCRE}">${echapper(code)}</text>`);
  parts.push(`<text x="${xDroite}" y="${CADRE + 15}" text-anchor="end" font-size="11" font-weight="700" fill="${ENCRE}">${echapper(t("dessin3.version"))} ${echapper((m.version || "").trim() || "__")}</text>`);
  parts.push(`<text x="${xDroite}" y="${CADRE + 27}" text-anchor="end" font-size="10" font-weight="700" fill="${ENCRE}">${echapper(t("dessin3.date"))} ${echapper(m.dateApplication ? formaterDate(m.dateApplication) : "__/__/____")}</text>`);
  let yy = CADRE + 30;
  lignesAuteur.forEach((l) => { yy += 13; parts.push(`<text x="${xTexte}" y="${yy - 3}" font-size="11" font-weight="700" fill="${ENCRE}">${echapper(l)}</text>`); });
  yy += 4;
  parts.push(`<rect x="${xTexte - 4}" y="${yy}" width="${xDroite - xTexte + 8}" height="${hTitre}" fill="#EBE7F0" stroke="${GRIS_LIGNE}" stroke-width="1"/>`);
  lignesTitre.forEach((l, i) => parts.push(`<text x="${(xTexte + xDroite) / 2}" y="${r1(yy + 5 + 13 + i * 17)}" text-anchor="middle" font-size="14" font-weight="700" fill="${ENCRE}">${echapper(l)}</text>`));
  yy += hTitre;
  lignesIssue.forEach((l) => { yy += 11.5; parts.push(`<text x="${xTexte}" y="${r1(yy - 1)}" font-size="9" font-style="italic" fill="${GRIS_TEXTE}">${echapper(l)}</text>`); });
  // Icône « 3 — COMMENT ? » : triangle, cercle et question.
  const xi = 633;
  parts.push(`<polygon points="${xi},${CADRE + 2} ${xi + 34},${CADRE + 60} ${xi - 34},${CADRE + 60}" fill="#fff" stroke="${ENCRE}" stroke-width="1.6" stroke-linejoin="round"/>`);
  parts.push(`<circle cx="${xi}" cy="${CADRE + 40}" r="11" fill="${SARCELLE}"/><text x="${xi}" y="${CADRE + 45}" text-anchor="middle" font-size="14" font-weight="700" fill="#fff">3</text>`);
  parts.push(`<text x="${xi}" y="${CADRE + 72}" text-anchor="middle" font-size="9.5" font-weight="700" fill="${ENCRE}">${echapper(t("dessin3.comment"))}</text>`);

  // Séparations verticales en pointillé entre les trois colonnes, du titre des colonnes à la légende.
  [C2[0], C3[0]].forEach((x) => parts.push(`<line x1="${x}" y1="${hEntete + 6}" x2="${x}" y2="${yLegende - 2}" stroke="${GRIS_TEXTE}" stroke-width="1" stroke-dasharray="2 4"/>`));
  // Repères horizontaux en pointillé entre les lignes d'opérations.
  bandes.forEach((b, k) => {
    if (k === 0) return;
    const y = (bandes[k - 1].yBande + bandes[k - 1].hBande + b.yBande) / 2;
    parts.push(`<line x1="${CADRE}" y1="${r1(y)}" x2="${LARGEUR - CADRE}" y2="${r1(y)}" stroke="${GRIS_LIGNE}" stroke-width="1" stroke-dasharray="5 4"/>`);
  });

  // Rôle (ovale, un seul) ; titres des colonnes 2 et 3.
  parts.push(`<ellipse cx="${CX1}" cy="${r1(yRole)}" rx="72" ry="${r1(ryRole)}" fill="#fff" stroke="${SARCELLE}" stroke-width="2.2"/>`);
  parts.push(txt(lignesRole, CX1, yRole, { taille: 12, gras: true }));
  parts.push(txt([t("it.col.controles")], CX2, yRole, { taille: 12 }));
  parts.push(txt([t("it.col.correctives")], CX3, yRole, { taille: 12 }));

  // Début : « fait initial » au-dessus, cercle posé sur la barre ; avec une action amont, seule l'action amont est dessinée, à la place.
  if (amont) {
    parts.push(dessinerRaccord(amont, debut.xBoite, debut.yBoite, CX1 - debut.dx));
  } else {
    parts.push(txt(debut.ann.lignes, debut.ann.xc, debut.yTexte, { taille: 10, italique: true, couleur: GRIS_TEXTE }));
    parts.push(`<circle cx="${CX1}" cy="${r1(debut.yCercle)}" r="${R_SYMBOLE}" fill="#fff" stroke="${SARCELLE}" stroke-width="2.2"/>`);
    parts.push(`<rect x="${CX1 - 15}" y="${r1(debut.yBarre)}" width="30" height="${H_BARRE}" fill="${SARCELLE}"/>`);
  }

  // Flèches de la colonne 1 (paniers d'information posés dessus, après toutes les formes).
  const paniersDessines = [];
  const fleche = (yDe, yA, panier) => {
    parts.push(`<path d="M${CX1} ${r1(yDe)}V${r1(yA)}" fill="none" stroke="${SARCELLE}" stroke-width="1.8" marker-end="url(#fleche)"/>`);
    if (panier) paniersDessines.push(dessinerPanier(panier, CX1, (yDe + yA) / 2));
  };
  if (amont) parts.push(flecheRaccord({ panier: debut.panier }, CX1 - debut.dx, yBasDebut, CX1, bandes[0].yOp - bandes[0].hOp / 2 - 0.5)); // oblique, panier de l'action amont
  else fleche(yBasDebut, bandes[0].yOp - bandes[0].hOp / 2, paniers[0]);
  bandes.forEach((b, k) => {
    if (k > 0) fleche(bandes[k - 1].yOp + bandes[k - 1].hOp / 2, b.yOp - b.hOp / 2, paniers[k]);
  });
  if (aval) {
    // Dernière opération → action aval : tronc vertical jusqu'au bas de la bande, puis flèche oblique sur la barre de l'action aval.
    if (fin.yQueue > basOperation) parts.push(`<path d="M${CX1} ${r1(basOperation)}V${r1(fin.yQueue)}" fill="none" stroke="${SARCELLE}" stroke-width="1.8"/>`);
    parts.push(flecheRaccord({ panier: fin.panier }, CX1, fin.yQueue, CX1 + fin.dx, yFinHaut - 0.5));
  } else fleche(basOperation, yFinHaut, fin.panier);

  // Numérotation continue : opération, puis ses contrôles, puis ses correctives.
  let n = 0;
  let croisements = 0;
  bandes.forEach((b) => {
    croisements += b.croisements;
    const x0 = CX1 - OP_L / 2;
    const x1 = CX1 + OP_L / 2;
    const y0 = b.yOp - b.hOp / 2;
    const y1 = b.yOp + b.hOp / 2;
    // Opération.
    parts.push(`<rect x="${x0}" y="${r1(y0)}" width="${OP_L}" height="${r1(b.hOp)}" fill="#fff" stroke="${SARCELLE}" stroke-width="2.4"/>`);
    parts.push(txt(b.lignes, CX1, b.yOp, { taille: 12, gras: true }));
    n += 1;
    parts.push(numero(x1, y1, n));
    if (b.op.enregistrement) parts.push(carreNoir(x0, y1));
    if (b.contrainte) {
      const xc = x1 - 4;
      parts.push(cercleContrainte(r1(xc), r1(y0)));
      if (b.contrainte.lignes.length) parts.push(txt(b.contrainte.lignes, xc + 15, y0 - 2 - b.contrainte.lignes.length * 6 + 4, { taille: 10, gras: true, couleur: SARCELLE, ancre: "start" }));
    }
    // Outils : zone de gauche, reliés à l'opération par un trait en pointillé.
    if (b.outils.length) {
      let y = b.yOp - b.hOutils / 2;
      const centres = [];
      b.outils.forEach((o) => {
        parts.push(o.dessiner(X_OUTILS, y));
        centres.push(y + o.yLien);
        y += o.hauteur + 8;
      });
      const pointille = `stroke="${GRIS_TEXTE}" stroke-width="1.3" stroke-dasharray="4 3" fill="none"`;
      const ys = [b.yOp, ...centres];
      parts.push(`<path d="M${X_BUS} ${r1(b.yOp)}H${x0}" ${pointille} marker-end="url(#flecheGrise)"/>`);
      parts.push(`<line x1="${X_BUS}" y1="${r1(Math.min(...ys))}" x2="${X_BUS}" y2="${r1(Math.max(...ys))}" ${pointille}/>`);
      centres.forEach((c) => parts.push(`<line x1="${X_OUTILS + L_OUTIL}" y1="${r1(c)}" x2="${X_BUS}" y2="${r1(c)}" ${pointille}/>`));
    }
    // Contrôles : rectangle, triangle avec la lettre, question.
    const cx0 = CX2 - CT_L / 2;
    const cx1 = CX2 + CT_L / 2;
    b.controles.forEach((c) => {
      parts.push(`<rect x="${r1(cx0)}" y="${r1(c.top)}" width="${CT_L}" height="${r1(c.hBox)}" fill="#fff" stroke="${SARCELLE}" stroke-width="2"/>`);
      parts.push(txt(c.lignes, CX2, c.centre, { taille: 10.5 }));
      parts.push(triangleControle(cx1, c.top, c.c.nature || "?"));
      n += 1;
      parts.push(numero(cx1, c.top + c.hBox, n));
      if (c.c.enregistrement) parts.push(carreNoir(cx0, c.top + c.hBox));
    });
    // Actions correctives : rectangle, symbole recyclage, libellé (et renvoi en bleu italique).
    const ko0 = CX3 - CO_L / 2;
    const ko1 = CX3 + CO_L / 2;
    b.correctives.forEach((co) => {
      co.centre = co.top + co.hBox / 2;
      parts.push(`<rect x="${r1(ko0)}" y="${r1(co.top)}" width="${CO_L}" height="${r1(co.hBox)}" fill="#fff" stroke="${SARCELLE}" stroke-width="2"/>`);
      const hTexte = co.lignes.length * 12.6;
      const hRenvoi = co.renvoi.length * 11.4;
      const yTexte = co.top + (co.hBox - hTexte - hRenvoi) / 2 + hTexte / 2;
      parts.push(txt(co.lignes, CX3, yTexte, { taille: 10.5 }));
      if (co.renvoi.length) parts.push(txt(co.renvoi, CX3, yTexte + hTexte / 2 + 2 + hRenvoi / 2, { taille: 9.5, italique: true, couleur: SARCELLE }));
      parts.push(symboleRecyclage(r1(ko1 - 14), r1(co.top)));
    });
    b.correctives.forEach((co) => { n += 1; parts.push(numero(ko1, co.top + co.hBox, n)); });
    // Flèches « non » : du contrôle à chaque action corrective ; un contrôle sans corrective montre un « ? » en rouge.
    const xm = cx1 + (ko0 - cx1) / 2;
    b.controles.forEach((c) => {
      const cibles = b.aretes.filter((a) => a.ci === c.i);
      if (cibles.length === 0) {
        parts.push(`<path d="M${r1(cx1)} ${r1(c.centre)}H${r1(cx1 + 20)}" fill="none" stroke="${ROUGE}" stroke-width="1.8" stroke-dasharray="4 3"/>`);
        parts.push(`<text x="${r1(cx1 + 24)}" y="${r1(c.centre + 4)}" font-size="11" font-weight="700" fill="${ROUGE}">?</text>`);
        return;
      }
      cibles.forEach((a) => {
        // Point d'arrivée sur le bord gauche de la corrective : réparti selon les contrôles qui y mènent (dans l'ordre de leurs rangs).
        const arrivants = b.aretes.filter((x) => x.co === a.co).map((x) => x.ci).sort((u, v) => u - v);
        const yArr = a.co.top + a.co.hBox * ((arrivants.indexOf(a.ci) + 1) / (arrivants.length + 1));
        const chemin = Math.abs(yArr - c.centre) < 1 ? `M${r1(cx1)} ${r1(c.centre)}H${r1(ko0)}` : `M${r1(cx1)} ${r1(c.centre)}H${r1(xm)}L${r1(ko0)} ${r1(yArr)}`;
        parts.push(`<path d="${chemin}" fill="none" stroke="${SARCELLE}" stroke-width="1.8" stroke-linejoin="round" marker-end="url(#fleche)"/>`);
        parts.push(`<text x="${r1((cx1 + xm) / 2)}" y="${r1(c.centre - 3)}" text-anchor="middle" font-size="9" fill="${ENCRE}">${echapper(t("dessin3.non"))}</text>`);
      });
    });
  });
  paniersDessines.forEach((s) => parts.push(s));

  // Fin : la flèche arrive sur la barre, le cercle est dessous, puis le fait aval ; avec une action aval, seule elle est dessinée, à la place.
  if (aval) {
    parts.push(dessinerRaccord(aval, fin.xBoite, fin.yBoite, CX1 + fin.dx));
  } else {
    parts.push(`<rect x="${CX1 - 15}" y="${r1(fin.yBarre)}" width="30" height="${H_BARRE}" fill="${SARCELLE}"/>`);
    parts.push(`<circle cx="${CX1}" cy="${r1(fin.yCercle)}" r="${R_SYMBOLE}" fill="#fff" stroke="${SARCELLE}" stroke-width="2.2"/>`);
    parts.push(txt(fin.ann.lignes, fin.ann.xc, fin.yTexte, { taille: 10, italique: true, couleur: GRIS_TEXTE }));
  }

  parts.push(legende(yLegende, hLegende));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" font-family="${POLICE}" width="${LARGEUR}" height="${Math.ceil(hauteur)}" viewBox="0 0 ${LARGEUR} ${Math.ceil(hauteur)}" role="img">${parts.join("")}</svg>`;
  return { svg, largeur: LARGEUR, hauteur: Math.ceil(hauteur), croisements };
}

// Légende « INSTRUCTION (Niv. 3) » : une ligne de petits symboles avec leur nom, en bas de page.
function legende(y, h) {
  const yc = y + 13;
  const s = [`<line x1="${CADRE / 2}" y1="${r1(y)}" x2="${LARGEUR - CADRE / 2}" y2="${r1(y)}" stroke="${ENCRE}" stroke-width="1.2"/>`];
  s.push(txt([t("dessin3.legende")], 14, y + h / 2, { taille: 8.5, gras: true, ancre: "start" }));
  let x = 124;
  const nom = (texte, cx) => txt([texte], cx, y + h - 7, { taille: 8, couleur: GRIS_TEXTE });
  const item = (largeur, dessin, texte) => { s.push(dessin(x + largeur / 2)); s.push(nom(texte, x + largeur / 2)); x += largeur; };
  // Petite flèche oblique descendante de (x1, y1) à (x2, y2), pointe pleine (les marqueurs de flèche seraient trop grands ici).
  const miniFleche = (x1, y1, x2, y2) => {
    const d = Math.hypot(x2 - x1, y2 - y1);
    const ux = (x2 - x1) / d;
    const uy = (y2 - y1) / d;
    const bx = x2 - ux * 5;
    const by = y2 - uy * 5;
    return `<line x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(bx)}" y2="${r1(by)}" stroke="${SARCELLE}" stroke-width="1.4"/>` +
      `<polygon points="${r1(x2)},${r1(y2)} ${r1(bx - uy * 2.6)},${r1(by + ux * 2.6)} ${r1(bx + uy * 2.6)},${r1(by - ux * 2.6)}" fill="${SARCELLE}"/>`;
  };
  item(44, (c) => `<ellipse cx="${c}" cy="${yc}" rx="17" ry="7" fill="#fff" stroke="${SARCELLE}" stroke-width="1.6"/>`, t("dessin3.leg.role"));
  item(52, (c) => `<rect x="${c - 17}" y="${yc - 7}" width="34" height="14" fill="#fff" stroke="${SARCELLE}" stroke-width="1.8"/>`, t("dessin3.leg.operation"));
  item(56, (c) => `<path d="M${c - 16} ${yc - 6}V${yc + 2}Q${c - 16} ${yc + 7} ${c - 10} ${yc + 7}H${c + 10}Q${c + 16} ${yc + 7} ${c + 16} ${yc + 2}V${yc - 6}" fill="none" stroke="${SARCELLE}" stroke-width="1.4"/>`, t("dessin3.leg.information"));
  // Action amont : la barre (texte au-dessus) puis la flèche d'information oblique descendante ; action aval : la flèche arrive sur la barre.
  item(62, (c) => `<line x1="${c - 15}" y1="${yc - 6}" x2="${c + 15}" y2="${yc - 6}" stroke="${SARCELLE}" stroke-width="2"/>${miniFleche(c - 4, yc - 6, c + 5, yc + 8)}`, t("dessin3.leg.amont"));
  item(58, (c) => `<line x1="${c - 15}" y1="${yc + 6}" x2="${c + 15}" y2="${yc + 6}" stroke="${SARCELLE}" stroke-width="2"/>${miniFleche(c - 6, yc - 8, c + 3, yc + 5)}`, t("dessin3.leg.aval"));
  item(52, (c) => `<path d="M${c - 16} ${yc - 7}H${c + 16}V${yc + 3}Q${c + 8} ${yc - 3} ${c} ${yc + 3}T${c - 16} ${yc + 3}Z" fill="#fff" stroke="${GRIS_TEXTE}" stroke-width="1.4"/>`, t("dessin3.leg.document"));
  item(38, (c) => `<polygon points="${c},${yc - 8} ${c + 10},${yc + 7} ${c - 10},${yc + 7}" fill="#fff" stroke="${GRIS_TEXTE}" stroke-width="1.4"/>`, t("dessin3.leg.outil"));
  item(52, (c) => `<polygon points="${c},${yc - 8} ${c + 10},${yc + 7} ${c - 10},${yc + 7}" fill="#fff" stroke="${SARCELLE}" stroke-width="1.6"/><text x="${c}" y="${yc + 5}" text-anchor="middle" font-size="8" font-weight="700" fill="${SARCELLE}">Q</text>`, t("dessin3.leg.controle"));
  item(54, (c) => symboleRecyclage(c, yc + 8), t("dessin3.leg.corrective"));
  item(54, (c) => `<circle cx="${c}" cy="${yc}" r="8" fill="#fff" stroke="${SARCELLE}" stroke-width="1.5"/><text x="${c}" y="${yc + 4.5}" text-anchor="middle" font-size="12" font-weight="700" fill="${SARCELLE}">+</text>`, t("dessin3.leg.contrainte"));
  item(52, (c) => `<rect x="${c - 4}" y="${yc - 4}" width="8" height="8" fill="${ENCRE}"/>`, t("dessin3.leg.enregistrement"));
  return s.join("");
}

// ---------- Résultat mis en mémoire (calculé une seule fois tant que rien de visible ne change) ----------
function resultat(p) {
  const cle = JSON.stringify([langueCourante(), { ...p.meta, logo: (p.meta.logo || "").length, revisions: 0 }, p.it]);
  if (cle !== cacheCle.cle) {
    cacheCle.resultat = construire(p);
    cacheCle.cle = cle;
  }
  return cacheCle.resultat;
}

export function dessinerNiveau3(p) {
  const r = resultat(p);
  return r ? r.svg : "";
}

export function mesurerNiveau3(p) {
  const r = resultat(p);
  return r ? { largeur: r.largeur, hauteur: r.hauteur } : null;
}

// Échelle du dessin sur la page A4 portrait (jamais agrandi au-delà de 1,3) et taille finale en pixels.
export function disposerNiveau3(p) {
  const r = resultat(p);
  if (!r) return null;
  const echelle = Math.min(PAGE_INSTRUCTION.largeur / r.largeur, PAGE_INSTRUCTION.hauteur / r.hauteur, ECHELLE_MAX);
  return { orientation: "portrait", echelle, largeur: r.largeur * echelle, hauteur: r.hauteur * echelle };
}

// Taille réelle du texte le plus petit courant (10 px dans le dessin), en points, une fois le dessin réduit pour tenir sur A4.
export function taillePointsNiveau3(p) {
  const d = disposerNiveau3(p);
  return d ? Math.round(pointsDe(d.echelle) * 10) / 10 : null;
}

// Nombre de croisements entre les flèches « non » (le langage demande de ne jamais croiser les flèches).
export function croisementsNiveau3(p) {
  const r = resultat(p);
  return r ? r.croisements : 0;
}
