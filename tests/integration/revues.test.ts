// Revues périodiques, notifications et tâches quotidiennes (W2) sur une vraie base : destinataires des notifications du
// circuit, revue confirmée, réglages, rappels / retards / escalades sans doublon, ménage, droits PostgreSQL, étanchéité.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { appliquerTransition, lireCircuit, type Transition } from "../../src/server/documents/circuit";
import { creerDocument, lireDocument, type Contenu } from "../../src/server/documents/service";
import { lireParametresOrganisation, modifierParametres } from "../../src/server/documents/revues";
import { compterNonLues, listerNotifications, marquerLues, notifier } from "../../src/server/notifications/service";
import { executerTachesQuotidiennes } from "../../src/server/taches/quotidiennes";
import { lireJournalOrganisation, lireJournalPlateforme } from "../../src/server/consultation/service";
import { avecOrganisation, enTransaction } from "../../src/server/db/transactions";
import type { RoleOrganisation } from "../../src/lib/rbac";
import type { Acteur } from "../../src/server/acteur";
import { cleErreur, codeErreur, creerOrgDeTest, creerSuperadmin, membreDeTest, ouvrirPools, suffixe, type OrgDeTest } from "./outils";

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

type Personne = Acteur & { roles: RoleOrganisation[] };
/** Un vrai membre de l'organisation (compte créé par invitation), avec ses rôles. */
async function membre(org: OrgDeTest, nom: string, ...roles: RoleOrganisation[]): Promise<Personne> {
  const email = `${nom.toLowerCase()}-${suffixe()}@test.local`;
  const id = await membreDeTest(app, org.cible, { email, nom, roles }, superadmin);
  return { id, email, nom, ip: "127.0.0.1", agent: "vitest", roles };
}
const adminDe = (org: OrgDeTest): Personne => ({ id: org.adminId, email: org.adminEmail, nom: "Admin", roles: ["ADMIN_ORGANISATION"] });
const procedure = (titre: string): Contenu => ({ meta: { typeDocument: "procedure", titre, reference: "PR-REV-01" }, roles: [], etapes: [{ id: "e1", libelle: titre }] });

async function decider(org: OrgDeTest, id: string, t: Transition, p: Personne, motif = "") {
  const v = (await lireDocument(app, org.cible, id))!.version;
  return appliquerTransition(app, org.cible, id, t, { motif, versionVue: v, roles: p.roles }, p);
}
const recues = async (org: OrgDeTest, p: Personne) => (await listerNotifications(app, org.cible, p.id)).map((n) => [n.nature, n.details.motif ?? null]);
const enSql = (org: OrgDeTest, sql: string, valeurs: unknown[] = []) => enTransaction(proprietaire, (c) => c.query(sql.replaceAll("$S", `"${org.cible.schemaName}"`), valeurs));
const naturesDe = async (org: OrgDeTest, p: Personne) => (await listerNotifications(app, org.cible, p.id)).map((n) => n.nature).sort();

