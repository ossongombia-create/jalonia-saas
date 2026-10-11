// ÉTANCHÉITÉ entre organisations et droits PostgreSQL : ces tests prouvent que la base elle-même
// refuse les accès interdits, indépendamment du code de l'application.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { avecOrganisation, dansOrganisation, enTransaction } from "../../src/server/db/transactions";
import { codeErreur, creerOrgDeTest, creerSuperadmin, ouvrirPools, type OrgDeTest } from "./outils";

const DROITS_INSUFFISANTS = "42501";
const TABLE_INCONNUE = "42P01";

let app: Pool;
let proprietaire: Pool;
let a: OrgDeTest;
let b: OrgDeTest;

beforeAll(async () => {
  ({ app, proprietaire } = ouvrirPools());
  const superadmin = await creerSuperadmin(proprietaire);
  a = await creerOrgDeTest(app, proprietaire, superadmin, "Alpha");
  b = await creerOrgDeTest(app, proprietaire, superadmin, "Bravo");
});

afterAll(async () => {
  await app.end();
  await proprietaire.end();
});

describe("isolation entre organisations", () => {
  it("une organisation lit son propre journal", async () => {
    const n = await avecOrganisation(app, a.cible, async (c) => (await c.query<{ n: number }>("SELECT count(*)::int AS n FROM journal")).rows[0]!.n);
    expect(n).toBeGreaterThanOrEqual(2); // ORGANISATION_CREEE + MEMBRE_AJOUTE
  });

  it("une organisation ne peut PAS lire le schéma d'une autre (refus de PostgreSQL)", async () => {
    const code = await codeErreur(avecOrganisation(app, a.cible, (c) => c.query(`SELECT * FROM "${b.schemaName}".journal`)));
    expect(code).toBe(DROITS_INSUFFISANTS);
  });

  it("une organisation ne peut PAS écrire dans le schéma d'une autre", async () => {
    const code = await codeErreur(avecOrganisation(app, a.cible, (c) => c.query(`INSERT INTO "${b.schemaName}".journal (action) VALUES ('CONNEXION')`)));
    expect(code).toBe(DROITS_INSUFFISANTS);
  });

  it("une organisation ne peut PAS lire les tables de la plateforme", async () => {
    const code = await codeErreur(avecOrganisation(app, a.cible, (c) => c.query("SELECT * FROM platform.utilisateurs")));
    expect(code).toBe(DROITS_INSUFFISANTS);
  });

  it("une organisation ne peut pas créer de table, même dans son schéma", async () => {
    const code = await codeErreur(avecOrganisation(app, a.cible, (c) => c.query(`CREATE TABLE "${a.schemaName}".intrus (x int)`)));
    expect(code).toBe(DROITS_INSUFFISANTS);
  });

  it("sans bascule explicite, l'application n'a AUCUN accès aux données d'une organisation (INHERIT FALSE)", async () => {
    const code = await codeErreur(enTransaction(app, (c) => c.query(`SELECT * FROM "${a.schemaName}".journal`)));
    expect(code).toBe(DROITS_INSUFFISANTS);
  });

  it("hors organisation, un nom de table non qualifié ne correspond à rien (chemin de recherche vide)", async () => {
    const code = await codeErreur(enTransaction(app, (c) => c.query("SELECT * FROM journal")));
    expect(code).toBe(TABLE_INCONNUE);
  });

  it("après la bascule, on revient au rôle de l'application dans la même transaction", async () => {
    const roles = await enTransaction(app, async (c) => {
      const pendant = await dansOrganisation(c, a.cible, async () => (await c.query<{ r: string }>("SELECT current_user AS r")).rows[0]!.r);
      const apres = (await c.query<{ r: string }>("SELECT current_user AS r")).rows[0]!.r;
      return { pendant, apres };
    });
    expect(roles).toEqual({ pendant: a.cible.roleName, apres: "jalonia_app" });
  });

  it("une erreur dans l'organisation annule la bascule (la connexion suivante est propre)", async () => {
    await codeErreur(avecOrganisation(app, a.cible, (c) => c.query("SELECT * FROM table_inexistante")));
    const r = await enTransaction(app, async (c) => (await c.query<{ r: string; p: string }>("SELECT current_user AS r, current_setting('search_path') AS p")).rows[0]!);
    expect(r.r).toBe("jalonia_app");
    expect(r.p).toBe("");
  });

  it("des identifiants d'organisation mal formés sont refusés avant toute requête", async () => {
    await expect(avecOrganisation(app, { schemaName: "platform", roleName: "platform_rw" }, async () => 1)).rejects.toThrow();
    await expect(avecOrganisation(app, { schemaName: a.schemaName, roleName: b.cible.roleName }, async () => 1)).rejects.toThrow();
  });
});

