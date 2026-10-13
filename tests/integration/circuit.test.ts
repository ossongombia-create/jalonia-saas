// Circuit de validation (W1, W3) sur une vraie base : transitions, séparation des tâches, motif, version vue, document
// figé hors brouillon, trace d'approbation (empreinte), décisions en ajout seul, concurrence, cohérence, étanchéité,
// mise à niveau d'une organisation existante.
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { appliquerTransition, lireCircuit, type Transition } from "../../src/server/documents/circuit";
import { creerDocument, enregistrerDocument, lireCoherence, lireDocument, listerDocuments, supprimerDocument, type Contenu } from "../../src/server/documents/service";
import { listerVersions, restaurerVersion } from "../../src/server/documents/versions";
import { lireJournalOrganisation, lireJournalPlateforme } from "../../src/server/consultation/service";
import { appliquerMigrationsOrganisation, lireMigrations } from "../../src/server/migrations/lanceur";
import { creerOrganisation } from "../../src/server/organisations/provisionnement";
import { lireOrganisation } from "../../src/server/organisations/service";
import { avecOrganisation, enTransaction } from "../../src/server/db/transactions";
import type { RoleOrganisation } from "../../src/lib/rbac";
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

// Une personne et ses rôles dans l'organisation (le service reçoit les rôles de l'organisation ouverte).
type Personne = Acteur & { roles: RoleOrganisation[] };
const personne = (nom: string, ...roles: RoleOrganisation[]): Personne => ({ id: randomUUID(), email: `${nom.toLowerCase()}-${suffixe()}@test.local`, nom, ip: "127.0.0.1", agent: "vitest", roles });
const procedure = (titre: string, reference = "PR-C-01"): Contenu => ({ meta: { typeDocument: "procedure", titre, reference }, roles: [], etapes: [{ id: "e1", libelle: titre }] });
const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

/** Décision au nom de `p` sur la version actuelle (ou `versionVue`). */
async function decider(org: OrgDeTest, id: string, t: Transition, p: Personne, motif = "", versionVue?: number) {
  const v = versionVue ?? (await lireDocument(app, org.cible, id))!.version;
  return appliquerTransition(app, org.cible, id, t, { motif, versionVue: v, roles: p.roles }, p);
}
const etat = async (org: OrgDeTest, id: string) => (await lireCircuit(app, org.cible, id))!.etat;

let alice: Personne; // rédactrice
let bob: Personne; // rédacteur
let vera: Personne; // vérificatrice
let paul: Personne; // approbateur
let multi: Personne; // vérificatrice ET approbatrice
let lea: Personne; // lectrice
beforeAll(() => {
  alice = personne("Alice", "REDACTEUR");
  bob = personne("Bob", "REDACTEUR");
  vera = personne("Vera", "VERIFICATEUR");
  paul = personne("Paul", "APPROBATEUR");
  multi = personne("Multi", "VERIFICATEUR", "APPROBATEUR");
  lea = personne("Lea", "LECTEUR");
});

