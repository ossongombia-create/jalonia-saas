// Espace d'une organisation. La mise en page vérifie l'accès ; CHAQUE page le revérifie aussi.
import { Coque, type LienCoque } from "@/components/Coque";
import { aLeDroit } from "@/lib/rbac";
import { poolApplication } from "@/server/db/pools";
import { compterNonLues } from "@/server/notifications/service";
import { exigerOrganisation } from "@/server/web/contexte";

export default async function MiseEnPageOrganisation({ children }: { children: React.ReactNode }) {
  const ctx = await exigerOrganisation();
  const { t, organisation } = ctx;
  const liens: LienCoque[] = [{ href: "/app", libelle: t("nav.accueil"), exact: true }];
  if (aLeDroit(organisation.roles, "documents.lire")) {
    liens.push({ href: "/app/documents", libelle: t("nav.documents") });
    const nonLues = await compterNonLues(poolApplication(), organisation, ctx.acteur.id);
    liens.push({ href: "/app/notifications", libelle: nonLues > 0 ? `${t("nav.notifications")} (${nonLues})` : t("nav.notifications") });
  }
  if (aLeDroit(organisation.roles, "organisation.membres.gerer")) liens.push({ href: "/app/membres", libelle: t("nav.membres") });
  if (aLeDroit(organisation.roles, "organisation.journal.lire")) liens.push({ href: "/app/journal", libelle: t("nav.journal") });
  if (aLeDroit(organisation.roles, "organisation.parametres")) liens.push({ href: "/app/parametres", libelle: t("nav.parametres") });

  const secondaires: LienCoque[] = [];
  if (ctx.adhesions.filter((a) => a.statut === "active").length > 1) secondaires.push({ href: "/choisir-organisation", libelle: t("org_choix.changer") });
  if (ctx.utilisateur.estSuperadmin) secondaires.push({ href: "/plateforme", libelle: t("nav.plateforme") });

  return (
    <Coque ctx={ctx} espace={organisation.nom} liens={liens} liensSecondaires={secondaires}>
      {children}
    </Coque>
  );
}
