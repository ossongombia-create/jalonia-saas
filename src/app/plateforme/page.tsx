import Link from "next/link";
import { Journal } from "@/components/Journal";
import { poolApplication } from "@/server/db/pools";
import { lireJournalPlateforme, statistiquesPlateforme } from "@/server/consultation/service";
import { exigerSuperadmin, reglesSession } from "@/server/web/contexte";
import { titrePage } from "@/server/web/metadonnees";

export const generateMetadata = titrePage("tdb.titre");

export default async function TableauDeBord() {
  const ctx = await exigerSuperadmin();
  const { t } = ctx;
  const pool = poolApplication();
  const [stats, journal] = await Promise.all([statistiquesPlateforme(pool, reglesSession()), lireJournalPlateforme(pool, { page: 1 })]);
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
