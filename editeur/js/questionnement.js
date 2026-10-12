// questionnement.js — le QUESTIONNEMENT EN 11 POINTS : les questions qu'on se pose pour écrire une instruction (livre, chapitres 6 et 7),
// utilisées ici comme PISTES DE CONTRÔLE. Rien n'est affiché sous forme de tableau : le module répond seulement « quels points sont
// respectés, et pour quelles instructions (procédure) ou opérations (instruction de travail) ne le sont-ils pas ? ».
//
//   1 Qui ?                          le rôle qui réalise l'instruction
//   2 Quoi ?                         l'action
//   3 Quelle information en entrée ? ce qui déclenche l'action
//   4 D'où vient-elle ?              le point de départ ou la procédure amont
//   5 De qui vient-elle ?            le rôle qui fournit l'information
//   6 Comment ?                      comment l'instruction est réalisée
//   7 Avec quoi ?                    les documents ou moyens nécessaires
//   8 Quelle information en sortie ? le résultat produit
//   9 Vers quoi ?                    la suite ou la procédure aval
//  10 Vers qui ?                     le rôle qui reçoit le résultat
//  11 Sous quelles contraintes ?     délais, coûts, contrôles ou exigences
//
// Gravité (décision du 03/10/2026) : ERREUR pour les points essentiels (1, 2, 3, 4, 5, 8, 9, 10 : sans eux l'instruction n'est pas
// définie ; l'erreur empêche de valider la synthèse), ALERTE pour « Comment ? », « Avec quoi ? » et « Sous quelles contraintes ? »
// (ce qui peut légitimement être absent : une instruction simple n'a pas toujours de moyen ni de contrainte particulière).
//
// Ce que chaque point regarde dans le document — l'information qui se déduit de l'enchaînement n'est pas redemandée :
//   - entre deux instructions, la provenance et la destination sont l'instruction précédente / suivante (et son rôle) ;
//   - la première reçoit son information du début (fait déclencheur) ou de l'action amont, la dernière la donne à la fin ou à l'action aval.
// Le module ne dessine rien et ne touche pas à la page : il lit une procédure (ou une instruction de travail) et répond par des listes.
import { t } from "./i18n.js"; // utilisé uniquement par le helper d'affichage constatsNonApplicables (les fonctions d'évaluation restent sans i18n).

export const POINTS = [
  { n: 1, cle: "qui", gravite: "erreur" },
  { n: 2, cle: "quoi", gravite: "erreur" },
  { n: 3, cle: "entree", gravite: "erreur" },
  { n: 4, cle: "dou", gravite: "erreur" },
  { n: 5, cle: "dequi", gravite: "erreur" },
  { n: 6, cle: "comment", gravite: "alerte" },
  { n: 7, cle: "avec", gravite: "alerte" },
  { n: 8, cle: "sortie", gravite: "erreur" },
  { n: 9, cle: "versquoi", gravite: "erreur" },
  { n: 10, cle: "versqui", gravite: "erreur" },
  { n: 11, cle: "contraintes", gravite: "alerte" },
];

const plein = (v) => !!v && String(v).trim() !== "";

// Un outil nommé ; un document (formulaire, enregistrement, instruction…) explique en partie « comment » on fait.
const outilsNommes = (outils) => (outils || []).filter((o) => plein(o.nom));

