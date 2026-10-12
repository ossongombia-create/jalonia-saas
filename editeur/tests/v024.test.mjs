// Tests v0.24 — le titulaire des droits (décision D3 du 30/09/2026) : « © 2026 Brice Ossongombia — tous droits réservés — version d'essai ».
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { definirLangue, t } from "../js/i18n.js";
import fr from "../js/locales/fr.js";
import en from "../js/locales/en.js";
import { CONFIG } from "../js/config.js";
import { anneeDroits, droitsAffiches, titulaireAffiche } from "../js/mentions.js";
import { exempleProcedure } from "../js/exemple-procedure.js";
import { exempleInstruction } from "../js/exemple-it.js";
import { construireDocx } from "../js/exportDocx.js";

const source = (chemin) => fs.readFileSync(new URL("../" + chemin, import.meta.url), "utf8");
definirLangue("fr");

test("le titulaire est réglé dans config.js : Brice Ossongombia, 2026", () => {
  assert.equal(CONFIG.titulaire, "Brice Ossongombia");
  assert.equal(CONFIG.anneeDroits, "2026");
  assert.equal(titulaireAffiche(), "Brice Ossongombia");
  assert.equal(anneeDroits(), "2026");
});

test("la ligne des droits est exactement celle décidée, en français et en anglais", () => {
  definirLangue("fr");
  assert.equal(droitsAffiches(), "© 2026 Brice Ossongombia — tous droits réservés — version d'essai");
  definirLangue("en");
  assert.equal(droitsAffiches(), "© 2026 Brice Ossongombia — all rights reserved — trial version");
  definirLangue("fr");
});

test("l'année : celle de config.js si elle a quatre chiffres, sinon l'année en cours ; pas de titulaire, pas de ligne", () => {
  const avant = { titulaire: CONFIG.titulaire, annee: CONFIG.anneeDroits };
  try {
    CONFIG.anneeDroits = "2027";
    assert.equal(anneeDroits(), "2027");
    ["", "  ", "abcd", "27", "20266", 2026.5, null, undefined].forEach((v) => {
      CONFIG.anneeDroits = v;
      assert.equal(anneeDroits(), String(new Date().getFullYear()), `valeur ${String(v)}`);
    });
    CONFIG.anneeDroits = "2026";
    CONFIG.titulaire = "";
    assert.equal(droitsAffiches(), "");
    CONFIG.titulaire = "   ";
    assert.equal(droitsAffiches(), "");
  } finally {
    CONFIG.titulaire = avant.titulaire;
    CONFIG.anneeDroits = avant.annee;
  }
});

test("les textes FR / EN : la clé des droits existe des deux côtés, l'ancienne a disparu, les paramètres sont les mêmes", () => {
  assert.ok(fr["mentions.droits"] && en["mentions.droits"]);
  assert.ok(!("mentions.titulaire" in fr) && !("mentions.titulaire" in en), "l'ancienne clé « Titulaire des droits : » n'existe plus");
  const parametres = (texte) => [...texte.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
  assert.equal(parametres(fr["mentions.droits"]), "annee,titulaire");
  assert.equal(parametres(en["mentions.droits"]), "annee,titulaire");
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort(), "parité FR / EN");
});

test("la fenêtre des mentions utilise la ligne des droits (et seulement si un titulaire est renseigné)", () => {
  const code = source("js/mentions.js");
  assert.match(code, /const droits = droitsAffiches\(\)/);
  assert.match(code, /droits \? h\("p", \{ class: "mentions-titulaire" \}, droits\) : null/);
});

test("les documents générés ne portent pas la mention de droits de l'outil (un Word appartient à l'organisation)", () => {
  [exempleProcedure(), exempleInstruction()].forEach((p) => {
    const texte = Buffer.from(construireDocx(p, { embarquer: true })).toString("latin1");
    assert.ok(!texte.includes("Ossongombia"), "le nom du titulaire n'apparaît pas dans le fichier Word");
    assert.ok(!texte.includes("tous droits réservés"));
  });
});

test("le texte des droits n'est écrit qu'à un endroit : config.js (le nom) et les textes (la formule)", () => {
  const fichiers = fs.readdirSync(new URL("../js/", import.meta.url)).filter((f) => f.endsWith(".js") && f !== "config.js").map((f) => "js/" + f)
    .concat(["index.html", "css/style.css"]);
  fichiers.forEach((f) => assert.ok(!source(f).includes("Ossongombia"), `${f} ne doit pas écrire le nom du titulaire en dur (il vient de config.js)`));
});
