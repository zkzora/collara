import { expect as baseExpect, test, type Locator, type Page } from "@playwright/test";

// Private notes in UI_MOCK (one tab, personas switched in place so the in-memory world is kept):
// the analyst's internal notes and shared feedback are read back after saving; the borrower sees the shared
// feedback only; Lender B sees nothing; the release request note, the lender's question and the borrower's
// response appear as a thread for the borrower and the designated lender. Run against a UI_MOCK server, e.g.
// PLAYWRIGHT_BASE_URL=http://localhost:3130.

const MOCK_BANNER = "Synthetic demo data — UI mockup.";
const UNAVAILABLE = "This record is unavailable to your account.";
const TEXT = {
  internal: "E2E internal note: maintenance log gap explained (synthetic).",
  shared: "E2E shared feedback: the package is complete for this review (synthetic).",
  rrNote: "E2E release note: final payment confirmed (synthetic).",
  question: "E2E question: please confirm the payoff date (synthetic).",
  response: "E2E response: paid off on the agreed date (synthetic).",
};

test.setTimeout(420_000);
const expect = baseExpect.configure({ timeout: 25_000 });

const PERSONAS = {
  analyst: { id: "lender-a-analyst", viewing: "Demo Lender A · Lender Analyst" },
  approver: { id: "lender-a-approver", viewing: "Demo Lender A · Lender Approver" },
  borrower: { id: "manufacturer-owner", viewing: "Demo Manufacturer · Borrower / Asset Owner" },
  lenderB: { id: "lender-b-approver", viewing: "Demo Lender B · Lender Approver" },
} as const;

