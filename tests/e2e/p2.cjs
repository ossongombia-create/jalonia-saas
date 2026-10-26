// Partie 2 : synthèse validée → Word ; import Word dans une nouvelle procédure ; cartographie (modèle, PDF) ; instruction N3.
const { BASE, SORTIE, fichierEtat, lancer, connecter, api, editeurPret, attendreEtat, capture, etape, assert } = require("./outils.cjs");
const fs = require("node:fs");
(async () => {
  const b = await lancer();
  const p = await connecter("redac@demo.test");
  const docId = fs.readFileSync(fichierEtat("doc-id.txt"), "utf8").trim();
  p.on("dialog", (d) => d.accept()); // confirmations de l'éditeur (remplacer, créer l'instruction…)

  etape("ouvrir la procédure exemple, étape 3 : valider la synthèse (enregistré), étape 4 : Word");
  await p.goto(`${BASE}/editeur/index.html?doc=${docId}`);
  await editeurPret(p);
  await p.click('.liste-etapes li:nth-child(3) button');
  await p.check('.case-validation input[type="checkbox"]');
  await attendreEtat(p, "Enregistré");
  let ctx = await api(p, "GET", `/api/editeur/contexte?doc=${docId}`);
  assert.ok(ctx.corps.document.contenu.validation, "la validation de la synthèse est enregistrée sur le serveur");
  await p.click('.liste-etapes li:nth-child(4) button');
  const [word] = await Promise.all([p.waitForEvent("download"), p.click('button:has-text("Télécharger le Word (.docx)")')]);
  const cheminWord = SORTIE + "/" + word.suggestedFilename();
  await word.saveAs(cheminWord);
  const octets = fs.readFileSync(cheminWord);
  assert.equal(octets.subarray(0, 2).toString(), "PK", "le Word est une archive .docx");
  assert.ok(octets.length > 20000, `Word de ${octets.length} octets`);
  console.log("  Word :", word.suggestedFilename(), octets.length, "octets");
  await capture(p, "generation");

  etape("nouvelle procédure (depuis la liste) puis import du Word : le contenu est repris et enregistré");
  await p.goto(`${BASE}/app/documents`);
  await p.click('button:has-text("Nouvelle procédure")');
  await p.waitForURL(/doc=/);
  const doc2 = new URL(p.url()).searchParams.get("doc");
  await editeurPret(p);
  await p.click("#btn-fichier");
  const [choix] = await Promise.all([p.waitForEvent("filechooser"), p.click("#btn-importer-word")]);
  await choix.setFiles(cheminWord);
  await p.waitForSelector("#rapport-import:not([hidden])");
  await attendreEtat(p, "Enregistré");
  ctx = await api(p, "GET", `/api/editeur/contexte?doc=${doc2}`);
  assert.equal(ctx.corps.document.contenu.meta.titre, "Cuisiner et servir un repas");
  assert.equal(ctx.corps.document.contenu.etapes.length, 8);
  await capture(p, "import-word");

  etape("cartographie (menu Fichier) : un modèle de la bibliothèque, enregistré automatiquement");
  await p.click("#btn-fichier");
  await p.click("#btn-cartographie");
  await p.waitForSelector("#fenetre-carto[open]");
  assert.equal(await p.textContent("#carto-etat"), "Enregistré");
  await p.click('#carto-contenu button:has-text("Modèles")');
  await p.click('.carto-modeles-liste li:first-child button');
  await attendreEtat(p, "Enregistré", "#carto-etat");
  ctx = await api(p, "GET", `/api/editeur/contexte`);
  assert.equal(ctx.corps.cartographie.version, 1);
  const nbModele = ctx.corps.cartographie.contenu.processus.length;
  assert.ok(nbModele > 3, `${nbModele} processus du modèle`);
  await capture(p, "carto-modele");

  etape("cartographie unique (TC-09) : importer un PDF sur une cartographie existante est bloqué ; « Tout effacer » d'abord");
  let choixFichier = false;
  const surChoix = () => { choixFichier = true; };
  p.on("filechooser", surChoix);
  await p.click('#carto-contenu button:has-text("Importer un PDF")');
  await p.waitForSelector(".carto-rapport");
  assert.match(await p.textContent(".carto-rapport"), /Une cartographie existe déjà/);
  await p.click('#carto-contenu button:has-text("Exemple")');
  assert.match(await p.textContent(".carto-rapport"), /Une cartographie existe déjà/);
  p.off("filechooser", surChoix);
  assert.equal(choixFichier, false, "aucun fichier demandé");
  assert.equal((await api(p, "GET", `/api/editeur/contexte`)).corps.cartographie.version, 1, "cartographie inchangée");
  p.once("dialog", (d) => d.accept());
  await p.click('#carto-contenu button:has-text("Tout effacer")');
  await attendreEtat(p, "Enregistré", "#carto-etat");
  assert.equal((await api(p, "GET", `/api/editeur/contexte`)).corps.cartographie.version, 2);

  etape("cartographie : import d'un PDF (pdf.js sous la politique de sécurité du site)");
  const [pdf] = await Promise.all([p.waitForEvent("filechooser"), p.click('#carto-contenu button:has-text("Importer un PDF")')]);
  await pdf.setFiles(require("node:path").resolve(__dirname, "../../editeur/tests/fixtures/Cartographie_exemple.pdf"));
  await p.waitForSelector(".carto-rapport");
  await attendreEtat(p, "Enregistré", "#carto-etat");
  ctx = await api(p, "GET", `/api/editeur/contexte`);
  assert.equal(ctx.corps.cartographie.version, 3);
  const processusPdf = ctx.corps.cartographie.contenu.processus.map((x) => x.code);
  assert.ok(processusPdf.length >= 5, `processus lus dans le PDF : ${processusPdf.join(", ")}`);
  console.log("  PDF :", processusPdf.length, "processus lus");
  await capture(p, "carto-pdf");
  await p.click("#carto-fermer");

  etape("instruction N3 : depuis une instruction de la procédure exemple → NOUVEAU document, la procédure reste intacte");
  await p.goto(`${BASE}/editeur/index.html?doc=${docId}`);
  await editeurPret(p);
  const avant = (await api(p, "GET", `/api/editeur/contexte?doc=${docId}`)).corps.document.contenu;
  await p.click('.liste-etapes li:nth-child(2) button');
  await p.click('[data-cle^="instr-"] >> nth=1');
  await p.click('[data-cle="part-niveau3"]');
  await p.fill('textarea[aria-label="Code de l\'instruction de travail"]', "IT-CUI-01");
  assert.ok(await p.isVisible("text=La procédure reste enregistrée telle quelle"), "aide propre au mode en ligne");
  await p.click('button:has-text("Créer l\'instruction de travail")');
  await p.waitForURL((u) => u.searchParams.get("doc") && u.searchParams.get("doc") !== docId);
  const docIT = new URL(p.url()).searchParams.get("doc");
  await editeurPret(p);
  ctx = await api(p, "GET", `/api/editeur/contexte?doc=${docIT}`);
  assert.equal(ctx.corps.document.contenu.meta.typeDocument, "instruction");
  assert.equal(ctx.corps.document.contenu.meta.reference, "IT-CUI-01");
  const proc = (await api(p, "GET", `/api/editeur/contexte?doc=${docId}`)).corps.document.contenu;
  assert.equal(proc.etapes.length, avant.etapes.length, "la procédure garde ses instructions");
  assert.ok(proc.etapes.some((e) => e.niveau3 && e.niveau3.actif && e.niveau3.code === "IT-CUI-01"), "la procédure a enregistré son renvoi N3 avant de céder la place");
  await capture(p, "instruction-n3");

  etape("liste des documents : 3 documents, types et codes affichés");
  await p.click("#lien-documents");
  await p.waitForURL(`${BASE}/app/documents`);
  // (Premier nœud de chaque cellule : le repère « À vérifier » de la cohérence entre documents suit le code.)
  const lignes = await p.$$eval("table.tableau tbody tr", (l) => l.map((tr) => [...tr.querySelectorAll("td")].slice(0, 3).map((td) => td.firstChild.textContent.trim())));
  console.log("  liste :", JSON.stringify(lignes));
  console.log("  cohérence :", (await p.locator("#coherence").innerText()).replace(/\s*\n\s*/g, " | "));
  assert.equal(lignes.length, 3);
  assert.ok(lignes.some((l) => l[0] === "Instruction de travail" && l[1] === "IT-CUI-01"));
  assert.ok(await p.isVisible("text=Dernière modification le"), "cartographie : date et auteur affichés");
  await capture(p, "liste-3-documents");
  fs.writeFileSync(fichierEtat("doc-it.txt"), docIT);

  console.log("  erreurs console :", p.erreurs.length ? p.erreurs : "aucune");
  assert.deepEqual(p.erreurs, []);
  await b.close();
  console.log("✔ partie 2");
})().catch((e) => { console.error(e); process.exit(1); });
