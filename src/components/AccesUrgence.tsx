// Accès d'urgence de l'exploitant (décision n° 1 du 19/10/2026). Montré au superadmin (page de l'organisation, avec
// le formulaire d'ouverture et la fermeture) ET à l'administrateur de l'organisation (page « Membres », en lecture
// seule) : l'organisation voit qui est entré, quand, pourquoi et avec quel rôle. Rôles permis : Rédacteur ou Lecteur
// (Lecteur présélectionné). Un accès ouvert avec un rôle retiré depuis (« Administrateur », chantier 1) reste affiché
// et fermable, mais sans bouton « Entrer ».
import { actionFermerAccesUrgence, actionOuvrirAccesUrgence } from "@/actions/plateforme";
import { actionChoisirOrganisation } from "@/actions/compte";
import { formaterDate } from "@/lib/format";
import type { Contexte } from "@/server/web/contexte";
import { DUREES_ACCES_URGENCE, estRoleAccesUrgence, ROLE_ACCES_URGENCE_DEFAUT, ROLES_ACCES_URGENCE, type LigneAccesUrgence } from "@/server/acces-urgence/service";
import { FormulaireAction } from "./FormulaireAction";

interface Props {
  ctx: Contexte;
  organisationId: string;
  acces: LigneAccesUrgence[];
  /** Superadmin : formulaire d'ouverture, fermeture, entrée dans l'organisation. Sinon : lecture seule. */
  gestion: boolean;
  /** L'organisation est suspendue : aucun accès ne peut être ouvert. */
  suspendue?: boolean;
}

export function AccesUrgence({ ctx, organisationId, acces, gestion, suspendue = false }: Props) {
  const { t, langue, fuseau } = ctx;
  const monAccesOuvert = gestion ? acces.find((a) => a.etat === "actif" && a.superadminEmail === ctx.utilisateur.email) : undefined;
  const monAcces = monAccesOuvert && estRoleAccesUrgence(monAccesOuvert.role) ? monAccesOuvert : undefined;
  return (
    <section className="carte" id="acces-urgence">
      <h2>{t("acces.titre")}</h2>
      <p className="discret">{gestion ? t("acces.aide_exploitant") : t("acces.aide_organisation")}</p>
      {monAcces ? (
        <div className="actions-ligne">
          <form action={actionChoisirOrganisation}>
            <input type="hidden" name="organisationId" value={organisationId} />
            <button type="submit" className="bouton">{t("acces.entrer")}</button>
          </form>
        </div>
      ) : null}
      {gestion && !monAccesOuvert && !suspendue ? (
        <FormulaireAction action={actionOuvrirAccesUrgence} libelle={t("acces.ouvrir")} libelleEnCours={t("commun.en_cours")} variante="danger" confirmation={t("acces.confirmation")}>
          <input type="hidden" name="organisationId" value={organisationId} />
          <label className="champ">
            <span>{t("acces.role")}</span>
            <select name="role" defaultValue={ROLE_ACCES_URGENCE_DEFAUT}>
              {ROLES_ACCES_URGENCE.map((r) => (
                <option key={r} value={r}>{t(`role.${r}`)}</option>
              ))}
            </select>
          </label>
          <label className="champ">
            <span>{t("acces.duree")}</span>
            <select name="dureeHeures" defaultValue="1">
              {DUREES_ACCES_URGENCE.map((h) => (
                <option key={h} value={h}>{t("acces.heures", { heures: h })}</option>
              ))}
            </select>
          </label>
          <label className="champ">
            <span>{t("acces.motif")}</span>
            <textarea name="motif" required minLength={10} maxLength={2000} rows={3} />
            <small>{t("acces.motif_aide")}</small>
          </label>
        </FormulaireAction>
      ) : null}
      {acces.length === 0 ? (
        <p className="vide">{t("acces.aucun")}</p>
      ) : (
        <div className="tableau-defilant">
          <table className="tableau">
            <thead>
              <tr>
                <th>{t("acces.ouvert_le")}</th>
                <th>{t("acces.par")}</th>
                <th>{t("acces.role")}</th>
                <th>{t("acces.motif")}</th>
                <th>{t("acces.etat")}</th>
                {gestion ? <th>{t("commun.actions")}</th> : null}
              </tr>
            </thead>
            <tbody>
              {acces.map((a) => (
                <tr key={a.id} data-acces={a.etat}>
                  <td className="nowrap">{formaterDate(langue, a.ouvertLe, fuseau)}</td>
                  <td>{a.superadminNom}<br /><span className="discret">{a.superadminEmail}</span></td>
                  <td>{t(`role.${a.role}`)}</td>
                  <td>{a.motif}</td>
                  <td>
                    <span className={a.etat === "actif" ? "etiquette etiquette-alerte" : "etiquette"}>{t(`acces.etat_${a.etat}`)}</span>
                    {a.etat === "actif" && !estRoleAccesUrgence(a.role) ? <><br /><span className="etiquette etiquette-erreur" data-role-retire>{t("acces.role_retire")}</span></> : null}
                    <br />
                    <span className="discret petit">
                      {a.etat === "actif" ? t("acces.jusqua", { date: formaterDate(langue, a.expireLe, fuseau) })
                        : t("acces.duree_valeur", { heures: a.dureeHeures })}
                    </span>
                  </td>
                  {gestion ? (
                    <td>
                      {a.etat === "actif" ? (
                        <FormulaireAction action={actionFermerAccesUrgence} libelle={t("acces.fermer")} libelleEnCours={t("commun.en_cours")} variante="ligne">
                          <input type="hidden" name="accesId" value={a.id} />
                        </FormulaireAction>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
