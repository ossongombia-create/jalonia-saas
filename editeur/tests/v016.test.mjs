// Tests v0.16 — l'INSTRUCTION DE TRAVAIL (niveau 3, chapitre 7 du livre Qualigramme) : règles de rédaction, saisie (store),
// synthèse (parcours), dessin à trois colonnes, raccourci depuis une instruction de procédure, textes FR/EN.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as store from "../js/store.js";
import { nouvelleProcedure, nouvelleOperation, nouveauControle, nouvelleCorrective, instructionDepuisEtape, signatureContenu } from "../js/model.js";
import { verifierIT, MIN_OPERATIONS, MAX_OPERATIONS } from "../js/rules-it.js";
import { exempleInstruction } from "../js/exemple-it.js";
import { manquants, bloquantsSynthese, etapeComplete, etapeMax, estInstruction } from "../js/parcours.js";
import { dessinerNiveau3, mesurerNiveau3, taillePointsNiveau3, croisementsNiveau3, SEUIL_PT_IT } from "../js/render3.js";
import { constatsDiagnostic, constatsDessinIT } from "../js/diagnostic.js";
import { definirLangue } from "../js/i18n.js";
import fr from "../js/locales/fr.js";
import en from "../js/locales/en.js";

definirLangue("fr");
const lire = (chemin) => fs.readFileSync(new URL("../" + chemin, import.meta.url), "utf8");
const cles = (constats, gravite) => constats.filter((c) => !gravite || c.gravite === gravite).map((c) => c.cle);

// Le texte visible d'un dessin SVG : balises retirées, entités décodées, lignes recollées (un libellé long est coupé en plusieurs lignes).
const texteDuSvg = (svg) => svg.replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/\s+/g, " ");

// Une instruction correcte de n opérations (sans contrôle) : point de départ des tests de règles.
function instructionDe(n) {
  const p = exempleInstruction();
  p.it.operations = Array.from({ length: n }, (_, k) => nouvelleOperation({
    id: "o" + k, libelle: "Vérifier le point " + (k + 1), entree: k === 0 ? "Ordre" : "", sortie: k === n - 1 ? "Résultat" : "",
  }));
  return p;
}

// ---------- Règles du chapitre 7 ----------
test("IT : l'exemple du livre (visite pré-départ) respecte toutes les règles", () => {
  const constats = verifierIT(exempleInstruction());
  assert.deepEqual(cles(constats), ["diag.ok"]);
});

test("IT : 5 à 10 opérations — au-dessus de 10 c'est une erreur, en dessous de 5 une alerte", () => {
  assert.equal(MIN_OPERATIONS, 5);
  assert.equal(MAX_OPERATIONS, 10);
  assert.ok(!cles(verifierIT(instructionDe(5))).includes("regle3.operations.peu"));
  assert.ok(!cles(verifierIT(instructionDe(10))).includes("regle3.operations.trop"));
  const trop = verifierIT(instructionDe(11)).find((c) => c.cle === "regle3.operations.trop");
  assert.equal(trop.gravite, "erreur");
  assert.equal(trop.params.n, 11);
  const peu = verifierIT(instructionDe(4)).find((c) => c.cle === "regle3.operations.peu");
  assert.equal(peu.gravite, "alerte");
});

test("IT : libellé d'opération — 5 mots au plus, jamais « et », verbe à l'infinitif", () => {
  const p = instructionDe(5);
  p.it.operations[0].libelle = "Vérifier les documents du véhicule affecté"; // 6 mots
  p.it.operations[1].libelle = "Vérifier et signer"; // « et »
  p.it.operations[2].libelle = "Vérification des pneus"; // pas un infinitif
  p.it.operations[3].libelle = "";
  const constats = verifierIT(p);
  assert.ok(constats.some((c) => c.cle === "regle3.operation.trop_de_mots" && c.params.i === 1 && c.gravite === "erreur"));
  assert.ok(constats.some((c) => c.cle === "regle3.operation.contient_et" && c.params.i === 2 && c.gravite === "erreur"));
  assert.ok(constats.some((c) => c.cle === "regle3.operation.pas_infinitif" && c.params.i === 3 && c.gravite === "alerte"));
  assert.ok(constats.some((c) => c.cle === "regle3.operation.libelle_vide" && c.params.i === 4 && c.gravite === "erreur"));
});