// Les entrées de la procédure : une liste d'indices d'instructions (1, 2, 3…) pour chaque point non respecté.
function evaluerProcedure(p) {
  const etapes = p.etapes;
  const n = etapes.length;
  const m = p.meta;
  const amont = m.amont || {};
  const aval = m.aval || {};
  const role = (id) => p.roles.find((r) => r.id === id);
  const roleNomme = (id) => !!id && !!role(id) && plein(role(id).nom);
  const manquants = Object.fromEntries(POINTS.map((pt) => [pt.n, []]));
  const na = Object.fromEntries(POINTS.map((pt) => [pt.n, []])); // points jugés « sans objet » (alertes seulement)
  etapes.forEach((e, k) => {
    const i = k + 1;
    const premiere = k === 0;
    const derniere = k === n - 1;
    const suivante = etapes[k + 1];
    const precedente = etapes[k - 1];
    const non = (pt) => manquants[pt].push(i);

    const so = e.sansObjet || {};
    // Une alerte jugée « sans objet » pour cette instruction ne compte plus comme manquante : elle va dans nonApplicables (résumé discret).
    const nonOuSansObjet = (pt, cle) => (so[cle] ? na[pt].push(i) : non(pt));

    if (!roleNomme(e.roleId)) non(1);
    if (!plein(e.libelle)) non(2);
    if (!plein(e.entree) && !(premiere && plein(amont.information))) non(3);
    // D'où : la 1re instruction part du début ou de l'action amont ; les autres, de l'instruction précédente.
    if (premiere && !plein(m.declencheur) && !plein(amont.texte)) non(4);
    // De qui : le rôle saisi, sinon celui de l'instruction précédente ; pour la 1re, le rôle de l'action amont.
    if (!plein(e.entreeDe) && !(precedente ? roleNomme(precedente.roleId) : plein(amont.role))) non(5);
    // Comment : une instruction de travail (niveau 3), une sous-procédure, ou un document (mode opératoire, formulaire, enregistrement).
    const documents = outilsNommes(e.outils).some((o) => o.type === "document");
    if (!(e.niveau3 && e.niveau3.actif) && !(e.sousProcedure && e.sousProcedure.actif) && !documents) nonOuSansObjet(6, "comment");
    if (outilsNommes(e.outils).length === 0) nonOuSansObjet(7, "avec");
    if (!plein(e.sortie) && !(derniere && plein(aval.information))) non(8);
    // Vers quoi : la suivante (et, en cas de décision, chaque cas va quelque part, fin comprise) ; pour la dernière, aussi la fin ou l'action aval.
    const destinationsDecision = (e.alternatives || []).every((a) => !!a.vers);
    if (derniere ? !((plein(m.fin) || plein(aval.texte)) && destinationsDecision) : !destinationsDecision) non(9);
    // Vers qui : le rôle saisi, sinon celui de l'instruction suivante ; pour la dernière, celui de l'action aval.
    if (!plein(e.versQui) && !(suivante ? roleNomme(suivante.roleId) : plein(aval.role))) non(10);
    // Contraintes : un délai ou un coût, un contrôle, un risque maîtrisé, un indicateur ou un contrat d'interface.
    const contrainte = e.contrainte && e.contrainte.actif && plein(e.contrainte.texte);
    const controle = e.controle && e.controle.actif && plein(e.controle.critere);
    const risque = (e.risques || []).some((r) => plein(r.risque) && plein(r.mesure));
    const indicateur = e.indicateur && e.indicateur.actif && plein(e.indicateur.nom);
    const contrat = e.contrat && e.contrat.actif && plein(e.contrat.reference);
    if (!(contrainte || controle || risque || indicateur || contrat)) nonOuSansObjet(11, "contraintes");
  });
  return { unites: n, manquants, nonApplicables: na };
}

// Instruction de travail : un seul rôle pour tout le document ; chaque opération est une « instruction » du questionnement.
function evaluerInstruction(p) {
  const ops = p.it.operations;
  const n = ops.length;
  const m = p.meta;
  const amont = m.amont || {};
  const aval = m.aval || {};
  const manquants = Object.fromEntries(POINTS.map((pt) => [pt.n, []]));
  const na = Object.fromEntries(POINTS.map((pt) => [pt.n, []])); // points jugés « sans objet » (alertes seulement)
  let globaux = [];
  if (n > 0 && !plein(p.it.role.nom)) { manquants[1] = ops.map((_, k) => k + 1); globaux = [1]; }
  ops.forEach((op, k) => {
    const i = k + 1;
    const premiere = k === 0;
    const derniere = k === n - 1;
    const non = (pt) => manquants[pt].push(i);
    const so = op.sansObjet || {};
    const nonOuSansObjet = (pt, cle) => (so[cle] ? na[pt].push(i) : non(pt));
    if (!plein(op.libelle)) non(2);
    // L'information d'une flèche est celle de la sortie de l'opération précédente, ou l'entrée de la suivante (render3.js, infoFleche) :
    // pour les opérations suivantes, l'entrée est la sortie de l'opération d'avant, contrôlée au point 8 (une flèche, un seul constat).
    if (premiere && !(plein(op.entree) || plein(amont.information))) non(3);
    if (premiere && !plein(m.declencheur) && !plein(amont.texte)) non(4);
    // Le rôle de provenance n'existe que si l'action amont est décrite (le bloc « amont » est facultatif) ; décrite, elle le demande.
    if (premiere && plein(amont.texte) && !plein(amont.role)) non(5);
    // « Comment ? » : au niveau 3, l'opération EST la manière de faire ; le point est donc toujours tenu (le libellé vide est signalé au point 2).
    if (outilsNommes(op.outils).length === 0) nonOuSansObjet(7, "avec");
    if (derniere ? !(plein(op.sortie) || plein(aval.information)) : !(plein(op.sortie) || plein(ops[k + 1].entree))) non(8);
    if (derniere && !(plein(m.fin) || plein(aval.texte))) non(9);
    if (derniere && plein(aval.texte) && !plein(aval.role)) non(10);
    // Contraintes : un délai ou un coût, un contrôle, une vigilance ou l'enregistrement d'un document.
    const contrainte = op.contrainte && op.contrainte.actif && plein(op.contrainte.texte);
    if (!(contrainte || op.controles.length > 0 || op.vigilance || op.enregistrement)) nonOuSansObjet(11, "contraintes");
  });
  return { unites: n, manquants, globaux, nonApplicables: na };
}

