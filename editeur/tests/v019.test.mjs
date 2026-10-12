// Tests v0.19 — (d) la section 8 « Indicateurs de suivi » se remplit à partir des indicateurs de performance (fanion) des instructions ;
// (c) l'indicateur d'interface : le symbole « contrat » posé sur le panier de la flèche d'information (livre §6.5.22).
import test from "node:test";
import assert from "node:assert/strict";
import * as store from "../js/store.js";
import { nouvelleProcedure, nouvelleEtape, signatureContenu, partiesDeLaFleche } from "../js/model.js";
import { listeIndicateurs, construireDocument } from "../js/document.js";
import { verifier } from "../js/rules.js";
import { dessinerNiveau2, mesurerPanier, dessinerPanier } from "../js/render.js";
import { exempleProcedure } from "../js/exemple-procedure.js";
import { definirLangue, t } from "../js/i18n.js";
import fr from "../js/locales/fr.js";
import en from "../js/locales/en.js";

definirLangue("fr");
const cles = (constats) => constats.map((c) => c.cle);

// Une procédure de trois instructions : Assistant, Assistant, Comptable (la 2 → 3 change de rôle).
function trois() {
  const p = nouvelleProcedure();
  p.roles = [{ id: "r1", nom: "Assistant", type: "individuel" }, { id: "r2", nom: "Comptable", type: "individuel" }];
  p.meta.titre = "Valider la commande";
  p.etapes = [
    nouvelleEtape({ roleId: "r1", libelle: "Réceptionner la commande", entree: "Demande", sortie: "Commande reçue" }),
    nouvelleEtape({ roleId: "r1", libelle: "Vérifier le besoin", entree: "Commande reçue", sortie: "Besoin validé" }),
    nouvelleEtape({ roleId: "r2", libelle: "Établir le devis", entree: "Besoin validé", sortie: "Devis" }),
  ];
  return p;
}
const section = (doc, cle) => doc.sections.find((s) => s.cle === cle);
const tableaux = (doc, cle) => section(doc, cle).blocs.filter((b) => b.type === "tableau");

// ---------- (d) Section 8 alimentée par les indicateurs ----------
test("indicateurs : une entrée par instruction mesurée, avec formule, cible, fréquence et responsable", () => {
  const p = trois();
  p.etapes[0].indicateur = { actif: true, nom: "Taux de commandes traitées", formule: "traitées ÷ reçues", cible: "≥ 95 %", frequence: "Mensuelle" };
  p.etapes[2].indicateur = { actif: true, nom: "  Délai de devis ", formule: "", cible: "", frequence: "" };
  p.etapes[1].indicateur = { actif: false, nom: "Ignoré", formule: "", cible: "", frequence: "" };
  const l = listeIndicateurs(p);
  assert.deepEqual(l.map((x) => [x.n, x.nom, x.formule, x.cible, x.frequence, x.responsable]), [
    [1, "Taux de commandes traitées", "traitées ÷ reçues", "≥ 95 %", "Mensuelle", "Assistant"],
    [3, "Délai de devis", "", "", "", "Comptable"],
  ]);
  p.etapes[0].indicateur.nom = "   ";
  assert.equal(listeIndicateurs(p).length, 1, "un indicateur sans nom n'est pas listé");
});

test("document : la section 8 contient le tableau généré, une ligne par indicateur ; sans indicateur, pas de tableau", () => {
  const p = trois();
  assert.equal(tableaux(construireDocument(p), "indicateurs").length, 0, "aucun indicateur : pas de tableau vide");
  p.etapes[0].indicateur = { actif: true, nom: "Taux de commandes traitées", formule: "traitées ÷ reçues", cible: "≥ 95 %", frequence: "Mensuelle" };
  p.etapes[2].indicateur = { actif: true, nom: "Délai de devis", formule: "jours ouvrés", cible: "≤ 2 jours", frequence: "Trimestrielle" };
  const tab = tableaux(construireDocument(p), "indicateurs");
  assert.equal(tab.length, 1);
  assert.equal(tab[0].lignes.length, 2);
  assert.equal(tab[0].colonnes[0], "Indicateur");
  const ligne = tab[0].lignes[0].map((c) => (typeof c === "string" ? c : c.texte ?? String(c)));
  assert.match(ligne.join(" | "), /Taux de commandes traitées/);
  assert.match(ligne.join(" | "), /≥ 95 %/);
  assert.match(ligne.join(" | "), /Mensuelle/);
});

