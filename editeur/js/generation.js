// generation.js — l'étape 4 : GÉNÉRER le document (Word ou PDF).
// La zone se rafraîchit à chaque modification (elle ne contient aucun champ de saisie).

import { h } from "./dom.js";
import { t } from "./i18n.js";
import * as store from "./store.js";
import { construireDocument, estimerPages, listeNiveau3 } from "./document.js";
import { telechargerWord, imprimerPdf, telechargerPngIT } from "./sorties.js";
import { estInstruction } from "./parcours.js";
import { taillePointsNiveau3 } from "./render3.js";
import { nombre } from "./i18n.js";
import { carte } from "./cartes.js";
import { icone } from "./icones.js";

// Instruction de travail : une page A4 portrait, en Word (dessin en image, instruction complète embarquée), en PDF (impression)
// ou en simple image PNG.
function rendreGenerationIT(zone, p) {
  const etat = h("p", { class: "aide", role: "status" });
  // Un bouton qui lance un téléchargement : désactivé pendant la fabrication, message d'erreur si elle échoue.
  const boutonTelechargement = (libelle, action) => {
    const bouton = h("button", { type: "button", class: "primaire" }, icone("dl", 18), libelle);
    bouton.addEventListener("click", async () => {
      bouton.disabled = true;
      etat.textContent = t("gen.en_cours");
      try {
        await action();
        etat.textContent = "";
      } catch (e) {
        etat.textContent = t("gen.erreur");
      }
      bouton.disabled = false;
    });
    return bouton;
  };
  const boutonWord = boutonTelechargement(t("gen.word"), telechargerWord);
  const boutonPng = boutonTelechargement(t("gen.it.png"), telechargerPngIT);
  const boutonPdf = h("button", { type: "button", class: "primaire" }, icone("dl", 18), t("gen.pdf"));
  boutonPdf.addEventListener("click", () => imprimerPdf());
  const pt = taillePointsNiveau3(p);
  zone.replaceChildren(h("div", { class: "generation" },
    h("p", { class: "intro ok-texte" }, t("gen.intro")),
    carte("id", p.meta.titre || t("doc.sans_titre"),
      h("p", { class: "ligne-synth" }, [p.meta.reference, p.meta.version].filter(Boolean).join(" · ") || "—"),
      pt !== null ? h("p", { class: "aide" }, t("gen.it.pages", { pt: nombre(pt) })) : null),
    h("div", { class: "colonnes-cartes" },
      carte("word", t("gen.it.word.titre"), h("p", { class: "aide" }, t("gen.it.word.aide")), h("div", { class: "carte-bouton" }, boutonWord)),
      carte("doc", t("gen.pdf.titre"), h("p", { class: "aide" }, t("gen.it.pdf.aide")), h("div", { class: "carte-bouton" }, boutonPdf)),
      carte("doc", t("gen.it.png.titre"), h("p", { class: "aide" }, t("gen.it.png.aide")), h("div", { class: "carte-bouton" }, boutonPng))),
    etat));
}

export function rendreGeneration(zone) {
  const p = store.lire();
  if (estInstruction(p)) return rendreGenerationIT(zone, p);
  const pages = estimerPages(construireDocument(p));
  const n3 = listeNiveau3(p).length;
  const etat = h("p", { class: "aide", role: "status" });

  const boutonWord = h("button", { type: "button", class: "primaire" }, icone("dl", 18), t("gen.word"));
  boutonWord.addEventListener("click", async () => {
    boutonWord.disabled = true;
    etat.textContent = t("gen.en_cours");
    try {
      await telechargerWord();
      etat.textContent = "";
    } catch (e) {
      etat.textContent = t("gen.erreur");
    }
    boutonWord.disabled = false;
  });
  const boutonPdf = h("button", { type: "button", class: "primaire" }, icone("dl", 18), t("gen.pdf"));
  boutonPdf.addEventListener("click", () => imprimerPdf());

  // h() ignore les enfants nuls ; replaceChildren() du navigateur écrirait le mot « null » : on passe par un conteneur.
  zone.replaceChildren(h("div", { class: "generation" },
    h("p", { class: "intro ok-texte" }, t("gen.intro")),
    carte("id", p.meta.titre || t("doc.sans_titre"),
      h("p", { class: "ligne-synth" }, [p.meta.reference, p.meta.version].filter(Boolean).join(" · ") || "—"),
      h("p", { class: "aide" }, t("gen.pages", { n: pages })),
      n3 > 0 ? h("p", { class: "aide alerte-texte" }, t("gen.n3", { n: n3 })) : null),
    h("div", { class: "colonnes-cartes" },
      carte("word", t("gen.word.titre"), h("p", { class: "aide" }, t("gen.word.aide")), h("div", { class: "carte-bouton" }, boutonWord)),
      carte("doc", t("gen.pdf.titre"), h("p", { class: "aide" }, t("gen.pdf.aide")), h("div", { class: "carte-bouton" }, boutonPdf))),
    etat));
}
