"use client";
// Formulaire relié à une action serveur : bouton désactivé pendant l'envoi, message de retour sous le
// formulaire. La saisie est CONSERVÉE en cas d'erreur, et vidée après un succès (si demandé).
import { startTransition, useActionState, useEffect, useRef, useState, type ReactNode } from "react";
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
  /** Libellés du lien renvoyé par l'action (ex. lien d'invitation), affiché avec un bouton « Copier ». */
  libellesLien?: LibellesLien;
  /** Libellés des codes de secours renvoyés par l'action (affichés une fois, à la place du formulaire). */
  libellesCodes?: LibellesCodes;
}

export interface LibellesCodes {
  titre: string;
  aide: string;
  copier: string;
  copie: string;
  continuer: string;
  /** Où mène « Continuer » (rechargement complet : la page est recalculée). */
  suite: string;
}

export interface LibellesLien {
  lien: string;
  copier: string;
  copie: string;
}

export function FormulaireAction({ action, libelle, libelleEnCours, children, vider = true, variante = "normal", className, confirmation, libellesLien, libellesCodes }: Props) {
  const [etat, envoyer, enCours] = useActionState(action, ETAT_INITIAL);
  const formulaire = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (etat.ok && vider) formulaire.current?.reset();
  }, [etat, vider]);

  if (etat.ok && etat.codes && libellesCodes) return <CodesSecours codes={etat.codes} message={etat.message} libelles={libellesCodes} />;

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
      {etat.ok && etat.lien && libellesLien ? <LienACopier key={etat.jeton} chemin={etat.lien} libelles={libellesLien} /> : null}
    </form>
  );
}

/** Lien complet (adresse de CE site + chemin), sélectionnable, avec un bouton « Copier ». */
function LienACopier({ chemin, libelles }: { chemin: string; libelles: LibellesLien }) {
  const champ = useRef<HTMLInputElement>(null);
  const [copie, setCopie] = useState(false);
  const adresse = `${window.location.origin}${chemin}`;
  async function copier() {
    champ.current?.select();
    try {
      await navigator.clipboard.writeText(adresse);
      setCopie(true);
    } catch {
      // Presse-papiers refusé par le navigateur : le lien reste sélectionné, la personne le copie elle-même.
    }
  }
  return (
    <div className="lien-a-copier">
      <label className="champ">
        <span>{libelles.lien}</span>
        <input ref={champ} type="text" readOnly value={adresse} onFocus={(e) => e.currentTarget.select()} spellCheck={false} />
      </label>
      <button type="button" className="bouton bouton-second" onClick={copier}>
        {copie ? libelles.copie : libelles.copier}
      </button>
    </div>
  );
}

/** Codes de secours affichés UNE fois, avec « Copier » ; « Continuer » recharge la page (ou mène à la suite). */
function CodesSecours({ codes, message, libelles }: { codes: string[]; message: string | null; libelles: LibellesCodes }) {
  const [copie, setCopie] = useState(false);
  async function copier() {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      setCopie(true);
    } catch {
      // Presse-papiers refusé : les codes restent affichés, à recopier.
    }
  }
  return (
    <div className="codes-secours">
      {message ? (
        <p role="status" className="message message-ok">
          {message}
        </p>
      ) : null}
      <h2>{libelles.titre}</h2>
      <p>{libelles.aide}</p>
      <ol className="liste-codes">
        {codes.map((c) => (
          <li key={c}>
            <code>{c}</code>
          </li>
        ))}
      </ol>
      <div className="actions-ligne">
        <button type="button" className="bouton bouton-second" onClick={copier}>
          {copie ? libelles.copie : libelles.copier}
        </button>
        <a className="bouton" href={libelles.suite}>
          {libelles.continuer}
        </a>
      </div>
    </div>
  );
}
