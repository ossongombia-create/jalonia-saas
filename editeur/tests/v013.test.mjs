// Tests v0.13 : liste R.A.C.I. (réalisateur, responsable final, consulté, informé) par instruction et par rôle,
// colonnes R A C I de la section 5, mise en page de la page de saisie (pleine largeur, diagnostic en bas, boutons d'aperçu).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as store from "../js/store.js";
import { nouvelleProcedure, nouvelleEtape, lettreRaci, raciDuRole, raciUtilise, signatureContenu } from "../js/model.js";
import { verifier } from "../js/rules.js";
import { construireDocument, plagesDeNumeros } from "../js/document.js";
import { construireDocx } from "../js/exportDocx.js";
import { importerWord } from "../js/importWord.js";
import { definirLangue } from "../js/i18n.js";
import { exempleProcedure } from "../js/exemple-procedure.js";
import fr from "../js/locales/fr.js";
import en from "../js/locales/en.js";

function trois() {
  store.nouvelle();
  store.ajouterRole(); store.ajouterRole(); store.ajouterRole(); store.ajouterRole();
  const p = store.lire();
  ["Pilote", "Responsable qualité", "Direction", "Utilisateurs"].forEach((nom, i) => store.modifierRole(p.roles[i].id, "nom", nom));
  store.ajouterEtape(); store.ajouterEtape();
  const q = store.lire();
  store.modifierEtape(q.etapes[0].id, "roleId", q.roles[0].id);
  store.modifierEtape(q.etapes[1].id, "roleId", q.roles[1].id);
  return store.lire();
}

test("R.A.C.I. : R sur un rôle sans réalisateur le désigne, sinon il devient co-réalisateur", () => {
  const p = trois();
  const [e1] = p.etapes;
  const [pilote, qhsse, dir, util] = p.roles;
  store.definirRaci(e1.id, qhsse.id, "R");
  let e = store.lire().etapes[0];
  assert.equal(e.roleId, pilote.id, "le réalisateur principal ne change pas");
  assert.deepEqual(e.participants, [qhsse.id], "l'autre R est un participant (instruction collaborative)");
  assert.equal(lettreRaci(e, pilote.id), "R");
  assert.equal(lettreRaci(e, qhsse.id), "R");
  // Retirer le R du réalisateur principal : le participant devient réalisateur principal.
  store.definirRaci(e1.id, pilote.id, "C");
  e = store.lire().etapes[0];
  assert.equal(e.roleId, qhsse.id);
  assert.deepEqual(e.participants, []);
  assert.equal(lettreRaci(e, pilote.id), "C");
  assert.equal(lettreRaci(e, dir.id), "");
  assert.equal(lettreRaci(e, util.id), "");
});

test("R.A.C.I. : un seul A par instruction ; C et I sont libres", () => {
  const p = trois();
  const [e1] = p.etapes;
  const [, qhsse, dir, util] = p.roles;
  store.definirRaci(e1.id, dir.id, "A");
  store.definirRaci(e1.id, util.id, "I");
  store.definirRaci(e1.id, qhsse.id, "C");
  let e = store.lire().etapes[0];
  assert.deepEqual([lettreRaci(e, dir.id), lettreRaci(e, util.id), lettreRaci(e, qhsse.id)], ["A", "I", "C"]);
  store.definirRaci(e1.id, util.id, "A"); // le A passe à un autre rôle
  e = store.lire().etapes[0];
  assert.equal(lettreRaci(e, dir.id), "", "l'ancien A est retiré");
  assert.equal(lettreRaci(e, util.id), "A");
  store.definirRaci(e1.id, util.id, ""); // non concerné
  assert.equal(lettreRaci(store.lire().etapes[0], util.id), "");
});

test("R.A.C.I. : lettre inconnue ou rôle inconnu refusés, annuler / rétablir fonctionnent", () => {
  const p = trois();
  const e1 = p.etapes[0];
  store.definirRaci(e1.id, p.roles[2].id, "Z");
  store.definirRaci(e1.id, "r-inconnu", "A");
  assert.deepEqual(store.lire().etapes[0].raci, {});
  store.definirRaci(e1.id, p.roles[2].id, "A");
  assert.equal(store.lire().etapes[0].raci[p.roles[2].id], "A");
  store.annuler();
  assert.deepEqual(store.lire().etapes[0].raci, {});
  store.retablir();
  assert.equal(store.lire().etapes[0].raci[p.roles[2].id], "A");
});

