// Second facteur (audit S3) : connexion en deux temps, enrôlement obligatoire du superadmin, codes TOTP (usage
// unique), codes de secours, limites d'essais, verrouillage, expiration, désactivation, réinitialisation.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { authentifier } from "../../src/server/auth/connexion";
import { lireSessionEnAttente, validerSession } from "../../src/server/auth/sessions";
import {
  activerSecondFacteur, desactiverSecondFacteur, ECHECS_MFA_AVANT_VERROU, ECHECS_MFA_PAR_SESSION, lireEtatSecondFacteur,
  MINUTES_SESSION_EN_ATTENTE, preparerEnrolement, regenererCodesSecours, reinitialiserSecondFacteur, validerSessionParCode,
} from "../../src/server/auth/second-facteur";
import { depuisBase32, hotp, pasDe } from "../../src/server/auth/totp";
import { lireJournalOrganisation } from "../../src/server/consultation/service";
import { changerStatutOrganisation } from "../../src/server/organisations/service";
import { modifierRoles } from "../../src/server/membres/service";
import { enTransaction } from "../../src/server/db/transactions";
import type { Acteur } from "../../src/server/acteur";
import { cleErreur, codeErreur, creerOrgDeTest, creerSuperadmin, MDP_TEST, membreDeTest, ouvrirPools, suffixe, type OrgDeTest } from "./outils";

let app: Pool;
let proprietaire: Pool;
let superadmin: Acteur;
let org: OrgDeTest;
const CLE = Buffer.alloc(32, 9);
const REGLES = { inactiviteMinutes: 120, dureeMaxHeures: 8 };
const RESEAU = { ip: "198.51.100.200", agent: "vitest" };
let prochaineAdresse = 1;

beforeAll(async () => {
  ({ app, proprietaire } = ouvrirPools());
  superadmin = await creerSuperadmin(proprietaire);
  org = await creerOrgDeTest(app, proprietaire, superadmin);
});

afterAll(async () => {
  await app.end();
  await proprietaire.end();
});

/** Code de l'application pour le pas courant (+ décalage). */
const codeDe = (secret: string, decalage = 0) => hotp(depuisBase32(secret), BigInt(pasDe(Date.now()) + decalage));

async function connexion(email: string) {
  const r = await authentifier(app, { email, motDePasse: MDP_TEST, ip: `203.0.113.${prochaineAdresse++ % 250}`, agent: "vitest" });
  if (!r.ok) throw new Error(`connexion refusée : ${r.raison}`);
  return r;
}

async function nouveauMembre(): Promise<Acteur> {
  const email = `mfa-${suffixe()}@test.local`;
  const id = await membreDeTest(app, org.cible, { email, roles: ["LECTEUR"] }, superadmin);
  return { id, email, ip: "127.0.0.1", agent: "vitest" };
}

/** Un compte avec second facteur actif : renvoie son secret et ses codes de secours. */
async function avecSecondFacteur(personne: Acteur): Promise<{ secret: string; codes: string[] }> {
  const { secret } = await preparerEnrolement(app, CLE, personne);
  const codes = await activerSecondFacteur(app, CLE, personne, codeDe(secret));
  return { secret, codes };
}

const valide = (r: { utilisateur: { id: string }; sessionId: string }) => validerSession(app, { utilisateurId: r.utilisateur.id, sessionId: r.sessionId }, REGLES);
const ids = (r: { utilisateur: { id: string }; sessionId: string }) => ({ utilisateurId: r.utilisateur.id, sessionId: r.sessionId });

