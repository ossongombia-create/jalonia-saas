// Tests automatiques du moteur de règles. Lancer avec :  node --test "tests/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { exempleValiderCommande, nouvelleEtape } from "../js/model.js";
import { verifier } from "../js/rules.js";
import { dessinerNiveau2 } from "../js/render.js";
import { t, definirLangue } from "../js/i18n.js";
import fr from "../js/locales/fr.js";
import en from "../js/locales/en.js";

const cles = (p) => verifier(p).map((c) => c.cle);

test("l'exemple est conforme (aucune erreur)", () => {
  assert.deepEqual(verifier(exempleValiderCommande()).filter((c) => c.gravite === "erreur"), []);
});

test("libellé de plus de 5 mots et « et » sont signalés", () => {
  const p = exempleValiderCommande();
  p.etapes[0].libelle = "Réceptionner et enregistrer la commande du client";
  assert.ok(cles(p).includes("regle.etape.trop_de_mots"));
  assert.ok(cles(p).includes("regle.etape.contient_et"));
});

test("instruction collaborative : colonne traversée signalée", () => {
  const p = exempleValiderCommande();
  // Client (3e colonne) participe avec l'assistante (1re) : la colonne Comptable est traversée.
  p.etapes.push(nouvelleEtape({ roleId: "r-client", libelle: "Signer le devis", entree: "Devis", sortie: "Devis signé" }));
  p.etapes[0].participants = ["r-client"];
  assert.ok(cles(p).includes("regle.collab.colonne_traversee"));
});

test("plus de 6 rôles : erreur", () => {
  const p = exempleValiderCommande();
  for (let k = 0; k < 5; k += 1) {
    p.roles.push({ id: `x${k}`, nom: `Rôle ${k}`, type: "individuel" });
    p.etapes.push(nouvelleEtape({ roleId: `x${k}`, libelle: "Traiter le dossier", entree: "A", sortie: "B" }));
  }
  assert.ok(cles(p).includes("regle.roles.trop_nombreux"));
});

test("le dessin contient les ovales R et P de l'instruction collaborative", () => {
  const svg = dessinerNiveau2(exempleValiderCommande());
  assert.match(svg, />R</);
  assert.match(svg, />P</);
});

test("le dessin échappe le HTML des libellés", () => {
  const p = exempleValiderCommande();
  p.etapes[0].libelle = "<img src=x onerror=alert(1)>";
  assert.ok(!dessinerNiveau2(p).includes("<img"));
});

test("chaque clé française existe en anglais, et inversement", () => {
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
});

test("t() remplace les valeurs et bascule de langue", () => {
  definirLangue("fr");
  assert.equal(t("regle.roles.trop_nombreux", { n: 7 }).startsWith("7 rôles"), true);
  definirLangue("en");
  assert.equal(t("regle.roles.trop_nombreux", { n: 7 }).startsWith("7 roles"), true);
  definirLangue("fr");
});

// ----- Document : 11 sections du modèle et limite de pages -----
import { SECTIONS, construireDocument, estimerPages, verifierLongueur, PAGES_MAX } from "../js/document.js";

test("le document a les 11 sections du modèle, chacune avec un titre FR et EN", () => {
  assert.equal(SECTIONS.length, 11);
  SECTIONS.forEach((s) => {
    assert.ok(fr["doc.section." + s], s);
    assert.ok(en["doc.section." + s], s);
  });
});

test("le squelette vide reste bien sous la limite de pages", () => {
  const doc = construireDocument(exempleValiderCommande());
  const pages = estimerPages(doc);
  assert.ok(pages >= 3 && pages <= PAGES_MAX, `pages estimées : ${pages}`);
  assert.deepEqual(verifierLongueur(doc), []);
});

test("un document trop long est signalé", () => {
  const doc = construireDocument(exempleValiderCommande());
  doc.sections[5].blocs.push({ type: "tableau", colonnes: ["a", "b"], lignes: Array.from({ length: 600 }, () => ["x", "y"]) });
  assert.equal(verifierLongueur(doc)[0].gravite, "erreur");
});

test("logigramme : aucun texte n'est coupé ni abrégé", () => {
  const p = exempleValiderCommande();
  const long = "Demande d'intervention urgente reçue par téléphone, par courriel ou via le portail client avec numéro de contrat complet";
  p.meta.declencheur = long;
  p.etapes[0].libelle = "Réceptionner la demande complète transmise par le client final";
  p.etapes[0].outils.push({ id: "ox", type: "materiel", nom: "Chariot de manutention des archives volumineuses" });
  const svg = dessinerNiveau2(p);
  const texteDuDessin = svg.replace(/<\/text><text[^>]*>/g, " ").replace(/<[^>]+>/g, "");
  for (const morceau of [long, p.etapes[0].libelle, "Chariot de manutention des archives volumineuses"]) {
    morceau.split(" ").forEach((mot) => assert.ok(texteDuDessin.includes(mot.replace(/&/g, "&amp;").replace(/'/g, "&#39;")), `mot manquant : ${mot}`));
  }
  assert.ok(!svg.includes("…"));
});

test("outils : document (ondulé) et matériel (triangle) reliés en pointillé, texte protégé", () => {
  const p = exempleValiderCommande();
  p.etapes[1].outils = [{ id: "o1", type: "document", nom: "<script>alert(1)</script>" }, { id: "o2", type: "materiel", nom: "Scanner" }];
  const svg = dessinerNiveau2(p);
  assert.ok(svg.includes("<polygon"), "triangle du matériel");
  assert.ok(svg.includes("stroke-dasharray=\"4 3\""), "liaison pointillée");
  assert.ok(!svg.includes("<script>"));
  assert.ok(svg.includes("&lt;script&gt;"));
});

test("outil sans nom : signalé, et non dessiné", () => {
  const p = exempleValiderCommande();
  p.etapes[0].outils = [{ id: "o1", type: "document", nom: "  " }];
  assert.ok(cles(p).includes("regle.outil.sans_nom"));
});

test("l'exemple montré à l'utilisateur (PR-REA-01) est conforme", async () => {
  const { exempleProcedure } = await import("../js/exemple-procedure.js");
  const p = exempleProcedure();
  assert.equal(p.meta.reference, "PR-REA-01");
  assert.equal(p.etapes.length, 8);
  assert.ok(p.roles.every((r) => r.type !== "externe"));
  assert.deepEqual(verifier(p).filter((c) => c.gravite === "erreur"), []);
  assert.ok(p.etapes.every((e) => e.libelle.split(/\s+/).length <= 5));
});
