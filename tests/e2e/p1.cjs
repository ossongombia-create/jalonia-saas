// Partie 1 : une rédactrice crée une procédure, la saisie s'enregistre seule sur le serveur, rechargement, exemple, Word.
const { BASE, SORTIE, fichierEtat, lancer, connecter, api, editeurPret, attendreEtat, capture, etape, assert } = require("./outils.cjs");
const fs = require("node:fs");
(async () => {
  const b = await lancer();
  const p = await connecter("redac@demo.test");
  etape("accueil de l'organisation : lien Documents, modules disponibles");
  assert.equal(new URL(p.url()).pathname, "/app");
  assert.ok(await p.isVisible('nav a[href="/app/documents"]'));
  await p.click('nav a[href="/app/documents"]');
  await p.waitForURL(`${BASE}/app/documents`);
  assert.ok(await p.isVisible('text=Aucun document pour l\'instant.'));
  assert.ok(await p.isVisible('text=Pas encore enregistrée.'));
  await capture(p, "documents-vide");

  etape("Nouvelle procédure → l'éditeur s'ouvre sur le document créé");
  await p.click('button:has-text("Nouvelle procédure")');
  await p.waitForURL(/\/editeur\/index\.html\?doc=[0-9a-f-]{36}$/);
  const docId = new URL(p.url()).searchParams.get("doc");
  await editeurPret(p);
  await attendreEtat(p, "Enregistré");
  assert.ok(await p.isVisible("#lien-documents"));
  assert.equal(await p.isVisible("#btn-retour"), false, "pas de bouton de retour d'essai en ligne");
  assert.equal(await p.isVisible("#lien-guide"), false);
  await capture(p, "editeur-ouvert");

  etape("saisie de l'intitulé et du code → « Enregistré » sur le serveur, sans brouillon dans le navigateur");
  await p.fill('textarea[aria-label="Intitulé de la procédure"]', "Réceptionner les achats");
  await p.fill('textarea[aria-label="Code envisagé"]', "PR-ACH-01");
  await p.waitForFunction(() => /Modifié|Enregistrement/.test(document.querySelector("#etat-synchro").textContent));
  await attendreEtat(p, "Enregistré");
  let ctx = await api(p, "GET", `/api/editeur/contexte?doc=${docId}`);
  assert.equal(ctx.statut, 200);
  assert.equal(ctx.corps.document.contenu.meta.titre, "Réceptionner les achats");
  assert.equal(ctx.corps.document.contenu.meta.reference, "PR-ACH-01");
  assert.deepEqual(ctx.corps.droits, { rediger: true, supprimer: true, cartographie: true });
  const versionApresSaisie = ctx.corps.document.version;
  assert.ok(versionApresSaisie >= 2);
  const stockage = await p.evaluate(() => Object.keys(localStorage).filter((k) => /brouillon|cartographie|enregistre|modifie/.test(k)));
  assert.deepEqual(stockage, [], "en ligne, aucun brouillon ni cartographie dans le navigateur");
  await capture(p, "saisie-enregistree");

  etape("rechargement de la page : le document revient du serveur");
  await p.reload();
  await editeurPret(p);
  assert.equal(await p.inputValue('textarea[aria-label="Intitulé de la procédure"]'), "Réceptionner les achats");
  assert.equal(await p.textContent("#etat-synchro"), "Enregistré");

  etape("menu Fichier : Nouvelle cachée, copie .json proposée ; exemple de procédure chargé et enregistré");
  await p.click("#btn-fichier");
  assert.equal(await p.isVisible("#btn-nouvelle"), false);
  assert.ok(await p.isVisible("#btn-copie-json"));
  p.once("dialog", (d) => d.accept());
  await p.click("#btn-exemple");
  await attendreEtat(p, "Enregistré");
  ctx = await api(p, "GET", `/api/editeur/contexte?doc=${docId}`);
  const titreExemple = ctx.corps.document.contenu.meta.titre;
  assert.ok(titreExemple && titreExemple !== "Réceptionner les achats", "l'exemple a remplacé le contenu sur le serveur");
  assert.ok(ctx.corps.document.contenu.etapes.length >= 5);
  fs.writeFileSync(fichierEtat("doc-id.txt"), docId);
  console.log("  exemple :", titreExemple, "·", ctx.corps.document.contenu.etapes.length, "instructions · version", ctx.corps.document.version);

  etape("copie .json téléchargée");
  await p.click("#btn-fichier");
  const [tel] = await Promise.all([p.waitForEvent("download"), p.click("#btn-copie-json")]);
  const chemin = SORTIE + "/copie.json";
  await tel.saveAs(chemin);
  const copie = JSON.parse(fs.readFileSync(chemin, "utf8"));
  assert.equal(copie.procedure.meta.titre, titreExemple);

  console.log("  erreurs console :", p.erreurs.length ? p.erreurs : "aucune");
  assert.deepEqual(p.erreurs, []);
  await b.close();
  console.log("✔ partie 1");
})().catch((e) => { console.error(e); process.exit(1); });
