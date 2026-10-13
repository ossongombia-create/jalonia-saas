// Ouvre chaque export BPMN (tests/bpmn/.sortie/) dans bpmn-js (le moteur de bpmn.io et de Camunda Modeler), dans Chromium :
// l'import doit réussir SANS AVERTISSEMENT, et chaque élément du processus doit être dessiné. Lancé par « npm run test:bpmn ».
// (bpmn-js n'est qu'une dépendance de test : il ne fait pas partie de l'application.)
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const SORTIE = path.join(__dirname, ".sortie");
const VISIONNEUSE = require.resolve("bpmn-js/dist/bpmn-viewer.production.min.js");

(async () => {
  const fichiers = fs.readdirSync(SORTIE).filter((f) => f.endsWith(".bpmn")).sort();
  if (fichiers.length === 0) throw new Error("aucun export : lancer d'abord tests/bpmn/exporter-exemples.mjs");
  const navigateur = await chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {});
  const page = await navigateur.newPage();
  const erreurs = [];
  page.on("pageerror", (e) => erreurs.push(e.message));
  await page.setContent('<div id="toile" style="width:1600px;height:900px"></div>');
  await page.addScriptTag({ path: VISIONNEUSE });
  let echecs = 0;
  for (const f of fichiers) {
    const xml = fs.readFileSync(path.join(SORTIE, f), "utf8");
    const r = await page.evaluate(async (texte) => {
      const toile = document.getElementById("toile");
      toile.replaceChildren();
      const visionneuse = new window.BpmnJS({ container: toile });
      try {
        const { warnings } = await visionneuse.importXML(texte);
        const registre = visionneuse.get("elementRegistry");
        const types = {};
        registre.getAll().forEach((e) => { types[e.type] = (types[e.type] || 0) + 1; });
        return { ok: true, avertissements: warnings.map((w) => w.message), types, dessines: registre.getAll().length };
      } catch (e) {
        return { ok: false, erreur: String(e && e.message), avertissements: (e && e.warnings ? e.warnings : []).map((w) => w.message) };
      } finally {
        visionneuse.destroy();
      }
    }, xml);
    // Chaque nœud et chaque flux du fichier doit avoir été dessiné.
    const attendus = (xml.match(/<bpmn:(task|callActivity|startEvent|endEvent|exclusiveGateway|parallelGateway|sequenceFlow|lane|participant) /g) || []).length;
    const dessinesProcessus = r.ok ? Object.entries(r.types).filter(([t]) => /^bpmn:(Task|CallActivity|StartEvent|EndEvent|ExclusiveGateway|ParallelGateway|SequenceFlow|Lane|Participant)$/.test(t)).reduce((s, [, n]) => s + n, 0) : 0;
    if (r.ok && r.avertissements.length === 0 && dessinesProcessus === attendus) {
      console.log(`✔ ${f} : ${dessinesProcessus} éléments dessinés, aucun avertissement`);
    } else {
      echecs += 1;
      console.log(`✘ ${f} : ${r.ok ? `${dessinesProcessus}/${attendus} éléments dessinés` : r.erreur}`);
      for (const a of r.avertissements) console.log(`    ${a}`);
    }
  }
  await navigateur.close();
  if (erreurs.length) { console.log("✘ erreurs de la page :", erreurs); echecs += 1; }
  console.log(`${fichiers.length - echecs}/${fichiers.length} export(s) ouverts par bpmn-js ${require("bpmn-js/package.json").version} sans avertissement`);
  process.exit(echecs ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
