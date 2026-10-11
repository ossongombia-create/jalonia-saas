import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// « server-only » refuse d'être importé hors de Next.js : en test, on le remplace par un module vide.
const alias = {
  "@": fileURLToPath(new URL("./src", import.meta.url)),
  "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
};

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: { name: "unit", include: ["tests/unit/**/*.test.ts"], environment: "node" },
      },
      {
        resolve: { alias },
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          // Une vraie base PostgreSQL, créée pour la séance de test puis supprimée.
          globalSetup: ["tests/integration/preparation-globale.ts"],
          // Les fichiers partagent la même base : on les exécute l'un après l'autre.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
