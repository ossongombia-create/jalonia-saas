// Binôme d'administration titulaire / suppléant (chantier 2 du 20/10/2026) : création avec suppléant obligatoire,
// suppléant inactif (lecteur) qui ne compte pas comme administrateur, activation, absence et retour du titulaire,
// départ définitif, désignation d'un titulaire pour une organisation existante (B8), alerte des 60 jours, gardes de
// la gestion des membres (G1 à G3), désactivation du dernier administrateur (Q8), réémission refusée tant qu'un
// suppléant est utilisable (B5), co-administrateurs, contraintes en base.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { creerOrganisation } from "../../src/server/organisations/provisionnement";
import { accepterAvecNouveauCompte } from "../../src/server/invitations/service";
import { listerMembres, modifierRoles, retirerMembre } from "../../src/server/membres/service";
import { desactiverUtilisateur, reactiverUtilisateur } from "../../src/server/utilisateurs/service";
import { reemettreInvitationAdmin } from "../../src/server/organisations/reemission";
import {
  activerSuppleant, departTitulaire, inviterSuppleant, lireBinome, marquerTitulaireAbsent, marquerTitulaireRetour,
} from "../../src/server/organisations/binome";
import { alertesAbsence } from "../../src/server/organisations/absences";
import { listerNotifications } from "../../src/server/notifications/service";
import { executerTachesQuotidiennes } from "../../src/server/taches/quotidiennes";
import { enTransaction } from "../../src/server/db/transactions";
import type { Acteur } from "../../src/server/acteur";
import { cleErreur, codeErreur, creerOrgDeTest, creerSuperadmin, MDP_TEST, membreDeTest, ouvrirPools, RESEAU_TEST, suffixe, type OrgDeTest } from "./outils";

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

type Org = OrgDeTest & { suppleantId: string; suppleantEmail: string };

/** Organisation de test dont le suppléant a ACCEPTÉ son invitation (membre, inactif). */
async function orgAvecSuppleant(): Promise<Org> {
  const org = await creerOrgDeTest(app, proprietaire, superadmin);
  const suppleantEmail = (await enTransaction(proprietaire, (c) =>
    c.query<{ email: string }>("SELECT email FROM platform.invitations WHERE id = $1", [org.invitationSuppleant.id]))).rows[0]!.email;
  await accepterAvecNouveauCompte(app, org.invitationSuppleant.jeton, { nom: "Suppléant", motDePasse: MDP_TEST, langue: "fr" }, RESEAU_TEST);
  return { ...org, suppleantId: await idDe(suppleantEmail), suppleantEmail };
}

async function idDe(email: string): Promise<string> {
  return (await enTransaction(proprietaire, (c) => c.query<{ id: string }>("SELECT id FROM platform.utilisateurs WHERE email = $1", [email]))).rows[0]!.id;
}

/** fonction | statut du suppléant | rôles | absent */
async function etat(organisationId: string, utilisateurId: string): Promise<string | undefined> {
  const r = await enTransaction(proprietaire, (c) => c.query<{ e: string }>(
    `SELECT coalesce(fonction_org, '-') || '|' || coalesce(statut_suppleant, '-') || '|' || array_to_string(roles, ',') || '|' || (date_absence_debut IS NOT NULL)::text AS e
       FROM platform.adhesions WHERE organisation_id = $1 AND utilisateur_id = $2`, [organisationId, utilisateurId]));
  return r.rows[0]?.e;
}

async function journalPlateforme(organisationId: string): Promise<{ action: string; details: Record<string, unknown> }[]> {
  return (await enTransaction(proprietaire, (c) => c.query<{ action: string; details: Record<string, unknown> }>(
    "SELECT action, details FROM platform.journal WHERE organisation_id = $1 ORDER BY horodatage, id", [organisationId]))).rows;
}

async function journalOrganisation(org: OrgDeTest): Promise<{ action: string; details: Record<string, unknown> }[]> {
  return (await enTransaction(proprietaire, (c) => c.query<{ action: string; details: Record<string, unknown> }>(
    `SELECT action, details FROM "${org.cible.schemaName}".journal ORDER BY horodatage, id`))).rows;
}

const adresse = () => `p-${suffixe()}@test.local`;

