// bpmn.js — échange d'une PROCÉDURE (niveau 2) au format BPMN 2.0 (OMG, espace de noms 20100524). Aucune interface ici :
// des fonctions testables sans navigateur (tests/bpmn.test.mjs).
//
// SOUS-ENSEMBLE DÉFINI (ce qui s'écrit en éléments BPMN standard, lisibles par tout outil BPMN) :
//   procédure           → processus (process) dans un participant (pool) ; titre = nom
//   rôles               → couloirs (lanes)
//   instructions        → tâches (task) ; sous-procédure → activité d'appel (callActivity)
//   fait déclencheur    → événement de début (startEvent) ; fin → événement de fin (endEvent)
//   enchaînement        → flux de séquence (sequenceFlow), nommé par l'information transmise (« sortie »)
//   décision (OU)       → passerelle exclusive (exclusiveGateway) : suite normale = flux par défaut, alternatives = autres flux
//   tâches simultanées  → passerelle parallèle (parallelGateway)
//   opérateur d'entrée  → passerelle de jonction (exclusive « OU », parallèle « ET ») quand plusieurs flux arrivent
//   + le dessin (BPMN DI) : couloirs, formes et flèches placés, pour qu'un outil BPMN affiche le diagramme.
// Tout ce que BPMN n'a pas (contrôle, contrainte, indicateur, contrat, R.A.C.I., risques et opportunités, outils, niveau 3,
// entrées, corps du document…) voyage dans des éléments d'extension (extensionElements, espace de noms Jalonia), au format
// JSON : un fichier exporté par l'application se réimporte SANS PERTE. Si un autre outil a modifié le diagramme, ce sont les
// éléments BPMN standard qui font foi (noms, couloirs, enchaînements) ; les extensions complètent le reste.
// IMPORT d'un BPMN venu d'ailleurs : le même sous-ensemble est repris, et un RAPPORT dit tout ce qui ne l'est pas.
// Ce n'est PAS une « compatibilité BPMN » générale : seul ce sous-ensemble est garanti, et il est vérifié contre le
// schéma XSD officiel (tests/bpmn).

import { nouvelleProcedure, nouvelleEtape, nouvelleAlternative, MAX_ALTERNATIVES } from "./model.js";
import { NOM_OUTIL } from "./config.js";

export const NS = Object.freeze({
  bpmn: "http://www.omg.org/spec/BPMN/20100524/MODEL",
  bpmndi: "http://www.omg.org/spec/BPMN/20100524/DI",
  dc: "http://www.omg.org/spec/DD/20100524/DC",
  di: "http://www.omg.org/spec/DD/20100524/DI",
  jalonia: "https://jalonia.mosa-apps.com/ns/bpmn/1",
});
export const FORMAT_EXTENSIONS = "1";
export const TAILLE_MAX_IMPORT = 10_000_000; // octets
export const MAX_ETAPES = 100; // comme store.js (nettoyer)
export const MAX_ROLES = 40;

/** Erreur d'échange BPMN : `cle` est une clé de traduction. */
export class ErreurBpmn extends Error {
  constructor(cle, params = {}) {
    super(cle);
    this.name = "ErreurBpmn";
    this.cle = cle;
    this.params = params;
  }
}

// =====================================================================================================================
// Écriture XML
// =====================================================================================================================

