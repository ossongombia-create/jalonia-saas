// Tests du corps du document (11 sections du modèle) : saisie, nettoyage, génération, import.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as store from "../js/store.js";
import { construireDocument, estimerPages } from "../js/document.js";
import { nouvelleProcedure, MODELES_TABLEAU, SECTIONS } from "../js/model.js";
import { exempleProcedure } from "../js/exemple-procedure.js";
import { importerWord } from "../js/importWord.js";

test("une procédure neuve : sections 5, 6 et 9 avec leur tableau généré, les autres vides", () => {
  const p = nouvelleProcedure();
  assert.deepEqual(Object.keys(p.corps), SECTIONS);
  assert.equal(p.corps.responsabilites[0].type, "genere");
  assert.equal(p.corps.description[0].type, "genere");
  assert.equal(p.corps.risques[0].type, "genere");
  assert.equal(p.corps.objet.length, 0);
});

test("paragraphes : ajouter, écrire, déplacer, supprimer, annuler", () => {
  store.nouvelle();
  store.ajouterBloc("objet", "p");
  store.ajouterBloc("objet", "p");
  const [a, b] = store.lire().corps.objet;
  store.modifierTexteBloc("objet", a.id, "Premier");
  store.modifierTexteBloc("objet", b.id, "Second");
  store.deplacerBloc("objet", b.id, -1);
  assert.deepEqual(store.lire().corps.objet.map((x) => x.texte), ["Second", "Premier"]);
  store.supprimerBloc("objet", a.id);
  assert.equal(store.lire().corps.objet.length, 1);
  store.annuler();
  assert.equal(store.lire().corps.objet.length, 2);
});

test("tableaux : lignes et colonnes restent rectangulaires", () => {
  store.nouvelle();
  store.ajouterBloc("indicateurs", "tableau", ["A", "B"]);
  const premierTableau = () => store.lire().corps.indicateurs.find((b) => b.type === "tableau"); // (la section 8 commence par son tableau généré depuis la v0.19)
  const id = premierTableau().id;
  store.ajouterLigne("indicateurs", id);
  store.ajouterColonne("indicateurs", id);
  store.modifierCellule("indicateurs", id, 1, 2, "x");
  let tab = premierTableau();
  assert.equal(tab.colonnes.length, 3);
  assert.ok(tab.lignes.every((l) => l.length === 3));
  assert.equal(tab.lignes[1][2], "x");
  store.supprimerColonne("indicateurs", id, 0);
  store.supprimerLigne("indicateurs", id, 0);
  tab = premierTableau();
  assert.equal(tab.colonnes.length, 2);
  assert.equal(tab.lignes.length, 1);
  store.modifierCellule("indicateurs", id, 9, 9, "hors limite"); // ignoré, sans erreur
  assert.equal(premierTableau().lignes.length, 1);
});

test("le bloc généré ne peut pas être supprimé ; une section inconnue est refusée", () => {
  store.nouvelle();
  const g = store.lire().corps.description[0];
  store.supprimerBloc("description", g.id);
  assert.equal(store.lire().corps.description.length, 1);
  store.ajouterBloc("pirate", "p");
  assert.equal(store.lire().corps.pirate, undefined);
});

test("import .json hostile : le corps est nettoyé et limité", () => {
  store.nouvelle();
  const brut = { roles: [], etapes: [], corps: {
    objet: [{ id: "<x>", type: "p", texte: "y".repeat(9000) }, { type: "script", texte: "<script>" }, null, "texte"],
    references: [{ id: "b1", type: "tableau", colonnes: ["a", "b"], lignes: [["1"], [1, 2, 3], "pas une ligne"] }, { id: "b2", type: "tableau", colonnes: [] }],
    objetInconnu: [{ type: "p", texte: "x" }],
    logigramme: Array.from({ length: 80 }, () => ({ type: "p", texte: "x" })),
  } };
  store.importerJSON(JSON.stringify(brut));
  const c = store.lire().corps;
  assert.equal(c.objet.length, 1);
  assert.equal(c.objet[0].texte.length, 5000);
  assert.ok(/^[\w-]+$/.test(c.objet[0].id));
  assert.equal(c.references.length, 1);
  assert.deepEqual(c.references[0].lignes, [["1", ""], ["", ""]]);
  assert.equal(c.objetInconnu, undefined);
  assert.equal(c.logigramme.length, 30);
  assert.equal(c.responsabilites[0].type, "genere"); // toujours présent
});

test("un ancien fichier sans corps reste lisible", () => {
  store.nouvelle();
  store.importerJSON(JSON.stringify({ roles: [], etapes: [] }));
  assert.equal(store.lire().corps.description[0].type, "genere");
});

