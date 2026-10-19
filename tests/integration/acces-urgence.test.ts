// Accès de l'exploitant (décision n° 1 du 19/10/2026, audit S9) : un compte superadmin n'est jamais membre d'une
// organisation (ni invitation, ni acceptation : la base le refuse aussi) ; il n'y entre que par un accès d'urgence
// motivé, limité dans le temps (1, 4, 8 ou 24 h), notifié aux administrateurs et tracé dans les deux journaux.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { accepterAvecCompte, inviter } from "../../src/server/invitations/service";
import { changerStatutOrganisation } from "../../src/server/organisations/service";
import { fermerAccesUrgence, lireAccesActifs, listerAccesUrgence, ouvrirAccesUrgence, type DemandeAccesUrgence } from "../../src/server/acces-urgence/service";
import { listerNotifications } from "../../src/server/notifications/service";
import { lireJournalOrganisation } from "../../src/server/consultation/service";
import { enTransaction } from "../../src/server/db/transactions";
import type { Acteur } from "../../src/server/acteur";
import { cleErreur, codeErreur, creerOrgDeTest, creerSuperadmin, membreDeTest, ouvrirPools, suffixe, type OrgDeTest } from "./outils";

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

const DEMANDE: DemandeAccesUrgence = { role: "ADMIN_ORGANISATION", dureeHeures: 4, motif: "Dépannage demandé par le client (ticket 42)" };
const adminDe = (org: OrgDeTest): Acteur => ({ id: org.adminId, email: org.adminEmail, ip: "127.0.0.1", agent: "vitest" });
const actifs = (id: string) => enTransaction(app, (c) => lireAccesActifs(c, id));
const actionsJournalPlateforme = async (organisationId: string) =>
  (await enTransaction(app, (c) => c.query<{ action: string }>("SELECT action FROM platform.journal WHERE organisation_id = $1 ORDER BY id", [organisationId]))).rows.map((l) => l.action);

describe("un compte superadmin n'est jamais membre d'une organisation", () => {
  it("il ne peut pas s'inviter lui-même", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    expect(await cleErreur(inviter(app, org.cible, { email: superadmin.email, nom: "Moi", roles: ["ADMIN_ORGANISATION"] }, superadmin))).toBe("invitation.soi_meme");
  });

  it("il ne peut pas accepter une invitation adressée à son compte, même faite par l'administrateur", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const inv = await inviter(app, org.cible, { email: superadmin.email, nom: "Exploitant", roles: ["LECTEUR"] }, adminDe(org));
    expect(await cleErreur(accepterAvecCompte(app, inv.jeton, superadmin))).toBe("invitation.superadmin");
    const n = await enTransaction(app, (c) => c.query("SELECT 1 FROM platform.adhesions WHERE utilisateur_id = $1", [superadmin.id]));
    expect(n.rowCount).toBe(0);
  });

  it("la base refuse elle-même une adhésion de superadmin (déclencheur)", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    expect(await codeErreur(enTransaction(app, (c) =>
      c.query("INSERT INTO platform.adhesions (utilisateur_id, organisation_id, roles) VALUES ($1, $2, '{LECTEUR}')", [superadmin.id, org.organisationId]),
    ))).toBe("23514");
  });

  it("personne ne s'invite soi-même (administrateur compris)", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    expect(await cleErreur(inviter(app, org.cible, { email: org.adminEmail, nom: "Moi", roles: ["LECTEUR"] }, adminDe(org)))).toBe("invitation.soi_meme");
  });
});

