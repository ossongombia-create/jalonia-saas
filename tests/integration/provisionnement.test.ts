// Création d'organisation : tout ou rien, et isolation mise en place correctement.
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { appliquerMigrationsOrganisation, lireMigrations, migrer } from "../../src/server/migrations/lanceur";
import { creerOrganisation } from "../../src/server/organisations/provisionnement";
import { changerStatutOrganisation, listerOrganisations } from "../../src/server/organisations/service";
import { enTransaction } from "../../src/server/db/transactions";
import type { Acteur } from "../../src/server/acteur";
import { cleErreur, creerOrgDeTest, creerSuperadmin, MDP_TEST, ouvrirPools, suffixe } from "./outils";

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

async function compter(): Promise<{ schemas: number; roles: number; organisations: number }> {
  return enTransaction(proprietaire, async (c) => {
    const r = await c.query<{ schemas: number; roles: number; organisations: number }>(
      `SELECT (SELECT count(*)::int FROM pg_namespace WHERE nspname ~ '^org_[0-9a-f]{12}$') AS schemas,
              (SELECT count(*)::int FROM pg_roles WHERE rolname ~ '^org_[0-9a-f]{12}_rw$') AS roles,
              (SELECT count(*)::int FROM platform.organisations) AS organisations`,
    );
    return r.rows[0]!;
  });
}

describe("création d'une organisation", () => {
  it("crée la ligne, le schéma, le rôle dédié, l'administrateur et les journaux", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    expect(org.compteAdminCree).toBe(true);

    const verif = await enTransaction(proprietaire, async (c) => {
      const schema = await c.query("SELECT 1 FROM pg_namespace WHERE nspname = $1", [org.schemaName]);
      // L'application est membre du rôle de l'organisation SANS héritage, avec le droit de SET ROLE.
      const adhesion = await c.query<{ inherit_option: boolean; set_option: boolean; admin_option: boolean }>(
        `SELECT m.inherit_option, m.set_option, m.admin_option
           FROM pg_auth_members m
           JOIN pg_roles r ON r.oid = m.roleid
           JOIN pg_roles u ON u.oid = m.member
          WHERE r.rolname = $1 AND u.rolname = 'jalonia_app'`,
        [org.cible.roleName],
      );
      const role = await c.query<{ rolcanlogin: boolean }>("SELECT rolcanlogin FROM pg_roles WHERE rolname = $1", [org.cible.roleName]);
      const admin = await c.query<{ roles: string[]; doit_changer_mdp: boolean }>(
        `SELECT a.roles, u.doit_changer_mdp FROM platform.adhesions a JOIN platform.utilisateurs u ON u.id = a.utilisateur_id
          WHERE a.organisation_id = $1`,
        [org.organisationId],
      );
      const journal = await c.query<{ action: string }>(`SELECT action FROM "${org.schemaName}".journal ORDER BY id`);
      return { schema: schema.rowCount, adhesion: adhesion.rows[0], role: role.rows[0], admin: admin.rows, journal: journal.rows.map((r) => r.action) };
    });
    expect(verif.schema).toBe(1);
    expect(verif.adhesion).toEqual({ inherit_option: false, set_option: true, admin_option: false });
    expect(verif.role).toEqual({ rolcanlogin: false });
    expect(verif.admin).toEqual([{ roles: ["ADMIN_ORGANISATION"], doit_changer_mdp: true }]);
    expect(verif.journal).toEqual(["ORGANISATION_CREEE", "MEMBRE_AJOUTE"]);
  });

  it("identifiant court déjà pris : refus clair et RIEN n'est créé", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const slug = (await listerOrganisations(app)).find((o) => o.id === org.organisationId)!.slug;
    const avant = await compter();
    const migrations = await lireMigrations(path.resolve("db/migrations/organisation"));
    const cle = await cleErreur(
      creerOrganisation(proprietaire, migrations, { nom: "Doublon", slug, admin: { email: `x-${suffixe()}@test.local`, nom: "X", motDePasseProvisoire: MDP_TEST } }, superadmin),
    );
    expect(cle).toBe("erreur.slug_pris");
    expect(await compter()).toEqual(avant);
  });

  it("échec en cours de route (administrateur sans mot de passe) : RIEN n'est créé, ni schéma ni rôle", async () => {
    const avant = await compter();
    const migrations = await lireMigrations(path.resolve("db/migrations/organisation"));
    const cle = await cleErreur(
      creerOrganisation(proprietaire, migrations, { nom: "Incomplète", slug: `inc-${suffixe()}`, admin: { email: `nouveau-${suffixe()}@test.local`, nom: "N", motDePasseProvisoire: "" } }, superadmin),
    );
    expect(cle).toBe("erreur.mdp_provisoire_requis");
    expect(await compter()).toEqual(avant);
  });

  it("mot de passe provisoire trop court : refusé avant toute écriture", async () => {
    const migrations = await lireMigrations(path.resolve("db/migrations/organisation"));
    const cle = await cleErreur(
      creerOrganisation(proprietaire, migrations, { nom: "Courte", slug: `court-${suffixe()}`, admin: { email: `c-${suffixe()}@test.local`, nom: "C", motDePasseProvisoire: "court" } }, superadmin),
    );
    expect(cle).toBe("erreur.mdp_trop_court");
  });

  it("un compte existant devient administrateur sans que son mot de passe change", async () => {
    const premiere = await creerOrgDeTest(app, proprietaire, superadmin);
    const avant = await enTransaction(proprietaire, (c) => c.query<{ h: string }>("SELECT mot_de_passe_hash AS h FROM platform.utilisateurs WHERE email = $1", [premiere.adminEmail]));
    const migrations = await lireMigrations(path.resolve("db/migrations/organisation"));
    const seconde = await creerOrganisation(
      proprietaire,
      migrations,
      { nom: "Seconde", slug: `sec-${suffixe()}`, admin: { email: premiere.adminEmail, nom: "Ignoré", motDePasseProvisoire: "" } },
      superadmin,
    );
    expect(seconde.compteAdminCree).toBe(false);
    expect(seconde.adminId).toBe(premiere.adminId);
    const apres = await enTransaction(proprietaire, (c) => c.query<{ h: string }>("SELECT mot_de_passe_hash AS h FROM platform.utilisateurs WHERE email = $1", [premiere.adminEmail]));
    expect(apres.rows[0]!.h).toBe(avant.rows[0]!.h);
  });
});

