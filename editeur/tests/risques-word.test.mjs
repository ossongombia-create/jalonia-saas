// Tests v0.8 : risques maîtrisés (section 9), niveau 3, nettoyage des fichiers importés, fabrication du Word.
import test from "node:test";
import assert from "node:assert/strict";
import * as store from "../js/store.js";
import { criticite, MAX_RISQUES, signatureContenu } from "../js/model.js";
import { construireDocument, listeRisques, listeNiveau3, estimerPages } from "../js/document.js";
import { dessinerNiveau2 } from "../js/render.js";
import { verifier } from "../js/rules.js";
import { crc32, creerZip } from "../js/zip.js";
import { construireDocx, echapperXml } from "../js/exportDocx.js";
import { lireZip, extraireBlocs, importerWord } from "../js/importWord.js";

const section = (doc, cle) => doc.sections.find((s) => s.cle === cle);

// ---------- Risques ----------
test("criticité = gravité × probabilité, avec les seuils de la fiche de collecte", () => {
  assert.deepEqual(criticite({ gravite: "1", probabilite: "3" }), { valeur: 3, g: 1, p: 3, niveau: "acceptable" });
  assert.equal(criticite({ gravite: "2", probabilite: "4" }).niveau, "significatif"); // C = 8 → 5-8
  assert.equal(criticite({ gravite: "3", probabilite: "3" }).niveau, "critique"); // C = 9 → ≥ 9
  assert.equal(criticite({ gravite: "4", probabilite: "1" }).niveau, "critique"); // Impact = 4 → critique (v0.28)
  assert.equal(criticite({ gravite: "4", probabilite: "4" }).valeur, 16);
  assert.equal(criticite({ gravite: "", probabilite: "3" }), null);
  assert.equal(criticite({ gravite: "5", probabilite: "3" }), null);
});

test("cocher « maîtrise un risque » crée un risque à remplir ; décocher les retire ; annuler les rend", () => {
  store.nouvelle();
  store.ajouterEtape();
  const id = store.lire().etapes[0].id;
  store.basculerRisques(id, true);
  assert.equal(store.lire().etapes[0].risques.length, 1);
  store.basculerRisques(id, false);
  assert.equal(store.lire().etapes[0].risques.length, 0);
  store.annuler();
  assert.equal(store.lire().etapes[0].risques.length, 1);
});

test("au plus 5 risques par instruction ; gravité et probabilité limitées à 1-4", () => {
  store.nouvelle();
  store.ajouterEtape();
  const id = store.lire().etapes[0].id;
  store.basculerRisques(id, true);
  for (let k = 0; k < 10; k += 1) store.ajouterRisque(id);
  assert.equal(store.lire().etapes[0].risques.length, MAX_RISQUES);
  const r = store.lire().etapes[0].risques[0];
  store.modifierRisque(id, r.id, "gravite", "9");
  store.modifierRisque(id, r.id, "probabilite", "<script>");
  store.modifierRisque(id, r.id, "inconnu", "x");
  assert.equal(store.lire().etapes[0].risques[0].gravite, "");
  assert.equal(store.lire().etapes[0].risques[0].probabilite, "");
  store.modifierRisque(id, r.id, "gravite", "3");
  assert.equal(store.lire().etapes[0].risques[0].gravite, "3");
});

test("dupliquer une instruction donne de nouveaux identifiants de risque", () => {
  store.chargerExemple();
  const source = store.lire().etapes[1];
  store.dupliquerEtape(source.id);
  const p = store.lire();
  const ids = p.etapes.flatMap((e) => e.risques.map((r) => r.id));
  assert.equal(new Set(ids).size, ids.length);
});

test("la section 9 est générée à partir des risques saisis, dans l'ordre des instructions (colonnes du modèle)", () => {
  store.chargerExemple();
  const p = store.lire();
  const liste = listeRisques(p);
  assert.equal(liste.length, 7);
  assert.deepEqual(liste.map((x) => x.n), [1, 3, 3, 4, 4, 4, 6]);
  const tab = section(construireDocument(p), "risques").blocs.filter((b) => b.type === "tableau")[0];
  assert.equal(tab.lignes.length, 7);
  assert.equal(tab.lignes[0][0], "Attente sans prise en charge, surréservation ou réservation perdue\nInstruction 1 · criticité 3 × 3 = 9 (critique)");
  assert.equal(tab.lignes[0][1], "Outil de réservation unique ; prise en charge en moins de 2 minutes ; liste d'attente");
  assert.equal(tab.lignes[0][2], "Accueil");
  assert.equal(tab.colonnes.length, 3);
});

