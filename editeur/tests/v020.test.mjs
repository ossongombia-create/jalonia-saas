// Tests v0.20 — (1) le « Domaine » de l'identification = les blocs de la cartographie (management, réalisation, support) ;
// (2) « Nouveau » et les exemples ne montrent rien qui soit propre à une entreprise réelle : l'application sert à toute organisation.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as store from "../js/store.js";
import { DOMAINES, DOMAINES_ANCIENS, domaineValide, signatureContenu, nouvelleProcedure } from "../js/model.js";
import { CATEGORIES } from "../js/cartographie.js";
import { exempleProcedure } from "../js/exemple-procedure.js";
import { exempleInstruction } from "../js/exemple-it.js";
import { exempleCartographie } from "../js/exemple-carto.js";
import { nettoyerCartographie, processusParCode } from "../js/cartographie.js";
import { construireDocument, estimerPages } from "../js/document.js";
import { verifier } from "../js/rules.js";
import { verifierIT } from "../js/rules-it.js";
import { constatsDiagnostic } from "../js/diagnostic.js";
import { construireDocx } from "../js/exportDocx.js";
import { importerWord } from "../js/importWord.js";
import { definirLangue } from "../js/i18n.js";
import fr from "../js/locales/fr.js";
import en from "../js/locales/en.js";

definirLangue("fr");
const source = (chemin) => fs.readFileSync(new URL("../" + chemin, import.meta.url), "utf8");
// Ce qui est propre à une entreprise réelle : son nom, ses codes de processus et de documents, ses rôles, son métier.
import { PROPRE, CODES_PROCESSUS_PROPRES } from "./neutralite.mjs";

// ---------- Domaine = blocs de la cartographie ----------
test("le domaine propose les quatre blocs de la cartographie (depuis la v0.27, « vérification » y est aussi) ; les anciens domaines restent lisibles", () => {
  assert.deepEqual(DOMAINES, CATEGORIES); // v0.27 : la cartographie a le même 4e bloc « Vérification » que la liste Domaine
  assert.deepEqual(DOMAINES, ["management", "realisation", "support", "verification"]);
  DOMAINES.forEach((k) => { assert.ok(fr["domaine." + k], k); assert.ok(en["domaine." + k], k); });
  DOMAINES_ANCIENS.forEach((k) => { assert.ok(fr["domaine." + k] && en["domaine." + k], "ancien domaine encore affichable : " + k); assert.ok(domaineValide(k)); });
  assert.ok(!domaineValide("n'importe quoi") && !domaineValide(""));
});

test("magasin : le domaine se choisit parmi les blocs ; une valeur inconnue est refusée ; un fichier ancien garde son domaine sans changer de signature", () => {
  store.nouvelle();
  store.modifierMeta("domaine", "realisation");
  assert.equal(store.lire().meta.domaine, "realisation");
  store.modifierMeta("domaine", "n'importe quoi");
  assert.equal(store.lire().meta.domaine, "realisation");
  store.modifierMeta("domaine", "");
  assert.equal(store.lire().meta.domaine, "");
  const brut = JSON.parse(JSON.stringify(store.lire()));
  brut.meta.domaine = "depot"; // fichier d'avant la v0.20
  store.importerProcedure(brut);
  assert.equal(store.lire().meta.domaine, "depot");
  const avant = signatureContenu(store.lire());
  const rouvert = JSON.parse(JSON.stringify(store.lire()));
  store.importerProcedure(rouvert);
  assert.equal(signatureContenu(store.lire()), avant, "rouvrir ne change pas la signature");
  brut.meta.domaine = "inconnu";
  store.importerProcedure(brut);
  assert.equal(store.lire().meta.domaine, "", "un domaine inconnu est écarté");
});

test("Word : le domaine « Réalisation » d'un document est relu à l'import", async () => {
  store.chargerExemple();
  store.modifierMeta("domaine", "realisation");
  const { procedure } = await importerWord(construireDocx(store.lire(), { embarquer: false }));
  assert.equal(procedure.meta.domaine, "realisation");
  store.modifierMeta("domaine", "management");
  const { procedure: m } = await importerWord(construireDocx(store.lire(), { embarquer: false }));
  assert.equal(m.meta.domaine, "management");
});

test("les exemples ont un domaine qui est un bloc de la cartographie", () => {
  assert.ok(DOMAINES.includes(exempleProcedure().meta.domaine));
  assert.ok(DOMAINES.includes(exempleInstruction().meta.domaine));
});

