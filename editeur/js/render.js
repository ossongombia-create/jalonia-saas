// render.js — le DESSIN : transforme une procédure en image SVG (niveau 2), dans le style du « Modèle standard de procédure » :
// bandeau bleu d'identification, couloirs de rôles grisés en alternance, lignes de repère en pointillé, instructions à bord bleu,
// « paniers » d'information (des « coupes », haut ouvert) posés sur les flèches, cercle « ou » / « et » sur la sortie d'une décision,
// retours en pointillé rouge, triangle de contrôle, cercle « + » de contrainte, fanion d'indicateur, symbole de correction,
// sous-procédure, macro-instructions, actions amont et aval, début et fin (légende Qualigramme, v0.14).
// SVG = un langage de formes décrites en texte (comme le HTML décrit une page). Ici on construit ce texte, puis on
// l'insère dans la page. Le dessin ne modifie jamais la procédure.
//
// Règle d'or (v0.5) : AUCUN texte n'est jamais coupé ni abrégé. Ce sont les formes qui s'adaptent :
// le texte est passé à la ligne autant que nécessaire, puis la hauteur de chaque forme et
// l'écart entre les lignes du dessin sont calculés d'après le nombre de lignes.

import { colonnes } from "./rules.js";
import { t, langueCourante } from "./i18n.js";
import { formaterDate } from "./document.js";

const HAUT_LIGNE_12 = 14.4; // hauteur d'une ligne de texte en corps 12
const MARGE = 24;
// Couleurs du modèle : bleu des bordures et des titres, rouge des retours, gris des couloirs et des outils.
// Charte Jalonia : sarcelle pour les formes du logigramme, violet pour l'accent du bandeau ; le rouge des retours et le gris des outils sont ceux de la légende.
const SARCELLE = "#005A70";
const VIOLET = "#6F5091";
const ROUGE = "#A61E22";
const ENCRE = "#1C2A33";
const GRIS_TEXTE = "#555B66";
const GRIS_LIGNE = "#CFC9D8";
const GRIS_COULOIR = "#F4F1F7";
const POLICE = "Calibri, Carlito, 'Segoe UI', Arial, sans-serif";
// Réglages de mise en page : nombre de caractères par ligne dans un panier d'information (flèches) et dans l'étiquette
// d'une alternative. On essaie plusieurs valeurs (voir choisirMiseEnPage) et on garde celle qui donne le texte le plus grand sur A4.
const PARAMS_DEFAUT = { largeurInfo: 38, largeurLabel: 22, largeurCol: 170 };
const GRILLE_INFO = [24, 30, 38, 48, 60, 76, 96];
const GRILLE_LABEL = [14, 18, 22, 30, 40];
const GRILLE_COL = [150, 160, 170, 190, 210];
const ECART_MIN = 26; // hauteur minimale entre deux instructions
const FLECHE_MIN = 22; // flèche seule, sous un carrefour
const DECALAGE_SORTIE = 4; // tronc visible entre le bas d'une instruction et son cercle ou / et
const LARGEUR_OUTIL = 130;
const ECART_OUTIL = 30; // distance entre l'instruction et ses outils
const LARGEUR_LANE = 14; // écart entre deux couloirs de renvoi dans la gouttière de gauche
// Largeur moyenne d'un caractère (estimation prudente : Calibri est plus étroit que Segoe UI, qui sert de repli).
const PX = 5.4; // corps 10, normal
const PX_GRAS = 5.9; // corps 10, gras
const PX_G12 = 7.1; // corps 12, gras
const LIGNE_MIN = 16; // une ligne de texte de flèche fait au moins 16 caractères
const HAUT_PANIER_LIGNE = 12;
const LARGEUR_BANNIERE_MIN = 430;
const LIGNE_ANNOTATION = 84; // caractères par ligne d'une annotation de Début ou de Fin (≈ 450 px)

