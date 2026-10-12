// Tests v0.12 : éléments facultatifs d'une instruction (ET / OU, délai ou coût, action corrective, opérateur d'entrée),
// logo de l'organisation, dessin au style du modèle (bandeau, couloirs, carrefours), seuil de lisibilité à 5,5 pt.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import * as store from "../js/store.js";
import { nouvelleProcedure, nouvelleEtape, nouvelleAlternative, OPERATEURS, NATURES_CONTRAINTE } from "../js/model.js";
import { verifier } from "../js/rules.js";
import { construireDocument } from "../js/document.js";
import { dessinerNiveau2, croisementsNiveau2, taillePointsSurA4, SEUIL_PT } from "../js/render.js";
import { construireDocx } from "../js/exportDocx.js";
import { lireZip, importerWord } from "../js/importWord.js";
import { lireLogo } from "../js/logoImage.js";
import { definirLangue } from "../js/i18n.js";
import { exempleProcedure } from "../js/exemple-procedure.js";
import fr from "../js/locales/fr.js";
import en from "../js/locales/en.js";

const cles = (p) => verifier(p).map((c) => c.cle);

// ----- Images de test : de vrais en-têtes PNG et JPEG (seules les tailles comptent pour lireLogo) -----
function pngBase64(largeur, hauteur) {
  const o = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(o, 0);
  o.writeUInt32BE(13, 8); o.write("IHDR", 12); o.writeUInt32BE(largeur, 16); o.writeUInt32BE(hauteur, 20);
  o[24] = 8; o[25] = 6;
  return "data:image/png;base64," + o.toString("base64");
}
function jpegBase64(largeur, hauteur) {
  const o = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08, hauteur >> 8, hauteur & 255, largeur >> 8, largeur & 255, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9]);
  return "data:image/jpeg;base64," + o.toString("base64");
}

// Une procédure qui montre tous les éléments facultatifs.
function procedureComplete() {
  const p = nouvelleProcedure();
  const R = (id, nom, type = "individuel") => ({ id, nom, type, service: "", responsabilite: "" });
  p.roles = [R("r-chef", "Chef de chantier"), R("r-hse", "Coordinateur HSE"), R("r-dir", "Direction", "unite"), R("r-st", "Sous-traitant", "externe")];
  p.meta = { ...p.meta, titre: "Traiter un événement HSE", reference: "PR-HSE-07", version: "V1", processus: "HSE", domaine: "support",
    dateApplication: "2026-09-29", declencheur: "Événement HSE constaté sur site", fin: "Événement clos", organisation: "Société test" };
  const e = (c) => nouvelleEtape(c);
  p.etapes = [
    e({ id: "e1", roleId: "r-chef", libelle: "Déclarer l'événement", sortie: "Fiche événement", contrainte: { actif: true, nature: "delai", texte: "24 h" } }),
    e({ id: "e2", roleId: "r-hse", libelle: "Analyser l'événement", participants: ["r-chef"], sortie: "Rapport d'analyse", condition: "Événement grave",
      operateurSortie: "et", alternatives: [nouvelleAlternative({ condition: "Information client", info: "Note d'information", vers: "e5" })] }),
    e({ id: "e3", roleId: "r-dir", libelle: "Décider des actions", niveau3: { actif: true, code: "IT-HSE-05", intitule: "" }, controle: { actif: true, nature: "S", critere: "", enregistrement: "" }, sortie: "Plan d'actions" }),
    e({ id: "e4", roleId: "r-hse", libelle: "Mettre en œuvre l'action corrective", correctrice: true, contrainte: { actif: true, nature: "cout", texte: "5 000 €" }, sortie: "Action réalisée" }),
    e({ id: "e5", roleId: "r-st", libelle: "Réaliser les travaux", operateurEntree: "et", sortie: "Travaux terminés" }),
    e({ id: "e6", roleId: "r-hse", libelle: "Vérifier l'efficacité", controle: { actif: true, nature: "Q", critere: "", enregistrement: "" }, condition: "Efficace", sortie: "Action efficace",
      alternatives: [nouvelleAlternative({ condition: "Inefficace", info: "Action à reprendre", vers: "e4" })] }),
  ];
  return p;
}

