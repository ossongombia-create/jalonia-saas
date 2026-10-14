// Mode en ligne, côté magasins : ouverture d'un document et d'une cartographie reçus du serveur (demarrerAvec), lecture seule
// (verrouiller). Le mode lui-même dépend de la page : hors navigateur, l'éditeur reste en local.
// (Chaque fichier de test tourne dans son propre processus : le verrouillage ne touche pas les autres tests.)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { EN_LIGNE } from "../js/en-ligne.js";
import * as store from "../js/store.js";
import * as cs from "../js/cartographie-store.js";
import { empreinteDocument } from "../js/model.js";
import { exempleProcedure } from "../js/exemple-procedure.js";

const source = (chemin) => fs.readFileSync(new URL("../" + chemin, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("hors navigateur, l'éditeur est en local", () => {
  assert.equal(EN_LIGNE, false);
});

test("demarrerAvec : document du serveur ouvert et nettoyé, historique vidé, abonnés prévenus", () => {
  const appels = [];
  store.abonner((structure) => appels.push(structure));
  store.modifierMeta("titre", "Brouillon");
  assert.equal(store.peutAnnuler(), true);
  store.demarrerAvec({ meta: { typeDocument: "procedure", titre: "Acheter", inconnu: "<script>" }, roles: [], etapes: [] });
  assert.equal(store.lire().meta.titre, "Acheter");
  assert.equal(store.lire().meta.niveau, 2);
  assert.equal("inconnu" in store.lire().meta, false, "les champs inconnus sont écartés (même nettoyage qu'un fichier)");
  assert.equal(store.peutAnnuler(), false);
  assert.equal(store.peutRetablir(), false);
  assert.equal(appels.at(-1), true);
  // Un contenu minimal (document créé depuis la liste) donne un document complet, du bon type.
  store.demarrerAvec({ meta: { typeDocument: "instruction" }, roles: [], etapes: [] });
  assert.equal(store.lire().meta.typeDocument, "instruction");
  assert.equal(store.lire().meta.niveau, 3);
  assert.ok(Array.isArray(store.lire().it.operations));
});

test("demarrerAvec : un contenu illisible lève une erreur sans toucher au document ouvert", () => {
  store.demarrerAvec(exempleProcedure());
  const avant = empreinteDocument(store.lire());
  for (const mauvais of [null, [], {}, { roles: [] }, { etapes: [] }, "texte"]) {
    assert.throws(() => store.demarrerAvec(mauvais), undefined, JSON.stringify(mauvais));
    assert.equal(empreinteDocument(store.lire()), avant);
  }
});

test("lecture seule : toute tentative de modification est défaite ; on peut toujours lire et exporter", () => {
  store.demarrerAvec(exempleProcedure());
  const avant = empreinteDocument(store.lire());
  const nbEtapes = store.lire().etapes.length;
  store.verrouiller();
  assert.equal(store.estVerrouille(), true);
  const appels = [];
  store.abonner((structure) => appels.push(structure));

  store.modifierMeta("titre", "Pirate");
  store.ajouterEtape();
  store.supprimerEtape(store.lire().etapes[0].id);
  store.modifierEtape(store.lire().etapes[0].id, "libelle", "Autre chose");
  store.nouvelle("instruction");
  store.chargerExempleInstruction();
  store.importerJSON(JSON.stringify({ procedure: { meta: { titre: "Importé" }, roles: [], etapes: [] } }));
  store.creerInstructionDepuisEtape(store.lire().etapes[0].id);
  store.annuler();
  store.retablir();

  assert.equal(empreinteDocument(store.lire()), avant, "le document n'a pas changé");
  assert.equal(store.lire().etapes.length, nbEtapes);
  assert.equal(store.peutAnnuler(), false, "rien à annuler en lecture seule");
  assert.ok(appels.length >= 8 && appels.every((x) => x === true), "chaque tentative redessine la page (les champs reprennent leur valeur)");
  assert.match(store.exporterJSON(), /"procedure"/, "la copie .json reste possible");
});

test("lecture seule : un document rechargé du serveur devient la nouvelle référence, toujours en lecture seule", () => {
  store.demarrerAvec({ meta: { typeDocument: "procedure", titre: "Version 2" }, roles: [], etapes: [] });
  assert.equal(store.lire().meta.titre, "Version 2");
  store.modifierMeta("titre", "Pirate");
  assert.equal(store.lire().meta.titre, "Version 2");
});

test("cartographie en ligne : ouverture (contenu vide accepté), puis lecture seule", () => {
  const appels = [];
  cs.abonner((structure) => appels.push(structure));
  assert.equal(cs.demarrerAvec({}).processus.length, 0, "une cartographie jamais enregistrée (contenu vide) s'ouvre vide");
  const c = cs.demarrerAvec({ organisation: "Atelier", processus: [{ id: "q1", code: "ACH", nom: "Acheter", categorie: "support" }, { id: "q2", code: "??", nom: "Sans code valide" }], flux: [], documents: [] });
  assert.equal(c.organisation, "Atelier");
  assert.deepEqual(c.processus.map((p) => p.code), ["ACH"], "même nettoyage qu'un fichier : un processus sans code valide est écarté");
  assert.equal(appels.at(-1), true);

  const avant = JSON.stringify(cs.lire());
  cs.verrouiller();
  assert.equal(cs.estVerrouillee(), true);
  cs.modifierChamp("organisation", "Pirate");
  cs.ajouterProcessus("support");
  cs.supprimerProcessus("q1");
  cs.modifierFiche("ACH", "finalite", "Changer");
  cs.ajouterDocument();
  cs.vider();
  cs.chargerExemple();
  assert.equal(JSON.stringify(cs.lire()), avant);
  // Rechargée du serveur : nouvelle référence, toujours verrouillée.
  cs.demarrerAvec({ organisation: "Atelier 2", processus: [], flux: [], documents: [] });
  cs.modifierChamp("organisation", "Pirate");
  assert.equal(cs.lire().organisation, "Atelier 2");
});

test("sources : en ligne, rien n'est lu ni gardé dans le navigateur ; le mode vient de la page", () => {
  for (const f of ["js/store.js", "js/cartographie-store.js"]) {
    const code = source(f);
    assert.match(code, /import \{ EN_LIGNE \} from "\.\/en-ligne\.js"/, f);
    for (const fonction of code.match(/function (sauvegarderLocalement|charger|memoriserEnregistre|sauver)\(\) \{\n\s+if \(EN_LIGNE\) return/g) || []) assert.ok(fonction, f);
  }
  assert.match(source("js/store.js"), /function sauvegarderLocalement\(\) \{\n {2}if \(EN_LIGNE\) return;/);
  assert.match(source("js/store.js"), /function charger\(\) \{\n {2}if \(EN_LIGNE\) return null;/);
  assert.match(source("js/cartographie-store.js"), /function sauver\(\) \{\n {2}if \(EN_LIGNE\) return;/);
  assert.match(source("js/cartographie-store.js"), /function charger\(\) \{\n {2}if \(EN_LIGNE\) return nouvelleCartographie\(\);/);
  assert.match(source("js/en-ligne.js"), /dataset\.mode === "en-ligne"/);
  // index.html (local) ne porte pas le mode en ligne : c'est la copie dans l'application web qui le pose.
  assert.doesNotMatch(source("index.html"), /data-mode=/);
  // Les nouveaux modules ne fabriquent jamais de HTML à partir de texte.
  for (const f of ["js/en-ligne.js", "js/en-ligne-ui.js", "js/synchro.js", "js/serveur.js"]) {
    assert.doesNotMatch(source(f), /innerHTML|outerHTML|insertAdjacentHTML|document\.write/, f);
  }
});

test("textes : les clés du mode en ligne existent en français et en anglais, avec les mêmes variables", async () => {
  const fr = (await import("../js/locales/fr.js")).default;
  const en = (await import("../js/locales/en.js")).default;
  const code = ["js/en-ligne-ui.js", "js/deroule.js", "js/mentions.js", "js/cartographie-ui.js"].map(source).join("\n") + source("index.html");
  const cles = new Set([...code.matchAll(/["'](enligne\.[a-z0-9_.]*[a-z0-9_])["']/g)].map((m) => m[1]));
  ["document", "cartographie"].forEach((g) => cles.add("enligne.bloque.titre." + g));
  ["enregistre", "modifie", "envoi", "erreur_reseau", "bloque", "lecture_seule"].forEach((e) => cles.add("enligne.etat." + e));
  assert.ok(cles.size >= 35, `le test lit bien les fichiers (${cles.size} clés)`);
  const variables = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
  for (const cle of cles) {
    assert.ok(cle in fr, `absente du français : ${cle}`);
    assert.ok(cle in en, `absente de l'anglais : ${cle}`);
    assert.equal(variables(fr[cle]), variables(en[cle]), `variables différentes : ${cle}`);
  }
});
