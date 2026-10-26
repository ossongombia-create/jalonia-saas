// Fin de contrat (décisions n° 3 et n° 6 du 19/10/2026) sur une vraie base : export complet d'une organisation, puis
// suppression définitive (schéma, rôle, lignes des tables communes) sans toucher aux autres organisations ; refus
// pour une organisation inconnue, une confirmation incorrecte, une organisation active ou non exportée ; le script
// de suppression refuse de s'exécuter hors d'un terminal interactif.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import type { Pool } from "pg";
import { creerDocument, supprimerDocument, type Contenu } from "../../src/server/documents/service";
import { appliquerTransition } from "../../src/server/documents/circuit";
import { creerAction } from "../../src/server/qse/actions";
import { definirObjectif, enregistrerMesure } from "../../src/server/qse/indicateurs";
import { accepterAvecCompte, inviter } from "../../src/server/invitations/service";
import { ouvrirAccesUrgence } from "../../src/server/acces-urgence/service";
import { changerStatutOrganisation } from "../../src/server/organisations/service";
import { chaineIntacte, verifierJournal } from "../../src/server/audit/chaine";
import { enTransaction } from "../../src/server/db/transactions";
import { exporterOrganisation, supprimerOrganisation, type ExportOrganisation } from "../../src/server/fin-de-contrat/service";
import type { Acteur } from "../../src/server/acteur";
import { creerOrgDeTest, creerSuperadmin, membreDeTest, ouvrirPools, suffixe, type OrgDeTest } from "./outils";

/** Les tables d'une organisation (migrations organisation 0001 à 0010) : toutes doivent être dans l'export. */
const TABLES_ORGANISATION = [
  "actions", "cartographie", "decisions_document", "documents", "journal", "mesures_indicateur", "notifications", "objectifs_indicateur",
  "parametres", "versions_document",
];

let app: Pool;
let proprietaire: Pool;
let superadmin: Acteur;
let dossier: string;

beforeAll(async () => {
  ({ app, proprietaire } = ouvrirPools());
  superadmin = await creerSuperadmin(proprietaire);
  dossier = mkdtempSync(path.join(tmpdir(), "jalonia-fin-de-contrat-"));
});

afterAll(async () => {
  rmSync(dossier, { recursive: true, force: true });
  await app.end();
  await proprietaire.end();
});

const procedure = (titre: string): Contenu => ({
  meta: { typeDocument: "procedure", titre, reference: "PR-FC-01" },
  roles: [],
  etapes: [{ id: "e1", libelle: "Mesurer", indicateur: { actif: true, nom: "Délai de traitement" } }],
});
const adminDe = (org: OrgDeTest): Acteur => ({ id: org.adminId, email: org.adminEmail, ip: "127.0.0.1", agent: "vitest" });
const fichier = (nom: string) => path.join(dossier, `${nom}-${suffixe()}.json`);

/** Une organisation avec des données dans chaque partie : documents (corbeille comprise), décision, actions, mesures, invitation, accès d'urgence. */
async function organisationRemplie(nom: string): Promise<OrgDeTest> {
  const org = await creerOrgDeTest(app, proprietaire, superadmin, nom);
  const admin = adminDe(org);
  const redac = { id: await membreDeTest(app, org.cible, { email: `redac-${suffixe()}@test.local`, nom: "Rédac", roles: ["REDACTEUR"] }, admin), email: "redac", ip: "127.0.0.1", agent: "vitest" };
  const d = await creerDocument(app, org.cible, procedure(`${nom} — procédure`), redac);
  await appliquerTransition(app, org.cible, d.id, "soumettre", { motif: "", versionVue: d.version, roles: ["REDACTEUR"], fonction: "Rédacteur" }, redac);
  const corbeille = await creerDocument(app, org.cible, procedure(`${nom} — à la corbeille`), redac);
  await supprimerDocument(app, org.cible, corbeille.id, redac);
  await creerAction(app, org.cible, { titre: `${nom} — action`, description: "", origine: "audit", responsableId: redac.id, echeance: "2026-12-31" }, admin);
  await definirObjectif(app, org.cible, d.id, "e1", { sens: "max", seuil: "5", unite: "j" }, admin);
  await enregistrerMesure(app, org.cible, d.id, "e1", { date: "2026-10-01", valeur: "12", commentaire: "" }, "2026-10-19", admin);
  await inviter(app, org.cible, { email: `invite-${suffixe()}@test.local`, nom: "Invité", roles: ["LECTEUR"] }, admin);
  await ouvrirAccesUrgence(app, org.organisationId, { role: "LECTEUR", dureeHeures: 1, motif: "Assistance avant la fin du contrat" }, superadmin);
  return org;
}

