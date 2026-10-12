// rules.js — le MOTEUR DE RÈGLES : vérifie qu'une procédure respecte les règles du langage Qualigramme.
// Il ne dessine rien et ne touche pas à la page : il reçoit une procédure et renvoie une liste de
// constats. Chaque constat = { gravite, cle, params }. Le texte est produit plus tard par t(cle, params)
// (voir i18n.js), ce qui permet d'afficher les mêmes constats en français ou en anglais.
//
// gravite : "erreur" (règle du langage enfreinte) | "alerte" (à vérifier) | "ok"

import { partiesDeLaFleche } from "./model.js";

// Code d'une procédure selon la nomenclature TYPE-PROCESSUS-NN (ex. PR-ACH-05) ; le type (PR) est celui de l'organisation.
const formatProcedure = (type) => new RegExp("^" + type + "-[A-Z][A-Z0-9]{1,4}-\\d{2,3}$");
// Sans réglage, on suppose la nomenclature TYPE-PROCESSUS-NN avec « PR » ; l'application, elle, donne celle de la cartographie (contrôle décoché par défaut).
const NOMENCLATURE_SUPPOSEE = { controle: true, procedure: "PR" };
export const INFINITIF = /(er|ir|re|oir)$/i; // heuristique simple : « Établir », « Vérifier », « Prendre »…

export function mots(texte) {
  return texte.trim().split(/\s+/).filter(Boolean);
}

// Colonnes du logigramme = les rôles qui ont au moins une étape, dans l'ordre d'apparition.
export function colonnes(procedure) {
  const vus = [];
  procedure.etapes.forEach((e) => {
    if (e.roleId && !vus.includes(e.roleId)) vus.push(e.roleId);
  });
  return vus.map((id) => procedure.roles.find((r) => r.id === id)).filter(Boolean);
}

