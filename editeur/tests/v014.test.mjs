// Tests v0.14 : symbolique de la légende du modèle — paniers en « coupe », contrainte « + », début et fin annotés (au-dessus / en dessous),
// actions amont et aval, fanion d'indicateur, sous-procédure, macro-instructions (alternatives, regroupement), flèches grises des outils.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import * as store from "../js/store.js";
import { nouvelleProcedure, nouvelleEtape, nouvelleAlternative, signatureContenu, TYPES_MACRO, MAX_ALTERNATIVES_MACRO } from "../js/model.js";
import { verifier } from "../js/rules.js";
import { construireDocument } from "../js/document.js";
import { dessinerNiveau2, croisementsNiveau2, taillePointsSurA4, SEUIL_PT } from "../js/render.js";
import { construireDocx } from "../js/exportDocx.js";
import { importerWord } from "../js/importWord.js";
import { definirLangue } from "../js/i18n.js";
import { exempleProcedure } from "../js/exemple-procedure.js";
import fr from "../js/locales/fr.js";
import en from "../js/locales/en.js";

const cles = (p) => verifier(p).map((c) => c.cle);

// Une procédure qui montre tous les symboles de la légende.
function procedureLegende() {
  const p = nouvelleProcedure();
  const R = (id, nom, type = "individuel") => ({ id, nom, type, service: "", responsabilite: "" });
  p.roles = [R("r-dem", "Demandeur"), R("r-red", "Rédacteur"), R("r-qual", "Service qualité", "unite"), R("r-cli", "Client", "externe")];
  p.meta = { ...p.meta, titre: "Traiter une demande", reference: "PR-DOC-07", version: "V1", processus: "DOC", domaine: "support",
    dateApplication: "2026-09-29", declencheur: "Besoin exprimé par mail ou appel", fin: "Demande traitée et archivée", organisation: "Entreprise Exemple",
    amont: { texte: "Demande reçue au guichet", role: "Client", information: "Formulaire de demande" }, aval: { texte: "Suivi au comité mensuel", role: "Service qualité", information: "Bilan mensuel" } };
  const e = (c) => nouvelleEtape(c);
  p.etapes = [
    e({ id: "e1", roleId: "r-dem", libelle: "Formuler la demande", sortie: "Demande", indicateur: { actif: true, nom: "Délai de réponse", formule: "Délai moyen", cible: "48 h", frequence: "Mensuelle" }, contrainte: { actif: true, nature: "cout", texte: "moins de 500 €" } }),
    e({ id: "e2", roleId: "r-red", libelle: "Instruire la demande", sortie: "Dossier", outils: [{ id: "o1", type: "document", nom: "FO-DOC-03" }], macro: { type: "alternatives", detail: "", alternatives: ["par mail", "par courrier"] } }),
    e({ id: "e3", roleId: "r-qual", libelle: "Valider le dossier", sortie: "Dossier validé", sousProcedure: { actif: true, code: "PR-DOC-05" }, controle: { actif: true, nature: "Q", critere: "", enregistrement: "" } }),
    e({ id: "e4", roleId: "r-red", libelle: "Regrouper les pièces", sortie: "Pièces regroupées", macro: { type: "regroupement", detail: "Voir annexe 2", alternatives: [] } }),
    e({ id: "e5", roleId: "r-qual", libelle: "Clôturer la demande", sortie: "Demande clôturée" }),
  ];
  return p;
}

const texteDuSvg = (svg) => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]).join(" ");

// ---------- Modèle ----------
test("modèle : une instruction neuve n'a ni indicateur, ni sous-procédure, ni macro ; la procédure n'a ni amont ni aval", () => {
  const e = nouvelleEtape();
  assert.deepEqual(e.indicateur, { actif: false, nom: "", formule: "", cible: "", frequence: "" });
  assert.deepEqual(e.sousProcedure, { actif: false, code: "" });
  assert.deepEqual(e.macro, { type: "", detail: "", alternatives: [] });
  const p = nouvelleProcedure();
  assert.deepEqual(p.meta.amont, { texte: "", role: "", information: "" });
  assert.deepEqual(p.meta.aval, { texte: "", role: "", information: "" });
  assert.deepEqual(TYPES_MACRO, ["regroupement", "alternatives"]);
});

