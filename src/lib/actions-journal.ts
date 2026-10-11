// Liste des opérations tracées dans le journal d'audit (partagée par le serveur et l'affichage).
export const ACTIONS = [
  "CONNEXION",
  "CONNEXION_ECHEC",
  "COMPTE_VERROUILLE",
  "DECONNEXION",
  "SESSION_EXPIREE",
  "SESSION_REVOQUEE",
  "MOT_DE_PASSE_MODIFIE",
  "MOT_DE_PASSE_REINITIALISE",
  "ORGANISATION_CREEE",
  "ORGANISATION_SUSPENDUE",
  "ORGANISATION_REACTIVEE",
  "UTILISATEUR_CREE",
  "UTILISATEUR_DESACTIVE",
  "UTILISATEUR_REACTIVE",
  "SUPERADMIN_CREE",
  "MEMBRE_AJOUTE",
  "DROITS_MODIFIES",
  "MEMBRE_RETIRE",
] as const;

export type Action = (typeof ACTIONS)[number];

export function estAction(valeur: unknown): valeur is Action {
  return typeof valeur === "string" && (ACTIONS as readonly string[]).includes(valeur);
}
