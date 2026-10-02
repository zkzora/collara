// LocalNet IT (LOCALNET_IT=1): case creation and the Overview figures through the API only, on a fresh
// "cc-<unique>" prefix after the clean-start seed (registry, governance, VER-001, config; NO financing case, NO
// asset). The borrower registers an asset, reads the onboarded lender directory, creates a case with a selected
// lender (server-allocated ref), and the case is visible to the borrower only until the package is shared; Demo
// Lender B never sees it. The journey then runs to an ACTIVE pledge and checks GET /api/overview: one total per
// currency, only from facts the viewer may see (principal: borrower + selected lender; valuation: the lender's own
// assessment), unavailable ≠ 0, nothing for Lender B. Ledger state is asserted on the ACS where it matters.
import {
  AssetDetailSchema,
  CASE_CREATE_COPY,
  CaseDetailSchema,
  CaseListSchema,
  CL001_CHECKS,
  COMMAND_COPY,
  CommandStatusSchema,
  ERROR_COPY,
  OverviewSchema,
  pageSchema,
  ReviewSummarySchema,
} from "@collara/domain";
import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { cl001Files, type SyntheticFile } from "../../src/seed/documents";
import { LOCALNET_IT_ENABLED, startLocalnetHarness, type ItSession, type LocalnetHarness } from "./harness";

const DAY = 86_400_000;
const CommandBody = z.object({ command: CommandStatusSchema, result: z.unknown().optional() });
const PRINCIPAL = { amount: "100000.00", currency: "USD" } as const;
const VALUATION = { amount: "150000.00", currency: "USD" } as const;