// Caractères interdits en XML 1.0 (contrôle, demi-caractères isolés) : retirés.
function texteXml(v) {
  return String(v ?? "").toWellFormed().replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "");
}
function echapper(v) {
  return texteXml(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
// Dans un attribut, un saut de ligne ou une tabulation écrits tels quels deviendraient des espaces à la lecture (normalisation
// XML des attributs) : on les écrit en références de caractères, qui, elles, sont conservées.
const echapperAttribut = (v) => echapper(v).replace(/\t/g, "&#9;").replace(/\n/g, "&#10;").replace(/\r/g, "&#13;");
const attrs = (o) => Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => ` ${k}="${echapperAttribut(v)}"`).join("");
const balise = (nom, a = {}, contenu = "") => (contenu ? `<${nom}${attrs(a)}>${contenu}</${nom}>` : `<${nom}${attrs(a)}/>`);

// Identifiant XML (NCName) à partir d'un identifiant de l'éditeur ([\w-], voir store.js).
const ncname = (prefixe, id) => `${prefixe}_${String(id).replace(/[^A-Za-z0-9_.-]/g, "_")}`;

function extension(nom, donnees) {
  return balise("bpmn:extensionElements", {}, balise(`jalonia:${nom}`, { format: FORMAT_EXTENSIONS }, echapper(JSON.stringify(donnees))));
}

// =====================================================================================================================
// Export
// =====================================================================================================================

// Le graphe BPMN d'une procédure : nœuds (événements, tâches, passerelles) et flux, dans l'ordre du dessin.
function construireGraphe(p) {
  const etapes = p.etapes;
  const ids = new Set(etapes.map((e) => e.id));
  const noeuds = [];
  const flux = [];
  let nFlux = 0;
  const relier = (source, cible, nom = "", parDefaut = false) => {
    const f = { id: `Flux_${++nFlux}`, source: source.id, cible: cible.id, nom, parDefaut };
    flux.push(f);
    return f;
  };
  // Combien de flux arrivent sur chaque instruction : la précédente (ou le début), plus les alternatives qui la visent.
  const arrivees = new Map(etapes.map((e) => [e.id, 1]));
  etapes.forEach((e) => e.alternatives.forEach((a) => { if (ids.has(a.vers) && a.vers !== e.id) arrivees.set(a.vers, arrivees.get(a.vers) + 1); }));

  const debut = { id: "Debut", type: "startEvent", nom: p.meta.declencheur, role: etapes[0] ? etapes[0].roleId : "" };
  const fin = { id: "Fin", type: "endEvent", nom: p.meta.fin, role: etapes.length ? etapes[etapes.length - 1].roleId : "" };
  noeuds.push(debut);
  const entree = new Map(); // id d'étape → premier nœud de l'étape (jonction ou tâche)
  const parEtape = etapes.map((e) => {
    const jonction = (e.operateurEntree === "et" || e.operateurEntree === "ou") && arrivees.get(e.id) >= 2
      ? { id: ncname("Jonction", e.id), type: e.operateurEntree === "et" ? "parallelGateway" : "exclusiveGateway", nom: "", role: e.roleId, jonction: true }
      : null;
    const tache = { id: ncname("Tache", e.id), type: e.sousProcedure && e.sousProcedure.actif ? "callActivity" : "task", nom: e.libelle, role: e.roleId, etape: e };
    const decisions = e.alternatives.filter((a) => a.vers === "fin" || (ids.has(a.vers) && a.vers !== e.id));
    const passerelle = e.alternatives.length > 0
      ? { id: ncname("Passerelle", e.id), type: e.operateurSortie === "et" ? "parallelGateway" : "exclusiveGateway", nom: "", role: e.roleId }
      : null;
    if (jonction) noeuds.push(jonction);
    noeuds.push(tache);
    if (passerelle) noeuds.push(passerelle);
    if (jonction) relier(jonction, tache);
    entree.set(e.id, jonction || tache);
    return { e, tache, passerelle, decisions };
  });
  noeuds.push(fin);

  relier(debut, etapes.length ? entree.get(etapes[0].id) : fin);
  parEtape.forEach(({ e, tache, passerelle, decisions }, i) => {
    const suivant = i + 1 < etapes.length ? entree.get(etapes[i + 1].id) : fin;
    if (!passerelle) {
      relier(tache, suivant, e.sortie);
      return;
    }
    relier(tache, passerelle, e.sortie);
    const normal = relier(passerelle, suivant, e.condition, passerelle.type === "exclusiveGateway");
    if (normal.parDefaut) passerelle.parDefaut = normal.id;
    decisions.forEach((a) => relier(passerelle, a.vers === "fin" ? fin : entree.get(a.vers), a.condition));
  });
  return { noeuds, flux };
}

// ----- Dessin (BPMN DI) : un couloir par rôle, les nœuds de gauche à droite dans l'ordre de la procédure -----
const DIM = { startEvent: [36, 36], endEvent: [36, 36], task: [120, 80], callActivity: [120, 80], exclusiveGateway: [50, 50], parallelGateway: [50, 50] };
const HAUTEUR_COULOIR = 150;
const X_POOL = 100;
const Y_POOL = 60;
const BANDE_POOL = 30; // bandeau du nom du participant (à gauche)

// Ce qui n'a pas de rôle n'est dans aucun couloir : dans une bande sous les couloirs (bandes = couloirs, + 1 si besoin).
function disposer(graphe, couloirs, bandes) {
  const indexCouloir = new Map(couloirs.map((c, i) => [c.role, i]));
  // Une colonne par nœud : aucun autre nœud n'occupe la même abscisse, quel que soit son couloir.
  let x = X_POOL + BANDE_POOL + 50;
  const formes = new Map();
  graphe.noeuds.forEach((n, ordre) => {
    const [l, h] = DIM[n.type];
    const k = indexCouloir.get(n.role) ?? couloirs.length % bandes;
    const yCentre = Y_POOL + k * HAUTEUR_COULOIR + HAUTEUR_COULOIR / 2;
    formes.set(n.id, { x, y: Math.round(yCentre - h / 2), l, h, ordre, bande: k });
    x += l + (n.type === "task" || n.type === "callActivity" ? 50 : 40);
  });
  const largeur = x + 40 - X_POOL;
  const hauteur = bandes * HAUTEUR_COULOIR;
  // Flèches. Vers le nœud de la colonne suivante : droite → gauche, coudée dans l'intervalle. Saut en avant : par le bas
  // du couloir de départ (marge sans forme), puis dans l'intervalle juste avant la cible. En arrière (boucle) : sous le
  // participant. Ainsi aucune flèche ne traverse une forme.
  let boucles = 0;
  const sauts = new Map();
  const traces = graphe.flux.map((f) => {
    const s = formes.get(f.source);
    const c = formes.get(f.cible);
    const sy = s.y + s.h / 2;
    const cy = c.y + c.h / 2;
    if (c.ordre === s.ordre + 1) {
      const sx = s.x + s.l;
      if (sy === cy) return [[sx, sy], [c.x, cy]];
      const mx = Math.round((sx + c.x) / 2);
      return [[sx, sy], [mx, sy], [mx, cy], [c.x, cy]];
    }
    if (c.ordre > s.ordre) {
      const n = sauts.get(s.bande) || 0;
      sauts.set(s.bande, n + 1);
      const yMarge = Y_POOL + (s.bande + 1) * HAUTEUR_COULOIR - 8 - 6 * (n % 3);
      const sx = s.x + s.l / 2;
      return [[sx, s.y + s.h], [sx, yMarge], [c.x - 20, yMarge], [c.x - 20, cy], [c.x, cy]];
    }
    boucles += 1;
    const yBas = Y_POOL + hauteur + 15 * boucles;
    const sx = s.x + s.l / 2;
    const cx = c.x + c.l / 2;
    return [[sx, s.y + s.h], [sx, yBas], [cx, yBas], [cx, c.y + c.h]];
  });
  return { formes, traces, largeur, hauteur: hauteur + 15 * boucles + (boucles ? 15 : 0) };
}

/**
 * La procédure au format BPMN 2.0 (texte XML). Les instructions de travail (niveau 3) ne s'exportent pas : leur modèle
 * (une suite d'opérations d'un seul rôle, avec plan d'auto-contrôle) n'a pas d'équivalent BPMN retenu.
 */
export function versBpmn(p, { versionApplication = "" } = {}) {
  if (p.meta.typeDocument === "instruction") throw new ErreurBpmn("bpmn.export.instruction");
  const graphe = construireGraphe(p);
  const idsRoles = new Set(p.roles.map((r) => r.id));
  const sansRole = graphe.noeuds.some((n) => !idsRoles.has(n.role));
  // Un couloir par rôle (même sans instruction) ; ce qui n'a pas de rôle n'est dans aucun couloir (BPMN le permet).
  const couloirs = p.roles.map((r) => ({ role: r.id, id: ncname("Couloir", r.id), nom: r.nom, donnees: r }));
  const bandes = Math.max(1, couloirs.length + (sansRole ? 1 : 0));
  const roleDe = (n) => (idsRoles.has(n.role) ? n.role : "");

  const { roles, etapes, ...document } = p;
  const titre = p.meta.titre; // sans titre : pas de nom (un nom inventé reviendrait comme titre à l'import)
  const entrants = (id) => graphe.flux.filter((f) => f.cible === id).map((f) => balise("bpmn:incoming", {}, f.id)).join("");
  const sortants = (id) => graphe.flux.filter((f) => f.source === id).map((f) => balise("bpmn:outgoing", {}, f.id)).join("");

  const laneSet = couloirs.length === 0 ? "" : balise("bpmn:laneSet", { id: "Couloirs" }, couloirs.map((c) =>
    balise("bpmn:lane", { id: c.id, name: c.nom },
      extension("role", c.donnees) +
      graphe.noeuds.filter((n) => roleDe(n) === c.role).map((n) => balise("bpmn:flowNodeRef", {}, n.id)).join(""))).join(""));

  const noeuds = graphe.noeuds.map((n) => {
    const contenu = (n.etape ? extension("etape", n.etape) : "") + entrants(n.id) + sortants(n.id);
    const a = { id: n.id, name: n.nom };
    if (n.parDefaut) a.default = n.parDefaut;
    if (n.type === "exclusiveGateway" || n.type === "parallelGateway") a.gatewayDirection = n.jonction ? "Converging" : "Diverging";
    return balise(`bpmn:${n.type}`, a, contenu);
  }).join("");
  const sequences = graphe.flux.map((f) => balise("bpmn:sequenceFlow", { id: f.id, name: f.nom, sourceRef: f.source, targetRef: f.cible })).join("");

  const processus = balise("bpmn:process", { id: "Processus", name: titre, isExecutable: "false" },
    extension("document", document) + laneSet + noeuds + sequences);
  const collaboration = balise("bpmn:collaboration", { id: "Collaboration" }, balise("bpmn:participant", { id: "Participant", name: titre, processRef: "Processus" }));

  // Dessin.
  const d = disposer(graphe, couloirs, bandes);
  const bornes = (x, y, l, h) => balise("dc:Bounds", { x, y, width: l, height: h });
  const formes = [
    balise("bpmndi:BPMNShape", { id: "Participant_di", bpmnElement: "Participant", isHorizontal: "true" }, bornes(X_POOL, Y_POOL, d.largeur, bandes * HAUTEUR_COULOIR)),
    ...couloirs.map((c, k) => balise("bpmndi:BPMNShape", { id: `${c.id}_di`, bpmnElement: c.id, isHorizontal: "true" },
      bornes(X_POOL + BANDE_POOL, Y_POOL + k * HAUTEUR_COULOIR, d.largeur - BANDE_POOL, HAUTEUR_COULOIR))),
    ...graphe.noeuds.map((n) => {
      const f = d.formes.get(n.id);
      const a = { id: `${n.id}_di`, bpmnElement: n.id };
      if (n.type === "exclusiveGateway") a.isMarkerVisible = "true";
      return balise("bpmndi:BPMNShape", a, bornes(f.x, f.y, f.l, f.h));
    }),
  ].join("");
  const fleches = graphe.flux.map((f, i) => balise("bpmndi:BPMNEdge", { id: `${f.id}_di`, bpmnElement: f.id },
    d.traces[i].map(([x, y]) => balise("di:waypoint", { x, y })).join(""))).join("");
  const diagramme = balise("bpmndi:BPMNDiagram", { id: "Diagramme", name: titre },
    balise("bpmndi:BPMNPlane", { id: "Plan", bpmnElement: "Collaboration" }, formes + fleches));

  return `<?xml version="1.0" encoding="UTF-8"?>\n` + balise("bpmn:definitions", {
    "xmlns:bpmn": NS.bpmn, "xmlns:bpmndi": NS.bpmndi, "xmlns:dc": NS.dc, "xmlns:di": NS.di, "xmlns:jalonia": NS.jalonia,
    id: "Definitions", targetNamespace: `${NS.jalonia}/procedures`, exporter: NOM_OUTIL, exporterVersion: versionApplication || FORMAT_EXTENSIONS,
  }, collaboration + processus + diagramme) + "\n";
}

// =====================================================================================================================
// Lecture XML (sans DOM : utilisable dans le navigateur et dans Node). Refuse les DTD (pas d'entités externes).
// =====================================================================================================================

const ENTITES = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
function decoder(s) {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (tout, e) => {
    if (e[0] === "#") {
      const code = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (!Number.isFinite(code) || code > 0x10ffff) throw new ErreurBpmn("bpmn.import.illisible");
      return String.fromCodePoint(code);
    }
    if (!(e in ENTITES)) throw new ErreurBpmn("bpmn.import.illisible");
    return ENTITES[e];
  });
}

