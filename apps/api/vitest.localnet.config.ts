// LocalNet integration tests (test/localnet/*.it.test.ts) against the shared Canton sandbox, PostgreSQL and
// object storage. Opt-in: nothing is collected unless LOCALNET_IT=1, so `vitest run` here is a no-op by
// default. `pnpm --filter @collara/api test:localnet` (PowerShell: $env:LOCALNET_IT = "1" first).
import { defineConfig } from "vitest/config";

const enabled = process.env.LOCALNET_IT === "1";
if (!enabled) console.info("LocalNet integration tests are opt-in: set LOCALNET_IT=1 to run test/localnet/*.it.test.ts.");

export default defineConfig({
  test: {
    environment: "node",
    include: enabled ? ["test/localnet/**/*.it.test.ts"] : [],
    passWithNoTests: true,
    // Each file bootstraps its own prefix and database; run files one at a time (one sandbox, ~2 GB RAM).
    fileParallelism: false,
    // Bootstrap + main seed take tens of seconds on the sandbox.
    testTimeout: 300_000,
    hookTimeout: 600_000,
  },
});
