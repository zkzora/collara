// ESLint 9 flat config for the whole workspace (ADR-0001 §3: ESLint 9.39.5, because
// eslint-config-next's bundled plugins break on ESLint 10). Run `pnpm lint` at the root.
import js from "@eslint/js";
import nextVitals from "eslint-config-next/core-web-vitals";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

const WEB_FILES = ["apps/web/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"];
// Code that ends up in the browser bundle (the web app and the packages it transpiles).
const BROWSER_FILES = [
  ...WEB_FILES,
  "packages/domain/**/*.{ts,tsx,mts}",
  "packages/api-client/**/*.{ts,tsx,mts}",
];

const SERVER_ONLY_MESSAGE =
  "Server-only dependency. The web app talks to the API over /api; credentials, ledger and storage access stay in apps/api and apps/worker.";

// eslint-config-next assumes it runs from the Next app root; scope its configs to apps/web
// and drop its root-relative ignore block (replaced by the global ignores below).
const nextForWeb = nextVitals
  .filter((config) => !(config.ignores && Object.keys(config).length === 1))
  .map((config) => ({ ...config, files: WEB_FILES }));

export default defineConfig([
  globalIgnores([
    "Collara Website/**",
    ".vendor/**",
    ".spike/**",
    ".local/**",
    "docs/_research/**",
    "**/node_modules/**",
    "**/.next*/**",
    "**/dist/**",
    "**/build/**",
    "**/out/**",
    "**/coverage/**",
    "**/playwright-report/**",
    "**/test-results/**",
    "**/blob-report/**",
    "**/next-env.d.ts",
    "**/generated/**",
    "**/*.generated.*",
    "daml/**",
  ]),

  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },

  ...nextForWeb,
  {
    files: WEB_FILES,
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    // React is not installed at the root, so "detect" cannot resolve it; keep in step with the catalog.
    settings: { next: { rootDir: "apps/web/" }, react: { version: "19.3" } },
    // App Router only; this rule inspects a pages/ directory and misfires when linting from apps/web.
    rules: { "@next/next/no-html-link-for-pages": "off" },
  },

  {
    files: BROWSER_FILES,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: ["@collara/db", "@collara/canton", "pg", "openid-client", "jose"].map((name) => ({
            name,
            message: SERVER_ONLY_MESSAGE,
          })),
          patterns: [
            { group: ["@collara/db/*", "@collara/canton/*", "pg/*", "@aws-sdk/*"], message: SERVER_ONLY_MESSAGE },
          ],
        },
      ],
    },
  },
]);
