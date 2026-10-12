// Tests v0.17 — actions AMONT et AVAL au symbole du livre (texte écrit sur une barre, flèche d'information avec son panier,
// petit ovale gris du rôle de provenance / destination : §6.5.12-13 et §7.5.9-10, fig. 7.7) ; flèche d'information OBLIQUE DESCENDANTE
// comme dans le livre ; « compétences requises » retirées de l'instruction ; légende du dessin de l'instruction avec action amont / aval ;
// Début / Fin orientés comme dans le livre (§6.5.14-15) : une action amont / aval REMPLACE le Début / la Fin dans le dessin (fig. 7.7).
import test from "node:test";
import assert from "node:assert/strict";
import * as store from "../js/store.js";
import { nouvelleProcedure, nouvelleEtape, instructionDepuisEtape, signatureContenu } from "../js/model.js";
import { verifier } from "../js/rules.js";
import { verifierIT } from "../js/rules-it.js";
import { construireDocument } from "../js/document.js";
import { dessinerNiveau2, croisementsNiveau2 } from "../js/render.js";
import { dessinerNiveau3, taillePointsNiveau3, SEUIL_PT_IT } from "../js/render3.js";
import { exempleInstruction } from "../js/exemple-it.js";
import { definirLangue } from "../js/i18n.js";
import fr from "../js/locales/fr.js";
import en from "../js/locales/en.js";

definirLangue("fr");
const cles = (constats) => constats.map((c) => c.cle);
const GRIS_ROLE = 'fill="#DDD8E4"';

// y de la première balise <text> qui contient le texte ; y d'une ligne horizontale de barre (trait bleu de 2,2) ; y de la barre du Début / de la Fin.
function yTexte(svg, contient) {
  const m = svg.match(new RegExp(`<text x="[\\d.]+" y="([\\d.]+)"[^>]*>[^<]*${contient}[^<]*</text>`));
  assert.ok(m, "texte introuvable : " + contient);
  return Number(m[1]);
}
const barresAction = (svg) => [...svg.matchAll(/<line x1="[\d.]+" y1="([\d.]+)" x2="[\d.]+" y2="[\d.]+" stroke="#005A70" stroke-width="2.2"\/>/g)].map((m) => Number(m[1]));
const barresDebutFin = (svg) => [...svg.matchAll(/<rect x="[\d.]+" y="([\d.]+)" width="30" height="3.4" fill="#005A70"\/>/g)].map((m) => Number(m[1]));
// Cadres des instructions (procédure) ou des opérations (instruction) : x, y, largeur, hauteur, dans l'ordre du dessin.
const cadres = (svg) => [...svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" fill="#fff" stroke="#005A70" stroke-width="2.4"\/>/g)]
  .map((m) => ({ x: Number(m[1]), y: Number(m[2]), l: Number(m[3]), h: Number(m[4]) }));
// Cercles de Début / de Fin (rayon 10, trait de 2,2) : centre.
const cerclesDebutFin = (svg) => [...svg.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="10" fill="#fff" stroke="#005A70" stroke-width="2.2"\/>/g)]
  .map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
const ovalesGris = (svg) => [...svg.matchAll(/<ellipse cx="[\d.]+" cy="([\d.]+)" rx="[\d.]+" ry="[\d.]+" fill="#DDD8E4"/g)].map((m) => Number(m[1]));

function procedureAvecRaccords(information = true) {
  const p = nouvelleProcedure();
  p.roles = [{ id: "r1", nom: "Demandeur", type: "individuel", service: "", responsabilite: "" }, { id: "r2", nom: "Rédacteur", type: "individuel", service: "", responsabilite: "" }];
  p.meta = {
    ...p.meta, titre: "Traiter une demande", reference: "PR-DOC-07", version: "V1", processus: "DOC", domaine: "support", organisation: "Entreprise Exemple",
    declencheur: "Besoin exprimé par mail", fin: "Demande traitée",
    amont: { texte: "Demande reçue au guichet", role: "Client", information: information ? "Formulaire de demande" : "" },
    aval: { texte: "Suivi au comité mensuel", role: "Service qualité", information: information ? "Bilan mensuel" : "" },
  };
  p.etapes = [
    nouvelleEtape({ id: "e1", roleId: "r1", libelle: "Formuler la demande", sortie: "Demande" }),
    nouvelleEtape({ id: "e2", roleId: "r2", libelle: "Instruire la demande", sortie: "Dossier" }),
    nouvelleEtape({ id: "e3", roleId: "r2", libelle: "Clôturer la demande", sortie: "Demande clôturée" }),
  ];
  return p;
}

