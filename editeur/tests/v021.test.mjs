// Tests v0.21 — « prête pour les testeurs » : version affichée, fenêtre « Envoyer un retour » (informations techniques sans aucun texte du document,
// lien de formulaire et e-mail réglés dans config.js, vérifiés), mention « version d'essai », guide de démarrage FR / EN (une page, sans entreprise réelle,
// dont les noms de menus sont ceux de l'application).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as store from "../js/store.js";
import { definirLangue } from "../js/i18n.js";
import fr from "../js/locales/fr.js";
import en from "../js/locales/en.js";
import { VERSION } from "../js/version.js";
import { CONFIG } from "../js/config.js";
import { nomNavigateur, nomSysteme, adresseFormulaire, adresseEmail, lienEmail, lignesInformations, texteInformations, donneesCourantes } from "../js/retour.js";

const source = (chemin) => fs.readFileSync(new URL("../" + chemin, import.meta.url), "utf8");
import { PROPRE } from "./neutralite.mjs";
definirLangue("fr");

// ---------- Version ----------
test("la version est un numéro « x.y » et c'est celle de la dernière entrée du CHANGELOG", () => {
  assert.match(VERSION, /^\d+\.\d+$/);
  const premiere = source("CHANGELOG.md").match(/^## v(\d+\.\d+)\b/m);
  assert.ok(premiere, "le CHANGELOG commence par une entrée « ## vX.Y »");
  assert.equal(premiere[1], VERSION, "js/version.js et CHANGELOG.md doivent annoncer la même version");
});

// ---------- Navigateur et système ----------
test("le navigateur et le système sont reconnus d'après l'identifiant du navigateur", () => {
  const cas = [
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36", "Chrome 141", "Windows"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.3537.57", "Edge 141", "Windows"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0", "Firefox 133", "Windows"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15", "Safari 17", "macOS"],
    ["Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36", "Chrome 141", "Android"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1", "Safari 17", "iOS"],
    ["Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36", "Chrome 141", "Linux"],
    ["", "?", "?"],
  ];
  cas.forEach(([ua, navigateur, systeme]) => {
    assert.equal(nomNavigateur(ua), navigateur, ua);
    assert.equal(nomSysteme(ua), systeme, ua);
  });
});

// ---------- Adresses réglées dans config.js ----------
test("l'adresse du formulaire doit commencer par https:// ; le reste est refusé", () => {
  assert.equal(adresseFormulaire("https://forms.gle/abc123"), "https://forms.gle/abc123");
  ["", "   ", "http://forms.gle/abc", "javascript:alert(1)", "data:text/html,<b>x</b>", "//forms.gle/abc", "https://exemple.org/a b", "ftp://x.org", undefined, null].forEach((mauvaise) => {
    assert.equal(adresseFormulaire(mauvaise), "", String(mauvaise));
  });
});

test("l'adresse e-mail est vérifiée et ne peut pas ajouter un destinataire ou un champ au lien mailto:", () => {
  assert.equal(adresseEmail("prenom.nom@exemple.org"), "prenom.nom@exemple.org");
  ["", "pas-une-adresse", "a@b", "a@b.co?bcc=x", "a@b.co&cc=x", "a@b.co,c@d.fr", "a b@c.fr", "<a@b.fr>", "a@b.fr;c@d.fr", undefined].forEach((mauvaise) => {
    assert.equal(adresseEmail(mauvaise), "", String(mauvaise));
  });
  const lien = lienEmail("prenom.nom@exemple.org", "Retour sur l'app v0.21", "Version : v0.21\nÉcran : 1440 × 900");
  assert.match(lien, /^mailto:prenom\.nom@exemple\.org\?subject=/);
  assert.ok(lien.includes(encodeURIComponent("Version : v0.21\nÉcran : 1440 × 900")), "le corps est encodé");
  assert.ok(!/\s/.test(lien), "aucun espace dans le lien");
  assert.equal(lienEmail("mauvaise", "s", "c"), "");
});

test("config.js : les réglages, s'ils sont remplis, sont valides (une faute de frappe se voit ici)", () => {
  assert.equal(typeof CONFIG.urlRetours, "string");
  assert.equal(typeof CONFIG.emailRetours, "string");
  if (CONFIG.urlRetours.trim() !== "") assert.ok(adresseFormulaire(CONFIG.urlRetours), "urlRetours doit commencer par https://");
  if (CONFIG.emailRetours.trim() !== "") assert.ok(adresseEmail(CONFIG.emailRetours), "emailRetours n'est pas une adresse e-mail valide");
});

// ---------- Informations techniques ----------
test("les informations à joindre donnent version, navigateur, écran, langue, document, constats — et jamais le texte du document", () => {
  definirLangue("fr");
  store.nouvelle();
  store.modifierMeta("titre", "TEXTE-CONFIDENTIEL-DU-TITRE");
  store.modifierMeta("organisation", "ORGANISATION-CONFIDENTIELLE");
  store.modifierMeta("typeDocument", "procedure");
  const donnees = donneesCourantes();
  const texte = texteInformations(donnees);
  assert.ok(texte.includes("v" + VERSION));
  assert.match(texte, /Procédure \(niveau 2\)/);
  assert.equal(donnees.typeDocument, "procedure");
  assert.ok(donnees.erreurs + donnees.alertes > 0, "une procédure vide a des alertes");
  assert.doesNotMatch(texte, /CONFIDENTIEL/);
  assert.equal(lignesInformations(donnees).length, 6);
  // sans type choisi, et en anglais
  const sans = texteInformations({ typeDocument: "", erreurs: 0, alertes: 0, ua: "", ecran: "", langue: "fr" });
  assert.match(sans, /type non choisi/);
  definirLangue("en");
  const anglais = texteInformations({ typeDocument: "instruction", erreurs: 1, alertes: 2, ua: "Chrome/141.0", ecran: "1440 × 900", langue: "en" });
  assert.match(anglais, /Work instruction \(level 3\)/);
  assert.match(anglais, /1 error\(s\), 2 warning\(s\)/);
  assert.match(anglais, /Browser : Chrome 141/);
  definirLangue("fr");
});

// ---------- Textes FR / EN ----------
test("les textes de la version d'essai existent en FR et en EN, avec les mêmes variables", () => {
  const cles = Object.keys(fr).filter((k) => k.startsWith("retour.") || k.startsWith("apropos."));
  assert.ok(cles.length >= 25, "clés v0.21 : " + cles.length);
  cles.forEach((k) => {
    assert.ok(en[k], "clé manquante en anglais : " + k);
    const variables = (texte) => [...String(texte).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
    assert.equal(variables(en[k]), variables(fr[k]), "variables différentes : " + k);
  });
  Object.keys(en).filter((k) => k.startsWith("retour.") || k.startsWith("apropos.")).forEach((k) => assert.ok(fr[k], "clé manquante en français : " + k));
  // Depuis la v1.7 : licence propriétaire (plus de « version d'essai non commerciale »).
  assert.match(fr["retour.mention"], /propriétaire.*soumise à contrat/);
  assert.match(en["retour.mention"], /[Pp]roprietary.*subject to contract/);
});

// ---------- Page ----------
test("index.html : version, bouton de retour, lien du guide et fenêtre sont là ; le code n'utilise pas innerHTML", () => {
  const html = source("index.html");
  ["rail-version", "btn-retour", "lien-guide", "fenetre-retour", "retour-titre", "retour-fermer", "retour-contenu"].forEach((id) => assert.ok(html.includes(`id="${id}"`), "index.html : il manque id=\"" + id + "\""));
  assert.match(html, /<a id="lien-guide"[^>]*rel="noopener"/, "le guide s'ouvre dans un autre onglet, sans lien vers l'application");
  ["js/retour.js", "js/version.js", "js/config.js"].forEach((f) => assert.doesNotMatch(source(f), /innerHTML|outerHTML|insertAdjacentHTML|document\.write/, f));
  const main = source("js/main.js");
  assert.match(main, /rail-version/);
  assert.match(main, /guide-" \+ langueCourante\(\)/, "le lien du guide suit la langue");
});

// ---------- Guides ----------
const GUIDES = [
  ["guide-fr.html", fr, "fr", "guide-en.html"],
  ["guide-en.html", en, "en", "guide-fr.html"],
];
const texteVisible = (html) => html.replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();

test("guides de démarrage : deux pages (FR / EN) qui se renvoient l'une à l'autre, sans script, sans ressource extérieure, sans entreprise réelle", () => {
  GUIDES.forEach(([fichier, , langue, autre]) => {
    const html = source(fichier);
    assert.match(html, new RegExp(`<html lang="${langue}">`), fichier);
    assert.ok(html.includes(`href="${autre}"`), fichier + " renvoie à " + autre);
    assert.ok(html.includes('href="index.html"'), fichier + " renvoie à l'application");
    assert.doesNotMatch(html, /<script|http:\/\/|https:\/\/|@import|<iframe|<img(?![^>]*src="img\/[a-z-]+\.svg")/i, fichier + " : rien d'extérieur (seul le logo de l'application, du dossier img/, est permis)");
    assert.doesNotMatch(html, PROPRE, fichier);
    assert.equal((html.match(/<li>\s*<h2>/g) || []).length, 6, fichier + " : six pas");
  });
  const css = source("css/guide.css");
  assert.doesNotMatch(css, /https?:|@import/, "guide.css : rien d'extérieur");
  assert.match(css, /@page\s*\{\s*size:\s*A4/, "guide.css : impression sur une page A4");
});

test("guides de démarrage : assez courts pour une page A4, et les noms de menus, d'étapes et de boutons sont ceux de l'application", () => {
  GUIDES.forEach(([fichier, texte, langue]) => {
    const visible = texteVisible(source(fichier));
    const mots = visible.split(" ").length;
    assert.ok(mots <= 480, `${fichier} : ${mots} mots (480 au plus pour tenir sur une page)`);
    const sansPoints = (cle) => texte[cle].replace(/…$/, "");
    [
      "fichier.nouvelle", "fichier.exemple_it", "fichier.exemple", "fichier.cartographie", "fichier.ouvrir", "fichier.enregistrer",
      "parcours.etape.identification", "parcours.etape.deroule", "parcours.etape.synthese", "parcours.etape.generation",
      "type_document.procedure", "type_document.instruction", "apercu.bouton.dessin", "retour.bouton",
      "domaine.management", "domaine.realisation", "domaine.support", "domaine.verification",
    ].forEach((cle) => {
      const attendu = sansPoints(cle);
      const cite = visible.toLowerCase().includes(attendu.toLowerCase());
      assert.ok(cite, `${fichier} : le guide doit citer « ${attendu} » (${cle}) exactement comme l'application`);
    });
    assert.ok(visible.includes(texte["apropos.essai"]), fichier + " : mention « logiciel propriétaire » (v1.7)");
    assert.ok(visible.includes(langue === "fr" ? "S. Guillard et C. Berger" : "S. Guillard and C. Berger"), fichier + " : mention de la méthode");
  });
});
