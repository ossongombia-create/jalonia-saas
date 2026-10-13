// Tests de l'échange BPMN 2.0 (js/bpmn.js) : export, aller-retour sans perte, lecture d'un BPMN venu d'ailleurs avec son
// rapport, refus des fichiers dangereux ou illisibles. La validité contre le schéma XSD officiel est vérifiée à part
// (npm run test:bpmn, tests/bpmn/valider_xsd.py) sur les fichiers produits par tests/bpmn/exporter-exemples.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { versBpmn, depuisBpmn, lireXml, NS, ErreurBpmn } from "../js/bpmn.js";
import { nettoyer } from "../js/store.js";
import { exempleProcedure } from "../js/exemple-procedure.js";
import { exempleInstruction } from "../js/exemple-it.js";
import { procedureComplete } from "./fixtures/bpmn-procedures.mjs";
import fr from "../js/locales/fr.js";
import en from "../js/locales/en.js";

const allerRetour = (p) => nettoyer(depuisBpmn(versBpmn(nettoyer(p))).procedure);
const elements = (racine, local) => {
  const trouves = [];
  const parcourir = (el) => { if (el.ns === NS.bpmn && el.local === local) trouves.push(el); el.enfants.forEach(parcourir); };
  parcourir(racine);
  return trouves;
};
const attr = (el, nom) => el.attributs.get(`|${nom}`);
const sansExtensions = (xml) => xml.replace(/<bpmn:extensionElements>[\s\S]*?<\/bpmn:extensionElements>/g, "");
const cles = (rapport) => rapport.map((c) => c.cle);

test("export : processus dans un participant, un couloir par rôle, une tâche par instruction, dessin complet", () => {
  const p = nettoyer(exempleProcedure());
  const xml = versBpmn(p, { versionApplication: "1.5" });
  const racine = lireXml(xml);
  assert.equal(racine.local, "definitions");
  assert.ok(attr(racine, "exporter").length > 0); // le nom de l'outil (config.js)
  assert.equal(attr(racine, "exporterVersion"), "1.5");
  assert.equal(elements(racine, "process").length, 1);
  assert.equal(attr(elements(racine, "participant")[0], "name"), p.meta.titre);
  assert.deepEqual(elements(racine, "lane").map((l) => attr(l, "name")), p.roles.map((r) => r.nom));
  const taches = [...elements(racine, "task"), ...elements(racine, "callActivity")];
  assert.equal(taches.length, p.etapes.length);
  assert.equal(attr(elements(racine, "startEvent")[0], "name"), p.meta.declencheur);
  assert.equal(attr(elements(racine, "endEvent")[0], "name"), p.meta.fin);
  // La décision de l'exemple (« Non conforme » → retour en cuisine) : passerelle exclusive, flux par défaut = suite normale.
  const passerelles = elements(racine, "exclusiveGateway");
  assert.equal(passerelles.length, p.etapes.filter((e) => e.alternatives.length > 0).length);
  const flux = elements(racine, "sequenceFlow");
  for (const g of passerelles) assert.ok(flux.some((f) => attr(f, "id") === attr(g, "default")), "flux par défaut existant");
  assert.ok(flux.some((f) => attr(f, "name") === "Non conforme"));
  // Identifiants uniques ; chaque nœud et chaque flux a sa forme ou sa flèche dans le dessin.
  const ids = [];
  const parcourir = (el) => { const id = attr(el, "id"); if (id) ids.push(id); el.enfants.forEach(parcourir); };
  parcourir(racine);
  assert.equal(new Set(ids).size, ids.length);
  const dessinees = new Set();
  const dessin = (el) => { const b = attr(el, "bpmnElement"); if (b) dessinees.add(b); el.enfants.forEach(dessin); };
  dessin(racine);
  for (const el of [...taches, ...passerelles, ...flux, ...elements(racine, "lane"), ...elements(racine, "startEvent"), ...elements(racine, "endEvent")]) {
    assert.ok(dessinees.has(attr(el, "id")), `dessin de ${attr(el, "id")}`);
  }
});

