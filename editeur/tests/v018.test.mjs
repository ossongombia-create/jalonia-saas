// Tests v0.18 — la CARTOGRAPHIE DES PROCESSUS de l'organisation : modèle et nettoyage, lecture d'un PDF de cartographie (un PDF d'exemple
// généré, neutre, sert de PDF d'essai), codes de documents et nomenclature RÉGLABLE par organisation (rien n'est propre à une entreprise), échanges proposés au Début
// et à la Fin, règles de codification, parité FR/EN.
import test from "node:test";
import { PROPRE } from "./neutralite.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as cs from "../js/cartographie-store.js";
import {
  nouvelleCartographie, nettoyerCartographie, nettoyerNomenclature, depuisJSON, versJSON, estVide, analyserCode, prochainCode, codeTypeDuDocument,
  nomenclatureActive, fluxDuProcessus, processusDuTexte, processusParCode, processusParCategorie, libelleProcessus, documentParCode,
  NOMENCLATURE_PAR_DEFAUT, MAX_PROCESSUS,
} from "../js/cartographie.js";
import { exempleCartographie } from "../js/exemple-carto.js";
import { exempleInstruction } from "../js/exemple-it.js";
import { importerPdf, interpreter, analyserFleche } from "../js/cartographie-pdf.js";
import { verifierCodes } from "../js/rules-codes.js";
import { verifier } from "../js/rules.js";
import { constatsDiagnostic } from "../js/diagnostic.js";
import { nouvelleProcedure, nouvelleEtape } from "../js/model.js";
import { definirLangue } from "../js/i18n.js";
import fr from "../js/locales/fr.js";
import en from "../js/locales/en.js";

definirLangue("fr");
const cles = (constats) => constats.map((c) => c.cle);
const exemple = () => nettoyerCartographie(exempleCartographie());
const codesTri = (c) => c.processus.map((p) => p.code);

// Une autre organisation, sans rapport avec la première : codes différents, nomenclature différente.
function autreOrganisation() {
  return nettoyerCartographie({
    organisation: "Acme Logistics",
    processus: [
      { id: "a", code: "M1", nom: "Diriger", categorie: "management" },
      { id: "b", code: "R1", nom: "Livrer", categorie: "realisation" },
      { id: "c", code: "S1", nom: "Maintenir", categorie: "support" },
    ],
    flux: [
      { id: "f1", de: "management", vers: "b", information: "Objectifs", double: false },
      { id: "f2", de: "b", vers: "satisfaction", information: "Colis livrés", double: false },
    ],
    documents: [{ id: "d1", code: "PRO-R1-01", titre: "Livrer un colis" }, { id: "d2", code: "M1/2024-07", titre: "Revue de direction" }],
    nomenclature: { controle: true, procedure: "pro", instruction: "ins" },
  });
}

function procedureAvec(meta, etapes = []) {
  const p = nouvelleProcedure();
  p.meta = { ...p.meta, ...meta };
  p.etapes = etapes;
  return p;
}

// ---------- Modèle et nettoyage ----------
test("une cartographie neuve est vide et ne contrôle aucun code", () => {
  const c = nouvelleCartographie();
  assert.ok(estVide(c));
  assert.deepEqual(c.nomenclature, { controle: false, procedure: "PR", instruction: "IT" });
  assert.equal(nomenclatureActive(c), false);
  assert.equal(Object.isFrozen(NOMENCLATURE_PAR_DEFAUT), true);
});

test("le nettoyage écarte les processus sans code valide, les doublons et les échanges orphelins", () => {
  const c = nettoyerCartographie({
    processus: [
      { id: "p1", code: "prd", nom: "Transport", categorie: "realisation" },
      { id: "p2", code: "PRD", nom: "Doublon" },
      { id: "p3", code: "1X", nom: "Code invalide" },
      { id: "p4", code: "DOC", nom: "Qualité", categorie: "n'importe quoi" },
      "pas un objet", null,
    ],
    flux: [
      { id: "f1", de: "p1", vers: "p4", information: "  Données \n\t de   suivi ", double: true },
      { id: "f2", de: "p1", vers: "inconnu", information: "x" },
      { id: "f3", de: "p1", vers: "p1", information: "x" },
      { id: "f4", de: "realisation", vers: "satisfaction", information: "Livraisons" },
    ],
  });
  assert.deepEqual(codesTri(c), ["PRD", "DOC"]);
  assert.equal(c.processus[1].categorie, "", "un bloc inconnu est ignoré");
  assert.equal(c.flux.length, 2);
  assert.equal(c.flux[0].information, "Données de suivi", "espaces et sauts de ligne compactés");
  assert.equal(c.flux[0].double, true);
});