const NOM = "[A-Za-z_][\\w.-]*(?::[A-Za-z_][\\w.-]*)?";
const RE_ATTR = new RegExp(`(${NOM})\\s*=\\s*("([^"]*)"|'([^']*)')`, "g");
const RE_JETON = new RegExp(`<!--[\\s\\S]*?-->|<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|<\\?[\\s\\S]*?\\?>|<!DOCTYPE|<!ENTITY|</(${NOM})\\s*>|<(${NOM})((?:\\s+${NOM}\\s*=\\s*(?:"[^"]*"|'[^']*'))*)\\s*(/?)>|[^<]+|<`, "g");

/** Arbre XML : { ns, local, attributs: Map("ns|local" → valeur), enfants, texte }. */
export function lireXml(texte) {
  if (typeof texte !== "string") throw new ErreurBpmn("bpmn.import.illisible");
  const racineFictive = { enfants: [], portee: new Map([["xml", "http://www.w3.org/XML/1998/namespace"]]) };
  const pile = [racineFictive];
  let elements = 0;
  RE_JETON.lastIndex = 0;
  let m;
  while ((m = RE_JETON.exec(texte))) {
    const j = m[0];
    const parent = pile[pile.length - 1];
    if (j.startsWith("<!--") || j.startsWith("<?")) continue;
    if (j === "<!DOCTYPE" || j === "<!ENTITY") throw new ErreurBpmn("bpmn.import.dtd");
    if (j === "<") throw new ErreurBpmn("bpmn.import.illisible");
    if (m[1] !== undefined) { if (pile.length > 1) parent.texte += m[1]; continue; }
    if (m[2] !== undefined) {
      if (pile.length < 2 || parent.qname !== m[2]) throw new ErreurBpmn("bpmn.import.illisible");
      pile.pop();
      continue;
    }
    if (m[3] !== undefined) {
      if (++elements > 200_000 || pile.length > 200) throw new ErreurBpmn("bpmn.import.trop_gros");
      const brut = [];
      RE_ATTR.lastIndex = 0;
      let a;
      // Normalisation XML des attributs : tabulations et sauts de ligne écrits tels quels deviennent des espaces.
      while ((a = RE_ATTR.exec(m[4] || ""))) brut.push([a[1], decoder((a[3] !== undefined ? a[3] : a[4]).replace(/\r\n|[\t\n\r]/g, " "))]);
      const portee = new Map(parent.portee);
      for (const [nom, v] of brut) {
        if (nom === "xmlns") portee.set("", v);
        else if (nom.startsWith("xmlns:")) portee.set(nom.slice(6), v);
      }
      const resoudre = (qname, defaut) => {
        const i = qname.indexOf(":");
        const prefixe = i < 0 ? "" : qname.slice(0, i);
        if (i >= 0 && !portee.has(prefixe)) throw new ErreurBpmn("bpmn.import.illisible");
        return { ns: i < 0 ? defaut : portee.get(prefixe), local: i < 0 ? qname : qname.slice(i + 1) };
      };
      const { ns, local } = resoudre(m[3], portee.get("") || "");
      const attributs = new Map();
      for (const [nom, v] of brut) {
        if (nom === "xmlns" || nom.startsWith("xmlns:")) continue;
        const r = resoudre(nom, ""); // un attribut sans préfixe n'a pas d'espace de noms
        attributs.set(`${r.ns}|${r.local}`, v);
      }
      const el = { ns, local, qname: m[3], attributs, enfants: [], texte: "", portee };
      parent.enfants.push(el);
      if (m[5] !== "/") pile.push(el);
      continue;
    }
    if (pile.length > 1) parent.texte += decoder(j);
    else if (j.trim()) throw new ErreurBpmn("bpmn.import.illisible");
  }
  if (pile.length !== 1 || racineFictive.enfants.length !== 1) throw new ErreurBpmn("bpmn.import.illisible");
  return racineFictive.enfants[0];
}

