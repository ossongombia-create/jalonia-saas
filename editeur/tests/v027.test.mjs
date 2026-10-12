// Tests v0.27 — la CARTOGRAPHIE a un 4e bloc « Vérification » (décision de Brice du 03/10/2026), pour suivre la liste « Domaine »
// (Management, Réalisation, Support, Vérification). Le livre n'en montre que trois ; le quatrième est un ajout de l'organisation.
import test from "node:test";
import assert from "node:assert/strict";
import { CATEGORIES, nettoyerCartographie, processusParCategorie, processusParCode, nouvelleCartographie } from "../js/cartographie.js";
import { interpreter } from "../js/cartographie-pdf.js";
import { DOMAINES, domaineValide } from "../js/model.js";
import * as cs from "../js/cartographie-store.js";
import { exempleCartographie } from "../js/exemple-carto.js";
import { definirLangue, t } from "../js/i18n.js";
import fr from "../js/locales/fr.js";
import en from "../js/locales/en.js";

definirLangue("fr");

test("la cartographie a quatre blocs, dans le même ordre que la liste Domaine", () => {
  assert.deepEqual(CATEGORIES, ["management", "realisation", "support", "verification"]);
  assert.deepEqual(DOMAINES, CATEGORIES, "la cartographie et la liste Domaine ont désormais les mêmes blocs");
});

test("les libellés du 4e bloc existent en français et en anglais (carte et « blocs entiers »)", () => {
  ["carto.categorie.verification", "carto.point.verification"].forEach((cle) => {
    assert.ok(fr[cle] && fr[cle].length > 2, "FR " + cle);
    assert.ok(en[cle] && en[cle].length > 2, "EN " + cle);
  });
  assert.equal(fr["carto.categorie.verification"], "Surveillance & mesure");
  assert.equal(en["carto.categorie.verification"], "Monitoring & measurement");
  // le message d'import nomme les quatre blocs
  assert.ok(/surveillance/i.test(fr["carto.import.sans_categorie"]));
  assert.ok(/monitoring/i.test(en["carto.import.sans_categorie"]));
});

test("un processus « vérification » est accepté, rangé dans le 4e groupe, et vaut un domaine valide", () => {
  const c = nettoyerCartographie({ processus: [
    { id: "a", code: "PIL", nom: "Piloter", categorie: "management" },
    { id: "b", code: "SUR", nom: "Surveiller et mesurer", categorie: "verification" },
  ], flux: [] });
  assert.equal(processusParCode(c, "SUR").categorie, "verification");
  // processusParCategorie garde les blocs non vides, dans l'ordre de CATEGORIES : ici management puis vérification.
  const groupes = processusParCategorie(c);
  assert.deepEqual(groupes.map((g) => g.categorie), ["management", "verification"]);
  assert.deepEqual(groupes[1].processus.map((p) => p.code), ["SUR"], "le bloc vérification vient après les autres");
  assert.ok(domaineValide("verification"), "le bloc vaut un domaine de document valide");
});

test("le store accepte « vérification » comme bloc d'un processus ; un bloc inconnu reste refusé", () => {
  cs.vider();
  const id = cs.ajouterProcessus(); // renvoie l'identifiant du processus créé
  cs.modifierProcessus(id, "categorie", "verification");
  assert.equal(cs.lire().processus[0].categorie, "verification");
  cs.modifierProcessus(id, "categorie", "n'importe quoi");
  assert.equal(cs.lire().processus[0].categorie, "verification", "un bloc inconnu ne remplace pas le bloc valide");
  cs.vider();
});

test("lecture PDF simplifiée : une bande « Vérification » (surveillance, mesure, audit) est reconnue", () => {
  const ligne = (s, y) => ({ s, taille: 10, vertical: false, bb: [50, y, 50 + s.length * 5, y + 10] });
  const mise = {
    largeur: 600, hauteur: 800, formes: [],
    textes: [
      ligne("Processus de management", 50), ligne("M1 Piloter", 80),
      ligne("Processus de réalisation", 120), ligne("R1 Produire", 150),
      ligne("Processus support", 200), ligne("S1 Maintenir", 230),
      ligne("Surveillance, mesure et vérification", 280), ligne("V1 Auditer et contrôler", 310),
    ],
  };
  const { cartographie: c } = interpreter(mise);
  assert.equal(processusParCode(c, "V1").categorie, "verification", "le bloc de vérification est détecté à la lecture du PDF");
  assert.equal(processusParCode(c, "M1").categorie, "management");
});

test("l'exemple de cartographie contient un processus de vérification (le 4e bloc est démontré)", () => {
  const c = nettoyerCartographie(exempleCartographie());
  const verif = c.processus.filter((p) => p.categorie === "verification");
  assert.equal(verif.length, 1);
  assert.equal(verif[0].code, "SUR");
  // au moins un échange touche le bloc « vérification »
  assert.ok(c.flux.some((f) => f.de === "verification" || f.vers === "verification"), "un échange relie le bloc vérification");
});

test("aucun des libellés du 4e bloc n'est en dur hors des locales et de l'exemple", () => {
  // garde-fou léger : la clé n'est écrite qu'une fois par langue
  assert.equal([fr, en].filter((loc) => loc["carto.categorie.verification"]).length, 2);
});
