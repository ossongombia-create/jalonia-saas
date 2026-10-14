// Tests v0.26 — le QUESTIONNEMENT EN 11 POINTS (Qui ? Quoi ? Quelle information en entrée ? D'où vient-elle ? De qui vient-elle ? Comment ?
// Avec quoi ? Quelle information en sortie ? Vers quoi ? Vers qui ? Sous quelles contraintes ?) : pistes de contrôle pour les procédures
// ET les instructions de travail. Erreur pour les points essentiels, alerte pour « Comment ? », « Avec quoi ? » et « Contraintes ».
// Rien n'est affiché sous forme de tableau ; les points non respectés apparaissent dans le diagnostic, la ligne de la synthèse n'apparaît
// que si les 11 points sont respectés.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { POINTS, questionnement, constatsQuestionnement, sansDoublons } from "../js/questionnement.js";
import { constatsDiagnostic } from "../js/diagnostic.js";
import { bloquantsSynthese, manquants } from "../js/parcours.js";
import { nouvelleProcedure, nouvelleEtape, nouvelleOperation, nouvelleAlternative, signatureContenu } from "../js/model.js";
import { verifier } from "../js/rules.js";
import { verifierIT } from "../js/rules-it.js";
import { exempleProcedure } from "../js/exemple-procedure.js";
import { exempleInstruction } from "../js/exemple-it.js";
import { definirLangue, t } from "../js/i18n.js";
import fr from "../js/locales/fr.js";
import en from "../js/locales/en.js";
import { PROPRE, SIGLE, CODES_PROCESSUS_PROPRES } from "./neutralite.mjs";