describe("migrations", () => {
  it("relancer les migrations ne refait rien", async () => {
    const rapport = await migrer(proprietaire, path.resolve("."));
    expect(rapport).toEqual({ plateforme: [], organisations: {} });
  });

  it("une nouvelle migration de gabarit s'applique une seule fois à une organisation existante", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const migrations = await lireMigrations(path.resolve("db/migrations/organisation"));
    const supplementaire = { nom: "9999_essai", sql: "CREATE TABLE {{schema}}.essai (x int); GRANT SELECT ON {{schema}}.essai TO {{role}};" };
    const premiere = await enTransaction(proprietaire, (c) => appliquerMigrationsOrganisation(c, org.cible, [...migrations, supplementaire]));
    const seconde = await enTransaction(proprietaire, (c) => appliquerMigrationsOrganisation(c, org.cible, [...migrations, supplementaire]));
    expect(premiere).toEqual(["9999_essai"]);
    expect(seconde).toEqual([]);
  });
});

describe("suspension", () => {
  it("suspendre puis réactiver, avec traces dans les deux journaux", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    await changerStatutOrganisation(app, org.organisationId, "suspendue", superadmin);
    await changerStatutOrganisation(app, org.organisationId, "suspendue", superadmin); // sans effet
    await changerStatutOrganisation(app, org.organisationId, "active", superadmin);
    const actions = await enTransaction(proprietaire, async (c) => ({
      plateforme: (await c.query<{ action: string }>("SELECT action FROM platform.journal WHERE organisation_id = $1 AND action LIKE 'ORGANISATION_%' ORDER BY id", [org.organisationId])).rows.map((r) => r.action),
      organisation: (await c.query<{ action: string }>(`SELECT action FROM "${org.schemaName}".journal WHERE action LIKE 'ORGANISATION_%' ORDER BY id`)).rows.map((r) => r.action),
    }));
    expect(actions.plateforme).toEqual(["ORGANISATION_CREEE", "ORGANISATION_SUSPENDUE", "ORGANISATION_REACTIVEE"]);
    expect(actions.organisation).toEqual(["ORGANISATION_CREEE", "ORGANISATION_SUSPENDUE", "ORGANISATION_REACTIVEE"]);
  });
});
