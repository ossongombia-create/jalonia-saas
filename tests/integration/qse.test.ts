// QSE (Q1) sur une vraie base : registres tirés des documents (version publiée / en cours, valeurs inattendues
// ignorées), plan d'actions (contrôles, avancement, verrou optimiste, journal, notifications), objectifs et mesures des
// indicateurs, tableau de bord, échéances des actions, droits PostgreSQL et étanchéité.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { appliquerTransition, type Transition } from "../../src/server/documents/circuit";
import { creerDocument, enregistrerDocument, lireDocument, supprimerDocument, type Contenu } from "../../src/server/documents/service";
import { lireIndicateurs, lireOpportunites, lireRisques } from "../../src/server/qse/registres";
import { creerAction, historiqueAction, lireAction, listerActions, modifierAction, type ModificationAction } from "../../src/server/qse/actions";
import { definirObjectif, dernieresMesures, enregistrerMesure, listerMesures, lireObjectif, supprimerMesure } from "../../src/server/qse/indicateurs";
import { lireRegistreIndicateurs } from "../../src/server/qse/vues";
import { lireTableauDeBord } from "../../src/server/qse/tableau";
import { listerNotifications } from "../../src/server/notifications/service";
import { executerTachesQuotidiennes } from "../../src/server/taches/quotidiennes";
import { lireJournalOrganisation, lireJournalPlateforme } from "../../src/server/consultation/service";
import { avecOrganisation, enTransaction } from "../../src/server/db/transactions";
import type { RoleOrganisation } from "../../src/lib/rbac";
import type { Acteur } from "../../src/server/acteur";
import { cleErreur, codeErreur, creerOrgDeTest, creerSuperadmin, membreDeTest, ouvrirPools, secondFacteurDeTest, suffixe, type OrgDeTest } from "./outils";

let app: Pool;
let proprietaire: Pool;
let superadmin: Acteur;

beforeAll(async () => {
  ({ app, proprietaire } = ouvrirPools());
  superadmin = await creerSuperadmin(proprietaire);
  await secondFacteurDeTest(proprietaire, [appro]); // approuver exige un second facteur actif (décision n° 4)
});

afterAll(async () => {
  await app.end();
  await proprietaire.end();
});

type Personne = Acteur & { roles: RoleOrganisation[] };
async function membre(org: OrgDeTest, nom: string, ...roles: RoleOrganisation[]): Promise<Personne> {
  const email = `${nom.toLowerCase()}-${suffixe()}@test.local`;
  return { id: await membreDeTest(app, org.cible, { email, nom, roles }, superadmin), email, nom, ip: "127.0.0.1", agent: "vitest", roles };
}
const fictif = (nom: string, ...roles: RoleOrganisation[]): Personne => ({ id: randomUUID(), email: `${nom}-${suffixe()}@test.local`, nom, roles });
const redac = fictif("Redac", "REDACTEUR");
const verif = fictif("Verif", "VERIFICATEUR");
const appro = fictif("Appro", "APPROBATEUR");

async function decider(org: OrgDeTest, id: string, t: Transition, p: Personne, motif = "") {
  const v = (await lireDocument(app, org.cible, id))!.version;
  return appliquerTransition(app, org.cible, id, t, { motif, versionVue: v, roles: p.roles, fonction: "Responsable QSE" }, p);
}
async function publier(org: OrgDeTest, id: string) {
  for (const [t, p] of [["soumettre", redac], ["verifier", verif], ["approuver", appro]] as const) await decider(org, id, t, p);
}

/** Une procédure avec des risques, des opportunités, des indicateurs — et des valeurs inattendues (ignorées). */
const procedure = (variante = 1): Contenu => ({
  meta: { typeDocument: "procedure", titre: "Maîtriser les achats", reference: "PR-QSE-01" },
  roles: [],
  etapes: [
    {
      id: "e1", libelle: "Choisir le fournisseur",
      risques: [
        { id: "k1", risque: "Fournisseur non qualifié", causes: "Urgence", gravite: "4", probabilite: "1", mesure: "Liste agréée" },
        { id: "k2", risque: "Prix hors budget", gravite: 2, probabilite: 3, mesure: "Trois devis" },
        { id: "k3", risque: "Non coté", gravite: "", probabilite: "9" },
        { risque: "Sans identifiant (ignoré)" },
        "pas un objet",
        { id: ["k4"], risque: "identifiant non textuel (ignoré)" },
        { id: "k5", risque: 42, mesure: { texte: "objet" } },
      ],
      opportunites: [{ id: "o1", opportunite: "Achats groupés", benefice: "-10 %", interet: "3", faisabilite: "2" }, { id: "o2", opportunite: "À étudier", interet: "1", faisabilite: "1" }],
      indicateur: { actif: true, nom: "Délai de commande", formule: "jours", cible: "≤ 5 j", frequence: "Mensuelle" },
    },
    { id: "e2", libelle: "Commander", indicateur: { actif: "true", nom: "Faux actif (ignoré)" }, risques: { id: "x" } },
    { id: "e3", libelle: "Réceptionner", indicateur: { actif: true, nom: "Taux de conformité" }, ...(variante === 2 ? { risques: [{ id: "k9", risque: "Nouveau risque", gravite: "3", probabilite: "3" }] } : {}) },
    "étape invalide",
    { libelle: "étape sans identifiant", risques: [{ id: "k8", risque: "ignoré" }] },
  ],
});

