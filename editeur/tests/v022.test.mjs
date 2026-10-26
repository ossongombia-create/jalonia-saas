// Tests v0.22 — « mentions et protections » et accueil « Mon espace » : le nom de l'outil en un seul endroit, le suivi « enregistré / non enregistré »
// (base de l'alerte avant de quitter), la logique de l'accueil (document en cours, compteurs, cartographie par blocs, date de modification),
// la fenêtre « Mentions et licences », les licences de tiers, la parité FR / EN, et l'absence de toute entreprise réelle.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as store from "../js/store.js";
import { definirLangue, t } from "../js/i18n.js";
import fr from "../js/locales/fr.js";
import en from "../js/locales/en.js";
import { CONFIG, NOM_OUTIL } from "../js/config.js";
import { VERSION } from "../js/version.js";
import { estDocumentVide, empreinteDocument, nouvelleProcedure, signatureContenu } from "../js/model.js";
import { exempleProcedure } from "../js/exemple-procedure.js";
import { exempleInstruction } from "../js/exemple-it.js";
import { exempleCartographie } from "../js/exemple-carto.js";
import { nettoyerCartographie, nouvelleCartographie } from "../js/cartographie.js";
import { ETAPES, etatsEtapes } from "../js/parcours.js";
import { compterConstats, cleCompteur, nomOrganisation, resumeDocument, blocsCartographie, libelleModification } from "../js/accueil.js";
import { titulaireAffiche } from "../js/mentions.js";
import * as vue from "../js/vue.js";
import { construireDocx } from "../js/exportDocx.js";

const source = (chemin) => fs.readFileSync(new URL("../" + chemin, import.meta.url), "utf8");
import { PROPRE } from "./neutralite.mjs";
definirLangue("fr");

// ---------- Le nom de l'outil, en un seul endroit ----------
test("le nom de l'outil vient de config.js et rien d'autre ne l'écrit en dur (code, page, textes)", () => {
  assert.equal(typeof NOM_OUTIL, "string");
  assert.ok(NOM_OUTIL.trim().length > 0 && NOM_OUTIL.length <= 60, "un nom non vide et court");
  assert.equal(NOM_OUTIL, CONFIG.nomOutil);
  // Les textes le reprennent par {nom}
  ["fr", "en"].forEach((langue) => {
    definirLangue(langue);
    assert.equal(t("app.titre"), NOM_OUTIL);
    assert.equal(t("app.marque"), NOM_OUTIL);
    assert.ok(t("retour.email_sujet", { version: VERSION }).includes(NOM_OUTIL));
    assert.ok(t("mentions.licence.texte").includes(NOM_OUTIL));
    assert.ok(t("accueil.titre_sans_organisation").includes(NOM_OUTIL));
  });
  definirLangue("fr");
  // Aucun autre fichier du code ne contient le nom (un renommage se fait dans config.js seulement, plus les deux guides)
  const fichiers = fs.readdirSync(new URL("../js/", import.meta.url)).filter((f) => f.endsWith(".js") && f !== "config.js").map((f) => "js/" + f)
    .concat(["js/locales/fr.js", "js/locales/en.js", "index.html", "css/style.css"]);
  fichiers.forEach((f) => {
    const sansCommentaires = source(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/<!--[\s\S]*?-->/g, "").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
    assert.ok(!sansCommentaires.includes(NOM_OUTIL), `${f} écrit le nom de l'outil en dur : utilise {nom} ou NOM_OUTIL`);
  });
});

test("les deux guides portent le nom de l'outil (à mettre à jour en cas de renommage) et ne sont pas indexés", () => {
  ["guide-fr.html", "guide-en.html"].forEach((f) => {
    const html = source(f);
    assert.ok(html.includes(NOM_OUTIL), `${f} doit citer « ${NOM_OUTIL} » (voir le CHANGELOG : Renommer l'outil)`);
    assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  });
  const index = source("index.html");
  assert.match(index, /<meta name="robots" content="noindex, nofollow">/, "la page ne doit pas être indexée par les moteurs de recherche");
});

test("le fichier Word généré porte le nom de l'outil dans ses propriétés", () => {
  const p = exempleProcedure();
  const octets = construireDocx(p, { embarquer: false });
  const texte = Buffer.from(octets).toString("latin1");
  assert.ok(texte.includes(`<dc:creator>${NOM_OUTIL}</dc:creator>`), "docProps/core.xml : créateur = nom de l'outil (réglé dans config.js)");
});