test("R.A.C.I. : changer le réalisateur principal ou supprimer un rôle nettoie les lettres", () => {
  const p = trois();
  const e1 = p.etapes[0];
  const [pilote, qhsse, dir, util] = p.roles;
  store.definirRaci(e1.id, dir.id, "A");
  store.definirRaci(e1.id, util.id, "C");
  store.modifierEtape(e1.id, "roleId", dir.id); // le A devient le réalisateur : plus de lettre A pour lui
  let e = store.lire().etapes[0];
  assert.equal(e.raci[dir.id], undefined);
  assert.equal(lettreRaci(e, dir.id), "R");
  store.supprimerRole(util.id);
  e = store.lire().etapes[0];
  assert.deepEqual(e.raci, {});
  store.basculerParticipant(e1.id, qhsse.id);
  store.definirRaci(e1.id, pilote.id, "I");
  store.basculerParticipant(e1.id, pilote.id); // un participant est un R : plus de I
  assert.equal(store.lire().etapes[0].raci[pilote.id], undefined);
});

test("R.A.C.I. : le nettoyage d'un fichier ne garde que des lettres valides, un seul A, jamais sur un réalisateur", () => {
  const brut = JSON.parse(JSON.stringify(nouvelleProcedure()));
  brut.roles = ["a", "b", "c", "d"].map((x) => ({ id: "r-" + x, nom: x, type: "individuel", service: "", responsabilite: "" }));
  brut.etapes = [nouvelleEtape({ id: "e1", roleId: "r-a", participants: ["r-b"], raci: { "r-a": "A", "r-b": "C", "r-c": "A", "r-d": "A", "r-x": "I", "r-e": "C" } })];
  brut.etapes.push(nouvelleEtape({ id: "e2", roleId: "r-a", raci: { "r-c": "Z", "r-d": 5 } }));
  brut.etapes.push({ ...nouvelleEtape({ id: "e3", roleId: "r-b" }), raci: "n'importe quoi" });
  const propre = store.nettoyer(brut);
  assert.deepEqual(propre.etapes[0].raci, { "r-c": "A" }, "R ne prend pas de lettre, un seul A, rôle inconnu écarté");
  assert.deepEqual(propre.etapes[1].raci, {});
  assert.deepEqual(propre.etapes[2].raci, {});
  // Un ancien fichier sans « raci » s'ouvre.
  delete brut.etapes[0].raci;
  assert.deepEqual(store.nettoyer(brut).etapes[0].raci, {});
});

test("R.A.C.I. : signature de validation inchangée quand aucune lettre n'est saisie (fichiers d'avant la v0.13)", () => {
  const p = exempleProcedure();
  const avant = JSON.parse(JSON.stringify(p));
  avant.etapes.forEach((e) => { delete e.raci; });
  assert.equal(signatureContenu(p), signatureContenu(avant));
  p.etapes[0].raci = { [p.roles[2].id]: "I" };
  assert.notEqual(signatureContenu(p), signatureContenu(avant));
});

test("R.A.C.I. : un rôle qui n'est que A, C ou I n'est pas signalé « sans étape »", () => {
  const p = trois();
  const e1 = p.etapes[0];
  const dir = p.roles[2];
  assert.ok(verifier(store.lire()).some((c) => c.cle === "regle.role.sans_etape" && c.params.nom === "Direction"));
  store.definirRaci(e1.id, dir.id, "A");
  assert.ok(!verifier(store.lire()).some((c) => c.cle === "regle.role.sans_etape" && c.params.nom === "Direction"));
});

test("plagesDeNumeros : les suites de numéros se regroupent", () => {
  assert.equal(plagesDeNumeros([]), "");
  assert.equal(plagesDeNumeros([4]), "4");
  assert.equal(plagesDeNumeros([1, 2, 3, 5, 6, 9]), "1-3, 5-6, 9");
  assert.equal(plagesDeNumeros([2, 4, 6]), "2, 4, 6");
});

