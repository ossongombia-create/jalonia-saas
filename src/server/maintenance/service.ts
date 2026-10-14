// Mode maintenance global à la plateforme.
import "server-only";
import type { Pool } from "pg";
import type { Langue } from "@/lib/i18n";
import { enTransaction } from "../db/transactions";
import { journaliserPlateforme } from "../audit/journal";
import { traceActeur, type Acteur } from "../acteur";

export interface Maintenance {
  actif: boolean;
  messageFr: string;
  messageEn: string;
  modifieLe: Date;
}

export async function lireMaintenance(pool: Pool): Promise<Maintenance> {
  return enTransaction(pool, async (client) => {
    const r = await client.query<{ actif: boolean; message_fr: string; message_en: string; modifie_le: Date }>(
      "SELECT actif, message_fr, message_en, modifie_le FROM platform.maintenance WHERE singleton",
    );
    const ligne = r.rows[0];
    if (!ligne) throw new Error("Configuration de maintenance absente.");
    return { actif: ligne.actif, messageFr: ligne.message_fr, messageEn: ligne.message_en, modifieLe: ligne.modifie_le };
  });
}

export async function changerMaintenance(
  pool: Pool,
  entree: { actif: boolean; messageFr: string; messageEn: string },
  acteur: Acteur,
): Promise<void> {
  await enTransaction(pool, async (client) => {
    const avant = await client.query<{ actif: boolean }>("SELECT actif FROM platform.maintenance WHERE singleton FOR UPDATE");
    if (!avant.rowCount) throw new Error("Configuration de maintenance absente.");
    await client.query(
      `UPDATE platform.maintenance SET actif = $1, message_fr = $2, message_en = $3, modifie_le = now(), modifie_par = $4
        WHERE singleton`,
      [entree.actif, entree.messageFr.trim(), entree.messageEn.trim(), acteur.id],
    );
    await journaliserPlateforme(client, {
      action: "MAINTENANCE_MODIFIEE", ...traceActeur(acteur), cibleType: "plateforme", cibleId: "maintenance",
      details: { actifAvant: avant.rows[0]!.actif, actifApres: entree.actif },
    });
  });
}

export function texteMaintenance(m: Maintenance, langue: Langue): string {
  return langue === "en" ? m.messageEn : m.messageFr;
}
