import { expect as baseExpect, test, type Locator, type Page } from "@playwright/test";

// The main demo walkthrough in UI_MOCK (MP L169 + the borrower activation step, CR-20), across
// personas in ONE browser tab: the mock world lives in the tab, so navigation stays client-side
// (links, or the Next router for direct jumps) and personas change through the sidebar switcher.
// Run against a UI_MOCK server, e.g. PLAYWRIGHT_BASE_URL=http://localhost:3103.

const MOCK_BANNER = "Synthetic demo data — UI mockup.";
const LEDGER_CONFIRMED = "Confirmed on the ledger.";
const UNAVAILABLE = "This record is unavailable to your account.";
const RELEASE_PENDING = "Release requested. The collateral lock remains active.";
const RELEASE_AUTHORITY = "Release requires the designated lender's authorization.";
const RELEASE_CAVEAT = "This releases the Collara workflow lock. Any required legal lien termination must be completed separately.";
const ACCEPT_CAVEAT = "Accepting this workflow proposal does not itself disburse funds or replace executed financing documents.";
const ELIGIBLE = "Eligible for this lender and case. Financing is not yet active.";

test.setTimeout(420_000);
const expect = baseExpect.configure({ timeout: 25_000 });

const PERSONAS = {
  analyst: { id: "lender-a-analyst", viewing: "Demo Lender A · Lender Analyst" },
  approver: { id: "lender-a-approver", viewing: "Demo Lender A · Lender Approver" },
  borrower: { id: "manufacturer-owner", viewing: "Demo Manufacturer · Borrower / Asset Owner" },
  auditor: { id: "auditor", viewing: "Demo Auditor · Auditor" },
  lenderB: { id: "lender-b-approver", viewing: "Demo Lender B · Lender Approver" },
  verifier: { id: "verifier-inspector", viewing: "Demo Verifier · Verifier" },
  dealer: { id: "dealer-contributor", viewing: "Demo CNC Dealer · Dealer Contributor" },
} as const;
type PersonaKey = keyof typeof PERSONAS;