// Le résultat complet : { type, unites, points: [{ n, cle, gravite, manquants: [indices], global }], respectes }
// « respectes » : les 11 points sont tenus pour toutes les instructions (faux tant que le déroulé est vide).
export function questionnement(p) {
  const instruction = p.meta.typeDocument === "instruction";
  const { unites, manquants, globaux = [], nonApplicables = {} } = instruction ? evaluerInstruction(p) : evaluerProcedure(p);
  const points = POINTS.map((pt) => ({ ...pt, manquants: manquants[pt.n], nonApplicables: nonApplicables[pt.n] || [], global: globaux.includes(pt.n) }));
  return { type: instruction ? "instruction" : "procedure", unites, points, respectes: unites > 0 && points.every((pt) => pt.manquants.length === 0) };
}

// Les constats au format des règles : { gravite, cle, params } ; le texte se fait par t(cle, params).
// cle : « quest.<procedure|instruction>.<point> » ; params.liste : « 1, 3, 4 » (absent quand le point concerne tout le document).
export function constatsQuestionnement(p) {
  const q = questionnement(p);
  if (q.unites === 0) return [];
  return q.points.filter((pt) => pt.manquants.length > 0).map((pt) => ({
    gravite: pt.gravite,
    cle: `quest.${q.type}.${pt.cle}`,
    params: pt.global ? {} : { liste: pt.manquants.join(", ") },
  }));
}

// Résumé DISCRET des alertes jugées « sans objet » (une seule ligne, gravité « sansobjet », non comptée dans erreurs/alertes).
// Ex. « Jugés non applicables : Comment (2, 4, 5) · Avec quoi (3) ». Vide s'il n'y en a aucun.
export function constatsNonApplicables(p) {
  const q = questionnement(p);
  if (q.unites === 0) return [];
  const parts = q.points
    .filter((pt) => pt.nonApplicables.length > 0)
    .map((pt) => `${t("quest.na." + pt.cle)} (${pt.nonApplicables.join(", ")})`);
  return parts.length ? [{ gravite: "sansobjet", cle: "quest.na.resume", params: { liste: parts.join(" · ") } }] : [];
}

// Constats déjà couverts, point pour point, par une règle plus ancienne : on ne montre pas deux fois la même chose.
// (règle plus ancienne → point du questionnement ; elle disparaît seulement quand ce point est lui-même signalé)
const DOUBLONS = {
  "regle.etape.sans_role": 1, "regle.etape.libelle_vide": 2, "regle.etape.sans_entree": 3, "regle.etape.sans_sortie": 8,
  "regle.debut.manquant": 4, "regle.fin.manquante": 9,
  "regle3.role.absent": 1, "regle3.operation.libelle_vide": 2, "regle3.operation.sans_entree": 3, "regle3.operation.sans_sortie": 8,
  "regle3.debut.manquant": 4, "regle3.fin.manquante": 9,
  "regle3.raccord.amont_sans_role": 5, "regle3.raccord.aval_sans_role": 10, "regle.decision.destination_absente": 9,
};

export function sansDoublons(constats, p) {
  const q = questionnement(p);
  if (q.unites === 0) return constats;
  const signales = new Set(q.points.filter((pt) => pt.manquants.length > 0).map((pt) => pt.n));
  return constats.filter((c) => !(c.cle in DOUBLONS && signales.has(DOUBLONS[c.cle])));
}
