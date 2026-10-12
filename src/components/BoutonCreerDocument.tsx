"use client";
// Crée un document vierge (procédure ou instruction de travail), puis ouvre l'éditeur dessus.
// L'éditeur est une page à part (/editeur/index.html) : on y va par une navigation complète.
import { startTransition, useActionState, useEffect } from "react";
import { actionCreerDocument, type EtatCreation } from "@/actions/documents";
import { ETAT_INITIAL } from "@/lib/etat-action";

interface Props {
  organisationId: string;
  type: "procedure" | "instruction";
  libelle: string;
  libelleEnCours: string;
  secondaire?: boolean;
}

const INITIAL: EtatCreation = { ...ETAT_INITIAL, id: null };

export function BoutonCreerDocument({ organisationId, type, libelle, libelleEnCours, secondaire = false }: Props) {
  const [etat, envoyer, enCours] = useActionState(actionCreerDocument, INITIAL);

  useEffect(() => {
    // L'éditeur n'est pas une page Next.js mais un fichier statique (public/editeur) : navigation complète voulue.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    if (etat.ok && etat.id) window.location.assign(`/editeur/index.html?doc=${encodeURIComponent(etat.id)}`);
  }, [etat]);

  return (
    <form
      className="formulaire formulaire-ligne"
      onSubmit={(evenement) => {
        evenement.preventDefault();
        const donnees = new FormData(evenement.currentTarget);
        startTransition(() => envoyer(donnees));
      }}
    >
      <input type="hidden" name="organisationId" value={organisationId} />
      <input type="hidden" name="type" value={type} />
      <button type="submit" className={secondaire ? "bouton bouton-second" : "bouton"} disabled={enCours || (etat.ok && Boolean(etat.id))}>
        {enCours ? libelleEnCours : libelle}
      </button>
      {etat.message ? (
        <p role="status" className={etat.ok ? "message message-ok" : "message message-erreur"}>
          {etat.message}
        </p>
      ) : null}
    </form>
  );
}
