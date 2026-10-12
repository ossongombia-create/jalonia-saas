// main.js — le point d'entrée : relie l'état (store), le formulaire, le dessin, le moteur de règles.

import * as store from "./store.js";
import { constatsDiagnostic } from "./diagnostic.js";
import * as parcours from "./parcours-ui.js";
import { enregistrerJSON } from "./sorties.js"; // importé aussi pour enregistrer l'impression du document (PDF)
import { actualiserApercu } from "./apercus.js";
import { importerWord } from "./importWord.js";
import { t, definirLangue, langueCourante } from "./i18n.js";
import { icone, garnirIcones } from "./icones.js";
import * as cartographie from "./cartographie-store.js";
import { ouvrirCartographie, preparerFenetre as preparerFenetreCarto, rendre as rendreCarto } from "./cartographie-ui.js";
import { ouvrirRetour, preparerFenetreRetour } from "./retour.js";
import { ouvrirMentions, preparerFenetreMentions } from "./mentions.js";
import { rendreAccueil } from "./accueil-ui.js";
import * as vue from "./vue.js";
import { estDocumentVide } from "./model.js";
import { VERSION } from "./version.js";
import { EN_LIGNE } from "./en-ligne.js";
import * as enLigne from "./en-ligne-ui.js";

const $ = (id) => document.getElementById(id);

// Textes fixes de la page (balises portant data-i18n="cle").
function traduirePage() {
  document.documentElement.lang = langueCourante();
  document.title = t("app.titre");
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  // Infobulles (title) : « Annuler (Ctrl+Z) ». Un bouton sans texte (icône seule) reçoit aussi ce nom pour les lecteurs d'écran.
  document.querySelectorAll("[data-i18n-titre]").forEach((el) => {
    const texte = t(el.dataset.i18nTitre) + (el.dataset.raccourci ? ` (${el.dataset.raccourci})` : "");
    el.title = texte;
    if (!el.textContent.trim()) el.setAttribute("aria-label", texte);
  });
  document.querySelectorAll("[data-langue]").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.langue === langueCourante()));
  });
  $("lien-guide").href = "guide-" + langueCourante() + ".html"; // le guide de démarrage existe en français et en anglais
}

// Le dessin et le diagnostic sont recalculés à CHAQUE modification.
function actualiserResultat() {
  $("btn-annuler").disabled = !store.peutAnnuler();
  $("btn-retablir").disabled = !store.peutRetablir();
  const procedure = store.lire();
  const liste = $("diagnostic");
  liste.replaceChildren();
  actualiserApercu(); // le logigramme ou le document ne se calcule que si la fenêtre d'aperçu est ouverte
  const tous = constatsDiagnostic(procedure);
  // « Aucune anomalie » n'a de sens que s'il n'y a rien d'autre à signaler (dessin ou longueur compris).
  const affiches = tous.length > 1 ? tous.filter((c) => c.gravite !== "ok") : tous;
  affiches.forEach((c) => {
    const li = document.createElement("li");
    li.className = c.gravite;
    li.textContent = t(c.cle, c.params); // textContent : jamais de HTML injecté
    liste.appendChild(li);
  });
  const erreurs = affiches.filter((c) => c.gravite === "erreur").length;
  const alertes = affiches.filter((c) => c.gravite === "alerte").length;
  const resume = $("diagnostic-resume");
  resume.textContent = erreurs + alertes === 0 ? t("diag.resume.aucune") : t("diag.resume", { erreurs, alertes });
  // La bande du bas prend la couleur de l'état (vert / ambre / rouge) ; le premier message y reste lisible même repliée.
  const etat = erreurs ? "erreur" : alertes ? "alerte" : "ok";
  const zone = $("zone-diagnostic");
  if (zone.dataset.etat !== etat || !$("diagnostic-icone").firstChild) {
    zone.dataset.etat = etat;
    $("diagnostic-icone").replaceChildren(icone(etat === "ok" ? "check" : "warn", 18, 2));
  }
  const premier = affiches.find((c) => c.gravite === "erreur") || affiches.find((c) => c.gravite === "alerte") || affiches[0];
  $("diagnostic-premier").textContent = erreurs + alertes === 0 || !premier ? "" : t(premier.cle, premier.params);
  actualiserEtatFichier();
  if (vue.vueCourante() === "accueil") rendreAccueil($("accueil"), actionsAccueil, tous); // l'accueil suit le document, la cartographie et la langue
}

// « Non enregistré en fichier » : un repère à côté d'Enregistrer tant que le document diffère du dernier fichier .json (le brouillon, lui, reste dans le navigateur).
// En ligne, ce repère n'a pas de sens : le document s'enregistre sur le serveur (l'état est affiché par en-ligne-ui.js).
function actualiserEtatFichier() {
  $("etat-fichier").hidden = EN_LIGNE || !store.nonEnregistre();
}

