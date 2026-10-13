// Écrit les exports BPMN des procédures d'essai dans tests/bpmn/.sortie/, pour la validation contre le schéma XSD officiel
// (tests/bpmn/valider_xsd.py). Lancé par « npm run test:bpmn ».
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { versBpmn, depuisBpmn } from "../../editeur/js/bpmn.js";
import { nettoyer } from "../../editeur/js/store.js";
import { exempleProcedure } from "../../editeur/js/exemple-procedure.js";
import { procedureComplete } from "../../editeur/tests/fixtures/bpmn-procedures.mjs";

const ici = path.dirname(fileURLToPath(import.meta.url));
const sortie = path.join(ici, ".sortie");
fs.rmSync(sortie, { recursive: true, force: true });
fs.mkdirSync(sortie, { recursive: true });

const textes = nettoyer(procedureComplete());
textes.etapes[0].libelle = "  Ligne 1\nLigne\t2 « 3 » & <4> \"5\" '6'  ";
textes.etapes[0].sortie = "Bon\u0007 de\r\ncommande";
const autre = fs.readFileSync(path.join(ici, "../../editeur/tests/fixtures/autre-outil.bpmn"), "utf8");

const cas = {
  "exemple-restaurant": exempleProcedure(),
  "procedure-complete": procedureComplete(),
  "textes-speciaux": textes,
  "procedure-vide": { meta: { typeDocument: "procedure" }, roles: [], etapes: [] },
  "sans-role": { meta: { typeDocument: "procedure" }, roles: [], etapes: [{ id: "e1", libelle: "Seule" }, { id: "e2", libelle: "Suite" }] },
  // Un BPMN venu d'un autre outil, importé puis réexporté par Jalonia.
  "autre-outil-reexporte": depuisBpmn(autre).procedure,
};
for (const [nom, p] of Object.entries(cas)) {
  fs.writeFileSync(path.join(sortie, `${nom}.bpmn`), versBpmn(nettoyer(p), { versionApplication: "essai" }));
}
console.log(`${Object.keys(cas).length} exports BPMN écrits dans ${path.relative(process.cwd(), sortie)}`);
