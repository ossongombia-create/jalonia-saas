// Historique des versions et corbeille (D1) sur une vraie base : aucune version écrasée, restauration exacte, corbeille,
// ajout seul garanti par PostgreSQL, étanchéité entre organisations, mise à niveau d'une organisation existante.
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { creerDocument, enregistrerDocument, lireDocument, listerDocuments, supprimerDocument, type Contenu } from "../../src/server/documents/service";
import { listerCorbeille, listerVersions, lireVersion, restaurerVersion, retablirDocument } from "../../src/server/documents/versions";
import { lireJournalOrganisation } from "../../src/server/consultation/service";
import { appliquerMigrationsOrganisation, lireMigrations } from "../../src/server/migrations/lanceur";
import { creerOrganisation } from "../../src/server/organisations/provisionnement";
import { lireOrganisation } from "../../src/server/organisations/service";
import { avecOrganisation, enTransaction } from "../../src/server/db/transactions";
import type { Acteur } from "../../src/server/acteur";
import { cleErreur, codeErreur, creerOrgDeTest, creerSuperadmin, ouvrirPools, suffixe, type OrgDeTest } from "./outils";

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

const personne = (nom: string): Acteur => ({ id: randomUUID(), email: `${nom.toLowerCase()}-${suffixe()}@test.local`, nom, ip: "127.0.0.1", agent: "vitest" });
const procedure = (titre: string, validation = ""): Contenu => ({ meta: { typeDocument: "procedure", titre, reference: "PR-V-01" }, roles: [], etapes: [{ id: "e1", libelle: titre }], validation });
const versions = async (org: OrgDeTest, id: string) => (await listerVersions(app, org.cible, id))!.versions.map((v) => [v.version, v.motif, v.auteurNom, v.titre]);
/** Fait comme si la dernière copie datait de `minutes` minutes (le rôle propriétaire seul le peut). */
const vieillir = (org: OrgDeTest, id: string, minutes: number) =>
  enTransaction(proprietaire, (c) => c.query(`UPDATE "${org.cible.schemaName}".versions_document SET copie_le = copie_le - ($2::int * interval '1 minute') WHERE document_id = $1`, [id, minutes]));