test("aller-retour SANS PERTE : l'exemple et une procédure qui utilise tout le modèle", () => {
  for (const p of [exempleProcedure(), procedureComplete()]) {
    assert.deepEqual(allerRetour(p), nettoyer(p));
  }
});

test("aller-retour : textes avec sauts de ligne, tabulations, guillemets, &, <, >, caractères interdits en XML", () => {
  const p = nettoyer(procedureComplete());
  p.etapes[0].libelle = "  Ligne 1\nLigne\t2 « 3 » & <4> \"5\" '6'  ";
  p.roles[0].nom = " Acheteur ";
  p.etapes[0].sortie = "Bon\u0007 de\r\ncommande";
  p.meta.titre = "  Titre avec espaces  ";
  assert.deepEqual(allerRetour(p), nettoyer(p));
});

test("aller-retour : procédure vide et procédure sans titre ni rôle", () => {
  const vide = nettoyer({ meta: { typeDocument: "procedure" }, roles: [], etapes: [] });
  assert.deepEqual(allerRetour(vide), vide);
  const sansRole = nettoyer({ meta: { typeDocument: "procedure", titre: "" }, roles: [], etapes: [{ id: "e1", libelle: "Seule" }, { id: "e2", libelle: "Suite" }] });
  assert.deepEqual(allerRetour(sansRole), sansRole);
});

test("sans les extensions Jalonia (fichier modifié par un autre outil) : le sous-ensemble standard est repris à l'identique", () => {
  const p = nettoyer(procedureComplete());
  const { procedure, rapport } = depuisBpmn(sansExtensions(versBpmn(p)));
  const lu = nettoyer(procedure);
  assert.equal(rapport[0].cle, "bpmn.import.standard");
  const nomRole = (proc, id) => (proc.roles.find((r) => r.id === id) || { nom: "" }).nom;
  const libelleDe = (proc, vers) => (vers === "fin" ? "fin" : vers === "" ? "" : proc.etapes.find((e) => e.id === vers).libelle);
  const sousEnsemble = (proc) => ({
    titre: proc.meta.titre, declencheur: proc.meta.declencheur, fin: proc.meta.fin,
    roles: proc.roles.map((r) => r.nom),
    etapes: proc.etapes.map((e) => ({
      libelle: e.libelle, role: nomRole(proc, e.roleId), sortie: e.sortie, sousProcedure: e.sousProcedure.actif,
      condition: e.alternatives.some((a) => a.vers) ? e.condition : "",
      alternatives: e.alternatives.filter((a) => a.vers).map((a) => [a.condition, libelleDe(proc, a.vers)]),
      operateurSortie: e.alternatives.some((a) => a.vers) ? e.operateurSortie : "ou",
      operateurEntree: e.operateurEntree,
    })),
  });
  const attendu = sousEnsemble(p);
  // Ce que BPMN ne peut pas écrire : un opérateur d'entrée sur une instruction où n'arrive qu'une flèche.
  const arrivees = new Map(p.etapes.map((e) => [e.id, 1]));
  p.etapes.forEach((e) => e.alternatives.forEach((a) => { if (arrivees.has(a.vers) && a.vers !== e.id) arrivees.set(a.vers, arrivees.get(a.vers) + 1); }));
  attendu.etapes.forEach((e, i) => { if (arrivees.get(p.etapes[i].id) < 2) e.operateurEntree = ""; });
  assert.deepEqual(sousEnsemble(lu), attendu);
});