// ---------- Modèle, magasin, fichiers ----------
test("modèle : une action amont / aval a un texte, un rôle et l'information transmise (vide au départ)", () => {
  const p = nouvelleProcedure();
  assert.deepEqual(p.meta.amont, { texte: "", role: "", information: "" });
  assert.deepEqual(p.meta.aval, { texte: "", role: "", information: "" });
});

test("magasin : l'information transmise se saisit comme le texte et le rôle ; un autre champ est refusé", () => {
  store.nouvelle();
  store.modifierRaccord("amont", "information", "Demande signée");
  store.modifierRaccord("aval", "information", "x".repeat(500));
  store.modifierRaccord("amont", "couleur", "rouge");
  const m = store.lire().meta;
  assert.equal(m.amont.information, "Demande signée");
  assert.equal(m.aval.information.length, 200, "limité à 200 caractères");
  assert.ok(!("couleur" in m.amont));
});

test("fichiers : un ancien fichier sans information s'ouvre ; une valeur invalide est écartée", () => {
  const brut = JSON.parse(JSON.stringify(procedureAvecRaccords()));
  delete brut.meta.amont.information;
  brut.meta.aval.information = { pirate: true };
  const propre = store.nettoyer(brut);
  assert.equal(propre.meta.amont.information, "");
  assert.equal(propre.meta.aval.information, "");
  assert.equal(propre.meta.amont.texte, "Demande reçue au guichet");
});

test("validation : sans information transmise, la signature ne change pas (un document validé avant reste validé)", () => {
  const avec = procedureAvecRaccords(false);
  const ancien = JSON.parse(JSON.stringify(avec));
  delete ancien.meta.amont.information; delete ancien.meta.aval.information; // fichier de la v0.16
  assert.equal(signatureContenu(avec), signatureContenu(ancien));
  const modifie = procedureAvecRaccords(true);
  assert.notEqual(signatureContenu(modifie), signatureContenu(ancien), "renseigner l'information rend la validation caduque");
});

test("raccourci : l'instruction créée reprend, comme information transmise, la sortie de la précédente et sa propre sortie", () => {
  const p = procedureAvecRaccords();
  const it = instructionDepuisEtape(p, "e2");
  assert.equal(it.meta.amont.texte, "Formuler la demande");
  assert.equal(it.meta.amont.information, "Demande");
  assert.equal(it.meta.aval.texte, "Clôturer la demande");
  assert.equal(it.meta.aval.information, "Dossier");
});

// ---------- Règles ----------
test("règle : une action amont ou aval sans information transmise donne une alerte (procédure et instruction)", () => {
  assert.ok(cles(verifier(procedureAvecRaccords(false))).includes("regle.raccord.amont_sans_info"));
  assert.ok(cles(verifier(procedureAvecRaccords(false))).includes("regle.raccord.aval_sans_info"));
  assert.ok(!cles(verifier(procedureAvecRaccords(true))).some((c) => c.startsWith("regle.raccord.")));
  const it = exempleInstruction();
  assert.deepEqual(cles(verifierIT(it)), ["diag.ok"]);
  it.meta.amont.information = ""; it.meta.aval.information = "";
  assert.ok(cles(verifierIT(it)).includes("regle3.raccord.amont_sans_info"));
  assert.ok(cles(verifierIT(it)).includes("regle3.raccord.aval_sans_info"));
});

// ---------- Document ----------
test("document : la section 6 cite l'information transmise après le rôle", () => {
  const textes = construireDocument(procedureAvecRaccords()).sections.find((s) => s.cle === "description").blocs.filter((b) => b.type === "paragraphe").map((b) => b.texte);
  assert.ok(textes.includes("Action amont : Demande reçue au guichet (Client) — information transmise : Formulaire de demande"));
  assert.ok(textes.includes("Action aval : Suivi au comité mensuel (Service qualité) — information transmise : Bilan mensuel"));
});

