// Binôme d'administration d'une organisation : TITULAIRE et SUPPLÉANT (chantier 2 du 20/10/2026 ; migration
// plateforme 0010). Toutes les actions de ce fichier sont réservées au superadmin (vérifié par les actions,
// src/actions/plateforme.ts) : ce sont les seules exceptions, bornées au binôme, au principe « le superadmin ne gère
// pas les membres » (chantier 1).
//
//   - Le suppléant INACTIF n'a PAS le rôle Administrateur (Lecteur) : il ne compte nulle part comme administrateur.
//     L'ACTIVER lui ajoute ce rôle ; le RETOUR du titulaire le lui retire. Le rôle porte l'état (contrainte en base).
//   - Le titulaire garde toujours le rôle Administrateur, même absent. L'ABSENCE ne sert qu'au compte des 60 jours.
//   - DÉPART DÉFINITIF : le suppléant devient titulaire ; l'ancien titulaire perd le rôle Administrateur et sa fonction
//     (il reste membre, son compte reste actif). Un nouveau suppléant s'invite ensuite (action séparée).
//
// Chaque action : une transaction, verrou sur l'organisation et ses adhésions, traces dans les deux journaux (le
// motif d'absence : journal de la plateforme seulement). Alerte des 60 jours : absences.ts.
import type { Pool, PoolClient } from "pg";
import { dansOrganisation, enTransaction } from "../db/transactions";
import { journaliserLesDeux, journaliserOrganisation, journaliserPlateforme, type EntreeJournal } from "../audit/journal";
import { ErreurMetier } from "../erreurs";
import { traceActeur, type Acteur } from "../acteur";
import { creerInvitation, type InvitationCreee } from "../invitations/service";
import type { OrganisationCible } from "../membres/service";

/** Rôles sans Administrateur (Lecteur s'il n'en reste aucun : une adhésion a toujours au moins un rôle). */
const SANS_ADMIN = `CASE WHEN cardinality(array_remove(roles, 'ADMIN_ORGANISATION')) = 0 THEN '{LECTEUR}'::text[]
                         ELSE array_remove(roles, 'ADMIN_ORGANISATION') END`;
/** Rôles avec Administrateur (sans doublon). */
const AVEC_ADMIN = `CASE WHEN 'ADMIN_ORGANISATION' = ANY (roles) THEN roles ELSE array_append(roles, 'ADMIN_ORGANISATION') END`;

interface PersonneBinome {
  id: string;
  nom: string;
  email: string;
  compteActif: boolean;
}

export interface Binome {
  titulaire: (PersonneBinome & { absentDepuis: Date | null; motifAbsence: string | null }) | null;
  suppleant: (PersonneBinome & { actif: boolean }) | null;
  /** Invitation de suppléant en attente (non acceptée, non annulée), expirée ou non. */
  invitationSuppleant: { email: string; expireLe: Date; expiree: boolean } | null;
}

async function lireBinomeClient(client: PoolClient, organisationId: string): Promise<Binome> {
  const r = await client.query<{
    id: string; nom: string; email: string; statut: string; fonction_org: "titulaire" | "suppleant"; statut_suppleant: string | null;
    date_absence_debut: Date | null; motif_absence: string | null;
  }>(
    `SELECT u.id, u.nom, u.email, u.statut, a.fonction_org, a.statut_suppleant, a.date_absence_debut, a.motif_absence
       FROM platform.adhesions a JOIN platform.utilisateurs u ON u.id = a.utilisateur_id
      WHERE a.organisation_id = $1 AND a.fonction_org IS NOT NULL`,
    [organisationId],
  );
  const t = r.rows.find((l) => l.fonction_org === "titulaire");
  const s = r.rows.find((l) => l.fonction_org === "suppleant");
  const inv = await client.query<{ email: string; expire_le: Date; expiree: boolean }>(
    `SELECT email, expire_le, expire_le <= now() AS expiree FROM platform.invitations
      WHERE organisation_id = $1 AND fonction_org = 'suppleant' AND acceptee_le IS NULL AND annulee_le IS NULL
      ORDER BY cree_le DESC LIMIT 1`,
    [organisationId],
  );
  const i = inv.rows[0];
  return {
    titulaire: t ? { id: t.id, nom: t.nom, email: t.email, compteActif: t.statut === "actif", absentDepuis: t.date_absence_debut, motifAbsence: t.motif_absence } : null,
    suppleant: s ? { id: s.id, nom: s.nom, email: s.email, compteActif: s.statut === "actif", actif: s.statut_suppleant === "actif" } : null,
    invitationSuppleant: i ? { email: i.email, expireLe: i.expire_le, expiree: i.expiree } : null,
  };
}

