import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { crc32, deflateSync } from "node:zlib";
import { expect as baseExpect, test, type Browser, type Locator, type Page } from "@playwright/test";

// The whole journey from a CLEAN-START seed (organizations, parties, users and the registry only: no asset, no
// case) through the web UI only, against a real LOCALNET stack (Canton sandbox, API, worker, `next start` built
// with COLLARA_MODE=LOCALNET). Skipped unless E2E_MODE=LOCALNET:
//   E2E_MODE=LOCALNET PLAYWRIGHT_BASE_URL=http://localhost:3100 pnpm --filter @collara/web exec playwright test e2e/localnet-clean-start.spec.ts --project=desktop
// The walk changes the ledger, so it runs once per seed (`pnpm localnet:seed --prefix <p> --profile clean-start`).
// Record refs (asset, case, verification, review, pledge) are read from the UI, never assumed. Every persona signs
// in through /login (a new demo session each time = a re-login). Ledger actions wait for the committed command and
// its projection; the UI_MOCK simulated copy must never appear.
// E2E_STATE_FILE (optional, development only) keeps the discovered refs between invocations, so one phase can be
// re-run with -g on the same world after a fix.

test.skip(process.env.E2E_MODE !== "LOCALNET", "LOCALNET only: set E2E_MODE=LOCALNET and PLAYWRIGHT_BASE_URL to a LOCALNET web server");
test.describe.configure({ mode: "serial" });
test.setTimeout(600_000);
test.use({ actionTimeout: 30_000 });
const expect = baseExpect.configure({ timeout: 60_000 });

const LOCALNET_BANNER = "Synthetic demo data — Canton LocalNet.";
const MOCK_BANNER = "Synthetic demo data — UI mockup.";
const LEDGER_CONFIRMED = "Confirmed on the ledger.";
const SIMULATED = /Recorded in the UI mockup|UI simulation|No ledger transaction was submitted/;
const UNAVAILABLE = "This record is unavailable to your account.";
const RELEASE_PENDING = "Release requested. The collateral lock remains active.";
const ELIGIBLE = "Eligible for this lender and case. Financing is not yet active.";
const TERMS = [/100,000/, /100000/, /FP-\d{3}/];

const TEXT = {
  internal: "Clean-start internal note: maintenance gap explained by the dealer (synthetic).",
  shared: "Clean-start shared feedback: the evidence package is complete for this review (synthetic).",
  changes: "Please upload the full scoped inspection report (synthetic).",
  rrNote: "Clean-start release note: the external loan is repaid (synthetic).",
  question: "Clean-start question: please confirm the payoff date (synthetic).",
  response: "Clean-start response: paid off on the agreed date (synthetic).",
};
const NOTE_TEXTS = [TEXT.internal, TEXT.shared, TEXT.rrNote, TEXT.question, TEXT.response];

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

// --- Synthetic files (valid PDF / PNG magic bytes; every file says it is synthetic) ---------------------------

