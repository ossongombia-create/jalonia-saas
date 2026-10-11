// Tableau de sessions (ouvertes ou terminées), avec fermeture d'une session ouverte.
import Link from "next/link";
import { actionRevoquerSession } from "@/actions/plateforme";
import { formaterDate, formaterDuree, resumerAgent } from "@/lib/format";
import type { LigneSession } from "@/server/consultation/service";
import type { Contexte } from "@/server/web/contexte";
import { FormulaireAction } from "./FormulaireAction";

interface Props {
  ctx: Contexte;
  sessions: LigneSession[];
  ouvertes: boolean;
  afficherUtilisateur?: boolean;
}

export function TableauSessions({ ctx, sessions, ouvertes, afficherUtilisateur = true }: Props) {
  const { t, langue, fuseau } = ctx;
  if (sessions.length === 0) return <p className="vide">{t("commun.aucun")}</p>;
  return (
    <div className="tableau-defilant">
      <table className="tableau">
        <thead>
          <tr>
            {afficherUtilisateur ? <th>{t("sessions.utilisateur")}</th> : null}
            <th>{t("sessions.organisation")}</th>
            <th>{t("sessions.debut")}</th>
            <th>{ouvertes ? t("sessions.derniere_activite") : t("sessions.fin")}</th>
            <th>{t("sessions.duree")}</th>
            <th>{t("sessions.ip")}</th>
            <th>{t("sessions.navigateur")}</th>
            <th>{ouvertes ? t("commun.actions") : t("sessions.motif")}</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => (
            <tr key={s.id}>
              {afficherUtilisateur ? (
                <td>
                  <Link href={`/plateforme/utilisateurs/${s.utilisateurId}`}>{s.nom}</Link>
                  <br />
                  <span className="discret petit">{s.email}</span>
                </td>
              ) : null}
              <td>{s.organisation ?? "—"}</td>
              <td className="nowrap">{formaterDate(langue, s.debut, fuseau)}</td>
              <td className="nowrap">{formaterDate(langue, ouvertes ? s.derniereActivite : (s.fin ?? s.derniereActivite), fuseau)}</td>
              <td className="nowrap">{formaterDuree(t, s.secondes)}</td>
              <td className="nowrap discret">{s.ip ?? "—"}</td>
              <td className="petit" title={s.agent ?? undefined}>
                {resumerAgent(s.agent)}
              </td>
              <td>
                {ouvertes ? (
                  s.id === ctx.sessionId ? (
                    <span className="discret petit">{t("membres.vous")}</span>
                  ) : (
                    <FormulaireAction action={actionRevoquerSession} libelle={t("sessions.revoquer")} libelleEnCours={t("commun.en_cours")} variante="danger">
                      <input type="hidden" name="sessionId" value={s.id} />
                    </FormulaireAction>
                  )
                ) : (
                  <span className="petit">{s.motifFin ? t(`sessions.motif.${s.motifFin}`) : t("sessions.motif.expiration")}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
