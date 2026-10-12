// Copie l'éditeur Qualigramme (dossier editeur/) dans public/editeur/, d'où Next.js le sert tel quel.
// Lancé automatiquement avant « npm run build » et « npm run dev ». Seuls les fichiers utiles au navigateur
// sont copiés : ni les tests, ni l'historique des versions.
// La copie est mise en mode « en ligne » (<html data-mode="en-ligne">) : le document et la cartographie viennent du
// serveur de l'organisation et y sont enregistrés (voir editeur/js/en-ligne.js). Le dossier editeur/ reste, lui,
// utilisable tel quel en local (fichier ouvert sur le poste).
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const racine = path.resolve(import.meta.dirname, "..");
const source = path.join(racine, "editeur");
const cible = path.join(racine, "public", "editeur");
const A_COPIER = ["index.html", "guide-fr.html", "guide-en.html", "LICENCES-TIERS.md", "css", "js", "img", "vendor"];

for (const element of A_COPIER) {
  if (!existsSync(path.join(source, element))) throw new Error(`Éditeur incomplet : ${element} manquant dans editeur/.`);
}
rmSync(cible, { recursive: true, force: true });
mkdirSync(cible, { recursive: true });
for (const element of A_COPIER) cpSync(path.join(source, element), path.join(cible, element), { recursive: true });

const page = path.join(cible, "index.html");
const html = readFileSync(page, "utf8");
const BALISE = '<html lang="fr">';
if (html.split(BALISE).length !== 2) throw new Error(`editeur/index.html : balise ${BALISE} introuvable (ou en double) — mode en ligne impossible à poser.`);
writeFileSync(page, html.replace(BALISE, '<html lang="fr" data-mode="en-ligne">'));
console.log(`Éditeur copié dans public/editeur (${A_COPIER.length} éléments, mode en ligne).`);