test("le nombre de processus est limité", () => {
  const brut = { processus: Array.from({ length: MAX_PROCESSUS + 20 }, (_, i) => ({ code: "P" + String(i).padStart(2, "0"), nom: "n" + i })) };
  assert.equal(nettoyerCartographie(brut).processus.length, MAX_PROCESSUS);
});

test("le registre accepte les codes de n'importe quelle organisation, et refuse ce qui n'est pas un code", () => {
  const c = nettoyerCartographie({
    documents: [{ code: "pr-prd-01", titre: "A" }, { code: "PRO-R1-1", titre: "B" }, { code: "M1/2024-07", titre: "C" }, { code: "PR-PRD-01", titre: "doublon" }, { code: "<script>", titre: "D" }, { code: "", titre: "E" }],
  });
  assert.deepEqual(c.documents.map((d) => d.code), ["PR-PRD-01", "PRO-R1-1", "M1/2024-07"]);
});

test("la nomenclature est nettoyée : types de 1 à 3 lettres, sinon les valeurs par défaut", () => {
  assert.deepEqual(nettoyerNomenclature({ controle: true, procedure: "pro", instruction: "ins" }), { controle: true, procedure: "PRO", instruction: "INS" });
  assert.deepEqual(nettoyerNomenclature({ controle: "oui", procedure: "PROCEDURE", instruction: "1" }), { controle: false, procedure: "PR", instruction: "IT" });
  assert.deepEqual(nettoyerNomenclature(null), { controle: false, procedure: "PR", instruction: "IT" });
  const repli = { controle: true, procedure: "P", instruction: "I" };
  assert.deepEqual(nettoyerNomenclature({}, repli), repli, "un fichier sans nomenclature garde celle qu'on lui donne en repli");
});

test("enregistrer puis rouvrir donne la même cartographie, nomenclature comprise", () => {
  const c = autreOrganisation();
  const relu = depuisJSON(versJSON(c));
  assert.deepEqual(relu, c);
  assert.equal(relu.nomenclature.procedure, "PRO");
  assert.throws(() => depuisJSON('{"type":"procedure","processus":[]}'));
  assert.throws(() => depuisJSON("pas du json"));
  assert.throws(() => depuisJSON('{"type":"cartographie"}'));
});

// ---------- Processus, codes, échanges ----------
test("le processus d'un document se retrouve par « CODE Nom » ou par son code seul, sans tenir compte de la casse", () => {
  const c = exemple();
  assert.equal(processusDuTexte(c, "REA Réaliser le produit ou le service").code, "REA");
  assert.equal(processusDuTexte(c, "rea").code, "REA");
  assert.equal(processusDuTexte(c, " ven vendre et contractualiser ").code, "VEN");
  assert.equal(processusDuTexte(c, "Transport"), null);
  assert.equal(processusDuTexte(c, ""), null);
  assert.equal(libelleProcessus(processusParCode(c, "pil")), "PIL Piloter l'organisation");
});

test("les processus s'affichent par bloc : management, réalisation, support, puis sans bloc", () => {
  const c = nettoyerCartographie({ processus: [{ code: "AA", categorie: "support" }, { code: "BB" }, { code: "CC", categorie: "management" }] });
  assert.deepEqual(processusParCategorie(c).map((g) => g.categorie), ["management", "support", ""]);
});

test("un code de document se découpe en type, processus et numéro", () => {
  assert.deepEqual(analyserCode("pr-rea-01"), { type: "PR", processus: "REA", numero: 1 });
  assert.deepEqual(analyserCode("PRO-R1-012"), { type: "PRO", processus: "R1", numero: 12 });
  assert.equal(analyserCode("PR-REA"), null);
  assert.equal(analyserCode("M1/2024-07"), null);
  assert.equal(analyserCode(""), null);
});