describe("création : suppléant obligatoire, invité en même temps que le titulaire", () => {
  it("deux invitations (titulaire : Administrateur ; suppléant : Lecteur) ; à l'acceptation, fonctions posées ; suppléant inactif", async () => {
    const org = await orgAvecSuppleant();
    const inv = (await enTransaction(proprietaire, (c) => c.query<{ fonction_org: string; roles: string[] }>(
      "SELECT fonction_org, roles FROM platform.invitations WHERE organisation_id = $1 ORDER BY fonction_org", [org.organisationId]))).rows;
    expect(inv).toEqual([{ fonction_org: "suppleant", roles: ["LECTEUR"] }, { fonction_org: "titulaire", roles: ["ADMIN_ORGANISATION"] }]);
    expect(await etat(org.organisationId, org.adminId)).toBe("titulaire|-|ADMIN_ORGANISATION|false");
    expect(await etat(org.organisationId, org.suppleantId)).toBe("suppleant|inactif|LECTEUR|false");
    const binome = await lireBinome(app, org.organisationId);
    expect(binome.titulaire?.id).toBe(org.adminId);
    expect(binome.suppleant).toMatchObject({ id: org.suppleantId, actif: false, compteActif: true });
    expect(binome.invitationSuppleant).toBeNull();
    const membres = await listerMembres(app, org.organisationId);
    expect(membres.find((m) => m.utilisateurId === org.suppleantId)).toMatchObject({ fonction: "suppleant", statutSuppleant: "inactif" });
  });

  it("même adresse pour le titulaire et le suppléant → orgs.suppleant_meme_adresse (rien n'est créé)", async () => {
    const s = suffixe();
    const email = `meme-${s}@test.local`;
    expect(await cleErreur(creerOrganisation(app, { nom: `Même ${s}`, slug: `meme-${s}`, admin: { email, nom: "A" }, suppleant: { email: email.toUpperCase(), nom: "B" } }, superadmin)))
      .toBe("orgs.suppleant_meme_adresse");
    expect((await enTransaction(proprietaire, (c) => c.query("SELECT 1 FROM platform.organisations WHERE slug = $1", [`meme-${s}`]))).rowCount).toBe(0);
  });
});

describe("le suppléant INACTIF ne compte pas comme administrateur (B2, B10)", () => {
  it("titulaire seul administrateur actif : ni rétrogradé, ni retiré, ni désactivé (Q8) — le suppléant inactif ne compte pas", async () => {
    const org = await orgAvecSuppleant();
    expect(await cleErreur(modifierRoles(app, org.cible, org.adminId, ["LECTEUR"], superadmin))).toBe("erreur.dernier_admin");
    expect(await cleErreur(retirerMembre(app, org.cible, org.adminId, superadmin))).toBe("erreur.dernier_admin");
    expect(await cleErreur(desactiverUtilisateur(app, org.adminId, superadmin))).toBe("erreur.dernier_admin");
    // Suppléant activé : il y a un autre administrateur actif, la désactivation du titulaire est permise.
    await activerSuppleant(app, org.organisationId, superadmin);
    await desactiverUtilisateur(app, org.adminId, superadmin);
    expect((await enTransaction(proprietaire, (c) => c.query<{ statut: string }>("SELECT statut FROM platform.utilisateurs WHERE id = $1", [org.adminId]))).rows[0]!.statut)
      .toBe("desactive");
  });
});