describe("versions", () => {
  it("création ; enregistrement automatique : une copie par période ; une autre personne : l'état précédent est gardé", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const alice = personne("Alice");
    const bob = personne("Bob");
    const d = await creerDocument(app, org.cible, procedure("A1"), alice);
    expect(await versions(org, d.id)).toEqual([[1, "creation", "Alice", "A1"]]);

    let v = 1;
    for (const titre of ["A2", "A3", "A4"]) v = (await enregistrerDocument(app, org.cible, d.id, { contenu: procedure(titre), version: v }, alice)).version;
    expect(await versions(org, d.id)).toEqual([[1, "creation", "Alice", "A1"]]); // dans la période : pas de copie

    await vieillir(org, d.id, 15);
    v = (await enregistrerDocument(app, org.cible, d.id, { contenu: procedure("A5"), version: v }, alice)).version;
    expect((await versions(org, d.id))[0]).toEqual([5, "enregistrement", "Alice", "A5"]);
    v = (await enregistrerDocument(app, org.cible, d.id, { contenu: procedure("A6"), version: v }, alice)).version;

    // Bob reprend : la version 6 d'Alice est copiée AVANT que Bob n'écrive.
    v = (await enregistrerDocument(app, org.cible, d.id, { contenu: procedure("B7"), version: v }, bob)).version;
    expect(v).toBe(7);
    expect(await versions(org, d.id)).toEqual([[6, "enregistrement", "Alice", "A6"], [5, "enregistrement", "Alice", "A5"], [1, "creation", "Alice", "A1"]]);
    expect((await lireVersion(app, org.cible, d.id, 6))?.contenu).toEqual(procedure("A6"));
  });

  it("conflit tranché (« garder ma version ») : l'état remplacé ET le nouveau sont copiés ; validation copiée", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const alice = personne("Alice");
    const bob = personne("Bob");
    const d = await creerDocument(app, org.cible, procedure("A1"), alice);
    await enregistrerDocument(app, org.cible, d.id, { contenu: procedure("A2"), version: 1 }, alice);
    await enregistrerDocument(app, org.cible, d.id, { contenu: procedure("B3"), version: 1, forcer: true }, bob); // Bob avait ouvert la v1
    await enregistrerDocument(app, org.cible, d.id, { contenu: procedure("B4", "empreinte-validee"), version: 3 }, bob);
    expect(await versions(org, d.id)).toEqual([
      [4, "validation", "Bob", "B4"], [3, "remplacement", "Bob", "B3"], [2, "avant_remplacement", "Alice", "A2"], [1, "creation", "Alice", "A1"],
    ]);
  });

  it("restauration EXACTE : nouvelle version, état remplacé gardé, tracée ; refus si le document a changé ou version inconnue", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const alice = personne("Alice");
    const original: Contenu = { ...procedure("Original"), roles: [{ id: "r1", nom: "Rôle « spécial » & co" }], etapes: [{ id: "e1", libelle: "Ligne 1\nLigne 2", alternatives: [] }] };
    const d = await creerDocument(app, org.cible, original, alice);
    await vieillir(org, d.id, 20);
    await enregistrerDocument(app, org.cible, d.id, { contenu: procedure("Modifié"), version: 1 }, alice);
    expect(await cleErreur(restaurerVersion(app, org.cible, d.id, 1, 1, alice))).toBe("versions.document_modifie");
    expect(await cleErreur(restaurerVersion(app, org.cible, d.id, 99, 2, alice))).toBe("versions.deja_actuelle");
    expect(await cleErreur(restaurerVersion(app, org.cible, d.id, 2, 2, alice))).toBe("versions.deja_actuelle");

    expect(await restaurerVersion(app, org.cible, d.id, 1, 2, alice)).toEqual({ version: 3 });
    const doc = await lireDocument(app, org.cible, d.id);
    expect(doc?.contenu).toEqual(original);
    expect(doc?.titre).toBe("Original");
    expect(await versions(org, d.id)).toEqual([[3, "restauration", "Alice", "Original"], [2, "enregistrement", "Alice", "Modifié"], [1, "creation", "Alice", "Original"]]);
    const trace = (await lireJournalOrganisation(app, org.cible, { page: 1 })).lignes.find((l) => l.action === "DOCUMENT_RESTAURE");
    expect(trace?.details).toMatchObject({ versionRestauree: 1, versionRemplacee: 2, nouvelleVersion: 3 });
  });

  it("une version restaurée alors que la dernière n'était pas copiée : l'état remplacé est copié d'abord", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const alice = personne("Alice");
    const d = await creerDocument(app, org.cible, procedure("V1"), alice);
    await enregistrerDocument(app, org.cible, d.id, { contenu: procedure("V2 non copiée"), version: 1 }, alice);
    await restaurerVersion(app, org.cible, d.id, 1, 2, alice);
    expect(await versions(org, d.id)).toEqual([[3, "restauration", "Alice", "V1"], [2, "avant_remplacement", "Alice", "V2 non copiée"], [1, "creation", "Alice", "V1"]]);
  });
});

describe("corbeille", () => {
  it("supprimer = mettre à la corbeille (état copié) ; plus listé, plus ouvrable, plus enregistrable ; rétabli avec son historique", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const alice = personne("Alice");
    const d = await creerDocument(app, org.cible, procedure("P1"), alice);
    await enregistrerDocument(app, org.cible, d.id, { contenu: procedure("P2"), version: 1 }, alice);
    await supprimerDocument(app, org.cible, d.id, alice);

    expect(await listerDocuments(app, org.cible)).toEqual([]);
    expect(await lireDocument(app, org.cible, d.id)).toBeNull();
    expect(await cleErreur(enregistrerDocument(app, org.cible, d.id, { contenu: procedure("P3"), version: 2 }, alice))).toBe("erreur.introuvable");
    expect(await cleErreur(supprimerDocument(app, org.cible, d.id, alice))).toBe("erreur.introuvable");
    expect(await cleErreur(restaurerVersion(app, org.cible, d.id, 1, 2, alice))).toBe("erreur.introuvable");
    expect((await listerCorbeille(app, org.cible)).map((x) => [x.id, x.titre, x.supprimeParNom])).toEqual([[d.id, "P2", "Alice"]]);
    expect(await versions(org, d.id)).toEqual([[2, "suppression", "Alice", "P2"], [1, "creation", "Alice", "P1"]]);
    expect((await listerVersions(app, org.cible, d.id))?.document.supprimeLe).toBeInstanceOf(Date);

    await retablirDocument(app, org.cible, d.id, alice);
    expect((await listerDocuments(app, org.cible)).map((x) => x.id)).toEqual([d.id]);
    expect((await lireDocument(app, org.cible, d.id))?.contenu).toEqual(procedure("P2"));
    expect(await listerCorbeille(app, org.cible)).toEqual([]);
    expect(await cleErreur(retablirDocument(app, org.cible, d.id, alice))).toBe("erreur.introuvable");
    const actions = (await lireJournalOrganisation(app, org.cible, { page: 1 })).lignes.map((l) => l.action);
    expect(actions.slice(0, 2)).toEqual(["DOCUMENT_RETABLI", "DOCUMENT_SUPPRIME"]);
  });
});