// options.nomenclature : { controle, procedure } de l'organisation (voir cartographie.js) ; sans elle, TYPE-PROCESSUS-NN avec « PR » est supposé.
export function verifier(procedure, { nomenclature = NOMENCLATURE_SUPPOSEE } = {}) {
  const typeProcedure = /^[A-Z]{1,3}$/.test(nomenclature.procedure) ? nomenclature.procedure : "PR";
  const formatCodeProcedure = formatProcedure(typeProcedure);
  const constats = [];
  const ajouter = (gravite, cle, params = {}) => constats.push({ gravite, cle, params });
  const cols = colonnes(procedure);

  if (procedure.roles.length === 0) ajouter("alerte", "regle.roles.aucun");
  if (cols.length > 6) ajouter("erreur", "regle.roles.trop_nombreux", { n: cols.length });
  if (!procedure.meta.declencheur.trim()) ajouter("alerte", "regle.debut.manquant");
  if (procedure.etapes.length > 0 && !procedure.meta.fin.trim()) ajouter("alerte", "regle.fin.manquante");
  // v0.17 : une action amont / aval est reliée par une flèche d'information (livre §6.5.12-13) : le panier dit ce qui est transmis.
  const amont = procedure.meta.amont || {};
  const aval = procedure.meta.aval || {};
  if ((amont.texte || "").trim() && !(amont.information || "").trim()) ajouter("alerte", "regle.raccord.amont_sans_info");
  if ((aval.texte || "").trim() && !(aval.information || "").trim()) ajouter("alerte", "regle.raccord.aval_sans_info");

  // Les instructions de contrôle (triangle) ne comptent pas dans l'effectif de 5 à 10 instructions (livre, règles de rédaction).
  const n = procedure.etapes.length;
  const nHorsControle = procedure.etapes.filter((e) => !(e.controle && e.controle.actif) && !e.correctrice).length;
  if (n > 0 && (nHorsControle < 5 || nHorsControle > 10)) ajouter("alerte", "regle.instructions.effectif", { n: nHorsControle });

  procedure.etapes.forEach((etape, index) => {
    const i = index + 1;
    const libelle = etape.libelle.trim();
    if (!etape.roleId) ajouter("erreur", "regle.etape.sans_role", { i });
    if (!libelle) {
      ajouter("erreur", "regle.etape.libelle_vide", { i });
    } else {
      const m = mots(libelle);
      if (m.length > 5) ajouter("erreur", "regle.etape.trop_de_mots", { i, libelle, n: m.length });
      if (/\s(et|&)\s/i.test(` ${libelle} `)) ajouter("erreur", "regle.etape.contient_et", { i });
      if (!INFINITIF.test(m[0])) ajouter("alerte", "regle.etape.pas_infinitif", { i, mot: m[0] });
    }
    if (!etape.entree.trim()) ajouter("alerte", "regle.etape.sans_entree", { i });
    if (!etape.sortie.trim()) ajouter("alerte", "regle.etape.sans_sortie", { i });
    if (etape.entree.trim() && etape.entree.trim().toLowerCase() === etape.sortie.trim().toLowerCase()) {
      ajouter("erreur", "regle.etape.sortie_egale_entree", { i });
    }

    if (etape.outils.some((o) => !o.nom.trim())) ajouter("alerte", "regle.outil.sans_nom", { i });

    // Risque maîtrisé : le risque et sa mesure de maîtrise alimentent la section 10 du document.
    if (etape.risques.some((r) => !r.risque.trim() || !r.mesure.trim())) ajouter("alerte", "regle.risque.incomplet", { i });
    if ((etape.opportunites || []).some((o) => !o.opportunite.trim())) ajouter("alerte", "regle.opportunite.incomplet", { i });
    // Indicateur de performance (fanion) : il doit avoir un nom, repris dans le document.
    if (etape.indicateur && etape.indicateur.actif && !etape.indicateur.nom.trim()) ajouter("alerte", "regle.indicateur.sans_nom", { i });
    // … et sa formule, sa cible et sa fréquence alimentent la section 8 : sans elles, la ligne du tableau reste à moitié vide.
    else if (etape.indicateur && etape.indicateur.actif && [etape.indicateur.formule, etape.indicateur.cible, etape.indicateur.frequence].some((x) => !(x || "").trim())) ajouter("alerte", "regle.indicateur.incomplet", { i, nom: etape.indicateur.nom.trim() });
    // Indicateur d'interface (contrat sur la flèche de sortie) : il faut nommer le contrat, et il lie deux parties différentes.
    if (etape.contrat && etape.contrat.actif) {
      if (!etape.contrat.reference.trim()) ajouter("alerte", "regle.contrat.sans_reference", { i });
      const { memeRole, de } = partiesDeLaFleche(procedure, index);
      if (memeRole) ajouter("alerte", "regle.contrat.meme_role", { i, role: de });
    }
    // Sous-procédure : on cite le code de la procédure appelée (ex. PR-XXX-NN), qui n'est pas celle qu'on est en train d'écrire.
    if (etape.sousProcedure && etape.sousProcedure.actif) {
      const code = etape.sousProcedure.code.trim().toUpperCase();
      if (!code) ajouter("alerte", "regle.sp.sans_code", { i });
      else if (nomenclature.controle && !formatCodeProcedure.test(code)) ajouter("alerte", "regle.sp.code_format", { i, code, type: typeProcedure });
      else if (code === (procedure.meta.reference || "").trim().toUpperCase()) ajouter("alerte", "regle.sp.code_propre", { i, code });
    }
    // Macro-instruction « alternatives » : au moins deux alternatives exclusives, chacune renseignée.
    if (etape.macro && etape.macro.type === "alternatives") {
      const alts = etape.macro.alternatives.map((a) => a.trim());
      if (alts.filter(Boolean).length < 2) ajouter("alerte", "regle.macro.alternatives_insuffisantes", { i });
      else if (alts.some((a) => !a)) ajouter("alerte", "regle.macro.alternative_vide", { i });
    }
    // Niveau 3 : le code de l'instruction de travail est repris dans le logigramme et dans le tableau.
    if (etape.niveau3.actif && !etape.niveau3.code.trim()) ajouter("alerte", "regle.n3.sans_code", { i });

    // Contrôle (triangle) : nature et critère alimentent la section 8 ; un contrôle a toujours une suite si non conforme.
    if (etape.controle && etape.controle.actif) {
      if (!etape.controle.nature) ajouter("alerte", "regle.controle.sans_nature", { i });
      if (!etape.controle.critere.trim()) ajouter("alerte", "regle.controle.sans_critere", { i });
      if (etape.alternatives.length === 0) ajouter("alerte", "regle.controle.sans_suite", { i });
    }

    // Contrainte de délai ou de coût : le cercle du logigramme s'accompagne d'un court texte (« en moins de 48 h »).
    if (etape.contrainte && etape.contrainte.actif && !etape.contrainte.texte.trim()) ajouter("alerte", "regle.contrainte.sans_texte", { i });
    // Action corrective : un contrôle doit y mener (suite « non conforme »).
    if (etape.correctrice && !procedure.etapes.some((x) => x.controle && x.controle.actif && x.alternatives.some((a) => a.vers === etape.id))) {
      ajouter("alerte", "regle.correctrice.sans_controle", { i });
    }
    // Opérateur d'entrée (ET / OU) : il n'a de sens que si plusieurs flèches arrivent sur l'instruction (la suite normale + un renvoi).
    if (etape.operateurEntree && !procedure.etapes.some((x) => x.alternatives.some((a) => a.vers === etape.id))) {
      ajouter("alerte", "regle.entree.sans_renvoi", { i });
    }

    // Décision : la suite normale et chaque alternative portent un nom (Oui/Non, Conforme…) et une destination.
    // Quand les suites sont simultanées (ET), le nom des cas n'est pas nécessaire.
    if (etape.alternatives.length > 0) {
      if (etape.operateurSortie !== "et" && (!etape.condition.trim() || etape.alternatives.some((a) => !a.condition.trim()))) ajouter("alerte", "regle.decision.cas_sans_nom", { i });
      if (etape.alternatives.some((a) => !a.vers)) ajouter("alerte", "regle.decision.destination_absente", { i });
      if (etape.alternatives.some((a) => a.vers === etape.id)) ajouter("alerte", "regle.decision.vers_soi", { i });
      const suivante = procedure.etapes[index + 1];
      if (suivante && etape.alternatives.some((a) => a.vers === suivante.id)) ajouter("alerte", "regle.decision.meme_suite", { i });
    }

    // Instruction collaborative : le responsable + les participants doivent occuper des colonnes
    // voisines (3 au maximum), sans colonne intermédiaire qui ne participe pas.
    if (etape.participants.length > 0) {
      etape.participants.forEach((id) => {
        if (!cols.some((c) => c.id === id)) {
          const role = procedure.roles.find((r) => r.id === id);
          ajouter("alerte", "regle.collab.sans_colonne", { i, nom: role ? role.nom : id });
        }
      });
      const indices = [etape.roleId, ...etape.participants]
        .map((id) => cols.findIndex((c) => c.id === id))
        .filter((k) => k >= 0);
      const plus_petit = Math.min(...indices);
      const plus_grand = Math.max(...indices);
      const largeur = plus_grand - plus_petit + 1;
      if (largeur > 3) ajouter("alerte", "regle.collab.trop_large", { i, n: largeur });
      for (let k = plus_petit; k <= plus_grand; k += 1) {
        if (!indices.includes(k)) ajouter("alerte", "regle.collab.colonne_traversee", { i, nom: cols[k].nom });
      }
    }
  });

  procedure.roles.forEach((role) => {
    // Un rôle qui n'est que A, C ou I (R.A.C.I.) n'a pas de colonne : ce n'est pas une anomalie.
    const raciSeul = procedure.etapes.some((e) => e.raci && e.raci[role.id]);
    if (role.type !== "externe" && procedure.etapes.length && !cols.includes(role) && !raciSeul) {
      ajouter("alerte", "regle.role.sans_etape", { nom: role.nom });
    }
  });

  if (constats.length === 0 && n > 0) ajouter("ok", "diag.ok");
  return constats;
}
