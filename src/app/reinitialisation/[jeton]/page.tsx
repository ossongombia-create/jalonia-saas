// Lien de réinitialisation du mot de passe (page PUBLIQUE ; décision n° 1 du 19/10/2026). Le lien est le seul
// secret : la page ne montre rien tant qu'il n'est pas valable (même réponse que le lien soit inconnu, déjà
// utilisé, annulé ou expiré). La personne choisit elle-même son nouveau mot de passe.
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { actionReinitialiserParLien } from "@/actions/reinitialisation";
import { actionChangerLangue, actionDeconnexion } from "@/actions/compte";
import { ChoixLangue } from "@/components/ChoixLangue";
import { FormulaireAction } from "@/components/FormulaireAction";
import { Logo } from "@/components/Logo";
import { formaterDate } from "@/lib/format";
import { traducteur } from "@/lib/i18n";
import { config } from "@/server/config";
import { poolApplication } from "@/server/db/pools";
import { lireReinitialisation } from "@/server/utilisateurs/service";
import { estMaintenanceActive, lireContexte, lireLangue } from "@/server/web/contexte";

export async function generateMetadata(): Promise<Metadata> {
  // Le lien contient le jeton : il ne doit pas être transmis à un autre site (en-tête Referer).
  return { title: traducteur(await lireLangue())("reinit.titre"), referrer: "no-referrer", robots: { index: false, follow: false } };
}

export default async function PageReinitialisation({ params }: { params: Promise<{ jeton: string }> }) {
  if (await estMaintenanceActive()) redirect("/maintenance");
  const { jeton } = await params;
  const ctx = await lireContexte();
  const langue = await lireLangue();
  const t = traducteur(langue);
  const lien = await lireReinitialisation(poolApplication(), jeton);

  let contenu: ReactNode;
  if (!lien) {
    contenu = <p className="message message-erreur">{t("reinit.invalide")}</p>;
  } else if (ctx) {
    // Quelqu'un est connecté dans ce navigateur : se déconnecter d'abord.
    contenu = (
      <>
        <p className="message message-erreur">{t("invitation.deja_connecte")}</p>
        <form action={actionDeconnexion} className="pied-carte">
          <button type="submit" className="bouton bouton-second">
            {t("commun.deconnexion")}
          </button>
        </form>
      </>
    );
  } else {
    contenu = (
      <>
        <p>{t("reinit.texte", { email: lien.email })}</p>
        <p className="discret petit">{t("reinit.expire", { date: formaterDate(langue, lien.expireLe, config().FUSEAU_HORAIRE) })}</p>
        <FormulaireAction action={actionReinitialiserParLien} libelle={t("reinit.valider")} libelleEnCours={t("commun.en_cours")}>
          <input type="hidden" name="jeton" value={jeton} />
          <input type="email" value={lien.email} readOnly hidden autoComplete="username" />
          <label className="champ">
            <span>{t("invitation.mdp")}</span>
            <input type="password" name="nouveau" required maxLength={200} autoComplete="new-password" />
            <small>{t("mdp.regle")}</small>
          </label>
          <label className="champ">
            <span>{t("invitation.mdp_confirmation")}</span>
            <input type="password" name="confirmation" required maxLength={200} autoComplete="new-password" />
          </label>
        </FormulaireAction>
      </>
    );
  }

  return (
    <div className="page-simple">
      <section className="carte">
        <ChoixLangue action={actionChangerLangue} langue={langue} libelle={t("commun.langue")} />
        <Logo variante="couleur" largeur={300} className="logo-carte" prioritaire />
        <h1>{t("reinit.titre")}</h1>
        {contenu}
        <p className="pied-carte">
          <Link href="/connexion">{t("reinit.aller_connexion")}</Link>
        </p>
      </section>
    </div>
  );
}