describe("droits PostgreSQL et étanchéité", () => {
  it("le rôle de l'organisation ne peut ni modifier ni effacer une version, ni effacer un document", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const d = await creerDocument(app, org.cible, procedure("X"), personne("A"));
    const refus = (sql: string, valeurs: unknown[] = []) => codeErreur(avecOrganisation(app, org.cible, (c) => c.query(sql, valeurs)));
    expect(await refus("UPDATE versions_document SET titre = 'faux' WHERE document_id = $1", [d.id])).toBe("42501");
    expect(await refus("UPDATE versions_document SET contenu = '{}'::jsonb")).toBe("42501");
    expect(await refus("DELETE FROM versions_document")).toBe("42501");
    expect(await refus("TRUNCATE versions_document")).toBe("42501");
    expect(await refus("DELETE FROM documents WHERE id = $1", [d.id])).toBe("42501");
    expect(await versions(org, d.id)).toEqual([[1, "creation", "A", "X"]]);
  });

  it("versions et corbeille d'une organisation sont invisibles et intouchables depuis une autre", async () => {
    const a = await creerOrgDeTest(app, proprietaire, superadmin);
    const b = await creerOrgDeTest(app, proprietaire, superadmin);
    const alice = personne("Alice");
    const d = await creerDocument(app, a.cible, procedure("Chez A"), alice);
    await enregistrerDocument(app, a.cible, d.id, { contenu: procedure("Chez A v2"), version: 1 }, alice);
    expect(await listerVersions(app, b.cible, d.id)).toBeNull();
    expect(await lireVersion(app, b.cible, d.id, 1)).toBeNull();
    expect(await cleErreur(restaurerVersion(app, b.cible, d.id, 1, 2, alice))).toBe("erreur.introuvable");
    await supprimerDocument(app, a.cible, d.id, alice);
    expect(await listerCorbeille(app, b.cible)).toEqual([]);
    expect(await cleErreur(retablirDocument(app, b.cible, d.id, alice))).toBe("erreur.introuvable");
    expect(await codeErreur(avecOrganisation(app, b.cible, (c) => c.query(`SELECT * FROM "${a.cible.schemaName}".versions_document`)))).toBe("42501");
    expect((await listerCorbeille(app, a.cible)).map((x) => x.id)).toEqual([d.id]);
  });
});

describe("mise à niveau d'une organisation existante", () => {
  it("les documents déjà présents reçoivent leur première version (« reprise ») ; rien n'est perdu", async () => {
    const toutes = await lireMigrations(path.resolve("db/migrations/organisation"));
    const s = suffixe();
    const retires = await enTransaction(proprietaire, (c) =>
      c.query<{ nom: string; sql: string; empreinte: string }>("DELETE FROM platform.gabarits_organisation WHERE nom >= '0004' RETURNING nom, sql, empreinte"),
    );
    let creee;
    try {
      creee = await creerOrganisation(app, { nom: `Avant historique ${s}`, slug: `avant-${s}`, admin: { email: `adm-${s}@test.local`, nom: "Adm" } }, superadmin);
    } finally {
      await enTransaction(proprietaire, async (c) => {
        for (const g of retires.rows) await c.query("INSERT INTO platform.gabarits_organisation (nom, sql, empreinte) VALUES ($1, $2, $3)", [g.nom, g.sql, g.empreinte]);
      });
    }
    const o = await lireOrganisation(app, creee.organisationId);
    const cible = { id: o!.id, schemaName: o!.schemaName, roleName: o!.roleName };
    // Un document créé avant l'historique (directement, comme le faisait l'application avant la migration 0004).
    const id = randomUUID();
    await avecOrganisation(app, cible, (c) => c.query(
      "INSERT INTO documents (id, type, titre, reference, contenu, version, modifie_par_nom) VALUES ($1, 'procedure', 'Ancien', 'PR-A', $2::jsonb, 7, 'Ancienne autrice')",
      [id, JSON.stringify(procedure("Ancien"))],
    ));
    const appliquees = await enTransaction(proprietaire, (c) => appliquerMigrationsOrganisation(c, cible, toutes));
    expect(appliquees).toEqual(retires.rows.map((g) => g.nom).sort());
    const h = await listerVersions(app, cible, id);
    expect(h?.versions.map((v) => [v.version, v.motif, v.auteurNom])).toEqual([[7, "reprise", "Ancienne autrice"]]);
    expect((await lireVersion(app, cible, id, 7))?.contenu).toEqual(procedure("Ancien"));
  });
});
