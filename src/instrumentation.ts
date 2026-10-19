// Démarrage du serveur : Next.js appelle register() une fois, avant de servir la moindre requête. La configuration
// y est validée tout de suite (fail-fast) : une clé du second facteur absente ou invalide arrête le serveur avec un
// message clair, au lieu de bloquer les approbateurs à leur première connexion.
export async function register(): Promise<void> {
  // La compilation (« next build ») ne dispose pas des secrets du serveur : rien à vérifier alors.
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { verifierAuDemarrage } = await import("./server/demarrage");
  verifierAuDemarrage();
}
