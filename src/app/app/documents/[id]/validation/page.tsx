// Validation d'un document (audit W1, W3) : état dans le circuit, décisions possibles pour la personne connectée,
// décisions passées (trace d'approbation : version, motif, empreinte SHA-256 du contenu — pas une signature électronique).
// Lecture : tous les rôles de l'organisation. Chaque décision : le droit correspondant (circuit.ts), revérifié par le serveur.
// Soumettre, vérifier, approuver : NOM (celui du compte, non modifiable) et FONCTION (obligatoire) ; aucune signature.
import Link from "next/link";
import { notFound } from "next/navigation";
import { actionTransitionDocument } from "@/actions/documents";
import { FormulaireAction } from "@/components/FormulaireAction";
import { jourLocal } from "@/lib/dates";
import { formaterDate, formaterJour } from "@/lib/format";
import { identifiant } from "@/lib/validation";
import { poolApplication } from "@/server/db/pools";
import { ETATS, FONCTION_MAX, LISTE_TRANSITIONS, MOTIF_MAX, TRANSITIONS, demandeFonction, derniereFonction, lireCircuit, refusTransition, transitionsPossibles, type ContexteDecision } from "@/server/documents/circuit";
import { lireEtatSecondFacteur } from "@/server/auth/second-facteur";
import { lireParametresOrganisation, revueDe } from "@/server/documents/revues";
import { nomActeur } from "@/server/acteur";
import { exigerOrganisation } from "@/server/web/contexte";
import { titrePage } from "@/server/web/metadonnees";

export const generateMetadata = titrePage("circuit.titre");

const EDITEUR = "/editeur/index.html";

