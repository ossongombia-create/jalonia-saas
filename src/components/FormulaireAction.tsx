"use client";
// Formulaire relié à une action serveur : bouton désactivé pendant l'envoi, message de retour sous le
// formulaire. La saisie est CONSERVÉE en cas d'erreur, et vidée après un succès (si demandé).
import { startTransition, useActionState, useEffect, useRef, type ReactNode } from "react";
import { ETAT_INITIAL, type EtatAction } from "@/lib/etat-action";

interface Props {
  action: (etat: EtatAction, donnees: FormData) => Promise<EtatAction>;
  libelle: string;
  libelleEnCours: string;
  children?: ReactNode;
  /** Vider les champs après un succès (vrai par défaut). */
  vider?: boolean;
  /** « ligne » : bouton compact à côté des champs ; « danger » : bouton d'action sensible. */
  variante?: "normal" | "ligne" | "danger" | "discret";
  className?: string;
  /** Question posée avant l'envoi (action sensible : suppression…). Réponse « Annuler » : rien n'est envoyé. */
  confirmation?: string;
}

export function FormulaireAction({ action, libelle, libelleEnCours, children, vider = true, variante = "normal", className, confirmation }: Props) {
  const [etat, envoyer, enCours] = useActionState(action, ETAT_INITIAL);
  const formulaire = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (etat.ok && vider) formulaire.current?.reset();
  }, [etat, vider]);

  const classeBouton = variante === "danger" ? "bouton bouton-danger" : variante === "discret" ? "bouton bouton-discret" : variante === "ligne" ? "bouton bouton-second" : "bouton";

  return (
    <form
      ref={formulaire}
      className={`formulaire formulaire-${variante} ${className ?? ""}`}
      onSubmit={(evenement) => {
        evenement.preventDefault();
        if (confirmation && !window.confirm(confirmation)) return;
        const donnees = new FormData(evenement.currentTarget);
        startTransition(() => envoyer(donnees));
      }}
    >
      {children}
      <div className="formulaire-pied">
        <button type="submit" className={classeBouton} disabled={enCours}>
          {enCours ? libelleEnCours : libelle}
        </button>
        {etat.message ? (
          <p role="status" className={etat.ok ? "message message-ok" : "message message-erreur"}>
            {etat.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
