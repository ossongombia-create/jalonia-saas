// Enregistrement automatique en ligne (js/synchro.js) : délai, une seule requête à la fois, versions, conflit, coupure réseau,
// refus du serveur, rechargement. Sans navigateur ni serveur : la minuterie et l'envoi sont simulés.
import test from "node:test";
import assert from "node:assert/strict";
import { creerSynchro, raisonDuRefus, DELAI_ENREGISTREMENT, ATTENTE_MAX } from "../js/synchro.js";

function minuterieFactice() {
  let n = 0;
  const taches = new Map();
  return {
    definir: (fn, ms) => { n += 1; taches.set(n, { fn, ms }); return n; },
    annuler: (id) => { taches.delete(id); },
    delais: () => [...taches.values()].map((x) => x.ms),
    declencher() {
      const liste = [...taches.values()];
      taches.clear();
      liste.forEach((x) => x.fn());
    },
  };
}

// Un « serveur » dont on choisit chaque réponse ; il note ce qu'il reçoit et le nombre maximal de requêtes simultanées.
function serveurFactice() {
  const recues = [];
  const attentes = [];
  let enVol = 0;
  let maxEnVol = 0;
  return {
    recues, attentes,
    maxEnVol: () => maxEnVol,
    envoyer: (requete) => {
      recues.push({ ...requete, contenu: JSON.parse(JSON.stringify(requete.contenu)) });
      enVol += 1;
      maxEnVol = Math.max(maxEnVol, enVol);
      return new Promise((resoudre) => attentes.push((reponse) => { enVol -= 1; resoudre(reponse); }));
    },
    repondre(reponse) {
      const r = attentes.shift();
      assert.ok(r, "aucune requête en attente");
      r(reponse);
    },
  };
}

const attendre = () => new Promise((r) => setImmediate(r));

function monter(versionDepart = 3) {
  const doc = { contenu: { titre: "A" } };
  const minuterie = minuterieFactice();
  const serveur = serveurFactice();
  const etats = [];
  const s = creerSynchro({ contenu: () => doc.contenu, empreinte: (o) => JSON.stringify(o), envoyer: serveur.envoyer, surChangement: (e) => etats.push(e), minuterie });
  s.demarrer(versionDepart);
  const modifier = (titre) => { doc.contenu = { titre }; s.signaler(); };
  return { doc, minuterie, serveur, etats, s, modifier };
}

test("au départ : enregistré, rien à envoyer ; une modification est envoyée après le délai, avec la version ouverte", async () => {
  const { s, minuterie, serveur, modifier } = monter(3);
  assert.equal(s.etat().cle, "enregistre");
  assert.equal(s.enAttente(), false);
  modifier("B");
  modifier("BC");
  assert.equal(s.etat().cle, "modifie");
  assert.deepEqual(minuterie.delais(), [DELAI_ENREGISTREMENT], "un seul minuteur, relancé à chaque frappe");
  assert.equal(serveur.recues.length, 0);
  minuterie.declencher();
  await attendre();
  assert.equal(s.etat().cle, "envoi");
  assert.deepEqual(serveur.recues, [{ version: 3, forcer: false, contenu: { titre: "BC" } }]);
  serveur.repondre({ statut: 200, corps: { version: 4 } });
  await attendre();
  assert.equal(s.etat().cle, "enregistre");
  assert.equal(s.version(), 4);
  assert.equal(s.enAttente(), false);
});

test("modifié pendant l'envoi : la suite est enregistrée ensuite, avec la nouvelle version", async () => {
  const { s, minuterie, serveur, modifier } = monter(1);
  modifier("B");
  minuterie.declencher();
  await attendre();
  modifier("BC"); // pendant l'envoi : pas de second envoi simultané
  assert.equal(serveur.recues.length, 1);
  assert.equal(s.enAttente(), true);
  serveur.repondre({ statut: 200, corps: { version: 2 } });
  await attendre();
  assert.equal(s.etat().cle, "modifie");
  minuterie.declencher();
  await attendre();
  assert.deepEqual(serveur.recues[1], { version: 2, forcer: false, contenu: { titre: "BC" } });
  serveur.repondre({ statut: 200, corps: { version: 3 } });
  await attendre();
  assert.equal(s.etat().cle, "enregistre");
  assert.equal(serveur.maxEnVol(), 1);
});

