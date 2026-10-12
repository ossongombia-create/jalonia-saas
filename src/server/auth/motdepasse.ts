// Mots de passe : hachage argon2id (paramètres recommandés par l'OWASP) et politique minimale.
// Les calculs argon2id passent par un limiteur : au plus 4 à la fois, 64 en attente, au-delà refus immédiat
// (ErreurOccupe). Un afflux de tentatives ne peut donc pas épuiser la mémoire du service (19 Mio par calcul).
import { hash, verify } from "@node-rs/argon2";
import { creerLimiteur } from "./limiteur";

export { ErreurOccupe } from "./limiteur";

// 19 Mio de mémoire, 2 passes, 1 fil d'exécution — l'algorithme par défaut de la bibliothèque est argon2id.
const PARAMETRES = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;
export const CALCULS_SIMULTANES = 4;
export const CALCULS_EN_ATTENTE = 64;
const limiteur = creerLimiteur(CALCULS_SIMULTANES, CALCULS_EN_ATTENTE);

export const MDP_LONGUEUR_MIN = 12;
export const MDP_LONGUEUR_MAX = 200;

/** Renvoie la clé d'erreur (traduisible) si le mot de passe ne respecte pas la politique, sinon null. */
export function controlerMotDePasse(motDePasse: string, email?: string): string | null {
  if (motDePasse.length < MDP_LONGUEUR_MIN) return "erreur.mdp_trop_court";
  if (motDePasse.length > MDP_LONGUEUR_MAX) return "erreur.mdp_trop_long";
  if (email && motDePasse.trim().toLowerCase() === email.trim().toLowerCase()) return "erreur.mdp_egal_email";
  return null;
}

/** Lève ErreurOccupe si trop de calculs sont déjà en cours ou en attente. */
export async function hacherMotDePasse(motDePasse: string): Promise<string> {
  return limiteur.executer(() => hash(motDePasse, PARAMETRES));
}

/** Lève ErreurOccupe si trop de calculs sont déjà en cours ou en attente ; une empreinte illisible donne « faux ». */
export async function verifierMotDePasse(empreinte: string, motDePasse: string): Promise<boolean> {
  return limiteur.executer(async () => {
    try {
      return await verify(empreinte, motDePasse);
    } catch {
      return false; // empreinte illisible : on refuse
    }
  });
}

// Empreinte « leurre » : quand l'e-mail est inconnu, on vérifie quand même un mot de passe contre elle,
// pour que la réponse prenne le même temps (on ne révèle pas quels comptes existent). Empreinte fixe d'une valeur
// aléatoire jetée, avec les MÊMES paramètres que les vraies (même durée de calcul) ; elle ne protège rien.
const EMPREINTE_LEURRE = "$argon2id$v=19$m=19456,t=2,p=1$RKthoKUkeiE9sjejKAtuzw$JqATi4gjlfhcrHtoowfRrM44A0McHqOwPYOnW5gFs7k";
export function verifierContreLeurre(motDePasse: string): Promise<boolean> {
  return verifierMotDePasse(EMPREINTE_LEURRE, motDePasse);
}
