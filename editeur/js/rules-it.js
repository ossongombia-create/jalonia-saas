// rules-it.js — le MOTEUR DE RÈGLES du niveau 3 : vérifie une instruction de travail (chapitre 7 du livre Qualigramme).
// Comme rules.js : il ne dessine rien, il reçoit le document et renvoie des constats { gravite, cle, params }.
//
// Les 16 règles du livre (p. 154) qui se vérifient sur les données :
//   2 un seul rôle (garanti par le modèle : it.role)        4-5 de 5 à 10 opérations, hors contrôles et correctives
//   7 libellé : 5 mots au plus, infinitif, jamais « et »     8 contrôle = question (réponse Oui / Non)
//   9 corrective = verbe à l'infinitif                       11 information d'entrée de la 1re opération et de sortie de la dernière
//   12 un début et une fin                                   13 rôles de provenance et de destination
//   15 opération à risque = au moins un contrôle             16 un contrôle a toujours au moins une corrective
// Restent au dessin : 1 (une page A4, seuil de lisibilité), 6 (pas de flèches croisées : la disposition en colonnes l'assure),
// 10 (chaque opération a une flèche entrante et sortante : le dessin les trace toutes), 14 (le niveau de détail : jugement de l'auteur).

import { INFINITIF, mots } from "./rules.js";

export const MIN_OPERATIONS = 5;
export const MAX_OPERATIONS = 10;

export function verifierIT(p) {
  const constats = [];
  const ajouter = (gravite, cle, params = {}) => constats.push({ gravite, cle, params });
  const it = p.it;
  const ops = it.operations;
  const n = ops.length;

  if (!it.role.nom.trim()) ajouter("alerte", "regle3.role.absent");
  if (!p.meta.declencheur.trim()) ajouter("alerte", "regle3.debut.manquant");
  if (n > 0 && !p.meta.fin.trim()) ajouter("alerte", "regle3.fin.manquante");
  // Règle 13 : quand une action amont ou aval est citée, on dit de quel rôle elle vient ou à quel rôle elle va.
  if (p.meta.amont.texte.trim() && !p.meta.amont.role.trim()) ajouter("alerte", "regle3.raccord.amont_sans_role");
  if (p.meta.aval.texte.trim() && !p.meta.aval.role.trim()) ajouter("alerte", "regle3.raccord.aval_sans_role");
  // v0.17 : la flèche qui relie une action amont ou aval porte une information (panier) — c'est la définition même de ces actions (§7.5.9-10).
  if (p.meta.amont.texte.trim() && !(p.meta.amont.information || "").trim()) ajouter("alerte", "regle3.raccord.amont_sans_info");
  if (p.meta.aval.texte.trim() && !(p.meta.aval.information || "").trim()) ajouter("alerte", "regle3.raccord.aval_sans_info");

  // Règles 4 et 5 : 10 opérations au plus (au-delà : une seconde instruction, et le dessin ne tient plus sur une page), 5 au moins.
  if (n > MAX_OPERATIONS) ajouter("erreur", "regle3.operations.trop", { n });
  else if (n > 0 && n < MIN_OPERATIONS) ajouter("alerte", "regle3.operations.peu", { n });

  ops.forEach((op, index) => {
    const i = index + 1;
    const libelle = op.libelle.trim();
    if (!libelle) {
      ajouter("erreur", "regle3.operation.libelle_vide", { i });
    } else {
      const m = mots(libelle);
      if (m.length > 5) ajouter("erreur", "regle3.operation.trop_de_mots", { i, libelle, n: m.length });
      if (/\s(et|&)\s/i.test(` ${libelle} `)) ajouter("erreur", "regle3.operation.contient_et", { i });
      if (!INFINITIF.test(m[0])) ajouter("alerte", "regle3.operation.pas_infinitif", { i, mot: m[0] });
    }
    if (index === 0 && !op.entree.trim()) ajouter("alerte", "regle3.operation.sans_entree", { i });
    if (index === n - 1 && !op.sortie.trim()) ajouter("alerte", "regle3.operation.sans_sortie", { i });
    if (op.outils.some((o) => !o.nom.trim())) ajouter("alerte", "regle3.outil.sans_nom", { i });
    if (op.contrainte.actif && !op.contrainte.texte.trim()) ajouter("alerte", "regle3.contrainte.sans_texte", { i });

    // Règle 15 : une opération à risque ou qui demande de la vigilance a au moins un contrôle.
    if (op.vigilance && op.controles.length === 0) ajouter("erreur", "regle3.operation.risque_sans_controle", { i });

    op.controles.forEach((c, k) => {
      const j = k + 1;
      const question = c.question.trim();
      if (!question) ajouter("erreur", "regle3.controle.question_vide", { i, j });
      else if (!question.endsWith("?")) ajouter("alerte", "regle3.controle.pas_question", { i, j });
      if (!c.nature) ajouter("alerte", "regle3.controle.sans_nature", { i, j });
      // Règle 16 : un contrôle a toujours au moins une action corrective (si la réponse est « Non »).
      if (c.correctives.length === 0) ajouter("erreur", "regle3.controle.sans_corrective", { i, j });
    });

    op.correctives.forEach((m, k) => {
      const j = k + 1;
      const texte = m.libelle.trim();
      if (!texte) ajouter("erreur", "regle3.corrective.libelle_vide", { i, j });
      else if (!INFINITIF.test(mots(texte)[0])) ajouter("alerte", "regle3.corrective.pas_infinitif", { i, j, mot: mots(texte)[0] });
      if (!op.controles.some((c) => c.correctives.includes(m.id))) ajouter("alerte", "regle3.corrective.sans_controle", { i, j });
    });
  });

  if (constats.length === 0 && n > 0) ajouter("ok", "diag.ok");
  return constats;
}
