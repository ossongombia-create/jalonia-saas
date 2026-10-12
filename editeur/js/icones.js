// icones.js — les petites icônes de l'interface (traits fins, une seule couleur : celle du texte).
// Ce sont des dessins FIXES écrits ici : aucun texte saisi par l'utilisateur n'y entre jamais.
// Usage : icone("check", 18) renvoie un élément <svg> à ajouter dans la page.
//         <span data-icone="undo"></span> dans index.html est remplacé par l'icône au démarrage (garnirIcones).

const P = (d) => `<path d="${d}"/>`;

const DESSINS = {
  undo: P("M9 14 4 9l5-5") + P("M4 9h10.5a5.5 5.5 0 0 1 0 11H11"),
  redo: P("m15 14 5-5-5-5") + P("M20 9H9.5a5.5 5.5 0 0 0 0 11H13"),
  save: P("M5 3h11l4 4v14H5z") + P("M8 3v5h8V3") + P("M8 21v-7h8v7"),
  folder: P("M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"),
  chev: P("m6 9 6 6 6-6"),
  chevUp: P("m6 15 6-6 6 6"),
  chevR: P("m9 6 6 6-6 6"),
  chevL: P("m15 6-6 6 6 6"),
  check: P("m5 12.5 4.5 4.5L19 7.5"),
  copy: `<rect x="9" y="9" width="11" height="11" rx="2"/>` + P("M5 15V6a2 2 0 0 1 2-2h9"),
  trash: P("M4 7h16") + P("M10 11v6") + P("M14 11v6") + P("M6 7l1 13h10l1-13") + P("M9 7V4h6v3"),
  plus: P("M12 5v14") + P("M5 12h14"),
  close: P("M6 6l12 12") + P("M18 6 6 18"),
  warn: P("M12 3 2.5 20h19z") + P("M12 10v4.5") + P("M12 17.3v.01"),
  info: `<circle cx="12" cy="12" r="9"/>` + P("M12 11v5") + P("M12 7.7v.01"),
  lock: `<rect x="5" y="11" width="14" height="9" rx="2"/>` + P("M8 11V8a4 4 0 0 1 8 0v3"),
  arrR: P("M5 12h14") + P("m13 6 6 6-6 6"),
  arrL: P("M19 12H5") + P("m11 6-6 6 6 6"),
  eye: P("M2 12s3.7-7 10-7 10 7 10 7-3.7 7-10 7S2 12 2 12z") + `<circle cx="12" cy="12" r="3"/>`,
  tri: P("M12 4 3 20h18z"),
  dia: P("M12 3 21 12 12 21 3 12z"),
  circplus: `<circle cx="12" cy="12" r="8.5"/>` + P("M12 8v8") + P("M8 12h8"),
  loop: P("M20 12a8 8 0 0 1-14 5.3") + P("M4 12a8 8 0 0 1 14-5.3") + P("M18 3v4h-4") + P("M6 21v-4h4"),
  contrat: P("M7 3h7l4 4v14H7z") + P("M14 3v4h4") + P("M10 11h5") + P("M10 14.5h5") + P("M10 18h3"),
  flag: P("M6 21V4") + P("M6 5h11l-2.5 4 2.5 4H6"),
  bulb: P("M9 18h6") + P("M10 21h4") + P("M12 3a6 6 0 0 0-3.8 10.7c.5.4.8 1 .8 1.6v.7h6v-.7c0-.6.3-1.2.8-1.6A6 6 0 0 0 12 3z"),
  macro: `<rect x="4" y="4" width="16" height="16" rx="2"/>` + `<rect x="7.5" y="7.5" width="9" height="9" rx="1"/>`,
  subp: `<rect x="3.5" y="6" width="17" height="12" rx="2"/>` + P("M7 6v12") + P("M17 6v12"),
  layers: P("m12 3 9 5-9 5-9-5z") + P("m3 13 9 5 9-5"),
  swap: P("M7 7h12") + P("m15 3 4 4-4 4") + P("M17 17H5") + P("m9 13-4 4 4 4"),
  users: `<circle cx="9" cy="8" r="3.5"/>` + P("M2.5 20a6.5 6.5 0 0 1 13 0") + `<circle cx="17" cy="9" r="2.5"/>` + P("M17 14.5a5 5 0 0 1 4.5 5"),
  doc: P("M7 3h7l4 4v14H7z") + P("M14 3v4h4"),
  panier: P("M4 12v1a8 8 0 0 0 16 0v-1") + P("M12 2.5v9") + P("m8.5 8 3.5 3.5L15.5 8"),
  upload: P("M12 16V4") + P("m7 9 5-5 5 5") + P("M4 20h16"),
  id: `<rect x="3" y="5" width="18" height="14" rx="2.5"/>` + P("M7 10h5") + P("M7 14h9"),
  list: P("M9 6h11") + P("M9 12h11") + P("M9 18h11") + P("M4 6h.01") + P("M4 12h.01") + P("M4 18h.01"),
  play: P("M8 5v14l11-7z"),
  stop: `<rect x="6" y="6" width="12" height="12" rx="2"/>`,
  word: P("M7 3h7l4 4v14H7z") + P("M14 3v4h4") + P("M9.5 11l1.2 5 1.3-4 1.3 4 1.2-5"),
  carto: `<circle cx="6" cy="6" r="2.6"/><circle cx="18" cy="8" r="2.6"/><circle cx="8" cy="18" r="2.6"/><circle cx="18" cy="18" r="2.6"/>` + P("M8.4 7l7.2.6") + P("M7 8.4l.8 7") + P("M10.5 18h5") + P("M18 10.6v4.8"),
  shield: P("M12 3 4.5 6v5.5c0 4.6 3.1 8 7.5 9.5 4.4-1.5 7.5-4.9 7.5-9.5V6z") + P("m9 12 2.2 2.2L15 10"),
  book: P("M12 6.5C10.5 5 8 4.5 4 4.5V18c4 0 6.5.5 8 2 1.5-1.5 4-2 8-2V4.5c-4 0-6.5.5-8 2z") + P("M12 6.5V20"),
  dl: P("M12 4v12") + P("m7 11 5 5 5-5") + P("M4 20h16"),
};

export const NOMS_ICONES = Object.keys(DESSINS);

const NS = "http://www.w3.org/2000/svg";

// Crée l'icône « nom » : un <svg> de « taille » pixels, trait de « trait » pixels, couleur = currentColor.
export function icone(nom, taille = 18, trait = 1.75) {
  const modele = document.createElement("template");
  modele.innerHTML = `<svg xmlns="${NS}" width="${taille}" height="${taille}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${trait}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" class="icone">${DESSINS[nom] || ""}</svg>`;
  return modele.content.firstElementChild;
}

// Remplace chaque <span data-icone="nom" data-taille="18"> par son dessin (une seule fois).
export function garnirIcones(racine = document) {
  racine.querySelectorAll("[data-icone]").forEach((el) => {
    if (el.querySelector("svg")) return;
    el.prepend(icone(el.dataset.icone, Number(el.dataset.taille) || 18, Number(el.dataset.trait) || 1.75));
  });
}
