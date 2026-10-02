import AxeBuilder from "@axe-core/playwright";
import { expect as baseExpect, test, type Page } from "@playwright/test";

// Create Financing Case and the Overview figures in UI_MOCK (run against a UI_MOCK server, PLAYWRIGHT_BASE_URL).
// The new case's ref is allocated by the (mock) server: the tests never assume it. State-changing flows stay in one
// tab (the mock world lives in the tab) and navigate client-side after sign-in.

const MOCK_BANNER = "Synthetic demo data — UI mockup.";
const LEDGER_CONFIRMED = "Confirmed on the ledger.";
const ACTIVE_CASE = "This asset already has an active case workflow.";

test.setTimeout(180_000);
const expect = baseExpect.configure({ timeout: 20_000 });
const isMobile = (width: number | undefined) => (width ?? 1280) < 900;

async function signIn(page: Page, label: string) {
  await page.goto("/login");
  await expect(page.getByRole("note", { name: "Environment" })).toContainText(MOCK_BANNER);
  await page.getByLabel(label).check();
  await page.getByRole("button", { name: "Continue to workspace" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
}

/** The borrower's registered asset that no case holds: CL-001 holds ASSET-DEMO-001 in the main seed, CL-005 released its asset. */
async function freeAssetValue(page: Page): Promise<string> {
  const select = page.locator("main").getByLabel("Registered asset");
  await expect(select.locator("option")).not.toHaveCount(0);
  await expect(select.locator("option")).not.toHaveCount(1);
  const values = await select.locator("option").evaluateAll((options) => options.map((o) => (o as HTMLOptionElement).value).filter(Boolean));
  const free = values.find((value) => value !== "ASSET-DEMO-001");
  if (!free) throw new Error("no registered asset accepts a new case");
  await select.selectOption(free);
  // The server's allowed actions for that asset: the evidence package line, not the active-case refusal.
  await expect(select).toHaveAccessibleDescription(/Evidence package|No evidence package/);
  return free;
}

test("borrower creates a case from the queue and lands on the new case's next step", async ({ page }, testInfo) => {
  test.skip(isMobile(testInfo.project.use.viewport?.width), "state-changing flow runs on desktop");
  const main = page.locator("main");
  await signIn(page, "Plant manager — Borrower / Asset Owner");
  await page.getByRole("navigation", { name: "Workspace", exact: true }).getByRole("link", { name: /^Cases/ }).first().click();
  await expect(page).toHaveURL(/\/app\/cases$/);
  await main.getByRole("link", { name: "Create case" }).click();
  await expect(page).toHaveURL(/\/app\/cases\/new$/);
  await expect(page.getByRole("heading", { level: 1, name: "Create case" })).toBeVisible();

  // Accessible validation: errors are announced with their field.
  await main.getByRole("button", { name: "Save draft" }).click();
  await expect(main.getByLabel("Case name")).toHaveAttribute("aria-invalid", "true");
  await expect(main.getByLabel("Case name")).toHaveAccessibleDescription(/Enter a case name\./);
  await expect(main.getByLabel("Case name")).toBeFocused();

  // A held asset explains why it cannot start a case.
  await main.getByLabel("Registered asset").selectOption("ASSET-DEMO-001");
  await expect(main.getByLabel("Registered asset")).toHaveAccessibleDescription(new RegExp(ACTIVE_CASE));

  const asset = await freeAssetValue(page);
  expect(asset).not.toBe("ASSET-DEMO-001");
  await main.getByLabel("Case name").fill("Second CNC financing");
  await main.getByLabel("Selected lender").selectOption({ label: "Demo Lender A" });
  await main.getByLabel("Invited dealer (optional)").selectOption({ label: "Demo CNC Dealer" });
  await main.getByLabel("Requested principal (optional)").fill("1.005");
  await main.getByRole("button", { name: "Save draft" }).click();
  await expect(main.getByLabel("Requested principal (optional)")).toHaveAttribute("aria-invalid", "true");
  await main.getByLabel("Requested principal (optional)").fill("100,000");
  await main.getByRole("button", { name: "Save draft" }).click();

  await expect(page).toHaveURL(/\/app\/cases\/CL-\d{3}\/summary$/);
  const caseId = /CL-\d{3}/.exec(page.url())?.[0] ?? "";
  expect(caseId).not.toBe("CL-001");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(caseId);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Second CNC financing");
  // The next step is shown on the new case (share package / request verification / add evidence).
  await expect(page.getByText(/Next actor/)).toBeVisible();
  await expect(main.getByText("Permitted next action")).toBeVisible();
  await expect(page.locator("body")).not.toContainText(LEDGER_CONFIRMED);

  // The new case is in the borrower's queue.
  await page.getByRole("navigation", { name: "Workspace", exact: true }).getByRole("link", { name: /^Cases/ }).first().click();
  await expect(main.getByRole("link", { name: caseId })).toBeVisible();
});

test("the passport's Create case preselects the asset; Review sharing opens Sharing & Access", async ({ page }, testInfo) => {
  test.skip(isMobile(testInfo.project.use.viewport?.width), "state-changing flow runs on desktop");
  const main = page.locator("main");
  await signIn(page, "Plant manager — Borrower / Asset Owner");
  await page.goto("/app/cases/new");
  const asset = await freeAssetValue(page);
  await page.goto(`/app/assets/${asset}/overview`);
  await main.getByRole("link", { name: "Create case" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/cases/new\\?asset=${asset}$`));
  await expect(main.getByLabel("Registered asset")).toHaveValue(asset);
  await main.getByLabel("Case name").fill("Shared next");
  await main.getByLabel("Selected lender").selectOption({ label: "Demo Lender B" });
  await main.getByRole("button", { name: "Review sharing" }).click();
  await expect(page).toHaveURL(/\/app\/cases\/CL-\d{3}\/sharing$/);
});

test("lenders are not offered case creation", async ({ page }) => {
  await signIn(page, "Morgan Hale — Lender Approver");
  await page.goto("/app/cases");
  await expect(page.getByRole("heading", { level: 1, name: "Cases" })).toBeVisible();
  await expect(page.locator("main").getByRole("link", { name: "Create case" })).toHaveCount(0);
  await page.goto("/app/cases/new");
  await expect(page.locator("main")).toContainText("Creating a case needs the borrower mandate");
  await expect(page.locator("main").getByLabel("Case name")).toHaveCount(0);
});

test("Overview shows per-currency recorded figures with coverage, never a sum across currencies", async ({ page }) => {
  await signIn(page, "Morgan Hale — Lender Approver");
  const figures = page.getByRole("region", { name: "Recorded figures" });
  await expect(figures.getByRole("list", { name: "Recorded financing principal by currency" })).toContainText("180,000.00");
  await expect(figures.getByRole("list", { name: "Recorded collateral valuation by currency" })).toContainText("260,000.00");
  await expect(figures).toContainText("1 of 1 active pledge with a recorded principal.");
  await expect(figures).toContainText("No ledger connection · UI mockup");

  await signIn(page, "Plant manager — Borrower / Asset Owner");
  await expect(page.getByRole("note", { name: "Environment" })).toContainText("Viewing as Demo Manufacturer");
  await expect(figures).toContainText("Not available");
  await expect(figures).toContainText("No active pledges in your organization's scope.");
  await expect(figures).not.toContainText("Recorded collateral valuation");
});

test("Overview, Cases and Create case have no WCAG A/AA violations", async ({ page }) => {
  for (const persona of ["Plant manager — Borrower / Asset Owner", "Morgan Hale — Lender Approver"]) {
    await signIn(page, persona);
    for (const path of ["/app", "/app/cases", "/app/cases/new"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await page.waitForLoadState("networkidle");
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      expect(results.violations, `${persona} ${path}: ${results.violations.map((v) => `${v.id} (${v.nodes.length})`).join(", ")}`).toEqual([]);
    }
  }
});
