// Partie 13 : risques et opportunités, plan d'actions, objectifs et indicateurs, tableau de bord (Q1), dans
// « Atelier Démo ».
//   - une procédure qui porte des risques, des opportunités et un indicateur est publiée : les registres la montrent ;
//   - l'approbatrice ouvre une action depuis un risque (texte lu dans le document), la confie à la rédactrice
//     (notifiée, l'action apparaît sur son tableau de bord), qui la réalise ; l'approbatrice la clôt (efficacité exigée) ;
//   - objectif chiffré, mesures (correction le même jour, suppression), graphique ;
//   - la lectrice (anglais) consulte sans pouvoir agir.
const { BASE, lancer, connecter, api, capture, etape, assert } = require("./outils.cjs");

(async () => {
  const b = await lancer();
  const rita = await connecter("redac@demo.test");
  const org = (await api(rita, "GET", "/api/editeur/contexte")).corps.organisation.id;
  const contenu = {
    meta: { typeDocument: "procedure", titre: "Traiter les commandes", reference: "PR-QSE-13" },
    roles: [{ id: "r1", nom: "Commercial" }],
    etapes: [
      {
        id: "e1", roleId: "r1", libelle: "Enregistrer la commande",
        risques: [
          { id: "k1", risque: "Commande mal saisie", causes: "Saisie manuelle", gravite: "3", probabilite: "3", mesure: "Double contrôle" },
          { id: "k2", risque: "Retard de saisie", gravite: "1", probabilite: "2", mesure: "File d'attente suivie" },
        ],
        opportunites: [{ id: "o1", opportunite: "Commande en ligne", benefice: "Moins d'erreurs", interet: "3", faisabilite: "2" }],
        indicateur: { actif: true, nom: "Délai de traitement des commandes", formule: "date d'envoi − date de réception", cible: "≤ 2 jours", frequence: "Mensuelle" },
      },
    ],
  };
  const cree = await api(rita, "POST", "/api/documents", { organisationId: org, contenu });
  assert.equal(cree.statut, 201);
  const id = cree.corps.id;
  async function decider(p, libelle, etat) {
    await p.goto(`${BASE}/app/documents/${id}/validation`);
    await p.waitForLoadState("networkidle");
    p.once("dialog", (d) => d.accept());
    await p.locator(`.decision-possible button:has-text("${libelle}")`).click();
    await p.waitForURL((u) => u.searchParams.get("etat") === etat);
  }
  const victor = await connecter("verif@demo.test");
  const agathe = await connecter("appro@demo.test");

  etape("registre : rien tant que la procédure n'est pas publiée (versions en cours : visibles)");
  await agathe.goto(`${BASE}/app/risques`);
  assert.equal(await agathe.locator(`#registre-risques tr[data-document="${id}"][data-element="k1"]`).count(), 0);
  await agathe.goto(`${BASE}/app/risques?portee=tous`);
  assert.ok((await agathe.locator(`#registre-risques tr[data-document="${id}"][data-element="k1"]`).innerText()).includes("v1 en cours"));

  etape("publication, puis registres : cotation et niveau comme dans l'éditeur");
  await decider(rita, "Soumettre à vérification", "en_verification");
  await decider(victor, "Vérifié : transmettre à l'approbation", "en_approbation");
  await decider(agathe, "Approuver et publier", "publie");
  await agathe.goto(`${BASE}/app/risques`);
  const k1 = agathe.locator(`#registre-risques tr[data-document="${id}"][data-element="k1"]`);
  assert.equal(await k1.getAttribute("data-niveau"), "critique");
  assert.match(await k1.innerText(), /PR-QSE-13 — Traiter les commandes\s+v1\s+1\. Enregistrer la commande\s+Commande mal saisie\s+Causes : Saisie manuelle\s+3 × 3 = 9 Critique\s+Double contrôle/);
  assert.equal(await agathe.locator(`#registre-risques tr[data-document="${id}"][data-element="k2"]`).getAttribute("data-niveau"), "acceptable");
  assert.equal(await agathe.locator(`#registre-opportunites tr[data-document="${id}"][data-element="o1"]`).getAttribute("data-suite"), "plan");
  await capture(agathe, "registre-risques");

  etape("action ouverte depuis le risque k1 : élément lu dans le document, confiée à la rédactrice");
  await k1.locator('a:has-text("Ouvrir une action")').click();
  await agathe.waitForURL((u) => u.pathname === "/app/actions/nouvelle");
  assert.equal(await agathe.textContent("#element-vise"), "Élément visé : Risque — Commande mal saisie (PR-QSE-13 — Traiter les commandes)");
  assert.equal(await agathe.inputValue('select[name="origine"]'), "risque");
  await agathe.fill('input[name="titre"]', "Mettre en place un double contrôle des saisies");
  await agathe.fill('textarea[name="description"]', "Relecture par un second commercial avant validation.");
  await agathe.selectOption('select[name="responsableId"]', { label: "Rita Rédactrice" });
  await agathe.fill('input[name="echeance"]', "2027-01-31");
  await agathe.waitForLoadState("networkidle");
  await agathe.click('button:has-text("Créer l\'action")');
  await agathe.waitForURL((u) => /^\/app\/actions\/[0-9a-f-]{36}$/.test(u.pathname) && u.searchParams.has("cree"));
  const pageAction = agathe.url().split("?")[0];
  assert.match(await agathe.textContent("#action-creee"), /^Action A-\d+ créée\.$/);
  const fiche = await agathe.innerText("#fiche-action");
  for (const attendu of ["À faire", "Risque", "PR-QSE-13 — Traiter les commandes", "Commande mal saisie", "Rita Rédactrice", "31/01/2027"]) assert.ok(fiche.includes(attendu), `fiche : ${attendu}\n${fiche}`);
  await capture(agathe, "action-creee");

  etape("la rédactrice : notifiée, l'action sur son tableau de bord ; elle la réalise");
  await rita.goto(`${BASE}/app/notifications`);
  assert.match(await rita.locator("#notifications li").first().innerText(), /Agathe Approbatrice vous a confié l'action Mettre en place un double contrôle des saisies \(échéance : 31\/01\/2027\)\./);
  await rita.goto(`${BASE}/app`);
  assert.ok((await rita.innerText("#mes-actions")).includes("Mettre en place un double contrôle des saisies"));
  await capture(rita, "tableau-de-bord");
  await rita.goto(pageAction);
  await rita.waitForLoadState("networkidle");
  // Responsable (même avec le droit de gérer les actions) : ni « Close » ni « Abandonnée » (décision n° 5).
  const statutsDe = (p) => p.locator('select[name="statut"] option').evaluateAll((os) => os.map((o) => o.value));
  assert.deepEqual(await statutsDe(rita), ["a_faire", "en_cours", "realisee"]);
  await rita.selectOption('select[name="statut"]', "realisee");
  await rita.fill('textarea[name="resultat"]', "Double contrôle en place depuis le 1er novembre.");
  await rita.click('button:has-text("Enregistrer")');
  await rita.waitForSelector("text=Action enregistrée.");
  await rita.waitForFunction(() => document.querySelector("#fiche-action")?.dataset.statut === "realisee");
  const historique = await rita.innerText("#historique-action");
  assert.ok(historique.includes("Avancement : « À faire » → « Réalisée (efficacité à vérifier) »"), historique);
  await agathe.goto(`${BASE}/app/risques`);
  assert.equal(await agathe.locator(`#registre-risques tr[data-document="${id}"][data-element="k1"] a:has-text("1 en cours")`).count(), 1);

  etape("l'approbatrice clôt : l'efficacité est exigée ; ensuite l'action ne se modifie plus");
  await agathe.goto(pageAction);
  await agathe.waitForLoadState("networkidle");
  await agathe.selectOption('select[name="statut"]', "cloturee");
  await agathe.click('button:has-text("Enregistrer")');
  await agathe.waitForSelector("text=Pour clore l'action, indiquez si elle a été efficace.");
  await agathe.selectOption('select[name="efficace"]', "oui");
  await agathe.click('button:has-text("Enregistrer")');
  await agathe.waitForFunction(() => document.querySelector("#fiche-action")?.dataset.statut === "cloturee");
  assert.ok((await agathe.innerText("#fiche-action")).includes("Close — Efficace"));
  assert.match(await agathe.innerText("#cloture-par"), /^Agathe Approbatrice — /);
  assert.equal(await agathe.locator("#modifier-action").count(), 0);
  assert.ok(await agathe.isVisible("text=Action close ou abandonnée : elle ne se modifie plus."));
  await agathe.goto(`${BASE}/app/risques`);
  assert.equal(await agathe.locator(`#registre-risques tr[data-document="${id}"][data-element="k1"] a:has-text("en cours")`).count(), 0);
  await capture(agathe, "action-close");

  etape("indicateur : objectif chiffré (approbatrice), mesures (rédactrice), correction, suppression, graphique");
  await agathe.goto(`${BASE}/app/indicateurs`);
  const ligneInd = agathe.locator(`#registre-indicateurs tr[data-document="${id}"][data-element="e1"]`);
  assert.equal(await ligneInd.getAttribute("data-situation"), "sans_objectif");
  await ligneInd.locator("a").first().click();
  await agathe.waitForURL((u) => u.pathname === "/app/indicateurs/detail");
  const pageIndicateur = agathe.url();
  await agathe.waitForLoadState("networkidle");
  await agathe.selectOption('select[name="sens"]', "max");
  await agathe.fill('input[name="seuil"]', "2");
  await agathe.fill('input[name="unite"]', "jours");
  await agathe.click('button:has-text("Enregistrer l\'objectif")');
  await agathe.waitForSelector("text=Objectif enregistré.");
  await agathe.waitForFunction(() => document.querySelector("#objectif")?.textContent === "au plus 2 jours");
  await rita.goto(pageIndicateur);
  assert.equal(await rita.locator('button:has-text("Enregistrer l\'objectif")').count(), 0, "la rédactrice ne fixe pas les objectifs");
  await rita.waitForLoadState("networkidle");
  // (Deux enregistrements de suite affichent le même message : on attend la réponse de chaque envoi, puis le message,
  // puis la remise à zéro du formulaire — sinon elle pourrait effacer la saisie suivante.)
  const saisir = async (date, valeur, message) => {
    await rita.fill('input[name="date"]', date);
    await rita.fill('input[name="valeur"]', valeur);
    const reponse = rita.waitForResponse((r) => r.request().method() === "POST" && r.url().startsWith(`${BASE}/app/indicateurs/detail`));
    await rita.click('button:has-text("Enregistrer la mesure")');
    assert.equal((await reponse).status(), 200);
    await rita.waitForSelector(`#mesures-indicateur p[role="status"]:has-text("${message}")`);
    // Après un succès, le formulaire est vidé : on attend que ce soit fait avant la saisie suivante.
    await rita.waitForFunction(() => document.querySelector('#mesures-indicateur input[name="valeur"]')?.value === "");
  };
  await saisir("2026-09-30", "3,5", "Mesure enregistrée.");
  await saisir("2026-10-01", "1,5", "Mesure enregistrée.");
  await saisir("2026-09-30", "2", "Mesure corrigée");
  await rita.waitForFunction(() => document.querySelectorAll("#mesures tbody tr").length === 2);
  const lignes = await rita.locator("#mesures tbody tr").evaluateAll((l) => l.map((tr) => [tr.dataset.date, tr.dataset.situation, tr.querySelectorAll("td")[1].textContent.trim()]));
  assert.deepEqual(lignes, [["2026-10-01", "atteint", "1,5 jours"], ["2026-09-30", "atteint", "2 jours"]]);
  assert.equal(await rita.locator(".graphique-mesures circle").count(), 2);
  await capture(rita, "indicateur");
  rita.once("dialog", (d) => { assert.match(d.message(), /^Supprimer la mesure du 30\/09\/2026 \?/); d.accept(); });
  const suppression = rita.waitForResponse((r) => r.request().method() === "POST" && r.url().startsWith(`${BASE}/app/indicateurs/detail`));
  await rita.locator('#mesures tr[data-date="2026-09-30"] button:has-text("Supprimer")').click();
  assert.equal((await suppression).status(), 200);
  await rita.waitForFunction(() => document.querySelectorAll("#mesures tbody tr").length === 1);
  await agathe.goto(`${BASE}/app/indicateurs`);
  assert.equal(await agathe.locator(`#registre-indicateurs tr[data-document="${id}"][data-element="e1"]`).getAttribute("data-situation"), "atteint");

  etape("tableau de bord de l'approbatrice : risques, opportunités, indicateurs, actions");
  await agathe.goto(`${BASE}/app`);
  for (const [tuile, motif] of [["#tuile-risques", /\d+ Critique/], ["#tuile-opportunites", /\d+ À planifier/], ["#tuile-indicateurs", /[1-9]\d* Objectif atteint/], ["#tuile-actions", /\d+ ouvertes/]]) {
    assert.match(await agathe.innerText(tuile), motif, tuile);
  }

  etape("lectrice (anglais) : registres et plan d'actions en lecture ; aucune action possible");
  const lea = await connecter("lecteur@demo.test");
  await lea.goto(`${BASE}/app/risques`);
  assert.ok(await lea.isVisible("h1:has-text('Risks and opportunities')"));
  assert.equal(await lea.locator('#registre-risques a:has-text("Open an action")').count(), 0);
  await lea.goto(`${BASE}/app/actions?statut=toutes`);
  assert.ok(await lea.isVisible("text=Your role gives read access to the action plan."));
  assert.equal(await lea.locator("#nouvelle-action").count(), 0);
  assert.equal((await lea.goto(`${BASE}/app/actions/nouvelle`)).status(), 404);
  await lea.goto(pageAction);
  assert.equal(await lea.locator("#modifier-action").count(), 0);
  await lea.goto(pageIndicateur);
  assert.equal(await lea.locator('button:has-text("Record the measurement")').count(), 0);
  assert.ok(await lea.isVisible("text=Your role gives read access to indicators."));

  etape("lectrice responsable d'une action : formulaire réduit (avancement, compte rendu), ni clôture ni abandon");
  await agathe.goto(`${BASE}/app/actions/nouvelle`);
  await agathe.waitForLoadState("networkidle");
  await agathe.fill('input[name="titre"]', "Afficher la consigne au poste");
  await agathe.selectOption('select[name="origine"]', "autre");
  await agathe.selectOption('select[name="responsableId"]', { label: "Léa Lectrice" });
  await agathe.click('button:has-text("Créer l\'action")');
  await agathe.waitForURL((u) => /^\/app\/actions\/[0-9a-f-]{36}$/.test(u.pathname) && u.searchParams.has("cree"));
  const pageActionLea = agathe.url().split("?")[0];
  await lea.goto(pageActionLea);
  await lea.waitForLoadState("networkidle");
  assert.ok(await lea.isVisible("#action-responsable"));
  for (const champ of ['input[name="titre"]', 'textarea[name="description"]', 'select[name="origine"]', 'select[name="responsableId"]', 'input[name="echeance"]', 'select[name="efficace"]']) {
    assert.equal(await lea.locator(`#modifier-action ${champ}`).count(), 0, champ);
  }
  assert.deepEqual(await statutsDe(lea), ["a_faire", "en_cours", "realisee"]);
  await lea.selectOption('select[name="statut"]', "realisee");
  await lea.fill('textarea[name="resultat"]', "Consigne affichée au poste 3.");
  await lea.click('button:has-text("Save")');
  await lea.waitForSelector("text=Action saved.");
  await lea.waitForFunction(() => document.querySelector("#fiche-action")?.dataset.statut === "realisee");
  assert.deepEqual(await statutsDe(lea), ["realisee", "en_cours"]);
  await capture(lea, "action-lectrice-responsable");
  await agathe.goto(pageActionLea);
  await agathe.waitForLoadState("networkidle");
  await agathe.selectOption('select[name="statut"]', "cloturee");
  await agathe.selectOption('select[name="efficace"]', "oui");
  await agathe.click('button:has-text("Enregistrer")');
  await agathe.waitForFunction(() => document.querySelector("#fiche-action")?.dataset.statut === "cloturee");
  await lea.goto(pageActionLea);
  assert.match(await lea.innerText("#cloture-par"), /^Agathe Approbatrice — /);
  assert.equal(await lea.locator("#modifier-action").count(), 0);

  for (const p of [rita, victor, agathe, lea]) assert.deepEqual(p.erreurs, [], "erreurs console");
  console.log("  erreurs console : aucune");
  await b.close();
  console.log("✔ partie 13");
})().catch((e) => { console.error(e); process.exit(1); });
