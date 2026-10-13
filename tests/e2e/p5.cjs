// Partie 5 : le superadmin crée une organisation depuis l'interface (fonction de création en base, sans le rôle
// propriétaire) ; son premier administrateur est INVITÉ : il ouvre le lien, crée son compte (mot de passe choisi
// par lui) et arrive dans son organisation. Le lien ne sert qu'une fois.
const { BASE, SUPERADMIN, lancer, connecter, anonyme, capture, etape, assert } = require("./outils.cjs");
(async () => {
  const b = await lancer();
  const sa = await connecter(SUPERADMIN.email);
  await sa.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
  etape("superadmin : nouvelle organisation → lien d'invitation affiché (et copiable), sans mot de passe à fixer");
  await sa.goto(`${BASE}/plateforme/organisations/nouvelle`);
  assert.equal(await sa.locator('input[name="adminMotDePasse"]').count(), 0, "plus de mot de passe provisoire");
  const s = Date.now().toString(36);
  await sa.fill('input[name="nom"]', `Organisation créée ${s}`);
  await sa.fill('input[name="slug"]', `creee-${s}`);
  await sa.fill('input[name="adminEmail"]', `admin-${s}@demo.test`);
  await sa.fill('input[name="adminNom"]', `Admin ${s}`);
  await sa.click('button:has-text("Créer l\'organisation")');
  await sa.waitForSelector(".lien-a-copier input", { timeout: 20000 });
  const lien = await sa.inputValue(".lien-a-copier input");
  assert.match(lien, new RegExp(`^${BASE}/invitation/[A-Za-z0-9_-]{43}$`));
  assert.match(await sa.textContent('[role="status"]'), /Organisation créée/);
  await sa.click('.lien-a-copier button:has-text("Copier")');
  await sa.waitForSelector('.lien-a-copier button:has-text("Copié")');
  assert.equal(await sa.evaluate(() => navigator.clipboard.readText()), lien);
  await capture(sa, "organisation-creee-lien");
  await sa.goto(`${BASE}/plateforme/organisations`);
  assert.ok(await sa.isVisible(`text=Organisation créée ${s}`));

  etape("le futur administrateur ouvre le lien, crée son compte et arrive dans son organisation");
  const adm = await anonyme();
  await adm.goto(lien);
  assert.ok(await adm.isVisible(`text=Rejoindre « Organisation créée ${s} »`));
  assert.equal(await adm.inputValue('input[name="nom"]'), `Admin ${s}`);
  await capture(adm, "invitation-creation-compte");
  await adm.fill('input[name="nouveau"]', "court");
  await adm.fill('input[name="confirmation"]', "court");
  await adm.click('button:has-text("Créer mon compte")');
  await adm.waitForSelector(".message-erreur");
  await adm.fill('input[name="nouveau"]', "mot-de-passe-choisi-e2e");
  await adm.fill('input[name="confirmation"]', "mot-de-passe-choisi-e2e");
  await adm.click('button:has-text("Créer mon compte")');
  await adm.waitForURL(`${BASE}/app`, { timeout: 20000 });
  assert.ok(await adm.isVisible(`text=Organisation créée ${s}`));
  await adm.goto(`${BASE}/app/documents`);
  assert.ok(await adm.isVisible("text=Aucun document pour l'instant."));
  await capture(adm, "administrateur-arrive");

  etape("le lien a servi : il n'est plus valable ; le compte se connecte avec le mot de passe qu'il a choisi");
  const autre = await anonyme();
  await autre.goto(lien);
  assert.ok(await autre.isVisible("text=n'est pas (ou plus) valable"));
  await autre.goto(`${BASE}/connexion`);
  await autre.fill('input[name="email"]', `admin-${s}@demo.test`);
  await autre.fill('input[name="motDePasse"]', "mot-de-passe-choisi-e2e");
  await autre.click('button:has-text("Se connecter")');
  await autre.waitForURL(`${BASE}/app`);

  for (const p of [sa, adm, autre]) assert.deepEqual(p.erreurs, []);
  console.log("  erreurs console : aucune");
  await b.close();
  console.log("✔ partie 5");
})().catch((e) => { console.error(e); process.exit(1); });
