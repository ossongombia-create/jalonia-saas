// Tests v0.9 : contrôles (triangle Q/H/S/R/E), décisions, renvois et boucles.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as store from "../js/store.js";
import { nouvelleProcedure, nouvelleEtape, nouvelleAlternative, signatureContenu, MAX_ALTERNATIVES } from "../js/model.js";
import { verifier } from "../js/rules.js";
import { manquantsDeroule } from "../js/parcours.js";
import { construireDocument, listeControles, listeDecisions, estimerPages } from "../js/document.js";
import { dessinerNiveau2, croisementsNiveau2, mesurerNiveau2 } from "../js/render.js";
import { construireDocx } from "../js/exportDocx.js";
import { importerWord } from "../js/importWord.js";
import { exempleProcedure } from "../js/exemple-procedure.js";
import fr from "../js/locales/fr.js";
import en from "../js/locales/en.js";

// Procédure de test : n instructions dans un seul rôle, toutes complètes.
function procedureTest(n) {
  const p = nouvelleProcedure();
  p.roles = [{ id: "r1", nom: "Pilote", type: "individuel", service: "", responsabilite: "" }];
  p.meta.declencheur = "Besoin exprimé";
  p.meta.fin = "Dossier clos";
  p.etapes = Array.from({ length: n }, (_, k) => nouvelleEtape({
    roleId: "r1", libelle: `Traiter le point ${k + 1}`, entree: `Entrée ${k + 1}`, sortie: `Sortie ${k + 1}`,
  }));
  return p;
}
const relie = (p, de, vers, condition = "Non") => {
  p.etapes[de].condition = p.etapes[de].condition || "Oui";
  p.etapes[de].alternatives.push(nouvelleAlternative({ condition, vers: vers === "fin" ? "fin" : p.etapes[vers].id }));
};
const cles = (constats) => constats.map((c) => c.cle);

// ---------- store ----------
test("contrôle : la coche crée une suite à remplir, la nature est limitée à Q/H/S/R/E, annuler rend tout", () => {
  store.nouvelle();
  store.ajouterRole();
  store.ajouterEtape();
  const id = store.lire().etapes[0].id;
  store.modifierControle(id, "actif", true);
  assert.equal(store.lire().etapes[0].controle.actif, true);
  assert.equal(store.lire().etapes[0].alternatives.length, 1);
  store.modifierControle(id, "nature", "Z");
  assert.equal(store.lire().etapes[0].controle.nature, "");
  store.modifierControle(id, "nature", "S");
  assert.equal(store.lire().etapes[0].controle.nature, "S");
  store.modifierControle(id, "critere", "Casque porté");
  assert.equal(store.lire().etapes[0].controle.critere, "Casque porté");
  store.annuler(); store.annuler(); store.annuler(); // critère, nature, coche
  assert.equal(store.lire().etapes[0].controle.actif, false);
  assert.equal(store.lire().etapes[0].alternatives.length, 0);
});

test("décision : 3 alternatives au plus ; destination = fin ou une AUTRE instruction existante", () => {
  store.nouvelle();
  store.ajouterRole();
  for (let k = 0; k < 3; k += 1) store.ajouterEtape();
  const [a, b, c] = store.lire().etapes;
  store.basculerDecision(a.id, true);
  for (let k = 0; k < 6; k += 1) store.ajouterAlternative(a.id);
  assert.equal(store.lire().etapes[0].alternatives.length, MAX_ALTERNATIVES);
  const alt = store.lire().etapes[0].alternatives[0];
  store.modifierAlternative(a.id, alt.id, "vers", a.id); // elle-même : refusé
  assert.equal(store.lire().etapes[0].alternatives[0].vers, "");
  store.modifierAlternative(a.id, alt.id, "vers", "inconnue");
  assert.equal(store.lire().etapes[0].alternatives[0].vers, "");
  store.modifierAlternative(a.id, alt.id, "vers", c.id);
  assert.equal(store.lire().etapes[0].alternatives[0].vers, c.id);
  store.modifierAlternative(a.id, alt.id, "vers", "fin");
  assert.equal(store.lire().etapes[0].alternatives[0].vers, "fin");
});

test("supprimer une instruction remet à « choisir » les alternatives qui y menaient ; dupliquer donne de nouveaux identifiants", () => {
  store.nouvelle();
  store.ajouterRole();
  for (let k = 0; k < 3; k += 1) store.ajouterEtape();
  const [a, b] = store.lire().etapes;
  store.basculerDecision(a.id, true);
  store.modifierAlternative(a.id, store.lire().etapes[0].alternatives[0].id, "vers", b.id);
  store.dupliquerEtape(a.id);
  const [orig, copie] = store.lire().etapes;
  assert.notEqual(orig.alternatives[0].id, copie.alternatives[0].id);
  store.supprimerEtape(b.id);
  assert.equal(store.lire().etapes[0].alternatives[0].vers, "");
});

