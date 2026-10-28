// Partie 12 : revue périodique, notifications et tâches quotidiennes (W2), dans « Atelier Démo ».
//   - l'administrateur règle la période de revue, le rappel et l'escalade ; personne d'autre n'y a accès ;
//   - les décisions du circuit notifient les bonnes personnes (rail « Notifications (n) », page, « Tout marquer comme lu ») ;
//   - une revue en retard est signalée (liste, page de validation) ; les tâches quotidiennes CONSTRUITES
//     (.next/standalone/taches/quotidiennes.cjs, lancées comme par le minuteur systemd : rôle de l'application,
//     environnement minimal) préviennent l'approbatrice puis, après l'escalade, l'administrateur — une seule fois ;
//   - l'approbatrice confirme la revue : nouvelle échéance, plus de retard.
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const { BASE, URL_APPLICATION, sql, lancer, connecter, api, capture, etape, assert, designerDemo } = require("./outils.cjs");

const RACINE = path.resolve(__dirname, "../..");
const FUSEAU = "Africa/Douala"; // celui du serveur de test (tests/e2e/lancer.mjs)

/** Les tâches quotidiennes telles qu'elles sont construites et lancées en production. */
function tachesQuotidiennes() {
  const sortie = execFileSync(process.execPath, [path.join(RACINE, ".next/standalone/taches/quotidiennes.cjs")], {
    cwd: path.join(RACINE, ".next/standalone"),
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", NODE_ENV: "production", DATABASE_URL: URL_APPLICATION, FUSEAU_HORAIRE: FUSEAU },
    encoding: "utf8",
  });
  const bilan = JSON.parse(sortie.trim().split("\n").pop());
  assert.equal(bilan.evenement, "taches_quotidiennes");
  assert.deepEqual(bilan.erreurs, [], "aucune organisation en erreur");
  return bilan;
}

/** Jour (AAAA-MM-JJ) dans le fuseau, puis affichage « JJ/MM/AAAA ». */
function jourAffiche(date) {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: FUSEAU, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const v = (t) => p.find((x) => x.type === t).value;
  return { iso: `${v("year")}-${v("month")}-${v("day")}`, fr: `${v("day")}/${v("month")}/${v("year")}` };
}
function plusMois(iso, n) {
  const [a, m, j] = iso.split("-").map(Number);
  const cible = new Date(Date.UTC(a, m - 1 + n, 1));
  const dernier = new Date(Date.UTC(cible.getUTCFullYear(), cible.getUTCMonth() + 1, 0)).getUTCDate();
  cible.setUTCDate(Math.min(j, dernier));
  const s = cible.toISOString().slice(0, 10);
  return { iso: s, fr: `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` };
}