test("le prochain code libre suit le registre, pour n'importe quelle organisation", () => {
  const c = exemple();
  assert.equal(prochainCode(c, "PR", "REA"), "PR-REA-01");
  assert.equal(prochainCode(c, "PR", "VEN"), "PR-VEN-02", "PR-VEN-01 est au registre");
  assert.equal(prochainCode(c, "PR", "VEN", { exclure: "PR-VEN-01" }), "PR-VEN-01", "le code du document en cours ne compte pas comme pris");
  assert.equal(prochainCode(c, "EN", "VEN"), "EN-VEN-03");
  const a = autreOrganisation();
  assert.equal(prochainCode(a, "PRO", "R1"), "PRO-R1-02");
  assert.equal(prochainCode(a, "INS", "R1"), "INS-R1-01");
});

test("le type de code d'un document vient de la nomenclature de l'organisation", () => {
  assert.equal(codeTypeDuDocument(exemple(), "procedure"), "PR");
  assert.equal(codeTypeDuDocument(exemple(), "instruction"), "IT");
  assert.equal(codeTypeDuDocument(autreOrganisation(), "procedure"), "PRO");
  assert.equal(codeTypeDuDocument(autreOrganisation(), "instruction"), "INS");
  assert.equal(codeTypeDuDocument(exemple(), ""), "");
  assert.equal(codeTypeDuDocument({ nomenclature: { procedure: "", instruction: "x1" } }, "instruction"), "IT", "valeur invalide : retour au défaut");
});

test("les échanges d'un processus : entrants et sortants, blocs entiers compris", () => {
  const c = exemple();
  const tra = processusParCode(c, "REA");
  const { entrants, sortants } = fluxDuProcessus(c, tra.id);
  const info = (l) => l.map((f) => f.information);
  assert.ok(info(entrants).includes("Commandes et exigences du client"), "flux VEN → REA");
  assert.ok(info(entrants).some((s) => s.startsWith("Orientations")), "flux Management → Réalisation : concerne tous les processus de réalisation");
  assert.ok(info(entrants).some((s) => s.startsWith("Personnel")), "flux Support → Réalisation");
  assert.ok(info(sortants).includes("Produits ou services réalisés"), "flux REA → LIV");
  assert.ok(info(sortants).some((s) => s.startsWith("Données de performance")), "flux Réalisation → Management");
  assert.ok(info(sortants).includes("Besoins en ressources"), "flux Réalisation → Support");
  assert.ok(!info(entrants).includes("Produits ou services réalisés"));
  const de = entrants.find((f) => f.information === "Commandes et exigences du client").point;
  assert.equal(de.genre, "processus");
  assert.equal(de.processus.code, "VEN");
  assert.equal(entrants.find((f) => f.information.startsWith("Orientations")).point.genre, "categorie");
  const liv = fluxDuProcessus(c, processusParCode(c, "LIV").id).sortants;
  assert.equal(liv.find((f) => f.information === "Produits livrés et facturés").point.genre, "extremite", "flux LIV → satisfaction des parties intéressées");
});

test("un échange dans les deux sens compte comme entrant et comme sortant ; un échange sans texte n'est pas proposé", () => {
  const c = exemple();
  const pil = processusParCode(c, "PIL");
  const r = fluxDuProcessus(c, pil.id);
  assert.ok(r.entrants.some((f) => f.information.startsWith("Enjeux")) && r.sortants.some((f) => f.information.startsWith("Enjeux")));
  const sans = nettoyerCartographie({ processus: [{ code: "AA", categorie: "support" }, { code: "BB" }], flux: [] });
  sans.flux.push({ id: "z", de: sans.processus[0].id, vers: sans.processus[1].id, information: "", double: false });
  assert.deepEqual(fluxDuProcessus(sans, sans.processus[0].id), { entrants: [], sortants: [] });
  assert.deepEqual(fluxDuProcessus(c, "inconnu"), { entrants: [], sortants: [] });
});

test("l'autre organisation a ses propres échanges, sans rien de l'exemple", () => {
  const a = autreOrganisation();
  const b = processusParCode(a, "R1");
  const r = fluxDuProcessus(a, b.id);
  assert.deepEqual(r.entrants.map((f) => f.information), ["Objectifs"]);
  assert.deepEqual(r.sortants.map((f) => f.information), ["Colis livrés"]);
  assert.equal(documentParCode(a, "pro-r1-01").titre, "Livrer un colis");
});

// ---------- Règles de codification ----------
const avecDocument = (c, reference, extra = {}) => procedureAvec({ typeDocument: "procedure", processus: "REA Réaliser le produit ou le service", titre: "Suivre les livraisons", reference, ...extra });

