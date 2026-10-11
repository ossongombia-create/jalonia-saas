import { TableauSessions } from "@/components/TableauSessions";
import { poolApplication } from "@/server/db/pools";
import { listerSessionsOuvertes, listerSessionsTerminees } from "@/server/consultation/service";
import { exigerSuperadmin, reglesSession } from "@/server/web/contexte";
import { titrePage } from "@/server/web/metadonnees";

export const generateMetadata = titrePage("sessions.titre");

export default async function PageSessions() {
  const ctx = await exigerSuperadmin();
  const { t } = ctx;
  const pool = poolApplication();
  const regles = reglesSession();
  const [ouvertes, terminees] = await Promise.all([listerSessionsOuvertes(pool, regles), listerSessionsTerminees(pool, regles, 7)]);

  return (
    <>
      <header className="entete">
        <div>
          <h1>{t("sessions.titre")}</h1>
          <p>
            {t("sessions.regles", { inactivite: regles.inactiviteMinutes, duree: regles.dureeMaxHeures })} {t("commun.fuseau", { fuseau: ctx.fuseau })}
          </p>
        </div>
      </header>
      <p className="bandeau bandeau-info">{t("sessions.localisation_info")}</p>
      <section className="carte">
        <h2>
          {t("sessions.ouvertes")} ({ouvertes.length})
        </h2>
        <TableauSessions ctx={ctx} sessions={ouvertes} ouvertes />
      </section>
      <section className="carte">
        <h2>{t("sessions.recentes")}</h2>
        <TableauSessions ctx={ctx} sessions={terminees} ouvertes={false} />
      </section>
    </>
  );
}