describe("circuit de validation", () => {
  it("brouillon → vérification → approbation → publié ; figé hors brouillon ; version soumise copiée ; décisions tracées", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const d = await creerDocument(app, org.cible, procedure("P1"), alice);
    await enregistrerDocument(app, org.cible, d.id, { contenu: procedure("P2"), version: 1 }, alice);
    expect(await etat(org, d.id)).toBe("brouillon");

    expect(await decider(org, d.id, "soumettre", alice)).toEqual({ etat: "en_verification" });
    // Figé : ni enregistrement, ni restauration, ni corbeille.
    expect(await cleErreur(enregistrerDocument(app, org.cible, d.id, { contenu: procedure("P3"), version: 2 }, alice))).toBe("circuit.non_modifiable");
    expect(await cleErreur(enregistrerDocument(app, org.cible, d.id, { contenu: procedure("P3"), version: 2, forcer: true }, alice))).toBe("circuit.non_modifiable");
    expect(await cleErreur(restaurerVersion(app, org.cible, d.id, 1, 2, alice))).toBe("circuit.non_modifiable");
    expect(await cleErreur(supprimerDocument(app, org.cible, d.id, alice))).toBe("circuit.suppression_impossible");
    // La version soumise (v2, pas encore copiée) entre dans l'historique.
    expect((await listerVersions(app, org.cible, d.id))!.versions.map((v) => [v.version, v.motif])).toEqual([[2, "soumission"], [1, "creation"]]);

    expect(await decider(org, d.id, "verifier", vera, "Relu, conforme.")).toEqual({ etat: "en_approbation" });
    expect(await decider(org, d.id, "approuver", paul)).toEqual({ etat: "publie" });
    const c = (await lireCircuit(app, org.cible, d.id))!;
    expect(c).toMatchObject({ etat: "publie", version: 2, versionPubliee: 2 });
    expect(c.publieLe).toBeInstanceOf(Date);
    expect(await cleErreur(enregistrerDocument(app, org.cible, d.id, { contenu: procedure("P3"), version: 2 }, alice))).toBe("circuit.non_modifiable");
    expect((await lireDocument(app, org.cible, d.id))!.contenu).toEqual(procedure("P2"));
    expect((await listerDocuments(app, org.cible)).map((x) => [x.etat, x.versionPubliee])).toEqual([["publie", 2]]);

    // Trace : la plus récente d'abord ; même version, même empreinte (SHA-256 du contenu canonique jsonb).
    const brut = await avecOrganisation(app, org.cible, (cl) => cl.query<{ t: string }>("SELECT contenu::text AS t FROM documents WHERE id = $1", [d.id]));
    const empreinte = sha256(brut.rows[0]!.t);
    expect(c.decisions.map((x) => [x.transition, x.etatAvant, x.etatApres, x.version, x.acteurNom, x.motif, x.empreinte])).toEqual([
      ["approuver", "en_approbation", "publie", 2, "Paul", "", empreinte],
      ["verifier", "en_verification", "en_approbation", 2, "Vera", "Relu, conforme.", empreinte],
      ["soumettre", "brouillon", "en_verification", 2, "Alice", "", empreinte],
    ]);

    // Journaux : l'organisation a tout (titre, motif, empreinte) ; la plateforme, l'opération seulement.
    const org1 = (await lireJournalOrganisation(app, org.cible, { page: 1 })).lignes.filter((l) => l.cibleId === d.id);
    expect(org1.slice(0, 3).map((l) => `${l.action}:${l.acteurEmail}`)).toEqual([`DOCUMENT_APPROUVE:${paul.email}`, `DOCUMENT_VERIFIE:${vera.email}`, `DOCUMENT_SOUMIS:${alice.email}`]);
    expect(org1[1]!.details).toMatchObject({ titre: "P2", version: 2, transition: "verifier", motif: "Relu, conforme.", empreinte });
    const plateforme = (await lireJournalPlateforme(app, { page: 1 })).lignes.filter((l) => l.cibleId === d.id);
    expect(plateforme.slice(0, 3).map((l) => [l.action, l.details])).toEqual([
      ["DOCUMENT_APPROUVE", { type: "procedure", transition: "approuver" }],
      ["DOCUMENT_VERIFIE", { type: "procedure", transition: "verifier" }],
      ["DOCUMENT_SOUMIS", { type: "procedure", transition: "soumettre" }],
    ]);
  });

  it("droits : chaque décision demande son rôle (revérifié par le service)", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const d = await creerDocument(app, org.cible, procedure("D"), alice);
    for (const p of [vera, paul, lea]) expect(await cleErreur(decider(org, d.id, "soumettre", p)), p.nom).toBe("erreur.interdit");
    await decider(org, d.id, "soumettre", bob); // un autre rédacteur peut soumettre
    for (const p of [alice, bob, paul, lea]) expect(await cleErreur(decider(org, d.id, "verifier", p)), p.nom).toBe("erreur.interdit");
    await decider(org, d.id, "verifier", vera);
    for (const p of [alice, vera, lea]) expect(await cleErreur(decider(org, d.id, "approuver", p)), p.nom).toBe("erreur.interdit");
    expect(await etat(org, d.id)).toBe("en_approbation");
    expect((await lireCircuit(app, org.cible, d.id))!.decisions).toHaveLength(2);
  });

  it("séparation des tâches : l'auteur, la personne qui soumet et celle qui vérifie ne décident pas de l'étape suivante", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const aliceVerif = { ...alice, roles: ["REDACTEUR", "VERIFICATEUR", "APPROBATEUR"] as RoleOrganisation[] };
    const bobVerif = { ...bob, roles: ["REDACTEUR", "VERIFICATEUR", "APPROBATEUR"] as RoleOrganisation[] };
    const d = await creerDocument(app, org.cible, procedure("S"), alice); // Alice est l'autrice
    await decider(org, d.id, "soumettre", bob); // Bob soumet
    expect(await cleErreur(decider(org, d.id, "verifier", aliceVerif))).toBe("circuit.separation_auteur");
    expect(await cleErreur(decider(org, d.id, "refuser_verification", aliceVerif, "non"))).toBe("circuit.separation_auteur");
    expect(await cleErreur(decider(org, d.id, "verifier", bobVerif))).toBe("circuit.separation_auteur");
    await decider(org, d.id, "verifier", multi);
    expect(await cleErreur(decider(org, d.id, "approuver", multi))).toBe("circuit.separation_verificateur");
    expect(await cleErreur(decider(org, d.id, "refuser_approbation", multi, "non"))).toBe("circuit.separation_verificateur");
    expect(await cleErreur(decider(org, d.id, "approuver", aliceVerif))).toBe("circuit.separation_auteur");
    expect(await cleErreur(decider(org, d.id, "approuver", bobVerif))).toBe("circuit.separation_auteur");
    expect(await etat(org, d.id)).toBe("en_approbation");
    await decider(org, d.id, "approuver", paul);
    expect(await etat(org, d.id)).toBe("publie");
  });

  it("refus : motif obligatoire, retour au brouillon, le document se modifie de nouveau ; le cycle suivant repart de zéro", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const d = await creerDocument(app, org.cible, procedure("R1"), alice);
    await decider(org, d.id, "soumettre", alice);
    expect(await cleErreur(decider(org, d.id, "refuser_verification", vera))).toBe("circuit.motif_requis");
    expect(await cleErreur(decider(org, d.id, "refuser_verification", vera, "   "))).toBe("circuit.motif_requis");
    expect(await cleErreur(decider(org, d.id, "refuser_verification", vera, "x".repeat(2001)))).toBe("circuit.motif_trop_long");
    expect(await decider(org, d.id, "refuser_verification", vera, "  Étape 2 incomplète.  ")).toEqual({ etat: "brouillon" });
    expect((await lireCircuit(app, org.cible, d.id))!.decisions[0]).toMatchObject({ transition: "refuser_verification", motif: "Étape 2 incomplète." });
    const v2 = await enregistrerDocument(app, org.cible, d.id, { contenu: procedure("R2"), version: 1 }, alice);
    expect(v2.version).toBe(2);

    // Cycle 2 : Vera vérifie, Paul refuse à l'approbation ; cycle 3 : Multi vérifie, Vera (qui avait vérifié au cycle 2)
    // peut approuver si elle a le rôle, car seules comptent les décisions du cycle en cours.
    await decider(org, d.id, "soumettre", alice);
    await decider(org, d.id, "verifier", vera);
    expect(await cleErreur(decider(org, d.id, "refuser_approbation", paul))).toBe("circuit.motif_requis");
    await decider(org, d.id, "refuser_approbation", paul, "Référence réglementaire à citer.");
    expect(await etat(org, d.id)).toBe("brouillon");
    await enregistrerDocument(app, org.cible, d.id, { contenu: procedure("R3"), version: 2 }, alice);
    await decider(org, d.id, "soumettre", alice);
    await decider(org, d.id, "verifier", multi);
    const veraApprobatrice = { ...vera, roles: ["VERIFICATEUR", "APPROBATEUR"] as RoleOrganisation[] };
    expect(await decider(org, d.id, "approuver", veraApprobatrice)).toEqual({ etat: "publie" });
    expect((await lireCircuit(app, org.cible, d.id))!.versionPubliee).toBe(3);
  });

  it("version vue : une décision prise sur une version qui n'est plus l'actuelle est refusée", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const d = await creerDocument(app, org.cible, procedure("V1"), alice);
    await enregistrerDocument(app, org.cible, d.id, { contenu: procedure("V2"), version: 1 }, alice);
    expect(await cleErreur(decider(org, d.id, "soumettre", alice, "", 1))).toBe("versions.document_modifie");
    expect(await etat(org, d.id)).toBe("brouillon");
    await decider(org, d.id, "soumettre", alice, "", 2);
    expect(await cleErreur(decider(org, d.id, "verifier", vera, "", 1))).toBe("versions.document_modifie");
    expect(await etat(org, d.id)).toBe("en_verification");
  });

  it("état incompatible : une décision hors de son étape est refusée, sans rien écrire", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const d = await creerDocument(app, org.cible, procedure("E"), alice);
    expect(await cleErreur(decider(org, d.id, "verifier", vera))).toBe("circuit.etat_incompatible");
    expect(await cleErreur(decider(org, d.id, "approuver", paul))).toBe("circuit.etat_incompatible");
    expect(await cleErreur(decider(org, d.id, "archiver", paul, "m"))).toBe("circuit.etat_incompatible");
    expect(await cleErreur(decider(org, d.id, "reviser", alice))).toBe("circuit.etat_incompatible");
    expect((await lireCircuit(app, org.cible, d.id))!.decisions).toEqual([]);
    expect(await cleErreur(appliquerTransition(app, org.cible, d.id, "publier" as Transition, { motif: "", versionVue: 1, roles: paul.roles }, paul))).toBe("erreur.introuvable");
    expect(await cleErreur(appliquerTransition(app, org.cible, "pas-un-id", "soumettre", { motif: "", versionVue: 1, roles: alice.roles }, alice))).toBe("erreur.introuvable");
    expect(await cleErreur(appliquerTransition(app, org.cible, randomUUID(), "soumettre", { motif: "", versionVue: 1, roles: alice.roles }, alice))).toBe("erreur.introuvable");
  });

  it("révision d'un document publié : nouveau brouillon, la version publiée reste connue et dans l'historique", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const d = await creerDocument(app, org.cible, procedure("Pub1"), alice);
    await decider(org, d.id, "soumettre", alice);
    await decider(org, d.id, "verifier", vera);
    await decider(org, d.id, "approuver", paul);
    expect(await cleErreur(decider(org, d.id, "reviser", vera))).toBe("erreur.interdit");
    expect(await decider(org, d.id, "reviser", bob)).toEqual({ etat: "brouillon" });
    await enregistrerDocument(app, org.cible, d.id, { contenu: procedure("Pub2 en préparation"), version: 1 }, bob);
    const c = (await lireCircuit(app, org.cible, d.id))!;
    expect(c).toMatchObject({ etat: "brouillon", version: 2, versionPubliee: 1 });
    expect((await listerVersions(app, org.cible, d.id))!.versions.map((v) => v.version)).toContain(1);
    // Pendant la révision, Bob est l'auteur de la nouvelle version : il ne la vérifiera pas.
    await decider(org, d.id, "soumettre", alice);
    const bobVerif = { ...bob, roles: ["VERIFICATEUR"] as RoleOrganisation[] };
    expect(await cleErreur(decider(org, d.id, "verifier", bobVerif))).toBe("circuit.separation_auteur");
  });

  it("archivage : motif obligatoire, définitif ; le document archivé sort des contrôles de cohérence", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const ancien = await creerDocument(app, org.cible, procedure("Ancienne", "PR-ARC-01"), alice);
    await decider(org, ancien.id, "soumettre", alice);
    await decider(org, ancien.id, "verifier", vera);
    await decider(org, ancien.id, "approuver", paul);
    const nouveau = await creerDocument(app, org.cible, procedure("Nouvelle", "PR-ARC-01"), alice);
    expect((await lireCoherence(app, org.cible)).constats.filter((c) => c.cle === "code_double").map((c) => c.documents.map((x) => x.id).sort()))
      .toEqual([[ancien.id, nouveau.id].sort()]);

    expect(await cleErreur(decider(org, ancien.id, "archiver", paul))).toBe("circuit.motif_requis");
    expect(await decider(org, ancien.id, "archiver", paul, "Remplacée par la nouvelle version.")).toEqual({ etat: "archive" });
    expect((await lireCoherence(app, org.cible)).constats.filter((c) => c.cle === "code_double")).toEqual([]);
    for (const [t, p] of [["reviser", alice], ["soumettre", alice], ["archiver", paul]] as const) {
      expect(await cleErreur(decider(org, ancien.id, t, p, "m")), t).toBe("circuit.etat_incompatible");
    }
    expect(await cleErreur(enregistrerDocument(app, org.cible, ancien.id, { contenu: procedure("X"), version: 1 }, alice))).toBe("circuit.non_modifiable");
    expect(await cleErreur(supprimerDocument(app, org.cible, ancien.id, alice))).toBe("circuit.suppression_impossible");
    // Toujours consultable : liste, lecture, historique.
    expect((await listerDocuments(app, org.cible)).find((x) => x.id === ancien.id)?.etat).toBe("archive");
    expect((await lireDocument(app, org.cible, ancien.id))?.contenu).toEqual(procedure("Ancienne", "PR-ARC-01"));
  });

  it("concurrence : deux décisions simultanées sur la même étape — une seule passe", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const d = await creerDocument(app, org.cible, procedure("C"), alice);
    await decider(org, d.id, "soumettre", alice);
    const vera2 = personne("Vera2", "VERIFICATEUR");
    const r = await Promise.allSettled([decider(org, d.id, "verifier", vera, "", 1), decider(org, d.id, "refuser_verification", vera2, "non", 1)]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const rejet = r.find((x): x is PromiseRejectedResult => x.status === "rejected");
    expect((rejet!.reason as { cle?: string }).cle).toBe("circuit.etat_incompatible");
    expect((await lireCircuit(app, org.cible, d.id))!.decisions).toHaveLength(2);
  });
});

