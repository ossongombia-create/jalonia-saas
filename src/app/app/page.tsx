import type { Cle } from "@/lib/i18n";
import { exigerOrganisation } from "@/server/web/contexte";
import { titrePage } from "@/server/web/metadonnees";

export const generateMetadata = titrePage("nav.accueil");

// Modules de l'application d'origine, reconstruits dans les prochaines étapes.
const MODULES: Cle[] = [
  "org.module.cartographie",
  "org.module.procedures",
  "org.module.instructions",
  "org.module.cycle",
  "org.module.risques",
  "org.module.indicateurs",
];

export default async function AccueilOrganisation() {
  const ctx = await exigerOrganisation();
  const { t, organisation } = ctx;

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
            <li key={m}>
              {t(m)}
              <span>{t("org.module.a_venir")}</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