const enfants = (el, ns, local) => el.enfants.filter((e) => e.ns === ns && (local === undefined || e.local === local));
const attr = (el, nom) => el.attributs.get(`|${nom}`) ?? "";
const nomDe = (el) => attr(el, "name"); // tel quel : les textes de l'éditeur ne sont pas réduits (aucune perte)
// Le texte lu, sauf s'il est exactement celui de l'extension après passage en XML (caractères interdits retirés) : alors
// c'est celui de l'extension, intact.
const fidele = (lu, original) => (typeof original === "string" && texteXml(original) === lu ? original : lu);

// =====================================================================================================================
// Import
// =====================================================================================================================

const TACHES = ["task", "userTask", "manualTask", "serviceTask", "scriptTask", "sendTask", "receiveTask", "businessRuleTask", "callActivity", "subProcess", "transaction", "adHocSubProcess"];
const PASSERELLES = ["exclusiveGateway", "parallelGateway", "inclusiveGateway", "complexGateway", "eventBasedGateway"];
// Éléments reconnus mais non repris, et leur libellé dans le rapport (clé de traduction).
const NON_REPRIS = {
  intermediateCatchEvent: "bpmn.el.evenement_intermediaire", intermediateThrowEvent: "bpmn.el.evenement_intermediaire",
  boundaryEvent: "bpmn.el.evenement_bordure", dataObject: "bpmn.el.objet_donnees", dataObjectReference: "bpmn.el.objet_donnees",
  dataStoreReference: "bpmn.el.stock_donnees", textAnnotation: "bpmn.el.annotation", association: "bpmn.el.association",
  group: "bpmn.el.groupe", dataInputAssociation: "bpmn.el.association", dataOutputAssociation: "bpmn.el.association",
  messageFlow: "bpmn.el.flux_message", complexGateway: "bpmn.el.passerelle_complexe", eventBasedGateway: "bpmn.el.passerelle_evenement",
  documentation: "bpmn.el.documentation", eventDefinition: "bpmn.el.definition_evenement", ioSpecification: "bpmn.el.donnees_activite",
  property: "bpmn.el.propriete", multiInstanceLoopCharacteristics: "bpmn.el.boucle", standardLoopCharacteristics: "bpmn.el.boucle",
};

