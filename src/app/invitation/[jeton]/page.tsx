// Invitation à rejoindre une organisation (page PUBLIQUE : la personne n'a peut-être pas encore de compte).
// Le lien est le seul secret : la page ne montre rien tant qu'il n'est pas valable (même réponse que le lien
// soit inconnu, déjà utilisé, annulé ou expiré).
import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { actionAccepterInvitation, actionCreerCompteInvitation } from "@/actions/invitations";
import { actionChangerLangue, actionDeconnexion } from "@/actions/compte";
import { ChoixLangue } from "@/components/ChoixLangue";
import { FormulaireAction } from "@/components/FormulaireAction";
import { Logo } from "@/components/Logo";
import { formaterDate } from "@/lib/format";
import { traducteur } from "@/lib/i18n";
import { config } from "@/server/config";
import { poolApplication } from "@/server/db/pools";
import { lireInvitation } from "@/server/invitations/service";
import { lireContexte, lireLangue } from "@/server/web/contexte";

export async function generateMetadata(): Promise<Metadata> {
  // Le lien contient le jeton : il ne doit pas être transmis à un autre site (en-tête Referer).
  return { title: traducteur(await lireLangue())("invitation.titre"), referrer: "no-referrer", robots: { index: false, follow: false } };
}

export default async function PageInvitation({ params }: { params: Promise<{ jeton: string }> }) {
  const { jeton } = await params;
  const ctx = await lireContexte();
  const langue = await lireLangue();
  const t = traducteur(langue);
  const inv = await lireInvitation(poolApplication(), jeton);

  let contenu: ReactNode;
  if (!inv) {
    contenu = (
      <>
        <h1>{t("invitation.titre")}</h1>
        <p className="message message-erreur">{t("invitation.invalide")}</p>
      </>
    );
  } else {
    const roles = inv.roles.map((r) => t(`role.${r}`)).join(", ");
    const entete = (
      <>
        <h1>{t("invitation.rejoindre", { organisation: inv.organisationNom })}</h1>
        <p>{t("invitation.destinataire", { email: inv.email, roles })}</p>
        <p className="discret petit">{t("invitation.expire", { date: formaterDate(langue, inv.expireLe, config().FUSEAU_HORAIRE) })}</p>
      </>
    );
    if (ctx && ctx.utilisateur.email !== inv.email) {
      // Connecté avec un AUTRE compte.
      contenu = (
        <>
          {entete}
          <p className="message message-erreur">{t("invitation.autre_compte_connecte", { email: ctx.utilisateur.email })}</p>
          <form action={actionDeconnexion} className="pied-carte">
            <button type="submit" className="bouton bouton-second">
              {t("commun.deconnexion")}
            </button>
          </form>
        </>
      );
    } else if (ctx) {
      // Connecté avec l'adresse invitée : accepter.
      contenu = (
        <>
          {entete}
          <FormulaireAction action={actionAccepterInvitation} libelle={t("invitation.accepter")} libelleEnCours={t("commun.en_cours")}>
            <input type="hidden" name="jeton" value={jeton} />
          </FormulaireAction>
        </>
      );
    } else if (inv.compteExiste) {
      // Compte existant, pas connecté : se connecter, puis revenir ici.
      contenu = (
        <>
          {entete}
          <p>{t("invitation.se_connecter_texte", { email: inv.email })}</p>
          <p className="pied-carte">
            <Link href={`/connexion?suite=${encodeURIComponent(`/invitation/${jeton}`)}`} className="bouton">
              {t("invitation.se_connecter")}
            </Link>
          </p>
        </>
      );
    } else {
      // Pas de compte : le créer (la personne choisit SON mot de passe).
      contenu = (
        <>
          {entete}
          <p className="discret">{t("invitation.creer_texte")}</p>
          <FormulaireAction action={actionCreerCompteInvitation} libelle={t("invitation.creer")} libelleEnCours={t("commun.en_cours")} vider={false}>
            <input type="hidden" name="jeton" value={jeton} />
            <label className="champ">
              <span>{t("commun.email")}</span>
              <input type="email" value={inv.email} readOnly autoComplete="username" />
            </label>
            <label className="champ">
              <span>{t("commun.nom")}</span>
              <input type="text" name="nom" required maxLength={200} defaultValue={inv.nom} autoComplete="name" />
            </label>
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
  }

  return (
    <div className="page-simple">
      <section className="carte">
        <ChoixLangue action={actionChangerLangue} langue={langue} libelle={t("commun.langue")} />
        <Logo variante="couleur" largeur={300} className="logo-carte" prioritaire />
        {contenu}
      </section>
    </div>
  );
}
