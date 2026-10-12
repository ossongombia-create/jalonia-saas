import Link from "next/link";
import type { Cle } from "@/lib/i18n";
import { aLeDroit } from "@/lib/rbac";
import { exigerOrganisation } from "@/server/web/contexte";
import { titrePage } from "@/server/web/metadonnees";

export const generateMetadata = titrePage("nav.accueil");

// Modules de l'application : les documents Qualigramme sont disponibles ; les autres arrivent dans les prochaines étapes.
const MODULES: { cle: Cle; disponible: boolean }[] = [
  { cle: "org.module.cartographie", disponible: true },
  { cle: "org.module.procedures", disponible: true },
  { cle: "org.module.instructions", disponible: true },
  { cle: "org.module.cycle", disponible: false },
  { cle: "org.module.risques", disponible: false },
  { cle: "org.module.indicateurs", disponible: false },
];

export default async function AccueilOrganisation() {
  const ctx = await exigerOrganisation();
  const { t, organisation } = ctx;
  const documents = aLeDroit(organisation.roles, "documents.lire");

  return (
    <>
      <header className="entete">
        <div>
          <h1>{t("org.bienvenue", { nom: ctx.utilisateur.nom })}</h1>
          <p>{organisation.nom}</p>
        </div>
      </header>
      <section className="carte">
        <h2>{t("org.vos_roles")}</h2>
        <div className="liste-etiquettes">
          {organisation.roles.map((r) => (
            <span key={r} className="etiquette">
              {t(`role.${r}`)}
            </span>
          ))}
        </div>
      </section>
      <section className="carte">
        <h2>{t("org.modules_titre")}</h2>
        <ul className="grille-modules">
          {MODULES.map((m) => (
            <li key={m.cle} className={m.disponible ? "module-disponible" : undefined}>
              {t(m.cle)}
              {m.disponible && documents ? (
                <Link href="/app/documents">{t("org.module.disponible")} →</Link>
              ) : (
                <span>{t("org.module.a_venir")}</span>
              )}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