test("IT : une opération à risque a au moins un contrôle ; un contrôle a toujours une action corrective", () => {
  const p = instructionDe(5);
  p.it.operations[1].vigilance = true;
  assert.ok(verifierIT(p).some((c) => c.cle === "regle3.operation.risque_sans_controle" && c.params.i === 2 && c.gravite === "erreur"));
  p.it.operations[1].controles = [nouveauControle({ id: "k1", question: "Pression conforme ?", nature: "S" })];
  const constats = verifierIT(p);
  assert.ok(!cles(constats).includes("regle3.operation.risque_sans_controle"));
  assert.ok(constats.some((c) => c.cle === "regle3.controle.sans_corrective" && c.gravite === "erreur"));
  p.it.operations[1].correctives = [nouvelleCorrective({ id: "m1", libelle: "Regonfler le pneu" })];
  p.it.operations[1].controles[0].correctives = ["m1"];
  assert.ok(!cles(verifierIT(p)).includes("regle3.controle.sans_corrective"));
});

test("IT : le contrôle est une question (Oui / Non), la corrective un verbe à l'infinitif", () => {
  const p = instructionDe(5);
  p.it.operations[0].correctives = [nouvelleCorrective({ id: "m1", libelle: "Alerte du responsable" }), nouvelleCorrective({ id: "m2", libelle: "" })];
  p.it.operations[0].controles = [nouveauControle({ id: "k1", question: "Documents valides", nature: "R", correctives: ["m1", "m2"] })];
  const constats = verifierIT(p);
  assert.ok(constats.some((c) => c.cle === "regle3.controle.pas_question" && c.gravite === "alerte"));
  assert.ok(constats.some((c) => c.cle === "regle3.corrective.pas_infinitif" && c.gravite === "alerte"));
  assert.ok(constats.some((c) => c.cle === "regle3.corrective.libelle_vide" && c.gravite === "erreur"));
});

test("IT : une corrective que aucun contrôle n'appelle est signalée ; le rôle de provenance est demandé", () => {
  const p = instructionDe(5);
  p.it.operations[0].correctives = [nouvelleCorrective({ id: "m1", libelle: "Alerter le responsable" })];
  p.meta.amont = { texte: "Affecter le véhicule", role: "" };
  p.meta.aval = { texte: "Suivre les anomalies", role: "" };
  const constats = verifierIT(p);
  assert.ok(cles(constats).includes("regle3.corrective.sans_controle"));
  assert.ok(cles(constats).includes("regle3.raccord.amont_sans_role"));
  assert.ok(cles(constats).includes("regle3.raccord.aval_sans_role"));
});

// ---------- Étapes du parcours ----------
test("Parcours : une instruction vide indique ce qui manque, l'exemple passe les étapes 1 et 2", () => {
  const vide = nouvelleProcedure();
  vide.meta.typeDocument = "instruction";
  assert.ok(estInstruction(vide));
  const manques = cles(manquants(vide, 2));
  assert.ok(manques.includes("manque.it.role"));
  assert.ok(manques.includes("manque.it.operations"));
  assert.ok(cles(manquants(vide, 1)).includes("manque.meta.titre_it"));
  const p = exempleInstruction();
  assert.deepEqual(manquants(p, 1), []);
  assert.deepEqual(manquants(p, 2), []);
  assert.deepEqual(bloquantsSynthese(p), []);
  assert.equal(etapeMax(p), 3, "la synthèse reste à valider : la génération n'est pas ouverte");
  p.validation = signatureContenu(p);
  assert.ok(etapeComplete(p, 3));
  p.it.operations[0].libelle = "Vérifier les papiers";
  assert.ok(!etapeComplete(p, 3), "modifier le contenu annule la validation");
});