// ---------- Dessin de la procédure ----------
test("dessin (procédure) : action amont = texte sur une barre, ovale de rôle gris au-dessus, flèche avec panier vers la première instruction", () => {
  const svg = dessinerNiveau2(procedureAvecRaccords());
  assert.equal(barresDebutFin(svg).length, 0, "l'action amont et l'action aval remplacent le Début et la Fin : ni barre ni cercle de Début / de Fin");
  assert.equal(cerclesDebutFin(svg).length, 0);
  const [barreAmont, barreAval] = barresAction(svg);
  const [ovaleAmont, ovaleAval] = ovalesGris(svg);
  const texteAmont = yTexte(svg, "Demande reçue au guichet");
  assert.ok(ovaleAmont < texteAmont && texteAmont < barreAmont, "de haut en bas : ovale de rôle, texte, barre");
  const [premiere, , derniere] = cadres(svg);
  const panier = yTexte(svg, "Formulaire de demande");
  assert.ok(barreAmont < panier && panier < premiere.y, "le panier d'information est sur la flèche, entre la barre et la première instruction");
  // L'action aval : barre, texte, ovale (de haut en bas) ; le panier est entre la dernière instruction et la barre.
  const texteAval = yTexte(svg, "Suivi au comité mensuel");
  assert.ok(derniere.y + derniere.h < yTexte(svg, "Bilan mensuel") && yTexte(svg, "Bilan mensuel") < barreAval, "panier de l'action aval entre la dernière instruction et sa barre");
  assert.ok(barreAval < texteAval && texteAval < ovaleAval, "de haut en bas : barre, texte, ovale de rôle");
  assert.ok(svg.includes(">Client</text>") && svg.includes(">Service qualité</text>"));
  assert.equal(croisementsNiveau2(procedureAvecRaccords()), 0);
});

test("dessin (procédure) : sans information, l'amont n'a pas de panier ; l'aval garde la sortie de la dernière instruction ; sans texte, rien n'est dessiné", () => {
  const sans = dessinerNiveau2(procedureAvecRaccords(false));
  const avec = dessinerNiveau2(procedureAvecRaccords(true));
  const paniers = (svg) => (svg.match(/stroke-width="1.3" stroke-linejoin="round"\/>/g) || []).length;
  assert.equal(paniers(avec) - paniers(sans), 1, "un panier de plus pour l'amont ; sur la dernière flèche, l'information de l'aval REMPLACE la sortie de la dernière instruction");
  assert.ok(sans.includes("Demande clôturée") && !sans.includes("Bilan mensuel"), "sans information d'aval : la sortie de la dernière instruction est sur la flèche");
  assert.ok(avec.includes("Bilan mensuel") && !avec.includes("Demande clôturée"), "avec information d'aval : elle remplace cette sortie (une flèche, un panier)");
  const rien = procedureAvecRaccords();
  rien.meta.amont = { texte: "", role: "Client", information: "Formulaire" };
  rien.meta.aval = { texte: "", role: "", information: "" };
  const svg = dessinerNiveau2(rien);
  assert.equal(barresAction(svg).length, 0);
  assert.equal(ovalesGris(svg).length, 0);
  assert.ok(!svg.includes("Formulaire"));
  assert.equal(barresDebutFin(svg).length, 2, "sans action amont ni aval : le Début et la Fin reviennent");
});

test("dessin : aucun mot perdu même avec un texte, un rôle et une information longs", () => {
  const p = procedureAvecRaccords();
  p.meta.amont = { texte: "Une demande particulièrement longue reçue au guichet de l'agence de Lyon par un client", role: "Responsable de l'agence de Lyon", information: "Formulaire de demande signé par le client et son représentant" };
  const brut = dessinerNiveau2(p).replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/\s+/g, " ");
  ["Une", "particulièrement", "Lyon", "guichet", "représentant", "signé", "client"].forEach((mot) => assert.ok(brut.includes(mot), mot));
});

