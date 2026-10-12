// Tests du parcours en 4 étapes : quand une étape est-elle remplie, quand la suivante s'ouvre.
import test from "node:test";
import assert from "node:assert/strict";
import * as store from "../js/store.js";
import {
  ETAPES, manquantsIdentification, manquantsDeroule, etapeComplete, etapeAccessible, etapeMax, etapeInitiale,
  estValidee, manquants, bloquantsSynthese,
} from "../js/parcours.js";

const cles = (liste) => liste.map((m) => m.cle);

function remplirIdentification() {
  store.modifierMeta("organisation", "Entreprise Exemple");
  store.modifierMeta("processus", "DOC");
  store.modifierMeta("pilote", "Responsable qualité");
  store.modifierMeta("titre", "Gestion des documents");
  store.modifierMeta("reference", "PR-DOC-01");
  store.modifierMeta("typeDocument", "procedure");
}

test("le parcours a 4 étapes dans l'ordre demandé", () => {
  assert.deepEqual(ETAPES, ["identification", "deroule", "synthese", "generation"]);
});

test("procédure vierge : seule l'étape 1 est ouverte", () => {
  store.nouvelle();
  const p = store.lire();
  assert.equal(etapeAccessible(p, 1), true);
  assert.equal(etapeAccessible(p, 2), false);
  assert.equal(etapeAccessible(p, 3), false);
  assert.equal(etapeAccessible(p, 4), false);
  assert.equal(etapeMax(p), 1);
  assert.equal(etapeInitiale(p), 1);
});

test("étape 1 : les 7 informations de la fiche de collecte, « Direction / Site » restant facultatif", () => {
  store.nouvelle();
  assert.deepEqual(cles(manquantsIdentification(store.lire())), [
    "manque.meta.organisation", "manque.meta.processus", "manque.meta.pilote", "manque.meta.titre", "manque.meta.reference", "manque.meta.typeDocument",
  ]);
  remplirIdentification();
  assert.deepEqual(manquantsIdentification(store.lire()), []);
  assert.equal(store.lire().meta.direction, "");
  assert.equal(etapeAccessible(store.lire(), 2), true);
});

test("une valeur faite d'espaces ne compte pas comme renseignée", () => {
  store.nouvelle();
  remplirIdentification();
  store.modifierMeta("organisation", "   ");
  assert.deepEqual(cles(manquantsIdentification(store.lire())), ["manque.meta.organisation"]);
});

test("le type de document n'accepte que les 2 valeurs prévues (procédure, instruction de travail)", () => {
  store.nouvelle();
  store.modifierMeta("typeDocument", "n'importe quoi");
  assert.equal(store.lire().meta.typeDocument, "");
  store.modifierMeta("typeDocument", "instruction");
  assert.equal(store.lire().meta.typeDocument, "instruction");
  store.modifierMeta("typeDocument", "les_deux"); // ancienne valeur (avant la v0.16) : refusée
  assert.equal(store.lire().meta.typeDocument, "instruction");
});

test("étape 2 : chaque manque du déroulé est signalé avec le numéro de l'instruction", () => {
  store.nouvelle();
  remplirIdentification();
  assert.deepEqual(cles(manquantsDeroule(store.lire())), ["manque.roles", "manque.declencheur", "manque.etapes", "manque.fin"]);
  store.ajouterRole();
  store.ajouterEtape();
  const m = manquantsDeroule(store.lire());
  assert.ok(cles(m).includes("manque.role_sans_nom"));
  assert.ok(m.some((x) => x.cle === "manque.etape.role" && x.params.i === 1));
  assert.ok(m.some((x) => x.cle === "manque.etape.libelle" && x.params.i === 1));
  assert.ok(m.some((x) => x.cle === "manque.etape.entree" && x.params.i === 1));
  assert.ok(m.some((x) => x.cle === "manque.etape.sortie" && x.params.i === 1));
});