/** Le binôme d'une organisation (page du superadmin). */
export function lireBinome(pool: Pool, organisationId: string): Promise<Binome> {
  return enTransaction(pool, (client) => lireBinomeClient(client, organisationId));
}

/**
 * Un suppléant UTILISABLE : membre au compte actif, ou invitation de suppléant en attente et non expirée. (Un suppléant
 * au compte désactivé, ou une invitation expirée ou annulée, ne l'est pas.) Sert à la réémission (chantier 1, B5).
 */
export async function suppleantUtilisable(client: PoolClient, organisationId: string): Promise<boolean> {
  const r = await client.query<{ ok: boolean }>(
    `SELECT EXISTS (
              SELECT 1 FROM platform.adhesions a JOIN platform.utilisateurs u ON u.id = a.utilisateur_id
               WHERE a.organisation_id = $1 AND a.fonction_org = 'suppleant' AND u.statut = 'actif')
         OR EXISTS (
              SELECT 1 FROM platform.invitations i
               WHERE i.organisation_id = $1 AND i.fonction_org = 'suppleant'
                 AND i.acceptee_le IS NULL AND i.annulee_le IS NULL AND i.expire_le > now()) AS ok`,
    [organisationId],
  );
  return r.rows[0]?.ok ?? false;
}

/** Organisation ACTIVE, verrouillée avec ses adhésions (deux actions simultanées sur le binôme : l'une attend l'autre). */
async function organisationVerrouillee(client: PoolClient, organisationId: string): Promise<OrganisationCible & { nom: string }> {
  const r = await client.query<{ id: string; nom: string; statut: string; schema_name: string; role_name: string }>(
    "SELECT id, nom, statut, schema_name, role_name FROM platform.organisations WHERE id = $1 FOR UPDATE",
    [organisationId],
  );
  const o = r.rows[0];
  if (!o) throw new ErreurMetier("erreur.introuvable");
  if (o.statut !== "active") throw new ErreurMetier("erreur.organisation_suspendue");
  await client.query("SELECT 1 FROM platform.adhesions WHERE organisation_id = $1 FOR UPDATE", [o.id]);
  return { id: o.id, nom: o.nom, schemaName: o.schema_name, roleName: o.role_name };
}

const entree = (action: EntreeJournal["action"], acteur: Acteur, cibleId: string, details: Record<string, unknown>): EntreeJournal => ({
  action, ...traceActeur(acteur), cibleType: "utilisateur", cibleId, details,
});

/**
 * Invite un SUPPLÉANT (organisation existante, ou après un départ définitif) :
 *   - sans titulaire, l'administrateur actif le plus ancien est désigné titulaire (aucun → orgs.aucun_titulaire) ;
 *   - refusé s'il existe déjà un suppléant utilisable (orgs.suppleant_existe) ;
 *   - un ancien suppléant inutilisable (compte désactivé) perd sa fonction ; les invitations de suppléant en attente
 *     sont annulées ;
 *   - invitation : rôle Lecteur, fonction suppléant (adresse déjà membre → erreur.deja_membre).
 */
