// vue.js — quelle « vue » est affichée dans la zone de droite : l'ACCUEIL (« Mon espace ») ou le PARCOURS en 4 étapes.
// La colonne marine reste la même dans les deux cas. Le choix se lit sur <body data-vue="accueil|parcours"> : le CSS masque ce qui ne concerne pas la vue.
// « Ne plus afficher l'accueil à l'ouverture » est un réglage de confort retenu dans le navigateur (jamais bloquant).

export const VUES = ["accueil", "parcours"];
const CLE_MASQUE = "qualigramme-app-accueil-masque";
let vue = "parcours";
const abonnes = [];

export const vueCourante = () => vue;

export function afficher(nom) {
  if (!VUES.includes(nom)) return;
  const change = nom !== vue;
  vue = nom;
  if (typeof document !== "undefined" && document.body) document.body.dataset.vue = nom;
  if (change) abonnes.forEach((fn) => fn(nom));
}

// fn(nom) est appelée quand la vue change.
export function abonner(fn) {
  abonnes.push(fn);
}

export function accueilMasque() {
  try {
    return localStorage.getItem(CLE_MASQUE) === "1";
  } catch (e) {
    return false;
  }
}

export function definirAccueilMasque(masque) {
  try {
    if (masque) localStorage.setItem(CLE_MASQUE, "1");
    else localStorage.removeItem(CLE_MASQUE);
  } catch (e) {
    // sans importance : le réglage n'est pas retenu.
  }
}
