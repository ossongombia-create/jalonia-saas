// Notifications de la personne connectée, dans l'organisation ouverte (audit W2) : documents à vérifier ou à
// approuver, décisions qui la concernent, revues et actions à échéance. Les 100 plus récentes.
import Link from "next/link";
import { actionToutMarquerLu } from "@/actions/organisation";
import { FormulaireAction } from "@/components/FormulaireAction";
import { formaterDate, formaterJour } from "@/lib/format";
import type { Langue, Traducteur } from "@/lib/i18n";
import { poolApplication } from "@/server/db/pools";
import { listerNotifications, type Notification } from "@/server/notifications/service";
import { exigerOrganisation } from "@/server/web/contexte";
import { titrePage } from "@/server/web/metadonnees";

export const generateMetadata = titrePage("notifications.titre");

function texte(t: Traducteur, langue: Langue, n: Notification): string {
  const d = n.details;
  const doc = d.reference && d.titre ? `${d.reference} — ${d.titre}` : d.reference || d.titre || t("docs.sans_titre");
  return t(`notifications.n.${n.nature}`, {
    doc, titre: d.titre ?? "", par: d.par ?? "—", version: d.version ?? "", motif: d.motif ?? "—",
    echeance: formaterJour(langue, d.echeance), jours: d.jours ?? "", heures: d.heures ?? "",
    titulaire: d.titulaire ?? "", debut: formaterJour(langue, d.debut),
  });
}

function cible(n: Notification): string | null {
  if (n.actionId) return `/app/actions/${n.actionId}`;
  if (n.documentId) return `/app/documents/${n.documentId}/validation`;
  return null;
}

export default async function PageNotifications() {
  const ctx = await exigerOrganisation("documents.lire");
  const { t, organisation, langue, fuseau } = ctx;
  const liste = await listerNotifications(poolApplication(), organisation, ctx.acteur.id);
  const nonLues = liste.filter((n) => !n.lueLe).length;

  return (
    <>
      <header className="entete">
        <div>
          <h1>{t("notifications.titre")}</h1>
          <p>{t("notifications.texte")}</p>
        </div>
        {nonLues > 0 ? (
          <FormulaireAction action={actionToutMarquerLu} libelle={t("notifications.tout_lu")} libelleEnCours={t("commun.en_cours")} variante="ligne" vider={false}>
            <input type="hidden" name="organisationId" value={organisation.id} />
          </FormulaireAction>
        ) : null}
      </header>
      <section className="carte">
        {liste.length === 0 ? (
          <p className="vide">{t("notifications.aucune")}</p>
        ) : (
          <ul className="liste-notifications" id="notifications">
            {liste.map((n) => {
              const lien = cible(n);
              return (
                <li key={n.id} className={n.lueLe ? "notification" : "notification notification-nouvelle"} data-nature={n.nature}>
                  <div>
                    {n.lueLe ? null : <><span className="etiquette etiquette-alerte">{t("notifications.nouvelle")}</span>{" "}</>}
                    <span className="notification-texte">{texte(t, langue, n)}</span>
                    <br />
                    <span className="discret petit">{formaterDate(langue, n.creeeLe, fuseau)}</span>
                  </div>
                  {lien ? <Link className="bouton bouton-discret" href={lien}>{t("notifications.ouvrir")}</Link> : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
