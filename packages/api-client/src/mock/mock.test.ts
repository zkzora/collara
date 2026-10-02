import { describe, expect, it } from "vitest";
import { CaseDetailSchema, COMMAND_COPY, type CommandStatus, type PersonaId } from "@collara/domain";
import { ApiError } from "../errors";
import { createMockClient } from "./index";

const NOW = new Date("2026-11-15T12:00:00Z");
const INTERNAL_NOTE = "Internal: comparable sale data is thin for this model.";
const usd = (amount: string) => ({ amount, currency: "USD" });

function newClient(personaId: PersonaId = "lender-a-analyst") {
  return createMockClient({ personaId, now: new Date(NOW), latencyMs: 0 });
}

async function rejection(promise: Promise<unknown>): Promise<ApiError> {
  const error = await promise.then(
    () => {
      throw new Error("expected the call to fail");
    },
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ApiError);
  return error as ApiError;
}

function expectSimulated(command: CommandStatus) {
  expect(command.simulated).toBe(true);
  expect(command.updateId).toBeUndefined();
  expect(command.message).not.toBe(COMMAND_COPY.COMMITTED);
}

const assessment = {
  valuation: usd("150000.00"),
  valuationSource: "Verifier inspection report v2 · dealer invoice v1",
  valuationDate: "2026-09-10",
  limitations: "Desktop review of dealer invoice; no independent market comparables obtained.",
  internalNotes: INTERNAL_NOTE,
  sharedFeedback: "Evidence package reviewed.",
  outcome: "ELIGIBLE" as const,
  policyRef: "CP-2026-CNC-01",
};

/** Runs the MP L169 walkthrough up to (and including) the step named. */
async function walk(until: "eligible" | "accepted" | "activated" | "released" | "granted") {
  const client = newClient("lender-a-analyst");
  await client.cases.saveAssessment("CL-001", assessment);
  await client.reviews.submitForApproval("CA-001");
  client.setPersona("lender-a-approver");
  await client.reviews.decide("CA-001", { outcome: "ELIGIBLE", sharedFeedback: "Eligible for this case." });
  if (until === "eligible") return client;
  await client.cases.createProposal("CL-001", {
    intent: "ISSUE",
    principal: usd("100000.00"),
    termMetadata: "36 months · metadata only",
    financingRef: "LOAN-DEMO-001",
  });
  client.setPersona("manufacturer-owner");
  await client.proposals.accept("FP-001", { expectedVersion: 1 });
  if (until === "accepted") return client;
  await client.proposals.authorizeActivation("FP-001", { expectedVersion: 1 });
  client.setPersona("lender-a-approver");
  await client.cases.activatePledge("CL-001");
  if (until === "activated") return client;
  client.setPersona("manufacturer-owner");
  await client.pledges.requestRelease("PL-001", { reason: "EXTERNAL_LOAN_COMPLETION" });
  client.setPersona("lender-a-approver");
  await client.releaseRequests.decide("RR-001", { decision: "AUTHORIZE" });
  if (until === "released") return client;
  const expiresAt = "2027-01-31T00:00:00.000Z";
  client.setPersona("manufacturer-owner");
  await client.accessGrants.create({
    caseId: "CL-001",
    auditorOrgId: "demo-auditor",
    scopes: ["EVIDENCE_MANIFEST", "ATTESTATION", "PROPOSAL_TERMS", "PLEDGE_RELEASE_EVENTS"],
    permission: "VIEW_EXPORT",
    purpose: "Scoped audit",
    expiresAt,
  });
  client.setPersona("lender-a-approver");
  await client.accessGrants.create({
    caseId: "CL-001",
    auditorOrgId: "demo-auditor",
    scopes: ["DECISION_OUTCOME", "PROPOSAL_TERMS", "PLEDGE_RELEASE_EVENTS"],
    permission: "VIEW_EXPORT",
    purpose: "Scoped audit",
    expiresAt,
  });
  return client;
}

describe("mock client: main seed", () => {
  it("starts at the main seed: awaiting lender review, no proposal, no lock", async () => {
    const client = newClient("lender-a-approver");
    const detail = CaseDetailSchema.parse(await client.cases.get("CL-001"));
    expect(detail.stage?.value).toBe("LENDER_REVIEW");
    expect(detail.review?.label).toBe("Awaiting lender review");
    expect(detail.references.proposal).toBeNull();
    expect(detail.pledge?.value).toBe("AVAILABLE");
    expect(detail.requestedPrincipal).toEqual(usd("100000.00"));
    const list = await client.cases.list();
    expect(list.items).toHaveLength(5);
    expect(list.counts.all).toBe(5);
    expect((await client.me()).mode).toBe("UI_MOCK");
  });
});