// ---------- Magasin ----------
function deuxEtapes() {
  store.nouvelle();
  store.ajouterRole(); store.ajouterEtape(); store.ajouterEtape();
  const p = store.lire();
  store.modifierEtape(p.etapes[0].id, "roleId", p.roles[0].id);
  return store.lire();
}

test("magasin : sous-procédure, macro-instruction et niveau 3 s'excluent (une seule forme par instruction)", () => {
  const p = deuxEtapes();
  const id = p.etapes[0].id;
  store.modifierNiveau3(id, "actif", true);
  assert.equal(store.lire().etapes[0].niveau3.actif, true);
  store.modifierSousProcedure(id, "actif", true);
  let e = store.lire().etapes[0];
  assert.equal(e.sousProcedure.actif, true);
  assert.equal(e.niveau3.actif, false, "le niveau 3 est désactivé");
  store.definirMacro(id, "alternatives");
  e = store.lire().etapes[0];
  assert.equal(e.macro.type, "alternatives");
  assert.equal(e.sousProcedure.actif, false);
  assert.deepEqual(e.macro.alternatives, ["", ""], "deux compartiments proposés d'emblée");
  store.modifierNiveau3(id, "actif", true);
  e = store.lire().etapes[0];
  assert.equal(e.macro.type, "");
  assert.equal(e.niveau3.actif, true);
  store.definirMacro(id, "regroupement");
  assert.equal(store.lire().etapes[0].niveau3.actif, false);
  store.definirMacro(id, "n'importe quoi");
  assert.equal(store.lire().etapes[0].macro.type, "regroupement", "type inconnu refusé");
  store.definirMacro(id, "");
  assert.equal(store.lire().etapes[0].macro.type, "");
});

test("magasin : compartiments d'une macro-instruction (ajout limité à 4, modification, suppression)", () => {
  const p = deuxEtapes();
  const id = p.etapes[0].id;
  store.definirMacro(id, "alternatives");
  store.modifierAlternativeMacro(id, 0, "par mail");
  store.modifierAlternativeMacro(id, 1, "par courrier");
  store.ajouterAlternativeMacro(id);
  store.ajouterAlternativeMacro(id);
  store.ajouterAlternativeMacro(id); // cinquième : refusée
  assert.equal(store.lire().etapes[0].macro.alternatives.length, MAX_ALTERNATIVES_MACRO);
  store.modifierAlternativeMacro(id, 9, "hors limites");
  store.modifierAlternativeMacro(id, -1, "hors limites");
  store.supprimerAlternativeMacro(id, 0);
  assert.deepEqual(store.lire().etapes[0].macro.alternatives, ["par courrier", "", ""]);
  store.annuler();
  assert.equal(store.lire().etapes[0].macro.alternatives[0], "par mail");
  store.modifierMacroDetail(id, "Annexe 2");
  assert.equal(store.lire().etapes[0].macro.detail, "Annexe 2");
});

test("magasin : indicateur, code de sous-procédure et actions amont / aval", () => {
  const p = deuxEtapes();
  const id = p.etapes[0].id;
  store.modifierIndicateur(id, "actif", true);
  store.modifierIndicateur(id, "nom", "Taux de conformité");
  store.modifierIndicateur(id, "autre", "x");
  assert.deepEqual(store.lire().etapes[0].indicateur, { actif: true, nom: "Taux de conformité", formule: "", cible: "", frequence: "" });
  store.modifierSousProcedure(id, "actif", true);
  store.modifierSousProcedure(id, "code", "pr-doc-05");
  assert.equal(store.lire().etapes[0].sousProcedure.code, "pr-doc-05", "le code est gardé tel que saisi ; il est mis en majuscules à l'affichage");
  store.modifierRaccord("amont", "texte", "Demande client");
  store.modifierRaccord("amont", "role", "Client");
  store.modifierRaccord("aval", "texte", "Formation");
  store.modifierRaccord("milieu", "texte", "refusé");
  store.modifierRaccord("aval", "couleur", "refusé");
  const m = store.lire().meta;
  assert.deepEqual(m.amont, { texte: "Demande client", role: "Client", information: "" });
  assert.deepEqual(m.aval, { texte: "Formation", role: "", information: "" });
  assert.equal(m.milieu, undefined);
});