// ---------- Document vide, empreinte ----------
test("un document est « vide » tant que rien n'est saisi ; choisir un type ne suffit pas", () => {
  const p = nouvelleProcedure();
  assert.equal(estDocumentVide(p), true);
  p.meta.typeDocument = "instruction";
  p.meta.niveau = 3;
  assert.equal(estDocumentVide(p), true);
  p.meta.titre = "x";
  assert.equal(estDocumentVide(p), false);
  assert.equal(estDocumentVide(exempleProcedure()), false);
  assert.equal(estDocumentVide(exempleInstruction()), false);
  assert.equal(estDocumentVide(null), true);
  // deux documents vierges créés à des moments différents ont des identifiants différents, mais sont tous deux vides
  assert.equal(estDocumentVide(nouvelleProcedure()) && estDocumentVide(nouvelleProcedure()), true);
});

test("l'empreinte du document change à toute modification, pas à l'ordre des champs ; la signature de validation, elle, ne change pas", () => {
  const p = exempleProcedure();
  const e0 = empreinteDocument(p);
  assert.equal(empreinteDocument(JSON.parse(JSON.stringify(p))), e0);
  const inverse = { corps: p.corps, validation: p.validation, it: p.it, etapes: p.etapes, roles: p.roles, meta: p.meta }; // autre ordre
  assert.equal(empreinteDocument(inverse), e0);
  const q = JSON.parse(JSON.stringify(p));
  q.meta.titre += " ";
  assert.notEqual(empreinteDocument(q), e0);
  // la signature de validation reste calculée comme avant : elle ne dépend pas des ajouts de la v0.22
  assert.equal(signatureContenu(p), signatureContenu(JSON.parse(JSON.stringify(p))));
  assert.match(signatureContenu(p), /^[0-9a-f]{16}-\d+$/);
});

// ---------- Suivi « enregistré / non enregistré » (base de l'alerte avant de quitter) ----------
test("magasin : un document vide n'est jamais « non enregistré » ; dès qu'on écrit, il l'est ; enregistrer (fichier .json) l'efface", () => {
  store.nouvelle();
  assert.equal(store.nonEnregistre(), false);
  store.modifierMeta("titre", "Ma procédure");
  assert.equal(store.nonEnregistre(), true);
  let appels = 0;
  store.abonnerEnregistrement(() => { appels += 1; });
  store.marquerEnregistre();
  assert.equal(store.nonEnregistre(), false);
  assert.equal(appels, 1, "l'écran est prévenu quand le document est enregistré");
  store.modifierMeta("titre", "Ma procédure (suite)");
  assert.equal(store.nonEnregistre(), true);
  store.annuler(); // retour au contenu enregistré : plus rien à protéger
  assert.equal(store.nonEnregistre(), false);
  store.retablir();
  assert.equal(store.nonEnregistre(), true);
});

test("magasin : un exemple, un fichier .json ouvert ou un Word importé sont considérés comme enregistrés ; le modifier ne l'est plus", () => {
  store.chargerExemple();
  assert.equal(store.nonEnregistre(), false, "l'exemple se recharge à volonté");
  store.modifierMeta("pilote", "Quelqu'un");
  assert.equal(store.nonEnregistre(), true);
  store.chargerExempleInstruction();
  assert.equal(store.nonEnregistre(), false);
  // un fichier .json qu'on vient d'exporter puis rouvre
  store.modifierMeta("titre", "Titre modifié");
  const fichier = store.exporterJSON();
  assert.equal(store.nonEnregistre(), true);
  store.nouvelle();
  store.importerJSON(fichier);
  assert.equal(store.nonEnregistre(), false, "le fichier qu'on ouvre est, par définition, enregistré");
  store.modifierMeta("titre", "Encore modifié");
  assert.equal(store.nonEnregistre(), true);
  // un Word importé
  store.importerProcedure(exempleProcedure());
  assert.equal(store.nonEnregistre(), false);
});