function syntheticPdf(title: string): Buffer {
  const body = `BT /F1 12 Tf 72 740 Td (SYNTHETIC DOCUMENT - Collara demo only) Tj 0 -24 Td (${title}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${body.length} >>\nstream\n${body}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

function syntheticPng(): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const typed = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typed) >>> 0);
    return Buffer.concat([length, typed, crc]);
  };
  const width = 64;
  const height = 48;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) raw.set([40 + x * 3, 80 + y * 2, 120], y * (width * 3 + 1) + 1 + x * 3);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

interface SyntheticFile {
  readonly type: string;
  readonly title: string;
  readonly name: string;
  readonly mimeType: "application/pdf" | "image/png";
  readonly buffer: Buffer;
}
const FILES = {
  invoice: { type: "DEALER_INVOICE", title: "Dealer invoice copy (synthetic)", name: "dealer-invoice-synthetic.pdf", mimeType: "application/pdf", buffer: syntheticPdf("Dealer invoice copy - DEMO-CNC-500 SYNTH-CNC-001") },
  photos: { type: "EQUIPMENT_PHOTOS", title: "Equipment photos (synthetic)", name: "equipment-photos-synthetic.png", mimeType: "image/png", buffer: syntheticPng() },
  inspection: { type: "INSPECTION_REPORT", title: "Inspection report (synthetic)", name: "inspection-report-v1-synthetic.pdf", mimeType: "application/pdf", buffer: syntheticPdf("Inspection report v1 - partial scope") },
  maintenance: { type: "MAINTENANCE_SUMMARY", title: "Maintenance summary (synthetic)", name: "maintenance-summary-synthetic.pdf", mimeType: "application/pdf", buffer: syntheticPdf("Maintenance summary - service log") },
} satisfies Record<string, SyntheticFile>;
const DEALER_INVOICE: SyntheticFile = { type: "DEALER_INVOICE", title: "Dealer invoice (synthetic, from the dealer)", name: "dealer-invoice-from-dealer-synthetic.pdf", mimeType: "application/pdf", buffer: syntheticPdf("Dealer invoice - issued by Demo CNC Dealer") };
const INSPECTION_V2: SyntheticFile = { ...FILES.inspection, name: "inspection-report-v2-synthetic.pdf", buffer: syntheticPdf("Inspection report v2 - full scope") };
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

// --- Refs discovered from the UI ------------------------------------------------------------------------------

interface WorldRefs {
  assetRef?: string;
  docs?: Record<string, string>;
  verificationRef?: string;
  attestationRef?: string;
  caseId?: string;
  reviewRef?: string;
  pledgeRef?: string;
}
const STATE_FILE = process.env.E2E_STATE_FILE;
const refs: WorldRefs = STATE_FILE && existsSync(STATE_FILE) ? (JSON.parse(readFileSync(STATE_FILE, "utf8")) as WorldRefs) : {};
function remember(update: Partial<WorldRefs>) {
  Object.assign(refs, update);
  if (STATE_FILE) writeFileSync(STATE_FILE, JSON.stringify(refs, null, 2));
}
function need<K extends keyof WorldRefs>(key: K): NonNullable<WorldRefs[K]> {
  const value = refs[key];
  if (value === undefined) throw new Error(`${key} was not discovered by an earlier phase`);
  return value as NonNullable<WorldRefs[K]>;
}

const steps: { name: string; ok: boolean }[] = [];
const step = (name: string) => steps.push({ name, ok: true });
test.afterAll(() => {
  console.log(`LOCALNET clean-start steps (${steps.length}):\n${steps.map((s, i) => `  ${String(i + 1).padStart(2)}. ${s.name}`).join("\n")}`);
  console.log(`LOCALNET clean-start refs: ${JSON.stringify(refs)}`);
});

// --- Helpers --------------------------------------------------------------------------------------------------

/** Signs in through the /login page with a new demo session for the persona (a re-login). */
async function signIn(page: Page, key: PersonaKey) {
  await page.goto("/login");
  const banner = page.getByRole("note", { name: "Environment" });
  await expect(banner).toContainText(LOCALNET_BANNER);
  await page.getByLabel(PERSONAS[key].label, { exact: true }).check();
  await page.getByRole("button", { name: "Continue to workspace" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(banner).toContainText(`Viewing as ${PERSONAS[key].viewing}.`);
  await expect(banner).not.toContainText(MOCK_BANNER);
  await expect(page.locator("body")).not.toContainText(SIMULATED);
}

async function confirmIn(dialog: Locator, name: string) {
  await dialog.getByRole("button", { name, exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 90_000 });
}

/** A titled Panel (a section whose heading is the title). */
function panel(scope: Locator, title: string): Locator {
  return scope.locator("section").filter({ has: scope.page().getByRole("heading", { name: title, exact: true }) }).last();
}

/** The tracked command is confirmed on the ledger with an update id and offset; never the simulated copy. */
async function expectLedgerConfirmed(page: Page, state: "PROJECTED" | "COMMITTED_OR_PROJECTED" = "PROJECTED"): Promise<string> {
  const selector = state === "PROJECTED" ? '[data-command-state="PROJECTED"]' : '[data-command-state="PROJECTED"], [data-command-state="COMMITTED"]';
  const status = page.locator(selector).first();
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

async function expectNoText(scope: Locator, patterns: readonly (string | RegExp)[]) {
  for (const pattern of patterns) await expect(scope).not.toContainText(pattern);
}

/** Uploads one synthetic file through the passport's Add evidence dialog (intent → bytes → finalize). */
async function addEvidence(page: Page, assetRef: string, file: SyntheticFile, replaces?: string) {
  const main = page.locator("main");
  await main.getByRole("button", { name: "Add evidence" }).first().click();
  const dialog = page.getByRole("alertdialog", { name: `Add evidence · ${assetRef}` });
  if (replaces) await dialog.getByLabel("Document", { exact: true }).selectOption({ label: replaces });
  else {
    await dialog.getByLabel("Document type").selectOption(file.type);
    await dialog.getByLabel("Title").fill(file.title);
  }
  await dialog.getByLabel("File").setInputFiles({ name: file.name, mimeType: file.mimeType, buffer: file.buffer });
  await confirmIn(dialog, "Upload document");
}

/** The evidence row of a document title in a table region. */
const docRow = (region: Locator, title: string) => region.getByRole("row").filter({ hasText: title });

/** Downloads through the UI's presigned link (opened in a new tab) and returns the bytes. */
async function downloadVia(page: Page, button: Locator): Promise<Buffer> {
  const linkRequest = page.context().waitForEvent("request", (r) => /X-Amz-Signature=/i.test(r.url()));
  const popup = page.context().waitForEvent("page").catch(() => null);
  await button.click();
  const signedUrl = (await linkRequest).url();
  const fetched = await page.request.get(signedUrl);
  expect(fetched.status()).toBe(200);
  await (await popup)?.close();
  return fetched.body();
}

async function withPersona<T>(browser: Browser, key: PersonaKey, run: (page: Page) => Promise<T>): Promise<T> {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await signIn(page, key);
    return await run(page);
  } finally {
    await context.close();
  }
}

test.skip(({ viewport }) => (viewport?.width ?? 1280) < 900, "the clean-start walkthrough runs on the desktop layout");

// --- 1 · Passport, evidence, verification ---------------------------------------------------------------------

test("1 · clean start has no asset or case; borrower registers the asset", async ({ page }) => {
  const main = page.locator("main");
  await signIn(page, "borrower");
  // Clean start: nothing registered, no case.
  await page.goto("/app/cases");
  await expect(main).toContainText("0 of 0 accessible cases");
  await page.goto("/app/assets");
  await expect(main.getByRole("link", { name: /^Open passport / })).toHaveCount(0);
  step("clean start: no asset, no case");

  await main.getByRole("link", { name: "Register asset" }).first().click();
  await expect(page).toHaveURL(/\/app\/assets\/new$/);
  await main.getByLabel("Equipment class").fill("CNC machining center");
  await main.getByLabel("Manufacturer").fill("Demo Machine Works (synthetic)");
  await main.getByLabel("Model").fill("DEMO-CNC-500");
  await main.getByLabel("Serial number").fill("SYNTH-CNC-001");
  await main.getByLabel("Year of manufacture (optional)").fill("2019");
  await main.getByLabel("Location scope").fill("Demo Manufacturer facility · Ohio, US (declared)");
  await main.getByRole("button", { name: "Register passport" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Register asset passport" });
  await expect(dialog).toContainText("CNC machining center · DEMO-CNC-500 · serial SYNTH-CNC-001");
  await confirmIn(dialog, "Register passport");
  await expect(page).toHaveURL(/\/app\/assets\/ASSET-[A-Z0-9-]+(\/overview)?$/, { timeout: 90_000 });
  const assetRef = /\/app\/assets\/(ASSET-[A-Z0-9-]+)/.exec(page.url())?.[1] ?? "";
  expect(assetRef).toMatch(/^ASSET-/);
  remember({ assetRef });
  await reloadUntil(page, () => page.getByRole("heading", { level: 1 }).filter({ hasText: /CNC machining center|DEMO-CNC-500|ASSET-/ }));
  await expect(main).toContainText("SYNTH-CNC-001");
  await expect(main).not.toContainText(SIMULATED);
  step(`asset registered on the ledger (${assetRef})`);
});

test("2 · borrower uploads the evidence documents on the passport", async ({ page }) => {
  const main = page.locator("main");
  const assetRef = need("assetRef");
  await signIn(page, "borrower");
  // Evidence: the four required document types, as the owner's own records.
  await page.goto(`/app/assets/${assetRef}/evidence`);
  const docs: Record<string, string> = {};
  for (const [key, file] of Object.entries(FILES)) {
    await addEvidence(page, assetRef, file);
    const region = main.getByRole("region", { name: `Evidence documents · ${assetRef}` });
    const row = docRow(region, file.title);
    await expect(row).toBeVisible();
    await expect(row).toContainText("v1");
    // Integrity: the server's SHA-256 of the uploaded bytes (shown shortened).
    const hash = sha256(file.buffer);
    await expect(row).toContainText(hash.slice(0, 8));
    docs[key] = (await row.innerText()).match(/DOC-\d{3}/)?.[0] ?? "";
    expect(docs[key]).toMatch(/^DOC-\d{3}$/);
  }
  remember({ docs });
  step(`evidence uploaded by the owner: ${Object.values(docs).join(", ")}`);
});

test("3 · borrower requests verification for SELECTED documents only", async ({ page }) => {
  const main = page.locator("main");
  const assetRef = need("assetRef");
  const docs = need("docs");
  await signIn(page, "borrower");
  // From the passport overview's permitted actions (the Verification section appears once a request exists).
  await page.goto(`/app/assets/${assetRef}`);
  const sections = page.getByRole("navigation", { name: "Passport sections" });
  await expect(sections.getByRole("link", { name: "Verification" })).toHaveCount(0);
  await main.getByRole("button", { name: "Request verification" }).click();
  const dialog = page.getByRole("alertdialog", { name: `Request verification · ${assetRef}` });
  await expect(dialog.getByLabel("Verifier (active in the registry)")).toHaveValue(/VER-\d{3}/);
  // Every available document starts selected; leave the dealer invoice copy out.
  const documents = dialog.getByRole("group", { name: "Documents shared with the verifier" });
  await expect(documents.getByRole("checkbox")).toHaveCount(4);
  await documents.getByRole("checkbox", { name: new RegExp(`${FILES.invoice.title.replace(/[()]/g, "\\$&")} · ${docs.invoice}`) }).uncheck();
  await expect(documents.getByRole("checkbox", { checked: true })).toHaveCount(3);
  await confirmIn(dialog, "Request verification");
  await expectLedgerConfirmed(page, "COMMITTED_OR_PROJECTED");
  await page.goto(`/app/assets/${assetRef}/verification`);
  const table = () => main.getByRole("region", { name: `Verification requests · ${assetRef}` });
  await reloadUntil(page, () => table().getByRole("link", { name: /^VR-\d{3}$/ }));
  const verificationRef = (await table().getByRole("link", { name: /^VR-\d{3}$/ }).first().innerText()).trim();
  remember({ verificationRef });
  await expect(table().getByRole("row").filter({ hasText: verificationRef })).toContainText("Requested");
  step(`verification requested (${verificationRef}) with 3 of 4 documents`);
});

test("4 · verifier accepts, sees only the selected documents, downloads one, requests changes", async ({ page }) => {
  const main = page.locator("main");
  const verificationRef = need("verificationRef");
  const docs = need("docs");
  await signIn(page, "verifier");
  await page.goto("/app/verifications");
  await reloadUntil(page, () => main.getByRole("link", { name: `Open verification ${verificationRef}` }));
  await main.getByRole("link", { name: `Open verification ${verificationRef}` }).click();
  await expect(page).toHaveURL(new RegExp(`/app/verifications/${verificationRef}$`));
  await main.getByRole("button", { name: "Accept assignment" }).click();
  await confirmIn(page.getByRole("alertdialog", { name: `Accept assignment · ${verificationRef}` }), "Accept assignment");
  await expectLedgerConfirmed(page, "COMMITTED_OR_PROJECTED");
  await reloadUntil(page, () => main.getByRole("button", { name: "Request changes" }));
  step("verifier accepted the assignment");

  // Only the three selected documents; the unselected invoice copy never appears.
  const assigned = main.getByRole("region", { name: new RegExp(`^Assigned evidence · ${verificationRef} · `) });
  await expect(assigned.getByRole("row").filter({ hasText: /DOC-\d{3}/ })).toHaveCount(3);
  for (const key of ["photos", "inspection", "maintenance"] as const) await expect(docRow(assigned, FILES[key].title)).toContainText(docs[key] ?? "?");
  await expect(main).not.toContainText(FILES.invoice.title);
  await expect(main).not.toContainText(docs.invoice ?? "DOC-none");
  await expectNoText(main, TERMS);
  step("verifier lists only the 3 selected documents");

  const bytes = await downloadVia(page, assigned.getByRole("button", { name: `Download ${FILES.inspection.title} v1` }));
  expect(bytes.length).toBe(FILES.inspection.buffer.length);
  expect(sha256(bytes)).toBe(sha256(FILES.inspection.buffer));
  expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  step(`verifier downloaded ${FILES.inspection.title} v1 (${bytes.length} bytes, SHA-256 matches the upload)`);

  await main.getByRole("button", { name: "Request changes" }).click();
  const dialog = page.getByRole("alertdialog", { name: `Request changes · ${verificationRef}` });
  await dialog.getByLabel("What needs to change").fill(TEXT.changes);
  await confirmIn(dialog, "Request changes");
  await expectLedgerConfirmed(page, "COMMITTED_OR_PROJECTED");
  await reloadUntil(page, () => page.getByRole("heading", { level: 1 }).locator("..").getByText("Changes requested"));
  step("verifier requested changes");
});

test("5 · borrower uploads a new version and resubmits; verifier attests on the reviewed versions", async ({ page }) => {
  const main = page.locator("main");
  const assetRef = need("assetRef");
  const verificationRef = need("verificationRef");
  const docs = need("docs");
  await signIn(page, "borrower");
  await page.goto(`/app/verifications/${verificationRef}`);
  await expect(main).toContainText(TEXT.changes);
  await main.getByRole("link", { name: "Add a new evidence version" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/assets/${assetRef}/evidence$`));
  await addEvidence(page, assetRef, INSPECTION_V2, `New version of ${FILES.inspection.title} (${docs.inspection} v1)`);
  const region = main.getByRole("region", { name: `Evidence documents · ${assetRef}` });
  await expect(docRow(region, FILES.inspection.title)).toContainText("v2");
  await expect(docRow(region, FILES.inspection.title)).toContainText(sha256(INSPECTION_V2.buffer).slice(0, 8));
  step(`owner uploaded ${docs.inspection} v2`);

  await page.goto(`/app/verifications/${verificationRef}`);
  await main.getByRole("button", { name: "Submit new evidence" }).click();
  const dialog = page.getByRole("alertdialog", { name: `Submit new evidence · ${verificationRef}` });
  const selection = dialog.getByRole("group", { name: "Documents shared with the verifier" });
  await expect(selection.getByRole("checkbox", { checked: true })).toHaveCount(3);
  await expect(selection.getByRole("checkbox", { name: new RegExp(`${docs.invoice} v1`) })).not.toBeChecked();
  await confirmIn(dialog, "Submit evidence");
  await expectLedgerConfirmed(page, "COMMITTED_OR_PROJECTED");
  await reloadUntil(page, () => page.getByRole("heading", { level: 1 }).locator("..").getByText("In review"));
  step("owner resubmitted the evidence (new package version)");

  await signIn(page, "verifier");
  await page.goto(`/app/verifications/${verificationRef}`);
  const assigned = main.getByRole("region", { name: new RegExp(`^Assigned evidence · ${verificationRef} · `) });
  await reloadUntil(page, () => docRow(assigned, FILES.inspection.title).getByText("v2", { exact: true }));
  await expect(assigned.getByRole("row").filter({ hasText: /DOC-\d{3}/ })).toHaveCount(3);
  await expect(main).not.toContainText(FILES.invoice.title);
  await main.getByRole("button", { name: "Submit attestation" }).click();
  const attest = page.getByRole("alertdialog", { name: `Submit attestation · ${verificationRef}` });
  await confirmIn(attest, "Submit attestation");
  await expectLedgerConfirmed(page, "COMMITTED_OR_PROJECTED");
  const attestation = main.getByRole("region", { name: "Attestation" });
  await reloadUntil(page, () => attestation.getByText(/^ATT-\d{3}$/));
  const attestationRef = (await attestation.getByText(/^ATT-\d{3}$/).first().innerText()).trim();
  remember({ attestationRef });
  // The reviewed versions: the inspection report at v2, the photos and the maintenance summary at v1; no invoice.
  const supporting = attestation.getByRole("definition").filter({ hasText: FILES.inspection.title });
  await expect(supporting).toContainText(`${FILES.inspection.title} v2`);
  await expect(supporting).toContainText(`${FILES.photos.title} v1`);
  await expect(supporting).toContainText(`${FILES.maintenance.title} v1`);
  await expect(supporting).not.toContainText(FILES.invoice.title);
  step(`attestation ${attestationRef} issued on the reviewed versions`);

  await signIn(page, "borrower");
  await page.goto(`/app/assets/${assetRef}/verification`);
  await reloadUntil(page, () => main.getByText(attestationRef, { exact: true }));
  await expect(main).toContainText(`${FILES.inspection.title} v2`);
  step("owner sees the attestation and its supporting versions");
});

