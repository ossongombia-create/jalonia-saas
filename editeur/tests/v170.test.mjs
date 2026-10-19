// Tests v1.7 — contrat de l'agent (editeur/AGENTS.md), documentation à jour, licence PROPRIÉTAIRE et fin de la « version
// d'essai » : « © 2026 Brice Ossongombia — tous droits réservés. Utilisation soumise à contrat. ».
// Ces tests lisent aussi des fichiers du dépôt hors de editeur/ (docs/DECISIONS.md, package.json, README.md, LICENSE).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { VERSION } from "../js/version.js";
import { CONFIG } from "../js/config.js";
import fr from "../js/locales/fr.js";
import en from "../js/locales/en.js";

const editeur = (chemin) => fs.readFileSync(new URL("../" + chemin, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const depot = (chemin) => fs.readFileSync(new URL("../../" + chemin, import.meta.url), "utf8").replace(/\r\n/g, "\n");

// ---------- Contrat de l'agent ----------
test("editeur/AGENTS.md existe et donne la version, les comptes de tests, la stratégie de tag et les prérequis", () => {
  const agents = editeur("AGENTS.md");
  assert.ok(agents.includes(`VERSION = "${VERSION}"`), "la version de js/version.js");
  assert.ok(agents.includes("780 tests automatisés"), "le total des tests automatisés de la v1.7");
  ["486 éditeur (477 + 9)", "133 unitaires", "161 intégration", "7/7", "6/6", "16/16"].forEach((n) => assert.ok(agents.includes(n), `détail des familles : ${n}`));
  assert.match(agents, /tag Git annoté `vX\.Y`/);
  assert.match(agents, /openssl/);
  assert.match(agents, /22\.22/);
});

// ---------- CHANGELOG ----------
test("CHANGELOG : la note Git vient en tête, l'entrée v1.6 cite ses 477 tests", () => {
  const journal = editeur("CHANGELOG.md");
  const tete = journal.slice(0, journal.indexOf("\n## "));
  assert.match(tete, /Depuis le Module 6, Git remplace `versions\/` : chaque release est un tag annoté `vX\.Y` sur `main`\./);
  const v16 = journal.slice(journal.indexOf("## v1.6 "), journal.indexOf("## v1.5 "));
  assert.match(v16, /477 tests Node au vert/);
});

// ---------- Décisions ----------
test("docs/DECISIONS.md : plus de chiffres périmés, une section « Incrément 5 »", () => {
  const decisions = depot("docs/DECISIONS.md");
  assert.ok(!decisions.includes("445 tests"), "« 445 tests » est périmé");
  assert.ok(!decisions.includes("28 actions"), "« 28 actions » est périmé");
  assert.match(decisions, /40 actions × 9 profils, 323 appels forgés/);
  assert.match(decisions, /^## Incrément 5/m);
});

// ---------- Version ----------
test("la version est 1.7", () => {
  assert.equal(VERSION, "1.7");
});

// ---------- Licence propriétaire ----------
test("plus aucune « version d'essai » ni « non commerciale » dans les textes publiés et la documentation", () => {
  const fichiers = ["js/config.js", "js/mentions.js", "js/locales/fr.js", "js/locales/en.js", "guide-fr.html", "guide-en.html", "LICENCES-TIERS.md", "README.md"];
  const interdits = /version d['’]essai|trial version|non[- ]commercial/i;
  for (const f of fichiers) assert.doesNotMatch(editeur(f), interdits, `editeur/${f}`);
  assert.doesNotMatch(depot("README.md"), interdits, "README.md");
});

test("la ligne des droits et les mentions disent : propriétaire, utilisation soumise à contrat (FR et EN)", () => {
  assert.equal(CONFIG.titulaire, "Brice Ossongombia");
  assert.equal(CONFIG.anneeDroits, "2026");
  assert.equal(fr["mentions.droits"], "© {annee} {titulaire} — tous droits réservés. Utilisation soumise à contrat.");
  assert.equal(en["mentions.droits"], "© {annee} {titulaire} — all rights reserved. Use subject to contract.");
  assert.match(fr["mentions.essai.titre"], /propriétaire/);
  assert.match(en["mentions.essai.titre"], /[Pp]roprietary/);
  for (const g of ["guide-fr.html", "guide-en.html"]) assert.match(editeur(g), /© 2026 Brice Ossongombia/, g);
  assert.match(editeur("LICENCES-TIERS.md"), /© 2026 Brice Ossongombia — tous droits réservés\. Utilisation soumise à contrat\./);
});

test("français et anglais ont exactement les mêmes clés", () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(fr).sort());
});

test("LICENSE à la racine du dépôt : tous droits réservés, accord écrit préalable", () => {
  const licence = depot("LICENSE");
  assert.match(licence, /Copyright \(c\) 2026 Brice Ossongombia/);
  assert.match(licence, /tous droits réservés|all rights reserved/i);
  assert.match(licence, /accord écrit préalable/);
});

// ---------- Prérequis ----------
test("package.json exige Node 22.22 au moins (tls.setDefaultCACertificates, tests d'intégration)", () => {
  const exige = JSON.parse(depot("package.json")).engines.node;
  const m = /^>=(\d+)\.(\d+)(?:\.\d+)?$/.exec(exige);
  assert.ok(m, `forme attendue >=X.Y.Z : ${exige}`);
  assert.ok(Number(m[1]) > 22 || (Number(m[1]) === 22 && Number(m[2]) >= 22), exige);
});