test("magasin : « Nouvelle procédure / instruction » démarre avec le type choisi ; un type inconnu est ignoré", () => {
  store.nouvelle("instruction");
  assert.equal(store.lire().meta.typeDocument, "instruction");
  assert.equal(store.lire().meta.niveau, 3);
  assert.equal(store.nonEnregistre(), false, "le type seul ne fait pas un document à protéger");
  store.nouvelle("procedure");
  assert.equal(store.lire().meta.typeDocument, "procedure");
  assert.equal(store.lire().meta.niveau, 2);
  store.nouvelle("n'importe quoi");
  assert.equal(store.lire().meta.typeDocument, "");
  store.nouvelle();
  assert.equal(store.lire().meta.typeDocument, "");
});

test("magasin : la date de la dernière modification suit les changements", async () => {
  store.nouvelle();
  const avant = store.derniereModification();
  await new Promise((r) => setTimeout(r, 5));
  store.modifierMeta("titre", "A");
  assert.ok(store.derniereModification() > avant);
  assert.ok(store.derniereModification() <= Date.now());
});

test("protection : main.js demande confirmation avant de quitter quand le document n'est pas enregistré, et sorties.js le marque enregistré", () => {
  const main = source("js/main.js");
  assert.match(main, /addEventListener\("beforeunload"/);
  assert.match(main, /store\.nonEnregistre\(\)/);
  assert.match(main, /evenement\.preventDefault\(\)/);
  assert.match(source("js/sorties.js"), /store\.marquerEnregistre\(\)/);
  assert.match(source("index.html"), /id="etat-fichier"/);
});

// ---------- Accueil : la logique ----------
test("accueil : pas de document en cours → rien à reprendre ; avec un document → titre, avancement, compteurs", () => {
  assert.equal(resumeDocument(nouvelleProcedure(), [], 1), null);
  const p = exempleProcedure();
  const r = resumeDocument(p, [{ gravite: "alerte" }, { gravite: "ok" }], 3);
  assert.equal(r.type, "procedure");
  assert.equal(r.instruction, false);
  assert.equal(r.titre, p.meta.titre);
  assert.ok(r.details.includes(p.meta.reference));
  assert.deepEqual(r.compteurs.map((c) => [c.base, c.n, c.ton]), [["instruction", p.etapes.length, "neutre"], ["role", p.roles.length, "neutre"], ["erreur", 0, "ok"], ["alerte", 1, "alerte"]]);
  assert.equal(r.reprise, 3);
  assert.equal(r.cleReprise, "accueil.reprendre.synthese");
  assert.deepEqual(r.etapes.map((e) => e.etat), ["fait", "fait", "courant", "verrouille"]);
});

test("accueil : une instruction de travail compte ses opérations et ses contrôles ; une étape trop avancée est ramenée à la dernière ouverte", () => {
  const it = exempleInstruction();
  const r = resumeDocument(it, [], 4);
  assert.equal(r.instruction, true);
  assert.deepEqual(r.compteurs.slice(0, 2).map((c) => c.base), ["operation", "controle"]);
  assert.equal(r.compteurs[0].n, it.it.operations.length);
  assert.equal(r.compteurs[1].n, it.it.operations.reduce((s, o) => s + o.controles.length, 0));
  assert.ok(r.reprise >= 1 && r.reprise <= 4);
  // un document à peine commencé : l'étape 4 demandée n'est pas ouverte
  const debut = nouvelleProcedure();
  debut.meta.titre = "Début";
  assert.equal(resumeDocument(debut, [], 4).reprise, 1);
  assert.equal(resumeDocument(debut, [], 1).cleReprise, "accueil.reprendre.identification");
});

test("accueil : les états des étapes sont ceux de la colonne marine (fait, courant, à faire, verrouillée)", () => {
  const etats = etatsEtapes(exempleProcedure(), 2);
  assert.deepEqual(etats.map((e) => e.etat), ["fait", "courant", "afaire", "verrouille"]);
  assert.deepEqual(etats.map((e) => e.cle), ETAPES);
  assert.equal(etats[2].ouverte, true);
  assert.equal(etats[3].ouverte, false);
});

test("accueil : compteurs au singulier ou au pluriel selon la langue (0 est singulier en français, pas en anglais)", () => {
  assert.equal(cleCompteur("erreur", 0, "fr"), "accueil.compteur.erreur.un");
  assert.equal(cleCompteur("erreur", 1, "fr"), "accueil.compteur.erreur.un");
  assert.equal(cleCompteur("erreur", 2, "fr"), "accueil.compteur.erreur.autres");
  assert.equal(cleCompteur("erreur", 0, "en"), "accueil.compteur.erreur.autres");
  assert.equal(cleCompteur("erreur", 1, "en"), "accueil.compteur.erreur.un");
  assert.deepEqual(compterConstats([{ gravite: "erreur" }, { gravite: "alerte" }, { gravite: "alerte" }, { gravite: "ok" }]), { erreurs: 1, alertes: 2 });
  assert.deepEqual(compterConstats(), { erreurs: 0, alertes: 0 });
});

test("accueil : la cartographie est montrée par blocs, avec les codes des processus", () => {
  const vide = blocsCartographie(nouvelleCartographie());
  assert.equal(vide.vide, true);
  assert.equal(vide.nbProcessus, 0);
  const c = blocsCartographie(exempleCartographie());
  assert.equal(c.vide, false);
  assert.equal(c.nbProcessus, 10);
  assert.equal(c.nbEchanges, 11);
  assert.deepEqual(c.blocs.map((b) => b.categorie), ["management", "realisation", "support", "verification"]);
  assert.deepEqual(c.blocs[0].puces.map((x) => x.code), ["PIL", "AME"]);
  assert.deepEqual(c.blocs[1].puces.map((x) => x.code), ["VEN", "REA", "LIV"]);
  assert.deepEqual(c.blocs[2].puces.map((x) => x.code), ["RHU", "ACH", "FIN", "SIN"]);
  assert.deepEqual(c.blocs[3].puces.map((x) => x.code), ["SUR"], "le 4e bloc « Vérification » (v0.27)");
  assert.equal(c.sansBloc.length, 0);
  // un processus sans bloc, sans code : on montre son nom, dans « sans bloc »
  // (pendant la saisie, la cartographie n'est pas nettoyée : un processus peut encore ne pas avoir de code)
  const b = blocsCartographie({ processus: [{ id: "a", code: "", nom: "Sans code", categorie: "" }, { id: "b", code: "XYZ", nom: "Avec code", categorie: "support" }, { id: "c", code: "", nom: "", categorie: "support" }], flux: [] });
  assert.deepEqual(b.sansBloc.map((x) => x.code), ["Sans code"]);
  assert.deepEqual(b.blocs[2].puces.map((x) => x.code), ["XYZ"], "un processus sans code ni nom n'est pas montré");
});

test("accueil : le titre de l'espace est l'organisation de la cartographie, sinon celle du document", () => {
  const p = nouvelleProcedure();
  assert.equal(nomOrganisation(p, nouvelleCartographie()), "");
  p.meta.organisation = "  Organisation du document ";
  assert.equal(nomOrganisation(p, nouvelleCartographie()), "Organisation du document");
  assert.equal(nomOrganisation(p, { organisation: "Organisation de la carte" }), "Organisation de la carte");
  assert.equal(nomOrganisation(null, null), "");
});

test("accueil : la date de dernière modification se dit « aujourd'hui à », « hier à » ou « le jj/mm/aaaa »", () => {
  const maintenant = new Date(2026, 8, 30, 16, 50).getTime();
  assert.equal(libelleModification(0, maintenant), null);
  assert.equal(libelleModification(NaN, maintenant), null);
  assert.deepEqual(libelleModification(new Date(2026, 8, 30, 9, 5).getTime(), maintenant), { cle: "accueil.doc.modifie.aujourdhui", params: { heure: "09:05" } });
  assert.deepEqual(libelleModification(new Date(2026, 8, 29, 23, 59).getTime(), maintenant), { cle: "accueil.doc.modifie.hier", params: { heure: "23:59" } });
  assert.deepEqual(libelleModification(new Date(2026, 8, 20, 8, 0).getTime(), maintenant), { cle: "accueil.doc.modifie.date", params: { date: "20/09/2026" } });
  assert.equal(libelleModification(new Date(2026, 8, 20, 8, 0).getTime(), maintenant, "en").params.date, "20/09/2026");
  // l'horloge a été reculée : on ne parle pas de « demain »
  assert.equal(libelleModification(new Date(2026, 9, 2, 8, 0).getTime(), maintenant).cle, "accueil.doc.modifie.aujourdhui");
});

// ---------- Vue (accueil / parcours) ----------
test("vue : deux vues seulement ; une vue inconnue est ignorée ; « ne plus afficher l'accueil » se retient dans le navigateur", () => {
  assert.deepEqual(vue.VUES, ["accueil", "parcours"]);
  const memoire = new Map();
  globalThis.localStorage = { getItem: (k) => (memoire.has(k) ? memoire.get(k) : null), setItem: (k, v) => memoire.set(k, String(v)), removeItem: (k) => memoire.delete(k) };
  try {
    let appels = 0;
    vue.abonner(() => { appels += 1; });
    vue.afficher("accueil");
    assert.equal(vue.vueCourante(), "accueil");
    vue.afficher("n'importe quoi");
    assert.equal(vue.vueCourante(), "accueil");
    assert.equal(appels, 1);
    vue.afficher("accueil"); // pas de changement : personne n'est prévenu
    assert.equal(appels, 1);
    vue.afficher("parcours");
    assert.equal(appels, 2);
    assert.equal(vue.accueilMasque(), false);
    vue.definirAccueilMasque(true);
    assert.equal(vue.accueilMasque(), true);
    vue.definirAccueilMasque(false);
    assert.equal(vue.accueilMasque(), false);
  } finally {
    delete globalThis.localStorage;
  }
  assert.equal(vue.accueilMasque(), false, "sans stockage, l'accueil s'affiche");
});

// ---------- Textes : parité FR / EN, clés utilisées, pas d'entreprise réelle ----------
test("textes : chaque clé existe en français ET en anglais, et les {valeurs} sont les mêmes des deux côtés", () => {
  const cles = Object.keys(fr);
  assert.deepEqual(cles.filter((k) => !(k in en)), [], "clés absentes de en.js");
  assert.deepEqual(Object.keys(en).filter((k) => !(k in fr)), [], "clés absentes de fr.js");
  const variables = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
  cles.filter((k) => /^(accueil|mentions|fichier\.non_enregistre|app\.|retour\.email)/.test(k)).forEach((k) => {
    assert.equal(variables(fr[k]), variables(en[k]), `variables différentes pour ${k}`);
    assert.ok(fr[k].trim() && en[k].trim(), `texte vide pour ${k}`);
  });
});

test("textes : toutes les clés appelées par l'accueil et les mentions existent (littérales et construites)", () => {
  const trouvees = new Set();
  ["js/accueil-ui.js", "js/mentions.js", "js/accueil.js", "js/main.js"].forEach((f) => {
    for (const m of source(f).matchAll(/\bt\(\s*"([\w.]+)"/g)) if (!m[1].endsWith(".")) trouvees.add(m[1]); // « clé. » + variable : voir la liste construite ci-dessous
  });
  const construites = [
    ...["procedure", "instruction", "aucun"].map((x) => "accueil.doc.etiquette." + x),
    ...ETAPES.flatMap((x) => ["accueil.parcours." + x, "accueil.reprendre." + x, "parcours.etape." + x]),
    ...["fait", "courant", "afaire", "verrouille"].map((x) => "parcours.etat." + x),
    ...["instruction", "role", "operation", "controle", "erreur", "alerte"].flatMap((x) => [".un", ".autres"].map((s) => "accueil.compteur." + x + s)),
    ...["management", "realisation", "support"].map((x) => "carto.categorie." + x),
    "accueil.doc.modifie.aujourdhui", "accueil.doc.modifie.hier", "accueil.doc.modifie.date",
  ];
  [...trouvees, ...construites].forEach((k) => {
    assert.ok(k in fr, `clé absente du français : ${k}`);
    assert.ok(k in en, `clé absente de l'anglais : ${k}`);
  });
  assert.ok(trouvees.size >= 40, "le test lit bien les fichiers (au moins 40 clés trouvées)");
});

test("textes et sources : rien de propre à une entreprise réelle, aucun HTML injecté dans les nouveaux fichiers", () => {
  ["js/accueil.js", "js/accueil-ui.js", "js/mentions.js", "js/vue.js", "js/config.js", "index.html", "LICENCES-TIERS.md", "vendor/pdfjs/LICENSE-core-js.txt"].forEach((f) => {
    assert.ok(!PROPRE.test(source(f)), `${f} contient un nom propre à une entreprise réelle`);
  });
  Object.entries({ fr, en }).forEach(([langue, textes]) => {
    Object.entries(textes).filter(([k]) => /^(accueil|mentions|fichier\.non_enregistre)/.test(k)).forEach(([k, v]) => {
      assert.ok(!PROPRE.test(v), `${langue} ${k} contient un nom propre à une entreprise réelle`);
    });
  });
  ["js/accueil.js", "js/accueil-ui.js", "js/mentions.js", "js/vue.js"].forEach((f) => {
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(source(f)), `${f} n'injecte jamais de HTML`);
  });
});

// ---------- Mentions et licences ----------
test("mentions : « aide à la rédaction, sans garantie », licence propriétaire (v1.7), aucun lien avec les auteurs, données dans le navigateur", () => {
  assert.match(fr["mentions.aide.texte"], /aide à rédiger/);
  assert.match(fr["mentions.aide.texte"], /sans garantie/);
  assert.match(fr["mentions.aide.texte"], /responsabilité de l'organisation/);
  assert.match(en["mentions.aide.texte"], /without warranty/);
  assert.match(fr["mentions.licence.texte"], /logiciel propriétaire/);
  assert.match(fr["mentions.licence.texte"], /accord écrit préalable/);
  assert.match(en["mentions.licence.texte"], /prior written consent/);
  assert.match(fr["mentions.methode.texte"], /ni édité, ni approuvé, ni recommandé/);
  assert.match(en["mentions.methode.texte"], /neither published, approved nor recommended/);
  assert.match(fr["mentions.donnees.texte"], /navigateur/);
  assert.match(fr["mentions.donnees.texte"], /\.json/);
});

test("mentions : le titulaire des droits n'est affiché que s'il est renseigné dans config.js", () => {
  const avant = CONFIG.titulaire;
  try {
    CONFIG.titulaire = "";
    assert.equal(titulaireAffiche(), "");
    CONFIG.titulaire = "   Prénom Nom  ";
    assert.equal(titulaireAffiche(), "Prénom Nom");
    CONFIG.titulaire = "x".repeat(500);
    assert.equal(titulaireAffiche().length, 200);
    CONFIG.titulaire = 42;
    assert.equal(titulaireAffiche(), "");
  } finally {
    CONFIG.titulaire = avant;
  }
  assert.equal(typeof avant, "string"); // (depuis la v0.24 le titulaire est renseigné : voir tests/v024.test.mjs)
});

test("licences de tiers : la liste cite les trois composants, leur licence, et les textes de licence existent", () => {
  const liste = source("LICENCES-TIERS.md");
  ["PDF.js", "Apache", "core-js", "MIT", "Outfit", "Open Font"].forEach((mot) => assert.ok(liste.includes(mot), `LICENCES-TIERS.md doit citer ${mot}`));
  ["vendor/pdfjs/LICENSE", "vendor/pdfjs/LICENSE-core-js.txt", "css/fonts/LICENSE-Outfit.txt"].forEach((f) => {
    assert.ok(fs.existsSync(new URL("../" + f, import.meta.url)), `${f} doit exister`);
    assert.ok(liste.includes(f), `LICENCES-TIERS.md doit renvoyer à ${f}`);
  });
  assert.match(source("vendor/pdfjs/LICENSE-core-js.txt"), /Permission is hereby granted/);
  assert.match(source("vendor/pdfjs/LICENSE-core-js.txt"), /Denis Pushkarev/);
  // la version de PDF.js annoncée est celle du fichier
  const version = source("vendor/pdfjs/pdf.min.js").match(/pdfjsVersion = ([\d.]+)/);
  assert.ok(version && liste.includes(version[1]), "la version de PDF.js citée doit être celle du fichier");
  // le résumé dans l'application cite les mêmes composants
  ["PDF.js", "core-js", "Apache", "MIT"].forEach((mot) => assert.ok(fr["mentions.licences.pdfjs"].includes(mot) && en["mentions.licences.pdfjs"].includes(mot)));
  assert.match(fr["mentions.licences.police"], /Outfit/);
  assert.match(fr["mentions.licences.police"], /Open Font/);
});

test("page : l'accueil, la fenêtre des mentions, le nom cliquable et le repère « non enregistré » existent dans index.html", () => {
  const html = source("index.html");
  assert.match(html, /<section id="accueil"/);
  assert.match(html, /<dialog id="fenetre-mentions"/);
  assert.match(html, /<button type="button" id="btn-accueil" class="marque"/);
  assert.match(html, /id="btn-mentions"/);
  assert.match(html, /<body data-vue="accueil">/);
  const css = source("css/style.css");
  assert.match(css, /body\[data-vue="accueil"\] #entete/);
  assert.match(css, /body:not\(\[data-vue="accueil"\]\) #accueil \{ display: none; \}/);
});