describe("gardes de la gestion des membres (G1 à G3)", () => {
  it("G1 : le rôle Administrateur du suppléant ne s'ajoute ni ne se retire par la gestion des membres ; ses autres rôles, si", async () => {
    const org = await orgAvecSuppleant();
    const admin: Acteur = { id: org.adminId, email: org.adminEmail, ...RESEAU_TEST };
    expect(await cleErreur(modifierRoles(app, org.cible, org.suppleantId, ["LECTEUR", "ADMIN_ORGANISATION"], admin))).toBe("membres.suppleant_reserve_superadmin");
    await modifierRoles(app, org.cible, org.suppleantId, ["REDACTEUR"], admin);
    expect(await etat(org.organisationId, org.suppleantId)).toBe("suppleant|inactif|REDACTEUR|false");
    await activerSuppleant(app, org.organisationId, superadmin);
    expect(await etat(org.organisationId, org.suppleantId)).toBe("suppleant|actif|REDACTEUR,ADMIN_ORGANISATION|false");
    expect(await cleErreur(modifierRoles(app, org.cible, org.suppleantId, ["REDACTEUR"], admin))).toBe("membres.suppleant_reserve_superadmin");
    await modifierRoles(app, org.cible, org.suppleantId, ["LECTEUR", "ADMIN_ORGANISATION"], admin);
    expect(await etat(org.organisationId, org.suppleantId)).toBe("suppleant|actif|LECTEUR,ADMIN_ORGANISATION|false");
  });

  it("G2 : le titulaire garde le rôle Administrateur, même avec un co-administrateur ; G3 : ni le titulaire ni le suppléant ne se retirent", async () => {
    const org = await orgAvecSuppleant();
    const co = await membreDeTest(app, org.cible, { email: adresse(), roles: ["ADMIN_ORGANISATION"] }, superadmin);
    expect(await cleErreur(modifierRoles(app, org.cible, org.adminId, ["LECTEUR"], superadmin))).toBe("membres.titulaire_reserve_superadmin");
    await modifierRoles(app, org.cible, org.adminId, ["ADMIN_ORGANISATION", "REDACTEUR"], superadmin); // ajouter un rôle : permis
    expect(await cleErreur(retirerMembre(app, org.cible, org.adminId, superadmin))).toBe("membres.binome_reserve_superadmin");
    expect(await cleErreur(retirerMembre(app, org.cible, org.suppleantId, superadmin))).toBe("membres.binome_reserve_superadmin");
    // Le co-administrateur (sans fonction) se gère librement (B1).
    await modifierRoles(app, org.cible, co, ["LECTEUR"], superadmin);
    await retirerMembre(app, org.cible, co, superadmin);
    expect(await etat(org.organisationId, co)).toBeUndefined();
  });
});

describe("activation, absence, retour", () => {
  it("activation sans absence (B13) ; tracée dans les deux journaux ; refus : déjà actif, compte désactivé, pas de suppléant", async () => {
    const org = await orgAvecSuppleant();
    await activerSuppleant(app, org.organisationId, superadmin);
    expect(await etat(org.organisationId, org.suppleantId)).toBe("suppleant|actif|LECTEUR,ADMIN_ORGANISATION|false");
    expect((await journalPlateforme(org.organisationId)).some((l) => l.action === "ADMIN_SUPPLEANT_ACTIVE")).toBe(true);
    expect((await journalOrganisation(org)).some((l) => l.action === "ADMIN_SUPPLEANT_ACTIVE")).toBe(true);
    expect(await cleErreur(activerSuppleant(app, org.organisationId, superadmin))).toBe("orgs.suppleant_deja_actif");

    const autre = await orgAvecSuppleant();
    await desactiverUtilisateur(app, autre.suppleantId, superadmin);
    expect(await cleErreur(activerSuppleant(app, autre.organisationId, superadmin))).toBe("orgs.suppleant_compte_desactive");
    const sansSuppleant = await creerOrgDeTest(app, proprietaire, superadmin); // invitation de suppléant non acceptée
    expect(await cleErreur(activerSuppleant(app, sansSuppleant.organisationId, superadmin))).toBe("orgs.suppleant_absent");
  });

  it("absence : aucun droit ne change (B11) ; motif dans le journal de la plateforme SEULEMENT (B12) ; retour : suppléant redevenu lecteur", async () => {
    const org = await orgAvecSuppleant();
    expect(await cleErreur(marquerTitulaireRetour(app, org.organisationId, superadmin))).toBe("orgs.rien_a_retablir");
    await marquerTitulaireAbsent(app, org.organisationId, "Congé maternité", superadmin);
    expect(await etat(org.organisationId, org.adminId)).toBe("titulaire|-|ADMIN_ORGANISATION|true");
    expect(await cleErreur(marquerTitulaireAbsent(app, org.organisationId, null, superadmin))).toBe("orgs.titulaire_deja_absent");
    expect((await journalPlateforme(org.organisationId)).find((l) => l.action === "ADMIN_TITULAIRE_ABSENT")?.details).toEqual({ motif: "Congé maternité" });
    const dansOrg = (await journalOrganisation(org)).find((l) => l.action === "ADMIN_TITULAIRE_ABSENT");
    expect(dansOrg).toBeDefined();
    expect(JSON.stringify(dansOrg?.details)).not.toContain("Congé");
    expect((await lireBinome(app, org.organisationId)).titulaire?.motifAbsence).toBe("Congé maternité");

    await activerSuppleant(app, org.organisationId, superadmin);
    await marquerTitulaireRetour(app, org.organisationId, superadmin);
    expect(await etat(org.organisationId, org.adminId)).toBe("titulaire|-|ADMIN_ORGANISATION|false");
    expect(await etat(org.organisationId, org.suppleantId)).toBe("suppleant|inactif|LECTEUR|false");
    const actions = (await journalOrganisation(org)).map((l) => l.action);
    expect(actions).toContain("ADMIN_TITULAIRE_RETOUR");
    expect(actions).toContain("ADMIN_SUPPLEANT_DESACTIVE");
    // Retour sans absence, suppléant actif : permis (désactive le suppléant).
    await activerSuppleant(app, org.organisationId, superadmin);
    await marquerTitulaireRetour(app, org.organisationId, superadmin);
    expect(await etat(org.organisationId, org.suppleantId)).toBe("suppleant|inactif|LECTEUR|false");
  });

  it("retour refusé s'il laisserait l'organisation sans administrateur actif (titulaire au compte désactivé)", async () => {
    const org = await orgAvecSuppleant();
    await activerSuppleant(app, org.organisationId, superadmin);
    await desactiverUtilisateur(app, org.adminId, superadmin);
    expect(await cleErreur(marquerTitulaireRetour(app, org.organisationId, superadmin))).toBe("erreur.dernier_admin");
    expect(await etat(org.organisationId, org.suppleantId)).toBe("suppleant|actif|LECTEUR,ADMIN_ORGANISATION|false");
    await reactiverUtilisateur(app, org.adminId, superadmin);
    await marquerTitulaireRetour(app, org.organisationId, superadmin);
  });

  it("organisation suspendue → erreur.organisation_suspendue", async () => {
    const org = await orgAvecSuppleant();
    await enTransaction(proprietaire, (c) => c.query("UPDATE platform.organisations SET statut = 'suspendue' WHERE id = $1", [org.organisationId]));
    expect(await cleErreur(activerSuppleant(app, org.organisationId, superadmin))).toBe("erreur.organisation_suspendue");
    expect(await cleErreur(marquerTitulaireAbsent(app, org.organisationId, null, superadmin))).toBe("erreur.organisation_suspendue");
  });
});

