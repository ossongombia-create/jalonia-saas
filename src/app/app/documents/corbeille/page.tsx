// Corbeille des documents (audit S5, D1) : les documents mis à la corbeille, avec tout leur historique. Ils se rétablissent
// avec le droit de suppression ; ils ne sont jamais effacés par l'application. Lecture : tous les rôles de l'organisation.
import Link from "next/link";
import { actionRetablirDocument } from "@/actions/documents";
import { FormulaireAction } from "@/components/FormulaireAction";
import { formaterDate } from "@/lib/format";
import { aLeDroit } from "@/lib/rbac";
import { poolApplication } from "@/server/db/pools";
import { listerCorbeille } from "@/server/documents/versions";
import { exigerOrganisation } from "@/server/web/contexte";
import { titrePage } from "@/server/web/metadonnees";

export const generateMetadata = titrePage("corbeille.titre");

export default async function PageCorbeille() {
  const ctx = await exigerOrganisation("documents.lire");
  const { t, organisation, langue, fuseau } = ctx;
  const documents = await listerCorbeille(poolApplication(), organisation);
  const peutRetablir = aLeDroit(organisation.roles, "documents.supprimer");

  return (
    <>
      <header className="entete">
        <div>
          <p><Link href="/app/documents">{t("versions.retour")}</Link></p>
          <h1>{t("corbeille.titre")}</h1>
          <p>{t("corbeille.texte")}</p>
        </div>
      </header>
      <section className="carte">
        {documents.length === 0 ? (
          <p className="vide">{t("corbeille.vide")}</p>
        ) : (
          <div className="tableau-defilant">
            <table className="tableau" id="corbeille">
              <thead>
                <tr>
                  <th>{t("docs.type")}</th>
                  <th>{t("docs.code")}</th>
                  <th>{t("docs.intitule")}</th>
                  <th>{t("corbeille.supprime")}</th>
                  <th>{t("commun.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <span className={d.type === "instruction" ? "etiquette etiquette-violet" : "etiquette"}>
                        {t(d.type === "procedure" ? "docs.type.procedure" : d.type === "instruction" ? "docs.type.instruction" : "docs.type.aucun")}
                      </span>
                    </td>
                    <td className="nowrap">{d.reference || "—"}</td>
                    <td>{d.titre ? <strong>{d.titre}</strong> : <span className="discret">{t("docs.sans_titre")}</span>}</td>
                    <td className="nowrap">
                      {formaterDate(langue, d.supprimeLe, fuseau)}
                      <br />
                      <span className="discret petit">{t("docs.par", { nom: d.supprimeParNom })}</span>
                    </td>
                    <td>
                      <div className="actions-ligne">
                        <Link className="bouton bouton-second" href={`/app/documents/${d.id}/historique`}>{t("docs.historique")}</Link>
                        {peutRetablir ? (
                          <FormulaireAction action={actionRetablirDocument} libelle={t("corbeille.retablir")} libelleEnCours={t("commun.en_cours")} variante="ligne" vider={false}>
                            <input type="hidden" name="organisationId" value={organisation.id} />
                            <input type="hidden" name="documentId" value={d.id} />
                          </FormulaireAction>
                        ) : null}
                      </div>
                    </td>
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
