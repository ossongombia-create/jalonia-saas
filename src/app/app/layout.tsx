// Espace d'une organisation. La mise en page vérifie l'accès ; CHAQUE page le revérifie aussi.
import { Coque, type LienCoque } from "@/components/Coque";
import { aLeDroit } from "@/lib/rbac";
import { exigerOrganisation } from "@/server/web/contexte";

export default async function MiseEnPageOrganisation({ children }: { children: React.ReactNode }) {
  const ctx = await exigerOrganisation();
  const { t, organisation } = ctx;
  const liens: LienCoque[] = [{ href: "/app", libelle: t("nav.accueil"), exact: true }];
  if (aLeDroit(organisation.roles, "organisation.membres.gerer")) liens.push({ href: "/app/membres", libelle: t("nav.membres") });
  if (aLeDroit(organisation.roles, "organisation.journal.lire")) liens.push({ href: "/app/journal", libelle: t("nav.journal") });

  const secondaires: LienCoque[] = [];
  if (ctx.adhesions.filter((a) => a.statut === "active").length > 1) secondaires.push({ href: "/choisir-organisation", libelle: t("org_choix.changer") });
  if (ctx.utilisateur.estSuperadmin) secondaires.push({ href: "/plateforme", libelle: t("nav.plateforme") });

  return (
    <Coque ctx={ctx} espace={organisation.nom} liens={liens} liensSecondaires={secondaires}>
      {children}
    </Coque>
  );
}
