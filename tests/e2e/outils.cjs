// Outils communs des parcours navigateur (tests/e2e). Lancés par tests/e2e/lancer.mjs, qui fournit :
//   E2E_BASE             adresse du serveur de test (ex. http://localhost:3210) ;
//   E2E_URL_PROPRIETAIRE connexion PostgreSQL du rôle propriétaire de la base de test (contrôles en base) ;
//   E2E_ETAT             dossier des fichiers échangés entre les parties (identifiants, secrets, captures).
// Facultatif : E2E_CHROMIUM (chemin d'un Chromium déjà installé).
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

function exiger(nom) {
  const v = process.env[nom];
  if (!v) throw new Error(`${nom} manquante : lancer les parcours avec « npm run test:e2e » (tests/e2e/lancer.mjs).`);
  return v;
}
const BASE = exiger("E2E_BASE");
const URL_PROPRIETAIRE = exiger("E2E_URL_PROPRIETAIRE");
const URL_APPLICATION = exiger("E2E_URL_APPLICATION");
const ETAT = exiger("E2E_ETAT");
const SORTIE = path.join(ETAT, "captures");
const MDP = "motdepasse-e2e-demo";
/** Compte superadministrateur de la base de test (créé par tests/e2e/preparer.ts). */
const SUPERADMIN = { email: "superadmin@e2e.test", mdp: "superadmin-e2e-motdepasse" };
const fichierEtat = (nom) => path.join(ETAT, nom);
/** Requête SQL (rôle propriétaire) sur la base de test ; renvoie le texte brut (psql -At). */
const sql = (requete) => execFileSync("psql", [URL_PROPRIETAIRE, "-Atc", requete], { encoding: "utf8" }).trim();

let navigateur;
async function lancer() {
  navigateur = await chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {});
  return navigateur;
}

// Un contexte = une personne connectée. On note les erreurs de la console (hors réponses HTTP attendues : 4xx des tests de refus).
async function connecter(email, { viewport = { width: 1400, height: 900 } } = {}) {
  const ctx = await navigateur.newContext({ viewport, acceptDownloads: true });
  const page = await ctx.newPage();
  page.erreurs = [];
  page.on("console", (m) => { if (m.type() === "error" && !/status of (401|403|404|409|413|415)/.test(m.text())) page.erreurs.push(m.text()); });
  page.on("pageerror", (e) => page.erreurs.push("pageerror: " + e.message));
  await page.goto(`${BASE}/connexion`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="motDePasse"]', email === SUPERADMIN.email ? SUPERADMIN.mdp : MDP);
  await page.click(`button:has-text("Se connecter")`);
  await page.waitForURL((u) => u.pathname !== "/connexion" && u.pathname !== "/");
  if (new URL(page.url()).pathname === "/connexion/second-facteur") {
    await passerSecondFacteur(page, email);
    await page.waitForURL((u) => !u.pathname.startsWith("/connexion") && u.pathname !== "/");
  }
  await page.waitForLoadState("networkidle");
  return page;
}

