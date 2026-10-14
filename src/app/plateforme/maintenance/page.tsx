import { FormulaireAction } from "@/components/FormulaireAction";
import { actionEnregistrerMaintenance } from "@/actions/maintenance";
import { poolApplication } from "@/server/db/pools";
import { lireMaintenance } from "@/server/maintenance/service";
import { exigerSuperadmin } from "@/server/web/contexte";
import { titrePage } from "@/server/web/metadonnees";

export const generateMetadata = titrePage("maintenance.titre");

export default async function PageMaintenance() {
  const ctx = await exigerSuperadmin();
  const m = await lireMaintenance(poolApplication());
  const { t } = ctx;
  return (
    <>
      <header className="entete"><div><h1>{t("maintenance.titre")}</h1><p>{t("maintenance.aide")}</p></div></header>
      <section className="carte">
        <p className={m.actif ? "bandeau bandeau-alerte" : "bandeau bandeau-info"} role="status">
          {m.actif ? t("maintenance.active") : t("maintenance.inactive")}
        </p>
        <FormulaireAction action={actionEnregistrerMaintenance} libelle={t("commun.enregistrer")} libelleEnCours={t("commun.en_cours")} vider={false}>
          <label className="champ">
            <span>{t("maintenance.etat")}</span>
            <select name="actif" defaultValue={m.actif ? "oui" : "non"}>
              <option value="non">{t("commun.non")}</option>
              <option value="oui">{t("commun.oui")}</option>
            </select>
          </label>
          <label className="champ"><span>{t("maintenance.message_fr")}</span><textarea name="messageFr" maxLength={1000} required defaultValue={m.messageFr} /></label>
          <label className="champ"><span>{t("maintenance.message_en")}</span><textarea name="messageEn" maxLength={1000} required defaultValue={m.messageEn} /></label>
          <p className="discret petit">{t("maintenance.superadmin_acces")}</p>
        </FormulaireAction>
      </section>
    </>
  );
}