describe("registres tirés des documents", () => {
  it("version publiée (par défaut) ou en cours ; cotation calculée ; valeurs inattendues ignorées ; archivés et corbeille exclus", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const d = await creerDocument(app, org.cible, procedure(), redac);
    const lire = <T>(f: (c: import("pg").PoolClient) => Promise<T>) => avecOrganisation(app, org.cible, f);
    expect(await lire((c) => lireRisques(c, "publies"))).toEqual([]);
    expect((await lire((c) => lireRisques(c, "tous"))).map((r) => [r.id, r.publiee])).toEqual([["k1", false], ["k2", false], ["k3", false], ["k5", false]]);

    await publier(org, d.id);
    const risques = await lire((c) => lireRisques(c, "publies"));
    expect(risques.map((r) => [r.id, r.risque, r.gravite, r.probabilite, r.criticite, r.niveau, r.etapeRang, r.etapeLibelle, r.version, r.publiee])).toEqual([
      ["k1", "Fournisseur non qualifié", 4, 1, 4, "critique", 1, "Choisir le fournisseur", 1, true],
      ["k2", "Prix hors budget", 2, 3, 6, "significatif", 1, "Choisir le fournisseur", 1, true],
      ["k3", "Non coté", null, null, null, null, 1, "Choisir le fournisseur", 1, true],
      ["k5", "", null, null, null, null, 1, "Choisir le fournisseur", 1, true],
    ]);
    expect(risques[4 - 1]!.mesure).toBe("");
    expect((await lire((c) => lireOpportunites(c, "publies"))).map((o) => [o.id, o.score, o.suite])).toEqual([["o1", 6, "plan"], ["o2", 1, "etudier"]]);
    expect((await lire((c) => lireIndicateurs(c, "publies"))).map((i) => [i.id, i.nom, i.cible, i.frequence])).toEqual([
      ["e1", "Délai de commande", "≤ 5 j", "Mensuelle"], ["e3", "Taux de conformité", "", ""],
    ]);

    // Révision : la version publiée fait foi ; la version en cours montre le nouveau risque.
    await decider(org, d.id, "reviser", redac);
    await enregistrerDocument(app, org.cible, d.id, { contenu: procedure(2), version: 1 }, redac);
    expect((await lire((c) => lireRisques(c, "publies"))).map((r) => r.id)).toEqual(["k1", "k2", "k3", "k5"]);
    expect((await lire((c) => lireRisques(c, "tous"))).map((r) => [r.id, r.version, r.publiee])).toEqual([["k1", 2, false], ["k2", 2, false], ["k3", 2, false], ["k5", 2, false], ["k9", 2, false]]);

    // Archivé : hors registres. Une instruction de travail (niveau 3) n'y entre pas non plus.
    await decider(org, d.id, "soumettre", redac);
    await decider(org, d.id, "verifier", verif);
    await decider(org, d.id, "approuver", appro);
    await decider(org, d.id, "archiver", appro, "Remplacée");
    const it = await creerDocument(app, org.cible, { ...procedure(), meta: { typeDocument: "instruction", titre: "IT", reference: "IT-1" } }, redac);
    for (const portee of ["publies", "tous"] as const) expect(await lire((c) => lireRisques(c, portee)), portee).toEqual([]);
    await supprimerDocument(app, org.cible, it.id, redac);
    const autre = await creerDocument(app, org.cible, procedure(), redac);
    await supprimerDocument(app, org.cible, autre.id, redac);
    expect(await lire((c) => lireRisques(c, "tous"))).toEqual([]);
  });
});