describe("départ définitif (B4, B15)", () => {
  it("le suppléant devient titulaire ; l'ancien titulaire reste membre, compte actif, sans le rôle Administrateur ; puis un nouveau suppléant", async () => {
    const org = await orgAvecSuppleant();
    await marquerTitulaireAbsent(app, org.organisationId, "Départ", superadmin);
    await departTitulaire(app, org.organisationId, superadmin);
    expect(await etat(org.organisationId, org.suppleantId)).toBe("titulaire|-|LECTEUR,ADMIN_ORGANISATION|false");
    expect(await etat(org.organisationId, org.adminId)).toBe("-|-|LECTEUR|false");
    expect((await enTransaction(proprietaire, (c) => c.query<{ statut: string }>("SELECT statut FROM platform.utilisateurs WHERE id = $1", [org.adminId]))).rows[0]!.statut).toBe("actif");
    expect((await journalOrganisation(org)).find((l) => l.action === "ADMIN_TITULAIRE_REMPLACE")?.details).toMatchObject({ ancien: org.adminId, nouveau: org.suppleantId });
    // Plus de suppléant : rien d'automatique (B15).
    expect((await lireBinome(app, org.organisationId)).suppleant).toBeNull();
    expect(await cleErreur(departTitulaire(app, org.organisationId, superadmin))).toBe("orgs.suppleant_absent");
    const email = adresse();
    const inv = await inviterSuppleant(app, org.organisationId, { email, nom: "Nouveau suppléant" }, superadmin);
    expect(await cleErreur(inviterSuppleant(app, org.organisationId, { email: adresse(), nom: "Un autre" }, superadmin))).toBe("orgs.suppleant_existe");
    await accepterAvecNouveauCompte(app, inv.jeton, { nom: "Nouveau suppléant", motDePasse: MDP_TEST, langue: "fr" }, RESEAU_TEST);
    expect(await etat(org.organisationId, await idDe(email))).toBe("suppleant|inactif|LECTEUR|false");
  });
});

