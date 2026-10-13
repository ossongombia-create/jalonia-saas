// Rôles et droits (RBAC). Ce fichier est LA source de vérité : la page « Droits » du superadmin
// affiche directement cette matrice, et le serveur s'en sert pour autoriser ou refuser chaque action.
// (Aucun secret ici : ce module peut être utilisé côté navigateur pour l'affichage.)

export const ROLE_SUPERADMIN = "SUPERADMIN_PLATFORM" as const;

export const ROLES_ORGANISATION = ["ADMIN_ORGANISATION", "REDACTEUR", "VERIFICATEUR", "APPROBATEUR", "LECTEUR"] as const;
export type RoleOrganisation = (typeof ROLES_ORGANISATION)[number];
export type Role = RoleOrganisation | typeof ROLE_SUPERADMIN;

export const TOUS_LES_ROLES: readonly Role[] = [ROLE_SUPERADMIN, ...ROLES_ORGANISATION];

/** « actif » : appliqué dans cette version. « prevu » : déclaré, appliqué quand la fonctionnalité arrive. */
export type EtatDroit = "actif" | "prevu";

interface DefinitionDroit {
  roles: readonly Role[];
  etat: EtatDroit;
}

export const DROITS = {
  // ----- Plateforme (SUPERADMIN_PLATFORM) -----
  "plateforme.organisations.gerer": { roles: [ROLE_SUPERADMIN], etat: "actif" },
  "plateforme.utilisateurs.gerer": { roles: [ROLE_SUPERADMIN], etat: "actif" },
  "plateforme.sessions.gerer": { roles: [ROLE_SUPERADMIN], etat: "actif" },
  "plateforme.journal.lire": { roles: [ROLE_SUPERADMIN], etat: "actif" },
  "plateforme.droits.lire": { roles: [ROLE_SUPERADMIN], etat: "actif" },
  "plateforme.maintenance.gerer": { roles: [ROLE_SUPERADMIN], etat: "prevu" },
  // ----- Organisation -----
  "organisation.membres.gerer": { roles: ["ADMIN_ORGANISATION"], etat: "actif" },
  "organisation.journal.lire": { roles: ["ADMIN_ORGANISATION"], etat: "actif" },
  // Revue périodique des documents et rappels (src/server/documents/revues.ts).
  "organisation.parametres": { roles: ["ADMIN_ORGANISATION"], etat: "actif" },
  // ----- Documents (cycle de vie : brouillon → vérification → approbation → publication → archivage) -----
  // Lire : ouvrir, voir, exporter (Word, PDF) les documents et la cartographie. Les autres rôles sont en lecture seule.
  "documents.lire": { roles: ["ADMIN_ORGANISATION", "REDACTEUR", "VERIFICATEUR", "APPROBATEUR", "LECTEUR"], etat: "actif" },
  "documents.rediger": { roles: ["ADMIN_ORGANISATION", "REDACTEUR"], etat: "actif" },
  "documents.supprimer": { roles: ["ADMIN_ORGANISATION", "REDACTEUR"], etat: "actif" },
  "cartographie.modifier": { roles: ["ADMIN_ORGANISATION", "REDACTEUR"], etat: "actif" },
  // Circuit de validation (src/server/documents/circuit.ts). Soumettre (et réviser un document publié) : qui peut rédiger.
  // Approuver = publier : l'approbation met le document en application (les deux droits vont ensemble).
  // Par défaut (à confirmer par Brice), la personne qui a soumis ou rédigé la version ne peut ni la vérifier ni l'approuver,
  // et celle qui l'a vérifiée ne peut pas l'approuver (séparation des tâches, vérifiée par le serveur).
  "documents.soumettre": { roles: ["ADMIN_ORGANISATION", "REDACTEUR"], etat: "actif" },
  "documents.verifier": { roles: ["VERIFICATEUR"], etat: "actif" },
  "documents.approuver": { roles: ["APPROBATEUR"], etat: "actif" },
  "documents.publier": { roles: ["APPROBATEUR"], etat: "actif" },
  "documents.archiver": { roles: ["APPROBATEUR"], etat: "actif" },
  // ----- QSE (src/server/qse) : plan d'actions, objectifs et mesures des indicateurs -----
  // Valeurs par défaut (à confirmer par Brice) : tout rôle sauf lecteur fait avancer les actions et saisit les mesures ;
  // les objectifs chiffrés sont fixés par l'administrateur et l'approbateur (direction).
  "actions.gerer": { roles: ["ADMIN_ORGANISATION", "REDACTEUR", "VERIFICATEUR", "APPROBATEUR"], etat: "actif" },
  "indicateurs.mesurer": { roles: ["ADMIN_ORGANISATION", "REDACTEUR", "VERIFICATEUR", "APPROBATEUR"], etat: "actif" },
  "indicateurs.objectifs": { roles: ["ADMIN_ORGANISATION", "APPROBATEUR"], etat: "actif" },
} as const satisfies Record<string, DefinitionDroit>;

export type Droit = keyof typeof DROITS;

export const LISTE_DROITS = Object.keys(DROITS) as Droit[];

/** Vrai si l'un des rôles donne le droit. */
export function aLeDroit(roles: Iterable<Role>, droit: Droit): boolean {
  const autorises: readonly Role[] = DROITS[droit].roles;
  for (const r of roles) if (autorises.includes(r)) return true;
  return false;
}

export function estRoleOrganisation(valeur: unknown): valeur is RoleOrganisation {
  return typeof valeur === "string" && (ROLES_ORGANISATION as readonly string[]).includes(valeur);
}
