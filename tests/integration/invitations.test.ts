// Invitations à rejoindre une organisation (audit S8, S10) et trace des réinitialisations du superadmin (S9).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import {
  accepterAvecCompte,
  accepterAvecNouveauCompte,
  annulerInvitation,
  empreinteJeton,
  inviter,
  listerInvitations,
  lireInvitation,
} from "../../src/server/invitations/service";
import { listerMembres } from "../../src/server/membres/service";
import { changerStatutOrganisation } from "../../src/server/organisations/service";
import { creerOrganisation } from "../../src/server/organisations/provisionnement";
import { authentifier } from "../../src/server/auth/connexion";
import { reinitialiserMotDePasse } from "../../src/server/utilisateurs/service";
import { lireJournalOrganisation } from "../../src/server/consultation/service";
import { enTransaction } from "../../src/server/db/transactions";
import type { Acteur } from "../../src/server/acteur";
import { cleErreur, codeErreur, creerOrgDeTest, creerSuperadmin, MDP_TEST, membreDeTest, ouvrirPools, RESEAU_TEST, suffixe, type OrgDeTest } from "./outils";

let app: Pool;
let proprietaire: Pool;
let superadmin: Acteur;

beforeAll(async () => {
  ({ app, proprietaire } = ouvrirPools());
  superadmin = await creerSuperadmin(proprietaire);
});

afterAll(async () => {
  await app.end();
  await proprietaire.end();
});

const adresse = () => `inv-${suffixe()}@test.local`;
const MDP_CHOISI = "mot-de-passe-choisi-1";
const nouveauCompte = (jeton: string, motDePasse = MDP_CHOISI) => accepterAvecNouveauCompte(app, jeton, { nom: "Personne Invitée", motDePasse, langue: "fr" }, RESEAU_TEST);
const estMembre = async (org: OrgDeTest, email: string) => (await listerMembres(app, org.organisationId)).some((m) => m.email === email);
const adminDe = (org: OrgDeTest): Acteur => ({ id: org.adminId, email: org.adminEmail, ip: "127.0.0.1", agent: "vitest" });

async function idDe(email: string): Promise<string | undefined> {
  const r = await enTransaction(app, (c) => c.query<{ id: string }>("SELECT id FROM platform.utilisateurs WHERE email = $1", [email]));
  return r.rows[0]?.id;
}

async function actionsJournal(org: OrgDeTest): Promise<string[]> {
  return (await lireJournalOrganisation(app, org.cible, { page: 1 })).lignes.map((l) => l.action).reverse();
}