// ---------- Dessin de l'instruction de travail ----------
test("dessin (instruction) : amont et aval comme dans la fig. 7.7 (à la place du Début et de la Fin) ; petits ovales gris ; flèches avec panier", () => {
  const p = exempleInstruction();
  const svg = dessinerNiveau3(p);
  assert.equal(barresDebutFin(svg).length, 0, "l'action amont et l'action aval remplacent le Début et la Fin");
  const [barreAmont, barreAval] = barresAction(svg);
  const [ovaleAmont, ovaleAval] = ovalesGris(svg);
  const [premiere, ...autres] = cadres(svg);
  const derniere = autres[autres.length - 1];
  const texteAmont = yTexte(svg, "Valider la commande");
  assert.ok(ovaleAmont < texteAmont && texteAmont < barreAmont && barreAmont < yTexte(svg, "Commande validée") && yTexte(svg, "Commande validée") < premiere.y);
  const texteAval = yTexte(svg, "Expédier la commande");
  assert.ok(derniere.y + derniere.h < yTexte(svg, "Commande enregistrée") && yTexte(svg, "Commande enregistrée") < barreAval && barreAval < texteAval && texteAval < ovaleAval);
  assert.ok(svg.includes("Direction") && svg.includes("Responsable logistique"));
  assert.ok(taillePointsNiveau3(p) >= SEUIL_PT_IT, "le texte reste lisible sur une page A4");
});

// Flèches d'information des actions amont et aval : « M x1 y1 L x2 y2 » (obliques), bleues, avec pointe.
const flechesObliques = (svg) => [...svg.matchAll(/<path d="M([\d.]+) ([\d.]+)L([\d.]+) ([\d.]+)" fill="none" stroke="#005A70" stroke-width="1.8" marker-end="url\(#flechePetite\)"\/>/g)]
  .map((m) => ({ x1: Number(m[1]), y1: Number(m[2]), x2: Number(m[3]), y2: Number(m[4]) }));

test("dessin (procédure) : les flèches des actions amont et aval sont obliques et descendantes, la pointe sur la première instruction / le départ sous la dernière", () => {
  const svg = dessinerNiveau2(procedureAvecRaccords(true));
  const f = flechesObliques(svg);
  assert.equal(f.length, 2, "une flèche oblique pour l'amont, une pour l'aval");
  f.forEach((a) => {
    assert.ok(a.y2 > a.y1 + 15, "elle descend");
    assert.ok(a.x2 > a.x1 + 4 && a.x2 - a.x1 < 60, "elle penche vers la droite, sans excès : " + JSON.stringify(a));
  });
  const [premiere, , derniere] = cadres(svg);
  const [amont, aval] = f;
  assert.ok(Math.abs(amont.y2 - (premiere.y - 0.5)) < 1 && Math.abs(amont.x2 - (premiere.x + premiere.l / 2)) < 1, "l'amont arrive au milieu du bord haut de la première instruction");
  assert.ok(aval.y1 >= derniere.y + derniere.h - 0.5 && aval.y1 < derniere.y + derniere.h + 30, "l'aval part du tronc sous la dernière instruction");
  assert.ok(Math.abs(aval.x1 - (derniere.x + derniere.l / 2)) < 1, "dans l'axe de la dernière instruction");
  const [, barreAval] = barresAction(svg);
  assert.ok(Math.abs(aval.y2 - (barreAval - 0.5)) < 1, "la pointe touche la barre de l'action aval");
  // Le panier est posé sur la flèche, près de son départ : son centre est sur la droite de la flèche (la pointe reste visible dessous).
  const xt = svg.match(/<text x="([\d.]+)" y="([\d.]+)"[^>]*>Formulaire de demande<\/text>/);
  assert.ok(xt, "panier de l'amont");
  const attendu = amont.x1 + ((amont.x2 - amont.x1) * (Number(xt[2]) - amont.y1)) / (amont.y2 - amont.y1);
  assert.ok(Math.abs(Number(xt[1]) - attendu) < 3.5, "le panier est sur la flèche : " + xt[1] + " / " + attendu);
  assert.ok(amont.y2 - Number(xt[2]) >= 14, "la pointe reste visible sous le panier");
});

test("dessin (procédure) : sans information d'amont, la flèche est oblique aussi et courte ; sans action, aucune flèche oblique", () => {
  const sans = dessinerNiveau2(procedureAvecRaccords(false));
  const f = flechesObliques(sans);
  assert.equal(f.length, 2);
  assert.ok(f[0].y2 - f[0].y1 <= 26, "amont : au plus 26 px de haut sans panier");
  const p = procedureAvecRaccords(true);
  p.meta.amont = { texte: "", role: "", information: "" };
  p.meta.aval = { texte: "", role: "", information: "" };
  assert.equal(flechesObliques(dessinerNiveau2(p)).length, 0);
});