/** Empreinte d'une organisation : chaque table de son schéma et ses lignes des tables communes (rien ne doit changer). */
async function empreinte(org: OrgDeTest): Promise<string> {
  return enTransaction(proprietaire, async (c) => {
    const parties: string[] = [];
    for (const t of TABLES_ORGANISATION) {
      const r = await c.query<{ e: string }>(`SELECT md5(coalesce(string_agg(row_to_json(t)::text, '|' ORDER BY row_to_json(t)::text), '')) AS e FROM "${org.cible.schemaName}"."${t}" t`);
      parties.push(`${t}:${r.rows[0]!.e}`);
    }
    for (const [table, colonne] of [["organisations", "id"], ["adhesions", "organisation_id"], ["invitations", "organisation_id"], ["acces_urgence", "organisation_id"]]) {
      const r = await c.query<{ e: string }>(`SELECT md5(coalesce(string_agg(row_to_json(t)::text, '|' ORDER BY row_to_json(t)::text), '')) AS e FROM platform.${table} t WHERE ${colonne} = $1`, [org.organisationId]);
      parties.push(`${table}:${r.rows[0]!.e}`);
    }
    return parties.join(";");
  });
}

const existe = async (sql: string, p: unknown[]) => ((await enTransaction(proprietaire, (c) => c.query(sql, p))).rowCount ?? 0) > 0;
const lignesCommunes = async (organisationId: string, schema: string) => ({
  organisations: await existe("SELECT 1 FROM platform.organisations WHERE id = $1", [organisationId]),
  adhesions: await existe("SELECT 1 FROM platform.adhesions WHERE organisation_id = $1", [organisationId]),
  invitations: await existe("SELECT 1 FROM platform.invitations WHERE organisation_id = $1", [organisationId]),
  accesUrgence: await existe("SELECT 1 FROM platform.acces_urgence WHERE organisation_id = $1", [organisationId]),
  migrations: await existe("SELECT 1 FROM platform.migrations_organisation WHERE schema_name = $1", [schema]),
  sessions: await existe("SELECT 1 FROM platform.sessions WHERE organisation_id = $1", [organisationId]),
});

