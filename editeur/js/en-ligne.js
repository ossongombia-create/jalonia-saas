// en-ligne.js — l'éditeur travaille-t-il EN LIGNE ou EN LOCAL ?
//   En local (fichier index.html ouvert sur le poste) : le brouillon vit dans le navigateur, « Enregistrer » télécharge un fichier .json.
//   En ligne (dans l'application web de l'organisation) : le document et la cartographie viennent du serveur et y sont enregistrés
//   automatiquement ; rien n'est gardé dans le navigateur.
// Le mode se lit sur <html data-mode="en-ligne">, posé par la copie de l'éditeur dans l'application web (scripts/copier-editeur.mjs).
// Hors navigateur (tests) : toujours en local.

export const EN_LIGNE = typeof document !== "undefined" && Boolean(document.documentElement) && document.documentElement.dataset.mode === "en-ligne";
