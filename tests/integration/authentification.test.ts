// Connexion, verrouillage, sessions (validation, expiration, révocation), mots de passe, comptes.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { authentifier, ECHECS_AVANT_VERROU } from "../../src/server/auth/connexion";
import { terminerSession, validerSession } from "../../src/server/auth/sessions";
import { enTransaction } from "../../src/server/db/transactions";
import {
  changerMotDePasse,
  desactiverUtilisateur,
  reactiverUtilisateur,
  creerReinitialisation,
  reinitialiserParLien,
  revoquerSessionsUtilisateur,
} from "../../src/server/utilisateurs/service";
import type { Acteur } from "../../src/server/acteur";
import { cleErreur, creerOrgDeTest, creerSuperadmin, MDP_TEST, membreDeTest, ouvrirPools, suffixe, type OrgDeTest } from "./outils";

const REGLES = { inactiviteMinutes: 120, dureeMaxHeures: 8 };

let app: Pool;
let proprietaire: Pool;
let superadmin: Acteur;
let org: OrgDeTest;

beforeAll(async () => {
  ({ app, proprietaire } = ouvrirPools());
  superadmin = await creerSuperadmin(proprietaire);
  org = await creerOrgDeTest(app, proprietaire, superadmin);
});

afterAll(async () => {
  await app.end();
  await proprietaire.end();
});

async function nouvelUtilisateur(): Promise<{ id: string; email: string }> {
  const email = `u-${suffixe()}@test.local`;
  const id = await membreDeTest(app, org.cible, { email, nom: "Utilisateur", roles: ["LECTEUR"] }, superadmin);
  return { id, email };
}

function connexion(email: string, motDePasse: string) {
  return authentifier(app, { email, motDePasse, ip: "203.0.113.7", agent: "vitest" });
}

async function derniereAction(email: string): Promise<{ action: string; details: Record<string, unknown> } | undefined> {
  const r = await enTransaction(app, (c) =>
    c.query<{ action: string; details: Record<string, unknown> }>("SELECT action, details FROM platform.journal WHERE acteur_email = $1 ORDER BY id DESC LIMIT 1", [email]),
  );
  return r.rows[0];
}

describe("connexion", () => {
  it("bon mot de passe : session ouverte, valide, connexion journalisée (compte créé par invitation : mot de passe choisi, rien à changer)", async () => {
    const u = await nouvelUtilisateur();
    const r = await connexion(u.email, MDP_TEST);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const s = await validerSession(app, { utilisateurId: u.id, sessionId: r.sessionId }, REGLES);
    expect(s?.utilisateur.email).toBe(u.email);
    expect(s?.utilisateur.doitChangerMdp).toBe(false);
    expect((await derniereAction(u.email))?.action).toBe("CONNEXION");
  });

  it("e-mail inconnu : refus générique, tentative journalisée", async () => {
    const email = `inconnu-${suffixe()}@test.local`;
    expect(await connexion(email, MDP_TEST)).toEqual({ ok: false, raison: "identifiants" });
    expect(await derniereAction(email)).toEqual({ action: "CONNEXION_ECHEC", details: { raison: "inconnu" } });
  });

  it(`verrouillage après ${ECHECS_AVANT_VERROU} échecs depuis une adresse, même avec le bon mot de passe ensuite`, async () => {
    const u = await nouvelUtilisateur();
    for (let i = 0; i < ECHECS_AVANT_VERROU; i++) expect((await connexion(u.email, "mauvais-mot-de-passe")).ok).toBe(false);
    expect(await connexion(u.email, MDP_TEST)).toEqual({ ok: false, raison: "verrouille" });
    const verrou = await enTransaction(app, (c) => c.query("SELECT 1 FROM platform.journal WHERE acteur_email = $1 AND action = 'COMPTE_VERROUILLE'", [u.email]));
    expect(verrou.rowCount).toBe(1);
    // Fin de la fenêtre de 15 min (on vieillit les tentatives) : la connexion repasse.
    await enTransaction(proprietaire, (c) => c.query("UPDATE platform.tentatives_connexion SET horodatage = horodatage - interval '16 minutes' WHERE email = $1", [u.email]));
    expect((await connexion(u.email, MDP_TEST)).ok).toBe(true);
  });

  it("une identité sans session valide est refusée (identifiants mal formés)", async () => {
    expect(await validerSession(app, { utilisateurId: "pas-un-uuid", sessionId: "x" }, REGLES)).toBeNull();
  });
});

