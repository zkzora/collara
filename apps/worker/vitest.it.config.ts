import { defineConfig } from "vitest/config";

// Live integration tests against the shared LocalNet sandbox and PostgreSQL. Opt-in: PROJECTION_IT=1
// (see test/projection.it.test.ts for the environment it reads).
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.it.test.ts"],
    testTimeout: 300_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