test("revenir à ce qui est enregistré (annuler) n'envoie rien", async () => {
  const { s, minuterie, serveur, modifier } = monter(1);
  modifier("B");
  modifier("A");
  assert.deepEqual(minuterie.delais(), []);
  assert.equal(s.etat().cle, "enregistre");
  assert.equal(await s.envoyerMaintenant(), true);
  assert.equal(serveur.recues.length, 0);
});

test("« Enregistrer » plusieurs fois de suite : une seule requête à la fois, puis plus rien à envoyer", async () => {
  const { s, serveur, modifier } = monter(1);
  modifier("B");
  const a = s.envoyerMaintenant();
  const b = s.envoyerMaintenant();
  await attendre();
  assert.equal(serveur.recues.length, 1);
  serveur.repondre({ statut: 200, corps: { version: 2 } });
  assert.equal(await a, true);
  assert.equal(await b, true);
  assert.equal(serveur.recues.length, 1, "le second appel voit que tout est déjà enregistré");
  assert.equal(serveur.maxEnVol(), 1);
});

test("conflit : l'enregistrement s'arrête ; « garder ma version » renvoie le contenu en forçant", async () => {
  const { s, minuterie, serveur, modifier, etats } = monter(5);
  modifier("Moi");
  const envoi = s.envoyerMaintenant();
  await attendre();
  const details = { erreur: "conflit", version: 7, modifieParNom: "Alice", modifieLe: "2026-10-12T08:00:00.000Z" };
  serveur.repondre({ statut: 409, corps: details });
  assert.equal(await envoi, false);
  assert.deepEqual(s.etat(), { cle: "bloque", raison: "conflit", details });
  assert.equal(etats.at(-1).raison, "conflit");
  modifier("Moi encore");
  assert.deepEqual(minuterie.delais(), [], "rien n'est planifié tant que la personne n'a pas choisi");
  assert.equal(s.etat().cle, "bloque");
  const force = s.garderMaVersion();
  await attendre();
  assert.deepEqual(serveur.recues.at(-1), { version: 5, forcer: true, contenu: { titre: "Moi encore" } });
  serveur.repondre({ statut: 200, corps: { version: 8 } });
  assert.equal(await force, true);
  assert.equal(s.version(), 8);
  assert.equal(s.etat().cle, "enregistre");
});

test("coupure réseau : nouvel essai automatique de plus en plus espacé (30 s au plus) ; une réussite remet à zéro", async () => {
  const { s, minuterie, serveur, modifier } = monter(1);
  modifier("B");
  const attendus = [2000, 4000, 8000, 16000, ATTENTE_MAX, ATTENTE_MAX];
  minuterie.declencher();
  for (const delai of attendus) {
    await attendre();
    serveur.repondre({ statut: 0, corps: null });
    await attendre();
    assert.equal(s.etat().cle, "erreur_reseau");
    assert.deepEqual(minuterie.delais(), [delai]);
    minuterie.declencher();
  }
  await attendre();
  serveur.repondre({ statut: 200, corps: { version: 2 } });
  await attendre();
  assert.equal(s.etat().cle, "enregistre");
  assert.deepEqual(minuterie.delais(), []);
});

test("un envoi qui lève une erreur, ou un serveur indisponible (502), est traité comme une coupure", async () => {
  const minuterie = minuterieFactice();
  let doc = { x: 1 };
  let appels = 0;
  const s = creerSynchro({ contenu: () => doc, empreinte: JSON.stringify, envoyer: async () => { appels += 1; if (appels === 1) throw new Error("réseau"); return { statut: 502, corps: null }; }, minuterie });
  s.demarrer(1);
  doc = { x: 2 };
  assert.equal(await s.envoyerMaintenant(), false);
  assert.equal(s.etat().cle, "erreur_reseau");
  assert.equal(await s.envoyerMaintenant(), false);
  assert.deepEqual(s.etat(), { cle: "erreur_reseau", echecs: 2 });
});

test("trop volumineux : arrêt, puis reprise à la modification suivante", async () => {
  const { s, minuterie, serveur, modifier } = monter(1);
  modifier("Énorme");
  const envoi = s.envoyerMaintenant();
  await attendre();
  serveur.repondre({ statut: 413, corps: { erreur: "docs.erreur.trop_volumineux" } });
  await envoi;
  assert.equal(s.etat().raison, "trop_volumineux");
  modifier("Raisonnable");
  assert.equal(s.etat().cle, "modifie");
  assert.deepEqual(minuterie.delais(), [DELAI_ENREGISTREMENT]);
});

