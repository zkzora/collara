// DevNet integration tests (test/devnet/*.it.test.ts) against the HackCanton shared DevNet participant. OPT-IN ONLY:
// nothing is collected unless DEVNET_IT=1, and the files skip themselves without a stored credential. Never part of
// `pnpm test` or CI. Run by the owner after login, import-bindings and bootstrap (docs/devnet/owner-checklist.md):
//   PowerShell: $env:DEVNET_IT = "1"; pnpm --filter @collara/api test:devnet; Remove-Item Env:DEVNET_IT
//   Git Bash:   DEVNET_IT=1 pnpm --filter @collara/api test:devnet
// The DEVNET env comes from <repo>/.env.devnet (COLLARA_DEVNET_ENV_FILE overrides), never from .env.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const enabled = process.env.DEVNET_IT === "1";
const envFile = process.env.COLLARA_DEVNET_ENV_FILE ?? fileURLToPath(new URL("../../.env.devnet", import.meta.url));
if (enabled && existsSync(envFile)) {
  process.loadEnvFile(envFile);
  process.env.COLLARA_MODE = "DEVNET";
}
if (!enabled) console.info("DevNet integration tests are opt-in: set DEVNET_IT=1 (and the DEVNET env) to run test/devnet/*.it.test.ts.");

export default defineConfig({
  test: {
    environment: "node",
    include: enabled ? ["test/devnet/**/*.it.test.ts"] : [],
    passWithNoTests: true,
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