test("document : les paragraphes et tableaux saisis à la main dans la section 8 restent, à côté du tableau généré", () => {
  const p = trois();
  p.etapes[0].indicateur = { actif: true, nom: "Indicateur A", formule: "", cible: "", frequence: "" };
  p.corps.indicateurs.unshift({ id: "bx", type: "p", texte: "Suivi mensuel par le pilote." });
  const blocs = section(construireDocument(p), "indicateurs").blocs;
  assert.equal(blocs[0].texte, "Suivi mensuel par le pilote.");
  assert.equal(blocs[1].type, "tableau");
});

test("signature : un fichier validé avant la v0.19 reste validé (indicateur sans formule / cible / fréquence, pas de bloc généré, pas de contrat)", () => {
  const recent = trois();
  recent.etapes[0].indicateur = { actif: true, nom: "Taux de commandes traitées", formule: "", cible: "", frequence: "" };
  assert.ok(recent.corps.indicateurs.some((b) => b.type === "genere"), "une procédure neuve a le bloc généré");
  const ancien = JSON.parse(JSON.stringify(recent)); // mêmes identifiants : seule la forme change
  ancien.etapes[0].indicateur = { actif: true, nom: "Taux de commandes traitées" }; // ancienne forme : deux champs seulement
  ancien.etapes.forEach((e) => { delete e.contrat; });
  ancien.corps.indicateurs = ancien.corps.indicateurs.filter((b) => b.type !== "genere");
  assert.equal(signatureContenu(recent), signatureContenu(ancien));
  recent.etapes[0].indicateur.cible = "≥ 95 %";
  assert.notEqual(signatureContenu(recent), signatureContenu(ancien), "renseigner la cible change le contenu");
});

test("règle : un indicateur sans formule, cible ou fréquence est signalé (il remplit la section 8)", () => {
  const p = trois();
  p.etapes[0].indicateur = { actif: true, nom: "Taux", formule: "a ÷ b", cible: "", frequence: "Mensuelle" };
  const c = verifier(p).find((x) => x.cle === "regle.indicateur.incomplet");
  assert.ok(c);
  assert.equal(c.params.i, 1);
  assert.match(t(c.cle, c.params), /Taux/);
  p.etapes[0].indicateur.cible = "≥ 95 %";
  assert.ok(!cles(verifier(p)).includes("regle.indicateur.incomplet"));
  p.etapes[0].indicateur.nom = "";
  assert.ok(cles(verifier(p)).includes("regle.indicateur.sans_nom"));
});

test("magasin : modifierIndicateur — champs, limites, annulation ; un ancien objet d'indicateur est complété à l'ouverture", () => {
  store.nouvelle();
  store.ajouterRole(); store.ajouterEtape();
  const id = store.lire().etapes[0].id;
  store.modifierIndicateur(id, "actif", true);
  store.modifierIndicateur(id, "nom", "Taux");
  store.modifierIndicateur(id, "formule", "x".repeat(500));
  store.modifierIndicateur(id, "cible", "≥ 95 %");
  store.modifierIndicateur(id, "frequence", "Mensuelle");
  store.modifierIndicateur(id, "couleur", "rouge");
  const i = store.lire().etapes[0].indicateur;
  assert.equal(i.formule.length, 300);
  assert.deepEqual([i.actif, i.nom, i.cible, i.frequence], [true, "Taux", "≥ 95 %", "Mensuelle"]);
  assert.equal(i.couleur, undefined);
  store.annuler();
  assert.equal(store.lire().etapes[0].indicateur.frequence, "", "la frappe est annulable");
  const brut = JSON.parse(JSON.stringify(store.lire()));
  brut.etapes[0].indicateur = { actif: true, nom: "Ancien" };
  store.importerProcedure(brut);
  assert.deepEqual(store.lire().etapes[0].indicateur, { actif: true, nom: "Ancien", formule: "", cible: "", frequence: "" });
});

