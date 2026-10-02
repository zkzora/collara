import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("home page renders without WCAG A/AA violations", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.ok()).toBe(true);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");

  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations).toEqual([]);
});

test("workspace responses are never shared-cached", async ({ request }) => {
  const response = await request.get("/app");
  expect(response.headers()["cache-control"]).toContain("private");
  expect(response.headers()["cache-control"]).toContain("no-store");
});