test("sans cartographie, aucune règle de codification", () => {
  assert.deepEqual(verifierCodes(avecDocument(null, "n'importe quoi"), nouvelleCartographie()), []);
  assert.deepEqual(verifierCodes(avecDocument(null, "n'importe quoi"), null), []);
});

test("nomenclature cochée : un code conforme ne donne aucune alerte", () => {
  const c = exemple();
  assert.deepEqual(verifierCodes(avecDocument(c, "PR-REA-01"), c), []);
  assert.deepEqual(verifierCodes(avecDocument(c, "pr-rea-01"), c), [], "casse ignorée");
});

test("nomenclature cochée : forme, type, processus inconnu, autre processus, code déjà pris", () => {
  const c = exemple();
  assert.ok(cles(verifierCodes(avecDocument(c, "REA-01"), c)).includes("regle.code.format"));
  assert.ok(cles(verifierCodes(avecDocument(c, "IT-REA-01"), c)).includes("regle.code.type"), "une procédure ne porte pas un code d'instruction");
  assert.ok(cles(verifierCodes(avecDocument(c, "PR-XYZ-01"), c)).includes("regle.code.processus_inconnu"));
  assert.ok(cles(verifierCodes(avecDocument(c, "PR-VEN-01"), c)).includes("regle.code.processus_different"));
  const pris = verifierCodes(avecDocument(c, "PR-VEN-01", { processus: "VEN Vendre et contractualiser", titre: "Autre chose" }), c);
  assert.ok(cles(pris).includes("regle.code.deja_pris"));
  assert.ok(!cles(verifierCodes(avecDocument(c, "PR-VEN-01", { processus: "VEN", titre: "Traiter une commande client" }), c)).includes("regle.code.deja_pris"), "même document : pas d'alerte");
});

test("un processus absent de la cartographie est signalé, que la nomenclature soit cochée ou non", () => {
  const c = exemple();
  const p = avecDocument(c, "PR-REA-01", { processus: "Transport routier" });
  assert.ok(cles(verifierCodes(p, c)).includes("regle.processus.hors_cartographie"));
  c.nomenclature.controle = false;
  assert.ok(cles(verifierCodes(p, c)).includes("regle.processus.hors_cartographie"));
});

test("nomenclature non cochée : la forme des codes n'est pas jugée, mais un code déjà pris est signalé", () => {
  const c = exemple();
  c.nomenclature.controle = false;
  assert.deepEqual(verifierCodes(avecDocument(c, "N'IMPORTE-QUOI"), c), []);
  assert.deepEqual(verifierCodes(avecDocument(c, "IT-REA-01"), c), []);
  const pris = verifierCodes(avecDocument(c, "PR-VEN-01", { processus: "VEN", titre: "Autre chose" }), c);
  assert.deepEqual(cles(pris), ["regle.code.deja_pris"]);
});

test("les types de code sont ceux de l'organisation (PRO / INS), pas PR / IT", () => {
  const a = autreOrganisation();
  const bon = procedureAvec({ typeDocument: "procedure", processus: "R1 Livrer", titre: "Préparer un envoi", reference: "PRO-R1-02" });
  assert.deepEqual(verifierCodes(bon, a), []);
  const mauvais = procedureAvec({ typeDocument: "procedure", processus: "R1 Livrer", titre: "Préparer un envoi", reference: "PR-R1-02" });
  const r = verifierCodes(mauvais, a);
  assert.ok(cles(r).includes("regle.code.type"));
  assert.equal(r.find((c) => c.cle === "regle.code.type").params.attendu, "PRO");
  const instruction = procedureAvec({ typeDocument: "instruction", processus: "R1", titre: "Scanner un colis", reference: "INS-R1-01" });
  assert.deepEqual(verifierCodes(instruction, a), []);
});