describe("superadmin : second facteur obligatoire", () => {
  it("le mot de passe n'ouvre qu'une session en attente ; enrôlement ; la session devient valable ; secret chiffré en base", async () => {
    const sa = await creerSuperadmin(proprietaire);
    const r = await connexion(sa.email);
    expect(r.secondFacteur).toBe(true);
    expect(await valide(r)).toBeNull(); // refusée partout tant que le code n'est pas donné
    expect(await lireSessionEnAttente(app, ids(r), MINUTES_SESSION_EN_ATTENTE)).toMatchObject({ mfaActif: false, utilisateur: { estSuperadmin: true } });
    // Sans second facteur actif, le code ne peut pas valider la session.
    expect(await validerSessionParCode(app, CLE, ids(r), "123456", RESEAU)).toEqual({ ok: false, raison: "indisponible" });

    const e1 = await preparerEnrolement(app, CLE, sa);
    const e2 = await preparerEnrolement(app, CLE, sa);
    expect(e2.secret).toBe(e1.secret); // l'enrôlement en cours est repris (même code QR)
    expect(e1.adresse).toContain(`secret=${e1.secret}`);
    expect(await cleErreur(activerSecondFacteur(app, CLE, sa, "000000", r.sessionId))).toBe("mfa.code_faux");
    const codes = await activerSecondFacteur(app, CLE, sa, codeDe(e1.secret), r.sessionId);
    expect(codes).toHaveLength(10);
    expect(await valide(r)).not.toBeNull();
    expect(await lireEtatSecondFacteur(app, sa.id)).toEqual({ actif: true, obligatoire: true, codesRestants: 10 });

    const ligne = await enTransaction(proprietaire, (c) => c.query<Record<string, unknown>>("SELECT mfa_secret_chiffre FROM platform.utilisateurs WHERE id = $1", [sa.id]));
    expect(String(ligne.rows[0]!.mfa_secret_chiffre)).toMatch(/^v1\./);
    expect(String(ligne.rows[0]!.mfa_secret_chiffre)).not.toContain(e1.secret);
    const empreintes = await enTransaction(proprietaire, (c) => c.query<{ empreinte: string }>("SELECT empreinte FROM platform.codes_secours WHERE utilisateur_id = $1", [sa.id]));
    expect(empreintes.rows).toHaveLength(10);
    for (const code of codes) expect(empreintes.rows.some((l) => l.empreinte.includes(code))).toBe(false);
  });

  it("ne peut ni le désactiver, ni se le faire retirer depuis l'interface", async () => {
    const sa = await creerSuperadmin(proprietaire);
    const { secret } = await avecSecondFacteur(sa);
    expect(await cleErreur(desactiverSecondFacteur(app, CLE, { ...sa, estSuperadmin: true }, codeDe(secret, 1)))).toBe("mfa.obligatoire");
    expect(await cleErreur(reinitialiserSecondFacteur(app, sa.id, superadmin))).toBe("erreur.superadmin_protege");
  });
});

