// Partie 15 : import d'une FICHE DE COLLECTE Excel (modèle FC-QUA-01), dans « Atelier Démo », dans le navigateur.
//   - la rédactrice ouvre un nouveau document, importe la fiche (menu Fichier) : la procédure remplace le document et
//     s'enregistre sur le serveur ; l'instruction de travail IT-JUR-03 est créée à part, en brouillon ;
//   - le rapport d'import résume ce qui a été lu et signale les points à reprendre ;
//   - l'instruction s'ouvre avec son « Comment ? » (mode opératoire), imprimé sous le logigramme ;
//   - les deux documents entrent dans le circuit de validation comme les autres.
// Fichier : editeur/tests/fixtures/fiche-collecte-exemple.xlsx (fiche réelle anonymisée).
const path = require("node:path");
const { BASE, sql, lancer, connecter, api, editeurPret, attendreEtat, capture, etape, assert } = require("./outils.cjs");

(async () => {
  const b = await lancer();
  const rita = await connecter("redac@demo.test");
  const org = (await api(rita, "GET", "/api/editeur/contexte")).corps.organisation.id;
  const schema = sql("SELECT schema_name FROM platform.organisations WHERE slug = 'atelier-demo'");
  const cree = await api(rita, "POST", "/api/documents", { organisationId: org, contenu: { meta: { typeDocument: "procedure", titre: "", reference: "" }, roles: [], etapes: [] } });
  assert.equal(cree.statut, 201);
  const id = cree.corps.id;

  etape("menu Fichier → « Importer une fiche de collecte (Excel) » : la procédure remplace le document et s'enregistre");
  const p = await rita.context().newPage();
  p.erreurs = [];
  p.on("pageerror", (e) => p.erreurs.push("pageerror: " + e.message));
  p.on("dialog", (d) => d.accept()); // « remplacer le document ? »
  await p.goto(`${BASE}/editeur/index.html?doc=${id}`);
  await editeurPret(p);
  await p.click("#btn-fichier");
  const [choix] = await Promise.all([p.waitForEvent("filechooser"), p.click("#btn-importer-fiche")]);
  await choix.setFiles(path.resolve(__dirname, "../../editeur/tests/fixtures/fiche-collecte-exemple.xlsx"));
  await p.waitForSelector("#rapport-import:not([hidden])", { timeout: 20000 });
  assert.equal(await p.textContent("#rapport-import h3"), "Import de la fiche de collecte : ce qui a été lu");
  const lignes = await p.locator("#rapport-liste li").allTextContents();
  assert.equal(lignes[0], "5 rôles, 9 instructions et 1 instruction(s) de travail importés. Vérifie-les avant de soumettre.");
  assert.ok(lignes.includes("Instructions de travail créées (brouillons) : IT-JUR-03."), lignes.join("\n"));
  assert.ok(lignes.some((l) => l.startsWith("Point ouvert (op. 6) : Qui assure le dépôt")));
  await capture(p, "fiche-collecte-rapport");
  await attendreEtat(p, "Enregistré");
  const doc = (await api(p, "GET", `/api/editeur/contexte?doc=${id}`)).corps.document.contenu;
  assert.equal(doc.meta.reference, "PR-JUR-03");
  assert.equal(doc.etapes.length, 9);
  assert.equal(doc.etapes[3].niveau3.code, "IT-JUR-03");

  etape("l'instruction de travail IT-JUR-03 : document à part, en brouillon, avec son « Comment ? » imprimé sous le logigramme");
  const itId = sql(`SELECT id FROM "${schema}".documents WHERE contenu->'meta'->>'reference' = 'IT-JUR-03' AND supprime_le IS NULL`);
  assert.match(itId, /^[0-9a-f-]{36}$/);
  assert.equal(sql(`SELECT type || '/' || etat FROM "${schema}".documents WHERE id = '${itId}'`), "instruction/brouillon");
  const it = await rita.context().newPage();
  it.erreurs = [];
  it.on("pageerror", (e) => it.erreurs.push("pageerror: " + e.message));
  await it.goto(`${BASE}/editeur/index.html?doc=${itId}`);
  await editeurPret(it);
  const imprime = await it.evaluate(() => {
    window.dispatchEvent(new Event("beforeprint"));
    const zone = document.getElementById("zone-impression");
    const r = { titre: zone.querySelector(".mode-operatoire h4")?.textContent ?? null, lignes: [...zone.querySelectorAll(".tab-mode-operatoire tbody tr")].map((tr) => [...tr.children].map((c) => c.textContent)) };
    window.dispatchEvent(new Event("afterprint"));
    return r;
  });
  assert.equal(imprime.titre, "Mode opératoire");
  assert.deepEqual(imprime.lignes[0], ["1", "Vérifier la conformité juridique", "Relire le contrat au regard du droit applicable — Point clé : Clauses conformes"]);
  assert.equal(imprime.lignes.length, 5);
  await capture(it, "fiche-collecte-instruction");

  etape("les deux documents entrent dans le circuit de validation (soumission proposée à la rédactrice)");
  for (const d of [id, itId]) {
    await rita.goto(`${BASE}/app/documents/${d}/validation`);
    assert.deepEqual(await rita.locator(".decision-possible").evaluateAll((l) => l.map((x) => x.dataset.transition)), ["soumettre"]);
  }

  for (const page of [p, it]) assert.deepEqual(page.erreurs, []);
  await b.close();
  console.log("✔ partie 15");
})().catch((e) => { console.error(e); process.exit(1); });
