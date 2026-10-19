// Configuration lue dans les variables d'environnement, validée au PREMIER usage (jamais à l'import :
// la compilation « next build » importe les modules sans disposer des secrets du serveur).
import { z } from "zod";

/** Message affiché quand le serveur refuse de démarrer faute de clé du second facteur valable. */
export const ERREUR_CLE_SECOND_FACTEUR =
  "ERREUR FATALE : La variable CLE_SECOND_FACTEUR est absente ou invalide. Les approbateurs ne pourront pas se connecter. " +
  "Générez une clé avec 'openssl rand -base64 32' et ajoutez-la dans /etc/jalonia/jalonia.env.";

/** Présente, d'au moins 32 caractères, et donnant exactement 32 octets une fois décodée du base64. */
export function cleSecondFacteurValide(valeur: string | undefined): boolean {
  const v = valeur?.trim() ?? "";
  return v.length >= 32 && /^[A-Za-z0-9+/]+={0,2}$/.test(v) && Buffer.from(v, "base64").length === 32;
}

/** Lève ERREUR_CLE_SECOND_FACTEUR si la clé est absente ou invalide (appelé au démarrage du serveur). */
export function exigerCleSecondFacteur(env: Readonly<Record<string, string | undefined>> = process.env): void {
  if (!cleSecondFacteurValide(env.CLE_SECOND_FACTEUR)) throw new Error(ERREUR_CLE_SECOND_FACTEUR);
}

const schema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL manquante"),
  AUTH_URL: z.preprocess((v) => v === "" ? undefined : v, z.string().url().optional()),
  // (DATABASE_URL_PROPRIETAIRE n'est PAS lue par l'application : seulement par scripts/migrer.ts et
  // scripts/creer-superadmin.ts, depuis un fichier d'environnement réservé au déploiement.)
  SESSION_INACTIVITE_MINUTES: z.coerce.number().int().min(5).max(24 * 60).default(120),
  SESSION_DUREE_HEURES: z.coerce.number().int().min(1).max(72).default(8),
  // Fuseau horaire d'affichage des dates (nom IANA, ex. Africa/Libreville, Europe/Paris).
  FUSEAU_HORAIRE: z.string().default("UTC").refine(fuseauValide, "FUSEAU_HORAIRE inconnu (ex. Africa/Libreville)"),
  // Clé (32 octets en base64) qui chiffre les secrets du second facteur et les codes de secours. OBLIGATOIRE pour le
  // serveur : le second facteur l'est pour les superadmins et les approbateurs (décision n° 4 du 19/10/2026), qui ne
  // pourraient plus se connecter sans elle ; il refuse donc de démarrer sans elle (src/instrumentation.ts). Les
  // tâches planifiées, qui ne s'en servent pas, démarrent sans elle. Générer avec : openssl rand -base64 32
  CLE_SECOND_FACTEUR: z
    .string()
    .optional()
    .refine((v) => v === undefined || v.trim() === "" || cleSecondFacteurValide(v), ERREUR_CLE_SECOND_FACTEUR),
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

/** Clé du second facteur, ou null si elle n'est pas configurée (le serveur ne démarre pas sans elle). */
export function cleSecondFacteur(): Buffer | null {
  const v = config().CLE_SECOND_FACTEUR?.trim();
  return v ? Buffer.from(v, "base64") : null;
}
