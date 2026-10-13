import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Parcours navigateur (tests/e2e) : scripts Node en CommonJS, où require() est la forme normale d'import.
  { files: ["tests/e2e/**/*.cjs"], rules: { "@typescript-eslint/no-require-imports": "off" } },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Éditeur Qualigramme d'origine (JavaScript du navigateur, testé par ses propres tests : npm run test:editeur).
    "editeur/**",
    "public/editeur/**",
  ]),
]);

export default eslintConfig;
