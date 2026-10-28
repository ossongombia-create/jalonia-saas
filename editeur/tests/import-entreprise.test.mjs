// Import souple de procédures Word « d'entreprise » (hors modèle Jalonia) : cartouche sur une ligne, sections
// « Déroulement », tableaux N° / Activité / Responsable / Document (un par sous-section), acteurs en sigles
// ou combinés (« RRH + Manager », « DAF / DG »), tableau d'approbation « Fonction — Nom ».
// Les trois fichiers sont des procédures réelles anonymisées (entreprises, personnes et lieux remplacés).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { importerWord } from "../js/importWord.js";
import { nettoyer } from "../js/store.js";
import { colonnes, verifier } from "../js/rules.js";
import fr from "../js/locales/fr.js";
import en from "../js/locales/en.js";

const importer = async (nom) => {
  const r = await importerWord(fs.readFileSync(new URL(`./fixtures/procedure-entreprise-${nom}.docx`, import.meta.url)));
  return { p: nettoyer(r.procedure), rapport: r.rapport };
};
const nomDe = (p, id) => p.roles.find((r) => r.id === id)?.nom;
const cles = (rapport) => rapport.map((x) => x.cle);

test("cartouche sur une ligne et tableau d'approbation « Fonction — Nom » : identification et signataires repris", async () => {
  const { p } = await importer("urgences");
  assert.equal(p.meta.reference, "PR-HSE-004");
  assert.equal(p.meta.version, "03");
  assert.equal(p.meta.dateApplication, "2026-10-01");
  assert.equal(p.meta.titre, "Préparation et réponse aux situations d'urgence");
  assert.equal(p.meta.organisation, "ALPHA OFFSHORE SERVICES");
  assert.deepEqual(p.meta.signataires.redige, { nom: "A. DUPONT", fonction: "Coordinateur HSE", date: "2026-10-01" });
  assert.deepEqual(p.meta.signataires.approuve, { nom: "R. BERNARD", fonction: "Directeur de Base", date: "2026-10-01" });
  assert.equal(p.meta.revisions.length, 3);
});

test("acteurs en sigles : rapprochés des rôles de la section 5, l'acteur inconnu devient un rôle", async () => {
  const { p, rapport } = await importer("urgences");
  assert.equal(p.etapes.length, 10);
  assert.equal(nomDe(p, p.etapes[2].roleId), "Coordinateur d'Urgence (Chef de quart HSE)"); // « CU »
  assert.equal(nomDe(p, p.etapes[4].roleId), "Tout le personnel"); // « Personnel + Serre-files »
  assert.deepEqual(p.etapes[4].participants.map((id) => nomDe(p, id)), ["Serre-files"]);
  assert.ok(p.roles.some((r) => r.nom === "Témoin"));
  assert.ok(cles(rapport).includes("import.role_ajoute"));
  assert.ok(cles(rapport).includes("import.roles_rapproches"));
  assert.ok(cles(rapport).includes("import.acteurs_multiples"));
  assert.deepEqual(p.etapes[9].outils.map((o) => o.nom), ["Rapport d'incident", "REX"]);
});

test("plusieurs tableaux d'instructions (un par sous-section) : repris à la suite, dans l'ordre", async () => {
  const { p, rapport } = await importer("recrutement");
  assert.equal(p.etapes.length, 17);
  assert.ok(p.etapes[0].libelle.startsWith("Exprimer le besoin"));
  assert.ok(p.etapes[16].libelle.startsWith("Confirmer l'embauche"));
  assert.deepEqual(rapport.find((x) => x.cle === "import.plusieurs_tableaux").params, { n: 3 });
  assert.equal(nomDe(p, p.etapes[1].roleId), "Directeur Général"); // « DG »
  assert.equal(nomDe(p, p.etapes[2].roleId), "Responsable Ressources Humaines (RRH)"); // « RRH + Manager »
  // 17 instructions : Jalonia importe tout, mais la procédure ne pourra être validée qu'une fois scindée (10 au maximum).
  const c = verifier(p).find((x) => x.cle === "regle.instructions.trop");
  assert.equal(c.gravite, "erreur");
});

test("« DAF / DG » : le premier réalise ; « Comptabilité », absent de la section 5, devient un rôle", async () => {
  const { p } = await importer("achats");
  assert.equal(p.meta.reference, "PR-ACH-001");
  assert.equal(p.etapes.length, 11);
  assert.equal(nomDe(p, p.etapes[4].roleId), "Directeur Administratif et Financier (DAF)");
  assert.equal(nomDe(p, p.etapes[9].roleId), "Comptabilité");
  assert.deepEqual(p.etapes[7].participants.map((id) => nomDe(p, id)), ["Demandeur (chef de service)"]);
  assert.equal(p.roles.length, 8);
  assert.equal(colonnes(p).length, 6); // un rôle qui ne réalise aucune instruction n'a pas de colonne
});

test("sections de l'entreprise : le déroulement va dans la description, l'approbation n'est recopiée nulle part", async () => {
  for (const nom of ["urgences", "recrutement", "achats"]) {
    const { p } = await importer(nom);
    const corps = JSON.stringify(p.corps);
    assert.ok(!/Rédigé par|Visa :|"Approbation"/.test(corps), `${nom} : tableau d'approbation recopié`);
    assert.equal(p.corps.responsabilites.length, 1, `${nom} : seul le tableau des responsabilités`);
    assert.ok(p.corps.description.some((b) => b.type === "genere"), `${nom} : tableau des instructions reconstruit`);
  }
  const { p } = await importer("urgences");
  assert.ok(p.corps.description.some((b) => b.type === "tableau" && b.colonnes.join() === "Contact,Numéro")); // autres tableaux gardés
});

test("textes du rapport : présents en français et en anglais", () => {
  for (const cle of ["import.plusieurs_tableaux", "import.roles_rapproches", "import.acteurs_multiples"]) {
    assert.ok(fr[cle] && en[cle], cle);
  }
});
