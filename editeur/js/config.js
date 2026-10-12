// config.js — les réglages de la version d'essai, à remplir par la personne qui publie l'application.
// Rien d'autre à toucher : le bouton « Envoyer un retour » et la fenêtre « Mentions et licences » s'adaptent à ce qui est renseigné ici.

export const CONFIG = {
  // Le NOM de l'outil, tel qu'il s'affiche partout (titre de l'onglet, colonne de gauche, accueil, mentions, en-tête des fichiers Word).
  // C'est le seul endroit à changer pour renommer l'outil (voir « Renommer l'outil » dans le CHANGELOG : deux guides à mettre à jour aussi).
  nomOutil: "Jalonia",
  // Titulaire des droits sur l'outil, affiché dans « Mentions et licences » sous la forme « © 2026 Prénom Nom — tous droits réservés — version d'essai ».
  // Laissé vide, la ligne n'est pas affichée. (Décision D3 du 30/09/2026.)
  titulaire: "Brice Ossongombia",
  // Année de la mention ci-dessus (quatre chiffres). Laissée vide ou incorrecte : l'année en cours.
  anneeDroits: "2026",
  // Adresse du formulaire de retours (par exemple un Google Forms) : elle doit commencer par https://
  // Laissée vide, le bouton n'affiche pas de lien vers un formulaire.
  urlRetours: "",
  // Adresse e-mail qui reçoit les retours (par exemple prenom.nom@exemple.org).
  // Laissée vide, le bouton n'affiche pas « Écrire par e-mail ».
  emailRetours: "",
};

export const NOM_OUTIL = CONFIG.nomOutil;
