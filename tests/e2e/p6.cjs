// Partie 6 : invitations par l'administrateur d'une organisation (audit S8, S10).
//   - même réponse que l'adresse ait déjà un compte ou non ; plus de rattachement d'office ;
//   - personne sans compte : crée le sien ; personne avec compte : se connecte puis accepte ;
//   - un autre compte connecté ne peut pas accepter ; annulation ; liste : activité DANS l'organisation.
const { BASE, MDP, sql, lancer, connecter, anonyme, capture, etape, assert } = require("./outils.cjs");

async function inviter(page, email, nom, roles = ["LECTEUR"]) {
  const form = page.locator("section", { has: page.locator('h2:has-text("Inviter une personne")') }).locator("form");
  await form.locator('input[name="email"]').fill(email);
  await form.locator('input[name="nom"]').fill(nom);
  for (const r of ["ADMIN_ORGANISATION", "REDACTEUR", "VERIFICATEUR", "APPROBATEUR", "LECTEUR"]) {
    const c = form.locator(`input[name="roles"][value="${r}"]`);
    if ((await c.isChecked()) !== roles.includes(r)) await c.click();
  }
  // Réponse de l'action serveur, puis bouton de nouveau disponible : l'état affiché est celui de CETTE invitation.
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/app/membres")), form.locator('button[type="submit"]').click()]);
  await form.locator('button[type="submit"]:not([disabled])').waitFor();
  const message = await form.locator('[role="status"]').textContent();
  const lien = (await form.locator(".lien-a-copier input").count()) ? await form.locator(".lien-a-copier input").inputValue() : null;
  return { message, lien };
}

