// Nouvelle action (audit Q1) : droit actions.gerer. Depuis un registre (?document=…&element=…), l'action vise l'élément
// du document (risque, opportunité, indicateur) : son texte et son origine sont lus dans le document.
import Link from "next/link";
import { actionCreerAction } from "@/actions/qse";
import { ChampsAction } from "@/components/ChampsAction";
import { FormulaireAction } from "@/components/FormulaireAction";
import { poolApplication } from "@/server/db/pools";
import { listerMembres } from "@/server/membres/service";
import { elementVise } from "@/server/qse/vues";
import { exigerOrganisation } from "@/server/web/contexte";
import { titrePage } from "@/server/web/metadonnees";

export const generateMetadata = titrePage("actions.nouvelle");

export default async function PageNouvelleAction({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await exigerOrganisation("actions.gerer");
  const { t, organisation } = ctx;
  const q = await searchParams;
  const pool = poolApplication();
  const vise = typeof q.document === "string" && typeof q.element === "string" ? await elementVise(pool, organisation, q.document, q.element) : null;
  const responsables = (await listerMembres(pool, organisation.id)).filter((m) => m.statut === "actif").map((m) => ({ id: m.utilisateurId, nom: m.nom || m.email }));

  return (
    <>
      <header className="entete">
        <div>
          <p><Link href="/app/actions">{t("actions.retour")}</Link></p>
          <h1>{t("actions.nouvelle")}</h1>
        </div>
      </header>
      <section className="carte">
        {vise ? (
          <p className="bandeau bandeau-info" id="element-vise">
            {t("actions.element")} : {t(`actions.origine.${vise.origine}`)} — {vise.libelle || "—"} ({vise.document})
          </p>
        ) : null}
        <FormulaireAction action={actionCreerAction} libelle={t("actions.creer")} libelleEnCours={t("commun.en_cours")} vider={false}>
          <input type="hidden" name="organisationId" value={organisation.id} />
          {vise ? (
            <>
              <input type="hidden" name="documentId" value={String(q.document)} />
              <input type="hidden" name="elementId" value={String(q.element)} />
            </>
          ) : null}
          <ChampsAction t={t} responsables={responsables} valeurs={{ titre: "", description: "", origine: vise?.origine ?? "autre", responsableId: null, echeance: null }} />
        </FormulaireAction>
      </section>
    </>
  );
}
