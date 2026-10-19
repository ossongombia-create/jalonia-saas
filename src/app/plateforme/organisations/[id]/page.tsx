import Link from "next/link";
import { notFound } from "next/navigation";
import { actionChangerStatutOrganisation } from "@/actions/plateforme";
import { FormulaireAction } from "@/components/FormulaireAction";
import { AccesUrgence } from "@/components/AccesUrgence";
import { GestionMembres } from "@/components/GestionMembres";
import { formaterDate } from "@/lib/format";
import { identifiant } from "@/lib/validation";
import { poolApplication } from "@/server/db/pools";
import { listerMembres } from "@/server/membres/service";
import { listerInvitations } from "@/server/invitations/service";
import { listerAccesUrgence } from "@/server/acces-urgence/service";
import { lireOrganisation } from "@/server/organisations/service";
import { exigerSuperadmin } from "@/server/web/contexte";
import { titrePage } from "@/server/web/metadonnees";

export const generateMetadata = titrePage("orgs.titre");

export default async function PageOrganisation({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await exigerSuperadmin();
  const { t } = ctx;
  const lu = identifiant.safeParse((await params).id);
  if (!lu.success) notFound();
  const pool = poolApplication();
  const org = await lireOrganisation(pool, lu.data);
  if (!org) notFound();
  const [membres, invitations, acces] = await Promise.all([listerMembres(pool, org.id), listerInvitations(pool, org.id), listerAccesUrgence(pool, org.id)]);
  const suspendue = org.statut === "suspendue";

  return (
    <>
      <header className="entete">
        <div>
          <p>
            <Link href="/plateforme/organisations">← {t("orgs.titre")}</Link>
          </p>
          <h1>{org.nom}</h1>
          <p>
            <span className={suspendue ? "etiquette etiquette-erreur" : "etiquette etiquette-ok"}>{t(`statut.${org.statut}`)}</span>{" "}
            <span className="discret">
              {org.slug} · {t("orgs.creee_le")} {formaterDate(ctx.langue, org.creeLe, ctx.fuseau)} · {t("orgs.isolation")} : {org.schemaName}
            </span>
          </p>
        </div>
        <FormulaireAction
          action={actionChangerStatutOrganisation}
          libelle={suspendue ? t("orgs.reactiver") : t("orgs.suspendre")}
          libelleEnCours={t("commun.en_cours")}
          variante={suspendue ? "ligne" : "danger"}
        >
          <input type="hidden" name="organisationId" value={org.id} />
          <input type="hidden" name="statut" value={suspendue ? "active" : "suspendue"} />
        </FormulaireAction>
      </header>
      {suspendue ? <p className="bandeau bandeau-alerte">{t("orgs.suspendue_info")}</p> : null}
      <AccesUrgence ctx={ctx} organisationId={org.id} acces={acces} gestion suspendue={suspendue} />
      <GestionMembres ctx={ctx} organisationId={org.id} membres={membres} invitations={invitations} />
    </>
  );
}
