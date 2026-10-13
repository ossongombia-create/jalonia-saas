// Documents et cartographie d'une organisation : création, versions et conflits, contrôle du contenu,
// suppression, traçabilité (regroupée), étanchéité entre organisations, droits PostgreSQL.
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import {
  ConflitVersion, contenuInitial, creerDocument, enregistrerCartographie, enregistrerDocument, lireCartographie, lireDocument, listerDocuments,
  metaDepuisContenu, supprimerDocument, TAILLE_MAX_CONTENU,
} from "../../src/server/documents/service";
import { lireJournalOrganisation, lireJournalPlateforme } from "../../src/server/consultation/service";
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

function acteur(nom: string): Acteur {
  return { id: randomUUID(), email: `${nom.toLowerCase()}-${suffixe()}@test.local`, nom, ip: "127.0.0.1", agent: "vitest" };
}

function procedure(titre: string, reference = "PR-ACH-01") {
  return { meta: { typeDocument: "procedure", titre, reference }, roles: [{ id: "r1", nom: "Acheteur" }], etapes: [{ id: "e1", libelle: "Commander" }] };
}

async function conflit(promesse: Promise<unknown>): Promise<ConflitVersion | undefined> {
  try {
    await promesse;
    return undefined;
  } catch (e) {
    if (e instanceof ConflitVersion) return e;
    throw e;
  }
}

async function journalOrg(org: OrgDeTest) {
  return (await lireJournalOrganisation(app, org.cible, { page: 1 })).lignes;
}

describe("documents : création, lecture, liste", () => {
  it("création d'une procédure et d'une instruction ; titre, code et type lus dans le contenu", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const alice = acteur("Alice");
    const p = await creerDocument(app, org.cible, procedure("Acheter"), alice);
    const i = await creerDocument(app, org.cible, contenuInitial("instruction"), alice);
    expect(p.version).toBe(1);

    const lu = await lireDocument(app, org.cible, p.id);
    expect(lu).toMatchObject({ id: p.id, type: "procedure", titre: "Acheter", reference: "PR-ACH-01", version: 1, creeParNom: "Alice", modifieParNom: "Alice" });
    expect(lu?.contenu).toEqual(procedure("Acheter"));

    const liste = await listerDocuments(app, org.cible);
    expect(liste.map((d) => d.id).sort()).toEqual([p.id, i.id].sort());
    expect(liste.find((d) => d.id === i.id)).toMatchObject({ type: "instruction", titre: "", reference: "" });
    expect(liste.every((d) => !("contenu" in d))).toBe(true); // la liste ne charge pas les contenus
  });

  it("identifiant invalide ou inconnu : null / introuvable", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    expect(await lireDocument(app, org.cible, "pas-un-uuid")).toBeNull();
    expect(await lireDocument(app, org.cible, randomUUID())).toBeNull();
    expect(await cleErreur(enregistrerDocument(app, org.cible, randomUUID(), { contenu: procedure("X"), version: 1 }, acteur("A")))).toBe("erreur.introuvable");
    expect(await cleErreur(supprimerDocument(app, org.cible, "x", acteur("A")))).toBe("erreur.introuvable");
  });

  it("métadonnées : type inconnu → vide, « les_deux » → procédure, textes tronqués à 500", () => {
    expect(metaDepuisContenu({ meta: { typeDocument: "autre", titre: 3 } })).toEqual({ type: "", titre: "", reference: "" });
    expect(metaDepuisContenu({ meta: { typeDocument: "les_deux" } }).type).toBe("procedure");
    expect(metaDepuisContenu({ meta: { titre: "  x".padEnd(800, "y") } }).titre.length).toBe(500);
    expect(metaDepuisContenu({}).type).toBe("");
  });
});

