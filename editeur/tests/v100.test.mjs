// Tests V1.0 — niveau 1 dans l'application : (1) génération du document Word niveau 1 (cartographie + sommaire + une fiche par processus,
// interfaces pré-remplies d'après les flux) ; (2) bibliothèque de 50 modèles de cartographie, valides et chargeables.
import test from "node:test";
import assert from "node:assert/strict";
import { definirLangue } from "../js/i18n.js";
import { construireDocxCarto } from "../js/exportDocx.js";
import { exempleCartographie } from "../js/exemple-carto.js";
import { nettoyerCartographie, processusParCategorie, CATEGORIES } from "../js/cartographie.js";
import { BIBLIOTHEQUE } from "../js/carto-bibliotheque.js";

definirLangue("fr");

// Un .docx est un ZIP ; on lit word/document.xml en clair (creerZip ne compresse pas le XML ici → on cherche les octets ASCII).
function documentXmlDe(octets) {
  const s = Buffer.from(octets).toString("utf8"); // le XML est stocké en clair (UTF-8) dans le ZIP
  const i = s.indexOf("<w:document");
  const j = s.indexOf("</w:document>");
  assert.ok(i >= 0 && j > i, "word/document.xml introuvable dans le .docx");
  return s.slice(i, j);
}

test("le document Word niveau 1 se construit et contient l'en-tête OOXML", () => {
  const octets = construireDocxCarto(exempleCartographie(), {});
  assert.ok(octets && octets.length > 500);
  assert.equal(Buffer.from(octets.slice(0, 2)).toString("latin1"), "PK"); // signature ZIP
});

test("le document contient le sommaire et les 4 bandes présentes", () => {
  const xml = documentXmlDe(construireDocxCarto(exempleCartographie(), {}));
  assert.ok(xml.includes("Sommaire des fiches processus") || xml.includes("Sommaire"));
  ["Management", "Réalisation", "Support", "Surveillance &amp; mesure"].forEach((b) => assert.ok(xml.includes(b), "bande manquante : " + b));
});

test("une fiche par processus : chaque code de la cartographie apparaît", () => {
  const c = exempleCartographie();
  const xml = documentXmlDe(construireDocxCarto(c, {}));
  c.processus.forEach((p) => assert.ok(xml.includes(p.code), "code manquant dans le document : " + p.code));
});

test("les interfaces sont pré-remplies d'après les flux (fournisseur / client)", () => {
  const xml = documentXmlDe(construireDocxCarto(exempleCartographie(), {}));
  assert.ok(xml.includes("Fournisseur (amont)"));
  assert.ok(xml.includes("Client / destinataire (aval)"));
});

test("sans processus, le document se construit quand même (pas de fiche)", () => {
  const vide = nettoyerCartographie({ type: "cartographie", processus: [] });
  const octets = construireDocxCarto(vide, {});
  assert.ok(octets && octets.length > 300);
});

test("la bibliothèque contient 50 modèles, tous avec une bande surveillance (verification)", () => {
  assert.equal(BIBLIOTHEQUE.length, 50);
  BIBLIOTHEQUE.forEach((m) => {
    assert.ok(m.organisation && m.processus.length >= 4, "modèle incomplet : " + m.organisation);
    assert.ok(m.processus.some((p) => p.categorie === "verification"), "pas de surveillance : " + m.organisation);
  });
});

test("un modèle chargé passe le nettoyage et garde ses 4 bandes", () => {
  const c = nettoyerCartographie(BIBLIOTHEQUE[0]); // restaurant
  const cats = processusParCategorie(c).map((g) => g.categorie);
  CATEGORIES.forEach((k) => assert.ok(cats.includes(k), "bande absente après nettoyage : " + k));
  // tous les codes sont valides (acceptés par le nettoyage)
  assert.equal(c.processus.length, BIBLIOTHEQUE[0].processus.length);
});