describe.skipIf(!LOCALNET_IT_ENABLED)("LocalNet: create a case from a clean start; Overview figures per currency", () => {
  let h: LocalnetHarness;
  let owner: ItSession;
  let verifier: ItSession;
  let analyst: ItSession;
  let approver: ItSession;
  let lenderB: ItSession;
  let dealer: ItSession;
  let assetRef = "";
  let caseId = "";
  const docIds: string[] = [];
  const facts: Record<string, unknown> = {};

  function committed(response: LightMyRequestResponse, label: string) {
    expect(response.statusCode, `${label}: ${response.body}`).toBe(200);
    const body = CommandBody.parse(response.json());
    expect(body.command, label).toMatchObject({ state: "COMMITTED", simulated: false, message: COMMAND_COPY.COMMITTED });
    expect(body.command.updateId, label).toBeTruthy();
    return body;
  }
  const step = async (label: string, response: Promise<LightMyRequestResponse>) => {
    const body = committed(await response, label);
    await h.project();
    return body;
  };
  async function expectUnavailable(session: ItSession, path: string) {
    const response = await session.inject("GET", path);
    expect(response.statusCode, `${path}: ${response.body}`).toBe(404);
    expect(response.json()).toMatchObject({ code: "unavailable", detail: ERROR_COPY.UNAVAILABLE });
  }
  const overview = async (session: ItSession) => {
    const response = await session.inject("GET", "/api/overview");
    expect(response.statusCode, response.body).toBe(200);
    return OverviewSchema.parse(response.json());
  };
  const caseIds = async (session: ItSession) => CaseListSchema.parse((await session.inject("GET", "/api/cases")).json()).items.map((c) => c.caseId);

  async function upload(file: SyntheticFile) {
    const intent = await owner.inject("POST", "/api/evidence/upload-intents", {
      body: { assetRef, caseId, type: file.type, title: file.title, fileName: file.fileName, contentType: file.contentType, sizeBytes: file.bytes.length },
    });
    expect([200, 201], intent.body).toContain(intent.statusCode);
    const { evidenceId } = (intent.json() as { result: { evidenceId: string } }).result;
    const content = await owner.inject("PUT", `/api/evidence/${evidenceId}/content`, { body: file.bytes, headers: { "content-type": file.contentType } });
    expect(content.statusCode, content.body).toBe(200);
    const finalize = await owner.inject("POST", `/api/evidence/${evidenceId}/finalize`, { body: {} });
    expect(finalize.statusCode, finalize.body).toBe(200);
    return evidenceId;
  }

  beforeAll(async () => {
    // Memory storage: this file is about cases and figures; evidence bytes do not need the shared S3 store.
    h = await startLocalnetHarness({ prefixBase: "cc", storage: "memory" });
    facts.prefix = h.prefix;
    const seed = await h.seed("clean-start");
    facts.cleanStartMs = seed.totalMs;
    [owner, verifier, analyst, approver, lenderB, dealer] = await Promise.all([
      h.loginAs("manufacturer-owner"),
      h.loginAs("verifier-inspector"),
      h.loginAs("lender-a-analyst"),
      h.loginAs("lender-a-approver"),
      h.loginAs("lender-b-approver"),
      h.loginAs("dealer-contributor"),
    ]);
    await h.project();
  });

  afterAll(async () => {
    console.log(`LocalNet create-case IT facts: ${JSON.stringify(facts, null, 2)}`);
    await h?.close();
  });

  it("starts clean: no case, no asset, nothing recorded (Not available, never 0)", async () => {
    for (const session of [owner, approver, lenderB]) expect(await caseIds(session)).toEqual([]);
    expect((await owner.inject("GET", "/api/assets")).json()).toMatchObject({ items: [] });
    expect(await h.acsAs("borrower", "AssetPassport", (p) => p.namespace === h.namespace)).toHaveLength(0);
    const borrower = await overview(owner);
    expect(borrower.principal).toMatchObject({ totals: [], coverage: { included: 0, of: 0 }, dates: null });
    expect(borrower.valuation).toBeNull();
    const lender = await overview(approver);
    expect(lender.principal?.totals).toEqual([]);
    expect(lender.valuation?.totals).toEqual([]);
    expect(await overview(verifier)).toMatchObject({ principal: null, valuation: null });
    expect((await h.inject("GET", "/api/overview")).statusCode).toBe(401);
  });

  it("serves the onboarded directory (id + name only) to signed-in members", async () => {
    expect((await h.inject("GET", "/api/directory/lenders")).statusCode).toBe(401);
    expect((await owner.inject("GET", "/api/directory/lenders")).json()).toEqual([
      { id: "demo-lender-a", name: "Demo Lender A" },
      { id: "demo-lender-b", name: "Demo Lender B" },
    ]);
    expect((await owner.inject("GET", "/api/directory/dealers")).json()).toEqual([{ id: "demo-cnc-dealer", name: "Demo CNC Dealer" }]);
  });

  it("borrower registers an asset through the API; the passport offers Create case", async () => {
    const registered = committed(
      await owner.inject("POST", "/api/assets", {
        body: {
          intent: "REGISTER",
          equipmentClass: "CNC machining center",
          manufacturer: "Demo Machine Works (synthetic)",
          model: "DEMO-CNC-500",
          serialNumber: "SYNTH-CNC-001",
          yearOfManufacture: 2019,
          locationScope: "Demo Manufacturer facility (declared)",
        },
      }),
      "register",
    );
    assetRef = (registered.result as { assetRef: string }).assetRef;
    facts.assetRef = assetRef;
    await h.project();
    const detail = AssetDetailSchema.parse((await owner.inject("GET", `/api/assets/${assetRef}`)).json());
    expect(detail).toMatchObject({ ref: assetRef, lifecycle: { value: "REGISTERED" }, cases: [] });
    expect(detail.allowedActions).toContain("case.create");
    // Not the owner: no Create case (and Lender B does not see the asset at all).
    await expectUnavailable(lenderB, `/api/assets/${assetRef}`);
  });

  it("creates the case with a selected lender: validated against the directory, server-allocated ref, one per asset", async () => {
    const body = { title: "Used CNC financing", assetRef, selectedLenderOrgId: "demo-lender-a", purpose: "Retooling line 2 (synthetic)", requestedPrincipal: { amount: "100000", currency: "USD" } };
    const wrongLender = await owner.inject("POST", "/api/cases", { body: { ...body, selectedLenderOrgId: "demo-cnc-dealer" } });
    expect(wrongLender.statusCode).toBe(400);
    expect(wrongLender.json()).toMatchObject({ code: "validation_error", issues: [{ path: "body.selectedLenderOrgId" }] });
    const badMoney = await owner.inject("POST", "/api/cases", { body: { ...body, requestedPrincipal: { amount: 100000, currency: "USD" } } });
    expect(badMoney.statusCode).toBe(400);
    // Lenders cannot create a case on someone else's asset (not visible to them: 404-shaped).
    for (const session of [approver, lenderB]) expect((await session.inject("POST", "/api/cases", { body })).statusCode).toBe(404);

    const created = await owner.inject("POST", "/api/cases", { body, idempotencyKey: "cc-create-case-0001" });
    expect(created.statusCode, created.body).toBe(201);
    const parsed = CommandBody.parse(created.json());
    expect(parsed.command).toMatchObject({ operation: "case.create", target: "APPLICATION", state: "COMMITTED", simulated: false });
    expect(parsed.command.updateId).toBeUndefined();
    expect(parsed.command.message).not.toBe(COMMAND_COPY.COMMITTED);
    caseId = (parsed.result as { caseId: string }).caseId;
    expect(caseId).toMatch(/^CL-\d{3}$/);
    facts.caseId = caseId;

    const replay = await owner.inject("POST", "/api/cases", { body, idempotencyKey: "cc-create-case-0001" });
    expect(replay.statusCode).toBe(200);
    expect(CommandBody.parse(replay.json()).result).toEqual({ caseId });
    const second = await owner.inject("POST", "/api/cases", { body: { ...body, title: "Again" } });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ detail: CASE_CREATE_COPY.ACTIVE_CASE });
    expect(AssetDetailSchema.parse((await owner.inject("GET", `/api/assets/${assetRef}`)).json()).allowedActions).not.toContain("case.create");

    // Visible to the borrower at once (application record); nothing on the ledger names the case yet.
    expect(await caseIds(owner)).toEqual([caseId]);
    const detail = CaseDetailSchema.parse((await owner.inject("GET", `/api/cases/${caseId}`)).json());
    expect(detail).toMatchObject({ caseId, title: "Used CNC financing", requestedPrincipal: PRINCIPAL, selectedLender: { id: "demo-lender-a" } });
    expect(detail.nextAction).not.toBeNull();
    facts.nextAction = detail.nextAction;
    // Creating a case shares nothing: the selected lender and Lender B do not see it.
    for (const session of [analyst, approver, lenderB, dealer]) {
      await expectUnavailable(session, `/api/cases/${caseId}`);
      expect(await caseIds(session)).toEqual([]);
    }
  });

  it("the selected lender sees the case only after the owner shares the package; Lender B never", async () => {
    const files = cl001Files();
    for (const file of [files.invoice, files.photos, files.inspectionV1, files.maintenance]) docIds.push(await upload(file));
    await step(
      "request verification",
      owner.inject("POST", `/api/cases/${caseId}/verification-requests`, {
        body: { verifierRegistryRef: "VER-001", scope: ["Serial number consistency", "Equipment photos"], documentIds: docIds, dueAt: new Date(Date.now() + 10 * DAY).toISOString() },
      }),
    );
    const verificationRef = z.object({ items: z.array(z.object({ ref: z.string() })) }).parse((await verifier.inject("GET", "/api/verifications")).json()).items[0]!.ref;
    await step("accept assignment", verifier.inject("POST", `/api/verifications/${verificationRef}/assignment`, { body: { decision: "ACCEPT" } }));
    await step(
      "issue attestation",
      verifier.inject("POST", `/api/verifications/${verificationRef}/attestations`, {
        body: {
          method: "On-site inspection + document review",
          inspectedAt: new Date(Date.now() - 60_000).toISOString(),
          validUntil: new Date(Date.now() + 180 * DAY).toISOString(),
          checks: CL001_CHECKS.map((c) => ({ item: c.item, finding: c.finding, result: c.result })),
          limitations: "Ownership and lien status were reviewed from submitted documents only.",
        },
      }),
    );
    // Still not shared: the lender has no stakeholder view of the case.
    await expectUnavailable(analyst, `/api/cases/${caseId}`);

    await step("share", owner.inject("POST", `/api/cases/${caseId}/sharing`, { body: { recipientOrgId: "demo-lender-a", permission: "VIEW_DOWNLOAD" } }));
    expect(await h.acsAs("lenderA", "PackageShare", (s) => s.caseRef === caseId)).toHaveLength(1);
    for (const template of ["PackageShare", "AssetControl", "AttestationDisclosure"] as const) expect(await h.acsAs("lenderB", template), template).toHaveLength(0);

    const lenderView = await analyst.inject("GET", `/api/cases/${caseId}`);
    expect(lenderView.statusCode, lenderView.body).toBe(200);
    expect(CaseDetailSchema.parse(lenderView.json())).toMatchObject({ caseId, requestedPrincipal: PRINCIPAL });
    await h.project();
    expect(await caseIds(analyst)).toEqual([caseId]);
    await expectUnavailable(lenderB, `/api/cases/${caseId}`);
    expect(await caseIds(lenderB)).toEqual([]);
  });

  it("Overview figures: per currency, only from visible facts, once the pledge is ACTIVE", async () => {
    await step(
      "save assessment",
      approver.inject("POST", `/api/cases/${caseId}/assessments`, {
        body: { valuation: VALUATION, valuationSource: "Synthetic desk valuation (demo)", valuationDate: new Date().toISOString().slice(0, 10), limitations: "", outcome: "ELIGIBLE", policyRef: "CP-2026-CNC-01" },
      }),
    );
    const reviewRef = pageSchema(ReviewSummarySchema).parse((await approver.inject("GET", "/api/reviews")).json()).items.find((r) => r.caseId === caseId)!.ref;
    await step("decide eligible", approver.inject("POST", `/api/reviews/${reviewRef}/decision`, { body: { outcome: "ELIGIBLE" } }));
    // An assessment alone is not a pledge: no figure yet, and the coverage says so.
    expect((await overview(approver)).valuation).toMatchObject({ totals: [], coverage: { of: 0 } });

    const issued = await step("issue proposal", approver.inject("POST", `/api/cases/${caseId}/proposals`, { body: { intent: "ISSUE", principal: PRINCIPAL } }));
    const proposalRef = (issued.result as { proposalRef: string }).proposalRef;
    await step("accept", owner.inject("POST", `/api/proposals/${proposalRef}/acceptance`, { body: { expectedVersion: 1 } }));
    await step("authorize activation", owner.inject("POST", `/api/proposals/${proposalRef}/activation-authorization`, { body: { expectedVersion: 1 } }));
    const activated = await step("activate pledge", approver.inject("POST", `/api/cases/${caseId}/pledge-activation`, { body: {} }));
    facts.pledgeRef = (activated.result as { pledgeRef: string }).pledgeRef;
    expect(await h.acsAs("lenderA", "CollateralLock", (l) => l.namespace === h.namespace && l.assetId === assetRef)).toHaveLength(1);

    const lender = await overview(approver);
    expect(lender.principal).toMatchObject({ totals: [{ total: PRINCIPAL, count: 1 }], coverage: { included: 1, of: 1 } });
    expect(lender.valuation).toMatchObject({ totals: [{ total: VALUATION, count: 1 }], coverage: { included: 1, of: 1 } });
    expect(lender.principal?.dates).not.toBeNull();
    expect(lender.lastSync.offset).not.toBeNull();
    expect(await overview(analyst)).toMatchObject({ principal: { totals: [{ total: PRINCIPAL }] }, valuation: { totals: [{ total: VALUATION }] } });

    const borrower = await overview(owner);
    expect(borrower.principal).toMatchObject({ totals: [{ total: PRINCIPAL, count: 1 }], coverage: { included: 1, of: 1 } });
    // Valuations are the lender's own records: never disclosed to the borrower.
    expect(borrower.valuation).toBeNull();

    const unrelated = await overview(lenderB);
    expect(unrelated.principal).toMatchObject({ totals: [], coverage: { included: 0, of: 0 }, dates: null });
    expect(unrelated.valuation).toMatchObject({ totals: [], coverage: { included: 0, of: 0 }, dates: null });
    expect(JSON.stringify(unrelated)).not.toMatch(/100000|150000|CL-\d{3}|PL-\d{3}/);
    for (const session of [verifier, dealer]) expect(await overview(session)).toMatchObject({ principal: null, valuation: null });
    facts.overview = { lender, borrower, unrelated };
  });
});
