import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Cold starts on Windows (Fastify + swagger, PGlite WASM) can exceed the 5 s default.
    testTimeout: 30_000,
  },
});
