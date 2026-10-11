// Affichage d'un journal d'audit (plateforme ou organisation), avec filtre par opération et pagination.
import Link from "next/link";
import { ACTIONS, type Action } from "@/lib/actions-journal";
import { formaterDate } from "@/lib/format";
import type { Langue, Traducteur } from "@/lib/i18n";
import type { PageJournal } from "@/server/consultation/service";

interface Props {
  t: Traducteur;
  langue: Langue;
  fuseau: string;
  journal: PageJournal;
  /** Adresse de la page (pour le filtre et la pagination). Absent : ni filtre ni pagination. */
  base?: string;
  action?: Action;
  afficherOrganisation?: boolean;
}

function resumerDetails(details: Record<string, unknown>): string {
  return Object.entries(details)
    .map(([cle, valeur]) => `${cle} : ${typeof valeur === "object" && valeur !== null ? JSON.stringify(valeur) : String(valeur)}`)
    .join(" · ");
}

function adresse(base: string, page: number, action?: Action): string {
  const p = new URLSearchParams();
  if (action) p.set("action", action);
  if (page > 1) p.set("page", String(page));
  const q = p.toString();
  return q ? `${base}?${q}` : base;
}

export function Journal({ t, langue, fuseau, journal, base, action, afficherOrganisation = false }: Props) {
  return (
    <div className="bloc-journal">
      {base ? (
        <form method="get" action={base} className="filtre">
          <label>
            <span>{t("journal.action")}</span>
            <select name="action" defaultValue={action ?? ""}>
              <option value="">{t("commun.toutes_actions")}</option>
              {ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {t(`journal.action.${a}`)}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="bouton bouton-second">
            {t("commun.filtrer")}
          </button>
        </form>
      ) : null}

      {journal.lignes.length === 0 ? (
        <p className="vide">{t("commun.aucun")}</p>
      ) : (
        <div className="tableau-defilant">
          <table className="tableau">
            <thead>
              <tr>
                <th>{t("commun.date")}</th>
                <th>{t("journal.action")}</th>
                <th>{t("journal.acteur")}</th>
                {afficherOrganisation ? <th>{t("sessions.organisation")}</th> : null}
                <th>{t("journal.cible")}</th>
                <th>{t("commun.details")}</th>
                <th>{t("sessions.ip")}</th>
              </tr>
            </thead>
            <tbody>
              {journal.lignes.map((l) => (
                <tr key={l.id}>
                  <td className="nowrap">{formaterDate(langue, l.horodatage, fuseau)}</td>
                  <td>
                    <span className={`etiquette action-${l.action.toLowerCase()}`}>{t(`journal.action.${l.action}`)}</span>
                  </td>
                  <td>{l.acteurEmail ?? "—"}</td>
                  {afficherOrganisation ? <td>{l.organisation ?? "—"}</td> : null}
                  <td className="discret">{l.cibleType ? `${l.cibleType} ${l.cibleId?.slice(0, 8) ?? ""}` : "—"}</td>
                  <td className="discret petit">{resumerDetails(l.details)}</td>
                  <td className="discret nowrap">{l.ip ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {base && (journal.page > 1 || journal.aSuite) ? (
        <nav className="pagination" aria-label="pagination">
          {journal.page > 1 ? <Link href={adresse(base, journal.page - 1, action)}>← {t("commun.precedent")}</Link> : <span />}
          <span>{t("commun.page", { n: journal.page })}</span>
          {journal.aSuite ? <Link href={adresse(base, journal.page + 1, action)}>{t("commun.suivant")} →</Link> : <span />}
        </nav>
      ) : null}
    </div>
  );
}
