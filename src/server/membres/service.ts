// Membres d'une organisation : ajout, modification des rôles, retrait.
// Utilisé par l'administrateur de l'organisation (sur SON organisation) et par le superadmin.
// Règle : retirer un membre ou lui ôter le rôle d'administrateur ne peut pas laisser l'organisation sans
// administrateur actif. (Le superadmin peut, lui, désactiver un compte — départ d'une personne — puis
// désigner un nouvel administrateur.)
// Chaque modification est tracée dans le journal de la plateforme ET dans celui de l'organisation,
// dans la même transaction (tout ou rien).
import type { Pool, PoolClient } from "pg";
import type { RoleOrganisation } from "@/lib/rbac";
import { enTransaction, dansOrganisation } from "../db/transactions";
import type { OrganisationTechnique } from "../db/identifiants";
import { journaliserOrganisation, journaliserPlateforme, type EntreeJournal } from "../audit/journal";
import { controlerMotDePasse, hacherMotDePasse } from "../auth/motdepasse";
import { ErreurMetier, estErreurPg, PG_UNICITE } from "../erreurs";
import { traceActeur, type Acteur } from "../acteur";

export interface OrganisationCible extends OrganisationTechnique {
  id: string;
}

export interface Membre {
  utilisateurId: string;
  email: string;
  nom: string;
  statut: "actif" | "desactive";
  roles: RoleOrganisation[];
  derniereConnexion: Date | null;
  membreDepuis: Date;
}

export async function listerMembres(pool: Pool, organisationId: string): Promise<Membre[]> {
  return enTransaction(pool, async (client) => {
    const r = await client.query<{ id: string; email: string; nom: string; statut: "actif" | "desactive"; roles: RoleOrganisation[]; derniere_connexion: Date | null; cree_le: Date }>(
      `SELECT u.id, u.email, u.nom, u.statut, a.roles, u.derniere_connexion, a.cree_le
         FROM platform.adhesions a
         JOIN platform.utilisateurs u ON u.id = a.utilisateur_id
        WHERE a.organisation_id = $1
        ORDER BY u.nom, u.email`,
      [organisationId],
    );
    return r.rows.map((m) => ({
      utilisateurId: m.id, email: m.email, nom: m.nom, statut: m.statut, roles: m.roles, derniereConnexion: m.derniere_connexion, membreDepuis: m.cree_le,
    }));
  });
}

/** Journalise dans les DEUX journaux (plateforme + organisation), dans la transaction en cours. */
async function tracer(client: PoolClient, org: OrganisationCible, entree: EntreeJournal): Promise<void> {
  await journaliserPlateforme(client, { ...entree, organisationId: org.id });
  await dansOrganisation(client, org, () => journaliserOrganisation(client, entree));
}

/** Verrouille les adhésions de l'organisation : deux modifications simultanées ne peuvent pas retirer le dernier administrateur. */
async function verrouillerAdhesions(client: PoolClient, organisationId: string): Promise<void> {
  await client.query("SELECT 1 FROM platform.adhesions WHERE organisation_id = $1 FOR UPDATE", [organisationId]);
}

async function autresAdministrateursActifs(client: PoolClient, organisationId: string, saufUtilisateurId: string): Promise<number> {
  const r = await client.query<{ n: number }>(
    `SELECT count(*)::int AS n
       FROM platform.adhesions a JOIN platform.utilisateurs u ON u.id = a.utilisateur_id
      WHERE a.organisation_id = $1 AND a.utilisateur_id <> $2
        AND 'ADMIN_ORGANISATION' = ANY (a.roles) AND u.statut = 'actif'`,
    [organisationId, saufUtilisateurId],
  );
  return r.rows[0]?.n ?? 0;
}

export interface NouveauMembre {
  email: string;
  nom: string;
  roles: RoleOrganisation[];
  motDePasseProvisoire: string;
}