test("sans risque saisi, le tableau généré de la section 9 est vide (rien d'inventé)", () => {
  store.nouvelle();
  store.ajouterRole();
  store.ajouterEtape();
  const doc = construireDocument(store.lire());
  const tab = section(doc, "risques").blocs.find((b) => b.type === "tableau");
  assert.ok(!tab || tab.lignes.length === 0);
});

test("un risque à moitié rempli déclenche une alerte, un risque complet non", () => {
  store.chargerExemple();
  assert.ok(!verifier(store.lire()).some((c) => c.cle === "regle.risque.incomplet"));
  const e = store.lire().etapes[0]; // « Accueillir le client » porte un risque (k1)
  store.modifierRisque(e.id, e.risques[0].id, "mesure", "");
  assert.ok(verifier(store.lire()).some((c) => c.cle === "regle.risque.incomplet" && c.params.i === 1));
});

// ---------- Niveau 3 ----------
test("niveau 3 : coche, code, intitulé ; la liste reprend l'intitulé de l'instruction par défaut", () => {
  store.chargerExemple();
  const e = store.lire().etapes[2];
  store.modifierNiveau3(e.id, "actif", true);
  store.modifierNiveau3(e.id, "code", "IT-DOC-02");
  const n3 = listeNiveau3(store.lire());
  assert.equal(n3.length, 1);
  assert.equal(n3[0].n, 3);
  assert.equal(n3[0].code, "IT-DOC-02");
  assert.equal(n3[0].intitule, "Prendre la commande");
  store.modifierNiveau3(e.id, "intitule", "Vérifier la conformité");
  assert.equal(listeNiveau3(store.lire())[0].intitule, "Vérifier la conformité");
  store.modifierNiveau3(e.id, "inconnu", "x");
  assert.ok(!("inconnu" in store.lire().etapes[2].niveau3));
});

test("niveau 3 : le code de l'instruction de travail apparaît sur le logigramme (plus de colonne Documents)", () => {
  store.chargerExemple();
  const e = store.lire().etapes[2];
  store.modifierNiveau3(e.id, "actif", true);
  store.modifierNiveau3(e.id, "code", "IT-DOC-02");
  const descr = section(construireDocument(store.lire()), "description").blocs;
  assert.equal(descr.find((b) => b.type === "tableau"), undefined, "le tableau des activités est retiré");
  assert.ok(dessinerNiveau2(store.lire()).includes("IT-DOC-02"), "le code N3 est porté par le logigramme");
});

test("niveau 3 : une procédure peut porter des instructions de niveau 3 sans alerte sur le type ; le code manquant est signalé", () => {
  store.chargerExemple();
  const e = store.lire().etapes[2];
  store.modifierNiveau3(e.id, "actif", true);
  const cles = verifier(store.lire()).map((c) => c.cle);
  assert.ok(cles.includes("regle.n3.sans_code"));
  assert.ok(!cles.includes("regle.n3.type_procedure") && !cles.includes("regle.n3.non_genere") && !cles.includes("regle.n3.aucune"));
});

// ---------- Fichier importé hostile ----------
test("un fichier .json hostile est nettoyé : types, longueurs, valeurs hors liste", () => {
  store.nouvelle();
  const p = JSON.parse(store.exporterJSON()).procedure;
  p.meta.typeDocument = "<img src=x onerror=alert(1)>";
  p.meta.organisation = "A".repeat(100000);
  p.validation = { a: 1 };
  p.etapes = [{
    id: "e1", roleId: "", libelle: "x", risques: [
      { id: "k1", risque: "R", causes: 12, gravite: "99", probabilite: "abc", mesure: { x: 1 }, extra: "<b>" },
      ...Array.from({ length: 50 }, (_, i) => ({ id: "kk" + i, risque: "R" + i })),
    ],
    niveau3: { actif: "oui", code: "C".repeat(5000), intitule: 3, extra: 1 },
  }];
  store.importerJSON(JSON.stringify({ procedure: p }));
  const q = store.lire();
  assert.equal(q.meta.typeDocument, "");
  assert.ok(q.meta.organisation.length <= 2000);
  assert.equal(typeof q.validation, "string");
  const e = q.etapes[0];
  assert.ok(e.risques.length <= MAX_RISQUES);
  assert.equal(e.risques[0].gravite, "");
  assert.equal(e.risques[0].probabilite, "");
  assert.equal(typeof e.risques[0].mesure, "string");
  assert.ok(!("extra" in e.risques[0]));
  assert.equal(e.niveau3.actif, false);
  assert.ok(e.niveau3.code.length <= 200);
  assert.ok(!("extra" in e.niveau3));
});

