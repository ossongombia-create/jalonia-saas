// Configuration lue dans les variables d'environnement, validée au PREMIER usage (jamais à l'import :
// la compilation « next build » importe les modules sans disposer des secrets du serveur).
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL manquante"),
  AUTH_URL: z.preprocess((v) => v === "" ? undefined : v, z.string().url().optional()),
  // (DATABASE_URL_PROPRIETAIRE n'est PAS lue par l'application : seulement par scripts/migrer.ts et
  // scripts/creer-superadmin.ts, depuis un fichier d'environnement réservé au déploiement.)
  SESSION_INACTIVITE_MINUTES: z.coerce.number().int().min(5).max(24 * 60).default(120),
  SESSION_DUREE_HEURES: z.coerce.number().int().min(1).max(72).default(8),
  // Fuseau horaire d'affichage des dates (nom IANA, ex. Africa/Libreville, Europe/Paris).
  FUSEAU_HORAIRE: z.string().default("UTC").refine(fuseauValide, "FUSEAU_HORAIRE inconnu (ex. Africa/Libreville)"),
  // Clé (32 octets en base64) qui chiffre les secrets du second facteur et les codes de secours. Facultative pour
  // démarrer ; sans elle, personne ne peut activer de second facteur et les superadmins ne peuvent plus se connecter
  // à l'interface (le second facteur leur est obligatoire). Générer avec : openssl rand -base64 32
  CLE_SECOND_FACTEUR: z
    .string()
    .optional()
    .refine((v) => v === undefined || v.trim() === "" || Buffer.from(v.trim(), "base64").length === 32, "CLE_SECOND_FACTEUR doit faire 32 octets en base64"),
  SMTP_HOTE: z.preprocess((v) => v === "" ? undefined : v, z.string().trim().optional()),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_UTILISATEUR: z.preprocess((v) => v === "" ? undefined : v, z.string().trim().optional()),
  SMTP_MOT_DE_PASSE: z.preprocess((v) => v === "" ? undefined : v, z.string().optional()),
  SMTP_EXPEDITEUR: z.preprocess((v) => v === "" ? undefined : v, z.string().trim().email().optional()),
}).superRefine((c, ctx) => {
  const smtp = [c.SMTP_HOTE, c.SMTP_UTILISATEUR, c.SMTP_MOT_DE_PASSE, c.SMTP_EXPEDITEUR].filter(Boolean).length;
  if (smtp !== 0 && smtp !== 4) ctx.addIssue({ code: "custom", message: "SMTP_HOTE, SMTP_UTILISATEUR, SMTP_MOT_DE_PASSE et SMTP_EXPEDITEUR doivent être configurés ensemble" });
  if (smtp === 4 && !c.AUTH_URL) ctx.addIssue({ code: "custom", message: "AUTH_URL est requise pour envoyer des liens Jalonia par courriel" });
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

/** Clé du second facteur, ou null si elle n'est pas configurée. */
export function cleSecondFacteur(): Buffer | null {
  const v = config().CLE_SECOND_FACTEUR?.trim();
  return v ? Buffer.from(v, "base64") : null;
}
