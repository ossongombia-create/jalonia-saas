// Cohérence entre documents (D2) sur une vraie base : extraction des liens par PostgreSQL (jsonpath) sur des contenus
// réels ou malformés, constats, avertissement avant suppression, étanchéité entre organisations.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { creerDocument, enregistrerCartographie, lireCoherence, listerDocuments, supprimerDocument } from "../../src/server/documents/service";
import { lireJournalOrganisation } from "../../src/server/consultation/service";
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

const auteurDe = (org: OrgDeTest): Acteur => ({ id: org.adminId, email: org.adminEmail, ip: "127.0.0.1", agent: "vitest" });

function procedure(reference: string, etapes: unknown[], processus: unknown = "ACH Acheter") {
  return { meta: { typeDocument: "procedure", titre: `Procédure ${reference}`, reference, processus }, roles: [], etapes };
}
function instruction(reference: string, processus: unknown = "ACH Acheter") {
  return { meta: { typeDocument: "instruction", titre: `Instruction ${reference}`, reference, processus, niveau: 3 }, roles: [], etapes: [] };
}
const resume = async (org: OrgDeTest) =>
  (await lireCoherence(app, org.cible)).constats.map((c) => `${c.gravite}:${c.cle}:${c.code ?? c.processus ?? ""}:${c.documents.map((d) => d.reference).join(",")}`);

describe("liens lus dans les contenus enregistrés", () => {
  it("instructions « niveau 3 » et sous-procédures ; valeurs inattendues ignorées (jamais d'erreur)", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const auteur = auteurDe(org);
    await creerDocument(app, org.cible, procedure("PR-1", [
      { id: "e1", niveau3: { actif: true, code: "it-1" } },
      { id: "e2", niveau3: { actif: false, code: "IT-DESACTIVEE" } },
      { id: "e3", niveau3: { actif: "true", code: "IT-TEXTE" } }, // « actif » qui n'est pas un booléen : ignoré
      { id: "e4", niveau3: { actif: true, code: 42 } }, // code qui n'est pas un texte : ignoré
      { id: "e5", niveau3: "n'importe quoi" },
      { id: "e6", sousProcedure: { actif: true, code: "PR-9" } },
      { id: "e7", sousProcedure: { actif: true, code: ["PR-X"] } }, // tableau : ignoré (pas déballé)
      { id: "e8", niveau3: { actif: [true], code: "IT-TABLEAU" } }, // « actif » dans un tableau : ignoré
      "pas un objet",
    ]), auteur);
    await creerDocument(app, org.cible, instruction("IT-1"), auteur);
    await creerDocument(app, org.cible, instruction("IT-SEULE", { pas: "un texte" }), auteur);
    expect(await resume(org)).toEqual([
      "alerte:it_non_rattachee:IT-SEULE:IT-SEULE",
      "alerte:sp_absente:PR-9:PR-1",
    ]);
  });

  it("processus absent de la cartographie (seulement quand la cartographie a des processus)", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const auteur = auteurDe(org);
    await creerDocument(app, org.cible, procedure("PR-1", [], "ACH Acheter"), auteur);
    await creerDocument(app, org.cible, procedure("PR-2", [], "VEN"), auteur);
    expect(await resume(org)).toEqual([]);
    await enregistrerCartographie(app, org.cible, { version: 0, contenu: { processus: [{ id: "p1", code: "VEN", nom: "Vendre" }, { code: 7 }, "x"], flux: [], documents: [] } }, auteur);
    expect(await resume(org)).toEqual(["alerte:processus_inconnu:ACH Acheter:PR-1"]);
  });

  it("chaque organisation ne voit que SES documents", async () => {
    const a = await creerOrgDeTest(app, proprietaire, superadmin);
    const b = await creerOrgDeTest(app, proprietaire, superadmin);
    await creerDocument(app, a.cible, procedure("PR-1", [{ id: "e1", niveau3: { actif: true, code: "IT-1" } }]), auteurDe(a));
    await creerDocument(app, b.cible, instruction("IT-1"), auteurDe(b));
    await creerDocument(app, b.cible, instruction("PR-1"), auteurDe(b));
    expect(await resume(a)).toEqual(["info:n3_absente:IT-1:PR-1"]);
    expect(await resume(b)).toEqual(["alerte:it_non_rattachee:IT-1:IT-1", "alerte:it_non_rattachee:PR-1:PR-1"]);
  });
});

describe("suppression d'un document lié à d'autres", () => {
  it("refusée sans confirmation ; confirmée : seul ce document est supprimé, les liens confirmés sont tracés", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const auteur = auteurDe(org);
    const pr = await creerDocument(app, org.cible, procedure("PR-1", [{ id: "e1", niveau3: { actif: true, code: "IT-1" } }]), auteur);
    const it1 = await creerDocument(app, org.cible, instruction("IT-1"), auteur);
    const seule = await creerDocument(app, org.cible, instruction("IT-2"), auteur);

    const coherence = await lireCoherence(app, org.cible);
    expect(coherence.dependances[pr.id]?.map((d) => [d.reference, d.lien])).toEqual([["IT-1", "instruction"]]);
    expect(coherence.dependances[it1.id]?.map((d) => [d.reference, d.lien])).toEqual([["PR-1", "citante"]]);
    expect(coherence.dependances[seule.id]).toBeUndefined();

    expect(await cleErreur(supprimerDocument(app, org.cible, pr.id, auteur))).toBe("docs.suppression_liee");
    expect(await cleErreur(supprimerDocument(app, org.cible, it1.id, auteur))).toBe("docs.suppression_liee");
    expect((await listerDocuments(app, org.cible)).length).toBe(3);

    await supprimerDocument(app, org.cible, seule.id, auteur); // sans lien : pas de confirmation
    await supprimerDocument(app, org.cible, pr.id, auteur, { confirmerLiens: true });
    expect((await listerDocuments(app, org.cible)).map((d) => d.reference)).toEqual(["IT-1"]);
    expect(await resume(org)).toEqual(["alerte:it_non_rattachee:IT-1:IT-1"]);

    const journal = await lireJournalOrganisation(app, org.cible, { page: 1 });
    const trace = journal.lignes.find((l) => l.action === "DOCUMENT_SUPPRIME" && l.cibleId === pr.id);
    expect(trace?.details).toMatchObject({ reference: "PR-1", liensConfirmes: [{ id: it1.id, lien: "instruction", reference: "IT-1" }] });
    const sansLien = journal.lignes.find((l) => l.action === "DOCUMENT_SUPPRIME" && l.cibleId === seule.id);
    expect(sansLien?.details).not.toHaveProperty("liensConfirmes");
  });

  it("document introuvable : « introuvable », même avec confirmation", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    expect(await cleErreur(supprimerDocument(app, org.cible, "00000000-0000-4000-8000-000000000000", auteurDe(org), { confirmerLiens: true }))).toBe("erreur.introuvable");
  });
});
