// Partie 7 : second facteur (audit S3).
//   - superadmin : enrôlement obligatoire à la connexion (code QR vérifié), codes de secours, code demandé ensuite ;
//   - session en attente : aucune page, aucune API ; « Annuler » ;
//   - compte ordinaire : activation facultative, connexion avec code, désactivation ; retrait par le superadmin.
const { BASE, MDP, SORTIE, SUPERADMIN, sql, lancer, anonyme, connecter, codeTotp, pasCourant, codeFrais, noterSecret, oublierSecret, capture, etape, assert } = require("./outils.cjs");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

async function seConnecter(page, email, motDePasse) {
  await page.goto(`${BASE}/connexion`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="motDePasse"]', motDePasse);
  await page.click('button:has-text("Se connecter")');
  await page.waitForURL((u) => u.pathname !== "/connexion" && u.pathname !== "/");
}

(async () => {
  // Rejouable : le superadmin et la rédactrice repartent sans second facteur (comme après la ligne de commande).
  sql(`UPDATE platform.utilisateurs SET mfa_active_le = NULL, mfa_secret_chiffre = NULL, mfa_dernier_pas = NULL, echecs_mfa = 0, verrouille_jusqua = NULL WHERE email IN ('${SUPERADMIN.email}', 'redac2@demo.test')`);
  sql(`DELETE FROM platform.codes_secours WHERE utilisateur_id IN (SELECT id FROM platform.utilisateurs WHERE email IN ('${SUPERADMIN.email}', 'redac2@demo.test'))`);
  oublierSecret(SUPERADMIN.email);
  oublierSecret("redac2@demo.test");
  const b = await lancer();

  etape("superadmin sans second facteur : le mot de passe mène à l'enrôlement obligatoire, rien d'autre n'est ouvert");
  const sa = await anonyme();
  await sa.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
  await seConnecter(sa, SUPERADMIN.email, SUPERADMIN.mdp);
  assert.equal(new URL(sa.url()).pathname, "/connexion/second-facteur");
  assert.ok(await sa.isVisible("text=Activez votre second facteur"));
  const r = await sa.request.get(`${BASE}/api/editeur/contexte`);
  assert.equal(r.status(), 401, "API fermée tant que le code n'est pas donné");
  await sa.goto(`${BASE}/plateforme`);
  assert.equal(new URL(sa.url()).pathname, "/connexion/second-facteur", "toute page ramène au code");

  etape("le code QR contient bien la clé affichée (décodage de l'image)");
  const secret = await sa.getAttribute(".secret-totp", "data-secret");
  assert.match(secret, /^[A-Z2-7]{32}$/);
  const image = path.join(SORTIE, "qr-superadmin.png");
  await sa.locator("img.qr-totp").screenshot({ path: image });
  if (process.env.E2E_SANS_QR === "1") {
    // Décodage impossible sans OpenCV (python3 + opencv-python-headless) : on le dit, on ne le tait pas.
    console.log("  ⚠ code QR NON décodé (E2E_SANS_QR=1) : seule la clé affichée est vérifiée");
  } else {
    const lu = execFileSync("python3", ["-c", "import cv2,sys; v,_,_=cv2.QRCodeDetector().detectAndDecode(cv2.resize(cv2.imread(sys.argv[1]),None,fx=3,fy=3,interpolation=cv2.INTER_NEAREST)); print(v)", image], { encoding: "utf8" }).trim();
    const adresse = new URL(lu);
    assert.equal(adresse.protocol, "otpauth:");
    assert.equal(adresse.searchParams.get("secret"), secret);
    assert.equal(adresse.searchParams.get("issuer"), "Jalonia");
    console.log(`  code QR décodé : ${lu.replace(secret, "…")}`);
  }
  await capture(sa, "superadmin-enrolement");

  etape("mauvais code refusé ; bon code : 10 codes de secours affichés une fois, copiables ; « continuer » ouvre la plateforme");
  await sa.fill('input[name="code"]', "000000");
  await sa.click('button:has-text("Activer")');
  await sa.waitForSelector(".message-erreur");
  await sa.fill('input[name="code"]', codeTotp(secret, pasCourant()));
  await sa.click('button:has-text("Activer")');
  await sa.waitForSelector(".liste-codes code");
  const codes = await sa.locator(".liste-codes code").allTextContents();
  assert.equal(codes.length, 10);
  noterSecret(SUPERADMIN.email, secret, codes);
  await sa.click('.codes-secours button:has-text("Copier")');
  assert.equal(await sa.evaluate(() => navigator.clipboard.readText()), codes.join("\n"));
  await capture(sa, "superadmin-codes-secours");
  await sa.click('a:has-text("continuer")');
  await sa.waitForURL(`${BASE}/plateforme`);

  etape("nouvelle connexion du superadmin : code faux refusé, code de secours accepté une fois ; « Annuler » revient à la connexion");
  const sa2 = await anonyme();
  await seConnecter(sa2, SUPERADMIN.email, SUPERADMIN.mdp);
  assert.ok(await sa2.isVisible("text=Code de vérification"));
  await sa2.click('button:has-text("Annuler")');
  await sa2.waitForURL(`${BASE}/connexion`);
  assert.ok(await sa2.isVisible('input[name="motDePasse"]'));
  await seConnecter(sa2, SUPERADMIN.email, SUPERADMIN.mdp);
  await sa2.fill('input[name="code"]', "111111");
  await sa2.click('button:has-text("Valider")');
  await sa2.waitForSelector(".message-erreur");
  assert.match(await sa2.textContent(".message-erreur"), /Code incorrect/);
  await sa2.fill('input[name="code"]', codes[0].toUpperCase());
  await sa2.click('button:has-text("Valider")');
  await sa2.waitForURL(`${BASE}/plateforme`);
  const sa3 = await anonyme();
  await seConnecter(sa3, SUPERADMIN.email, SUPERADMIN.mdp);
  await sa3.fill('input[name="code"]', codes[0]);
  await sa3.click('button:has-text("Valider")');
  await sa3.waitForSelector(".message-erreur");
  await sa3.fill('input[name="code"]', await codeFrais(SUPERADMIN.email));
  await sa3.click('button:has-text("Valider")');
  await sa3.waitForURL(`${BASE}/plateforme`);
  await sa3.goto(`${BASE}/compte/second-facteur`);
  assert.ok(await sa3.isVisible("text=Codes de secours encore utilisables : 9"));
  assert.equal(await sa3.locator('button:has-text("Désactiver")').count(), 0, "obligatoire pour un superadmin");

  etape("compte ordinaire : activation depuis « Mon second facteur », puis connexion avec code, puis désactivation");
  const remi = await connecter("redac2@demo.test");
  await remi.click('a:has-text("Mon second facteur")');
  await remi.waitForURL(`${BASE}/compte/second-facteur`);
  const secretRemi = await remi.getAttribute(".secret-totp", "data-secret");
  await remi.fill('input[name="code"]', codeTotp(secretRemi, pasCourant()));
  await remi.click('button:has-text("Activer")');
  await remi.waitForSelector(".liste-codes code");
  noterSecret("redac2@demo.test", secretRemi, await remi.locator(".liste-codes code").allTextContents());
  await remi.click('a:has-text("continuer")');
  await remi.waitForSelector("text=Second facteur activé. Codes de secours encore utilisables : 10.");
  const remi2 = await anonyme();
  await seConnecter(remi2, "redac2@demo.test", MDP);
  assert.equal(new URL(remi2.url()).pathname, "/connexion/second-facteur");
  await remi2.fill('input[name="code"]', await codeFrais("redac2@demo.test"));
  await remi2.click('button:has-text("Valider")');
  await remi2.waitForURL(`${BASE}/app`);
  await remi2.goto(`${BASE}/compte/second-facteur`);
  await remi2.fill('form:has(button:has-text("Désactiver")) input[name="code"]', "000000");
  await remi2.click('button:has-text("Désactiver")');
  await remi2.waitForSelector("text=Code incorrect");
  await remi2.fill('form:has(button:has-text("Désactiver")) input[name="code"]', await codeFrais("redac2@demo.test"));
  await remi2.click('button:has-text("Désactiver")');
  await remi2.waitForSelector(".secret-totp"); // la page propose de nouveau l'activation
  oublierSecret("redac2@demo.test");

  etape("le superadmin retire le second facteur d'un compte (téléphone perdu) : tracé, sessions fermées");
  await remi2.goto(`${BASE}/compte/second-facteur`);
  const secretRemi2 = await remi2.getAttribute(".secret-totp", "data-secret");
  await remi2.fill('input[name="code"]', codeTotp(secretRemi2, pasCourant() + 1));
  await remi2.click('button:has-text("Activer")');
  await remi2.waitForSelector(".liste-codes code");
  const idRemi = sql(`SELECT id FROM platform.utilisateurs WHERE email = 'redac2@demo.test'`);
  await sa3.goto(`${BASE}/plateforme/utilisateurs/${idRemi}`);
  assert.ok(await sa3.isVisible("text=Second facteur activé"));
  sa3.once("dialog", (d) => d.accept());
  await sa3.click('button:has-text("Retirer le second facteur")');
  await sa3.waitForSelector("text=Sans second facteur");
  await remi2.goto(`${BASE}/app`);
  assert.equal(new URL(remi2.url()).pathname, "/connexion", "sessions de la personne fermées");
  assert.equal(sql(`SELECT count(*) FROM platform.journal WHERE action = 'SECOND_FACTEUR_REINITIALISE' AND cible_id = '${idRemi}'`) >= "1", true);

  for (const p of [sa, sa2, sa3, remi, remi2]) assert.deepEqual(p.erreurs, [], "erreurs console");
  console.log("  erreurs console : aucune");
  await b.close();
  console.log("✔ partie 7");
})().catch((e) => { console.error(e); process.exit(1); });