describe("export d'une organisation", () => {
  it("toutes les tables de l'organisation et ses lignes communes, sans aucun secret ; fichier neuf, privé, tracé ; rien d'autre ne change", async () => {
    const org = await organisationRemplie("Exportée");
    const avant = await empreinte(org);
    const chemin = fichier("export");
    const bilan = await exporterOrganisation(proprietaire, org.organisationId, chemin);
    const texte = readFileSync(chemin, "utf8");
    const e = JSON.parse(texte) as ExportOrganisation;

    expect(e.format).toBe("jalonia-export-organisation/1");
    expect(Object.keys(e.tables)).toEqual(TABLES_ORGANISATION);
    // … et ce sont bien TOUTES les tables du schéma (une table ajoutée plus tard serait exportée aussi).
    const catalogue = await enTransaction(proprietaire, (c) => c.query<{ t: string }>(
      "SELECT table_name AS t FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE' ORDER BY 1", [org.cible.schemaName]));
    expect(Object.keys(e.tables)).toEqual(catalogue.rows.map((l) => l.t));
    // Une organisation remplie : chaque table a des lignes (sauf « cartographie » et « notifications », vides ici).
    for (const t of TABLES_ORGANISATION.filter((x) => x !== "cartographie" && x !== "notifications")) expect(e.comptes[t], t).toBeGreaterThan(0);
    expect(e.tables.documents).toHaveLength(2); // corbeille comprise (décision n° 3)
    expect(e.tables.documents!.some((d) => (d as { supprime_le: string | null }).supprime_le !== null)).toBe(true);
    expect((e.tables.actions![0] as { titre: string }).titre).toBe("Exportée — action");
    expect(e.organisation).toMatchObject({ id: org.organisationId, schema_name: org.cible.schemaName, statut: "active" });
    expect(e.plateforme.membres).toHaveLength(2);
    expect(e.plateforme.invitations).toHaveLength(4); // administrateur et rédacteur (acceptées), suppléant et invité (en attente)
    expect(e.plateforme.accesUrgence).toHaveLength(1);
    expect(e.plateforme.journal.length).toBeGreaterThan(0);
    expect(e.plateforme.migrations).toHaveLength(readdirSync("db/migrations/organisation").length);
    // Jamais de secret : ni mot de passe, ni second facteur, ni empreinte de jeton.
    for (const interdit of ["mot_de_passe", "argon2", "mfa_secret", "jeton_empreinte", "codes_secours"]) expect(texte, interdit).not.toContain(interdit);

    expect(bilan.empreinte).toBe(createHash("sha256").update(texte, "utf8").digest("hex"));
    expect(statSync(chemin).mode & 0o777).toBe(0o600);
    await expect(exporterOrganisation(proprietaire, org.organisationId, chemin)).rejects.toThrow(/existe déjà/);
    expect(await empreinte(org)).not.toBe(avant); // seule différence : l'export tracé dans le journal de l'organisation
    const traces = await enTransaction(proprietaire, (c) => c.query<{ n: string }>(
      "SELECT count(*) AS n FROM platform.journal WHERE organisation_id = $1 AND action = 'ORGANISATION_EXPORTEE'", [org.organisationId]));
    expect(Number(traces.rows[0]!.n)).toBe(1);
  });

  it("par identifiant court aussi ; refusé pour une organisation inconnue (rien n'est écrit)", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin, "Courte");
    const slug = (await enTransaction(proprietaire, (c) => c.query<{ slug: string }>("SELECT slug FROM platform.organisations WHERE id = $1", [org.organisationId]))).rows[0]!.slug;
    const bilan = await exporterOrganisation(proprietaire, slug, fichier("slug"));
    expect(bilan.organisation.id).toBe(org.organisationId);
    for (const ref of ["org-inexistante", "00000000-0000-4000-8000-000000000000", ""]) {
      const chemin = fichier("inconnue");
      await expect(exporterOrganisation(proprietaire, ref, chemin), ref).rejects.toThrow(/introuvable|à préciser/);
      expect(() => statSync(chemin)).toThrow();
    }
  });
});

