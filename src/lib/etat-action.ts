// État renvoyé par une action serveur à son formulaire (via useActionState).
export interface EtatAction {
  ok: boolean;
  /** Message déjà traduit, à afficher sous le formulaire. */
  message: string | null;
  /** Change à chaque réponse : permet de vider un formulaire après un succès. */
  jeton: number;
  /** Lien à transmettre (chemin du site, ex. invitation), affiché avec un bouton « Copier ». */
  lien?: string;
  /** Codes de secours à noter, montrés une seule fois. */
  codes?: string[];
}

export const ETAT_INITIAL: EtatAction = { ok: false, message: null, jeton: 0 };
