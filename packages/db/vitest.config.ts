import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // PGlite (WASM) cold starts on Windows can exceed the 5 s default.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