// ---------- Modèle et magasin ----------
test("modèle : une instruction neuve n'a aucun élément facultatif", () => {
  const e = nouvelleEtape();
  assert.equal(e.operateurSortie, "ou");
  assert.equal(e.operateurEntree, "");
  assert.deepEqual(e.contrainte, { actif: false, nature: "", texte: "" });
  assert.equal(e.correctrice, false);
  assert.deepEqual(OPERATEURS, ["ou", "et"]);
  assert.deepEqual(NATURES_CONTRAINTE, ["delai", "cout", "autre"]);
  assert.equal(nouvelleProcedure().meta.logo, "");
});

test("magasin : opérateur de sortie, opérateur d'entrée, contrainte et action corrective (avec annuler)", () => {
  store.chargerExemple();
  const p = () => store.lire();
  const id = p().etapes[1].id;
  store.modifierOperateurSortie(id, "et");
  assert.equal(p().etapes[1].operateurSortie, "et");
  store.modifierOperateurSortie(id, "n'importe quoi");
  assert.equal(p().etapes[1].operateurSortie, "et", "valeur inconnue refusée");
  store.annuler();
  assert.equal(p().etapes[1].operateurSortie, "ou", "annuler rend « ou »");

  store.modifierOperateurEntree(id, "et");
  assert.equal(p().etapes[1].operateurEntree, "et");
  store.modifierOperateurEntree(id, "");
  assert.equal(p().etapes[1].operateurEntree, "");
  store.modifierOperateurEntree(id, "xor");
  assert.equal(p().etapes[1].operateurEntree, "", "valeur inconnue refusée");

  store.modifierContrainte(id, "actif", true);
  assert.equal(p().etapes[1].contrainte.nature, "delai", "nature par défaut : délai");
  store.modifierContrainte(id, "texte", "x".repeat(200));
  assert.equal(p().etapes[1].contrainte.texte.length, 40);
  store.modifierContrainte(id, "nature", "cout");
  store.modifierContrainte(id, "nature", "danger");
  assert.equal(p().etapes[1].contrainte.nature, "cout", "nature inconnue refusée");

  store.basculerCorrectrice(id, true);
  assert.equal(p().etapes[1].correctrice, true);
  store.annuler();
  assert.equal(p().etapes[1].correctrice, false);
});

test("magasin : un contrôle est toujours « ou » ; retirer les alternatives remet « ou »", () => {
  store.chargerExemple();
  const ctrl = store.lire().etapes[4]; // « Servir les plats » : instruction de contrôle de l'exemple
  assert.equal(ctrl.controle.actif, true);
  store.modifierOperateurSortie(ctrl.id, "et");
  assert.equal(store.lire().etapes[4].operateurSortie, "ou", "refusé sur un contrôle");
  const dec = store.lire().etapes[1]; // une instruction sans contrôle : on y active une décision
  store.basculerDecision(dec.id, true);
  store.modifierOperateurSortie(dec.id, "et");
  assert.equal(store.lire().etapes[1].operateurSortie, "et");
  store.basculerDecision(dec.id, false);
  assert.equal(store.lire().etapes[1].operateurSortie, "ou");
});