test("document : tableaux 5 et 9 générés (rôles, risques) ; section 6 sans tableau d'activités (détail porté par le logigramme)", () => {
  const doc = construireDocument(exempleProcedure());
  const resp = doc.sections[4].blocs.find((b) => b.type === "tableau");
  assert.equal(resp.colonnes.length, 2);
  assert.equal(resp.lignes.length, 4);
  assert.equal(resp.lignes[0][0], "Accueil\nSalle");
  const descr = doc.sections[5].blocs;
  assert.ok(descr.some((b) => b.type === "paragraphe" && b.texte.startsWith("Fait déclencheur : ")));
  assert.ok(descr.some((b) => b.type === "paragraphe" && b.texte.startsWith("Fin : ")));
  assert.equal(descr.find((b) => b.type === "tableau"), undefined, "le tableau des activités est retiré (doublon avec le logigramme)");
  assert.ok(descr.some((b) => b.type === "sous-titre" && b.texte === "6.1 Sécurité sanitaire et allergènes"), "« 6.1 … » reste un sous-titre");
  assert.ok(doc.sections[6].blocs.some((b) => b.type === "logigramme"));
});

test("document : en-tête, validation et historique du modèle", () => {
  const doc = construireDocument(exempleProcedure());
  assert.equal(doc.cartouche.typeTitre, "PROCÉDURE");
  assert.equal(doc.cartouche.reference, "PR-REA-01");
  assert.equal(doc.cartouche.domaine, "Réalisation");
  assert.equal(doc.cartouche.dateApplication, "01/10/2026");
  assert.deepEqual(doc.validation.colonnes, ["", "Rédigé par", "Vérifié par", "Approuvé par"]);
  assert.deepEqual(doc.validation.lignes.map((l) => l[0]), ["Nom", "Fonction", "Date", "Visa"]);
  assert.deepEqual(doc.validation.lignes[1].slice(1), ["Maître d'hôtel", "Chef de cuisine", "Directeur du restaurant"]);
  assert.equal(doc.validation.lignes[2][1], "01/10/2026");
  assert.deepEqual(doc.historique.lignes[0], ["V0", "01/10/2026", "Création initiale du document", "Directeur du restaurant"]);
});

test("document : sans révision saisie, l'historique montre la création initiale avec la version et la date d'application", () => {
  const p = exempleProcedure();
  p.meta.revisions = [];
  const doc = construireDocument(p);
  assert.deepEqual(doc.historique.lignes, [["V0", "01/10/2026", "Création initiale du document", ""]]);
});

test("longueur : l'exemple est estimé comme son Word généré (5 pages mesurées avec LibreOffice), une section très remplie dépasse 5", () => {
  const p = exempleProcedure();
  const n = estimerPages(construireDocument(p));
  assert.ok(n >= 5 && n <= 5, `estimé : ${n}`); // réel : 5 ; on accepte de surestimer, pas de sous-estimer
  p.corps.diffusion.push({ id: "bx", type: "p", texte: "Texte de diffusion. ".repeat(3000) });
  assert.ok(estimerPages(construireDocument(p)) > 5);
});

test("import Word : le corps est repris, sections 5 et 6 recalculées", async () => {
  const { procedure: p } = await importerWord(fs.readFileSync(new URL("./fixtures/mini.docx", import.meta.url)));
  assert.equal(p.corps.objet[0].texte, "Décrire la validation.");
  assert.equal(p.corps.domaine[0].texte, "Toutes les commandes.");
  assert.equal(p.corps.responsabilites.filter((b) => b.type === "genere").length, 1);
  assert.equal(p.corps.description.filter((b) => b.type === "genere").length, 1);
  assert.ok(!p.corps.description.some((b) => b.type === "p" && /^fait/i.test(b.texte))); // repris dans le cadrage
  assert.equal(p.corps.controles[0].type, "genere"); // ancien Word : le tableau des contrôles (N°, Contrôle) est reconstruit à partir des instructions
  assert.equal(p.etapes[1].controle.actif, true); // ligne « 2 » de la section 8 : l'instruction 2 devient un contrôle
  assert.equal(p.roles[0].service, "Administration");
  assert.equal(p.roles[0].responsabilite, "Reçoit");
});

test("modèles de tableaux standard : chaque colonne a un titre en français et en anglais", async () => {
  const fr = (await import("../js/locales/fr.js")).default;
  const en = (await import("../js/locales/en.js")).default;
  Object.entries(MODELES_TABLEAU).forEach(([cle, cols]) => cols.forEach((k) => {
    assert.ok(fr[`col.${cle}.${k}`], `fr ${cle}.${k}`);
    assert.ok(en[`col.${cle}.${k}`], `en ${cle}.${k}`);
  }));
});
