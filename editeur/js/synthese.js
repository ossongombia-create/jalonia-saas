// synthese.js — l'étape 3 : la SYNTHÈSE à relire puis à valider.
// Deux zones se rafraîchissent à chaque modification (elles ne contiennent aucun champ de saisie) :
//   rendreSynthese()  : identification, déroulé, risques, niveau 3, conformité et longueur (lecture seule)
//   rendreValidation(): la case « Je valide cette synthèse » qui ouvre l'étape Génération

import { h } from "./dom.js";
import { t, nombre } from "./i18n.js";
import * as store from "./store.js";
import { colonnes, verifier } from "./rules.js";
import { verifierCodes } from "./rules-codes.js";
import { lire as lireCartographie } from "./cartographie-store.js";
import { taillePointsSurA4, croisementsNiveau2, SEUIL_PT } from "./render.js";
import { constatsLisibilite } from "./conseils.js";
import { construireDocument, estimerPages, verifierLongueur, listeRisques, listeOpportunites, listeNiveau3, listeControles, listeDecisions, PAGES_MAX, PAGES_CIBLE_MIN } from "./document.js";
import { bloquantsSynthese, estValidee } from "./parcours.js";
import { constatsQuestionnement, questionnement, sansDoublons } from "./questionnement.js";
import { carteAvec, pointRole } from "./cartes.js";
import { icone } from "./icones.js";

const tiret = (v) => (v && String(v).trim() ? String(v).trim() : "—");

function tableau(entetes, lignes) {
  return h("div", { class: "tab-defile" },
    h("table", { class: "tab-synth" },
      h("thead", {}, h("tr", {}, ...entetes.map((e) => h("th", {}, e)))),
      h("tbody", {}, ...lignes.map((l) => h("tr", {}, ...l.map((c) => h("td", {}, c)))))));
}

// Une carte de la synthèse : icône, titre, et un bouton « Modifier » qui renvoie à l'étape où se corrige ce bloc.
function bloc(nomIcone, titre, etapeModifiable, allerA, ...contenu) {
  const modifier = etapeModifiable ? h("button", { type: "button", class: "contour petit", onclick: () => allerA(etapeModifiable) }, t("synth.modifier")) : null;
  return carteAvec({ actions: modifier ? [modifier] : [] }, nomIcone, titre, ...contenu);
}

// Points d'attention non bloquants : alertes des règles, logigramme trop dense, sections clés vides.
function pointsAttention(p) {
  const doc = construireDocument(p);
  const carto = lireCartographie();
  const alertes = [...sansDoublons(verifier(p, { nomenclature: carto.nomenclature }), p), ...constatsQuestionnement(p), ...verifierCodes(p, carto), ...verifierLongueur(doc)].filter((c) => c.gravite === "alerte").map((c) => t(c.cle, c.params));
  const pt = taillePointsSurA4(p);
  if (pt !== null && pt < SEUIL_PT) {
    alertes.push(t("regle.logigramme.trop_haut", { pt: nombre(pt), seuil: nombre(SEUIL_PT) }));
    constatsLisibilite(p).forEach((c) => alertes.push(t(c.cle, c.params)));
  }
  const croisements = croisementsNiveau2(p);
  if (croisements > 0) alertes.push(t("regle.logigramme.croisements", { n: croisements }));
  const vide = (cle) => !doc.sections.find((s) => s.cle === cle).blocs.some((b) => b.type === "paragraphe" || b.type === "tableau");
  if (vide("objet")) alertes.push(t("synth.attention.objet"));
  if (vide("domaine")) alertes.push(t("synth.attention.domaine"));
  return alertes;
}

