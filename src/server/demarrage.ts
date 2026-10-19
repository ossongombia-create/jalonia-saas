// Vérifications au démarrage du serveur (appelées par src/instrumentation.ts, environnement Node.js seulement).
// Next.js se contente de journaliser une erreur levée par register() et continue à servir des pages en erreur :
// on arrête donc le processus nous-mêmes (code 1), pour que systemd marque le service en échec.
import { config, exigerCleSecondFacteur } from "./config";

export function verifierAuDemarrage(): void {
  try {
    exigerCleSecondFacteur();
    config();
  } catch (erreur) {
    console.error(`[jalonia] ${erreur instanceof Error ? erreur.message : String(erreur)}`);
    process.exit(1);
  }
}

