import AxeBuilder from "@axe-core/playwright";
import { expect as baseExpect, test, type Page } from "@playwright/test";

// Workspace Part B in UI_MOCK: assets, verifications, reviews, pledges, access, audit, governance,
// settings. Flows that change state stay in one tab (the mock world lives in the tab); read-only
// checks use full page loads. Run against a UI_MOCK server (PLAYWRIGHT_BASE_URL).

const LEDGER_CONFIRMED = "Confirmed on the ledger.";
const ACCESS_REVOKED = "Future document access has been revoked. Previously shared copies may still exist.";
const NOT_SCANNED = "Uploads are not virus-scanned in this synthetic-only demo.";
const ATTESTATION_COPY = "This attestation records the checks listed above. It does not approve financing or establish legal lien priority.";
const GOVERNANCE_SCOPE = "Governance controls verifier-registry administration only. It never authorizes collateral release.";

test.setTimeout(240_000);
const expect = baseExpect.configure({ timeout: 25_000 });
const isMobile = (width: number | undefined) => (width ?? 1280) < 900;

async function signIn(page: Page, label: string) {
  await page.goto("/login");
  await page.getByLabel(label).check();
  await page.getByRole("button", { name: "Continue to workspace" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
}

async function jump(page: Page, url: string) {
  await page.evaluate((target) => (window as unknown as { next: { router: { push(u: string): void } } }).next.router.push(target), url);
  await expect(page).toHaveURL(new RegExp(`${url.replace(/[?]/g, "\\?")}$`));
}

async function switchTo(page: Page, personaId: string, viewing: string) {
  await page.getByLabel("Demo persona (synthetic)").selectOption(personaId);
  await expect(page.getByRole("note", { name: "Environment" })).toContainText(`Viewing as ${viewing}`);
}

test("owner registers an asset, adds evidence and requests verification; the verifier attests", async ({ page }, testInfo) => {
  test.skip(isMobile(testInfo.project.use.viewport?.width), "state-changing flow runs on desktop");
  const main = page.locator("main");
  await signIn(page, "Plant manager — Borrower / Asset Owner");

  await page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Assets" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Assets" })).toBeVisible();
  await main.getByRole("link", { name: "Register asset" }).click();
  await expect(page).toHaveURL(/\/app\/assets\/new$/);
  await expect(main.getByText("Submitted ownership evidence has not yet been independently verified.").first()).toBeVisible();

  // Validation errors are announced with their fields.
  await main.getByRole("button", { name: "Register passport" }).click();
  await expect(main.getByLabel("Equipment class")).toHaveAttribute("aria-invalid", "true");

  await main.getByLabel("Equipment class").fill("CNC turning center");
  await main.getByLabel("Manufacturer").fill("Demo Lathe Works (synthetic)");
  await main.getByLabel("Model").fill("DEMO-CNC-210");
  await main.getByLabel("Serial number").fill("SYNTH-CNC-210");
  await main.getByLabel("Year of manufacture (optional)").fill("2020");
  await main.getByLabel("Location scope").fill("Demo Manufacturer facility · Ohio, US (declared)");
  await main.getByRole("button", { name: "Register passport" }).click();
  let dialog = page.getByRole("alertdialog", { name: "Register asset passport" });
  await expect(dialog).toContainText("DRAFT → REGISTERED");
  await dialog.getByRole("button", { name: "Register passport" }).click();
  await expect(page).toHaveURL(/\/app\/assets\/ASSET-DEMO-\d{3}\/overview$/);
  const assetRef = /ASSET-DEMO-\d{3}/.exec(page.url())?.[0] ?? "";
  await expect(page.getByRole("heading", { level: 1 })).toContainText("CNC turning center");
  await expect(page.getByRole("heading", { level: 1 }).locator("..")).toContainText("Registered");

  // Evidence: wrong type is refused client-side; a PDF is hashed, versioned and marked not scanned.
  // The Overview section has its own "Add evidence" button, so act inside the Evidence section only once it has
  // rendered; a global lookup can hit the outgoing Overview button while the navigation is still in flight.
  const sections = page.getByRole("navigation", { name: "Passport sections" });
  await sections.getByRole("link", { name: "Evidence" }).click();
  const evidenceSection = main.getByRole("region", { name: "Evidence", exact: true });
  await expect(evidenceSection).toBeVisible();
  await evidenceSection.getByRole("button", { name: "Add evidence" }).click();
  dialog = page.getByRole("alertdialog", { name: `Add evidence · ${assetRef}` });
  await expect(dialog).toContainText(NOT_SCANNED);
  await dialog.getByLabel("Document type").selectOption("DEALER_INVOICE");
  await dialog.getByLabel("Title").fill("Dealer invoice");
  await dialog.getByLabel("File").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("not evidence") });
  await dialog.getByRole("button", { name: "Upload document" }).click();
  await expect(dialog.getByText("Only PDF, JPEG and PNG files are accepted.")).toBeVisible();
  await dialog.getByLabel("File").setInputFiles({ name: "invoice.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n% synthetic test file\n") });
  await dialog.getByRole("button", { name: "Upload document" }).click();
  await expect(dialog).toBeHidden();
  const evidence = main.getByRole("region", { name: `Evidence documents · ${assetRef}` });
  const row = evidence.getByRole("row").filter({ hasText: "Dealer invoice" });
  await expect(row).toContainText("Hash verified");
  await expect(row).toContainText("Not scanned");
  await expect(row).toContainText(/[0-9a-f]{8}…[0-9a-f]{6}/);
  await expect(main.getByText(NOT_SCANNED)).toBeVisible();

  // Request verification from the passport overview (the Verification section appears once a request exists).
  await expect(sections.getByRole("link", { name: "Verification" })).toHaveCount(0);
  await sections.getByRole("link", { name: "Overview" }).click();
  const overviewSection = main.getByRole("region", { name: "Overview", exact: true });
  await expect(overviewSection).toBeVisible();
  await overviewSection.getByRole("button", { name: "Request verification" }).click();
  dialog = page.getByRole("alertdialog", { name: `Request verification · ${assetRef}` });
  await expect(dialog.getByRole("checkbox", { name: /Dealer invoice/ })).toBeChecked();
  await dialog.getByRole("button", { name: "Request verification" }).click();
  await expect(dialog).toBeHidden();
  await sections.getByRole("link", { name: "Verification" }).click();
  const requests = main.getByRole("region", { name: `Verification requests · ${assetRef}` });
  await expect(requests).toContainText("Requested");

  // The assigned verifier accepts and submits the attestation.
  await switchTo(page, "verifier-inspector", "Demo Verifier · Verifier");
  await jump(page, "/app/verifications");
  await main.getByRole("row").filter({ hasText: assetRef }).getByRole("link", { name: /^Open verification/ }).click();
  await expect(page.getByRole("heading", { level: 1 }).locator("..")).toContainText("Requested");
  await main.getByRole("button", { name: "Accept assignment" }).click();
  dialog = page.getByRole("alertdialog", { name: /^Accept assignment · VR-/ });
  await dialog.getByRole("button", { name: "Accept assignment" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("heading", { level: 1 }).locator("..")).toContainText("In review");
  await main.getByRole("button", { name: "Submit attestation" }).click();
  dialog = page.getByRole("alertdialog", { name: /^Submit attestation · VR-/ });
  await expect(dialog).toContainText(ATTESTATION_COPY);
  await dialog.getByLabel("Serial consistency · finding").fill("SYNTH-CNC-210 matches the dealer invoice");
  await expect(dialog.getByLabel("Ownership / lien · result")).toHaveValue("REVIEWED_DOCUMENTS");
  await dialog.getByRole("button", { name: "Submit attestation" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("heading", { level: 1 }).locator("..")).toContainText("Attestation issued");
  await expect(main.getByRole("region", { name: "Attestation" })).toContainText("SYNTH-CNC-210 matches the dealer invoice");
  await expect(page.getByRole("status").filter({ hasText: "Recorded in the UI mockup." }).first()).toBeVisible();
  await expect(page.locator("body")).not.toContainText(LEDGER_CONFIRMED);
});