test("Parcours : les manques d'une opération sont nommés avec son numéro", () => {
  const p = exempleInstruction();
  p.it.operations[2].libelle = "";
  p.it.operations[3].controles[0].question = "";
  p.it.operations[3].controles[0].nature = "";
  p.it.operations[4].correctives[0].libelle = "";
  const m = manquants(p, 2);
  assert.ok(m.some((x) => x.cle === "manque.it.operation.libelle" && x.params.i === 3));
  assert.ok(m.some((x) => x.cle === "manque.it.controle.question" && x.params.i === 4 && x.params.j === 1));
  assert.ok(m.some((x) => x.cle === "manque.it.controle.nature" && x.params.i === 4));
  assert.ok(m.some((x) => x.cle === "manque.it.corrective.libelle" && x.params.i === 5));
});

test("Parcours : les règles bloquantes de l'étape 3 sont celles du chapitre 7", () => {
  const p = instructionDe(11);
  assert.ok(cles(bloquantsSynthese(p)).includes("regle3.operations.trop"));
});

// ---------- Saisie (store) ----------
test("Store : ajouter, modifier, déplacer, dupliquer et supprimer une opération", () => {
  store.nouvelle();
  store.modifierMeta("typeDocument", "instruction");
  store.ajouterOperation();
  store.ajouterOperation();
  store.ajouterOperation();
  const [a, b] = store.lire().it.operations;
  store.modifierOperation(a.id, "libelle", "Vérifier les documents");
  store.modifierOperation(b.id, "libelle", "Inspecter les pneus");
  store.modifierOperation(b.id, "vigilance", true);
  store.modifierOperation(b.id, "vigilance", "oui"); // pas un booléen : refusé
  assert.equal(store.lire().it.operations[1].vigilance, true);
  store.deplacerOperation(b.id, -1);
  assert.deepEqual(store.lire().it.operations.slice(0, 2).map((o) => o.libelle), ["Inspecter les pneus", "Vérifier les documents"]);
  store.deplacerOperation(b.id, -1); // déjà en tête : rien ne change
  assert.equal(store.lire().it.operations[0].id, b.id);
  store.dupliquerOperation(b.id);
  assert.equal(store.lire().it.operations.length, 4);
  const copie = store.lire().it.operations[1];
  assert.notEqual(copie.id, b.id);
  assert.equal(copie.libelle, "Inspecter les pneus");
  store.supprimerOperation(copie.id);
  assert.equal(store.lire().it.operations.length, 3);
  store.annuler();
  assert.equal(store.lire().it.operations.length, 4, "la suppression s'annule");
});

test("Store : contrôles et actions correctives — création, liens, suppression, limites", () => {
  store.nouvelle();
  store.modifierMeta("typeDocument", "instruction");
  store.ajouterOperation();
  const op = () => store.lire().it.operations[0];
  const id = op().id;
  store.ajouterControleOperation(id);
  store.ajouterControleOperation(id);
  const [c1, c2] = op().controles;
  store.ajouterCorrective(id, c1.id); // créée et liée au 1er contrôle
  const m = op().correctives[0];
  assert.deepEqual(op().controles[0].correctives, [m.id]);
  store.lierCorrective(id, c2.id, m.id, true); // une même corrective répond aux deux contrôles (fig. 7.7)
  assert.deepEqual(op().controles[1].correctives, [m.id]);
  store.lierCorrective(id, c2.id, "inconnue", true);
  assert.deepEqual(op().controles[1].correctives, [m.id], "une corrective inconnue est refusée");
  store.lierCorrective(id, c2.id, m.id, false);
  assert.deepEqual(op().controles[1].correctives, []);
  store.modifierControleOperation(id, c1.id, "nature", "S");
  store.modifierControleOperation(id, c1.id, "nature", "Z"); // nature inconnue : refusée
  assert.equal(op().controles[0].nature, "S");
  store.supprimerCorrective(id, m.id);
  assert.deepEqual(op().controles[0].correctives, [], "supprimer une corrective la retire des contrôles");
  for (let k = 0; k < 6; k += 1) store.ajouterControleOperation(id);
  assert.equal(op().controles.length, 4, "4 contrôles au plus par opération");
  for (let k = 0; k < 6; k += 1) store.ajouterCorrective(id);
  assert.equal(op().correctives.length, 4, "4 actions correctives au plus par opération");
  store.supprimerControleOperation(id, c1.id);
  assert.ok(!op().controles.some((c) => c.id === c1.id));
});