describe("droits PostgreSQL et étanchéité", () => {
  it("les décisions sont en ajout seul pour le rôle de l'organisation", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const d = await creerDocument(app, org.cible, procedure("A"), alice);
    await decider(org, d.id, "soumettre", alice);
    const refus = (sql: string) => codeErreur(avecOrganisation(app, org.cible, (c) => c.query(sql)));
    expect(await refus("UPDATE decisions_document SET motif = 'falsifié'")).toBe("42501");
    expect(await refus("UPDATE decisions_document SET empreinte = repeat('0', 64)")).toBe("42501");
    expect(await refus("DELETE FROM decisions_document")).toBe("42501");
    expect(await refus("TRUNCATE decisions_document")).toBe("42501");
    // Les contraintes protègent aussi l'ajout : transition inconnue, empreinte mal formée, motif trop long.
    const ajout = (transition: string, empreinte: string, motif = "") => codeErreur(avecOrganisation(app, org.cible, (c) => c.query(
      "INSERT INTO decisions_document (document_id, version, transition, etat_avant, etat_apres, motif, empreinte) VALUES ($1, 1, $2, 'brouillon', 'publie', $3, $4)",
      [d.id, transition, motif, empreinte],
    )));
    expect(await ajout("publier", "a".repeat(64))).toBe("23514");
    expect(await ajout("approuver", "pas-une-empreinte")).toBe("23514");
    expect(await ajout("approuver", "a".repeat(64), "x".repeat(2001))).toBe("23514");
    expect(await codeErreur(avecOrganisation(app, org.cible, (c) => c.query("UPDATE documents SET etat = 'valide' WHERE id = $1", [d.id])))).toBe("23514");
    expect((await lireCircuit(app, org.cible, d.id))!.decisions).toHaveLength(1);
  });

  it("le circuit d'une organisation est invisible et intouchable depuis une autre", async () => {
    const a = await creerOrgDeTest(app, proprietaire, superadmin);
    const b = await creerOrgDeTest(app, proprietaire, superadmin);
    const d = await creerDocument(app, a.cible, procedure("Chez A"), alice);
    await decider(a, d.id, "soumettre", alice);
    expect(await lireCircuit(app, b.cible, d.id)).toBeNull();
    expect(await cleErreur(appliquerTransition(app, b.cible, d.id, "verifier", { motif: "", versionVue: 1, roles: vera.roles }, vera))).toBe("erreur.introuvable");
    expect(await codeErreur(avecOrganisation(app, b.cible, (c) => c.query(`SELECT * FROM "${a.cible.schemaName}".decisions_document`)))).toBe("42501");
    expect(await etat(a, d.id)).toBe("en_verification");
  });

  it("un document à la corbeille n'a plus de circuit", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const d = await creerDocument(app, org.cible, procedure("Corbeille"), alice);
    await supprimerDocument(app, org.cible, d.id, alice);
    expect(await lireCircuit(app, org.cible, d.id)).toBeNull();
    expect(await cleErreur(decider(org, d.id, "soumettre", alice, "", 1))).toBe("erreur.introuvable");
  });
});

