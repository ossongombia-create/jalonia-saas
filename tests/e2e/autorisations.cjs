// Matrice des autorisations, vérifiée sur le serveur de production construit (audit T1).
//
// Pour chaque profil — sans session valable (cookie forgé), connexion en attente du second facteur (administrateur
// de l'organisation A !), lecteur, rédacteur, vérificateur, administrateur A, administrateur B, superadmin — :
//   1. pages : code HTTP et page d'arrivée ;
//   2. API JSON de l'éditeur : code HTTP ;
//   3. TOUTES les actions serveur, appelées DIRECTEMENT (requête forgée, comme le ferait un attaquant, sans passer par
//      l'interface) : refus attendu ET aucune écriture en base (empreinte des tables avant/après), ou succès attendu
//      ET effet vérifié en base. Les identifiants des actions sont lus dans le manifeste de la construction : une
//      action ajoutée sans entrée dans la matrice fait échouer le test.
// Les refus métier sont vérifiés sur leur MESSAGE (refus « interdit » et non « saisie illisible ») : une requête mal
// formée ne peut pas passer pour un refus.
const fs = require("node:fs");
const path = require("node:path");
const { BASE, MDP, SUPERADMIN, ETAT, sql, lancer, connecter, etape, assert } = require("./outils.cjs");

const RACINE = path.resolve(__dirname, "../..");
const ETRANGERE = "https://pirate.example";

// ---------- Textes (français) des refus attendus ----------
const TEXTES = {};
for (const ligne of fs.readFileSync(path.join(RACINE, "src/lib/i18n/fr.ts"), "utf8").split("\n")) {
  const m = /^\s*"([A-Za-z0-9_.]+)":\s*("(?:[^"\\]|\\.)*"),\s*$/.exec(ligne);
  if (m) TEXTES[m[1]] = JSON.parse(m[2]);
}
function texte(cle) {
  if (!(cle in TEXTES)) throw new Error(`clé de traduction inconnue : ${cle}`);
  return TEXTES[cle];
}

// ---------- Actions serveur de la construction ----------
// Règle d'autorisation de chaque action (documentation de la matrice ; l'ensemble doit être EXACTEMENT celui du
// manifeste). « simple » : action de formulaire sans état (pas de useActionState).
const REGLES = {
  actionConnexion: { regle: "publique (connexion)", page: "/connexion" },
  actionDeconnexion: { regle: "sa propre session (aucun paramètre)", simple: true },
  actionContinuer: { regle: "session (redirection seulement)", simple: true },
  actionChangerLangue: { regle: "publique ; si connecté : son propre compte", simple: true },
  actionChoisirOrganisation: { regle: "une organisation dont on est membre (superadmin : accès d'urgence valable, rôle encore permis ; rôle retiré : refusé et tracé)", simple: true },
  actionChangerMotDePasse: { regle: "son propre compte, mot de passe actuel exigé" },
  actionCreerDocument: { regle: "documents.rediger dans l'organisation OUVERTE" },
  actionSupprimerDocument: { regle: "documents.supprimer dans l'organisation OUVERTE (mise à la corbeille)" },
  actionRetablirDocument: { regle: "documents.supprimer dans l'organisation OUVERTE ; document de CETTE organisation" },
  actionRestaurerVersion: { regle: "documents.rediger dans l'organisation OUVERTE ; document de CETTE organisation" },
  actionCreerAction: { regle: "actions.gerer dans l'organisation OUVERTE ; responsable membre actif, document visé de CETTE organisation" },
  actionModifierAction: { regle: "actions.gerer dans l'organisation OUVERTE, OU responsable de l'action (avancement et compte rendu seulement) ; jamais clore ni abandonner sa propre action ; action de CETTE organisation ; version vue" },
  actionDefinirObjectif: { regle: "indicateurs.objectifs dans l'organisation OUVERTE ; indicateur d'un document de CETTE organisation" },
  actionRetirerObjectif: { regle: "indicateurs.objectifs dans l'organisation OUVERTE ; indicateur d'un document de CETTE organisation" },
  actionEnregistrerMesure: { regle: "indicateurs.mesurer dans l'organisation OUVERTE ; indicateur d'un document de CETTE organisation" },
  actionSupprimerMesure: { regle: "indicateurs.mesurer dans l'organisation OUVERTE ; mesure de CETTE organisation" },
  actionModifierParametres: { regle: "organisation.parametres dans l'organisation OUVERTE" },
  actionToutMarquerLu: { regle: "membre de l'organisation OUVERTE ; seulement SES notifications" },
  actionTransitionDocument: { regle: "droit de la décision dans l'organisation OUVERTE (soumettre, réviser : rédaction ; vérifier : vérificateur ; approuver, archiver : approbateur) ; document de CETTE organisation ; séparation des tâches" },
  actionInviterMembre: { regle: "organisation.membres.gerer dans l'organisation OUVERTE ; jamais le superadmin, même en accès d'urgence (chantier 1)" },
  actionAnnulerInvitation: { regle: "idem ; invitation de CETTE organisation" },
  actionModifierRoles: { regle: "idem ; membre de CETTE organisation" },
  actionRetirerMembre: { regle: "idem ; membre de CETTE organisation" },
  actionCodeSecondFacteur: { regle: "connexion en attente du second facteur" },
  actionActiverSecondFacteurConnexion: { regle: "connexion en attente, compte sans second facteur" },
  actionAbandonnerConnexion: { regle: "connexion en attente (une session complète n'est pas touchée)", simple: true },
  actionActiverSecondFacteur: { regle: "session complète ; son propre compte" },
  actionDesactiverSecondFacteur: { regle: "session complète ; son propre compte ; code exigé" },
  actionRegenererCodesSecours: { regle: "session complète ; son propre compte ; code exigé" },
  actionCreerCompteInvitation: { regle: "publique : jeton d'invitation valable, personne connectée" },
  actionAccepterInvitation: { regle: "session complète ; invitation adressée à SON adresse" },
  actionCreerOrganisation: { regle: "superadmin" },
  actionChangerStatutOrganisation: { regle: "superadmin" },
  actionDesactiverUtilisateur: { regle: "superadmin" },
  actionReactiverUtilisateur: { regle: "superadmin" },
  actionRevoquerSessionsUtilisateur: { regle: "superadmin" },
  actionRevoquerSession: { regle: "superadmin" },
  actionReinitialiserMotDePasse: { regle: "superadmin" },
  actionReinitialiserSecondFacteur: { regle: "superadmin" },
  actionEnregistrerMaintenance: { regle: "superadmin (activer comme lever la maintenance)" },
  actionOuvrirAccesUrgence: { regle: "superadmin ; motif, rôle (rédacteur ou lecteur ; plus administrateur depuis le chantier 1), durée (1, 4, 8, 24 h) ; notifié aux administrateurs" },
  actionReemettreInvitationAdmin: { regle: "superadmin ; organisation ACTIVE sans AUCUN administrateur actif ; rôle Administrateur forcé (chantier 1)" },
  actionFermerAccesUrgence: { regle: "superadmin ; accès encore valable" },
  actionReinitialiserParLien: { regle: "publique : lien de réinitialisation valable, personne connectée" },
  actionChangerModeValidation: { regle: "superadmin (mode « petite organisation » ou standard), tracé" },
  // Binôme d'administration (chantier 2 du 20/10/2026) : superadmin seulement, organisation active.
  actionInviterSuppleant: { regle: "superadmin ; aucun suppléant utilisable (B5) ; titulaire désigné s'il manque (B8)" },
  actionActiverSuppleant: { regle: "superadmin ; suppléant membre, compte actif, inactif" },
  actionMarquerTitulaireAbsent: { regle: "superadmin ; titulaire présent ; motif facultatif (journal de la plateforme)" },
  actionMarquerTitulaireRetour: { regle: "superadmin ; titulaire absent ou suppléant actif ; le suppléant redevient lecteur" },
  actionDepartTitulaire: { regle: "superadmin ; suppléant membre : il devient titulaire, l'ancien perd le rôle Administrateur" },
};