test("un BPMN venu d'un autre outil : sous-ensemble repris, et TOUT ce qui ne l'est pas est dans le rapport", () => {
  const xml = fs.readFileSync(new URL("./fixtures/autre-outil.bpmn", import.meta.url), "utf8");
  const { procedure, rapport } = depuisBpmn(xml);
  const p = nettoyer(procedure);
  assert.equal(p.meta.titre, "Traiter une réclamation");
  assert.equal(p.meta.declencheur, "Réclamation reçue");
  assert.equal(p.meta.fin, "Réclamation close");
  assert.deepEqual(p.roles.map((r) => r.nom), ["Service client", "Qualité"]);
  assert.deepEqual(p.etapes.map((e) => [e.libelle, p.roles.find((r) => r.id === e.roleId)?.nom ?? ""]), [
    ["Enregistrer la réclamation", "Service client"],
    ["Analyser la réclamation", "Qualité"],
    ["Répondre au client", "Service client"],
    ["Ouvrir une action corrective", "Qualité"],
  ]);
  const analyser = p.etapes[1];
  assert.equal(analyser.condition, "Fondée");
  assert.deepEqual(analyser.alternatives.map((a) => [a.condition, a.vers]), [["Non fondée", "fin"]]);
  assert.equal(p.etapes[0].sortie, "Fiche de réclamation");
  // Passerelle parallèle après « Répondre » : la suite normale est l'instruction suivante, l'autre branche (vers la fin) une
  // suite simultanée.
  assert.equal(p.etapes[2].operateurSortie, "et");
  assert.equal(p.etapes[2].sortie, "Réponse");
  assert.deepEqual(p.etapes[2].alternatives.map((a) => a.vers), ["fin"]);
  assert.deepEqual(cles(rapport), [
    "bpmn.import.standard", "bpmn.import.autres_processus", "bpmn.import.non_repris",
  ]);
  const nonRepris = rapport.find((c) => c.cle === "bpmn.import.non_repris").params.liste;
  assert.deepEqual(nonRepris.map((x) => [x.cle, x.n]).sort(), [
    ["bpmn.el.annotation", 1], ["bpmn.el.association", 1], ["bpmn.el.definition_evenement", 1], ["bpmn.el.documentation", 1],
    ["bpmn.el.evenement_bordure", 1], ["bpmn.el.evenement_intermediaire", 1], ["bpmn.el.flux_message", 1], ["bpmn.el.objet_donnees", 2],
    ["bpmn.el.flux_sequence", 1], ["bpmn.el.nom_passerelle", 1],
  ].sort());
});

test("passerelle inclusive, sorties multiples sans passerelle, suite qui revient en arrière, trop d'alternatives : signalés", () => {
  const xml = `<?xml version="1.0"?><definitions xmlns="${NS.bpmn}" id="d" targetNamespace="x"><process id="p">
    <startEvent id="s"/><task id="a" name="A"/><task id="b" name="B"/><task id="c" name="C"/><endEvent id="f"/>
    <inclusiveGateway id="g" default="f2"/>
    <sequenceFlow id="f0" sourceRef="s" targetRef="a"/><sequenceFlow id="f1" sourceRef="a" targetRef="g"/>
    <sequenceFlow id="f2" sourceRef="g" targetRef="b" name="oui"/><sequenceFlow id="f3" sourceRef="g" targetRef="c" name="non"/>
    <sequenceFlow id="f4" sourceRef="b" targetRef="c"/><sequenceFlow id="f5" sourceRef="b" targetRef="f"/>
    <sequenceFlow id="f6" sourceRef="c" targetRef="a" name="encore"/>
  </process></definitions>`;
  const { procedure, rapport } = depuisBpmn(xml);
  assert.deepEqual(procedure.etapes.map((e) => e.libelle), ["A", "B", "C"]);
  assert.deepEqual(cles(rapport).sort(), ["bpmn.import.passerelle_inclusive", "bpmn.import.sorties_multiples", "bpmn.import.standard", "bpmn.import.suite_deplacee"].sort());
  const [a, b, c] = procedure.etapes;
  assert.equal(a.condition, "oui");
  assert.deepEqual(a.alternatives.map((x) => [x.condition, x.vers]), [["non", c.id]]);
  assert.equal(b.operateurSortie, "et");
  assert.deepEqual(b.alternatives.map((x) => x.vers), ["fin"]);
  assert.deepEqual(c.alternatives.map((x) => x.vers), [a.id]); // la suite « encore » revient en arrière : gardée comme alternative

  const beaucoup = `<?xml version="1.0"?><definitions xmlns="${NS.bpmn}" id="d" targetNamespace="x"><process id="p">
    <startEvent id="s"/><task id="a" name="A"/><exclusiveGateway id="g"/><endEvent id="f"/>
    ${[1, 2, 3, 4, 5].map((i) => `<task id="t${i}" name="T${i}"/><sequenceFlow id="x${i}" sourceRef="g" targetRef="t${i}" name="cas ${i}"/><sequenceFlow id="y${i}" sourceRef="t${i}" targetRef="f"/>`).join("")}
    <sequenceFlow id="f0" sourceRef="s" targetRef="a"/><sequenceFlow id="f1" sourceRef="a" targetRef="g"/>
  </process></definitions>`;
  const r2 = depuisBpmn(beaucoup);
  const limite = r2.rapport.find((c) => c.cle === "bpmn.import.limite_alternatives");
  assert.deepEqual(limite.params, { element: "A", n: 4, max: 3 });
});

