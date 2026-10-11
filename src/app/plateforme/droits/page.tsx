// Matrice des rôles et droits, lue DIRECTEMENT dans le code (src/lib/rbac.ts) : ce qui est affiché est
// exactement ce que le serveur applique.
import { DROITS, LISTE_DROITS, TOUS_LES_ROLES } from "@/lib/rbac";
import { exigerSuperadmin } from "@/server/web/contexte";
import { titrePage } from "@/server/web/metadonnees";

export const generateMetadata = titrePage("droits.titre");

export default async function PageDroits() {
  const ctx = await exigerSuperadmin();
  const { t } = ctx;

  return (
    <>
      <header className="entete">
        <div>
          <h1>{t("droits.titre")}</h1>
          <p>{t("droits.texte")}</p>
        </div>
      </header>
      <section className="carte">
        <div className="tableau-defilant">
          <table className="tableau matrice">
            <thead>
              <tr>
                <th>{t("droits.droit")}</th>
                <th>{t("droits.etat")}</th>
                {TOUS_LES_ROLES.map((r) => (
                  <th key={r} className="role">
                    {t(`role.${r}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {LISTE_DROITS.map((d) => {
                const def = DROITS[d];
                const roles: readonly string[] = def.roles;
                return (
                  <tr key={d}>
                    <td>
                      {t(`droit.${d}`)}
                      <br />
                      <code className="discret petit">{d}</code>
                    </td>
                    <td>
                      <span className={def.etat === "actif" ? "etiquette etiquette-ok" : "etiquette"}>{t(`droit.etat.${def.etat}`)}</span>
                    </td>
                    {TOUS_LES_ROLES.map((r) => (
                      <td key={r} className="coche">
                        {roles.includes(r) ? "✓" : ""}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