const source = (chemin) => fs.readFileSync(new URL("../" + chemin, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const sansCasse = [PROPRE, SIGLE, CODES_PROCESSUS_PROPRES].map((re) => new RegExp(re.source, "i"));
const carto = { nomenclature: { controle: false, procedure: "PR" }, processus: [], flux: [], documents: [] };
definirLangue("fr");

// ---------- Fixtures : un document qui respecte les 11 points ----------
function procedureComplete() {
  const p = nouvelleProcedure();
  p.roles = [{ id: "r1", nom: "Chargé de clientèle", type: "individuel" }, { id: "r2", nom: "Responsable logistique", type: "individuel" }];
  p.meta = { ...p.meta, titre: "Traiter une commande", reference: "PR-VEN-01", declencheur: "Commande reçue", fin: "Commande clôturée", typeDocument: "procedure" };
  p.etapes = [
    nouvelleEtape({ roleId: "r1", libelle: "Enregistrer la commande", entree: "Commande", entreeDe: "Client", sortie: "Commande enregistrée", versQui: "Responsable logistique",
      outils: [{ id: "o1", type: "document", nom: "Bon de commande" }], contrainte: { actif: true, nature: "delai", texte: "24 h au plus" } }),
    nouvelleEtape({ roleId: "r2", libelle: "Expédier la commande", entree: "Commande enregistrée", sortie: "Commande expédiée", versQui: "Client",
      outils: [{ id: "o2", type: "document", nom: "Bon de livraison" }], controle: { actif: true, nature: "Q", critere: "Quantités conformes", enregistrement: "" } }),
  ];
  return p;
}
function instructionComplete() {
  const p = nouvelleProcedure();
  p.meta = { ...p.meta, titre: "Enregistrer une commande", reference: "IT-VEN-01", typeDocument: "instruction", niveau: 3,
    declencheur: "Commande validée", fin: "Commande enregistrée",
    amont: { texte: "Valider la commande", role: "Direction", information: "Commande validée" },
    aval: { texte: "Expédier la commande", role: "Responsable logistique", information: "Commande enregistrée" } };
  p.it.role = { nom: "Chargé de clientèle" };
  const outil = (id) => [{ id, type: "materiel", nom: "Logiciel de gestion" }];
  p.it.operations = [
    nouvelleOperation({ id: "p1", libelle: "Vérifier la commande", entree: "Commande validée", sortie: "Commande complète", outils: outil("o1"), contrainte: { actif: true, nature: "delai", texte: "Le jour même" } }),
    nouvelleOperation({ id: "p2", libelle: "Saisir la commande", outils: outil("o2"), enregistrement: true, sortie: "Commande enregistrée" }),
  ];
  return p;
}
const points = (p) => Object.fromEntries(questionnement(p).points.map((x) => [x.cle, x.manquants]));
const cles = (p) => constatsQuestionnement(p).map((c) => c.cle);

// ---------- Les 11 points, leur gravité ----------
test("les 11 points sont dans l'ordre du questionnement ; erreur pour les points essentiels, alerte pour Comment, Avec quoi et Contraintes", () => {
  assert.deepEqual(POINTS.map((x) => x.n), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  assert.deepEqual(POINTS.map((x) => x.cle), ["qui", "quoi", "entree", "dou", "dequi", "comment", "avec", "sortie", "versquoi", "versqui", "contraintes"]);
  const alertes = POINTS.filter((x) => x.gravite === "alerte").map((x) => x.cle);
  assert.deepEqual(alertes, ["comment", "avec", "contraintes"]);
  assert.equal(POINTS.filter((x) => x.gravite === "erreur").length, 8);
});

// ---------- Procédure ----------
test("procédure : un document qui respecte les 11 points ne donne aucun constat et « respectes » est vrai", () => {
  const p = procedureComplete();
  assert.equal(questionnement(p).respectes, true);
  assert.equal(questionnement(p).unites, 2);
  assert.deepEqual(constatsQuestionnement(p), []);
  assert.deepEqual(bloquantsSynthese(p), []);
});

test("procédure : chaque point non respecté est repéré, avec la liste des instructions concernées et la bonne gravité", () => {
  const cas = [
    ["qui", (p) => { p.etapes[1].roleId = ""; }, "2", "erreur"],
    ["quoi", (p) => { p.etapes[0].libelle = " "; }, "1", "erreur"],
    ["entree", (p) => { p.etapes[1].entree = ""; }, "2", "erreur"],
    ["dou", (p) => { p.meta.declencheur = ""; }, "1", "erreur"],
    ["dequi", (p) => { p.etapes[0].entreeDe = ""; }, "1", "erreur"],
    ["comment", (p) => { p.etapes[0].outils = [{ id: "z", type: "materiel", nom: "Logiciel" }]; }, "1", "alerte"],
    ["avec", (p) => { p.etapes[1].outils = []; }, "2", "alerte"],
    ["sortie", (p) => { p.etapes[0].sortie = ""; }, "1", "erreur"],
    ["versquoi", (p) => { p.meta.fin = ""; }, "2", "erreur"],
    ["versqui", (p) => { p.etapes[1].versQui = ""; }, "2", "erreur"],
    ["contraintes", (p) => { p.etapes[0].contrainte = { actif: false, nature: "", texte: "" }; }, "1", "alerte"],
  ];
  cas.forEach(([cle, casse, liste, gravite]) => {
    const p = procedureComplete();
    casse(p);
    const c = constatsQuestionnement(p).find((x) => x.cle === `quest.procedure.${cle}`);
    assert.ok(c, `le point « ${cle} » doit être signalé`);
    assert.equal(c.gravite, gravite, cle);
    assert.equal(c.params.liste, liste, cle);
    assert.equal(questionnement(p).respectes, false, cle);
  });
});

test("procédure : ce qui se déduit de l'enchaînement n'est pas redemandé (rôle de l'instruction précédente ou suivante, sortie de la dernière = action aval)", () => {
  const p = procedureComplete();
  // « De qui » de la 2e instruction : le rôle de la 1re ; « Vers qui » de la 1re : le rôle de la 2e.
  p.etapes[1].entreeDe = "";
  p.etapes[0].versQui = "";
  assert.deepEqual(points(p).dequi, []);
  assert.deepEqual(points(p).versqui, []);
  // La dernière : le rôle de l'action aval remplace « Vers qui » ; l'information aval remplace la sortie.
  p.etapes[1].versQui = "";
  assert.deepEqual(points(p).versqui, [2]);
  p.meta.aval = { texte: "Facturer", role: "Comptable", information: "Commande expédiée" };
  assert.deepEqual(points(p).versqui, []);
  p.etapes[1].sortie = "";
  assert.deepEqual(points(p).sortie, []);
  // La 1re : l'action amont fournit le rôle et l'information d'entrée.
  p.etapes[0].entreeDe = "";
  p.etapes[0].entree = "";
  p.meta.amont = { texte: "Vendre", role: "Commercial", information: "Commande" };
  assert.deepEqual(points(p).dequi, []);
  assert.deepEqual(points(p).entree, []);
});

test("procédure : une décision dont un cas ne mène nulle part est signalée à « Vers quoi ? »", () => {
  const p = procedureComplete();
  p.etapes[0].condition = "Complète";
  p.etapes[0].alternatives = [nouvelleAlternative({ id: "a1", condition: "Incomplète", info: "Pièce manquante", vers: "" })];
  assert.deepEqual(points(p).versquoi, [1]);
  p.etapes[0].alternatives[0].vers = p.etapes[0].id;
  assert.deepEqual(points(p).versquoi, []);
});

test("procédure : « Comment ? » est tenu par une instruction de travail, une sous-procédure ou un document ; « Contraintes » par un délai, un contrôle, un risque maîtrisé, un indicateur ou un contrat", () => {
  const p = procedureComplete();
  p.etapes[0].outils = [{ id: "z", type: "materiel", nom: "Logiciel" }];
  assert.deepEqual(points(p).comment, [1]);
  p.etapes[0].niveau3 = { actif: true, code: "IT-VEN-02", intitule: "Saisir" };
  assert.deepEqual(points(p).comment, []);
  p.etapes[0].niveau3 = { actif: false, code: "", intitule: "" };
  p.etapes[0].sousProcedure = { actif: true, code: "PR-VEN-02" };
  assert.deepEqual(points(p).comment, []);
  const q = procedureComplete();
  const autres = [
    (e) => { e.contrainte = { actif: false, nature: "", texte: "" }; e.controle = { actif: true, nature: "Q", critere: "Conforme", enregistrement: "" }; },
    (e) => { e.contrainte = { actif: false, nature: "", texte: "" }; e.risques = [{ id: "k", risque: "Perte", causes: "", gravite: "2", probabilite: "2", mesure: "Sauvegarde" }]; },
    (e) => { e.contrainte = { actif: false, nature: "", texte: "" }; e.indicateur = { actif: true, nom: "Taux de commandes", formule: "", cible: "", frequence: "" }; },
    (e) => { e.contrainte = { actif: false, nature: "", texte: "" }; e.contrat = { actif: true, reference: "CT-01" }; },
  ];
  autres.forEach((f) => {
    const r = procedureComplete();
    r.etapes[0].contrainte = { actif: false, nature: "", texte: "" };
    assert.deepEqual(points(r).contraintes, [1]);
    f(r.etapes[0]);
    assert.deepEqual(points(r).contraintes, [], "un autre moyen suffit à tenir le point");
  });
  assert.deepEqual(points(q).contraintes, []);
});

test("procédure : un document vide ne donne aucun constat (rien à contrôler tant qu'il n'y a pas d'instruction)", () => {
  const p = nouvelleProcedure();
  assert.equal(questionnement(p).unites, 0);
  assert.equal(questionnement(p).respectes, false);
  assert.deepEqual(constatsQuestionnement(p), []);
});

// ---------- Instruction de travail ----------
test("instruction de travail : un document qui respecte les 11 points ne donne aucun constat", () => {
  const p = instructionComplete();
  assert.equal(questionnement(p).type, "instruction");
  assert.equal(questionnement(p).respectes, true);
  assert.equal(questionnement(p).unites, 2);
  assert.deepEqual(constatsQuestionnement(p), []);
  assert.deepEqual(bloquantsSynthese(p), []);
});

test("instruction de travail : chaque point non respecté est repéré, avec la liste des opérations et la bonne gravité", () => {
  const cas = [
    ["quoi", (p) => { p.it.operations[1].libelle = ""; }, "2", "erreur"],
    ["entree", (p) => { p.it.operations[0].entree = ""; p.meta.amont.information = ""; }, "1", "erreur"],
    ["dou", (p) => { p.meta.declencheur = ""; p.meta.amont.texte = ""; }, "1", "erreur"],
    ["dequi", (p) => { p.meta.amont.role = ""; }, "1", "erreur"],
    ["avec", (p) => { p.it.operations[1].outils = []; }, "2", "alerte"],
    ["sortie", (p) => { p.it.operations[1].sortie = ""; p.meta.aval.information = ""; }, "2", "erreur"],
    ["versquoi", (p) => { p.meta.fin = ""; p.meta.aval.texte = ""; }, "2", "erreur"],
    ["versqui", (p) => { p.meta.aval.role = ""; }, "2", "erreur"],
    ["contraintes", (p) => { p.it.operations[0].contrainte = { actif: false, nature: "", texte: "" }; }, "1", "alerte"],
  ];
  cas.forEach(([cle, casse, liste, gravite]) => {
    const p = instructionComplete();
    casse(p);
    const c = constatsQuestionnement(p).find((x) => x.cle === `quest.instruction.${cle}`);
    assert.ok(c, `le point « ${cle} » doit être signalé`);
    assert.equal(c.gravite, gravite, cle);
    assert.equal(c.params.liste, liste, cle);
  });
});

test("instruction de travail : le rôle manquant concerne tout le document (pas de liste) ; l'information d'une flèche vient de la sortie précédente ou de l'entrée suivante", () => {
  const p = instructionComplete();
  p.it.role.nom = "";
  const c = constatsQuestionnement(p).find((x) => x.cle === "quest.instruction.qui");
  assert.equal(c.gravite, "erreur");
  assert.deepEqual(c.params, {});
  // Une flèche, un seul constat : l'entrée de l'opération 2 est la sortie de l'opération 1 (point 8), jamais comptée deux fois.
  const q = instructionComplete();
  q.it.operations[1].entree = "";
  assert.deepEqual(points(q).entree, [], "la sortie de l'opération 1 en tient lieu");
  q.it.operations[0].sortie = "";
  assert.deepEqual(points(q).sortie, [1], "la flèche sans information est signalée une seule fois, à la sortie de l'opération 1");
  assert.deepEqual(points(q).entree, []);
  // L'entrée de l'opération 2 suffit aussi à donner l'information de la flèche.
  q.it.operations[1].entree = "Commande complète";
  assert.deepEqual(points(q).sortie, []);
});

test("instruction de travail : les blocs amont et aval sont facultatifs — leur rôle n'est demandé que si l'action amont ou aval est décrite", () => {
  const p = instructionComplete();
  p.meta.amont = { texte: "", role: "", information: "" };
  p.meta.aval = { texte: "", role: "", information: "" };
  p.it.operations[1].sortie = "Commande enregistrée";
  assert.deepEqual(points(p).dequi, []);
  assert.deepEqual(points(p).versqui, []);
  assert.deepEqual(bloquantsSynthese(p), [], "une instruction sans action amont ni aval se valide");
  p.meta.amont.texte = "Valider la commande";
  p.meta.aval.texte = "Expédier la commande";
  assert.deepEqual(points(p).dequi, [1]);
  assert.deepEqual(points(p).versqui, [2]);
});

// ---------- Diagnostic et validation ----------
test("diagnostic : les points manquants apparaissent dans la liste des constats, les points respectés n'y sont jamais", () => {
  const p = procedureComplete();
  assert.ok(!constatsDiagnostic(p, carto).some((c) => c.cle.startsWith("quest.")), "rien à signaler");
  p.etapes[1].versQui = "";
  p.etapes[0].outils = [{ id: "z", type: "materiel", nom: "Logiciel" }];
  const quest = constatsDiagnostic(p, carto).filter((c) => c.cle.startsWith("quest."));
  assert.deepEqual(quest.map((c) => c.cle).sort(), ["quest.procedure.comment", "quest.procedure.versqui"]);
  assert.ok(!constatsDiagnostic(p, carto).some((c) => c.gravite === "ok"), "« Aucune anomalie » disparaît dès qu'un point manque");
});

test("validation : une ERREUR du questionnement bloque la synthèse, une ALERTE non", () => {
  const p = procedureComplete();
  p.etapes[0].contrainte = { actif: false, nature: "", texte: "" }; // alerte
  p.etapes[0].outils = [{ id: "z", type: "materiel", nom: "Logiciel" }]; // alerte
  assert.deepEqual(bloquantsSynthese(p), []);
  p.etapes[1].versQui = ""; // erreur : Vers qui ?
  assert.deepEqual(bloquantsSynthese(p).map((c) => c.cle), ["quest.procedure.versqui"]);
  assert.ok(manquants(p, 3).some((m) => m.cle === "quest.procedure.versqui"));
  const q = instructionComplete();
  q.meta.aval.role = "";
  assert.deepEqual(bloquantsSynthese(q).map((c) => c.cle), ["quest.instruction.versqui"]);
});

test("pas de doublon : une règle plus ancienne disparaît quand le point correspondant du questionnement est signalé", () => {
  const p = procedureComplete();
  p.etapes[1].libelle = "";
  const anciens = verifier(p, { nomenclature: carto.nomenclature });
  assert.ok(anciens.some((c) => c.cle === "regle.etape.libelle_vide"));
  assert.ok(!sansDoublons(anciens, p).some((c) => c.cle === "regle.etape.libelle_vide"), "l'ancien message est remplacé");
  assert.ok(constatsDiagnostic(p, carto).some((c) => c.cle === "quest.procedure.quoi"));
  assert.ok(!constatsDiagnostic(p, carto).some((c) => c.cle === "regle.etape.libelle_vide"));
  // Tant que le point du questionnement n'est pas signalé, la règle plus ancienne reste.
  const q = instructionComplete();
  q.it.operations[0].libelle = "";
  assert.ok(verifierIT(q).some((c) => c.cle === "regle3.operation.libelle_vide"), "la règle plus ancienne existe bien");
  assert.ok(!sansDoublons(verifierIT(q), q).some((c) => c.cle === "regle3.operation.libelle_vide"));
});

test("pas de doublon non plus pour le rôle amont / aval et pour la destination d'une décision ; la décision de la dernière instruction est contrôlée", () => {
  const q = instructionComplete();
  q.meta.amont.role = "";
  assert.ok(verifierIT(q).some((c) => c.cle === "regle3.raccord.amont_sans_role"), "l'ancienne alerte existe");
  assert.ok(!constatsDiagnostic(q, carto).some((c) => c.cle === "regle3.raccord.amont_sans_role"));
  assert.ok(constatsDiagnostic(q, carto).some((c) => c.cle === "quest.instruction.dequi"));
  const p = procedureComplete();
  p.etapes[1].condition = "Conforme";
  p.etapes[1].alternatives = [nouvelleAlternative({ id: "a9", condition: "Non conforme", info: "Écart", vers: "" })];
  assert.deepEqual(points(p).versquoi, [2], "dernière instruction : chaque cas doit mener quelque part (une autre instruction ou la fin)");
  assert.ok(verifier(p, { nomenclature: carto.nomenclature }).some((c) => c.cle === "regle.decision.destination_absente"));
  assert.ok(!constatsDiagnostic(p, carto).some((c) => c.cle === "regle.decision.destination_absente"));
  p.etapes[1].alternatives[0].vers = "fin";
  assert.deepEqual(points(p).versquoi, []);
});

// ---------- Les exemples ----------
test("l'exemple d'instruction respecte les 11 points ; l'exemple de procédure ne bloque rien (ses alertes sont non bloquantes)", () => {
  assert.equal(questionnement(exempleInstruction()).respectes, true);
  const p = exempleProcedure();
  assert.equal(questionnement(p).respectes, false);
  assert.ok(questionnement(p).points.filter((x) => x.manquants.length).every((x) => x.gravite === "alerte"), "seules des alertes");
  assert.deepEqual(bloquantsSynthese(p), []);
  assert.deepEqual(bloquantsSynthese(exempleInstruction()), []);
});

// ---------- Textes FR / EN ----------
test("chaque constat possible a son texte en français ET en anglais, avec la liste en paramètre", () => {
  const types = ["procedure", "instruction"];
  types.forEach((type) => POINTS.forEach((pt) => {
    if (type === "instruction" && pt.cle === "comment") return; // l'opération EST la manière de faire : jamais signalé
    const cle = `quest.${type}.${pt.cle}`;
    assert.ok(typeof fr[cle] === "string" && fr[cle].length > 10, `FR ${cle}`);
    assert.ok(typeof en[cle] === "string" && en[cle].length > 10, `EN ${cle}`);
    if (!(type === "instruction" && pt.cle === "qui")) {
      assert.ok(fr[cle].includes("{liste}") && en[cle].includes("{liste}"), `${cle} : la liste est affichée`);
    }
  }));
  ["synth.indic.questionnement.procedure", "synth.indic.questionnement.instruction"].forEach((cle) => {
    assert.ok(fr[cle].includes("{n}") && en[cle].includes("{n}"), cle);
    assert.ok(fr[cle].includes("11") && en[cle].includes("11"), cle);
  });
});

test("les textes affichés reprennent les mots du questionnement", () => {
  const p = procedureComplete();
  p.etapes[1].versQui = "";
  const c = constatsQuestionnement(p)[0];
  assert.equal(t(c.cle, c.params), "Questionnement « Vers qui ? » — instruction(s) 2 : le rôle qui reçoit le résultat n'est pas renseigné.");
  definirLangue("en");
  assert.equal(t(c.cle, c.params), "Questioning “Towards whom?” — instruction(s) 2: the role that receives the result is not filled in.");
  definirLangue("fr");
  assert.equal(t("synth.indic.questionnement.procedure", { n: 10 }), "Questionnement en 11 points : les 11 points sont respectés (instructions contrôlées : 10).");
  assert.equal(t("synth.indic.questionnement.instruction", { n: 7 }), "Questionnement en 11 points : les 11 points sont respectés (opérations contrôlées : 7).");
});

// ---------- Affichage : une ligne dans « Conformité et longueur », jamais de tableau ----------
test("la synthèse écrit la ligne du questionnement seulement quand les 11 points sont respectés, et n'affiche aucun tableau des 11 points", () => {
  ["js/synthese.js", "js/synthese-it.js"].forEach((f) => {
    const s = source(f);
    assert.match(s, /questions\.respectes \? h\("li", \{ class: "ok" \}, t\("synth\.indic\.questionnement\./, `${f} : la ligne n'apparaît que si tout est respecté`);
    assert.ok(!/POINTS|tableau\(\[[^\]]*quest/.test(s), `${f} : aucun tableau des 11 points`);
  });
  // Les points non respectés sont dans les listes « À corriger » / « Points d'attention » (constats), pas dans un tableau.
  assert.match(source("js/diagnostic.js"), /constatsQuestionnement\(p\)/);
  assert.match(source("js/parcours.js"), /constatsQuestionnement\(p\)/);
});

test("le questionnement ne change ni le document écrit ni la signature de validation", () => {
  const p = exempleProcedure();
  const avant = JSON.stringify(p);
  const signature = signatureContenu(p);
  questionnement(p); constatsQuestionnement(p); constatsDiagnostic(p, carto); bloquantsSynthese(p);
  assert.equal(JSON.stringify(p), avant, "aucun champ ajouté ni modifié");
  assert.equal(signatureContenu(p), signature);
  assert.ok(!/questionnement/.test(source("js/model.js")), "model.js ne connaît pas le questionnement");
  assert.ok(!/questionnement/.test(source("js/document.js")), "le document Word / PDF ne reçoit aucun tableau des 11 points");
});

// ---------- Neutralité de tout l'arbre publié ----------
test("aucun nom d'entreprise, de lieu ou de code propre n'apparaît dans les fichiers de l'application (balayage de tout l'arbre)", () => {
  const racine = fileURLToPath(new URL("../", import.meta.url));
  // Hors de l'application : archives des versions, copies de publication anciennes, notes de livraison anciennes (présentes seulement sur le poste de travail).
  const exclus = new Set(["versions", "vendor", "docs", "exercices", "node_modules", ".git", "tests", "fonts", "publication-github"]);
  const trouves = [];
  const parcourir = (dossier) => {
    fs.readdirSync(dossier, { withFileTypes: true }).forEach((entree) => {
      if (exclus.has(entree.name)) return;
      const chemin = path.join(dossier, entree.name);
      if (entree.isDirectory()) return parcourir(chemin);
      if (!/\.(js|mjs|html|css|md|svg|json|txt)$/.test(entree.name)) return;
      if (/^LISEZ-MOI-/.test(entree.name)) return;
      const texte = fs.readFileSync(chemin, "utf8");
      // Sans tenir compte des majuscules : un nom de fichier ou un mot en minuscules compte aussi.
      if (sansCasse.some((re) => re.test(texte) || re.test(entree.name))) trouves.push(path.relative(racine, chemin));
    });
  };
  parcourir(racine);
  assert.deepEqual(trouves, []);
});
