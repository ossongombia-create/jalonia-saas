// Sonde de santé (surveillance, script de déploiement) : l'application répond et la base est joignable.
// Ne renvoie aucune information sensible.
import { connection } from "next/server";
import { enTransaction } from "@/server/db/transactions";
import { poolApplication } from "@/server/db/pools";

export async function GET() {
  await connection(); // toujours exécutée à la demande (jamais calculée à la compilation)
  try {
    await enTransaction(poolApplication(), (client) => client.query("SELECT 1"));
    return Response.json({ etat: "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ etat: "base_indisponible" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
