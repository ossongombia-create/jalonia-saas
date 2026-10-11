// Espace superadministrateur. La mise en page vérifie le rôle ; CHAQUE page le revérifie aussi.
import { Coque, liensPlateforme, type LienCoque } from "@/components/Coque";
import { exigerSuperadmin } from "@/server/web/contexte";

export default async function MiseEnPagePlateforme({ children }: { children: React.ReactNode }) {
  const ctx = await exigerSuperadmin();
  const secondaires: LienCoque[] = ctx.adhesions.length > 0 ? [{ href: "/choisir-organisation", libelle: ctx.t("nav.espace_org") }] : [];
  return (
    <Coque ctx={ctx} espace={ctx.t("nav.plateforme")} liens={liensPlateforme(ctx)} liensSecondaires={secondaires}>
      {children}
    </Coque>
  );
}
