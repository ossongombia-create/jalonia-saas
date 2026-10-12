// Tests v1.0.1 — correction issue de la campagne de qualification : la cotation (risques et opportunités)
// n'accepte que des entiers dans le domaine ; une valeur non entière (ex. importée d'un fichier modifié) n'est pas une cotation.
import test from "node:test";
import assert from "node:assert/strict";
import { criticite, scoreOpportunite } from "../js/model.js";

test("criticite rejette les valeurs non entières", () => {
  assert.equal(criticite({ gravite: 2.5, probabilite: 2 }), null);
  assert.equal(criticite({ gravite: 3, probabilite: 1.5 }), null);
  // entiers valides : inchangés
  assert.equal(criticite({ gravite: 4, probabilite: 1 }).niveau, "critique"); // Impact = 4
  assert.equal(criticite({ gravite: 3, probabilite: 3 }).niveau, "critique"); // C = 9
  assert.equal(criticite({ gravite: 3, probabilite: 2 }).niveau, "significatif");
  assert.equal(criticite({ gravite: 2, probabilite: 2 }).niveau, "acceptable");
  assert.equal(criticite({ gravite: 0, probabilite: 2 }), null);
  assert.equal(criticite({ gravite: 5, probabilite: 2 }), null);
});

test("scoreOpportunite rejette les valeurs non entières", () => {
  assert.equal(scoreOpportunite({ interet: 1.5, faisabilite: 2 }), null);
  assert.equal(scoreOpportunite({ interet: 2, faisabilite: 2.5 }), null);
  assert.equal(scoreOpportunite({ interet: 3, faisabilite: 2 }).suite, "plan"); // 6
  assert.equal(scoreOpportunite({ interet: 2, faisabilite: 2 }).suite, "etudier"); // 4
});
