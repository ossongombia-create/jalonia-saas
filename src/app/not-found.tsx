import Link from "next/link";
import { traducteur } from "@/lib/i18n";
import { lireLangue } from "@/server/web/contexte";

export default async function Introuvable() {
  const t = traducteur(await lireLangue());
  return (
    <div className="page-simple">
      <section className="carte">
        <h1>{t("page.introuvable_titre")}</h1>
        <p>{t("page.introuvable_texte")}</p>
        <Link href="/" className="bouton">
          {t("nav.accueil")}
        </Link>
      </section>
    </div>
  );
}