test("fichier hostile : les éléments facultatifs sont nettoyés à l'import", () => {
  store.chargerExemple();
  const brut = JSON.parse(store.exporterJSON());
  const e = brut.procedure.etapes[0];
  e.operateurSortie = "<script>"; e.operateurEntree = { a: 1 }; e.correctrice = "oui";
  e.contrainte = { actif: "oui", nature: "<b>", texte: "y".repeat(5000) };
  brut.procedure.etapes[1].contrainte = "pas un objet";
  brut.procedure.meta.logo = "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=";
  store.nouvelle();
  store.importerJSON(JSON.stringify(brut));
  const p = store.lire();
  assert.equal(p.etapes[0].operateurSortie, "ou");
  assert.equal(p.etapes[0].operateurEntree, "");
  assert.equal(p.etapes[0].correctrice, false);
  assert.equal(p.etapes[0].contrainte.actif, false);
  assert.ok(p.etapes[0].contrainte.texte.length <= 40);
  assert.ok(p.etapes[0].contrainte.nature === "" || NATURES_CONTRAINTE.includes(p.etapes[0].contrainte.nature));
  assert.deepEqual(Object.keys(p.etapes[1].contrainte).sort(), ["actif", "nature", "texte"]);
  assert.equal(p.meta.logo, "", "un SVG n'est pas accepté comme logo");
});

test("un ancien fichier (sans les nouveaux champs) s'ouvre avec les valeurs par défaut", () => {
  store.chargerExemple();
  const brut = JSON.parse(store.exporterJSON());
  brut.procedure.etapes.forEach((e) => { delete e.operateurSortie; delete e.operateurEntree; delete e.contrainte; delete e.correctrice; });
  delete brut.procedure.meta.logo;
  store.nouvelle();
  store.importerJSON(JSON.stringify(brut));
  const p = store.lire();
  p.etapes.forEach((e) => {
    assert.equal(e.operateurSortie, "ou"); assert.equal(e.operateurEntree, ""); assert.equal(e.correctrice, false); assert.equal(e.contrainte.actif, false);
  });
  assert.equal(p.meta.logo, "");
});

// ---------- Règles ----------
test("règles : une action corrective ne compte pas dans l'effectif de 5 à 10 instructions", () => {
  const p = nouvelleProcedure();
  p.roles = [{ id: "r1", nom: "Pilote", type: "individuel", service: "", responsabilite: "" }];
  p.etapes = Array.from({ length: 5 }, (_, k) => nouvelleEtape({ id: "x" + k, roleId: "r1", libelle: "Traiter " + k }));
  assert.ok(!cles(p).includes("regle.instructions.effectif"));
  p.etapes.push(...Array.from({ length: 6 }, (_, k) => nouvelleEtape({ id: "y" + k, roleId: "r1", libelle: "Corriger " + k, correctrice: true })));
  assert.ok(!cles(p).includes("regle.instructions.effectif"), "5 instructions + 6 correctrices : l'effectif reste 5");
});

test("règles : contrainte sans texte, action corrective sans contrôle, opérateur d'entrée sans renvoi", () => {
  const p = procedureComplete();
  const c = () => verifier(p).map((x) => x.cle);
  assert.ok(!c().includes("regle.contrainte.sans_texte") && !c().includes("regle.correctrice.sans_controle") && !c().includes("regle.entree.sans_renvoi"),
    "la procédure complète est cohérente");
  p.etapes[0].contrainte.texte = "";
  assert.ok(c().includes("regle.contrainte.sans_texte"));
  p.etapes[3].correctrice = true;
  p.etapes[5].alternatives[0].vers = "fin"; // plus aucun contrôle ne mène à l'instruction 4
  assert.ok(c().includes("regle.correctrice.sans_controle"));
  p.etapes[1].alternatives[0].vers = "e6"; // plus aucun renvoi vers l'instruction 5
  assert.ok(c().includes("regle.entree.sans_renvoi"));
});

test("règles : quand les suites sont simultanées (ET), le nom des cas n'est pas exigé", () => {
  const p = procedureComplete();
  p.etapes[1].condition = ""; p.etapes[1].alternatives[0].condition = "";
  assert.ok(!cles(p).includes("regle.decision.cas_sans_nom"), "ET : pas de nom de cas");
  p.etapes[1].operateurSortie = "ou";
  assert.ok(cles(p).includes("regle.decision.cas_sans_nom"), "OU : les cas doivent avoir un nom");
});