test("exemple : le bloc généré de la section 8 est là, sans changer la signature ni ajouter de tableau vide", () => {
  const p = exempleProcedure();
  assert.ok(p.corps.indicateurs.some((b) => b.type === "genere"));
  assert.equal(tableaux(construireDocument(p), "indicateurs").length, 1, "seul le tableau saisi de l'exemple");
});

// ---------- (c) Indicateur d'interface : le contrat ----------
test("modèle : une instruction neuve n'a pas de contrat ; la signature ignore un contrat vide", () => {
  assert.deepEqual(nouvelleEtape().contrat, { actif: false, reference: "" });
  const a = trois();
  const b = JSON.parse(JSON.stringify(a));
  delete b.etapes[0].contrat; // absent (fichier d'avant) ou vide : même signature
  assert.equal(signatureContenu(a), signatureContenu(b));
  b.etapes[0].contrat = { actif: false, reference: "" };
  assert.equal(signatureContenu(a), signatureContenu(b));
  b.etapes[2].contrat = { actif: true, reference: "" };
  assert.notEqual(signatureContenu(a), signatureContenu(b), "un contrat activé fait partie du contenu");
});

test("parties de la flèche : rôle de l'instruction, rôle de la suivante (ou de l'action aval pour la dernière)", () => {
  const p = trois();
  assert.deepEqual(partiesDeLaFleche(p, 0), { de: "Assistant", vers: "Assistant", memeRole: true });
  assert.deepEqual(partiesDeLaFleche(p, 1), { de: "Assistant", vers: "Comptable", memeRole: false });
  assert.deepEqual(partiesDeLaFleche(p, 2), { de: "Comptable", vers: "", memeRole: false });
  p.meta.aval = { texte: "Suite donnée", role: "Client", information: "Devis" };
  assert.deepEqual(partiesDeLaFleche(p, 2), { de: "Comptable", vers: "Client", memeRole: false });
  assert.deepEqual(partiesDeLaFleche(p, 9), { de: "", vers: "", memeRole: false });
});

test("magasin : modifierContrat — activer, référence limitée à 80 caractères, champs inconnus refusés, annulation ; nettoyage à l'ouverture", () => {
  store.nouvelle();
  store.ajouterRole(); store.ajouterEtape();
  const id = store.lire().etapes[0].id;
  store.modifierContrat(id, "actif", true);
  store.modifierContrat(id, "reference", "CT-2026-01 " + "x".repeat(200));
  store.modifierContrat(id, "couleur", "rouge");
  store.modifierContrat("inconnu", "actif", true);
  const c = store.lire().etapes[0].contrat;
  assert.equal(c.actif, true);
  assert.equal(c.reference.length, 80);
  assert.equal(c.couleur, undefined);
  store.annuler(); store.annuler();
  assert.equal(store.lire().etapes[0].contrat.actif, false);
  const brut = JSON.parse(JSON.stringify(store.lire()));
  brut.etapes[0].contrat = { actif: "oui", reference: 42, autre: 1 };
  store.importerProcedure(brut);
  assert.deepEqual(store.lire().etapes[0].contrat, { actif: false, reference: "" });
  delete brut.etapes[0].contrat; // fichier d'avant la v0.19
  store.importerProcedure(brut);
  assert.deepEqual(store.lire().etapes[0].contrat, { actif: false, reference: "" });
});

test("règles : contrat sans référence ; contrat entre deux instructions du même rôle", () => {
  const p = trois();
  p.etapes[1].contrat = { actif: true, reference: "CT-01" }; // Assistant → Comptable : bien
  let c = cles(verifier(p));
  assert.ok(!c.includes("regle.contrat.sans_reference") && !c.includes("regle.contrat.meme_role"));
  p.etapes[0].contrat = { actif: true, reference: "" }; // Assistant → Assistant, sans référence
  const constats = verifier(p);
  assert.ok(cles(constats).includes("regle.contrat.sans_reference"));
  const meme = constats.find((x) => x.cle === "regle.contrat.meme_role");
  assert.deepEqual(meme.params, { i: 1, role: "Assistant" });
  assert.match(t(meme.cle, meme.params), /Assistant/);
  // Un contrat inactif ne déclenche rien.
  p.etapes[0].contrat = { actif: false, reference: "" };
  c = cles(verifier(p));
  assert.ok(!c.includes("regle.contrat.meme_role"));
});