test("décocher la décision efface les suites et le nom de la suite normale", () => {
  store.nouvelle();
  store.ajouterRole();
  store.ajouterEtape();
  const id = store.lire().etapes[0].id;
  store.basculerDecision(id, true);
  store.modifierEtape(id, "condition", "Oui");
  store.basculerDecision(id, false);
  assert.deepEqual(store.lire().etapes[0].alternatives, []);
  assert.equal(store.lire().etapes[0].condition, "");
});

test("un fichier hostile est nettoyé : nature, destination, nombre et longueur des alternatives", () => {
  const p = exempleProcedure();
  const json = JSON.parse(JSON.stringify({ format: "qualigramme-procedure", version: 1, procedure: p }));
  const e = json.procedure.etapes[2];
  e.controle.nature = "Z";
  e.controle.critere = "x".repeat(5000);
  e.condition = "y".repeat(5000);
  e.alternatives = Array.from({ length: 9 }, () => ({ id: "a", condition: "c", info: "i", versQui: "q", vers: "inexistante" }));
  e.alternatives[0].vers = e.id; // elle-même
  store.nouvelle();
  store.importerJSON(JSON.stringify(json));
  const propre = store.lire().etapes[2];
  assert.equal(propre.controle.nature, "");
  assert.ok(propre.controle.critere.length <= 1000);
  assert.ok(propre.condition.length <= 200);
  assert.equal(propre.alternatives.length, MAX_ALTERNATIVES);
  assert.ok(propre.alternatives.every((a) => a.vers === ""));
  assert.equal(new Set(propre.alternatives.map((a) => a.id)).size, propre.alternatives.length, "identifiants uniques");
});

test("un ancien fichier (avant v0.9, sans contrôle ni alternative) s'ouvre sans erreur", () => {
  store.chargerExemple();
  const brut = JSON.parse(store.exporterJSON());
  brut.procedure.etapes.forEach((e) => { delete e.controle; delete e.condition; delete e.alternatives; });
  store.nouvelle();
  store.importerJSON(JSON.stringify(brut));
  const e = store.lire().etapes[0];
  assert.equal(e.controle.actif, false);
  assert.deepEqual(e.alternatives, []);
  assert.equal(e.condition, "");
});

test("la signature de contenu change quand on modifie un contrôle ou une alternative (la validation devient caduque)", () => {
  const p = exempleProcedure();
  const avant = signatureContenu(p);
  p.etapes[4].controle.critere += " !";
  assert.notEqual(signatureContenu(p), avant);
  const apres = signatureContenu(p);
  p.etapes[4].alternatives[0].vers = "fin";
  assert.notEqual(signatureContenu(p), apres);
});

// ---------- règles ----------
test("règles : un contrôle a une nature, un critère et une suite si non conforme", () => {
  const p = procedureTest(6);
  p.etapes[1].controle = { actif: true, nature: "", critere: "", enregistrement: "" };
  const c = cles(verifier(p));
  assert.ok(c.includes("regle.controle.sans_nature"));
  assert.ok(c.includes("regle.controle.sans_critere"));
  assert.ok(c.includes("regle.controle.sans_suite"));
  p.etapes[1].controle = { actif: true, nature: "Q", critere: "Complet", enregistrement: "" };
  relie(p, 1, 0, "Non conforme");
  const apres = cles(verifier(p));
  assert.ok(!apres.some((k) => k.startsWith("regle.controle.")));
});

test("règles : décision sans nom de cas, sans destination, vers l'instruction suivante", () => {
  const p = procedureTest(6);
  p.etapes[1].alternatives.push(nouvelleAlternative({ condition: "", vers: "" }));
  let c = cles(verifier(p));
  assert.ok(c.includes("regle.decision.cas_sans_nom"));
  assert.ok(c.includes("regle.decision.destination_absente"));
  p.etapes[1].condition = "Oui";
  p.etapes[1].alternatives[0] = nouvelleAlternative({ condition: "Non", vers: p.etapes[2].id });
  c = cles(verifier(p));
  assert.ok(c.includes("regle.decision.meme_suite"));
  p.etapes[1].alternatives[0].vers = p.etapes[0].id;
  c = cles(verifier(p));
  assert.ok(!c.some((k) => k.startsWith("regle.decision.")));
});

