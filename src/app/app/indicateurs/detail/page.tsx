// Un indicateur (audit Q1) : description (document), objectif chiffré (droit indicateurs.objectifs), mesures (droit
// indicateurs.mesurer) avec leur situation, et l'évolution des dernières mesures. Lecture : tous les rôles.
// L'indicateur est désigné par ?document=…&element=… (identifiant de l'instruction qui le porte).
import Link from "next/link";
import { notFound } from "next/navigation";
import { actionDefinirObjectif, actionEnregistrerMesure, actionRetirerObjectif, actionSupprimerMesure } from "@/actions/qse";
import { FormulaireAction } from "@/components/FormulaireAction";
import { formaterNombre, texteObjectif } from "@/lib/affichage-qse";
import { jourLocal } from "@/lib/dates";
import { formaterDate, formaterJour } from "@/lib/format";
import { objectifAtteint } from "@/lib/qse";
import { aLeDroit } from "@/lib/rbac";
import { identifiant } from "@/lib/validation";
import { poolApplication } from "@/server/db/pools";
import { listerMesures, lireObjectif, type Mesure, type Objectif } from "@/server/qse/indicateurs";
import { lireRegistreIndicateurs } from "@/server/qse/vues";
import { exigerOrganisation } from "@/server/web/contexte";
import { titrePage } from "@/server/web/metadonnees";

export const generateMetadata = titrePage("indicateurs.titre");

/** Évolution des 24 dernières mesures (ordre chronologique), avec le seuil de l'objectif en pointillé. */
function Graphique({ mesures, objectif, libelle }: { mesures: Mesure[]; objectif: Objectif | null; libelle: string }) {
  const points = mesures.slice(0, 24).reverse();
  if (points.length < 2) return null;
  const [L, H, M] = [600, 180, 24];
  const valeurs = [...points.map((p) => p.valeur), ...(objectif ? [objectif.seuil] : [])];
  let [min, max] = [Math.min(...valeurs), Math.max(...valeurs)];
  if (min === max) [min, max] = [min - 1, max + 1];
  const x = (i: number) => M + (i * (L - 2 * M)) / (points.length - 1);
  const y = (v: number) => H - M - ((v - min) * (H - 2 * M)) / (max - min);
  return (
    <svg className="graphique-mesures" viewBox={`0 0 ${L} ${H}`} role="img" aria-label={libelle}>
      <rect x="0" y="0" width={L} height={H} fill="none" stroke="var(--trait-doux)" />
      {objectif ? <line x1={M} x2={L - M} y1={y(objectif.seuil)} y2={y(objectif.seuil)} stroke="var(--encre-legere)" strokeDasharray="6 4" /> : null}
      <polyline fill="none" stroke="var(--sarcelle)" strokeWidth="2" points={points.map((p, i) => `${x(i)},${y(p.valeur)}`).join(" ")} />
      {points.map((p, i) => (
        <circle key={p.id} cx={x(i)} cy={y(p.valeur)} r="4"
          fill={objectif ? (objectifAtteint(objectif.sens, objectif.seuil, p.valeur) ? "var(--ok)" : "var(--erreur-texte)") : "var(--sarcelle)"}>
          <title>{`${p.date} : ${p.valeur}`}</title>
        </circle>
      ))}
    </svg>
  );
}

