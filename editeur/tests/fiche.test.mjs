// Tests de l'import d'une fiche de collecte Excel (.xlsx, modèle FC-QUA-01). tests/fixtures/fiche-collecte-exemple.xlsx est une
// fiche réelle ANONYMISÉE (organisation, personnes et lieux remplacés) : procédure « Gérer les contrats » et son instruction IT-JUR-03.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { lireClasseur, lireFeuille, adresse } from "../js/xlsx.js";
import { importerFiche, interpreterFiche, liste, numeros, lireSuite } from "../js/importFiche.js";
import { lireZip } from "../js/importWord.js";
import { creerZip } from "../js/zip.js";
import { nettoyer } from "../js/store.js";
import { nouvelleProcedure, nouvelleOperation, signatureContenu } from "../js/model.js";
import fr from "../js/locales/fr.js";
import en from "../js/locales/en.js";

const fiche = () => fs.readFileSync(new URL("./fixtures/fiche-collecte-exemple.xlsx", import.meta.url));

// ---------- Lecture du classeur ----------
test("xlsx : adresses de cellules et textes partagés, en ligne, nombres, entités, _x000D_", () => {
  assert.deepEqual(adresse("B9"), { ligne: 9, colonne: 2 });
  assert.deepEqual(adresse("AA10"), { ligne: 10, colonne: 27 });
  assert.equal(adresse("pas une adresse"), null);
  const xml = '<sheetData><row r="1"><c r="A1" t="s"><v>1</v></c><c r="C1" t="inlineStr"><is><t>en ligne</t></is></c></row>' +
    '<row r="3"><c r="B3"><v>4</v></c><c r="D3" t="str"><f>A1</f><v>calc &amp; ul_x000D_é</v></c><c r="E3" t="s"><v>0</v></c></row></sheetData>';
  const grille = lireFeuille(xml, ["   ", "partagé"]);
  assert.deepEqual(grille[0], ["partagé", "", "en ligne"]);
  assert.deepEqual(grille[1] || [], []);
  assert.deepEqual(grille[2], ["", "4", "", "calc & ul\né"], "retour chariot en saut de ligne ; cellule blanche ignorée");
});

test("xlsx : les onglets du classeur, dans l'ordre, avec leur contenu", async () => {
  const feuilles = await lireClasseur(fiche());
  assert.deepEqual(feuilles.map((f) => f.nom), ["Guide", "Listes", "Cadrage", "Acteurs", "Procedure_N2", "IT-JUR-03", "Documents", "Indicateurs_Risques", "Synthese_Validation"]);
  const n2 = feuilles.find((f) => f.nom === "Procedure_N2").grille;
  assert.equal(n2[12][2], "Viser le contrat");
  assert.equal(n2[12][20], "IT-JUR-03");
});

test("xlsx : un fichier qui n'est pas un classeur est refusé proprement", async () => {
  await assert.rejects(() => lireClasseur(new TextEncoder().encode("pas un zip")), /pas_xlsx/);
  const word = creerZip([{ nom: "word/document.xml", donnees: "<w:document/>" }]);
  await assert.rejects(() => lireClasseur(word), /pas_xlsx/);
});

