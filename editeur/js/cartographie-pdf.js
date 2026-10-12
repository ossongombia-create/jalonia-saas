// cartographie-pdf.js — LIRE une cartographie des processus au format PDF.
//
// Deux temps, séparés pour pouvoir tester le second sans PDF :
//   1. lireMisePdf(octets)  : ouvre le PDF avec pdf.js (bibliothèque de Mozilla, dans vendor/pdfjs, chargée seulement ici) et en tire
//                             une « mise en page » : les textes (avec leur position) et les formes remplies (cadres, flèches).
//   2. interpreter(mise)    : devine, d'après la position des textes et des formes, les processus (code + nom + catégorie),
//                             les échanges (flèches et leur texte) et les textes de la cartographie. Fonction pure.
//
// La lecture est une AIDE : le résultat est toujours montré à l'utilisateur, qui le corrige. Un PDF numérisé (image) n'a pas de
// texte à lire : on le dit. Coordonnées : origine en haut à gauche, y vers le bas, en points (1/72 pouce).

import { CATEGORIES, FORMAT_CODE_PROCESSUS, nettoyerCartographie, nouvelleCartographie } from "./cartographie.js";
import { nouvelId } from "./model.js";

const PAGES_MAX = 3;
const FORMES_MAX = 4000;

// ---------- 1. Lecture du PDF (pdf.js) ----------
let pdfjsPromesse = null;
function chargerPdfjs() {
  if (!pdfjsPromesse) {
    pdfjsPromesse = import("../vendor/pdfjs/pdf.min.js").then((mod) => {
      // pdf.js travaille dans un « worker » (un fichier à part, chargé une seule fois) : on lui indique où il se trouve.
      mod.GlobalWorkerOptions.workerSrc = new URL("../vendor/pdfjs/pdf.worker.min.js", import.meta.url).href;
      return mod;
    });
  }
  return pdfjsPromesse;
}

const multiplier = (a, b) => [
  a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
];
const appliquer = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

async function miseDePage(page, OPS) {
  const vue = page.getViewport({ scale: 1 });
  const H = vue.height;
  const mise = { largeur: vue.width, hauteur: H, textes: [], formes: [] };
  const contenu = await page.getTextContent();
  for (const it of contenu.items) {
    if (typeof it.str !== "string" || it.str === "" || !it.transform) continue;
    const [a, b, c, d, e, f] = it.transform;
    const taille = Math.hypot(a, b) || Math.hypot(c, d) || 10;
    const dx = a / taille, dy = b / taille; // sens de lecture
    const nx = -dy, ny = dx; // « vers le haut » des lettres
    const longueur = Math.max(it.width || 0, 0);
    const pts = [[e, f], [e + dx * longueur, f + dy * longueur], [e + nx * taille * 0.8, f + ny * taille * 0.8], [e + dx * longueur + nx * taille * 0.8, f + dy * longueur + ny * taille * 0.8]]
      .map(([x, y]) => [x, H - y]);
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    mise.textes.push({
      s: it.str, taille,
      vertical: Math.abs(dy) > 0.7,
      bb: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
    });
  }
  // Formes remplies : on suit la matrice de transformation (CTM) et la couleur de remplissage.
  const ops = await page.getOperatorList();
  let ctm = [1, 0, 0, 1, 0, 0];
  let couleur = "";
  const pile = [];
  const REMPLIR = new Set([OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke].filter((x) => x !== undefined));
  for (let i = 0; i < ops.fnArray.length && mise.formes.length < FORMES_MAX; i += 1) {
    const f = ops.fnArray[i];
    const a = ops.argsArray[i];
    if (f === OPS.save) pile.push([ctm, couleur]);
    else if (f === OPS.restore) { const e = pile.pop(); if (e) [ctm, couleur] = e; }
    else if (f === OPS.transform && Array.isArray(a)) ctm = multiplier(ctm, a);
    else if (f === OPS.setFillRGBColor && typeof a[0] === "string") couleur = a[0];
    else if (f === OPS.constructPath && Array.isArray(a) && REMPLIR.has(a[0]) && Array.isArray(a[1]) && a[1][0]) {
      const d = a[1][0];
      const pts = [];
      let courbes = false;
      for (let k = 0; k < d.length;) {
        const code = d[k]; k += 1;
        if (code === 0 || code === 1) { pts.push(appliquer(ctm, d[k], d[k + 1])); k += 2; }
        else if (code === 2) { courbes = true; pts.push(appliquer(ctm, d[k + 4], d[k + 5])); k += 6; }
        else if (code === 3) { courbes = true; pts.push(appliquer(ctm, d[k + 2], d[k + 3])); k += 4; }
        else if (code === 4) { /* fermeture */ } else break;
      }
      if (pts.length < 3) continue;
      const p = pts.map(([x, y]) => [x, H - y]);
      const xs = p.map((q) => q[0]);
      const ys = p.map((q) => q[1]);
      mise.formes.push({ couleur, courbes, pts: p, bb: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] });
    }
  }
  return mise;
}