describe("plan d'actions", () => {
  it("création : contrôles, responsable membre actif, élément lu dans le document, notification, journal", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const autre = await creerOrgDeTest(app, proprietaire, superadmin);
    const [pilote, resp] = [await membre(org, "Pilote", "REDACTEUR"), await membre(org, "Resp", "LECTEUR")];
    const etranger = await membre(autre, "Etranger", "REDACTEUR");
    const d = await creerDocument(app, org.cible, procedure(), redac);
    const docAutre = await creerDocument(app, autre.cible, procedure(), redac);
    const base = { titre: "Qualifier le fournisseur", description: "Audit fournisseur", origine: "risque", responsableId: resp.id, echeance: "2026-12-31" };

    for (const [e, cle] of [
      [{ ...base, titre: " " }, "actions.erreur.titre"],
      [{ ...base, origine: "inconnue" }, "actions.erreur.origine"],
      [{ ...base, echeance: "31/12/2026" }, "actions.erreur.echeance"],
      [{ ...base, responsableId: etranger.id }, "actions.erreur.responsable"],
      [{ ...base, responsableId: randomUUID() }, "actions.erreur.responsable"],
      [{ ...base, documentId: docAutre.id }, "actions.erreur.document"],
      [{ ...base, documentId: d.id, elementId: "k-inexistant" }, "actions.erreur.document"],
      [{ ...base, elementId: "k1" }, "actions.erreur.document"],
    ] as const) expect(await cleErreur(creerAction(app, org.cible, e, pilote)), cle).toBe(cle);
    expect(await listerActions(app, org.cible)).toEqual([]);

    const a = await creerAction(app, org.cible, { ...base, documentId: d.id, elementId: "k1" }, pilote);
    const lue = (await lireAction(app, org.cible, a.id))!;
    expect(lue).toMatchObject({ numero: a.numero, titre: "Qualifier le fournisseur", origine: "risque", documentId: d.id, documentReference: "PR-QSE-01", elementId: "k1",
      elementLibelle: "Fournisseur non qualifié", responsable: resp.id, responsableNom: "Resp", echeance: "2026-12-31", statut: "a_faire", version: 1, efficace: null, creeParNom: "Pilote" });
    expect((await listerNotifications(app, org.cible, resp.id)).map((n) => [n.nature, n.actionId, n.details.titre, n.details.par, n.details.echeance]))
      .toEqual([["action_confiee", a.id, "Qualifier le fournisseur", "Pilote", "2026-12-31"]]);
    // Se confier une action à soi-même : pas de notification.
    await creerAction(app, org.cible, { ...base, responsableId: pilote.id }, pilote);
    expect(await listerNotifications(app, org.cible, pilote.id)).toEqual([]);
    const ligne = (await lireJournalOrganisation(app, org.cible, { page: 1 })).lignes.find((l) => l.action === "ACTION_CREEE" && l.cibleId === a.id);
    expect(ligne?.details).toMatchObject({ numero: a.numero, titre: "Qualifier le fournisseur", origine: "risque", responsable: "Resp", documentId: d.id, elementId: "k1" });
    const plateforme = (await lireJournalPlateforme(app, { page: 1 })).lignes.find((l) => l.action === "ACTION_CREEE" && l.cibleId === a.id);
    expect(plateforme?.details).toEqual({ origine: "risque" });
    // Étanchéité.
    expect(await lireAction(app, autre.cible, a.id)).toBeNull();
    expect(await listerActions(app, autre.cible)).toEqual([]);
  });

  it("avancement : verrou optimiste, statuts permis, clôture avec efficacité, abandon motivé, historique des changements, réattribution notifiée", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const [pilote, r1, r2] = [await membre(org, "Pilote", "REDACTEUR"), await membre(org, "R1", "REDACTEUR"), await membre(org, "R2", "VERIFICATEUR")];
    const a = await creerAction(app, org.cible, { titre: "Former", description: "", origine: "audit", responsableId: r1.id, echeance: null }, pilote);
    const m = (version: number, x: Partial<ModificationAction> = {}): ModificationAction => ({
      titre: "Former", description: "", origine: "audit", responsableId: r1.id, echeance: null, version, statut: "a_faire", resultat: "", efficace: null, ...x,
    });
    expect(await modifierAction(app, org.cible, a.id, m(1), pilote, pilote.roles)).toEqual({ version: 1, statut: "a_faire" }); // rien de changé
    expect(await historiqueAction(app, org.cible, a.id)).toHaveLength(1);
    expect(await cleErreur(modifierAction(app, org.cible, a.id, m(1, { statut: "cloturee", efficace: true }), pilote, pilote.roles))).toBe("actions.statut_impossible");
    expect(await modifierAction(app, org.cible, a.id, m(1, { statut: "en_cours", echeance: "2026-11-30", responsableId: r2.id }), pilote, pilote.roles)).toEqual({ version: 2, statut: "en_cours" });
    expect(await cleErreur(modifierAction(app, org.cible, a.id, m(1, { statut: "realisee" }), pilote, pilote.roles))).toBe("actions.modifiee");
    expect((await listerNotifications(app, org.cible, r2.id)).map((n) => n.nature)).toEqual(["action_confiee"]);
    await modifierAction(app, org.cible, a.id, m(2, { statut: "realisee", echeance: "2026-11-30", responsableId: r2.id, resultat: "Formation faite" }), r2, r2.roles);
    expect(await cleErreur(modifierAction(app, org.cible, a.id, m(3, { statut: "cloturee", echeance: "2026-11-30", responsableId: r2.id }), pilote, pilote.roles))).toBe("actions.efficacite_requise");
    const close = await modifierAction(app, org.cible, a.id, m(3, { statut: "cloturee", echeance: "2026-11-30", responsableId: r2.id, resultat: "Vérifié en audit", efficace: true }), pilote, pilote.roles);
    expect(close).toEqual({ version: 4, statut: "cloturee" });
    const lue = (await lireAction(app, org.cible, a.id))!;
    expect(lue).toMatchObject({ statut: "cloturee", efficace: true, resultat: "Vérifié en audit" });
    expect(lue.clotureLe).toBeInstanceOf(Date);
    expect(await cleErreur(modifierAction(app, org.cible, a.id, m(4, { statut: "cloturee", efficace: true, titre: "Changé" }), pilote, pilote.roles))).toBe("actions.definitive");
    expect(await cleErreur(modifierAction(app, org.cible, a.id, m(4, { statut: "en_cours" }), pilote, pilote.roles))).toBe("actions.definitive");

    const h = await historiqueAction(app, org.cible, a.id);
    expect(h.map((x) => x.action)).toEqual(["ACTION_CLOTUREE", "ACTION_MODIFIEE", "ACTION_MODIFIEE", "ACTION_CREEE"]);
    expect(h[2]!.changements).toEqual({ responsable: { avant: "R1", apres: "R2" }, echeance: { avant: null, apres: "2026-11-30" }, statut: { avant: "a_faire", apres: "en_cours" } });
    expect(h[0]!.changements).toMatchObject({ statut: { avant: "realisee", apres: "cloturee" }, efficace: { avant: null, apres: true } });

    const b = await creerAction(app, org.cible, { titre: "Autre", description: "", origine: "autre", responsableId: null, echeance: null }, pilote);
    const mb = { titre: "Autre", description: "", origine: "autre", responsableId: null, echeance: null, version: 1, statut: "abandonnee", resultat: " ", efficace: null };
    expect(await cleErreur(modifierAction(app, org.cible, b.id, mb, pilote, pilote.roles))).toBe("actions.motif_abandon");
    expect(await modifierAction(app, org.cible, b.id, { ...mb, resultat: "Plus d'objet" }, pilote, pilote.roles)).toEqual({ version: 2, statut: "abandonnee" });
    expect((await historiqueAction(app, org.cible, b.id))[0]!.action).toBe("ACTION_ABANDONNEE");
    expect((await listerActions(app, org.cible, { statut: "ouvertes" })).map((x) => x.id)).toEqual([]);
    expect((await listerActions(app, org.cible, { statut: "toutes" })).map((x) => x.id).sort()).toEqual([a.id, b.id].sort());
  });

  it("droits PostgreSQL : pas de suppression d'action ; contraintes de cohérence (clôture ⇔ efficacité)", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const a = await creerAction(app, org.cible, { titre: "X", description: "", origine: "autre", responsableId: null, echeance: null }, redac);
    const refus = (sql: string) => codeErreur(avecOrganisation(app, org.cible, (c) => c.query(sql, [])));
    expect(await refus("DELETE FROM actions")).toBe("42501");
    expect(await refus("UPDATE actions SET cree_par_nom = 'faux'")).toBe("42501");
    expect(await refus("UPDATE actions SET statut = 'cloturee'")).toBe("23514");
    expect(await refus("UPDATE actions SET efficace = true")).toBe("23514");
    expect(await refus("UPDATE actions SET statut = 'abandonnee'")).toBe("23514"); // sans date de clôture
    expect(await refus("UPDATE mesures_indicateur SET document_id = gen_random_uuid()")).toBe("42501");
    expect((await lireAction(app, org.cible, a.id))?.statut).toBe("a_faire");
  });
});

