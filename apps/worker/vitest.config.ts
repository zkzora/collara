import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Cold starts on Windows (Fastify + swagger, PGlite WASM) can exceed the 5 s default, and the runtime tests
    // take ~10 s alone; under `pnpm -r test` they share the CPU with the other packages' suites.
    testTimeout: 90_000,
    hookTimeout: 90_000,
  },
});