// Ouvre le PDF et renvoie la mise en page de la page qui contient le plus de codes de processus possibles (les 3 premières pages).
export async function lireMisePdf(octets) {
  const pdfjs = await chargerPdfjs();
  const tache = pdfjs.getDocument({ data: octets instanceof Uint8Array ? octets : new Uint8Array(octets), isEvalSupported: false, verbosity: 0, disableFontFace: true });
  const doc = await tache.promise;
  try {
    let meilleure = null;
    let score = -1;
    for (let n = 1; n <= Math.min(doc.numPages, PAGES_MAX); n += 1) {
      const mise = await miseDePage(await doc.getPage(n), pdfjs.OPS);
      const s = mise.textes.filter((t) => FORMAT_CODE_PROCESSUS.test(t.s.trim())).length;
      if (s > score) { meilleure = mise; score = s; }
    }
    return meilleure || { largeur: 0, hauteur: 0, textes: [], formes: [] };
  } finally {
    await tache.destroy();
  }
}

// Tout-en-un pour l'interface : octets du PDF → { cartographie, rapport }.
export async function importerPdf(octets) {
  const mise = await lireMisePdf(octets);
  return interpreter(mise);
}

// ---------- 2. Interprétation (fonction pure) ----------
const aire = (bb) => Math.max(0, bb[2] - bb[0]) * Math.max(0, bb[3] - bb[1]);
const centre = (bb) => [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2];
const contient = (bb, x, y, marge = 0) => x >= bb[0] - marge && x <= bb[2] + marge && y >= bb[1] - marge && y <= bb[3] + marge;
const contientCentre = (bb, autre) => contient(bb, ...centre(autre));
function ecart(a, b) { // distance entre deux rectangles (0 s'ils se touchent)
  const dx = Math.max(0, a[0] - b[2], b[0] - a[2]);
  const dy = Math.max(0, a[1] - b[3], b[1] - a[3]);
  return Math.hypot(dx, dy);
}
const sansAccent = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Les textes d'une même ligne sont recollés (le PDF les coupe par mot ou par style).
export function regrouperLignes(textes) {
  // Les « textes » faits d'espaces seulement (PowerPoint en met entre deux zones de texte) sont ignorés : l'écart réel décide.
  const horizontaux = textes.filter((t) => !t.vertical && t.s.trim() !== "").sort((a, b) => (a.bb[3] - b.bb[3]) || (a.bb[0] - b.bb[0]));
  const lignes = [];
  for (const t of horizontaux) {
    const derniere = lignes[lignes.length - 1];
    const memeLigne = derniere && Math.abs(derniere.bas - t.bb[3]) <= 0.3 * t.taille && t.bb[0] - derniere.bb[2] <= 0.8 * t.taille && t.bb[0] - derniere.bb[2] >= -0.5 * t.taille;
    if (memeLigne) {
      const trou = t.bb[0] - derniere.bb[2];
      const colle = /\s$/.test(derniere.s) || /^\s/.test(t.s) || trou < 0.12 * t.taille;
      derniere.s += (colle ? "" : " ") + t.s;
      derniere.bb = [Math.min(derniere.bb[0], t.bb[0]), Math.min(derniere.bb[1], t.bb[1]), Math.max(derniere.bb[2], t.bb[2]), Math.max(derniere.bb[3], t.bb[3])];
      derniere.taille = Math.max(derniere.taille, t.taille);
    } else {
      lignes.push({ s: t.s, bb: [...t.bb], taille: t.taille, bas: t.bb[3], vertical: false });
    }
  }
  const verticaux = textes.filter((t) => t.vertical).map((t) => ({ s: t.s, bb: [...t.bb], taille: t.taille, bas: t.bb[3], vertical: true }));
  return [...lignes, ...verticaux]
    .map((l) => ({ ...l, s: l.s.replace(/\s+/g, " ").trim() }))
    .filter((l) => l.s !== "");
}

