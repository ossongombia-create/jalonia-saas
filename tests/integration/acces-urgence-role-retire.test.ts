// Accès d'urgence ouvert AVANT le chantier 1 (20/10/2026) avec le rôle Administrateur, désormais retiré : il reste
// lisible (lireAccesActifs, listerAccesUrgence : une seule lecture, non filtrée — le contexte l'écarte) et fermable ;
// toute tentative d'y entrer est refusée et tracée (ACCES_URGENCE_REFUSE, deux journaux). La base accepte encore ce
// rôle (pas de migration : R2 = A), d'où l'insertion par le rôle propriétaire pour simuler l'accès ancien.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import {
  estRoleAccesUrgence,
  fermerAccesUrgence,
  lireAccesActifs,
  listerAccesUrgence,
  ouvrirAccesUrgence,
  refuserEntreeRoleRetire,
} from "../../src/server/acces-urgence/service";
import { lireJournalOrganisation } from "../../src/server/consultation/service";
import { enTransaction } from "../../src/server/db/transactions";
import type { Acteur } from "../../src/server/acteur";
import { cleErreur, creerOrgDeTest, creerSuperadmin, ouvrirPools, type OrgDeTest } from "./outils";

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

/** Un accès « Administrateur » encore ouvert, comme avant le chantier 1. */
async function accesAdminAncien(org: OrgDeTest): Promise<string> {
  const r = await enTransaction(proprietaire, (c) => c.query<{ id: string }>(
    `INSERT INTO platform.acces_urgence (organisation_id, superadmin_id, role, motif, duree_heures, expire_le)
     VALUES ($1, $2, 'ADMIN_ORGANISATION', 'Accès ouvert avant le chantier 1', 4, now() + interval '4 hours') RETURNING id`,
    [org.organisationId, superadmin.id]));
  return r.rows[0]!.id;
}
const refus = async (org: OrgDeTest) =>
  (await lireJournalOrganisation(app, org.cible, { page: 1 })).lignes.filter((l) => l.action === "ACCES_URGENCE_REFUSE");
const refusPlateforme = async (org: OrgDeTest) =>
  Number((await enTransaction(proprietaire, (c) => c.query<{ n: string }>(
    "SELECT count(*) AS n FROM platform.journal WHERE organisation_id = $1 AND action = 'ACCES_URGENCE_REFUSE'", [org.organisationId]))).rows[0]!.n);

describe("rôles permis", () => {
  it("Rédacteur et Lecteur seulement", () => {
    expect(["REDACTEUR", "LECTEUR", "ADMIN_ORGANISATION", "APPROBATEUR"].map(estRoleAccesUrgence)).toEqual([true, true, false, false]);
  });
});

describe("accès « Administrateur » encore ouvert", () => {
  it("toujours lu et listé (une seule lecture, non filtrée) ; son rôle n'est plus permis", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const id = await accesAdminAncien(org);
    const actifs = await enTransaction(app, (c) => lireAccesActifs(c, superadmin.id));
    const a = actifs.find((x) => x.organisationId === org.organisationId);
    expect(a?.role).toBe("ADMIN_ORGANISATION");
    expect(estRoleAccesUrgence(a!.role)).toBe(false);
    expect((await listerAccesUrgence(app, org.organisationId)).find((l) => l.id === id)?.etat).toBe("actif");
  });

  it("tentative d'entrée : refusée et tracée dans les deux journaux, à chaque tentative", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const id = await accesAdminAncien(org);
    expect(await refuserEntreeRoleRetire(app, org.organisationId, superadmin)).toBe(true);
    const lignes = await refus(org);
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({ acteurEmail: superadmin.email, cibleId: id, details: { role: "ADMIN_ORGANISATION", raison: "role_retire" } });
    expect(await refusPlateforme(org)).toBe(1);
    await refuserEntreeRoleRetire(app, org.organisationId, superadmin);
    expect(await refusPlateforme(org)).toBe(2);
  });

  it("bloque l'ouverture d'un nouvel accès tant qu'il n'est pas fermé ; fermé, un accès Lecteur s'ouvre et l'entrée n'est plus refusée", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const id = await accesAdminAncien(org);
    const demande = { role: "LECTEUR" as const, dureeHeures: 1 as const, motif: "Assistance demandée par le client" };
    expect(await cleErreur(ouvrirAccesUrgence(app, org.organisationId, demande, superadmin))).toBe("acces.deja_ouvert");
    await fermerAccesUrgence(app, id, superadmin);
    await ouvrirAccesUrgence(app, org.organisationId, demande, superadmin);
    expect(await refuserEntreeRoleRetire(app, org.organisationId, superadmin)).toBe(false);
    expect(await refusPlateforme(org)).toBe(0);
  });

  it("sans accès au rôle retiré (accès Lecteur, ou aucun) : rien n'est refusé ni écrit", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    expect(await refuserEntreeRoleRetire(app, org.organisationId, superadmin)).toBe(false);
    await ouvrirAccesUrgence(app, org.organisationId, { role: "LECTEUR", dureeHeures: 1, motif: "Assistance demandée par le client" }, superadmin);
    expect(await refuserEntreeRoleRetire(app, org.organisationId, superadmin)).toBe(false);
    expect(await refus(org)).toHaveLength(0);
  });
});