// ---------- Second facteur (TOTP, RFC 6238) ----------
const crypto = require("node:crypto");
const fs = require("node:fs");
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32(texte) {
  let bits = 0, valeur = 0; const octets = [];
  for (const c of texte.toUpperCase().replace(/[\s=-]/g, "")) {
    valeur = ((valeur << 5) | ALPHABET.indexOf(c)) & 0xffff; bits += 5;
    if (bits >= 8) { octets.push((valeur >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(octets);
}
function codeTotp(secret, pas) {
  const m = Buffer.alloc(8); m.writeBigUInt64BE(BigInt(pas));
  const h = crypto.createHmac("sha1", base32(secret)).update(m).digest();
  const o = h[h.length - 1] & 15;
  return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, "0");
}
const pasCourant = () => Math.floor(Date.now() / 30000);
// Secret et dernier pas utilisé de chaque compte à second facteur (un code ne sert qu'une fois).
const FICHIER_MFA = fichierEtat("mfa.json");
const lireMfa = () => { try { return JSON.parse(fs.readFileSync(FICHIER_MFA, "utf8")); } catch { return {}; } };
const ecrireMfa = (d) => fs.writeFileSync(FICHIER_MFA, JSON.stringify(d, null, 2));
function noterSecret(email, secret, codes) { const d = lireMfa(); d[email] = { secret, codes, dernierPas: pasCourant() }; ecrireMfa(d); }
function oublierSecret(email) { const d = lireMfa(); delete d[email]; ecrireMfa(d); }
/** Code TOTP frais (attend le pas suivant si le pas courant a déjà servi). */
async function codeFrais(email) {
  const d = lireMfa(); const e = d[email]; if (!e) throw new Error(`pas de secret connu pour ${email}`);
  while (pasCourant() <= e.dernierPas) await new Promise((r) => setTimeout(r, 1000));
  e.dernierPas = pasCourant(); ecrireMfa(d);
  return codeTotp(e.secret, e.dernierPas);
}
/** Page du second facteur : enrôlement (secret noté) ou code de l'application. */
async function passerSecondFacteur(page, email) {
  if (await page.locator(".secret-totp").count()) {
    const secret = await page.getAttribute(".secret-totp", "data-secret");
    await page.fill('input[name="code"]', codeTotp(secret, pasCourant()));
    await page.click('button:has-text("Activer")');
    await page.waitForSelector(".liste-codes code");
    noterSecret(email, secret, await page.locator(".liste-codes code").allTextContents());
    await page.click('a:has-text("continuer")');
  } else {
    await page.fill('input[name="code"]', await codeFrais(email));
    await page.click('button:has-text("Valider")');
  }
}

// Visiteur sans session (ex. personne invitée), avec le même relevé des erreurs de la console.
async function anonyme({ viewport = { width: 1400, height: 900 } } = {}) {
  const ctx = await navigateur.newContext({ viewport });
  const page = await ctx.newPage();
  page.erreurs = [];
  page.on("console", (m) => { if (m.type() === "error" && !/status of (401|403|404|409|413|415)/.test(m.text())) page.erreurs.push(m.text()); });
  page.on("pageerror", (e) => page.erreurs.push("pageerror: " + e.message));
  return page;
}

// Appel de l'API depuis la page (même site, cookie de session) : renvoie { statut, corps }.
async function api(page, methode, chemin, corps) {
  return page.evaluate(async ({ methode, chemin, corps }) => {
    const r = await fetch(chemin, { method: methode, headers: corps === undefined ? {} : { "Content-Type": "application/json" }, body: corps === undefined ? undefined : JSON.stringify(corps) });
    let c = null;
    try { c = await r.json(); } catch { /* vide */ }
    return { statut: r.status, corps: c };
  }, { methode, chemin, corps });
}

// Attend que l'éditeur soit ouvert (<html data-pret>) et renvoie le texte de l'état d'enregistrement.
async function editeurPret(page) {
  await page.waitForSelector("html[data-pret]", { timeout: 15000 });
}
async function attendreEtat(page, texte, selecteur = "#etat-synchro") {
  await page.waitForFunction(({ s, t }) => document.querySelector(s)?.textContent === t, { s: selecteur, t: texte }, { timeout: 15000 });
}

let n = 0;
async function capture(page, nom) {
  n += 1;
  await page.screenshot({ path: path.join(SORTIE, `${String(n).padStart(2, "0")}-${nom}.png`) });
}

function etape(texte) {
  console.log("▶ " + texte);
}

/** Soumettre (page de validation) : désigne Victor pour vérifier et Agathe pour approuver (comptes de l'atelier de démonstration). */
async function designerDemo(bloc) {
  for (const [champ, nom] of [["verificateur", "Victor Vérificateur"], ["approbateur", "Agathe Approbatrice"]]) {
    if (await bloc.locator(`select[name="${champ}"]`).count()) await bloc.locator(`select[name="${champ}"]`).selectOption({ label: nom });
  }
}

module.exports = { designerDemo, BASE, URL_APPLICATION, MDP, SORTIE, SUPERADMIN, ETAT, fichierEtat, sql, lancer, connecter, anonyme, codeTotp, pasCourant, codeFrais, noterSecret, oublierSecret, lireMfa, passerSecondFacteur, api, editeurPret, attendreEtat, capture, etape, assert };
