// carto-dessin.js — le MOTEUR DE DESSIN de la cartographie des processus (niveau 1), rendu « style 09 » (fond blanc épuré, charte ISOPEX).
// Dessine les 4 bandes (management, réalisation, support, surveillance & mesure), un nombre VARIABLE de processus par bande, les pods
// Exigences / Satisfaction, le bandeau Contexte et les flèches structurelles. Le texte saisi est échappé (escapeXML) : aucune injection.
//
//   disposer(c)            -> géométrie complète { W, H, bandes[], pods, contexte, fleches }   (pur, testable sous Node)
//   planCartographie(c)    -> résumé léger { W, H, bandes:[{categorie,nb,codes}], surveillance } (pour les tests)
//   svgCartographie(c)     -> une chaîne SVG complète (affichage et export)
//
// Aucune dépendance au navigateur : disposer() et svgCartographie() tournent sous Node.

import { t } from "./i18n.js";
import { CATEGORIES, processusParCategorie, libelleProcessus } from "./cartographie.js";

const W = 1600;
const COULEURS = { management: "#005A70", realisation: "#1F8AA6", support: "#6F5091", verification: "#3F5E8C", "": "#6A7780" };
const INK = "#1f2a30", MUTED = "#6a7780", TITRE = "#005a70", TRAIT = "#d9d2e6", LAVANDE = "#f6f4f9";
const FONT = "Outfit, Arial, sans-serif";

const BANDE_X = 175, BANDE_W = 1260;      // emprise des bandes
const CARTE_X = 248, CARTE_W = 378;        // première colonne de cartes et largeur d'une carte
const COL_GAP = 18, CARTE_H = 64, LIGNE_GAP = 14, COLS = 3;
const PAD = 16;                            // marge intérieure haut/bas d'une bande
const BANDE_GAP = 26;                      // espace entre deux bandes
const Y_BANDES = 186;                      // haut de la première bande

// Libellés des flèches structurelles entre deux bandes adjacentes (selon la paire de catégories réellement dessinées).
const FLECHES_ENTRE = {
  "management|realisation": ["Orientations, objectifs", "Performance, écarts"],
  "management|support": ["Cadre, moyens", "Besoins, alertes"],
  "management|verification": ["Objectifs à surveiller", "Résultats de surveillance"],
  "realisation|support": ["Besoins en ressources", "Moyens, support"],
  "realisation|verification": ["Données à surveiller", "Résultats, écarts"],
  "support|verification": ["Activités à surveiller", "Résultats de surveillance"],
};

function escapeXML(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
}

// Coupe un libellé en lignes (longueur approximative en caractères), au plus maxLignes.
function couper(nom, maxCar, maxLignes = 2) {
  const mots = String(nom || "").split(/\s+/).filter(Boolean);
  const lignes = [];
  let cur = "";
  for (const m of mots) {
    if ((cur + " " + m).trim().length <= maxCar) cur = (cur + " " + m).trim();
    else { if (cur) lignes.push(cur); cur = m; }
  }
  if (cur) lignes.push(cur);
  return lignes.slice(0, maxLignes);
}