// ----- Diagnostic en bas de page : réductible, l'état est retenu dans le navigateur -----
// v0.15 : replié par défaut (la bande montre le résumé et le premier message) ; un clic déplie la liste complète.
const CLE_DIAGNOSTIC = "qualigramme-app-diagnostic-reduit";
function reglerDiagnostic(reduit) {
  $("zone-diagnostic").classList.toggle("reduit", reduit);
  $("diagnostic-bascule").setAttribute("aria-expanded", String(!reduit));
}
reglerDiagnostic(true);
try {
  reglerDiagnostic(localStorage.getItem(CLE_DIAGNOSTIC) !== "0");
} catch (e) {
  // stockage indisponible : le diagnostic reste replié.
}
$("diagnostic-bascule").addEventListener("click", () => {
  const reduit = !$("zone-diagnostic").classList.contains("reduit");
  reglerDiagnostic(reduit);
  try {
    localStorage.setItem(CLE_DIAGNOSTIC, reduit ? "1" : "0");
  } catch (e) {
    // sans importance : l'état n'est pas retenu.
  }
});

// ----- Menu Fichier (Nouvelle, Exemple, Ouvrir, Importer un Word) -----
const menuFichier = $("menu-fichier");
function reglerMenuFichier(ouvert) {
  menuFichier.hidden = !ouvert;
  $("btn-fichier").setAttribute("aria-expanded", String(ouvert));
}
$("btn-fichier").addEventListener("click", () => reglerMenuFichier(menuFichier.hidden));
menuFichier.addEventListener("click", () => reglerMenuFichier(false), true); // se referme dès qu'on choisit une action
document.addEventListener("click", (evenement) => {
  if (!menuFichier.hidden && !evenement.target.closest(".menu-fichier")) reglerMenuFichier(false);
});
document.addEventListener("keydown", (evenement) => {
  if (evenement.key === "Escape" && !menuFichier.hidden) {
    reglerMenuFichier(false);
    $("btn-fichier").focus();
  }
});

garnirIcones();

function toutAfficher() {
  traduirePage();
  parcours.rendre();
  actualiserResultat();
}

// ----- Cartographie des processus (menu Fichier) : la fenêtre, et ce qui en dépend dans la page (liste des processus, alertes de codes) -----
preparerFenetreCarto();
$("btn-cartographie").addEventListener("click", ouvrirCartographie);
cartographie.abonner((structure) => {
  if (structure) parcours.rendre(); // la liste des processus de l'étape 1 peut avoir changé
  actualiserResultat();
});
// Un choix qui change ce que l'étape affiche (ex. le processus de rattachement propose un code) redessine l'étape.
document.addEventListener("redessiner-etape", () => parcours.rendre());
document.addEventListener("langue-changee", rendreCarto);

// ----- Abonnement : à chaque modification de la procédure -----
// Structure changée (ajout, suppression, changement d'étape) : on redessine l'étape ; sinon (frappe) on
// rafraîchit seulement ce qui est en lecture seule, pour ne pas perdre le curseur.
store.abonner((structureChangee) => {
  if (structureChangee) parcours.rendre();
  else parcours.actualiser();
  actualiserResultat();
});

// ----- Langue -----
document.querySelectorAll("[data-langue]").forEach((b) => {
  b.addEventListener("click", () => {
    definirLangue(b.dataset.langue);
    toutAfficher();
    document.dispatchEvent(new Event("langue-changee"));
  });
});

// ----- Version d'essai : numéro de version, fenêtre « Envoyer un retour » -----
$("rail-version").textContent = "v" + VERSION;
preparerFenetreRetour();
$("btn-retour").addEventListener("click", ouvrirRetour);

// ----- Annuler / rétablir -----
$("btn-annuler").addEventListener("click", () => store.annuler());
$("btn-retablir").addEventListener("click", () => store.retablir());
document.addEventListener("keydown", (evenement) => {
  if (!(evenement.ctrlKey || evenement.metaKey)) return;
  const touche = evenement.key.toLowerCase();
  if (touche === "z" && !evenement.shiftKey) {
    evenement.preventDefault();
    store.annuler();
  } else if (touche === "y" || (touche === "z" && evenement.shiftKey)) {
    evenement.preventDefault();
    store.retablir();
  }
});

