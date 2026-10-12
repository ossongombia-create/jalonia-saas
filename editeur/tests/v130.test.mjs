// Tests v1.3 — « sans objet » : marquer une ALERTE du questionnement (Comment / Avec quoi / Sous contraintes) comme non applicable
// pour une instruction ou une opération. L'alerte quitte les « manquants » et passe dans « nonApplicables » (résumé discret du diagnostic).
// Les ERREURS ne sont jamais concernées.
import test from "node:test";
import assert from "node:assert/strict";
import * as store from "../js/store.js";
import { nouvelleProcedure, nouvelleEtape, nouvelleOperation } from "../js/model.js";
import { questionnement, constatsQuestionnement, constatsNonApplicables } from "../js/questionnement.js";
import { definirLangue } from "../js/i18n.js";

definirLangue("fr");

const pt = (p, n) => questionnement(p).points.find((x) => x.n === n);

// Une procédure minimale dont l'unique instruction déclenche les alertes Comment (6), Avec quoi (7) et Sous contraintes (11),
// sans erreur (tous les points essentiels sont renseignés).
function procedureAlertes() {
  const p = nouvelleProcedure();
  p.meta.typeDocument = "procedure";
  p.meta.declencheur = "Demande reçue";
  p.meta.fin = "Dossier clos";
  p.roles = [{ id: "r1", nom: "Agent", type: "role", service: "", responsabilite: "" }];
  p.etapes = [nouvelleEtape({ id: "e1", roleId: "r1", libelle: "Traiter la demande", entree: "Demande", entreeDe: "Client", sortie: "Dossier", versQui: "Client" })];
  return p;
}

test("niveau 2 : les 3 alertes sont ouvertes, les erreurs sont tenues", () => {
  const p = procedureAlertes();
  assert.ok(pt(p, 6).manquants.includes(1), "Comment ouvert");
  assert.ok(pt(p, 7).manquants.includes(1), "Avec quoi ouvert");
  assert.ok(pt(p, 11).manquants.includes(1), "Sous contraintes ouvert");
  // aucune erreur : les points essentiels sont renseignés
  [1, 2, 3, 4, 5, 8, 9, 10].forEach((n) => assert.deepEqual(pt(p, n).manquants, [], "erreur inattendue au point " + n));
});

test("marquer « Comment » sans objet le sort des manquants et le met dans nonApplicables", () => {
  const p = procedureAlertes();
  p.etapes[0].sansObjet.comment = true;
  assert.ok(!pt(p, 6).manquants.includes(1), "Comment n'est plus un manquant");
  assert.ok(pt(p, 6).nonApplicables.includes(1), "Comment est non applicable");
  // les autres alertes restent ouvertes
  assert.ok(pt(p, 7).manquants.includes(1));
});

test("les constats reflètent le choix : plus d'alerte Comment, un résumé « sans objet »", () => {
  const p = procedureAlertes();
  p.etapes[0].sansObjet.comment = true;
  assert.ok(!constatsQuestionnement(p).some((c) => c.cle === "quest.procedure.comment"), "l'alerte Comment disparaît des constats");
  const na = constatsNonApplicables(p);
  assert.equal(na.length, 1);
  assert.equal(na[0].gravite, "sansobjet");
  assert.match(na[0].params.liste, /Comment \(1\)/);
});

test("les ERREURS ne sont pas « sans objet »-ables", () => {
  const p = procedureAlertes();
  p.etapes[0].libelle = ""; // point 2 (Quoi) = erreur
  p.etapes[0].sansObjet.quoi = true; // clé non gérée : sans effet
  assert.ok(pt(p, 2).manquants.includes(1), "l'erreur Quoi reste un manquant");
});

test("niveau 3 : « Comment » est toujours tenu ; « Avec quoi » est sans-objet-able", () => {
  const p = nouvelleProcedure();
  p.meta.typeDocument = "instruction";
  p.meta.declencheur = "Début"; p.meta.fin = "Fin";
  p.it.role.nom = "Agent";
  p.it.operations = [nouvelleOperation({ id: "o1", libelle: "Faire", entree: "x", sortie: "z" })];
  assert.deepEqual(pt(p, 6).manquants, [], "Comment n'est jamais signalé au niveau 3");
  assert.ok(pt(p, 7).manquants.includes(1), "Avec quoi ouvert");
  p.it.operations[0].sansObjet.avec = true;
  assert.ok(pt(p, 7).nonApplicables.includes(1), "Avec quoi devient non applicable");
  assert.ok(!pt(p, 7).manquants.includes(1));
});

test("store : sansObjet par défaut après nettoyage, modifieur, clé inconnue rejetée", () => {
  store.chargerExemple();
  const id = store.lire().etapes[0].id;
  assert.equal(store.lire().etapes[0].sansObjet.comment, false, "défaut présent après nettoyage");
  store.basculerSansObjet(id, "comment", true);
  assert.equal(store.lire().etapes[0].sansObjet.comment, true);
  store.basculerSansObjet(id, "quoi", true); // clé non reconnue
  assert.ok(!("quoi" in store.lire().etapes[0].sansObjet), "une clé inconnue n'est pas ajoutée");
  store.basculerSansObjet(id, "comment", false);
  assert.equal(store.lire().etapes[0].sansObjet.comment, false);
});
