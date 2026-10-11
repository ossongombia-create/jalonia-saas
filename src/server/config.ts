// Configuration lue dans les variables d'environnement, validée au PREMIER usage (jamais à l'import :
// la compilation « next build » importe les modules sans disposer des secrets du serveur).
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL manquante"),
  DATABASE_URL_PROPRIETAIRE: z.string().min(1, "DATABASE_URL_PROPRIETAIRE manquante"),
  SESSION_INACTIVITE_MINUTES: z.coerce.number().int().min(5).max(24 * 60).default(120),
  SESSION_DUREE_HEURES: z.coerce.number().int().min(1).max(72).default(8),
  // Fuseau horaire d'affichage des dates (nom IANA, ex. Africa/Libreville, Europe/Paris).
  FUSEAU_HORAIRE: z.string().default("UTC").refine(fuseauValide, "FUSEAU_HORAIRE inconnu (ex. Africa/Libreville)"),
});

function fuseauValide(fuseau: string): boolean {
  try {
    new Intl.DateTimeFormat("fr", { timeZone: fuseau });
    return true;
  } catch {
    return false;
  }
}

export type Config = z.infer<typeof schema>;

let enCache: Config | undefined;

export function config(): Config {
  if (!enCache) {
    const lu = schema.safeParse(process.env);
    if (!lu.success) {
      const details = lu.error.issues.map((i) => `${i.path.join(".")} : ${i.message}`).join(" ; ");
      throw new Error(`Configuration invalide (${details}). Voir .env.example.`);
    }
    enCache = lu.data;
  }
  return enCache;
}

/** Nom du rôle PostgreSQL de l'application (créé à l'installation, voir deploy/preparer-base.sql). */
export const ROLE_APPLICATION = "jalonia_app";
