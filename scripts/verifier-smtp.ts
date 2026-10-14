// Vérifie DNS, connexion TLS et authentification SMTP sans envoyer de message.
import { courrielConfigure, verifierCourrielSmtp } from "../src/server/notifications/courriel";

async function principal(): Promise<void> {
  if (!courrielConfigure()) throw new Error("Les paramètres SMTP ne sont pas configurés.");
  await verifierCourrielSmtp();
  console.log("✔ Serveur SMTP joignable et authentification acceptée; aucun e-mail n'a été envoyé.");
}

principal().catch((erreur: unknown) => {
  console.error(`✘ Vérification SMTP échouée : ${erreur instanceof Error ? erreur.message : "erreur inconnue"}`);
  process.exitCode = 1;
});