describe("code demandé après le mot de passe", () => {
  it("code juste : session valable ; le même code ne sert pas deux fois (rejeu)", async () => {
    const p = await nouveauMembre();
    const { secret } = await avecSecondFacteur(p);
    const r1 = await connexion(p.email);
    expect(r1.secondFacteur).toBe(true);
    const code = codeDe(secret, 1);
    expect(await validerSessionParCode(app, CLE, ids(r1), code, RESEAU)).toMatchObject({ ok: true, methode: "totp" });
    expect(await valide(r1)).not.toBeNull();
    const r2 = await connexion(p.email);
    expect(await validerSessionParCode(app, CLE, ids(r2), code, RESEAU)).toEqual({ ok: false, raison: "code" });
    expect(await valide(r2)).toBeNull();
  });

  it(`${ECHECS_MFA_PAR_SESSION} codes faux ferment la session (il faut redonner le mot de passe)`, async () => {
    const p = await nouveauMembre();
    await avecSecondFacteur(p);
    const r = await connexion(p.email);
    for (let i = 1; i < ECHECS_MFA_PAR_SESSION; i++) expect(await validerSessionParCode(app, CLE, ids(r), "000000", RESEAU)).toEqual({ ok: false, raison: "code" });
    expect(await validerSessionParCode(app, CLE, ids(r), "000000", RESEAU)).toEqual({ ok: false, raison: "session_fermee" });
    expect(await lireSessionEnAttente(app, ids(r), MINUTES_SESSION_EN_ATTENTE)).toBeNull();
    expect(await validerSessionParCode(app, CLE, ids(r), "000000", RESEAU)).toEqual({ ok: false, raison: "session_fermee" });
  });

  it(`${ECHECS_MFA_AVANT_VERROU} échecs consécutifs sur plusieurs sessions verrouillent le compte`, async () => {
    const p = await nouveauMembre();
    const { secret } = await avecSecondFacteur(p);
    type Connexion = Awaited<ReturnType<typeof connexion>>;
    let dernier: Connexion | undefined;
    for (let n = 0; n < ECHECS_MFA_AVANT_VERROU; n++) {
      const r: Connexion = n % 4 === 0 || !dernier ? await connexion(p.email) : dernier;
      dernier = r;
      const res = await validerSessionParCode(app, CLE, ids(r), "000000", RESEAU);
      if (n < ECHECS_MFA_AVANT_VERROU - 1) expect(res.ok).toBe(false);
      else expect(res).toEqual({ ok: false, raison: "verrouille" });
    }
    const refus = await authentifier(app, { email: p.email, motDePasse: MDP_TEST, ip: "203.0.113.251", agent: "vitest" });
    expect(refus).toEqual({ ok: false, raison: "verrouille" });
    // Le bon code ne déverrouille rien.
    expect(await validerSessionParCode(app, CLE, ids(dernier!), codeDe(secret, 1), RESEAU)).toEqual({ ok: false, raison: "session_fermee" });
  });

  it("une réussite remet le compteur du compte à zéro", async () => {
    const p = await nouveauMembre();
    const { secret } = await avecSecondFacteur(p);
    const r = await connexion(p.email);
    for (let i = 0; i < 3; i++) await validerSessionParCode(app, CLE, ids(r), "000000", RESEAU);
    expect((await validerSessionParCode(app, CLE, ids(r), codeDe(secret, 1), RESEAU)).ok).toBe(true);
    const n = await enTransaction(app, (c) => c.query<{ echecs_mfa: number }>("SELECT echecs_mfa FROM platform.utilisateurs WHERE id = $1", [p.id]));
    expect(n.rows[0]!.echecs_mfa).toBe(0);
  });

  it(`session en attente : expire au bout de ${MINUTES_SESSION_EN_ATTENTE} minutes`, async () => {
    const p = await nouveauMembre();
    const { secret } = await avecSecondFacteur(p);
    const r = await connexion(p.email);
    await enTransaction(proprietaire, (c) => c.query("UPDATE platform.sessions SET debut = debut - interval '11 minutes' WHERE id = $1", [r.sessionId]));
    expect(await validerSessionParCode(app, CLE, ids(r), codeDe(secret, 1), RESEAU)).toEqual({ ok: false, raison: "session_fermee" });
    expect(await lireSessionEnAttente(app, ids(r), MINUTES_SESSION_EN_ATTENTE)).toBeNull();
  });

  it("codes de secours : chacun ne sert qu'une fois ; saisie tolérante (majuscules, sans tiret)", async () => {
    const p = await nouveauMembre();
    const { codes } = await avecSecondFacteur(p);
    const r1 = await connexion(p.email);
    expect(await validerSessionParCode(app, CLE, ids(r1), codes[0]!.toUpperCase().replace("-", ""), RESEAU)).toEqual({ ok: true, methode: "secours", codesRestants: 9 });
    const r2 = await connexion(p.email);
    expect(await validerSessionParCode(app, CLE, ids(r2), codes[0]!, RESEAU)).toEqual({ ok: false, raison: "code" });
    expect(await validerSessionParCode(app, CLE, ids(r2), codes[1]!, RESEAU)).toMatchObject({ ok: true, codesRestants: 8 });
  });

  it("sans clé de chiffrement : rien n'est possible (et rien n'est ouvert)", async () => {
    const p = await nouveauMembre();
    await avecSecondFacteur(p);
    const r = await connexion(p.email);
    expect(await validerSessionParCode(app, null, ids(r), "123456", RESEAU)).toEqual({ ok: false, raison: "indisponible" });
    expect(await valide(r)).toBeNull();
    expect(await cleErreur(preparerEnrolement(app, null, await nouveauMembre()))).toBe("mfa.indisponible");
  });

  it("secret chiffré lié au compte : recopié sur un autre compte, il ne sert à rien", async () => {
    const a = await nouveauMembre();
    const b = await nouveauMembre();
    const { secret } = await avecSecondFacteur(a);
    await avecSecondFacteur(b);
    await enTransaction(proprietaire, (c) => c.query("UPDATE platform.utilisateurs SET mfa_secret_chiffre = (SELECT mfa_secret_chiffre FROM platform.utilisateurs WHERE id = $1) WHERE id = $2", [a.id, b.id]));
    const r = await connexion(b.email);
    expect(await validerSessionParCode(app, CLE, ids(r), codeDe(secret, 1), RESEAU)).toEqual({ ok: false, raison: "code" });
  });
});

