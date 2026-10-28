// Accueil de l'organisation : tableau de bord (audit Q1). Ce qui attend la personne connectée (« Mes tâches » : documents
// à vérifier ou à approuver, ses documents refusés à reprendre, ses documents en circuit et chez qui ; actions confiées), puis la situation de l'organisation : documents, revues, actions, risques,
// opportunités et indicateurs (registres lus dans les versions publiées).
import Link from "next/link";
import { jourLocal } from "@/lib/dates";
import { formaterJour } from "@/lib/format";
import { aLeDroit } from "@/lib/rbac";
import { poolApplication } from "@/server/db/pools";
import { ETATS } from "@/server/documents/circuit";
import { lireTableauDeBord } from "@/server/qse/tableau";
import { exigerOrganisation } from "@/server/web/contexte";
import { titrePage } from "@/server/web/metadonnees";

export const generateMetadata = titrePage("nav.accueil");

function Tuile({ titre, lien, voir, lignes, id }: { titre: string; lien: string; voir: string; lignes: { n: number; libelle: string; alerte?: boolean }[]; id: string }) {
  return (
    <section className="tuile" id={id}>
      <h3>{titre}</h3>
      <ul>
        {lignes.map((l) => (
          <li key={l.libelle} className={l.alerte && l.n > 0 ? "tuile-alerte" : undefined}>
            <strong>{l.n}</strong> {l.libelle}
          </li>
        ))}
      </ul>
      <Link href={lien}>{voir} →</Link>
    </section>
  );
}

