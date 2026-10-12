// Tests v0.28 — APPRÉCIATION des risques et des opportunités (méthode FD X 50-176 / ISO 9001 §6.1, décisions Brice du 03/10/2026).
// Risque : criticité = Impact × Vraisemblance (1-4) ; critique si C ≥ 9 OU Impact = 4 ; significatif 5-8 ; acceptable ≤ 4.
// Opportunité (nouveau, par instruction) : intérêt × faisabilité (1-3) ; score ≥ 6 → plan d'amélioration, sinon à étudier.
// Vocabulaire affiché : Gravité → Impact, Probabilité → Vraisemblance (les champs de données restent gravite/probabilite).
import test from "node:test";
import assert from "node:assert/strict";
import { criticite, scoreOpportunite, nouvelleOpportunite, nouvelleProcedure, nouvelleEtape, signatureContenu } from "../js/model.js";
import { construireDocument, listeOpportunites } from "../js/document.js";
import { verifier } from "../js/rules.js";
import * as store from "../js/store.js";
import { definirLangue, t } from "../js/i18n.js";
import fr from "../js/locales/fr.js";
import en from "../js/locales/en.js";

const carto = { nomenclature: { controle: false, procedure: "PR" } };
definirLangue("fr");

// ---------- Risque : criticité et la règle Impact = 4 ----------
test("criticité : seuils ≤4 / 5-8 / ≥9, et toute Impact = 4 est critique quelle que soit la vraisemblance", () => {
  assert.deepEqual(criticite({ gravite: "1", probabilite: "3" }), { valeur: 3, g: 1, p: 3, niveau: "acceptable" });
  assert.equal(criticite({ gravite: "2", probabilite: "2" }).niveau, "acceptable"); // 4
  assert.equal(criticite({ gravite: "2", probabilite: "3" }).niveau, "significatif"); // 6
  assert.equal(criticite({ gravite: "2", probabilite: "4" }).niveau, "significatif"); // 8
  assert.equal(criticite({ gravite: "3", probabilite: "3" }).niveau, "critique"); // 9
  // Règle v0.28 : Impact = 4 → critique même si la criticité calculée est faible
  assert.deepEqual(criticite({ gravite: "4", probabilite: "1" }), { valeur: 4, g: 4, p: 1, niveau: "critique" });
  assert.equal(criticite({ gravite: "4", probabilite: "2" }).niveau, "critique"); // 8 mais Impact 4
  // Hors échelle → null
  assert.equal(criticite({ gravite: "", probabilite: "3" }), null);
  assert.equal(criticite({ gravite: "5", probabilite: "1" }), null);
});

// ---------- Opportunité : score et suite ----------
test("score d'opportunité = intérêt × faisabilité ; ≥ 6 → plan d'amélioration, sinon à étudier", () => {
  assert.deepEqual(scoreOpportunite({ interet: "3", faisabilite: "3" }), { valeur: 9, i: 3, f: 3, suite: "plan" });
  assert.equal(scoreOpportunite({ interet: "3", faisabilite: "2" }).suite, "plan"); // 6
  assert.equal(scoreOpportunite({ interet: "2", faisabilite: "3" }).suite, "plan"); // 6
  assert.equal(scoreOpportunite({ interet: "2", faisabilite: "2" }).suite, "etudier"); // 4
  assert.equal(scoreOpportunite({ interet: "3", faisabilite: "1" }).suite, "etudier"); // 3
  assert.equal(scoreOpportunite({ interet: "", faisabilite: "2" }), null);
  assert.equal(scoreOpportunite({ interet: "4", faisabilite: "1" }), null); // hors échelle 1-3
});

// ---------- Modèle + store : opportunité portée par une instruction ----------
test("une instruction porte des opportunités ; le store les bascule, ajoute, modifie, supprime", () => {
  store.nouvelle();
  const p = store.lire();
  store.ajouterRole(); // pour avoir un rôle
  const r = store.lire().roles[0];
  store.ajouterEtape();
  const e = store.lire().etapes[0];
  assert.deepEqual(e.opportunites, [], "par défaut aucune opportunité");
  store.basculerOpportunites(e.id, true);
  assert.equal(store.lire().etapes[0].opportunites.length, 1);
  const o = store.lire().etapes[0].opportunites[0];
  store.modifierOpportunite(e.id, o.id, "opportunite", "Bibliothèque de spécifications types");
  store.modifierOpportunite(e.id, o.id, "interet", "3");
  store.modifierOpportunite(e.id, o.id, "faisabilite", "3");
  const liste = listeOpportunites(store.lire());
  assert.equal(liste.length, 1);
  assert.equal(liste[0].opportunite.opportunite, "Bibliothèque de spécifications types");
  assert.equal(liste[0].score.valeur, 9);
  assert.equal(liste[0].score.suite, "plan");
  store.supprimerOpportunite(e.id, o.id);
  assert.equal(listeOpportunites(store.lire()).length, 0);
});