test("un ancien fichier (avant v0.8, sans risques ni niveau 3) s'ouvre sans erreur", () => {
  store.chargerExemple();
  const p = JSON.parse(store.exporterJSON()).procedure;
  delete p.validation;
  ["organisation", "direction", "processus", "pilote", "typeDocument"].forEach((c) => delete p.meta[c]);
  p.etapes.forEach((e) => { delete e.risques; delete e.niveau3; });
  store.importerJSON(JSON.stringify({ procedure: p }));
  assert.equal(store.lire().meta.organisation, "");
  assert.deepEqual(store.lire().etapes[0].risques, []);
  assert.equal(store.lire().etapes[0].niveau3.actif, false);
});

// ---------- ZIP et Word ----------
test("CRC-32 : valeur de référence", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
});

test("le ZIP fabriqué se relit fichier par fichier (accents compris)", async () => {
  const zip = creerZip([{ nom: "a.txt", donnees: "Bonjour é" }, { nom: "dossier/b.bin", donnees: new Uint8Array([1, 2, 3]) }]);
  assert.equal(await lireZip(zip, "a.txt"), "Bonjour é");
  await assert.rejects(() => lireZip(zip, "absent.txt"));
});

test("échappement XML : caractères spéciaux et caractères de contrôle interdits", () => {
  assert.equal(echapperXml('a & b < c > "d"'), "a &amp; b &lt; c &gt; &quot;d&quot;");
  assert.equal(echapperXml("x\u0000y\u0008z\u000bw"), "xyzw");
  assert.equal(echapperXml("tab\tok\nline"), "tab\tok\nline");
});

test("le .docx de l'exemple suit le modèle : en-tête, validation, historique, 11 sections, tableau des risques, pied de page", async () => {
  store.chargerExemple();
  const p = store.lire();
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
  const zip = construireDocx(p, { png, largeurPng: 800, hauteurPng: 1200 });
  const xml = await lireZip(zip);
  assert.match(xml, /^<\?xml/);
  for (let n = 1; n <= 11; n += 1) assert.ok(xml.includes(`>${n}. `), "section " + n);
  assert.ok(!xml.includes(">12. ") && !xml.includes(">13. "), "plus que 11 sections");
  ["PROCÉDURE Cuisiner et servir un repas", "Validation du document", "Historique des révisions", "Rédigé par", "Création initiale du document"]
    .forEach((texte) => assert.ok(xml.includes(texte), texte));
  assert.ok(xml.includes("Risques, opportunités et mesures de maîtrise"));
  assert.ok(xml.includes("Attente sans prise en charge, surréservation ou réservation perdue"));
  assert.ok(xml.includes("<w:drawing>"));
  assert.ok(xml.includes("01/10/2026"), "date d'application");
  const pied = await lireZip(zip, "word/footer1.xml");
  assert.ok(pied.includes("PR-REA-01"));
  assert.ok(pied.includes("NUMPAGES"));
  assert.ok((await lireZip(zip, "[Content_Types].xml")).includes("word/document.xml"));
});

test("le .docx sans image (dessin impossible) reste valide et signale l'emplacement", async () => {
  store.chargerExemple();
  const xml = await lireZip(construireDocx(store.lire(), {}));
  assert.ok(!xml.includes("<w:drawing>"));
  assert.ok(xml.includes("</w:document>"));
});

test("texte hostile dans la procédure : rien ne casse la structure XML du Word", async () => {
  store.chargerExemple();
  store.modifierMeta("titre", '</w:t></w:r><w:r><w:t>"><script>alert(1)</script>\u0000');
  const xml = await lireZip(construireDocx(store.lire(), {}));
  assert.ok(!xml.includes("<script>"));
  assert.ok(!xml.includes("\u0000"));
  assert.ok(xml.includes("&lt;script&gt;"));
});

test("aller-retour : un Word généré et non modifié rouvre la procédure complète, sans perte (partie embarquée)", async () => {
  store.chargerExemple();
  const origine = store.lire();
  const { procedure, rapport } = await importerWord(construireDocx(origine));
  assert.deepEqual(rapport.map((c) => c.cle), ["import.embarque"]);
  assert.deepEqual(procedure, JSON.parse(JSON.stringify(origine)));
});