test("Store : le rôle est unique (un seul nom) et le type de document se choisit à l'étape 1", () => {
  store.nouvelle();
  store.modifierMeta("typeDocument", "instruction");
  store.modifierRoleIT("nom", "Magasinier");
  store.modifierRoleIT("competences", "Permis C"); // v0.17 : les compétences requises sont retirées (vérification des documents, plus tard)
  store.modifierRoleIT("adresse", "x"); // champ inconnu : refusé
  assert.deepEqual(store.lire().it.role, { nom: "Magasinier" });
  assert.equal(store.lire().meta.typeDocument, "instruction");
});

test("Store : export puis import redonne la même instruction", () => {
  store.chargerExempleInstruction();
  const json = store.exporterJSON();
  const avant = JSON.stringify(store.lire());
  store.nouvelle();
  store.importerJSON(json);
  assert.equal(JSON.stringify(store.lire()), avant);
  assert.equal(store.lire().it.operations.length, 7);
});

test("Store : un fichier d'instruction douteux est nettoyé à l'import (limites, liens, types)", () => {
  const brut = JSON.parse(store.exporterJSON()).procedure;
  brut.it = {
    role: { nom: 42, competences: "x".repeat(2000) },
    operations: [
      ...Array.from({ length: 30 }, (_, k) => ({ id: "dup", libelle: "Op " + k, vigilance: "oui", enregistrement: 1, outils: "non", controles: "non", correctives: null })),
      null, "texte",
    ],
  };
  brut.it.operations[0].correctives = [{ id: "mA", libelle: "Corriger" }, { id: "mA", libelle: "Doublon" }];
  brut.it.operations[0].controles = [{ id: "cA", question: "Ok ?", nature: "Z", correctives: ["mA", "mZ", "mA"] }];
  brut.it.operations[1].correctives = [{ id: "mB", libelle: "Autre opération" }];
  store.importerJSON(JSON.stringify(brut));
  const it = store.lire().it;
  assert.equal(it.role.nom, "");
  assert.deepEqual(it.role, { nom: "" }, "les compétences d'un ancien fichier sont abandonnées");
  assert.equal(it.operations.length, 20, "20 opérations au plus à la saisie");
  assert.equal(new Set(it.operations.map((o) => o.id)).size, it.operations.length, "identifiants uniques");
  assert.equal(it.operations[0].vigilance, false);
  assert.equal(it.operations[0].enregistrement, false);
  assert.deepEqual(it.operations[0].outils, []);
  assert.equal(it.operations[0].controles[0].nature, "");
  assert.deepEqual(it.operations[0].controles[0].correctives, [it.operations[0].correctives[0].id], "liens vers des correctives inconnues retirés, sans doublon");
});

test("Store : un ancien fichier « procédure + instruction(s) » se rouvre comme une procédure", () => {
  const brut = JSON.parse(store.exporterJSON()).procedure;
  brut.meta.typeDocument = "les_deux";
  store.importerJSON(JSON.stringify(brut));
  assert.equal(store.lire().meta.typeDocument, "procedure");
});

test("Store : le contenu d'instruction n'entre dans la signature que s'il est commencé (une procédure déjà validée le reste)", () => {
  const p = nouvelleProcedure();
  const avant = signatureContenu(p);
  const q = JSON.parse(JSON.stringify(p));
  assert.equal(signatureContenu(q), avant, "un contenu d'instruction vide ne change pas la signature");
  q.it.operations.push(nouvelleOperation({ libelle: "Vérifier" }));
  assert.notEqual(signatureContenu(q), avant, "une opération saisie change la signature (la validation est à refaire)");
});

