// conseils.js — la lisibilité du logigramme, côté messages : transforme les conseils calculés par render.js
// (quel texte raccourcir, combien de points on gagnerait) en constats prêts à afficher { gravite, cle, params }.
// Rien n'est dessiné ni modifié ici.

import { t, nombre } from "./i18n.js";
import { conseilsLisibilite, SEUIL_PT } from "./render.js";

const extrait = (texte) => (texte.length > 30 ? texte.slice(0, 30).trim() + "…" : texte);

export function constatsLisibilite(procedure) {
  const c = conseilsLisibilite(procedure);
  if (!c) return [];
  const constats = c.conseils.map((x) => ({
    gravite: "conseil",
    cle: "conseil.lisibilite.ligne",
    params: { champ: t("conseil.champ." + x.champ, { n: x.n }), extrait: extrait(x.texte), longueur: x.longueur, cible: x.cible, gain: nombre(x.gain) },
  }));
  const bilan = { n: c.nbInstructions, roles: c.nbRoles, seuil: nombre(SEUIL_PT) };
  if (!c.conseils.length) constats.push({ gravite: "conseil", cle: "conseil.lisibilite.aucun", params: { ...bilan, pt: nombre(c.pt) } });
  else constats.push({ gravite: "conseil", cle: c.atteint ? "conseil.lisibilite.bilan_ok" : "conseil.lisibilite.bilan_non", params: { ...bilan, pt: nombre(c.ptApres) } });
  return constats;
}
