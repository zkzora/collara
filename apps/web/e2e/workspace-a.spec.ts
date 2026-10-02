import AxeBuilder from "@axe-core/playwright";
import { expect as baseExpect, test, type Page } from "@playwright/test";

// Workspace Part A in UI_MOCK (COLLARA_MODE=UI_MOCK): login → overview → queue → CL-001, scoped
// views per persona, keyboard paths and the 390×844 drawer. Each test gets a fresh mock world.

const MOCK_BANNER = "Synthetic demo data — UI mockup.";
const UNAVAILABLE = "This record is unavailable to your account.";
const LEDGER_CONFIRMED = "Confirmed on the ledger.";
const CASE_TABS = ["Summary", "Evidence", "Verification", "Sharing & Access", "Review", "Proposal", "Pledge", "Activity"];

test.setTimeout(120_000);
// The dev server compiles routes on first hit; give assertions room under parallel load.
const expect = baseExpect.configure({ timeout: 20_000 });

async function signInAs(page: Page, persona: string) {
  await page.goto("/login");
  await expect(page.getByRole("note", { name: "Environment" })).toContainText(MOCK_BANNER);
  await expect(page.getByRole("heading", { level: 1, name: "Sign in to your Collara workspace." })).toBeVisible();
  await page.getByLabel(persona).check();
  await page.getByRole("button", { name: "Continue to workspace" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
}

async function expectNoLedgerClaim(page: Page) {
  await expect(page.locator("body")).not.toContainText(LEDGER_CONFIRMED);
}

test("lender approver walks from login to every CL-001 tab", async ({ page }) => {
  await signInAs(page, "Morgan Hale — Lender Approver");
  await expect(page.getByRole("note", { name: "Environment" })).toContainText("Viewing as Demo Lender A · Lender Approver");
  await expect(page.getByRole("heading", { name: "Needs your action" })).toBeVisible();
  await expect(page.getByText("Recorded financing principal")).toBeVisible();

  await page.getByRole("link", { name: /Cases awaiting review/ }).click();
  await expect(page).toHaveURL(/\/app\/cases\?view=ready-for-review$/);
  await expect(page.getByRole("navigation", { name: "Saved views" }).getByRole("link", { name: /Ready for review/ })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByRole("table", { name: "Cases · Ready for review" })).toBeVisible();

  await page.getByRole("link", { name: "CL-001" }).click();
  await expect(page).toHaveURL(/\/app\/cases\/CL-001\/summary$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("CL-001");
  await expect(page.getByText(/Next actor/)).toBeVisible();

  const tabs = page.getByRole("navigation", { name: "Case sections" });
  for (const label of CASE_TABS) {
    await tabs.getByRole("link", { name: label, exact: true }).click();
    await expect(tabs.getByRole("link", { name: label, exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("region", { name: label, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("region", { name: "Activity", exact: true })).toContainText("Package shared");
  await expectNoLedgerClaim(page);
});

test("records a simulated action without claiming ledger confirmation", async ({ page }) => {
  await signInAs(page, "Morgan Hale — Lender Approver");
  await page.goto("/app/cases/CL-001/review");
  await page.getByRole("button", { name: "Start review" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Start collateral review · CL-001" });
  await expect(dialog).toContainText("Demo Lender A · Lender Approver");
  await dialog.getByLabel("Valuation amount").fill("150,000.00");
  await dialog.getByLabel("Valuation source").fill("Verifier inspection report v2 · dealer invoice v1");
  await dialog.getByRole("button", { name: "Start review" }).click();
  await expect(dialog).toBeHidden();

  await expect(page.getByRole("status").filter({ hasText: "Recorded in the UI mockup." }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve eligibility" })).toBeVisible();
  await expectNoLedgerClaim(page);
});

test("Lender B (unrelated) gets the unavailable state for CL-001", async ({ page }) => {
  await signInAs(page, "Lender B approver — Lender Approver");
  await page.goto("/app/cases/CL-001/summary");
  await expect(page.locator("main").getByRole("alert")).toContainText(UNAVAILABLE);
  await expect(page.locator("main")).not.toContainText("Demo Manufacturer");

  await page.goto("/app/cases");
  await expect(page.getByText("0 of 0 accessible cases")).toBeVisible();
  await expect(page.getByRole("link", { name: "CL-001" })).toHaveCount(0);
});

test("verifier and dealer never see proposal terms", async ({ page }) => {
  await signInAs(page, "Inspector — Verifier");
  await page.goto("/app/cases/CL-001/proposal");
  await expect(page.locator("main").getByRole("alert")).toContainText(UNAVAILABLE);
  await expect(page.locator("main")).not.toContainText("100,000.00");

  await signInAs(page, "Sales desk — Dealer Contributor");
  await page.goto("/app/cases/CL-001/summary");
  const tabs = page.getByRole("navigation", { name: "Case sections" });
  await expect(tabs.getByRole("link", { name: "Summary", exact: true })).toBeVisible();
  await expect(tabs.getByRole("link", { name: "Proposal", exact: true })).toHaveCount(0);
  await page.goto("/app/cases/CL-001/proposal");
  await expect(page.getByText("Proposal is not available")).toBeVisible();
  await expect(page.locator("main")).not.toContainText("100,000.00");
});

test("keyboard: case tabs are links and dialogs trap and return focus", async ({ page }) => {
  await signInAs(page, "Morgan Hale — Lender Approver");
  await page.goto("/app/cases/CL-001/summary");
  const tabs = page.getByRole("navigation", { name: "Case sections" });
  await tabs.getByRole("link", { name: "Summary", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(tabs.getByRole("link", { name: "Evidence", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/app\/cases\/CL-001\/evidence$/);

  await page.goto("/app/cases/CL-001/sharing");
  const trigger = page.getByRole("button", { name: "Grant audit access" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("alertdialog", { name: "Grant audit access · CL-001" });
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 12; i += 1) {
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("workspace pages have no WCAG A/AA violations", async ({ page }) => {
  await signInAs(page, "Morgan Hale — Lender Approver");
  for (const path of ["/app", "/app/cases", "/app/cases/CL-001/summary", "/app/cases/CL-001/review"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.waitForLoadState("networkidle");
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(results.violations, `${path}: ${results.violations.map((v) => v.id).join(", ")}`).toEqual([]);
  }
});

test("390×844: the sidebar becomes a drawer and pages do not scroll sideways", async ({ page }, testInfo) => {
  test.skip((testInfo.project.use.viewport?.width ?? 1280) > 900, "mobile layout only");
  await signInAs(page, "Morgan Hale — Lender Approver");
  await expect(page.getByRole("complementary", { name: "Sidebar" })).toBeHidden();

  const menu = page.getByRole("button", { name: "Menu" });
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await menu.click();
  const drawer = page.getByRole("dialog", { name: "Workspace navigation" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByLabel("Demo persona (synthetic)")).toBeVisible();
  await drawer.getByRole("link", { name: /^Cases/ }).click();
  await expect(page).toHaveURL(/\/app\/cases$/);
  await expect(drawer).toBeHidden();

  for (const path of ["/app", "/app/cases", "/app/cases/CL-001/summary"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
  // Wide tables scroll inside their own region instead of the page.
  await page.goto("/app/cases");
  const region = page.getByRole("region", { name: "Cases · All" });
  expect(await region.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
});