test("sous-procédures et instructions de travail : processus connu, code au registre, type attendu", () => {
  const c = exemple();
  const etape = (champs) => Object.assign(nouvelleEtape({ libelle: "Contrôler le véhicule" }), champs);
  const p = avecDocument(c, "PR-REA-01");
  p.etapes = [
    etape({ sousProcedure: { actif: true, code: "PR-XYZ-01" } }),
    etape({ sousProcedure: { actif: true, code: "PR-VEN-09" } }),
    etape({ sousProcedure: { actif: true, code: "PR-VEN-01" } }),
    etape({ niveau3: { actif: true, code: "PR-REA-02", intitule: "x" } }),
    etape({ niveau3: { actif: true, code: "IT-XYZ-01", intitule: "x" } }),
    etape({ niveau3: { actif: true, code: "IT-REA-01", intitule: "x" } }),
  ];
  const r = verifierCodes(p, c);
  const de = (cle) => r.filter((x) => x.cle === cle).map((x) => x.params.i);
  assert.deepEqual(de("regle.sp.processus_inconnu"), [1]);
  assert.deepEqual(de("regle.sp.absente_registre"), [2], "PR-VEN-09 n'est pas au registre ; PR-VEN-01 y est");
  assert.deepEqual(de("regle.n3.code_format"), [4]);
  assert.deepEqual(de("regle.n3.processus_inconnu"), [5]);
  assert.equal(r.find((x) => x.cle === "regle.n3.code_format").params.type, "IT");
});

test("les règles de base : le format du code d'une sous-procédure suit la nomenclature de l'organisation", () => {
  const p = avecDocument(null, "PR-REA-01");
  p.etapes = [Object.assign(nouvelleEtape({ libelle: "Appeler la sous-procédure" }), { sousProcedure: { actif: true, code: "PRO-R1-02" } })];
  // Sans réglage : TYPE-PROCESSUS-NN avec PR est supposé (comportement d'origine).
  assert.ok(cles(verifier(p)).includes("regle.sp.code_format"));
  // Organisation qui code « PRO » : le même code est correct.
  assert.ok(!cles(verifier(p, { nomenclature: { controle: true, procedure: "PRO" } })).includes("regle.sp.code_format"));
  // Organisation qui ne suit pas cette nomenclature : la forme n'est pas jugée.
  assert.ok(!cles(verifier(p, { nomenclature: { controle: false, procedure: "PR" } })).includes("regle.sp.code_format"));
  const message = verifier(avecEtapeCode("XX-1"), { nomenclature: { controle: true, procedure: "PRO" } }).find((c) => c.cle === "regle.sp.code_format");
  assert.equal(message.params.type, "PRO");
});
function avecEtapeCode(code) {
  const p = avecDocument(null, "PRO-R1-01");
  p.etapes = [Object.assign(nouvelleEtape({ libelle: "Appeler" }), { sousProcedure: { actif: true, code } })];
  return p;
}

test("le diagnostic ajoute les alertes de codification et retire « aucune anomalie »", () => {
  const c = exemple();
  const p = exempleInstruction();
  const sans = constatsDiagnostic(p, nouvelleCartographie());
  const avec = constatsDiagnostic(p, c);
  assert.ok(!cles(avec).some((k) => k.startsWith("regle.code.") || k === "regle.processus.hors_cartographie"), "l'exemple d'instruction est bien codé selon la cartographie de l'exemple : " + cles(avec).join(", "));
  assert.equal(avec.length, sans.length);
  p.meta.reference = "IT-REA";
  const mauvais = constatsDiagnostic(p, c);
  assert.ok(cles(mauvais).includes("regle.code.format"));
  assert.ok(!mauvais.some((x) => x.gravite === "ok"));
});

test("l'exemple d'instruction cite un processus de l'exemple de cartographie", () => {
  assert.equal(processusDuTexte(exemple(), exempleInstruction().meta.processus).code, "VEN");
});

// ---------- L'état : le store de la cartographie ----------
test("le store : saisie sans nettoyage, codes normalisés, suppression d'un processus retire ses échanges", () => {
  cs.vider();
  const ida = cs.ajouterProcessus("realisation");
  const idb = cs.ajouterProcessus("support");
  cs.modifierProcessus(ida, "code", "t");
  assert.equal(cs.lire().processus[0].code, "T", "un code à moitié tapé est gardé (majuscule)");
  cs.modifierProcessus(ida, "code", "re-a!");
  assert.equal(cs.lire().processus[0].code, "REA", "seuls A–Z et 0–9, 5 au plus");
  cs.modifierProcessus(idb, "code", "abcdefgh");
  assert.equal(cs.lire().processus[1].code, "ABCDE");
  cs.modifierProcessus(idb, "categorie", "n'importe quoi");
  assert.equal(cs.lire().processus[1].categorie, "support", "un bloc inconnu est refusé");
  const f = cs.ajouterFlux();
  cs.modifierFlux(f, "de", ida);
  cs.modifierFlux(f, "vers", idb);
  cs.modifierFlux(f, "vers", "inconnu");
  assert.equal(cs.lire().flux[0].vers, idb, "un point inconnu est refusé");
  cs.modifierFlux(f, "information", "Besoins");
  cs.supprimerProcessus(idb);
  assert.equal(cs.lire().flux.length, 0);
  cs.vider();
  assert.ok(cs.estVideMaintenant());
});