test("session expirée : arrêt ; « Réessayer » renvoie", async () => {
  const { s, serveur, modifier } = monter(1);
  modifier("B");
  const envoi = s.envoyerMaintenant();
  await attendre();
  serveur.repondre({ statut: 401, corps: { erreur: "session" } });
  await envoi;
  assert.equal(s.etat().raison, "session");
  assert.equal(await s.envoyerMaintenant(), false, "bloqué : pas d'envoi");
  assert.equal(serveur.recues.length, 1);
  const essai = s.reessayer();
  await attendre();
  assert.equal(serveur.recues.length, 2);
  serveur.repondre({ statut: 200, corps: { version: 2 } });
  assert.equal(await essai, true);
});

test("recharger : le contenu du serveur remplace la page sans être pris pour une modification", async () => {
  const { s, doc, minuterie, serveur, modifier } = monter(1);
  modifier("Moi");
  const envoi = s.envoyerMaintenant();
  await attendre();
  serveur.repondre({ statut: 409, corps: { erreur: "conflit", version: 3, modifieParNom: "Bob", modifieLe: null } });
  await envoi;
  s.recharger(3, () => { doc.contenu = { titre: "Bob" }; s.signaler(); });
  assert.equal(s.etat().cle, "enregistre");
  assert.equal(s.version(), 3);
  assert.deepEqual(minuterie.delais(), []);
  modifier("Bob et moi");
  minuterie.declencher();
  await attendre();
  assert.deepEqual(serveur.recues.at(-1), { version: 3, forcer: false, contenu: { titre: "Bob et moi" } });
});

test("non démarrée (lecture seule) : rien n'est envoyé, rien n'est en attente", async () => {
  const serveur = serveurFactice();
  const s = creerSynchro({ contenu: () => ({ a: 1 }), empreinte: JSON.stringify, envoyer: serveur.envoyer, minuterie: minuterieFactice() });
  s.signaler();
  assert.equal(await s.envoyerMaintenant(), false);
  assert.equal(s.enAttente(), false);
  assert.equal(s.etat().cle, "inactif");
  assert.equal(serveur.recues.length, 0);
});

test("sens des refus du serveur", () => {
  assert.equal(raisonDuRefus(409, { erreur: "conflit" }), "conflit");
  assert.equal(raisonDuRefus(409, { erreur: "organisation_changee" }), "organisation_changee");
  assert.equal(raisonDuRefus(403, { erreur: "organisation" }), "organisation_changee");
  assert.equal(raisonDuRefus(401, { erreur: "session" }), "session");
  assert.equal(raisonDuRefus(403, { erreur: "mot_de_passe" }), "session");
  assert.equal(raisonDuRefus(403, { erreur: "interdit" }), "interdit");
  assert.equal(raisonDuRefus(403, { erreur: "circuit" }), "circuit");
  assert.equal(raisonDuRefus(400, { erreur: "circuit" }), "invalide"); // « circuit » n'a de sens qu'avec 403
  assert.equal(raisonDuRefus(404, null), "introuvable");
  assert.equal(raisonDuRefus(413, null), "trop_volumineux");
  assert.equal(raisonDuRefus(400, { erreur: "docs.erreur.contenu_invalide" }), "invalide");
  for (const statut of [0, 500, 502, 503, 504]) assert.equal(raisonDuRefus(statut, null), null, String(statut));
});

test("minuterie par défaut : setTimeout et clearTimeout sont appelés comme dans un navigateur (sans « this » d'objet)", async () => {
  const origine = { definir: globalThis.setTimeout, annuler: globalThis.clearTimeout };
  const strict = (fonction) => function (...args) {
    if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");
    return fonction(...args);
  };
  globalThis.setTimeout = strict(origine.definir);
  globalThis.clearTimeout = strict(origine.annuler);
  try {
    let doc = { a: 1 };
    const s = creerSynchro({ contenu: () => doc, empreinte: JSON.stringify, envoyer: async () => ({ statut: 200, corps: { version: 2 } }), delai: 5 });
    s.demarrer(1);
    doc = { a: 2 };
    s.signaler(); // planifie
    doc = { a: 3 };
    s.signaler(); // annule et replanifie
    await new Promise((r) => origine.definir(r, 40));
    assert.equal(s.version(), 2);
    assert.equal(s.etat().cle, "enregistre");
  } finally {
    globalThis.setTimeout = origine.definir;
    globalThis.clearTimeout = origine.annuler;
  }
});