describe("compte ordinaire : second facteur facultatif", () => {
  it("sans second facteur, le mot de passe suffit ; une fois activé, le code est demandé", async () => {
    const p = await nouveauMembre();
    const r1 = await connexion(p.email);
    expect(r1.secondFacteur).toBe(false);
    expect(await valide(r1)).not.toBeNull();
    await avecSecondFacteur(p);
    const r2 = await connexion(p.email);
    expect(r2.secondFacteur).toBe(true);
    expect(await valide(r2)).toBeNull();
  });

  it("désactivation : code exigé (l'échec compte) ; ensuite le mot de passe suffit de nouveau", async () => {
    const p = await nouveauMembre();
    const { secret } = await avecSecondFacteur(p);
    const personne = { ...p, estSuperadmin: false };
    expect(await cleErreur(desactiverSecondFacteur(app, CLE, personne, "000000"))).toBe("mfa.code_faux");
    const n = await enTransaction(app, (c) => c.query<{ echecs_mfa: number }>("SELECT echecs_mfa FROM platform.utilisateurs WHERE id = $1", [p.id]));
    expect(n.rows[0]!.echecs_mfa).toBe(1);
    await desactiverSecondFacteur(app, CLE, personne, codeDe(secret, 1));
    expect(await lireEtatSecondFacteur(app, p.id)).toEqual({ actif: false, obligatoire: false, codesRestants: 0 });
    expect((await connexion(p.email)).secondFacteur).toBe(false);
  });

  it("nouveaux codes de secours : les anciens ne servent plus", async () => {
    const p = await nouveauMembre();
    const { secret, codes: anciens } = await avecSecondFacteur(p);
    const nouveaux = await regenererCodesSecours(app, CLE, p, codeDe(secret, 1));
    expect(nouveaux).toHaveLength(10);
    const r = await connexion(p.email);
    expect(await validerSessionParCode(app, CLE, ids(r), anciens[2]!, RESEAU)).toEqual({ ok: false, raison: "code" });
    expect((await validerSessionParCode(app, CLE, ids(r), nouveaux[2]!, RESEAU)).ok).toBe(true);
  });

  it("retrait par le superadmin : sessions fermées, tracé dans la plateforme et dans l'organisation", async () => {
    const p = await nouveauMembre();
    await avecSecondFacteur(p);
    const r = await connexion(p.email);
    await reinitialiserSecondFacteur(app, p.id, superadmin);
    expect(await lireSessionEnAttente(app, ids(r), MINUTES_SESSION_EN_ATTENTE)).toBeNull();
    expect(await lireEtatSecondFacteur(app, p.id)).toMatchObject({ actif: false, codesRestants: 0 });
    const journal = (await lireJournalOrganisation(app, org.cible, { page: 1 })).lignes.find((l) => l.action === "SECOND_FACTEUR_REINITIALISE" && l.cibleId === p.id);
    expect(journal?.acteurEmail).toBe(superadmin.email);
    expect(await cleErreur(reinitialiserSecondFacteur(app, p.id, superadmin))).toBe("mfa.inactif");
  });
});