test("dessin (procédure) : l'ovale, le texte et la barre restent dans l'ordre du livre avec la flèche oblique, sans texte coupé ni croisement", () => {
  const p = procedureAvecRaccords(true);
  p.meta.amont.texte = "Demande reçue au guichet de l'agence de Lyon avant dix heures";
  p.meta.aval.texte = "Suivi au comité mensuel de la direction générale avec les clients";
  const svg = dessinerNiveau2(p);
  assert.equal(flechesObliques(svg).length, 2);
  assert.equal(croisementsNiveau2(p), 0);
  const [premiere, , derniere] = cadres(svg);
  const [barreAmont, barreAval] = barresAction(svg);
  assert.ok(barreAmont < premiere.y && derniere.y + derniere.h < barreAval);
});

test("dessin (instruction) : les flèches amont et aval sont obliques et descendantes", () => {
  const svg = dessinerNiveau3(exempleInstruction());
  const f = flechesObliques(svg);
  assert.equal(f.length, 2);
  f.forEach((a) => assert.ok(a.y2 > a.y1 + 15 && a.x2 > a.x1 + 4));
});

test("dessin (instruction) : plus de compétences requises ni de petit carré « commentaire » ; le bloc du rôle est plus court", () => {
  const p = exempleInstruction();
  const svg = dessinerNiveau3(p);
  assert.ok(!svg.includes("Compétences requises") && !svg.includes("Permis en cours"));
  assert.ok(!svg.includes("Commentaire"));
  assert.ok(!svg.includes('width="9" height="9" fill="#1B1F27"'), "plus de carré sur l'ovale du rôle");
  p.it.role.competences = "Permis C (ancien fichier)"; // une valeur résiduelle ne s'affiche jamais
  assert.ok(!dessinerNiveau3(p).includes("Permis C"));
});

test("dessin (instruction) : la légende contient « Action amont » et « Action aval » et tient dans la largeur de la page", () => {
  const svg = dessinerNiveau3(exempleInstruction());
  assert.ok(svg.includes(">Action amont</text>") && svg.includes(">Action aval</text>"));
  const petits = [...svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)" text-anchor="middle" font-size="8"[^>]*>([^<]+)<\/text>/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]), t: m[3] }));
  const yLegende = petits.find((m) => m.t === "Rôle").y; // les autres textes de 8 pt (numéros des contrôles) ne sont pas dans la légende
  const xs = petits.filter((m) => m.y === yLegende).map((m) => m.x);
  assert.equal(xs.length, 11, "onze symboles dans la légende");
  assert.ok(Math.max(...xs) < 700, "dernier libellé de la légende dans le cadre");
  // Les libellés ne se chevauchent pas : écart d'au moins 40 px entre deux centres voisins.
  const tries = [...xs].sort((a, b) => a - b);
  for (let k = 1; k < tries.length; k += 1) assert.ok(tries[k] - tries[k - 1] >= 36, "libellés trop serrés : " + tries[k - 1] + " / " + tries[k]);
  definirLangue("en");
  const en3 = dessinerNiveau3(exempleInstruction());
  definirLangue("fr");
  assert.ok(en3.includes(">Upstream</text>") && en3.includes(">Downstream</text>"));
});

test("compétences retirées : ni champ, ni clé de texte ; la signature d'un fichier d'instruction validé en v0.16 est inchangée", () => {
  Object.keys(fr).concat(Object.keys(en)).forEach((k) => assert.ok(!/competences/.test(k), "clé restante : " + k));
  const p = exempleInstruction();
  const avec = signatureContenu({ ...p, it: { ...p.it, role: { nom: p.it.role.nom, competences: "" } } }); // forme v0.16, compétences vides
  assert.equal(signatureContenu(p), avec, "même signature qu'avant le retrait du champ");
  // import d'un fichier v0.16 avec compétences : elles sont abandonnées
  store.chargerExempleInstruction();
  const brut = JSON.parse(store.exporterJSON());
  brut.procedure.it.role.competences = "Permis C";
  store.importerJSON(JSON.stringify(brut));
  assert.deepEqual(store.lire().it.role, { nom: "Chargé de clientèle" });
});