describe("invitation d'une personne sans compte", () => {
  it("rien n'est créé avant l'acceptation ; elle crée SON compte (mot de passe choisi) et devient membre ; tout est tracé", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const email = adresse();
    const inv = await inviter(app, org.cible, { email, nom: "Personne Invitée", roles: ["REDACTEUR"] }, adminDe(org));

    expect(inv.jeton).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(inv.expireLe.getTime() - Date.now()).toBeGreaterThan(71.9 * 3600_000);
    expect(inv.expireLe.getTime() - Date.now()).toBeLessThan(72.1 * 3600_000);
    expect(await estMembre(org, email)).toBe(false);
    expect(await idDe(email)).toBeUndefined(); // pas de compte créé à l'avance
    expect((await listerInvitations(app, org.organisationId)).map((i) => [i.email, i.roles, i.expiree])).toEqual([[email, ["REDACTEUR"], false]]);
    expect(await lireInvitation(app, inv.jeton)).toMatchObject({ organisationId: org.organisationId, email, roles: ["REDACTEUR"], compteExiste: false });

    expect(await nouveauCompte(inv.jeton)).toEqual({ organisationId: org.organisationId, email });
    const membre = (await listerMembres(app, org.organisationId)).find((m) => m.email === email);
    expect(membre?.roles).toEqual(["REDACTEUR"]);
    expect(await listerInvitations(app, org.organisationId)).toEqual([]);

    // Le mot de passe est celui choisi par la personne ; aucun changement imposé.
    const connexion = await authentifier(app, { email, motDePasse: MDP_CHOISI, ip: "192.0.2.10", agent: "vitest" });
    expect(connexion.ok && connexion.utilisateur.email).toBe(email);
    const compte = await enTransaction(app, (c) => c.query<{ doit_changer_mdp: boolean }>("SELECT doit_changer_mdp FROM platform.utilisateurs WHERE email = $1", [email]));
    expect(compte.rows[0]!.doit_changer_mdp).toBe(false);

    expect((await actionsJournal(org)).slice(-2)).toEqual(["INVITATION_CREEE", "MEMBRE_AJOUTE"]);
    const ajout = (await lireJournalOrganisation(app, org.cible, { page: 1 })).lignes.find((l) => l.action === "MEMBRE_AJOUTE" && l.cibleId === membre?.utilisateurId);
    expect(ajout?.acteurEmail).toBe(email); // c'est la personne elle-même qui a accepté
  });

  it("usage unique : le lien ne sert qu'une fois, même pour deux acceptations simultanées", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const inv = await inviter(app, org.cible, { email: adresse(), nom: "X", roles: ["LECTEUR"] }, superadmin);
    const resultats = await Promise.allSettled([nouveauCompte(inv.jeton), nouveauCompte(inv.jeton)]);
    expect(resultats.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const refus = resultats.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(["invitation.invalide", "invitation.compte_existe"]).toContain((refus.reason as { cle?: string }).cle);
    expect(await lireInvitation(app, inv.jeton)).toBeNull();
    expect(await cleErreur(nouveauCompte(inv.jeton))).toBe("invitation.invalide");
  });

  it("expirée au bout de 72 h : lien refusé, signalée comme expirée", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const email = adresse();
    const inv = await inviter(app, org.cible, { email, nom: "X", roles: ["LECTEUR"] }, superadmin);
    await enTransaction(proprietaire, (c) => c.query("UPDATE platform.invitations SET cree_le = now() - interval '73 hours', expire_le = now() - interval '1 hour' WHERE id = $1", [inv.id]));
    expect(await lireInvitation(app, inv.jeton)).toBeNull();
    expect(await cleErreur(nouveauCompte(inv.jeton))).toBe("invitation.invalide");
    expect((await listerInvitations(app, org.organisationId)).find((i) => i.id === inv.id)?.expiree).toBe(true);
    expect(await estMembre(org, email)).toBe(false);
  });

  it("nouvelle invitation de la même adresse : seul le dernier lien fonctionne", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const email = adresse();
    const premiere = await inviter(app, org.cible, { email, nom: "X", roles: ["LECTEUR"] }, superadmin);
    const seconde = await inviter(app, org.cible, { email, nom: "X", roles: ["REDACTEUR"] }, superadmin);
    expect(await lireInvitation(app, premiere.jeton)).toBeNull();
    expect((await listerInvitations(app, org.organisationId)).map((i) => i.id)).toEqual([seconde.id]);
    await nouveauCompte(seconde.jeton);
    expect((await listerMembres(app, org.organisationId)).find((m) => m.email === email)?.roles).toEqual(["REDACTEUR"]);
  });

  it("annulation : le lien ne fonctionne plus ; une autre organisation ne peut pas annuler ; tracée", async () => {
    const a = await creerOrgDeTest(app, proprietaire, superadmin);
    const b = await creerOrgDeTest(app, proprietaire, superadmin);
    const inv = await inviter(app, a.cible, { email: adresse(), nom: "X", roles: ["LECTEUR"] }, adminDe(a));
    expect(await cleErreur(annulerInvitation(app, b.cible, inv.id, adminDe(b)))).toBe("erreur.introuvable");
    expect(await lireInvitation(app, inv.jeton)).not.toBeNull();
    await annulerInvitation(app, a.cible, inv.id, adminDe(a));
    expect(await lireInvitation(app, inv.jeton)).toBeNull();
    expect(await cleErreur(nouveauCompte(inv.jeton))).toBe("invitation.invalide");
    expect(await cleErreur(annulerInvitation(app, a.cible, inv.id, adminDe(a)))).toBe("erreur.introuvable");
    expect((await actionsJournal(a)).slice(-2)).toEqual(["INVITATION_CREEE", "INVITATION_ANNULEE"]);
  });

  it("organisation suspendue : le lien n'est pas valable tant qu'elle l'est", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const inv = await inviter(app, org.cible, { email: adresse(), nom: "X", roles: ["LECTEUR"] }, superadmin);
    await changerStatutOrganisation(app, org.organisationId, "suspendue", superadmin);
    expect(await lireInvitation(app, inv.jeton)).toBeNull();
    expect(await cleErreur(nouveauCompte(inv.jeton))).toBe("invitation.invalide");
    await changerStatutOrganisation(app, org.organisationId, "active", superadmin);
    expect(await lireInvitation(app, inv.jeton)).not.toBeNull();
  });

  it("mot de passe trop faible : refusé, l'invitation reste valable", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const inv = await inviter(app, org.cible, { email: adresse(), nom: "X", roles: ["LECTEUR"] }, superadmin);
    expect(await cleErreur(nouveauCompte(inv.jeton, "court"))).toBe("erreur.mdp_trop_court");
    expect(await lireInvitation(app, inv.jeton)).not.toBeNull();
  });
});