// --- 2 · Case, sharing, review --------------------------------------------------------------------------------

test("6 · borrower creates the case (Demo Lender A, USD 100,000.00) and shares the package", async ({ page }) => {
  const main = page.locator("main");
  const assetRef = need("assetRef");
  await signIn(page, "borrower");
  await page.goto("/app/cases");
  await main.getByRole("link", { name: "Create case" }).click();
  await expect(page).toHaveURL(/\/app\/cases\/new$/);
  await main.getByLabel("Case name").fill("Used CNC financing");
  await expect(main.getByLabel("Registered asset")).toHaveValue(assetRef);
  await main.getByLabel("Selected lender").selectOption({ label: "Demo Lender A" });
  await main.getByLabel("Invited dealer (optional)").selectOption({ label: "Demo CNC Dealer" });
  await main.getByLabel("Requested principal (optional)").fill("100000.00");
  await expect(main.getByLabel("Currency")).toHaveValue("USD");
  await main.getByRole("button", { name: "Review sharing" }).click();
  await expect(page).toHaveURL(/\/app\/cases\/CL-\d{3}\/sharing$/, { timeout: 90_000 });
  const caseId = /CL-\d{3}/.exec(page.url())?.[0] ?? "";
  remember({ caseId });
  await expect(page.getByRole("heading", { level: 1 })).toContainText(caseId);
  step(`case ${caseId} created (application record, no ledger transaction)`);

  await main.getByRole("button", { name: "Share package with Demo Lender A" }).click();
  const dialog = page.getByRole("alertdialog", { name: `Share evidence package · ${caseId}` });
  await confirmIn(dialog, "Share package");
  await expectLedgerConfirmed(page);
  await reloadUntil(page, () => main.getByRole("region", { name: `Sharing and access · ${caseId}` }).getByRole("row").filter({ hasText: "Demo Lender A" }));
  step("package shared with Demo Lender A (share, control view, attestation disclosure)");

  // The invited dealer sees the case it was invited to (before it holds any contract of it), never the terms.
  await signIn(page, "dealer");
  await page.goto("/app/cases");
  await reloadUntil(page, () => main.getByRole("link", { name: caseId }));
  await main.getByRole("link", { name: caseId }).first().click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(caseId);
  await expect(panel(main, "Participants")).toContainText("Dealer · contributor");
  await expectNoText(main, TERMS);
  step("invited dealer opens the case: participants only, no principal or terms");
});