describe("notifications du circuit", () => {
  it("soumis → vérificateurs ; vérifié → approbateurs ; refusé (motif) et publié → auteur ; jamais à soi-même ; comptes désactivés exclus", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const [redac, verif1, verif2, appro, lect] = [
      await membre(org, "Redac", "REDACTEUR"), await membre(org, "Verif1", "VERIFICATEUR"), await membre(org, "Verif2", "VERIFICATEUR"),
      await membre(org, "Appro", "APPROBATEUR"), await membre(org, "Lect", "LECTEUR"),
    ];
    const d = await creerDocument(app, org.cible, procedure("Notifier"), redac);
    await decider(org, d.id, "soumettre", redac);
    expect(await recues(org, verif1)).toEqual([["a_verifier", null]]);
    expect(await recues(org, verif2)).toEqual([["a_verifier", null]]);
    for (const p of [redac, appro, lect, adminDe(org)]) expect(await recues(org, p), p.nom).toEqual([]);
    const n = (await listerNotifications(app, org.cible, verif1.id))[0]!;
    expect(n).toMatchObject({ documentId: d.id, lueLe: null, details: { titre: "Notifier", reference: "PR-REV-01", version: 1, par: "Redac" } });

    await decider(org, d.id, "verifier", verif1);
    expect(await recues(org, appro)).toEqual([["a_approuver", null]]);
    expect(await recues(org, verif1)).toEqual([["a_verifier", null]]);
    await decider(org, d.id, "refuser_approbation", appro, "Citer la norme.");
    expect(await recues(org, redac)).toEqual([["refuse", "Citer la norme."]]);

    // Verif2 désactivé : il n'est plus prévenu.
    await enTransaction(proprietaire, (c) => c.query("UPDATE platform.utilisateurs SET statut = 'desactive' WHERE id = $1", [verif2.id]));
    await decider(org, d.id, "soumettre", redac);
    expect(await naturesDe(org, verif1)).toEqual(["a_verifier", "a_verifier"]);
    expect(await naturesDe(org, verif2)).toEqual(["a_verifier"]);
    await decider(org, d.id, "verifier", verif1);
    await decider(org, d.id, "approuver", appro);
    expect((await recues(org, redac))[0]).toEqual(["publie", null]);
    expect(await compterNonLues(app, org.cible, redac.id)).toBe(2);
  });

  it("auteur et personne qui soumet distincts : tous deux prévenus du refus et de la publication ; ceux que la séparation écarte ne sont pas sollicités", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const [auteur, soumet, verifAppro, appro] = [
      await membre(org, "Auteur", "REDACTEUR", "VERIFICATEUR"), await membre(org, "Soumet", "REDACTEUR", "APPROBATEUR"),
      await membre(org, "VerifAppro", "VERIFICATEUR", "APPROBATEUR"), await membre(org, "Appro", "APPROBATEUR"),
    ];
    const d = await creerDocument(app, org.cible, procedure("Séparation"), auteur);
    await decider(org, d.id, "soumettre", soumet);
    // L'auteure est vérificatrice, mais ne peut pas vérifier sa version : elle n'est pas sollicitée.
    expect(await naturesDe(org, auteur)).toEqual([]);
    expect(await naturesDe(org, verifAppro)).toEqual(["a_verifier"]);
    await decider(org, d.id, "verifier", verifAppro);
    // À approuver : ni l'auteure, ni la personne qui a soumis (approbatrice), ni celle qui a vérifié.
    expect(await naturesDe(org, appro)).toEqual(["a_approuver"]);
    expect(await naturesDe(org, soumet)).toEqual([]);
    expect(await naturesDe(org, verifAppro)).toEqual(["a_verifier"]);
    await decider(org, d.id, "refuser_approbation", appro, "À compléter.");
    expect(await recues(org, auteur)).toEqual([["refuse", "À compléter."]]);
    expect(await recues(org, soumet)).toEqual([["refuse", "À compléter."]]);
    await decider(org, d.id, "soumettre", soumet);
    await decider(org, d.id, "verifier", verifAppro);
    await decider(org, d.id, "approuver", appro);
    expect((await recues(org, auteur))[0]).toEqual(["publie", null]);
    expect((await recues(org, soumet))[0]).toEqual(["publie", null]);
    expect(await naturesDe(org, appro)).toEqual(["a_approuver", "a_approuver"]);
  });

  it("ordre : les plus récentes d'abord, au-delà de 9 lignes (notifications et journal de l'organisation)", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const a = await membre(org, "A", "REDACTEUR");
    await avecOrganisation(app, org.cible, (c) => notifier(c, Array.from({ length: 12 }, (_, i) => ({ destinataire: a.id, nature: "revue_proche" as const, cle: `ordre:${i}`, details: { titre: `N${i}` } }))));
    expect((await listerNotifications(app, org.cible, a.id)).map((n) => n.details.titre)).toEqual(Array.from({ length: 12 }, (_, i) => `N${11 - i}`));
    for (let i = 0; i < 12; i++) await creerDocument(app, org.cible, procedure(`D${i}`), a);
    const ids = (await lireJournalOrganisation(app, org.cible, { page: 1 })).lignes.map((l) => Number(l.id));
    expect(ids.length).toBeGreaterThanOrEqual(12);
    expect(ids).toEqual([...ids].sort((x, y) => y - x));
  });

  it("lire et marquer : chacun les siennes seulement ; une notification n'est jamais créée deux fois ; étanchéité", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const autre = await creerOrgDeTest(app, proprietaire, superadmin);
    const [a, b] = [await membre(org, "A", "REDACTEUR"), await membre(org, "B", "REDACTEUR")];
    const creees = await avecOrganisation(app, org.cible, (c) => notifier(c, [
      { destinataire: a.id, nature: "revue_proche", cle: "essai:1", details: { titre: "T1" } },
      { destinataire: a.id, nature: "revue_proche", cle: "essai:1", details: { titre: "doublon" } },
      { destinataire: a.id, nature: "revue_retard", cle: "essai:2", details: { titre: "T2" } },
      { destinataire: b.id, nature: "revue_proche", cle: "essai:1", details: { titre: "T1" } },
    ]));
    expect(creees).toBe(3);
    expect(await avecOrganisation(app, org.cible, (c) => notifier(c, [{ destinataire: a.id, nature: "revue_proche", cle: "essai:1", details: {} }]))).toBe(0);
    const deA = await listerNotifications(app, org.cible, a.id);
    expect(deA.map((n) => n.details.titre)).toEqual(["T2", "T1"]);
    const deB = await listerNotifications(app, org.cible, b.id);
    // B ne peut pas marquer celles de A, même avec leurs identifiants.
    expect(await marquerLues(app, org.cible, b.id, deA.map((n) => n.id))).toBe(0);
    expect(await marquerLues(app, org.cible, a.id, [deA[1]!.id, "pas-un-id", "1; DROP TABLE x"])).toBe(1);
    expect(await compterNonLues(app, org.cible, a.id)).toBe(1);
    expect(await marquerLues(app, org.cible, a.id, "toutes")).toBe(1);
    expect(await compterNonLues(app, org.cible, a.id)).toBe(0);
    expect(await compterNonLues(app, org.cible, b.id)).toBe(1);
    expect(deB).toHaveLength(1);
    // Depuis une autre organisation : rien.
    expect(await listerNotifications(app, autre.cible, a.id)).toEqual([]);
    expect(await marquerLues(app, autre.cible, b.id, "toutes")).toBe(0);
    expect(await compterNonLues(app, org.cible, b.id)).toBe(1);
    expect(await codeErreur(avecOrganisation(app, autre.cible, (c) => c.query(`SELECT * FROM "${org.cible.schemaName}".notifications`)))).toBe("42501");
  });
});