test("le store : importer une cartographie ne change pas la nomenclature de l'organisation ; « tout effacer » la remet à zéro", () => {
  cs.vider();
  cs.modifierNomenclature("controle", true);
  cs.modifierNomenclature("procedure", "pro!x");
  cs.modifierNomenclature("instruction", "ins");
  assert.deepEqual(cs.lire().nomenclature, { controle: true, procedure: "PRO", instruction: "INS" });
  cs.remplacer({ processus: [{ code: "AB", nom: "Un" }, { code: "CD", nom: "Deux" }] }); // ce que donnerait l'import d'un PDF : pas de nomenclature
  assert.deepEqual(cs.lire().nomenclature, { controle: true, procedure: "PRO", instruction: "INS" });
  cs.importerJSON(versJSON({ ...nouvelleCartographie(), processus: [{ id: "x1", code: "EF", nom: "Trois", categorie: "" }], nomenclature: { controle: false, procedure: "P", instruction: "I" } }));
  assert.deepEqual(cs.lire().nomenclature, { controle: false, procedure: "P", instruction: "I" }, "un fichier enregistré contient sa nomenclature");
  cs.vider();
  assert.deepEqual(cs.lire().nomenclature, NOMENCLATURE_PAR_DEFAUT);
});

test("le store : l'exemple est un exemple, chargé à la demande ; le registre se remplit et se vide", () => {
  cs.vider();
  assert.ok(cs.estVideMaintenant(), "l'application démarre sans cartographie");
  cs.chargerExemple();
  assert.equal(cs.lire().processus.length, 10);
  assert.equal(nomenclatureActive(cs.lire()), true, "l'exemple code TYPE-PROCESSUS-NN");
  const d = cs.ajouterDocument();
  cs.modifierDocument(d, "code", "pr-rea-01");
  cs.modifierDocument(d, "titre", "Transporter");
  assert.equal(cs.lire().documents.at(-1).code, "PR-REA-01");
  cs.supprimerDocument(d);
  assert.equal(documentParCode(cs.lire(), "PR-REA-01"), null);
  const abonnes = [];
  const arreter = cs.abonner((s) => abonnes.push(s));
  cs.modifierChamp("organisation", "Acme");
  cs.ajouterProcessus();
  arreter();
  assert.deepEqual(abonnes, [false, true], "la saisie d'un texte ne redessine pas la fenêtre ; un ajout, si");
  cs.vider();
});

// ---------- Lecture d'un PDF ----------
test("une flèche à double pointe ou à une pointe est reconnue, un rectangle non", () => {
  const fleche = [[0, 2], [30, 2], [30, 0], [40, 5], [30, 10], [30, 8], [0, 8]];
  const r = analyserFleche(fleche);
  assert.ok(r && r.double === false);
  assert.ok(r.vers[0] > r.de[0], "la pointe est à droite");
  assert.equal(analyserFleche([[0, 0], [40, 0], [40, 5], [0, 5]]), null);
});

test("le PDF de cartographie d'exemple est lu : organisation, 11 processus par bloc, 9 échanges", async () => {
  const octets = new Uint8Array(fs.readFileSync(new URL("./fixtures/Cartographie_exemple.pdf", import.meta.url)));
  const { cartographie: c, rapport } = await importerPdf(octets);
  assert.equal(c.organisation, "Entreprise Exemple");
  assert.deepEqual([...codesTri(c)].sort(), ["ACH", "AME", "CLI", "FIN", "INF", "JUR", "LIV", "MAI", "PIL", "PRO", "RHU"]);
  assert.equal(c.processus.length, 11);
  const bloc = (code) => processusParCode(c, code).categorie;
  ["PIL", "AME"].forEach((k) => assert.equal(bloc(k), "management", k));
  ["CLI", "PRO", "LIV"].forEach((k) => assert.equal(bloc(k), "realisation", k));
  ["RHU", "MAI", "ACH", "FIN", "INF", "JUR"].forEach((k) => assert.equal(bloc(k), "support", k));
  assert.equal(processusParCode(c, "PRO").nom, "Réaliser les prestations");
  assert.equal(c.flux.length, 9);
  const nom = (id) => c.processus.find((p) => p.id === id)?.code || id;
  const flux = c.flux.map((f) => `${nom(f.de)}${f.double ? "<>" : ">"}${nom(f.vers)}`);
  ["contexte<>management", "management>realisation", "realisation>management", "CLI>PRO", "PRO>LIV", "PRO>satisfaction", "LIV>satisfaction", "support>realisation", "realisation>support"]
    .forEach((attendu) => assert.ok(flux.includes(attendu), `échange attendu : ${attendu} (lus : ${flux.join(" ")})`));
  assert.ok(cles(rapport).includes("carto.import.resume"));
  assert.ok(!rapport.some((r) => r.gravite === "erreur"));
  assert.deepEqual(nettoyerCartographie(c), c, "ce que le PDF donne est déjà propre");
});