describe("sessions", () => {
  it("déconnexion : la session n'est plus acceptée", async () => {
    const u = await nouvelUtilisateur();
    const r = await connexion(u.email, MDP_TEST);
    if (!r.ok) throw new Error("connexion attendue");
    await terminerSession(app, r.sessionId, { id: u.id, email: u.email });
    expect(await validerSession(app, { utilisateurId: u.id, sessionId: r.sessionId }, REGLES)).toBeNull();
  });

  it("inactivité trop longue : session expirée, fermée et journalisée", async () => {
    const u = await nouvelUtilisateur();
    const r = await connexion(u.email, MDP_TEST);
    if (!r.ok) throw new Error("connexion attendue");
    await enTransaction(proprietaire, (c) => c.query("UPDATE platform.sessions SET derniere_activite = now() - interval '3 hours' WHERE id = $1", [r.sessionId]));
    expect(await validerSession(app, { utilisateurId: u.id, sessionId: r.sessionId }, REGLES)).toBeNull();
    const s = await enTransaction(app, (c) => c.query<{ motif_fin: string }>("SELECT motif_fin FROM platform.sessions WHERE id = $1", [r.sessionId]));
    expect(s.rows[0]!.motif_fin).toBe("expiration");
    expect((await derniereAction(u.email))?.action).toBe("SESSION_EXPIREE");
  });

  it("session plus ancienne que la durée maximale : refusée même si active", async () => {
    const u = await nouvelUtilisateur();
    const r = await connexion(u.email, MDP_TEST);
    if (!r.ok) throw new Error("connexion attendue");
    await enTransaction(proprietaire, (c) => c.query("UPDATE platform.sessions SET debut = now() - interval '9 hours' WHERE id = $1", [r.sessionId]));
    expect(await validerSession(app, { utilisateurId: u.id, sessionId: r.sessionId }, REGLES)).toBeNull();
  });

  it("la session d'un autre utilisateur ne peut pas être reprise", async () => {
    const u1 = await nouvelUtilisateur();
    const u2 = await nouvelUtilisateur();
    const r = await connexion(u1.email, MDP_TEST);
    if (!r.ok) throw new Error("connexion attendue");
    expect(await validerSession(app, { utilisateurId: u2.id, sessionId: r.sessionId }, REGLES)).toBeNull();
  });

  it("révocation par le superadmin : toutes les sessions sont fermées", async () => {
    const u = await nouvelUtilisateur();
    const r1 = await connexion(u.email, MDP_TEST);
    const r2 = await connexion(u.email, MDP_TEST);
    if (!r1.ok || !r2.ok) throw new Error("connexions attendues");
    expect(await revoquerSessionsUtilisateur(app, u.id, superadmin)).toBe(2);
    expect(await validerSession(app, { utilisateurId: u.id, sessionId: r1.sessionId }, REGLES)).toBeNull();
    expect(await validerSession(app, { utilisateurId: u.id, sessionId: r2.sessionId }, REGLES)).toBeNull();
  });
});

