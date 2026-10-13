// Plan d'actions de l'organisation (audit Q1). Lecture : tous les rôles. Création : droit actions.gerer.
import Link from "next/link";
import { jourLocal } from "@/lib/dates";
import { formaterJour } from "@/lib/format";
import { STATUTS_OUVERTS } from "@/lib/qse";
import { aLeDroit } from "@/lib/rbac";
import { poolApplication } from "@/server/db/pools";
import { listerActions, type FiltreActions } from "@/server/qse/actions";
import { exigerOrganisation } from "@/server/web/contexte";
import { titrePage } from "@/server/web/metadonnees";

export const generateMetadata = titrePage("actions.titre");

const FILTRES = ["ouvertes", "a_verifier", "toutes"] as const;

export default async function PageActions({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await exigerOrganisation("documents.lire");
  const { t, organisation, langue, fuseau } = ctx;
  const q = await searchParams;
  const statut: NonNullable<FiltreActions["statut"]> = (FILTRES as readonly string[]).includes(String(q.statut)) ? (q.statut as (typeof FILTRES)[number]) : "ouvertes";
  const miennes = q.miennes === "1";
  const documentId = typeof q.document === "string" ? q.document : undefined;
  const actions = await listerActions(poolApplication(), organisation, { statut, responsable: miennes ? ctx.acteur.id : undefined, documentId });
  const aujourdhui = jourLocal(new Date(), fuseau);
  // En retard : action ouverte dont l'échéance est passée (jours AAAA-MM-JJ : l'ordre alphabétique est l'ordre des dates).
  const enRetard = (a: (typeof actions)[number]) => (STATUTS_OUVERTS as readonly string[]).includes(a.statut) && a.echeance !== null && a.echeance < aujourdhui;

  return (
    <>
      <header className="entete">
        <div>
          <h1>{t("actions.titre")}</h1>
          <p>{t("actions.texte")}</p>
        </div>
        {aLeDroit(organisation.roles, "actions.gerer") ? (
          <Link className="bouton" href="/app/actions/nouvelle" id="nouvelle-action">{t("actions.nouvelle")}</Link>
        ) : null}
      </header>
      {aLeDroit(organisation.roles, "actions.gerer") ? null : <p className="bandeau bandeau-info">{t("actions.lecture_seule")}</p>}

      <form method="get" className="filtres">
        <label className="champ">
          <span>{t("actions.filtre")}</span>
          <select name="statut" defaultValue={statut}>
            {FILTRES.map((f) => <option key={f} value={f}>{t(`actions.filtre.${f}`)}</option>)}
          </select>
        </label>
        <label className="case">
          <input type="checkbox" name="miennes" value="1" defaultChecked={miennes} /> {t("actions.filtre.miennes")}
        </label>
        {documentId ? <input type="hidden" name="document" value={documentId} /> : null}
        <button type="submit" className="bouton bouton-second">{t("risques.afficher")}</button>
      </form>

      <section className="carte">
        {actions.length === 0 ? (
          <p className="vide">{t("actions.aucune")}</p>
        ) : (
          <div className="tableau-defilant">
            <table className="tableau" id="actions">
              <thead>
                <tr>
                  <th>{t("actions.champ.titre")}</th>
                  <th>{t("actions.champ.origine")}</th>
                  <th>{t("actions.element")}</th>
                  <th>{t("actions.champ.responsable")}</th>
                  <th>{t("actions.champ.echeance")}</th>
                  <th>{t("actions.champ.statut")}</th>
                </tr>
              </thead>
              <tbody>
                {actions.map((a) => (
                  <tr key={a.id} data-numero={a.numero} data-statut={a.statut}>
                    <td>
                      <Link href={`/app/actions/${a.id}`}><strong>{t("actions.numero", { n: a.numero })}</strong> — {a.titre}</Link>
                    </td>
                    <td>{t(`actions.origine.${a.origine}`)}</td>
                    <td className="texte-long">
                      {a.documentId ? <>{a.documentReference || a.documentTitre}{a.elementLibelle ? <><br /><span className="discret petit">{a.elementLibelle}</span></> : null}</> : "—"}
                    </td>
                    <td>{a.responsableNom || "—"}</td>
                    <td className="nowrap">
                      {formaterJour(langue, a.echeance)}
                      {enRetard(a) ? <> <span className="etiquette etiquette-alerte">{t("actions.en_retard")}</span></> : null}
                    </td>
                    <td>{t(`actions.statut.${a.statut}`)}</td>
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