test("le PDF lu donne les textes exacts des processus et des échanges du document d'origine", async () => {
  const octets = new Uint8Array(fs.readFileSync(new URL("./fixtures/Cartographie_exemple.pdf", import.meta.url)));
  const { cartographie: lue } = await importerPdf(octets);
  const code = (c, id) => (c.processus.find((p) => p.id === id) || { code: id }).code;
  const processus = lue.processus.map((p) => [p.code, p.nom, p.categorie]).sort();
  assert.deepEqual(processus, [
    ["ACH", "Acheter et gérer les stocks", "support"], ["AME", "Améliorer en continu la performance", "management"], ["CLI", "Développer et fidéliser la clientèle", "realisation"],
    ["FIN", "Gérer les finances", "support"], ["INF", "Gérer les systèmes d'information", "support"], ["JUR", "Garantir la conformité juridique", "support"],
    ["LIV", "Livrer et facturer", "realisation"], ["MAI", "Maintenir les équipements", "support"], ["PIL", "Piloter l'entreprise", "management"],
    ["PRO", "Réaliser les prestations", "realisation"], ["RHU", "Gérer les ressources humaines", "support"],
  ]);
  const flux = lue.flux.map((f) => [code(lue, f.de), code(lue, f.vers), f.information, f.double]).sort();
  const attendu = [
    ["contexte", "management", "Enjeux, risques et opportunités ⇄ orientations stratégiques", true],
    ["management", "realisation", "Orientations, objectifs, exigences", false],
    ["realisation", "management", "Données de performance, écarts, incidents", false],
    ["CLI", "PRO", "Contrats, commandes", false],
    ["PRO", "LIV", "Prestations réalisées", false],
    ["PRO", "satisfaction", "Livrables remis", false],
    ["LIV", "satisfaction", "Factures et livraisons", false],
    ["support", "realisation", "Personnel, équipements, achats, outils SI, conformité", false],
    ["realisation", "support", "Besoins en ressources", false],
  ].sort();
  assert.deepEqual(flux, attendu);
});

test("un PDF sans texte (scan) ou illisible donne un message clair, pas une cartographie", async () => {
  const r = interpreter({ largeur: 600, hauteur: 800, textes: [], formes: [] });
  assert.equal(r.cartographie.processus.length, 0);
  assert.deepEqual(cles(r.rapport), ["carto.import.sans_texte"]);
  await assert.rejects(importerPdf(new Uint8Array([1, 2, 3, 4])));
});

test("lecture simplifiée : une liste « CODE Nom » sous des titres de bloc, sans dessin, est comprise (autre organisation)", () => {
  const ligne = (s, y) => ({ s, taille: 10, vertical: false, bb: [50, y, 50 + s.length * 5, y + 10] });
  const mise = {
    largeur: 600, hauteur: 800, formes: [],
    textes: [ligne("Processus de management", 50), ligne("M1 Diriger l'entreprise", 80), ligne("Processus de réalisation", 120), ligne("R1 Livrer les colis", 150), ligne("R2 Facturer", 180), ligne("Processus support", 220), ligne("S1 Maintenir les véhicules", 250)],
  };
  const { cartographie: c, rapport } = interpreter(mise);
  assert.deepEqual(codesTri(c), ["M1", "R1", "R2", "S1"]);
  assert.equal(processusParCode(c, "M1").categorie, "management");
  assert.equal(processusParCode(c, "R2").categorie, "realisation");
  assert.equal(processusParCode(c, "S1").categorie, "support");
  assert.equal(processusParCode(c, "R1").nom, "Livrer les colis");
  assert.ok(cles(rapport).includes("carto.import.lecture_simple"));
});

