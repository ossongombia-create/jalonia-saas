// Mots de passe : hachage argon2id (paramètres recommandés par l'OWASP) et politique minimale.
import { hash, verify } from "@node-rs/argon2";

// 19 Mio de mémoire, 2 passes, 1 fil d'exécution — l'algorithme par défaut de la bibliothèque est argon2id.
const PARAMETRES = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const MDP_LONGUEUR_MIN = 12;
export const MDP_LONGUEUR_MAX = 200;

/** Renvoie la clé d'erreur (traduisible) si le mot de passe ne respecte pas la politique, sinon null. */
export function controlerMotDePasse(motDePasse: string, email?: string): string | null {
  if (motDePasse.length < MDP_LONGUEUR_MIN) return "erreur.mdp_trop_court";
  if (motDePasse.length > MDP_LONGUEUR_MAX) return "erreur.mdp_trop_long";
  if (email && motDePasse.trim().toLowerCase() === email.trim().toLowerCase()) return "erreur.mdp_egal_email";
  return null;
}

export async function hacherMotDePasse(motDePasse: string): Promise<string> {
  return hash(motDePasse, PARAMETRES);
}

export async function verifierMotDePasse(empreinte: string, motDePasse: string): Promise<boolean> {
  try {
    return await verify(empreinte, motDePasse);
  } catch {
    return false; // empreinte illisible : on refuse
  }
}

// Empreinte « leurre » : quand l'e-mail est inconnu, on vérifie quand même un mot de passe contre elle,
// pour que la réponse prenne le même temps (on ne révèle pas quels comptes existent).
let empreinteLeurre: Promise<string> | undefined;
export function verifierContreLeurre(motDePasse: string): Promise<boolean> {
  empreinteLeurre ??= hacherMotDePasse("jalonia-leurre-pour-egaliser-les-temps-de-reponse");
  return empreinteLeurre.then((e) => verifierMotDePasse(e, motDePasse));
}