describe("contrôle du contenu", () => {
  it("forme invalide refusée : pas un objet, sans rôles ou sans instructions, meta qui n'est pas un objet", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const a = acteur("A");
    for (const mauvais of [null, [], "texte", { roles: [] }, { etapes: [] }, { roles: {}, etapes: [] }, { meta: [], roles: [], etapes: [] }, { meta: null, roles: [], etapes: [] }]) {
      expect(await cleErreur(creerDocument(app, org.cible, mauvais, a)), JSON.stringify(mauvais)).toBe("docs.erreur.contenu_invalide");
    }
  });

  it("taille maximale : au-delà de 2 Mo, refus clair", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const gros = { ...procedure("Gros"), annexe: "x".repeat(TAILLE_MAX_CONTENU) };
    expect(await cleErreur(creerDocument(app, org.cible, gros, acteur("A")))).toBe("docs.erreur.trop_volumineux");
  });

  it("profondeur excessive refusée", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    let profond: unknown = "fond";
    for (let i = 0; i < 40; i += 1) profond = [profond];
    expect(await cleErreur(creerDocument(app, org.cible, { roles: [], etapes: [], profond }, acteur("A")))).toBe("docs.erreur.contenu_invalide");
  });

  it("caractère nul et demi-caractères (refusés par PostgreSQL) : retirés ou remplacés, l'enregistrement passe", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const brut = { meta: { typeDocument: "procedure", titre: "A\u0000B\ud800C" }, roles: [], etapes: [{ id: "e1", libelle: "x\u0000y" }], "cl\u0000e": 1, __proto__x: 2 };
    const d = await creerDocument(app, org.cible, brut, acteur("A"));
    const lu = await lireDocument(app, org.cible, d.id);
    expect(lu?.titre).toBe("AB�C");
    expect(lu?.contenu).toMatchObject({ meta: { titre: "AB�C" }, etapes: [{ libelle: "xy" }], cle: 1, __proto__x: 2 });
  });

  it("une clé « __proto__ » reste une simple donnée", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const brut = JSON.parse('{"meta":{},"roles":[],"etapes":[],"__proto__":{"pollue":true}}');
    const d = await creerDocument(app, org.cible, brut, acteur("A"));
    const lu = await lireDocument(app, org.cible, d.id);
    expect(Object.prototype.hasOwnProperty.call(lu?.contenu, "__proto__")).toBe(true);
    expect(({} as Record<string, unknown>).pollue).toBeUndefined();
  });
});

describe("versions et conflits", () => {
  it("chaque enregistrement incrémente la version ; une version dépassée est refusée avec l'auteur du dernier enregistrement", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const alice = acteur("Alice");
    const bob = acteur("Bob");
    const d = await creerDocument(app, org.cible, procedure("V1"), alice);

    const v2 = await enregistrerDocument(app, org.cible, d.id, { contenu: procedure("V2"), version: 1 }, alice);
    expect(v2).toMatchObject({ version: 2, modifieParNom: "Alice" });
    // Bob avait ouvert la version 1 : refus, rien n'est écrasé.
    const refus = await conflit(enregistrerDocument(app, org.cible, d.id, { contenu: procedure("Bob"), version: 1 }, bob));
    expect(refus?.actuel).toMatchObject({ version: 2, modifieParNom: "Alice" });
    expect((await lireDocument(app, org.cible, d.id))?.titre).toBe("V2");

    // Bob choisit explicitement de garder sa version : elle remplace celle d'Alice, et c'est tracé.
    const v3 = await enregistrerDocument(app, org.cible, d.id, { contenu: procedure("Bob"), version: 1, forcer: true }, bob);
    expect(v3).toMatchObject({ version: 3, modifieParNom: "Bob" });
    const lu = await lireDocument(app, org.cible, d.id);
    expect(lu).toMatchObject({ titre: "Bob", version: 3, creeParNom: "Alice", modifieParNom: "Bob" });
    const remplacement = (await journalOrg(org)).find((l) => l.action === "DOCUMENT_MODIFIE" && l.acteurEmail === bob.email);
    expect(remplacement?.details).toMatchObject({ versionRemplacee: 2, auteurRemplace: "Alice", titre: "Bob" });
  });

  it("version invalide refusée", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const d = await creerDocument(app, org.cible, procedure("X"), acteur("A"));
    for (const v of [-1, 1.5, Number.NaN, "1" as unknown as number]) {
      expect(await cleErreur(enregistrerDocument(app, org.cible, d.id, { contenu: procedure("X"), version: v }, acteur("A")))).toBe("erreur.saisie_invalide");
    }
  });

  it("deux enregistrements simultanés sur la même version : un seul passe, l'autre est en conflit", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const d = await creerDocument(app, org.cible, procedure("X"), acteur("A"));
    const resultats = await Promise.allSettled([
      enregistrerDocument(app, org.cible, d.id, { contenu: procedure("Un"), version: 1 }, acteur("Un")),
      enregistrerDocument(app, org.cible, d.id, { contenu: procedure("Deux"), version: 1 }, acteur("Deux")),
    ]);
    expect(resultats.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const echec = resultats.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(echec.reason).toBeInstanceOf(ConflitVersion);
    expect((await lireDocument(app, org.cible, d.id))?.version).toBe(2);
  });
});