// ---------- Géométrie (pur) ----------
export function disposer(c) {
  const groupes = processusParCategorie(c || { processus: [] });   // [{ categorie, processus[] }] dans l'ordre, catégories non vides
  const bandes = [];
  let y = Y_BANDES;
  for (const g of groupes) {
    const n = g.processus.length;
    const lignes = Math.max(1, Math.ceil(n / COLS));
    const corps = lignes * CARTE_H + (lignes - 1) * LIGNE_GAP;
    const h = Math.max(90, PAD + corps + PAD);
    const couleur = COULEURS[g.categorie] || COULEURS[""];
    const AIRE_W = COLS * CARTE_W + (COLS - 1) * COL_GAP;   // largeur d'un rang plein ; chaque rang est centré dans cette aire
    const cartes = g.processus.map((p, i) => {
      const col = i % COLS, lig = Math.floor(i / COLS);
      const surCeRang = Math.min(COLS, n - lig * COLS);     // nombre de cartes sur ce rang
      const rangW = surCeRang * CARTE_W + (surCeRang - 1) * COL_GAP;
      const depart = CARTE_X + (AIRE_W - rangW) / 2;        // rang centré horizontalement
      const x = depart + col * (CARTE_W + COL_GAP);
      const cy = y + PAD + lig * (CARTE_H + LIGNE_GAP);
      return { id: p.id, code: p.code, nom: p.nom || "", couleur, x, y: cy, w: CARTE_W, h: CARTE_H, cx: x + CARTE_W / 2, cyc: cy + CARTE_H / 2 };
    });
    bandes.push({ categorie: g.categorie, couleur, x: BANDE_X, y, w: BANDE_W, h, cartes, milieu: y + h / 2 });
    y += h + BANDE_GAP;
  }
  const bas = bandes.length ? bandes[bandes.length - 1].y + bandes[bandes.length - 1].h : Y_BANDES + 90;
  const H = bas + 40;
  const haut = bandes.length ? bandes[0].y : Y_BANDES;

  // Flèches structurelles entre bandes adjacentes
  const fleches = [];
  for (let i = 0; i < bandes.length - 1; i += 1) {
    const a = bandes[i], b = bandes[i + 1];
    if (!a.categorie || !b.categorie) continue;
    const paire = FLECHES_ENTRE[`${a.categorie}|${b.categorie}`] || ["", ""];
    const yEntre = (a.y + a.h + b.y) / 2;
    fleches.push({ type: "bas", x: 520, y1: a.y + a.h, y2: b.y, label: paire[0], ly: yEntre });
    fleches.push({ type: "haut", x: 1120, y1: b.y, y2: a.y + a.h, label: paire[1], ly: yEntre });
  }
  return { W, H, haut, bas, bandes, groupes, fleches };
}

export function planCartographie(c) {
  const d = disposer(c);
  return {
    W: d.W, H: d.H,
    bandes: d.bandes.map((b) => ({ categorie: b.categorie, nb: b.cartes.length, codes: b.cartes.map((x) => x.code) })),
    surveillance: d.bandes.some((b) => b.categorie === "verification"),
  };
}