describe("organisation existante (B8)", () => {
  it("sans binôme : le plus ancien administrateur actif est désigné titulaire ; aucun administrateur → orgs.aucun_titulaire", async () => {
    const org = await creerOrgDeTest(app, proprietaire, superadmin);
    const co = await membreDeTest(app, org.cible, { email: adresse(), roles: ["ADMIN_ORGANISATION"] }, superadmin);
    // État d'avant le chantier 2 : aucune fonction, aucune invitation de suppléant.
    await enTransaction(proprietaire, async (c) => {
      await c.query("UPDATE platform.adhesions SET fonction_org = NULL WHERE organisation_id = $1", [org.organisationId]);
      await c.query("UPDATE platform.invitations SET annulee_le = now() WHERE id = $1", [org.invitationSuppleant.id]);
    });
    await inviterSuppleant(app, org.organisationId, { email: adresse(), nom: "Suppléant" }, superadmin);
    expect(await etat(org.organisationId, org.adminId)).toBe("titulaire|-|ADMIN_ORGANISATION|false");
    expect(await etat(org.organisationId, co)).toBe("-|-|ADMIN_ORGANISATION|false"); // co-administrateur (B1)
    expect((await journalOrganisation(org)).find((l) => l.action === "ADMIN_TITULAIRE_DESIGNE")).toBeDefined();

    const vide = await creerOrgDeTest(app, proprietaire, superadmin);
    await enTransaction(proprietaire, async (c) => {
      await c.query("DELETE FROM platform.adhesions WHERE organisation_id = $1", [vide.organisationId]);
      await c.query("UPDATE platform.invitations SET annulee_le = now() WHERE id = $1", [vide.invitationSuppleant.id]);
    });
    expect(await cleErreur(inviterSuppleant(app, vide.organisationId, { email: adresse(), nom: "S" }, superadmin))).toBe("orgs.aucun_titulaire");
  });

  it("un suppléant au compte désactivé est remplacé ; une invitation de suppléant en attente est annulée et remplacée si elle a expiré", async () => {
    const org = await orgAvecSuppleant();
    await desactiverUtilisateur(app, org.suppleantId, superadmin);
    await inviterSuppleant(app, org.organisationId, { email: adresse(), nom: "Remplaçant" }, superadmin);
    expect(await etat(org.organisationId, org.suppleantId)).toBe("-|-|LECTEUR|false");

    const autre = await creerOrgDeTest(app, proprietaire, superadmin);
    expect(await cleErreur(inviterSuppleant(app, autre.organisationId, { email: adresse(), nom: "S" }, superadmin))).toBe("orgs.suppleant_existe");
    await enTransaction(proprietaire, (c) => c.query("UPDATE platform.invitations SET cree_le = now() - interval '4 days', expire_le = now() - interval '1 day' WHERE id = $1", [autre.invitationSuppleant.id]));
    await inviterSuppleant(app, autre.organisationId, { email: adresse(), nom: "S" }, superadmin);
    expect((await enTransaction(proprietaire, (c) => c.query<{ annulee: boolean }>("SELECT annulee_le IS NOT NULL AS annulee FROM platform.invitations WHERE id = $1", [autre.invitationSuppleant.id]))).rows[0]!.annulee).toBe(true);
  });
});