// ---------- Textes FR / EN ----------
test("textes : les clés ajoutées en v0.17 existent en français et en anglais", () => {
  const attendues = [
    "form.amont.aide", "form.aval.aide", "form.amont.aide_it", "form.aval.aide_it", "form.amont.information", "form.aval.information",
    "form.raccord.information.ph", "doc.raccord.information", "dessin3.leg.amont", "dessin3.leg.aval",
    "regle.raccord.amont_sans_info", "regle.raccord.aval_sans_info", "regle3.raccord.amont_sans_info", "regle3.raccord.aval_sans_info",
  ];
  attendues.forEach((k) => { assert.ok(fr[k], "fr " + k); assert.ok(en[k], "en " + k); });
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort(), "mêmes clés en français et en anglais");
});

// ---------- Début / Fin selon le livre (§6.5.14-15 pour la procédure, §7.5 pour l'instruction) ----------
test("dessin (instruction) : sans action amont ni aval, le Début (cercle posé sur la barre) et la Fin (flèche → barre → cercle) sont comme dans le livre", () => {
  const p = exempleInstruction();
  p.meta.amont = { texte: "", role: "", information: "" };
  p.meta.aval = { texte: "", role: "", information: "" };
  const svg = dessinerNiveau3(p);
  const [barreDebut, barreFin] = barresDebutFin(svg);
  const [cercleDebut, cercleFin] = cerclesDebutFin(svg);
  assert.equal(barreDebut, cercleDebut.y + 10, "le cercle du Début est posé sur sa barre");
  assert.equal(Math.round((barreFin + 3.4) * 10) / 10, cercleFin.y - 10, "le cercle de la Fin est sous sa barre");
  const [premiere, ...autres] = cadres(svg);
  const derniere = autres[autres.length - 1];
  assert.ok(barreDebut < premiere.y && derniere.y + derniere.h < barreFin, "Début au-dessus de la première opération, Fin sous la dernière");
  assert.equal(flechesObliques(svg).length, 0, "sans action amont ni aval : flèches verticales seulement");
  assert.equal(ovalesGris(svg).length, 0);
});

test("dessin (instruction) : seule l'action amont remplace le Début ; la Fin reste (et inversement)", () => {
  const p = exempleInstruction();
  p.meta.aval = { texte: "", role: "", information: "" };
  const a = dessinerNiveau3(p);
  assert.equal(cerclesDebutFin(a).length, 1, "la Fin reste");
  assert.equal(flechesObliques(a).length, 1);
  const q = exempleInstruction();
  q.meta.amont = { texte: "", role: "", information: "" };
  const b = dessinerNiveau3(q);
  assert.equal(cerclesDebutFin(b).length, 1, "le Début reste");
  assert.equal(flechesObliques(b).length, 1);
  assert.ok(taillePointsNiveau3(p) >= SEUIL_PT_IT && taillePointsNiveau3(q) >= SEUIL_PT_IT);
});

test("dessin : l'action amont donne l'information sur la flèche de la première instruction ; à défaut, l'entrée de la première opération (instruction)", () => {
  const p = exempleInstruction();
  p.it.operations[0].entree = "Livraison arrivée";
  p.meta.amont.information = "";
  const svg = dessinerNiveau3(p);
  assert.ok(svg.includes("Livraison arrivée"), "sans information d'amont : l'entrée de la première opération est sur la flèche");
  p.meta.amont.information = "Commande confirmée";
  const avec = dessinerNiveau3(p);
  assert.ok(avec.includes("Commande confirmée") && !avec.includes("Livraison arrivée"), "avec information d'amont : elle remplace l'entrée (une flèche, un panier)");
});

// ---------- Word de l'instruction de travail : une page A4 portrait, dessin en image, instruction embarquée ----------
import { construireDocxIT, construireDocx as construireDocxProcedure } from "../js/exportDocx.js";
import { lireZip, importerWord } from "../js/importWord.js";
import { disposerNiveau3 } from "../js/render3.js";

const PNG_BIDON = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

function docxIT(extra = {}) {
  const p = exempleInstruction();
  const zip = construireDocxIT(p, { png: PNG_BIDON, largeurPng: 1428, hauteurPng: 1930, disposition: disposerNiveau3(p), ...extra });
  return { p, zip };
}