export default async function AccueilOrganisation() {
  const ctx = await exigerOrganisation();
  const { t, organisation, langue, fuseau } = ctx;
  const roles = (
    <section className="carte">
      <h2>{t("org.vos_roles")}</h2>
      <div className="liste-etiquettes">
        {organisation.roles.map((r) => (
          <span key={r} className="etiquette">{t(`role.${r}`)}</span>
        ))}
      </div>
    </section>
  );
  if (!aLeDroit(organisation.roles, "documents.lire")) {
    return (
      <>
        <header className="entete"><div><h1>{t("org.bienvenue", { nom: ctx.utilisateur.nom })}</h1><p>{organisation.nom}</p></div></header>
        {roles}
      </>
    );
  }
  const tb = await lireTableauDeBord(poolApplication(), organisation, { id: ctx.acteur.id, roles: organisation.roles, mode: organisation.modeValidation }, fuseau, jourLocal(new Date(), fuseau));
  const voir = t("tableau.voir");
  const nomDoc = (d: { reference: string; titre: string }) => (d.reference && d.titre ? `${d.reference} — ${d.titre}` : d.reference || d.titre || t("docs.sans_titre"));

  return (
    <>
      <header className="entete">
        <div>
          <h1>{t("org.bienvenue", { nom: ctx.utilisateur.nom })}</h1>
          <p>{organisation.nom} — {t("tableau.texte")}</p>
        </div>
      </header>

      <div className="grille-deux">
        <section className="carte" id="a-decider">
          <h2>{t("tableau.a_decider")}</h2>
          {tb.aDecider.length === 0 ? (
            <p className="vide">{t("tableau.aucun_a_decider")}</p>
          ) : (
            <ul className="liste-simple">
              {tb.aDecider.map((d) => (
                <li key={d.id}>
                  <Link href={`/app/documents/${d.id}/validation`}>{nomDoc(d)}</Link>{" "}
                  <span className={`etiquette etiquette-etat-${d.etat}`}>{t(d.etat === "en_verification" ? "tableau.a_verifier" : "tableau.a_approuver")}</span>
                  {d.depuis ? <> <span className="discret petit">{t("tableau.depuis", { date: formaterJour(langue, jourLocal(d.depuis, fuseau)) })}</span></> : null}
                </li>
              ))}
            </ul>
          )}
          {tb.refuses.length > 0 ? (
            <>
              <h3>{t("tableau.refuses")}</h3>
              <ul className="liste-simple" id="mes-refuses">
                {tb.refuses.map((d) => (
                  <li key={d.id}>
                    <Link href={`/app/documents/${d.id}/validation`}>{nomDoc(d)}</Link>{" "}
                    <span className="etiquette etiquette-alerte">{t("tableau.refuse")}</span>
                    {d.motif ? <> <span className="discret petit">{t("tableau.motif", { motif: d.motif })}</span></> : null}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {tb.enCours.length > 0 ? (
            <>
              <h3>{t("tableau.en_cours")}</h3>
              <ul className="liste-simple" id="mes-en-cours">
                {tb.enCours.map((d) => (
                  <li key={d.id}>
                    <Link href={`/app/documents/${d.id}/validation`}>{nomDoc(d)}</Link>{" "}
                    <span className={`etiquette etiquette-etat-${d.etat}`}>{t(`etat.${d.etat}`)}</span>{" "}
                    <span className="discret petit">
                      {d.chez ? t("tableau.chez", { nom: d.chez }) : null}
                      {d.chez && d.depuis ? " · " : null}
                      {d.depuis ? t("tableau.depuis", { date: formaterJour(langue, jourLocal(d.depuis, fuseau)) }) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
        <section className="carte" id="mes-actions">
          <h2>{t("tableau.mes_actions")}</h2>
          {tb.mesActions.length === 0 ? (
            <p className="vide">{t("tableau.aucune_action")}</p>
          ) : (
            <ul className="liste-simple">
              {tb.mesActions.map((a) => (
                <li key={a.id}>
                  <Link href={`/app/actions/${a.id}`}>{t("actions.numero", { n: a.numero })} — {a.titre}</Link>{" "}
                  <span className="discret petit">{formaterJour(langue, a.echeance)}</span>
                  {a.enRetard ? <> <span className="etiquette etiquette-alerte">{t("actions.en_retard")}</span></> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="carte">
        <h2>{t("tableau.titre")}</h2>
        <div className="grille-tableau">
          <Tuile id="tuile-documents" titre={t("tableau.documents")} lien="/app/documents" voir={voir}
            lignes={ETATS.map((e) => ({ n: tb.documents[e], libelle: t(`etat.${e}`) }))} />
          <Tuile id="tuile-revues" titre={t("tableau.revues")} lien="/app/documents" voir={voir} lignes={[
            { n: tb.revues.proches, libelle: t("tableau.revues.proches") },
            { n: tb.revues.retard, libelle: t("tableau.revues.retard"), alerte: true },
          ]} />
          <Tuile id="tuile-actions" titre={t("tableau.actions")} lien="/app/actions" voir={voir} lignes={[
            { n: tb.actions.ouvertes, libelle: t("tableau.actions.ouvertes") },
            { n: tb.actions.retard, libelle: t("tableau.actions.retard"), alerte: true },
            { n: tb.actions.aVerifier, libelle: t("tableau.actions.a_verifier") },
          ]} />
          <Tuile id="tuile-risques" titre={t("tableau.risques")} lien="/app/risques" voir={voir} lignes={[
            { n: tb.risques.critique, libelle: t("risque.niveau.critique"), alerte: true },
            { n: tb.risques.significatif, libelle: t("risque.niveau.significatif") },
            { n: tb.risques.acceptable, libelle: t("risque.niveau.acceptable") },
            { n: tb.risques.nonCote, libelle: t("risque.non_cote") },
          ]} />
          <Tuile id="tuile-opportunites" titre={t("tableau.opportunites")} lien="/app/risques#opportunites" voir={voir} lignes={[
            { n: tb.opportunites.plan, libelle: t("opportunite.suite.plan") },
            { n: tb.opportunites.etudier, libelle: t("opportunite.suite.etudier") },
            { n: tb.opportunites.nonCote, libelle: t("risque.non_cote") },
          ]} />
          <Tuile id="tuile-indicateurs" titre={t("tableau.indicateurs")} lien="/app/indicateurs" voir={voir} lignes={[
            { n: tb.indicateurs.atteint, libelle: t("indicateur.situation.atteint") },
            { n: tb.indicateurs.non_atteint, libelle: t("indicateur.situation.non_atteint"), alerte: true },
            { n: tb.indicateurs.sans_mesure, libelle: t("indicateur.situation.sans_mesure") },
            { n: tb.indicateurs.sans_objectif, libelle: t("indicateur.situation.sans_objectif") },
          ]} />
        </div>
      </section>
      {roles}
    </>
  );
}
