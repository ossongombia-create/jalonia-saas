// Partie 4 : lecture seule (lectrice en anglais, vérificateur), refus de l'API, étanchéité, suppression, journal.
const { BASE, SORTIE, fichierEtat, lancer, connecter, api, editeurPret, attendreEtat, capture, etape, assert } = require("./outils.cjs");
const fs = require("node:fs");
(async () => {
  const b = await lancer();
  const docId = fs.readFileSync(fichierEtat("doc-id.txt"), "utf8").trim();
  const docIT = fs.readFileSync(fichierEtat("doc-it.txt"), "utf8").trim();

  etape("préalable : la rédactrice valide la synthèse de la procédure (ouvre l'étape Génération)");
  const rita = await connecter("redac@demo.test");
  await rita.goto(`${BASE}/editeur/index.html?doc=${docId}`);
  await editeurPret(rita);
  await rita.click('.liste-etapes li:nth-child(3) button');
  if (!(await rita.isChecked('.case-validation input[type="checkbox"]'))) {
    await rita.check('.case-validation input[type="checkbox"]');
    await attendreEtat(rita, "Enregistré");
  }

  etape("lectrice (anglais) : liste sans création ni suppression, bandeau de lecture seule");
  const lea = await connecter("lecteur@demo.test");
  await lea.goto(`${BASE}/app/documents`);
  assert.equal(await lea.isVisible('button:has-text("New procedure")'), false);
  assert.equal(await lea.isVisible('button:has-text("Delete")'), false);
  assert.ok(await lea.isVisible("text=Your role gives read access to documents"));
  assert.equal(await lea.locator("table.tableau tbody tr").count(), 3);
  await capture(lea, "liste-lectrice");

  etape("lectrice : le document s'ouvre en lecture seule ; rien ne peut être modifié ni enregistré");
  const versionAvant = (await api(lea, "GET", `/api/editeur/contexte?doc=${docId}`)).corps.document.version;
  await lea.goto(`${BASE}/editeur/index.html?doc=${docId}`);
  await editeurPret(lea);
  assert.equal(await lea.textContent("#etat-synchro"), "Read only");
  assert.ok(await lea.isVisible("#bandeau-lecture-seule"));
  assert.match(await lea.textContent("#bandeau-lecture-seule"), /Read only: your role lets you open this document/);
  assert.equal(await lea.isVisible("#btn-enregistrer"), false);
  await lea.click('.liste-etapes li:nth-child(1) button');
  const champTitre = lea.locator("textarea").nth(4);
  assert.equal(await champTitre.evaluate((el) => el.readOnly), true, "les champs sont en lecture seule");
  const valeur = await champTitre.inputValue();
  await champTitre.click();
  await lea.keyboard.type("PIRATE");
  assert.equal(await champTitre.inputValue(), valeur);
  assert.equal(await lea.locator("#etape-contenu select:not([disabled])").count(), 0, "listes déroulantes désactivées");
  await lea.click("#btn-fichier");
  for (const id of ["#btn-nouvelle", "#btn-exemple", "#btn-exemple-it", "#btn-ouvrir", "#btn-importer-word"]) assert.equal(await lea.isVisible(id), false, id);
  assert.ok(await lea.isVisible("#btn-copie-json"));
  await lea.keyboard.press("Escape");
  await capture(lea, "lecture-seule");

  etape("lectrice : la cartographie s'ouvre en lecture seule (pas d'import, pas de modèle, pas d'effacement)");
  await lea.click("#btn-fichier");
  await lea.click("#btn-cartographie");
  await lea.waitForSelector("#fenetre-carto[open]");
  assert.equal(await lea.textContent("#carto-etat"), "Read only");
  assert.ok(await lea.isVisible("#carto-lecture-seule"));
  for (const texte of ["Import a PDF", "Templates", "Clear all", "Example"]) assert.equal(await lea.locator(`#carto-contenu .carto-actions button:has-text("${texte}")`).count(), 0, texte);
  assert.ok(await lea.locator('#carto-contenu .carto-actions button:has-text("Word")').count() === 1, "export Word du niveau 1 disponible");
  await capture(lea, "carto-lecture-seule");
  await lea.click("#carto-fermer");

  etape("lectrice : export Word du document validé, comme pour un rédacteur");
  await lea.click('.liste-etapes li:nth-child(4) button');
  const [word] = await Promise.all([lea.waitForEvent("download"), lea.click('button:has-text("Download the Word file (.docx)")')]);
  const cheminWord = SORTIE + "/lectrice-" + word.suggestedFilename();
  await word.saveAs(cheminWord);
  assert.equal(fs.readFileSync(cheminWord).subarray(0, 2).toString(), "PK");
  console.log("  Word (lectrice) :", word.suggestedFilename(), fs.statSync(cheminWord).size, "octets");
  const ctxDoc = (await api(lea, "GET", `/api/editeur/contexte?doc=${docIT}`)).corps;
  assert.equal(ctxDoc.droits.rediger, false);

  etape("lectrice : l'API refuse toute écriture (403), même en appel direct");
  const corpsDoc = { organisationId: ctxDoc.organisation.id, version: versionAvant, contenu: { meta: { titre: "Pirate" }, roles: [], etapes: [] } };
  assert.equal((await api(lea, "PUT", `/api/documents/${docId}`, corpsDoc)).statut, 403);
  assert.equal((await api(lea, "POST", `/api/documents`, { organisationId: ctxDoc.organisation.id, contenu: corpsDoc.contenu })).statut, 403);
  assert.equal((await api(lea, "PUT", `/api/cartographie`, { ...corpsDoc, version: 0, contenu: { processus: [], flux: [], documents: [] } })).statut, 403);
  await lea.waitForTimeout(2500);
  assert.equal((await api(lea, "GET", `/api/editeur/contexte?doc=${docId}`)).corps.document.version, versionAvant, "aucun enregistrement n'est parti");
  assert.deepEqual(lea.erreurs, []);

  etape("vérificateur + approbateur : lecture seule aussi (ses décisions se prennent sur la page « Validation » : partie 11)");
  const victor = await connecter("verif@demo.test");
  const ctxV = (await api(victor, "GET", `/api/editeur/contexte?doc=${docId}`)).corps;
  assert.deepEqual(ctxV.droits, { rediger: false, supprimer: false, cartographie: false });

  etape("autre organisation : aucun accès aux documents de l'Atelier (404), même en connaissant l'identifiant");
  const autre = await connecter("autre@demo.test");
  assert.equal((await api(autre, "GET", `/api/editeur/contexte?doc=${docId}`)).statut, 404);
  const ctxAutre = (await api(autre, "GET", `/api/editeur/contexte`)).corps;
  assert.equal(ctxAutre.cartographie.version, 0, "sa propre cartographie, vide");
  assert.equal((await api(autre, "PUT", `/api/documents/${docId}`, { ...corpsDoc, organisationId: ctxAutre.organisation.id })).statut, 404);
  assert.equal((await api(autre, "PUT", `/api/documents/${docId}`, corpsDoc)).statut, 409, "organisation annoncée ≠ organisation ouverte : refus");
  await autre.goto(`${BASE}/editeur/index.html?doc=${docId}`);
  await autre.waitForSelector("#ecran-en-ligne[data-erreur]");
  assert.match(await autre.textContent("#ecran-en-ligne-texte"), /n'existe pas/);
  assert.equal((await autre.textContent("#ecran-en-ligne-actions")).trim(), "← Mes documents", "rien d'autre que le lien (pas de « null »)");
  await capture(autre, "autre-organisation");

  etape("protections de l'API : origine étrangère, mauvais type de contenu, corps trop gros, sans session");
  const req = rita.context().request;
  const corpsOk = JSON.stringify({ organisationId: ctxDoc.organisation.id, version: 1, contenu: { meta: {}, roles: [], etapes: [] } });
  let r = await req.put(`${BASE}/api/documents/${docId}`, { headers: { "Content-Type": "application/json", Origin: "https://pirate.example" }, data: corpsOk });
  assert.equal(r.status(), 403);
  r = await req.put(`${BASE}/api/documents/${docId}`, { headers: { "Content-Type": "text/plain", Origin: BASE }, data: corpsOk });
  assert.equal(r.status(), 415);
  r = await req.put(`${BASE}/api/documents/${docId}`, { headers: { "Content-Type": "application/json", Origin: BASE }, data: "x".repeat(2_600_000) });
  assert.equal(r.status(), 413);
  r = await req.put(`${BASE}/api/documents/${docId}`, { headers: { "Content-Type": "application/json", Origin: BASE }, data: "{pas du json" });
  assert.equal(r.status(), 400);
  r = await req.put(`${BASE}/api/documents/${docId}`, { headers: { "Content-Type": "application/json", Origin: BASE }, data: JSON.stringify({ organisationId: ctxDoc.organisation.id, version: 1, contenu: [] }) });
  assert.equal(r.status(), 400);
  assert.equal((await r.json()).erreur, "docs.erreur.contenu_invalide");
  const anonyme = await (await b.newContext()).request.get(`${BASE}/api/editeur/contexte`);
  assert.equal(anonyme.status(), 401);

  etape("suppression par la rédactrice (avec confirmation), tracée au journal ; l'administrateur la voit");
  await rita.goto(`${BASE}/app/documents`);
  rita.once("dialog", (d) => { assert.match(d.message(), /^Mettre « Placer le client » à la corbeille \?/); d.accept(); });
  await rita.click('tr:has-text("IT-CUI-01") button:has-text("Supprimer")');
  await rita.waitForFunction(() => document.querySelectorAll("table.tableau tbody tr").length === 2);
  assert.equal(await rita.locator('tr:has-text("IT-CUI-01")').count(), 0, "la ligne a disparu");
  assert.equal((await api(rita, "GET", `/api/editeur/contexte?doc=${docIT}`)).statut, 404);
  rita.once("dialog", (d) => d.dismiss());
  await rita.click('table.tableau tbody tr:first-child button:has-text("Supprimer")');
  await rita.waitForTimeout(800);
  assert.equal(await rita.locator("table.tableau tbody tr").count(), 2, "annuler la confirmation ne supprime rien");
  await capture(rita, "apres-suppression");
  const admin = await connecter("admin@demo.test");
  await admin.goto(`${BASE}/app/journal`);
  const journal = await admin.textContent("table.tableau");
  for (const action of ["Document mis à la corbeille", "Document créé", "Document modifié", "Cartographie modifiée"]) assert.ok(journal.includes(action), action);
  await capture(admin, "journal-organisation");

  for (const p of [lea, victor, autre, rita, admin]) assert.deepEqual(p.erreurs, [], "erreurs console");
  console.log("  erreurs console : aucune");
  await b.close();
  console.log("✔ partie 4");
})().catch((e) => { console.error(e); process.exit(1); });