async function signIn(page: Page, label: string) {
  await page.goto("/login");
  await expect(page.getByRole("note", { name: "Environment" })).toContainText(MOCK_BANNER);
  await page.getByLabel(label).check();
  await page.getByRole("button", { name: "Continue to workspace" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
}

/** Switches the demo persona in place (the in-memory world is kept). */
async function switchTo(page: Page, key: PersonaKey) {
  await page.getByLabel("Demo persona (synthetic)").selectOption(PERSONAS[key].id);
  await expect(page.getByRole("note", { name: "Environment" })).toContainText(`Viewing as ${PERSONAS[key].viewing}`);
}

/** Client-side jump (a full page load would start a fresh mock world). */
async function jump(page: Page, url: string) {
  await page.evaluate((target) => (window as unknown as { next: { router: { push(u: string): void } } }).next.router.push(target), url);
  await expect(page).toHaveURL(new RegExp(`${url.replace(/[?]/g, "\\?")}$`));
}

async function confirmIn(dialog: Locator, name: string) {
  await dialog.getByRole("button", { name, exact: true }).click();
  await expect(dialog).toBeHidden();
}

/** A titled Panel (a section whose heading is the title). */
function panel(scope: Locator, title: string): Locator {
  return scope.locator("section").filter({ has: scope.page().getByRole("heading", { name: title, exact: true }) }).last();
}

async function expectRecorded(page: Page) {
  await expect(page.getByRole("status").filter({ hasText: "Recorded in the UI mockup." }).first()).toBeVisible();
  await expect(page.locator("body")).not.toContainText(LEDGER_CONFIRMED);
}

test("main walkthrough: review → eligible → proposal → acceptance → activation → release → audit export", async ({ page }, testInfo) => {
  test.skip((testInfo.project.use.viewport?.width ?? 1280) < 900, "the walkthrough runs on the desktop layout");
  const main = page.locator("main");
  await signIn(page, "Dana Reyes — Lender Analyst");

  // 1 · Lender analyst: start the review, save the assessment, submit it for approval.
  await jump(page, "/app/reviews");
  await page.getByRole("link", { name: "Open review CA-001 for CL-001" }).click();
  await expect(page).toHaveURL(/\/app\/reviews\/CA-001\/assessment$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Collateral review · CL-001");
  await page.getByRole("button", { name: "Start review" }).click();
  let dialog = page.getByRole("alertdialog", { name: "Start collateral review · CL-001" });
  await dialog.getByLabel("Valuation amount").fill("150,000.00");
  await dialog.getByLabel("Valuation source").fill("Verifier inspection report v2 · dealer invoice v1");
  await dialog.getByLabel("Internal assessment notes").fill("Maintenance log gap noted by the verifier; explanation received.");
  await dialog.getByLabel("Feedback shared with the borrower").fill("Evidence package is complete for this review.");
  await dialog.getByLabel("Collateral outcome").selectOption("ELIGIBLE");
  await confirmIn(dialog, "Start review");
  await expectRecorded(page);
  await expect(main.getByText("Internal · Demo Lender A only")).toBeVisible();
  await expect(main.getByText("Shared feedback · visible to the borrower")).toBeVisible();
  // Valuation and principal are separate figures, each with its currency.
  await expect(panel(main, "Collateral valuation")).toContainText("150,000.00");
  await expect(panel(main, "Requested principal")).toContainText("100,000.00");
  await expect(panel(main, "Requested principal")).toContainText("66.7%");
  await expect(panel(main, "Collateral valuation")).not.toContainText("100,000.00");

  await page.getByRole("button", { name: "Submit for approval" }).click();
  dialog = page.getByRole("alertdialog", { name: "Submit assessment for approval · CL-001" });
  await confirmIn(dialog, "Submit for approval");
  await page.getByRole("navigation", { name: "Review sections" }).getByRole("link", { name: "Decision" }).click();
  await expect(main.getByText("Your mandate (Lender Analyst) does not include collateral approval.")).toBeVisible();
  await expect(main.getByRole("button", { name: "Approve eligibility" })).toHaveCount(0);

  // 2 · Lender approver: record eligibility, then issue the proposal.
  await switchTo(page, "approver");
  await expect(page).toHaveURL(/\/app\/reviews\/CA-001\/decision$/);
  await main.getByRole("button", { name: "Approve eligibility" }).click();
  dialog = page.getByRole("alertdialog", { name: "Approve collateral eligibility · CL-001" });
  await expect(dialog).toContainText("Demo Lender A · Lender Approver");
  await confirmIn(dialog, "Approve eligibility");
  await expect(main.getByText(ELIGIBLE)).toBeVisible();
  await main.getByRole("link", { name: "Continue to the proposal" }).click();
  await expect(page).toHaveURL(/\/app\/cases\/CL-001\/proposal$/);
  await main.getByRole("button", { name: "Issue proposal" }).click();
  dialog = page.getByRole("alertdialog", { name: "Issue financing proposal · CL-001" });
  await expect(dialog.getByLabel("Principal")).toHaveValue("100000.00");
  await confirmIn(dialog, "Issue proposal");
  await expect(main.getByText("FP-001 · v1")).toBeVisible();

  // 3 · Borrower: accept the exact version, then authorize activation.
  await switchTo(page, "borrower");
  await main.getByRole("button", { name: "Accept v1" }).click();
  dialog = page.getByRole("alertdialog", { name: "Accept proposal FP-001 · exact version v1" });
  await expect(dialog).toContainText(ACCEPT_CAVEAT);
  await confirmIn(dialog, "Accept this version");
  await page.getByRole("navigation", { name: "Case sections" }).getByRole("link", { name: "Pledge", exact: true }).click();
  await main.getByRole("button", { name: "Authorize pledge activation" }).click();
  dialog = page.getByRole("alertdialog", { name: "Authorize pledge activation · CL-001" });
  await confirmIn(dialog, "Authorize activation");
  await expect(main.getByRole("button", { name: "Authorize pledge activation" })).toHaveCount(0);

  // 4 · Lender approver: activate the pledge (consumes the asset control). A second activation is impossible.
  await switchTo(page, "approver");
  await main.getByRole("button", { name: "Activate pledge" }).click();
  dialog = page.getByRole("alertdialog", { name: "Activate pledge · CL-001" });
  await confirmIn(dialog, "Activate pledge");
  await expect(main.getByText("Lock and activation evidence · PL-001")).toBeVisible();
  await expect(main.getByRole("button", { name: "Activate pledge" })).toHaveCount(0);
  await jump(page, "/app/assets/ASSET-DEMO-001/overview");
  await expect(main.getByText("Locked", { exact: true })).toBeVisible();
  await expect(main.getByRole("link", { name: "PL-001" })).toBeVisible();

  // 5 · Borrower: request release. The lock stays active.
  await switchTo(page, "borrower");
  await jump(page, "/app/pledges");
  await page.getByRole("link", { name: "Open pledge PL-001" }).click();
  await expect(page).toHaveURL(/\/app\/pledges\/PL-001$/);
  await main.getByRole("button", { name: "Request release" }).click();
  dialog = page.getByRole("alertdialog", { name: "Request release · PL-001" });
  await expect(dialog.getByLabel("Reason")).toHaveValue("EXTERNAL_LOAN_COMPLETION");
  await expect(dialog).toContainText(RELEASE_AUTHORITY);
  await dialog.getByLabel("Note to the lender (optional)").fill("Final payment confirmed by our servicing team.");
  await dialog.getByLabel("Servicing reference (optional)").fill("LOAN-DEMO-001");
  await confirmIn(dialog, "Request release");
  await expect(main.getByText(RELEASE_PENDING)).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 }).locator("..")).toContainText("Active · release requested");
  await expect(main.getByText(RELEASE_AUTHORITY).first()).toBeVisible();
  await expect(main.getByRole("button", { name: "Authorize release" })).toHaveCount(0);

  // The analyst cannot decide the release; only the designated lender approver can.
  await switchTo(page, "analyst");
  await expect(main.getByText("Your mandate (Lender Analyst) does not include release approval.")).toBeVisible();
  await expect(main.getByRole("button", { name: "Authorize release" })).toHaveCount(0);

  // 6 · Lender approver: authorize the release.
  await switchTo(page, "approver");
  await main.getByRole("button", { name: "Authorize release" }).click();
  dialog = page.getByRole("alertdialog", { name: "Authorize release of PL-001" });
  await expect(dialog).toContainText(RELEASE_CAVEAT);
  await confirmIn(dialog, "Authorize release");
  await expect(page.getByRole("heading", { level: 1 }).locator("..")).toContainText("Released");
  await expectRecorded(page);

  // 7 · Each record owner grants the auditor access to its own records (CR-49).
  for (const owner of ["borrower", "approver"] as const) {
    await switchTo(page, owner);
    await jump(page, "/app/access?caseId=CL-001");
    await main.getByRole("button", { name: "Grant audit access" }).click();
    dialog = page.getByRole("alertdialog", { name: "Grant audit access" });
    await expect(dialog.getByLabel("Case")).toHaveValue("CL-001");
    await expect(dialog.getByRole("checkbox", { name: "Pledge and release events" })).toBeChecked();
    await confirmIn(dialog, "Grant access");
  }
  const grants = main.getByRole("region", { name: "Access grants · CL-001" });
  await expect(grants.getByRole("row").filter({ hasText: "Audit grant" }).filter({ hasText: "Demo Auditor" })).toHaveCount(2);

  // 8 · Auditor: scoped export with cut-off and checksum, downloaded after the access re-check.
  await switchTo(page, "auditor");
  await jump(page, "/app/audit/exports");
  await page.getByRole("button", { name: "Export case report" }).click();
  dialog = page.getByRole("alertdialog", { name: "Export case report · CL-001" });
  await expect(dialog).toContainText("Case workflow report — not a legal title or lien certificate.");
  await expect(dialog).toContainText("Granted record types:");
  await confirmIn(dialog, "Generate export");
  const exportsTable = main.getByRole("region", { name: "Export jobs" });
  const row = exportsTable.getByRole("row").filter({ hasText: "CL-001" }).first();
  await expect(row).toContainText(/RPT-\d{4} · CL-001/);
  await expect(row).toContainText("Granted subset · Demo Auditor");
  await expect(row).toContainText(/sha256 [0-9a-f]{6}…[0-9a-f]{6}/);
  await expect(row).toContainText("cut-off");
  const download = page.waitForEvent("download");
  await row.getByRole("button", { name: /^Download RPT-/ }).click();
  expect((await download).suggestedFilename()).toMatch(/^RPT-\d{4}-CL-001\.json$/);
  await expect(page.locator("body")).not.toContainText(LEDGER_CONFIRMED);

  // Negative checks on the same world.
  // Lender B (unrelated) cannot open CL-001, its pledge, its review or its events.
  await switchTo(page, "lenderB");
  for (const url of ["/app/cases/CL-001/summary", "/app/pledges/PL-001", "/app/reviews/CA-001/assessment", "/app/audit?caseId=CL-001"]) {
    await jump(page, url);
    await expect(main.getByRole("alert")).toContainText(UNAVAILABLE);
    await expect(main).not.toContainText("Demo Manufacturer");
  }
  await jump(page, "/app/pledges");
  await expect(main.getByRole("link", { name: "Open pledge PL-001" })).toHaveCount(0);

  // Verifier and dealer never see terms.
  for (const key of ["verifier", "dealer"] as const) {
    await switchTo(page, key);
    await jump(page, "/app/cases/CL-001/proposal");
    await expect(main.getByText(/This record is unavailable to your account\.|Proposal is not available/)).toBeVisible();
    await expect(main).not.toContainText("100,000.00");
    await jump(page, "/app/pledges/PL-001");
    await expect(main).not.toContainText("100,000.00");
  }
});