(async () => {
  const b = await lancer();
  const schema = sql("SELECT schema_name FROM platform.organisations WHERE slug = 'atelier-demo'");

  etape("paramètres : l'administrateur règle la revue (12 mois, rappel 15 j, escalade 10 j) ; les autres n'y ont pas accès");
  const admin = await connecter("admin@demo.test");
  await admin.goto(`${BASE}/app/parametres`);
  assert.ok(await admin.isVisible("a:has-text('Paramètres')"), "lien dans le rail");
  for (const [nom, valeur] of [["periodeRevueMois", "12"], ["rappelJours", "15"], ["escaladeJours", "10"]]) await admin.fill(`input[name="${nom}"]`, valeur);
  await admin.click('button:has-text("Enregistrer les paramètres")');
  await admin.waitForSelector("text=Paramètres enregistrés.");
  assert.match(await admin.textContent("#parametres-modifies"), /^Dernière modification : .+, par Admin Atelier Démo\.$/);
  assert.equal(sql(`SELECT periode_revue_mois || '/' || rappel_jours || '/' || escalade_jours FROM "${schema}".parametres`), "12/15/10");
  await capture(admin, "parametres");
  const rita = await connecter("redac@demo.test");
  assert.equal((await rita.goto(`${BASE}/app/parametres`)).status(), 404);
  assert.equal(await rita.locator("a:has-text('Paramètres')").count(), 0);

  etape("circuit : chaque étape notifie les bonnes personnes (rail, page, ouverture, tout marquer comme lu)");
  const org = (await api(rita, "GET", "/api/editeur/contexte")).corps.organisation.id;
  const cree = await api(rita, "POST", "/api/documents", { organisationId: org, contenu: { meta: { typeDocument: "procedure", titre: "Gérer les notifications", reference: "PR-NOT-01" }, roles: [], etapes: [{ id: "e1", libelle: "Prévenir" }] } });
  assert.equal(cree.statut, 201);
  const id = cree.corps.id;
  const PAGE = `${BASE}/app/documents/${id}/validation`;
  async function decider(p, libelle, etat) {
    await p.goto(PAGE);
    await p.waitForLoadState("networkidle"); // formulaire interactif (la confirmation passe par le script de la page)
    const bloc = p.locator(".decision-possible", { has: p.locator(`button:has-text("${libelle}")`) });
    // Soumettre, vérifier, approuver : fonction obligatoire (TC-03).
    if (await bloc.locator('input[name="fonction"]').count()) await bloc.locator('input[name="fonction"]').fill("Responsable QSE");
    await designerDemo(bloc); // soumettre : vérificateur et approbateur désignés
    p.once("dialog", (d) => d.accept());
    await bloc.locator(`button:has-text("${libelle}")`).click();
    await p.waitForURL((u) => u.searchParams.get("etat") === etat);
  }
  const notifDuDoc = (p) => p.locator("#notifications li", { hasText: "PR-NOT-01" });
  const compteRail = async (p) => {
    const t = (await p.locator(".rail-nav a", { hasText: "Notifications" }).textContent()).trim();
    const m = /\((\d+)\)$/.exec(t);
    return m ? Number(m[1]) : 0;
  };

  await decider(rita, "Soumettre à vérification", "en_verification");
  const victor = await connecter("verif@demo.test");
  await victor.goto(`${BASE}/app/notifications`);
  assert.ok((await compteRail(victor)) >= 1, "nombre de notifications non lues dans le rail");
  assert.equal(await notifDuDoc(victor).count(), 1);
  assert.equal((await notifDuDoc(victor).innerText()).split("\n")[0].trim(), "Nouvelle Rita Rédactrice a soumis PR-NOT-01 — Gérer les notifications (v1) à vérification.");
  await capture(victor, "notifications");
  await notifDuDoc(victor).locator('a:has-text("Ouvrir")').click();
  await victor.waitForURL(PAGE);
  await victor.goto(`${BASE}/app/notifications`);
  // (Plus rien de non lu : le bouton disparaît avec son message quand la page est recalculée : on attend la réponse.)
  await victor.waitForLoadState("networkidle");
  const marquage = victor.waitForResponse((r) => r.request().method() === "POST" && r.url().startsWith(`${BASE}/app/notifications`));
  await victor.click('button:has-text("Tout marquer comme lu")');
  assert.equal((await marquage).status(), 200);
  await victor.goto(`${BASE}/app/notifications`);
  assert.equal(await compteRail(victor), 0);
  assert.equal(await victor.locator('button:has-text("Tout marquer comme lu")').count(), 0);
  assert.equal(await notifDuDoc(victor).locator(".etiquette:has-text('Nouvelle')").count(), 0);
  // Rita a soumis : elle n'est pas notifiée de sa propre décision.
  await rita.goto(`${BASE}/app/notifications`);
  assert.equal(await notifDuDoc(rita).count(), 0);

  await decider(victor, "Vérifié : transmettre à l'approbation", "en_approbation");
  const agathe = await connecter("appro@demo.test");
  await agathe.goto(`${BASE}/app/notifications`);
  assert.match(await notifDuDoc(agathe).first().innerText(), /Victor Vérificateur a vérifié PR-NOT-01 — Gérer les notifications \(v1\) : il attend une approbation\./);
  await decider(agathe, "Approuver et publier", "publie");
  await rita.goto(`${BASE}/app/notifications`);
  assert.match(await notifDuDoc(rita).first().innerText(), /PR-NOT-01 — Gérer les notifications \(v1\) a été approuvé et publié par Agathe Approbatrice\./);

  etape("revue en retard (dernière approbation il y a 13 mois) : signalée dans la liste et sur la page de validation");
  const ilYa = new Date(Date.now() - 400 * 86_400_000);
  sql(`UPDATE "${schema}".documents SET revue_le = '${ilYa.toISOString()}' WHERE id = '${id}'`);
  const echeance = plusMois(jourAffiche(ilYa).iso, 12);
  await agathe.goto(`${BASE}/app/documents`);
  const ligne = agathe.locator("tbody tr", { has: agathe.locator(`a[href="/editeur/index.html?doc=${id}"]`) });
  assert.equal(await ligne.locator('[data-revue="escalade"]').textContent(), "Revue en retard");
  await agathe.goto(PAGE);
  assert.equal(await agathe.getAttribute("#revue", "data-situation"), "escalade");
  assert.equal(await agathe.textContent("#revue"), `Revue en retard : elle était due le ${echeance.fr} (administrateurs prévenus).`);
  assert.deepEqual(await agathe.locator(".decision-possible").evaluateAll((l) => l.map((x) => x.dataset.transition)), ["archiver", "confirmer_revue"]);

  etape("tâches quotidiennes construites : retard → approbatrice, escalade → administrateur ; relancées : aucun doublon");
  const premier = tachesQuotidiennes();
  console.log("  bilan :", JSON.stringify(premier));
  assert.ok(premier.notifications >= 2, "au moins le retard (approbatrice) et l'escalade (administrateur)");
  const second = tachesQuotidiennes();
  assert.equal(second.notifications, 0, "relancées le même jour : rien de nouveau");
  await agathe.goto(`${BASE}/app/notifications`);
  assert.equal(await notifDuDoc(agathe).filter({ hasText: "est en retard : elle était due le" }).count(), 1);
  await admin.goto(`${BASE}/app/notifications`);
  const escalade = notifDuDoc(admin).filter({ hasText: "est en retard de" });
  assert.equal(await escalade.count(), 1);
  assert.match(await escalade.innerText(), new RegExp(`La revue de PR-NOT-01 — Gérer les notifications est en retard de \\d+ jours \\(due le ${echeance.fr.replaceAll("/", "\\/")}\\)\\.`));
  await capture(admin, "notification-escalade");

  etape("l'approbatrice confirme la revue : nouvelle échéance (aujourd'hui + 12 mois), plus de retard");
  await decider(agathe, "Revue faite : maintenir le document", "publie");
  const prochaine = plusMois(jourAffiche(new Date()).iso, 12);
  assert.equal(await agathe.getAttribute("#revue", "data-situation"), "a_jour");
  assert.equal(await agathe.textContent("#revue"), `Prochaine revue : au plus tard le ${prochaine.fr}.`);
  assert.equal((await agathe.locator("#decisions tbody tr").first().innerText()).split("\t")[1], "Revue confirmée");
  await agathe.goto(`${BASE}/app/documents`);
  const ligneApres = agathe.locator("tbody tr", { has: agathe.locator(`a[href="/editeur/index.html?doc=${id}"]`) });
  assert.equal(await ligneApres.locator("[data-revue]").count(), 0);
  assert.ok((await ligneApres.innerText()).includes(`revue avant le ${prochaine.fr}`));
  assert.equal(tachesQuotidiennes().notifications, 0, "revue confirmée : plus de rappel");

  etape("lectrice (anglais) : ses notifications, en anglais ; pas de paramètres");
  const lea = await connecter("lecteur@demo.test");
  await lea.goto(`${BASE}/app/notifications`);
  assert.ok(await lea.isVisible("h1:has-text('Notifications')"));
  assert.equal((await lea.goto(`${BASE}/app/parametres`)).status(), 404);

  etape("remise des paramètres par défaut");
  await admin.goto(`${BASE}/app/parametres`);
  for (const [nom, valeur] of [["periodeRevueMois", "24"], ["rappelJours", "30"], ["escaladeJours", "30"]]) await admin.fill(`input[name="${nom}"]`, valeur);
  await admin.click('button:has-text("Enregistrer les paramètres")');
  await admin.waitForSelector("text=Paramètres enregistrés.");

  for (const p of [admin, rita, victor, agathe, lea]) assert.deepEqual(p.erreurs, [], "erreurs console");
  console.log("  erreurs console : aucune");
  await b.close();
  console.log("✔ partie 12");
})().catch((e) => { console.error(e); process.exit(1); });