test("règles : les instructions de contrôle ne comptent pas dans l'effectif de 5 à 10", () => {
  const p = procedureTest(7);
  assert.ok(!cles(verifier(p)).includes("regle.instructions.effectif"));
  [0, 1, 2].forEach((k) => { p.etapes[k].controle = { actif: true, nature: "Q", critere: "c", enregistrement: "" }; relie(p, k, "fin"); });
  const alerte = verifier(p).find((c) => c.cle === "regle.instructions.effectif");
  assert.ok(alerte, "7 - 3 contrôles = 4 instructions");
  assert.equal(alerte.params.n, 4);
});

test("parcours : contrôle ou décision incomplets bloquent l'étape 2", () => {
  const p = procedureTest(6);
  assert.ok(!cles(manquantsDeroule(p)).some((k) => /controle|decision/.test(k)));
  p.etapes[1].controle = { actif: true, nature: "", critere: "", enregistrement: "" };
  assert.ok(cles(manquantsDeroule(p)).includes("manque.etape.controle"));
  p.etapes[1].controle = { actif: true, nature: "H", critere: "Propre", enregistrement: "" };
  p.etapes[3].alternatives.push(nouvelleAlternative({ condition: "Non", vers: "" }));
  p.etapes[3].condition = "Oui";
  assert.ok(cles(manquantsDeroule(p)).includes("manque.etape.decision"));
  p.etapes[3].alternatives[0].vers = "fin";
  assert.ok(!cles(manquantsDeroule(p)).some((k) => /controle|decision/.test(k)));
});

// ---------- document ----------
test("section 6 : plus de tableau d'activités ni de section « Points de contrôle » ; le contrôle reste sur le logigramme", () => {
  const p = exempleProcedure();
  const liste = listeControles(p);
  assert.deepEqual(liste.map((c) => c.n), [5]);
  const doc = construireDocument(p);
  assert.equal(doc.sections.find((s) => s.cle === "controles"), undefined);
  const descr = doc.sections.find((s) => s.cle === "description").blocs;
  assert.equal(descr.find((b) => b.type === "tableau"), undefined, "le tableau des activités est retiré (doublon avec le logigramme)");
  assert.ok(descr.some((b) => b.type === "paragraphe" && /^Fait déclencheur : /.test(b.texte)));
  assert.ok(descr.some((b) => b.type === "paragraphe" && /^Fin : /.test(b.texte)));
  // le contrôle (triangle Q) reste visible sur le logigramme
  assert.ok(dessinerNiveau2(p).includes(">Q</text>"));
});

test("section 6 : la décision n'est plus dans un tableau ; ses cas restent sur le logigramme", () => {
  const p = exempleProcedure();
  const doc = construireDocument(p);
  assert.equal(doc.sections.find((s) => s.cle === "description").blocs.find((b) => b.type === "tableau"), undefined);
  assert.deepEqual([...new Set(listeDecisions(p).map((d) => d.n))], [5], "une seule instruction décide : l'instruction 5");
  assert.equal(listeDecisions(p).filter((d) => d.n === 5).length, 2, "suite normale + 1 alternative");
  const svg = dessinerNiveau2(p);
  assert.ok(svg.includes(">Conforme</text>") && svg.includes(">Non conforme</text>"), "les cas de la décision sont sur le logigramme");
});

test("le document de l'exemple reste dans la limite de 5 pages avec les contrôles remplis", () => {
  const n = estimerPages(construireDocument(exempleProcedure()));
  assert.ok(n >= 4 && n <= 5, "pages estimées : " + n);
});

// ---------- dessin ----------
test("dessin : l'exemple a des triangles Q, les noms de cas et aucun croisement", () => {
  const p = exempleProcedure();
  const svg = dessinerNiveau2(p);
  assert.equal((svg.match(/<polygon[^>]*fill="#fff"/g) || []).length, 1, "un triangle de contrôle (blanc, bord bleu)");
  assert.ok(svg.includes(">Q</text>"));
  assert.ok(svg.includes(">Non conforme</text>"));
  assert.ok(svg.includes(">Conforme</text>"));
  assert.equal(croisementsNiveau2(p), 0);
});

test("dessin : le SVG produit est du XML bien formé", () => {
  const p = exempleProcedure();
  p.etapes[4].alternatives[0].condition = '</text><script>alert("x")</script> & <b>';
  const svg = dessinerNiveau2(p);
  assert.ok(!svg.includes("<script>"));
  const fichier = path.join(os.tmpdir(), `qualigramme-${process.pid}.svg`);
  fs.writeFileSync(fichier, svg);
  try {
    execFileSync("xmllint", ["--noout", fichier]);
  } catch (e) {
    if (e.code === "ENOENT") return; // xmllint absent : test sauté
    throw e;
  } finally {
    fs.rmSync(fichier, { force: true });
  }
});