describe("revue périodique", () => {
  it("approuver et confirmer la revue fixent la date de revue ; confirmer = approbateur, document publié, décision tracée", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const [redac, verif, appro] = [await membre(org, "Redac", "REDACTEUR"), await membre(org, "Verif", "VERIFICATEUR"), await membre(org, "Appro", "APPROBATEUR")];
    const d = await creerDocument(app, org.cible, procedure("Revue"), redac);
    expect(await cleErreur(decider(org, d.id, "confirmer_revue", appro))).toBe("circuit.etat_incompatible");
    for (const [t, p] of [["soumettre", redac], ["verifier", verif], ["approuver", appro]] as const) await decider(org, d.id, t, p);
    const publie = (await lireCircuit(app, org.cible, d.id))!;
    expect(publie.revueLe).toBeInstanceOf(Date);
    expect(publie.revueLe!.getTime()).toBe(publie.publieLe!.getTime());

    await enSql(org, "UPDATE $S.documents SET revue_le = revue_le - interval '700 days' WHERE id = $1", [d.id]);
    expect(await cleErreur(decider(org, d.id, "confirmer_revue", redac))).toBe("erreur.interdit");
    expect(await cleErreur(decider(org, d.id, "confirmer_revue", verif))).toBe("erreur.interdit");
    expect(await decider(org, d.id, "confirmer_revue", appro, "Toujours adapté.")).toEqual({ etat: "publie" });
    const apres = (await lireCircuit(app, org.cible, d.id))!;
    expect(apres).toMatchObject({ etat: "publie", version: 1, versionPubliee: 1 });
    expect(Date.now() - apres.revueLe!.getTime()).toBeLessThan(60_000);
    expect(apres.publieLe!.getTime()).toBe(publie.publieLe!.getTime()); // la publication ne change pas
    expect(apres.decisions[0]).toMatchObject({ transition: "confirmer_revue", etatAvant: "publie", etatApres: "publie", motif: "Toujours adapté." });
    const trace = (await lireJournalOrganisation(app, org.cible, { page: 1 })).lignes.find((l) => l.action === "DOCUMENT_REVUE_CONFIRMEE");
    expect(trace?.details).toMatchObject({ transition: "confirmer_revue", motif: "Toujours adapté." });
  });

  it("réglages : valeurs par défaut, modification tracée, refus hors bornes (service et base)", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const admin = adminDe(org);
    expect(await lireParametresOrganisation(app, org.cible)).toMatchObject({ periodeRevueMois: 24, rappelJours: 30, escaladeJours: 30, modifieLe: null });
    await modifierParametres(app, org.cible, { periodeRevueMois: 12, rappelJours: 15, escaladeJours: 10 }, admin);
    expect(await lireParametresOrganisation(app, org.cible)).toMatchObject({ periodeRevueMois: 12, rappelJours: 15, escaladeJours: 10, modifieParNom: "Admin" });
    const ligne = (await lireJournalOrganisation(app, org.cible, { page: 1 })).lignes.find((l) => l.action === "PARAMETRES_MODIFIES");
    expect(ligne?.details).toEqual({ avant: { periodeRevueMois: 24, rappelJours: 30, escaladeJours: 30 }, apres: { periodeRevueMois: 12, rappelJours: 15, escaladeJours: 10 } });
    expect((await lireJournalPlateforme(app, { page: 1 })).lignes.some((l) => l.action === "PARAMETRES_MODIFIES" && l.cibleId === org.organisationId)).toBe(true);
    for (const [p, cle] of [
      [{ periodeRevueMois: 0, rappelJours: 15, escaladeJours: 10 }, "parametres.erreur.periodeRevueMois"],
      [{ periodeRevueMois: 12, rappelJours: 366, escaladeJours: 10 }, "parametres.erreur.rappelJours"],
      [{ periodeRevueMois: 12, rappelJours: 15, escaladeJours: Number.NaN }, "parametres.erreur.escaladeJours"],
    ] as const) expect(await cleErreur(modifierParametres(app, org.cible, p, admin))).toBe(cle);
    expect(await lireParametresOrganisation(app, org.cible)).toMatchObject({ periodeRevueMois: 12, rappelJours: 15, escaladeJours: 10 });
    const refus = (sql: string) => codeErreur(avecOrganisation(app, org.cible, (c) => c.query(sql)));
    expect(await refus("UPDATE parametres SET periode_revue_mois = 500")).toBe("23514");
    expect(await refus("DELETE FROM parametres")).toBe("42501");
    expect(await refus("INSERT INTO parametres (id) VALUES (2)")).toBe("42501");
    expect(await refus("UPDATE notifications SET details = '{}'::jsonb")).toBe("42501");
    expect(await refus("UPDATE notifications SET destinataire = gen_random_uuid()")).toBe("42501");
  });
});