// Échappe les caractères spéciaux du HTML/SVG (sécurité : un libellé ne doit jamais injecter de code).
function echapper(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Coupe un texte en lignes de ~max caractères. Aucune limite de nombre de lignes ;
// un mot plus long que la ligne est lui-même coupé (sinon il déborderait de la forme).
export function couper(texte, max) {
  const lignes = [];
  let courante = "";
  String(texte).split(/\s+/).filter(Boolean).forEach((mot) => {
    while (mot.length > max) {
      if (courante) { lignes.push(courante); courante = ""; }
      lignes.push(mot.slice(0, max - 1) + "-");
      mot = mot.slice(max - 1);
    }
    if ((courante + " " + mot).trim().length > max && courante) {
      lignes.push(courante);
      courante = mot;
    } else {
      courante = (courante + " " + mot).trim();
    }
  });
  if (courante) lignes.push(courante);
  return lignes;
}

// Bloc de texte centré verticalement sur y.
function txt(lignes, x, y, { taille = 10, gras = false, italique = false, ancre = "middle", couleur = ENCRE, souligne = false } = {}) {
  const pas = taille * 1.2;
  const debut = y - ((lignes.length - 1) * pas) / 2 + taille * 0.35;
  const deco = souligne ? ' text-decoration="underline"' : "";
  const style = italique ? ' font-style="italic"' : "";
  return lignes
    .map((l, k) => `<text x="${r1(x)}" y="${r1(debut + k * pas)}" text-anchor="${ancre}" font-size="${taille}" font-weight="${gras ? 700 : 400}"${style} fill="${couleur}"${deco}>${echapper(l)}</text>`)
    .join("");
}
const r1 = (v) => Math.round(v * 10) / 10;

// Panier d'information : rectangle arrondi posé sur une flèche. Le nom du cas (décision) est en gras, l'information en dessous.
// Indicateur d'interface (livre §6.5.22) : avec « contrat », le symbole « feuille à lignes » est posé SUR le panier (à droite, dans le
// panier même, qui s'élargit d'autant) pour montrer qu'un contrat lie les deux parties de la flèche.
const LARGEUR_CONTRAT = 24; // place du symbole dans le panier
function mesurerPanier(cas, info, contrat = false) {
  const n = cas.length + info.length;
  if (!n) return null;
  const px = Math.max(0, ...cas.map((l) => l.length * PX_GRAS), ...info.map((l) => l.length * PX));
  return { cas, info, contrat, w: Math.ceil(px + 14 + (contrat ? LARGEUR_CONTRAT : 0)), h: Math.max(n * HAUT_PANIER_LIGNE + 8, contrat ? 28 : 0) };
}
// Symbole « contrat » : une feuille à coin replié et trois lignes de texte, centrée sur (xc, yc).
function symboleContrat(xc, yc, couleur = SARCELLE) {
  const x0 = xc - 6;
  const x1 = xc + 6;
  const y0 = yc - 9;
  const y1 = yc + 9;
  const c = 4; // coin replié
  const lignes = [yc - 2, yc + 2, yc + 6].map((y, k) => `<line x1="${r1(x0 + 2.5)}" y1="${r1(y)}" x2="${r1(x1 - (k === 2 ? 5 : 2.5))}" y2="${r1(y)}" stroke="${couleur}" stroke-width="1"/>`).join("");
  return `<g class="symbole-contrat"><path d="M${r1(x0)} ${r1(y0)}H${r1(x1 - c)}L${r1(x1)} ${r1(y0 + c)}V${r1(y1)}H${r1(x0)}Z" fill="#fff" stroke="${couleur}" stroke-width="1.3" stroke-linejoin="round"/>` +
    `<path d="M${r1(x1 - c)} ${r1(y0)}V${r1(y0 + c)}H${r1(x1)}" fill="none" stroke="${couleur}" stroke-width="1" stroke-linejoin="round"/>${lignes}</g>`;
}
// Dessine un panier dont le centre est en (xc, yc) : une « coupe » (haut ouvert, coins du bas arrondis), fond blanc, posée sur la flèche.
function dessinerPanier(p, xc, yc, couleur = SARCELLE) {
  const total = p.cas.length + p.info.length;
  const haut = yc - p.h / 2;
  const x0 = r1(xc - p.w / 2);
  const x1 = r1(xc + p.w / 2);
  const y0 = r1(haut);
  const y1 = r1(haut + p.h);
  const c = 6;
  const coupe = `M${x0} ${y0}V${r1(y1 - c)}Q${x0} ${y1} ${r1(x0 + c)} ${y1}H${r1(x1 - c)}Q${x1} ${y1} ${x1} ${r1(y1 - c)}V${y0}`;
  let s = `<path d="${coupe}Z" fill="#fff" stroke="none"/><path d="${coupe}" fill="none" stroke="${couleur}" stroke-width="1.3" stroke-linejoin="round"/>`;
  const xt = p.contrat ? xc - LARGEUR_CONTRAT / 2 : xc; // le texte se centre dans la partie gauche quand le symbole occupe la droite
  if (p.cas.length) s += txt(p.cas, xt, haut + 4 + (p.cas.length * HAUT_PANIER_LIGNE) / 2, { gras: true });
  if (p.info.length) s += txt(p.info, xt, haut + 4 + p.cas.length * HAUT_PANIER_LIGNE + (p.info.length * HAUT_PANIER_LIGNE) / 2, { couleur: ENCRE });
  if (p.contrat && total) s += symboleContrat(x1 - LARGEUR_CONTRAT / 2 - 1, yc, couleur);
  return total ? s : "";
}

// Place un élément de largeur w centré sur xc, en le décalant au besoin pour qu'il reste entre gauche et droite.
function placerCentre(xc, w, gauche, droite) {
  const x = Math.min(Math.max(xc - w / 2, gauche), Math.max(gauche, droite - w));
  return x + w / 2;
}

// Forme d'un outil, posée à (x, y) = coin haut-gauche. Renvoie { hauteur, dessiner(y) }. Gris, texte en italique (comme le modèle).
function formeOutil(outil) {
  if (outil.type === "materiel") {
    const lignes = couper(outil.nom, 13);
    const hauteur = Math.max(60, Math.ceil((lignes.length * 13 + 8) / 0.45));
    return {
      hauteur, largeur: LARGEUR_OUTIL + 20,
      dessiner: (x, y) => {
        const l = LARGEUR_OUTIL + 20;
        const yTexte = y + hauteur * 0.55 + (hauteur * 0.45 - 4) / 2;
        return `<polygon points="${x + l / 2},${y} ${x + l},${y + hauteur} ${x},${y + hauteur}" fill="#fff" stroke="${GRIS_TEXTE}" stroke-width="1.6"/>` +
          txt(lignes, x + l / 2, yTexte, { taille: 10.5, italique: true, couleur: GRIS_TEXTE });
      },
    };
  }
  // Document : rectangle dont le bas est ondulé.
  const lignes = couper(outil.nom, 17);
  const hauteur = lignes.length * 12.6 + 20;
  return {
    hauteur, largeur: LARGEUR_OUTIL,
    dessiner: (x, y) => {
      const yb = y + hauteur - 8;
      return `<path d="M${x} ${y}H${x + LARGEUR_OUTIL}V${yb}Q${x + LARGEUR_OUTIL * 0.75} ${yb - 9} ${x + LARGEUR_OUTIL / 2} ${yb}T${x} ${yb}Z" fill="#fff" stroke="${GRIS_TEXTE}" stroke-width="1.6"/>` +
        txt(lignes, x + LARGEUR_OUTIL / 2, y + (hauteur - 8) / 2, { taille: 10.5, italique: true, couleur: GRIS_TEXTE });
    },
  };
}

// Symbole « recyclage » (action corrective) : un arc presque complet terminé par une pointe de flèche.
function symboleRecyclage(x, y) {
  const cx = x;
  const cy = y - 10;
  const r = 8;
  const p = (deg) => [cx + r * Math.cos((deg * Math.PI) / 180), cy + r * Math.sin((deg * Math.PI) / 180)];
  const [x0, y0] = p(130);
  const [x1, y1] = p(40);
  const a = (40 * Math.PI) / 180;
  const dx = -Math.sin(a);
  const dy = Math.cos(a);
  const px = Math.cos(a);
  const py = Math.sin(a);
  const pointe = `${r1(x1 + dx * 6)},${r1(y1 + dy * 6)} ${r1(x1 + px * 4)},${r1(y1 + py * 4)} ${r1(x1 - px * 4)},${r1(y1 - py * 4)}`;
  return `<path d="M${r1(x0)} ${r1(y0)}A${r} ${r} 0 1 1 ${r1(x1)} ${r1(y1)}" fill="none" stroke="${SARCELLE}" stroke-width="2.4"/><polygon points="${pointe}" fill="${SARCELLE}"/>`;
}

// Cercle de contrainte : toujours un « + » (légende Qualigramme : délai, coût ou exigence à respecter). La nature (délai, coût, autre)
// est gardée dans les données et reprise dans le document, pas dans le dessin.
function cercleContrainte(x, y) {
  return `<circle cx="${x}" cy="${y}" r="10" fill="#fff" stroke="${SARCELLE}" stroke-width="1.8"/>` +
    `<text x="${x}" y="${y + 5}" text-anchor="middle" font-size="15" font-weight="700" fill="${SARCELLE}">+</text>`;
}

// Fanion d'indicateur de performance : une hampe et un pavillon triangulaire, posés sur le bord haut de l'instruction (x = pied de la hampe).
function fanion(x, yBord) {
  return `<line x1="${r1(x)}" y1="${r1(yBord)}" x2="${r1(x)}" y2="${r1(yBord - 20)}" stroke="${SARCELLE}" stroke-width="1.8"/>` +
    `<polygon points="${r1(x)},${r1(yBord - 20)} ${r1(x + 13)},${r1(yBord - 15)} ${r1(x)},${r1(yBord - 10)}" fill="${SARCELLE}" stroke="${SARCELLE}" stroke-width="1" stroke-linejoin="round"/>`;
}

// Petite flèche pleine, pointe en bas, dont la pointe touche (x, yPointe) ; un trait la relie à (x, yDepart).
function flecheCourte(x, yDepart, yPointe) {
  const ligne = yPointe - 7 > yDepart ? `<line x1="${r1(x)}" y1="${r1(yDepart)}" x2="${r1(x)}" y2="${r1(yPointe - 6)}" stroke="${SARCELLE}" stroke-width="1.8"/>` : "";
  return `${ligne}<polygon points="${r1(x - 4.5)},${r1(yPointe - 8)} ${r1(x + 4.5)},${r1(yPointe - 8)} ${r1(x)},${r1(yPointe)}" fill="${SARCELLE}"/>`;
}

// Action amont ou aval (hors périmètre) — symbole du livre (§6.5.12-13 pour une procédure, §7.5.9-10 pour une instruction) :
// le TEXTE de l'action est écrit sur une BARRE, reliée à la suite du dessin par une flèche d'information (avec son panier).
// Le rôle de provenance (amont) ou de destination (aval) est un petit ovale gris (fig. 7.7) : au-dessus du texte pour une
// action amont, sous le texte pour une action aval. De haut en bas : amont = ovale, texte, barre ; aval = barre, texte, ovale.
// La flèche est OBLIQUE ET DESCENDANTE, comme dans le livre (v0.17) : elle part du centre de la barre (amont) ou
// arrive au centre de la barre (aval), avec le panier sur son milieu. Elle est courte : le panier recouvre l'essentiel de sa hauteur.
const PX_RACCORD = 6.2; // largeur moyenne d'un caractère gras, corps 10,5
const PENTE_RACCORD = 0.9; // décalage horizontal de la flèche par unité de hauteur (≈ 42° par rapport à la verticale)
// Hauteur d'une flèche oblique (amont ou aval) et de son panier d'information : au moins 24 px.
function ecartOblique(panier) {
  return Math.max(24, panier ? Math.ceil(panier.h) + 16 : 0);
}
function mesurerRaccord(raccord, quel, largeurMax) {
  const texte = (raccord.texte || "").trim();
  if (!texte) return null;
  const lignes = couper(texte, Math.max(14, Math.min(34, Math.floor((largeurMax - 12) / PX_RACCORD))));
  const role = (raccord.role || "").trim();
  const lignesRole = role ? couper(role, 24) : [];
  const largeurRole = lignesRole.length ? Math.ceil(Math.max(...lignesRole.map((l) => l.length * 5.2)) + 20) : 0;
  const hauteurRole = lignesRole.length ? Math.max(16, lignesRole.length * 10.8 + 6) : 0;
  const largeurTexte = Math.ceil(Math.max(...lignes.map((l) => l.length * PX_RACCORD)));
  const largeur = Math.max(70, largeurTexte + 14, largeurRole);
  const hauteurTexte = lignes.length * 12.6;
  const information = (raccord.information || "").trim();
  const panier = information ? mesurerPanier([], couper(information, 40)) : null;
  const ecart = ecartOblique(panier);
  return {
    quel, lignes, lignesRole, largeur, largeurRole, hauteurRole, hauteurTexte, panier,
    hauteur: hauteurTexte + 3 + (hauteurRole ? hauteurRole + 3 : 0),
    ecart, dx: Math.round(ecart * PENTE_RACCORD),
  };
}
// Hauteur entre la barre d'une action et le symbole voisin (Début ou Fin) : la flèche oblique et, s'il y en a un, son panier.
function ecartRaccord(m) {
  return m.ecart;
}
// Dessine l'action dans la zone [y0, y0 + hauteur] : la barre est en bas (amont) ou en haut (aval). xFleche = abscisse où la flèche
// touche la barre (départ pour l'amont, arrivée pour l'aval) ; la barre est prolongée au besoin pour qu'elle s'y raccorde.
function dessinerRaccord(m, xc, y0, xFleche = xc) {
  const amont = m.quel === "amont";
  const yBarre = amont ? y0 + m.hauteur : y0;
  const xa = r1(Math.min(xc - m.largeur / 2, xFleche - 10));
  const xb = r1(Math.max(xc + m.largeur / 2, xFleche + 10));
  let s = `<line x1="${xa}" y1="${r1(yBarre)}" x2="${xb}" y2="${r1(yBarre)}" stroke="${SARCELLE}" stroke-width="2.2"/>`;
  const yTexte = amont ? y0 + (m.hauteurRole ? m.hauteurRole + 3 : 0) + m.hauteurTexte / 2 : y0 + 3 + m.hauteurTexte / 2;
  s += txt(m.lignes, xc, yTexte, { taille: 10.5, gras: true });
  if (m.lignesRole.length) {
    const yo = amont ? y0 + m.hauteurRole / 2 : y0 + 3 + m.hauteurTexte + 3 + m.hauteurRole / 2;
    s += `<ellipse cx="${r1(xc)}" cy="${r1(yo)}" rx="${r1(m.largeurRole / 2)}" ry="${r1(m.hauteurRole / 2)}" fill="#DDD8E4" stroke="${GRIS_TEXTE}" stroke-width="1.2"/>`;
    s += txt(m.lignesRole, xc, yo, { taille: 9, italique: true, couleur: ENCRE });
  }
  return s;
}
// Flèche d'information oblique descendante de (xDe, yDe) à (xA, yA), avec son panier au milieu s'il y a une information.
function flecheRaccord(m, xDe, yDe, xA, yA) {
  let s = `<path d="M${r1(xDe)} ${r1(yDe)}L${r1(xA)} ${r1(yA)}" fill="none" stroke="${SARCELLE}" stroke-width="1.8" marker-end="url(#flechePetite)"/>`;
  if (m.panier) {
    // Le panier est posé sur la flèche, près de son départ : la pointe reste bien visible sous lui.
    const yc = yDe + 4 + m.panier.h / 2;
    s += dessinerPanier(m.panier, xDe + ((xA - xDe) * (yc - yDe)) / (yA - yDe), yc);
  }
  return s;
}

// Cercle d'opérateur (ou / et) : posé sur la sortie d'une décision ou sur l'arrivée de plusieurs flèches.
function cercleOperateur(x, y, op) {
  return `<circle cx="${r1(x)}" cy="${r1(y)}" r="9" fill="#fff" stroke="${SARCELLE}" stroke-width="1.8"/>` +
    `<text x="${r1(x)}" y="${r1(y + 3.2)}" text-anchor="middle" font-size="${t("logigramme.op." + op).length > 2 ? 7.5 : 9}" font-weight="700" fill="${SARCELLE}">${echapper(t("logigramme.op." + op))}</text>`;
}

// Bandeau bleu du haut : titre, sous-titre, processus — domaine, puis code, version, date et signataires.
function mesurerBanniere(procedure, largeur) {
  const m = procedure.meta;
  const vide = "________";
  const titre = (m.titre || "").trim() || t("doc.sans_titre");
  const ligne3 = [m.processus, m.domaine ? t("domaine." + m.domaine) : ""].map((s) => (s || "").trim()).filter(Boolean).join(" — ");
  const l1 = `${t("logigramme.b.code")} : ${(m.reference || "").trim() || vide} · ${t("logigramme.b.version")} : ${(m.version || "").trim() || "__"}`;
  const l2 = `${t("logigramme.b.date")} : ${m.dateApplication ? formaterDate(m.dateApplication) : "____/____/______"}`;
  const signataires = ["redige", "verifie", "approuve"].map((k) => `${t("logigramme.b." + k)} : ${((m.signataires && m.signataires[k] && m.signataires[k].nom) || "").trim() || vide}`);
  // Les signataires sont regroupés par lignes (chacun reste entier sur sa ligne).
  const maxSig = 56;
  const lignesSig = [];
  let courante = "";
  signataires.forEach((s) => {
    couper(s, maxSig).forEach((morceau, k) => {
      if (k > 0) { if (courante) lignesSig.push(courante); courante = morceau; return; }
      if (courante && (courante + " · " + morceau).length > maxSig) { lignesSig.push(courante); courante = morceau; } else courante = courante ? courante + " · " + morceau : morceau;
    });
  });
  if (courante) lignesSig.push(courante);
  const droite = [l1, l2];
  const pxDroite = Math.max(l1.length * 6.2, l2.length * 5.6, ...lignesSig.map((l) => l.length * 5.3));
  const cote = largeur - pxDroite - 60 >= 250; // côte à côte si le titre garde assez de place
  const largeurTitre = cote ? largeur - pxDroite - 60 : largeur - 32;
  const lignesTitre = couper(titre, Math.max(12, Math.floor(largeurTitre / 8.6)));
  const lignesSous = couper(t("logigramme.sous_titre"), Math.max(20, Math.floor(largeurTitre / 5.4)));
  const lignesProc = ligne3 ? couper(ligne3, Math.max(20, Math.floor(largeurTitre / 6.1))) : [];
  const hautGauche = 10 + lignesTitre.length * 18 + lignesSous.length * 12 + lignesProc.length * 12 + 7;
  const hautDroite = 10 + 14 + 13 + lignesSig.length * 12 + 7;
  const hauteur = Math.ceil(cote ? Math.max(hautGauche, hautDroite) : hautGauche + hautDroite - 6);
  return {
    hauteur,
    dessiner: (W) => {
      let y = 10;
      let s = `<rect x="0" y="0" width="${W}" height="${hauteur}" fill="${SARCELLE}"/><rect x="0" y="${hauteur - 3}" width="${W}" height="3" fill="${VIOLET}"/>`;
      lignesTitre.forEach((l) => { y += 18; s += `<text x="16" y="${y - 5}" font-size="15" font-weight="700" fill="#fff">${echapper(l)}</text>`; });
      lignesSous.forEach((l) => { y += 12; s += `<text x="16" y="${y - 3}" font-size="10" font-style="italic" fill="#fff" fill-opacity="0.92">${echapper(l)}</text>`; });
      lignesProc.forEach((l) => { y += 12; s += `<text x="16" y="${y - 3}" font-size="10.5" font-weight="700" fill="#fff">${echapper(l)}</text>`; });
      const xd = cote ? W - 16 : 16;
      const ancre = cote ? "end" : "start";
      let yd = cote ? 10 : y + 8;
      s += `<text x="${xd}" y="${yd + 11}" text-anchor="${ancre}" font-size="10.5" font-weight="700" fill="#fff">${echapper(droite[0])}</text>`;
      s += `<text x="${xd}" y="${yd + 25}" text-anchor="${ancre}" font-size="9.5" fill="#fff">${echapper(droite[1])}</text>`;
      lignesSig.forEach((l, k) => { s += `<text x="${xd}" y="${yd + 38 + k * 12}" text-anchor="${ancre}" font-size="9" fill="#fff" fill-opacity="0.92">${echapper(l)}</text>`; });
      return s;
    },
  };
}

// Ordre des couloirs de renvoi, de gauche à droite. Un renvoi = un « groupe » : tous les départs qui vont vers la même
// destination partagent un couloir vertical. Deux groupes se croisent quand le trait horizontal de l'un (départ ou
// arrivée) traverse le couloir de l'autre : c'est le cas seulement si l'autre couloir est plus proche des colonnes et
// couvre la même hauteur. On essaie tous les ordres (jusqu'à 7 groupes) et on garde celui qui croise le moins.
function ordonnerCouloirs(groupes) {
  const base = [...groupes].sort((a, b) => (b.max - b.min) - (a.max - a.min));
  const cout = (ordre) => {
    let c = 0;
    for (let i = 0; i < ordre.length; i += 1) {
      for (let j = i + 1; j < ordre.length; j += 1) {
        ordre[i].horiz.forEach((y) => { if (y > ordre[j].min + 0.5 && y < ordre[j].max - 0.5) c += 1; });
      }
    }
    return c;
  };
  let meilleur = base;
  let meilleurCout = cout(base);
  if (base.length > 1 && base.length <= 7 && meilleurCout > 0) {
    const essayer = (reste, courant) => {
      if (meilleurCout === 0) return;
      if (reste.length === 0) {
        const c = cout(courant);
        if (c < meilleurCout) { meilleurCout = c; meilleur = courant; }
        return;
      }
      reste.forEach((g, i) => essayer([...reste.slice(0, i), ...reste.slice(i + 1)], [...courant, g]));
    };
    essayer(base, []);
  }
  return { ordre: meilleur, croisements: meilleurCout };
}

// Construit tout le dessin et renvoie { svg, largeur, hauteur, croisements, detail } (ou null s'il n'y a rien à dessiner).
function construire(procedure, params = PARAMS_DEFAUT) {
  const { largeurInfo, largeurLabel, largeurCol: LARGEUR_COL } = params;
  const DEMI_BOITE = Math.round(LARGEUR_COL * 0.4); // demi-largeur d'une instruction (68 pour une colonne de 170)
  const cols = colonnes(procedure);
  const etapes = procedure.etapes.filter((e) => cols.some((c) => c.id === e.roleId));
  if (etapes.length === 0) return null;

  const indexCol = (roleId) => cols.findIndex((c) => c.id === roleId);
  const parts = [];
  const N = etapes.length;
  const relCol = (k) => k * LARGEUR_COL + LARGEUR_COL / 2; // centre de la colonne k, à partir du début des colonnes

  // ----- Renvois : destination de chaque alternative (indice d'instruction, N = fin, null = pas encore choisie) -----
  const rangDe = new Map(etapes.map((e, i) => [e.id, i]));
  const cibleDe = (a) => (a.vers === "fin" ? N : rangDe.has(a.vers) ? rangDe.get(a.vers) : null);
  const cibles = new Set(); // destinations qui reçoivent au moins un renvoi
  etapes.forEach((e) => (e.alternatives || []).forEach((a) => { const c = cibleDe(a); if (c !== null) cibles.add(c); }));
  const nbCouloirs = cibles.size;

  // ----- Mesure de chaque instruction -----
  let zoneEtiquettes = 0; // place à gauche de la première colonne pour écrire les paniers des alternatives
  const noeuds = etapes.map((e, k) => {
    const c = indexCol(e.roleId);
    let rel = relCol(c);
    let demiLargeur = DEMI_BOITE;
    let collab = null;
    if (e.participants.length) {
      const toutes = [c, ...e.participants.map(indexCol).filter((v) => v >= 0)];
      const mn = Math.min(...toutes);
      const mx = Math.max(...toutes);
      if (mx > mn) {
        collab = { toutes, responsable: c };
        rel = (relCol(mn) + relCol(mx)) / 2;
        demiLargeur = (relCol(mx) - relCol(mn)) / 2 + DEMI_BOITE;
      }
    }
    // Forme particulière de l'instruction (une seule à la fois) : sous-procédure, macro-instruction « alternatives » ou
    // « regroupement », renvoi au niveau 3 (zoom), ou instruction simple.
    const sp = e.sousProcedure || {};
    const macro = e.macro || {};
    const forme = sp.actif ? "sp" : macro.type === "alternatives" ? "macroAlt" : macro.type === "regroupement" ? "macroReg" : e.niveau3.actif ? "n3" : "";
    const retrait = forme === "sp" || forme === "macroAlt" ? 22 : forme === "macroReg" ? 22 : 14;
    const lignes = couper(e.libelle || t("logigramme.sans_libelle"), Math.max(6, Math.floor((demiLargeur * 2 - retrait) / PX_G12)));
    // Texte du bas de la forme : code de l'instruction de travail (niveau 3), code de la sous-procédure, détail du regroupement.
    const largeurExtra = Math.max(6, Math.floor((demiLargeur * 2 - (forme === "n3" ? 8 : 34)) / PX));
    const texteExtra = forme === "n3" ? `${t("logigramme.n3")} : ${e.niveau3.code.trim() || "?"}`
      : forme === "sp" ? (sp.code || "").trim().toUpperCase() || "?"
        : forme === "macroReg" ? (macro.detail || "").trim() : "";
    const lignesN3 = texteExtra ? couper(texteExtra, largeurExtra) : [];
    const hautN3 = lignesN3.length ? lignesN3.length * 12 + 6 : 0;
    const titreSP = forme === "sp" ? t("logigramme.sp") : "";
    const hautTitreSP = titreSP ? 13 : 0;
    // Macro-instruction « alternatives » : un compartiment en pointillé par alternative (exclusives).
    const caseCar = Math.max(8, Math.floor((demiLargeur * 2 - 26) / PX));
    const compartiments = forme === "macroAlt" ? (macro.alternatives || []).map((a) => {
      const lg = couper(String(a || "").trim() || "?", caseCar);
      return { lignes: lg, h: lg.length * 12 + 8 };
    }) : [];
    const hautCompartiments = compartiments.reduce((s_, c) => s_ + c.h, 0) + Math.max(0, compartiments.length - 1) * 4;
    // Alternatives : chacune part du tronc de sortie (sous l'instruction), vers la gauche, dans l'ordre qui évite les croisements
    // (renvois vers l'arrière d'abord, puis vers l'avant ; destination la plus basse en premier).
    const alts = (e.alternatives || []).map((a) => ({ alt: a, cible: cibleDe(a), panier: mesurerPanier(couper(a.condition || "", largeurLabel), couper(a.info || "", largeurLabel)) }));
    const categorie = (a) => (a.cible === null ? 2 : a.cible <= k ? 0 : 1);
    alts.sort((a, b) => categorie(a) - categorie(b) || (b.cible ?? 0) - (a.cible ?? 0));
    alts.forEach((a) => {
      a.slot = Math.max(a.panier ? a.panier.h : 0, 18) + 4;
      if (a.panier) zoneEtiquettes = Math.max(zoneEtiquettes, a.panier.w + 24 - rel);
    });
    const controle = e.controle && e.controle.actif ? (e.controle.nature || "?") : "";
    const correctrice = !controle && e.correctrice === true;
    const contrainte = e.contrainte && e.contrainte.actif ? { nature: e.contrainte.nature || "autre", lignes: couper(e.contrainte.texte || "", 18) } : null;
    const operateur = alts.length ? (e.operateurSortie === "et" && !controle ? "et" : "ou") : "";
    const entree = e.operateurEntree && cibles.has(k) ? e.operateurEntree : ""; // cercle ET / OU à l'arrivée des flèches
    const hauteurBoite = forme === "macroAlt"
      ? Math.max(40, 8 + lignes.length * HAUT_LIGNE_12 + 6 + hautCompartiments + 8)
      : Math.max(40, hautTitreSP + lignes.length * HAUT_LIGNE_12 + 14 + hautN3 + (forme === "macroReg" ? 6 : 0));
    const indicateur = !!(e.indicateur && e.indicateur.actif);
    const hautDessus = Math.max(collab ? 22 : 0, controle || correctrice ? 22 : 0, indicateur ? 22 : 0,
      contrainte ? Math.max(22, contrainte.lignes.length * 12 + 6) : 0, entree ? 30 : 0);
    const outils = e.outils.filter((o) => o.nom.trim()).map(formeOutil);
    const hautOutils = outils.reduce((s, o) => s + o.hauteur, 0) + Math.max(0, outils.length - 1) * 10;
    const bande = Math.max(hauteurBoite + hautDessus, hautOutils + (contrainte && hautOutils ? hautDessus : 0));
    return {
      type: "etape", etape: e, rel, demiLargeur, collab, lignes, lignesN3, hautN3, hauteurBoite, hautDessus, outils, hautOutils, bande,
      forme, titreSP, hautTitreSP, compartiments, indicateur,
      numero: k + 1, alts, controle, correctrice, contrainte, operateur, entree,
            hautAlts: alts.reduce((s, a) => s + a.slot, 0),
    };
  });

  const gouttiere = (nbCouloirs ? 12 + nbCouloirs * LARGEUR_LANE : 0) + Math.ceil(Math.max(0, zoneEtiquettes));
  const X0 = MARGE + gouttiere; // début de la première colonne
  const cx = (k) => X0 + relCol(k);
  noeuds.forEach((n) => { n.x = X0 + n.rel; });
  const gaucheMin = nbCouloirs ? MARGE + 8 + nbCouloirs * LARGEUR_LANE + 6 : MARGE; // bord gauche permis aux paniers et aux annotations

  // ----- Largeur utile : les colonnes, plus la place des outils et des contraintes s'ils dépassent -----
  let droite = X0 + cols.length * LARGEUR_COL + MARGE;
  noeuds.forEach((n) => {
    if (n.outils.length) droite = Math.max(droite, n.x + n.demiLargeur + ECART_OUTIL + Math.max(...n.outils.map((o) => o.largeur)) + MARGE);
    if (n.contrainte && n.contrainte.lignes.length) droite = Math.max(droite, n.x + n.demiLargeur + 30 + Math.max(...n.contrainte.lignes.map((l) => l.length * PX_GRAS)) + MARGE);
  });
  const largeurDispo = droite - MARGE - gaucheMin; // largeur permise à un panier ou à une annotation
  const maxCar = Math.max(LIGNE_MIN, Math.min(largeurInfo, Math.floor((largeurDispo - 16) / PX)));

  // ----- Bandeau du haut, puis en-tête : un ovale par rôle, aussi haut que le nom le demande -----
  const ban = mesurerBanniere(procedure, Math.max(droite, LARGEUR_BANNIERE_MIN));
  const nomsRoles = cols.map((r) => couper(r.nom, Math.floor((LARGEUR_COL - 36) / 8)));
  const ryRole = Math.max(18, ...nomsRoles.map((l) => (l.length * 14.4 + 10) / 2));
  const hautEntete = ryRole * 2 + 14;
  const yEntete = ban.hauteur + hautEntete / 2;

  // ----- Début (livre, §6.5.14) : « fait initial » écrit AU-DESSUS, cercle POSÉ SUR une barre, la flèche part de la barre vers le bas.
  // Une action amont REMPLACE le Début (fig. 7.7) : sa barre est reliée directement à la première instruction par une flèche oblique. -----
  const largeurRaccord = Math.min(droite - MARGE - gaucheMin, 320);
  const amont = mesurerRaccord(procedure.meta.amont || {}, "amont", largeurRaccord);
  const aval = mesurerRaccord(procedure.meta.aval || {}, "aval", largeurRaccord);
  // Avec une action amont ou aval, la flèche oblique est dans l'axe de la première ou de la dernière instruction (pas de décrochement).
  const xDebut = amont ? noeuds[0].x : cx(indexCol(etapes[0].roleId));
  const xFin = aval ? noeuds[N - 1].x : cx(indexCol(etapes[N - 1].roleId));
  // Annotation au-dessus du Début ou en dessous de la Fin : centrée sur le symbole, décalée seulement si elle sortirait du dessin
  // (le Début est souvent dans la première colonne). Lignes assez longues pour rester sur peu de hauteur.
  const annoterCentre = (texte, x) => {
    const cars = Math.max(16, Math.min(LIGNE_ANNOTATION, Math.floor((droite - MARGE - gaucheMin - 8) / PX)));
    const lignes = couper(texte, cars);
    const largeurTexte = Math.max(...lignes.map((l) => l.length)) * PX + 8;
    return { lignes, haut: lignes.length * 12, xc: placerCentre(x, largeurTexte, gaucheMin, droite - MARGE) };
  };
  const texteDebut = (procedure.meta.declencheur || "").trim() || t("logigramme.debut");
  const yTeteBas = ban.hauteur + hautEntete;
  const R_SYMBOLE = 10; // rayon du cercle de Début / de Fin
  const H_BARRE = 3.4; // épaisseur de la barre de Début / de Fin
  const debutDessin = { amont: null, ann: null, yTexte: 0, yBoite: 0, xBoite: 0, yCercle: 0, yBarre: 0 };
  const debut = { type: "debut", x: xDebut, hautAlts: 0, alts: [] };
  if (amont) {
    // Action amont (ovale de rôle, texte, barre) : elle remplace le symbole Début.
    debutDessin.amont = amont;
    debutDessin.yBoite = yTeteBas + 2;
    debutDessin.xBoite = placerCentre(xDebut - amont.dx, amont.largeur, gaucheMin, droite - MARGE); // la flèche descend vers la droite : la barre est à gauche
    debut.boxBottom = debutDessin.yBoite + amont.hauteur;
  } else {
    debutDessin.ann = annoterCentre(texteDebut, xDebut);
    debutDessin.yTexte = yTeteBas + 1 + debutDessin.ann.haut / 2;
    debutDessin.yCercle = yTeteBas + 1 + debutDessin.ann.haut + 3 + R_SYMBOLE;
    debutDessin.yBarre = debutDessin.yCercle + R_SYMBOLE; // la barre touche le bas du cercle
    debut.boxBottom = debutDessin.yBarre + H_BARRE;
  }
  debut.bandeBas = debut.boxBottom;

  // ----- Positions verticales : l'écart entre deux lignes dépend du panier d'information de la flèche -----
  // Dernière flèche vers une action aval : l'information de l'action aval remplace la sortie de la dernière instruction (une seule flèche, un seul panier).
  const infoAval = aval ? ((procedure.meta.aval && procedure.meta.aval.information) || "").trim() : "";
  const panierDe = (a) => {
    if (!a.etape) return null;
    const contrat = !!(a.etape.contrat && a.etape.contrat.actif);
    let sortieAffichee = a === noeuds[N - 1] && infoAval ? infoAval : a.etape.sortie || "";
    // Un contrat se pose sur un panier : sans information à écrire, le panier porte la référence du contrat.
    if (contrat && !sortieAffichee.trim() && !(a.etape.condition || "").trim()) sortieAffichee = (a.etape.contrat.reference || "").trim() || t("logigramme.contrat");
    return mesurerPanier(couper(a.etape.condition || "", maxCar), couper(sortieAffichee, maxCar), contrat);
  };
  const ecartPour = (panier) => Math.max(ECART_MIN, panier ? panier.h + 12 : 0);
  // Sortie d'une instruction = tout ce qui sépare son bas du haut de la suivante. Sans alternative : la flèche et son panier.
  // Avec alternatives : le cercle ou / et est sur la ligne de la première alternative, chaque alternative a son panier à gauche
  // du tronc, et le panier de la sortie principale se place à droite du tronc, à la même hauteur (comme un carrefour), s'il y a la place.
  // Action amont : la flèche du bas de la barre vers la première instruction est oblique (zone = hauteur de cette flèche).
  // Action aval : le tronc reste vertical (renvois vers la fin), puis la flèche finit en oblique sur la barre de l'action aval.
  const sortie = (a) => {
    if (a === debut && amont) return { panier: null, aDroite: false, decal: 0, bande: 0, zone: ecartRaccord(amont) };
    const panier = panierDe(a);
    const versFin = a === noeuds[N - 1] && cibles.has(N); // un renvoi vers la fin rejoint la flèche, au-dessus du panier
    const rallonge = versFin ? 12 : 0;
    const versAval = a === noeuds[N - 1] && !!aval;
    const ecart = versAval ? ecartOblique : ecartPour;
    if (!a.alts.length) return { panier, aDroite: false, decal: 0, bande: 0, zone: ecart(panier) + rallonge, rallonge };
    const aDroite = !!panier && panier.w + 14 <= droite - MARGE - a.x;
    return { panier, aDroite, decal: DECALAGE_SORTIE, bande: Math.max(a.hautAlts, aDroite ? panier.h + 6 : 0), zone: aDroite ? (versAval ? 24 : FLECHE_MIN) : ecart(panier) + rallonge, rallonge };
  };
  const paires = [];
  const relie = (a, b, bas) => {
    const so = sortie(a);
    const yAlt0 = a.bandeBas + so.decal;
    const yMain0 = yAlt0 + so.bande;
    paires.push({ a, b, so, panier: so.panier, zone: so.zone, yAlt0, yMain0, ySaut: so.panier && !so.aDroite ? yMain0 + so.zone - 6 - so.panier.h / 2 : yMain0 + so.zone / 2, bas });
    return yMain0 + so.zone; // haut de la bande de b
  };
  let precedent = debut;
  noeuds.forEach((n) => {
    const so = sortie(precedent);
    const haut = precedent.bandeBas + so.decal + so.bande + so.zone;
    n.hautHaut = haut;
    n.y = haut + (n.bande - (n.hautDessus + n.hauteurBoite)) / 2 + n.hautDessus + n.hauteurBoite / 2;
    n.demi = n.hauteurBoite / 2;
    n.boxHaut = n.y - n.demi;
    n.boxBas = n.y + n.demi;
    n.yOutils = n.contrainte && n.hautOutils ? haut + n.hautDessus + (n.bande - n.hautDessus - n.hautOutils) / 2 : haut + (n.bande - n.hautOutils) / 2;
    n.bandeBas = haut + n.bande;
    n.yEntree = n.boxHaut - 17; // centre du cercle d'entrée
    n.arrivee = n.entree ? n.yEntree - 9 : n.boxHaut; // où la flèche principale s'arrête
    relie(precedent, n, n.arrivee);
    precedent = n;
  });
  const dernier = noeuds[N - 1];
  const soDernier = sortie(dernier);
  const hautFin = dernier.bandeBas + soDernier.decal + soDernier.bande + soDernier.zone;
  const fin = { type: "fin", x: xFin, top: hautFin };
  relie(dernier, fin, hautFin);
  const texteFin = (procedure.meta.fin || "").trim() || t("logigramme.fin");
  const finDessin = { aval: null, ann: null, yTexte: 0, yBoite: 0, xBoite: 0, yBarre: 0, yCercle: 0, dxQueue: 0 };
  let hauteur;
  if (aval) {
    // Action aval : elle remplace le symbole Fin (fig. 7.7). Sa barre (en haut), le texte, puis l'ovale de rôle sont sous la flèche oblique.
    const soFin = paires[paires.length - 1].so;
    finDessin.aval = aval;
    finDessin.dxQueue = Math.round((soFin.zone - soFin.rallonge) * PENTE_RACCORD);
    finDessin.yBoite = hautFin;
    finDessin.xBoite = placerCentre(xFin + finDessin.dxQueue, aval.largeur, gaucheMin, droite - MARGE); // la flèche descend vers la droite : la barre est à droite
    hauteur = Math.ceil(finDessin.yBoite + aval.hauteur + 8);
  } else {
    // Fin (livre, §6.5.15) : la flèche arrive sur la barre, le cercle est DESSOUS, le fait aval (suite donnée) est écrit sous le cercle.
    finDessin.ann = annoterCentre(texteFin, xFin);
    finDessin.yBarre = hautFin;
    finDessin.yCercle = hautFin + H_BARRE + R_SYMBOLE; // le cercle touche le bas de la barre
    finDessin.yTexte = finDessin.yCercle + R_SYMBOLE + 3 + finDessin.ann.haut / 2;
    hauteur = Math.ceil(finDessin.yCercle + R_SYMBOLE + 3 + finDessin.ann.haut + 5);
  }
  // Un renvoi vers la fin rejoint la flèche qui va de la dernière instruction au symbole Fin, juste sous l'instruction.
  const paireFin = paires[paires.length - 1];
  const fusion = { x: dernier.x, y: paireFin.yMain0 + 7 };

  // ----- Renvois : départs (sur le tronc, sous les instructions), couloirs et arrivées -----
  const parCible = new Map();
  const groupes = [];
  noeuds.forEach((n, k) => {
    const yAlt0 = paires[k + 1 <= N ? k + 1 : k].yAlt0; // la paire qui PART de cette instruction est la suivante dans la liste
    let y = yAlt0;
    n.alts.forEach((a) => {
      a.yTrait = y + a.slot / 2 - 2;
      y += a.slot;
      a.retour = a.cible === null || a.cible < k;
      if (a.cible === null) return;
      if (!parCible.has(a.cible)) {
        const dest = a.cible < N
          ? (noeuds[a.cible].entree
            ? { x: noeuds[a.cible].x - 9, y: noeuds[a.cible].yEntree }
            : { x: noeuds[a.cible].x - noeuds[a.cible].demiLargeur, y: noeuds[a.cible].y })
          : fusion;
        const g = { cible: a.cible, dest, departs: [], retour: false };
        parCible.set(a.cible, g);
        groupes.push(g);
      }
      const g = parCible.get(a.cible);
      g.departs.push({ x: n.x, y: a.yTrait });
      if (a.retour) g.retour = true;
      a.groupe = g;
    });
  });
  groupes.forEach((g) => {
    g.horiz = [...g.departs.map((d) => d.y), g.dest.y];
    g.min = Math.min(...g.horiz);
    g.max = Math.max(...g.horiz);
  });
  const { ordre: ordreCouloirs, croisements } = ordonnerCouloirs(groupes);

  // ----- Dessin -----
  const flecheDef = (id, couleur) => `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="${couleur}"/></marker>`;
  const flecheGriseDef = `<marker id="flecheGrise" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L10 5L0 10z" fill="${GRIS_TEXTE}"/></marker>`;
  const flechePetiteDef = `<marker id="flechePetite" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L10 5L0 10z" fill="${SARCELLE}"/></marker>`; // pointe des flèches obliques amont / aval
  parts.push(`<defs>${flecheDef("fleche", SARCELLE)}${flecheDef("flecheRouge", ROUGE)}${flecheGriseDef}${flechePetiteDef}</defs>`);
  parts.push(ban.dessiner(Math.ceil(Math.max(droite, LARGEUR_BANNIERE_MIN))));
  const largeur = Math.ceil(Math.max(droite, LARGEUR_BANNIERE_MIN));
  // Couloirs de rôles : fond gris une colonne sur deux, filets verticaux, repères horizontaux en pointillé entre les lignes.
  cols.forEach((role, k) => {
    if (k % 2 === 1) parts.push(`<rect x="${X0 + k * LARGEUR_COL}" y="${ban.hauteur}" width="${LARGEUR_COL}" height="${hauteur - ban.hauteur}" fill="${GRIS_COULOIR}"/>`);
  });
  for (let k = 0; k <= cols.length; k += 1) {
    parts.push(`<line x1="${X0 + k * LARGEUR_COL}" y1="${ban.hauteur}" x2="${X0 + k * LARGEUR_COL}" y2="${hauteur}" stroke="${GRIS_LIGNE}" stroke-width="1.2"/>`);
  }
  noeuds.forEach((n, k) => {
    const y = (paires[k].a.bandeBas + n.hautHaut) / 2;
    parts.push(`<line x1="${X0}" y1="${r1(y)}" x2="${X0 + cols.length * LARGEUR_COL}" y2="${r1(y)}" stroke="${GRIS_LIGNE}" stroke-width="1" stroke-dasharray="5 4"/>`);
  });
  cols.forEach((role, k) => {
    const epais = role.type === "unite" ? 4.4 : 2.2;
    if (role.type === "externe") parts.push(`<ellipse cx="${cx(k) + 4}" cy="${yEntete + 4}" rx="${LARGEUR_COL / 2 - 10}" ry="${ryRole}" fill="${GRIS_LIGNE}"/>`);
    parts.push(`<ellipse cx="${cx(k)}" cy="${yEntete}" rx="${LARGEUR_COL / 2 - 10}" ry="${ryRole}" fill="#fff" stroke="${SARCELLE}" stroke-width="${epais}"/>`);
    parts.push(txt(nomsRoles[k], cx(k), yEntete, { taille: 12, gras: true }));
  });

  // Début : « fait initial » en italique AU-DESSUS, cercle posé sur la barre (comme dans le livre) ; la flèche part de la barre.
  // Avec une action amont : seule l'action amont (ovale de rôle, texte gras, barre) est dessinée, à la place du Début.
  if (amont) {
    parts.push(dessinerRaccord(amont, debutDessin.xBoite, debutDessin.yBoite, xDebut - amont.dx));
  } else {
    parts.push(txt(debutDessin.ann.lignes, debutDessin.ann.xc, debutDessin.yTexte, { taille: 10, italique: true, couleur: GRIS_TEXTE }));
    parts.push(`<circle cx="${xDebut}" cy="${r1(debutDessin.yCercle)}" r="${R_SYMBOLE}" fill="#fff" stroke="${SARCELLE}" stroke-width="2.2"/>`);
    parts.push(`<rect x="${xDebut - 15}" y="${r1(debutDessin.yBarre)}" width="30" height="${H_BARRE}" fill="${SARCELLE}"/>`);
  }

  // Flèches principales : de l'instruction (ou du cercle ou / et) à la suivante ; le panier d'information est posé dessus.
  const paniersPrincipaux = [];
  paires.forEach((p) => {
    const { a, b } = p;
    const y1 = a.boxBas ?? a.boxBottom;
    const bx = b.x;
    if (a === debut && amont) {
      // Action amont → première instruction : flèche oblique descendante (panier de l'information de l'action amont).
      parts.push(flecheRaccord(amont, xDebut - amont.dx, y1, bx, p.bas - 0.5));
    } else if (b === fin && aval) {
      // Dernière instruction → action aval : tronc vertical jusqu'aux renvois vers la fin, puis flèche oblique sur la barre de l'action aval.
      const yQueue = p.yMain0 + p.so.rallonge;
      if (yQueue > y1) parts.push(`<path d="M${a.x} ${r1(y1)}V${r1(yQueue)}" fill="none" stroke="${SARCELLE}" stroke-width="1.8"/>`);
      parts.push(flecheRaccord({ panier: p.panier && !p.so.aDroite ? p.panier : null }, a.x, yQueue, a.x + finDessin.dxQueue, p.bas - 0.5));
      if (p.panier && p.so.aDroite) paniersPrincipaux.push(dessinerPanier(p.panier, a.x + 12 + p.panier.w / 2, p.yAlt0 + 2 + p.panier.h / 2));
    } else {
      const chemin = a.x === bx ? `M${a.x} ${r1(y1)}V${r1(p.bas)}` : `M${a.x} ${r1(y1)}V${r1(p.ySaut)}H${bx}V${r1(p.bas)}`;
      parts.push(`<path d="${chemin}" fill="none" stroke="${SARCELLE}" stroke-width="1.8" stroke-linejoin="round" marker-end="url(#fleche)"/>`);
      if (p.panier && p.so.aDroite) {
        paniersPrincipaux.push(dessinerPanier(p.panier, a.x + 12 + p.panier.w / 2, p.yAlt0 + 2 + p.panier.h / 2));
      } else if (p.panier) {
        const xc = placerCentre(a.x === bx ? a.x : (a.x + bx) / 2, p.panier.w, gaucheMin, droite - MARGE);
        paniersPrincipaux.push(dessinerPanier(p.panier, xc, p.ySaut));
      }
    }
    if (b.entree) parts.push(`<path d="M${bx} ${r1(b.yEntree + 9)}V${r1(b.boxHaut)}" fill="none" stroke="${SARCELLE}" stroke-width="1.8" marker-end="url(#fleche)"/>`);
  });

  // Renvois : couloirs verticaux dans la gouttière de gauche ; un point marque chaque jonction au milieu d'un couloir.
  const paniersAlt = [];
  ordreCouloirs.forEach((g, rang) => {
    const lx = MARGE + 8 + rang * LARGEUR_LANE;
    const couleur = g.retour ? ROUGE : SARCELLE;
    const trait = `fill="none" stroke="${couleur}" stroke-width="1.8" stroke-linejoin="round"${g.retour ? ' stroke-dasharray="7 4"' : ""}`;
    parts.push(`<path d="M${lx} ${r1(g.min)}V${r1(g.max)}" ${trait}/>`);
    g.departs.forEach((d) => parts.push(`<path d="M${d.x} ${r1(d.y)}H${lx}" ${trait}/>`));
    parts.push(`<path d="M${lx} ${r1(g.dest.y)}H${r1(g.dest.x)}" ${trait}${g.cible < N ? ` marker-end="url(#${g.retour ? "flecheRouge" : "fleche"})"` : ""}/>`);
    g.horiz.forEach((y) => {
      if (y > g.min + 0.5 && y < g.max - 0.5) parts.push(`<circle cx="${lx}" cy="${r1(y)}" r="2.6" fill="${couleur}"/>`);
    });
    if (g.cible >= N) parts.push(`<circle cx="${r1(g.dest.x)}" cy="${r1(g.dest.y)}" r="2.6" fill="${couleur}"/>`);
  });

  // Corps d'une instruction selon sa forme : simple, renvoi au niveau 3 (libellé souligné), sous-procédure (cadre gras, titre
  // « SOUS-PROCÉDURE », code, triangle en bas à gauche), macro-instruction « regroupement » (bord double) ou « alternatives »
  // (cadre gras titré, un compartiment en pointillé par alternative).
  const corpsInstruction = (n) => {
    const { x, demiLargeur, boxHaut, boxBas } = n;
    const gauche = x - demiLargeur;
    const largeurBoite = demiLargeur * 2;
    const cadre = (epais, retrait = 0, fond = "#fff") =>
      `<rect x="${r1(gauche + retrait)}" y="${r1(boxHaut + retrait)}" width="${r1(largeurBoite - retrait * 2)}" height="${r1(n.demi * 2 - retrait * 2)}" fill="${fond}" stroke="${SARCELLE}" stroke-width="${epais}"/>`;
    const bas = () => (n.lignesN3.length ? txt(n.lignesN3, x, boxBas - 3 - n.hautN3 / 2 - 1, { taille: 10, couleur: SARCELLE }) : "");
    if (n.forme === "macroAlt") {
      let s_ = cadre(4.4);
      s_ += txt(n.lignes, x, boxHaut + 8 + (n.lignes.length * HAUT_LIGNE_12) / 2, { taille: 12, gras: true });
      let y = boxHaut + 8 + n.lignes.length * HAUT_LIGNE_12 + 6;
      n.compartiments.forEach((c) => {
        s_ += `<rect x="${r1(gauche + 8)}" y="${r1(y)}" width="${r1(largeurBoite - 16)}" height="${r1(c.h)}" fill="none" stroke="${SARCELLE}" stroke-width="1.3" stroke-dasharray="4 3"/>`;
        s_ += txt(c.lignes, x, y + c.h / 2, { taille: 10 });
        y += c.h + 4;
      });
      return s_;
    }
    if (n.forme === "sp") {
      let s_ = cadre(4.4);
      s_ += `<text x="${r1(x)}" y="${r1(boxHaut + 12)}" text-anchor="middle" font-size="8" font-weight="700" letter-spacing="0.8" fill="${SARCELLE}">${echapper(n.titreSP)}</text>`;
      s_ += txt(n.lignes, x, boxHaut + n.hautTitreSP + 4 + (n.lignes.length * HAUT_LIGNE_12) / 2, { taille: 12, gras: true });
      s_ += bas();
      // Indicateur (triangle) en bas à gauche.
      s_ += `<polygon points="${r1(gauche + 8)},${r1(boxBas - 6)} ${r1(gauche + 22)},${r1(boxBas - 6)} ${r1(gauche + 15)},${r1(boxBas - 18)}" fill="#fff" stroke="${SARCELLE}" stroke-width="1.6" stroke-linejoin="round"/>`;
      return s_;
    }
    if (n.forme === "macroReg") {
      let s_ = cadre(2.4) + cadre(1.4, 4.5, "none");
      s_ += txt(n.lignes, x, boxHaut + 10 + (n.lignes.length * HAUT_LIGNE_12) / 2, { taille: 12, gras: true });
      s_ += bas();
      return s_;
    }
    let s_ = cadre(2.4);
    if (n.lignesN3.length) {
      s_ += txt(n.lignes, x, boxHaut + 8 + (n.lignes.length * HAUT_LIGNE_12) / 2, { taille: 12, gras: true, souligne: n.forme === "n3" });
      s_ += bas();
    } else {
      s_ += txt(n.lignes, x, n.y, { taille: 12, gras: true });
    }
    return s_;
  };

  // Formes.
  noeuds.forEach((n) => {
    const { x, demiLargeur, boxHaut, boxBas } = n;
    parts.push(corpsInstruction(n));
    parts.push(`<text x="${r1(x - demiLargeur - 4)}" y="${r1(boxHaut + 10)}" text-anchor="end" font-size="10" fill="${GRIS_TEXTE}">${n.numero}</text>`);
    // Contrôle : triangle en haut à droite de l'instruction, avec la lettre de la nature du contrôle (Q, H, S, R, E).
    const xt = x + demiLargeur - 14;
    if (n.controle) {
      parts.push(`<polygon points="${r1(xt)},${r1(boxHaut - 19)} ${r1(xt + 13)},${r1(boxHaut)} ${r1(xt - 13)},${r1(boxHaut)}" fill="#fff" stroke="${SARCELLE}" stroke-width="2" stroke-linejoin="round"/>`);
      parts.push(`<text x="${r1(xt)}" y="${r1(boxHaut - 3)}" text-anchor="middle" font-size="10" font-weight="700" fill="${SARCELLE}">${echapper(n.controle)}</text>`);
    }
    if (n.correctrice) parts.push(symboleRecyclage(r1(xt), r1(boxHaut)));
    // Indicateur de performance : fanion sur le bord haut, à gauche du triangle ou du cercle de contrainte s'il y en a.
    if (n.indicateur) {
      const base = x + demiLargeur;
      parts.push(fanion(n.controle || n.correctrice ? base - 43 : n.contrainte ? base - 22 : base - 12, boxHaut));
    }
    // Contrainte de délai ou de coût : cercle sur le coin haut droit (à droite du triangle s'il y en a un) et texte à côté.
    if (n.contrainte) {
      const xc = x + demiLargeur + (n.controle || n.correctrice ? 12 : -4);
      parts.push(cercleContrainte(r1(xc), r1(boxHaut)));
      if (n.contrainte.lignes.length) parts.push(txt(n.contrainte.lignes, xc + 15, boxHaut - 2 - n.contrainte.lignes.length * 6, { taille: 10, gras: true, couleur: SARCELLE, ancre: "start" }));
    }
    // Opérateur d'entrée (ET / OU) : cercle sur l'arrivée des flèches, au-dessus de l'instruction.
    if (n.entree) parts.push(cercleOperateur(x, n.yEntree, n.entree));
    // Instruction collaborative : petits ovales R (responsable) et P (participants) au-dessus.
    if (n.collab) {
      n.collab.toutes.forEach((c) => {
        const ox = cx(c);
        const oy = boxHaut - 12;
        parts.push(`<line x1="${ox}" y1="${oy + 8}" x2="${ox}" y2="${r1(boxHaut)}" stroke="${SARCELLE}" stroke-width="1.4"/>`);
        parts.push(`<ellipse cx="${ox}" cy="${r1(oy)}" rx="14" ry="8" fill="#fff" stroke="${SARCELLE}" stroke-width="1.8"/>`);
        parts.push(`<text x="${ox}" y="${r1(oy + 3.5)}" text-anchor="middle" font-size="9.5" font-weight="700" fill="${SARCELLE}">${c === n.collab.responsable ? "R" : "P"}</text>`);
      });
    }
    // Outils : posés à droite de l'instruction, reliés par un trait pointillé (pas de colonne dédiée).
    if (n.outils.length) {
      const xBord = x + demiLargeur;
      const xOutil = xBord + ECART_OUTIL;
      const xBus = xBord + ECART_OUTIL / 2;
      let y = n.yOutils;
      const centres = [];
      n.outils.forEach((o) => {
        parts.push(o.dessiner(xOutil, y));
        centres.push(y + (o.hauteur - (o.largeur === LARGEUR_OUTIL ? 8 : 0)) / 2);
        y += o.hauteur + 10;
      });
      const pointille = `stroke="${GRIS_TEXTE}" stroke-width="1.3" stroke-dasharray="4 3" fill="none"`;
      const ys = [n.y, ...centres];
      parts.push(`<path d="M${xBus} ${r1(n.y)}H${xBord}" ${pointille} marker-end="url(#flecheGrise)"/>`);
      parts.push(`<line x1="${xBus}" y1="${r1(Math.min(...ys))}" x2="${xBus}" y2="${r1(Math.max(...ys))}" ${pointille}/>`);
      centres.forEach((c) => parts.push(`<line x1="${xBus}" y1="${r1(c)}" x2="${xOutil}" y2="${r1(c)}" ${pointille}/>`));
    }
  });

  // Sortie des décisions : cercle ou / et sur la ligne de la première alternative ; les suivantes = jonction sur le tronc ; panier sur chaque trait.
  noeuds.forEach((n, k) => {
    if (!n.operateur) return;
    n.alts.forEach((a, j) => {
      const couleur = a.retour ? ROUGE : SARCELLE;
      if (j > 0) parts.push(`<circle cx="${n.x}" cy="${r1(a.yTrait)}" r="2.6" fill="${couleur}"/>`);
      if (a.panier) paniersAlt.push(dessinerPanier(a.panier, n.x - 16 - a.panier.w / 2, a.yTrait, couleur));
      if (a.cible === null) {
        const xFinTrait = n.x - 16 - (a.panier ? a.panier.w : 0) - 16;
        parts.push(`<path d="M${n.x} ${r1(a.yTrait)}H${r1(xFinTrait)}" fill="none" stroke="${ROUGE}" stroke-width="1.8" stroke-dasharray="4 3"/>`);
        parts.push(`<text x="${r1(xFinTrait - 4)}" y="${r1(a.yTrait + 4)}" text-anchor="end" font-size="11" font-weight="700" fill="${ROUGE}">?</text>`);
      }
    });
    parts.push(cercleOperateur(n.x, n.alts[0].yTrait, n.operateur)); // sur la ligne de la première alternative
  });
  paniersPrincipaux.forEach((p) => parts.push(p));
  paniersAlt.forEach((p) => parts.push(p));

  // Fin (livre, §6.5.15) : la flèche arrive sur la barre, le cercle est dessous, puis le fait aval en italique.
  // Avec une action aval : seule l'action aval (barre, texte gras, ovale de rôle) est dessinée, à la place de la Fin.
  if (aval) {
    parts.push(dessinerRaccord(aval, finDessin.xBoite, finDessin.yBoite, xFin + finDessin.dxQueue));
  } else {
    parts.push(`<rect x="${xFin - 15}" y="${r1(finDessin.yBarre)}" width="30" height="${H_BARRE}" fill="${SARCELLE}"/>`);
    parts.push(`<circle cx="${xFin}" cy="${r1(finDessin.yCercle)}" r="${R_SYMBOLE}" fill="#fff" stroke="${SARCELLE}" stroke-width="2.2"/>`);
    parts.push(txt(finDessin.ann.lignes, finDessin.ann.xc, finDessin.yTexte, { taille: 10, italique: true, couleur: GRIS_TEXTE }));
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" font-family="${POLICE}" width="${largeur}" height="${hauteur}" viewBox="0 0 ${largeur} ${hauteur}" role="img">${parts.join("")}</svg>`;
  const detail = { entete: Math.round(ban.hauteur + hautEntete), gouttiere: Math.round(gouttiere), params };
  return { svg, largeur, hauteur, croisements, detail };
}

// ----- Choix de la mise en page -----
// Un logigramme trop long est réduit pour tenir sur UNE page A4 : plus il est grand, plus le texte devient petit.
// On dessine donc le même logigramme avec plusieurs réglages (largeur des colonnes, longueur des lignes de texte)
// et on garde celui qui donne le texte le plus grand une fois sur la page — en visant d'abord zéro croisement de flèches.
// La page peut être en portrait ou en paysage (comme dans le modèle de procédure) : on retient l'orientation qui donne
// le texte le plus grand. Rien n'est coupé : seuls les retours à la ligne et les proportions changent.

// Zone utile de la page du logigramme, en pixels à 96 dpi, une fois retirés les marges du modèle, le titre de la section 7
// et une ligne d'introduction. Portrait : marges 900 haut/bas, 1134 gauche, 900 droite ; paysage : 600 haut, 950 bas, 1134 gauche, 700 droite.
export const PAGE_PORTRAIT = { largeur: 658, hauteur: 900 };
export const PAGE_PAYSAGE = { largeur: 1001, hauteur: 590 };
const ECHELLE_MAX = 1.3; // au-delà, un petit dessin serait agrandi inutilement
const GAIN_MIN = 1.01; // un autre réglage doit gagner au moins 1 % pour remplacer le réglage par défaut (dessin stable)

const echelleDans = (zone, largeur, hauteur) => Math.min(zone.largeur / largeur, zone.hauteur / hauteur, ECHELLE_MAX);

// Meilleure page pour un dessin : { echelle, orientation }. À égalité, le paysage (orientation du modèle).
export function meilleurePage(largeur, hauteur) {
  const paysage = echelleDans(PAGE_PAYSAGE, largeur, hauteur);
  const portrait = echelleDans(PAGE_PORTRAIT, largeur, hauteur);
  return paysage >= portrait ? { echelle: paysage, orientation: "paysage" } : { echelle: portrait, orientation: "portrait" };
}
const echelleSurA4 = (largeur, hauteur) => meilleurePage(largeur, hauteur).echelle;

// Tous les réglages à essayer : le réglage par défaut d'abord, puis les autres du plus petit au plus grand.
// (La longueur des étiquettes d'alternatives ne change rien s'il n'y a aucune alternative : on ne l'essaie alors pas.)
const memesReglages = (a, b) => a.largeurInfo === b.largeurInfo && a.largeurLabel === b.largeurLabel && a.largeurCol === b.largeurCol;
function reglagesAEssayer(avecAlternatives) {
  const liste = [PARAMS_DEFAUT];
  GRILLE_COL.forEach((col) => (avecAlternatives ? GRILLE_LABEL : [PARAMS_DEFAUT.largeurLabel]).forEach((label) => GRILLE_INFO.forEach((info) => {
    const r = { largeurInfo: info, largeurLabel: label, largeurCol: col };
    if (!memesReglages(r, PARAMS_DEFAUT)) liste.push(r);
  })));
  return liste;
}

function choisirMiseEnPage(procedure) {
  let meilleur = null;
  let meilleureEchelle = 0;
  for (const params of reglagesAEssayer(procedure.etapes.some((e) => (e.alternatives || []).length > 0))) {
    const r = construire(procedure, params);
    if (!r) return null;
    const echelle = echelleSurA4(r.largeur, r.hauteur);
    const mieux = !meilleur || r.croisements < meilleur.croisements || (r.croisements === meilleur.croisements && echelle > meilleureEchelle * GAIN_MIN);
    if (mieux) { meilleur = r; meilleureEchelle = echelle; }
    if (meilleur.croisements === 0 && meilleureEchelle >= ECHELLE_MAX) break; // rien de mieux possible
  }
  meilleur.echelle = meilleureEchelle;
  meilleur.orientation = meilleurePage(meilleur.largeur, meilleur.hauteur).orientation;
  return meilleur;
}

// Le résultat ne dépend que de ce qui se voit dans le dessin : on le garde tant que ces éléments ne changent pas
// (la page appelle plusieurs fonctions à chaque frappe ; le calcul complet n'est fait qu'une fois).
let cleMiseEnPage = null;
let resultat = null;
function miseEnPage(procedure) {
  const clef = JSON.stringify([
    langueCourante(), procedure.meta.declencheur, procedure.meta.fin,
    procedure.meta.amont && [procedure.meta.amont.texte, procedure.meta.amont.role, procedure.meta.amont.information], procedure.meta.aval && [procedure.meta.aval.texte, procedure.meta.aval.role, procedure.meta.aval.information],
    // bandeau : tout ce qui s'y écrit
    procedure.meta.titre, procedure.meta.reference, procedure.meta.version, procedure.meta.processus, procedure.meta.domaine, procedure.meta.dateApplication,
    ["redige", "verifie", "approuve"].map((k) => procedure.meta.signataires && procedure.meta.signataires[k] && procedure.meta.signataires[k].nom),
    procedure.roles.map((r) => [r.id, r.nom, r.type]),
    procedure.etapes.map((e) => [e.id, e.roleId, e.libelle, e.sortie, e.condition, e.participants, e.niveau3.actif, e.niveau3.code,
      e.outils.map((o) => [o.nom, o.type]), e.controle && [e.controle.actif, e.controle.nature],
      e.operateurSortie, e.operateurEntree, e.correctrice, e.contrainte && [e.contrainte.actif, e.contrainte.nature, e.contrainte.texte],
      e.indicateur && e.indicateur.actif, e.contrat && [e.contrat.actif, e.contrat.reference], e.sousProcedure && [e.sousProcedure.actif, e.sousProcedure.code],
      e.macro && [e.macro.type, e.macro.detail, e.macro.alternatives],
      (e.alternatives || []).map((a) => [a.condition, a.info, a.vers])]),
  ]);
  if (clef !== cleMiseEnPage) {
    resultat = choisirMiseEnPage(procedure);
    cleMiseEnPage = clef;
  }
  return resultat;
}

export function dessinerNiveau2(procedure) {
  const r = miseEnPage(procedure);
  return r ? r.svg : "";
}

// Réglages retenus pour cette procédure (largeur des colonnes, longueur des lignes de texte) : pour les tests et le diagnostic.
export function parametresMiseEnPage(procedure) {
  const r = miseEnPage(procedure);
  return r ? { ...r.detail.params } : null;
}

// Échelle qu'aurait le dessin avec les réglages par défaut (pour vérifier que le choix ne fait jamais moins bien).
export function echelleReglageParDefaut(procedure) {
  const r = construire(procedure, PARAMS_DEFAUT);
  return r ? echelleSurA4(r.largeur, r.hauteur) : null;
}

// Comment le dessin est posé sur sa page : orientation, échelle et taille finale (pixels à 96 dpi). Sert au Word et à l'aperçu.
export function disposerNiveau2(procedure) {
  const r = miseEnPage(procedure);
  return r ? { orientation: r.orientation, echelle: r.echelle, largeur: r.largeur * r.echelle, hauteur: r.hauteur * r.echelle } : null;
}

// Taille (en pixels) du dessin : sert à vérifier qu'il tient sur UNE page A4.
export function mesurerNiveau2(procedure) {
  const r = miseEnPage(procedure);
  return r ? { largeur: r.largeur, hauteur: r.hauteur } : null;
}

// Nombre de croisements entre les flèches de renvoi (le langage demande de ne jamais croiser les flèches).
export function croisementsNiveau2(procedure) {
  const r = miseEnPage(procedure);
  return r ? r.croisements : 0;
}

// ----- Conseils de lisibilité -----
// Quand le texte serait trop petit sur A4, on cherche les textes les plus longs dont le raccourcissement rendrait le plus de place,
// et on dit ce que chacun rapporterait (en points). Le calcul se fait sur des copies : la procédure n'est jamais modifiée.
export const SEUIL_PT = 5.5; // en dessous, le texte du logigramme est jugé trop petit (5,6 pt a été jugé acceptable lors des essais, 29/09/2026)
const LONGUEURS_CONSEILLEES = { declencheur: 45, fin: 45, sortie: 45, condition: 30, alt_condition: 30, alt_info: 30, libelle: 60 };
const NB_CONSEILS = 4;
const pointsDe = (echelle) => echelle * 7.5; // texte de 10 px : 10 px x echelle x 72/96

// Raccourcit à ~max caractères en coupant entre deux mots (sert seulement à estimer le gain).
function raccourcir(texte, max) {
  const coupe = String(texte).slice(0, max + 1);
  const espace = coupe.lastIndexOf(" ");
  return (coupe.length > max ? coupe.slice(0, espace > max / 2 ? espace : max) : coupe).trim();
}

let cleConseils = null;
let resultatConseils = null;

// Renvoie null si le texte est assez grand ; sinon { pt, conseils: [{ champ, n, texte, longueur, cible, gain }], ptApres, atteint, nbInstructions, nbRoles }.
export function conseilsLisibilite(procedure) {
  const base = miseEnPage(procedure);
  if (!base || Math.round(pointsDe(base.echelle) * 10) / 10 >= SEUIL_PT) return null; // même arrondi que l'affichage : jamais « 5,5 pt, seuil 5,5 »
  if (cleConseils === cleMiseEnPage) return resultatConseils;

  const candidats = [];
  const ajouter = (champ, n, valeur, appliquer) => {
    const cible = LONGUEURS_CONSEILLEES[champ];
    const texte = String(valeur || "").trim();
    if (texte.length > cible) candidats.push({ champ, n, texte, longueur: texte.length, cible, appliquer: (p) => appliquer(p, cible) });
  };
  ajouter("declencheur", 0, procedure.meta.declencheur, (p, max) => { p.meta.declencheur = raccourcir(p.meta.declencheur, max); });
  ajouter("fin", 0, procedure.meta.fin, (p, max) => { p.meta.fin = raccourcir(p.meta.fin, max); });
  procedure.etapes.forEach((e, k) => {
    ajouter("libelle", k + 1, e.libelle, (p, max) => { p.etapes[k].libelle = raccourcir(p.etapes[k].libelle, max); });
    ajouter("sortie", k + 1, e.sortie, (p, max) => { p.etapes[k].sortie = raccourcir(p.etapes[k].sortie, max); });
    ajouter("condition", k + 1, e.condition, (p, max) => { p.etapes[k].condition = raccourcir(p.etapes[k].condition, max); });
    (e.alternatives || []).forEach((a, j) => {
      ajouter("alt_condition", k + 1, a.condition, (p, max) => { p.etapes[k].alternatives[j].condition = raccourcir(p.etapes[k].alternatives[j].condition, max); });
      ajouter("alt_info", k + 1, a.info, (p, max) => { p.etapes[k].alternatives[j].info = raccourcir(p.etapes[k].alternatives[j].info, max); });
    });
  });

  // Gain de chaque raccourcissement pris seul, avec les réglages déjà choisis (estimation rapide et prudente).
  const avant = pointsDe(base.echelle);
  candidats.forEach((c) => {
    const copie = structuredClone(procedure);
    c.appliquer(copie);
    const r = construire(copie, base.detail.params);
    c.gain = r ? pointsDe(echelleSurA4(r.largeur, r.hauteur)) - avant : 0;
  });
  const conseils = candidats.filter((c) => c.gain >= 0.05).sort((a, b) => b.gain - a.gain).slice(0, NB_CONSEILS);

  // Résultat si on suit tous ces conseils à la fois (avec un nouveau choix de mise en page).
  const copie = structuredClone(procedure);
  conseils.forEach((c) => c.appliquer(copie));
  const apres = conseils.length ? choisirMiseEnPage(copie) : base;
  const ptApres = apres ? pointsDe(apres.echelle) : avant;

  cleConseils = cleMiseEnPage;
  resultatConseils = {
    pt: Math.round(avant * 10) / 10,
    conseils: conseils.map(({ champ, n, texte, longueur, cible, gain }) => ({ champ, n, texte, longueur, cible, gain: Math.round(gain * 10) / 10 })),
    ptApres: Math.round(ptApres * 10) / 10,
    atteint: ptApres >= SEUIL_PT,
    nbInstructions: procedure.etapes.length,
    nbRoles: colonnes(procedure).length,
  };
  return resultatConseils;
}

// Taille réelle du texte courant (12 px dans le dessin) une fois le dessin réduit pour tenir sur A4, en points.
export function taillePointsSurA4(procedure) {
  const m = mesurerNiveau2(procedure);
  if (!m) return null;
  const echelle = echelleSurA4(m.largeur, m.hauteur);
  return Math.round(pointsDe(echelle) * 10) / 10; // texte le plus petit (paniers d'information : 10 px)
}

// Briques de dessin partagées avec le dessin du niveau 3 (render3.js) : mêmes symboles, mêmes couleurs, même style.
export {
  echapper, txt, r1, mesurerPanier, dessinerPanier, symboleContrat, symboleRecyclage, cercleContrainte, flecheCourte, mesurerRaccord, dessinerRaccord, flecheRaccord, ecartRaccord, ecartOblique, PENTE_RACCORD, placerCentre,
  SARCELLE, ROUGE, ENCRE, GRIS_TEXTE, GRIS_LIGNE, POLICE, PX, PX_GRAS, PX_G12, HAUT_LIGNE_12, HAUT_PANIER_LIGNE, LIGNE_ANNOTATION, pointsDe,
};
