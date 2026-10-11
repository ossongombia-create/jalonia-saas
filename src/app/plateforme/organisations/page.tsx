import Link from "next/link";
import { formaterDate } from "@/lib/format";
import { poolApplication } from "@/server/db/pools";
import { listerOrganisations } from "@/server/organisations/service";
import { exigerSuperadmin } from "@/server/web/contexte";
import { titrePage } from "@/server/web/metadonnees";

export const generateMetadata = titrePage("orgs.titre");

export default async function PageOrganisations() {
  const ctx = await exigerSuperadmin();
  const { t } = ctx;
  const organisations = await listerOrganisations(poolApplication());

  return (
    <>
      <header className="entete">
        <h1>{t("orgs.titre")}</h1>
        <Link href="/plateforme/organisations/nouvelle" className="bouton">
          + {t("orgs.nouvelle")}
        </Link>
      </header>
      <section className="carte">
        {organisations.length === 0 ? (
          <p className="vide">{t("commun.aucun")}</p>
        ) : (
          <div className="tableau-defilant">
            <table className="tableau">
              <thead>
                <tr>
                  <th>{t("commun.nom")}</th>
                  <th>{t("orgs.slug")}</th>
                  <th>{t("commun.statut")}</th>
                  <th>{t("orgs.membres")}</th>
                  <th>{t("orgs.creee_le")}</th>
                </tr>
              </thead>
              <tbody>
                {organisations.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <Link href={`/plateforme/organisations/${o.id}`}>
                        <strong>{o.nom}</strong>
                      </Link>
                    </td>
                    <td className="discret">{o.slug}</td>
                    <td>
                      <span className={o.statut === "active" ? "etiquette etiquette-ok" : "etiquette etiquette-erreur"}>{t(`statut.${o.statut}`)}</span>
                    </td>
                    <td>{o.membres}</td>
                    <td className="nowrap">{formaterDate(ctx.langue, o.creeLe, ctx.fuseau)}</td>
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
