// Partie 8 : cohérence entre documents (D2), dans l'organisation « Autre Organisation ».
//   - la page « Documents » signale codes, instructions de travail, sous-procédures et processus incohérents, sans rien modifier ;
//   - supprimer une procédure qui a une instruction de travail : l'avertissement nomme l'instruction ; « Annuler » ne supprime
//     rien ; après confirmation, seule la procédure disparaît (l'instruction reste, désormais signalée « non citée »).
const { BASE, lancer, connecter, api, capture, etape, assert } = require("./outils.cjs");

(async () => {
  const b = await lancer();
  const p = await connecter("autre@demo.test");
  await p.goto(`${BASE}/app/documents`);
  const ctx = (await api(p, "GET", "/api/editeur/contexte")).corps;
  const org = ctx.organisation.id;

  etape("préparation par l'API de l'éditeur : une procédure, ses liens, deux instructions, la cartographie");
  const procedure = {
    meta: { typeDocument: "procedure", titre: "Contrôler la cohérence", reference: "PR-COH-01", processus: "ZZZ Processus disparu" },
    roles: [{ id: "r1", nom: "Qualité" }],
    etapes: [
      { id: "e1", roleId: "r1", libelle: "Préparer", niveau3: { actif: true, code: "IT-COH-01", intitule: "Préparer" } },
      { id: "e2", roleId: "r1", libelle: "Appeler", sousProcedure: { actif: true, code: "PR-COH-99" } },
    ],
  };
  const instruction = (reference, titre) => ({ meta: { typeDocument: "instruction", titre, reference, processus: "ACH Acheter", niveau: 3 }, roles: [], etapes: [] });
  const creer = async (contenu) => {
    const r = await api(p, "POST", "/api/documents", { organisationId: org, contenu });
    assert.equal(r.statut, 201, JSON.stringify(r.corps));
    return r.corps.id;
  };
  const idPr = await creer(procedure);
  const idIt1 = await creer(instruction("IT-COH-01", "Préparer"));
  const idIt2 = await creer(instruction("IT-COH-02", "Instruction orpheline"));
  const carto = { processus: [{ id: "p1", code: "ACH", nom: "Acheter", categorie: "realisation" }], flux: [], documents: [] };
  const rc = await api(p, "PUT", "/api/cartographie", { organisationId: org, version: ctx.cartographie.version, contenu: { ...ctx.cartographie.contenu, ...carto } });
  assert.equal(rc.statut, 200, JSON.stringify(rc.corps));

  etape("page « Documents » : constats de cohérence et repères « À vérifier »");
  await p.goto(`${BASE}/app/documents`);
  const section = p.locator("#coherence");
  const texte = await section.innerText();
  for (const attendu of [
    "La sous-procédure PR-COH-99 est appelée, mais aucune procédure ne porte ce code.",
    "L'instruction de travail IT-COH-02 n'est citée par aucune procédure",
    "Le processus « ZZZ Processus disparu » n'existe pas dans la cartographie.",
  ]) assert.ok(texte.includes(attendu), `constat attendu : ${attendu}\n---\n${texte}`);
  assert.ok(!texte.includes("IT-COH-01 n'est citée"), "l'instruction rattachée n'est pas signalée");
  const ligne = (code) => p.locator("tbody tr", { has: p.locator("td.nowrap", { hasText: code }) });
  assert.equal(await ligne("PR-COH-01").locator('a.etiquette:has-text("À vérifier")').count(), 1);
  assert.equal(await ligne("IT-COH-02").locator('a.etiquette:has-text("À vérifier")').count(), 1);
  assert.equal(await ligne("IT-COH-01").locator('a.etiquette:has-text("À vérifier")').count(), 0);
  // Les liens des constats ouvrent les documents dans l'éditeur.
  assert.equal(await section.locator(`a[href="/editeur/index.html?doc=${idIt2}"]`).count(), 1);
  await section.scrollIntoViewIfNeeded();
  await capture(p, "coherence-constats");

  etape("supprimer la procédure : l'avertissement nomme son instruction de travail ; « Annuler » ne supprime rien");
  let message = "";
  p.once("dialog", (d) => { message = d.message(); d.dismiss(); });
  await ligne("PR-COH-01").locator('button:has-text("Supprimer")').click();
  await p.waitForTimeout(500);
  assert.ok(message.includes("IT-COH-01 — Préparer (instruction de travail)"), `avertissement : ${message}`);
  assert.ok(message.includes("ne seront PAS supprimés"), `avertissement : ${message}`);
  assert.equal(await ligne("PR-COH-01").count(), 1, "rien n'est supprimé après « Annuler »");

  etape("confirmer : seule la procédure disparaît ; l'instruction reste, signalée « non citée »");
  p.once("dialog", (d) => d.accept());
  const reponse = p.waitForResponse((r) => r.request().method() === "POST" && r.url().startsWith(`${BASE}/app/documents`));
  await ligne("PR-COH-01").locator('button:has-text("Supprimer")').click();
  await reponse;
  await p.waitForFunction(() => ![...document.querySelectorAll("tbody td.nowrap")].some((td) => td.textContent.includes("PR-COH-01")));
  assert.equal(await ligne("IT-COH-01").count(), 1, "l'instruction de travail n'est pas supprimée");
  assert.ok((await p.locator("#coherence").innerText()).includes("L'instruction de travail IT-COH-01 n'est citée par aucune procédure"));
  const contexteIt = await api(p, "GET", `/api/editeur/contexte?doc=${idIt1}`);
  assert.equal(contexteIt.statut, 200);

  etape("nettoyage : les deux instructions (sans lien : aucune confirmation demandée)");
  for (const id of [idIt1, idIt2]) {
    const l = p.locator("tbody tr", { has: p.locator(`a[href="/editeur/index.html?doc=${id}"]`) });
    let vu = "";
    p.once("dialog", (d) => { vu = d.message(); d.accept(); });
    const fin = p.waitForResponse((r) => r.request().method() === "POST" && r.url().startsWith(`${BASE}/app/documents`));
    await l.locator('button:has-text("Supprimer")').click();
    await fin;
    assert.ok(vu.startsWith("Mettre « ") && !vu.includes("ATTENTION"), `confirmation simple : ${vu}`);
  }
  await p.waitForFunction(() => !document.body.innerText.includes("IT-COH-0"));
  assert.equal((await api(p, "GET", `/api/editeur/contexte?doc=${idPr}`)).statut, 404);

  console.log("  erreurs console :", p.erreurs.length ? p.erreurs : "aucune");
  assert.deepEqual(p.erreurs, []);
  await b.close();
  console.log("✔ partie 8");
})().catch((e) => { console.error(e); process.exit(1); });