/** Un petit classeur fabriqué ici : { nomFeuille: [[cellules de la ligne 1], [ligne 2]…] } (textes en ligne). */
function classeur(onglets) {
  const col = (j) => String.fromCharCode(65 + j);
  const echapper = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const noms = Object.keys(onglets);
  return creerZip([
    { nom: "xl/workbook.xml", donnees: `<workbook><sheets>${noms.map((n, i) => `<sheet name="${echapper(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>` },
    { nom: "xl/_rels/workbook.xml.rels", donnees: `<Relationships>${noms.map((_, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>` },
    ...noms.map((n, i) => ({
      nom: `xl/worksheets/sheet${i + 1}.xml`,
      donnees: `<worksheet><sheetData>${onglets[n].map((l, r) => `<row r="${r + 1}">${l.map((c, j) => (c === "" ? "" : `<c r="${col(j)}${r + 1}" t="inlineStr"><is><t>${echapper(c)}</t></is></c>`)).join("")}</row>`).join("")}</sheetData></worksheet>`,
    })),
  ]);
}

// ---------- Interprétation ----------
test("liste et numéros : parenthèses respectées, plages, « ou Fin »", () => {
  assert.deepEqual(liste("Service demandeur (DG, Exploitation, Achats), Direction Générale ; -"), ["Service demandeur (DG, Exploitation, Achats)", "Direction Générale"]);
  assert.deepEqual(numeros("4,5"), [4, 5]);
  assert.deepEqual(numeros("1 à 3"), [1, 2, 3]);
  assert.deepEqual(numeros("Opération n° 4"), [4]);
  assert.deepEqual(numeros("2 ou Fin"), [2]);
});

test("un classeur qui n'est pas une fiche de collecte : rien n'est importé", async () => {
  const r = await importerFiche(classeur({ Feuil1: [["a", "b"]] }));
  assert.equal(r.procedure, null);
  assert.deepEqual(r.rapport.map((c) => c.cle), ["fiche.pas_modele"]);
});

test("fiche réelle anonymisée : identification, rôles, instructions, décisions, niveau 3", async () => {
  const { procedure, instructions, rapport } = await importerFiche(fiche());
  const p = nettoyer(procedure);
  assert.equal(p.meta.typeDocument, "procedure");
  assert.equal(p.meta.reference, "PR-JUR-03");
  assert.match(p.meta.titre, /^Gérer les contrats/);
  assert.equal(p.meta.organisation, "Société Exemple (groupe Exemple)");
  assert.equal(p.meta.processus, "JUR - Juridique");
  assert.equal(p.meta.declencheur, "Sollicitation du DAJ par un service pour un contrat.");
  assert.match(p.meta.fin, /^Contrat signé, diffusé et archivé/);
  assert.match(p.corps.objet[0].texte, /^Maîtriser le circuit d'un contrat/);
  assert.ok(p.corps.domaine.some((b) => b.type === "p" && /^Exclusions : /.test(b.texte)));
  // Rôles : ceux de l'onglet Acteurs, interne / externe et responsabilités repris.
  assert.deepEqual(p.roles.map((r) => r.nom), ["Toutes les directions", "Direction Administrative et Juridique (DAJ)", "Direction Générale", "Exploitation", "Agent de liaison"]);
  assert.equal(p.roles.find((r) => r.nom === "Exploitation").type, "externe");
  assert.match(p.roles.find((r) => r.nom.startsWith("Direction Adm")).responsabilite, /^Recueille le cahier des charges/);
  // Instructions : une par ligne du déroulé, dans l'ordre.
  assert.deepEqual(p.etapes.map((e) => e.libelle), [
    "Recueillir le cahier des charges", "Rédiger le contrat", "Négocier le contrat", "Viser le contrat", "Signer le contrat",
    "Obtenir la contre-signature", "Archiver le contrat", "Suivre les échéances des contrats", "Décider du renouvellement",
  ]);
  const role = (e) => p.roles.find((r) => r.id === e.roleId).nom;
  assert.equal(role(p.etapes[4]), "Direction Générale");
  const [e1, , , e4, , , , e8, e9] = p.etapes;
  assert.deepEqual([e1.entree, e1.sortie, e1.versQui], ["Demande de contrat", "Cahier des charges (éléments techniques et financiers)", "Direction Administrative et Juridique (DAJ)"]);
  assert.deepEqual(e1.informes, ["Service demandeur (DG, Exploitation, Achats ou autre)"], "autre acteur hors de la liste des rôles : cité");
  assert.deepEqual(e1.outils.map((o) => [o.type, o.nom]), [["document", "Cahier des charges"], ["materiel", "Mail"], ["materiel", "réunion"]]);
  assert.deepEqual(e8.contrainte, { actif: true, nature: "delai", texte: "2, 3 ou 6 mois avant l'échéance" });
  // Viser : contrôle (question de décision), Oui → suite normale (5), Non → retour à la négociation (3) ; niveau 3 IT-JUR-03.
  assert.equal(e4.controle.actif, true);
  assert.equal(e4.controle.critere, "Le contrat est-il conforme et prêt à signer ?");
  assert.equal(e4.condition, "Oui");
  assert.deepEqual(e4.alternatives.map((a) => [a.condition, a.vers]), [["Non", p.etapes[2].id]]);
  assert.deepEqual(e4.niveau3, { actif: true, code: "IT-JUR-03", intitule: "Viser un contrat avant signature" });
  // Décider du renouvellement (dernière) : Non → fin (suite normale), Oui → retour à la rédaction (2).
  assert.equal(e9.condition, "Non");
  assert.deepEqual(e9.alternatives.map((a) => [a.condition, a.vers]), [["Oui", p.etapes[1].id]]);
  assert.equal(e9.raci[p.roles.find((r) => r.nom === "Direction Générale").id], "I", "autre acteur de la liste des rôles : informé");
  // Résumé et signalements.
  assert.deepEqual(rapport[0], { gravite: "ok", cle: "fiche.resume", params: { roles: 5, etapes: 9, it: 1 } });
  assert.ok(rapport.some((c) => c.cle === "fiche.a_confirmer" && c.params.liste === "1, 2, 3, 4, 5, 6, 7, 8, 9"));
  assert.ok(rapport.some((c) => c.cle === "fiche.controles" && c.params.liste === "4, 9"));
  assert.equal(instructions.length, 1);
});

test("fiche : risques cotés (onglet Indicateurs_Risques) prioritaires, puis ceux du déroulé sans doublon ; indicateurs", async () => {
  const p = nettoyer((await importerFiche(fiche())).procedure);
  const [e1, , , e4, , , , e8] = p.etapes;
  // Opération 1 : « Cahier des charges incomplet » (coté 3 × 2, onglet des risques) et « Dépendance à une seule personne » (1 à 9).
  assert.deepEqual(e1.risques.map((r) => [r.risque, r.gravite, r.probabilite]), [
    ["Cahier des charges incomplet", "3", "2"], ["Dépendance à une seule personne", "3", "3"],
  ]);
  assert.match(e1.risques[0].mesure, /^Service demandeur impliqué/);
  // Opération 4 : « Contrat signé sans visa du DAJ » existe dans les deux onglets : une seule fois, avec sa cotation.
  assert.deepEqual(e4.risques.map((r) => [r.risque, r.gravite]), [["Contrat signé sans visa du DAJ", "3"]]);
  assert.deepEqual(e8.indicateur, { actif: true, nom: "Contrats à renouveler dans les 3 mois", formule: "Nombre de contrats dont l'échéance tombe dans les 3 mois", cible: "À définir", frequence: "Mensuelle" });
  assert.equal(e4.indicateur.nom, "Contrats signés avec visa du DAJ");
});

test("fiche : documents → enregistrements (section 10) et références (section 3)", async () => {
  const p = nettoyer((await importerFiche(fiche())).procedure);
  const enr = p.corps.enregistrements.find((b) => b.type === "tableau");
  assert.deepEqual(enr.colonnes, ["Nom du document", "Support", "Durée de conservation", "Lieu d'archivage"]);
  assert.deepEqual(enr.lignes[0], ["FO-JUR-04 — Cahier des charges (éléments techniques et financiers)", "Électronique", "À définir", "Dossier du contrat"]);
  assert.equal(enr.lignes.length, 5);
  const refs = p.corps.references.find((b) => b.type === "tableau");
  assert.deepEqual(refs.lignes, [["Fichier / Application", "", "Cachet de visa du DAJ"]]);
});

test("fiche : instruction de travail IT-JUR-03 — rôle, déclencheur, opérations, « Comment ? », autocontrôles, correctives", async () => {
  const { instructions, rapport } = await importerFiche(fiche());
  const it = nettoyer(instructions[0]);
  assert.equal(it.meta.typeDocument, "instruction");
  assert.equal(it.meta.reference, "IT-JUR-03");
  assert.equal(it.meta.titre, "Viser un contrat avant signature");
  assert.equal(it.meta.issueDe, "PR-JUR-03 — Viser le contrat");
  assert.equal(it.meta.declencheur, "Version finale du contrat arrêtée.");
  assert.equal(it.it.role.nom, "Direction Administrative et Juridique (DAJ)");
  assert.deepEqual(it.it.operations.map((o) => o.libelle), [
    "Vérifier la conformité juridique", "Contrôler la cohérence technique", "Vérifier les pouvoirs du signataire", "Apposer le cachet de visa", "Transmettre à la DG",
  ]);
  const [o1, , , o4, o5] = it.it.operations;
  assert.equal(o1.commentaire, "Relire le contrat au regard du droit applicable — Point clé : Clauses conformes");
  assert.equal(o1.entree, "Version finale", "entrée de la 1re opération : celle de l'instruction de la procédure");
  assert.equal(o5.sortie, "Contrat visé (cachet du DAJ sur les pages)");
  assert.deepEqual(o1.controles.map((c) => c.question), ["Contrat conforme ?"]);
  assert.deepEqual(o1.correctives.map((m) => m.libelle), ["Retour à la négociation"]);
  assert.deepEqual(o1.controles[0].correctives, [o1.correctives[0].id], "contrôle relié à son action corrective");
  assert.equal(o1.vigilance, true);
  assert.equal(o4.enregistrement, true, "« Contrat visé » : enregistrement produit");
  assert.equal(o1.enregistrement, false, "« - » : pas d'enregistrement");
  // Cadrage sans place sur la feuille niveau 3 : dans le rapport ; « - » (EPI) n'y figure pas.
  assert.ok(rapport.some((c) => c.cle === "fiche.it.prerequis" && c.params.texte === "Compétence juridique."));
  assert.ok(!rapport.some((c) => c.cle === "fiche.it.epi"));
});

test("fiche : points ouverts non clos de la synthèse (pas la section des signatures)", async () => {
  const { rapport } = await importerFiche(fiche());
  const points = rapport.filter((c) => c.cle === "fiche.point_ouvert").map((c) => c.params.texte);
  assert.deepEqual(points, ["Ordre des signatures : autre partie avant ou après la DG", "Qui assure le dépôt des contrats en ville"]);
});

test("fiche : renvoi vers une opération inexistante signalé ; acteur absent de l'onglet Acteurs créé", () => {
  const entete = ["N°", "Étape", "Opération", "Symbole Qualigramme", "Acteur responsable", "Autres acteurs", "Question de décision", "Si OUI → op. n°", "Si NON → op. n°"];
  const r = interpreterFiche([
    { nom: "Cadrage", grille: [["1", "Intitulé de la procédure", "aide", "Traiter les demandes"]] },
    { nom: "Procedure_N2", grille: [entete, ["1", "", "Analyser la demande", "Décision / Alternative (Ou)", "Accueil", "", "Complète ?", "2", "7"], ["2", "", "Répondre", "Instruction (tâche)", "Accueil"]] },
  ]);
  const p = nettoyer(r.procedure);
  assert.equal(p.meta.titre, "Traiter les demandes");
  assert.deepEqual(p.roles.map((x) => x.nom), ["Accueil"]);
  assert.equal(p.etapes[0].condition, "Oui");
  assert.deepEqual(p.etapes[0].alternatives, [], "suite « 7 » inconnue : pas d'alternative");
  assert.ok(r.rapport.some((c) => c.cle === "fiche.renvoi_inconnu" && c.params.vers === "7"));
  assert.ok(r.rapport.some((c) => c.cle === "fiche.role_ajoute" && c.params.nom === "Accueil"));
  assert.equal(p.etapes[0].controle.actif, false, "une décision n'est pas un contrôle");
});

test("textes du rapport : FR et EN, mêmes variables", () => {
  const cles = Object.keys(fr).filter((k) => k.startsWith("fiche.") || k === "fichier.importer_fiche");
  assert.ok(cles.length > 30);
  const variables = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
  for (const k of cles) {
    assert.ok(k in en, `${k} absent en anglais`);
    assert.equal(variables(en[k]), variables(fr[k]), `${k} : variables différentes`);
  }
});

// ---------- Fiche allégée FC-JAL (modèle téléchargeable : public/modeles/FC-JAL_Fiche_de_collecte.xlsx) ----------
const ficheJalonia = () => fs.readFileSync(new URL("./fixtures/fiche-collecte-jalonia-exemple.xlsx", import.meta.url));
const modeleVierge = () => fs.readFileSync(new URL("../../public/modeles/FC-JAL_Fiche_de_collecte.xlsx", import.meta.url));

test("FC-JAL : la suite d'une décision en une colonne", () => {
  assert.deepEqual(lireSuite("Oui → 5 ; Non → 3"), { oui: "5", non: "3" });
  assert.deepEqual(lireSuite("Non → Fin"), { oui: "", non: "fin" });
  assert.deepEqual(lireSuite("oui -> op. n° 2, non : fin"), { oui: "2", non: "fin" });
  assert.deepEqual(lireSuite("à voir"), { oui: "", non: "" });
});

test("FC-JAL : exemple rempli — Déroulé, Type, Suite, Code IT, risques et indicateurs de leur onglet, points ouverts", async () => {
  const { procedure, instructions, rapport } = await importerFiche(ficheJalonia());
  const p = nettoyer(procedure);
  assert.equal(p.meta.reference, "PR-JUR-03");
  assert.equal(p.meta.titre, "Gérer les contrats");
  assert.deepEqual(p.roles.map((r) => r.nom), ["Service demandeur", "Direction Administrative et Juridique (DAJ)", "Direction Générale", "Client ou fournisseur"]);
  assert.equal(p.roles.find((r) => r.nom === "Client ou fournisseur").type, "externe");
  assert.equal(p.etapes.length, 5);
  const e4 = p.etapes[3];
  assert.equal(e4.libelle, "Viser le contrat");
  assert.equal(e4.controle.actif, true, "Type « Contrôle »");
  assert.equal(e4.condition, "Oui");
  assert.deepEqual(e4.alternatives.map((a) => [a.condition, a.vers]), [["Non", p.etapes[2].id]], "Suite « Oui → 5 ; Non → 3 »");
  assert.deepEqual(e4.niveau3, { actif: true, code: "IT-JUR-03", intitule: "Viser un contrat avant signature" }, "Code IT seul : niveau 3");
  assert.deepEqual(e4.risques.map((r) => [r.risque, r.gravite, r.probabilite]), [["Contrat signé sans visa du DAJ", "3", "2"]]);
  assert.equal(e4.indicateur.nom, "Contrats à renouveler dans les 3 mois");
  assert.deepEqual(p.etapes[0].outils.map((o) => [o.type, o.nom]), [["document", "Cahier des charges"], ["materiel", "Mail"], ["materiel", "réunion"]]);
  assert.equal(p.corps.enregistrements.find((b) => b.type === "tableau").lignes.length, 2);
  // Instruction de travail : « Si anomalie : que faire ? » = action corrective, et l'opération est à vigilance.
  const it = nettoyer(instructions[0]);
  assert.equal(it.meta.reference, "IT-JUR-03");
  assert.equal(it.it.operations.length, 2);
  assert.deepEqual(it.it.operations[0].correctives.map((m) => m.libelle), ["Retour à la négociation"]);
  assert.equal(it.it.operations[0].vigilance, true);
  assert.equal(it.it.operations[1].enregistrement, true);
  assert.deepEqual(rapport.filter((c) => c.cle === "fiche.point_ouvert").map((c) => c.params.texte), ["Ordre des signatures : autre partie avant ou après la DG"]);
  assert.ok(!rapport.some((c) => c.gravite === "erreur"));
});

test("FC-JAL : une suite illisible est signalée (destinations à choisir)", () => {
  const entete = ["N°", "Opération (verbe à l'infinitif)", "Type", "Acteur", "Question (si décision)", "Suite (si décision)"];
  const r = interpreterFiche([
    { nom: "Cadrage", grille: [["1", "Intitulé de la procédure", "aide", "Traiter"]] },
    { nom: "Déroulé", grille: [entete, ["1", "Analyser", "Décision (Oui / Non)", "Accueil", "Complet ?", "selon le cas"], ["2", "Répondre", "Instruction", "Accueil"]] },
  ]);
  assert.ok(r.rapport.some((c) => c.cle === "fiche.suite_illisible" && c.params.suite === "selon le cas"));
  assert.deepEqual(nettoyer(r.procedure).etapes[0].alternatives, []);
});

test("FC-JAL : le modèle vierge s'importe sans erreur ; le code de la fiche se forme d'après le code de la procédure", async () => {
  const r = await importerFiche(modeleVierge());
  assert.ok(r.procedure, "le modèle est reconnu");
  assert.ok(!r.rapport.some((c) => c.gravite === "erreur"));
  assert.ok(r.rapport.some((c) => c.cle === "fiche.titre_absent"));
  // Formule de la ligne 3 de chaque onglet : « FC-JAL- » + code saisi dans le Cadrage (D10, « Code envisagé »).
  const feuilles = await lireClasseur(modeleVierge());
  assert.deepEqual(feuilles.map((f) => f.nom), ["Mode d'emploi", "Cadrage", "Acteurs", "Déroulé", "IT-modèle", "Documents", "Risques_Indicateurs", "Points ouverts", "Listes"]);
  assert.match(feuilles.find((f) => f.nom === "Cadrage").grille[9][1], /^Code envisagé/);
  const xml = await lireZip(modeleVierge(), "xl/worksheets/sheet2.xml");
  assert.match(xml.replace(/&quot;/g, '"'), /"FC-JAL-"&amp;IF\(Cadrage!\$D\$10="","XX-XX-XX",Cadrage!\$D\$10\)/);
});

// ---------- « Comment ? » d'une opération (instruction de travail) ----------
test("commentaire d'opération : gardé par nettoyer ; une instruction sans commentaire garde sa signature", () => {
  const p = nouvelleProcedure();
  p.meta.typeDocument = "instruction";
  p.it.role.nom = "Opérateur";
  p.it.operations.push(nouvelleOperation({ id: "p1", libelle: "Contrôler" }));
  const avant = signatureContenu(p);
  const sansChamp = JSON.parse(JSON.stringify(p));
  delete sansChamp.it.operations[0].commentaire;
  assert.equal(signatureContenu(sansChamp), avant, "fichier d'avant la v1.9 : même signature");
  p.it.operations[0].commentaire = "Serrer à 25 N·m";
  assert.notEqual(signatureContenu(p), avant, "un commentaire renseigné change la signature");
  assert.equal(nettoyer(p).it.operations[0].commentaire, "Serrer à 25 N·m");
  assert.equal(nettoyer(sansChamp).it.operations[0].commentaire, "");
});