// Une flèche = un polygone rempli allongé, dont on cherche les pointes : une pointe = un sommet isolé au bout, un bout plat = deux sommets.
export function analyserFleche(pts) {
  const p = pts.filter((q, i) => i === 0 || Math.hypot(q[0] - pts[i - 1][0], q[1] - pts[i - 1][1]) > 0.05);
  if (p.length > 1 && Math.hypot(p[0][0] - p[p.length - 1][0], p[0][1] - p[p.length - 1][1]) < 0.05) p.pop();
  if (p.length < 7 || p.length > 12) return null;
  const n = p.length;
  const mx = p.reduce((s, q) => s + q[0], 0) / n;
  const my = p.reduce((s, q) => s + q[1], 0) / n;
  let sxx = 0, syy = 0, sxy = 0;
  p.forEach((q) => { sxx += (q[0] - mx) ** 2; syy += (q[1] - my) ** 2; sxy += (q[0] - mx) * (q[1] - my); });
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy); // axe principal
  const u = [Math.cos(angle), Math.sin(angle)];
  const t = p.map((q) => (q[0] - mx) * u[0] + (q[1] - my) * u[1]);
  const w = p.map((q) => -(q[0] - mx) * u[1] + (q[1] - my) * u[0]);
  const tmin = Math.min(...t), tmax = Math.max(...t);
  const longueur = tmax - tmin;
  const largeur = Math.max(...w) - Math.min(...w);
  if (longueur < 12 || longueur < 2.2 * largeur) return null;
  const tol = 0.8 + 0.006 * longueur; // les deux coins d'un bout plat sont alignés à moins d'un point près ; les ailes d'une pointe sont plus loin
  const bout = (cote) => {
    const idx = t.map((v, i) => i).filter((i) => Math.abs(t[i] - (cote === 0 ? tmin : tmax)) <= tol);
    const x = idx.reduce((s, i) => s + p[i][0], 0) / idx.length;
    const y = idx.reduce((s, i) => s + p[i][1], 0) / idx.length;
    return { pointe: idx.length === 1, point: [x, y] };
  };
  const a = bout(0), b = bout(1);
  if (!a.pointe && !b.pointe) return null;
  if (a.pointe && b.pointe) return { double: true, de: a.point, vers: b.point };
  return a.pointe ? { double: false, de: b.point, vers: a.point } : { double: false, de: a.point, vers: b.point };
}

const CODE = FORMAT_CODE_PROCESSUS;
function categorieDuTexte(s) {
  const m = sansAccent(s);
  if (/manag|pilot|direction/.test(m)) return "management";
  if (/realis|realiz|operation|metier|coeur|core|production|delivery/.test(m)) return "realisation";
  if (/support|soutien|ressource/.test(m)) return "support";
  if (/verif|surveill|controle|audit|mesure|evaluation|checking/.test(m)) return "verification"; // 4e bloc (v0.27)
  return "";
}