test("7 · lender analyst opens the case, saves the assessment with notes and submits it", async ({ page }) => {
  const main = page.locator("main");
  const caseId = need("caseId");
  await signIn(page, "analyst");
  await page.goto("/app/cases");
  await reloadUntil(page, () => main.getByRole("link", { name: caseId }));
  await main.getByRole("link", { name: caseId }).first().click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(caseId);
  // The first open creates the lender's own review record; it appears once projected.
  await page.goto(`/app/cases/${caseId}/review`);
  await reloadUntil(page, () => main.getByRole("link", { name: /Open collateral review/ }));
  // The review is bound to the attested evidence: package v2 (after the resubmission), matching the attestation.
  await expect(main).toContainText(/v2 · matches attested versions/);
  await page.goto(`/app/cases/${caseId}/verification`);
  await expect(main.getByText(need("attestationRef"), { exact: true })).toBeVisible();
  await expect(main).toContainText(`${FILES.inspection.title} v2`);
  await expect(main).not.toContainText(FILES.invoice.title);
  step("lender sees the disclosed attestation on the reviewed versions; review snapshot matches it");
  await page.goto(`/app/cases/${caseId}/review`);
  await main.getByRole("link", { name: /Open collateral review/ }).click();
  await expect(page).toHaveURL(/\/app\/reviews\/CA-\d{3}/);
  const reviewRef = /CA-\d{3}/.exec(page.url())?.[0] ?? "";
  remember({ reviewRef });
  await expect(page.getByRole("heading", { level: 1 })).toContainText(`Collateral review · ${caseId}`);
  await expect(main.locator("header").first()).toContainText("CNC machining center · DEMO-CNC-500");

  await page.goto(`/app/reviews/${reviewRef}/assessment`);
  await main.getByRole("button", { name: "Start review" }).click();
  const dialog = page.getByRole("alertdialog", { name: `Start collateral review · ${caseId}` });
  await dialog.getByLabel("Valuation amount").fill("150000.00");
  await dialog.getByLabel("Valuation source").fill("Synthetic desk valuation (demo)");
  await dialog.getByLabel("Internal assessment notes").fill(TEXT.internal);
  await dialog.getByLabel("Feedback shared with the borrower").fill(TEXT.shared);
  await dialog.getByLabel("Collateral outcome").selectOption("ELIGIBLE");
  await confirmIn(dialog, "Start review");
  await reloadUntil(page, () => panel(main, "Collateral valuation").getByText("150,000.00"));
  await expect(panel(main, "Requested principal")).toContainText("100,000.00");
  await expect(panel(main, "Collateral valuation")).not.toContainText("100,000.00");
  await expect(main.getByText(TEXT.internal)).toBeVisible();
  await expect(main.getByText(TEXT.shared)).toBeVisible();
  step(`assessment saved (${reviewRef}) with internal notes and shared feedback`);

  // Refresh: the notes come back from the private note store.
  await page.reload();
  await expect(main.getByText(TEXT.internal)).toBeVisible();
  await expect(main.getByText(TEXT.shared)).toBeVisible();

  await page.getByRole("button", { name: "Submit for approval" }).click();
  await confirmIn(page.getByRole("alertdialog", { name: `Submit assessment for approval · ${caseId}` }), "Submit for approval");
  await page.getByRole("navigation", { name: "Review sections" }).getByRole("link", { name: "Decision" }).click();
  await reloadUntil(page, () => main.getByText("Your mandate (Lender Analyst) does not include collateral approval."));
  await expect(main.getByRole("button", { name: "Approve eligibility" })).toHaveCount(0);
  step("assessment submitted for approval");
});

