// Tests v0.29 — niveau 1 : (1) la 4e catégorie est réaffichée « Surveillance & mesure » (clé interne « verification » conservée) ;
// (2) le moteur de dessin de la cartographie (carto-dessin.js) dispose un nombre VARIABLE de processus sur 4 bandes et échappe le texte saisi.
import test from "node:test";
import assert from "node:assert/strict";
import { t, definirLangue } from "../js/i18n.js";
import { CATEGORIES, nettoyerCartographie } from "../js/cartographie.js";
import { exempleCartographie } from "../js/exemple-carto.js";
import { planCartographie, svgCartographie, disposer, _couper } from "../js/carto-dessin.js";

definirLangue("fr");

function carteVariee() {
  return nettoyerCartographie({
    type: "cartographie",
    organisation: "Org Test",
    processus: [
      { code: "PIL", nom: "Piloter", categorie: "management" },
      { code: "AME", nom: "Améliorer", categorie: "management" },
      { code: "VEN", nom: "Vendre", categorie: "realisation" },
      { code: "REA", nom: "Réaliser", categorie: "realisation" },
      { code: "LIV", nom: "Livrer", categorie: "realisation" },
      { code: "ACH", nom: "Acheter", categorie: "support" },
      { code: "SUR", nom: "Surveiller & mesurer", categorie: "verification" },
      { code: "AUD", nom: "Auditer", categorie: "verification" },
    ],
  });
}

test("la 4e catégorie s'affiche « Surveillance & mesure » et garde la clé verification", () => {
  assert.ok(CATEGORIES.includes("verification"));
  assert.equal(t("carto.categorie.verification"), "Surveillance & mesure");
  assert.equal(t("domaine.verification"), "Surveillance & mesure");
  definirLangue("en");
  assert.equal(t("carto.categorie.verification"), "Monitoring & measurement");
  definirLangue("fr");
});

test("le plan dispose un nombre variable de processus sur les bonnes bandes", () => {
  const p = planCartographie(carteVariee());
  const parCat = Object.fromEntries(p.bandes.map((b) => [b.categorie, b.nb]));
  assert.equal(parCat.management, 2);
  assert.equal(parCat.realisation, 3);
  assert.equal(parCat.support, 1);
  assert.equal(parCat.verification, 2);
  assert.equal(p.surveillance, true);
});

test("l'ordre des bandes est management, réalisation, support, surveillance", () => {
  const p = planCartographie(carteVariee());
  assert.deepEqual(p.bandes.map((b) => b.categorie), ["management", "realisation", "support", "verification"]);
});

test("l'exemple de cartographie contient bien une bande de surveillance", () => {
  const p = planCartographie(exempleCartographie());
  assert.equal(p.surveillance, true);
});

test("le SVG contient le titre de bande Surveillance & mesure et tous les codes", () => {
  const svg = svgCartographie(carteVariee());
  assert.ok(svg.startsWith("<svg"));
  assert.ok(svg.includes("SURVEILLANCE &amp; MESURE"));
  ["PIL", "AME", "VEN", "REA", "LIV", "ACH", "SUR", "AUD"].forEach((code) => assert.ok(svg.includes(">" + code + "<"), "code manquant : " + code));
});

test("le texte saisi est échappé (aucune injection)", () => {
  const c = nettoyerCartographie({ type: "cartographie", processus: [{ code: "X1", nom: "a & <b> \"c\"", categorie: "management" }] });
  const svg = svgCartographie(c);
  assert.ok(svg.includes("a &amp; &lt;b&gt;"));
  assert.ok(!svg.includes("<b>"));
});

test("une cartographie vide ne plante pas et n'a aucune bande", () => {
  const p = planCartographie(nettoyerCartographie({ type: "cartographie", processus: [] }));
  assert.equal(p.bandes.length, 0);
  assert.equal(p.surveillance, false);
  assert.ok(p.H > 0);
  const svg = svgCartographie(nettoyerCartographie({ type: "cartographie", processus: [] }));
  assert.ok(svg.startsWith("<svg"));
});

test("la hauteur grandit avec le nombre de lignes de cartes", () => {
  const petit = disposer(nettoyerCartographie({ type: "cartographie", processus: [{ code: "A1", nom: "a", categorie: "support" }] }));
  const grand = disposer(nettoyerCartographie({
    type: "cartographie",
    processus: Array.from({ length: 6 }, (_, i) => ({ code: "S" + (i + 1), nom: "s" + i, categorie: "support" })),
  }));
  assert.ok(grand.H > petit.H);
});

test("_couper limite au nombre de lignes demandé", () => {
  assert.deepEqual(_couper("un deux trois quatre cinq six", 8, 2).length, 2);
});
