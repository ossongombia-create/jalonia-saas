// Tests v0.10 : lisibilité du logigramme (mise en page adaptative, textes jamais coupés, conseils).
import test from "node:test";
import assert from "node:assert/strict";
import { nouvelleProcedure, nouvelleEtape, nouvelleAlternative } from "../js/model.js";
import { dessinerNiveau2, mesurerNiveau2, croisementsNiveau2, taillePointsSurA4, parametresMiseEnPage, conseilsLisibilite, SEUIL_PT, disposerNiveau2, echelleReglageParDefaut } from "../js/render.js";
import { constatsLisibilite } from "../js/conseils.js";
import { t, definirLangue } from "../js/i18n.js";
import { exempleProcedure } from "../js/exemple-procedure.js";
import fr from "../js/locales/fr.js";
import en from "../js/locales/en.js";

const decoder = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
// Tous les textes du SVG : { x, ancre, taille, texte }.
function textesDuSvg(svg) {
  return [...svg.matchAll(/<text x="([\d.-]+)" y="[\d.-]+" text-anchor="(\w+)" font-size="([\d.]+)"[^>]*>([^<]*)<\/text>/g)]
    .map((m) => ({ x: Number(m[1]), ancre: m[2], taille: Number(m[3]), texte: decoder(m[4]) }));
}
const largeurSvg = (svg) => Number(svg.match(/<svg[^>]* width="(\d+)"/)[1]);

function petiteProcedure(n = 5) {
  const p = nouvelleProcedure();
  p.roles = [
    { id: "r1", nom: "Pilote", type: "individuel", service: "", responsabilite: "" },
    { id: "r2", nom: "Contrôleur", type: "individuel", service: "", responsabilite: "" },
  ];
  p.meta.declencheur = "Besoin exprimé";
  p.meta.fin = "Dossier clos";
  p.etapes = Array.from({ length: n }, (_, k) => nouvelleEtape({
    roleId: k % 2 ? "r2" : "r1", libelle: `Traiter le point ${k + 1}`, entree: `Entrée ${k + 1}`, sortie: `Sortie ${k + 1}`,
  }));
  return p;
}

// Texte trop petit ? (valeur réelle, sans l'arrondi de taillePointsSurA4)
const ptReel = (p) => disposerNiveau2(p).echelle * 7.5;
const LONG = "Un compte rendu détaillé avec la liste complète des décisions, des actions, des responsables et des dates de réalisation, "
  + "les pièces justificatives, les avis des services concernés et les observations formulées lors de la revue de direction.";
// Procédure « dense » : l'exemple auquel on ajoute des instructions (informations très longues) jusqu'à ce que le texte soit trop petit sur A4.
function procedureDense() {
  const p = exempleProcedure();
  const role = p.roles[0].id;
  p.etapes[0].sortie = LONG;
  for (let k = 0; ptReel(p) >= SEUIL_PT - 0.4 && k < 30; k += 1) {
    p.etapes.push(nouvelleEtape({ roleId: role, libelle: `Compléter le dossier ${k + 1}`, entree: "Dossier", sortie: LONG }));
  }
  return p;
}

test("lisibilité : l'exemple (bandeau, couloirs et carrefours compris) reste à au moins 5,5 pt, sans croisement", () => {
  const p = exempleProcedure();
  assert.ok(taillePointsSurA4(p) >= SEUIL_PT, `pt = ${taillePointsSurA4(p)}`);
  assert.equal(croisementsNiveau2(p), 0);
  assert.equal(conseilsLisibilite(p), null, "aucun conseil : le texte est assez grand");
});

test("lisibilité : aucun texte n'est coupé ni abrégé (chaque mot est dans le dessin)", () => {
  const p = exempleProcedure();
  const dessin = textesDuSvg(dessinerNiveau2(p)).map((x) => x.texte).join(" ");
  // Une action aval remplace le symbole Fin dans le dessin : on vérifie donc le texte de l'aval, pas meta.fin.
  const sources = [p.meta.declencheur, p.meta.aval.texte, p.meta.aval.information];
  p.etapes.forEach((e) => {
    sources.push(e.libelle, e.sortie, e.condition);
    e.alternatives.forEach((a) => sources.push(a.condition, a.info));
  });
  sources.filter(Boolean).forEach((texte) => {
    texte.split(/\s+/).forEach((mot) => assert.ok(dessin.includes(mot), `mot manquant : « ${mot} »`));
  });
});

