// Démarrage du serveur (fail-fast) : sans clé du second facteur valable, le serveur refuse de démarrer avec un message
// clair, au lieu de bloquer les approbateurs et les superadmins à leur connexion (décision n° 4 du 19/10/2026).
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleSecondFacteurValide, ERREUR_CLE_SECOND_FACTEUR, exigerCleSecondFacteur } from "../../src/server/config";

const MESSAGE =
  "ERREUR FATALE : La variable CLE_SECOND_FACTEUR est absente ou invalide. Les approbateurs ne pourront pas se connecter. " +
  "Générez une clé avec 'openssl rand -base64 32' et ajoutez-la dans /etc/jalonia/jalonia.env.";
const VALABLE = randomBytes(32).toString("base64");
const INVALIDES: Record<string, string | undefined> = {
  absente: undefined,
  vide: "",
  espaces: "   ",
  "trop courte": "trop-courte",
  "31 caractères": "A".repeat(31),
  "24 octets seulement": randomBytes(24).toString("base64"),
  "48 octets": randomBytes(48).toString("base64"),
  "pas du base64": "é".repeat(44),
};

describe("règle de la clé du second facteur", () => {
  it("le message est exactement celui attendu", () => {
    expect(ERREUR_CLE_SECOND_FACTEUR).toBe(MESSAGE);
  });

  it.each(Object.entries(INVALIDES))("refusée : %s", (_, valeur) => {
    expect(cleSecondFacteurValide(valeur)).toBe(false);
    expect(() => exigerCleSecondFacteur({ CLE_SECOND_FACTEUR: valeur })).toThrow(MESSAGE);
  });

  it("acceptée : 32 octets en base64 (openssl rand -base64 32), espaces autour tolérés", () => {
    expect(cleSecondFacteurValide(VALABLE)).toBe(true);
    expect(cleSecondFacteurValide(` ${VALABLE}\n`)).toBe(true);
    expect(() => exigerCleSecondFacteur({ CLE_SECOND_FACTEUR: VALABLE })).not.toThrow();
  });
});

describe("au démarrage du serveur", () => {
  const BASE = { DATABASE_URL: "postgresql://jalonia_app@127.0.0.1/jalonia", NEXT_RUNTIME: "nodejs" };
  let sortie: ReturnType<typeof vi.spyOn>;
  let journal: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules(); // config() garde la configuration en cache : on repart d'un module neuf à chaque test.
    sortie = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    journal = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  function environnement(env: Record<string, string | undefined>) {
    for (const [nom, valeur] of Object.entries({ ...BASE, NEXT_PHASE: undefined, ...env })) vi.stubEnv(nom, valeur);
  }

  it.each(Object.entries(INVALIDES))("clé %s : message d'erreur fatale, puis arrêt du processus (code 1)", async (_, valeur) => {
    environnement({ CLE_SECOND_FACTEUR: valeur });
    const { register } = await import("../../src/instrumentation");
    await register();
    expect(journal).toHaveBeenCalledWith(`[jalonia] ${MESSAGE}`);
    expect(sortie).toHaveBeenCalledWith(1);
  });

  it("clé valable : le serveur démarre", async () => {
    environnement({ CLE_SECOND_FACTEUR: VALABLE });
    const { register } = await import("../../src/instrumentation");
    await register();
    expect(sortie).not.toHaveBeenCalled();
  });

  it("config() refuse une clé présente mais invalide ; les tâches planifiées démarrent sans clé", async () => {
    environnement({ CLE_SECOND_FACTEUR: "trop-courte" });
    const { config } = await import("../../src/server/config");
    expect(() => config()).toThrow(MESSAGE);
    vi.resetModules();
    environnement({ CLE_SECOND_FACTEUR: undefined });
    expect((await import("../../src/server/config")).config().CLE_SECOND_FACTEUR).toBeUndefined();
  });

  it("rien n'est vérifié pendant la compilation (next build) ni hors de Node.js", async () => {
    environnement({ CLE_SECOND_FACTEUR: undefined, NEXT_PHASE: "phase-production-build" });
    await (await import("../../src/instrumentation")).register();
    environnement({ CLE_SECOND_FACTEUR: undefined, NEXT_RUNTIME: "edge" });
    await (await import("../../src/instrumentation")).register();
    expect(sortie).not.toHaveBeenCalled();
  });
});
