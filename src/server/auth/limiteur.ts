// Limiteur de travaux simultanés (sémaphore avec file d'attente bornée).
// Sert à plafonner les calculs argon2id : chacun réserve ~19 Mio de mémoire ; sans plafond, quelques dizaines de
// tentatives de connexion simultanées suffiraient à épuiser la mémoire du service.
// Au-delà de la file d'attente, la demande est refusée tout de suite (ErreurOccupe) au lieu de s'accumuler.

export class ErreurOccupe extends Error {
  constructor() {
    super("serveur occupé");
    this.name = "ErreurOccupe";
  }
}

export interface Limiteur {
  executer<T>(travail: () => Promise<T>): Promise<T>;
  /** Pour les tests et la surveillance : travaux en cours et en attente. */
  etat(): { enCours: number; enAttente: number };
}

export function creerLimiteur(maxSimultanes: number, maxEnAttente: number): Limiteur {
  if (!Number.isInteger(maxSimultanes) || maxSimultanes < 1) throw new Error("maxSimultanes invalide");
  if (!Number.isInteger(maxEnAttente) || maxEnAttente < 0) throw new Error("maxEnAttente invalide");
  let enCours = 0;
  const attente: (() => void)[] = [];

  function liberer() {
    const suivant = attente.shift();
    if (suivant) suivant(); // la place passe directement au suivant : enCours ne change pas
    else enCours -= 1;
  }

  return {
    async executer<T>(travail: () => Promise<T>): Promise<T> {
      if (enCours < maxSimultanes) {
        enCours += 1;
      } else {
        if (attente.length >= maxEnAttente) throw new ErreurOccupe();
        await new Promise<void>((resoudre) => attente.push(resoudre));
      }
      try {
        return await travail();
      } finally {
        liberer();
      }
    },
    etat: () => ({ enCours, enAttente: attente.length }),
  };
}
