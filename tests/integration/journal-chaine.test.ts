// Journaux chaînés par empreintes (audit S6) : écritures concurrentes, falsifications par le rôle propriétaire
// (déclencheurs désactivés) détectées, chaîne entièrement recalculée détectée grâce aux ancres.
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool, PoolClient } from "pg";
import { chainer, chaineIntacte, expressionCanonique, GENESE, lireAncres, verifierJournal, type Ancre } from "../../src/server/audit/chaine";
import { journaliserOrganisation } from "../../src/server/audit/journal";
import { creerDocument } from "../../src/server/documents/service";
import { inviter } from "../../src/server/invitations/service";
import { enTransaction, avecOrganisation } from "../../src/server/db/transactions";
import { citer } from "../../src/server/db/identifiants";
import type { Acteur } from "../../src/server/acteur";
import { creerOrgDeTest, creerSuperadmin, ouvrirPools, suffixe, type OrgDeTest } from "./outils";

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

const tableOrg = (org: OrgDeTest) => `${citer(org.schemaName)}.journal`;
const verifierOrg = (org: OrgDeTest, ancres: Ancre[] = []) => enTransaction(proprietaire, (c) => verifierJournal(c, tableOrg(org), org.schemaName, false, ancres));
const verifierPlateforme = (ancres: Ancre[] = []) => enTransaction(proprietaire, (c) => verifierJournal(c, "platform.journal", "platform", true, ancres));

/** Comme le ferait le propriétaire de la base : déclencheurs désactivés le temps d'une retouche. */
async function enFaussaire(table: string, travail: (c: PoolClient) => Promise<unknown>): Promise<void> {
  await enTransaction(proprietaire, async (c) => {
    await c.query(`ALTER TABLE ${table} DISABLE TRIGGER USER`);
    await travail(c);
    await c.query(`ALTER TABLE ${table} ENABLE TRIGGER USER`);
  });
}

const procedure = (titre: string) => ({ meta: { typeDocument: "procedure", titre, reference: "PR-CH-01" }, roles: [], etapes: [] });

describe("chaînage", () => {
  it("les déclencheurs et la vérification utilisent EXACTEMENT la même représentation canonique", () => {
    const lire = (f: string) => readFileSync(path.resolve(f), "utf8");
    const extraits = (texte: string) => [...texte.matchAll(/\/\*canon\*\/(.*?)\/\*fin\*\//g)].map((m) => m[1]);
    expect(extraits(lire("db/migrations/plateforme/0006_chaine_journal.sql"))).toEqual([expressionCanonique("r.", true), expressionCanonique("NEW.", true)]);
    expect(extraits(lire("db/migrations/organisation/0003_chaine_journal.sql"))).toEqual([expressionCanonique("r.", false), expressionCanonique("NEW.", false)]);
  });

  it("une organisation neuve : journal chaîné dès sa première ligne, intact", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const r = await verifierOrg(org);
    expect(chaineIntacte(r)).toBe(true);
    expect(r.lignes).toBe(3); // création, invitation, acceptation
    expect(r.rang).toBe(3);
    const premiere = await enTransaction(proprietaire, (c) => c.query<{ chaine_empreinte: string; canonique: string }>(
      `SELECT chaine_empreinte, ${expressionCanonique("j.", false)} AS canonique FROM ${tableOrg(org)} j WHERE chaine_rang = 1`,
    ));
    expect(premiere.rows[0]!.chaine_empreinte).toBe(chainer(GENESE, premiere.rows[0]!.canonique));
    expect(chaineIntacte(await verifierPlateforme())).toBe(true);
  });

  it("des valeurs de chaîne fournies à l'insertion sont ignorées (le déclencheur les calcule)", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    await avecOrganisation(app, org.cible, (c) =>
      c.query(`INSERT INTO journal (action, chaine_rang, chaine_empreinte) VALUES ('DOCUMENT_CREE', 999, repeat('a', 64))`),
    );
    const r = await verifierOrg(org);
    expect(chaineIntacte(r)).toBe(true);
    expect(r.rang).toBe(4);
  });

  it("écritures concurrentes (document : organisation puis plateforme ; invitation : plateforme puis organisation) : ni bifurcation, ni trou, ni blocage", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const auteur: Acteur = { id: org.adminId, email: org.adminEmail, ip: "127.0.0.1", agent: "vitest" };
    const travaux = Array.from({ length: 12 }, (_, i) =>
      i % 2 === 0
        ? creerDocument(app, org.cible, procedure(`Concurrent ${i}`), auteur)
        : inviter(app, org.cible, { email: `chaine-${i}-${suffixe()}@test.local`, nom: "X", roles: ["LECTEUR"] }, auteur),
    );
    const resultats = await Promise.allSettled(travaux);
    expect(resultats.filter((r) => r.status === "rejected")).toEqual([]);
    const r = await verifierOrg(org);
    expect(chaineIntacte(r)).toBe(true);
    expect(r.lignes).toBe(3 + 12);
    expect(chaineIntacte(await verifierPlateforme())).toBe(true);
  });

  it("une transaction annulée ne laisse pas de trou dans la chaîne", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    await expect(
      avecOrganisation(app, org.cible, async (c) => {
        await journaliserOrganisation(c, { action: "DOCUMENT_CREE" });
        throw new Error("annulation voulue");
      }),
    ).rejects.toThrow("annulation voulue");
    await avecOrganisation(app, org.cible, (c) => journaliserOrganisation(c, { action: "DOCUMENT_SUPPRIME" }));
    const r = await verifierOrg(org);
    expect(chaineIntacte(r)).toBe(true);
    expect(r.rang).toBe(4);
  });
});