test("nettoyage : un fichier sans les éléments v0.14 s'ouvre ; les valeurs invalides sont écartées ; une seule forme par instruction", () => {
  const brut = JSON.parse(JSON.stringify(procedureLegende()));
  delete brut.meta.amont; delete brut.meta.aval;
  brut.etapes.forEach((e) => { delete e.indicateur; delete e.sousProcedure; delete e.macro; });
  const ancien = store.nettoyer(brut);
  assert.deepEqual(ancien.meta.amont, { texte: "", role: "", information: "" });
  assert.deepEqual(ancien.etapes[0].macro, { type: "", detail: "", alternatives: [] });
  assert.equal(ancien.etapes[0].indicateur.actif, false);

  const sale = JSON.parse(JSON.stringify(procedureLegende()));
  sale.meta.amont = "texte"; sale.meta.aval = { texte: 5, role: ["x"] };
  sale.etapes[0].indicateur = "oui";
  sale.etapes[1].macro = { type: "inconnu", detail: 3, alternatives: ["a", 5, null, "b", "c", "d", "e"] };
  sale.etapes[2].sousProcedure = { actif: true, code: "PR-DOC-05" };
  sale.etapes[2].macro = { type: "regroupement", detail: "", alternatives: [] };
  sale.etapes[2].niveau3 = { actif: true, code: "IT-1", intitule: "" };
  sale.etapes[3].macro = { type: "alternatives", detail: "", alternatives: ["x", "y"] };
  sale.etapes[3].niveau3 = { actif: true, code: "IT-2", intitule: "" };
  const propre = store.nettoyer(sale);
  assert.deepEqual(propre.meta.amont, { texte: "", role: "", information: "" });
  assert.deepEqual(propre.meta.aval, { texte: "", role: "", information: "" });
  assert.deepEqual(propre.etapes[0].indicateur, { actif: false, nom: "", formule: "", cible: "", frequence: "" });
  assert.deepEqual(propre.etapes[1].macro, { type: "", detail: "", alternatives: ["a", "b", "c", "d"] }, "type inconnu écarté, seules les chaînes gardées, 4 au plus");
  assert.equal(propre.etapes[2].sousProcedure.actif, true);
  assert.equal(propre.etapes[2].macro.type, "", "la sous-procédure l'emporte sur la macro-instruction");
  assert.equal(propre.etapes[2].niveau3.actif, false);
  assert.equal(propre.etapes[3].macro.type, "alternatives");
  assert.equal(propre.etapes[3].niveau3.actif, false, "la macro-instruction l'emporte sur le niveau 3");
});

test("signature : un fichier validé avant la v0.14 reste validé ; un élément renseigné la change", () => {
  const p = exempleProcedure();
  // L'exemple restaurant a une action aval réelle : on la neutralise pour tester la compatibilité « pré-v0.14 » (aval vide = absent).
  p.meta.aval = { texte: "", role: "", information: "" };
  const avant = JSON.parse(JSON.stringify(p));
  delete avant.meta.amont; delete avant.meta.aval;
  avant.etapes.forEach((e) => { delete e.indicateur; delete e.sousProcedure; delete e.macro; });
  assert.equal(signatureContenu(p), signatureContenu(avant));
  const q = JSON.parse(JSON.stringify(p));
  q.meta.amont = { texte: "Demande", role: "", information: "" };
  assert.notEqual(signatureContenu(q), signatureContenu(avant));
  const r = JSON.parse(JSON.stringify(p));
  r.etapes[0].indicateur = { actif: true, nom: "x" };
  assert.notEqual(signatureContenu(r), signatureContenu(avant));
});