test("refus : DTD (entités), entité inconnue, XML mal formé, préfixe inconnu, autre format, aucun processus, trop gros", () => {
  const refus = (xml, cle) => assert.throws(() => depuisBpmn(xml), (e) => e instanceof ErreurBpmn && e.cle === cle, cle);
  refus(`<?xml version="1.0"?><!DOCTYPE d [<!ENTITY x "y">]><definitions xmlns="${NS.bpmn}"/>`, "bpmn.import.dtd");
  refus(`<definitions xmlns="${NS.bpmn}"><process id="p"><task name="&x;"/></process></definitions>`, "bpmn.import.illisible");
  refus(`<definitions xmlns="${NS.bpmn}"><process id="p"></definitions>`, "bpmn.import.illisible");
  refus(`<definitions xmlns="${NS.bpmn}"><z:process id="p"/></definitions>`, "bpmn.import.illisible");
  refus(`<w:document xmlns:w="urn:word"/>`, "bpmn.import.pas_bpmn");
  refus(`<definitions xmlns="${NS.bpmn}"/>`, "bpmn.import.aucun_processus");
  refus("x".repeat(10_000_001), "bpmn.import.trop_gros");
  refus("pas du xml", "bpmn.import.illisible");
});

test("lecture XML : espaces de noms, CDATA, références de caractères, normalisation des attributs", () => {
  const r = lireXml(`<a:x xmlns:a="urn:a" xmlns="urn:defaut" v="1&#10;2\n3"><y>t&amp;<![CDATA[<b>]]>&#x263A;</y><!-- c --></a:x>`);
  assert.equal(r.ns, "urn:a");
  assert.equal(r.attributs.get("|v"), "1\n2 3");
  assert.equal(r.enfants[0].ns, "urn:defaut");
  assert.equal(r.enfants[0].texte, "t&<b>☺");
});

test("une instruction de travail (niveau 3) ne s'exporte pas en BPMN", () => {
  assert.throws(() => versBpmn(nettoyer(exempleInstruction())), (e) => e instanceof ErreurBpmn && e.cle === "bpmn.export.instruction");
});

test("textes du rapport : chaque clé existe en français et en anglais", () => {
  const source = fs.readFileSync(new URL("../js/bpmn.js", import.meta.url), "utf8");
  const utilisees = [...new Set([...source.matchAll(/"(bpmn\.[a-z_.]+)"/g)].map((m) => m[1]))];
  assert.ok(utilisees.length > 20);
  for (const cle of [...utilisees, "bpmn.import.titre", "bpmn.import.bouton", "bpmn.import.fichier_refuse", "bpmn.export.titre", "bpmn.export.aide", "bpmn.export.bouton", "bpmn.el.liste"]) {
    assert.ok(fr[cle], `fr : ${cle}`);
    assert.ok(en[cle], `en : ${cle}`);
  }
});
