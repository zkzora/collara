// LocalNet IT (LOCALNET_IT=1): the asset, verification and sharing endpoints on the MAIN seed world (CL-001,
// ATT-001, PKG-001 v2 shared with Demo Lender A, CA-001 SUBMITTED) on a fresh "ep1-<unique>" prefix:
//   - reads on the seeded world (no second assessment on the lender's open, registry refs, shared evidence);
//   - a second verification of the same asset: references skip the seed's literal refs (VR-002, ATT-002), the
//     manifest moves to v3, and the new attestation SUPERSEDES ATT-001 (its lender disclosure is withdrawn);
//   - negative cases: Lender B 404, nothing to consent → 409, same key + different payload → 409.
import { AttestationSchema, CaseDetailSchema, CommandStatusSchema, CL001_CHECKS, ERROR_COPY, pageSchema, VerificationRequestSchema } from "@collara/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { LOCALNET_IT_ENABLED, startLocalnetHarness, type ItSession, type LocalnetHarness } from "./harness";

const DAY = 86_400_000;
const ASSET = "ASSET-DEMO-001";
const CommandBody = z.object({ command: CommandStatusSchema, result: z.unknown().optional() });

describe.skipIf(!LOCALNET_IT_ENABLED)("LocalNet: verification and sharing endpoints on the main seed", () => {
  let h: LocalnetHarness;
  let owner: ItSession;
  let dealer: ItSession;
  let verifier: ItSession;
  let analyst: ItSession;
  let lenderB: ItSession;
  const facts: Record<string, unknown> = {};
  let purchaseAgreement = "";

  function committed(response: { statusCode: number; body: string; json(): unknown }, label: string) {
    expect(response.statusCode, `${label}: ${response.body}`).toBe(200);
    const body = CommandBody.parse(response.json());
    expect(body.command, label).toMatchObject({ state: "COMMITTED", simulated: false });
    expect(body.command.updateId, label).toBeTruthy();
    return body;
  }

  beforeAll(async () => {
    h = await startLocalnetHarness({ prefixBase: "ep1" });
    facts.prefix = h.prefix;
    const seed = await h.seed("main");
    facts.mainSeedMs = seed.totalMs;
    purchaseAgreement = seed.documents.find((d) => d.fileName === "purchase-agreement.pdf")?.docRef ?? "";
    await h.project();
    [owner, dealer, verifier, analyst, lenderB] = await Promise.all([
      h.loginAs("manufacturer-owner"),
      h.loginAs("dealer-contributor"),
      h.loginAs("verifier-inspector"),
      h.loginAs("lender-a-analyst"),
      h.loginAs("lender-b-approver"),
    ]);
  });

  afterAll(async () => {
    console.log(`LocalNet verification IT facts: ${JSON.stringify(facts, null, 2)}`);
    await h?.close();
  });

  it("reads the seeded world: the lender's open does not create a second assessment; refs come from the registry", async () => {
    const detail = CaseDetailSchema.parse((await analyst.inject("GET", "/api/cases/CL-001")).json());
    expect(detail.review?.value).toBe("SUBMITTED");
    expect(await h.acsAs("lenderA", "CollateralAssessment")).toHaveLength(1);
    for (const session of [owner, verifier]) {
      const list = pageSchema(VerificationRequestSchema).parse((await session.inject("GET", "/api/verifications")).json());
      expect(list.items.map((v) => [v.ref, v.verifierRegistryRef, v.state.value])).toEqual([["VR-001", "VER-001", "ATTESTED"]]);
    }
    expect((await lenderB.inject("GET", "/api/verifications")).json()).toMatchObject({ items: [] });
    // The seeded package share (SHR-002, view and download) lets the lender download the owner's photos.
    const download = await analyst.inject("GET", "/api/evidence/DOC-002/download");
    expect(download.statusCode, download.body).toBe(200);
    // The purchase agreement was never shared with the lender.
    expect(purchaseAgreement).toMatch(/^DOC-/);
    expect((await analyst.inject("GET", `/api/evidence/${purchaseAgreement}/download`)).statusCode).toBe(404);
    expect((await lenderB.inject("GET", "/api/evidence/DOC-002/download")).statusCode).toBe(404);
  });

  it("refuses what is already done: nothing to consent (dealer), already shared (owner)", async () => {
    const consent = await dealer.inject("POST", "/api/cases/CL-001/sharing", { body: { recipientOrgId: "demo-lender-a", permission: "VIEW_DOWNLOAD" } });
    expect(consent.statusCode).toBe(409);
    const share = await owner.inject("POST", "/api/cases/CL-001/sharing", { body: { recipientOrgId: "demo-lender-a", permission: "VIEW_DOWNLOAD" } });
    expect(share.statusCode).toBe(409);
  });

  it("a second verification of the asset: VR-002 on manifest v3 (seed literals skipped); Lender B 404; key reuse with another payload 409", async () => {
    const body = { verifierRegistryRef: "VER-001", scope: ["Purchase agreement consistency"], documentIds: [purchaseAgreement] };
    const lenderBTry = await lenderB.inject("POST", `/api/assets/${ASSET}/verification-requests`, { body });
    expect(lenderBTry.statusCode).toBe(404);
    expect(lenderBTry.json()).toMatchObject({ code: "unavailable", detail: ERROR_COPY.UNAVAILABLE });
    const unknownVerifier = await owner.inject("POST", `/api/assets/${ASSET}/verification-requests`, { body: { ...body, verifierRegistryRef: "VER-777" } });
    expect(unknownVerifier.statusCode).toBe(409);
    expect(unknownVerifier.json()).toMatchObject({ detail: "The selected verifier is not active in the verifier registry." });

    const request = committed(await owner.inject("POST", `/api/assets/${ASSET}/verification-requests`, { body, idempotencyKey: "ep1-vr2-0001" }), "request VR-002");
    expect(request.result).toEqual({ verificationRef: "VR-002" });
    const conflict = await owner.inject("POST", `/api/assets/${ASSET}/verification-requests`, { body: { ...body, scope: ["Different"] }, idempotencyKey: "ep1-vr2-0001" });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ code: "idempotency_conflict" });

    const manifests = await h.acsAs("borrower", "EvidenceManifest", (m) => m.assetId === ASSET);
    expect(manifests.map((m) => m.payload.version)).toEqual([3]);
    expect(manifests[0]!.payload.entries.map((e) => e.docRef)).toContain(purchaseAgreement);
    const [control] = await h.acsAs("borrower", "AssetControl", (c) => c.assetId === ASSET);
    // Manifest_NewVersion moved the anchor (v3 → v4); the lender's view of the control is kept.
    expect(control!.payload).toMatchObject({ controlVersion: 4, sharedLender: h.party("lenderA"), evidence: { manifestVersion: 3 } });
    facts.controlVersion = control!.payload.controlVersion;
  });

  it("the verifier accepts and attests: ATT-002 supersedes ATT-001 and withdraws the lender's disclosure", async () => {
    await h.project();
    committed(await verifier.inject("POST", "/api/verifications/VR-002/assignment", { body: { decision: "ACCEPT" } }), "accept VR-002");
    expect(await h.acsAs("lenderA", "AttestationDisclosure")).toHaveLength(1);
    await h.project();
    const issued = committed(
      await verifier.inject("POST", "/api/verifications/VR-002/attestations", {
        body: {
          method: "Document review",
          inspectedAt: new Date(Date.now() - 60_000).toISOString(),
          validUntil: new Date(Date.now() + 90 * DAY).toISOString(),
          checks: CL001_CHECKS.slice(0, 2).map((c) => ({ item: c.item, finding: c.finding, result: c.result })),
          limitations: "Synthetic document review only.",
        },
      }),
      "attest VR-002",
    );
    expect(issued.result).toEqual({ attestationRef: "ATT-002" });
    const active = await h.acsAs("verifier", "VerificationAttestation", (a) => a.assetId === ASSET);
    expect(active.map((a) => [a.payload.attestationRef, a.payload.supersedesRef])).toEqual([["ATT-002", "ATT-001"]]);
    // Supersession withdrew the lender's copy of ATT-001 (activation would now fail the off-ledger check).
    expect(await h.acsAs("lenderA", "AttestationDisclosure")).toHaveLength(0);

    await h.project();
    const old = AttestationSchema.parse((await owner.inject("GET", "/api/attestations/ATT-001")).json());
    expect(old).toMatchObject({ validity: { value: "SUPERSEDED" }, supersededBy: "ATT-002" });
    const current = AttestationSchema.parse((await owner.inject("GET", "/api/attestations/ATT-002")).json());
    expect(current).toMatchObject({ validity: { value: "VALID" }, supersedes: "ATT-001", evidencePackage: { version: 3 } });
    const list = pageSchema(VerificationRequestSchema).parse((await verifier.inject("GET", "/api/verifications")).json());
    expect(list.items.map((v) => [v.ref, v.state.value]).sort()).toEqual([
      ["VR-001", "ATTESTED"],
      ["VR-002", "ATTESTED"],
    ]);
    expect((await lenderB.inject("GET", "/api/attestations/ATT-002")).statusCode).toBe(404);
  });
});
