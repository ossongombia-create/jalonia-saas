// Création d'une organisation (réservée au superadmin), avec le rôle PROPRIÉTAIRE de la base.
// TOUT se fait dans UNE transaction : si une seule étape échoue, rien n'est créé (ni ligne, ni schéma,
// ni rôle PostgreSQL — PostgreSQL annule aussi les créations de schéma et de rôle).
//   1. la ligne platform.organisations ;
//   2. le rôle PostgreSQL de l'organisation (sans connexion possible) ;
//   3. le schéma de l'organisation et ses tables (migrations du gabarit) ;
//   4. l'adhésion du rôle de l'application à ce rôle, SANS héritage : l'application n'obtient ses droits
//      que par un SET ROLE explicite ;
//   5. l'administrateur de l'organisation (compte existant, ou nouveau compte au mot de passe provisoire) ;
//   6. le journal de la plateforme et celui de l'organisation.
import type { Pool } from "pg";
import { ROLE_APPLICATION } from "../config";
import { enTransaction } from "../db/transactions";
import { citer, nouveauxIdentifiants } from "../db/identifiants";
import { appliquerMigrationsOrganisation, type Migration } from "../migrations/lanceur";
import { journaliserOrganisation, journaliserPlateforme } from "../audit/journal";
import { controlerMotDePasse, hacherMotDePasse } from "../auth/motdepasse";
import { contrainteEnCause, ErreurMetier, estErreurPg, PG_UNICITE } from "../erreurs";
import { traceActeur, type Acteur } from "../acteur";

export interface NouvelleOrganisation {
  nom: string;
  slug: string;
  admin: { email: string; nom: string; motDePasseProvisoire: string };
}

export interface OrganisationCreee {
  organisationId: string;
  schemaName: string;
  adminId: string;
  compteAdminCree: boolean;
}

export async function creerOrganisation(
  poolProprietaire: Pool,
  migrationsOrganisation: Migration[],
  entree: NouvelleOrganisation,
  acteur: Acteur,
): Promise<OrganisationCreee> {
  // Le hachage (lent, volontairement) se fait AVANT d'ouvrir la transaction.
  // On ne sait pas encore si le compte existe : on ne hache que si un mot de passe est fourni.
  const mdp = entree.admin.motDePasseProvisoire;
  if (mdp) {
    const refus = controlerMotDePasse(mdp, entree.admin.email);
    if (refus) throw new ErreurMetier(refus);
  }
  const empreinte = mdp ? await hacherMotDePasse(mdp) : null;

  const ids = nouveauxIdentifiants();
  const trace = traceActeur(acteur);

  try {
    return await enTransaction(poolProprietaire, async (client) => {
      const org = await client.query<{ id: string }>(
        `INSERT INTO platform.organisations (nom, slug, schema_name, role_name, cree_par)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [entree.nom, entree.slug, ids.schemaName, ids.roleName, acteur.id],
      );
      const organisationId = org.rows[0]!.id;

      await client.query(`CREATE ROLE ${citer(ids.roleName)} NOLOGIN`);
      await client.query(`CREATE SCHEMA ${citer(ids.schemaName)}`);
      await appliquerMigrationsOrganisation(client, ids, migrationsOrganisation);
      await client.query(`GRANT ${citer(ids.roleName)} TO ${citer(ROLE_APPLICATION)} WITH INHERIT FALSE, SET TRUE`);

      // Administrateur : compte existant (on n'y touche pas) ou nouveau compte.
      const existant = await client.query<{ id: string }>("SELECT id FROM platform.utilisateurs WHERE email = $1", [entree.admin.email]);
      let adminId = existant.rows[0]?.id;
      const compteAdminCree = !adminId;
      if (!adminId) {
        if (!empreinte) throw new ErreurMetier("erreur.mdp_provisoire_requis");
        const cree = await client.query<{ id: string }>(
          `INSERT INTO platform.utilisateurs (email, nom, mot_de_passe_hash, doit_changer_mdp)
           VALUES ($1, $2, $3, true) RETURNING id`,
          [entree.admin.email, entree.admin.nom, empreinte],
        );
        adminId = cree.rows[0]!.id;
        await journaliserPlateforme(client, { action: "UTILISATEUR_CREE", ...trace, cibleType: "utilisateur", cibleId: adminId, organisationId, details: { email: entree.admin.email } });
      }
      await client.query(
        "INSERT INTO platform.adhesions (utilisateur_id, organisation_id, roles) VALUES ($1, $2, $3)",
        [adminId, organisationId, ["ADMIN_ORGANISATION"]],
      );

      const details = { nom: entree.nom, slug: entree.slug, admin: entree.admin.email };
      await journaliserPlateforme(client, { action: "ORGANISATION_CREEE", ...trace, cibleType: "organisation", cibleId: organisationId, organisationId, details });
      await journaliserPlateforme(client, {
        action: "MEMBRE_AJOUTE", ...trace, cibleType: "utilisateur", cibleId: adminId, organisationId, details: { roles: ["ADMIN_ORGANISATION"] },
      });
      await journaliserOrganisation(client, { action: "ORGANISATION_CREEE", ...trace, cibleType: "organisation", cibleId: organisationId, details }, ids);
      await journaliserOrganisation(
        client,
        { action: "MEMBRE_AJOUTE", ...trace, cibleType: "utilisateur", cibleId: adminId, details: { email: entree.admin.email, roles: ["ADMIN_ORGANISATION"] } },
        ids,
      );

      return { organisationId, schemaName: ids.schemaName, adminId, compteAdminCree };
    });
  } catch (erreur) {
    if (estErreurPg(erreur, PG_UNICITE)) {
      throw new ErreurMetier(contrainteEnCause(erreur) === "organisations_slug_key" ? "erreur.slug_pris" : "erreur.reessayer");
    }
    throw erreur;
  }
}
