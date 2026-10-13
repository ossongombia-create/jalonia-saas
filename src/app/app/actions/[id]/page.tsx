// Une action (audit Q1) : sa fiche, sa modification (droit actions.gerer ; jamais une action close ou abandonnée) et
// son historique (journal de l'organisation). Lecture : tous les rôles de l'organisation.
import Link from "next/link";
import { notFound } from "next/navigation";
import { actionModifierAction } from "@/actions/qse";
import { ChampsAction } from "@/components/ChampsAction";
import { FormulaireAction } from "@/components/FormulaireAction";
import { formaterDate, formaterJour } from "@/lib/format";
import { estCle, type Traducteur } from "@/lib/i18n";
import { SUITES_STATUT } from "@/lib/qse";
import { aLeDroit } from "@/lib/rbac";
import { identifiant } from "@/lib/validation";
import { poolApplication } from "@/server/db/pools";
import { listerMembres } from "@/server/membres/service";
import { historiqueAction, lireAction } from "@/server/qse/actions";
import { exigerOrganisation } from "@/server/web/contexte";
import { titrePage } from "@/server/web/metadonnees";

export const generateMetadata = titrePage("actions.titre");

function valeurLisible(t: Traducteur, champ: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (champ === "statut" && typeof v === "string" && estCle(`actions.statut.${v}`)) return t(`actions.statut.${v}` as Parameters<Traducteur>[0]);
  if (champ === "origine" && typeof v === "string" && estCle(`actions.origine.${v}`)) return t(`actions.origine.${v}` as Parameters<Traducteur>[0]);
  if (champ === "efficace" && typeof v === "boolean") return t(v ? "actions.efficace.oui" : "actions.efficace.non");
  const s = String(v);
  return s.length > 120 ? `${s.slice(0, 120)}…` : s;
}

export default async function PageAction({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await exigerOrganisation("documents.lire");
  const { t, organisation, langue, fuseau } = ctx;
  const lu = identifiant.safeParse((await params).id);
  if (!lu.success) notFound();
  const pool = poolApplication();
  const action = await lireAction(pool, organisation, lu.data);
  if (!action) notFound();
  const [historique, membres] = await Promise.all([historiqueAction(pool, organisation, action.id), listerMembres(pool, organisation.id)]);
  const responsables = membres.filter((m) => m.statut === "actif").map((m) => ({ id: m.utilisateurId, nom: m.nom || m.email }));
  const definitive = action.statut === "cloturee" || action.statut === "abandonnee";
  const peutModifier = aLeDroit(organisation.roles, "actions.gerer") && !definitive;
  const q = await searchParams;
  const statuts = [action.statut, ...SUITES_STATUT[action.statut]];

  return (
    <>
      <header className="entete">
        <div>
          <p><Link href="/app/actions">{t("actions.retour")}</Link></p>
          <h1>{t("actions.numero", { n: action.numero })} — {action.titre}</h1>
          <p className="discret petit">
            {t("actions.creee_par", { date: formaterDate(langue, action.creeLe, fuseau), nom: action.creeParNom || "—", modif: formaterDate(langue, action.modifieLe, fuseau), par: action.modifieParNom || "—" })}
          </p>
        </div>
      </header>
      {typeof q.cree === "string" && /^\d+$/.test(q.cree) && Number(q.cree) === action.numero ? (
        <p className="bandeau bandeau-info" role="status" id="action-creee">{t("actions.cree", { n: action.numero })}</p>
      ) : null}

      <section className="carte" id="fiche-action" data-statut={action.statut} data-version={action.version}>
        <dl className="fiche">
          <dt>{t("actions.champ.statut")}</dt><dd>{t(`actions.statut.${action.statut}`)}{action.statut === "cloturee" && action.efficace !== null ? ` — ${t(action.efficace ? "actions.efficace.oui" : "actions.efficace.non")}` : ""}</dd>
          <dt>{t("actions.champ.origine")}</dt><dd>{t(`actions.origine.${action.origine}`)}</dd>
          {action.documentId ? (
            <>
              <dt>{t("actions.element")}</dt>
              <dd>
                <Link href={`/app/documents/${action.documentId}/validation`}>{action.documentReference && action.documentTitre ? `${action.documentReference} — ${action.documentTitre}` : action.documentReference || action.documentTitre || "—"}</Link>
                {action.elementLibelle ? <><br />{action.elementLibelle}</> : null}
              </dd>
            </>
          ) : null}
          <dt>{t("actions.champ.responsable")}</dt><dd>{action.responsableNom || "—"}</dd>
          <dt>{t("actions.champ.echeance")}</dt><dd>{formaterJour(langue, action.echeance)}</dd>
          {action.resultat ? <><dt>{t("actions.champ.resultat")}</dt><dd className="texte-long">{action.resultat}</dd></> : null}
        </dl>
        {definitive ? <p className="bandeau bandeau-info">{t("actions.definitive_texte")}</p> : null}
        {!aLeDroit(organisation.roles, "actions.gerer") ? <p className="bandeau bandeau-info">{t("actions.lecture_seule")}</p> : null}
      </section>

      {peutModifier ? (
        <section className="carte" id="modifier-action">
          <FormulaireAction action={actionModifierAction} libelle={t("actions.enregistrer")} libelleEnCours={t("commun.en_cours")} vider={false}>
            <input type="hidden" name="organisationId" value={organisation.id} />
            <input type="hidden" name="actionId" value={action.id} />
            <input type="hidden" name="version" value={action.version} />
            <ChampsAction t={t} responsables={responsables}
              valeurs={{ titre: action.titre, description: action.description, origine: action.origine, responsableId: action.responsable, responsableNom: action.responsableNom, echeance: action.echeance }} />
            <div className="grille-champs">
              <label className="champ">
                <span>{t("actions.champ.statut")}</span>
                <select name="statut" defaultValue={action.statut}>
                  {statuts.map((s) => <option key={s} value={s}>{t(`actions.statut.${s}`)}</option>)}
                </select>
              </label>
              <label className="champ">
                <span>{t("actions.champ.efficace")}</span>
                <select name="efficace" defaultValue="">
                  <option value="">{t("actions.efficace.a_preciser")}</option>
                  <option value="oui">{t("actions.efficace.oui")}</option>
                  <option value="non">{t("actions.efficace.non")}</option>
                </select>
              </label>
            </div>
            <label className="champ">
              <span>{t("actions.champ.resultat")}</span>
              <textarea name="resultat" defaultValue={action.resultat} rows={3} maxLength={4000} />
              <small>{t("actions.resultat_aide")}</small>
            </label>
          </FormulaireAction>
        </section>
      ) : null}

      <section className="carte">
        <h2>{t("actions.historique")}</h2>
        {historique.length === 0 ? (
          <p className="vide">{t("actions.aucun_historique")}</p>
        ) : (
          <ul className="liste-simple" id="historique-action">
            {historique.map((h, i) => (
              <li key={i}>
                <span className="discret petit">{formaterDate(langue, h.horodatage, fuseau)} — {h.acteurEmail ?? "—"}</span>{" "}
                <strong>{t(`journal.action.${h.action}`)}</strong>
                {Object.keys(h.changements).length > 0 ? (
                  <ul>
                    {Object.entries(h.changements).map(([champ, c]) => (
                      <li key={champ} className="texte-long">
                        {t("actions.changement", {
                          champ: estCle(`actions.champ.${champ}`) ? t(`actions.champ.${champ}` as Parameters<Traducteur>[0]) : champ,
                          avant: valeurLisible(t, champ, c.avant), apres: valeurLisible(t, champ, c.apres),
                        })}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
