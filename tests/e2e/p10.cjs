// Partie 10 : historique des versions, comparaison, restauration et corbeille (D1), dans « Autre Organisation ».
const { BASE, lancer, connecter, api, capture, etape, assert } = require("./outils.cjs");

(async () => {
  const b = await lancer();
  const p = await connecter("autre@demo.test");
  const org = (await api(p, "GET", "/api/editeur/contexte")).corps.organisation.id;
  const v1 = {
    meta: { typeDocument: "procedure", titre: "Titre initial", reference: "PR-HIS-01" },
    roles: [{ id: "r1", nom: "Qualité" }],
    etapes: [{ id: "e1", roleId: "r1", libelle: "Préparer l'audit" }],
  };
  const v2 = {
    meta: { typeDocument: "procedure", titre: "Titre modifié", reference: "PR-HIS-01" },
    roles: [{ id: "r1", nom: "Qualité" }],
    etapes: [{ id: "e1", roleId: "r1", libelle: "Préparer l'audit interne" }, { id: "e2", roleId: "r1", libelle: "Réaliser l'audit" }],
  };

  etape("un document, puis une modification (même personne : la version actuelle n'est pas encore copiée)");
  const cree = await api(p, "POST", "/api/documents", { organisationId: org, contenu: v1 });
  assert.equal(cree.statut, 201);
  const id = cree.corps.id;
  assert.equal((await api(p, "PUT", `/api/documents/${id}`, { organisationId: org, version: 1, contenu: v2 })).statut, 200);

  etape("page Historique (depuis la liste) : la version 1 ; comparaison avec l'actuelle, champ par champ");
  await p.goto(`${BASE}/app/documents`);
  await p.locator("tbody tr", { has: p.locator(`a[href="/editeur/index.html?doc=${id}"]`) }).locator('a:has-text("Historique")').click();
  await p.waitForURL(`${BASE}/app/documents/${id}/historique`);
  assert.deepEqual(await p.locator("#versions tbody tr").evaluateAll((l) => l.map((tr) => tr.dataset.version)), ["1"]);
  assert.ok(await p.isVisible("text=Version actuelle (v2) — pas encore copiée dans l'historique"));
  await p.click('#versions a:has-text("Comparer avec l\'actuelle")');
  await p.waitForSelector("#differences");
  const lignes = await p.locator("#differences tbody tr").evaluateAll((l) => l.map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent.trim())));
  console.log("  différences :", JSON.stringify(lignes));
  assert.deepEqual(lignes, [
    ["Identification › Intitulé", "Modifié", "Titre initial", "Titre modifié"],
    ["Instructions › instruction 1 « Préparer l'audit interne » › Libellé", "Modifié", "Préparer l'audit", "Préparer l'audit interne"],
    ["Instructions › instruction 2 « Réaliser l'audit »", "Ajouté", "(vide)", "Réaliser l'audit"],
  ]);
  assert.ok(await p.isVisible("text=Comparaison : v1 → v2"));
  await capture(p, "historique-comparaison");

  etape("restaurer la version 1 : nouvelle version 3, contenu exact de la v1, l'état remplacé (v2) gardé");
  p.once("dialog", (d) => { assert.match(d.message(), /^Remettre le contenu de la version 1 dans le document \?/); d.accept(); });
  await p.click('#versions tr[data-version="1"] button:has-text("Restaurer")');
  await p.waitForSelector("text=Version 1 restaurée : le document est maintenant en version 3.");
  const ctx = await api(p, "GET", `/api/editeur/contexte?doc=${id}`);
  assert.equal(ctx.corps.document.version, 3);
  assert.deepEqual(ctx.corps.document.contenu, v1);
  await p.waitForFunction(() => document.querySelectorAll("#versions tbody tr").length === 3);
  const motifs = await p.locator("#versions tbody tr").evaluateAll((l) => l.map((tr) => [tr.dataset.version, tr.querySelectorAll("td")[3].textContent.trim()]));
  assert.deepEqual(motifs, [["3", "restauration"], ["2", "avant un remplacement"], ["1", "création"]]);
  await capture(p, "historique-restauration");

  etape("mettre à la corbeille depuis la liste, puis rétablir depuis la corbeille");
  await p.goto(`${BASE}/app/documents`);
  const ligne = p.locator("tbody tr", { has: p.locator(`a[href="/editeur/index.html?doc=${id}"]`) });
  p.once("dialog", (d) => { assert.match(d.message(), /^Mettre « Titre initial » à la corbeille \? Il pourra être rétabli/); d.accept(); });
  const fin = p.waitForResponse((r) => r.request().method() === "POST" && r.url().startsWith(`${BASE}/app/documents`));
  await ligne.locator('button:has-text("Supprimer")').click();
  await fin;
  await p.waitForFunction((x) => !document.querySelector(`a[href="/editeur/index.html?doc=${x}"]`), id);
  assert.equal((await api(p, "GET", `/api/editeur/contexte?doc=${id}`)).statut, 404, "un document à la corbeille ne s'ouvre plus");
  await p.click("#lien-corbeille");
  await p.waitForURL(`${BASE}/app/documents/corbeille`);
  const dansCorbeille = p.locator("#corbeille tbody tr", { has: p.locator("td", { hasText: "PR-HIS-01" }) });
  assert.equal(await dansCorbeille.count(), 1);
  await capture(p, "corbeille");
  // (La ligne disparaît avec son formulaire : on attend la réponse de l'action, puis la disparition.)
  const retabli = p.waitForResponse((r) => r.request().method() === "POST" && r.url().startsWith(`${BASE}/app/documents/corbeille`));
  await dansCorbeille.locator('button:has-text("Rétablir")').click();
  assert.equal((await retabli).status(), 200);
  await p.waitForFunction(() => ![...document.querySelectorAll("#corbeille tbody td")].some((td) => td.textContent.includes("PR-HIS-01")));
  assert.equal((await api(p, "GET", `/api/editeur/contexte?doc=${id}`)).statut, 200);
  const h = await p.goto(`${BASE}/app/documents/${id}/historique`);
  assert.equal(h.status(), 200);
  assert.equal(await p.locator("#versions tbody tr").count(), 3, "l'historique a suivi le document");

  etape("nettoyage : le document d'essai retourne à la corbeille");
  await p.goto(`${BASE}/app/documents`);
  p.once("dialog", (d) => d.accept());
  const fin2 = p.waitForResponse((r) => r.request().method() === "POST" && r.url().startsWith(`${BASE}/app/documents`));
  await p.locator("tbody tr", { has: p.locator(`a[href="/editeur/index.html?doc=${id}"]`) }).locator('button:has-text("Supprimer")').click();
  await fin2;

  console.log("  erreurs console :", p.erreurs.length ? p.erreurs : "aucune");
  assert.deepEqual(p.erreurs, []);
  await b.close();
  console.log("✔ partie 10");
})().catch((e) => { console.error(e); process.exit(1); });
