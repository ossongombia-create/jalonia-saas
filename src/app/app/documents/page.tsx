// Documents de l'organisation : la cartographie des processus (niveau 1, une par organisation) et la liste des
// procédures (niveau 2) et instructions de travail (niveau 3). Chacun s'ouvre dans l'éditeur Qualigramme
// (/editeur/index.html), qui enregistre automatiquement sur le serveur.
// Lecture : tous les rôles de l'organisation. Création : rédaction. Suppression (brouillons seulement) : droit de suppression.
// Chaque document a son état dans le circuit de validation (page « Validation » : circuit.ts).
// La section « Cohérence » signale les incohérences ENTRE documents (codes, instructions de travail, sous-procédures,
// processus) : elle ne modifie rien. La suppression d'un document lié à d'autres avertit et demande confirmation.
import { actionSupprimerDocument } from "@/actions/documents";
import { BoutonCreerDocument } from "@/components/BoutonCreerDocument";
import { FormulaireAction } from "@/components/FormulaireAction";
import { jourLocal } from "@/lib/dates";
import { formaterDate, formaterJour } from "@/lib/format";
import { aLeDroit } from "@/lib/rbac";
import { poolApplication } from "@/server/db/pools";
import Link from "next/link";
import { lireCartographie, lireCoherence, listerDocuments } from "@/server/documents/service";
import { listerCorbeille } from "@/server/documents/versions";
import { lireParametresOrganisation, revueDe } from "@/server/documents/revues";
import type { DocumentCite } from "@/server/documents/coherence";
import { exigerOrganisation } from "@/server/web/contexte";
import { titrePage } from "@/server/web/metadonnees";

export const generateMetadata = titrePage("docs.titre");

// Modèle de fiche de collecte (FC-JAL, scripts/fiche-collecte/construire-fiche.py) : à remplir en entretien, puis à importer
// dans l'éditeur (menu Fichier → « Importer une fiche de collecte (Excel) »).
const FICHE_COLLECTE = "/modeles/FC-JAL_Fiche_de_collecte.xlsx";
const EDITEUR = "/editeur/index.html";

export default async function PageDocuments() {
  const ctx = await exigerOrganisation("documents.lire");
  const { t, organisation, langue, fuseau } = ctx;
  const pool = poolApplication();
  const [documents, cartographie, coherence, corbeille, parametres] = await Promise.all([
    listerDocuments(pool, organisation), lireCartographie(pool, organisation), lireCoherence(pool, organisation), listerCorbeille(pool, organisation),
    lireParametresOrganisation(pool, organisation),
  ]);
  const aujourdhui = jourLocal(new Date(), fuseau);
  const aVerifier = new Set(coherence.constats.filter((c) => c.gravite === "alerte").flatMap((c) => c.documents.map((d) => d.id)));
  const nomDe = (d: DocumentCite) => (d.reference && d.titre ? `${d.reference} — ${d.titre}` : d.reference || d.titre || t("docs.sans_titre"));
  const peutRediger = aLeDroit(organisation.roles, "documents.rediger");
  const peutSupprimer = aLeDroit(organisation.roles, "documents.supprimer");
  const peutValider = aLeDroit(organisation.roles, "documents.verifier") || aLeDroit(organisation.roles, "documents.approuver");

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

      {peutRediger ? null : <p className="bandeau bandeau-info">{t(peutValider ? "docs.role_validation" : "docs.lecture_seule")}</p>}

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

      <section className="carte" id="fiche-collecte">
        <h2>{t("docs.fiche_collecte")}</h2>
        <p>{t("docs.fiche_collecte_texte")}</p>
        <a className="bouton bouton-second" href={FICHE_COLLECTE} download>
          {t("docs.fiche_collecte_telecharger")}
        </a>
      </section>

      <section className="carte">
        <div className="titre-ligne">
          <h2>{t("docs.liste")}</h2>
          <Link className="bouton bouton-discret" href="/app/documents/corbeille" id="lien-corbeille">{t("docs.corbeille_lien", { n: corbeille.length })}</Link>
        </div>
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
                  <th>{t("docs.etat")}</th>
                  <th>{t("docs.modifie")}</th>
                  <th>{t("commun.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((d) => (
                  <tr key={d.id} data-etat={d.etat}>
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
                      <span className={`etiquette etiquette-etat-${d.etat}`}>{t(`etat.${d.etat}`)}</span>
                      {d.versionPubliee !== null && d.etat !== "publie" ? (
                        <>
                          <br />
                          <span className="discret petit">{t("docs.publiee", { v: d.versionPubliee })}</span>
                        </>
                      ) : null}
                      {(() => {
                        const revue = revueDe(d, parametres, fuseau, aujourdhui);
                        if (!revue) return null;
                        return (
                          <>
                            <br />
                            {revue.situation === "a_jour" ? (
                              <span className="discret petit">{t("revue.avant", { date: formaterJour(langue, revue.echeance) })}</span>
                            ) : (
                              <span className="etiquette etiquette-alerte" data-revue={revue.situation}>
                                {t(revue.situation === "proche" ? "revue.etiquette.proche" : "revue.etiquette.retard")}
                              </span>
                            )}
                          </>
                        );
                      })()}
                    </td>
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
                        <Link className="bouton bouton-discret" href={`/app/documents/${d.id}/validation`}>{t("docs.validation")}</Link>
                        <Link className="bouton bouton-discret" href={`/app/documents/${d.id}/historique`}>{t("docs.historique")}</Link>
                        {peutSupprimer && d.etat === "brouillon" ? (
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
