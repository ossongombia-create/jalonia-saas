// Tests de l'import Word (.docx). Le fichier tests/fixtures/mini.docx est fictif.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { lireZip, extraireBlocs, interpreter, importerWord } from "../js/importWord.js";
import { verifier } from "../js/rules.js";
import fr from "../js/locales/fr.js";
import en from "../js/locales/en.js";

const mini = () => fs.readFileSync(new URL("./fixtures/mini.docx", import.meta.url));

test("lecture de l'archive : on retrouve le XML du document", async () => {
  const xml = await lireZip(mini());
  assert.ok(xml.includes("<w:document"));
});

test("un fichier qui n'est pas un .docx est refusé proprement", async () => {
  await assert.rejects(() => importerWord(new TextEncoder().encode("ceci n'est pas un zip")), /pas_zip/);
  await assert.rejects(() => importerWord(new Uint8Array(0)), /pas_zip/);
});

test("extraction : paragraphes, styles, tableaux et entités XML", () => {
  const xml = '<w:body><w:p><w:pPr><w:pStyle w:val="Titre1"/></w:pPr><w:r><w:t>A &amp; B &lt;x&gt;</w:t></w:r></w:p>' +
    '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>c1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>c2</w:t></w:r></w:p><w:p><w:r><w:t>suite</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body>';
  const blocs = extraireBlocs(xml);
  assert.equal(blocs[0].texte, "A & B <x>");
  assert.equal(blocs[0].style, "Titre1");
  assert.deepEqual(blocs[1].lignes, [["c1", "c2\nsuite"]]); // les paragraphes d'une cellule sont séparés par un saut de ligne
});

test("import du modèle : titre, code, version, rôles, instructions, outils", async () => {
  const { procedure: p, rapport } = await importerWord(mini());
  assert.equal(p.meta.titre, "Valider la commande & le devis");
  assert.equal(p.meta.reference, "PR-22-01");
  assert.equal(p.meta.version, "V4");
  assert.equal(p.meta.declencheur, "Demande client reçue par mail");
  assert.equal(p.meta.fin, "Dossier classé");
  assert.deepEqual(p.roles.map((r) => [r.nom, r.type]), [["Assistante", "individuel"], ["Comptable", "individuel"], ["Client", "externe"], ["Archiviste", "individuel"]]);
  assert.equal(p.etapes.length, 3);
  const [e1, e2, e3] = p.etapes;
  assert.equal(e1.libelle, "Réceptionner la commande");
  assert.equal(e1.entree, "Demande client");
  assert.equal(e1.entreeDe, "Client");
  assert.deepEqual(e1.outils.map((o) => o.nom), ["FO-32-02", "Scanner"]);
  assert.equal(e2.sortie, "Devis");
  assert.equal(e2.versQui, "Client");
  assert.equal(e2.entree, "Commande reçue (étapes 1, 3)"); // renvoi à des étapes : pas une personne
  assert.equal(e2.outils.length, 0);
  assert.deepEqual(e3.outils.map((o) => o.nom), ["EN-22-03"]); // « section 11 » écarté
  const cles = rapport.map((c) => c.cle);
  assert.ok(cles.includes("import.role_ajoute")); // Archiviste absent de la section 5
  assert.ok(cles.includes("import.controles"));
  assert.ok(cles.includes("import.renvois_texte")); // « étapes 1, 3 » dans une cellule : reste du texte
});

test("un document hors modèle ne produit rien et le dit", () => {
  const { procedure, rapport } = interpreter([{ type: "p", style: "", texte: "Bonjour" }]);
  assert.equal(procedure.etapes.length, 0);
  assert.equal(rapport[0].cle, "import.pas_modele");
});

test("la procédure importée est utilisable par le moteur de règles", async () => {
  const { procedure } = await importerWord(mini());
  assert.ok(Array.isArray(verifier(procedure)));
});

test("les textes du rapport existent en français et en anglais", () => {
  for (const cle of Object.keys(fr).filter((k) => k.startsWith("import."))) assert.ok(cle in en, cle);
});
