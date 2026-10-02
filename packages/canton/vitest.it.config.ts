import { defineConfig } from "vitest/config";

// Integration tests against a live Canton sandbox. They are skipped unless CANTON_IT=1.
// The global setup reuses a ready ledger at CANTON_JSON_API_URL (default 127.0.0.1:7575) or
// starts one with scripts/localnet/up.mjs and stops it afterwards (CANTON_IT_KEEP=1 keeps it).
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/integration/**/*.it.test.ts"],
    globalSetup: ["test/integration/global-setup.ts"],
    testTimeout: 120_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
