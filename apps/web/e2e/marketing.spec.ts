import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Public site: navigation, pre-demo gating, /pilot validation, keyboard access, responsive overflow
// and axe. Runs in both Playwright projects (desktop and the 390x844 mobile viewport).

const SITE_BREAKPOINT = 920;
const isNarrow = (page: Page) => (page.viewportSize()?.width ?? 1280) < SITE_BREAKPOINT;

/** Presses Tab until `target` has focus; fails if it is not reached (i.e. not keyboard reachable). */
async function tabTo(page: Page, target: ReturnType<Page["locator"]>, maxPresses = 80) {
  for (let i = 0; i < maxPresses; i += 1) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((el) => el === document.activeElement)) return;
  }
  throw new Error(`Element not reached with ${maxPresses} Tab presses`);
}

test.describe("landing", () => {
  test("has the approved title and the pre-demo CTAs", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle("Collara — Private Equipment Collateral Workflows");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Equipment evidence and pledge workflows, coordinated privately.",
    );
    // PUBLIC_DEMO_STATUS is off by default: no dead demo button or footer Demo link (CR-03/CR-04).
    await expect(page.locator('a[href="/demo"]')).toHaveCount(0);
    const hero = page.locator("section", { has: page.getByRole("heading", { level: 1 }) });
    await expect(hero.getByRole("link", { name: "Request a pilot" })).toHaveAttribute("href", "/pilot");
    await expect(hero.getByRole("link", { name: "Read the workflow" })).toHaveAttribute("href", "/#workflow");
    await expect(page.getByRole("figure", { name: "Illustrative demo case" })).toContainText("USD 100,000.00");
    await expect(page.getByText("Demo data — LocalNet")).toHaveCount(0);
    const footer = page.getByRole("contentinfo");
    await expect(footer.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
    await expect(footer.getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");
  });

  test("navigation anchors scroll to their sections", async ({ page }) => {
    await page.goto("/");
    const targets = [
      ["Workflow", "workflow"],
      ["For Lenders", "for-lenders"],
      ["Why Canton", "why-canton"],
      ["Product", "product"],
    ] as const;
    for (const [label, id] of targets) {
      if (isNarrow(page)) {
        const menu = page.getByRole("button", { name: "Menu" });
        await menu.click();
        await expect(menu).toHaveAttribute("aria-expanded", "true");
        await page.getByRole("navigation", { name: "Mobile" }).getByRole("link", { name: label, exact: true }).click();
        await expect(menu).toHaveAttribute("aria-expanded", "false");
      } else {
        await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: label, exact: true }).click();
      }
      await expect(page).toHaveURL(new RegExp(`#${id}$`));
      await expect(page.locator(`#${id}`)).toBeInViewport();
    }
  });

  test("skip link moves focus to the main content", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to content" });
    await expect(skip).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("main#main")).toBeFocused();
  });

  test("FAQ items are reachable and operable with the keyboard", async ({ page }) => {
    await page.goto("/");
    const first = page.locator("details", { hasText: "Is Collara a lender?" });
    await expect(first).toHaveAttribute("open", "");
    const item = page.locator("details", { hasText: "What equipment does Collara support first?" });
    await expect(item).not.toHaveAttribute("open", "");
    const summary = item.locator("summary");
    await tabTo(page, summary);
    await page.keyboard.press("Enter");
    await expect(item).toHaveAttribute("open", "");
    await expect(item.getByText("The initial scope is used CNC machinery.")).toBeVisible();
    await page.keyboard.press("Space");
    await expect(item).not.toHaveAttribute("open", "");
  });

  test("mobile menu is a keyboard-operable disclosure", async ({ page }) => {
    test.skip(!isNarrow(page), "The menu button exists only below 920px");
    await page.goto("/");
    const menu = page.getByRole("button", { name: "Menu" });
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await tabTo(page, menu, 10);
    await page.keyboard.press("Enter");
    await expect(menu).toHaveAttribute("aria-expanded", "true");
    const panel = page.getByRole("navigation", { name: "Mobile" });
    await expect(panel).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(panel.getByRole("link", { name: "Product", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await expect(menu).toBeFocused();
    await expect(panel).toBeHidden();
  });
});

test.describe("docs", () => {
  test("keeps the section anchors and marks the current page", async ({ page }) => {
    await page.goto("/docs");
    await expect(page).toHaveTitle("Collara — Docs (pre-build)");
    for (const id of ["overview", "workflow", "roles", "demo", "governance", "setup"]) {
      await expect(page.locator(`section#${id}`)).toHaveCount(1);
    }
    if (!isNarrow(page)) {
      await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Docs" })).toHaveAttribute(
        "aria-current",
        "page",
      );
    }
    await page.getByRole("navigation", { name: "Documentation sections" }).getByRole("link", { name: "Roles & permissions" }).click();
    await expect(page).toHaveURL(/#roles$/);
    await expect(page.locator("#roles-title")).toBeInViewport();
    // Matrix from the domain policy, with text alternatives for the glyphs.
    const matrix = page.getByRole("region", { name: "Permission matrix" });
    await expect(matrix.getByRole("columnheader", { name: "Lender B (unrelated)" })).toBeVisible();
    await expect(matrix.getByText("No access").first()).toBeAttached();
    // #setup lists no commands.
    await expect(page.locator("section#setup pre")).toHaveCount(0);
  });
});

test.describe("request a pilot", () => {
  test("reports accessible validation errors", async ({ page }) => {
    await page.goto("/pilot");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Tell us about your equipment-finance workflow.");
    await page.getByRole("button", { name: "Request a conversation" }).click();

    await expect(page.getByRole("alert").filter({ hasText: "Some fields need attention." })).toBeVisible();
    const fullName = page.getByLabel("Full name");
    await expect(fullName).toBeFocused();
    await expect(fullName).toHaveAttribute("aria-invalid", "true");
    await expect(fullName).toHaveAccessibleDescription("Enter your full name.");
    await expect(page.getByLabel("Company type")).toHaveAccessibleDescription("Choose a company type.");
    await expect(page.getByLabel("Consent to be contacted")).toHaveAttribute("aria-invalid", "true");
    // Hint stays part of the description alongside the error.
    await expect(page.getByLabel("Current workflow challenge")).toHaveAccessibleDescription(
      /Do not include borrower information.*Describe your current workflow challenge\./,
    );
    // The optional field is not flagged.
    await expect(page.getByLabel("Current systems")).not.toHaveAttribute("aria-invalid", "true");

    await fullName.fill("Synthetic Tester");
    await page.getByLabel("Work email").fill("not-an-email");
    await page.getByRole("button", { name: "Request a conversation" }).click();
    await expect(fullName).not.toHaveAttribute("aria-invalid", "true");
    await expect(page.getByLabel("Work email")).toHaveAccessibleDescription("Enter a valid work email address.");
  });

  test("never shows the real success copy for a simulated submission", async ({ page }) => {
    await page.goto("/pilot");
    const mock = await page.getByText("This form is not connected to the API in the UI mockup.").isVisible();
    test.skip(!mock, "The simulated outcome only exists in UI_MOCK");

    await page.getByLabel("Full name").fill("Synthetic Tester");
    await page.getByLabel("Work email").fill("tester@example.test");
    await page.getByLabel("Company", { exact: true }).fill("Demo Lender A");
    await page.getByLabel("Role").fill("Credit analyst");
    await page.getByLabel("Company type").selectOption("LENDER");
    await page.getByLabel("Country").fill("United States");
    await page.getByLabel("Equipment category").fill("Used CNC machinery");
    await page.getByLabel("Approximate cases per month").selectOption("UNKNOWN");
    await page.getByLabel("Current workflow challenge").fill("Synthetic test entry.");
    await page.getByLabel("Consent to be contacted").check();
    await page.getByRole("button", { name: "Request a conversation" }).click();

    const status = page.getByRole("status").filter({ hasText: "simulated in the UI mockup" });
    await expect(status).toBeVisible();
    await expect(status).toContainText("Synthetic demo data — UI mockup.");
    await expect(page.getByText("Your request has been received.")).toHaveCount(0);
  });
});

test.describe("responsive and accessibility checks", () => {
  for (const path of ["/", "/docs", "/pilot", "/privacy", "/terms", "/demo"]) {
    test(`${path} has no horizontal scroll at 390px`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(path);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }

  for (const path of ["/", "/docs", "/pilot"]) {
    test(`${path} has no serious or critical axe violations`, async ({ page }) => {
      await page.goto(path);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      const blocking = results.violations
        .filter((v) => v.impact === "serious" || v.impact === "critical")
        .map((v) => ({ id: v.id, impact: v.impact, targets: v.nodes.slice(0, 5).map((n) => n.target.join(" ")) }));
      expect(blocking).toEqual([]);
    });
  }
});