export async function ajouterMembre(pool: Pool, org: OrganisationCible, entree: NouveauMembre, acteur: Acteur): Promise<{ utilisateurId: string; compteCree: boolean }> {
  const mdp = entree.motDePasseProvisoire;
  if (mdp) {
    const refus = controlerMotDePasse(mdp, entree.email);
    if (refus) throw new ErreurMetier(refus);
  }
  const empreinte = mdp ? await hacherMotDePasse(mdp) : null;
  const trace = traceActeur(acteur);

  try {
    return await enTransaction(pool, async (client) => {
      const existant = await client.query<{ id: string }>("SELECT id FROM platform.utilisateurs WHERE email = $1", [entree.email]);
      let utilisateurId = existant.rows[0]?.id;
      const compteCree = !utilisateurId;
      if (!utilisateurId) {
        if (!empreinte) throw new ErreurMetier("erreur.mdp_provisoire_requis");
        const cree = await client.query<{ id: string }>(
          "INSERT INTO platform.utilisateurs (email, nom, mot_de_passe_hash, doit_changer_mdp) VALUES ($1, $2, $3, true) RETURNING id",
          [entree.email, entree.nom, empreinte],
        );
        utilisateurId = cree.rows[0]!.id;
        await journaliserPlateforme(client, { action: "UTILISATEUR_CREE", ...trace, cibleType: "utilisateur", cibleId: utilisateurId, organisationId: org.id, details: { email: entree.email } });
      } else {
        const deja = await client.query("SELECT 1 FROM platform.adhesions WHERE utilisateur_id = $1 AND organisation_id = $2", [utilisateurId, org.id]);
        if (deja.rowCount) throw new ErreurMetier("erreur.deja_membre");
      }
      await client.query("INSERT INTO platform.adhesions (utilisateur_id, organisation_id, roles) VALUES ($1, $2, $3)", [utilisateurId, org.id, entree.roles]);
      await tracer(client, org, {
        action: "MEMBRE_AJOUTE", ...trace, cibleType: "utilisateur", cibleId: utilisateurId, details: { email: entree.email, roles: entree.roles, compteCree },
      });
      return { utilisateurId, compteCree };
    });
  } catch (erreur) {
    // Deux ajouts simultanés du même e-mail : l'un des deux échoue proprement.
    if (estErreurPg(erreur, PG_UNICITE)) throw new ErreurMetier("erreur.reessayer");
    throw erreur;
  }
}

export async function modifierRoles(pool: Pool, org: OrganisationCible, utilisateurId: string, roles: RoleOrganisation[], acteur: Acteur): Promise<void> {
  if (roles.length === 0) throw new ErreurMetier("erreur.role_requis");
  await enTransaction(pool, async (client) => {
    await verrouillerAdhesions(client, org.id);
    const avant = await client.query<{ roles: RoleOrganisation[] }>(
      "SELECT roles FROM platform.adhesions WHERE utilisateur_id = $1 AND organisation_id = $2",
      [utilisateurId, org.id],
    );
    const anciens = avant.rows[0]?.roles;
    if (!anciens) throw new ErreurMetier("erreur.introuvable");
    const perdAdmin = anciens.includes("ADMIN_ORGANISATION") && !roles.includes("ADMIN_ORGANISATION");
    if (perdAdmin && (await autresAdministrateursActifs(client, org.id, utilisateurId)) === 0) throw new ErreurMetier("erreur.dernier_admin");
    await client.query("UPDATE platform.adhesions SET roles = $3 WHERE utilisateur_id = $1 AND organisation_id = $2", [utilisateurId, org.id, roles]);
    await tracer(client, org, {
      action: "DROITS_MODIFIES", ...traceActeur(acteur), cibleType: "utilisateur", cibleId: utilisateurId, details: { avant: anciens, apres: roles },
    });
  });
}

export async function retirerMembre(pool: Pool, org: OrganisationCible, utilisateurId: string, acteur: Acteur): Promise<void> {
  await enTransaction(pool, async (client) => {
    await verrouillerAdhesions(client, org.id);
    const avant = await client.query<{ roles: RoleOrganisation[] }>(
      "SELECT roles FROM platform.adhesions WHERE utilisateur_id = $1 AND organisation_id = $2",
      [utilisateurId, org.id],
    );
    const anciens = avant.rows[0]?.roles;
    if (!anciens) throw new ErreurMetier("erreur.introuvable");
    if (anciens.includes("ADMIN_ORGANISATION") && (await autresAdministrateursActifs(client, org.id, utilisateurId)) === 0) {
      throw new ErreurMetier("erreur.dernier_admin");
    }
    await client.query("DELETE FROM platform.adhesions WHERE utilisateur_id = $1 AND organisation_id = $2", [utilisateurId, org.id]);
    await tracer(client, org, { action: "MEMBRE_RETIRE", ...traceActeur(acteur), cibleType: "utilisateur", cibleId: utilisateurId, details: { roles: anciens } });
  });
}