describe("séparation dans le plan d'actions (décision n° 5 du 19/10/2026)", () => {
  /** Avancement seul (formulaire réduit du responsable) : les champs réservés à actions.gerer sont absents. */
  const avancer = (version: number, statut: string, resultat = "", efficace: boolean | null = null): ModificationAction => ({ version, statut, resultat, efficace });

  it("un lecteur responsable fait avancer SON action et en écrit le compte rendu, sans toucher au reste", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const [pilote, lecteur, autre] = [await membre(org, "Pilote", "REDACTEUR"), await membre(org, "Lect", "LECTEUR"), await membre(org, "Autre", "LECTEUR")];
    const a = await creerAction(app, org.cible, { titre: "Baliser la zone", description: "d", origine: "risque", responsableId: lecteur.id, echeance: "2026-12-31" }, pilote);
    expect(await modifierAction(app, org.cible, a.id, avancer(1, "en_cours"), lecteur, lecteur.roles)).toEqual({ version: 2, statut: "en_cours" });
    expect(await modifierAction(app, org.cible, a.id, avancer(2, "realisee", "Balisage posé"), lecteur, lecteur.roles)).toEqual({ version: 3, statut: "realisee" });
    expect(await modifierAction(app, org.cible, a.id, avancer(3, "en_cours", "Une balise manque"), lecteur, lecteur.roles)).toEqual({ version: 4, statut: "en_cours" });
    // Les mêmes valeurs renvoyées (formulaire complet forgé) ne changent rien : acceptées.
    const memes = { titre: "Baliser la zone", description: "d", origine: "risque", responsableId: lecteur.id, echeance: "2026-12-31" };
    expect(await modifierAction(app, org.cible, a.id, { ...memes, ...avancer(4, "realisee", "Balisage complet") }, lecteur, lecteur.roles)).toEqual({ version: 5, statut: "realisee" });
    const lue = (await lireAction(app, org.cible, a.id))!;
    expect(lue).toMatchObject({ ...{ titre: "Baliser la zone", description: "d", origine: "risque", responsable: lecteur.id, echeance: "2026-12-31" }, statut: "realisee", resultat: "Balisage complet", modifieParNom: "Lect" });
    const h = await historiqueAction(app, org.cible, a.id);
    expect(h[0]).toMatchObject({ action: "ACTION_MODIFIEE", acteurEmail: lecteur.email });

    // Ni l'action d'un autre…
    const b = await creerAction(app, org.cible, { titre: "Autre", description: "", origine: "autre", responsableId: autre.id, echeance: null }, pilote);
    expect(await cleErreur(modifierAction(app, org.cible, b.id, avancer(1, "en_cours"), lecteur, lecteur.roles))).toBe("erreur.interdit");
    // … ni la clôture ou l'abandon de la sienne…
    expect(await cleErreur(modifierAction(app, org.cible, a.id, avancer(5, "cloturee", "Vérifié", true), lecteur, lecteur.roles))).toBe("actions.cloture_responsable");
    expect(await cleErreur(modifierAction(app, org.cible, a.id, avancer(5, "abandonnee", "Plus d'objet"), lecteur, lecteur.roles))).toBe("actions.cloture_responsable");
    // … ni l'intitulé, la description, l'origine, le responsable ou l'échéance.
    for (const champ of [{ titre: "Autre titre" }, { description: "autre" }, { origine: "audit" }, { responsableId: autre.id }, { responsableId: null }, { echeance: "2027-01-31" }, { echeance: null }]) {
      expect(await cleErreur(modifierAction(app, org.cible, a.id, { ...avancer(5, "realisee", "Balisage complet"), ...champ }, lecteur, lecteur.roles)), JSON.stringify(champ)).toBe("actions.reserve_gestion");
    }
    // Rien n'a bougé après ces refus.
    expect((await lireAction(app, org.cible, a.id))).toMatchObject({ version: 5, statut: "realisee", titre: "Baliser la zone", responsable: lecteur.id });
    expect((await lireAction(app, org.cible, b.id))).toMatchObject({ version: 1, statut: "a_faire" });
    // Sans responsable : un lecteur ne peut rien.
    const c = await creerAction(app, org.cible, { titre: "Sans responsable", description: "", origine: "autre", responsableId: null, echeance: null }, pilote);
    expect(await cleErreur(modifierAction(app, org.cible, c.id, avancer(1, "en_cours"), lecteur, lecteur.roles))).toBe("erreur.interdit");
  });

  it("un gestionnaire responsable ne clôt ni n'abandonne son action ; une autre personne ayant actions.gerer le fait ; l'auteur est tracé", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const [pilote, verif2, admin] = [await membre(org, "Pilote", "REDACTEUR"), await membre(org, "Verif2", "VERIFICATEUR"), await membre(org, "Admin2", "ADMIN_ORGANISATION")];
    const base = { titre: "Former", description: "", origine: "audit", responsableId: pilote.id, echeance: null };
    const a = await creerAction(app, org.cible, base, pilote);
    expect(await modifierAction(app, org.cible, a.id, { ...base, ...avancer(1, "realisee", "Fait") }, pilote, pilote.roles)).toEqual({ version: 2, statut: "realisee" });
    expect(await cleErreur(modifierAction(app, org.cible, a.id, { ...base, ...avancer(2, "cloturee", "Vérifié", true) }, pilote, pilote.roles))).toBe("actions.cloture_responsable");
    expect(await cleErreur(modifierAction(app, org.cible, a.id, { ...base, ...avancer(2, "abandonnee", "Plus d'objet") }, pilote, pilote.roles))).toBe("actions.cloture_responsable");
    // Se retirer la responsabilité (ou la donner à un autre) dans la même modification ne contourne pas la règle.
    expect(await cleErreur(modifierAction(app, org.cible, a.id, { ...base, responsableId: verif2.id, ...avancer(2, "cloturee", "Vérifié", true) }, pilote, pilote.roles))).toBe("actions.cloture_responsable");
    // … ni s'en donner la responsabilité pour la clore.
    expect(await cleErreur(modifierAction(app, org.cible, a.id, { ...base, responsableId: verif2.id, ...avancer(2, "cloturee", "Vérifié", true) }, verif2, verif2.roles))).toBe("actions.cloture_responsable");
    expect((await lireAction(app, org.cible, a.id))).toMatchObject({ statut: "realisee", version: 2, clotureParNom: "" });

    expect(await modifierAction(app, org.cible, a.id, { ...base, ...avancer(2, "cloturee", "Vérifié en audit", true) }, verif2, verif2.roles)).toEqual({ version: 3, statut: "cloturee" });
    const close = (await lireAction(app, org.cible, a.id))!;
    expect(close).toMatchObject({ statut: "cloturee", efficace: true, clotureParNom: "Verif2", modifieParNom: "Verif2" });
    const enBase = await enTransaction(proprietaire, (c) => c.query<{ cloture_par: string }>(`SELECT cloture_par FROM ${org.cible.schemaName}.actions WHERE id = $1`, [a.id]));
    expect(enBase.rows[0]!.cloture_par).toBe(verif2.id);
    const ligne = (await lireJournalOrganisation(app, org.cible, { page: 1 })).lignes.find((l) => l.action === "ACTION_CLOTUREE" && l.cibleId === a.id);
    expect(ligne?.acteurEmail).toBe(verif2.email);

    // L'abandon suit la même règle : refusé au responsable, permis à une autre personne ayant actions.gerer.
    const b = await creerAction(app, org.cible, { ...base, responsableId: verif2.id }, pilote);
    const bBase = { ...base, responsableId: verif2.id };
    expect(await cleErreur(modifierAction(app, org.cible, b.id, { ...bBase, ...avancer(1, "abandonnee", "Plus d'objet") }, verif2, verif2.roles))).toBe("actions.cloture_responsable");
    expect(await modifierAction(app, org.cible, b.id, { ...bBase, ...avancer(1, "abandonnee", "Plus d'objet") }, admin, admin.roles)).toEqual({ version: 2, statut: "abandonnee" });
    expect((await lireAction(app, org.cible, b.id))).toMatchObject({ statut: "abandonnee", clotureParNom: "Admin2" });
  });

  it("la base refuse elle aussi une clôture par le responsable, et un auteur de clôture sur une action ouverte", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const resp = await membre(org, "Resp", "REDACTEUR");
    const a = await creerAction(app, org.cible, { titre: "X", description: "", origine: "autre", responsableId: resp.id, echeance: null }, redac);
    const refus = (sql: string) => codeErreur(avecOrganisation(app, org.cible, (c) => c.query(sql, [])));
    expect(await refus(`UPDATE actions SET cloture_par = '${resp.id}'`)).toBe("23514"); // action ouverte
    expect(await refus(`UPDATE actions SET statut = 'abandonnee', cloture_le = now(), cloture_par = '${resp.id}'`)).toBe("23514"); // son responsable
    expect(await refus("UPDATE actions SET cloture_par_nom = repeat('x', 201)")).toBe("23514");
    expect((await lireAction(app, org.cible, a.id))?.statut).toBe("a_faire");
  });
});

