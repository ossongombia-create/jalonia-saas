import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { actionChangerLangue, actionConnexion } from "@/actions/compte";
import { ChoixLangue } from "@/components/ChoixLangue";
import { FormulaireAction } from "@/components/FormulaireAction";
import { traducteur } from "@/lib/i18n";
import { accueilDe, lireContexte, lireLangue } from "@/server/web/contexte";

export async function generateMetadata(): Promise<Metadata> {
  return { title: traducteur(await lireLangue())("connexion.titre") };
}

export default async function PageConnexion() {
  const ctx = await lireContexte();
  if (ctx) redirect(accueilDe(ctx));
  const langue = await lireLangue();
  const t = traducteur(langue);

  return (
    <div className="page-simple">
      <div className="marque-simple">
        <strong>{t("app.nom")}</strong>
        <span>{t("app.slogan")}</span>
      </div>
      <section className="carte">
        <ChoixLangue action={actionChangerLangue} langue={langue} libelle={t("commun.langue")} />
        <h1>{t("connexion.titre")}</h1>
        <FormulaireAction action={actionConnexion} libelle={t("connexion.bouton")} libelleEnCours={t("commun.en_cours")} vider={false}>
          <label className="champ">
            <span>{t("connexion.email")}</span>
            <input type="email" name="email" required maxLength={254} autoComplete="username" autoFocus />
          </label>
          <label className="champ">
            <span>{t("connexion.mdp")}</span>
            <input type="password" name="motDePasse" required maxLength={200} autoComplete="current-password" />
          </label>
        </FormulaireAction>
      </section>
    </div>
  );
}