describe("approbateur : second facteur obligatoire (décision n° 4 du 19/10/2026)", () => {
  async function approbateur(cible: OrgDeTest): Promise<Acteur> {
    const email = `appro-${suffixe()}@test.local`;
    const id = await membreDeTest(app, cible.cible, { email, roles: ["APPROBATEUR"] }, superadmin);
    return { id, email, ip: "127.0.0.1", agent: "vitest" };
  }

  it("le mot de passe n'ouvre qu'une session en attente ; enrôlement imposé ; ensuite la session est valable", async () => {
    const a = await approbateur(org);
    expect((await lireEtatSecondFacteur(app, a.id)).obligatoire).toBe(true);
    const r = await connexion(a.email);
    expect(r.secondFacteur).toBe(true);
    expect(await valide(r)).toBeNull();
    expect(await lireSessionEnAttente(app, ids(r), MINUTES_SESSION_EN_ATTENTE)).toMatchObject({ mfaActif: false, utilisateur: { estSuperadmin: false } });
    const { secret } = await preparerEnrolement(app, CLE, a);
    await activerSecondFacteur(app, CLE, a, codeDe(secret), r.sessionId);
    expect(await valide(r)).not.toBeNull();
  });

  it("il ne peut pas le désactiver", async () => {
    const a = await approbateur(org);
    const { secret } = await avecSecondFacteur(a);
    expect(await cleErreur(desactiverSecondFacteur(app, CLE, { ...a, estSuperadmin: false }, codeDe(secret, 1)))).toBe("mfa.obligatoire");
    expect((await lireEtatSecondFacteur(app, a.id)).actif).toBe(true);
  });

  it("le rôle d'approbateur reçu plus tard rend le second facteur obligatoire ; le retirer le rend facultatif", async () => {
    const m = await nouveauMembre(); // lecteur
    expect((await connexion(m.email)).secondFacteur).toBe(false);
    await modifierRoles(app, org.cible, m.id, ["LECTEUR", "APPROBATEUR"], superadmin);
    expect((await connexion(m.email)).secondFacteur).toBe(true);
    await modifierRoles(app, org.cible, m.id, ["LECTEUR"], superadmin);
    expect((await connexion(m.email)).secondFacteur).toBe(false);
  });

  it("organisation suspendue : le rôle ne compte pas ; réactivée : second facteur exigé à la connexion suivante", async () => {
    const autre = await creerOrgDeTest(app, proprietaire, superadmin);
    const a = await approbateur(autre);
    await changerStatutOrganisation(app, autre.organisationId, "suspendue", superadmin);
    expect((await connexion(a.email)).secondFacteur).toBe(false);
    expect((await lireEtatSecondFacteur(app, a.id)).obligatoire).toBe(false);
    await changerStatutOrganisation(app, autre.organisationId, "active", superadmin);
    expect((await connexion(a.email)).secondFacteur).toBe(true);
  });
});

describe("protections en base", () => {
  it("l'application ne peut ni modifier une empreinte de code de secours, ni se donner le rôle de superadmin", async () => {
    const p = await nouveauMembre();
    await avecSecondFacteur(p);
    expect(await codeErreur(enTransaction(app, (c) => c.query("UPDATE platform.codes_secours SET empreinte = repeat('0', 64) WHERE utilisateur_id = $1", [p.id])))).toBe("42501");
    expect(await codeErreur(enTransaction(app, (c) => c.query("UPDATE platform.utilisateurs SET est_superadmin = true WHERE id = $1", [p.id])))).toBe("42501");
    expect(await codeErreur(enTransaction(app, (c) => c.query("UPDATE platform.utilisateurs SET mfa_secret_chiffre = 'texte clair' WHERE id = $1", [p.id])))).toBe("23514");
  });
});
