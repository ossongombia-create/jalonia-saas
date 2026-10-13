// Contre-épreuve : un script injecté dans la page est BLOQUÉ par la CSP. Chaque vecteur a son propre compteur.
const { BASE, lancer, connecter, assert } = require("./outils.cjs");
(async () => {
  const b = await lancer();
  const p = await connecter("redac@demo.test");
  for (const chemin of ["/app/documents", "/editeur/index.html"]) {
    await p.goto(`${BASE}${chemin}`);
    await p.waitForLoadState("networkidle");
    const r = await p.evaluate(async () => {
      const violations = [];
      document.addEventListener("securitypolicyviolation", (e) => violations.push(e.violatedDirective));
      window.__x = { onerror: 0, javascriptUrl: 0, iframeSrcdoc: 0, scriptInnerHTML: 0 };
      document.body.insertAdjacentHTML("beforeend", '<img src="data:," onerror="window.__x.onerror++">');
      const a = document.createElement("a"); a.href = "javascript:window.__x.javascriptUrl++"; document.body.append(a); a.click();
      // HTML analysé par le navigateur (comme une injection dans une page rendue) : cadre « srcdoc » (hérite de la CSP).
      const f = document.createElement("iframe"); f.srcdoc = "<script>parent.__x.iframeSrcdoc++<\/script>"; document.body.append(f);
      const d = document.createElement("div"); d.innerHTML = "<script>window.__x.scriptInnerHTML++<\/script>"; document.body.append(d);
      await new Promise((res) => setTimeout(res, 1000));
      return { x: window.__x, violations };
    });
    console.log(`  ${chemin} : ${JSON.stringify(r.x)} violations=${JSON.stringify(r.violations)}`);
    for (const [vecteur, n] of Object.entries(r.x)) assert.equal(n, 0, `${chemin} : ${vecteur} exécuté`);
  }
  await b.close();
  console.log("✔ aucun script injecté ne s'exécute");
})().catch((e) => { console.error(e); process.exit(1); });