// --- 3 · Decision, proposal, activation -----------------------------------------------------------------------

test("8 · approver records eligible and issues the proposal; borrower accepts the exact version and authorizes", async ({ page }) => {
  const main = page.locator("main");
  const caseId = need("caseId");
  const reviewRef = need("reviewRef");
  await signIn(page, "approver");
  await page.goto(`/app/reviews/${reviewRef}/decision`);
  await main.getByRole("button", { name: "Approve eligibility" }).click();
  await confirmIn(page.getByRole("alertdialog", { name: `Approve collateral eligibility · ${caseId}` }), "Approve eligibility");
  await reloadUntil(page, () => main.getByText(ELIGIBLE));
  step("approver recorded ELIGIBLE");

  await page.goto(`/app/cases/${caseId}/proposal`);
  await main.getByRole("button", { name: "Issue proposal" }).click();
  const issue = page.getByRole("alertdialog", { name: `Issue financing proposal · ${caseId}` });
  await expect(issue.getByLabel("Principal")).toHaveValue("100000.00");
  await confirmIn(issue, "Issue proposal");
  await expectLedgerConfirmed(page);
  await reloadUntil(page, () => main.getByText(/FP-\d{3} · v1/));
  const proposalRef = (await main.getByText(/FP-\d{3} · v1/).first().innerText()).match(/FP-\d{3}/)?.[0] ?? "";
  step(`proposal ${proposalRef} v1 issued`);

  await signIn(page, "borrower");
  await page.goto(`/app/cases/${caseId}/proposal`);
  await reloadUntil(page, () => main.getByRole("button", { name: "Accept v1" }));
  await main.getByRole("button", { name: "Accept v1" }).click();
  const accept = page.getByRole("alertdialog", { name: `Accept proposal ${proposalRef} · exact version v1` });
  await expect(accept).toContainText("Accepting this workflow proposal does not itself disburse funds or replace executed financing documents.");
  await confirmIn(accept, "Accept this version");
  await expectLedgerConfirmed(page);
  step("borrower accepted the exact version v1");

  await page.getByRole("navigation", { name: "Case sections" }).getByRole("link", { name: "Pledge", exact: true }).click();
  await reloadUntil(page, () => main.getByRole("button", { name: "Authorize pledge activation" }));
  await main.getByRole("button", { name: "Authorize pledge activation" }).click();
  await confirmIn(page.getByRole("alertdialog", { name: `Authorize pledge activation · ${caseId}` }), "Authorize activation");
  await expectLedgerConfirmed(page);
  await expect(main.getByRole("button", { name: "Authorize pledge activation" })).toHaveCount(0);
  step("borrower authorized activation");
});

