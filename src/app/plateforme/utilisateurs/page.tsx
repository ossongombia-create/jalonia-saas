import Link from "next/link";
import { formaterDate, formaterDuree } from "@/lib/format";
import { poolApplication } from "@/server/db/pools";
import { listerUtilisateurs } from "@/server/utilisateurs/service";
import { exigerSuperadmin, reglesSession } from "@/server/web/contexte";
import { titrePage } from "@/server/web/metadonnees";

export const generateMetadata = titrePage("users.titre");

export default async function PageUtilisateurs() {
  const ctx = await exigerSuperadmin();
  const { t, langue, fuseau } = ctx;
  const utilisateurs = await listerUtilisateurs(poolApplication(), reglesSession());

  return (
    <>
      <header className="entete">
        <div>
          <h1>{t("users.titre")}</h1>
          <p>{t("commun.fuseau", { fuseau })}</p>
        </div>
      </header>
      <section className="carte">
        <div className="tableau-defilant">
          <table className="tableau">
            <thead>
              <tr>
                <th>{t("commun.nom")}</th>
                <th>{t("commun.statut")}</th>
                <th>{t("users.organisations")}</th>
                <th>{t("membres.derniere_connexion")}</th>
                <th>{t("users.sessions_ouvertes")}</th>
                <th>{t("users.temps_30j")}</th>
              </tr>
            </thead>
            <tbody>
              {utilisateurs.map((u) => (
                <tr key={u.id}>
                  <td>
                    <Link href={`/plateforme/utilisateurs/${u.id}`}>
                      <strong>{u.nom}</strong>
                    </Link>{" "}
                    {u.estSuperadmin ? <span className="etiquette etiquette-violet">{t("users.superadmin")}</span> : null}
                    <br />
                    <span className="discret">{u.email}</span>
                  </td>
                  <td>
                    <div className="liste-etiquettes">
                      <span className={u.statut === "actif" ? "etiquette etiquette-ok" : "etiquette etiquette-erreur"}>{t(`statut.${u.statut}`)}</span>
                      {u.verrouilleJusqua ? (
                        <span className="etiquette etiquette-erreur">{t("users.verrouille", { heure: formaterDate(langue, u.verrouilleJusqua, fuseau) })}</span>
                      ) : null}
                      {u.doitChangerMdp ? <span className="etiquette etiquette-alerte">{t("users.doit_changer")}</span> : null}
                    </div>
                  </td>
                  <td className="petit">{u.organisations.length ? u.organisations.join(", ") : "—"}</td>
                  <td className="nowrap">{u.derniereConnexion ? formaterDate(langue, u.derniereConnexion, fuseau) : t("commun.jamais")}</td>
                  <td>{u.sessionsOuvertes}</td>
                  <td className="nowrap">{formaterDuree(t, u.secondes30j)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