test("lisibilité : tous les textes tiennent dans la largeur du dessin (aussi dans la colonne de droite)", () => {
  const cas = [exempleProcedure()];
  const p = petiteProcedure(6);
  p.roles.push({ id: "r3", nom: "Direction", type: "individuel", service: "", responsabilite: "" }, { id: "r4", nom: "Client", type: "externe", service: "", responsabilite: "" });
  p.etapes.forEach((e, k) => { e.roleId = ["r1", "r2", "r3", "r4"][k % 4]; e.sortie = "Une information très longue destinée au rôle suivant, avec beaucoup de précisions utiles ".repeat(2); });
  p.meta.fin = "Une fin très longue avec beaucoup de détails sur l'archivage et la traçabilité des documents".repeat(2);
  cas.push(p);
  cas.forEach((proc) => {
    const svg = dessinerNiveau2(proc);
    const largeur = largeurSvg(svg);
    textesDuSvg(svg).forEach(({ x, ancre, taille, texte }) => {
      const l = texte.length * 5.4 * (taille / 10) * 0.97; // largeur estimée (un peu moins que le pire cas)
      const [debut, fin] = ancre === "start" ? [x, x + l] : ancre === "end" ? [x - l, x] : [x - l / 2, x + l / 2];
      assert.ok(debut >= 0 && fin <= largeur + 1, `« ${texte} » dépasse (${Math.round(debut)}–${Math.round(fin)} pour ${largeur})`);
    });
  });
});

test("lisibilité : à la sortie d'une décision, le panier des alternatives est à gauche du tronc et celui de la suite normale à droite", () => {
  const svg = dessinerNiveau2(exempleProcedure());
  const textes = textesDuSvg(svg);
  // L'exemple restaurant a une décision au service : « Conforme » (suite normale, à droite) / « Non conforme » (renvoi, à gauche).
  const nonConforme = textes.find((s) => s.texte === "Non conforme");
  const conforme = textes.find((s) => s.texte === "Conforme");
  assert.ok(nonConforme && conforme, "textes trouvés");
  assert.ok(nonConforme.x < conforme.x, "« Non conforme » à gauche du tronc, « Conforme » à droite");
});

test("lisibilité : le numéro d'une instruction est à gauche de sa forme et aucun trait ne le traverse", () => {
  const svg = dessinerNiveau2(exempleProcedure());
  const numeros = [...svg.matchAll(/<text x="([\d.-]+)" y="([\d.-]+)" text-anchor="end" font-size="10" fill="#555B66">(\d+)<\/text>/g)]
    .map((m) => ({ x: Number(m[1]), y: Number(m[2]), n: Number(m[3]) }));
  assert.equal(numeros.length, 8, "un numéro par instruction");
  // Les flèches de renvoi arrivent au milieu du bord gauche : elles passent au moins 8 px sous la base du numéro.
  const arrivees = [...svg.matchAll(/<path d="M[\d.]+ ([\d.]+)H([\d.]+)"[^>]*marker-end/g)].map((m) => ({ y: Number(m[1]), x: Number(m[2]) }));
  assert.ok(arrivees.length >= 1);
  arrivees.forEach((a) => numeros.forEach((n) => { if (Math.abs(a.x - (n.x + 4)) < 1) assert.ok(Math.abs(a.y - n.y) >= 8, `flèche à ${a.y} sur le numéro ${n.n} (${n.y})`); }));
});

test("lisibilité : le choix est stable (même résultat deux fois) et ne bouge pas quand on écrit ailleurs", () => {
  const p = exempleProcedure();
  const a = dessinerNiveau2(p);
  assert.equal(dessinerNiveau2(p), a);
  p.corps.objet = { texte: "Autre texte sans rapport avec le dessin" };
  p.etapes[0].risques = [];
  assert.equal(dessinerNiveau2(p), a);
  p.etapes[0].libelle += " et vérifier";
  assert.notEqual(dessinerNiveau2(p), a);
});

test("lisibilité : une petite procédure est très lisible (au moins 9 pt) et n'appelle aucun conseil", () => {
  const p = petiteProcedure(4);
  const r = parametresMiseEnPage(p);
  assert.ok(r.largeurInfo > 0 && r.largeurLabel > 0 && r.largeurCol > 0);
  assert.ok(taillePointsSurA4(p) >= 9, `pt = ${taillePointsSurA4(p)}`);
  assert.equal(conseilsLisibilite(p), null);
});