describe("invitation d'une personne qui a déjà un compte (audit S10)", () => {
  it("aucun rattachement d'office ; elle accepte connectée avec CETTE adresse ; son mot de passe n'est pas touché", async () => {
    const a = await creerOrgDeTest(app, proprietaire, superadmin);
    const b = await creerOrgDeTest(app, proprietaire, superadmin);
    const email = adresse();
    const id = await membreDeTest(app, a.cible, { email, roles: ["LECTEUR"] }, superadmin);
    const empreinteAvant = await enTransaction(proprietaire, (c) => c.query<{ h: string }>("SELECT mot_de_passe_hash AS h FROM platform.utilisateurs WHERE id = $1", [id]));

    const inv = await inviter(app, b.cible, { email, nom: "Nom proposé par B", roles: ["REDACTEUR"] }, adminDe(b));
    expect(await estMembre(b, email)).toBe(false); // rien tant qu'elle n'a pas accepté
    expect(await lireInvitation(app, inv.jeton)).toMatchObject({ compteExiste: true });
    // Pas de second compte, pas de mot de passe fixé par un tiers.
    expect(await cleErreur(nouveauCompte(inv.jeton))).toBe("invitation.compte_existe");
    // Quelqu'un d'autre, même connecté, ne peut pas accepter à sa place.
    expect(await cleErreur(accepterAvecCompte(app, inv.jeton, adminDe(b)))).toBe("invitation.autre_compte");
    expect(await lireInvitation(app, inv.jeton)).not.toBeNull();

    expect(await accepterAvecCompte(app, inv.jeton, { id, email, ip: "127.0.0.1", agent: "vitest" })).toEqual({ organisationId: b.organisationId });
    expect((await listerMembres(app, b.organisationId)).find((m) => m.email === email)?.roles).toEqual(["REDACTEUR"]);
    const empreinteApres = await enTransaction(proprietaire, (c) => c.query<{ h: string; nom: string }>("SELECT mot_de_passe_hash AS h, nom FROM platform.utilisateurs WHERE id = $1", [id]));
    expect(empreinteApres.rows[0]!.h).toBe(empreinteAvant.rows[0]!.h);
    expect(empreinteApres.rows[0]!.nom).toBe("Membre"); // le nom proposé par B ne remplace pas le sien
  });

  it("réponse identique que l'adresse ait un compte ou non (rien ne le révèle à l'administrateur)", async () => {
    const a = await creerOrgDeTest(app, proprietaire, superadmin);
    const b = await creerOrgDeTest(app, proprietaire, superadmin);
    const existante = adresse();
    await membreDeTest(app, a.cible, { email: existante, roles: ["LECTEUR"] }, superadmin);
    const r1 = await inviter(app, b.cible, { email: existante, nom: "X", roles: ["LECTEUR"] }, adminDe(b));
    const r2 = await inviter(app, b.cible, { email: adresse(), nom: "X", roles: ["LECTEUR"] }, adminDe(b));
    expect(Object.keys(r1).sort()).toEqual(Object.keys(r2).sort());
    const journal = (await lireJournalOrganisation(app, b.cible, { page: 1 })).lignes.filter((l) => l.action === "INVITATION_CREEE" && l.acteurEmail === b.adminEmail);
    expect(journal.map((l) => Object.keys(l.details).sort())).toEqual([["email", "roles"], ["email", "roles"]]);
  });

  it("compte existant : lien déjà utilisé, expiré ou annulé refusé", async () => {
    const a = await creerOrgDeTest(app, proprietaire, superadmin);
    const b = await creerOrgDeTest(app, proprietaire, superadmin);
    const email = adresse();
    const id = await membreDeTest(app, a.cible, { email, roles: ["LECTEUR"] }, superadmin);
    const personne = { id, email };
    const utilisee = await inviter(app, b.cible, { email, nom: "X", roles: ["LECTEUR"] }, superadmin);
    await accepterAvecCompte(app, utilisee.jeton, personne);
    expect(await cleErreur(accepterAvecCompte(app, utilisee.jeton, personne))).toBe("invitation.invalide");

    const c = await creerOrgDeTest(app, proprietaire, superadmin);
    const expiree = await inviter(app, c.cible, { email, nom: "X", roles: ["LECTEUR"] }, superadmin);
    await enTransaction(proprietaire, (cl) => cl.query("UPDATE platform.invitations SET cree_le = now() - interval '73 hours', expire_le = now() - interval '1 hour' WHERE id = $1", [expiree.id]));
    expect(await cleErreur(accepterAvecCompte(app, expiree.jeton, personne))).toBe("invitation.invalide");
    const annulee = await inviter(app, c.cible, { email, nom: "X", roles: ["LECTEUR"] }, superadmin);
    await annulerInvitation(app, c.cible, annulee.id, superadmin);
    expect(await cleErreur(accepterAvecCompte(app, annulee.jeton, personne))).toBe("invitation.invalide");
    expect(await estMembre(c, email)).toBe(false);
  });

  it("déjà membre : refus clair (cette organisation seulement)", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    expect(await cleErreur(inviter(app, org.cible, { email: org.adminEmail, nom: "X", roles: ["LECTEUR"] }, superadmin))).toBe("erreur.deja_membre");
  });

  it("liste des membres : l'activité DANS l'organisation seulement, rien de l'activité ailleurs", async () => {
    const a = await creerOrgDeTest(app, proprietaire, superadmin);
    const b = await creerOrgDeTest(app, proprietaire, superadmin);
    const email = adresse();
    const id = await membreDeTest(app, a.cible, { email, roles: ["LECTEUR"] }, superadmin);
    const invB = await inviter(app, b.cible, { email, nom: "X", roles: ["ADMIN_ORGANISATION"] }, superadmin);
    await accepterAvecCompte(app, invB.jeton, { id, email });
    const avant = (await listerMembres(app, a.organisationId)).find((m) => m.email === email)!;
    // Elle agit dans B (une invitation) et se connecte : la liste de A n'en sait rien.
    await inviter(app, b.cible, { email: adresse(), nom: "Y", roles: ["LECTEUR"] }, { id, email });
    await authentifier(app, { email, motDePasse: MDP_TEST, ip: "192.0.2.11", agent: "vitest" });
    const apres = (await listerMembres(app, a.organisationId)).find((m) => m.email === email)!;
    expect(apres.derniereAction).toEqual(avant.derniereAction);
    expect(Object.keys(apres)).not.toContain("derniereConnexion");
    const dansB = (await listerMembres(app, b.organisationId)).find((m) => m.email === email)!;
    expect(dansB.derniereAction!.getTime()).toBeGreaterThan(avant.derniereAction!.getTime());
  });
});

