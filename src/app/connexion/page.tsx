import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { actionChangerLangue, actionConnexion } from "@/actions/compte";
import { ChoixLangue } from "@/components/ChoixLangue";
import { FormulaireAction } from "@/components/FormulaireAction";
import { traducteur } from "@/lib/i18n";
import { accueilDe, lireContexte, lireLangue } from "@/server/web/contexte";
import { Logo } from "@/components/Logo";

export async function generateMetadata(): Promise<Metadata> {
  return { title: traducteur(await lireLangue())("connexion.titre") };
}

// Retour possible après la connexion : une invitation ouverte avant de se connecter (seul chemin accepté, revérifié
// par l'action de connexion).
const SUITE_PERMISE = /^\/invitation\/[A-Za-z0-9_-]{43}$/;

export default async function PageConnexion({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const brut = (await searchParams).suite;
  const suite = typeof brut === "string" && SUITE_PERMISE.test(brut) ? brut : "";
  const ctx = await lireContexte();
  if (ctx) redirect(suite || accueilDe(ctx));
  const langue = await lireLangue();
  const t = traducteur(langue);

  return (
    <div className="page-simple">
      <section className="carte">
        <ChoixLangue action={actionChangerLangue} langue={langue} libelle={t("commun.langue")} />
        <Logo variante="couleur" largeur={300} className="logo-carte" prioritaire />
        <h1>{t("connexion.titre")}</h1>
        {suite ? <p className="discret">{t("connexion.pour_invitation")}</p> : null}
        <FormulaireAction action={actionConnexion} libelle={t("connexion.bouton")} libelleEnCours={t("commun.en_cours")} vider={false}>
          {suite ? <input type="hidden" name="suite" value={suite} /> : null}
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