test("dessin : sans alternative, ni gouttière ni couloir (même largeur qu'avant)", () => {
  const p = exempleProcedure();
  p.etapes.forEach((e) => { e.alternatives = []; e.condition = ""; e.controle.actif = false; });
  const sans = mesurerNiveau2(p).largeur;
  const avec = mesurerNiveau2(exempleProcedure()).largeur;
  assert.ok(avec > sans + 20, `${avec} > ${sans}`);
  assert.equal(croisementsNiveau2(p), 0);
});

test("croisements : boucles emboîtées = 0, boucles entrelacées = 1, même destination = 0", () => {
  const emboitees = procedureTest(6);
  relie(emboitees, 3, 1); // 4 -> 2
  relie(emboitees, 4, 0); // 5 -> 1
  assert.equal(croisementsNiveau2(emboitees), 0);

  const entrelacees = procedureTest(6);
  relie(entrelacees, 2, 0); // 3 -> 1
  relie(entrelacees, 3, 1); // 4 -> 2
  assert.equal(croisementsNiveau2(entrelacees), 1);

  const memeDestination = procedureTest(6);
  relie(memeDestination, 2, 0);
  relie(memeDestination, 3, 0);
  relie(memeDestination, 4, 0);
  assert.equal(croisementsNiveau2(memeDestination), 0);
});

test("dessin : saut en avant, renvoi vers la fin et destination manquante (« ? ») se dessinent", () => {
  const p = procedureTest(6);
  relie(p, 1, 4, "Cas simple"); // saut 2 -> 5
  relie(p, 3, "fin", "Abandon");
  p.etapes[5].condition = "Oui";
  p.etapes[5].alternatives.push(nouvelleAlternative({ condition: "Non", vers: "" }));
  const svg = dessinerNiveau2(p);
  assert.ok(svg.includes(">Cas simple</text>"));
  assert.ok(svg.includes(">Abandon</text>"));
  assert.ok(svg.includes(">?</text>"));
  assert.ok((svg.match(/marker-end/g) || []).length >= 1);
});

test("dessin : aucun texte n'est coupé, même un nom de cas très long", () => {
  const p = procedureTest(6);
  const long = "Non conforme après la seconde vérification du responsable";
  relie(p, 2, 0, long);
  p.etapes[2].alternatives[0].info = "Avis motivé détaillé transmis au pilote pour reprise";
  const svg = dessinerNiveau2(p);
  const texte = [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]).join(" ").replace(/-\s/g, "");
  long.split(" ").forEach((mot) => assert.ok(texte.includes(mot), mot));
});

// ---------- Word : aller-retour ----------
test("aller-retour : avec la partie embarquée, contrôles et suites reviennent sans perte", async () => {
  const origine = exempleProcedure();
  const { procedure: p, rapport } = await importerWord(construireDocx(origine)); // embarquer par défaut (cas normal de l'app)
  assert.deepEqual(rapport.map((c) => c.cle), ["import.embarque"]);
  assert.equal(p.etapes.length, origine.etapes.length);
  [4].forEach((k) => {
    assert.equal(p.etapes[k].controle.actif, true, `contrôle ${k + 1}`);
    assert.equal(p.etapes[k].controle.nature, "Q");
    assert.equal(p.etapes[k].controle.critere, origine.etapes[k].controle.critere);
    assert.equal(p.etapes[k].condition, origine.etapes[k].condition);
  });
  const alt5 = p.etapes[4].alternatives;
  assert.equal(alt5.length, 1);
  assert.equal(alt5[0].condition, "Non conforme");
  assert.equal(alt5[0].vers, p.etapes[3].id);
  assert.equal(p.etapes[4].condition, "Conforme");
  assert.deepEqual(listeControles(p).map((c) => c.n), [5]);
});

test("sans la partie embarquée (Word retravaillé à la main), les instructions ne sont plus reconstituées (tableau d'activités retiré)", async () => {
  const origine = exempleProcedure();
  const { procedure: p, rapport } = await importerWord(construireDocx(origine, { embarquer: false }));
  assert.equal(p.etapes.length, 0, "sans tableau d'activités ni partie embarquée, aucune instruction n'est relue");
  assert.ok(rapport.some((c) => c.cle === "import.instructions_absentes"));
  assert.equal(p.roles.length, origine.roles.length, "les rôles restent relus depuis le tableau des responsabilités");
});

// ---------- textes ----------
test("chaque clé française a son équivalent anglais (et inversement)", () => {
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  ["Q", "H", "S", "R", "E"].forEach((k) => assert.ok(fr["controle.nature." + k] && en["controle.nature." + k]));
});
