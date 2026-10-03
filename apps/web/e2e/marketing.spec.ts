import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
// The same evidence record the /docs page renders, so the test cannot go stale when the facts change.
import { EVIDENCE, passCount } from "../../../packages/domain/src/evidence";

// Public site: navigation, public demo gating, /demo, /pilot validation, keyboard access, responsive overflow
// and axe. Runs in both Playwright projects (desktop and the 390x844 mobile viewport).

const SITE_BREAKPOINT = 920;
const isNarrow = (page: Page) => (page.viewportSize()?.width ?? 1280) < SITE_BREAKPOINT;

// The public demo gate of the server under test (PUBLIC_DEMO_STATUS, synthesis §1.1): give this process the same
// value as the server; unset means `off`. Resolved like the server does (public-demo.ts): `ui_mock` counts only on a
// UI_MOCK server, `localnet` only on a LOCALNET one (E2E_MODE=LOCALNET).
const SERVER_MODE = process.env.E2E_MODE === "LOCALNET" ? "LOCALNET" : "UI_MOCK";
const RAW_DEMO_STATUS = (process.env.PUBLIC_DEMO_STATUS ?? "off").trim().toLowerCase();
const DEMO: "off" | "ui_mock" | "localnet" =
  RAW_DEMO_STATUS === "ui_mock" && SERVER_MODE === "UI_MOCK"
    ? "ui_mock"
    : RAW_DEMO_STATUS === "localnet" && SERVER_MODE === "LOCALNET"
      ? "localnet"
      : "off";

const UI_MOCK_DISCLOSURE =
  "The demo is a UI mockup with synthetic data. It is not connected to a ledger, and no funds are transferred.";
const LOCALNET_DISCLOSURE = "The demo uses synthetic data on LocalNet. No funds are transferred.";
const PRE_DEMO_DISCLOSURE = "Collara is currently in development. We are seeking equipment-finance design partners.";

/** Presses Tab until `target` has focus; fails if it is not reached (i.e. not keyboard reachable). */
async function tabTo(page: Page, target: ReturnType<Page["locator"]>, maxPresses = 80) {
  for (let i = 0; i < maxPresses; i += 1) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((el) => el === document.activeElement)) return;
  }
  throw new Error(`Element not reached with ${maxPresses} Tab presses`);
}

