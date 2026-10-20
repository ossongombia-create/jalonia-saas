import Link from "next/link";
import { Journal } from "@/components/Journal";
import { poolApplication } from "@/server/db/pools";
import { lireJournalPlateforme, statistiquesPlateforme } from "@/server/consultation/service";
import { alertesAbsence } from "@/server/organisations/absences";
import { jourLocal } from "@/lib/dates";
import { formaterJour } from "@/lib/format";
import { exigerSuperadmin, reglesSession } from "@/server/web/contexte";
import { titrePage } from "@/server/web/metadonnees";

export const generateMetadata = titrePage("tdb.titre");

export default async function TableauDeBord() {
  const ctx = await exigerSuperadmin();
  const { t } = ctx;
  const pool = poolApplication();
  const [stats, journal, alertes] = await Promise.all([
    statistiquesPlateforme(pool, reglesSession()),
    lireJournalPlateforme(pool, { page: 1 }),
    alertesAbsence(pool, ctx.fuseau, jourLocal(new Date(), ctx.fuseau)),
  ]);
  journal.lignes = journal.lignes.slice(0, 15);
  journal.aSuite = false;

  return (
    <>
      <header className="entete">
        <div>
          <h1>{t("tdb.titre")}</h1>
          <p>{t("commun.fuseau", { fuseau: ctx.fuseau })}</p>
        </div>
      </header>
      <div className="grille-stats">
        <Link href="/plateforme/organisations" className="stat">
          <strong>{stats.organisationsActives}</strong>
          <span>{t("tdb.organisations")}</span>
        </Link>
        <Link href="/plateforme/utilisateurs" className="stat">
          <strong>{stats.comptesActifs}</strong>
          <span>{t("tdb.utilisateurs")}</span>
        </Link>
        <Link href="/plateforme/sessions" className="stat">
          <strong>{stats.sessionsOuvertes}</strong>
          <span>{t("tdb.sessions")}</span>
        </Link>
        <Link href="/plateforme/journal?action=CONNEXION" className="stat">
          <strong>{stats.connexions24h}</strong>
          <span>{t("tdb.connexions_24h")}</span>
        </Link>
        <Link href="/plateforme/journal?action=CONNEXION_ECHEC" className={stats.echecs24h > 0 ? "stat stat-alerte" : "stat"}>
          <strong>{stats.echecs24h}</strong>
          <span>{t("tdb.echecs_24h")}</span>
        </Link>
      </div>
      <section className="carte" id="alertes" data-alertes={alertes.length}>
        <h2>{t("alertes.titre")}</h2>
        {alertes.length === 0 ? (
          <p className="discret">{t("alertes.aucune")}</p>
        ) : (
          <ul>
            {alertes.map((a) => (
              <li key={a.organisationId}>
                <Link href={`/plateforme/organisations/${a.organisationId}`}>
                  {t("alertes.absence", {
                    organisation: a.organisation, titulaire: a.titulaire, debut: formaterJour(ctx.langue, a.debut), jours: a.jours,
                    suppleant: a.suppleant ? `${a.suppleant} (${t(a.suppleantActif ? "orgs.etat_actif" : "orgs.etat_inactif")})` : t("orgs.aucun"),
                  })}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="carte">
        <h2>{t("tdb.activite_recente")}</h2>
        <Journal t={t} langue={ctx.langue} fuseau={ctx.fuseau} journal={journal} afficherOrganisation />
        <p className="pied-carte">
          <Link href="/plateforme/journal">{t("nav.journal")} →</Link>
        </p>
      </section>
    </>
  );
}