export function interpreter(mise) {
  const rapport = [];
  const propre = nouvelleCartographie();
  const lignes = regrouperLignes(mise.textes || []);
  const page = [0, 0, mise.largeur || 1, mise.hauteur || 1];
  const aPage = aire(page);
  if (lignes.length < 3) return { cartographie: propre, rapport: [{ gravite: "erreur", cle: "carto.import.sans_texte" }] };

  // Cadres : formes remplies sans être la page entière ni des pointes de flèche.
  const fleches = [];
  const cadres = [];
  for (const f of mise.formes || []) {
    if (aire(f.bb) > 0.9 * aPage) continue;
    const fl = f.courbes ? null : analyserFleche(f.pts);
    if (fl) fleches.push({ ...fl, bb: f.bb });
    else if (aire(f.bb) >= 300 && f.bb[2] - f.bb[0] >= 12 && f.bb[3] - f.bb[1] >= 12) cadres.push(f);
  }
  const cadresTries = [...cadres].sort((a, b) => aire(a.bb) - aire(b.bb));
  const plusPetitCadre = (bb, minAire = 0) => cadresTries.find((c) => aire(c.bb) > minAire && contientCentre(c.bb, bb)) || null;

  // ----- Processus : un code (PIL, ACH…) suivi de son nom, en général dans un cadre arrondi -----
  const estCode = (l) => !l.vertical && CODE.test(l.s);
  const processus = [];
  const codesVus = new Set();
  lignes.filter(estCode).forEach((c) => {
    if (codesVus.has(c.s)) return;
    const pastille = plusPetitCadre(c.bb, aire(c.bb) * 1.3);
    let titres;
    if (pastille && aire(pastille.bb) < 0.25 * aPage) {
      titres = lignes.filter((l) => !l.vertical && !estCode(l) && contientCentre(pastille.bb, l.bb) && l.bb[1] >= c.bb[1] - 1 && l !== c);
    } else {
      titres = [];
      let bas = c.bb[3];
      lignes.filter((l) => !l.vertical && !estCode(l) && Math.abs(l.bb[0] - c.bb[0]) <= 3 && l.bb[1] >= c.bb[1]).sort((a, b) => a.bb[1] - b.bb[1]).forEach((l) => {
        if (l.bb[1] - bas < 1.6 * l.taille && titres.length < 3) { titres.push(l); bas = l.bb[3]; }
      });
    }
    titres.sort((a, b) => (a.bb[1] - b.bb[1]) || (a.bb[0] - b.bb[0]));
    const nom = titres.map((l) => l.s).join(" ").trim();
    if (!nom) return;
    codesVus.add(c.s);
    processus.push({ code: c.s, nom, ligne: c, titres, pastille: pastille && aire(pastille.bb) < 0.25 * aPage ? pastille.bb : null });
  });

  // ----- Textes verticaux (MANAGEMENT, RÉALISATION, SUPPORT) : la catégorie d'un processus -----
  const verticaux = lignes.filter((l) => l.vertical).map((l) => ({ ...l, categorie: categorieDuTexte(l.s) })).filter((l) => l.categorie);
  processus.forEach((p) => {
    const boite = p.pastille || p.ligne.bb;
    const bande = plusPetitCadre(boite, aire(boite) * 1.5);
    let etiquette = null;
    if (bande && aire(bande.bb) < 0.6 * aPage) etiquette = verticaux.find((v) => contientCentre(bande.bb, v.bb)) || null;
    if (!etiquette && verticaux.length) {
      const [, cy] = centre(boite);
      etiquette = [...verticaux].filter((v) => v.bb[2] <= boite[0] + 2).sort((a, b) => Math.abs(centre(a.bb)[1] - cy) - Math.abs(centre(b.bb)[1] - cy))[0] || null;
    }
    p.categorie = etiquette ? etiquette.categorie : "";
    p.bande = bande && aire(bande.bb) < 0.6 * aPage ? bande.bb : null;
  });
  processus.sort((a, b) => (CATEGORIES.indexOf(a.categorie) + 1 || 9) - (CATEGORIES.indexOf(b.categorie) + 1 || 9) || (a.ligne.bb[1] - b.ligne.bb[1]) || (a.ligne.bb[0] - b.ligne.bb[0]));

  // ----- Repli : pas de cadres ni de codes isolés → lignes « CODE Nom » ou tableaux « code | nom » -----
  if (processus.length < 2) {
    const repli = [];
    let categorie = "";
    const lignesTriees = [...lignes].filter((l) => !l.vertical).sort((a, b) => (a.bb[1] - b.bb[1]) || (a.bb[0] - b.bb[0]));
    lignesTriees.forEach((l, i) => {
      const cat = categorieDuTexte(l.s);
      if (cat && l.s.length < 40 && !/^[A-Z][A-Z0-9]{1,4}\b/.test(l.s)) { categorie = cat; return; }
      let m = /^([A-Z][A-Z0-9]{1,4})\s*[-–—:.)]?\s+(\S.{2,})$/.exec(l.s);
      if (!m) { // tableau : le nom est dans la cellule voisine, sur la même ligne
        if (!CODE.test(l.s)) return;
        const voisine = lignesTriees.find((v, j) => j !== i && Math.abs(v.bb[3] - l.bb[3]) <= 0.4 * l.taille && v.bb[0] > l.bb[2] && !CODE.test(v.s));
        if (!voisine) return;
        m = [null, l.s, voisine.s];
      }
      if (!repli.some((r) => r.code === m[1])) repli.push({ code: m[1], nom: m[2].trim(), categorie, ligne: l, titres: [], pastille: null, bande: null });
    });
    if (repli.length >= 2) { processus.length = 0; processus.push(...repli); rapport.push({ gravite: "alerte", cle: "carto.import.lecture_simple" }); }
  }
  if (processus.length === 0) {
    rapport.push({ gravite: "erreur", cle: "carto.import.aucun_processus" });
    return { cartographie: propre, rapport };
  }
  processus.forEach((p) => { p.id = nouvelId("q"); });

  // ----- Titre, organisation, contexte, parties intéressées -----
  const dansUnCadre = (l) => cadres.some((c) => contientCentre(c.bb, l.bb));
  const orphelins = lignes.filter((l) => !l.vertical && !dansUnCadre(l) && l.bb[1] < 0.2 * page[3]).sort((a, b) => b.taille - a.taille || a.bb[1] - b.bb[1]);
  const titre = orphelins[0];
  const sousTitre = titre && lignes.filter((l) => !l.vertical && !dansUnCadre(l) && l !== titre && l.bb[1] >= titre.bb[3] - 1 && l.bb[1] < titre.bb[3] + 3 * titre.taille && l.taille < titre.taille).sort((a, b) => a.bb[1] - b.bb[1])[0];
  if (titre) propre.titre = titre.s;
  if (sousTitre) propre.organisation = sousTitre.s.split(/\s[—–-]\s/)[0].trim();
  const large = cadres.filter((c) => c.bb[2] - c.bb[0] > 0.7 * page[2] && c.bb[3] - c.bb[1] < 0.15 * page[3]).sort((a, b) => a.bb[1] - b.bb[1])[0];
  const banniere = large && lignes.filter((l) => !l.vertical && contientCentre(large.bb, l.bb)).sort((a, b) => a.bb[0] - b.bb[0]).map((l) => l.s).join(" ");
  if (banniere) propre.contexte = banniere.replace(/^((?:[A-ZÀ-ÖØ-Þ'’]+\s+)+)(?=[A-ZÀ-ÖØ-Þ][a-zà-ÿ])/, "").trim();
  const colonnes = cadres.filter((c) => c.bb[3] - c.bb[1] > 0.5 * page[3] && c.bb[2] - c.bb[0] < 0.25 * page[2]).sort((a, b) => a.bb[0] - b.bb[0]);
  const texteColonne = (c) => lignes.filter((l) => !l.vertical && contientCentre(c.bb, l.bb)).sort((a, b) => a.bb[1] - b.bb[1]).slice(1).map((l) => l.s).join(" ");
  const gauche = colonnes.find((c) => centre(c.bb)[0] < page[2] / 2);
  const droite = [...colonnes].reverse().find((c) => centre(c.bb)[0] >= page[2] / 2);
  if (gauche) propre.exigences = texteColonne(gauche);
  if (droite) propre.satisfaction = texteColonne(droite);

  // ----- Échanges : les flèches, leur sens, et le texte le plus proche -----
  const zones = [];
  processus.forEach((p) => { const bb = p.pastille || [p.ligne.bb[0] - 8, p.ligne.bb[1] - 8, p.ligne.bb[2] + 8, p.ligne.bb[3] + 8]; zones.push({ id: p.id, bb, rang: 0 }); });
  CATEGORIES.forEach((k) => {
    const bandes = processus.filter((p) => p.categorie === k && p.bande).map((p) => p.bande);
    if (bandes.length) zones.push({ id: k, bb: [Math.min(...bandes.map((b) => b[0])), Math.min(...bandes.map((b) => b[1])), Math.max(...bandes.map((b) => b[2])), Math.max(...bandes.map((b) => b[3]))], rang: 2 });
  });
  if (gauche) zones.push({ id: "exigences", bb: gauche.bb, rang: 1 });
  if (droite) zones.push({ id: "satisfaction", bb: droite.bb, rang: 1 });
  if (large) zones.push({ id: "contexte", bb: large.bb, rang: 1 });
  const resoudre = ([x, y]) => zones.filter((z) => contient(z.bb, x, y, 4)).sort((a, b) => aire(a.bb) - aire(b.bb))[0]?.id || null;

  const dejaUtilises = new Set([...processus.flatMap((p) => [p.ligne, ...p.titres]), ...lignes.filter((l) => l.vertical)]);
  if (titre) dejaUtilises.add(titre);
  if (sousTitre) dejaUtilises.add(sousTitre);
  const legendes = lignes.filter((l) => !dejaUtilises.has(l) && !l.vertical
    && !zones.some((z) => (z.rang === 0 || z.rang === 1) && contientCentre(z.bb, l.bb))
    && !(large && contientCentre(large.bb, l.bb)));
  const paires = [];
  fleches.forEach((f, i) => legendes.forEach((l, j) => {
    const d = ecart(f.bb, l.bb);
    if (d <= 3.5 * l.taille) paires.push({ i, j, d });
  }));
  paires.sort((a, b) => a.d - b.d);
  const texteDeFleche = new Map();
  const legendeUtilisee = new Set();
  paires.forEach(({ i, j }) => {
    if (texteDeFleche.has(i) || legendeUtilisee.has(j)) return;
    texteDeFleche.set(i, legendes[j].s);
    legendeUtilisee.add(j);
  });
  let sansTexte = 0;
  let nonRattachees = 0;
  const flux = [];
  fleches.forEach((f, i) => {
    const information = texteDeFleche.get(i);
    if (!information) { sansTexte += 1; return; }
    const de = resoudre(f.de);
    const vers = resoudre(f.vers);
    if (!de || !vers || de === vers) { nonRattachees += 1; return; }
    flux.push({ id: nouvelId("f"), de, vers, information, double: f.double });
  });
  const orphelinesLegendes = legendes.filter((_, j) => !legendeUtilisee.has(j)).map((l) => l.s);

  propre.processus = processus.map((p) => ({ id: p.id, code: p.code, nom: p.nom, categorie: p.categorie }));
  propre.flux = flux;
  const nette = nettoyerCartographie(propre);

  rapport.push({ gravite: "ok", cle: "carto.import.resume", params: { processus: nette.processus.length, flux: nette.flux.length } });
  const sansCategorie = nette.processus.filter((p) => !p.categorie).map((p) => p.code);
  if (sansCategorie.length) rapport.push({ gravite: "alerte", cle: "carto.import.sans_categorie", params: { codes: sansCategorie.join(", ") } });
  if (nonRattachees) rapport.push({ gravite: "alerte", cle: "carto.import.fleches_non_rattachees", params: { n: nonRattachees } });
  if (sansTexte) rapport.push({ gravite: "ok", cle: "carto.import.fleches_sans_texte", params: { n: sansTexte } });
  if (orphelinesLegendes.length) rapport.push({ gravite: "alerte", cle: "carto.import.textes_isoles", params: { textes: orphelinesLegendes.slice(0, 3).join(" ; ") } });
  if (nette.flux.length === 0 && fleches.length === 0) rapport.push({ gravite: "alerte", cle: "carto.import.aucun_echange" });
  return { cartographie: nette, rapport };
}
