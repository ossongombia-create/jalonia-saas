// Tests du store : modifications et nettoyage d'un fichier importé (donnée non fiable).
import test from "node:test";
import assert from "node:assert/strict";
import * as store from "../js/store.js";

test("ajouter un rôle puis une étape", () => {
  store.nouvelle();
  store.ajouterRole();
  const role = store.lire().roles[0];
  store.modifierRole(role.id, "nom", "Comptable");
  store.ajouterEtape();
  const etape = store.lire().etapes[0];
  store.modifierEtape(etape.id, "roleId", role.id);
  assert.equal(store.lire().roles[0].nom, "Comptable");
  assert.equal(store.lire().etapes[0].roleId, role.id);
});

test("supprimer un rôle le retire des étapes", () => {
  store.chargerExemple();
  const p = store.lire();
  const idAssistante = "r-assist";
  store.supprimerRole(idAssistante);
  assert.ok(store.lire().etapes.every((e) => e.roleId !== idAssistante && !e.participants.includes(idAssistante)));
});

test("un participant ne peut pas être le responsable lui-même", () => {
  store.chargerExemple();
  const e = store.lire().etapes[2];
  const avant = [...e.participants];
  store.basculerParticipant(e.id, e.roleId);
  assert.deepEqual(store.lire().etapes[2].participants, avant);
});

test("export puis import redonne la même procédure", () => {
  store.chargerExemple();
  const json = store.exporterJSON();
  const avant = JSON.stringify(store.lire());
  store.nouvelle();
  store.importerJSON(json);
  assert.equal(JSON.stringify(store.lire()), avant);
});

test("import : un fichier hostile est nettoyé", () => {
  const hostile = {
    procedure: {
      meta: { titre: "x".repeat(5000), inconnu: "<script>" },
      roles: [{ id: "<img onerror=1>", nom: 42, type: "pirate" }],
      etapes: [{ id: "e1", roleId: "inexistant", libelle: "Faire", participants: ["zzz"], informes: [1, "ok"], __proto__: { x: 1 } }],
    },
  };
  store.importerJSON(JSON.stringify(hostile));
  const p = store.lire();
  assert.equal(p.meta.titre.length, 500);
  assert.equal("inconnu" in p.meta, false);
  assert.match(p.roles[0].id, /^[\w-]+$/);
  assert.equal(p.roles[0].type, "individuel");
  assert.equal(p.roles[0].nom, "");
  assert.equal(p.etapes[0].roleId, "");
  assert.deepEqual(p.etapes[0].participants, []);
  assert.deepEqual(p.etapes[0].informes, ["ok"]);
});

test("import : un fichier qui n'est pas une procédure est refusé", () => {
  assert.throws(() => store.importerJSON('{"a":1}'));
  assert.throws(() => store.importerJSON("pas du json"));
});

test("annuler et rétablir", () => {
  store.chargerExemple();
  const avantSuppression = store.lire().etapes.length;
  store.supprimerEtape(store.lire().etapes[0].id);
  assert.equal(store.lire().etapes.length, avantSuppression - 1);
  store.annuler();
  assert.equal(store.lire().etapes.length, avantSuppression);
  assert.ok(store.peutRetablir());
  store.retablir();
  assert.equal(store.lire().etapes.length, avantSuppression - 1);
});

test("les frappes dans un même champ ne forment qu'un seul pas d'annulation", () => {
  store.chargerExemple();
  const id = store.lire().etapes[0].id;
  const original = store.lire().etapes[0].libelle;
  "Nouveau libellé".split("").forEach((_, k, lettres) => store.modifierEtape(id, "libelle", lettres.slice(0, k + 1).join("")));
  store.annuler();
  assert.equal(store.lire().etapes[0].libelle, original);
});

test("une modification après annulation efface le « rétablir »", () => {
  store.chargerExemple();
  store.supprimerEtape(store.lire().etapes[0].id);
  store.annuler();
  store.ajouterRole();
  assert.equal(store.peutRetablir(), false);
});

test("dupliquer une étape", () => {
  store.chargerExemple();
  const n = store.lire().etapes.length;
  const source = store.lire().etapes[1];
  store.dupliquerEtape(source.id);
  const p = store.lire();
  assert.equal(p.etapes.length, n + 1);
  assert.equal(p.etapes[2].libelle, source.libelle);
  assert.notEqual(p.etapes[2].id, source.id);
});

test("un import refusé ne touche pas à la procédure ni à l'historique", () => {
  store.chargerExemple();
  const avantImport = JSON.stringify(store.lire());
  assert.throws(() => store.importerJSON('{"a":1}'));
  assert.equal(JSON.stringify(store.lire()), avantImport);
});

test("outils : ajouter, renommer, changer de type, supprimer, annuler", () => {
  store.nouvelle();
  store.ajouterRole();
  store.ajouterEtape();
  const e = store.lire().etapes[0];
  store.ajouterOutil(e.id, "document");
  store.ajouterOutil(e.id, "materiel");
  store.ajouterOutil(e.id, "n'importe quoi"); // refusé
  assert.equal(store.lire().etapes[0].outils.length, 2);
  const o = store.lire().etapes[0].outils[0];
  store.modifierOutil(e.id, o.id, "nom", "FO-32-02");
  store.modifierOutil(e.id, o.id, "type", "inconnu"); // refusé
  assert.equal(store.lire().etapes[0].outils[0].nom, "FO-32-02");
  assert.equal(store.lire().etapes[0].outils[0].type, "document");
  store.supprimerOutil(e.id, o.id);
  assert.equal(store.lire().etapes[0].outils.length, 1);
  store.annuler();
  assert.equal(store.lire().etapes[0].outils.length, 2);
});

test("outils : limite de 6 par instruction, copie avec de nouveaux identifiants", () => {
  store.nouvelle();
  store.ajouterEtape();
  const e = store.lire().etapes[0];
  for (let i = 0; i < 9; i += 1) store.ajouterOutil(e.id, "document");
  assert.equal(store.lire().etapes[0].outils.length, 6);
  store.dupliquerEtape(e.id);
  const [a, b] = store.lire().etapes;
  assert.equal(b.outils.length, 6);
  assert.ok(b.outils.every((o) => !a.outils.some((x) => x.id === o.id)));
});

test("outils : un fichier importé hostile est nettoyé", () => {
  store.nouvelle();
  const brut = { roles: [], etapes: [{ id: "e1", libelle: "Faire", outils: [
    { id: "o1", type: "<img>", nom: "x".repeat(5000) }, null, "texte", { id: "o1", type: "materiel", nom: "Scanner" },
    ...Array.from({ length: 20 }, (_, i) => ({ id: "z" + i, type: "document", nom: "n" + i })) ] }] };
  store.importerJSON(JSON.stringify(brut));
  const outils = store.lire().etapes[0].outils;
  assert.equal(outils.length, 4); // seuls les 6 premiers sont lus, puis null/texte sont écartés
  assert.equal(outils[0].type, "document");
  assert.ok(outils[0].nom.length <= 200);
  assert.equal(new Set(outils.map((o) => o.id)).size, outils.length);
});