export async function inviterSuppleant(pool: Pool, organisationId: string, saisie: { email: string; nom: string }, acteur: Acteur): Promise<InvitationCreee & { organisation: string }> {
  return enTransaction(pool, async (client) => {
    const org = await organisationVerrouillee(client, organisationId);
    const titulaire = await client.query("SELECT 1 FROM platform.adhesions WHERE organisation_id = $1 AND fonction_org = 'titulaire'", [org.id]);
    if (!titulaire.rowCount) {
      const plusAncien = await client.query<{ utilisateur_id: string }>(
        `SELECT a.utilisateur_id FROM platform.adhesions a JOIN platform.utilisateurs u ON u.id = a.utilisateur_id
          WHERE a.organisation_id = $1 AND 'ADMIN_ORGANISATION' = ANY (a.roles) AND u.statut = 'actif' AND a.fonction_org IS NULL
          ORDER BY a.cree_le, a.utilisateur_id LIMIT 1`,
        [org.id],
      );
      const id = plusAncien.rows[0]?.utilisateur_id;
      if (!id) throw new ErreurMetier("orgs.aucun_titulaire");
      await client.query("UPDATE platform.adhesions SET fonction_org = 'titulaire' WHERE organisation_id = $1 AND utilisateur_id = $2", [org.id, id]);
      await journaliserLesDeux(client, org, entree("ADMIN_TITULAIRE_DESIGNE", acteur, id, { raison: "administrateur_actif_le_plus_ancien" }));
    }
    if (await suppleantUtilisable(client, org.id)) throw new ErreurMetier("orgs.suppleant_existe");
    // Ancien suppléant devenu inutilisable (compte désactivé) : il perd sa fonction (un seul suppléant par organisation).
    const ancien = await client.query<{ utilisateur_id: string }>(
      `UPDATE platform.adhesions SET fonction_org = NULL, statut_suppleant = NULL, roles = ${SANS_ADMIN}
        WHERE organisation_id = $1 AND fonction_org = 'suppleant' RETURNING utilisateur_id`,
      [org.id],
    );
    for (const a of ancien.rows) {
      await journaliserLesDeux(client, org, entree("ADMIN_SUPPLEANT_DESACTIVE", acteur, a.utilisateur_id, { raison: "suppleant_inutilisable_remplace" }));
    }
    const annulees = await client.query<{ id: string; email: string }>(
      `UPDATE platform.invitations SET annulee_le = now()
        WHERE organisation_id = $1 AND fonction_org = 'suppleant' AND acceptee_le IS NULL AND annulee_le IS NULL
        RETURNING id, email`,
      [org.id],
    );
    for (const i of annulees.rows) {
      await journaliserLesDeux(client, org, { action: "INVITATION_ANNULEE", ...traceActeur(acteur), cibleType: "invitation", cibleId: i.id, details: { email: i.email, fonction: "suppleant" } });
    }
    const invitation = await creerInvitation(client, org, { email: saisie.email, nom: saisie.nom, roles: ["LECTEUR"], fonction: "suppleant" }, acteur);
    return { ...invitation, organisation: org.nom };
  });
}

/** Lit le suppléant MEMBRE (verrou déjà posé) ; erreurs : absent, compte désactivé. */
async function suppleantMembre(client: PoolClient, organisationId: string): Promise<{ id: string; actif: boolean }> {
  const r = await client.query<{ utilisateur_id: string; statut_suppleant: string; statut: string }>(
    `SELECT a.utilisateur_id, a.statut_suppleant, u.statut
       FROM platform.adhesions a JOIN platform.utilisateurs u ON u.id = a.utilisateur_id
      WHERE a.organisation_id = $1 AND a.fonction_org = 'suppleant'`,
    [organisationId],
  );
  const s = r.rows[0];
  if (!s) throw new ErreurMetier("orgs.suppleant_absent");
  if (s.statut !== "actif") throw new ErreurMetier("orgs.suppleant_compte_desactive");
  return { id: s.utilisateur_id, actif: s.statut_suppleant === "actif" };
}

/** ACTIVE le suppléant : rôle Administrateur ajouté (ses autres rôles sont gardés). N'exige pas l'absence du titulaire. */
export async function activerSuppleant(pool: Pool, organisationId: string, acteur: Acteur): Promise<void> {
  await enTransaction(pool, async (client) => {
    const org = await organisationVerrouillee(client, organisationId);
    const s = await suppleantMembre(client, org.id);
    if (s.actif) throw new ErreurMetier("orgs.suppleant_deja_actif");
    await client.query(
      `UPDATE platform.adhesions SET roles = ${AVEC_ADMIN}, statut_suppleant = 'actif' WHERE organisation_id = $1 AND utilisateur_id = $2`,
      [org.id, s.id],
    );
    await journaliserLesDeux(client, org, entree("ADMIN_SUPPLEANT_ACTIVE", acteur, s.id, {}));
  });
}

/** Marque le titulaire ABSENT (motif facultatif, journal de la plateforme seulement). Aucun droit ne change. */
export async function marquerTitulaireAbsent(pool: Pool, organisationId: string, motif: string | null, acteur: Acteur): Promise<void> {
  const m = motif?.trim() ? motif.trim().slice(0, 2000) : null;
  await enTransaction(pool, async (client) => {
    const org = await organisationVerrouillee(client, organisationId);
    const r = await client.query<{ utilisateur_id: string; date_absence_debut: Date | null }>(
      "SELECT utilisateur_id, date_absence_debut FROM platform.adhesions WHERE organisation_id = $1 AND fonction_org = 'titulaire'",
      [org.id],
    );
    const t = r.rows[0];
    if (!t) throw new ErreurMetier("orgs.aucun_titulaire");
    if (t.date_absence_debut) throw new ErreurMetier("orgs.titulaire_deja_absent");
    await client.query(
      "UPDATE platform.adhesions SET date_absence_debut = now(), motif_absence = $3 WHERE organisation_id = $1 AND utilisateur_id = $2",
      [org.id, t.utilisateur_id, m],
    );
    const e = entree("ADMIN_TITULAIRE_ABSENT", acteur, t.utilisateur_id, {});
    await journaliserPlateforme(client, { ...e, details: { motif: m }, organisationId: org.id });
    await dansOrganisation(client, org, () => journaliserOrganisation(client, e));
  });
}

