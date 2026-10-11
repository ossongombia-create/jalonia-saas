import { Journal } from "@/components/Journal";
import { poolApplication } from "@/server/db/pools";
import { lireJournalPlateforme } from "@/server/consultation/service";
import { exigerSuperadmin } from "@/server/web/contexte";
import { titrePage } from "@/server/web/metadonnees";
import { lireFiltreJournal } from "@/server/web/parametres";

export const generateMetadata = titrePage("journal.titre");

export default async function PageJournalPlateforme({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await exigerSuperadmin();
  const { t } = ctx;
  const filtre = lireFiltreJournal(await searchParams);
  const journal = await lireJournalPlateforme(poolApplication(), filtre);

  return (
    <>
      <header className="entete">
        <div>
          <h1>{t("journal.titre")}</h1>
          <p>
            {t("journal.texte_plateforme")} {t("commun.fuseau", { fuseau: ctx.fuseau })}
          </p>
        </div>
      </header>
      <section className="carte">
        <Journal t={t} langue={ctx.langue} fuseau={ctx.fuseau} journal={journal} base="/plateforme/journal" action={filtre.action} afficherOrganisation />
      </section>
    </>
  );
}
