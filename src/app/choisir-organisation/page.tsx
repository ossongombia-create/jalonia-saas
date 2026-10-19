import Link from "next/link";
import { formaterDate } from "@/lib/format";
import { actionChoisirOrganisation, actionDeconnexion } from "@/actions/compte";
import { exigerContexte } from "@/server/web/contexte";
import { titrePage } from "@/server/web/metadonnees";
import { Logo } from "@/components/Logo";

export const generateMetadata = titrePage("org_choix.titre");

export default async function PageChoisirOrganisation() {
  const ctx = await exigerContexte();
  const { t } = ctx;
  const actives = ctx.adhesions.filter((a) => a.statut === "active");

  return (
    <div className="page-simple">
      <section className="carte">
        <Logo variante="couleur" largeur={300} className="logo-carte" prioritaire />
        <h1>{t("org_choix.titre")}</h1>
        {actives.length === 0 ? (
          <p>{t("org_choix.aucune")}</p>
        ) : (
          <>
            <p className="discret">{t("org_choix.texte")}</p>
            <ul className="liste-organisations">
              {ctx.adhesions.map((a) => (
                <li key={a.id}>
                  <span>
                    <strong>{a.nom}</strong>
                    <br />
                    <span className="discret petit">{a.roles.map((r) => t(`role.${r}`)).join(", ")}</span>
                    {a.urgence ? (
                      <>
                        <br />
                        <span className="etiquette etiquette-alerte">{t("acces.etiquette", { date: formaterDate(ctx.langue, a.urgence.expireLe, ctx.fuseau) })}</span>
                      </>
                    ) : null}
                  </span>
                  {a.statut === "active" ? (
                    <form action={actionChoisirOrganisation}>
                      <input type="hidden" name="organisationId" value={a.id} />
                      <button type="submit" className="bouton">
                        {t("org_choix.ouvrir")}
                      </button>
                    </form>
                  ) : (
                    <span className="etiquette etiquette-erreur">{t("statut.suspendue")}</span>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="pied-carte actions-ligne">
          {ctx.utilisateur.estSuperadmin ? (
            <Link href="/plateforme" className="bouton bouton-second">
              {t("nav.plateforme")}
            </Link>
          ) : null}
          <form action={actionDeconnexion}>
            <button type="submit" className="bouton bouton-discret">
              {t("commun.deconnexion")}
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}
