// Registre des risques et des opportunités (audit Q1), tiré des instructions des procédures : versions publiées par
// défaut (en application), ou versions en cours. Lecture : tous les rôles. « Ouvrir une action » : droit actions.gerer.
import Link from "next/link";
import type { Traducteur } from "@/lib/i18n";
import { aLeDroit } from "@/lib/rbac";
import { poolApplication } from "@/server/db/pools";
import { estPortee, type Source } from "@/server/qse/registres";
import { lireRegistreRisques } from "@/server/qse/vues";
import { exigerOrganisation } from "@/server/web/contexte";
import { titrePage } from "@/server/web/metadonnees";

export const generateMetadata = titrePage("risques.titre");

function CelluleDocument({ s, t }: { s: Source; t: Traducteur }) {
  const nom = s.reference && s.titre ? `${s.reference} — ${s.titre}` : s.reference || s.titre || t("docs.sans_titre");
  return (
    <td>
      <Link href={`/app/documents/${s.documentId}/validation`}>{nom}</Link>
      <br />
      <span className="discret petit">{t(s.publiee ? "risques.version" : "risques.version_en_cours", { v: s.version })}</span>
    </td>
  );
}

export default async function PageRisques({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await exigerOrganisation("documents.lire");
  const { t, organisation } = ctx;
  const q = await searchParams;
  const portee = estPortee(q.portee) ? q.portee : "publies";
  const registre = await lireRegistreRisques(poolApplication(), organisation, portee);
  const peutAgir = aLeDroit(organisation.roles, "actions.gerer");
  const enCours = (s: Source, id: string) => registre.actions.get(`${s.documentId}:${id}`) ?? 0;
  const lienAction = (s: Source, id: string) => `/app/actions/nouvelle?document=${encodeURIComponent(s.documentId)}&element=${encodeURIComponent(id)}`;
  const instruction = (s: Source) => t("risques.instruction_n", { n: s.etapeRang, libelle: s.etapeLibelle || "—" });

  return (
    <>
      <header className="entete">
        <div>
          <h1>{t("risques.titre")}</h1>
          <p>{t("risques.texte")}</p>
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
        <h2>{t("risques.risques")}</h2>
        {registre.risques.length === 0 ? (
          <p className="vide">{t("risques.aucun")}</p>
        ) : (
          <div className="tableau-defilant">
            <table className="tableau" id="registre-risques">
              <thead>
                <tr>
                  <th>{t("risques.document")}</th>
                  <th>{t("risques.instruction")}</th>
                  <th>{t("risques.risque")}</th>
                  <th>{t("risques.cotation")}</th>
                  <th>{t("risques.mesure")}</th>
                  <th>{t("risques.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {registre.risques.map((r) => (
                  <tr key={`${r.documentId}:${r.id}`} data-document={r.documentId} data-element={r.id} data-niveau={r.niveau ?? "non_cote"}>
                    <CelluleDocument s={r} t={t} />
                    <td>{instruction(r)}</td>
                    <td className="texte-long">
                      <strong>{r.risque || "—"}</strong>
                      {r.causes ? <><br /><span className="discret petit">{t("risques.causes")} : {r.causes}</span></> : null}
                    </td>
                    <td className="nowrap">
                      {r.niveau ? (
                        <>
                          {r.gravite} × {r.probabilite} = {r.criticite}{" "}
                          <span className={`etiquette etiquette-niveau-${r.niveau}`}>{t(`risque.niveau.${r.niveau}`)}</span>
                        </>
                      ) : (
                        <span className="discret">{t("risque.non_cote")}</span>
                      )}
                    </td>
                    <td className="texte-long">{r.mesure || "—"}</td>
                    <td className="nowrap">
                      {enCours(r, r.id) > 0 ? (
                        <Link href={`/app/actions?document=${r.documentId}`}>{t("risques.n_actions", { n: enCours(r, r.id) })}</Link>
                      ) : null}
                      {peutAgir ? <>{enCours(r, r.id) > 0 ? <br /> : null}<Link className="bouton bouton-discret" href={lienAction(r, r.id)}>{t("risques.creer_action")}</Link></> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="carte" id="opportunites">
        <h2>{t("risques.opportunites")}</h2>
        {registre.opportunites.length === 0 ? (
          <p className="vide">{t("risques.aucune_opportunite")}</p>
        ) : (
          <div className="tableau-defilant">
            <table className="tableau" id="registre-opportunites">
              <thead>
                <tr>
                  <th>{t("risques.document")}</th>
                  <th>{t("risques.instruction")}</th>
                  <th>{t("risques.opportunite")}</th>
                  <th>{t("risques.score")}</th>
                  <th>{t("risques.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {registre.opportunites.map((o) => (
                  <tr key={`${o.documentId}:${o.id}`} data-document={o.documentId} data-element={o.id} data-suite={o.suite ?? "non_cote"}>
                    <CelluleDocument s={o} t={t} />
                    <td>{instruction(o)}</td>
                    <td className="texte-long">
                      <strong>{o.opportunite || "—"}</strong>
                      {o.benefice ? <><br /><span className="discret petit">{t("risques.benefice")} : {o.benefice}</span></> : null}
                    </td>
                    <td className="nowrap">
                      {o.suite ? <>{o.interet} × {o.faisabilite} = {o.score} <span className="etiquette">{t(`opportunite.suite.${o.suite}`)}</span></> : <span className="discret">{t("risque.non_cote")}</span>}
                    </td>
                    <td className="nowrap">
                      {enCours(o, o.id) > 0 ? <Link href={`/app/actions?document=${o.documentId}`}>{t("risques.n_actions", { n: enCours(o, o.id) })}</Link> : null}
                      {peutAgir ? <>{enCours(o, o.id) > 0 ? <br /> : null}<Link className="bouton bouton-discret" href={lienAction(o, o.id)}>{t("risques.creer_action")}</Link></> : null}
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
