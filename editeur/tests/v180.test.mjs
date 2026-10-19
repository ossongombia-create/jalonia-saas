// Tests v1.8 — release de mise en service : décisions du 19/10/2026 (docs/DECISIONS.md) implémentées en quatre sessions
// (accès d'urgence et réinitialisation par lien ; correctif de la clé du second facteur ; second facteur des
// approbateurs et mode « petite organisation » ; séparation dans le plan d'actions ; fin de contrat).
// Ces tests lisent aussi des fichiers du dépôt hors de editeur/ (migrations, scripts, docs, deploy).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { VERSION } from "../js/version.js";

const editeur = (chemin) => fs.readFileSync(new URL("../" + chemin, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const depot = (chemin) => fs.readFileSync(new URL("../../" + chemin, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const existe = (chemin) => fs.existsSync(new URL("../../" + chemin, import.meta.url));

/** Les comptes de tests de la v1.8 (à reprendre à l'identique dans AGENTS.md et dans le CHANGELOG). */
const TOTAL = "855 tests automatisés";
const FAMILLES = ["493 éditeur (486 + 7)", "163 unitaires", "199 intégration", "7/7", "6/6", "16/16", "44 actions", "372 appels forgés"];

test("la version est 1.8", () => {
  assert.equal(VERSION, "1.8");
});

test("CHANGELOG : l'entrée v1.8 vient en tête, avec sa source, ses sessions, ses migrations, ses tests et la licence", () => {
  const journal = editeur("CHANGELOG.md");
  const premiere = journal.indexOf("\n## ");
  assert.ok(journal.startsWith("## v1.8 ", premiere + 1), "première entrée : v1.8");
  const v18 = journal.slice(premiere + 1, journal.indexOf("\n## v1.7 "));
  assert.match(v18, /décisions du 19\/10\/2026/);
  for (const s of ["Session 1", "Correctif", "Session 2", "Session 3", "Session 4"]) assert.ok(v18.includes(s), s);
  for (const m of ["0008_acces_urgence_reinitialisation.sql", "0009_mode_validation.sql", "0009_notification_acces_urgence.sql", "0010_cloture_action.sql"]) assert.ok(v18.includes(m), m);
  assert.ok(v18.includes(TOTAL), TOTAL);
  for (const f of FAMILLES) assert.ok(v18.includes(f), f);
  assert.match(v18, /[Ll]icence propriétaire/);
});

test("AGENTS.md cite VERSION = 1.8 et les comptes de tests de la v1.8", () => {
  const agents = editeur("AGENTS.md");
  assert.ok(agents.includes(`VERSION = "1.8"`));
  assert.ok(agents.includes(TOTAL), TOTAL);
  for (const f of FAMILLES) assert.ok(agents.includes(f), f);
  assert.match(agents, /`v180\.test\.mjs`/);
});

test("les migrations de la v1.8 existent (plateforme 0008 et 0009, organisation 0009 et 0010)", () => {
  for (const m of [
    "db/migrations/plateforme/0008_acces_urgence_reinitialisation.sql",
    "db/migrations/plateforme/0009_mode_validation.sql",
    "db/migrations/organisation/0009_notification_acces_urgence.sql",
    "db/migrations/organisation/0010_cloture_action.sql",
  ]) assert.ok(existe(m), m);
});

test("les scripts de fin de contrat existent ; la suppression exige un terminal interactif et le nom de l'organisation", () => {
  assert.ok(existe("scripts/exporter-organisation.ts"));
  assert.ok(existe("scripts/supprimer-organisation.ts"));
  const suppression = depot("scripts/supprimer-organisation.ts");
  assert.match(suppression, /process\.stdin\.isTTY/);
  assert.match(suppression, /tapez le nom exact/);
  assert.ok(existe("tests/integration/fin-de-contrat.test.ts"));
});

test("INSTALL-VPS.md : procédure de fin de contrat, corbeille sans limite, quotas au contrat, plus de quota de 5 Go", () => {
  const install = depot("deploy/INSTALL-VPS.md");
  const fin = install.slice(install.indexOf("## Fin de contrat"), install.indexOf("\n## ", install.indexOf("## Fin de contrat") + 3));
  assert.ok(fin.length > 0, "section « Fin de contrat »");
  for (const attendu of ["exporter-organisation.ts", "supprimer-organisation.ts", "SHA-256", "jalonia-sauvegarde", "Corbeille sans limite", "50", "5 Go"]) assert.ok(fin.includes(attendu), attendu);
  assert.match(fin, /suspendre → exporter → remettre l'export → sauvegarder → supprimer/);
});

test("docs/DECISIONS.md : note « v1.8 — décisions implémentées » en tête de la section du 19/10/2026, avec les commits", () => {
  const decisions = depot("docs/DECISIONS.md");
  const section = decisions.slice(decisions.indexOf("## Décisions du 19/10/2026"));
  const note = section.slice(0, section.indexOf("| N° |"));
  assert.match(note, /v1\.8 — décisions implémentées/);
  for (const h of ["3fe29c2", "2aa046e", "c45b3d8", "de67a85"]) assert.ok(note.includes(h), h);
});
