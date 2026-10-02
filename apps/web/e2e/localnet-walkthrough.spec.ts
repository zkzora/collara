import { createHash } from "node:crypto";
import { expect as baseExpect, test, type Locator, type Page } from "@playwright/test";

// The main walkthrough against a real LOCALNET stack (Canton sandbox, API, worker, `next start` built with
// COLLARA_MODE=LOCALNET), from a FRESH main seed (`pnpm localnet:seed --profile main` on its own prefix and
// database: the walk changes the ledger, so it runs once per seed). Skipped unless E2E_MODE=LOCALNET:
//   E2E_MODE=LOCALNET PLAYWRIGHT_BASE_URL=http://localhost:3100 pnpm --filter @collara/web exec playwright test e2e/localnet-walkthrough.spec.ts --project=desktop
// Every persona signs in through /login (demo sessions). Each action waits for its command to be confirmed on
// the ledger and projected; ledger evidence (an update id) is shown, the UI_MOCK simulated copy never is.

test.skip(process.env.E2E_MODE !== "LOCALNET", "LOCALNET only: set E2E_MODE=LOCALNET and PLAYWRIGHT_BASE_URL to a LOCALNET web server");
test.describe.configure({ mode: "serial" });
test.setTimeout(900_000);
const expect = baseExpect.configure({ timeout: 60_000 });

const LOCALNET_BANNER = "Synthetic demo data — Canton LocalNet.";
const MOCK_BANNER = "Synthetic demo data — UI mockup.";
const LEDGER_CONFIRMED = "Confirmed on the ledger.";
const SIMULATED = /Recorded in the UI mockup|UI simulation|No ledger transaction was submitted/;
const UNAVAILABLE = "This record is unavailable to your account.";
const RELEASE_PENDING = "Release requested. The collateral lock remains active.";
const ELIGIBLE = "Eligible for this lender and case. Financing is not yet active.";

const PERSONAS = {
  analyst: { label: "Dana Reyes — Lender Analyst", viewing: "Demo Lender A · Lender Analyst" },
  approver: { label: "Morgan Hale — Lender Approver", viewing: "Demo Lender A · Lender Approver" },
  borrower: { label: "Plant manager — Borrower / Asset Owner", viewing: "Demo Manufacturer · Borrower / Asset Owner" },
  auditor: { label: "Audit lead — Auditor", viewing: "Demo Auditor · Auditor" },
  lenderB: { label: "Lender B approver — Lender Approver", viewing: "Demo Lender B · Lender Approver" },
  verifier: { label: "Inspector — Verifier", viewing: "Demo Verifier · Verifier" },
  dealer: { label: "Sales desk — Dealer Contributor", viewing: "Demo CNC Dealer · Dealer Contributor" },
} as const;
type PersonaKey = keyof typeof PERSONAS;

/** Signs in through the /login page with an isolated demo session for the persona. */
async function signIn(page: Page, key: PersonaKey) {
  await page.goto("/login");
  await expect(page.getByRole("note", { name: "Environment" })).toContainText(LOCALNET_BANNER);
  await page.getByLabel(PERSONAS[key].label, { exact: true }).check();
  await page.getByRole("button", { name: "Continue to workspace" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("note", { name: "Environment" })).toContainText(`Viewing as ${PERSONAS[key].viewing}.`);
  await expect(page.getByRole("note", { name: "Environment" })).not.toContainText(MOCK_BANNER);
}

async function confirmIn(dialog: Locator, name: string) {
  await dialog.getByRole("button", { name, exact: true }).click();
  await expect(dialog).toBeHidden();
}

/** A titled Panel (a section whose heading is the title). */
function panel(scope: Locator, title: string): Locator {
  return scope.locator("section").filter({ has: scope.page().getByRole("heading", { name: title, exact: true }) }).last();
}

/**
 * The tracked command reached the projected state: `Confirmed on the ledger.` with an update id and offset, never
 * the simulated copy. Returns the displayed update id prefix.
 */
async function expectLedgerConfirmed(page: Page): Promise<string> {
  const status = page.locator('[data-command-state="PROJECTED"]').first();
  await expect(status).toBeVisible({ timeout: 90_000 });
  await expect(status).toContainText(LEDGER_CONFIRMED);
  await expect(status).toContainText(/Update [0-9a-f]{6}…[0-9a-f]{4} · offset \d+/);
  await expect(page.locator("body")).not.toContainText(SIMULATED);
  return (await status.innerText()).match(/Update ([0-9a-f]{6})…/)?.[1] ?? "";
}

/** Reloads until the locator shows up (projections lag the ledger by up to a poll interval). */
async function reloadUntil(page: Page, locator: () => Locator, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    // Each load fetches client-side: give the page a few seconds before reloading.
    const shown = await locator()
      .first()
      .waitFor({ state: "visible", timeout: 6_000 })
      .then(() => true)
      .catch(() => false);
    if (shown || Date.now() > deadline) break;
    await page.reload();
  }
  await expect(locator().first()).toBeVisible();
}