export default async function PageIndicateur({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await exigerOrganisation("documents.lire");
  const { t, organisation, langue, fuseau } = ctx;
  const q = await searchParams;
  const doc = identifiant.safeParse(q.document);
  const elementId = typeof q.element === "string" ? q.element : "";
  if (!doc.success || elementId.length < 1 || elementId.length > 100) notFound();
  const pool = poolApplication();
  const [registre, objectif, mesures] = await Promise.all([
    lireRegistreIndicateurs(pool, organisation, "tous"), lireObjectif(pool, organisation, doc.data, elementId), listerMesures(pool, organisation, doc.data, elementId),
  ]);
  const indicateur = registre.find((i) => i.documentId === doc.data && i.id === elementId) ?? null;
  if (!indicateur && mesures.length === 0) notFound();
  const nom = indicateur?.nom || mesures[0]?.nom || "—";
  const peutMesurer = aLeDroit(organisation.roles, "indicateurs.mesurer") && indicateur !== null;
  const peutFixer = aLeDroit(organisation.roles, "indicateurs.objectifs") && indicateur !== null;
  const champsVises = (
    <>
      <input type="hidden" name="organisationId" value={organisation.id} />
      <input type="hidden" name="documentId" value={doc.data} />
      <input type="hidden" name="elementId" value={elementId} />
    </>
  );
  const unite = objectif?.unite ? ` ${objectif.unite}` : "";

  return (
    <>
      <header className="entete">
        <div>
          <p><Link href="/app/indicateurs">{t("indicateurs.retour")}</Link></p>
          <h1>{nom}</h1>
          {indicateur ? <p>{indicateur.reference && indicateur.titre ? `${indicateur.reference} — ${indicateur.titre}` : indicateur.reference || indicateur.titre}</p> : null}
        </div>
      </header>
      {indicateur ? null : <p className="bandeau bandeau-alerte">{t("indicateurs.introuvable")}</p>}

      <section className="carte" id="fiche-indicateur">
        <dl className="fiche">
          {indicateur ? (
            <>
              <dt>{t("indicateurs.formule")}</dt><dd>{indicateur.formule || "—"}</dd>
              <dt>{t("indicateurs.cible")}</dt><dd>{indicateur.cible || "—"}</dd>
              <dt>{t("indicateurs.frequence")}</dt><dd>{indicateur.frequence || "—"}</dd>
            </>
          ) : null}
          <dt>{t("indicateurs.objectif")}</dt>
          <dd id="objectif">{objectif ? texteObjectif(t, langue, objectif) : t("indicateurs.sans_objectif")}</dd>
        </dl>
        {objectif ? <p className="discret petit">{t("indicateurs.objectif_par", { nom: objectif.modifieParNom || "—", date: formaterDate(langue, objectif.modifieLe, fuseau) })}</p> : null}
        {peutFixer ? (
          <div className="grille-deux">
            <FormulaireAction action={actionDefinirObjectif} libelle={t("indicateurs.definir")} libelleEnCours={t("commun.en_cours")} vider={false}>
              {champsVises}
              <div className="grille-champs">
                <label className="champ">
                  <span>{t("indicateurs.champ.sens")}</span>
                  <select name="sens" defaultValue={objectif?.sens ?? "min"}>
                    <option value="min">{t("indicateurs.sens.min")}</option>
                    <option value="max">{t("indicateurs.sens.max")}</option>
                  </select>
                </label>
                <label className="champ">
                  <span>{t("indicateurs.champ.seuil")}</span>
                  <input type="text" name="seuil" inputMode="decimal" defaultValue={objectif ? String(objectif.seuil) : ""} required maxLength={24} />
                </label>
                <label className="champ">
                  <span>{t("indicateurs.champ.unite")}</span>
                  <input type="text" name="unite" defaultValue={objectif?.unite ?? ""} maxLength={30} />
                </label>
              </div>
            </FormulaireAction>
            {objectif ? (
              <FormulaireAction action={actionRetirerObjectif} libelle={t("indicateurs.retirer")} libelleEnCours={t("commun.en_cours")} variante="danger" vider={false} confirmation={t("indicateurs.confirmer_retrait")}>
                {champsVises}
              </FormulaireAction>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="carte" id="mesures-indicateur">
        <h2>{t("indicateurs.mesures")}</h2>
        {peutMesurer ? (
          <FormulaireAction action={actionEnregistrerMesure} libelle={t("indicateurs.enregistrer_mesure")} libelleEnCours={t("commun.en_cours")}>
            {champsVises}
            <div className="grille-champs">
              <label className="champ">
                <span>{t("indicateurs.champ.date")}</span>
                <input type="date" name="date" defaultValue={jourLocal(new Date(), fuseau)} required />
              </label>
              <label className="champ">
                <span>{t("indicateurs.champ.valeur")}{unite ? ` (${objectif?.unite})` : ""}</span>
                <input type="text" name="valeur" inputMode="decimal" required maxLength={24} />
              </label>
              <label className="champ">
                <span>{t("indicateurs.champ.commentaire")}</span>
                <input type="text" name="commentaire" maxLength={1000} />
              </label>
            </div>
            <p className="discret petit">{t("indicateurs.mesure_aide")}</p>
          </FormulaireAction>
        ) : aLeDroit(organisation.roles, "indicateurs.mesurer") ? null : <p className="bandeau bandeau-info">{t("indicateurs.lecture_seule")}</p>}

        {mesures.length === 0 ? (
          <p className="vide">{t("indicateurs.aucune_mesure")}</p>
        ) : (
          <>
            <Graphique mesures={mesures} objectif={objectif} libelle={t("indicateurs.graphique")} />
            <p className="discret petit">{t("indicateurs.graphique")}</p>
            <div className="tableau-defilant">
              <table className="tableau" id="mesures">
                <thead>
                  <tr>
                    <th>{t("indicateurs.champ.date")}</th>
                    <th>{t("indicateurs.champ.valeur")}</th>
                    <th>{t("indicateurs.situation")}</th>
                    <th>{t("indicateurs.champ.commentaire")}</th>
                    <th>{t("indicateurs.saisi_par")}</th>
                    {aLeDroit(organisation.roles, "indicateurs.mesurer") ? <th>{t("commun.actions")}</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {mesures.map((m) => {
                    const situation = objectif ? (objectifAtteint(objectif.sens, objectif.seuil, m.valeur) ? "atteint" : "non_atteint") : "sans_objectif";
                    return (
                      <tr key={m.id} data-date={m.date} data-situation={situation}>
                        <td className="nowrap">{formaterJour(langue, m.date)}</td>
                        <td className="nowrap">{formaterNombre(langue, m.valeur)}{unite}</td>
                        <td><span className={`etiquette etiquette-situation-${situation}`}>{t(`indicateur.situation.${situation}`)}</span></td>
                        <td className="texte-long">{m.commentaire || "—"}</td>
                        <td>{m.saisiParNom || "—"}<br /><span className="discret petit">{formaterDate(langue, m.saisiLe, fuseau)}</span></td>
                        {aLeDroit(organisation.roles, "indicateurs.mesurer") ? (
                          <td>
                            <FormulaireAction action={actionSupprimerMesure} libelle={t("indicateurs.supprimer_mesure")} libelleEnCours={t("commun.en_cours")} variante="danger" vider={false}
                              confirmation={t("indicateurs.confirmer_suppression", { date: formaterJour(langue, m.date) })}>
                              <input type="hidden" name="organisationId" value={organisation.id} />
                              <input type="hidden" name="mesureId" value={m.id} />
                            </FormulaireAction>
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </>
  );
}