// ----- Fichiers -----
// Remplacer le document en cours demande confirmation, sauf s'il est vide (rien à perdre).
const confirmerRemplacement = () => estDocumentVide(store.lire()) || confirm(t("fichier.confirmer"));
function nouveauDocument(type = "") {
  if (confirmerRemplacement()) { store.nouvelle(type); parcours.apresChargement(); }
}
function chargerExemple() {
  if (confirmerRemplacement()) { store.chargerExemple(); parcours.apresChargement(); }
}
function chargerExempleInstruction() {
  if (confirmerRemplacement()) { store.chargerExempleInstruction(); parcours.apresChargement(); }
}
$("btn-nouvelle").addEventListener("click", () => nouveauDocument());
$("btn-exemple").addEventListener("click", chargerExemple);
$("btn-exemple-it").addEventListener("click", chargerExempleInstruction);
// En ligne : « Enregistrer » enregistre tout de suite sur le serveur (sans attendre l'enregistrement automatique).
$("btn-enregistrer").addEventListener("click", EN_LIGNE ? enLigne.enregistrerMaintenant : enregistrerJSON);
// Le raccourci « Créer l'instruction de travail » (déroulé) remplace le document : on rouvre le parcours au début.
document.addEventListener("document-remplace", () => parcours.apresChargement());
$("btn-ouvrir").addEventListener("click", () => $("fichier-entree").click());
$("fichier-entree").addEventListener("change", (evenement) => {
  const fichier = evenement.target.files[0];
  if (!fichier) return;
  if (fichier.size > 2_000_000) {
    alert(t("fichier.illisible"));
    return;
  }
  const lecteur = new FileReader();
  lecteur.onload = () => {
    try {
      if (confirmerRemplacement()) { store.importerJSON(String(lecteur.result)); parcours.apresChargement(); }
    } catch (e) {
      alert(t("fichier.illisible"));
    }
    evenement.target.value = "";
  };
  lecteur.readAsText(fichier);
});

// ----- Import Word (.docx) -----
function afficherRapport(rapport) {
  const liste = $("rapport-liste");
  liste.replaceChildren();
  rapport.forEach((c) => {
    const li = document.createElement("li");
    li.className = c.gravite;
    li.textContent = t(c.cle, c.params);
    liste.appendChild(li);
  });
  $("rapport-import").hidden = rapport.length === 0;
}
$("rapport-fermer").addEventListener("click", () => { $("rapport-import").hidden = true; });
$("btn-importer-word").addEventListener("click", () => $("fichier-word").click());
$("fichier-word").addEventListener("change", async (evenement) => {
  const fichier = evenement.target.files[0];
  evenement.target.value = "";
  if (!fichier) return;
  if (fichier.size > 10_000_000 || !/\.docx$/i.test(fichier.name)) {
    afficherRapport([{ gravite: "erreur", cle: "import.fichier_refuse" }]);
    return;
  }
  if (!confirmerRemplacement()) return;
  try {
    const { procedure, rapport } = await importerWord(await fichier.arrayBuffer());
    if (rapport.some((c) => c.cle === "import.pas_modele")) {
      afficherRapport(rapport);
      return;
    }
    store.importerProcedure(procedure);
    parcours.apresChargement();
    afficherRapport(rapport);
  } catch (e) {
    afficherRapport([{ gravite: "erreur", cle: "import.illisible" }]);
  }
});

// ----- Mentions et licences (colonne de gauche, accueil) -----
preparerFenetreMentions();
$("btn-mentions").addEventListener("click", ouvrirMentions);

// ----- Accueil « Mon espace » : les actions qu'il propose sont celles du menu Fichier et des fenêtres existantes -----
const actionsAccueil = {
  nouveau: (type) => nouveauDocument(type),
  reprendre: (n) => parcours.allerA(n),
  enregistrer: enregistrerJSON,
  ouvrirJson: () => $("fichier-entree").click(),
  importerWord: () => $("fichier-word").click(),
  exemple: chargerExemple,
  exempleIT: chargerExempleInstruction,
  cartographie: ouvrirCartographie,
  retour: ouvrirRetour,
  mentions: ouvrirMentions,
};
// En ligne, le nom de l'outil ramène à la liste des documents de l'organisation (comme le lien « Mes documents »).
$("btn-accueil").addEventListener("click", () => (EN_LIGNE ? $("lien-documents").click() : vue.afficher("accueil")));
// La page s'ouvre sur l'accueil, sauf si la personne a choisi de ne plus l'afficher (choisi avant de s'abonner : pas de dessin en double au démarrage).
// En ligne, pas d'accueil : le document demandé s'ouvre directement.
vue.afficher(EN_LIGNE || vue.accueilMasque() ? "parcours" : "accueil");
vue.abonner(() => actualiserResultat()); // à chaque changement de vue, l'accueil se redessine d'après l'état du moment
store.abonnerEnregistrement(actualiserEtatFichier);

// ----- Alerte avant de quitter : le navigateur demande confirmation quand le document n'est pas enregistré en fichier -----
// (le texte de la demande est celui du navigateur ; l'explication est donnée par le repère « Non enregistré en fichier »).
// En ligne : la demande apparaît tant qu'une modification n'a pas été acceptée par le serveur.
window.addEventListener("beforeunload", (evenement) => {
  if (EN_LIGNE ? !enLigne.aEnregistrer() : !store.nonEnregistre()) return;
  evenement.preventDefault();
  evenement.returnValue = ""; // requis par certains navigateurs pour afficher la demande
});

toutAfficher();
// En ligne : le document et la cartographie viennent du serveur (la page reste masquée jusque-là).
if (EN_LIGNE) enLigne.demarrerEnLigne({ apresChargement: parcours.apresChargement, toutAfficher });
