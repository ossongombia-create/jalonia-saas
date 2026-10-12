// Tests v0.11 : le document suit le modèle standard de procédure (structure, colonnes, 5 pages au plus),
// migration des anciens fichiers (13 sections), orientation portrait / paysage de la page du logigramme.
import test from "node:test";
import assert from "node:assert/strict";
import * as store from "../js/store.js";
import { construireDocument, estimerPages, mesurer, PAGES_MAX, PAGES_CIBLE_MIN, GABARITS, LARGEUR_TEXTE, largeursColonnes } from "../js/document.js";
import { SECTIONS } from "../js/model.js";
import { exempleProcedure } from "../js/exemple-procedure.js";
import { nouvelleProcedure, nouvelleEtape } from "../js/model.js";
import { meilleurePage, disposerNiveau2, PAGE_PORTRAIT, PAGE_PAYSAGE } from "../js/render.js";

test("limite : 4 à 5 pages, logigramme compris", () => {
  assert.equal(PAGES_MAX, 5);
  assert.equal(PAGES_CIBLE_MIN, 4);
});

test("structure : les 11 sections du modèle, dans l'ordre, et le logigramme en 7e position", () => {
  assert.deepEqual(SECTIONS, ["objet", "domaine", "references", "definitions", "responsabilites", "description", "logigramme",
    "indicateurs", "risques", "enregistrements", "diffusion"]);
  const doc = construireDocument(exempleProcedure());
  assert.deepEqual(doc.sections.map((s) => s.cle), SECTIONS);
  assert.equal(doc.sections[6].blocs.some((b) => b.type === "logigramme"), true);
});

test("document : en-tête, validation à 3 colonnes de signataires, historique à 4 colonnes", () => {
  const doc = construireDocument(exempleProcedure());
  assert.equal(doc.validation.colonnes.length, 4, "une colonne d'étiquettes + rédigé / vérifié / approuvé");
  assert.deepEqual(doc.validation.lignes.map((l) => l[0]).length, 4, "nom, fonction, date, visa");
  assert.equal(doc.historique.colonnes.length, 4, "version, date, nature de la modification, auteur");
  assert.ok(doc.historique.lignes.length >= 1);
});

test("largeurs de colonnes : chaque gabarit est ramené à la largeur utile du texte (portrait), une colonne par gabarit", () => {
  Object.entries(GABARITS).forEach(([nom, g]) => {
    const l = largeursColonnes(g.map(() => ""), [], g);
    assert.equal(l.length, g.length, nom);
    const somme = l.reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(somme - LARGEUR_TEXTE) <= g.length, `${nom} : ${somme} twips pour ${LARGEUR_TEXTE}`);
  });
  const l = largeursColonnes(["a", "b", "c"], [["x", "y", "z"]], undefined);
  assert.equal(l.length, 3);
  assert.ok(Math.abs(l.reduce((a, b) => a + b, 0) - LARGEUR_TEXTE) <= 3);
});

test("l'exemple tient dans les 5 pages", () => {
  const doc = construireDocument(exempleProcedure());
  assert.ok(estimerPages(doc) <= PAGES_MAX, `estimation : ${estimerPages(doc)} pages`);
  const m = mesurer(doc);
  assert.ok(m.pages <= PAGES_MAX);
});

test("un texte trop long fait dépasser les 5 pages (et l'application le voit)", () => {
  const p = exempleProcedure();
  p.corps.objet = [{ id: "b-long", type: "p", texte: "Texte très long. ".repeat(400) }];
  p.corps.domaine = [{ id: "b-long2", type: "p", texte: "Texte très long. ".repeat(400) }];
  assert.ok(estimerPages(construireDocument(p)) > PAGES_MAX);
});

test("ancien fichier à 13 sections : « Annexes » rejoint « Enregistrements », « Points de contrôle » (tableaux saisis) rejoint « Description »", () => {
  store.chargerExemple();
  const brut = JSON.parse(store.exporterJSON());
  const c = brut.procedure.corps;
  delete c.indicateurs; delete c.diffusion; delete c.domaine; // sections que l'ancien modèle n'avait pas toutes
  c.controles = [
    { id: "old-p", type: "p", texte: "Ancien paragraphe de contrôle" },
    { id: "old-t", type: "tableau", colonnes: ["Point", "Critère"], lignes: [["P1", "C1"]] },
    { id: "old-g", type: "genere" },
  ];
  c.annexes = [{ id: "old-a", type: "p", texte: "Annexe A : plan du site" }];
  store.nouvelle();
  store.importerJSON(JSON.stringify(brut));
  const corps = store.lire().corps;
  assert.deepEqual(Object.keys(corps), SECTIONS, "aucune clé de l'ancien modèle ne reste");
  assert.ok(corps.description.some((b) => b.type === "tableau" && b.colonnes[0] === "Point"), "tableau saisi repris");
  assert.ok(!corps.description.some((b) => b.type === "p" && b.texte === "Ancien paragraphe de contrôle"), "paragraphe généré d'autrefois abandonné");
  assert.equal(corps.description.filter((b) => b.type === "genere").length, 1, "un seul tableau généré");
  assert.ok(corps.enregistrements.some((b) => b.type === "p" && b.texte.startsWith("Annexe A")), "annexes reprises");
  assert.equal(corps.indicateurs.filter((b) => b.type !== "genere").length, 0);
  assert.equal(corps.indicateurs.filter((b) => b.type === "genere").length, 1, "la section 8 retrouve son tableau généré (v0.19)");
});

