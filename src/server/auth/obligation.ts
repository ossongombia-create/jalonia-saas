// Qui DOIT avoir un second facteur (décision n° 4 du 19/10/2026) : un superadmin, ou une personne qui a le rôle
// APPROBATEUR dans au moins une organisation ACTIVE (dans une organisation suspendue, le rôle ne compte pas ; à sa
// réactivation, le second facteur est de nouveau exigé à la connexion suivante). Une seule expression SQL, utilisée à la
// connexion (connexion.ts) et pour l'état du second facteur (second-facteur.ts) : les deux ne peuvent pas diverger.

/** Expression SQL booléenne pour la ligne `alias` de platform.utilisateurs (alias : identifiant SQL simple). */
export function sqlSecondFacteurObligatoire(alias: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(alias)) throw new Error("alias SQL non valable");
  return `(${alias}.est_superadmin OR EXISTS (
    SELECT 1 FROM platform.adhesions a_mfa JOIN platform.organisations o_mfa ON o_mfa.id = a_mfa.organisation_id
     WHERE a_mfa.utilisateur_id = ${alias}.id AND o_mfa.statut = 'active' AND 'APPROBATEUR' = ANY (a_mfa.roles)))`;
}