test("un Word généré puis modifié dans Word : la partie embarquée est écartée, l'import relit les tableaux", async () => {
  store.chargerExemple();
  const origine = store.lire();
  const zip = construireDocx(origine);
  const noms = ["[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/styles.xml", "word/settings.xml", "word/footer1.xml",
    "word/_rels/document.xml.rels", "docProps/core.xml", "customXml/item1.xml", "customXml/_rels/item1.xml.rels", "customXml/itemProps1.xml"];
  const fichiers = [];
  for (const nom of noms) fichiers.push({ nom, donnees: await lireZip(zip, nom) });
  // On modifie un texte encore présent dans le document (le fait déclencheur) : les libellés d'instructions ne sont plus
  // dans le document (le tableau est retiré ; le logigramme est une image). L'édition invalide la signature de la partie embarquée.
  const doc = fichiers.find((f) => f.nom === "word/document.xml");
  assert.ok(doc.donnees.includes("Demande de repas"), "le fait déclencheur est bien dans le document");
  doc.donnees = doc.donnees.replace("Demande de repas", "Demande de repas (modifiée)");
  const { procedure, rapport } = await importerWord(creerZip(fichiers));
  assert.ok(rapport.some((c) => c.cle === "import.embarque_modifie"), "l'édition du document est détectée");
  assert.equal(procedure.etapes.length, 0, "faute de tableau d'activités, les instructions ne sont pas reconstituées");
});

test("sans partie embarquée, le Word généré est relu à partir des tableaux : en-tête, validation, historique, rôles (plus d'instructions : tableau d'activités retiré)", async () => {
  store.chargerExemple();
  const origine = store.lire();
  const { procedure, rapport } = await importerWord(construireDocx(origine, { embarquer: false }));
  assert.ok(!rapport.some((c) => c.cle === "import.pas_modele"));
  assert.equal(procedure.meta.reference, origine.meta.reference);
  assert.equal(procedure.meta.version, origine.meta.version);
  assert.equal(procedure.meta.titre, origine.meta.titre);
  assert.equal(procedure.meta.organisation, origine.meta.organisation);
  assert.equal(procedure.meta.processus, origine.meta.processus);
  assert.equal(procedure.meta.domaine, "realisation");
  assert.equal(procedure.meta.dateApplication, "2026-10-01");
  assert.deepEqual(procedure.meta.signataires.redige, origine.meta.signataires.redige);
  assert.deepEqual(procedure.meta.signataires.approuve, origine.meta.signataires.approuve);
  assert.deepEqual(procedure.meta.revisions.map(({ version, date, nature, auteur }) => ({ version, date, nature, auteur })),
    [{ version: "V0", date: "2026-10-01", nature: "Création initiale du document", auteur: "Directeur du restaurant" }]);
  assert.equal(procedure.meta.typeDocument, "procedure");
  // Les rôles restent relus depuis le tableau des responsabilités (section 5)…
  assert.equal(procedure.roles.length, origine.roles.length);
  assert.deepEqual(procedure.roles.map((r) => [r.nom, r.service]), origine.roles.map((r) => [r.nom, r.service]));
  // …mais les instructions ne le sont plus (le tableau des activités a été retiré de la section 6).
  assert.equal(procedure.etapes.length, 0);
  assert.ok(rapport.some((c) => c.cle === "import.instructions_absentes"));
  // Le modèle n'a ni direction ni pilote : le rapport invite à compléter l'étape 1.
  assert.ok(rapport.some((c) => c.cle === "import.identification"));
});

test("import d'un Word sans cartouche d'identification : message pour compléter l'étape 1", async () => {
  const { procedure, rapport } = await importerWord(await (async () => {
    const fs = await import("node:fs");
    return fs.readFileSync(new URL("./fixtures/mini.docx", import.meta.url));
  })());
  assert.equal(procedure.meta.organisation, "");
  assert.equal(procedure.meta.typeDocument, "procedure");
  assert.ok(rapport.some((c) => c.cle === "import.identification"));
});

test("l'estimation de pages de l'exemple reste dans la fourchette réelle mesurée (5 pages sous LibreOffice)", () => {
  store.chargerExemple();
  const n = estimerPages(construireDocument(store.lire()));
  assert.ok(n >= 4 && n <= 5, "pages estimées : " + n);
});

test("la signature de contenu ne dépend pas de l'ordre des clés", () => {
  store.chargerExemple();
  const p = store.lire();
  const copie = JSON.parse(JSON.stringify(p));
  copie.meta = Object.fromEntries(Object.entries(copie.meta).reverse());
  assert.equal(signatureContenu(copie), signatureContenu(p));
  copie.meta.titre += " ";
  assert.notEqual(signatureContenu(copie), signatureContenu(p));
});