// ---------- Raccourci depuis une instruction marquée « niveau 3 » ----------
test("Raccourci : l'instruction de travail est préremplie depuis l'instruction de la procédure, sans la modifier", () => {
  store.chargerExemple();
  const proc = store.lire();
  const e = proc.etapes[2];
  store.modifierNiveau3(e.id, "actif", true);
  store.modifierNiveau3(e.id, "code", "IT-DOC-02");
  const avant = JSON.stringify(store.lire());
  const nomRole = store.lire().roles.find((r) => r.id === e.roleId).nom;
  const it = instructionDepuisEtape(store.lire(), e.id);
  assert.equal(JSON.stringify(store.lire()), avant, "la procédure d'origine n'est pas touchée");
  assert.equal(it.meta.typeDocument, "instruction");
  assert.equal(it.meta.reference, "IT-DOC-02");
  assert.equal(it.meta.organisation, proc.meta.organisation);
  assert.equal(it.it.role.nom, nomRole);
  assert.ok(it.meta.issueDe.includes(e.libelle));
  assert.equal(it.meta.amont.texte, proc.etapes[1].libelle.trim());
  assert.equal(it.meta.aval.texte, proc.etapes[3].libelle.trim());
  assert.equal(instructionDepuisEtape(store.lire(), "inconnu"), null);
  assert.equal(store.creerInstructionDepuisEtape("inconnu"), false);
  assert.equal(store.creerInstructionDepuisEtape(e.id), true);
  assert.equal(store.lire().meta.typeDocument, "instruction");
  store.annuler();
  assert.equal(store.lire().meta.typeDocument, "procedure", "Annuler rend la procédure");
});

// ---------- Dessin ----------
test("Dessin : l'instruction se dessine comme la fig. 7.7 — en-tête, rôle, 3 colonnes, contrôles, correctives, légende", () => {
  const p = exempleInstruction();
  const svg = texteDuSvg(dessinerNiveau3(p));
  assert.ok(dessinerNiveau3(p).startsWith("<svg"));
  for (const texte of ["IT-VEN-01", "ENREGISTRER UNE COMMANDE", "Auteur : Responsable commercial", "Chargé de clientèle", "Vérifier la commande reçue", "Références et quantités complètes ?",
    "Demander le justificatif au client", "COMMENT ?", "Plan d'auto-contrôle", "Actions correctrices", "Légende INSTRUCTION (Niv. 3)"]) {
    assert.ok(svg.includes(texte), `le dessin devrait contenir « ${texte} »`);
  }
  const taille = mesurerNiveau3(p);
  assert.ok(taille.hauteur > taille.largeur, "portrait");
  assert.ok(taillePointsNiveau3(p) >= SEUIL_PT_IT, "l'exemple est lisible (5,5 pt ou plus) sur une page A4");
  assert.equal(croisementsNiveau3(p), 0, "aucune flèche « non » n'en croise une autre");
});

test("Dessin : une instruction vide ne dessine rien ; le texte saisi est échappé (jamais du HTML)", () => {
  const vide = nouvelleProcedure();
  vide.meta.typeDocument = "instruction";
  assert.equal(dessinerNiveau3(vide), "");
  const p = exempleInstruction();
  p.it.operations[0].libelle = "<img src=x onerror=alert(1)>";
  p.it.role.nom = "\"><script>alert(1)</script>";
  const svg = dessinerNiveau3(p);
  assert.ok(!svg.includes("<script>") && !svg.includes("<img"));
  assert.ok(svg.includes("&lt;"));
});

test("Dessin : aucun texte n'est coupé (l'instruction longue reste entière, seule la taille change)", () => {
  const p = exempleInstruction();
  const long = "Alerter immédiatement le responsable d'exploitation et le HSE";
  p.it.operations[0].correctives[0].libelle = long;
  const sansBalises = texteDuSvg(dessinerNiveau3(p));
  for (const mot of long.split(" ")) assert.ok(sansBalises.includes(mot), `« ${mot} » a disparu du dessin`);
});

