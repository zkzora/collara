// Witness-level privacy test (test/localnet/privacy/*.privacy.test.ts) on the 5-participant sandbox
// (`node scripts/localnet/up.mjs --participants=5`). Opt-in: nothing is collected unless PRIVACY_IT=1.
// `pnpm --filter @collara/api test:privacy` (PowerShell: $env:PRIVACY_IT = "1" first). See docs/privacy-verification.md.
import { defineConfig } from "vitest/config";

const enabled = process.env.PRIVACY_IT === "1";
if (!enabled) console.info("The ledger privacy test is opt-in: set PRIVACY_IT=1 (5-participant sandbox) to run test/localnet/privacy/*.privacy.test.ts.");

export default defineConfig({
  test: {
    environment: "node",
    include: enabled ? ["test/localnet/privacy/**/*.privacy.test.ts"] : [],
    passWithNoTests: true,
    // The LocalNet harness is reused (it is gated on LOCALNET_IT).
    env: { LOCALNET_IT: "1" },
    fileParallelism: false,
    testTimeout: 900_000,
    hookTimeout: 900_000,
  },
});
