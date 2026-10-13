// Sonde CSP : visite toutes les pages (superadmin, administrateur d'organisation, rédactrice, lectrice) et relève
// toute violation de la politique de sécurité du contenu (événement securitypolicyviolation) et toute erreur console.
const { BASE, SUPERADMIN, lancer, connecter, etape, assert } = require("./outils.cjs");
(async () => {
  const b = await lancer();
  const bilan = [];
  async function visiter(email, chemins) {
    const p = await connecter(email);
    await p.context().addInitScript(() => {
      window.__violations = [];
      document.addEventListener("securitypolicyviolation", (e) => window.__violations.push(`${e.violatedDirective} ${e.blockedURI}`));
    });
    for (const chemin of chemins) {
      const r = await p.goto(`${BASE}${chemin}`);
      await p.waitForLoadState("networkidle");
      const csp = r.headers()["content-security-policy"] || "";
      const violations = await p.evaluate(() => window.__violations);
      const scripts = await p.evaluate(() => [...document.scripts].map((s) => s.nonce ? "nonce" : (s.src || "en ligne")));
      // Sans nonce, seuls sont admis les fichiers de l'application ajoutés par un script de confiance (« strict-dynamic ») :
      // aucun script EN LIGNE, aucun script d'une autre origine.
      const sansNonce = scripts.filter((s) => s !== "nonce" && !s.startsWith(`${BASE}/_next/static/`) && !s.startsWith(`${BASE}/editeur/`));
      bilan.push({ email, chemin, statut: r.status(), csp: csp.split(";")[0], violations, sansNonce });
      assert.ok(csp.startsWith(chemin.startsWith("/editeur/") ? "script-src 'self';" : "script-src 'self' 'nonce-"), `${chemin} : CSP ${csp}`);
      assert.deepEqual(violations, [], `${chemin} : violations`);
      assert.deepEqual(sansNonce, [], `${chemin} : scripts sans nonce`);
    }
    assert.deepEqual(p.erreurs, [], `${email} : erreurs console`);
    return p;
  }
  etape("superadmin : toutes les pages de la plateforme");
  const sa = await connecter(SUPERADMIN.email);
  await sa.goto(`${BASE}/plateforme/organisations`);
  const org = await sa.getAttribute('a[href^="/plateforme/organisations/"]:not([href$="nouvelle"])', "href");
  await sa.goto(`${BASE}/plateforme/utilisateurs`);
  const util = await sa.getAttribute('a[href^="/plateforme/utilisateurs/"]', "href");
  await sa.context().close();
  await visiter(SUPERADMIN.email, ["/plateforme", "/plateforme/organisations", org, "/plateforme/organisations/nouvelle", "/plateforme/utilisateurs", util, "/plateforme/sessions", "/plateforme/journal", "/plateforme/droits", "/compte/mot-de-passe", "/compte/second-facteur"]);
  etape("administrateur d'organisation : accueil, membres, journal, documents, éditeur, compte");
  await visiter("admin@demo.test", ["/app", "/app/membres", "/app/journal", "/app/documents", "/editeur/index.html", "/compte/mot-de-passe", "/compte/second-facteur"]);
  etape("rédactrice et lectrice : documents et éditeur");
  await visiter("redac@demo.test", ["/app", "/app/documents", "/editeur/index.html"]);
  await visiter("lecteur@demo.test", ["/app", "/app/documents"]);
  etape("page d'invitation (sans session), avec un vrai lien");
  const adm = await connecter("admin@demo.test");
  await adm.goto(`${BASE}/app/membres`);
  const form = adm.locator("section", { has: adm.locator('h2:has-text("Inviter une personne")') }).locator("form");
  await form.locator('input[name="email"]').fill(`csp-${Date.now().toString(36)}@demo.test`);
  await form.locator('input[name="nom"]').fill("Sonde CSP");
  await form.locator('button[type="submit"]').click();
  await form.locator(".lien-a-copier input").waitFor();
  const lienInvitation = await form.locator(".lien-a-copier input").inputValue();
  const ctxInv = await b.newContext();
  await ctxInv.addInitScript(() => {
    window.__violations = [];
    document.addEventListener("securitypolicyviolation", (e) => window.__violations.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  const pageInv = await ctxInv.newPage();
  const ri = await pageInv.goto(lienInvitation);
  await pageInv.waitForLoadState("networkidle");
  assert.ok((ri.headers()["content-security-policy"] || "").startsWith("script-src 'self' 'nonce-"));
  assert.equal(ri.headers()["referrer-policy"], "strict-origin-when-cross-origin");
  assert.equal(await pageInv.getAttribute('meta[name="referrer"]', "content"), "no-referrer");
  assert.deepEqual(await pageInv.evaluate(() => window.__violations), []);
  bilan.push({ email: "(sans session)", chemin: "/invitation/…", statut: ri.status(), csp: ri.headers()["content-security-policy"].split(";")[0], violations: [], sansNonce: [] });

  etape("page de connexion (sans session)");
  const ctx = await b.newContext();
  const anonyme = await ctx.newPage();
  const r = await anonyme.goto(`${BASE}/connexion`);
  assert.ok((r.headers()["content-security-policy"] || "").startsWith("script-src 'self' 'nonce-"));
  for (const l of bilan) console.log(`  ${l.statut} ${l.chemin.padEnd(48)} ${l.csp.slice(0, 40)}… violations=${l.violations.length} sans-nonce=${l.sansNonce.length}`);
  await b.close();
  console.log(`✔ sonde CSP : ${bilan.length} pages, aucune violation`);
})().catch((e) => { console.error(e); process.exit(1); });