test("governance: seats confirm and execute, the proposer withdraws; there is no reject vote", async ({ page }, testInfo) => {
  test.skip(isMobile(testInfo.project.use.viewport?.width), "state-changing flow runs on desktop");
  const main = page.locator("main");
  await signIn(page, "Morgan Hale — Lender Approver");
  await page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: /^Governance/ }).click();
  await expect(page).toHaveURL(/\/app\/governance\/registry$/);
  const notice = main.getByRole("note", { name: "Governance integration status" });
  await expect(notice).toContainText("Simulated");
  await expect(notice).toContainText(GOVERNANCE_SCOPE);

  await page.getByRole("navigation", { name: "Governance sections" }).getByRole("link", { name: "Proposals" }).click();
  await main.getByRole("link", { name: "Open proposal GP-004" }).click();
  await expect(page).toHaveURL(/\/app\/governance\/GP-004$/);
  await expect(main.getByRole("button", { name: /reject/i })).toHaveCount(0);
  await expect(main.getByRole("img", { name: "1 of 3 confirmations, threshold 2" })).toBeVisible();
  await main.getByRole("button", { name: "Confirm proposal" }).click();
  let dialog = page.getByRole("alertdialog", { name: "Confirm GP-004" });
  await expect(dialog).toContainText("This reaches the 2-of-3 threshold");
  await dialog.getByRole("button", { name: "Confirm proposal" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("status").filter({ hasText: "Recorded in the governance simulation." }).first()).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 }).locator("..")).toContainText("Ready to execute");
  await main.getByRole("button", { name: "Execute proposal" }).click();
  dialog = page.getByRole("alertdialog", { name: "Execute GP-004" });
  await dialog.getByRole("button", { name: "Execute proposal" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("heading", { level: 1 }).locator("..")).toContainText("Executed");

  await main.getByRole("link", { name: "All proposals" }).click();
  await page.getByRole("navigation", { name: "Governance sections" }).getByRole("link", { name: "Verifier registry" }).click();
  await expect(main.getByRole("region", { name: "Verifier registry" }).getByRole("row").filter({ hasText: "Demo Calibration Lab" })).toContainText("Active");

  await page.getByRole("navigation", { name: "Governance sections" }).getByRole("link", { name: "Proposals" }).click();
  await main.getByRole("button", { name: "Propose verifier" }).click();
  dialog = page.getByRole("alertdialog", { name: "Propose verifier" });
  await dialog.getByLabel("Verifier organization").fill("Demo Metrology Services");
  await dialog.getByLabel("Scope").fill("Dimensional metrology · CNC equipment");
  await dialog.getByLabel("Rationale for the other seats").fill("Onboarding checklist attached for review by the other seats.");
  await dialog.getByRole("button", { name: "Open proposal" }).click();
  await expect(dialog).toBeHidden();
  const newRow = main.getByRole("region", { name: "Governance proposals" }).getByRole("row").filter({ hasText: "Demo Metrology Services" });
  await expect(newRow).toContainText("Open");
  await newRow.getByRole("link", { name: /^Open proposal GP-/ }).click();
  await main.getByRole("button", { name: "Withdraw proposal" }).click();
  dialog = page.getByRole("alertdialog", { name: /^Withdraw GP-/ });
  await dialog.getByRole("button", { name: "Withdraw proposal" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("heading", { level: 1 }).locator("..")).toContainText("Withdrawn by proposer");
  await expect(page.locator("body")).not.toContainText(LEDGER_CONFIRMED);
});

