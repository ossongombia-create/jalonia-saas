import type { Metadata } from "next";
import { actionChangerMotDePasse, actionContinuer } from "@/actions/compte";
import { FormulaireAction } from "@/components/FormulaireAction";
import { traducteur } from "@/lib/i18n";
import { exigerContexte, lireLangue } from "@/server/web/contexte";
import { Logo } from "@/components/Logo";

export async function generateMetadata(): Promise<Metadata> {
  return { title: traducteur(await lireLangue())("mdp.titre") };
}

export default async function PageMotDePasse() {
  const ctx = await exigerContexte({ permettreMdpProvisoire: true });
  const { t } = ctx;
  const oblige = ctx.utilisateur.doitChangerMdp;

  return (
    <div className="page-simple">
      <section className="carte">
        <Logo variante="couleur" largeur={300} className="logo-carte" prioritaire />
        <h1>{t("mdp.titre")}</h1>
        {oblige ? <p className="bandeau bandeau-alerte">{t("mdp.obligatoire")}</p> : null}
        <FormulaireAction action={actionChangerMotDePasse} libelle={t("mdp.bouton")} libelleEnCours={t("commun.en_cours")}>
          <label className="champ">
            <span>{t("mdp.actuel")}</span>
            <input type="password" name="actuel" required maxLength={200} autoComplete="current-password" />
          </label>
          <label className="champ">
            <span>{t("mdp.nouveau")}</span>
            <input type="password" name="nouveau" required minLength={12} maxLength={200} autoComplete="new-password" />
            <small>{t("mdp.regle")}</small>
          </label>
          <label className="champ">
            <span>{t("mdp.confirmation")}</span>
            <input type="password" name="confirmation" required minLength={12} maxLength={200} autoComplete="new-password" />
          </label>
        </FormulaireAction>
        {/* Après le changement (ou s'il n'était pas obligatoire) : retour à son espace. */}
        {oblige ? null : (
          <form action={actionContinuer} className="pied-carte">
            <button type="submit" className="bouton bouton-second">
              {t("mdp.continuer")} →
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