describe("tâches quotidiennes", () => {
  it("rappel, retard puis escalade d'une revue : une seule fois chacun, aux bonnes personnes ; ménage des notifications lues", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const [redac, verif, appro] = [await membre(org, "Redac", "REDACTEUR"), await membre(org, "Verif", "VERIFICATEUR"), await membre(org, "Appro", "APPROBATEUR")];
    const admin = adminDe(org);
    const d = await creerDocument(app, org.cible, procedure("Échéance"), redac);
    for (const [t, p] of [["soumettre", redac], ["verifier", verif], ["approuver", appro]] as const) await decider(org, d.id, t, p);
    // Dernière approbation le 10/01/2024 : revue due le 10/01/2026 (24 mois).
    await enSql(org, "UPDATE $S.documents SET revue_le = '2024-01-10T10:00:00Z' WHERE id = $1", [d.id]);
    const jour = (j: string) => executerTachesQuotidiennes(app, { fuseau: "UTC", maintenant: new Date(`${j}T06:00:00Z`) });
    const revues = async (p: Personne) => (await listerNotifications(app, org.cible, p.id)).filter((n) => n.nature.startsWith("revue_")).map((n) => [n.nature, n.details.echeance, n.details.jours ?? null]);

    const b0 = await jour("2025-12-01"); // 40 jours avant : rien
    expect(b0.aujourdhui).toBe("2025-12-01");
    expect(await revues(appro)).toEqual([]);
    await jour("2025-12-20"); // dans les 30 jours : rappel aux approbateurs
    await jour("2025-12-21");
    expect(await revues(appro)).toEqual([["revue_proche", "2026-01-10", null]]);
    for (const p of [redac, verif, admin]) expect(await revues(p), p.nom).toEqual([]);
    await jour("2026-01-11"); // en retard
    await jour("2026-01-12");
    expect(await revues(appro)).toEqual([["revue_retard", "2026-01-10", null], ["revue_proche", "2026-01-10", null]]);
    expect(await revues(admin)).toEqual([]);
    await jour("2026-02-09"); // 30 jours de retard : escalade aux administrateurs
    await jour("2026-02-20");
    expect(await revues(admin)).toEqual([["revue_escalade", "2026-01-10", 30]]);
    expect(await revues(appro)).toHaveLength(2);

    // Revue confirmée : nouvelle échéance, plus aucun rappel pour l'ancienne.
    await decider(org, d.id, "confirmer_revue", appro);
    const apres = await jour("2026-10-13");
    expect(apres.erreurs.filter((e) => e.organisationId === org.organisationId)).toEqual([]);
    expect(await revues(appro)).toHaveLength(2);

    // Ménage : une notification LUE depuis plus de 180 jours disparaît ; une non lue reste.
    await marquerLues(app, org.cible, admin.id, "toutes");
    await enSql(org, "UPDATE $S.notifications SET lue_le = now() - interval '200 days' WHERE destinataire = $1", [admin.id]);
    const menage = await jour("2026-10-14");
    expect(menage.purgees).toBeGreaterThanOrEqual(1);
    expect(await revues(admin)).toEqual([]);
    expect(await revues(appro)).toHaveLength(2);
  });

  it("sans approbateur, les administrateurs sont prévenus ; organisation suspendue ignorée ; une organisation en erreur n'arrête pas les autres", async () => {
    const seule = await creerOrgDeTest(app, proprietaire, superadmin);
    const suspendue = await creerOrgDeTest(app, proprietaire, superadmin);
    const cassee = await creerOrgDeTest(app, proprietaire, superadmin);
    for (const org of [seule, suspendue]) {
      const id = (await creerDocument(app, org.cible, procedure("Sans approbateur"), adminDe(org))).id;
      await enSql(org, "UPDATE $S.documents SET etat = 'publie', version_publiee = 1, publie_le = '2024-01-10T10:00:00Z', revue_le = '2024-01-10T10:00:00Z' WHERE id = $1", [id]);
    }
    await enTransaction(proprietaire, (c) => c.query("UPDATE platform.organisations SET statut = 'suspendue' WHERE id = $1", [suspendue.organisationId]));
    await enSql(cassee, "DELETE FROM $S.parametres");
    try {
      const bilan = await executerTachesQuotidiennes(app, { fuseau: "UTC", maintenant: new Date("2026-01-11T06:00:00Z") });
      expect(bilan.erreurs.map((e) => e.organisationId)).toEqual([cassee.organisationId]);
      expect((await listerNotifications(app, seule.cible, seule.adminId)).map((n) => n.nature)).toEqual(["revue_retard"]);
      expect(await listerNotifications(app, suspendue.cible, suspendue.adminId)).toEqual([]);
    } finally {
      await enSql(cassee, "INSERT INTO $S.parametres (id) VALUES (1)");
      await enTransaction(proprietaire, (c) => c.query("UPDATE platform.organisations SET statut = 'active' WHERE id = $1", [suspendue.organisationId]));
    }
  });
});
