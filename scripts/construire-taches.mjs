// Construit les tâches quotidiennes (scripts/taches-quotidiennes.ts) en UN fichier exécutable par Node, à côté du
// serveur autonome : .next/standalone/taches/quotidiennes.cjs. Lancé après « next build » (npm run build).
// Le paquet « pg » n'est pas embarqué : c'est celui du serveur autonome (.next/standalone/node_modules/pg).
// Le minuteur systemd (deploy/jalonia-taches.service) lance ce fichier depuis la version en service.
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const AUTONOME = path.join(RACINE, ".next/standalone");
const SORTIE = path.join(AUTONOME, "taches/quotidiennes.cjs");
const SORTIE_COURRIELS = path.join(AUTONOME, "taches/courriels-en-attente.cjs");

if (!fs.existsSync(path.join(AUTONOME, "server.js"))) {
  console.error("✘ .next/standalone/server.js absent : construire d'abord l'application (next build).");
  process.exit(1);
}
if (!fs.existsSync(path.join(AUTONOME, "node_modules/pg/package.json"))) {
  console.error("✘ le serveur autonome n'embarque pas « pg » : les tâches quotidiennes ne pourraient pas se connecter.");
  process.exit(1);
}

await build({
  entryPoints: [path.join(RACINE, "scripts/taches-quotidiennes.ts")],
  outfile: SORTIE,
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  external: ["pg"],
  // « server-only » refuse d'être importé hors de Next.js : même module vide que pour les tests.
  alias: { "server-only": path.join(RACINE, "tests/stubs/server-only.ts") },
  tsconfig: path.join(RACINE, "tsconfig.json"),
  legalComments: "none",
  logLevel: "warning",
});
await build({
  entryPoints: [path.join(RACINE, "scripts/courriels-en-attente.ts")],
  outfile: SORTIE_COURRIELS,
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  external: ["pg"],
  alias: { "server-only": path.join(RACINE, "tests/stubs/server-only.ts") },
  tsconfig: path.join(RACINE, "tsconfig.json"),
  legalComments: "none",
  logLevel: "warning",
});
console.log(`✔ tâches quotidiennes : ${path.relative(RACINE, SORTIE)}`);
console.log(`✔ file de courriels : ${path.relative(RACINE, SORTIE_COURRIELS)}`);