describe("objectifs et mesures des indicateurs", () => {
  it("objectif chiffré, mesures datées (correction le même jour), suppression ; tout est tracé ; situation", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const d = await creerDocument(app, org.cible, procedure(), redac);
    await publier(org, d.id);
    const pilote = fictif("Pilote", "APPROBATEUR");
    for (const [s, cle] of [
      [{ sens: "egal", seuil: "5", unite: "j" }, "indicateurs.erreur.sens"],
      [{ sens: "max", seuil: "cinq", unite: "j" }, "indicateurs.erreur.nombre"],
      [{ sens: "max", seuil: "5", unite: "x".repeat(31) }, "indicateurs.erreur.unite"],
    ] as const) expect(await cleErreur(definirObjectif(app, org.cible, d.id, "e1", s, pilote)), cle).toBe(cle);
    expect(await cleErreur(definirObjectif(app, org.cible, d.id, "e2", { sens: "max", seuil: "5", unite: "" }, pilote))).toBe("indicateurs.introuvable"); // actif « "true" » : pas un indicateur
    expect(await cleErreur(definirObjectif(app, org.cible, d.id, "zz", { sens: "max", seuil: "5", unite: "" }, pilote))).toBe("indicateurs.introuvable");
    await definirObjectif(app, org.cible, d.id, "e1", { sens: "max", seuil: "5,5", unite: "j" }, pilote);
    expect(await lireObjectif(app, org.cible, d.id, "e1")).toMatchObject({ sens: "max", seuil: 5.5, unite: "j", modifieParNom: "Pilote" });

    const jour = "2026-10-13";
    for (const [s, cle] of [
      [{ date: "2026-10-14", valeur: "4", commentaire: "" }, "indicateurs.erreur.date"],
      [{ date: "2010-01-01", valeur: "4", commentaire: "" }, "indicateurs.erreur.date"],
      [{ date: "2026-02-30", valeur: "4", commentaire: "" }, "indicateurs.erreur.date"],
      [{ date: "2026-10-01", valeur: "4 jours", commentaire: "" }, "indicateurs.erreur.nombre"],
      [{ date: "2026-10-01", valeur: "4", commentaire: "x".repeat(1001) }, "indicateurs.erreur.commentaire"],
    ] as const) expect(await cleErreur(enregistrerMesure(app, org.cible, d.id, "e1", s, jour, pilote)), cle).toBe(cle);
    expect(await enregistrerMesure(app, org.cible, d.id, "e1", { date: "2026-09-30", valeur: "6", commentaire: "Septembre" }, jour, pilote)).toEqual({ corrigee: false });
    expect(await enregistrerMesure(app, org.cible, d.id, "e1", { date: "2026-08-31", valeur: "4,25", commentaire: "" }, jour, pilote)).toEqual({ corrigee: false });
    expect(await enregistrerMesure(app, org.cible, d.id, "e1", { date: "2026-09-30", valeur: "5", commentaire: "Corrigé" }, jour, pilote)).toEqual({ corrigee: true });
    const mesures = await listerMesures(app, org.cible, d.id, "e1");
    expect(mesures.map((x) => [x.date, x.valeur, x.commentaire, x.nom])).toEqual([["2026-09-30", 5, "Corrigé", "Délai de commande"], ["2026-08-31", 4.25, "", "Délai de commande"]]);
    expect(await avecOrganisation(app, org.cible, (c) => dernieresMesures(c))).toEqual(new Map([[`${d.id}:e1`, { date: "2026-09-30", valeur: 5 }]]));
    const registre = await lireRegistreIndicateurs(app, org.cible, "publies");
    expect(registre.map((i) => [i.id, i.situation])).toEqual([["e1", "atteint"], ["e3", "sans_objectif"]]);

    const journal = (await lireJournalOrganisation(app, org.cible, { page: 1 })).lignes;
    const corrigee = journal.find((l) => l.action === "MESURE_INDICATEUR_CORRIGEE");
    expect(corrigee?.details).toMatchObject({ elementId: "e1", date: "2026-09-30", avant: { valeur: 6, commentaire: "Septembre" }, apres: { valeur: 5, commentaire: "Corrigé" } });
    await supprimerMesure(app, org.cible, mesures[0]!.id, pilote);
    expect(await cleErreur(supprimerMesure(app, org.cible, mesures[0]!.id, pilote))).toBe("erreur.introuvable");
    expect((await lireJournalOrganisation(app, org.cible, { page: 1 })).lignes[0]).toMatchObject({ action: "MESURE_INDICATEUR_SUPPRIMEE", details: { date: "2026-09-30", avant: { valeur: 5 } } });
    expect((await lireRegistreIndicateurs(app, org.cible, "publies"))[0]!.situation).toBe("atteint"); // 4,25 ≤ 5,5
    await definirObjectif(app, org.cible, d.id, "e1", null, pilote);
    expect(await lireObjectif(app, org.cible, d.id, "e1")).toBeNull();
    // Étanchéité.
    const autre = await creerOrgDeTest(app, proprietaire, superadmin);
    expect(await listerMesures(app, autre.cible, d.id, "e1")).toEqual([]);
    expect(await cleErreur(enregistrerMesure(app, autre.cible, d.id, "e1", { date: "2026-10-01", valeur: "1", commentaire: "" }, jour, pilote))).toBe("indicateurs.introuvable");
    expect(await cleErreur(supprimerMesure(app, autre.cible, mesures[1]!.id, pilote))).toBe("erreur.introuvable");
  });
});

