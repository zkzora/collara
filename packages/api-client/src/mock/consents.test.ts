// UI_MOCK parity of the dealer consent requests (same rules as the LOCALNET API, apps/api workflow/sharing/
// consent.ts and routes/workflow/access.ts): the owner's case-linked verification request asks the dealer for its
// own documents; only that dealer approves, declines or withdraws; the verifier and the lender receive a dealer
// document only while the dealer's consent stands; everyone else gets the 404-shaped answer.
import { CONSENT_COPY } from "@collara/domain";
import { describe, expect, it } from "vitest";
import { ApiError } from "../errors";
import { createMockClient } from "./index";

const NOW = new Date("2026-10-02T08:00:00Z");

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

/** CL-001 (main seed): DOC-003 is the dealer's invoice; AG-001 holds the dealer's granted consent for Demo Lender A. */
async function caseLinkedRequest() {
  const client = createMockClient({ personaId: "manufacturer-owner", now: new Date(NOW), latencyMs: 0 });
  const vr = await client.assets.requestVerification("ASSET-DEMO-001", {
    verifierRegistryRef: "VER-001",
    scope: ["Serial consistency"],
    documentIds: ["DOC-001", "DOC-003"],
    caseId: "CL-001",
  });
  return { client, vr: vr.result.verificationRef };
}