test("9 · approver activates the pledge (committed and projected; ledger update id shown)", async ({ page }) => {
  const main = page.locator("main");
  const caseId = need("caseId");
  await signIn(page, "approver");
  await page.goto(`/app/cases/${caseId}/pledge`);
  await reloadUntil(page, () => main.getByRole("button", { name: "Activate pledge" }));
  await main.getByRole("button", { name: "Activate pledge" }).click();
  await confirmIn(page.getByRole("alertdialog", { name: `Activate pledge · ${caseId}` }), "Activate pledge");
  const update = await expectLedgerConfirmed(page);
  expect(update).toMatch(/^[0-9a-f]{6}$/);
  await reloadUntil(page, () => main.getByText(/Lock and activation evidence · PL-\d{3}/));
  const pledgeRef = (await main.getByText(/Lock and activation evidence · PL-\d{3}/).first().innerText()).match(/PL-\d{3}/)?.[0] ?? "";
  remember({ pledgeRef });
  await expect(main.getByRole("button", { name: "Activate pledge" })).toHaveCount(0);
  step(`pledge ${pledgeRef} activated (update ${update}…)`);
});

test("10 · Overview: per-currency recorded figures only for entitled viewers", async ({ page, browser }) => {
  const figures = page.getByRole("region", { name: "Recorded figures" });
  await signIn(page, "approver");
  await expect(figures.getByRole("list", { name: "Recorded financing principal by currency" })).toContainText("100,000.00");
  await expect(figures.getByRole("list", { name: "Recorded financing principal by currency" })).toContainText("USD");
  await expect(figures.getByRole("list", { name: "Recorded collateral valuation by currency" })).toContainText("150,000.00");
  await expect(figures).toContainText("1 of 1 active pledge with a recorded principal.");
  await expect(figures).not.toContainText(SIMULATED);
  step("approver: principal USD 100,000.00 and valuation USD 150,000.00, separately");

  await signIn(page, "borrower");
  await expect(figures.getByRole("list", { name: "Recorded financing principal by currency" })).toContainText("100,000.00");
  await expect(figures).not.toContainText("Recorded collateral valuation");
  await expect(figures).not.toContainText("150,000.00");
  step("borrower: principal only, no valuation");

  await signIn(page, "lenderB");
  await expect(figures).toContainText("No active pledges in your organization's scope.");
  await expectNoText(page.locator("main"), [/100,000/, /150,000/]);
  step("Lender B: nothing recorded in its scope");

  for (const key of ["verifier", "dealer", "auditor"] as const) {
    await withPersona(browser, key, async (p) => {
      await p.waitForLoadState("networkidle");
      await expect(p.getByRole("region", { name: "Recorded figures" })).toHaveCount(0);
      await expectNoText(p.locator("main"), [/100,000/, /150,000/]);
    });
    step(`${key}: no recorded figures`);
  }
});

// --- 4 · Release, audit ---------------------------------------------------------------------------------------

