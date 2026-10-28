// Partie 14 : matrice de recette TC-01 à TC-10 (exigences du 26/10/2026), dans « Atelier Démo », dans le navigateur.
//   TC-01 sauvegarde automatique : rédiger, attendre 30 s sans cliquer, rafraîchir → le texte est là ;
//   TC-02 verrouillage : document soumis → lecture seule, boutons de rédaction visibles mais désactivés ;
//   TC-03 validation sans signature : nom (celui du compte, non modifiable) + fonction, aucun pad de signature ;
//   TC-04 une instruction de travail suit exactement le circuit des procédures ;
//   TC-05 refus : bloqué sans commentaire ; avec commentaire → brouillon ;
//   TC-06 séparation des tâches : l'auteur n'a aucun bouton de décision ;
//   TC-07 PDF d'un document approuvé : en-tête de l'organisation, noms / fonctions / dates du circuit, visa vide ;
//         avant approbation : mention « PROJET — non approuvé » et tableau vide ;
//   TC-08 tableau de bord : cycle de vie, risques / opportunités, objectifs, quel que soit le rôle ;
//   TC-09 et TC-10 (cartographie unique, libellés sans « (.json) », plus aucune « version d'essai ») : ici pour
//         l'affichage ; le blocage d'une seconde cartographie est éprouvé par la partie 2.
const { BASE, sql, lancer, connecter, api, editeurPret, capture, etape, assert } = require("./outils.cjs");

