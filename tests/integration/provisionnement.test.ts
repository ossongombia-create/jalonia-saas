// Création d'organisation : tout ou rien, et isolation mise en place correctement.
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { appliquerMigrationsOrganisation, lireMigrations, migrer, synchroniserGabarits } from "../../src/server/migrations/lanceur";
import { creerOrganisation } from "../../src/server/organisations/provisionnement";
import { changerModeValidation, changerStatutOrganisation, listerOrganisations, lireOrganisation } from "../../src/server/organisations/service";
import { enTransaction } from "../../src/server/db/transactions";
import type { Acteur } from "../../src/server/acteur";
import { cleErreur, codeErreur, creerOrgDeTest, creerSuperadmin, ouvrirPools, suffixe } from "./outils";
import { avecOrganisation } from "../../src/server/db/transactions";

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

interface Comptes {
  schemas: number;
  roles: number;
  organisations: number;
  invitations: number;
}

async function compter(): Promise<Comptes> {
  return enTransaction(proprietaire, async (c) => {
    const r = await c.query<Comptes>(
      `SELECT (SELECT count(*)::int FROM pg_namespace WHERE nspname ~ '^org_[0-9a-f]{12}$') AS schemas,
              (SELECT count(*)::int FROM pg_roles WHERE rolname ~ '^org_[0-9a-f]{12}_rw$') AS roles,
              (SELECT count(*)::int FROM platform.organisations) AS organisations,
              (SELECT count(*)::int FROM platform.invitations) AS invitations`,
    );
    return r.rows[0]!;
  });
}

describe("création d'une organisation", () => {
  it("crée la ligne, le schéma, le rôle dédié, l'invitation de l'administrateur et les journaux", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);

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
    // L'administrateur a accepté l'invitation en créant son compte : il a choisi son mot de passe.
    expect(verif.admin).toEqual([{ roles: ["ADMIN_ORGANISATION"], doit_changer_mdp: false }]);
    expect(verif.journal).toEqual(["ORGANISATION_CREEE", "INVITATION_CREEE", "MEMBRE_AJOUTE"]);
  });

  it("identifiant court déjà pris : refus clair et RIEN n'est créé", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const slug = (await listerOrganisations(app)).find((o) => o.id === org.organisationId)!.slug;
    const avant = await compter();
    const cle = await cleErreur(
      creerOrganisation(app, { nom: "Doublon", slug, admin: { email: `x-${suffixe()}@test.local`, nom: "X" } }, superadmin),
    );
    expect(cle).toBe("erreur.slug_pris");
    expect(await compter()).toEqual(avant);
  });

  it("échec en cours de route (invitation refusée par la base) : RIEN n'est créé, ni schéma, ni rôle, ni invitation", async () => {
    const avant = await compter();
    // Adresse invalide pour la base (la validation des formulaires l'aurait refusée plus tôt) : l'invitation, créée
    // en dernier, échoue ; tout ce qui précède est annulé.
    const code = await codeErreur(creerOrganisation(app, { nom: "Incomplète", slug: `inc-${suffixe()}`, admin: { email: "PAS-UNE-ADRESSE", nom: "N" } }, superadmin));
    expect(code).toBe("23514");
    expect(await compter()).toEqual(avant);
  });
});