test("11 · release with a note, an information request and a response; approver authorizes", async ({ page }) => {
  const main = page.locator("main");
  const pledgeRef = need("pledgeRef");
  const assetRef = need("assetRef");
  await signIn(page, "borrower");
  await page.goto(`/app/pledges/${pledgeRef}`);
  await main.getByRole("button", { name: "Request release" }).click();
  let dialog = page.getByRole("alertdialog", { name: `Request release · ${pledgeRef}` });
  await expect(dialog.getByLabel("Reason")).toHaveValue("EXTERNAL_LOAN_COMPLETION");
  await dialog.getByLabel("Note to the lender (optional)").fill(TEXT.rrNote);
  await confirmIn(dialog, "Request release");
  await reloadUntil(page, () => main.getByText(RELEASE_PENDING));
  const thread = main.getByRole("region", { name: /Notes and questions · RR-\d{3}/ });
  await expect(thread).toContainText(TEXT.rrNote);
  await expect(main.getByRole("button", { name: "Authorize release" })).toHaveCount(0);
  step("borrower requested release with a note (lock still active)");

  await signIn(page, "approver");
  await page.goto(`/app/pledges/${pledgeRef}`);
  await expect(thread).toContainText(TEXT.rrNote);
  await main.getByRole("button", { name: "Request information" }).click();
  dialog = page.getByRole("alertdialog", { name: /Request information · RR-\d{3}/ });
  await dialog.getByLabel("Information needed").fill(TEXT.question);
  await confirmIn(dialog, "Send request");
  await reloadUntil(page, () => thread.getByText(TEXT.question));
  step("approver requested information with a question");

  await signIn(page, "borrower");
  await page.goto(`/app/pledges/${pledgeRef}`);
  await reloadUntil(page, () => main.getByRole("button", { name: "Respond to the lender" }));
  await main.getByRole("button", { name: "Respond to the lender" }).click();
  dialog = page.getByRole("alertdialog", { name: /Respond to information request · RR-\d{3}/ });
  await dialog.getByLabel("Response").fill(TEXT.response);
  await confirmIn(dialog, "Send response");
  await reloadUntil(page, () => thread.getByText(TEXT.response));
  step("borrower responded");

  await signIn(page, "approver");
  await page.goto(`/app/pledges/${pledgeRef}`);
  await expect(thread.getByRole("listitem")).toHaveCount(3);
  await reloadUntil(page, () => main.getByRole("button", { name: "Authorize release" }));
  await main.getByRole("button", { name: "Authorize release" }).click();
  dialog = page.getByRole("alertdialog", { name: `Authorize release of ${pledgeRef}` });
  await expect(dialog).toContainText("This releases the Collara workflow lock. Any required legal lien termination must be completed separately.");
  await confirmIn(dialog, "Authorize release");
  await reloadUntil(page, () => page.getByRole("heading", { level: 1 }).locator("..").getByText("Released"));
  step("approver authorized the release (pledge Released)");

  // Control available again on the owner's passport.
  await signIn(page, "borrower");
  await page.goto(`/app/assets/${assetRef}`);
  const control = () => main.locator("dt", { hasText: "Collateral control" }).locator("xpath=following-sibling::dd[1]");
  await reloadUntil(page, () => control().getByText("Available", { exact: true }));
  await expect(control()).not.toContainText(pledgeRef);
  step("collateral control available again");
});

test("12 · borrower and lender grant audit access; the auditor exports and downloads the report", async ({ page }) => {
  const main = page.locator("main");
  const caseId = need("caseId");
  for (const owner of ["borrower", "approver"] as const) {
    await signIn(page, owner);
    await page.goto(`/app/access?caseId=${caseId}`);
    await main.getByRole("button", { name: "Grant audit access" }).click();
    const dialog = page.getByRole("alertdialog", { name: "Grant audit access" });
    await expect(dialog.getByLabel("Case")).toHaveValue(caseId);
    await confirmIn(dialog, "Grant access");
    await reloadUntil(page, () =>
      main.getByRole("region", { name: `Access grants · ${caseId}` }).getByRole("row").filter({ hasText: "Audit grant" }).filter({ hasText: "Demo Auditor" }),
    );
    step(`${owner} granted audit access`);
  }

  await signIn(page, "auditor");
  await page.goto("/app/audit/exports");
  await page.getByRole("button", { name: "Export case report" }).click();
  const dialog = page.getByRole("alertdialog", { name: `Export case report · ${caseId}` });
  await expect(dialog).toContainText("Case workflow report — not a legal title or lien certificate.");
  await confirmIn(dialog, "Generate export");
  const rowOf = () => main.getByRole("region", { name: "Export jobs" }).getByRole("row").filter({ hasText: caseId }).first();
  await reloadUntil(page, () => rowOf().getByRole("button", { name: /^Download RPT-/ }));
  const row = rowOf();
  await expect(row).toContainText(new RegExp(`RPT-\\d{4} · ${caseId}`));
  const [, head, tail] = (await row.innerText()).match(/sha256 ([0-9a-f]{6})…([0-9a-f]{6})/) ?? [];
  const bytes = await downloadVia(page, row.getByRole("button", { name: /^Download RPT-/ }));
  const sha = sha256(bytes);
  expect(sha.startsWith(head ?? "x") && sha.endsWith(tail ?? "x")).toBe(true);
  const report = JSON.parse(bytes.toString("utf8")) as { reportRef: string; watermark: string; schemaVersion: string };
  expect(report).toMatchObject({ watermark: LOCALNET_BANNER, schemaVersion: "collara.case-report/v1" });
  // The report holds no private note text.
  for (const text of NOTE_TEXTS) expect(bytes.toString("utf8")).not.toContain(text);
  step(`auditor exported and downloaded ${report.reportRef} (SHA-256 matches)`);
});

// --- 5 · Audiences after re-login -----------------------------------------------------------------------------