(async () => {
  // Rejouable : l'administratrice de l'autre organisation ne doit pas déjà être membre de l'Atelier.
  sql(`UPDATE platform.invitations SET annulee_le = now() WHERE acceptee_le IS NULL AND annulee_le IS NULL`);
  sql(`DELETE FROM platform.adhesions WHERE organisation_id = (SELECT id FROM platform.organisations WHERE slug = 'atelier-demo') AND utilisateur_id = (SELECT id FROM platform.utilisateurs WHERE email = 'autre@demo.test')`);
  const b = await lancer();
  const adm = await connecter("admin@demo.test");
  await adm.goto(`${BASE}/app/membres`);

  etape("liste des membres : « Dernière action ici », plus la dernière connexion à toute la plateforme");
  const entetes = await adm.locator("table.tableau").first().locator("th").allTextContents();
  assert.ok(entetes.includes("Dernière action ici"), entetes.join("|"));
  assert.ok(!entetes.includes("Dernière connexion"));
  assert.equal(await adm.locator('input[name="motDePasseProvisoire"]').count(), 0, "plus de mot de passe provisoire");

  etape("même réponse pour une adresse sans compte et pour une adresse qui a déjà un compte");
  const s = Date.now().toString(36);
  const nouvelle = `nouveau-${s}@demo.test`;
  const r1 = await inviter(adm, nouvelle, `Nouvelle ${s}`, ["REDACTEUR"]);
  const r2 = await inviter(adm, "autre@demo.test", "Autre Personne");
  assert.match(r1.lien, new RegExp(`^${BASE}/invitation/[A-Za-z0-9_-]{43}$`));
  assert.match(r2.lien, new RegExp(`^${BASE}/invitation/[A-Za-z0-9_-]{43}$`));
  assert.equal(r1.message, r2.message);
  console.log(`  message identique : « ${r1.message.slice(0, 60)}… »`);
  assert.equal(sql(`SELECT count(*) FROM platform.adhesions a JOIN platform.utilisateurs u ON u.id = a.utilisateur_id JOIN platform.organisations o ON o.id = a.organisation_id WHERE o.slug = 'atelier-demo' AND u.email = 'autre@demo.test'`), "0", "pas de rattachement d'office");
  const deja = await inviter(adm, "redac@demo.test", "Rita");
  assert.match(deja.message, /déjà membre/);
  assert.equal(deja.lien, null);
  await adm.reload();
  const enAttente = await adm.locator("section", { has: adm.locator('h2:has-text("Invitations en attente")') }).locator("tbody tr").allTextContents();
  assert.ok(enAttente.some((l) => l.includes(nouvelle)) && enAttente.some((l) => l.includes("autre@demo.test")));
  await capture(adm, "invitations-en-attente");

  etape("un autre compte connecté ouvre le lien : il ne peut pas l'accepter");
  const rita = await connecter("redac@demo.test");
  await rita.goto(r1.lien);
  assert.ok(await rita.isVisible("text=Vous êtes connecté avec redac@demo.test"));
  assert.equal(await rita.locator('button:has-text("Accepter")').count(), 0);

  etape("compte existant : se connecter depuis le lien, revenir à l'invitation, accepter, arriver dans l'organisation");
  const autre = await anonyme();
  await autre.goto(r2.lien);
  assert.ok(await autre.isVisible("text=Un compte Jalonia existe déjà pour autre@demo.test"));
  await autre.click('a:has-text("Me connecter pour accepter")');
  await autre.waitForURL(/\/connexion\?suite=/);
  assert.ok(await autre.isVisible("text=Connectez-vous pour accepter l'invitation."));
  await autre.fill('input[name="email"]', "autre@demo.test");
  await autre.fill('input[name="motDePasse"]', MDP);
  await autre.click('button:has-text("Se connecter")');
  await autre.waitForURL(r2.lien);
  await capture(autre, "invitation-compte-existant");
  await autre.click('button:has-text("Accepter l\'invitation")');
  await autre.waitForURL(`${BASE}/app`);
  assert.ok(await autre.isVisible("text=Atelier Démo"), "l'organisation qui a invité est ouverte");

  etape("personne sans compte : crée son compte et arrive dans l'organisation (rédactrice)");
  const neuve = await anonyme();
  await neuve.goto(r1.lien);
  await neuve.fill('input[name="nouveau"]', "phrase-de-passe-choisie");
  await neuve.fill('input[name="confirmation"]', "phrase-de-passe-choisie");
  await neuve.click('button:has-text("Créer mon compte")');
  await neuve.waitForURL(`${BASE}/app`);
  await neuve.goto(`${BASE}/app/documents`);
  assert.ok(await neuve.isVisible('button:has-text("Nouvelle procédure")'), "rôle rédacteur appliqué");

  etape("l'administrateur voit les deux nouveaux membres ; plus d'invitation en attente pour eux");
  await adm.reload();
  const membres = await adm.locator("table.tableau").first().locator("tbody tr").allTextContents();
  assert.ok(membres.some((l) => l.includes(nouvelle)) && membres.some((l) => l.includes("autre@demo.test")));
  const restantes = await adm.locator("section", { has: adm.locator('h2:has-text("Invitations en attente")') }).locator("tbody tr").allTextContents();
  assert.ok(!restantes.some((l) => l.includes(nouvelle) || l.includes("autre@demo.test")), restantes.join("|"));

  etape("annulation : le lien ne fonctionne plus");
  const r3 = await inviter(adm, `annulee-${s}@demo.test`, "À annuler");
  await adm.reload();
  const ligne = adm.locator("section", { has: adm.locator('h2:has-text("Invitations en attente")') }).locator("tbody tr", { hasText: `annulee-${s}@demo.test` });
  await ligne.locator('button:has-text("Annuler")').click();
  await ligne.waitFor({ state: "detached" }); // la ligne disparaît de la liste
  const visiteur = await anonyme();
  await visiteur.goto(r3.lien);
  assert.ok(await visiteur.isVisible("text=n'est pas (ou plus) valable"));
  await visiteur.goto(`${BASE}/invitation/lien-invente`);
  assert.ok(await visiteur.isVisible("text=n'est pas (ou plus) valable"));

  for (const p of [adm, rita, autre, neuve, visiteur]) assert.deepEqual(p.erreurs, [], "erreurs console");
  // Remise en état pour les autres parties (l'autre organisation reste étrangère à l'Atelier).
  sql(`DELETE FROM platform.adhesions WHERE organisation_id = (SELECT id FROM platform.organisations WHERE slug = 'atelier-demo') AND utilisateur_id = (SELECT id FROM platform.utilisateurs WHERE email = 'autre@demo.test')`);
  console.log("  erreurs console : aucune");
  await b.close();
  console.log("✔ partie 6");
})().catch((e) => { console.error(e); process.exit(1); });