/** Chemin de page d'un « worker » du manifeste (app/app/documents/page → /app/documents). */
function cheminDe(worker) {
  return "/" + worker.replace(/^app\//, "").replace(/\/?page$/, "").replace(/\[[^\]]+\]/g, "x");
}

function lireActions() {
  const manifeste = JSON.parse(fs.readFileSync(path.join(RACINE, ".next/server/server-reference-manifest.json"), "utf8")).node;
  const actions = {};
  for (const [id, v] of Object.entries(manifeste)) {
    assert.ok(!(v.exportedName in actions), `action en double dans le manifeste : ${v.exportedName}`);
    const workers = Object.keys(v.workers);
    // Une page qui déclare l'action (sans segment dynamique si possible : un succès recalcule la page).
    const pages = workers.map(cheminDe);
    const imposee = REGLES[v.exportedName]?.page;
    if (imposee) assert.ok(pages.includes(imposee), `${v.exportedName} : ${imposee} ne déclare pas l'action`);
    const page = imposee ?? cheminDe(workers.find((w) => !w.includes("[")) ?? workers[0]);
    actions[v.exportedName] = { id, fichier: v.filename, page, pages };
  }
  return actions;
}

// ---------- Empreinte des données (toute écriture la change) ----------
// Exclus, car modifiés par la simple lecture d'une page : dernière activité et organisation notée des sessions,
// compteur d'échecs de connexion et date de dernière connexion des comptes.
const EMPREINTE = `SELECT md5(concat_ws('#',
  (SELECT string_agg(row(id, nom, slug, statut, mode_validation)::text, ',' ORDER BY id) FROM platform.organisations),
  (SELECT string_agg(row(id, email, nom, mot_de_passe_hash, est_superadmin, statut, doit_changer_mdp, langue, verrouille_jusqua,
                         mfa_secret_chiffre, mfa_active_le, mfa_dernier_pas, echecs_mfa)::text, ',' ORDER BY id) FROM platform.utilisateurs),
  (SELECT string_agg(row(utilisateur_id, organisation_id, roles, fonction_org, statut_suppleant, date_absence_debut, motif_absence)::text, ',' ORDER BY utilisateur_id, organisation_id) FROM platform.adhesions),
  (SELECT string_agg(row(id, organisation_id, email, roles, fonction_org, acceptee_le, annulee_le)::text, ',' ORDER BY id) FROM platform.invitations),
  (SELECT string_agg(row(utilisateur_id, empreinte, utilise_le)::text, ',' ORDER BY utilisateur_id, empreinte) FROM platform.codes_secours),
  (SELECT string_agg(row(id, utilisateur_id, fin, motif_fin, en_attente_mfa, echecs_mfa)::text, ',' ORDER BY id) FROM platform.sessions),
  (SELECT count(*)::text FROM platform.journal),
  (SELECT string_agg(row(actif, message_fr, message_en, modifie_le, modifie_par)::text, ',') FROM platform.maintenance),
  (SELECT string_agg(row(id, ferme_le)::text, ',' ORDER BY id) FROM platform.acces_urgence),
  (SELECT string_agg(row(id, utilisee_le, annulee_le)::text, ',' ORDER BY id) FROM platform.reinitialisations),
  (SELECT string_agg(query_to_xml(format(
     'SELECT (SELECT string_agg(row(id, titre, version, modifie_le, supprime_le, etat, version_publiee, revue_le)::text, '','' ORDER BY id) FROM %1$I.documents) AS d,
             (SELECT string_agg(row(periode_revue_mois, rappel_jours, escalade_jours, modifie_le)::text, '','') FROM %1$I.parametres) AS pa,
             (SELECT string_agg(row(id, destinataire, lue_le)::text, '','' ORDER BY id) FROM %1$I.notifications) AS n,
             (SELECT string_agg(row(id, version, statut, responsable, echeance, titre, resultat, cloture_par)::text, '','' ORDER BY id) FROM %1$I.actions) AS ac,
             (SELECT string_agg(row(document_id, element_id, sens, seuil, unite, modifie_le)::text, '','' ORDER BY document_id, element_id) FROM %1$I.objectifs_indicateur) AS ob,
             (SELECT string_agg(row(id, valeur, commentaire, saisi_le)::text, '','' ORDER BY id) FROM %1$I.mesures_indicateur) AS me,
             (SELECT count(*) FROM %1$I.versions_document) AS v,
             (SELECT count(*) FROM %1$I.decisions_document) AS dd,
             (SELECT string_agg(row(version, modifie_le)::text, '','') FROM %1$I.cartographie) AS c,
             (SELECT count(*) FROM %1$I.journal) AS j', schema_name), false, false, '')::text, '#' ORDER BY schema_name)
     FROM platform.organisations)))`;
const empreinte = () => sql(EMPREINTE);

// ---------- Profils ----------
const COMPTES = {
  lecteurA: "lect-a@droits.test",
  redacA: "redac-a@droits.test",
  verifA: "verif-a@droits.test",
  approA: "appro-a@droits.test",
  adminA: "admin-a@droits.test",
  adminB: "admin-b@droits.test",
  superadmin: SUPERADMIN.email,
};
const PROFILS = ["faux", "attente", ...Object.keys(COMPTES)];

let navigateur;
const ctx = {};
const poserCookieForge = () => ctx.faux.addCookies([{ name: "authjs.session-token", value: "cookie-forge", url: BASE }]);

/** Mot de passe donné, code du second facteur NON donné : la session reste « en attente ». */
async function connexionEnAttente(email) {
  const c = await navigateur.newContext();
  const p = await c.newPage();
  await p.goto(`${BASE}/connexion`);
  await p.fill('input[name="email"]', email);
  await p.fill('input[name="motDePasse"]', MDP);
  await p.click('button:has-text("Se connecter")');
  await p.waitForURL((u) => u.pathname !== "/connexion");
  assert.equal(new URL(p.url()).pathname, "/connexion/second-facteur", `${email} : le code du second facteur doit être demandé`);
  await p.close();
  return c;
}

// ---------- Requêtes ----------
async function forger(qui, action, champs = {}, { origine = BASE, page } = {}) {
  const a = ACTIONS[action];
  assert.ok(a, `action absente du manifeste : ${action}`);
  if (page) assert.ok(a.pages.includes(page.replace(/[0-9a-f-]{36}/, "x")), `${action} : ${page} ne déclare pas l'action`);
  if (qui === "faux") await poserCookieForge(); // (une réponse peut l'avoir effacé : déconnexion)
  const fd = new FormData();
  // Comme le navigateur : les champs du formulaire D'ABORD (préfixe « _1_ »), puis les arguments (« 0 »).
  for (const [k, v] of Object.entries(champs)) for (const x of [].concat(v)) fd.append(`_1_${k}`, x);
  fd.append("0", JSON.stringify(REGLES[action].simple ? ["$K1"] : [{ ok: false, message: null, jeton: 0 }, "$K1"]));
  const r = await ctx[qui].request.post(BASE + (page ?? a.page), {
    headers: { "Next-Action": a.id, Accept: "text/x-component", Origin: origine },
    multipart: fd,
    maxRedirects: 0,
    failOnStatusCode: false,
  });
  const corps = await r.text();
  assert.equal(r.headers()["x-nextjs-action-not-found"], undefined, `${action} : action introuvable pour Next.js`);
  const etat = /\{"ok":(true|false),"message":(null|"(?:[^"\\]|\\.)*")/.exec(corps);
  const redirection = r.headers()["x-action-redirect"];
  return {
    statut: r.status(),
    corps,
    redirection: redirection ? redirection.split(";")[0] : null,
    ok: etat ? etat[1] === "true" : null,
    message: etat ? JSON.parse(etat[2]) : null,
    lien: (/"lien":"(\/invitation\/[A-Za-z0-9_-]{43})"/.exec(corps) || [])[1] ?? null,
  };
}

/** Résultat attendu → contrôle. Refus : « session », « 404 », « origine », « redirection:/x », ou une clé de message. */
function controler(r, attendu, libelle) {
  if (attendu === "succes") {
    assert.equal(r.ok, true, `${libelle} : succès attendu (statut ${r.statut}, message ${r.message}, redirection ${r.redirection})`);
  } else if (attendu === "session") {
    assert.equal(r.redirection, "/connexion", `${libelle} : renvoi vers la connexion attendu (statut ${r.statut}, message ${r.message})`);
  } else if (attendu === "404") {
    assert.equal(r.statut, 404, `${libelle} : « page introuvable » attendue (statut ${r.statut}, message ${r.message})`);
    assert.equal(r.ok, null, `${libelle} : aucun résultat d'action`);
  } else if (attendu === "origine") {
    assert.equal(r.statut, 500, `${libelle} : refus de l'origine attendu (statut ${r.statut})`);
    assert.match(r.corps, /^\d+:E\{"digest":/m, `${libelle} : erreur Next.js attendue`);
  } else if (attendu.startsWith("redirection^")) {
    assert.ok(r.redirection && r.redirection.startsWith(attendu.slice("redirection^".length)), `${libelle} : redirection vers ${attendu.slice(12)}… (obtenu ${r.redirection}, statut ${r.statut}, message ${r.message})`);
  } else if (attendu.startsWith("redirection:")) {
    assert.equal(r.redirection, attendu.slice("redirection:".length), `${libelle} : redirection (statut ${r.statut}, message ${r.message})`);
  } else {
    assert.equal(r.ok, false, `${libelle} : refus « ${attendu} » attendu (statut ${r.statut}, redirection ${r.redirection})`);
    assert.equal(r.message, texte(attendu), `${libelle} : message`);
  }
}

const bilanActions = {}; // action → profil → [résultats]
let origineEssayee = 0;
let fauxEssaye = 0;
let fauxDeconnecte = 0;
let mauvaisMotDePasse = 0;

/**
 * Un appel d'action : `attendu` (voir controler) ; pour un refus, AUCUNE écriture en base. `effet` : contrôle en base
 * d'un succès (ou d'un refus dont l'empreinte change légitimement, avec `sansEmpreinte`).
 */
async function cas(qui, action, champs, attendu, { effet, origine, sansEmpreinte, note, page } = {}) {
  const libelle = `${action} / ${qui}${note ? ` (${note})` : ""}`;
  // Refus : renvoi vers la connexion, « introuvable », origine refusée, message d'erreur, ou renvoi vers le choix
  // d'organisation ou vers la page de maintenance. Le reste (« succes », autres redirections) est un succès.
  const refus = !(attendu === "succes" || attendu.startsWith("redirection^")
    || (attendu.startsWith("redirection:") && attendu !== "redirection:/choisir-organisation" && attendu !== "redirection:/maintenance"));
  const avant = refus && !sansEmpreinte ? empreinte() : null;
  const r = await forger(qui, action, champs, { origine, page });
  if (origine && origine !== BASE) origineEssayee++;
  if (qui === "faux") fauxEssaye++;
  if (qui === "faux" && (action === "actionDeconnexion" || action === "actionAbandonnerConnexion")) fauxDeconnecte++;
  if (action === "actionConnexion" && attendu === "connexion.echec") mauvaisMotDePasse++;
  controler(r, attendu, libelle);
  if (avant !== null) assert.equal(empreinte(), avant, `${libelle} : la base a changé alors que l'action est refusée`);
  if (effet) assert.ok(effet(r), `${libelle} : effet attendu absent en base`);
  ((bilanActions[action] ??= {})[qui] ??= []).push(refus ? "✖" : "✔");
  return r;
}

// ---------- Pages et API ----------
async function page(qui, chemin) {
  const r = await ctx[qui].request.get(BASE + chemin, { failOnStatusCode: false });
  return { statut: r.status(), arrivee: new URL(r.url()).pathname };
}

async function api(qui, methode, chemin, corps, { origine = BASE, sansOrigine = false } = {}) {
  const avant = empreinte();
  const entetes = corps === undefined ? {} : { "Content-Type": "application/json" };
  if (!sansOrigine) entetes.Origin = origine;
  const r = await ctx[qui].request.fetch(BASE + chemin, { method: methode, headers: entetes, data: corps === undefined ? undefined : JSON.stringify(corps), failOnStatusCode: false });
  let json = null;
  try { json = await r.json(); } catch { /* corps vide */ }
  return { statut: r.status(), json, avant };
}

let ACTIONS;

(async () => {
  navigateur = await lancer();
  ACTIONS = lireActions();
  const journalServeur = path.join(ETAT, "serveur.log");
  const debutJournal = fs.existsSync(journalServeur) ? fs.statSync(journalServeur).size : null;

  etape("la matrice couvre EXACTEMENT les actions de la construction");
  assert.deepEqual(Object.keys(ACTIONS).sort(), Object.keys(REGLES).sort());
  console.log(`  ${Object.keys(ACTIONS).length} actions serveur`);

  // Identifiants des données de départ (tests/e2e/preparer.ts).
  const ORG_A = sql("SELECT id FROM platform.organisations WHERE slug = 'droits-a'");
  const ORG_B = sql("SELECT id FROM platform.organisations WHERE slug = 'droits-b'");
  const SCHEMA_A = sql("SELECT schema_name FROM platform.organisations WHERE slug = 'droits-a'");
  const SCHEMA_B = sql("SELECT schema_name FROM platform.organisations WHERE slug = 'droits-b'");
  const idDe = (email) => sql(`SELECT id FROM platform.utilisateurs WHERE email = '${email}'`);
  const [CIBLE_A, RETRAIT_A, JETABLE, MFA_A, LECT_A, SUPPLEANT_A, ADMIN_A] = ["cible-a", "retrait-a", "jetable", "mfa-a", "lect-a", "suppleant-a", "admin-a"].map((n) => idDe(`${n}@droits.test`));
  for (const v of [ORG_A, ORG_B, CIBLE_A, RETRAIT_A, JETABLE, MFA_A, LECT_A, SUPPLEANT_A, ADMIN_A]) assert.match(v, /^[0-9a-f-]{36}$/, "données de départ absentes (tests/e2e/preparer.ts)");
  const ORG_DE = { lecteurA: ORG_A, redacA: ORG_A, verifA: ORG_A, approA: ORG_A, adminA: ORG_A, adminB: ORG_B };

  etape("profils : cookie forgé, connexion en attente du second facteur, sept comptes connectés");
  ctx.faux = await navigateur.newContext();
  await poserCookieForge();
  ctx.anonyme = await navigateur.newContext();
  ctx.attente = await connexionEnAttente("mfa-a@droits.test");
  for (const [qui, email] of Object.entries(COMPTES)) ctx[qui] = (await connecter(email)).context();

  // ======================================================================================== pages
  etape("pages × profils (code HTTP, page d'arrivée)");
  const ADMINS = ["adminA", "adminB"];
  const accueil = { lecteurA: "/app", redacA: "/app", verifA: "/app", approA: "/app", adminA: "/app", adminB: "/app", superadmin: "/plateforme" };
  /** Attendu : « 200 » (la page elle-même), « 404 », ou « →/chemin » (redirigé, arrivée en 200). */
  function attendus(chemin, regle) {
    const a = { faux: "→/connexion", attente: "→/connexion/second-facteur" };
    for (const qui of Object.keys(COMPTES)) a[qui] = regle(qui);
    return [chemin, a];
  }
  const PLATEFORME = ["/plateforme", "/plateforme/organisations", "/plateforme/organisations/nouvelle", `/plateforme/organisations/${ORG_A}`,
    "/plateforme/utilisateurs", `/plateforme/utilisateurs/${LECT_A}`, "/plateforme/sessions", "/plateforme/journal", "/plateforme/droits", "/plateforme/maintenance"];
  // Un document de A, pour ses pages d'historique et de validation : B ne les trouve pas (404), même avec l'identifiant.
  const docPages = await api("redacA", "POST", "/api/documents", { organisationId: ORG_A, contenu: { meta: { typeDocument: "procedure", titre: "Pour les pages" }, roles: [], etapes: [] } });
  assert.equal(docPages.statut, 201);
  const pageDeA = (q) => (q === "superadmin" ? "→/choisir-organisation" : q === "adminB" ? "404" : "200");
  // QSE : un document de A portant un risque (k1) et un indicateur (instruction e1), et une action de A.
  const contenuQse = { meta: { typeDocument: "procedure", titre: "Pour le QSE", reference: "PR-DROITS-QSE" }, roles: [],
    etapes: [{ id: "e1", libelle: "Mesurer", risques: [{ id: "k1", risque: "Risque d'essai", gravite: "2", probabilite: "2" }], indicateur: { actif: true, nom: "Indicateur d'essai" } }] };
  const docQse = await api("redacA", "POST", "/api/documents", { organisationId: ORG_A, contenu: contenuQse });
  assert.equal(docQse.statut, 201);
  const DOCQ = docQse.json.id;
  const SCHEMA_A_PAGES = sql("SELECT schema_name FROM platform.organisations WHERE slug = 'droits-a'");
  sql(`INSERT INTO "${SCHEMA_A_PAGES}".actions (titre, origine) VALUES ('Action des pages', 'autre')`);
  const ACTION_PAGES = sql(`SELECT id FROM "${SCHEMA_A_PAGES}".actions WHERE titre = 'Action des pages'`);
  const GERENT = ["redacA", "verifA", "approA", "adminA", "adminB"];
  const PAGES = [
    attendus("/app", (q) => (q === "superadmin" ? "→/choisir-organisation" : "200")),
    attendus("/app/documents", (q) => (q === "superadmin" ? "→/choisir-organisation" : "200")),
    attendus("/app/documents/corbeille", (q) => (q === "superadmin" ? "→/choisir-organisation" : "200")),
    attendus(`/app/documents/${docPages.json.id}/historique`, pageDeA),
    attendus(`/app/documents/${docPages.json.id}/validation`, pageDeA),
    attendus("/app/notifications", (q) => (q === "superadmin" ? "→/choisir-organisation" : "200")),
    attendus("/app/risques", (q) => (q === "superadmin" ? "→/choisir-organisation" : "200")),
    attendus("/app/actions", (q) => (q === "superadmin" ? "→/choisir-organisation" : "200")),
    attendus("/app/actions/nouvelle", (q) => (q === "superadmin" ? "→/choisir-organisation" : GERENT.includes(q) ? "200" : "404")),
    attendus(`/app/actions/${ACTION_PAGES}`, pageDeA),
    attendus("/app/indicateurs", (q) => (q === "superadmin" ? "→/choisir-organisation" : "200")),
    attendus(`/app/indicateurs/detail?document=${DOCQ}&element=e1`, pageDeA),
    attendus("/app/parametres", (q) => (q === "superadmin" ? "→/choisir-organisation" : ADMINS.includes(q) ? "200" : "404")),
    attendus("/app/membres", (q) => (q === "superadmin" ? "→/choisir-organisation" : ADMINS.includes(q) ? "200" : "404")),
    attendus("/app/journal", (q) => (q === "superadmin" ? "→/choisir-organisation" : ADMINS.includes(q) ? "200" : "404")),
    attendus("/choisir-organisation", () => "200"),
    attendus("/compte/mot-de-passe", () => "200"),
    attendus("/compte/second-facteur", () => "200"),
    ...PLATEFORME.map((c) => attendus(c, (q) => (q === "superadmin" ? "200" : "404"))),
    ["/connexion", { faux: "200", attente: "→/connexion/second-facteur", ...Object.fromEntries(Object.keys(COMPTES).map((q) => [q, `→${accueil[q]}`])) }],
    // Lien de réinitialisation (public) : un lien inconnu montre « lien non valable », à tout le monde.
    [`/reinitialisation/${"x".repeat(43)}`, Object.fromEntries(PROFILS.map((q) => [q, "200"]))],
    ["/connexion/second-facteur", { faux: "→/connexion", attente: "200", ...Object.fromEntries(Object.keys(COMPTES).map((q) => [q, `→${accueil[q]}`])) }],
  ];
  const lignes = [];
  for (const [chemin, a] of PAGES) {
    const cellules = [];
    for (const qui of PROFILS) {
      const r = await page(qui, chemin);
      const obtenu = r.statut === 404 ? "404" : r.statut === 200 ? (r.arrivee === chemin.split("?")[0] ? "200" : `→${r.arrivee}`) : `HTTP ${r.statut}`;
      assert.equal(obtenu, a[qui], `page ${chemin} / ${qui}`);
      cellules.push(obtenu.replace("→/connexion/second-facteur", "→code").replace("→/choisir-organisation", "→choix").padEnd(12));
    }
    lignes.push(`  ${chemin.replace(/[0-9a-f-]{36}/, "<id>").padEnd(36)} ${cellules.join("")}`);
  }
  console.log(`  ${"".padEnd(36)} ${PROFILS.map((p) => p.padEnd(12)).join("")}`);
  for (const l of lignes) console.log(l);
  console.log(`  ✔ ${PAGES.length} pages × ${PROFILS.length} profils`);
  // (Sans aucun cookie, le filtre « proxy » renvoie vers la connexion avant même la page : c'est un confort ; ce
  // sont les profils « faux » et « attente » ci-dessus qui éprouvent la vraie vérification.)

  // ======================================================================================== API
  etape("API de l'éditeur × profils (refus sans écriture en base)");
  const procedure = (titre) => ({ meta: { typeDocument: "procedure", titre, reference: "PR-DROITS" }, roles: [], etapes: [] });
  const sansEffet = (r, libelle) => assert.equal(empreinte(), r.avant, `${libelle} : la base a changé`);
  for (const qui of PROFILS) {
    const r = await api(qui, "GET", "/api/editeur/contexte");
    const attendu = { faux: 401, attente: 401, superadmin: 403 }[qui] ?? 200;
    assert.equal(r.statut, attendu, `GET /api/editeur/contexte / ${qui}`);
    if (attendu === 200) assert.equal(r.json.organisation.id, ORG_DE[qui], `contexte / ${qui} : SON organisation`);
    sansEffet(r, `GET contexte / ${qui}`);
  }
  // Création : seuls rédacteur et administrateur de A ; B ne peut pas écrire dans A (409 : ce n'est pas son
  // organisation ouverte) ; sans Origin ou depuis un autre site : 403.
  const creation = { organisationId: ORG_A, contenu: procedure("Créée par l'API") };
  for (const [qui, attendu] of [["faux", 401], ["attente", 401], ["lecteurA", 403], ["verifA", 403], ["approA", 403], ["adminB", 409], ["superadmin", 403]]) {
    const r = await api(qui, "POST", "/api/documents", creation);
    assert.equal(r.statut, attendu, `POST /api/documents / ${qui}`);
    sansEffet(r, `POST documents / ${qui}`);
  }
  for (const [note, options] of [["sans Origin", { sansOrigine: true }], ["autre site", { origine: ETRANGERE }]]) {
    const r = await api("redacA", "POST", "/api/documents", creation, options);
    assert.deepEqual([r.statut, r.json?.erreur], [403, "origine"], `POST /api/documents / redacA ${note}`);
    sansEffet(r, `POST documents ${note}`);
  }
  const creeApi = await api("redacA", "POST", "/api/documents", creation);
  assert.equal(creeApi.statut, 201, "POST /api/documents / redacA");
  const DOC_API = creeApi.json.id;
  assert.equal(sql(`SELECT count(*) FROM "${SCHEMA_A}".documents WHERE id = '${DOC_API}'`), "1", "document créé dans A");
  // Enregistrement : B ne trouve pas le document de A dans SA propre organisation (404) ; avec l'identifiant de A : 409.
  const V = Number(sql(`SELECT version FROM "${SCHEMA_A}".documents WHERE id = '${DOC_API}'`));
  const enreg = (org, version) => ({ organisationId: org, version, contenu: procedure("Modifiée par l'API") });
  for (const [qui, corps, attendu] of [
    ["faux", enreg(ORG_A, V), 401], ["attente", enreg(ORG_A, V), 401], ["lecteurA", enreg(ORG_A, V), 403], ["verifA", enreg(ORG_A, V), 403],
    ["adminB", enreg(ORG_B, V), 404], ["adminB", enreg(ORG_A, V), 409], ["superadmin", enreg(ORG_A, V), 403],
  ]) {
    const r = await api(qui, "PUT", `/api/documents/${DOC_API}`, corps);
    assert.equal(r.statut, attendu, `PUT /api/documents / ${qui} (${corps.organisationId === ORG_B ? "org B" : "org A"})`);
    sansEffet(r, `PUT document / ${qui}`);
  }
  const modifie = await api("adminA", "PUT", `/api/documents/${DOC_API}`, enreg(ORG_A, V));
  assert.equal(modifie.statut, 200, "PUT /api/documents / adminA");
  assert.equal(sql(`SELECT version FROM "${SCHEMA_A}".documents WHERE id = '${DOC_API}'`), String(V + 1));
  assert.equal(sql(`SELECT count(*) FROM "${SCHEMA_B}".documents`), "0", "rien dans B");
  // Cartographie.
  const carto = { organisationId: ORG_A, version: 0, contenu: { processus: [], flux: [], documents: [] } };
  for (const [qui, attendu] of [["faux", 401], ["attente", 401], ["lecteurA", 403], ["verifA", 403], ["adminB", 409], ["superadmin", 403]]) {
    const r = await api(qui, "PUT", "/api/cartographie", carto);
    assert.equal(r.statut, attendu, `PUT /api/cartographie / ${qui}`);
    sansEffet(r, `PUT cartographie / ${qui}`);
  }
  assert.equal((await api("redacA", "PUT", "/api/cartographie", carto)).statut, 200, "PUT /api/cartographie / redacA");
  assert.equal(sql(`SELECT version FROM "${SCHEMA_A}".cartographie`), "1");
  assert.equal(sql(`SELECT version FROM "${SCHEMA_B}".cartographie`), "0", "cartographie de B intacte");
  console.log("  ✔ contexte, création, enregistrement, cartographie");

  // ======================================================================================== actions : documents
  etape("actions « documents »");
  const nbDocsA = () => Number(sql(`SELECT count(*) FROM "${SCHEMA_A}".documents`));
  const nouveau = { organisationId: ORG_A, type: "procedure" };
  for (const qui of ["faux", "attente"]) await cas(qui, "actionCreerDocument", nouveau, "session");
  for (const qui of ["lecteurA", "verifA", "adminB", "superadmin"]) await cas(qui, "actionCreerDocument", nouveau, "erreur.interdit");
  await cas("redacA", "actionCreerDocument", nouveau, "origine", { origine: ETRANGERE, note: "autre site" });
  let n = nbDocsA();
  await cas("redacA", "actionCreerDocument", nouveau, "succes", { effet: () => nbDocsA() === n + 1 });
  const DOC = sql(`SELECT id FROM "${SCHEMA_A}".documents ORDER BY cree_le DESC LIMIT 1`);
  n = nbDocsA();
  await cas("adminA", "actionCreerDocument", { organisationId: ORG_A, type: "instruction" }, "succes", { effet: () => nbDocsA() === n + 1 });

  const suppression = { organisationId: ORG_A, documentId: DOC };
  for (const qui of ["faux", "attente"]) await cas(qui, "actionSupprimerDocument", suppression, "session");
  for (const qui of ["lecteurA", "verifA", "adminB", "superadmin"]) await cas(qui, "actionSupprimerDocument", suppression, "erreur.interdit");
  await cas("adminB", "actionSupprimerDocument", { organisationId: ORG_B, documentId: DOC }, "erreur.introuvable", { note: "document de A depuis B" });
  const aLaCorbeille = (id) => sql(`SELECT supprime_le IS NOT NULL FROM "${SCHEMA_A}".documents WHERE id = '${id}'`) === "t";
  await cas("redacA", "actionSupprimerDocument", suppression, "succes", { effet: () => aLaCorbeille(DOC) });
  // Procédure liée à une instruction de travail (D2) : sans confirmation, refus sans écriture ; confirmée, seule la
  // procédure est supprimée.
  const liee = await api("redacA", "POST", "/api/documents", { organisationId: ORG_A, contenu: { ...procedure("Procédure liée"), etapes: [{ id: "e1", niveau3: { actif: true, code: "IT-LIEN-01" } }] } });
  const itLiee = await api("redacA", "POST", "/api/documents", { organisationId: ORG_A, contenu: { meta: { typeDocument: "instruction", titre: "Instruction liée", reference: "IT-LIEN-01" }, roles: [], etapes: [] } });
  assert.deepEqual([liee.statut, itLiee.statut], [201, 201]);
  const existe = (id) => !aLaCorbeille(id);
  await cas("redacA", "actionSupprimerDocument", { organisationId: ORG_A, documentId: liee.json.id }, "docs.suppression_liee", { note: "liée, sans confirmation" });
  await cas("redacA", "actionSupprimerDocument", { organisationId: ORG_A, documentId: itLiee.json.id }, "docs.suppression_liee", { note: "instruction citée, sans confirmation" });
  await cas("adminA", "actionSupprimerDocument", { organisationId: ORG_A, documentId: liee.json.id, confirmerLiens: "1" }, "succes",
    { note: "liée, confirmée", effet: () => !existe(liee.json.id) && existe(itLiee.json.id) });

  // Corbeille (D1) : rétablir = droit de suppression, dans SON organisation.
  const retablir = { organisationId: ORG_A, documentId: DOC };
  for (const qui of ["faux", "attente"]) await cas(qui, "actionRetablirDocument", retablir, "session");
  for (const qui of ["lecteurA", "verifA", "adminB", "superadmin"]) await cas(qui, "actionRetablirDocument", retablir, "erreur.interdit");
  await cas("adminB", "actionRetablirDocument", { organisationId: ORG_B, documentId: DOC }, "erreur.introuvable", { note: "document de A depuis B" });
  await cas("redacA", "actionRetablirDocument", retablir, "succes", { effet: () => !aLaCorbeille(DOC) });

  // Restauration d'une version (D1) : droit de rédaction, dans SON organisation, sur la version actuelle vue.
  const versionDe = (id) => Number(sql(`SELECT version FROM "${SCHEMA_A}".documents WHERE id = '${id}'`));
  const enregistre = await api("redacA", "PUT", `/api/documents/${DOC}`, { organisationId: ORG_A, version: versionDe(DOC), forcer: true, contenu: procedure("Version 2") });
  assert.equal(enregistre.statut, 200);
  const restaurer = { organisationId: ORG_A, documentId: DOC, version: "1", versionActuelle: String(versionDe(DOC)) };
  for (const qui of ["faux", "attente"]) await cas(qui, "actionRestaurerVersion", restaurer, "session");
  for (const qui of ["lecteurA", "verifA", "adminB", "superadmin"]) await cas(qui, "actionRestaurerVersion", restaurer, "erreur.interdit");
  await cas("adminB", "actionRestaurerVersion", { ...restaurer, organisationId: ORG_B }, "erreur.introuvable", { note: "document de A depuis B" });
  await cas("redacA", "actionRestaurerVersion", { ...restaurer, versionActuelle: "1" }, "versions.document_modifie", { note: "page périmée" });
  const avantRestauration = versionDe(DOC);
  await cas("adminA", "actionRestaurerVersion", restaurer, "succes", {
    effet: () => versionDe(DOC) === avantRestauration + 1
      && sql(`SELECT d.contenu = v.contenu FROM "${SCHEMA_A}".documents d JOIN "${SCHEMA_A}".versions_document v ON v.document_id = d.id AND v.version = 1 WHERE d.id = '${DOC}'`) === "t",
  });

  // ======================================================================================== actions : circuit
  // Circuit de validation (W1) : chaque décision demande SON droit, dans SON organisation, sur la version vue ; la
  // séparation des tâches et le motif sont vérifiés par le serveur ; un document soumis ne se modifie plus (ni par
  // l'API, ni par la restauration, ni par la corbeille). Succès : la page de validation est rechargée (?etat=…).
  etape("actions « circuit de validation »");
  const docC = await api("redacA", "POST", "/api/documents", { organisationId: ORG_A, contenu: procedure("Circuit v1") });
  assert.equal(docC.statut, 201);
  const DOCC = docC.json.id;
  assert.equal((await api("redacA", "PUT", `/api/documents/${DOCC}`, { organisationId: ORG_A, version: 1, contenu: procedure("Circuit v2") })).statut, 200);
  const PAGE_C = `/app/documents/${DOCC}/validation`;
  const etatC = () => sql(`SELECT etat || '/' || coalesce(version_publiee::text, '-') FROM "${SCHEMA_A}".documents WHERE id = '${DOCC}'`);
  const decisionsC = () => Number(sql(`SELECT count(*) FROM "${SCHEMA_A}".decisions_document WHERE document_id = '${DOCC}'`));
  // Soumettre, vérifier, approuver : la fonction de la personne est demandée (TC-03) ; ignorée pour les autres décisions.
  const decision = (transition, motif = "") => ({ organisationId: ORG_A, documentId: DOCC, transition, versionVue: String(versionDe(DOCC)), motif, fonction: "Responsable QSE" });
  const vers = (etat) => `redirection:${PAGE_C}?etat=${etat}`;
  const casC = (qui, champs, attendu, options = {}) => cas(qui, "actionTransitionDocument", champs, attendu, { page: PAGE_C, ...options });
  const reussite = async (qui, transition, etat, motif = "") => {
    const n0 = decisionsC();
    await casC(qui, decision(transition, motif), vers(etat), { note: transition, effet: () => etatC().startsWith(`${etat}/`) && decisionsC() === n0 + 1 });
  };

  // Soumettre : rédaction.
  for (const qui of ["faux", "attente"]) await casC(qui, decision("soumettre"), "session");
  for (const qui of ["lecteurA", "verifA", "approA", "adminB", "superadmin"]) await casC(qui, decision("soumettre"), "erreur.interdit");
  await casC("adminB", { ...decision("soumettre"), organisationId: ORG_B }, "erreur.introuvable", { note: "document de A depuis B" });
  await casC("redacA", decision("publier"), "erreur.saisie_invalide", { note: "décision inconnue" });
  await casC("redacA", { ...decision("soumettre"), versionVue: "1" }, "versions.document_modifie", { note: "page périmée" });
  await casC("redacA", { ...decision("soumettre"), fonction: "" }, "circuit.fonction_requise", { note: "sans fonction (TC-03)" });
  await casC("verifA", decision("verifier"), "circuit.etat_incompatible", { note: "vérifier un brouillon (pas encore soumis)" });
  await casC("redacA", decision("soumettre"), "origine", { origine: ETRANGERE, note: "autre site" });
  await reussite("redacA", "soumettre", "en_verification");
  // Document soumis : figé.
  const figee = await api("redacA", "PUT", `/api/documents/${DOCC}`, { organisationId: ORG_A, version: versionDe(DOCC), forcer: true, contenu: procedure("Modifiée en circuit") });
  assert.deepEqual([figee.statut, figee.json?.erreur], [403, "circuit"], "PUT d'un document soumis");
  sansEffet(figee, "PUT document soumis");
  assert.equal((await api("redacA", "GET", `/api/editeur/contexte?doc=${DOCC}`)).json.droits.rediger, false, "l'éditeur s'ouvre en lecture seule");
  await cas("redacA", "actionSupprimerDocument", { organisationId: ORG_A, documentId: DOCC }, "circuit.suppression_impossible", { note: "document soumis" });
  await cas("redacA", "actionRestaurerVersion", { organisationId: ORG_A, documentId: DOCC, version: "1", versionActuelle: String(versionDe(DOCC)) }, "circuit.non_modifiable",
    { page: `/app/documents/${DOCC}/historique`, note: "document soumis" });

  // Vérifier : vérificateur, pas l'auteur ; refuser exige un motif.
  for (const qui of ["faux", "attente"]) await casC(qui, decision("verifier"), "session");
  for (const qui of ["lecteurA", "redacA", "approA", "adminA", "adminB", "superadmin"]) await casC(qui, decision("verifier"), "erreur.interdit");
  await casC("verifA", decision("refuser_verification"), "circuit.motif_requis", { note: "refus sans motif" });
  await casC("verifA", { ...decision("verifier"), fonction: " " }, "circuit.fonction_requise", { note: "sans fonction (TC-03)" });
  await reussite("verifA", "verifier", "en_approbation");

  // Approuver : approbateur, pas celui qui a vérifié.
  for (const qui of ["faux", "attente"]) await casC(qui, decision("approuver"), "session");
  for (const qui of ["lecteurA", "redacA", "adminA", "adminB", "superadmin"]) await casC(qui, decision("approuver"), "erreur.interdit");
  await casC("verifA", decision("approuver"), "circuit.separation_verificateur", { note: "il a vérifié cette version" });
  await reussite("approA", "approuver", "publie");
  assert.equal(etatC(), `publie/${versionDe(DOCC)}`, "version publiée notée");

  // Réviser (rédaction) puis un nouveau cycle ; archiver (approbateur, motif obligatoire).
  for (const qui of ["lecteurA", "verifA", "approA"]) await casC(qui, decision("reviser"), "erreur.interdit");
  await reussite("redacA", "reviser", "brouillon");
  assert.equal(etatC(), `brouillon/${versionDe(DOCC)}`, "la version publiée reste connue pendant la révision");
  await reussite("redacA", "soumettre", "en_verification");
  await casC("approA", decision("refuser_verification", "Non"), "erreur.interdit", { note: "un approbateur ne vérifie pas" });
  await reussite("verifA", "refuser_verification", "brouillon", "Étape 1 à préciser.");
  await reussite("redacA", "soumettre", "en_verification");
  await reussite("verifA", "verifier", "en_approbation");
  await reussite("approA", "approuver", "publie");
  for (const qui of ["faux", "attente"]) await casC(qui, decision("archiver", "Remplacé"), "session");
  for (const qui of ["lecteurA", "redacA", "adminA"]) await casC(qui, decision("archiver", "Remplacé"), "erreur.interdit");
  await casC("approA", decision("archiver"), "circuit.motif_requis", { note: "archiver sans motif" });
  await reussite("approA", "archiver", "archive", "Remplacé par une nouvelle procédure.");
  await casC("redacA", decision("reviser"), "circuit.etat_incompatible", { note: "l'archivage est définitif" });
  assert.equal(sql(`SELECT string_agg(transition, ',' ORDER BY id) FROM "${SCHEMA_A}".decisions_document WHERE document_id = '${DOCC}'`),
    "soumettre,verifier,approuver,reviser,soumettre,refuser_verification,soumettre,verifier,approuver,archiver");

  // ======================================================================================== actions : QSE
  // Plan d'actions : actions.gerer. Objectifs : indicateurs.objectifs (administrateur, approbateur). Mesures :
  // indicateurs.mesurer. Toujours dans l'organisation OUVERTE, sur les données de CETTE organisation.
  etape("actions « QSE » (plan d'actions, objectifs, mesures)");
  const nbActionsA = () => Number(sql(`SELECT count(*) FROM "${SCHEMA_A}".actions`));
  const ID_ADMIN_B = idDe("admin-b@droits.test");
  const ID_REDAC_A = idDe("redac-a@droits.test");
  const nouvelle = { organisationId: ORG_A, titre: "Action d'essai", description: "", origine: "risque", responsableId: ID_REDAC_A, echeance: "2026-12-31", documentId: DOCQ, elementId: "k1" };
  for (const qui of ["faux", "attente"]) await cas(qui, "actionCreerAction", nouvelle, "session");
  for (const qui of ["lecteurA", "adminB", "superadmin"]) await cas(qui, "actionCreerAction", nouvelle, "erreur.interdit");
  await cas("adminB", "actionCreerAction", { ...nouvelle, organisationId: ORG_B, responsableId: "" }, "actions.erreur.document", { note: "document de A depuis B" });
  await cas("redacA", "actionCreerAction", { ...nouvelle, responsableId: ID_ADMIN_B }, "actions.erreur.responsable", { note: "responsable d'une autre organisation" });
  await cas("redacA", "actionCreerAction", { ...nouvelle, elementId: "k-inconnu" }, "actions.erreur.document", { note: "élément absent du document" });
  let nA = nbActionsA();
  await cas("redacA", "actionCreerAction", nouvelle, "redirection^/app/actions/", { effet: () => nbActionsA() === nA + 1 });
  const ACTION_A = sql(`SELECT id FROM "${SCHEMA_A}".actions WHERE titre = 'Action d''essai'`);
  assert.equal(sql(`SELECT element_libelle FROM "${SCHEMA_A}".actions WHERE id = '${ACTION_A}'`), "Risque d'essai", "texte de l'élément lu dans le document");
  const modification = { organisationId: ORG_A, actionId: ACTION_A, version: "1", titre: "Action d'essai", description: "", origine: "risque", responsableId: ID_REDAC_A, echeance: "2026-12-31", statut: "en_cours", resultat: "", efficace: "" };
  const PAGE_ACTION = `/app/actions/${ACTION_A}`;
  for (const qui of ["faux", "attente"]) await cas(qui, "actionModifierAction", modification, "session", { page: PAGE_ACTION });
  for (const qui of ["lecteurA", "adminB", "superadmin"]) await cas(qui, "actionModifierAction", modification, "erreur.interdit", { page: PAGE_ACTION });
  await cas("adminB", "actionModifierAction", { ...modification, organisationId: ORG_B }, "erreur.introuvable", { page: PAGE_ACTION, note: "action de A depuis B" });
  await cas("verifA", "actionModifierAction", { ...modification, version: "7" }, "actions.modifiee", { page: PAGE_ACTION, note: "page périmée" });
  await cas("verifA", "actionModifierAction", { ...modification, statut: "cloturee", efficace: "oui" }, "actions.statut_impossible", { page: PAGE_ACTION, note: "à faire → close" });
  const etatAction = () => sql(`SELECT statut || '/' || version FROM "${SCHEMA_A}".actions WHERE id = '${ACTION_A}'`);
  await cas("verifA", "actionModifierAction", modification, "succes", { page: PAGE_ACTION, effet: () => etatAction() === "en_cours/2" });
  // Décision n° 5 : le responsable (même gestionnaire) ne clôt ni n'abandonne SON action.
  await cas("redacA", "actionModifierAction", { ...modification, version: "2", statut: "abandonnee", resultat: "Plus d'objet" }, "actions.cloture_responsable", { page: PAGE_ACTION, note: "gestionnaire responsable : abandon" });

  // Un lecteur responsable d'une action : formulaire réduit (avancement, compte rendu), sans clôture ni abandon.
  await cas("redacA", "actionCreerAction", { ...nouvelle, titre: "Action du lecteur", responsableId: LECT_A, documentId: "", elementId: "" }, "redirection^/app/actions/", { effet: () => nbActionsA() === nA + 2 });
  const ACTION_L = sql(`SELECT id FROM "${SCHEMA_A}".actions WHERE titre = 'Action du lecteur'`);
  const PAGE_ACTION_L = `/app/actions/${ACTION_L}`;
  const etatActionL = () => sql(`SELECT statut || '/' || version || '/' || coalesce(cloture_par::text, '-') FROM "${SCHEMA_A}".actions WHERE id = '${ACTION_L}'`);
  const avancement = (version, statut, plus = {}) => ({ organisationId: ORG_A, actionId: ACTION_L, version, statut, resultat: "", efficace: "", avancement: "1", ...plus });
  await cas("lecteurA", "actionModifierAction", { ...avancement("1", "en_cours"), actionId: ACTION_A, version: "2" }, "erreur.interdit", { page: PAGE_ACTION, note: "lecteur, action d'un autre" });
  await cas("lecteurA", "actionModifierAction", avancement("1", "en_cours"), "succes", { page: PAGE_ACTION_L, note: "lecteur responsable : avancement", effet: () => etatActionL() === "en_cours/2/-" });
  await cas("lecteurA", "actionModifierAction", avancement("2", "realisee", { resultat: "Fait" }), "succes", { page: PAGE_ACTION_L, note: "lecteur responsable : réalisée", effet: () => etatActionL() === "realisee/3/-" });
  await cas("lecteurA", "actionModifierAction", avancement("3", "cloturee", { resultat: "Vérifié", efficace: "oui" }), "actions.cloture_responsable", { page: PAGE_ACTION_L, note: "lecteur responsable : clôture" });
  await cas("lecteurA", "actionModifierAction", avancement("3", "abandonnee", { resultat: "Plus d'objet" }), "actions.cloture_responsable", { page: PAGE_ACTION_L, note: "lecteur responsable : abandon" });
  await cas("lecteurA", "actionModifierAction", { ...modification, actionId: ACTION_L, version: "3", statut: "realisee", resultat: "Fait", responsableId: LECT_A, titre: "Autre titre", echeance: "2026-12-31" }, "actions.reserve_gestion", { page: PAGE_ACTION_L, note: "lecteur responsable : intitulé" });
  await cas("lecteurA", "actionModifierAction", { ...modification, actionId: ACTION_L, version: "3", statut: "realisee", resultat: "Fait", titre: "Action du lecteur", responsableId: "", echeance: "2026-12-31" }, "actions.reserve_gestion", { page: PAGE_ACTION_L, note: "lecteur responsable : se retire" });
  const ID_VERIF_A = idDe("verif-a@droits.test");
  await cas("verifA", "actionModifierAction", avancement("3", "cloturee", { resultat: "Vérifié", efficace: "oui" }), "succes", { page: PAGE_ACTION_L, note: "autre gestionnaire : clôture", effet: () => etatActionL() === `cloturee/4/${ID_VERIF_A}` });

  const objectif = { organisationId: ORG_A, documentId: DOCQ, elementId: "e1", sens: "max", seuil: "5", unite: "j" };
  const objectifA = () => sql(`SELECT sens || '/' || seuil::float8 || '/' || unite FROM "${SCHEMA_A}".objectifs_indicateur WHERE document_id = '${DOCQ}'`);
  for (const qui of ["faux", "attente"]) await cas(qui, "actionDefinirObjectif", objectif, "session");
  for (const qui of ["lecteurA", "redacA", "adminB", "superadmin"]) await cas(qui, "actionDefinirObjectif", objectif, "erreur.interdit");
  await cas("adminB", "actionDefinirObjectif", { ...objectif, organisationId: ORG_B }, "indicateurs.introuvable", { note: "indicateur de A depuis B" });
  await cas("approA", "actionDefinirObjectif", { ...objectif, seuil: "cinq" }, "indicateurs.erreur.nombre", { note: "seuil illisible" });
  await cas("approA", "actionDefinirObjectif", { ...objectif, elementId: "e9" }, "indicateurs.introuvable", { note: "indicateur absent" });
  await cas("approA", "actionDefinirObjectif", objectif, "succes", { effet: () => objectifA() === "max/5/j" });
  const retraitObjectif = { organisationId: ORG_A, documentId: DOCQ, elementId: "e1" };
  for (const qui of ["faux", "attente"]) await cas(qui, "actionRetirerObjectif", retraitObjectif, "session");
  for (const qui of ["lecteurA", "redacA", "adminB", "superadmin"]) await cas(qui, "actionRetirerObjectif", retraitObjectif, "erreur.interdit");
  await cas("adminA", "actionRetirerObjectif", retraitObjectif, "succes", { effet: () => objectifA() === "" });

  const mesure = { organisationId: ORG_A, documentId: DOCQ, elementId: "e1", date: "2026-01-15", valeur: "4,5", commentaire: "Essai" };
  const nbMesuresA = () => Number(sql(`SELECT count(*) FROM "${SCHEMA_A}".mesures_indicateur`));
  for (const qui of ["faux", "attente"]) await cas(qui, "actionEnregistrerMesure", mesure, "session");
  for (const qui of ["lecteurA", "adminB", "superadmin"]) await cas(qui, "actionEnregistrerMesure", mesure, "erreur.interdit");
  await cas("redacA", "actionEnregistrerMesure", { ...mesure, date: "2999-01-01" }, "indicateurs.erreur.date", { note: "date future" });
  await cas("redacA", "actionEnregistrerMesure", mesure, "succes", { effet: () => nbMesuresA() === 1 });
  const MESURE_A = sql(`SELECT id FROM "${SCHEMA_A}".mesures_indicateur`);
  const suppressionMesure = { organisationId: ORG_A, mesureId: MESURE_A };
  for (const qui of ["faux", "attente"]) await cas(qui, "actionSupprimerMesure", suppressionMesure, "session");
  for (const qui of ["lecteurA", "adminB", "superadmin"]) await cas(qui, "actionSupprimerMesure", suppressionMesure, "erreur.interdit");
  await cas("adminB", "actionSupprimerMesure", { ...suppressionMesure, organisationId: ORG_B }, "erreur.introuvable", { note: "mesure de A depuis B" });
  await cas("verifA", "actionSupprimerMesure", suppressionMesure, "succes", { effet: () => nbMesuresA() === 0 });

  // ======================================================================================== actions : organisation
  // Paramètres (W2) : administrateur de l'organisation OUVERTE. Notifications : chacun les SIENNES.
  etape("actions « paramètres » et « notifications »");
  const parametresA = () => sql(`SELECT periode_revue_mois || '/' || rappel_jours || '/' || escalade_jours FROM "${SCHEMA_A}".parametres`);
  const reglages = { organisationId: ORG_A, periodeRevueMois: "12", rappelJours: "15", escaladeJours: "10" };
  for (const qui of ["faux", "attente"]) await cas(qui, "actionModifierParametres", reglages, "session");
  for (const qui of ["lecteurA", "redacA", "verifA", "approA", "adminB", "superadmin"]) await cas(qui, "actionModifierParametres", reglages, "erreur.interdit");
  await cas("adminA", "actionModifierParametres", { ...reglages, periodeRevueMois: "0" }, "parametres.erreur.periodeRevueMois", { note: "hors bornes" });
  await cas("adminA", "actionModifierParametres", { ...reglages, rappelJours: "abc" }, "parametres.erreur.rappelJours", { note: "pas un nombre" });
  await cas("adminA", "actionModifierParametres", { ...reglages, escaladeJours: "10.5" }, "parametres.erreur.escaladeJours", { note: "pas un entier" });
  await cas("adminA", "actionModifierParametres", reglages, "succes", { effet: () => parametresA() === "12/15/10" });
  await cas("adminB", "actionModifierParametres", { ...reglages, organisationId: ORG_B, periodeRevueMois: "36" }, "succes",
    { note: "sa propre organisation", effet: () => sql(`SELECT periode_revue_mois FROM "${SCHEMA_B}".parametres`) === "36" && parametresA() === "12/15/10" });
  const nonLues = (email) => Number(sql(`SELECT count(*) FROM "${SCHEMA_A}".notifications WHERE lue_le IS NULL AND destinataire = (SELECT id FROM platform.utilisateurs WHERE email = '${email}')`));
  const [verifNonLues, approNonLues] = [nonLues("verif-a@droits.test"), nonLues("appro-a@droits.test")];
  assert.ok(verifNonLues > 0 && approNonLues > 0, "le circuit a notifié vérificateur et approbateur");
  const toutLu = { organisationId: ORG_A };
  for (const qui of ["faux", "attente"]) await cas(qui, "actionToutMarquerLu", toutLu, "session");
  for (const qui of ["adminB", "superadmin"]) await cas(qui, "actionToutMarquerLu", toutLu, "erreur.interdit");
  await cas("verifA", "actionToutMarquerLu", toutLu, "succes", { effet: () => nonLues("verif-a@droits.test") === 0 && nonLues("appro-a@droits.test") === approNonLues });

  // ======================================================================================== actions : membres
  etape("actions « membres » (organisation A)");
  const invitationA = { organisationId: ORG_A, email: "invite-a@droits.test", nom: "Invité A", roles: "LECTEUR" };
  for (const qui of ["faux", "attente"]) await cas(qui, "actionInviterMembre", invitationA, "session");
  for (const qui of ["lecteurA", "redacA", "verifA", "adminB"]) await cas(qui, "actionInviterMembre", invitationA, "erreur.interdit");
  await cas("adminA", "actionInviterMembre", { ...invitationA, organisationId: ORG_B }, "erreur.interdit", { note: "vers l'organisation B" });
  const enAttente = (email, org) => sql(`SELECT id FROM platform.invitations WHERE email = '${email}' AND organisation_id = '${org}' AND acceptee_le IS NULL AND annulee_le IS NULL`);
  const invA = await cas("adminA", "actionInviterMembre", invitationA, "succes", { effet: (r) => Boolean(r.lien) && enAttente("invite-a@droits.test", ORG_A) !== "" });
  assert.ok(invA.lien);
  // Chantier 1 (20/10/2026) : le superadmin n'a AUCUN droit sur les membres, depuis sa page comme depuis l'organisation.
  await cas("superadmin", "actionInviterMembre", { ...invitationA, email: "invite-sa@droits.test", nom: "Invité SA" }, "erreur.interdit",
    { page: `/plateforme/organisations/${ORG_A}`, note: "superadmin : aucun droit sur les membres" });
  // (« invite-sa » : la 2e invitation de A, faite désormais par l'administrateur ; elle sert aux tests d'acceptation.)
  const invSA = await cas("adminA", "actionInviterMembre", { ...invitationA, email: "invite-sa@droits.test", nom: "Invité SA" }, "succes",
    { effet: (r) => Boolean(r.lien) && enAttente("invite-sa@droits.test", ORG_A) !== "" });
  const JETON_SA = invSA.lien.split("/").pop();

  // Données communes (adhésions, invitations, journal de la plateforme : tables partagées, filtrées par le code et
  // non par PostgreSQL — voir docs/EVALUATION-RLS.md) : chaque administrateur ne voit que SON organisation.
  const pageMembres = async (qui) => (await ctx[qui].request.get(`${BASE}/app/membres`)).text();
  const [membresA, membresB] = [await pageMembres("adminA"), await pageMembres("adminB")];
  const deA = ["admin-a", "suppleant-a", "redac-a", "lect-a", "verif-a", "appro-a", "mfa-a", "cible-a", "retrait-a", "invite-a", "invite-sa"].map((n) => `${n}@droits.test`);
  const deB = ["admin-b", "jetable"].map((n) => `${n}@droits.test`);
  for (const e of deA) assert.ok(membresA.includes(e) && !membresB.includes(e), `${e} : visible dans A seulement`);
  for (const e of deB) assert.ok(membresB.includes(e) && !membresA.includes(e), `${e} : visible dans B seulement`);
  console.log(`  ✔ page « Membres » : ${deA.length} adresses de A (dont 2 invitations en attente) invisibles depuis B, ${deB.length} de B invisibles depuis A`);

  const INV_A = enAttente("invite-a@droits.test", ORG_A);
  const annulation = { organisationId: ORG_A, invitationId: INV_A };
  for (const qui of ["faux", "attente"]) await cas(qui, "actionAnnulerInvitation", annulation, "session");
  for (const qui of ["lecteurA", "redacA", "verifA", "adminB"]) await cas(qui, "actionAnnulerInvitation", annulation, "erreur.interdit");
  await cas("adminB", "actionAnnulerInvitation", { organisationId: ORG_B, invitationId: INV_A }, "erreur.introuvable", { note: "invitation de A depuis B" });
  await cas("superadmin", "actionAnnulerInvitation", annulation, "erreur.interdit", { page: `/plateforme/organisations/${ORG_A}`, note: "superadmin : aucun droit sur les membres" });
  await cas("adminA", "actionAnnulerInvitation", annulation, "succes", { effet: () => sql(`SELECT annulee_le IS NOT NULL FROM platform.invitations WHERE id = '${INV_A}'`) === "t" });

  const rolesDe = (u) => sql(`SELECT roles FROM platform.adhesions WHERE utilisateur_id = '${u}' AND organisation_id = '${ORG_A}'`);
  const roles = { organisationId: ORG_A, utilisateurId: CIBLE_A, roles: ["LECTEUR", "VERIFICATEUR"] };
  for (const qui of ["faux", "attente"]) await cas(qui, "actionModifierRoles", roles, "session");
  for (const qui of ["lecteurA", "redacA", "verifA", "adminB"]) await cas(qui, "actionModifierRoles", roles, "erreur.interdit");
  await cas("adminB", "actionModifierRoles", { ...roles, organisationId: ORG_B }, "erreur.introuvable", { note: "membre de A depuis B" });
  await cas("adminA", "actionModifierRoles", roles, "succes", { effet: () => rolesDe(CIBLE_A) === "{VERIFICATEUR,LECTEUR}" || rolesDe(CIBLE_A) === "{LECTEUR,VERIFICATEUR}" });
  await cas("superadmin", "actionModifierRoles", { ...roles, roles: ["LECTEUR"] }, "erreur.interdit", { page: `/plateforme/organisations/${ORG_A}`, note: "superadmin : aucun droit sur les membres" });
  // Binôme (chantier 2) : l'administrateur ne touche ni au rôle Administrateur du suppléant (G1) ni à celui du
  // titulaire (G2), et ne retire aucun des deux (G3). (MFA_A, co-administrateur, laisse un autre administrateur actif.)
  await cas("adminA", "actionModifierRoles", { organisationId: ORG_A, utilisateurId: SUPPLEANT_A, roles: ["LECTEUR", "ADMIN_ORGANISATION"] }, "membres.suppleant_reserve_superadmin", { note: "G1" });
  await cas("adminA", "actionModifierRoles", { organisationId: ORG_A, utilisateurId: ADMIN_A, roles: ["LECTEUR"] }, "membres.titulaire_reserve_superadmin", { note: "G2" });
  await cas("adminA", "actionRetirerMembre", { organisationId: ORG_A, utilisateurId: SUPPLEANT_A }, "membres.binome_reserve_superadmin", { note: "G3" });
  await cas("adminA", "actionModifierRoles", { organisationId: ORG_A, utilisateurId: SUPPLEANT_A, roles: ["LECTEUR", "REDACTEUR"] }, "succes",
    { note: "suppléant : autres rôles libres", effet: () => rolesDe(SUPPLEANT_A).includes("REDACTEUR") });

  const retrait = { organisationId: ORG_A, utilisateurId: RETRAIT_A };
  for (const qui of ["faux", "attente"]) await cas(qui, "actionRetirerMembre", retrait, "session");
  for (const qui of ["lecteurA", "redacA", "verifA", "adminB"]) await cas(qui, "actionRetirerMembre", retrait, "erreur.interdit");
  await cas("adminB", "actionRetirerMembre", { ...retrait, organisationId: ORG_B }, "erreur.introuvable", { note: "membre de A depuis B" });
  await cas("superadmin", "actionRetirerMembre", retrait, "erreur.interdit", { page: `/plateforme/organisations/${ORG_A}`, note: "superadmin : aucun droit sur les membres" });
  await cas("adminA", "actionRetirerMembre", retrait, "succes", { effet: () => rolesDe(RETRAIT_A) === "" });

  // ======================================================================================== actions : invitations
  etape("actions « invitations »");
  for (const qui of ["faux", "attente"]) await cas(qui, "actionAccepterInvitation", { jeton: JETON_SA }, "session");
  await cas("redacA", "actionAccepterInvitation", { jeton: JETON_SA }, "invitation.autre_compte", { note: "invitation adressée à une autre personne" });
  const compte = { jeton: JETON_SA, nom: "Invité SA", nouveau: "motdepasse-invite-sa", confirmation: "motdepasse-invite-sa" };
  await cas("redacA", "actionCreerCompteInvitation", compte, "invitation.deja_connecte");
  await cas("anonyme", "actionCreerCompteInvitation", { ...compte, jeton: "A".repeat(43) }, "invitation.invalide", { note: "jeton inconnu" });
  await cas("anonyme", "actionCreerCompteInvitation", compte, "redirection:/app",
    { effet: () => sql(`SELECT count(*) FROM platform.adhesions a JOIN platform.utilisateurs u ON u.id = a.utilisateur_id WHERE u.email = 'invite-sa@droits.test' AND a.organisation_id = '${ORG_A}'`) === "1" });

  // ======================================================================================== actions : compte
  etape("actions « compte »");
  const sessionsDe = (u) => sql(`SELECT count(*) FROM platform.sessions WHERE utilisateur_id = '${u}'`);
  const s0 = sessionsDe(LECT_A);
  // (Un échec de connexion est journalisé : empreinte non comparée, mais aucune session ouverte.)
  await cas("anonyme", "actionConnexion", { email: "lect-a@droits.test", motDePasse: "pas-le-bon-mot-de-passe" }, "connexion.echec",
    { sansEmpreinte: true, effet: () => sessionsDe(LECT_A) === s0 });
  for (const qui of ["faux", "attente"]) await cas(qui, "actionContinuer", {}, "session");
  await cas("redacA", "actionContinuer", {}, "redirection:/app");
  await cas("faux", "actionChangerLangue", { langue: "en", retour: "/app" }, "redirection:/app", { note: "sans session : cookie de langue seulement" });
  const langueDe = (u) => sql(`SELECT langue FROM platform.utilisateurs WHERE id = '${u}'`);
  await cas("lecteurA", "actionChangerLangue", { langue: "en", retour: "/app" }, "redirection:/app", { sansEmpreinte: true, effet: () => langueDe(LECT_A) === "en" });
  await cas("lecteurA", "actionChangerLangue", { langue: "fr", retour: "/app" }, "redirection:/app", { sansEmpreinte: true, effet: () => langueDe(LECT_A) === "fr" });
  for (const qui of ["faux", "attente"]) await cas(qui, "actionChoisirOrganisation", { organisationId: ORG_A }, "session");
  await cas("adminA", "actionChoisirOrganisation", { organisationId: ORG_B }, "redirection:/choisir-organisation", { note: "organisation dont il n'est pas membre" });
  assert.equal((await api("adminA", "GET", "/api/editeur/contexte")).json.organisation.id, ORG_A, "adminA reste dans A");
  await cas("adminA", "actionChoisirOrganisation", { organisationId: ORG_A }, "redirection:/app");
  const mdp = { actuel: "pas-le-mot-de-passe", nouveau: "nouveau-mot-de-passe-e2e", confirmation: "nouveau-mot-de-passe-e2e" };
  for (const qui of ["faux", "attente"]) await cas(qui, "actionChangerMotDePasse", mdp, "session");
  await cas("redacA", "actionChangerMotDePasse", mdp, "erreur.mdp_actuel_faux");
  // Déconnexion : sans session, rien ; une connexion EN ATTENTE est close (pas seulement oubliée par le navigateur).
  await cas("faux", "actionDeconnexion", {}, "session");
  ctx.attente2 = await connexionEnAttente("mfa-a@droits.test");
  const ouvertesEnAttente = () => sql(`SELECT count(*) FROM platform.sessions WHERE utilisateur_id = '${MFA_A}' AND fin IS NULL AND en_attente_mfa`);
  const a0 = Number(ouvertesEnAttente());
  await cas("attente2", "actionDeconnexion", {}, "redirection:/connexion", { sansEmpreinte: true, effet: () => Number(ouvertesEnAttente()) === a0 - 1 });

  // ======================================================================================== actions : second facteur
  etape("actions « second facteur »");
  for (const qui of ["faux", "redacA"]) await cas(qui, "actionCodeSecondFacteur", { code: "000000" }, "session", { note: qui === "redacA" ? "session complète" : undefined });
  // Connexion en attente, code faux : refus, échec COMPTÉ sur la session (c'est voulu), session toujours en attente.
  const echecsAttente = () => sql(`SELECT echecs_mfa || '/' || en_attente_mfa FROM platform.sessions WHERE utilisateur_id = '${MFA_A}' AND fin IS NULL ORDER BY debut LIMIT 1`);
  assert.equal(echecsAttente(), "0/true");
  await cas("attente", "actionCodeSecondFacteur", { code: "000000" }, "mfa.code_faux", { sansEmpreinte: true, note: "code faux", effet: () => echecsAttente() === "1/true" });
  for (const qui of ["faux", "redacA"]) await cas(qui, "actionActiverSecondFacteurConnexion", { code: "000000" }, "session", { note: qui === "redacA" ? "session complète" : undefined });
  await cas("attente", "actionActiverSecondFacteurConnexion", { code: "000000" }, "mfa.deja_actif");
  // « Annuler » avec une session complète : elle reste ouverte et utilisable.
  await cas("faux", "actionAbandonnerConnexion", {}, "session");
  await cas("redacA", "actionAbandonnerConnexion", {}, "session", { note: "session complète intacte" });
  assert.equal((await api("redacA", "GET", "/api/editeur/contexte")).statut, 200, "la session complète de redacA fonctionne toujours");
  ctx.attente3 = await connexionEnAttente("mfa-a@droits.test");
  const a1 = Number(ouvertesEnAttente());
  await cas("attente3", "actionAbandonnerConnexion", {}, "redirection:/connexion", { sansEmpreinte: true, effet: () => Number(ouvertesEnAttente()) === a1 - 1 });
  for (const action of ["actionActiverSecondFacteur", "actionDesactiverSecondFacteur", "actionRegenererCodesSecours"]) {
    for (const qui of ["faux", "attente"]) await cas(qui, action, { code: "000000" }, "session");
  }
  // (La page « second facteur » visitée plus haut a préparé un secret : le code donné est faux.)
  await cas("redacA", "actionActiverSecondFacteur", { code: "000000" }, "mfa.code_faux", { note: "code faux" });
  await cas("redacA", "actionDesactiverSecondFacteur", { code: "000000" }, "mfa.inactif");
  await cas("redacA", "actionRegenererCodesSecours", { code: "000000" }, "mfa.inactif");

  // Acceptation par un compte existant (fait ici : le vérificateur rejoint B).
  const invitationB = { organisationId: ORG_B, email: "verif-a@droits.test", nom: "Vérificateur A", roles: "LECTEUR" };
  await cas("superadmin", "actionInviterMembre", invitationB, "erreur.interdit", { page: `/plateforme/organisations/${ORG_B}`, note: "superadmin : aucun droit sur les membres" });
  const invV = await cas("adminB", "actionInviterMembre", invitationB, "succes");
  await cas("verifA", "actionAccepterInvitation", { jeton: invV.lien.split("/").pop() }, "redirection:/app",
    { effet: () => sql(`SELECT count(*) FROM platform.adhesions a JOIN platform.utilisateurs u ON u.id = a.utilisateur_id WHERE u.email = 'verif-a@droits.test' AND a.organisation_id = '${ORG_B}'`) === "1" });

  // ======================================================================================== actions : plateforme
  etape("actions « plateforme » : réservées au superadmin");
  const NON_SUPERADMINS = ["lecteurA", "redacA", "verifA", "approA", "adminA", "adminB"];
  async function plateforme(action, champs, effet, note) {
    for (const qui of ["faux", "attente"]) await cas(qui, action, champs, "session");
    for (const qui of NON_SUPERADMINS) await cas(qui, action, champs, "404");
    await cas("superadmin", action, champs, "succes", { effet, note });
  }
  const creationC = { nom: "Droits C", slug: "droits-c", adminEmail: "admin-c@droits.test", adminNom: "Admin C", suppleantEmail: "suppleant-c@droits.test", suppleantNom: "Suppléant C" };
  await cas("superadmin", "actionCreerOrganisation", { ...creationC, suppleantEmail: "" }, "erreur.email_invalide", { note: "suppléant obligatoire (B9)" });
  await cas("superadmin", "actionCreerOrganisation", { ...creationC, suppleantEmail: "ADMIN-C@droits.test" }, "orgs.suppleant_meme_adresse", { note: "même adresse" });
  await plateforme("actionCreerOrganisation", creationC,
    () => sql("SELECT count(*) FROM platform.organisations WHERE slug = 'droits-c'") === "1"
      && sql("SELECT string_agg(fonction_org || ':' || roles::text, ',' ORDER BY fonction_org) FROM platform.invitations i JOIN platform.organisations o ON o.id = i.organisation_id WHERE o.slug = 'droits-c'") === "suppleant:{LECTEUR},titulaire:{ADMIN_ORGANISATION}");
  const statutB = () => sql(`SELECT statut FROM platform.organisations WHERE id = '${ORG_B}'`);
  await plateforme("actionChangerStatutOrganisation", { organisationId: ORG_B, statut: "suspendue" }, () => statutB() === "suspendue");
  await cas("superadmin", "actionReemettreInvitationAdmin", { organisationId: ORG_B, email: "admin-b2@droits.test", nom: "Admin B2" }, "erreur.organisation_suspendue",
    { page: `/plateforme/organisations/${ORG_B}`, note: "organisation suspendue" });
  await cas("superadmin", "actionChangerStatutOrganisation", { organisationId: ORG_B, statut: "active" }, "succes", { effet: () => statutB() === "active", note: "remise en service" });
  const statutJ = () => sql(`SELECT statut FROM platform.utilisateurs WHERE id = '${JETABLE}'`);
  // Q8 (chantier 2) : désactiver le compte du DERNIER administrateur actif d'une organisation est refusé.
  await cas("superadmin", "actionDesactiverUtilisateur", { utilisateurId: idDe("admin-b@droits.test") }, "erreur.dernier_admin", { note: "dernier administrateur de B" });
  await plateforme("actionDesactiverUtilisateur", { utilisateurId: JETABLE }, () => statutJ() === "desactive");
  await plateforme("actionReactiverUtilisateur", { utilisateurId: JETABLE }, () => statutJ() === "actif");
  const ouvertes = () => sql(`SELECT count(*) FROM platform.sessions WHERE utilisateur_id = '${JETABLE}' AND fin IS NULL`);
  await connecter("jetable@droits.test");
  assert.equal(ouvertes(), "1");
  await plateforme("actionRevoquerSessionsUtilisateur", { utilisateurId: JETABLE }, () => ouvertes() === "0");
  await connecter("jetable@droits.test");
  const SESSION_J = sql(`SELECT id FROM platform.sessions WHERE utilisateur_id = '${JETABLE}' AND fin IS NULL`);
  await plateforme("actionRevoquerSession", { sessionId: SESSION_J }, () => sql(`SELECT fin IS NOT NULL FROM platform.sessions WHERE id = '${SESSION_J}'`) === "t");
  // Réinitialisation par le superadmin (décision n° 1 du 19/10/2026) : un lien envoyé PAR COURRIEL, jamais montré au
  // superadmin. Ce serveur de test n'a pas de SMTP : la demande est refusée, sans rien écrire.
  for (const qui of ["faux", "attente"]) await cas(qui, "actionReinitialiserMotDePasse", { utilisateurId: JETABLE }, "session");
  for (const qui of NON_SUPERADMINS) await cas(qui, "actionReinitialiserMotDePasse", { utilisateurId: JETABLE }, "404");
  const sansSmtp = await cas("superadmin", "actionReinitialiserMotDePasse", { utilisateurId: JETABLE }, "users.reinit_smtp_requis", { note: "sans SMTP" });
  assert.ok(!sansSmtp.corps.includes("/reinitialisation/"), "aucun lien de réinitialisation montré au superadmin");

  // Accès d'urgence (décision n° 1 du 19/10/2026) : réservé au superadmin, motivé, limité, notifié aux administrateurs.
  const PAGE_ORG_B = `/plateforme/organisations/${ORG_B}`;
  const accesOuvertsB = () => sql(`SELECT count(*) FROM platform.acces_urgence WHERE organisation_id = '${ORG_B}' AND ferme_le IS NULL AND expire_le > now()`);
  const notificationsAccesB = () => Number(sql(`SELECT count(*) FROM "${SCHEMA_B}".notifications WHERE nature = 'acces_urgence'`));
  const adminsB = Number(sql(`SELECT count(*) FROM platform.adhesions a JOIN platform.utilisateurs u ON u.id = a.utilisateur_id
    WHERE a.organisation_id = '${ORG_B}' AND 'ADMIN_ORGANISATION' = ANY (a.roles) AND u.statut = 'actif'`));
  assert.ok(adminsB >= 1, "B a au moins un administrateur actif");
  const ouverture = { organisationId: ORG_B, role: "LECTEUR", dureeHeures: "1", motif: "Vérification de l'accès d'urgence (parcours e2e)" };
  for (const qui of ["faux", "attente"]) await cas(qui, "actionOuvrirAccesUrgence", ouverture, "session", { page: PAGE_ORG_B });
  for (const qui of NON_SUPERADMINS) await cas(qui, "actionOuvrirAccesUrgence", ouverture, "404", { page: PAGE_ORG_B });
  await cas("superadmin", "actionOuvrirAccesUrgence", { ...ouverture, motif: "court" }, "acces.motif_requis", { page: PAGE_ORG_B, note: "motif trop court" });
  await cas("superadmin", "actionOuvrirAccesUrgence", { ...ouverture, dureeHeures: "48" }, "acces.duree_invalide", { page: PAGE_ORG_B, note: "48 h" });
  await cas("superadmin", "actionOuvrirAccesUrgence", { ...ouverture, role: "APPROBATEUR" }, "erreur.role_invalide", { page: PAGE_ORG_B, note: "rôle hors liste" });
  await cas("superadmin", "actionOuvrirAccesUrgence", { ...ouverture, role: "ADMIN_ORGANISATION" }, "erreur.role_invalide", { page: PAGE_ORG_B, note: "administrateur retiré (chantier 1)" });
  const notifiesAvant = notificationsAccesB();
  await cas("superadmin", "actionOuvrirAccesUrgence", ouverture, "succes", {
    page: PAGE_ORG_B, effet: () => accesOuvertsB() === "1" && notificationsAccesB() === notifiesAvant + adminsB,
  });
  await cas("superadmin", "actionOuvrirAccesUrgence", ouverture, "acces.deja_ouvert", { page: PAGE_ORG_B, note: "déjà ouvert" });
  const pendant = await api("superadmin", "GET", "/api/editeur/contexte");
  assert.equal(pendant.statut, 200, "pendant l'accès d'urgence, le superadmin entre dans B");
  assert.equal(pendant.json.organisation.id, ORG_B, "accès d'urgence : l'organisation B, et elle seule");
  const ACCES_B = sql(`SELECT id FROM platform.acces_urgence WHERE organisation_id = '${ORG_B}' AND ferme_le IS NULL`);
  for (const qui of ["faux", "attente"]) await cas(qui, "actionFermerAccesUrgence", { accesId: ACCES_B }, "session", { page: PAGE_ORG_B });
  for (const qui of NON_SUPERADMINS) await cas(qui, "actionFermerAccesUrgence", { accesId: ACCES_B }, "404", { page: PAGE_ORG_B });
  await cas("superadmin", "actionFermerAccesUrgence", { accesId: ACCES_B }, "succes", { page: PAGE_ORG_B, effet: () => accesOuvertsB() === "0" });
  await cas("superadmin", "actionFermerAccesUrgence", { accesId: ACCES_B }, "acces.deja_ferme", { page: PAGE_ORG_B, note: "déjà fermé" });
  assert.equal((await api("superadmin", "GET", "/api/editeur/contexte")).statut, 403, "accès fermé : le superadmin n'entre plus dans B");

  // Accès « Administrateur » ouvert AVANT le chantier 1 (inséré en base : la contrainte l'accepte encore) : écarté du
  // contexte, montré « rôle retiré » sans « Entrer », toute tentative d'entrée refusée et tracée ; il reste fermable.
  const SUPERADMIN_ID = idDe(SUPERADMIN.email);
  const ACCES_ANCIEN = sql(`INSERT INTO platform.acces_urgence (organisation_id, superadmin_id, role, motif, duree_heures, expire_le)
    VALUES ('${ORG_B}', '${SUPERADMIN_ID}', 'ADMIN_ORGANISATION', 'Accès ouvert avant le chantier 1 (e2e)', 4, now() + interval '4 hours') RETURNING id`).split("\n")[0];
  assert.equal((await api("superadmin", "GET", "/api/editeur/contexte")).statut, 403, "rôle retiré : le superadmin n'entre pas dans B");
  const pageB = await (await ctx.superadmin.request.get(BASE + PAGE_ORG_B)).text();
  assert.ok(pageB.includes("data-role-retire") && !pageB.includes(">Entrer dans l'organisation<"), "accès au rôle retiré : signalé, sans bouton « Entrer »");
  const refusB = () => sql(`SELECT count(*) FROM platform.journal WHERE organisation_id = '${ORG_B}' AND action = 'ACCES_URGENCE_REFUSE'`);
  const refusAvant = refusB();
  await cas("superadmin", "actionChoisirOrganisation", { organisationId: ORG_B }, `redirection:${PAGE_ORG_B}?refus=role_invalide`,
    { page: PAGE_ORG_B, note: "accès au rôle retiré : refusé et tracé", effet: () => Number(refusB()) === Number(refusAvant) + 1 });
  assert.equal((await api("superadmin", "GET", "/api/editeur/contexte")).statut, 403, "toujours hors de B après la tentative");
  await cas("superadmin", "actionFermerAccesUrgence", { accesId: ACCES_ANCIEN }, "succes", { page: PAGE_ORG_B, note: "accès au rôle retiré : fermable", effet: () => accesOuvertsB() === "0" });

  // Mode de validation (décision n° 2 du 19/10/2026) : réservé au superadmin ; A revient en mode standard ensuite.
  const PAGE_ORG_A = `/plateforme/organisations/${ORG_A}`;
  const modeA = () => sql(`SELECT mode_validation FROM platform.organisations WHERE id = '${ORG_A}'`);
  const versPetite = { organisationId: ORG_A, mode: "petite_organisation" };
  for (const qui of ["faux", "attente"]) await cas(qui, "actionChangerModeValidation", versPetite, "session", { page: PAGE_ORG_A });
  for (const qui of NON_SUPERADMINS) await cas(qui, "actionChangerModeValidation", versPetite, "404", { page: PAGE_ORG_A });
  await cas("superadmin", "actionChangerModeValidation", { organisationId: ORG_A, mode: "libre" }, "erreur.saisie_invalide", { page: PAGE_ORG_A, note: "mode inconnu" });
  await cas("superadmin", "actionChangerModeValidation", versPetite, "succes", { page: PAGE_ORG_A, effet: () => modeA() === "petite_organisation" });
  await cas("superadmin", "actionChangerModeValidation", { organisationId: ORG_A, mode: "standard" }, "succes", { page: PAGE_ORG_A, effet: () => modeA() === "standard", note: "retour au mode standard" });

  // Chantier 1 : page d'une organisation côté superadmin = membres et invitations en LECTURE SEULE ; accès d'urgence
  // Rédacteur ou Lecteur seulement, Lecteur présélectionné ; réémission de l'administrateur seulement sans
  // administrateur actif (A en a un : pas de formulaire).
  const pageA = await (await ctx.superadmin.request.get(BASE + PAGE_ORG_A)).text();
  assert.ok(pageA.includes('id="membres-lecture-seule"'), "page de A : membres en lecture seule");
  for (const champ of ['name="roles"', 'name="utilisateurId"', 'name="invitationId"']) assert.ok(!pageA.includes(champ), `page de A : aucun formulaire de gestion des membres (${champ})`);
  const roles_urgence = [...pageA.matchAll(/<option value="(ADMIN_ORGANISATION|REDACTEUR|LECTEUR|VERIFICATEUR|APPROBATEUR)"( selected="")?/g)].map((m) => m[1] + (m[2] ? "*" : ""));
  assert.deepEqual(roles_urgence, ["REDACTEUR", "LECTEUR*"], "accès d'urgence : Rédacteur ou Lecteur, Lecteur présélectionné");
  assert.ok(pageA.includes('data-admins="') && !pageA.includes('data-admins="0"') && !pageA.includes('name="email"'), "A a un administrateur : pas de réémission");
  // Réémission de l'invitation d'administrateur : C (créée plus haut) n'a encore aucun administrateur actif.
  const ORG_C = sql("SELECT id FROM platform.organisations WHERE slug = 'droits-c'");
  const PAGE_ORG_C = `/plateforme/organisations/${ORG_C}`;
  // Invitations en attente vues par le superadmin (page de C, qui en a une) : plus le conseil « invitez à nouveau »,
  // réservé à l'administrateur, mais le texte propre au superadmin (HTML : apostrophes échappées).
  const pageC = (await (await ctx.superadmin.request.get(BASE + PAGE_ORG_C)).text()).replaceAll("&#x27;", "'");
  assert.ok(pageC.includes(texte("invitation.en_attente")), "page de C : invitations en attente affichées");
  assert.ok(!pageC.includes("invitez à nouveau la même adresse"), "page superadmin : plus de conseil « invitez à nouveau »");
  assert.ok(pageC.includes(texte("invitation.en_attente_aide_superadmin")), "page superadmin : aide propre au superadmin");
  const reemission = { organisationId: ORG_C, email: "admin-c2@droits.test", nom: "Admin C2" };
  const invitationsAdminC = () => sql(`SELECT count(*) FROM platform.invitations WHERE organisation_id = '${ORG_C}' AND roles = '{ADMIN_ORGANISATION}' AND acceptee_le IS NULL AND annulee_le IS NULL`);
  for (const qui of ["faux", "attente"]) await cas(qui, "actionReemettreInvitationAdmin", reemission, "session", { page: PAGE_ORG_C });
  for (const qui of NON_SUPERADMINS) await cas(qui, "actionReemettreInvitationAdmin", reemission, "404", { page: PAGE_ORG_C });
  await cas("superadmin", "actionReemettreInvitationAdmin", { ...reemission, organisationId: ORG_A }, "orgs.admin_present", { page: PAGE_ORG_A, note: "A a un administrateur actif" });
  // B5 : C a une invitation de suppléant en attente (suppléant utilisable) : la réémission est refusée ; elle est
  // permise une fois cette invitation expirée.
  await cas("superadmin", "actionReemettreInvitationAdmin", reemission, "orgs.suppleant_a_activer", { page: PAGE_ORG_C, note: "suppléant utilisable (B5)" });
  sql(`UPDATE platform.invitations SET cree_le = now() - interval '4 days', expire_le = now() - interval '1 day' WHERE organisation_id = '${ORG_C}' AND fonction_org = 'suppleant'`);
  const avantC = Number(invitationsAdminC());
  await cas("superadmin", "actionReemettreInvitationAdmin", reemission, "succes", {
    page: PAGE_ORG_C, effet: (r) => Boolean(r.lien) && Number(invitationsAdminC()) === avantC + 1,
  });

  // Binôme d'administration (chantier 2) : sur A, dont le suppléant (suppleant-a) est membre et inactif.
  const fonctionDe = (u) => sql(`SELECT coalesce(fonction_org, '-') || '|' || coalesce(statut_suppleant, '-') || '|' || ('ADMIN_ORGANISATION' = ANY (roles))::text
    || '|' || (date_absence_debut IS NOT NULL)::text FROM platform.adhesions WHERE utilisateur_id = '${u}' AND organisation_id = '${ORG_A}'`);
  assert.equal(fonctionDe(ADMIN_A), "titulaire|-|true|false", "A : admin-a titulaire");
  assert.equal(fonctionDe(SUPPLEANT_A), "suppleant|inactif|false|false", "A : suppléant inactif, sans le rôle Administrateur");
  const pageBinome = await (await ctx.superadmin.request.get(BASE + PAGE_ORG_A)).text();
  assert.ok(pageBinome.includes('id="binome"') && pageBinome.includes('data-suppleant="inactif"'), "page de A : bloc du binôme");
  const surA = { organisationId: ORG_A };
  const BINOME = ["actionInviterSuppleant", "actionActiverSuppleant", "actionMarquerTitulaireAbsent", "actionMarquerTitulaireRetour", "actionDepartTitulaire"];
  const inviteSup = { organisationId: ORG_A, email: "suppleant-a2@droits.test", nom: "Suppléant A2" };
  for (const action of BINOME) {
    const champs = action === "actionInviterSuppleant" ? inviteSup : action === "actionMarquerTitulaireAbsent" ? { ...surA, motif: "Congé" } : surA;
    for (const qui of ["faux", "attente"]) await cas(qui, action, champs, "session", { page: PAGE_ORG_A });
    for (const qui of NON_SUPERADMINS) await cas(qui, action, champs, "404", { page: PAGE_ORG_A });
  }
  await cas("superadmin", "actionInviterSuppleant", inviteSup, "orgs.suppleant_existe", { page: PAGE_ORG_A, note: "A a un suppléant (B5)" });
  await cas("superadmin", "actionMarquerTitulaireRetour", surA, "orgs.rien_a_retablir", { page: PAGE_ORG_A, note: "rien à rétablir" });
  await cas("superadmin", "actionMarquerTitulaireAbsent", { ...surA, motif: "Congé maladie (e2e)" }, "succes", { page: PAGE_ORG_A, effet: () => fonctionDe(ADMIN_A) === "titulaire|-|true|true" });
  await cas("superadmin", "actionMarquerTitulaireAbsent", surA, "orgs.titulaire_deja_absent", { page: PAGE_ORG_A, note: "déjà absent" });
  assert.equal(sql(`SELECT count(*) FROM "${SCHEMA_A}".journal WHERE details::text LIKE '%Congé maladie%'`), "0", "motif d'absence : jamais dans le journal de l'organisation (B12)");
  await cas("superadmin", "actionActiverSuppleant", surA, "succes", { page: PAGE_ORG_A, effet: () => fonctionDe(SUPPLEANT_A) === "suppleant|actif|true|false" });
  await cas("superadmin", "actionActiverSuppleant", surA, "orgs.suppleant_deja_actif", { page: PAGE_ORG_A, note: "déjà actif" });
  await cas("adminA", "actionModifierRoles", { organisationId: ORG_A, utilisateurId: SUPPLEANT_A, roles: ["LECTEUR"] }, "membres.suppleant_reserve_superadmin", { note: "G1 : suppléant actif" });
  await cas("superadmin", "actionMarquerTitulaireRetour", surA, "succes", {
    page: PAGE_ORG_A, effet: () => fonctionDe(ADMIN_A) === "titulaire|-|true|false" && fonctionDe(SUPPLEANT_A) === "suppleant|inactif|false|false",
  });
  await cas("superadmin", "actionDepartTitulaire", surA, "succes", {
    page: PAGE_ORG_A, effet: () => fonctionDe(SUPPLEANT_A) === "titulaire|-|true|false" && fonctionDe(ADMIN_A) === "-|-|false|false"
      && sql(`SELECT statut FROM platform.utilisateurs WHERE id = '${ADMIN_A}'`) === "actif",
  });
  await cas("superadmin", "actionDepartTitulaire", surA, "orgs.suppleant_absent", { page: PAGE_ORG_A, note: "plus de suppléant" });
  await cas("superadmin", "actionActiverSuppleant", surA, "orgs.suppleant_absent", { page: PAGE_ORG_A, note: "plus de suppléant" });
  await cas("superadmin", "actionInviterSuppleant", { ...inviteSup, email: "SUPPLEANT-A@droits.test" }, "erreur.deja_membre", { page: PAGE_ORG_A, note: "le titulaire lui-même" });
  await cas("superadmin", "actionInviterSuppleant", inviteSup, "succes", {
    page: PAGE_ORG_A, effet: (r) => Boolean(r.lien)
      && sql(`SELECT count(*) FROM platform.invitations WHERE organisation_id = '${ORG_A}' AND fonction_org = 'suppleant' AND acceptee_le IS NULL AND annulee_le IS NULL`) === "1",
  });

  // Lien de réinitialisation (page publique) : la personne choisit SON mot de passe ; à usage unique ; refusé à une
  // personne déjà connectée. Le lien est créé ici directement en base (le serveur de test n'envoie pas de courriel).
  const { createHash, randomBytes } = require("node:crypto");
  const jetonReinit = randomBytes(32).toString("base64url");
  const empreinteReinit = createHash("sha256").update(jetonReinit).digest("hex");
  sql(`INSERT INTO platform.reinitialisations (utilisateur_id, jeton_empreinte, expire_le) VALUES ('${JETABLE}', '${empreinteReinit}', now() + interval '30 minutes')`);
  const saisieReinit = (jeton) => ({ jeton, nouveau: "choisi-par-la-personne-e2e-1", confirmation: "choisi-par-la-personne-e2e-1" });
  ctx.anonyme = await navigateur.newContext(); // le visiteur de tout à l'heure a créé son compte : un navigateur neuf, sans session
  await cas("anonyme", "actionReinitialiserParLien", saisieReinit("x".repeat(43)), "reinit.invalide", { note: "lien inconnu" });
  for (const qui of ["lecteurA", "superadmin"]) await cas(qui, "actionReinitialiserParLien", saisieReinit(jetonReinit), "invitation.deja_connecte", { note: "personne connectée" });
  const hashAvantLien = sql(`SELECT mot_de_passe_hash FROM platform.utilisateurs WHERE id = '${JETABLE}'`);
  await cas("anonyme", "actionReinitialiserParLien", saisieReinit(jetonReinit), "succes", {
    effet: () => sql(`SELECT mot_de_passe_hash <> '${hashAvantLien}' AND NOT doit_changer_mdp FROM platform.utilisateurs WHERE id = '${JETABLE}'`) === "t"
      && sql(`SELECT utilisee_le IS NOT NULL FROM platform.reinitialisations WHERE jeton_empreinte = '${empreinteReinit}'`) === "t",
  });
  await cas("anonyme", "actionReinitialiserParLien", saisieReinit(jetonReinit), "reinit.invalide", { note: "lien déjà utilisé" });
  // Mode maintenance : réservé au superadmin, qu'il s'agisse de l'activer ou de le lever. Requêtes forgées refusées
  // maintenance inactive (« introuvable ») PUIS maintenance active (renvoi vers /maintenance), sans aucune écriture
  // (l'état de maintenance fait partie de l'empreinte) ; le superadmin la lève ensuite pour la suite du test.
  const maintenance = () => sql("SELECT actif::text || '|' || message_fr FROM platform.maintenance WHERE singleton");
  const textesMaintenance = { messageFr: "Maintenance d'essai (e2e).", messageEn: "Test maintenance (e2e)." };
  await plateforme("actionEnregistrerMaintenance", { actif: "oui", ...textesMaintenance },
    () => maintenance() === `true|${textesMaintenance.messageFr}`, "activation");
  const lever = { actif: "non", ...textesMaintenance };
  for (const qui of ["faux", "attente"]) await cas(qui, "actionEnregistrerMaintenance", lever, "session", { note: "maintenance active" });
  for (const qui of NON_SUPERADMINS) await cas(qui, "actionEnregistrerMaintenance", lever, "redirection:/maintenance", { note: "lever la maintenance active" });
  assert.equal(maintenance(), `true|${textesMaintenance.messageFr}`, "la maintenance reste active après les requêtes forgées");
  await cas("superadmin", "actionEnregistrerMaintenance", lever, "succes", { effet: () => maintenance() === `false|${textesMaintenance.messageFr}`, note: "levée" });
  // En dernier : l'administrateur « en attente » perd ici son second facteur.
  await plateforme("actionReinitialiserSecondFacteur", { utilisateurId: MFA_A }, () => sql(`SELECT mfa_active_le IS NULL FROM platform.utilisateurs WHERE id = '${MFA_A}'`) === "t");

  // ======================================================================================== bilan
  etape("bilan des actions (✔ autorisé et effectué, ✖ refusé sans écriture)");
  const colonnes = ["anonyme", "faux", "attente", "attente2", "attente3", ...Object.keys(COMPTES)];
  const utilisees = colonnes.filter((c) => Object.values(bilanActions).some((b) => b[c]));
  const largeur = Object.fromEntries(utilisees.map((c) => [c, Math.max(c.length, ...Object.values(bilanActions).map((b) => (b[c] ?? []).length)) + 2]));
  console.log(`  ${"".padEnd(38)}${utilisees.map((c) => c.padEnd(largeur[c])).join("")}`);
  for (const action of Object.keys(REGLES)) {
    const b = bilanActions[action];
    assert.ok(b, `action jamais éprouvée : ${action}`);
    console.log(`  ${action.padEnd(38)}${utilisees.map((c) => (b[c] ? b[c].join("") : "·").padEnd(largeur[c])).join("")}`);
  }
  const total = Object.values(bilanActions).reduce((s, b) => s + Object.values(b).reduce((t, l) => t + l.length, 0), 0);
  console.log(`  ✔ ${Object.keys(REGLES).length} actions, ${total} appels forgés`);

  // ======================================================================================== journal du serveur
  // Les seules erreurs admises sont celles que ce test provoque : cookie de session forgé (Auth.js : lecture, et
  // déconnexion d'une session illisible), mot de passe faux (Auth.js), requête d'action venue d'un autre site
  // (Next.js) — chacune en nombre exact quand il est connu. Tout autre message d'erreur fait échouer le test.
  if (debutJournal !== null) {
    etape("journal du serveur pendant ce test");
    const lu = fs.readFileSync(journalServeur).subarray(debutJournal).toString("utf8").replace(/\x1b\[[0-9;]*m/g, "").split("\n");
    const entetes = lu.filter((l) => /error|⨯|exception|rejection/i.test(l) && !/^\s+at /.test(l) && !/^\[auth\]\[(cause|details)\]/.test(l));
    const ADMISES = {
      cookieForge: /^\[auth\]\[error\] JWTSessionError: /,
      deconnexionCookieForge: /^\[auth\]\[error\] SignOutError: /,
      motDePasseFaux: /^\[auth\]\[error\] CredentialsSignin: /,
      autreSite: /^⨯ Error: Invalid Server Actions request\.$/,
    };
    const autres = entetes.filter((l) => !Object.values(ADMISES).some((m) => m.test(l)));
    assert.deepEqual(autres, [], "erreurs inattendues dans le journal du serveur");
    const nb = Object.fromEntries(Object.entries(ADMISES).map(([k, m]) => [k, entetes.filter((l) => m.test(l)).length]));
    assert.ok(fauxEssaye > 0 && nb.cookieForge > 0, "cookie forgé : refus journalisé");
    assert.equal(nb.deconnexionCookieForge, fauxDeconnecte, "déconnexions avec un cookie forgé");
    assert.equal(nb.motDePasseFaux, mauvaisMotDePasse, "mots de passe faux");
    assert.ok(origineEssayee > 0, "requête d'un autre site essayée");
    assert.equal(nb.autreSite, origineEssayee, "requêtes d'un autre site refusées");
    console.log(`  ✔ seulement les refus provoqués : ${JSON.stringify(nb)}`);
  }

  await navigateur.close();
  console.log("✔ matrice des autorisations");
})().catch((e) => { console.error(e); process.exit(1); });