export function rendreSynthese(zone, allerA) {
  const p = store.lire();
  const m = p.meta;
  const doc = construireDocument(p);
  const pages = estimerPages(doc);
  const nomRole = (id) => (p.roles.find((r) => r.id === id) || { nom: "" }).nom;
  const risques = listeRisques(p);
  const opportunites = listeOpportunites(p);
  const n3 = listeNiveau3(p);
  const controles = listeControles(p);
  const decisions = listeDecisions(p);
  const nHorsControle = p.etapes.filter((e) => !e.controle.actif).length;
  const bloquants = bloquantsSynthese(p);
  const attention = pointsAttention(p);
  const questions = questionnement(p);
  const cols = colonnes(p).length;

  const identification = h("dl", { class: "synth-id" },
    ...[
      ["form.organisation", m.organisation], ["form.direction", m.direction], ["form.processus", m.processus],
      ["form.pilote", m.pilote], ["form.titre", m.titre], ["form.reference", m.reference], ["form.version", m.version],
      ["form.type_document", m.typeDocument ? t("type_document." + m.typeDocument) : ""],
    ].flatMap(([cle, valeur]) => [h("dt", {}, t(cle)), h("dd", {}, tiret(valeur))]));

  const deroule = p.etapes.map((e, i) => [
    String(i + 1),
    tiret(nomRole(e.roleId)),
    tiret(e.libelle),
    tiret(e.entree && e.entreeDe ? `${e.entree} (${e.entreeDe})` : e.entree),
    tiret(e.sortie && e.versQui ? `${e.sortie} (${e.versQui})` : e.sortie),
    tiret(e.outils.map((o) => o.nom.trim()).filter(Boolean).join(", ")),
    e.risques.length ? String(e.risques.length) : "—",
    e.niveau3.actif ? (e.niveau3.code.trim() || "?") : "—",
  ]);

  zone.replaceChildren(
    h("p", { class: "intro" }, t("synth.intro")),
    bloc("id", t("synth.identification"), 1, allerA, identification),
    bloc("users", t("synth.roles", { n: p.roles.length }), 2, allerA,
      p.roles.length
        ? h("div", { class: "puces-roles" }, ...p.roles.map((r, i) => h("span", { class: "puce-role" },
          pointRole(i), h("strong", {}, r.nom || t("form.role.sans_nom")), h("small", {}, t("role.type." + r.type)))))
        : h("p", { class: "ligne-synth" }, "—")),
    bloc("swap", t("synth.deroule", { n: p.etapes.length }), 2, allerA,
      h("p", { class: "ligne-synth" }, h("strong", {}, t("doc.declencheur") + " : "), tiret(m.declencheur)),
      p.etapes.length
        ? tableau([t("col.description.n"), t("col.description.acteur"), t("col.description.operation"), t("col.description.entree"),
          t("col.description.sortie"), t("synth.col.outils"), t("synth.col.risque"), t("synth.col.n3")], deroule)
        : null,
      h("p", { class: "ligne-synth" }, h("strong", {}, t("doc.fin") + " : "), tiret(m.fin))),
    bloc("warn", t("synth.risques", { n: risques.length }), 2, allerA,
      risques.length
        ? tableau(["col.risques.nop", "col.risques.risque", "col.risques.criticite", "col.risques.mesure", "col.risques.responsable"].map((k) => t(k)),
          risques.map(({ n, risque, criticite: c, responsable }) => [
            String(n), tiret(risque.risque),
            c ? h("span", { class: "criticite " + c.niveau }, `${c.g} × ${c.p} = ${c.valeur}`) : "—",
            tiret(risque.mesure), tiret(responsable),
          ]))
        : h("p", { class: "aide" }, t("synth.risques.aucun"))),
    bloc("bulb", t("synth.opportunites", { n: opportunites.length }), 2, allerA,
      opportunites.length
        ? tableau(["col.opportunites.nop", "col.opportunites.opportunite", "col.opportunites.benefice", "col.opportunites.cotation", "col.opportunites.suite"].map((k) => t(k)),
          opportunites.map(({ n, opportunite: o, score: s }) => [
            String(n), tiret(o.opportunite), tiret(o.benefice),
            s ? h("span", { class: "score-opp " + s.suite }, `${s.i} × ${s.f} = ${s.valeur}`) : "—",
            s ? t("opportunite.suite." + s.suite) : "—",
          ]))
        : h("p", { class: "aide" }, t("synth.opportunites.aucune"))),
    bloc("tri", t("synth.controles", { n: controles.length }), 2, allerA,
      controles.length
        ? tableau(["col.controles.n", "col.controles.controle", "col.controles.nature", "col.controles.critere", "col.controles.suite"].map((k) => t(k)),
          controles.map((c) => [String(c.n), tiret(c.etape.libelle), c.nature ? `${c.nature} — ${t("controle.nature." + c.nature)}` : "—", tiret(c.critere), tiret(c.suite)]))
        : h("p", { class: "aide" }, t("synth.controles.aucun"))),
    bloc("dia", t("synth.decisions", { n: new Set(decisions.map((d) => d.n)).size }), 2, allerA,
      decisions.length
        ? tableau([t("synth.dec.col.n"), t("synth.dec.col.cas"), t("synth.dec.col.info"), t("synth.dec.col.destination")],
          decisions.map((d) => [String(d.n), tiret(d.cas), tiret(d.info), tiret(d.destination)]))
        : h("p", { class: "aide" }, t("synth.decisions.aucune"))),
    bloc("layers", t("synth.n3", { n: n3.length }), 2, allerA,
      n3.length
        ? tableau([t("synth.n3.col.code"), t("synth.n3.col.intitule"), t("synth.n3.col.role"), t("synth.n3.col.op")],
          n3.map((x) => [tiret(x.code), tiret(x.intitule), tiret(x.role), String(x.n)]))
        : h("p", { class: "aide" }, t("synth.n3.aucun"))),
    bloc("check", t("synth.conformite"), 0, allerA,
      h("ul", { class: "indicateurs-synth" },
        h("li", { class: cols > 6 ? "erreur" : "ok" }, t("synth.indic.roles", { n: cols })),
        h("li", { class: nHorsControle >= 5 && nHorsControle <= 10 ? "ok" : "alerte" }, t("synth.indic.instructions", { n: nHorsControle })),
        h("li", { class: pages > PAGES_MAX ? "erreur" : pages >= PAGES_CIBLE_MIN ? "ok" : "neutre" }, t("doc.pages", { n: pages, min: PAGES_CIBLE_MIN, max: PAGES_MAX })),
        // Le questionnement en 11 points : une seule ligne, et seulement quand tout est respecté ; sinon, les points manquants sont dans les listes ci-dessous.
        questions.respectes ? h("li", { class: "ok" }, t("synth.indic.questionnement.procedure", { n: questions.unites })) : null),
      bloquants.length
        ? h("div", { class: "liste-bloquants" }, h("strong", {}, t("synth.bloquants")), h("ul", {}, ...bloquants.map((c) => h("li", { class: "erreur" }, t(c.cle, c.params)))))
        : h("p", { class: "aide ok" }, t("synth.conforme")),
      attention.length
        ? h("div", { class: "liste-attention" }, h("strong", {}, t("synth.attention")), h("ul", {}, ...attention.map((a) => h("li", { class: "alerte" }, a))))
        : null));
}

export function rendreValidation(zone) {
  const p = store.lire();
  const bloque = bloquantsSynthese(p).length > 0;
  const validee = estValidee(p);
  const caduque = !validee && p.validation !== "";
  const case_ = h("input", { type: "checkbox", checked: validee, disabled: bloque && !validee });
  case_.addEventListener("change", () => (case_.checked ? store.valider() : store.retirerValidation()));
  const message = caduque ? h("p", { class: "alerte-texte" }, t("synth.caduque"))
    : bloque && !validee ? h("p", {}, t("synth.valider.impossible"))
      : validee ? h("p", { class: "ok-texte" }, icone("check", 16, 2.2), t("synth.validee"))
        : h("p", {}, t("synth.valider.aide"));
  zone.replaceChildren(h("section", { class: "carte validation" },
    h("label", { class: "case-validation" }, case_, h("span", {}, t("synth.valider"))),
    h("div", { class: "message-validation" }, message)));
}
