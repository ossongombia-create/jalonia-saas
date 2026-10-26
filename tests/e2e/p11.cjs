// Partie 11 : circuit de validation (W1, W3), dans « Atelier Démo », dans le navigateur.
//   - la rédactrice soumet depuis la page « Validation » ; un éditeur resté ouvert ne peut plus enregistrer (fenêtre
//     « circuit ») ; le document s'ouvre en lecture seule, avec la raison ;
//   - le vérificateur refuse (motif obligatoire, exigé aussi par le navigateur), puis vérifie la version suivante ; il ne
//     peut pas l'approuver (séparation des tâches, expliquée) ; l'approbatrice approuve : publié ;
//   - trace des décisions : version, motif, personne, empreinte SHA-256 identique à celle calculée par PostgreSQL ;
//     mention « pas une signature électronique » ; la lectrice (anglais) consulte sans décider ;
//   - révision : nouveau brouillon, comparaison avec la version publiée ; nouveau cycle, puis archivage (motif).
const { BASE, sql, lancer, connecter, api, editeurPret, attendreEtat, capture, etape, assert } = require("./outils.cjs");

(async () => {
  const b = await lancer();
  const rita = await connecter("redac@demo.test");
  const ctx = (await api(rita, "GET", "/api/editeur/contexte")).corps;
  const org = ctx.organisation.id;
  const schema = sql("SELECT schema_name FROM platform.organisations WHERE slug = 'atelier-demo'");
  const contenu = (titre, libelle) => ({
    meta: { typeDocument: "procedure", titre, reference: "PR-CIR-01" },
    roles: [{ id: "r1", nom: "Qualité" }],
    etapes: [{ id: "e1", roleId: "r1", libelle }],
  });
  const cree = await api(rita, "POST", "/api/documents", { organisationId: org, contenu: contenu("Maîtriser les documents", "Rédiger le projet") });
  assert.equal(cree.statut, 201);
  const id = cree.corps.id;
  const PAGE = `${BASE}/app/documents/${id}/validation`;
  const etatEnBase = () => sql(`SELECT etat || '/' || version || '/' || coalesce(version_publiee::text, '-') FROM "${schema}".documents WHERE id = '${id}'`);
  const empreinteEnBase = () => sql(`SELECT encode(sha256(convert_to(contenu::text, 'UTF8')), 'hex') FROM "${schema}".documents WHERE id = '${id}'`);
  const ligneListe = (p) => p.locator("tbody tr", { has: p.locator(`a[href="/editeur/index.html?doc=${id}"]`) });
  /** Clique une décision de la page de validation (confirmation acceptée) et attend le rechargement sur le nouvel état. */
  async function decider(p, libelle, etatAttendu, motif, fonction = "Responsable QSE") {
    await p.waitForLoadState("networkidle"); // formulaire interactif (la confirmation passe par le script de la page)
    const bloc = p.locator(".decision-possible", { has: p.locator(`button:has-text("${libelle}")`) });
    if (motif !== undefined) await bloc.locator("textarea").fill(motif);
    // Soumettre, vérifier, approuver : fonction obligatoire (TC-03).
    if (await bloc.locator('input[name="fonction"]').count()) await bloc.locator('input[name="fonction"]').fill(fonction);
    let question = "";
    p.once("dialog", (d) => { question = d.message(); d.accept(); });
    await bloc.locator(`button:has-text("${libelle}")`).click();
    await p.waitForURL((u) => u.searchParams.get("etat") === etatAttendu);
    await p.waitForSelector("#decision-enregistree");
    return question;
  }
  const decisions = (p) => p.locator("#decisions tbody tr").evaluateAll((l) => l.map((tr) => [...tr.querySelectorAll("td")].slice(1).map((td) => td.textContent.trim())));

  etape("liste : le document est un brouillon ; page « Validation » depuis la liste");
  await rita.goto(`${BASE}/app/documents`);
  assert.equal(await ligneListe(rita).getAttribute("data-etat"), "brouillon");
  assert.ok((await ligneListe(rita).innerText()).includes("Brouillon"));
  await ligneListe(rita).locator('a:has-text("Validation")').click();
  await rita.waitForURL(PAGE);
  assert.equal(await rita.getAttribute("#etat-circuit", "data-etat"), "brouillon");
  assert.deepEqual(await rita.locator(".decision-possible").evaluateAll((l) => l.map((x) => x.dataset.transition)), ["soumettre"]);
  assert.ok(await rita.isVisible("text=Ce n'est pas une signature électronique : aucune valeur légale n'est revendiquée."));
  assert.ok(await rita.isVisible("text=Aucune décision pour l'instant."));

  etape("un éditeur ouvert sur le brouillon, puis la soumission : l'éditeur ne peut plus enregistrer (raison « circuit »)");
  const editeur = await rita.context().newPage();
  editeur.erreurs = [];
  editeur.on("pageerror", (e) => editeur.erreurs.push("pageerror: " + e.message));
  await editeur.goto(`${BASE}/editeur/index.html?doc=${id}`);
  await editeurPret(editeur);
  assert.equal(await editeur.isVisible("#bandeau-lecture-seule"), false, "brouillon : modifiable");
  // TC-03 : nom (celui du compte, non modifiable) et fonction (obligatoire) ; aucune signature à dessiner.
  const blocSoumettre = rita.locator('.decision-possible[data-transition="soumettre"]');
  assert.equal(await blocSoumettre.locator('[data-champ="nom"]').inputValue(), "Rita Rédactrice");
  assert.equal(await blocSoumettre.locator('[data-champ="nom"]').evaluate((el) => el.readOnly), true, "nom non modifiable");
  assert.equal(await blocSoumettre.locator('input[name="fonction"]').evaluate((el) => el.required), true, "fonction obligatoire");
  assert.equal(await rita.locator("canvas, [data-signature]").count(), 0, "aucun pad de signature");
  const question = await decider(rita, "Soumettre à vérification", "en_verification", "", "Technicienne méthodes");
  assert.equal(question, "Confirmer : « Soumettre à vérification » sur la version 1 ?");
  assert.equal(await rita.textContent("#decision-enregistree"), "Décision enregistrée : le document est maintenant « En vérification ».");
  assert.equal(etatEnBase(), "en_verification/1/-");
  await editeur.click(".liste-etapes li:nth-child(1) button");
  await editeur.locator("textarea").nth(4).click();
  await editeur.keyboard.type(" (modifié après soumission)");
  await editeur.waitForSelector("#fenetre-synchro[open]", { timeout: 15000 });
  assert.match(await editeur.textContent("#synchro-contenu"), /a été soumis au circuit de validation \(ou publié\) entre-temps : il ne se modifie plus/);
  await attendreEtat(editeur, "Non enregistré");
  await capture(editeur, "circuit-editeur-bloque");
  assert.equal(etatEnBase(), "en_verification/1/-", "rien n'a été enregistré");
  assert.deepEqual(editeur.erreurs, []);
  await editeur.close();

  etape("le document soumis s'ouvre en lecture seule, avec la raison ; plus de « Supprimer » dans la liste");
  const lecture = await rita.context().newPage();
  await lecture.goto(`${BASE}/editeur/index.html?doc=${id}`);
  await editeurPret(lecture);
  assert.equal(await lecture.textContent("#etat-synchro"), "Lecture seule");
  assert.match(await lecture.textContent("#bandeau-lecture-seule"), /^Lecture seule : ce document est en vérification \(circuit de validation\)\./);
  await lecture.close();
  await rita.goto(`${BASE}/app/documents`);
  assert.equal(await ligneListe(rita).locator('button:has-text("Supprimer")').count(), 0);
  assert.ok((await ligneListe(rita).innerText()).includes("En vérification"));
  await rita.goto(PAGE);
  assert.ok(await rita.isVisible("text=Aucune décision ne vous revient à cette étape."));
  // (Rédactrice seulement : elle n'a pas le rôle de vérifier, la séparation des tâches n'a donc rien à lui expliquer.)
  assert.equal(await rita.locator(".separation").count(), 0);

  etape("vérificateur : refuser exige un motif (navigateur et serveur) ; refus → brouillon");
  const victor = await connecter("verif@demo.test");
  await victor.goto(PAGE);
  assert.deepEqual(await victor.locator(".decision-possible").evaluateAll((l) => l.map((x) => x.dataset.transition)), ["verifier", "refuser_verification"]);
  const refus = victor.locator(".decision-possible", { has: victor.locator('button:has-text("Refuser")') });
  let demande = false;
  const surveiller = (d) => { demande = true; d.dismiss(); };
  victor.on("dialog", surveiller);
  await refus.locator('button:has-text("Refuser")').click();
  await victor.waitForTimeout(400);
  victor.off("dialog", surveiller);
  assert.equal(demande, false, "motif vide : le navigateur bloque l'envoi avant toute confirmation");
  assert.equal(await refus.locator("textarea").evaluate((el) => el.validity.valueMissing), true);
  await capture(victor, "circuit-verification");
  await decider(victor, "Refuser (retour au brouillon)", "brouillon", "L'étape 1 doit citer le modèle de document.");
  assert.equal(etatEnBase(), "brouillon/1/-");

  etape("nouvelle version, soumise ; le vérificateur vérifie, puis ne peut pas approuver (séparation)");
  assert.equal((await api(rita, "PUT", `/api/documents/${id}`, { organisationId: org, version: 1, contenu: contenu("Maîtriser les documents", "Rédiger le projet selon le modèle MOD-01") })).statut, 200);
  await rita.goto(PAGE);
  // Fonction pré-remplie : la dernière saisie par la personne.
  assert.equal(await rita.locator('.decision-possible[data-transition="soumettre"] input[name="fonction"]').inputValue(), "Technicienne méthodes");
  await decider(rita, "Soumettre à vérification", "en_verification", undefined, "Technicienne méthodes");
  await victor.goto(PAGE);
  await decider(victor, "Vérifié : transmettre à l'approbation", "en_approbation", "Relu : conforme au modèle.");
  assert.ok(await victor.isVisible("text=Aucune décision ne vous revient à cette étape."));
  assert.ok(await victor.isVisible("text=Vous avez vérifié cette version : son approbation revient à une autre personne."));

  etape("approbatrice : approuve et publie ; trace complète, empreinte = celle de PostgreSQL");
  const agathe = await connecter("appro@demo.test");
  await agathe.goto(PAGE);
  assert.deepEqual(await agathe.locator(".decision-possible").evaluateAll((l) => l.map((x) => x.dataset.transition)), ["approuver", "refuser_approbation"]);
  await decider(agathe, "Approuver et publier", "publie", undefined, "Directrice qualité");
  assert.equal(etatEnBase(), "publie/2/2");
  assert.match(await agathe.textContent("#etat-circuit"), /Dernière version publiée : v2, le /);
  const empreinte = empreinteEnBase();
  const lignes = await decisions(agathe);
  console.log("  décisions :", JSON.stringify(lignes.map((l) => l.slice(0, 4))));
  // Colonnes : décision, version, par (nom du compte), fonction (TC-03), motif, empreinte.
  assert.deepEqual(lignes, [
    ["Approuvé et publié", "v2", "Agathe Approbatrice", "Directrice qualité", "—", empreinte],
    ["Vérifié", "v2", "Victor Vérificateur", "Responsable QSE", "Relu : conforme au modèle.", empreinte],
    ["Soumis à vérification", "v2", "Rita Rédactrice", "Technicienne méthodes", "—", empreinte],
    ["Refusé à la vérification", "v1", "Victor Vérificateur", "—", "L'étape 1 doit citer le modèle de document.", lignes[3][5]],
    ["Soumis à vérification", "v1", "Rita Rédactrice", "Technicienne méthodes", "—", lignes[3][5]],
  ]);
  assert.match(lignes[3][5], /^[0-9a-f]{64}$/);
  assert.notEqual(lignes[3][5], empreinte, "la version 1 avait un autre contenu");
  await capture(agathe, "circuit-publie");

  etape("lectrice (anglais) : consulte la page de validation, sans aucune décision");
  const lea = await connecter("lecteur@demo.test");
  await lea.goto(PAGE);
  assert.ok(await lea.isVisible("h1:has-text('Document approval')"));
  assert.ok(await lea.isVisible("text=No decision is yours at this stage."));
  assert.ok(await lea.isVisible("text=This is not an electronic signature: no legal value is claimed."));
  assert.equal(await lea.locator(".decision-possible").count(), 0);
  assert.equal(await lea.locator("#decisions tbody tr").count(), 5);

  etape("révision : nouveau brouillon ; la version publiée reste connue ; comparaison avec elle");
  await rita.goto(`${BASE}/app/documents`);
  assert.ok((await ligneListe(rita).innerText()).includes("Publié"));
  await rita.goto(PAGE);
  await decider(rita, "Réviser (nouveau brouillon)", "brouillon");
  assert.equal(etatEnBase(), "brouillon/2/2");
  assert.equal(await rita.locator("#comparer-publiee").count(), 0, "même version que la publiée : rien à comparer");
  assert.equal((await api(rita, "PUT", `/api/documents/${id}`, { organisationId: org, version: 2, contenu: contenu("Maîtriser les documents", "Rédiger le projet selon le modèle MOD-02") })).statut, 200);
  await rita.goto(`${BASE}/app/documents`);
  assert.ok((await ligneListe(rita).innerText()).includes("publiée : v2"));
  await rita.goto(PAGE);
  await rita.click("#comparer-publiee");
  await rita.waitForSelector("#differences");
  assert.ok(await rita.isVisible("text=Comparaison : v2 → v3"));
  const diff = await rita.locator("#differences tbody tr").evaluateAll((l) => l.map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent.trim())));
  assert.deepEqual(diff, [["Instructions › instruction 1 « Rédiger le projet selon le modèle MOD-02 » › Libellé", "Modifié", "Rédiger le projet selon le modèle MOD-01", "Rédiger le projet selon le modèle MOD-02"]]);
  assert.ok((await rita.locator('#versions tr[data-version="2"]').innerText()).includes("publiée"));

  etape("nouveau cycle, puis archivage (motif obligatoire) : lecture seule définitive");
  await rita.goto(PAGE);
  // Fonction pré-remplie : la dernière saisie par la personne.
  assert.equal(await rita.locator('.decision-possible[data-transition="soumettre"] input[name="fonction"]').inputValue(), "Technicienne méthodes");
  await decider(rita, "Soumettre à vérification", "en_verification", undefined, "Technicienne méthodes");
  await victor.goto(PAGE);
  await decider(victor, "Vérifié : transmettre à l'approbation", "en_approbation");
  await agathe.goto(PAGE);
  await decider(agathe, "Approuver et publier", "publie");
  assert.equal(etatEnBase(), "publie/3/3");
  await agathe.goto(PAGE);
  assert.deepEqual(await agathe.locator(".decision-possible").evaluateAll((l) => l.map((x) => x.dataset.transition)), ["archiver", "confirmer_revue"]);
  await decider(agathe, "Archiver", "archive", "Remplacée par la procédure PR-CIR-02.");
  assert.equal(etatEnBase(), "archive/3/3");
  assert.ok(await agathe.isVisible("text=Aucune décision ne vous revient à cette étape."));
  await rita.goto(PAGE);
  assert.equal(await rita.locator(".decision-possible").count(), 0, "plus rien à décider, même pour la rédactrice");
  await rita.goto(`${BASE}/editeur/index.html?doc=${id}`);
  await editeurPret(rita);
  assert.match(await rita.textContent("#bandeau-lecture-seule"), /^Lecture seule : ce document est archivé\./);
  await capture(rita, "circuit-archive");

  for (const p of [rita, victor, agathe, lea]) assert.deepEqual(p.erreurs, [], "erreurs console");
  console.log("  erreurs console : aucune");
  await b.close();
  console.log("✔ partie 11");
})().catch((e) => { console.error(e); process.exit(1); });