test("section 6 : plus de tableau ; ET et contraintes figurent sur le logigramme", () => {
  const p = procedureComplete();
  const doc = construireDocument(p);
  assert.equal(doc.sections.find((s) => s.cle === "description").blocs.find((b) => b.type === "tableau"), undefined, "le tableau d'activités est retiré");
  const svg = dessinerNiveau2(p);
  assert.ok((svg.match(/>et<\/text>/g) || []).length >= 1, "l'opérateur ET est sur le logigramme");
  assert.ok(svg.includes("24 h"), "la contrainte de délai est sur le logigramme");
  assert.ok(svg.includes("5 000 €"), "la contrainte de coût est sur le logigramme");
});

// ---------- Dessin ----------
test("dessin : tous les éléments facultatifs sont dessinés, le SVG est bien formé, les textes sont protégés", () => {
  const p = procedureComplete();
  p.etapes[0].contrainte.texte = '</text><script>alert(1)</script> & "24 h"';
  const svg = dessinerNiveau2(p);
  assert.ok(!svg.includes("<script>"));
  assert.equal((svg.match(/>et<\/text>/g) || []).length, 2, "un cercle ET en sortie de l'instruction 2, un en entrée de l'instruction 5");
  assert.ok(svg.includes("5 000 €"), "texte de la contrainte de coût");
  assert.ok(svg.includes(">+</text>"), "signe + dans le cercle de contrainte (légende du modèle, v0.14 : toujours un +, la nature reste dans le document)");
  assert.ok(!svg.includes(">€</text>"), "plus de signe € isolé dans le cercle");
  assert.ok(svg.includes("IT-HSE-05"), "code de l'instruction de travail (niveau 3)");
  assert.ok(svg.includes(">S</text>") && svg.includes(">Q</text>"), "lettres des contrôles");
  assert.ok(/A8 8 0 1 1/.test(svg), "symbole de recyclage (action corrective)");
  assert.ok(svg.includes(">P</text>") && svg.includes(">R</text>"), "instruction collaborative");
  assert.ok(svg.includes("PR-HSE-07") && svg.includes("Traiter un événement HSE"), "bandeau : code et titre");
  const fichier = path.join(os.tmpdir(), `qualigramme-v012-${process.pid}.svg`);
  fs.writeFileSync(fichier, svg);
  try { execFileSync("xmllint", ["--noout", fichier]); } catch (e) { if (e.code !== "ENOENT") throw e; } finally { fs.rmSync(fichier, { force: true }); }
});

test("dessin : sans élément facultatif, ni cercle ET, ni symbole de contrainte, ni recyclage", () => {
  const p = procedureComplete();
  p.etapes.forEach((e) => { e.operateurEntree = ""; e.operateurSortie = "ou"; e.contrainte = { actif: false, nature: "", texte: "" }; e.correctrice = false; });
  const svg = dessinerNiveau2(p);
  assert.equal((svg.match(/>et<\/text>/g) || []).length, 0);
  assert.ok(!svg.includes("5 000") && !/A8 8 0 1 1/.test(svg));
});

test("dessin : l'opérateur d'entrée n'apparaît que si un renvoi arrive sur l'instruction", () => {
  const p = procedureComplete();
  p.etapes[1].alternatives[0].vers = "e6"; // plus de renvoi vers l'instruction 5
  assert.equal((dessinerNiveau2(p).match(/>et<\/text>/g) || []).length, 1, "seul le ET de sortie reste");
});

test("dessin : le cercle ET ne s'affiche pas sur un contrôle (toujours OU)", () => {
  const p = procedureComplete();
  p.etapes[5].operateurSortie = "et"; // contrôle : ignoré
  const svg = dessinerNiveau2(p);
  assert.equal((svg.match(/>et<\/text>/g) || []).length, 2);
  assert.ok(svg.includes(">ou<"), "le contrôle garde son cercle « ou »");
});

