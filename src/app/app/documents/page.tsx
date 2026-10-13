// Documents de l'organisation : la cartographie des processus (niveau 1, une par organisation) et la liste des
// procédures (niveau 2) et instructions de travail (niveau 3). Chacun s'ouvre dans l'éditeur Qualigramme
// (/editeur/index.html), qui enregistre automatiquement sur le serveur.
// Lecture : tous les rôles de l'organisation. Création : rédaction. Suppression : droit de suppression.
// La section « Cohérence » signale les incohérences ENTRE documents (codes, instructions de travail, sous-procédures,
// processus) : elle ne modifie rien. La suppression d'un document lié à d'autres avertit et demande confirmation.
import { actionSupprimerDocument } from "@/actions/documents";
import { BoutonCreerDocument } from "@/components/BoutonCreerDocument";
import { FormulaireAction } from "@/components/FormulaireAction";
import { formaterDate } from "@/lib/format";
import { aLeDroit } from "@/lib/rbac";
import { poolApplication } from "@/server/db/pools";
import { lireCartographie, lireCoherence, listerDocuments } from "@/server/documents/service";
import type { DocumentCite } from "@/server/documents/coherence";
import { exigerOrganisation } from "@/server/web/contexte";
import { titrePage } from "@/server/web/metadonnees";

export const generateMetadata = titrePage("docs.titre");

const EDITEUR = "/editeur/index.html";

export default async function PageDocuments() {
  const ctx = await exigerOrganisation("documents.lire");
  const { t, organisation, langue, fuseau } = ctx;
  const pool = poolApplication();
  const [documents, cartographie, coherence] = await Promise.all([listerDocuments(pool, organisation), lireCartographie(pool, organisation), lireCoherence(pool, organisation)]);
  const aVerifier = new Set(coherence.constats.filter((c) => c.gravite === "alerte").flatMap((c) => c.documents.map((d) => d.id)));
  const nomDe = (d: DocumentCite) => (d.reference && d.titre ? `${d.reference} — ${d.titre}` : d.reference || d.titre || t("docs.sans_titre"));
  const peutRediger = aLeDroit(organisation.roles, "documents.rediger");
  const peutSupprimer = aLeDroit(organisation.roles, "documents.supprimer");

  return (
    <>
      <header className="entete">
        <div>
          <h1>{t("docs.titre")}</h1>
          <p>{t("docs.texte")}</p>
        </div>
        {peutRediger ? (
          <div className="actions-ligne">
            <BoutonCreerDocument organisationId={organisation.id} type="procedure" libelle={t("docs.nouvelle_procedure")} libelleEnCours={t("docs.creation")} />
            <BoutonCreerDocument organisationId={organisation.id} type="instruction" libelle={t("docs.nouvelle_instruction")} libelleEnCours={t("docs.creation")} secondaire />
          </div>
        ) : null}
      </header>

      {peutRediger ? null : <p className="bandeau bandeau-info">{t("docs.lecture_seule")}</p>}

      <section className="carte">
        <h2>{t("docs.cartographie")}</h2>
        <p>{t("docs.cartographie_texte")}</p>
        <p className="discret petit">
          {cartographie.version > 0 && cartographie.modifieLe
            ? t("docs.cartographie_maj", { date: formaterDate(langue, cartographie.modifieLe, fuseau), nom: cartographie.modifieParNom })
            : t("docs.cartographie_jamais")}
        </p>
        <a className="bouton bouton-second" href={`${EDITEUR}?vue=cartographie`}>
          {t("docs.cartographie_ouvrir")}
        </a>
      </section>

      <section className="carte">
        <h2>{t("docs.liste")}</h2>
        {documents.length === 0 ? (
          <p className="vide">{t("docs.aucun")}</p>
        ) : (
          <div className="tableau-defilant">
            <table className="tableau">
              <thead>
                <tr>
                  <th>{t("docs.type")}</th>
                  <th>{t("docs.code")}</th>
                  <th>{t("docs.intitule")}</th>
                  <th>{t("docs.modifie")}</th>
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
                    <td className="nowrap">
                      {d.reference || "—"}
                      {aVerifier.has(d.id) ? (
                        <>
                          <br />
                          <a className="etiquette etiquette-alerte" href="#coherence">{t("docs.a_verifier")}</a>
                        </>
                      ) : null}
                    </td>
                    <td>{d.titre ? <strong>{d.titre}</strong> : <span className="discret">{t("docs.sans_titre")}</span>}</td>
                    <td className="nowrap">
                      {formaterDate(langue, d.modifieLe, fuseau)}
                      <br />
                      <span className="discret petit">{t("docs.par", { nom: d.modifieParNom })}</span>
                    </td>
                    <td>
                      <div className="actions-ligne">
                        <a className="bouton bouton-second" href={`${EDITEUR}?doc=${encodeURIComponent(d.id)}`}>
                          {t("docs.ouvrir")}
                        </a>
                        {peutSupprimer ? (
                          <FormulaireAction
                            action={actionSupprimerDocument}
                            libelle={t("docs.supprimer")}
                            libelleEnCours={t("commun.en_cours")}
                            variante="danger"
                            vider={false}
                            confirmation={
                              coherence.dependances[d.id]
                                ? t("docs.confirmer_suppression_liens", {
                                    titre: d.titre || d.reference || t("docs.sans_titre"),
                                    n: coherence.dependances[d.id]!.length,
                                    liste: coherence.dependances[d.id]!.map((l) => `${nomDe(l)} (${t(`docs.lien.${l.lien}`)})`).join(" ; "),
                                  })
                                : t("docs.confirmer_suppression", { titre: d.titre || d.reference || t("docs.sans_titre") })
                            }
                          >
                            <input type="hidden" name="organisationId" value={organisation.id} />
                            <input type="hidden" name="documentId" value={d.id} />
                            {coherence.dependances[d.id] ? <input type="hidden" name="confirmerLiens" value="1" /> : null}
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

      {documents.length > 0 ? (
        <section className="carte" id="coherence">
          <h2>{t("coherence.titre")}</h2>
          <p className="discret">{t("coherence.texte")}</p>
          {coherence.constats.length === 0 ? (
            <p className="vide">{t("coherence.aucun")}</p>
          ) : (
            <ul className="liste-constats">
              {coherence.constats.map((c, i) => (
                <li key={`${c.cle}-${c.code ?? c.processus ?? ""}-${i}`} className={c.gravite === "alerte" ? "constat constat-alerte" : "constat"}>
                  <span className={c.gravite === "alerte" ? "etiquette etiquette-alerte" : "etiquette"}>{t(c.gravite === "alerte" ? "coherence.alerte" : "coherence.info")}</span>{" "}
                  {t(`coherence.${c.cle}`, { code: c.code ?? "", processus: c.processus ?? "" })}
                  <ul>
                    {c.documents.map((d) => (
                      <li key={d.id}>
                        <a href={`${EDITEUR}?doc=${encodeURIComponent(d.id)}`}>{nomDe(d)}</a>{" "}
                        <span className="discret petit">({t(d.type === "procedure" ? "docs.type.procedure" : d.type === "instruction" ? "docs.type.instruction" : "docs.type.aucun")})</span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </>
  );
}
