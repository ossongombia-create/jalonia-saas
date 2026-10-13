// Partie 9 : échange BPMN 2.0 dans l'éditeur en ligne (D3), dans l'organisation « Autre Organisation ».
//   - étape 4 « Génération » : « Exporter en BPMN 2.0 » télécharge exactement le fichier que produit le module bpmn.js ;
//   - Fichier → « Importer un BPMN 2.0 » dans une procédure neuve : rapport affiché, procédure reprise SANS PERTE et
//     enregistrée sur le serveur ;
//   - import d'un BPMN venu d'un autre outil : sous-ensemble repris, rapport des éléments non repris.
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { BASE, SORTIE, lancer, connecter, api, editeurPret, attendreEtat, capture, etape, assert } = require("./outils.cjs");

const charger = (chemin) => import(pathToFileURL(path.resolve(__dirname, "../..", chemin)).href);

(async () => {
  const [{ versBpmn }, { nettoyer }, { VERSION }, { signatureContenu }, { exempleProcedure }] = await Promise.all([
    charger("editeur/js/bpmn.js"), charger("editeur/js/store.js"), charger("editeur/js/version.js"), charger("editeur/js/model.js"),
    charger("editeur/js/exemple-procedure.js"),
  ]);
  const b = await lancer();
  const p = await connecter("autre@demo.test");
  p.on("dialog", (d) => d.accept()); // « remplacer le document ? » avant un import
  const org = (await api(p, "GET", "/api/editeur/contexte")).corps.organisation.id;
  const creer = async (contenu) => {
    const r = await api(p, "POST", "/api/documents", { organisationId: org, contenu });
    assert.equal(r.statut, 201, JSON.stringify(r.corps));
    return r.corps.id;
  };
  const contenuDe = async (id) => (await api(p, "GET", `/api/editeur/contexte?doc=${id}`)).corps.document.contenu;

  etape("export : étape 4, « Exporter en BPMN 2.0 » — le fichier téléchargé est celui du module, octet pour octet");
  // L'exemple de l'éditeur (complet), synthèse validée : l'étape 4 est ouverte. (L'aller-retour d'une procédure qui utilise
  // tout le modèle est vérifié par editeur/tests/bpmn.test.mjs.)
  const original = exempleProcedure();
  original.validation = signatureContenu(nettoyer(original));
  const idSource = await creer(original);
  await p.goto(`${BASE}/editeur/index.html?doc=${idSource}`);
  await editeurPret(p);
  await p.click(".liste-etapes li:nth-child(4) button");
  const [telechargement] = await Promise.all([p.waitForEvent("download"), p.click('button:has-text("Exporter en BPMN 2.0")')]);
  assert.equal(telechargement.suggestedFilename(), "PR-REA-01_V0.bpmn");
  const cheminBpmn = path.join(SORTIE, telechargement.suggestedFilename());
  await telechargement.saveAs(cheminBpmn);
  const xml = fs.readFileSync(cheminBpmn, "utf8");
  assert.equal(xml, versBpmn(nettoyer(await contenuDe(idSource)), { versionApplication: VERSION }));
  assert.ok(xml.includes("<bpmn:definitions") && xml.includes("<bpmn:laneSet"));
  console.log(`  ${telechargement.suggestedFilename()} : ${xml.length} caractères`);
  await capture(p, "bpmn-export");

  etape("import dans une procédure neuve : rapport, puis la procédure enregistrée sur le serveur est identique à l'originale");
  const idCopie = await creer({ meta: { typeDocument: "procedure" }, roles: [], etapes: [] });
  await p.goto(`${BASE}/editeur/index.html?doc=${idCopie}`);
  await editeurPret(p);
  await p.click("#btn-fichier");
  const [choix] = await Promise.all([p.waitForEvent("filechooser"), p.click("#btn-importer-bpmn")]);
  await choix.setFiles(cheminBpmn);
  await p.waitForSelector("#rapport-import:not([hidden])");
  assert.equal(await p.textContent("#rapport-import h3"), "Import BPMN 2.0 : ce qui a été lu");
  const lignes = await p.locator("#rapport-liste li").allTextContents();
  assert.equal(lignes.length, 1, JSON.stringify(lignes));
  assert.match(lignes[0], /^Fichier BPMN exporté par Jalonia : la procédure est reprise avec toutes ses informations \(4 rôle\(s\), 8 instruction\(s\)\)/);
  await attendreEtat(p, "Enregistré");
  assert.deepEqual(nettoyer(await contenuDe(idCopie)), nettoyer(original), "procédure reprise sans perte");
  await capture(p, "bpmn-import-jalonia");

  etape("import d'un BPMN d'un autre outil : sous-ensemble repris, éléments non repris listés");
  const idAutre = await creer({ meta: { typeDocument: "procedure" }, roles: [], etapes: [] });
  await p.goto(`${BASE}/editeur/index.html?doc=${idAutre}`);
  await editeurPret(p);
  await p.click("#btn-fichier");
  const [choix2] = await Promise.all([p.waitForEvent("filechooser"), p.click("#btn-importer-bpmn")]);
  await choix2.setFiles(path.resolve(__dirname, "../../editeur/tests/fixtures/autre-outil.bpmn"));
  await p.waitForSelector("#rapport-import:not([hidden])");
  const rapport = await p.locator("#rapport-liste li").allTextContents();
  assert.match(rapport[0], /^BPMN sans informations Jalonia : seul le sous-ensemble standard est repris \(2 rôle\(s\), 4 instruction\(s\)\)/);
  const nonRepris = rapport.find((l) => l.startsWith("Non repris :"));
  assert.ok(nonRepris && nonRepris.includes("événement de bordure (1)") && nonRepris.includes("objet de données (2)"), nonRepris);
  await attendreEtat(p, "Enregistré");
  const autre = await contenuDe(idAutre);
  assert.equal(autre.meta.titre, "Traiter une réclamation");
  assert.deepEqual(autre.etapes.map((e) => e.libelle), ["Enregistrer la réclamation", "Analyser la réclamation", "Répondre au client", "Ouvrir une action corrective"]);
  await capture(p, "bpmn-import-autre-outil");

  etape("fichier refusé (pas un BPMN) : rien n'est remplacé");
  const pasBpmn = path.join(SORTIE, "pas-un-bpmn.xml");
  fs.writeFileSync(pasBpmn, '<?xml version="1.0"?><note>pas un BPMN</note>');
  await p.click("#btn-fichier");
  const [choix3] = await Promise.all([p.waitForEvent("filechooser"), p.click("#btn-importer-bpmn")]);
  await choix3.setFiles(pasBpmn);
  await p.waitForFunction(() => document.querySelector("#rapport-liste li.erreur"));
  assert.match(await p.textContent("#rapport-liste li.erreur"), /n'est pas un BPMN 2\.0/);
  assert.deepEqual((await contenuDe(idAutre)).etapes.map((e) => e.libelle), autre.etapes.map((e) => e.libelle));

  etape("nettoyage : les trois procédures d'essai");
  await p.goto(`${BASE}/app/documents`);
  for (const id of [idSource, idCopie, idAutre]) {
    const fin = p.waitForResponse((r) => r.request().method() === "POST" && r.url().startsWith(`${BASE}/app/documents`));
    await p.locator("tbody tr", { has: p.locator(`a[href="/editeur/index.html?doc=${id}"]`) }).locator('button:has-text("Supprimer")').click();
    await fin;
  }
  await p.waitForFunction((ids) => ids.every((id) => !document.querySelector(`a[href="/editeur/index.html?doc=${id}"]`)), [idSource, idCopie, idAutre]);

  console.log("  erreurs console :", p.erreurs.length ? p.erreurs : "aucune");
  assert.deepEqual(p.erreurs, []);
  await b.close();
  console.log("✔ partie 9");
})().catch((e) => { console.error(e); process.exit(1); });
