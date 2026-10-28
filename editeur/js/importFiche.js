// importFiche.js — IMPORT d'une FICHE DE COLLECTE Excel. Deux modèles sont lus :
//   - FC-QUA-01 « Fiche de collecte des données — rédaction Qualigramme » (onglets Procedure_N2, Synthese_Validation…) ;
//   - FC-JAL, la fiche allégée de Jalonia (scripts/fiche-collecte/construire-fiche.py, téléchargeable depuis la page Documents) :
//     onglet « Déroulé » (colonne « Type », décision en une colonne « Suite » : « Oui → 5 ; Non → 3 », « Code IT » seul),
//     onglet « Points ouverts » ; risques et indicateurs seulement dans leur onglet.
// Une fiche donne UNE procédure (niveau 2) et une instruction de travail (niveau 3) par onglet d'instruction.
//   Cadrage             → identification, déclencheur, fin ; sections Objet, Domaine d'application, Références, Définitions
//   Acteurs             → rôles (nom, service, interne / externe, responsabilités)
//   Procedure_N2        → instructions du logigramme : acteur, autres acteurs (informés), entrées / sorties, supports et outils,
//                         délai, contrôle, décision Oui / Non (renvois), niveau 3 (code IT) ; risques et indicateur de la ligne
//                         s'ils ne sont pas déjà dans Indicateurs_Risques
//   Documents           → section 10 (enregistrements) et section 3 (références)
//   Indicateurs_Risques → indicateur et risques cotés (gravité × probabilité) de l'opération indiquée — prioritaires
//   onglets « IT »      → instructions de travail : rôle, déclencheur, résultat, opérations (« Comment ? », moyens,
//                         autocontrôles et actions correctives, enregistrements)
//   Synthese_Validation → points ouverts, repris dans le rapport (pas dans le document)
// Les lignes « À confirmer » / « À compléter » sont importées et signalées. Tout passe ensuite par nettoyer() du store.
// Les colonnes sont reconnues par leur TITRE (pas par leur lettre) : une colonne déplacée reste lue.
import { lireClasseur } from "./xlsx.js";
import {
  nouvelleProcedure, nouvelleEtape, nouvelleAlternative, nouveauRisque, nouvelleOperation, nouveauControle, nouvelleCorrective,
  instructionDepuisEtape, nouvelId, MODELES_TABLEAU, MAX_RISQUES, MAX_ALTERNATIVES,
} from "./model.js";
import { t } from "./i18n.js";

const MAX_OUTILS = 6;
const MAX_OPERATIONS_IT = 20;
const ADJECTIF_UNITE = /^(direction|service|d[ée]partement|[ée]quipe|comit[ée]|cellule|division|p[oô]le|toutes?)\b/i;