describe("mock client: full walkthrough (MP L169)", () => {
  it("review → eligible → proposal → accept → authorize → activate → release request → authorize → audit grant → export", async () => {
    const client = newClient("lender-a-analyst");

    const saved = await client.cases.saveAssessment("CL-001", assessment);
    expectSimulated(saved.command);
    expect(saved.result.state.value).toBe("IN_REVIEW");
    expectSimulated((await client.reviews.submitForApproval("CA-001")).command);
    expect((await client.cases.get("CL-001")).nextActor?.label).toBe("Demo Lender A · Approver");

    // The analyst mandate cannot record the decision.
    expect((await rejection(client.reviews.decide("CA-001", { outcome: "ELIGIBLE" }))).code).toBe("forbidden");

    client.setPersona("lender-a-approver");
    expectSimulated((await client.reviews.decide("CA-001", { outcome: "ELIGIBLE" })).command);
    let detail = await client.cases.get("CL-001");
    expect(detail.stage?.value).toBe("PROPOSAL");
    expect(detail.nextAction?.code).toBe("ISSUE_PROPOSAL");

    const issued = await client.cases.createProposal("CL-001", { intent: "ISSUE", principal: usd("100000.00"), termMetadata: "36 months · metadata only" });
    expect(issued.result).toEqual({ proposalRef: "FP-001", version: 1 });

    client.setPersona("manufacturer-owner");
    expect((await client.proposals.get("FP-001")).principal).toEqual(usd("100000.00"));
    expect((await rejection(client.proposals.accept("FP-001", { expectedVersion: 2 }))).code).toBe("state_conflict");
    expectSimulated((await client.proposals.accept("FP-001", { expectedVersion: 1 })).command);
    expectSimulated((await client.proposals.authorizeActivation("FP-001", { expectedVersion: 1 })).command);

    client.setPersona("lender-a-approver");
    const activated = await client.cases.activatePledge("CL-001");
    expect(activated.result.pledgeRef).toBe("PL-001");
    let pledge = await client.pledges.get("PL-001");
    expect(pledge.lockState.value).toBe("ACTIVE");
    expect(pledge.technical).toMatchObject({ controlVersionConsumed: 3, controlVersionLocked: 4 });

    client.setPersona("manufacturer-owner");
    const rr = await client.pledges.requestRelease("PL-001", { reason: "EXTERNAL_LOAN_COMPLETION", servicingRef: "LOAN-DEMO-001" });
    expect(rr.result.releaseRequestRef).toBe("RR-001");
    pledge = await client.pledges.get("PL-001");
    expect(pledge.lockState.value).toBe("ACTIVE"); // a release request never unlocks
    expect(pledge.state.label).toBe("Active · release requested");
    expect((await client.cases.get("CL-001")).stage?.value).toBe("RELEASE_REVIEW");

    client.setPersona("lender-a-approver");
    expectSimulated((await client.releaseRequests.decide("RR-001", { decision: "AUTHORIZE" })).command);
    pledge = await client.pledges.get("PL-001");
    expect(pledge.state.value).toBe("RELEASED");
    expect(pledge.technical?.controlVersionAfterRelease).toBe(5);
    detail = await client.cases.get("CL-001");
    expect(detail.stage?.value).toBe("CLOSED");
    expect(detail.nextAction?.code).toBe("EXPORT_CASE_HISTORY");
    expect((await client.assets.get("ASSET-DEMO-001")).control).toMatchObject({ version: 5, lockRef: null });

    // The auditor sees nothing until each record owner grants a scope.
    client.setPersona("auditor");
    expect((await rejection(client.cases.get("CL-001"))).code).toBe("unavailable");
    const expiresAt = "2027-01-31T00:00:00.000Z";
    client.setPersona("manufacturer-owner");
    await client.accessGrants.create({
      caseId: "CL-001",
      auditorOrgId: "demo-auditor",
      scopes: ["EVIDENCE_MANIFEST", "ATTESTATION", "PROPOSAL_TERMS", "PLEDGE_RELEASE_EVENTS"],
      permission: "VIEW_EXPORT",
      purpose: "Scoped audit",
      expiresAt,
    });
    client.setPersona("lender-a-approver");
    expect(
      (await rejection(
        client.accessGrants.create({ caseId: "CL-001", auditorOrgId: "demo-auditor", scopes: ["EVIDENCE_MANIFEST"], permission: "VIEW", purpose: "x", expiresAt }),
      )).code,
    ).toBe("validation_error"); // the lender cannot grant the borrower's records
    await client.accessGrants.create({
      caseId: "CL-001",
      auditorOrgId: "demo-auditor",
      scopes: ["DECISION_OUTCOME", "PROPOSAL_TERMS", "PLEDGE_RELEASE_EVENTS"],
      permission: "VIEW_EXPORT",
      purpose: "Scoped audit",
      expiresAt,
    });

    client.setPersona("auditor");
    const auditorView = await client.cases.get("CL-001");
    expect(auditorView.allowedTabs).toEqual(["summary", "evidence", "verification", "review", "proposal", "pledge", "activity"]);
    const review = await client.reviews.get("CA-001");
    expect(review.internalNotes).toBeNull();
    expect(review.assessment).toBeNull();

    const report = await client.reports.create({ caseId: "CL-001", format: "JSON" });
    expect(report.result).toMatchObject({ ref: "RPT-0001", state: { value: "READY" }, label: "Case workflow report — not a legal title or lien certificate." });
    expect(report.result.checksum).toMatch(/^sha256 [0-9a-f]{64}$/);
    const download = await client.reports.download("RPT-0001");
    const content = decodeURIComponent(download.url.slice(download.url.indexOf(",") + 1));
    expect(content).toContain("Case workflow report");
    expect(content).toContain("FP-001");
    expect(content).not.toContain(INTERNAL_NOTE);
    expect(content).not.toContain("Assessment draft saved");
  });
});