// ---------- Rien de propre à une entreprise dans « Nouveau » ni dans les exemples ----------
test("« Nouveau » (procédure ou instruction) part d'un document vide, sans aucun texte d'entreprise", () => {
  store.nouvelle();
  const brut = JSON.stringify(store.lire());
  assert.doesNotMatch(brut, PROPRE);
  const p = store.lire();
  assert.equal(p.meta.organisation, "");
  assert.equal(p.meta.logo, "");
  assert.equal(p.meta.domaine, "");
  assert.equal(p.roles.length, 0);
  assert.equal(p.etapes.length, 0);
  store.modifierMeta("typeDocument", "instruction");
  assert.doesNotMatch(JSON.stringify(store.lire()), PROPRE);
  assert.doesNotMatch(JSON.stringify(nouvelleProcedure()), PROPRE);
});

test("les trois exemples parlent d'une organisation fictive : aucun nom, code ni métier d'une entreprise réelle", () => {
  const procedure = exempleProcedure();
  const instruction = exempleInstruction();
  const carto = exempleCartographie();
  [["procédure", procedure], ["instruction", instruction], ["cartographie", carto]].forEach(([nom, x]) => assert.doesNotMatch(JSON.stringify(x), PROPRE, "exemple " + nom));
  assert.equal(procedure.meta.organisation, "Entreprise Exemple");
  assert.equal(instruction.meta.organisation, "Entreprise Exemple");
  assert.equal(carto.organisation, "Entreprise Exemple");
  assert.doesNotMatch(JSON.stringify(construireDocument(procedure)), PROPRE, "le document construit");
});

test("textes de l'application (FR et EN) : ni placeholder ni aide propre à une entreprise", () => {
  [["fr", fr], ["en", en]].forEach(([langue, textes]) => {
    Object.entries(textes).forEach(([cle, valeur]) => assert.doesNotMatch(String(valeur), PROPRE, `${langue} : ${cle}`));
  });
});

test("code de l'application (hors commentaires) : aucun nom ni code d'entreprise écrit en dur", () => {
  const fichiers = fs.readdirSync(new URL("../js/", import.meta.url)).filter((f) => f.endsWith(".js"));
  fichiers.forEach((f) => {
    const code = source("js/" + f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    assert.doesNotMatch(code, PROPRE, "js/" + f);
    assert.doesNotMatch(code, CODES_PROCESSUS_PROPRES, "code de processus d'une entreprise réelle dans js/" + f);
  });
  assert.doesNotMatch(source("index.html"), PROPRE);
  assert.doesNotMatch(source("css/style.css"), PROPRE);
});

test("le fichier d'exemple s'appelle exemple-procedure.js et aucun fichier ne porte un nom d'entreprise", () => {
  assert.ok(fs.existsSync(new URL("../js/exemple-procedure.js", import.meta.url)));
  fs.readdirSync(new URL("../js/", import.meta.url)).forEach((f) => assert.doesNotMatch(f, PROPRE, f));
});

// ---------- Les exemples neutres restent de vrais exemples ----------
test("exemple de procédure : conforme aux règles, cartographie de l'exemple cohérente, 5 pages au plus", () => {
  const p = exempleProcedure();
  const erreurs = verifier(p, { nomenclature: { controle: true, procedure: "PR" } }).filter((c) => c.gravite === "erreur");
  assert.deepEqual(erreurs, []);
  assert.ok(estimerPages(construireDocument(p)) <= 5);
  const carto = nettoyerCartographie(exempleCartographie());
  assert.ok(processusParCode(carto, "REA"), "le processus du document est dans la cartographie de l'exemple");
  assert.equal(p.meta.reference, "PR-REA-01");
  assert.equal(p.meta.processus.split(" ")[0], "REA");
  assert.deepEqual(constatsDiagnostic(p, carto).filter((c) => /^regle\.(code|processus)\./.test(c.cle)), [], "le code et le processus suivent la cartographie de l'exemple");
});

test("exemple d'instruction : conforme aux règles du chapitre 7 et à la cartographie de l'exemple", () => {
  const p = exempleInstruction();
  assert.deepEqual(verifierIT(p).filter((c) => c.gravite === "erreur"), []);
  assert.equal(p.it.role.nom, "Chargé de clientèle");
  assert.equal(p.it.operations.length, 7);
  const carto = nettoyerCartographie(exempleCartographie());
  assert.ok(processusParCode(carto, "VEN"));
  assert.deepEqual(constatsDiagnostic(p, carto).filter((c) => /^regle\.(code|processus)\./.test(c.cle)), []);
});

test("exemple de cartographie : 10 processus dans les quatre blocs, 11 échanges, les documents de la procédure d'exemple", () => {
  const c = nettoyerCartographie(exempleCartographie());
  assert.equal(c.processus.length, 10);
  CATEGORIES.forEach((k) => assert.ok(c.processus.some((p) => p.categorie === k), k));
  assert.ok(c.processus.some((p) => p.categorie === "verification"), "le 4e bloc « Vérification » est présent dans l'exemple (v0.27)");
  assert.equal(c.flux.length, 11);
  assert.ok(c.documents.some((d) => d.code === "PR-VEN-01"));
  assert.equal(c.nomenclature.controle, true);
});
