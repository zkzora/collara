import { defineConfig, devices } from "@playwright/test";

// Point at a running server with PLAYWRIGHT_BASE_URL; otherwise `next start` is launched
// (run `pnpm --filter @collara/web build` first).
const externalBaseURL = process.env.PLAYWRIGHT_BASE_URL;
const baseURL = externalBaseURL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, hasTouch: true } },
  ],
  webServer: externalBaseURL
    ? undefined
    : { command: "pnpm run start", url: baseURL, reuseExistingServer: !process.env.CI, timeout: 120_000 },
});