// « Élément d'entrée » → « element d'entree » : comparaison sans accents, casse ni espaces multiples.
const norme = (s) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[\u2018\u2019`]/g, "'").toLowerCase().replace(/\s+/g, " ").trim();
const plat = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const vide = (s) => /^[-–—\s]*$/.test(String(s ?? ""));
const valeur = (s) => (vide(s) ? "" : plat(s));

/** Découpe une liste « A, B ; C » en respectant les parenthèses (« Service demandeur (DG, Exploitation) » reste entier). */
export function liste(s) {
  const morceaux = [];
  let profondeur = 0;
  let courant = "";
  for (const c of String(s ?? "")) {
    if (c === "(") profondeur += 1;
    if (c === ")") profondeur = Math.max(0, profondeur - 1);
    if ((c === "," || c === ";") && profondeur === 0) {
      morceaux.push(courant);
      courant = "";
    } else courant += c;
  }
  morceaux.push(courant);
  return morceaux.map(valeur).filter(Boolean);
}

/** Numéros d'opération : « 4 », « 4,5 », « 1 à 9 », « 2 ou Fin », « Opération n° 4 » → [4, 5…] (« fin » à part). */
export function numeros(s) {
  const texte = norme(s);
  const sortie = [];
  for (const m of texte.matchAll(/(\d+)\s*(?:a|-)\s*(\d+)|(\d+)/g)) {
    if (m[1]) for (let n = Number(m[1]); n <= Math.min(Number(m[2]), Number(m[1]) + 100); n += 1) sortie.push(n);
    else sortie.push(Number(m[3]));
  }
  return sortie;
}

// ---------- Repérage des onglets et des colonnes ----------
const feuille = (feuilles, ...noms) => feuilles.find((f) => noms.some((n) => norme(f.nom) === norme(n)));

/**
 * La ligne d'en-tête d'un tableau : la première qui contient tous les titres demandés (début de titre, sans accents). Un titre
 * peut être une liste de variantes (selon le modèle de fiche) : l'une d'elles suffit.
 */
function entete(grille, ...titres) {
  for (let i = 0; i < grille.length; i += 1) {
    const l = (grille[i] || []).map(norme);
    if (titres.every((tt) => [].concat(tt).some((v) => l.some((c) => c.startsWith(norme(v)))))) return i;
  }
  return -1;
}

/** Décision en une colonne (fiche FC-JAL) : « Oui → 5 ; Non → 3 », « Non → Fin », « Oui -> 2 » → { oui: "5", non: "3" }. */
export function lireSuite(s) {
  const r = { oui: "", non: "" };
  for (const m of norme(s).matchAll(/\b(oui|non)\b\s*(?:→|->|=>|:|=)?\s*(?:op(?:eration)?\.?\s*(?:n°)?\s*)?(fin|\d+)/g)) r[m[1]] = m[2];
  return r;
}

/** Index de colonne d'après le début de son titre (premier titre trouvé). */
function colonne(ligneEntete, ...titres) {
  const l = ligneEntete.map(norme);
  for (const tt of titres) {
    const i = l.findIndex((c) => c.startsWith(norme(tt)));
    if (i >= 0) return i;
  }
  return -1;
}

const cellule = (l, i) => (i >= 0 ? valeur(l[i]) : "");

/**
 * Lignes d'un tableau : après l'en-tête, jusqu'au titre de section suivant (« C. VALIDATION… » en colonne A) ; seules celles
 * dont la colonne « clé » est remplie.
 */
const TITRE_SECTION = /^[A-Z]\.\s/;
function lignesDuTableau(grille, iEntete, iCle, arret = null) {
  const lignes = [];
  for (let i = iEntete + 1; i < grille.length; i += 1) {
    const l = grille[i] || [];
    if (TITRE_SECTION.test(String(l[0] ?? "").trim()) || (arret && arret(l))) break;
    if (cellule(l, iCle)) lignes.push(l);
  }
  return lignes;
}

/**
 * Libellé / valeur d'un formulaire (Cadrage, cadrage d'une IT) : libellé en colonne `iLibelle`, aide en colonne C, valeur à partir
 * de la colonne D (dernière cellule remplie) — l'aide n'est jamais prise pour la valeur.
 */
const COLONNE_VALEUR = 3;
function champs(grille, iLibelle) {
  const m = new Map();
  grille.forEach((l) => {
    const libelle = norme(l && l[iLibelle]);
    if (!libelle) return;
    const remplies = (l || []).map((c, j) => [j, c]).filter(([j, c]) => j >= Math.max(COLONNE_VALEUR, iLibelle + 1) && !vide(c));
    if (remplies.length && !m.has(libelle)) m.set(libelle, plat(remplies[remplies.length - 1][1]));
  });
  return (debut) => {
    const d = norme(debut);
    for (const [k, v] of m) if (k.startsWith(d)) return v;
    return "";
  };
}

const paragraphe = (texte) => ({ id: nouvelId("b"), type: "p", texte });
const tableau = (section, lignes) => ({
  id: nouvelId("b"), type: "tableau", colonnes: MODELES_TABLEAU[section].map((k) => t(`col.${section}.${k}`)), lignes,
});

// ---------- Interprétation ----------
/**
 * Les feuilles lues par xlsx.js → { procedure, instructions, rapport }. `procedure` et chaque instruction sont « brutes » : le store
 * les nettoie (nettoyer) avant de les charger ou de les enregistrer. Rapport : { gravite: "erreur" | "alerte" | "info" | "ok", cle, params }.
 */
export function interpreterFiche(feuilles) {
  const rapport = [];
  const cadrage = feuille(feuilles, "Cadrage");
  const acteurs = feuille(feuilles, "Acteurs");
  const n2 = feuille(feuilles, "Procedure_N2", "Procédure_N2", "Procedure N2", "Déroulé", "Deroule");
  if (!cadrage || !n2) return { procedure: null, instructions: [], rapport: [{ gravite: "erreur", cle: "fiche.pas_modele" }] };

  const p = nouvelleProcedure();
  p.meta.typeDocument = "procedure";
  p.meta.niveau = 2;

  // --- Cadrage : libellé en colonne B, valeur dans la dernière colonne remplie de la ligne. ---
  const c = champs(cadrage.grille, 1);
  p.meta.organisation = c("organisation");
  p.meta.direction = c("direction");
  p.meta.processus = c("processus de rattachement");
  p.meta.pilote = c("pilote");
  p.meta.titre = c("intitule de la procedure");
  p.meta.reference = c("code envisage");
  p.meta.declencheur = c("evenement declencheur");
  p.meta.fin = c("resultat final");
  const objet = c("objet");
  if (objet) p.corps.objet.push(paragraphe(objet));
  const domaine = c("domaine d'application");
  if (domaine) p.corps.domaine.push(paragraphe(domaine));
  const exclusions = c("exclusions");
  if (exclusions) p.corps.domaine.push(paragraphe(`${t("fiche.exclusions")} : ${exclusions}`));
  const exigences = c("exigences applicables");
  if (exigences) p.corps.references.push(paragraphe(`${t("fiche.exigences")} : ${exigences}`));
  const definitions = c("definitions");
  if (definitions) p.corps.definitions.push(paragraphe(definitions));
  if (!p.meta.titre) rapport.push({ gravite: "alerte", cle: "fiche.titre_absent" });
  if (!p.meta.declencheur) rapport.push({ gravite: "alerte", cle: "fiche.declencheur_absent" });
  if (!p.meta.fin) rapport.push({ gravite: "alerte", cle: "fiche.fin_absente" });

  // --- Acteurs → rôles. ---
  const roles = new Map(); // nom (normé) ou code (normé) → rôle
  const creerRole = (nom, { type = "", service = "", responsabilite = "", code = "" } = {}) => {
    const role = { id: nouvelId("r"), nom, type: type || (ADJECTIF_UNITE.test(nom) ? "unite" : "individuel"), service, responsabilite };
    p.roles.push(role);
    roles.set(norme(nom), role);
    if (code) roles.set(norme(code), role);
    return role;
  };
  if (acteurs) {
    const iE = entete(acteurs.grille, "intitule du role");
    if (iE >= 0) {
      const e = acteurs.grille[iE];
      const [iCode, iNom, iService, iType, iResp] = [colonne(e, "code role", "code"), colonne(e, "intitule du role"), colonne(e, "service"), colonne(e, "interne"), colonne(e, "responsabilit")];
      lignesDuTableau(acteurs.grille, iE, iNom).forEach((l) => {
        const nom = cellule(l, iNom);
        if (roles.has(norme(nom))) return;
        creerRole(nom, {
          type: /^externe/i.test(cellule(l, iType)) ? "externe" : "", service: cellule(l, iService), responsabilite: cellule(l, iResp), code: cellule(l, iCode),
        });
      });
    }
  }
  if (p.roles.length === 0) rapport.push({ gravite: "alerte", cle: "fiche.roles_absents" });
  const roleDe = (nom) => {
    if (!nom) return null;
    let r = roles.get(norme(nom));
    if (!r) {
      r = creerRole(nom);
      rapport.push({ gravite: "info", cle: "fiche.role_ajoute", params: { nom } });
    }
    return r;
  };

  // --- Procedure_N2 → instructions. ---
  const iE2 = entete(n2.grille, "operation", ["acteur responsable", "acteur"]);
  const numerosEtapes = new Map(); // n° de la fiche → étape
  const aConfirmer = [];
  const pointsN2 = [];
  const candidats = new Map(); // étape → { risques: [{risque, mesure}], indicateur: "" } (colonnes V, W, X)
  if (iE2 < 0) {
    rapport.push({ gravite: "erreur", cle: "fiche.instructions_absentes" });
  } else {
    const e = n2.grille[iE2];
    const col = {
      // Titres des deux modèles : FC-QUA-01 d'abord, puis FC-JAL (« Type », « Reçoit », « De qui », « Produit », « Pour qui »…).
      n: colonne(e, "n°", "n "), op: colonne(e, "operation"), symbole: colonne(e, "symbole", "type"), acteur: colonne(e, "acteur responsable", "acteur"),
      autres: colonne(e, "autres acteurs"), delai: colonne(e, "delai"), entree: colonne(e, "elements d'entree", "element d'entree", "recoit"),
      fournisseur: colonne(e, "fournisseur", "de qui"), sortie: colonne(e, "elements de sortie", "element de sortie", "produit"), client: colonne(e, "client", "pour qui"),
      support: colonne(e, "support", "documents"), outils: colonne(e, "outils"), question: colonne(e, "question"), oui: colonne(e, "si oui"),
      non: colonne(e, "si non"), suite: colonne(e, "suite"), n3: colonne(e, "a detailler"), codeIt: colonne(e, "code it"), risque: colonne(e, "risque"),
      maitrise: colonne(e, "moyen de maitrise"), indicateur: colonne(e, "indicateur"), commentaires: colonne(e, "commentaires"), statut: colonne(e, "statut"),
    };
    const lignes = lignesDuTableau(n2.grille, iE2, col.op);
    const renvois = []; // [étape, oui, non, numéro]
    lignes.forEach((l, k) => {
      const numero = numeros(cellule(l, col.n))[0] ?? k + 1;
      const symbole = norme(cellule(l, col.symbole));
      const libelle = cellule(l, col.op);
      // Début et Fin : ce sont le déclencheur et la fin de la procédure, pas des instructions.
      if (symbole.startsWith("debut")) { if (!p.meta.declencheur) p.meta.declencheur = libelle; return; }
      if (symbole.startsWith("fin")) { if (!p.meta.fin) p.meta.fin = libelle; return; }
      const role = roleDe(cellule(l, col.acteur));
      const etape = nouvelleEtape({
        roleId: role ? role.id : "", libelle,
        entree: cellule(l, col.entree), entreeDe: cellule(l, col.fournisseur), sortie: cellule(l, col.sortie), versQui: cellule(l, col.client),
      });
      // Autres acteurs : informés (R.A.C.I. « I ») s'ils sont des rôles de la fiche, sinon cités en texte.
      liste(cellule(l, col.autres)).forEach((nom) => {
        const r = roles.get(norme(nom));
        if (r && r.id !== etape.roleId) etape.raci[r.id] = "I";
        else if (!r) etape.informes.push(nom);
      });
      const outils = [
        ...liste(cellule(l, col.support)).map((nom) => ({ id: nouvelId("o"), type: "document", nom })),
        ...liste(cellule(l, col.outils)).map((nom) => ({ id: nouvelId("o"), type: "materiel", nom })),
      ];
      etape.outils = outils.filter((o, i) => outils.findIndex((x) => norme(x.nom) === norme(o.nom)) === i).slice(0, MAX_OUTILS);
      const delai = cellule(l, col.delai);
      if (delai) etape.contrainte = { actif: true, nature: "delai", texte: delai.slice(0, 40) };
      const question = cellule(l, col.question);
      if (symbole.startsWith("controle")) {
        etape.controle = { actif: true, nature: "", critere: question || cellule(l, col.maitrise), enregistrement: cellule(l, col.support) };
      } else if (symbole.startsWith("attente") && !delai) {
        etape.contrainte = { actif: true, nature: "delai", texte: "" };
      } else if (symbole.startsWith("renvoi")) {
        etape.sousProcedure = { actif: true, code: "" };
        rapport.push({ gravite: "alerte", cle: "fiche.sous_procedure", params: { n: numero } });
      } else if (symbole.startsWith("taches simultanees")) {
        etape.operateurSortie = "et";
      }
      // Suites de la décision : deux colonnes « Si OUI / Si NON » (FC-QUA-01) ou une colonne « Suite » (FC-JAL).
      const suite = col.suite >= 0 ? lireSuite(cellule(l, col.suite)) : { oui: cellule(l, col.oui), non: cellule(l, col.non) };
      if (col.suite >= 0 && cellule(l, col.suite) && !suite.oui && !suite.non) rapport.push({ gravite: "alerte", cle: "fiche.suite_illisible", params: { n: numero, suite: cellule(l, col.suite) } });
      if (question || suite.oui || suite.non) renvois.push([etape, suite.oui, suite.non, numero]);
      // Niveau 3 : « À détailler ? Oui » + code (FC-QUA-01), ou le code seul (FC-JAL).
      const codeIt = cellule(l, col.codeIt);
      if (col.n3 >= 0 ? /^oui/i.test(cellule(l, col.n3)) : Boolean(codeIt)) etape.niveau3 = { actif: true, code: codeIt, intitule: "" };
      candidats.set(etape, {
        risques: cellule(l, col.risque) ? [{ risque: cellule(l, col.risque), mesure: cellule(l, col.maitrise) }] : [],
        indicateur: cellule(l, col.indicateur),
      });
      if (/confirmer|completer/.test(norme(cellule(l, col.statut)))) aConfirmer.push(numero);
      if (cellule(l, col.commentaires)) pointsN2.push(`${numero} : ${cellule(l, col.commentaires)}`);
      p.etapes.push(etape);
      numerosEtapes.set(numero, etape);
    });
    // Décisions : la suite « normale » est l'instruction suivante (ou la fin) ; l'autre branche devient une alternative.
    renvois.forEach(([etape, oui, non, numero]) => {
      const i = p.etapes.indexOf(etape);
      const naturelle = p.etapes[i + 1] || "fin";
      const cible = (s) => (/^fin/i.test(norme(s)) ? "fin" : numerosEtapes.get(numeros(s)[0]) || null);
      const [cOui, cNon] = [cible(oui), cible(non)];
      if (oui && !cOui) rapport.push({ gravite: "alerte", cle: "fiche.renvoi_inconnu", params: { n: numero, vers: oui } });
      if (non && !cNon) rapport.push({ gravite: "alerte", cle: "fiche.renvoi_inconnu", params: { n: numero, vers: non } });
      const branches = [[t("fiche.oui"), cOui], [t("fiche.non"), cNon]].filter(([, x]) => x);
      const normale = branches.find(([, x]) => x === naturelle);
      etape.condition = normale ? normale[0] : "";
      branches.filter((b) => b !== normale).slice(0, MAX_ALTERNATIVES).forEach(([condition, x]) => {
        etape.alternatives.push(nouvelleAlternative({ condition, vers: x === "fin" ? "fin" : x.id }));
      });
    });
  }
  const controlesSansNature = p.etapes.filter((e) => e.controle.actif).map((e) => p.etapes.indexOf(e) + 1);
  if (controlesSansNature.length) rapport.push({ gravite: "alerte", cle: "fiche.controles", params: { liste: controlesSansNature.join(", ") } });
  if (aConfirmer.length) rapport.push({ gravite: "alerte", cle: "fiche.a_confirmer", params: { liste: aConfirmer.join(", ") } });

  // --- Indicateurs_Risques : prioritaires sur les colonnes de Procedure_N2. ---
  const etapeDe = (s) => numeros(s).map((n) => numerosEtapes.get(n)).find(Boolean) || null;
  const ir = feuille(feuilles, "Indicateurs_Risques", "Indicateurs Risques", "Risques_Indicateurs", "Risques Indicateurs");
  if (ir) {
    const iI = entete(ir.grille, "indicateur", "formule");
    const iR = entete(ir.grille, "risque", "cause");
    if (iI >= 0) {
      const e = ir.grille[iI];
      const [cN, cF, cC, cFr, cOp] = [colonne(e, "indicateur"), colonne(e, "formule"), colonne(e, "cible"), colonne(e, "frequence"), colonne(e, "op")];
      lignesDuTableau(ir.grille, iI, cN, (l) => iR >= 0 && l === ir.grille[iR]).forEach((l) => {
        const etape = etapeDe(cellule(l, cOp));
        const nom = cellule(l, cN);
        if (!etape) { rapport.push({ gravite: "alerte", cle: "fiche.indicateur_sans_op", params: { nom } }); return; }
        if (etape.indicateur.actif) { rapport.push({ gravite: "alerte", cle: "fiche.indicateur_en_trop", params: { nom, n: p.etapes.indexOf(etape) + 1 } }); return; }
        etape.indicateur = { actif: true, nom, formule: cellule(l, cF), cible: cellule(l, cC), frequence: cellule(l, cFr) };
      });
    }
    if (iR >= 0) {
      const e = ir.grille[iR];
      const [cR, cCa, cG, cP, cOp, cM] = [colonne(e, "risque"), colonne(e, "cause"), colonne(e, "gravite"), colonne(e, "probabilite"), colonne(e, "op"), colonne(e, "mesure")];
      lignesDuTableau(ir.grille, iR, cR).forEach((l) => {
        const risque = cellule(l, cR);
        if (/^seuils?\b/i.test(norme(risque))) return; // ligne de légende sous le tableau
        const etape = etapeDe(cellule(l, cOp));
        if (!etape) { rapport.push({ gravite: "alerte", cle: "fiche.risque_sans_op", params: { risque } }); return; }
        if (etape.risques.length >= MAX_RISQUES) { rapport.push({ gravite: "alerte", cle: "fiche.risque_en_trop", params: { risque, n: p.etapes.indexOf(etape) + 1 } }); return; }
        etape.risques.push(nouveauRisque({ risque, causes: cellule(l, cCa), gravite: cellule(l, cG), probabilite: cellule(l, cP), mesure: cellule(l, cM) }));
      });
    }
  }
  // Colonnes « Risque » et « Indicateur » de Procedure_N2 : seulement ce qui n'est pas déjà repris.
  for (const [etape, cand] of candidats) {
    cand.risques.forEach((r) => {
      if (etape.risques.length >= MAX_RISQUES || etape.risques.some((x) => norme(x.risque) === norme(r.risque))) return;
      etape.risques.push(nouveauRisque(r));
    });
    if (cand.indicateur && !etape.indicateur.actif) etape.indicateur = { actif: true, nom: cand.indicateur, formule: "", cible: "", frequence: "" };
  }

  // --- Documents → enregistrements (section 10) et références (section 3). ---
  const docs = feuille(feuilles, "Documents");
  if (docs) {
    const iD = entete(docs.grille, ["intitule du document", "intitule"], "nature");
    if (iD >= 0) {
      const e = docs.grille[iD];
      const [cCode, cNom, cNat, cSup, cLieu, cDuree, cModele] = [colonne(e, "code"), colonne(e, "intitule"), colonne(e, "nature"), colonne(e, "support"), colonne(e, "lieu"), colonne(e, "duree"), colonne(e, "modele")];
      const enregistrements = [];
      const references = [];
      const sansModele = [];
      lignesDuTableau(docs.grille, iD, cNom).forEach((l) => {
        const nom = [cellule(l, cCode), cellule(l, cNom)].filter(Boolean).join(" — ");
        const nature = norme(cellule(l, cNat));
        if (/^(enregistrement|formulaire)/.test(nature)) enregistrements.push([nom, cellule(l, cSup), cellule(l, cDuree), cellule(l, cLieu)]);
        else references.push([cellule(l, cNat), cellule(l, cCode), cellule(l, cNom)]);
        if (/^non/i.test(cellule(l, cModele))) sansModele.push(nom);
      });
      if (enregistrements.length) p.corps.enregistrements.push(tableau("enregistrements", enregistrements));
      if (references.length) p.corps.references.push(tableau("references", references));
      if (sansModele.length) rapport.push({ gravite: "info", cle: "fiche.modeles_manquants", params: { liste: sansModele.join(" ; ") } });
    }
  }

  // --- Onglets d'instruction de travail : ceux qui ont une ligne « Code IT ». ---
  const instructions = [];
  feuilles.forEach((f) => {
    if (!f.grille.some((l) => norme(l && l[0]) === "code it")) return;
    const v = champs(f.grille, 0);
    const code = v("code it");
    if (!code || /^ex\b/i.test(code)) return; // onglet modèle vide (ou exemple)
    const etape = p.etapes.find((x) => x.niveau3.actif && norme(x.niveau3.code) === norme(code)) || etapeDe(v("n° d'operation"));
    const titre = v("intitule de l'instruction");
    let it;
    if (etape) {
      etape.niveau3 = { actif: true, code, intitule: titre };
      it = instructionDepuisEtape(p, etape.id);
    } else {
      it = nouvelleProcedure();
      Object.assign(it.meta, { organisation: p.meta.organisation, direction: p.meta.direction, processus: p.meta.processus, pilote: p.meta.pilote, typeDocument: "instruction", niveau: 3, issueDe: p.meta.reference });
      rapport.push({ gravite: "alerte", cle: "fiche.it_sans_op", params: { code } });
    }
    it.meta.titre = titre || it.meta.titre;
    it.meta.reference = code;
    it.meta.declencheur = v("evenement declencheur");
    it.meta.fin = v("resultat attendu");
    it.it.role.nom = v("role executant") || it.it.role.nom;
    const iO = entete(f.grille, "operation", "comment");
    if (iO >= 0) {
      const e = f.grille[iO];
      const cc = {
        op: colonne(e, "operation"), comment: colonne(e, "comment"), avec: colonne(e, "avec quoi"), cle: colonne(e, "point cle"),
        auto: colonne(e, "autocontrole"), anomalie: colonne(e, "anomalie"), conduite: colonne(e, "conduite", "si anomalie"), securite: colonne(e, "securite"),
        enreg: colonne(e, "enregistrement"),
      };
      lignesDuTableau(f.grille, iO, cc.op).slice(0, MAX_OPERATIONS_IT).forEach((l) => {
        const commentaire = [
          cellule(l, cc.comment),
          cellule(l, cc.cle) ? `${t("fiche.point_cle")} : ${cellule(l, cc.cle)}` : "",
          cellule(l, cc.securite) ? `${t("fiche.securite")} : ${cellule(l, cc.securite)}` : "",
        ].filter(Boolean).join(" — ");
        const op = nouvelleOperation({
          libelle: cellule(l, cc.op), commentaire, enregistrement: Boolean(cellule(l, cc.enreg)),
          // À vigilance : une anomalie possible est décrite (FC-QUA-01) ; FC-JAL : « Si anomalie : que faire ? » est renseigné.
          vigilance: Boolean(cc.anomalie >= 0 ? cellule(l, cc.anomalie) : cellule(l, cc.conduite)),
          outils: liste(cellule(l, cc.avec)).slice(0, MAX_OUTILS).map((nom) => ({ id: nouvelId("o"), type: "document", nom })),
        });
        if (cellule(l, cc.conduite)) op.correctives.push(nouvelleCorrective({ libelle: cellule(l, cc.conduite) }));
        if (cellule(l, cc.auto)) {
          op.controles.push(nouveauControle({
            question: cellule(l, cc.auto), nature: cellule(l, cc.securite) ? "S" : "", enregistrement: op.enregistrement,
            correctives: op.correctives.map((m) => m.id),
          }));
        }
        it.it.operations.push(op);
      });
    }
    const ops = it.it.operations;
    if (ops.length) {
      if (!ops[0].entree) ops[0].entree = (etape && etape.entree) || it.meta.declencheur;
      if (!ops[ops.length - 1].sortie) ops[ops.length - 1].sortie = (etape && etape.sortie) || it.meta.fin;
    } else {
      rapport.push({ gravite: "alerte", cle: "fiche.it_sans_operation", params: { code } });
    }
    // Cadrage de l'instruction sans place sur la feuille niveau 3 : rappelé dans le rapport, à reporter.
    [["prerequis", "fiche.it.prerequis"], ["epi", "fiche.it.epi"], ["materiels", "fiche.it.materiels"], ["documents de reference", "fiche.it.documents"], ["objet", "fiche.it.objet"]].forEach(([k, cle]) => {
      const texte = v(k);
      if (texte) rapport.push({ gravite: "info", cle, params: { code, texte } });
    });
    instructions.push(it);
  });
  const sansFiche = p.etapes.filter((e) => e.niveau3.actif && !instructions.some((it) => norme(it.meta.reference) === norme(e.niveau3.code)));
  if (sansFiche.length) rapport.push({ gravite: "alerte", cle: "fiche.it_manquantes", params: { liste: sansFiche.map((e) => e.niveau3.code || e.libelle).join(", ") } });

  // --- Points ouverts (Synthese_Validation) et commentaires du déroulé : dans le rapport seulement. ---
  const synthese = feuille(feuilles, "Synthese_Validation", "Synthèse_Validation", "Points ouverts");
  if (synthese) {
    const iP = entete(synthese.grille, "point a clarifier");
    if (iP >= 0) {
      const e = synthese.grille[iP];
      const [cP, cOp, cSt] = [colonne(e, "point a clarifier"), colonne(e, "op"), colonne(e, "statut", "personne")];
      lignesDuTableau(synthese.grille, iP, cP).forEach((l) => {
        if (/\bclos\b/.test(norme(cellule(l, cSt)))) return;
        rapport.push({ gravite: "info", cle: "fiche.point_ouvert", params: { texte: cellule(l, cP), op: cellule(l, cOp) || "—" } });
      });
    }
  }
  pointsN2.forEach((texte) => rapport.push({ gravite: "info", cle: "fiche.commentaire", params: { texte } }));

  rapport.unshift({ gravite: "ok", cle: "fiche.resume", params: { roles: p.roles.length, etapes: p.etapes.length, it: instructions.length } });
  return { procedure: p, instructions, rapport };
}

/** Le fichier .xlsx → { procedure, instructions, rapport } (procedure : null si ce n'est pas une fiche de collecte). */
export async function importerFiche(tampon) {
  return interpreterFiche(await lireClasseur(tampon));
}