test("dessin : le cache suit chaque nouvel élément (contrainte, ET, correctrice, bandeau)", () => {
  const p = procedureComplete();
  const a = dessinerNiveau2(p);
  assert.equal(dessinerNiveau2(p), a);
  p.etapes[0].contrainte.texte = "48 h"; const b = dessinerNiveau2(p); assert.notEqual(b, a); assert.ok(b.includes("48 h"));
  p.etapes[1].operateurSortie = "ou"; const c = dessinerNiveau2(p); assert.notEqual(c, b);
  p.etapes[3].correctrice = false; const d = dessinerNiveau2(p); assert.notEqual(d, c);
  p.meta.titre = "Autre titre"; const e = dessinerNiveau2(p); assert.notEqual(e, d); assert.ok(e.includes("Autre titre"));
  p.meta.signataires.redige.nom = "B. Ossongombia"; assert.ok(dessinerNiveau2(p).includes("Ossongombia"), "le rédacteur apparaît dans le bandeau");
});

test("dessin : la sortie d'une décision est un carrefour (cercle sur la 1re alternative) et le dessin garde 0 croisement sur l'exemple", () => {
  const p = exempleProcedure();
  const svg = dessinerNiveau2(p);
  assert.equal((svg.match(/>ou<\/text>/g) || []).length, 1, "1 décision : le contrôle au service (instruction 5)");
  assert.equal(croisementsNiveau2(p), 0);
});

test("dessin en anglais : « and » / « or », bandeau traduit", () => {
  definirLangue("en");
  try {
    const svg = dessinerNiveau2(procedureComplete());
    assert.ok(svg.includes(">and<") && svg.includes(">or<"));
    assert.ok(svg.includes("Qualigramme representation") || svg.includes("representation of the procedure"));
    ["logigramme.op.et", "logigramme.op.ou", "logigramme.debut", "logigramme.fin"].forEach((k) => { assert.ok(fr[k] && en[k], k); });
  } finally { definirLangue("fr"); }
});

test("lisibilité : le seuil est de 5,5 pt et l'exemple le respecte", () => {
  assert.equal(SEUIL_PT, 5.5);
  assert.ok(taillePointsSurA4(exempleProcedure()) >= SEUIL_PT);
  ["regle.logigramme.trop_haut", "conseil.lisibilite.bilan_non"].forEach((k) => {
    assert.ok(fr[k].includes("{seuil}") && en[k].includes("{seuil}"), k + " : le seuil vient de l'application, pas du texte");
  });
});

test("langues : les clés ajoutées en v0.12 existent en français et en anglais", () => {
  const nouvelles = Object.keys(fr).filter((k) => /contrainte|correctrice|operateur|simultane|logo|entree|\.op\./.test(k));
  assert.ok(nouvelles.length >= 20, "beaucoup de clés nouvelles : " + nouvelles.length);
  nouvelles.forEach((k) => assert.ok(en[k], "en manquant : " + k));
  Object.keys(en).filter((k) => /contrainte|correctrice|operateur|simultane|logo|entree|\.op\./.test(k)).forEach((k) => assert.ok(fr[k], "fr manquant : " + k));
});

// ---------- Logo ----------
test("logo : un vrai PNG ou JPEG est accepté, tout le reste est refusé", () => {
  assert.equal(store.logoValide(pngBase64(300, 100)), pngBase64(300, 100));
  assert.equal(store.logoValide(jpegBase64(300, 100)), jpegBase64(300, 100));
  assert.equal(store.logoValide("data:image/png;base64," + Buffer.from("ceci n'est pas une image").toString("base64")), "", "faux PNG");
  assert.equal(store.logoValide(jpegBase64(10, 10).replace("image/jpeg", "image/png")), "", "JPEG déclaré PNG");
  assert.equal(store.logoValide("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="), "", "SVG refusé (peut contenir du script)");
  assert.equal(store.logoValide("javascript:alert(1)"), "");
  assert.equal(store.logoValide(42), "");
  assert.equal(store.logoValide("data:image/png;base64," + "A".repeat(500000)), "", "trop lourd");
});

