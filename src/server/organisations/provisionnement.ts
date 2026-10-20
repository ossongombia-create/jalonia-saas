// Création d'une organisation (réservée au superadmin), avec le rôle de l'APPLICATION.
// Le schéma, le rôle PostgreSQL et les tables sont créés par la fonction platform.provisionner_organisation()
// (migration plateforme 0003) : l'application n'a que le droit de l'exécuter, elle ne détient plus le mot de passe
// du rôle propriétaire.
// TOUT se fait dans UNE transaction : si une seule étape échoue, rien n'est créé (ni ligne, ni schéma, ni rôle
// PostgreSQL — PostgreSQL annule aussi les créations de schéma et de rôle) :
//   1. la fonction : ligne platform.organisations, rôle, schéma et tables, adhésion SANS héritage de l'application ;
//   2. les journaux de la plateforme et de l'organisation ;
//   3. l'INVITATION du premier administrateur (lien à usage unique) : personne ne choisit son mot de passe à sa
//      place, et un compte existant n'est rattaché que s'il accepte (audit S8, S10).
import type { Pool } from "pg";
import { enTransaction } from "../db/transactions";
import { nouveauxIdentifiants } from "../db/identifiants";
import { journaliserLesDeux } from "../audit/journal";
import { contrainteEnCause, ErreurMetier, estErreurPg, PG_UNICITE } from "../erreurs";
import { traceActeur, type Acteur } from "../acteur";
import { creerInvitation, type InvitationCreee } from "../invitations/service";

export interface NouvelleOrganisation {
  nom: string;
  slug: string;
  /** Administrateur TITULAIRE (rôle Administrateur). */
  admin: { email: string; nom: string };
  /** SUPPLÉANT, obligatoire (chantier 2) : rejoint l'organisation en lecteur, inactif jusqu'à son activation. */
  suppleant: { email: string; nom: string };
}

export interface OrganisationCreee {
  organisationId: string;
  schemaName: string;
  /** Invitation du premier administrateur (titulaire) : le lien est à lui transmettre. */
  invitation: InvitationCreee;
  /** Invitation du suppléant : le lien est à lui transmettre. */
  invitationSuppleant: InvitationCreee;
}

export async function creerOrganisation(poolApplication: Pool, entree: NouvelleOrganisation, acteur: Acteur): Promise<OrganisationCreee> {
  if (entree.admin.email.trim().toLowerCase() === entree.suppleant.email.trim().toLowerCase()) throw new ErreurMetier("orgs.suppleant_meme_adresse");
  const ids = nouveauxIdentifiants();
  try {
    return await enTransaction(poolApplication, async (client) => {
      const org = await client.query<{ id: string }>("SELECT platform.provisionner_organisation($1, $2, $3, $4) AS id", [
        entree.nom,
        entree.slug,
        ids.schemaName,
        acteur.id,
      ]);
      const cible = { id: org.rows[0]!.id, schemaName: ids.schemaName, roleName: ids.roleName };
      const details = { nom: entree.nom, slug: entree.slug, admin: entree.admin.email, suppleant: entree.suppleant.email };
      await journaliserLesDeux(client, cible, { action: "ORGANISATION_CREEE", ...traceActeur(acteur), cibleType: "organisation", cibleId: cible.id, details });
      // Les DEUX invitations dans la même transaction : si la seconde échoue, rien n'est créé.
      const invitation = await creerInvitation(client, cible, { email: entree.admin.email, nom: entree.admin.nom, roles: ["ADMIN_ORGANISATION"], fonction: "titulaire" }, acteur);
      const invitationSuppleant = await creerInvitation(client, cible, { email: entree.suppleant.email, nom: entree.suppleant.nom, roles: ["LECTEUR"], fonction: "suppleant" }, acteur);
      return { organisationId: cible.id, schemaName: ids.schemaName, invitation, invitationSuppleant };
    });
  } catch (erreur) {
    if (estErreurPg(erreur, PG_UNICITE)) {
      throw new ErreurMetier(contrainteEnCause(erreur) === "organisations_slug_key" ? "erreur.slug_pris" : "erreur.reessayer");
    }
    throw erreur;
  }
}