describe("gestion des comptes par le superadmin", () => {
  it("désactivation : sessions fermées, connexion refusée ; réactivation : connexion possible", async () => {
    const u = await nouvelUtilisateur();
    const r = await connexion(u.email, MDP_TEST);
    if (!r.ok) throw new Error("connexion attendue");
    expect(await desactiverUtilisateur(app, u.id, superadmin)).toBe(1);
    expect(await validerSession(app, { utilisateurId: u.id, sessionId: r.sessionId }, REGLES)).toBeNull();
    expect(await connexion(u.email, MDP_TEST)).toEqual({ ok: false, raison: "desactive" });
    await reactiverUtilisateur(app, u.id, superadmin);
    expect((await connexion(u.email, MDP_TEST)).ok).toBe(true);
  });

  it("réinitialisation par lien : la personne choisit son mot de passe, l'ancien est refusé, ses sessions sont fermées", async () => {
    const u = await nouvelUtilisateur();
    const avant = await connexion(u.email, MDP_TEST);
    if (!avant.ok) throw new Error("connexion attendue");
    const lien = await creerReinitialisation(app, u.id, superadmin);
    // Tant que le lien n'est pas utilisé, rien ne change : l'ancien mot de passe reste valable.
    expect((await connexion(u.email, MDP_TEST)).ok).toBe(true);
    const nouveau = "choisi-par-la-personne-1";
    await reinitialiserParLien(app, lien.jeton, nouveau, { ip: "203.0.113.7", agent: "vitest" });
    expect(await validerSession(app, { utilisateurId: u.id, sessionId: avant.sessionId }, REGLES)).toBeNull();
    expect((await connexion(u.email, MDP_TEST)).ok).toBe(false);
    const r = await connexion(u.email, nouveau);
    expect(r.ok).toBe(true);
    if (r.ok) expect((await validerSession(app, { utilisateurId: u.id, sessionId: r.sessionId }, REGLES))?.utilisateur.doitChangerMdp).toBe(false);
  });

  it("les comptes superadmin et son propre compte sont protégés", async () => {
    const autre = await creerSuperadmin(proprietaire);
    expect(await cleErreur(desactiverUtilisateur(app, autre.id, superadmin))).toBe("erreur.superadmin_protege");
    expect(await cleErreur(creerReinitialisation(app, autre.id, superadmin))).toBe("erreur.superadmin_protege");
    expect(await cleErreur(creerReinitialisation(app, superadmin.id, superadmin))).toBe("erreur.soi_meme");
    expect(await cleErreur(desactiverUtilisateur(app, superadmin.id, superadmin))).toBe("erreur.soi_meme");
  });
});

describe("changement de son mot de passe", () => {
  it("mauvais mot de passe actuel : refus, et l'échec est COMPTÉ (enregistré malgré le refus)", async () => {
    const u = await nouvelUtilisateur();
    const r = await connexion(u.email, MDP_TEST);
    if (!r.ok) throw new Error("connexion attendue");
    const cle = await cleErreur(changerMotDePasse(app, { id: u.id, email: u.email }, r.sessionId, { actuel: "faux-mot-de-passe", nouveau: "nouveau-mot-de-passe-1" }));
    expect(cle).toBe("erreur.mdp_actuel_faux");
    const e = await enTransaction(app, (c) => c.query<{ n: number }>("SELECT echecs_connexion AS n FROM platform.utilisateurs WHERE id = $1", [u.id]));
    expect(e.rows[0]!.n).toBe(1);
  });

  it("bon mot de passe : modifié, provisoire levé, AUTRES sessions fermées, session courante conservée", async () => {
    const u = await nouvelUtilisateur();
    const courante = await connexion(u.email, MDP_TEST);
    const autre = await connexion(u.email, MDP_TEST);
    if (!courante.ok || !autre.ok) throw new Error("connexions attendues");
    await changerMotDePasse(app, { id: u.id, email: u.email }, courante.sessionId, { actuel: MDP_TEST, nouveau: "nouveau-mot-de-passe-1" });
    const s = await validerSession(app, { utilisateurId: u.id, sessionId: courante.sessionId }, REGLES);
    expect(s?.utilisateur.doitChangerMdp).toBe(false);
    expect(await validerSession(app, { utilisateurId: u.id, sessionId: autre.sessionId }, REGLES)).toBeNull();
    expect((await connexion(u.email, "nouveau-mot-de-passe-1")).ok).toBe(true);
  });

  it("politique : trop court, identique à l'actuel, égal à l'e-mail", async () => {
    const u = await nouvelUtilisateur();
    const acteur = { id: u.id, email: u.email };
    const sid = "00000000-0000-0000-0000-000000000000";
    expect(await cleErreur(changerMotDePasse(app, acteur, sid, { actuel: MDP_TEST, nouveau: "court" }))).toBe("erreur.mdp_trop_court");
    expect(await cleErreur(changerMotDePasse(app, acteur, sid, { actuel: MDP_TEST, nouveau: MDP_TEST }))).toBe("erreur.mdp_identique");
    expect(await cleErreur(changerMotDePasse(app, acteur, sid, { actuel: MDP_TEST, nouveau: u.email }))).toBe("erreur.mdp_egal_email");
  });
});
