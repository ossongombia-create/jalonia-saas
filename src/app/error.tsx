"use client";
// Erreur inattendue pendant l'affichage d'une page : message neutre (le détail reste dans les journaux du
// serveur, retrouvable grâce au code « digest »).
import { useSyncExternalStore } from "react";
import { estLangue, LANGUE_PAR_DEFAUT, traducteur } from "@/lib/i18n";

const sAbonner = () => () => {};
const langueDocument = () => document.documentElement.lang;
const langueServeur = () => LANGUE_PAR_DEFAUT;

export default function ErreurPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const lang = useSyncExternalStore(sAbonner, langueDocument, langueServeur);
  const t = traducteur(estLangue(lang) ? lang : LANGUE_PAR_DEFAUT);
  return (
    <div className="page-simple">
      <section className="carte">
        <h1>{t("page.erreur_titre")}</h1>
        <p>{t("erreur.inattendue")}</p>
        {error.digest ? <p className="discret petit">Code : {error.digest}</p> : null}
        <button type="button" className="bouton" onClick={() => retry()}>
          {t("page.reessayer")}
        </button>
      </section>
    </div>
  );
}