describe("falsifications par le rôle propriétaire (déclencheurs désactivés)", () => {
  it("ligne modifiée : désignée précisément", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    await enFaussaire(tableOrg(org), (c) => c.query(`UPDATE ${tableOrg(org)} SET acteur_email = 'quelquun@dautre.test' WHERE chaine_rang = 2`));
    const r = await verifierOrg(org);
    expect(r.lignesModifiees).toEqual([2]);
    expect(r.divergenceDepuis).toBe(2);
    expect(chaineIntacte(r)).toBe(false);
  });

  it("ligne supprimée : rang manquant", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    await enFaussaire(tableOrg(org), (c) => c.query(`DELETE FROM ${tableOrg(org)} WHERE chaine_rang = 2`));
    const r = await verifierOrg(org);
    expect(r.rangsManquants).toEqual([2]);
    expect(chaineIntacte(r)).toBe(false);
  });

  it("chaîne entièrement recalculée après retouche : cohérente en apparence, mais l'ancre exportée la trahit", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const avant = await verifierOrg(org);
    const ancre: Ancre = { journal: org.schemaName, rang: avant.rang, empreinte: avant.empreinte };
    expect((await verifierOrg(org, [ancre])).ancresVerifiees).toBe(1);

    const t = tableOrg(org);
    await enFaussaire(t, async (c) => {
      await c.query(`UPDATE ${t} SET details = '{"falsifie": true}' WHERE chaine_rang = 1`);
      // Le faussaire recalcule toute la chaîne, comme le ferait le déclencheur.
      await c.query(`DO $$ DECLARE r record; v text := repeat('0', 64); BEGIN
        FOR r IN SELECT * FROM ${t} ORDER BY chaine_rang LOOP
          v := encode(sha256(convert_to(v || '|' || ${expressionCanonique("r.", false)}, 'UTF8')), 'hex');
          UPDATE ${t} SET chaine_empreinte = v WHERE id = r.id;
        END LOOP; END $$`);
    });
    const sansAncre = await verifierOrg(org);
    expect(chaineIntacte(sansAncre)).toBe(true); // c'est pourquoi les ancres doivent être gardées HORS du serveur
    const avecAncre = await verifierOrg(org, [ancre]);
    expect(avecAncre.ancresEnEchec).toEqual([ancre]);
    expect(chaineIntacte(avecAncre)).toBe(false);
  });

  it("journal de la plateforme : retouche détectée, puis remise en état", async () => {
    const r0 = await verifierPlateforme();
    expect(chaineIntacte(r0)).toBe(true);
    const cible = await enTransaction(proprietaire, (c) => c.query<{ id: string; action: string }>("SELECT id, action FROM platform.journal WHERE chaine_rang = $1", [r0.rang]));
    const { id, action } = cible.rows[0]!;
    await enFaussaire("platform.journal", (c) => c.query("UPDATE platform.journal SET action = 'CONNEXION' WHERE id = $1", [id]));
    expect((await verifierPlateforme()).lignesModifiees).toEqual(action === "CONNEXION" ? [] : [r0.rang]);
    await enFaussaire("platform.journal", (c) => c.query("UPDATE platform.journal SET action = $2 WHERE id = $1", [id, action]));
    expect(chaineIntacte(await verifierPlateforme())).toBe(true);
  });

  it("une ancre au-delà de la fin du journal (lignes disparues) est signalée", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const r = await verifierOrg(org, [{ journal: org.schemaName, rang: 99, empreinte: "f".repeat(64) }]);
    expect(r.ancresEnEchec).toHaveLength(1);
  });
});

describe("fichiers d'ancres", () => {
  it("lecture ; ligne illisible refusée", () => {
    expect(lireAncres(`# Jalonia — ancres\nplatform|12|${"a".repeat(64)}\n\norg_0123456789ab|3|${"b".repeat(64)}\n`)).toEqual([
      { journal: "platform", rang: 12, empreinte: "a".repeat(64) },
      { journal: "org_0123456789ab", rang: 3, empreinte: "b".repeat(64) },
    ]);
    expect(() => lireAncres("platform|douze|abc")).toThrow(/illisible/);
  });
});