// ---------- Rendu SVG (chaîne) ----------
export function svgCartographie(c) {
  const d = disposer(c);
  const carto = c || {};
  const o = [];
  const R = (x, y, w, h, r, fill, stroke = "none", sw = 0, extra = "") =>
    o.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" ${extra}/>`);
  const T = (x, y, s, sz, fill, w = "400", a = "start", it = false) =>
    o.push(`<text x="${x}" y="${y}" font-family="${FONT}" font-size="${sz}" font-weight="${w}" fill="${fill}" text-anchor="${a}"${it ? ' font-style="italic"' : ""}>${escapeXML(s)}</text>`);
  const fleche = (x1, y1, x2, y2, col, dbl = false, sw = 3) =>
    o.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${col}" stroke-width="${sw}" marker-end="url(#ae)"${dbl ? ' marker-start="url(#as)"' : ""}/>`);

  o.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${d.W}" height="${d.H}" viewBox="0 0 ${d.W} ${d.H}">`);
  o.push('<defs>'
    + '<marker id="ae" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M0 0L9 4.5L0 9z" fill="context-stroke"/></marker>'
    + '<marker id="as" markerWidth="9" markerHeight="9" refX="2" refY="4.5" orient="auto"><path d="M9 0L0 4.5L9 9z" fill="context-stroke"/></marker>'
    + '<filter id="sh" x="-6%" y="-6%" width="112%" height="124%"><feDropShadow dx="0" dy="1.5" stdDeviation="2.5" flood-color="#5b4a78" flood-opacity="0.18"/></filter></defs>');
  R(0, 0, d.W, d.H, 0, "#ffffff");

  // En-tête
  R(40, 26, 150, 70, 10, "transparent", "#b9b0cc", 1.6, 'stroke-dasharray="6 5"');
  T(115, 66, "[ Logo ]", 14, "#9a8fb3", "600", "middle");
  T(d.W / 2, 58, (carto.titre || t("carto.titre")).toUpperCase(), 34, TITRE, "800", "middle");
  T(d.W / 2, 88, carto.organisation || "[ Nom de l'organisation ]", 18, MUTED, "600", "middle", true);

  // Contexte
  R(40, 118, d.W - 80, 46, 23, "#eef4f5");
  T(70, 147, "CONTEXTE", 15, TITRE, "800");
  T(190, 147, carto.contexte || "Enjeux internes et externes · parties intéressées · réglementation · changements climatiques", 14, INK, "400");

  // Pods latéraux (s'étendent sur toutes les bandes) — sous-texte réparti sur plusieurs lignes, centré
  const podY = d.haut, podH = d.bas - d.haut;
  const podMid = podY + podH / 2;
  const pod = (cx, titre, tsz, texte, col) => {
    const lignes = couper(texte, 14, 5);
    const total = 22 + lignes.length * 16;
    const top = podMid - total / 2;
    T(cx, top + 16, titre, tsz, "#fff", "800", "middle");
    lignes.forEach((l, i) => T(cx, top + 36 + i * 16, l, 11, col, "400", "middle"));
  };
  R(40, podY, 110, podH, 24, TITRE);
  o.push(`<circle cx="95" cy="${podY + 46}" r="30" fill="#ffffff"/>`);
  pod(95, "EXIGENCES", 16, carto.exigences || "Besoins et attentes des parties intéressées", "#eaf2fb");
  R(1450, podY, 110, podH, 24, "#6f5091");
  o.push(`<circle cx="1505" cy="${podY + 46}" r="30" fill="#ffffff"/>`);
  pod(1505, "SATISFACTION", 15, carto.satisfaction || "Exigences des clients et des parties intéressées", "#fdeed3");

  // Diamant Contexte ⇄ première bande
  if (d.bandes.length) {
    const yb = d.bandes[0].y;
    o.push(`<path d="M760 ${yb - 34} l12 16 l-12 16 l-12 -16 z" fill="${TITRE}"/>`);
    fleche(760, yb - 18, 760, yb - 2, TITRE, true);
    T(786, yb - 14, "Enjeux, risques et opportunités ⇄ orientations", 12, MUTED, "400", "start", true);
  }

  // Bandes + cartes
  for (const b of d.bandes) {
    R(b.x, b.y, b.w, b.h, 18, (b.couleur + "14"));
    R(b.x + 8, b.y + 8, 14, b.h - 16, 7, b.couleur);   // épine de couleur
    T(b.x + 2, b.y - 8, t("carto.categorie." + (b.categorie || "aucune")).toUpperCase(), 13, b.couleur, "800");
    // chaîne réalisation : flèche entre cartes consécutives d'une même ligne
    for (const carte of b.cartes) {
      R(carte.x, carte.y, carte.w, carte.h, 14, "#ffffff", TRAIT, 1.1, 'filter="url(#sh)"');
      const br = 19, bx = carte.x + 22 + br, by = carte.cyc;
      o.push(`<circle cx="${bx}" cy="${by}" r="${br}" fill="${carte.couleur}"/>`);
      o.push(`<rect x="${bx - br * 0.4}" y="${by - br * 0.4}" width="${br * 0.8}" height="${br * 0.8}" rx="${br * 0.22}" fill="#fff" opacity="0.92"/>`);
      const tx = bx + br + 12;
      const lignes = couper(carte.nom, 34);
      const rangs = 1 + lignes.length;           // ligne du code + lignes du nom
      const rowH = 19;
      const base = by - ((rangs - 1) * rowH) / 2 + 6;   // bloc centré verticalement sur le centre de la carte (= centre de la bulle)
      const nsz = lignes.length > 1 ? 13 : 14;
      T(tx, base, carte.code, 17, carte.couleur, "800");
      lignes.forEach((l, i) => T(tx, base + (i + 1) * rowH, l, nsz, INK, "400"));
    }
    if (b.categorie === "realisation") {
      for (let i = 0; i < b.cartes.length - 1; i += 1) {
        const a = b.cartes[i], n = b.cartes[i + 1];
        if (Math.abs(a.cyc - n.cyc) < 2 && n.x > a.x) fleche(a.x + a.w + 3, a.cyc, n.x - 3, n.cyc, "#005a70");
      }
    }
    // pods ⇄ bande
    fleche(150, b.milieu, b.x, b.milieu, TITRE, true);
    fleche(b.x + b.w, b.milieu, 1450, b.milieu, "#6f5091", true);
  }

  // Flèches structurelles entre bandes
  for (const f of d.fleches) {
    fleche(f.x, f.y1, f.x, f.y2, TITRE);
    if (f.label) T(f.x + (f.type === "bas" ? 18 : -10), f.ly + 4, f.label, 12, MUTED, "400", f.type === "bas" ? "start" : "end", true);
  }

  o.push("</svg>");
  return o.join("\n");
}

export { couper as _couper };