describe("création d'une organisation : le premier administrateur est invité", () => {
  it("compte existant : rien n'est rattaché avant son acceptation", async () => {
    const premiere = await creerOrgDeTest(app, proprietaire, superadmin);
    const s = suffixe();
    const seconde = await creerOrganisation(app, { nom: `Seconde ${s}`, slug: `sec-${s}`, admin: { email: premiere.adminEmail, nom: "Ignoré" } }, superadmin);
    expect(await listerMembres(app, seconde.organisationId)).toEqual([]);
    expect(await lireInvitation(app, seconde.invitation.jeton)).toMatchObject({ email: premiere.adminEmail, roles: ["ADMIN_ORGANISATION"], compteExiste: true });
    await accepterAvecCompte(app, seconde.invitation.jeton, adminDe(premiere));
    expect((await listerMembres(app, seconde.organisationId)).map((m) => [m.email, m.roles])).toEqual([[premiere.adminEmail, ["ADMIN_ORGANISATION"]]]);
  });
});

describe("protections en base", () => {
  it("seule l'empreinte du jeton est rangée ; l'application ne peut modifier ni l'adresse, ni les rôles, ni l'empreinte", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const inv = await inviter(app, org.cible, { email: adresse(), nom: "X", roles: ["LECTEUR"] }, superadmin);
    const ligne = await enTransaction(proprietaire, (c) => c.query<Record<string, unknown>>("SELECT * FROM platform.invitations WHERE id = $1", [inv.id]));
    expect(ligne.rows[0]!.jeton_empreinte).toBe(empreinteJeton(inv.jeton));
    expect(JSON.stringify(ligne.rows[0])).not.toContain(inv.jeton);
    for (const sql of [
      "UPDATE platform.invitations SET roles = ARRAY['ADMIN_ORGANISATION'] WHERE id = $1",
      "UPDATE platform.invitations SET email = 'pirate@test.local' WHERE id = $1",
      "UPDATE platform.invitations SET jeton_empreinte = repeat('0', 64) WHERE id = $1",
      "UPDATE platform.invitations SET expire_le = now() + interval '1 year' WHERE id = $1",
      "DELETE FROM platform.invitations WHERE id = $1",
    ]) {
      expect(await codeErreur(enTransaction(app, (c) => c.query(sql, [inv.id]))), sql).toBe("42501");
    }
  });

  it("liens mal formés ou inconnus : même réponse (lien non valable)", async () => {
    for (const jeton of ["", "abc", "x".repeat(43), "../../etc/passwd", "A".repeat(42) + "=", "é".repeat(43)]) {
      expect(await lireInvitation(app, jeton), jeton).toBeNull();
      expect(await cleErreur(nouveauCompte(jeton)), jeton).toBe("invitation.invalide");
    }
  });
});