describe("traçabilité", () => {
  it("création, modifications (regroupées par personne) et suppression : dans les deux journaux ; la plateforme ne voit pas les titres", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const alice = acteur("Alice");
    const bob = acteur("Bob");
    const d = await creerDocument(app, org.cible, procedure("Secret industriel"), alice);
    let v = 1;
    for (let k = 0; k < 4; k += 1) v = (await enregistrerDocument(app, org.cible, d.id, { contenu: procedure(`Titre ${k}`), version: v }, alice)).version;
    v = (await enregistrerDocument(app, org.cible, d.id, { contenu: procedure("Bob"), version: v }, bob)).version;
    await enregistrerDocument(app, org.cible, d.id, { contenu: procedure("Bob 2"), version: v }, bob);
    await supprimerDocument(app, org.cible, d.id, alice);

    const lignes = (await journalOrg(org)).filter((l) => l.cibleId === d.id);
    expect(lignes.map((l) => `${l.action}:${l.acteurEmail}`).reverse()).toEqual([
      `DOCUMENT_CREE:${alice.email}`,
      `DOCUMENT_MODIFIE:${alice.email}`,
      `DOCUMENT_MODIFIE:${bob.email}`,
      `DOCUMENT_SUPPRIME:${alice.email}`,
    ]);
    expect(lignes.find((l) => l.action === "DOCUMENT_SUPPRIME")?.details).toMatchObject({ titre: "Bob 2", reference: "PR-ACH-01", type: "procedure" });

    const plateforme = (await lireJournalPlateforme(app, { page: 1 })).lignes.filter((l) => l.cibleId === d.id);
    expect(plateforme.map((l) => l.action).sort()).toEqual(["DOCUMENT_CREE", "DOCUMENT_MODIFIE", "DOCUMENT_MODIFIE", "DOCUMENT_SUPPRIME"]);
    expect(JSON.stringify(plateforme.map((l) => l.details))).not.toMatch(/Secret|Titre|Bob/);
    expect(plateforme.every((l) => l.organisation !== null)).toBe(true);
  });

  it("suppression : le document disparaît ; une seconde suppression est refusée", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const d = await creerDocument(app, org.cible, procedure("X"), acteur("A"));
    await supprimerDocument(app, org.cible, d.id, acteur("A"));
    expect(await lireDocument(app, org.cible, d.id)).toBeNull();
    expect(await listerDocuments(app, org.cible)).toEqual([]);
    expect(await cleErreur(supprimerDocument(app, org.cible, d.id, acteur("A")))).toBe("erreur.introuvable");
  });
});

describe("cartographie", () => {
  const carto = (organisation: string) => ({ organisation, processus: [{ id: "q1", code: "ACH", nom: "Acheter", categorie: "support" }], flux: [], documents: [], fiches: {} });

  it("au départ : version 0 et contenu vide ; ensuite versions, conflit, remplacement explicite", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const alice = acteur("Alice");
    const bob = acteur("Bob");
    expect(await lireCartographie(app, org.cible)).toEqual({ contenu: {}, version: 0, modifieParNom: "", modifieLe: null });

    expect(await enregistrerCartographie(app, org.cible, { contenu: carto("A"), version: 0 }, alice)).toMatchObject({ version: 1, modifieParNom: "Alice" });
    const refus = await conflit(enregistrerCartographie(app, org.cible, { contenu: carto("B"), version: 0 }, bob));
    expect(refus?.actuel).toMatchObject({ version: 1, modifieParNom: "Alice" });
    expect((await lireCartographie(app, org.cible)).contenu).toEqual(carto("A"));

    expect(await enregistrerCartographie(app, org.cible, { contenu: carto("B"), version: 0, forcer: true }, bob)).toMatchObject({ version: 2, modifieParNom: "Bob" });
    expect(await lireCartographie(app, org.cible)).toMatchObject({ contenu: carto("B"), version: 2, modifieParNom: "Bob" });
  });

  it("forme invalide refusée ; traces regroupées par personne", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const alice = acteur("Alice");
    for (const mauvais of [null, [], { processus: [] }, { processus: [], flux: [], documents: {} }]) {
      expect(await cleErreur(enregistrerCartographie(app, org.cible, { contenu: mauvais, version: 0 }, alice))).toBe("docs.erreur.contenu_invalide");
    }
    let v = 0;
    for (let k = 0; k < 3; k += 1) v = (await enregistrerCartographie(app, org.cible, { contenu: carto(`A${k}`), version: v }, alice)).version;
    const traces = (await journalOrg(org)).filter((l) => l.action === "CARTOGRAPHIE_MODIFIEE");
    expect(traces).toHaveLength(1);
    expect(traces[0]?.cibleType).toBe("cartographie");
  });
});