// ---------- Règles ----------
test("règles : indicateur sans nom, sous-procédure (code absent, mal formé, propre à la procédure), macro-instruction incomplète", () => {
  const p = procedureLegende();
  assert.ok(!cles(p).some((c) => /regle\.(indicateur|sp|macro)\./.test(c)), "la procédure de légende est propre");
  p.etapes[0].indicateur.nom = "  ";
  assert.ok(cles(p).includes("regle.indicateur.sans_nom"));
  p.etapes[2].sousProcedure.code = "";
  assert.ok(cles(p).includes("regle.sp.sans_code"));
  p.etapes[2].sousProcedure.code = "DOC-5";
  assert.ok(cles(p).includes("regle.sp.code_format"));
  p.etapes[2].sousProcedure.code = "IT-DOC-05";
  assert.ok(cles(p).includes("regle.sp.code_format"), "une sous-procédure renvoie à une procédure (PR), pas à une instruction de travail");
  p.etapes[2].sousProcedure.code = "pr-doc-07";
  assert.ok(cles(p).includes("regle.sp.code_propre"), "casse ignorée : c'est le code de cette procédure");
  p.etapes[2].sousProcedure.code = "pr-doc-05";
  assert.ok(!cles(p).some((c) => c.startsWith("regle.sp.")), "code valide en minuscules accepté");
  p.etapes[1].macro.alternatives = ["par mail", "par courrier", ""];
  assert.ok(cles(p).includes("regle.macro.alternative_vide"));
  p.etapes[1].macro.alternatives = ["par mail", ""];
  assert.ok(cles(p).includes("regle.macro.alternatives_insuffisantes"), "deux compartiments mais une seule alternative renseignée");
  p.etapes[1].macro.alternatives = ["par mail"];
  assert.ok(cles(p).includes("regle.macro.alternatives_insuffisantes"));
});

// ---------- Document ----------
test("section 6 : actions amont/aval + déclencheur/fin encadrent la section ; plus de tableau (sous-procédure, etc. vont au logigramme)", () => {
  definirLangue("fr");
  const p = procedureLegende();
  const blocs = construireDocument(p).sections.find((s) => s.cle === "description").blocs;
  assert.equal(blocs.find((b) => b.type === "tableau"), undefined, "le tableau d'activités est retiré");
  const paras = blocs.filter((b) => b.type === "paragraphe").map((b) => b.texte);
  assert.ok(paras.some((t) => /^Action amont : Demande reçue au guichet \(Client\) — information transmise : Formulaire de demande$/.test(t)));
  assert.ok(paras.some((t) => /^Fait déclencheur : /.test(t)));
  assert.ok(paras.some((t) => /^Fin : /.test(t)));
  assert.ok(paras.some((t) => /^Action aval : Suivi au comité mensuel \(Service qualité\) — information transmise : Bilan mensuel$/.test(t)));
  assert.ok(dessinerNiveau2(p).includes("PR-DOC-05"), "le code de la sous-procédure est sur le logigramme");
});

test("document : sans action amont ni aval, les paragraphes n'apparaissent pas", () => {
  definirLangue("fr");
  const p = exempleProcedure();
  // L'exemple restaurant a une action aval : on la retire pour tester le cas « sans amont ni aval ».
  p.meta.amont = { texte: "", role: "", information: "" };
  p.meta.aval = { texte: "", role: "", information: "" };
  const doc = construireDocument(p);
  const textes = doc.sections.find((s) => s.cle === "description").blocs.filter((b) => b.type === "paragraphe").map((b) => b.texte);
  assert.ok(!textes.some((t) => /^Action (amont|aval)/.test(t)));
});