test("section 6 : plus de tableau ; le contrat d'interface est porté par le logigramme (symbole sur le panier)", () => {
  const p = trois();
  p.etapes[1].contrat = { actif: true, reference: "CT-DOC-01" };
  p.etapes[2].contrat = { actif: true, reference: "" };
  assert.equal(tableaux(construireDocument(p), "description").length, 0, "plus de tableau d'activités en section 6");
  // Le symbole « contrat » posé sur le panier de la flèche est vérifié par le test de dessin dédié ci-dessous.
  assert.ok(dessinerNiveau2(p).includes("</svg>"), "le logigramme se dessine");
});

test("dessin : le symbole « contrat » est posé sur le panier de la flèche, seulement pour les contrats actifs", () => {
  const p = trois();
  const nb = (svg) => (svg.match(/class="symbole-contrat"/g) || []).length;
  assert.equal(nb(dessinerNiveau2(p)), 0);
  p.etapes[1].contrat = { actif: true, reference: "CT-01" };
  assert.equal(nb(dessinerNiveau2(p)), 1);
  p.etapes[2].contrat = { actif: true, reference: "" }; // dernière instruction : la flèche va vers la Fin
  assert.equal(nb(dessinerNiveau2(p)), 2);
  p.etapes[1].contrat.actif = false;
  p.etapes[2].contrat.actif = false;
  assert.equal(nb(dessinerNiveau2(p)), 0, "désactivé : le dessin revient à l'état d'avant");
});

test("dessin : un contrat sans information à écrire est porté par un panier qui montre la référence (ou le mot « Contrat »)", () => {
  const p = trois();
  p.etapes[1].sortie = "";
  p.etapes[1].contrat = { actif: true, reference: "CT-DOC-07" };
  let svg = dessinerNiveau2(p);
  assert.match(svg, />CT-DOC-07</);
  p.etapes[1].contrat.reference = "";
  svg = dessinerNiveau2(p);
  assert.match(svg, />Contrat</);
  assert.equal((svg.match(/class="symbole-contrat"/g) || []).length, 1);
});

test("dessin : le panier avec contrat est plus large et assez haut pour la feuille ; le texte n'est pas recouvert", () => {
  const sans = mesurerPanier([], ["Devis validé"], false);
  const avec = mesurerPanier([], ["Devis validé"], true);
  assert.ok(avec.w > sans.w);
  assert.ok(avec.h >= 28);
  const svg = dessinerPanier(avec, 100, 50);
  assert.match(svg, /class="symbole-contrat"/);
  assert.match(svg, />Devis validé</);
  assert.equal(dessinerPanier(sans, 100, 50).includes("symbole-contrat"), false);
  assert.equal(mesurerPanier([], [], true), null, "pas de texte : pas de panier (l'appelant met la référence)");
});

test("dessin : le SVG avec contrat reste du XML bien formé et sans injection", () => {
  const p = trois();
  p.etapes[1].sortie = "";
  p.etapes[1].contrat = { actif: true, reference: '<script>alert("x")</script> & "CT"' };
  const svg = dessinerNiveau2(p);
  assert.ok(!svg.includes("<script>"));
  assert.match(svg, /&lt;script&gt;/);
});

// ---------- Textes ----------
test("textes v0.19 : les mêmes clés en français et en anglais, aucune vide", () => {
  const nouvelles = Object.keys(fr).filter((k) => /contrat|indicateur\.(formule|cible|frequence|incomplet)|genere_indicateurs/.test(k));
  assert.ok(nouvelles.length >= 15);
  nouvelles.forEach((k) => {
    assert.ok(en[k] && en[k].trim(), "clé anglaise manquante : " + k);
    assert.ok(fr[k].trim(), "clé française vide : " + k);
  });
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
});