test("lists filter through the URL; revocation shows the approved copy", async ({ page }, testInfo) => {
  test.skip(isMobile(testInfo.project.use.viewport?.width), "state-changing flow runs on desktop");
  const main = page.locator("main");
  await signIn(page, "Morgan Hale — Lender Approver");

  await page.goto("/app/pledges?filter=released");
  await expect(page.getByRole("navigation", { name: "Pledge filters" }).getByRole("link", { name: "Released" })).toHaveAttribute("aria-current", "page");
  const pledges = main.getByRole("region", { name: "Pledges · Released" });
  await expect(pledges.getByRole("link", { name: "Open pledge PL-005" })).toBeVisible();
  await expect(pledges.getByRole("link", { name: "Open pledge PL-003" })).toHaveCount(0);

  await page.goto("/app/audit");
  await main.getByLabel("Case").selectOption("CL-001");
  await main.getByLabel("Status").selectOption("COMMITTED");
  await main.getByRole("button", { name: "Apply filters" }).click();
  await expect(page).toHaveURL(/caseId=CL-001/);
  await expect(page).toHaveURL(/kind=COMMITTED/);
  const events = main.getByRole("region", { name: "Audit events" });
  await expect(events.getByRole("row").nth(1)).toContainText("Committed");
  await expect(events).not.toContainText("Operational");

  await page.goto("/app/reviews?view=ready-for-review");
  await expect(main.getByRole("region", { name: "Lender reviews · Ready for review" }).getByRole("link", { name: /Open review CA-001/ })).toBeVisible();

  // Borrower revokes the package share: future access only, with the approved copy.
  await page.goto("/login");
  await page.getByLabel("Plant manager — Borrower / Asset Owner").check();
  await page.getByRole("button", { name: "Continue to workspace" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await jump(page, "/app/access?caseId=CL-001");
  const share = main.getByRole("region", { name: "Access grants · CL-001" }).getByRole("row").filter({ hasText: "Package share" });
  await share.getByRole("button", { name: "Revoke" }).click();
  const dialog = page.getByRole("alertdialog", { name: /^Revoke future access · AG-/ });
  await expect(dialog).toContainText(ACCESS_REVOKED);
  await dialog.getByRole("button", { name: "Revoke future access" }).click();
  await expect(dialog).toBeHidden();
  await expect(main.getByRole("status").filter({ hasText: ACCESS_REVOKED })).toBeVisible();
  await expect(share).toContainText("Revoked");
});

test("keyboard: section tabs are links and dialogs trap and return focus", async ({ page }) => {
  await signIn(page, "Morgan Hale — Lender Approver");
  await page.goto("/app/governance/registry");
  const sections = page.getByRole("navigation", { name: "Governance sections" });
  await sections.getByRole("link", { name: "Verifier registry" }).focus();
  await page.keyboard.press("Tab");
  await expect(sections.getByRole("link", { name: "Proposals" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/app\/governance\/proposals$/);
  await expect(sections.getByRole("link", { name: "Proposals" })).toHaveAttribute("aria-current", "page");

  const trigger = page.getByRole("button", { name: "Propose verifier" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("alertdialog", { name: "Propose verifier" });
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 10; i += 1) {
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  // Passport tabs are reachable and announce the current section.
  await page.goto("/app/assets/ASSET-DEMO-001/overview");
  const passport = page.getByRole("navigation", { name: "Passport sections" });
  await passport.getByRole("link", { name: "Overview" }).focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/app\/assets\/ASSET-DEMO-001\/evidence$/);
  await expect(passport.getByRole("link", { name: "Evidence" })).toHaveAttribute("aria-current", "page");
});

const LENDER_PAGES = [
  "/app/assets",
  "/app/assets/ASSET-DEMO-001/overview",
  "/app/assets/ASSET-DEMO-001/evidence",
  "/app/reviews",
  "/app/reviews/CA-001/assessment",
  "/app/reviews/CA-001/decision",
  "/app/pledges",
  "/app/pledges/PL-003",
  "/app/access",
  "/app/audit",
  "/app/audit/exports",
  "/app/governance/registry",
  "/app/governance/proposals",
  "/app/governance/GP-004",
  "/app/settings",
  "/app/notifications",
];

test("Part B pages have no serious or critical axe violations", async ({ page }) => {
  const check = async (path: string) => {
    await page.goto(path);
    await expect(page.locator("main h1").first()).toBeVisible();
    await page.waitForLoadState("networkidle");
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(blocking, `${path}: ${blocking.map((v) => `${v.id} (${v.nodes.length})`).join(", ")}`).toEqual([]);
  };
  await signIn(page, "Morgan Hale — Lender Approver");
  for (const path of LENDER_PAGES) await check(path);
  await signIn(page, "Inspector — Verifier");
  for (const path of ["/app/verifications", "/app/verifications/VR-001"]) await check(path);
  await signIn(page, "Plant manager — Borrower / Asset Owner");
  for (const path of ["/app/assets/new", "/app/pledges/PL-005"]) await check(path);
});

test("390×844: Part B pages do not scroll sideways; wide tables scroll in their region", async ({ page }, testInfo) => {
  test.skip(!isMobile(testInfo.project.use.viewport?.width), "mobile layout only");
  await signIn(page, "Morgan Hale — Lender Approver");
  for (const path of LENDER_PAGES) {
    await page.goto(path);
    await expect(page.locator("main h1").first()).toBeVisible();
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
  await page.goto("/app/governance/registry");
  const region = page.getByRole("region", { name: "Verifier registry" });
  expect(await region.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);

  // Dialogs fit the small screen and keep their confirm button reachable.
  await page.goto("/app/governance/GP-004");
  await page.getByRole("button", { name: "Confirm proposal" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Confirm GP-004" });
  await expect(dialog.getByRole("button", { name: "Confirm proposal" })).toBeInViewport();
});