test("Word : aller-retour avec tous les éléments de la légende, sans perte", async () => {
  store.nouvelle();
  const p = procedureLegende();
  const { procedure, rapport } = await importerWord(construireDocx(p));
  assert.deepEqual(rapport.map((c) => c.cle), ["import.embarque"]);
  assert.deepEqual(procedure.meta.amont, p.meta.amont);
  assert.deepEqual(procedure.meta.aval, p.meta.aval);
  assert.deepEqual(procedure.etapes.map((e) => [e.indicateur, e.sousProcedure, e.macro]), p.etapes.map((e) => [e.indicateur, e.sousProcedure, e.macro]));
});

// ---------- Dessin ----------
test("dessin : le SVG de la légende est bien formé et montre chaque symbole", () => {
  const p = procedureLegende();
  p.etapes[0].contrainte.texte = '</text><script>alert(1)</script> & "24 h"';
  const svg = dessinerNiveau2(p);
  assert.ok(!svg.includes("<script>"), "les textes sont protégés");
  assert.ok(svg.includes("SOUS-PROCÉDURE") && svg.includes("PR-DOC-05"), "sous-procédure : titre et code");
  assert.equal((svg.match(/stroke-width="4.4"/g) || []).length, 3, "cadre gras : sous-procédure et macro-instruction « alternatives » (+ l'ovale du rôle « unité »)");
  assert.ok(/stroke-dasharray="4 3"/.test(svg) && svg.includes("par mail") && svg.includes("par courrier"), "compartiments en pointillé");
  assert.ok(svg.includes("Voir annexe 2"), "détail du regroupement");
  assert.ok(/stroke-width="1.4" fill="none"/.test(svg) || /fill="none" stroke="#005A70" stroke-width="1.4"/.test(svg), "bord double (deuxième cadre fin)");
  assert.ok(svg.includes("Demande reçue au guichet") && svg.includes("Suivi au comité mensuel"), "actions amont et aval");
  assert.ok(svg.includes(">Client</text>") && svg.includes(">Service qualité</text>"), "ovales de rôle des actions amont et aval");
  assert.ok(svg.includes('id="flecheGrise"') && svg.includes('marker-end="url(#flecheGrise)"'), "flèche grise vers l'instruction qui utilise l'outil");
  const fichier = path.join(os.tmpdir(), `qualigramme-v014-${process.pid}.svg`);
  fs.writeFileSync(fichier, svg);
  try { execFileSync("xmllint", ["--noout", fichier]); } catch (e) { if (e.code !== "ENOENT") throw e; } finally { fs.rmSync(fichier, { force: true }); }
});

test("dessin : sans élément v0.14, ni fanion, ni cadre de sous-procédure, ni macro-instruction, ni action amont ou aval, ni flèche grise", () => {
  const p = procedureLegende();
  p.meta.amont = { texte: "", role: "" }; p.meta.aval = { texte: "", role: "" };
  p.etapes.forEach((e) => { e.indicateur = { actif: false, nom: "" }; e.sousProcedure = { actif: false, code: "" }; e.macro = { type: "", detail: "", alternatives: [] }; e.outils = []; });
  const svg = dessinerNiveau2(p);
  assert.ok(!svg.includes("SOUS-PROCÉDURE") && !svg.includes("Voir annexe") && !svg.includes("Demande reçue") && !svg.includes("par courrier"));
  // (le seul trait de 4,4 qui reste est l'ovale du rôle « unité » « Service qualité » dans l'en-tête)
  assert.equal((svg.match(/stroke-width="4.4"/g) || []).length, 1);
  assert.ok(!svg.includes("marker-end=\"url(#flecheGrise)\""));
  assert.ok(!/<polygon points="[^"]*" fill="#005A70" stroke="#005A70" stroke-width="1"/.test(svg), "pas de fanion");
});

