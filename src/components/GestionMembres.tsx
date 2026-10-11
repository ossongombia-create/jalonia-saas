// Liste et gestion des membres d'une organisation (utilisée par l'administrateur de l'organisation et
// par le superadmin). Les droits sont revérifiés côté serveur par chaque action.
import { actionAjouterMembre, actionModifierRoles, actionRetirerMembre } from "@/actions/membres";
import { formaterDate } from "@/lib/format";
import { ROLES_ORGANISATION } from "@/lib/rbac";
import type { Contexte } from "@/server/web/contexte";
import type { Membre } from "@/server/membres/service";
import { FormulaireAction } from "./FormulaireAction";

interface Props {
  ctx: Contexte;
  organisationId: string;
  membres: Membre[];
}

export function GestionMembres({ ctx, organisationId, membres }: Props) {
  const { t, langue, fuseau } = ctx;
  return (
    <>
      <section className="carte">
        <h2>{t("membres.titre")}</h2>
        {membres.length === 0 ? (
          <p className="vide">{t("commun.aucun")}</p>
        ) : (
          <div className="tableau-defilant">
            <table className="tableau">
              <thead>
                <tr>
                  <th>{t("commun.nom")}</th>
                  <th>{t("membres.roles")}</th>
                  <th>{t("membres.derniere_connexion")}</th>
                  <th>{t("commun.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {membres.map((m) => (
                  <tr key={m.utilisateurId}>
                    <td>
                      <strong>{m.nom}</strong> {m.utilisateurId === ctx.utilisateur.id ? <span className="discret">{t("membres.vous")}</span> : null}
                      <br />
                      <span className="discret">{m.email}</span>
                      {m.statut !== "actif" ? (
                        <>
                          {" "}
                          <span className="etiquette etiquette-erreur">{t("statut.desactive")}</span>
                        </>
                      ) : null}
                    </td>
                    <td>
                      <FormulaireAction
                        key={m.roles.join(",")}
                        action={actionModifierRoles}
                        libelle={t("membres.modifier_roles")}
                        libelleEnCours={t("commun.en_cours")}
                        variante="ligne"
                        vider={false}
                      >
                        <input type="hidden" name="organisationId" value={organisationId} />
                        <input type="hidden" name="utilisateurId" value={m.utilisateurId} />
                        <fieldset className="cases">
                          <legend className="lecteur-ecran">{t("membres.roles")}</legend>
                          {ROLES_ORGANISATION.map((r) => (
                            <label key={r} className="case">
                              <input type="checkbox" name="roles" value={r} defaultChecked={m.roles.includes(r)} />
                              {t(`role.${r}`)}
                            </label>
                          ))}
                        </fieldset>
                      </FormulaireAction>
                    </td>
                    <td className="nowrap">{m.derniereConnexion ? formaterDate(langue, m.derniereConnexion, fuseau) : t("commun.jamais")}</td>
                    <td>
                      <FormulaireAction action={actionRetirerMembre} libelle={t("membres.retirer")} libelleEnCours={t("commun.en_cours")} variante="danger">
                        <input type="hidden" name="organisationId" value={organisationId} />
                        <input type="hidden" name="utilisateurId" value={m.utilisateurId} />
                      </FormulaireAction>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="carte">
        <h2>{t("membres.ajouter")}</h2>
        <FormulaireAction action={actionAjouterMembre} libelle={t("membres.ajouter")} libelleEnCours={t("commun.en_cours")}>
          <input type="hidden" name="organisationId" value={organisationId} />
          <div className="grille-champs">
            <label className="champ">
              <span>{t("commun.email")}</span>
              <input type="email" name="email" required maxLength={254} autoComplete="off" />
            </label>
            <label className="champ">
              <span>{t("commun.nom")}</span>
              <input type="text" name="nom" required maxLength={200} autoComplete="off" />
            </label>
          </div>
          <fieldset className="cases">
            <legend>{t("membres.roles")}</legend>
            {ROLES_ORGANISATION.map((r) => (
              <label key={r} className="case">
                <input type="checkbox" name="roles" value={r} defaultChecked={r === "LECTEUR"} />
                {t(`role.${r}`)}
              </label>
            ))}
          </fieldset>
          <label className="champ">
            <span>{t("orgs.mdp_provisoire")}</span>
            <input type="text" name="motDePasseProvisoire" maxLength={200} autoComplete="new-password" spellCheck={false} />
            <small>{t("membres.mdp_aide")} {t("mdp.regle")}</small>
          </label>
        </FormulaireAction>
      </section>
    </>
  );
}
