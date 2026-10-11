import Link from "next/link";
import { notFound } from "next/navigation";
import {
  actionDesactiverUtilisateur,
  actionReactiverUtilisateur,
  actionReinitialiserMotDePasse,
  actionRevoquerSessionsUtilisateur,
} from "@/actions/plateforme";
import { FormulaireAction } from "@/components/FormulaireAction";
import { Journal } from "@/components/Journal";
import { TableauSessions } from "@/components/TableauSessions";
import { formaterDate, formaterDuree } from "@/lib/format";
import { identifiant } from "@/lib/validation";
import { poolApplication } from "@/server/db/pools";
import { lireJournalPlateforme, listerSessionsOuvertes, listerSessionsTerminees } from "@/server/consultation/service";
import { lireUtilisateur } from "@/server/utilisateurs/service";
import { exigerSuperadmin, reglesSession } from "@/server/web/contexte";
import { titrePage } from "@/server/web/metadonnees";

export const generateMetadata = titrePage("users.fiche");

export default async function PageUtilisateur({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await exigerSuperadmin();
  const { t, langue, fuseau } = ctx;
  const lu = identifiant.safeParse((await params).id);
  if (!lu.success) notFound();
  const pool = poolApplication();
  const regles = reglesSession();
  const u = await lireUtilisateur(pool, lu.data, regles);
  if (!u) notFound();
  const [ouvertes, terminees, journal] = await Promise.all([
    listerSessionsOuvertes(pool, regles, u.id),
    listerSessionsTerminees(pool, regles, 7, u.id),
    lireJournalPlateforme(pool, { page: 1, acteurId: u.id }),
  ]);
  const gerable = !u.estSuperadmin && u.id !== ctx.utilisateur.id;

  return (
    <>
      <header className="entete">
        <div>
          <p>
            <Link href="/plateforme/utilisateurs">← {t("users.titre")}</Link>
          </p>
          <h1>{u.nom}</h1>
          <p>
            {u.email} · {t("users.cree_le")} {formaterDate(langue, u.creeLe, fuseau)} · {t("users.temps_30j")} : {formaterDuree(t, u.secondes30j)}
          </p>
          <div className="liste-etiquettes" style={{ marginTop: "0.5rem" }}>
            {u.estSuperadmin ? <span className="etiquette etiquette-violet">{t("role.SUPERADMIN_PLATFORM")}</span> : null}
            <span className={u.statut === "actif" ? "etiquette etiquette-ok" : "etiquette etiquette-erreur"}>{t(`statut.${u.statut}`)}</span>
            {u.verrouilleJusqua ? <span className="etiquette etiquette-erreur">{t("users.verrouille", { heure: formaterDate(langue, u.verrouilleJusqua, fuseau) })}</span> : null}
            {u.doitChangerMdp ? <span className="etiquette etiquette-alerte">{t("users.doit_changer")}</span> : null}
            <span className="etiquette">{t(`langue.${u.langue}`)}</span>
          </div>
        </div>
      </header>

      <section className="carte">
        <h2>{t("commun.actions")}</h2>
        {u.estSuperadmin ? <p className="bandeau bandeau-info">{t("users.superadmin_info")}</p> : null}
        <div className="actions-ligne">
          {gerable ? (
            u.statut === "actif" ? (
              <FormulaireAction action={actionDesactiverUtilisateur} libelle={t("users.desactiver")} libelleEnCours={t("commun.en_cours")} variante="danger">
                <input type="hidden" name="utilisateurId" value={u.id} />
              </FormulaireAction>
            ) : (
              <FormulaireAction action={actionReactiverUtilisateur} libelle={t("users.reactiver")} libelleEnCours={t("commun.en_cours")} variante="ligne">
                <input type="hidden" name="utilisateurId" value={u.id} />
              </FormulaireAction>
            )
          ) : null}
          {u.id !== ctx.utilisateur.id ? (
            <FormulaireAction action={actionRevoquerSessionsUtilisateur} libelle={t("users.revoquer")} libelleEnCours={t("commun.en_cours")} variante="discret">
              <input type="hidden" name="utilisateurId" value={u.id} />
            </FormulaireAction>
          ) : null}
        </div>
        {gerable ? (
          <div className="pied-carte">
            <h3>{t("users.reinitialiser")}</h3>
            <p className="discret petit">{t("users.reinitialiser_aide")}</p>
            <FormulaireAction action={actionReinitialiserMotDePasse} libelle={t("users.reinitialiser")} libelleEnCours={t("commun.en_cours")} variante="ligne" vider={false}>
              <input type="hidden" name="utilisateurId" value={u.id} />
              <label className="champ">
                <span>{t("orgs.mdp_provisoire")}</span>
                <input type="text" name="motDePasse" required minLength={12} maxLength={200} autoComplete="new-password" spellCheck={false} />
                <small>{t("mdp.regle")}</small>
              </label>
            </FormulaireAction>
          </div>
        ) : null}
      </section>

      <section className="carte">
        <h2>{t("users.adhesions")}</h2>
        {u.adhesions.length === 0 ? (
          <p className="vide">{t("commun.aucun")}</p>
        ) : (
          <table className="tableau">
            <tbody>
              {u.adhesions.map((a) => (
                <tr key={a.organisationId}>
                  <td>
                    <Link href={`/plateforme/organisations/${a.organisationId}`}>{a.nom}</Link>{" "}
                    {a.statutOrganisation === "suspendue" ? <span className="etiquette etiquette-erreur">{t("statut.suspendue")}</span> : null}
                  </td>
                  <td>
                    <div className="liste-etiquettes">
                      {a.roles.map((r) => (
                        <span key={r} className="etiquette">
                          {t(`role.${r}`)}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="carte">
        <h2>{t("sessions.ouvertes")}</h2>
        <TableauSessions ctx={ctx} sessions={ouvertes} ouvertes afficherUtilisateur={false} />
      </section>

      <section className="carte">
        <h2>{t("users.activite")}</h2>
        <Journal t={t} langue={langue} fuseau={fuseau} journal={journal} afficherOrganisation />
      </section>

      <section className="carte">
        <h2>{t("sessions.recentes")}</h2>
        <TableauSessions ctx={ctx} sessions={terminees} ouvertes={false} afficherUtilisateur={false} />
      </section>
    </>
  );
}
