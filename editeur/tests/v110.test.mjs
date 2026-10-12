// Tests v1.1.0 — fiches d'identité des processus (niveau 1) : saisie du contenu qualitatif (finalité, pilote, ressources,
// risques, exigences) rangé par CODE de processus, nettoyé, conservé au round-trip JSON, et injecté dans le document Word.
import test from "node:test";
import assert from "node:assert/strict";
import { definirLangue } from "../js/i18n.js";
import { nettoyerCartographie, depuisJSON, versJSON, ficheProcessus, FICHE_CHAMPS } from "../js/cartographie.js";
import { construireDocxCarto } from "../js/exportDocx.js";

definirLangue("fr");

function documentXmlDe(octets) {
  const s = Buffer.from(octets).toString("utf8");
  const i = s.indexOf("<w:document");
  const j = s.indexOf("</w:document>");
  assert.ok(i >= 0 && j > i, "word/document.xml introuvable");
  return s.slice(i, j);
}

function cartoAvecFiches() {
  return nettoyerCartographie({
    type: "cartographie",
    organisation: "Org",
    processus: [
      { code: "ACH", nom: "Acheter", categorie: "realisation" },
      { code: "PIL", nom: "Piloter", categorie: "management" },
    ],
    fiches: {
      ACH: { finalite: "Approvisionner\nles chantiers", pilote: "Resp. achats", ressources: "Équipe ; ERP", risques: "Rupture de stock", exigences: "ISO 9001 §8.4", bidon: "à ignorer" },
      PIL: {}, // aucune valeur → non retenue
      ZZZ: { finalite: "fiche orpheline" }, // code sans processus → ignorée
    },
  });
}

test("le nettoyage ne garde que les fiches des processus existants, champs non vides", () => {
  const c = cartoAvecFiches();
  assert.ok(c.fiches.ACH, "la fiche ACH doit être conservée");
  assert.equal(c.fiches.PIL, undefined, "une fiche entièrement vide n'est pas conservée");
  assert.equal(c.fiches.ZZZ, undefined, "une fiche sans processus correspondant est ignorée");
  assert.equal(c.fiches.ACH.bidon, undefined, "un champ hors liste est écarté");
  FICHE_CHAMPS.forEach((k) => assert.equal(typeof c.fiches.ACH[k], "string"));
});

test("les sauts de ligne d'un champ de fiche sont préservés (une ressource par ligne)", () => {
  const c = cartoAvecFiches();
  assert.equal(c.fiches.ACH.finalite, "Approvisionner\nles chantiers");
});

test("ficheProcessus lit par code (insensible à la casse) et rend {} si rien", () => {
  const c = cartoAvecFiches();
  assert.equal(ficheProcessus(c, "ach").pilote, "Resp. achats");
  assert.deepEqual(ficheProcessus(c, "PIL"), {});
  assert.deepEqual(ficheProcessus(c, "INEXISTANT"), {});
});

test("les fiches survivent au round-trip JSON", () => {
  const c = cartoAvecFiches();
  const relu = depuisJSON(versJSON(c));
  assert.equal(relu.fiches.ACH.finalite, "Approvisionner\nles chantiers");
  assert.equal(relu.fiches.ACH.exigences, "ISO 9001 §8.4");
});

test("le document Word reprend le contenu saisi des fiches (finalité, pilote, ressources)", () => {
  const xml = documentXmlDe(construireDocxCarto(cartoAvecFiches(), {}));
  assert.ok(xml.includes("Approvisionner"), "finalité saisie absente");
  assert.ok(xml.includes("les chantiers"), "2e ligne de la finalité absente");
  assert.ok(xml.includes("Resp. achats"), "pilote saisi absent du cartouche");
  assert.ok(xml.includes("ISO 9001"), "exigences saisies absentes");
});

test("un processus sans fiche garde les repères « à compléter »", () => {
  // PIL n'a pas de fiche : ses sections qualitatives restent « à compléter ».
  const xml = documentXmlDe(construireDocxCarto(cartoAvecFiches(), {}));
  assert.ok(xml.includes("À compléter"), "le repère à compléter doit subsister pour un processus non renseigné");
});

test("une cartographie neuve possède un dictionnaire de fiches vide", () => {
  const c = nettoyerCartographie({ type: "cartographie", processus: [] });
  assert.deepEqual(c.fiches, {});
});