describe("étanchéité et droits PostgreSQL", () => {
  it("une organisation ne voit, ne modifie ni ne supprime les documents d'une autre", async () => {
    const a = await creerOrgDeTest(app, proprietaire, superadmin);
    const b = await creerOrgDeTest(app, proprietaire, superadmin);
    const d = await creerDocument(app, a.cible, procedure("Chez A"), acteur("A"));
    await enregistrerCartographie(app, a.cible, { contenu: { organisation: "A", processus: [], flux: [], documents: [] }, version: 0 }, acteur("A"));

    expect(await lireDocument(app, b.cible, d.id)).toBeNull();
    expect(await listerDocuments(app, b.cible)).toEqual([]);
    expect(await cleErreur(enregistrerDocument(app, b.cible, d.id, { contenu: procedure("Pirate"), version: 1 }, acteur("B")))).toBe("erreur.introuvable");
    expect(await cleErreur(supprimerDocument(app, b.cible, d.id, acteur("B")))).toBe("erreur.introuvable");
    expect((await lireCartographie(app, b.cible)).version).toBe(0);
    expect((await lireDocument(app, a.cible, d.id))?.titre).toBe("Chez A");

    // Même en visant directement le schéma de A, le rôle de B est refusé par PostgreSQL.
    expect(await codeErreur(avecOrganisation(app, b.cible, (c) => c.query(`SELECT * FROM "${a.cible.schemaName}".documents`)))).toBe("42501");
  });

  it("le rôle de l'organisation ne peut ni réécrire l'auteur d'un document, ni supprimer ou vider la cartographie", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const d = await creerDocument(app, org.cible, procedure("X"), acteur("A"));
    const refus = (sql: string, valeurs: unknown[] = []) => codeErreur(avecOrganisation(app, org.cible, (c) => c.query(sql, valeurs)));
    expect(await refus("UPDATE documents SET cree_par_nom = 'Faux' WHERE id = $1", [d.id])).toBe("42501");
    expect(await refus("UPDATE documents SET cree_le = now() WHERE id = $1", [d.id])).toBe("42501");
    expect(await refus("DELETE FROM cartographie")).toBe("42501");
    expect(await refus("INSERT INTO cartographie (id) VALUES (2)")).toBe("42501");
    expect(await refus("TRUNCATE documents")).toBe("42501");
  });
});

describe("mise à niveau d'une organisation existante", () => {
  it("une organisation créée avant les documents (migration 0001 seule) reçoit 0002 et fonctionne aussitôt", async () => {
    const toutes = await lireMigrations(path.resolve("db/migrations/organisation"));
    const s = suffixe();
    // Comme si l'organisation avait été créée quand seul le gabarit 0001 existait : on retire un instant les suivants.
    const retires = await enTransaction(proprietaire, (c) =>
      c.query<{ nom: string; sql: string; empreinte: string }>("DELETE FROM platform.gabarits_organisation WHERE nom > '0001_socle.sql' RETURNING nom, sql, empreinte"),
    );
    let creee;
    try {
      creee = await creerOrganisation(
        app,
        { nom: `Ancienne ${s}`, slug: `ancienne-${s}`, admin: { email: `adm-${s}@test.local`, nom: "Adm" } },
        superadmin,
      );
    } finally {
      await enTransaction(proprietaire, async (c) => {
        for (const g of retires.rows) await c.query("INSERT INTO platform.gabarits_organisation (nom, sql, empreinte) VALUES ($1, $2, $3)", [g.nom, g.sql, g.empreinte]);
      });
    }
    const o = await lireOrganisation(app, creee.organisationId);
    const cible = { id: o!.id, schemaName: o!.schemaName, roleName: o!.roleName };
    expect(await codeErreur(listerDocuments(app, cible))).toBe("42P01"); // table absente

    const appliquees = await enTransaction(proprietaire, (c) => appliquerMigrationsOrganisation(c, cible, toutes));
    expect(appliquees).toEqual(["0002_documents.sql"]);
    const d = await creerDocument(app, cible, procedure("Après mise à niveau"), acteur("A"));
    expect((await listerDocuments(app, cible)).map((x) => x.id)).toEqual([d.id]);
    expect((await lireCartographie(app, cible)).version).toBe(0);
  });
});
