// synthese-it.js — l'étape 3 d'une INSTRUCTION DE TRAVAIL (niveau 3) : la synthèse à relire avant de valider.
// Comme synthese.js : lecture seule, rafraîchie à chaque modification. Le tableau reprend les trois colonnes du dessin
// (opérations | plan d'auto-contrôle | actions correctrices) ; la conformité aux règles du chapitre 7 est en dessous.
// La case « Je valide cette synthèse » est celle de synthese.js (rendreValidation).

import { h } from "./dom.js";
import { t, nombre } from "./i18n.js";
import * as store from "./store.js";
import { verifierIT, MIN_OPERATIONS, MAX_OPERATIONS } from "./rules-it.js";
import { constatsDessinIT } from "./diagnostic.js";
import { constatsQuestionnement, questionnement, sansDoublons } from "./questionnement.js";
import { taillePointsNiveau3, SEUIL_PT_IT } from "./render3.js";
import { carteAvec } from "./cartes.js";

const tiret = (v) => (v && String(v).trim() ? String(v).trim() : "—");

function tableau(entetes, lignes) {
  return h("div", { class: "tab-defile" },
    h("table", { class: "tab-synth" },
      h("thead", {}, h("tr", {}, ...entetes.map((e) => h("th", {}, e)))),
      h("tbody", {}, ...lignes.map((l) => h("tr", {}, ...l.map((c) => h("td", {}, c)))))));
}

function bloc(nomIcone, titre, etapeModifiable, allerA, ...contenu) {
  const modifier = etapeModifiable ? h("button", { type: "button", class: "contour petit", onclick: () => allerA(etapeModifiable) }, t("synth.modifier")) : null;
  return carteAvec({ actions: modifier ? [modifier] : [] }, nomIcone, titre, ...contenu);
}

const lignes = (liste) => (liste.length ? h("div", { class: "cellule-liste" }, ...liste.map((x) => h("div", {}, x))) : "—");

export function rendreSyntheseIT(zone, allerA) {
  const p = store.lire();
  const m = p.meta;
  const it = p.it;
  const ops = it.operations;
  const constats = [...sansDoublons(verifierIT(p), p), ...constatsQuestionnement(p), ...constatsDessinIT(p)];
  const questions = questionnement(p);
  const bloquants = constats.filter((c) => c.gravite === "erreur");
  const attention = constats.filter((c) => c.gravite === "alerte");
  const pt = taillePointsNiveau3(p);
  const auteur = ((m.signataires && m.signataires.redige && m.signataires.redige.nom) || "").trim();

  const identification = h("dl", { class: "synth-id" },
    ...[
      ["form.organisation", m.organisation], ["form.direction", m.direction], ["form.processus", m.processus],
      ["form.pilote", m.pilote], ["form.titre_it", m.titre], ["form.reference", m.reference], ["form.version", m.version],
      ["form.auteur", auteur], ["form.type_document", m.typeDocument ? t("type_document." + m.typeDocument) : ""],
      ["synth.it.issue_de", m.issueDe],
    ].filter(([cle, valeur]) => cle !== "synth.it.issue_de" || valeur).flatMap(([cle, valeur]) => [h("dt", {}, t(cle)), h("dd", {}, tiret(valeur))]));

  const nomControle = (c) => `${c.nature || "?"} — ${tiret(c.question)}`;
  const nomCorrective = (m_) => tiret(m_.libelle) + (m_.renvoi.trim() ? ` → ${m_.renvoi.trim()}` : "");
  const deroule = ops.map((op, i) => [
    String(i + 1),
    h("div", { class: "cellule-liste" }, h("div", { class: "l1" }, tiret(op.libelle)),
      i === 0 && op.entree.trim() ? h("div", { class: "petit" }, `${t("it.op.entree")} : ${op.entree.trim()}`) : null,
      op.sortie.trim() ? h("div", { class: "petit" }, `${t("it.op.sortie")} : ${op.sortie.trim()}`) : null,
      op.outils.filter((o) => o.nom.trim()).length ? h("div", { class: "petit" }, `${t("synth.col.outils")} : ${op.outils.map((o) => o.nom.trim()).filter(Boolean).join(", ")}`) : null,
      op.contrainte.actif ? h("div", { class: "petit" }, `${t("it.op.contrainte")} : ${tiret(op.contrainte.texte)}`) : null,
      op.vigilance ? h("div", { class: "petit" }, t("it.op.vigilance")) : null),
    lignes(op.controles.map(nomControle)),
    lignes(op.correctives.map(nomCorrective)),
  ]);

  const classeOps = ops.length > MAX_OPERATIONS ? "erreur" : ops.length >= MIN_OPERATIONS ? "ok" : "alerte";
  zone.replaceChildren(
    h("p", { class: "intro" }, t("synth.intro")),
    bloc("id", t("synth.identification"), 1, allerA, identification),
    bloc("users", t("it.role.titre"), 2, allerA,
      h("p", { class: "ligne-synth" }, h("strong", {}, tiret(it.role.nom)))),
    bloc("swap", t("synth.it.deroule", { n: ops.length }), 2, allerA,
      h("p", { class: "ligne-synth" }, h("strong", {}, t("doc.declencheur") + " : "), tiret(m.declencheur)),
      m.amont.texte.trim() ? h("p", { class: "ligne-synth" }, h("strong", {}, t("form.amont.texte") + " : "), `${m.amont.texte.trim()}${m.amont.role.trim() ? ` (${m.amont.role.trim()})` : ""}${(m.amont.information || "").trim() ? ` — ${t("doc.raccord.information")} : ${m.amont.information.trim()}` : ""}`) : null,
      ops.length ? tableau([t("col.description.n"), t("it.col.operations"), t("it.col.controles"), t("it.col.correctives")], deroule) : null,
      h("p", { class: "ligne-synth" }, h("strong", {}, t("doc.fin") + " : "), tiret(m.fin)),
      m.aval.texte.trim() ? h("p", { class: "ligne-synth" }, h("strong", {}, t("form.aval.texte") + " : "), `${m.aval.texte.trim()}${m.aval.role.trim() ? ` (${m.aval.role.trim()})` : ""}${(m.aval.information || "").trim() ? ` — ${t("doc.raccord.information")} : ${m.aval.information.trim()}` : ""}`) : null),
    bloc("check", t("synth.conformite"), 0, allerA,
      h("ul", { class: "indicateurs-synth" },
        h("li", { class: classeOps }, t("synth.it.indic.operations", { n: ops.length, min: MIN_OPERATIONS, max: MAX_OPERATIONS })),
        pt !== null ? h("li", { class: pt >= SEUIL_PT_IT ? "ok" : "alerte" }, t("synth.it.indic.pt", { pt: nombre(pt), seuil: nombre(SEUIL_PT_IT) })) : null,
        // Le questionnement en 11 points : une seule ligne, et seulement quand tout est respecté ; sinon, les points manquants sont dans les listes ci-dessous.
        questions.respectes ? h("li", { class: "ok" }, t("synth.indic.questionnement.instruction", { n: questions.unites })) : null),
      bloquants.length
        ? h("div", { class: "liste-bloquants" }, h("strong", {}, t("synth.bloquants")), h("ul", {}, ...bloquants.map((c) => h("li", { class: "erreur" }, t(c.cle, c.params)))))
        : h("p", { class: "aide ok" }, t("synth.conforme")),
      attention.length
        ? h("div", { class: "liste-attention" }, h("strong", {}, t("synth.attention")), h("ul", {}, ...attention.map((c) => h("li", { class: "alerte" }, t(c.cle, c.params)))))
        : null));
}
