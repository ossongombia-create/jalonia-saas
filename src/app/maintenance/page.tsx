import { redirect } from "next/navigation";
import { poolApplication } from "@/server/db/pools";
import { lireMaintenance, texteMaintenance } from "@/server/maintenance/service";
import { lireLangue } from "@/server/web/contexte";

export default async function PageMaintenance() {
  const [m, langue] = await Promise.all([lireMaintenance(poolApplication()), lireLangue()]);
  if (!m.actif) redirect("/");
  return (
    <main className="page-simple">
      <section className="carte">
        <p className="etiquette">Jalonia</p>
        <h1>{langue === "en" ? "Scheduled maintenance" : "Maintenance en cours"}</h1>
        <p role="status">{texteMaintenance(m, langue)}</p>
      </section>
    </main>
  );
}
