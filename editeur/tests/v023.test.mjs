// Tests v0.23 — l'outil s'appelle Jalonia : le nom vient de config.js, les guides et le README le portent, les fichiers écrits
// portent l'identifiant de format « jalonia » et les fichiers enregistrés avant cette version (« qualigramme-app ») s'ouvrent toujours.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as store from "../js/store.js";
import { definirLangue, t } from "../js/i18n.js";
import { NOM_OUTIL } from "../js/config.js";
import { emballer, deballer, URI_EMBARQUE, texteVisible, empreinte } from "../js/embarque.js";
import { exempleProcedure } from "../js/exemple-procedure.js";
import { exempleInstruction } from "../js/exemple-it.js";
import { construireDocx } from "../js/exportDocx.js";
import { importerWord } from "../js/importWord.js";

const source = (chemin) => fs.readFileSync(new URL("../" + chemin, import.meta.url), "utf8");
const enBase64 = (texte) => Buffer.from(texte, "utf8").toString("base64");
definirLangue("fr");

// ---------- Le nom ----------
test("l'outil s'appelle Jalonia, en français comme en anglais", () => {
  assert.equal(NOM_OUTIL, "Jalonia");
  ["fr", "en"].forEach((langue) => {
    definirLangue(langue);
    assert.equal(t("app.titre"), "Jalonia");
    assert.equal(t("app.marque"), "Jalonia");
    assert.ok(t("mentions.essai.texte").includes("Jalonia"));
  });
  definirLangue("fr");
});

test("les guides et le README portent le nom Jalonia", () => {
  ["guide-fr.html", "guide-en.html"].forEach((f) => {
    const html = source(f);
    assert.match(html, /<title>[^<]*Jalonia<\/title>/, `${f} : le titre de la page`);
    assert.ok(html.includes("Jalonia ·"), `${f} : la ligne du haut`);
  });
  // Le README commence par le logo (image), puis le titre.
  assert.match(source("README.md"), /^(<p align="center"><img src="img\/logo-jalonia\.svg"[^\n]*<\/p>\n\n)?# Jalonia\n/);
});

test("l'ancien nom n'est plus affiché nulle part dans l'application publiée", () => {
  const fichiers = fs.readdirSync(new URL("../js/", import.meta.url)).filter((f) => f.endsWith(".js")).map((f) => "js/" + f)
    .concat(["js/locales/fr.js", "js/locales/en.js", "index.html", "guide-fr.html", "guide-en.html", "css/style.css", "css/guide.css", "README.md", "LICENCES-TIERS.md"]);
  fichiers.forEach((f) => assert.ok(!source(f).includes("Qualigramme App"), `${f} contient encore l'ancien nom « Qualigramme App »`));
});

// ---------- Fichiers écrits : « jalonia » ----------
test("le fichier .json enregistré porte l'identifiant de format « jalonia »", () => {
  const brut = JSON.parse(store.exporterJSON());
  assert.equal(brut.application, "jalonia");
  assert.equal(brut.version, 1);
  assert.equal(typeof brut.procedure, "object");
});

test("la partie cachée du Word porte l'identifiant « jalonia » et se relit", () => {
  assert.equal(URI_EMBARQUE, "urn:jalonia:procedure");
  const p = exempleProcedure();
  const xml = emballer(p, "sig-1");
  assert.ok(xml.includes(`<jalonia xmlns="urn:jalonia:procedure"`));
  assert.ok(!xml.includes("qualigramme"), "aucune trace de l'ancien identifiant dans ce qui est écrit");
  const lu = deballer(xml);
  assert.equal(lu.signature, "sig-1");
  assert.equal(lu.procedure.meta.titre, p.meta.titre);
});

test("un Word généré par la v0.23 se rouvre sans perte (procédure et instruction)", async () => {
  for (const p of [exempleProcedure(), exempleInstruction()]) {
    const octets = construireDocx(p, { embarquer: true });
    const texte = Buffer.from(octets).toString("latin1");
    assert.ok(texte.includes("urn:jalonia:procedure"), "customXml : identifiant de format");
    assert.ok(!texte.includes("urn:qualigramme-app"), "customXml : plus d'ancien identifiant");
    const relu = await importerWord(octets.buffer.slice(octets.byteOffset, octets.byteOffset + octets.byteLength));
    assert.equal(relu.procedure.meta.titre, p.meta.titre);
    assert.equal(relu.procedure.meta.typeDocument, p.meta.typeDocument);
  }
});

// ---------- Fichiers enregistrés avant la v0.23 : ils s'ouvrent toujours ----------
test("un ancien Word (identifiant « qualigramme-app ») est encore lu par l'import", () => {
  const p = exempleProcedure();
  const json = JSON.stringify({ format: "qualigramme-app", version: 1, procedure: p });
  const ancien = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<qualigramme xmlns="urn:qualigramme-app:procedure" signature="abc-12">${enBase64(json)}</qualigramme>`;
  const lu = deballer(ancien);
  assert.ok(lu, "l'ancienne forme est reconnue");
  assert.equal(lu.signature, "abc-12");
  assert.equal(lu.procedure.meta.titre, p.meta.titre);
});

test("un contenu qui n'est pas le nôtre n'est pas lu (mauvais espace de noms, mauvais format, texte abîmé)", () => {
  const json = JSON.stringify({ format: "autre-outil", version: 1, procedure: exempleProcedure() });
  assert.equal(deballer(`<jalonia xmlns="urn:jalonia:procedure" signature="x">${enBase64(json)}</jalonia>`), null, "mauvais format");
  const bon = JSON.stringify({ format: "jalonia", version: 1, procedure: exempleProcedure() });
  assert.equal(deballer(`<jalonia xmlns="urn:autre:procedure" signature="x">${enBase64(bon)}</jalonia>`), null, "mauvais espace de noms");
  assert.equal(deballer(`<jalonia xmlns="urn:jalonia:procedure" signature="x">pas-du-base64-%%%</jalonia>`), null, "texte abîmé");
  assert.equal(deballer("<vide/>"), null);
  assert.equal(deballer(""), null);
});

test("un ancien fichier .json (application « qualigramme-app ») s'ouvre, et se réenregistre sous « jalonia »", () => {
  const p = exempleProcedure();
  store.importerJSON(JSON.stringify({ application: "qualigramme-app", version: 1, procedure: p }));
  assert.equal(store.lire().meta.titre, p.meta.titre);
  assert.equal(JSON.parse(store.exporterJSON()).application, "jalonia");
});

test("une signature de texte visible reste stable : rien du nom de l'outil n'entre dans le texte du document", () => {
  const octets = construireDocx(exempleProcedure(), { embarquer: true });
  const texte = Buffer.from(octets).toString("latin1");
  const doc = /<w:document[\s\S]*<\/w:document>/.exec(texte);
  assert.ok(doc, "document.xml présent");
  assert.equal(typeof empreinte(texteVisible(doc[0])), "string");
  assert.ok(!texteVisible(doc[0]).includes("Jalonia"), "le corps du document ne cite pas le nom de l'outil");
});