test("dessin : le fanion n'apparaît que sur l'instruction dotée d'un indicateur", () => {
  const p = procedureLegende();
  const compte = (svg) => (svg.match(/fill="#005A70" stroke="#005A70" stroke-width="1" stroke-linejoin="round"/g) || []).length;
  assert.equal(compte(dessinerNiveau2(p)), 1);
  p.etapes[4].indicateur = { actif: true, nom: "Autre indicateur" };
  assert.equal(compte(dessinerNiveau2(p)), 2);
});

test("dessin : les paniers sont des « coupes » (haut ouvert), plus des rectangles fermés", () => {
  const svg = dessinerNiveau2(procedureLegende());
  assert.ok(!/<rect[^>]*rx="4"[^>]*fill="#fff"[^>]*stroke="#005A70" stroke-width="1.3"/.test(svg), "plus de rectangle arrondi fermé pour un panier");
  assert.ok(/<path d="M[\d.]+ [\d.]+V[\d.]+Q[\d.]+ [\d.]+ [\d.]+ [\d.]+H[\d.]+Q[\d.]+ [\d.]+ [\d.]+ [\d.]+V[\d.]+" fill="none"/.test(svg), "coupe : trait ouvert en haut");
  assert.ok(svg.includes("Demande") && svg.includes("Dossier validé"), "le texte des paniers est là");
});

test("dessin : le cercle de contrainte est toujours un « + » ; la nature reste dans le document", () => {
  definirLangue("fr");
  for (const nature of ["delai", "cout", "autre"]) {
    const p = procedureLegende();
    p.etapes[0].contrainte.nature = nature;
    const svg = dessinerNiveau2(p);
    assert.ok(svg.includes(">+</text>") && !svg.includes(">€</text>") && !svg.includes("M-"), nature);
  }
  const p = procedureLegende();
  const svg = dessinerNiveau2(p);
  assert.ok(svg.includes("moins de 500 €"), "le texte de la contrainte est porté par le logigramme");
  assert.equal(construireDocument(p).sections.find((s) => s.cle === "description").blocs.find((b) => b.type === "tableau"), undefined, "le tableau d'activités est retiré");
});

// Position verticale d'un texte du dessin : y de la première balise <text> qui le contient.
function yDuTexte(svg, contient) {
  const m = svg.match(new RegExp(`<text x="[\\d.]+" y="([\\d.]+)"[^>]*>[^<]*${contient}[^<]*</text>`));
  assert.ok(m, "texte introuvable : " + contient);
  return Number(m[1]);
}
function yBarres(svg) {
  return [...svg.matchAll(/<rect x="[\d.]+" y="([\d.]+)" width="30" height="3.4" fill="#005A70"\/>/g)].map((m) => Number(m[1]));
}