describe("réémission de l'invitation d'administrateur (B5)", () => {
  it("refusée tant qu'un suppléant est utilisable (invitation en attente, ou membre au compte actif) ; permise sinon ; invitation de titulaire", async () => {
    const s = suffixe();
    const creee = await creerOrganisation(app, { nom: `B5 ${s}`, slug: `b5-${s}`, admin: { email: adresse(), nom: "A" }, suppleant: { email: adresse(), nom: "S" } }, superadmin);
    expect(await cleErreur(reemettreInvitationAdmin(app, creee.organisationId, { email: adresse(), nom: "X" }, superadmin))).toBe("orgs.suppleant_a_activer");
    await enTransaction(proprietaire, (c) => c.query("UPDATE platform.invitations SET cree_le = now() - interval '4 days', expire_le = now() - interval '1 day' WHERE id = $1", [creee.invitationSuppleant.id]));
    const r = await reemettreInvitationAdmin(app, creee.organisationId, { email: adresse(), nom: "X" }, superadmin);
    expect((await enTransaction(proprietaire, (c) => c.query<{ fonction_org: string }>("SELECT fonction_org FROM platform.invitations WHERE id = $1", [r.id]))).rows[0]!.fonction_org).toBe("titulaire");

    // Suppléant membre au compte actif, titulaire désactivé (état hérité, posé en base) : activer le suppléant.
    const org = await orgAvecSuppleant();
    await enTransaction(proprietaire, (c) => c.query("UPDATE platform.utilisateurs SET statut = 'desactive' WHERE id = $1", [org.adminId]));
    expect(await cleErreur(reemettreInvitationAdmin(app, org.organisationId, { email: adresse(), nom: "X" }, superadmin))).toBe("orgs.suppleant_a_activer");
  });

  it("l'acceptation d'une invitation de titulaire remplace l'ancien titulaire (fonction et rôle Administrateur retirés, tracé)", async () => {
    const org = await orgAvecSuppleant();
    await enTransaction(proprietaire, async (c) => {
      await c.query("UPDATE platform.utilisateurs SET statut = 'desactive' WHERE id = ANY ($1)", [[org.adminId, org.suppleantId]]);
    });
    const email = adresse();
    const r = await reemettreInvitationAdmin(app, org.organisationId, { email, nom: "Nouveau titulaire" }, superadmin);
    await accepterAvecNouveauCompte(app, r.jeton, { nom: "Nouveau titulaire", motDePasse: MDP_TEST, langue: "fr" }, RESEAU_TEST);
    expect(await etat(org.organisationId, await idDe(email))).toBe("titulaire|-|ADMIN_ORGANISATION|false");
    expect(await etat(org.organisationId, org.adminId)).toBe("-|-|LECTEUR|false");
    expect((await journalOrganisation(org)).some((l) => l.action === "ADMIN_TITULAIRE_REMPLACE")).toBe(true);
  });
});

describe("alerte des 60 jours (B6, B7)", () => {
  it("J+59 : rien ; J+60 : notification au titulaire et au suppléant actif, journal, alerte du superadmin ; J+61 : pas de doublon", async () => {
    const org = await orgAvecSuppleant();
    await marquerTitulaireAbsent(app, org.organisationId, null, superadmin);
    await activerSuppleant(app, org.organisationId, superadmin);
    await enTransaction(proprietaire, (c) => c.query("UPDATE platform.adhesions SET date_absence_debut = '2026-01-10T12:00:00Z' WHERE organisation_id = $1 AND utilisateur_id = $2", [org.organisationId, org.adminId]));
    const jour = (n: number) => new Date(Date.UTC(2026, 0, 10 + n, 6));
    const notifs = async (u: string) => (await listerNotifications(app, org.cible, u)).filter((n) => n.nature === "absence_titulaire");
    const alertesJ60 = async () => (await journalPlateforme(org.organisationId)).filter((l) => l.action === "ADMIN_ABSENCE_SOIXANTE_JOURS");

    const j59 = await executerTachesQuotidiennes(app, { fuseau: "UTC", maintenant: jour(59) });
    expect(j59.absences.some((a) => a.organisationId === org.organisationId)).toBe(false);
    expect(await notifs(org.adminId)).toHaveLength(0);
    expect(await alertesAbsence(app, "UTC", "2026-03-10")).not.toContainEqual(expect.objectContaining({ organisationId: org.organisationId }));

    const j60 = await executerTachesQuotidiennes(app, { fuseau: "UTC", maintenant: jour(60) });
    expect(j60.absences.filter((a) => a.organisationId === org.organisationId)).toEqual([
      expect.objectContaining({ titulaireId: org.adminId, debut: "2026-01-10", jours: 60, suppleantActif: true }),
    ]);
    expect(await notifs(org.adminId)).toHaveLength(1);
    expect((await notifs(org.adminId))[0]!.details).toMatchObject({ debut: "2026-01-10", jours: 60 });
    expect(await notifs(org.suppleantId)).toHaveLength(1);
    expect(await alertesJ60()).toHaveLength(1);
    expect((await journalOrganisation(org)).filter((l) => l.action === "ADMIN_ABSENCE_SOIXANTE_JOURS")).toHaveLength(1);

    const j61 = await executerTachesQuotidiennes(app, { fuseau: "UTC", maintenant: jour(61) });
    expect(j61.absences.some((a) => a.organisationId === org.organisationId)).toBe(false);
    expect(await notifs(org.adminId)).toHaveLength(1);
    expect(await alertesJ60()).toHaveLength(1);
    // Section « Alertes » du superadmin : calculée, tant que l'absence dure.
    expect(await alertesAbsence(app, "UTC", "2026-03-12")).toContainEqual(expect.objectContaining({ organisationId: org.organisationId, jours: 61 }));
    await marquerTitulaireRetour(app, org.organisationId, superadmin);
    expect(await alertesAbsence(app, "UTC", "2026-03-12")).not.toContainEqual(expect.objectContaining({ organisationId: org.organisationId }));
  });

  it("suppléant inactif : seul le titulaire est notifié", async () => {
    const org = await orgAvecSuppleant();
    await marquerTitulaireAbsent(app, org.organisationId, null, superadmin);
    await enTransaction(proprietaire, (c) => c.query("UPDATE platform.adhesions SET date_absence_debut = '2025-01-10T12:00:00Z' WHERE organisation_id = $1 AND utilisateur_id = $2", [org.organisationId, org.adminId]));
    await executerTachesQuotidiennes(app, { fuseau: "UTC", maintenant: new Date(Date.UTC(2025, 0, 10 + 60, 6)) });
    expect((await listerNotifications(app, org.cible, org.adminId)).filter((n) => n.nature === "absence_titulaire")).toHaveLength(1);
    expect((await listerNotifications(app, org.cible, org.suppleantId)).filter((n) => n.nature === "absence_titulaire")).toHaveLength(0);
  });
});