test("logo : définir, remplacer, retirer, annuler ; une image refusée ne change rien", () => {
  store.chargerExemple();
  assert.equal(store.definirLogo(pngBase64(200, 80)), true);
  assert.equal(store.lire().meta.logo, pngBase64(200, 80));
  assert.equal(store.definirLogo("data:text/html;base64,PGI+"), false);
  assert.equal(store.lire().meta.logo, pngBase64(200, 80), "inchangé");
  assert.equal(store.definirLogo(""), true);
  assert.equal(store.lire().meta.logo, "");
  store.annuler();
  assert.equal(store.lire().meta.logo, pngBase64(200, 80));
});

test("logo : lecture des dimensions (PNG, JPEG) et taille d'affichage limitée à 120 × 40 px", () => {
  const a = lireLogo(pngBase64(300, 100));
  assert.deepEqual([a.largeur, a.hauteur, a.type, a.extension], [300, 100, "png", "png"]);
  assert.deepEqual(a.affichage, { largeur: 120, hauteur: 40 });
  const b = lireLogo(jpegBase64(300, 100));
  assert.deepEqual([b.largeur, b.hauteur, b.type, b.extension], [300, 100, "jpeg", "jpg"]);
  const petit = lireLogo(pngBase64(60, 20));
  assert.deepEqual(petit.affichage, { largeur: 60, hauteur: 20 }, "un petit logo n'est pas agrandi");
  const haut = lireLogo(pngBase64(50, 200));
  assert.equal(haut.affichage.hauteur, 40);
  assert.ok(haut.affichage.largeur <= 120);
  assert.equal(lireLogo(""), null);
  assert.equal(lireLogo("data:image/png;base64," + Buffer.from("xx").toString("base64")), null, "trop court pour avoir une taille");
});

test("Word : le logo est dans l'en-tête (image, relation, type de fichier) ; sans logo, rien n'est ajouté", async () => {
  store.chargerExemple();
  store.definirLogo(pngBase64(300, 100));
  const avec = construireDocx(store.lire());
  const xml = await lireZip(avec);
  assert.ok(xml.includes('r:embed="rId6"') && xml.includes("Logo"));
  assert.ok((await lireZip(avec, "word/_rels/document.xml.rels")).includes('Target="media/logo.png"'));
  assert.ok(xml.includes(`cx="${120 * 9525}"`) && xml.includes(`cy="${40 * 9525}"`), "120 × 40 px");
  assert.ok((await lireZip(avec, "[Content_Types].xml")).includes('Extension="png"'));
  assert.ok(xml.includes("Entreprise Exemple"), "le nom de l'organisation reste écrit sous le logo");

  store.definirLogo("");
  const sans = construireDocx(store.lire());
  const xmlSans = await lireZip(sans);
  assert.ok(!xmlSans.includes("rId6"));
  assert.ok(!(await lireZip(sans, "word/_rels/document.xml.rels")).includes("logo."));
});

test("Word : un logo JPEG est déclaré en image/jpeg", async () => {
  store.chargerExemple();
  store.definirLogo(jpegBase64(240, 80));
  const zip = construireDocx(store.lire());
  assert.ok((await lireZip(zip, "[Content_Types].xml")).includes('Extension="jpg" ContentType="image/jpeg"'));
  assert.ok((await lireZip(zip, "word/_rels/document.xml.rels")).includes('Target="media/logo.jpg"'));
});

test("Word : aller-retour avec logo et éléments facultatifs, sans perte", async () => {
  store.nouvelle();
  const origine = procedureComplete();
  origine.meta.logo = pngBase64(300, 100);
  const { procedure, rapport } = await importerWord(construireDocx(origine));
  assert.deepEqual(rapport.map((c) => c.cle), ["import.embarque"]);
  assert.equal(procedure.meta.logo, origine.meta.logo);
  assert.deepEqual(procedure.etapes.map((e) => [e.operateurSortie, e.operateurEntree, e.contrainte, e.correctrice]),
    origine.etapes.map((e) => [e.operateurSortie, e.operateurEntree, e.contrainte, e.correctrice]));
});