describe("mise à niveau d'une organisation existante", () => {
  it("les documents déjà présents deviennent des brouillons, modifiables et soumettables", async () => {
    const toutes = await lireMigrations(path.resolve("db/migrations/organisation"));
    const s = suffixe();
    const retires = await enTransaction(proprietaire, (c) =>
      c.query<{ nom: string; sql: string; empreinte: string }>("DELETE FROM platform.gabarits_organisation WHERE nom >= '0005' RETURNING nom, sql, empreinte"),
    );
    let creee;
    try {
      creee = await creerOrganisation(app, { nom: `Avant circuit ${s}`, slug: `avant-circuit-${s}`, admin: { email: `adm-${s}@test.local`, nom: "Adm" } }, superadmin);
    } finally {
      await enTransaction(proprietaire, async (c) => {
        for (const g of retires.rows) await c.query("INSERT INTO platform.gabarits_organisation (nom, sql, empreinte) VALUES ($1, $2, $3)", [g.nom, g.sql, g.empreinte]);
      });
    }
    expect(retires.rows.map((g) => g.nom)).toContain("0005_circuit.sql");
    const o = await lireOrganisation(app, creee.organisationId);
    const cible = { id: o!.id, schemaName: o!.schemaName, roleName: o!.roleName };
    const id = randomUUID();
    await avecOrganisation(app, cible, (c) => c.query(
      "INSERT INTO documents (id, type, titre, reference, contenu, version, modifie_par_nom) VALUES ($1, 'procedure', 'Existant', 'PR-E', $2::jsonb, 4, 'Ancienne autrice')",
      [id, JSON.stringify(procedure("Existant"))],
    ));
    const appliquees = await enTransaction(proprietaire, (c) => appliquerMigrationsOrganisation(c, cible, toutes));
    expect(appliquees).toEqual(retires.rows.map((g) => g.nom).sort());
    const org = { cible } as OrgDeTest;
    expect(await lireCircuit(app, cible, id)).toMatchObject({ etat: "brouillon", version: 4, versionPubliee: null, decisions: [] });
    // Soumis tel quel : la copie « soumission » est acceptée (contrainte élargie par 0005) ; refusé, il se modifie de nouveau.
    expect(await decider(org, id, "soumettre", alice)).toEqual({ etat: "en_verification" });
    expect((await listerVersions(app, cible, id))!.versions.map((v) => [v.version, v.motif])).toEqual([[4, "soumission"]]);
    await decider(org, id, "refuser_verification", vera, "À reprendre.");
    expect((await enregistrerDocument(app, cible, id, { contenu: procedure("Existant modifié"), version: 4 }, alice)).version).toBe(5);
  });
});