test("lisibilité : le choix ne rend jamais le texte plus petit que le réglage par défaut", () => {
  [exempleProcedure(), procedureDense(), petiteProcedure(6)].forEach((p) => {
    assert.ok(disposerNiveau2(p).echelle >= echelleReglageParDefaut(p) - 1e-9, "le réglage choisi est au moins aussi bon que le réglage par défaut");
  });
});

test("conseils : procédure dense — les textes longs sont repérés, classés par gain, sans modifier la procédure", () => {
  const p = procedureDense();
  const avant = JSON.stringify(p);
  const c = conseilsLisibilite(p);
  assert.equal(JSON.stringify(p), avant);
  assert.ok(c && c.pt < SEUIL_PT);
  assert.ok(c.conseils.length >= 1 && c.conseils.length <= 4);
  assert.ok(c.conseils.some((x) => x.champ === "sortie"));
  c.conseils.forEach((x) => { assert.ok(x.gain > 0); assert.ok(x.longueur > x.cible); });
  for (let i = 1; i < c.conseils.length; i += 1) assert.ok(c.conseils[i - 1].gain >= c.conseils[i].gain);
  assert.ok(c.ptApres >= c.pt);
  assert.equal(typeof c.atteint, "boolean");
});

test("conseils : un texte trop long pour la page est proposé au raccourcissement, et le gain est réel", () => {
  const p = petiteProcedure(9);
  p.roles.push({ id: "r3", nom: "Direction", type: "individuel", service: "", responsabilite: "" });
  p.etapes.forEach((e, k) => { e.roleId = ["r1", "r2", "r3"][k % 3]; });
  p.etapes[3].sortie = "Un compte rendu détaillé de la réunion avec la liste complète des décisions, des actions, des responsables et des dates";
  p.meta.declencheur = "Une demande formulée par écrit ou oralement par un client interne ou externe, avec toutes les précisions nécessaires au traitement";
  for (let k = 0; ptReel(p) >= SEUIL_PT - 0.4 && k < 30; k += 1) p.etapes.push(nouvelleEtape({ roleId: "r1", libelle: `Compléter ${k}`, sortie: LONG }));
  const c = conseilsLisibilite(p);
  assert.ok(c, "le logigramme est trop petit dans ce cas de test");
  const raccourci = structuredClone(p);
  c.conseils.forEach((x) => {
    if (x.champ === "declencheur") raccourci.meta.declencheur = raccourci.meta.declencheur.slice(0, 40);
    if (x.champ === "sortie") raccourci.etapes[x.n - 1].sortie = raccourci.etapes[x.n - 1].sortie.slice(0, 40);
  });
  assert.ok(taillePointsSurA4(raccourci) >= taillePointsSurA4(p), "raccourcir ne doit jamais rendre le texte plus petit");
});

test("conseils : les messages existent en français et en anglais et se remplissent", () => {
  ["declencheur", "fin", "libelle", "sortie", "condition", "alt_condition", "alt_info"].forEach((champ) => {
    assert.ok(fr["conseil.champ." + champ], `fr ${champ}`);
    assert.ok(en["conseil.champ." + champ], `en ${champ}`);
  });
  ["ligne", "bilan_ok", "bilan_non", "aucun"].forEach((k) => {
    assert.ok(fr["conseil.lisibilite." + k] && en["conseil.lisibilite." + k], k);
  });
  const p = procedureDense();
  ["fr", "en"].forEach((langue) => {
    definirLangue(langue);
    const constats = constatsLisibilite(p);
    assert.ok(constats.length >= 2);
    constats.forEach((c) => assert.ok(!/[{}]/.test(t(c.cle, c.params)), `${langue} : ${t(c.cle, c.params)}`));
  });
  definirLangue("fr");
  assert.deepEqual(constatsLisibilite(petiteProcedure(4)), []);
});

test("dessin : des renvois emboîtés ne se croisent pas, quelle que soit la mise en page choisie", () => {
  const p = petiteProcedure(8);
  const relier = (de, vers, condition, info) => {
    p.etapes[de].condition = p.etapes[de].condition || "Oui";
    p.etapes[de].alternatives.push(nouvelleAlternative({ condition, vers: vers === "fin" ? "fin" : p.etapes[vers].id, info }));
  };
  relier(6, 1, "Non", "Reprise nécessaire"); // grand retour en arrière
  relier(4, 2, "Écart", "Écart à traiter"); // petit retour, emboîté dans le grand
  relier(7, "fin", "Refus", "Dossier refusé"); // sortie vers la fin, plus bas
  assert.equal(croisementsNiveau2(p), 0);
  const c = croisementsNiveau2(exempleProcedure());
  assert.equal(c, 0);
});