describe("réinitialisation d'un mot de passe par le superadmin (audit S9)", () => {
  it("tracée dans le journal de CHAQUE organisation de la personne, et seulement là", async () => {
    const a = await creerOrgDeTest(app, proprietaire, superadmin);
    const b = await creerOrgDeTest(app, proprietaire, superadmin);
    const c = await creerOrgDeTest(app, proprietaire, superadmin);
    const email = adresse();
    const id = await membreDeTest(app, a.cible, { email, roles: ["LECTEUR"] }, superadmin);
    const invB = await inviter(app, b.cible, { email, nom: "X", roles: ["LECTEUR"] }, superadmin);
    await accepterAvecCompte(app, invB.jeton, { id, email });

    await reinitialiserMotDePasse(app, id, "provisoire-par-superadmin-1", superadmin);
    for (const org of [a, b]) {
      const ligne = (await lireJournalOrganisation(app, org.cible, { page: 1 })).lignes.find((l) => l.action === "MOT_DE_PASSE_REINITIALISE");
      expect(ligne?.cibleId).toBe(id);
      expect(ligne?.acteurEmail).toBe(superadmin.email);
      expect(ligne?.details).toMatchObject({ email, parSuperadmin: true });
    }
    expect((await actionsJournal(c)).includes("MOT_DE_PASSE_REINITIALISE")).toBe(false);
    const compte = await enTransaction(app, (cl) => cl.query<{ doit_changer_mdp: boolean }>("SELECT doit_changer_mdp FROM platform.utilisateurs WHERE id = $1", [id]));
    expect(compte.rows[0]!.doit_changer_mdp).toBe(true);
  });
});
