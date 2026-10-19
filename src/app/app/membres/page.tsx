import { AccesUrgence } from "@/components/AccesUrgence";
import { GestionMembres } from "@/components/GestionMembres";
import { poolApplication } from "@/server/db/pools";
import { listerMembres } from "@/server/membres/service";
import { listerInvitations } from "@/server/invitations/service";
import { listerAccesUrgence } from "@/server/acces-urgence/service";
import { exigerOrganisation } from "@/server/web/contexte";
import { titrePage } from "@/server/web/metadonnees";

export const generateMetadata = titrePage("membres.titre");

export default async function PageMembres() {
  const ctx = await exigerOrganisation("organisation.membres.gerer");
  const [membres, invitations, acces] = await Promise.all([
    listerMembres(poolApplication(), ctx.organisation.id),
    listerInvitations(poolApplication(), ctx.organisation.id),
    listerAccesUrgence(poolApplication(), ctx.organisation.id),
  ]);

  return (
    <>
      <header className="entete">
        <div>
          <h1>{ctx.t("membres.titre")}</h1>
          <p>{ctx.organisation.nom}</p>
        </div>
      </header>
      <GestionMembres ctx={ctx} organisationId={ctx.organisation.id} membres={membres} invitations={invitations} />
      <AccesUrgence ctx={ctx} organisationId={ctx.organisation.id} acces={acces} gestion={false} />
    </>
  );
}