// Cercles de Début / de Fin (rayon 10, trait de 2,2) : centre.
function cerclesDebutFin(svg) {
  return [...svg.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="10" fill="#fff" stroke="#005A70" stroke-width="2.2"\/>/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
}

test("dessin : Début et Fin comme dans le livre — fait initial au-dessus du cercle posé sur la barre ; flèche vers la barre, cercle dessous, fait aval en dessous", () => {
  const p = procedureLegende();
  p.meta.amont = { texte: "", role: "" }; p.meta.aval = { texte: "", role: "" };
  const svg = dessinerNiveau2(p);
  const [barreDebut, barreFin] = yBarres(svg);
  const [cercleDebut, cercleFin] = cerclesDebutFin(svg);
  assert.ok(yDuTexte(svg, "Besoin exprimé par mail ou appel") < cercleDebut.y - 10, "annotation du Début au-dessus du cercle");
  assert.equal(barreDebut, cercleDebut.y + 10, "le cercle du Début est posé sur sa barre (barre sous le cercle)");
  assert.equal(barreFin + 3.4, cercleFin.y - 10, "le cercle de la Fin est sous sa barre (la flèche arrive sur la barre)");
  assert.ok(yDuTexte(svg, "Demande traitée et archivée") > cercleFin.y + 10, "annotation de la Fin sous le cercle");
  // La flèche qui arrive à la Fin s'arrête sur la barre ; celle du Début part du bas de la barre.
  assert.ok(new RegExp(`V${barreFin}" fill="none" stroke="#005A70" stroke-width="1.8" stroke-linejoin="round" marker-end="url\\(#fleche\\)"`).test(svg), "la flèche de la Fin s'arrête sur la barre");
  assert.ok(new RegExp(`<path d="M[\\d.]+ ${barreDebut + 3.4}V`).test(svg), "la flèche du Début part du bas de la barre");
});

test("dessin : une action amont ou aval REMPLACE le Début ou la Fin dans le dessin (fig. 7.7) ; le fait déclencheur / le fait aval restent dans le document", () => {
  const p = procedureLegende();
  const svg = dessinerNiveau2(p);
  assert.equal(yBarres(svg).length, 0, "ni barre ni cercle de Début / de Fin");
  assert.equal(cerclesDebutFin(svg).length, 0);
  assert.ok(!svg.includes("Besoin exprimé") && !svg.includes("Demande traitée et archivée"), "le fait déclencheur et le fait aval ne sont plus écrits dans le dessin");
  assert.ok(yDuTexte(svg, "Demande reçue au guichet") < yDuTexte(svg, "Formuler"), "action amont au-dessus de la première instruction");
  assert.ok(yDuTexte(svg, "Suivi au comité mensuel") > yDuTexte(svg, "Clôturer"), "action aval sous la dernière instruction");
  // Seul l'amont : la Fin est dessinée ; seul l'aval : le Début est dessiné.
  const q = procedureLegende();
  q.meta.aval = { texte: "", role: "", information: "" };
  const a = dessinerNiveau2(q);
  assert.equal(cerclesDebutFin(a).length, 1, "la Fin reste");
  assert.ok(a.includes("Demande traitée et archivée") && !a.includes("Besoin exprimé"));
  const r = procedureLegende();
  r.meta.amont = { texte: "", role: "", information: "" };
  const b = dessinerNiveau2(r);
  assert.equal(cerclesDebutFin(b).length, 1, "le Début reste");
  assert.ok(b.includes("Besoin exprimé") && !b.includes("Demande traitée et archivée"));
  // Le document garde le fait déclencheur et le fait aval (section 6).
  const textes = JSON.stringify(construireDocument(p));
  assert.ok(textes.includes("Besoin exprimé par mail ou appel") && textes.includes("Demande traitée et archivée"));
});

test("dessin : aucun mot n'est coupé ni perdu (macro-instructions, amont, aval compris)", () => {
  const p = procedureLegende();
  p.meta.amont.texte = "Une demande particulièrement longue reçue au guichet de l'agence de Lyon par un client";
  p.etapes[1].macro.alternatives = ["envoyer par courrier électronique sécurisé avec accusé de réception", "remettre en main propre au responsable"];
  const svg = dessinerNiveau2(p);
  const dans = texteDuSvg(svg).replace(/&#39;/g, "'").replace(/-\s+/g, "");
  [p.meta.amont.texte, ...p.etapes[1].macro.alternatives].forEach((texte) => {
    texte.split(/\s+/).forEach((mot) => assert.ok(dans.includes(mot.replace(/[’']/g, "'")), "mot manquant : " + mot));
  });
});

test("lisibilité : l'exemple garde au moins 5,5 pt et 0 croisement avec les annotations au-dessus et en dessous", () => {
  const p = exempleProcedure();
  assert.ok(taillePointsSurA4(p) >= SEUIL_PT, `pt = ${taillePointsSurA4(p)}`);
  assert.equal(croisementsNiveau2(p), 0);
  assert.equal(taillePointsSurA4(procedureLegende()) >= SEUIL_PT, true);
});

test("dessin : la clé de mise en page tient compte des nouveaux éléments (le dessin change quand on les modifie)", () => {
  const p = procedureLegende();
  const a = dessinerNiveau2(p);
  p.etapes[0].indicateur.actif = false;
  assert.notEqual(dessinerNiveau2(p), a, "fanion retiré");
  const b = dessinerNiveau2(p);
  p.etapes[2].sousProcedure.code = "PR-DOC-06";
  assert.notEqual(dessinerNiveau2(p), b, "code de sous-procédure");
  const c = dessinerNiveau2(p);
  p.meta.aval.texte = "Autre suite";
  assert.notEqual(dessinerNiveau2(p), c, "action aval");
  const d = dessinerNiveau2(p);
  p.etapes[1].macro.alternatives.push("en réunion");
  assert.notEqual(dessinerNiveau2(p), d, "alternative de macro-instruction");
});

// ---------- Textes ----------
test("textes : les clés de la v0.14 existent en français et en anglais", () => {
  const cles14 = [
    "logigramme.sp", "form.indicateur.case", "form.indicateur.aide", "form.indicateur.nom", "form.indicateur.nom.ph",
    "form.sp.case", "form.sp.aide", "form.sp.code", "form.sp.code.ph",
    "form.macro.titre", "form.macro.type", "form.macro.aucune", "form.macro.type.regroupement", "form.macro.type.alternatives",
    "form.macro.aide.regroupement", "form.macro.aide.alternatives", "form.macro.alt", "form.macro.alt.ph", "form.macro.ajouter", "form.macro.detail", "form.macro.detail.ph",
    "form.amont.aide", "form.amont.texte", "form.amont.ph", "form.amont.role", "form.aval.aide", "form.aval.texte", "form.aval.ph", "form.aval.role", "form.raccord.role.ph",
    "regle.indicateur.sans_nom", "regle.sp.sans_code", "regle.sp.code_format", "regle.sp.code_propre", "regle.macro.alternatives_insuffisantes", "regle.macro.alternative_vide",
    "doc.indicateur", "doc.sous_procedure", "doc.macro.alternatives", "doc.macro.regroupement", "doc.amont", "doc.aval",
  ];
  cles14.forEach((k) => {
    assert.ok(fr[k], "fr " + k);
    assert.ok(en[k], "en " + k);
  });
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort(), "mêmes clés dans les deux langues");
});

// ---------- Flèche et panier d'information (rappel de Brice, 29/09/2026 22:35) ----------
// Toute information transmise entre deux instructions se dessine par une flèche portant un panier : une « coupe » par flèche
// qui a une information (sortie, nom du cas), sur la suite normale comme sur chaque renvoi.
test("dessin : chaque flèche qui transmet une information porte son panier, y compris avec les nouveaux symboles", () => {
  const p = procedureLegende();
  p.etapes[1].alternatives = [nouvelleAlternative({ condition: "Incomplet", info: "Dossier à compléter", vers: "e1" })];
  p.etapes[1].condition = "Complet";
  // + une coupe pour la flèche de l'action amont (livre §6.5.12) ; sur la dernière flèche, l'information de l'action aval REMPLACE la
  // sortie de la dernière instruction (une flèche, un seul panier).
  const attendus = p.etapes.reduce((n, e) => n + (e.condition.trim() || e.sortie.trim() ? 1 : 0)
    + e.alternatives.filter((a) => a.condition.trim() || a.info.trim()).length, 0) + 1;
  const svg = dessinerNiveau2(p);
  const coupes = (svg.match(/stroke-width="1.3" stroke-linejoin="round"\/>/g) || []).length;
  assert.equal(coupes, attendus, "une coupe par flèche qui porte une information");
  const texte = texteDuSvg(svg);
  [...p.etapes.slice(0, -1).map((e) => e.sortie), "Bilan mensuel", "Complet", "Incomplet", "Dossier à compléter"].forEach((t) => assert.ok(texte.includes(t.split(" ")[0]), "information de la flèche : " + t));
  // Le panier est dessiné après la flèche (par-dessus) : le trait passe derrière la coupe.
  assert.ok(svg.lastIndexOf('marker-end="url(#fleche)"') < svg.lastIndexOf('stroke-width="1.3" stroke-linejoin="round"'));
});
