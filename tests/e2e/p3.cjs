// Partie 3 : deux rédacteurs sur le même document (conflit), session expirée, départ vers la liste après enregistrement.
const { BASE, fichierEtat, sql, lancer, connecter, api, editeurPret, attendreEtat, capture, etape, assert } = require("./outils.cjs");
const fs = require("node:fs");
const titre = 'textarea[aria-label="Intitulé de la procédure"]';

(async () => {
  const b = await lancer();
  const docId = fs.readFileSync(fichierEtat("doc-id.txt"), "utf8").trim();
  const rita = await connecter("redac@demo.test");
  const remi = await connecter("redac2@demo.test");
  for (const p of [rita, remi]) {
    p.on("dialog", (d) => d.accept());
    await p.goto(`${BASE}/editeur/index.html?doc=${docId}`);
    await editeurPret(p);
    await p.click('.liste-etapes li:nth-child(1) button');
  }

  etape("Rita modifie et enregistre ; Rémi (version dépassée) modifie : conflit expliqué, rien n'est écrasé");
  await rita.fill(titre, "Cuisiner — version Rita");
  await attendreEtat(rita, "Enregistré");
  await remi.fill(titre, "Cuisiner — version Rémi");
  await remi.waitForSelector("#fenetre-synchro[open]", { timeout: 15000 });
  const texteConflit = await remi.textContent("#synchro-contenu");
  assert.match(texteConflit, /Rita Rédactrice a enregistré une version plus récente/);
  assert.equal(await remi.textContent("#etat-synchro"), "Non enregistré");
  let ctx = await api(rita, "GET", `/api/editeur/contexte?doc=${docId}`);
  assert.equal(ctx.corps.document.contenu.meta.titre, "Cuisiner — version Rita", "la version de Rita n'a pas été écrasée");
  await capture(remi, "conflit");

  etape("Rémi recharge la version enregistrée : il voit celle de Rita, puis peut continuer");
  await remi.click('#synchro-contenu button:has-text("Recharger la version enregistrée")');
  await remi.waitForFunction((s) => document.querySelector(s).value === "Cuisiner — version Rita", titre);
  assert.equal(await remi.textContent("#etat-synchro"), "Enregistré");
  await remi.fill(titre, "Cuisiner — version Rita relue par Rémi");
  await attendreEtat(remi, "Enregistré");

  etape("Rita (dépassée à son tour) garde sa version : elle remplace celle de Rémi, et c'est tracé au journal");
  await rita.fill(titre, "Cuisiner — Rita insiste");
  await rita.waitForSelector("#fenetre-synchro[open]");
  await rita.click('#synchro-contenu button:has-text("Garder ma version")');
  await attendreEtat(rita, "Enregistré");
  ctx = await api(rita, "GET", `/api/editeur/contexte?doc=${docId}`);
  assert.equal(ctx.corps.document.contenu.meta.titre, "Cuisiner — Rita insiste");
  const schema = sql("SELECT schema_name FROM platform.organisations WHERE slug = 'atelier-demo'");
  const trace = sql(`SELECT details->>'auteurRemplace' FROM "${schema}".journal WHERE action = 'DOCUMENT_MODIFIE' AND details ? 'versionRemplacee' ORDER BY id DESC LIMIT 1`);
  assert.equal(trace, "Rémi Rédacteur");

  etape("session expirée pendant la saisie : enregistrement suspendu et expliqué, le travail reste dans la page");
  sql("UPDATE platform.sessions SET fin = now(), motif_fin = 'revocation' WHERE utilisateur_id = (SELECT id FROM platform.utilisateurs WHERE email = 'redac2@demo.test') AND fin IS NULL");
  await remi.reload(); // la page ne se rouvre pas : retour à la connexion
  await remi.waitForURL(/\/connexion/);
  const remi2 = await connecter("redac2@demo.test");
  remi2.on("dialog", (d) => d.accept());
  await remi2.goto(`${BASE}/editeur/index.html?doc=${docId}`);
  await editeurPret(remi2);
  sql("UPDATE platform.sessions SET fin = now(), motif_fin = 'revocation' WHERE utilisateur_id = (SELECT id FROM platform.utilisateurs WHERE email = 'redac2@demo.test') AND fin IS NULL");
  await remi2.click('.liste-etapes li:nth-child(1) button');
  await remi2.fill(titre, "Travail pendant la session expirée");
  await remi2.waitForSelector("#fenetre-synchro[open]");
  assert.match(await remi2.textContent("#synchro-contenu"), /session a expiré/);
  assert.equal(await remi2.inputValue(titre), "Travail pendant la session expirée", "la saisie est conservée");
  await capture(remi2, "session-expiree");
  // Reconnexion dans un autre onglet du même navigateur, puis « Réessayer » : la saisie part au serveur.
  const onglet = await remi2.context().newPage();
  await onglet.goto(`${BASE}/connexion`);
  await onglet.fill('input[name="email"]', "redac2@demo.test");
  await onglet.fill('input[name="motDePasse"]', "motdepasse-e2e-demo");
  await onglet.click('button:has-text("Se connecter")');
  await onglet.waitForURL((u) => u.pathname === "/app");
  await remi2.click('#synchro-contenu button:has-text("Réessayer")');
  await attendreEtat(remi2, "Enregistré");
  ctx = await api(remi2, "GET", `/api/editeur/contexte?doc=${docId}`);
  assert.equal(ctx.corps.document.contenu.meta.titre, "Travail pendant la session expirée");

  etape("« ← Mes documents » juste après une frappe : enregistré avant de partir");
  await rita.goto(`${BASE}/editeur/index.html?doc=${docId}`);
  await editeurPret(rita);
  await rita.click('.liste-etapes li:nth-child(1) button');
  await rita.fill(titre, "Cuisiner et servir un repas");
  await rita.click("#lien-documents");
  await rita.waitForURL(`${BASE}/app/documents`);
  ctx = await api(rita, "GET", `/api/editeur/contexte?doc=${docId}`);
  assert.equal(ctx.corps.document.contenu.meta.titre, "Cuisiner et servir un repas");

  for (const p of [rita, remi2]) assert.deepEqual(p.erreurs, [], "erreurs console");
  console.log("  erreurs console : aucune");
  await b.close();
  console.log("✔ partie 3");
})().catch((e) => { console.error(e); process.exit(1); });