async function switchTo(page: Page, key: keyof typeof PERSONAS) {
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

test("private notes: review read-back and audiences; release note thread", async ({ page }, testInfo) => {
  test.skip((testInfo.project.use.viewport?.width ?? 1280) < 900, "runs on the desktop layout");
  const main = page.locator("main");
  await page.goto("/login");
  await expect(page.getByRole("note", { name: "Environment" })).toContainText(MOCK_BANNER);
  await page.getByLabel("Dana Reyes — Lender Analyst").check();
  await page.getByRole("button", { name: "Continue to workspace" }).click();
  await expect(page).toHaveURL(/\/app$/);

  // Analyst: save the assessment with internal notes and shared feedback; both are read back.
  await jump(page, "/app/reviews/CA-001/assessment");
  await page.getByRole("button", { name: "Start review" }).click();
  let dialog = page.getByRole("alertdialog", { name: "Start collateral review · CL-001" });
  await dialog.getByLabel("Valuation amount").fill("150,000.00");
  await dialog.getByLabel("Valuation source").fill("Verifier inspection report v2 · dealer invoice v1");
  await dialog.getByLabel("Internal assessment notes").fill(TEXT.internal);
  await dialog.getByLabel("Feedback shared with the borrower").fill(TEXT.shared);
  await dialog.getByLabel("Collateral outcome").selectOption("ELIGIBLE");
  await confirmIn(dialog, "Start review");
  await expect(main.getByText(TEXT.internal)).toBeVisible();
  await expect(main.getByText(TEXT.shared)).toBeVisible();
  // Reopening the form shows the saved text.
  await page.getByRole("button", { name: "Save assessment" }).click();
  dialog = page.getByRole("alertdialog", { name: "Save assessment · CL-001" });
  await expect(dialog.getByLabel("Internal assessment notes")).toHaveValue(TEXT.internal);
  await expect(dialog.getByLabel("Feedback shared with the borrower")).toHaveValue(TEXT.shared);
  await dialog.getByRole("button", { name: "Cancel" }).click();

  // Borrower: the shared feedback, never the internal notes.
  await switchTo(page, "borrower");
  await jump(page, "/app/cases/CL-001/review");
  await expect(main.getByText(TEXT.shared)).toBeVisible();
  await expect(main).not.toContainText(TEXT.internal);

  // Lender B: unavailable, no text.
  await switchTo(page, "lenderB");
  await jump(page, "/app/cases/CL-001/review");
  await expect(main.getByRole("alert")).toContainText(UNAVAILABLE);
  await expect(main).not.toContainText(TEXT.shared);

  // Approver: eligible → proposal; borrower accepts and authorizes; approver activates.
  await switchTo(page, "approver");
  await jump(page, "/app/reviews/CA-001/decision");
  await main.getByRole("button", { name: "Approve eligibility" }).click();
  await confirmIn(page.getByRole("alertdialog", { name: "Approve collateral eligibility · CL-001" }), "Approve eligibility");
  await jump(page, "/app/cases/CL-001/proposal");
  await main.getByRole("button", { name: "Issue proposal" }).click();
  await confirmIn(page.getByRole("alertdialog", { name: "Issue financing proposal · CL-001" }), "Issue proposal");
  await switchTo(page, "borrower");
  await main.getByRole("button", { name: "Accept v1" }).click();
  await confirmIn(page.getByRole("alertdialog", { name: "Accept proposal FP-001 · exact version v1" }), "Accept this version");
  await jump(page, "/app/cases/CL-001/pledge");
  await main.getByRole("button", { name: "Authorize pledge activation" }).click();
  await confirmIn(page.getByRole("alertdialog", { name: "Authorize pledge activation · CL-001" }), "Authorize activation");
  await switchTo(page, "approver");
  await main.getByRole("button", { name: "Activate pledge" }).click();
  await confirmIn(page.getByRole("alertdialog", { name: "Activate pledge · CL-001" }), "Activate pledge");
  await expect(main.getByText("Lock and activation evidence · PL-001")).toBeVisible();

  // Borrower: release request with a note.
  await switchTo(page, "borrower");
  await jump(page, "/app/pledges/PL-001");
  await main.getByRole("button", { name: "Request release" }).click();
  dialog = page.getByRole("alertdialog", { name: "Request release · PL-001" });
  await dialog.getByLabel("Note to the lender (optional)").fill(TEXT.rrNote);
  await confirmIn(dialog, "Request release");
  const thread = main.getByRole("region", { name: /Notes and questions · RR-/ });
  await expect(thread).toContainText(TEXT.rrNote);

  // Approver: ask for information; borrower: respond.
  await switchTo(page, "approver");
  await main.getByRole("button", { name: "Request information" }).click();
  dialog = page.getByRole("alertdialog", { name: /Request information · RR-/ });
  await dialog.getByLabel("Information needed").fill(TEXT.question);
  await confirmIn(dialog, "Send request");
  await expect(thread).toContainText(TEXT.question);
  await switchTo(page, "borrower");
  await main.getByRole("button", { name: "Respond to the lender" }).click();
  dialog = page.getByRole("alertdialog", { name: /Respond to information request · RR-/ });
  await dialog.getByLabel("Response").fill(TEXT.response);
  await confirmIn(dialog, "Send response");

  // The thread, in order, with labels, for the borrower and the designated lender.
  for (const who of ["borrower", "approver"] as const) {
    await switchTo(page, who);
    await expect(thread.getByRole("listitem")).toHaveCount(3);
    await expect(thread.getByRole("listitem").nth(0)).toContainText("Request note");
    await expect(thread.getByRole("listitem").nth(0)).toContainText(TEXT.rrNote);
    await expect(thread.getByRole("listitem").nth(1)).toContainText("Lender question");
    await expect(thread.getByRole("listitem").nth(1)).toContainText(TEXT.question);
    await expect(thread.getByRole("listitem").nth(2)).toContainText("Borrower response");
    await expect(thread.getByRole("listitem").nth(2)).toContainText(TEXT.response);
  }

  // Lender B: the pledge is unavailable and no text leaks.
  await switchTo(page, "lenderB");
  await expect(main.getByRole("alert")).toContainText(UNAVAILABLE);
  for (const text of Object.values(TEXT)) await expect(main).not.toContainText(text);
});