describe("mock client: negative paths", () => {
  it("activates at most once, including concurrent attempts", async () => {
    const client = await walk("accepted");
    client.setPersona("manufacturer-owner");
    await client.proposals.authorizeActivation("FP-001", { expectedVersion: 1 });
    client.setPersona("lender-a-approver");
    const results = await Promise.allSettled([client.cases.activatePledge("CL-001"), client.cases.activatePledge("CL-001")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(failed.reason).toMatchObject({ code: "state_conflict" });
    expect((await rejection(client.cases.activatePledge("CL-001"))).code).toBe("state_conflict");
    expect((await client.pledges.list({ filter: "active" })).items.map((p) => p.ref)).toEqual(expect.arrayContaining(["PL-001"]));
  });

  it("refuses activation without the borrower's authorization", async () => {
    const client = await walk("accepted");
    client.setPersona("lender-a-approver");
    expect((await rejection(client.cases.activatePledge("CL-001"))).code).toBe("state_conflict");
  });

  it("never lets the borrower release; a rejected release leaves the lock active", async () => {
    const client = await walk("activated");
    client.setPersona("manufacturer-owner");
    await client.pledges.requestRelease("PL-001", { reason: "REFINANCING" });
    const denied = await rejection(client.releaseRequests.decide("RR-001", { decision: "AUTHORIZE" }));
    expect(denied).toMatchObject({ code: "forbidden", message: "Release requires the designated lender's authorization." });
    client.setPersona("lender-a-analyst");
    expect((await rejection(client.releaseRequests.decide("RR-001", { decision: "AUTHORIZE" }))).code).toBe("forbidden");
    client.setPersona("lender-a-approver");
    await client.releaseRequests.decide("RR-001", { decision: "REJECT", reason: "Repayment confirmation pending." });
    const pledge = await client.pledges.get("PL-001");
    expect(pledge.lockState.value).toBe("ACTIVE");
    expect(pledge.state.label).toBe("Active · release rejected");
    expect((await client.cases.get("CL-001")).stage?.value).toBe("PLEDGE_ACTIVE");
  });

  it("gives Demo Lender B nothing: 404-shaped errors, empty lists, zero counts", async () => {
    const client = await walk("granted");
    client.setPersona("lender-b-approver");
    for (const call of [
      client.cases.get("CL-001"),
      client.cases.evidence("CL-001"),
      client.proposals.get("FP-001"),
      client.pledges.get("PL-001"),
      client.reviews.get("CA-001"),
      client.releaseRequests.get("RR-001"),
      client.assets.get("ASSET-DEMO-001"),
      client.audit.events({ caseId: "CL-001" }),
      client.attestations.get("ATT-001"),
      client.evidence.download("DOC-001"),
      client.cases.share("CL-001", { recipientOrgId: "demo-lender-b", permission: "VIEW" }),
    ]) {
      const error = await rejection(call);
      expect(error.status).toBe(404);
      expect(error.problem?.detail).toBe("This record is unavailable to your account.");
    }
    const list = await client.cases.list();
    expect(list.items).toEqual([]);
    expect(Object.values(list.counts).every((n) => n === 0)).toBe(true);
    expect((await client.audit.events()).items).toEqual([]);
    expect((await client.pledges.list()).items).toEqual([]);
    expect((await client.reports.list()).items).toEqual([]);
    // Lender B still holds governance seat 2 through a separate member party.
    expect((await client.governance.state()).viewerSeat).toBe(2);
  });

  it("keeps terms away from verifier and dealer", async () => {
    const client = await walk("activated");
    client.setPersona("verifier-inspector");
    expect((await rejection(client.proposals.get("FP-001"))).code).toBe("unavailable");
    expect((await rejection(client.cases.get("CL-001"))).code).toBe("unavailable");
    client.setPersona("dealer-contributor");
    const dealerView = await client.cases.get("CL-001");
    expect(dealerView.requestedPrincipal).toBeNull();
    expect(dealerView.references.proposal).toBeNull();
    expect(dealerView.pledge).toBeNull();
    expect(JSON.stringify(dealerView)).not.toContain("100000");
    expect((await rejection(client.proposals.get("FP-001"))).code).toBe("unavailable");
  });

  it("revokes report downloads when the auditor's grant is revoked", async () => {
    const client = await walk("granted");
    client.setPersona("auditor");
    await client.reports.create({ caseId: "CL-001", format: "CSV" });
    client.setPersona("manufacturer-owner");
    const grants = await client.accessGrants.list({ caseId: "CL-001" });
    const ownerGrant = grants.items.find((g) => g.kind === "AUDIT" && g.consentingParties[0]?.id === "demo-manufacturer");
    await client.accessGrants.revoke(ownerGrant!.id);
    client.setPersona("auditor");
    expect((await rejection(client.reports.download("RPT-0001"))).code).toBe("unavailable");
  });

  it("replays an idempotent retry and rejects a reused key with another payload", async () => {
    const client = newClient("lender-a-analyst");
    const first = await client.cases.saveAssessment("CL-001", assessment, { idempotencyKey: "same-key-0001" });
    const retry = await client.cases.saveAssessment("CL-001", assessment, { idempotencyKey: "same-key-0001" });
    expect(retry.command.commandId).toBe(first.command.commandId);
    expect((await client.commands.get(first.command.commandId)).state).toBe("PROJECTED");
    const reused = await rejection(
      client.cases.saveAssessment("CL-001", { ...assessment, limitations: "changed" }, { idempotencyKey: "same-key-0001" }),
    );
    expect(reused.code).toBe("idempotency_conflict");
  });

  it("validates input with the shared Zod schemas", async () => {
    const client = newClient("lender-a-analyst");
    const error = await rejection(client.cases.saveAssessment("CL-001", { ...assessment, valuation: { amount: "150000.001", currency: "USD" } }));
    expect(error.code).toBe("validation_error");
    expect(error.problem?.issues?.[0]?.path).toBe("valuation.amount");
  });

  it("keeps state across persona switches", async () => {
    const client = await walk("eligible");
    client.setPersona("manufacturer-owner");
    expect((await client.cases.get("CL-001")).review?.value).toBe("ELIGIBLE");
    expect((await client.reviews.get("CA-001")).internalNotes).toBeNull();
    client.setPersona("lender-a-analyst");
    expect((await client.reviews.get("CA-001")).internalNotes).toBe(INTERNAL_NOTE);
  });
});

describe("mock client: clean-start registration and verification", () => {
  it("registers, uploads, verifies and shares a new asset", async () => {
    const client = createMockClient({ personaId: "manufacturer-owner", now: new Date(NOW), latencyMs: 0, profile: "clean-start" });
    expect((await client.cases.list()).items).toEqual([]);
    const reg = await client.assets.register({
      intent: "REGISTER",
      equipmentClass: "CNC machining center",
      manufacturer: "Demo Machine Works (synthetic)",
      model: "DEMO-CNC-500",
      serialNumber: "SYNTH-CNC-001",
      locationScope: "Demo Manufacturer facility · Ohio, US (declared)",
    });
    const assetRef = reg.result.assetRef;
    expect(assetRef).toBe("ASSET-DEMO-001");

    const pdf = new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37])], { type: "application/pdf" });
    const docs: string[] = [];
    for (const [type, title] of [
      ["DEALER_INVOICE", "Dealer invoice"],
      ["EQUIPMENT_PHOTOS", "Equipment photos"],
      ["INSPECTION_REPORT", "Inspection report"],
      ["MAINTENANCE_SUMMARY", "Maintenance summary"],
    ] as const) {
      const intent = await client.evidence.createUploadIntent({ assetRef, type, title, fileName: `${type}.pdf`, contentType: "application/pdf", sizeBytes: pdf.size });
      const uploaded = await client.evidence.uploadContent(intent.result.evidenceId, pdf);
      expect(uploaded.result.status.value).toBe("QUARANTINED");
      expect(uploaded.result.integrity.hash).toMatch(/^[0-9a-f]{64}$/);
      const final = await client.evidence.finalize(intent.result.evidenceId);
      expect(final.result.status.value).toBe("AVAILABLE");
      expect(final.result.scanStatus.value).toBe("NOT_SCANNED");
      docs.push(intent.result.evidenceId);
    }
    const png = new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])], { type: "image/png" });
    const badIntent = await client.evidence.createUploadIntent({ assetRef, type: "OTHER", title: "Other", fileName: "x.png", contentType: "image/png", sizeBytes: 4 });
    expect((await rejection(client.evidence.uploadContent(badIntent.result.evidenceId, png))).code).toBe("validation_error");

    // A suspended verifier cannot be assigned.
    expect((await rejection(client.assets.requestVerification(assetRef, { verifierRegistryRef: "VER-003", scope: ["Photos"], documentIds: docs }))).code).toBe(
      "state_conflict",
    );
    const vr = await client.assets.requestVerification(assetRef, { verifierRegistryRef: "VER-001", scope: ["Serial consistency", "Photos"], documentIds: docs });

    client.setPersona("verifier-inspector");
    await client.verifications.decideAssignment(vr.result.verificationRef, { decision: "ACCEPT" });
    const att = await client.verifications.issueAttestation(vr.result.verificationRef, {
      method: "On-site inspection + document review",
      inspectedAt: NOW.toISOString(),
      validUntil: "2027-05-15T00:00:00.000Z",
      checks: [{ item: "Serial consistency", finding: "Matches invoice", result: "CHECKED" }],
      limitations: "Ownership and lien status were reviewed from submitted documents only.",
    });
    expect(att.result.attestationRef).toBe("ATT-001");

    client.setPersona("manufacturer-owner");
    const created = await client.cases.create({ title: "Used CNC financing", assetRef, selectedLenderOrgId: "demo-lender-a", requestedPrincipal: usd("100000.00") });
    expect(created.command.target).toBe("APPLICATION");
    client.setPersona("lender-a-analyst");
    expect((await rejection(client.cases.get(created.result.caseId))).code).toBe("unavailable"); // invitation alone shares nothing
    client.setPersona("manufacturer-owner");
    await client.cases.share(created.result.caseId, { recipientOrgId: "demo-lender-a", permission: "VIEW_DOWNLOAD" });
    client.setPersona("lender-a-analyst");
    const lenderView = await client.cases.get(created.result.caseId);
    expect(lenderView.stage?.value).toBe("LENDER_REVIEW");
    expect(lenderView.review?.label).toBe("Awaiting lender review");
  });
});

describe("mock client: governance simulation", () => {
  it("confirms, executes and never touches collateral", async () => {
    const client = createMockClient({ personaId: "lender-a-approver", now: new Date("2026-10-01T14:32:05Z"), latencyMs: 0 });
    const gp = await client.governance.proposal("GP-004");
    expect(gp.state.value).toBe("OPEN");
    expect(gp.liveConfirmations).toBe(1);
    const confirmed = await client.governance.confirm("GP-004");
    expect(confirmed.command.message).toBe("Recorded in the governance simulation.");
    expect((await client.governance.proposal("GP-004")).state.value).toBe("EXECUTABLE");
    await client.governance.execute("GP-004");
    const entries = await client.verifiers.list();
    expect(entries.find((v) => v.ref === "VER-004")?.status.value).toBe("ACTIVE");
    expect((await client.cases.get("CL-001")).pledge?.value).toBe("AVAILABLE");
    client.setPersona("lender-a-analyst");
    expect((await rejection(client.governance.propose({ type: "SUSPEND_VERIFIER", verifierRef: "VER-002", rationale: "x" }))).code).toBe("forbidden");
  });
});