test("étape 2 : un risque sans mesure et un niveau 3 sans code empêchent de continuer", () => {
  store.chargerExemple();
  assert.deepEqual(manquantsDeroule(store.lire()), []);
  const e = store.lire().etapes[1]; // « Placer le client » : aucune risque au départ (on en ajoute un incomplet)
  store.basculerRisques(e.id, true);
  store.modifierRisque(e.id, store.lire().etapes[1].risques[0].id, "risque", "Chute");
  assert.deepEqual(cles(manquantsDeroule(store.lire())), ["manque.etape.risque"]);
  store.modifierRisque(e.id, store.lire().etapes[1].risques[0].id, "mesure", "Balisage");
  assert.deepEqual(manquantsDeroule(store.lire()), []);
  store.modifierNiveau3(e.id, "actif", true);
  assert.deepEqual(cles(manquantsDeroule(store.lire())), ["manque.etape.n3"]);
  store.modifierNiveau3(e.id, "code", "IT-DOC-09");
  assert.deepEqual(manquantsDeroule(store.lire()), []);
});

test("l'exemple : étapes 1 et 2 remplies, on arrive sur le déroulé, la synthèse attend la validation", () => {
  store.chargerExemple();
  const p = store.lire();
  assert.equal(etapeComplete(p, 1), true);
  assert.equal(etapeComplete(p, 2), true);
  assert.equal(etapeInitiale(p), 2);
  assert.equal(etapeAccessible(p, 3), true);
  assert.equal(etapeAccessible(p, 4), false);
  assert.deepEqual(cles(manquants(p, 3)), ["manque.validation"]);
});

test("valider la synthèse ouvre l'étape 4 ; modifier ensuite la referme", () => {
  store.chargerExemple();
  store.valider();
  assert.equal(estValidee(store.lire()), true);
  assert.equal(etapeAccessible(store.lire(), 4), true);
  assert.equal(etapeMax(store.lire()), 4);
  store.modifierMeta("titre", "Autre titre");
  assert.equal(estValidee(store.lire()), false);
  assert.equal(etapeAccessible(store.lire(), 4), false);
});

test("la validation résiste à l'enregistrement puis à la réouverture du fichier", () => {
  store.chargerExemple();
  store.valider();
  const json = store.exporterJSON();
  store.nouvelle();
  store.importerJSON(json);
  assert.equal(estValidee(store.lire()), true);
});

test("retirer la validation referme l'étape 4 ; annuler la rétablit", () => {
  store.chargerExemple();
  store.valider();
  store.retirerValidation();
  assert.equal(etapeAccessible(store.lire(), 4), false);
  store.annuler();
  assert.equal(estValidee(store.lire()), true);
});

test("une validation copiée d'un autre fichier n'est pas reconnue", () => {
  store.chargerExemple();
  store.valider();
  const brut = JSON.parse(store.exporterJSON());
  brut.procedure ? (brut.procedure.meta.titre = "Truqué") : (brut.meta.titre = "Truqué");
  store.importerJSON(JSON.stringify(brut));
  assert.equal(estValidee(store.lire()), false);
});

test("une erreur de règle du langage empêche de valider (une instruction = une seule action)", () => {
  store.chargerExemple();
  const e = store.lire().etapes[1];
  store.modifierEtape(e.id, "libelle", "Rédiger et signer");
  const b = bloquantsSynthese(store.lire());
  assert.ok(b.some((c) => c.cle === "regle.etape.contient_et"));
  assert.ok(manquants(store.lire(), 3).some((m) => m.cle === "regle.etape.contient_et"));
  assert.equal(etapeComplete(store.lire(), 3), false);
  store.modifierEtape(e.id, "libelle", "Rédiger le document");
  assert.deepEqual(bloquantsSynthese(store.lire()), []);
});

test("le brouillon enregistré dans le navigateur est repris au démarrage (avec la validation)", async () => {
  const stock = new Map();
  globalThis.localStorage = { getItem: (k) => (stock.has(k) ? stock.get(k) : null), setItem: (k, v) => stock.set(k, String(v)), removeItem: (k) => stock.delete(k) };
  try {
    const premiere = await import("../js/store.js?session=1");
    premiere.chargerExemple();
    premiere.valider();
    assert.ok(stock.size > 0);
    const seconde = await import("../js/store.js?session=2"); // = la page rechargée
    assert.equal(seconde.lire().meta.reference, "PR-REA-01");
    assert.equal(seconde.lire().etapes.length, 8);
    assert.equal(estValidee(seconde.lire()), true);
  } finally {
    delete globalThis.localStorage;
  }
});