test("Word (instruction) : une seule page A4 portrait, le dessin en image centrée, ni pied de page ni tableau", async () => {
  const { p, zip } = docxIT();
  const xml = await lireZip(zip);
  assert.equal((xml.match(/<w:drawing>/g) || []).length, 1, "une image : le dessin");
  assert.equal((xml.match(/<w:p>/g) || []).length, 1, "un seul paragraphe : celui de l'image");
  assert.ok(!xml.includes("<w:tbl>") && !xml.includes("footerReference") && !xml.includes("w:orient"));
  assert.ok(xml.includes('w:w="11906" w:h="16838"'), "A4 portrait");
  // L'image tient dans la zone utile de la page (marges 560 / 500 twips, soit 719 x 1055 px à 96 dpi).
  const ext = xml.match(/<wp:extent cx="(\d+)" cy="(\d+)"\/>/);
  const d = disposerNiveau3(p);
  assert.equal(Number(ext[1]), Math.round(d.largeur * 9525));
  assert.ok(Number(ext[1]) / 9525 <= 719 && Number(ext[2]) / 9525 <= 1055, "l'image tient sur la page");
  assert.ok(xml.includes("Instruction de travail — Enregistrer une commande"), "texte alternatif de l'image");
  const types = await lireZip(zip, "[Content_Types].xml");
  assert.ok(!types.includes("footer1.xml"), "aucun pied de page déclaré");
  assert.ok(types.includes("customXmlProperties"), "instruction embarquée");
  assert.equal((await lireZip(zip, "word/_rels/document.xml.rels")).includes("footer"), false);
  assert.ok((await lireZip(zip, "docProps/core.xml")).includes("<dc:title>Enregistrer une commande</dc:title>"));
});

test("Word (instruction) : rouvert par « Importer un Word », l'instruction complète revient sans perte, même si le texte a été modifié dans Word", async () => {
  const { p, zip } = docxIT();
  const { procedure, rapport } = await importerWord(zip);
  assert.equal(procedure.meta.typeDocument, "instruction");
  assert.equal(procedure.it.operations.length, p.it.operations.length);
  assert.equal(procedure.it.role.nom, "Chargé de clientèle");
  assert.equal(procedure.meta.amont.information, "Commande validée");
  assert.deepEqual(rapport.map((c) => c.cle), ["import.embarque_it"]);
  assert.equal(rapport[0].params.operations, 7);
  // Un texte modifié dans Word ne change rien : le dessin est une image, il n'y a rien à relire dans des tableaux (pour une procédure,
  // la signature du texte visible détecterait la modification et l'import relirait les tableaux). On change ici, sans image, un caractère
  // du texte visible (même longueur : le ZIP est écrit sans compression).
  const sansImage = Buffer.from(construireDocxIT(p, { png: null })).toString("latin1");
  assert.ok(sansImage.includes("page A4 enti"), "le zip est lisible en clair");
  const modifie = await importerWord(new Uint8Array(Buffer.from(sansImage.replace("page A4 enti", "page A5 enti"), "latin1")));
  assert.equal(modifie.rapport[0].cle, "import.embarque_it", "texte modifié : l'instruction embarquée est reprise quand même");
  assert.equal(modifie.procedure.it.operations.length, 7);
  // Remise dans le magasin : l'import produit un document propre (nettoyé) qui garde l'instruction.
  store.importerProcedure(procedure);
  assert.equal(store.lire().meta.typeDocument, "instruction");
  assert.equal(store.lire().it.operations.length, 7);
});

test("Word (procédure) : un Word de procédure garde son import habituel (signature du texte visible)", async () => {
  const p = procedureAvecRaccords();
  store.importerProcedure(p);
  const zip = construireDocxProcedure(store.lire());
  const { rapport } = await importerWord(zip);
  assert.equal(rapport[0].cle, "import.embarque");
});

test("Word (instruction) : sans image (navigateur absent) le fichier reste valide, avec une phrase à la place", async () => {
  const p = exempleInstruction();
  const zip = construireDocxIT(p, { png: null });
  const xml = await lireZip(zip);
  assert.ok(!xml.includes("<w:drawing>") && xml.includes("L'instruction de travail est dessinée ici"));
  assert.ok(!(await lireZip(zip, "[Content_Types].xml")).includes("footer1.xml"));
});

test("textes : les clés du Word de l'instruction existent en français et en anglais ; l'ancienne annonce « bientôt » a disparu", () => {
  ["doc.instruction_ici", "import.embarque_it", "gen.it.word.titre", "gen.it.word.aide"].forEach((k) => {
    assert.ok(fr[k] && en[k], k);
  });
  assert.ok(!("gen.it.bientot" in fr) && !("gen.it.bientot" in en));
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
});