/**
 * RETOUR du titulaire (action du superadmin) : son absence est effacée et, dans la même transaction, le suppléant
 * redevient inactif (rôle Administrateur retiré). Possible si le titulaire est absent OU le suppléant actif. Refusé
 * (erreur.dernier_admin) si l'organisation resterait sans administrateur actif.
 */
export async function marquerTitulaireRetour(pool: Pool, organisationId: string, acteur: Acteur): Promise<void> {
  await enTransaction(pool, async (client) => {
    const org = await organisationVerrouillee(client, organisationId);
    const t = (await client.query<{ utilisateur_id: string; date_absence_debut: Date | null }>(
      "SELECT utilisateur_id, date_absence_debut FROM platform.adhesions WHERE organisation_id = $1 AND fonction_org = 'titulaire'",
      [org.id],
    )).rows[0];
    if (!t) throw new ErreurMetier("orgs.aucun_titulaire");
    const s = (await client.query<{ utilisateur_id: string }>(
      "SELECT utilisateur_id FROM platform.adhesions WHERE organisation_id = $1 AND fonction_org = 'suppleant' AND statut_suppleant = 'actif'",
      [org.id],
    )).rows[0];
    if (!t.date_absence_debut && !s) throw new ErreurMetier("orgs.rien_a_retablir");
    if (s) {
      const autres = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM platform.adhesions a JOIN platform.utilisateurs u ON u.id = a.utilisateur_id
          WHERE a.organisation_id = $1 AND a.utilisateur_id <> $2 AND 'ADMIN_ORGANISATION' = ANY (a.roles) AND u.statut = 'actif'`,
        [org.id, s.utilisateur_id],
      );
      if ((autres.rows[0]?.n ?? 0) === 0) throw new ErreurMetier("erreur.dernier_admin");
      await client.query(
        `UPDATE platform.adhesions SET roles = ${SANS_ADMIN}, statut_suppleant = 'inactif' WHERE organisation_id = $1 AND utilisateur_id = $2`,
        [org.id, s.utilisateur_id],
      );
    }
    await client.query(
      "UPDATE platform.adhesions SET date_absence_debut = NULL, motif_absence = NULL WHERE organisation_id = $1 AND utilisateur_id = $2",
      [org.id, t.utilisateur_id],
    );
    await journaliserLesDeux(client, org, entree("ADMIN_TITULAIRE_RETOUR", acteur, t.utilisateur_id, {}));
    if (s) await journaliserLesDeux(client, org, entree("ADMIN_SUPPLEANT_DESACTIVE", acteur, s.utilisateur_id, { raison: "retour_du_titulaire" }));
  });
}

/**
 * DÉPART DÉFINITIF du titulaire : le suppléant (membre, compte actif) devient titulaire (rôle Administrateur) ;
 * l'ancien titulaire perd sa fonction, son absence et le rôle Administrateur (il reste membre, compte actif). Aucune
 * invitation ici : le nouveau suppléant s'invite ensuite (inviterSuppleant).
 */
export async function departTitulaire(pool: Pool, organisationId: string, acteur: Acteur): Promise<void> {
  await enTransaction(pool, async (client) => {
    const org = await organisationVerrouillee(client, organisationId);
    const s = await suppleantMembre(client, org.id);
    const t = (await client.query<{ utilisateur_id: string }>(
      "SELECT utilisateur_id FROM platform.adhesions WHERE organisation_id = $1 AND fonction_org = 'titulaire'",
      [org.id],
    )).rows[0];
    if (!t) throw new ErreurMetier("orgs.aucun_titulaire");
    // L'ancien titulaire D'ABORD (un seul titulaire par organisation : index unique).
    await client.query(
      `UPDATE platform.adhesions SET fonction_org = NULL, date_absence_debut = NULL, motif_absence = NULL, roles = ${SANS_ADMIN}
        WHERE organisation_id = $1 AND utilisateur_id = $2`,
      [org.id, t.utilisateur_id],
    );
    await client.query(
      `UPDATE platform.adhesions SET fonction_org = 'titulaire', statut_suppleant = NULL, roles = ${AVEC_ADMIN}
        WHERE organisation_id = $1 AND utilisateur_id = $2`,
      [org.id, s.id],
    );
    await journaliserLesDeux(client, org, entree("ADMIN_TITULAIRE_REMPLACE", acteur, s.id, { ancien: t.utilisateur_id, nouveau: s.id, raison: "depart_definitif" }));
  });
}
