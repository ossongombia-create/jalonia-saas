// Tests v0.25 — la liste « Domaine » de l'étape 1 (Identification) propose : Management, Réalisation, Support, Vérification.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as store from "../js/store.js";
import { DOMAINES, DOMAINES_ANCIENS, domaineValide, signatureContenu } from "../js/model.js";
import { CATEGORIES } from "../js/cartographie.js";
import { definirLangue, t } from "../js/i18n.js";
import { construireDocument } from "../js/document.js";
import { construireDocx } from "../js/exportDocx.js";
import { importerWord } from "../js/importWord.js";
import { exempleProcedure } from "../js/exemple-procedure.js";
import fr from "../js/locales/fr.js";
import en from "../js/locales/en.js";

const source = (chemin) => fs.readFileSync(new URL("../" + chemin, import.meta.url), "utf8");
definirLangue("fr");

test("la liste proposée : Management, Réalisation, Support, Surveillance & mesure — dans cet ordre", () => {
  assert.deepEqual(DOMAINES, ["management", "realisation", "support", "verification"]);
  assert.deepEqual(DOMAINES.map((k) => fr["domaine." + k]), ["Management", "Réalisation", "Support", "Surveillance & mesure"]);
  assert.deepEqual(DOMAINES.map((k) => en["domaine." + k]), ["Management", "Realisation", "Support", "Monitoring & measurement"]);
  definirLangue("fr");
  assert.equal(t("domaine.verification"), "Surveillance & mesure");
  definirLangue("en");
  assert.equal(t("domaine.verification"), "Monitoring & measurement");
  definirLangue("fr");
});

test("le formulaire construit la liste à partir de DOMAINES (aucune liste recopiée à la main)", () => {
  const f = source("js/formulaire.js");
  assert.match(f, /\.\.\.\[\.\.\.DOMAINES, \.\.\.\(DOMAINES_ANCIENS\.includes\(m\.domaine\)/);
  assert.ok(!/"verification"/.test(f), "la clé n'est écrite qu'à un endroit : model.js");
});

test("le domaine « vérification » se choisit, se vide et se garde à la réouverture ; une valeur inconnue est toujours refusée", () => {
  store.nouvelle();
  store.modifierMeta("domaine", "verification");
  assert.equal(store.lire().meta.domaine, "verification");
  assert.ok(domaineValide("verification"));
  const brut = JSON.parse(store.exporterJSON());
  assert.equal(brut.procedure.meta.domaine, "verification");
  store.nouvelle();
  store.importerJSON(JSON.stringify(brut));
  assert.equal(store.lire().meta.domaine, "verification");
  store.modifierMeta("domaine", "n'importe quoi");
  assert.equal(store.lire().meta.domaine, "verification", "valeur inconnue refusée");
  store.modifierMeta("domaine", "");
  assert.equal(store.lire().meta.domaine, "");
});

// v0.27 : la cartographie reçoit à son tour le 4e bloc « Vérification » (décision de Brice du 03/10 — elle renverse le choix de la v0.25).
test("la cartographie a bien quatre blocs depuis la v0.27, « vérification » compris ; les anciens domaines restent lisibles", () => {
  assert.deepEqual(CATEGORIES, ["management", "realisation", "support", "verification"]);
  assert.ok(CATEGORIES.includes("verification"));
  DOMAINES_ANCIENS.forEach((k) => assert.ok(domaineValide(k), k));
  store.nouvelle();
  store.modifierMeta("domaine", "hse");
  assert.equal(store.lire().meta.domaine, "hse", "un ancien domaine est encore accepté");
});

test("la signature de validation d'un document existant ne change pas ; le domaine « vérification » en a une propre", () => {
  const p = exempleProcedure();
  const avant = signatureContenu(p);
  const copie = JSON.parse(JSON.stringify(p));
  assert.equal(signatureContenu(copie), avant);
  copie.meta.domaine = "verification";
  assert.notEqual(signatureContenu(copie), avant, "changer le domaine change bien la signature (le domaine fait partie du contenu validé)");
  copie.meta.domaine = p.meta.domaine;
  assert.equal(signatureContenu(copie), avant);
});

test("le document construit affiche « Vérification » dans l'en-tête (français et anglais)", () => {
  const p = JSON.parse(JSON.stringify(exempleProcedure()));
  p.meta.domaine = "verification";
  definirLangue("fr");
  assert.equal(construireDocument(p).cartouche.domaine, "Surveillance & mesure");
  definirLangue("en");
  assert.equal(construireDocument(p).cartouche.domaine, "Monitoring & measurement");
  definirLangue("fr");
});

test("Word : le domaine « Vérification » est relu à l'import, avec ou sans la partie cachée, en français comme en anglais", async () => {
  const p = JSON.parse(JSON.stringify(exempleProcedure()));
  p.meta.domaine = "verification";
  for (const langue of ["fr", "en"]) {
    definirLangue(langue);
    for (const embarquer of [true, false]) {
      const { procedure } = await importerWord(construireDocx(p, { embarquer }));
      assert.equal(procedure.meta.domaine, "verification", `${langue}, embarquer=${embarquer}`);
    }
  }
  definirLangue("fr");
});

test("Word : les autres domaines ne sont pas pris pour « vérification » (et inversement)", async () => {
  const p = JSON.parse(JSON.stringify(exempleProcedure()));
  for (const k of DOMAINES) {
    p.meta.domaine = k;
    const { procedure } = await importerWord(construireDocx(p, { embarquer: false }));
    assert.equal(procedure.meta.domaine, k, k);
  }
});

test("le guide de démarrage cite les quatre domaines, comme la liste", () => {
  assert.ok(source("guide-fr.html").includes("Management, Réalisation, Support, Surveillance & mesure"));
  assert.ok(source("guide-en.html").includes("Management, Realisation, Support, Monitoring & measurement"));
});

test("les textes d'aide et les libellés sont en parité FR/EN", () => {
  assert.ok(fr["domaine.verification"] && en["domaine.verification"]);
  assert.ok(fr["form.domaine.aide"].includes("surveillance & mesure"));
  assert.ok(en["form.domaine.aide"].includes("monitoring & measurement"));
  assert.equal(Object.keys(fr).length, Object.keys(en).length);
});