describe("suppression d'une organisation", () => {
  it("retire son schéma, son rôle et ses lignes des tables communes ; les AUTRES organisations restent intactes ; tracée", async () => {
    const [cible, voisine] = [await organisationRemplie("Cible"), await organisationRemplie("Voisine")];
    // Un membre de la cible appartient aussi à la voisine : son compte reste, il n'est pas listé « sans organisation ».
    const commun = `commun-${suffixe()}@test.local`;
    const idCommun = await membreDeTest(app, cible.cible, { email: commun, nom: "Commun", roles: ["LECTEUR"] }, adminDe(cible));
    const invitation = await inviter(app, voisine.cible, { email: commun, nom: "Commun", roles: ["LECTEUR"] }, adminDe(voisine));
    await accepterAvecCompte(app, invitation.jeton, { id: idCommun, email: commun, ip: "127.0.0.1", agent: "vitest" });
    const empreinteVoisine = await empreinte(voisine);
    const nom = (await enTransaction(proprietaire, (c) => c.query<{ nom: string }>("SELECT nom FROM platform.organisations WHERE id = $1", [cible.organisationId]))).rows[0]!.nom;

    await changerStatutOrganisation(app, cible.organisationId, "suspendue", superadmin);
    await exporterOrganisation(proprietaire, cible.organisationId, fichier("avant-suppression"));
    const bilan = await supprimerOrganisation(proprietaire, cible.organisationId, `  ${nom} `);

    expect(bilan).toMatchObject({ tables: TABLES_ORGANISATION.length, membres: 3 });
    expect(bilan.comptesSansOrganisation).toHaveLength(2); // l'administrateur et le rédacteur ; pas le membre commun
    expect(bilan.comptesSansOrganisation).not.toContain(commun);
    expect(await existe("SELECT 1 FROM information_schema.schemata WHERE schema_name = $1", [cible.cible.schemaName])).toBe(false);
    expect(await existe("SELECT 1 FROM pg_roles WHERE rolname = $1", [cible.cible.roleName])).toBe(false);
    expect(await lignesCommunes(cible.organisationId, cible.cible.schemaName)).toEqual({
      organisations: false, adhesions: false, invitations: false, accesUrgence: false, migrations: false, sessions: false,
    });
    // Les comptes restent (ils peuvent servir ailleurs).
    expect(await existe("SELECT 1 FROM platform.utilisateurs WHERE email = $1", [cible.adminEmail])).toBe(true);

    // La voisine : identique, et l'application y travaille toujours.
    expect(await empreinte(voisine)).toBe(empreinteVoisine);
    expect(await lignesCommunes(voisine.organisationId, voisine.cible.schemaName)).toMatchObject({ organisations: true, adhesions: true, invitations: true, accesUrgence: true, migrations: true });
    await creerAction(app, voisine.cible, { titre: "Après la suppression de la cible", description: "", origine: "autre", responsableId: null, echeance: null }, adminDe(voisine));

    // Tracée dans le journal de la plateforme, dont la chaîne reste intacte (aucune ligne effacée).
    const trace = await enTransaction(proprietaire, (c) => c.query<{ details: Record<string, unknown> }>(
      "SELECT details FROM platform.journal WHERE organisation_id = $1 AND action = 'ORGANISATION_SUPPRIMEE'", [cible.organisationId]));
    expect(trace.rows[0]?.details).toMatchObject({ nom, schema: cible.cible.schemaName, tables: TABLES_ORGANISATION.length, membres: 3, comptesSansOrganisation: 2 });
    const chaine = await enTransaction(proprietaire, (c) => verifierJournal(c, "platform.journal", "platform", true));
    expect(chaineIntacte(chaine)).toBe(true);
  });

  it("refusée : organisation inconnue, confirmation incorrecte, organisation active, pas d'export depuis la suspension (rien n'est supprimé)", async () => {
    const org = await organisationRemplie("Protégée");
    const nom = (await enTransaction(proprietaire, (c) => c.query<{ nom: string }>("SELECT nom FROM platform.organisations WHERE id = $1", [org.organisationId]))).rows[0]!.nom;
    const avant = await empreinte(org);

    for (const ref of ["org-inexistante", "00000000-0000-4000-8000-000000000000", ""]) {
      await expect(supprimerOrganisation(proprietaire, ref, nom), ref).rejects.toThrow(/introuvable|à préciser/);
    }
    await expect(supprimerOrganisation(proprietaire, org.organisationId, nom)).rejects.toThrow(/encore active/);
    await changerStatutOrganisation(app, org.organisationId, "suspendue", superadmin);
    for (const faux of ["", "oui", nom.toUpperCase(), `${nom}x`, org.organisationId]) {
      await expect(supprimerOrganisation(proprietaire, org.organisationId, faux), faux).rejects.toThrow(/Confirmation incorrecte/);
    }
    await expect(supprimerOrganisation(proprietaire, org.organisationId, nom)).rejects.toThrow(/Aucun export/);
    // Un export fait AVANT une nouvelle suspension ne compte pas.
    await changerStatutOrganisation(app, org.organisationId, "active", superadmin);
    await exporterOrganisation(proprietaire, org.organisationId, fichier("trop-tot"));
    await changerStatutOrganisation(app, org.organisationId, "suspendue", superadmin);
    await expect(supprimerOrganisation(proprietaire, org.organisationId, nom)).rejects.toThrow(/Aucun export/);

    expect(await existe("SELECT 1 FROM information_schema.schemata WHERE schema_name = $1", [org.cible.schemaName])).toBe(true);
    expect(await existe("SELECT 1 FROM pg_roles WHERE rolname = $1", [org.cible.roleName])).toBe(true);
    expect(await lignesCommunes(org.organisationId, org.cible.schemaName)).toMatchObject({ organisations: true, adhesions: true, invitations: true, accesUrgence: true, migrations: true });
    // Seules différences : le journal de l'organisation (suspensions, réactivation, export) et son statut.
    expect((await empreinte(org)).split(";").filter((p) => !/^(journal|organisations):/.test(p))).toEqual(avant.split(";").filter((p) => !/^(journal|organisations):/.test(p)));
  });
});