test("nouvelleOpportunite a la bonne forme et un identifiant", () => {
  const o = nouvelleOpportunite({ opportunite: "X", interet: "2", faisabilite: "3" });
  assert.ok(o.id && typeof o.id === "string");
  assert.deepEqual([o.opportunite, o.benefice, o.interet, o.faisabilite], ["X", "", "2", "3"]);
});

// ---------- Compatibilité : un fichier validé avant la v0.28 (sans opportunités) garde sa signature ----------
test("une instruction sans opportunité a la même signature, que le champ opportunites soit présent (vide) ou absent", () => {
  const base = () => {
    const p = nouvelleProcedure();
    p.roles = [{ id: "r1", nom: "Acheteur", type: "individuel" }];
    p.meta = { ...p.meta, titre: "T", reference: "PR-ACH-01", declencheur: "D", fin: "F", typeDocument: "procedure" };
    p.etapes = [nouvelleEtape({ roleId: "r1", libelle: "Agir", entree: "E", sortie: "S" })];
    return p;
  };
  const p = base(); // étape a opportunites: []
  const sigVide = signatureContenu(p);
  delete p.etapes[0].opportunites; // simule un fichier d'avant la v0.28 (même instruction, même id)
  assert.equal(signatureContenu(p), sigVide, "opportunités vides = champ ignoré dans la signature");
  // Une opportunité renseignée, elle, change la signature
  p.etapes[0].opportunites = [nouvelleOpportunite({ opportunite: "Automatiser", interet: "3", faisabilite: "2" })];
  assert.notEqual(signatureContenu(p), sigVide);
});

// ---------- Document : la section 9 porte risques ET opportunités ----------
test("la section 9 s'intitule « Risques, opportunités et mesures de maîtrise » et affiche le tableau des opportunités", () => {
  assert.equal(t("doc.section.risques"), "Risques, opportunités et mesures de maîtrise");
  const p = nouvelleProcedure();
  p.roles = [{ id: "r1", nom: "Acheteur", type: "individuel" }];
  p.meta = { ...p.meta, titre: "T", reference: "PR-ACH-01", declencheur: "D", fin: "F", typeDocument: "procedure" };
  p.etapes = [nouvelleEtape({ roleId: "r1", libelle: "Agir", entree: "E", sortie: "S",
    opportunites: [nouvelleOpportunite({ opportunite: "Contrats-cadres", interet: "3", faisabilite: "2" })] })];
  const doc = construireDocument(p);
  const sec9 = doc.sections.find((s) => s.cle === "risques");
  const textes = JSON.stringify(sec9.blocs);
  assert.ok(textes.includes(t("doc.opportunites.sous_titre")), "sous-titre Opportunités présent");
  assert.ok(textes.includes("Contrats-cadres"), "l'opportunité figure dans le document");
  assert.ok(textes.includes(t("opportunite.suite.plan")), "la suite « plan d'amélioration » est affichée");
});

// ---------- Règle : opportunité sans intitulé = alerte ----------
test("une opportunité sans intitulé est signalée (alerte, non bloquante)", () => {
  const p = nouvelleProcedure();
  p.roles = [{ id: "r1", nom: "Acheteur", type: "individuel" }];
  p.meta = { ...p.meta, titre: "T", reference: "PR-ACH-01", declencheur: "D", fin: "F", typeDocument: "procedure" };
  p.etapes = [nouvelleEtape({ roleId: "r1", libelle: "Agir", entree: "E", sortie: "S",
    opportunites: [nouvelleOpportunite({ benefice: "un gain", interet: "2", faisabilite: "2" })] })]; // pas d'intitulé
  const c = verifier(p, { nomenclature: carto.nomenclature }).find((x) => x.cle === "regle.opportunite.incomplet");
  assert.ok(c && c.gravite === "alerte");
});

// ---------- Vocabulaire et parité FR/EN ----------
test("les libellés Impact / Vraisemblance et les clés d'opportunité existent en FR et EN", () => {
  assert.match(fr["form.risque.gravite"], /Impact/);
  assert.match(fr["form.risque.probabilite"], /Vraisemblance/);
  assert.match(en["form.risque.gravite"], /Impact/i);
  assert.match(en["form.risque.probabilite"], /Likelihood/i);
  ["risque.niveau.acceptable", "risque.niveau.significatif", "risque.niveau.critique",
   "opportunite.suite.plan", "opportunite.suite.etudier", "form.opportunite.interet", "form.opportunite.faisabilite",
   "col.opportunites.opportunite", "doc.opportunites.sous_titre", "synth.opportunites"]
    .forEach((cle) => { assert.ok(fr[cle] && fr[cle].length > 0, "FR " + cle); assert.ok(en[cle] && en[cle].length > 0, "EN " + cle); });
});