describe("ouverture d'un accès d'urgence", () => {
  it("refusée sans motif suffisant, avec une durée ou un rôle hors liste, ou sur une organisation suspendue", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    expect(await cleErreur(ouvrirAccesUrgence(app, org.organisationId, { ...DEMANDE, motif: "  court  " }, superadmin))).toBe("acces.motif_requis");
    expect(await cleErreur(ouvrirAccesUrgence(app, org.organisationId, { ...DEMANDE, dureeHeures: 48 as never }, superadmin))).toBe("acces.duree_invalide");
    expect(await cleErreur(ouvrirAccesUrgence(app, org.organisationId, { ...DEMANDE, role: "APPROBATEUR" as never }, superadmin))).toBe("erreur.role_invalide");
    await changerStatutOrganisation(app, org.organisationId, "suspendue", superadmin);
    expect(await cleErreur(ouvrirAccesUrgence(app, org.organisationId, DEMANDE, superadmin))).toBe("acces.organisation_suspendue");
    expect(await actifs(superadmin.id)).toEqual([]);
  });

  it("réservée à un compte superadmin (la base le vérifie aussi)", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    expect(await codeErreur(ouvrirAccesUrgence(app, org.organisationId, DEMANDE, adminDe(org)))).toBe("23514");
  });

  it("valable : notifié à CHAQUE administrateur actif, tracé dans les deux journaux, une seule ouverture à la fois", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const admin2 = await membreDeTest(app, org.cible, { email: `admin2-${suffixe()}@test.local`, roles: ["ADMIN_ORGANISATION"] }, adminDe(org));
    const lecteur = await membreDeTest(app, org.cible, { email: `lect-${suffixe()}@test.local`, roles: ["LECTEUR"] }, adminDe(org));
    const ouvert = await ouvrirAccesUrgence(app, org.organisationId, DEMANDE, superadmin);
    expect(ouvert.notifies).toBe(2);
    expect(ouvert.expireLe.getTime() - Date.now()).toBeGreaterThan(3.9 * 3600_000);
    expect(ouvert.expireLe.getTime() - Date.now()).toBeLessThanOrEqual(4 * 3600_000 + 5000);

    for (const destinataire of [org.adminId, admin2]) {
      const n = (await listerNotifications(app, org.cible, destinataire)).find((x) => x.nature === "acces_urgence");
      expect(n?.details).toMatchObject({ motif: DEMANDE.motif, heures: 4 });
    }
    expect((await listerNotifications(app, org.cible, lecteur)).some((x) => x.nature === "acces_urgence")).toBe(false);

    const ligne = (await lireJournalOrganisation(app, org.cible, { page: 1 })).lignes.find((l) => l.action === "ACCES_URGENCE_OUVERT");
    expect(ligne?.acteurEmail).toBe(superadmin.email);
    expect(ligne?.details).toMatchObject({ role: "ADMIN_ORGANISATION", dureeHeures: 4, motif: DEMANDE.motif });
    expect(await actionsJournalPlateforme(org.organisationId)).toContain("ACCES_URGENCE_OUVERT");

    expect(await actifs(superadmin.id)).toEqual([expect.objectContaining({ organisationId: org.organisationId, role: "ADMIN_ORGANISATION" })]);
    expect(await cleErreur(ouvrirAccesUrgence(app, org.organisationId, DEMANDE, superadmin))).toBe("acces.deja_ouvert");
  });
});

describe("fin d'un accès d'urgence", () => {
  it("fermé avant l'échéance : il ne vaut plus rien, la fermeture est tracée ; une seconde fermeture est refusée", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const ouvert = await ouvrirAccesUrgence(app, org.organisationId, { ...DEMANDE, role: "LECTEUR", dureeHeures: 1 }, superadmin);
    await fermerAccesUrgence(app, ouvert.id, superadmin);
    expect((await actifs(superadmin.id)).some((a) => a.organisationId === org.organisationId)).toBe(false);
    expect(await cleErreur(fermerAccesUrgence(app, ouvert.id, superadmin))).toBe("acces.deja_ferme");
    expect((await lireJournalOrganisation(app, org.cible, { page: 1 })).lignes.some((l) => l.action === "ACCES_URGENCE_FERME")).toBe(true);
    expect((await listerAccesUrgence(app, org.organisationId))[0]?.etat).toBe("ferme");
  });

  it("échu : il ne vaut plus rien sans aucune action ; un nouvel accès peut alors être ouvert", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const ouvert = await ouvrirAccesUrgence(app, org.organisationId, { ...DEMANDE, dureeHeures: 1 }, superadmin);
    // Simule le temps écoulé (rôle propriétaire : l'application ne peut pas modifier ces dates).
    await enTransaction(proprietaire, (c) =>
      c.query("UPDATE platform.acces_urgence SET ouvert_le = now() - interval '2 hours', expire_le = now() - interval '1 hour' WHERE id = $1", [ouvert.id]),
    );
    expect((await actifs(superadmin.id)).some((a) => a.organisationId === org.organisationId)).toBe(false);
    expect((await listerAccesUrgence(app, org.organisationId))[0]?.etat).toBe("echu");
    expect(await cleErreur(fermerAccesUrgence(app, ouvert.id, superadmin))).toBe("acces.deja_ferme");
    await ouvrirAccesUrgence(app, org.organisationId, { ...DEMANDE, dureeHeures: 8 }, superadmin);
    const liste = await listerAccesUrgence(app, org.organisationId);
    expect(liste.map((a) => a.etat)).toEqual(["actif", "echu"]);
  });

  it("la base refuse une durée de plus de 24 heures et toute modification hors fermeture", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    expect(await codeErreur(enTransaction(app, (c) =>
      c.query(
        `INSERT INTO platform.acces_urgence (organisation_id, superadmin_id, role, motif, duree_heures, expire_le)
         VALUES ($1, $2, 'LECTEUR', 'motif suffisamment long', 24, now() + interval '25 hours')`,
        [org.organisationId, superadmin.id],
      ),
    ))).toBe("23514");
    const ouvert = await ouvrirAccesUrgence(app, org.organisationId, DEMANDE, superadmin);
    expect(await codeErreur(enTransaction(app, (c) => c.query("UPDATE platform.acces_urgence SET expire_le = now() + interval '20 hours' WHERE id = $1", [ouvert.id])))).toBe("42501");
    expect(await codeErreur(enTransaction(app, (c) => c.query("DELETE FROM platform.acces_urgence WHERE id = $1", [ouvert.id])))).toBe("42501");
  });
});