describe("mock client: dealer consent requests", () => {
  it("a case-linked verification request asks the dealer for its invoice; nothing reaches the verifier before consent", async () => {
    const { client, vr } = await caseLinkedRequest();
    expect((await client.verifications.get(vr)).documentIds).toEqual(["DOC-001"]);

    client.setPersona("dealer-contributor");
    const list = await client.consentRequests.list({ caseId: "CL-001" });
    expect(list.items.map((r) => [r.id, r.purpose, r.recipient.name, r.state.value, r.allowedActions])).toEqual([
      [`${vr}-G2-D1`, "VERIFICATION", "Demo Verifier", "PENDING", ["consent.grant", "consent.decline"]],
      ["AG-001", "LENDER_REVIEW", "Demo Lender A", "GRANTED", ["consent.withdraw"]],
    ]);
    const pending = list.items[0]!;
    expect(pending.verificationRef).toBe(vr);
    expect(pending.documents.map((d) => [d.documentId, d.type, d.version])).toEqual([["DOC-003", "DEALER_INVOICE", 1]]);
    expect(pending.documents[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(list)).not.toMatch(/DOC-001|DOC-002|DOC-005|100000/);

    client.setPersona("verifier-inspector");
    expect((await rejection(client.evidence.download("DOC-003"))).code).toBe("unavailable");

    client.setPersona("dealer-contributor");
    await client.consentRequests.decide(pending.id, { decision: "GRANT" });
    expect((await client.consentRequests.list({ caseId: "CL-001" })).items.find((r) => r.id === pending.id)?.state.value).toBe("GRANTED");
    client.setPersona("verifier-inspector");
    expect((await client.verifications.get(vr)).documentIds).toEqual(["DOC-001", "DOC-003"]);
    expect((await client.evidence.download("DOC-003")).url).toBeTruthy();

    // Withdrawal ends the verifier's future access.
    client.setPersona("dealer-contributor");
    await client.consentRequests.withdraw(pending.id);
    expect((await client.consentRequests.list()).items.find((r) => r.id === pending.id)?.state.value).toBe("WITHDRAWN");
    client.setPersona("verifier-inspector");
    expect((await client.verifications.get(vr)).documentIds).toEqual(["DOC-001"]);
    expect((await rejection(client.evidence.download("DOC-003"))).code).toBe("unavailable");
  });

  it("declining leaves the document with the dealer; the owner sees the status but cannot decide", async () => {
    const { client, vr } = await caseLinkedRequest();
    const id = `${vr}-G2-D1`;
    expect((await rejection(client.consentRequests.decide(id, { decision: "GRANT" }))).code).toBe("forbidden");
    client.setPersona("dealer-contributor");
    const declined = await client.consentRequests.decide(id, { decision: "DECLINE" }, { idempotencyKey: "decline-1" });
    expect(declined.command).toMatchObject({ simulated: true });
    expect(declined.command.message).not.toBe("Confirmed on the ledger.");
    // A second decision is a state conflict.
    const again = await rejection(client.consentRequests.decide(id, { decision: "GRANT" }));
    expect([again.code, again.message]).toEqual(["state_conflict", CONSENT_COPY.NOT_PENDING]);
    client.setPersona("manufacturer-owner");
    const owner = await client.consentRequests.list({ caseId: "CL-001" });
    expect(owner.items.find((r) => r.id === id)).toMatchObject({ state: { value: "DECLINED" }, allowedActions: [] });
    client.setPersona("verifier-inspector");
    expect((await client.verifications.get(vr)).documentIds).toEqual(["DOC-001"]);
  });

  it("withdrawing the lender consent removes the dealer's invoice from the lender's share only", async () => {
    const client = createMockClient({ personaId: "dealer-contributor", now: new Date(NOW), latencyMs: 0 });
    client.setPersona("lender-a-analyst");
    expect((await client.cases.evidence("CL-001")).map((d) => d.id)).toContain("DOC-003");
    client.setPersona("dealer-contributor");
    await client.consentRequests.withdraw("AG-001");
    const after = (await client.consentRequests.list()).items.find((r) => r.id === "AG-001");
    expect(after).toMatchObject({ state: { value: "WITHDRAWN" }, allowedActions: [] });
    expect((await rejection(client.consentRequests.withdraw("AG-001"))).message).toBe(CONSENT_COPY.NOT_GRANTED);
    client.setPersona("lender-a-analyst");
    const lender = (await client.cases.evidence("CL-001")).map((d) => d.id);
    expect(lender).not.toContain("DOC-003");
    expect(lender).toContain("DOC-001");
  });

  it("the owner's revocation of AG-001 ends the dealer's consent held in it", async () => {
    const client = createMockClient({ personaId: "manufacturer-owner", now: new Date(NOW), latencyMs: 0 });
    await client.accessGrants.revoke("AG-001");
    client.setPersona("dealer-contributor");
    expect((await client.consentRequests.list()).items.find((r) => r.id === "AG-001")).toMatchObject({ state: { value: "REVOKED" }, allowedActions: [] });
    expect((await rejection(client.consentRequests.withdraw("AG-001"))).code).toBe("state_conflict");
  });

  it("is unavailable to unrelated parties and empty for related non-owners", async () => {
    const { client, vr } = await caseLinkedRequest();
    for (const persona of ["lender-b-approver", "auditor", "lender-a-approver", "verifier-inspector"] as const) {
      client.setPersona(persona);
      expect((await client.consentRequests.list()).items, persona).toEqual([]);
      expect((await rejection(client.consentRequests.decide(`${vr}-G2-D1`, { decision: "GRANT" }))).code, persona).toBe("unavailable");
      expect((await rejection(client.consentRequests.withdraw("AG-001"))).code, persona).toBe("unavailable");
    }
    client.setPersona("lender-b-approver");
    expect((await rejection(client.consentRequests.list({ caseId: "CL-001" }))).code).toBe("unavailable");
  });

  it("an owner's share of a case with a dealer document asks the dealer before the lender receives it", async () => {
    const client = createMockClient({ personaId: "manufacturer-owner", now: new Date(NOW), latencyMs: 0, profile: "clean-start" });
    const PDF = new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37])], { type: "application/pdf" });
    const { result } = await client.assets.register({
      intent: "REGISTER",
      equipmentClass: "CNC machining center",
      manufacturer: "Demo Machine Works (synthetic)",
      model: "DEMO-CNC-500",
      serialNumber: "SYNTH-CNC-001",
      locationScope: "Demo Manufacturer facility · Ohio, US (declared)",
    });
    const assetRef = result.assetRef;
    const created = await client.cases.create({ title: "Used CNC financing", assetRef, selectedLenderOrgId: "demo-lender-a", dealerOrgId: "demo-cnc-dealer" });
    const caseId = created.result.caseId;
    const upload = async (type: "DEALER_INVOICE" | "EQUIPMENT_PHOTOS" | "INSPECTION_REPORT" | "MAINTENANCE_SUMMARY") => {
      const intent = await client.evidence.createUploadIntent({ assetRef, caseId, type, title: type, fileName: `${type}.pdf`, contentType: "application/pdf", sizeBytes: PDF.size });
      await client.evidence.uploadContent(intent.result.evidenceId, PDF);
      return (await client.evidence.finalize(intent.result.evidenceId)).result.id;
    };
    client.setPersona("dealer-contributor");
    const invoice = await upload("DEALER_INVOICE");
    client.setPersona("manufacturer-owner");
    for (const type of ["EQUIPMENT_PHOTOS", "INSPECTION_REPORT", "MAINTENANCE_SUMMARY"] as const) await upload(type);
    await client.cases.share(caseId, { recipientOrgId: "demo-lender-a", permission: "VIEW_DOWNLOAD" });

    client.setPersona("lender-a-analyst");
    expect((await client.cases.evidence(caseId)).map((d) => d.id)).not.toContain(invoice);
    client.setPersona("dealer-contributor");
    const [request] = (await client.consentRequests.list({ caseId })).items;
    expect(request).toMatchObject({ purpose: "LENDER_REVIEW", recipient: { id: "demo-lender-a" }, state: { value: "PENDING" } });
    expect(request?.documents.map((d) => d.documentId)).toEqual([invoice]);
    await client.consentRequests.decide(request!.id, { decision: "GRANT" });
    client.setPersona("lender-a-analyst");
    expect((await client.cases.evidence(caseId)).map((d) => d.id)).toContain(invoice);
  });
});