function section(doc, cle) {
  return doc.sections.find((s) => s.cle === cle);
}

test("Section 5 : sans A, C ni I le tableau reste à 2 colonnes ; avec R.A.C.I. il a les colonnes R A C I et une légende", () => {
  definirLangue("fr");
  const p = exempleProcedure();
  assert.equal(raciUtilise(p), false);
  let tab = section(construireDocument(p), "responsabilites").blocs.find((b) => b.type === "tableau");
  assert.equal(tab.colonnes.length, 2);
  const [pilote, qhsse, dg, util] = p.roles;
  p.etapes[2].raci = { [dg.id]: "A", [util.id]: "I" };
  p.etapes[3].raci = { [dg.id]: "A" };
  p.etapes[4].raci = { [pilote.id]: "C" };
  assert.equal(raciUtilise(p), true);
  const doc = construireDocument(p);
  const blocs = section(doc, "responsabilites").blocs;
  tab = blocs.find((b) => b.type === "tableau");
  assert.deepEqual(tab.colonnes.slice(2), ["R", "A", "C", "I"]);
  assert.deepEqual(tab.centrees, [2, 3, 4, 5]);
  assert.equal(tab.lignes.length, p.roles.length);
  const ligneDg = tab.lignes[p.roles.indexOf(dg)];
  assert.equal(ligneDg[3], "3-4", "DG est A des instructions 3 et 4");
  const lignePilote = tab.lignes[p.roles.indexOf(pilote)];
  assert.equal(lignePilote[4], "5", "le pilote est consulté à l'instruction 5");
  assert.ok(lignePilote[2].includes("1"), "le pilote réalise l'instruction 1");
  const apres = blocs[blocs.indexOf(tab) + 1];
  assert.equal(apres.type, "paragraphe");
  assert.match(apres.texte, /R : réalisateur/);
  assert.deepEqual(raciDuRole(p, qhsse.id).A, []);
});

test("Section 6 : le tableau étant retiré, les personnes informées ne figurent plus dans le document", () => {
  definirLangue("fr");
  const p = exempleProcedure();
  const util = p.roles[3];
  p.etapes[0].informes = ["tout collaborateur"];
  p.etapes[0].raci = { [util.id]: "I" };
  const descr = section(construireDocument(p), "description").blocs;
  assert.equal(descr.find((b) => b.type === "tableau"), undefined, "le tableau d'activités est retiré");
  assert.ok(!descr.some((b) => typeof b.texte === "string" && /Informé\(s\)/.test(b.texte)), "les informés ne sont plus imprimés dans la section 6");
});

test("Word : aller-retour avec le R.A.C.I., sans perte", async () => {
  store.nouvelle();
  const p = exempleProcedure();
  p.etapes[2].raci = { [p.roles[2].id]: "A", [p.roles[3].id]: "I" };
  const { procedure, rapport } = await importerWord(construireDocx(p));
  assert.deepEqual(rapport.map((c) => c.cle), ["import.embarque"]);
  assert.deepEqual(procedure.etapes.map((e) => e.raci), p.etapes.map((e) => e.raci));
});

test("Textes : les clés R.A.C.I. existent en français et en anglais", () => {
  ["form.raci.titre", "form.raci.aide", "form.raci.role", "form.raci.aucun", "raci.R", "raci.A", "raci.C", "raci.I", "doc.raci.legende"].forEach((k) => {
    assert.ok(fr[k], "fr " + k);
    assert.ok(en[k], "en " + k);
  });
});

// ----- Page : structure de index.html (pleine largeur, diagnostic en bas, aperçus à la demande) -----
const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("Page : la saisie occupe toute la largeur, le diagnostic est en bas, les aperçus sont dans une fenêtre", () => {
  assert.ok(html.indexOf('id="colonne-saisie"') < html.indexOf('id="zone-diagnostic"'), "le diagnostic vient après la saisie");
  assert.ok(!html.includes("colonne-resultat"), "plus de colonne de résultat à côté de la saisie");
  assert.ok(html.includes('<dialog id="fenetre-apercu"'), "les aperçus s'ouvrent dans une fenêtre");
  assert.ok(html.includes('id="zone-dessin"') && html.includes('id="apercu-document"'));
});
