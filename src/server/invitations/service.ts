// Invitations à rejoindre une organisation (audit S8, S10).
//
// L'administrateur d'une organisation (ou le superadmin) invite une adresse avec des rôles. Il obtient un lien à
// usage unique, valable 72 heures, à transmettre à la personne (plus tard : envoyé par e-mail).
//   - Sans compte Jalonia, la personne crée le sien et choisit SON mot de passe : personne d'autre ne le connaît.
//   - Avec un compte, elle se connecte (avec CETTE adresse) et accepte : aucun compte n'est plus rattaché d'office.
// La réponse à l'administrateur est la même que l'adresse ait déjà un compte ou non.
//
// Un compte superadmin n'est jamais membre d'une organisation (décision n° 1 du 19/10/2026) : personne ne s'invite
// soi-même, et un compte superadmin ne peut pas accepter d'invitation (la base le refuse aussi). Pour intervenir
// dans une organisation, le superadmin ouvre un accès d'urgence (acces-urgence/service.ts).
//
// Binôme d'administration (chantier 2 du 20/10/2026) : une invitation peut porter une FONCTION — titulaire (rôle
// Administrateur) ou suppléant (rôle Lecteur, suppléant inactif). À l'acceptation, l'adhésion la reprend ; un nouveau
// titulaire (invitation réémise) retire au précédent sa fonction et son rôle Administrateur.
//
// Seule l'empreinte SHA-256 du jeton est rangée en base. Un lien inconnu, déjà utilisé, annulé ou expiré (ou dont
// l'organisation est suspendue) reçoit toujours la même réponse : « lien non valable ».
import { createHash, randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { RoleOrganisation } from "@/lib/rbac";
import type { Langue } from "@/lib/i18n";
import { enTransaction } from "../db/transactions";
import { journaliserLesDeux, journaliserPlateforme } from "../audit/journal";
import { controlerMotDePasse, hacherMotDePasse } from "../auth/motdepasse";
import { ErreurMetier, estErreurPg, PG_UNICITE } from "../erreurs";
import { traceActeur, type Acteur } from "../acteur";
import type { OrganisationCible } from "../membres/service";

export const DUREE_INVITATION_HEURES = 72;
/** 32 octets aléatoires en base64url : 43 caractères. */
const MOTIF_JETON = /^[A-Za-z0-9_-]{43}$/;

export function jetonBienForme(jeton: string): boolean {
  return MOTIF_JETON.test(jeton);
}

export function empreinteJeton(jeton: string): string {
  return createHash("sha256").update(jeton).digest("hex");
}

/** Chemin du lien d'invitation (relatif au site). */
export function cheminInvitation(jeton: string): string {
  return `/invitation/${jeton}`;
}

export type FonctionOrg = "titulaire" | "suppleant";

export interface NouvelleInvitation {
  email: string; // déjà normalisé (minuscules)
  nom: string;
  roles: RoleOrganisation[];
  /** Binôme d'administration : titulaire ({ADMIN_ORGANISATION}) ou suppléant ({LECTEUR}) — vérifié par la base. */
  fonction?: FonctionOrg;
}

export interface InvitationCreee {
  id: string;
  jeton: string;
  expireLe: Date;
}

/**
 * Crée une invitation DANS la transaction en cours (sert aussi à la création d'une organisation). Une invitation
 * encore en attente pour la même adresse est annulée : seul le dernier lien fonctionne.
 */
export async function creerInvitation(client: PoolClient, org: OrganisationCible, entree: NouvelleInvitation, acteur: Acteur): Promise<InvitationCreee> {
  if (entree.email === acteur.email.toLowerCase()) throw new ErreurMetier("invitation.soi_meme");
  const membre = await client.query(
    `SELECT 1 FROM platform.adhesions a JOIN platform.utilisateurs u ON u.id = a.utilisateur_id
      WHERE a.organisation_id = $1 AND u.email = $2`,
    [org.id, entree.email],
  );
  if (membre.rowCount) throw new ErreurMetier("erreur.deja_membre");
  const remplacees = await client.query(
    `UPDATE platform.invitations SET annulee_le = now()
      WHERE organisation_id = $1 AND email = $2 AND acceptee_le IS NULL AND annulee_le IS NULL`,
    [org.id, entree.email],
  );
  const jeton = randomBytes(32).toString("base64url");
  const r = await client.query<{ id: string; expire_le: Date }>(
    `INSERT INTO platform.invitations (organisation_id, email, nom, roles, jeton_empreinte, cree_par, expire_le, fonction_org)
     VALUES ($1, $2, $3, $4, $5, $6, now() + ($7::int * interval '1 hour'), $8)
     RETURNING id, expire_le`,
    [org.id, entree.email, entree.nom, entree.roles, empreinteJeton(jeton), acteur.id, DUREE_INVITATION_HEURES, entree.fonction ?? null],
  );
  const id = r.rows[0]!.id;
  const details: Record<string, unknown> = { email: entree.email, roles: entree.roles, ...(entree.fonction ? { fonction: entree.fonction } : {}) };
  if (remplacees.rowCount) details.remplace = true;
  await journaliserLesDeux(client, org, { action: "INVITATION_CREEE", ...traceActeur(acteur), cibleType: "invitation", cibleId: id, details });
  return { id, jeton, expireLe: r.rows[0]!.expire_le };
}

export async function inviter(pool: Pool, org: OrganisationCible, entree: NouvelleInvitation, acteur: Acteur): Promise<InvitationCreee> {
  try {
    return await enTransaction(pool, (client) => creerInvitation(client, org, entree, acteur));
  } catch (erreur) {
    // Deux invitations simultanées de la même adresse : l'une des deux échoue proprement.
    if (estErreurPg(erreur, PG_UNICITE)) throw new ErreurMetier("erreur.reessayer");
    throw erreur;
  }
}

export async function annulerInvitation(pool: Pool, org: OrganisationCible, invitationId: string, acteur: Acteur): Promise<void> {
  await enTransaction(pool, async (client) => {
    const r = await client.query<{ email: string }>(
      `UPDATE platform.invitations SET annulee_le = now()
        WHERE id = $1 AND organisation_id = $2 AND acceptee_le IS NULL AND annulee_le IS NULL
        RETURNING email`,
      [invitationId, org.id],
    );
    if (!r.rowCount) throw new ErreurMetier("erreur.introuvable");
    await journaliserLesDeux(client, org, {
      action: "INVITATION_ANNULEE", ...traceActeur(acteur), cibleType: "invitation", cibleId: invitationId, details: { email: r.rows[0]!.email },
    });
  });
}

export interface InvitationEnAttente {
  id: string;
  email: string;
  nom: string;
  roles: RoleOrganisation[];
  creeLe: Date;
  expireLe: Date;
  expiree: boolean;
}

/** Invitations ni acceptées ni annulées d'une organisation (les expirées sont signalées comme telles). */
export async function listerInvitations(pool: Pool, organisationId: string): Promise<InvitationEnAttente[]> {
  return enTransaction(pool, async (client) => {
    const r = await client.query<{ id: string; email: string; nom: string; roles: RoleOrganisation[]; cree_le: Date; expire_le: Date; expiree: boolean }>(
      `SELECT id, email, nom, roles, cree_le, expire_le, expire_le <= now() AS expiree
         FROM platform.invitations
        WHERE organisation_id = $1 AND acceptee_le IS NULL AND annulee_le IS NULL
        ORDER BY cree_le DESC`,
      [organisationId],
    );
    return r.rows.map((i) => ({ id: i.id, email: i.email, nom: i.nom, roles: i.roles, creeLe: i.cree_le, expireLe: i.expire_le, expiree: i.expiree }));
  });
}

export interface InvitationOuverte {
  organisationId: string;
  organisationNom: string;
  email: string;
  nom: string;
  roles: RoleOrganisation[];
  expireLe: Date;
  /** Un compte Jalonia existe déjà pour cette adresse (montré à la seule personne qui détient le lien). */
  compteExiste: boolean;
}

const CONDITIONS_VALIDE = "i.acceptee_le IS NULL AND i.annulee_le IS NULL AND i.expire_le > now() AND o.statut = 'active'";

/** L'invitation d'un lien, ou null s'il n'est pas (ou plus) valable — même réponse quelle qu'en soit la raison. */
export async function lireInvitation(pool: Pool, jeton: string): Promise<InvitationOuverte | null> {
  if (!jetonBienForme(jeton)) return null;
  return enTransaction(pool, async (client) => {
    const r = await client.query<{ organisation_id: string; organisation_nom: string; email: string; nom: string; roles: RoleOrganisation[]; expire_le: Date; compte_existe: boolean }>(
      `SELECT i.organisation_id, o.nom AS organisation_nom, i.email, i.nom, i.roles, i.expire_le,
              EXISTS (SELECT 1 FROM platform.utilisateurs u WHERE u.email = i.email) AS compte_existe
         FROM platform.invitations i JOIN platform.organisations o ON o.id = i.organisation_id
        WHERE i.jeton_empreinte = $1 AND ${CONDITIONS_VALIDE}`,
      [empreinteJeton(jeton)],
    );
    const i = r.rows[0];
    if (!i) return null;
    return { organisationId: i.organisation_id, organisationNom: i.organisation_nom, email: i.email, nom: i.nom, roles: i.roles, expireLe: i.expire_le, compteExiste: i.compte_existe };
  });
}

interface InvitationVerrouillee {
  id: string;
  email: string;
  roles: RoleOrganisation[];
  fonction: FonctionOrg | null;
  org: OrganisationCible;
}

/** Relit et VERROUILLE l'invitation (deux acceptations simultanées : la seconde trouve le lien déjà utilisé). */
async function verrouiller(client: PoolClient, jeton: string): Promise<InvitationVerrouillee> {
  if (!jetonBienForme(jeton)) throw new ErreurMetier("invitation.invalide");
  const r = await client.query<{ id: string; email: string; roles: RoleOrganisation[]; fonction_org: FonctionOrg | null; organisation_id: string; schema_name: string; role_name: string }>(
    `SELECT i.id, i.email, i.roles, i.fonction_org, i.organisation_id, o.schema_name, o.role_name
       FROM platform.invitations i JOIN platform.organisations o ON o.id = i.organisation_id
      WHERE i.jeton_empreinte = $1 AND ${CONDITIONS_VALIDE}
      FOR UPDATE OF i`,
    [empreinteJeton(jeton)],
  );
  const i = r.rows[0];
  if (!i) throw new ErreurMetier("invitation.invalide");
  return { id: i.id, email: i.email, roles: i.roles, fonction: i.fonction_org, org: { id: i.organisation_id, schemaName: i.schema_name, roleName: i.role_name } };
}

/** Adhésion (si elle n'existe pas déjà), invitation marquée acceptée, journaux. */
async function rattacher(client: PoolClient, inv: InvitationVerrouillee, personne: Acteur): Promise<void> {
  const deja = await client.query("SELECT 1 FROM platform.adhesions WHERE utilisateur_id = $1 AND organisation_id = $2", [personne.id, inv.org.id]);
  if (!deja.rowCount) {
    // Nouveau titulaire (invitation réémise après la perte de l'ancien) : l'ancien titulaire perd D'ABORD sa fonction
    // et son rôle Administrateur (un seul titulaire par organisation ; le titulaire est toujours administrateur).
    if (inv.fonction === "titulaire") await destituerTitulaire(client, inv.org, personne);
    await client.query(
      "INSERT INTO platform.adhesions (utilisateur_id, organisation_id, roles, fonction_org, statut_suppleant) VALUES ($1, $2, $3, $4, $5)",
      [personne.id, inv.org.id, inv.roles, inv.fonction, inv.fonction === "suppleant" ? "inactif" : null],
    );
  }
  await client.query("UPDATE platform.invitations SET acceptee_le = now(), acceptee_par = $2 WHERE id = $1", [inv.id, personne.id]);
  if (!deja.rowCount) {
    await journaliserLesDeux(client, inv.org, {
      action: "MEMBRE_AJOUTE", ...traceActeur(personne), cibleType: "utilisateur", cibleId: personne.id, details: { email: inv.email, roles: inv.roles, invitation: inv.id },
    });
  }
}

/**
 * Retire à l'éventuel titulaire actuel sa fonction, son absence et son rôle Administrateur (Lecteur s'il ne lui reste
 * aucun rôle), dans la transaction en cours. Tracé dans les deux journaux (ADMIN_TITULAIRE_REMPLACE).
 */
async function destituerTitulaire(client: PoolClient, org: OrganisationCible, nouveau: Acteur): Promise<void> {
  const r = await client.query<{ utilisateur_id: string }>(
    `UPDATE platform.adhesions
        SET fonction_org = NULL, date_absence_debut = NULL, motif_absence = NULL,
            roles = CASE WHEN cardinality(array_remove(roles, 'ADMIN_ORGANISATION')) = 0 THEN '{LECTEUR}'::text[] ELSE array_remove(roles, 'ADMIN_ORGANISATION') END
      WHERE organisation_id = $1 AND fonction_org = 'titulaire'
      RETURNING utilisateur_id`,
    [org.id],
  );
  const ancien = r.rows[0]?.utilisateur_id;
  if (ancien) {
    await journaliserLesDeux(client, org, {
      action: "ADMIN_TITULAIRE_REMPLACE", ...traceActeur(nouveau), cibleType: "utilisateur", cibleId: nouveau.id,
      details: { ancien, nouveau: nouveau.id, raison: "invitation_titulaire" },
    });
  }
}

export interface Reseau {
  ip: string | null;
  agent: string | null;
}

/** La personne n'a pas de compte : elle le crée avec SON mot de passe, et rejoint l'organisation. */
export async function accepterAvecNouveauCompte(
  pool: Pool,
  jeton: string,
  saisie: { nom: string; motDePasse: string; langue: Langue },
  reseau: Reseau,
): Promise<{ organisationId: string; email: string }> {
  const lue = await lireInvitation(pool, jeton);
  if (!lue) throw new ErreurMetier("invitation.invalide");
  if (lue.compteExiste) throw new ErreurMetier("invitation.compte_existe");
  const refus = controlerMotDePasse(saisie.motDePasse, lue.email);
  if (refus) throw new ErreurMetier(refus);
  const empreinte = await hacherMotDePasse(saisie.motDePasse); // calcul lent : hors transaction

  try {
    return await enTransaction(pool, async (client) => {
      const inv = await verrouiller(client, jeton);
      const cree = await client.query<{ id: string }>(
        `INSERT INTO platform.utilisateurs (email, nom, mot_de_passe_hash, doit_changer_mdp, langue)
         VALUES ($1, $2, $3, false, $4) RETURNING id`,
        [inv.email, saisie.nom, empreinte, saisie.langue],
      );
      const personne: Acteur = { id: cree.rows[0]!.id, email: inv.email, ip: reseau.ip, agent: reseau.agent };
      await journaliserPlateforme(client, {
        action: "UTILISATEUR_CREE", ...traceActeur(personne), cibleType: "utilisateur", cibleId: personne.id, organisationId: inv.org.id,
        details: { email: inv.email, invitation: inv.id },
      });
      await rattacher(client, inv, personne);
      return { organisationId: inv.org.id, email: inv.email };
    });
  } catch (erreur) {
    // Un compte a été créé pour cette adresse entre-temps : il faut se connecter pour accepter.
    if (estErreurPg(erreur, PG_UNICITE)) throw new ErreurMetier("invitation.compte_existe");
    throw erreur;
  }
}

/** La personne est connectée : elle accepte l'invitation si elle lui est bien adressée. */
export async function accepterAvecCompte(pool: Pool, jeton: string, personne: Acteur): Promise<{ organisationId: string }> {
  return enTransaction(pool, async (client) => {
    const inv = await verrouiller(client, jeton);
    if (inv.email !== personne.email) throw new ErreurMetier("invitation.autre_compte");
    const compte = await client.query<{ est_superadmin: boolean }>("SELECT est_superadmin FROM platform.utilisateurs WHERE id = $1", [personne.id]);
    if (compte.rows[0]?.est_superadmin) throw new ErreurMetier("invitation.superadmin");
    await rattacher(client, inv, personne);
    return { organisationId: inv.org.id };
  });
}