describe("droits du rôle de l'application", () => {
  it("ne peut pas se donner le rôle superadmin", async () => {
    const code = await codeErreur(enTransaction(app, (c) => c.query("UPDATE platform.utilisateurs SET est_superadmin = true")));
    expect(code).toBe(DROITS_INSUFFISANTS);
  });

  it("ne peut pas créer un compte superadmin", async () => {
    const code = await codeErreur(
      enTransaction(app, (c) =>
        c.query("INSERT INTO platform.utilisateurs (email, nom, mot_de_passe_hash, est_superadmin) VALUES ('x@test.local', 'X', '$argon2id$x', true)"),
      ),
    );
    expect(code).toBe(DROITS_INSUFFISANTS);
  });

  it("ne peut pas créer d'organisation ni de schéma (réservé au propriétaire)", async () => {
    expect(
      await codeErreur(
        enTransaction(app, (c) => c.query("INSERT INTO platform.organisations (nom, slug, schema_name, role_name) VALUES ('X', 'x', 'org_000000000000', 'org_000000000000_rw')")),
      ),
    ).toBe(DROITS_INSUFFISANTS);
    expect(await codeErreur(enTransaction(app, (c) => c.query("CREATE SCHEMA intrus")))).toBe(DROITS_INSUFFISANTS);
  });

  it("ne peut pas prendre le rôle propriétaire", async () => {
    expect(await codeErreur(enTransaction(app, (c) => c.query("SET LOCAL ROLE jalonia_owner")))).toBe(DROITS_INSUFFISANTS);
  });

  it("ne peut ni modifier ni effacer le journal de la plateforme", async () => {
    expect(await codeErreur(enTransaction(app, (c) => c.query("UPDATE platform.journal SET action = 'CONNEXION'")))).toBe(DROITS_INSUFFISANTS);
    expect(await codeErreur(enTransaction(app, (c) => c.query("DELETE FROM platform.journal")))).toBe(DROITS_INSUFFISANTS);
  });
});

describe("journaux en ajout seul (même pour le propriétaire)", () => {
  it("journal de la plateforme : ni modification, ni suppression, ni vidage", async () => {
    expect(await codeErreur(enTransaction(proprietaire, (c) => c.query("UPDATE platform.journal SET action = 'CONNEXION'")))).toBe(DROITS_INSUFFISANTS);
    expect(await codeErreur(enTransaction(proprietaire, (c) => c.query("DELETE FROM platform.journal")))).toBe(DROITS_INSUFFISANTS);
    expect(await codeErreur(enTransaction(proprietaire, (c) => c.query("TRUNCATE platform.journal")))).toBe(DROITS_INSUFFISANTS);
  });

  it("journal d'une organisation : ni modification, ni suppression, ni vidage", async () => {
    const t = `"${a.schemaName}".journal`;
    expect(await codeErreur(enTransaction(proprietaire, (c) => c.query(`UPDATE ${t} SET action = 'CONNEXION'`)))).toBe(DROITS_INSUFFISANTS);
    expect(await codeErreur(enTransaction(proprietaire, (c) => c.query(`DELETE FROM ${t}`)))).toBe(DROITS_INSUFFISANTS);
    expect(await codeErreur(enTransaction(proprietaire, (c) => c.query(`TRUNCATE ${t}`)))).toBe(DROITS_INSUFFISANTS);
  });
});