describe("création sans le rôle propriétaire (fonction platform.provisionner_organisation)", () => {
  it("l'application ne voit ni ne modifie les gabarits ; elle ne crée rien en dehors de la fonction", async () => {
    expect(await codeErreur(enTransaction(app, (c) => c.query("SELECT * FROM platform.gabarits_organisation")))).toBe("42501");
    expect(await codeErreur(enTransaction(app, (c) => c.query("UPDATE platform.gabarits_organisation SET sql = 'DROP SCHEMA platform CASCADE'")))).toBe("42501");
    expect(await codeErreur(enTransaction(app, (c) => c.query("INSERT INTO platform.organisations (nom, slug, schema_name, role_name) VALUES ('X', 'x-pirate', 'org_aaaaaaaaaaaa', 'org_aaaaaaaaaaaa_rw')")))).toBe("42501");
    expect(await codeErreur(enTransaction(app, (c) => c.query("CREATE ROLE pirate")))).toBe("42501");
  });

  it("noms de schéma piégés refusés AVANT tout SQL dynamique ; rien n'est créé", async () => {
    const avant = await compter();
    for (const schema of ['org_aaaaaaaaaaaa"; DROP SCHEMA platform CASCADE; --', "org_AAAAAAAAAAAA", "org_aaaa", "platform", "org_aaaaaaaaaaaa_rw", "", "public"]) {
      const code = await codeErreur(enTransaction(app, (c) => c.query("SELECT platform.provisionner_organisation($1, $2, $3, NULL)", ["Piège", `piege-${suffixe()}`, schema])));
      expect(code, schema).toBe("22023");
    }
    expect(await codeErreur(enTransaction(app, (c) => c.query("SELECT platform.provisionner_organisation($1, $2, NULL, NULL)", ["Piège", `piege-${suffixe()}`])))).toBe("22023");
    // Nom et identifiant court sont des valeurs : un nom « SQL » est rangé tel quel, l'identifiant court est contrôlé.
    expect(await codeErreur(enTransaction(app, (c) => c.query("SELECT platform.provisionner_organisation($1, $2, $3, NULL)", ["X", "Pas Valide; DROP", "org_bbbbbbbbbbbb"])))).toBe("23514");
    expect(await compter()).toEqual(avant);
  });

  it("le rôle d'une organisation ne peut pas appeler la fonction", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const code = await codeErreur(avecOrganisation(app, org.cible, (c) => c.query("SELECT platform.provisionner_organisation('X', $1, 'org_cccccccccccc', NULL)", [`x-${suffixe()}`])));
    expect(code).toBe("42501");
  });

  it("les gabarits en base sont exactement les fichiers ; un gabarit modifié ou supprimé arrête les migrations", async () => {
    const fichiers = await lireMigrations(path.resolve("db/migrations/organisation"));
    const ranges = await enTransaction(proprietaire, (c) => c.query<{ nom: string; sql: string }>("SELECT nom, sql FROM platform.gabarits_organisation ORDER BY nom"));
    expect(ranges.rows).toEqual(fichiers.map((m) => ({ nom: m.nom, sql: m.sql })));
    const modifie = fichiers.map((m, i) => (i === 0 ? { ...m, sql: m.sql + "\n-- retouche" } : m));
    await expect(enTransaction(proprietaire, (c) => synchroniserGabarits(c, modifie))).rejects.toThrow(/modifié après application/);
    await expect(enTransaction(proprietaire, (c) => synchroniserGabarits(c, fichiers.slice(1)))).rejects.toThrow(/absent des fichiers/);
    expect(await enTransaction(proprietaire, (c) => synchroniserGabarits(c, fichiers))).toEqual([]);
  });

  it("une organisation créée reçoit tous les gabarits, notés comme appliqués", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const notees = await enTransaction(proprietaire, (c) => c.query<{ nom: string }>("SELECT nom FROM platform.migrations_organisation WHERE schema_name = $1 ORDER BY nom", [org.schemaName]));
    const fichiers = await lireMigrations(path.resolve("db/migrations/organisation"));
    expect(notees.rows.map((r) => r.nom)).toEqual(fichiers.map((m) => m.nom));
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

describe("mode de validation (décision n° 2 du 19/10/2026)", () => {
  it("standard par défaut ; changement tracé dans les deux journaux avec l'ancien et le nouveau mode ; sans effet s'il ne change rien", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    expect((await lireOrganisation(app, org.organisationId))?.modeValidation).toBe("standard");
    await changerModeValidation(app, org.organisationId, "petite_organisation", superadmin);
    await changerModeValidation(app, org.organisationId, "petite_organisation", superadmin); // sans effet
    expect((await lireOrganisation(app, org.organisationId))?.modeValidation).toBe("petite_organisation");
    await changerModeValidation(app, org.organisationId, "standard", superadmin);
    const lignes = await enTransaction(proprietaire, async (c) => ({
      plateforme: (await c.query<{ acteur_email: string; details: unknown }>("SELECT acteur_email, details FROM platform.journal WHERE organisation_id = $1 AND action = 'MODE_VALIDATION_MODIFIE' ORDER BY id", [org.organisationId])).rows,
      organisation: (await c.query<{ details: unknown }>(`SELECT details FROM "${org.schemaName}".journal WHERE action = 'MODE_VALIDATION_MODIFIE' ORDER BY id`)).rows,
    }));
    const attendus = [{ avant: "standard", apres: "petite_organisation" }, { avant: "petite_organisation", apres: "standard" }];
    expect(lignes.plateforme.map((l) => l.details)).toEqual(attendus);
    expect(lignes.plateforme.every((l) => l.acteur_email === superadmin.email)).toBe(true);
    expect(lignes.organisation.map((l) => l.details)).toEqual(attendus);
  });

  it("mode inconnu ou organisation inconnue : refus ; la base n'accepte que les deux modes", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    expect(await cleErreur(changerModeValidation(app, org.organisationId, "libre" as never, superadmin))).toBe("erreur.saisie_invalide");
    expect(await cleErreur(changerModeValidation(app, "00000000-0000-4000-8000-000000000000", "standard", superadmin))).toBe("erreur.introuvable");
    expect(await codeErreur(enTransaction(app, (c) => c.query("UPDATE platform.organisations SET mode_validation = 'libre' WHERE id = $1", [org.organisationId])))).toBe("23514");
  });
});