test("13 · the invited dealer adds its own invoice on the case; the owner sees it, the lender does not", async ({ page }) => {
  const main = page.locator("main");
  const caseId = need("caseId");
  const docs = need("docs");
  // In this passport-first order the dealer is invited only when the case is created, after the attestation: a
  // dealer document added before activation would change the evidence package (new manifest at share) and make the
  // attestation stale. Its contribution is therefore exercised once the journey is complete.
  await signIn(page, "dealer");
  await page.goto(`/app/cases/${caseId}/evidence`);
  const region = () => main.getByRole("region", { name: new RegExp(`^Evidence documents · ${caseId}`) });
  await expect(region()).toContainText("No evidence documents are visible to your organization.");
  await main.getByRole("button", { name: "Add evidence" }).click();
  const dialog = page.getByRole("alertdialog", { name: `Add evidence · ${caseId}` });
  await dialog.getByLabel("Document type").selectOption(DEALER_INVOICE.type);
  await dialog.getByLabel("Title").fill(DEALER_INVOICE.title);
  await dialog.getByLabel("File").setInputFiles({ name: DEALER_INVOICE.name, mimeType: DEALER_INVOICE.mimeType, buffer: DEALER_INVOICE.buffer });
  await confirmIn(dialog, "Upload document");
  const row = docRow(region(), DEALER_INVOICE.title);
  await expect(row).toContainText("Demo CNC Dealer");
  const dealerDoc = (await row.innerText()).match(/DOC-\d{3}/)?.[0] ?? "";
  expect(dealerDoc).toMatch(/^DOC-\d{3}$/);
  // Only its own record: none of the owner's documents.
  await expect(region().getByRole("row").filter({ hasText: /DOC-\d{3}/ })).toHaveCount(1);
  for (const id of Object.values(docs)) await expect(region()).not.toContainText(id);
  const bytes = await downloadVia(page, row.getByRole("button", { name: `Download ${DEALER_INVOICE.title} v1` }));
  expect(sha256(bytes)).toBe(sha256(DEALER_INVOICE.buffer));
  await expectNoText(main, TERMS);
  step(`invited dealer added ${dealerDoc} on the case (only its own record listed; download matches)`);

  await signIn(page, "borrower");
  await page.goto(`/app/cases/${caseId}/evidence`);
  await expect(docRow(region(), DEALER_INVOICE.title)).toContainText("Demo CNC Dealer");
  step("owner sees the dealer's record with its source");

  await signIn(page, "analyst");
  await page.goto(`/app/cases/${caseId}/evidence`);
  await expect(region().getByRole("row").filter({ hasText: /DOC-\d{3}/ }).first()).toBeVisible();
  await expect(region()).not.toContainText(DEALER_INVOICE.title);
  await expect(region()).not.toContainText(dealerDoc);
  step("lender does not see the dealer's unshared record");
});

test("14 · re-login: notes reach the right parties only; no terms for verifier/dealer; Lender B sees nothing", async ({ page }) => {
  const main = page.locator("main");
  const caseId = need("caseId");
  const reviewRef = need("reviewRef");
  const pledgeRef = need("pledgeRef");
  const assetRef = need("assetRef");
  const verificationRef = need("verificationRef");

  await signIn(page, "analyst");
  await page.goto(`/app/reviews/${reviewRef}/assessment`);
  await expect(main.getByText(TEXT.internal)).toBeVisible();
  await expect(main.getByText(TEXT.shared)).toBeVisible();
  step("analyst (re-login): internal notes and shared feedback");

  await signIn(page, "borrower");
  await page.goto(`/app/cases/${caseId}/review`);
  await expect(main.getByText(TEXT.shared).first()).toBeVisible();
  await expect(main).not.toContainText(TEXT.internal);
  await page.goto(`/app/pledges/${pledgeRef}`);
  const thread = main.getByRole("region", { name: /Notes and questions · RR-\d{3}/ });
  await expect(thread.getByRole("listitem")).toHaveCount(3);
  await expect(thread.getByRole("listitem").nth(0)).toContainText(TEXT.rrNote);
  await expect(thread.getByRole("listitem").nth(1)).toContainText(TEXT.question);
  await expect(thread.getByRole("listitem").nth(2)).toContainText(TEXT.response);
  step("borrower (re-login): shared feedback, never internal notes; release thread");

  const caseUrls = ["/app", "/app/cases", `/app/cases/${caseId}/summary`, `/app/cases/${caseId}/review`, `/app/cases/${caseId}/proposal`, `/app/cases/${caseId}/pledge`, `/app/cases/${caseId}/activity`, `/app/pledges/${pledgeRef}`, `/app/reviews/${reviewRef}/assessment`];
  for (const key of ["verifier", "dealer"] as const) {
    await signIn(page, key);
    for (const url of [...caseUrls, `/app/assets/${assetRef}`, `/app/verifications/${verificationRef}`]) {
      await page.goto(url);
      await page.waitForLoadState("networkidle");
      await expectNoText(page.locator("body"), [...TERMS, ...NOTE_TEXTS, SIMULATED, MOCK_BANNER]);
    }
    step(`${key}: no principal, proposal terms or notes on ${caseUrls.length + 2} pages`);
  }

  await signIn(page, "auditor");
  for (const url of [`/app/cases/${caseId}/summary`, `/app/cases/${caseId}/review`, `/app/pledges/${pledgeRef}`, `/app/reviews/${reviewRef}/assessment`, `/app/audit?caseId=${caseId}`]) {
    await page.goto(url);
    await page.waitForLoadState("networkidle");
    await expectNoText(main, NOTE_TEXTS);
  }
  step("auditor: no note text");

  await signIn(page, "lenderB");
  await page.goto("/app/cases");
  await expect(page.getByRole("table", { name: /Cases ·/ })).toBeVisible();
  await expect(main.getByRole("link", { name: caseId })).toHaveCount(0);
  await expect(main).toContainText("0 of 0 accessible cases");
  await expect(page.getByRole("navigation", { name: "Saved views" })).not.toContainText(/[1-9]/);
  for (const url of [`/app/cases/${caseId}/summary`, `/app/cases/${caseId}/review`, `/app/pledges/${pledgeRef}`, `/app/reviews/${reviewRef}/assessment`, `/app/assets/${assetRef}`, `/app/verifications/${verificationRef}`, `/app/audit?caseId=${caseId}`]) {
    await page.goto(url);
    await expect(main.getByRole("alert")).toContainText(UNAVAILABLE);
    await expectNoText(main, ["Demo Manufacturer", "SYNTH-CNC-001", ...TERMS, ...NOTE_TEXTS]);
  }
  await page.goto("/app/pledges");
  await expect(main.getByRole("link", { name: `Open pledge ${pledgeRef}` })).toHaveCount(0);
  step("Lender B: no case in list or counts; 7 direct URLs unavailable");
});