test.describe("landing", () => {
  test("has the approved title, preview and legal links", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle("Collara — Private Equipment Collateral Workflows");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Equipment evidence and pledge workflows, coordinated privately.",
    );
    await expect(page.getByRole("figure", { name: "Illustrative demo case" })).toContainText("USD 100,000.00");
    await expect(page.getByText("Demo data — LocalNet")).toHaveCount(0);
    const footer = page.getByRole("contentinfo");
    await expect(footer.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
    await expect(footer.getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");
  });

  test("keeps the pre-demo CTAs while the public demo gate is off", async ({ page }) => {
    test.skip(DEMO !== "off", `PUBLIC_DEMO_STATUS resolves to ${DEMO}`);
    await page.goto("/");
    // No dead demo button or footer Demo link (CR-03/CR-04).
    await expect(page.locator('a[href="/demo"]')).toHaveCount(0);
    const hero = page.locator("section", { has: page.getByRole("heading", { level: 1 }) });
    await expect(hero.getByRole("link", { name: "Request a pilot" })).toHaveAttribute("href", "/pilot");
    await expect(hero.getByRole("link", { name: "Read the workflow" })).toHaveAttribute("href", "/#workflow");
    await expect(hero).toContainText(PRE_DEMO_DISCLOSURE);
    await expect(page.getByText(UI_MOCK_DISCLOSURE)).toHaveCount(0);
  });

  test("promotes the UI mockup demo with its own disclosure, never as LocalNet", async ({ page }) => {
    test.skip(DEMO !== "ui_mock", "PUBLIC_DEMO_STATUS=ui_mock on a UI_MOCK server only");
    await page.goto("/");
    const hero = page.locator("section", { has: page.getByRole("heading", { level: 1 }) });
    await expect(hero.getByRole("link", { name: "Explore the demo" })).toHaveAttribute("href", "/demo");
    await expect(hero.getByRole("link", { name: "Request a pilot" })).toHaveAttribute("href", "/pilot");
    await expect(hero).toContainText(UI_MOCK_DISCLOSURE);
    await expect(hero).not.toContainText(PRE_DEMO_DISCLOSURE);

    const finalCta = page.locator("section", { has: page.getByRole("heading", { name: "Make the next step in the case clear." }) });
    await expect(finalCta.getByRole("link", { name: "Explore the demo" })).toHaveAttribute("href", "/demo");
    await expect(finalCta).toContainText(UI_MOCK_DISCLOSURE);

    const footer = page.getByRole("contentinfo");
    const demoItem = footer.getByRole("listitem").filter({ has: page.getByRole("link", { name: "Demo", exact: true }) });
    await expect(demoItem.getByRole("link", { name: "Demo", exact: true })).toHaveAttribute("href", "/demo");
    await expect(demoItem).toContainText("UI mockup");

    // Nothing on the page ties the promoted mockup to LocalNet or a ledger confirmation.
    await expect(page.getByText(LOCALNET_DISCLOSURE)).toHaveCount(0);
    const money = page.locator("details", { hasText: "Does the demo move money?" });
    await expect(money).not.toContainText("on LocalNet");
    await expect(money).toContainText("Cash settlement and MainNet wallet payments are outside the initial scope.");
    await expect(page.getByText("Synthetic demo data — Canton LocalNet.")).toHaveCount(0);
    await expect(page.getByText("Confirmed on the ledger.")).toHaveCount(0);
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

test.describe("demo page", () => {
  test("shows the pre-build state while the gate is off", async ({ page }) => {
    test.skip(DEMO !== "off", `PUBLIC_DEMO_STATUS resolves to ${DEMO}`);
    await page.goto("/demo");
    const main = page.locator("main");
    await expect(main.getByText("LocalNet demo planned")).toBeVisible();
    await expect(main.getByRole("link", { name: "Request a pilot" })).toHaveAttribute("href", "/pilot");
    await expect(main.getByText("Synthetic UI mockup")).toHaveCount(0);
  });

  test("ui_mock: labels the mockup, leads to /login and states where changes live", async ({ page }) => {
    test.skip(DEMO !== "ui_mock", "PUBLIC_DEMO_STATUS=ui_mock on a UI_MOCK server only");
    await page.goto("/demo");
    const main = page.locator("main");
    await expect(main.getByText("Synthetic UI mockup", { exact: true })).toBeVisible();
    await expect(main.getByText("Synthetic demo data — UI mockup.")).toBeVisible();
    await expect(main).toContainText(UI_MOCK_DISCLOSURE);
    await expect(main).not.toContainText("LocalNet demo planned");
    await expect(main).not.toContainText(LOCALNET_DISCLOSURE);
    await expect(main).not.toContainText("Synthetic demo data — Canton LocalNet.");
    // Scenario facts and the persona order of docs/demo.md §3.
    await expect(main).toContainText("ASSET-DEMO-001");
    await expect(main).toContainText("USD 100,000.00");
    await expect(main).toContainText("USD 150,000.00");
    const steps = main.getByRole("list").filter({ hasText: "Dana Reyes" }).getByRole("listitem");
    await expect(steps).toHaveCount(8);
    await expect(steps.first()).toContainText("Dana Reyes · Lender Analyst");
    await expect(steps.nth(1)).toContainText("Morgan Hale · Lender Approver");
    await expect(steps.nth(2)).toContainText("Plant manager · Borrower");
    await expect(steps.last()).toContainText("Audit lead · Auditor");
    await expect(main.getByRole("note", { name: "Where your changes live" })).toContainText(
      "Reloading the page, or opening the workspace in another tab, starts again from the seeded CL-001 data",
    );

    await main.getByRole("link", { name: "Start the demo" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("button", { name: "Continue to workspace" })).toBeVisible();
  });

  test("UI_MOCK: workspace changes reset on reload; the persona is kept for the tab", async ({ page }) => {
    // Checks the statement /demo makes in ui_mock (demo-content.tsx UI_MOCK_STATE_NOTICE) against the real client.
    test.skip(SERVER_MODE !== "UI_MOCK", "UI_MOCK only");
    test.skip(isNarrow(page), "state-changing flow runs on desktop");
    await page.goto("/login");
    await page.getByLabel("Morgan Hale — Lender Approver").check();
    await page.getByRole("button", { name: "Continue to workspace" }).click();
    await expect(page).toHaveURL(/\/app$/);
    await page.goto("/app/cases/CL-001/review");
    await page.getByRole("button", { name: "Start review" }).click();
    const dialog = page.getByRole("alertdialog", { name: "Start collateral review · CL-001" });
    await dialog.getByLabel("Valuation amount").fill("150,000.00");
    await dialog.getByLabel("Valuation source").fill("Verifier inspection report v2 · dealer invoice v1");
    await dialog.getByRole("button", { name: "Start review" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("button", { name: "Approve eligibility" })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("note", { name: "Environment" })).toContainText("Viewing as Demo Lender A · Lender Approver");
    await expect(page.getByRole("button", { name: "Start review" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve eligibility" })).toHaveCount(0);
  });
});

test.describe("docs", () => {
  test("keeps the section anchors and marks the current page", async ({ page }) => {
    await page.goto("/docs");
    await expect(page).toHaveTitle("Collara — Docs");
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

  test("states the verified scope, not the pre-build status", async ({ page }) => {
    await page.goto("/docs");
    // Capability status comes from the domain config; items verified locally are no longer pre-build.
    await expect(page.getByText("Pre-build", { exact: true })).toHaveCount(0);
    await expect(page.getByText("None at this time")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Project status: local demo build" })).toBeVisible();
    const overview = page.locator("section#overview");
    await expect(overview).toContainText("Canton 3.5.19 sandbox with one participant");
    await expect(overview).toContainText("not Splice LocalNet");
    await expect(overview.getByRole("heading", { name: "Not verified" })).toBeVisible();
    // Status facts from the evidence record (packages/domain/src/evidence.ts), not stale literals.
    const facts = [
      `${EVIDENCE.unitTests.total} unit tests`,
      `run ${EVIDENCE.ci.runId}`,
      passCount(EVIDENCE.localnetIntegration),
      passCount(EVIDENCE.cleanStartBrowser),
      `${passCount(EVIDENCE.privacy.checks)} checks`,
      `${passCount(EVIDENCE.tierB.scriptedChecks)} checks`,
    ];
    for (const fact of facts) {
      await expect(overview).toContainText(fact);
    }
    await expect(overview).toContainText("one machine under one operator");
    await expect(overview).toContainText("Deployed: the web app in UI mockup mode");
    for (const stale of ["285 unit tests", "has not yet run green", "Witness-level privacy on three participants", "Nothing is deployed, and"]) {
      await expect(page.locator("main")).not.toContainText(stale);
    }
    // The docs page is shown in every mode; it never carries the ledger confirmation copy.
    await expect(page.getByText("Confirmed on the ledger.")).toHaveCount(0);

    const capabilities = page.getByRole("region", { name: "Capability status" });
    await expect(capabilities.getByRole("row", { name: /Decentralization Manager integration/ })).toContainText("Planned");
    await expect(capabilities.getByRole("row", { name: /LocalNet demo with access-denial/ })).toContainText("Implemented");

    // Governance: Tier A only, with the suspension policy stated precisely.
    const governance = page.locator("section#governance");
    await expect(governance).toContainText("Tier B integration planned");
    await expect(governance).not.toContainText("Tier B planned");
    await expect(governance).toContainText("REQUIRE_ACTIVE_VERIFIER");
    await expect(governance).not.toContainText("attestations already issued remain valid");

    // Setup points to the repository documents; UI mockup mode stays labelled as a simulation.
    const setup = page.locator("section#setup");
    for (const path of ["docs/setup.md", "docs/api.md", "docs/verification.md", "docs/demo.md"]) {
      await expect(setup.getByText(path, { exact: true })).toBeVisible();
    }
    await expect(setup).toContainText("no ledger transaction is submitted");
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

  test("UI_MOCK: says the form is an example before it is filled in", async ({ page }) => {
    test.skip(SERVER_MODE !== "UI_MOCK", "UI_MOCK only");
    await page.goto("/pilot");
    const notice = page.getByRole("note", { name: "Example form" });
    await expect(notice).toContainText("This form is an example on this deployment.");
    await expect(notice).toContainText("Nothing you enter here is sent or stored");
    // Above the form in reading order, and the approved disclaimer stays.
    const form = page.getByRole("form", { name: "Request a pilot" });
    const noticeFirst = await notice.evaluate(
      (node, formNode) => Boolean(formNode && node.compareDocumentPosition(formNode) & Node.DOCUMENT_POSITION_FOLLOWING),
      await form.elementHandle(),
    );
    expect(noticeFirst).toBe(true);
    await expect(form).toContainText("A pilot request is not a loan application. Do not submit financial documents through this form.");
    if (DEMO === "ui_mock") {
      await expect(notice.getByRole("link", { name: "Explore the demo" })).toHaveAttribute("href", "/demo");
    } else {
      await expect(page.locator('a[href="/demo"]')).toHaveCount(0);
    }
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

  for (const path of ["/", "/docs", "/pilot", "/demo"]) {
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
