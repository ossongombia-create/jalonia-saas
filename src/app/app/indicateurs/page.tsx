// Registre des indicateurs (audit Q1) : indicateurs portés par les instructions des procédures (versions publiées par
// défaut), objectif chiffré, dernière mesure et situation. Lecture : tous les rôles.
import Link from "next/link";
import { formaterJour } from "@/lib/format";
import { formaterNombre, texteObjectif } from "@/lib/affichage-qse";
import { poolApplication } from "@/server/db/pools";
import { estPortee } from "@/server/qse/registres";
import { lireRegistreIndicateurs } from "@/server/qse/vues";
import { exigerOrganisation } from "@/server/web/contexte";
import { titrePage } from "@/server/web/metadonnees";

export const generateMetadata = titrePage("indicateurs.titre");

export default async function PageIndicateurs({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await exigerOrganisation("documents.lire");
  const { t, organisation, langue } = ctx;
  const q = await searchParams;
  const portee = estPortee(q.portee) ? q.portee : "publies";
  const lignes = await lireRegistreIndicateurs(poolApplication(), organisation, portee);

  return (
    <>
      <header className="entete">
        <div>
          <h1>{t("indicateurs.titre")}</h1>
          <p>{t("indicateurs.texte")}</p>
        </div>
      </header>
      <form method="get" className="filtres">
        <label className="champ">
          <span>{t("risques.portee")}</span>
          <select name="portee" defaultValue={portee}>
            <option value="publies">{t("risques.portee.publies")}</option>
            <option value="tous">{t("risques.portee.tous")}</option>
          </select>
        </label>
        <button type="submit" className="bouton bouton-second">{t("risques.afficher")}</button>
      </form>
      <section className="carte">
        {lignes.length === 0 ? (
          <p className="vide">{t("indicateurs.aucun")}</p>
        ) : (
          <div className="tableau-defilant">
            <table className="tableau" id="registre-indicateurs">
              <thead>
                <tr>
                  <th>{t("indicateurs.nom")}</th>
                  <th>{t("risques.document")}</th>
                  <th>{t("indicateurs.cible")}</th>
                  <th>{t("indicateurs.objectif")}</th>
                  <th>{t("indicateurs.derniere")}</th>
                  <th>{t("indicateurs.situation")}</th>
                </tr>
              </thead>
              <tbody>
                {lignes.map((i) => (
                  <tr key={`${i.documentId}:${i.id}`} data-document={i.documentId} data-element={i.id} data-situation={i.situation}>
                    <td>
                      <Link href={`/app/indicateurs/detail?document=${encodeURIComponent(i.documentId)}&element=${encodeURIComponent(i.id)}`}><strong>{i.nom || "—"}</strong></Link>
                      {i.formule ? <><br /><span className="discret petit">{t("indicateurs.formule")} : {i.formule}</span></> : null}
                      {i.frequence ? <><br /><span className="discret petit">{t("indicateurs.frequence")} : {i.frequence}</span></> : null}
                    </td>
                    <td>
                      {i.reference && i.titre ? `${i.reference} — ${i.titre}` : i.reference || i.titre}
                      <br />
                      <span className="discret petit">{t("risques.instruction_n", { n: i.etapeRang, libelle: i.etapeLibelle || "—" })}</span>
                    </td>
                    <td>{i.cible || "—"}</td>
                    <td className="nowrap">{i.objectif ? texteObjectif(t, langue, i.objectif) : "—"}</td>
                    <td className="nowrap">{i.derniere ? <>{formaterNombre(langue, i.derniere.valeur)}{i.objectif?.unite ? ` ${i.objectif.unite}` : ""}<br /><span className="discret petit">{formaterJour(langue, i.derniere.date)}</span></> : "—"}</td>
                    <td><span className={`etiquette etiquette-situation-${i.situation}`}>{t(`indicateur.situation.${i.situation}`)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
