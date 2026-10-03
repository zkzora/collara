import AxeBuilder from "@axe-core/playwright";
import { expect as baseExpect, test, type Locator, type Page } from "@playwright/test";

// Dealer consent in UI_MOCK (one tab, personas switched in place so the in-memory world is kept): the owner's
// case-linked verification request asks the dealer for its own invoice; the dealer approves, declines or withdraws
// behind a confirmation; the owner reads the status per dealer document on the case's Sharing & Access tab and on
// the verification request. Run against a UI_MOCK server (PLAYWRIGHT_BASE_URL).

const LEDGER_CONFIRMED = "Confirmed on the ledger.";
const ACCESS_REVOKED = "Future document access has been revoked. Previously shared copies may still exist.";

test.setTimeout(240_000);
const expect = baseExpect.configure({ timeout: 25_000 });
const isMobile = (width: number | undefined) => (width ?? 1280) < 900;

const PERSONAS = {
  owner: { id: "manufacturer-owner", viewing: "Demo Manufacturer · Borrower / Asset Owner" },
  dealer: { id: "dealer-contributor", viewing: "Demo CNC Dealer · Dealer Contributor" },
  verifier: { id: "verifier-inspector", viewing: "Demo Verifier · Verifier" },
} as const;

async function signIn(page: Page, label: string) {
  await page.goto("/login");
  await page.getByLabel(label).check();
  await page.getByRole("button", { name: "Continue to workspace" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
}

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

/**
 * The owner requests verification of ASSET-DEMO-001 linked to CL-001, including the dealer's invoice (DOC-003).
 * Returns the new request's ref and the consent request's id (`<ref>-G2-D1`: package v2, dealer 1).
 */
async function requestCaseLinkedVerification(page: Page): Promise<{ vr: string; consentId: string }> {
  await jump(page, "/app/assets/ASSET-DEMO-001/verification");
  await page.locator("main").getByRole("button", { name: "Request verification" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Request verification · ASSET-DEMO-001" });
  await expect(dialog.getByRole("checkbox", { name: /Dealer invoice .*not shared: link the request/ })).toBeVisible();
  await dialog.getByLabel("Case (optional)").selectOption("CL-001");
  await expect(dialog.getByRole("checkbox", { name: /Dealer invoice · DOC-003 v1 · Demo CNC Dealer \(requested from the dealer; shared after its consent\)/ })).toBeChecked();
  await confirmIn(dialog, "Request verification");
  const region = page.getByRole("region", { name: "Verification requests · ASSET-DEMO-001" });
  const created = region.getByRole("row").filter({ hasText: /VR-\d{3}/ }).filter({ hasNotText: "VR-001" });
  await expect(created).toHaveCount(1);
  await expect(created).toContainText("Requested");
  const text = (await created.textContent()) ?? "";
  const vr = /VR-\d{3}/.exec(text)?.[0] ?? "";
  expect(vr).not.toBe("");
  return { vr, consentId: `${vr}-G2-D1` };
}

const rowOf = (region: Locator, text: string) => region.getByRole("row").filter({ hasText: text });

test("dealer approves a verification consent request, then withdraws it with the approved copy", async ({ page }, testInfo) => {
  test.skip(isMobile(testInfo.project.use.viewport?.width), "state-changing flow runs on desktop");
  const main = page.locator("main");
  await signIn(page, "Plant manager — Borrower / Asset Owner");
  const { vr, consentId } = await requestCaseLinkedVerification(page);

  await switchTo(page, "dealer");
  await jump(page, "/app/cases/CL-001/sharing");
  const requests = main.getByRole("region", { name: "Consent requests · CL-001" });
  const pending = rowOf(requests, consentId);
  await expect(pending).toContainText("Dealer invoice · DOC-003 v1");
  await expect(pending).toContainText(/SHA-256 [0-9a-f]{8}…[0-9a-f]{6}/);
  await expect(pending).toContainText("Demo Verifier");
  await expect(pending).toContainText(`Verification · ${vr}`);
  await expect(pending).toContainText("Awaiting consent");
  await expect(rowOf(requests, "AG-001")).toContainText("Consent granted");
  await expect(requests).not.toContainText("DOC-001");

  await pending.getByRole("button", { name: "Approve" }).click();
  let dialog = page.getByRole("alertdialog", { name: `Approve consent · ${consentId}` });
  await expect(dialog).toContainText("Shares Dealer invoice · DOC-003 v1 with Demo Verifier for verification on CL-001");
  await expect(dialog).toContainText("Awaiting consent → Consent granted");
  await confirmIn(dialog, "Approve and share");
  await expect(pending).toContainText("Consent granted");
  await expect(page.getByRole("status").filter({ hasText: "Recorded in the UI mockup." }).first()).toBeVisible();

  // The assigned verifier now has the dealer's invoice for the new request.
  await switchTo(page, "verifier");
  await jump(page, `/app/verifications/${vr}`);
  await expect(main.getByRole("region", { name: "Assigned evidence", exact: true })).toContainText("Dealer invoice");

  await switchTo(page, "dealer");
  await jump(page, "/app/cases/CL-001/sharing");
  await rowOf(main.getByRole("region", { name: "Consent requests · CL-001" }), consentId).getByRole("button", { name: "Withdraw consent" }).click();
  dialog = page.getByRole("alertdialog", { name: `Withdraw consent · ${consentId}` });
  await expect(dialog).toContainText(ACCESS_REVOKED);
  await expect(dialog).toContainText("Consent granted → Consent withdrawn");
  await confirmIn(dialog, "Withdraw consent");
  await expect(main.getByRole("status").filter({ hasText: ACCESS_REVOKED })).toContainText(`${consentId} · Demo Verifier`);
  await expect(rowOf(main.getByRole("region", { name: "Consent requests · CL-001" }), consentId)).toContainText("Consent withdrawn");

  await switchTo(page, "verifier");
  await jump(page, `/app/verifications/${vr}`);
  await expect(main.getByRole("region", { name: "Assigned evidence", exact: true })).not.toContainText("Dealer invoice");
  await expect(page.locator("body")).not.toContainText(LEDGER_CONFIRMED);
});

test("dealer declines from Sharing and access; the owner sees the status per dealer document; lender consent withdrawn", async ({ page }, testInfo) => {
  test.skip(isMobile(testInfo.project.use.viewport?.width), "state-changing flow runs on desktop");
  const main = page.locator("main");
  await signIn(page, "Plant manager — Borrower / Asset Owner");
  const { vr, consentId } = await requestCaseLinkedVerification(page);

  await switchTo(page, "dealer");
  await jump(page, "/app/access");
  const requests = main.getByRole("region", { name: "Consent requests · all accessible cases" });
  await rowOf(requests, consentId).getByRole("button", { name: "Decline" }).click();
  let dialog = page.getByRole("alertdialog", { name: `Decline consent · ${consentId}` });
  await expect(dialog).toContainText("Demo Verifier will not receive Dealer invoice · DOC-003 v1");
  await expect(dialog).toContainText("Awaiting consent → Declined");
  await confirmIn(dialog, "Decline request");
  await expect(rowOf(requests, consentId)).toContainText("Declined");
  await expect(rowOf(requests, consentId).getByRole("button")).toHaveCount(0);

  // The lender consent (AG-001) is withdrawn from the same page.
  await rowOf(requests, "AG-001").getByRole("button", { name: "Withdraw consent" }).click();
  dialog = page.getByRole("alertdialog", { name: "Withdraw consent · AG-001" });
  await expect(dialog).toContainText(ACCESS_REVOKED);
  await confirmIn(dialog, "Withdraw consent");
  await expect(main.getByRole("status").filter({ hasText: ACCESS_REVOKED })).toContainText("AG-001 · Demo Lender A");
  await expect(rowOf(requests, "AG-001")).toContainText("Consent withdrawn");

  // The owner sees why the invoice has not reached the verifier or the lender.
  await switchTo(page, "owner");
  await jump(page, "/app/cases/CL-001/sharing");
  const status = main.getByRole("region", { name: "Dealer consent · CL-001" });
  await expect(rowOf(status, consentId)).toContainText("Declined");
  await expect(rowOf(status, consentId)).toContainText("Demo Verifier");
  await expect(rowOf(status, "AG-001")).toContainText("Consent withdrawn");
  await expect(rowOf(status, "AG-001")).toContainText("Demo Lender A");
  await expect(status.getByRole("button")).toHaveCount(0);
  await jump(page, `/app/verifications/${vr}`);
  await expect(rowOf(main.getByRole("region", { name: `Dealer consent · ${vr}` }), "DOC-003")).toContainText("Declined");
  await expect(page.locator("body")).not.toContainText(LEDGER_CONFIRMED);
});

test("dealer consent pages: no serious axe violations; 390×844 keeps the table in its scroll region", async ({ page }, testInfo) => {
  await signIn(page, "Sales desk — Dealer Contributor");
  for (const path of ["/app/access", "/app/cases/CL-001/sharing"]) {
    await page.goto(path);
    await expect(page.locator("main h1").first()).toBeVisible();
    await expect(page.locator("main").getByRole("region", { name: /^Consent requests · / })).toBeVisible();
    await page.waitForLoadState("networkidle");
    if (isMobile(testInfo.project.use.viewport?.width)) {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, path).toBeLessThanOrEqual(0);
    } else {
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(blocking, `${path}: ${blocking.map((v) => `${v.id} (${v.nodes.length})`).join(", ")}`).toEqual([]);
    }
  }
});