describe("co-administrateurs et contraintes en base", () => {
  it("plusieurs co-administrateurs permis (B1) ; un seul titulaire, un seul suppléant ; le rôle porte l'état du suppléant", async () => {
    const org = await orgAvecSuppleant();
    const [c1, c2] = [await membreDeTest(app, org.cible, { email: adresse(), roles: ["ADMIN_ORGANISATION"] }, superadmin), await membreDeTest(app, org.cible, { email: adresse(), roles: ["ADMIN_ORGANISATION"] }, superadmin)];
    expect((await listerMembres(app, org.organisationId)).filter((m) => m.roles.includes("ADMIN_ORGANISATION"))).toHaveLength(3);
    const maj = (sql: string, params: unknown[]) => codeErreur(enTransaction(app, (c) => c.query(sql, params)));
    // Deux titulaires : index unique.
    expect(await maj("UPDATE platform.adhesions SET fonction_org = 'titulaire' WHERE organisation_id = $1 AND utilisateur_id = $2", [org.organisationId, c1])).toBe("23505");
    // Deux suppléants : index unique.
    expect(await maj("UPDATE platform.adhesions SET fonction_org = 'suppleant', statut_suppleant = 'actif' WHERE organisation_id = $1 AND utilisateur_id = $2", [org.organisationId, c2])).toBe("23505");
    // Suppléant actif sans le rôle Administrateur, ou inactif avec : refusé.
    expect(await maj("UPDATE platform.adhesions SET statut_suppleant = 'actif' WHERE organisation_id = $1 AND utilisateur_id = $2", [org.organisationId, org.suppleantId])).toBe("23514");
    // Titulaire sans le rôle Administrateur : refusé.
    expect(await maj("UPDATE platform.adhesions SET roles = '{LECTEUR}' WHERE organisation_id = $1 AND utilisateur_id = $2", [org.organisationId, org.adminId])).toBe("23514");
    // Absence hors titulaire, motif sans absence : refusés.
    expect(await maj("UPDATE platform.adhesions SET date_absence_debut = now() WHERE organisation_id = $1 AND utilisateur_id = $2", [org.organisationId, c1])).toBe("23514");
    expect(await maj("UPDATE platform.adhesions SET motif_absence = 'x' WHERE organisation_id = $1 AND utilisateur_id = $2", [org.organisationId, org.adminId])).toBe("23514");
    // Invitation de suppléant avec le rôle Administrateur : refusée.
    expect(await maj("UPDATE platform.invitations SET roles = '{ADMIN_ORGANISATION}' WHERE id = $1", [org.invitationSuppleant.id])).toMatch(/^(23514|42501)$/);
  });
});

