// Mise en page des espaces connectés : rail de navigation à gauche, contenu à droite.
import Link from "next/link";
import { actionChangerLangue, actionDeconnexion } from "@/actions/compte";
import type { Contexte } from "@/server/web/contexte";
import { ChoixLangue } from "./ChoixLangue";
import { LienNav } from "./LienNav";
import { Logo } from "./Logo";

export interface LienCoque {
  href: string;
  libelle: string;
  exact?: boolean;
}

interface Props {
  ctx: Contexte;
  espace: string;
  liens: LienCoque[];
  liensSecondaires?: LienCoque[];
  children: React.ReactNode;
}

export function Coque({ ctx, espace, liens, liensSecondaires = [], children }: Props) {
  const { t } = ctx;
  return (
    <div className="coque">
      <aside className="rail">
        <div className="rail-marque">
          <Link href="/" className="rail-logo">
            <Logo variante="clair" largeur={214} prioritaire />
          </Link>
          <span className="rail-espace">{espace}</span>
        </div>
        <nav className="rail-nav" aria-label={espace}>
          {liens.map((l) => (
            <LienNav key={l.href} href={l.href} exact={l.exact}>
              {l.libelle}
            </LienNav>
          ))}
        </nav>
        {liensSecondaires.length > 0 ? (
          <nav className="rail-nav rail-nav-secondaire">
            {liensSecondaires.map((l) => (
              <LienNav key={l.href} href={l.href} exact={l.exact}>
                {l.libelle}
              </LienNav>
            ))}
          </nav>
        ) : null}
        <div className="rail-pied">
          <div className="rail-utilisateur">
            <strong>{ctx.utilisateur.nom}</strong>
            <span>{ctx.utilisateur.email}</span>
          </div>
          <LienNav href="/compte/mot-de-passe">{t("commun.mon_mot_de_passe")}</LienNav>
          <LienNav href="/compte/second-facteur">{t("mfa.mon_second_facteur")}</LienNav>
          <ChoixLangue action={actionChangerLangue} langue={ctx.langue} libelle={t("commun.langue")} />
          <form action={actionDeconnexion}>
            <button type="submit" className="bouton bouton-rail">
              {t("commun.deconnexion")}
            </button>
          </form>
        </div>
      </aside>
      <main className="contenu">{children}</main>
    </div>
  );
}

/** Liens du rail pour l'espace plateforme. */
export function liensPlateforme(ctx: Contexte): LienCoque[] {
  const { t } = ctx;
  return [
    { href: "/plateforme", libelle: t("nav.tableau"), exact: true },
    { href: "/plateforme/organisations", libelle: t("nav.organisations") },
    { href: "/plateforme/utilisateurs", libelle: t("nav.utilisateurs") },
    { href: "/plateforme/sessions", libelle: t("nav.sessions") },
    { href: "/plateforme/journal", libelle: t("nav.journal") },
    { href: "/plateforme/droits", libelle: t("nav.droits") },
    { href: "/plateforme/maintenance", libelle: t("nav.maintenance") },
  ];
}