test("aucun processus reconnu : un message qui dit quoi faire", () => {
  const ligne = (s, y) => ({ s, taille: 10, vertical: false, bb: [50, y, 50 + s.length * 5, y + 10] });
  const r = interpreter({ largeur: 600, hauteur: 800, formes: [], textes: [ligne("Un texte quelconque", 50), ligne("Sans aucun code de processus", 80), ligne("Rien à reconnaître ici", 110)] });
  assert.equal(r.cartographie.processus.length, 0);
  assert.ok(cles(r.rapport).includes("carto.import.aucun_processus"));
});

// ---------- Textes FR / EN ----------
const params = (s) => [...new Set([...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();

test("les textes de la cartographie existent en français et en anglais, avec les mêmes {paramètres}", () => {
  const motif = /^(carto\.|deroule\.carto\.|regle\.code\.|regle\.processus\.|regle\.sp\.|regle\.n3\.|form\.code\.|form\.processus|form\.organisation\.reprendre|fichier\.cartographie)/;
  const clesFr = Object.keys(fr).filter((k) => motif.test(k));
  assert.ok(clesFr.length > 90, "les textes de la cartographie sont bien là : " + clesFr.length);
  clesFr.forEach((k) => {
    assert.ok(k in en, `clé manquante en anglais : ${k}`);
    assert.deepEqual(params(fr[k]), params(en[k]), `paramètres différents : ${k}`);
    assert.ok(String(fr[k]).trim() && String(en[k]).trim(), `texte vide : ${k}`);
  });
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort(), "mêmes clés dans les deux langues");
});

test("chaque clé de rapport d'import et de règle produite par le code existe dans les textes", () => {
  const produites = [
    "carto.import.resume", "carto.import.sans_texte", "carto.import.aucun_processus", "carto.import.lecture_simple", "carto.import.sans_categorie",
    "carto.import.fleches_non_rattachees", "carto.import.fleches_sans_texte", "carto.import.textes_isoles", "carto.import.aucun_echange",
    "regle.processus.hors_cartographie", "regle.code.format", "regle.code.type", "regle.code.processus_inconnu", "regle.code.processus_different", "regle.code.deja_pris",
    "regle.sp.processus_inconnu", "regle.sp.absente_registre", "regle.n3.code_format", "regle.n3.processus_inconnu",
    "carto.nomenclature", "carto.nomenclature.aide", "carto.nomenclature.controle", "carto.nomenclature.procedure", "carto.nomenclature.instruction",
    "carto.documents.code.nomenclature", "carto.documents.code.invalide", "carto.exemple",
  ];
  produites.forEach((k) => { assert.ok(k in fr && k in en, k); });
  assert.ok(!("regle.sp.type" in fr) && !("regle.sp.type" in en), "règle retirée : le type est déjà signalé par le format de la sous-procédure");
});

test("les textes de l'interface ne supposent aucune entreprise : l'exemple est présenté comme un exemple", () => {
  assert.match(fr["carto.vide"], /chaque organisation/i);
  assert.match(en["carto.vide"], /each organisation/i);
  assert.match(fr["carto.exemple"], /exemple/i);
  assert.doesNotMatch(fr["carto.documents.aide"], /Responsable qualité/, "la personne qui attribue les codes dépend de l'organisation");
  assert.doesNotMatch(en["carto.documents.aide"], /Quality Manager/);
});

test("l'application ne contient aucune cartographie par défaut : la cartographie d'exemple n'est qu'un exemple", () => {
  const source = fs.readFileSync(new URL("../js/cartographie-store.js", import.meta.url), "utf8");
  assert.doesNotMatch(source.replace(/\/\/.*$/gm, ""), PROPRE, "aucun nom d'entreprise dans le code du store hors commentaires");
  const modeleSources = ["../js/cartographie.js", "../js/cartographie-pdf.js", "../js/rules-codes.js"].map((f) => fs.readFileSync(new URL(f, import.meta.url), "utf8").replace(/\/\/.*$/gm, ""));
  modeleSources.forEach((s) => assert.doesNotMatch(s, new RegExp(`${PROPRE.source}|"PR-|"IT-`), "aucun code ni nom d'entreprise écrit en dur"));
});
