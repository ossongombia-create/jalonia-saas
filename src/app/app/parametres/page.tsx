// Paramètres de l'organisation (audit W2) : revue périodique des documents publiés, rappels et escalades.
// Administrateur de l'organisation seulement.
import { actionModifierParametres } from "@/actions/organisation";
import { FormulaireAction } from "@/components/FormulaireAction";
import { formaterDate } from "@/lib/format";
import { poolApplication } from "@/server/db/pools";
import { BORNES, lireParametresOrganisation } from "@/server/documents/revues";
import { exigerOrganisation } from "@/server/web/contexte";
import { titrePage } from "@/server/web/metadonnees";

export const generateMetadata = titrePage("parametres.titre");

export default async function PageParametres() {
  const ctx = await exigerOrganisation("organisation.parametres");
  const { t, organisation, langue, fuseau } = ctx;
  const p = await lireParametresOrganisation(poolApplication(), organisation);
  const champs = [
    { nom: "periodeRevueMois", valeur: p.periodeRevueMois },
    { nom: "rappelJours", valeur: p.rappelJours },
    { nom: "escaladeJours", valeur: p.escaladeJours },
  ] as const;

  return (
    <>
      <header className="entete">
        <div>
          <h1>{t("parametres.titre")}</h1>
          <p>{t("parametres.texte")}</p>
        </div>
      </header>
      <section className="carte">
        <FormulaireAction action={actionModifierParametres} libelle={t("parametres.enregistrer")} libelleEnCours={t("commun.en_cours")} vider={false}>
          <input type="hidden" name="organisationId" value={organisation.id} />
          <div className="grille-champs">
            {champs.map((c) => (
              <label className="champ" key={c.nom}>
                <span>{t(`parametres.${c.nom}`)}</span>
                <input type="number" name={c.nom} defaultValue={c.valeur} min={BORNES[c.nom].min} max={BORNES[c.nom].max} step={1} required />
                <small>{t(`parametres.${c.nom}.aide`)}</small>
              </label>
            ))}
          </div>
        </FormulaireAction>
        <p className="discret petit" id="parametres-modifies">
          {p.modifieLe ? t("parametres.modifies", { date: formaterDate(langue, p.modifieLe, fuseau), nom: p.modifieParNom || "—" }) : t("parametres.jamais")}
        </p>
      </section>
    </>
  );
}
