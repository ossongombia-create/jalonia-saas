// Accueil de l'organisation : tableau de bord (audit Q1). Ce qui attend la personne connectée (documents à décider,
// actions qui lui sont confiées), puis la situation de l'organisation : documents, revues, actions, risques,
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
                  <Link href={`/app/documents/${d.id}/validation`}>{d.reference && d.titre ? `${d.reference} — ${d.titre}` : d.reference || d.titre || t("docs.sans_titre")}</Link>{" "}
                  <span className={`etiquette etiquette-etat-${d.etat}`}>{t(`etat.${d.etat}`)}</span>
                </li>
              ))}
            </ul>
          )}
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