(async () => {
  const b = await lancer();
  const rita = await connecter("redac@demo.test");
  const victor = await connecter("verif@demo.test");
  const agathe = await connecter("appro@demo.test");
  const lea = await connecter("lecteur@demo.test");
  const org = (await api(rita, "GET", "/api/editeur/contexte")).corps.organisation.id;
  const schema = sql("SELECT schema_name FROM platform.organisations WHERE slug = 'atelier-demo'");
  const contenu = (type, titre, reference) => ({
    meta: { typeDocument: type, titre, reference },
    roles: [{ id: "r1", nom: "Qualité" }],
    etapes: [{ id: "e1", roleId: "r1", libelle: "Contrôler la pièce" }],
  });
  const creer = async (type, titre, reference) => {
    const r = await api(rita, "POST", "/api/documents", { organisationId: org, contenu: contenu(type, titre, reference) });
    assert.equal(r.statut, 201);
    return r.corps.id;
  };
  const etat = (id) => sql(`SELECT etat FROM "${schema}".documents WHERE id = '${id}'`);
  /** Une décision depuis la page « Validation » (fonction saisie si l'étape la demande, confirmation acceptée). */
  async function decider(p, id, transition, { fonction = "Responsable QSE", motif } = {}) {
    await p.goto(`${BASE}/app/documents/${id}/validation`);
    await p.waitForLoadState("networkidle");
    const bloc = p.locator(`.decision-possible[data-transition="${transition}"]`);
    if (await bloc.locator('input[name="fonction"]').count()) await bloc.locator('input[name="fonction"]').fill(fonction);
    if (motif !== undefined) await bloc.locator("textarea").fill(motif);
    // Soumettre : vérificateur et approbateur désignés (Victor, Agathe).
    for (const [champ, nom] of [["verificateur", "Victor Vérificateur"], ["approbateur", "Agathe Approbatrice"]]) {
      if (await bloc.locator(`select[name="${champ}"]`).count()) await bloc.locator(`select[name="${champ}"]`).selectOption({ label: nom });
    }
    p.once("dialog", (d) => d.accept());
    await bloc.locator("button[type=submit]").click();
    await p.waitForURL((u) => u.searchParams.has("etat"));
  }
  /** Le document tel qu'il serait imprimé (PDF) : « beforeprint » prépare la zone d'impression. */
  async function impression(p) {
    return p.evaluate(() => {
      window.dispatchEvent(new Event("beforeprint"));
      const zone = document.getElementById("zone-impression");
      const tableau = zone.querySelector(".tab-validation");
      const lignes = tableau ? [...tableau.querySelectorAll("tr")].map((tr) => [...tr.children].map((c) => c.textContent.trim())) : [];
      const r = { texte: zone.textContent, lignes, projet: zone.querySelector(".filigrane-projet")?.textContent ?? null };
      window.dispatchEvent(new Event("afterprint"));
      return r;
    });
  }

  etape("TC-01 : rédiger, attendre 30 s sans rien cliquer, rafraîchir → le texte est sauvegardé");
  const brouillon = await creer("procedure", "Contrôler les pièces", "PR-REC-01");
  const page = await rita.context().newPage();
  await page.goto(`${BASE}/editeur/index.html?doc=${brouillon}`);
  await editeurPret(page);
  const titre = page.getByLabel("Intitulé de la procédure");
  await titre.fill("Contrôler les pièces reçues (TC-01)");
  await page.waitForTimeout(30_000);
  await page.reload();
  await editeurPret(page);
  assert.equal(await page.getByLabel("Intitulé de la procédure").inputValue(), "Contrôler les pièces reçues (TC-01)");
  assert.equal(sql(`SELECT contenu->'meta'->>'titre' FROM "${schema}".documents WHERE id = '${brouillon}'`), "Contrôler les pièces reçues (TC-01)");

  etape("TC-07 (projet) : avant approbation, l'impression porte « PROJET — non approuvé » et un tableau de validation vide");
  const imprimeProjet = await impression(page);
  assert.equal(imprimeProjet.projet, "PROJET — non approuvé");
  assert.ok(imprimeProjet.texte.includes("Atelier Démo"), "en-tête : nom de l'organisation");
  for (const l of imprimeProjet.lignes.slice(1)) assert.deepEqual(l.slice(1), ["", "", ""], `ligne « ${l[0]} » vide`);
  await page.close();

  etape("TC-03, TC-06 : soumission avec nom (non modifiable) et fonction ; l'auteur n'a ensuite aucun bouton de décision");
  await rita.goto(`${BASE}/app/documents/${brouillon}/validation`);
  const bloc = rita.locator('.decision-possible[data-transition="soumettre"]');
  assert.equal(await bloc.locator('[data-champ="nom"]').inputValue(), "Rita Rédactrice");
  assert.equal(await bloc.locator('[data-champ="nom"]').evaluate((el) => el.readOnly), true);
  assert.equal(await rita.locator("canvas, [data-signature]").count(), 0, "aucun pad de signature");
  await decider(rita, brouillon, "soumettre", { fonction: "Technicienne méthodes" });
  assert.equal(etat(brouillon), "en_verification");
  assert.equal(await rita.locator(".decision-possible").count(), 0, "TC-06 : l'auteur ne vérifie ni n'approuve");

  etape("TC-02 : document soumis → lecture seule, boutons de rédaction visibles mais désactivés");
  const lecture = await rita.context().newPage();
  await lecture.goto(`${BASE}/editeur/index.html?doc=${brouillon}`);
  await editeurPret(lecture);
  assert.equal(await lecture.textContent("#etat-synchro"), "Lecture seule");
  assert.equal(await lecture.getByLabel("Intitulé de la procédure").evaluate((el) => el.readOnly), true);
  assert.equal(await lecture.isVisible("#btn-enregistrer"), true);
  assert.equal(await lecture.isDisabled("#btn-enregistrer"), true);
  await lecture.close();

  etape("TC-05 : refus sans commentaire bloqué ; avec commentaire → brouillon ; puis nouveau cycle jusqu'à l'approbation");
  await victor.goto(`${BASE}/app/documents/${brouillon}/validation`);
  await victor.waitForLoadState("networkidle");
  const refus = victor.locator('.decision-possible[data-transition="refuser_verification"]');
  let confirmation = false;
  const surveiller = (d) => { confirmation = true; d.dismiss(); };
  victor.on("dialog", surveiller);
  await refus.locator("button[type=submit]").click();
  await victor.waitForTimeout(400);
  victor.off("dialog", surveiller);
  assert.equal(confirmation, false, "sans commentaire : rien n'est envoyé");
  assert.equal(etat(brouillon), "en_verification");
  await decider(victor, brouillon, "refuser_verification", { motif: "Préciser le critère d'acceptation." });
  assert.equal(etat(brouillon), "brouillon");
  await decider(rita, brouillon, "soumettre", { fonction: "Technicienne méthodes" });
  await decider(victor, brouillon, "verifier", { fonction: "Responsable qualité" });
  await decider(agathe, brouillon, "approuver", { fonction: "Directrice de site" });
  assert.equal(etat(brouillon), "publie");

  etape("TC-07 : PDF du document approuvé — en-tête de l'organisation, noms, fonctions et dates du circuit, visa vide");
  const pdf = await rita.context().newPage();
  await pdf.goto(`${BASE}/editeur/index.html?doc=${brouillon}`);
  await editeurPret(pdf);
  const imprime = await impression(pdf);
  assert.equal(imprime.projet, null, "approuvé : plus de mention « PROJET »");
  assert.ok(imprime.texte.includes("Atelier Démo"), "en-tête : nom de l'organisation");
  const [entete, noms, fonctions, dates, visa] = imprime.lignes;
  assert.deepEqual(entete.slice(1), ["Rédigé par", "Vérifié par", "Approuvé par"]);
  assert.deepEqual(noms.slice(1), ["Rita Rédactrice", "Victor Vérificateur", "Agathe Approbatrice"]);
  assert.deepEqual(fonctions.slice(1), ["Technicienne méthodes", "Responsable qualité", "Directrice de site"]);
  for (const d of dates.slice(1)) assert.match(d, /^\d{2}\/\d{2}\/\d{4}$/);
  assert.deepEqual(visa.slice(1), ["", "", ""], "case visa vide (signature sur papier)");
  // Le formulaire montre ce tableau sans le laisser saisir.
  assert.equal(await pdf.locator("#validation-circuit").getAttribute("data-etat"), "approuve");
  await capture(pdf, "recette-validation-circuit");
  await pdf.close();

  etape("TC-04 : une instruction de travail suit exactement le même circuit");
  const it = await creer("instruction", "Régler la presse", "IT-REC-01");
  await rita.goto(`${BASE}/app/documents/${it}/validation`);
  assert.deepEqual(await rita.locator(".decision-possible").evaluateAll((l) => l.map((x) => x.dataset.transition)), ["soumettre"]);
  await decider(rita, it, "soumettre");
  assert.equal(etat(it), "en_verification");
  await victor.goto(`${BASE}/app/documents/${it}/validation`);
  assert.deepEqual(await victor.locator(".decision-possible").evaluateAll((l) => l.map((x) => x.dataset.transition)), ["verifier", "refuser_verification"]);
  await decider(victor, it, "verifier");
  assert.equal(etat(it), "en_approbation");
  await victor.goto(`${BASE}/app/documents/${it}/validation`);
  assert.equal(await victor.locator(".decision-possible").count(), 0, "celui qui a vérifié n'approuve pas");
  await decider(agathe, it, "approuver");
  assert.equal(etat(it), "publie");
  assert.equal(sql(`SELECT string_agg(transition, ',' ORDER BY id) FROM "${schema}".decisions_document WHERE document_id = '${it}'`), "soumettre,verifier,approuver");

  etape("TC-08 : tableau de bord — cycle de vie, risques et opportunités, objectifs, pour chaque rôle");
  for (const p of [rita, victor, agathe, lea]) {
    await p.goto(`${BASE}/app`);
    for (const tuile of ["#tuile-documents", "#tuile-risques", "#tuile-opportunites", "#tuile-indicateurs"]) assert.ok(await p.isVisible(tuile), tuile);
  }

  etape("TC-09, TC-10 : cartographie — une seule par organisation, libellés sans « (.json) », plus de « version d'essai »");
  const carto = await rita.context().newPage();
  await carto.goto(`${BASE}/editeur/index.html?vue=cartographie`);
  await carto.waitForSelector("#carto-contenu .carto-actions");
  const html = await carto.content();
  assert.doesNotMatch(html, /version d['’]essai/i);
  assert.doesNotMatch(html, /\bessai\b|-essai\b|\.essai\b/i, "aucune trace « essai » dans la page (mot entier, classe ou clé)");
  const boutons = await carto.locator("button:visible").evaluateAll((l) => l.map((b) => b.textContent.trim()));
  assert.equal(boutons.filter((x) => x.includes(".json")).length, 0, `aucun libellé « (.json) » : ${boutons.join(" | ")}`);
  assert.ok(boutons.includes("Télécharger une copie de la cartographie"));
  await capture(carto, "recette-cartographie");
  await carto.close();
  assert.equal(Number(sql(`SELECT count(*) FROM "${schema}".cartographie`)), 1, "une seule cartographie en base");

  for (const p of [rita, victor, agathe, lea]) assert.deepEqual(p.erreurs, []);
  await b.close();
  console.log("✔ partie 14");
})().catch((e) => { console.error(e); process.exit(1); });