export default async function PageValidation({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await exigerOrganisation("documents.lire");
  const { t, organisation, langue, fuseau, acteur } = ctx;
  const lu = identifiant.safeParse((await params).id);
  if (!lu.success) notFound();
  const circuit = await lireCircuit(poolApplication(), organisation, lu.data);
  if (!circuit) notFound();
  const revue = revueDe(circuit, await lireParametresOrganisation(poolApplication(), organisation), fuseau, jourLocal(new Date(), fuseau));

  // Mode de validation de l'organisation et second facteur de la personne (le serveur les relit à chaque décision).
  const decision: ContexteDecision = { mode: organisation.modeValidation, secondFacteurActif: (await lireEtatSecondFacteur(poolApplication(), acteur.id)).actif };
  const possibles = transitionsPossibles(circuit.etat, organisation.roles, acteur.id, circuit.intervenants, decision);
  // Fonction pré-remplie : la dernière saisie par la personne dans cette organisation.
  const fonctionConnue = possibles.some(demandeFonction) ? await derniereFonction(poolApplication(), organisation, acteur.id) : "";
  // Décisions que le rôle permettrait mais que la séparation des tâches réserve à une autre personne, ou qui attendent
  // le second facteur : on dit pourquoi.
  const separations = [...new Set(
    LISTE_TRANSITIONS.map((tr) => refusTransition(tr, circuit.etat, organisation.roles, acteur.id, circuit.intervenants, "x", decision))
      .filter((r): r is "circuit.separation_auteur" | "circuit.separation_verificateur" | "circuit.second_facteur_requis" =>
        r === "circuit.separation_auteur" || r === "circuit.separation_verificateur" || r === "circuit.second_facteur_requis"),
  )];
  // Retour d'une décision (?etat=…) : confirmé seulement si le document est toujours dans cet état.
  const q = await searchParams;
  const confirme = typeof q.etat === "string" && (ETATS as readonly string[]).includes(q.etat) && q.etat === circuit.etat;
  const nom = circuit.reference && circuit.titre ? `${circuit.reference} — ${circuit.titre}` : circuit.reference || circuit.titre || t("docs.sans_titre");
  const etatLisible = t(`etat.${circuit.etat}`);

  return (
    <>
      <header className="entete">
        <div>
          <p><Link href="/app/documents">{t("versions.retour")}</Link></p>
          <h1>{t("circuit.titre")}</h1>
          <p>{t("circuit.texte")}</p>
        </div>
      </header>

      {confirme ? <p className="bandeau bandeau-info" role="status" id="decision-enregistree">{t("circuit.fait", { etat: etatLisible })}</p> : null}

      <section className="carte" id="etat-circuit" data-etat={circuit.etat}>
        <h2>{nom}</h2>
        <p>
          <span className={`etiquette etiquette-etat-${circuit.etat}`}>{etatLisible}</span>{" "}
          {t("circuit.etat_actuel", { etat: etatLisible, v: circuit.version })}
        </p>
        <p className="discret">{t(`circuit.etape.${circuit.etat}`)}</p>
        {circuit.versionPubliee !== null && circuit.publieLe ? (
          <p>{t("circuit.publiee", { v: circuit.versionPubliee, date: formaterDate(langue, circuit.publieLe, fuseau) })}</p>
        ) : null}
        {revue ? (
          <p id="revue" data-situation={revue.situation} className={revue.situation === "a_jour" ? undefined : "bandeau bandeau-alerte"}>
            {t(`circuit.revue.${revue.situation}`, { date: formaterJour(langue, revue.echeance) })}
          </p>
        ) : null}
        <div className="actions-ligne">
          <a className="bouton bouton-second" href={`${EDITEUR}?doc=${encodeURIComponent(circuit.id)}`}>{t("docs.ouvrir")}</a>
          <Link className="bouton bouton-discret" href={`/app/documents/${circuit.id}/historique`}>{t("docs.historique")}</Link>
          {circuit.versionPubliee !== null && circuit.versionPubliee !== circuit.version ? (
            <Link className="bouton bouton-discret" id="comparer-publiee" href={`/app/documents/${circuit.id}/historique?a=${circuit.versionPubliee}&b=${circuit.version}#comparaison`}>
              {t("circuit.comparer_publiee", { v: circuit.versionPubliee })}
            </Link>
          ) : null}
        </div>
      </section>

      <section className="carte" id="decisions-possibles">
        {possibles.length === 0 ? (
          <p className="vide">{t("circuit.aucune_action")}</p>
        ) : (
          <div className="decisions-possibles">
            {possibles.map((tr) => {
              const regle = TRANSITIONS[tr];
              const libelle = t(`circuit.t.${tr}`);
              return (
                <div className="decision-possible" key={tr} data-transition={tr}>
                  <FormulaireAction
                    action={actionTransitionDocument}
                    libelle={libelle}
                    libelleEnCours={t("commun.en_cours")}
                    variante={tr === "archiver" || tr.startsWith("refuser") ? "danger" : "normal"}
                    vider={false}
                    confirmation={t("circuit.confirmer", { action: libelle, v: circuit.version })}
                  >
                    <input type="hidden" name="organisationId" value={organisation.id} />
                    <input type="hidden" name="documentId" value={circuit.id} />
                    <input type="hidden" name="transition" value={tr} />
                    <input type="hidden" name="versionVue" value={circuit.version} />
                    {demandeFonction(tr) ? (
                      <div className="grille-champs">
                        <label className="champ">
                          <span>{t("circuit.nom")}</span>
                          <input type="text" value={nomActeur(acteur)} readOnly aria-readonly="true" data-champ="nom" />
                        </label>
                        <label className="champ">
                          <span>{t("circuit.fonction")}</span>
                          <input type="text" name="fonction" required maxLength={FONCTION_MAX} defaultValue={fonctionConnue} autoComplete="organization-title" />
                        </label>
                      </div>
                    ) : null}
                    <label className="champ">
                      <span>{t(regle.motifObligatoire ? "circuit.motif_obligatoire" : "circuit.commentaire")}</span>
                      <textarea name="motif" rows={3} maxLength={MOTIF_MAX} required={regle.motifObligatoire} />
                    </label>
                  </FormulaireAction>
                </div>
              );
            })}
          </div>
        )}
        {separations.map((cle) => <p key={cle} className="discret separation" data-refus={cle}>{t(cle)}</p>)}
        {separations.includes("circuit.second_facteur_requis") ? <p><Link href="/compte/second-facteur">{t("circuit.second_facteur_lien")}</Link></p> : null}
        <p className="discret petit" id="mode-validation" data-mode={organisation.modeValidation}>{t(`circuit.mode_${organisation.modeValidation}`)}</p>
        <p className="discret petit">{t("circuit.motif_aide")}</p>
        {possibles.some(demandeFonction) ? <p className="discret petit" id="aide-fonction">{t("circuit.fonction_aide")}</p> : null}
      </section>

      <section className="carte">
        <h2>{t("circuit.decisions")}</h2>
        <p className="discret petit" id="mention-trace">{t("circuit.trace")}</p>
        {circuit.decisions.length === 0 ? (
          <p className="vide">{t("circuit.aucune_decision")}</p>
        ) : (
          <div className="tableau-defilant">
            <table className="tableau" id="decisions">
              <thead>
                <tr>
                  <th>{t("circuit.date")}</th>
                  <th>{t("circuit.decision")}</th>
                  <th>{t("circuit.version")}</th>
                  <th>{t("circuit.par")}</th>
                  <th>{t("circuit.fonction_colonne")}</th>
                  <th>{t("circuit.motif")}</th>
                  <th>{t("circuit.empreinte")}</th>
                </tr>
              </thead>
              <tbody>
                {circuit.decisions.map((d, i) => (
                  <tr key={i} data-transition={d.transition}>
                    <td className="nowrap">{formaterDate(langue, d.decideLe, fuseau)}</td>
                    <td>{t(`circuit.d.${d.transition}`)}</td>
                    <td className="nowrap">v{d.version}</td>
                    <td>{d.acteurNom || "—"}</td>
                    <td>{d.acteurFonction || "—"}</td>
                    <td className="texte-long">{d.motif || "—"}</td>
                    <td><code className="empreinte">{d.empreinte}</code></td>
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
