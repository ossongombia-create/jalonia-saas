import Link from "next/link";
import { actionCreerOrganisation } from "@/actions/plateforme";
import { FormulaireAction } from "@/components/FormulaireAction";
import { exigerSuperadmin } from "@/server/web/contexte";
import { titrePage } from "@/server/web/metadonnees";

export const generateMetadata = titrePage("orgs.nouvelle");

export default async function PageNouvelleOrganisation() {
  const ctx = await exigerSuperadmin();
  const { t } = ctx;

  return (
    <>
      <header className="entete">
        <div>
          <p>
            <Link href="/plateforme/organisations">← {t("orgs.titre")}</Link>
          </p>
          <h1>{t("orgs.nouvelle")}</h1>
        </div>
      </header>
      <section className="carte">
        <FormulaireAction
          action={actionCreerOrganisation}
          libelle={t("orgs.creer")}
          libelleEnCours={t("commun.en_cours")}
          libellesLien={{ lien: t("invitation.lien"), copier: t("commun.copier"), copie: t("commun.copie") }}
          libellesLien2={{ lien: t("orgs.lien_suppleant"), copier: t("commun.copier"), copie: t("commun.copie") }}
        >
          <div className="grille-champs">
            <label className="champ">
              <span>{t("orgs.nom")}</span>
              <input type="text" name="nom" required minLength={2} maxLength={200} autoComplete="off" />
            </label>
            <label className="champ">
              <span>{t("orgs.slug")}</span>
              <input type="text" name="slug" required maxLength={50} pattern="[a-z0-9]([a-z0-9\-]{0,48}[a-z0-9])?" autoComplete="off" spellCheck={false} />
              <small>{t("orgs.slug_aide")}</small>
            </label>
          </div>
          <h2>{t("orgs.admin_titre")}</h2>
          <p className="discret">{t("orgs.admin_aide")}</p>
          <div className="grille-champs">
            <label className="champ">
              <span>{t("orgs.admin_email")}</span>
              <input type="email" name="adminEmail" required maxLength={254} autoComplete="off" />
            </label>
            <label className="champ">
              <span>{t("orgs.admin_nom")}</span>
              <input type="text" name="adminNom" required maxLength={200} autoComplete="off" />
            </label>
          </div>
          <h2>{t("orgs.suppleant_titre")}</h2>
          <p className="discret">{t("orgs.suppleant_aide")}</p>
          <div className="grille-champs">
            <label className="champ">
              <span>{t("orgs.suppleant_email")}</span>
              <input type="email" name="suppleantEmail" required maxLength={254} autoComplete="off" />
            </label>
            <label className="champ">
              <span>{t("orgs.suppleant_nom")}</span>
              <input type="text" name="suppleantNom" required maxLength={200} autoComplete="off" />
            </label>
          </div>
        </FormulaireAction>
      </section>
    </>
  );
}
