// v0.15 — nouvelle interface : structure de la page, textes (FR/EN) et icônes référencés par le code.
// Ces tests lisent les fichiers sources (pas de navigateur) : ils attrapent une clé de texte ou une icône oubliée.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fr from "../js/locales/fr.js";
import en from "../js/locales/en.js";
import { NOMS_ICONES } from "../js/icones.js";
import { ETAPES } from "../js/parcours.js";

const lire = (chemin) => fs.readFileSync(new URL("../" + chemin, import.meta.url), "utf8");
const html = lire("index.html");
const MODULES = ["js/main.js", "js/parcours-ui.js", "js/deroule.js", "js/cartes.js", "js/formulaire.js", "js/synthese.js", "js/generation.js",
  "js/deroule-it.js", "js/synthese-it.js", "js/apercu-it.js", "js/apercus.js", "js/render3.js", "js/diagnostic.js"];

test("Page : colonne marine, en-tête, barre Continuer et bande de diagnostic (les identifiants utilisés par le code existent)", () => {
  for (const id of ["rail", "carte-procedure", "parcours", "corps", "entete", "entete-kicker", "entete-titre", "barre-outils", "btn-annuler", "btn-retablir",
    "btn-fichier", "menu-fichier", "btn-nouvelle", "btn-exemple", "btn-ouvrir", "btn-importer-word", "btn-enregistrer", "fichier-entree", "fichier-word",
    "zone-travail", "colonne-saisie", "etape-contenu", "etape-navigation", "zone-diagnostic", "diagnostic-bascule", "diagnostic-icone", "diagnostic-resume",
    "diagnostic-premier", "diagnostic", "fenetre-apercu", "zone-dessin", "apercu-document", "zone-impression"]) {
    assert.ok(html.includes(`id="${id}"`), `index.html : il manque id="${id}"`);
  }
  assert.ok(html.indexOf('id="etape-navigation"') < html.indexOf('id="zone-diagnostic"'), "la barre Continuer est au-dessus du diagnostic");
  assert.ok(html.indexOf('id="zone-impression"') > html.indexOf('id="corps"'), "la zone d'impression est un enfant direct de body, après le corps");
  assert.equal((html.match(/<h1/g) || []).length, 1, "un seul titre h1 par page");
});

test("Textes : toute clé écrite en toutes lettres dans le code ou dans index.html existe en français ET en anglais", () => {
  const manquantes = [];
  const verifier = (cle, source) => {
    if (!(cle in fr)) manquantes.push(`${source} : « ${cle} » absente de fr.js`);
    if (!(cle in en)) manquantes.push(`${source} : « ${cle} » absente de en.js`);
  };
  for (const m of MODULES) {
    const code = lire(m);
    for (const [, cle] of code.matchAll(/\bt\("([a-z0-9_.]+)"\s*[,)]/g)) verifier(cle, m);
  }
  for (const [, cle] of html.matchAll(/data-i18n(?:-titre)?="([a-z0-9_.]+)"/g)) verifier(cle, "index.html");
  assert.deepEqual(manquantes, []);
});

test("Textes : les familles de clés construites (étapes, états, particularités) existent en FR et EN", () => {
  const cles = [];
  for (const nom of ETAPES) cles.push("parcours.etape." + nom, "parcours.page." + nom);
  for (const etat of ["courant", "fait", "afaire", "verrouille"]) cles.push("parcours.etat." + etat);
  for (const part of ["controle", "decision", "contrainte", "corrective", "indicateur", "risques", "niveau3", "sousprocedure", "macro"]) cles.push("part." + part);
  for (const langue of [fr, en]) for (const cle of cles) assert.ok(cle in langue, `clé « ${cle} » manquante`);
});

test("Textes : français et anglais ont exactement les mêmes clés", () => {
  assert.deepEqual(Object.keys(fr).filter((k) => !(k in en)), []);
  assert.deepEqual(Object.keys(en).filter((k) => !(k in fr)), []);
});

test("Icônes : chaque icône demandée par le code ou par index.html existe", () => {
  const inconnues = [];
  for (const m of MODULES) {
    const code = lire(m);
    for (const [, nom] of code.matchAll(/\bicone\("(\w+)"/g)) if (!NOMS_ICONES.includes(nom)) inconnues.push(`${m} : ${nom}`);
    for (const [, nom] of code.matchAll(/\bicone: "(\w+)"/g)) if (!NOMS_ICONES.includes(nom)) inconnues.push(`${m} : ${nom}`);
  }
  for (const [, nom] of html.matchAll(/data-icone="(\w+)"/g)) if (!NOMS_ICONES.includes(nom)) inconnues.push(`index.html : ${nom}`);
  assert.deepEqual(inconnues, []);
});

test("Feuille de style : les polices sont fournies avec l'application (aucun accès à Internet)", () => {
  const css = lire("css/style.css");
  const fichiers = [...css.matchAll(/url\("(fonts\/[^"]+\.woff2)"\)/g)].map((m) => m[1]);
  assert.equal(fichiers.length, 5, "5 graisses de la police Outfit");
  for (const f of fichiers) assert.ok(fs.existsSync(new URL("../css/" + f, import.meta.url)), `fichier de police manquant : ${f}`);
  assert.ok(!/https?:\/\//.test(css.replace(/xmlns='http:\/\/www\.w3\.org\/2000\/svg'/g, "")), "aucune adresse Internet dans la feuille de style");
  assert.ok(fs.existsSync(new URL("../css/fonts/LICENSE-Outfit.txt", import.meta.url)), "la licence de la police est jointe");
});