test("ancien fichier sans domaine, date, signataires ni révisions : il s'ouvre avec des valeurs par défaut", () => {
  store.chargerExemple();
  const brut = JSON.parse(store.exporterJSON());
  delete brut.procedure.meta.domaine; delete brut.procedure.meta.dateApplication;
  delete brut.procedure.meta.signataires; delete brut.procedure.meta.revisions;
  store.nouvelle();
  store.importerJSON(JSON.stringify(brut));
  const p = store.lire();
  assert.ok(p.meta.signataires.redige && p.meta.signataires.verifie && p.meta.signataires.approuve);
  assert.ok(Array.isArray(p.meta.revisions));
  assert.doesNotThrow(() => construireDocument(p));
});

test("fichier hostile : date, domaine et signataires sont nettoyés, les révisions limitées à 10", () => {
  store.chargerExemple();
  const brut = JSON.parse(store.exporterJSON());
  brut.procedure.meta.dateApplication = "<script>alert(1)</script>";
  brut.procedure.meta.domaine = "n'importe quoi";
  brut.procedure.meta.signataires.redige = { nom: "x".repeat(5000), fonction: 12, date: "pas une date" };
  brut.procedure.meta.revisions = Array.from({ length: 40 }, (_, i) => ({ id: "r" + i, version: "V" + i, date: "2026-01-01", nature: "n", auteur: "a" }));
  store.nouvelle();
  store.importerJSON(JSON.stringify(brut));
  const p = store.lire();
  assert.equal(p.meta.domaine, "", "domaine inconnu refusé");
  assert.ok(p.meta.revisions.length <= 10);
  assert.ok(p.meta.signataires.redige.nom.length <= 200);
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(p.meta.signataires.redige.date) || p.meta.signataires.redige.date === "");
  assert.ok(!/[<>]/.test(p.meta.dateApplication));
  assert.ok(p.meta.dateApplication === "" || /^\d{4}-\d{2}-\d{2}$/.test(p.meta.dateApplication));
});

test("orientation : un dessin haut reste en portrait, un dessin large passe en paysage, égalité → paysage", () => {
  const haut = meilleurePage(400, 800);
  assert.equal(haut.orientation, "portrait");
  const large = meilleurePage(900, 400);
  assert.equal(large.orientation, "paysage");
  // Même échelle dans les deux orientations : le paysage est l'orientation du modèle.
  const carre = meilleurePage(200, 200);
  assert.equal(carre.orientation, "paysage");
  assert.ok(haut.echelle > 0 && large.echelle > 0);
  assert.ok(PAGE_PAYSAGE.largeur > PAGE_PAYSAGE.hauteur && PAGE_PORTRAIT.hauteur > PAGE_PORTRAIT.largeur);
});

test("orientation : 7 rôles et 5 étapes donnent un logigramme en paysage, l'exemple en portrait", () => {
  const large = nouvelleProcedure();
  large.roles = Array.from({ length: 7 }, (_, i) => ({ id: "r" + i, nom: "Rôle " + (i + 1), type: "individuel", service: "", responsabilite: "Travail " + (i + 1) }));
  large.etapes = Array.from({ length: 5 }, (_, k) => nouvelleEtape({ roleId: "r" + (k % 7), libelle: "Traiter le point " + (k + 1), entree: "E" + k, sortie: "S" + k }));
  assert.equal(disposerNiveau2(large).orientation, "paysage");
  assert.equal(disposerNiveau2(exempleProcedure()).orientation, "portrait");
});

test("orientation : la disposition donne une taille finale qui tient dans la page choisie (rien de coupé)", () => {
  [exempleProcedure()].forEach((p) => {
    const d = disposerNiveau2(p);
    const zone = d.orientation === "paysage" ? PAGE_PAYSAGE : PAGE_PORTRAIT;
    assert.ok(d.largeur * d.echelle <= zone.largeur + 1, "largeur");
    assert.ok(d.hauteur * d.echelle <= zone.hauteur + 1, "hauteur");
  });
});
