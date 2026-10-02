import { defineConfig } from "vitest/config";

// Unit tests only. Integration tests against a live sandbox: vitest.it.config.ts (CANTON_IT=1).
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
