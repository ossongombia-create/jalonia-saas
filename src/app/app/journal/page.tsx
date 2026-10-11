import { Journal } from "@/components/Journal";
import { poolApplication } from "@/server/db/pools";
import { lireJournalOrganisation } from "@/server/consultation/service";
import { exigerOrganisation } from "@/server/web/contexte";
import { titrePage } from "@/server/web/metadonnees";
import { lireFiltreJournal } from "@/server/web/parametres";

export const generateMetadata = titrePage("journal.titre");

export default async function PageJournalOrganisation({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await exigerOrganisation("organisation.journal.lire");
  const { t } = ctx;
  const filtre = lireFiltreJournal(await searchParams);
  // Lecture avec le rôle PostgreSQL de l'organisation : seul son propre journal est accessible.
  const journal = await lireJournalOrganisation(poolApplication(), ctx.organisation, filtre);

  return (
    <>
      <header className="entete">
        <div>
          <h1>{t("journal.titre")}</h1>
          <p>
            {t("journal.texte_org")} {t("commun.fuseau", { fuseau: ctx.fuseau })}
          </p>
        </div>
      </header>
      <section className="carte">
        <Journal t={t} langue={ctx.langue} fuseau={ctx.fuseau} journal={journal} base="/app/journal" action={filtre.action} />
      </section>
    </>
  );
}