describe("script de suppression : confirmation interactive obligatoire", () => {
  const TSX = path.resolve("node_modules/.bin/tsx");
  const SCRIPT = path.resolve("scripts/supprimer-organisation.ts");
  const env = () => ({ ...process.env, DATABASE_URL_PROPRIETAIRE: inject("urlProprietaire") });

  async function prete(): Promise<{ org: OrgDeTest; nom: string }> {
    const org = await creerOrgDeTest(app, proprietaire, superadmin, "Script");
    await changerStatutOrganisation(app, org.organisationId, "suspendue", superadmin);
    await exporterOrganisation(proprietaire, org.organisationId, fichier("script"));
    const nom = (await enTransaction(proprietaire, (c) => c.query<{ nom: string }>("SELECT nom FROM platform.organisations WHERE id = $1", [org.organisationId]))).rows[0]!.nom;
    return { org, nom };
  }

  it("hors d'un terminal (saisie par un tube) : refusé, même avec le bon nom ; rien n'est supprimé", async () => {
    const { org, nom } = await prete();
    const r = spawnSync(TSX, [SCRIPT, "--organisation", org.organisationId], { input: `${nom}\n`, env: env(), encoding: "utf8", timeout: 60_000 });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("terminal interactif");
    expect(await existe("SELECT 1 FROM platform.organisations WHERE id = $1", [org.organisationId])).toBe(true);
  });

  it("dans un terminal : un nom incorrect est refusé (rien n'est supprimé) ; le bon nom supprime", async () => {
    const { org, nom } = await prete();
    // « script » donne au processus un vrai terminal (pseudo-terminal), comme une session SSH. La réponse n'est tapée
    // qu'une fois la question affichée (comme une personne) : « script » s'arrête dès que sa propre saisie se ferme.
    const lancer = (reponse: string) => new Promise<{ code: number | null; sortie: string }>((fini, echec) => {
      const p = spawn("script", ["-qec", `${TSX} ${SCRIPT} --organisation ${org.organisationId}`, "/dev/null"], { env: env() });
      let sortie = "";
      let repondu = false;
      const delai = setTimeout(() => { p.kill(); echec(new Error(`délai dépassé :\n${sortie}`)); }, 60_000);
      p.stdout.on("data", (morceau: Buffer) => {
        sortie += morceau.toString("utf8");
        if (!repondu && sortie.includes("tapez le nom exact")) {
          repondu = true;
          p.stdin.write(`${reponse}\n`);
        }
      });
      p.on("close", (code) => { clearTimeout(delai); fini({ code, sortie }); });
    });
    const refus = await lancer("Pas le bon nom\n");
    expect(refus.code).toBe(1);
    expect(refus.sortie).toContain("Confirmation incorrecte");
    expect(refus.sortie).toContain("CETTE SUPPRESSION EST DÉFINITIVE");
    expect(await existe("SELECT 1 FROM platform.organisations WHERE id = $1", [org.organisationId])).toBe(true);

    const ok = await lancer(`${nom}\n`);
    expect(ok.sortie).toContain(`Organisation « ${nom} » supprimée`);
    expect(ok.code).toBe(0);
    expect(await existe("SELECT 1 FROM platform.organisations WHERE id = $1", [org.organisationId])).toBe(false);
  });
});
