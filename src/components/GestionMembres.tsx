// Liste et gestion des membres d'une organisation : membres, invitations en attente, nouvelle invitation.
// - Administrateur de l'organisation (/app/membres) : gestion complète ; les droits sont revérifiés côté serveur par
//   chaque action (src/actions/membres.ts).
// - Superadmin (/plateforme/organisations/[id]) : LECTURE SEULE (`lectureSeule`), aucun formulaire (chantier 1 du
//   20/10/2026) ; le serveur le refuse de toute façon.
import { actionAnnulerInvitation, actionInviterMembre, actionModifierRoles, actionRetirerMembre } from "@/actions/membres";
import { formaterDate } from "@/lib/format";
import { ROLES_ORGANISATION } from "@/lib/rbac";
import type { Contexte } from "@/server/web/contexte";
import type { Membre } from "@/server/membres/service";
import type { InvitationEnAttente } from "@/server/invitations/service";
import { FormulaireAction } from "./FormulaireAction";

interface Props {
  ctx: Contexte;
  organisationId: string;
  membres: Membre[];
  invitations: InvitationEnAttente[];
  /** Superadmin : listes seulement, aucun bouton. */
  lectureSeule?: boolean;
}

export function GestionMembres({ ctx, organisationId, membres, invitations, lectureSeule = false }: Props) {
  const { t, langue, fuseau } = ctx;
  const libellesLien = { lien: t("invitation.lien"), copier: t("commun.copier"), copie: t("commun.copie") };
  return (
    <>
      <section className="carte">
        <h2>{t("membres.titre")}</h2>
        {lectureSeule ? <p className="discret" id="membres-lecture-seule">{t("membres.lecture_seule_superadmin")}</p> : null}
        {membres.length === 0 ? (
          <p className="vide">{t("commun.aucun")}</p>
        ) : (
          <div className="tableau-defilant">
            <table className="tableau">
              <thead>
                <tr>
                  <th>{t("commun.nom")}</th>
                  <th>{t("membres.roles")}</th>
                  <th>{t("membres.derniere_action")}</th>
                  {lectureSeule ? null : <th>{t("commun.actions")}</th>}
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
                      {m.fonction ? (
                        <>
                          {" "}
                          <span className="etiquette" data-fonction={m.fonction}>
                            {t(m.fonction === "titulaire" ? "membres.fonction_titulaire" : m.statutSuppleant === "actif" ? "membres.fonction_suppleant_actif" : "membres.fonction_suppleant_inactif")}
                          </span>
                        </>
                      ) : null}
                    </td>
                    <td>
                      {lectureSeule ? m.roles.map((r) => t(`role.${r}`)).join(", ") : (
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
                      )}
                    </td>
                    <td className="nowrap">{m.derniereAction ? formaterDate(langue, m.derniereAction, fuseau) : t("commun.jamais")}</td>
                    {lectureSeule ? null : (
                      <td>
                        <FormulaireAction action={actionRetirerMembre} libelle={t("membres.retirer")} libelleEnCours={t("commun.en_cours")} variante="danger">
                          <input type="hidden" name="organisationId" value={organisationId} />
                          <input type="hidden" name="utilisateurId" value={m.utilisateurId} />
                        </FormulaireAction>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {invitations.length > 0 ? (
        <section className="carte">
          <h2>{t("invitation.en_attente")}</h2>
          <p className="discret">{t(lectureSeule ? "invitation.en_attente_aide_superadmin" : "invitation.en_attente_aide")}</p>
          <div className="tableau-defilant">
            <table className="tableau">
              <thead>
                <tr>
                  <th>{t("commun.nom")}</th>
                  <th>{t("membres.roles")}</th>
                  <th>{t("invitation.valable_jusqua")}</th>
                  {lectureSeule ? null : <th>{t("commun.actions")}</th>}
                </tr>
              </thead>
              <tbody>
                {invitations.map((i) => (
                  <tr key={i.id}>
                    <td>
                      <strong>{i.nom}</strong>
                      <br />
                      <span className="discret">{i.email}</span>
                    </td>
                    <td>{i.roles.map((r) => t(`role.${r}`)).join(", ")}</td>
                    <td className="nowrap">
                      {i.expiree ? <span className="etiquette etiquette-erreur">{t("invitation.expiree")}</span> : formaterDate(langue, i.expireLe, fuseau)}
                    </td>
                    {lectureSeule ? null : (
                      <td>
                        <FormulaireAction action={actionAnnulerInvitation} libelle={t("invitation.annuler")} libelleEnCours={t("commun.en_cours")} variante="danger">
                          <input type="hidden" name="organisationId" value={organisationId} />
                          <input type="hidden" name="invitationId" value={i.id} />
                        </FormulaireAction>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {lectureSeule ? null : (
      <section className="carte">
        <h2>{t("invitation.inviter_titre")}</h2>
        <p className="discret">{t("invitation.inviter_aide")}</p>
        <FormulaireAction action={actionInviterMembre} libelle={t("invitation.inviter")} libelleEnCours={t("commun.en_cours")} libellesLien={libellesLien}>
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
        </FormulaireAction>
      </section>
      )}
    </>
  );
}