test("Dessin : trop dense pour une page A4 → diagnostic (texte sous 5,5 pt)", () => {
  const p = exempleInstruction();
  p.it.operations = Array.from({ length: 10 }, (_, k) => {
    const m = [0, 1, 2].map((j) => nouvelleCorrective({ id: `m${k}${j}`, libelle: "Alerter le responsable d'exploitation" }));
    return nouvelleOperation({
      id: "d" + k, libelle: "Contrôler les équipements", entree: "Ordre", sortie: "Résultat", vigilance: true, correctives: m,
      controles: [0, 1, 2].map((j) => nouveauControle({ id: `c${k}${j}`, question: "L'extincteur est-il présent, fixé et à date de validité ?", nature: "S", correctives: [m[j].id] })),
    });
  });
  assert.ok(taillePointsNiveau3(p) < SEUIL_PT_IT);
  assert.ok(cles(constatsDessinIT(p)).includes("regle3.dessin.trop_dense"));
  assert.ok(cles(constatsDiagnostic(p)).includes("regle3.dessin.trop_dense"));
  assert.deepEqual(constatsDessinIT(exempleInstruction()), []);
});

test("Diagnostic : pour une instruction, ce sont les règles du chapitre 7 (et non celles du logigramme de procédure)", () => {
  const constats = constatsDiagnostic(instructionDe(11));
  assert.ok(cles(constats).includes("regle3.operations.trop"));
  assert.ok(!cles(constats).some((c) => c.startsWith("regle.")));
});

// ---------- Textes FR / EN ----------
test("Textes : chaque constat, manque et texte de l'instruction de travail existe en français ET en anglais", () => {
  const sources = ["js/rules-it.js", "js/parcours.js", "js/diagnostic.js", "js/render3.js", "js/deroule-it.js", "js/synthese-it.js", "js/formulaire.js",
    "js/generation.js", "js/parcours-ui.js", "js/apercu-it.js", "js/apercus.js", "js/deroule.js", "js/main.js"];
  const manquantes = [];
  for (const source of sources) {
    for (const [, cle] of lire(source).matchAll(/"((?:regle3|manque\.it|dessin3|it|synth\.it|gen\.it|parcours\.page_it|form\.n3\.creer|fichier)\.[a-z0-9_.]+)"/g)) {
      if (cle.endsWith(".")) continue; // début d'une clé construite : vérifié plus bas
      for (const [nom, langue] of [["fr", fr], ["en", en]]) if (!(cle in langue)) manquantes.push(`${source} : « ${cle} » absente de ${nom}.js`);
    }
  }
  assert.deepEqual(manquantes, []);
});

test("Textes : les clés construites de l'instruction (variantes « _it », colonnes, étapes) existent en FR et EN", () => {
  const attendues = [];
  for (const base of ["form.identification.aide", "form.titre.ph", "form.reference.ph", "form.reference.aide", "form.amont.aide", "form.aval.aide"]) attendues.push(base + "_it");
  attendues.push("form.titre_it", "carte.instruction", "rail.instruction", "rail.sans_titre_it", "manque.meta.titre_it", "zone.instruction", "apercu.bouton.instruction");
  for (const etape of ["identification", "deroule", "synthese", "generation"]) attendues.push("parcours.page_it." + etape);
  for (const col of ["operations", "controles", "correctives"]) attendues.push("it.col." + col, "it.col." + col + ".aide");
  for (const n of ["Q", "H", "S", "R", "E"]) attendues.push("controle.nature." + n);
  for (const n of ["delai", "cout", "autre"]) attendues.push("contrainte.nature." + n);
  for (const type of ["procedure", "instruction"]) attendues.push("type_document." + type);
  for (const langue of [fr, en]) for (const cle of attendues) assert.ok(cle in langue, `clé « ${cle} » manquante`);
});

test("Page : le menu Fichier propose l'exemple d'instruction de travail", () => {
  const html = lire("index.html");
  assert.ok(html.includes('id="btn-exemple-it"'));
  assert.ok(html.includes('data-i18n="fichier.exemple_it"'));
  assert.ok(lire("js/main.js").includes('"btn-exemple-it"'));
});