const counts: Record<string, number> = {};
const step = (name: string) => {
  counts[name] = (counts[name] ?? 0) + 1;
};

test.afterAll(() => {
  console.log(`LOCALNET walkthrough steps: ${JSON.stringify(counts)}`);
});

test("LOCALNET walkthrough: review → eligible → FP-001 → accept → authorize → activate → release → audit export", async ({ page }, testInfo) => {
  test.skip((testInfo.project.use.viewport?.width ?? 1280) < 900, "the walkthrough runs on the desktop layout");
  const main = page.locator("main");

  // 1 · Lender analyst: start the review (saves the assessment on the ledger), then submit it for approval.
  await signIn(page, "analyst");
  await page.goto("/app/reviews");
  await page.getByRole("link", { name: "Open review CA-001 for CL-001" }).click();
  await expect(page).toHaveURL(/\/app\/reviews\/CA-001(\/assessment)?$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Collateral review · CL-001");
  // Equipment identity of the shared case (application-level disclosure), no stray separators.
  await expect(main.locator("header").first()).toContainText("CNC machining center · DEMO-CNC-500 · ASSET-DEMO-001");
  await page.getByRole("button", { name: "Start review" }).click();
  let dialog = page.getByRole("alertdialog", { name: "Start collateral review · CL-001" });
  await dialog.getByLabel("Valuation amount").fill("150000.00");
  await dialog.getByLabel("Valuation source").fill("Synthetic desk valuation (demo)");
  await dialog.getByLabel("Collateral outcome").selectOption("ELIGIBLE");
  await confirmIn(dialog, "Start review");
  await reloadUntil(page, () => panel(main, "Collateral valuation").getByText("150,000.00"));
  await expect(panel(main, "Requested principal")).toContainText("100,000.00");
  await expect(panel(main, "Collateral valuation")).not.toContainText("100,000.00");
  step("assessment saved");

  await page.getByRole("button", { name: "Submit for approval" }).click();
  dialog = page.getByRole("alertdialog", { name: "Submit assessment for approval · CL-001" });
  await confirmIn(dialog, "Submit for approval");
  await page.getByRole("navigation", { name: "Review sections" }).getByRole("link", { name: "Decision" }).click();
  await reloadUntil(page, () => main.getByText("Your mandate (Lender Analyst) does not include collateral approval."));
  await expect(main.getByRole("button", { name: "Approve eligibility" })).toHaveCount(0);
  step("submitted for approval");

  // 2 · Lender approver: record ELIGIBLE, then issue FP-001.
  await signIn(page, "approver");
  await page.goto("/app/reviews/CA-001/decision");
  await main.getByRole("button", { name: "Approve eligibility" }).click();
  dialog = page.getByRole("alertdialog", { name: "Approve collateral eligibility · CL-001" });
  await expect(dialog).toContainText("Demo Lender A · Lender Approver");
  await confirmIn(dialog, "Approve eligibility");
  await reloadUntil(page, () => main.getByText(ELIGIBLE));
  step("decision eligible");

  await page.goto("/app/cases/CL-001/proposal");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("CL-001");
  await main.getByRole("button", { name: "Issue proposal" }).click();
  dialog = page.getByRole("alertdialog", { name: "Issue financing proposal · CL-001" });
  await expect(dialog.getByLabel("Principal")).toHaveValue("100000.00");
  await confirmIn(dialog, "Issue proposal");
  await expectLedgerConfirmed(page);
  await expect(main.getByText("FP-001 · v1")).toBeVisible();
  step("proposal issued");

  // 3 · Borrower: accept the exact version, then authorize activation.
  await signIn(page, "borrower");
  await page.goto("/app/cases/CL-001/proposal");
  await main.getByRole("button", { name: "Accept v1" }).click();
  dialog = page.getByRole("alertdialog", { name: "Accept proposal FP-001 · exact version v1" });
  await confirmIn(dialog, "Accept this version");
  await expectLedgerConfirmed(page);
  step("proposal accepted");
  await page.getByRole("navigation", { name: "Case sections" }).getByRole("link", { name: "Pledge", exact: true }).click();
  await main.getByRole("button", { name: "Authorize pledge activation" }).click();
  dialog = page.getByRole("alertdialog", { name: "Authorize pledge activation · CL-001" });
  await confirmIn(dialog, "Authorize activation");
  await expectLedgerConfirmed(page);
  await expect(main.getByRole("button", { name: "Authorize pledge activation" })).toHaveCount(0);
  step("activation authorized");

  // 4 · Lender approver: activate the pledge; wait for committed + projected; ledger evidence shown.
  await signIn(page, "approver");
  await page.goto("/app/cases/CL-001/pledge");
  await main.getByRole("button", { name: "Activate pledge" }).click();
  dialog = page.getByRole("alertdialog", { name: "Activate pledge · CL-001" });
  await confirmIn(dialog, "Activate pledge");
  const updatePrefix = await expectLedgerConfirmed(page);
  expect(updatePrefix).toMatch(/^[0-9a-f]{6}$/);
  await reloadUntil(page, () => main.getByText("Lock and activation evidence · PL-001"));
  await expect(main.getByRole("button", { name: "Activate pledge" })).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(MOCK_BANNER);
  step("pledge activated");

  // 5 · Borrower: request release. The lock stays active.
  await signIn(page, "borrower");
  await page.goto("/app/pledges/PL-001");
  await main.getByRole("button", { name: "Request release" }).click();
  dialog = page.getByRole("alertdialog", { name: "Request release · PL-001" });
  await expect(dialog.getByLabel("Reason")).toHaveValue("EXTERNAL_LOAN_COMPLETION");
  await confirmIn(dialog, "Request release");
  await reloadUntil(page, () => main.getByText(RELEASE_PENDING));
  await expect(page.getByRole("heading", { level: 1 }).locator("..")).toContainText("Active · release requested");
  await expect(main.getByRole("button", { name: "Authorize release" })).toHaveCount(0);
  step("release requested");

  // 6 · Lender approver: authorize the release.
  await signIn(page, "approver");
  await page.goto("/app/pledges/PL-001");
  await main.getByRole("button", { name: "Authorize release" }).click();
  dialog = page.getByRole("alertdialog", { name: "Authorize release of PL-001" });
  await confirmIn(dialog, "Authorize release");
  await reloadUntil(page, () => page.getByRole("heading", { level: 1 }).locator("..").getByText("Released"));
  step("release authorized");

  // 7 · Each record owner grants the auditor access to its own records.
  for (const owner of ["borrower", "approver"] as const) {
    await signIn(page, owner);
    await page.goto("/app/access?caseId=CL-001");
    await main.getByRole("button", { name: "Grant audit access" }).click();
    dialog = page.getByRole("alertdialog", { name: "Grant audit access" });
    await expect(dialog.getByLabel("Case")).toHaveValue("CL-001");
    await confirmIn(dialog, "Grant access");
    await reloadUntil(page, () =>
      main.getByRole("region", { name: "Access grants · CL-001" }).getByRole("row").filter({ hasText: "Audit grant" }).filter({ hasText: "Demo Auditor" }),
    );
    step("audit grant");
  }

  // 8 · Auditor: request a scoped export; the worker generates it; download and verify the checksum.
  await signIn(page, "auditor");
  await page.goto("/app/audit/exports");
  await page.getByRole("button", { name: "Export case report" }).click();
  dialog = page.getByRole("alertdialog", { name: "Export case report · CL-001" });
  await expect(dialog).toContainText("Case workflow report — not a legal title or lien certificate.");
  await confirmIn(dialog, "Generate export");
  const rowOf = () => main.getByRole("region", { name: "Export jobs" }).getByRole("row").filter({ hasText: "CL-001" }).first();
  await reloadUntil(page, () => rowOf().getByRole("button", { name: /^Download RPT-/ }));
  const row = rowOf();
  await expect(row).toContainText(/RPT-\d{4} · CL-001/);
  await expect(row).toContainText(/sha256 [0-9a-f]{6}…[0-9a-f]{6}/);
  const [, head, tail] = (await row.innerText()).match(/sha256 ([0-9a-f]{6})…([0-9a-f]{6})/) ?? [];
  // The download opens a short-lived presigned link (issued after the access re-check) in a new tab.
  const linkRequest = page.context().waitForEvent("request", (r) => /X-Amz-Signature=/i.test(r.url()));
  await row.getByRole("button", { name: /^Download RPT-/ }).click();
  const signedUrl = (await linkRequest).url();
  const fetched = await page.request.get(signedUrl);
  expect(fetched.status()).toBe(200);
  const bytes = await fetched.body();
  const sha = createHash("sha256").update(bytes).digest("hex");
  expect(sha.startsWith(head ?? "x") && sha.endsWith(tail ?? "x")).toBe(true);
  const report = JSON.parse(bytes.toString("utf8")) as { reportRef: string; watermark: string; schemaVersion: string };
  expect(report).toMatchObject({ watermark: LOCALNET_BANNER, schemaVersion: "collara.case-report/v1" });
  expect(report.reportRef).toMatch(/^RPT-\d{4}$/);
  step("export downloaded");
});

test("LOCALNET negatives: Lender B sees nothing of CL-001; verifier and dealer never see terms", async ({ page }, testInfo) => {
  test.skip((testInfo.project.use.viewport?.width ?? 1280) < 900, "desktop layout");
  const main = page.locator("main");

  await signIn(page, "lenderB");
  await page.goto("/app/cases");
  await expect(page.getByRole("table", { name: /Cases ·/ })).toBeVisible();
  await expect(main.getByRole("link", { name: "CL-001" })).toHaveCount(0);
  await expect(main).toContainText("0 of 0 accessible cases");
  await expect(page.getByRole("navigation", { name: "Saved views" })).not.toContainText(/[1-9]/);
  for (const url of ["/app/cases/CL-001/summary", "/app/pledges/PL-001", "/app/reviews/CA-001/assessment", "/app/assets/ASSET-DEMO-001", "/app/audit?caseId=CL-001"]) {
    await page.goto(url);
    await expect(main.getByRole("alert")).toContainText(UNAVAILABLE);
    await expect(main).not.toContainText("Demo Manufacturer");
    await expect(main).not.toContainText("SYNTH-CNC-001");
    step("lender B unavailable");
  }
  await page.goto("/app/pledges");
  await expect(main.getByRole("link", { name: "Open pledge PL-001" })).toHaveCount(0);

  for (const key of ["verifier", "dealer"] as const) {
    await signIn(page, key);
    for (const url of ["/app", "/app/cases", "/app/cases/CL-001/summary", "/app/cases/CL-001/proposal", "/app/cases/CL-001/activity", "/app/pledges/PL-001", "/app/reviews/CA-001"]) {
      await page.goto(url);
      await page.waitForLoadState("networkidle");
      await expect(main).not.toContainText("100,000");
      await expect(main).not.toContainText("100000");
      await expect(main).not.toContainText("FP-001");
      step(`${key} no terms`);
    }
  }
});