function lireExtension(el, nom, rapport, libelle) {
  const ext = enfants(el, NS.bpmn, "extensionElements")[0];
  const j = ext && enfants(ext, NS.jalonia, nom)[0];
  if (!j) return undefined;
  try {
    return JSON.parse(j.texte);
  } catch {
    rapport.push({ gravite: "alerte", cle: "bpmn.import.extension_illisible", params: { element: libelle } });
    return undefined;
  }
}

/**
 * Lit un fichier BPMN 2.0 : renvoie { procedure, rapport }. La procédure est « brute » : l'appelant la fait passer par le même
 * nettoyage qu'un fichier .json (store.importerProcedure). Le rapport dit ce qui est repris et TOUT ce qui ne l'est pas.
 */
export function depuisBpmn(texte) {
  if (typeof texte !== "string" || texte.length > TAILLE_MAX_IMPORT) throw new ErreurBpmn("bpmn.import.trop_gros");
  const racine = lireXml(texte.replace(/^﻿/, ""));
  if (racine.ns !== NS.bpmn || racine.local !== "definitions") throw new ErreurBpmn("bpmn.import.pas_bpmn");
  const rapport = [];
  const ignores = new Map(); // clé de libellé → nombre
  const ignorer = (cle) => ignores.set(cle, (ignores.get(cle) || 0) + 1);

  // Processus repris : celui qui a le plus d'activités (le premier en cas d'égalité). Les autres (participants externes,
  // comme un « Client » qui envoie un message) sont signalés.
  const processus = enfants(racine, NS.bpmn, "process");
  if (processus.length === 0) throw new ErreurBpmn("bpmn.import.aucun_processus");
  const participants = enfants(racine, NS.bpmn, "collaboration").flatMap((c) => enfants(c, NS.bpmn, "participant"));
  const activites = (x) => x.enfants.filter((e) => e.ns === NS.bpmn && TACHES.includes(e.local)).length;
  const proc = processus.reduce((meilleur, x) => (activites(x) > activites(meilleur) ? x : meilleur), processus[0]);
  const participant = participants.find((x) => attr(x, "processRef").replace(/^.*:/, "") === attr(proc, "id"));
  const autres = processus.filter((x) => x !== proc && x.enfants.some((e) => e.ns === NS.bpmn && (TACHES.includes(e.local) || e.local.endsWith("Event"))));
  if (autres.length) rapport.push({ gravite: "alerte", cle: "bpmn.import.autres_processus", params: { n: autres.length } });
  enfants(racine, NS.bpmn, "collaboration").forEach((c) => enfants(c, NS.bpmn, "messageFlow").forEach(() => ignorer(NON_REPRIS.messageFlow)));

  const document = lireExtension(proc, "document", rapport, "processus");
  const jalonia = document !== undefined;
  const p = nouvelleProcedure();
  if (document && typeof document === "object" && !Array.isArray(document)) {
    for (const [cle, v] of Object.entries(document)) if (cle !== "roles" && cle !== "etapes") p[cle] = v;
  }
  if (!p.meta || typeof p.meta !== "object") p.meta = nouvelleProcedure().meta;
  p.meta = { ...p.meta, typeDocument: "procedure" };
  const titre = [participant && nomDe(participant), nomDe(proc)].find((x) => x && x.trim());
  if (titre) p.meta.titre = fidele(titre, p.meta.titre);

  // Couloirs → rôles (couloirs imbriqués : aplatis, signalé).
  const couloirs = [];
  const parcourirCouloirs = (laneSet, profondeur) => enfants(laneSet, NS.bpmn, "lane").forEach((lane) => {
    const sous = enfants(lane, NS.bpmn, "childLaneSet");
    if (sous.length) {
      if (profondeur === 0) rapport.push({ gravite: "info", cle: "bpmn.import.couloirs_imbriques" });
      sous.forEach((s) => parcourirCouloirs(s, profondeur + 1));
      if (enfants(lane, NS.bpmn, "flowNodeRef").length === 0) return;
    }
    couloirs.push(lane);
  });
  enfants(proc, NS.bpmn, "laneSet").forEach((ls) => parcourirCouloirs(ls, 0));
  const roleDuNoeud = new Map();
  const roles = [];
  let nCouloir = 0;
  for (const lane of couloirs) {
    const donnees = lireExtension(lane, "role", rapport, nomDe(lane) || attr(lane, "id"));
    const role = donnees && typeof donnees === "object" && !Array.isArray(donnees) ? { ...donnees } : {};
    if (typeof role.id !== "string" || !/^[\w-]{1,30}$/.test(role.id) || roles.some((r) => r.id === role.id)) role.id = `r${++nCouloir}_${attr(lane, "id").replace(/[^\w-]/g, "").slice(0, 20)}`;
    role.nom = fidele(nomDe(lane), role.nom);
    roles.push(role);
    enfants(lane, NS.bpmn, "flowNodeRef").forEach((r) => roleDuNoeud.set(r.texte.trim(), role.id));
  }
  if (roles.length > MAX_ROLES) rapport.push({ gravite: "alerte", cle: "bpmn.import.limite_roles", params: { n: roles.length, max: MAX_ROLES } });

  // Nœuds et flux.
  const noeuds = new Map();
  const flux = [];
  for (const el of proc.enfants) {
    if (el.ns !== NS.bpmn) continue;
    const id = attr(el, "id");
    if (el.local === "sequenceFlow") {
      const condition = enfants(el, NS.bpmn, "conditionExpression")[0];
      flux.push({ id, source: attr(el, "sourceRef"), cible: attr(el, "targetRef"), nom: nomDe(el) || (condition ? condition.texte.trim() : "") });
    } else if (TACHES.includes(el.local) || PASSERELLES.includes(el.local) || ["startEvent", "endEvent", "intermediateCatchEvent", "intermediateThrowEvent"].includes(el.local)) {
      // Un événement intermédiaire n'est pas repris, mais le flux le traverse (il ne coupe pas l'enchaînement).
      const intermediaire = el.local.startsWith("intermediate");
      noeuds.set(id, { id, type: intermediaire ? "intermediaire" : el.local, nom: nomDe(el), el, defaut: attr(el, "default") });
      if (intermediaire) ignorer(NON_REPRIS[el.local]);
      if (el.local === "subProcess" || el.local === "transaction" || el.local === "adHocSubProcess") {
        if (el.enfants.some((x) => x.ns === NS.bpmn && (TACHES.includes(x.local) || x.local.endsWith("Event")))) rapport.push({ gravite: "alerte", cle: "bpmn.import.sous_processus", params: { element: nomDe(el) || id } });
      }
      if (el.local === "complexGateway" || el.local === "eventBasedGateway") ignorer(NON_REPRIS[el.local]);
      for (const x of el.enfants) if (x.ns === NS.bpmn && (x.local.endsWith("EventDefinition") || NON_REPRIS[x.local])) ignorer(x.local.endsWith("EventDefinition") ? NON_REPRIS.eventDefinition : NON_REPRIS[x.local]);
    } else if (NON_REPRIS[el.local]) {
      ignorer(NON_REPRIS[el.local]);
    } else if (!["laneSet", "extensionElements"].includes(el.local)) {
      ignorer("bpmn.el.autre");
    }
  }
  // Flux dont une extrémité n'est pas reprise (événement de bordure, élément inconnu) : signalés.
  flux.filter((f) => !noeuds.has(f.source) || !noeuds.has(f.cible)).forEach(() => ignorer("bpmn.el.flux_sequence"));
  const sortants = (id) => flux.filter((f) => f.source === id && noeuds.has(f.cible));
  const entrants = (id) => flux.filter((f) => f.cible === id && noeuds.has(f.source));

  const debuts = [...noeuds.values()].filter((n) => n.type === "startEvent");
  const fins = [...noeuds.values()].filter((n) => n.type === "endEvent");
  if (debuts.length > 1) rapport.push({ gravite: "alerte", cle: "bpmn.import.debuts_multiples", params: { n: debuts.length } });
  if (fins.length > 1) rapport.push({ gravite: "info", cle: "bpmn.import.fins_multiples", params: { n: fins.length } });
  if (debuts.length) p.meta.declencheur = fidele(debuts[0].nom, p.meta.declencheur);
  const finNommee = fins.find((f) => f.nom.trim());
  if (fins.length) p.meta.fin = finNommee ? fidele(finNommee.nom, p.meta.fin) : "";

  // Ordre des instructions : parcours en profondeur depuis le début, suite principale d'abord (flux par défaut, sinon le
  // premier). Ce qui n'est pas relié au début vient ensuite, dans l'ordre du fichier (signalé).
  const estTache = (n) => TACHES.includes(n.type);
  const principalD = (n) => {
    const s = sortants(n.id);
    return [...s.filter((f) => f.id === n.defaut), ...s.filter((f) => f.id !== n.defaut)];
  };
  const ordre = [];
  const vus = new Set();
  const pileParcours = [...debuts].reverse().map((d) => d.id);
  if (pileParcours.length === 0) pileParcours.push(...[...noeuds.values()].filter((n) => entrants(n.id).length === 0).map((n) => n.id).reverse());
  while (pileParcours.length) {
    const id = pileParcours.pop();
    if (vus.has(id)) continue;
    vus.add(id);
    const n = noeuds.get(id);
    if (estTache(n)) ordre.push(n);
    principalD(n).map((f) => f.cible).reverse().forEach((c) => { if (!vus.has(c)) pileParcours.push(c); });
  }
  const isoles = [...noeuds.values()].filter((n) => estTache(n) && !vus.has(n.id));
  if (isoles.length) rapport.push({ gravite: "alerte", cle: "bpmn.import.non_relies", params: { n: isoles.length } });
  ordre.push(...isoles);
  if (ordre.length > MAX_ETAPES) rapport.push({ gravite: "alerte", cle: "bpmn.import.limite_etapes", params: { n: ordre.length, max: MAX_ETAPES } });

  // Identifiants d'étape : ceux de l'extension s'ils sont valables et uniques, sinon de nouveaux.
  const idEtape = new Map();
  const pris = new Set();
  const donneesEtape = new Map();
  let nEtape = 0;
  for (const n of ordre) {
    const d = lireExtension(n.el, "etape", rapport, n.nom || n.id);
    const donnees = d && typeof d === "object" && !Array.isArray(d) ? d : null;
    let id = donnees && typeof donnees.id === "string" && /^[\w-]{1,30}$/.test(donnees.id) && !pris.has(donnees.id) ? donnees.id : "";
    if (!id) id = `e${++nEtape}_${n.id.replace(/[^\w-]/g, "").slice(0, 20)}`.slice(0, 30);
    pris.add(id);
    idEtape.set(n.id, id);
    donneesEtape.set(n.id, donnees);
  }

  // Suit les jonctions et passerelles « de passage » (une seule sortie) jusqu'à une tâche ou une fin.
  const destination = (idNoeud, profondeur = 0) => {
    const n = noeuds.get(idNoeud);
    if (!n || profondeur > 50) return { vers: "" };
    if (estTache(n)) return { vers: idEtape.get(n.id) || "" };
    if (n.type === "endEvent") return { vers: "fin" };
    const s = principalD(n);
    if ((PASSERELLES.includes(n.type) || n.type === "intermediaire") && s.length === 1) return destination(s[0].cible, profondeur + 1);
    return { vers: "", complexe: true };
  };
  const operateurEntree = (n) => {
    const e = entrants(n.id);
    if (e.length === 1) {
      const j = noeuds.get(e[0].source);
      if (j && PASSERELLES.includes(j.type) && entrants(j.id).length >= 2 && sortants(j.id).length === 1) return j.type === "parallelGateway" ? "et" : "ou";
    }
    return "";
  };

  let sansRole = 0;
  p.roles = roles;
  p.etapes = ordre.map((n, i) => {
    const base = donneesEtape.get(n.id);
    const e = nouvelleEtape(base ? { ...base } : {});
    e.id = idEtape.get(n.id);
    e.libelle = fidele(n.nom, base && base.libelle);
    e.roleId = roleDuNoeud.get(n.id) || "";
    if (!e.roleId) sansRole += 1;
    const spBase = base && base.sousProcedure && typeof base.sousProcedure === "object" ? base.sousProcedure : { code: attr(n.el, "calledElement") };
    e.sousProcedure = { ...spBase, actif: n.type === "callActivity" };
    // Opérateur d'entrée : une jonction le dit ; sans jonction et avec moins de deux arrivées, BPMN ne peut pas l'écrire
    // (il reste celui de l'extension).
    const jonction = operateurEntree(n);
    e.operateurEntree = jonction || (entrants(n.id).length < 2 && base && typeof base.operateurEntree === "string" ? base.operateurEntree : "");

    // Sorties. Suite normale de Jalonia = l'instruction suivante de la liste (ou la fin pour la dernière).
    const attendue = i + 1 < ordre.length ? idEtape.get(ordre[i + 1].id) : "fin";
    const s = principalD(n);
    const libelle = n.nom || n.id;
    let operateur = null; // null : BPMN ne dit rien (on garde celui de l'extension)
    let suites = []; // flux qui partent vers les suites possibles
    let conditionLue = false;
    if (s.length === 1) {
      e.sortie = fidele(s[0].nom, base && base.sortie);
      const g = noeuds.get(s[0].cible);
      if (g && PASSERELLES.includes(g.type) && sortants(g.id).length >= 2) {
        operateur = g.type === "parallelGateway" ? "et" : "ou";
        if (g.nom.trim()) ignorer("bpmn.el.nom_passerelle"); // la question posée par la passerelle n'a pas de place dans l'éditeur
        if (g.type === "inclusiveGateway") rapport.push({ gravite: "alerte", cle: "bpmn.import.passerelle_inclusive", params: { element: libelle } });
        suites = principalD(g);
        conditionLue = true;
      } else {
        suites = s;
      }
    } else if (s.length > 1) {
      rapport.push({ gravite: "info", cle: "bpmn.import.sorties_multiples", params: { element: libelle } });
      operateur = "et";
      e.sortie = "";
      suites = s;
      conditionLue = true;
    } else {
      e.sortie = "";
      if (attendue !== "fin") rapport.push({ gravite: "info", cle: "bpmn.import.sans_suite", params: { element: libelle } });
    }
    // La suite normale est le premier flux (par défaut d'abord) qui mène à l'instruction attendue ; les autres sont des alternatives.
    const k = suites.findIndex((f) => destination(f.cible).vers === attendue);
    if (suites.length > 0 && k < 0) rapport.push({ gravite: "alerte", cle: "bpmn.import.suite_deplacee", params: { element: libelle } });
    if (conditionLue) e.condition = k >= 0 ? fidele(suites[k].nom, base && base.condition) : "";
    const lues = suites.filter((_, j) => j !== k).map((f) => {
      const d = destination(f.cible);
      if (d.complexe) rapport.push({ gravite: "alerte", cle: "bpmn.import.destination_complexe", params: { element: libelle } });
      return { condition: conditionLue ? f.nom : "", vers: d.vers };
    });
    // Alternatives : dans l'ordre de l'extension quand elle les connaît (même destination et même nom) ; celles « à choisir »
    // (sans destination), que BPMN ne peut pas écrire, viennent de l'extension ; les nouvelles s'ajoutent à la fin.
    const anciennes = base && Array.isArray(base.alternatives) ? base.alternatives.filter((a) => a && typeof a === "object") : [];
    const restantes = [...lues];
    const alternatives = [];
    for (const a of anciennes) {
      if (a.vers === "" || a.vers === undefined) { alternatives.push(nouvelleAlternative({ ...a })); continue; }
      const j = restantes.findIndex((l) => l.vers === a.vers && (!conditionLue || l.condition === texteXml(a.condition || "")));
      if (j >= 0) {
        restantes.splice(j, 1);
        alternatives.push(nouvelleAlternative({ ...a }));
      }
    }
    restantes.forEach((l) => alternatives.push(nouvelleAlternative(l)));
    if (alternatives.length > MAX_ALTERNATIVES) {
      rapport.push({ gravite: "alerte", cle: "bpmn.import.limite_alternatives", params: { element: libelle, n: alternatives.length, max: MAX_ALTERNATIVES } });
    }
    e.alternatives = alternatives;
    e.operateurSortie = operateur && lues.length > 0 ? operateur : base && base.operateurSortie === "et" ? "et" : "ou";
    return e;
  });
  if (sansRole > 0 && roles.length > 0) rapport.push({ gravite: "info", cle: "bpmn.import.sans_role", params: { n: sansRole } });

  if (ignores.size) {
    rapport.push({ gravite: "alerte", cle: "bpmn.import.non_repris", params: { liste: [...ignores.entries()].map(([cle, n]) => ({ cle, n })) } });
  }
  rapport.unshift(jalonia
    ? { gravite: "ok", cle: "bpmn.import.jalonia", params: { roles: roles.length, etapes: p.etapes.length } }
    : { gravite: "info", cle: "bpmn.import.standard", params: { roles: roles.length, etapes: p.etapes.length } });
  return { procedure: p, rapport };
}