describe("tableau de bord et échéances des actions", () => {
  it("compte documents, revues, actions, risques, opportunités, indicateurs ; documents à décider ; mes actions", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const [moi, autreVerif] = [await membre(org, "Moi", "VERIFICATEUR"), await membre(org, "AutreVerif", "VERIFICATEUR")];
    const d = await creerDocument(app, org.cible, procedure(), redac);
    await publier(org, d.id);
    const brouillon = await creerDocument(app, org.cible, { meta: { typeDocument: "procedure", titre: "À vérifier", reference: "PR-QSE-02" }, roles: [], etapes: [] }, redac);
    await decider(org, brouillon.id, "soumettre", redac);
    await creerAction(app, org.cible, { titre: "En retard", description: "", origine: "autre", responsableId: moi.id, echeance: "2026-01-01" }, redac);
    await creerAction(app, org.cible, { titre: "À venir", description: "", origine: "autre", responsableId: autreVerif.id, echeance: "2027-01-01" }, redac);
    const tb = await lireTableauDeBord(app, org.cible, { id: moi.id, roles: moi.roles }, "UTC", "2026-10-13");
    expect(tb.documents).toEqual({ brouillon: 0, en_verification: 1, en_approbation: 0, publie: 1, archive: 0 });
    expect(tb.revues).toEqual({ proches: 0, retard: 0 });
    expect(tb.actions).toEqual({ ouvertes: 2, retard: 1, aVerifier: 0 });
    expect(tb.risques).toEqual({ critique: 1, significatif: 1, acceptable: 0, nonCote: 2 });
    expect(tb.opportunites).toEqual({ plan: 1, etudier: 1, nonCote: 0 });
    expect(tb.indicateurs).toEqual({ atteint: 0, non_atteint: 0, sans_mesure: 0, sans_objectif: 2 });
    expect(tb.aDecider.map((x) => x.reference)).toEqual(["PR-QSE-02"]);
    expect(tb.mesActions.map((x) => [x.titre, x.enRetard])).toEqual([["En retard", true]]);
    // Le rédacteur qui a soumis n'a rien à décider.
    expect((await lireTableauDeBord(app, org.cible, { id: redac.id, roles: redac.roles }, "UTC", "2026-10-13")).aDecider).toEqual([]);
  });

  it("tâches quotidiennes : rappel, retard, escalade des actions ouvertes ; actions réalisées ignorées ; sans responsable → administrateurs", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const resp = await membre(org, "Resp", "REDACTEUR");
    const pilote = fictif("Pilote", "REDACTEUR");
    const a = await creerAction(app, org.cible, { titre: "Échéance", description: "", origine: "autre", responsableId: resp.id, echeance: "2026-01-31" }, pilote);
    const b = await creerAction(app, org.cible, { titre: "Sans responsable", description: "", origine: "autre", responsableId: null, echeance: "2026-01-31" }, pilote);
    const c = await creerAction(app, org.cible, { titre: "Réalisée", description: "", origine: "autre", responsableId: resp.id, echeance: "2026-01-31" }, pilote);
    await modifierAction(app, org.cible, c.id, { titre: "Réalisée", description: "", origine: "autre", responsableId: resp.id, echeance: "2026-01-31", version: 1, statut: "realisee", resultat: "", efficace: null }, pilote, pilote.roles);
    const jour = (j: string) => executerTachesQuotidiennes(app, { fuseau: "UTC", maintenant: new Date(`${j}T06:00:00Z`) });
    const de = async (id: string) => (await listerNotifications(app, org.cible, id)).filter((n) => n.nature.startsWith("action_") && n.nature !== "action_confiee").map((n) => [n.nature, n.actionId, n.details.jours ?? null]);
    await jour("2026-01-10");
    expect(await de(resp.id)).toEqual([["action_proche", a.id, null]]);
    expect(await de(org.adminId)).toEqual([["action_proche", b.id, null]]);
    await jour("2026-02-01");
    await jour("2026-02-02");
    expect(await de(resp.id)).toEqual([["action_retard", a.id, null], ["action_proche", a.id, null]]);
    await jour("2026-03-02"); // 30 jours de retard : escalade aux administrateurs
    expect((await de(org.adminId)).filter((x) => x[0] === "action_escalade").map((x) => [x[1], x[2]]).sort()).toEqual([[a.id, 30], [b.id, 30]].sort());
    expect((await de(resp.id)).some((x) => x[1] === c.id)).toBe(false);
  });
});
